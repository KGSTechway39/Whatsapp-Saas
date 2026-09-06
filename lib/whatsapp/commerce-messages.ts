/**
 * Meta Commerce interactive messages — catalog, single product, multi-product,
 * carousel — plus catalogue linking and commerce settings.
 *
 * These are NATIVE product cards, not text. The pre-existing
 * `lib/commerce.ts buildProductMessage()` formats a product into a plain text
 * body; it is unrelated and stays as-is for the local product catalogue.
 *
 * All Graph traffic goes through the pinned wrappers in lib/meta.ts (Law:
 * never scatter fetch('graph.facebook.com') into features). Credentials are
 * always resolved per tenant — nothing here takes a token from a caller.
 */
import { graphPost, graphGet } from "@/lib/meta";
import { logger } from "@/lib/logger";

/** Meta's hard cap: 30 products across all sections of one MPM. */
export const MPM_MAX_PRODUCTS = 30;
/** Meta's cap on sections in a multi-product message. */
export const MPM_MAX_SECTIONS = 10;
/** Carousel cap. */
export const CAROUSEL_MAX_PRODUCTS = 10;

export interface ProductSection {
  title: string;
  productRetailerIds: string[];
}

export class CommerceValidationError extends Error {
  readonly code = "COMMERCE_VALIDATION";
  constructor(message: string) {
    super(message);
    this.name = "CommerceValidationError";
  }
}

interface SendArgs {
  phoneNumberId: string;
  accessToken: string;
  to: string;
}

const envelope = (to: string) => ({
  messaging_product: "whatsapp",
  recipient_type: "individual",
  to,
  type: "interactive",
});

/**
 * Full catalogue. Meta renders a "View catalog" card; there is no product id
 * because the whole linked catalogue is the payload.
 */
export async function sendCatalogMessage(
  args: SendArgs & { bodyText: string; footerText?: string },
): Promise<{ messageId?: string }> {
  const body = args.bodyText?.trim();
  if (!body) throw new CommerceValidationError("A message body is required.");

  const data = await graphPost<{ messages: { id: string }[] }>(
    `/${args.phoneNumberId}/messages`,
    args.accessToken,
    {
      ...envelope(args.to),
      interactive: {
        type: "catalog_message",
        body: { text: body },
        ...(args.footerText ? { footer: { text: args.footerText } } : {}),
        action: { name: "catalog_message" },
      },
    },
  );
  return { messageId: data.messages?.[0]?.id };
}

/** One product card (SPM). */
export async function sendSingleProductMessage(
  args: SendArgs & { catalogId: string; productRetailerId: string; bodyText: string; footerText?: string },
): Promise<{ messageId?: string }> {
  if (!args.productRetailerId?.trim()) {
    throw new CommerceValidationError("A product is required.");
  }

  const data = await graphPost<{ messages: { id: string }[] }>(
    `/${args.phoneNumberId}/messages`,
    args.accessToken,
    {
      ...envelope(args.to),
      interactive: {
        type: "product",
        body: { text: args.bodyText },
        ...(args.footerText ? { footer: { text: args.footerText } } : {}),
        action: {
          catalog_id: args.catalogId,
          product_retailer_id: args.productRetailerId,
        },
      },
    },
  );
  return { messageId: data.messages?.[0]?.id };
}

/**
 * Curated selection across named sections (MPM).
 *
 * The caps are enforced HERE, before the call. Letting Meta reject a 31-product
 * payload wastes a round-trip and returns an opaque error the tenant can't act
 * on; "you picked 34, the limit is 30" is something they can fix.
 */
export async function sendMultiProductMessage(
  args: SendArgs & {
    catalogId: string;
    sections: ProductSection[];
    headerText: string;
    bodyText: string;
    footerText?: string;
  },
): Promise<{ messageId?: string }> {
  const sections = (args.sections ?? []).filter((s) => s.productRetailerIds?.length);
  if (sections.length === 0) {
    throw new CommerceValidationError("Add at least one product.");
  }
  if (sections.length > MPM_MAX_SECTIONS) {
    throw new CommerceValidationError(
      `That's ${sections.length} sections — WhatsApp allows ${MPM_MAX_SECTIONS}.`,
    );
  }

  const total = sections.reduce((n, s) => n + s.productRetailerIds.length, 0);
  if (total > MPM_MAX_PRODUCTS) {
    throw new CommerceValidationError(
      `That's ${total} products — WhatsApp allows ${MPM_MAX_PRODUCTS} in one message.`,
    );
  }
  // A duplicated retailer id renders as the same card twice and looks broken.
  const seen = new Set<string>();
  for (const s of sections) {
    for (const id of s.productRetailerIds) {
      if (seen.has(id)) {
        throw new CommerceValidationError(`"${id}" appears more than once — each product can only be listed once.`);
      }
      seen.add(id);
    }
  }
  if (!args.headerText?.trim()) {
    throw new CommerceValidationError("A header is required for a multi-product message.");
  }

  const data = await graphPost<{ messages: { id: string }[] }>(
    `/${args.phoneNumberId}/messages`,
    args.accessToken,
    {
      ...envelope(args.to),
      interactive: {
        type: "product_list",
        header: { type: "text", text: args.headerText },
        body: { text: args.bodyText },
        ...(args.footerText ? { footer: { text: args.footerText } } : {}),
        action: {
          catalog_id: args.catalogId,
          sections: sections.map((s) => ({
            title: s.title,
            product_items: s.productRetailerIds.map((id) => ({ product_retailer_id: id })),
          })),
        },
      },
    },
  );
  return { messageId: data.messages?.[0]?.id };
}

/**
 * Horizontally scrollable product carousel.
 *
 * NOTE for whoever maintains this: Meta has shipped carousels under more than
 * one shape (template-based carousels, and an interactive product carousel that
 * is not enabled for every account). We send the interactive form and let a
 * MetaApiError surface unchanged rather than silently downgrading to an MPM —
 * a tenant who asked for a carousel and got a list would have no idea why.
 */
export async function sendProductCarousel(
  args: SendArgs & { catalogId: string; productRetailerIds: string[]; bodyText: string; footerText?: string },
): Promise<{ messageId?: string }> {
  const ids = (args.productRetailerIds ?? []).filter(Boolean);
  if (ids.length === 0) throw new CommerceValidationError("Add at least one product.");
  if (ids.length > CAROUSEL_MAX_PRODUCTS) {
    throw new CommerceValidationError(
      `That's ${ids.length} products — a carousel holds ${CAROUSEL_MAX_PRODUCTS}.`,
    );
  }

  const data = await graphPost<{ messages: { id: string }[] }>(
    `/${args.phoneNumberId}/messages`,
    args.accessToken,
    {
      ...envelope(args.to),
      interactive: {
        type: "product_carousel",
        body: { text: args.bodyText },
        ...(args.footerText ? { footer: { text: args.footerText } } : {}),
        action: {
          catalog_id: args.catalogId,
          product_items: ids.map((id) => ({ product_retailer_id: id })),
        },
      },
    },
  );
  return { messageId: data.messages?.[0]?.id };
}

/* ── Catalogue linking & commerce settings ─────────────────────────────── */

/** Link an existing Commerce Manager catalogue to a WABA. */
export async function linkCatalogToWaba(
  wabaId: string,
  accessToken: string,
  catalogId: string,
): Promise<void> {
  await graphPost(`/${wabaId}/product_catalogs`, accessToken, { catalog_id: catalogId });
  logger.info("commerce: catalog linked to waba", { wabaId, catalogId });
}

export interface CommerceSettings {
  cartEnabled: boolean;
  catalogVisible: boolean;
}

/**
 * READ Meta's commerce settings for a number.
 *
 * Every write is followed by one of these. Storing what we *asked for* rather
 * than what Meta *has* is how a toggle ends up lying: the UI shows carts on,
 * the tenant wonders why no orders arrive, and nothing in our data disagrees.
 */
export async function getCommerceSettings(
  phoneNumberId: string,
  accessToken: string,
): Promise<CommerceSettings | null> {
  try {
    const data = await graphGet<{
      data?: { is_cart_enabled?: boolean; is_catalog_visible?: boolean }[];
    }>(`/${phoneNumberId}/whatsapp_commerce_settings`, accessToken);
    const row = data.data?.[0];
    if (!row) return null;
    return {
      cartEnabled: row.is_cart_enabled !== false,
      catalogVisible: row.is_catalog_visible === true,
    };
  } catch (err) {
    logger.warn("commerce: could not read commerce settings", { error: (err as Error).message });
    return null;
  }
}

/** Write commerce settings, then return Meta's own read-back. */
export async function setCommerceSettings(
  phoneNumberId: string,
  accessToken: string,
  next: Partial<CommerceSettings>,
): Promise<CommerceSettings | null> {
  const payload: Record<string, boolean> = {};
  if (next.cartEnabled !== undefined) payload.is_cart_enabled = next.cartEnabled;
  if (next.catalogVisible !== undefined) payload.is_catalog_visible = next.catalogVisible;

  await graphPost(`/${phoneNumberId}/whatsapp_commerce_settings`, accessToken, payload);
  // Deliberately re-read rather than echoing `next`.
  return getCommerceSettings(phoneNumberId, accessToken);
}

/** Products in a linked catalogue, for the composer's picker. */
export interface CatalogProduct {
  retailerId: string;
  name: string;
  price: string | null;
  currency: string | null;
  imageUrl: string | null;
  availability: string | null;
}

export async function listCatalogProducts(
  catalogId: string,
  accessToken: string,
  limit = 100,
): Promise<CatalogProduct[]> {
  const data = await graphGet<{
    data?: {
      retailer_id: string; name: string; price?: string; currency?: string;
      image_url?: string; availability?: string;
    }[];
  }>(`/${catalogId}/products`, accessToken, {
    fields: "retailer_id,name,price,currency,image_url,availability",
    limit: String(limit),
  });

  return (data.data ?? []).map((p) => ({
    retailerId: p.retailer_id,
    name: p.name,
    price: p.price ?? null,
    currency: p.currency ?? null,
    imageUrl: p.image_url ?? null,
    availability: p.availability ?? null,
  }));
}
