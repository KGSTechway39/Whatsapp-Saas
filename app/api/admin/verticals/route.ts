/**
 * Admin: the industry vertical catalogue (platform-owner only).
 *
 *   GET  → { verticals: [...] }   every vertical + how much content each has
 *   POST → creates a new vertical from the guided seed-kit form
 *
 * The POST body is PLAIN-LANGUAGE admin input, never flow JSON. The server
 * assembles the graphs (lib/verticals/flow-builders.ts) and runs them through the
 * same validation the shipped seed content passes, so an admin can add "Gym" or
 * "Travel Agency" without engineering — and without being able to author a flow
 * the canvas cannot open.
 *
 * Platform staff only (requirePlatformStaff: super_admin or tenant_admin).
 */
import { NextRequest, NextResponse } from "next/server";
import { requirePlatformStaff } from "@/lib/roles";
import { createServiceClient } from "@/lib/supabase/server";
import { listVerticals } from "@/lib/verticals/repository";
import { buildBookingFlow, buildStatusFlow } from "@/lib/verticals/flow-builders";
import { validateSeedItem } from "@/lib/verticals/validate-seed";
import { VerticalSeedError } from "@/lib/verticals/validate";
import type { SeedItem, SeedVertical } from "@/lib/verticals/seed-data";
import type { MetaTemplateCategory } from "@/lib/verticals/types";

export async function GET() {
  const admin = await requirePlatformStaff();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const verticals = await listVerticals({ includeInactive: true });
  const supabase = createServiceClient();
  const { data: items } = await supabase
    .from("vertical_template_library")
    .select("vertical_id, kind")
    .eq("is_active", true);

  const counts = new Map<string, { flows: number; campaignPrompts: number; messageTemplates: number }>();
  for (const row of (items ?? []) as { vertical_id: string; kind: string }[]) {
    const c = counts.get(row.vertical_id) ?? { flows: 0, campaignPrompts: 0, messageTemplates: 0 };
    if (row.kind === "FLOW_JSON") c.flows++;
    else if (row.kind === "CAMPAIGN_PROMPT") c.campaignPrompts++;
    else c.messageTemplates++;
    counts.set(row.vertical_id, c);
  }

  return NextResponse.json({
    verticals: verticals.map((v) => ({
      ...v,
      counts: counts.get(v.id) ?? { flows: 0, campaignPrompts: 0, messageTemplates: 0 },
    })),
  });
}

// ─── Guided seed-kit form ───────────────────────────────────────────────────

interface SeedKitBody {
  displayName: string;
  description: string;
  icon?: string;
  bookingFlow: { title: string; description: string; outcome: string; keywords: string; askMessage: string };
  statusFlow: { title: string; description: string; outcome: string; keywords: string; notifyMessage: string };
  campaignPrompt: { title: string; description: string; outcome: string; prompt: string };
  templates: {
    title: string;
    description: string;
    outcome: string;
    body: string;
    footer?: string;
    variableNames: string[];
    metaCategory: MetaTemplateCategory;
  }[];
}

const slugify = (name: string) =>
  name.toLowerCase().trim().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40);

const splitKeywords = (kw: string) => kw.split(",").map((k) => k.trim()).filter(Boolean);

export async function POST(req: NextRequest) {
  const admin = await requirePlatformStaff();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  let body: SeedKitBody;
  try {
    body = (await req.json()) as SeedKitBody;
  } catch {
    return NextResponse.json({ error: "We couldn't read that form. Please try again." }, { status: 400 });
  }

  const displayName = body.displayName?.trim();
  if (!displayName) {
    return NextResponse.json({ error: "Give the industry a name." }, { status: 400 });
  }
  if (!Array.isArray(body.templates) || body.templates.length !== 2) {
    return NextResponse.json({ error: "Add exactly two message templates." }, { status: 400 });
  }

  const slug = slugify(displayName);
  if (!slug) {
    return NextResponse.json({ error: "That name can't be used. Try letters and numbers." }, { status: 400 });
  }

  // Assemble the three seed items from the admin's plain-language answers.
  const items: SeedItem[] = [
    {
      kind: "FLOW_JSON",
      title: body.bookingFlow.title,
      description: body.bookingFlow.description,
      outcome: body.bookingFlow.outcome,
      sortOrder: 10,
      payload: {
        triggerType: "keyword",
        flow: buildBookingFlow({
          keywords: body.bookingFlow.keywords,
          intents: splitKeywords(body.bookingFlow.keywords),
          askMessage: body.bookingFlow.askMessage,
          tagName: `${slug}-request`,
          handoffTo: "Front desk",
        }),
      },
    },
    {
      kind: "FLOW_JSON",
      title: body.statusFlow.title,
      description: body.statusFlow.description,
      outcome: body.statusFlow.outcome,
      sortOrder: 20,
      payload: {
        triggerType: "keyword",
        flow: buildStatusFlow({
          keywords: body.statusFlow.keywords,
          intents: splitKeywords(body.statusFlow.keywords),
          notifyMessage: body.statusFlow.notifyMessage,
          triggerLabel: "Something to tell the customer",
        }),
      },
    },
    {
      kind: "CAMPAIGN_PROMPT",
      title: body.campaignPrompt.title,
      description: body.campaignPrompt.description,
      outcome: body.campaignPrompt.outcome,
      sortOrder: 30,
      payload: { prompt: body.campaignPrompt.prompt },
    },
    ...body.templates.map(
      (t, i): SeedItem => ({
        kind: "MESSAGE_TEMPLATE",
        title: t.title,
        description: t.description,
        outcome: t.outcome,
        sortOrder: 40 + i * 10,
        metaCategory: t.metaCategory,
        payload: {
          body: t.body,
          footer: t.footer,
          variableNames: t.variableNames ?? [],
          language: "en",
        },
      }),
    ),
  ];

  // Same gate as the shipped content — an admin cannot create a broken seed kit.
  for (const item of items) {
    try {
      validateSeedItem(item, slug);
    } catch (err) {
      const message =
        err instanceof VerticalSeedError
          ? `"${err.context.title ?? item.title}": ${err.message}`
          : (err as Error).message;
      return NextResponse.json({ error: message }, { status: 422 });
    }
  }

  const supabase = createServiceClient();
  const { data: existing } = await supabase
    .from("industry_verticals")
    .select("id")
    .eq("slug", slug)
    .maybeSingle();
  if (existing) {
    return NextResponse.json({ error: `"${displayName}" already exists.` }, { status: 409 });
  }

  const { data: created, error: vErr } = await supabase
    .from("industry_verticals")
    .insert({
      slug,
      display_name: displayName,
      description: body.description?.trim() ?? "",
      icon: body.icon?.trim() || "Building2",
      sort_order: 100,
      is_builtin: false, // admin-created, not shipped by us
      is_active: true,
    })
    .select("id")
    .single();

  if (vErr || !created) {
    return NextResponse.json({ error: "We couldn't save the new industry. Please try again." }, { status: 500 });
  }
  const verticalId = (created as { id: string }).id;

  const { error: iErr } = await supabase.from("vertical_template_library").insert(
    items.map((item) => ({
      vertical_id: verticalId,
      kind: item.kind,
      title: item.title,
      description: item.description,
      outcome: item.outcome,
      payload: item.payload,
      meta_category: item.kind === "MESSAGE_TEMPLATE" ? item.metaCategory : null,
      admin_note: item.adminNote ?? null,
      sort_order: item.sortOrder,
      is_active: true,
    })),
  );

  if (iErr) {
    // Don't leave an empty industry on the picker.
    await supabase.from("industry_verticals").delete().eq("id", verticalId);
    return NextResponse.json({ error: "We couldn't save the starter content. Please try again." }, { status: 500 });
  }

  const seedVertical: Pick<SeedVertical, "slug" | "displayName"> = { slug, displayName };
  return NextResponse.json({ vertical: { id: verticalId, ...seedVertical }, itemsCreated: items.length });
}
