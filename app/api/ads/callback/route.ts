import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import {
  exchangeCodeForToken,
  exchangeForLongLivedToken,
  listAdAccounts,
} from "@/lib/meta-ads";

// GET /api/ads/callback?code=...&state=...
// Handles the OAuth redirect from Facebook, exchanges the code for a token,
// fetches ad accounts, persists them, then redirects back to /ads.
export async function GET(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.redirect(new URL("/login", req.url));

  const code = req.nextUrl.searchParams.get("code");
  const error = req.nextUrl.searchParams.get("error_description") || req.nextUrl.searchParams.get("error");
  if (error) {
    return NextResponse.redirect(new URL(`/ads?error=${encodeURIComponent(error)}`, req.url));
  }
  if (!code) {
    return NextResponse.redirect(new URL("/ads?error=missing_code", req.url));
  }

  try {
    const redirectUri = `${req.nextUrl.origin}/api/ads/callback`;
    const short = await exchangeCodeForToken(code, redirectUri);
    const long  = await exchangeForLongLivedToken(short.access_token).catch(() => short);
    const expiresAt = "expires_in" in long
      ? new Date(Date.now() + long.expires_in * 1000).toISOString()
      : null;

    const accounts = await listAdAccounts(long.access_token);
    if (accounts.length === 0) {
      return NextResponse.redirect(new URL("/ads?error=no_accounts", req.url));
    }

    const supabase = createClient();
    await supabase.from("ad_accounts").upsert(
      accounts.map((a) => ({
        user_id: user.id,
        fb_account_id: a.id,
        account_name: a.name,
        business_id: a.business?.id || null,
        currency: a.currency || "INR",
        access_token: long.access_token,
        token_expires_at: expiresAt,
        status: a.account_status === 1 ? "active" : "expired",
        last_synced_at: new Date().toISOString(),
      })),
      { onConflict: "user_id,fb_account_id" },
    );

    return NextResponse.redirect(new URL("/ads?connected=1", req.url));
  } catch (err) {
    const msg = err instanceof Error ? err.message : "callback_failed";
    return NextResponse.redirect(new URL(`/ads?error=${encodeURIComponent(msg)}`, req.url));
  }
}
