/**
 * Commerce compliance attestation.
 *
 *   GET                   → { compliance }
 *   POST { confirmed }    → record the tenant's declaration
 *
 * India's online-selling rules require a seller to be a legitimate registered
 * business. SendAnjal cannot verify that, so this records the tenant's own
 * attestation with a timestamp — which is what makes it a record rather than a
 * checkbox. Migration 033's CHECK enforces the pairing at the database level.
 *
 * DATA-DRIVEN: whether an attestation is required at all comes from
 * `industry_verticals.requires_compliance_attestation`, never `if (ecommerce)`.
 *
 * Withdrawal is allowed and immediately re-blocks catalogue linking — a tenant
 * whose registration lapses must be able to say so.
 */
import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";
import { getVerticalForUser } from "@/lib/verticals/repository";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

async function state(userId: string) {
  const supabase = createServiceClient();
  const [{ data: user }, vertical] = await Promise.all([
    supabase
      .from("users")
      .select("commerce_compliance_confirmed, commerce_compliance_at")
      .eq("id", userId)
      .maybeSingle<{ commerce_compliance_confirmed: boolean; commerce_compliance_at: string | null }>(),
    getVerticalForUser(userId).catch(() => null),
  ]);

  const required = Boolean(vertical?.requiresComplianceAttestation);
  const confirmed = user?.commerce_compliance_confirmed === true;
  return {
    required,
    confirmed,
    confirmedAt: user?.commerce_compliance_at ?? null,
    blocked: required && !confirmed,
    industry: vertical?.displayName ?? null,
  };
}

export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json({ compliance: await state(user.id) });
}

export async function POST(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  if (typeof body.confirmed !== "boolean") {
    return NextResponse.json({ error: "confirmed must be true or false" }, { status: 400 });
  }

  const supabase = createServiceClient();
  const { error } = await supabase
    .from("users")
    .update(
      body.confirmed
        ? { commerce_compliance_confirmed: true, commerce_compliance_at: new Date().toISOString() }
        // Withdrawing keeps the original timestamp: the fact that an
        // attestation was once made, and when, stays on the record.
        : { commerce_compliance_confirmed: false },
    )
    .eq("id", user.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  logger.info("commerce: compliance attestation updated", {
    userId: user.id, confirmed: body.confirmed,
  });

  return NextResponse.json({ compliance: await state(user.id) });
}
