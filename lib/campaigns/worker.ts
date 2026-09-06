/**
 * Campaign fan-out worker — the durable half of /api/campaigns/execute.
 *
 * WHY THIS EXISTS
 * The route used to call processCampaign() without awaiting it and return 201
 * straight away. On serverless the instance can be frozen the instant the
 * response is flushed, so a large broadcast was silently truncated — and since
 * the prepaid reservation was only released at the very end of that loop, a
 * truncated run also stranded the hold on the tenant's wallet. That is Law #4:
 * handlers verify + persist + enqueue + return fast; workers call Meta.
 *
 * SHAPE
 * One job = one BATCH, not one campaign. The worker claims up to BATCH_SIZE
 * pending recipients, sends them, then re-enqueues itself if any remain. That
 * keeps every individual job short (well inside any function timeout) and makes
 * the whole broadcast resumable: campaign_messages.status IS the cursor, so a
 * crashed or reclaimed batch simply gets picked up again with no re-sending of
 * anyone already handled.
 *
 * MONEY
 * Semantics are carried over unchanged from the inline implementation:
 *   • settle() one unit per SUCCESSFUL send, keyed idempotently per recipient
 *   • release() the remaining hold exactly once, when the campaign finalises
 *   • unit price is read from the campaign row (frozen at launch), never
 *     re-derived mid-flight, so a meta_rates change cannot reprice a broadcast
 * A message that never reaches Meta is never settled, so it is never charged.
 */

import { createClient } from "@/lib/supabase/server";
import { decrypt } from "@/lib/crypto";
import { sendTemplateMessage } from "@/lib/meta";
import { settle, release } from "@/lib/billing/wallet";
import { deriveQuote } from "@/lib/billing/rates";
import { toBillableCategory } from "@/lib/billing/pricing";
import { dispatchEvent } from "@/lib/webhooks-out";
import { enqueue, registerHandler } from "@/lib/queue";
import { logger } from "@/lib/logger";

export const CAMPAIGN_SEND_JOB = "campaign:send-batch";

/** Recipients handled per job. Small enough to finish well inside a function timeout. */
const BATCH_SIZE = 50;

/** Gap between sends, to stay polite against Meta's per-number throughput. */
const SEND_SPACING_MS = 15;

export interface CampaignSendJob {
  campaignId: string;
  userId: string;
}

type VariableMapping = Record<string, { type: "name" | "phone" | "custom"; value?: string }>;

/**
 * Bind template variables for one recipient. Mirrors the route's original
 * buildTemplateComponents so rendering is identical to the pre-queue behaviour.
 */
function buildTemplateComponents(
  variableMapping: VariableMapping,
  contact: { name: string; phone: string },
  variables: string[],
): unknown[] {
  if (!variables || variables.length === 0) return [];

  const parameters = variables.map((_, i) => {
    const mapping = variableMapping?.[`v${i}`];
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

/** Hand a campaign to the queue. Returns as soon as the job is accepted. */
export async function enqueueCampaignSend(job: CampaignSendJob): Promise<void> {
  await enqueue(CAMPAIGN_SEND_JOB, job);
}

registerHandler<CampaignSendJob>(CAMPAIGN_SEND_JOB, runCampaignBatch);

export async function runCampaignBatch(job: CampaignSendJob): Promise<void> {
  const { campaignId, userId } = job;
  const supabase = createClient();

  // Always re-read the campaign: another batch may have finalised it, and the
  // tenant may have paused or cancelled since this job was enqueued.
  const { data: campaign } = await supabase
    .from("campaigns")
    .select("id, user_id, status, template_id, whatsapp_number_id, variable_mapping, reservation_id, unit_cost_paise, billing_mode, sent_count, failed_count")
    .eq("id", campaignId)
    .eq("user_id", userId) // tenant scope — never trust the job payload alone
    .single();

  if (!campaign) {
    logger.warn("campaign worker: campaign not found", { campaignId, userId });
    return;
  }
  if (campaign.status !== "running") {
    logger.info("campaign worker: not running, stopping", {
      campaignId,
      status: campaign.status,
    });
    return;
  }

  // ── Claim a batch ────────────────────────────────────────────────────────
  // Two steps, and the second is the important one: the UPDATE carries
  // .eq("status","pending"), so it is a compare-and-set. If a duplicate job or a
  // second worker raced us, only one of them flips a given row and only that one
  // gets it back from .select(). Nobody can send the same recipient twice.
  const { data: candidates } = await supabase
    .from("campaign_messages")
    .select("id")
    .eq("campaign_id", campaignId)
    .eq("status", "pending")
    .limit(BATCH_SIZE);

  const candidateIds = (candidates ?? []).map((r: { id: string }) => r.id);

  if (candidateIds.length === 0) {
    await finaliseCampaign(supabase, campaign, userId);
    return;
  }

  const { data: claimed } = await supabase
    .from("campaign_messages")
    .update({ status: "sending" })
    .in("id", candidateIds)
    .eq("status", "pending")
    .select("id, contact_id, phone, recipient_name");

  const rows = (claimed ?? []) as Array<{
    id: string;
    contact_id: string | null;
    phone: string;
    recipient_name: string | null;
  }>;

  if (rows.length === 0) {
    // Everything we eyed was taken by another worker. Re-queue to make progress
    // on whatever is left rather than finalising a campaign that is still going.
    await enqueueCampaignSend(job);
    return;
  }

  // ── Rehydrate everything the send needs ──────────────────────────────────
  const [{ data: number }, { data: template }] = await Promise.all([
    supabase
      .from("whatsapp_numbers")
      .select("phone_number_id, access_token")
      .eq("id", campaign.whatsapp_number_id)
      .eq("user_id", userId)
      .single(),
    supabase
      .from("templates")
      .select("name, language, variables, category")
      .eq("id", campaign.template_id)
      .single(),
  ]);

  if (!number || !template) {
    // Unsendable: put the batch back so nothing is lost, then fail the campaign.
    await supabase
      .from("campaign_messages")
      .update({ status: "pending" })
      .in("id", rows.map((r) => r.id));
    await supabase.from("campaigns").update({ status: "failed" }).eq("id", campaignId);
    if (campaign.reservation_id) {
      await release(campaign.reservation_id).catch((e) =>
        logger.error("campaign worker: release failed", { campaignId, error: String(e) }),
      );
    }
    logger.error("campaign worker: number or template missing", { campaignId });
    return;
  }

  // Names for template variables. CSV recipients carry their own name on the
  // message row because they have no contacts entry to join to.
  const contactIds = rows.map((r) => r.contact_id).filter((v): v is string => Boolean(v));
  const nameById = new Map<string, string>();
  if (contactIds.length > 0) {
    const { data: contacts } = await supabase
      .from("contacts")
      .select("id, name")
      .eq("user_id", userId)
      .in("id", contactIds);
    for (const c of (contacts ?? []) as Array<{ id: string; name: string | null }>) {
      if (c.name) nameById.set(c.id, c.name);
    }
  }

  const accessToken = await decrypt(number.access_token);
  const variableMapping = (campaign.variable_mapping ?? {}) as VariableMapping;
  const variables: string[] = template.variables ?? [];
  const unitCostPaise: number = campaign.unit_cost_paise ?? 0;
  const reservationId: string | null = campaign.reservation_id ?? null;

  const billableCategory = toBillableCategory(template.category || "UTILITY");
  const marginTrail =
    campaign.billing_mode === "managed" ? await deriveQuote(userId, billableCategory) : null;

  // ── Send the batch ───────────────────────────────────────────────────────
  let batchSent = 0;
  let batchFailed = 0;

  for (const row of rows) {
    const recipient = {
      name: (row.contact_id ? nameById.get(row.contact_id) : row.recipient_name) || "there",
      phone: row.phone,
    };

    try {
      const { messageId } = await sendTemplateMessage({
        phoneNumberId: number.phone_number_id,
        accessToken,
        to: row.phone,
        templateName: template.name,
        languageCode: template.language || "en",
        components: buildTemplateComponents(variableMapping, recipient, variables),
      });

      await supabase
        .from("campaign_messages")
        .update({
          status: "sent",
          meta_message_id: messageId,
          sent_at: new Date().toISOString(),
        })
        .eq("id", row.id);

      // Settle one unit per success. Keyed on the message ROW id (not contact
      // id) so CSV recipients — who have no contact_id — still get a distinct,
      // stable idempotency key and cannot be double-charged on a retry.
      if (reservationId && unitCostPaise > 0) {
        const unitIdem = `cm:${campaignId}:${row.id}`;
        await settle({
          reservationId,
          actualPaise: unitCostPaise,
          unitIdempotencyKey: unitIdem,
          referenceId: campaignId,
        }).catch((e) =>
          logger.error("campaign worker: settle failed", {
            campaignId,
            rowId: row.id,
            error: String(e),
          }),
        );

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
        .eq("id", row.id);
      batchFailed++;
    }

    if (SEND_SPACING_MS > 0) {
      await new Promise((r) => setTimeout(r, SEND_SPACING_MS));
    }
  }

  // Counters are incremented from the values we just read rather than recounted,
  // matching the original behaviour; the authoritative per-recipient record is
  // campaign_messages either way.
  await supabase
    .from("campaigns")
    .update({
      sent_count: (campaign.sent_count ?? 0) + batchSent,
      failed_count: (campaign.failed_count ?? 0) + batchFailed,
    })
    .eq("id", campaignId);

  // ── Continue or finish ───────────────────────────────────────────────────
  const { count: remaining } = await supabase
    .from("campaign_messages")
    .select("id", { count: "exact", head: true })
    .eq("campaign_id", campaignId)
    .in("status", ["pending", "sending"]);

  if ((remaining ?? 0) > 0) {
    await enqueueCampaignSend(job);
  } else {
    const { data: fresh } = await supabase
      .from("campaigns")
      .select("id, status, reservation_id, unit_cost_paise, billing_mode, sent_count, failed_count")
      .eq("id", campaignId)
      .single();
    if (fresh) await finaliseCampaign(supabase, fresh, userId);
  }
}

/**
 * Close out a campaign: mark complete, roll up analytics, notify, and settle the
 * wallet's loose ends.
 *
 * Guarded by a compare-and-set on status ('running' -> 'completed'), because
 * release() must run EXACTLY once. Two workers finishing their last batch
 * simultaneously would otherwise both release the same hold.
 */
async function finaliseCampaign(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  campaign: {
    id: string;
    status?: string;
    reservation_id?: string | null;
    unit_cost_paise?: number | null;
    billing_mode?: string | null;
    sent_count?: number | null;
    failed_count?: number | null;
  },
  userId: string,
): Promise<void> {
  const campaignId = campaign.id;
  const now = new Date().toISOString();
  const sent = campaign.sent_count ?? 0;
  const failed = campaign.failed_count ?? 0;
  const actualCost = (sent * (campaign.unit_cost_paise ?? 0)) / 100;

  const { data: closed } = await supabase
    .from("campaigns")
    .update({
      status: "completed",
      completed_at: now,
      cost: actualCost,
    })
    .eq("id", campaignId)
    .eq("status", "running") // ← only one worker wins this
    .select("id");

  if (!closed || closed.length === 0) return; // someone else finalised it

  dispatchEvent(supabase, userId, "campaign.completed", {
    id: campaignId,
    sent,
    failed,
  }).catch(() => {});

  const today = now.split("T")[0];
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
      total_sent: (existing?.total_sent || 0) + sent,
      total_failed: (existing?.total_failed || 0) + failed,
    },
    { onConflict: "user_id,date" },
  );

  if (campaign.billing_mode === "managed") {
    // Free the hold for everyone who was never sent to. Only settled successes
    // were actually debited, so this returns the difference to the tenant.
    if (campaign.reservation_id) {
      await release(campaign.reservation_id).catch((e) =>
        logger.error("campaign worker: release failed", { campaignId, error: String(e) }),
      );
    }
  } else {
    // Legacy BYO wallet debit — behaviour carried over unchanged.
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
        description: `Campaign: ${campaignId} — ${sent} messages sent`,
        amount: actualCost,
        balance_after: newBalance,
        payment_method: "wallet",
      });
    }
  }
}
