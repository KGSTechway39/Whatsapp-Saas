import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { decrypt } from "@/lib/crypto";
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
    if (n.waba_id && n.access_token) wabaSet.set(n.waba_id, await decrypt(n.access_token));
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
  /** Every template id Meta holds for this tenant, whatever its status. */
  const metaAllIds = new Set<string>();

  for (const [wabaId, token] of Array.from(wabaSet.entries())) {
    try {
      const tmpls = await getMessageTemplates(wabaId, token);
      // Two different sets, deliberately:
      //  • metaAllIds — everything Meta HAS, at any status. This is the keep-set
      //    for the prune below. A PENDING template you just submitted is real
      //    and in flight; deleting it would make the starter flow eat its own
      //    output on the next sync.
      //  • allTemplates — APPROVED only, the ones we import as sendable rows.
      for (const t of tmpls) metaAllIds.add(t.id);
      const approved = tmpls.filter((t) => normalizeTemplateStatus(t.status) === "APPROVED");
      byWaba[wabaId] = approved.length;
      for (const t of approved) allTemplates.push({ wabaId, tmpl: t });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "fetch failed";
      errors.push(`WABA ${wabaId}: ${msg}`);
    }
  }

  // NOTE: no early return when Meta has nothing. That is precisely the case
  // where the local library is entirely stale and the prune below matters most
  // — returning early here is what left 7 unsendable rows in place.

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

  // ── Prune: make the local library MIRROR what Meta actually has approved ──
  //
  // Anything left over is one of:
  //   • never sent to Meta (no meta_template_id) — seed/demo rows that read
  //     APPROVED locally but would fail at send with "(#132001) does not exist"
  //   • PENDING / REJECTED — not sendable now, and REJECTED never will be
  //   • deleted at Meta since the last sync
  //
  // Keeping them is what made the app claim "4 approved templates" while every
  // send failed. The library should only ever offer what can actually be sent.
  // Keep anything Meta still has (approved OR pending). Remove only rows that
  // Meta does not know about, or that Meta has rejected.
  const keepMetaIds = metaAllIds;

  const { data: locals } = await supabase
    .from("templates")
    .select("id, name, status, meta_template_id")
    .eq("user_id", user.id);

  const doomed = (locals ?? []).filter(
    (r: { meta_template_id: string | null; status: string }) =>
      // Never sent to Meta → cannot be sent, and Meta will never approve it.
      !r.meta_template_id ||
      // Meta no longer has it (deleted there).
      !keepMetaIds.has(r.meta_template_id) ||
      // Rejected → never becomes sendable.
      r.status === "REJECTED",
  );

  let removed = 0;
  const removedNames: string[] = [];
  if (doomed.length > 0) {
    const { error } = await supabase
      .from("templates")
      .delete()
      .eq("user_id", user.id)               // tenant scoping — never a blanket delete
      .in("id", doomed.map((d: { id: string }) => d.id));
    if (error) errors.push(`prune: ${error.message}`);
    else {
      removed = doomed.length;
      for (const d of doomed as { name: string }[]) removedNames.push(d.name);
    }
  }

  return NextResponse.json({
    synced: created + updated,
    created,
    updated,
    removed,
    removedNames,
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
