import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getSessionUser } from "@/lib/auth";

// GET /api/crm/contacts?stage=&search=&page=&limit=
export async function GET(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const stage = searchParams.get("stage");
  const search = searchParams.get("search") || "";
  const page = Math.max(1, parseInt(searchParams.get("page") || "1"));
  const limit = Math.min(200, parseInt(searchParams.get("limit") || "100"));
  const offset = (page - 1) * limit;

  const supabase = createClient();

  let query = supabase
    .from("contacts")
    .select("id,name,phone,email,company,tags,status,last_contacted,crm_stage,crm_score,deal_value,crm_source,crm_notes,assigned_to", { count: "exact" })
    .eq("user_id", user.id)
    .order("crm_score", { ascending: false })
    .range(offset, offset + limit - 1);

  if (stage && stage !== "all") query = query.eq("crm_stage", stage);
  if (search) query = query.or(`name.ilike.%${search}%,phone.ilike.%${search}%,email.ilike.%${search}%`);

  const { data, error, count } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const contacts = (data || []).map((c) => ({
    id: c.id,
    name: c.name,
    phone: c.phone,
    email: c.email,
    company: c.company,
    tags: c.tags || [],
    status: c.status,
    lastContact: c.last_contacted,
    stage: c.crm_stage || "new_lead",
    score: c.crm_score ?? 50,
    value: c.deal_value ? Number(c.deal_value) : null,
    source: c.crm_source || "manual",
    notes: c.crm_notes,
    assignedTo: c.assigned_to,
  }));

  return NextResponse.json({ contacts, total: count ?? 0, page, limit });
}
