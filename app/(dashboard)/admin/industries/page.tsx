"use client";

/**
 * Industries — the vertical catalogue behind the client industry picker.
 *
 * An industry is a *content pack*: booking/status automations, a campaign
 * prompt and message templates that a tenant receives on provisioning. This
 * screen is where the platform owner sees what each pack actually contains,
 * adds new ones through the guided form, and takes one out of circulation.
 *
 * Deactivate is the only "remove" verb, and it is not a delete: tenants
 * already on an industry keep everything they were given; it simply stops
 * being offered. Deleting a pack that live tenants depend on is not an
 * admin-screen-sized decision, so it isn't offered here.
 */

import { NewVerticalForm } from "@/components/verticals/NewVerticalForm";
import { VerticalIcon } from "@/components/verticals/VerticalIcon";
import {
  admin as adminApi,
  type AdminVertical, type VerticalPreview,
} from "@/lib/api";
import { cn } from "@/lib/utils";
import {
  AlertTriangle, ArrowRight, Check, Eye, Loader2, MessageSquare, Plus, RefreshCw,
  ShieldCheck, Sparkles, X, Zap,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

export default function IndustriesPage() {
  const [authorized, setAuthorized] = useState<boolean | null>(null);
  const [verticals, setVerticals] = useState<AdminVertical[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [seeding, setSeeding] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [preview, setPreview] = useState<VerticalPreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    adminApi
      .verticals()
      .then(({ verticals }) => { setVerticals(verticals); setAuthorized(true); })
      .catch((err: Error & { status?: number }) => {
        if (err.status === 403) { setAuthorized(false); return; }
        setAuthorized(true);
        toast.error(err.message || "Failed to load industries");
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!previewId) { setPreview(null); return; }
    setPreviewLoading(true);
    adminApi
      .verticalPreview(previewId)
      .then(setPreview)
      .catch((err) => toast.error((err as Error).message || "Could not load preview"))
      .finally(() => setPreviewLoading(false));
  }, [previewId]);

  const toggleActive = async (v: AdminVertical) => {
    setBusyId(v.id);
    try {
      await adminApi.verticalUpdate(v.id, { isActive: !v.isActive });
      toast.success(v.isActive ? `${v.displayName} hidden from the picker` : `${v.displayName} is live`);
      load();
    } catch (err) {
      toast.error((err as Error).message || "Could not update");
    } finally {
      setBusyId(null);
    }
  };

  const reseed = async () => {
    setSeeding(true);
    try {
      const res = await adminApi.verticalsSeed();
      toast.success(`${res.verticalsUpserted} industries, ${res.itemsUpserted} items re-seeded`);
      if (res.errors?.length) toast.error(`${res.errors.length} item(s) failed validation`);
      load();
    } catch (err) {
      toast.error((err as Error).message || "Re-seed failed");
    } finally {
      setSeeding(false);
    }
  };

  if (authorized === false) {
    return (
      <Shell>
        <div className="rounded-xl border border-adm-line bg-adm-card p-8 text-center">
          <ShieldCheck className="mx-auto h-10 w-10 text-adm-faint" />
          <p className="mt-3 font-semibold text-adm-ink">Not authorized</p>
          <p className="text-sm text-adm-muted">Restricted to platform admins (ADMIN_EMAILS allowlist).</p>
        </div>
      </Shell>
    );
  }

  if (loading && verticals.length === 0) {
    return (
      <Shell>
        <div className="flex items-center justify-center py-24">
          <Loader2 className="h-6 w-6 animate-spin text-adm-faint" />
        </div>
      </Shell>
    );
  }

  const live = verticals.filter((v) => v.isActive).length;
  const totalItems = verticals.reduce(
    (t, v) => t + (v.counts ? v.counts.flows + v.counts.campaignPrompts + v.counts.messageTemplates : 0),
    0,
  );

  return (
    <Shell>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-adm-ink">Industries</h1>
          <p className="mt-1 text-sm text-adm-muted">
            Content packs offered on the client industry picker — {live} live of {verticals.length},{" "}
            {totalItems} items total
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={reseed}
            disabled={seeding}
            className="inline-flex items-center gap-2 rounded-[10px] border border-adm-line bg-adm-card px-3 py-2 text-xs font-semibold text-adm-muted hover:text-adm-ink disabled:opacity-60"
            title="Re-apply the shipped industry packs. Idempotent — updates in place, never duplicates."
          >
            {seeding ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            Re-seed shipped
          </button>
          <button
            onClick={() => setCreating(true)}
            className="inline-flex items-center gap-2 rounded-[10px] bg-adm-primary px-4 py-2 text-xs font-semibold text-adm-onAccent hover:opacity-90"
          >
            <Plus className="h-3.5 w-3.5" /> New industry
          </button>
        </div>
      </div>

      {verticals.length === 0 ? (
        <div className="rounded-xl border border-adm-line bg-adm-card p-10 text-center">
          <Sparkles className="mx-auto h-9 w-9 text-adm-faint" />
          <p className="mt-3 font-semibold text-adm-ink">No industries yet</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-adm-muted">
            Re-seed the shipped packs to get the built-in industries, or add your own with the
            guided form — you answer plain-language questions and the server assembles the automations.
          </p>
          <button
            onClick={reseed}
            disabled={seeding}
            className="mt-4 inline-flex items-center gap-2 rounded-[10px] bg-adm-primary px-4 py-2 text-xs font-semibold text-adm-onAccent disabled:opacity-60"
          >
            {seeding && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Re-seed shipped industries
          </button>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {verticals.map((v) => (
            <div
              key={v.id}
              className={cn(
                "flex flex-col rounded-xl border bg-adm-card p-5 transition-colors",
                v.isActive ? "border-adm-line" : "border-dashed border-adm-line opacity-70",
              )}
            >
              <div className="flex items-start gap-3">
                <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-[10px] bg-adm-primarySoft text-adm-primary">
                  <VerticalIcon name={v.icon} className="h-5 w-5" />
                </span>
                <div className="min-w-0 flex-1">
                  {/* Industry names are admin-authored and can be long
                      ("Salon & Spa", "School & Coaching") — let them wrap
                      rather than truncating the one thing that identifies
                      the card. */}
                  <h3 className="font-bold leading-tight text-adm-ink">{v.displayName}</h3>
                  <p className="mt-0.5 truncate text-[11px] text-adm-faint">
                    {v.slug}
                    {v.isBuiltin && <span className="text-adm-blue"> · Built-in</span>}
                  </p>
                </div>
                <span
                  className={cn(
                    "flex-shrink-0 rounded-full px-2.5 py-0.5 text-[11px] font-semibold",
                    v.isActive ? "bg-adm-greenSoft text-adm-green" : "bg-adm-amberSoft text-adm-amber",
                  )}
                >
                  {v.isActive ? "Live" : "Hidden"}
                </span>
              </div>

              <p className="mt-3 line-clamp-2 text-sm text-adm-muted">{v.description || "No description."}</p>

              <div className="mt-4 flex gap-4 text-[11px] text-adm-muted">
                <Count icon={Zap} n={v.counts?.flows ?? 0} label="flows" />
                <Count icon={Sparkles} n={v.counts?.campaignPrompts ?? 0} label="prompts" />
                <Count icon={MessageSquare} n={v.counts?.messageTemplates ?? 0} label="templates" />
              </div>

              <div className="mt-4 flex items-center gap-2 border-t border-adm-line pt-3">
                <Link
                  href={`/admin/industries/${v.id}`}
                  className="inline-flex items-center gap-1.5 rounded-[7px] bg-adm-primary px-2.5 py-1.5 text-[11.5px] font-semibold text-adm-onAccent hover:opacity-90"
                >
                  <ArrowRight className="h-3.5 w-3.5" /> Open
                </Link>
                <button
                  onClick={() => setPreviewId(v.id)}
                  className="inline-flex items-center gap-1.5 rounded-[7px] bg-adm-primarySoft px-2.5 py-1.5 text-[11.5px] font-semibold text-adm-primary"
                  title="Quick look without leaving this page"
                >
                  <Eye className="h-3.5 w-3.5" /> Peek
                </button>
                <button
                  onClick={() => toggleActive(v)}
                  disabled={busyId === v.id}
                  className="ml-auto inline-flex items-center gap-1.5 rounded-[7px] border border-adm-line px-2.5 py-1.5 text-[11.5px] font-semibold text-adm-muted hover:text-adm-ink disabled:opacity-50"
                >
                  {busyId === v.id
                    ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    : v.isActive ? <X className="h-3.5 w-3.5" /> : <Check className="h-3.5 w-3.5" />}
                  {v.isActive ? "Hide" : "Make live"}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <p className="mt-4 flex items-start gap-2 text-[11px] leading-relaxed text-adm-faint">
        <AlertTriangle className="mt-0.5 h-3 w-3 flex-shrink-0" />
        Hiding an industry removes it from the picker only. Tenants already provisioned on it keep
        every flow, prompt and template they were given.
      </p>

      {creating && (
        <Modal onClose={() => setCreating(false)} title="Add an industry" wide>
          <NewVerticalForm
            onCancel={() => setCreating(false)}
            onCreated={(id) => { setCreating(false); load(); setPreviewId(id); }}
          />
        </Modal>
      )}

      {previewId && (
        <Modal onClose={() => setPreviewId(null)} title={preview?.vertical.displayName ?? "Preview"} wide>
          {previewLoading || !preview ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="h-5 w-5 animate-spin text-adm-faint" />
            </div>
          ) : (
            <PreviewBody preview={preview} />
          )}
        </Modal>
      )}
    </Shell>
  );
}

/* ── pieces ─────────────────────────────────────────────────────────────── */

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="admin-console -m-4 min-h-[calc(100vh-4rem)] bg-adm-bg p-4 sm:-m-6 sm:p-6">
      {children}
    </div>
  );
}

function Count({ icon: Icon, n, label }: { icon: React.ElementType; n: number; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <Icon className="h-3.5 w-3.5 text-adm-faint" />
      <span className="font-semibold text-adm-ink">{n}</span> {label}
    </span>
  );
}

function Modal({
  children, onClose, title, wide,
}: {
  children: React.ReactNode; onClose: () => void; title: string; wide?: boolean;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className={cn(
          "my-8 w-full rounded-xl border border-adm-line bg-adm-card p-5",
          wide ? "max-w-3xl" : "max-w-lg",
        )}
      >
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-[15px] font-bold text-adm-ink">{title}</h3>
          <button onClick={onClose} className="text-adm-faint hover:text-adm-ink">
            <X className="h-4 w-4" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

/** What a tenant actually receives on provisioning — never flow JSON. */
function PreviewBody({ preview }: { preview: VerticalPreview }) {
  return (
    <div className="space-y-5">
      <p className="text-sm text-adm-muted">{preview.vertical.description}</p>

      <Section title="Automations" count={preview.flows.length}>
        {preview.flows.map((f) => (
          <div key={f.id} className="rounded-lg border border-adm-line p-3">
            <div className="flex items-center justify-between gap-2">
              <p className="font-semibold text-adm-ink">{f.title}</p>
              <span className="flex-shrink-0 text-[11px] text-adm-faint">
                {f.steps} message{f.steps === 1 ? "" : "s"}{f.collectsBooking ? " · books" : ""}
              </span>
            </div>
            <p className="mt-0.5 text-xs text-adm-muted">{f.outcome}</p>
            {f.firstMessage && (
              <p className="mt-2 rounded-lg rounded-bl-sm bg-adm-primarySoft px-3 py-2 text-xs text-adm-ink">
                {f.firstMessage}
              </p>
            )}
          </div>
        ))}
      </Section>

      <Section title="Campaign prompts" count={preview.campaignPrompts.length}>
        {preview.campaignPrompts.map((p) => (
          <div key={p.id} className="rounded-lg border border-adm-line p-3">
            <p className="font-semibold text-adm-ink">{p.title}</p>
            <p className="mt-0.5 text-xs text-adm-muted">{p.outcome}</p>
            <p className="mt-2 rounded-lg bg-adm-bg px-3 py-2 font-mono text-[11px] text-adm-muted">{p.prompt}</p>
          </div>
        ))}
      </Section>

      <Section title="Message templates" count={preview.messageTemplates.length}>
        {preview.messageTemplates.map((t) => (
          <div key={t.id} className="rounded-lg border border-adm-line p-3">
            <div className="flex items-center justify-between gap-2">
              <p className="font-semibold text-adm-ink">{t.title}</p>
              <span className="flex-shrink-0 rounded-full bg-adm-blueSoft px-2 py-0.5 text-[10px] font-semibold text-adm-blue">
                {t.metaCategory}
              </span>
            </div>
            <p className="mt-2 whitespace-pre-wrap rounded-lg rounded-bl-sm bg-adm-primarySoft px-3 py-2 text-xs text-adm-ink">
              {t.body}
            </p>
            {t.footer && <p className="mt-1 text-[11px] text-adm-faint">{t.footer}</p>}
          </div>
        ))}
      </Section>
    </div>
  );
}

function Section({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  if (count === 0) {
    return (
      <div>
        <h4 className="mb-2 text-[11px] font-bold uppercase tracking-wider text-adm-faint">{title}</h4>
        <p className="text-xs text-adm-muted">None in this pack.</p>
      </div>
    );
  }
  return (
    <div>
      <h4 className="mb-2 text-[11px] font-bold uppercase tracking-wider text-adm-faint">
        {title} · {count}
      </h4>
      <div className="space-y-2">{children}</div>
    </div>
  );
}
