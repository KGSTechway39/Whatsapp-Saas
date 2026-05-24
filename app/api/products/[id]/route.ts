import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const updates = await req.json();
  const supabase = createClient();

  const { data, error } = await supabase
    .from("products")
    .update({
      ...(updates.name        !== undefined && { name: updates.name }),
      ...(updates.description !== undefined && { description: updates.description }),
      ...(updates.price       !== undefined && { price: Number(updates.price) }),
      ...(updates.imageUrl    !== undefined && { image_url: updates.imageUrl }),
      ...(updates.productUrl  !== undefined && { product_url: updates.productUrl }),
      ...(updates.category    !== undefined && { category: updates.category }),
      ...(updates.tags        !== undefined && { tags: updates.tags }),
      ...(updates.inStock     !== undefined && { in_stock: updates.inStock, status: updates.inStock ? "active" : "out_of_stock" }),
      ...(updates.status      !== undefined && { status: updates.status }),
      updated_at: new Date().toISOString(),
    })
    .eq("id", params.id)
    .eq("user_id", user.id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ product: data });
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const supabase = createClient();
  const { error } = await supabase
    .from("products")
    .delete()
    .eq("id", params.id)
    .eq("user_id", user.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
