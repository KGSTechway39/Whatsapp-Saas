import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

// POST /api/carts/:id/recover
// Sends a recovery message via the user's first active number using a
// utility/marketing template. Body: { templateId: string, numberId?: string }
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { templateId, numberId } = await req.json();
  if (!templateId) return NextResponse.json({ error: "templateId required" }, { status: 400 });

  const supabase = createClient();

  // Load cart + contact + items
  const { data: cart, error: cartErr } = await supabase
    .from("carts")
    .select(`
      id, total, currency, checkout_url, status,
      contact:contact_id ( id, name, phone ),
      cart_items ( name, quantity, price )
    `)
    .eq("id", params.id)
    .eq("user_id", user.id)
    .single();

  if (cartErr || !cart) return NextResponse.json({ error: "Cart not found" }, { status: 404 });

  // contact may come back as object or array depending on supabase shape
  const contact = Array.isArray(cart.contact) ? cart.contact[0] : cart.contact;
  if (!contact) return NextResponse.json({ error: "Contact missing" }, { status: 400 });

  // Pick a number — explicit or first active
  let phoneNumberId = numberId;
  if (!phoneNumberId) {
    const { data: num } = await supabase
      .from("whatsapp_numbers")
      .select("id")
      .eq("user_id", user.id)
      .eq("status", "active")
      .limit(1)
      .single();
    phoneNumberId = num?.id;
  }
  if (!phoneNumberId) return NextResponse.json({ error: "No active WhatsApp number" }, { status: 400 });

  // Synthetic campaign for tracking
  const { data: campaign, error: campErr } = await supabase
    .from("campaigns")
    .insert({
      user_id: user.id,
      name: `Cart Recovery: ${contact.name || contact.phone}`,
      description: `Abandoned cart recovery for cart ${cart.id.slice(0, 8)}`,
      status: "running",
      template_id: templateId,
      whatsapp_number_id: phoneNumberId,
      audience_type: "tags",
      recipients_count: 1,
      started_at: new Date().toISOString(),
    })
    .select()
    .single();

  if (campErr) return NextResponse.json({ error: campErr.message }, { status: 500 });

  await supabase.from("campaign_messages").insert({
    campaign_id: campaign.id,
    contact_id: contact.id,
    phone: contact.phone,
    status: "pending",
  });

  // Mark recovery attempt
  await supabase
    .from("carts")
    .update({
      recovery_message_sent_at: new Date().toISOString(),
      recovery_attempts: (
        await supabase.from("carts").select("recovery_attempts").eq("id", cart.id).single()
      ).data?.recovery_attempts ?? 0 + 1,
    })
    .eq("id", cart.id);

  return NextResponse.json({ campaignId: campaign.id, sentTo: contact.phone });
}
