/**
 * Which category does a catalog/product message bill at?
 *
 * THE RULE (Part 3 of the commerce spec):
 *   • Sent proactively — the customer has NOT messaged in the last 24h
 *       → MARKETING (charged at the marketing rate)
 *   • Sent as a reply inside the open 24h service window
 *       → SERVICE (free; message_pricing seeds SERVICE at 0 paise)
 *
 * The window decision is NOT reimplemented here. `lib/whatsapp/window.ts`
 * already owns it (`getWindowState`, `canSend`) and is used by every other send
 * path; a second copy would drift and the two would eventually disagree about
 * whether a given send was billable.
 *
 * The price for the resolved category still comes from `meta_rates` via
 * quoteSend — this module decides WHICH category, never what it costs (Law 2:
 * rates are never hardcoded).
 */
import { getWindowState, type WindowState } from "@/lib/whatsapp/window";
import type { MessageCategory } from "@/lib/billing/pricing";

export interface CommerceCategoryDecision {
  category: MessageCategory;
  /** True when the 24h window is open, i.e. this is a free service reply. */
  insideWindow: boolean;
  /** Plain-language reason, safe to show a tenant. Never mentions rates. */
  reason: string;
  window: WindowState;
}

/**
 * Resolve the billing category for a commerce message to one contact.
 *
 * A contact we cannot resolve (no id, or no inbound ever recorded) is treated
 * as OUTSIDE the window → MARKETING. That is the safe direction: assuming a
 * window we cannot prove would under-charge the platform and, worse, would let
 * a free-form interactive message be attempted outside a window where Meta
 * will reject it.
 */
export async function resolveCommerceCategory(
  contactId: string | null | undefined,
): Promise<CommerceCategoryDecision> {
  if (!contactId) {
    const window: WindowState = { open: false, lastInboundAt: null, expiresAt: null, msRemaining: 0 };
    return {
      category: "MARKETING",
      insideWindow: false,
      reason: "This is a new conversation, so it's charged as a marketing message.",
      window,
    };
  }

  const window = await getWindowState(contactId);

  if (window.open) {
    const hours = Math.max(1, Math.round(window.msRemaining / 3_600_000));
    return {
      category: "SERVICE",
      insideWindow: true,
      reason: `They messaged you recently, so this reply is free for about ${hours} more hour${hours === 1 ? "" : "s"}.`,
      window,
    };
  }

  return {
    category: "MARKETING",
    insideWindow: false,
    reason: window.lastInboundAt
      ? "It's been more than 24 hours since they messaged, so this is charged as a marketing message."
      : "They haven't messaged you yet, so this is charged as a marketing message.",
    window,
  };
}

/**
 * Same decision for a list of contacts — what a campaign composer needs to
 * quote a send before it runs.
 *
 * Returns counts rather than a total price: pricing belongs to quoteSend, and
 * this module must never become a second place that knows what a message costs.
 */
export async function splitByCommerceCategory(
  contactIds: string[],
): Promise<{ marketing: string[]; service: string[] }> {
  const marketing: string[] = [];
  const service: string[] = [];

  // Sequential on purpose: this Supabase tier serialises requests, so a
  // Promise.all here buys nothing and just multiplies concurrent load.
  for (const id of contactIds) {
    const decision = await resolveCommerceCategory(id);
    (decision.category === "SERVICE" ? service : marketing).push(id);
  }
  return { marketing, service };
}
