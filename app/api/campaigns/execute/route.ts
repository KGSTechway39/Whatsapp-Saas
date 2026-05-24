import { createClient } from "@/lib/supabase/server";
import { getSessionUser } from "@/lib/auth";
import { NextRequest, NextResponse } from "next/server";
import { sendTemplateMessage } from "@/lib/meta";

const BATCH_SIZE = 50;
const META_COST_MARKETING = 1.50;
const META_COST_OTHER = 0.80;
const PLATFORM_FEE = 0.30;

function buildTemplateComponents(
  variableMapping: Record<string, { type: "name" | "phone" | "custom"; value?: string }>,
  contact: { name: string; phone: string },
  variables: string[]
): unknown[] {
  if (!variables || variables.length === 0) return [];

  const parameters = variables.map((_, i) => {
    const key = `v${i}`;
    const mapping = variableMapping?.[key];
    let text = contact.name; // default

    if (mapping) {
      if (mapping.type === "name") text = contact.name;
      else if (mapping.type === "phone") text = contact.phone;
      else if (mapping.type === "custom" && mapping.value) text = mapping.value;
    }

    return { type: "text", text };
  });

  return [{ type: "body", parameters }];
}

async function processCampaign({
  campaignId,
  contacts,
  phoneNumberId,
  accessToken,
  templateName,
  languageCode,
  variables,
  variableMapping,
  category,
  supabase,
  userId,
}: {
  campaignId: string;
  contacts: { id: string; phone: string; name: string }[];
  phoneNumberId: string;
  accessToken: string;
  templateName: string;
  languageCode: string;
  variables: string[];
  variableMapping: Record<string, { type: "name" | "phone" | "custom"; value?: string }>;
  category: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any;
  userId: string;
}) {
  let totalSent = 0;
  let totalFailed = 0;
  const today = new Date().toISOString().split("T")[0];
  const metaCostPerMsg = category.toUpperCase() === "MARKETING" ? META_COST_MARKETING : META_COST_OTHER;
  const costPerMsg = metaCostPerMsg + PLATFORM_FEE;

  for (let i = 0; i < contacts.length; i += BATCH_SIZE) {
    const batch = contacts.slice(i, i + BATCH_SIZE);
    let batchSent = 0;
    let batchFailed = 0;

    for (const contact of batch) {
      try {
        const components = buildTemplateComponents(variableMapping, contact, variables);
        const { messageId } = await sendTemplateMessage({
          phoneNumberId,
          accessToken,
          to: contact.phone,
          templateName,
          languageCode,
          components,
        });

        await supabase
          .from("campaign_messages")
          .update({
            status: "sent",
            meta_message_id: messageId,
            sent_at: new Date().toISOString(),
          })
          .eq("campaign_id", campaignId)
          .eq("contact_id", contact.id);

        batchSent++;
      } catch (err: unknown) {
        const errMsg = err instanceof Error ? err.message : "Send failed";
        await supabase
          .from("campaign_messages")
          .update({ status: "failed", error_message: errMsg })
          .eq("campaign_id", campaignId)
          .eq("contact_id", contact.id);
        batchFailed++;
      }

      await new Promise((r) => setTimeout(r, 15));
    }

    totalSent += batchSent;
    totalFailed += batchFailed;

    // Update running totals after each batch
    await supabase
      .from("campaigns")
      .update({ sent_count: totalSent, failed_count: totalFailed })
      .eq("id", campaignId);
  }

  const now = new Date().toISOString();
  const actualCost = totalSent * costPerMsg;

  // Mark complete
  await supabase
    .from("campaigns")
    .update({
      status: "completed",
      sent_count: totalSent,
      failed_count: totalFailed,
      completed_at: now,
      cost: actualCost,
    })
    .eq("id", campaignId);

  // Upsert daily analytics
  const { data: existing } = await supabase
    .from("daily_analytics")
    .select("total_sent, total_failed")
    .eq("user_id", userId)
    .eq("date", today)
    .single();

  await supabase.from("daily_analytics").upsert(
    {
      user_id: userId,
      date: today,
      total_sent: (existing?.total_sent || 0) + totalSent,
      total_failed: (existing?.total_failed || 0) + totalFailed,
    },
    { onConflict: "user_id,date" }
  );

  // Debit wallet
  const { data: walletRow } = await supabase
    .from("wallet")
    .select("balance")
    .eq("user_id", userId)
    .single();

  if (walletRow) {
    const newBalance = Math.max(0, Number(walletRow.balance) - actualCost);
    await supabase
      .from("wallet")
      .update({ balance: newBalance, updated_at: now })
      .eq("user_id", userId);

    await supabase.from("transactions").insert({
      user_id: userId,
      type: "debit",
      description: `Campaign: ${campaignId} — ${totalSent} messages sent`,
      amount: actualCost,
      balance_after: newBalance,
      payment_method: "wallet",
    });
  }
}

export async function POST(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const supabase = createClient();
  const body = await request.json();

  const {
    name,
    numberId,
    templateId,
    audienceType = "all",
    selectedTags = [],
    csvContacts = [],
    excludeRecentHours = 0,
    variableMapping = {},
    sendNow = true,
    scheduleDate,
    scheduleTime,
  } = body;

  // Validate required fields
  if (!name) return NextResponse.json({ error: "Campaign name is required" }, { status: 400 });
  if (!numberId) return NextResponse.json({ error: "WhatsApp number is required" }, { status: 400 });
  if (!templateId) return NextResponse.json({ error: "Template is required" }, { status: 400 });

  // Load WhatsApp number
  const { data: number, error: numErr } = await supabase
    .from("whatsapp_numbers")
    .select("id, phone_number_id, access_token, status, phone_number")
    .eq("id", numberId)
    .eq("user_id", user.id)
    .single();

  if (numErr || !number) return NextResponse.json({ error: "WhatsApp number not found" }, { status: 404 });
  if (number.status !== "active") return NextResponse.json({ error: "WhatsApp number is not active" }, { status: 400 });
  if (!number.phone_number_id || !number.access_token) {
    return NextResponse.json({ error: "WhatsApp number not connected via Meta API" }, { status: 400 });
  }

  // Load template
  const { data: template, error: tmplErr } = await supabase
    .from("templates")
    .select("id, name, display_name, body, variables, language, category, status")
    .eq("id", templateId)
    .eq("user_id", user.id)
    .single();

  if (tmplErr || !template) return NextResponse.json({ error: "Template not found" }, { status: 404 });
  if (template.status !== "APPROVED") {
    return NextResponse.json({ error: "Template is not approved. Only APPROVED templates can be sent." }, { status: 400 });
  }

  // Resolve contacts
  let contacts: { id: string; phone: string; name: string }[] = [];

  if (audienceType === "csv") {
    // Use contacts from CSV upload
    contacts = (csvContacts as { name: string; phone: string }[]).map((c, idx) => ({
      id: `csv-${idx}`,
      phone: c.phone,
      name: c.name,
    }));
  } else {
    let query = supabase
      .from("contacts")
      .select("id, phone, name")
      .eq("user_id", user.id)
      .eq("status", "active");

    if (audienceType === "tags" && selectedTags.length > 0) {
      query = query.overlaps("tags", selectedTags);
    }

    const { data: contactRows, error: contactErr } = await query.limit(100000);
    if (contactErr) return NextResponse.json({ error: contactErr.message }, { status: 500 });
    contacts = contactRows || [];
  }

  // Exclude contacts who received a message recently
  if (excludeRecentHours > 0 && contacts.length > 0) {
    const cutoff = new Date(Date.now() - excludeRecentHours * 60 * 60 * 1000).toISOString();
    const contactIds = contacts.map((c) => c.id).filter((id) => !id.startsWith("csv-"));

    if (contactIds.length > 0) {
      const { data: recentMessages } = await supabase
        .from("campaign_messages")
        .select("contact_id")
        .in("contact_id", contactIds)
        .gte("sent_at", cutoff);

      if (recentMessages && recentMessages.length > 0) {
        const recentIds = new Set(recentMessages.map((m: { contact_id: string }) => m.contact_id));
        contacts = contacts.filter((c) => !recentIds.has(c.id));
      }
    }
  }

  if (contacts.length === 0) {
    return NextResponse.json({ error: "No contacts found for the selected audience" }, { status: 400 });
  }

  // Calculate cost
  const metaCostPerMsg = (template.category || "").toUpperCase() === "MARKETING" ? META_COST_MARKETING : META_COST_OTHER;
  const totalCost = (metaCostPerMsg + PLATFORM_FEE) * contacts.length;

  // Check wallet balance
  const { data: walletRow } = await supabase
    .from("wallet")
    .select("balance")
    .eq("user_id", user.id)
    .single();

  const available = walletRow ? Number(walletRow.balance) : 0;
  if (available < totalCost) {
    return NextResponse.json(
      {
        error: `Insufficient wallet balance. You need ₹${totalCost.toFixed(2)} but have ₹${available.toFixed(2)}.`,
        code: "INSUFFICIENT_BALANCE",
        needed: totalCost,
        available,
      },
      { status: 402 }
    );
  }

  // Build scheduledAt
  let scheduledAt: string | null = null;
  if (!sendNow && scheduleDate) {
    scheduledAt = `${scheduleDate}T${scheduleTime || "09:00"}:00`;
  }

  const campaignStatus = scheduledAt ? "scheduled" : "running";

  // Create campaign record
  const { data: campaign, error: campErr } = await supabase
    .from("campaigns")
    .insert({
      user_id: user.id,
      name,
      status: campaignStatus,
      template_id: template.id,
      template_name: template.display_name || template.name,
      whatsapp_number_id: numberId,
      audience_type: audienceType,
      tags: selectedTags,
      recipients_count: contacts.length,
      sent_count: 0,
      delivered_count: 0,
      failed_count: 0,
      read_count: 0,
      scheduled_at: scheduledAt,
      started_at: scheduledAt ? null : new Date().toISOString(),
      cost: totalCost,
    })
    .select()
    .single();

  if (campErr || !campaign) {
    return NextResponse.json({ error: campErr?.message || "Failed to create campaign" }, { status: 500 });
  }

  // Bulk insert campaign_messages (skip for CSV contacts with synthetic IDs)
  const messageRows = contacts
    .filter((c) => !c.id.startsWith("csv-"))
    .map((c) => ({
      campaign_id: campaign.id,
      contact_id: c.id,
      phone: c.phone,
      status: "pending",
    }));

  if (messageRows.length > 0) {
    await supabase.from("campaign_messages").insert(messageRows);
  }

  // If scheduled, return immediately
  if (scheduledAt) {
    return NextResponse.json(
      { campaignId: campaign.id, status: "scheduled", recipients: contacts.length },
      { status: 201 }
    );
  }

  // Fire-and-forget
  processCampaign({
    campaignId: campaign.id,
    contacts,
    phoneNumberId: number.phone_number_id,
    accessToken: number.access_token,
    templateName: template.name,
    languageCode: template.language || "en",
    variables: template.variables || [],
    variableMapping,
    category: template.category || "UTILITY",
    supabase,
    userId: user.id,
  }).catch((err) => console.error("Campaign execution error:", err));

  return NextResponse.json(
    { campaignId: campaign.id, status: "running", recipients: contacts.length },
    { status: 201 }
  );
}
