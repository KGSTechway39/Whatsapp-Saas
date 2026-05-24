import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

// GET /api/commerce/connect — list connections
export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const supabase = createClient();
  const { data, error } = await supabase
    .from("commerce_connections")
    .select("id, provider, shop_domain, status, last_synced_at, product_count, created_at")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ connections: data });
}

// POST /api/commerce/connect — save a Shopify or WooCommerce connection.
// Body: { provider: 'shopify' | 'woocommerce', shopDomain: string,
//         accessToken: string, apiSecret?: string }
export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { provider, shopDomain, accessToken, apiSecret } = await req.json();

  if (!provider || !["shopify", "woocommerce"].includes(provider)) {
    return NextResponse.json({ error: "Invalid provider" }, { status: 400 });
  }
  if (!shopDomain?.trim() || !accessToken?.trim()) {
    return NextResponse.json({ error: "shopDomain and accessToken are required" }, { status: 400 });
  }
  if (provider === "woocommerce" && !apiSecret?.trim()) {
    return NextResponse.json({ error: "apiSecret (consumer secret) is required for WooCommerce" }, { status: 400 });
  }

  const supabase = createClient();
  const { data, error } = await supabase
    .from("commerce_connections")
    .insert({
      user_id: user.id,
      provider,
      shop_domain: shopDomain.trim(),
      access_token: accessToken.trim(),
      api_secret: apiSecret?.trim() || null,
      status: "active",
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ connection: data }, { status: 201 });
}

// DELETE /api/commerce/connect?id=
export async function DELETE(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const supabase = createClient();
  const { error } = await supabase
    .from("commerce_connections")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
