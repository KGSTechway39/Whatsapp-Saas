/**
 * Generic job queue with a swappable driver.
 *
 * Default driver = "inline": runs the handler in-process, off the response path
 * (fire-and-forget). This needs nothing extra to run. To scale out, set
 * QUEUE_DRIVER=qstash|bullmq|inngest and implement the driver below — callers
 * (`enqueue(...)`) and handlers (`registerHandler(...)`) do NOT change.
 *
 * Why an abstraction: high-volume automation/broadcast fan-out and webhook
 * delivery shouldn't block the request, and per-job billing must run reliably.
 * Centralizing the seam here means moving to a durable backend is a config
 * change, not a rewrite.
 *
 *   registerHandler<MyJob>("whatsapp:inbound", processInbound);
 *   await enqueue("whatsapp:inbound", job, { id: job.eventId });
 */
import { logger } from "@/lib/logger";
import type { PgBoss } from "pg-boss";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type JobHandler<T = any> = (payload: T) => Promise<void>;

const handlers = new Map<string, JobHandler>();

/** Register the worker for a job type. Call once at module load. */
export function registerHandler<T>(type: string, handler: JobHandler<T>): void {
  handlers.set(type, handler as JobHandler);
}

export interface EnqueueOptions {
  /** Idempotency / trace id for the job (e.g. the source event id). */
  id?: string;
}

export interface DrainResult {
  processed: number;
  failed: number;
}

export interface QueueDriver {
  enqueue(type: string, payload: unknown, opts?: EnqueueOptions): Promise<void>;
  /** Pull-and-run a batch (durable drivers only). Inline returns nothing to do. */
  drain?(type: string, batchSize: number): Promise<DrainResult>;
}

/**
 * Inline driver — executes the registered handler immediately but detached from
 * the caller's promise, so the HTTP response returns without waiting. Errors are
 * logged, never thrown back into the request.
 */
class InlineDriver implements QueueDriver {
  async enqueue(type: string, payload: unknown, opts?: EnqueueOptions): Promise<void> {
    const handler = handlers.get(type);
    if (!handler) {
      logger.warn("No handler registered for job type", { type, id: opts?.id });
      return;
    }
    void Promise.resolve()
      .then(() => handler(payload))
      .catch((err) =>
        logger.error("Queue job failed", {
          type,
          id: opts?.id,
          err: err instanceof Error ? err.message : String(err),
        }),
      );
  }
}

/**
 * pg-boss driver — durable, Postgres-backed queue. `enqueue` writes the job to
 * the `pgboss` schema (survives crashes). On serverless there is no always-on
 * `boss.work()` consumer, so jobs are drained by a Vercel Cron route that calls
 * `drainQueue()` → `drain()` (fetch a batch, run the handler, ack/fail).
 *
 * Requires DATABASE_URL = a *session-mode* Supabase Postgres connection
 * (port 5432, not the 6543 transaction pooler — pg-boss needs advisory locks).
 */
class PgBossDriver implements QueueDriver {
  private startPromise: Promise<PgBoss> | null = null;
  private readonly created = new Set<string>();

  private start(): Promise<PgBoss> {
    if (!this.startPromise) {
      this.startPromise = (async () => {
        const url = process.env.DATABASE_URL;
        if (!url) throw new Error("DATABASE_URL is required for QUEUE_DRIVER=pgboss");
        const { PgBoss: PgBossCtor } = await import("pg-boss");
        const boss = new PgBossCtor(url);
        boss.on("error", (e: Error) => logger.error("pg-boss error", { err: e.message }));
        await boss.start();
        return boss;
      })();
    }
    return this.startPromise;
  }

  private async ensureQueue(boss: PgBoss, type: string): Promise<void> {
    if (this.created.has(type)) return;
    try {
      await boss.createQueue(type);
    } catch {
      /* already exists — createQueue is not idempotent across versions */
    }
    this.created.add(type);
  }

  async enqueue(type: string, payload: unknown, opts?: EnqueueOptions): Promise<void> {
    const boss = await this.start();
    await this.ensureQueue(boss, type);
    // singletonKey gives a secondary dedup guard (primary is processed_events).
    await boss.send(type, (payload ?? {}) as object, opts?.id ? { singletonKey: opts.id } : {});
  }

  async drain(type: string, batchSize: number): Promise<DrainResult> {
    const handler = handlers.get(type);
    if (!handler) {
      logger.warn("drain: no handler registered", { type });
      return { processed: 0, failed: 0 };
    }
    const boss = await this.start();
    await this.ensureQueue(boss, type);

    const jobs = (await boss.fetch(type, { batchSize })) ?? [];
    let processed = 0;
    let failed = 0;
    for (const job of jobs) {
      try {
        await handler(job.data);
        await boss.complete(type, job.id);
        processed++;
      } catch (err) {
        await boss.fail(type, job.id, {
          message: err instanceof Error ? err.message : String(err),
        });
        failed++;
      }
    }
    return { processed, failed };
  }
}

// ── Future drivers (no new dependency until approved) ───────────────────────
// class QStashDriver  — POST {type,payload} to a /api/worker route via QStash.
// class BullMQDriver  — new Queue(type, { connection: REDIS_URL }).add(...).

function selectDriver(): QueueDriver {
  switch (process.env.QUEUE_DRIVER) {
    case "pgboss":
      return new PgBossDriver();
    // case "qstash": return new QStashDriver();
    default:
      return new InlineDriver();
  }
}

const driver: QueueDriver = selectDriver();

/** Enqueue a job for async processing via the active driver. */
export function enqueue(type: string, payload: unknown, opts?: EnqueueOptions): Promise<void> {
  return driver.enqueue(type, payload, opts);
}

/**
 * Drain a batch of a durable queue (cron entry point). No-op for the inline
 * driver (which has nothing queued — handlers already ran in-process).
 */
export function drainQueue(type: string, batchSize = 20): Promise<DrainResult> {
  if (!driver.drain) return Promise.resolve({ processed: 0, failed: 0 });
  return driver.drain(type, batchSize);
}
