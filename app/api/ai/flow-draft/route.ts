/**
 * POST /api/ai/flow-draft — AI-assisted automation flow (task: automation_flow_builder).
 *
 * Turns a plain-language description ("if a customer asks about price, send our
 * price list and tag them as a hot lead") into a canvas flow graph that the
 * builder renders onto the SAME @xyflow/react editor the manual palette uses.
 *
 * This is DESIGN-TIME only and DRAFT-only (rule 2): it never sets is_active, never
 * saves a flow, never sends a message. The returned graph is handed to the canvas
 * for the human to edit and then Save + Activate manually.
 *
 * Correctness of the graph matters (it drives a visual editor), so:
 *   • routes to a stronger model via ai_model_config (Sonnet-class by default);
 *   • runTask schema-validates each attempt (sanitizeFlowGraph) and silently
 *     retries up to config.max_regens, feeding the validation error back;
 *   • any failure / timeout / no-credits / tier-lock → graceful fallback JSON so
 *     the manual builder is never blocked (rule 8).
 *
 * Billing: 1 draft = config.credits_per_action, charged once per draftId (regens
 * reuse the idempotency key), on the SEPARATE AI-credit wallet — never the message
 * wallet (rule 3).
 */
import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";
import { getUserTier, loadModelConfig } from "@/lib/ai/config";
import { runTask } from "@/lib/ai/service";
import { buildVerticalPromptContext, withVerticalContext } from "@/lib/verticals/prompt-context";
import { sanitizeFlowGraph, type CanvasGraph } from "@/lib/automation/flow-schema";
import {
  flowBuilderSystemPrompt,
  flowBuilderUserPrompt,
  flowBuilderRetryHint,
} from "@/lib/ai/prompts/flow-builder";

function parseGraph(raw: string): CanvasGraph {
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("no JSON object in output");
  return sanitizeFlowGraph(JSON.parse(match[0]));
}

export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const description = String(body?.description ?? "").trim();
  const draftId = String(body?.draftId ?? "").trim();
  const businessName = String(body?.businessName ?? "").trim();
  const language = String(body?.language ?? "en").trim();
  if (!description) return NextResponse.json({ error: "description is required" }, { status: 400 });
  if (!draftId) return NextResponse.json({ error: "draftId is required" }, { status: 400 });

  // Server-side regen cap (rule 7): count prior successful drafts for this draftId.
  const cfg = await loadModelConfig("automation_flow_builder");
  if (cfg) {
    const supabase = createServiceClient();
    const { count } = await supabase
      .from("ai_usage_log")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id)
      .eq("task_type", "automation_flow_builder")
      .eq("ref_id", draftId)
      .eq("status", "ok");
    if ((count ?? 0) > cfg.maxRegens) {
      return NextResponse.json(
        { status: "capped", message: `Regeneration limit reached (${cfg.maxRegens}). Edit the flow on the canvas.` },
        { status: 429 },
      );
    }
  }

  const tier = await getUserTier(user.id);
  // Industry context only; the node-type contract stays in the SYSTEM prompt,
  // which is never touched (sanitizeFlowGraph depends on it).
  const verticalContext = await buildVerticalPromptContext(user.id);

  const result = await runTask<CanvasGraph>({
    userId: user.id,
    tier,
    taskType: "automation_flow_builder",
    system: flowBuilderSystemPrompt(language),
    prompt: withVerticalContext(flowBuilderUserPrompt(description, businessName), verticalContext),
    maxTokens: 2000,
    idempotencyKey: draftId, // regens reuse it → charged once
    refId: draftId,
    parse: parseGraph,
    silentRetries: 2, // JSON correctness is critical → retry with the schema error
    appendOnRetry: (err) => flowBuilderRetryHint(err),
  });

  if (result.status === "fallback") {
    // 200 non-blocking envelope — the manual builder stays fully usable.
    return NextResponse.json({ status: "fallback", reason: result.reason, message: result.message });
  }
  return NextResponse.json({ status: "ok", flow: result.data });
}
