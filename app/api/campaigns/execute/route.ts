import { createClient } from "@/lib/supabase/server";
import { getSessionUser } from "@/lib/auth";
import { NextRequest, NextResponse } from "next/server";
import { getBillingMode } from "@/lib/billing/guarded-send";
import { getWholesalePaise } from "@/lib/billing/rates";
import { quoteSendCostPaise, toBillableCategory, type MessageCategory } from "@/lib/billing/pricing";
import { reserve, InsufficientBalanceError } from "@/lib/billing/wallet";
import { dispatchEvent } from "@/lib/webhooks-out";
import { consentPolicyFor, splitByConsent } from "@/lib/compliance/consent";
import { templateSendability } from "@/lib/whatsapp/template-sendable";
import { enqueueCampaignSend } from "@/lib/campaigns/worker";

// SendAnjal's own per-message platform fee (paise). This is our margin, NOT a Meta
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
 * `meta_rates`) + SendAnjal's flat platform fee. Managed users price via
 * quoteSendCostPaise instead (wholesale × tier markup).
 */
async function byoUnitCostPaise(category: MessageCategory): Promise<number> {
  const wholesale = (await getWholesalePaise(category)) ?? FALLBACK_WHOLESALE_PAISE[category];
  return wholesale + PLATFORM_FEE_PAISE;
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
    .select("id, name, display_name, body, variables, language, category, status, meta_template_id")
    .eq("id", templateId)
    .eq("user_id", user.id)
    .single();

  if (tmplErr || !template) return NextResponse.json({ error: "Template not found" }, { status: 404 });
  // APPROVED alone is not enough: a row can be APPROVED locally while
  // `meta_template_id` is null, meaning Meta never received it. Sending that
  // fails with a misleading "(#132001) Template name does not exist in the
  // translation". Check both. See lib/whatsapp/template-sendable.ts.
  const sendability = templateSendability(template);
  if (!sendability.sendable) {
    return NextResponse.json(
      { error: sendability.message, code: sendability.reason },
      { status: 400 },
    );
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

  // ── Consent gate ──────────────────────────────────────────────────────────
  // For verticals flagged `requires_explicit_consent` (Hospital: DPDP health
  // data; School: minors' data), drop contacts who have not explicitly
  // consented. Filtering rather than refusing the whole campaign is deliberate:
  // blocking a send to 797 consenting patients because 3 have not consented
  // would be the wrong trade. The blocked count is reported, never silent.
  //
  // CSV audiences are pseudo-contacts with no row to carry consent, so under a
  // consent-required vertical they cannot be verified and are refused outright.
  let consentBlocked = 0;
  const consentPolicy = await consentPolicyFor(user.id);
  if (consentPolicy.required) {
    if (audienceType === "csv") {
      return NextResponse.json(
        {
          error:
            `${consentPolicy.verticalName} accounts can't send to an uploaded list — ` +
            `consent has to be recorded against a saved contact first.`,
        },
        { status: 422 },
      );
    }
    const split = await splitByConsent(user.id, contacts.map((c) => c.id));
    const allowed = new Set(split.allowed);
    consentBlocked = split.blocked.length;
    contacts = contacts.filter((c) => allowed.has(c.id));
  }

  if (contacts.length === 0) {
    return NextResponse.json(
      {
        error: consentBlocked > 0
          ? `None of the ${consentBlocked} contacts in this audience have given consent yet, ` +
            `so there's no one to send to.`
          : "No contacts found for the selected audience",
        consentBlocked: consentBlocked || undefined,
      },
      { status: consentBlocked > 0 ? 422 : 400 },
    );
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
      // Persisted for the fan-out worker to rehydrate (migration 035). These
      // were previously request-memory only, which is why the send could not
      // survive the response being flushed.
      variable_mapping: variableMapping,
      unit_cost_paise: unitCostPaise,
      billing_mode: billingMode,
    })
    .select()
    .single();

  if (campErr || !campaign) {
    return NextResponse.json({ error: campErr?.message || "Failed to create campaign" }, { status: 500 });
  }

  // Bulk insert campaign_messages. CSV-uploaded recipients are included with a
  // NULL contact_id and their name carried on the row: campaign_messages is the
  // worker's cursor, so anyone missing from it would simply never be sent to.
  const messageRows = contacts.map((c) => {
    const isCsv = c.id.startsWith("csv-");
    return {
      campaign_id: campaign.id,
      contact_id: isCsv ? null : c.id,
      phone: c.phone,
      recipient_name: c.name ?? null,
      status: "pending",
    };
  });

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

    if (reservationId) {
      await supabase
        .from("campaigns")
        .update({ reservation_id: reservationId })
        .eq("id", campaign.id);
    }
  }

  // Law #4: hand the fan-out to the queue and return. The worker claims batches
  // off campaign_messages, so the broadcast survives this function being frozen
  // or reclaimed, and resumes exactly where it stopped rather than restarting.
  await enqueueCampaignSend({ campaignId: campaign.id, userId: user.id });

  return NextResponse.json(
    {
      campaignId: campaign.id,
      status: "running",
      recipients: contacts.length,
      // Reported on the SUCCESS path too. A campaign that quietly went to 797
      // of 800 people, with no mention of the 3 it skipped, is a lie about what
      // happened — and the tenant needs to know who to collect consent from.
      ...(consentBlocked > 0
        ? {
            consentBlocked,
            consentNote:
              `${consentBlocked} contact${consentBlocked === 1 ? "" : "s"} skipped — ` +
              `no consent on record yet.`,
          }
        : {}),
    },
    { status: 201 }
  );
}
