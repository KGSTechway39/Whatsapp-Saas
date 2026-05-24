"use client";

import { StatsCard } from "@/components/shared/StatsCard";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { StatsCardSkeleton, TableRowSkeleton, Skeleton } from "@/components/shared/Skeleton";
import { dashboard } from "@/lib/api";
import { formatDate } from "@/lib/utils";
import {
  MessageSquare, CheckCircle2, XCircle, Wallet,
  Send, Megaphone, UserPlus, CreditCard, ArrowRight,
  TrendingUp, Smartphone, AlertCircle, CheckCheck,
  X, Zap,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useState, useCallback } from "react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend,
} from "recharts";

const quickActions = [
  { label: "Send Message",   icon: Send,      href: "/templates/send",    color: "from-green-500/20 to-emerald-500/10 border-green-500/25 hover:border-green-500/50"  },
  { label: "New Campaign",   icon: Megaphone,  href: "/campaigns/create",  color: "from-blue-500/20 to-sky-500/10 border-blue-500/25 hover:border-blue-500/50"       },
  { label: "Add Contact",    icon: UserPlus,   href: "/contacts/import",   color: "from-purple-500/20 to-violet-500/10 border-purple-500/25 hover:border-purple-500/50" },
  { label: "Recharge Wallet",icon: CreditCard, href: "/billing",           color: "from-amber-500/20 to-orange-500/10 border-amber-500/25 hover:border-amber-500/50"  },
];

const CHECKLIST_KEY = "wa_checklist_dismissed";
const checklistItems = [
  { id: "number",   label: "Connect a WhatsApp number",    href: "/numbers/connect",   icon: Smartphone  },
  { id: "template", label: "Create your first template",   href: "/templates",         icon: MessageSquare },
  { id: "contacts", label: "Import your contacts",          href: "/contacts/import",   icon: UserPlus    },
  { id: "campaign", label: "Send your first campaign",      href: "/campaigns/create",  icon: Megaphone   },
  { id: "auto",     label: "Set up an automation",          href: "/automation/create", icon: Zap         },
];

const CustomTooltip = ({ active, payload, label }: { active?: boolean; payload?: { value: number; name: string; color: string }[]; label?: string }) => {
  if (active && payload && payload.length) {
    return (
      <div className="bg-card border border-border rounded-xl p-3 shadow-xl text-xs">
        <p className="font-medium mb-2 text-muted-foreground">{label}</p>
        {payload.map((p, i) => (
          <div key={i} className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full" style={{ background: p.color }} />
            <span className="capitalize text-muted-foreground">{p.name}:</span>
            <span className="font-semibold">{p.value}</span>
          </div>
        ))}
      </div>
    );
  }
  return null;
};

function DashboardSkeleton() {
  return (
    <div className="space-y-6 max-w-7xl">
      <div className="flex items-center justify-between">
        <div className="space-y-2">
          <Skeleton className="h-7 w-56" />
          <Skeleton className="h-4 w-72" />
        </div>
        <Skeleton className="h-10 w-36 hidden sm:block rounded-xl" />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        {[0,1,2,3].map(i => <StatsCardSkeleton key={i} />)}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
        {[0,1,2,3].map(i => <Skeleton key={i} className="h-[68px] rounded-2xl" />)}
      </div>
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <div className="xl:col-span-2 bg-card rounded-2xl border border-border/50 p-6">
          <Skeleton className="h-5 w-32 mb-6" />
          <Skeleton className="h-[240px] w-full" />
        </div>
        <div className="bg-card rounded-2xl border border-border/50 p-6 space-y-3">
          <Skeleton className="h-5 w-40 mb-4" />
          {[0,1].map(i => <Skeleton key={i} className="h-[72px] rounded-xl" />)}
        </div>
      </div>
    </div>
  );
}

type DashboardData = Awaited<ReturnType<typeof dashboard.get>>;

export default function DashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [checklistDone, setChecklistDone] = useState<string[]>([]);
  const [checklistDismissed, setChecklistDismissed] = useState(false);

  const load = useCallback(() => {
    setError(false);
    setLoading(true);
    dashboard.get()
      .then(setData)
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
    const dismissed = localStorage.getItem(CHECKLIST_KEY) === "1";
    setChecklistDismissed(dismissed);
    // Infer completed steps from URL visits (simplified: check localStorage flags)
    const done = JSON.parse(localStorage.getItem("wa_checklist_done") || "[]") as string[];
    setChecklistDone(done);
  }, [load]);

  const markDone = (id: string) => {
    const updated = Array.from(new Set([...checklistDone, id]));
    setChecklistDone(updated);
    localStorage.setItem("wa_checklist_done", JSON.stringify(updated));
  };

  const dismissChecklist = () => {
    setChecklistDismissed(true);
    localStorage.setItem(CHECKLIST_KEY, "1");
  };

  const checklistProgress = checklistDone.length;
  const checklistTotal = checklistItems.length;
  const allDone = checklistProgress === checklistTotal;

  if (loading) return <DashboardSkeleton />;

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-4">
        <div className="w-14 h-14 rounded-2xl bg-red-500/10 flex items-center justify-center">
          <AlertCircle className="w-7 h-7 text-red-400" />
        </div>
        <div className="text-center">
          <p className="font-semibold">Failed to load dashboard</p>
          <p className="text-sm text-muted-foreground mt-1">Check your connection and try again</p>
        </div>
        <button
          onClick={load}
          className="wa-gradient text-white text-sm font-semibold px-4 py-2 rounded-xl hover:opacity-90 transition-all"
        >
          Retry
        </button>
      </div>
    );
  }

  const stats = data?.stats;
  const firstName = data?.profile.name?.split(" ")[0] || "there";

  return (
    <div className="space-y-6 max-w-7xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Good morning, {firstName} 👋</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Here&apos;s what&apos;s happening with your campaigns today.
          </p>
        </div>
        <Link
          href="/campaigns/create"
          className="hidden sm:flex items-center gap-2 wa-gradient text-white text-sm font-semibold px-4 py-2.5 rounded-xl hover:opacity-90 transition-all shadow-lg shadow-primary/25"
        >
          <Megaphone className="w-4 h-4" />
          New Campaign
        </Link>
      </div>

      {/* Getting Started checklist */}
      {!checklistDismissed && (
        <div className="bg-card border border-border/50 rounded-2xl p-5 relative overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-r from-primary/5 via-transparent to-transparent pointer-events-none" />
          <div className="flex items-start justify-between mb-4">
            <div>
              <h3 className="font-semibold text-sm">
                {allDone ? "🎉 You're all set!" : "Getting Started"}
              </h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                {allDone
                  ? "You've completed the setup. Your workspace is ready."
                  : `${checklistProgress} of ${checklistTotal} steps completed`}
              </p>
            </div>
            <button
              onClick={dismissChecklist}
              className="text-muted-foreground hover:text-foreground transition-colors p-1 rounded-lg hover:bg-accent"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Progress bar */}
          <div className="h-1.5 bg-white/5 rounded-full mb-4 overflow-hidden">
            <div
              className="h-full wa-gradient rounded-full transition-all duration-500"
              style={{ width: `${(checklistProgress / checklistTotal) * 100}%` }}
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-2">
            {checklistItems.map((item) => {
              const done = checklistDone.includes(item.id);
              return (
                <Link
                  key={item.id}
                  href={item.href}
                  onClick={() => markDone(item.id)}
                  className={`flex items-center gap-2.5 p-3 rounded-xl border text-xs font-medium transition-all duration-200 ${
                    done
                      ? "border-primary/30 bg-primary/5 text-primary"
                      : "border-border/50 hover:border-primary/40 hover:bg-primary/5 text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition-colors ${
                    done ? "border-primary bg-primary" : "border-border"
                  }`}>
                    {done && <CheckCheck className="w-3 h-3 text-white" />}
                  </div>
                  <span className={done ? "line-through opacity-60" : ""}>{item.label}</span>
                </Link>
              );
            })}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <StatsCard
          title="Messages Sent"
          value={stats?.messagesSent.toLocaleString() || "0"}
          icon={MessageSquare}
          trend={stats?.messagesSentTrend}
          trendLabel="vs last week"
          iconColor="text-primary"
          iconBg="bg-primary/10"
        />
        <StatsCard
          title="Delivery Rate"
          value={stats?.deliveryRate.toFixed(1) || "0"}
          suffix="%"
          icon={CheckCircle2}
          trend={stats?.deliveryRateTrend}
          trendLabel="vs last week"
          iconColor="text-blue-400"
          iconBg="bg-blue-500/10"
        />
        <StatsCard
          title="Failed Messages"
          value={stats?.failedMessages.toLocaleString() || "0"}
          icon={XCircle}
          trend={stats?.failedMessagesTrend ? -stats.failedMessagesTrend : undefined}
          trendLabel="vs last week"
          iconColor="text-red-400"
          iconBg="bg-red-500/10"
        />
        <StatsCard
          title="Wallet Balance"
          value={stats?.walletBalance.toLocaleString() || "0"}
          prefix="₹"
          icon={Wallet}
          iconColor="text-amber-400"
          iconBg="bg-amber-500/10"
        >
          <div className="mt-2">
            <Link href="/billing" className="text-xs text-primary hover:underline font-medium">
              Recharge →
            </Link>
          </div>
        </StatsCard>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
        {quickActions.map((action) => (
          <Link
            key={action.label}
            href={action.href}
            className={`flex items-center gap-3 p-4 rounded-2xl bg-gradient-to-br border transition-all duration-200 hover:scale-[1.02] group ${action.color}`}
          >
            <div className="w-9 h-9 rounded-xl bg-white/5 flex items-center justify-center flex-shrink-0">
              <action.icon className="w-4.5 h-4.5 text-foreground" />
            </div>
            <span className="text-sm font-medium">{action.label}</span>
            <ArrowRight className="w-4 h-4 ml-auto text-muted-foreground group-hover:translate-x-0.5 transition-transform" />
          </Link>
        ))}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <div className="xl:col-span-2 bg-card rounded-2xl border border-border/50 p-6">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h3 className="font-semibold">Message Activity</h3>
              <p className="text-xs text-muted-foreground mt-0.5">Last 7 days</p>
            </div>
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground bg-muted/50 px-3 py-1.5 rounded-lg">
              <TrendingUp className="w-3.5 h-3.5 text-primary" />
              <span>{stats?.messagesSentTrend && stats.messagesSentTrend > 0 ? "+" : ""}{stats?.messagesSentTrend ?? 0}% this week</span>
            </div>
          </div>
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={data?.chartData || []} margin={{ top: 5, right: 5, bottom: 5, left: -20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
              <XAxis dataKey="date" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
              <Tooltip content={<CustomTooltip />} />
              <Legend wrapperStyle={{ fontSize: "11px", paddingTop: "16px" }} />
              <Line type="monotone" dataKey="sent" stroke="#25D366" strokeWidth={2.5} dot={false} activeDot={{ r: 4, fill: "#25D366" }} />
              <Line type="monotone" dataKey="delivered" stroke="#128C7E" strokeWidth={2} dot={false} activeDot={{ r: 4, fill: "#128C7E" }} strokeDasharray="5 3" />
              <Line type="monotone" dataKey="failed" stroke="#ef4444" strokeWidth={2} dot={false} activeDot={{ r: 4, fill: "#ef4444" }} />
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div className="bg-card rounded-2xl border border-border/50 p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold">Connected Numbers</h3>
            <Link href="/numbers" className="text-xs text-primary hover:underline">Manage →</Link>
          </div>
          <div className="space-y-3">
            {(data?.numbers || []).map((num) => (
              <div key={num.id} className="flex items-start gap-3 p-3 rounded-xl bg-muted/30 hover:bg-muted/50 transition-colors">
                <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <Smartphone className="w-4.5 h-4.5 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{num.phoneNumber}</p>
                  <p className="text-xs text-muted-foreground truncate">{num.displayName}</p>
                  <div className="flex items-center justify-between mt-1.5">
                    <StatusBadge status={num.status as "active" | "inactive"} />
                    <span className="text-xs text-muted-foreground">{num.messagesSent.toLocaleString()} sent</span>
                  </div>
                </div>
              </div>
            ))}
            {(data?.numbers || []).length === 0 && (
              <p className="text-xs text-muted-foreground text-center py-4">No numbers connected</p>
            )}
            <Link
              href="/numbers/connect"
              className="flex items-center justify-center gap-2 p-3 rounded-xl border border-dashed border-border/60 hover:border-primary/40 hover:bg-primary/5 transition-all text-sm text-muted-foreground hover:text-primary"
            >
              + Connect New Number
            </Link>
          </div>
        </div>
      </div>

      <div className="bg-card rounded-2xl border border-border/50 overflow-hidden">
        <div className="flex items-center justify-between p-6 border-b border-border/50">
          <div>
            <h3 className="font-semibold">Recent Campaigns</h3>
            <p className="text-xs text-muted-foreground mt-0.5">Your latest campaign activity</p>
          </div>
          <Link href="/campaigns" className="text-xs text-primary hover:underline">View all →</Link>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border/50">
                {["Campaign", "Status", "Recipients", "Delivered", "Failed", "Date"].map((h) => (
                  <th key={h} className="text-left text-xs font-medium text-muted-foreground px-6 py-3">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(data?.recentCampaigns || []).map((campaign) => (
                <tr key={campaign.id} className="border-b border-border/30 last:border-0 hover:bg-muted/20 transition-colors">
                  <td className="px-6 py-4">
                    <p className="text-sm font-medium">{campaign.name}</p>
                    <p className="text-xs text-muted-foreground">{campaign.templateName}</p>
                  </td>
                  <td className="px-6 py-4">
                    <StatusBadge status={campaign.status as Parameters<typeof StatusBadge>[0]["status"]} />
                  </td>
                  <td className="px-6 py-4 text-sm">{campaign.recipients.toLocaleString()}</td>
                  <td className="px-6 py-4 text-sm text-emerald-400">{campaign.delivered.toLocaleString()}</td>
                  <td className="px-6 py-4 text-sm text-red-400">{campaign.failed}</td>
                  <td className="px-6 py-4 text-sm text-muted-foreground">{formatDate(campaign.createdAt)}</td>
                </tr>
              ))}
              {(data?.recentCampaigns || []).length === 0 && (
                <tr>
                  <td colSpan={6} className="px-6 py-8 text-center text-sm text-muted-foreground">
                    No campaigns yet.{" "}
                    <Link href="/campaigns/create" className="text-primary hover:underline">Create one →</Link>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
