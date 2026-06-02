/**
 * GET /api/meta/accounts
 *
 * Lists every WhatsApp account connected to the caller's active
 * organization, joined with phone_numbers + webhook_subscriptions.
 * Tokens are never returned — only metadata + status.
 */

import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";
import { resolveOrgId } from "@/lib/whatsapp/onboarding-repo";
import { audit } from "@/lib/audit";

export async function GET(req: NextRequest): Promise<NextResponse> {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const supabase = createServiceClient();
  const orgId = await resolveOrgId(supabase, user.id, user.company || user.name);
  if (!orgId) {
    return NextResponse.json({ accounts: [] });
  }

  const { data, error } = await supabase
    .from("whatsapp_accounts")
    .select(`
      id,
      waba_id,
      business_id,
      system_user_id,
      display_phone_number,
      business_name,
      profile_name,
      quality_rating,
      messaging_tier,
      status,
      webhook_verified,
      token_expires_at,
      created_at,
      updated_at,
      phone_numbers!phone_numbers_whatsapp_account_id_fkey (
        id,
        phone_number_id,
        display_phone_number,
        verified_name,
        quality_rating,
        status,
        is_primary
      ),
      webhook_subscriptions (
        status,
        last_verified_at,
        last_error,
        subscribed_fields
      )
    `)
    .eq("organization_id", orgId)
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json(
      { error: error.message, code: "DB_ERROR" },
      { status: 500 },
    );
  }

  await audit({
    action: "whatsapp_account.list",
    userId: user.id,
    organizationId: orgId,
    details: { count: data?.length ?? 0 },
    request: req,
  });

  return NextResponse.json({
    organizationId: orgId,
    accounts: (data ?? []).map(shape),
  });
}

interface RawAccount {
  id: string;
  waba_id: string;
  business_id: string | null;
  system_user_id: string | null;
  display_phone_number: string;
  business_name: string | null;
  profile_name: string | null;
  quality_rating: string;
  messaging_tier: string;
  status: string;
  webhook_verified: boolean;
  token_expires_at: string | null;
  created_at: string;
  updated_at: string;
  phone_numbers?: Array<{
    id: string;
    phone_number_id: string;
    display_phone_number: string;
    verified_name: string | null;
    quality_rating: string;
    status: string;
    is_primary: boolean;
  }>;
  webhook_subscriptions?: Array<{
    status: string;
    last_verified_at: string | null;
    last_error: string | null;
    subscribed_fields: string[];
  }>;
}

function shape(row: RawAccount) {
  const sub = row.webhook_subscriptions?.[0] ?? null;
  return {
    id: row.id,
    wabaId: row.waba_id,
    businessId: row.business_id,
    systemUserId: row.system_user_id,
    displayPhoneNumber: row.display_phone_number,
    businessName: row.business_name,
    profileName: row.profile_name,
    qualityRating: row.quality_rating,
    messagingTier: row.messaging_tier,
    status: row.status,
    webhookVerified: row.webhook_verified,
    tokenExpiresAt: row.token_expires_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    phoneNumbers: (row.phone_numbers ?? []).map((p) => ({
      id: p.id,
      phoneNumberId: p.phone_number_id,
      displayPhoneNumber: p.display_phone_number,
      verifiedName: p.verified_name,
      qualityRating: p.quality_rating,
      status: p.status,
      isPrimary: p.is_primary,
    })),
    webhook: sub
      ? {
          status: sub.status,
          lastVerifiedAt: sub.last_verified_at,
          lastError: sub.last_error,
          subscribedFields: sub.subscribed_fields,
        }
      : null,
  };
}
