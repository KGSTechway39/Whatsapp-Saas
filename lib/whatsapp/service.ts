/**
 * Service layer for the WhatsApp Embedded Signup module.
 *
 * Routes (controllers) delegate to functions here. Services orchestrate
 * Graph API calls + Repository persistence + business rules. They never
 * touch HTTP request/response or encryption primitives directly.
 */

import { createClient as createSupabase } from "@/lib/supabase/server";
import {
  exchangeCodeForToken,
  extendToken,
  getWABAsForToken,
  subscribeWABAToApp,
} from "@/lib/meta";
import {
  upsertAccount,
  listAccounts,
  disconnectAccount,
  getActiveOrgId,
  toAccountDTO,
  getDecryptedToken,
} from "./repository";
import {
  ExchangeCodeRequest,
  ExchangeCodeResult,
  WhatsAppAccountDTO,
} from "./dto";
import {
  ValidationError,
  TokenExchangeError,
  GraphApiError,
  NoWABAError,
} from "./errors";
import { logger } from "@/lib/logger";

// ── EMBEDDED SIGNUP — code exchange + WABA persistence ───────────────────

/**
 * Process a Facebook Login for Business callback:
 *  1. Exchange short code → long-lived (~60d) access token
 *  2. Fetch all WABAs + phone numbers granted to the token
 *  3. Subscribe each WABA to our Meta App for webhook delivery
 *  4. Upsert each (waba, phone) pair into the user's organization
 *
 * Tenant isolation: every write goes through the Repository, which scopes
 * to organization_id from `getActiveOrgId(userId)`. A phone_number_id can
 * therefore exist in only one organization at a time.
 */
export async function exchangeAndPersist(
  userId: string,
  payload: ExchangeCodeRequest,
): Promise<ExchangeCodeResult> {
  if (!payload.code) {
    throw new ValidationError("Authorization code is required");
  }

  const supabase = createSupabase();
  const orgId = await getActiveOrgId(supabase, userId);

  // 1) Code → long-lived token
  let accessToken: string;
  try {
    const shortToken = await exchangeCodeForToken(payload.code);
    accessToken = await extendToken(shortToken);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Token exchange failed";
    throw new TokenExchangeError(msg);
  }

  // 2) Fetch WABAs + phones
  let wabas;
  try {
    wabas = await getWABAsForToken(accessToken);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to fetch WhatsApp accounts";
    throw new GraphApiError(msg);
  }
  if (!wabas.length) throw new NoWABAError();

  const tokenExpiresAt = new Date(Date.now() + 60 * 24 * 3600 * 1000).toISOString();

  const connected: WhatsAppAccountDTO[] = [];
  let created = 0;
  let refreshed = 0;

  // 3+4) For each WABA → subscribe + upsert each phone
  for (const waba of wabas) {
    if (payload.wabaId && waba.id !== payload.wabaId) continue;

    // Best-effort subscribe — Meta returns 200 even if already subscribed
    try {
      await subscribeWABAToApp(waba.id, accessToken);
    } catch (err) {
      logger.warn("WABA subscription warning", {
        wabaId: waba.id,
        message: err instanceof Error ? err.message : String(err),
      });
    }

    for (const phone of waba.phoneNumbers) {
      if (payload.phoneNumberId && phone.id !== payload.phoneNumberId) continue;

      const status = phone.status === "VERIFIED" ? "active" : "pending";

      const { row, created: wasCreated } = await upsertAccount(supabase, {
        organizationId: orgId,
        wabaId: waba.id,
        businessId: null,
        phoneNumberId: phone.id,
        displayPhoneNumber: phone.display_phone_number,
        businessName: phone.verified_name ?? waba.name ?? null,
        qualityRating: (phone.quality_rating as "GREEN" | "YELLOW" | "RED" | "UNKNOWN") ?? "UNKNOWN",
        accessToken,
        tokenExpiresAt,
        status,
      });

      if (wasCreated) created++; else refreshed++;
      connected.push(toAccountDTO(row));
    }
  }

  if (!connected.length) {
    throw new ValidationError(
      "No phone numbers were connected. Verify WABA + phone number access in Meta Business Manager.",
    );
  }

  return { connected, created, refreshed };
}

// ── List / disconnect ────────────────────────────────────────────────────

export async function listForUser(userId: string): Promise<WhatsAppAccountDTO[]> {
  const supabase = createSupabase();
  const orgId = await getActiveOrgId(supabase, userId);
  return listAccounts(supabase, orgId);
}

export async function disconnectForUser(userId: string, accountId: string): Promise<void> {
  const supabase = createSupabase();
  const orgId = await getActiveOrgId(supabase, userId);
  await disconnectAccount(supabase, orgId, accountId);
}

// ── Helper used by sender / webhook code ─────────────────────────────────

/**
 * Internal helper: fetch a decrypted access token by accountId for the
 * caller's organization. Throws if the account doesn't belong to them.
 */
export async function getAccessTokenForUser(
  userId: string,
  accountId: string,
): Promise<string> {
  const supabase = createSupabase();
  const orgId = await getActiveOrgId(supabase, userId);
  return getDecryptedToken(supabase, orgId, accountId);
}
