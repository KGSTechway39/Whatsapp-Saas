/**
 * GET /api/auth/google?from=/dashboard
 *
 * Kicks off the Google OAuth flow. Sets a short-lived state cookie
 * (CSRF protection — verified on callback) and redirects to Google.
 */
import { NextRequest, NextResponse } from "next/server";
import { buildAuthUrl, isGoogleConfigured, makeState } from "@/lib/google-oauth";

const STATE_COOKIE = "wa_google_state";

export async function GET(req: NextRequest) {
  // Send people back to the login page with a readable message, not raw JSON.
  if (!isGoogleConfigured()) {
    return NextResponse.redirect(new URL("/login?error=google_not_configured", req.url));
  }

  const from = req.nextUrl.searchParams.get("from");
  const state = makeState(from);
  const url = buildAuthUrl(state);

  const res = NextResponse.redirect(url);
  res.cookies.set(STATE_COOKIE, state, {
    httpOnly: true,
    secure:   process.env.NODE_ENV === "production",
    sameSite: "lax",
    path:     "/",
    maxAge:   60 * 10,                  // 10 min
  });
  return res;
}
