import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getSessionUser } from "@/lib/auth";

export async function GET(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const stage = searchParams.get("stage");

  const supabase = createClient();

  let query = supabase
    .from("crm_deals")
    .select("*, contacts(name, phone, email)")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });

  if (stage && stage !== "all") query = query.eq("stage", stage);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const deals = (data || []).map((d) => ({
    id: d.id,
    title: d.title,
    value: Number(d.value),
    stage: d.stage,
    probability: d.probability,
    expectedClose: d.expected_close,
    wonAt: d.won_at,
    lostAt: d.lost_at,
    notes: d.notes,
    createdAt: d.created_at,
    contact: d.contacts ? {
      name: (d.contacts as { name: string; phone: string; email: string }).name,
      phone: (d.contacts as { name: string; phone: string; email: string }).phone,
      email: (d.contacts as { name: string; phone: string; email: string }).email,
    } : null,
    contactId: d.contact_id,
  }));

  return NextResponse.json({ deals });
}

export async function POST(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { contactId, title, value, stage, probability, expectedClose, notes } = await request.json();

  if (!contactId || !title) {
    return NextResponse.json({ error: "contactId and title required" }, { status: 400 });
  }

  const supabase = createClient();

  const { data, error } = await supabase
    .from("crm_deals")
    .insert({
      user_id: user.id,
      contact_id: contactId,
      title,
      value: value || 0,
      stage: stage || "prospecting",
      probability: probability ?? 20,
      expected_close: expectedClose || null,
      notes: notes || null,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Log deal activity on the contact
  void supabase.from("crm_activities").insert({
    contact_id: contactId,
    user_id: user.id,
    type: "deal",
    content: `Deal created: ${title} (₹${Number(value || 0).toLocaleString()})`,
    metadata: { dealId: data.id, value, stage: stage || "prospecting" },
  });

  // Sync deal_value to contact
  await supabase
    .from("contacts")
    .update({ deal_value: value || 0 })
    .eq("id", contactId)
    .eq("user_id", user.id);

  return NextResponse.json({
    id: data.id, title: data.title, value: Number(data.value),
    stage: data.stage, probability: data.probability,
    expectedClose: data.expected_close, createdAt: data.created_at,
  }, { status: 201 });
}
