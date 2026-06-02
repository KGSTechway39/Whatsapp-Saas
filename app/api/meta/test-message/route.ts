/**
 * POST /api/meta/test-message
 *
 * Sends a trial WhatsApp message from a connected account so users can
 * verify the integration end-to-end.
 *
 * Body:
 *   - to                : recipient phone (E.164 without leading "+")
 *   - accountId?        : whatsapp_accounts.id  — required if the org has > 1 account
 *   - kind: 'text'      : free-form text (only works within the 24h window)
 *   - kind: 'template'  : template message — works to any opted-in number
 *       - templateName  : approved template name (defaults to "hello_world")
 *       - languageCode  : defaults to "en_US"
 *
 * Returns:
 *   { ok: true, waMessageId, messageId, status }
 */

import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";
import { decrypt } from "@/lib/crypto";
import { logger } from "@/lib/logger";
import { MetaApiError, graphPost } from "@/lib/meta-client";
import { resolveOrgId } from "@/lib/whatsapp/onboarding-repo";

interface TestMessageRequest {
  to?: string;
  accountId?: string;
  kind?: "text" | "template";
  body?: string;            // for text
  templateName?: string;    // for template
  languageCode?: string;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: TestMessageRequest;
  try {
    body = (await req.json()) as TestMessageRequest;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const to = (body.to || "").replace(/[^0-9]/g, "");
  if (!to || to.length < 8) {
    return NextResponse.json(
      { error: "Recipient phone (E.164, country code + number) is required", code: "BAD_RECIPIENT" },
      { status: 400 },
    );
  }
  const kind = body.kind ?? "template";

  // ── Resolve org + pick the account ───────────────────────────────────
  const supabase = createServiceClient();
  const orgId = await resolveOrgId(supabase, user.id, user.company || user.name);
  if (!orgId) {
    return NextResponse.json({ error: "No active organization", code: "NO_ORG" }, { status: 400 });
  }

  let q = supabase
    .from("whatsapp_accounts")
    .select("id, waba_id, phone_number_id, display_phone_number")
    .eq("organization_id", orgId)
    .in("status", ["active", "pending"]);
  if (body.accountId) q = q.eq("id", body.accountId);

  const { data: account } = await q.order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (!account) {
    return NextResponse.json(
      { error: "No connected WhatsApp account found. Connect one first.", code: "NO_ACCOUNT" },
      { status: 404 },
    );
  }

  // ── Decrypt the active token ─────────────────────────────────────────
  const { data: tokenRow } = await supabase
    .from("access_tokens")
    .select("id, token_ciphertext")
    .eq("whatsapp_account_id", account.id)
    .eq("is_active", true)
    .maybeSingle();
  if (!tokenRow) {
    return NextResponse.json(
      { error: "No active access token for this account", code: "NO_TOKEN" },
      { status: 409 },
    );
  }

  let accessToken: string;
  try {
    accessToken = await decrypt(tokenRow.token_ciphertext);
  } catch (err) {
    logger.error("[api/meta/test-message] decrypt failed", {
      accountId: account.id,
      msg: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json({ error: "Token decryption failed", code: "DECRYPT_FAILED" }, { status: 500 });
  }

  // ── Build the message body ───────────────────────────────────────────
  let payload: Record<string, unknown>;
  if (kind === "text") {
    const text = (body.body ?? "Hello from WASend! 👋").trim();
    payload = {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to,
      type: "text",
      text: { body: text, preview_url: false },
    };
  } else {
    payload = {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to,
      type: "template",
      template: {
        name: body.templateName?.trim() || "hello_world",
        language: { code: body.languageCode?.trim() || "en_US" },
      },
    };
  }

  // ── Send via Graph API ───────────────────────────────────────────────
  let waMessageId: string | undefined;
  try {
    const res = await graphPost<{ messages: { id: string }[] }>(
      `/${account.phone_number_id}/messages`,
      accessToken,
      payload,
    );
    waMessageId = res.messages?.[0]?.id;
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Send failed";
    const httpStatus = err instanceof MetaApiError ? err.httpStatus : 502;
    const code = err instanceof MetaApiError ? err.code : "SEND_FAILED";
    logger.error("[api/meta/test-message] graph send failed", {
      accountId: account.id, to, msg, code,
    });
    return NextResponse.json({ error: msg, code }, { status: httpStatus });
  }

  if (!waMessageId) {
    return NextResponse.json(
      { error: "Send succeeded but no message id returned", code: "NO_MESSAGE_ID" },
      { status: 502 },
    );
  }

  // ── Log into messages table for analytics + dedupe ───────────────────
  const { data: inserted } = await supabase
    .from("messages")
    .insert({
      organization_id: orgId,
      whatsapp_account_id: account.id,
      wa_message_id: waMessageId,
      direction: "outbound",
      type: kind === "text" ? "text" : "template",
      content: kind === "text"
        ? { body: body.body ?? "Hello from WASend! 👋" }
        : { template_name: body.templateName ?? "hello_world", language_code: body.languageCode ?? "en_US" },
      status: "sent",
      sent_at: new Date().toISOString(),
    })
    .select("id")
    .single();

  logger.info("[api/meta/test-message] sent", {
    userId: user.id, orgId, accountId: account.id, to, waMessageId,
  });

  return NextResponse.json({
    ok: true,
    waMessageId,
    messageId: inserted?.id ?? null,
    from: account.display_phone_number,
    to,
    kind,
  });
}
