import { createClient } from "@/lib/supabase/server";
import { getSessionUser } from "@/lib/auth";
import { NextRequest, NextResponse } from "next/server";

export async function GET() {
  const supabase = createClient();
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: teamData, error } = await supabase
    .from("team_members")
    .select("*")
    .eq("owner_id", user.id)
    .order("created_at", { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const owner = {
    id: user.id,
    name: user.name || user.email || "Owner",
    email: user.email,
    role: "owner",
    status: "active",
    joinedDate: new Date().toISOString(),
    avatarUrl: null,
  };

  const members = [owner, ...(teamData || []).map((m) => ({
    id: m.id,
    name: m.name,
    email: m.email,
    role: m.role,
    status: m.status,
    joinedDate: m.joined_date,
    avatarUrl: m.avatar_url || null,
  }))];

  return NextResponse.json({ members });
}

export async function POST(request: NextRequest) {
  const supabase = createClient();
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { name, email, role } = await request.json();

  if (!email || !role) {
    return NextResponse.json({ error: "Email and role required" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("team_members")
    .insert({
      owner_id: user.id,
      name: name || email.split("@")[0],
      email,
      role,
      status: "invited",
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({
    id: data.id,
    name: data.name,
    email: data.email,
    role: data.role,
    status: data.status,
    joinedDate: data.joined_date,
  }, { status: 201 });
}
