/**
 * Admin: set a user's product TIER (starter / growth / enterprise).
 *
 * This is the activation switch for the managed track. Tier is the single source
 * of truth — it derives `billing_mode` (the value the wallet/send paths read) and
 * `waba_mode` together (see lib/billing/tiers.ts). There is no self-serve path;
 * clients are vetted before we hold their billing/BSP.
 *
 * Platform staff only (requirePlatformStaff: super_admin or tenant_admin). All handlers 403 for non-admins.
 *
 *   GET                  → { admin: true }                 (admin check for the UI)
 *   GET ?email=<addr>    → { user: { id, email, full_name, tier, billing_mode, waba_mode, balance_paise } }
 *   POST { userId|email, tier }  → updated user row
 *
 * The route path stays `/api/admin/billing-mode` for compatibility with the
 * existing client/middleware entry.
 */
import { NextRequest, NextResponse } from "next/server";
import { requirePlatformStaff } from "@/lib/roles";
import { audit } from "@/lib/audit";
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

/** Strips the balance for anyone who is not super_admin. */
function redactMoney<T extends { balance_paise: number }>(user: T, canSeeMoney: boolean) {
  if (canSeeMoney) return { ...user, wallet_funded: user.balance_paise > 0 };
  const { balance_paise, ...rest } = user;
  return { ...rest, balance_paise: null, wallet_funded: balance_paise > 0 };
}

export async function GET(request: NextRequest) {
  const admin = await requirePlatformStaff();
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
  // MONEY REDACTION: tenant_admin may set a tier BY NAME (that is the whole
  // point of a pre-configured plan dropdown) but must never see the wallet
  // amount. Redacted server-side, not hidden in the UI.
  return NextResponse.json({ user: redactMoney(user, admin.canSeeMoney) });
}

export async function POST(request: NextRequest) {
  const admin = await requirePlatformStaff();
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
    await audit({
      action: "tier.change",
      userId: admin.id,
      resourceType: "users",
      resourceId: target.id,
      outcome: "failure",
      request,
      details: { from: target.tier, to: tier, error: (err as Error).message },
    });
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }

  const updated = await loadUser({ id: target.id });
  // Tier drives billing_mode + waba_mode, i.e. what this tenant is charged.
  await audit({
    action: "tier.change",
    userId: admin.id,
    resourceType: "users",
    resourceId: target.id,
    request,
    details: {
      target_email: target.email,
      from: { tier: target.tier, billing_mode: target.billing_mode, waba_mode: target.waba_mode },
      to: { tier: updated?.tier, billing_mode: updated?.billing_mode, waba_mode: updated?.waba_mode },
    },
  });
  return NextResponse.json({ user: updated ? redactMoney(updated, admin.canSeeMoney) : null });
}
