/**
 * DELETE /api/meta/disconnect?accountId=...
 *
 * Disconnects a WhatsApp Business account from the caller's organization.
 *
 * Steps:
 *   1. Verify the caller is a member of the account's org.
 *   2. Best-effort unsubscribe webhook from Meta (non-fatal).
 *   3. Mark whatsapp_accounts.status = 'disconnected', revoke the active token,
 *      mark webhook_subscriptions.status = 'revoked'.
 *   4. Audit the action.
 */

import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";
import { decrypt } from "@/lib/crypto";
import { logger } from "@/lib/logger";
import { audit } from "@/lib/audit";
import { unsubscribeWabaFromApp } from "@/lib/meta-client";

export async function DELETE(req: NextRequest): Promise<NextResponse> {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const accountId =
    new URL(req.url).searchParams.get("accountId")?.trim() ??
    (await tryReadBody(req)).accountId;

  if (!accountId) {
    return NextResponse.json(
      { error: "accountId is required", code: "MISSING_ACCOUNT_ID" },
      { status: 400 },
    );
  }

  const supabase = createServiceClient();

  const { data: account } = await supabase
    .from("whatsapp_accounts")
    .select("id, organization_id, waba_id, status")
    .eq("id", accountId)
    .maybeSingle();
  if (!account) {
    return NextResponse.json({ error: "Account not found", code: "NOT_FOUND" }, { status: 404 });
  }

  const { data: membership } = await supabase
    .from("organization_members")
    .select("role")
    .eq("organization_id", account.organization_id)
    .eq("user_id", user.id)
    .eq("status", "active")
    .maybeSingle();
  if (!membership) {
    return NextResponse.json({ error: "Forbidden", code: "FORBIDDEN" }, { status: 403 });
  }
  if (!["owner", "admin"].includes(membership.role)) {
    return NextResponse.json(
      { error: "Only owners and admins can disconnect accounts", code: "FORBIDDEN" },
      { status: 403 },
    );
  }

  // Best-effort: pull the active token to try the Graph unsubscribe.
  const { data: tokenRow } = await supabase
    .from("access_tokens")
    .select("id, token_ciphertext")
    .eq("whatsapp_account_id", accountId)
    .eq("is_active", true)
    .maybeSingle();

  if (tokenRow?.token_ciphertext) {
    try {
      const plaintext = await decrypt(tokenRow.token_ciphertext);
      await unsubscribeWabaFromApp(account.waba_id, plaintext);
      logger.info("[api/meta/disconnect] unsubscribed waba", { wabaId: account.waba_id });
    } catch (err) {
      logger.warn("[api/meta/disconnect] graph unsubscribe failed (non-fatal)", {
        wabaId: account.waba_id,
        msg: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const nowIso = new Date().toISOString();

  await supabase
    .from("whatsapp_accounts")
    .update({ status: "disconnected", webhook_verified: false, updated_at: nowIso })
    .eq("id", accountId);

  await supabase
    .from("access_tokens")
    .update({ is_active: false, revoked_at: nowIso, revoked_reason: "disconnected" })
    .eq("whatsapp_account_id", accountId)
    .eq("is_active", true);

  await supabase
    .from("webhook_subscriptions")
    .update({ status: "revoked", last_error: null, updated_at: nowIso })
    .eq("whatsapp_account_id", accountId);

  await audit({
    action: "whatsapp_account.disconnect",
    userId: user.id,
    organizationId: account.organization_id,
    resourceType: "whatsapp_account",
    resourceId: accountId,
    details: { wabaId: account.waba_id },
    request: req,
  });

  return NextResponse.json({ status: "disconnected", accountId });
}

async function tryReadBody(req: NextRequest): Promise<{ accountId?: string }> {
  try {
    return (await req.json()) as { accountId?: string };
  } catch {
    return {};
  }
}
