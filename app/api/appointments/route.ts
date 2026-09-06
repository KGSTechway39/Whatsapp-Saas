/**
 * GET  /api/appointments — list this tenant's appointments
 * POST /api/appointments — book one
 *
 * Replaces the DEMO_APPOINTMENTS array the screen used to run on: until
 * migration 036 there was no appointments table on the deployed (user_id) model
 * at all, so nothing a tenant booked was ever persisted.
 *
 * TENANT SCOPING (Law #1): every query carries .eq("user_id", user.id).
 */
import { createClient } from "@/lib/supabase/server";
import { getSessionUser } from "@/lib/auth";
import { NextRequest, NextResponse } from "next/server";
import {
  createAppointmentSchema,
  localToUtc,
  toAppointmentDTO,
  DEFAULT_TIMEZONE,
} from "@/lib/appointments/dto";

export async function GET(request: NextRequest) {
  const supabase = createClient();
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const from = searchParams.get("from");
  const to = searchParams.get("to");
  const status = searchParams.get("status");
  const limit = Math.max(1, Math.min(500, parseInt(searchParams.get("limit") || "200")));

  let query = supabase
    .from("appointments")
    .select("*", { count: "exact" })
    .eq("user_id", user.id)
    .order("starts_at", { ascending: true })
    .limit(limit);

  // Dates arrive as calendar days; widen to cover the whole day in any zone
  // rather than dropping an appointment that sits near a boundary.
  if (from) query = query.gte("starts_at", new Date(`${from}T00:00:00Z`).toISOString());
  if (to) query = query.lte("starts_at", new Date(`${to}T23:59:59Z`).toISOString());
  if (status && status !== "all") query = query.eq("status", status);

  const { data, error, count } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({
    appointments: (data ?? []).map(toAppointmentDTO),
    total: count ?? 0,
  });
}

export async function POST(request: NextRequest) {
  const supabase = createClient();
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = createAppointmentSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid appointment" },
      { status: 400 },
    );
  }
  const input = parsed.data;
  const timezone = input.timezone || DEFAULT_TIMEZONE;
  const startsAt = localToUtc(input.date, input.time, timezone);

  if (Number.isNaN(startsAt.getTime())) {
    return NextResponse.json({ error: "Could not read that date and time" }, { status: 400 });
  }

  // Link to an existing contact when the number is already known, so the
  // appointment shows up against their record. Never creates a contact — that
  // would silently grow the tenant's billable audience from a booking form.
  let contactId = input.contactId ?? null;
  if (!contactId) {
    const { data: match } = await supabase
      .from("contacts")
      .select("id")
      .eq("user_id", user.id)
      .eq("phone", input.contactPhone)
      .maybeSingle();
    contactId = match?.id ?? null;
  } else {
    // A caller-supplied contactId is attacker-controlled — prove it is theirs.
    const { data: owned } = await supabase
      .from("contacts")
      .select("id")
      .eq("id", contactId)
      .eq("user_id", user.id)
      .maybeSingle();
    if (!owned) return NextResponse.json({ error: "Contact not found" }, { status: 404 });
  }

  const endsAt = new Date(startsAt.getTime() + input.durationMinutes * 60_000);

  const { data: created, error } = await supabase
    .from("appointments")
    .insert({
      user_id: user.id,
      contact_id: contactId,
      contact_name: input.contactName,
      contact_phone: input.contactPhone,
      service: input.service,
      title: input.title ?? null,
      notes: input.notes ?? null,
      assigned_to: input.assignedTo ?? null,
      starts_at: startsAt.toISOString(),
      duration_minutes: input.durationMinutes,
      display_timezone: timezone,
      status: "scheduled",
    })
    .select("*")
    .single();

  if (error || !created) {
    return NextResponse.json({ error: error?.message ?? "Could not book" }, { status: 500 });
  }

  // Overlap is REPORTED, not refused (migration 036, decision 4): clinics run
  // parallel chairs and shops take walk-ins. The UI can warn; the booking stands.
  const { data: overlapping } = await supabase
    .from("appointments")
    .select("id, contact_name, starts_at, duration_minutes")
    .eq("user_id", user.id)
    .neq("id", created.id)
    .in("status", ["scheduled", "confirmed"])
    .gte("starts_at", new Date(startsAt.getTime() - 4 * 60 * 60_000).toISOString())
    .lte("starts_at", endsAt.toISOString());

  const conflicts = (overlapping ?? []).filter((a: { starts_at: string; duration_minutes: number }) => {
    const aStart = new Date(a.starts_at).getTime();
    const aEnd = aStart + (a.duration_minutes ?? 30) * 60_000;
    return aStart < endsAt.getTime() && aEnd > startsAt.getTime();
  });

  return NextResponse.json(
    {
      appointment: toAppointmentDTO(created),
      ...(conflicts.length > 0
        ? {
            conflicts: conflicts.length,
            conflictNote: `Overlaps ${conflicts.length} other appointment${
              conflicts.length === 1 ? "" : "s"
            }. Booked anyway.`,
          }
        : {}),
    },
    { status: 201 },
  );
}
