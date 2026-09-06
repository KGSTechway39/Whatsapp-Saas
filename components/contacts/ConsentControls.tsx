"use client";

/**
 * Consent capture UI.
 *
 * AUDIENCE: a hospital front-desk manager, not an engineer. So: no "DPDP",
 * no "sensitive_data_consent", no "vertical". Just what it means and what to
 * tap. Touch targets are sized for a phone at a busy counter.
 *
 * These render ONLY when the tenant's industry requires consent — the whole
 * column and banner disappear for a restaurant or a salon, because an
 * irrelevant compliance control is a control people learn to click past.
 */

import { contacts as contactsApi } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Check, Loader2, ShieldCheck, ShieldAlert, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

/** How consent was collected. Matches the API's allowed values. */
export const CONSENT_SOURCES: { value: string; label: string }[] = [
  { value: "in_person", label: "In person / on paper" },
  { value: "whatsapp_optin", label: "They messaged us first" },
  { value: "web_form", label: "Website form" },
  { value: "phone", label: "Over the phone" },
  { value: "imported", label: "Brought over from another system" },
];

/**
 * The explainer. Shown once above the list so staff understand why a column
 * exists and what happens if they ignore it — the consequence is the part that
 * actually changes behaviour.
 */
export function ConsentBanner({
  industryName,
  missingCount,
  onShowMissing,
}: {
  industryName: string;
  missingCount: number;
  onShowMissing?: () => void;
}) {
  return (
    <div className="rounded-xl border border-warning/25 bg-warning-soft p-4">
      <div className="flex items-start gap-3">
        <ShieldCheck className="mt-0.5 h-5 w-5 flex-shrink-0 text-warning" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-foreground">
            {industryName} accounts need permission before messaging
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            Because you handle sensitive information, a person has to agree before you can send
            them campaigns or automatic replies. Mark someone as agreed once you&apos;ve asked
            them — on paper, on a form, or when they message you first.
          </p>
          {missingCount > 0 && (
            <p className="mt-2 text-sm text-muted-foreground">
              <span className="font-semibold text-warning dark:text-warning">
                {missingCount} {missingCount === 1 ? "person on this page hasn't" : "people on this page haven't"} agreed yet
              </span>{" "}
              — they will be skipped if you send a campaign.
              {onShowMissing && (
                <button onClick={onShowMissing} className="ml-1.5 font-semibold text-primary hover:underline">
                  Show only those
                </button>
              )}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Per-row control. One tap to record, one tap to withdraw.
 *
 * Optimistic: the pill flips immediately and reverts on failure. At a counter,
 * waiting on a round-trip before the row acknowledges a tap reads as broken and
 * gets tapped again.
 */
export function ConsentCell({
  contactId,
  contactName,
  given,
  at,
  onChanged,
}: {
  contactId: string;
  contactName: string;
  given: boolean;
  at?: string | null;
  onChanged: (given: boolean) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [optimistic, setOptimistic] = useState(given);

  const toggle = async () => {
    const next = !optimistic;
    setOptimistic(next);
    setBusy(true);
    try {
      await contactsApi.setConsent(contactId, next, "in_person");
      onChanged(next);
      toast.success(
        next ? `${contactName} can now be messaged` : `Permission removed for ${contactName}`,
      );
    } catch (err) {
      setOptimistic(!next); // revert — the record did not change
      toast.error((err as Error).message || "Could not save that");
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      onClick={toggle}
      disabled={busy}
      title={optimistic && at ? `Agreed on ${new Date(at).toLocaleDateString("en-IN")}` : undefined}
      className={cn(
        // min-h-9 + generous padding: a real touch target, not a 12px checkbox.
        "inline-flex min-h-9 items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-semibold transition-colors disabled:opacity-60",
        optimistic
          ? "bg-success-soft text-success hover:bg-success-soft dark:text-success"
          : "bg-warning-soft text-warning hover:bg-warning-soft dark:text-warning",
      )}
    >
      {busy ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : optimistic ? (
        <Check className="h-3.5 w-3.5" />
      ) : (
        <ShieldAlert className="h-3.5 w-3.5" />
      )}
      {optimistic ? "Agreed" : "Not yet"}
    </button>
  );
}

/**
 * Bulk capture. A clinic collects consent from a queue, not one row at a time.
 *
 * The source picker is required rather than defaulted silently: "how did you
 * ask them?" is the part of the record that makes it defensible later, and
 * choosing it for the user would put a guess into a compliance field.
 */
export function ConsentBulkBar({
  count,
  onDone,
  onCancel,
  contactIds,
}: {
  count: number;
  contactIds: string[];
  onDone: () => void;
  onCancel: () => void;
}) {
  const [source, setSource] = useState("");
  const [busy, setBusy] = useState(false);

  const apply = async (given: boolean) => {
    if (given && !source) {
      toast.error("Choose how you asked them first");
      return;
    }
    setBusy(true);
    try {
      const res = await contactsApi.setConsentBulk(contactIds, given, source || undefined);
      if (res.failed.length > 0) {
        toast.warning(`${res.updated} saved, ${res.failed.length} couldn't be updated`);
      } else {
        toast.success(
          given
            ? `${res.updated} ${res.updated === 1 ? "person" : "people"} can now be messaged`
            : `Permission removed for ${res.updated}`,
        );
      }
      onDone();
    } catch (err) {
      toast.error((err as Error).message || "Could not save");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-primary/30 bg-primary/5 px-4 py-3">
      <span className="text-sm font-semibold text-primary">{count} selected</span>

      <select
        value={source}
        onChange={(e) => setSource(e.target.value)}
        disabled={busy}
        className="min-h-9 rounded-xl border border-border bg-card px-3 py-2 text-sm outline-none focus:border-primary"
      >
        <option value="">How did you ask them?</option>
        {CONSENT_SOURCES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
      </select>

      <button
        onClick={() => apply(true)}
        disabled={busy}
        className="inline-flex min-h-9 items-center gap-1.5 rounded-xl bg-success px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-60"
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
        Mark as agreed
      </button>

      <button
        onClick={() => apply(false)}
        disabled={busy}
        className="inline-flex min-h-9 items-center gap-1.5 rounded-xl border border-border px-3 py-2 text-sm font-medium text-muted-foreground hover:text-foreground disabled:opacity-60"
      >
        <X className="h-4 w-4" /> Remove permission
      </button>

      <button onClick={onCancel} className="ml-auto text-sm font-medium text-muted-foreground hover:text-foreground">
        Cancel
      </button>
    </div>
  );
}
