/**
 * Admin: a tenant's go-live checklist, and the activation gate.
 *
 *   GET                          → { golive }   evaluate all six checks
 *   POST { check, details? }     → { golive }   record an event-type check
 *   POST { activate: true }      → { golive }   flip setup → active (gated)
 *
 * Platform staff only (super_admin or tenant_admin) — running a tenant's setup
 * is exactly tenant_admin's job. No amount is returned by any of these: the
 * billing check answers a boolean, so support staff can complete the checklist
 * without ever seeing money.
 */
import { NextRequest, NextResponse } from "next/server";
import { requirePlatformStaff } from "@/lib/roles";
import { audit } from "@/lib/audit";
import { evaluateGoLive, recordCheck, activateTenant, type CheckKey } from "@/lib/tenants/golive";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const actor = await requirePlatformStaff();
  if (!actor) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    return NextResponse.json({ golive: await evaluateGoLive(params.id) });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const actor = await requirePlatformStaff();
  if (!actor) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await request.json().catch(() => ({}));

  // ── Activation ────────────────────────────────────────────────────────────
  if (body.activate === true) {
    try {
      const golive = await activateTenant(params.id);
      await audit({
        action: "tenant.activate",
        userId: actor.id,
        resourceType: "users",
        resourceId: params.id,
        request,
        details: { checks_passed: golive.passedCount },
      });
      return NextResponse.json({ golive });
    } catch (err) {
      // A refusal is a 409, not a 500 — the request was well-formed, the
      // tenant simply is not ready, and the message names what is missing.
      await audit({
        action: "tenant.activate",
        userId: actor.id,
        resourceType: "users",
        resourceId: params.id,
        request,
        outcome: "failure",
        details: { error: (err as Error).message },
      });
      return NextResponse.json({ error: (err as Error).message }, { status: 409 });
    }
  }

  // ── Record an event-type check ────────────────────────────────────────────
  const check = String(body.check ?? "") as CheckKey;
  if (!check) return NextResponse.json({ error: "check is required" }, { status: 400 });

  try {
    await recordCheck(params.id, check, actor.id, body.details ?? {});
    await audit({
      action: "tenant.golive_check",
      userId: actor.id,
      resourceType: "users",
      resourceId: params.id,
      request,
      details: { check },
    });
    return NextResponse.json({ golive: await evaluateGoLive(params.id) });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}
