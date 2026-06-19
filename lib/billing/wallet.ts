/**
 * Prepaid wallet client — typed wrappers over the row-locked, idempotent
 * SQL RPCs in migration 011. All amounts are integer paise.
 *
 * Money rules enforced in Postgres (see 011_prepaid_wallet.sql):
 *   • never negative — hard stop at zero (reservations guard the balance)
 *   • row-locked (SELECT … FOR UPDATE) — no double-spend
 *   • ledger-backed + idempotency keys — duplicate webhooks credit once
 *
 * This module is only used on the MANAGED billing track. Callers must gate
 * on `billing_mode === 'managed'` before reserving/charging; BYO users never
 * touch the wallet. Keyed by user_id (the deployed legacy tenant model).
 */
import { createServiceClient } from "@/lib/supabase/server";

/** Thrown when a reserve/charge would take the balance below zero. */
export class InsufficientBalanceError extends Error {
  code = "INSUFFICIENT_BALANCE" as const;
  constructor(message = "Insufficient wallet balance") {
    super(message);
    this.name = "InsufficientBalanceError";
  }
}

function isInsufficient(err: { message?: string } | null): boolean {
  return !!err?.message && err.message.includes("INSUFFICIENT_BALANCE");
}

/** Idempotent credit (top-up / refund / bonus). Returns new balance in paise. */
export async function credit(args: {
  userId: string;
  amountPaise: number;
  type: "recharge" | "refund" | "bonus";
  idempotencyKey: string;
  description?: string;
  paymentMethod?: string;
}): Promise<number> {
  const supabase = createServiceClient();
  const { data, error } = await supabase.rpc("wallet_credit", {
    p_user: args.userId,
    p_amount_paise: args.amountPaise,
    p_type: args.type,
    p_idem: args.idempotencyKey,
    p_desc: args.description ?? null,
    p_method: args.paymentMethod ?? null,
  });
  if (error) throw new Error(`wallet_credit failed: ${error.message}`);
  return Number(data);
}

/** Place a hold for a broadcast. Throws InsufficientBalanceError on hard stop. */
export async function reserve(args: {
  userId: string;
  amountPaise: number;
  referenceId?: string;
  idempotencyKey?: string;
}): Promise<string> {
  const supabase = createServiceClient();
  const { data, error } = await supabase.rpc("wallet_reserve", {
    p_user: args.userId,
    p_amount_paise: args.amountPaise,
    p_ref: args.referenceId ?? null,
    p_idem: args.idempotencyKey ?? null,
  });
  if (isInsufficient(error)) throw new InsufficientBalanceError();
  if (error) throw new Error(`wallet_reserve failed: ${error.message}`);
  return data as string; // reservation id
}

/** Consume part of a reservation for one send. Idempotent per unitIdempotencyKey. */
export async function settle(args: {
  reservationId: string;
  actualPaise: number;
  unitIdempotencyKey: string;
  description?: string;
  referenceId?: string;
}): Promise<number> {
  const supabase = createServiceClient();
  const { data, error } = await supabase.rpc("wallet_settle", {
    p_resv: args.reservationId,
    p_actual_paise: args.actualPaise,
    p_unit_idem: args.unitIdempotencyKey,
    p_desc: args.description ?? null,
    p_ref: args.referenceId ?? null,
  });
  if (error) throw new Error(`wallet_settle failed: ${error.message}`);
  return Number(data);
}

/** Close a reservation and free any unused hold. Idempotent. */
export async function release(reservationId: string): Promise<void> {
  const supabase = createServiceClient();
  const { error } = await supabase.rpc("wallet_release", { p_resv: reservationId });
  if (error) throw new Error(`wallet_release failed: ${error.message}`);
}

/** Fast path: charge a single send (reserve+settle atomic). Idempotent per key. */
export async function charge(args: {
  userId: string;
  amountPaise: number;
  idempotencyKey: string;
  description?: string;
  referenceId?: string;
}): Promise<number> {
  const supabase = createServiceClient();
  const { data, error } = await supabase.rpc("wallet_charge", {
    p_user: args.userId,
    p_amount_paise: args.amountPaise,
    p_idem: args.idempotencyKey,
    p_desc: args.description ?? null,
    p_ref: args.referenceId ?? null,
  });
  if (isInsufficient(error)) throw new InsufficientBalanceError();
  if (error) throw new Error(`wallet_charge failed: ${error.message}`);
  return Number(data);
}
