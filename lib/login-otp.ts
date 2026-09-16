/**
 * WhatsApp OTP sign-in.
 *
 * Codes are sent from SendAnjal's OWN WhatsApp number (not a tenant's), using
 * an approved AUTHENTICATION-category template on the platform WABA. This is a
 * platform cost — it never touches a tenant wallet.
 *
 * Sender — set ONE of:
 *   PLATFORM_WA_NUMBER_ROW_ID     id of a connected whatsapp_numbers row (the platform's
 *                                 own number); its encrypted token is used, so a
 *                                 reconnect needs no env change. (preferred)
 *   PLATFORM_WA_PHONE_NUMBER_ID + PLATFORM_WA_ACCESS_TOKEN
 *                                 raw phone_number_id + system-user token
 * Optional:
 *   LOGIN_OTP_TEMPLATE_NAME       approved auth template (default: otp_verification)
 *   LOGIN_OTP_TEMPLATE_LANG       template language code (default: en)
 */

import { createHmac, randomInt, timingSafeEqual } from "crypto";
import { sendTemplateMessage } from "@/lib/meta";
import { createServiceClient } from "@/lib/supabase/server";
import { decrypt } from "@/lib/crypto";

export const LOGIN_OTP_TTL_SECONDS = 300;      // 5 min
export const LOGIN_OTP_MAX_PER_HOUR = 5;       // per phone
export const LOGIN_OTP_MAX_PER_IP_HOUR = 20;   // per IP
export const LOGIN_OTP_MIN_GAP_MS = 60_000;    // between requests for one phone

export function isWhatsAppOtpConfigured(): boolean {
  return !!(
    process.env.PLATFORM_WA_NUMBER_ROW_ID ||
    (process.env.PLATFORM_WA_PHONE_NUMBER_ID && process.env.PLATFORM_WA_ACCESS_TOKEN)
  );
}

async function resolveSender(): Promise<{ phoneNumberId: string; accessToken: string }> {
  const rowId = process.env.PLATFORM_WA_NUMBER_ROW_ID;
  if (!rowId) {
    return {
      phoneNumberId: process.env.PLATFORM_WA_PHONE_NUMBER_ID!,
      accessToken:   process.env.PLATFORM_WA_ACCESS_TOKEN!,
    };
  }
  // Explicitly configured platform number — looked up by id, not by tenant.
  const { data } = await createServiceClient()
    .from("whatsapp_numbers")
    .select("phone_number_id, access_token, status")
    .eq("id", rowId)
    .maybeSingle();
  if (!data?.phone_number_id || !data.access_token || data.status !== "active") {
    throw new Error("Platform WhatsApp number is missing or not active");
  }
  return { phoneNumberId: data.phone_number_id, accessToken: await decrypt(data.access_token) };
}

/**
 * Normalize user input to digits with country code, matching
 * users.phone_normalized. A bare 10-digit number is treated as Indian (+91).
 * Returns null if it can't be a valid phone number.
 */
export function normalizePhone(input: string): string | null {
  let digits = input.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("0")) digits = digits.slice(1);
  if (digits.length === 10) digits = `91${digits}`;
  if (!/^[1-9]\d{9,14}$/.test(digits)) return null;
  return digits;
}

/** Mask a phone for UI/logs: 919876543210 → +91 ••••••3210 */
export function maskPhone(digits: string): string {
  return `+${digits.slice(0, digits.length - 10)} ••••••${digits.slice(-4)}`;
}

export function generateCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

/**
 * Keyed hash. A plain sha256 of a 6-digit code is reversible by trying all
 * 1M values, so the hash is bound to the server secret and the phone.
 */
export function hashCode(phone: string, code: string): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("JWT_SECRET is not set");
  return createHmac("sha256", secret).update(`login-otp:${phone}:${code}`).digest("hex");
}

export function codeMatches(phone: string, code: string, storedHash: string): boolean {
  const a = Buffer.from(hashCode(phone, code), "hex");
  const b = Buffer.from(storedHash, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Send the code via the platform number's authentication template. */
export async function sendLoginOtp(phone: string, code: string): Promise<void> {
  if (!isWhatsAppOtpConfigured()) throw new Error("WhatsApp OTP login is not configured");
  const sender = await resolveSender();
  await sendTemplateMessage({
    ...sender,
    to:            phone,
    templateName:  process.env.LOGIN_OTP_TEMPLATE_NAME || "otp_verification",
    languageCode:  process.env.LOGIN_OTP_TEMPLATE_LANG || "en",
    // Authentication template: body {{1}} = code, copy-code button = code.
    components: [
      { type: "body", parameters: [{ type: "text", text: code }] },
      { type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: code }] },
    ],
  });
}
