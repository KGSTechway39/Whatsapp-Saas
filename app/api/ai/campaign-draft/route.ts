/**
 * POST /api/ai/campaign-draft — AI-assisted campaign copy (task: campaign_content).
 *
 * Stateless single call that PRE-FILLS the manual campaign form. It never creates
 * or launches a campaign (rule 2) — it returns an editable draft the human edits
 * and then sends via the unchanged manual Launch action.
 *
 * Billing / caps:
 *   • 1 credit = 1 campaign draft. Regenerations reuse the same `draftId` as the
 *     debit idempotency key, so regens do NOT re-charge (rule 6).
 *   • Regenerations capped server-side at config.max_regens by counting prior
 *     successful drafts for this draftId in ai_usage_log (rule 7) — not the UI.
 *   • Any failure / timeout / no-credits → graceful fallback JSON; the manual
 *     form stays fully usable (rule 8).
 */
import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";
import { getUserTier, loadModelConfig } from "@/lib/ai/config";
import { runTask } from "@/lib/ai/service";

interface CampaignDraft {
  campaignName: string;
  messageBody: string;
  variables: string[];
  suggestedSendTime: string; // human-readable, e.g. "Tuesday 11:00 AM"
}

const LANGS: Record<string, string> = {
  en: "English", en_IN: "Indian English", hi: "Hindi", ta: "Tamil",
  te: "Telugu", mr: "Marathi", bn: "Bengali", kn: "Kannada",
};

function parseDraft(raw: string): CampaignDraft {
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("no JSON object in model output");
  const p = JSON.parse(match[0]) as Partial<CampaignDraft>;
  if (!p.messageBody || typeof p.messageBody !== "string") throw new Error("messageBody missing");
  return {
    campaignName: String(p.campaignName ?? "").slice(0, 80),
    messageBody: String(p.messageBody).slice(0, 1024),
    variables: Array.isArray(p.variables) ? p.variables.map((v) => String(v)).slice(0, 10) : [],
    suggestedSendTime: String(p.suggestedSendTime ?? "").slice(0, 60),
  };
}

export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const goal = String(body?.goal ?? "").trim();
  const draftId = String(body?.draftId ?? "").trim();
  if (!goal) return NextResponse.json({ error: "goal is required" }, { status: 400 });
  if (!draftId) return NextResponse.json({ error: "draftId is required" }, { status: 400 });

  const audience = String(body?.audience ?? "").trim();
  const tone = String(body?.tone ?? "friendly").trim();
  const language = String(body?.language ?? "en").trim();
  const langName = LANGS[language] ?? "English";

  // Server-side regen cap: count prior successful drafts for this draftId.
  const cfg = await loadModelConfig("campaign_content");
  if (cfg) {
    const supabase = createServiceClient();
    const { count } = await supabase
      .from("ai_usage_log")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id)
      .eq("task_type", "campaign_content")
      .eq("ref_id", draftId)
      .eq("status", "ok");
    if ((count ?? 0) > cfg.maxRegens) {
      return NextResponse.json(
        { status: "capped", message: `Regeneration limit reached (${cfg.maxRegens}). Edit the draft manually.` },
        { status: 429 },
      );
    }
  }

  const tier = await getUserTier(user.id);

  const system = `You are an expert WhatsApp Business campaign copywriter for Indian SMBs.
You write high-converting broadcast copy that respects Meta's policies (no spam, no
misleading claims, no URL shorteners). Use {{1}}, {{2}} … for personalization variables
(customer name, order id, etc). Body max 1024 chars.
Language: ${langName}. Tone: ${tone}.
Output ONLY valid JSON — no markdown, no commentary.`;

  const prompt = `Draft a WhatsApp campaign for this goal: "${goal}"
${audience ? `Audience: ${audience}` : ""}

Return exactly this JSON:
{
  "campaignName": "short internal name (max 80 chars)",
  "messageBody": "the message with {{1}} variables",
  "variables": ["what {{1}} is", "what {{2}} is"],
  "suggestedSendTime": "best day + time to send in IST, human-readable"
}`;

  const result = await runTask<CampaignDraft>({
    userId: user.id,
    tier,
    taskType: "campaign_content",
    system,
    prompt,
    maxTokens: 1200,
    idempotencyKey: draftId, // regens reuse it → charged once
    refId: draftId,
    parse: parseDraft,
  });

  if (result.status === "fallback") {
    // 200 with a non-blocking fallback envelope — the manual form is never blocked.
    return NextResponse.json({ status: "fallback", reason: result.reason, message: result.message });
  }
  return NextResponse.json({ status: "ok", draft: result.data });
}
