/**
 * Durable-queue drainer (Vercel Cron entry point).
 *
 * On serverless there's no always-on `boss.work()` consumer, so this route is
 * invoked on a schedule (vercel.json crons) to pull a batch of jobs from the
 * pg-boss queue, run the registered handler, and ack/fail each. Only active when
 * QUEUE_DRIVER=pgboss; for the default inline driver `drainQueue` is a no-op.
 *
 * Importing "@/lib/whatsapp/queue" for its side effect registers the
 * "whatsapp:inbound" handler in this process so drain() can find it.
 */
import { NextRequest, NextResponse } from "next/server";
import { drainQueue } from "@/lib/queue";
import "@/lib/whatsapp/queue";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const INBOUND_JOB = "whatsapp:inbound";

export async function GET(req: NextRequest): Promise<NextResponse> {
  // Vercel Cron sends `Authorization: Bearer ${CRON_SECRET}` when CRON_SECRET is set.
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await drainQueue(INBOUND_JOB, 50);
    return NextResponse.json({ ok: true, queue: INBOUND_JOB, ...result });
  } catch (err) {
    logger.error("drain-queue failed", {
      err: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json({ ok: false, error: "drain failed" }, { status: 500 });
  }
}
