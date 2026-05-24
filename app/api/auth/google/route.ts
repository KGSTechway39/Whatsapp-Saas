/**
 * GET /api/auth/google?from=/dashboard
 *
 * Kicks off the Google OAuth flow. Sets a short-lived state cookie
 * (CSRF protection — verified on callback) and redirects to Google.
 */
import { NextRequest, NextResponse } from "next/server";
import { buildAuthUrl, makeState } from "@/lib/google-oauth";

const STATE_COOKIE = "wa_google_state";

export async function GET(req: NextRequest) {
  if (!process.env.GOOGLE_CLIENT_ID) {
    return NextResponse.json(
      { error: "Google login is not configured. Set GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET." },
      { status: 503 },
    );
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
