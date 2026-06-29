/**
 * Per-message price resolution for the MANAGED (prepaid) billing track.
 *
 * 1 credit = ₹1 = 100 paise. Prices are category-based (Meta charges
 * MARKETING / UTILITY / AUTHENTICATION differently); SERVICE = plain
 * text / session replies. A per-org row in `message_pricing` overrides
 * the platform default. All math is integer paise — never floats.
 */
import { createServiceClient } from "@/lib/supabase/server";
import { deriveQuote, type SendQuote } from "./rates";

export type MessageCategory =
  | "MARKETING"
  | "UTILITY"
  | "AUTHENTICATION"
  | "SERVICE";

/** Map a template category (or a non-template send) to a billable category. */
export function toBillableCategory(
  templateCategory?: string | null,
): MessageCategory {
  switch ((templateCategory || "").toUpperCase()) {
    case "MARKETING":
      return "MARKETING";
    case "UTILITY":
      return "UTILITY";
    case "AUTHENTICATION":
      return "AUTHENTICATION";
    default:
      // text / media / session replies are "service" conversations
      return "SERVICE";
  }
}

/**
 * Resolve the full quote for one send (charged price + margin trail), in integer
 * paise. Resolution order:
 *   1. explicit per-user override row in `message_pricing` (a hand-set deal),
 *   2. derived from wholesale × (tier markup + buffer)  [migration 017],
 *   3. legacy platform-default row in `message_pricing`  [pre-017 fallback].
 * Throws if none resolves (a managed user must always have a price).
 *
 * `wholesalePaise`/`markupBps` are populated only on the derived path — that's
 * what the ledger margin trail records.
 */
export async function quoteSend(
  userId: string,
  category: MessageCategory,
): Promise<SendQuote> {
  const supabase = createServiceClient();

  // 1. Explicit per-user absolute override always wins.
  const { data: override } = await supabase
    .from("message_pricing")
    .select("price_paise")
    .eq("user_id", userId)
    .eq("category", category)
    .maybeSingle<{ price_paise: number }>();
  if (override) {
    return { chargedPaise: Number(override.price_paise), wholesalePaise: null, markupBps: null };
  }

  // 2. Derived: wholesale × (tier markup + buffer).
  const derived = await deriveQuote(userId, category);
  if (derived) return derived;

  // 3. Legacy platform default (pre-017 / unconfigured fallback).
  const { data: def, error } = await supabase
    .from("message_pricing")
    .select("price_paise")
    .is("user_id", null)
    .eq("category", category)
    .maybeSingle<{ price_paise: number }>();
  if (error) throw new Error(`Pricing lookup failed: ${error.message}`);
  if (!def) throw new Error(`No price configured for category ${category}`);
  return { chargedPaise: Number(def.price_paise), wholesalePaise: null, markupBps: null };
}

/**
 * Resolve the cost of one send in integer paise (charged price only). Thin
 * wrapper over quoteSend for callers that don't need the margin trail.
 */
export async function quoteSendCostPaise(
  userId: string,
  category: MessageCategory,
): Promise<number> {
  return (await quoteSend(userId, category)).chargedPaise;
}

export const rupeesToPaise = (rupees: number): number => Math.round(rupees * 100);
export const paiseToRupees = (paise: number): number => paise / 100;
