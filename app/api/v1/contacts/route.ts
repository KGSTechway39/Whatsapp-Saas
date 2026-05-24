import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { withApiAuth, ApiAuthError } from "@/lib/api-keys";
import { dispatchEvent } from "@/lib/webhooks-out";

// GET /api/v1/contacts?limit=20&starting_after=<cursor>&search=
export async function GET(req: NextRequest) {
  try {
    const ctx = await withApiAuth(req, "contacts:read");
    const sp = req.nextUrl.searchParams;
    const limit = Math.min(100, Math.max(1, Number(sp.get("limit")) || 20));
    const search = sp.get("search")?.trim();
    const startingAfter = sp.get("starting_after");

    const supabase = createServiceClient();
    let q = supabase
      .from("contacts")
      .select("id, name, phone, email, tags, crm_stage, deal_value, created_at")
      .eq("user_id", ctx.userId)
      .order("created_at", { ascending: false })
      .limit(limit + 1); // fetch one extra to know has_more

    if (search) q = q.or(`name.ilike.%${search}%,phone.ilike.%${search}%,email.ilike.%${search}%`);
    if (startingAfter) {
      const { data: cursor } = await supabase
        .from("contacts")
        .select("created_at")
        .eq("id", startingAfter)
        .single();
      if (cursor) q = q.lt("created_at", cursor.created_at);
    }

    const { data, error } = await q;
    if (error) return NextResponse.json({ error: error.message, code: "DB_ERROR" }, { status: 500 });

    const hasMore = (data?.length ?? 0) > limit;
    const page = (data || []).slice(0, limit);

    return NextResponse.json({
      data: page.map((c) => ({
        id: c.id,
        object: "contact",
        name: c.name,
        phone: c.phone,
        email: c.email,
        tags: c.tags || [],
        crm_stage: c.crm_stage,
        deal_value: Number(c.deal_value || 0),
        created_at: c.created_at,
      })),
      has_more: hasMore,
      next_cursor: hasMore ? page[page.length - 1]?.id : null,
    });
  } catch (err) {
    if (err instanceof ApiAuthError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
    }
    return NextResponse.json({ error: err instanceof Error ? err.message : "Internal error", code: "INTERNAL" }, { status: 500 });
  }
}

// POST /api/v1/contacts
// Body: { name, phone, email?, tags?, company?, crm_stage? }
export async function POST(req: NextRequest) {
  try {
    const ctx = await withApiAuth(req, "contacts:write");
    const body = await req.json();
    if (!body.phone || !body.name) {
      return NextResponse.json({ error: "name and phone are required", code: "VALIDATION_ERROR" }, { status: 400 });
    }
    const phone = String(body.phone).replace(/[^\d+]/g, "");
    if (phone.length < 7) {
      return NextResponse.json({ error: "phone must be E.164 format", code: "VALIDATION_ERROR" }, { status: 400 });
    }

    const supabase = createServiceClient();
    const { data, error } = await supabase
      .from("contacts")
      .insert({
        user_id: ctx.userId,
        name: body.name,
        phone,
        email: body.email || null,
        tags: body.tags || [],
        company: body.company || null,
        crm_stage: body.crm_stage || "new_lead",
        crm_source: "manual",
      })
      .select("id, name, phone, email, tags, crm_stage, deal_value, created_at")
      .single();

    if (error) {
      if ((error as { code?: string }).code === "23505") {
        return NextResponse.json({ error: "Contact with this phone already exists", code: "DUPLICATE" }, { status: 409 });
      }
      return NextResponse.json({ error: error.message, code: "DB_ERROR" }, { status: 500 });
    }

    dispatchEvent(supabase, ctx.userId, "contact.created", {
      id: data.id, name: data.name, phone: data.phone, email: data.email,
      tags: data.tags || [], crm_stage: data.crm_stage, created_at: data.created_at,
    }).catch(() => {});

    return NextResponse.json({
      id: data.id,
      object: "contact",
      name: data.name,
      phone: data.phone,
      email: data.email,
      tags: data.tags || [],
      crm_stage: data.crm_stage,
      deal_value: Number(data.deal_value || 0),
      created_at: data.created_at,
    }, { status: 201 });
  } catch (err) {
    if (err instanceof ApiAuthError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
    }
    return NextResponse.json({ error: err instanceof Error ? err.message : "Internal error", code: "INTERNAL" }, { status: 500 });
  }
}
