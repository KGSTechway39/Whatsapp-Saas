"use client";

/**
 * The guided seed-kit form (Phase 2).
 *
 * This operationalizes the "Other" pattern: an admin adds Salon, Gym or Travel
 * Agency by answering plain-language questions, and the server assembles the
 * automations. The admin never sees or writes flow structure.
 *
 * It collects exactly the three seed items the pattern requires:
 *   1. one booking / enquiry automation
 *   2. one reminder / status automation
 *   3. one campaign idea + two message templates (one update, one offer)
 *
 * Server-side, every item goes through the same validation the shipped content
 * passes, so a hand-authored industry cannot produce an automation the client's
 * builder is unable to open.
 */

import { admin as adminApi, type MetaCategory, type VerticalSeedKit } from "@/lib/api";
import { ICON_CHOICES, VerticalIcon } from "@/components/verticals/VerticalIcon";
import { cn } from "@/lib/utils";
import { Loader2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

interface Props {
  onCancel: () => void;
  onCreated: (verticalId: string) => void | Promise<void>;
}

const FIELD =
  "w-full rounded-lg border border-input bg-card px-3 py-2.5 text-base " +
  "placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

/** Count {{1}}, {{2}} … so we can name the blanks without asking the admin to. */
function placeholderCount(body: string): number {
  const found = new Set<number>();
  const re = /\{\{\s*(\d+)\s*\}\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) found.add(Number(m[1]));
  return found.size;
}

export function NewVerticalForm({ onCancel, onCreated }: Props) {
  const [saving, setSaving] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [description, setDescription] = useState("");
  const [icon, setIcon] = useState(ICON_CHOICES[0].name);

  const [bookingTitle, setBookingTitle] = useState("");
  const [bookingOutcome, setBookingOutcome] = useState("");
  const [bookingKeywords, setBookingKeywords] = useState("");
  const [bookingAsk, setBookingAsk] = useState("");

  const [statusTitle, setStatusTitle] = useState("");
  const [statusOutcome, setStatusOutcome] = useState("");
  const [statusKeywords, setStatusKeywords] = useState("");
  const [statusNotify, setStatusNotify] = useState("");

  const [promptTitle, setPromptTitle] = useState("");
  const [promptOutcome, setPromptOutcome] = useState("");
  const [promptText, setPromptText] = useState("");

  const [utilTitle, setUtilTitle] = useState("");
  const [utilOutcome, setUtilOutcome] = useState("");
  const [utilBody, setUtilBody] = useState("");
  const [mktTitle, setMktTitle] = useState("");
  const [mktOutcome, setMktOutcome] = useState("");
  const [mktBody, setMktBody] = useState("");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);

    const template = (title: string, outcome: string, body: string, metaCategory: MetaCategory) => ({
      title,
      description: outcome,
      outcome,
      body,
      // Name the blanks positionally — the admin fills real values when sending.
      variableNames: Array.from({ length: placeholderCount(body) }, (_, i) => `detail_${i + 1}`),
      metaCategory,
    });

    const body: VerticalSeedKit = {
      displayName,
      description,
      icon,
      bookingFlow: {
        title: bookingTitle,
        description: bookingOutcome,
        outcome: bookingOutcome,
        keywords: bookingKeywords,
        askMessage: bookingAsk,
      },
      statusFlow: {
        title: statusTitle,
        description: statusOutcome,
        outcome: statusOutcome,
        keywords: statusKeywords,
        notifyMessage: statusNotify,
      },
      campaignPrompt: {
        title: promptTitle,
        description: promptOutcome,
        outcome: promptOutcome,
        prompt: promptText,
      },
      templates: [
        template(utilTitle, utilOutcome, utilBody, "UTILITY"),
        template(mktTitle, mktOutcome, mktBody, "MARKETING"),
      ],
    };

    try {
      const { vertical } = await adminApi.verticalCreate(body);
      toast.success(`${vertical.displayName} added`);
      await onCreated(vertical.id);
    } catch (err) {
      toast.error((err as Error).message || "We couldn't add that industry. Please check the fields and try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} className="mt-4 space-y-6 rounded-xl border border-border bg-card p-5">
      <div>
        <h3 className="font-display text-base font-bold">Add a new industry</h3>
        <p className="mt-1 text-base text-muted-foreground">
          Answer these and we&apos;ll build the starting automations for you. Everything can be edited later.
        </p>
      </div>

      <Field label="Industry name" hint="What this kind of business is called, e.g. Gym.">
        <input className={FIELD} value={displayName} onChange={(e) => setDisplayName(e.target.value)} required maxLength={40} />
      </Field>

      <Field label="One line about it" hint="Shown on the card when choosing an industry.">
        <input className={FIELD} value={description} onChange={(e) => setDescription(e.target.value)} required maxLength={120} />
      </Field>

      <Field label="Icon">
        <div className="flex flex-wrap gap-2">
          {ICON_CHOICES.map((c) => (
            <button
              key={c.name}
              type="button"
              onClick={() => setIcon(c.name)}
              aria-pressed={icon === c.name}
              title={c.label}
              className={cn(
                "flex h-11 w-11 items-center justify-center rounded-lg border transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                icon === c.name ? "border-primary bg-rec text-primary" : "border-border hover:bg-secondary",
              )}
            >
              <VerticalIcon name={c.name} className="h-5 w-5" />
              <span className="sr-only">{c.label}</span>
            </button>
          ))}
        </div>
      </Field>

      <Step n={1} title="An automation that takes a booking or enquiry">
        <Field label="Name it">
          <input className={FIELD} value={bookingTitle} onChange={(e) => setBookingTitle(e.target.value)} required maxLength={60} />
        </Field>
        <Field label="What it does for the business" hint="Plain language — the client reads this.">
          <input className={FIELD} value={bookingOutcome} onChange={(e) => setBookingOutcome(e.target.value)} required maxLength={160} />
        </Field>
        <Field label="Words a customer might send" hint="Separate with commas, e.g. booking, class, membership.">
          <input className={FIELD} value={bookingKeywords} onChange={(e) => setBookingKeywords(e.target.value)} required />
        </Field>
        <Field label="What we should reply and ask" hint="Use {{name}} to greet them by name.">
          <textarea className={cn(FIELD, "min-h-[6rem]")} value={bookingAsk} onChange={(e) => setBookingAsk(e.target.value)} required maxLength={1024} />
        </Field>
      </Step>

      <Step n={2} title="An automation that tells a customer something is ready or due">
        <Field label="Name it">
          <input className={FIELD} value={statusTitle} onChange={(e) => setStatusTitle(e.target.value)} required maxLength={60} />
        </Field>
        <Field label="What it does for the business">
          <input className={FIELD} value={statusOutcome} onChange={(e) => setStatusOutcome(e.target.value)} required maxLength={160} />
        </Field>
        <Field label="Words a customer might send" hint="Separate with commas.">
          <input className={FIELD} value={statusKeywords} onChange={(e) => setStatusKeywords(e.target.value)} required />
        </Field>
        <Field label="What we should send them">
          <textarea className={cn(FIELD, "min-h-[6rem]")} value={statusNotify} onChange={(e) => setStatusNotify(e.target.value)} required maxLength={1024} />
        </Field>
      </Step>

      <Step n={3} title="A campaign idea and two message templates">
        <Field label="Campaign idea — name it">
          <input className={FIELD} value={promptTitle} onChange={(e) => setPromptTitle(e.target.value)} required maxLength={60} />
        </Field>
        <Field label="What it does for the business">
          <input className={FIELD} value={promptOutcome} onChange={(e) => setPromptOutcome(e.target.value)} required maxLength={160} />
        </Field>
        <Field label="The instruction we give the writing assistant" hint="At least a sentence — describe the message you want written.">
          <textarea className={cn(FIELD, "min-h-[6rem]")} value={promptText} onChange={(e) => setPromptText(e.target.value)} required maxLength={600} />
        </Field>

        <div className="rounded-lg border border-border p-4">
          <p className="mb-3 text-base font-semibold">Template 1 — an update</p>
          <p className="mb-3 text-base text-muted-foreground">
            A booking confirmation, a reminder, something is ready. These cost less per message.
          </p>
          <Field label="Name it">
            <input className={FIELD} value={utilTitle} onChange={(e) => setUtilTitle(e.target.value)} required maxLength={60} />
          </Field>
          <Field label="What it does for the business">
            <input className={FIELD} value={utilOutcome} onChange={(e) => setUtilOutcome(e.target.value)} required maxLength={160} />
          </Field>
          <Field label="The message" hint="Use {{1}}, {{2}} for blanks you fill in when sending. Number them in order from 1.">
            <textarea className={cn(FIELD, "min-h-[5rem]")} value={utilBody} onChange={(e) => setUtilBody(e.target.value)} required maxLength={1024} />
          </Field>
        </div>

        <div className="rounded-lg border border-border p-4">
          <p className="mb-1 text-base font-semibold">Template 2 — an offer</p>
          <p className="mb-3 text-base text-cost">Offers cost more per message than updates, and only go to people who agreed to hear from you.</p>
          <Field label="Name it">
            <input className={FIELD} value={mktTitle} onChange={(e) => setMktTitle(e.target.value)} required maxLength={60} />
          </Field>
          <Field label="What it does for the business">
            <input className={FIELD} value={mktOutcome} onChange={(e) => setMktOutcome(e.target.value)} required maxLength={160} />
          </Field>
          <Field label="The message" hint="Use {{1}}, {{2}} for blanks. Number them in order from 1.">
            <textarea className={cn(FIELD, "min-h-[5rem]")} value={mktBody} onChange={(e) => setMktBody(e.target.value)} required maxLength={1024} />
          </Field>
        </div>
      </Step>

      <div className="flex flex-wrap gap-3">
        <button
          type="submit"
          disabled={saving}
          className="inline-flex min-h-[2.75rem] items-center gap-2 rounded-lg bg-primary px-5 py-2.5 text-base font-semibold text-primary-foreground transition-colors hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-60"
        >
          {saving && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
          Add industry
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="min-h-[2.75rem] rounded-lg border border-border px-5 py-2.5 text-base transition-colors hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="mb-3 block">
      <span className="mb-1 block text-base font-medium">{label}</span>
      {hint && <span className="mb-1.5 block text-base text-muted-foreground">{hint}</span>}
      {children}
    </label>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <fieldset className="rounded-xl border border-rec-border bg-rec/40 p-4">
      <legend className="px-2 font-display text-base font-bold">
        {n}. {title}
      </legend>
      {children}
    </fieldset>
  );
}
