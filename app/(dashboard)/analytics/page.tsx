"use client";

import { StatsCard } from "@/components/shared/StatsCard";
import { analytics as analyticsApi } from "@/lib/api";
import { formatCurrency, calculatePercentage } from "@/lib/utils";
import { AnalyticsData } from "@/types";
import {
  MessageSquare, CheckCircle2, XCircle, Reply, Download,
} from "lucide-react";
import { StatsCardSkeleton, Skeleton } from "@/components/shared/Skeleton";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, PieChart, Pie, Cell, Legend,
  LineChart, Line,
} from "recharts";
import { useState, useEffect } from "react";
import { toast } from "sonner";

const ranges = ["Today", "7 Days", "30 Days", "Custom"];
const rangeDays: Record<string, number> = { "Today": 1, "7 Days": 7, "30 Days": 30, "Custom": 7 };

const PIE_COLORS = ["#25D366", "#ef4444", "#f59e0b"];

const CustomTooltip = ({ active, payload, label }: { active?: boolean; payload?: { value: number; name: string; color: string }[]; label?: string }) => {
  if (active && payload && payload.length) {
    return (
      <div className="bg-card border border-border rounded-xl p-3 shadow-xl text-xs">
        <p className="font-medium mb-2 text-muted-foreground">{label}</p>
        {payload.map((p, i) => (
          <div key={i} className="flex items-center gap-2 mt-1">
            <span className="w-2 h-2 rounded-full" style={{ background: p.color }} />
            <span className="text-muted-foreground capitalize">{p.name}:</span>
            <span className="font-semibold">{p.value}</span>
          </div>
        ))}
      </div>
    );
  }
  return null;
};

const emptyAnalytics: AnalyticsData = {
  totalSent: 0, totalDelivered: 0, totalFailed: 0, totalReplies: 0,
  deliveryRate: 0, failedRate: 0, chartData: [], campaignPerformance: [], numberBreakdown: [],
};

export default function AnalyticsPage() {
  const [activeRange, setActiveRange] = useState("7 Days");
  const [data, setData] = useState<AnalyticsData>(emptyAnalytics);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    analyticsApi.get(rangeDays[activeRange] || 7)
      .then(setData)
      .catch(() => toast.error("Failed to load analytics"))
      .finally(() => setLoading(false));
  }, [activeRange]);

  const pieData = [
    { name: "Delivered", value: data.totalDelivered },
    { name: "Failed", value: data.totalFailed },
    { name: "Pending", value: Math.max(0, data.totalSent - data.totalDelivered - data.totalFailed) },
  ];

  if (loading) return (
    <div className="max-w-7xl space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div className="space-y-2">
          <Skeleton className="h-7 w-32" />
          <Skeleton className="h-4 w-56" />
        </div>
        <Skeleton className="h-9 w-64 rounded-xl" />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        {[0,1,2,3].map(i => <StatsCardSkeleton key={i} />)}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Skeleton className="lg:col-span-2 h-[340px] rounded-2xl" />
        <Skeleton className="h-[340px] rounded-2xl" />
      </div>
      <Skeleton className="h-[260px] rounded-2xl" />
    </div>
  );

  return (
    <div className="max-w-7xl space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold">Analytics</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Track your messaging performance</p>
        </div>
        <div className="flex items-center gap-1.5 bg-muted/30 p-1 rounded-xl">
          {ranges.map((r) => (
            <button
              key={r}
              onClick={() => setActiveRange(r)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                activeRange === r
                  ? "bg-card shadow text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {r}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <StatsCard
          title="Total Sent"
          value={data.totalSent.toLocaleString()}
          icon={MessageSquare}
          trend={12.5}
          trendLabel="vs last period"
          iconColor="text-primary"
          iconBg="bg-primary/10"
        />
        <StatsCard
          title="Delivered"
          value={data.totalDelivered.toLocaleString()}
          icon={CheckCircle2}
          trend={data.deliveryRate}
          trendLabel="delivery rate"
          iconColor="text-emerald-400"
          iconBg="bg-emerald-500/10"
        />
        <StatsCard
          title="Failed"
          value={data.totalFailed.toLocaleString()}
          icon={XCircle}
          trend={-data.failedRate}
          trendLabel="failure rate"
          iconColor="text-red-400"
          iconBg="bg-red-500/10"
        />
        <StatsCard
          title="Replies Received"
          value={data.totalReplies.toLocaleString()}
          icon={Reply}
          trend={5.2}
          trendLabel="vs last period"
          iconColor="text-blue-400"
          iconBg="bg-blue-500/10"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 bg-card rounded-2xl border border-border/50 p-6">
          <h3 className="font-semibold mb-1">Daily Messages</h3>
          <p className="text-xs text-muted-foreground mb-5">Message volume over the last 7 days</p>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={data.chartData} margin={{ top: 5, right: 5, bottom: 5, left: -20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
              <XAxis dataKey="date" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
              <Tooltip content={<CustomTooltip />} />
              <Legend wrapperStyle={{ fontSize: "11px", paddingTop: "12px" }} />
              <Bar dataKey="sent" name="Sent" fill="#25D366" radius={[4, 4, 0, 0]} />
              <Bar dataKey="delivered" name="Delivered" fill="#128C7E" radius={[4, 4, 0, 0]} />
              <Bar dataKey="failed" name="Failed" fill="#ef4444" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="bg-card rounded-2xl border border-border/50 p-6">
          <h3 className="font-semibold mb-1">Delivery Status</h3>
          <p className="text-xs text-muted-foreground mb-4">Message distribution</p>
          <ResponsiveContainer width="100%" height={200}>
            <PieChart>
              <Pie
                data={pieData}
                cx="50%"
                cy="50%"
                innerRadius={55}
                outerRadius={80}
                paddingAngle={3}
                dataKey="value"
              >
                {pieData.map((_, index) => (
                  <Cell key={`cell-${index}`} fill={PIE_COLORS[index % PIE_COLORS.length]} />
                ))}
              </Pie>
              <Tooltip />
            </PieChart>
          </ResponsiveContainer>
          <div className="space-y-2 mt-2">
            {pieData.map((entry, i) => (
              <div key={entry.name} className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full" style={{ background: PIE_COLORS[i] }} />
                  <span className="text-muted-foreground">{entry.name}</span>
                </div>
                <span className="font-medium">{calculatePercentage(entry.value, data.totalSent)}%</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="bg-card rounded-2xl border border-border/50 p-6">
        <h3 className="font-semibold mb-1">Campaign Performance Trend</h3>
        <p className="text-xs text-muted-foreground mb-5">Daily sent vs delivered</p>
        <ResponsiveContainer width="100%" height={200}>
          <LineChart data={data.chartData} margin={{ top: 5, right: 5, bottom: 5, left: -20 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
            <XAxis dataKey="date" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
            <Tooltip content={<CustomTooltip />} />
            <Line type="monotone" dataKey="sent" stroke="#25D366" strokeWidth={2.5} dot={false} activeDot={{ r: 4 }} />
            <Line type="monotone" dataKey="delivered" stroke="#128C7E" strokeWidth={2} dot={false} strokeDasharray="5 3" activeDot={{ r: 4 }} />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div className="bg-card rounded-2xl border border-border/50 overflow-hidden">
        <div className="p-5 border-b border-border/50">
          <h3 className="font-semibold">Campaign Performance</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border/50 bg-muted/10">
                {["Campaign", "Sent", "Delivered", "Failed", "Read", "Cost"].map((h) => (
                  <th key={h} className="text-left text-xs font-medium text-muted-foreground px-5 py-3">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.campaignPerformance.map((camp) => (
                <tr key={camp.campaignId} className="border-b border-border/30 last:border-0 hover:bg-muted/20 transition-colors">
                  <td className="px-5 py-4 text-sm font-medium">{camp.name}</td>
                  <td className="px-5 py-4 text-sm">{camp.sent.toLocaleString()}</td>
                  <td className="px-5 py-4">
                    <div>
                      <span className="text-sm text-emerald-400">{camp.delivered.toLocaleString()}</span>
                      <span className="text-xs text-muted-foreground ml-1">({calculatePercentage(camp.delivered, camp.sent)}%)</span>
                    </div>
                  </td>
                  <td className="px-5 py-4 text-sm text-red-400">{camp.failed}</td>
                  <td className="px-5 py-4 text-sm">{camp.read.toLocaleString()}</td>
                  <td className="px-5 py-4 text-sm font-medium">{formatCurrency(camp.cost)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="bg-card rounded-2xl border border-border/50 overflow-hidden">
        <div className="p-5 border-b border-border/50">
          <h3 className="font-semibold">Per Number Breakdown</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border/50 bg-muted/10">
                {["Phone Number", "Sent", "Delivered", "Failed", "Delivery Rate"].map((h) => (
                  <th key={h} className="text-left text-xs font-medium text-muted-foreground px-5 py-3">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.numberBreakdown.map((num) => (
                <tr key={num.numberId} className="border-b border-border/30 last:border-0 hover:bg-muted/20 transition-colors">
                  <td className="px-5 py-4 text-sm font-medium">{num.phoneNumber}</td>
                  <td className="px-5 py-4 text-sm">{num.sent.toLocaleString()}</td>
                  <td className="px-5 py-4 text-sm text-emerald-400">{num.delivered.toLocaleString()}</td>
                  <td className="px-5 py-4 text-sm text-red-400">{num.failed}</td>
                  <td className="px-5 py-4">
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-1.5 bg-muted/50 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-primary rounded-full"
                          style={{ width: `${calculatePercentage(num.delivered, num.sent)}%` }}
                        />
                      </div>
                      <span className="text-xs font-medium text-emerald-400">
                        {calculatePercentage(num.delivered, num.sent)}%
                      </span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
