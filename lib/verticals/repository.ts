/**
 * Data access for industry verticals — LEGACY user_id tenant model.
 *
 * Reads/writes `industry_verticals`, `vertical_template_library`, and
 * `users.vertical_id` (migration 026). All access is via the service-role client
 * from route handlers; the tables are RLS deny-all for anon/authenticated.
 *
 * Scope discipline (Phase 0 risk #5): the ONLY consumers of a tenant's vertical
 * are the three AI routes and the "Recommended for …" rails. Inbox, contacts,
 * billing, the manual flow builder, manual broadcast and manual template creation
 * must never call into this module — a vertical pre-fills, it never gates.
 */

import { createServiceClient } from "@/lib/supabase/server";
import { logger } from "@/lib/logger";
import type {
  IndustryVertical,
  VerticalTemplateItem,
  VerticalWithLibrary,
  MetaTemplateCategory,
  VerticalTemplateKind,
} from "./types";

interface VerticalRow {
  id: string;
  slug: string;
  display_name: string;
  description: string | null;
  icon: string | null;
  is_active: boolean;
  sort_order: number;
  is_builtin: boolean;
  /** Optional: absent on databases that predate migration 031. */
  requires_explicit_consent?: boolean | null;
  requires_compliance_attestation?: boolean | null;
}

interface LibraryRow {
  id: string;
  vertical_id: string;
  kind: VerticalTemplateKind;
  title: string;
  description: string;
  outcome: string;
  payload: unknown;
  meta_category: MetaTemplateCategory | null;
  admin_note: string | null;
  is_active: boolean;
  sort_order: number;
}

const VERTICAL_COLS =
  "id, slug, display_name, description, icon, is_active, sort_order, is_builtin, requires_explicit_consent, requires_compliance_attestation";
const LIBRARY_COLS =
  "id, vertical_id, kind, title, description, outcome, payload, meta_category, admin_note, is_active, sort_order";

function toVertical(r: VerticalRow): IndustryVertical {
  return {
    id: r.id,
    slug: r.slug,
    displayName: r.display_name,
    description: r.description ?? "",
    icon: r.icon,
    isActive: r.is_active,
    sortOrder: r.sort_order,
    isBuiltin: r.is_builtin,
    // Fail CLOSED: an unreadable flag must never read as 'consent not needed'.
    requiresExplicitConsent: r.requires_explicit_consent === true,
    // Fail CLOSED on an unreadable flag, as with consent.
    requiresComplianceAttestation: r.requires_compliance_attestation === true,
  };
}

function toItem(r: LibraryRow): VerticalTemplateItem {
  const base = {
    id: r.id,
    verticalId: r.vertical_id,
    title: r.title,
    description: r.description,
    outcome: r.outcome,
    adminNote: r.admin_note,
    isActive: r.is_active,
    sortOrder: r.sort_order,
  };
  // The DB CHECK constraints guarantee meta_category is present exactly when
  // kind = MESSAGE_TEMPLATE, so these casts restate an invariant the DB enforces.
  switch (r.kind) {
    case "FLOW_JSON":
      return { ...base, kind: "FLOW_JSON", payload: r.payload as VerticalTemplateItem["payload"], metaCategory: null } as VerticalTemplateItem;
    case "CAMPAIGN_PROMPT":
      return { ...base, kind: "CAMPAIGN_PROMPT", payload: r.payload as VerticalTemplateItem["payload"], metaCategory: null } as VerticalTemplateItem;
    case "MESSAGE_TEMPLATE":
      return {
        ...base,
        kind: "MESSAGE_TEMPLATE",
        payload: r.payload as VerticalTemplateItem["payload"],
        metaCategory: r.meta_category as MetaTemplateCategory,
      } as VerticalTemplateItem;
  }
}

/**
 * Verticals for the admin picker. `includeInactive` is admin-only: a deactivated
 * vertical stays resolvable for tenants already on it, but is off the picker.
 */
export async function listVerticals(opts: { includeInactive?: boolean } = {}): Promise<IndustryVertical[]> {
  const supabase = createServiceClient();
  let q = supabase.from("industry_verticals").select(VERTICAL_COLS);
  if (!opts.includeInactive) q = q.eq("is_active", true);

  const { data, error } = await q.order("sort_order", { ascending: true }).order("display_name", { ascending: true });
  if (error) {
    logger.warn("verticals: list failed", { error: error.message });
    return [];
  }
  return (data as VerticalRow[]).map(toVertical);
}

export async function getVerticalById(verticalId: string): Promise<IndustryVertical | null> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("industry_verticals")
    .select(VERTICAL_COLS)
    .eq("id", verticalId)
    .maybeSingle();
  if (error || !data) return null;
  return toVertical(data as VerticalRow);
}

/** Everything seeded for one vertical, grouped — backs the admin preview panel. */
export async function getVerticalWithLibrary(verticalId: string): Promise<VerticalWithLibrary | null> {
  const vertical = await getVerticalById(verticalId);
  if (!vertical) return null;

  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("vertical_template_library")
    .select(LIBRARY_COLS)
    .eq("vertical_id", verticalId)
    .eq("is_active", true)
    .order("sort_order", { ascending: true });

  if (error) {
    logger.warn("verticals: library query failed", { verticalId, error: error.message });
    return { vertical, flows: [], campaignPrompts: [], messageTemplates: [] };
  }

  const items = (data as LibraryRow[]).map(toItem);
  return {
    vertical,
    flows: items.filter((i): i is Extract<VerticalTemplateItem, { kind: "FLOW_JSON" }> => i.kind === "FLOW_JSON"),
    campaignPrompts: items.filter(
      (i): i is Extract<VerticalTemplateItem, { kind: "CAMPAIGN_PROMPT" }> => i.kind === "CAMPAIGN_PROMPT",
    ),
    messageTemplates: items.filter(
      (i): i is Extract<VerticalTemplateItem, { kind: "MESSAGE_TEMPLATE" }> => i.kind === "MESSAGE_TEMPLATE",
    ),
  };
}

/**
 * The tenant's vertical, or null. NULL is a supported steady state ("Skip / not
 * sure"), never an error — callers must degrade to the generic experience.
 *
 * Resolves through the vertical's own is_active flag: if an admin retires a
 * vertical, its tenants quietly fall back to generic rather than seeing a track
 * that no longer exists.
 */
export async function getVerticalForUser(userId: string): Promise<IndustryVertical | null> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("users")
    .select("vertical_id")
    .eq("id", userId)
    .maybeSingle();

  if (error || !data) return null;
  const verticalId = (data as { vertical_id: string | null }).vertical_id;
  if (!verticalId) return null;

  const vertical = await getVerticalById(verticalId);
  return vertical?.isActive ? vertical : null;
}

/**
 * Provision (or clear) a tenant's vertical. NON-DESTRUCTIVE by construction: this
 * writes one column and nothing else. Flows, campaigns and templates the client
 * already has are their own rows and are never touched — changing vertical only
 * changes what appears on the "recommended" rails.
 *
 * Pass null to clear. Caller is responsible for the admin authorization check.
 */
export async function setVerticalForUser(userId: string, verticalId: string | null): Promise<void> {
  const supabase = createServiceClient();

  if (verticalId) {
    const vertical = await getVerticalById(verticalId);
    if (!vertical) throw new Error("Unknown vertical");
  }

  const { error } = await supabase.from("users").update({ vertical_id: verticalId }).eq("id", userId);
  if (error) throw new Error(`Could not update the client's industry: ${error.message}`);

  logger.info("verticals: tenant vertical set", { userId, verticalId });
}

/**
 * Vertical context for AI prompt injection — the ONLY thing the three AI routes
 * need. Returns null when the tenant has no vertical, in which case the routes
 * must send today's byte-identical prompt.
 */
export async function getPromptContextForUser(
  userId: string,
): Promise<{ slug: string; displayName: string } | null> {
  const vertical = await getVerticalForUser(userId);
  return vertical ? { slug: vertical.slug, displayName: vertical.displayName } : null;
}
