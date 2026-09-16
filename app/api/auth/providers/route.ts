/**
 * GET /api/auth/providers
 *
 * Which sign-in methods are configured on this deployment, so the login page
 * only shows buttons that work. Returns booleans only — never the config.
 */
import { NextResponse } from "next/server";
import { isGoogleConfigured } from "@/lib/google-oauth";
import { isWhatsAppOtpConfigured } from "@/lib/login-otp";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    google:   isGoogleConfigured(),
    whatsapp: isWhatsAppOtpConfigured(),
  });
}
