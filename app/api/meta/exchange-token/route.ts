/**
 * POST /api/meta/exchange-token
 *
 * Step 1 of the Embedded Signup pipeline.
 *
 * Takes the short-lived `code` returned by `FB.login`, exchanges it
 * against Graph v19.0 for a permanent system-user access token, calls
 * `debug_token` to learn the system_user_id + scopes, then returns
 * the discovered WABAs and phone numbers to the client.
 *
 * The access_token itself NEVER leaves the server — the response contains
 * only metadata. The plaintext token is stashed in a short-lived in-memory
 * cache keyed by `transferId`, which the client passes back to
 * /api/meta/save-account when it confirms which (waba, phone) to commit.
 *
 * Body    : { code: string }
 * Returns : {
 *   transferId: string,         // opaque handle for /api/meta/save-account
 *   expiresIn: number,          // seconds until the cached token expires (≤ 300)
 *   systemUserId: string | null,
 *   scopes: string[],
 *   wabas: Array<{ id, name, businessId, phoneNumbers: [...] }>
 * }
 */

import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { getSessionUser } from "@/lib/auth";
import { logger } from "@/lib/logger";
import { audit } from "@/lib/audit";
import {
  MetaApiError,
  debugToken,
  discoverWabas,
  exchangeCodeForToken,
} from "@/lib/meta-client";
import { putTokenInCache } from "@/lib/whatsapp/token-cache";

interface ExchangeTokenRequest {
  code?: string;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: ExchangeTokenRequest;
  try {
    body = (await req.json()) as ExchangeTokenRequest;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const code = body.code?.trim();
  if (!code) {
    return NextResponse.json(
      { error: "Authorization code is required", code: "MISSING_CODE" },
      { status: 400 },
    );
  }

  logger.info("[api/meta/exchange-token] start", { userId: user.id });

  let accessToken: string;
  let expiresIn: number | null = null;
  try {
    const exchanged = await exchangeCodeForToken(code);
    accessToken = exchanged.access_token;
    expiresIn = exchanged.expires_in ?? null;
  } catch (err) {
    return handleMetaError(req, user.id, "TOKEN_EXCHANGE_FAILED", err);
  }

  let systemUserId: string | null = null;
  let scopes: string[] = [];
  try {
    const dbg = await debugToken(accessToken);
    systemUserId = dbg.user_id ?? null;
    scopes = dbg.scopes ?? [];
  } catch (err) {
    logger.warn("[api/meta/exchange-token] debug_token failed (non-fatal)", {
      msg: err instanceof Error ? err.message : String(err),
    });
  }

  let wabas;
  try {
    wabas = await discoverWabas(accessToken);
  } catch (err) {
    return handleMetaError(req, user.id, "GRAPH_API_ERROR", err);
  }

  if (!wabas.length) {
    await audit({
      action: "embedded_signup.failure",
      userId: user.id,
      outcome: "failure",
      details: { reason: "NO_WABA" },
      request: req,
    });
    return NextResponse.json(
      {
        error: "No WhatsApp Business Accounts granted access. Restart signup and share at least one WABA.",
        code: "NO_WABA",
      },
      { status: 400 },
    );
  }

  // Stash the plaintext token for ~5 minutes; the client must call
  // /api/meta/save-account before the TTL expires.
  const transferId = randomUUID();
  const cacheTtlSeconds = 5 * 60;
  putTokenInCache(transferId, {
    token: accessToken,
    expiresInSeconds: expiresIn,
    systemUserId,
    scopes,
    userId: user.id,
    createdAt: Date.now(),
  }, cacheTtlSeconds);

  await audit({
    action: "embedded_signup.exchange_token",
    userId: user.id,
    details: {
      systemUserId,
      scopes,
      wabaCount: wabas.length,
      phoneCount: wabas.reduce((n, w) => n + (w.phone_numbers?.length ?? 0), 0),
    },
    request: req,
  });

  return NextResponse.json({
    transferId,
    expiresIn: cacheTtlSeconds,
    systemUserId,
    scopes,
    wabas: wabas.map((w) => ({
      id: w.id,
      name: w.name ?? null,
      businessId: w.business_id ?? null,
      phoneNumbers: (w.phone_numbers ?? []).map((p) => ({
        id: p.id,
        displayPhoneNumber: p.display_phone_number,
        verifiedName: p.verified_name ?? null,
        qualityRating: (p.quality_rating ?? "UNKNOWN").toUpperCase(),
        status: p.status ?? "UNVERIFIED",
        codeVerificationStatus: p.code_verification_status ?? null,
      })),
    })),
  });
}

async function handleMetaError(
  req: NextRequest,
  userId: string,
  errorCode: string,
  err: unknown,
): Promise<NextResponse> {
  const status = err instanceof MetaApiError ? err.httpStatus : 502;
  const msg = err instanceof Error ? err.message : "Graph API call failed";
  logger.error(`[api/meta/exchange-token] ${errorCode}`, { userId, msg });
  await audit({
    action: "embedded_signup.failure",
    userId,
    outcome: "failure",
    details: { stage: errorCode, msg },
    request: req,
  });
  return NextResponse.json({ error: msg, code: errorCode }, { status });
}
