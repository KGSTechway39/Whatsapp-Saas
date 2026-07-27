/**
 * Runtime intent classification (task: automation_runtime_intent).
 *
 * Reads a live inbound customer message and picks which already-approved flow it
 * matches. This runs on EVERY inbound message at scale, so it routes to the
 * cheapest/fastest model via ai_model_config (Gemini Flash-Lite class by default),
 * with a strict short timeout, and is metered at 0 credits (logged for margin
 * only — see migration 024/025). It NEVER generates customer-facing text; it only
 * classifies against flows a human already built and published (no draft/confirm
 * step here, by design — the flow itself is the approved content).
 *
 * Decoupled + testable: `classifyIntent` takes a plain message + candidate list,
 * so it can be exercised against MOCKED inbound payloads before the Meta webhook
 * is finalized. It has no dependency on the webhook or the tenant model.
 */
import { runTask } from "@/lib/ai/service";
import type { Tier } from "@/lib/ai/config";
import { INTENT_SYSTEM_PROMPT, intentUserPrompt, type IntentCandidate } from "@/lib/ai/prompts/intent";

export type { IntentCandidate };

export interface ClassifyResult {
  /** Matched candidate id, or null when nothing fit (or AI unavailable). */
  intentId: string | null;
  confidence: number;
  /** True when the model actually ran (vs. a fallback/no-op). */
  usedAI: boolean;
}

interface ParsedIntent {
  id: string;
  confidence: number;
}

function parseIntent(raw: string, candidates: IntentCandidate[]): ParsedIntent {
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("no JSON object in output");
  const p = JSON.parse(match[0]) as { id?: unknown; confidence?: unknown };
  const id = String(p.id ?? "none");
  const confidence = Math.max(0, Math.min(1, Number(p.confidence ?? 0)));
  // Guard against a hallucinated id — must be "none" or a real candidate.
  if (id !== "none" && !candidates.some((c) => c.id === id)) {
    throw new Error(`unknown intent id "${id}"`);
  }
  return { id, confidence };
}

/** Below this the match is treated as "no confident intent" → no flow fires. */
export const MIN_CONFIDENCE = 0.55;

/**
 * Classify one inbound message against candidate intents. Returns a null intentId
 * on any AI fallback (not configured / no model / timeout / invalid) so the caller
 * can fall back to keyword matching — the automation never hard-fails on AI.
 */
export async function classifyIntent(args: {
  userId: string;
  tier: Tier;
  message: string;
  candidates: IntentCandidate[];
  organizationId?: string | null;
}): Promise<ClassifyResult> {
  const message = args.message.trim();
  if (!message || args.candidates.length === 0) {
    return { intentId: null, confidence: 0, usedAI: false };
  }

  const result = await runTask<ParsedIntent>({
    userId: args.userId,
    tier: args.tier,
    taskType: "automation_runtime_intent",
    system: INTENT_SYSTEM_PROMPT,
    prompt: intentUserPrompt(message, args.candidates),
    maxTokens: 40, // classify-only → tiny output protects margin
    // Volume task: one debit-idempotency key per (message) so replays don't double
    // count in the margin log; credits_per_action is 0 so this only dedupes logging.
    idempotencyKey: `intent:${args.userId}:${hash(message)}`,
    parse: (raw) => parseIntent(raw, args.candidates),
    organizationId: args.organizationId ?? null,
  });

  if (result.status === "fallback") {
    return { intentId: null, confidence: 0, usedAI: false };
  }
  const { id, confidence } = result.data;
  return {
    intentId: id !== "none" && confidence >= MIN_CONFIDENCE ? id : null,
    confidence,
    usedAI: true,
  };
}

/** Small stable hash for the idempotency key (djb2). */
function hash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}
