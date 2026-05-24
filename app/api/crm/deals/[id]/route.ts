import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getSessionUser } from "@/lib/auth";

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const { title, value, stage, probability, expectedClose, notes } = body;

  const supabase = createClient();

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (title !== undefined)         updates.title = title;
  if (value !== undefined)         updates.value = value;
  if (stage !== undefined)         updates.stage = stage;
  if (probability !== undefined)   updates.probability = probability;
  if (expectedClose !== undefined) updates.expected_close = expectedClose;
  if (notes !== undefined)         updates.notes = notes;

  if (stage === "closed_won")  updates.won_at  = new Date().toISOString();
  if (stage === "closed_lost") updates.lost_at = new Date().toISOString();

  const { data, error } = await supabase
    .from("crm_deals")
    .update(updates)
    .eq("id", params.id)
    .eq("user_id", user.id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ id: data.id, stage: data.stage, value: Number(data.value) });
}

export async function DELETE(_: NextRequest, { params }: { params: { id: string } }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const supabase = createClient();

  const { error } = await supabase
    .from("crm_deals")
    .delete()
    .eq("id", params.id)
    .eq("user_id", user.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ message: "Deal deleted" });
}
