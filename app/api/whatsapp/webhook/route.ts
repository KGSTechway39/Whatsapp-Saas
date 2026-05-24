import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { createHmac } from "crypto";

const APP_SECRET    = process.env.META_APP_SECRET!;
const VERIFY_TOKEN  = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN!;

// ─── GET: webhook verification handshake ─────────────────────────────────────
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const mode      = searchParams.get("hub.mode");
  const token     = searchParams.get("hub.verify_token");
  const challenge = searchParams.get("hub.challenge");

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    return new NextResponse(challenge, { status: 200 });
  }
  return NextResponse.json({ error: "Forbidden" }, { status: 403 });
}

// ─── POST: process all webhook events ────────────────────────────────────────
// IMPORTANT: Never return 5xx to Meta — they will disable the webhook.
export async function POST(request: NextRequest) {
  const rawBody = await request.text();

  // Validate HMAC-SHA256 signature
  if (APP_SECRET) {
    const signature = request.headers.get("x-hub-signature-256") ?? "";
    const expected  = `sha256=${createHmac("sha256", APP_SECRET).update(rawBody).digest("hex")}`;
    if (signature !== expected) {
      console.warn("[webhook] Signature mismatch — skipping payload");
      return NextResponse.json({ status: "ok" });
    }
  }

  let payload: WebhookPayload;
  try {
    payload = JSON.parse(rawBody) as WebhookPayload;
  } catch {
    return NextResponse.json({ status: "ok" });
  }

  const supabase = createServiceClient();

  try {
    for (const entry of payload.entry ?? []) {
      for (const change of entry.changes ?? []) {
        const value = change.value;
        if (!value) continue;

        const phoneNumberId = value.metadata?.phone_number_id;

        // Resolve user + whatsapp_number from the phone_number_id
        let userId: string | null       = null;
        let waNumberId: string | null   = null;

        if (phoneNumberId) {
          const { data: wn } = await supabase
            .from("whatsapp_numbers")
            .select("id, user_id")
            .eq("phone_number_id", phoneNumberId)
            .single();

          if (wn) {
            userId     = wn.user_id as string;
            waNumberId = wn.id as string;
          }
        }

        if (value.statuses?.length) {
          await handleStatusUpdates(supabase, value.statuses);
        }

        if (value.messages?.length && userId && waNumberId) {
          await handleIncomingMessages(supabase, value.messages, userId, waNumberId);
        }

        if (change.field === "message_template_status_update" && userId) {
          await handleTemplateStatusUpdate(supabase, value, userId);
        }
      }
    }
  } catch (err) {
    console.error("[webhook] Processing error:", err);
  }

  return NextResponse.json({ status: "ok" });
}

// ─── Status updates (sent / delivered / read / failed) ───────────────────────
async function handleStatusUpdates(
  supabase: ReturnType<typeof createServiceClient>,
  statuses: StatusUpdate[]
) {
  for (const s of statuses) {
    const ts = new Date(Number(s.timestamp) * 1000).toISOString();

    const patch: Record<string, unknown> = { status: s.status, updated_at: ts };
    if (s.status === "sent")      patch.sent_at      = ts;
    if (s.status === "delivered") patch.delivered_at = ts;
    if (s.status === "read")      patch.read_at      = ts;
    if (s.status === "failed") {
      patch.error_message = s.errors?.[0]?.title ?? "Delivery failed";
    }

    // Update message status
    const { data: msg } = await supabase
      .from("messages")
      .update(patch)
      .eq("wa_message_id", s.id)
      .select("campaign_id")
      .single();

    // Bump campaign counters if this message is from a campaign
    if (msg?.campaign_id) {
      const colMap: Record<string, string> = {
        sent:      "sent_count",
        delivered: "delivered_count",
        read:      "read_count",
        failed:    "failed_count",
      };
      const col = colMap[s.status];
      if (col) {
        await supabase.rpc("increment_campaign_stat", {
          p_campaign_id: msg.campaign_id,
          p_field: col,
        });
      }
    }
  }
}

// ─── Incoming messages ────────────────────────────────────────────────────────
async function handleIncomingMessages(
  supabase: ReturnType<typeof createServiceClient>,
  messages: IncomingMessage[],
  userId: string,
  waNumberId: string
) {
  for (const msg of messages) {
    const fromPhone = msg.from;
    const now       = new Date().toISOString();
    const contactDisplayName =
      msg.contacts?.[0]?.profile?.name ?? fromPhone;

    // Upsert contact
    const { data: contact } = await supabase
      .from("contacts")
      .upsert(
        {
          user_id:        userId,
          phone:          fromPhone,
          name:           contactDisplayName,
          crm_source:     "whatsapp",
          last_contacted: now,
        },
        { onConflict: "user_id,phone" }
      )
      .select("id")
      .single();

    const contactId = contact?.id as string | undefined;

    // Upsert conversation (one per user + contact + wa_number)
    const preview            = buildMessagePreview(msg);
    const windowExpires      = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

    const { data: conv } = await supabase
      .from("conversations")
      .upsert(
        {
          user_id:              userId,
          contact_id:           contactId ?? null,
          whatsapp_number_id:   waNumberId,
          contact_phone:        fromPhone,
          contact_name:         contactDisplayName,
          last_message_at:      now,
          last_message_preview: preview,
          status:               "open",
          is_within_24h_window: true,
          window_expires_at:    windowExpires,
          unread_count:         1,
          updated_at:           now,
        },
        {
          onConflict:       "user_id,contact_id,whatsapp_number_id",
          ignoreDuplicates: false,
        }
      )
      .select("id, unread_count")
      .single();

    const conversationId = conv?.id as string | undefined;

    // Increment unread if conversation already existed
    if (conv && (conv.unread_count as number) > 1) {
      await supabase
        .from("conversations")
        .update({
          last_message_at:      now,
          last_message_preview: preview,
          unread_count:         (conv.unread_count as number) + 1,
          is_within_24h_window: true,
          window_expires_at:    windowExpires,
          status:               "open",
          updated_at:           now,
        })
        .eq("id", conv.id);
    }

    if (!conversationId) continue;

    // Insert message
    await supabase.from("messages").insert({
      conversation_id:    conversationId,
      user_id:            userId,
      contact_id:         contactId ?? null,
      whatsapp_number_id: waNumberId,
      wa_message_id:      msg.id,
      direction:          "inbound",
      type:               normalizeMessageType(msg.type),
      content:            extractMessageContent(msg),
      status:             "delivered",
      delivered_at:       now,
      created_at:         new Date(Number(msg.timestamp) * 1000).toISOString(),
    });

    // Check for keyword automation triggers
    if (msg.type === "text" && conversationId && contactId) {
      await checkKeywordTriggers(
        supabase, userId, msg.text?.body ?? "", conversationId, contactId
      );
    }
  }
}

// ─── Template status updates ──────────────────────────────────────────────────
async function handleTemplateStatusUpdate(
  supabase: ReturnType<typeof createServiceClient>,
  value: WebhookValue,
  userId: string
) {
  const ev = value as unknown as {
    message_template_id?: string;
    event?: string;
    reason?: string;
  };
  if (!ev.message_template_id) return;

  const statusMap: Record<string, string> = {
    APPROVED:   "APPROVED",
    REJECTED:   "REJECTED",
    DISABLED:   "PENDING",
    REINSTATED: "APPROVED",
  };
  const newStatus = statusMap[ev.event ?? ""] ?? null;
  if (!newStatus) return;

  await supabase
    .from("templates")
    .update({ status: newStatus, updated_at: new Date().toISOString() })
    .eq("meta_template_id", ev.message_template_id)
    .eq("user_id", userId);
}

// ─── Automation keyword triggers ──────────────────────────────────────────────
async function checkKeywordTriggers(
  supabase: ReturnType<typeof createServiceClient>,
  userId: string,
  messageText: string,
  conversationId: string,
  contactId: string
) {
  const { data: flows } = await supabase
    .from("automations")
    .select("id, trigger_value")
    .eq("user_id", userId)
    .eq("trigger_type", "keyword")
    .eq("is_active", true);

  if (!flows?.length) return;

  const lowerText = messageText.toLowerCase().trim();

  for (const flow of flows) {
    const keywords = (flow.trigger_value ?? "")
      .split(",")
      .map((k: string) => k.trim().toLowerCase())
      .filter(Boolean);

    const matched = keywords.some((kw: string) =>
      lowerText === kw || lowerText.includes(kw)
    );
    if (!matched) continue;

    await supabase
      .from("conversations")
      .update({ status: "bot_handling", updated_at: new Date().toISOString() })
      .eq("id", conversationId);

    break;
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function buildMessagePreview(msg: IncomingMessage): string {
  switch (msg.type) {
    case "text":        return (msg.text?.body ?? "").substring(0, 100);
    case "image":       return "📷 Image";
    case "video":       return "🎥 Video";
    case "audio":       return "🎵 Audio";
    case "document":    return `📄 ${msg.document?.filename ?? "Document"}`;
    case "location":    return "📍 Location";
    case "button":      return `🔘 ${msg.button?.text ?? "Button reply"}`;
    case "interactive": return `💬 ${msg.interactive?.list_reply?.title ?? msg.interactive?.button_reply?.title ?? "Interactive"}`;
    default:            return "Message";
  }
}

function normalizeMessageType(type: string): string {
  const map: Record<string, string> = {
    text:        "text",
    image:       "image",
    video:       "video",
    audio:       "audio",
    document:    "document",
    location:    "location",
    button:      "button_reply",
    interactive: "list_reply",
  };
  return map[type] ?? "text";
}

function extractMessageContent(msg: IncomingMessage): Record<string, unknown> {
  const c: Record<string, unknown> = {};
  if (msg.text)        c.body       = msg.text.body;
  if (msg.image)       c.media_url  = msg.image.id;
  if (msg.video)       c.media_url  = msg.video.id;
  if (msg.audio)       c.media_url  = msg.audio.id;
  if (msg.document)    { c.media_url = msg.document.id; c.filename = msg.document.filename; }
  if (msg.location)    c.location   = msg.location;
  if (msg.button)      c.body       = msg.button.text;
  if (msg.interactive) c.interactive = msg.interactive;
  return c;
}

// ─── Webhook payload types ────────────────────────────────────────────────────
interface WebhookPayload {
  object: string;
  entry?: WebhookEntry[];
}

interface WebhookEntry {
  id: string;
  changes?: WebhookChange[];
}

interface WebhookChange {
  field: string;
  value?: WebhookValue;
}

interface WebhookValue {
  messaging_product?: string;
  metadata?: { display_phone_number: string; phone_number_id: string };
  statuses?: StatusUpdate[];
  messages?: IncomingMessage[];
  contacts?: { profile: { name: string }; wa_id: string }[];
}

interface StatusUpdate {
  id: string;
  status: "sent" | "delivered" | "read" | "failed";
  timestamp: string;
  recipient_id: string;
  errors?: { code: number; title: string; details?: string }[];
}

interface IncomingMessage {
  id: string;
  from: string;
  timestamp: string;
  type: string;
  contacts?: { profile: { name: string }; wa_id: string }[];
  text?:        { body: string };
  image?:       { id: string; mime_type?: string; sha256?: string; caption?: string };
  video?:       { id: string; mime_type?: string; sha256?: string; caption?: string };
  audio?:       { id: string; mime_type?: string; sha256?: string };
  document?:    { id: string; filename?: string; mime_type?: string; sha256?: string };
  location?:    { latitude: number; longitude: number; name?: string; address?: string };
  button?:      { payload: string; text: string };
  interactive?: {
    type: string;
    button_reply?: { id: string; title: string };
    list_reply?:   { id: string; title: string; description?: string };
  };
}
