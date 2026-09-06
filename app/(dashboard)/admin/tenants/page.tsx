"use client";

/**
 * Tenants — the directory, and where an industry gets assigned.
 *
 * Assigning a tenant to an industry was already possible, but only if you knew
 * their id: the only way in was an email lookup. This screen is the discovery
 * layer — see every tenant, find the ones with no industry yet, and assign
 * one (or many) without leaving the page.
 *
 * Assigning is NON-DESTRUCTIVE: it writes a single column (users.vertical_id).
 * The tenant's own flows, campaigns and templates are their own rows and are
 * never touched — changing industry only changes what appears on their
 * "recommended" rails. That is why bulk assign is offered at all.
 *
 * For the full provisioning flow — preview exactly what the client will
 * receive before saving — "Set up" opens the per-client setup screen.
 */

import { VerticalIcon } from "@/components/verticals/VerticalIcon";
import {
  admin as adminApi,
  type AdminClient, type AdminClientPage,
} from "@/lib/api";
import { cn } from "@/lib/utils";
import {
  Building2, ChevronLeft, ChevronRight, Layers, Loader2, Search,
  Settings2, ShieldCheck, Sparkles, X,
} from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

const TIERS = ["starter", "growth", "enterprise"] as const;
const TIER_LABEL: Record<string, string> = {
  starter: "Starter", growth: "Growth", enterprise: "Enterprise",
};

const inr = (paise: number) =>
  `₹${(paise / 100).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;

/**
 * useSearchParams needs a Suspense boundary in the App Router, so the screen
 * itself is the inner component. The deep link that matters is
 * `?vertical=none` — "who still has no industry?" — which the ops console
 * links straight to.
 */
export default function TenantsPage() {
  return (
    <Suspense
      fallback={
        <Shell>
          <div className="flex items-center justify-center py-24">
            <Loader2 className="h-6 w-6 animate-spin text-adm-faint" />
          </div>
        </Shell>
      }
    >
      <TenantsDirectory />
    </Suspense>
  );
}

function TenantsDirectory() {
  const searchParams = useSearchParams();
  const [authorized, setAuthorized] = useState<boolean | null>(null);
  const [data, setData] = useState<AdminClientPage | null>(null);
  const [loading, setLoading] = useState(true);

  const [q, setQ] = useState(searchParams.get("q") ?? "");
  const [search, setSearch] = useState(searchParams.get("q") ?? "");
  const [vertical, setVertical] = useState(searchParams.get("vertical") ?? "");
  const [tier, setTier] = useState(searchParams.get("tier") ?? "");
  const [page, setPage] = useState(1);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [rowBusy, setRowBusy] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    adminApi
      .clients({ q: search, vertical, tier, page, limit: 25 })
      .then((res) => { setData(res); setAuthorized(true); })
      .catch((err: Error & { status?: number }) => {
        if (err.status === 403) { setAuthorized(false); return; }
        setAuthorized(true);
        toast.error(err.message || "Failed to load tenants");
      })
      .finally(() => setLoading(false));
  }, [search, vertical, tier, page]);

  useEffect(() => { load(); }, [load]);
  // Any filter change invalidates both the page number and the selection —
  // acting on rows you can no longer see is how bulk actions go wrong.
  useEffect(() => { setPage(1); setSelected(new Set()); }, [search, vertical, tier]);

  const assignOne = async (client: AdminClient, verticalId: string | null) => {
    setRowBusy(client.id);
    try {
      const { vertical: v } = await adminApi.clientVerticalSet(client.id, verticalId);
      toast.success(v ? `${client.name} → ${v.displayName}` : `Industry cleared for ${client.name}`);
      load();
    } catch (err) {
      toast.error((err as Error).message || "Could not assign industry");
    } finally {
      setRowBusy(null);
    }
  };

  const assignBulk = async (verticalId: string | null) => {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    setBulkBusy(true);
    try {
      const res = await adminApi.clientsBulkVertical(ids, verticalId);
      if (res.failed.length > 0) {
        // Partial success is reported as such — the assigned ones ARE assigned.
        toast.warning(`${res.assigned} assigned, ${res.failed.length} failed`);
      } else {
        toast.success(`${res.assigned} tenant${res.assigned === 1 ? "" : "s"} updated`);
      }
      setSelected(new Set());
      load();
    } catch (err) {
      toast.error((err as Error).message || "Bulk assign failed");
    } finally {
      setBulkBusy(false);
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

  const activeFilters = Boolean(search || vertical || tier);
  const field =
    "rounded-lg border border-adm-line bg-adm-card px-3 py-2 text-xs text-adm-ink outline-none focus:border-adm-primary";
  const liveVerticals = data?.verticals.filter((v) => v.isActive) ?? [];
  const noIndustry = data?.clients.filter((c) => !c.vertical).length ?? 0;

  return (
    <Shell>
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-adm-ink">Tenants</h1>
          <p className="mt-1 text-sm text-adm-muted">
            {data?.total.toLocaleString("en-IN") ?? "…"} tenant{data?.total === 1 ? "" : "s"}
            {activeFilters ? " matching" : ""} · assign an industry to drive their setup
          </p>
        </div>
        <Link
          href="/admin/industries"
          className="inline-flex items-center gap-2 rounded-[10px] border border-adm-line bg-adm-card px-3 py-2 text-xs font-semibold text-adm-muted hover:text-adm-ink"
        >
          <Layers className="h-3.5 w-3.5" /> Manage industries
        </Link>
      </div>

      {/* ── Filters ── */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <form onSubmit={(e) => { e.preventDefault(); setSearch(q.trim()); }} className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-adm-faint" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Name, company or email…"
            className={cn(field, "w-60 pl-8")}
          />
        </form>

        <select value={vertical} onChange={(e) => setVertical(e.target.value)} className={field}>
          <option value="">All industries</option>
          <option value="none">— No industry yet —</option>
          {data?.verticals.map((v) => (
            <option key={v.id} value={v.id}>{v.displayName}{v.isActive ? "" : " (hidden)"}</option>
          ))}
        </select>

        <select value={tier} onChange={(e) => setTier(e.target.value)} className={field}>
          <option value="">All tiers</option>
          {TIERS.map((t) => <option key={t} value={t}>{TIER_LABEL[t]}</option>)}
        </select>

        {activeFilters && (
          <button
            onClick={() => { setQ(""); setSearch(""); setVertical(""); setTier(""); }}
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-adm-primary hover:underline"
          >
            <X className="h-3 w-3" /> Clear
          </button>
        )}

        {noIndustry > 0 && !vertical && (
          <button
            onClick={() => setVertical("none")}
            className="ml-auto inline-flex items-center gap-1.5 rounded-full bg-adm-amberSoft px-3 py-1.5 text-[11px] font-semibold text-adm-amber"
          >
            <Sparkles className="h-3 w-3" />
            {noIndustry} on this page have no industry — show only those
          </button>
        )}
      </div>

      {/* ── Bulk bar: only present when a selection exists ── */}
      {selected.size > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-3 rounded-xl border border-adm-primary/30 bg-adm-primarySoft px-4 py-3">
          <span className="text-xs font-semibold text-adm-primary">
            {selected.size} selected
          </span>
          <span className="text-[11px] text-adm-muted">Assign all to:</span>
          <select
            defaultValue=""
            disabled={bulkBusy}
            onChange={(e) => {
              const v = e.target.value;
              e.target.value = "";
              if (v) assignBulk(v === "none" ? null : v);
            }}
            className={cn(field, "min-w-[180px]")}
          >
            <option value="">Choose an industry…</option>
            {liveVerticals.map((v) => <option key={v.id} value={v.id}>{v.displayName}</option>)}
            <option value="none">— Clear industry —</option>
          </select>
          {bulkBusy && <Loader2 className="h-4 w-4 animate-spin text-adm-primary" />}
          <button
            onClick={() => setSelected(new Set())}
            className="ml-auto text-xs font-semibold text-adm-muted hover:text-adm-ink"
          >
            Cancel
          </button>
        </div>
      )}

      {/* ── Directory ── */}
      <div className="rounded-xl border border-adm-line bg-adm-card">
        {loading && !data ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="h-5 w-5 animate-spin text-adm-faint" />
          </div>
        ) : !data || data.clients.length === 0 ? (
          <div className="px-5 py-16 text-center">
            <Building2 className="mx-auto h-9 w-9 text-adm-faint" />
            <p className="mt-3 font-semibold text-adm-ink">
              {activeFilters ? "No tenants match these filters" : "No tenants yet"}
            </p>
            <p className="mx-auto mt-1 max-w-md text-sm text-adm-muted">
              {activeFilters ? "Try clearing a filter or widening the search." : "Tenants appear here as they sign up."}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px]">
              <thead>
                <tr className="text-left text-[10.5px] uppercase tracking-wider text-adm-faint">
                  <th className="w-10 px-4 py-3">
                    <input
                      type="checkbox"
                      aria-label="Select all on this page"
                      checked={data.clients.length > 0 && selected.size === data.clients.length}
                      onChange={(e) =>
                        setSelected(e.target.checked ? new Set(data.clients.map((c) => c.id)) : new Set())
                      }
                      className="h-3.5 w-3.5 accent-[hsl(var(--a-primary))]"
                    />
                  </th>
                  <th className="px-4 py-3 font-semibold">Tenant</th>
                  <th className="px-4 py-3 font-semibold">Industry</th>
                  <th className="px-4 py-3 font-semibold">Tier</th>
                  <th className="px-4 py-3 text-right font-semibold">Numbers</th>
                  <th className="px-4 py-3 text-right font-semibold">Wallet</th>
                  <th className="px-4 py-3 text-right font-semibold">Setup</th>
                </tr>
              </thead>
              <tbody>
                {data.clients.map((c) => (
                  <tr key={c.id} className="border-t border-adm-line text-sm">
                    <td className="px-4 py-3">
                      <input
                        type="checkbox"
                        aria-label={`Select ${c.name}`}
                        checked={selected.has(c.id)}
                        onChange={(e) => {
                          const next = new Set(selected);
                          if (e.target.checked) next.add(c.id); else next.delete(c.id);
                          setSelected(next);
                        }}
                        className="h-3.5 w-3.5 accent-[hsl(var(--a-primary))]"
                      />
                    </td>
                    <td className="px-4 py-3">
                      <p className="font-semibold text-adm-ink">{c.name}</p>
                      <p className="text-[11px] text-adm-muted">{c.email}</p>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        {c.vertical ? (
                          <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md bg-adm-primarySoft text-adm-primary">
                            <VerticalIcon name={c.vertical.icon} className="h-3.5 w-3.5" />
                          </span>
                        ) : null}
                        <select
                          value={c.vertical?.id ?? ""}
                          disabled={rowBusy === c.id}
                          onChange={(e) => assignOne(c, e.target.value || null)}
                          className={cn(
                            "min-w-[150px] rounded-lg border bg-adm-card px-2 py-1.5 text-xs outline-none focus:border-adm-primary disabled:opacity-50",
                            c.vertical
                              ? "border-adm-line text-adm-ink"
                              : "border-dashed border-adm-amber/50 text-adm-amber",
                          )}
                        >
                          <option value="">— No industry —</option>
                          {liveVerticals.map((v) => (
                            <option key={v.id} value={v.id}>{v.displayName}</option>
                          ))}
                          {/* A tenant can sit on a since-hidden industry; keep it
                              selectable so saving does not silently reassign them. */}
                          {c.vertical && !c.vertical.isActive && (
                            <option value={c.vertical.id}>{c.vertical.displayName} (hidden)</option>
                          )}
                        </select>
                        {rowBusy === c.id && <Loader2 className="h-3.5 w-3.5 animate-spin text-adm-primary" />}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className="inline-block rounded-full bg-adm-primarySoft px-2.5 py-0.5 text-[11px] font-semibold text-adm-primary">
                        {TIER_LABEL[c.tier] ?? c.tier}
                      </span>
                      <p className="mt-0.5 text-[10.5px] uppercase text-adm-faint">{c.billingMode}</p>
                    </td>
                    <td className="px-4 py-3 text-right text-adm-ink">{c.numbers}</td>
                    <td className="px-4 py-3 text-right text-adm-ink">{inr(c.balancePaise)}</td>
                    <td className="px-4 py-3 text-right">
                      <Link
                        href={`/admin/clients/${c.id}/setup`}
                        className="inline-flex items-center gap-1.5 rounded-[7px] bg-adm-primarySoft px-2.5 py-1.5 text-[11.5px] font-semibold text-adm-primary"
                      >
                        <Settings2 className="h-3.5 w-3.5" /> Set up
                      </Link>
                    </td>
                  </tr>
                ))}
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

      <p className="mt-3 text-[11px] leading-relaxed text-adm-faint">
        Changing an industry rewrites one column. The tenant keeps every flow, campaign and
        template they already have — only their recommended content changes. Use{" "}
        <span className="font-semibold">Set up</span> to preview exactly what a client receives
        before provisioning them.
      </p>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="admin-console -m-4 min-h-[calc(100vh-4rem)] bg-adm-bg p-4 sm:-m-6 sm:p-6">
      {children}
    </div>
  );
}
