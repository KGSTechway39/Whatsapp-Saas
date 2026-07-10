/**
 * Admin: AI model routing config (platform-owner only).
 *
 * The runtime-editable control plane for the AI layer — change provider, model,
 * token prices, markup, credits-per-action, timeout and regen caps per task_type
 * WITHOUT a redeploy (architecture rule 4), exactly like /api/admin/rates does
 * for Meta wholesale rates. Config is versioned: a POST inserts a NEW row and the
 * router reads the newest active one per task_type, so history is preserved for
 * back-dated margin reports.
 *
 *   GET                       → { configs }  (latest per task_type + full history flag)
 *   POST { config }           → inserts a new active version, returns it
 *   PATCH { id, is_active }   → toggle a version on/off (dark-launch / rollback)
 *
 * Gated by requireAdmin() (ADMIN_EMAILS allowlist).
 */
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";

const TASK_TYPES = [
  "campaign_content",
  "automation_flow_builder",
  "automation_runtime_intent",
  "appointment_nl_parse",
  "reminder_draft",
  "template_content",
] as const;
type TaskType = (typeof TASK_TYPES)[number];

const SELECT =
  "id, task_type, provider, model_id, input_price_per_million_paise, output_price_per_million_paise, markup_multiplier, credits_per_action, timeout_ms, max_regens, is_active, effective_from, updated_at, note";

export async function GET() {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("ai_model_config")
    .select(SELECT)
    .order("task_type", { ascending: true })
    .order("effective_from", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ configs: data ?? [] });
}

export async function POST(req: NextRequest) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json().catch(() => null);
  const c = body?.config ?? body;
  if (!c || !TASK_TYPES.includes(c.task_type as TaskType)) {
    return NextResponse.json({ error: "Valid task_type is required" }, { status: 400 });
  }
  if (!c.provider?.trim() || !c.model_id?.trim()) {
    return NextResponse.json({ error: "provider and model_id are required" }, { status: 400 });
  }

  // Non-negative integer coercion; undefined → column default.
  const row: Record<string, unknown> = {
    task_type: c.task_type,
    provider: String(c.provider).trim(),
    model_id: String(c.model_id).trim(),
    is_active: c.is_active ?? true,
    note: c.note ?? null,
  };
  const numeric: [string, unknown][] = [
    ["input_price_per_million_paise", c.input_price_per_million_paise],
    ["output_price_per_million_paise", c.output_price_per_million_paise],
    ["markup_multiplier", c.markup_multiplier],
    ["credits_per_action", c.credits_per_action],
    ["timeout_ms", c.timeout_ms],
    ["max_regens", c.max_regens],
  ];
  for (const [k, v] of numeric) {
    if (v !== undefined && v !== null) {
      const n = Number(v);
      if (Number.isNaN(n) || n < 0) {
        return NextResponse.json({ error: `${k} must be a non-negative number` }, { status: 400 });
      }
      row[k] = n;
    }
  }

  const supabase = createServiceClient();
  const { data, error } = await supabase.from("ai_model_config").insert(row).select(SELECT).single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ config: data }, { status: 201 });
}

export async function PATCH(req: NextRequest) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json().catch(() => null);
  if (!body?.id || typeof body.is_active !== "boolean") {
    return NextResponse.json({ error: "id and is_active (boolean) are required" }, { status: 400 });
  }

  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("ai_model_config")
    .update({ is_active: body.is_active, updated_at: new Date().toISOString() })
    .eq("id", body.id)
    .select(SELECT)
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ config: data });
}
