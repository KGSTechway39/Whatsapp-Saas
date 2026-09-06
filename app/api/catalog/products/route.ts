/**
 * Products in the tenant's linked Meta catalogue — backs the composer's picker.
 *
 *   GET ?q=&refresh=1 → { products, cachedAt, stale }
 *
 * CACHED. Meta's /{catalog_id}/products is slow and rate-limited, and a picker
 * that hits it on every keystroke will get the tenant throttled. We serve a
 * short-lived in-process cache and filter locally; `refresh=1` forces a re-fetch.
 *
 * The cache is per-process and deliberately simple — on serverless it may be
 * cold often, which is correct behaviour (a cold miss just costs one fetch).
 * It exists to stop a burst from one composer session, not to be a CDN.
 */
import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";
import { decrypt } from "@/lib/crypto";
import { listCatalogProducts, type CatalogProduct } from "@/lib/whatsapp/commerce-messages";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

const TTL_MS = 5 * 60 * 1000;

interface Entry { products: CatalogProduct[]; at: number }
const cache = new Map<string, Entry>();

export async function GET(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const q = (request.nextUrl.searchParams.get("q") ?? "").trim().toLowerCase();
  const force = request.nextUrl.searchParams.get("refresh") === "1";

  const supabase = createServiceClient();
  const { data: conn } = await supabase
    .from("catalog_connections")
    .select("commerce_catalog_id, whatsapp_number_id")
    .eq("user_id", user.id)
    .eq("status", "linked")
    .maybeSingle<{ commerce_catalog_id: string; whatsapp_number_id: string | null }>();

  if (!conn) {
    return NextResponse.json({ error: "Connect your catalog first.", code: "NO_CATALOG" }, { status: 409 });
  }

  // Cache key is the catalogue, not the query — we filter locally so typing
  // never costs a round-trip.
  const key = `${user.id}:${conn.commerce_catalog_id}`;
  const hit = cache.get(key);
  const fresh = hit && Date.now() - hit.at < TTL_MS;

  let products: CatalogProduct[];
  let cachedAt: number;

  if (fresh && !force) {
    products = hit!.products;
    cachedAt = hit!.at;
  } else {
    let numQ = supabase
      .from("whatsapp_numbers")
      .select("access_token")
      .eq("user_id", user.id)
      .eq("status", "active");
    if (conn.whatsapp_number_id) numQ = numQ.eq("id", conn.whatsapp_number_id);

    const { data: num } = await numQ.order("is_primary", { ascending: false }).limit(1)
      .maybeSingle<{ access_token: string | null }>();
    if (!num?.access_token) {
      return NextResponse.json({ error: "No active WhatsApp number.", code: "NO_NUMBER" }, { status: 409 });
    }

    try {
      products = await listCatalogProducts(conn.commerce_catalog_id, await decrypt(num.access_token));
      cachedAt = Date.now();
      cache.set(key, { products, at: cachedAt });
    } catch (err) {
      // Serve stale rather than nothing: a picker that empties because Meta
      // rate-limited us is worse than one showing five-minute-old products.
      if (hit) {
        logger.warn("catalog: product fetch failed, serving stale", { error: (err as Error).message });
        products = hit.products;
        cachedAt = hit.at;
      } else {
        return NextResponse.json({ error: (err as Error).message }, { status: 502 });
      }
    }
  }

  const filtered = q
    ? products.filter(
        (p) => p.name.toLowerCase().includes(q) || p.retailerId.toLowerCase().includes(q),
      )
    : products;

  return NextResponse.json({
    products: filtered,
    total: products.length,
    cachedAt: new Date(cachedAt).toISOString(),
    stale: Date.now() - cachedAt >= TTL_MS,
  });
}
