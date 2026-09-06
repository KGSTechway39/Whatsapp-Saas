/**
 * Send a catalog / product message.
 *
 *   POST { type, contactId | to, bodyText, ... } → { messageId, billedAs }
 *   GET  ?contactId=&type=  → { canSend, billedAs, reason }   dry-run for the composer
 *
 * type: "catalog" | "product" | "product_list" | "carousel"
 *
 * ── A NOTE ON THE 24-HOUR WINDOW AND BILLING ──────────────────────────────
 * The commerce spec says a proactive catalog message bills at MARKETING and a
 * reply inside the window is free. The second half is right. The first half
 * cannot happen with these message types: catalog/product/product_list/
 * carousel are INTERACTIVE messages, and Meta only delivers interactive
 * messages inside an open 24-hour customer-service window. Outside it Meta
 * rejects the send — there is no marketing-priced interactive catalog message
 * to bill for.
 *
 * So this route enforces the window (Law 5) and refuses outside it with an
 * actionable message, rather than charging a tenant marketing rates for a send
 * Meta will throw away. The MARKETING branch of the resolver is still correct
 * and still used — it is what a template-based catalog send will bill at when
 * that path is added.
 *
 * ── Order of gates (each one exists for a different failure) ──────────────
 *   auth → compliance attestation → catalogue linked → contact resolves
 *        → consent (regulated verticals) → 24h window → wallet → send
 */
import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";
import { decrypt } from "@/lib/crypto";
import { guardedSingleSend } from "@/lib/billing/guarded-send";
import { InsufficientBalanceError } from "@/lib/billing/wallet";
import { resolveCommerceCategory } from "@/lib/billing/commerce-category";
import { assertConsent, ConsentRequiredError } from "@/lib/compliance/consent";
import { getVerticalForUser } from "@/lib/verticals/repository";
import { canSend } from "@/lib/whatsapp/window";
import {
  sendCatalogMessage, sendSingleProductMessage, sendMultiProductMessage,
  sendProductCarousel, CommerceValidationError, type ProductSection,
} from "@/lib/whatsapp/commerce-messages";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

const TYPES = ["catalog", "product", "product_list", "carousel"] as const;
type SendType = (typeof TYPES)[number];

interface Resolved {
  numberId: string;
  phoneNumberId: string;
  token: string;
  catalogId: string;
  contactId: string | null;
  phone: string;
}

/** Everything a commerce send needs, or a NextResponse explaining what's missing. */
async function resolveContext(
  userId: string,
  body: { contactId?: string; to?: string; numberId?: string },
): Promise<Resolved | NextResponse> {
  const supabase = createServiceClient();

  // 1. Compliance attestation, where the industry demands one.
  const [{ data: userRow }, vertical] = await Promise.all([
    supabase
      .from("users")
      .select("commerce_compliance_confirmed")
      .eq("id", userId)
      .maybeSingle<{ commerce_compliance_confirmed: boolean }>(),
    getVerticalForUser(userId).catch(() => null),
  ]);
  if (vertical?.requiresComplianceAttestation && userRow?.commerce_compliance_confirmed !== true) {
    return NextResponse.json(
      { error: "Confirm the selling-compliance declaration before sending catalog messages.", code: "COMPLIANCE_REQUIRED" },
      { status: 409 },
    );
  }

  // 2. A linked catalogue.
  const { data: conn } = await supabase
    .from("catalog_connections")
    .select("commerce_catalog_id, whatsapp_number_id")
    .eq("user_id", userId)
    .eq("status", "linked")
    .maybeSingle<{ commerce_catalog_id: string; whatsapp_number_id: string | null }>();
  if (!conn) {
    return NextResponse.json(
      { error: "Connect your catalog first.", code: "NO_CATALOG" },
      { status: 409 },
    );
  }

  // 3. An active number with a usable token.
  let numQ = supabase
    .from("whatsapp_numbers")
    .select("id, phone_number_id, access_token")
    .eq("user_id", userId)
    .eq("status", "active");
  const preferred = body.numberId ?? conn.whatsapp_number_id;
  if (preferred) numQ = numQ.eq("id", preferred);

  const { data: num } = await numQ.order("is_primary", { ascending: false }).limit(1).maybeSingle<{
    id: string; phone_number_id: string | null; access_token: string | null;
  }>();
  if (!num?.phone_number_id || !num.access_token) {
    return NextResponse.json(
      { error: "No active WhatsApp number to send from.", code: "NO_NUMBER" },
      { status: 409 },
    );
  }

  // 4. The recipient. A contact id is strongly preferred — without it we have
  //    no window state and no consent record, which are the two things that
  //    decide whether this send is legal and what it costs.
  let contactId = body.contactId ?? null;
  let phone = body.to ?? "";
  if (contactId) {
    const { data: c } = await supabase
      .from("contacts")
      .select("phone")
      .eq("user_id", userId)          // tenant scoping — Law 1
      .eq("id", contactId)
      .maybeSingle<{ phone: string }>();
    if (!c) return NextResponse.json({ error: "We couldn't find that contact." }, { status: 404 });
    phone = c.phone;
  } else if (phone) {
    const { data: c } = await supabase
      .from("contacts")
      .select("id")
      .eq("user_id", userId)
      .eq("phone", phone)
      .maybeSingle<{ id: string }>();
    contactId = c?.id ?? null;
  } else {
    return NextResponse.json({ error: "Choose who to send to." }, { status: 400 });
  }

  return {
    numberId: num.id,
    phoneNumberId: num.phone_number_id,
    token: await decrypt(num.access_token),
    catalogId: conn.commerce_catalog_id,
    contactId,
    phone,
  };
}

/**
 * Dry run for the composer: may this go now, and what will it cost?
 * Returns the tenant-facing category only — never a rate.
 */
export async function GET(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const contactId = request.nextUrl.searchParams.get("contactId");
  const decision = await resolveCommerceCategory(contactId);
  const gate = canSend("interactive", decision.window);

  return NextResponse.json({
    canSend: gate.ok,
    billedAs: decision.category,
    free: decision.category === "SERVICE",
    reason: gate.ok
      ? decision.reason
      : "You can only send catalog messages within 24 hours of their last message. Send an approved template instead.",
    windowOpen: decision.window.open,
    windowExpiresAt: decision.window.expiresAt,
  });
}

export async function POST(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const type = body.type as SendType;
  if (!TYPES.includes(type)) {
    return NextResponse.json({ error: `type must be one of ${TYPES.join(", ")}` }, { status: 400 });
  }
  const bodyText = String(body.bodyText ?? "").trim();
  if (!bodyText) return NextResponse.json({ error: "Write a message to go with it." }, { status: 400 });

  const ctx = await resolveContext(user.id, body);
  if (ctx instanceof NextResponse) return ctx;

  // 5. Consent, for verticals that require it.
  try {
    await assertConsent(user.id, ctx.contactId);
  } catch (err) {
    if (err instanceof ConsentRequiredError) {
      return NextResponse.json({ error: err.message, code: "CONSENT_REQUIRED" }, { status: 422 });
    }
    throw err;
  }

  // 6. The 24h window. Interactive messages live and die by this.
  const decision = await resolveCommerceCategory(ctx.contactId);
  const gate = canSend("interactive", decision.window);
  if (!gate.ok) {
    return NextResponse.json(
      {
        error:
          "It's been more than 24 hours since they messaged you, so WhatsApp won't deliver a catalog message. Send an approved template instead.",
        code: "OUTSIDE_24H_WINDOW",
      },
      { status: 422 },
    );
  }

  // 7. Wallet + send, through the sanctioned wrapper. BYO passes straight
  //    through; managed reserves, sends, then settles on the delivery webhook.
  const idem = `catalog:${type}:${ctx.contactId ?? ctx.phone}:${Date.now()}`;

  try {
    const result = await guardedSingleSend<{ messageId?: string }>({
      userId: user.id,
      category: decision.category,
      idempotencyKey: idem,
      referenceId: `catalog:${type}`,
      description: `Catalog message (${type})`,
      send: () => {
        const base = { phoneNumberId: ctx.phoneNumberId, accessToken: ctx.token, to: ctx.phone };
        switch (type) {
          case "catalog":
            return sendCatalogMessage({ ...base, bodyText, footerText: body.footerText });
          case "product":
            return sendSingleProductMessage({
              ...base, catalogId: ctx.catalogId,
              productRetailerId: String(body.productRetailerId ?? ""),
              bodyText, footerText: body.footerText,
            });
          case "product_list":
            return sendMultiProductMessage({
              ...base, catalogId: ctx.catalogId,
              sections: (body.sections ?? []) as ProductSection[],
              headerText: String(body.headerText ?? ""),
              bodyText, footerText: body.footerText,
            });
          case "carousel":
            return sendProductCarousel({
              ...base, catalogId: ctx.catalogId,
              productRetailerIds: (body.productRetailerIds ?? []) as string[],
              bodyText, footerText: body.footerText,
            });
        }
      },
    });

    logger.info("catalog: message sent", { userId: user.id, type, billedAs: decision.category });

    return NextResponse.json({
      messageId: result.messageId,
      // Tenant-facing only. The rate itself is never returned here.
      billedAs: decision.category,
      free: decision.category === "SERVICE",
    });
  } catch (err) {
    // Validation failures are the tenant's to fix (too many products, none
    // chosen) — a 400 with the specific reason, not a generic 500.
    if (err instanceof CommerceValidationError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: 400 });
    }
    if (err instanceof InsufficientBalanceError) {
      return NextResponse.json(
        { error: "Not enough credit to send. Please top up.", code: "INSUFFICIENT_BALANCE" },
        { status: 402 },
      );
    }
    const msg = err instanceof Error ? err.message : "Send failed";
    logger.warn("catalog: send failed", { userId: user.id, type, error: msg });
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
