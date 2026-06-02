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
export async function enqueueWebhookEvent(event: InboundEvent): Promise<void> {
  // ── MOCK: fire-and-forget in-process execution ──────────────────────────
  // In a real deploy, the worker runs in a separate dyno/lambda so the
  // webhook can ack Meta within milliseconds regardless of processing time.
  void runMockWorker(event).catch((err) => {
    logger.error("Mock worker crashed", {
      eventId: event.eventId,
      err: err instanceof Error ? err.message : String(err),
    });
  });
}

async function runMockWorker(event: InboundEvent): Promise<void> {
  if (event.kind !== "message") {
    // status / ctwa_referral handled inline by the webhook today
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

  await processIncomingMessage({
    phoneNumberId: event.phoneNumberId,
    fromPhone: payload.from,
    incoming: normalizeInbound(payload),
    eventId: event.eventId,
    receivedAt: event.receivedAt,
  });
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
