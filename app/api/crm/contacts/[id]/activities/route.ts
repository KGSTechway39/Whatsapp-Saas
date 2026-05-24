import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getSessionUser } from "@/lib/auth";

// GET /api/crm/contacts/[id]/activities
export async function GET(_: NextRequest, { params }: { params: { id: string } }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const supabase = createClient();

  const { data, error } = await supabase
    .from("crm_activities")
    .select("*")
    .eq("contact_id", params.id)
    .order("created_at", { ascending: false })
    .limit(100);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({
    activities: (data || []).map((a) => ({
      id: a.id,
      type: a.type,
      content: a.content,
      metadata: a.metadata,
      createdAt: a.created_at,
    })),
  });
}

// POST /api/crm/contacts/[id]/activities
// Body: { type: "note"|"call"|"email"|"whatsapp", content }
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { type, content, metadata } = await request.json();

  if (!type || !content?.trim()) {
    return NextResponse.json({ error: "type and content are required" }, { status: 400 });
  }

  const VALID_TYPES = ["note", "call", "email", "whatsapp", "stage_change", "deal"];
  if (!VALID_TYPES.includes(type)) {
    return NextResponse.json({ error: `type must be one of: ${VALID_TYPES.join(", ")}` }, { status: 400 });
  }

  const supabase = createClient();

  // Verify contact belongs to user
  const { data: contact } = await supabase
    .from("contacts")
    .select("id")
    .eq("id", params.id)
    .eq("user_id", user.id)
    .single();

  if (!contact) return NextResponse.json({ error: "Contact not found" }, { status: 404 });

  const { data, error } = await supabase
    .from("crm_activities")
    .insert({
      contact_id: params.id,
      user_id: user.id,
      type,
      content: content.trim(),
      metadata: metadata || {},
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Update last_contacted timestamp
  await supabase
    .from("contacts")
    .update({ last_contacted: new Date().toISOString() })
    .eq("id", params.id);

  return NextResponse.json({
    id: data.id,
    type: data.type,
    content: data.content,
    metadata: data.metadata,
    createdAt: data.created_at,
  }, { status: 201 });
}
