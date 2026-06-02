/**
 * Repository helpers used by the /api/meta/* routes. Centralises the
 * Supabase writes so each route stays thin.
 */

import { createHash } from "crypto";
import { createServiceClient } from "@/lib/supabase/server";
import { encrypt } from "@/lib/crypto";
import type { MetaPhoneNumber, MetaWaba } from "@/lib/meta-client";

type SupabaseClient = ReturnType<typeof createServiceClient>;

export interface SaveAccountInput {
  organizationId: string;
  waba: MetaWaba;
  phone: MetaPhoneNumber;
  accessToken: string;       // plaintext — encrypted here before write
  tokenExpiresAt: string | null;
  systemUserId: string | null;
  scopes: string[];
}

export interface SaveAccountResult {
  accountId: string;
  phoneRowId: string;
  tokenRowId: string;
  refreshed: boolean;
}

/** sha256 a plaintext to a hex fingerprint — used to detect duplicate tokens. */
export function fingerprint(plaintext: string): string {
  return createHash("sha256").update(plaintext).digest("hex");
}

export async function resolveOrgId(
  supabase: SupabaseClient,
  userId: string,
  fallbackName: string | undefined,
): Promise<string | null> {
  const { data } = await supabase.rpc("ensure_personal_org", {
    p_user_id: userId,
    p_name: fallbackName || "My Workspace",
  });
  if (typeof data === "string") return data;

  const { data: existing } = await supabase
    .from("organization_members")
    .select("organization_id")
    .eq("user_id", userId)
    .eq("status", "active")
    .limit(1)
    .maybeSingle();
  return existing?.organization_id ?? null;
}

/**
 * Persist a single (waba, phone) pair plus its access token.
 * Idempotent: an existing whatsapp_accounts row is updated in place.
 */
export async function saveAccount(
  args: SaveAccountInput,
): Promise<SaveAccountResult> {
  const supabase = createServiceClient();

  // 1) whatsapp_accounts — keyed on (organization_id, waba_id)
  const { data: existing } = await supabase
    .from("whatsapp_accounts")
    .select("id")
    .eq("organization_id", args.organizationId)
    .eq("waba_id", args.waba.id)
    .maybeSingle();

  const accountPayload = {
    organization_id: args.organizationId,
    waba_id: args.waba.id,
    business_id: args.waba.business_id ?? null,
    system_user_id: args.systemUserId,
    phone_number_id: args.phone.id,
    display_phone_number: args.phone.display_phone_number,
    business_name: args.phone.verified_name || args.waba.name || null,
    quality_rating: normalizeQuality(args.phone.quality_rating),
    status: args.phone.status === "VERIFIED" ? "active" : "pending",
    token_expires_at: args.tokenExpiresAt,
    updated_at: new Date().toISOString(),
  };

  let accountId: string;
  let refreshed = false;
  if (existing) {
    const { error } = await supabase
      .from("whatsapp_accounts")
      .update(accountPayload)
      .eq("id", existing.id);
    if (error) throw new Error(`whatsapp_accounts update failed: ${error.message}`);
    accountId = existing.id;
    refreshed = true;
  } else {
    const { data: inserted, error } = await supabase
      .from("whatsapp_accounts")
      .insert({ ...accountPayload, webhook_verified: false })
      .select("id")
      .single();
    if (error || !inserted) {
      throw new Error(`whatsapp_accounts insert failed: ${error?.message}`);
    }
    accountId = inserted.id;
  }

  // 2) phone_numbers — keyed on phone_number_id (UNIQUE)
  const phonePayload = {
    organization_id: args.organizationId,
    whatsapp_account_id: accountId,
    phone_number_id: args.phone.id,
    display_phone_number: args.phone.display_phone_number,
    verified_name: args.phone.verified_name ?? null,
    quality_rating: normalizeQuality(args.phone.quality_rating),
    code_verification_status: args.phone.code_verification_status ?? null,
    status: args.phone.status === "VERIFIED" ? "active" : "pending",
    updated_at: new Date().toISOString(),
  };

  const { data: phoneRow, error: phoneErr } = await supabase
    .from("phone_numbers")
    .upsert(phonePayload, { onConflict: "phone_number_id" })
    .select("id")
    .single();
  if (phoneErr || !phoneRow) {
    throw new Error(`phone_numbers upsert failed: ${phoneErr?.message}`);
  }

  // 3) access_tokens — rotate via RPC (atomic: revoke old, insert new)
  const ciphertext = await encrypt(args.accessToken);
  const fp = fingerprint(args.accessToken);

  const { data: tokenId, error: tokenErr } = await supabase.rpc(
    "rotate_access_token",
    {
      p_org_id: args.organizationId,
      p_account_id: accountId,
      p_token_ciphertext: ciphertext,
      p_token_fingerprint: fp,
      p_token_type: "system_user",
      p_expires_at: args.tokenExpiresAt,
      p_scopes: args.scopes,
    },
  );
  if (tokenErr || !tokenId) {
    throw new Error(`rotate_access_token failed: ${tokenErr?.message}`);
  }

  return {
    accountId,
    phoneRowId: phoneRow.id,
    tokenRowId: tokenId as string,
    refreshed,
  };
}

export function normalizeQuality(q: string | undefined): "GREEN" | "YELLOW" | "RED" | "UNKNOWN" {
  switch ((q || "").toUpperCase()) {
    case "GREEN":  return "GREEN";
    case "YELLOW": return "YELLOW";
    case "RED":    return "RED";
    default:       return "UNKNOWN";
  }
}
