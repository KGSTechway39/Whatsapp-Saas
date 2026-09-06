/**
 * Admin: the tenant directory — every tenant with the two things an admin acts
 * on (industry and tier), searchable and filterable.
 *
 *   GET  ?q=&vertical=&tier=&page=&limit=  → { clients, total, page, pages, verticals }
 *   POST { userIds: string[], verticalId: string|null } → bulk industry assign
 *
 * WHY THIS EXISTS: assigning a client to an industry was already possible
 * (/api/admin/clients/[id]/vertical), but only if you already knew the client's
 * id. There was no way to LIST tenants, so the capability was unreachable
 * without an email lookup. This is the discovery layer.
 *
 * This is a legitimate cross-tenant read — the platform owner is not a tenant.
 * It stays admin-gated and returns only what an operator needs to route work:
 * no message bodies, no contacts, no access tokens.
 *
 * Reads the LEGACY user_id model, which is what production runs.
 *
 * Platform staff only (requirePlatformStaff: super_admin or tenant_admin).
 */
import { NextRequest, NextResponse } from "next/server";
import { requirePlatformStaff } from "@/lib/roles";
import { audit } from "@/lib/audit";
import { createServiceClient } from "@/lib/supabase/server";
import { listVerticals, setVerticalForUser } from "@/lib/verticals/repository";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

/** Cap on the per-tenant enrichment pulls (numbers/wallet are one row each). */
const ENRICH_CAP = 5_000;
/** Bulk assign ceiling — a mis-click should not repaint the whole platform. */
const BULK_MAX = 100;

interface UserRow {
  id: string;
  email: string;
  full_name: string | null;
  company_name: string | null;
  tier: string | null;
  billing_mode: string | null;
  waba_mode: string | null;
  vertical_id: string | null;
  created_at: string | null;
}

export async function GET(request: NextRequest) {
  const admin = await requirePlatformStaff();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const sp = request.nextUrl.searchParams;
  const q = sp.get("q")?.trim() || "";
  const vertical = sp.get("vertical")?.trim() || "";
  const tier = sp.get("tier")?.trim() || "";
  const page = Math.max(1, Number(sp.get("page")) || 1);
  const limit = Math.min(Number(sp.get("limit")) || 25, 100);
  const from = (page - 1) * limit;

  const supabase = createServiceClient();

  let query = supabase
    .from("users")
    .select(
      "id, email, full_name, company_name, tier, billing_mode, waba_mode, vertical_id, created_at",
      { count: "exact" },
    );

  if (q) query = query.or(`email.ilike.%${q}%,full_name.ilike.%${q}%,company_name.ilike.%${q}%`);
  if (tier) query = query.eq("tier", tier);
  // 'none' is a first-class filter, not an absence of one: "who still needs an
  // industry?" is the question this screen exists to answer.
  if (vertical === "none") query = query.is("vertical_id", null);
  else if (vertical) query = query.eq("vertical_id", vertical);

  const { data, error, count } = await query
    .order("created_at", { ascending: false })
    .range(from, from + limit - 1);

  if (error) {
    logger.warn("admin.clients: list failed", { error: error.message });
    return NextResponse.json({ error: "We couldn't load tenants. Please try again." }, { status: 500 });
  }

  const rows = (data ?? []) as UserRow[];
  const ids = rows.map((r) => r.id);

  // Catalogue for the filter + the industry column. Never hardcode these names.
  const verticals = await listVerticals({ includeInactive: true });
  const vMap = new Map(verticals.map((v) => [v.id, v]));

  // Enrich the page only — one round-trip each, scoped to the ids on screen.
  const numbersByUser = new Map<string, number>();
  const balanceByUser = new Map<string, number>();
  if (ids.length > 0) {
    const [{ data: nums }, { data: wallets }] = await Promise.all([
      supabase.from("whatsapp_numbers").select("user_id").in("user_id", ids).limit(ENRICH_CAP),
      supabase.from("wallet").select("user_id, balance_paise").in("user_id", ids).limit(ENRICH_CAP),
    ]);
    for (const n of (nums ?? []) as { user_id: string }[]) {
      numbersByUser.set(n.user_id, (numbersByUser.get(n.user_id) ?? 0) + 1);
    }
    for (const w of (wallets ?? []) as { user_id: string; balance_paise: number }[]) {
      balanceByUser.set(w.user_id, Number(w.balance_paise) || 0);
    }
  }

  return NextResponse.json({
    clients: rows.map((r) => {
      const v = r.vertical_id ? vMap.get(r.vertical_id) : null;
      return {
        id: r.id,
        email: r.email,
        name: r.company_name || r.full_name || r.email,
        tier: r.tier ?? "enterprise",
        billingMode: r.billing_mode ?? "byo",
        wabaMode: r.waba_mode ?? "own",
        // null is a real state — "no industry track" — not an unconfigured one.
        vertical: v ? { id: v.id, slug: v.slug, displayName: v.displayName, icon: v.icon, isActive: v.isActive } : null,
        numbers: numbersByUser.get(r.id) ?? 0,
        // MONEY REDACTION. tenant_admin runs setup and needs to know whether a
        // wallet is funded (go-live check 6) — but never the amount, per the
        // role boundary. Super admin gets the figure; everyone else gets the
        // boolean the checklist actually needs. The redaction is server-side:
        // the amount never reaches the browser to be un-hidden.
        balancePaise: admin.canSeeMoney ? (balanceByUser.get(r.id) ?? 0) : null,
        walletFunded: (balanceByUser.get(r.id) ?? 0) > 0,
        createdAt: r.created_at,
      };
    }),
    total: count ?? 0,
    page,
    pages: Math.max(1, Math.ceil((count ?? 0) / limit)),
    verticals: verticals.map((v) => ({
      id: v.id,
      slug: v.slug,
      displayName: v.displayName,
      icon: v.icon,
      isActive: v.isActive,
    })),
  });
}

/**
 * Bulk industry assign.
 *
 * Same one-column write as the single-tenant route, repeated — assigning an
 * industry never touches a client's own flows, campaigns or templates, so doing
 * it for twenty tenants is exactly as non-destructive as doing it for one.
 *
 * Partial success is reported honestly rather than rolled back: if 18 of 20
 * succeed, those 18 ARE assigned, and pretending otherwise would send an admin
 * to re-do work that is already done.
 */
export async function POST(request: NextRequest) {
  const admin = await requirePlatformStaff();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await request.json().catch(() => ({}));
  const userIds: string[] = Array.isArray(body.userIds) ? body.userIds.filter(Boolean) : [];
  const verticalId: string | null = body.verticalId ?? null;

  if (userIds.length === 0) {
    return NextResponse.json({ error: "Select at least one tenant." }, { status: 400 });
  }
  if (userIds.length > BULK_MAX) {
    return NextResponse.json(
      { error: `That's ${userIds.length} tenants — the limit is ${BULK_MAX} at a time.` },
      { status: 400 },
    );
  }

  const assigned: string[] = [];
  const failed: { id: string; error: string }[] = [];
  for (const id of userIds) {
    try {
      await setVerticalForUser(id, verticalId);
      assigned.push(id);
    } catch (err) {
      failed.push({ id, error: (err as Error).message });
    }
  }

  await audit({
    action: "vertical.assign",
    userId: admin.id,
    resourceType: "users",
    // No single resource id on a bulk action — the ids live in details.
    request,
    outcome: failed.length > 0 && assigned.length === 0 ? "failure" : "success",
    details: {
      bulk: true,
      vertical_id: verticalId,
      assigned_count: assigned.length,
      assigned_ids: assigned,
      failed_count: failed.length,
      failed,
    },
  });

  return NextResponse.json({ assigned: assigned.length, failed });
}
