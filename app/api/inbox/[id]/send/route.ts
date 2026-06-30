import { createClient } from "@/lib/supabase/server";
import { decrypt } from "@/lib/crypto";
import { getSessionUser } from "@/lib/auth";
import { NextRequest, NextResponse } from "next/server";
import { sendTextMessage, sendTemplateMessage } from "@/lib/meta";
import { guardedSingleSend } from "@/lib/billing/guarded-send";
import { toBillableCategory } from "@/lib/billing/pricing";
import { InsufficientBalanceError } from "@/lib/billing/wallet";
import { randomUUID } from "crypto";

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const supabase = createClient();
  const body = await request.json();
  const { type = "text", text, templateId, variableValues = [] } = body;

  // Stable billing idempotency key: prefer a caller-supplied key (header or
  // body) so a retried send debits the wallet exactly once. The UI passes the
  // per-send optimistic id. Falls back to a fresh UUID (no dedupe) only when
  // the caller supplies nothing.
  const clientIdem =
    request.headers.get("idempotency-key") || body.idempotencyKey || randomUUID();
  const billingIdem = `inbox:${params.id}:${clientIdem}`;

  // Load conversation
  const { data: conv, error: convErr } = await supabase
    .from("conversations")
    .select(`
      id, status, is_within_24h_window, window_expires_at,
      contact_phone, contact_name, contact_id,
      whatsapp_number_id,
      whatsapp_numbers(id, phone_number, phone_number_id, access_token, status)
    `)
    .eq("id", params.id)
    .eq("user_id", user.id)
    .single();

  if (convErr || !conv) {
    return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
  }

  const wn = (conv.whatsapp_numbers as unknown) as {
    id: string; phone_number: string; phone_number_id: string;
    access_token: string; status: string;
  } | null;

  if (!wn?.phone_number_id || !wn?.access_token) {
    return NextResponse.json({ error: "WhatsApp number not connected" }, { status: 400 });
  }

  if (wn.status !== "active") {
    return NextResponse.json({ error: "WhatsApp number is inactive" }, { status: 400 });
  }

  const wnToken = await decrypt(wn.access_token);

  const recipientPhone = (conv.contact_phone ?? "").replace(/[^\d+]/g, "");
  if (!recipientPhone) {
    return NextResponse.json({ error: "Contact phone number missing" }, { status: 400 });
  }

  // Enforce 24h window for non-template messages
  const withinWindow = conv.is_within_24h_window &&
    conv.window_expires_at &&
    new Date(conv.window_expires_at as string) > new Date();

  if (type === "text" && !withinWindow) {
    return NextResponse.json(
      { error: "24-hour conversation window expired. Please send a template message to re-engage.", code: "WINDOW_EXPIRED" },
      { status: 400 }
    );
  }

  const now = new Date().toISOString();
  let waMessageId: string | null = null;
  let sendError: string | null = null;
  let messageContent: Record<string, unknown> = {};
  let messageType = type;

  try {
    if (type === "text" && text) {
      // Managed tenants are billed before the send (SERVICE category — free for
      // session replies unless platform pricing says otherwise). BYO passes through.
      const result = await guardedSingleSend({
        userId: user.id,
        category: "SERVICE",
        idempotencyKey: billingIdem,
        referenceId: `inbox:${params.id}`,
        description: "Inbox reply (text)",
        send: () => sendTextMessage(wn.phone_number_id, wnToken, recipientPhone, text),
      });
      waMessageId = result.messageId ?? null;
      messageContent = { body: text };
    } else if (type === "template" && templateId) {
      // Load template
      const { data: tmpl } = await supabase
        .from("templates")
        .select("id, name, display_name, body, variables, language, category")
        .eq("id", templateId)
        .eq("user_id", user.id)
        .single();

      if (!tmpl) {
        return NextResponse.json({ error: "Template not found" }, { status: 404 });
      }

      const components = variableValues.length > 0
        ? [{ type: "body", parameters: variableValues.map((v: string) => ({ type: "text", text: v })) }]
        : [];

      const result = await guardedSingleSend({
        userId: user.id,
        category: toBillableCategory(tmpl.category),
        idempotencyKey: billingIdem,
        referenceId: `inbox:${params.id}`,
        description: `Inbox reply (template ${tmpl.name})`,
        send: () =>
          sendTemplateMessage({
            phoneNumberId: wn.phone_number_id,
            accessToken: wnToken,
            to: recipientPhone,
            templateName: tmpl.name,
            languageCode: tmpl.language || "en",
            components,
          }),
      });
      waMessageId = result.messageId ?? null;
      messageType = "template";
      messageContent = {
        template_name: tmpl.name,
        body: tmpl.body,
        variables: variableValues,
      };

      // Sending a template reopens the 24h window
      const windowExpires = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
      await supabase
        .from("conversations")
        .update({ is_within_24h_window: true, window_expires_at: windowExpires })
        .eq("id", params.id);
    } else {
      return NextResponse.json({ error: "Invalid message type or missing content" }, { status: 400 });
    }
  } catch (err) {
    // Managed user with no prepaid balance: hard stop before anything was sent.
    if (err instanceof InsufficientBalanceError) {
      return NextResponse.json(
        { error: "Insufficient wallet balance. Please top up to continue.", code: "INSUFFICIENT_BALANCE" },
        { status: 402 },
      );
    }
    sendError = err instanceof Error ? err.message : "Send failed";
  }

  const preview = type === "text" ? (text ?? "").slice(0, 100) : "Template message";

  // Insert message record
  const { data: msg } = await supabase
    .from("messages")
    .insert({
      conversation_id:    params.id,
      user_id:            user.id,
      contact_id:         conv.contact_id ?? null,
      whatsapp_number_id: conv.whatsapp_number_id ?? null,
      wa_message_id:      waMessageId,
      direction:          "outbound",
      type:               messageType,
      content:            messageContent,
      status:             waMessageId ? "sent" : "failed",
      error_message:      sendError,
      sent_at:            waMessageId ? now : null,
    })
    .select()
    .single();

  // Update conversation
  await supabase
    .from("conversations")
    .update({
      last_message_at:      now,
      last_message_preview: preview,
      status:               conv.status === "resolved" ? "open" : conv.status,
      updated_at:           now,
    })
    .eq("id", params.id);

  if (sendError && !waMessageId) {
    return NextResponse.json({ error: sendError }, { status: 502 });
  }

  return NextResponse.json({ message: msg, waMessageId }, { status: 201 });
}
