/**
 * API key generation, hashing, and request authentication for the public REST API.
 *
 * Format: `wasend_{env}_{32 hex chars}`  e.g. `wasend_live_a1b2c3...`
 * We store only:
 *   - key_prefix  : first 20 chars (for display in the dashboard)
 *   - key_hash    : SHA-256 of the full key (for verification)
 * The full key is shown to the user EXACTLY ONCE on creation.
 */

import { createHash, randomBytes } from "crypto";
import { createServiceClient } from "@/lib/supabase/server";
import type { NextRequest } from "next/server";

export interface ApiKeyContext {
  userId: string;
  apiKeyId: string;
  scopes: string[];
  environment: "live" | "test";
  rateLimitPerMin: number;
}

export interface GeneratedApiKey {
  fullKey: string;       // shown once
  prefix: string;        // safe to display
  hash: string;          // stored
}

/** Generate a new API key with `wsk_{env}_{32 hex}` format. */
export function generateApiKey(env: "live" | "test" = "live"): GeneratedApiKey {
  const random = randomBytes(24).toString("hex");
  const body   = random.slice(0, 32);
  const fullKey = `wsk_${env}_${body}`;
  const prefix  = fullKey.slice(0, 17);          // wsk_live_a1b2c3d4
  const hash    = hashKey(fullKey);
  return { fullKey, prefix, hash };
}

export function hashKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

// ── Request authentication ────────────────────────────────────────────────

const SCOPE_INHERITANCE: Record<string, string[]> = {
  // 'write' scopes implicitly grant 'read' on the same resource.
  "messages:write":   ["messages:write", "messages:read"],
  "contacts:write":   ["contacts:write", "contacts:read"],
  "templates:write":  ["templates:write", "templates:read"],
  "campaigns:write":  ["campaigns:write", "campaigns:read"],
};

export class ApiAuthError extends Error {
  status: number;
  code: string;
  constructor(message: string, status = 401, code = "UNAUTHORIZED") {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/**
 * Extract bearer token from `Authorization: Bearer wasend_…`, look up the
 * matching api_keys row, verify it's active, and return the calling context.
 *
 * Side effects: increments request_count and updates last_used_at. Best-effort
 * rate limiting via the per-key window in the api_keys row itself.
 */
export async function authenticateApiKey(req: NextRequest): Promise<ApiKeyContext> {
  const auth = req.headers.get("authorization") || "";
  const match = auth.match(/^Bearer\s+(wsk_(?:live|test)_[a-f0-9]{32})$/i);
  if (!match) throw new ApiAuthError("Missing or invalid Authorization header", 401, "INVALID_AUTH_HEADER");

  const fullKey = match[1];
  const hash = hashKey(fullKey);

  const supabase = createServiceClient();
  const { data: row, error } = await supabase
    .from("api_keys")
    .select("id, user_id, scopes, environment, rate_limit_per_min, is_active, expires_at, request_count")
    .eq("key_hash", hash)
    .single();

  if (error || !row) throw new ApiAuthError("Invalid API key", 401, "INVALID_KEY");
  if (!row.is_active) throw new ApiAuthError("API key revoked", 401, "KEY_REVOKED");
  if (row.expires_at && new Date(row.expires_at) < new Date()) {
    throw new ApiAuthError("API key expired", 401, "KEY_EXPIRED");
  }

  // Best-effort touch — don't block on failure.
  supabase
    .from("api_keys")
    .update({ last_used_at: new Date().toISOString(), request_count: (row.request_count || 0) + 1 })
    .eq("id", row.id)
    .then(() => {}, () => {});

  return {
    userId: row.user_id,
    apiKeyId: row.id,
    scopes: row.scopes || [],
    environment: row.environment as "live" | "test",
    rateLimitPerMin: row.rate_limit_per_min || 60,
  };
}

/** Throws unless the context's scopes cover the required scope. */
export function assertScope(ctx: ApiKeyContext, required: string): void {
  const expanded = new Set<string>();
  for (const s of ctx.scopes) {
    expanded.add(s);
    for (const inherited of SCOPE_INHERITANCE[s] || []) expanded.add(inherited);
  }
  if (!expanded.has(required)) {
    throw new ApiAuthError(`Missing scope: ${required}`, 403, "INSUFFICIENT_SCOPE");
  }
}

// ── In-memory rate limiter (single-instance) ─────────────────────────────

const rateBuckets = new Map<string, { count: number; resetAt: number }>();

export function checkRateLimit(ctx: ApiKeyContext): { allowed: boolean; remaining: number; resetAt: number } {
  const now = Date.now();
  const bucket = rateBuckets.get(ctx.apiKeyId);
  if (!bucket || bucket.resetAt < now) {
    const fresh = { count: 1, resetAt: now + 60_000 };
    rateBuckets.set(ctx.apiKeyId, fresh);
    return { allowed: true, remaining: ctx.rateLimitPerMin - 1, resetAt: fresh.resetAt };
  }
  bucket.count += 1;
  return {
    allowed: bucket.count <= ctx.rateLimitPerMin,
    remaining: Math.max(0, ctx.rateLimitPerMin - bucket.count),
    resetAt: bucket.resetAt,
  };
}

/** Wrapper that does auth + scope + rate-limit in one call. */
export async function withApiAuth(
  req: NextRequest,
  required: string,
): Promise<ApiKeyContext> {
  const ctx = await authenticateApiKey(req);
  assertScope(ctx, required);
  const rl = checkRateLimit(ctx);
  if (!rl.allowed) {
    throw new ApiAuthError(
      `Rate limit exceeded (${ctx.rateLimitPerMin}/min). Resets at ${new Date(rl.resetAt).toISOString()}`,
      429,
      "RATE_LIMITED",
    );
  }
  return ctx;
}

export const ALL_SCOPES = [
  { key: "messages:write",  label: "Send messages",       group: "Messages" },
  { key: "messages:read",   label: "Read message status", group: "Messages" },
  { key: "contacts:write",  label: "Create/update contacts", group: "Contacts" },
  { key: "contacts:read",   label: "List contacts",       group: "Contacts" },
  { key: "templates:read",  label: "List templates",      group: "Templates" },
  { key: "campaigns:read",  label: "List campaigns",      group: "Campaigns" },
] as const;
