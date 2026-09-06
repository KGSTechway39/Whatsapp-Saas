/**
 * A contact's consent for sensitive-data messaging.
 *
 *   GET                      → { consent }  current state + whether it's required
 *   POST { given, source? }  → { consent }  record or withdraw
 *
 * This is the counterpart to the send-time gate in lib/compliance/consent.ts.
 * Enforcement without a way to capture consent would simply break every
 * regulated tenant's automations, so the two ship together.
 *
 * TENANT-SCOPED, not admin: the business collects consent from its own
 * customers, so this runs as the session user and every query carries
 * `.eq("user_id", user.id)`. A contact id from the request body is
 * attacker-controlled and is never trusted on its own (Law #1).
 */
import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";
import { consentPolicyFor, setContactConsent } from "@/lib/compliance/consent";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

/** Where the consent came from. Free text is rejected — an unverifiable
 *  provenance string is worse than none in a compliance record. */
const SOURCES = ["whatsapp_optin", "web_form", "in_person", "phone", "imported"] as const;
type Source = (typeof SOURCES)[number];

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("contacts")
    .select("id, name, sensitive_data_consent, consent_timestamp, consent_source")
    .eq("user_id", user.id)
    .eq("id", params.id)
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "We couldn't find that contact." }, { status: 404 });

  const policy = await consentPolicyFor(user.id);
  const row = data as {
    id: string; name: string; sensitive_data_consent: boolean;
    consent_timestamp: string | null; consent_source: string | null;
  };

  return NextResponse.json({
    consent: {
      contactId: row.id,
      contactName: row.name,
      given: row.sensitive_data_consent,
      at: row.consent_timestamp,
      source: row.consent_source,
      /** When false, this contact can be messaged regardless. */
      required: policy.required,
      requiredBecause: policy.required ? policy.verticalName : null,
    },
  });
}

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  if (typeof body.given !== "boolean") {
    return NextResponse.json({ error: "given must be true or false" }, { status: 400 });
  }

  const source: Source = SOURCES.includes(body.source) ? body.source : "in_person";

  try {
    const row = await setContactConsent(user.id, params.id, body.given, source);
    // Consent changes are a compliance record — log who and when, at info, so
    // the trail exists even though contacts are tenant data (and therefore not
    // in the platform audit_logs table, which is for platform-staff actions).
    logger.info("consent: updated", {
      userId: user.id, contactId: params.id, given: body.given, source,
    });
    return NextResponse.json({
      consent: {
        contactId: row.id,
        given: row.sensitive_data_consent,
        at: row.consent_timestamp,
        source: body.given ? source : null,
      },
    });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}
