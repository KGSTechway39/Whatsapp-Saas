import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { verifyWebhookSignature, PLANS, type PlanId } from "@/lib/razorpay";
import { sendEmail, paymentSuccessEmail, paymentFailedEmail } from "@/lib/email";

// Razorpay sends JSON but we must read the raw body for signature verification
export const runtime = "nodejs";

// GET — Razorpay may probe the endpoint; just return 200
export async function GET() {
  return NextResponse.json({ status: "ok" });
}

export async function POST(request: NextRequest) {
  const rawBody = await request.text();
  const signature = request.headers.get("x-razorpay-signature") || "";

  if (!verifyWebhookSignature(rawBody, signature)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  const event = JSON.parse(rawBody) as {
    event: string;
    payload: {
      subscription?: {
        entity: {
          id: string;
          plan_id: string;
          status: string;
          current_start: number;
          current_end: number;
          notes?: Record<string, string>;
        };
      };
      payment?: {
        entity: {
          id: string;
          amount: number;
          status: string;
          description?: string;
          notes?: Record<string, string>;
        };
      };
    };
  };

  const supabase = createServiceClient();

  switch (event.event) {
    case "subscription.activated": {
      const sub = event.payload.subscription!.entity;
      const userId = sub.notes?.user_id;
      const planId = (sub.notes?.plan_id || "free") as PlanId;
      const plan = PLANS[planId];

      if (!userId) break;

      await supabase
        .from("subscriptions")
        .update({
          status: "active",
          plan_id: planId,
          billing_cycle: plan?.cycle || "monthly",
          current_period_start: new Date(sub.current_start * 1000).toISOString(),
          current_period_end: new Date(sub.current_end * 1000).toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("razorpay_subscription_id", sub.id);

      // Record activation transaction
      const { data: wallet } = await supabase.from("wallet").select("balance").eq("user_id", userId).single();
      await supabase.from("transactions").insert({
        user_id: userId,
        type: "debit",
        description: `Subscription activated — ${plan?.name || planId} (${plan?.cycle})`,
        amount: -(plan?.priceINR || 0),
        balance_after: wallet?.balance ?? 0,
        payment_method: "razorpay",
        metadata: { razorpay_subscription_id: sub.id },
      });
      break;
    }

    case "subscription.charged": {
      const sub = event.payload.subscription!.entity;
      const payment = event.payload.payment?.entity;
      const userId = sub.notes?.user_id;
      const planId = (sub.notes?.plan_id || "free") as PlanId;
      const plan = PLANS[planId];

      if (!userId) break;

      // Update period dates
      await supabase
        .from("subscriptions")
        .update({
          status: "active",
          current_period_start: new Date(sub.current_start * 1000).toISOString(),
          current_period_end: new Date(sub.current_end * 1000).toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("razorpay_subscription_id", sub.id);

      // Record payment transaction
      const amountINR = payment ? payment.amount / 100 : (plan?.priceINR || 0);
      const { data: wallet } = await supabase.from("wallet").select("balance").eq("user_id", userId).single();
      await supabase.from("transactions").insert({
        user_id: userId,
        type: "debit",
        description: `Subscription renewal — ${plan?.name || planId}`,
        amount: -amountINR,
        balance_after: wallet?.balance ?? 0,
        payment_method: "razorpay",
        metadata: { razorpay_subscription_id: sub.id, razorpay_payment_id: payment?.id },
      });

      // Send payment success email
      const { data: userData } = await supabase
        .from("users")
        .select("email, full_name")
        .eq("id", userId)
        .single();

      if (userData) {
        const nextBilling = new Date(sub.current_end * 1000).toLocaleDateString("en-IN", {
          day: "numeric", month: "long", year: "numeric",
        });
        await sendEmail({
          to: userData.email,
          subject: `Payment received — ${plan?.name || "WASend"} Plan`,
          html: paymentSuccessEmail(userData.full_name || userData.email, amountINR, plan?.name || planId, nextBilling),
        });
      }
      break;
    }

    case "subscription.cancelled": {
      const sub = event.payload.subscription!.entity;
      await supabase
        .from("subscriptions")
        .update({ status: "cancelled", cancel_at_period_end: false, updated_at: new Date().toISOString() })
        .eq("razorpay_subscription_id", sub.id);
      break;
    }

    case "subscription.halted":
    case "payment.failed": {
      // payment.failed fires for subscription renewal failures
      const sub = event.payload.subscription?.entity;
      const payment = event.payload.payment?.entity;
      const userId = sub?.notes?.user_id || payment?.notes?.user_id;
      const planId = (sub?.notes?.plan_id || "free") as PlanId;
      const plan = PLANS[planId];

      if (sub) {
        await supabase
          .from("subscriptions")
          .update({ status: "past_due", updated_at: new Date().toISOString() })
          .eq("razorpay_subscription_id", sub.id);
      }

      if (userId) {
        const { data: userData } = await supabase
          .from("users")
          .select("email, full_name")
          .eq("id", userId)
          .single();

        if (userData) {
          const retryUrl = `${process.env.NEXT_PUBLIC_SITE_URL}/billing/plans`;
          await sendEmail({
            to: userData.email,
            subject: "Payment failed — Action required",
            html: paymentFailedEmail(userData.full_name || userData.email, plan?.name || planId, retryUrl),
          });
        }
      }
      break;
    }

    default:
      // Unhandled event — acknowledge receipt
      break;
  }

  return NextResponse.json({ received: true });
}
