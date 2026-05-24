import { createServiceClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "crypto";
import { checkRateLimit, WEBHOOK_LIMIT, rateLimitHeaders } from "@/lib/rate-limit";
import { logger } from "@/lib/logger";

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

// ─── Idempotency store (in-memory, last 10 min) ────────────────────────────────
// For multi-instance deployments, replace with Redis/Supabase check.
const processedEvents = new Map<string, number>();
setInterval(() => {
  const cutoff = Date.now() - 10 * 60 * 1000;
  Array.from(processedEvents.entries()).forEach(([k, t]) => {
    if (t < cutoff) processedEvents.delete(k);
  });
}, 5 * 60 * 1000);

function markProcessed(id: string): boolean {
  if (processedEvents.has(id)) return false; // already processed
  processedEvents.set(id, Date.now());
  return true;
}

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

  // Idempotency: use Meta's entry ID
  const entryId = (body?.entry as { id?: string }[])?.[0]?.id;
  if (entryId) {
    const firstChange = ((body?.entry as { changes?: { value?: { messaging_product?: string } }[] }[])?.[0]?.changes?.[0]?.value?.messaging_product) ?? "";
    const eventKey = `${entryId}:${firstChange}:${Date.now()}`;
    // Use message timestamps for better idempotency key
    const msgs = ((body?.entry as { changes?: { value?: { messages?: { id?: string }[] } }[] }[])?.[0]?.changes?.[0]?.value?.messages) ?? [];
    const statuses = ((body?.entry as { changes?: { value?: { statuses?: { id?: string }[] } }[] }[])?.[0]?.changes?.[0]?.value?.statuses) ?? [];
    const dedupKey = msgs.length > 0
      ? `msg:${(msgs as {id?:string}[])[0].id}`
      : statuses.length > 0
      ? `st:${(statuses as {id?:string}[])[0].id}`
      : eventKey;

    if (!markProcessed(dedupKey)) {
      // Already processed — return 200 immediately (Meta expects 200 even for duplicates)
      return NextResponse.json({ status: "duplicate" });
    }
  }

  const supabase = createServiceClient();

  // ── Audit log: persist every event for replay/debug, get duplicate flag ──
  const entry0   = (body.entry as { id?: string; changes?: { value?: Record<string, unknown> }[] }[])?.[0];
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

  // Resolve account/org from phone_number_id (best-effort)
  let resolvedAccountId: string | null = null;
  let resolvedOrgId: string | null = null;
  if (meta0?.phone_number_id) {
    const { data: acct } = await supabase
      .from("whatsapp_accounts")
      .select("id, organization_id")
      .eq("phone_number_id", meta0.phone_number_id)
      .maybeSingle();
    resolvedAccountId = acct?.id ?? null;
    resolvedOrgId     = acct?.organization_id ?? null;
  }

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

  try {
    const entry   = (body.entry as {changes?:{value?:Record<string,unknown>}[]}[])?.[0];
    const changes = entry?.changes?.[0];
    const value   = changes?.value ?? {};

    // ── Status updates ──
    const statuses = (value.statuses as {id:string;status:string;timestamp:string}[]) ?? [];
    for (const status of statuses) {
      const { id: metaMessageId, status: msgStatus, timestamp } = status;

      const statusMap: Record<string, string> = {
        sent: "sent", delivered: "delivered", read: "read", failed: "failed",
      };
      const mappedStatus = statusMap[msgStatus];
      if (!mappedStatus) continue;

      const updateData: Record<string, string> = { status: mappedStatus };
      if (mappedStatus === "delivered") {
        updateData.delivered_at = new Date(Number(timestamp) * 1000).toISOString();
      }
      if (mappedStatus === "read") {
        updateData.read_at = new Date(Number(timestamp) * 1000).toISOString();
      }

      await supabase
        .from("campaign_messages")
        .update(updateData)
        .eq("meta_message_id", metaMessageId);
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
      if (message.type !== "text") continue;

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

      // Update contact last_contacted
      await supabase
        .from("contacts")
        .update({ last_contacted: receivedAt })
        .eq("phone", fromPhone);

      // Upsert into conversations if we track the inbox
      if (phoneNumberId?.phone_number_id) {
        const { data: wn } = await supabase
          .from("whatsapp_numbers")
          .select("id, user_id")
          .eq("phone_number_id", phoneNumberId.phone_number_id)
          .maybeSingle();

        if (wn) {
          // Find or create conversation
          const { data: conv } = await supabase
            .from("conversations")
            .select("id")
            .eq("contact_phone", fromPhone)
            .eq("whatsapp_number_id", wn.id)
            .maybeSingle();

          const convId = conv?.id ?? (await supabase
            .from("conversations")
            .insert({
              user_id: wn.user_id,
              contact_phone: fromPhone,
              whatsapp_number_id: wn.id,
              status: "open",
            })
            .select("id")
            .single()
          ).data?.id;

          if (convId) {
            await supabase.from("messages").insert({
              conversation_id: convId,
              content: text,
              direction: "inbound",
              meta_message_id: message.id,
              created_at: receivedAt,
            });
          }
        }
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

  return NextResponse.json({ status: "ok" });
}
