"use client";

/**
 * Tenant Admin — the support & ops console.
 *
 * Deliberately carries NO revenue data. This is the "who is stuck and what is
 * failing" view: traffic, failures, the ticket queue and platform health.
 * Money lives in the super-admin dashboard (/admin).
 *
 * Shares the scoped admin-console palette with /admin. Every figure comes from
 * /api/admin/ops; the ticket queue is live and its status control writes back
 * through /api/admin/tickets.
 */

import {
  admin as adminApi,
  type AdminOps, type SupportTicket, type TicketPriority, type TicketStatus,
} from "@/lib/api";
import { cn } from "@/lib/utils";
import {
  Activity, AlertTriangle, ArrowDownRight, ArrowUpRight, Building2, Headset,
  Layers, Loader2, Phone, Plus, Server, ShieldCheck, Sparkles, TriangleAlert, X,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { toast } from "sonner";

const RANGES: { hours: number; label: string }[] = [
  { hours: 24, label: "24h" },
  { hours: 72, label: "3d" },
  { hours: 168, label: "7d" },
];

function compactCount(n: number): string {
  if (n >= 1e7) return `${(n / 1e7).toFixed(2)} Cr`;
  if (n >= 1e5) return `${(n / 1e5).toFixed(2)} L`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return n.toLocaleString("en-IN");
}

function relTime(iso: string): string {
  const s = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

const PRIORITY_STYLE: Record<TicketPriority, string> = {
  urgent: "bg-adm-redSoft text-adm-red",
  high: "bg-adm-redSoft text-adm-red",
  medium: "bg-adm-amberSoft text-adm-amber",
  low: "bg-adm-blueSoft text-adm-blue",
};

const STATUS_STYLE: Record<TicketStatus, string> = {
  open: "bg-adm-redSoft text-adm-red",
  in_progress: "bg-adm-amberSoft text-adm-amber",
  waiting: "bg-adm-blueSoft text-adm-blue",
  resolved: "bg-adm-greenSoft text-adm-green",
  closed: "bg-adm-primarySoft text-adm-primary",
};

const STATUS_LABEL: Record<TicketStatus, string> = {
  open: "Open",
  in_progress: "In progress",
  waiting: "Waiting",
  resolved: "Resolved",
  closed: "Closed",
};

const HEALTH_STYLE = {
  ok: { dot: "bg-adm-green", text: "text-adm-green", label: "Healthy" },
  warn: { dot: "bg-adm-amber", text: "text-adm-amber", label: "Needs attention" },
  down: { dot: "bg-adm-red", text: "text-adm-red", label: "Down" },
  unknown: { dot: "bg-adm-faint", text: "text-adm-faint", label: "Unknown" },
} as const;

/** Quick actions point at real destinations only — no placeholder tiles. */
const QUICK_ACTIONS = [
  { icon: Building2, title: "Tenants", sub: "Find any tenant", href: "/admin/tenants" },
  // Ops assigns industries too — this is the same directory the super admin uses,
  // filtered to the tenants still missing one.
  { icon: Layers, title: "Assign industry", sub: "Tenants with none", href: "/admin/tenants?vertical=none" },
  { icon: Phone, title: "Connect number", sub: "Add a WhatsApp number", href: "/numbers/connect" },
  { icon: Server, title: "Platform revenue", sub: "Super-admin view", href: "/admin" },
  { icon: Sparkles, title: "AI config", sub: "Model routing", href: "/admin/rates" },
  { icon: Activity, title: "System health", sub: "Jump to checks", href: "#health" },
];

export default function OpsConsolePage() {
  const [authorized, setAuthorized] = useState<boolean | null>(null);
  const [hours, setHours] = useState(24);
  const [data, setData] = useState<AdminOps | null>(null);
  const [loading, setLoading] = useState(true);
  const [composing, setComposing] = useState(false);

  const load = useCallback((range: number) => {
    setLoading(true);
    adminApi
      .ops(range)
      .then(({ ops }) => { setData(ops); setAuthorized(true); })
      .catch((err: Error & { status?: number }) => {
        if (err.status === 403) { setAuthorized(false); return; }
        setAuthorized(true);
        toast.error(err.message || "Failed to load ops console");
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(hours); }, [hours, load]);

  const patchTicket = async (id: string, status: TicketStatus) => {
    try {
      await adminApi.ticketUpdate({ id, status });
      toast.success(`Ticket marked ${STATUS_LABEL[status].toLowerCase()}`);
      load(hours);
    } catch (err) {
      toast.error((err as Error).message || "Could not update ticket");
    }
  };

  if (authorized === false) {
    return (
      <Shell>
        <div className="rounded-xl border border-adm-line bg-adm-card p-8 text-center">
          <ShieldCheck className="mx-auto h-10 w-10 text-adm-faint" />
          <p className="mt-3 font-semibold text-adm-ink">Not authorized</p>
          <p className="text-sm text-adm-muted">
            This console is restricted to platform admins (ADMIN_EMAILS allowlist).
          </p>
        </div>
      </Shell>
    );
  }

  if (loading && !data) {
    return (
      <Shell>
        <div className="flex items-center justify-center py-24">
          <Loader2 className="h-6 w-6 animate-spin text-adm-faint" />
        </div>
      </Shell>
    );
  }
  if (!data) return null;

  const { kpis, deltas, series, tickets, events, health, warnings } = data;
  const failureRate = kpis.totalMessages
    ? (kpis.failedMessages / kpis.totalMessages) * 100
    : 0;

  return (
    <Shell>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-adm-ink">Tenant Admin Dashboard</h1>
          <p className="mt-1 text-sm text-adm-muted">
            Monitor and support SendAnjal tenants — setup, technical issues, and platform health
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-[10px] border border-adm-line bg-adm-card p-1">
            {RANGES.map((r) => (
              <button
                key={r.hours}
                onClick={() => setHours(r.hours)}
                className={cn(
                  "rounded-md px-3 py-1.5 text-xs font-semibold transition-colors",
                  hours === r.hours
                    ? "bg-adm-primarySoft text-adm-primary"
                    : "text-adm-muted hover:text-adm-ink",
                )}
              >
                {r.label}
              </button>
            ))}
          </div>
          <button
            onClick={() => setComposing(true)}
            className="inline-flex items-center gap-2 rounded-[10px] bg-adm-primary px-4 py-2 text-xs font-semibold text-adm-onAccent transition-opacity hover:opacity-90"
          >
            <Plus className="h-3.5 w-3.5" /> New ticket
          </button>
        </div>
      </div>

      {warnings.length > 0 && (
        <div className="mb-4 rounded-xl border border-adm-amber/30 bg-adm-amberSoft p-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-adm-amber">
            <AlertTriangle className="h-4 w-4" />
            {warnings.length} data source{warnings.length === 1 ? "" : "s"} unavailable — those tiles read zero
          </div>
          <ul className="mt-1.5 space-y-0.5 text-xs text-adm-muted">
            {warnings.map((w) => <li key={w}>· {w}</li>)}
          </ul>
        </div>
      )}

      {/* ── KPI row — operational only, no revenue ── */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-5">
        <Kpi icon={Building2} tint="primary" label="Active tenants"
             value={kpis.activeTenants.toLocaleString("en-IN")} delta={deltas.activeTenants} hours={hours} />
        <Kpi icon={Phone} tint="blue" label="Connected numbers"
             value={kpis.connectedNumbers.toLocaleString("en-IN")} delta={null} hours={hours}
             note={`${kpis.activeNumbers} active`} />
        <Kpi icon={Server} tint="green" label="API messages"
             value={compactCount(kpis.apiMessages)} delta={deltas.apiMessages} hours={hours}
             note={kpis.apiFailed > 0 ? `${kpis.apiFailed} failed` : undefined} />
        <Kpi icon={TriangleAlert} tint="red" label="Failed messages"
             value={compactCount(kpis.failedMessages)} delta={deltas.failedMessages} hours={hours}
             invertDelta note={`${failureRate.toFixed(1)}% of ${compactCount(kpis.totalMessages)}`} />
        <Kpi icon={Headset} tint="amber" label="Open tickets"
             value={kpis.openTickets.toLocaleString("en-IN")} delta={null} hours={hours}
             note={kpis.urgentOpen > 0 ? `${kpis.urgentOpen} high/urgent` : "none urgent"} />
      </div>

      {/* ── Traffic + webhook feed ── */}
      <div className="mt-4 grid items-start gap-4 xl:grid-cols-3">
        <Panel className="xl:col-span-2">
          <div className="mb-1 flex items-center justify-between">
            <h3 className="text-[15px] font-bold text-adm-ink">System overview</h3>
            <div className="flex gap-4 text-xs text-adm-muted">
              <span className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-adm-blue" />API messages
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-adm-green" />Messages sent
              </span>
            </div>
          </div>
          <p className="mb-3 text-xs text-adm-faint">
            API messages counts public API v1 sends — the only API traffic that is persisted,
            not every HTTP call.
          </p>
          <div className="h-[240px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={series} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
                <CartesianGrid stroke="hsl(var(--a-line))" vertical={false} />
                <XAxis dataKey="label" tickLine={false} axisLine={false} minTickGap={24}
                       tick={{ fontSize: 11, fill: "hsl(var(--a-ink-faint))" }} />
                <YAxis tickLine={false} axisLine={false} width={54}
                       tick={{ fontSize: 11, fill: "hsl(var(--a-ink-faint))" }}
                       tickFormatter={(v: number) => compactCount(v)} />
                <Tooltip content={<ChartTooltip />} />
                <Area type="monotone" dataKey="apiMessages" name="API messages"
                      stroke="hsl(var(--a-blue))" fill="hsl(var(--a-blue))" fillOpacity={0.12} strokeWidth={2} />
                <Area type="monotone" dataKey="messages" name="Messages sent"
                      stroke="hsl(var(--a-green))" fill="hsl(var(--a-green))" fillOpacity={0.12} strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Panel>

        <Panel>
          <h3 className="text-[15px] font-bold text-adm-ink">Recent webhook events</h3>
          <p className="mb-2 text-xs text-adm-faint">
            Raw inbox — tenant attribution needs the payload, so it isn&apos;t shown here.
          </p>
          {events.length === 0 ? (
            <p className="py-10 text-center text-sm text-adm-muted">No webhook events received yet.</p>
          ) : (
            <div>
              {events.map((e, i) => {
                const bad = e.status === "failed";
                return (
                  <div key={e.id} className={cn("flex items-start gap-2.5 py-2.5", i > 0 && "border-t border-adm-line")}>
                    <span className={cn("mt-1.5 h-2 w-2 flex-shrink-0 rounded-full", bad ? "bg-adm-red" : "bg-adm-green")} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-medium text-adm-ink">
                        {e.source} · {e.status}
                      </p>
                      <p className="truncate text-[11px] text-adm-muted">
                        {e.error || e.route || "—"}
                      </p>
                    </div>
                    <span className="flex-shrink-0 text-[11px] text-adm-faint">{relTime(e.receivedAt)}</span>
                  </div>
                );
              })}
            </div>
          )}
        </Panel>
      </div>

      {/* ── Quick actions ── */}
      <div className="mt-4 grid grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-6">
        {QUICK_ACTIONS.map((a) => (
          <Link
            key={a.title}
            href={a.href}
            className="rounded-xl border border-adm-line bg-adm-card p-4 text-center transition-colors hover:border-adm-primary"
          >
            <span className="mx-auto mb-2.5 flex h-9 w-9 items-center justify-center rounded-[10px] bg-adm-primarySoft text-adm-primary">
              <a.icon className="h-4 w-4" />
            </span>
            <p className="text-xs font-semibold text-adm-ink">{a.title}</p>
            <p className="text-[11px] text-adm-muted">{a.sub}</p>
          </Link>
        ))}
      </div>

      {/* ── Tickets + health ── */}
      <div className="mt-4 grid items-start gap-4 xl:grid-cols-3">
        <Panel className="xl:col-span-2">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-[15px] font-bold text-adm-ink">Support tickets — needs attention</h3>
            <span className="text-xs font-semibold text-adm-muted">{kpis.openTickets} open</span>
          </div>

          {tickets.length === 0 ? (
            <div className="py-10 text-center">
              <p className="text-sm text-adm-muted">No open tickets.</p>
              <button
                onClick={() => setComposing(true)}
                className="mt-2 text-xs font-semibold text-adm-primary hover:underline"
              >
                Log the first one
              </button>
            </div>
          ) : (
            <div className="-mx-2 overflow-x-auto">
              <table className="w-full min-w-[680px]">
                <thead>
                  <tr className="text-left text-[10.5px] uppercase tracking-wider text-adm-faint">
                    <th className="px-2 pb-2.5 font-semibold">Tenant</th>
                    <th className="px-2 pb-2.5 font-semibold">Subject</th>
                    <th className="px-2 pb-2.5 font-semibold">Priority</th>
                    <th className="px-2 pb-2.5 font-semibold">Status</th>
                    <th className="px-2 pb-2.5 text-right font-semibold">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {tickets.map((t) => (
                    <TicketRow key={t.id} ticket={t} onPatch={patchTicket} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>

        <Panel id="health">
          <h3 className="mb-1 flex items-center gap-2 text-[15px] font-bold text-adm-ink">
            <Activity className="h-4 w-4 text-adm-faint" /> System health
          </h3>
          <div>
            {health.map((h, i) => {
              const style = HEALTH_STYLE[h.status];
              return (
                <div key={h.key} className={cn("flex items-start justify-between gap-3 py-3", i > 0 && "border-t border-adm-line")}>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-adm-ink">{h.label}</p>
                    <p className="truncate text-[11px] text-adm-muted">{h.detail}</p>
                  </div>
                  <span className={cn("flex flex-shrink-0 items-center gap-1.5 text-xs font-semibold", style.text)}>
                    <span className={cn("h-2 w-2 rounded-full", style.dot)} />
                    {style.label}
                  </span>
                </div>
              );
            })}
          </div>
        </Panel>
      </div>

      {composing && (
        <NewTicketDialog
          onClose={() => setComposing(false)}
          onCreated={() => { setComposing(false); load(hours); }}
        />
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

function Panel({ children, className, id }: { children: React.ReactNode; className?: string; id?: string }) {
  return (
    <div id={id} className={cn("rounded-xl border border-adm-line bg-adm-card p-5", className)}>
      {children}
    </div>
  );
}

const TINTS = {
  primary: "bg-adm-primarySoft text-adm-primary",
  green: "bg-adm-greenSoft text-adm-green",
  amber: "bg-adm-amberSoft text-adm-amber",
  blue: "bg-adm-blueSoft text-adm-blue",
  red: "bg-adm-redSoft text-adm-red",
} as const;

function Kpi({
  icon: Icon, tint, label, value, delta, hours, note, invertDelta,
}: {
  icon: React.ElementType;
  tint: keyof typeof TINTS;
  label: string;
  value: string;
  delta: number | null;
  hours: number;
  note?: string;
  /** For failure counts, a rise is BAD — colour must not read "up = good". */
  invertDelta?: boolean;
}) {
  const up = delta !== null && delta >= 0;
  const good = invertDelta ? !up : up;
  const DeltaIcon = up ? ArrowUpRight : ArrowDownRight;
  const rangeLabel = RANGES.find((r) => r.hours === hours)?.label ?? `${hours}h`;

  return (
    <div className="flex h-full flex-col rounded-xl border border-adm-line bg-adm-card p-4">
      <div className="flex min-h-[2.6em] items-start gap-2">
        <span className={cn("flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-[7px]", TINTS[tint])}>
          <Icon className="h-3.5 w-3.5" />
        </span>
        <span className="text-[11.5px] font-medium leading-tight text-adm-muted">{label}</span>
      </div>
      <p className="mt-1 text-xl font-bold tracking-tight text-adm-ink">{value}</p>
      <div className="mt-1.5">
        {delta === null ? (
          <span className="text-[11px] text-adm-faint">no prior-period baseline</span>
        ) : (
          <span className="flex items-center gap-1 whitespace-nowrap text-[11px] font-semibold">
            <DeltaIcon className={cn("h-3 w-3 flex-shrink-0", good ? "text-adm-green" : "text-adm-red")} />
            <span className={good ? "text-adm-green" : "text-adm-red"}>{up ? "+" : ""}{delta}%</span>
            <span className="font-normal text-adm-faint">vs prev {rangeLabel}</span>
          </span>
        )}
      </div>
      {note && <p className="mt-auto pt-1 text-[11px] text-adm-faint">{note}</p>}
    </div>
  );
}

function TicketRow({
  ticket, onPatch,
}: {
  ticket: SupportTicket;
  onPatch: (id: string, status: TicketStatus) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const next: TicketStatus = ticket.status === "open" ? "in_progress" : "resolved";
  const nextLabel = ticket.status === "open" ? "Start" : "Resolve";

  const act = async () => {
    setBusy(true);
    await onPatch(ticket.id, next);
    setBusy(false);
  };

  return (
    <tr className="border-t border-adm-line text-sm">
      <td className="px-2 py-3">
        <div className="flex items-center gap-2.5">
          <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg bg-adm-primary text-[10px] font-bold text-adm-onAccent">
            {ticket.tenant.split(/\s+/).map((w) => w[0]).filter(Boolean).slice(0, 2).join("").toUpperCase()}
          </div>
          <div className="min-w-0">
            <p className="truncate font-semibold text-adm-ink">{ticket.tenant}</p>
            <p className="truncate text-[11px] text-adm-muted">{relTime(ticket.createdAt)}</p>
          </div>
        </div>
      </td>
      <td className="px-2 py-3">
        <p className="text-adm-ink">{ticket.subject}</p>
        <p className="text-[11px] capitalize text-adm-muted">{ticket.category}</p>
      </td>
      <td className="px-2 py-3">
        <span className={cn("inline-block rounded-full px-2.5 py-0.5 text-[11px] font-semibold capitalize", PRIORITY_STYLE[ticket.priority])}>
          {ticket.priority}
        </span>
      </td>
      <td className="px-2 py-3">
        <span className={cn("inline-block whitespace-nowrap rounded-full px-2.5 py-0.5 text-[11px] font-semibold", STATUS_STYLE[ticket.status])}>
          {STATUS_LABEL[ticket.status]}
        </span>
      </td>
      <td className="px-2 py-3 text-right">
        <button
          onClick={act}
          disabled={busy}
          className="rounded-[7px] bg-adm-primarySoft px-2.5 py-1 text-[11.5px] font-semibold text-adm-primary disabled:opacity-50"
        >
          {busy ? "…" : nextLabel}
        </button>
      </td>
    </tr>
  );
}

const CATEGORIES: { value: SupportTicket["category"]; label: string }[] = [
  { value: "onboarding", label: "Onboarding / ESU" },
  { value: "number", label: "Number connection" },
  { value: "template", label: "Template approval" },
  { value: "billing", label: "Billing / wallet" },
  { value: "webhook", label: "Webhooks" },
  { value: "api", label: "Public API" },
  { value: "other", label: "Other" },
];

function NewTicketDialog({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [email, setEmail] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [category, setCategory] = useState<SupportTicket["category"]>("other");
  const [priority, setPriority] = useState<TicketPriority>("medium");
  const [saving, setSaving] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await adminApi.ticketCreate({ email: email.trim(), subject: subject.trim(), body, category, priority });
      toast.success("Ticket logged");
      onCreated();
    } catch (err) {
      toast.error((err as Error).message || "Could not create ticket");
    } finally {
      setSaving(false);
    }
  };

  const field = "w-full rounded-lg border border-adm-line bg-adm-card px-3 py-2 text-sm text-adm-ink outline-none focus:border-adm-primary";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={submit}
        className="w-full max-w-lg rounded-xl border border-adm-line bg-adm-card p-5"
      >
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-[15px] font-bold text-adm-ink">Log a support ticket</h3>
          <button type="button" onClick={onClose} className="text-adm-faint hover:text-adm-ink">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-adm-muted">
              Tenant email
            </label>
            <input required type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                   placeholder="client@example.com" className={field} />
          </div>
          <div>
            <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-adm-muted">
              Subject
            </label>
            <input required value={subject} onChange={(e) => setSubject(e.target.value)}
                   placeholder="Webhook not receiving replies" className={field} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-adm-muted">
                Category
              </label>
              <select value={category} onChange={(e) => setCategory(e.target.value as SupportTicket["category"])} className={field}>
                {CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-adm-muted">
                Priority
              </label>
              <select value={priority} onChange={(e) => setPriority(e.target.value as TicketPriority)} className={field}>
                {(["low", "medium", "high", "urgent"] as TicketPriority[]).map((p) => (
                  <option key={p} value={p}>{p[0].toUpperCase() + p.slice(1)}</option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-adm-muted">
              Details
            </label>
            <textarea rows={3} value={body} onChange={(e) => setBody(e.target.value)}
                      placeholder="What the tenant reported, and anything already tried." className={field} />
          </div>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onClose}
                  className="rounded-[10px] border border-adm-line px-4 py-2 text-xs font-semibold text-adm-muted">
            Cancel
          </button>
          <button type="submit" disabled={saving}
                  className="inline-flex items-center gap-2 rounded-[10px] bg-adm-primary px-4 py-2 text-xs font-semibold text-adm-onAccent disabled:opacity-60">
            {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Create ticket
          </button>
        </div>
      </form>
    </div>
  );
}

function ChartTooltip({
  active, payload, label,
}: {
  active?: boolean;
  payload?: { value: number; name: string; color?: string }[];
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-xl border border-adm-line bg-adm-card p-3 text-xs shadow-xl">
      {label && <p className="mb-1.5 font-medium text-adm-muted">{label}</p>}
      {payload.map((p, i) => (
        <div key={i} className="mt-1 flex items-center gap-2">
          <span className="h-2 w-2 rounded-full" style={{ background: p.color }} />
          <span className="text-adm-muted">{p.name}:</span>
          <span className="font-semibold text-adm-ink">{p.value.toLocaleString("en-IN")}</span>
        </div>
      ))}
    </div>
  );
}
