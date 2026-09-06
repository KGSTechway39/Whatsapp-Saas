/**
 * POST /api/ai/reminder-draft — AI-assisted appointment reminder copy
 * (task: reminder_draft).
 *
 * `reminder_draft` had been configured in ai_model_config since the AI layer
 * shipped, with a model, a price and a credit cost — but nothing in the codebase
 * ever called it. It was a paid-for capability with no caller. Now that
 * appointments are real (migration 036), this is its natural home.
 *
 * WHAT IT DOES NOT DO
 * It never sends, and it never creates a Meta template. It returns editable copy
 * for a human to paste into the reminder template they submit for approval — the
 * platform rule is that AI drafts and a human sends. Reminders actually go out
 * through the approved-template sweep in lib/appointments/reminders.ts.
 *
 * Billing / caps mirror /api/ai/campaign-draft:
 *   • 1 credit per draft; regenerations reuse `draftId` as the debit idempotency
 *     key, so a regen does not re-charge.
 *   • Regen count capped server-side from ai_usage_log, not by the UI.
 *   • Any failure/timeout/no-credits returns a 200 fallback envelope so the
 *     manual flow is never blocked.
 */
import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";
import { getUserTier, loadModelConfig } from "@/lib/ai/config";
import { runTask } from "@/lib/ai/service";
import { buildVerticalPromptContext, withVerticalContext } from "@/lib/verticals/prompt-context";
import { APPOINTMENT_SERVICES } from "@/lib/appointments/dto";

interface ReminderDraft {
  /** Template body using {{1}}, {{2}}, {{3}} for name / date / time. */
  messageBody: string;
  /** What each variable maps to, in order. */
  variables: string[];
  /** Suggested snake_case template name for Meta submission. */
  suggestedTemplateName: string;
}

const LANGS: Record<string, string> = {
  en: "English", en_IN: "Indian English", hi: "Hindi", ta: "Tamil",
  te: "Telugu", mr: "Marathi", bn: "Bengali", kn: "Kannada",
};

function parseDraft(raw: string): ReminderDraft {
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("no JSON object in model output");
  const p = JSON.parse(match[0]) as Partial<ReminderDraft>;
  if (!p.messageBody || typeof p.messageBody !== "string") {
    throw new Error("messageBody missing");
  }
  return {
    messageBody: p.messageBody.slice(0, 1024),
    variables: Array.isArray(p.variables) ? p.variables.slice(0, 5).map(String) : [],
    suggestedTemplateName: String(p.suggestedTemplateName ?? "appointment_reminder_v1")
      .toLowerCase()
      .replace(/[^a-z0-9_]/g, "_")
      .slice(0, 60),
  };
}

export async function POST(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const draftId = String(body?.draftId ?? "").trim();
  if (!draftId) return NextResponse.json({ error: "draftId is required" }, { status: 400 });

  const rawService = String(body?.service ?? "consultation").trim();
  const service = (APPOINTMENT_SERVICES as readonly string[]).includes(rawService)
    ? rawService
    : "consultation";
  const kind = body?.kind === "1h" ? "1h" : "24h";
  const tone = String(body?.tone ?? "friendly").trim().slice(0, 40);
  const language = String(body?.language ?? "en").trim();
  const langName = LANGS[language] ?? "English";
  const businessNote = String(body?.businessNote ?? "").trim().slice(0, 300);

  // Server-side regen cap, counted from the usage log rather than trusted from
  // the client — same approach as campaign drafts.
  const cfg = await loadModelConfig("reminder_draft");
  if (cfg) {
    const supabase = createServiceClient();
    const { count } = await supabase
      .from("ai_usage_log")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id)
      .eq("task_type", "reminder_draft")
      .eq("ref_id", draftId)
      .eq("status", "ok");
    if ((count ?? 0) > cfg.maxRegens) {
      return NextResponse.json(
        {
          status: "capped",
          message: `Regeneration limit reached (${cfg.maxRegens}). Edit the draft manually.`,
        },
        { status: 429 },
      );
    }
  }

  const tier = await getUserTier(user.id);

  const system = `You write WhatsApp appointment reminder templates for Indian SMBs.

Rules that matter for approval:
- This is a UTILITY template: it confirms an existing transaction the customer
  opted into. No marketing, no offers, no upselling — those get a template rejected.
- Use {{1}} for the customer's name, {{2}} for the date, {{3}} for the time,
  in that order. Do not invent other variables.
- No URL shorteners, no ALL CAPS, no emoji spam. One short paragraph.
- Body max 1024 characters. ${langName}. Tone: ${tone}.

Output ONLY valid JSON — no markdown, no commentary.`;

  const horizonNote =
    kind === "1h"
      ? "This reminder is sent about an hour before the appointment, so it should read as imminent."
      : "This reminder is sent about a day before the appointment.";

  const prompt = `Draft a WhatsApp appointment reminder template.
Service type: ${service}
${horizonNote}
${businessNote ? `About the business: ${businessNote}` : ""}

Return exactly this JSON:
{
  "messageBody": "the reminder using {{1}}, {{2}} and {{3}}",
  "variables": ["customer name", "appointment date", "appointment time"],
  "suggestedTemplateName": "snake_case name for Meta, must contain appointment_reminder"
}`;

  // Vertical context pre-fills the right vocabulary (a clinic reminds differently
  // from a salon). No vertical set → prompt is unchanged.
  const verticalContext = await buildVerticalPromptContext(user.id);

  const result = await runTask<ReminderDraft>({
    userId: user.id,
    tier,
    taskType: "reminder_draft",
    system,
    prompt: withVerticalContext(prompt, verticalContext),
    maxTokens: 700,
    idempotencyKey: draftId, // regens reuse it → charged once
    refId: draftId,
    parse: parseDraft,
  });

  if (result.status === "fallback") {
    // 200 with a non-blocking envelope: writing the reminder by hand still works.
    return NextResponse.json({
      status: "fallback",
      reason: result.reason,
      message: result.message,
    });
  }

  return NextResponse.json({ status: "ok", draft: result.data });
}
