/**
 * Runtime flow resolution for inbound messages — LEGACY user_id tenant model.
 *
 * Deployment reality (see CLAUDE.md): production scopes automation_flows by
 * `user_id` (migration 003), with `flow_data` holding the canvas graph. The
 * org-model engine in lib/whatsapp/engine.ts is coded but not deployed, so this
 * module deliberately targets the LIVE user_id model and does not depend on it.
 *
 * Given an inbound message, this picks the best-matching ACTIVE flow using the AI
 * intent classifier, and falls back to plain keyword matching whenever AI is
 * unconfigured / over-budget / times out — the automation never hard-fails on AI.
 * It only routes to already-approved published flows and returns which flow to
 * run; it never generates or sends customer-facing content itself.
 *
 * Decoupled + testable: `resolveFlowForInbound({ userId, message })` needs only a
 * userId + text, so it can be driven from mocked inbound payloads before the Meta
 * webhook is finalized.
 */
import { createServiceClient } from "@/lib/supabase/server";
import { logger } from "@/lib/logger";
import { getUserTier } from "@/lib/ai/config";
import { classifyIntent } from "./intent";
import { extractFlowIntents } from "./flow-schema";

export interface ResolvedFlow {
  flowId: string;
  name: string;
  flowData: { nodes: unknown[]; edges: unknown[] };
  matchedBy: "ai_intent" | "keyword";
  confidence: number;
}

interface ActiveFlowRow {
  id: string;
  name: string;
  trigger_type: string;
  flow_data: { nodes?: unknown[]; edges?: unknown[] } | null;
}

/**
 * Resolve the tenant user id from Meta's phone_number_id in the legacy model.
 * The webhook already knows phone_number_id; this maps it to the owning user.
 */
export async function resolveUserIdByPhoneNumberId(phoneNumberId: string): Promise<string | null> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("whatsapp_numbers")
    .select("user_id")
    .eq("phone_number_id", phoneNumberId)
    .maybeSingle();
  if (error || !data) return null;
  return (data as { user_id: string }).user_id;
}

/**
 * Pick the active flow an inbound message should run, for a given tenant user.
 * Returns null when nothing matches (caller does nothing — same as today's
 * "no flow match"). AI is tried first; keyword matching is the fallback.
 */
export async function resolveFlowForInbound(args: {
  userId: string;
  message: string;
}): Promise<ResolvedFlow | null> {
  const message = args.message.trim();
  if (!message) return null;

  const supabase = createServiceClient();
  const { data: flows, error } = await supabase
    .from("automation_flows")
    .select("id, name, trigger_type, flow_data")
    .eq("user_id", args.userId)
    .eq("is_active", true);

  if (error) {
    logger.warn("automation.runtime: active flow query failed", { error: error.message });
    return null;
  }
  const active = (flows ?? []) as ActiveFlowRow[];
  if (active.length === 0) return null;

  // Build one intent candidate per flow from its trigger (intents + keywords).
  const candidates = active
    .map((f) => ({ id: f.id, phrases: extractFlowIntents(f.flow_data) }))
    .filter((c) => c.phrases.length > 0);

  // 1) AI intent classification (cheap fast model, 0 credits, strict timeout).
  if (candidates.length > 0) {
    const tier = await getUserTier(args.userId).catch(() => "starter" as const);
    const { intentId, confidence, usedAI } = await classifyIntent({
      userId: args.userId,
      tier,
      message,
      candidates,
    });
    if (usedAI && intentId) {
      const flow = active.find((f) => f.id === intentId);
      if (flow) return toResolved(flow, "ai_intent", confidence);
    }
  }

  // 2) Keyword fallback (mirrors the engine's substring match) — always available.
  const normalized = message.toLowerCase();
  for (const f of active) {
    if (f.trigger_type !== "keyword") continue;
    const keywords = keywordList(f.flow_data);
    if (keywords.some((k) => k && normalized.includes(k.toLowerCase()))) {
      return toResolved(f, "keyword", 1);
    }
  }

  return null;
}

function toResolved(f: ActiveFlowRow, matchedBy: ResolvedFlow["matchedBy"], confidence: number): ResolvedFlow {
  return {
    flowId: f.id,
    name: f.name,
    flowData: { nodes: f.flow_data?.nodes ?? [], edges: f.flow_data?.edges ?? [] },
    matchedBy,
    confidence,
  };
}

/**
 * Render the first auto-reply text of a resolved flow: BFS from the trigger to the
 * first sendMessageNode carrying custom text. This covers the common
 * "trigger → send a reply" shape within the current queue/cron constraints.
 *
 * TODO(persistent-worker): full multi-step traversal (waits, conditions, sessions,
 * templates, interactive) belongs on a persistent worker host (Railway/Render) —
 * see lib/whatsapp/engine.ts. This is the inline, single-reply subset.
 */
export function renderFirstReply(flowData: { nodes?: unknown[]; edges?: unknown[] }, contactName?: string): string | null {
  const nodes = (flowData.nodes ?? []) as { id: string; type?: string; data?: { config?: Record<string, unknown> } }[];
  const edges = (flowData.edges ?? []) as { source: string; target: string }[];
  const trigger = nodes.find((n) => n.type === "triggerNode");
  if (!trigger) return null;

  const byId = new Map(nodes.map((n) => [n.id, n]));
  const queue = [trigger.id];
  const seen = new Set<string>();
  while (queue.length) {
    const id = queue.shift()!;
    if (seen.has(id)) continue;
    seen.add(id);
    const node = byId.get(id);
    if (node?.type === "sendMessageNode") {
      const cfg = node.data?.config ?? {};
      if (cfg.messageType !== "template" && typeof cfg.text === "string" && cfg.text.trim()) {
        return substituteVars(cfg.text.trim(), contactName);
      }
    }
    for (const e of edges) if (e.source === id) queue.push(e.target);
  }
  return null;
}

function substituteVars(text: string, contactName?: string): string {
  // Owners write {{name}} in flow copy; avoid ever sending a literal placeholder.
  return text.replace(/\{\{\s*name\s*\}\}/gi, contactName?.trim() || "there");
}

function keywordList(flowData: unknown): string[] {
  const graph = flowData as { nodes?: { type?: string; data?: { config?: { keywords?: unknown } } }[] } | null;
  const trigger = graph?.nodes?.find((n) => n?.type === "triggerNode");
  const kw = trigger?.data?.config?.keywords;
  return typeof kw === "string" ? kw.split(",").map((k) => k.trim()).filter(Boolean) : [];
}
