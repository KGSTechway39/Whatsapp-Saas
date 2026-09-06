/**
 * Catalog cart/order ingestion.
 *
 * When a customer submits a cart from a catalogue, Meta delivers an inbound
 * message of `type: "order"` carrying the line items. That is NOT a checkout —
 * no payment happened and none will. Meta's cart is a structured enquiry, so
 * what we do is record it as work for a human and notify the tenant.
 *
 * Called from the canonical webhook handler (never its own route), after
 * signature verification and inside the existing dedup, so a redelivered order
 * is stored exactly once.
 */
import { createServiceClient } from "@/lib/supabase/server";
import { logger } from "@/lib/logger";

/** Meta's order payload on an inbound message. */
export interface MetaOrderPayload {
  catalog_id?: string;
  text?: string;
  product_items?: {
    product_retailer_id: string;
    quantity: number | string;
    item_price: number | string;
    currency?: string;
  }[];
}

export interface StoredOrder {
  id: string;
  totalPaise: number;
  itemCount: number;
  duplicate: boolean;
}

/**
 * Money conversion. Meta sends `item_price` as a decimal in the cart currency
 * ("249.50"); everything downstream of here is integer paise, so the rounding
 * happens exactly once, at the boundary.
 */
function toPaise(value: number | string | undefined): number {
  const n = typeof value === "string" ? Number(value) : value ?? 0;
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100);
}

/**
 * Parse + persist one order.
 *
 * `waMessageId` doubles as the order identity: Meta does not send a separate
 * order id, and the message id is stable across redeliveries. The partial
 * UNIQUE index on (user_id, wa_order_id) means a retried webhook cannot create
 * a second order for the same cart — which would otherwise get fulfilled twice.
 */
export async function ingestCatalogOrder(args: {
  userId: string;
  customerPhone: string;
  contactId?: string | null;
  waMessageId: string;
  order: MetaOrderPayload;
  receivedAt?: string;
}): Promise<StoredOrder | null> {
  const items = (args.order.product_items ?? []).map((i) => ({
    product_retailer_id: i.product_retailer_id,
    quantity: Number(i.quantity) || 0,
    item_price_paise: toPaise(i.item_price),
    currency: i.currency ?? "INR",
  }));

  if (items.length === 0) {
    // A cart with no lines is not actionable. Log rather than store an empty
    // order that would sit in the queue meaning nothing.
    logger.warn("orders: order payload had no product items", {
      userId: args.userId, waMessageId: args.waMessageId,
    });
    return null;
  }

  const totalPaise = items.reduce((t, i) => t + i.item_price_paise * i.quantity, 0);
  const currency = items[0].currency;

  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("catalog_orders")
    .insert({
      user_id: args.userId,
      contact_id: args.contactId ?? null,
      customer_phone: args.customerPhone,
      wa_order_id: args.waMessageId,
      catalog_id: args.order.catalog_id ?? null,
      order_items: items,
      total_paise: totalPaise,
      currency,
      status: "received",
      notes: args.order.text ? `Customer note: ${args.order.text}` : null,
      received_at: args.receivedAt ?? new Date().toISOString(),
    })
    .select("id")
    .single();

  if (error) {
    // 23505 = unique violation → this cart is already recorded. That is the
    // idempotency guard doing its job, not a failure.
    if (error.code === "23505") {
      logger.info("orders: duplicate order ignored", { waMessageId: args.waMessageId });
      return { id: "", totalPaise, itemCount: items.length, duplicate: true };
    }
    throw new Error(error.message);
  }

  logger.info("orders: catalog order received", {
    userId: args.userId, orderId: (data as { id: string }).id,
    items: items.length, totalPaise,
  });

  return {
    id: (data as { id: string }).id,
    totalPaise,
    itemCount: items.length,
    duplicate: false,
  };
}

/**
 * Resolve a contact id for the phone that submitted the cart, so the order
 * links to the CRM record. Tenant-scoped — a phone number alone is never
 * enough to identify a row (Law 1).
 */
export async function findContactByPhone(userId: string, phone: string): Promise<string | null> {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from("contacts")
    .select("id")
    .eq("user_id", userId)
    .eq("phone", phone)
    .maybeSingle<{ id: string }>();
  return data?.id ?? null;
}
