import { createClient } from "@/lib/supabase/server";
import { decrypt } from "@/lib/crypto";
import { getSessionUser } from "@/lib/auth";
import { NextRequest, NextResponse } from "next/server";
import { sendTemplateMessage } from "@/lib/meta";
import { getBillingMode } from "@/lib/billing/guarded-send";
import { quoteSendCostPaise, toBillableCategory, type MessageCategory } from "@/lib/billing/pricing";
import { deriveQuote, getWholesalePaise } from "@/lib/billing/rates";
import { reserve, settle, release, InsufficientBalanceError } from "@/lib/billing/wallet";
import { dispatchEvent } from "@/lib/webhooks-out";

const BATCH_SIZE = 50;

// WASend's own per-message platform fee (paise). This is our margin, NOT a Meta
// rate — Meta wholesale rates are never hardcoded (Law #2); they come from the
// `meta_rates` table via getWholesalePaise().
const PLATFORM_FEE_PAISE = 30;

// Last-resort wholesale fallback (paise) used only when `meta_rates` has no row
// for the category — e.g. a deploy before migration 017 is seeded. The table is
// always the source of truth; these keep an unconfigured install from charging 0.
const FALLBACK_WHOLESALE_PAISE: Record<MessageCategory, number> = {
  MARKETING: 150,
  UTILITY: 80,
  AUTHENTICATION: 80,
  SERVICE: 0,
};

/**
 * Resolve the BYO per-message cost in integer paise: Meta wholesale (from
 * `meta_rates`) + WASend's flat platform fee. Managed users price via
 * quoteSendCostPaise instead (wholesale × tier markup).
 */
async function byoUnitCostPaise(category: MessageCategory): Promise<number> {
  const wholesale = (await getWholesalePaise(category)) ?? FALLBACK_WHOLESALE_PAISE[category];
  return wholesale + PLATFORM_FEE_PAISE;
}

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
  billingMode,
  reservationId,
  costPaise,
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
  billingMode: string;
  reservationId: string | null;
  costPaise: number;
}) {
  let totalSent = 0;
  let totalFailed = 0;
  const today = new Date().toISOString().split("T")[0];
  // Rupee cost per message, derived from the resolved per-message paise (rate
  // table + fee) passed in — never from hardcoded Meta rates.
  const costPerMsg = costPaise / 100;

  // Margin trail for the prepaid ledger (one category per campaign). null pre-017
  // or for BYO → no tagging. wholesale is the real Meta cost regardless of pricing.
  const billableCategory = toBillableCategory(category);
  const marginTrail =
    billingMode === "managed" ? await deriveQuote(userId, billableCategory) : null;

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

        // Managed: settle one unit of the reservation per success (idempotent).
        if (reservationId && costPaise > 0) {
          const unitIdem = `cm:${campaignId}:${contact.id}`;
          await settle({
            reservationId,
            actualPaise: costPaise,
            unitIdempotencyKey: unitIdem,
            referenceId: campaignId,
          }).catch((e) => console.error("wallet settle failed:", e));

          // Best-effort margin trail on the ledger row settle just wrote.
          if (marginTrail) {
            await supabase
              .from("transactions")
              .update({
                category: billableCategory,
                wholesale_paise: marginTrail.wholesalePaise,
                markup_bps: marginTrail.markupBps,
              })
              .eq("user_id", userId)
              .eq("idempotency_key", unitIdem)
              .then(
                () => {},
                () => {},
              );
          }
        }

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

  dispatchEvent(supabase, userId, "campaign.completed", {
    id: campaignId, sent: totalSent, failed: totalFailed,
  }).catch(() => {});

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

  if (billingMode === "managed") {
    // Prepaid wallet: release the reservation — frees the hold for any
    // failed/unsent recipients (only settled successes were actually debited).
    if (reservationId) {
      await release(reservationId).catch((e) => console.error("wallet release failed:", e));
    }
  } else {
    // Legacy (byo) wallet debit — UNCHANGED behavior.
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

  // Resolve the per-message cost in integer paise from the rate tables — Meta
  // wholesale rates are never hardcoded (Law #2).
  //  • managed → wholesale × tier markup (quoteSendCostPaise)
  //  • byo     → wholesale (meta_rates) + flat platform fee
  const billableCategory = toBillableCategory(template.category);
  const billingMode = await getBillingMode(user.id);
  const unitCostPaise =
    billingMode === "managed"
      ? await quoteSendCostPaise(user.id, billableCategory)
      : await byoUnitCostPaise(billableCategory);
  const totalCost = (unitCostPaise / 100) * contacts.length;

  // Billing track:
  //  • managed → new prepaid wallet (reserved below, once the campaign row exists)
  //  • byo     → existing legacy wallet pre-check, UNCHANGED
  if (billingMode !== "managed") {
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

  // Managed: reserve the whole broadcast now (hard stop). The campaign row already
  // exists, so on an unaffordable reserve we mark it failed and refuse to send.
  let reservationId: string | null = null;
  if (billingMode === "managed" && unitCostPaise > 0) {
    try {
      reservationId = await reserve({
        userId: user.id,
        amountPaise: unitCostPaise * contacts.length,
        referenceId: campaign.id,
        idempotencyKey: `campaign:${campaign.id}`,
      });
    } catch (err) {
      if (err instanceof InsufficientBalanceError) {
        await supabase.from("campaigns").update({ status: "failed" }).eq("id", campaign.id);
        const needed = ((unitCostPaise * contacts.length) / 100).toFixed(2);
        return NextResponse.json(
          { error: `Insufficient balance: need ₹${needed} for ${contacts.length} messages.`, code: "INSUFFICIENT_BALANCE" },
          { status: 402 }
        );
      }
      throw err;
    }
  }

  // Fire-and-forget
  processCampaign({
    campaignId: campaign.id,
    contacts,
    phoneNumberId: number.phone_number_id,
    accessToken: await decrypt(number.access_token),
    templateName: template.name,
    languageCode: template.language || "en",
    variables: template.variables || [],
    variableMapping,
    category: template.category || "UTILITY",
    supabase,
    userId: user.id,
    billingMode,
    reservationId,
    costPaise: unitCostPaise,
  }).catch((err) => console.error("Campaign execution error:", err));

  return NextResponse.json(
    { campaignId: campaign.id, status: "running", recipients: contacts.length },
    { status: 201 }
  );
}
