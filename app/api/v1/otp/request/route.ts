import { NextRequest, NextResponse } from "next/server";
import { createHash, randomInt, randomUUID } from "crypto";
import { createServiceClient } from "@/lib/supabase/server";
import { withApiAuth, ApiAuthError } from "@/lib/api-keys";
import { sendTemplateMessage } from "@/lib/meta";
import { guardedSingleSend } from "@/lib/billing/guarded-send";
import { InsufficientBalanceError } from "@/lib/billing/wallet";

/**
 * POST /api/v1/otp/request   { to, template_name? }
 *
 * Step 1 of the resume-delivery verification sequence:
 *   request OTP → user enters code → POST /api/v1/otp/verify → POST /messages/send.
 *
 * Generates a 6-digit code, sends it via an APPROVED authentication-category
 * template (through the unmodified lib/meta.ts sender, billed as AUTHENTICATION
 * for managed tenants), and stores ONLY the SHA-256 hash with a 5-min expiry.
 * Raw codes are never stored or logged.
 *
 * Returns: { sent: true, expires_in: 300 }
 */

const E164 = /^\+?[1-9]\d{7,14}$/;
const TTL_SECONDS = 300;            // 5 min
const MAX_PER_HOUR = 5;
const MIN_GAP_MS = 60_000;          // 1 min between requests
const DEFAULT_TEMPLATE = process.env.OTP_TEMPLATE_NAME || "otp_verification";

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

export async function POST(req: NextRequest) {
  try {
    const ctx = await withApiAuth(req, "messages:write");
    const body = await req.json().catch(() => ({}));

    const rawTo = typeof body.to === "string" ? body.to.trim() : "";
    if (!E164.test(rawTo)) {
      return NextResponse.json({ error: "`to` must be a valid E.164 phone number", code: "VALIDATION_ERROR" }, { status: 400 });
    }
    const to = rawTo.replace(/\D/g, "");
    const supabase = createServiceClient();

    // ── Per-number rate limiting ───────────────────────────────────────────
    const { data: recent } = await supabase
      .from("otp_codes")
      .select("created_at")
      .eq("user_id", ctx.userId)
      .eq("phone", to)
      .gte("created_at", new Date(Date.now() - 3600_000).toISOString())
      .order("created_at", { ascending: false });

    if (recent && recent.length >= MAX_PER_HOUR) {
      return NextResponse.json({ error: "Too many OTP requests for this number. Try later.", code: "RATE_LIMITED" }, { status: 429 });
    }
    if (recent?.[0] && Date.now() - new Date(recent[0].created_at).getTime() < MIN_GAP_MS) {
      return NextResponse.json({ error: "Please wait before requesting another code.", code: "RATE_LIMITED" }, { status: 429 });
    }

    // ── Resolve sending number ─────────────────────────────────────────────
    const { data: number } = await supabase
      .from("whatsapp_numbers")
      .select("phone_number_id, access_token, status")
      .eq("user_id", ctx.userId)
      .eq("status", "active")
      .order("is_primary", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!number?.phone_number_id || !number?.access_token) {
      return NextResponse.json({ error: "No active WhatsApp number connected", code: "NO_ACTIVE_NUMBER" }, { status: 400 });
    }

    // ── Generate code (never logged) + send via auth template ──────────────
    const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
    const templateName = typeof body.template_name === "string" && body.template_name ? body.template_name : DEFAULT_TEMPLATE;
    // WhatsApp authentication template: body param = the code, copy-code button = the code.
    const components = [
      { type: "body", parameters: [{ type: "text", text: code }] },
      { type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: code }] },
    ];

    try {
      await guardedSingleSend({
        userId: ctx.userId,
        category: "AUTHENTICATION",
        idempotencyKey: `otp:${req.headers.get("idempotency-key") || body.idempotency_key || randomUUID()}`,
        referenceId: to,
        description: "OTP verification",
        send: () =>
          sendTemplateMessage({
            phoneNumberId: number.phone_number_id,
            accessToken: number.access_token,
            to,
            templateName,
            languageCode: body.language || "en",
            components,
          }),
      });
    } catch (sendErr) {
      if (sendErr instanceof InsufficientBalanceError) {
        return NextResponse.json({ error: "Insufficient wallet balance", code: "INSUFFICIENT_BALANCE" }, { status: 402 });
      }
      const msg = sendErr instanceof Error ? sendErr.message : "Failed to send OTP";
      return NextResponse.json({ error: msg, code: "SEND_FAILED" }, { status: 502 });
    }

    // ── Persist hash only, after a successful send ─────────────────────────
    await supabase.from("otp_codes").insert({
      user_id: ctx.userId,
      phone: to,
      code_hash: sha256(code),
      expires_at: new Date(Date.now() + TTL_SECONDS * 1000).toISOString(),
    });

    return NextResponse.json({ sent: true, expires_in: TTL_SECONDS }, { status: 201 });
  } catch (e) {
    if (e instanceof ApiAuthError) return NextResponse.json({ error: e.message, code: e.code }, { status: e.status });
    return NextResponse.json({ error: e instanceof Error ? e.message : "Internal error", code: "INTERNAL" }, { status: 500 });
  }
}
