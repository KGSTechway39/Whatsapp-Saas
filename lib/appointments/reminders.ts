/**
 * Appointment reminder sweep.
 *
 * WHY A TEMPLATE, NOT FREE TEXT (Law #5)
 * A reminder fires 24h or 1h before the slot. By then the customer usually has
 * NOT messaged in the last 24 hours, so the customer-service window is shut and
 * free-form text would be rejected by Meta (131047). Reminders are therefore
 * sent as an approved UTILITY template — `canSend("template", …)` is always
 * allowed, which is exactly what templates exist for.
 *
 * WHY CLAIM BEFORE SENDING
 * Each reminder column is flipped from NULL to a timestamp with a compare-and-set
 * BEFORE the send. Two overlapping sweeps therefore cannot both send the same
 * reminder. The trade-off is deliberate: a crash between claim and send loses
 * that one reminder, whereas the reverse order would risk messaging a customer
 * twice and charging the tenant twice. For reminders, silence beats duplication.
 * A failed send resets the column so the next sweep retries it.
 *
 * BILLING
 * Every send goes through guardedSingleSend as UTILITY, so managed tenants are
 * quoted from meta_rates × tier markup and debited exactly once per reminder
 * (idempotency key is the appointment id + which reminder).
 */

import { createClient } from "@/lib/supabase/server";
import { decrypt } from "@/lib/crypto";
import { sendTemplateMessage } from "@/lib/meta";
import { guardedSingleSend } from "@/lib/billing/guarded-send";
import { utcToLocalParts, DEFAULT_TIMEZONE } from "./dto";
import { logger } from "@/lib/logger";

/** Appointments handled per sweep. */
const SWEEP_LIMIT = 50;

/**
 * Which template carries a reminder. Matched case-insensitively against the
 * tenant's APPROVED templates; the first match wins. We never invent or
 * auto-create a template — an unapproved one would simply be rejected by Meta,
 * so a tenant without one is skipped and told why.
 */
const REMINDER_TEMPLATE_PATTERNS = ["appointment_reminder", "appointment_remind", "reminder"];

export type ReminderKind = "24h" | "1h";

const COLUMN: Record<ReminderKind, string> = {
  "24h": "reminder_24h_sent_at",
  "1h": "reminder_1h_sent_at",
};

export interface ReminderSweepResult {
  due: number;
  sent: number;
  skippedNoTemplate: number;
  skippedNoNumber: number;
  failed: number;
}

export async function sweepDueReminders(
  kind: ReminderKind,
  limit = SWEEP_LIMIT,
): Promise<ReminderSweepResult> {
  const supabase = createClient();
  const result: ReminderSweepResult = {
    due: 0,
    sent: 0,
    skippedNoTemplate: 0,
    skippedNoNumber: 0,
    failed: 0,
  };

  const column = COLUMN[kind];
  const now = Date.now();
  const horizonMs = kind === "24h" ? 24 * 60 * 60_000 : 60 * 60_000;

  // Due = starts in the future, within this reminder's horizon, not yet sent.
  // Past appointments are excluded: reminding someone about a slot that already
  // happened is worse than saying nothing.
  const { data: due, error } = await supabase
    .from("appointments")
    .select("id, user_id, contact_id, contact_name, contact_phone, starts_at, display_timezone")
    .in("status", ["scheduled", "confirmed"])
    .is(column, null)
    .gte("starts_at", new Date(now).toISOString())
    .lte("starts_at", new Date(now + horizonMs).toISOString())
    .order("starts_at", { ascending: true })
    .limit(limit);

  if (error) {
    logger.error("reminder sweep: query failed", { kind, error: error.message });
    return result;
  }

  const appts = (due ?? []) as Array<{
    id: string;
    user_id: string;
    contact_id: string | null;
    contact_name: string;
    contact_phone: string;
    starts_at: string;
    display_timezone: string | null;
  }>;
  result.due = appts.length;

  // Cache per-tenant lookups: a sweep is usually many appointments across few tenants.
  const numberCache = new Map<string, { phoneNumberId: string; token: string } | null>();
  const templateCache = new Map<string, { name: string; language: string } | null>();

  for (const appt of appts) {
    // ── Claim first ────────────────────────────────────────────────────────
    const claimedAt = new Date().toISOString();
    const { data: claimed } = await supabase
      .from("appointments")
      .update({ [column]: claimedAt })
      .eq("id", appt.id)
      .is(column, null)
      .select("id");

    if (!claimed || claimed.length === 0) continue; // another sweep has it

    const unclaim = async () => {
      await supabase.from("appointments").update({ [column]: null }).eq("id", appt.id);
    };

    try {
      // ── Tenant's sending number ──────────────────────────────────────────
      if (!numberCache.has(appt.user_id)) {
        const { data: wn } = await supabase
          .from("whatsapp_numbers")
          .select("phone_number_id, access_token")
          .eq("user_id", appt.user_id)
          .eq("status", "active")
          .limit(1)
          .maybeSingle();
        numberCache.set(
          appt.user_id,
          wn ? { phoneNumberId: wn.phone_number_id, token: await decrypt(wn.access_token) } : null,
        );
      }
      const number = numberCache.get(appt.user_id);
      if (!number) {
        result.skippedNoNumber++;
        await unclaim();
        continue;
      }

      // ── An approved reminder template ────────────────────────────────────
      if (!templateCache.has(appt.user_id)) {
        const { data: templates } = await supabase
          .from("templates")
          .select("name, language, status, category")
          .eq("user_id", appt.user_id)
          .eq("status", "APPROVED");

        const rows = (templates ?? []) as Array<{
          name: string;
          language: string | null;
          category: string | null;
        }>;
        const match = rows.find((t) =>
          REMINDER_TEMPLATE_PATTERNS.some((p) => t.name?.toLowerCase().includes(p)),
        );
        templateCache.set(
          appt.user_id,
          match ? { name: match.name, language: match.language || "en" } : null,
        );
      }
      const template = templateCache.get(appt.user_id);
      if (!template) {
        result.skippedNoTemplate++;
        await unclaim();
        logger.warn("reminder sweep: no approved reminder template", {
          userId: appt.user_id,
          appointmentId: appt.id,
        });
        continue;
      }

      // ── Send ─────────────────────────────────────────────────────────────
      const tz = appt.display_timezone || DEFAULT_TIMEZONE;
      const { date, time } = utcToLocalParts(appt.starts_at, tz);
      const components = [
        {
          type: "body",
          parameters: [
            { type: "text", text: appt.contact_name },
            { type: "text", text: date },
            { type: "text", text: time },
          ],
        },
      ];

      await guardedSingleSend({
        userId: appt.user_id,
        category: "UTILITY",
        // Deterministic per appointment + reminder, so a retry after a partial
        // failure debits the wallet exactly once.
        idempotencyKey: `appt:${appt.id}:${kind}`,
        referenceId: `appt:${appt.id}`,
        description: `Appointment reminder (${kind})`,
        send: () =>
          sendTemplateMessage({
            phoneNumberId: number.phoneNumberId,
            accessToken: number.token,
            to: appt.contact_phone,
            templateName: template.name,
            languageCode: template.language,
            components,
          }),
      });

      result.sent++;
    } catch (err) {
      result.failed++;
      await unclaim(); // let the next sweep retry
      logger.error("reminder sweep: send failed", {
        appointmentId: appt.id,
        kind,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return result;
}
