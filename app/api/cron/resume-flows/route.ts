/**
 * Scheduled sweep for automation flows parked on a wait node.
 *
 * A flow that hits a waitNode saves its position in `chatbot_sessions` and
 * stops. Something has to come back for it once the timer is up — that is this
 * route. Without it, every flow containing a delay ends permanently at that
 * delay.
 *
 * Separate from /api/cron/drain-queue on purpose: that one drains an event
 * queue, this one is time-driven, and a failure in either should not stop the
 * other from running.
 *
 * NOTE ON CADENCE: the useful resolution of a delay node is bounded by how often
 * this runs. On a daily cron a "wait 15 minutes" step waits until the next
 * sweep. See vercel.json.
 */
import { NextRequest, NextResponse } from "next/server";
import { resumeDueSessions } from "@/lib/automation/resume";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: NextRequest): Promise<NextResponse> {
  // Vercel Cron sends `Authorization: Bearer ${CRON_SECRET}` when CRON_SECRET is set.
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await resumeDueSessions();
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    logger.error("resume-flows cron failed", {
      err: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json({ ok: false, error: "resume sweep failed" }, { status: 500 });
  }
}
