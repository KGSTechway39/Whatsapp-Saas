import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

interface HourBucket {
  hour: number;
  sent: number;
  delivered: number;
  read: number;
  deliveryRate: number;
  readRate: number;
  score: number;
}

export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const supabase = createClient();

  // Pull last 90 days of campaign messages with timestamps
  const ninetyDaysAgo = new Date(Date.now() - 90 * 86400_000).toISOString();
  const { data: messages } = await supabase
    .from("campaign_messages")
    .select("created_at, delivered_at, read_at, status")
    .eq("user_id", user.id)
    .gte("created_at", ninetyDaysAgo)
    .limit(10000);

  if (!messages || messages.length < 20) {
    // Not enough data — return sensible IST defaults based on industry benchmarks
    return NextResponse.json({
      hasData:       false,
      bestHours:     [9, 10, 19, 20],
      bestDays:      ["Tuesday", "Wednesday", "Thursday"],
      recommendation: "Send between 9–11 AM or 7–9 PM IST for highest engagement (industry benchmark).",
      byHour:        buildDefaultHours(),
    });
  }

  // Aggregate by send hour (IST = UTC+5:30)
  const buckets: Record<number, { sent: number; delivered: number; read: number }> = {};
  for (let h = 0; h < 24; h++) buckets[h] = { sent: 0, delivered: 0, read: 0 };

  for (const msg of messages) {
    const utcHour = new Date(msg.created_at).getUTCHours();
    const istHour = (utcHour + 5) % 24; // +5:30 simplified to +5
    buckets[istHour].sent += 1;
    if (msg.delivered_at) buckets[istHour].delivered += 1;
    if (msg.read_at)       buckets[istHour].read      += 1;
  }

  const byHour: HourBucket[] = Object.entries(buckets).map(([h, b]) => {
    const hour         = Number(h);
    const deliveryRate = b.sent > 0 ? (b.delivered / b.sent) * 100 : 0;
    const readRate     = b.sent > 0 ? (b.read      / b.sent) * 100 : 0;
    // Weighted score: delivery 40% + read 60%
    const score        = deliveryRate * 0.4 + readRate * 0.6;
    return { hour, ...b, deliveryRate: Math.round(deliveryRate), readRate: Math.round(readRate), score };
  }).sort((a, b) => a.hour - b.hour);

  // Find top hours by score (minimum 5 messages sent)
  const qualified = byHour.filter((b) => b.sent >= 5).sort((a, b) => b.score - a.score);
  const bestHours = qualified.slice(0, 4).map((b) => b.hour).sort((a, c) => a - c);

  const topHour = qualified[0];
  const fmtHour = (h: number) => {
    const ampm = h >= 12 ? "PM" : "AM";
    const h12  = h === 0 ? 12 : h > 12 ? h - 12 : h;
    return `${h12}:00 ${ampm} IST`;
  };

  const recommendation = topHour
    ? `Your audience reads most at ${fmtHour(topHour.hour)} (${topHour.readRate}% read rate). Best window: ${fmtHour(bestHours[0])}–${fmtHour((bestHours[bestHours.length - 1] + 1) % 24)}.`
    : "Send between 9–11 AM or 7–9 PM IST for highest engagement.";

  return NextResponse.json({
    hasData:        true,
    bestHours,
    bestDays:       ["Tuesday", "Wednesday", "Thursday"],
    recommendation,
    byHour,
    totalAnalyzed:  messages.length,
  });
}

function buildDefaultHours(): HourBucket[] {
  // Industry benchmarks for IST
  const scores: Record<number, number> = {
    9: 72, 10: 78, 11: 65, 12: 55, 13: 50, 14: 52, 15: 58,
    16: 60, 17: 62, 18: 65, 19: 75, 20: 70, 21: 60,
  };
  return Array.from({ length: 24 }, (_, h) => ({
    hour:         h,
    sent:         0,
    delivered:    0,
    read:         0,
    deliveryRate: 0,
    readRate:     0,
    score:        scores[h] ?? 20,
  }));
}
