/**
 * POST /api/meta/test-message
 *
 * Sends a trial WhatsApp message from a connected number so users can
 * verify the integration end-to-end.
 *
 * Body:
 *   - to                : recipient phone (E.164 without leading "+")
 *   - accountId?        : whatsapp_numbers.id — required if the user has > 1 number
 *   - kind: 'text'      : free-form text (only works within the 24h window)
 *   - kind: 'template'  : template message — works to any opted-in number
 *       - templateName  : approved template name (defaults to "hello_world")
 *       - languageCode  : defaults to "en_US"
 *
 * Returns:
 *   { ok: true, waMessageId, from, to, kind }
 */

import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { decrypt } from "@/lib/crypto";
import { createServiceClient } from "@/lib/supabase/server";
import { logger } from "@/lib/logger";
import { MetaApiError, graphPost } from "@/lib/meta-client";

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

  // ── Pick the connected number ────────────────────────────────────────
  const supabase = createServiceClient();
  let q = supabase
    .from("whatsapp_numbers")
    .select("id, waba_id, phone_number_id, phone_number, access_token")
    .eq("user_id", user.id)
    .in("status", ["active", "inactive", "pending"]);
  if (body.accountId) q = q.eq("id", body.accountId);

  const { data: account } = await q.order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (!account) {
    return NextResponse.json(
      { error: "No connected WhatsApp number found. Connect one first.", code: "NO_ACCOUNT" },
      { status: 404 },
    );
  }
  if (!account.phone_number_id || !account.access_token) {
    return NextResponse.json(
      { error: "This number is not connected via the Meta API yet.", code: "NOT_CONNECTED" },
      { status: 409 },
    );
  }

  // ── Build the message payload ────────────────────────────────────────
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
      await decrypt(account.access_token),
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

  logger.info("[api/meta/test-message] sent", {
    userId: user.id, accountId: account.id, to, waMessageId,
  });

  return NextResponse.json({
    ok: true,
    waMessageId,
    from: account.phone_number,
    to,
    kind,
  });
}
