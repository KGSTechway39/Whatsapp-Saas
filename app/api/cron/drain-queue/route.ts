/**
 * Durable-queue drainer (Vercel Cron entry point).
 *
 * On serverless there's no always-on `boss.work()` consumer, so this route is
 * invoked on a schedule (vercel.json crons) to pull a batch of jobs from the
 * pg-boss queue, run the registered handler, and ack/fail each. Only active when
 * QUEUE_DRIVER=pgboss; for the default inline driver `drainQueue` is a no-op.
 *
 * Importing the worker modules for their side effects registers their handlers
 * in THIS process so drain() can find them. A queue whose module is not imported
 * here would accumulate jobs that never run — so every new job type must be
 * added to both the import list and QUEUES below.
 */
import { NextRequest, NextResponse } from "next/server";
import { drainQueue } from "@/lib/queue";
import "@/lib/whatsapp/queue";
import { CAMPAIGN_SEND_JOB } from "@/lib/campaigns/worker";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const INBOUND_JOB = "whatsapp:inbound";

/**
 * Every durable queue this cron drains. Campaign batches re-enqueue themselves
 * until a broadcast is finished, so a run that drains 50 jobs simply continues
 * on the next tick.
 */
const QUEUES = [INBOUND_JOB, CAMPAIGN_SEND_JOB];

export async function GET(req: NextRequest): Promise<NextResponse> {
  // Vercel Cron sends `Authorization: Bearer ${CRON_SECRET}` when CRON_SECRET is set.
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    // Drained independently so one queue's failure cannot starve the other.
    const drained: Record<string, unknown> = {};
    for (const queue of QUEUES) {
      try {
        drained[queue] = await drainQueue(queue, 50);
      } catch (err) {
        drained[queue] = { error: err instanceof Error ? err.message : String(err) };
        logger.error("drain-queue: queue failed", { queue, err: String(err) });
      }
    }
    return NextResponse.json({ ok: true, drained });
  } catch (err) {
    logger.error("drain-queue failed", {
      err: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json({ ok: false, error: "drain failed" }, { status: 500 });
  }
}
