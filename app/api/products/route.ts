import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

// GET /api/products?search=&status=&limit=&page=
export async function GET(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const sp = req.nextUrl.searchParams;
  const search = sp.get("search")?.trim();
  const status = sp.get("status");
  const page   = Math.max(1, Number(sp.get("page")) || 1);
  const limit  = Math.min(100, Math.max(1, Number(sp.get("limit")) || 24));
  const from   = (page - 1) * limit;
  const to     = from + limit - 1;

  const supabase = createClient();
  let query = supabase
    .from("products")
    .select("*", { count: "exact" })
    .eq("user_id", user.id);

  if (search) query = query.or(`name.ilike.%${search}%,sku.ilike.%${search}%,category.ilike.%${search}%`);
  if (status) query = query.eq("status", status);

  const { data, count, error } = await query.order("updated_at", { ascending: false }).range(from, to);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ products: data, total: count || 0, page, limit });
}

// POST /api/products — manual product creation
export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  if (!body.name?.trim() || body.price === undefined) {
    return NextResponse.json({ error: "name and price are required" }, { status: 400 });
  }

  const supabase = createClient();
  const { data, error } = await supabase
    .from("products")
    .insert({
      user_id: user.id,
      name: body.name.trim(),
      description: body.description?.trim() || null,
      price: Number(body.price),
      compare_at_price: body.compareAtPrice ? Number(body.compareAtPrice) : null,
      currency: body.currency || "INR",
      image_url: body.imageUrl || null,
      product_url: body.productUrl || null,
      category: body.category || null,
      tags: body.tags || [],
      sku: body.sku || null,
      in_stock: body.inStock ?? true,
      inventory_count: body.inventoryCount ?? null,
      status: body.inStock === false ? "out_of_stock" : "active",
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ product: data }, { status: 201 });
}
