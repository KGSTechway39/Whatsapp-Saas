import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getSessionUser } from "@/lib/auth";
import { PLANS, type PlanId } from "@/lib/razorpay";

// GET /api/billing/usage
// Returns current month usage vs plan limits for the logged-in user
export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const supabase = createClient();

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split("T")[0];
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().split("T")[0];

  const [subResult, analyticsResult, numbersResult, campaignsResult] = await Promise.allSettled([
    supabase.from("subscriptions").select("plan_id, status, current_period_end, cancel_at_period_end").eq("user_id", user.id).single(),
    supabase
      .from("daily_analytics")
      .select("total_sent")
      .eq("user_id", user.id)
      .gte("date", monthStart)
      .lte("date", monthEnd),
    supabase
      .from("whatsapp_numbers")
      .select("*", { count: "exact", head: true })
      .eq("user_id", user.id)
      .eq("status", "active"),
    supabase
      .from("campaigns")
      .select("*", { count: "exact", head: true })
      .eq("user_id", user.id)
      .gte("created_at", `${monthStart}T00:00:00Z`),
  ]);

  // Resolve subscription / plan
  const subData = subResult.status === "fulfilled" ? subResult.value.data : null;
  const planId = (subData?.plan_id || "free") as PlanId;
  const plan = PLANS[planId] || PLANS.free;
  const limits = plan.limits;

  // Resolve current-month messages sent
  const analyticsRows = analyticsResult.status === "fulfilled" ? analyticsResult.value.data || [] : [];
  const messagesSent = analyticsRows.reduce((sum, row) => sum + (row.total_sent || 0), 0);

  // Numbers connected
  const numbersConnected = numbersResult.status === "fulfilled" ? (numbersResult.value.count ?? 0) : 0;

  // Campaigns this month
  const campaignsThisMonth = campaignsResult.status === "fulfilled" ? (campaignsResult.value.count ?? 0) : 0;

  return NextResponse.json({
    plan: {
      id: planId,
      name: plan.name,
      tier: plan.tier,
      cycle: plan.cycle,
      status: subData?.status || "active",
      currentPeriodEnd: subData?.current_period_end || null,
      cancelAtPeriodEnd: subData?.cancel_at_period_end || false,
    },
    usage: {
      messages: {
        used: messagesSent,
        limit: limits.messagesPerMonth,
        percent: limits.messagesPerMonth > 0 ? Math.min(100, Math.round((messagesSent / limits.messagesPerMonth) * 100)) : 0,
      },
      numbers: {
        used: numbersConnected,
        limit: limits.numbers,
        percent: Math.min(100, Math.round((numbersConnected / limits.numbers) * 100)),
      },
      campaigns: {
        used: campaignsThisMonth,
        limit: limits.campaignsPerMonth,
        percent: limits.campaignsPerMonth > 0
          ? Math.min(100, Math.round((campaignsThisMonth / limits.campaignsPerMonth) * 100))
          : 0,
      },
    },
    limits,
    period: { start: monthStart, end: monthEnd },
  });
}
