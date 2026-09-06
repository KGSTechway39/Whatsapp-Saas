/**
 * Appointment date/time conversion and validation.
 *
 * These cover a bug that was live: `time: "25:99"` passed validation because the
 * schema only checked the SHAPE `\d{2}:\d{2}`, and Date.UTC silently rolled the
 * overflow forward — a customer would have been booked at 02:39 the following
 * day, at a time nobody chose. Same trap for "2026-02-31". The regression tests
 * for both are marked below.
 */
import { describe, it, expect } from "vitest";
import {
  localToUtc,
  utcToLocalParts,
  createAppointmentSchema,
  updateAppointmentSchema,
  toAppointmentDTO,
  DEFAULT_TIMEZONE,
} from "@/lib/appointments/dto";

const IST = "Asia/Kolkata";

describe("localToUtc", () => {
  it("shifts IST wall-clock back by 5h30m", () => {
    // India is UTC+5:30 year-round, so 14:30 local is 09:00Z.
    expect(localToUtc("2026-09-08", "14:30", IST).toISOString()).toBe(
      "2026-09-08T09:00:00.000Z",
    );
  });

  it("rolls back across midnight when local time is before the offset", () => {
    // 04:00 IST is 22:30Z on the PREVIOUS day — an off-by-one-day trap.
    expect(localToUtc("2026-09-08", "04:00", IST).toISOString()).toBe(
      "2026-09-07T22:30:00.000Z",
    );
  });

  it("treats UTC as a no-op", () => {
    expect(localToUtc("2026-09-08", "14:30", "UTC").toISOString()).toBe(
      "2026-09-08T14:30:00.000Z",
    );
  });

  it("applies the correct offset either side of a DST boundary", () => {
    // New York: EDT (-4) in September, EST (-5) in January. A single fixed
    // offset would get one of these wrong by an hour — which would move a
    // reminder into the wrong hour for half the year.
    expect(localToUtc("2026-09-08", "12:00", "America/New_York").toISOString()).toBe(
      "2026-09-08T16:00:00.000Z",
    );
    expect(localToUtc("2026-01-08", "12:00", "America/New_York").toISOString()).toBe(
      "2026-01-08T17:00:00.000Z",
    );
  });
});

describe("utcToLocalParts", () => {
  it("round-trips with localToUtc", () => {
    for (const [date, time] of [
      ["2026-09-08", "14:30"],
      ["2026-01-01", "00:00"],
      ["2026-12-31", "23:59"],
      ["2028-02-29", "09:15"], // leap day
    ] as const) {
      const utc = localToUtc(date, time, IST);
      expect(utcToLocalParts(utc, IST)).toEqual({ date, time });
    }
  });

  it("renders midnight as 00:00, not 24:00", () => {
    // Some Intl implementations report hour 24 for midnight; the DTO normalises
    // it. A "24:00" would fail the clockTime schema on the next reschedule.
    const utc = localToUtc("2026-09-08", "00:00", IST);
    expect(utcToLocalParts(utc, IST).time).toBe("00:00");
  });
});

describe("createAppointmentSchema", () => {
  const valid = {
    contactName: "Asha",
    contactPhone: "+919876543210",
    date: "2026-09-08",
    time: "14:30",
  };

  it("accepts a minimal valid booking and applies defaults", () => {
    const parsed = createAppointmentSchema.parse(valid);
    expect(parsed.service).toBe("consultation");
    expect(parsed.durationMinutes).toBe(30);
    expect(parsed.timezone).toBe(DEFAULT_TIMEZONE);
  });

  // REGRESSION: this shape passed the old regex and became 02:39 the next day.
  it("rejects an out-of-range hour", () => {
    const r = createAppointmentSchema.safeParse({ ...valid, time: "25:99" });
    expect(r.success).toBe(false);
  });

  it("rejects an out-of-range minute", () => {
    expect(createAppointmentSchema.safeParse({ ...valid, time: "10:75" }).success).toBe(false);
  });

  // REGRESSION: "2026-02-31" matched the regex and rolled forward to 3 March.
  it("rejects a date that does not exist", () => {
    expect(createAppointmentSchema.safeParse({ ...valid, date: "2026-02-31" }).success).toBe(false);
  });

  it("rejects 29 Feb in a non-leap year but accepts it in a leap year", () => {
    expect(createAppointmentSchema.safeParse({ ...valid, date: "2027-02-29" }).success).toBe(false);
    expect(createAppointmentSchema.safeParse({ ...valid, date: "2028-02-29" }).success).toBe(true);
  });

  it("accepts the boundary times", () => {
    expect(createAppointmentSchema.safeParse({ ...valid, time: "00:00" }).success).toBe(true);
    expect(createAppointmentSchema.safeParse({ ...valid, time: "23:59" }).success).toBe(true);
  });

  it("rejects an unknown service type", () => {
    expect(createAppointmentSchema.safeParse({ ...valid, service: "haircut" }).success).toBe(false);
  });

  it("rejects a duration outside the allowed band", () => {
    expect(createAppointmentSchema.safeParse({ ...valid, durationMinutes: 0 }).success).toBe(false);
    expect(createAppointmentSchema.safeParse({ ...valid, durationMinutes: 2000 }).success).toBe(false);
  });

  it("requires a name and a phone", () => {
    expect(createAppointmentSchema.safeParse({ ...valid, contactName: "  " }).success).toBe(false);
    expect(createAppointmentSchema.safeParse({ ...valid, contactPhone: "123" }).success).toBe(false);
  });
});

describe("updateAppointmentSchema", () => {
  it("allows a partial update", () => {
    expect(updateAppointmentSchema.safeParse({ status: "confirmed" }).success).toBe(true);
    expect(updateAppointmentSchema.safeParse({}).success).toBe(true);
  });

  it("applies the same time validation on reschedule", () => {
    expect(updateAppointmentSchema.safeParse({ time: "25:00" }).success).toBe(false);
    expect(updateAppointmentSchema.safeParse({ date: "2026-13-01" }).success).toBe(false);
  });

  it("rejects an unknown status", () => {
    expect(updateAppointmentSchema.safeParse({ status: "ghosted" }).success).toBe(false);
  });
});

describe("toAppointmentDTO", () => {
  const row = {
    id: "a1",
    contact_id: null,
    contact_name: "Asha",
    contact_phone: "+919876543210",
    service: "checkup",
    title: null,
    starts_at: "2026-09-08T09:00:00.000Z",
    duration_minutes: 30,
    display_timezone: IST,
    status: "scheduled",
    notes: null,
    assigned_to: null,
    confirmation_sent_at: null,
    reminder_24h_sent_at: null,
    reminder_1h_sent_at: null,
    follow_up_sent_at: null,
    created_at: "2026-09-01T00:00:00.000Z",
  };

  it("renders the instant in the row's own timezone", () => {
    const dto = toAppointmentDTO(row);
    expect(dto.date).toBe("2026-09-08");
    expect(dto.time).toBe("14:30");
  });

  it("collapses reminder timestamps to the booleans the UI expects", () => {
    expect(toAppointmentDTO(row).reminderSent).toBe(false);
    // Either horizon having fired counts as "reminded".
    expect(
      toAppointmentDTO({ ...row, reminder_1h_sent_at: "2026-09-08T08:00:00Z" }).reminderSent,
    ).toBe(true);
    expect(
      toAppointmentDTO({ ...row, reminder_24h_sent_at: "2026-09-07T09:00:00Z" }).reminderSent,
    ).toBe(true);
  });

  it("falls back to the default timezone when the row has none", () => {
    const dto = toAppointmentDTO({ ...row, display_timezone: null });
    expect(dto.timezone).toBe(DEFAULT_TIMEZONE);
  });
});
