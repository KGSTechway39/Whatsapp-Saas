/**
 * Starter templates — browse, and create on the tenant's own WABA.
 *
 *   GET                    → { starters }  the catalogue, with an `added` flag
 *   POST { names: [...] }  → { results }   create each on Meta, submit for review
 *
 * This is the honest replacement for the old "Meta Template Library" panel,
 * which called a non-existent Graph path and silently served a hardcoded list.
 * Meta hands out no ready-made templates; every one is created by the business
 * and reviewed. These go through the real `POST /{waba_id}/message_templates`.
 *
 * A created template lands as PENDING with a real `meta_template_id`, so it is
 * correctly NOT sendable until Meta approves — at which point the
 * message_template_status_update webhook flips it automatically.
 */
import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { decrypt } from "@/lib/crypto";
import { createServiceClient } from "@/lib/supabase/server";
import { createTemplate } from "@/lib/meta";
import { STARTER_TEMPLATES, buildComponents, getStarter } from "@/lib/whatsapp/starter-templates";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

/** One mis-click should not submit a dozen templates for review. */
const MAX_PER_CALL = 10;

async function resolveWaba(userId: string) {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from("whatsapp_numbers")
    .select("waba_id, access_token")
    .eq("user_id", userId)
    .eq("status", "active")
    .not("waba_id", "is", null)
    .not("access_token", "is", null)
    .order("is_primary", { ascending: false })
    .limit(1)
    .maybeSingle<{ waba_id: string; access_token: string }>();
  if (!data) return null;
  return { wabaId: data.waba_id, token: await decrypt(data.access_token) };
}

export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Mark the ones already on this account so the UI doesn't offer duplicates —
  // Meta rejects a second template with the same name+language.
  const supabase = createServiceClient();
  const { data: existing } = await supabase
    .from("templates")
    .select("name")
    .eq("user_id", user.id);
  const have = new Set((existing ?? []).map((r: { name: string }) => r.name));

  return NextResponse.json({
    starters: STARTER_TEMPLATES.map((t) => ({
      name: t.name,
      displayName: t.displayName,
      purpose: t.purpose,
      category: t.category,
      language: t.language,
      body: t.body,
      footer: t.footer ?? null,
      variableLabels: t.variableLabels,
      examples: t.examples,
      added: have.has(t.name),
    })),
  });
}

export async function POST(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const names: string[] = Array.isArray(body.names) ? body.names.filter(Boolean) : [];
  if (names.length === 0) {
    return NextResponse.json({ error: "Choose at least one template." }, { status: 400 });
  }
  if (names.length > MAX_PER_CALL) {
    return NextResponse.json(
      { error: `That's ${names.length} — add up to ${MAX_PER_CALL} at a time.` },
      { status: 400 },
    );
  }

  const waba = await resolveWaba(user.id);
  if (!waba) {
    return NextResponse.json(
      { error: "Connect a WhatsApp number first — templates live on your WhatsApp account.", code: "NO_NUMBER" },
      { status: 409 },
    );
  }

  const supabase = createServiceClient();
  const results: { name: string; status: "submitted" | "exists" | "failed"; error?: string }[] = [];

  // Per-item outcomes, never all-or-nothing: submitting five where one name
  // collides should still submit the other four.
  for (const name of names) {
    const t = getStarter(name);
    if (!t) {
      results.push({ name, status: "failed", error: "Unknown starter template." });
      continue;
    }

    try {
      const created = await createTemplate(waba.wabaId, waba.token, {
        name: t.name,
        language: t.language,
        category: t.category,
        components: buildComponents(t) as never,
      });

      // Store as PENDING with Meta's real id. It is deliberately not sendable
      // yet — the approval webhook flips it when Meta says so.
      await supabase.from("templates").upsert(
        {
          user_id: user.id,
          name: t.name,
          display_name: t.displayName,
          category: t.category,
          language: t.language,
          status: created.status === "APPROVED" ? "APPROVED" : "PENDING",
          body: t.body,
          variables: t.variableLabels,
          meta_template_id: created.id,
          updated_at: new Date().toISOString(),
        },
        // Matches uq_templates_user_name_lang (migration 034). Meta keys a
        // template on name+language per WABA; we mirror that.
        { onConflict: "user_id,name,language" },
      );

      results.push({ name, status: "submitted" });
      logger.info("templates: starter submitted to Meta", { name, metaId: created.id });
    } catch (err) {
      const msg = (err as Error).message;
      // Meta rejects a duplicate name+language. That is not a failure the
      // owner needs to act on — it already exists.
      // Meta reports a name clash several ways depending on the endpoint.
      if (/already exists|duplicate|same name/i.test(msg)) {
        results.push({ name, status: "exists" });
      } else {
        results.push({ name, status: "failed", error: msg });
      }
    }
  }

  const submitted = results.filter((r) => r.status === "submitted").length;
  return NextResponse.json({
    results,
    submitted,
    message:
      submitted > 0
        ? `${submitted} sent to WhatsApp for approval. They'll appear here automatically once approved — usually within a few minutes.`
        : "Nothing new was submitted.",
  });
}
