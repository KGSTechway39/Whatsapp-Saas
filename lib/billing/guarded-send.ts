/**
 * guardedSend — the billing wrapper that sits between a send call-site and the
 * (unmodified) `lib/meta.ts` sender.
 *
 * Contract:
 *   • BYO users  (billing_mode='byo')     → send() is called unchanged. No wallet.
 *   • Managed users (billing_mode='managed') → quote the per-category cost, RESERVE
 *     it on the prepaid wallet (hard stop: throws InsufficientBalanceError BEFORE
 *     the Graph API call), then send. The reservation is a HOLD, not a debit; the
 *     Meta delivery-status webhook later settles it (sent/delivered) or releases it
 *     (failed). A message that never reaches `sent` is never charged.
 *
 * The sender itself is passed in as a closure, so `lib/meta.ts` is never touched.
 * Single-send fast path only (one message). Broadcasts use reserve/settle/release
 * from `lib/billing/wallet.ts` directly.
 */
import { randomUUID } from "crypto";
import { createServiceClient } from "@/lib/supabase/server";
import { logger } from "@/lib/logger";
import {
  quoteSend,
  toBillableCategory,
  type MessageCategory,
} from "./pricing";
import * as wallet from "./wallet";

export type BillingMode = "byo" | "managed";

/** Read a user's billing mode. Defaults to 'byo' on any miss (fail safe = free). */
export async function getBillingMode(userId: string): Promise<BillingMode> {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from("users")
    .select("billing_mode")
    .eq("id", userId)
    .single();
  return data?.billing_mode === "managed" ? "managed" : "byo";
}

/** Resolve a template's billable category by name (legacy templates are user-scoped). */
export async function resolveTemplateCategory(
  userId: string,
  templateName: string,
): Promise<MessageCategory> {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from("templates")
    .select("category")
    .eq("user_id", userId)
    .eq("name", templateName)
    .maybeSingle();
  return toBillableCategory(data?.category);
}

/**
 * Wrap a single send with prepaid billing. Returns whatever `send()` returns.
 *
 * Reserve → confirm-on-sent (no permanent debit at call time):
 *   1. RESERVE (hold) the cost — hard stop (throws InsufficientBalanceError) if
 *      the managed user can't afford it. Nothing is charged yet.
 *   2. Send. If it throws before Meta accepts → RELEASE the hold, rethrow.
 *   3. Link the returned wa_message_id → reservation in `message_billing` so the
 *      Meta delivery-status webhook can settle (sent/delivered) or release (failed)
 *      it. See lib/billing/confirm.ts + the webhook status path.
 *
 * There is no charge-then-refund anymore: a message that never reaches `sent`
 * is simply never settled, so the held funds return to the balance.
 */
export async function guardedSingleSend<T extends { messageId?: string }>(args: {
  userId: string;
  category: MessageCategory;
  send: () => Promise<T>;
  idempotencyKey?: string;
  referenceId?: string;
  description?: string;
}): Promise<T> {
  const mode = await getBillingMode(args.userId);
  if (mode === "byo") return args.send(); // BYO: untouched

  const quote = await quoteSend(args.userId, args.category);
  const costPaise = quote.chargedPaise;
  if (costPaise <= 0) return args.send(); // free category (e.g. SERVICE): skip wallet

  const idem = args.idempotencyKey ?? randomUUID();

  // Reserve (hold) the cost. Hard stop here — throws InsufficientBalanceError if
  // unaffordable. Idempotent per (user, idem): a retry returns the same hold.
  const reservationId = await wallet.reserve({
    userId: args.userId,
    amountPaise: costPaise,
    idempotencyKey: idem,
    referenceId: args.referenceId,
  });

  let result: T;
  try {
    result = await args.send();
  } catch (err) {
    // Send threw before Meta accepted it → free the hold. Nothing was charged.
    await wallet.release(reservationId).catch(() => {});
    throw err;
  }

  // Link the sent message to its reservation so the status webhook can confirm it.
  const waMessageId = result.messageId;
  if (!waMessageId) {
    // No id to confirm against → release rather than hold the funds forever.
    await wallet.release(reservationId).catch(() => {});
    logger.warn("guardedSingleSend: send returned no messageId; hold released", {
      userId: args.userId,
    });
    return result;
  }

  await createServiceClient()
    .from("message_billing")
    .insert({
      wa_message_id: waMessageId,
      user_id: args.userId,
      reservation_id: reservationId,
      cost_paise: costPaise,
      category: args.category,
      wholesale_paise: quote.wholesalePaise,
      markup_bps: quote.markupBps,
      status: "reserved",
    })
    .then(
      () => {},
      (e) => logger.warn("message_billing insert failed", { waMessageId, e: String(e) }),
    );

  return result;
}
