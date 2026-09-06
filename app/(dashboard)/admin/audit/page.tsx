"use client";

/**
 * Audit logs — who did what, to whom, from where.
 *
 * Read-only by construction: `audit_logs` is append-only from lib/audit.ts and
 * the API exposes no write verb. There is no delete/edit control on this
 * screen and there should never be one — a log an admin can edit proves
 * nothing in a controls review.
 *
 * The entries that matter most are the privileged ones (rate/tier/AI-config
 * changes, token rotations), so failures and money-affecting actions are
 * visually distinguished rather than buried in a uniform list.
 */

import { admin as adminApi, type AuditEntry, type AuditPage } from "@/lib/api";
import { cn } from "@/lib/utils";
import {
  AlertTriangle, ChevronDown, ChevronLeft, ChevronRight, ClipboardList,
  Loader2, Search, ShieldCheck, X,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

const DAY_RANGES = [
  { days: 0, label: "All time" },
  { days: 1, label: "24h" },
  { days: 7, label: "7 days" },
  { days: 30, label: "30 days" },
];

/**
 * Actions that change money or access. Everything else is routine, so only
 * these get the amber marker — if all entries were highlighted, none would be.
 */
const PRIVILEGED = /^(rates\.|tier\.|ai_config\.|access_token\.|vertical\.)/;

function actionLabel(action: string): string {
  const [group, verb] = action.split(".");
  const g = group.replace(/_/g, " ");
  return verb ? `${g.charAt(0).toUpperCase() + g.slice(1)} · ${verb.replace(/_/g, " ")}` : action;
}

function when(iso: string): { rel: string; abs: string } {
  const t = Date.parse(iso);
  const s = Math.max(0, Math.round((Date.now() - t) / 1000));
  const rel =
    s < 60 ? `${s}s ago`
      : s < 3600 ? `${Math.round(s / 60)}m ago`
        : s < 86400 ? `${Math.round(s / 3600)}h ago`
          : `${Math.round(s / 86400)}d ago`;
  return {
    rel,
    abs: new Date(t).toLocaleString("en-IN", {
      day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
    }),
  };
}

export default function AuditLogPage() {
  const [authorized, setAuthorized] = useState<boolean | null>(null);
  const [data, setData] = useState<AuditPage | null>(null);
  const [loading, setLoading] = useState(true);

  const [action, setAction] = useState("");
  const [outcome, setOutcome] = useState("");
  const [actor, setActor] = useState("");
  const [days, setDays] = useState(0);
  const [q, setQ] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);

  const load = useCallback(() => {
    setLoading(true);
    adminApi
      .audit({ action, outcome, actor, days, q: search, page, limit: 50 })
      .then((res) => { setData(res); setAuthorized(true); })
      .catch((err: Error & { status?: number }) => {
        if (err.status === 403) { setAuthorized(false); return; }
        setAuthorized(true);
        toast.error(err.message || "Failed to load audit log");
      })
      .finally(() => setLoading(false));
  }, [action, outcome, actor, days, search, page]);

  useEffect(() => { load(); }, [load]);
  // Any filter change invalidates the current page number.
  useEffect(() => { setPage(1); }, [action, outcome, actor, days, search]);

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

  const activeFilters = Boolean(action || outcome || actor || days || search);
  const field =
    "rounded-lg border border-adm-line bg-adm-card px-3 py-2 text-xs text-adm-ink outline-none focus:border-adm-primary";

  return (
    <Shell>
      <div className="mb-5">
        <h1 className="text-2xl font-bold tracking-tight text-adm-ink">Audit logs</h1>
        <p className="mt-1 text-sm text-adm-muted">
          Append-only record of privileged actions — {data?.total.toLocaleString("en-IN") ?? "…"} entries
          {activeFilters ? " matching" : " total"}
        </p>
      </div>

      {data?.warning && (
        <div className="mb-4 rounded-xl border border-adm-amber/30 bg-adm-amberSoft p-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-adm-amber">
            <AlertTriangle className="h-4 w-4" /> Audit log unavailable
          </div>
          <p className="mt-1 text-xs text-adm-muted">{data.warning}</p>
        </div>
      )}

      {/* ── Filters ── */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <form
          onSubmit={(e) => { e.preventDefault(); setSearch(q.trim()); }}
          className="relative"
        >
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-adm-faint" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Action or resource id…"
            className={cn(field, "w-56 pl-8")}
          />
        </form>

        <select value={action} onChange={(e) => setAction(e.target.value)} className={field}>
          <option value="">All actions</option>
          {data?.actions.map((a) => <option key={a} value={a}>{actionLabel(a)}</option>)}
        </select>

        <select value={actor} onChange={(e) => setActor(e.target.value)} className={field}>
          <option value="">All actors</option>
          {data?.actors.map((a) => <option key={a.id} value={a.id}>{a.email}</option>)}
        </select>

        <select value={outcome} onChange={(e) => setOutcome(e.target.value)} className={field}>
          <option value="">Any outcome</option>
          <option value="success">Success</option>
          <option value="failure">Failure</option>
        </select>

        <div className="flex rounded-lg border border-adm-line bg-adm-card p-0.5">
          {DAY_RANGES.map((r) => (
            <button
              key={r.days}
              onClick={() => setDays(r.days)}
              className={cn(
                "rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors",
                days === r.days ? "bg-adm-primarySoft text-adm-primary" : "text-adm-muted hover:text-adm-ink",
              )}
            >
              {r.label}
            </button>
          ))}
        </div>

        {activeFilters && (
          <button
            onClick={() => { setAction(""); setOutcome(""); setActor(""); setDays(0); setQ(""); setSearch(""); }}
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-adm-primary hover:underline"
          >
            <X className="h-3 w-3" /> Clear
          </button>
        )}
      </div>

      {/* ── Entries ── */}
      <div className="rounded-xl border border-adm-line bg-adm-card">
        {loading && !data ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="h-5 w-5 animate-spin text-adm-faint" />
          </div>
        ) : !data || data.entries.length === 0 ? (
          <div className="px-5 py-16 text-center">
            <ClipboardList className="mx-auto h-9 w-9 text-adm-faint" />
            <p className="mt-3 font-semibold text-adm-ink">
              {activeFilters ? "No entries match these filters" : "No audit entries yet"}
            </p>
            <p className="mx-auto mt-1 max-w-md text-sm text-adm-muted">
              {activeFilters
                ? "Try widening the date range or clearing a filter."
                : "Entries appear here as admins change rates, tiers, AI config, industries or tickets."}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px]">
              <thead>
                <tr className="text-left text-[10.5px] uppercase tracking-wider text-adm-faint">
                  <th className="px-4 py-3 font-semibold">When</th>
                  <th className="px-4 py-3 font-semibold">Actor</th>
                  <th className="px-4 py-3 font-semibold">Action</th>
                  <th className="px-4 py-3 font-semibold">Resource</th>
                  <th className="px-4 py-3 font-semibold">Outcome</th>
                  <th className="px-4 py-3 font-semibold">IP</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {data.entries.map((e) => <Row key={e.id} entry={e} />)}
              </tbody>
            </table>
          </div>
        )}

        {data && data.pages > 1 && (
          <div className="flex items-center justify-between border-t border-adm-line px-4 py-3">
            <p className="text-xs text-adm-muted">Page {data.page} of {data.pages}</p>
            <div className="flex gap-2">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={data.page <= 1 || loading}
                className="inline-flex items-center gap-1 rounded-[7px] border border-adm-line px-2.5 py-1.5 text-xs font-semibold text-adm-muted disabled:opacity-40"
              >
                <ChevronLeft className="h-3.5 w-3.5" /> Prev
              </button>
              <button
                onClick={() => setPage((p) => p + 1)}
                disabled={data.page >= data.pages || loading}
                className="inline-flex items-center gap-1 rounded-[7px] border border-adm-line px-2.5 py-1.5 text-xs font-semibold text-adm-muted disabled:opacity-40"
              >
                Next <ChevronRight className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        )}
      </div>
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

function Row({ entry }: { entry: AuditEntry }) {
  const [open, setOpen] = useState(false);
  const t = when(entry.at);
  const failed = entry.outcome === "failure";
  const privileged = PRIVILEGED.test(entry.action);
  const hasDetails = Object.keys(entry.details).length > 0;

  return (
    <>
      <tr className={cn("border-t border-adm-line text-sm", failed && "bg-adm-redSoft/40")}>
        <td className="px-4 py-3 align-top">
          <p className="whitespace-nowrap text-adm-ink">{t.rel}</p>
          <p className="whitespace-nowrap text-[11px] text-adm-faint">{t.abs}</p>
        </td>
        <td className="px-4 py-3 align-top">
          <p className="truncate font-medium text-adm-ink">{entry.actor}</p>
          {entry.actorEmail && entry.actorEmail !== entry.actor && (
            <p className="truncate text-[11px] text-adm-muted">{entry.actorEmail}</p>
          )}
        </td>
        <td className="px-4 py-3 align-top">
          <span className="flex items-center gap-1.5">
            {privileged && (
              <span
                className="h-1.5 w-1.5 flex-shrink-0 rounded-full bg-adm-amber"
                title="Privileged — changes money or access"
              />
            )}
            <span className="text-adm-ink">{actionLabel(entry.action)}</span>
          </span>
          <p className="font-mono text-[10.5px] text-adm-faint">{entry.action}</p>
        </td>
        <td className="px-4 py-3 align-top">
          {entry.resourceType ? (
            <>
              <p className="text-adm-ink">{entry.resourceType}</p>
              {entry.resourceId && (
                <p className="truncate font-mono text-[10.5px] text-adm-faint" title={entry.resourceId}>
                  {entry.resourceId.length > 20 ? `${entry.resourceId.slice(0, 8)}…${entry.resourceId.slice(-6)}` : entry.resourceId}
                </p>
              )}
            </>
          ) : <span className="text-adm-faint">—</span>}
        </td>
        <td className="px-4 py-3 align-top">
          <span className={cn(
            "inline-block rounded-full px-2.5 py-0.5 text-[11px] font-semibold",
            failed ? "bg-adm-redSoft text-adm-red" : "bg-adm-greenSoft text-adm-green",
          )}>
            {failed ? "Failure" : "Success"}
          </span>
        </td>
        <td className="px-4 py-3 align-top font-mono text-[11px] text-adm-muted">{entry.ip || "—"}</td>
        <td className="px-4 py-3 align-top text-right">
          {hasDetails && (
            <button
              onClick={() => setOpen((v) => !v)}
              className="inline-flex items-center gap-1 rounded-[7px] bg-adm-primarySoft px-2 py-1 text-[11px] font-semibold text-adm-primary"
            >
              Details <ChevronDown className={cn("h-3 w-3 transition-transform", open && "rotate-180")} />
            </button>
          )}
        </td>
      </tr>
      {open && hasDetails && (
        <tr className="border-t border-adm-line">
          <td colSpan={7} className="px-4 pb-4">
            {/* The before/after payload is the point of the entry — show it raw
                rather than summarising and risking a misleading paraphrase. */}
            <pre className="overflow-x-auto rounded-lg bg-adm-bg p-3 font-mono text-[11px] leading-relaxed text-adm-muted">
              {JSON.stringify(entry.details, null, 2)}
            </pre>
            {entry.userAgent && (
              <p className="mt-1.5 truncate text-[10.5px] text-adm-faint" title={entry.userAgent}>
                UA: {entry.userAgent}
              </p>
            )}
          </td>
        </tr>
      )}
    </>
  );
}
