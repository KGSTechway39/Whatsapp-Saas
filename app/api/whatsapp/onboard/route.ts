/**
 * POST /api/whatsapp/onboard  ── Server-side Embedded Signup handshake
 *
 * Receives the short-lived `code` returned by Meta's Facebook Login for
 * Business popup, exchanges it for a permanent system-user access token
 * against Graph v19.0, discovers the WABAs + phone numbers the token
 * grants access to, and persists one row per (waba_id, phone_number_id)
 * into the caller's organization.
 *
 * Tokens are AES-256-GCM encrypted at rest (lib/crypto.ts). Webhooks are
 * subscribed for every WABA so events flow back into our pipeline.
 *
 * Request body  : { code: string, wabaId?: string, phoneNumberId?: string }
 * Success (201) : { connected: ConnectedAccount[], created, refreshed }
 * Errors        : 401 unauthenticated, 400 invalid code / no WABA / no phone,
 *                 502 Graph API failure, 500 DB error.
 */

import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { getSessionUser } from "@/lib/auth";
import { encrypt } from "@/lib/crypto";
import { logger } from "@/lib/logger";

// ── Pinned Graph API version ───────────────────────────────────────────
// We intentionally pin v19.0 to match the SDK initialized on the client
// (see components/whatsapp/MetaConnectButton.tsx). Upgrading the version
// requires retesting Embedded Signup end-to-end.
const GRAPH = "https://graph.facebook.com/v19.0";
const APP_ID =
  process.env.META_APP_ID ?? process.env.NEXT_PUBLIC_META_APP_ID ?? "";
const APP_SECRET = process.env.META_APP_SECRET ?? "";

// ── Request/response shapes ────────────────────────────────────────────
interface OnboardRequest {
  code?: string;
  wabaId?: string;
  phoneNumberId?: string;
}

interface ConnectedAccount {
  id: string;
  wabaId: string;
  phoneNumberId: string;
  displayPhoneNumber: string;
  businessName: string | null;
  qualityRating: "GREEN" | "YELLOW" | "RED" | "UNKNOWN";
  status: "pending" | "active" | "suspended" | "disconnected";
  refreshed: boolean;
}

interface OauthExchangeResponse {
  access_token: string;
  token_type?: string;
  expires_in?: number;
}

interface MetaPhoneNumber {
  id: string;
  display_phone_number: string;
  verified_name?: string;
  quality_rating?: string;
  status?: string;
}

interface MetaWaba {
  id: string;
  name?: string;
  phone_numbers?: MetaPhoneNumber[];
}

// ──────────────────────────────────────────────────────────────────────
// Route handler
// ──────────────────────────────────────────────────────────────────────
export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!APP_ID || !APP_SECRET) {
    logger.error("[onboard] META_APP_ID / META_APP_SECRET not configured");
    return NextResponse.json(
      { error: "Server is not configured for Meta onboarding", code: "META_NOT_CONFIGURED" },
      { status: 500 },
    );
  }

  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: OnboardRequest;
  try {
    body = (await request.json()) as OnboardRequest;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const code = body.code?.trim();
  if (!code) {
    return NextResponse.json(
      { error: "Authorization code is required", code: "MISSING_CODE" },
      { status: 400 },
    );
  }

  logger.info("[onboard] handshake start", { userId: user.id });

  // 1) Code → permanent system-user access token
  let accessToken: string;
  let expiresInSeconds: number | null = null;
  try {
    const exchanged = await exchangeCodeForToken(code);
    accessToken = exchanged.access_token;
    expiresInSeconds = exchanged.expires_in ?? null;
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Token exchange failed";
    logger.error("[onboard] token exchange failed", { userId: user.id, msg });
    return NextResponse.json(
      { error: msg, code: "TOKEN_EXCHANGE_FAILED" },
      { status: 400 },
    );
  }

  // 2) Discover WABAs + phone numbers
  let wabas: MetaWaba[];
  try {
    wabas = await discoverWabas(accessToken);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Graph API call failed";
    logger.error("[onboard] WABA discovery failed", { userId: user.id, msg });
    return NextResponse.json(
      { error: msg, code: "GRAPH_API_ERROR" },
      { status: 502 },
    );
  }

  if (!wabas.length) {
    return NextResponse.json(
      {
        error: "No WhatsApp Business Accounts were shared. Re-launch signup and grant access to at least one WABA.",
        code: "NO_WABA",
      },
      { status: 400 },
    );
  }

  // 3) Resolve the user's active organization (create one if necessary)
  const supabase = createServiceClient();
  const orgId = await resolveOrgId(supabase, user.id, user.company || user.name);
  if (!orgId) {
    return NextResponse.json(
      { error: "Failed to resolve organization", code: "NO_ORG" },
      { status: 500 },
    );
  }

  // 4) Persist each (waba, phone) — encrypted token, single transaction-like flow
  const encryptedToken = await encrypt(accessToken);
  const expiresAtIso = expiresInSeconds
    ? new Date(Date.now() + expiresInSeconds * 1000).toISOString()
    : new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString();

  const connected: ConnectedAccount[] = [];
  let created = 0;
  let refreshed = 0;

  for (const waba of wabas) {
    if (body.wabaId && waba.id !== body.wabaId) continue;

    // Best-effort webhook subscription. Failure here is non-fatal — the
    // subscription may already exist or be added later by an admin.
    await subscribeWabaToApp(waba.id, accessToken).catch((err) => {
      logger.warn("[onboard] subscribe non-fatal failure", {
        wabaId: waba.id,
        msg: err instanceof Error ? err.message : String(err),
      });
    });

    for (const phone of waba.phone_numbers ?? []) {
      if (body.phoneNumberId && phone.id !== body.phoneNumberId) continue;

      // Refuse takeover: a phone_number_id may only live in one org.
      const { data: existing } = await supabase
        .from("whatsapp_accounts")
        .select("id, organization_id")
        .eq("phone_number_id", phone.id)
        .maybeSingle();

      if (existing && existing.organization_id !== orgId) {
        logger.warn("[onboard] phone already owned by another org", {
          phoneNumberId: phone.id,
          ownerOrg: existing.organization_id,
        });
        continue;
      }

      const row = {
        organization_id: orgId,
        waba_id: waba.id,
        phone_number_id: phone.id,
        display_phone_number: phone.display_phone_number,
        business_name: phone.verified_name || waba.name || null,
        access_token: encryptedToken,
        token_encrypted: true,
        token_expires_at: expiresAtIso,
        quality_rating: normalizeQuality(phone.quality_rating),
        status: phone.status === "VERIFIED" ? "active" : "pending",
        updated_at: new Date().toISOString(),
      } as const;

      if (existing) {
        const { error } = await supabase
          .from("whatsapp_accounts")
          .update(row)
          .eq("id", existing.id);

        if (error) {
          logger.error("[onboard] update failed", { err: error.message });
          return NextResponse.json(
            { error: error.message, code: "DB_ERROR" },
            { status: 500 },
          );
        }

        connected.push({
          id: existing.id,
          wabaId: waba.id,
          phoneNumberId: phone.id,
          displayPhoneNumber: row.display_phone_number,
          businessName: row.business_name,
          qualityRating: row.quality_rating,
          status: row.status,
          refreshed: true,
        });
        refreshed += 1;
        continue;
      }

      const { data: inserted, error: insertErr } = await supabase
        .from("whatsapp_accounts")
        .insert({ ...row, webhook_verified: false })
        .select("id")
        .single();

      if (insertErr || !inserted) {
        logger.error("[onboard] insert failed", {
          err: insertErr?.message,
          orgId,
          phoneNumberId: phone.id,
        });
        return NextResponse.json(
          { error: insertErr?.message ?? "Database insert failed", code: "DB_ERROR" },
          { status: 500 },
        );
      }

      connected.push({
        id: inserted.id,
        wabaId: waba.id,
        phoneNumberId: phone.id,
        displayPhoneNumber: row.display_phone_number,
        businessName: row.business_name,
        qualityRating: row.quality_rating,
        status: row.status,
        refreshed: false,
      });
      created += 1;
    }
  }

  if (!connected.length) {
    return NextResponse.json(
      {
        error: "No phone numbers connected. Verify WABA + phone permissions in Meta Business Manager.",
        code: "NO_PHONES",
      },
      { status: 400 },
    );
  }

  logger.info("[onboard] handshake complete", {
    userId: user.id,
    orgId,
    created,
    refreshed,
    total: connected.length,
  });

  return NextResponse.json({ connected, created, refreshed }, { status: 201 });
}

// ──────────────────────────────────────────────────────────────────────
// Graph API helpers — pinned to v19.0
// ──────────────────────────────────────────────────────────────────────

async function exchangeCodeForToken(code: string): Promise<OauthExchangeResponse> {
  const url = new URL(`${GRAPH}/oauth/access_token`);
  url.searchParams.set("client_id", APP_ID);
  url.searchParams.set("client_secret", APP_SECRET);
  url.searchParams.set("code", code);

  const res = await fetch(url.toString(), { method: "GET" });
  const data = (await res.json()) as OauthExchangeResponse & { error?: { message: string } };

  if (!res.ok || !data.access_token) {
    throw new Error(data.error?.message ?? `OAuth exchange failed (${res.status})`);
  }
  return data;
}

async function discoverWabas(accessToken: string): Promise<MetaWaba[]> {
  // Two discovery paths, depending on how the user granted access:
  //   (a) via Business Manager → /me/businesses → /{biz}/whatsapp_business_accounts
  //   (b) via direct WABA share  → /me/whatsapp_business_accounts
  const results: MetaWaba[] = [];

  // Path (a)
  const businesses = await graphGet<{ data: { id: string; name: string }[] }>(
    "/me/businesses",
    accessToken,
    { fields: "id,name" },
  ).catch(() => ({ data: [] }));

  for (const biz of businesses.data ?? []) {
    const wabaList = await graphGet<{ data: MetaWaba[] }>(
      `/${biz.id}/whatsapp_business_accounts`,
      accessToken,
      { fields: "id,name" },
    ).catch(() => ({ data: [] }));

    for (const w of wabaList.data ?? []) {
      const phones = await graphGet<{ data: MetaPhoneNumber[] }>(
        `/${w.id}/phone_numbers`,
        accessToken,
        { fields: "id,display_phone_number,verified_name,quality_rating,status" },
      ).catch(() => ({ data: [] }));

      results.push({ id: w.id, name: w.name, phone_numbers: phones.data ?? [] });
    }
  }

  // Path (b) — fall back if Business Manager yielded nothing
  if (results.length === 0) {
    const direct = await graphGet<{ data: MetaWaba[] }>(
      "/me/whatsapp_business_accounts",
      accessToken,
      { fields: "id,name" },
    ).catch(() => ({ data: [] }));

    for (const w of direct.data ?? []) {
      const phones = await graphGet<{ data: MetaPhoneNumber[] }>(
        `/${w.id}/phone_numbers`,
        accessToken,
        { fields: "id,display_phone_number,verified_name,quality_rating,status" },
      ).catch(() => ({ data: [] }));

      results.push({ id: w.id, name: w.name, phone_numbers: phones.data ?? [] });
    }
  }

  return results;
}

async function subscribeWabaToApp(wabaId: string, accessToken: string): Promise<void> {
  const url = new URL(`${GRAPH}/${wabaId}/subscribed_apps`);
  url.searchParams.set("access_token", accessToken);

  const res = await fetch(url.toString(), { method: "POST" });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(
      (data as { error?: { message: string } }).error?.message ??
        `subscribe failed (${res.status})`,
    );
  }
}

async function graphGet<T>(
  path: string,
  accessToken: string,
  params: Record<string, string> = {},
): Promise<T> {
  const url = new URL(`${GRAPH}${path}`);
  url.searchParams.set("access_token", accessToken);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  const res = await fetch(url.toString());
  const data = await res.json();
  if (!res.ok) {
    throw new Error(
      (data as { error?: { message: string } }).error?.message ??
        `Graph GET ${path} failed (${res.status})`,
    );
  }
  return data as T;
}

// ──────────────────────────────────────────────────────────────────────
// Org resolution + small helpers
// ──────────────────────────────────────────────────────────────────────

type SupabaseClient = ReturnType<typeof createServiceClient>;

async function resolveOrgId(
  supabase: SupabaseClient,
  userId: string,
  fallbackName: string | undefined,
): Promise<string | null> {
  // Preferred path — SQL helper (009_model_b_unified.sql)
  const { data: helper } = await supabase.rpc("ensure_personal_org", {
    p_user_id: userId,
    p_name: fallbackName || "My Workspace",
  });
  if (typeof helper === "string") return helper;

  // Fallback path if the helper hasn't been deployed yet.
  const { data: existing } = await supabase
    .from("organization_members")
    .select("organization_id")
    .eq("user_id", userId)
    .eq("status", "active")
    .limit(1)
    .maybeSingle();

  if (existing?.organization_id) return existing.organization_id;

  const slug = `org-${userId.replace(/-/g, "").slice(0, 12)}`;
  const { data: created } = await supabase
    .from("organizations")
    .insert({ name: fallbackName || "My Workspace", slug })
    .select("id")
    .single();
  if (!created?.id) return null;

  await supabase.from("organization_members").insert({
    organization_id: created.id,
    user_id: userId,
    role: "owner",
    status: "active",
    joined_at: new Date().toISOString(),
  });
  return created.id;
}

function normalizeQuality(q: string | undefined): "GREEN" | "YELLOW" | "RED" | "UNKNOWN" {
  switch ((q || "").toUpperCase()) {
    case "GREEN":  return "GREEN";
    case "YELLOW": return "YELLOW";
    case "RED":    return "RED";
    default:       return "UNKNOWN";
  }
}
