"use client";

import { PageHeader } from "@/components/shared/PageHeader";
import {
  Zap, Bell, MessageSquare, RefreshCw, CheckCircle2, Clock,
  Star, AlertCircle, Plus, ChevronRight, Play, Pause,
  ArrowRight, Calendar, Phone, Tag, Users, Check, X,
} from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";

// ─── Automation flow definitions ──────────────────────────────────────────────
type AutoType = "reminder_24h" | "reminder_1h" | "auto_confirm" | "followup" | "noshow" | "completed_review" | "reschedule_nudge" | "sequence";

interface ApptAutomation {
  id: string;
  type: AutoType;
  name: string;
  trigger: string;
  action: string;
  actionDetail: string;
  isActive: boolean;
  runCount: number;
  lastRun?: string;
  tags?: string[];
}

const INITIAL_AUTOMATIONS: ApptAutomation[] = [
  {
    id: "1", type: "auto_confirm", name: "Instant Booking Confirmation",
    trigger: "Appointment Booked",
    action: "Send WhatsApp Confirmation",
    actionDetail: "Sends booking details + date/time + cancel/reschedule options",
    isActive: true, runCount: 47, lastRun: "2026-04-25",
    tags: ["confirmation"],
  },
  {
    id: "2", type: "reminder_24h", name: "24-Hour Reminder",
    trigger: "24 hours before appointment",
    action: "Send Reminder Message",
    actionDetail: "Reminds contact with appointment time & location. Asks for confirmation (YES / NO).",
    isActive: true, runCount: 38, lastRun: "2026-04-25",
    tags: ["reminder"],
  },
  {
    id: "3", type: "reminder_1h", name: "1-Hour Reminder",
    trigger: "1 hour before appointment",
    action: "Send Final Reminder",
    actionDetail: "Last-minute reminder with map link / meeting link if applicable.",
    isActive: true, runCount: 31, lastRun: "2026-04-26",
    tags: ["reminder"],
  },
  {
    id: "4", type: "followup", name: "Post-Appointment Follow-up",
    trigger: "Appointment marked Completed",
    action: "Send Follow-up Message",
    actionDetail: "Thank-you message + feedback request + next-step CTA (book again, buy, etc.)",
    isActive: true, runCount: 22, lastRun: "2026-04-24",
    tags: ["follow-up"],
  },
  {
    id: "5", type: "noshow", name: "No-show Re-booking",
    trigger: "Appointment marked No-show",
    action: "Send Re-booking Invite",
    actionDetail: "Apologetic message with reschedule link. Wait 2h then send if no reply.",
    isActive: false, runCount: 8, lastRun: "2026-04-20",
    tags: ["no-show", "re-book"],
  },
  {
    id: "6", type: "completed_review", name: "Review Request",
    trigger: "2 hours after Completed",
    action: "Request Google / Review",
    actionDetail: "Ask for a review/rating with a direct link. Triggered only once per contact.",
    isActive: false, runCount: 15, lastRun: "2026-04-22",
    tags: ["review"],
  },
  {
    id: "7", type: "reschedule_nudge", name: "Cancellation Reschedule Nudge",
    trigger: "Appointment Cancelled",
    action: "Send Reschedule Offer",
    actionDetail: "Gentle nudge to reschedule with a booking link. Send 30 mins after cancellation.",
    isActive: true, runCount: 5, lastRun: "2026-04-21",
    tags: ["reschedule"],
  },
  {
    id: "8", type: "sequence", name: "Pre-appointment Nurture Sequence",
    trigger: "Appointment Booked (3 days before)",
    action: "3-Step WhatsApp Sequence",
    actionDetail: "Day 1: Confirmation → Day 2: Prep tips → Day 3 (morning): Final reminder",
    isActive: false, runCount: 3, lastRun: "2026-04-18",
    tags: ["sequence", "nurture"],
  },
];

const TYPE_META: Record<AutoType, { icon: React.ElementType; color: string; bg: string; border: string; triggerColor: string; triggerBg: string }> = {
  auto_confirm:      { icon: CheckCircle2, color: "text-emerald-400", bg: "bg-emerald-500/10", border: "border-emerald-500/30", triggerColor: "text-emerald-400", triggerBg: "bg-emerald-500/10" },
  reminder_24h:      { icon: Bell,         color: "text-blue-400",    bg: "bg-blue-500/10",    border: "border-blue-500/30",    triggerColor: "text-blue-400",    triggerBg: "bg-blue-500/10"    },
  reminder_1h:       { icon: Clock,        color: "text-cyan-400",    bg: "bg-cyan-500/10",    border: "border-cyan-500/30",    triggerColor: "text-cyan-400",    triggerBg: "bg-cyan-500/10"    },
  followup:          { icon: MessageSquare,color: "text-violet-400",  bg: "bg-violet-500/10",  border: "border-violet-500/30",  triggerColor: "text-violet-400",  triggerBg: "bg-violet-500/10"  },
  noshow:            { icon: AlertCircle,  color: "text-orange-400",  bg: "bg-orange-500/10",  border: "border-orange-500/30",  triggerColor: "text-orange-400",  triggerBg: "bg-orange-500/10"  },
  completed_review:  { icon: Star,         color: "text-amber-400",   bg: "bg-amber-500/10",   border: "border-amber-500/30",   triggerColor: "text-amber-400",   triggerBg: "bg-amber-500/10"   },
  reschedule_nudge:  { icon: RefreshCw,    color: "text-pink-400",    bg: "bg-pink-500/10",    border: "border-pink-500/30",    triggerColor: "text-pink-400",    triggerBg: "bg-pink-500/10"    },
  sequence:          { icon: Zap,          color: "text-indigo-400",  bg: "bg-indigo-500/10",  border: "border-indigo-500/30",  triggerColor: "text-indigo-400",  triggerBg: "bg-indigo-500/10"  },
};

// ─── Pre-built recipe templates specific to appointments ──────────────────────
const RECIPES = [
  {
    id: "r1", title: "Complete Reminder Flow",
    desc: "Auto-confirm → 24h remind → 1h remind → post follow-up, all in one click.",
    steps: ["Auto Confirmation", "24h Reminder", "1h Reminder", "Post Follow-up"],
    popular: true,
  },
  {
    id: "r2", title: "No-show Recovery",
    desc: "Detects missed appointments and automatically sends a re-booking message.",
    steps: ["Detect No-show", "Wait 2 hours", "Send Re-booking Invite"],
    popular: true,
  },
  {
    id: "r3", title: "Review Collection",
    desc: "After every completed appointment, ask for a Google / review platform rating.",
    steps: ["Appointment Completed", "Wait 2 hours", "Send Review Request"],
    popular: false,
  },
  {
    id: "r4", title: "3-Day Nurture Before Appointment",
    desc: "Warm up the contact with prep info 3 days, 1 day, and 1 hour before.",
    steps: ["Booked (3 days out)", "Send Prep Tips", "Day-before Reminder", "1h Reminder"],
    popular: false,
  },
];

// ─── WhatsApp message previews per automation type ────────────────────────────
const WA_PREVIEWS: Record<AutoType, string> = {
  auto_confirm:     "Hi [Name]! ✅ Your Consultation is confirmed.\n\n📅 [Date] at [Time] (30 mins)\n\nReply YES to confirm or NO to reschedule.",
  reminder_24h:     "Hi [Name]! 🔔 Reminder: You have a Consultation tomorrow at [Time].\n\nReply CONFIRM to confirm, or RESCHEDULE to change.",
  reminder_1h:      "Hi [Name]! ⏰ Your appointment is in 1 hour at [Time].\n\nSee you soon! Reply CANCEL if you can't make it.",
  followup:         "Hi [Name]! 😊 Thank you for your session today.\n\nWould you like to book a follow-up? Reply BOOK to schedule your next appointment.",
  noshow:           "Hi [Name], we missed you today! 🙏\n\nNo worries — reply RESCHEDULE to pick a new time, or call us directly.",
  completed_review: "Hi [Name]! 🌟 We hope your appointment went well.\n\nCould you spare 1 minute to leave us a review? It really helps us. Tap the link below 👇",
  reschedule_nudge: "Hi [Name], we noticed you cancelled your appointment. We'd love to find a better time for you. 📅\n\nReply BOOK to reschedule at your convenience.",
  sequence:         "Day 1: Confirmation sent\nDay 2: Prep tips + what to expect\nDay 3 (morning): Final reminder with meeting details",
};

// ─── Single automation card ────────────────────────────────────────────────────
function AutoCard({ auto, onToggle }: { auto: ApptAutomation; onToggle: (id: string) => void }) {
  const meta   = TYPE_META[auto.type];
  const TIcon  = meta.icon;
  const [showPreview, setShowPreview] = useState(false);

  return (
    <div className={`bg-card rounded-2xl border p-5 hover:border-border transition-all ${auto.isActive ? "border-border/50" : "border-border/20 opacity-65"}`}>
      {/* Header */}
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className={`w-10 h-10 rounded-xl flex items-center justify-center border ${meta.bg} ${meta.border}`}>
            <TIcon className={`w-5 h-5 ${meta.color}`} />
          </div>
          <div>
            <p className="text-sm font-semibold leading-tight">{auto.name}</p>
            <div className="flex items-center gap-1.5 mt-0.5">
              {auto.tags?.map((t) => (
                <span key={t} className="text-[10px] bg-muted/50 text-muted-foreground px-1.5 py-0.5 rounded">{t}</span>
              ))}
            </div>
          </div>
        </div>
        <button onClick={() => onToggle(auto.id)}
          className={`relative w-11 h-6 rounded-full transition-all duration-300 flex-shrink-0 ${auto.isActive ? "bg-primary" : "bg-muted"}`}>
          <span className={`absolute top-1 w-4 h-4 rounded-full bg-white shadow transition-all duration-300 ${auto.isActive ? "left-6" : "left-1"}`} />
        </button>
      </div>

      {/* Trigger → Action flow */}
      <div className="space-y-2 mb-4">
        <div className={`flex items-start gap-2.5 p-3 rounded-xl border ${meta.triggerBg} ${meta.border}`}>
          <Calendar className={`w-3.5 h-3.5 flex-shrink-0 mt-0.5 ${meta.triggerColor}`} />
          <div>
            <p className={`text-[10px] font-bold uppercase tracking-wide ${meta.triggerColor}`}>Trigger</p>
            <p className="text-xs font-medium">{auto.trigger}</p>
          </div>
        </div>
        <div className="flex justify-center"><div className="w-px h-3 bg-border" /></div>
        <div className="flex items-start gap-2.5 p-3 rounded-xl bg-emerald-500/5 border border-emerald-500/20">
          <MessageSquare className="w-3.5 h-3.5 flex-shrink-0 mt-0.5 text-emerald-400" />
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wide text-emerald-400">Action</p>
            <p className="text-xs font-medium">{auto.action}</p>
            <p className="text-[11px] text-muted-foreground mt-0.5">{auto.actionDetail}</p>
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="flex items-center gap-3 text-xs text-muted-foreground border-t border-border/30 pt-3">
        <span className={`font-medium px-2.5 py-1 rounded-full text-[10px] ${auto.isActive ? "bg-emerald-500/10 text-emerald-400" : "bg-muted/50 text-muted-foreground"}`}>
          {auto.isActive ? "● Active" : "⏸ Paused"}
        </span>
        <span>{auto.runCount} runs</span>
        {auto.lastRun && <span>Last: {auto.lastRun}</span>}
        <button onClick={() => setShowPreview(!showPreview)} className="ml-auto text-primary hover:underline text-[11px]">
          {showPreview ? "Hide" : "Preview"}
        </button>
      </div>

      {/* WA preview */}
      {showPreview && (
        <div className="mt-3 pt-3 border-t border-border/30 animate-fade-in">
          <p className="text-[10px] text-muted-foreground mb-2">WhatsApp Message Preview</p>
          <div className="bg-[#0b141a] rounded-xl p-3">
            <div className="bg-[#202c33] rounded-xl rounded-tl-none p-3 max-w-[90%]">
              <p className="text-[11px] text-[#e9edef] leading-relaxed whitespace-pre-wrap">{WA_PREVIEWS[auto.type]}</p>
              <p className="text-[9px] text-[#8696a0] text-right mt-1">Auto ✓✓</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────
export default function AppointmentAutomationsPage() {
  const [automations, setAutomations] = useState<ApptAutomation[]>(INITIAL_AUTOMATIONS);
  const [tab, setTab] = useState<"automations" | "recipes">("automations");

  const toggle = (id: string) => {
    setAutomations((prev) => prev.map((a) => {
      if (a.id !== id) return a;
      const next = !a.isActive;
      toast.success(`${a.name} ${next ? "activated" : "paused"}`);
      return { ...a, isActive: next };
    }));
  };

  const activeCount = automations.filter((a) => a.isActive).length;
  const totalRuns   = automations.reduce((s, a) => s + a.runCount, 0);

  return (
    <div className="max-w-6xl">
      <PageHeader
        title="Appointment Automations"
        subtitle="Automated WhatsApp workflows for bookings, reminders, follow-ups and recovery"
        action={
          <div className="flex items-center gap-2">
            <Link href="/appointments" className="flex items-center gap-2 px-4 py-2.5 rounded-xl border border-border hover:bg-accent text-sm font-medium transition-colors">
              <Calendar className="w-4 h-4" /> Appointments
            </Link>
            <Link href="/appointments/book" className="flex items-center gap-2 wa-gradient text-white text-sm font-semibold px-4 py-2.5 rounded-xl hover:opacity-90 transition-all shadow-lg shadow-primary/25">
              <Plus className="w-4 h-4" /> Book + Auto
            </Link>
          </div>
        }
      />

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        {[
          { label: "Total Workflows",  value: automations.length, icon: Zap,         color: "text-primary",        bg: "bg-primary/10" },
          { label: "Active",           value: activeCount,         icon: Play,        color: "text-emerald-400",    bg: "bg-emerald-500/10" },
          { label: "Total Runs",       value: totalRuns,           icon: CheckCircle2,color: "text-violet-400",     bg: "bg-violet-500/10" },
          { label: "Recipes Available",value: RECIPES.length,      icon: Star,        color: "text-amber-400",      bg: "bg-amber-500/10" },
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

      {/* Appointment journey map */}
      <div className="bg-card border border-border/50 rounded-2xl p-5 mb-6">
        <p className="text-sm font-semibold mb-4">Appointment WhatsApp Journey</p>
        <div className="flex items-center gap-1 overflow-x-auto pb-2">
          {[
            { label: "Booked",       color: "text-blue-400",    bg: "bg-blue-500/10",    icon: Calendar    },
            { label: "Confirmation", color: "text-emerald-400", bg: "bg-emerald-500/10", icon: CheckCircle2 },
            { label: "24h Reminder", color: "text-cyan-400",    bg: "bg-cyan-500/10",    icon: Bell         },
            { label: "1h Reminder",  color: "text-violet-400",  bg: "bg-violet-500/10",  icon: Clock        },
            { label: "Appointment",  color: "text-amber-400",   bg: "bg-amber-500/10",   icon: Calendar     },
            { label: "Follow-up",    color: "text-pink-400",    bg: "bg-pink-500/10",    icon: MessageSquare},
            { label: "Review Ask",   color: "text-orange-400",  bg: "bg-orange-500/10",  icon: Star         },
          ].map(({ label, color, bg, icon: Icon }, i, arr) => (
            <div key={label} className="flex items-center gap-1 flex-shrink-0">
              <div className={`flex flex-col items-center gap-1.5 px-3 py-2 rounded-xl border ${bg} border-opacity-30`} style={{ borderColor: "currentColor", opacity: 0.8 }}>
                <Icon className={`w-4 h-4 ${color}`} />
                <span className={`text-[10px] font-semibold whitespace-nowrap ${color}`}>{label}</span>
              </div>
              {i < arr.length - 1 && <ArrowRight className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />}
            </div>
          ))}
          {/* No-show branch */}
          <div className="flex items-center gap-1 flex-shrink-0 ml-2 pl-2 border-l border-dashed border-border">
            <AlertCircle className="w-3.5 h-3.5 text-orange-400" />
            <span className="text-[10px] text-orange-400 font-medium">No-show → Re-book</span>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-muted/30 p-1 rounded-xl w-fit mb-6">
        {[
          { id: "automations", label: `My Workflows (${automations.length})` },
          { id: "recipes",     label: `Recipe Templates (${RECIPES.length})` },
        ].map(({ id, label }) => (
          <button key={id} onClick={() => setTab(id as typeof tab)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${tab === id ? "bg-card shadow text-foreground" : "text-muted-foreground hover:text-foreground"}`}>
            {label}
          </button>
        ))}
      </div>

      {/* ── Automations tab ── */}
      {tab === "automations" && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {automations.map((a) => <AutoCard key={a.id} auto={a} onToggle={toggle} />)}
          <Link href="/automation/create"
            className="flex flex-col items-center justify-center gap-3 p-8 rounded-2xl border-2 border-dashed border-border/50 hover:border-primary/40 hover:bg-primary/5 transition-all text-center group min-h-[220px]">
            <div className="w-12 h-12 rounded-2xl bg-muted/50 group-hover:bg-primary/10 flex items-center justify-center transition-colors">
              <Plus className="w-6 h-6 text-muted-foreground group-hover:text-primary transition-colors" />
            </div>
            <div>
              <p className="font-medium text-sm group-hover:text-primary transition-colors">Custom Workflow</p>
              <p className="text-xs text-muted-foreground mt-0.5">Build from scratch</p>
            </div>
          </Link>
        </div>
      )}

      {/* ── Recipes tab ── */}
      {tab === "recipes" && (
        <div className="space-y-4">
          <div className="p-4 bg-primary/5 border border-primary/20 rounded-2xl flex items-start gap-3">
            <Zap className="w-5 h-5 text-primary flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-semibold text-primary">Appointment-specific Recipe Templates</p>
              <p className="text-xs text-muted-foreground mt-0.5">One-click activate complete appointment automation flows tailored for WhatsApp.</p>
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {RECIPES.map((r) => (
              <div key={r.id} className="bg-card rounded-2xl border border-border/50 p-5 hover:border-border transition-all">
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      {r.popular && <span className="text-[10px] bg-primary/10 text-primary px-2 py-0.5 rounded-full font-semibold">POPULAR</span>}
                    </div>
                    <p className="text-sm font-semibold">{r.title}</p>
                    <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{r.desc}</p>
                  </div>
                </div>
                {/* Steps */}
                <div className="flex items-center gap-1 flex-wrap my-4">
                  {r.steps.map((s, i) => (
                    <div key={s} className="flex items-center gap-1 flex-shrink-0">
                      <span className="text-[10px] bg-muted/50 text-muted-foreground px-2 py-1 rounded-lg font-medium">{s}</span>
                      {i < r.steps.length - 1 && <ArrowRight className="w-3 h-3 text-muted-foreground" />}
                    </div>
                  ))}
                </div>
                <Link href="/automation/create"
                  className="w-full flex items-center justify-center gap-2 wa-gradient text-white text-sm font-semibold py-2.5 rounded-xl hover:opacity-90 transition-all">
                  <Zap className="w-4 h-4" /> Activate Recipe
                </Link>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
