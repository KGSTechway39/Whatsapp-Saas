/**
 * Centralised Meta Graph API client (pinned to v19.0).
 *
 * Every `/api/meta/*` route calls into this module rather than calling
 * fetch directly — keeps the version, retry policy, and error mapping in
 * a single place.
 */

import { logger } from "@/lib/logger";
import { GRAPH_SDK_BASE } from "@/lib/meta-version";

// Pinned to META_SDK_VERSION — this client handles Embedded Signup tokens, so it
// stays aligned with the browser FB SDK version (see lib/meta-version).
const GRAPH = GRAPH_SDK_BASE;

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
  error?: {
    message?: string; code?: number; type?: string; error_subcode?: number;
    /** Meta's actionable text — prefer these over `message`. */
    error_user_title?: string; error_user_msg?: string;
  };
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

/**
 * fetch wrapper that turns a connection-level failure (undici's opaque
 * "fetch failed") into an actionable MetaApiError carrying the real cause,
 * so callers/users see "Couldn't reach Meta (ENOTFOUND…)" instead of nothing.
 */
/**
 * Transport-level failures worth a second attempt. These are the network
 * saying "not right now", not Meta saying "no" — a Graph 4xx never reaches
 * here, because it is a successful HTTP response.
 */
/** Prefer Meta's error_user_msg — see lib/meta.ts for why. */
function metaErrorText(
  err: { message?: string; error_user_title?: string; error_user_msg?: string } | undefined,
  fallback: string,
): string {
  if (!err) return fallback;
  if (err.error_user_msg) {
    return err.error_user_title ? `${err.error_user_title}: ${err.error_user_msg}` : err.error_user_msg;
  }
  return err.message || fallback;
}

const RETRYABLE = new Set([
  "ETIMEDOUT", "ECONNRESET", "ECONNREFUSED", "EAI_AGAIN",
  "ENETUNREACH", "EPIPE", "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_SOCKET",
]);

const MAX_ATTEMPTS = 3;
/** Per-attempt ceiling. Without it a hung socket blocks a request handler. */
const ATTEMPT_TIMEOUT_MS = 15_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function graphFetch(url: string, init?: RequestInit): Promise<Response> {
  let lastDetail = "unknown";

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      return await fetch(url, {
        ...init,
        // Bound each attempt so a stalled connection fails fast enough to retry
        // rather than sitting until the platform's own request timeout.
        signal: init?.signal ?? AbortSignal.timeout(ATTEMPT_TIMEOUT_MS),
      });
    } catch (err) {
      const cause = (err as { cause?: { code?: string; message?: string } })?.cause;
      const code = cause?.code ?? (err as Error)?.name;
      lastDetail = cause?.code || cause?.message || (err instanceof Error ? err.message : "unknown");

      // AbortSignal.timeout surfaces as TimeoutError — a stall, so retryable.
      const retryable = RETRYABLE.has(String(code)) || String(code) === "TimeoutError";
      const hasAttemptsLeft = attempt < MAX_ATTEMPTS;

      if (!retryable || !hasAttemptsLeft) {
        logger.error("[meta-client] network error reaching Graph", {
          url: url.split("?")[0], detail: lastDetail, attempts: attempt,
        });
        break;
      }

      // Short exponential backoff (300ms, 900ms). Deliberately brief: a human
      // is waiting on the connect screen, and this is a blip not an outage.
      const backoff = 300 * 3 ** (attempt - 1);
      logger.warn("[meta-client] transient network error, retrying", {
        url: url.split("?")[0], detail: lastDetail, attempt, backoff,
      });
      await sleep(backoff);
    }
  }

  throw new MetaApiError(
    `Couldn't reach Meta after ${MAX_ATTEMPTS} attempts (network error: ${lastDetail}). ` +
      `This is usually temporary — wait a moment and try again.`,
    "NETWORK_ERROR",
    502,
  );
}

export async function graphGet<T>(
  path: string,
  accessToken: string,
  params: Record<string, string> = {},
): Promise<T> {
  const url = new URL(`${GRAPH}${path}`);
  url.searchParams.set("access_token", accessToken);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  const res = await graphFetch(url.toString());
  const data = (await res.json()) as MetaErrorEnvelope & Record<string, unknown>;

  if (!res.ok) {
    throw new MetaApiError(
      metaErrorText(data.error, `Graph GET ${path} failed (${res.status})`),
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

  const res = await graphFetch(url.toString(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = (await res.json()) as MetaErrorEnvelope & Record<string, unknown>;

  if (!res.ok) {
    throw new MetaApiError(
      metaErrorText(data.error, `Graph POST ${path} failed (${res.status})`),
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

  const res = await graphFetch(url.toString(), { method: "DELETE" });
  const data = (await res.json()) as MetaErrorEnvelope & Record<string, unknown>;

  if (!res.ok) {
    throw new MetaApiError(
      metaErrorText(data.error, `Graph DELETE ${path} failed (${res.status})`),
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

  const res = await graphFetch(url.toString());
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

  const res = await graphFetch(url.toString());
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
