import { createClient } from "@/lib/supabase/server";

const GRAPH_API = "https://graph.facebook.com/v21.0";
const PLATFORM_FEE_PER_MSG = 0.001; // ₹0.001 markup per message
const MAX_RETRIES = 3;
const RETRY_DELAYS_MS = [1000, 2000, 4000];
const MAX_PER_SECOND = 80; // stay safely under Meta's 500/s limit

// Per-WABA sliding-window timestamps (in-process; reset on cold start)
const rateLimitWindows = new Map<string, number[]>();

const META_ERRORS: Record<number, string> = {
  4:      "App call limit reached. Too many requests.",
  10:     "Permission denied. Check WABA permissions.",
  100:    "Invalid parameter in request.",
  130429: "Rate limit reached. Retrying shortly.",
  130472: "User number not part of experiment.",
  131000: "Internal error. Please try again.",
  131005: "Access denied. Insufficient permissions.",
  131008: "Required parameter missing.",
  131009: "Parameter value not valid.",
  131016: "Service unavailable. Retrying shortly.",
  131021: "Sender and recipient are the same number.",
  131026: "Message undeliverable. Recipient may be unreachable or have blocked you.",
  131042: "Business eligibility or payment issue.",
  131045: "Message failed — recipient has not messaged in the last 24 hours.",
  131047: "Re-engagement message failed — 24-hour conversation window closed.",
  131051: "Unsupported message type.",
  131052: "Media download error.",
  131053: "Media upload error.",
  132000: "Template parameter count mismatch.",
  132001: "Template name or language not found.",
  132005: "Template hydration error — check variable values.",
  132007: "Template contains a disallowed character.",
  132012: "Template button parameter format mismatch.",
  133000: "Phone number de-registered.",
  133004: "Server temporarily unavailable.",
  133010: "Phone number not registered on WhatsApp.",
  135000: "Generic user error.",
};

function mapMetaError(code: number, fallback?: string): string {
  return META_ERRORS[code] ?? fallback ?? `Meta API error (code ${code})`;
}

async function throttle(wabaId: string): Promise<void> {
  const now = Date.now();
  const window = (rateLimitWindows.get(wabaId) ?? []).filter((t) => now - t < 1000);

  if (window.length >= MAX_PER_SECOND) {
    const wait = 1000 - (now - window[0]) + 10;
    await new Promise((r) => setTimeout(r, wait));
    return throttle(wabaId);
  }

  window.push(now);
  rateLimitWindows.set(wabaId, window);
}

export type MessageType =
  | "template"
  | "text"
  | "image"
  | "video"
  | "document"
  | "audio";

export interface SendMessageParams {
  organizationId: string;
  to: string; // phone with country code, no leading +
  type: MessageType;
  // template
  templateName?: string;
  languageCode?: string;
  components?: unknown[];
  // text / media
  text?: string;
  mediaUrl?: string;
  caption?: string;
  filename?: string;
  // optional targeting
  whatsappAccountId?: string;
  campaignId?: string;
  contactId?: string;
}

export interface SendMessageResult {
  success: boolean;
  messageId?: string;    // our DB id
  waMessageId?: string;  // Meta's message id
  error?: string;
}

export async function sendMessage(
  params: SendMessageParams
): Promise<SendMessageResult> {
  const supabase = createClient();

  // Resolve WhatsApp account
  let q = supabase
    .from("whatsapp_accounts")
    .select("id, waba_id, phone_number_id, access_token")
    .eq("organization_id", params.organizationId)
    .eq("status", "active");

  if (params.whatsappAccountId) q = q.eq("id", params.whatsappAccountId);

  const { data: account } = await q.limit(1).single();

  if (!account?.access_token) {
    return {
      success: false,
      error: "No active WhatsApp account found. Please reconnect.",
    };
  }

  const messageBody = buildMessageBody(params);
  if (!messageBody) {
    return { success: false, error: "Invalid message type or missing required fields." };
  }

  await throttle(account.waba_id);

  let waMessageId: string | undefined;
  let lastError = "";

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(
        `${GRAPH_API}/${account.phone_number_id}/messages`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${account.access_token}`,
          },
          body: JSON.stringify(messageBody),
        }
      );

      const data = await res.json();

      if (res.ok && data.messages?.[0]?.id) {
        waMessageId = data.messages[0].id as string;
        break;
      }

      const errCode: number = data.error?.code ?? 0;
      lastError = mapMetaError(errCode, data.error?.message);

      // Retryable: rate limit or transient server errors
      const retryable = errCode === 130429 || errCode === 131016 || errCode === 133004;
      if (retryable && attempt < MAX_RETRIES) {
        await new Promise((r) => setTimeout(r, RETRY_DELAYS_MS[attempt]));
        continue;
      }
      break;
    } catch (err) {
      lastError = err instanceof Error ? err.message : "Network error";
      if (attempt < MAX_RETRIES) {
        await new Promise((r) => setTimeout(r, RETRY_DELAYS_MS[attempt]));
      }
    }
  }

  const metaCost = 0.005;
  const totalCost = metaCost + PLATFORM_FEE_PER_MSG;

  const { data: inserted } = await supabase
    .from("messages")
    .insert({
      organization_id: params.organizationId,
      campaign_id: params.campaignId ?? null,
      contact_id: params.contactId ?? null,
      whatsapp_account_id: account.id,
      wa_message_id: waMessageId ?? null,
      direction: "outbound",
      type: params.type,
      content: buildContentJson(params),
      status: waMessageId ? "sent" : "failed",
      error_message: lastError || null,
      meta_cost: metaCost,
      platform_fee: PLATFORM_FEE_PER_MSG,
      sent_at: waMessageId ? new Date().toISOString() : null,
    })
    .select("id")
    .single();

  if (waMessageId) {
    await supabase.rpc("debit_wallet", {
      p_org_id: params.organizationId,
      p_amount: totalCost,
      p_desc: `WhatsApp ${params.type} to ${params.to}`,
      p_ref_id: waMessageId,
    });
  }

  if (!waMessageId) {
    return { success: false, error: lastError || "Send failed after retries." };
  }

  return { success: true, messageId: inserted?.id, waMessageId };
}

function buildMessageBody(
  p: SendMessageParams
): Record<string, unknown> | null {
  const base = {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: p.to,
  };

  switch (p.type) {
    case "template":
      if (!p.templateName) return null;
      return {
        ...base,
        type: "template",
        template: {
          name: p.templateName,
          language: { code: p.languageCode ?? "en" },
          components: p.components ?? [],
        },
      };
    case "text":
      if (!p.text) return null;
      return { ...base, type: "text", text: { body: p.text, preview_url: false } };
    case "image":
      if (!p.mediaUrl) return null;
      return { ...base, type: "image", image: { link: p.mediaUrl, caption: p.caption } };
    case "video":
      if (!p.mediaUrl) return null;
      return { ...base, type: "video", video: { link: p.mediaUrl, caption: p.caption } };
    case "document":
      if (!p.mediaUrl) return null;
      return {
        ...base,
        type: "document",
        document: { link: p.mediaUrl, filename: p.filename, caption: p.caption },
      };
    case "audio":
      if (!p.mediaUrl) return null;
      return { ...base, type: "audio", audio: { link: p.mediaUrl } };
    default:
      return null;
  }
}

function buildContentJson(p: SendMessageParams): Record<string, unknown> {
  const c: Record<string, unknown> = {};
  if (p.text) c.body = p.text;
  if (p.templateName) c.template_name = p.templateName;
  if (p.components) c.variables = p.components;
  if (p.mediaUrl) c.media_url = p.mediaUrl;
  if (p.caption) c.caption = p.caption;
  if (p.filename) c.filename = p.filename;
  return c;
}
