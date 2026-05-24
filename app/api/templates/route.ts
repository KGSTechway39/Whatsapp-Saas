import { createClient } from "@/lib/supabase/server";
import { getSessionUser } from "@/lib/auth";
import { NextRequest, NextResponse } from "next/server";

export async function GET() {
  const supabase = createClient();
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data, error } = await supabase
    .from("templates")
    .select("*")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const templates = data.map((t) => ({
    id: t.id,
    name: t.name,
    displayName: t.display_name,
    category: t.category,
    language: t.language,
    status: t.status,
    body: t.body,
    variables: t.variables || [],
    createdAt: t.created_at,
  }));

  return NextResponse.json({ templates });
}

export async function POST(request: NextRequest) {
  const supabase = createClient();
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const { name, displayName, category, language, body: templateBody, variables, metaTemplateId } = body;

  if (!name || !displayName || !category || !templateBody) {
    return NextResponse.json({ error: "Required fields missing" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("templates")
    .insert({
      user_id: user.id,
      name,
      display_name: displayName,
      category,
      language: language || "en_IN",
      body: templateBody,
      variables: variables || [],
      meta_template_id: metaTemplateId || null,
      status: "PENDING",
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({
    id: data.id,
    name: data.name,
    displayName: data.display_name,
    category: data.category,
    status: data.status,
    body: data.body,
    variables: data.variables,
    createdAt: data.created_at,
  }, { status: 201 });
}
