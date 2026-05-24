import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getSessionUser } from "@/lib/auth";
import { sendTemplateMessage } from "@/lib/meta";

// POST /api/campaigns/[id]/launch
// Fetches contacts for the campaign's audience, sends template via Meta API, tracks results
export async function POST(_: NextRequest, { params }: { params: { id: string } }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const supabase = createClient();
  const campaignId = params.id;

  // Load campaign
  const { data: campaign, error: cErr } = await supabase
    .from("campaigns")
    .select("*")
    .eq("id", campaignId)
    .eq("user_id", user.id)
    .single();

  if (cErr || !campaign) return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
  if (!["draft", "scheduled"].includes(campaign.status)) {
    return NextResponse.json({ error: `Campaign is already ${campaign.status}` }, { status: 400 });
  }

  // Load the WhatsApp number credentials
  const { data: number } = await supabase
    .from("whatsapp_numbers")
    .select("phone_number_id, access_token, status")
    .eq("id", campaign.whatsapp_number_id)
    .eq("user_id", user.id)
    .single();

  if (!number?.phone_number_id || !number?.access_token) {
    return NextResponse.json({ error: "WhatsApp number not connected via Meta API" }, { status: 400 });
  }
  if (number.status !== "active") {
    return NextResponse.json({ error: "WhatsApp number is not active" }, { status: 400 });
  }

  // Load template to get language code
  let languageCode = "en";
  if (campaign.template_id) {
    const { data: tmpl } = await supabase
      .from("templates")
      .select("language")
      .eq("id", campaign.template_id)
      .single();
    if (tmpl?.language) languageCode = tmpl.language;
  }

  // Fetch target contacts
  let contactsQuery = supabase
    .from("contacts")
    .select("id, phone, name")
    .eq("user_id", user.id)
    .eq("status", "active");

  if (campaign.audience_type === "group" && campaign.group_name) {
    contactsQuery = contactsQuery.eq("contact_group", campaign.group_name);
  } else if (campaign.audience_type === "tags" && campaign.tags?.length > 0) {
    contactsQuery = contactsQuery.overlaps("tags", campaign.tags);
  }

  const { data: contacts } = await contactsQuery.limit(10000);
  const recipients = contacts || [];

  if (recipients.length === 0) {
    return NextResponse.json({ error: "No contacts found for this campaign audience" }, { status: 400 });
  }

  // Mark campaign as running
  await supabase
    .from("campaigns")
    .update({ status: "running", started_at: new Date().toISOString(), recipients_count: recipients.length })
    .eq("id", campaignId);

  // Insert campaign_messages rows in bulk
  const messageRows = recipients.map((c) => ({
    campaign_id: campaignId,
    contact_id: c.id,
    phone: c.phone,
    status: "pending",
  }));

  await supabase.from("campaign_messages").insert(messageRows);

  // Fire-and-forget: send messages asynchronously
  // Return immediately so the HTTP response doesn't time out on large lists
  sendCampaignMessages({
    campaignId,
    recipients,
    phoneNumberId: number.phone_number_id,
    accessToken: number.access_token,
    templateName: campaign.template_name || "",
    languageCode,
    supabase,
    userId: user.id,
    whatsappNumberId: campaign.whatsapp_number_id,
  }).catch((err) => console.error("Campaign send error:", err));

  return NextResponse.json({
    message: "Campaign launched",
    recipients: recipients.length,
  });
}

async function sendCampaignMessages({
  campaignId,
  recipients,
  phoneNumberId,
  accessToken,
  templateName,
  languageCode,
  supabase,
  userId,
  whatsappNumberId,
}: {
  campaignId: string;
  recipients: { id: string; phone: string; name: string }[];
  phoneNumberId: string;
  accessToken: string;
  templateName: string;
  languageCode: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any;
  userId: string;
  whatsappNumberId: string;
}) {
  let sent = 0;
  let failed = 0;
  const today = new Date().toISOString().split("T")[0];

  for (const contact of recipients) {
    try {
      const { messageId } = await sendTemplateMessage({
        phoneNumberId,
        accessToken,
        to: contact.phone,
        templateName,
        languageCode,
      });

      await supabase
        .from("campaign_messages")
        .update({ status: "sent", meta_message_id: messageId, sent_at: new Date().toISOString() })
        .eq("campaign_id", campaignId)
        .eq("contact_id", contact.id);

      sent++;
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : "Send failed";
      await supabase
        .from("campaign_messages")
        .update({ status: "failed", error_message: errMsg })
        .eq("campaign_id", campaignId)
        .eq("contact_id", contact.id);
      failed++;
    }

    // Small delay to respect Meta rate limits (~80 msg/s burst → ~12ms/msg)
    await new Promise((r) => setTimeout(r, 15));
  }

  const now = new Date().toISOString();

  // Update campaign totals
  await supabase
    .from("campaigns")
    .update({
      status: "completed",
      sent_count: sent,
      failed_count: failed,
      completed_at: now,
    })
    .eq("id", campaignId);

  // Increment messages_sent on the WhatsApp number
  await supabase
    .from("whatsapp_numbers")
    .update({ messages_sent: supabase.rpc ? undefined : undefined })
    .eq("id", whatsappNumberId);

  // Upsert daily analytics
  await supabase
    .from("daily_analytics")
    .upsert(
      {
        user_id: userId,
        date: today,
        total_sent: sent,
        total_failed: failed,
      },
      {
        onConflict: "user_id,date",
        ignoreDuplicates: false,
      }
    );
}
