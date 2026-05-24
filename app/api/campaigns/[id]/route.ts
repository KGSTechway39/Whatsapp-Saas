import { createClient } from "@/lib/supabase/server";
import { getSessionUser } from "@/lib/auth";
import { NextRequest, NextResponse } from "next/server";

export async function GET(_: NextRequest, { params }: { params: { id: string } }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const supabase = createClient();

  // Load campaign with whatsapp number join
  const { data: campaign, error: campErr } = await supabase
    .from("campaigns")
    .select("*, whatsapp_numbers(phone_number, display_name)")
    .eq("id", params.id)
    .eq("user_id", user.id)
    .single();

  if (campErr || !campaign) {
    return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
  }

  // Load campaign messages with contact name join
  const { data: messages } = await supabase
    .from("campaign_messages")
    .select("id, contact_id, phone, status, sent_at, delivered_at, read_at, error_message, contacts(name)")
    .eq("campaign_id", params.id)
    .order("sent_at", { ascending: true });

  const msgs = messages || [];

  // Build time series grouped by hour
  const hourMap = new Map<string, { sent: number; delivered: number; read: number }>();
  for (const msg of msgs) {
    if (!msg.sent_at) continue;
    const hour = new Date(msg.sent_at).toISOString().slice(0, 13) + ":00";
    const slot = hourMap.get(hour) || { sent: 0, delivered: 0, read: 0 };
    slot.sent++;
    if (msg.status === "delivered" || msg.status === "read") slot.delivered++;
    if (msg.status === "read") slot.read++;
    hourMap.set(hour, slot);
  }
  const timeSeries = Array.from(hourMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([hour, stats]) => ({ hour, ...stats }));

  // Failed messages table
  const failedMessages = msgs
    .filter((m) => m.status === "failed")
    .map((m) => ({
      id: m.id,
      phone: m.phone,
      contactName: (m.contacts as { name?: string } | null)?.name || "Unknown",
      error: m.error_message || "Unknown error",
      failedAt: m.sent_at || null,
    }));

  // Cost breakdown
  const totalCost = Number(campaign.cost) || 0;
  const category = (campaign.category || "").toUpperCase();
  const metaRate = category === "MARKETING" ? 1.50 : 0.80;
  const platformRate = 0.30;
  const totalRate = metaRate + platformRate;
  const metaFee = totalRate > 0 ? (totalCost * (metaRate / totalRate)) : 0;
  const platformFee = totalCost - metaFee;

  const wn = campaign.whatsapp_numbers as { phone_number?: string; display_name?: string } | null;

  return NextResponse.json({
    campaign: {
      id: campaign.id,
      name: campaign.name,
      status: campaign.status,
      templateId: campaign.template_id,
      templateName: campaign.template_name,
      numberId: campaign.whatsapp_number_id,
      sendingNumber: wn?.phone_number || null,
      sendingNumberName: wn?.display_name || null,
      audienceType: campaign.audience_type,
      tags: campaign.tags || [],
      recipientsCount: campaign.recipients_count || 0,
      sentCount: campaign.sent_count || 0,
      deliveredCount: campaign.delivered_count || 0,
      failedCount: campaign.failed_count || 0,
      readCount: campaign.read_count || 0,
      repliedCount: campaign.replied_count || 0,
      scheduledAt: campaign.scheduled_at,
      startedAt: campaign.started_at,
      completedAt: campaign.completed_at,
      cost: totalCost,
      createdAt: campaign.created_at,
    },
    timeSeries,
    failedMessages,
    costBreakdown: {
      metaFee: Math.round(metaFee * 100) / 100,
      platformFee: Math.round(platformFee * 100) / 100,
      total: Math.round(totalCost * 100) / 100,
    },
  });
}

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const supabase = createClient();
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();

  const updateData: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (body.status) updateData.status = body.status;
  if (body.sentCount !== undefined) updateData.sent_count = body.sentCount;
  if (body.deliveredCount !== undefined) updateData.delivered_count = body.deliveredCount;
  if (body.failedCount !== undefined) updateData.failed_count = body.failedCount;
  if (body.completedAt) updateData.completed_at = body.completedAt;

  const { data, error } = await supabase
    .from("campaigns")
    .update(updateData)
    .eq("id", params.id)
    .eq("user_id", user.id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ id: data.id, status: data.status });
}

export async function DELETE(_: NextRequest, { params }: { params: { id: string } }) {
  const supabase = createClient();
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { error } = await supabase
    .from("campaigns")
    .delete()
    .eq("id", params.id)
    .eq("user_id", user.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ message: "Campaign deleted" });
}
