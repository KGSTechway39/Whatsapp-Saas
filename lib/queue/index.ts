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

export interface QueueDriver {
  enqueue(type: string, payload: unknown, opts?: EnqueueOptions): Promise<void>;
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

// ── Future drivers (no new dependency until approved) ───────────────────────
// class QStashDriver  — POST {type,payload} to a /api/worker route via QStash.
// class BullMQDriver  — new Queue(type, { connection: REDIS_URL }).add(...).
// class InngestDriver — inngest.send({ name: type, data: payload }).

function selectDriver(): QueueDriver {
  switch (process.env.QUEUE_DRIVER) {
    // case "qstash": return new QStashDriver();
    // case "bullmq": return new BullMQDriver();
    default:
      return new InlineDriver();
  }
}

const driver: QueueDriver = selectDriver();

/** Enqueue a job for async processing via the active driver. */
export function enqueue(type: string, payload: unknown, opts?: EnqueueOptions): Promise<void> {
  return driver.enqueue(type, payload, opts);
}
