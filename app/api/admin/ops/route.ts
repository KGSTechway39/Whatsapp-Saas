/**
 * Admin: operational health for the Tenant Admin (support & ops) console.
 *
 *   GET ?hours=24|72|168  → { ops }        (403 for non-admins)
 *
 * Deliberately carries NO revenue or margin data. This console is for the
 * support/ops role — who is stuck, what is failing, what needs a human — and
 * mixing money into it would put financials in front of everyone doing
 * support. Money lives in /api/admin/overview.
 *
 * Same rules as the overview route: admin-gated, aggregate-only, every section
 * soft-fails to zeros plus a `warnings` entry rather than 500-ing, and the
 * round-trip count is kept low because this Supabase tier serialises requests.
 *
 * Reads the LEGACY user_id model — see "Deployment reality" in CLAUDE.md.
 */
import { NextRequest, NextResponse } from "next/server";
import { requirePlatformStaff } from "@/lib/roles";
import { createServiceClient } from "@/lib/supabase/server";
import { platformHealth } from "@/lib/admin/health";

export const dynamic = "force-dynamic";

const ROW_CAP = 50_000;

/** IST bucket — the market is India, so an "hour" is Asia/Kolkata. */
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

function pctChange(current: number, previous: number): number | null {
  if (previous <= 0) return null;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}

export async function GET(request: NextRequest) {
  const admin = await requirePlatformStaff();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const hoursParam = Number(request.nextUrl.searchParams.get("hours"));
  const hours = [24, 72, 168].includes(hoursParam) ? hoursParam : 24;

  const supabase = createServiceClient();
  const now = Date.now();
  const windowMs = hours * 60 * 60 * 1000;
  const sinceIso = new Date(now - windowMs).toISOString();
  const prevSinceIso = new Date(now - 2 * windowMs).toISOString();
  const warnings: string[] = [];

  async function safe<T>(label: string, run: () => Promise<T>, fallback: T): Promise<T> {
    try {
      return await run();
    } catch (err) {
      warnings.push(`${label}: ${(err as Error).message}`);
      return fallback;
    }
  }

  interface MsgRow {
    user_id: string | null;
    status: string | null;
    created_at: string | null;
  }
  interface ApiRow {
    created_at: string | null;
    status: string | null;
  }
  interface TicketRow {
    id: string;
    subject: string;
    category: string;
    priority: string;
    status: string;
    created_at: string;
    user_id: string;
    users: { email: string; full_name: string | null; company_name: string | null } | null;
  }

  const [messages, prevMessages, apiRows, prevApiCount, numberRows, tickets, ticketCounts, events, health] =
    await Promise.all([
      // Outbound traffic across the window — drives active tenants, failures
      // and the hourly curve in one pull.
      safe<MsgRow[]>(
        "messages",
        async () => {
          const { data, error } = await supabase
            .from("messages")
            .select("user_id, status, created_at")
            .eq("direction", "outbound")
            .gte("created_at", sinceIso)
            .limit(ROW_CAP);
          if (error) throw new Error(error.message);
          return (data ?? []) as MsgRow[];
        },
        [],
      ),

      safe<MsgRow[]>(
        "messages",
        async () => {
          const { data, error } = await supabase
            .from("messages")
            .select("user_id, status, created_at")
            .eq("direction", "outbound")
            .gte("created_at", prevSinceIso)
            .lt("created_at", sinceIso)
            .limit(ROW_CAP);
          if (error) throw new Error(error.message);
          return (data ?? []) as MsgRow[];
        },
        [],
      ),

      // Public API v1 traffic. This is API *messages*, the only API activity
      // that is persisted — it is NOT a count of every HTTP call, and the UI
      // labels it accordingly.
      safe<ApiRow[]>(
        "api_messages",
        async () => {
          const { data, error } = await supabase
            .from("api_messages")
            .select("created_at, status")
            .gte("created_at", sinceIso)
            .limit(ROW_CAP);
          if (error) throw new Error(error.message);
          return (data ?? []) as ApiRow[];
        },
        [],
      ),

      safe<number>(
        "api_messages",
        async () => {
          const { count, error } = await supabase
            .from("api_messages")
            .select("id", { count: "exact", head: true })
            .gte("created_at", prevSinceIso)
            .lt("created_at", sinceIso);
          if (error) throw new Error(error.message);
          return count ?? 0;
        },
        0,
      ),

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

      // The triage queue: everything still actionable, worst first.
      safe<TicketRow[]>(
        "support_tickets",
        async () => {
          const { data, error } = await supabase
            .from("support_tickets")
            // FK named explicitly — support_tickets has three FKs to users
            // (user_id, assigned_to, created_by), so a bare embed is ambiguous.
            .select("id, subject, category, priority, status, created_at, user_id, users!support_tickets_user_id_fkey(email, full_name, company_name)")
            .in("status", ["open", "in_progress", "waiting"])
            .order("created_at", { ascending: false })
            .limit(50);
          if (error) throw new Error(error.message);
          return (data ?? []) as unknown as TicketRow[];
        },
        [],
      ),

      // Status mix across ALL tickets, for the counters.
      safe<{ status: string; priority: string; resolved_at: string | null }[]>(
        "support_tickets",
        async () => {
          const { data, error } = await supabase
            .from("support_tickets")
            .select("status, priority, resolved_at")
            .limit(ROW_CAP);
          if (error) throw new Error(error.message);
          return (data ?? []) as { status: string; priority: string; resolved_at: string | null }[];
        },
        [],
      ),

      // Raw ingest feed. Tenant attribution would mean traversing Meta's
      // nested payload to a phone_number_id on every row, so this shows what
      // the inbox actually knows: route, outcome, and error.
      safe<{ id: string; source: string; route: string | null; status: string; error: string | null; received_at: string }[]>(
        "webhook_inbox",
        async () => {
          const { data, error } = await supabase
            .from("webhook_inbox")
            .select("id, source, route, status, error, received_at")
            .order("received_at", { ascending: false })
            .limit(12);
          if (error) throw new Error(error.message);
          return (data ?? []) as never;
        },
        [],
      ),

      platformHealth(supabase, now),
    ]);

  // ── Message-derived metrics ────────────────────────────────────────────────
  const activeTenants = new Set<string>();
  const prevActiveTenants = new Set<string>();
  let failed = 0;
  let prevFailed = 0;

  const bucketMs = hours <= 24 ? 60 * 60 * 1000 : 24 * 60 * 60 * 1000; // hourly, or daily for longer windows
  const buckets = Math.round(windowMs / bucketMs);
  const msgByBucket = new Map<number, number>();
  const apiByBucket = new Map<number, number>();

  const bucketOf = (iso: string | null): number | null => {
    if (!iso) return null;
    const t = Date.parse(iso);
    if (Number.isNaN(t)) return null;
    const idx = Math.floor((t - (now - windowMs)) / bucketMs);
    return idx >= 0 && idx < buckets ? idx : null;
  };

  for (const m of messages) {
    if (m.user_id) activeTenants.add(m.user_id);
    if (m.status === "failed") failed += 1;
    const b = bucketOf(m.created_at);
    if (b !== null) msgByBucket.set(b, (msgByBucket.get(b) ?? 0) + 1);
  }
  for (const m of prevMessages) {
    if (m.user_id) prevActiveTenants.add(m.user_id);
    if (m.status === "failed") prevFailed += 1;
  }
  for (const a of apiRows) {
    const b = bucketOf(a.created_at);
    if (b !== null) apiByBucket.set(b, (apiByBucket.get(b) ?? 0) + 1);
  }

  // Dense axis — a quiet hour must plot as 0, not vanish.
  const series = [];
  for (let i = 0; i < buckets; i++) {
    const at = now - windowMs + i * bucketMs;
    const ist = new Date(at + IST_OFFSET_MS);
    series.push({
      label: bucketMs === 60 * 60 * 1000
        ? `${String(ist.getUTCHours()).padStart(2, "0")}:00`
        : ist.toISOString().slice(5, 10),
      messages: msgByBucket.get(i) ?? 0,
      apiMessages: apiByBucket.get(i) ?? 0,
    });
  }

  // ── Tickets ────────────────────────────────────────────────────────────────
  const ticketsByStatus: Record<string, number> = {
    open: 0, in_progress: 0, waiting: 0, resolved: 0, closed: 0,
  };
  let urgentOpen = 0;
  for (const t of ticketCounts) {
    ticketsByStatus[t.status] = (ticketsByStatus[t.status] ?? 0) + 1;
    if ((t.priority === "urgent" || t.priority === "high") && t.status !== "resolved" && t.status !== "closed") {
      urgentOpen += 1;
    }
  }
  const openTickets = ticketsByStatus.open + ticketsByStatus.in_progress + ticketsByStatus.waiting;

  const numbersTotal = numberRows.length;
  const numbersActive = numberRows.filter((n) => n.status === "active").length;
  const apiFailed = apiRows.filter((a) => a.status === "failed").length;

  return NextResponse.json({
    ops: {
      generatedAt: new Date(now).toISOString(),
      hours,
      kpis: {
        activeTenants: activeTenants.size,
        connectedNumbers: numbersTotal,
        activeNumbers: numbersActive,
        apiMessages: apiRows.length,
        apiFailed,
        failedMessages: failed,
        totalMessages: messages.length,
        openTickets,
        urgentOpen,
      },
      // null = no prior-window baseline; the UI renders no chip rather than
      // inventing a trend.
      deltas: {
        activeTenants: pctChange(activeTenants.size, prevActiveTenants.size),
        apiMessages: pctChange(apiRows.length, prevApiCount),
        failedMessages: pctChange(failed, prevFailed),
        messages: pctChange(messages.length, prevMessages.length),
      },
      series,
      tickets: tickets.map((t) => ({
        id: t.id,
        subject: t.subject,
        category: t.category,
        priority: t.priority,
        status: t.status,
        createdAt: t.created_at,
        userId: t.user_id,
        tenant: t.users?.company_name || t.users?.full_name || t.users?.email || "Unknown tenant",
        tenantEmail: t.users?.email ?? "",
      })),
      ticketsByStatus,
      events: events.map((e) => ({
        id: e.id,
        source: e.source,
        route: e.route,
        status: e.status,
        error: e.error,
        receivedAt: e.received_at,
      })),
      health,
      warnings,
    },
  });
}
