"use client";

import { PageHeader } from "@/components/shared/PageHeader";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { templates as templatesApi } from "@/lib/api";
import { formatDate } from "@/lib/utils";
import {
  RefreshCw, Send, MessageSquare, Eye, Loader2, Plus, X,
  Search, Filter, Copy, Trash2, FolderOpen, Zap, ShieldCheck,
  Megaphone, ChevronDown, Check, Image, Link2, Phone, Sparkles,
  Wand2, ArrowRight, ChevronLeft, AlertCircle,
} from "lucide-react";
import Link from "next/link";
import { useState, useEffect } from "react";
import { toast } from "sonner";
import { Template } from "@/types";


const CATEGORY_CONFIG = {
  ALL: { label: "All Templates", icon: MessageSquare, color: "text-foreground" },
  MARKETING: { label: "Marketing", icon: Megaphone, color: "text-purple-400" },
  UTILITY: { label: "Utility", icon: Zap, color: "text-blue-400" },
  AUTHENTICATION: { label: "Authentication", icon: ShieldCheck, color: "text-amber-400" },
} as const;

type CategoryFilter = keyof typeof CATEGORY_CONFIG;

const categoryBadge: Record<string, string> = {
  MARKETING: "bg-purple-500/10 text-purple-400 border-purple-500/20",
  UTILITY: "bg-blue-500/10 text-blue-400 border-blue-500/20",
  AUTHENTICATION: "bg-amber-500/10 text-amber-400 border-amber-500/20",
};

// ─── AI Template Generator ────────────────────────────────────────────────────
function AIGeneratePanel({
  onUse,
}: {
  onUse: (t: { displayName: string; name: string; body: string; footer: string; category: string; language: string }) => void;
}) {
  const [description, setDescription] = useState("");
  const [category, setCategory]       = useState("MARKETING");
  const [tone, setTone]               = useState("friendly");
  const [language, setLanguage]       = useState("en");
  const [loading, setLoading]         = useState(false);
  const [results, setResults]         = useState<{
    displayName: string; name: string; body: string; footer: string;
    variableNames: string[]; whyItWorks: string; category: string; language: string;
  }[]>([]);
  const [selected, setSelected] = useState<number | null>(null);

  const generate = async () => {
    if (!description.trim()) { toast.error("Describe what you want"); return; }
    setLoading(true); setResults([]); setSelected(null);
    try {
      const res = await fetch("/api/templates/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description, category, tone, language }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Generation failed");
      setResults(data.templates);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "AI generation failed");
    } finally {
      setLoading(false);
    }
  };

  const tones = [
    { id: "friendly",     label: "Friendly",      emoji: "😊" },
    { id: "professional", label: "Professional",   emoji: "💼" },
    { id: "urgent",       label: "Urgent",         emoji: "⚡" },
    { id: "festive",      label: "Festive",        emoji: "🎉" },
  ];

  const examples = [
    "Diwali sale, 30% off all electronics, valid till Sunday",
    "Order shipped, customer name, order ID, expected delivery date",
    "Appointment reminder for salon booking, date, time, location",
    "Welcome new customer, offer 10% on first purchase, promo code",
  ];

  return (
    <div className="p-5 space-y-5">
      {/* Description input */}
      <div>
        <label className="text-sm font-medium block mb-1.5 flex items-center gap-1.5">
          <Sparkles className="w-3.5 h-3.5 text-purple-400" />
          Describe your template
        </label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="e.g. Diwali sale, 30% off electronics, valid this weekend only"
          rows={3}
          className="w-full bg-muted/50 border border-border rounded-xl px-4 py-2.5 text-sm outline-none focus:border-primary/60 focus:ring-2 focus:ring-primary/20 transition-all resize-none"
        />
        {/* Quick examples */}
        <div className="flex flex-wrap gap-1.5 mt-2">
          {examples.map((ex) => (
            <button
              key={ex}
              onClick={() => setDescription(ex)}
              className="text-[10px] bg-muted/40 hover:bg-primary/10 hover:text-primary px-2 py-1 rounded-lg text-muted-foreground transition-colors truncate max-w-[200px]"
            >
              {ex}
            </button>
          ))}
        </div>
      </div>

      {/* Controls row */}
      <div className="grid grid-cols-3 gap-3">
        <div>
          <label className="text-xs font-medium block mb-1 text-muted-foreground">Category</label>
          <select value={category} onChange={(e) => setCategory(e.target.value)}
            className="w-full bg-muted/50 border border-border rounded-xl px-3 py-2 text-xs outline-none focus:border-primary/60">
            <option value="MARKETING">Marketing</option>
            <option value="UTILITY">Utility</option>
            <option value="AUTHENTICATION">Authentication</option>
          </select>
        </div>
        <div>
          <label className="text-xs font-medium block mb-1 text-muted-foreground">Language</label>
          <select value={language} onChange={(e) => setLanguage(e.target.value)}
            className="w-full bg-muted/50 border border-border rounded-xl px-3 py-2 text-xs outline-none focus:border-primary/60">
            <option value="en">English</option>
            <option value="en_IN">English (India)</option>
            <option value="hi">Hindi</option>
            <option value="ta">Tamil</option>
            <option value="te">Telugu</option>
          </select>
        </div>
        <div>
          <label className="text-xs font-medium block mb-1 text-muted-foreground">Tone</label>
          <select value={tone} onChange={(e) => setTone(e.target.value)}
            className="w-full bg-muted/50 border border-border rounded-xl px-3 py-2 text-xs outline-none focus:border-primary/60">
            {tones.map((t) => (
              <option key={t.id} value={t.id}>{t.emoji} {t.label}</option>
            ))}
          </select>
        </div>
      </div>

      <button
        onClick={generate}
        disabled={loading || !description.trim()}
        className="w-full flex items-center justify-center gap-2 bg-gradient-to-r from-purple-600 to-violet-600 text-white font-semibold py-2.5 rounded-xl hover:opacity-90 transition-all disabled:opacity-40"
      >
        {loading ? (
          <><Loader2 className="w-4 h-4 animate-spin" /> Generating 3 variations…</>
        ) : (
          <><Wand2 className="w-4 h-4" /> Generate with AI</>
        )}
      </button>

      {/* Results */}
      {results.length > 0 && (
        <div className="space-y-3">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            3 Variations — Pick one to edit
          </p>
          {results.map((tmpl, i) => (
            <div
              key={i}
              onClick={() => setSelected(selected === i ? null : i)}
              className={`p-4 rounded-xl border cursor-pointer transition-all ${
                selected === i
                  ? "border-purple-500/60 bg-purple-500/5 ring-1 ring-purple-500/30"
                  : "border-border hover:border-purple-500/30 hover:bg-purple-500/5"
              }`}
            >
              <div className="flex items-start justify-between gap-2 mb-2">
                <div>
                  <p className="text-sm font-semibold">{tmpl.displayName}</p>
                  <p className="text-xs text-purple-400 mt-0.5">{tmpl.whyItWorks}</p>
                </div>
                <div className={`w-5 h-5 rounded-full border-2 flex-shrink-0 mt-0.5 flex items-center justify-center transition-colors ${
                  selected === i ? "border-purple-500 bg-purple-500" : "border-border"
                }`}>
                  {selected === i && <Check className="w-3 h-3 text-white" />}
                </div>
              </div>
              {/* WhatsApp bubble preview */}
              <div className="bg-[#111b21] rounded-xl p-3 mt-2">
                <div className="bg-[#202c33] rounded-2xl rounded-tl-none p-3 max-w-[95%]">
                  <p className="text-xs text-[#e9edef] whitespace-pre-wrap leading-relaxed">{tmpl.body}</p>
                  {tmpl.footer && <p className="text-[10px] text-[#8696a0] mt-1.5 border-t border-white/10 pt-1">{tmpl.footer}</p>}
                  <p className="text-[10px] text-[#8696a0] text-right mt-1">12:30 ✓✓</p>
                </div>
              </div>
              {tmpl.variableNames.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-2">
                  {tmpl.variableNames.map((v, j) => (
                    <span key={j} className="text-[10px] bg-purple-500/10 text-purple-400 px-1.5 py-0.5 rounded font-mono">{`{{${j+1}}}`} {v}</span>
                  ))}
                </div>
              )}
            </div>
          ))}

          {selected !== null && (
            <button
              onClick={() => onUse(results[selected])}
              className="w-full flex items-center justify-center gap-2 wa-gradient text-white font-semibold py-2.5 rounded-xl hover:opacity-90 transition-all"
            >
              Use This Template <ArrowRight className="w-4 h-4" />
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Meta Template Library Panel (live from Graph API) ───────────────────────
interface MetaLibraryItem {
  id: string;
  name: string;
  displayName: string;
  category: string;
  topic?: string;
  industry?: string[];
  language: string;
  body: string;
  header: string;
  footer: string;
  buttons?: { type: string; text: string }[];
  parameters?: { name: string; type: string }[];
}

const LIB_TOPICS = [
  { id: "",                       label: "All topics" },
  { id: "ACCOUNT_UPDATES",        label: "Account updates" },
  { id: "ORDER_MANAGEMENT",       label: "Order management" },
  { id: "PAYMENTS",               label: "Payments" },
  { id: "APPOINTMENTS",           label: "Appointments" },
  { id: "SHIPPING_UPDATES",       label: "Shipping" },
  { id: "RESERVATION_UPDATES",    label: "Reservations" },
  { id: "OTP",                    label: "OTP / Verification" },
];

function MetaLibraryPanel({
  onClone,
  onSubmittedToMeta,
}: {
  onClone: (t: { name: string; displayName: string; category: string; language: string; body: string; variables: string[] }) => void;
  onSubmittedToMeta: (name: string) => void;
}) {
  const [items, setItems] = useState<MetaLibraryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [warning, setWarning] = useState<string | null>(null);
  const [category, setCategory] = useState<"UTILITY" | "AUTHENTICATION">("UTILITY");
  const [topic, setTopic] = useState("");
  const [search, setSearch] = useState("");
  const [submittingId, setSubmittingId] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setWarning(null);
    const q = new URLSearchParams({ category });
    if (topic) q.set("topic", topic);
    if (search.trim()) q.set("search", search.trim());

    fetch(`/api/templates/library?${q}`)
      .then((r) => r.json())
      .then((d) => {
        setItems(d.templates || []);
        if (d.warning) setWarning(d.warning);
        if (d.message) setWarning(d.message);
      })
      .catch(() => toast.error("Library fetch failed"))
      .finally(() => setLoading(false));
  }, [category, topic, search]);

  const submitToMeta = async (item: MetaLibraryItem) => {
    setSubmittingId(item.id);
    try {
      const res = await fetch("/api/templates/use-library", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          library_template_name: item.name,
          language: item.language,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      onSubmittedToMeta(item.name);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Submit failed");
    } finally {
      setSubmittingId(null);
    }
  };

  const useLocally = (item: MetaLibraryItem) => {
    const variables = (item.parameters?.map((p) => p.name) || []);
    onClone({
      name: item.name,
      displayName: item.displayName,
      category: item.category,
      language: item.language.split("_")[0] || "en",
      body: item.body,
      variables,
    });
  };

  // Group by topic for display
  const grouped: Record<string, MetaLibraryItem[]> = {};
  for (const it of items) {
    const key = it.topic || "Other";
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(it);
  }

  return (
    <div className="p-4">
      {/* Filters */}
      <div className="flex items-center gap-2 mb-4 sticky top-0 bg-card pb-3 border-b border-border/40 z-10">
        <div className="flex bg-muted/40 rounded-lg p-0.5">
          {(["UTILITY", "AUTHENTICATION"] as const).map((c) => (
            <button
              key={c}
              onClick={() => setCategory(c)}
              className={`px-3 py-1 rounded-md text-xs font-semibold transition-all ${
                category === c ? "bg-card shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {c === "UTILITY" ? "Utility" : "Authentication"}
            </button>
          ))}
        </div>

        <select
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          className="bg-muted/50 border border-border rounded-lg px-2.5 py-1.5 text-xs outline-none focus:border-primary/60"
        >
          {LIB_TOPICS.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
        </select>

        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search templates…"
            className="w-full bg-muted/50 border border-border rounded-lg pl-8 pr-3 py-1.5 text-xs outline-none focus:border-primary/60"
          />
        </div>

        {!loading && items.length > 0 && (
          <span className="text-[10px] text-muted-foreground whitespace-nowrap">
            {items.length} templates
          </span>
        )}
      </div>

      {warning && (
        <div className="mb-3 p-2.5 bg-amber-500/5 border border-amber-500/20 rounded-lg text-[11px] text-amber-400 flex items-start gap-2">
          <AlertCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
          <span>{warning}</span>
        </div>
      )}

      {loading ? (
        <div className="py-12 text-center"><Loader2 className="w-5 h-5 animate-spin text-primary mx-auto" /></div>
      ) : items.length === 0 ? (
        <div className="py-12 text-center text-muted-foreground">
          <FolderOpen className="w-8 h-8 mx-auto mb-2 opacity-40" />
          <p className="text-sm">No library templates match these filters</p>
        </div>
      ) : (
        <div className="space-y-4">
          {Object.entries(grouped).map(([topicLabel, group]) => (
            <div key={topicLabel}>
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider px-1 py-2">
                {topicLabel.replace(/_/g, " ").toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase())} ({group.length})
              </p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {group.map((tmpl) => {
                  const cat = tmpl.category as keyof typeof categoryBadge;
                  return (
                    <div
                      key={tmpl.id}
                      className="p-3 rounded-xl border border-border hover:border-primary/40 hover:bg-primary/5 transition-all group"
                    >
                      <div className="flex items-start gap-2 mb-2">
                        <div className={`w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 border ${categoryBadge[cat]}`}>
                          <MessageSquare className="w-3 h-3" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold leading-tight">{tmpl.displayName}</p>
                          <p className="text-[10px] text-muted-foreground font-mono">{tmpl.name}</p>
                        </div>
                      </div>

                      <div className="bg-[#0b141a] rounded-lg p-2.5 mb-2">
                        <p className="text-[11px] text-[#e9edef] whitespace-pre-wrap leading-relaxed line-clamp-4">
                          {tmpl.body}
                        </p>
                        {tmpl.footer && (
                          <p className="text-[9px] text-[#8696a0] mt-1.5 border-t border-white/10 pt-1">{tmpl.footer}</p>
                        )}
                      </div>

                      <div className="flex items-center gap-1 flex-wrap mb-2">
                        <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-medium border ${categoryBadge[cat]}`}>
                          {tmpl.category}
                        </span>
                        <span className="text-[9px] text-muted-foreground bg-muted/40 px-1.5 py-0.5 rounded-full">
                          {tmpl.language}
                        </span>
                        {(tmpl.parameters?.length ?? 0) > 0 && (
                          <span className="text-[9px] text-muted-foreground bg-muted/40 px-1.5 py-0.5 rounded-full">
                            {tmpl.parameters?.length} var{tmpl.parameters?.length !== 1 ? "s" : ""}
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-1.5">
                        <button
                          onClick={() => useLocally(tmpl)}
                          className="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 rounded-lg border border-border text-[11px] font-medium hover:bg-accent transition-colors"
                          title="Load into the Build tab to customize before submitting"
                        >
                          <Copy className="w-3 h-3" /> Customize
                        </button>
                        <button
                          onClick={() => submitToMeta(tmpl)}
                          disabled={submittingId === tmpl.id}
                          className="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 rounded-lg wa-gradient text-white text-[11px] font-semibold disabled:opacity-50 transition-all"
                          title="Submit this library template directly to Meta for approval (no edits)"
                        >
                          {submittingId === tmpl.id
                            ? <Loader2 className="w-3 h-3 animate-spin" />
                            : <ShieldCheck className="w-3 h-3" />}
                          Submit to Meta
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Create Template Modal ─────────────────────────────────────────────────────
function CreateTemplateModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (t: Template) => void;
}) {
  const [step, setStep] = useState<"build" | "library" | "ai">("build");
  const [form, setForm] = useState({
    displayName: "",
    name: "",
    category: "MARKETING" as "MARKETING" | "UTILITY" | "AUTHENTICATION",
    language: "en",
    body: "",
    footer: "",
    hasHeader: false,
    headerType: "text" as "text" | "image",
    headerText: "",
    hasButtons: false,
    buttonType: "quick_reply" as "quick_reply" | "cta",
    buttons: [""],
  });
  const [saving, setSaving] = useState(false);

  const applyAI = (t: { displayName: string; name: string; body: string; footer: string; category: string; language: string }) => {
    setForm((p) => ({
      ...p,
      displayName: t.displayName,
      name:        t.name,
      body:        t.body,
      footer:      t.footer || "",
      category:    t.category as typeof p.category,
      language:    t.language,
    }));
    setStep("build");
    toast.success("AI template loaded — review and submit for approval");
  };

  const variables = Array.from(form.body.matchAll(/\{\{(\d+)\}\}/g)).map((m) => m[1]);
  const uniqueVarCount = new Set(variables).size;

  const handleNameFromDisplay = (val: string) => {
    setForm((p) => ({
      ...p,
      displayName: val,
      name: val.toLowerCase().replace(/[^a-z0-9]/g, "_").replace(/_+/g, "_"),
    }));
  };

  const handleSave = async () => {
    if (!form.displayName || !form.body) {
      toast.error("Name and body are required");
      return;
    }
    setSaving(true);
    try {
      const created = await templatesApi.create({
        name: form.name,
        displayName: form.displayName,
        category: form.category,
        language: form.language,
        body: form.body,
        variables: Array.from({ length: uniqueVarCount }, (_, i) => `var_${i + 1}`),
      });
      toast.success("Template submitted for review!");
      onCreated(created);
      onClose();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to create template");
    } finally {
      setSaving(false);
    }
  };

  const cloneFromLibrary = (tmpl: { name: string; displayName: string; category: string; language: string; body: string; variables?: string[] }) => {
    setForm((p) => ({
      ...p,
      displayName: tmpl.displayName,
      name: tmpl.name,
      category: tmpl.category as typeof p.category,
      language: tmpl.language,
      body: tmpl.body,
    }));
    setStep("build");
    toast.success(`"${tmpl.displayName}" loaded — customize and save`);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="bg-card border border-border rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col animate-fade-in">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-border flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl wa-gradient flex items-center justify-center">
              <Plus className="w-5 h-5 text-white" />
            </div>
            <div>
              <h3 className="font-semibold">Create Template</h3>
              <p className="text-xs text-muted-foreground">Build from scratch or pick from library</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-muted/50 text-muted-foreground transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Tab switcher */}
        <div className="flex gap-1 p-3 border-b border-border bg-muted/10 flex-shrink-0">
          {[
            { id: "ai",      label: "✨ Generate with AI", highlight: true },
            { id: "build",   label: "Build Custom" },
            { id: "library", label: "Meta Library" },
          ].map(({ id, label, highlight }) => (
            <button
              key={id}
              onClick={() => setStep(id as "build" | "library" | "ai")}
              className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-all ${
                step === id
                  ? highlight
                    ? "bg-gradient-to-r from-purple-600 to-violet-600 text-white shadow"
                    : "bg-card shadow text-foreground"
                  : highlight
                  ? "text-purple-400 hover:bg-purple-500/10"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto">
          {step === "ai" ? (
            <AIGeneratePanel onUse={applyAI} />
          ) : step === "library" ? (
            <MetaLibraryPanel
              onClone={cloneFromLibrary}
              onSubmittedToMeta={(name) => {
                toast.success(`"${name}" submitted to Meta — sync to see status`);
                onClose();
              }}
            />
          ) : (
            <div className="p-5 grid grid-cols-1 md:grid-cols-2 gap-5">
              {/* Left: Form */}
              <div className="space-y-4">
                <div>
                  <label className="text-sm font-medium block mb-1.5">Template Name *</label>
                  <input
                    value={form.displayName}
                    onChange={(e) => handleNameFromDisplay(e.target.value)}
                    placeholder="e.g. Order Confirmation"
                    className="w-full bg-muted/50 border border-border rounded-xl px-4 py-2.5 text-sm outline-none focus:border-primary/60 focus:ring-2 focus:ring-primary/20 transition-all"
                  />
                  {form.name && (
                    <p className="text-[11px] text-muted-foreground mt-1 font-mono">ID: {form.name}</p>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-sm font-medium block mb-1.5">Category *</label>
                    <select
                      value={form.category}
                      onChange={(e) => setForm((p) => ({ ...p, category: e.target.value as typeof p.category }))}
                      className="w-full bg-muted/50 border border-border rounded-xl px-3 py-2.5 text-sm outline-none focus:border-primary/60 transition-all"
                    >
                      <option value="MARKETING">Marketing</option>
                      <option value="UTILITY">Utility</option>
                      <option value="AUTHENTICATION">Authentication</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-sm font-medium block mb-1.5">Language</label>
                    <select
                      value={form.language}
                      onChange={(e) => setForm((p) => ({ ...p, language: e.target.value }))}
                      className="w-full bg-muted/50 border border-border rounded-xl px-3 py-2.5 text-sm outline-none focus:border-primary/60 transition-all"
                    >
                      <option value="en">English</option>
                      <option value="en_IN">English (India)</option>
                      <option value="hi">Hindi</option>
                      <option value="ta">Tamil</option>
                      <option value="te">Telugu</option>
                      <option value="mr">Marathi</option>
                      <option value="bn">Bengali</option>
                      <option value="kn">Kannada</option>
                    </select>
                  </div>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-sm font-medium">Message Body *</label>
                    <span className="text-xs text-muted-foreground">{form.body.length}/1024</span>
                  </div>
                  <textarea
                    value={form.body}
                    onChange={(e) => setForm((p) => ({ ...p, body: e.target.value }))}
                    placeholder={`Hi {{1}}, your order {{2}} is confirmed!\n\nUse {{n}} for dynamic variables.`}
                    rows={6}
                    maxLength={1024}
                    className="w-full bg-muted/50 border border-border rounded-xl px-4 py-2.5 text-sm outline-none focus:border-primary/60 focus:ring-2 focus:ring-primary/20 transition-all resize-none font-mono"
                  />
                  <p className="text-[11px] text-muted-foreground mt-1">
                    Use {`{{1}}`}, {`{{2}}`}… for variables. Bold: *text* | Italic: _text_
                  </p>
                </div>

                <div>
                  <label className="text-sm font-medium block mb-1.5">Footer <span className="text-muted-foreground font-normal">(optional)</span></label>
                  <input
                    value={form.footer}
                    onChange={(e) => setForm((p) => ({ ...p, footer: e.target.value }))}
                    placeholder="e.g. Reply STOP to unsubscribe"
                    className="w-full bg-muted/50 border border-border rounded-xl px-4 py-2.5 text-sm outline-none focus:border-primary/60 transition-all"
                  />
                </div>

                {uniqueVarCount > 0 && (
                  <div className="p-3 bg-primary/5 border border-primary/20 rounded-xl">
                    <p className="text-xs font-medium text-primary mb-1.5">
                      {uniqueVarCount} variable{uniqueVarCount > 1 ? "s" : ""} detected
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {Array.from({ length: uniqueVarCount }, (_, i) => (
                        <span key={i} className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded font-mono">
                          {`{{${i + 1}}}`}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Right: Live preview */}
              <div>
                <p className="text-sm font-medium mb-3">Preview</p>
                <div className="bg-[#0b141a] rounded-2xl p-4 min-h-64">
                  <div className="flex items-center gap-2 mb-3 pb-3 border-b border-white/10">
                    <div className="w-8 h-8 rounded-full wa-gradient flex items-center justify-center text-xs font-bold text-white">W</div>
                    <div>
                      <p className="text-xs font-medium text-white">WASend Business</p>
                      <p className="text-[10px] text-green-400">Online</p>
                    </div>
                  </div>
                  {form.body ? (
                    <div className="bg-[#202c33] rounded-2xl rounded-tl-none p-3.5 max-w-[90%]">
                      <p className="text-sm text-[#e9edef] leading-relaxed whitespace-pre-wrap">
                        {form.body}
                      </p>
                      {form.footer && (
                        <p className="text-[11px] text-[#8696a0] mt-2 border-t border-white/10 pt-2">
                          {form.footer}
                        </p>
                      )}
                      <p className="text-[10px] text-[#8696a0] text-right mt-1">12:30 ✓✓</p>
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground text-center mt-8 opacity-50">
                      Start typing to see preview
                    </p>
                  )}
                </div>

                <div className="mt-4 p-3 bg-muted/20 rounded-xl border border-border/50">
                  <p className="text-xs font-medium mb-2">Meta Approval Tips</p>
                  <ul className="space-y-1">
                    {[
                      "Avoid promotional content in Utility templates",
                      "No URL shorteners (use full domain links)",
                      "Don't use all-caps text excessively",
                      "Authentication templates must include OTP/code",
                    ].map((tip) => (
                      <li key={tip} className="flex items-start gap-1.5 text-[11px] text-muted-foreground">
                        <Check className="w-3 h-3 text-emerald-400 mt-0.5 flex-shrink-0" />
                        {tip}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        {step === "build" && (
          <div className="flex items-center justify-between p-5 border-t border-border flex-shrink-0">
            <button
              onClick={onClose}
              className="px-4 py-2.5 rounded-xl border border-border text-sm font-medium hover:bg-muted/40 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={saving || !form.displayName || !form.body}
              className="flex items-center gap-2 wa-gradient text-white font-semibold px-5 py-2.5 rounded-xl hover:opacity-90 transition-all disabled:opacity-40"
            >
              {saving ? <><Loader2 className="w-4 h-4 animate-spin" /> Submitting...</> : "Submit for Review"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Template Preview Modal ────────────────────────────────────────────────────
function PreviewModal({ template, onClose }: { template: Template; onClose: () => void }) {
  return (
    <>
      <div className="fixed inset-0 bg-black/60 z-40" onClick={onClose} />
      <div className="fixed inset-0 flex items-center justify-center z-50 p-4">
        <div className="bg-card border border-border rounded-2xl w-full max-w-md shadow-2xl animate-fade-in">
          <div className="p-5 border-b border-border">
            <div className="flex items-start justify-between">
              <div>
                <h3 className="font-semibold">{template.displayName}</h3>
                <p className="text-xs text-muted-foreground mt-0.5 font-mono">{template.name}</p>
              </div>
              <div className="flex items-center gap-2">
                <span className={`text-xs px-2.5 py-1 rounded-full font-medium border ${categoryBadge[template.category]}`}>
                  {template.category}
                </span>
                <StatusBadge
                  status={template.status === "APPROVED" ? "approved" : template.status === "PENDING" ? "pending" : "rejected"}
                />
              </div>
            </div>
          </div>
          <div className="p-5">
            <p className="text-xs text-muted-foreground mb-3">WhatsApp Preview</p>
            <div className="bg-[#0b141a] rounded-2xl p-4">
              <div className="flex items-center gap-2 mb-3 pb-3 border-b border-white/10">
                <div className="w-7 h-7 rounded-full wa-gradient flex items-center justify-center text-xs font-bold text-white">W</div>
                <div>
                  <p className="text-xs font-medium text-white">WASend Business</p>
                  <p className="text-[10px] text-green-400">Online</p>
                </div>
              </div>
              <div className="bg-[#202c33] rounded-2xl rounded-tl-none p-3.5 max-w-[90%]">
                <p className="text-sm text-[#e9edef] leading-relaxed whitespace-pre-wrap">{template.body}</p>
                <p className="text-[10px] text-[#8696a0] text-right mt-2">12:30 ✓✓</p>
              </div>
            </div>
            {template.variables.length > 0 && (
              <div className="mt-4">
                <p className="text-xs text-muted-foreground mb-2">Variables:</p>
                <div className="flex flex-wrap gap-1.5">
                  {template.variables.map((v, i) => (
                    <span key={v} className="text-xs bg-primary/10 text-primary px-2 py-1 rounded-lg font-mono">
                      {`{{${i + 1}}}`} = {v}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
          <div className="p-4 border-t border-border flex justify-end gap-2">
            <button onClick={onClose} className="px-4 py-2 rounded-xl border border-border hover:bg-accent text-sm transition-colors">
              Close
            </button>
            {template.status === "APPROVED" && (
              <Link
                href="/templates/send"
                onClick={onClose}
                className="flex items-center gap-1.5 px-4 py-2 rounded-xl wa-gradient text-white text-sm font-medium"
              >
                <Send className="w-3.5 h-3.5" /> Use Template
              </Link>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

// ─── Main Page ─────────────────────────────────────────────────────────────────
export default function TemplatesPage() {
  const [templateList, setTemplateList] = useState<Template[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [preview, setPreview] = useState<Template | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>("ALL");

  useEffect(() => {
    templatesApi.list()
      .then((data) => setTemplateList(data.templates))
      .catch(() => toast.error("Failed to load templates"));
  }, []);

  const handleRefresh = async () => {
    setRefreshing(true);
    const t = toast.loading("Pulling templates from Meta…");
    try {
      const res = await fetch("/api/templates/sync", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Sync failed");

      const fresh = await templatesApi.list();
      setTemplateList(fresh.templates);

      const wabaCount = Object.keys(data.byWaba || {}).length;
      toast.success(
        `Synced ${data.synced} templates from ${wabaCount} WABA${wabaCount !== 1 ? "s" : ""} ` +
        `(${data.created} new, ${data.updated} updated)`,
        { id: t },
      );
      if (data.errors?.length) {
        toast.warning(`Issues: ${data.errors.slice(0, 2).join("; ")}`);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to sync templates", { id: t });
    } finally {
      setRefreshing(false);
    }
  };

  const filtered = templateList.filter((t) => {
    const matchCat = categoryFilter === "ALL" || t.category === categoryFilter;
    const matchSearch =
      search === "" ||
      t.displayName.toLowerCase().includes(search.toLowerCase()) ||
      t.name.toLowerCase().includes(search.toLowerCase());
    return matchCat && matchSearch;
  });

  const counts = {
    ALL: templateList.length,
    MARKETING: templateList.filter((t) => t.category === "MARKETING").length,
    UTILITY: templateList.filter((t) => t.category === "UTILITY").length,
    AUTHENTICATION: templateList.filter((t) => t.category === "AUTHENTICATION").length,
  };

  return (
    <div className="max-w-6xl">
      <PageHeader
        title="Message Templates"
        subtitle="Manage and send your approved WhatsApp message templates"
        action={
          <div className="flex items-center gap-2">
            <button
              onClick={handleRefresh}
              disabled={refreshing}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl border border-border hover:bg-accent text-sm font-medium transition-colors disabled:opacity-50"
            >
              <RefreshCw className={`w-4 h-4 ${refreshing ? "animate-spin" : ""}`} />
              Sync from Meta
            </button>
            <button
              onClick={() => setShowCreate(true)}
              className="flex items-center gap-2 wa-gradient text-white font-semibold px-4 py-2.5 rounded-xl hover:opacity-90 transition-all shadow-lg shadow-primary/25"
            >
              <Plus className="w-4 h-4" />
              New Template
            </button>
          </div>
        }
      />

      {/* Stats row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        {(["ALL", "MARKETING", "UTILITY", "AUTHENTICATION"] as CategoryFilter[]).map((cat) => {
          const { label, icon: Icon, color } = CATEGORY_CONFIG[cat];
          const approved = cat === "ALL"
            ? templateList.filter((t) => t.status === "APPROVED").length
            : templateList.filter((t) => t.category === cat && t.status === "APPROVED").length;
          return (
            <button
              key={cat}
              onClick={() => setCategoryFilter(cat)}
              className={`text-left p-4 rounded-2xl border transition-all ${
                categoryFilter === cat
                  ? "border-primary/50 bg-primary/5 shadow-sm"
                  : "border-border/50 bg-card hover:border-border hover:bg-card/80"
              }`}
            >
              <div className={`flex items-center gap-2 mb-1.5 ${color}`}>
                <Icon className="w-4 h-4" />
                <span className="text-xs font-medium">{label}</span>
              </div>
              <p className="text-2xl font-bold">{counts[cat]}</p>
              <p className="text-xs text-muted-foreground">{approved} approved</p>
            </button>
          );
        })}
      </div>

      {/* Search */}
      <div className="relative mb-4">
        <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search templates by name..."
          className="w-full bg-card border border-border/50 rounded-xl pl-11 pr-4 py-2.5 text-sm outline-none focus:border-primary/60 transition-all"
        />
      </div>

      {/* Template cards */}
      {filtered.length === 0 ? (
        <div className="bg-card rounded-2xl border border-border/50 p-16 text-center">
          <FolderOpen className="w-12 h-12 text-muted-foreground/40 mx-auto mb-3" />
          <p className="font-medium text-muted-foreground">No templates found</p>
          <p className="text-sm text-muted-foreground/60 mt-1">
            {search || categoryFilter !== "ALL" ? "Try adjusting your filters" : "Create your first template to get started"}
          </p>
          {!search && categoryFilter === "ALL" && (
            <button
              onClick={() => setShowCreate(true)}
              className="mt-4 flex items-center gap-2 wa-gradient text-white font-semibold px-5 py-2.5 rounded-xl hover:opacity-90 transition-all mx-auto"
            >
              <Plus className="w-4 h-4" /> Create Template
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filtered.map((tmpl) => (
            <div
              key={tmpl.id}
              className="bg-card rounded-2xl border border-border/50 p-5 hover:border-border transition-all group flex flex-col"
            >
              {/* Card header */}
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-2.5">
                  <div className={`w-9 h-9 rounded-xl flex items-center justify-center border ${categoryBadge[tmpl.category]}`}>
                    <MessageSquare className="w-4 h-4" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold leading-tight">{tmpl.displayName}</p>
                    <p className="text-[11px] text-muted-foreground font-mono">{tmpl.name}</p>
                  </div>
                </div>
                <StatusBadge
                  status={tmpl.status === "APPROVED" ? "approved" : tmpl.status === "PENDING" ? "pending" : "rejected"}
                />
              </div>

              {/* Body preview */}
              <div className="flex-1 mb-3">
                <p className="text-xs text-muted-foreground leading-relaxed line-clamp-3">{tmpl.body}</p>
              </div>

              {/* Meta */}
              <div className="flex items-center gap-1.5 mb-4">
                <span className={`text-[10px] px-2 py-0.5 rounded-full border font-medium ${categoryBadge[tmpl.category]}`}>
                  {tmpl.category}
                </span>
                <span className="text-[10px] text-muted-foreground bg-muted/40 px-2 py-0.5 rounded-full">
                  {tmpl.language}
                </span>
                {tmpl.variables.length > 0 && (
                  <span className="text-[10px] text-muted-foreground bg-muted/40 px-2 py-0.5 rounded-full">
                    {tmpl.variables.length} var{tmpl.variables.length > 1 ? "s" : ""}
                  </span>
                )}
                <span className="text-[10px] text-muted-foreground ml-auto">
                  {formatDate(tmpl.createdAt)}
                </span>
              </div>

              {/* Actions */}
              <div className="flex items-center gap-2 pt-3 border-t border-border/50">
                <button
                  onClick={() => setPreview(tmpl)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-xs font-medium hover:bg-accent transition-colors"
                >
                  <Eye className="w-3.5 h-3.5" /> Preview
                </button>
                {tmpl.status === "APPROVED" && (
                  <Link
                    href="/templates/send"
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg wa-gradient text-white text-xs font-semibold hover:opacity-90 transition-all"
                  >
                    <Send className="w-3.5 h-3.5" /> Use
                  </Link>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Modals */}
      {preview && <PreviewModal template={preview} onClose={() => setPreview(null)} />}
      {showCreate && (
        <CreateTemplateModal
          onClose={() => setShowCreate(false)}
          onCreated={(t) => setTemplateList((prev) => [t, ...prev])}
        />
      )}
    </div>
  );
}
