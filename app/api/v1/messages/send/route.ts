import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { decrypt } from "@/lib/crypto";
import { withApiAuth, ApiAuthError } from "@/lib/api-keys";
import { sendTemplateMessage, sendTextMessage, sendDocumentMessage } from "@/lib/meta";
import { guardedSingleSend, resolveTemplateCategory } from "@/lib/billing/guarded-send";
import { InsufficientBalanceError } from "@/lib/billing/wallet";
import { dispatchEvent } from "@/lib/webhooks-out";

/**
 * POST /api/v1/messages/send  —  public send endpoint (integration layer)
 *
 * Auth:  Authorization: Bearer wsk_live_…   (scope messages:write)
 * Body:
 *   {
 *     to: "+919876543210",               // E.164
 *     type: "document" | "text" | "template",
 *     document_url?, filename?,           // type=document
 *     template_name?, template_params?,   // type=template (params = string[])
 *     text?,                              // type=text
 *     require_otp?: boolean,             // gate on a prior verified OTP for `to`
 *     client_reference?: string          // caller's id — idempotency key
 *   }
 * Returns: { id, status: "queued"|"sent"|"failed", error? }
 *
 * Resume-delivery sequence (WorkspaceCV): POST /otp/request → user enters code →
 * POST /otp/verify → on verified, POST /messages/send {type:"document", require_otp:true}.
 *
 * The actual WhatsApp call goes through the UNMODIFIED lib/meta.ts sender,
 * wrapped by guardedSingleSend so managed tenants are billed (BYO pass through).
 */

const E164 = /^\+?[1-9]\d{7,14}$/;
const OTP_VERIFIED_WINDOW_MIN = 15; // a verify is good for this long before send

export async function POST(req: NextRequest) {
  try {
    const ctx = await withApiAuth(req, "messages:write");
    const body = await req.json().catch(() => ({}));

    // ── Strict validation (internet-facing) ────────────────────────────────
    const rawTo = typeof body.to === "string" ? body.to.trim() : "";
    if (!E164.test(rawTo)) {
      return err(400, "VALIDATION_ERROR", "`to` must be a valid E.164 phone number");
    }
    const to = rawTo.replace(/\D/g, ""); // Meta wants digits, no '+'

    const type = body.type;
    if (!["document", "text", "template"].includes(type)) {
      return err(400, "VALIDATION_ERROR", "`type` must be document|text|template");
    }
    if (type === "document" && (!body.document_url || typeof body.document_url !== "string")) {
      return err(400, "VALIDATION_ERROR", "`document_url` is required for type=document");
    }
    if (type === "text" && (!body.text || typeof body.text !== "string")) {
      return err(400, "VALIDATION_ERROR", "`text` is required for type=text");
    }
    if (type === "template" && (!body.template_name || typeof body.template_name !== "string")) {
      return err(400, "VALIDATION_ERROR", "`template_name` is required for type=template");
    }
    const clientReference =
      typeof body.client_reference === "string" && body.client_reference.length > 0
        ? body.client_reference.slice(0, 200)
        : null;

    const supabase = createServiceClient();

    // ── require_otp gate: a recently verified, consumed code must exist ──────
    if (body.require_otp) {
      const cutoff = new Date(Date.now() - OTP_VERIFIED_WINDOW_MIN * 60_000).toISOString();
      const { data: verified } = await supabase
        .from("otp_codes")
        .select("id")
        .eq("user_id", ctx.userId)
        .eq("phone", to)
        .not("consumed_at", "is", null)
        .gte("consumed_at", cutoff)
        .limit(1)
        .maybeSingle();
      if (!verified) {
        return err(403, "OTP_REQUIRED", "No recent verified OTP for this recipient");
      }
    }

    // ── Idempotency: replay the original result for a known client_reference ─
    if (clientReference) {
      const { data: prior } = await supabase
        .from("api_messages")
        .select("id, status, error")
        .eq("user_id", ctx.userId)
        .eq("client_reference", clientReference)
        .maybeSingle();
      if (prior) {
        return NextResponse.json({ id: prior.id, status: prior.status, error: prior.error ?? undefined });
      }
    }

    // Create the message record (queued). A unique-violation means a concurrent
    // request with the same client_reference won — return that one.
    const { data: rec, error: insErr } = await supabase
      .from("api_messages")
      .insert({ user_id: ctx.userId, client_reference: clientReference, to_phone: to, type, status: "queued" })
      .select("id")
      .single();

    if (insErr || !rec) {
      if (clientReference) {
        const { data: winner } = await supabase
          .from("api_messages")
          .select("id, status, error")
          .eq("user_id", ctx.userId)
          .eq("client_reference", clientReference)
          .maybeSingle();
        if (winner) return NextResponse.json({ id: winner.id, status: winner.status, error: winner.error ?? undefined });
      }
      return err(500, "DB_ERROR", insErr?.message || "Could not create message");
    }
    const messageId = rec.id;

    // ── Resolve the sending number (tenant-scoped) ─────────────────────────
    const { data: number } = await supabase
      .from("whatsapp_numbers")
      .select("id, phone_number_id, access_token, status")
      .eq("user_id", ctx.userId)
      .eq("status", "active")
      .order("is_primary", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!number?.phone_number_id || !number?.access_token) {
      await fail(supabase, messageId, "No active WhatsApp number connected");
      return NextResponse.json({ id: messageId, status: "failed", error: "No active WhatsApp number connected" }, { status: 400 });
    }
    const phoneNumberId = number.phone_number_id as string;
    const accessToken = await decrypt(number.access_token as string);

    // Billing category: template uses its real category; document/text = SERVICE.
    const category =
      type === "template" ? await resolveTemplateCategory(ctx.userId, body.template_name) : "SERVICE";

    const components =
      type === "template" && Array.isArray(body.template_params) && body.template_params.length > 0
        ? [{ type: "body", parameters: body.template_params.map((v: unknown) => ({ type: "text", text: String(v) })) }]
        : [];

    try {
      const result = await guardedSingleSend({
        userId: ctx.userId,
        category,
        idempotencyKey: `apimsg:${messageId}`, // per-message billing idempotency
        referenceId: to,
        send: () => {
          if (type === "document") {
            return sendDocumentMessage(phoneNumberId, accessToken, to, body.document_url, body.filename, body.caption);
          }
          if (type === "text") {
            return sendTextMessage(phoneNumberId, accessToken, to, body.text);
          }
          return sendTemplateMessage({
            phoneNumberId, accessToken, to,
            templateName: body.template_name,
            languageCode: body.language || "en",
            components,
          });
        },
      });

      await supabase
        .from("api_messages")
        .update({ status: "sent", wa_message_id: result.messageId, updated_at: new Date().toISOString() })
        .eq("id", messageId);

      dispatchEvent(supabase, ctx.userId, "message.sent", {
        id: messageId, client_reference: clientReference, to, type,
        wa_message_id: result.messageId, status: "sent",
      }).catch(() => {});

      return NextResponse.json({ id: messageId, status: "sent" }, { status: 201 });
    } catch (sendErr) {
      const msg = sendErr instanceof Error ? sendErr.message : "Send failed";
      await fail(supabase, messageId, msg);
      if (sendErr instanceof InsufficientBalanceError) {
        return NextResponse.json({ id: messageId, status: "failed", error: "Insufficient wallet balance" }, { status: 402 });
      }
      dispatchEvent(supabase, ctx.userId, "message.failed", {
        id: messageId, client_reference: clientReference, to, status: "failed", error: msg,
      }).catch(() => {});
      return NextResponse.json({ id: messageId, status: "failed", error: msg }, { status: 502 });
    }
  } catch (e) {
    if (e instanceof ApiAuthError) return err(e.status, e.code, e.message);
    return err(500, "INTERNAL", e instanceof Error ? e.message : "Internal error");
  }
}

function err(status: number, code: string, message: string) {
  return NextResponse.json({ error: message, code }, { status });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function fail(supabase: any, id: string, error: string) {
  await supabase
    .from("api_messages")
    .update({ status: "failed", error, updated_at: new Date().toISOString() })
    .eq("id", id);
}
