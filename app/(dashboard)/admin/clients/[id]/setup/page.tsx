"use client";

/**
 * Admin: provision a client into an industry (Phase 2).
 *
 * Two rules shape this screen:
 *   1. The admin never provisions blind — selecting a card shows exactly what
 *      will appear on the client's dashboard, before anything is saved.
 *   2. Nothing here is destructive. Changing or clearing an industry rewrites one
 *      column; the client's own flows, campaigns and templates are untouched.
 *
 * The card grid is pulled live from the database — no industry name, icon or
 * description is hardcoded here.
 */

import { VerticalIcon } from "@/components/verticals/VerticalIcon";
import {
  Annotation,
  ButtonPrimary,
  ButtonQuiet,
  Chip,
  CodeBlock,
  CustomerMessage,
  Dot,
  Eyebrow,
  Panel,
  PanelHeading,
} from "@/components/verticals/ui";
import { admin as adminApi, type AdminVertical, type AdminVerticalClient, type VerticalPreview } from "@/lib/api";
import { cn } from "@/lib/utils";
import {
  AlertCircle,
  ArrowLeft,
  Check,
  CircleHelp,
  Info,
  Loader2,
  MessageSquare,
  Plus,
  Sparkles,
  Workflow,
} from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { NewVerticalForm } from "@/components/verticals/NewVerticalForm";

export default function ClientSetupPage() {
  const params = useParams<{ id: string }>();
  const clientId = params.id;

  const [authorized, setAuthorized] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [client, setClient] = useState<AdminVerticalClient | null>(null);
  const [current, setCurrent] = useState<AdminVertical | null>(null);
  const [verticals, setVerticals] = useState<AdminVertical[]>([]);

  const [selected, setSelected] = useState<string | null>(null);
  const [preview, setPreview] = useState<VerticalPreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showNewForm, setShowNewForm] = useState(false);

  const loadCatalogue = useCallback(async () => {
    const { verticals } = await adminApi.verticals();
    setVerticals(verticals.filter((v) => v.isActive));
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await adminApi.check();
        if (cancelled) return;
        setAuthorized(true);

        const [{ client, vertical }] = await Promise.all([adminApi.clientVertical(clientId), loadCatalogue()]);
        if (cancelled) return;
        setClient(client);
        setCurrent(vertical);
        setSelected(vertical?.id ?? null);
      } catch (err) {
        if (cancelled) return;
        const message = (err as Error).message || "";
        if (message.toLowerCase().includes("forbidden")) setAuthorized(false);
        else {
          setAuthorized(true);
          toast.error("We couldn't load this client. Check your connection and try again.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [clientId, loadCatalogue]);

  // Selecting a card loads the preview. Nothing is saved until the admin confirms.
  useEffect(() => {
    if (!selected) {
      setPreview(null);
      return;
    }
    let cancelled = false;
    setPreviewLoading(true);
    adminApi
      .verticalPreview(selected)
      .then((data) => {
        if (!cancelled) setPreview(data);
      })
      .catch(() => {
        if (!cancelled) toast.error("We couldn't load what this industry includes.");
      })
      .finally(() => {
        if (!cancelled) setPreviewLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selected]);

  const save = async (verticalId: string | null) => {
    setSaving(true);
    try {
      const { vertical } = await adminApi.clientVerticalSet(clientId, verticalId);
      setCurrent(vertical);
      setSelected(vertical?.id ?? null);
      toast.success(vertical ? `Industry set to ${vertical.displayName}` : "Industry cleared");
    } catch (err) {
      toast.error((err as Error).message || "We couldn't save the industry. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  if (authorized === false) {
    return (
      <div className="mx-auto max-w-lg py-16 text-center">
        <AlertCircle className="mx-auto mb-4 h-10 w-10 text-v-faint" aria-hidden="true" />
        <h1 className="text-xl font-bold tracking-tight text-v-ink">You don&apos;t have access to this page</h1>
        <p className="mt-2 text-base text-v-muted">
          Only platform administrators can set up a client. Ask an admin if you need access.
        </p>
      </div>
    );
  }

  if (loading || authorized === null) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-6 w-6 animate-spin text-v-faint" aria-hidden="true" />
        <span className="sr-only">Loading</span>
      </div>
    );
  }

  const isCurrent = (id: string | null) => (current?.id ?? null) === id;
  const changed = (current?.id ?? null) !== (selected ?? null);
  const clientLabel = client?.full_name?.trim() || client?.email || "this client";

  return (
    <div className="-m-4 min-h-screen bg-v-paper p-4 pb-24 sm:-m-6 sm:p-6 md:-m-8 md:p-8">
      {/* ── Header band ── */}
      <header className="mb-8 border-b border-v-line pb-8">
        <Link
          href="/admin"
          className="mb-5 inline-flex items-center gap-2 rounded text-[0.9375rem] text-v-muted transition-colors hover:text-v-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-v-accent"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Back to clients
        </Link>

        <div className="flex flex-wrap items-start justify-between gap-6">
          <div className="max-w-2xl">
            <Eyebrow>Client setup</Eyebrow>
            <h1 className="mt-2 text-[2.25rem] font-bold leading-[1.1] tracking-tight text-v-ink">
              Set up this client
            </h1>
            <p className="mt-3 text-base leading-relaxed text-v-muted">
              Choose the industry {clientLabel} works in. We&apos;ll fill their dashboard with ready-made message
              ideas — as suggestions they review, never as anything already switched on.
            </p>
          </div>

          {/* Current state, mirroring the reference's badge. */}
          <div className="flex items-center gap-3 rounded-lg border border-v-line bg-v-surface px-4 py-2.5">
            <Dot active={Boolean(current)} />
            <span className="text-[0.9375rem] font-medium text-v-ink">
              {current ? current.displayName : "No industry set"}
            </span>
            {current && (
              <>
                <span aria-hidden="true" className="h-4 w-px bg-v-line" />
                <button
                  type="button"
                  onClick={() => save(null)}
                  disabled={saving}
                  className="rounded text-[0.9375rem] text-v-accent hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-v-accent disabled:opacity-50"
                >
                  Clear
                </button>
              </>
            )}
          </div>
        </div>
      </header>

      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]">
        {/* ── Picker ── */}
        <Panel className="p-5 sm:p-6" aria-labelledby="picker-heading">
          <Eyebrow>Assisted setup</Eyebrow>
          <PanelHeading className="mt-2" id="picker-heading">
            Choose an industry
          </PanelHeading>
          <p className="mt-1.5 text-base leading-relaxed text-v-muted">
            Each one comes with its own automations, campaign ideas and message templates.
          </p>

          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            {verticals.map((v) => {
              const active = selected === v.id;
              return (
                <button
                  key={v.id}
                  type="button"
                  onClick={() => setSelected(v.id)}
                  aria-pressed={active}
                  className={cn(
                    "flex min-h-[6.5rem] flex-col items-start gap-2 rounded-lg border p-4 text-left",
                    "transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-v-accent",
                    active
                      ? "border-v-accent bg-v-accentSoft"
                      : "border-v-line bg-v-surface hover:bg-v-surface2",
                  )}
                >
                  <span className="flex w-full items-center gap-2">
                    <VerticalIcon name={v.icon} className="h-4 w-4 shrink-0 text-v-accent" />
                    <span className="text-[0.9375rem] font-semibold tracking-tight text-v-ink">{v.displayName}</span>
                    {isCurrent(v.id) && <Check className="ml-auto h-4 w-4 text-v-accent" aria-label="Current" />}
                  </span>
                  <span className="text-[0.875rem] leading-snug text-v-muted">{v.description}</span>
                </button>
              );
            })}

            {/* Same component, same size, same weight — never a downgrade. */}
            <button
              type="button"
              onClick={() => setSelected(null)}
              aria-pressed={selected === null}
              className={cn(
                "flex min-h-[6.5rem] flex-col items-start gap-2 rounded-lg border p-4 text-left",
                "transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-v-accent",
                selected === null
                  ? "border-v-accent bg-v-accentSoft"
                  : "border-v-line bg-v-surface hover:bg-v-surface2",
              )}
            >
              <span className="flex w-full items-center gap-2">
                <CircleHelp className="h-4 w-4 shrink-0 text-v-accent" aria-hidden="true" />
                <span className="text-[0.9375rem] font-semibold tracking-tight text-v-ink">Skip for now</span>
                {isCurrent(null) && <Check className="ml-auto h-4 w-4 text-v-accent" aria-label="Current" />}
              </span>
              <span className="text-[0.875rem] leading-snug text-v-muted">
                Full dashboard, no suggestions. You can pick an industry any time.
              </span>
            </button>
          </div>

          <div className="mt-5 border-t border-v-line pt-5">
            <ButtonQuiet type="button" onClick={() => setShowNewForm((s) => !s)}>
              <Plus className="h-4 w-4" aria-hidden="true" />
              Add a new industry
            </ButtonQuiet>
          </div>

          {showNewForm && (
            <NewVerticalForm
              onCancel={() => setShowNewForm(false)}
              onCreated={async (verticalId) => {
                setShowNewForm(false);
                await loadCatalogue();
                setSelected(verticalId);
              }}
            />
          )}
        </Panel>

        {/* ── Preview ── */}
        <section aria-labelledby="preview-heading" aria-live="polite">
          {selected === null ? (
            <Panel className="p-5 sm:p-6">
              <Eyebrow>No industry</Eyebrow>
              <PanelHeading className="mt-2" id="preview-heading">
                Nothing extra, nothing missing
              </PanelHeading>
              <CodeBlock dashed className="mt-4">
                {"suggestions — none\nFull dashboard, unchanged."}
              </CodeBlock>
              <p className="mt-4 text-base leading-relaxed text-v-muted">
                This client keeps the complete product — inbox, contacts, billing, and the message and automation
                builders. They simply won&apos;t see ready-made suggestions to start from.
              </p>
            </Panel>
          ) : previewLoading ? (
            <Panel className="flex items-center gap-2 p-6 text-base text-v-muted">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              Loading what this industry includes…
            </Panel>
          ) : preview ? (
            <PreviewPanel preview={preview} />
          ) : null}
        </section>
      </div>

      {/* ── Sticky commit bar ── */}
      <div className="sticky bottom-0 z-10 mt-8 flex flex-wrap items-center gap-4 border-t border-v-line bg-v-paper/95 py-4 backdrop-blur">
        <ButtonPrimary type="button" onClick={() => save(selected)} disabled={saving || !changed}>
          {saving && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
          {selected === null ? "Save — no industry" : "Save changes"}
        </ButtonPrimary>
        <span className="text-[0.9375rem] text-v-faint">
          {changed
            ? "Nothing is switched on for the client — these are suggestions they confirm."
            : "Nothing to save yet."}
        </span>
      </div>
    </div>
  );
}

// ─── Preview panel ──────────────────────────────────────────────────────────

function PreviewPanel({ preview }: { preview: VerticalPreview }) {
  const { vertical, flows, campaignPrompts, messageTemplates } = preview;
  const marketingCount = messageTemplates.filter((t) => t.metaCategory === "MARKETING").length;

  return (
    <div className="space-y-6">
      <Panel className="p-5 sm:p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <Eyebrow tone="accent">Suggested for {vertical.displayName}</Eyebrow>
            <PanelHeading className="mt-2" id="preview-heading">
              What they&apos;ll see
            </PanelHeading>
          </div>
          {/* Admin surface — system identifiers are appropriate here, and only here. */}
          <Annotation lines={["vertical_template_library", `vertical = ${vertical.slug}`]} />
        </div>

        <dl className="mt-5 grid grid-cols-3 gap-px overflow-hidden rounded-lg border border-v-line bg-v-line">
          {[
            ["Automations", flows.length],
            ["Campaign ideas", campaignPrompts.length],
            ["Templates", messageTemplates.length],
          ].map(([label, n]) => (
            <div key={String(label)} className="bg-v-surface px-4 py-3">
              <dt className="font-mono text-[0.6875rem] uppercase tracking-[0.12em] text-v-faint">{label}</dt>
              <dd className="mt-1 text-2xl font-bold tracking-tight text-v-ink">{n}</dd>
            </div>
          ))}
        </dl>

        <p className="mt-4 flex items-start gap-2 text-[0.9375rem] leading-relaxed text-v-muted">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-v-faint" aria-hidden="true" />
          Nothing is switched on. The client reviews each one and turns it on themselves before it can message a real
          customer.
        </p>
      </Panel>

      <PreviewGroup icon={Workflow} title="Automations" count={flows.length} kind="FLOW_JSON">
        {flows.map((f) => (
          <Panel as="article" key={f.id} className="p-5">
            <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
              <h4 className="text-[1.0625rem] font-bold leading-snug tracking-tight text-v-ink">{f.title}</h4>
              {f.collectsBooking && <Chip tone="accent">Takes bookings</Chip>}
              {/* Honest about the Phase 0 runtime limit — no silent over-promise. */}
              {f.steps > 1 && <Chip>{f.steps} msgs · first only</Chip>}
            </div>
            <p className="mt-1.5 text-[0.9375rem] leading-relaxed text-v-muted">{f.outcome}</p>
            <div className="mt-4">
              {f.firstMessage ? (
                <CustomerMessage text={f.firstMessage} />
              ) : (
                <CodeBlock dashed>Starts by sorting the request, not by sending a message.</CodeBlock>
              )}
            </div>
            {f.adminNote && <AdminNote text={f.adminNote} />}
          </Panel>
        ))}
      </PreviewGroup>

      <PreviewGroup icon={Sparkles} title="Campaign ideas" count={campaignPrompts.length} kind="CAMPAIGN_PROMPT">
        {campaignPrompts.map((p) => (
          <Panel as="article" key={p.id} className="p-5">
            <h4 className="text-[1.0625rem] font-bold leading-snug tracking-tight text-v-ink">{p.title}</h4>
            <p className="mt-1.5 text-[0.9375rem] leading-relaxed text-v-muted">{p.outcome}</p>
            <CodeBlock className="mt-4">{p.prompt}</CodeBlock>
            {p.adminNote && <AdminNote text={p.adminNote} />}
          </Panel>
        ))}
      </PreviewGroup>

      <PreviewGroup icon={MessageSquare} title="Message templates" count={messageTemplates.length} kind="MESSAGE_TEMPLATE">
        {marketingCount > 0 && (
          <p className="flex items-start gap-2 text-[0.9375rem] text-cost">
            <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            {marketingCount} of these are offers, which cost more per message than order or booking updates.
          </p>
        )}
        {messageTemplates.map((t) => (
          <Panel as="article" key={t.id} className="p-5">
            <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
              <h4 className="text-[1.0625rem] font-bold leading-snug tracking-tight text-v-ink">{t.title}</h4>
              <Chip tone={t.metaCategory === "MARKETING" ? "cost" : "neutral"}>{t.metaCategory}</Chip>
            </div>
            <p className="mt-1.5 text-[0.9375rem] leading-relaxed text-v-muted">{t.outcome}</p>
            <div className="mt-4">
              <CustomerMessage text={t.body} />
            </div>
            {t.metaCategory === "MARKETING" && (
              <p className="mt-3 text-[0.875rem] text-cost">Offer — costs more per message</p>
            )}
            {t.adminNote && <AdminNote text={t.adminNote} />}
          </Panel>
        ))}
      </PreviewGroup>
    </div>
  );
}

function PreviewGroup({
  icon: Icon,
  title,
  count,
  kind,
  children,
}: {
  icon: typeof Workflow;
  title: string;
  count: number;
  kind: string;
  children: React.ReactNode;
}) {
  if (count === 0) return null;
  return (
    <section className="space-y-3">
      <div className="flex items-end justify-between gap-4 border-b border-v-line pb-2">
        <h3 className="flex items-center gap-2 text-[0.9375rem] font-bold tracking-tight text-v-ink">
          <Icon className="h-4 w-4 text-v-accent" aria-hidden="true" />
          {title}
          <span className="font-mono text-[0.6875rem] font-normal text-v-faint">({count})</span>
        </h3>
        <Annotation lines={[`kind = ${kind}`]} />
      </div>
      {children}
    </section>
  );
}

/** Admin-only guidance. Never rendered on a client-facing surface. */
function AdminNote({ text }: { text: string }) {
  return (
    <p className="mt-4 flex items-start gap-2 rounded-lg border border-dashed border-v-line px-3 py-2.5 text-[0.875rem] leading-relaxed text-v-muted">
      <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-v-faint" aria-hidden="true" />
      <span>
        <span className="font-mono text-[0.6875rem] uppercase tracking-[0.12em] text-v-faint">For you, not the client</span>
        <br />
        {text}
      </span>
    </p>
  );
}
