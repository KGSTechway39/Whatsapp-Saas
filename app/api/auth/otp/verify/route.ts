/**
 * POST /api/auth/otp/verify   { phone, code }
 *
 * Step 2 of WhatsApp sign-in. Checks the latest live code for the number,
 * single-use and attempt-capped, then issues the same session cookie as
 * password login. Every guess bumps `attempts` with an optimistic lock
 * before the code is compared, so parallel guesses can't exceed the cap.
 */
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { createSessionToken, SESSION_COOKIE } from "@/lib/auth";
import { checkRateLimit, AUTH_LIMIT, rateLimitHeaders } from "@/lib/rate-limit";
import { logger } from "@/lib/logger";
import { codeMatches, normalizePhone } from "@/lib/login-otp";

const INVALID = "That code is incorrect or has expired.";

export async function POST(req: NextRequest) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const rl = checkRateLimit(`otp-verify:${ip}`, AUTH_LIMIT);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Too many attempts. Please wait a moment." },
      { status: 429, headers: rateLimitHeaders(rl) },
    );
  }

  const body = await req.json().catch(() => ({}));
  const phone = typeof body.phone === "string" ? normalizePhone(body.phone) : null;
  const code = typeof body.code === "string" ? body.code.trim() : "";
  if (!phone || !/^\d{6}$/.test(code)) {
    return NextResponse.json({ error: "Enter the 6-digit code from WhatsApp." }, { status: 400 });
  }

  const supabase = createServiceClient();

  const { data: row } = await supabase
    .from("login_otp_codes")
    .select("id, user_id, code_hash, attempts, max_attempts")
    .eq("phone", phone)
    .is("consumed_at", null)
    .gte("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!row) {
    return NextResponse.json({ error: INVALID }, { status: 401 });
  }
  if (row.attempts >= row.max_attempts) {
    return NextResponse.json({ error: "Too many wrong attempts. Request a new code." }, { status: 429 });
  }

  // Count this guess first (optimistic lock on the attempts we read).
  const { data: counted } = await supabase
    .from("login_otp_codes")
    .update({ attempts: row.attempts + 1 })
    .eq("id", row.id)
    .eq("attempts", row.attempts)
    .select("id");
  if (!counted?.length) {
    return NextResponse.json({ error: "Please try again." }, { status: 409 });
  }

  if (!row.user_id || !codeMatches(phone, code, row.code_hash)) {
    return NextResponse.json({ error: INVALID }, { status: 401 });
  }

  // Single-use: only one request can flip consumed_at.
  const { data: consumed } = await supabase
    .from("login_otp_codes")
    .update({ consumed_at: new Date().toISOString() })
    .eq("id", row.id)
    .is("consumed_at", null)
    .select("id");
  if (!consumed?.length) {
    return NextResponse.json({ error: INVALID }, { status: 401 });
  }

  const { data: user } = await supabase
    .from("users")
    .select("id, email, full_name, company_name")
    .eq("id", row.user_id)
    .maybeSingle();
  if (!user) {
    return NextResponse.json({ error: INVALID }, { status: 401 });
  }

  const token = await createSessionToken({
    id:      user.id,
    email:   user.email,
    name:    user.full_name,
    company: user.company_name,
  });

  const res = NextResponse.json({
    user: { id: user.id, email: user.email, name: user.full_name, company: user.company_name },
  });
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure:   process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge:   60 * 60 * 24 * 7,
    path:     "/",
  });

  logger.info("User logged in via WhatsApp OTP", { userId: user.id });
  return res;
}
