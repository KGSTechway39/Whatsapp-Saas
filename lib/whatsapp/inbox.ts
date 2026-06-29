/**
 * Persist-then-enqueue: store the raw Meta webhook payload BEFORE any processing
 * or enqueue, so an event isn't lost if the worker/driver dies after the 200 ack.
 * The stored row is replayable (re-run processing from `raw_payload`).
 *
 * See migration 021_webhook_inbox.sql.
 */
import { createServiceClient } from "@/lib/supabase/server";
import { logger } from "@/lib/logger";

/**
 * Store the raw payload and return the inbox row id (or null if the write failed —
 * never block the webhook ack on it). Call this BEFORE dedup/enqueue/processing.
 */
export async function persistRawEvent(
  rawPayload: unknown,
  route: string,
  signatureValid = true,
): Promise<string | null> {
  const { data, error } = await createServiceClient()
    .from("webhook_inbox")
    .insert({ source: "whatsapp", route, signature_valid: signatureValid, raw_payload: rawPayload })
    .select("id")
    .single();

  if (error) {
    logger.warn("webhook_inbox insert failed", { route, error: error.message });
    return null;
  }
  return data.id;
}

/** Mark a persisted inbox row processed or failed (best-effort; never throws). */
export async function markInboxDone(
  inboxId: string | null,
  ok: boolean,
  error?: string,
): Promise<void> {
  if (!inboxId) return;
  await createServiceClient()
    .from("webhook_inbox")
    .update({
      status: ok ? "processed" : "failed",
      error: ok ? null : (error ?? "processing failed"),
      processed_at: new Date().toISOString(),
    })
    .eq("id", inboxId)
    .then(
      () => {},
      () => {},
    );
}
