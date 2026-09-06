/**
 * Platform health checks, shared by both admin consoles.
 *
 * The super-admin overview and the ops console must never disagree about
 * whether the platform is healthy, so there is exactly one implementation.
 *
 * These are live checks — a config/env probe plus the most recent webhook
 * ingest — not a cached status page. Every check soft-fails to "unknown"
 * rather than throwing: a health panel that 500s is worse than one that says
 * it doesn't know.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export type HealthStatus = "ok" | "warn" | "down" | "unknown";

export interface HealthCheck {
  key: string;
  label: string;
  status: HealthStatus;
  detail: string;
}

/** Non-throwing wrapper — any failure becomes an "unknown" check. */
async function probe(
  key: string,
  label: string,
  run: () => Promise<HealthCheck>,
): Promise<HealthCheck> {
  try {
    return await run();
  } catch (err) {
    return { key, label, status: "unknown", detail: (err as Error).message };
  }
}

export async function platformHealth(
  supabase: SupabaseClient,
  now: number = Date.now(),
): Promise<HealthCheck[]> {
  const database = await probe("database", "Database", async () => {
    const { error } = await supabase.from("users").select("id").limit(1);
    return error
      ? { key: "database", label: "Database", status: "down" as const, detail: error.message }
      : { key: "database", label: "Database", status: "ok" as const, detail: "Supabase reachable" };
  });

  const webhook = await probe("webhook", "Webhook ingest", async () => {
    const { data, error } = await supabase
      .from("webhook_inbox")
      .select("received_at, status")
      .order("received_at", { ascending: false })
      .limit(200);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as { received_at: string; status: string }[];
    if (rows.length === 0) {
      return { key: "webhook", label: "Webhook ingest", status: "warn" as const, detail: "No events received yet" };
    }
    const failed = rows.filter((r) => r.status === "failed").length;
    if (failed > 0) {
      return { key: "webhook", label: "Webhook ingest", status: "warn" as const, detail: `${failed} failed in last ${rows.length}` };
    }
    const ageH = (now - Date.parse(rows[0].received_at)) / 3_600_000;
    return ageH > 24
      ? { key: "webhook", label: "Webhook ingest", status: "warn" as const, detail: `Last event ${Math.round(ageH)}h ago` }
      : { key: "webhook", label: "Webhook ingest", status: "ok" as const, detail: `Last event ${ageH < 1 ? "<1" : Math.round(ageH)}h ago` };
  });

  const driver = process.env.QUEUE_DRIVER || "inline";
  const queue: HealthCheck =
    driver === "pgboss" && !process.env.DATABASE_URL
      ? { key: "queue", label: "Job queue", status: "down", detail: "pgboss selected but DATABASE_URL unset" }
      : driver === "inline"
        ? { key: "queue", label: "Job queue", status: "warn", detail: "Inline driver — jobs are not durable" }
        : { key: "queue", label: "Job queue", status: "ok", detail: "pgboss (durable)" };

  const ai = await probe("ai", "AI services", async () => {
    const { count, error } = await supabase
      .from("ai_model_config")
      .select("id", { count: "exact", head: true });
    if (error) throw new Error(error.message);
    const hasKey = Boolean(
      process.env.ANTHROPIC_API_KEY || process.env.AI_GATEWAY_API_KEY || process.env.GEMINI_API_KEY,
    );
    if (!hasKey) {
      return { key: "ai", label: "AI services", status: "warn" as const, detail: "No provider key — falls back to manual flows" };
    }
    return (count ?? 0) > 0
      ? { key: "ai", label: "AI services", status: "ok" as const, detail: `${count} model config${count === 1 ? "" : "s"}` }
      : { key: "ai", label: "AI services", status: "warn" as const, detail: "No model config rows" };
  });

  const metaMissing = ["META_APP_SECRET", "WHATSAPP_WEBHOOK_VERIFY_TOKEN", "ENCRYPTION_KEY"].filter(
    (k) => !process.env[k],
  );
  const meta: HealthCheck =
    metaMissing.length === 0
      ? { key: "meta", label: "Meta / WhatsApp", status: "ok", detail: "Signing + encryption keys set" }
      : { key: "meta", label: "Meta / WhatsApp", status: "down", detail: `Missing: ${metaMissing.join(", ")}` };

  const razorpayMissing = ["RAZORPAY_KEY_ID", "RAZORPAY_KEY_SECRET", "RAZORPAY_WEBHOOK_SECRET"].filter(
    (k) => !process.env[k],
  );
  const payments: HealthCheck =
    razorpayMissing.length === 0
      ? { key: "payments", label: "Payments (Razorpay)", status: "ok", detail: "Keys + webhook secret set" }
      : { key: "payments", label: "Payments (Razorpay)", status: "warn", detail: `Missing: ${razorpayMissing.join(", ")}` };

  return [database, webhook, queue, ai, meta, payments];
}
