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
import { runFlow } from "@/lib/automation/engine";
import { createClient } from "@/lib/supabase/server";

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
  // Runs the FULL flow, not just its first reply. This used to call
  // renderFirstReply(), which walks the graph only far enough to find the first
  // free-text message and returns that one string — so delays, conditions, AI
  // Reply, tagging and template sends all worked in the builder's test run and
  // were silently dropped in production.
  //
  // runFlow() is the same engine the builder previews, so what a tenant tests is
  // what their customers get. Sends inside it go through guardedSingleSend (24h
  // window + billing) and are consent-checked per node.
  const text = payload.text?.body?.trim();
  if (!text) return;
  try {
    const userId = await resolveUserIdByPhoneNumberId(event.phoneNumberId);
    if (!userId) return;
    const flow = await resolveFlowForInbound({ userId, message: text });
    if (!flow) return;

    // The engine sends THROUGH the conversation (that is how it resolves the
    // number and enforces the window), so resolve it for this inbound. The
    // webhook route creates contact + conversation before this job runs.
    const supabase = createClient();
    const { data: conv } = await supabase
      .from("conversations")
      .select("id, contact_id")
      .eq("user_id", userId)
      .eq("contact_phone", payload.from)
      .order("last_message_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (conv?.id && conv.contact_id) {
      const result = await runFlow({
        userId,
        flowId: flow.flowId,
        contactId: conv.contact_id,
        conversationId: conv.id,
        testMode: false,
      });
      logger.info("automation.runtime: ran flow", {
        userId,
        flowId: flow.flowId,
        matchedBy: flow.matchedBy,
        confidence: flow.confidence,
        flowStatus: result.status,
        steps: result.log.length,
      });
      return;
    }

    // No conversation row yet (first-ever contact, or a webhook write that lost
    // the race). Fall back to the single auto-reply rather than dropping the
    // message entirely — degraded, but never silent.
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
    logger.info("automation.runtime: delivered first reply (no conversation row)", {
      userId,
      flowId: flow.flowId,
      matchedBy: flow.matchedBy,
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
