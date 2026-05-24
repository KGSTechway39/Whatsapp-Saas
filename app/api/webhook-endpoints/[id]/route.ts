import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

// PATCH /api/webhook-endpoints/:id  Body: { status?, events?, url?, name? }
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const updates = await req.json();
  const allowed: Record<string, unknown> = {};
  if (typeof updates.status === "string") allowed.status = updates.status;
  if (Array.isArray(updates.events))      allowed.events = updates.events;
  if (typeof updates.url === "string")    allowed.url = updates.url;
  if (typeof updates.name === "string")   allowed.name = updates.name;
  allowed.updated_at = new Date().toISOString();

  const supabase = createClient();
  const { data, error } = await supabase
    .from("webhook_endpoints")
    .update(allowed)
    .eq("id", params.id)
    .eq("user_id", user.id)
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ endpoint: data });
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const supabase = createClient();
  const { error } = await supabase
    .from("webhook_endpoints")
    .delete()
    .eq("id", params.id)
    .eq("user_id", user.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
