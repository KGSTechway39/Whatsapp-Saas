/**
 * POST /api/webhooks/whatsapp  ── Multi-tenant webhook ingress
 * GET  /api/webhooks/whatsapp  ── Meta verification challenge
 *
 * Design goals:
 *   1. Return HTTP 200 to Meta inside ~2 seconds (Meta retries on any
 *      non-2xx and on slow responses, which causes duplicate delivery).
 *   2. Resolve the SaaS tenant from the inbound `phone_number_id` so we
 *      can scope every downstream action by `organization_id`.
 *   3. Hand the payload to the async worker queue (BullMQ / Vercel Queues
 *      / Inngest) for processing — never block the response on DB writes,
 *      Graph API calls, or template lookups.
 *
 * This route lives alongside the legacy `/api/webhook/whatsapp` route.
 * The legacy route handles single-tenant CTWA + inbox persistence; this
 * one is the entry point for the new multi-tenant flow engine.
 */

import { NextRequest, NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "crypto";
import { createServiceClient } from "@/lib/supabase/server";
import { logger } from "@/lib/logger";
import { enqueueWebhookEvent } from "@/lib/whatsapp/queue";
import { markEventProcessed } from "@/lib/whatsapp/dedup";
import { persistRawEvent, markInboxDone } from "@/lib/whatsapp/inbox";

// ── Env + constants ────────────────────────────────────────────────────
const VERIFY_TOKEN = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN;
const APP_SECRET   = process.env.META_APP_SECRET;

// ── Typed Meta payload shapes ──────────────────────────────────────────
interface WebhookMetadata {
  phone_number_id?: string;
  display_phone_number?: string;
}

interface WebhookValue {
  messaging_product?: string;
  metadata?: WebhookMetadata;
  messages?: Array<{
    id: string;
    from: string;
    type: string;
    timestamp: string;
    text?: { body: string };
    interactive?: unknown;
    referral?: unknown;
  }>;
  statuses?: Array<{
    id: string;
    status: "sent" | "delivered" | "read" | "failed";
    timestamp: string;
    recipient_id: string;
    errors?: Array<{ code: number; title: string }>;
  }>;
  // template approval events
  event?: string;
  message_template_id?: string | number;
  message_template_name?: string;
  reason?: string;
}

interface WebhookChange {
  field: "messages" | "message_template_status_update" | "account_update" | string;
  value: WebhookValue;
}

interface WebhookEntry {
  id: string;                  // typically the WABA id
  changes: WebhookChange[];
}

interface WebhookPayload {
  object: string;              // "whatsapp_business_account"
  entry: WebhookEntry[];
}

// ── Signature verification ─────────────────────────────────────────────
function verifySignature(rawBody: Buffer, signature: string | null): boolean {
  if (!APP_SECRET) {
    if (process.env.NODE_ENV !== "production") return true;
    logger.error("[webhooks/whatsapp] META_APP_SECRET not set");
    return false;
  }
  if (!signature) return false;

  const expected = `sha256=${createHmac("sha256", APP_SECRET).update(rawBody).digest("hex")}`;
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

// ── GET — verification handshake ───────────────────────────────────────
export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!VERIFY_TOKEN) {
    logger.error("[webhooks/whatsapp] WHATSAPP_WEBHOOK_VERIFY_TOKEN not set");
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const url       = new URL(request.url);
  const mode      = url.searchParams.get("hub.mode");
  const token     = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");

  if (mode === "subscribe" && token === VERIFY_TOKEN && challenge) {
    logger.info("[webhooks/whatsapp] verification handshake succeeded");
    return new NextResponse(challenge, { status: 200 });
  }

  return NextResponse.json({ error: "Forbidden" }, { status: 403 });
}

// ── POST — event ingestion ─────────────────────────────────────────────
export async function POST(request: NextRequest): Promise<NextResponse> {
  // Read the raw body first — signature verification needs the exact bytes.
  const rawBody = Buffer.from(await request.arrayBuffer());

  if (!verifySignature(rawBody, request.headers.get("x-hub-signature-256"))) {
    logger.warn("[webhooks/whatsapp] signature mismatch", {
      ip: request.headers.get("x-forwarded-for") ?? "unknown",
    });
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  let payload: WebhookPayload;
  try {
    payload = JSON.parse(rawBody.toString("utf-8"));
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // Persist-then-enqueue: store the raw payload BEFORE any async work so it's
  // replayable if ingest never completes (crash / driver loss). This await is a
  // single insert; durability of the event must precede the ack.
  const inboxId = await persistRawEvent(payload, "/api/webhooks/whatsapp");

  // Acknowledge Meta immediately. The actual work happens after the
  // response is queued — Next.js keeps the function alive long enough
  // for `enqueueWebhookEvent` to write to the worker queue.
  void ingestEvents(payload, inboxId).catch((err) => {
    logger.error("[webhooks/whatsapp] ingest failed", {
      err: err instanceof Error ? err.message : String(err),
    });
    void markInboxDone(inboxId, false, err instanceof Error ? err.message : String(err));
  });

  return NextResponse.json({ status: "ok" });
}

// ── Async ingestion — runs after the 200 OK is on the wire ─────────────
async function ingestEvents(payload: WebhookPayload, inboxId: string | null): Promise<void> {
  if (payload.object !== "whatsapp_business_account") {
    logger.warn("[webhooks/whatsapp] unexpected object", { object: payload.object });
    await markInboxDone(inboxId, true);
    return;
  }

  const supabase = createServiceClient();

  for (const entry of payload.entry ?? []) {
    const wabaId = entry.id;

    for (const change of entry.changes ?? []) {
      const value = change.value ?? {};
      const phoneNumberId = value.metadata?.phone_number_id;

      // Resolve the SaaS tenant from the receiving phone number id.
      // This is the single source of truth for "which workspace owns
      // this number"; every downstream write scopes on the resolved
      // organization_id.
      const tenant = await resolveTenant(supabase, {
        phoneNumberId,
        wabaId,
      });

      if (!tenant) {
        logger.warn("[webhooks/whatsapp] no tenant for incoming event", {
          phoneNumberId,
          wabaId,
          field: change.field,
        });
        continue;
      }

      // ── Branch by event family ────────────────────────────────────
      if (change.field === "messages") {
        // 1) Status updates (sent / delivered / read / failed)
        for (const status of value.statuses ?? []) {
          // Dedup per (message_id, status) — Meta re-delivers, sometimes concurrently.
          if (!(await markEventProcessed(supabase, `wa_status:${status.id}:${status.status}`, "status"))) {
            continue;
          }
          logger.info("[webhooks/whatsapp] status", {
            org: tenant.organizationId,
            waMessageId: status.id,
            statusState: status.status,
            recipient: status.recipient_id,
          });
          // status updates are cheap — hand to queue as well so the worker
          // owns ALL state transitions, keeping this route stateless.
          void enqueueWebhookEvent({
            phoneNumberId: phoneNumberId!,
            payload: status as unknown as Record<string, unknown>,
            kind: "status" as const,
            // Distinct job id per (message, status) so delivered/read/sent for the
            // same message aren't collapsed by the queue's job-id dedup.
            eventId: `${status.id}:${status.status}`,
            receivedAt: Number(status.timestamp ?? Math.floor(Date.now() / 1000)),
          });
        }

        // 2) Inbound messages — text + interactive replies + CTWA
        for (const msg of value.messages ?? []) {
          // Dedup per Meta message id — Meta re-delivers inbound messages.
          if (!(await markEventProcessed(supabase, `wa_msg:${msg.id}`, "message"))) {
            continue;
          }
          const kind: "message" | "ctwa_referral" = msg.referral
            ? "ctwa_referral"
            : "message";

          logger.info("[webhooks/whatsapp] inbound", {
            org: tenant.organizationId,
            account: tenant.accountId,
            from: msg.from,
            type: msg.type,
            id: msg.id,
          });

          void enqueueWebhookEvent({
            phoneNumberId: phoneNumberId!,
            payload: msg as unknown as Record<string, unknown>,
            kind,
            eventId: msg.id,
            receivedAt: Number(msg.timestamp ?? Math.floor(Date.now() / 1000)),
          });
        }
        continue;
      }

      if (change.field === "message_template_status_update") {
        logger.info("[webhooks/whatsapp] template status", {
          org: tenant.organizationId,
          templateId: value.message_template_id,
          name: value.message_template_name,
          event: value.event,
          reason: value.reason,
        });

        if (value.message_template_id) {
          await supabase
            .from("templates")
            .update({
              status: mapTemplateStatus(value.event ?? ""),
              updated_at: new Date().toISOString(),
            })
            .eq("organization_id", tenant.organizationId)
            .eq("meta_template_id", String(value.message_template_id));
        }
        continue;
      }

      logger.info("[webhooks/whatsapp] unhandled change.field", {
        field: change.field,
        org: tenant.organizationId,
      });
    }
  }

  await markInboxDone(inboxId, true);
}

// ── Tenant resolution ──────────────────────────────────────────────────
interface ResolvedTenant {
  organizationId: string;
  accountId: string;
}

/**
 * Look up the active SaaS workspace that owns `phone_number_id`.
 *
 * Equivalent SQL (Prisma-style for reference):
 *   prisma.whatsappAccount.findFirst({
 *     where: { phoneNumberId, status: { in: ['active', 'pending'] } },
 *     select: { id: true, organizationId: true },
 *   })
 *
 * Falls back to a waba_id lookup if no phone match is found (useful for
 * template-approval events that don't carry phone_number_id).
 */
async function resolveTenant(
  supabase: ReturnType<typeof createServiceClient>,
  args: { phoneNumberId?: string; wabaId?: string },
): Promise<ResolvedTenant | null> {
  if (args.phoneNumberId) {
    const { data } = await supabase
      .from("whatsapp_accounts")
      .select("id, organization_id")
      .eq("phone_number_id", args.phoneNumberId)
      .in("status", ["active", "pending"])
      .maybeSingle();

    if (data) {
      return { organizationId: data.organization_id, accountId: data.id };
    }
  }

  if (args.wabaId) {
    const { data } = await supabase
      .from("whatsapp_accounts")
      .select("id, organization_id")
      .eq("waba_id", args.wabaId)
      .in("status", ["active", "pending"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (data) {
      return { organizationId: data.organization_id, accountId: data.id };
    }
  }

  return null;
}

function mapTemplateStatus(event: string): string {
  switch (event.toUpperCase()) {
    case "APPROVED": return "approved";
    case "REJECTED": return "rejected";
    case "PAUSED":   return "paused";
    case "PENDING":  return "pending";
    default:         return "pending";
  }
}
