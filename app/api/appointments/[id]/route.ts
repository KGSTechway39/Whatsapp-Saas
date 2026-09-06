/**
 * PATCH  /api/appointments/[id] — update status, reschedule, edit details
 * DELETE /api/appointments/[id] — cancel (soft)
 *
 * TENANT SCOPING (Law #1): the id comes from the URL and is attacker-controlled,
 * so every statement carries .eq("user_id", user.id). A 404 is returned for both
 * "does not exist" and "belongs to someone else" — deliberately indistinguishable.
 */
import { createClient } from "@/lib/supabase/server";
import { getSessionUser } from "@/lib/auth";
import { NextRequest, NextResponse } from "next/server";
import {
  updateAppointmentSchema,
  localToUtc,
  utcToLocalParts,
  toAppointmentDTO,
  DEFAULT_TIMEZONE,
} from "@/lib/appointments/dto";

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const supabase = createClient();
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = updateAppointmentSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid update" },
      { status: 400 },
    );
  }
  const input = parsed.data;

  const { data: existing } = await supabase
    .from("appointments")
    .select("*")
    .eq("id", params.id)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!existing) return NextResponse.json({ error: "Appointment not found" }, { status: 404 });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const patch: Record<string, any> = {};
  if (input.status) patch.status = input.status;
  if (input.service) patch.service = input.service;
  if (input.durationMinutes) patch.duration_minutes = input.durationMinutes;
  if (input.notes !== undefined) patch.notes = input.notes;
  if (input.assignedTo !== undefined) patch.assigned_to = input.assignedTo;

  // Reschedule: recompute the instant from whichever half changed, keeping the
  // other half as it currently reads in the appointment's own timezone.
  if (input.date || input.time) {
    const tz = existing.display_timezone || DEFAULT_TIMEZONE;
    const current = utcToLocalParts(existing.starts_at, tz);
    const startsAt = localToUtc(input.date ?? current.date, input.time ?? current.time, tz);
    if (Number.isNaN(startsAt.getTime())) {
      return NextResponse.json({ error: "Could not read that date and time" }, { status: 400 });
    }
    patch.starts_at = startsAt.toISOString();

    // Moving an appointment invalidates reminders already sent for the old slot,
    // so clear them: the customer must be told about the NEW time. Without this
    // a rescheduled booking would never send another reminder.
    patch.reminder_24h_sent_at = null;
    patch.reminder_1h_sent_at = null;
    if (!input.status) patch.status = "rescheduled";
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ appointment: toAppointmentDTO(existing) });
  }

  const { data: updated, error } = await supabase
    .from("appointments")
    .update(patch)
    .eq("id", params.id)
    .eq("user_id", user.id)
    .select("*")
    .single();

  if (error || !updated) {
    return NextResponse.json({ error: error?.message ?? "Could not update" }, { status: 500 });
  }
  return NextResponse.json({ appointment: toAppointmentDTO(updated) });
}

export async function DELETE(_request: NextRequest, { params }: { params: { id: string } }) {
  const supabase = createClient();
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Soft cancel (migration 036, decision 5). A hard delete would erase the
  // history an owner needs most — who cancelled, and who never showed up.
  const { data: cancelled, error } = await supabase
    .from("appointments")
    .update({ status: "cancelled" })
    .eq("id", params.id)
    .eq("user_id", user.id)
    .select("id")
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!cancelled) return NextResponse.json({ error: "Appointment not found" }, { status: 404 });

  return NextResponse.json({ ok: true, id: cancelled.id, status: "cancelled" });
}
