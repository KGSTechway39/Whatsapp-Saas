/**
 * Repository helpers used by the /api/meta/* onboarding routes.
 *
 * These persist a connected WhatsApp number into the canonical
 * `whatsapp_numbers` table (keyed by user_id) — the same table that
 * My Numbers, Send, Campaigns and every other feature read from. This
 * keeps a number connected via Embedded Signup immediately usable across
 * the whole app, with no separate account/token tables to keep in sync.
 *
 * Token storage: the access token is encrypted at rest (AES-256-GCM via
 * lib/crypto) with token_encrypted=true. The send paths decrypt on read
 * (decrypt() is a no-op on legacy plaintext rows, so old data keeps working).
 * RLS additionally prevents anon/authenticated roles from reading the table.
 */

import { createHash } from "crypto";
import { createServiceClient } from "@/lib/supabase/server";
import { encrypt } from "@/lib/crypto";
import type { MetaPhoneNumber, MetaWaba } from "@/lib/meta-client";

type SupabaseClient = ReturnType<typeof createServiceClient>;

export interface SaveAccountInput {
  /** Owning user id (the tenant). Named organizationId for call-site compatibility. */
  organizationId: string;
  waba: MetaWaba;
  phone: MetaPhoneNumber;
  accessToken: string;
  tokenExpiresAt: string | null;
  systemUserId: string | null;
  scopes: string[];
}

export interface SaveAccountResult {
  /** whatsapp_numbers.id — used by callers as the account handle. */
  accountId: string;
  phoneRowId: string;
  tokenRowId: string;
  refreshed: boolean;
}

/** sha256 a plaintext to a hex fingerprint. */
export function fingerprint(plaintext: string): string {
  return createHash("sha256").update(plaintext).digest("hex");
}

/**
 * Resolve the tenant id for a user. In the deployed (user_id-based) schema
 * the tenant *is* the user, so we simply return the user id. The signature
 * is kept so the route call-sites don't change.
 */
export async function resolveOrgId(
  _supabase: SupabaseClient,
  userId: string,
  _fallbackName: string | undefined,
): Promise<string | null> {
  return userId || null;
}

function realMetaAppId(): string | null {
  const v = (process.env.NEXT_PUBLIC_META_APP_ID ?? "").trim();
  if (!v || v.toLowerCase().startsWith("your_")) return null;
  return v;
}

/**
 * Persist a single (waba, phone) pair into whatsapp_numbers.
 * Idempotent: an existing row for (user_id, phone_number_id) is updated in
 * place; otherwise a new row is inserted (first number becomes primary).
 */
export async function saveAccount(
  args: SaveAccountInput,
): Promise<SaveAccountResult> {
  const supabase = createServiceClient();
  const userId = args.organizationId;

  const displayPhone = args.phone.display_phone_number || args.phone.id;
  const displayName =
    args.phone.verified_name || args.waba.name || displayPhone;
  const status = args.phone.status === "VERIFIED" ? "active" : "inactive";

  // Encrypt the token at rest. Send paths decrypt on read.
  const encryptedToken = await encrypt(args.accessToken);

  const basePayload = {
    user_id: userId,
    phone_number: displayPhone,
    display_name: displayName,
    waba_id: args.waba.id,
    phone_number_id: args.phone.id,
    access_token: encryptedToken,
    token_encrypted: true,
    token_expires_at: args.tokenExpiresAt,
    meta_app_id: realMetaAppId(),
    status,
    updated_at: new Date().toISOString(),
  };

  // Existing row for this user + phone?
  const { data: existing } = await supabase
    .from("whatsapp_numbers")
    .select("id")
    .eq("user_id", userId)
    .eq("phone_number_id", args.phone.id)
    .maybeSingle();

  if (existing) {
    const { error } = await supabase
      .from("whatsapp_numbers")
      .update(basePayload)
      .eq("id", existing.id);
    if (error) throw new Error(`whatsapp_numbers update failed: ${error.message}`);
    return {
      accountId: existing.id,
      phoneRowId: existing.id,
      tokenRowId: existing.id,
      refreshed: true,
    };
  }

  // First number for this user becomes the primary.
  const { count } = await supabase
    .from("whatsapp_numbers")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId);

  const { data: inserted, error } = await supabase
    .from("whatsapp_numbers")
    .insert({
      ...basePayload,
      is_primary: (count ?? 0) === 0,
      webhook_verified: false,
    })
    .select("id")
    .single();
  if (error || !inserted) {
    throw new Error(`whatsapp_numbers insert failed: ${error?.message}`);
  }

  return {
    accountId: inserted.id,
    phoneRowId: inserted.id,
    tokenRowId: inserted.id,
    refreshed: false,
  };
}

export function normalizeQuality(
  q: string | undefined,
): "GREEN" | "YELLOW" | "RED" | "UNKNOWN" {
  switch ((q || "").toUpperCase()) {
    case "GREEN":  return "GREEN";
    case "YELLOW": return "YELLOW";
    case "RED":    return "RED";
    default:       return "UNKNOWN";
  }
}
