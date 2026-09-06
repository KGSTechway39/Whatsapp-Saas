/**
 * Admin: the audit trail.
 *
 *   GET ?action=&outcome=&actor=&resourceType=&days=&q=&page=&limit=
 *       → { entries, total, page, pages, actions, actors }
 *
 * This is the record of who did what to whom — rate changes, tier changes,
 * token rotations, support actions. It is READ-ONLY by design: there is no
 * POST/PATCH/DELETE here and there never should be. An audit log an admin can
 * edit is not an audit log, and `audit_logs` is append-only from
 * lib/audit.ts alone.
 *
 * Platform staff only (requirePlatformStaff: super_admin or tenant_admin).
 */
import { NextRequest, NextResponse } from "next/server";
import { requirePlatformStaff } from "@/lib/roles";
import { createServiceClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/** Distinct-value scan cap — enough to populate filters without a full scan. */
const FACET_CAP = 2_000;

interface Row {
  id: string;
  user_id: string | null;
  action: string;
  resource_type: string | null;
  resource_id: string | null;
  ip_address: string | null;
  user_agent: string | null;
  outcome: string;
  details: Record<string, unknown> | null;
  created_at: string;
}

export async function GET(request: NextRequest) {
  const admin = await requirePlatformStaff();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const sp = request.nextUrl.searchParams;
  const action = sp.get("action")?.trim() || "";
  const outcome = sp.get("outcome")?.trim() || "";
  const actor = sp.get("actor")?.trim() || "";
  const resourceType = sp.get("resourceType")?.trim() || "";
  const q = sp.get("q")?.trim() || "";
  const days = Number(sp.get("days")) || 0;
  const page = Math.max(1, Number(sp.get("page")) || 1);
  const limit = Math.min(Number(sp.get("limit")) || 50, 200);
  const from = (page - 1) * limit;

  const supabase = createServiceClient();

  let query = supabase
    .from("audit_logs")
    .select("id, user_id, action, resource_type, resource_id, ip_address, user_agent, outcome, details, created_at",
            { count: "exact" });

  if (action) query = query.eq("action", action);
  if (outcome) query = query.eq("outcome", outcome);
  if (actor) query = query.eq("user_id", actor);
  if (resourceType) query = query.eq("resource_type", resourceType);
  if (days > 0) {
    query = query.gte("created_at", new Date(Date.now() - days * 86_400_000).toISOString());
  }
  // Free-text lands on the two columns that identify a specific object; the
  // details JSONB is deliberately not searched (no index would serve it, and a
  // sequential scan over every audit row is not worth it here).
  if (q) query = query.or(`resource_id.ilike.%${q}%,action.ilike.%${q}%`);

  const { data, error, count } = await query
    .order("created_at", { ascending: false })
    .range(from, from + limit - 1);

  if (error) {
    // Soft-fail so the screen renders an explanation instead of a blank 500 —
    // audit_logs may predate a given environment.
    return NextResponse.json({
      entries: [], total: 0, page, pages: 0, actions: [], actors: [],
      warning: error.message,
    });
  }

  const rows = (data ?? []) as Row[];

  // Resolve actor ids → emails in ONE extra query rather than an embed:
  // audit_logs.user_id is ON DELETE SET NULL, so an actor may no longer exist
  // and a join would silently drop those rows. Losing history because the
  // admin who caused it was deleted would defeat the point of the log.
  const actorIds = Array.from(new Set(rows.map((r) => r.user_id).filter((v): v is string => Boolean(v))));
  const actorMap = new Map<string, { email: string; name: string | null }>();
  if (actorIds.length > 0) {
    const { data: people } = await supabase
      .from("users")
      .select("id, email, full_name")
      .in("id", actorIds);
    for (const p of (people ?? []) as { id: string; email: string; full_name: string | null }[]) {
      actorMap.set(p.id, { email: p.email, name: p.full_name });
    }
  }

  // Filter facets, from a recent slice rather than the whole table.
  const { data: facetRows } = await supabase
    .from("audit_logs")
    .select("action, user_id")
    .order("created_at", { ascending: false })
    .limit(FACET_CAP);

  const actionSet = new Set<string>();
  const facetActorIds = new Set<string>();
  for (const f of (facetRows ?? []) as { action: string; user_id: string | null }[]) {
    actionSet.add(f.action);
    if (f.user_id) facetActorIds.add(f.user_id);
  }

  const facetActorList: { id: string; email: string }[] = [];
  const unknownFacetIds = Array.from(facetActorIds).filter((id) => !actorMap.has(id));
  if (unknownFacetIds.length > 0) {
    const { data: more } = await supabase
      .from("users")
      .select("id, email")
      .in("id", unknownFacetIds.slice(0, 100));
    for (const p of (more ?? []) as { id: string; email: string }[]) {
      actorMap.set(p.id, { email: p.email, name: null });
    }
  }
  facetActorIds.forEach((id) => {
    const a = actorMap.get(id);
    if (a) facetActorList.push({ id, email: a.email });
  });

  return NextResponse.json({
    entries: rows.map((r) => {
      const a = r.user_id ? actorMap.get(r.user_id) : undefined;
      return {
        id: r.id,
        at: r.created_at,
        action: r.action,
        outcome: r.outcome,
        resourceType: r.resource_type,
        resourceId: r.resource_id,
        ip: r.ip_address,
        userAgent: r.user_agent,
        details: r.details ?? {},
        actorId: r.user_id,
        // A deleted actor still has an id on the row — say so rather than
        // rendering an empty cell that reads as "nobody did this".
        actor: a?.name || a?.email || (r.user_id ? "Deleted user" : "System"),
        actorEmail: a?.email ?? null,
      };
    }),
    total: count ?? 0,
    page,
    pages: Math.max(1, Math.ceil((count ?? 0) / limit)),
    actions: Array.from(actionSet).sort(),
    actors: facetActorList.sort((x, y) => x.email.localeCompare(y.email)),
  });
}
