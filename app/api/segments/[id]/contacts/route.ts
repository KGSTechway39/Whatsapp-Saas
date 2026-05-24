import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { applyRules, SYSTEM_SEGMENTS, SegmentRules } from "@/lib/segments";

// GET /api/segments/:id/contacts — preview contacts that match a segment.
//   ?limit=50  default 50, max 200
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const limit = Math.min(200, Math.max(1, Number(req.nextUrl.searchParams.get("limit")) || 50));
  const supabase = createClient();

  let rules: SegmentRules | null = null;

  if (params.id.startsWith("system:")) {
    const key = params.id.slice("system:".length);
    const sys = SYSTEM_SEGMENTS.find((s) => s.key === key);
    if (!sys) return NextResponse.json({ error: "Unknown system segment" }, { status: 404 });
    rules = sys.rules;
  } else {
    const { data } = await supabase
      .from("segments")
      .select("rules")
      .eq("id", params.id)
      .eq("user_id", user.id)
      .single();
    if (!data) return NextResponse.json({ error: "Segment not found" }, { status: 404 });
    rules = data.rules as SegmentRules;
  }

  let query = supabase
    .from("contacts")
    .select("id, name, phone, email, tags, crm_stage, crm_score, deal_value, last_contacted, added_date")
    .eq("user_id", user.id);

  query = applyRules(query, rules);

  const { data: contacts, error } = await query
    .order("last_contacted", { ascending: false, nullsFirst: false })
    .limit(limit);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ contacts: contacts || [] });
}
