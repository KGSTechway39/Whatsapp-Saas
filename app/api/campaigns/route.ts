import { createClient } from "@/lib/supabase/server";
import { getSessionUser } from "@/lib/auth";
import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  const supabase = createClient();
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const status = searchParams.get("status");
  const limit = parseInt(searchParams.get("limit") || "50");

  let query = supabase
    .from("campaigns")
    .select("*")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (status && status !== "all") {
    query = query.eq("status", status);
  }

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const campaigns = data.map((c) => ({
    id: c.id,
    name: c.name,
    status: c.status,
    templateId: c.template_id,
    templateName: c.template_name,
    numberId: c.whatsapp_number_id,
    recipients: c.recipients_count,
    sent: c.sent_count,
    delivered: c.delivered_count,
    failed: c.failed_count,
    read: c.read_count,
    scheduledAt: c.scheduled_at,
    createdAt: c.created_at,
    completedAt: c.completed_at,
    cost: c.cost,
  }));

  return NextResponse.json({ campaigns });
}

export async function POST(request: NextRequest) {
  const supabase = createClient();
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const {
    name, description, templateId, templateName, whatsappNumberId,
    audienceType, groupName, tags, recipientsCount, scheduledAt, cost,
  } = body;

  if (!name) return NextResponse.json({ error: "Campaign name required" }, { status: 400 });

  const status = scheduledAt ? "scheduled" : "draft";

  const { data, error } = await supabase
    .from("campaigns")
    .insert({
      user_id: user.id,
      name,
      description: description || null,
      status,
      template_id: templateId || null,
      template_name: templateName || null,
      whatsapp_number_id: whatsappNumberId || null,
      audience_type: audienceType || null,
      group_name: groupName || null,
      tags: tags || [],
      recipients_count: recipientsCount || 0,
      scheduled_at: scheduledAt || null,
      cost: cost || 0,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({
    id: data.id,
    name: data.name,
    status: data.status,
    createdAt: data.created_at,
  }, { status: 201 });
}
