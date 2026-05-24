import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

// Auto-segment definitions
const AUTO_SEGMENTS = [
  {
    id:          "active",
    name:        "Active",
    description: "Messaged in last 7 days",
    color:       "emerald",
    icon:        "zap",
  },
  {
    id:          "engaged",
    name:        "Engaged",
    description: "Messaged in last 30 days",
    color:       "blue",
    icon:        "heart",
  },
  {
    id:          "dormant",
    name:        "Dormant",
    description: "No contact in 30–90 days",
    color:       "amber",
    icon:        "clock",
  },
  {
    id:          "lost",
    name:        "At Risk",
    description: "No contact in 90+ days",
    color:       "red",
    icon:        "alert",
  },
  {
    id:          "new",
    name:        "New",
    description: "Added in last 14 days",
    color:       "violet",
    icon:        "user-plus",
  },
  {
    id:          "vip",
    name:        "VIP",
    description: "High deal value (top 10%)",
    color:       "yellow",
    icon:        "star",
  },
];

export async function GET(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const supabase = createClient();
  const now = new Date();

  const cutoffs = {
    "7d":  new Date(now.getTime() - 7  * 86400_000).toISOString(),
    "14d": new Date(now.getTime() - 14 * 86400_000).toISOString(),
    "30d": new Date(now.getTime() - 30 * 86400_000).toISOString(),
    "90d": new Date(now.getTime() - 90 * 86400_000).toISOString(),
  };

  const { data: contacts } = await supabase
    .from("contacts")
    .select("id, name, phone, last_contacted, created_at, deal_value, crm_stage, tags")
    .eq("user_id", user.id);

  if (!contacts) return NextResponse.json({ segments: [], rfmLeaderboard: [] });

  const total = contacts.length;

  // Deal value top 10% threshold for VIP
  const sortedByDeal = [...contacts]
    .filter((c) => (c.deal_value ?? 0) > 0)
    .sort((a, b) => (b.deal_value ?? 0) - (a.deal_value ?? 0));
  const vipThreshold = sortedByDeal[Math.floor(sortedByDeal.length * 0.1)]?.deal_value ?? Infinity;

  const segmentCounts: Record<string, number> = {};
  for (const seg of AUTO_SEGMENTS) segmentCounts[seg.id] = 0;

  // RFM: build score per contact
  const rfm: { id: string; name: string; phone: string; r: number; f: number; m: number; score: number }[] = [];

  for (const c of contacts) {
    const lastContact = c.last_contacted || c.created_at;
    const daysSince   = lastContact ? (now.getTime() - new Date(lastContact).getTime()) / 86400_000 : 9999;
    const isNew       = c.created_at >= cutoffs["14d"];
    const dealVal     = c.deal_value ?? 0;

    if (daysSince <= 7)   segmentCounts.active   += 1;
    if (daysSince <= 30)  segmentCounts.engaged  += 1;
    if (daysSince > 30 && daysSince <= 90) segmentCounts.dormant += 1;
    if (daysSince > 90)   segmentCounts.lost     += 1;
    if (isNew)            segmentCounts.new       += 1;
    if (dealVal >= vipThreshold && dealVal > 0) segmentCounts.vip += 1;

    // RFM scores (1–5)
    const r = daysSince <= 7  ? 5 : daysSince <= 14 ? 4 : daysSince <= 30 ? 3 : daysSince <= 60 ? 2 : 1;
    const f = 3; // placeholder — would need message frequency data
    const m = dealVal > 100000 ? 5 : dealVal > 50000 ? 4 : dealVal > 10000 ? 3 : dealVal > 1000 ? 2 : 1;
    rfm.push({ id: c.id, name: c.name, phone: c.phone, r, f, m, score: r + f + m });
  }

  const segments = AUTO_SEGMENTS.map((seg) => ({
    ...seg,
    count:      segmentCounts[seg.id],
    percentage: total > 0 ? Math.round((segmentCounts[seg.id] / total) * 100) : 0,
  }));

  const rfmLeaderboard = rfm
    .sort((a, b) => b.score - a.score)
    .slice(0, 20)
    .map((c) => ({
      ...c,
      tier: c.score >= 12 ? "Champions" : c.score >= 9 ? "Loyal" : c.score >= 6 ? "Potential" : "At Risk",
    }));

  // Get contacts for a specific segment if ?segment= param
  const segParam = new URL(req.url).searchParams.get("segment");
  if (segParam) {
    let filtered = contacts;
    switch (segParam) {
      case "active":  filtered = contacts.filter((c) => { const d = c.last_contacted || c.created_at; return d && (now.getTime() - new Date(d).getTime()) / 86400_000 <= 7; }); break;
      case "engaged": filtered = contacts.filter((c) => { const d = c.last_contacted || c.created_at; return d && (now.getTime() - new Date(d).getTime()) / 86400_000 <= 30; }); break;
      case "dormant": filtered = contacts.filter((c) => { const d = c.last_contacted || c.created_at; const days = d ? (now.getTime() - new Date(d).getTime()) / 86400_000 : 9999; return days > 30 && days <= 90; }); break;
      case "lost":    filtered = contacts.filter((c) => { const d = c.last_contacted || c.created_at; return !d || (now.getTime() - new Date(d).getTime()) / 86400_000 > 90; }); break;
      case "new":     filtered = contacts.filter((c) => c.created_at >= cutoffs["14d"]); break;
      case "vip":     filtered = contacts.filter((c) => (c.deal_value ?? 0) >= vipThreshold && (c.deal_value ?? 0) > 0); break;
    }
    return NextResponse.json({ segments, rfmLeaderboard, contacts: filtered.slice(0, 500), total });
  }

  return NextResponse.json({ segments, rfmLeaderboard, total });
}
