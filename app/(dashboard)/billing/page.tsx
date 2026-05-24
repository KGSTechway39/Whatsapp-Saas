"use client";

import { PageHeader } from "@/components/shared/PageHeader";
import { wallet as walletApi, transactions as txApi } from "@/lib/api";
import { formatDate } from "@/lib/utils";
import { Transaction } from "@/types";
import {
  Wallet, TrendingUp, Download, CreditCard, ArrowUpRight, ArrowDownLeft,
  Loader2, Crown, Zap, Check, X as XIcon, BarChart3, RefreshCw,
  ArrowRight, Sparkles, Shield,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend,
} from "recharts";

// ─── Types ────────────────────────────────────────────────────────────────────

interface UsageData {
  plan: {
    id: string; name: string; tier: string; status: string;
    cancelAtPeriodEnd: boolean; currentPeriodEnd: string | null;
  };
  usage: {
    messages:  { used: number; limit: number; percent: number };
    numbers:   { used: number; limit: number; percent: number };
    campaigns: { used: number; limit: number; percent: number };
  };
  limits: { messagesPerMonth: number; numbers: number };
}

interface ChartPoint {
  date: string;
  sent: number;
  delivered: number;
  failed: number;
}

const QUICK_AMOUNTS = [500, 1000, 2000, 5000];
const GST_RATE = 0.18;

const TIER_COLOR: Record<string, string> = {
  free:    "text-muted-foreground",
  starter: "text-primary",
  growth:  "text-violet-400",
  pro:     "text-amber-400",
};

const TIER_BG: Record<string, string> = {
  free:    "bg-muted/20 border-border/50",
  starter: "bg-primary/10 border-primary/30",
  growth:  "bg-violet-500/10 border-violet-500/30",
  pro:     "bg-amber-500/10 border-amber-500/30",
};

// ─── Sub-components ───────────────────────────────────────────────────────────

function UsageBar({ label, used, limit, percent }: { label: string; used: number; limit: number; percent: number }) {
  const isUnlimited = limit === -1;
  const color =
    percent >= 90 ? "bg-red-500" :
    percent >= 70 ? "bg-amber-500" :
    "bg-gradient-to-r from-primary to-emerald-500";

  return (
    <div>
      <div className="flex justify-between text-xs mb-1.5">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-medium tabular-nums">
          {isUnlimited
            ? `${used.toLocaleString()} / ∞`
            : `${used.toLocaleString()} / ${limit.toLocaleString()}`}
        </span>
      </div>
      <div className="h-1.5 bg-muted/50 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-700 ${color}`}
          style={{ width: isUnlimited ? "15%" : `${Math.max(2, percent)}%` }}
        />
      </div>
    </div>
  );
}

function TierBadge({ tier }: { tier: string }) {
  const icons: Record<string, React.ReactNode> = {
    starter: <Zap className="w-3 h-3" />,
    growth:  <Sparkles className="w-3 h-3" />,
    pro:     <Crown className="w-3 h-3" />,
  };
  return (
    <span className={`inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-full font-semibold border ${TIER_BG[tier] || TIER_BG.free} ${TIER_COLOR[tier] || TIER_COLOR.free}`}>
      {icons[tier]}
      {tier.charAt(0).toUpperCase() + tier.slice(1)}
    </span>
  );
}

// ─── Recharge Modal ───────────────────────────────────────────────────────────

function RechargeModal({ onClose, onSuccess }: { onClose: () => void; onSuccess: (newBalance: number) => void }) {
  const [amount, setAmount] = useState<number | "">(1000);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [finalBalance, setFinalBalance] = useState(0);
  const overlayRef = useRef<HTMLDivElement>(null);

  const numAmount = typeof amount === "number" ? amount : 0;
  const gst = Math.round(numAmount * GST_RATE);
  const total = numAmount + gst;
  const messagesAdded = Math.floor(numAmount / 2);

  const handlePay = async () => {
    if (!numAmount || numAmount < 100) { toast.error("Minimum recharge is ₹100"); return; }
    setLoading(true);
    try {
      const res = await fetch("/api/wallet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount: numAmount, paymentMethod: "razorpay" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Payment failed");
      setFinalBalance(data.balance);
      setDone(true);
      onSuccess(data.balance);
      toast.success(`Wallet recharged with ₹${numAmount.toLocaleString()}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Payment failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4"
      onClick={(e) => e.target === overlayRef.current && onClose()}
    >
      <div className="w-full max-w-md bg-card border border-border rounded-2xl shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border/50">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg wa-gradient flex items-center justify-center">
              <CreditCard className="w-4 h-4 text-white" />
            </div>
            <div>
              <p className="font-semibold text-sm">Recharge Wallet</p>
              <p className="text-xs text-muted-foreground">Add credits via Razorpay</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-accent transition-colors">
            <XIcon className="w-4 h-4" />
          </button>
        </div>

        {done ? (
          /* Success state */
          <div className="p-6 text-center">
            <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-4">
              <Check className="w-8 h-8 text-primary" />
            </div>
            <p className="font-bold text-lg mb-1">Payment Successful!</p>
            <p className="text-sm text-muted-foreground mb-5">Your wallet has been recharged</p>
            <div className="bg-muted/30 rounded-xl p-4 text-left space-y-2.5 mb-5">
              {[
                { label: "Recharge Amount", value: `₹${numAmount.toLocaleString()}` },
                { label: "GST (18%)", value: `₹${gst.toLocaleString()}` },
                { label: "Total Paid", value: `₹${total.toLocaleString()}` },
                { label: "New Balance", value: `₹${finalBalance.toLocaleString()}` },
                { label: "Messages Added", value: `~${messagesAdded.toLocaleString()}` },
              ].map(({ label, value }) => (
                <div key={label} className="flex justify-between text-sm">
                  <span className="text-muted-foreground">{label}</span>
                  <span className="font-semibold">{value}</span>
                </div>
              ))}
            </div>
            <button
              onClick={onClose}
              className="w-full wa-gradient text-white font-semibold py-3 rounded-xl hover:opacity-90 transition-all"
            >
              Done
            </button>
          </div>
        ) : (
          /* Amount selection */
          <div className="p-6 space-y-5">
            {/* Quick amounts */}
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Select Amount</p>
              <div className="grid grid-cols-4 gap-2 mb-3">
                {QUICK_AMOUNTS.map((a) => (
                  <button
                    key={a}
                    onClick={() => setAmount(a)}
                    className={`py-2.5 rounded-xl text-sm font-semibold border transition-all ${
                      amount === a
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border/60 hover:border-primary/40 hover:bg-muted/30"
                    }`}
                  >
                    ₹{a >= 1000 ? `${a / 1000}k` : a}
                  </button>
                ))}
              </div>
              <div className="relative">
                <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground text-sm font-medium">₹</span>
                <input
                  type="number"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value ? parseInt(e.target.value) : "")}
                  placeholder="Custom amount"
                  min="100"
                  className="w-full bg-muted/40 border border-border/60 rounded-xl pl-8 pr-4 py-2.5 text-sm outline-none focus:border-primary/60 focus:ring-2 focus:ring-primary/10 transition-all"
                />
              </div>
              {numAmount >= 100 && (
                <p className="text-xs text-primary mt-1.5">
                  ≈ {Math.floor(numAmount / 2).toLocaleString()} messages at marketing rate
                </p>
              )}
            </div>

            {/* Summary */}
            {numAmount >= 100 && (
              <div className="bg-muted/20 rounded-xl p-4 space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Recharge</span>
                  <span>₹{numAmount.toLocaleString()}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">GST (18%)</span>
                  <span>₹{gst.toLocaleString()}</span>
                </div>
                <div className="flex justify-between font-bold pt-2 border-t border-border/40">
                  <span>Total</span>
                  <span className="text-primary">₹{total.toLocaleString()}</span>
                </div>
              </div>
            )}

            {/* Payment methods row */}
            <div className="flex items-center gap-1.5 flex-wrap">
              {["UPI", "Cards", "NetBanking", "Wallets"].map((m) => (
                <span key={m} className="text-xs px-2 py-1 rounded-md bg-muted/50 text-muted-foreground font-medium">{m}</span>
              ))}
            </div>

            <button
              onClick={handlePay}
              disabled={loading || numAmount < 100}
              className="flex items-center justify-center gap-2 w-full wa-gradient text-white font-semibold py-3 rounded-xl hover:opacity-90 transition-all disabled:opacity-40 disabled:cursor-not-allowed shadow-lg shadow-primary/20"
            >
              {loading ? (
                <><Loader2 className="w-4 h-4 animate-spin" /> Processing...</>
              ) : (
                <><CreditCard className="w-4 h-4" /> Pay ₹{total > 0 ? total.toLocaleString() : "—"} via Razorpay</>
              )}
            </button>

            <p className="text-xs text-muted-foreground text-center flex items-center justify-center gap-1">
              <Shield className="w-3 h-3" /> Secured by Razorpay · PCI DSS Compliant
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function BillingPage() {
  const [balance, setBalance] = useState(0);
  const [txList, setTxList] = useState<Transaction[]>([]);
  const [usageData, setUsageData] = useState<UsageData | null>(null);
  const [chartData, setChartData] = useState<ChartPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [showRecharge, setShowRecharge] = useState(false);
  const [txPage, setTxPage] = useState(1);
  const TX_PER_PAGE = 10;

  useEffect(() => {
    Promise.all([
      walletApi.get(),
      txApi.list(),
      fetch("/api/billing/usage").then((r) => r.json()),
      fetch("/api/analytics?days=30").then((r) => r.json()),
    ])
      .then(([w, t, usage, analytics]) => {
        setBalance(Number(w.balance));
        setTxList(t.transactions ?? []);
        setUsageData(usage);
        setChartData(analytics.chartData ?? []);
      })
      .catch(() => toast.error("Failed to load billing data"))
      .finally(() => setLoading(false));
  }, []);

  const tier = usageData?.plan.tier || "free";
  const planName = usageData?.plan.name || "Free";
  const planStatus = usageData?.plan.status || "active";
  const cancelAtEnd = usageData?.plan.cancelAtPeriodEnd || false;
  const periodEnd = usageData?.plan.currentPeriodEnd;

  const messagesRemaining = Math.floor(balance / 2);
  const paginatedTx = txList.slice((txPage - 1) * TX_PER_PAGE, txPage * TX_PER_PAGE);
  const totalTxPages = Math.ceil(txList.length / TX_PER_PAGE);

  return (
    <>
      {showRecharge && (
        <RechargeModal
          onClose={() => setShowRecharge(false)}
          onSuccess={(newBalance) => { setBalance(newBalance); setShowRecharge(false); }}
        />
      )}

      <div className="max-w-5xl space-y-6">
        <PageHeader
          title="Wallet & Billing"
          subtitle="Manage your wallet, subscription, and transaction history"
          action={
            <button
              onClick={() => setShowRecharge(true)}
              className="flex items-center gap-2 wa-gradient text-white text-sm font-semibold px-4 py-2 rounded-xl hover:opacity-90 transition-all shadow-lg shadow-primary/20"
            >
              <CreditCard className="w-4 h-4" /> Recharge Wallet
            </button>
          }
        />

        {/* ── Row 1: Plan + Wallet ────────────────────────────────────────── */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">

          {/* Current Plan Card */}
          <div className="bg-card rounded-2xl border border-border/50 p-6 flex flex-col gap-5">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium mb-1.5">Current Plan</p>
                <div className="flex items-center gap-2">
                  <p className="text-2xl font-black">{planName}</p>
                  <TierBadge tier={tier} />
                </div>
                {periodEnd && (
                  <p className="text-xs text-muted-foreground mt-1">
                    {cancelAtEnd ? "Expires" : "Renews"}{" "}
                    {new Date(periodEnd).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}
                  </p>
                )}
              </div>
              <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${
                planStatus === "active" ? "bg-emerald-500/15 text-emerald-400" :
                planStatus === "past_due" ? "bg-red-500/15 text-red-400" :
                "bg-muted text-muted-foreground"
              }`}>
                {planStatus}
              </span>
            </div>

            {/* Usage bars */}
            {loading ? (
              <div className="space-y-4">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="space-y-1.5">
                    <div className="h-3 bg-muted/30 rounded animate-pulse w-1/2" />
                    <div className="h-1.5 bg-muted/30 rounded animate-pulse" />
                  </div>
                ))}
              </div>
            ) : usageData ? (
              <div className="space-y-4">
                <UsageBar label="Messages this month" {...usageData.usage.messages} />
                <UsageBar label="Numbers connected"   {...usageData.usage.numbers}  />
                <UsageBar label="Campaigns this month" {...usageData.usage.campaigns} />
              </div>
            ) : null}

            <Link
              href="/billing/plans"
              className="flex items-center justify-center gap-2 w-full border border-primary/30 bg-primary/5 text-primary text-sm font-semibold py-2.5 rounded-xl hover:bg-primary/10 transition-colors mt-auto"
            >
              {tier === "free" ? "Upgrade Plan" : "Manage Plan"}
              <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>

          {/* Wallet Card */}
          <div className="bg-card rounded-2xl border border-border/50 p-6 relative overflow-hidden flex flex-col gap-5">
            <div className="absolute top-0 right-0 w-36 h-36 bg-primary/5 rounded-full -translate-y-1/2 translate-x-1/2 pointer-events-none" />
            <div className="relative">
              <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium mb-1.5">Wallet Balance</p>
              {loading ? (
                <div className="h-10 w-32 bg-muted/30 rounded-lg animate-pulse" />
              ) : (
                <p className="text-4xl font-black">₹{balance.toLocaleString()}</p>
              )}
            </div>

            <div className="bg-muted/30 rounded-xl p-4 relative">
              <div className="flex items-center gap-2 mb-1">
                <TrendingUp className="w-3.5 h-3.5 text-primary" />
                <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Messages Remaining</span>
              </div>
              {loading ? (
                <div className="h-7 w-24 bg-muted/40 rounded animate-pulse mt-1" />
              ) : (
                <>
                  <p className="text-2xl font-black text-primary">~{messagesRemaining.toLocaleString()}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">at marketing rate (₹2/msg)</p>
                </>
              )}
            </div>

            {/* Pricing pill row */}
            <div className="grid grid-cols-3 gap-2">
              {[
                { type: "Marketing", price: "₹2.00", color: "text-purple-400", bg: "bg-purple-500/10" },
                { type: "Utility",   price: "₹1.00", color: "text-blue-400",   bg: "bg-blue-500/10"   },
                { type: "Auth",      price: "₹0.50", color: "text-amber-400",  bg: "bg-amber-500/10"  },
              ].map((p) => (
                <div key={p.type} className={`rounded-xl p-3 ${p.bg} text-center`}>
                  <p className={`text-xs font-medium ${p.color}`}>{p.type}</p>
                  <p className={`text-base font-black ${p.color}`}>{p.price}</p>
                </div>
              ))}
            </div>

            <button
              onClick={() => setShowRecharge(true)}
              className="flex items-center justify-center gap-2 w-full wa-gradient text-white font-semibold py-3 rounded-xl hover:opacity-90 transition-all shadow-lg shadow-primary/20 mt-auto"
            >
              <CreditCard className="w-4 h-4" /> Recharge Now
            </button>
          </div>
        </div>

        {/* ── Row 2: Usage Chart ──────────────────────────────────────────── */}
        <div className="bg-card rounded-2xl border border-border/50 p-6">
          <div className="flex items-center justify-between mb-5">
            <div>
              <h3 className="font-semibold">Message Activity</h3>
              <p className="text-xs text-muted-foreground mt-0.5">Last 30 days</p>
            </div>
            <div className="flex items-center gap-1.5 p-1.5 bg-muted/30 rounded-xl">
              <BarChart3 className="w-3.5 h-3.5 text-muted-foreground" />
              <span className="text-xs text-muted-foreground font-medium">30d</span>
            </div>
          </div>

          {loading ? (
            <div className="h-52 bg-muted/20 rounded-xl animate-pulse" />
          ) : chartData.length === 0 ? (
            <div className="h-52 flex flex-col items-center justify-center text-center">
              <BarChart3 className="w-8 h-8 text-muted-foreground/30 mb-2" />
              <p className="text-sm text-muted-foreground">No data yet. Send messages to see activity.</p>
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <AreaChart data={chartData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                <defs>
                  <linearGradient id="gradSent" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#25d366" stopOpacity={0.25} />
                    <stop offset="95%" stopColor="#25d366" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="gradDelivered" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.2} />
                    <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="gradFailed" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#ef4444" stopOpacity={0.15} />
                    <stop offset="95%" stopColor="#ef4444" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 10, fill: "#6b7280" }}
                  axisLine={false}
                  tickLine={false}
                  interval="preserveStartEnd"
                />
                <YAxis tick={{ fontSize: 10, fill: "#6b7280" }} axisLine={false} tickLine={false} />
                <Tooltip
                  contentStyle={{ background: "#1a2535", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 10, fontSize: 12 }}
                  labelStyle={{ color: "#94a3b8", marginBottom: 4 }}
                />
                <Legend
                  iconType="circle" iconSize={8}
                  wrapperStyle={{ fontSize: 11, paddingTop: 12 }}
                />
                <Area type="monotone" dataKey="sent"      name="Sent"      stroke="#25d366" strokeWidth={2} fill="url(#gradSent)"      dot={false} />
                <Area type="monotone" dataKey="delivered" name="Delivered" stroke="#3b82f6" strokeWidth={2} fill="url(#gradDelivered)" dot={false} />
                <Area type="monotone" dataKey="failed"    name="Failed"    stroke="#ef4444" strokeWidth={1.5} fill="url(#gradFailed)"    dot={false} />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* ── Row 3: Transaction History ──────────────────────────────────── */}
        <div className="bg-card rounded-2xl border border-border/50 overflow-hidden">
          <div className="flex items-center justify-between p-5 border-b border-border/50">
            <h3 className="font-semibold">Transaction History</h3>
            <button
              onClick={() => toast.success("Downloading all invoices...")}
              className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              <Download className="w-3.5 h-3.5" /> Export
            </button>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-6 h-6 animate-spin text-primary" />
            </div>
          ) : txList.length === 0 ? (
            <div className="flex flex-col items-center py-12 text-center">
              <RefreshCw className="w-8 h-8 text-muted-foreground/30 mb-2" />
              <p className="text-sm text-muted-foreground">No transactions yet.</p>
              <p className="text-xs text-muted-foreground/60 mt-1">Recharge your wallet or subscribe to a plan to get started.</p>
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-border/50 bg-muted/10">
                      {["Date", "Type", "Description", "Amount", "Balance", "Invoice"].map((h) => (
                        <th key={h} className="text-left text-xs font-medium text-muted-foreground px-5 py-3">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {paginatedTx.map((tx) => (
                      <tr key={tx.id} className="border-b border-border/30 last:border-0 hover:bg-muted/20 transition-colors">
                        <td className="px-5 py-4 text-sm text-muted-foreground whitespace-nowrap">{formatDate(tx.date)}</td>
                        <td className="px-5 py-4">
                          <div className={`inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full font-medium ${
                            tx.type === "credit"
                              ? "bg-emerald-500/10 text-emerald-400"
                              : "bg-red-500/10 text-red-400"
                          }`}>
                            {tx.type === "credit"
                              ? <ArrowDownLeft className="w-3 h-3" />
                              : <ArrowUpRight className="w-3 h-3" />}
                            {tx.type === "credit" ? "Credit" : "Debit"}
                          </div>
                        </td>
                        <td className="px-5 py-4 text-sm max-w-48">
                          <p className="truncate">{tx.description}</p>
                        </td>
                        <td className="px-5 py-4">
                          <span className={`text-sm font-semibold tabular-nums ${
                            tx.type === "credit" ? "text-emerald-400" : "text-red-400"
                          }`}>
                            {tx.type === "credit" ? "+" : "−"}₹{Math.abs(tx.amount).toLocaleString()}
                          </span>
                        </td>
                        <td className="px-5 py-4 text-sm font-medium tabular-nums">₹{tx.balance.toLocaleString()}</td>
                        <td className="px-5 py-4">
                          <button
                            onClick={() => toast.success("Invoice downloaded!")}
                            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
                          >
                            <Download className="w-3.5 h-3.5" /> PDF
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Pagination */}
              {totalTxPages > 1 && (
                <div className="flex items-center justify-between px-5 py-3 border-t border-border/30">
                  <p className="text-xs text-muted-foreground">
                    Showing {(txPage - 1) * TX_PER_PAGE + 1}–{Math.min(txPage * TX_PER_PAGE, txList.length)} of {txList.length}
                  </p>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => setTxPage((p) => Math.max(1, p - 1))}
                      disabled={txPage === 1}
                      className="px-3 py-1.5 text-xs rounded-lg border border-border/50 hover:bg-accent disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                    >
                      Prev
                    </button>
                    {Array.from({ length: totalTxPages }, (_, i) => i + 1).map((p) => (
                      <button
                        key={p}
                        onClick={() => setTxPage(p)}
                        className={`px-3 py-1.5 text-xs rounded-lg border transition-colors ${
                          p === txPage
                            ? "border-primary bg-primary/10 text-primary font-semibold"
                            : "border-border/50 hover:bg-accent"
                        }`}
                      >
                        {p}
                      </button>
                    ))}
                    <button
                      onClick={() => setTxPage((p) => Math.min(totalTxPages, p + 1))}
                      disabled={txPage === totalTxPages}
                      className="px-3 py-1.5 text-xs rounded-lg border border-border/50 hover:bg-accent disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                    >
                      Next
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </>
  );
}
