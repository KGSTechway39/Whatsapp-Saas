/**
 * POST /api/meta/save-account
 *
 * Step 2 of Embedded Signup. Reads the cached plaintext token associated
 * with `transferId`, encrypts it, and persists rows in:
 *   • whatsapp_accounts
 *   • phone_numbers
 *   • access_tokens (via rotate_access_token RPC)
 *
 * The token cache entry is consumed (one-shot) so a single `transferId`
 * cannot save multiple accounts.
 *
 * Body    : { transferId: string, wabaId: string, phoneNumberId: string,
 *             businessId?: string, businessName?: string }
 * Returns : { accountId, phoneRowId, refreshed }
 */

import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";
import { logger } from "@/lib/logger";
import { audit } from "@/lib/audit";
import { consumeTokenFromCache } from "@/lib/whatsapp/token-cache";
import { resolveOrgId, saveAccount } from "@/lib/whatsapp/onboarding-repo";
import type { MetaPhoneNumber, MetaWaba } from "@/lib/meta-client";

interface SaveAccountRequest {
  transferId?: string;
  wabaId?: string;
  phoneNumberId?: string;
  businessId?: string;
  businessName?: string;
  // optional payload echoed from exchange-token response so we don't need
  // to re-discover the phone metadata
  phone?: {
    displayPhoneNumber?: string;
    verifiedName?: string;
    qualityRating?: string;
    status?: string;
    codeVerificationStatus?: string;
  };
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: SaveAccountRequest;
  try {
    body = (await req.json()) as SaveAccountRequest;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const transferId    = body.transferId?.trim();
  const wabaId        = body.wabaId?.trim();
  const phoneNumberId = body.phoneNumberId?.trim();
  if (!transferId || !wabaId || !phoneNumberId) {
    return NextResponse.json(
      { error: "transferId, wabaId, and phoneNumberId are required", code: "MISSING_FIELDS" },
      { status: 400 },
    );
  }

  const cached = consumeTokenFromCache(transferId);
  if (!cached) {
    return NextResponse.json(
      { error: "Transfer expired or already consumed. Restart signup.", code: "TRANSFER_EXPIRED" },
      { status: 410 },
    );
  }
  if (cached.userId !== user.id) {
    logger.warn("[api/meta/save-account] user mismatch on transferId", {
      cachedUserId: cached.userId,
      currentUserId: user.id,
    });
    return NextResponse.json(
      { error: "Transfer not owned by current user", code: "FORBIDDEN" },
      { status: 403 },
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

  // Refuse cross-org takeover.
  const { data: existingForPhone } = await supabase
    .from("whatsapp_accounts")
    .select("id, organization_id")
    .eq("phone_number_id", phoneNumberId)
    .maybeSingle();
  if (existingForPhone && existingForPhone.organization_id !== orgId) {
    await audit({
      action: "embedded_signup.failure",
      userId: user.id,
      organizationId: orgId,
      outcome: "failure",
      details: { stage: "save_account", reason: "PHONE_OWNED_BY_OTHER_ORG", phoneNumberId },
      request: req,
    });
    return NextResponse.json(
      { error: "This phone number is already connected to another workspace.", code: "PHONE_TAKEN" },
      { status: 409 },
    );
  }

  const waba: MetaWaba = {
    id: wabaId,
    name: body.businessName,
    business_id: body.businessId,
  };
  const phone: MetaPhoneNumber = {
    id: phoneNumberId,
    display_phone_number: body.phone?.displayPhoneNumber ?? phoneNumberId,
    verified_name: body.phone?.verifiedName,
    quality_rating: body.phone?.qualityRating,
    status: body.phone?.status,
    code_verification_status: body.phone?.codeVerificationStatus,
  };

  const tokenExpiresAt = cached.expiresInSeconds
    ? new Date(Date.now() + cached.expiresInSeconds * 1000).toISOString()
    : null;

  let saved;
  try {
    saved = await saveAccount({
      organizationId: orgId,
      waba,
      phone,
      accessToken: cached.token,
      tokenExpiresAt,
      systemUserId: cached.systemUserId,
      scopes: cached.scopes,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "DB write failed";
    logger.error("[api/meta/save-account] save failed", { userId: user.id, msg });
    await audit({
      action: "embedded_signup.failure",
      userId: user.id,
      organizationId: orgId,
      outcome: "failure",
      details: { stage: "save_account", msg },
      request: req,
    });
    return NextResponse.json({ error: msg, code: "DB_ERROR" }, { status: 500 });
  }

  await audit({
    action: "embedded_signup.save_account",
    userId: user.id,
    organizationId: orgId,
    resourceType: "whatsapp_account",
    resourceId: saved.accountId,
    details: { wabaId, phoneNumberId, refreshed: saved.refreshed },
    request: req,
  });

  return NextResponse.json(
    {
      accountId: saved.accountId,
      phoneRowId: saved.phoneRowId,
      refreshed: saved.refreshed,
    },
    { status: saved.refreshed ? 200 : 201 },
  );
}
