import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

// GET /api/carts?status=abandoned
export async function GET(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const status = req.nextUrl.searchParams.get("status");
  const supabase = createClient();
  let query = supabase
    .from("carts")
    .select(`
      id, status, total, currency, items_count, checkout_url,
      abandoned_at, recovered_at, recovery_message_sent_at, recovery_attempts,
      last_activity_at, created_at,
      contact:contact_id ( id, name, phone ),
      cart_items ( id, name, quantity, price, image_url )
    `)
    .eq("user_id", user.id);

  if (status) query = query.eq("status", status);

  const { data, error } = await query.order("last_activity_at", { ascending: false }).limit(100);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Summary
  const all = data || [];
  const summary = {
    abandoned: all.filter((c) => c.status === "abandoned").length,
    recovered: all.filter((c) => c.status === "recovered").length,
    converted: all.filter((c) => c.status === "converted").length,
    abandoned_value: all.filter((c) => c.status === "abandoned").reduce((s, c) => s + Number(c.total || 0), 0),
    recovered_value: all.filter((c) => c.status === "recovered" || c.status === "converted").reduce((s, c) => s + Number(c.total || 0), 0),
  };

  return NextResponse.json({ carts: data, summary });
}

// POST /api/carts — create a cart (called by Shopify webhook or manual test)
export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  if (!body.contactId || !Array.isArray(body.items)) {
    return NextResponse.json({ error: "contactId and items[] are required" }, { status: 400 });
  }

  const supabase = createClient();
  type Item = { name: string; quantity?: number; price: number; image_url?: string; product_id?: string };
  const total = (body.items as Item[]).reduce(
    (s, it) => s + Number(it.price || 0) * Number(it.quantity || 1), 0,
  );

  const { data: cart, error: cartErr } = await supabase
    .from("carts")
    .insert({
      user_id: user.id,
      contact_id: body.contactId,
      external_id: body.externalId || null,
      status: body.status || "active",
      total,
      currency: body.currency || "INR",
      items_count: body.items.length,
      checkout_url: body.checkoutUrl || null,
      last_activity_at: new Date().toISOString(),
    })
    .select()
    .single();

  if (cartErr) return NextResponse.json({ error: cartErr.message }, { status: 500 });

  const itemRows = (body.items as Item[]).map((it) => ({
    cart_id: cart.id,
    product_id: it.product_id || null,
    name: it.name,
    quantity: it.quantity || 1,
    price: Number(it.price || 0),
    image_url: it.image_url || null,
  }));

  if (itemRows.length > 0) await supabase.from("cart_items").insert(itemRows);

  return NextResponse.json({ cart }, { status: 201 });
}
