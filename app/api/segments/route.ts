import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { applyRules, SYSTEM_SEGMENTS, SegmentRules } from "@/lib/segments";

// GET /api/segments — list system + custom segments with live counts.
export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const supabase = createClient();

  // System segments — counted live
  const systemRows = await Promise.all(
    SYSTEM_SEGMENTS.map(async (s) => {
      const q = applyRules(
        supabase.from("contacts").select("id", { count: "exact", head: true }).eq("user_id", user.id),
        s.rules,
      );
      const { count } = await q;
      return {
        id: `system:${s.key}`,
        key: s.key,
        name: s.name,
        description: s.description,
        color: s.color,
        icon: s.icon,
        rules: s.rules,
        is_system: true,
        count: count || 0,
      };
    }),
  );

  // Custom segments
  const { data: custom = [] } = await supabase
    .from("segments")
    .select("id, name, description, color, icon, rules, cached_count, cached_at")
    .eq("user_id", user.id)
    .eq("is_system", false)
    .order("created_at", { ascending: false });

  const customRows = await Promise.all(
    (custom || []).map(async (s) => {
      const q = applyRules(
        supabase.from("contacts").select("id", { count: "exact", head: true }).eq("user_id", user.id),
        s.rules as SegmentRules,
      );
      const { count } = await q;
      // Update cached count opportunistically.
      await supabase.from("segments")
        .update({ cached_count: count || 0, cached_at: new Date().toISOString() })
        .eq("id", s.id);
      return { ...s, is_system: false, count: count || 0 };
    }),
  );

  return NextResponse.json({ system: systemRows, custom: customRows });
}

// POST /api/segments — create a custom segment.
export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const { name, description, color, icon, rules } = body as {
    name: string; description?: string; color?: string; icon?: string; rules: SegmentRules;
  };

  if (!name?.trim()) return NextResponse.json({ error: "name is required" }, { status: 400 });
  if (!rules || !Array.isArray(rules.conditions)) {
    return NextResponse.json({ error: "rules must include a conditions array" }, { status: 400 });
  }

  const supabase = createClient();
  const { data, error } = await supabase
    .from("segments")
    .insert({
      user_id: user.id,
      name: name.trim(),
      description: description?.trim() || null,
      color: color || "blue",
      icon: icon || "Users",
      rules,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ segment: data }, { status: 201 });
}
