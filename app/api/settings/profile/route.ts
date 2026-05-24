import { createClient } from "@/lib/supabase/server";
import { getSessionUser } from "@/lib/auth";
import { NextRequest, NextResponse } from "next/server";

export async function GET() {
  const supabase = createClient();
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data, error } = await supabase
    .from("users")
    .select("*")
    .eq("id", user.id)
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({
    id: user.id,
    email: user.email,
    name: data.full_name,
    company: data.company_name,
    phone: data.phone,
    timezone: data.timezone,
    avatarUrl: data.avatar_url,
  });
}

export async function PATCH(request: NextRequest) {
  const supabase = createClient();
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const { name, company, phone, timezone } = body;

  const { error } = await supabase
    .from("users")
    .update({
      ...(name !== undefined && { full_name: name }),
      ...(company !== undefined && { company_name: company }),
      ...(phone !== undefined && { phone }),
      ...(timezone !== undefined && { timezone }),
      updated_at: new Date().toISOString(),
    })
    .eq("id", user.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ message: "Profile updated" });
}
