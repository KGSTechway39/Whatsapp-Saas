"use client";

/**
 * "Suggested for [industry]" rails — client-facing, in the workbench design
 * language (components/verticals/ui.tsx).
 *
 * Three rules these components exist to enforce:
 *   1. A client with NO industry sees nothing extra. Every rail renders null and
 *      the page behaves exactly as it does today. A vertical pre-fills; it never
 *      gates, and its absence is never presented as something missing.
 *   2. No system vocabulary on a client surface. The reference design shows
 *      `vertical_template_library` / `kind = CAMPAIGN_PROMPT` annotations — those
 *      belong to the ADMIN screen. Here the same slots carry plain language.
 *   3. Nothing activates anything. Every action pre-fills an editor the person
 *      then reviews and turns on themselves.
 */

import {
  ButtonAssist,
  Chip,
  CodeBlock,
  ConfirmNote,
  CustomerMessage,
  Eyebrow,
  LinkAssist,
  Panel,
  PanelHeading,
} from "@/components/verticals/ui";
import { cn } from "@/lib/utils";
import { useEffect, useState } from "react";

type Kind = "FLOW_JSON" | "CAMPAIGN_PROMPT" | "MESSAGE_TEMPLATE";

interface MyVertical {
  id: string;
  slug: string;
  displayName: string;
  icon: string | null;
}

export interface RecFlow {
  id: string;
  title: string;
  description: string;
  outcome: string;
  firstMessage: string | null;
  steps: number;
  collectsBooking: boolean;
}

export interface RecPrompt {
  id: string;
  title: string;
  description: string;
  outcome: string;
  prompt: string;
}

export interface RecTemplate {
  id: string;
  title: string;
  description: string;
  outcome: string;
  metaCategory: "UTILITY" | "MARKETING" | "AUTHENTICATION";
  body: string;
  footer: string | null;
  variableNames: string[];
}

interface Payload {
  vertical: MyVertical | null;
  flows: RecFlow[];
  campaignPrompts: RecPrompt[];
  messageTemplates: RecTemplate[];
}

/**
 * Loads the signed-in client's suggestions. Failures are silent on purpose: a
 * suggestion rail is an extra, and a network hiccup must never break the page a
 * person came here to use.
 */
function useRecommendations(kind: Kind) {
  const [data, setData] = useState<Payload | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/verticals/me?kind=${kind}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: Payload | null) => {
        if (!cancelled && d) setData(d);
      })
      .catch(() => {
        /* rails are additive — stay quiet */
      });
    return () => {
      cancelled = true;
    };
  }, [kind]);

  return data;
}

function RailHead({ vertical, title, lede }: { vertical: MyVertical; title: string; lede: string }) {
  return (
    <div className="mb-5">
      <Eyebrow tone="accent">Suggested for {vertical.displayName}</Eyebrow>
      <PanelHeading className="mt-2">{title}</PanelHeading>
      <p className="mt-1.5 text-base leading-relaxed text-v-muted">{lede}</p>
    </div>
  );
}

/** Wraps a rail in the paper ground so it reads as its own surface on any page. */
function Rail({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <section className={cn("rounded-xl border border-v-line bg-v-paper p-5 sm:p-6", className)}>{children}</section>
  );
}

// ─── Automations ────────────────────────────────────────────────────────────

/** Sits ABOVE the blank-canvas option, so the assisted path reads as the easy one. */
export function RecommendedFlows({ className }: { className?: string }) {
  const data = useRecommendations("FLOW_JSON");
  if (!data?.vertical || data.flows.length === 0) return null;

  return (
    <Rail className={className}>
      <RailHead
        vertical={data.vertical}
        title="Starter automations"
        lede="Ready-made replies for your business. Open one, change the wording, then turn it on."
      />

      <div className="grid gap-4 lg:grid-cols-2">
        {data.flows.map((f) => (
          <Panel as="article" key={f.id} className="flex flex-col p-5">
            <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
              <h3 className="text-[1.0625rem] font-bold leading-snug tracking-tight text-v-ink">{f.title}</h3>
              {f.collectsBooking && <Chip tone="accent">Takes bookings</Chip>}
            </div>
            <p className="mt-1.5 text-[0.9375rem] leading-relaxed text-v-muted">{f.outcome}</p>

            <div className="mt-4">
              {f.firstMessage ? (
                <CustomerMessage text={f.firstMessage} />
              ) : (
                <CodeBlock dashed>Starts by sorting the request, not by sending a message.</CodeBlock>
              )}
            </div>

            {/* Honest about what actually sends today (see the Phase 0 audit). */}
            {f.steps > 1 && (
              <p className="mt-3 text-[0.875rem] text-v-faint">
                {f.steps} messages · only the first sends today
              </p>
            )}

            <div className="mt-auto flex flex-wrap items-center gap-x-4 gap-y-2 pt-5">
              <LinkAssist href={`/automation/create?suggestion=${encodeURIComponent(f.id)}`}>Review &amp; edit</LinkAssist>
              <ConfirmNote />
            </div>
          </Panel>
        ))}
      </div>
    </Rail>
  );
}

// ─── Campaign prompts ───────────────────────────────────────────────────────

/**
 * The reference layout: the manual path on the left, starter prompts on the
 * right. The prompt itself is shown verbatim in monospace, because it is the
 * literal instruction the person is about to hand over and edit.
 */
export function RecommendedCampaignPrompts({
  onPick,
  className,
}: {
  onPick: (prompt: string) => void;
  className?: string;
}) {
  const data = useRecommendations("CAMPAIGN_PROMPT");
  if (!data?.vertical || data.campaignPrompts.length === 0) return null;

  return (
    <Rail className={className}>
      <RailHead
        vertical={data.vertical}
        title="Starter campaign prompts"
        lede="Open one to fill the box below. You can change every word before anything is written."
      />

      <div className="space-y-4">
        {data.campaignPrompts.map((p) => (
          <Panel as="article" key={p.id} className="p-5">
            <h3 className="text-[1.0625rem] font-bold leading-snug tracking-tight text-v-ink">{p.title}</h3>
            <p className="mt-1.5 text-[0.9375rem] leading-relaxed text-v-muted">{p.outcome}</p>

            <CodeBlock className="mt-4">{p.prompt}</CodeBlock>

            <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2">
              <ButtonAssist type="button" onClick={() => onPick(p.prompt)}>
                Review &amp; edit
              </ButtonAssist>
              <ConfirmNote />
            </div>
          </Panel>
        ))}
      </div>
    </Rail>
  );
}

// ─── Message templates ──────────────────────────────────────────────────────

export function RecommendedTemplates({
  onPick,
  className,
}: {
  onPick: (t: RecTemplate) => void;
  className?: string;
}) {
  const data = useRecommendations("MESSAGE_TEMPLATE");
  if (!data?.vertical || data.messageTemplates.length === 0) return null;

  return (
    <Rail className={className}>
      <RailHead
        vertical={data.vertical}
        title="Starter message templates"
        lede="Ready-written messages for your business. Open one, change the wording, then send it for approval."
      />

      <div className="grid gap-4 lg:grid-cols-2">
        {data.messageTemplates.map((t) => {
          const isOffer = t.metaCategory === "MARKETING";
          return (
            <Panel as="article" key={t.id} className="flex flex-col p-5">
              <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
                <h3 className="text-[1.0625rem] font-bold leading-snug tracking-tight text-v-ink">{t.title}</h3>
                {/* Plain language, not Meta's category name — this is a client surface. */}
                <Chip tone={isOffer ? "cost" : "neutral"}>{isOffer ? "Offer" : "Update"}</Chip>
              </div>
              <p className="mt-1.5 text-[0.9375rem] leading-relaxed text-v-muted">{t.outcome}</p>

              <div className="mt-4">
                <CustomerMessage text={t.body} />
              </div>

              <p className={cn("mt-3 text-[0.875rem]", isOffer ? "text-cost" : "text-v-faint")}>
                {isOffer
                  ? "Costs more per message than a booking or order update, and only goes to people who agreed to hear from you."
                  : "An update message — the cheaper kind to send."}
              </p>

              <div className="mt-auto flex flex-wrap items-center gap-x-4 gap-y-2 pt-5">
                <ButtonAssist type="button" onClick={() => onPick(t)}>
                  Review &amp; edit
                </ButtonAssist>
                <ConfirmNote />
              </div>
            </Panel>
          );
        })}
      </div>
    </Rail>
  );
}
