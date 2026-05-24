"use client";

import { PageHeader } from "@/components/shared/PageHeader";
import { automations as automationsApi } from "@/lib/api";
import { formatDate } from "@/lib/utils";
import { Automation } from "@/types";
import {
  Plus, Trash2, Zap, Clock, MessageSquare, Tag, Users, ArrowRight,
  Play, Pause, Sparkles, ChevronRight, Gift, UserCheck, Globe,
  Bell, Calendar, CreditCard, ShoppingCart, Repeat,
  GitBranch, ToggleLeft, ToggleRight, BarChart3, Pencil,
} from "lucide-react";
import Link from "next/link";
import { useState, useEffect } from "react";
import { toast } from "sonner";

// ─── Visual flows types ───────────────────────────────────────────────────────
interface AutomationFlow {
  id: string;
  name: string;
  description: string | null;
  is_active: boolean;
  trigger_type: string;
  trigger_count: number;
  last_triggered: string | null;
  created_at: string;
  updated_at: string;
}

const FLOW_TRIGGER_META: Record<string, { label: string; icon: React.ElementType; color: string; bg: string }> = {
  keyword:       { label: "Keyword Match",    icon: MessageSquare, color: "text-violet-400",  bg: "bg-violet-500/10 border-violet-500/20" },
  new_contact:   { label: "New Contact",      icon: UserCheck,     color: "text-blue-400",    bg: "bg-blue-500/10 border-blue-500/20"   },
  webhook:       { label: "Webhook",          icon: Globe,         color: "text-slate-400",   bg: "bg-slate-500/10 border-slate-500/20"  },
  schedule:      { label: "Schedule",         icon: Calendar,      color: "text-cyan-400",    bg: "bg-cyan-500/10 border-cyan-500/20"    },
  contact_tagged:{ label: "Contact Tagged",   icon: Tag,           color: "text-pink-400",    bg: "bg-pink-500/10 border-pink-500/20"    },
  opt_in:        { label: "Contact Opt-in",   icon: Bell,          color: "text-teal-400",    bg: "bg-teal-500/10 border-teal-500/20"    },
};

// ─── Trigger & action meta ─────────────────────────────────────────────────────
const TRIGGER_META: Record<string, { label: string; icon: React.ElementType; color: string; bg: string }> = {
  new_contact:    { label: "New Contact Added",     icon: UserCheck,    color: "text-blue-400",    bg: "bg-blue-500/10 border-blue-500/20" },
  keyword:        { label: "Keyword Received",       icon: MessageSquare,color: "text-violet-400",  bg: "bg-violet-500/10 border-violet-500/20" },
  button_click:   { label: "Button / Quick Reply",   icon: Zap,          color: "text-amber-400",   bg: "bg-amber-500/10 border-amber-500/20" },
  inactivity:     { label: "Contact Inactivity",     icon: Clock,        color: "text-orange-400",  bg: "bg-orange-500/10 border-orange-500/20" },
  date_based:     { label: "Scheduled Date & Time",  icon: Calendar,     color: "text-cyan-400",    bg: "bg-cyan-500/10 border-cyan-500/20" },
  birthday:       { label: "Birthday / Anniversary", icon: Gift,         color: "text-pink-400",    bg: "bg-pink-500/10 border-pink-500/20" },
  tag_applied:    { label: "Tag Applied",            icon: Tag,          color: "text-emerald-400", bg: "bg-emerald-500/10 border-emerald-500/20" },
  payment:        { label: "Payment Received",       icon: CreditCard,   color: "text-green-400",   bg: "bg-green-500/10 border-green-500/20" },
  order_placed:   { label: "Order Placed",           icon: ShoppingCart, color: "text-indigo-400",  bg: "bg-indigo-500/10 border-indigo-500/20" },
  opt_in:         { label: "Contact Opt-in",         icon: Bell,         color: "text-teal-400",    bg: "bg-teal-500/10 border-teal-500/20" },
  webhook:        { label: "Incoming Webhook",       icon: Globe,        color: "text-slate-400",   bg: "bg-slate-500/10 border-slate-500/20" },
};

const ACTION_META: Record<string, { label: string; icon: React.ElementType; color: string }> = {
  send_template:    { label: "Send Template",        icon: MessageSquare, color: "text-emerald-400" },
  send_text:        { label: "Send Text Message",    icon: MessageSquare, color: "text-emerald-400" },
  add_to_group:     { label: "Add to Group",         icon: Users,         color: "text-blue-400" },
  remove_from_group:{ label: "Remove from Group",    icon: Users,         color: "text-red-400" },
  apply_tag:        { label: "Apply Tag",            icon: Tag,           color: "text-violet-400" },
  remove_tag:       { label: "Remove Tag",           icon: Tag,           color: "text-orange-400" },
  wait_then_send:   { label: "Wait then Send",       icon: Clock,         color: "text-amber-400" },
  follow_up_seq:    { label: "Follow-up Sequence",   icon: Repeat,        color: "text-cyan-400" },
  send_webhook:     { label: "Send to Webhook",      icon: Globe,         color: "text-slate-400" },
};

// ─── Pre-built recipe templates ────────────────────────────────────────────────
const RECIPES = [
  {
    id: "welcome",
    title: "Welcome New Contacts",
    desc: "Send a warm welcome message the moment someone is added to your list.",
    trigger: "new_contact",
    action: "send_template",
    category: "Engagement",
    popular: true,
  },
  {
    id: "otp_confirm",
    title: "OTP / Verification Flow",
    desc: "Instantly send an OTP or verification code when a contact opts in.",
    trigger: "opt_in",
    action: "send_template",
    category: "Authentication",
    popular: true,
  },
  {
    id: "order_confirm",
    title: "Order Confirmation",
    desc: "Notify customers immediately after an order is placed.",
    trigger: "order_placed",
    action: "send_template",
    category: "E-commerce",
    popular: true,
  },
  {
    id: "payment_receipt",
    title: "Payment Receipt",
    desc: "Send an automated receipt as soon as payment is received.",
    trigger: "payment",
    action: "send_template",
    category: "E-commerce",
    popular: false,
  },
  {
    id: "keyword_help",
    title: "Keyword Auto-Reply",
    desc: "Auto-reply when a customer sends a specific keyword like HELP or PRICE.",
    trigger: "keyword",
    action: "send_template",
    category: "Support",
    popular: true,
  },
  {
    id: "birthday_wish",
    title: "Birthday Greetings",
    desc: "Automatically wish contacts on their birthday with a special offer.",
    trigger: "birthday",
    action: "send_template",
    category: "Engagement",
    popular: false,
  },
  {
    id: "re_engage",
    title: "Re-engage Inactive Contacts",
    desc: "Send a win-back message to contacts who haven't interacted in 30 days.",
    trigger: "inactivity",
    action: "wait_then_send",
    category: "Retention",
    popular: true,
  },
  {
    id: "vip_tag",
    title: "VIP Tag Auto-label",
    desc: "Auto-add contacts to the VIP group when a tag is applied.",
    trigger: "tag_applied",
    action: "add_to_group",
    category: "Segmentation",
    popular: false,
  },
];

const RECIPE_CATEGORY_COLORS: Record<string, string> = {
  Engagement:     "bg-blue-500/10 text-blue-400",
  Authentication: "bg-amber-500/10 text-amber-400",
  "E-commerce":   "bg-emerald-500/10 text-emerald-400",
  Support:        "bg-violet-500/10 text-violet-400",
  Retention:      "bg-orange-500/10 text-orange-400",
  Segmentation:   "bg-pink-500/10 text-pink-400",
};

export default function AutomationPage() {
  const [automationList, setAutomationList] = useState<Automation[]>([]);
  const [flows, setFlows] = useState<AutomationFlow[]>([]);
  const [tab, setTab] = useState<"flows" | "automations" | "recipes">("flows");

  useEffect(() => {
    automationsApi.list()
      .then((data) => setAutomationList(data.automations))
      .catch(() => {});
    fetch("/api/automation-flows")
      .then((r) => r.json())
      .then((d) => setFlows(d.flows || []))
      .catch(() => {});
  }, []);

  const toggleFlowActive = async (id: string) => {
    const flow = flows.find((f) => f.id === id);
    if (!flow) return;
    const next = !flow.is_active;
    setFlows((prev) => prev.map((f) => f.id === id ? { ...f, is_active: next } : f));
    await fetch(`/api/automation-flows/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ is_active: next }),
    }).catch(() => {});
    toast.success(next ? "Flow activated" : "Flow paused");
  };

  const deleteFlow = async (id: string) => {
    if (!confirm("Delete this flow? This cannot be undone.")) return;
    await fetch(`/api/automation-flows/${id}`, { method: "DELETE" }).catch(() => {});
    setFlows((prev) => prev.filter((f) => f.id !== id));
    toast.success("Flow deleted");
  };

  const toggleActive = async (id: string) => {
    const auto = automationList.find((a) => a.id === id);
    if (!auto) return;
    const newActive = !auto.isActive;
    setAutomationList((prev) => prev.map((a) => a.id === id ? { ...a, isActive: newActive } : a));
    try {
      await automationsApi.update(id, { isActive: newActive });
      toast.success(`${auto.name} ${newActive ? "activated" : "paused"}`);
    } catch {
      setAutomationList((prev) => prev.map((a) => a.id === id ? { ...a, isActive: !newActive } : a));
      toast.error("Failed to update automation");
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await automationsApi.remove(id);
      setAutomationList((prev) => prev.filter((a) => a.id !== id));
      toast.success("Automation deleted");
    } catch {
      toast.error("Failed to delete automation");
    }
  };

  const activeCount = automationList.filter((a) => a.isActive).length;
  const activeFlows = flows.filter((f) => f.is_active).length;
  const totalTriggers = flows.reduce((sum, f) => sum + (f.trigger_count || 0), 0);

  return (
    <div className="max-w-6xl">
      <PageHeader
        title="Automation"
        subtitle="Automate your WhatsApp messaging workflows — set it once, run forever"
        action={
          <Link
            href="/automation/create"
            className="flex items-center gap-2 wa-gradient text-white text-sm font-semibold px-4 py-2.5 rounded-xl hover:opacity-90 transition-all shadow-lg shadow-primary/25"
          >
            <Plus className="w-4 h-4" /> New Flow
          </Link>
        }
      />

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        {[
          { label: "Visual Flows",     value: flows.length,   icon: GitBranch, color: "text-primary",      bg: "bg-primary/10"        },
          { label: "Active Flows",     value: activeFlows,    icon: Play,      color: "text-emerald-400",  bg: "bg-emerald-500/10"    },
          { label: "Total Triggered",  value: totalTriggers,  icon: BarChart3, color: "text-violet-400",   bg: "bg-violet-500/10"     },
          { label: "Simple Rules",     value: automationList.length, icon: Zap, color: "text-amber-400",  bg: "bg-amber-500/10"      },
        ].map(({ label, value, icon: Icon, color, bg }) => (
          <div key={label} className="bg-card rounded-2xl border border-border/50 p-4 flex items-center gap-3">
            <div className={`w-10 h-10 rounded-xl ${bg} flex items-center justify-center flex-shrink-0`}>
              <Icon className={`w-5 h-5 ${color}`} />
            </div>
            <div>
              <p className="text-2xl font-bold">{value}</p>
              <p className="text-xs text-muted-foreground">{label}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-muted/30 p-1 rounded-xl w-fit mb-6">
        {[
          { id: "flows",        label: `Visual Flows (${flows.length})` },
          { id: "automations",  label: `Simple Rules (${automationList.length})` },
          { id: "recipes",      label: `Recipes (${RECIPES.length})` },
        ].map(({ id, label }) => (
          <button
            key={id}
            onClick={() => setTab(id as typeof tab)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
              tab === id ? "bg-card shadow text-foreground" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* ── Visual Flows ── */}
      {tab === "flows" && (
        <div className="space-y-4">
          {flows.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mb-4">
                <GitBranch className="w-8 h-8 text-primary" />
              </div>
              <p className="font-semibold mb-1">No visual flows yet</p>
              <p className="text-sm text-muted-foreground mb-6">Build powerful multi-step automation flows with the visual editor</p>
              <Link
                href="/automation/create"
                className="flex items-center gap-2 wa-gradient text-white text-sm font-semibold px-5 py-2.5 rounded-xl hover:opacity-90 transition-all shadow-lg shadow-primary/25"
              >
                <Plus className="w-4 h-4" /> Build Your First Flow
              </Link>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {flows.map((flow) => {
                const meta = FLOW_TRIGGER_META[flow.trigger_type] || FLOW_TRIGGER_META.keyword;
                const TIcon = meta.icon;
                return (
                  <div
                    key={flow.id}
                    className={`bg-card rounded-2xl border p-5 flex flex-col transition-all hover:border-border ${
                      flow.is_active ? "border-border/50" : "border-border/20 opacity-60"
                    }`}
                  >
                    {/* Header */}
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className={`w-9 h-9 rounded-xl flex items-center justify-center border flex-shrink-0 ${meta.bg}`}>
                          <TIcon className={`w-4 h-4 ${meta.color}`} />
                        </div>
                        <div className="min-w-0">
                          <p className="font-semibold text-sm truncate leading-tight">{flow.name}</p>
                          {flow.description && (
                            <p className="text-[11px] text-muted-foreground truncate mt-0.5">{flow.description}</p>
                          )}
                        </div>
                      </div>
                      <button
                        onClick={() => toggleFlowActive(flow.id)}
                        className={`flex-shrink-0 ml-2 ${flow.is_active ? "text-emerald-400" : "text-muted-foreground"}`}
                        title={flow.is_active ? "Pause flow" : "Activate flow"}
                      >
                        {flow.is_active
                          ? <ToggleRight className="w-6 h-6" />
                          : <ToggleLeft className="w-6 h-6" />}
                      </button>
                    </div>

                    {/* Trigger badge */}
                    <div className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-medium w-fit mb-4 ${meta.bg} ${meta.color}`}>
                      <TIcon className="w-3 h-3" />
                      {meta.label}
                    </div>

                    {/* Stats row */}
                    <div className="grid grid-cols-2 gap-2 mb-4">
                      <div className="bg-muted/20 rounded-lg p-2.5 text-center">
                        <p className="text-base font-bold">{flow.trigger_count || 0}</p>
                        <p className="text-[11px] text-muted-foreground">Total Triggered</p>
                      </div>
                      <div className="bg-muted/20 rounded-lg p-2.5 text-center">
                        <p className={`text-xs font-semibold px-2 py-0.5 rounded-full inline-block ${
                          flow.is_active ? "bg-emerald-500/15 text-emerald-400" : "bg-muted text-muted-foreground"
                        }`}>
                          {flow.is_active ? "● Active" : "⏸ Paused"}
                        </p>
                        <p className="text-[11px] text-muted-foreground mt-1">Status</p>
                      </div>
                    </div>

                    <p className="text-[11px] text-muted-foreground mb-4">
                      {flow.last_triggered
                        ? `Last triggered: ${formatDate(flow.last_triggered)}`
                        : "Never triggered"}
                    </p>

                    {/* Actions */}
                    <div className="flex items-center gap-2 pt-3 border-t border-border/30 mt-auto">
                      <Link
                        href={`/automation/create?id=${flow.id}`}
                        className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg border border-border hover:bg-accent text-xs font-medium transition-colors"
                      >
                        <Pencil className="w-3.5 h-3.5" /> Edit Flow
                      </Link>
                      <button
                        onClick={() => deleteFlow(flow.id)}
                        className="p-2 rounded-lg hover:bg-red-500/10 transition-colors border border-border/50"
                      >
                        <Trash2 className="w-3.5 h-3.5 text-red-400" />
                      </button>
                    </div>
                  </div>
                );
              })}

              {/* Create new card */}
              <Link
                href="/automation/create"
                className="flex flex-col items-center justify-center gap-3 p-8 rounded-2xl border-2 border-dashed border-border/50 hover:border-primary/40 hover:bg-primary/5 transition-all text-center group min-h-[240px]"
              >
                <div className="w-12 h-12 rounded-2xl bg-muted/50 group-hover:bg-primary/10 flex items-center justify-center transition-colors">
                  <Plus className="w-6 h-6 text-muted-foreground group-hover:text-primary transition-colors" />
                </div>
                <div>
                  <p className="font-medium text-sm group-hover:text-primary transition-colors">New Visual Flow</p>
                  <p className="text-xs text-muted-foreground mt-0.5">Build with drag & drop editor</p>
                </div>
              </Link>
            </div>
          )}
        </div>
      )}

      {/* ── My Automations ── */}
      {tab === "automations" && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {automationList.map((auto) => {
            const triggerMeta = TRIGGER_META[auto.trigger.type] || TRIGGER_META.new_contact;
            const actionMeta  = ACTION_META[auto.action.type]   || ACTION_META.send_template;
            const TIcon = triggerMeta.icon;
            const AIcon = actionMeta.icon;
            return (
              <div
                key={auto.id}
                className={`bg-card rounded-2xl border p-5 hover:border-border transition-all flex flex-col ${
                  auto.isActive ? "border-border/50" : "border-border/20 opacity-60"
                }`}
              >
                {/* Header */}
                <div className="flex items-start justify-between mb-4">
                  <div className="flex items-center gap-2.5">
                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center border ${triggerMeta.bg}`}>
                      <TIcon className={`w-5 h-5 ${triggerMeta.color}`} />
                    </div>
                    <div>
                      <p className="font-semibold text-sm leading-tight">{auto.name}</p>
                      <p className="text-[11px] text-muted-foreground">
                        {auto.lastTriggered ? `Last run: ${formatDate(auto.lastTriggered)}` : "Never triggered"}
                      </p>
                    </div>
                  </div>
                  {/* Toggle */}
                  <button
                    onClick={() => toggleActive(auto.id)}
                    title={auto.isActive ? "Pause" : "Activate"}
                    className={`relative w-11 h-6 rounded-full transition-all duration-300 flex-shrink-0 ${
                      auto.isActive ? "bg-primary" : "bg-muted"
                    }`}
                  >
                    <span className={`absolute top-1 w-4 h-4 rounded-full bg-white shadow transition-all duration-300 ${
                      auto.isActive ? "left-6" : "left-1"
                    }`} />
                  </button>
                </div>

                {/* Flow */}
                <div className="flex-1 space-y-2 mb-4">
                  <div className={`flex items-center gap-2.5 p-3 rounded-xl border ${triggerMeta.bg}`}>
                    <TIcon className={`w-3.5 h-3.5 flex-shrink-0 ${triggerMeta.color}`} />
                    <div className="min-w-0">
                      <p className={`text-[11px] font-semibold uppercase tracking-wide ${triggerMeta.color}`}>Trigger</p>
                      <p className="text-xs font-medium truncate">{triggerMeta.label}</p>
                      {auto.trigger.value && (
                        <p className="text-[11px] text-muted-foreground truncate">"{auto.trigger.value}"</p>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center justify-center gap-1">
                    <div className="h-px flex-1 bg-border/50" />
                    <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />
                    <div className="h-px flex-1 bg-border/50" />
                  </div>

                  <div className="flex items-center gap-2.5 p-3 rounded-xl border bg-emerald-500/5 border-emerald-500/20">
                    <AIcon className={`w-3.5 h-3.5 flex-shrink-0 ${actionMeta.color}`} />
                    <div className="min-w-0">
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-emerald-400">Action</p>
                      <p className="text-xs font-medium truncate">{actionMeta.label}</p>
                      {(auto.action as { delayHours?: number }).delayHours != null && (
                        <p className="text-[11px] text-muted-foreground">After {(auto.action as { delayHours?: number }).delayHours}h</p>
                      )}
                    </div>
                  </div>
                </div>

                {/* Footer */}
                <div className="flex items-center gap-2 pt-3 border-t border-border/30">
                  <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${
                    auto.isActive ? "bg-emerald-500/10 text-emerald-400" : "bg-muted/50 text-muted-foreground"
                  }`}>
                    {auto.isActive ? "● Active" : "⏸ Paused"}
                  </span>
                  <div className="flex items-center gap-1 ml-auto">
                    <Link
                      href="/automation/create"
                      className="text-xs px-3 py-1.5 rounded-lg border border-border hover:bg-accent transition-colors font-medium"
                    >
                      Edit
                    </Link>
                    <button
                      onClick={() => handleDelete(auto.id)}
                      className="p-1.5 rounded-lg hover:bg-red-500/10 transition-colors"
                    >
                      <Trash2 className="w-3.5 h-3.5 text-red-400" />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}

          {/* Add new card */}
          <Link
            href="/automation/create"
            className="flex flex-col items-center justify-center gap-3 p-8 rounded-2xl border-2 border-dashed border-border/50 hover:border-primary/40 hover:bg-primary/5 transition-all text-center group min-h-[220px]"
          >
            <div className="w-12 h-12 rounded-2xl bg-muted/50 group-hover:bg-primary/10 flex items-center justify-center transition-colors">
              <Plus className="w-6 h-6 text-muted-foreground group-hover:text-primary transition-colors" />
            </div>
            <div>
              <p className="font-medium text-sm group-hover:text-primary transition-colors">Create Automation</p>
              <p className="text-xs text-muted-foreground mt-0.5">Set up a new workflow</p>
            </div>
          </Link>
        </div>
      )}

      {/* ── Recipe Templates ── */}
      {tab === "recipes" && (
        <div className="space-y-4">
          <div className="p-4 bg-primary/5 border border-primary/20 rounded-2xl flex items-start gap-3">
            <Sparkles className="w-5 h-5 text-primary flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-semibold text-primary">Ready-to-use Recipe Templates</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Pick any recipe and customize it — saves you time setting up common WhatsApp automation workflows.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {RECIPES.map((recipe) => {
              const triggerMeta = TRIGGER_META[recipe.trigger];
              const actionMeta  = ACTION_META[recipe.action];
              const TIcon = triggerMeta.icon;
              const AIcon = actionMeta.icon;
              return (
                <div key={recipe.id} className="bg-card rounded-2xl border border-border/50 p-5 hover:border-border transition-all flex flex-col group">
                  {/* Header */}
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        {recipe.popular && (
                          <span className="text-[10px] bg-primary/10 text-primary px-2 py-0.5 rounded-full font-semibold">POPULAR</span>
                        )}
                        <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${RECIPE_CATEGORY_COLORS[recipe.category]}`}>
                          {recipe.category}
                        </span>
                      </div>
                      <p className="text-sm font-semibold leading-tight">{recipe.title}</p>
                      <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{recipe.desc}</p>
                    </div>
                  </div>

                  {/* Mini flow */}
                  <div className="flex items-center gap-2 my-4 p-3 bg-muted/20 rounded-xl">
                    <div className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-medium ${triggerMeta.bg} ${triggerMeta.color}`}>
                      <TIcon className="w-3 h-3" />
                      {triggerMeta.label}
                    </div>
                    <ArrowRight className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                    <div className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-emerald-500/10 border border-emerald-500/20 ${actionMeta.color}`}>
                      <AIcon className="w-3 h-3" />
                      {actionMeta.label}
                    </div>
                  </div>

                  <div className="mt-auto">
                    <Link
                      href={`/automation/create?recipe=${recipe.id}`}
                      className="w-full flex items-center justify-center gap-2 wa-gradient text-white text-sm font-semibold py-2.5 rounded-xl hover:opacity-90 transition-all"
                    >
                      <Zap className="w-4 h-4" /> Use This Recipe
                    </Link>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
