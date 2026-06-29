/**
 * Confirm or release the wallet reservation linked to a sent message, driven by
 * its Meta delivery status. This is the "confirm-on-sent" half of the prepaid
 * billing flow (the reserve half lives in lib/billing/guarded-send.ts).
 *
 *   • sent / delivered / read → wallet_settle (the real debit) → status=settled
 *   • failed                  → wallet_release (free the hold)  → status=released
 *
 * Called from the webhook status path (worker + legacy route) for every status
 * event. Idempotent:
 *   - message_billing.status gates re-processing (only 'reserved' rows act),
 *   - wallet_settle is idempotent per (reservation_id, unit_idem=wa_message_id),
 *   - wallet_release is idempotent.
 * So duplicate/out-of-order webhooks can't double-charge or double-release.
 */
import { createServiceClient } from "@/lib/supabase/server";
import { logger } from "@/lib/logger";
import * as wallet from "./wallet";

// A message is "confirmed" (billable) the first time Meta reports it left our
// hands. failed (before any confirm) means it never sent → release.
const CONFIRM_STATUSES = new Set(["sent", "delivered", "read"]);

export async function confirmOrReleaseBilling(
  waMessageId: string,
  status: string,
): Promise<void> {
  if (!waMessageId) return;
  const supabase = createServiceClient();

  const { data: row } = await supabase
    .from("message_billing")
    .select("reservation_id, cost_paise, status")
    .eq("wa_message_id", waMessageId)
    .maybeSingle();

  if (!row) return; // BYO / free / not a managed single send
  if (row.status !== "reserved") return; // already settled or released

  try {
    if (CONFIRM_STATUSES.has(status)) {
      await wallet.settle({
        reservationId: row.reservation_id,
        actualPaise: row.cost_paise,
        unitIdempotencyKey: waMessageId,
        description: "WhatsApp send (confirmed by Meta status)",
        referenceId: waMessageId,
      });
      // Single-unit hold: close it so the reservation row doesn't linger.
      await wallet.release(row.reservation_id).catch(() => {});
      await supabase
        .from("message_billing")
        .update({ status: "settled", settled_at: new Date().toISOString() })
        .eq("wa_message_id", waMessageId)
        .eq("status", "reserved");
      logger.info("billing confirmed", { waMessageId, statusState: status });
    } else if (status === "failed") {
      await wallet.release(row.reservation_id);
      await supabase
        .from("message_billing")
        .update({ status: "released" })
        .eq("wa_message_id", waMessageId)
        .eq("status", "reserved");
      logger.info("billing released (failed send)", { waMessageId });
    }
  } catch (e) {
    // Late/duplicate webhook racing a closed reservation — safe to ignore.
    logger.warn("confirmOrReleaseBilling skipped", {
      waMessageId,
      statusState: status,
      e: e instanceof Error ? e.message : String(e),
    });
  }
}
