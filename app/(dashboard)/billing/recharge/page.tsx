"use client";

import { PageHeader } from "@/components/shared/PageHeader";
import { CheckCircle2, CreditCard, Loader2, ArrowLeft } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import Link from "next/link";

const quickAmounts = [500, 1000, 2000, 5000];
const GST_RATE = 0.18;

export default function RechargePage() {
  const [amount, setAmount] = useState<number | "">(1000);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [newBalance, setNewBalance] = useState(0);

  const numAmount = typeof amount === "number" ? amount : 0;
  const gst = Math.round(numAmount * GST_RATE);
  const total = numAmount + gst;
  const messagesAdded = Math.floor(numAmount / 2);

  const handlePay = async () => {
    if (!numAmount || numAmount < 1) {
      toast.error("Please enter a valid amount");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/wallet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount: numAmount, paymentMethod: "razorpay" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Payment failed");
      setNewBalance(data.balance);
      setSuccess(true);
      toast.success(`₹${total} paid! Wallet recharged successfully`);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Payment failed");
    } finally {
      setLoading(false);
    }
  };

  if (success) {
    return (
      <div className="max-w-md mx-auto text-center py-16">
        <div className="w-24 h-24 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-6 relative">
          <CheckCircle2 className="w-12 h-12 text-primary" />
          <div className="absolute inset-0 rounded-full border-4 border-primary/20 animate-ping" style={{ animationDuration: "2s" }} />
        </div>
        <h2 className="text-2xl font-bold mb-2">Payment Successful! 🎉</h2>
        <p className="text-muted-foreground mb-2">Your wallet has been recharged</p>
        <div className="bg-card border border-border rounded-2xl p-5 mb-8 text-left space-y-3">
          {[
            { label: "Amount Paid", value: `₹${total.toLocaleString()}` },
            { label: "Amount Added", value: `₹${numAmount.toLocaleString()}` },
            { label: "New Balance", value: `₹${newBalance.toLocaleString()}` },
            { label: "Messages Added", value: `~${messagesAdded.toLocaleString()}` },
          ].map(({ label, value }) => (
            <div key={label} className="flex justify-between text-sm">
              <span className="text-muted-foreground">{label}</span>
              <span className="font-semibold">{value}</span>
            </div>
          ))}
        </div>
        <div className="flex gap-3 justify-center">
          <Link href="/billing" className="wa-gradient text-white text-sm font-semibold px-5 py-2.5 rounded-xl hover:opacity-90 transition-all shadow-lg shadow-primary/25">
            View Wallet
          </Link>
          <button onClick={() => setSuccess(false)} className="px-5 py-2.5 rounded-xl border border-border hover:bg-accent text-sm font-medium transition-colors">
            Recharge Again
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-xl">
      <div className="flex items-center gap-3 mb-6">
        <Link href="/billing" className="p-2 rounded-xl hover:bg-accent transition-colors">
          <ArrowLeft className="w-4 h-4" />
        </Link>
        <div>
          <h1 className="text-2xl font-bold">Recharge Wallet</h1>
          <p className="text-sm text-muted-foreground">Add credits to your WASend wallet</p>
        </div>
      </div>

      <div className="space-y-5">
        <div className="bg-card rounded-2xl border border-border/50 p-6">
          <p className="text-sm font-semibold mb-4">Select Amount</p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
            {quickAmounts.map((a) => (
              <button
                key={a}
                onClick={() => setAmount(a)}
                className={`py-3 px-4 rounded-xl border text-sm font-semibold transition-all ${
                  amount === a
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border hover:border-primary/40 hover:bg-muted/30"
                }`}
              >
                ₹{a.toLocaleString()}
              </button>
            ))}
          </div>

          <div>
            <label className="text-sm font-medium block mb-1.5 text-muted-foreground">
              Or enter custom amount
            </label>
            <div className="relative">
              <span className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground font-medium">₹</span>
              <input
                type="number"
                value={amount}
                onChange={(e) => setAmount(e.target.value ? parseInt(e.target.value) : "")}
                placeholder="Enter amount..."
                min="100"
                className="w-full bg-muted/50 border border-border rounded-xl pl-8 pr-4 py-3 text-sm outline-none focus:border-primary/60 focus:ring-2 focus:ring-primary/20 transition-all"
              />
            </div>
            {numAmount > 0 && (
              <p className="text-xs text-primary mt-1.5">
                ~{Math.floor(numAmount / 2).toLocaleString()} messages at marketing rate
              </p>
            )}
          </div>
        </div>

        {numAmount > 0 && (
          <div className="bg-card rounded-2xl border border-border/50 p-6 animate-fade-in">
            <p className="text-sm font-semibold mb-4">Order Summary</p>
            <div className="space-y-3">
              {[
                { label: "Recharge Amount", value: `₹${numAmount.toLocaleString()}` },
                { label: `GST (18%)`, value: `₹${gst.toLocaleString()}` },
              ].map(({ label, value }) => (
                <div key={label} className="flex justify-between text-sm">
                  <span className="text-muted-foreground">{label}</span>
                  <span>{value}</span>
                </div>
              ))}
              <div className="flex justify-between text-base font-bold pt-3 border-t border-border">
                <span>Total</span>
                <span className="text-primary">₹{total.toLocaleString()}</span>
              </div>
            </div>
          </div>
        )}

        <div className="bg-card rounded-2xl border border-border/50 p-6">
          <p className="text-sm font-semibold mb-4">Payment Method</p>

          <div className="flex items-center gap-3 p-4 rounded-xl bg-[#072654]/10 border border-[#072654]/20 mb-4">
            <div className="w-10 h-10 rounded-lg bg-white flex items-center justify-center flex-shrink-0">
              <span className="text-[#072654] font-black text-xs tracking-tighter">R₹</span>
            </div>
            <div>
              <p className="text-sm font-semibold">Razorpay</p>
              <p className="text-xs text-muted-foreground">Secure payment gateway</p>
            </div>
          </div>

          <div className="flex items-center gap-2 mb-5">
            {[
              { label: "UPI", color: "text-violet-400" },
              { label: "Cards", color: "text-blue-400" },
              { label: "NetBanking", color: "text-emerald-400" },
              { label: "Wallets", color: "text-amber-400" },
            ].map((m) => (
              <span
                key={m.label}
                className={`text-xs px-2.5 py-1.5 rounded-lg bg-muted/50 font-medium ${m.color}`}
              >
                {m.label}
              </span>
            ))}
          </div>

          <button
            onClick={handlePay}
            disabled={loading || !numAmount || numAmount < 1}
            className="flex items-center justify-center gap-2 w-full wa-gradient text-white font-semibold py-3.5 rounded-xl hover:opacity-90 transition-all disabled:opacity-40 disabled:cursor-not-allowed shadow-lg shadow-primary/25"
          >
            {loading ? (
              <><Loader2 className="w-4 h-4 animate-spin" /> Processing...</>
            ) : (
              <>
                <CreditCard className="w-4 h-4" />
                Pay ₹{total.toLocaleString()} with Razorpay
              </>
            )}
          </button>

          <p className="text-xs text-muted-foreground text-center mt-3">
            🔒 Secured by Razorpay · PCI DSS Compliant
          </p>
        </div>
      </div>
    </div>
  );
}
