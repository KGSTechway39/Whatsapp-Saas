/**
 * guardedSend — the billing wrapper that sits between a send call-site and the
 * (unmodified) `lib/meta.ts` sender.
 *
 * Contract:
 *   • BYO users  (billing_mode='byo')     → send() is called unchanged. No wallet.
 *   • Managed users (billing_mode='managed') → quote the per-category cost, CHARGE
 *     the prepaid wallet (hard stop: throws InsufficientBalanceError BEFORE the
 *     Graph API call), then send. If the send throws, the charge is refunded so
 *     a failed Meta call never keeps the money.
 *
 * The sender itself is passed in as a closure, so `lib/meta.ts` is never touched.
 * Single-send fast path only (one message). Broadcasts use reserve/settle/release
 * from `lib/billing/wallet.ts` directly.
 */
import { randomUUID } from "crypto";
import { createServiceClient } from "@/lib/supabase/server";
import {
  quoteSendCostPaise,
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
 * Throws InsufficientBalanceError (from wallet.charge) before sending if the
 * managed user can't afford it.
 */
export async function guardedSingleSend<T>(args: {
  userId: string;
  category: MessageCategory;
  send: () => Promise<T>;
  idempotencyKey?: string;
  referenceId?: string;
  description?: string;
}): Promise<T> {
  const mode = await getBillingMode(args.userId);
  if (mode === "byo") return args.send(); // BYO: untouched

  const costPaise = await quoteSendCostPaise(args.userId, args.category);
  if (costPaise <= 0) return args.send(); // free category (e.g. SERVICE): skip wallet

  const idem = args.idempotencyKey ?? randomUUID();

  // Hard stop happens here — throws InsufficientBalanceError if unaffordable.
  await wallet.charge({
    userId: args.userId,
    amountPaise: costPaise,
    idempotencyKey: idem,
    description: args.description ?? `WhatsApp ${args.category} send`,
    referenceId: args.referenceId,
  });

  try {
    return await args.send();
  } catch (err) {
    // Send failed after we charged → refund (idempotent on a derived key).
    await wallet
      .credit({
        userId: args.userId,
        amountPaise: costPaise,
        type: "refund",
        idempotencyKey: `refund:${idem}`,
        description: `Refund — failed send ${idem}`,
      })
      .catch(() => {}); // never mask the original send error
    throw err;
  }
}
