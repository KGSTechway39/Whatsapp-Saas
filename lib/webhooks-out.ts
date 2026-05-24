/**
 * Outbound webhooks: HMAC-signed POSTs to customer endpoints with
 * exponential-backoff retries.
 *
 * Public events (Stripe-like):
 *   message.sent          a message has been queued and accepted by Meta
 *   message.delivered     Meta confirmed delivery
 *   message.read          recipient read the message
 *   message.failed        delivery failed
 *   message.received      inbound message from a customer
 *   contact.created       new contact added (manual / import / CTWA)
 *   contact.updated       contact fields changed
 *   campaign.completed    bulk campaign finished
 */

import { createHmac, randomBytes } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

export type WebhookEventName =
  | "message.sent" | "message.delivered" | "message.read" | "message.failed" | "message.received"
  | "contact.created" | "contact.updated" | "campaign.completed";

export interface WebhookEventEnvelope<T = unknown> {
  id: string;
  type: WebhookEventName;
  created_at: string;
  data: T;
}

export function generateSecret(): string {
  return `whsec_${randomBytes(24).toString("hex")}`;
}

export function signPayload(secret: string, rawBody: string, timestamp: number): string {
  const signed = `${timestamp}.${rawBody}`;
  const hmac = createHmac("sha256", secret).update(signed).digest("hex");
  return `t=${timestamp},v1=${hmac}`;
}

/**
 * Enqueue an event for every webhook endpoint of the user that subscribes
 * to it, then attempt the first delivery in-process. Failures are persisted
 * to webhook_deliveries with a `next_retry_at` schedule (exponential backoff).
 */
export async function dispatchEvent<T>(
  supabase: SupabaseClient,
  userId: string,
  event: WebhookEventName,
  data: T,
): Promise<{ enqueued: number }> {
  const { data: endpoints } = await supabase
    .from("webhook_endpoints")
    .select("id, url, secret, events, status")
    .eq("user_id", userId)
    .eq("status", "active");

  if (!endpoints || endpoints.length === 0) return { enqueued: 0 };

  const subscribed = endpoints.filter((e) => Array.isArray(e.events) && e.events.includes(event));
  if (subscribed.length === 0) return { enqueued: 0 };

  const envelope: WebhookEventEnvelope<T> = {
    id: `evt_${Date.now()}_${randomBytes(6).toString("hex")}`,
    type: event,
    created_at: new Date().toISOString(),
    data,
  };

  await Promise.all(
    subscribed.map(async (ep) => {
      const { data: row } = await supabase
        .from("webhook_deliveries")
        .insert({
          endpoint_id: ep.id,
          user_id: userId,
          event,
          payload: envelope,
          status: "pending",
        })
        .select("id")
        .single();

      if (!row) return;
      // Fire-and-forget the first attempt.
      attemptDelivery(supabase, row.id).catch(() => {});
    }),
  );

  return { enqueued: subscribed.length };
}

const RETRY_DELAYS_MS = [
  60_000,        // 1 min
  5 * 60_000,    // 5 min
  30 * 60_000,   // 30 min
  2 * 3600_000,  // 2 h
  12 * 3600_000, // 12 h
];

/** Single delivery attempt against the customer endpoint. */
export async function attemptDelivery(
  supabase: SupabaseClient,
  deliveryId: string,
): Promise<void> {
  const { data: delivery } = await supabase
    .from("webhook_deliveries")
    .select("id, endpoint_id, event, payload, attempts")
    .eq("id", deliveryId)
    .single();

  if (!delivery) return;

  const { data: ep } = await supabase
    .from("webhook_endpoints")
    .select("id, url, secret, status")
    .eq("id", delivery.endpoint_id)
    .single();

  if (!ep || ep.status !== "active") return;

  const rawBody  = JSON.stringify(delivery.payload);
  const ts       = Math.floor(Date.now() / 1000);
  const sig      = signPayload(ep.secret, rawBody, ts);
  const started  = Date.now();

  let responseStatus = 0;
  let responseBody: string | null = null;
  let success = false;

  try {
    const res = await fetch(ep.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "WASend-Webhooks/1.0",
        "X-WASend-Signature": sig,
        "X-WASend-Event": delivery.event,
        "X-WASend-Delivery-Id": delivery.id,
      },
      body: rawBody,
      // Customer endpoints should respond fast; abort > 10s.
      signal: AbortSignal.timeout(10_000),
    });
    responseStatus = res.status;
    responseBody = (await res.text()).slice(0, 4000);
    success = res.status >= 200 && res.status < 300;
  } catch (err) {
    responseBody = err instanceof Error ? err.message : String(err);
  }

  const duration = Date.now() - started;
  const attempts = (delivery.attempts || 0) + 1;

  if (success) {
    await supabase
      .from("webhook_deliveries")
      .update({
        status: "success",
        attempts,
        response_status: responseStatus,
        response_body: responseBody,
        duration_ms: duration,
        completed_at: new Date().toISOString(),
        next_retry_at: null,
      })
      .eq("id", delivery.id);

    await supabase.rpc("increment_webhook_endpoint_success", { p_id: ep.id }).then(
      () => {},
      async () => {
        await supabase
          .from("webhook_endpoints")
          .update({
            last_delivery_at: new Date().toISOString(),
            last_success_at: new Date().toISOString(),
            failure_count: 0,
          })
          .eq("id", ep.id);
      },
    );
    return;
  }

  // Failure — schedule retry or give up.
  const giveUp = attempts >= RETRY_DELAYS_MS.length + 1;
  const nextDelay = giveUp ? null : RETRY_DELAYS_MS[attempts - 1];
  const nextRetry = nextDelay ? new Date(Date.now() + nextDelay).toISOString() : null;

  await supabase
    .from("webhook_deliveries")
    .update({
      status: giveUp ? "failed" : "retrying",
      attempts,
      response_status: responseStatus,
      response_body: responseBody,
      duration_ms: duration,
      next_retry_at: nextRetry,
      completed_at: giveUp ? new Date().toISOString() : null,
    })
    .eq("id", delivery.id);

  // Track endpoint-level health.
  await supabase
    .from("webhook_endpoints")
    .update({
      last_delivery_at: new Date().toISOString(),
      failure_count: attempts,
      // Auto-pause after 10 consecutive failures so we stop hammering a
      // dead endpoint. Customer can resume via the dashboard.
      status: attempts >= 10 ? "failed" : "active",
    })
    .eq("id", ep.id);
}
