/**
 * POST /api/meta/manual-connect
 *
 * Lets a user connect WhatsApp by pasting credentials directly from
 * Meta's Quickstart panel — bypasses Embedded Signup so people can ship
 * before their config_id is approved.
 *
 * The route verifies the token by calling Graph for the WABA and phone,
 * encrypts it, and persists rows in:
 *   • whatsapp_accounts
 *   • phone_numbers
 *   • access_tokens (via rotate_access_token RPC)
 *
 * Body    : { wabaId, phoneNumberId, accessToken, businessId?, businessName? }
 * Returns : { accountId, phoneNumberId, displayPhoneNumber, businessName }
 */

import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";
import { logger } from "@/lib/logger";
import { audit } from "@/lib/audit";
import {
  MetaApiError,
  graphGet,
  type MetaPhoneNumber,
  type MetaWaba,
} from "@/lib/meta-client";
import { resolveOrgId, saveAccount } from "@/lib/whatsapp/onboarding-repo";

interface ManualRequest {
  wabaId?: string;
  phoneNumberId?: string;
  accessToken?: string;
  businessId?: string;
  businessName?: string;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: ManualRequest;
  try {
    body = (await req.json()) as ManualRequest;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const wabaId        = body.wabaId?.trim();
  const phoneNumberId = body.phoneNumberId?.trim();
  const accessToken   = body.accessToken?.trim();
  if (!wabaId || !phoneNumberId || !accessToken) {
    return NextResponse.json(
      { error: "wabaId, phoneNumberId, and accessToken are required", code: "MISSING_FIELDS" },
      { status: 400 },
    );
  }

  // 1) Verify the token actually has access to the WABA and phone.
  let phoneInfo: MetaPhoneNumber;
  let wabaInfo: MetaWaba;
  try {
    [wabaInfo, phoneInfo] = await Promise.all([
      graphGet<MetaWaba>(`/${wabaId}`, accessToken, { fields: "id,name" }),
      graphGet<MetaPhoneNumber>(`/${phoneNumberId}`, accessToken, {
        fields: "id,display_phone_number,verified_name,quality_rating,status,code_verification_status",
      }),
    ]);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Verification failed";
    const status = err instanceof MetaApiError ? err.httpStatus : 400;
    const code = err instanceof MetaApiError ? err.code : "GRAPH_VERIFY_FAILED";
    logger.warn("[api/meta/manual-connect] verify failed", {
      userId: user.id, wabaId, phoneNumberId, msg,
    });
    await audit({
      action: "embedded_signup.failure",
      userId: user.id,
      outcome: "failure",
      details: { stage: "manual_verify", wabaId, phoneNumberId, msg },
      request: req,
    });
    return NextResponse.json({ error: msg, code }, { status });
  }

  // Sanity: phone_number_id we got from Meta must equal what the user pasted
  if (phoneInfo.id !== phoneNumberId) {
    return NextResponse.json(
      { error: "Phone Number ID mismatch — Meta returned a different ID", code: "ID_MISMATCH" },
      { status: 400 },
    );
  }

  const supabase = createServiceClient();
  const orgId = await resolveOrgId(supabase, user.id, body.businessName || user.company || user.name);
  if (!orgId) {
    return NextResponse.json(
      { error: "Failed to resolve organization", code: "NO_ORG" },
      { status: 500 },
    );
  }

  // 2) Refuse cross-tenant takeover — block if another user already owns this phone.
  const { data: existingForPhone } = await supabase
    .from("whatsapp_numbers")
    .select("id, user_id")
    .eq("phone_number_id", phoneNumberId)
    .neq("user_id", orgId)
    .limit(1)
    .maybeSingle();
  if (existingForPhone) {
    await audit({
      action: "embedded_signup.failure",
      userId: user.id,
      organizationId: orgId,
      outcome: "failure",
      details: { stage: "manual_save", reason: "PHONE_OWNED_BY_OTHER_ORG", phoneNumberId },
      request: req,
    });
    return NextResponse.json(
      { error: "This phone number is already connected to another workspace.", code: "PHONE_TAKEN" },
      { status: 409 },
    );
  }

  // 3) Persist via the shared repo helper
  const waba: MetaWaba = {
    id: wabaId,
    name: body.businessName || wabaInfo.name,
    business_id: body.businessId,
  };

  try {
    const saved = await saveAccount({
      organizationId: orgId,
      waba,
      phone: phoneInfo,
      accessToken,
      // Manual tokens are typically temporary (24h) — assume that unless caller indicates otherwise.
      tokenExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      systemUserId: null,
      scopes: ["whatsapp_business_messaging"],
    });

    await audit({
      action: "embedded_signup.save_account",
      userId: user.id,
      organizationId: orgId,
      resourceType: "whatsapp_account",
      resourceId: saved.accountId,
      details: { wabaId, phoneNumberId, manual: true, refreshed: saved.refreshed },
      request: req,
    });

    logger.info("[api/meta/manual-connect] success", {
      userId: user.id, orgId, accountId: saved.accountId,
    });

    return NextResponse.json({
      accountId: saved.accountId,
      phoneNumberId: phoneInfo.id,
      displayPhoneNumber: phoneInfo.display_phone_number,
      businessName: phoneInfo.verified_name || waba.name || null,
      refreshed: saved.refreshed,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Save failed";
    logger.error("[api/meta/manual-connect] save failed", { userId: user.id, msg });
    return NextResponse.json({ error: msg, code: "DB_ERROR" }, { status: 500 });
  }
}
