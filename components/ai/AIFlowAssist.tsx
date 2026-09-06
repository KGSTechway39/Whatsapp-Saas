"use client";

/**
 * ✨ Build with AI — a SECONDARY entry point on the automation builder toolbar.
 * It opens a small panel where the owner describes the auto-reply in plain words
 * ("when a customer asks about price, send our price list and tag them as a hot
 * lead"); on apply it drops the generated steps onto the SAME canvas, fully
 * drag/edit-able. It never saves or activates the flow — the manual Save +
 * Activate buttons stay the only way anything goes live (explicit human confirm).
 *
 * The manual drag-from-palette workflow is untouched and remains the default.
 */
import { useState } from "react";
import { Sparkles, X, Loader2, Wand2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { AICreditsIndicator } from "./AICreditsIndicator";
import type { CanvasGraph } from "@/lib/automation/flow-schema";

const LANGS = [
  { code: "en", label: "English" },
  { code: "hi", label: "Hindi" },
  { code: "ta", label: "Tamil" },
  { code: "te", label: "Telugu" },
];

export function AIFlowAssist({ onApply }: { onApply: (graph: CanvasGraph) => void }) {
  const [open, setOpen] = useState(false);
  const [description, setDescription] = useState("");
  const [language, setLanguage] = useState("en");
  const [loading, setLoading] = useState(false);
  const [flow, setFlow] = useState<CanvasGraph | null>(null);
  const [draftId, setDraftId] = useState<string>(() => crypto.randomUUID());

  async function generate(isRegen: boolean) {
    if (!description.trim()) {
      toast.error("Describe what the automation should do first");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/ai/flow-draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description, language, draftId }),
      });
      const data = await res.json();
      if (res.status === 429) {
        toast.warning(data.message ?? "Regeneration limit reached — edit on the canvas.");
        return;
      }
      if (data.status === "fallback") {
        toast.message(data.message ?? "AI unavailable — build manually.");
        return;
      }
      if (data.status === "ok" && data.flow) {
        setFlow(data.flow);
        if (!isRegen) window.dispatchEvent(new Event("ai-credits-changed"));
      } else {
        toast.error(data.error ?? "Could not build a flow");
      }
    } catch {
      toast.error("AI is temporarily unavailable — build manually.");
    } finally {
      setLoading(false);
    }
  }

  function apply() {
    if (!flow) return;
    onApply(flow);
    toast.success("Flow added to canvas — review, edit, then Save & Activate");
    setOpen(false);
    setFlow(null);
    setDescription("");
    setDraftId(crypto.randomUUID());
  }

  return (
    <>
      {/* Toolbar trigger — secondary to Save/Activate; manual palette stays primary */}
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-primary/25 bg-accent text-xs font-medium text-primary hover:bg-accent transition-all"
        title="Describe the automation and let AI draft it"
      >
        <Sparkles className="w-3.5 h-3.5" />
        <span className="hidden sm:inline">Build with AI</span>
      </button>

      {open && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="w-full max-w-lg bg-chat-ground border border-border rounded-2xl shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-border">
              <div className="flex items-center gap-2.5">
                <Sparkles className="w-4 h-4 text-primary" />
                <p className="font-semibold text-sm text-white">Build a flow with AI</p>
              </div>
              <div className="flex items-center gap-3">
                <AICreditsIndicator />
                <button onClick={() => setOpen(false)} className="p-1.5 rounded-lg hover:bg-secondary transition-colors">
                  <X className="w-4 h-4 text-muted-foreground" />
                </button>
              </div>
            </div>

            <div className="p-5 space-y-4">
              <div>
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide block mb-1.5">
                  Describe the automation
                </label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={3}
                  placeholder="e.g. When a customer asks about price, send our price list and tag them as a hot lead. If they reply DEMO, hand the chat to our sales team."
                  className="w-full bg-chat-in border border-chat-inBorder border border-border rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-primary/60 focus:ring-1 focus:ring-primary/30 placeholder:text-muted-foreground resize-none"
                />
                <p className="text-[11px] text-muted-foreground mt-1">Plain language — no technical terms needed.</p>
              </div>

              <div className="w-40">
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide block mb-1.5">Reply language</label>
                <select
                  value={language}
                  onChange={(e) => setLanguage(e.target.value)}
                  className="w-full bg-chat-in border border-chat-inBorder border border-border rounded-lg px-3 py-2 text-sm text-white outline-none"
                >
                  {LANGS.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}
                </select>
              </div>

              {!flow && (
                <button
                  onClick={() => generate(false)}
                  disabled={loading}
                  className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary disabled:opacity-60"
                >
                  {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />}
                  Build flow <span className="text-xs opacity-80">(uses AI credits)</span>
                </button>
              )}

              {flow && (
                <div className="rounded-lg border border-primary/25 bg-accent p-3">
                  <div className="mb-2 inline-flex items-center gap-1.5 rounded-full bg-accent px-2 py-0.5 text-[11px] font-medium text-primary">
                    <Sparkles className="h-3 w-3" /> AI-generated — review before publishing
                  </div>
                  <p className="text-sm text-muted-foreground font-medium mb-1">{flow.name || "Automation flow"}</p>
                  <p className="text-xs text-muted-foreground mb-2">{flow.nodes.length} steps · {flow.edges.length} connections</p>
                  <ol className="space-y-1 mb-3 max-h-40 overflow-y-auto">
                    {flow.nodes.map((n) => (
                      <li key={n.id} className="text-xs text-muted-foreground flex items-start gap-2">
                        <span className="text-primary mt-0.5">•</span>
                        <span><span className="text-muted-foreground">{n.data.label}</span>
                          {typeof n.data.config.text === "string" ? ` — "${String(n.data.config.text).slice(0, 60)}"` : ""}
                        </span>
                      </li>
                    ))}
                  </ol>
                  <div className="flex flex-wrap gap-2">
                    <button onClick={apply} className="rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-white hover:bg-primary">
                      Add to canvas
                    </button>
                    <button
                      onClick={() => generate(true)}
                      disabled={loading}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm text-muted-foreground hover:bg-secondary disabled:opacity-60"
                    >
                      {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                      Regenerate <span className="text-xs opacity-70">(free)</span>
                    </button>
                  </div>
                </div>
              )}

              <p className="text-[11px] text-muted-foreground">
                AI drafts a starting point. Nothing goes live until you review it and turn the flow Active yourself.
              </p>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
