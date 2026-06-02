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
  | "embedded_signup.start"
  | "embedded_signup.exchange_token"
  | "embedded_signup.save_account"
  | "embedded_signup.subscribe_webhook"
  | "embedded_signup.success"
  | "embedded_signup.failure"
  | "whatsapp_account.disconnect"
  | "whatsapp_account.list"
  | "access_token.rotate"
  | "access_token.revoke";

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
