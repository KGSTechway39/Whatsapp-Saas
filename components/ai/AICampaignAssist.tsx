"use client";

/**
 * ✨ Generate with AI — collapsible, visually SECONDARY box that sits ABOVE the
 * manual campaign form. It only pre-fills a draft into the existing fields via
 * `onApply`; it never creates or sends a campaign (the manual Launch action is
 * untouched). Every output is labelled "AI-generated — review before sending"
 * and tinted until the user applies it.
 */
import { useState } from "react";
import { Sparkles, ChevronDown, Loader2, Wand2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { AICreditsIndicator } from "./AICreditsIndicator";
import { RecommendedCampaignPrompts } from "@/components/verticals/Recommendations";

export interface CampaignDraft {
  campaignName: string;
  messageBody: string;
  variables: string[];
  suggestedSendTime: string;
}

const TONES = ["friendly", "professional", "urgent", "festive"];
const LANGS = [
  { code: "en", label: "English" },
  { code: "hi", label: "Hindi" },
  { code: "ta", label: "Tamil" },
  { code: "te", label: "Telugu" },
];

export function AICampaignAssist({ onApply }: { onApply: (draft: CampaignDraft) => void }) {
  const [open, setOpen] = useState(false);
  const [goal, setGoal] = useState("");
  const [audience, setAudience] = useState("");
  const [tone, setTone] = useState("friendly");
  const [language, setLanguage] = useState("en");
  const [loading, setLoading] = useState(false);
  const [draft, setDraft] = useState<CampaignDraft | null>(null);
  const [draftId, setDraftId] = useState<string>(() => crypto.randomUUID());

  async function generate(isRegen: boolean) {
    if (!goal.trim()) {
      toast.error("Describe your campaign goal first");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/ai/campaign-draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ goal, audience, tone, language, draftId }),
      });
      const data = await res.json();
      if (res.status === 429) {
        toast.warning(data.message ?? "Regeneration limit reached — edit manually.");
        return;
      }
      if (data.status === "fallback") {
        // Non-blocking: the manual form is always available.
        toast.message(data.message ?? "AI unavailable — build manually.");
        return;
      }
      if (data.status === "ok" && data.draft) {
        setDraft(data.draft);
        if (!isRegen) window.dispatchEvent(new Event("ai-credits-changed"));
      } else {
        toast.error(data.error ?? "Could not generate a draft");
      }
    } catch {
      toast.error("AI is temporarily unavailable — build manually.");
    } finally {
      setLoading(false);
    }
  }

  function startOver() {
    setDraft(null);
    setDraftId(crypto.randomUUID());
  }

  return (
    <div className="mb-6 rounded-xl border border-primary/25 bg-accent dark:border-primary/25 dark:bg-accent">
      {/* Header — secondary affordance, manual form remains the default below */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-4 py-3 text-left"
      >
        <span className="inline-flex items-center gap-2 text-sm font-medium text-primary dark:text-primary">
          <Sparkles className="h-4 w-4" />
          Generate with AI
          <span className="text-xs font-normal text-primary dark:text-primary">optional — pre-fills the form below</span>
        </span>
        <span className="inline-flex items-center gap-3">
          <AICreditsIndicator />
          <ChevronDown className={cn("h-4 w-4 text-primary transition-transform", open && "rotate-180")} />
        </span>
      </button>

      {open && (
        <div className="space-y-3 border-t border-primary/25 px-4 py-4 dark:border-primary/25">
          {/* Industry suggestions. Renders nothing when the client has no
              industry set — the manual box below is always the same. */}
          <RecommendedCampaignPrompts onPick={setGoal} />

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="sm:col-span-2 block text-sm">
              <span className="mb-1 block text-xs font-medium text-muted-foreground">Campaign goal</span>
              <textarea
                value={goal}
                onChange={(e) => setGoal(e.target.value)}
                rows={2}
                placeholder="e.g. Diwali sale — 20% off for repeat customers, drive orders this weekend"
                className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
              />
            </label>
            <label className="sm:col-span-2 block text-sm">
              <span className="mb-1 block text-xs font-medium text-muted-foreground">Audience (optional)</span>
              <input
                value={audience}
                onChange={(e) => setAudience(e.target.value)}
                placeholder="e.g. customers who ordered in the last 90 days"
                className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
              />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block text-xs font-medium text-muted-foreground">Tone</span>
              <select value={tone} onChange={(e) => setTone(e.target.value)} className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm capitalize">
                {TONES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </label>
            <label className="block text-sm">
              <span className="mb-1 block text-xs font-medium text-muted-foreground">Language</span>
              <select value={language} onChange={(e) => setLanguage(e.target.value)} className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm">
                {LANGS.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}
              </select>
            </label>
          </div>

          {!draft && (
            <button
              type="button"
              onClick={() => generate(false)}
              disabled={loading}
              className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary disabled:opacity-60"
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />}
              Generate draft <span className="text-xs opacity-80">(1 credit)</span>
            </button>
          )}

          {draft && (
            <div className="rounded-lg border border-primary/25 bg-card p-3 dark:border-primary/25 dark:bg-accent">
              {/* Draft label — reads as a suggestion until applied (rule) */}
              <div className="mb-2 inline-flex items-center gap-1.5 rounded-full bg-primary px-2 py-0.5 text-[11px] font-medium text-primary dark:bg-accent dark:text-primary">
                <Sparkles className="h-3 w-3" /> AI-generated — review before sending
              </div>
              <p className="text-xs font-medium text-muted-foreground">Name</p>
              <p className="mb-2 text-sm">{draft.campaignName || "—"}</p>
              <p className="text-xs font-medium text-muted-foreground">Message body</p>
              <p className="mb-2 whitespace-pre-wrap text-sm">{draft.messageBody}</p>
              {draft.variables.length > 0 && (
                <p className="mb-2 text-xs text-muted-foreground">Variables: {draft.variables.map((v, i) => `{{${i + 1}}} = ${v}`).join(", ")}</p>
              )}
              {draft.suggestedSendTime && (
                <p className="mb-3 text-xs text-muted-foreground">Suggested send time: {draft.suggestedSendTime}</p>
              )}
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => { onApply(draft); toast.success("Draft applied — review and edit below"); }}
                  className="rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-white hover:bg-primary"
                >
                  Use this draft
                </button>
                <button
                  type="button"
                  onClick={() => generate(true)}
                  disabled={loading}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-input px-3 py-1.5 text-sm hover:bg-accent disabled:opacity-60"
                >
                  {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                  Regenerate <span className="text-xs opacity-70">(free)</span>
                </button>
                <button type="button" onClick={startOver} className="rounded-lg px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground">
                  Start over
                </button>
              </div>
            </div>
          )}

          <p className="text-[11px] text-muted-foreground">
            AI copy is a starting point. Campaigns still send via an approved template — review, edit, and confirm manually.
          </p>
        </div>
      )}
    </div>
  );
}
