/**
 * Admin: platform-wide overview for the super-admin dashboard.
 *
 *   GET ?days=7|30|90  → { overview }        (403 for non-admins)
 *
 * This is the ONE cross-tenant read in the codebase, and it is deliberate: the
 * platform owner is not a tenant, so tenant isolation does not apply to them.
 * SUPER ADMIN ONLY (requireSuperAdmin): it reports revenue, margin and MRR.
 * tenant_admin gets 403. It is aggregate-only —
 * no message bodies, no contacts, no tokens ever leave this route.
 *
 * Everything is soft-failed per section: a table that a not-yet-applied
 * migration hasn't created yields zeros plus an entry in `warnings`, rather
 * than 500-ing the whole dashboard. Money is integer paise throughout.
 *
 * Every independent query runs concurrently — the wall time is the slowest
 * single query, not their sum.
 *
 * DELTAS: each headline metric carries a period-over-period change, computed
 * from real prior-window data. A metric whose history we cannot reconstruct
 * (nothing snapshots it) returns null and the UI renders NO chip — an invented
 * trend on a revenue dashboard is worse than an absent one.
 *
 * Reads the LEGACY user_id model (users / whatsapp_numbers / messages), which
 * is what production actually runs — see "Deployment reality" in CLAUDE.md.
 */
import { NextRequest, NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/roles";
import { createServiceClient } from "@/lib/supabase/server";
import { platformHealth } from "@/lib/admin/health";
import { PLANS, type PlanId } from "@/lib/razorpay";

export const dynamic = "force-dynamic";

/** Hard cap on any single row pull, so one huge tenant can't OOM the route. */
const ROW_CAP = 50_000;
/** Tenant-table pull cap (users/wallet are one row per tenant). */
const TENANT_CAP = 5_000;

type HealthStatus = "ok" | "warn" | "down" | "unknown";
interface HealthCheck {
  key: string;
  label: string;
  status: HealthStatus;
  detail: string;
}

type Category = "marketing" | "utility" | "authentication" | "service";
const CATEGORIES: Category[] = ["marketing", "utility", "authentication", "service"];

/** IST day bucket — the market is India, so a "day" is Asia/Kolkata, not UTC. */
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
function istDay(iso: string | null): string | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  return new Date(t + IST_OFFSET_MS).toISOString().slice(0, 10);
}

const num = (v: unknown) => Number(v) || 0;

/**
 * Percent change, or null when it cannot be stated honestly.
 * A prior window of zero has no defined growth rate (÷0) — "+100%" would be a
 * fabrication, so callers render nothing at all.
 */
function pctChange(current: number, previous: number): number | null {
  if (previous <= 0) return null;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}

/**
 * Monthly recurring value of one subscription, in paise.
 *
 * `subscriptions.plan_id` holds a PlanId from lib/razorpay.ts
 * ('growth_monthly', 'pro_yearly', …) — NOT a plan_tiers.tier value
 * ('starter'/'growth'/'enterprise'). They are two different pricing concepts
 * and joining them silently prices every subscription at zero.
 *
 * PLANS is the same table billing charges from, so MRR can't drift from what
 * customers are actually billed. A yearly plan contributes 1/12 of its price.
 * Returns null for a plan id we don't recognise — unknown is not free.
 */
function monthlyPaise(planId: string | null): number | null {
  const plan = PLANS[(planId ?? "") as PlanId];
  if (!plan) return null;
  const paise = Math.round(plan.priceINR * 100);
  return plan.cycle === "yearly" ? Math.round(paise / 12) : paise;
}

interface UserRow {
  id: string;
  email: string;
  full_name: string | null;
  company_name: string | null;
  tier: string | null;
  billing_mode: string | null;
  vertical_id: string | null;
  created_at: string | null;
}

export async function GET(request: NextRequest) {
  const admin = await requireSuperAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const daysParam = Number(request.nextUrl.searchParams.get("days"));
  const days = [7, 30, 90].includes(daysParam) ? daysParam : 7;

  const supabase = createServiceClient();
  const now = Date.now();
  const windowMs = days * 24 * 60 * 60 * 1000;
  const sinceIso = new Date(now - windowMs).toISOString();
  const prevSinceIso = new Date(now - 2 * windowMs).toISOString();
  const warnings: string[] = [];

  /** Runs a query, downgrading any failure to a fallback + a warning. */
  async function safe<T>(label: string, run: () => Promise<T>, fallback: T): Promise<T> {
    try {
      return await run();
    } catch (err) {
      warnings.push(`${label}: ${(err as Error).message}`);
      return fallback;
    }
  }

  /** `select(..., { count: 'exact', head: true })` — a count without pulling rows. */
  async function countRows(
    label: string,
    build: () => PromiseLike<{ count: number | null; error: { message: string } | null }>,
  ): Promise<number> {
    return safe(
      label,
      async () => {
        const { count, error } = await build();
        if (error) throw new Error(error.message);
        return count ?? 0;
      },
      0,
    );
  }
  const headCount = (table: string) =>
    supabase.from(table).select("id", { count: "exact", head: true });

  // ── Every independent query, concurrently ─────────────────────────────────
  const [
    users, verticalNames,
    teamRows, numberRows,
    campaignsActive, messagesAllTime,
    messages, prevSenderRows,
    billed, subs,
    platformFeesPaise, topupPaise, walletFloatPaise,
    ai, health,
  ] = await Promise.all([
    // Tenants.
    safe<UserRow[]>(
      "users",
      async () => {
        const { data, error } = await supabase
          .from("users")
          .select("id, email, full_name, company_name, tier, billing_mode, vertical_id, created_at")
          .limit(TENANT_CAP);
        if (error) throw new Error(error.message);
        return (data ?? []) as UserRow[];
      },
      [],
    ),

    // Verticals give the "industry" column on the tenant table.
    safe<Record<string, string>>(
      "industry_verticals",
      async () => {
        const { data, error } = await supabase
          .from("industry_verticals")
          .select("id, display_name")
          .limit(200);
        if (error) throw new Error(error.message);
        const map: Record<string, string> = {};
        for (const v of (data ?? []) as { id: string; display_name: string }[]) {
          map[v.id] = v.display_name;
        }
        return map;
      },
      {},
    ),

    // One narrow pull instead of separate total/prior counts — this backend
    // serializes requests, so round-trip COUNT is the cost driver.
    safe<{ created_at: string | null }[]>(
      "team_members",
      async () => {
        const { data, error } = await supabase
          .from("team_members")
          .select("created_at")
          .limit(ROW_CAP);
        if (error) throw new Error(error.message);
        return (data ?? []) as { created_at: string | null }[];
      },
      [],
    ),

    // Likewise: total / active / new-in-window all come off one pull.
    safe<{ status: string | null; created_at: string | null }[]>(
      "whatsapp_numbers",
      async () => {
        const { data, error } = await supabase
          .from("whatsapp_numbers")
          .select("status, created_at")
          .limit(ROW_CAP);
        if (error) throw new Error(error.message);
        return (data ?? []) as { status: string | null; created_at: string | null }[];
      },
      [],
    ),

    countRows("campaigns", () => headCount("campaigns").in("status", ["running", "scheduled"])),
    countRows("messages", () => headCount("messages").eq("direction", "outbound")),

    // Outbound volume & status for the current window.
    safe<{ user_id: string | null; status: string | null; created_at: string | null }[]>(
      "messages",
      async () => {
        const { data, error } = await supabase
          .from("messages")
          .select("user_id, status, created_at")
          .eq("direction", "outbound")
          .gte("created_at", sinceIso)
          .limit(ROW_CAP);
        if (error) throw new Error(error.message);
        return (data ?? []) as { user_id: string | null; status: string | null; created_at: string | null }[];
      },
      [],
    ),

    // Prior window, senders only — the denominator for the "active tenants" delta.
    safe<{ user_id: string | null }[]>(
      "messages",
      async () => {
        const { data, error } = await supabase
          .from("messages")
          .select("user_id")
          .eq("direction", "outbound")
          .gte("created_at", prevSinceIso)
          .lt("created_at", sinceIso)
          .limit(ROW_CAP);
        if (error) throw new Error(error.message);
        return (data ?? []) as { user_id: string | null }[];
      },
      [],
    ),

    // Billed sends: the only place a message CATEGORY is recorded.
    safe<{ category: string | null; cost_paise: number | null; wholesale_paise: number | null; status: string | null; created_at: string | null }[]>(
      "message_billing",
      async () => {
        const { data, error } = await supabase
          .from("message_billing")
          .select("category, cost_paise, wholesale_paise, status, created_at")
          .gte("created_at", sinceIso)
          .limit(ROW_CAP);
        if (error) throw new Error(error.message);
        return (data ?? []) as never;
      },
      [],
    ),

    safe<{ plan_id: string | null; created_at: string | null }[]>(
      "subscriptions",
      async () => {
        const { data, error } = await supabase
          .from("subscriptions")
          .select("plan_id, created_at")
          .eq("status", "active")
          .limit(TENANT_CAP);
        if (error) throw new Error(error.message);
        return (data ?? []) as { plan_id: string | null; created_at: string | null }[];
      },
      [],
    ),

    safe<number>(
      "platform_charges",
      async () => {
        const { data, error } = await supabase
          .from("platform_charges")
          .select("amount_paise")
          .eq("status", "paid")
          .gte("created_at", sinceIso)
          .limit(ROW_CAP);
        if (error) throw new Error(error.message);
        return (data ?? []).reduce((t, r) => t + num((r as { amount_paise: number }).amount_paise), 0);
      },
      0,
    ),

    safe<number>(
      "transactions",
      async () => {
        const { data, error } = await supabase
          .from("transactions")
          .select("amount_paise")
          .eq("entry_type", "recharge")
          .gte("created_at", sinceIso)
          .limit(ROW_CAP);
        if (error) throw new Error(error.message);
        return (data ?? []).reduce(
          (t, r) => t + Math.abs(num((r as { amount_paise: number }).amount_paise)),
          0,
        );
      },
      0,
    ),

    // Unspent prepaid credit is a LIABILITY, not revenue — surfaced separately
    // on purpose so it is never read as money the platform has earned.
    safe<number>(
      "wallet",
      async () => {
        const { data, error } = await supabase.from("wallet").select("balance_paise").limit(TENANT_CAP);
        if (error) throw new Error(error.message);
        return (data ?? []).reduce((t, r) => t + num((r as { balance_paise: number }).balance_paise), 0);
      },
      0,
    ),

    safe(
      "ai_usage_log",
      async () => {
        const { data, error } = await supabase
          .from("ai_usage_log")
          .select("raw_cost_paise, credits_deducted, status")
          .gte("created_at", sinceIso)
          .limit(ROW_CAP);
        if (error) throw new Error(error.message);
        const rows = (data ?? []) as { raw_cost_paise: number; credits_deducted: number; status: string }[];
        let costPaise = 0, credits = 0, failed = 0;
        for (const r of rows) {
          costPaise += num(r.raw_cost_paise);
          credits += num(r.credits_deducted);
          if (r.status !== "ok") failed += 1;
        }
        return { requests: rows.length, costPaise, credits, failed };
      },
      { requests: 0, costPaise: 0, credits: 0, failed: 0 },
    ),

    // Shared with the ops console — the two dashboards must never disagree
    // about whether the platform is healthy.
    platformHealth(supabase, now),
  ]);

  if (messages.length >= ROW_CAP) {
    warnings.push(
      `messages: truncated at ${ROW_CAP.toLocaleString("en-IN")} rows — trend and per-tenant figures under-count.`,
    );
  }

  // ── Derived off the single-pull tables ─────────────────────────────────────
  const since = Date.parse(sinceIso);
  const createdBefore = (iso: string | null) => iso !== null && Date.parse(iso) < since;

  const seats = teamRows.length;
  const prevSeats = teamRows.filter((r) => createdBefore(r.created_at)).length;

  const numbersTotal = numberRows.length;
  const numbersActive = numberRows.filter((r) => r.status === "active").length;
  const prevNumbers = numberRows.filter((r) => createdBefore(r.created_at)).length;

  // The prior-window sender pull already contains every prior-window row, so
  // its length IS the prior message count — no extra round-trip for it.
  const prevMessageCount = prevSenderRows.length;

  // ── Tenants ────────────────────────────────────────────────────────────────
  const byTier: Record<string, number> = { starter: 0, growth: 0, enterprise: 0 };
  let newTenants = 0;
  for (const u of users) {
    const tier = u.tier ?? "enterprise";
    byTier[tier] = (byTier[tier] ?? 0) + 1;
    if (u.created_at && Date.parse(u.created_at) >= Date.parse(sinceIso)) newTenants += 1;
  }

  // ── Volume, status, per-tenant ─────────────────────────────────────────────
  const byStatus: Record<string, number> = { pending: 0, sent: 0, delivered: 0, read: 0, failed: 0 };
  const perTenant = new Map<string, { sent: number; delivered: number; read: number; failed: number }>();
  const totalsByDay = new Map<string, number>();
  const activeTenants = new Set<string>();

  for (const m of messages) {
    const status = m.status ?? "pending";
    byStatus[status] = (byStatus[status] ?? 0) + 1;

    const day = istDay(m.created_at);
    if (day) totalsByDay.set(day, (totalsByDay.get(day) ?? 0) + 1);

    if (!m.user_id) continue;
    activeTenants.add(m.user_id);
    const agg = perTenant.get(m.user_id) ?? { sent: 0, delivered: 0, read: 0, failed: 0 };
    agg.sent += 1;
    // delivered/read are terminal states above 'sent' — a read message was also
    // delivered, so count it in both for an honest delivery rate.
    if (status === "delivered" || status === "read") agg.delivered += 1;
    if (status === "read") agg.read += 1;
    if (status === "failed") agg.failed += 1;
    perTenant.set(m.user_id, agg);
  }

  const prevActiveTenants = new Set<string>();
  for (const r of prevSenderRows) if (r.user_id) prevActiveTenants.add(r.user_id);

  // ── Category mix + margin ──────────────────────────────────────────────────
  const catByDay = new Map<string, Record<Category, number>>();
  let messageMarginPaise = 0;
  let messageChargedPaise = 0;
  let messageWholesalePaise = 0;
  let marginTrackedCount = 0;

  for (const b of billed) {
    const day = istDay(b.created_at);
    if (day) {
      const bucket = catByDay.get(day) ?? { marketing: 0, utility: 0, authentication: 0, service: 0 };
      const raw = (b.category ?? "").toLowerCase();
      const cat = (CATEGORIES as string[]).includes(raw) ? (raw as Category) : "service";
      bucket[cat] += 1;
      catByDay.set(day, bucket);
    }
    // Margin only counts money that actually settled — a released hold was
    // never charged, so folding it in would inflate revenue.
    if (b.status !== "settled") continue;
    const charged = num(b.cost_paise);
    messageChargedPaise += charged;
    if (b.wholesale_paise !== null && b.wholesale_paise !== undefined) {
      messageWholesalePaise += num(b.wholesale_paise);
      messageMarginPaise += charged - num(b.wholesale_paise);
      marginTrackedCount += 1;
    }
  }

  // Dense day axis — a day with no sends must render as 0, not as a gap.
  const series = [];
  for (let i = days - 1; i >= 0; i--) {
    const day = new Date(now - i * 24 * 60 * 60 * 1000 + IST_OFFSET_MS).toISOString().slice(0, 10);
    const cats = catByDay.get(day) ?? { marketing: 0, utility: 0, authentication: 0, service: 0 };
    series.push({
      date: day,
      ...cats,
      billed: cats.marketing + cats.utility + cats.authentication + cats.service,
      total: totalsByDay.get(day) ?? 0,
    });
  }

  // ── MRR (current vs. what it was before this window's signups) ──────────────
  let mrrPaise = 0;
  let prevMrrPaise = 0;
  let unpricedSubs = 0;
  let payingSubs = 0;
  for (const s of subs) {
    const fee = monthlyPaise(s.plan_id);
    // A plan we can't price is NOT worth ₹0 — it's unknown. Surface the count so
    // MRR is never quietly under-reported as if those tenants pay nothing.
    if (fee === null) { unpricedSubs += 1; continue; }
    if (fee > 0) payingSubs += 1;
    mrrPaise += fee;
    if (createdBefore(s.created_at)) prevMrrPaise += fee;
  }

  // ── Top tenants by volume ──────────────────────────────────────────────────
  const usersById = new Map(users.map((u) => [u.id, u]));
  const tenantRows: [string, { sent: number; delivered: number; read: number; failed: number }][] = [];
  perTenant.forEach((agg, id) => tenantRows.push([id, agg]));
  const topTenants = tenantRows
    .sort((a, b) => b[1].sent - a[1].sent)
    .slice(0, 8)
    .map(([id, agg]) => {
      const u = usersById.get(id);
      return {
        id,
        name: u?.company_name || u?.full_name || u?.email || "Unknown tenant",
        email: u?.email ?? "",
        industry: u?.vertical_id ? verticalNames[u.vertical_id] ?? "—" : "—",
        tier: u?.tier ?? "enterprise",
        billingMode: u?.billing_mode ?? "byo",
        sent: agg.sent,
        deliveredPct: agg.sent ? Math.round((agg.delivered / agg.sent) * 1000) / 10 : 0,
        readPct: agg.sent ? Math.round((agg.read / agg.sent) * 1000) / 10 : 0,
        failed: agg.failed,
      };
    });

  const prevOwners = users.length - newTenants;

  return NextResponse.json({
    overview: {
      generatedAt: new Date(now).toISOString(),
      days,
      tenants: {
        total: users.length,
        active: activeTenants.size,
        newInPeriod: newTenants,
        byTier,
      },
      people: { tenantOwners: users.length, seats, total: users.length + seats },
      numbers: { total: numbersTotal, active: numbersActive },
      messages: {
        allTime: messagesAllTime,
        period: messages.length,
        byStatus,
        series,
      },
      revenue: {
        mrrPaise,
        activeSubscriptions: subs.length,
        payingSubscriptions: payingSubs,
        unpricedSubscriptions: unpricedSubs,
        platformFeesPaise,
        topupPaise,
        messageMarginPaise,
        messageChargedPaise,
        messageWholesalePaise,
        marginTrackedCount,
        walletFloatPaise,
      },
      // null = not computable from what we store; the UI renders no chip.
      deltas: {
        tenants: pctChange(users.length, prevOwners),
        activeTenants: pctChange(activeTenants.size, prevActiveTenants.size),
        people: pctChange(users.length + seats, prevOwners + prevSeats),
        numbers: pctChange(numbersTotal, prevNumbers),
        mrr: pctChange(mrrPaise, prevMrrPaise),
        messages: pctChange(messages.length, prevMessageCount),
      },
      ai: {
        requests: ai.requests,
        costPaise: ai.costPaise,
        creditsDeducted: ai.credits,
        nonOk: ai.failed,
      },
      campaigns: { active: campaignsActive },
      topTenants,
      health,
      warnings,
    },
  });
}
