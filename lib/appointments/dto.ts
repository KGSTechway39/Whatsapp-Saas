/**
 * Appointment DTO + validation.
 *
 * The database stores ONE instant (`starts_at timestamptz`) because reminders
 * have to fire at a precise moment. The UI works in local date + time strings.
 * This module is the only place that converts between the two, so the offset
 * maths exists once rather than in every route and component.
 */

import { z } from "zod";

export const APPOINTMENT_SERVICES = [
  "consultation",
  "follow_up",
  "demo",
  "checkup",
  "meeting",
  "callback",
] as const;

export const APPOINTMENT_STATUSES = [
  "scheduled",
  "confirmed",
  "completed",
  "cancelled",
  "no_show",
  "rescheduled",
] as const;

export type AppointmentService = (typeof APPOINTMENT_SERVICES)[number];
export type AppointmentStatus = (typeof APPOINTMENT_STATUSES)[number];

/** Indian SMB market — see migration 036, decision 2. */
export const DEFAULT_TIMEZONE = "Asia/Kolkata";

/**
 * A YYYY-MM-DD that is a REAL calendar date.
 *
 * The shape regex alone is not enough: "2026-02-31" matches it, and Date.UTC
 * silently rolls the overflow forward to 3 March. Round-tripping through Date
 * and comparing catches that.
 */
const calendarDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD")
  .refine((v) => {
    const [y, m, d] = v.split("-").map(Number);
    const probe = new Date(Date.UTC(y, m - 1, d));
    return (
      probe.getUTCFullYear() === y && probe.getUTCMonth() === m - 1 && probe.getUTCDate() === d
    );
  }, "That date does not exist");

/**
 * An HH:MM that is a REAL wall-clock time.
 *
 * Same trap: "25:99" matches \d{2}:\d{2}, and Date.UTC turns it into 02:39 the
 * following day — so a booking silently lands a day late at a time nobody chose.
 */
const clockTime = z
  .string()
  .regex(/^\d{2}:\d{2}$/, "Time must be HH:MM")
  .refine((v) => {
    const [h, m] = v.split(":").map(Number);
    return h >= 0 && h <= 23 && m >= 0 && m <= 59;
  }, "That time does not exist");

export const createAppointmentSchema = z.object({
  contactName: z.string().trim().min(1, "Name is required").max(120),
  contactPhone: z.string().trim().min(6, "Phone is required").max(20),
  contactId: z.string().uuid().nullish(),
  service: z.enum(APPOINTMENT_SERVICES).default("consultation"),
  /** Local calendar date, YYYY-MM-DD. */
  date: calendarDate,
  /** Local wall-clock time, HH:MM (24h). */
  time: clockTime,
  durationMinutes: z.number().int().min(5).max(1440).default(30),
  timezone: z.string().min(1).max(64).default(DEFAULT_TIMEZONE),
  notes: z.string().max(2000).optional(),
  assignedTo: z.string().max(120).optional(),
  title: z.string().max(200).optional(),
});

export const updateAppointmentSchema = z.object({
  status: z.enum(APPOINTMENT_STATUSES).optional(),
  date: calendarDate.optional(),
  time: clockTime.optional(),
  durationMinutes: z.number().int().min(5).max(1440).optional(),
  notes: z.string().max(2000).nullish(),
  assignedTo: z.string().max(120).nullish(),
  service: z.enum(APPOINTMENT_SERVICES).optional(),
});

/**
 * Local wall-clock -> UTC instant, for an IANA zone.
 *
 * Done without a date library: format a candidate instant *in the target zone*,
 * measure how far that lands from the wall-clock we wanted, and shift by the
 * difference. Two passes settle it — the second catches the case where the first
 * shift crosses a DST boundary. (India has no DST, but tenants may set another
 * zone, and getting this silently wrong would move a reminder by an hour.)
 */
export function localToUtc(date: string, time: string, timeZone: string): Date {
  const [y, mo, d] = date.split("-").map(Number);
  const [h, mi] = time.split(":").map(Number);
  const wanted = Date.UTC(y, mo - 1, d, h, mi, 0, 0);

  let guess = wanted;
  for (let i = 0; i < 2; i++) {
    const seenInZone = wallClockUtcInZone(new Date(guess), timeZone);
    const drift = seenInZone - wanted;
    if (drift === 0) break;
    guess -= drift;
  }
  return new Date(guess);
}

/** What the wall clock reads in `timeZone`, expressed as a UTC-epoch for comparison. */
function wallClockUtcInZone(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(instant);

  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  // Intl renders midnight as hour 24 in some engines; normalise it.
  const hour = get("hour") % 24;
  return Date.UTC(get("year"), get("month") - 1, get("day"), hour, get("minute"), get("second"));
}

/** UTC instant -> the local date/time strings the UI renders. */
export function utcToLocalParts(
  instant: Date | string,
  timeZone: string,
): { date: string; time: string } {
  const d = typeof instant === "string" ? new Date(instant) : instant;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  const hour = String(Number(get("hour")) % 24).padStart(2, "0");
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    time: `${hour}:${get("minute")}`,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export interface AppointmentRow { [k: string]: any }

export interface AppointmentDTO {
  id: string;
  contactId: string | null;
  contactName: string;
  contactPhone: string;
  service: AppointmentService;
  title: string | null;
  date: string;
  time: string;
  startsAt: string;
  durationMinutes: number;
  timezone: string;
  status: AppointmentStatus;
  notes: string | null;
  assignedTo: string | null;
  confirmationSent: boolean;
  reminderSent: boolean;
  followUpSent: boolean;
  createdAt: string;
}

/** DB row -> the shape the appointments screen consumes. */
export function toAppointmentDTO(row: AppointmentRow): AppointmentDTO {
  const tz = row.display_timezone || DEFAULT_TIMEZONE;
  const { date, time } = utcToLocalParts(row.starts_at, tz);
  return {
    id: row.id,
    contactId: row.contact_id ?? null,
    contactName: row.contact_name,
    contactPhone: row.contact_phone,
    service: row.service,
    title: row.title ?? null,
    date,
    time,
    startsAt: row.starts_at,
    durationMinutes: row.duration_minutes,
    timezone: tz,
    status: row.status,
    notes: row.notes ?? null,
    assignedTo: row.assigned_to ?? null,
    // The UI treats these as booleans; the columns keep the timestamp so the
    // audit trail ("when did we tell them?") is not thrown away.
    confirmationSent: Boolean(row.confirmation_sent_at),
    reminderSent: Boolean(row.reminder_24h_sent_at || row.reminder_1h_sent_at),
    followUpSent: Boolean(row.follow_up_sent_at),
    createdAt: row.created_at,
  };
}
