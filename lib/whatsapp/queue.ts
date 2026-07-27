/**
 * Async worker-queue boundary for inbound WhatsApp webhook payloads.
 *
 * Why: Meta retries the webhook if we don't return 200 in ~5s. Vercel
 * serverless functions also have a hard execution timeout. Doing template
 * lookups + Graph API sends + DB writes inline risks both.
 *
 * Pattern: the webhook hands the raw payload off to this enqueue function
 * and returns 200 immediately. A separate worker process (BullMQ, Upstash
 * QStash, Cloud Tasks, or — on Vercel — Vercel Queues / Inngest) drains
 * the queue and runs `processIncomingMessage()` for each event.
 *
 * The implementation below is a MOCK that runs the job in-process. Swap
 * `enqueueWebhookEvent()` for a real producer (BullMQ + Redis URL via
 * REDIS_URL env) when scaling out.
 */

import { logger } from "@/lib/logger";
import { processIncomingMessage } from "./engine";
import { sendOutbound } from "./dispatch";
import { processStatusEvent, type StatusPayload } from "./status";
import { confirmOrReleaseBilling } from "@/lib/billing/confirm";
import { enqueue, registerHandler } from "@/lib/queue";
import { resolveUserIdByPhoneNumberId, resolveFlowForInbound, renderFirstReply } from "@/lib/automation/runtime";

export interface InboundEvent {
  /** Meta `phone_number_id` — used to resolve the tenant. */
  phoneNumberId: string;
  /** The single message or status object inside `entry[0].changes[0].value`. */
  payload: Record<string, unknown>;
  /** Type of event — set by the dispatcher. */
  kind: "message" | "status" | "ctwa_referral";
  /** Idempotency key (Meta message id or status id). */
  eventId: string;
  /** When Meta sent the event (unix seconds). */
  receivedAt: number;
}

/**
 * Enqueue an inbound webhook event for async processing.
 *
 * REPLACE THIS with a real producer. Examples:
 *
 *   // BullMQ + Redis
 *   import { Queue } from "bullmq";
 *   const q = new Queue("whatsapp:inbound", { connection: { url: process.env.REDIS_URL! } });
 *   await q.add(event.eventId, event, { removeOnComplete: 1000 });
 *
 *   // Vercel Queues
 *   import { qstash } from "@upstash/qstash";
 *   await qstash.publishJSON({ url: `${process.env.SITE_URL}/api/worker/whatsapp`, body: event });
 *
 *   // Inngest
 *   await inngest.send({ name: "whatsapp/inbound", data: event });
 */
const INBOUND_JOB = "whatsapp:inbound";

// Register the inbound worker with the generic queue. Under the default inline
// driver this runs in-process (same as before); setting QUEUE_DRIVER routes it
// to a durable backend with no change to this file.
registerHandler<InboundEvent>(INBOUND_JOB, runInboundWorker);

/**
 * Hand an inbound webhook event to the queue and return immediately, so the
 * webhook can ack Meta within milliseconds regardless of processing time.
 */
export async function enqueueWebhookEvent(event: InboundEvent): Promise<void> {
  await enqueue(INBOUND_JOB, event, { id: event.eventId });
}

async function runInboundWorker(event: InboundEvent): Promise<void> {
  if (event.kind === "status") {
    // Status lifecycle (sent/delivered/read/failed) — update the message row
    // with a monotonic rank so out-of-order events can't regress state.
    const status = event.payload as unknown as StatusPayload;
    await processStatusEvent(status);
    // Confirm (settle) or release the prepaid reservation linked to this message.
    await confirmOrReleaseBilling(status.id, status.status);
    return;
  }
  if (event.kind !== "message") {
    // ctwa_referral handled inline by the webhook today
    return;
  }

  const payload = event.payload as {
    from?: string;
    type?: string;
    text?: { body?: string };
    interactive?: {
      type?: "button_reply" | "list_reply";
      button_reply?: { id: string; title: string };
      list_reply?: { id: string; title: string };
    };
  };

  if (!payload.from) {
    logger.warn("Inbound event missing `from`", { eventId: event.eventId });
    return;
  }

  const result = await processIncomingMessage({
    phoneNumberId: event.phoneNumberId,
    fromPhone: payload.from,
    incoming: normalizeInbound(payload),
    eventId: event.eventId,
    receivedAt: event.receivedAt,
  });

  // Deliver the engine's reply. Previously this return value was discarded, so
  // every automation computed a reply and then sent nothing — the dispatcher
  // enforces the 24h window and resolves/decrypts the tenant token before send.
  if (result.outbound) {
    await sendOutbound({
      phoneNumberId: event.phoneNumberId,
      outbound: result.outbound,
      lastInboundAt: result.lastInboundAt ?? null,
    });
    return;
  }

  // ── Runtime AI intent routing (LEGACY user_id automation model) ─────────────
  // The org-model engine above is coded but NOT deployed (CLAUDE.md deployment
  // reality), so in production it never matches. Fall back to the live user_id
  // model: classify the inbound message against the tenant's ACTIVE flows (cheap
  // fast model, 0 credits) and deliver the matched flow's first auto-reply. This
  // routes silently — the flow was already approved/published by the owner, so no
  // draft/confirm step (rule: AI never sends net-new customer content unprompted).
  //
  // TODO(persistent-worker): multi-step traversal (waits/conditions/sessions)
  // belongs on a persistent host (Railway/Render). This inline path handles the
  // common trigger→auto-reply case within the Vercel Hobby queue/cron constraints.
  // Decoupled + mockable: see lib/automation/{intent,runtime}.ts — testable
  // against synthetic payloads before the Meta webhook is finalized.
  const text = payload.text?.body?.trim();
  if (!text) return;
  try {
    const userId = await resolveUserIdByPhoneNumberId(event.phoneNumberId);
    if (!userId) return;
    const flow = await resolveFlowForInbound({ userId, message: text });
    if (!flow) return;
    const reply = renderFirstReply(flow.flowData);
    if (!reply) return;
    await sendOutbound({
      phoneNumberId: event.phoneNumberId,
      outbound: {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: payload.from,
        type: "text",
        text: { body: reply, preview_url: false },
      },
      lastInboundAt: new Date((event.receivedAt ?? Math.floor(Date.now() / 1000)) * 1000).toISOString(),
    });
    logger.info("automation.runtime: delivered flow reply", {
      userId,
      flowId: flow.flowId,
      matchedBy: flow.matchedBy,
      confidence: flow.confidence,
    });
  } catch (err) {
    logger.warn("automation.runtime: intent routing failed", {
      eventId: event.eventId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

function normalizeInbound(p: {
  type?: string;
  text?: { body?: string };
  interactive?: {
    type?: "button_reply" | "list_reply";
    button_reply?: { id: string; title: string };
    list_reply?: { id: string; title: string };
  };
}): import("./engine").IncomingPayload {
  if (p.type === "interactive" && p.interactive) {
    const i = p.interactive;
    if (i.type === "button_reply" && i.button_reply) {
      return { kind: "button", buttonId: i.button_reply.id, text: i.button_reply.title };
    }
    if (i.type === "list_reply" && i.list_reply) {
      return { kind: "list", listId: i.list_reply.id, text: i.list_reply.title };
    }
  }
  return { kind: "text", text: p.text?.body ?? "" };
}
