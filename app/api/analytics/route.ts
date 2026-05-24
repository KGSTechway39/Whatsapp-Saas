import { createClient } from "@/lib/supabase/server";
import { getSessionUser } from "@/lib/auth";
import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  const supabase = createClient();
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const days = parseInt(searchParams.get("days") || "7");

  const fromDate = new Date();
  fromDate.setDate(fromDate.getDate() - days);

  const [analyticsResult, campaignsResult, numbersResult] = await Promise.all([
    supabase
      .from("daily_analytics")
      .select("*")
      .eq("user_id", user.id)
      .gte("date", fromDate.toISOString().split("T")[0])
      .order("date", { ascending: true }),

    supabase
      .from("campaigns")
      .select("id, name, sent_count, delivered_count, failed_count, read_count, cost")
      .eq("user_id", user.id)
      .in("status", ["completed", "running"])
      .order("created_at", { ascending: false })
      .limit(10),

    supabase
      .from("whatsapp_numbers")
      .select("id, phone_number, messages_sent")
      .eq("user_id", user.id),
  ]);

  const chartData = (analyticsResult.data || []).map((d) => ({
    date: new Date(d.date).toLocaleDateString("en-IN", { month: "short", day: "numeric" }),
    sent: d.total_sent,
    delivered: d.total_delivered,
    failed: d.total_failed,
  }));

  const totals = (analyticsResult.data || []).reduce(
    (acc, d) => ({
      sent: acc.sent + d.total_sent,
      delivered: acc.delivered + d.total_delivered,
      failed: acc.failed + d.total_failed,
      replies: acc.replies + d.total_replies,
    }),
    { sent: 0, delivered: 0, failed: 0, replies: 0 }
  );

  return NextResponse.json({
    totalSent: totals.sent,
    totalDelivered: totals.delivered,
    totalFailed: totals.failed,
    totalReplies: totals.replies,
    deliveryRate: totals.sent > 0 ? Math.round((totals.delivered / totals.sent) * 1000) / 10 : 0,
    failedRate: totals.sent > 0 ? Math.round((totals.failed / totals.sent) * 1000) / 10 : 0,
    chartData,
    campaignPerformance: (campaignsResult.data || []).map((c) => ({
      campaignId: c.id,
      name: c.name,
      sent: c.sent_count,
      delivered: c.delivered_count,
      failed: c.failed_count,
      read: c.read_count,
      cost: c.cost,
    })),
    numberBreakdown: (numbersResult.data || []).map((n) => ({
      numberId: n.id,
      phoneNumber: n.phone_number,
      sent: n.messages_sent,
      delivered: 0,
      failed: 0,
    })),
  });
}
