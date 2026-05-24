/**
 * Repository layer — single point of contact with Postgres for the WhatsApp
 * module. Encryption is applied here on the way IN, decryption on the way OUT.
 * Service layer never touches encrypt() / decrypt() directly.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { encrypt, decrypt, isEncrypted } from "@/lib/crypto";
import {
  WhatsAppAccountRow,
  WhatsAppAccountDTO,
  WebhookLogInsert,
} from "./dto";
import { NotFoundError, NoOrganizationError } from "./errors";

// ── Public DTO mapper ────────────────────────────────────────────────────

export function toAccountDTO(row: WhatsAppAccountRow): WhatsAppAccountDTO {
  return {
    id: row.id,
    wabaId: row.waba_id,
    businessId: row.business_id,
    businessName: row.business_name,
    phoneNumberId: row.phone_number_id,
    displayPhoneNumber: row.display_phone_number,
    qualityRating: row.quality_rating,
    status: row.status,
    webhookVerified: row.webhook_verified,
    connectedAt: row.created_at,
  };
}

// ── Organization lookup ──────────────────────────────────────────────────

/** Returns the active org for a given user, or throws NoOrganizationError. */
export async function getActiveOrgId(supabase: SupabaseClient, userId: string): Promise<string> {
  const { data, error } = await supabase
    .from("organization_members")
    .select("organization_id")
    .eq("user_id", userId)
    .eq("status", "active")
    .order("joined_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error || !data) throw new NoOrganizationError();
  return data.organization_id as string;
}

// ── Account CRUD ─────────────────────────────────────────────────────────

interface UpsertAccountParams {
  organizationId: string;
  wabaId: string;
  businessId: string | null;
  phoneNumberId: string;
  displayPhoneNumber: string;
  businessName: string | null;
  qualityRating: WhatsAppAccountRow["quality_rating"];
  accessToken: string;
  tokenExpiresAt: string | null;
  status: WhatsAppAccountRow["status"];
}

/**
 * Insert a new whatsapp_account or refresh the token of an existing one.
 * Returns the row + a flag indicating whether it was a fresh insert.
 */
export async function upsertAccount(
  supabase: SupabaseClient,
  p: UpsertAccountParams,
): Promise<{ row: WhatsAppAccountRow; created: boolean }> {
  const encryptedToken = await encrypt(p.accessToken);

  // Look up by phone_number_id within this organization (multi-tenant safe).
  const { data: existing } = await supabase
    .from("whatsapp_accounts")
    .select("id")
    .eq("organization_id", p.organizationId)
    .eq("phone_number_id", p.phoneNumberId)
    .maybeSingle();

  if (existing) {
    const { data, error } = await supabase
      .from("whatsapp_accounts")
      .update({
        waba_id: p.wabaId,
        business_id: p.businessId,
        display_phone_number: p.displayPhoneNumber,
        business_name: p.businessName,
        quality_rating: p.qualityRating,
        access_token: encryptedToken,
        token_encrypted: true,
        token_expires_at: p.tokenExpiresAt,
        status: p.status,
        updated_at: new Date().toISOString(),
      })
      .eq("id", existing.id)
      .select()
      .single();
    if (error) throw error;
    return { row: data as WhatsAppAccountRow, created: false };
  }

  const { data, error } = await supabase
    .from("whatsapp_accounts")
    .insert({
      organization_id: p.organizationId,
      waba_id: p.wabaId,
      business_id: p.businessId,
      phone_number_id: p.phoneNumberId,
      display_phone_number: p.displayPhoneNumber,
      business_name: p.businessName,
      quality_rating: p.qualityRating,
      access_token: encryptedToken,
      token_encrypted: true,
      token_expires_at: p.tokenExpiresAt,
      status: p.status,
      webhook_verified: false,
    })
    .select()
    .single();

  if (error) throw error;
  return { row: data as WhatsAppAccountRow, created: true };
}

/** List all accounts for an organization (token redacted). */
export async function listAccounts(
  supabase: SupabaseClient,
  organizationId: string,
): Promise<WhatsAppAccountDTO[]> {
  const { data, error } = await supabase
    .from("whatsapp_accounts")
    .select("id, organization_id, waba_id, business_id, phone_number_id, display_phone_number, business_name, quality_rating, messaging_tier, status, webhook_verified, created_at, updated_at, token_encrypted, token_expires_at")
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: false });

  if (error) throw error;
  return (data || []).map((r) => toAccountDTO({ ...r, access_token: null } as WhatsAppAccountRow));
}

/** Fetch the access token for one account, decrypted. Service-internal use only. */
export async function getDecryptedToken(
  supabase: SupabaseClient,
  organizationId: string,
  accountId: string,
): Promise<string> {
  const { data, error } = await supabase
    .from("whatsapp_accounts")
    .select("access_token, token_encrypted")
    .eq("id", accountId)
    .eq("organization_id", organizationId)
    .single();

  if (error || !data) throw new NotFoundError("WhatsApp account");
  if (!data.access_token) throw new NotFoundError("Access token");

  if (data.token_encrypted && isEncrypted(data.access_token)) {
    return decrypt(data.access_token);
  }
  // Legacy plaintext row — return as-is, but flag in logs so we can backfill.
  return data.access_token;
}

/** Mark an account disconnected without losing history. */
export async function disconnectAccount(
  supabase: SupabaseClient,
  organizationId: string,
  accountId: string,
): Promise<void> {
  const { error } = await supabase
    .from("whatsapp_accounts")
    .update({
      status: "disconnected",
      access_token: null,
      token_encrypted: false,
      updated_at: new Date().toISOString(),
    })
    .eq("id", accountId)
    .eq("organization_id", organizationId);
  if (error) throw error;
}

/** Resolve a phone_number_id → organization + account id (used by webhook). */
export async function resolveByPhoneNumberId(
  supabase: SupabaseClient,
  phoneNumberId: string,
): Promise<{ id: string; organizationId: string; wabaId: string } | null> {
  const { data } = await supabase
    .from("whatsapp_accounts")
    .select("id, organization_id, waba_id")
    .eq("phone_number_id", phoneNumberId)
    .maybeSingle();
  if (!data) return null;
  return { id: data.id, organizationId: data.organization_id, wabaId: data.waba_id };
}

// ── Webhook log persistence ──────────────────────────────────────────────

export async function logWebhookEvent(
  supabase: SupabaseClient,
  payload: WebhookLogInsert,
): Promise<{ id: string; duplicate: boolean }> {
  // ON CONFLICT (meta_event_id) → mark duplicate.
  const { data, error } = await supabase
    .from("webhook_logs")
    .insert({
      ...payload,
      processing_status: payload.processing_status || "pending",
    })
    .select("id")
    .single();

  if (error) {
    // 23505 = unique_violation on meta_event_id
    const code = (error as { code?: string }).code;
    if (code === "23505") {
      const { data: existing } = await supabase
        .from("webhook_logs")
        .select("id")
        .eq("meta_event_id", payload.meta_event_id!)
        .single();
      return { id: existing?.id || "", duplicate: true };
    }
    throw error;
  }
  return { id: data!.id as string, duplicate: false };
}

export async function markWebhookProcessed(
  supabase: SupabaseClient,
  id: string,
  result: "processed" | "failed",
  error?: string,
): Promise<void> {
  await supabase
    .from("webhook_logs")
    .update({
      processing_status: result,
      processing_error: error || null,
      processed_at: new Date().toISOString(),
    })
    .eq("id", id);
}
