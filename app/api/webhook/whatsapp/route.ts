import { createServiceClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "crypto";
import { checkRateLimit, WEBHOOK_LIMIT, rateLimitHeaders } from "@/lib/rate-limit";
import { logger } from "@/lib/logger";
import { enqueueWebhookEvent } from "@/lib/whatsapp/queue";
import { ingestCatalogOrder, findContactByPhone, type MetaOrderPayload } from "@/lib/whatsapp/orders";
import { applyTemplateStatusEvent, type TemplateStatusValue } from "@/lib/whatsapp/template-events";
import { dispatchEvent, type WebhookEventName } from "@/lib/webhooks-out";
import { markEventProcessed, unmarkEvent } from "@/lib/whatsapp/dedup";
import { processStatusEvent, type StatusPayload } from "@/lib/whatsapp/status";
import { confirmOrReleaseBilling } from "@/lib/billing/confirm";
import { persistRawEvent, markInboxDone } from "@/lib/whatsapp/inbox";

const VERIFY_TOKEN = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN;
const APP_SECRET   = process.env.META_APP_SECRET;

// ─── Signature verification ────────────────────────────────────────────────────

function verifySignature(rawBody: Buffer, signature: string | null): boolean {
  if (!APP_SECRET) {
    // In development without secret, allow through (log a warning)
    if (process.env.NODE_ENV !== "production") return true;
    logger.error("META_APP_SECRET not set — webhook requests rejected");
    return false;
  }
  if (!signature) return false;

  const expected = `sha256=${createHmac("sha256", APP_SECRET).update(rawBody).digest("hex")}`;
  try {
    return timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  } catch {
    return false;
  }
}

// ─── Idempotency ───────────────────────────────────────────────────────────────
// DB-backed, per-event dedup via `processed_events` (see lib/whatsapp/dedup.ts).
// A unique constraint is the only thing that holds under Meta's concurrent retries.

// ─── GET — Meta webhook verification ──────────────────────────────────────────

export async function GET(request: NextRequest) {
  if (!VERIFY_TOKEN) {
    logger.error("WHATSAPP_WEBHOOK_VERIFY_TOKEN not set");
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const mode      = searchParams.get("hub.mode");
  const token     = searchParams.get("hub.verify_token");
  const challenge = searchParams.get("hub.challenge");

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    return new NextResponse(challenge, { status: 200 });
  }
  return NextResponse.json({ error: "Forbidden" }, { status: 403 });
}

// ─── POST — Incoming messages from Meta ───────────────────────────────────────

export async function POST(request: NextRequest) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0] ?? "unknown";

  // Rate limit per IP
  const rl = checkRateLimit(`wh:${ip}`, WEBHOOK_LIMIT);
  if (!rl.allowed) {
    return NextResponse.json({ error: "Too many requests" }, {
      status: 429,
      headers: rateLimitHeaders(rl),
    });
  }

  // Read raw body for signature verification
  const rawBody = Buffer.from(await request.arrayBuffer());
  const signature = request.headers.get("x-hub-signature-256");

  if (!verifySignature(rawBody, signature)) {
    logger.warn("Webhook signature mismatch", { ip, route: "/api/webhook/whatsapp" });
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = JSON.parse(rawBody.toString("utf-8"));
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // Per-event idempotency is enforced below in the message/status loops via
  // `processed_events` (DB unique constraint) — duplicates are skipped there.

  const supabase = createServiceClient();

  // Persist-then-enqueue: store the raw payload before any processing so it's
  // replayable if this handler dies mid-flight.
  const inboxId = await persistRawEvent(body, "/api/webhook/whatsapp");

  // ── Audit log: persist every event for replay/debug, get duplicate flag ──
  const entry0   = (body.entry as { id?: string; changes?: { field?: string; value?: Record<string, unknown> }[] }[])?.[0];
  const change0  = entry0?.changes?.[0];
  const value0   = change0?.value ?? {};
  const meta0    = value0.metadata as { phone_number_id?: string; display_phone_number?: string } | undefined;
  const messages0 = (value0.messages as { id?: string }[]) || [];
  const statuses0 = (value0.statuses as { id?: string }[]) || [];

  const eventType: "message" | "status" | "errors" | "ctwa_referral" | "unknown" =
    messages0.length > 0
      ? ((value0.messages as { referral?: unknown }[])?.[0]?.referral ? "ctwa_referral" : "message")
      : statuses0.length > 0
      ? "status"
      : value0.errors
      ? "errors"
      : "unknown";

  const metaEventId =
    messages0[0]?.id ??
    statuses0[0]?.id ??
    `entry:${entry0?.id || ""}:${Date.now()}`;

  // Resolve the receiving number from phone_number_id (best-effort, for the audit row).
  // Reads `whatsapp_numbers` — the deployed legacy model. This previously read
  // `whatsapp_accounts` (organization model, never deployed), so it was a guaranteed
  // failing round-trip on every webhook event. There is no organization in the
  // deployed schema, so organization_id stays null.
  let resolvedAccountId: string | null = null;
  const resolvedOrgId: string | null = null;
  if (meta0?.phone_number_id) {
    const { data: acct } = await supabase
      .from("whatsapp_numbers")
      .select("id")
      .eq("phone_number_id", meta0.phone_number_id)
      .maybeSingle();
    resolvedAccountId = acct?.id ?? null;
  }

  // NOTE: `webhook_logs` is NOT deployed (see docs/architecture/05-DATABASE.md drift
  // register), so this insert is currently a no-op that logs a warning, and the
  // 23505 duplicate branch below is unreachable. Per-event idempotency is carried by
  // `processed_events` in the loops further down, which IS deployed — so dedup is
  // sound today. Creating webhook_logs is tracked separately.
  let webhookLogId: string | null = null;
  let isDuplicate = false;
  try {
    const { data: ins, error: logErr } = await supabase
      .from("webhook_logs")
      .insert({
        organization_id: resolvedOrgId,
        whatsapp_account_id: resolvedAccountId,
        waba_id: entry0?.id || null,
        phone_number_id: meta0?.phone_number_id || null,
        event_type: eventType,
        meta_event_id: metaEventId,
        signature_valid: true,
        raw_payload: body,
        processing_status: "pending",
      })
      .select("id")
      .single();

    if (logErr) {
      const code = (logErr as { code?: string }).code;
      if (code === "23505") {
        // unique_violation on meta_event_id → already received
        isDuplicate = true;
      } else {
        logger.warn("Failed to insert webhook_log", { error: logErr.message });
      }
    } else {
      webhookLogId = ins?.id ?? null;
    }
  } catch (e) {
    logger.warn("webhook_log insert threw", { e: e instanceof Error ? e.message : String(e) });
  }

  if (isDuplicate) {
    return NextResponse.json({ status: "duplicate" });
  }

  // ── Template lifecycle (auto-receive) ──────────────────────────────────
  // We subscribe to `message_template_status_update`, so Meta pushes an event
  // whenever a template is created, approved, rejected or disabled — including
  // templates made directly in Meta's UI. Handling it here is what makes
  // templates arrive on their own instead of waiting for a manual Sync.
  if (change0?.field === "message_template_status_update") {
    const tv = value0 as TemplateStatusValue;
    const key = `wa_tmpl:${tv.message_template_id ?? tv.message_template_name}:${tv.event}`;
    if (await markEventProcessed(supabase, key, "template_status")) {
      try {
        const res = await applyTemplateStatusEvent(entry0?.id ?? null, tv);
        logger.info("webhook: template status event", { applied: res.applied, reason: res.reason });
        if (!res.applied) await unmarkEvent(supabase, key);
      } catch (err) {
        await unmarkEvent(supabase, key);
        logger.warn("webhook: template status event failed", { error: (err as Error).message });
      }
    }
    await markInboxDone(inboxId, true);
    return NextResponse.json({ status: "ok" });
  }

  // ── ASYNC HAND-OFF ─────────────────────────────────────────────────────
  // Push every inbound message + interactive reply to the worker queue so
  // the flow engine can process them without blocking the webhook response.
  // The mock implementation (lib/whatsapp/queue.ts) runs in-process; in
  // production swap it for BullMQ + Redis / Vercel Queues / Inngest.
  if (meta0?.phone_number_id) {
    const inbound = (value0.messages as Record<string, unknown>[] | undefined) ?? [];
    for (const msg of inbound) {
      const msgType = msg.type as string | undefined;
      const kind: "message" | "ctwa_referral" =
        (msg as { referral?: unknown }).referral ? "ctwa_referral" : "message";

      // Only forward text + interactive replies to the engine.
      if (msgType !== "text" && msgType !== "interactive") continue;

      // Dedup the engine hand-off independently of the inline processing below
      // (distinct key per consumer so a first delivery runs both, a redelivery
      // runs neither).
      if (!(await markEventProcessed(supabase, `wa_enq:${msg.id}`, "message"))) {
        continue;
      }

      void enqueueWebhookEvent({
        phoneNumberId: meta0.phone_number_id,
        payload: msg,
        kind,
        eventId: String(msg.id ?? metaEventId),
        receivedAt: Number(msg.timestamp ?? Math.floor(Date.now() / 1000)),
      });
    }
  }

  try {
    const entry   = (body.entry as {changes?:{value?:Record<string,unknown>}[]}[])?.[0];
    const changes = entry?.changes?.[0];
    const value   = changes?.value ?? {};

    // ── Status updates ──
    const statuses = (value.statuses as StatusPayload[]) ?? [];
    for (const status of statuses) {
      const { id: metaMessageId, status: msgStatus, timestamp } = status;

      const statusMap: Record<string, string> = {
        sent: "sent", delivered: "delivered", read: "read", failed: "failed",
      };
      const mappedStatus = statusMap[msgStatus];
      if (!mappedStatus) continue;

      // Dedup per (message_id, status) — Meta re-delivers status events.
      // Marked BEFORE the work on purpose: only the DB unique constraint can
      // reject two concurrent retries. The trade-off is handled below.
      const statusKey = `wa_status:${metaMessageId}:${msgStatus}`;
      if (!(await markEventProcessed(supabase, statusKey, "status"))) {
        continue;
      }

      // Apply with a monotonic rank (shared with the worker path).
      const applied = await processStatusEvent(status);

      // Confirm (settle) or release the prepaid reservation for this message.
      //
      // MONEY-CRITICAL: if this does not complete, un-mark the event so Meta's
      // retry runs it again. Marking-then-failing would strand the hold —
      // a `failed` status whose release never ran leaves the tenant's credit
      // reserved against a message that never sent, with nothing to retry it.
      // Safe to re-run: confirmOrReleaseBilling no-ops unless the row is still
      // 'reserved'.
      const billingOk = await confirmOrReleaseBilling(metaMessageId, msgStatus);
      if (!billingOk) {
        await unmarkEvent(supabase, statusKey);
        logger.warn("webhook: billing incomplete, event unmarked for retry", {
          metaMessageId, msgStatus,
        });
      }

      // Emit an outbound webhook for terminal/progress statuses so external
      // apps (e-commerce, CRM) get delivery updates. message.sent is emitted
      // at send time, so only relay delivered/read/failed — and only when the
      // status actually moved the row forward.
      if (applied && (mappedStatus === "delivered" || mappedStatus === "read" || mappedStatus === "failed")) {
        const { data: cm } = await supabase
          .from("campaign_messages")
          .select("id, phone, campaigns(user_id)")
          .eq("meta_message_id", metaMessageId)
          .maybeSingle();
        const ownerId = (cm?.campaigns as { user_id?: string } | null)?.user_id;
        if (ownerId) {
          dispatchEvent(
            supabase,
            ownerId,
            `message.${mappedStatus}` as WebhookEventName,
            {
              id: cm!.id,
              to: cm!.phone,
              wa_message_id: metaMessageId,
              status: mappedStatus,
              timestamp: new Date(Number(timestamp) * 1000).toISOString(),
            },
          ).catch(() => {});
        }
      }
    }

    // ── Incoming messages ──
    type IncomingMessage = {
      type: string; from: string; timestamp: string; id: string;
      text?: { body: string };
      referral?: {
        source_url?: string;
        source_id?: string;          // FB ad ID
        source_type?: string;        // "ad"
        ctwa_clid?: string;          // Click-to-WhatsApp click ID
        headline?: string;
        body?: string;
      };
      contacts?: { profile?: { name?: string } }[];
    };
    const messages = (value.messages as IncomingMessage[]) ?? [];
    const contactProfiles = (value.contacts as { profile?: { name?: string }; wa_id?: string }[]) ?? [];
    const phoneNumberId = value.metadata as {phone_number_id:string}|undefined;

    for (const message of messages) {
      // ── Catalog cart submission ──────────────────────────────────────────
      // A customer sending a cart arrives as type "order". It is NOT a
      // checkout — Meta takes no payment — so we record it as work for a human
      // and move on. Handled before the text-only guard below, which would
      // otherwise drop it silently.
      if (message.type === "order") {
        if (!(await markEventProcessed(supabase, `wa_msg:${message.id}`, "order"))) continue;

        const orderOwner = resolvedAccountId
          ? (await supabase
              .from("whatsapp_numbers")
              .select("user_id")
              .eq("id", resolvedAccountId)
              .maybeSingle<{ user_id: string }>()).data?.user_id ?? null
          : null;

        if (!orderOwner) {
          // Without a tenant we cannot store the order against anyone. Log
          // loudly: this means a number is receiving carts we can't attribute.
          logger.warn("webhook: order received for an unresolved number", {
            phoneNumberId: phoneNumberId?.phone_number_id, messageId: message.id,
          });
          continue;
        }

        try {
          const contactId = await findContactByPhone(orderOwner, message.from);
          await ingestCatalogOrder({
            userId: orderOwner,
            customerPhone: message.from,
            contactId,
            waMessageId: message.id,
            order: (message as unknown as { order?: MetaOrderPayload }).order ?? {},
            receivedAt: new Date(Number(message.timestamp) * 1000).toISOString(),
          });
        } catch (err) {
          logger.warn("webhook: could not store catalog order", {
            messageId: message.id, error: (err as Error).message,
          });
        }
        continue;
      }

      if (message.type !== "text") continue;

      // Dedup per Meta message id — Meta re-delivers inbound messages.
      if (!(await markEventProcessed(supabase, `wa_msg:${message.id}`, "message"))) {
        continue;
      }

      const fromPhone = message.from;
      const text = message.text?.body ?? "";
      const receivedAt = new Date(Number(message.timestamp) * 1000).toISOString();

      // ── CTWA referral capture: when the conversation starts from a
      //    Click-to-WhatsApp ad, Meta includes a `referral` object on the
      //    first message. Tag the contact and log an ad_lead row.
      if (message.referral && phoneNumberId?.phone_number_id) {
        const ref = message.referral;
        const clid = ref.ctwa_clid || ref.source_id;
        if (clid) {
          const { data: wn } = await supabase
            .from("whatsapp_numbers")
            .select("user_id")
            .eq("phone_number_id", phoneNumberId.phone_number_id)
            .maybeSingle();

          if (wn?.user_id) {
            const { data: matchedCampaign } = await supabase
              .from("ad_campaigns")
              .select("id, name")
              .eq("user_id", wn.user_id)
              .or(`ctwa_clid.eq.${clid},fb_campaign_id.eq.${clid}`)
              .limit(1)
              .maybeSingle();

            const profileName = contactProfiles.find((c) => c.wa_id === fromPhone)?.profile?.name;

            // Upsert contact with CTWA attribution.
            const { data: existing } = await supabase
              .from("contacts")
              .select("id, ctwa_campaign_id")
              .eq("user_id", wn.user_id)
              .eq("phone", fromPhone)
              .maybeSingle();

            let contactId: string | null = existing?.id ?? null;
            const isNew = !existing;

            if (existing) {
              if (!existing.ctwa_campaign_id) {
                await supabase
                  .from("contacts")
                  .update({
                    ctwa_campaign_id: clid,
                    ctwa_ad_id: ref.source_id || null,
                    ctwa_campaign_name: matchedCampaign?.name || ref.headline || null,
                    ctwa_clicked_at: receivedAt,
                    crm_source: "ctwa",
                    updated_at: receivedAt,
                  })
                  .eq("id", existing.id);
              }
            } else {
              const { data: created } = await supabase
                .from("contacts")
                .insert({
                  user_id: wn.user_id,
                  name: profileName || `Lead ${fromPhone.slice(-4)}`,
                  phone: fromPhone,
                  crm_source: "ctwa",
                  crm_stage: "new_lead",
                  ctwa_campaign_id: clid,
                  ctwa_ad_id: ref.source_id || null,
                  ctwa_campaign_name: matchedCampaign?.name || ref.headline || null,
                  ctwa_clicked_at: receivedAt,
                  tags: ["ctwa", matchedCampaign?.name].filter(Boolean) as string[],
                })
                .select("id")
                .single();
              contactId = created?.id ?? null;
            }

            await supabase.from("ad_leads").insert({
              user_id: wn.user_id,
              ad_campaign_id: matchedCampaign?.id || null,
              contact_id: contactId,
              phone: fromPhone,
              ctwa_clid: clid,
              fb_ad_id: ref.source_id || null,
              source_url: ref.source_url || null,
              body: text,
              raw_referral: ref,
              is_new_contact: isNew,
            });

            if (matchedCampaign && isNew) {
              const { data: cur } = await supabase
                .from("ad_campaigns")
                .select("leads_count")
                .eq("id", matchedCampaign.id)
                .single();
              await supabase
                .from("ad_campaigns")
                .update({ leads_count: (cur?.leads_count || 0) + 1 })
                .eq("id", matchedCampaign.id);
            }
          }
        }
      }

      // ── Resolve the receiving number → owning tenant BEFORE any write ────
      // Every write below is scoped to this tenant. `contacts` is UNIQUE(user_id,
      // phone), so the same customer legitimately exists under many tenants — a
      // write keyed on phone alone is a real, reachable cross-tenant write (Law #1).
      const pnid = phoneNumberId?.phone_number_id;
      if (!pnid) continue;

      const { data: wn } = await supabase
        .from("whatsapp_numbers")
        .select("id, user_id")
        .eq("phone_number_id", pnid)
        .maybeSingle();

      if (!wn) {
        logger.warn("Inbound for unknown phone_number_id — cannot attribute to a tenant", {
          route: "/api/webhook/whatsapp",
          phoneNumberId: pnid,
        });
        continue;
      }

      // Refresh last_contacted + the 24h customer-service window, TENANT-SCOPED.
      // last_inbound_at is what the window check compares against
      // (lib/whatsapp/window.ts), so an unscoped write here would falsely open
      // another tenant's free-form send window and earn them a Meta 131047.
      const { data: touched } = await supabase
        .from("contacts")
        .update({ last_contacted: receivedAt, last_inbound_at: receivedAt })
        .eq("user_id", wn.user_id)
        .eq("phone", fromPhone)
        .select("id")
        .maybeSingle();

      // Find or create the conversation (tenant-scoped).
      const { data: conv } = await supabase
        .from("conversations")
        .select("id, contact_id")
        .eq("user_id", wn.user_id)
        .eq("contact_phone", fromPhone)
        .eq("whatsapp_number_id", wn.id)
        .maybeSingle();

      const convId = conv?.id ?? (await supabase
        .from("conversations")
        .insert({
          user_id: wn.user_id,
          contact_id: touched?.id ?? null,
          contact_phone: fromPhone,
          whatsapp_number_id: wn.id,
          status: "open",
        })
        .select("id")
        .single()
      ).data?.id;

      if (convId) {
        // Column names must match the DEPLOYED schema: the column is
        // `wa_message_id` (not `meta_message_id`), `user_id` is NOT NULL, and
        // `content` is jsonb. The { body } shape mirrors what the outbound path
        // writes (app/api/inbox/[id]/send) so the inbox renders both sides alike.
        // Previously this insert referenced a non-existent column and omitted
        // user_id, so NO inbound message was ever persisted.
        const { error: msgErr } = await supabase.from("messages").insert({
          conversation_id:    convId,
          user_id:            wn.user_id,
          contact_id:         conv?.contact_id ?? touched?.id ?? null,
          whatsapp_number_id: wn.id,
          wa_message_id:      message.id,
          direction:          "inbound",
          type:               message.type || "text",
          content:            { body: text },
          status:             "delivered",
          delivered_at:       receivedAt,
          created_at:         receivedAt,
        });
        if (msgErr) {
          logger.error("Failed to persist inbound message", {
            route: "/api/webhook/whatsapp",
            waMessageId: message.id,
            error: msgErr.message,
          });
        }

        // Keep the inbox list and its window state fresh. `is_within_24h_window` /
        // `window_expires_at` are what the inbox reply path gates on
        // (app/api/inbox/[id]/send), so without this an agent could not reply to a
        // customer who had just messaged them.
        await supabase
          .from("conversations")
          .update({
            last_message_at: receivedAt,
            last_message_preview: text.slice(0, 120),
            is_within_24h_window: true,
            window_expires_at: new Date(
              new Date(receivedAt).getTime() + 24 * 60 * 60 * 1000,
            ).toISOString(),
          })
          .eq("id", convId)
          .eq("user_id", wn.user_id);
      }
    }
  } catch (err) {
    logger.error("Webhook processing error", {
      route: "/api/webhook/whatsapp",
      message: err instanceof Error ? err.message : String(err),
    });

    // Mark the audit row failed (best-effort; never block the response).
    if (webhookLogId) {
      await supabase
        .from("webhook_logs")
        .update({
          processing_status: "failed",
          processing_error: err instanceof Error ? err.message : String(err),
          processed_at: new Date().toISOString(),
          processing_attempts: 1,
        })
        .eq("id", webhookLogId)
        .then(() => {}, () => {});
    }

    await markInboxDone(inboxId, false, err instanceof Error ? err.message : String(err));
    // Always return 200 to Meta — otherwise they retry indefinitely
    return NextResponse.json({ status: "ok" });
  }

  // Mark the audit row processed.
  if (webhookLogId) {
    await supabase
      .from("webhook_logs")
      .update({
        processing_status: "processed",
        processed_at: new Date().toISOString(),
      })
      .eq("id", webhookLogId)
      .then(() => {}, () => {});
  }

  await markInboxDone(inboxId, true);
  return NextResponse.json({ status: "ok" });
}
