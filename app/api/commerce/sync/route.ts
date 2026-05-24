import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { fetchShopifyProducts, fetchWooProducts, CommerceError } from "@/lib/commerce";

// POST /api/commerce/sync  Body: { connectionId: string }
// Pulls products from the connected store, upserts into our `products` table.
export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { connectionId } = await req.json();
  if (!connectionId) return NextResponse.json({ error: "connectionId required" }, { status: 400 });

  const supabase = createClient();
  const { data: conn, error: connErr } = await supabase
    .from("commerce_connections")
    .select("*")
    .eq("id", connectionId)
    .eq("user_id", user.id)
    .single();

  if (connErr || !conn) return NextResponse.json({ error: "Connection not found" }, { status: 404 });

  try {
    const products =
      conn.provider === "shopify"
        ? await fetchShopifyProducts(conn.shop_domain, conn.access_token)
        : conn.provider === "woocommerce"
        ? await fetchWooProducts(conn.shop_domain, conn.access_token, conn.api_secret)
        : [];

    if (products.length === 0) {
      return NextResponse.json({ synced: 0, message: "No products found" });
    }

    const rows = products.map((p) => ({
      ...p,
      user_id: user.id,
      connection_id: conn.id,
      status: p.in_stock ? "active" : "out_of_stock",
      updated_at: new Date().toISOString(),
    }));

    const { error: upErr } = await supabase
      .from("products")
      .upsert(rows, { onConflict: "user_id,external_id,connection_id" });

    if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });

    await supabase
      .from("commerce_connections")
      .update({
        last_synced_at: new Date().toISOString(),
        product_count: rows.length,
      })
      .eq("id", conn.id);

    return NextResponse.json({ synced: rows.length });
  } catch (err) {
    const status = err instanceof CommerceError ? err.status : 500;
    const msg = err instanceof Error ? err.message : "Sync failed";
    return NextResponse.json({ error: msg }, { status });
  }
}
