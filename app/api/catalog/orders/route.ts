/**
 * Catalog orders — carts customers submitted from the tenant's catalogue.
 *
 *   GET ?status=open|all|<status>&page= → { orders, total, counts }
 *   PATCH { id, status?, notes? }       → update one order
 *
 * These are NOT paid orders. Meta's cart takes no payment, so every row here
 * needs a human: send a payment link, confirm stock, arrange delivery. The
 * status flow exists for exactly that, and there is deliberately no
 * "mark as paid" — SendAnjal never observes the payment.
 *
 * Tenant-scoped: session user, every query carries user_id.
 */
import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const STATUSES = ["received", "processing", "completed", "cancelled"] as const;
type OrderStatus = (typeof STATUSES)[number];
/** Still needs a human. */
const OPEN: OrderStatus[] = ["received", "processing"];

const SELECT =
  "id, customer_phone, contact_id, wa_order_id, catalog_id, order_items, total_paise, currency, status, notes, received_at, updated_at";

export async function GET(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const sp = request.nextUrl.searchParams;
  const status = sp.get("status") ?? "open";
  const page = Math.max(1, Number(sp.get("page")) || 1);
  const limit = Math.min(Number(sp.get("limit")) || 25, 100);
  const from = (page - 1) * limit;

  const supabase = createServiceClient();

  let q = supabase.from("catalog_orders").select(SELECT, { count: "exact" }).eq("user_id", user.id);
  if (status === "open") q = q.in("status", OPEN);
  else if (status !== "all") q = q.eq("status", status);

  const { data, error, count } = await q
    .order("received_at", { ascending: false })
    .range(from, from + limit - 1);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Status tallies for the tabs — one extra narrow pull rather than four counts,
  // because this Supabase tier serialises requests and trips are the cost.
  const { data: all } = await supabase
    .from("catalog_orders")
    .select("status")
    .eq("user_id", user.id)
    .limit(5000);

  const counts: Record<string, number> = { received: 0, processing: 0, completed: 0, cancelled: 0 };
  for (const r of (all ?? []) as { status: string }[]) {
    counts[r.status] = (counts[r.status] ?? 0) + 1;
  }

  return NextResponse.json({
    orders: data ?? [],
    total: count ?? 0,
    page,
    pages: Math.max(1, Math.ceil((count ?? 0) / limit)),
    counts,
    openCount: counts.received + counts.processing,
  });
}

export async function PATCH(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const id = String(body.id ?? "").trim();
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (body.status !== undefined) {
    if (!STATUSES.includes(body.status)) {
      return NextResponse.json({ error: `status must be one of ${STATUSES.join(", ")}` }, { status: 400 });
    }
    patch.status = body.status;
  }
  if (body.notes !== undefined) patch.notes = String(body.notes);

  if (Object.keys(patch).length === 1) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("catalog_orders")
    .update(patch)
    .eq("user_id", user.id)   // tenant scoping — the id alone is not trusted
    .eq("id", id)
    .select(SELECT)
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "We couldn't find that order." }, { status: 404 });

  return NextResponse.json({ order: data });
}
