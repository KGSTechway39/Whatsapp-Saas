import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { createServiceClient } from "@/lib/supabase/server";
import { decrypt } from "@/lib/crypto";
import { withApiAuth, ApiAuthError } from "@/lib/api-keys";
import { uploadMedia, sendTemplateMessage } from "@/lib/meta";
import { guardedSingleSend } from "@/lib/billing/guarded-send";
import { InsufficientBalanceError } from "@/lib/billing/wallet";

/**
 * POST /api/v1/documents/send   (multipart/form-data)
 *   fields: to, name, file (PDF), template_name?, language?, idempotency_key?
 *
 * WorkspaceCV's resume-delivery endpoint. WorkspaceCV never calls the Graph API
 * itself — it hands WASend a recipient + a PDF, and we:
 *   1. uploadMedia(pdf) → media_id  (tied to the tenant's own connected number)
 *   2. send a UTILITY-category template with the PDF attached via that media_id,
 *      personalised with {{1}} = name
 *   3. run it through the wallet reserve → send → settle-on-webhook flow, billed
 *      at the UTILITY rate.
 *
 * Returns: { sent: true }
 */

const E164 = /^\+?[1-9]\d{7,14}$/;
const MAX_PDF_BYTES = 90 * 1024 * 1024;            // WhatsApp document cap ~100MB; stay under
const DEFAULT_TEMPLATE = process.env.RESUME_TEMPLATE_NAME || "resume_ready";

export async function POST(req: NextRequest) {
  try {
    const ctx = await withApiAuth(req, "messages:write");

    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      return NextResponse.json({ error: "Expected multipart/form-data", code: "VALIDATION_ERROR" }, { status: 400 });
    }

    const rawTo = String(form.get("to") || "").trim();
    if (!E164.test(rawTo)) {
      return NextResponse.json({ error: "`to` must be a valid E.164 phone number", code: "VALIDATION_ERROR" }, { status: 400 });
    }
    const to = rawTo.replace(/\D/g, "");

    const name = String(form.get("name") || "").trim();
    if (!name) {
      return NextResponse.json({ error: "`name` is required", code: "VALIDATION_ERROR" }, { status: 400 });
    }

    const file = form.get("file");
    if (!(file instanceof Blob) || file.size === 0) {
      return NextResponse.json({ error: "`file` (PDF) is required", code: "VALIDATION_ERROR" }, { status: 400 });
    }
    if (file.type && file.type !== "application/pdf") {
      return NextResponse.json({ error: "`file` must be a PDF", code: "VALIDATION_ERROR" }, { status: 400 });
    }
    if (file.size > MAX_PDF_BYTES) {
      return NextResponse.json({ error: "PDF too large", code: "VALIDATION_ERROR" }, { status: 413 });
    }

    const templateName = String(form.get("template_name") || "").trim() || DEFAULT_TEMPLATE;
    const language = String(form.get("language") || "").trim() || "en";
    const filename = (file instanceof File && file.name) || "resume.pdf";

    // ── Resolve the tenant's active sending number ─────────────────────────
    const supabase = createServiceClient();
    const { data: number } = await supabase
      .from("whatsapp_numbers")
      .select("phone_number_id, access_token, status")
      .eq("user_id", ctx.userId)
      .eq("status", "active")
      .order("is_primary", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!number?.phone_number_id || !number?.access_token) {
      return NextResponse.json({ error: "No active WhatsApp number connected", code: "NO_ACTIVE_NUMBER" }, { status: 400 });
    }

    const bytes = new Uint8Array(await file.arrayBuffer());

    try {
      await guardedSingleSend({
        userId: ctx.userId,
        category: "UTILITY",
        idempotencyKey: `doc:${req.headers.get("idempotency-key") || String(form.get("idempotency_key") || "") || randomUUID()}`,
        referenceId: to,
        description: "Resume document delivery",
        send: async () => {
          const token = await decrypt(number.access_token);
          // Upload happens inside the guarded send so a failed upload releases the hold.
          const { mediaId } = await uploadMedia(number.phone_number_id, token, {
            data: bytes,
            mimeType: "application/pdf",
            filename,
          });
          return sendTemplateMessage({
            phoneNumberId: number.phone_number_id,
            accessToken: token,
            to,
            templateName,
            languageCode: language,
            components: [
              { type: "header", parameters: [{ type: "document", document: { id: mediaId, filename } }] },
              { type: "body", parameters: [{ type: "text", text: name }] },
            ],
          });
        },
      });
    } catch (sendErr) {
      if (sendErr instanceof InsufficientBalanceError) {
        return NextResponse.json({ error: "Insufficient wallet balance", code: "INSUFFICIENT_BALANCE" }, { status: 402 });
      }
      const msg = sendErr instanceof Error ? sendErr.message : "Failed to send document";
      return NextResponse.json({ error: msg, code: "SEND_FAILED" }, { status: 502 });
    }

    return NextResponse.json({ sent: true }, { status: 201 });
  } catch (e) {
    if (e instanceof ApiAuthError) return NextResponse.json({ error: e.message, code: e.code }, { status: e.status });
    return NextResponse.json({ error: e instanceof Error ? e.message : "Internal error", code: "INTERNAL" }, { status: 500 });
  }
}
