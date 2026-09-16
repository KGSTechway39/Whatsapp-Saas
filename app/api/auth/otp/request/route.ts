/**
 * POST /api/auth/otp/request   { phone }
 *
 * Step 1 of WhatsApp sign-in. If the number belongs to exactly one account, a
 * 6-digit code is sent from the SendAnjal platform number. The response is the
 * same whether or not an account exists, so this can't be used to discover
 * which numbers are registered. Every request is recorded (user_id NULL when
 * nothing was sent) so rate limits apply uniformly.
 *
 * The Meta call is made inline, like /api/v1/otp/request: the person is
 * waiting on this exact message and needs to know if it failed.
 */
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { checkRateLimit, AUTH_LIMIT, rateLimitHeaders } from "@/lib/rate-limit";
import { logger } from "@/lib/logger";
import {
  LOGIN_OTP_MAX_PER_HOUR,
  LOGIN_OTP_MAX_PER_IP_HOUR,
  LOGIN_OTP_MIN_GAP_MS,
  LOGIN_OTP_TTL_SECONDS,
  generateCode,
  hashCode,
  isWhatsAppOtpConfigured,
  maskPhone,
  normalizePhone,
  sendLoginOtp,
} from "@/lib/login-otp";

export async function POST(req: NextRequest) {
  if (!isWhatsAppOtpConfigured()) {
    return NextResponse.json({ error: "WhatsApp sign-in is not available right now." }, { status: 503 });
  }

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const rl = checkRateLimit(`otp-request:${ip}`, AUTH_LIMIT);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Too many attempts. Please wait a moment." },
      { status: 429, headers: rateLimitHeaders(rl) },
    );
  }

  const body = await req.json().catch(() => ({}));
  const phone = typeof body.phone === "string" ? normalizePhone(body.phone) : null;
  if (!phone) {
    return NextResponse.json({ error: "Enter a valid WhatsApp number." }, { status: 400 });
  }

  const supabase = createServiceClient();
  const hourAgo = new Date(Date.now() - 3600_000).toISOString();

  // ── Rate limits (DB-backed, so they hold across serverless instances) ─────
  const [{ data: recent }, { count: ipCount }] = await Promise.all([
    supabase
      .from("login_otp_codes")
      .select("created_at")
      .eq("phone", phone)
      .gte("created_at", hourAgo)
      .order("created_at", { ascending: false }),
    supabase
      .from("login_otp_codes")
      .select("id", { count: "exact", head: true })
      .eq("ip", ip)
      .gte("created_at", hourAgo),
  ]);

  if ((recent?.length ?? 0) >= LOGIN_OTP_MAX_PER_HOUR || (ipCount ?? 0) >= LOGIN_OTP_MAX_PER_IP_HOUR) {
    return NextResponse.json({ error: "Too many code requests. Please try again later." }, { status: 429 });
  }
  if (recent?.[0] && Date.now() - new Date(recent[0].created_at).getTime() < LOGIN_OTP_MIN_GAP_MS) {
    return NextResponse.json({ error: "Please wait a minute before requesting another code." }, { status: 429 });
  }

  // ── Resolve account ───────────────────────────────────────────────────────
  const { data: matches } = await supabase
    .from("users")
    .select("id")
    .eq("phone_normalized", phone)
    .limit(2);

  // Ambiguous (shared number) is treated like "no account": we can't know who to sign in.
  const userId = matches?.length === 1 ? matches[0].id : null;
  const code = generateCode();

  const { data: row, error: insertErr } = await supabase
    .from("login_otp_codes")
    .insert({
      phone,
      user_id:    userId,
      code_hash:  hashCode(phone, code),
      expires_at: new Date(Date.now() + LOGIN_OTP_TTL_SECONDS * 1000).toISOString(),
      ip,
    })
    .select("id")
    .single();

  if (insertErr || !row) {
    logger.error("Login OTP insert failed", { error: insertErr?.message });
    return NextResponse.json({ error: "Could not send a code. Please try again." }, { status: 500 });
  }

  if (userId) {
    try {
      await sendLoginOtp(phone, code);
      logger.info("Login OTP sent", { userId });
    } catch (err) {
      // Burn the row so the unsent code can never verify; it still counts toward limits.
      await supabase
        .from("login_otp_codes")
        .update({ consumed_at: new Date().toISOString() })
        .eq("id", row.id);
      logger.error("Login OTP send failed", { userId, error: err instanceof Error ? err.message : String(err) });
      return NextResponse.json(
        { error: "We couldn't deliver the code on WhatsApp. Please try again or use email." },
        { status: 502 },
      );
    }
  } else {
    logger.info("Login OTP requested for unknown number", { matches: matches?.length ?? 0 });
  }

  return NextResponse.json({
    sent:       true,
    phone:      maskPhone(phone),
    expires_in: LOGIN_OTP_TTL_SECONDS,
    message:    "If this number is linked to a SendAnjal account, you'll get a code on WhatsApp.",
  });
}
