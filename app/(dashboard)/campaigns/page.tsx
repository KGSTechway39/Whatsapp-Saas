"use client";

import { PageHeader } from "@/components/shared/PageHeader";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { campaigns as campaignsApi } from "@/lib/api";
import { formatDate, formatCurrency, calculatePercentage } from "@/lib/utils";
import {
  Plus, BarChart3, Megaphone, Loader2, Send, Users, Clock,
  CheckCircle2, XCircle, TrendingUp, Zap, Target, Eye,
  RefreshCw, Copy, Trash2, ChevronRight, Filter,
} from "lucide-react";
import Link from "next/link";
import { useState, useEffect } from "react";
import { Campaign } from "@/types";
import { toast } from "sonner";

const STATUS_FILTERS = ["all", "draft", "scheduled", "running", "completed", "failed"] as const;
type StatusFilter = typeof STATUS_FILTERS[number];

const STATUS_META: Record<string, { color: string; bg: string; icon: React.ElementType }> = {
  draft:     { color: "text-slate-400",   bg: "bg-slate-500/10",   icon: Clock },
  scheduled: { color: "text-blue-400",    bg: "bg-blue-500/10",    icon: Clock },
  running:   { color: "text-amber-400",   bg: "bg-amber-500/10",   icon: RefreshCw },
  completed: { color: "text-emerald-400", bg: "bg-emerald-500/10", icon: CheckCircle2 },
  failed:    { color: "text-red-400",     bg: "bg-red-500/10",     icon: XCircle },
};

// ─── CRM pipeline stage options (for audience tagging) ────────────────────────
const CRM_STAGES = ["New Lead", "Qualified", "Contacted", "Interested", "Converted"];

// ─── Automation workflow suggestions tied to campaign events ──────────────────
const AUTOMATION_SUGGESTIONS = [
  { event: "After campaign delivered", recipe: "follow_up_seq", label: "Follow-up Sequence" },
  { event: "No reply after 48h",       recipe: "re_engage",     label: "Re-engagement" },
  { event: "Button clicked",           recipe: "keyword_help",  label: "Keyword Reply" },
];

export default function CampaignsPage() {
  const [allCampaigns, setAllCampaigns] = useState<Campaign[]>([]);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<"table" | "cards">("cards");

  useEffect(() => {
    campaignsApi.list()
      .then((data) => setAllCampaigns(data.campaigns))
      .catch(() => toast.error("Failed to load campaigns"))
      .finally(() => setLoading(false));
  }, []);

  const filtered = allCampaigns.filter(
    (c) => statusFilter === "all" || c.status === statusFilter
  );

  const totalSent      = allCampaigns.reduce((a, c) => a + c.sent, 0);
  const totalDelivered = allCampaigns.reduce((a, c) => a + c.delivered, 0);
  const totalFailed    = allCampaigns.reduce((a, c) => a + c.failed, 0);
  const totalCost      = allCampaigns.reduce((a, c) => a + c.cost, 0);
  const avgDelivery    = totalSent > 0 ? Math.round((totalDelivered / totalSent) * 100) : 0;

  const handleDelete = async (id: string) => {
    try {
      await campaignsApi.remove(id);
      setAllCampaigns((prev) => prev.filter((c) => c.id !== id));
      toast.success("Campaign deleted");
    } catch {
      toast.error("Failed to delete campaign");
    }
  };

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <Loader2 className="w-6 h-6 animate-spin text-primary" />
    </div>
  );

  return (
    <div className="max-w-7xl">
      <PageHeader
        title="Campaigns"
        subtitle="WhatsApp broadcast campaigns with CRM audience targeting"
        action={
          <div className="flex items-center gap-2">
            <Link
              href="/crm"
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl border border-border hover:bg-accent text-sm font-medium transition-colors"
            >
              <Target className="w-4 h-4" /> CRM Leads
            </Link>
            <Link
              href="/campaigns/create"
              className="flex items-center gap-2 wa-gradient text-white text-sm font-semibold px-4 py-2.5 rounded-xl hover:opacity-90 transition-all shadow-lg shadow-primary/25"
            >
              <Plus className="w-4 h-4" /> Create Campaign
            </Link>
          </div>
        }
      />

      {/* Stats row */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-6">
        {[
          { label: "Total Campaigns", value: allCampaigns.length.toString(),   icon: Megaphone,    color: "text-primary",        bg: "bg-primary/10" },
          { label: "Total Sent",      value: totalSent.toLocaleString(),        icon: Send,         color: "text-blue-400",       bg: "bg-blue-500/10" },
          { label: "Delivered",       value: totalDelivered.toLocaleString(),   icon: CheckCircle2, color: "text-emerald-400",    bg: "bg-emerald-500/10" },
          { label: "Delivery Rate",   value: `${avgDelivery}%`,                 icon: TrendingUp,   color: "text-violet-400",     bg: "bg-violet-500/10" },
          { label: "Total Spend",     value: totalCost > 0 ? formatCurrency(totalCost) : "₹0", icon: BarChart3, color: "text-amber-400", bg: "bg-amber-500/10" },
        ].map(({ label, value, icon: Icon, color, bg }) => (
          <div key={label} className="bg-card rounded-2xl border border-border/50 p-4 flex items-center gap-3">
            <div className={`w-9 h-9 rounded-xl ${bg} flex items-center justify-center flex-shrink-0`}>
              <Icon className={`w-4.5 h-4.5 ${color}`} />
            </div>
            <div>
              <p className="text-lg font-bold">{value}</p>
              <p className="text-[11px] text-muted-foreground">{label}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Automation integration strip */}
      <div className="bg-violet-500/5 border border-violet-500/20 rounded-2xl p-4 mb-5">
        <div className="flex items-center gap-2.5 mb-3">
          <Zap className="w-4 h-4 text-violet-400" />
          <p className="text-sm font-semibold text-violet-400">Link Campaign to Automation Workflows</p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          {AUTOMATION_SUGGESTIONS.map(({ event, recipe, label }) => (
            <Link
              key={recipe}
              href={`/automation/create?recipe=${recipe}`}
              className="flex items-center gap-2 bg-card border border-violet-500/20 px-3 py-2 rounded-xl hover:border-violet-500/40 transition-colors group"
            >
              <span className="text-xs text-muted-foreground">{event}</span>
              <ChevronRight className="w-3 h-3 text-muted-foreground" />
              <span className="text-xs font-medium text-violet-400 group-hover:underline">{label}</span>
            </Link>
          ))}
          <Link href="/automation" className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 ml-auto">
            All automations <ChevronRight className="w-3 h-3" />
          </Link>
        </div>
      </div>

      {/* Filters + view toggle */}
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <div className="flex items-center gap-1.5 overflow-x-auto flex-1">
          <Filter className="w-4 h-4 text-muted-foreground flex-shrink-0" />
          {STATUS_FILTERS.map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={`flex-shrink-0 px-3 py-1.5 rounded-xl text-xs font-medium capitalize transition-all ${
                statusFilter === s
                  ? "bg-primary/20 text-primary border border-primary/30"
                  : "bg-muted/50 text-muted-foreground hover:text-foreground hover:bg-muted"
              }`}
            >
              {s === "all" ? "All" : s}
              {s !== "all" && (
                <span className="ml-1 opacity-60">({allCampaigns.filter((c) => c.status === s).length})</span>
              )}
            </button>
          ))}
        </div>
        <div className="flex gap-1 bg-muted/30 p-1 rounded-lg">
          {(["cards","table"] as const).map((v) => (
            <button key={v} onClick={() => setView(v)} className={`px-3 py-1 rounded text-xs font-medium capitalize transition-all ${view === v ? "bg-card shadow text-foreground" : "text-muted-foreground"}`}>{v}</button>
          ))}
        </div>
      </div>

      {/* ── Cards view ── */}
      {view === "cards" && (
        filtered.length === 0 ? (
          <div className="bg-card rounded-2xl border border-border/50 p-16 text-center">
            <Megaphone className="w-12 h-12 text-muted-foreground/40 mx-auto mb-3" />
            <p className="font-medium text-muted-foreground">No campaigns found</p>
            <Link href="/campaigns/create" className="mt-4 inline-flex items-center gap-2 wa-gradient text-white text-sm font-semibold px-5 py-2.5 rounded-xl hover:opacity-90 transition-all">
              <Plus className="w-4 h-4" /> Create First Campaign
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {filtered.map((campaign) => {
              const meta = STATUS_META[campaign.status] || STATUS_META.draft;
              const deliveryRate = calculatePercentage(campaign.delivered, campaign.sent);
              const readRate = calculatePercentage(campaign.read, campaign.delivered);
              const SIcon = meta.icon;
              return (
                <div key={campaign.id} className="bg-card border border-border/50 rounded-2xl p-5 hover:border-border transition-all flex flex-col">
                  {/* Header */}
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center gap-2.5">
                      <div className={`w-9 h-9 rounded-xl ${meta.bg} flex items-center justify-center border border-border/30`}>
                        <Megaphone className={`w-4.5 h-4.5 ${meta.color}`} />
                      </div>
                      <div>
                        <p className="text-sm font-semibold leading-tight">{campaign.name}</p>
                        <p className="text-[11px] text-muted-foreground">{campaign.templateName || "No template"}</p>
                      </div>
                    </div>
                    <StatusBadge status={campaign.status} />
                  </div>

                  {/* Stats grid */}
                  <div className="grid grid-cols-3 gap-2 mb-3">
                    {[
                      { label: "Recipients", value: campaign.recipients.toLocaleString(), color: "text-foreground" },
                      { label: "Delivered",  value: `${deliveryRate}%`,                   color: "text-emerald-400" },
                      { label: "Failed",     value: campaign.failed.toLocaleString(),     color: campaign.failed > 0 ? "text-red-400" : "text-muted-foreground" },
                    ].map(({ label, value, color }) => (
                      <div key={label} className="text-center p-2 bg-muted/20 rounded-xl">
                        <p className={`text-sm font-bold ${color}`}>{value}</p>
                        <p className="text-[10px] text-muted-foreground">{label}</p>
                      </div>
                    ))}
                  </div>

                  {/* Delivery progress bar */}
                  {campaign.sent > 0 && (
                    <div className="mb-3">
                      <div className="flex items-center justify-between text-[11px] text-muted-foreground mb-1">
                        <span>Delivery rate</span>
                        <span className="text-emerald-400 font-medium">{deliveryRate}%</span>
                      </div>
                      <div className="h-1.5 bg-muted/30 rounded-full overflow-hidden">
                        <div className="h-full bg-emerald-500 rounded-full transition-all" style={{ width: `${deliveryRate}%` }} />
                      </div>
                    </div>
                  )}

                  {/* Meta */}
                  <div className="flex items-center gap-1.5 mb-3 flex-wrap">
                    <span className="flex items-center gap-1 text-[10px] text-muted-foreground bg-muted/30 px-2 py-0.5 rounded-full">
                      <Users className="w-3 h-3" /> {campaign.recipients} contacts
                    </span>
                    {campaign.cost > 0 && (
                      <span className="text-[10px] text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded-full">
                        {formatCurrency(campaign.cost)}
                      </span>
                    )}
                    {campaign.scheduledAt && (
                      <span className="flex items-center gap-1 text-[10px] text-muted-foreground bg-muted/30 px-2 py-0.5 rounded-full">
                        <Clock className="w-3 h-3" /> {formatDate(campaign.scheduledAt)}
                      </span>
                    )}
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-2 pt-3 border-t border-border/30 mt-auto">
                    <Link
                      href={`/campaigns/${campaign.id}`}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-xs font-medium hover:bg-accent transition-colors"
                    >
                      <BarChart3 className="w-3.5 h-3.5" /> Report
                    </Link>
                    <Link
                      href={`/automation/create?recipe=re_engage`}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-violet-500/30 bg-violet-500/5 text-violet-400 text-xs font-medium hover:bg-violet-500/10 transition-colors"
                    >
                      <Zap className="w-3.5 h-3.5" /> Automate
                    </Link>
                    <button
                      onClick={() => handleDelete(campaign.id)}
                      className="ml-auto p-1.5 rounded-lg hover:bg-red-500/10 transition-colors"
                    >
                      <Trash2 className="w-3.5 h-3.5 text-red-400" />
                    </button>
                  </div>
                </div>
              );
            })}

            {/* Create new card */}
            <Link
              href="/campaigns/create"
              className="flex flex-col items-center justify-center gap-3 p-8 rounded-2xl border-2 border-dashed border-border/50 hover:border-primary/40 hover:bg-primary/5 transition-all text-center group min-h-[200px]"
            >
              <div className="w-12 h-12 rounded-2xl bg-muted/50 group-hover:bg-primary/10 flex items-center justify-center transition-colors">
                <Plus className="w-6 h-6 text-muted-foreground group-hover:text-primary transition-colors" />
              </div>
              <div>
                <p className="font-medium text-sm group-hover:text-primary transition-colors">New Campaign</p>
                <p className="text-xs text-muted-foreground mt-0.5">Target CRM leads or groups</p>
              </div>
            </Link>
          </div>
        )
      )}

      {/* ── Table view ── */}
      {view === "table" && (
        <div className="bg-card rounded-2xl border border-border/50 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border/50 bg-muted/10">
                  {["Campaign","Status","Recipients","Delivered","Failed","Read","Scheduled","Cost","Actions"].map((h) => (
                    <th key={h} className="text-left text-xs font-medium text-muted-foreground px-4 py-3.5 whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="text-center py-16">
                      <Megaphone className="w-10 h-10 text-muted-foreground/30 mx-auto mb-2" />
                      <p className="text-sm text-muted-foreground">No campaigns found</p>
                    </td>
                  </tr>
                ) : filtered.map((campaign) => {
                  const deliveryRate = calculatePercentage(campaign.delivered, campaign.sent);
                  return (
                    <tr key={campaign.id} className="border-b border-border/30 last:border-0 hover:bg-muted/20 transition-colors">
                      <td className="px-4 py-4">
                        <p className="text-sm font-medium">{campaign.name}</p>
                        <p className="text-xs text-muted-foreground">{campaign.templateName}</p>
                      </td>
                      <td className="px-4 py-4"><StatusBadge status={campaign.status} /></td>
                      <td className="px-4 py-4 text-sm">{campaign.recipients.toLocaleString()}</td>
                      <td className="px-4 py-4">
                        <p className="text-sm text-emerald-400">{campaign.delivered.toLocaleString()}</p>
                        {campaign.sent > 0 && <p className="text-[10px] text-muted-foreground">{deliveryRate}%</p>}
                      </td>
                      <td className="px-4 py-4 text-sm text-red-400">{campaign.failed}</td>
                      <td className="px-4 py-4 text-sm text-blue-400">{campaign.read || "—"}</td>
                      <td className="px-4 py-4 text-sm text-muted-foreground">
                        {campaign.scheduledAt ? formatDate(campaign.scheduledAt) : "—"}
                      </td>
                      <td className="px-4 py-4 text-sm">{campaign.cost > 0 ? formatCurrency(campaign.cost) : "—"}</td>
                      <td className="px-4 py-4">
                        <div className="flex items-center gap-1">
                          <Link href={`/campaigns/${campaign.id}`} className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-muted/50 text-xs font-medium hover:bg-accent transition-colors">
                            <BarChart3 className="w-3 h-3" /> Report
                          </Link>
                          <Link href="/automation/create?recipe=re_engage" className="p-1.5 rounded-lg hover:bg-violet-500/10 transition-colors" title="Link Automation">
                            <Zap className="w-3.5 h-3.5 text-violet-400" />
                          </Link>
                          <button onClick={() => handleDelete(campaign.id)} className="p-1.5 rounded-lg hover:bg-red-500/10 transition-colors">
                            <Trash2 className="w-3.5 h-3.5 text-red-400" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
