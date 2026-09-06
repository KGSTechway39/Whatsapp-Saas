/**
 * Scheduled appointment reminders.
 *
 * Runs both horizons in one tick: the 24h reminder, then the 1h. They are
 * separate columns and separate claims, so a customer gets at most one of each.
 *
 * CADENCE MATTERS HERE MORE THAN ANYWHERE ELSE (see vercel.json): the 1h
 * reminder is only meaningful if this runs at least hourly. On the current daily
 * cron the 24h reminder still lands roughly a day ahead, but the 1h reminder
 * will almost always be skipped — by the time the sweep runs, the appointment
 * is either past or outside the one-hour horizon.
 */
import { NextRequest, NextResponse } from "next/server";
import { sweepDueReminders } from "@/lib/appointments/reminders";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: NextRequest): Promise<NextResponse> {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    // 24h first: if a slot is inside both horizons the earlier reminder should
    // already have gone, and running it first keeps that ordering intact.
    const twentyFour = await sweepDueReminders("24h");
    const oneHour = await sweepDueReminders("1h");
    return NextResponse.json({ ok: true, "24h": twentyFour, "1h": oneHour });
  } catch (err) {
    logger.error("appointment-reminders cron failed", {
      err: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json({ ok: false, error: "reminder sweep failed" }, { status: 500 });
  }
}
