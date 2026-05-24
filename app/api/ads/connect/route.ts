import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import {
  buildOAuthUrl,
  exchangeForLongLivedToken,
  listAdAccounts,
  MetaAdsError,
} from "@/lib/meta-ads";

// ── GET /api/ads/connect → returns the OAuth URL the client should redirect to.
export async function GET(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (!process.env.NEXT_PUBLIC_META_APP_ID) {
    return NextResponse.json({ error: "Meta App ID not configured" }, { status: 503 });
  }

  const origin = req.nextUrl.origin;
  const state = Buffer.from(`${user.id}:${Date.now()}`).toString("base64url");
  const url = buildOAuthUrl(`${origin}/api/ads/callback`, state);

  return NextResponse.json({ url });
}

// ── POST /api/ads/connect — manual token connection (alternative to OAuth).
//    Body: { accessToken: string }
//    Useful when the user pastes a long-lived token from Meta Business Suite.
export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { accessToken } = await req.json();
  if (!accessToken?.trim()) {
    return NextResponse.json({ error: "accessToken is required" }, { status: 400 });
  }

  try {
    // Try to upgrade to long-lived (no-op if already long-lived).
    let token = accessToken;
    let expiresAt: string | null = null;
    try {
      const ll = await exchangeForLongLivedToken(accessToken);
      token = ll.access_token;
      expiresAt = new Date(Date.now() + ll.expires_in * 1000).toISOString();
    } catch {
      // Already long-lived or invalid — fall through, listAdAccounts will validate.
    }

    const accounts = await listAdAccounts(token);
    if (accounts.length === 0) {
      return NextResponse.json({ error: "No ad accounts found for this token" }, { status: 400 });
    }

    const supabase = createClient();
    const rows = accounts.map((a) => ({
      user_id: user.id,
      fb_account_id: a.id,
      account_name: a.name,
      business_id: a.business?.id || null,
      currency: a.currency || "INR",
      access_token: token,
      token_expires_at: expiresAt,
      status: a.account_status === 1 ? "active" : "expired",
      last_synced_at: new Date().toISOString(),
    }));

    const { data, error } = await supabase
      .from("ad_accounts")
      .upsert(rows, { onConflict: "user_id,fb_account_id" })
      .select();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({ connected: data.length, accounts: data });
  } catch (err) {
    if (err instanceof MetaAdsError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json({ error: err instanceof Error ? err.message : "Connection failed" }, { status: 500 });
  }
}
