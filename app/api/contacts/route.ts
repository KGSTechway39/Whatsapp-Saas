import { createClient } from "@/lib/supabase/server";
import { getSessionUser } from "@/lib/auth";
import { NextRequest, NextResponse } from "next/server";
import { sanitizeSearch } from "@/lib/validate";
import { consentPolicyFor } from "@/lib/compliance/consent";

export async function GET(request: NextRequest) {
  const supabase = createClient();
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const rawSearch = searchParams.get("search") || "";
  const search = sanitizeSearch(rawSearch);
  const group = (searchParams.get("group") || "").slice(0, 50);
  const page  = Math.max(1, Math.min(10000, parseInt(searchParams.get("page")  || "1")));
  const limit = Math.max(1, Math.min(200,   parseInt(searchParams.get("limit") || "50")));
  const offset = (page - 1) * limit;

  let query = supabase
    .from("contacts")
    .select("*", { count: "exact" })
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (search) {
    query = query.or(`name.ilike.%${search}%,phone.ilike.%${search}%`);
  }
  if (group && group !== "all") {
    query = query.eq("contact_group", group);
  }

  const { data, error, count } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const contacts = data.map((c) => ({
    id: c.id,
    name: c.name,
    phone: c.phone,
    email: c.email,
    group: c.contact_group,
    tags: c.tags || [],
    addedDate: c.added_date,
    status: c.status,
    // Consent travels with the contact so the list can show it without an
    // extra round-trip per row.
    consentGiven: c.sensitive_data_consent === true,
    consentAt: c.consent_timestamp ?? null,
    consentSource: c.consent_source ?? null,
  }));

  // Whether consent is REQUIRED is a property of the tenant's industry, not of
  // any one contact — so it ships once, alongside the page. When false the UI
  // hides the whole consent column rather than showing an irrelevant control.
  const policy = await consentPolicyFor(user.id);

  return NextResponse.json({
    contacts,
    total: count || 0,
    consentRequired: policy.required,
    consentRequiredBecause: policy.required ? policy.verticalName : null,
  });
}

export async function POST(request: NextRequest) {
  const supabase = createClient();
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const { name, phone, email, group, tags } = body;

  if (!name || !phone) {
    return NextResponse.json({ error: "Name and phone are required" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("contacts")
    .insert({
      user_id: user.id,
      name,
      phone,
      email: email || null,
      contact_group: group || null,
      tags: tags || [],
      status: "active",
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({
    id: data.id,
    name: data.name,
    phone: data.phone,
    email: data.email,
    group: data.contact_group,
    tags: data.tags,
    addedDate: data.added_date,
    status: data.status,
  }, { status: 201 });
}
