/**
 * POST /api/meta/subscribe-webhook
 *
 * Subscribes our Meta App to a WABA so events flow to /api/webhooks/whatsapp.
 * Idempotent — safe to call multiple times. Records the subscription state
 * in webhook_subscriptions for monitoring + automatic re-subscription.
 *
 * Body    : { accountId: string }
 * Returns : { status: 'active' | 'failed', subscribedFields: string[] }
 */

import { NextRequest, NextResponse } from "next/server";
import { createHash } from "crypto";
import { getSessionUser } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";
import { decrypt } from "@/lib/crypto";
import { logger } from "@/lib/logger";
import { audit } from "@/lib/audit";
import { MetaApiError, subscribeWabaToApp } from "@/lib/meta-client";

interface SubscribeRequest {
  accountId?: string;
}

const SUBSCRIBED_FIELDS = [
  "messages",
  "message_template_status_update",
  "account_update",
  "phone_number_quality_update",
];

export async function POST(req: NextRequest): Promise<NextResponse> {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: SubscribeRequest;
  try {
    body = (await req.json()) as SubscribeRequest;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const accountId = body.accountId?.trim();
  if (!accountId) {
    return NextResponse.json(
      { error: "accountId is required", code: "MISSING_ACCOUNT_ID" },
      { status: 400 },
    );
  }

  const supabase = createServiceClient();

  // 1) Load the account + verify the caller belongs to its org
  const { data: account, error: accErr } = await supabase
    .from("whatsapp_accounts")
    .select("id, organization_id, waba_id, status")
    .eq("id", accountId)
    .maybeSingle();
  if (accErr || !account) {
    return NextResponse.json({ error: "Account not found", code: "NOT_FOUND" }, { status: 404 });
  }

  const { data: membership } = await supabase
    .from("organization_members")
    .select("organization_id")
    .eq("organization_id", account.organization_id)
    .eq("user_id", user.id)
    .eq("status", "active")
    .maybeSingle();
  if (!membership) {
    return NextResponse.json({ error: "Forbidden", code: "FORBIDDEN" }, { status: 403 });
  }

  // 2) Pull the active token, decrypt it (in-memory only)
  const { data: tokenRow, error: tokenErr } = await supabase
    .from("access_tokens")
    .select("id, token_ciphertext")
    .eq("whatsapp_account_id", accountId)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle();
  if (tokenErr || !tokenRow) {
    return NextResponse.json(
      { error: "No active access token for this account", code: "NO_TOKEN" },
      { status: 409 },
    );
  }

  let plaintext: string;
  try {
    plaintext = await decrypt(tokenRow.token_ciphertext);
  } catch (err) {
    logger.error("[api/meta/subscribe-webhook] decrypt failed", {
      accountId, msg: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json({ error: "Token decryption failed", code: "DECRYPT_FAILED" }, { status: 500 });
  }

  // 3) Call Graph API — subscribe WABA to our app
  let metaResponse: unknown;
  let status: "active" | "failed" = "active";
  let lastError: string | null = null;
  try {
    const result = await subscribeWabaToApp(account.waba_id, plaintext);
    metaResponse = result.raw;
    if (!result.success) {
      status = "failed";
      lastError = "Meta reported success=false";
    }
  } catch (err) {
    status = "failed";
    lastError = err instanceof Error ? err.message : String(err);
    const httpStatus = err instanceof MetaApiError ? err.httpStatus : 502;
    await persistSubscription(supabase, {
      organizationId: account.organization_id,
      accountId,
      wabaId: account.waba_id,
      status,
      lastError,
      metaResponse: { error: lastError },
    });
    await audit({
      action: "embedded_signup.subscribe_webhook",
      userId: user.id,
      organizationId: account.organization_id,
      resourceType: "whatsapp_account",
      resourceId: accountId,
      outcome: "failure",
      details: { lastError },
      request: req,
    });
    return NextResponse.json({ error: lastError, code: "META_SUBSCRIBE_FAILED" }, { status: httpStatus });
  }

  // 4) Persist subscription state + flip whatsapp_accounts.webhook_verified
  await persistSubscription(supabase, {
    organizationId: account.organization_id,
    accountId,
    wabaId: account.waba_id,
    status,
    lastError: null,
    metaResponse,
  });

  await supabase
    .from("whatsapp_accounts")
    .update({ webhook_verified: true, updated_at: new Date().toISOString() })
    .eq("id", accountId);

  await audit({
    action: "embedded_signup.subscribe_webhook",
    userId: user.id,
    organizationId: account.organization_id,
    resourceType: "whatsapp_account",
    resourceId: accountId,
    details: { wabaId: account.waba_id, fields: SUBSCRIBED_FIELDS },
    request: req,
  });

  logger.info("[api/meta/subscribe-webhook] subscribed", {
    accountId, wabaId: account.waba_id,
  });

  return NextResponse.json({ status, subscribedFields: SUBSCRIBED_FIELDS });
}

type SupabaseClient = ReturnType<typeof createServiceClient>;

async function persistSubscription(
  supabase: SupabaseClient,
  args: {
    organizationId: string;
    accountId: string;
    wabaId: string;
    status: "active" | "failed";
    lastError: string | null;
    metaResponse: unknown;
  },
): Promise<void> {
  const verifyToken = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN ?? "";
  const callbackUrl =
    `${process.env.NEXT_PUBLIC_SITE_URL ?? ""}`.replace(/\/$/, "") +
    "/api/webhooks/whatsapp";

  const payload = {
    organization_id: args.organizationId,
    whatsapp_account_id: args.accountId,
    waba_id: args.wabaId,
    callback_url: callbackUrl,
    verify_token_fingerprint: sha256(verifyToken),
    subscribed_fields: SUBSCRIBED_FIELDS,
    status: args.status,
    last_verified_at: args.status === "active" ? new Date().toISOString() : null,
    last_error: args.lastError,
    meta_response: args.metaResponse as Record<string, unknown>,
  };

  await supabase
    .from("webhook_subscriptions")
    .upsert(payload, { onConflict: "whatsapp_account_id" });
}

function sha256(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}
