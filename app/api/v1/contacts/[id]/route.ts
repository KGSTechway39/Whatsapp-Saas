import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { withApiAuth, ApiAuthError } from "@/lib/api-keys";
import { dispatchEvent } from "@/lib/webhooks-out";

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const ctx = await withApiAuth(req, "contacts:read");
    const supabase = createServiceClient();
    const { data, error } = await supabase
      .from("contacts")
      .select("id, name, phone, email, tags, crm_stage, deal_value, created_at")
      .eq("id", params.id).eq("user_id", ctx.userId).single();
    if (error || !data) return NextResponse.json({ error: "Not found", code: "NOT_FOUND" }, { status: 404 });
    return NextResponse.json({ ...data, object: "contact", deal_value: Number(data.deal_value || 0) });
  } catch (err) {
    if (err instanceof ApiAuthError) return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
    return NextResponse.json({ error: "Internal error", code: "INTERNAL" }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const ctx = await withApiAuth(req, "contacts:write");
    const updates = await req.json();
    const supabase = createServiceClient();

    const allowed: Record<string, unknown> = {};
    if (updates.name !== undefined)       allowed.name = updates.name;
    if (updates.email !== undefined)      allowed.email = updates.email;
    if (updates.tags !== undefined)       allowed.tags = updates.tags;
    if (updates.company !== undefined)    allowed.company = updates.company;
    if (updates.crm_stage !== undefined)  allowed.crm_stage = updates.crm_stage;
    if (updates.deal_value !== undefined) allowed.deal_value = Number(updates.deal_value);
    allowed.updated_at = new Date().toISOString();

    const { data, error } = await supabase
      .from("contacts")
      .update(allowed)
      .eq("id", params.id)
      .eq("user_id", ctx.userId)
      .select("id, name, phone, email, tags, crm_stage, deal_value, created_at")
      .single();
    if (error || !data) return NextResponse.json({ error: error?.message || "Not found", code: "NOT_FOUND" }, { status: 404 });

    dispatchEvent(supabase, ctx.userId, "contact.updated", { id: data.id, ...allowed }).catch(() => {});

    return NextResponse.json({ ...data, object: "contact", deal_value: Number(data.deal_value || 0) });
  } catch (err) {
    if (err instanceof ApiAuthError) return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
    return NextResponse.json({ error: "Internal error", code: "INTERNAL" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const ctx = await withApiAuth(req, "contacts:write");
    const supabase = createServiceClient();
    const { error } = await supabase.from("contacts").delete().eq("id", params.id).eq("user_id", ctx.userId);
    if (error) return NextResponse.json({ error: error.message, code: "DB_ERROR" }, { status: 500 });
    return NextResponse.json({ deleted: true, id: params.id });
  } catch (err) {
    if (err instanceof ApiAuthError) return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
    return NextResponse.json({ error: "Internal error", code: "INTERNAL" }, { status: 500 });
  }
}
