import { createClient } from "@/lib/supabase/server";
import { getSessionUser } from "@/lib/auth";
import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const supabase = createClient();
  const { searchParams } = new URL(request.url);
  const statusFilter = searchParams.get("status") || "open";
  const search      = searchParams.get("search") || "";
  const sort        = searchParams.get("sort") || "latest";

  let query = supabase
    .from("conversations")
    .select(`
      id, status, unread_count, last_message_at, last_message_preview,
      is_within_24h_window, window_expires_at,
      contact_phone, contact_name, assigned_to,
      created_at, updated_at,
      contact_id,
      contacts(id, name, phone, email, tags, crm_stage),
      whatsapp_number_id,
      whatsapp_numbers(id, phone_number, display_name)
    `)
    .eq("user_id", user.id);

  if (statusFilter === "resolved") {
    query = query.eq("status", "resolved");
  } else if (statusFilter === "bot") {
    query = query.eq("status", "bot_handling");
  } else if (statusFilter === "unread") {
    query = query.gt("unread_count", 0).neq("status", "resolved");
  } else {
    // 'all' and 'open' → exclude resolved
    if (statusFilter !== "all") query = query.neq("status", "resolved");
  }

  if (search) {
    query = query.or(
      `contact_name.ilike.%${search}%,contact_phone.ilike.%${search}%`
    );
  }

  if (sort === "unread") {
    query = query
      .order("unread_count", { ascending: false })
      .order("last_message_at", { ascending: false });
  } else {
    query = query.order("last_message_at", { ascending: false });
  }

  const { data, error } = await query.limit(100);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ conversations: data ?? [] });
}
