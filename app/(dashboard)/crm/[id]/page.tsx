"use client";

import {
  ArrowLeft, Phone, Mail, Building2, Star, MessageSquare, Send,
  FileText, PhoneCall, Clock, Zap, Plus, Loader2, X, Edit2,
  DollarSign, TrendingUp, Calendar, CheckCircle2, XCircle,
  ChevronDown,
} from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState, useEffect, useCallback } from "react";
import { toast } from "sonner";

const STAGES = [
  { id: "new_lead",    label: "New Lead",   dot: "bg-slate-400",   color: "text-slate-400",   bg: "bg-slate-500/10",  border: "border-slate-500/30" },
  { id: "qualified",  label: "Qualified",  dot: "bg-blue-400",    color: "text-blue-400",    bg: "bg-blue-500/10",   border: "border-blue-500/30" },
  { id: "contacted",  label: "Contacted",  dot: "bg-violet-400",  color: "text-violet-400",  bg: "bg-violet-500/10", border: "border-violet-500/30" },
  { id: "interested", label: "Interested", dot: "bg-amber-400",   color: "text-amber-400",   bg: "bg-amber-500/10",  border: "border-amber-500/30" },
  { id: "converted",  label: "Converted",  dot: "bg-emerald-400", color: "text-emerald-400", bg: "bg-emerald-500/10",border: "border-emerald-500/30" },
  { id: "lost",       label: "Lost",       dot: "bg-red-400",     color: "text-red-400",     bg: "bg-red-500/10",    border: "border-red-500/30" },
];

const DEAL_STAGES = [
  { id: "prospecting",  label: "Prospecting",  prob: 20 },
  { id: "qualification",label: "Qualification", prob: 40 },
  { id: "proposal",     label: "Proposal",      prob: 60 },
  { id: "negotiation",  label: "Negotiation",   prob: 80 },
  { id: "closed_won",   label: "Won",           prob: 100 },
  { id: "closed_lost",  label: "Lost",          prob: 0 },
];

const ACTIVITY_META: Record<string, { icon: typeof FileText; color: string; label: string }> = {
  note:         { icon: FileText,     color: "text-blue-400 bg-blue-500/10",   label: "Note" },
  call:         { icon: PhoneCall,    color: "text-violet-400 bg-violet-500/10", label: "Call" },
  whatsapp:     { icon: MessageSquare,color: "text-emerald-400 bg-emerald-500/10", label: "WhatsApp" },
  email:        { icon: Mail,         color: "text-amber-400 bg-amber-500/10", label: "Email" },
  stage_change: { icon: Zap,          color: "text-primary bg-primary/10",     label: "Stage Change" },
  deal:         { icon: DollarSign,   color: "text-amber-400 bg-amber-500/10", label: "Deal" },
};

interface Activity { id: string; type: string; content: string; metadata: Record<string,string>; createdAt: string; }
interface Deal { id: string; title: string; value: number; stage: string; probability: number; expectedClose?: string; wonAt?: string; lostAt?: string; notes?: string; createdAt: string; }
interface Contact {
  id: string; name: string; phone: string; email?: string; company?: string;
  stage: string; score: number; value?: number | null; source: string;
  notes?: string; tags: string[]; lastContact?: string; addedDate?: string; group?: string;
}

function timeAgo(date: string) {
  const diff = Date.now() - new Date(date).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return new Date(date).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

export default function CRMContactDetailPage() {
  const { id } = useParams() as { id: string };
  const [contact, setContact] = useState<Contact | null>(null);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [deals, setDeals] = useState<Deal[]>([]);
  const [loading, setLoading] = useState(true);

  const [noteType, setNoteType] = useState<"note" | "call" | "email" | "whatsapp">("note");
  const [noteContent, setNoteContent] = useState("");
  const [savingNote, setSavingNote] = useState(false);

  const [showDealForm, setShowDealForm] = useState(false);
  const [dealForm, setDealForm] = useState({ title: "", value: "", stage: "prospecting", probability: "20", expectedClose: "", notes: "" });
  const [savingDeal, setSavingDeal] = useState(false);

  const [editScore, setEditScore] = useState(false);
  const [scoreInput, setScoreInput] = useState("");
  const [editNotes, setEditNotes] = useState(false);
  const [notesInput, setNotesInput] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/crm/contacts/${id}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setContact(data.contact);
      setActivities(data.activities || []);
      setDeals(data.deals || []);
      setScoreInput(String(data.contact.score));
      setNotesInput(data.contact.notes || "");
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to load contact");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const updateField = async (updates: Record<string, unknown>) => {
    try {
      const res = await fetch(`/api/crm/contacts/${id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      setContact((c) => c ? { ...c, ...updates } : c);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Update failed");
    }
  };

  const moveStage = async (newStage: string) => {
    await updateField({ stage: newStage });
    toast.success(`Moved to ${STAGES.find((s) => s.id === newStage)?.label}`);
    load();
  };

  const saveScore = async () => {
    const v = parseInt(scoreInput);
    if (isNaN(v) || v < 0 || v > 100) { toast.error("Score must be 0–100"); return; }
    await updateField({ score: v });
    setEditScore(false);
    toast.success("Score updated");
  };

  const saveNotes = async () => {
    await updateField({ notes: notesInput });
    setEditNotes(false);
    toast.success("Notes saved");
  };

  const addActivity = async () => {
    if (!noteContent.trim()) { toast.error("Enter a note"); return; }
    setSavingNote(true);
    try {
      const res = await fetch(`/api/crm/contacts/${id}/activities`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: noteType, content: noteContent }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setActivities((a) => [data, ...a]);
      setNoteContent("");
      toast.success("Activity logged");
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to log activity");
    } finally { setSavingNote(false); }
  };

  const addDeal = async () => {
    if (!dealForm.title) { toast.error("Deal title required"); return; }
    setSavingDeal(true);
    try {
      const res = await fetch("/api/crm/deals", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contactId: id, title: dealForm.title, value: Number(dealForm.value) || 0,
          stage: dealForm.stage, probability: Number(dealForm.probability) || 20,
          expectedClose: dealForm.expectedClose || null, notes: dealForm.notes || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setDeals((d) => [data, ...d]);
      setShowDealForm(false);
      setDealForm({ title: "", value: "", stage: "prospecting", probability: "20", expectedClose: "", notes: "" });
      toast.success("Deal created");
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to create deal");
    } finally { setSavingDeal(false); }
  };

  const updateDeal = async (dealId: string, updates: Record<string, unknown>) => {
    try {
      const res = await fetch(`/api/crm/deals/${dealId}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      setDeals((ds) => ds.map((d) => d.id === dealId ? { ...d, ...updates } : d));
      toast.success("Deal updated");
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Update failed");
    }
  };

  if (loading) return (
    <div className="flex items-center justify-center py-32"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
  );
  if (!contact) return (
    <div className="text-center py-32 text-muted-foreground">Contact not found. <Link href="/crm" className="text-primary hover:underline">Back to CRM</Link></div>
  );

  const currentStage = STAGES.find((s) => s.id === contact.stage) || STAGES[0];
  const scoreColor = contact.score >= 75 ? "text-emerald-400" : contact.score >= 50 ? "text-amber-400" : "text-red-400";
  const openDeals = deals.filter((d) => !["closed_won", "closed_lost"].includes(d.stage));
  const wonDeals  = deals.filter((d) => d.stage === "closed_won");
  const totalWon  = wonDeals.reduce((s, d) => s + d.value, 0);

  return (
    <div className="max-w-5xl space-y-6">
      {/* Header */}
      <div className="flex items-start gap-4">
        <Link href="/crm" className="p-2 rounded-xl hover:bg-accent border border-border transition-colors flex-shrink-0 mt-1">
          <ArrowLeft className="w-4 h-4" />
        </Link>
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between flex-wrap gap-3">
            <div className="flex items-center gap-4">
              <div className="w-14 h-14 rounded-2xl wa-gradient flex items-center justify-center text-xl font-black text-white flex-shrink-0 shadow-lg shadow-primary/25">
                {contact.name.split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase()}
              </div>
              <div>
                <h1 className="text-2xl font-bold">{contact.name}</h1>
                {contact.company && <p className="text-muted-foreground flex items-center gap-1.5"><Building2 className="w-3.5 h-3.5" />{contact.company}</p>}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Link href="/templates/send" className="flex items-center gap-2 wa-gradient text-white text-sm font-semibold px-4 py-2 rounded-xl hover:opacity-90 transition-all shadow-lg shadow-primary/25">
                <Send className="w-4 h-4" /> Send Message
              </Link>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left column — contact info + stage + score */}
        <div className="space-y-4">
          {/* Contact info */}
          <div className="bg-card border border-border/50 rounded-2xl p-5 space-y-3">
            <h3 className="text-sm font-semibold mb-1">Contact Info</h3>
            <div className="flex items-center gap-2.5 text-sm"><Phone className="w-4 h-4 text-muted-foreground flex-shrink-0" />{contact.phone}</div>
            {contact.email && <div className="flex items-center gap-2.5 text-sm"><Mail className="w-4 h-4 text-muted-foreground flex-shrink-0" />{contact.email}</div>}
            {contact.company && <div className="flex items-center gap-2.5 text-sm"><Building2 className="w-4 h-4 text-muted-foreground flex-shrink-0" />{contact.company}</div>}
            {contact.lastContact && (
              <div className="flex items-center gap-2.5 text-sm text-muted-foreground">
                <Clock className="w-4 h-4 flex-shrink-0" />Last contact: {new Date(contact.lastContact).toLocaleDateString("en-IN",{day:"numeric",month:"short",year:"numeric"})}
              </div>
            )}
            <div className="flex flex-wrap gap-1 pt-1">
              {contact.tags.map((t) => <span key={t} className="text-xs bg-muted/50 px-2 py-0.5 rounded text-muted-foreground">{t}</span>)}
            </div>
          </div>

          {/* Stage */}
          <div className="bg-card border border-border/50 rounded-2xl p-5">
            <h3 className="text-sm font-semibold mb-3">Pipeline Stage</h3>
            <div className="space-y-1.5">
              {STAGES.map((s) => (
                <button key={s.id} onClick={() => moveStage(s.id)}
                  className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-sm transition-all ${contact.stage === s.id ? `${s.bg} ${s.border} border ${s.color} font-semibold` : "hover:bg-muted/40 text-muted-foreground"}`}>
                  <span className={`w-2 h-2 rounded-full ${s.dot} flex-shrink-0`} />
                  {s.label}
                  {contact.stage === s.id && <CheckCircle2 className="w-3.5 h-3.5 ml-auto" />}
                </button>
              ))}
            </div>
          </div>

          {/* Score */}
          <div className="bg-card border border-border/50 rounded-2xl p-5">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold">Lead Score</h3>
              <button onClick={() => setEditScore(!editScore)} className="p-1.5 rounded-lg hover:bg-muted/50"><Edit2 className="w-3.5 h-3.5 text-muted-foreground" /></button>
            </div>
            {editScore ? (
              <div className="flex gap-2">
                <input type="number" min="0" max="100" value={scoreInput} onChange={(e) => setScoreInput(e.target.value)}
                  className="flex-1 bg-muted/50 border border-border rounded-xl px-3 py-2 text-sm outline-none focus:border-primary/60" />
                <button onClick={saveScore} className="p-2 rounded-xl bg-primary text-white hover:opacity-90"><CheckCircle2 className="w-4 h-4" /></button>
                <button onClick={() => setEditScore(false)} className="p-2 rounded-xl hover:bg-muted/50"><X className="w-4 h-4" /></button>
              </div>
            ) : (
              <div className="text-center">
                <div className={`text-4xl font-black mb-1 ${scoreColor}`}>{contact.score}</div>
                <div className="flex items-center gap-1 justify-center">
                  {[...Array(5)].map((_, i) => (
                    <Star key={i} className={`w-4 h-4 ${i < Math.round(contact.score / 20) ? "text-amber-400 fill-amber-400" : "text-muted-foreground"}`} />
                  ))}
                </div>
                <div className="w-full bg-muted/30 rounded-full h-2 mt-3 overflow-hidden">
                  <div className={`h-full rounded-full wa-gradient`} style={{ width: `${contact.score}%` }} />
                </div>
              </div>
            )}
          </div>

          {/* Deal value */}
          {contact.value != null && contact.value > 0 && (
            <div className="bg-emerald-500/5 border border-emerald-500/20 rounded-2xl p-5">
              <p className="text-xs text-muted-foreground mb-1">Deal Value</p>
              <p className="text-2xl font-black text-emerald-400">₹{contact.value.toLocaleString()}</p>
            </div>
          )}
        </div>

        {/* Right column — activities, deals, notes */}
        <div className="lg:col-span-2 space-y-5">
          {/* Deals section */}
          <div className="bg-card border border-border/50 rounded-2xl overflow-hidden">
            <div className="flex items-center justify-between p-5 border-b border-border/50">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-amber-500/10 flex items-center justify-center"><DollarSign className="w-4 h-4 text-amber-400" /></div>
                <div>
                  <p className="font-semibold text-sm">Deals</p>
                  <p className="text-xs text-muted-foreground">{openDeals.length} open · ₹{totalWon.toLocaleString()} won</p>
                </div>
              </div>
              <button onClick={() => setShowDealForm((v) => !v)}
                className="flex items-center gap-1.5 text-xs font-medium text-primary border border-primary/30 px-3 py-1.5 rounded-xl hover:bg-primary/10 transition-colors">
                <Plus className="w-3.5 h-3.5" /> New Deal
              </button>
            </div>

            {showDealForm && (
              <div className="p-5 border-b border-border/50 bg-muted/5 space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div className="col-span-2">
                    <label className="text-xs font-medium text-muted-foreground block mb-1">Deal Title *</label>
                    <input value={dealForm.title} onChange={(e) => setDealForm((p) => ({ ...p, title: e.target.value }))} placeholder="Product License Deal"
                      className="w-full bg-muted/50 border border-border rounded-xl px-3 py-2 text-sm outline-none focus:border-primary/60" />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-muted-foreground block mb-1">Value (₹)</label>
                    <input type="number" value={dealForm.value} onChange={(e) => setDealForm((p) => ({ ...p, value: e.target.value }))} placeholder="50000"
                      className="w-full bg-muted/50 border border-border rounded-xl px-3 py-2 text-sm outline-none focus:border-primary/60" />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-muted-foreground block mb-1">Expected Close</label>
                    <input type="date" value={dealForm.expectedClose} onChange={(e) => setDealForm((p) => ({ ...p, expectedClose: e.target.value }))}
                      className="w-full bg-muted/50 border border-border rounded-xl px-3 py-2 text-sm outline-none focus:border-primary/60" />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-muted-foreground block mb-1">Stage</label>
                    <select value={dealForm.stage} onChange={(e) => setDealForm((p) => ({ ...p, stage: e.target.value, probability: String(DEAL_STAGES.find((s) => s.id === e.target.value)?.prob || 20) }))}
                      className="w-full bg-muted/50 border border-border rounded-xl px-3 py-2 text-sm outline-none focus:border-primary/60">
                      {DEAL_STAGES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="text-xs font-medium text-muted-foreground block mb-1">Probability (%)</label>
                    <input type="number" min="0" max="100" value={dealForm.probability} onChange={(e) => setDealForm((p) => ({ ...p, probability: e.target.value }))}
                      className="w-full bg-muted/50 border border-border rounded-xl px-3 py-2 text-sm outline-none focus:border-primary/60" />
                  </div>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => setShowDealForm(false)} className="flex-1 py-2 rounded-xl border border-border text-sm hover:bg-accent">Cancel</button>
                  <button onClick={addDeal} disabled={savingDeal} className="flex-1 flex items-center justify-center gap-2 wa-gradient text-white text-sm font-semibold py-2 rounded-xl hover:opacity-90 disabled:opacity-50">
                    {savingDeal ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />} Create Deal
                  </button>
                </div>
              </div>
            )}

            {deals.length === 0 ? (
              <div className="py-8 text-center text-sm text-muted-foreground">No deals yet. Create one to track this opportunity.</div>
            ) : (
              <div className="divide-y divide-border/30">
                {deals.map((deal) => {
                  const ds = DEAL_STAGES.find((s) => s.id === deal.stage);
                  const isWon  = deal.stage === "closed_won";
                  const isLost = deal.stage === "closed_lost";
                  return (
                    <div key={deal.id} className="px-5 py-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <p className="font-semibold text-sm">{deal.title}</p>
                          <p className={`text-xl font-bold mt-0.5 ${isWon ? "text-emerald-400" : isLost ? "text-red-400 line-through opacity-50" : "text-foreground"}`}>
                            ₹{deal.value.toLocaleString()}
                          </p>
                          {deal.expectedClose && (
                            <p className="text-xs text-muted-foreground flex items-center gap-1 mt-1">
                              <Calendar className="w-3 h-3" />Close: {new Date(deal.expectedClose).toLocaleDateString("en-IN",{day:"numeric",month:"short",year:"numeric"})}
                            </p>
                          )}
                        </div>
                        <div className="text-right flex-shrink-0">
                          <div className={`inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-full ${isWon ? "bg-emerald-500/10 text-emerald-400" : isLost ? "bg-red-500/10 text-red-400" : "bg-muted text-muted-foreground"}`}>
                            {isWon ? <CheckCircle2 className="w-3 h-3" /> : isLost ? <XCircle className="w-3 h-3" /> : <TrendingUp className="w-3 h-3" />}
                            {ds?.label}
                          </div>
                          {!isWon && !isLost && (
                            <p className="text-xs text-muted-foreground mt-1">{deal.probability}% probability</p>
                          )}
                          {!isWon && !isLost && (
                            <div className="flex gap-1 mt-2 justify-end">
                              <button onClick={() => updateDeal(deal.id, { stage: "closed_won" })}
                                className="text-[10px] px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20">Won</button>
                              <button onClick={() => updateDeal(deal.id, { stage: "closed_lost" })}
                                className="text-[10px] px-2 py-0.5 rounded bg-red-500/10 text-red-400 hover:bg-red-500/20">Lost</button>
                            </div>
                          )}
                        </div>
                      </div>
                      {!isWon && !isLost && (
                        <div className="mt-2.5 flex items-center gap-2">
                          <div className="flex-1 h-1.5 bg-muted/30 rounded-full overflow-hidden">
                            <div className="h-full wa-gradient rounded-full" style={{ width: `${deal.probability}%` }} />
                          </div>
                          <select value={deal.stage} onChange={(e) => updateDeal(deal.id, { stage: e.target.value, probability: DEAL_STAGES.find((s) => s.id === e.target.value)?.prob || deal.probability })}
                            className="text-xs bg-muted/50 border border-border rounded-lg px-2 py-1 outline-none focus:border-primary/60">
                            {DEAL_STAGES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
                          </select>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Notes */}
          <div className="bg-card border border-border/50 rounded-2xl p-5">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold text-sm">Notes</h3>
              <button onClick={() => setEditNotes(!editNotes)} className="p-1.5 rounded-lg hover:bg-muted/50"><Edit2 className="w-3.5 h-3.5 text-muted-foreground" /></button>
            </div>
            {editNotes ? (
              <div className="space-y-2">
                <textarea rows={4} value={notesInput} onChange={(e) => setNotesInput(e.target.value)} placeholder="Add notes about this contact…"
                  className="w-full bg-muted/50 border border-border rounded-xl px-3 py-2 text-sm outline-none focus:border-primary/60 resize-none" />
                <div className="flex gap-2">
                  <button onClick={() => setEditNotes(false)} className="flex-1 py-2 rounded-xl border border-border text-sm hover:bg-accent">Cancel</button>
                  <button onClick={saveNotes} className="flex-1 py-2 rounded-xl wa-gradient text-white text-sm font-semibold hover:opacity-90">Save</button>
                </div>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground leading-relaxed">
                {contact.notes || <span className="italic opacity-50">No notes yet. Click edit to add.</span>}
              </p>
            )}
          </div>

          {/* Activity log */}
          <div className="bg-card border border-border/50 rounded-2xl overflow-hidden">
            <div className="p-5 border-b border-border/50">
              <h3 className="font-semibold text-sm">Activity Timeline</h3>
            </div>

            {/* Add activity */}
            <div className="p-5 border-b border-border/50 bg-muted/5">
              <div className="flex items-center gap-2 mb-3">
                {(["note","call","email","whatsapp"] as const).map((t) => {
                  const m = ACTIVITY_META[t];
                  return (
                    <button key={t} onClick={() => setNoteType(t)}
                      className={`flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-xl border transition-all ${noteType === t ? "border-primary/40 bg-primary/10 text-primary" : "border-border hover:bg-accent text-muted-foreground"}`}>
                      <m.icon className="w-3 h-3" />{m.label}
                    </button>
                  );
                })}
              </div>
              <div className="flex gap-2">
                <textarea rows={2} value={noteContent} onChange={(e) => setNoteContent(e.target.value)}
                  placeholder={`Log a ${ACTIVITY_META[noteType].label.toLowerCase()}…`}
                  className="flex-1 bg-muted/50 border border-border rounded-xl px-3 py-2 text-sm outline-none focus:border-primary/60 resize-none" />
                <button onClick={addActivity} disabled={savingNote || !noteContent.trim()}
                  className="flex-shrink-0 flex items-center justify-center gap-1.5 wa-gradient text-white text-sm font-semibold px-4 rounded-xl hover:opacity-90 disabled:opacity-40">
                  {savingNote ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {/* Timeline */}
            <div className="divide-y divide-border/30 max-h-96 overflow-y-auto">
              {activities.length === 0 ? (
                <div className="py-8 text-center text-sm text-muted-foreground">No activities yet. Log the first one above.</div>
              ) : activities.map((a) => {
                const meta = ACTIVITY_META[a.type] || ACTIVITY_META.note;
                const Icon = meta.icon;
                const [bgClass, textClass] = meta.color.split(" ");
                return (
                  <div key={a.id} className="flex items-start gap-3 px-5 py-4">
                    <div className={`w-7 h-7 rounded-lg ${bgClass} flex items-center justify-center flex-shrink-0 mt-0.5`}>
                      <Icon className={`w-3.5 h-3.5 ${textClass}`} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className="text-xs font-semibold">{meta.label}</span>
                        <span className="text-xs text-muted-foreground">{timeAgo(a.createdAt)}</span>
                      </div>
                      <p className="text-sm text-muted-foreground leading-relaxed">{a.content}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
