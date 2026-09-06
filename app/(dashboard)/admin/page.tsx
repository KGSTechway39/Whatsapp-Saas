"use client";

/**
 * Platform Super Admin — the owner's view of the whole business.
 *
 * Styled in the scoped admin-console palette (indigo on cool paper, tokens in
 * globals.css under .admin-console) rather than the teal client chrome — the
 * same approach the industry-vertical screens take. Nothing here leaks into
 * client-facing pages.
 *
 * Every number comes from /api/admin/overview (admin-gated, aggregate-only).
 * Nothing is illustrative: a section with no data reads zero and says so, and
 * a trend chip only renders when a real prior-window comparison exists.
 */

import { admin as adminApi, type AdminOverview } from "@/lib/api";
import { cn } from "@/lib/utils";
import {
  Activity, AlertTriangle, ArrowDownRight, ArrowUpRight, Bolt, Building2,
  CircleDollarSign, Loader2, Megaphone, Phone, PiggyBank, Send, ShieldCheck,
  SlidersHorizontal, Sparkles, TrendingUp, Users, Wallet,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  CartesianGrid, Cell, Line, LineChart, Pie, PieChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { toast } from "sonner";

/* ── formatting — Indian numbering throughout (lakh/crore, not million) ──── */

function compactCount(n: number): string {
  if (n >= 1e7) return `${(n / 1e7).toFixed(2)} Cr`;
  if (n >= 1e5) return `${(n / 1e5).toFixed(2)} L`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return n.toLocaleString("en-IN");
}

/** Paise → a short rupee string. Money is integer paise everywhere upstream. */
function inr(paise: number): string {
  const rupees = paise / 100;
  if (Math.abs(rupees) >= 1e7) return `₹${(rupees / 1e7).toFixed(2)} Cr`;
  if (Math.abs(rupees) >= 1e5) return `₹${(rupees / 1e5).toFixed(2)} L`;
  return `₹${rupees.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
}

function inrExact(paise: number): string {
  return `₹${(paise / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const dayLabel = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short" });

const RANGES = [7, 30, 90] as const;

const SERIES = [
  { key: "marketing", label: "Marketing", color: "hsl(var(--a-amber))" },
  { key: "utility", label: "Utility", color: "hsl(var(--a-blue))" },
  { key: "authentication", label: "Authentication", color: "hsl(var(--a-primary))" },
] as const;

type Tab = "all" | "marketing" | "utility" | "authentication";
const TABS: { key: Tab; label: string }[] = [
  { key: "all", label: "All" },
  { key: "marketing", label: "Marketing" },
  { key: "utility", label: "Utility" },
  { key: "authentication", label: "Auth" },
];

const STATUS_META: Record<string, { label: string; color: string }> = {
  delivered: { label: "Delivered", color: "hsl(var(--a-green))" },
  read: { label: "Read", color: "hsl(var(--a-primary))" },
  sent: { label: "Sent", color: "hsl(var(--a-blue))" },
  failed: { label: "Failed", color: "hsl(var(--a-red))" },
  pending: { label: "Pending", color: "hsl(var(--a-amber))" },
};
const STATUS_ORDER = ["delivered", "read", "sent", "failed", "pending"];

const HEALTH_STYLE = {
  ok: { dot: "bg-adm-green", text: "text-adm-green", label: "Healthy" },
  warn: { dot: "bg-adm-amber", text: "text-adm-amber", label: "Needs attention" },
  down: { dot: "bg-adm-red", text: "text-adm-red", label: "Down" },
  unknown: { dot: "bg-adm-faint", text: "text-adm-faint", label: "Unknown" },
} as const;

const TIER_LABEL: Record<string, string> = {
  starter: "Starter", growth: "Growth", enterprise: "Enterprise",
};

/** Tenant avatar tints, cycled — purely decorative, never encodes meaning. */
const AVATAR_TINTS = [
  "bg-adm-primary", "bg-adm-blue", "bg-adm-green", "bg-adm-amber", "bg-adm-red",
];

export default function AdminOverviewPage() {
  const [authorized, setAuthorized] = useState<boolean | null>(null);
  const [days, setDays] = useState<number>(7);
  const [tab, setTab] = useState<Tab>("all");
  const [data, setData] = useState<AdminOverview | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback((range: number) => {
    setLoading(true);
    adminApi
      .overview(range)
      .then(({ overview }) => {
        setData(overview);
        setAuthorized(true);
      })
      .catch((err: Error & { status?: number }) => {
        if (err.status === 403) { setAuthorized(false); return; }
        setAuthorized(true);
        toast.error(err.message || "Failed to load platform overview");
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(days); }, [days, load]);

  if (authorized === false) {
    return (
      <Shell>
        <div className="rounded-xl border border-adm-line bg-adm-card p-8 text-center">
          <ShieldCheck className="mx-auto h-10 w-10 text-adm-faint" />
          <p className="mt-3 font-semibold text-adm-ink">Not authorized</p>
          <p className="text-sm text-adm-muted">
            This page is restricted to platform admins (ADMIN_EMAILS allowlist).
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

  const {
    tenants, people, numbers, messages, revenue, deltas, ai, campaigns,
    topTenants, health, warnings,
  } = data;

  const statusTotal = STATUS_ORDER.reduce((t, k) => t + (messages.byStatus[k] ?? 0), 0);
  const donut = STATUS_ORDER
    .map((k) => ({ key: k, name: STATUS_META[k].label, value: messages.byStatus[k] ?? 0, color: STATUS_META[k].color }))
    .filter((d) => d.value > 0);

  const marginPct = revenue.messageChargedPaise
    ? (revenue.messageMarginPaise / revenue.messageChargedPaise) * 100
    : 0;
  const visibleSeries = tab === "all" ? SERIES : SERIES.filter((s) => s.key === tab);

  return (
    <Shell>
      {/* ── Header ── */}
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-adm-ink">
            Platform Super Admin Dashboard
          </h1>
          <p className="mt-1 text-sm text-adm-muted">
            Overview of your SendAnjal platform · updated{" "}
            {new Date(data.generatedAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex rounded-[10px] border border-adm-line bg-adm-card p-1">
            {RANGES.map((r) => (
              <button
                key={r}
                onClick={() => setDays(r)}
                className={cn(
                  "rounded-md px-3 py-1.5 text-xs font-semibold transition-colors",
                  days === r
                    ? "bg-adm-primarySoft text-adm-primary"
                    : "text-adm-muted hover:text-adm-ink",
                )}
              >
                {r} days
              </button>
            ))}
          </div>
          <Link
            href="/admin/rates"
            className="inline-flex items-center gap-2 rounded-[10px] bg-adm-primary px-4 py-2 text-xs font-semibold text-white transition-opacity hover:opacity-90"
          >
            <SlidersHorizontal className="h-3.5 w-3.5" /> Rates &amp; markup
          </Link>
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

      {/* ── KPI row ── */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-6">
        <Kpi icon={Building2} tint="primary" label="Total tenants"
             value={tenants.total.toLocaleString("en-IN")} delta={deltas.tenants} days={days} />
        <Kpi icon={Bolt} tint="green" label="Active tenants"
             value={tenants.active.toLocaleString("en-IN")} delta={deltas.activeTenants} days={days} />
        <Kpi icon={Users} tint="amber" label="Total users"
             value={people.total.toLocaleString("en-IN")} delta={deltas.people} days={days} />
        <Kpi icon={Phone} tint="blue" label="Connected numbers"
             value={numbers.total.toLocaleString("en-IN")} delta={deltas.numbers} days={days} />
        <Kpi icon={CircleDollarSign} tint="primary" label="MRR"
             value={inr(revenue.mrrPaise)} delta={deltas.mrr} days={days}
             note={revenue.unpricedSubscriptions > 0
               ? `${revenue.payingSubscriptions} paying · ${revenue.unpricedSubscriptions} unpriced`
               : `${revenue.payingSubscriptions} paying of ${revenue.activeSubscriptions}`} />
        <Kpi icon={Send} tint="green" label="Messages sent"
             value={compactCount(messages.period)} delta={deltas.messages} days={days}
             note={`${compactCount(messages.allTime)} all time`} />
      </div>

      {/* ── Message overview + status ── */}
      <div className="mt-4 grid items-start gap-4 xl:grid-cols-3">
        <Panel className="xl:col-span-2">
          <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-[15px] font-bold text-adm-ink">Message overview</h3>
            <div className="flex rounded-lg bg-adm-bg p-1">
              {TABS.map((t) => (
                <button
                  key={t.key}
                  onClick={() => setTab(t.key)}
                  className={cn(
                    "rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                    tab === t.key
                      ? "bg-adm-card text-adm-ink shadow-sm"
                      : "text-adm-muted hover:text-adm-ink",
                  )}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>
          <p className="mb-3 text-xs text-adm-faint">
            Category is recorded on billed (managed) sends only — BYO traffic is not in this split.
          </p>

          <div className="h-[250px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={messages.series} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
                <CartesianGrid stroke="hsl(var(--a-line))" vertical={false} />
                <XAxis dataKey="date" tickFormatter={dayLabel} tickLine={false} axisLine={false}
                       tick={{ fontSize: 11, fill: "hsl(var(--a-ink-faint))" }} minTickGap={20} />
                <YAxis tickLine={false} axisLine={false} width={54}
                       tick={{ fontSize: 11, fill: "hsl(var(--a-ink-faint))" }}
                       tickFormatter={(v: number) => compactCount(v)} />
                <Tooltip content={<ChartTooltip />} />
                {visibleSeries.map((s) => (
                  <Line key={s.key} type="monotone" dataKey={s.key} name={s.label}
                        stroke={s.color} strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>

          <div className="mt-3 flex flex-wrap justify-center gap-5 text-xs text-adm-muted">
            {visibleSeries.map((s) => (
              <span key={s.key} className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full" style={{ background: s.color }} />
                {s.label}
              </span>
            ))}
          </div>
        </Panel>

        <Panel>
          <h3 className="text-[15px] font-bold text-adm-ink">Message status</h3>
          <p className="text-xs text-adm-faint">Outbound, last {days} days</p>

          {statusTotal === 0 ? (
            <div className="flex h-[210px] items-center justify-center text-sm text-adm-muted">
              No sends in this window
            </div>
          ) : (
            <>
              <div className="relative mt-2 h-[210px]">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={donut} dataKey="value" nameKey="name" innerRadius="72%" outerRadius="100%"
                         paddingAngle={1} stroke="none">
                      {donut.map((d) => <Cell key={d.key} fill={d.color} />)}
                    </Pie>
                    <Tooltip content={<ChartTooltip />} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                  <span className="text-xl font-bold text-adm-ink">{compactCount(statusTotal)}</span>
                  <span className="text-[11px] text-adm-muted">Total</span>
                </div>
              </div>

              <div className="mt-4 space-y-2.5">
                {donut.map((d) => (
                  <div key={d.key} className="flex items-center justify-between text-xs">
                    <span className="flex items-center gap-2 text-adm-muted">
                      <span className="h-2 w-2 rounded-full" style={{ background: d.color }} />
                      {d.name}
                    </span>
                    <span className="font-semibold text-adm-ink">
                      {compactCount(d.value)}
                      <span className="ml-1.5 font-normal text-adm-faint">
                        {((d.value / statusTotal) * 100).toFixed(1)}%
                      </span>
                    </span>
                  </div>
                ))}
              </div>
            </>
          )}
        </Panel>
      </div>

      {/* ── Money & usage ── */}
      <div className="mt-4 grid grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-6">
        <Mini icon={TrendingUp} tint="primary" label={`Message margin (${days}d)`}
              value={inr(revenue.messageMarginPaise)}
              foot={revenue.marginTrackedCount > 0
                ? `${marginPct.toFixed(1)}% on ${compactCount(revenue.marginTrackedCount)} settled`
                : "no settled sends yet"} />
        <Mini icon={PiggyBank} tint="green" label={`Top-ups (${days}d)`}
              value={inr(revenue.topupPaise)} foot="wallet recharges" />
        <Mini icon={CircleDollarSign} tint="blue" label={`Platform fees (${days}d)`}
              value={inr(revenue.platformFeesPaise)} foot="subscriptions · onboarding · add-ons" />
        <Mini icon={Wallet} tint="amber" label="Wallet float"
              value={inr(revenue.walletFloatPaise)} foot="unspent credit — a liability" />
        <Mini icon={Sparkles} tint="primary" label={`AI requests (${days}d)`}
              value={compactCount(ai.requests)}
              foot={`cost ${inrExact(ai.costPaise)}${ai.nonOk ? ` · ${ai.nonOk} fell back` : ""}`} />
        <Mini icon={Megaphone} tint="red" label="Active campaigns"
              value={campaigns.active.toLocaleString("en-IN")} foot="running or scheduled" />
      </div>

      {/* ── Tenants + health ── */}
      <div className="mt-4 grid items-start gap-4 xl:grid-cols-3">
        <Panel className="xl:col-span-2">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-[15px] font-bold text-adm-ink">Top performing tenants</h3>
            <Link href="/admin/tenants" className="text-xs font-semibold text-adm-primary hover:underline">
              All tenants
            </Link>
          </div>

          {topTenants.length === 0 ? (
            <p className="py-10 text-center text-sm text-adm-muted">
              No tenant sent a message in the last {days} days.
            </p>
          ) : (
            <div className="-mx-2 overflow-x-auto">
              <table className="w-full min-w-[660px]">
                <thead>
                  <tr className="text-left text-[10.5px] uppercase tracking-wider text-adm-faint">
                    <th className="px-2 pb-2.5 font-semibold">Tenant</th>
                    <th className="px-2 pb-2.5 font-semibold">Industry</th>
                    <th className="px-2 pb-2.5 text-right font-semibold">Sent</th>
                    <th className="px-2 pb-2.5 text-right font-semibold">Delivered</th>
                    <th className="px-2 pb-2.5 text-right font-semibold">Read</th>
                    <th className="px-2 pb-2.5 text-right font-semibold">Tier</th>
                  </tr>
                </thead>
                <tbody>
                  {topTenants.map((t, i) => (
                    <tr key={t.id} className="border-t border-adm-line text-sm">
                      <td className="px-2 py-3">
                        <div className="flex items-center gap-2.5">
                          <div className={cn(
                            "flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg text-[11px] font-bold text-white",
                            AVATAR_TINTS[i % AVATAR_TINTS.length],
                          )}>
                            {initials(t.name)}
                          </div>
                          <div className="min-w-0">
                            <p className="truncate font-semibold text-adm-ink">{t.name}</p>
                            <p className="truncate text-[11px] text-adm-muted">{t.email}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-2 py-3 text-adm-muted">{t.industry}</td>
                      <td className="px-2 py-3 text-right font-medium text-adm-ink">{compactCount(t.sent)}</td>
                      <td className="px-2 py-3 text-right text-adm-ink">{t.deliveredPct.toFixed(1)}%</td>
                      <td className="px-2 py-3 text-right text-adm-ink">{t.readPct.toFixed(1)}%</td>
                      <td className="px-2 py-3 text-right">
                        <span className="inline-block rounded-full bg-adm-primarySoft px-2.5 py-0.5 text-[11px] font-semibold text-adm-primary">
                          {TIER_LABEL[t.tier] ?? t.tier}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>

        <Panel>
          <h3 className="mb-1 flex items-center gap-2 text-[15px] font-bold text-adm-ink">
            <Activity className="h-4 w-4 text-adm-faint" /> System health
          </h3>
          <div>
            {health.map((h, i) => {
              const style = HEALTH_STYLE[h.status];
              return (
                <div
                  key={h.key}
                  className={cn(
                    "flex items-start justify-between gap-3 py-3",
                    i > 0 && "border-t border-adm-line",
                  )}
                >
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
          <p className="mt-2 text-[11px] leading-relaxed text-adm-faint">
            Checks are live: env/config presence plus the most recent webhook ingest.
          </p>
        </Panel>
      </div>
    </Shell>
  );
}

/* ── pieces ─────────────────────────────────────────────────────────────── */

/**
 * Paints the console's own ground. The dashboard layout pads <main>, so the
 * negative margin lets this palette run edge-to-edge instead of floating on
 * the teal app background.
 */
function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="admin-console -m-4 min-h-[calc(100vh-4rem)] bg-adm-bg p-4 sm:-m-6 sm:p-6">
      {children}
    </div>
  );
}

function Panel({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("rounded-xl border border-adm-line bg-adm-card p-5", className)}>
      {children}
    </div>
  );
}

function initials(name: string): string {
  return name.split(/\s+/).map((w) => w[0]).filter(Boolean).slice(0, 2).join("").toUpperCase() || "?";
}

const TINTS = {
  primary: "bg-adm-primarySoft text-adm-primary",
  green: "bg-adm-greenSoft text-adm-green",
  amber: "bg-adm-amberSoft text-adm-amber",
  blue: "bg-adm-blueSoft text-adm-blue",
  red: "bg-adm-redSoft text-adm-red",
} as const;

/** Trend chip. Renders nothing when the API could not compute a real change. */
function Delta({ value, days }: { value: number | null; days: number }) {
  if (value === null) {
    return <span className="text-[11px] text-adm-faint">no prior-period baseline</span>;
  }
  const up = value >= 0;
  const Icon = up ? ArrowUpRight : ArrowDownRight;
  return (
    <span className="flex items-center gap-1 whitespace-nowrap text-[11px] font-semibold">
      <Icon className={cn("h-3 w-3 flex-shrink-0", up ? "text-adm-green" : "text-adm-red")} />
      <span className={up ? "text-adm-green" : "text-adm-red"}>
        {up ? "+" : ""}{value}%
      </span>
      <span className="font-normal text-adm-faint">vs prev {days}d</span>
    </span>
  );
}

function Kpi({
  icon: Icon, tint, label, value, delta, days, note,
}: {
  icon: React.ElementType;
  tint: keyof typeof TINTS;
  label: string;
  value: string;
  delta: number | null;
  days: number;
  note?: string;
}) {
  return (
    <div className="flex h-full flex-col rounded-xl border border-adm-line bg-adm-card p-4">
      {/* Fixed two-line box: a label that wraps must not shift the value's
          baseline out of line with the neighbouring cards. */}
      <div className="flex min-h-[2.6em] items-start gap-2">
        <span className={cn(
          "flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-[7px]",
          TINTS[tint],
        )}>
          <Icon className="h-3.5 w-3.5" />
        </span>
        <span className="text-[11.5px] font-medium leading-tight text-adm-muted">{label}</span>
      </div>
      <p className="mt-1 text-xl font-bold tracking-tight text-adm-ink">{value}</p>
      <div className="mt-1.5">
        <Delta value={delta} days={days} />
      </div>
      {note && <p className="mt-auto pt-1 text-[11px] text-adm-faint">{note}</p>}
    </div>
  );
}

function Mini({
  icon: Icon, tint, label, value, foot,
}: {
  icon: React.ElementType;
  tint: keyof typeof TINTS;
  label: string;
  value: string;
  foot: string;
}) {
  return (
    <div className="rounded-xl border border-adm-line bg-adm-card p-4">
      <span className={cn("flex h-6 w-6 items-center justify-center rounded-[7px]", TINTS[tint])}>
        <Icon className="h-3 w-3" />
      </span>
      <p className="mt-2.5 text-[11px] font-medium text-adm-muted">{label}</p>
      <p className="mt-1 text-base font-bold tracking-tight text-adm-ink">{value}</p>
      <p className="mt-1 text-[11px] text-adm-faint">{foot}</p>
    </div>
  );
}

function ChartTooltip({
  active, payload, label,
}: {
  active?: boolean;
  payload?: { value: number; name: string; color?: string; payload?: { fill?: string } }[];
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-xl border border-adm-line bg-adm-card p-3 text-xs shadow-xl">
      {label && <p className="mb-1.5 font-medium text-adm-muted">{dayLabel(String(label))}</p>}
      {payload.map((p, i) => (
        <div key={i} className="mt-1 flex items-center gap-2">
          <span className="h-2 w-2 rounded-full" style={{ background: p.color || p.payload?.fill }} />
          <span className="text-adm-muted">{p.name}:</span>
          <span className="font-semibold text-adm-ink">{p.value.toLocaleString("en-IN")}</span>
        </div>
      ))}
    </div>
  );
}
