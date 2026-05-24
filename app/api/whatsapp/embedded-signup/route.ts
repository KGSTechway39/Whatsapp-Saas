/**
 * POST /api/whatsapp/embedded-signup
 *
 * Receives the Facebook Login for Business callback (code + waba_id +
 * phone_number_id from sessionInfo v2), exchanges the code for a long-lived
 * Meta token, fetches every WABA + phone number granted, subscribes the
 * webhook, and persists rows in `whatsapp_numbers` scoped by user_id.
 *
 * Tokens are encrypted at rest via lib/crypto.ts.
 *
 * Body: { code: string; wabaId?: string; phoneNumberId?: string }
 */
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getSessionUser } from "@/lib/auth";
import {
  exchangeCodeForToken,
  extendToken,
  getWABAsForToken,
  subscribeWABAToApp,
} from "@/lib/meta";
import { encrypt } from "@/lib/crypto";
import { logger } from "@/lib/logger";

export async function POST(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: { code?: string; wabaId?: string; phoneNumberId?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { code, wabaId: hintWabaId, phoneNumberId: hintPhoneNumberId } = body;
  if (!code) {
    return NextResponse.json({ error: "Authorization code is required" }, { status: 400 });
  }

  // 1) Exchange code → long-lived token (~60 days).
  let userToken: string;
  try {
    const shortToken = await exchangeCodeForToken(code);
    userToken = await extendToken(shortToken);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Token exchange failed", code: "TOKEN_EXCHANGE_FAILED" },
      { status: 400 },
    );
  }

  // 2) Fetch all WABAs + phones the token grants access to.
  let wabas: Awaited<ReturnType<typeof getWABAsForToken>>;
  try {
    wabas = await getWABAsForToken(userToken);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to fetch WhatsApp accounts", code: "GRAPH_API_ERROR" },
      { status: 502 },
    );
  }

  if (!wabas.length) {
    return NextResponse.json(
      { error: "No WhatsApp Business Accounts found. Make sure you granted access during signup.", code: "NO_WABA" },
      { status: 400 },
    );
  }

  const supabase = createClient();
  const tokenExpiresAt = new Date(Date.now() + 60 * 24 * 3600 * 1000).toISOString();
  const encryptedToken = await encrypt(userToken);

  const connected: {
    id: string;
    displayPhoneNumber: string;
    businessName: string | null;
    wabaId: string;
    status: string;
    updated?: boolean;
  }[] = [];

  for (const waba of wabas) {
    if (hintWabaId && waba.id !== hintWabaId) continue;

    // 3) Subscribe WABA to our Meta App so webhook events flow back.
    try {
      await subscribeWABAToApp(waba.id, userToken);
    } catch (err) {
      // Non-fatal: subscription may already exist.
      logger.warn("WABA subscribe warning", {
        wabaId: waba.id,
        msg: err instanceof Error ? err.message : String(err),
      });
    }

    for (const phone of waba.phoneNumbers) {
      if (hintPhoneNumberId && phone.id !== hintPhoneNumberId) continue;

      // 4) Upsert into whatsapp_numbers (single-tenant, user_id scoped).
      const { data: existing } = await supabase
        .from("whatsapp_numbers")
        .select("id")
        .eq("user_id", user.id)
        .eq("phone_number_id", phone.id)
        .maybeSingle();

      const status = phone.status === "VERIFIED" ? "active" : "inactive";

      if (existing) {
        await supabase
          .from("whatsapp_numbers")
          .update({
            phone_number: phone.display_phone_number,
            display_name: phone.verified_name || phone.display_phone_number,
            waba_id: waba.id,
            access_token: encryptedToken,
            token_encrypted: true,
            token_expires_at: tokenExpiresAt,
            status,
            updated_at: new Date().toISOString(),
          })
          .eq("id", existing.id);

        connected.push({
          id: existing.id,
          displayPhoneNumber: phone.display_phone_number,
          businessName: phone.verified_name ?? waba.name,
          wabaId: waba.id,
          status,
          updated: true,
        });
        continue;
      }

      // First number connected for this user → mark as primary.
      const { count } = await supabase
        .from("whatsapp_numbers")
        .select("*", { count: "exact", head: true })
        .eq("user_id", user.id);

      const isPrimary = (count ?? 0) === 0;

      const { data: inserted, error: insertErr } = await supabase
        .from("whatsapp_numbers")
        .insert({
          user_id: user.id,
          phone_number: phone.display_phone_number,
          display_name: phone.verified_name || phone.display_phone_number,
          waba_id: waba.id,
          phone_number_id: phone.id,
          access_token: encryptedToken,
          token_encrypted: true,
          token_expires_at: tokenExpiresAt,
          status,
          is_primary: isPrimary,
          webhook_verified: false,
        })
        .select("id, phone_number, display_name, status")
        .single();

      if (insertErr) {
        logger.error("Embedded signup insert failed", { error: insertErr.message, userId: user.id });
        return NextResponse.json({ error: insertErr.message, code: "DB_ERROR" }, { status: 500 });
      }

      connected.push({
        id: inserted!.id,
        displayPhoneNumber: inserted!.phone_number,
        businessName: inserted!.display_name,
        wabaId: waba.id,
        status: inserted!.status,
      });
    }
  }

  if (!connected.length) {
    return NextResponse.json(
      { error: "No phone numbers were connected. Check WABA + phone access in Meta Business Manager.", code: "NO_PHONES" },
      { status: 400 },
    );
  }

  logger.info("Embedded Signup completed", {
    userId: user.id,
    connectedCount: connected.length,
    accountIds: connected.map((c) => c.id),
  });

  return NextResponse.json({ connected }, { status: 201 });
}
