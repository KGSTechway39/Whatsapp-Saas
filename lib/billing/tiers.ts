/**
 * Product tiers — the single source of truth for a user's plan, mapping the
 * customer-facing `tier` onto the two axes the send paths already read:
 *
 *   tier        billing_mode   waba_mode   model   meaning
 *   ----------  -------------  ----------  ------  ------------------------------------
 *   starter     managed        shared      C       under the platform's WABA, capped
 *   growth      managed        own         B       own WABA, credits billed via us
 *   enterprise  byo            own         A       own WABA, client pays Meta direct
 *
 * `billing_mode` (from migration 011) stays the value the wallet/guarded-send
 * paths gate on — `setTier()` just keeps it, `waba_mode`, and `tier` in lockstep
 * so they can never drift. See migration 016_tiers.sql.
 *
 * NOTE: `waba_mode='shared'` (starter / Model C) requires a platform-owned
 * WhatsApp number pool to actually send — that provisioning is deferred. Setting
 * a user to `starter` activates wallet billing but shared-WABA send routing is
 * not built yet; growth/enterprise (own WABA) send today.
 */
import { createServiceClient } from "@/lib/supabase/server";

export type Tier = "starter" | "growth" | "enterprise";
export type BillingMode = "byo" | "managed";
export type WabaMode = "own" | "shared";

export const TIERS: Tier[] = ["starter", "growth", "enterprise"];

/** Derive the (billing_mode, waba_mode) a tier implies. */
export function tierAxes(tier: Tier): { billingMode: BillingMode; wabaMode: WabaMode } {
  switch (tier) {
    case "starter":
      return { billingMode: "managed", wabaMode: "shared" };
    case "growth":
      return { billingMode: "managed", wabaMode: "own" };
    case "enterprise":
      return { billingMode: "byo", wabaMode: "own" };
  }
}

export function isTier(value: unknown): value is Tier {
  return value === "starter" || value === "growth" || value === "enterprise";
}

/**
 * Set a user's tier, writing `tier`, `billing_mode`, and `waba_mode` together so
 * the three never diverge. Ensures a wallet row exists the moment a user lands on
 * a managed tier (starter/growth) so their prepaid balance is immediately
 * visible/top-uppable. Returns the derived axes.
 */
export async function setTier(userId: string, tier: Tier): Promise<{ billingMode: BillingMode; wabaMode: WabaMode }> {
  const { billingMode, wabaMode } = tierAxes(tier);
  const supabase = createServiceClient();

  const { error } = await supabase
    .from("users")
    .update({
      tier,
      billing_mode: billingMode,
      waba_mode: wabaMode,
      updated_at: new Date().toISOString(),
    })
    .eq("id", userId);
  if (error) throw new Error(error.message);

  if (billingMode === "managed") {
    await supabase
      .from("wallet")
      .upsert({ user_id: userId }, { onConflict: "user_id", ignoreDuplicates: true });
  }

  return { billingMode, wabaMode };
}
