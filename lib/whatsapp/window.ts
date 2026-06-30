/**
 * 24-Hour Customer Service Window guard.
 *
 * WhatsApp gotcha (this governs EVERY outbound send):
 *   A business may send FREE-FORM ("session") messages — plain text, interactive
 *   buttons/lists, media — to a contact ONLY within 24 hours of that contact's
 *   LAST INBOUND message. Outside that window, Meta rejects free-form sends
 *   (error 131047 "Re-engagement message") and ONLY pre-approved message
 *   *templates* (HSM) may be delivered.
 *
 * Source of truth: `contacts.last_inbound_at`, refreshed on every inbound by the
 * flow engine (see `lib/whatsapp/engine.ts`). Reply sends are inside the window
 * by construction; outbound-initiated sends (drips, reminders, broadcasts) MUST
 * check it and fall back to a template when the window is closed.
 */

import { createServiceClient } from "@/lib/supabase/server";

/** A WhatsApp session window is 24 hours from the contact's last inbound message. */
export const WINDOW_MS = 24 * 60 * 60 * 1000;

/** Outbound message families, by how the window applies to them. */
export type OutboundKind = "text" | "interactive" | "template";

export interface WindowState {
  /** True if a free-form session message may be sent right now. */
  open: boolean;
  lastInboundAt: string | null;
  /** ISO timestamp when the window closes (null if no inbound ever recorded). */
  expiresAt: string | null;
  /** Milliseconds until the window closes (0 if already closed). */
  msRemaining: number;
}

/** Pure: derive window state from a `last_inbound_at` value (no DB call). */
export function windowStateFrom(
  lastInboundAt: string | null | undefined,
  now: number = Date.now(),
): WindowState {
  if (!lastInboundAt) {
    return { open: false, lastInboundAt: null, expiresAt: null, msRemaining: 0 };
  }
  const last = new Date(lastInboundAt).getTime();
  const expiresMs = last + WINDOW_MS;
  const remaining = expiresMs - now;
  return {
    open: remaining > 0,
    lastInboundAt,
    expiresAt: new Date(expiresMs).toISOString(),
    msRemaining: Math.max(0, remaining),
  };
}

/** Fetch the live window state for a contact (one scoped read). */
export async function getWindowState(contactId: string): Promise<WindowState> {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from("contacts")
    .select("last_inbound_at")
    .eq("id", contactId)
    .maybeSingle();
  return windowStateFrom((data as { last_inbound_at: string | null } | null)?.last_inbound_at);
}

/**
 * The single decision point: may this outbound be delivered right now?
 *   • templates           → always allowed (that is what they exist for)
 *   • text / interactive  → only inside an open 24h window
 *
 * Returns a reason code on rejection so callers can route to a template or skip.
 */
export function canSend(
  kind: OutboundKind,
  state: WindowState,
): { ok: true } | { ok: false; reason: "OUTSIDE_24H_WINDOW" } {
  if (kind === "template") return { ok: true };
  if (state.open) return { ok: true };
  return { ok: false, reason: "OUTSIDE_24H_WINDOW" };
}
