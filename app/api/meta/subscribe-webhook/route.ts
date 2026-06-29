/**
 * POST /api/meta/subscribe-webhook
 *
 * Subscribes our Meta App to a connected number's WABA so events flow to
 * /api/webhooks/whatsapp. Idempotent — safe to call multiple times.
 *
 * Body    : { accountId: string }   // whatsapp_numbers.id
 * Returns : { status: 'active' | 'failed', subscribedFields: string[] }
 */

import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";
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

  // Load the connected number + verify ownership.
  const { data: number, error: numErr } = await supabase
    .from("whatsapp_numbers")
    .select("id, user_id, waba_id, access_token")
    .eq("id", accountId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (numErr || !number) {
    return NextResponse.json({ error: "Account not found", code: "NOT_FOUND" }, { status: 404 });
  }
  if (!number.waba_id || !number.access_token) {
    return NextResponse.json(
      { error: "Number is not fully connected (missing WABA or token)", code: "INCOMPLETE" },
      { status: 409 },
    );
  }

  // Call Graph API — subscribe the WABA to our app.
  let status: "active" | "failed" = "active";
  try {
    const result = await subscribeWabaToApp(number.waba_id, number.access_token);
    if (!result.success) status = "failed";
  } catch (err) {
    const lastError = err instanceof Error ? err.message : String(err);
    const httpStatus = err instanceof MetaApiError ? err.httpStatus : 502;
    logger.warn("[api/meta/subscribe-webhook] subscribe failed", {
      userId: user.id, accountId, msg: lastError,
    });
    await audit({
      action: "embedded_signup.subscribe_webhook",
      userId: user.id,
      resourceType: "whatsapp_number",
      resourceId: accountId,
      outcome: "failure",
      details: { wabaId: number.waba_id, lastError },
      request: req,
    });
    return NextResponse.json({ error: lastError, code: "META_SUBSCRIBE_FAILED" }, { status: httpStatus });
  }

  if (status === "active") {
    await supabase
      .from("whatsapp_numbers")
      .update({ webhook_verified: true, updated_at: new Date().toISOString() })
      .eq("id", accountId);
  }

  await audit({
    action: "embedded_signup.subscribe_webhook",
    userId: user.id,
    resourceType: "whatsapp_number",
    resourceId: accountId,
    details: { wabaId: number.waba_id, fields: SUBSCRIBED_FIELDS, status },
    request: req,
  });

  logger.info("[api/meta/subscribe-webhook] subscribed", {
    userId: user.id, accountId, wabaId: number.waba_id, result: status,
  });

  return NextResponse.json({ status, subscribedFields: SUBSCRIBED_FIELDS });
}
