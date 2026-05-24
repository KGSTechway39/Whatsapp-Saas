"use client";

import { PageHeader } from "@/components/shared/PageHeader";
import {
  Users, Plus, MessageSquare, Search, Star, Phone, Mail,
  MoreHorizontal, Zap, Megaphone, BarChart3, X, Send,
  ArrowRight, Loader2, AlertCircle, Layout, List, TrendingUp,
  DollarSign, Target, RefreshCw, ChevronRight,
} from "lucide-react";
import Link from "next/link";
import { useState, useEffect, useCallback, useRef } from "react";
import { toast } from "sonner";
import { contacts as contactsApi } from "@/lib/api";

const STAGES = [
  { id: "new_lead",    label: "New Lead",   color: "text-slate-400",   bg: "bg-slate-500/10",  border: "border-slate-500/30",  dot: "bg-slate-400" },
  { id: "qualified",  label: "Qualified",  color: "text-blue-400",    bg: "bg-blue-500/10",   border: "border-blue-500/30",   dot: "bg-blue-400" },
  { id: "contacted",  label: "Contacted",  color: "text-violet-400",  bg: "bg-violet-500/10", border: "border-violet-500/30", dot: "bg-violet-400" },
  { id: "interested", label: "Interested", color: "text-amber-400",   bg: "bg-amber-500/10",  border: "border-amber-500/30",  dot: "bg-amber-400" },
  { id: "converted",  label: "Converted",  color: "text-emerald-400", bg: "bg-emerald-500/10",border: "border-emerald-500/30",dot: "bg-emerald-400" },
  { id: "lost",       label: "Lost",       color: "text-red-400",     bg: "bg-red-500/10",    border: "border-red-500/30",    dot: "bg-red-400" },
] as const;
type StageId = typeof STAGES[number]["id"];

interface CRMContact {
  id: string; name: string; phone: string; email?: string; company?: string;
  stage: StageId; score: number; tags: string[]; lastContact?: string;
  value?: number | null; source: string; notes?: string;
}
interface PipelineSummary {
  totalContacts: number; conversionRate: number; totalPipelineValue: number;
  weightedPipelineValue: number; wonValue: number; openDeals: number;
}
interface PipelineStage { stage: string; count: number; totalValue: number; avgScore: number; }

const SOURCE_BADGE: Record<string, string> = {
  whatsapp: "bg-green-500/10 text-green-400", import: "bg-blue-500/10 text-blue-400",
  campaign: "bg-purple-500/10 text-purple-400", manual: "bg-muted/50 text-muted-foreground",
};

function ScoreRing({ score }: { score: number }) {
  const color = score >= 75 ? "text-emerald-400" : score >= 50 ? "text-amber-400" : "text-red-400";
  return <span className={`flex items-center gap-1 text-xs font-bold ${color}`}><Star className="w-3 h-3" />{score}</span>;
}

function StageMenu({ contactId, current, onMove }: { contactId: string; current: StageId; onMove: (id: string, s: StageId) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);
  const stage = STAGES.find((s) => s.id === current)!;
  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen((v) => !v)} className={`flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full border ${stage.bg} ${stage.color} ${stage.border}`}>
        <span className={`w-1.5 h-1.5 rounded-full ${stage.dot}`} />{stage.label}
        <ChevronRight className="w-3 h-3 opacity-60" />
      </button>
      {open && (
        <div className="absolute left-0 top-8 z-30 bg-card border border-border rounded-xl shadow-xl w-40 overflow-hidden">
          {STAGES.filter((s) => s.id !== current).map((s) => (
            <button key={s.id} onClick={() => { onMove(contactId, s.id); setOpen(false); }}
              className="w-full text-left px-3 py-2 text-xs hover:bg-muted/40 transition-colors flex items-center gap-2">
              <span className={`w-2 h-2 rounded-full flex-shrink-0 ${s.dot}`} />{s.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function KanbanCard({ contact, onMove, onMessage }: { contact: CRMContact; onMove: (id: string, s: StageId) => void; onMessage: (c: CRMContact) => void }) {
  const stageIdx = STAGES.findIndex((s) => s.id === contact.stage);
  return (
    <Link href={`/crm/${contact.id}`} className="block bg-card border border-border/50 rounded-xl p-3 hover:border-border hover:shadow-sm transition-all">
      <div className="flex items-start justify-between mb-2">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-7 h-7 rounded-full wa-gradient flex items-center justify-center text-[10px] font-bold text-white flex-shrink-0">
            {contact.name.split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase()}
          </div>
          <div className="min-w-0">
            <p className="text-xs font-semibold truncate">{contact.name}</p>
            {contact.company && <p className="text-[10px] text-muted-foreground truncate">{contact.company}</p>}
          </div>
        </div>
        <ScoreRing score={contact.score} />
      </div>
      <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground mb-2"><Phone className="w-3 h-3" />{contact.phone}</p>
      {(contact.value != null && contact.value > 0) && (
        <p className="text-[10px] font-bold text-emerald-400 mb-2">₹{contact.value.toLocaleString()}</p>
      )}
      <div className="flex items-center gap-2 pt-2 border-t border-border/30" onClick={(e) => e.preventDefault()}>
        <button onClick={(e) => { e.preventDefault(); onMessage(contact); }} className="flex items-center gap-1 text-[10px] font-medium text-primary hover:underline">
          <MessageSquare className="w-3 h-3" />Message
        </button>
        {stageIdx < STAGES.length - 2 && (
          <button onClick={(e) => { e.preventDefault(); onMove(contact.id, STAGES[stageIdx + 1].id); }} className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground ml-auto">
            Move <ArrowRight className="w-3 h-3" />
          </button>
        )}
      </div>
    </Link>
  );
}

function AddContactModal({ onClose, onAdd }: { onClose: () => void; onAdd: (c: CRMContact) => void }) {
  const [form, setForm] = useState({ name: "", phone: "", email: "", company: "", stage: "new_lead" as StageId, value: "", tags: "" });
  const [saving, setSaving] = useState(false);
  const set = (k: string, v: string) => setForm((p) => ({ ...p, [k]: v }));

  const handleAdd = async () => {
    if (!form.name || !form.phone) { toast.error("Name and phone required"); return; }
    setSaving(true);
    try {
      const created = await contactsApi.create({ name: form.name, phone: form.phone, email: form.email || undefined,
        tags: form.tags ? form.tags.split(",").map((t) => t.trim()).filter(Boolean) : [] }) as { id: string };

      await fetch(`/api/crm/contacts/${created.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stage: form.stage, score: 50, value: form.value ? Number(form.value) : undefined, company: form.company || undefined, source: "manual" }),
      });

      onAdd({ id: created.id, name: form.name, phone: form.phone, email: form.email, company: form.company,
        stage: form.stage, score: 50, tags: [], value: form.value ? Number(form.value) : null, source: "manual" });
      toast.success(`${form.name} added to CRM`);
      onClose();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to add contact");
    } finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-card border border-border rounded-2xl shadow-2xl w-full max-w-sm p-6">
        <div className="flex items-center justify-between mb-5">
          <h3 className="font-semibold">Add CRM Contact</h3>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-muted/50"><X className="w-4 h-4" /></button>
        </div>
        <div className="space-y-3">
          {[
            { key: "name", label: "Name *", placeholder: "Priya Mehta" },
            { key: "phone", label: "Phone *", placeholder: "+91 98765 43210" },
            { key: "email", label: "Email", placeholder: "priya@example.com" },
            { key: "company", label: "Company", placeholder: "TechSell Pvt Ltd" },
            { key: "value", label: "Deal Value (₹)", placeholder: "25000" },
            { key: "tags", label: "Tags (comma-separated)", placeholder: "vip, warm" },
          ].map(({ key, label, placeholder }) => (
            <div key={key}>
              <label className="text-xs font-medium block mb-1 text-muted-foreground">{label}</label>
              <input value={form[key as keyof typeof form]} onChange={(e) => set(key, e.target.value)} placeholder={placeholder}
                type={key === "value" ? "number" : "text"}
                className="w-full bg-muted/50 border border-border rounded-xl px-3 py-2 text-sm outline-none focus:border-primary/60 focus:ring-2 focus:ring-primary/20 transition-all" />
            </div>
          ))}
          <div>
            <label className="text-xs font-medium block mb-1 text-muted-foreground">Stage</label>
            <select value={form.stage} onChange={(e) => set("stage", e.target.value)}
              className="w-full bg-muted/50 border border-border rounded-xl px-3 py-2 text-sm outline-none focus:border-primary/60">
              {STAGES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
          </div>
        </div>
        <div className="flex gap-3 mt-5">
          <button onClick={onClose} className="flex-1 py-2.5 rounded-xl border border-border text-sm hover:bg-accent transition-colors">Cancel</button>
          <button onClick={handleAdd} disabled={saving} className="flex-1 flex items-center justify-center gap-2 wa-gradient text-white text-sm font-semibold py-2.5 rounded-xl hover:opacity-90 disabled:opacity-50">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />} Add Contact
          </button>
        </div>
      </div>
    </div>
  );
}

export default function CRMPage() {
  const [contacts, setContacts] = useState<CRMContact[]>([]);
  const [pipeline, setPipeline] = useState<PipelineStage[]>([]);
  const [summary, setSummary] = useState<PipelineSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<"kanban" | "table">("kanban");
  const [search, setSearch] = useState("");
  const [stageFilter, setStageFilter] = useState<StageId | "all">("all");
  const [showAdd, setShowAdd] = useState(false);
  const [messagingContact, setMessagingContact] = useState<CRMContact | null>(null);
  const [migrationNeeded, setMigrationNeeded] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: "200" });
      if (stageFilter !== "all") params.set("stage", stageFilter);
      if (search) params.set("search", search);

      const [crmRes, pipelineRes] = await Promise.all([
        fetch(`/api/crm/contacts?${params}`).then((r) => r.json()),
        fetch("/api/crm/pipeline").then((r) => r.json()),
      ]);

      if (crmRes.error?.includes("crm_stage") || crmRes.error?.includes("column")) {
        setMigrationNeeded(true);
        return;
      }

      setContacts(crmRes.contacts || []);
      setPipeline(pipelineRes.pipeline || []);
      setSummary(pipelineRes.summary || null);
    } catch {
      toast.error("Failed to load CRM data");
    } finally {
      setLoading(false);
    }
  }, [stageFilter, search]);

  useEffect(() => { load(); }, [load]);

  const moveContact = async (id: string, newStage: StageId) => {
    const prev = contacts.find((c) => c.id === id);
    setContacts((cs) => cs.map((c) => c.id === id ? { ...c, stage: newStage } : c));
    try {
      const res = await fetch(`/api/crm/contacts/${id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stage: newStage }),
      });
      if (!res.ok) throw new Error();
      const stageDef = STAGES.find((s) => s.id === newStage);
      toast.success(`Moved to ${stageDef?.label}`);
    } catch {
      // Rollback
      if (prev) setContacts((cs) => cs.map((c) => c.id === id ? { ...c, stage: prev.stage } : c));
      toast.error("Failed to update stage");
    }
  };

  const filtered = stageFilter === "all" ? contacts.filter((c) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return c.name.toLowerCase().includes(q) || c.phone.includes(q);
  }) : contacts;

  const MIGRATION_SQL = `ALTER TABLE contacts ADD COLUMN IF NOT EXISTS crm_stage TEXT DEFAULT 'new_lead';
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS crm_score INTEGER DEFAULT 50;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS deal_value DECIMAL(12,2) DEFAULT 0;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS company TEXT;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS crm_source TEXT DEFAULT 'manual';
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS crm_notes TEXT;

CREATE TABLE IF NOT EXISTS crm_activities (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL, content TEXT NOT NULL,
  metadata JSONB DEFAULT '{}', created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS crm_deals (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  title TEXT NOT NULL, value DECIMAL(12,2) DEFAULT 0,
  stage TEXT NOT NULL DEFAULT 'prospecting', probability INTEGER DEFAULT 20,
  expected_close DATE, notes TEXT, won_at TIMESTAMPTZ, lost_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW()
);`;

  if (migrationNeeded) {
    return (
      <div className="max-w-2xl">
        <PageHeader title="CRM" subtitle="Pipeline & contact management" />
        <div className="bg-card border border-amber-500/20 rounded-2xl p-8">
          <div className="flex items-start gap-3 mb-6">
            <AlertCircle className="w-6 h-6 text-amber-400 flex-shrink-0 mt-0.5" />
            <div>
              <h3 className="font-semibold mb-1">Database migration required</h3>
              <p className="text-sm text-muted-foreground">Run the SQL below in your <a href="https://supabase.com/dashboard/project/tbqfsudapxfqakzqbkgb/sql" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">Supabase SQL Editor</a>, then click Retry.</p>
            </div>
          </div>
          <pre className="bg-muted/40 rounded-xl p-4 text-xs overflow-x-auto mb-6 text-muted-foreground leading-relaxed">{MIGRATION_SQL}</pre>
          <button onClick={() => { setMigrationNeeded(false); load(); }} className="flex items-center gap-2 wa-gradient text-white font-semibold px-6 py-3 rounded-xl hover:opacity-90 transition-all">
            <RefreshCw className="w-4 h-4" /> Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <PageHeader title="CRM Pipeline" subtitle="Track leads from first touch to conversion" />
        <div className="flex items-center gap-2">
          <button onClick={load} title="Refresh" className="p-2 rounded-xl hover:bg-accent border border-border transition-colors">
            <RefreshCw className="w-4 h-4 text-muted-foreground" />
          </button>
          <button onClick={() => setView("kanban")} className={`p-2 rounded-xl border transition-colors ${view === "kanban" ? "border-primary/40 bg-primary/10 text-primary" : "border-border hover:bg-accent"}`}>
            <Layout className="w-4 h-4" />
          </button>
          <button onClick={() => setView("table")} className={`p-2 rounded-xl border transition-colors ${view === "table" ? "border-primary/40 bg-primary/10 text-primary" : "border-border hover:bg-accent"}`}>
            <List className="w-4 h-4" />
          </button>
          <button onClick={() => setShowAdd(true)} className="flex items-center gap-2 wa-gradient text-white text-sm font-semibold px-4 py-2.5 rounded-xl hover:opacity-90 transition-all shadow-lg shadow-primary/25">
            <Plus className="w-4 h-4" /> Add Contact
          </button>
        </div>
      </div>

      {/* Summary KPIs */}
      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: "Total Contacts", value: summary.totalContacts, icon: Users, color: "text-blue-400", bg: "bg-blue-500/10", fmt: (v: number) => v.toString() },
            { label: "Conversion Rate", value: summary.conversionRate, icon: Target, color: "text-emerald-400", bg: "bg-emerald-500/10", fmt: (v: number) => `${v}%` },
            { label: "Pipeline Value", value: summary.totalPipelineValue, icon: DollarSign, color: "text-amber-400", bg: "bg-amber-500/10", fmt: (v: number) => `₹${(v/1000).toFixed(0)}K` },
            { label: "Won Revenue", value: summary.wonValue, icon: TrendingUp, color: "text-primary", bg: "bg-primary/10", fmt: (v: number) => `₹${(v/1000).toFixed(0)}K` },
          ].map(({ label, value, icon: Icon, color, bg, fmt }) => (
            <div key={label} className="bg-card border border-border/50 rounded-xl p-4 flex items-center gap-3">
              <div className={`w-10 h-10 rounded-xl ${bg} flex items-center justify-center flex-shrink-0`}>
                <Icon className={`w-5 h-5 ${color}`} />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">{label}</p>
                <p className="text-xl font-bold">{fmt(value)}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-48 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search contacts…"
            className="w-full bg-card border border-border rounded-xl pl-9 pr-4 py-2.5 text-sm outline-none focus:border-primary/60 focus:ring-2 focus:ring-primary/20 transition-all" />
        </div>
        <div className="flex items-center gap-2 overflow-x-auto pb-1">
          {(["all", ...STAGES.map((s) => s.id)] as const).map((id) => {
            const s = STAGES.find((s) => s.id === id);
            const count = id === "all" ? contacts.length : (pipeline.find((p) => p.stage === id)?.count ?? 0);
            return (
              <button key={id} onClick={() => setStageFilter(id as StageId | "all")}
                className={`flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-full border transition-all whitespace-nowrap ${stageFilter === id ? (s ? `${s.bg} ${s.color} ${s.border}` : "wa-gradient text-white border-primary") : "border-border hover:bg-accent"}`}>
                {s && <span className={`w-1.5 h-1.5 rounded-full ${s.dot}`} />}{id === "all" ? "All" : s?.label} ({count})
              </button>
            );
          })}
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-24"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-24 text-muted-foreground">
          <Users className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p className="font-medium">No contacts in pipeline</p>
          <button onClick={() => setShowAdd(true)} className="mt-4 flex items-center gap-2 wa-gradient text-white text-sm font-semibold px-4 py-2 rounded-xl hover:opacity-90 mx-auto">
            <Plus className="w-4 h-4" /> Add First Contact
          </button>
        </div>
      ) : view === "kanban" ? (
        <div className="flex gap-4 overflow-x-auto pb-4">
          {STAGES.map((stage) => {
            const stageContacts = contacts.filter((c) => c.stage === stage.id);
            const stageValue = stageContacts.reduce((s, c) => s + (c.value || 0), 0);
            return (
              <div key={stage.id} className="flex-shrink-0 w-60">
                <div className={`flex items-center justify-between px-3 py-2.5 rounded-t-xl border border-b-0 ${stage.border} ${stage.bg}`}>
                  <div className="flex items-center gap-2">
                    <span className={`w-2 h-2 rounded-full ${stage.dot}`} />
                    <span className={`text-xs font-semibold ${stage.color}`}>{stage.label}</span>
                    <span className="text-xs text-muted-foreground">({stageContacts.length})</span>
                  </div>
                  {stageValue > 0 && <span className="text-[10px] font-bold text-emerald-400">₹{(stageValue/1000).toFixed(0)}K</span>}
                </div>
                <div className={`border border-t-0 ${stage.border} rounded-b-xl p-2 min-h-32 space-y-2 bg-muted/5`}>
                  {stageContacts.map((c) => (
                    <KanbanCard key={c.id} contact={c} onMove={moveContact} onMessage={setMessagingContact} />
                  ))}
                  {stageContacts.length === 0 && (
                    <p className="text-center text-xs text-muted-foreground/30 py-8">Empty</p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="bg-card border border-border/50 rounded-2xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border/50 bg-muted/10">
                  {["Contact","Company","Stage","Score","Value","Tags","Source","Last Contact",""].map((h) => (
                    <th key={h} className="text-left text-xs font-medium text-muted-foreground px-4 py-3 whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((c) => (
                  <tr key={c.id} className="border-b border-border/30 last:border-0 hover:bg-muted/20 transition-colors">
                    <td className="px-4 py-3">
                      <Link href={`/crm/${c.id}`} className="flex items-center gap-2.5 group">
                        <div className="w-7 h-7 rounded-full wa-gradient flex items-center justify-center text-[10px] font-bold text-white flex-shrink-0">
                          {c.name.split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase()}
                        </div>
                        <div>
                          <p className="text-sm font-medium group-hover:text-primary transition-colors">{c.name}</p>
                          <p className="text-xs text-muted-foreground">{c.phone}</p>
                        </div>
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-sm text-muted-foreground">{c.company || "—"}</td>
                    <td className="px-4 py-3"><StageMenu contactId={c.id} current={c.stage} onMove={moveContact} /></td>
                    <td className="px-4 py-3"><ScoreRing score={c.score} /></td>
                    <td className="px-4 py-3 text-sm font-semibold text-emerald-400">{c.value ? `₹${c.value.toLocaleString()}` : "—"}</td>
                    <td className="px-4 py-3"><div className="flex gap-1">{c.tags.slice(0,2).map((t) => <span key={t} className="text-[10px] bg-muted/50 px-1.5 py-0.5 rounded text-muted-foreground">{t}</span>)}</div></td>
                    <td className="px-4 py-3"><span className={`text-[10px] px-2 py-0.5 rounded capitalize ${SOURCE_BADGE[c.source] || SOURCE_BADGE.manual}`}>{c.source}</span></td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">{c.lastContact ? new Date(c.lastContact).toLocaleDateString("en-IN",{day:"numeric",month:"short"}) : "—"}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1">
                        <button onClick={() => setMessagingContact(c)} className="p-1.5 rounded-lg hover:bg-primary/10 transition-colors"><MessageSquare className="w-3.5 h-3.5 text-primary" /></button>
                        <Link href={`/crm/${c.id}`} className="p-1.5 rounded-lg hover:bg-muted/40 transition-colors"><MoreHorizontal className="w-3.5 h-3.5 text-muted-foreground" /></Link>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Bottom cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-card border border-border/50 rounded-2xl p-5">
          <div className="flex items-center gap-2.5 mb-3">
            <div className="w-8 h-8 rounded-lg bg-violet-500/10 border border-violet-500/20 flex items-center justify-center"><Zap className="w-4 h-4 text-violet-400" /></div>
            <p className="text-sm font-semibold">CRM Automations</p>
          </div>
          <p className="text-xs text-muted-foreground mb-4 leading-relaxed">Auto-send messages when a lead changes stage or a tag is applied.</p>
          <Link href="/automation/create?recipe=crm_stage" className="flex items-center gap-1.5 text-xs text-primary font-medium hover:underline">
            <Plus className="w-3.5 h-3.5" /> Create Stage Automation
          </Link>
        </div>
        <div className="bg-card border border-border/50 rounded-2xl p-5">
          <div className="flex items-center gap-2.5 mb-3">
            <div className="w-8 h-8 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center"><Megaphone className="w-4 h-4 text-emerald-400" /></div>
            <p className="text-sm font-semibold">Campaign by Stage</p>
          </div>
          <div className="space-y-1.5 mb-4">
            {STAGES.filter((s) => s.id !== "lost").map((s) => (
              <div key={s.id} className={`flex items-center justify-between px-3 py-1.5 rounded-lg border ${s.bg} ${s.border}`}>
                <div className="flex items-center gap-2"><span className={`w-2 h-2 rounded-full ${s.dot}`} /><span className={`text-xs font-medium ${s.color}`}>{s.label}</span></div>
                <span className="text-xs text-muted-foreground">{contacts.filter((c) => c.stage === s.id).length}</span>
              </div>
            ))}
          </div>
          <Link href="/campaigns/create" className="flex items-center gap-1.5 text-xs text-primary font-medium hover:underline">
            <Plus className="w-3.5 h-3.5" /> New Campaign
          </Link>
        </div>
        <div className="bg-card border border-border/50 rounded-2xl p-5">
          <div className="flex items-center gap-2.5 mb-3">
            <div className="w-8 h-8 rounded-lg bg-blue-500/10 border border-blue-500/20 flex items-center justify-center"><BarChart3 className="w-4 h-4 text-blue-400" /></div>
            <p className="text-sm font-semibold">Stage Breakdown</p>
          </div>
          <div className="space-y-2">
            {pipeline.map((p) => {
              const s = STAGES.find((s) => s.id === p.stage)!;
              const pct = summary?.totalContacts ? Math.round((p.count / summary.totalContacts) * 100) : 0;
              return (
                <div key={p.stage}>
                  <div className="flex items-center justify-between text-xs mb-0.5">
                    <span className={`font-medium ${s?.color}`}>{s?.label}</span>
                    <span className="text-muted-foreground">{p.count} ({pct}%)</span>
                  </div>
                  <div className="h-1.5 bg-muted/30 rounded-full overflow-hidden">
                    <div className={`h-full rounded-full ${s?.dot}`} style={{ width: `${pct}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {showAdd && <AddContactModal onClose={() => setShowAdd(false)} onAdd={(c) => setContacts((p) => [c, ...p])} />}

      {messagingContact && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-card border border-border rounded-2xl shadow-2xl w-full max-w-sm p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold">Send WhatsApp</h3>
              <button onClick={() => setMessagingContact(null)} className="p-1.5 rounded-lg hover:bg-muted/50"><X className="w-4 h-4" /></button>
            </div>
            <div className="flex items-center gap-3 mb-5 p-3 bg-muted/20 rounded-xl">
              <div className="w-9 h-9 rounded-full wa-gradient flex items-center justify-center text-xs font-bold text-white">
                {messagingContact.name.split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase()}
              </div>
              <div>
                <p className="text-sm font-semibold">{messagingContact.name}</p>
                <p className="text-xs text-muted-foreground">{messagingContact.phone}</p>
              </div>
            </div>
            <div className="flex gap-2">
              <Link href="/templates/send" onClick={() => setMessagingContact(null)} className="flex-1 flex items-center justify-center gap-2 wa-gradient text-white text-sm font-semibold py-2.5 rounded-xl hover:opacity-90">
                <Send className="w-4 h-4" /> Template
              </Link>
              <Link href="/campaigns/create" onClick={() => setMessagingContact(null)} className="flex-1 flex items-center justify-center gap-2 border border-border text-sm font-medium py-2.5 rounded-xl hover:bg-accent">
                <Megaphone className="w-4 h-4" /> Campaign
              </Link>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
