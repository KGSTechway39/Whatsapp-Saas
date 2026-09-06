/**
 * Go-live checklist — the gate between `status: 'setup'` and `status: 'active'`.
 *
 * DESIGN RULE: compute what can be computed; record only what cannot.
 *
 * Three of the six items are facts the database already knows (a number is
 * connected, a template is approved, the wallet is funded). Those are queried
 * live and NEVER stored — a stored tick drifts from reality and would let a
 * tenant activate on a check that was true last week.
 *
 * The other three are events that happened once and leave no queryable trace
 * ("a test message was delivered", "a test inbound routed here", "a flow ran
 * end to end"). Those are recorded in `tenant_golive_checks` with who verified
 * them, so activation is auditable rather than self-asserted.
 *
 * MONEY BOUNDARY: item 6 answers "is the wallet funded?" as a BOOLEAN. It never
 * returns a balance, so a tenant_admin can run the whole checklist without ever
 * seeing an amount — which is exactly what the role boundary requires.
 */
import { createServiceClient } from "@/lib/supabase/server";

export type CheckKey =
  | "waba_connected"
  | "template_approved"
  | "test_outbound_delivered"
  | "test_inbound_routed"
  | "automation_tested"
  | "billing_ready";

/** The three that are proven by an event, not by a query. */
export const RECORDED_CHECKS: CheckKey[] = [
  "test_outbound_delivered",
  "test_inbound_routed",
  "automation_tested",
];

export interface CheckState {
  key: CheckKey;
  label: string;
  /** Plain language — this is read by non-technical staff. */
  help: string;
  passed: boolean;
  /** How this was established: 'computed' (live query) or 'recorded' (an event). */
  source: "computed" | "recorded";
  detail: string;
}

export interface GoLiveState {
  userId: string;
  status: string;
  checks: CheckState[];
  passedCount: number;
  /** True only when all six pass. The server refuses activation otherwise. */
  canActivate: boolean;
}

const LABELS: Record<CheckKey, { label: string; help: string }> = {
  waba_connected: {
    label: "WhatsApp number connected",
    help: "Their number is linked and ready to send.",
  },
  template_approved: {
    label: "A message template approved",
    help: "Meta has approved at least one template, so they can message people who haven't written in first.",
  },
  test_outbound_delivered: {
    label: "Test message delivered",
    help: "We sent one message and WhatsApp confirmed it arrived.",
  },
  test_inbound_routed: {
    label: "Test reply received",
    help: "Someone messaged the number and it reached this account, not another one.",
  },
  automation_tested: {
    label: "An automation tested end to end",
    help: "One automatic reply was run all the way through, start to finish.",
  },
  billing_ready: {
    label: "Billing ready",
    help: "Their account can pay for messages — either credit added, or their own Meta billing is set up.",
  },
};

/**
 * Evaluate all six checks for a tenant.
 *
 * Every query is soft-failed to "not passed" rather than throwing: a checklist
 * that 500s tells an operator nothing, and failing closed is the safe direction
 * for a gate — an unknown check must never read as satisfied.
 */
export async function evaluateGoLive(userId: string): Promise<GoLiveState> {
  const supabase = createServiceClient();

  const safe = async <T>(run: () => Promise<T>, fallback: T): Promise<T> => {
    try { return await run(); } catch { return fallback; }
  };

  const [user, numbers, approvedTemplates, wallet, recorded] = await Promise.all([
    safe(async () => {
      const { data } = await supabase
        .from("users").select("status, billing_mode").eq("id", userId).maybeSingle<{ status: string; billing_mode: string }>();
      return data;
    }, null),

    safe(async () => {
      const { count } = await supabase
        .from("whatsapp_numbers").select("id", { count: "exact", head: true })
        .eq("user_id", userId).eq("status", "active");
      return count ?? 0;
    }, 0),

    safe(async () => {
      const { count } = await supabase
        .from("templates").select("id", { count: "exact", head: true })
        .eq("user_id", userId).eq("status", "approved");
      return count ?? 0;
    }, 0),

    safe(async () => {
      const { data } = await supabase
        .from("wallet").select("balance_paise").eq("user_id", userId).maybeSingle<{ balance_paise: number }>();
      return Number(data?.balance_paise ?? 0);
    }, 0),

    safe(async () => {
      const { data } = await supabase
        .from("tenant_golive_checks").select("check_key, passed_at").eq("user_id", userId);
      return (data ?? []) as { check_key: string; passed_at: string }[];
    }, []),
  ]);

  const recordedMap = new Map(recorded.map((r) => [r.check_key, r.passed_at]));

  // Billing readiness depends on the model, and the two are genuinely different
  // questions: a managed tenant needs OUR wallet funded; a BYO tenant pays Meta
  // directly, so there is no wallet for us to check and requiring one would
  // block every enterprise client forever.
  const isByo = (user?.billing_mode ?? "byo") === "byo";
  const billingReady = isByo ? true : wallet > 0;

  const computed: Record<string, { passed: boolean; detail: string }> = {
    waba_connected: {
      passed: numbers > 0,
      detail: numbers > 0 ? `${numbers} active number${numbers === 1 ? "" : "s"}` : "No active number yet",
    },
    template_approved: {
      passed: approvedTemplates > 0,
      detail: approvedTemplates > 0 ? `${approvedTemplates} approved` : "None approved yet",
    },
    billing_ready: {
      passed: billingReady,
      // Deliberately never states the amount.
      detail: isByo
        ? "Client pays Meta directly — no platform wallet needed"
        : billingReady ? "Credit available" : "No credit yet — add a top-up",
    },
  };

  const order: CheckKey[] = [
    "waba_connected", "template_approved", "test_outbound_delivered",
    "test_inbound_routed", "automation_tested", "billing_ready",
  ];

  const checks: CheckState[] = order.map((key) => {
    if (RECORDED_CHECKS.includes(key)) {
      const at = recordedMap.get(key);
      return {
        key, ...LABELS[key],
        passed: Boolean(at),
        source: "recorded" as const,
        detail: at ? `Verified ${new Date(at).toLocaleDateString("en-IN")}` : "Not tested yet",
      };
    }
    const c = computed[key];
    return { key, ...LABELS[key], passed: c.passed, source: "computed" as const, detail: c.detail };
  });

  const passedCount = checks.filter((c) => c.passed).length;

  return {
    userId,
    status: user?.status ?? "setup",
    checks,
    passedCount,
    canActivate: passedCount === checks.length,
  };
}

/** Record one of the three event-type checks as verified. */
export async function recordCheck(
  userId: string,
  key: CheckKey,
  verifiedBy: string,
  details: Record<string, unknown> = {},
): Promise<void> {
  if (!RECORDED_CHECKS.includes(key)) {
    // Computed checks are facts, not opinions — allowing them to be "recorded"
    // would be exactly the bypass this gate exists to prevent.
    throw new Error(`'${key}' is verified automatically and cannot be marked by hand.`);
  }
  const supabase = createServiceClient();
  const { error } = await supabase
    .from("tenant_golive_checks")
    .upsert(
      { user_id: userId, check_key: key, verified_by: verifiedBy, passed_at: new Date().toISOString(), details },
      { onConflict: "user_id,check_key" },
    );
  if (error) throw new Error(error.message);
}

/**
 * Flip a tenant to active.
 *
 * Re-evaluates server-side and refuses if anything is outstanding. The UI
 * disables the button too, but that is a courtesy — this is the actual gate,
 * and it holds even if the request is crafted by hand.
 */
export async function activateTenant(userId: string): Promise<GoLiveState> {
  const state = await evaluateGoLive(userId);
  if (!state.canActivate) {
    const missing = state.checks.filter((c) => !c.passed).map((c) => c.label);
    throw new Error(`Not ready yet — still outstanding: ${missing.join(", ")}.`);
  }

  const supabase = createServiceClient();
  const { error } = await supabase
    .from("users")
    .update({ status: "active", activated_at: new Date().toISOString() })
    .eq("id", userId);
  if (error) throw new Error(error.message);

  return { ...state, status: "active" };
}
