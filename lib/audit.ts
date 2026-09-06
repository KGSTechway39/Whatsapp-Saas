/**
 * Append-only audit log helper. Every security-sensitive action — token
 * exchange, account connection, webhook subscription, disconnection —
 * MUST call `audit()` so the action is recorded against the organization
 * and user.
 *
 * Writes never throw. Audit failure must not block the user-facing
 * action; the underlying database failure is logged to stderr instead.
 */

import { createServiceClient } from "@/lib/supabase/server";
import { logger } from "@/lib/logger";
import type { NextRequest } from "next/server";

export type AuditAction =
  // ── Onboarding / token lifecycle ──────────────────────────────────────
  | "embedded_signup.start"
  | "embedded_signup.exchange_token"
  | "embedded_signup.save_account"
  | "embedded_signup.subscribe_webhook"
  | "embedded_signup.success"
  | "embedded_signup.failure"
  | "whatsapp_account.disconnect"
  | "whatsapp_account.list"
  | "access_token.rotate"
  | "access_token.revoke"
  // ── Privileged financial / configuration actions ──────────────────────
  // These change COGS, margin, or what a tenant is charged. Every one of them
  // must be attributable to a named admin with a before/after value, or the
  // platform cannot pass a financial-controls review.
  | "rates.wholesale_update"   // meta_rates — Meta's wholesale cost (COGS)
  | "rates.tier_update"        // plan_tiers — markup, fees, message cap
  | "rates.settings_update"    // platform_settings — buffer, min top-up, credit validity
  | "tier.change"              // a tenant's tier ⇒ billing_mode + waba_mode
  | "ai_config.update"         // model routing, price-per-token, credits per action
  | "vertical.assign"          // industry pack assigned/cleared for a tenant
  | "vertical.update"          // industry activated/deactivated, renamed, reordered
  | "vertical.seed_adopt"      // seed items copied into a tenant's own records
  // ── Tenant lifecycle ──────────────────────────────────────────────────
  // Activation is the moment a tenant may message real customers. Who flipped
  // it, and on the strength of which checks, has to be reconstructable.
  | "tenant.activate"
  | "tenant.golive_check"
  // ── Support / ops actions ─────────────────────────────────────────────
  // Support staff act ON another tenant's account. Who opened, re-prioritised
  // or closed a ticket has to be reconstructable after the fact.
  | "support_ticket.create"
  | "support_ticket.update";

export interface AuditArgs {
  action: AuditAction;
  organizationId?: string | null;
  userId?: string | null;
  resourceType?: string;
  resourceId?: string;
  outcome?: "success" | "failure";
  details?: Record<string, unknown>;
  request?: NextRequest;
}

export async function audit(args: AuditArgs): Promise<void> {
  const ip      = args.request ? extractIp(args.request) : null;
  const ua      = args.request?.headers.get("user-agent") ?? null;
  const outcome = args.outcome ?? "success";

  try {
    const supabase = createServiceClient();
    const { error } = await supabase.from("audit_logs").insert({
      organization_id: args.organizationId ?? null,
      user_id:         args.userId ?? null,
      action:          args.action,
      resource_type:   args.resourceType ?? null,
      resource_id:     args.resourceId ?? null,
      ip_address:      ip,
      user_agent:      ua,
      outcome,
      details:         args.details ?? {},
    });

    if (error) {
      logger.warn("[audit] insert failed", { action: args.action, err: error.message });
    }
  } catch (e) {
    logger.warn("[audit] threw", {
      action: args.action,
      err: e instanceof Error ? e.message : String(e),
    });
  }
}

function extractIp(req: NextRequest): string | null {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req.headers.get("x-real-ip") ??
    null
  );
}
