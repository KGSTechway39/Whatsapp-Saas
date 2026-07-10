"use client";

/**
 * "AI Credits remaining" pill — the AI-wallet analogue of the message-credit
 * indicator (rule: styled identically to the WhatsApp message credit indicator).
 * Read-only; balance is authoritative server-side. Consistent ✨ across the app.
 */
import { useEffect, useState } from "react";
import { Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

let cachedCredits: number | null = null; // avoid a flash of "…" on remount

export function AICreditsIndicator({ className }: { className?: string }) {
  const [credits, setCredits] = useState<number | null>(cachedCredits);

  useEffect(() => {
    let alive = true;
    const load = () =>
      fetch("/api/ai/wallet")
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          if (alive && d && typeof d.credits === "number") {
            cachedCredits = d.credits;
            setCredits(d.credits);
          }
        })
        .catch(() => {});
    load();
    // Refetch after any AI action debits credits.
    window.addEventListener("ai-credits-changed", load);
    return () => {
      alive = false;
      window.removeEventListener("ai-credits-changed", load);
    };
  }, []);

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border border-violet-200 bg-violet-50 px-2.5 py-1 text-xs font-medium text-violet-700",
        "dark:border-violet-900/50 dark:bg-violet-950/40 dark:text-violet-300",
        className,
      )}
      title="AI Credits remaining"
    >
      <Sparkles className="h-3.5 w-3.5" />
      {credits === null ? "…" : credits.toLocaleString("en-IN")} AI Credits
    </span>
  );
}
