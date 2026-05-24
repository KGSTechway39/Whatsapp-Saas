import { createClient } from "@/lib/supabase/server";
import { getSessionUser } from "@/lib/auth";
import { NextRequest, NextResponse } from "next/server";

// ── GET: conversation detail + messages ──────────────────────────────────────
export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const supabase = createClient();

  const { data: conv, error: convErr } = await supabase
    .from("conversations")
    .select(`
      id, status, unread_count, last_message_at, last_message_preview,
      is_within_24h_window, window_expires_at,
      contact_phone, contact_name, assigned_to, created_at, updated_at,
      contact_id,
      contacts(id, name, phone, email, tags, crm_stage, crm_score, deal_value,
               company, crm_notes, added_date, status),
      whatsapp_number_id,
      whatsapp_numbers(id, phone_number, display_name, status)
    `)
    .eq("id", params.id)
    .eq("user_id", user.id)
    .single();

  if (convErr || !conv) {
    return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
  }

  // Load last 80 messages
  const { data: msgs } = await supabase
    .from("messages")
    .select("id, direction, type, content, status, wa_message_id, error_message, sent_at, delivered_at, read_at, created_at")
    .eq("conversation_id", params.id)
    .order("created_at", { ascending: true })
    .limit(80);

  // Mark all inbound messages as read (reset unread_count)
  if ((conv.unread_count ?? 0) > 0) {
    await supabase
      .from("conversations")
      .update({ unread_count: 0, updated_at: new Date().toISOString() })
      .eq("id", params.id)
      .eq("user_id", user.id);
  }

  // Recent campaigns sent to this contact
  let recentCampaigns: unknown[] = [];
  const contactId = (conv.contacts as { id?: string } | null)?.id;
  if (contactId) {
    const { data: cm } = await supabase
      .from("campaign_messages")
      .select("campaign_id, status, sent_at, campaigns(name, status)")
      .eq("contact_id", contactId)
      .order("sent_at", { ascending: false })
      .limit(5);
    recentCampaigns = cm ?? [];
  }

  return NextResponse.json({
    conversation: conv,
    messages: msgs ?? [],
    recentCampaigns,
  });
}

// ── PATCH: update conversation (status, assign) ───────────────────────────────
export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const supabase = createClient();
  const body = await request.json();
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };

  if (body.status !== undefined) patch.status = body.status;
  if (body.assignedTo !== undefined) patch.assigned_to = body.assignedTo;
  if (body.unreadCount !== undefined) patch.unread_count = body.unreadCount;

  const { data, error } = await supabase
    .from("conversations")
    .update(patch)
    .eq("id", params.id)
    .eq("user_id", user.id)
    .select("id, status, assigned_to, unread_count")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}
