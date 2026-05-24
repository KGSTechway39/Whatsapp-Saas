import { createClient } from "@/lib/supabase/server";
import { getSessionUser } from "@/lib/auth";
import { NextRequest, NextResponse } from "next/server";

export async function GET() {
  const supabase = createClient();
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data, error } = await supabase
    .from("wallet")
    .select("balance, currency")
    .eq("user_id", user.id)
    .single();

  if (error) return NextResponse.json({ balance: 0, currency: "INR" });

  return NextResponse.json({ balance: data.balance, currency: data.currency });
}

export async function POST(request: NextRequest) {
  const supabase = createClient();
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { amount, paymentMethod, metadata } = await request.json();

  if (!amount || amount <= 0) {
    return NextResponse.json({ error: "Invalid amount" }, { status: 400 });
  }

  const { data: wallet, error: walletError } = await supabase
    .from("wallet")
    .select("balance")
    .eq("user_id", user.id)
    .single();

  if (walletError) return NextResponse.json({ error: "Wallet not found" }, { status: 404 });

  const newBalance = Number(wallet.balance) + Number(amount);

  const [updateResult, txResult] = await Promise.all([
    supabase
      .from("wallet")
      .update({ balance: newBalance, updated_at: new Date().toISOString() })
      .eq("user_id", user.id),

    supabase.from("transactions").insert({
      user_id: user.id,
      type: "credit",
      description: `Wallet recharge via ${paymentMethod || "online"}`,
      amount,
      balance_after: newBalance,
      payment_method: paymentMethod || "online",
      metadata: metadata || null,
    }),
  ]);

  if (updateResult.error) return NextResponse.json({ error: updateResult.error.message }, { status: 500 });

  return NextResponse.json({ balance: newBalance, added: amount });
}
