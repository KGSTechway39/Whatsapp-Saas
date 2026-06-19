/**
 * Per-message price resolution for the MANAGED (prepaid) billing track.
 *
 * 1 credit = ₹1 = 100 paise. Prices are category-based (Meta charges
 * MARKETING / UTILITY / AUTHENTICATION differently); SERVICE = plain
 * text / session replies. A per-org row in `message_pricing` overrides
 * the platform default. All math is integer paise — never floats.
 */
import { createServiceClient } from "@/lib/supabase/server";

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
 * Resolve the cost of one send in integer paise. Prefers the user-specific
 * price row, falls back to the platform default. Throws if neither exists
 * (a managed user must always have a resolvable price).
 */
export async function quoteSendCostPaise(
  userId: string,
  category: MessageCategory,
): Promise<number> {
  const supabase = createServiceClient();

  const { data, error } = await supabase
    .from("message_pricing")
    .select("user_id, price_paise")
    .or(`user_id.eq.${userId},user_id.is.null`)
    .eq("category", category);

  if (error) throw new Error(`Pricing lookup failed: ${error.message}`);
  if (!data || data.length === 0) {
    throw new Error(`No price configured for category ${category}`);
  }

  // User-specific row wins over the platform default (user_id IS NULL).
  const userRow = data.find((r) => r.user_id === userId);
  const chosen = userRow ?? data.find((r) => r.user_id === null);
  return Number(chosen!.price_paise);
}

export const rupeesToPaise = (rupees: number): number => Math.round(rupees * 100);
export const paiseToRupees = (paise: number): number => paise / 100;
