"use client";

import { PageHeader } from "@/components/shared/PageHeader";
import {
  Calendar, Clock, Plus, Search, CheckCircle2, XCircle, AlertCircle,
  Phone, User, MessageSquare, RefreshCw, ChevronLeft, ChevronRight,
  MoreHorizontal, Zap, Send, Star, TrendingUp, Filter,
  CalendarDays, List, Bell, X, Edit2, Trash2, Check,
} from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";

// ─── Types ────────────────────────────────────────────────────────────────────
type ApptStatus = "scheduled" | "confirmed" | "completed" | "cancelled" | "no_show" | "rescheduled";
type ServiceType = "consultation" | "follow_up" | "demo" | "checkup" | "meeting" | "callback";

interface Appointment {
  id: string;
  contactName: string;
  contactPhone: string;
  service: ServiceType;
  date: string;
  time: string;
  duration: number;
  status: ApptStatus;
  notes?: string;
  reminderSent: boolean;
  confirmationSent: boolean;
  followUpSent: boolean;
  assignedTo?: string;
}

// ─── Demo data ────────────────────────────────────────────────────────────────
const TODAY = "2026-04-26";
const DEMO_APPOINTMENTS: Appointment[] = [
  { id: "a1",  contactName: "Rajesh Kumar",   contactPhone: "+91 98765 43210", service: "consultation", date: "2026-04-26", time: "09:00", duration: 30, status: "confirmed",  notes: "Interested in enterprise plan",      reminderSent: true,  confirmationSent: true,  followUpSent: false, assignedTo: "Vikram" },
  { id: "a2",  contactName: "Anita Desai",    contactPhone: "+91 88776 65544", service: "demo",         date: "2026-04-26", time: "10:30", duration: 45, status: "scheduled",  notes: "Wants product walkthrough",          reminderSent: true,  confirmationSent: true,  followUpSent: false, assignedTo: "Priya" },
  { id: "a3",  contactName: "Suresh Babu",    contactPhone: "+91 77665 54433", service: "follow_up",    date: "2026-04-26", time: "14:00", duration: 15, status: "confirmed",  notes: "Follow-up on last week's proposal",  reminderSent: false, confirmationSent: true,  followUpSent: false },
  { id: "a4",  contactName: "Priya Sharma",   contactPhone: "+91 99887 11223", service: "meeting",      date: "2026-04-26", time: "15:30", duration: 60, status: "scheduled",  notes: "",                                   reminderSent: false, confirmationSent: false, followUpSent: false, assignedTo: "Vikram" },
  { id: "a5",  contactName: "Kavya Pillai",   contactPhone: "+91 77889 22334", service: "checkup",      date: "2026-04-27", time: "09:30", duration: 30, status: "scheduled",  notes: "Monthly review",                     reminderSent: false, confirmationSent: false, followUpSent: false },
  { id: "a6",  contactName: "Mohan Reddy",    contactPhone: "+91 66778 11223", service: "callback",     date: "2026-04-27", time: "11:00", duration: 15, status: "scheduled",  notes: "Price negotiation callback",         reminderSent: false, confirmationSent: true,  followUpSent: false },
  { id: "a7",  contactName: "Deepa Menon",    contactPhone: "+91 55667 00112", service: "consultation", date: "2026-04-28", time: "10:00", duration: 45, status: "scheduled",  notes: "New client onboarding",              reminderSent: false, confirmationSent: false, followUpSent: false, assignedTo: "Priya" },
  { id: "a8",  contactName: "Vikram Nair",    contactPhone: "+91 88990 33445", service: "demo",         date: "2026-04-24", time: "11:00", duration: 45, status: "completed",  notes: "Signed up for Pro plan",             reminderSent: true,  confirmationSent: true,  followUpSent: true  },
  { id: "a9",  contactName: "Arjun Singh",    contactPhone: "+91 44556 99001", service: "meeting",      date: "2026-04-23", time: "14:00", duration: 30, status: "no_show",    notes: "Didn't pick up",                     reminderSent: true,  confirmationSent: true,  followUpSent: false },
  { id: "a10", contactName: "Sunita Verma",   contactPhone: "+91 33445 88990", service: "follow_up",    date: "2026-04-22", time: "16:00", duration: 20, status: "cancelled",  notes: "Rescheduled to next week",           reminderSent: true,  confirmationSent: true,  followUpSent: false },
];

// ─── Config maps ──────────────────────────────────────────────────────────────
const STATUS_META: Record<ApptStatus, { label: string; color: string; bg: string; border: string; icon: React.ElementType }> = {
  scheduled:   { label: "Scheduled",   color: "text-blue-400",    bg: "bg-blue-500/10",    border: "border-blue-500/30",    icon: Clock },
  confirmed:   { label: "Confirmed",   color: "text-emerald-400", bg: "bg-emerald-500/10", border: "border-emerald-500/30", icon: CheckCircle2 },
  completed:   { label: "Completed",   color: "text-violet-400",  bg: "bg-violet-500/10",  border: "border-violet-500/30",  icon: Star },
  cancelled:   { label: "Cancelled",   color: "text-red-400",     bg: "bg-red-500/10",     border: "border-red-500/30",     icon: XCircle },
  no_show:     { label: "No-show",     color: "text-orange-400",  bg: "bg-orange-500/10",  border: "border-orange-500/30",  icon: AlertCircle },
  rescheduled: { label: "Rescheduled", color: "text-amber-400",   bg: "bg-amber-500/10",   border: "border-amber-500/30",   icon: RefreshCw },
};

const SERVICE_META: Record<ServiceType, { label: string; color: string; bg: string }> = {
  consultation: { label: "Consultation", color: "text-blue-400",    bg: "bg-blue-500/10" },
  follow_up:    { label: "Follow-up",    color: "text-emerald-400", bg: "bg-emerald-500/10" },
  demo:         { label: "Product Demo", color: "text-violet-400",  bg: "bg-violet-500/10" },
  checkup:      { label: "Check-up",     color: "text-cyan-400",    bg: "bg-cyan-500/10" },
  meeting:      { label: "Meeting",      color: "text-amber-400",   bg: "bg-amber-500/10" },
  callback:     { label: "Callback",     color: "text-pink-400",    bg: "bg-pink-500/10" },
};

// WhatsApp automation triggers for each action
const WA_ACTIONS: { id: string; label: string; icon: React.ElementType; recipe: string; desc: string }[] = [
  { id: "confirm",   label: "Send Confirmation",  icon: CheckCircle2, recipe: "otp_confirm",   desc: "Confirm appointment via WhatsApp" },
  { id: "reminder",  label: "Send 24h Reminder",  icon: Bell,         recipe: "welcome",       desc: "Remind contact 24h before" },
  { id: "followup",  label: "Send Follow-up",      icon: MessageSquare,recipe: "re_engage",    desc: "Post-appointment follow-up" },
  { id: "reschedule",label: "Send Reschedule Link",icon: RefreshCw,    recipe: "keyword_help",  desc: "Let contact reschedule" },
];

// ─── Appointment card ─────────────────────────────────────────────────────────
function AppointmentCard({
  appt,
  onStatusChange,
  onSendWA,
}: {
  appt: Appointment;
  onStatusChange: (id: string, status: ApptStatus) => void;
  onSendWA: (appt: Appointment, action: string) => void;
}) {
  const [showMenu, setShowMenu] = useState(false);
  const meta    = STATUS_META[appt.status];
  const service = SERVICE_META[appt.service];
  const SIcon   = meta.icon;

  return (
    <div className={`bg-card border rounded-2xl p-4 hover:border-border transition-all ${
      appt.status === "cancelled" || appt.status === "no_show" ? "border-border/30 opacity-70" : "border-border/50"
    }`}>
      {/* Header */}
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-full wa-gradient flex items-center justify-center text-xs font-bold text-white flex-shrink-0">
            {appt.contactName.split(" ").map((n) => n[0]).join("").slice(0,2).toUpperCase()}
          </div>
          <div>
            <p className="text-sm font-semibold">{appt.contactName}</p>
            <p className="text-xs text-muted-foreground flex items-center gap-1">
              <Phone className="w-3 h-3" />{appt.contactPhone}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className={`text-[10px] px-2 py-0.5 rounded-full border font-semibold ${meta.color} ${meta.bg} ${meta.border}`}>
            <span className="flex items-center gap-1"><SIcon className="w-3 h-3" />{meta.label}</span>
          </span>
          <div className="relative">
            <button onClick={() => setShowMenu(!showMenu)} className="p-1 rounded hover:bg-muted/50 transition-colors">
              <MoreHorizontal className="w-3.5 h-3.5 text-muted-foreground" />
            </button>
            {showMenu && (
              <div className="absolute right-0 top-7 z-20 bg-card border border-border rounded-xl shadow-lg w-44 overflow-hidden">
                {(["confirmed","completed","cancelled","no_show","rescheduled"] as ApptStatus[])
                  .filter((s) => s !== appt.status)
                  .map((s) => {
                    const sm = STATUS_META[s];
                    return (
                      <button key={s} onClick={() => { onStatusChange(appt.id, s); setShowMenu(false); }}
                        className="w-full text-left px-3 py-2 text-xs hover:bg-muted/40 transition-colors flex items-center gap-2">
                        <sm.icon className={`w-3 h-3 ${sm.color}`} />
                        Mark as {sm.label}
                      </button>
                    );
                  })
                }
                <div className="border-t border-border/50" />
                <button onClick={() => setShowMenu(false)} className="w-full text-left px-3 py-2 text-xs text-red-400 hover:bg-red-500/10 transition-colors flex items-center gap-2">
                  <Trash2 className="w-3 h-3" /> Cancel Appointment
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Time + service */}
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <span className="flex items-center gap-1.5 text-xs font-semibold text-foreground bg-muted/40 px-2.5 py-1 rounded-lg">
          <Clock className="w-3 h-3 text-primary" />{appt.time} · {appt.duration}m
        </span>
        <span className={`text-[10px] px-2 py-1 rounded-lg font-medium ${service.color} ${service.bg}`}>
          {service.label}
        </span>
        {appt.assignedTo && (
          <span className="text-[10px] text-muted-foreground bg-muted/30 px-2 py-1 rounded-lg flex items-center gap-1">
            <User className="w-3 h-3" />{appt.assignedTo}
          </span>
        )}
      </div>

      {appt.notes && (
        <p className="text-[11px] text-muted-foreground mb-3 bg-muted/20 px-3 py-2 rounded-lg italic line-clamp-2">
          "{appt.notes}"
        </p>
      )}

      {/* WhatsApp action pills */}
      <div className="flex items-center gap-1.5 flex-wrap pt-2 border-t border-border/30">
        {!appt.confirmationSent && (
          <button onClick={() => onSendWA(appt, "confirm")}
            className="flex items-center gap-1 text-[10px] font-medium px-2.5 py-1.5 rounded-lg bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 hover:bg-emerald-500/20 transition-colors">
            <CheckCircle2 className="w-3 h-3" /> Confirm
          </button>
        )}
        {appt.confirmationSent && !appt.reminderSent && appt.status !== "cancelled" && (
          <button onClick={() => onSendWA(appt, "reminder")}
            className="flex items-center gap-1 text-[10px] font-medium px-2.5 py-1.5 rounded-lg bg-blue-500/10 text-blue-400 border border-blue-500/20 hover:bg-blue-500/20 transition-colors">
            <Bell className="w-3 h-3" /> Remind
          </button>
        )}
        {appt.status === "completed" && !appt.followUpSent && (
          <button onClick={() => onSendWA(appt, "followup")}
            className="flex items-center gap-1 text-[10px] font-medium px-2.5 py-1.5 rounded-lg bg-violet-500/10 text-violet-400 border border-violet-500/20 hover:bg-violet-500/20 transition-colors">
            <MessageSquare className="w-3 h-3" /> Follow-up
          </button>
        )}
        {(appt.status === "no_show" || appt.status === "cancelled") && (
          <button onClick={() => onSendWA(appt, "reschedule")}
            className="flex items-center gap-1 text-[10px] font-medium px-2.5 py-1.5 rounded-lg bg-amber-500/10 text-amber-400 border border-amber-500/20 hover:bg-amber-500/20 transition-colors">
            <RefreshCw className="w-3 h-3" /> Reschedule
          </button>
        )}
        {/* Status indicators */}
        <div className="flex items-center gap-1.5 ml-auto">
          {appt.confirmationSent && <span title="Confirmation sent" className="w-4 h-4 rounded-full bg-emerald-500/20 flex items-center justify-center"><Check className="w-2.5 h-2.5 text-emerald-400" /></span>}
          {appt.reminderSent && <span title="Reminder sent" className="w-4 h-4 rounded-full bg-blue-500/20 flex items-center justify-center"><Bell className="w-2.5 h-2.5 text-blue-400" /></span>}
          {appt.followUpSent && <span title="Follow-up sent" className="w-4 h-4 rounded-full bg-violet-500/20 flex items-center justify-center"><MessageSquare className="w-2.5 h-2.5 text-violet-400" /></span>}
        </div>
      </div>
    </div>
  );
}

// ─── Mini calendar ─────────────────────────────────────────────────────────────
function MiniCalendar({
  selectedDate,
  onSelect,
  appointmentDates,
}: {
  selectedDate: string;
  onSelect: (date: string) => void;
  appointmentDates: Set<string>;
}) {
  const [currentMonth, setCurrentMonth] = useState(new Date(2026, 3, 1)); // April 2026
  const year  = currentMonth.getFullYear();
  const month = currentMonth.getMonth();
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const days = Array.from({ length: daysInMonth }, (_, i) => i + 1);
  const pad = Array.from({ length: firstDay }, (_, i) => i);

  return (
    <div className="bg-card rounded-2xl border border-border/50 p-4">
      <div className="flex items-center justify-between mb-3">
        <button onClick={() => setCurrentMonth(new Date(year, month - 1, 1))} className="p-1 rounded hover:bg-muted/50 transition-colors">
          <ChevronLeft className="w-4 h-4" />
        </button>
        <p className="text-sm font-semibold">{currentMonth.toLocaleDateString("en", { month: "long", year: "numeric" })}</p>
        <button onClick={() => setCurrentMonth(new Date(year, month + 1, 1))} className="p-1 rounded hover:bg-muted/50 transition-colors">
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>
      <div className="grid grid-cols-7 gap-0.5 mb-1">
        {["Su","Mo","Tu","We","Th","Fr","Sa"].map((d) => (
          <p key={d} className="text-center text-[10px] text-muted-foreground font-medium py-1">{d}</p>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-0.5">
        {pad.map((i) => <div key={`pad-${i}`} />)}
        {days.map((d) => {
          const dateStr = `${year}-${String(month+1).padStart(2,"0")}-${String(d).padStart(2,"0")}`;
          const isToday    = dateStr === TODAY;
          const isSelected = dateStr === selectedDate;
          const hasAppts   = appointmentDates.has(dateStr);
          return (
            <button
              key={d}
              onClick={() => onSelect(dateStr)}
              className={`relative w-7 h-7 rounded-lg text-xs flex items-center justify-center mx-auto transition-all ${
                isSelected ? "wa-gradient text-white font-bold shadow" :
                isToday    ? "bg-primary/20 text-primary font-bold border border-primary/40" :
                             "hover:bg-muted/50 text-foreground"
              }`}
            >
              {d}
              {hasAppts && !isSelected && (
                <span className="absolute bottom-0.5 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-primary" />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function AppointmentsPage() {
  const [appointments, setAppointments] = useState<Appointment[]>(DEMO_APPOINTMENTS);
  const [selectedDate, setSelectedDate] = useState(TODAY);
  const [statusFilter, setStatusFilter] = useState<ApptStatus | "all">("all");
  const [search, setSearch] = useState("");
  const [view, setView] = useState<"day" | "list">("day");
  const [waModal, setWaModal] = useState<{ appt: Appointment; action: string } | null>(null);

  const appointmentDates = new Set(appointments.map((a) => a.date));

  const changeStatus = (id: string, status: ApptStatus) => {
    setAppointments((prev) => prev.map((a) => a.id === id ? { ...a, status } : a));
    toast.success(`Appointment marked as ${STATUS_META[status].label}`);
  };

  const sendWA = (appt: Appointment, action: string) => {
    setWaModal({ appt, action });
  };

  const confirmSendWA = () => {
    if (!waModal) return;
    const { appt, action } = waModal;
    setAppointments((prev) => prev.map((a) => a.id === appt.id ? {
      ...a,
      confirmationSent: action === "confirm" ? true : a.confirmationSent,
      reminderSent:     action === "reminder" ? true : a.reminderSent,
      followUpSent:     action === "followup" ? true : a.followUpSent,
    } : a));
    const labels: Record<string, string> = { confirm: "Confirmation", reminder: "Reminder", followup: "Follow-up", reschedule: "Reschedule link" };
    toast.success(`${labels[action]} sent to ${appt.contactName} via WhatsApp!`);
    setWaModal(null);
  };

  const displayAppts = appointments.filter((a) => {
    const matchDate   = view === "day" ? a.date === selectedDate : true;
    const matchStatus = statusFilter === "all" || a.status === statusFilter;
    const matchSearch = search === "" || a.contactName.toLowerCase().includes(search.toLowerCase()) || a.contactPhone.includes(search);
    return matchDate && matchStatus && matchSearch;
  }).sort((a, b) => a.time.localeCompare(b.time));

  const todayAppts = appointments.filter((a) => a.date === TODAY);
  const upcoming   = appointments.filter((a) => a.date > TODAY && a.status === "scheduled").length;
  const confirmed  = appointments.filter((a) => a.status === "confirmed").length;
  const completed  = appointments.filter((a) => a.status === "completed").length;
  const noShows    = appointments.filter((a) => a.status === "no_show").length;

  return (
    <div className="max-w-7xl">
      <PageHeader
        title="Appointments"
        subtitle="Book, manage and auto-follow-up appointments via WhatsApp"
        action={
          <div className="flex items-center gap-2">
            <Link href="/appointments/automations"
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl border border-border hover:bg-accent text-sm font-medium transition-colors">
              <Zap className="w-4 h-4 text-violet-400" /> Automations
            </Link>
            <Link href="/appointments/book"
              className="flex items-center gap-2 wa-gradient text-white text-sm font-semibold px-4 py-2.5 rounded-xl hover:opacity-90 transition-all shadow-lg shadow-primary/25">
              <Plus className="w-4 h-4" /> Book Appointment
            </Link>
          </div>
        }
      />

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-6">
        {[
          { label: "Today",      value: todayAppts.length,  color: "text-primary",        bg: "bg-primary/10",        icon: CalendarDays },
          { label: "Upcoming",   value: upcoming,            color: "text-blue-400",       bg: "bg-blue-500/10",       icon: Clock },
          { label: "Confirmed",  value: confirmed,           color: "text-emerald-400",    bg: "bg-emerald-500/10",    icon: CheckCircle2 },
          { label: "Completed",  value: completed,           color: "text-violet-400",     bg: "bg-violet-500/10",     icon: Star },
          { label: "No-shows",   value: noShows,             color: "text-orange-400",     bg: "bg-orange-500/10",     icon: AlertCircle },
        ].map(({ label, value, color, bg, icon: Icon }) => (
          <div key={label} className="bg-card rounded-2xl border border-border/50 p-4 flex items-center gap-3">
            <div className={`w-9 h-9 rounded-xl ${bg} flex items-center justify-center flex-shrink-0`}>
              <Icon className={`w-4 h-4 ${color}`} />
            </div>
            <div>
              <p className="text-xl font-bold">{value}</p>
              <p className="text-[11px] text-muted-foreground">{label}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-5">
        {/* ── Left: Calendar + filters ── */}
        <div className="lg:col-span-1 space-y-4">
          <MiniCalendar selectedDate={selectedDate} onSelect={setSelectedDate} appointmentDates={appointmentDates} />

          {/* Status filter */}
          <div className="bg-card rounded-2xl border border-border/50 p-4">
            <p className="text-xs font-semibold text-muted-foreground mb-3 uppercase tracking-wide">Filter by Status</p>
            <div className="space-y-1">
              <button onClick={() => setStatusFilter("all")}
                className={`w-full text-left px-3 py-2 rounded-xl text-xs font-medium transition-all ${statusFilter === "all" ? "bg-primary/10 text-primary" : "hover:bg-muted/40 text-muted-foreground"}`}>
                All Appointments ({appointments.length})
              </button>
              {(Object.keys(STATUS_META) as ApptStatus[]).map((s) => {
                const m = STATUS_META[s];
                const count = appointments.filter((a) => a.status === s).length;
                return (
                  <button key={s} onClick={() => setStatusFilter(s)}
                    className={`w-full text-left px-3 py-2 rounded-xl text-xs font-medium transition-all flex items-center justify-between ${statusFilter === s ? `${m.bg} ${m.color}` : "hover:bg-muted/40 text-muted-foreground"}`}>
                    <span className="flex items-center gap-2"><m.icon className="w-3 h-3" />{m.label}</span>
                    <span className="opacity-60">{count}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Quick automation panel */}
          <div className="bg-violet-500/5 border border-violet-500/20 rounded-2xl p-4">
            <div className="flex items-center gap-2 mb-3">
              <Zap className="w-4 h-4 text-violet-400" />
              <p className="text-xs font-semibold text-violet-400">Quick Automations</p>
            </div>
            <div className="space-y-2">
              {[
                { label: "24h Reminder",   href: "/appointments/automations?type=reminder_24h" },
                { label: "1h Reminder",    href: "/appointments/automations?type=reminder_1h" },
                { label: "Auto Confirm",   href: "/appointments/automations?type=auto_confirm" },
                { label: "Post Follow-up", href: "/appointments/automations?type=followup" },
                { label: "No-show Re-book",href: "/appointments/automations?type=noshow" },
              ].map(({ label, href }) => (
                <Link key={label} href={href}
                  className="flex items-center justify-between text-xs text-muted-foreground hover:text-foreground py-1.5 transition-colors group">
                  {label} <ChevronRight className="w-3 h-3 group-hover:text-primary transition-colors" />
                </Link>
              ))}
            </div>
          </div>
        </div>

        {/* ── Right: Appointments list ── */}
        <div className="lg:col-span-3 space-y-4">
          {/* Search + view toggle */}
          <div className="flex items-center gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <input value={search} onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by name or phone…"
                className="w-full bg-card border border-border/50 rounded-xl pl-9 pr-4 py-2 text-sm outline-none focus:border-primary/60 transition-all" />
            </div>
            <div className="flex gap-1 bg-muted/30 p-1 rounded-lg">
              {(["day","list"] as const).map((v) => (
                <button key={v} onClick={() => setView(v)} className={`px-3 py-1 rounded text-xs font-medium capitalize transition-all ${view === v ? "bg-card shadow text-foreground" : "text-muted-foreground"}`}>
                  {v === "day" ? <><CalendarDays className="w-3.5 h-3.5 inline mr-1" />Day</> : <><List className="w-3.5 h-3.5 inline mr-1" />All</>}
                </button>
              ))}
            </div>
          </div>

          {/* Date heading (day view) */}
          {view === "day" && (
            <div className="flex items-center justify-between">
              <div>
                <p className="text-base font-semibold">
                  {selectedDate === TODAY ? "Today" : new Date(selectedDate + "T00:00:00").toLocaleDateString("en", { weekday: "long", day: "numeric", month: "long" })}
                </p>
                <p className="text-xs text-muted-foreground">{displayAppts.length} appointment{displayAppts.length !== 1 ? "s" : ""}</p>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={() => setSelectedDate(new Date(new Date(selectedDate + "T00:00:00").getTime() - 86400000).toISOString().slice(0,10))}
                  className="p-1.5 rounded-lg border border-border hover:bg-accent transition-colors"><ChevronLeft className="w-4 h-4" /></button>
                <button onClick={() => setSelectedDate(TODAY)}
                  className="px-3 py-1.5 text-xs rounded-lg border border-border hover:bg-accent transition-colors">Today</button>
                <button onClick={() => setSelectedDate(new Date(new Date(selectedDate + "T00:00:00").getTime() + 86400000).toISOString().slice(0,10))}
                  className="p-1.5 rounded-lg border border-border hover:bg-accent transition-colors"><ChevronRight className="w-4 h-4" /></button>
              </div>
            </div>
          )}

          {/* Appointment cards */}
          {displayAppts.length === 0 ? (
            <div className="bg-card rounded-2xl border-2 border-dashed border-border/50 p-16 text-center">
              <CalendarDays className="w-12 h-12 text-muted-foreground/30 mx-auto mb-3" />
              <p className="font-medium text-muted-foreground">No appointments {view === "day" ? "on this day" : "found"}</p>
              <Link href="/appointments/book"
                className="mt-4 inline-flex items-center gap-2 wa-gradient text-white text-sm font-semibold px-5 py-2.5 rounded-xl hover:opacity-90 transition-all">
                <Plus className="w-4 h-4" /> Book Appointment
              </Link>
            </div>
          ) : (
            <div className="space-y-3">
              {displayAppts.map((appt) => (
                <AppointmentCard key={appt.id} appt={appt} onStatusChange={changeStatus} onSendWA={sendWA} />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* WhatsApp send confirmation modal */}
      {waModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-card border border-border rounded-2xl shadow-2xl w-full max-w-sm p-6 animate-fade-in">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold">Send via WhatsApp</h3>
              <button onClick={() => setWaModal(null)} className="p-1.5 rounded-lg hover:bg-muted/50 transition-colors"><X className="w-4 h-4" /></button>
            </div>

            <div className="bg-muted/20 rounded-xl p-4 mb-4">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-9 h-9 rounded-full wa-gradient flex items-center justify-center text-xs font-bold text-white">
                  {waModal.appt.contactName.split(" ").map((n) => n[0]).join("").slice(0,2).toUpperCase()}
                </div>
                <div>
                  <p className="text-sm font-semibold">{waModal.appt.contactName}</p>
                  <p className="text-xs text-muted-foreground">{waModal.appt.contactPhone}</p>
                </div>
              </div>
              {/* Preview message */}
              <div className="bg-[#0b141a] rounded-xl p-3">
                <div className="bg-[#202c33] rounded-xl rounded-tl-none p-3">
                  <p className="text-xs text-[#e9edef] leading-relaxed">
                    {waModal.action === "confirm" &&
                      `Hi ${waModal.appt.contactName}! ✅ Your ${SERVICE_META[waModal.appt.service].label} is confirmed for ${waModal.appt.date} at ${waModal.appt.time}. Duration: ${waModal.appt.duration} mins.\n\nReply YES to confirm or NO to reschedule.`}
                    {waModal.action === "reminder" &&
                      `Hi ${waModal.appt.contactName}! 🔔 Reminder: You have a ${SERVICE_META[waModal.appt.service].label} tomorrow at ${waModal.appt.time}.\n\nReply CONFIRM to confirm your attendance.`}
                    {waModal.action === "followup" &&
                      `Hi ${waModal.appt.contactName}! 😊 Thank you for your ${SERVICE_META[waModal.appt.service].label} today. We hope it was helpful!\n\nWould you like to book a follow-up? Reply BOOK to schedule.`}
                    {waModal.action === "reschedule" &&
                      `Hi ${waModal.appt.contactName}, we noticed you missed your appointment. No worries! 📅\n\nReply RESCHEDULE to pick a new date, or call us to book directly.`}
                  </p>
                  <p className="text-[9px] text-[#8696a0] text-right mt-1">12:30 ✓✓</p>
                </div>
              </div>
            </div>

            <div className="flex gap-3">
              <button onClick={() => setWaModal(null)} className="flex-1 px-4 py-2.5 rounded-xl border border-border text-sm hover:bg-muted/40 transition-colors">Cancel</button>
              <button onClick={confirmSendWA} className="flex-1 flex items-center justify-center gap-2 wa-gradient text-white text-sm font-semibold px-4 py-2.5 rounded-xl hover:opacity-90 transition-all">
                <Send className="w-4 h-4" /> Send Now
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
