/**
 * Role model and server-side guards.
 *
 * THE RULE THIS FILE EXISTS TO ENFORCE: a hidden button is not access control.
 * Every endpoint that returns a billing amount, a Meta wholesale rate, or a
 * markup percentage must call `requireSuperAdmin()` and return 403 — not merely
 * omit a nav link.
 *
 * Four roles:
 *   super_admin  — the founder. Billing, rate card, markup, all tenants' money.
 *   tenant_admin — SendAnjal's own support staff. Tenant setup, WABA connection,
 *                  vertical content, troubleshooting. NEVER money.
 *   tenant_owner — the client's own admin. Their tenant only.
 *   tenant_staff — the client's agents. Their tenant, narrower still.
 *
 * SOURCE OF TRUTH (deliberately belt-and-braces):
 *   super_admin  = listed in ADMIN_EMAILS  OR  users.role = 'super_admin'
 *   every other role = users.role
 *
 * The env allowlist is kept as an override so a bad UPDATE on users.role can
 * never lock the founder out of production. It is additive only: being absent
 * from ADMIN_EMAILS cannot demote someone whose row says super_admin.
 */
import { getSessionUser, isAdminEmail, type SessionUser } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";
import { logger } from "@/lib/logger";

export type Role = "super_admin" | "tenant_admin" | "tenant_owner" | "tenant_staff";

export const ROLES: Role[] = ["super_admin", "tenant_admin", "tenant_owner", "tenant_staff"];

export function isRole(v: unknown): v is Role {
  return typeof v === "string" && (ROLES as string[]).includes(v);
}

export interface ActorContext extends SessionUser {
  role: Role;
  /** True for super_admin and tenant_admin — i.e. SendAnjal staff, not a client. */
  isPlatformStaff: boolean;
  /** True only for super_admin. Gates every money surface. */
  canSeeMoney: boolean;
}

/**
 * Resolve the caller's role.
 *
 * Reads the role column, then applies the ADMIN_EMAILS override. A DB failure
 * degrades to the LEAST privilege that is still consistent with the allowlist
 * — never to a higher one — so an outage cannot open the rate card.
 */
export async function getActor(): Promise<ActorContext | null> {
  const user = await getSessionUser();
  if (!user) return null;

  let role: Role = "tenant_owner";
  try {
    const supabase = createServiceClient();
    const { data } = await supabase
      .from("users")
      .select("role")
      .eq("id", user.id)
      .maybeSingle<{ role: string }>();
    if (data && isRole(data.role)) role = data.role;
  } catch (err) {
    // Pre-031 databases have no role column. Fall through to the allowlist,
    // which is exactly the behaviour this project had before roles existed.
    logger.warn("roles: could not read users.role", { error: (err as Error).message });
  }

  // Additive override: promotes, never demotes.
  if (isAdminEmail(user.email)) role = "super_admin";

  return {
    ...user,
    role,
    isPlatformStaff: role === "super_admin" || role === "tenant_admin",
    canSeeMoney: role === "super_admin",
  };
}

/**
 * Generic guard. Returns the actor when their role is allowed, else null —
 * callers turn null into a 403.
 *
 *   const actor = await requireRole("super_admin");
 *   if (!actor) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
 */
export async function requireRole(...allowed: Role[]): Promise<ActorContext | null> {
  const actor = await getActor();
  if (!actor) return null;
  return allowed.includes(actor.role) ? actor : null;
}

/**
 * Money guard. Use on EVERY endpoint exposing a billing amount, a Meta
 * wholesale rate, a markup, or platform revenue.
 *
 * Deliberately separate from requireRole("super_admin") so the intent is
 * greppable: `git grep requireSuperAdmin` should enumerate the money surface.
 */
export async function requireSuperAdmin(): Promise<ActorContext | null> {
  return requireRole("super_admin");
}

/**
 * Platform-staff guard — super_admin or tenant_admin.
 *
 * This is the correct guard for tenant SETUP work: connecting a WABA, assigning
 * an industry, submitting templates, running the go-live checklist. It must
 * never be used on a money endpoint, because tenant_admin passes it.
 */
export async function requirePlatformStaff(): Promise<ActorContext | null> {
  return requireRole("super_admin", "tenant_admin");
}

/** Standard 403 body. Identical for every role so it leaks nothing about why. */
export const FORBIDDEN = { error: "Forbidden" } as const;
