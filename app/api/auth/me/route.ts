import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export async function GET() {
  const session = await getSessionUser();
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const supabase = createClient();
  const { data } = await supabase
    .from("users")
    .select("id, email, full_name, company_name, phone, timezone, avatar_url")
    .eq("id", session.id)
    .single();

  if (!data) return NextResponse.json({ error: "User not found" }, { status: 404 });

  return NextResponse.json({
    id: data.id,
    email: data.email,
    name: data.full_name,
    company: data.company_name,
    phone: data.phone,
    timezone: data.timezone,
    avatarUrl: data.avatar_url,
  });
}
