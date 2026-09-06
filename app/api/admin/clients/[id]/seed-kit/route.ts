/**
 * Admin: a tenant's industry seed kit — what's on offer, and adopting it.
 *
 *   GET                     → { offer }    items for their industry + adopted state
 *   POST { itemIds: [...] } → { results }  copy chosen items into their own records
 *
 * Copies, never links: every adopted item becomes a row the tenant owns and can
 * edit without affecting the shared kit or any other tenant.
 *
 * Generic by construction — this route names no industry. Adding a vertical is
 * rows in vertical_template_library, not a change here.
 *
 * Platform staff only (super_admin or tenant_admin).
 */
import { NextRequest, NextResponse } from "next/server";
import { requirePlatformStaff } from "@/lib/roles";
import { audit } from "@/lib/audit";
import { getSeedOffer, adoptSeedItems } from "@/lib/verticals/seed-service";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const actor = await requirePlatformStaff();
  if (!actor) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    return NextResponse.json({ offer: await getSeedOffer(params.id) });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const actor = await requirePlatformStaff();
  if (!actor) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await request.json().catch(() => ({}));
  const itemIds: string[] = Array.isArray(body.itemIds) ? body.itemIds.filter(Boolean) : [];
  if (itemIds.length === 0) {
    return NextResponse.json({ error: "Select at least one item to add." }, { status: 400 });
  }

  try {
    const results = await adoptSeedItems(params.id, itemIds);
    const adopted = results.filter((r) => r.status === "adopted").length;
    const failed = results.filter((r) => r.status === "failed").length;

    await audit({
      action: "vertical.seed_adopt",
      userId: actor.id,
      resourceType: "users",
      resourceId: params.id,
      request,
      outcome: failed > 0 && adopted === 0 ? "failure" : "success",
      details: { requested: itemIds.length, adopted, failed, results },
    });

    // Per-item outcomes, so a partial success is visible as one.
    return NextResponse.json({ results, adopted, failed });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}
