// Commerce sync helpers — Shopify (REST Admin) + WooCommerce (REST v3).

export interface NormalizedProduct {
  external_id: string;
  sku: string | null;
  name: string;
  description: string | null;
  price: number;
  compare_at_price: number | null;
  currency: string;
  image_url: string | null;
  product_url: string | null;
  category: string | null;
  tags: string[];
  in_stock: boolean;
  inventory_count: number | null;
}

export class CommerceError extends Error {
  status: number;
  constructor(message: string, status = 500) {
    super(message);
    this.status = status;
  }
}

// ── Shopify ──────────────────────────────────────────────────────────────
// shopDomain: <store>.myshopify.com   accessToken: from OAuth or admin API
export async function fetchShopifyProducts(
  shopDomain: string,
  accessToken: string,
): Promise<NormalizedProduct[]> {
  const url = `https://${shopDomain}/admin/api/2024-10/products.json?limit=250&status=active`;
  const res = await fetch(url, {
    headers: { "X-Shopify-Access-Token": accessToken, "Content-Type": "application/json" },
    cache: "no-store",
  });
  if (!res.ok) throw new CommerceError(`Shopify error ${res.status}`, res.status);

  type ShopifyProduct = {
    id: number;
    title: string;
    body_html: string | null;
    handle: string;
    product_type: string | null;
    tags: string;
    image: { src: string } | null;
    variants: { id: number; sku: string | null; price: string; compare_at_price: string | null; inventory_quantity: number; inventory_management: string | null }[];
  };
  const data = (await res.json()) as { products: ShopifyProduct[] };

  return data.products.map((p) => {
    const variant = p.variants?.[0];
    const inventory = variant?.inventory_quantity ?? 0;
    return {
      external_id: String(p.id),
      sku: variant?.sku || null,
      name: p.title,
      description: stripHtml(p.body_html || ""),
      price: Number(variant?.price ?? 0),
      compare_at_price: variant?.compare_at_price ? Number(variant.compare_at_price) : null,
      currency: "INR",
      image_url: p.image?.src || null,
      product_url: `https://${shopDomain.replace(".myshopify.com", "")}/products/${p.handle}`,
      category: p.product_type || null,
      tags: p.tags ? p.tags.split(",").map((t) => t.trim()).filter(Boolean) : [],
      in_stock: inventory > 0 || variant?.inventory_management === null,
      inventory_count: inventory,
    };
  });
}

// ── WooCommerce ──────────────────────────────────────────────────────────
// shopDomain: full origin like https://yourstore.com
export async function fetchWooProducts(
  shopDomain: string,
  consumerKey: string,
  consumerSecret: string,
): Promise<NormalizedProduct[]> {
  const base = shopDomain.replace(/\/$/, "");
  const auth = Buffer.from(`${consumerKey}:${consumerSecret}`).toString("base64");
  const url = `${base}/wp-json/wc/v3/products?per_page=100&status=publish`;

  const res = await fetch(url, {
    headers: { Authorization: `Basic ${auth}` },
    cache: "no-store",
  });
  if (!res.ok) throw new CommerceError(`Woo error ${res.status}`, res.status);

  type WooProduct = {
    id: number;
    name: string;
    slug: string;
    sku: string;
    description: string;
    short_description: string;
    price: string;
    regular_price: string;
    sale_price: string;
    permalink: string;
    images: { src: string }[];
    categories: { name: string }[];
    tags: { name: string }[];
    stock_quantity: number | null;
    stock_status: "instock" | "outofstock" | "onbackorder";
    manage_stock: boolean;
  };
  const data = (await res.json()) as WooProduct[];

  return data.map((p) => ({
    external_id: String(p.id),
    sku: p.sku || null,
    name: p.name,
    description: stripHtml(p.short_description || p.description || ""),
    price: Number(p.price ?? 0),
    compare_at_price: p.sale_price && p.regular_price !== p.sale_price ? Number(p.regular_price) : null,
    currency: "INR",
    image_url: p.images?.[0]?.src || null,
    product_url: p.permalink,
    category: p.categories?.[0]?.name || null,
    tags: (p.tags || []).map((t) => t.name),
    in_stock: p.stock_status === "instock",
    inventory_count: p.manage_stock ? p.stock_quantity : null,
  }));
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim().slice(0, 1024);
}

// ── Build a WhatsApp interactive product message body ───────────────────
// Returns a text string we can send via /api/whatsapp/send.
// (When a real Meta Commerce Catalog is wired, replace this with the
// `interactive: { type: 'product', body: ..., action: { catalog_id, product_retailer_id } }`
// payload.)
export function buildProductMessage(p: { name: string; description: string | null; price: number; currency: string; image_url: string | null; product_url: string | null }): string {
  const lines = [
    `*${p.name}*`,
    "",
    p.description?.slice(0, 400),
    "",
    `💰 ${p.currency === "INR" ? "₹" : p.currency + " "}${p.price.toLocaleString()}`,
  ].filter(Boolean);
  if (p.product_url) lines.push("", `🔗 ${p.product_url}`);
  return lines.join("\n");
}
