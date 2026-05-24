/**
 * GET /api/auth/google/callback?code=…&state=…
 *
 * Google redirects back here after the user consents. We:
 *   1. Verify the state cookie matches (CSRF defence).
 *   2. Exchange the code for an id_token + parse the profile.
 *   3. Find an existing user by google_id OR by email → link or create.
 *   4. Issue our own JWT session cookie (same as password login).
 *   5. Redirect to the original `from` path.
 */
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { createSessionToken, SESSION_COOKIE } from "@/lib/auth";
import { exchangeCode, parseState } from "@/lib/google-oauth";
import { logger } from "@/lib/logger";

const STATE_COOKIE = "wa_google_state";

export async function GET(req: NextRequest) {
  const error = req.nextUrl.searchParams.get("error");
  if (error) {
    return NextResponse.redirect(new URL(`/login?error=${encodeURIComponent(error)}`, req.url));
  }

  const code  = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");
  if (!code || !state) {
    return NextResponse.redirect(new URL("/login?error=missing_code", req.url));
  }

  const cookieState = req.cookies.get(STATE_COOKIE)?.value;
  if (!cookieState || cookieState !== state) {
    logger.warn("Google OAuth state mismatch", { provided: state?.slice(0, 8), cookie: cookieState?.slice(0, 8) });
    return NextResponse.redirect(new URL("/login?error=state_mismatch", req.url));
  }

  // Exchange code for profile
  let profile;
  try {
    profile = await exchangeCode(code);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "google_exchange_failed";
    logger.error("Google code exchange failed", { error: msg });
    return NextResponse.redirect(new URL(`/login?error=${encodeURIComponent(msg)}`, req.url));
  }

  if (!profile.email_verified) {
    return NextResponse.redirect(new URL("/login?error=email_not_verified", req.url));
  }

  const supabase = createServiceClient();

  // Match by google_id first (stable across email changes), then by email.
  let userRow: { id: string; email: string; full_name: string; company_name: string; google_id: string | null; auth_provider: string } | null = null;

  const { data: byGoogle } = await supabase
    .from("users")
    .select("id, email, full_name, company_name, google_id, auth_provider")
    .eq("google_id", profile.sub)
    .maybeSingle();

  if (byGoogle) {
    userRow = byGoogle;
  } else {
    const { data: byEmail } = await supabase
      .from("users")
      .select("id, email, full_name, company_name, google_id, auth_provider")
      .eq("email", profile.email.toLowerCase())
      .maybeSingle();

    if (byEmail) {
      // Link Google to the existing email-based account.
      userRow = byEmail;
      const provider = byEmail.auth_provider === "password" ? "both" : byEmail.auth_provider || "google";
      await supabase
        .from("users")
        .update({
          google_id:     profile.sub,
          google_email:  profile.email,
          auth_provider: provider,
          avatar_url:    profile.picture || null,
          updated_at:    new Date().toISOString(),
        })
        .eq("id", byEmail.id);
    }
  }

  // No matching user — create one (Google-only, no password).
  if (!userRow) {
    const { data: created, error: insertErr } = await supabase
      .from("users")
      .insert({
        email:         profile.email.toLowerCase(),
        password_hash: null,
        full_name:     profile.name || profile.email.split("@")[0],
        company_name:  "",
        google_id:     profile.sub,
        google_email:  profile.email,
        auth_provider: "google",
        avatar_url:    profile.picture || null,
      })
      .select("id, email, full_name, company_name, google_id, auth_provider")
      .single();

    if (insertErr || !created) {
      logger.error("Google signup user-insert failed", { error: insertErr?.message });
      return NextResponse.redirect(new URL("/login?error=signup_failed", req.url));
    }
    userRow = created;

    // Mirror what password registration does — create a wallet row.
    await supabase.from("wallet").insert({ user_id: created.id, balance: 0, currency: "INR" }).then(() => {}, () => {});
  }

  // Issue our session cookie.
  const token = await createSessionToken({
    id:      userRow.id,
    email:   userRow.email,
    name:    userRow.full_name || profile.name || "",
    company: userRow.company_name || "",
  });

  const { from } = parseState(state);
  const res = NextResponse.redirect(new URL(from, req.url));
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure:   process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge:   60 * 60 * 24 * 7,
    path:     "/",
  });
  res.cookies.delete(STATE_COOKIE);

  logger.info("Google login success", { userId: userRow.id, linked: !!byGoogle });
  return res;
}
