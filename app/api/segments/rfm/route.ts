import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { computeRFM } from "@/lib/segments";

// GET /api/segments/rfm — RFM scoring for every contact + segment buckets
export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const supabase = createClient();
  const rfm = await computeRFM(supabase, user.id);

  // Bucket distribution
  const buckets: Record<string, number> = {};
  for (const r of rfm) buckets[r.segment] = (buckets[r.segment] || 0) + 1;

  // 5x5 RFM heatmap (R × F)
  const heatmap: number[][] = Array.from({ length: 5 }, () => Array(5).fill(0));
  for (const r of rfm) heatmap[5 - r.r_score][r.f_score - 1] += 1;

  return NextResponse.json({
    total: rfm.length,
    buckets,
    heatmap,
    contacts: rfm.slice(0, 200),     // cap response size
  });
}
