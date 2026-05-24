import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import {
  getMessageTemplates,
  extractTemplateBody,
  normalizeTemplateStatus,
  MetaTemplate,
} from "@/lib/meta";

// POST /api/templates/sync
// Pulls *all* templates from every connected WABA on this account and
// upserts them into our local templates table.
//
// Returns: { synced: number, created: number, updated: number, byWaba: {...},
//           errors: string[] }
export async function POST() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const supabase = createClient();

  // Find every WABA we know about for this user.
  const { data: numbers, error: numErr } = await supabase
    .from("whatsapp_numbers")
    .select("id, waba_id, access_token, phone_number")
    .eq("user_id", user.id);

  if (numErr) return NextResponse.json({ error: numErr.message }, { status: 500 });

  const wabaSet = new Map<string, string>(); // waba_id → token
  for (const n of numbers || []) {
    if (n.waba_id && n.access_token) wabaSet.set(n.waba_id, n.access_token);
  }

  if (wabaSet.size === 0) {
    return NextResponse.json(
      { error: "No connected WhatsApp numbers with WABA + access token. Connect a number first." },
      { status: 400 },
    );
  }

  const errors: string[] = [];
  const byWaba: Record<string, number> = {};
  const allTemplates: { wabaId: string; tmpl: MetaTemplate }[] = [];

  for (const [wabaId, token] of Array.from(wabaSet.entries())) {
    try {
      const tmpls = await getMessageTemplates(wabaId, token);
      byWaba[wabaId] = tmpls.length;
      for (const t of tmpls) allTemplates.push({ wabaId, tmpl: t });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "fetch failed";
      errors.push(`WABA ${wabaId}: ${msg}`);
    }
  }

  if (allTemplates.length === 0) {
    return NextResponse.json({ synced: 0, created: 0, updated: 0, byWaba, errors });
  }

  // Load existing templates so we know what to update vs create.
  const { data: existing = [] } = await supabase
    .from("templates")
    .select("id, meta_template_id, name")
    .eq("user_id", user.id);

  const byMetaId = new Map<string, string>();
  const byName   = new Map<string, string>();
  for (const r of existing || []) {
    if (r.meta_template_id) byMetaId.set(r.meta_template_id, r.id);
    byName.set(`${r.name}`, r.id);
  }

  let created = 0;
  let updated = 0;

  for (const { tmpl } of allTemplates) {
    const { body, variables } = extractTemplateBody(tmpl.components);
    const row = {
      user_id:          user.id,
      name:             tmpl.name,
      display_name:     prettyName(tmpl.name),
      category:         tmpl.category,
      language:         tmpl.language,
      status:           normalizeTemplateStatus(tmpl.status),
      body,
      variables,
      meta_template_id: tmpl.id,
      updated_at:       new Date().toISOString(),
    };

    const localId = byMetaId.get(tmpl.id) || byName.get(tmpl.name);
    if (localId) {
      const { error } = await supabase.from("templates").update(row).eq("id", localId).eq("user_id", user.id);
      if (error) errors.push(`update ${tmpl.name}: ${error.message}`);
      else updated++;
    } else {
      const { error } = await supabase.from("templates").insert(row);
      if (error) errors.push(`create ${tmpl.name}: ${error.message}`);
      else created++;
    }
  }

  return NextResponse.json({
    synced: created + updated,
    created,
    updated,
    byWaba,
    errors,
  });
}

function prettyName(snake: string): string {
  return snake
    .split(/[_-]/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}
