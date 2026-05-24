import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { applyRules, SegmentRules } from "@/lib/segments";

// POST /api/segments/preview — count + sample contacts for a draft rule set.
// Body: { rules: SegmentRules }
export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { rules } = (await req.json()) as { rules: SegmentRules };
  if (!rules || !Array.isArray(rules.conditions)) {
    return NextResponse.json({ error: "rules required" }, { status: 400 });
  }

  const supabase = createClient();

  // Count
  let countQ = supabase.from("contacts").select("id", { count: "exact", head: true }).eq("user_id", user.id);
  countQ = applyRules(countQ, rules);
  const { count } = await countQ;

  // Sample first 8
  let sampleQ = supabase.from("contacts").select("id, name, phone, tags, crm_stage").eq("user_id", user.id);
  sampleQ = applyRules(sampleQ, rules);
  const { data: sample } = await sampleQ.limit(8);

  return NextResponse.json({ count: count || 0, sample: sample || [] });
}
