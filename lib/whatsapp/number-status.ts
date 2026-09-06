/**
 * Maps Meta's phone-number status onto our `whatsapp_numbers.status`.
 *
 * WHY THIS FILE EXISTS — the bug it fixes:
 * onboarding-repo previously did
 *     status = phone.status === "VERIFIED" ? "active" : "inactive"
 * which compares TWO DIFFERENT Meta fields. `MetaPhoneNumber` carries both:
 *
 *   • `status`                   → CONNECTED | PENDING | DISCONNECTED |
 *                                  FLAGGED | RESTRICTED | MIGRATED | BANNED |
 *                                  RATE_LIMITED | UNVERIFIED | UNKNOWN
 *   • `code_verification_status` → VERIFIED | NOT_VERIFIED | EXPIRED
 *
 * "VERIFIED" is never a value of `status`, so that comparison was ALWAYS false
 * and every number connected through Embedded Signup was written `inactive`.
 *
 * That is not a cosmetic defect: every outbound path in this codebase filters
 * `whatsapp_numbers.status = 'active'` — campaigns/execute, campaigns/launch,
 * automation-flows/execute, the public API v1 routes, cart recovery,
 * lib/whatsapp/{repository,engine}, and the go-live checklist. A number in the
 * wrong state silently disables ALL sending, with an empty picker as the only
 * symptom.
 *
 * Keep this mapping here. It is the single place that decides whether a number
 * can send, and it should never be re-derived inline.
 */

/** Meta statuses a number can still send from. */
const SENDABLE = new Set([
  "CONNECTED",
  // Still sends. FLAGGED = quality has dropped and is under review;
  // RATE_LIMITED = throughput capped. Both are degraded, neither is stopped,
  // and marking them inactive would take a working number offline over a
  // warning the owner can still act on.
  "FLAGGED",
  "RATE_LIMITED",
]);

/** Meta statuses that genuinely cannot send. */
const BLOCKED = new Set([
  "DISCONNECTED",
  "BANNED",
  "RESTRICTED",
  "PENDING",      // registration not finished
  "UNVERIFIED",   // display name / business not verified yet
  "MIGRATED",     // moved to another WABA; this row is stale
]);

export type NumberStatus = "active" | "inactive";

/**
 * Decide the stored status for a number we just read from Meta.
 *
 * The `codeVerificationStatus` argument is accepted but deliberately NOT used
 * as a veto: a number can be CONNECTED and sending while its code-verification
 * record reads NOT_VERIFIED (common on numbers migrated in via Embedded
 * Signup). Conflating the two is the original bug; the parameter exists so
 * callers can pass what Meta gave them without having to know that.
 */
export function deriveNumberStatus(
  metaStatus: string | null | undefined,
  codeVerificationStatus?: string | null,
): NumberStatus {
  const s = (metaStatus ?? "").trim().toUpperCase();

  if (SENDABLE.has(s)) return "active";
  if (BLOCKED.has(s)) return "inactive";

  // Absent or unrecognised (including UNKNOWN, and the Manual Setup path where
  // Meta may not return the field at all).
  //
  // Default ACTIVE, on purpose. We only reach this code having just fetched
  // this number from Meta with a working access token — that round-trip is
  // itself evidence the number is reachable. Defaulting to inactive is what
  // produced a fully-connected, webhook-verified number that could not send,
  // and a new Meta status string appearing later should not silently take
  // every tenant offline.
  void codeVerificationStatus;
  return "active";
}

/** True when a stored row is usable for sending. */
export function isSendable(status: string | null | undefined): boolean {
  return status === "active";
}
