import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { buildProductMessage } from "@/lib/commerce";

// POST /api/products/send
// Body: { productId: string, contactIds: string[], numberId: string }
// Builds a product-style message and queues sends through campaign_messages.
export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { productId, contactIds, numberId } = await req.json();

  if (!productId || !Array.isArray(contactIds) || contactIds.length === 0 || !numberId) {
    return NextResponse.json({ error: "productId, contactIds[], numberId are required" }, { status: 400 });
  }

  const supabase = createClient();

  const { data: product, error: prodErr } = await supabase
    .from("products")
    .select("*")
    .eq("id", productId)
    .eq("user_id", user.id)
    .single();

  if (prodErr || !product) return NextResponse.json({ error: "Product not found" }, { status: 404 });

  // Use a synthetic campaign for tracking — gives us delivery telemetry for free.
  const { data: campaign, error: campErr } = await supabase
    .from("campaigns")
    .insert({
      user_id: user.id,
      name: `Product: ${product.name}`,
      description: `Single-product send for "${product.name}"`,
      status: "running",
      whatsapp_number_id: numberId,
      audience_type: "tags",
      recipients_count: contactIds.length,
      started_at: new Date().toISOString(),
    })
    .select()
    .single();

  if (campErr) return NextResponse.json({ error: campErr.message }, { status: 500 });

  // Resolve contact phones
  const { data: contacts } = await supabase
    .from("contacts")
    .select("id, phone, name")
    .eq("user_id", user.id)
    .in("id", contactIds);

  const messageBody = buildProductMessage(product);

  const messageRows = (contacts || []).map((c) => ({
    campaign_id: campaign.id,
    contact_id: c.id,
    phone: c.phone,
    status: "pending",
  }));

  if (messageRows.length > 0) {
    await supabase.from("campaign_messages").insert(messageRows);
  }

  return NextResponse.json({
    campaignId: campaign.id,
    queued: messageRows.length,
    body: messageBody,
  });
}
