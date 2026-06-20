const GRAPH = "https://graph.facebook.com/v20.0";
const APP_ID = process.env.META_APP_ID || process.env.NEXT_PUBLIC_META_APP_ID!;
const APP_SECRET = process.env.META_APP_SECRET!;

async function graphGet<T>(path: string, token: string, params: Record<string, string> = {}): Promise<T> {
  const url = new URL(`${GRAPH}${path}`);
  url.searchParams.set("access_token", token);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url.toString());
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || `Graph API error on ${path}`);
  return data as T;
}

async function graphPost<T>(path: string, token: string, body?: Record<string, unknown>): Promise<T> {
  const url = new URL(`${GRAPH}${path}`);
  url.searchParams.set("access_token", token);
  const res = await fetch(url.toString(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || `Graph API POST error on ${path}`);
  return data as T;
}

// Exchange short-lived OAuth code for user access token
export async function exchangeCodeForToken(code: string): Promise<string> {
  const url = new URL(`${GRAPH}/oauth/access_token`);
  url.searchParams.set("client_id", APP_ID);
  url.searchParams.set("client_secret", APP_SECRET);
  url.searchParams.set("code", code);
  const res = await fetch(url.toString());
  const data = await res.json();
  if (!res.ok || !data.access_token) throw new Error(data.error?.message || "Token exchange failed");
  return data.access_token as string;
}

// Exchange short-lived token for long-lived token (~60 days)
export async function extendToken(shortToken: string): Promise<string> {
  const url = new URL(`${GRAPH}/oauth/access_token`);
  url.searchParams.set("grant_type", "fb_exchange_token");
  url.searchParams.set("client_id", APP_ID);
  url.searchParams.set("client_secret", APP_SECRET);
  url.searchParams.set("fb_exchange_token", shortToken);
  const res = await fetch(url.toString());
  const data = await res.json();
  if (!res.ok || !data.access_token) throw new Error(data.error?.message || "Token extension failed");
  return data.access_token as string;
}

export interface PhoneNumberInfo {
  id: string;
  display_phone_number: string;
  verified_name: string;
  quality_rating: string;
  status: string;
}

export interface WABAInfo {
  id: string;
  name: string;
  phoneNumbers: PhoneNumberInfo[];
}

// Fetch all WABAs and their phone numbers for the given user token
export async function getWABAsForToken(userToken: string): Promise<WABAInfo[]> {
  const businessData = await graphGet<{ data: { id: string; name: string }[] }>(
    "/me/businesses",
    userToken,
    { fields: "id,name" }
  );

  const businesses = businessData.data || [];
  const results: WABAInfo[] = [];

  for (const biz of businesses) {
    try {
      const wabaData = await graphGet<{ data: { id: string; name: string }[] }>(
        `/${biz.id}/whatsapp_business_accounts`,
        userToken,
        { fields: "id,name" }
      );
      for (const waba of wabaData.data || []) {
        const numData = await graphGet<{ data: PhoneNumberInfo[] }>(
          `/${waba.id}/phone_numbers`,
          userToken,
          { fields: "id,display_phone_number,verified_name,quality_rating,status" }
        );
        results.push({ id: waba.id, name: waba.name, phoneNumbers: numData.data || [] });
      }
    } catch {
      // skip inaccessible businesses
    }
  }

  // If no businesses, try fetching WABAs directly (for users with direct WABA access)
  if (results.length === 0) {
    try {
      const direct = await graphGet<{ data: { id: string; name: string }[] }>(
        "/me/whatsapp_business_accounts",
        userToken,
        { fields: "id,name" }
      );
      for (const waba of direct.data || []) {
        const numData = await graphGet<{ data: PhoneNumberInfo[] }>(
          `/${waba.id}/phone_numbers`,
          userToken,
          { fields: "id,display_phone_number,verified_name,quality_rating,status" }
        );
        results.push({ id: waba.id, name: waba.name, phoneNumbers: numData.data || [] });
      }
    } catch {
      // ignore
    }
  }

  return results;
}

// Subscribe WABA to your Meta App to receive webhook events
export async function subscribeWABAToApp(wabaId: string, token: string): Promise<void> {
  await graphPost(`/${wabaId}/subscribed_apps`, token);
}

export interface SendTemplateParams {
  phoneNumberId: string;
  accessToken: string;
  to: string;
  templateName: string;
  languageCode?: string;
  components?: unknown[];
}

export interface SendMessageResult {
  messageId: string;
}

// Send a WhatsApp template message via Meta Graph API
export async function sendTemplateMessage({
  phoneNumberId,
  accessToken,
  to,
  templateName,
  languageCode = "en",
  components = [],
}: SendTemplateParams): Promise<SendMessageResult> {
  const data = await graphPost<{ messages: { id: string }[] }>(
    `/${phoneNumberId}/messages`,
    accessToken,
    {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to,
      type: "template",
      template: {
        name: templateName,
        language: { code: languageCode },
        components,
      },
    }
  );
  return { messageId: data.messages?.[0]?.id };
}

// ── TEMPLATE SYNC ──────────────────────────────────────────────────────────

export type MetaTemplateStatus = "APPROVED" | "PENDING" | "REJECTED" | "PAUSED" | "DISABLED" | "PENDING_DELETION" | "FLAGGED" | "IN_APPEAL";
export type MetaTemplateCategory = "MARKETING" | "UTILITY" | "AUTHENTICATION";

export interface MetaTemplateComponent {
  type: "HEADER" | "BODY" | "FOOTER" | "BUTTONS";
  format?: "TEXT" | "IMAGE" | "VIDEO" | "DOCUMENT";
  text?: string;
  example?: { body_text?: string[][]; header_text?: string[]; header_handle?: string[] };
  buttons?: { type: string; text: string; url?: string; phone_number?: string }[];
}

export interface MetaTemplate {
  id: string;
  name: string;
  status: MetaTemplateStatus;
  category: MetaTemplateCategory;
  language: string;
  components: MetaTemplateComponent[];
  rejected_reason?: string;
  quality_score?: { score: string; date: number };
}

/** Fetch all message templates for one WABA. Auto-paginates. */
export async function getMessageTemplates(wabaId: string, token: string): Promise<MetaTemplate[]> {
  const all: MetaTemplate[] = [];
  let url: string | null = `${GRAPH}/${wabaId}/message_templates?limit=200&fields=id,name,status,category,language,components,rejected_reason,quality_score`;

  while (url) {
    const u = new URL(url);
    u.searchParams.set("access_token", token);
    const res = await fetch(u.toString());
    const data: { data?: MetaTemplate[]; paging?: { next?: string } } = await res.json();
    if (!res.ok) {
      const err = (data as { error?: { message?: string } }).error;
      throw new Error(err?.message || `Graph error ${res.status}`);
    }
    all.push(...(data.data || []));
    url = data.paging?.next || null;
  }
  return all;
}

/** Extract the BODY text from a Meta template's components array. */
export function extractTemplateBody(components: MetaTemplateComponent[]): { body: string; footer: string; variables: string[] } {
  const bodyComp   = components.find((c) => c.type === "BODY");
  const footerComp = components.find((c) => c.type === "FOOTER");
  const body       = bodyComp?.text || "";
  const footer     = footerComp?.text || "";

  const matches = Array.from(body.matchAll(/\{\{(\d+)\}\}/g));
  const uniqueIndexes = Array.from(new Set(matches.map((m) => Number(m[1])))).sort((a, b) => a - b);

  // Use example values from Meta if provided
  const examples = bodyComp?.example?.body_text?.[0] || [];
  const variables = uniqueIndexes.map((i) => examples[i - 1] || `var_${i}`);

  return { body, footer, variables };
}

/** Map Meta status → our DB status. We collapse PAUSED/DISABLED/etc into REJECTED. */
export function normalizeTemplateStatus(s: MetaTemplateStatus): "APPROVED" | "PENDING" | "REJECTED" {
  if (s === "APPROVED") return "APPROVED";
  if (s === "PENDING" || s === "IN_APPEAL") return "PENDING";
  return "REJECTED";
}

// Send a document message (link-based) — e.g. resume delivery
export async function sendDocumentMessage(
  phoneNumberId: string,
  accessToken: string,
  to: string,
  documentUrl: string,
  filename?: string,
  caption?: string
): Promise<SendMessageResult> {
  const data = await graphPost<{ messages: { id: string }[] }>(
    `/${phoneNumberId}/messages`,
    accessToken,
    {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to,
      type: "document",
      document: { link: documentUrl, filename, caption },
    }
  );
  return { messageId: data.messages?.[0]?.id };
}

// Send a plain text message (for testing / automation)
export async function sendTextMessage(
  phoneNumberId: string,
  accessToken: string,
  to: string,
  text: string
): Promise<SendMessageResult> {
  const data = await graphPost<{ messages: { id: string }[] }>(
    `/${phoneNumberId}/messages`,
    accessToken,
    {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to,
      type: "text",
      text: { body: text },
    }
  );
  return { messageId: data.messages?.[0]?.id };
}
