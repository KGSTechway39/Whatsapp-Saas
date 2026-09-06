/**
 * VerticalSeedService — copies seed-kit content into a tenant's OWN records.
 *
 * THE RULE: copy, never link. Each adopted item becomes a row the tenant owns
 * and can edit freely. Nothing they do afterwards touches the shared seed kit
 * or another tenant's copy. A linked/shared reference would mean editing a
 * template silently rewrites it for every tenant on that industry.
 *
 * FULLY GENERIC. There is no `if (vertical === 'hospital')` anywhere in this
 * file, and there must never be one. Adding E-commerce, School, Real Estate or
 * anything else is rows in `vertical_template_library` — this service already
 * handles them, because it dispatches on `kind`, not on industry.
 *
 * The three kinds map onto tables the product already has:
 *   FLOW_JSON        → automation_flows   (the workflow engine's own schema)
 *   CAMPAIGN_PROMPT  → returned for pre-fill; nothing to persist until the
 *                      tenant actually generates a campaign
 *   MESSAGE_TEMPLATE → templates          (status 'draft' until submitted to Meta)
 */
import { createServiceClient } from "@/lib/supabase/server";
import { getVerticalWithLibrary, getVerticalForUser } from "@/lib/verticals/repository";
import { logger } from "@/lib/logger";
import type {
  VerticalTemplateItem,
  FlowJsonPayload,
  MessageTemplatePayload,
  CampaignPromptPayload,
} from "@/lib/verticals/types";

export type SeedKind = "FLOW_JSON" | "CAMPAIGN_PROMPT" | "MESSAGE_TEMPLATE";

export interface AdoptResult {
  itemId: string;
  kind: SeedKind;
  title: string;
  /** The id of the row created in the tenant's own table, when one was created. */
  createdId: string | null;
  status: "adopted" | "already_adopted" | "failed";
  error?: string;
}

/** Everything on offer for a tenant, with what they've already taken. */
export interface SeedOffer {
  vertical: { id: string; slug: string; displayName: string; requiresConsent: boolean } | null;
  items: {
    id: string;
    kind: SeedKind;
    title: string;
    description: string;
    outcome: string;
    metaCategory: string | null;
    /** True when a row with the same origin already exists for this tenant. */
    adopted: boolean;
  }[];
}

/**
 * Adoption is tracked by `seed_origin_id` (migration 032) — a real column on
 * both target tables, with a partial UNIQUE index per (user_id, seed_origin_id).
 * The DB therefore enforces the same idempotency this service checks, so two
 * admins clicking "Add" simultaneously cannot create a duplicate flow.
 */

/**
 * What this tenant is offered, and what they already hold.
 * Returns `vertical: null` when the tenant has no industry — a first-class
 * state ("no industry track"), not an error.
 */
export async function getSeedOffer(userId: string): Promise<SeedOffer> {
  const vertical = await getVerticalForUser(userId);
  if (!vertical) return { vertical: null, items: [] };

  const bundle = await getVerticalWithLibrary(vertical.id);
  if (!bundle) return { vertical: null, items: [] };

  const supabase = createServiceClient();
  const [{ data: flows }, { data: templates }] = await Promise.all([
    supabase.from("automation_flows").select("seed_origin_id").eq("user_id", userId).limit(1000),
    supabase.from("templates").select("seed_origin_id").eq("user_id", userId).limit(1000),
  ]);

  const adopted = new Set<string>();
  for (const r of [...(flows ?? []), ...(templates ?? [])] as { seed_origin_id: string | null }[]) {
    if (r.seed_origin_id) adopted.add(r.seed_origin_id);
  }

  const all: VerticalTemplateItem[] = [
    ...bundle.flows,
    ...bundle.campaignPrompts,
    ...bundle.messageTemplates,
  ];

  return {
    vertical: {
      id: vertical.id,
      slug: vertical.slug,
      displayName: vertical.displayName,
      requiresConsent: vertical.requiresExplicitConsent,
    },
    items: all
      .filter((i) => i.isActive)
      .map((i) => ({
        id: i.id,
        kind: i.kind,
        title: i.title,
        description: i.description,
        outcome: i.outcome,
        metaCategory: i.metaCategory,
        adopted: adopted.has(i.id),
      })),
  };
}

/**
 * Copy chosen seed items into the tenant's own records.
 *
 * Per-item outcomes, never all-or-nothing: adopting five items where one fails
 * validation should leave the other four in place, and say so. Rolling all five
 * back would discard work that succeeded.
 */
export async function adoptSeedItems(
  userId: string,
  itemIds: string[],
): Promise<AdoptResult[]> {
  const vertical = await getVerticalForUser(userId);
  if (!vertical) throw new Error("This tenant has no industry assigned yet.");

  const bundle = await getVerticalWithLibrary(vertical.id);
  if (!bundle) throw new Error("That industry no longer exists.");

  const byId = new Map<string, VerticalTemplateItem>();
  for (const i of [...bundle.flows, ...bundle.campaignPrompts, ...bundle.messageTemplates]) {
    byId.set(i.id, i);
  }

  const offer = await getSeedOffer(userId);
  const alreadyAdopted = new Set(offer.items.filter((i) => i.adopted).map((i) => i.id));

  const supabase = createServiceClient();
  const results: AdoptResult[] = [];

  for (const itemId of itemIds) {
    const item = byId.get(itemId);
    if (!item) {
      results.push({ itemId, kind: "FLOW_JSON", title: "(unknown)", createdId: null,
                     status: "failed", error: "That item is not part of this industry." });
      continue;
    }
    // Idempotent: re-adopting must not silently create a duplicate flow that
    // then fires twice for the same keyword.
    if (alreadyAdopted.has(itemId)) {
      results.push({ itemId, kind: item.kind, title: item.title, createdId: null, status: "already_adopted" });
      continue;
    }

    try {
      const createdId = await copyItem(supabase, userId, item);
      results.push({ itemId, kind: item.kind, title: item.title, createdId, status: "adopted" });
    } catch (err) {
      results.push({ itemId, kind: item.kind, title: item.title, createdId: null,
                     status: "failed", error: (err as Error).message });
    }
  }

  logger.info("verticals: seed items adopted", {
    userId,
    vertical: vertical.slug,
    adopted: results.filter((r) => r.status === "adopted").length,
    failed: results.filter((r) => r.status === "failed").length,
  });

  return results;
}

/**
 * Dispatch on KIND, never on industry — this is what makes the framework
 * generic. A new vertical needs no change here.
 */
async function copyItem(
  supabase: ReturnType<typeof createServiceClient>,
  userId: string,
  item: VerticalTemplateItem,
): Promise<string | null> {
  switch (item.kind) {
    case "FLOW_JSON": {
      const payload = item.payload as FlowJsonPayload;
      const { data, error } = await supabase
        .from("automation_flows")
        .insert({
          user_id: userId,
          name: item.title,
          description: item.description,
          // Inactive on arrival — deliberately. An automation that starts
          // replying to real customers the moment an admin clicks "add" is not
          // a feature. The tenant reviews it, then switches it on.
          is_active: false,
          trigger_type: payload.triggerType,
          // flow_data stays exactly what the workflow engine expects —
          // provenance lives in its own column, not in the engine's payload.
          flow_data: payload.flow,
          seed_origin_id: item.id,
        })
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      return (data as { id: string }).id;
    }

    case "MESSAGE_TEMPLATE": {
      const payload = item.payload as MessageTemplatePayload;
      const { data, error } = await supabase
        .from("templates")
        .insert({
          user_id: userId,
          // Meta requires snake_case names; the human title stays in display_name.
          name: slugifyTemplateName(item.title),
          display_name: item.title,
          category: item.metaCategory,
          language: payload.language || "en",
          // DRAFT until the tenant submits it to Meta (migration 032 added the
          // state). Adopting a template must never look approved and sendable —
          // and 'PENDING' would falsely claim Meta is reviewing it.
          status: "DRAFT",
          body: payload.body,
          // `variables` is a JSON ARRAY in this schema — the positional names
          // for {{1}}, {{2}} … Nothing else may be stuffed into it.
          variables: payload.variableNames,
          seed_origin_id: item.id,
        })
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      return (data as { id: string }).id;
    }

    case "CAMPAIGN_PROMPT": {
      // Nothing to persist: a prompt pre-fills the campaign generator at the
      // moment the tenant creates a campaign. Writing an empty campaign row
      // here would litter their dashboard with drafts they never asked for.
      const payload = item.payload as CampaignPromptPayload;
      void payload;
      return null;
    }
  }
}

/** Meta template names: lowercase, digits and underscores only, ≤512 chars. */
function slugifyTemplateName(title: string): string {
  const base = title.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 480);
  // Suffix keeps a second adoption of a same-titled item from colliding on
  // Meta's per-WABA unique name rule.
  return `${base || "template"}_${Date.now().toString(36)}`;
}
