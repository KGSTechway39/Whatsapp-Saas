/**
 * Admin: one vertical — the preview panel's content, and its catalogue state.
 *
 *   GET   → { vertical, flows, campaignPrompts, messageTemplates }
 *   PATCH → { vertical }   activate/deactivate, rename, re-icon, reorder
 *
 * Platform staff only (requirePlatformStaff: super_admin or tenant_admin).
 */
import { NextRequest, NextResponse } from "next/server";
import { requirePlatformStaff } from "@/lib/roles";
import { audit } from "@/lib/audit";
import { createServiceClient } from "@/lib/supabase/server";
import { getVerticalWithLibrary } from "@/lib/verticals/repository";
import { firstMessageOf, flowStepCount } from "@/lib/verticals/preview";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const admin = await requirePlatformStaff();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const data = await getVerticalWithLibrary(params.id);
  if (!data) return NextResponse.json({ error: "That industry no longer exists." }, { status: 404 });

  return NextResponse.json({
    vertical: data.vertical,
    // Flows carry the first message + step count so the preview can show the
    // customer's bubble and label multi-step flows honestly, without ever
    // sending flow JSON to the browser.
    flows: data.flows.map((f) => ({
      id: f.id,
      title: f.title,
      description: f.description,
      outcome: f.outcome,
      adminNote: f.adminNote,
      firstMessage: firstMessageOf(f.payload.flow),
      steps: flowStepCount(f.payload.flow),
      collectsBooking: Boolean(f.payload.bookingContext),
    })),
    campaignPrompts: data.campaignPrompts.map((p) => ({
      id: p.id,
      title: p.title,
      description: p.description,
      outcome: p.outcome,
      adminNote: p.adminNote,
      prompt: p.payload.prompt,
    })),
    messageTemplates: data.messageTemplates.map((t) => ({
      id: t.id,
      title: t.title,
      description: t.description,
      outcome: t.outcome,
      adminNote: t.adminNote,
      metaCategory: t.metaCategory,
      body: t.payload.body,
      footer: t.payload.footer ?? null,
    })),
  });
}

/**
 * Catalogue state, not content.
 *
 * Deactivating is deliberately NOT a delete: `is_active=false` hides an
 * industry from the picker while every tenant already on it keeps their flows,
 * prompts and templates untouched (026's ON DELETE SET NULL exists for the
 * same reason). There is no destructive verb here on purpose — removing an
 * industry that tenants are live on is not an admin-screen-sized decision.
 */
export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const admin = await requirePlatformStaff();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await request.json().catch(() => ({}));
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };

  if (body.isActive !== undefined) patch.is_active = Boolean(body.isActive);
  if (body.displayName !== undefined) {
    const name = String(body.displayName).trim();
    if (!name) return NextResponse.json({ error: "displayName cannot be empty" }, { status: 400 });
    patch.display_name = name;
  }
  if (body.description !== undefined) patch.description = String(body.description);
  if (body.icon !== undefined) patch.icon = body.icon ? String(body.icon) : null;
  if (body.sortOrder !== undefined) patch.sort_order = Number(body.sortOrder) || 0;

  if (Object.keys(patch).length === 1) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("industry_verticals")
    .update(patch)
    .eq("id", params.id)
    .select("id, slug, display_name, description, icon, is_active, sort_order, is_builtin")
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "That industry no longer exists." }, { status: 404 });

  const row = data as {
    id: string; slug: string; display_name: string; description: string;
    icon: string | null; is_active: boolean; sort_order: number; is_builtin: boolean;
  };

  await audit({
    action: "vertical.update",
    userId: admin.id,
    resourceType: "industry_verticals",
    resourceId: params.id,
    request,
    details: { slug: row.slug, ...patch },
  });

  return NextResponse.json({
    vertical: {
      id: row.id,
      slug: row.slug,
      displayName: row.display_name,
      description: row.description,
      icon: row.icon,
      isActive: row.is_active,
      sortOrder: row.sort_order,
      isBuiltin: row.is_builtin,
    },
  });
}
