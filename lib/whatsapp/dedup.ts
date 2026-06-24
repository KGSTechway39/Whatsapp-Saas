/**
 * Webhook idempotency for inbound Meta events.
 *
 * Meta retries webhooks on any non-200/timeout and delivers duplicates, sometimes
 * concurrently. Only a DB unique constraint can atomically reject a concurrent
 * duplicate — in-memory/per-instance dedup races under serverless.
 *
 * We reuse the generic `processed_events` table (event_id TEXT PRIMARY KEY,
 * migration 012) with source='whatsapp'. Key scheme:
 *   • inbound message → `wa_msg:<message.id>`
 *   • status event    → `wa_status:<message_id>:<status>`  (delivered/read/failed distinct)
 */
import { createServiceClient } from "@/lib/supabase/server";
import { logger } from "@/lib/logger";

/**
 * Record an event as processed. Returns true the FIRST time `eventKey` is seen
 * (caller should process it) and false for a duplicate (caller should skip).
 *
 * Fail-OPEN: if the dedup write errors, we return true (process anyway).
 * Downstream idempotency (Step-1 wallet keys, settle/release) guards against
 * double-charge; silently dropping a real message would be worse.
 */
export async function markEventProcessed(
  supabase: ReturnType<typeof createServiceClient>,
  eventKey: string,
  eventType: "message" | "status" | "ctwa_referral" | string,
): Promise<boolean> {
  const { data, error } = await supabase
    .from("processed_events")
    .upsert(
      { event_id: eventKey, source: "whatsapp", event_type: eventType },
      { onConflict: "event_id", ignoreDuplicates: true },
    )
    .select("event_id");

  if (error) {
    logger.warn("dedup check failed, processing anyway", {
      eventKey,
      error: error.message,
    });
    return true;
  }
  // `ignoreDuplicates` → ON CONFLICT DO NOTHING; a conflict returns no rows.
  return (data?.length ?? 0) > 0;
}
