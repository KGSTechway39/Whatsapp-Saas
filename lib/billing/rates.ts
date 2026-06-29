/**
 * Rate / markup config readers + the per-message price derivation (the margin
 * core). See migration 017_billing_rates.sql.
 *
 *   charged_paise = round( wholesale × (1 + (tier_markup_bps + buffer_bps)/10000) )
 *
 * Every reader fails SOFT (returns null) when its table/row is missing, so the
 * code is safe to deploy before 017 is applied — callers fall back to the legacy
 * `message_pricing` defaults. All math is integer paise.
 */
import { createServiceClient } from "@/lib/supabase/server";
import type { MessageCategory } from "./pricing";

export type Tier = "starter" | "growth" | "enterprise";

export interface TierConfig {
  tier: Tier;
  model: "A" | "B" | "C";
  billing_mode: "byo" | "managed";
  waba_mode: "own" | "shared";
  monthly_fee_paise: number;
  onboarding_fee_paise: number;
  default_markup_bps: number;
  monthly_msg_cap: number | null;
  razorpay_plan_key: string | null;
}

export interface PlatformSettings {
  buffer_bps: number;
  min_topup_paise: number;
  default_low_balance_threshold_paise: number;
  credit_validity_months: number;
}

export interface SendQuote {
  chargedPaise: number;
  wholesalePaise: number | null;
  markupBps: number | null;
}

/** Latest effective Meta wholesale cost for a category (paise). null = no row. */
export async function getWholesalePaise(
  category: MessageCategory,
  region = "IN",
): Promise<number | null> {
  try {
    const supabase = createServiceClient();
    const { data, error } = await supabase
      .from("meta_rates")
      .select("wholesale_paise")
      .eq("region", region)
      .eq("category", category)
      .order("effective_from", { ascending: false })
      .limit(1)
      .maybeSingle<{ wholesale_paise: number }>();
    if (error || !data) return null;
    return Number(data.wholesale_paise);
  } catch {
    return null;
  }
}

export async function getTierConfig(tier: Tier): Promise<TierConfig | null> {
  try {
    const supabase = createServiceClient();
    const { data, error } = await supabase
      .from("plan_tiers")
      .select("*")
      .eq("tier", tier)
      .maybeSingle<TierConfig>();
    if (error || !data) return null;
    return data;
  } catch {
    return null;
  }
}

export async function getPlatformSettings(): Promise<PlatformSettings | null> {
  try {
    const supabase = createServiceClient();
    const { data, error } = await supabase
      .from("platform_settings")
      .select("buffer_bps, min_topup_paise, default_low_balance_threshold_paise, credit_validity_months")
      .eq("id", 1)
      .maybeSingle<PlatformSettings>();
    if (error || !data) return null;
    return data;
  } catch {
    return null;
  }
}

/**
 * Bonus basis points for a top-up of `amountPaise` — the highest band whose
 * `min_paise` the load clears (bigger load = more bonus credits). 0 if no band
 * applies or the table is absent.
 */
export async function resolveTopupBonusBps(amountPaise: number): Promise<number> {
  try {
    const supabase = createServiceClient();
    const { data } = await supabase
      .from("topup_bands")
      .select("bonus_bps")
      .lte("min_paise", amountPaise)
      .order("min_paise", { ascending: false })
      .limit(1)
      .maybeSingle<{ bonus_bps: number }>();
    return data ? Number(data.bonus_bps) : 0;
  } catch {
    return 0;
  }
}

/**
 * Derive the charged price for one send from wholesale × (tier markup + buffer).
 * Returns null if any config piece is missing (→ caller falls back to legacy
 * `message_pricing`). SERVICE wholesale is 0 → charged 0 (free), as intended.
 */
export async function deriveQuote(
  userId: string,
  category: MessageCategory,
): Promise<SendQuote | null> {
  try {
    const supabase = createServiceClient();
    const { data: u } = await supabase
      .from("users")
      .select("tier")
      .eq("id", userId)
      .maybeSingle<{ tier: Tier | null }>();
    if (!u?.tier) return null;

    const [tier, settings, wholesale] = await Promise.all([
      getTierConfig(u.tier),
      getPlatformSettings(),
      getWholesalePaise(category),
    ]);
    if (!tier || !settings || wholesale === null) return null;

    const markupBps = tier.default_markup_bps;
    const chargedPaise = Math.round(
      (wholesale * (10000 + markupBps + settings.buffer_bps)) / 10000,
    );
    return { chargedPaise, wholesalePaise: wholesale, markupBps };
  } catch {
    return null;
  }
}
