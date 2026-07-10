/**
 * AI model routing config — the single source of truth for which provider/model
 * serves each task_type, what it costs, and how it is metered. Read at request
 * time from `ai_model_config` (migration 024); NEVER hardcode a model id in a
 * route (architecture rule 4). New models/providers = a config row, not a deploy.
 */
import { createServiceClient } from "@/lib/supabase/server";

export type TaskType =
  | "campaign_content"
  | "automation_flow_builder"
  | "automation_runtime_intent"
  | "appointment_nl_parse"
  | "reminder_draft"
  | "template_content";

export type Tier = "starter" | "growth" | "enterprise";

export interface ModelConfig {
  taskType: TaskType;
  provider: string;
  modelId: string;
  inputPricePerMillionPaise: number;
  outputPricePerMillionPaise: number;
  markupMultiplier: number;
  creditsPerAction: number;
  timeoutMs: number;
  maxRegens: number;
}

/**
 * Which tiers may run which task (enforced server-side in AIProviderService —
 * hiding a button in the UI is cosmetic only, rule 6/tier-gating). Starter gets
 * campaign + appointment ONLY via a one-time trial pool (handled by the credit
 * grant, not here); this map is the hard capability gate.
 */
const TIER_TASKS: Record<Tier, ReadonlySet<TaskType>> = {
  // template_content predates AI Credits (was a free feature) → allowed on every
  // tier at 0 credits; the config row governs model/logging, not entitlement.
  starter: new Set<TaskType>(["campaign_content", "appointment_nl_parse", "template_content"]),
  growth: new Set<TaskType>([
    "campaign_content",
    "appointment_nl_parse",
    "automation_runtime_intent",
    "reminder_draft",
    "template_content",
  ]),
  enterprise: new Set<TaskType>([
    "campaign_content",
    "appointment_nl_parse",
    "automation_flow_builder",
    "automation_runtime_intent",
    "reminder_draft",
    "template_content",
  ]),
};

export function tierAllows(tier: Tier, taskType: TaskType): boolean {
  return TIER_TASKS[tier]?.has(taskType) ?? false;
}

/**
 * Resolve a user's product tier from the DB. The session JWT does NOT carry tier
 * (see lib/auth SessionUser), so every AI route reads it fresh — this is also the
 * authoritative gate, not a cached/spoofable claim. Defaults to 'starter' (most
 * restrictive) if the row/column is missing.
 */
export async function getUserTier(userId: string): Promise<Tier> {
  const supabase = createServiceClient();
  const { data } = await supabase.from("users").select("tier").eq("id", userId).maybeSingle();
  const tier = data?.tier as Tier | undefined;
  return tier === "growth" || tier === "enterprise" || tier === "starter" ? tier : "starter";
}

/**
 * Newest active config row for a task_type, or null if none/inactive. A null
 * result means "AI not configured" → the caller falls back to the manual flow.
 */
export async function loadModelConfig(taskType: TaskType): Promise<ModelConfig | null> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("ai_model_config")
    .select(
      "task_type, provider, model_id, input_price_per_million_paise, output_price_per_million_paise, markup_multiplier, credits_per_action, timeout_ms, max_regens",
    )
    .eq("task_type", taskType)
    .eq("is_active", true)
    .order("effective_from", { ascending: false })
    .limit(1)
    .maybeSingle();

  // Treat any read failure (incl. the table not existing yet — code deployed
  // before migration 024) as "not configured" → callers fall back to manual.
  // This keeps deploying the app ahead of the SQL harmless (rule 8).
  if (error || !data) return null;

  return {
    taskType: data.task_type as TaskType,
    provider: data.provider,
    modelId: data.model_id,
    inputPricePerMillionPaise: Number(data.input_price_per_million_paise),
    outputPricePerMillionPaise: Number(data.output_price_per_million_paise),
    markupMultiplier: Number(data.markup_multiplier),
    creditsPerAction: Number(data.credits_per_action),
    timeoutMs: Number(data.timeout_ms),
    maxRegens: Number(data.max_regens),
  };
}

/** Raw provider token cost in paise (pre-markup). This is the margin denominator. */
export function rawCostPaise(
  cfg: ModelConfig,
  tokensIn: number,
  tokensOut: number,
): number {
  const inCost = (tokensIn / 1_000_000) * cfg.inputPricePerMillionPaise;
  const outCost = (tokensOut / 1_000_000) * cfg.outputPricePerMillionPaise;
  return Math.ceil(inCost + outCost); // round up — never understate cost
}
