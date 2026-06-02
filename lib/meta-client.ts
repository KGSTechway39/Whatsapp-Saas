/**
 * Centralised Meta Graph API client (pinned to v19.0).
 *
 * Every `/api/meta/*` route calls into this module rather than calling
 * fetch directly — keeps the version, retry policy, and error mapping in
 * a single place.
 */

import { logger } from "@/lib/logger";

const GRAPH = "https://graph.facebook.com/v19.0";

const APP_ID =
  process.env.META_APP_ID ?? process.env.NEXT_PUBLIC_META_APP_ID ?? "";
const APP_SECRET = process.env.META_APP_SECRET ?? "";

export class MetaApiError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly httpStatus: number,
    readonly metaCode?: number,
    readonly raw?: unknown,
  ) {
    super(message);
    this.name = "MetaApiError";
  }
}

interface MetaErrorEnvelope {
  error?: { message?: string; code?: number; type?: string };
}

export interface MetaPhoneNumber {
  id: string;
  display_phone_number: string;
  verified_name?: string;
  quality_rating?: string;
  status?: string;
  code_verification_status?: string;
}

export interface MetaWaba {
  id: string;
  name?: string;
  business_id?: string;
  phone_numbers?: MetaPhoneNumber[];
}

export interface ExchangedToken {
  access_token: string;
  token_type?: string;
  expires_in?: number;
}

export interface TokenDebug {
  app_id?: string;
  user_id?: string;
  scopes?: string[];
  expires_at?: number;
  is_valid?: boolean;
}

export function assertConfigured(): void {
  if (!APP_ID || !APP_SECRET) {
    throw new MetaApiError(
      "Meta app id / secret are not configured on the server",
      "META_NOT_CONFIGURED",
      500,
    );
  }
}

// ─── Low-level HTTP ───────────────────────────────────────────────────────

export async function graphGet<T>(
  path: string,
  accessToken: string,
  params: Record<string, string> = {},
): Promise<T> {
  const url = new URL(`${GRAPH}${path}`);
  url.searchParams.set("access_token", accessToken);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  const res = await fetch(url.toString());
  const data = (await res.json()) as MetaErrorEnvelope & Record<string, unknown>;

  if (!res.ok) {
    throw new MetaApiError(
      data.error?.message ?? `Graph GET ${path} failed (${res.status})`,
      mapErrorCode(data.error?.code),
      res.status,
      data.error?.code,
      data,
    );
  }
  return data as T;
}

export async function graphPost<T>(
  path: string,
  accessToken: string,
  body?: Record<string, unknown>,
): Promise<T> {
  const url = new URL(`${GRAPH}${path}`);
  url.searchParams.set("access_token", accessToken);

  const res = await fetch(url.toString(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = (await res.json()) as MetaErrorEnvelope & Record<string, unknown>;

  if (!res.ok) {
    throw new MetaApiError(
      data.error?.message ?? `Graph POST ${path} failed (${res.status})`,
      mapErrorCode(data.error?.code),
      res.status,
      data.error?.code,
      data,
    );
  }
  return data as T;
}

export async function graphDelete<T>(
  path: string,
  accessToken: string,
): Promise<T> {
  const url = new URL(`${GRAPH}${path}`);
  url.searchParams.set("access_token", accessToken);

  const res = await fetch(url.toString(), { method: "DELETE" });
  const data = (await res.json()) as MetaErrorEnvelope & Record<string, unknown>;

  if (!res.ok) {
    throw new MetaApiError(
      data.error?.message ?? `Graph DELETE ${path} failed (${res.status})`,
      mapErrorCode(data.error?.code),
      res.status,
      data.error?.code,
      data,
    );
  }
  return data as T;
}

// ─── OAuth + discovery ───────────────────────────────────────────────────

export async function exchangeCodeForToken(code: string): Promise<ExchangedToken> {
  assertConfigured();

  const url = new URL(`${GRAPH}/oauth/access_token`);
  url.searchParams.set("client_id", APP_ID);
  url.searchParams.set("client_secret", APP_SECRET);
  url.searchParams.set("code", code);

  const res = await fetch(url.toString());
  const data = (await res.json()) as ExchangedToken & MetaErrorEnvelope;

  if (!res.ok || !data.access_token) {
    throw new MetaApiError(
      data.error?.message ?? `Token exchange failed (${res.status})`,
      "TOKEN_EXCHANGE_FAILED",
      res.status,
      data.error?.code,
      data,
    );
  }

  return data;
}

export async function debugToken(accessToken: string): Promise<TokenDebug> {
  assertConfigured();

  const url = new URL(`${GRAPH}/debug_token`);
  url.searchParams.set("input_token", accessToken);
  url.searchParams.set("access_token", `${APP_ID}|${APP_SECRET}`);

  const res = await fetch(url.toString());
  const data = (await res.json()) as { data?: TokenDebug } & MetaErrorEnvelope;

  if (!res.ok || !data.data) {
    throw new MetaApiError(
      data.error?.message ?? `debug_token failed (${res.status})`,
      "DEBUG_TOKEN_FAILED",
      res.status,
    );
  }
  return data.data;
}

export async function discoverWabas(accessToken: string): Promise<MetaWaba[]> {
  const results: MetaWaba[] = [];

  // 1) Via Business Manager
  const businesses = await graphGet<{ data: { id: string; name: string }[] }>(
    "/me/businesses",
    accessToken,
    { fields: "id,name" },
  ).catch((err) => {
    logger.warn("[meta-client] /me/businesses failed", { msg: errMsg(err) });
    return { data: [] as { id: string; name: string }[] };
  });

  for (const biz of businesses.data ?? []) {
    const wabas = await graphGet<{ data: MetaWaba[] }>(
      `/${biz.id}/whatsapp_business_accounts`,
      accessToken,
      { fields: "id,name" },
    ).catch(() => ({ data: [] as MetaWaba[] }));

    for (const w of wabas.data ?? []) {
      const phones = await graphGet<{ data: MetaPhoneNumber[] }>(
        `/${w.id}/phone_numbers`,
        accessToken,
        { fields: "id,display_phone_number,verified_name,quality_rating,status,code_verification_status" },
      ).catch(() => ({ data: [] as MetaPhoneNumber[] }));

      results.push({
        id: w.id,
        name: w.name,
        business_id: biz.id,
        phone_numbers: phones.data,
      });
    }
  }

  // 2) Fallback — direct WABA grant
  if (!results.length) {
    const direct = await graphGet<{ data: MetaWaba[] }>(
      "/me/whatsapp_business_accounts",
      accessToken,
      { fields: "id,name" },
    ).catch(() => ({ data: [] as MetaWaba[] }));

    for (const w of direct.data ?? []) {
      const phones = await graphGet<{ data: MetaPhoneNumber[] }>(
        `/${w.id}/phone_numbers`,
        accessToken,
        { fields: "id,display_phone_number,verified_name,quality_rating,status,code_verification_status" },
      ).catch(() => ({ data: [] as MetaPhoneNumber[] }));

      results.push({ id: w.id, name: w.name, phone_numbers: phones.data });
    }
  }

  return results;
}

// ─── Webhook management ──────────────────────────────────────────────────

export async function subscribeWabaToApp(
  wabaId: string,
  accessToken: string,
): Promise<{ success: boolean; raw: unknown }> {
  const raw = await graphPost<{ success?: boolean }>(
    `/${wabaId}/subscribed_apps`,
    accessToken,
  );
  return { success: raw.success !== false, raw };
}

export async function unsubscribeWabaFromApp(
  wabaId: string,
  accessToken: string,
): Promise<{ success: boolean; raw: unknown }> {
  const raw = await graphDelete<{ success?: boolean }>(
    `/${wabaId}/subscribed_apps`,
    accessToken,
  );
  return { success: raw.success !== false, raw };
}

// ─── helpers ─────────────────────────────────────────────────────────────

function mapErrorCode(metaCode: number | undefined): string {
  if (!metaCode) return "META_UNKNOWN";
  if (metaCode === 190)    return "INVALID_TOKEN";
  if (metaCode === 10)     return "PERMISSION_DENIED";
  if (metaCode === 200)    return "PERMISSION_REQUIRED";
  if (metaCode === 100)    return "INVALID_PARAMETER";
  if (metaCode === 130429) return "RATE_LIMITED";
  return `META_${metaCode}`;
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
