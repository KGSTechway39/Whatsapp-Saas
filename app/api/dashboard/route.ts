import { createClient } from "@/lib/supabase/server";
import { getSessionUser } from "@/lib/auth";
import { NextResponse } from "next/server";

export async function GET() {
  const supabase = createClient();
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  const fourteenDaysAgo = new Date();
  fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14);

  const [currentWeek, prevWeek, walletResult, campaignsResult, numbersResult, profileResult, chartResult] =
    await Promise.allSettled([
      supabase
        .from("daily_analytics")
        .select("total_sent, total_delivered, total_failed")
        .eq("user_id", user.id)
        .gte("date", sevenDaysAgo.toISOString().split("T")[0]),

      supabase
        .from("daily_analytics")
        .select("total_sent, total_delivered, total_failed")
        .eq("user_id", user.id)
        .gte("date", fourteenDaysAgo.toISOString().split("T")[0])
        .lt("date", sevenDaysAgo.toISOString().split("T")[0]),

      supabase.from("wallet").select("balance").eq("user_id", user.id).single(),

      supabase
        .from("campaigns")
        .select("id, name, status, template_name, recipients_count, delivered_count, failed_count, created_at")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(5),

      supabase
        .from("whatsapp_numbers")
        .select("id, phone_number, display_name, status, messages_sent")
        .eq("user_id", user.id),

      supabase.from("users").select("full_name, company_name").eq("id", user.id).single(),

      supabase
        .from("daily_analytics")
        .select("date, total_sent, total_delivered, total_failed")
        .eq("user_id", user.id)
        .gte("date", sevenDaysAgo.toISOString().split("T")[0])
        .order("date", { ascending: true }),
    ]);

  const currRows =
    currentWeek.status === "fulfilled" ? currentWeek.value.data || [] : [];
  const prevRows =
    prevWeek.status === "fulfilled" ? prevWeek.value.data || [] : [];

  const curr = currRows.reduce(
    (a, d) => ({ sent: a.sent + d.total_sent, delivered: a.delivered + d.total_delivered, failed: a.failed + d.total_failed }),
    { sent: 0, delivered: 0, failed: 0 }
  );
  const prev = prevRows.reduce(
    (a, d) => ({ sent: a.sent + d.total_sent, delivered: a.delivered + d.total_delivered, failed: a.failed + d.total_failed }),
    { sent: 0, delivered: 0, failed: 0 }
  );

  const trend = (c: number, p: number) =>
    p === 0 ? 0 : Math.round(((c - p) / p) * 1000) / 10;

  const walletData =
    walletResult.status === "fulfilled" ? walletResult.value.data : null;
  const campaignsData =
    campaignsResult.status === "fulfilled" ? campaignsResult.value.data || [] : [];
  const numbersData =
    numbersResult.status === "fulfilled" ? numbersResult.value.data || [] : [];
  const profileData =
    profileResult.status === "fulfilled" ? profileResult.value.data : null;
  const chartData =
    chartResult.status === "fulfilled" ? chartResult.value.data || [] : [];

  return NextResponse.json({
    profile: {
      name: profileData?.full_name || user.name || user.email,
      company: profileData?.company_name || user.company || "",
    },
    stats: {
      messagesSent: curr.sent,
      messagesSentTrend: trend(curr.sent, prev.sent),
      deliveryRate: curr.sent > 0 ? Math.round((curr.delivered / curr.sent) * 1000) / 10 : 0,
      deliveryRateTrend: 0,
      failedMessages: curr.failed,
      failedMessagesTrend: trend(curr.failed, prev.failed),
      walletBalance: walletData?.balance ?? 0,
    },
    chartData: chartData.map((d) => ({
      date: new Date(d.date).toLocaleDateString("en-IN", { month: "short", day: "numeric" }),
      sent: d.total_sent,
      delivered: d.total_delivered,
      failed: d.total_failed,
    })),
    recentCampaigns: campaignsData.map((c) => ({
      id: c.id,
      name: c.name,
      status: c.status,
      templateName: c.template_name || "",
      recipients: c.recipients_count ?? 0,
      delivered: c.delivered_count ?? 0,
      failed: c.failed_count ?? 0,
      createdAt: c.created_at,
    })),
    numbers: numbersData.map((n) => ({
      id: n.id,
      phoneNumber: n.phone_number,
      displayName: n.display_name,
      status: n.status,
      messagesSent: n.messages_sent ?? 0,
    })),
  });
}
