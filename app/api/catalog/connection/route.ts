/**
 * A tenant's Meta Commerce catalogue connection.
 *
 *   GET                                    → { connection, compliance, settings }
 *   POST { catalogId, numberId? }          → link a Commerce Manager catalogue
 *   PATCH { cartEnabled?, catalogVisible? } → commerce settings (read back from Meta)
 *
 * SendAnjal does not create catalogues on Meta's behalf. The tenant creates one in
 * Commerce Manager and pastes its id here; we link it to their WABA.
 *
 * COMPLIANCE GATE: verticals flagged `requires_compliance_attestation`
 * (E-commerce today) must have the tenant's attestation on file before linking.
 * The flag lives on the vertical row, so this is never `if (ecommerce)`.
 *
 * Tenant-scoped: runs as the session user, every query carries user_id.
 */
import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";
import { decrypt } from "@/lib/crypto";
import { getVerticalForUser } from "@/lib/verticals/repository";
import {
  linkCatalogToWaba, getCommerceSettings, setCommerceSettings,
} from "@/lib/whatsapp/commerce-messages";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

/** The number a catalogue is surfaced on, with its decrypted token. */
async function resolveNumber(userId: string, numberId?: string | null) {
  const supabase = createServiceClient();
  let q = supabase
    .from("whatsapp_numbers")
    .select("id, waba_id, phone_number_id, access_token, phone_number")
    .eq("user_id", userId)
    .eq("status", "active");
  if (numberId) q = q.eq("id", numberId);

  const { data } = await q.order("is_primary", { ascending: false }).limit(1).maybeSingle<{
    id: string; waba_id: string | null; phone_number_id: string | null;
    access_token: string | null; phone_number: string;
  }>();
  if (!data?.access_token || !data.phone_number_id) return null;
  return { ...data, token: await decrypt(data.access_token) };
}

/** Is this tenant allowed to use catalogue features yet? */
async function complianceState(userId: string) {
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
  return {
    required,
    confirmed: user?.commerce_compliance_confirmed === true,
    confirmedAt: user?.commerce_compliance_at ?? null,
    // Blocked only when the vertical demands it AND it isn't on file.
    blocked: required && user?.commerce_compliance_confirmed !== true,
  };
}

export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const supabase = createServiceClient();
  const { data: connection } = await supabase
    .from("catalog_connections")
    .select("id, commerce_catalog_id, whatsapp_number_id, cart_enabled, catalog_visibility, status, last_error, linked_at")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .maybeSingle();

  const compliance = await complianceState(user.id);

  // Live settings from Meta, never our stored copy — the stored row is a
  // mirror, and if the two disagree Meta is right.
  let settings = null;
  if (connection) {
    const num = await resolveNumber(user.id, (connection as { whatsapp_number_id: string | null }).whatsapp_number_id);
    if (num) settings = await getCommerceSettings(num.phone_number_id!, num.token);
  }

  return NextResponse.json({ connection: connection ?? null, compliance, settings });
}

export async function POST(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const catalogId = String(body.catalogId ?? "").trim();
  if (!catalogId) {
    return NextResponse.json({ error: "Enter your Commerce Manager catalog ID." }, { status: 400 });
  }
  // Meta catalogue ids are numeric. Catching this here beats a confusing Graph
  // error after the tenant pasted a URL or a catalogue name by mistake.
  if (!/^\d{5,}$/.test(catalogId)) {
    return NextResponse.json(
      { error: "That doesn't look like a catalog ID — it should be a long number from Commerce Manager." },
      { status: 400 },
    );
  }

  const compliance = await complianceState(user.id);
  if (compliance.blocked) {
    return NextResponse.json(
      {
        error: "Confirm the selling-compliance declaration before connecting a catalog.",
        code: "COMPLIANCE_REQUIRED",
      },
      { status: 409 },
    );
  }

  const num = await resolveNumber(user.id, body.numberId);
  if (!num || !num.waba_id) {
    return NextResponse.json(
      { error: "Connect an active WhatsApp number first — a catalog is linked to it." },
      { status: 409 },
    );
  }

  const supabase = createServiceClient();
  const baseRow = {
    user_id: user.id,
    commerce_catalog_id: catalogId,
    whatsapp_number_id: num.id,
    updated_at: new Date().toISOString(),
  };

  try {
    await linkCatalogToWaba(num.waba_id, num.token, catalogId);
  } catch (err) {
    // Record the failure with Meta's own words — support can act on it without
    // re-running the link and hoping for the same error.
    await supabase.from("catalog_connections").upsert(
      { ...baseRow, status: "failed", last_error: (err as Error).message },
      { onConflict: "user_id,commerce_catalog_id" },
    );
    logger.warn("catalog: link failed", { userId: user.id, error: (err as Error).message });
    return NextResponse.json({ error: (err as Error).message }, { status: 502 });
  }

  // Read Meta's real settings rather than assuming the defaults took.
  const settings = await getCommerceSettings(num.phone_number_id!, num.token);

  const { data, error } = await supabase
    .from("catalog_connections")
    .upsert(
      {
        ...baseRow,
        status: "linked",
        last_error: null,
        linked_at: new Date().toISOString(),
        cart_enabled: settings?.cartEnabled ?? true,
        catalog_visibility: settings?.catalogVisible ?? false,
      },
      { onConflict: "user_id,commerce_catalog_id" },
    )
    .select("id, commerce_catalog_id, cart_enabled, catalog_visibility, status, linked_at")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ connection: data, settings }, { status: 201 });
}

export async function PATCH(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const next: { cartEnabled?: boolean; catalogVisible?: boolean } = {};
  if (typeof body.cartEnabled === "boolean") next.cartEnabled = body.cartEnabled;
  if (typeof body.catalogVisible === "boolean") next.catalogVisible = body.catalogVisible;
  if (Object.keys(next).length === 0) {
    return NextResponse.json({ error: "Nothing to change." }, { status: 400 });
  }

  const supabase = createServiceClient();
  const { data: connection } = await supabase
    .from("catalog_connections")
    .select("id, whatsapp_number_id")
    .eq("user_id", user.id)
    .eq("status", "linked")
    .maybeSingle<{ id: string; whatsapp_number_id: string | null }>();

  if (!connection) {
    return NextResponse.json({ error: "Connect a catalog first." }, { status: 409 });
  }

  const num = await resolveNumber(user.id, connection.whatsapp_number_id);
  if (!num) return NextResponse.json({ error: "No active WhatsApp number." }, { status: 409 });

  let settings;
  try {
    settings = await setCommerceSettings(num.phone_number_id!, num.token, next);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 502 });
  }

  // Persist Meta's read-back, NOT what we asked for. If Meta kept the old
  // value the UI must show the old value.
  if (settings) {
    await supabase
      .from("catalog_connections")
      .update({
        cart_enabled: settings.cartEnabled,
        catalog_visibility: settings.catalogVisible,
        updated_at: new Date().toISOString(),
      })
      .eq("id", connection.id);
  }

  return NextResponse.json({ settings });
}
