import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getSessionUser } from "@/lib/auth";
import { getRazorpay, PLANS, type PlanId } from "@/lib/razorpay";

// POST /api/billing/create-subscription
// Body: { planId: "starter_monthly" | "starter_yearly" | "pro_monthly" | "pro_yearly" }
// Returns: { subscriptionId, paymentUrl }
export async function POST(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { planId } = await request.json() as { planId: PlanId };
  const plan = PLANS[planId];

  if (!plan || plan.tier === "free") {
    return NextResponse.json({ error: "Invalid plan" }, { status: 400 });
  }

  if (!plan.razorpayPlanId) {
    return NextResponse.json(
      { error: `Razorpay plan ID for ${planId} not configured. Set RAZORPAY_PLAN_${planId.toUpperCase()} in environment.` },
      { status: 503 }
    );
  }

  const supabase = createClient();

  // Fetch user email + name for Razorpay customer
  const { data: userData } = await supabase
    .from("users")
    .select("email, full_name, phone")
    .eq("id", user.id)
    .single();

  if (!userData) return NextResponse.json({ error: "User not found" }, { status: 404 });

  // Check if an active subscription already exists
  const { data: existing } = await supabase
    .from("subscriptions")
    .select("id, plan_id, status, razorpay_subscription_id")
    .eq("user_id", user.id)
    .single();

  if (existing?.status === "active" && existing.plan_id !== "free") {
    return NextResponse.json(
      { error: "You already have an active subscription. Cancel it first to switch plans." },
      { status: 409 }
    );
  }

  let razorpay;
  try {
    razorpay = getRazorpay();
  } catch {
    return NextResponse.json({ error: "Payment gateway not configured" }, { status: 503 });
  }

  // Create Razorpay subscription
  const totalCount = plan.cycle === "yearly" ? 1 : 12; // 1 charge for yearly, 12 for monthly

  let subscription;
  try {
    subscription = await razorpay.subscriptions.create({
      plan_id: plan.razorpayPlanId,
      customer_notify: 1,
      quantity: 1,
      total_count: totalCount,
      notes: {
        user_id: user.id,
        plan_id: planId,
        user_email: userData.email,
      },
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Failed to create subscription";
    return NextResponse.json({ error: msg }, { status: 502 });
  }

  // Upsert subscription record in DB (pending until webhook confirms activation)
  const subData = {
    user_id: user.id,
    plan_id: planId,
    billing_cycle: plan.cycle,
    status: "pending",
    razorpay_subscription_id: subscription.id,
    updated_at: new Date().toISOString(),
  };

  if (existing) {
    await supabase.from("subscriptions").update(subData).eq("id", existing.id);
  } else {
    await supabase.from("subscriptions").insert({ ...subData, created_at: new Date().toISOString() });
  }

  return NextResponse.json({
    subscriptionId: subscription.id,
    paymentUrl: (subscription as { short_url?: string }).short_url || null,
    planName: plan.name,
    amount: plan.priceINR,
    cycle: plan.cycle,
  }, { status: 201 });
}

// GET /api/billing/create-subscription → return current subscription
export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const supabase = createClient();
  const { data } = await supabase
    .from("subscriptions")
    .select("*")
    .eq("user_id", user.id)
    .single();

  if (!data) {
    return NextResponse.json({ subscription: { planId: "free", status: "active", tier: "free" } });
  }

  const plan = PLANS[data.plan_id as PlanId] || PLANS.free;

  return NextResponse.json({
    subscription: {
      id: data.id,
      planId: data.plan_id,
      tier: plan.tier,
      status: data.status,
      billingCycle: data.billing_cycle,
      currentPeriodEnd: data.current_period_end,
      cancelAtPeriodEnd: data.cancel_at_period_end,
      razorpaySubscriptionId: data.razorpay_subscription_id,
    },
  });
}

// DELETE /api/billing/create-subscription → cancel subscription at period end
export async function DELETE() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const supabase = createClient();
  const { data: sub } = await supabase
    .from("subscriptions")
    .select("id, razorpay_subscription_id, status")
    .eq("user_id", user.id)
    .single();

  if (!sub || sub.status !== "active") {
    return NextResponse.json({ error: "No active subscription to cancel" }, { status: 404 });
  }

  // Cancel in Razorpay (cancel_at_cycle_end = 1 means end of billing period)
  try {
    const razorpay = getRazorpay();
    await razorpay.subscriptions.cancel(sub.razorpay_subscription_id, true);
  } catch {
    // If Razorpay fails, still mark locally
  }

  await supabase
    .from("subscriptions")
    .update({ cancel_at_period_end: true, updated_at: new Date().toISOString() })
    .eq("id", sub.id);

  return NextResponse.json({ message: "Subscription will be cancelled at end of billing period" });
}
