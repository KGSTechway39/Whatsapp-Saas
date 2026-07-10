/**
 * AIProviderService — the one governed path for every AI action in WASend.
 *
 * Provider-agnostic: which model runs is decided by ai_model_config at request
 * time (rule 4), never by code here. Adding a provider = a new adapter class + a
 * config row. Every call, without exception, runs the same pipeline:
 *
 *   1. load config        (missing/inactive → graceful fallback, rule 8)
 *   2. tier gate          (server-side capability check, rule 6/tier-gating)
 *   3. credit pre-check   (avoid burning a provider call on an empty wallet)
 *   4. provider call      (hard timeout from config; rule 5 runtime_intent = 2s)
 *   5. validate + retry   (flow builder: silent retries with schema error, rule 5)
 *   6. debit ON SUCCESS   (single atomic AI-credit debit, rule 3)
 *   7. log ALWAYS         (tokens + raw cost → margin truth, rule 6)
 *
 * runTask NEVER performs a customer-facing action (send/publish/launch). It only
 * returns a draft/parse for a human to confirm (rule 2).
 */
import { logger } from "@/lib/logger";
import { createServiceClient } from "@/lib/supabase/server";
import {
  loadModelConfig,
  rawCostPaise,
  tierAllows,
  type ModelConfig,
  type TaskType,
  type Tier,
} from "@/lib/ai/config";
import { debit, getBalance, InsufficientAICreditsError } from "@/lib/ai/wallet";

// ─── Provider adapter seam ────────────────────────────────────────────────────

export interface GenerateArgs {
  modelId: string;
  system: string;
  prompt: string;
  maxTokens: number;
  signal: AbortSignal;
}
export interface GenerateResult {
  text: string;
  tokensIn: number;
  tokensOut: number;
}
export interface ProviderAdapter {
  generate(args: GenerateArgs): Promise<GenerateResult>;
}

/**
 * Anthropic adapter. Matches the SDK usage already wired in the repo
 * (@anthropic-ai/sdk, client.messages.create). The `provider` in config selects
 * which adapter runs; new providers implement this same interface.
 */
class AnthropicAdapter implements ProviderAdapter {
  async generate({ modelId, system, prompt, maxTokens, signal }: GenerateArgs): Promise<GenerateResult> {
    const Anthropic = (await import("@anthropic-ai/sdk")).default;
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const msg = await client.messages.create(
      {
        model: modelId,
        max_tokens: maxTokens,
        system,
        messages: [{ role: "user", content: prompt }],
      },
      { signal },
    );
    const text = (msg.content[0] as { type: string; text?: string })?.text ?? "";
    return {
      text,
      tokensIn: msg.usage?.input_tokens ?? 0,
      tokensOut: msg.usage?.output_tokens ?? 0,
    };
  }
}

/**
 * Resolve an adapter by config.provider. Extend here (GeminiAdapter, a Vercel AI
 * Gateway adapter that takes "provider/model" strings, …) — routes never change.
 */
function getAdapter(provider: string): ProviderAdapter | null {
  switch (provider) {
    case "anthropic":
      return process.env.ANTHROPIC_API_KEY ? new AnthropicAdapter() : null;
    // case "google":  return process.env.GEMINI_API_KEY ? new GeminiAdapter() : null;
    // case "gateway": return process.env.AI_GATEWAY_API_KEY ? new GatewayAdapter() : null;
    default:
      return null;
  }
}

// ─── runTask ──────────────────────────────────────────────────────────────────

export type FallbackReason =
  | "not_configured"
  | "tier_locked"
  | "no_credits"
  | "timeout"
  | "invalid"
  | "error";

export interface AIUsage {
  tokensIn: number;
  tokensOut: number;
  rawCostPaise: number;
  creditsDeducted: number;
  provider: string;
  modelId: string;
  latencyMs: number;
}

export type RunTaskResult<T> =
  | { status: "ok"; data: T; usage: AIUsage }
  | { status: "fallback"; reason: FallbackReason; message: string };

export interface RunTaskArgs<T> {
  userId: string;
  tier: Tier;
  taskType: TaskType;
  system: string;
  prompt: string;
  /** Idempotency key for the debit — the same draft/action must debit once. */
  idempotencyKey: string;
  organizationId?: string | null;
  refId?: string;
  maxTokens?: number;
  /**
   * Turn raw model text into the typed draft. Throw to signal an invalid result
   * (e.g. flow JSON that fails the schema). If omitted, raw text is returned.
   */
  parse?: (raw: string) => T;
  /** Silent retries on parse failure (flow builder = 2, rule 5). */
  silentRetries?: number;
  /** Append the parse error to the prompt on retry (schema error → context). */
  appendOnRetry?: (err: unknown, attempt: number) => string;
}

const MESSAGES: Record<FallbackReason, string> = {
  not_configured: "AI is not available right now — please build manually.",
  tier_locked: "This AI feature isn’t included in your plan — please build manually.",
  no_credits: "You’re out of AI Credits — please build manually or top up.",
  timeout: "AI took too long — please build manually or try again.",
  invalid: "AI couldn’t produce a valid result — please rephrase or build manually.",
  error: "AI is temporarily unavailable — please build manually.",
};

export async function runTask<T = string>(args: RunTaskArgs<T>): Promise<RunTaskResult<T>> {
  const started = Date.now();
  const cfg = await loadModelConfig(args.taskType);

  // 1. not configured → clean fallback (no log target useful without a model row)
  if (!cfg) return fallback("not_configured");

  const adapter = getAdapter(cfg.provider);
  if (!adapter) return logFallback("not_configured", cfg);

  // 2. tier gate (server-side authority)
  if (!tierAllows(args.tier, args.taskType)) return logFallback("tier_locked", cfg);

  // 3. credit pre-check (debit below is still the hard authority)
  if (cfg.creditsPerAction > 0) {
    const balance = await getBalance(args.userId).catch(() => 0);
    if (balance < cfg.creditsPerAction) return logFallback("no_credits", cfg);
  }

  // 4 + 5. provider call with timeout, plus silent validate/retry
  const retries = Math.max(0, args.silentRetries ?? 0);
  let prompt = args.prompt;
  let lastText = "";
  let tokensIn = 0;
  let tokensOut = 0;

  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), cfg.timeoutMs);
    let gen: GenerateResult;
    try {
      gen = await adapter.generate({
        modelId: cfg.modelId,
        system: args.system,
        prompt,
        maxTokens: args.maxTokens ?? 1500,
        signal: controller.signal,
      });
    } catch (err) {
      const aborted = controller.signal.aborted;
      logger.warn("ai.runTask provider call failed", {
        taskType: args.taskType,
        aborted,
        error: err instanceof Error ? err.message : String(err),
      });
      return logFallback(aborted ? "timeout" : "error", cfg);
    } finally {
      clearTimeout(timer);
    }

    lastText = gen.text;
    tokensIn += gen.tokensIn;
    tokensOut += gen.tokensOut;

    if (!args.parse) {
      return await succeed(lastText as unknown as T);
    }
    try {
      const data = args.parse(lastText);
      return await succeed(data);
    } catch (err) {
      if (attempt < retries && args.appendOnRetry) {
        prompt = `${args.prompt}\n\n${args.appendOnRetry(err, attempt + 1)}`;
      } else if (attempt < retries) {
        // retry with the same prompt
      } else {
        return logFallback("invalid", cfg, { tokensIn, tokensOut, started });
      }
    }
  }

  return logFallback("invalid", cfg, { tokensIn, tokensOut, started });

  // ── inner helpers (close over args/cfg) ──────────────────────────────────────

  async function succeed(data: T): Promise<RunTaskResult<T>> {
    const cost = rawCostPaise(cfg!, tokensIn, tokensOut);
    let creditsDeducted = 0;
    if (cfg!.creditsPerAction > 0) {
      try {
        await debit({
          userId: args.userId,
          credits: cfg!.creditsPerAction,
          idempotencyKey: args.idempotencyKey,
          taskType: args.taskType,
          referenceId: args.refId,
          description: `AI ${args.taskType}`,
        });
        creditsDeducted = cfg!.creditsPerAction;
      } catch (err) {
        // Wallet emptied between pre-check and debit → clean fallback, no charge.
        if (err instanceof InsufficientAICreditsError) return logFallback("no_credits", cfg!, { tokensIn, tokensOut, started });
        throw err;
      }
    }
    const usage: AIUsage = {
      tokensIn,
      tokensOut,
      rawCostPaise: cost,
      creditsDeducted,
      provider: cfg!.provider,
      modelId: cfg!.modelId,
      latencyMs: Date.now() - started,
    };
    await writeUsage("ok", cfg!, {
      tokensIn,
      tokensOut,
      rawCostPaise: cost,
      creditsDeducted,
      latencyMs: usage.latencyMs,
    });
    return { status: "ok", data, usage };
  }

  function fallback(reason: FallbackReason): RunTaskResult<T> {
    return { status: "fallback", reason, message: MESSAGES[reason] };
  }

  async function logFallback(
    reason: FallbackReason,
    c: ModelConfig,
    partial?: { tokensIn: number; tokensOut: number; started: number },
  ): Promise<RunTaskResult<T>> {
    const ti = partial?.tokensIn ?? 0;
    const to = partial?.tokensOut ?? 0;
    await writeUsage(reason === "no_credits" || reason === "tier_locked" || reason === "not_configured" ? "fallback" : reason, c, {
      tokensIn: ti,
      tokensOut: to,
      rawCostPaise: rawCostPaise(c, ti, to),
      creditsDeducted: 0,
      latencyMs: Date.now() - (partial?.started ?? started),
    });
    return fallback(reason);
  }

  async function writeUsage(
    status: string,
    c: ModelConfig,
    m: { tokensIn: number; tokensOut: number; rawCostPaise: number; creditsDeducted: number; latencyMs: number },
  ): Promise<void> {
    try {
      const supabase = createServiceClient();
      await supabase.from("ai_usage_log").insert({
        user_id: args.userId,
        organization_id: args.organizationId ?? null,
        task_type: args.taskType,
        provider: c.provider,
        model_id: c.modelId,
        tokens_in: m.tokensIn,
        tokens_out: m.tokensOut,
        raw_cost_paise: m.rawCostPaise,
        credits_deducted: m.creditsDeducted,
        status,
        latency_ms: m.latencyMs,
        ref_id: args.refId ?? null,
      });
    } catch (err) {
      // Usage logging is best-effort — never fail the user action over telemetry.
      logger.warn("ai.runTask usage log failed", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}
