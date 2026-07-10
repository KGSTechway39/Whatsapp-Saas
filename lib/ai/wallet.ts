/**
 * AI Credit wallet client — typed wrappers over the row-locked, idempotent SQL
 * RPCs in migration 024. All amounts are integer CREDITS (1 credit = 1 AI action).
 *
 * This is a SEPARATE ledger from the message wallet (lib/billing/wallet.ts):
 *   • message wallet  → paise, per-WhatsApp-message economics
 *   • AI credit wallet → credits, per-AI-action economics
 * The two are never merged (architecture rule 3).
 *
 * Money rules enforced in Postgres (see 024_ai_layer.sql):
 *   • never negative — hard stop at zero on debit
 *   • row-locked (SELECT … FOR UPDATE) — no double-spend under concurrency
 *   • ledger-backed + idempotency keys — a retried request debits once
 *
 * Keyed by user_id (the deployed legacy tenant model), mirroring the message
 * wallet. See lib/billing/wallet.ts.
 */
import { createServiceClient } from "@/lib/supabase/server";

/** Thrown when a debit would take the AI credit balance below zero. */
export class InsufficientAICreditsError extends Error {
  code = "INSUFFICIENT_AI_CREDITS" as const;
  constructor(message = "Insufficient AI credits") {
    super(message);
    this.name = "InsufficientAICreditsError";
  }
}

function isInsufficient(err: { message?: string } | null): boolean {
  return !!err?.message && err.message.includes("INSUFFICIENT_AI_CREDITS");
}

/** Current AI credit balance (0 if the wallet row does not exist yet). */
export async function getBalance(userId: string): Promise<number> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("ai_credit_wallet")
    .select("balance_credits")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(`ai_credit_wallet read failed: ${error.message}`);
  return Number(data?.balance_credits ?? 0);
}

/** Idempotent credit (trial grant / monthly quota / top-up / refund). Returns new balance. */
export async function credit(args: {
  userId: string;
  credits: number;
  type: "trial" | "grant" | "topup" | "quota_reset" | "refund";
  idempotencyKey: string;
  taskType?: string;
  referenceId?: string;
  description?: string;
}): Promise<number> {
  const supabase = createServiceClient();
  const { data, error } = await supabase.rpc("ai_wallet_credit", {
    p_user: args.userId,
    p_credits: args.credits,
    p_type: args.type,
    p_idem: args.idempotencyKey,
    p_task: args.taskType ?? null,
    p_ref: args.referenceId ?? null,
    p_desc: args.description ?? null,
  });
  if (error) throw new Error(`ai_wallet_credit failed: ${error.message}`);
  return Number(data);
}

/**
 * Idempotent debit for one successful AI action. Throws InsufficientAICreditsError
 * on hard stop. Call ONLY after the provider call succeeds (debit-on-success).
 */
export async function debit(args: {
  userId: string;
  credits: number;
  idempotencyKey: string;
  taskType?: string;
  referenceId?: string;
  description?: string;
}): Promise<number> {
  const supabase = createServiceClient();
  const { data, error } = await supabase.rpc("ai_wallet_debit", {
    p_user: args.userId,
    p_credits: args.credits,
    p_idem: args.idempotencyKey,
    p_task: args.taskType ?? null,
    p_ref: args.referenceId ?? null,
    p_desc: args.description ?? null,
  });
  if (isInsufficient(error)) throw new InsufficientAICreditsError();
  if (error) throw new Error(`ai_wallet_debit failed: ${error.message}`);
  return Number(data);
}
