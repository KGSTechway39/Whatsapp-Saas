import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { getRazorpay } from "@/lib/razorpay";

/**
 * POST /api/wallet/topup
 * Body: { amountRupees: number }
 *
 * Creates a Razorpay ORDER for a prepaid wallet top-up, tagged with the user id
 * and purpose. The wallet is credited ONLY when Razorpay confirms payment via
 * the webhook (order.paid → wallet_credit). This endpoint never moves money.
 *
 * Returns the order details the client needs to open Razorpay Checkout.
 */
export async function POST(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { amountRupees } = await request.json();
  const rupees = Number(amountRupees);
  if (!Number.isFinite(rupees) || rupees < 1) {
    return NextResponse.json({ error: "Minimum top-up is ₹1" }, { status: 400 });
  }
  const amountPaise = Math.round(rupees * 100);

  let razorpay;
  try {
    razorpay = getRazorpay();
  } catch {
    return NextResponse.json({ error: "Payment gateway not configured" }, { status: 503 });
  }

  let order;
  try {
    order = await razorpay.orders.create({
      amount: amountPaise, // Razorpay amounts are in paise
      currency: "INR",
      notes: { user_id: user.id, purpose: "wallet_topup" },
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Failed to create order";
    return NextResponse.json({ error: msg }, { status: 502 });
  }

  return NextResponse.json(
    {
      orderId: order.id,
      amount: amountPaise,
      currency: "INR",
      keyId: process.env.RAZORPAY_KEY_ID,
    },
    { status: 201 },
  );
}
