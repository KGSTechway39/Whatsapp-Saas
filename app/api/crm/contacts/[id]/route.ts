import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getSessionUser } from "@/lib/auth";

// GET /api/crm/contacts/[id] — full contact detail with latest activities and open deals
export async function GET(_: NextRequest, { params }: { params: { id: string } }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const supabase = createClient();

  const [contactRes, activitiesRes, dealsRes] = await Promise.allSettled([
    supabase
      .from("contacts")
      .select("*")
      .eq("id", params.id)
      .eq("user_id", user.id)
      .single(),

    supabase
      .from("crm_activities")
      .select("*")
      .eq("contact_id", params.id)
      .order("created_at", { ascending: false })
      .limit(50),

    supabase
      .from("crm_deals")
      .select("*")
      .eq("contact_id", params.id)
      .eq("user_id", user.id)
      .order("created_at", { ascending: false }),
  ]);

  const contact = contactRes.status === "fulfilled" ? contactRes.value.data : null;
  if (!contact) return NextResponse.json({ error: "Contact not found" }, { status: 404 });

  const activities = activitiesRes.status === "fulfilled" ? activitiesRes.value.data || [] : [];
  const deals = dealsRes.status === "fulfilled" ? dealsRes.value.data || [] : [];

  return NextResponse.json({
    contact: {
      id: contact.id,
      name: contact.name,
      phone: contact.phone,
      email: contact.email,
      company: contact.company,
      tags: contact.tags || [],
      status: contact.status,
      lastContact: contact.last_contacted,
      addedDate: contact.added_date,
      stage: contact.crm_stage || "new_lead",
      score: contact.crm_score ?? 50,
      value: contact.deal_value ? Number(contact.deal_value) : null,
      source: contact.crm_source || "manual",
      notes: contact.crm_notes,
      group: contact.contact_group,
    },
    activities: activities.map((a) => ({
      id: a.id,
      type: a.type,
      content: a.content,
      metadata: a.metadata,
      createdAt: a.created_at,
    })),
    deals: deals.map((d) => ({
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
    })),
  });
}

// PATCH /api/crm/contacts/[id] — update CRM fields; logs stage change activity
export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const { stage, score, value, company, source, notes } = body;

  const supabase = createClient();

  // Fetch current stage to detect change
  const { data: current } = await supabase
    .from("contacts")
    .select("crm_stage, name")
    .eq("id", params.id)
    .eq("user_id", user.id)
    .single();

  if (!current) return NextResponse.json({ error: "Contact not found" }, { status: 404 });

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (stage !== undefined)  updates.crm_stage = stage;
  if (score !== undefined)  updates.crm_score = score;
  if (value !== undefined)  updates.deal_value = value;
  if (company !== undefined) updates.company = company;
  if (source !== undefined) updates.crm_source = source;
  if (notes !== undefined)  updates.crm_notes = notes;

  const { error } = await supabase
    .from("contacts")
    .update(updates)
    .eq("id", params.id)
    .eq("user_id", user.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Log stage change activity
  if (stage && stage !== current.crm_stage) {
    void supabase.from("crm_activities").insert({
      contact_id: params.id,
      user_id: user.id,
      type: "stage_change",
      content: `Stage changed from ${current.crm_stage || "new_lead"} to ${stage}`,
      metadata: { from: current.crm_stage || "new_lead", to: stage },
    });
  }

  return NextResponse.json({ message: "Updated" });
}
