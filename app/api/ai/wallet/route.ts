/**
 * AI Credits balance for the current user — feeds the "AI Credits remaining"
 * indicator (styled like the message-credit indicator). Read-only; the balance
 * is authoritative in Postgres (migration 024). Also returns the user's tier so
 * the UI can show/hide sparkle entry points (server-side gating still enforces).
 */
import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { getBalance } from "@/lib/ai/wallet";
import { getUserTier } from "@/lib/ai/config";

export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const [credits, tier] = await Promise.all([
    getBalance(user.id).catch(() => 0),
    getUserTier(user.id).catch(() => "starter" as const),
  ]);
  return NextResponse.json({ credits, tier });
}
