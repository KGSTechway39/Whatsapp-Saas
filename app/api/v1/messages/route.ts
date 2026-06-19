import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { withApiAuth, ApiAuthError } from "@/lib/api-keys";
import { dispatchEvent } from "@/lib/webhooks-out";
import { sendTemplateMessage, sendTextMessage } from "@/lib/meta";
import { guardedSingleSend, resolveTemplateCategory } from "@/lib/billing/guarded-send";
import { InsufficientBalanceError } from "@/lib/billing/wallet";

// POST /api/v1/messages
// Auth: Bearer wasend_… with scope `messages:write`
//
// Body:
// {
//   "to":          "+919876543210",         // E.164
//   "from":        "<whatsapp_number_id>",   // optional; defaults to primary
//   "type":        "template" | "text",
//   "template":    { "name": "...", "language": "en", "variables": ["...", ...] },
//   "text":        "Hello!"
// }
export async function POST(req: NextRequest) {
  try {
    const ctx = await withApiAuth(req, "messages:write");
    const body = await req.json();

    if (!body.to || typeof body.to !== "string") {
      return NextResponse.json({ error: "to is required (E.164 phone)", code: "VALIDATION_ERROR" }, { status: 400 });
    }
    const to = body.to.replace(/[^\d+]/g, "");
    const type = body.type === "text" ? "text" : "template";

    if (type === "template" && !body.template?.name) {
      return NextResponse.json({ error: "template.name required for type=template", code: "VALIDATION_ERROR" }, { status: 400 });
    }
    if (type === "text" && !body.text) {
      return NextResponse.json({ error: "text required for type=text", code: "VALIDATION_ERROR" }, { status: 400 });
    }

    const supabase = createServiceClient();

    // Pick sending number (with Meta credentials), scoped to the API key's tenant.
    const numSel = "id, phone_number_id, access_token, status";
    const { data: number } = body.from
      ? await supabase.from("whatsapp_numbers").select(numSel)
          .eq("id", body.from).eq("user_id", ctx.userId).maybeSingle()
      : await supabase.from("whatsapp_numbers").select(numSel)
          .eq("user_id", ctx.userId).eq("status", "active")
          .order("is_primary", { ascending: false }).limit(1).maybeSingle();

    if (!number?.id) {
      return NextResponse.json({ error: "No active WhatsApp number connected", code: "NO_ACTIVE_NUMBER" }, { status: 400 });
    }
    if (number.status !== "active" || !number.phone_number_id || !number.access_token) {
      return NextResponse.json({ error: "Sending number is not connected/active", code: "NUMBER_NOT_READY" }, { status: 400 });
    }
    const numberId = number.id;
    const phoneNumberId = number.phone_number_id as string;
    const accessToken = number.access_token as string;

    // Look up the contact (or create one if not present — convenience for API users)
    let contactId: string | null = null;
    const { data: existing } = await supabase
      .from("contacts")
      .select("id")
      .eq("user_id", ctx.userId)
      .eq("phone", to)
      .maybeSingle();
    if (existing) {
      contactId = existing.id;
    } else {
      const { data: created } = await supabase
        .from("contacts")
        .insert({
          user_id: ctx.userId,
          name: body.name || `Lead ${to.slice(-4)}`,
          phone: to,
          crm_source: "manual",
          tags: ["api"],
        })
        .select("id")
        .single();
      contactId = created?.id ?? null;
    }

    // Wrap in a synthetic campaign (single recipient) so analytics + tracking
    // flow through the existing pipeline.
    const { data: campaign } = await supabase
      .from("campaigns")
      .insert({
        user_id: ctx.userId,
        name: `API send to ${to}`,
        description: `Sent via API (${ctx.environment}) — ${type}`,
        status: "running",
        whatsapp_number_id: numberId,
        audience_type: "tags",
        recipients_count: 1,
        started_at: new Date().toISOString(),
      })
      .select("id")
      .single();

    if (!campaign) {
      return NextResponse.json({ error: "Failed to create message", code: "INTERNAL" }, { status: 500 });
    }

    const { data: msg, error: msgErr } = await supabase
      .from("campaign_messages")
      .insert({
        campaign_id: campaign.id,
        contact_id: contactId,
        phone: to,
        status: "pending",
      })
      .select("id, status, created_at")
      .single();

    if (msgErr) return NextResponse.json({ error: msgErr.message, code: "DB_ERROR" }, { status: 500 });

    // Resolve billing category + build the template payload.
    const category =
      type === "text" ? "SERVICE" : await resolveTemplateCategory(ctx.userId, body.template.name);
    const languageCode = body.template?.language || "en";
    const vars: string[] = Array.isArray(body.template?.variables) ? body.template.variables : [];
    const components =
      vars.length > 0
        ? [{ type: "body", parameters: vars.map((v) => ({ type: "text", text: v })) }]
        : [];

    // Idempotency: caller's Idempotency-Key header, else the message id.
    const idemKey = req.headers.get("Idempotency-Key") || `v1msg:${msg.id}`;

    try {
      // Real send through the unmodified lib/meta.ts sender, wrapped in billing.
      // Managed tenants are charged (hard stop if unaffordable); BYO pass through.
      const result = await guardedSingleSend({
        userId: ctx.userId,
        category,
        idempotencyKey: idemKey,
        referenceId: to,
        send: () =>
          type === "text"
            ? sendTextMessage(phoneNumberId, accessToken, to, body.text)
            : sendTemplateMessage({
                phoneNumberId,
                accessToken,
                to,
                templateName: body.template.name,
                languageCode,
                components,
              }),
      });

      const sentAt = new Date().toISOString();
      await supabase
        .from("campaign_messages")
        .update({ status: "sent", meta_message_id: result.messageId, sent_at: sentAt })
        .eq("id", msg.id);
      await supabase
        .from("campaigns")
        .update({ status: "completed", sent_count: 1, completed_at: sentAt })
        .eq("id", campaign.id);

      dispatchEvent(supabase, ctx.userId, "message.sent", {
        id: msg.id, to, from_number_id: numberId, type,
        wa_message_id: result.messageId, created_at: msg.created_at,
      }).catch(() => {});

      return NextResponse.json({
        id: msg.id, object: "message", to, from: numberId, type,
        status: "sent", wa_message_id: result.messageId, created_at: msg.created_at,
      }, { status: 201 });
    } catch (sendErr) {
      const failMsg = sendErr instanceof Error ? sendErr.message : "Send failed";
      await supabase
        .from("campaign_messages")
        .update({ status: "failed", error_message: failMsg })
        .eq("id", msg.id);
      await supabase
        .from("campaigns")
        .update({ status: "failed", failed_count: 1, completed_at: new Date().toISOString() })
        .eq("id", campaign.id);

      if (sendErr instanceof InsufficientBalanceError) {
        return NextResponse.json(
          { error: "Insufficient wallet balance", code: "INSUFFICIENT_BALANCE" },
          { status: 402 },
        );
      }
      dispatchEvent(supabase, ctx.userId, "message.failed", { id: msg.id, to, error: failMsg }).catch(() => {});
      return NextResponse.json({ error: failMsg, code: "SEND_FAILED" }, { status: 502 });
    }
  } catch (err) {
    if (err instanceof ApiAuthError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
    }
    return NextResponse.json({ error: err instanceof Error ? err.message : "Internal error", code: "INTERNAL" }, { status: 500 });
  }
}

// GET /api/v1/messages?limit=20&status=delivered
export async function GET(req: NextRequest) {
  try {
    const ctx = await withApiAuth(req, "messages:read");
    const sp = req.nextUrl.searchParams;
    const limit = Math.min(100, Math.max(1, Number(sp.get("limit")) || 20));
    const status = sp.get("status");

    const supabase = createServiceClient();
    // Pull messages by joining campaigns of this user.
    const { data: campaigns } = await supabase
      .from("campaigns")
      .select("id")
      .eq("user_id", ctx.userId)
      .order("created_at", { ascending: false })
      .limit(500);

    const ids = (campaigns || []).map((c) => c.id);
    if (ids.length === 0) return NextResponse.json({ data: [], has_more: false });

    let q = supabase
      .from("campaign_messages")
      .select("id, campaign_id, contact_id, phone, status, sent_at, delivered_at, read_at, created_at, error_message")
      .in("campaign_id", ids)
      .order("created_at", { ascending: false })
      .limit(limit);
    if (status) q = q.eq("status", status);

    const { data } = await q;
    return NextResponse.json({
      data: (data || []).map((m) => ({
        id: m.id,
        object: "message",
        to: m.phone,
        status: m.status,
        sent_at: m.sent_at,
        delivered_at: m.delivered_at,
        read_at: m.read_at,
        created_at: m.created_at,
        error: m.error_message,
      })),
      has_more: (data?.length ?? 0) === limit,
    });
  } catch (err) {
    if (err instanceof ApiAuthError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
    }
    return NextResponse.json({ error: err instanceof Error ? err.message : "Internal error", code: "INTERNAL" }, { status: 500 });
  }
}
