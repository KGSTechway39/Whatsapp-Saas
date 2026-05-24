"use client";

import { StatusBadge } from "@/components/shared/StatusBadge";
import { campaigns as campaignsApi } from "@/lib/api";
import { formatDate, formatDateTime } from "@/lib/utils";
import {
  ArrowLeft, Loader2, AlertCircle, Send, CheckCircle2,
  BookOpen, XCircle, MessageSquare, Download, Phone,
  Users, Calendar, Wallet, BarChart3,
} from "lucide-react";
import Link from "next/link";
import { useState, useEffect } from "react";
import { toast } from "sonner";
import { StatusType } from "@/types";
import {
  PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend,
  AreaChart, Area, XAxis, YAxis, CartesianGrid,
} from "recharts";

interface CampaignDetail {
  id: string;
  name: string;
  status: string;
  templateName: string;
  sendingNumber: string | null;
  sendingNumberName: string | null;
  audienceType: string;
  tags: string[];
  recipientsCount: number;
  sentCount: number;
  deliveredCount: number;
  failedCount: number;
  readCount: number;
  repliedCount: number;
  scheduledAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  cost: number;
  createdAt: string;
}

interface TimeSeries {
  hour: string;
  sent: number;
  delivered: number;
  read: number;
}

interface FailedMessage {
  id: string;
  phone: string;
  contactName: string;
  error: string;
  failedAt: string | null;
}

interface CostBreakdown {
  metaFee: number;
  platformFee: number;
  total: number;
}

const PIE_COLORS = {
  delivered: "#25D366",
  read: "#4ade80",
  failed: "#f87171",
  pending: "#64748b",
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function CustomTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-card border border-border rounded-xl px-3 py-2 shadow-lg text-xs">
      <p className="text-muted-foreground mb-1">{label}</p>
      {payload.map((entry: { name: string; value: number; color: string }) => (
        <p key={entry.name} style={{ color: entry.color }} className="font-medium">
          {entry.name}: {entry.value}
        </p>
      ))}
    </div>
  );
}

export default function CampaignDetailPage({ params }: { params: { id: string } }) {
  const [campaign, setCampaign] = useState<CampaignDetail | null>(null);
  const [timeSeries, setTimeSeries] = useState<TimeSeries[]>([]);
  const [failedMessages, setFailedMessages] = useState<FailedMessage[]>([]);
  const [costBreakdown, setCostBreakdown] = useState<CostBreakdown | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAllFailed, setShowAllFailed] = useState(false);

  useEffect(() => {
    campaignsApi.get(params.id)
      .then((data) => {
        setCampaign(data.campaign as unknown as CampaignDetail);
        setTimeSeries(data.timeSeries as TimeSeries[]);
        setFailedMessages(data.failedMessages as FailedMessage[]);
        setCostBreakdown(data.costBreakdown as unknown as CostBreakdown);
      })
      .catch((err: Error & { status?: number }) => {
        if (err.status === 404) setError("Campaign not found");
        else setError(err.message || "Failed to load campaign");
      })
      .finally(() => setLoading(false));
  }, [params.id]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-6 h-6 animate-spin text-primary" />
      </div>
    );
  }

  if (error || !campaign) {
    return (
      <div className="max-w-lg mx-auto text-center py-16">
        <div className="w-16 h-16 rounded-2xl bg-red-500/10 flex items-center justify-center mx-auto mb-4">
          <AlertCircle className="w-8 h-8 text-red-400" />
        </div>
        <h2 className="text-lg font-semibold mb-2">{error || "Campaign not found"}</h2>
        <Link href="/campaigns" className="text-sm text-primary hover:underline flex items-center justify-center gap-1.5">
          <ArrowLeft className="w-4 h-4" /> Back to Campaigns
        </Link>
      </div>
    );
  }

  const { sentCount, deliveredCount, failedCount, readCount, repliedCount, recipientsCount } = campaign;
  const deliveryRate = sentCount > 0 ? ((deliveredCount / sentCount) * 100).toFixed(1) : "0.0";
  const readRate = deliveredCount > 0 ? ((readCount / deliveredCount) * 100).toFixed(1) : "0.0";
  const failRate = sentCount > 0 ? ((failedCount / sentCount) * 100).toFixed(1) : "0.0";
  const audienceRate = recipientsCount > 0 ? ((sentCount / recipientsCount) * 100).toFixed(1) : "0.0";

  const pending = Math.max(0, recipientsCount - sentCount - failedCount);

  const pieData = [
    { name: "Delivered", value: deliveredCount, color: PIE_COLORS.delivered },
    { name: "Read", value: readCount, color: PIE_COLORS.read },
    { name: "Failed", value: failedCount, color: PIE_COLORS.failed },
    { name: "Pending", value: pending, color: PIE_COLORS.pending },
  ].filter((d) => d.value > 0);

  const formattedTimeSeries = timeSeries.map((t) => ({
    ...t,
    label: new Date(t.hour).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: false }),
  }));

  const visibleFailed = showAllFailed ? failedMessages : failedMessages.slice(0, 10);

  const costPerDelivered = deliveredCount > 0 && costBreakdown
    ? (costBreakdown.total / deliveredCount).toFixed(4)
    : null;

  return (
    <div className="max-w-6xl">
      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div className="flex items-start gap-4">
          <Link
            href="/campaigns"
            className="mt-1 p-2 rounded-xl border border-border hover:bg-accent transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
          </Link>
          <div>
            <div className="flex items-center gap-2.5 flex-wrap">
              <h1 className="text-xl font-bold">{campaign.name}</h1>
              <StatusBadge status={campaign.status as StatusType} />
            </div>
            <div className="flex items-center gap-3 mt-1 flex-wrap">
              {campaign.templateName && (
                <span className="text-xs text-muted-foreground flex items-center gap-1">
                  <MessageSquare className="w-3 h-3" /> {campaign.templateName}
                </span>
              )}
              {campaign.sendingNumber && (
                <span className="text-xs text-muted-foreground flex items-center gap-1">
                  <Phone className="w-3 h-3" /> {campaign.sendingNumber}
                </span>
              )}
              {campaign.createdAt && (
                <span className="text-xs text-muted-foreground flex items-center gap-1">
                  <Calendar className="w-3 h-3" /> {formatDate(campaign.createdAt)}
                </span>
              )}
            </div>
          </div>
        </div>
        <button
          onClick={() => toast.info("Export coming soon")}
          className="flex items-center gap-2 px-4 py-2 rounded-xl border border-border text-sm font-medium hover:bg-accent transition-colors"
        >
          <Download className="w-4 h-4" /> Export
        </button>
      </div>

      {/* Stats cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mb-6">
        {[
          {
            label: "Total Sent",
            value: sentCount.toLocaleString(),
            sub: `${audienceRate}% of audience`,
            icon: Send,
            color: "text-blue-400",
            bg: "bg-blue-500/10",
          },
          {
            label: "Delivered",
            value: deliveredCount.toLocaleString(),
            sub: `${deliveryRate}% delivery rate`,
            icon: CheckCircle2,
            color: "text-emerald-400",
            bg: "bg-emerald-500/10",
          },
          {
            label: "Read",
            value: readCount.toLocaleString(),
            sub: `${readRate}% read rate`,
            icon: BookOpen,
            color: "text-green-400",
            bg: "bg-green-500/10",
          },
          {
            label: "Failed",
            value: failedCount.toLocaleString(),
            sub: `${failRate}% fail rate`,
            icon: XCircle,
            color: failedCount > 0 ? "text-red-400" : "text-muted-foreground",
            bg: failedCount > 0 ? "bg-red-500/10" : "bg-muted/30",
          },
          {
            label: "Replied",
            value: repliedCount > 0 ? repliedCount.toLocaleString() : "N/A",
            sub: repliedCount > 0 ? `${((repliedCount / deliveredCount) * 100).toFixed(1)}% reply rate` : "Not tracked",
            icon: MessageSquare,
            color: repliedCount > 0 ? "text-violet-400" : "text-muted-foreground",
            bg: repliedCount > 0 ? "bg-violet-500/10" : "bg-muted/30",
          },
        ].map(({ label, value, sub, icon: Icon, color, bg }) => (
          <div key={label} className="bg-card border border-border/50 rounded-2xl p-4">
            <div className="flex items-center justify-between mb-3">
              <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">{label}</p>
              <div className={`w-8 h-8 rounded-xl ${bg} flex items-center justify-center`}>
                <Icon className={`w-4 h-4 ${color}`} />
              </div>
            </div>
            <p className="text-2xl font-bold mb-0.5">{value}</p>
            <p className="text-[11px] text-muted-foreground">{sub}</p>
          </div>
        ))}
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
        {/* Donut chart */}
        <div className="bg-card border border-border/50 rounded-2xl p-5">
          <div className="flex items-center gap-2 mb-4">
            <BarChart3 className="w-4 h-4 text-primary" />
            <h3 className="font-semibold text-sm">Message Distribution</h3>
          </div>
          {pieData.length > 0 ? (
            <>
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
                    {pieData.map((entry, index) => (
                      <Cell key={index} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: "12px", fontSize: "12px" }}
                    formatter={(value: number) => [value.toLocaleString(), ""]}
                  />
                </PieChart>
              </ResponsiveContainer>
              {/* Centered delivery rate */}
              <div className="text-center -mt-2 mb-3">
                <p className="text-2xl font-bold text-emerald-400">{deliveryRate}%</p>
                <p className="text-xs text-muted-foreground">Delivery Rate</p>
              </div>
              {/* Legend */}
              <div className="grid grid-cols-2 gap-2">
                {pieData.map((d) => (
                  <div key={d.name} className="flex items-center gap-2">
                    <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: d.color }} />
                    <span className="text-xs text-muted-foreground">{d.name}</span>
                    <span className="text-xs font-medium ml-auto">{d.value.toLocaleString()}</span>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className="h-48 flex items-center justify-center">
              <p className="text-sm text-muted-foreground">No data yet</p>
            </div>
          )}
        </div>

        {/* Area chart */}
        <div className="bg-card border border-border/50 rounded-2xl p-5">
          <div className="flex items-center gap-2 mb-4">
            <BarChart3 className="w-4 h-4 text-primary" />
            <h3 className="font-semibold text-sm">Delivery Timeline</h3>
          </div>
          {formattedTimeSeries.length > 0 ? (
            <ResponsiveContainer width="100%" height={240}>
              <AreaChart data={formattedTimeSeries} margin={{ top: 5, right: 10, left: -20, bottom: 5 }}>
                <defs>
                  <linearGradient id="deliveredGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#25D366" stopOpacity={0.2} />
                    <stop offset="95%" stopColor="#25D366" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="failedGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#f87171" stopOpacity={0.2} />
                    <stop offset="95%" stopColor="#f87171" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 10, fill: "#64748b" }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fontSize: 10, fill: "#64748b" }}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip content={<CustomTooltip />} />
                <Area
                  type="monotone"
                  dataKey="delivered"
                  stroke="#25D366"
                  strokeWidth={2}
                  fill="url(#deliveredGrad)"
                  name="Delivered"
                />
                <Area
                  type="monotone"
                  dataKey="failed"
                  stroke="#f87171"
                  strokeWidth={2}
                  fill="url(#failedGrad)"
                  name="Failed"
                />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-48 flex flex-col items-center justify-center gap-2">
              <BarChart3 className="w-8 h-8 text-muted-foreground/30" />
              <p className="text-sm text-muted-foreground">No timeline data available</p>
              <p className="text-xs text-muted-foreground">Data appears after messages are sent</p>
            </div>
          )}
        </div>
      </div>

      {/* Failed messages table */}
      {failedMessages.length > 0 && (
        <div className="bg-card border border-border/50 rounded-2xl p-5 mb-6">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <XCircle className="w-4 h-4 text-red-400" />
              <h3 className="font-semibold text-sm">Failed Messages ({failedMessages.length})</h3>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border/40">
                  {["Contact", "Phone", "Error Reason", "Failed At"].map((h) => (
                    <th key={h} className="text-left text-xs font-medium text-muted-foreground px-3 py-2.5 whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visibleFailed.map((msg) => (
                  <tr key={msg.id} className="border-b border-border/20 last:border-0 hover:bg-muted/10 transition-colors">
                    <td className="px-3 py-3 font-medium">{msg.contactName}</td>
                    <td className="px-3 py-3 text-muted-foreground">{msg.phone}</td>
                    <td className="px-3 py-3">
                      <span className="text-xs bg-red-500/10 text-red-400 px-2 py-0.5 rounded-lg line-clamp-1 max-w-xs block">
                        {msg.error}
                      </span>
                    </td>
                    <td className="px-3 py-3 text-muted-foreground text-xs whitespace-nowrap">
                      {msg.failedAt ? formatDateTime(msg.failedAt) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {failedMessages.length > 10 && (
            <button
              onClick={() => setShowAllFailed((p) => !p)}
              className="mt-3 text-xs text-primary hover:underline flex items-center gap-1.5 mx-auto"
            >
              {showAllFailed
                ? "Show less"
                : `Show all ${failedMessages.length} failed messages`}
            </button>
          )}
        </div>
      )}

      {/* Cost & Campaign Info */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Cost breakdown */}
        {costBreakdown && (
          <div className="bg-card border border-border/50 rounded-2xl p-5">
            <div className="flex items-center gap-2 mb-4">
              <Wallet className="w-4 h-4 text-amber-400" />
              <h3 className="font-semibold text-sm">Cost Summary</h3>
            </div>
            <div className="space-y-3">
              {[
                { label: "Meta fee", value: `₹${costBreakdown.metaFee.toFixed(2)}` },
                { label: "Platform fee", value: `₹${costBreakdown.platformFee.toFixed(2)}` },
              ].map(({ label, value }) => (
                <div key={label} className="flex justify-between text-sm">
                  <span className="text-muted-foreground">{label}</span>
                  <span className="font-medium">{value}</span>
                </div>
              ))}
              <div className="flex justify-between text-sm pt-3 border-t border-border/40">
                <span className="font-semibold">Total Spent</span>
                <span className="font-bold text-amber-400">₹{costBreakdown.total.toFixed(2)}</span>
              </div>
              {costPerDelivered && (
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Cost per delivered</span>
                  <span className="font-medium text-muted-foreground">₹{costPerDelivered}</span>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Campaign info */}
        <div className="bg-card border border-border/50 rounded-2xl p-5">
          <div className="flex items-center gap-2 mb-4">
            <Users className="w-4 h-4 text-primary" />
            <h3 className="font-semibold text-sm">Campaign Info</h3>
          </div>
          <div className="space-y-3">
            {[
              { label: "Total Recipients", value: recipientsCount.toLocaleString() },
              { label: "Audience Type", value: campaign.audienceType || "all" },
              { label: "Template", value: campaign.templateName || "—" },
              { label: "Sending Number", value: campaign.sendingNumber || "—" },
              { label: "Started", value: campaign.startedAt ? formatDateTime(campaign.startedAt) : "—" },
              { label: "Completed", value: campaign.completedAt ? formatDateTime(campaign.completedAt) : "—" },
            ].map(({ label, value }) => (
              <div key={label} className="flex justify-between text-sm">
                <span className="text-muted-foreground">{label}</span>
                <span className="font-medium text-right max-w-[55%] truncate">{value}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
