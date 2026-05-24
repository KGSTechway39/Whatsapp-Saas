"use client";

import { PageHeader } from "@/components/shared/PageHeader";
import {
  Calendar, Clock, User, Phone, Mail, FileText, Check,
  ChevronLeft, ChevronRight, Zap, MessageSquare, Send,
  CheckCircle2, ArrowLeft, Bell, RefreshCw, Loader2, Plus,
} from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";

type ServiceType = "consultation" | "follow_up" | "demo" | "checkup" | "meeting" | "callback";

const SERVICES: { id: ServiceType; label: string; duration: number; desc: string; color: string; bg: string }[] = [
  { id: "consultation", label: "Consultation",  duration: 30, desc: "Initial discussion & needs assessment",  color: "text-blue-400",    bg: "bg-blue-500/10"    },
  { id: "demo",         label: "Product Demo",  duration: 45, desc: "Live product walkthrough",               color: "text-violet-400",  bg: "bg-violet-500/10"  },
  { id: "follow_up",    label: "Follow-up",     duration: 15, desc: "Check-in after previous interaction",    color: "text-emerald-400", bg: "bg-emerald-500/10" },
  { id: "checkup",      label: "Check-up",      duration: 30, desc: "Periodic review or health check",        color: "text-cyan-400",    bg: "bg-cyan-500/10"    },
  { id: "meeting",      label: "Strategy Meet", duration: 60, desc: "In-depth strategy or planning session",  color: "text-amber-400",   bg: "bg-amber-500/10"   },
  { id: "callback",     label: "Callback",      duration: 15, desc: "Quick call or price discussion",         color: "text-pink-400",    bg: "bg-pink-500/10"    },
];

const TIME_SLOTS = [
  "09:00","09:30","10:00","10:30","11:00","11:30",
  "12:00","13:00","13:30","14:00","14:30","15:00",
  "15:30","16:00","16:30","17:00","17:30","18:00",
];

const BOOKED_SLOTS: Record<string, string[]> = {
  "2026-04-26": ["09:00","10:30","14:00","15:30"],
  "2026-04-27": ["09:30","11:00"],
  "2026-04-28": ["10:00","14:30"],
};

const AUTOMATION_OPTS = [
  { id: "auto_confirm",   label: "Auto-send Confirmation",     icon: CheckCircle2, desc: "Instantly send a WhatsApp confirmation to the contact" },
  { id: "reminder_24h",   label: "24h Reminder",               icon: Bell,         desc: "Auto-remind 24 hours before appointment" },
  { id: "reminder_1h",    label: "1h Reminder",                icon: Clock,        desc: "Auto-remind 1 hour before appointment" },
  { id: "followup_after", label: "Post-appointment Follow-up", icon: MessageSquare,desc: "Send a follow-up message 2 hours after completion" },
  { id: "noshow_rebook",  label: "No-show Re-booking",         icon: RefreshCw,    desc: "If no-show, auto-send reschedule invite" },
];

const STEPS = ["Service", "Date & Time", "Contact", "Automation", "Confirm"];

export default function BookAppointmentPage() {
  const [step, setStep] = useState(1);
  const [booked, setBooked] = useState(false);
  const [saving, setSaving] = useState(false);

  // form state
  const [service, setService]       = useState<ServiceType | "">("");
  const [selectedDate, setSelDate]  = useState("");
  const [selectedTime, setSelTime]  = useState("");
  const [currentMonth, setMonth]    = useState(new Date(2026, 3, 1));
  const [contact, setContact]       = useState({ name: "", phone: "", email: "", notes: "", assignedTo: "" });
  const [automations, setAutomations] = useState<string[]>(["auto_confirm","reminder_24h"]);

  const year  = currentMonth.getFullYear();
  const month = currentMonth.getMonth();
  const firstDay   = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const calDays    = Array.from({ length: daysInMonth }, (_, i) => i + 1);
  const pad        = Array.from({ length: firstDay });
  const TODAY      = "2026-04-26";

  const selectedService = SERVICES.find((s) => s.id === service);

  const bookedForDate  = BOOKED_SLOTS[selectedDate] || [];
  const availableSlots = TIME_SLOTS.filter((t) => !bookedForDate.includes(t));

  const toggleAutomation = (id: string) =>
    setAutomations((prev) => prev.includes(id) ? prev.filter((a) => a !== id) : [...prev, id]);

  const canProceed: Record<number, boolean> = {
    1: !!service,
    2: !!selectedDate && !!selectedTime,
    3: !!contact.name && !!contact.phone,
    4: true,
    5: true,
  };

  const handleBook = async () => {
    setSaving(true);
    await new Promise((r) => setTimeout(r, 1200));
    setSaving(false);
    setBooked(true);
    toast.success("Appointment booked! WhatsApp confirmation sent.");
  };

  if (booked) {
    return (
      <div className="max-w-lg mx-auto text-center py-16">
        <div className="w-24 h-24 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-5">
          <CheckCircle2 className="w-12 h-12 text-primary" />
        </div>
        <h2 className="text-2xl font-bold mb-2">Appointment Booked! 🎉</h2>
        <p className="text-muted-foreground mb-1">{contact.name} · {selectedDate} at {selectedTime}</p>
        <p className="text-sm text-emerald-400 font-medium mb-1">{selectedService?.label} · {selectedService?.duration} mins</p>
        {automations.length > 0 && (
          <p className="text-xs text-violet-400 bg-violet-500/10 border border-violet-500/20 rounded-xl px-4 py-2 mb-6 inline-block">
            ⚡ {automations.length} automation(s) active — reminders will be sent automatically
          </p>
        )}
        <div className="flex gap-3 justify-center">
          <Link href="/appointments" className="wa-gradient text-white text-sm font-semibold px-5 py-2.5 rounded-xl hover:opacity-90 transition-all shadow-lg shadow-primary/25">
            View Appointments
          </Link>
          <button onClick={() => { setBooked(false); setStep(1); setService(""); setSelDate(""); setSelTime(""); setContact({ name:"",phone:"",email:"",notes:"",assignedTo:"" }); }}
            className="px-5 py-2.5 rounded-xl border border-border hover:bg-accent text-sm font-medium transition-colors">
            Book Another
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl">
      <PageHeader title="Book Appointment" subtitle="Schedule and send automatic WhatsApp confirmations & reminders" />

      {/* Step bar */}
      <div className="flex items-center gap-1.5 mb-8 overflow-x-auto pb-2">
        {STEPS.map((s, i) => {
          const num = i + 1;
          return (
            <div key={s} className="flex items-center gap-1.5 flex-shrink-0">
              <button onClick={() => num < step && setStep(num)} className="flex items-center gap-1.5">
                <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold transition-all ${
                  step > num ? "bg-primary text-white" : step === num ? "bg-primary/20 border-2 border-primary text-primary" : "bg-muted text-muted-foreground"
                }`}>
                  {step > num ? <Check className="w-3 h-3" /> : num}
                </div>
                <span className={`text-xs font-medium ${step === num ? "text-foreground" : "text-muted-foreground"}`}>{s}</span>
              </button>
              {i < STEPS.length - 1 && <div className="w-5 h-px bg-border" />}
            </div>
          );
        })}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        <div className="lg:col-span-3">
          <div className="bg-card rounded-2xl border border-border/50 p-6">

            {/* Step 1: Service */}
            {step === 1 && (
              <div className="space-y-4">
                <h3 className="font-semibold">Select Service Type</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {SERVICES.map((s) => (
                    <button key={s.id} onClick={() => setService(s.id)}
                      className={`text-left p-4 rounded-xl border transition-all ${service === s.id ? "border-primary bg-primary/5" : "border-border hover:bg-muted/30"}`}>
                      <div className="flex items-center justify-between mb-2">
                        <span className={`text-xs font-semibold px-2 py-0.5 rounded-lg ${s.bg} ${s.color}`}>{s.label}</span>
                        {service === s.id && <Check className="w-4 h-4 text-primary" />}
                      </div>
                      <p className="text-xs text-muted-foreground">{s.desc}</p>
                      <p className={`text-xs font-medium mt-2 ${s.color}`}><Clock className="w-3 h-3 inline mr-1" />{s.duration} mins</p>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Step 2: Date & Time */}
            {step === 2 && (
              <div className="space-y-5">
                <h3 className="font-semibold">Pick Date & Time</h3>
                {/* Mini calendar */}
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <button onClick={() => setMonth(new Date(year, month-1, 1))} className="p-1.5 rounded-lg border border-border hover:bg-accent transition-colors"><ChevronLeft className="w-4 h-4" /></button>
                    <p className="text-sm font-semibold">{currentMonth.toLocaleDateString("en",{month:"long",year:"numeric"})}</p>
                    <button onClick={() => setMonth(new Date(year, month+1, 1))} className="p-1.5 rounded-lg border border-border hover:bg-accent transition-colors"><ChevronRight className="w-4 h-4" /></button>
                  </div>
                  <div className="grid grid-cols-7 gap-1 mb-1">
                    {["Su","Mo","Tu","We","Th","Fr","Sa"].map((d) => (
                      <p key={d} className="text-center text-[10px] text-muted-foreground font-medium">{d}</p>
                    ))}
                  </div>
                  <div className="grid grid-cols-7 gap-1">
                    {pad.map((_, i) => <div key={i} />)}
                    {calDays.map((d) => {
                      const ds = `${year}-${String(month+1).padStart(2,"0")}-${String(d).padStart(2,"0")}`;
                      const isPast = ds < TODAY;
                      const isSel  = ds === selectedDate;
                      return (
                        <button key={d} onClick={() => !isPast && setSelDate(ds)} disabled={isPast}
                          className={`h-8 w-full rounded-lg text-xs flex items-center justify-center transition-all ${
                            isSel   ? "wa-gradient text-white font-bold shadow" :
                            isPast  ? "text-muted-foreground/30 cursor-not-allowed" :
                                      "hover:bg-muted/50"
                          }`}>{d}</button>
                      );
                    })}
                  </div>
                </div>

                {/* Time slots */}
                {selectedDate && (
                  <div>
                    <p className="text-sm font-medium mb-3">Available slots — {new Date(selectedDate + "T00:00:00").toLocaleDateString("en",{weekday:"long",day:"numeric",month:"short"})}</p>
                    <div className="grid grid-cols-4 sm:grid-cols-6 gap-2">
                      {TIME_SLOTS.map((t) => {
                        const booked = bookedForDate.includes(t);
                        const isSel  = t === selectedTime;
                        return (
                          <button key={t} onClick={() => !booked && setSelTime(t)} disabled={booked}
                            className={`py-2 rounded-xl text-xs font-semibold transition-all ${
                              isSel  ? "wa-gradient text-white shadow" :
                              booked ? "bg-muted/30 text-muted-foreground/40 cursor-not-allowed line-through" :
                                       "bg-muted/50 hover:bg-primary/10 hover:text-primary border border-border"
                            }`}>{t}</button>
                        );
                      })}
                    </div>
                    <p className="text-xs text-muted-foreground mt-2">{availableSlots.length} slots available</p>
                  </div>
                )}
              </div>
            )}

            {/* Step 3: Contact details */}
            {step === 3 && (
              <div className="space-y-4">
                <h3 className="font-semibold">Contact Details</h3>
                {[
                  { key:"name",       label:"Full Name *",     placeholder:"Rajesh Kumar",           icon: User,     type:"text" },
                  { key:"phone",      label:"Phone Number *",  placeholder:"+91 98765 43210",         icon: Phone,    type:"tel" },
                  { key:"email",      label:"Email",           placeholder:"rajesh@email.com",        icon: Mail,     type:"email" },
                  { key:"assignedTo", label:"Assign To (staff)",placeholder:"Agent name (optional)",  icon: User,     type:"text" },
                ].map(({ key, label, placeholder, icon: Icon, type }) => (
                  <div key={key}>
                    <label className="text-sm font-medium block mb-1.5">{label}</label>
                    <div className="relative">
                      <Icon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                      <input type={type} value={(contact as Record<string,string>)[key]}
                        onChange={(e) => setContact((p) => ({ ...p, [key]: e.target.value }))}
                        placeholder={placeholder}
                        className="w-full bg-muted/50 border border-border rounded-xl pl-10 pr-4 py-2.5 text-sm outline-none focus:border-primary/60 focus:ring-2 focus:ring-primary/20 transition-all" />
                    </div>
                  </div>
                ))}
                <div>
                  <label className="text-sm font-medium block mb-1.5">Notes</label>
                  <div className="relative">
                    <FileText className="absolute left-3 top-3 w-4 h-4 text-muted-foreground" />
                    <textarea value={contact.notes} onChange={(e) => setContact((p) => ({ ...p, notes: e.target.value }))}
                      placeholder="Any special requirements or notes…" rows={3}
                      className="w-full bg-muted/50 border border-border rounded-xl pl-10 pr-4 py-2.5 text-sm outline-none focus:border-primary/60 transition-all resize-none" />
                  </div>
                </div>
              </div>
            )}

            {/* Step 4: Automation */}
            {step === 4 && (
              <div className="space-y-4">
                <div>
                  <h3 className="font-semibold">WhatsApp Automation</h3>
                  <p className="text-xs text-muted-foreground mt-1">Select which automated WhatsApp messages to send for this appointment</p>
                </div>
                <div className="space-y-2.5">
                  {AUTOMATION_OPTS.map(({ id, label, icon: Icon, desc }) => (
                    <button key={id} onClick={() => toggleAutomation(id)}
                      className={`w-full text-left p-4 rounded-xl border transition-all ${automations.includes(id) ? "border-violet-500/50 bg-violet-500/5" : "border-border hover:bg-muted/30"}`}>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${automations.includes(id) ? "bg-violet-500/20" : "bg-muted/50"}`}>
                            <Icon className={`w-4 h-4 ${automations.includes(id) ? "text-violet-400" : "text-muted-foreground"}`} />
                          </div>
                          <div>
                            <p className="text-sm font-medium">{label}</p>
                            <p className="text-xs text-muted-foreground">{desc}</p>
                          </div>
                        </div>
                        <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition-all ${automations.includes(id) ? "bg-violet-500 border-violet-500" : "border-muted-foreground/40"}`}>
                          {automations.includes(id) && <Check className="w-3 h-3 text-white" />}
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
                <div className="p-3 bg-muted/20 rounded-xl text-xs text-muted-foreground border border-border/50">
                  {automations.length === 0 ? "No automations selected — you'll handle messages manually." :
                    `${automations.length} automation(s) will run automatically via WhatsApp for this appointment.`}
                </div>
              </div>
            )}

            {/* Step 5: Confirm */}
            {step === 5 && (
              <div className="space-y-5">
                <h3 className="font-semibold">Review & Confirm</h3>
                <div className="space-y-3 bg-muted/20 rounded-xl p-5">
                  {[
                    { label: "Contact",    value: `${contact.name} · ${contact.phone}` },
                    { label: "Service",    value: `${selectedService?.label} (${selectedService?.duration} mins)` },
                    { label: "Date",       value: selectedDate ? new Date(selectedDate + "T00:00:00").toLocaleDateString("en",{weekday:"long",day:"numeric",month:"long",year:"numeric"}) : "—" },
                    { label: "Time",       value: selectedTime || "—" },
                    { label: "Assigned To",value: contact.assignedTo || "Unassigned" },
                    { label: "Automations",value: automations.length > 0 ? `${automations.length} active` : "None" },
                  ].map(({ label, value }) => (
                    <div key={label} className="flex items-start justify-between py-2 border-b border-border/30 last:border-0">
                      <span className="text-sm text-muted-foreground">{label}</span>
                      <span className="text-sm font-medium text-right max-w-[55%]">{value}</span>
                    </div>
                  ))}
                </div>
                {contact.notes && (
                  <div className="p-3 bg-muted/20 rounded-xl border border-border/50">
                    <p className="text-xs font-medium mb-1 text-muted-foreground">Notes</p>
                    <p className="text-sm italic">"{contact.notes}"</p>
                  </div>
                )}
                {automations.length > 0 && (
                  <div className="p-4 bg-violet-500/5 border border-violet-500/20 rounded-xl">
                    <p className="text-xs font-semibold text-violet-400 flex items-center gap-1.5 mb-2">
                      <Zap className="w-3.5 h-3.5" /> WhatsApp Automations Active
                    </p>
                    <div className="space-y-1">
                      {automations.map((id) => {
                        const a = AUTOMATION_OPTS.find((o) => o.id === id)!;
                        return (
                          <p key={id} className="text-xs text-muted-foreground flex items-center gap-1.5">
                            <Check className="w-3 h-3 text-violet-400 flex-shrink-0" />{a.label}
                          </p>
                        );
                      })}
                    </div>
                  </div>
                )}
                <button onClick={handleBook} disabled={saving}
                  className="flex items-center justify-center gap-2 w-full wa-gradient text-white font-semibold py-3.5 rounded-xl hover:opacity-90 transition-all disabled:opacity-50 shadow-lg shadow-primary/25">
                  {saving ? <><Loader2 className="w-4 h-4 animate-spin" /> Booking…</> : <><Calendar className="w-4 h-4" /> Confirm Booking</>}
                </button>
              </div>
            )}

            {/* Nav */}
            <div className="flex gap-3 mt-6 pt-4 border-t border-border/50">
              {step > 1 ? (
                <button onClick={() => setStep((p) => p-1)} className="flex items-center gap-2 px-4 py-2.5 rounded-xl border border-border hover:bg-accent text-sm font-medium transition-colors">
                  <ArrowLeft className="w-4 h-4" /> Back
                </button>
              ) : (
                <Link href="/appointments" className="flex items-center gap-2 px-4 py-2.5 rounded-xl border border-border hover:bg-accent text-sm font-medium transition-colors">
                  <ArrowLeft className="w-4 h-4" /> Back
                </Link>
              )}
              {step < STEPS.length && (
                <button onClick={() => canProceed[step] && setStep((p) => p+1)} disabled={!canProceed[step]}
                  className="flex items-center gap-2 wa-gradient text-white font-semibold px-5 py-2.5 rounded-xl hover:opacity-90 transition-all disabled:opacity-40 disabled:cursor-not-allowed ml-auto">
                  Next <ChevronRight className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>
        </div>

        {/* ── Right: Summary ── */}
        <div className="lg:col-span-2">
          <div className="bg-card rounded-2xl border border-border/50 p-5 sticky top-24 space-y-4">
            <p className="text-sm font-semibold">Booking Summary</p>
            {selectedService && (
              <div className={`flex items-center gap-2.5 p-3 rounded-xl ${selectedService.bg}`}>
                <Calendar className={`w-4 h-4 ${selectedService.color}`} />
                <div>
                  <p className={`text-sm font-semibold ${selectedService.color}`}>{selectedService.label}</p>
                  <p className="text-xs text-muted-foreground">{selectedService.duration} minutes</p>
                </div>
              </div>
            )}
            {selectedDate && selectedTime && (
              <div className="flex items-center gap-2.5 p-3 rounded-xl bg-primary/5 border border-primary/20">
                <Clock className="w-4 h-4 text-primary" />
                <div>
                  <p className="text-sm font-semibold">{selectedTime}</p>
                  <p className="text-xs text-muted-foreground">{new Date(selectedDate + "T00:00:00").toLocaleDateString("en",{weekday:"short",day:"numeric",month:"short"})}</p>
                </div>
              </div>
            )}
            {contact.name && (
              <div className="flex items-center gap-2.5 p-3 rounded-xl bg-muted/20">
                <User className="w-4 h-4 text-muted-foreground" />
                <div>
                  <p className="text-sm font-semibold">{contact.name}</p>
                  <p className="text-xs text-muted-foreground">{contact.phone || "—"}</p>
                </div>
              </div>
            )}

            {/* Automation badges */}
            {automations.length > 0 && (
              <div>
                <p className="text-xs font-medium text-violet-400 flex items-center gap-1 mb-2"><Zap className="w-3 h-3" /> Active Automations</p>
                <div className="space-y-1.5">
                  {automations.map((id) => {
                    const a = AUTOMATION_OPTS.find((o) => o.id === id)!;
                    const AIcon = a.icon;
                    return (
                      <div key={id} className="flex items-center gap-2 text-xs text-muted-foreground bg-violet-500/5 border border-violet-500/10 px-3 py-2 rounded-lg">
                        <AIcon className="w-3 h-3 text-violet-400 flex-shrink-0" />{a.label}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* WA message preview */}
            {selectedDate && selectedTime && contact.name && (
              <div>
                <p className="text-xs text-muted-foreground mb-2">WhatsApp Confirmation Preview</p>
                <div className="bg-[#0b141a] rounded-xl p-3">
                  <div className="bg-[#202c33] rounded-xl rounded-tl-none p-3">
                    <p className="text-xs text-[#e9edef] leading-relaxed">
                      {`Hi ${contact.name || "[Name]"}! ✅ Your ${selectedService?.label || "appointment"} is confirmed.\n\n📅 ${selectedDate}\n⏰ ${selectedTime} (${selectedService?.duration} mins)\n\nReply YES to confirm or NO to reschedule.`}
                    </p>
                    <p className="text-[9px] text-[#8696a0] text-right mt-1">Now ✓✓</p>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
