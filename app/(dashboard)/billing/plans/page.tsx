"use client";

import { PageHeader } from "@/components/shared/PageHeader";
import {
  Check, X, Loader2, Crown, Zap, ArrowRight, AlertCircle,
  Sparkles, Rocket,
} from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import Link from "next/link";

// ─── Plan definitions ─────────────────────────────────────────────────────────

const PLANS = [
  {
    id: "free",
    tier: "free",
    name: "Free",
    description: "Try out WASend",
    monthlyPrice: 0,
    yearlyPrice: 0,
    badge: null as string | null,
    highlight: false,
    icon: null as React.ElementType | null,
    iconColor: "",
    borderClass: "border-border/50",
    ctaClass: "border border-border hover:bg-accent",
    ctaTextClass: "",
    limits: {
      numbers: 1, messages: 100, templates: 3,
      campaigns: 0, teamMembers: 1, apiAccess: false, whiteLabel: false,
    },
    features: ["1 WhatsApp number", "100 messages/month", "3 templates", "Basic analytics"],
  },
  {
    id: "starter",
    tier: "starter",
    name: "Starter",
    description: "For small businesses",
    monthlyPrice: 999,
    yearlyPrice: 9590,
    badge: "Popular" as string | null,
    highlight: true,
    icon: Zap as React.ElementType | null,
    iconColor: "text-primary",
    borderClass: "border-primary/40 shadow-xl shadow-primary/10",
    ctaClass: "wa-gradient text-white hover:opacity-90 shadow-lg shadow-primary/25",
    ctaTextClass: "text-white",
    limits: {
      numbers: 1, messages: 5000, templates: 20,
      campaigns: 10, teamMembers: 2, apiAccess: false, whiteLabel: false,
    },
    features: [
      "1 WhatsApp number",
      "5,000 messages/month",
      "20 templates",
      "10 campaigns/month",
      "2 team members",
      "Automation workflows",
      "Basic chatbot",
      "Advanced analytics",
    ],
  },
  {
    id: "growth",
    tier: "growth",
    name: "Growth",
    description: "For scaling teams",
    monthlyPrice: 2999,
    yearlyPrice: 28790,
    badge: "Best Value" as string | null,
    highlight: false,
    icon: Sparkles as React.ElementType | null,
    iconColor: "text-violet-400",
    borderClass: "border-violet-500/30",
    ctaClass: "bg-violet-600 text-white hover:bg-violet-500 shadow-lg shadow-violet-500/20",
    ctaTextClass: "text-white",
    limits: {
      numbers: 2, messages: 25000, templates: 50,
      campaigns: 30, teamMembers: 5, apiAccess: false, whiteLabel: false,
    },
    features: [
      "2 WhatsApp numbers",
      "25,000 messages/month",
      "50 templates",
      "30 campaigns/month",
      "5 team members",
      "AI chatbot",
      "CRM pipeline",
      "Appointment booking",
      "Priority chat support",
    ],
  },
  {
    id: "pro",
    tier: "pro",
    name: "Pro",
    description: "For power users & agencies",
    monthlyPrice: 9999,
    yearlyPrice: 95990,
    badge: null as string | null,
    highlight: false,
    icon: Crown as React.ElementType | null,
    iconColor: "text-amber-400",
    borderClass: "border-amber-500/30",
    ctaClass: "bg-amber-500 text-black hover:bg-amber-400 shadow-lg shadow-amber-500/20",
    ctaTextClass: "text-black",
    limits: {
      numbers: 5, messages: 100000, templates: -1,
      campaigns: -1, teamMembers: 10, apiAccess: true, whiteLabel: true,
    },
    features: [
      "5 WhatsApp numbers",
      "1,00,000 messages/month",
      "Unlimited templates",
      "Unlimited campaigns",
      "10 team members",
      "API access",
      "White-label option",
      "Priority phone support",
      "Custom webhooks",
      "Dedicated account manager",
    ],
  },
] as const;

type PlanTier = "free" | "starter" | "growth" | "pro";

const TIER_ORDER: PlanTier[] = ["free", "starter", "growth", "pro"];

const FEATURES: {
  label: string;
  free: boolean | string;
  starter: boolean | string;
  growth: boolean | string;
  pro: boolean | string;
}[] = [
  { label: "WhatsApp Numbers",      free: "1",          starter: "1",          growth: "2",          pro: "5"           },
  { label: "Messages / month",      free: "100",        starter: "5,000",      growth: "25,000",     pro: "1,00,000"    },
  { label: "Message Templates",     free: "3",          starter: "20",         growth: "50",         pro: "Unlimited"   },
  { label: "Campaigns / month",     free: false,        starter: "10",         growth: "30",         pro: "Unlimited"   },
  { label: "Team Members",          free: "1",          starter: "2",          growth: "5",          pro: "10"          },
  { label: "Analytics Dashboard",   free: "Basic",      starter: "Advanced",   growth: "Advanced",   pro: "Advanced"    },
  { label: "Automation Workflows",  free: false,        starter: true,         growth: true,         pro: true          },
  { label: "Chatbot",               free: false,        starter: "Basic",      growth: "AI-powered", pro: "AI-powered"  },
  { label: "CRM Pipeline",          free: false,        starter: false,        growth: true,         pro: true          },
  { label: "Appointment Booking",   free: false,        starter: false,        growth: true,         pro: true          },
  { label: "API Access",            free: false,        starter: false,        growth: false,        pro: true          },
  { label: "Custom Webhooks",       free: false,        starter: false,        growth: false,        pro: true          },
  { label: "White-label Option",    free: false,        starter: false,        growth: false,        pro: true          },
  { label: "Priority Support",      free: false,        starter: false,        growth: "Chat",       pro: "Phone + Chat"},
];

interface UsageData {
  plan: {
    id: string; tier: string; status: string;
    cancelAtPeriodEnd: boolean; currentPeriodEnd: string | null;
  };
  usage: {
    messages:  { used: number; limit: number; percent: number };
    numbers:   { used: number; limit: number; percent: number };
    campaigns: { used: number; limit: number; percent: number };
  };
}

function FeatureValue({ val }: { val: boolean | string }) {
  if (val === false) return <X className="w-4 h-4 text-muted-foreground/30 mx-auto" />;
  if (val === true)  return <Check className="w-4 h-4 text-primary mx-auto" />;
  return <span className="text-xs font-medium text-center block leading-tight">{val}</span>;
}

function UsageBar({ label, used, limit, percent }: { label: string; used: number; limit: number; percent: number }) {
  const isUnlimited = limit === -1;
  return (
    <div>
      <div className="flex justify-between text-xs mb-1.5">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-medium tabular-nums">
          {isUnlimited ? `${used.toLocaleString()} / ∞` : `${used.toLocaleString()} / ${limit.toLocaleString()}`}
        </span>
      </div>
      <div className="h-1.5 bg-muted/50 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-500 ${
            percent >= 90 ? "bg-red-500" : percent >= 70 ? "bg-amber-500" : "bg-gradient-to-r from-primary to-emerald-500"
          }`}
          style={{ width: isUnlimited ? "15%" : `${Math.max(2, percent)}%` }}
        />
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function PlansPage() {
  const [yearly, setYearly] = useState(false);
  const [usageData, setUsageData] = useState<UsageData | null>(null);
  const [loading, setLoading] = useState(true);
  const [subscribing, setSubscribing] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);

  useEffect(() => {
    fetch("/api/billing/usage")
      .then((r) => r.json())
      .then(setUsageData)
      .catch(() => toast.error("Failed to load billing data"))
      .finally(() => setLoading(false));
  }, []);

  const currentTier = (usageData?.plan.tier || "free") as PlanTier;
  const planStatus = usageData?.plan.status || "active";
  const cancelAtEnd = usageData?.plan.cancelAtPeriodEnd || false;
  const periodEnd = usageData?.plan.currentPeriodEnd;

  const handleSubscribe = async (tier: string) => {
    if (tier === "free" || tier === currentTier) return;
    const planId = `${tier}_${yearly ? "yearly" : "monthly"}`;
    setSubscribing(tier);
    try {
      const res = await fetch("/api/billing/create-subscription", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to create subscription");
      if (data.paymentUrl) {
        window.location.href = data.paymentUrl;
      } else {
        toast.success("Subscription created! Complete payment to activate.");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Subscription failed");
    } finally {
      setSubscribing(null);
    }
  };

  const handleCancel = async () => {
    if (!confirm("Cancel your subscription? You'll keep access until the end of your billing period.")) return;
    setCancelling(true);
    try {
      const res = await fetch("/api/billing/create-subscription", { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success("Subscription cancelled. Access continues until period end.");
      setUsageData((prev) =>
        prev ? { ...prev, plan: { ...prev.plan, cancelAtPeriodEnd: true } } : prev
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Cancellation failed");
    } finally {
      setCancelling(false);
    }
  };

  const currentTierIdx = TIER_ORDER.indexOf(currentTier);

  return (
    <div className="max-w-6xl space-y-8">
      <PageHeader
        title="Plans & Pricing"
        subtitle="Choose the right plan for your business. Upgrade or downgrade anytime."
      />

      {/* Cancellation alert */}
      {cancelAtEnd && periodEnd && (
        <div className="flex items-start gap-3 bg-amber-500/10 border border-amber-500/20 rounded-xl p-4">
          <AlertCircle className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
          <p className="text-sm text-amber-300">
            Your subscription is cancelled and will end on{" "}
            <strong>
              {new Date(periodEnd).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" })}
            </strong>.{" "}
            Resubscribe anytime to continue using premium features.
          </p>
        </div>
      )}

      {/* Current usage */}
      {!loading && usageData && currentTier !== "free" && (
        <div className="bg-card rounded-2xl border border-border/50 p-6">
          <div className="flex items-center justify-between mb-5">
            <div>
              <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium mb-1">Current Usage</p>
              <div className="flex items-center gap-2">
                <p className="font-semibold">
                  {PLANS.find((p) => p.tier === currentTier)?.name} Plan
                </p>
                <span className={`text-xs px-2.5 py-0.5 rounded-full font-medium ${
                  planStatus === "active" ? "bg-emerald-500/15 text-emerald-400" :
                  planStatus === "past_due" ? "bg-red-500/15 text-red-400" :
                  "bg-muted text-muted-foreground"
                }`}>
                  {planStatus}
                </span>
              </div>
            </div>
            {periodEnd && (
              <p className="text-xs text-muted-foreground">
                Renews {new Date(periodEnd).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}
              </p>
            )}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
            <UsageBar label="Messages sent"     {...usageData.usage.messages}  />
            <UsageBar label="Numbers connected"  {...usageData.usage.numbers}   />
            <UsageBar label="Campaigns / month"  {...usageData.usage.campaigns} />
          </div>
        </div>
      )}

      {/* Billing toggle */}
      <div className="flex items-center justify-center gap-4">
        <span className={`text-sm font-medium ${!yearly ? "text-foreground" : "text-muted-foreground"}`}>Monthly</span>
        <button
          onClick={() => setYearly((v) => !v)}
          className={`relative w-12 h-6 rounded-full transition-colors duration-300 ${yearly ? "bg-primary" : "bg-muted"}`}
        >
          <div className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow-md transition-transform duration-300 ${yearly ? "translate-x-7" : "translate-x-1"}`} />
        </button>
        <span className={`text-sm font-medium ${yearly ? "text-foreground" : "text-muted-foreground"}`}>
          Yearly
          <span className="ml-1.5 text-xs text-primary font-semibold bg-primary/10 px-2 py-0.5 rounded-full">Save 20%</span>
        </span>
      </div>

      {/* Plan cards — 4 columns */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
        {PLANS.map((plan) => {
          const isCurrent = plan.tier === currentTier;
          const tierIdx = TIER_ORDER.indexOf(plan.tier as PlanTier);
          const isUpgrade = tierIdx > currentTierIdx;
          const price = yearly && plan.tier !== "free" ? plan.yearlyPrice : plan.monthlyPrice;
          const monthlyEquiv = yearly && plan.tier !== "free"
            ? Math.round(plan.yearlyPrice / 12)
            : plan.monthlyPrice;

          return (
            <div
              key={plan.id}
              className={`relative bg-card rounded-2xl border p-5 flex flex-col transition-all duration-200 ${plan.borderClass} ${plan.highlight ? "scale-[1.02]" : ""} ${isCurrent ? "ring-2 ring-primary/30" : ""}`}
            >
              {/* Badge */}
              {plan.badge && (
                <div className={`absolute -top-3 left-1/2 -translate-x-1/2 flex items-center gap-1 text-xs font-bold px-3 py-1 rounded-full whitespace-nowrap ${
                  plan.tier === "starter" ? "wa-gradient text-white shadow-lg shadow-primary/30" :
                  plan.tier === "growth"  ? "bg-violet-600 text-white shadow-lg shadow-violet-500/30" :
                  "bg-amber-500 text-black"
                }`}>
                  <Sparkles className="w-3 h-3" />
                  {plan.badge}
                </div>
              )}

              {isCurrent && (
                <div className="absolute -top-3 right-3 text-xs font-bold px-3 py-1 rounded-full bg-primary/20 text-primary border border-primary/30 whitespace-nowrap">
                  Current
                </div>
              )}

              {/* Plan header */}
              <div className="mb-5 mt-1">
                <div className="flex items-center gap-1.5 mb-1.5">
                  {plan.icon && <plan.icon className={`w-4 h-4 ${plan.iconColor}`} />}
                  <h3 className="font-bold text-base">{plan.name}</h3>
                </div>
                <p className="text-xs text-muted-foreground mb-3">{plan.description}</p>

                <div className="flex items-end gap-1">
                  <span className="text-3xl font-black">
                    {plan.tier === "free" ? "Free" : `₹${monthlyEquiv.toLocaleString()}`}
                  </span>
                  {plan.tier !== "free" && (
                    <span className="text-xs text-muted-foreground mb-1">/mo</span>
                  )}
                </div>
                {yearly && plan.tier !== "free" && (
                  <p className="text-xs text-muted-foreground mt-1">
                    ₹{price.toLocaleString()}/yr · Save ₹{((plan.monthlyPrice * 12) - price).toLocaleString()}
                  </p>
                )}
              </div>

              {/* Feature list */}
              <ul className="space-y-2.5 mb-6 flex-1">
                {plan.features.map((feature) => (
                  <li key={feature} className="flex items-start gap-2 text-xs">
                    <Check className="w-3.5 h-3.5 text-primary flex-shrink-0 mt-0.5" />
                    <span className="leading-snug">{feature}</span>
                  </li>
                ))}
              </ul>

              {/* CTA */}
              {isCurrent ? (
                <div className="space-y-2">
                  <div className="w-full py-2.5 rounded-xl border border-primary/30 bg-primary/5 text-primary text-xs font-semibold text-center">
                    ✓ Active Plan
                  </div>
                  {plan.tier !== "free" && !cancelAtEnd && (
                    <button
                      onClick={handleCancel}
                      disabled={cancelling}
                      className="w-full py-2 rounded-xl text-xs text-muted-foreground hover:text-destructive border border-border/50 hover:border-destructive/30 transition-all"
                    >
                      {cancelling ? <Loader2 className="w-3 h-3 animate-spin mx-auto" /> : "Cancel"}
                    </button>
                  )}
                </div>
              ) : (
                <button
                  onClick={() => plan.tier !== "free" && handleSubscribe(plan.tier)}
                  disabled={!!subscribing || loading || plan.tier === "free"}
                  className={`w-full flex items-center justify-center gap-2 py-2.5 rounded-xl font-semibold text-xs transition-all ${plan.ctaClass} disabled:opacity-50 disabled:cursor-not-allowed`}
                >
                  {subscribing === plan.tier ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : plan.tier === "free" ? (
                    "Free Forever"
                  ) : (
                    <>
                      <Rocket className="w-3.5 h-3.5" />
                      {isUpgrade ? "Upgrade" : "Downgrade"}
                      <ArrowRight className="w-3.5 h-3.5" />
                    </>
                  )}
                </button>
              )}
            </div>
          );
        })}
      </div>

      {/* Feature comparison table */}
      <div className="bg-card rounded-2xl border border-border/50 overflow-hidden">
        <div className="p-6 border-b border-border/50">
          <h3 className="font-semibold text-lg">Full Feature Comparison</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border/50 bg-muted/10">
                <th className="text-left text-xs font-medium text-muted-foreground px-6 py-4 w-2/5">Feature</th>
                {PLANS.map((p) => (
                  <th key={p.id} className="text-center text-xs font-medium px-3 py-4">
                    <span className={p.tier === currentTier ? "text-primary font-bold" : "text-muted-foreground"}>
                      {p.name}{p.tier === currentTier && " ✓"}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {FEATURES.map((row, i) => (
                <tr key={row.label} className={`border-b border-border/30 last:border-0 ${i % 2 === 0 ? "" : "bg-muted/5"}`}>
                  <td className="px-6 py-3.5 text-sm text-muted-foreground">{row.label}</td>
                  <td className="px-3 py-3.5 text-center"><FeatureValue val={row.free} /></td>
                  <td className="px-3 py-3.5 text-center"><FeatureValue val={row.starter} /></td>
                  <td className="px-3 py-3.5 text-center"><FeatureValue val={row.growth} /></td>
                  <td className="px-3 py-3.5 text-center"><FeatureValue val={row.pro} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Trust badges */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {[
          { title: "Secure payments", body: "All transactions processed via Razorpay. PCI DSS compliant." },
          { title: "Cancel anytime", body: "No lock-in. Cancel before renewal and you won't be charged again." },
          { title: "GST Invoice", body: "GST invoices auto-generated and available in transaction history." },
        ].map((item) => (
          <div key={item.title} className="bg-card rounded-xl border border-border/50 p-5">
            <p className="text-sm font-semibold mb-1">{item.title}</p>
            <p className="text-xs text-muted-foreground">{item.body}</p>
          </div>
        ))}
      </div>

      <div className="text-center">
        <Link href="/billing" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
          ← Back to Wallet & Billing
        </Link>
      </div>
    </div>
  );
}
