"use client";

/**
 * One industry, as the TENANT experiences it.
 *
 * The catalogue page answers "what industries exist?". This page answers the
 * question a super admin actually has before putting a client on one: "what
 * does a business on this industry actually get?"
 *
 * So it is laid out the way the tenant meets the content — their automations,
 * their campaign ideas, their message templates — showing the real customer-
 * facing wording, not flow JSON or table rows. Plus who is currently on it,
 * because changing an industry's content affects real accounts.
 */

import { VerticalIcon } from "@/components/verticals/VerticalIcon";
import {
  admin as adminApi,
  type AdminClient, type VerticalPreview,
} from "@/lib/api";
import { cn } from "@/lib/utils";
import {
  ArrowLeft, Building2, Check, Eye, Loader2, MessageSquare,
  ShieldAlert, ShieldCheck, Sparkles, Users, Zap,
} from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

type Tab = "automations" | "campaigns" | "templates" | "tenants";

const TABS: { key: Tab; label: string; icon: React.ElementType }[] = [
  { key: "automations", label: "Automations", icon: Zap },
  { key: "campaigns", label: "Campaign ideas", icon: Sparkles },
  { key: "templates", label: "Message templates", icon: MessageSquare },
  { key: "tenants", label: "Who's on it", icon: Building2 },
];

export default function IndustryDetailPage() {
  const params = useParams<{ id: string }>();
  const verticalId = params.id;

  const [preview, setPreview] = useState<VerticalPreview | null>(null);
  const [tenants, setTenants] = useState<AdminClient[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<Tab>("automations");

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([
      adminApi.verticalPreview(verticalId),
      // Who is on this industry — a live query, so it is never stale.
      adminApi.clients({ vertical: verticalId, limit: 100 }).catch(() => ({ clients: [] as AdminClient[] })),
    ])
      .then(([p, c]) => { setPreview(p); setTenants(c.clients); })
      .catch((err) => toast.error((err as Error).message || "Could not load this industry"))
      .finally(() => setLoading(false));
  }, [verticalId]);

  useEffect(() => { load(); }, [load]);

  const toggleLive = async () => {
    if (!preview) return;
    setBusy(true);
    try {
      await adminApi.verticalUpdate(verticalId, { isActive: !preview.vertical.isActive });
      toast.success(preview.vertical.isActive ? "Hidden from the picker" : "Now offered to new clients");
      load();
    } catch (err) {
      toast.error((err as Error).message || "Could not update");
    } finally {
      setBusy(false);
    }
  };

  if (loading && !preview) {
    return (
      <Shell>
        <div className="flex items-center justify-center py-24">
          <Loader2 className="h-6 w-6 animate-spin text-adm-faint" />
        </div>
      </Shell>
    );
  }
  if (!preview) return null;

  const v = preview.vertical;
  const counts = {
    automations: preview.flows.length,
    campaigns: preview.campaignPrompts.length,
    templates: preview.messageTemplates.length,
    tenants: tenants.length,
  };

  return (
    <Shell>
      <Link
        href="/admin/industries"
        className="mb-4 inline-flex items-center gap-1.5 text-xs font-semibold text-adm-muted hover:text-adm-ink"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> All industries
      </Link>

      {/* ── Header ── */}
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-xl bg-adm-primarySoft text-adm-primary">
            <VerticalIcon name={v.icon} className="h-6 w-6" />
          </span>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-bold tracking-tight text-adm-ink">{v.displayName}</h1>
              <span className={cn(
                "rounded-full px-2.5 py-0.5 text-[11px] font-semibold",
                v.isActive ? "bg-adm-greenSoft text-adm-green" : "bg-adm-amberSoft text-adm-amber",
              )}>
                {v.isActive ? "Offered to new clients" : "Hidden"}
              </span>
              {v.isBuiltin && (
                <span className="rounded-full bg-adm-blueSoft px-2.5 py-0.5 text-[11px] font-semibold text-adm-blue">
                  Built-in
                </span>
              )}
            </div>
            <p className="mt-1 max-w-2xl text-sm text-adm-muted">{v.description}</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Link
            href={`/admin/tenants?vertical=${verticalId}`}
            className="inline-flex items-center gap-2 rounded-[10px] border border-adm-line bg-adm-card px-3 py-2 text-xs font-semibold text-adm-muted hover:text-adm-ink"
          >
            <Users className="h-3.5 w-3.5" /> Assign a client
          </Link>
          <button
            onClick={toggleLive}
            disabled={busy}
            className="inline-flex items-center gap-2 rounded-[10px] bg-adm-primary px-4 py-2 text-xs font-semibold text-adm-onAccent hover:opacity-90 disabled:opacity-60"
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : v.isActive ? <Eye className="h-3.5 w-3.5" /> : <Check className="h-3.5 w-3.5" />}
            {v.isActive ? "Hide from picker" : "Make it live"}
          </button>
        </div>
      </div>

      {/* Consent is a property of the industry, and it changes what a tenant on
          it is allowed to do. Surface it here rather than burying it. */}
      {v.requiresExplicitConsent && (
        <div className="mb-4 flex items-start gap-3 rounded-xl border border-adm-amber/30 bg-adm-amberSoft p-4">
          <ShieldAlert className="mt-0.5 h-4 w-4 flex-shrink-0 text-adm-amber" />
          <p className="text-sm text-adm-muted">
            <span className="font-semibold text-adm-ink">Consent required.</span>{" "}
            Businesses on this industry can only message people who have explicitly agreed.
            Campaigns skip anyone without consent, and automations stop before sending to them.
          </p>
        </div>
      )}

      {/* ── Tabs ── */}
      <div className="mb-4 flex flex-wrap gap-1 rounded-xl bg-adm-card p-1">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={cn(
              "inline-flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold transition-colors",
              tab === t.key ? "bg-adm-primarySoft text-adm-primary" : "text-adm-muted hover:text-adm-ink",
            )}
          >
            <t.icon className="h-3.5 w-3.5" />
            {t.label}
            <span className="rounded-full bg-adm-bg px-1.5 text-[10px]">{counts[t.key]}</span>
          </button>
        ))}
      </div>

      {/* ── Panels ── */}
      {tab === "automations" && (
        <Grid empty={counts.automations === 0} emptyText="No automations in this pack yet.">
          {preview.flows.map((f) => (
            <Card key={f.id} title={f.title} outcome={f.outcome}
                  meta={`${f.steps} message${f.steps === 1 ? "" : "s"}${f.collectsBooking ? " · takes bookings" : ""}`}>
              {f.firstMessage && <Bubble>{f.firstMessage}</Bubble>}
              {f.adminNote && <AdminNote>{f.adminNote}</AdminNote>}
            </Card>
          ))}
        </Grid>
      )}

      {tab === "campaigns" && (
        <Grid empty={counts.campaigns === 0} emptyText="No campaign ideas in this pack yet.">
          {preview.campaignPrompts.map((p) => (
            <Card key={p.id} title={p.title} outcome={p.outcome}>
              <p className="mt-2 rounded-lg bg-adm-bg px-3 py-2 font-mono text-[11px] leading-relaxed text-adm-muted">
                {p.prompt}
              </p>
              {p.adminNote && <AdminNote>{p.adminNote}</AdminNote>}
            </Card>
          ))}
        </Grid>
      )}

      {tab === "templates" && (
        <Grid empty={counts.templates === 0} emptyText="No message templates in this pack yet.">
          {preview.messageTemplates.map((t) => (
            <Card key={t.id} title={t.title} outcome={t.outcome} badge={t.metaCategory}>
              <Bubble>{t.body}</Bubble>
              {t.footer && <p className="mt-1 text-[11px] text-adm-faint">{t.footer}</p>}
              {t.adminNote && <AdminNote>{t.adminNote}</AdminNote>}
            </Card>
          ))}
        </Grid>
      )}

      {tab === "tenants" && (
        <div className="rounded-xl border border-adm-line bg-adm-card">
          {tenants.length === 0 ? (
            <div className="px-5 py-14 text-center">
              <Building2 className="mx-auto h-8 w-8 text-adm-faint" />
              <p className="mt-3 font-semibold text-adm-ink">No clients on this industry yet</p>
              <p className="mx-auto mt-1 max-w-sm text-sm text-adm-muted">
                Changing this pack is safe right now — nobody is using it.
              </p>
              <Link
                href={`/admin/tenants?vertical=${verticalId}`}
                className="mt-4 inline-flex items-center gap-2 rounded-[10px] bg-adm-primary px-4 py-2 text-xs font-semibold text-adm-onAccent"
              >
                Assign a client
              </Link>
            </div>
          ) : (
            <>
              <p className="border-b border-adm-line px-4 py-3 text-xs text-adm-muted">
                Editing this pack changes what these {tenants.length} account
                {tenants.length === 1 ? "" : "s"} are offered. It never touches content they
                already have.
              </p>
              {tenants.map((t, i) => (
                <div key={t.id} className={cn("flex items-center justify-between gap-3 px-4 py-3", i > 0 && "border-t border-adm-line")}>
                  <div className="min-w-0">
                    <p className="truncate font-semibold text-adm-ink">{t.name}</p>
                    <p className="truncate text-[11px] text-adm-muted">{t.email}</p>
                  </div>
                  <Link
                    href={`/admin/clients/${t.id}/setup`}
                    className="flex-shrink-0 rounded-[7px] bg-adm-primarySoft px-2.5 py-1.5 text-[11.5px] font-semibold text-adm-primary"
                  >
                    Set up
                  </Link>
                </div>
              ))}
            </>
          )}
        </div>
      )}

      <p className="mt-4 flex items-start gap-2 text-[11px] leading-relaxed text-adm-faint">
        <ShieldCheck className="mt-0.5 h-3 w-3 flex-shrink-0" />
        This is what a business on this industry is offered. When they add an item it is
        copied into their own account, so they can edit it freely without affecting this pack
        or any other client.
      </p>
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

function Grid({ children, empty, emptyText }: { children: React.ReactNode; empty: boolean; emptyText: string }) {
  if (empty) {
    return (
      <div className="rounded-xl border border-adm-line bg-adm-card px-5 py-14 text-center">
        <p className="text-sm text-adm-muted">{emptyText}</p>
      </div>
    );
  }
  return <div className="grid gap-4 md:grid-cols-2">{children}</div>;
}

function Card({
  title, outcome, meta, badge, children,
}: {
  title: string; outcome: string; meta?: string; badge?: string | null; children?: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-adm-line bg-adm-card p-4">
      <div className="flex items-start justify-between gap-2">
        <p className="font-bold text-adm-ink">{title}</p>
        {badge && (
          <span className="flex-shrink-0 rounded-full bg-adm-blueSoft px-2 py-0.5 text-[10px] font-semibold text-adm-blue">
            {badge}
          </span>
        )}
        {meta && <span className="flex-shrink-0 text-[11px] text-adm-faint">{meta}</span>}
      </div>
      <p className="mt-1 text-xs text-adm-muted">{outcome}</p>
      {children}
    </div>
  );
}

/** The customer's-eye view — what actually lands on someone's phone. */
function Bubble({ children }: { children: React.ReactNode }) {
  return (
    <p className="mt-2 whitespace-pre-wrap rounded-lg rounded-bl-sm bg-adm-primarySoft px-3 py-2 text-xs leading-relaxed text-adm-ink">
      {children}
    </p>
  );
}

/** Admin-only guidance; never shown to the client. */
function AdminNote({ children }: { children: React.ReactNode }) {
  return (
    <p className="mt-2 border-l-2 border-adm-amber/50 pl-2 text-[11px] text-adm-faint">
      Note for us: {children}
    </p>
  );
}
