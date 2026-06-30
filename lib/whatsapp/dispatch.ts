/**
 * Outbound dispatch for the flow engine.
 *
 * The engine (`lib/whatsapp/engine.ts`) is pure: it computes a Meta Graph
 * payload but never performs I/O. This module is the side-effecting boundary
 * that actually delivers that payload, enforcing the two non-negotiable gates
 * first:
 *
 *   1. 24h customer-service window  (see `lib/whatsapp/window.ts`)
 *   2. token resolution + decryption (tokens are encrypted at rest)
 *
 * Billing note: engine replies are SERVICE-category session messages (a reply
 * to a just-received inbound is always inside the 24h window), which are free
 * in the prepaid wallet — so no reservation is taken here. Template / outbound-
 * initiated sends route through `lib/billing/guarded-send.ts` instead.
 */

import { createServiceClient } from "@/lib/supabase/server";
import { decrypt } from "@/lib/crypto";
import { graphPost, MetaApiError } from "@/lib/meta-client";
import { logger } from "@/lib/logger";
import { canSend, windowStateFrom } from "./window";
import type { OutboundPayload } from "./engine";

export interface DispatchResult {
  sent: boolean;
  waMessageId?: string;
  reason?: string;
}

/**
 * Deliver one engine-produced outbound payload to Meta.
 *
 * @param phoneNumberId  The tenant's sending number (also resolves the token).
 * @param outbound       Full Meta Graph message JSON from the engine.
 * @param lastInboundAt  Contact's last inbound ts — drives the window check.
 */
export async function sendOutbound(args: {
  phoneNumberId: string;
  outbound: NonNullable<OutboundPayload>;
  lastInboundAt: string | null;
}): Promise<DispatchResult> {
  const { phoneNumberId, outbound, lastInboundAt } = args;

  // ── Gate 1: 24h window ────────────────────────────────────────────────
  const gate = canSend(outbound.type, windowStateFrom(lastInboundAt));
  if (!gate.ok) {
    // A closed window for free-form means the flow should have used a template.
    logger.warn("[dispatch] blocked by 24h window", {
      phoneNumberId,
      type: outbound.type,
      reason: gate.reason,
    });
    return { sent: false, reason: gate.reason };
  }

  // ── Gate 2: resolve + decrypt the tenant's token ──────────────────────
  const supabase = createServiceClient();
  const { data: account } = await supabase
    .from("whatsapp_accounts")
    .select("access_token, token_encrypted")
    .eq("phone_number_id", phoneNumberId)
    .maybeSingle();

  if (!account?.access_token) {
    logger.warn("[dispatch] no token for phone_number_id", { phoneNumberId });
    return { sent: false, reason: "NO_TOKEN" };
  }
  const token = await decrypt(account.access_token as string);

  // ── Send ──────────────────────────────────────────────────────────────
  try {
    const res = await graphPost<{ messages?: { id: string }[] }>(
      `/${phoneNumberId}/messages`,
      token,
      outbound as unknown as Record<string, unknown>,
    );
    const waMessageId = res.messages?.[0]?.id;
    logger.info("[dispatch] sent", { phoneNumberId, type: outbound.type, waMessageId });
    return { sent: true, waMessageId };
  } catch (err) {
    const reason = err instanceof MetaApiError ? err.code : "GRAPH_ERROR";
    logger.error("[dispatch] graph send failed", {
      phoneNumberId,
      reason,
      err: err instanceof Error ? err.message : String(err),
    });
    return { sent: false, reason };
  }
}
