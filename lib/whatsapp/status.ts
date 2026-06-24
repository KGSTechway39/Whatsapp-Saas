/**
 * Outbound message status processing (sent / delivered / read / failed).
 *
 * Meta delivers status events out of order and re-delivers them. Two rules:
 *   1. Monotonic: never let a lower-rank status overwrite a higher one
 *      (a late `sent` must not clobber a `read`). Enforced race-safely in the
 *      UPDATE filter — we only overwrite a strictly-lower (or null/pending)
 *      status — so concurrent workers can't regress the state.
 *   2. Terminal states (`read`, `failed`) are never overwritten (they fall out
 *      of the rule: nothing ranks above them in the overwritable sets below).
 *
 * Status lands on `campaign_messages` (the only status-trackable table in the
 * deployed schema). No billing here — that's wired in a later step.
 */
import { createServiceClient } from "@/lib/supabase/server";
import { logger } from "@/lib/logger";

/** For an incoming status, which existing statuses it is allowed to overwrite. */
const OVERWRITABLE: Record<string, string[]> = {
  sent: ["pending"],
  delivered: ["pending", "sent"],
  read: ["pending", "sent", "delivered"],
  failed: ["pending", "sent"],
};

export interface StatusPayload {
  id: string; // Meta message id (== meta_message_id of the outbound row)
  status: string; // sent | delivered | read | failed
  timestamp?: string; // unix seconds
  errors?: { code?: number; title?: string; message?: string }[];
}

/**
 * Apply one status event monotonically. Returns true if a row was actually
 * updated (i.e. the status moved forward), false if skipped (lower rank, or no
 * matching campaign message — e.g. a single send / BYO message).
 */
export async function processStatusEvent(payload: StatusPayload): Promise<boolean> {
  const metaMessageId = payload.id;
  const next = payload.status;
  const overwritable = OVERWRITABLE[next];

  if (!metaMessageId || !overwritable) {
    logger.warn("status: ignoring unknown status", { id: metaMessageId, statusState: next });
    return false;
  }

  const tsIso = payload.timestamp
    ? new Date(Number(payload.timestamp) * 1000).toISOString()
    : new Date().toISOString();

  const patch: Record<string, unknown> = { status: next };
  if (next === "sent") patch.sent_at = tsIso;
  if (next === "delivered") patch.delivered_at = tsIso;
  if (next === "read") patch.read_at = tsIso;
  if (next === "failed") {
    patch.error_message =
      payload.errors?.[0]?.title ?? payload.errors?.[0]?.message ?? "Delivery failed";
  }

  const supabase = createServiceClient();
  // WHERE meta_message_id = X AND (status IS NULL OR status IN (<lower ranks>))
  // → race-safe monotonic guard; a late/lower status matches no rows and is a no-op.
  const { data, error } = await supabase
    .from("campaign_messages")
    .update(patch)
    .eq("meta_message_id", metaMessageId)
    .or(`status.is.null,status.in.(${overwritable.join(",")})`)
    .select("id");

  if (error) {
    logger.warn("status update failed", { metaMessageId, next, error: error.message });
    return false;
  }

  const applied = (data?.length ?? 0) > 0;
  logger.info("status processed", { metaMessageId, next, applied });
  return applied;
}
