/**
 * Admin: seed / re-seed the industry vertical library (platform-owner only).
 *
 *   GET  → dry run. Validates all shipped seed content, writes nothing.
 *   POST → validates, then upserts verticals + their content. Idempotent.
 *
 * Runs the same `sanitizeFlowGraph` the canvas builder uses, so a flow that could
 * not be opened by a client can never be written in the first place.
 *
 * Platform staff only (requirePlatformStaff: super_admin or tenant_admin).
 */
import { NextResponse } from "next/server";
import { requirePlatformStaff } from "@/lib/roles";
import { seedVerticals, validateAllSeedData } from "@/lib/verticals/seeder";
import { SEED_VERTICALS } from "@/lib/verticals/seed-data";

export async function GET() {
  const admin = await requirePlatformStaff();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const errors = validateAllSeedData();
  return NextResponse.json({
    ok: errors.length === 0,
    verticals: SEED_VERTICALS.map((v) => ({
      slug: v.slug,
      displayName: v.displayName,
      flows: v.items.filter((i) => i.kind === "FLOW_JSON").length,
      campaignPrompts: v.items.filter((i) => i.kind === "CAMPAIGN_PROMPT").length,
      messageTemplates: v.items.filter((i) => i.kind === "MESSAGE_TEMPLATE").length,
    })),
    errors,
  });
}

export async function POST() {
  const admin = await requirePlatformStaff();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const report = await seedVerticals();
  if (report.errors.length && report.itemsUpserted === 0) {
    return NextResponse.json({ ok: false, ...report }, { status: 422 });
  }
  return NextResponse.json({ ok: true, ...report });
}
