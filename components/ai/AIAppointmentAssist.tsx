"use client";

/**
 * ✨ Quick book — natural-language appointment entry that sits BESIDE the manual
 * booking form. It parses free text into the SAME structured fields and shows a
 * CONFIRMATION CARD; it never books (rule 2). "Review & confirm" pre-fills the
 * manual form so the human completes the existing Confirm step. On ambiguity it
 * still pre-fills what parsed and hands off to the manual form (rule 8).
 */
import { useState } from "react";
import { Sparkles, Loader2, Wand2 } from "lucide-react";
import { toast } from "sonner";
import { AICreditsIndicator } from "./AICreditsIndicator";

export interface ParsedBooking {
  customerName: string;
  customerPhone: string;
  service: string;
  date: string;
  time: string;
  notes: string;
  confidence: number;
  missing: string[];
}

export function AIAppointmentAssist({
  services,
  onApply,
}: {
  services: { id: string; label: string }[];
  /** Fill the manual form with whatever parsed; the human confirms/books. */
  onApply: (p: ParsedBooking) => void;
}) {
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);
  const [parsed, setParsed] = useState<ParsedBooking | null>(null);

  async function run() {
    if (!text.trim()) {
      toast.error("Type a booking request first");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/ai/appointment-parse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, services }),
      });
      const data = await res.json();
      if (data.status === "fallback") {
        toast.message(data.message ?? "AI unavailable — fill the form manually.");
        return;
      }
      if (data.status === "ok" && data.parsed) {
        setParsed(data.parsed);
        window.dispatchEvent(new Event("ai-credits-changed"));
      } else {
        toast.error(data.error ?? "Could not read that booking");
      }
    } catch {
      toast.error("AI is temporarily unavailable — fill the form manually.");
    } finally {
      setLoading(false);
    }
  }

  const serviceLabel = (id: string) => services.find((s) => s.id === id)?.label ?? id;

  return (
    <div className="mb-6 rounded-xl border border-violet-200 bg-violet-50/50 p-4 dark:border-violet-900/40 dark:bg-violet-950/20">
      <div className="mb-3 flex items-center justify-between">
        <span className="inline-flex items-center gap-2 text-sm font-medium text-violet-800 dark:text-violet-200">
          <Sparkles className="h-4 w-4" /> Quick book with AI
          <span className="text-xs font-normal text-violet-500 dark:text-violet-400">optional — you confirm before booking</span>
        </span>
        <AICreditsIndicator />
      </div>

      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && run()}
          placeholder='e.g. "book Ramesh 98765 43210 for a demo tomorrow at 5pm"'
          className="flex-1 rounded-lg border border-input bg-background px-3 py-2 text-sm"
        />
        <button
          type="button"
          onClick={run}
          disabled={loading}
          className="inline-flex items-center justify-center gap-2 rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-60"
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />}
          Parse <span className="text-xs opacity-80">(1 credit)</span>
        </button>
      </div>

      {parsed && (
        <div className="mt-3 rounded-lg border border-violet-300 bg-white p-3 dark:border-violet-800 dark:bg-violet-950/30">
          <div className="mb-2 inline-flex items-center gap-1.5 rounded-full bg-violet-100 px-2 py-0.5 text-[11px] font-medium text-violet-700 dark:bg-violet-900/50 dark:text-violet-300">
            <Sparkles className="h-3 w-3" /> AI-parsed — review before booking
          </div>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
            <Field label="Customer" value={parsed.customerName} />
            <Field label="Phone" value={parsed.customerPhone} />
            <Field label="Service" value={parsed.service ? serviceLabel(parsed.service) : ""} />
            <Field label="Date" value={parsed.date} />
            <Field label="Time" value={parsed.time} />
            {parsed.notes && <Field label="Notes" value={parsed.notes} />}
          </dl>

          {parsed.missing.length > 0 && (
            <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">
              Couldn’t read: {parsed.missing.join(", ")}. Fill these in the form.
            </p>
          )}

          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => {
                onApply(parsed);
                toast.success(
                  parsed.missing.length > 0
                    ? "Pre-filled — complete the missing fields, then confirm"
                    : "Pre-filled — review and confirm to book",
                );
              }}
              className="rounded-lg bg-violet-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-violet-700"
            >
              Review &amp; confirm →
            </button>
            <button type="button" onClick={() => setParsed(null)} className="rounded-lg px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground">
              Discard
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={value ? "font-medium" : "italic text-muted-foreground"}>{value || "—"}</dd>
    </>
  );
}
