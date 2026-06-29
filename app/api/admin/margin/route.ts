/**
 * Admin: per-client revenue & margin (platform-owner only).
 *
 * Margin comes from the ledger trail written on managed debits (migration 017):
 *   message margin = Σ(charged) − Σ(wholesale)  over rows where wholesale is known.
 * Platform fees (subscription/onboarding/add-ons) are summed separately from
 * `platform_charges` — they are revenue, not message margin.
 *
 *   GET ?userId=<id>  → { margin: { ... } }   (403 for non-admins)
 *
 * Gated by requireAdmin() (ADMIN_EMAILS allowlist).
 */
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";

interface DebitRow {
  amount_paise: number | null;
  wholesale_paise: number | null;
}

export async function GET(request: NextRequest) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const userId = request.nextUrl.searchParams.get("userId")?.trim();
  if (!userId) {
    return NextResponse.json({ error: "userId is required" }, { status: 400 });
  }

  const supabase = createServiceClient();

  // Managed debits carry the margin trail. wholesale_paise may be absent on rows
  // sent before 017 / via override pricing — those count toward spend but not margin.
  let rows: DebitRow[] = [];
  const { data, error } = await supabase
    .from("transactions")
    .select("amount_paise, wholesale_paise")
    .eq("user_id", userId)
    .eq("entry_type", "debit")
    .limit(10000);
  if (!error && data) rows = data as DebitRow[];

  let messageChargedPaise = 0; // total wallet spend on sends
  let trackedChargedPaise = 0; // charged on rows where cost is known
  let messageCostPaise = 0;    // Meta wholesale on those rows
  let messageCount = 0;
  let trackedCount = 0;

  for (const r of rows) {
    const charged = Math.abs(Number(r.amount_paise) || 0);
    messageChargedPaise += charged;
    messageCount += 1;
    if (r.wholesale_paise !== null && r.wholesale_paise !== undefined) {
      trackedChargedPaise += charged;
      messageCostPaise += Number(r.wholesale_paise) || 0;
      trackedCount += 1;
    }
  }
  const messageMarginPaise = trackedChargedPaise - messageCostPaise;

  // Platform fees (revenue, separate from the message wallet). Soft-fail pre-017.
  let platformPaidPaise = 0;
  const { data: charges } = await supabase
    .from("platform_charges")
    .select("amount_paise")
    .eq("user_id", userId)
    .eq("status", "paid")
    .limit(10000);
  if (charges) {
    for (const c of charges as { amount_paise: number | null }[]) {
      platformPaidPaise += Number(c.amount_paise) || 0;
    }
  }

  return NextResponse.json({
    margin: {
      messageChargedPaise,
      messageCostPaise,
      messageMarginPaise,
      messageCount,
      trackedCount,
      platformPaidPaise,
      totalRevenuePaise: messageMarginPaise + platformPaidPaise,
    },
  });
}
