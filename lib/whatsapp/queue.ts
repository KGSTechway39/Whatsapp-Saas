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
import { processStatusEvent, type StatusPayload } from "./status";
import { confirmOrReleaseBilling } from "@/lib/billing/confirm";
import { enqueue, registerHandler } from "@/lib/queue";

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
