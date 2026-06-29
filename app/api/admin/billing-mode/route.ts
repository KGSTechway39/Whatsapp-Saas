/**
 * Admin: set a user's product TIER (starter / growth / enterprise).
 *
 * This is the activation switch for the managed track. Tier is the single source
 * of truth — it derives `billing_mode` (the value the wallet/send paths read) and
 * `waba_mode` together (see lib/billing/tiers.ts). There is no self-serve path;
 * clients are vetted before we hold their billing/BSP.
 *
 * Gated by requireAdmin() (ADMIN_EMAILS allowlist). All handlers 403 for non-admins.
 *
 *   GET                  → { admin: true }                 (admin check for the UI)
 *   GET ?email=<addr>    → { user: { id, email, full_name, tier, billing_mode, waba_mode, balance_paise } }
 *   POST { userId|email, tier }  → updated user row
 *
 * The route path stays `/api/admin/billing-mode` for compatibility with the
 * existing client/middleware entry.
 */
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";
import { isTier, setTier } from "@/lib/billing/tiers";

type UserRow = {
  id: string;
  email: string;
  full_name: string | null;
  tier: "starter" | "growth" | "enterprise";
  billing_mode: "byo" | "managed";
  waba_mode: "own" | "shared";
};

async function loadUser(
  by: { email?: string; id?: string },
): Promise<(UserRow & { balance_paise: number }) | null> {
  const supabase = createServiceClient();
  let q = supabase.from("users").select("id, email, full_name, tier, billing_mode, waba_mode");
  q = by.id ? q.eq("id", by.id) : q.eq("email", (by.email || "").toLowerCase());
  const { data: user, error } = await q.maybeSingle<UserRow>();
  // Surface real DB errors (e.g. a not-yet-applied migration) instead of masking
  // them as a 404 "user not found".
  if (error) throw new Error(error.message);
  if (!user) return null;

  const { data: wallet } = await supabase
    .from("wallet")
    .select("balance_paise")
    .eq("user_id", user.id)
    .maybeSingle<{ balance_paise: number }>();

  return { ...user, balance_paise: wallet?.balance_paise ?? 0 };
}

export async function GET(request: NextRequest) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const email = request.nextUrl.searchParams.get("email")?.trim();
  if (!email) return NextResponse.json({ admin: true });

  let user;
  try {
    user = await loadUser({ email });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
  if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });
  return NextResponse.json({ user });
}

export async function POST(request: NextRequest) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { userId, email, tier } = await request.json();
  if (!isTier(tier)) {
    return NextResponse.json(
      { error: "tier must be 'starter', 'growth', or 'enterprise'" },
      { status: 400 },
    );
  }
  if (!userId && !email) {
    return NextResponse.json({ error: "userId or email is required" }, { status: 400 });
  }

  const target = await loadUser({ id: userId, email });
  if (!target) return NextResponse.json({ error: "User not found" }, { status: 404 });

  // setTier writes tier + billing_mode + waba_mode together and ensures a wallet
  // row on managed tiers, so the three axes can never drift.
  try {
    await setTier(target.id, tier);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }

  const updated = await loadUser({ id: target.id });
  return NextResponse.json({ user: updated });
}
