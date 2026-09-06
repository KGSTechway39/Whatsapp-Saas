/**
 * Seeds `industry_verticals` + `vertical_template_library` from SEED_VERTICALS.
 *
 * The point of this module is the GATE, not the insert. Phase 0 risk #2: a seeded
 * flow that fails `sanitizeFlowGraph` would reach a real client as a card that
 * cannot be opened. So every payload is validated first, and a failure aborts the
 * seed for that vertical — we fail the SEED, never the TENANT.
 *
 * Idempotent: verticals are matched on `slug` and library items on
 * (vertical, kind, title), so re-running updates content in place rather than
 * duplicating it. Provisioned tenants keep their `users.vertical_id` untouched.
 */

import { createServiceClient } from "@/lib/supabase/server";
import { logger } from "@/lib/logger";
import { SEED_VERTICALS, type SeedItem, type SeedVertical } from "./seed-data";
import { validateAllSeedData } from "./validate-seed";

export { validateSeedItem, validateAllSeedData } from "./validate-seed";

export interface SeedReport {
  verticalsUpserted: number;
  itemsUpserted: number;
  errors: string[];
}

interface DbItem {
  vertical_id: string;
  kind: SeedItem["kind"];
  title: string;
  description: string;
  outcome: string;
  payload: unknown;
  meta_category: string | null;
  admin_note: string | null;
  sort_order: number;
  is_active: boolean;
}

function toDbItem(item: SeedItem, verticalId: string): DbItem {
  return {
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
  };
}

/**
 * Upsert every shipped vertical and its content.
 *
 * Validation runs over ALL verticals first, before a single write. A broken seed
 * anywhere aborts the whole run rather than leaving the library half-populated.
 */
export async function seedVerticals(verticals: SeedVertical[] = SEED_VERTICALS): Promise<SeedReport> {
  const errors = validateAllSeedData(verticals);
  if (errors.length) {
    logger.warn("verticals: seed aborted, content failed validation", { count: errors.length });
    return { verticalsUpserted: 0, itemsUpserted: 0, errors };
  }

  const supabase = createServiceClient();
  const report: SeedReport = { verticalsUpserted: 0, itemsUpserted: 0, errors: [] };

  for (const v of verticals) {
    const { data: upserted, error: vErr } = await supabase
      .from("industry_verticals")
      .upsert(
        {
          slug: v.slug,
          display_name: v.displayName,
          description: v.description,
          icon: v.icon,
          sort_order: v.sortOrder,
          is_builtin: v.isBuiltin,
          is_active: true,
        },
        { onConflict: "slug" },
      )
      .select("id")
      .single();

    if (vErr || !upserted) {
      report.errors.push(`${v.slug}: ${vErr?.message ?? "could not save the industry"}`);
      continue;
    }
    report.verticalsUpserted++;
    const verticalId = (upserted as { id: string }).id;

    // Match existing rows on (kind, title) so a re-run edits content in place.
    const { data: existing } = await supabase
      .from("vertical_template_library")
      .select("id, kind, title")
      .eq("vertical_id", verticalId);

    const byKey = new Map(
      ((existing ?? []) as { id: string; kind: string; title: string }[]).map((r) => [`${r.kind}::${r.title}`, r.id]),
    );

    for (const item of v.items) {
      const row = toDbItem(item, verticalId);
      const existingId = byKey.get(`${item.kind}::${item.title}`);

      const { error: iErr } = existingId
        ? await supabase.from("vertical_template_library").update(row).eq("id", existingId)
        : await supabase.from("vertical_template_library").insert(row);

      if (iErr) report.errors.push(`${v.slug} / ${item.title}: ${iErr.message}`);
      else report.itemsUpserted++;
    }
  }

  logger.info("verticals: seed complete", {
    verticals: report.verticalsUpserted,
    items: report.itemsUpserted,
    errors: report.errors.length,
  });
  return report;
}
