"use client";

import { PageHeader } from "@/components/shared/PageHeader";
import {
  templates as templatesApi,
  numbers as numbersApi,
  campaigns as campaignsApi,
  contacts as contactsApi,
  wallet as walletApi,
} from "@/lib/api";
import { Template, WhatsAppNumber } from "@/types";
import {
  Check, ArrowRight, ArrowLeft, Megaphone, Loader2, CheckCircle2,
  Users, Tag, Upload, Zap, Clock, GitBranch, MessageSquare,
  AlertCircle, Phone, X, ChevronDown, Search, BarChart3,
  Wallet, Info, Sparkles, Brain,
} from "lucide-react";
import { useState, useEffect, useRef, useCallback } from "react";
import { toast } from "sonner";
import Link from "next/link";
import { useRouter } from "next/navigation";

const CONTACT_TAGS = ["vip", "retail", "newsletter", "b2b", "new", "seasonal", "loyalty"];
const META_COST_MARKETING = 1.50;
const META_COST_OTHER = 0.80;
const PLATFORM_FEE = 0.30;

const STEPS = ["Setup", "Audience", "Template", "Review"] as const;
type Step = 1 | 2 | 3 | 4;

interface VariableMapping {
  type: "name" | "phone" | "custom";
  value?: string;
}

interface FormState {
  name: string;
  numberId: string;
  campaignType: "broadcast" | "scheduled" | "drip";
  audienceType: "all" | "tags" | "csv";
  selectedTags: string[];
  csvContacts: { name: string; phone: string }[];
  excludeOptedOut: boolean;
  excludeRecentHours: number;
  templateId: string;
  variableMapping: Record<string, VariableMapping>;
  sendNow: boolean;
  scheduleDate: string;
  scheduleTime: string;
}

function parseCSV(text: string): { name: string; phone: string }[] {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length === 0) return [];

  const firstLine = lines[0].toLowerCase();
  const hasHeader = firstLine.includes("name") || firstLine.includes("phone");
  const dataLines = hasHeader ? lines.slice(1) : lines;

  return dataLines
    .map((line) => {
      const cols = line.split(",").map((c) => c.trim().replace(/^["']|["']$/g, ""));
      const name = cols[0] || "";
      const rawPhone = cols[1] || "";
      const phone = rawPhone.replace(/[^\d+]/g, "");
      return { name, phone };
    })
    .filter((r) => r.phone.length >= 7);
}

function WhatsAppPreview({ body, variables, mapping, contact }: {
  body: string;
  variables: string[];
  mapping: Record<string, VariableMapping>;
  contact: { name: string; phone: string };
}) {
  let preview = body;
  variables.forEach((varName, i) => {
    const key = `v${i}`;
    const m = mapping[key];
    let val = `[${varName}]`;
    if (m?.type === "name") val = contact.name;
    else if (m?.type === "phone") val = contact.phone;
    else if (m?.type === "custom" && m.value) val = m.value;
    preview = preview.replace(`{{${i + 1}}}`, val);
  });

  return (
    <div className="bg-[#0b141a] rounded-2xl p-4 mt-4">
      <div className="flex items-center gap-2 mb-3">
        <div className="w-2 h-2 rounded-full bg-emerald-400" />
        <span className="text-[11px] text-[#8696a0]">WhatsApp Preview</span>
      </div>
      <div className="space-y-1">
        <div className="bg-[#202c33] rounded-2xl rounded-tl-none p-3.5 max-w-[88%] shadow-sm">
          <p className="text-[13px] text-[#e9edef] leading-relaxed whitespace-pre-wrap">{preview}</p>
          <p className="text-[10px] text-[#8696a0] text-right mt-1.5">12:30 ✓✓</p>
        </div>
      </div>
    </div>
  );
}

export default function CreateCampaignPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>(1);
  const [templateList, setTemplateList] = useState<Template[]>([]);
  const [numberList, setNumberList] = useState<WhatsAppNumber[]>([]);
  const [audienceCount, setAudienceCount] = useState<number | null>(null);
  const [countLoading, setCountLoading] = useState(false);
  const [walletBalance, setWalletBalance] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [launched, setLaunched] = useState<{ campaignId: string; recipients: number; status: string } | null>(null);
  const [smartSchedule, setSmartSchedule] = useState<{ recommendation: string; bestHours: number[]; hasData: boolean } | null>(null);
  const [smartLoading, setSmartLoading] = useState(false);
  const [useSmartTime, setUseSmartTime] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [csvPreview, setCsvPreview] = useState<{ name: string; phone: string }[]>([]);
  const [templateSearch, setTemplateSearch] = useState("");
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const countDebounceRef = useRef<NodeJS.Timeout | null>(null);

  const [form, setForm] = useState<FormState>({
    name: "",
    numberId: "",
    campaignType: "broadcast",
    audienceType: "all",
    selectedTags: [],
    csvContacts: [],
    excludeOptedOut: true,
    excludeRecentHours: 0,
    templateId: "",
    variableMapping: {},
    sendNow: true,
    scheduleDate: "",
    scheduleTime: "",
  });

  const up = useCallback(<K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((p) => ({ ...p, [key]: value }));
  }, []);

  // Load optimal send time suggestion
  useEffect(() => {
    setSmartLoading(true);
    fetch("/api/analytics/optimal-time")
      .then((r) => r.json())
      .then((d) => setSmartSchedule(d))
      .catch(() => {})
      .finally(() => setSmartLoading(false));
  }, []);

  useEffect(() => {
    Promise.all([templatesApi.list(), numbersApi.list(), walletApi.get()])
      .then(([t, n, w]) => {
        setTemplateList(t.templates);
        setNumberList(n.numbers);
        setWalletBalance(w.balance);
      })
      .catch(console.error);
  }, []);

  // Fetch audience count with debounce
  const fetchCount = useCallback(() => {
    if (form.audienceType === "csv") {
      setAudienceCount(form.csvContacts.length);
      return;
    }
    if (countDebounceRef.current) clearTimeout(countDebounceRef.current);
    countDebounceRef.current = setTimeout(async () => {
      setCountLoading(true);
      try {
        const tags = form.audienceType === "tags" ? form.selectedTags.join(",") : undefined;
        const result = await contactsApi.count({
          audienceType: form.audienceType,
          tags,
          excludeRecentHours: form.excludeRecentHours || undefined,
        });
        setAudienceCount(result.count);
      } catch {
        setAudienceCount(null);
      } finally {
        setCountLoading(false);
      }
    }, 500);
  }, [form.audienceType, form.selectedTags, form.csvContacts.length, form.excludeRecentHours]);

  useEffect(() => {
    if (step === 2) fetchCount();
  }, [step, form.audienceType, form.selectedTags, form.csvContacts, form.excludeRecentHours, fetchCount]);

  const selectedTemplate = templateList.find((t) => t.id === form.templateId);
  const selectedNumber = numberList.find((n) => n.id === form.numberId);
  const recipientCount = audienceCount ?? 0;
  const metaCostPerMsg = selectedTemplate?.category === "MARKETING" ? META_COST_MARKETING : META_COST_OTHER;
  const totalCost = (metaCostPerMsg + PLATFORM_FEE) * recipientCount;
  const metaFeeTotal = metaCostPerMsg * recipientCount;
  const platformFeeTotal = PLATFORM_FEE * recipientCount;

  const walletSufficient = walletBalance !== null && walletBalance >= totalCost;
  const walletWarning = walletBalance !== null && walletBalance >= totalCost * 0.8 && walletBalance < totalCost;

  const canProceed: Record<Step, boolean> = {
    1: !!form.name && !!form.numberId,
    2: true,
    3: !!form.templateId,
    4: true,
  };

  const toggleTag = (tag: string) => {
    up("selectedTags", form.selectedTags.includes(tag)
      ? form.selectedTags.filter((t) => t !== tag)
      : [...form.selectedTags, tag]);
  };

  const handleCSVFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      const parsed = parseCSV(text);
      setCsvPreview(parsed.slice(0, 8));
      up("csvContacts", parsed);
      setAudienceCount(parsed.length);
    };
    reader.readAsText(file);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file && file.name.endsWith(".csv")) handleCSVFile(file);
  };

  const handleLaunch = async () => {
    setShowConfirm(false);
    setSubmitting(true);
    try {
      const scheduledAt = !form.sendNow && form.scheduleDate
        ? `${form.scheduleDate}T${form.scheduleTime || "09:00"}:00`
        : null;

      const result = await campaignsApi.execute({
        name: form.name,
        numberId: form.numberId,
        templateId: form.templateId,
        audienceType: form.audienceType,
        selectedTags: form.selectedTags,
        csvContacts: form.audienceType === "csv" ? form.csvContacts : [],
        excludeRecentHours: form.excludeRecentHours,
        variableMapping: form.variableMapping,
        sendNow: !scheduledAt,
        scheduleDate: form.scheduleDate || undefined,
        scheduleTime: form.scheduleTime || undefined,
      });

      setLaunched({ campaignId: result.campaignId, recipients: result.recipients, status: result.status });
      toast.success(result.status === "scheduled" ? "Campaign scheduled!" : "Campaign launched!");
    } catch (err: unknown) {
      const error = err as Error & { status?: number };
      if (error.status === 402) {
        toast.error("Insufficient wallet balance. Please recharge.");
      } else {
        toast.error(error.message || "Failed to launch campaign");
      }
    } finally {
      setSubmitting(false);
    }
  };

  const approvedTemplates = templateList
    .filter((t) => t.status === "APPROVED")
    .filter((t) => !templateSearch || t.displayName.toLowerCase().includes(templateSearch.toLowerCase()) || t.name.toLowerCase().includes(templateSearch.toLowerCase()));

  // ── Success screen ─────────────────────────────────────────────────────────
  if (launched) {
    return (
      <div className="max-w-lg mx-auto text-center py-16">
        <div className="relative w-24 h-24 mx-auto mb-6">
          <div className="absolute inset-0 rounded-full bg-emerald-500/20 animate-ping" />
          <div className="relative w-24 h-24 rounded-full bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center">
            <CheckCircle2 className="w-12 h-12 text-emerald-400" />
          </div>
        </div>
        <h2 className="text-2xl font-bold mb-2">
          {launched.status === "scheduled" ? "Campaign Scheduled!" : "Campaign Launched!"}
        </h2>
        <p className="text-muted-foreground mb-1">{form.name}</p>
        <p className="text-emerald-400 font-semibold mb-1">
          {launched.recipients.toLocaleString()} recipients
        </p>
        <p className="text-amber-400 font-medium mb-6">Est. ₹{totalCost.toFixed(2)}</p>
        <div className="bg-card border border-border/50 rounded-2xl p-4 text-left mb-6 space-y-2">
          {[
            { label: "Campaign ID", value: launched.campaignId.slice(0, 8) + "…" },
            { label: "Status", value: launched.status === "scheduled" ? "Scheduled" : "Running" },
            { label: "Template", value: selectedTemplate?.displayName || "—" },
            { label: "Sending from", value: selectedNumber?.phoneNumber || "—" },
          ].map(({ label, value }) => (
            <div key={label} className="flex justify-between text-sm">
              <span className="text-muted-foreground">{label}</span>
              <span className="font-medium">{value}</span>
            </div>
          ))}
        </div>
        <div className="flex gap-3 justify-center">
          <Link
            href="/campaigns"
            className="wa-gradient text-white text-sm font-semibold px-5 py-2.5 rounded-xl hover:opacity-90 transition-all shadow-lg shadow-primary/25"
          >
            View Campaigns
          </Link>
          <Link
            href={`/campaigns/${launched.campaignId}`}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl border border-border hover:bg-accent text-sm font-medium transition-colors"
          >
            <BarChart3 className="w-4 h-4" /> Analytics
          </Link>
        </div>
      </div>
    );
  }

  // ── Main page ──────────────────────────────────────────────────────────────
  return (
    <div className="max-w-5xl">
      <PageHeader
        title="Create Campaign"
        subtitle="Broadcast WhatsApp messages to your audience"
      />

      {/* Step indicator */}
      <div className="flex items-center mb-8">
        {STEPS.map((label, i) => {
          const num = (i + 1) as Step;
          const done = step > num;
          const active = step === num;
          return (
            <div key={label} className="flex items-center flex-1 last:flex-none">
              <button
                onClick={() => done && setStep(num)}
                className={`flex items-center gap-2 group ${done ? "cursor-pointer" : "cursor-default"}`}
              >
                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold transition-all ${
                  done
                    ? "bg-emerald-500 text-white"
                    : active
                    ? "wa-gradient text-white shadow-lg shadow-primary/30"
                    : "bg-muted text-muted-foreground"
                }`}>
                  {done ? <Check className="w-4 h-4" /> : num}
                </div>
                <span className={`text-sm font-medium hidden sm:block ${
                  active ? "text-foreground" : done ? "text-emerald-400" : "text-muted-foreground"
                }`}>{label}</span>
              </button>
              {i < STEPS.length - 1 && (
                <div className={`flex-1 h-px mx-3 transition-colors ${done ? "bg-emerald-500/40" : "bg-border"}`} />
              )}
            </div>
          );
        })}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        {/* ── Left: Form ── */}
        <div className="lg:col-span-3">
          <div className="bg-card rounded-2xl border border-border/50 p-6">

            {/* ── Step 1: Setup ── */}
            {step === 1 && (
              <div className="space-y-6">
                <div>
                  <h3 className="font-semibold text-base mb-1">Campaign Setup</h3>
                  <p className="text-xs text-muted-foreground">Give your campaign a name and choose the sending number</p>
                </div>

                <div>
                  <label className="text-sm font-medium block mb-1.5">Campaign Name *</label>
                  <input
                    value={form.name}
                    onChange={(e) => up("name", e.target.value)}
                    placeholder="e.g. Diwali Sale 2026, New Product Launch"
                    className="w-full bg-muted/50 border border-border rounded-xl px-4 py-2.5 text-sm outline-none focus:border-primary/60 focus:ring-2 focus:ring-primary/10 transition-all"
                  />
                </div>

                {/* Campaign type */}
                <div>
                  <label className="text-sm font-medium block mb-2">Campaign Type</label>
                  <div className="grid grid-cols-3 gap-2">
                    {[
                      { id: "broadcast" as const, icon: Zap, label: "Instant Broadcast", desc: "Send now to all at once" },
                      { id: "scheduled" as const, icon: Clock, label: "Scheduled", desc: "Set a future date/time" },
                      { id: "drip" as const, icon: GitBranch, label: "Drip Sequence", desc: "Coming soon", disabled: true },
                    ].map(({ id, icon: Icon, label, desc, disabled }) => (
                      <button
                        key={id}
                        onClick={() => !disabled && up("campaignType", id)}
                        disabled={disabled}
                        className={`relative p-3.5 rounded-xl border text-left transition-all ${
                          form.campaignType === id
                            ? "border-primary bg-primary/5 shadow-sm"
                            : disabled
                            ? "border-border/40 opacity-50 cursor-not-allowed"
                            : "border-border hover:border-border/80 hover:bg-muted/30"
                        }`}
                      >
                        {disabled && (
                          <span className="absolute top-1.5 right-1.5 text-[9px] bg-amber-500/20 text-amber-400 px-1.5 py-0.5 rounded-full font-medium">
                            Soon
                          </span>
                        )}
                        <Icon className={`w-4 h-4 mb-1.5 ${form.campaignType === id ? "text-primary" : "text-muted-foreground"}`} />
                        <p className={`text-xs font-semibold ${form.campaignType === id ? "text-primary" : ""}`}>{label}</p>
                        <p className="text-[10px] text-muted-foreground leading-tight mt-0.5">{desc}</p>
                      </button>
                    ))}
                  </div>
                </div>

                {/* WhatsApp number */}
                <div>
                  <label className="text-sm font-medium block mb-2">WhatsApp Number *</label>
                  {numberList.length === 0 ? (
                    <div className="p-4 border border-amber-500/20 bg-amber-500/5 rounded-xl text-xs text-amber-400 flex gap-2 items-start">
                      <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                      <span>
                        No active numbers connected.{" "}
                        <Link href="/numbers/connect" className="underline font-medium">Connect one first →</Link>
                      </span>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {numberList.map((n) => (
                        <button
                          key={n.id}
                          onClick={() => n.status === "active" && up("numberId", n.id)}
                          disabled={n.status !== "active"}
                          className={`w-full text-left p-4 rounded-xl border transition-all ${
                            form.numberId === n.id
                              ? "border-primary bg-primary/5 shadow-sm"
                              : n.status !== "active"
                              ? "border-border/40 opacity-50 cursor-not-allowed"
                              : "border-border hover:bg-muted/30"
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3">
                              <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${
                                form.numberId === n.id ? "bg-primary/10" : "bg-muted/50"
                              }`}>
                                <Phone className={`w-4 h-4 ${form.numberId === n.id ? "text-primary" : "text-muted-foreground"}`} />
                              </div>
                              <div>
                                <p className="text-sm font-semibold">{n.phoneNumber}</p>
                                <p className="text-[11px] text-muted-foreground">{n.displayName} · {n.status}</p>
                              </div>
                            </div>
                            {form.numberId === n.id && (
                              <div className="w-5 h-5 rounded-full bg-primary flex items-center justify-center">
                                <Check className="w-3 h-3 text-white" />
                              </div>
                            )}
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* ── Step 2: Audience ── */}
            {step === 2 && (
              <div className="space-y-5">
                <div>
                  <h3 className="font-semibold text-base mb-1">Select Audience</h3>
                  <p className="text-xs text-muted-foreground">Who should receive this campaign?</p>
                </div>

                {/* Audience type */}
                <div className="space-y-2">
                  {[
                    { id: "all" as const, icon: Users, label: "All Contacts", desc: "Send to all active contacts in your account" },
                    { id: "tags" as const, icon: Tag, label: "Filter by Tags", desc: "Target contacts with specific tags" },
                    { id: "csv" as const, icon: Upload, label: "Upload CSV", desc: "Custom list from a CSV file" },
                  ].map(({ id, icon: Icon, label, desc }) => (
                    <button
                      key={id}
                      onClick={() => up("audienceType", id)}
                      className={`w-full text-left p-4 rounded-xl border transition-all ${
                        form.audienceType === id
                          ? "border-primary bg-primary/5 shadow-sm"
                          : "border-border hover:bg-muted/30"
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${
                            form.audienceType === id ? "bg-primary/10" : "bg-muted/50"
                          }`}>
                            <Icon className={`w-4 h-4 ${form.audienceType === id ? "text-primary" : "text-muted-foreground"}`} />
                          </div>
                          <div>
                            <p className="text-sm font-semibold">{label}</p>
                            <p className="text-xs text-muted-foreground">{desc}</p>
                          </div>
                        </div>
                        <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition-all ${
                          form.audienceType === id ? "border-primary bg-primary" : "border-border"
                        }`}>
                          {form.audienceType === id && <div className="w-2 h-2 rounded-full bg-white" />}
                        </div>
                      </div>
                    </button>
                  ))}
                </div>

                {/* Tags selector */}
                {form.audienceType === "tags" && (
                  <div>
                    <label className="text-sm font-medium block mb-2">Select Tags</label>
                    <div className="flex flex-wrap gap-2">
                      {CONTACT_TAGS.map((t) => (
                        <button
                          key={t}
                          onClick={() => toggleTag(t)}
                          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium border transition-all ${
                            form.selectedTags.includes(t)
                              ? "bg-primary/10 border-primary/40 text-primary"
                              : "border-border text-muted-foreground hover:bg-muted/40"
                          }`}
                        >
                          {form.selectedTags.includes(t) && <Check className="w-3 h-3" />}
                          #{t}
                        </button>
                      ))}
                    </div>
                    {form.selectedTags.length === 0 && (
                      <p className="text-xs text-amber-400 mt-2 flex items-center gap-1">
                        <Info className="w-3 h-3" /> Select at least one tag to filter contacts
                      </p>
                    )}
                  </div>
                )}

                {/* CSV Upload */}
                {form.audienceType === "csv" && (
                  <div>
                    <div
                      onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                      onDragLeave={() => setIsDragging(false)}
                      onDrop={handleDrop}
                      onClick={() => fileInputRef.current?.click()}
                      className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-all ${
                        isDragging
                          ? "border-primary bg-primary/5"
                          : "border-border/60 hover:border-primary/40 hover:bg-muted/20"
                      }`}
                    >
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept=".csv"
                        className="hidden"
                        onChange={(e) => e.target.files?.[0] && handleCSVFile(e.target.files[0])}
                      />
                      <Upload className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
                      <p className="text-sm font-medium">Drop CSV file here or click to browse</p>
                      <p className="text-xs text-muted-foreground mt-1">Columns: name, phone (header row optional)</p>
                    </div>

                    {csvPreview.length > 0 && (
                      <div className="mt-3">
                        <div className="flex items-center justify-between mb-2">
                          <p className="text-xs font-medium text-emerald-400">
                            {form.csvContacts.length} contacts loaded
                          </p>
                          <button
                            onClick={() => { up("csvContacts", []); setCsvPreview([]); setAudienceCount(0); }}
                            className="text-xs text-muted-foreground hover:text-red-400 flex items-center gap-1"
                          >
                            <X className="w-3 h-3" /> Clear
                          </button>
                        </div>
                        <div className="bg-muted/20 rounded-xl overflow-hidden border border-border/40">
                          <table className="w-full text-xs">
                            <thead>
                              <tr className="border-b border-border/40 bg-muted/30">
                                <th className="text-left px-3 py-2 text-muted-foreground font-medium">Name</th>
                                <th className="text-left px-3 py-2 text-muted-foreground font-medium">Phone</th>
                              </tr>
                            </thead>
                            <tbody>
                              {csvPreview.map((row, i) => (
                                <tr key={i} className="border-b border-border/20 last:border-0">
                                  <td className="px-3 py-1.5">{row.name || "—"}</td>
                                  <td className="px-3 py-1.5 text-muted-foreground">{row.phone}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                          {form.csvContacts.length > 8 && (
                            <p className="text-center text-[10px] text-muted-foreground py-2">
                              + {form.csvContacts.length - 8} more contacts
                            </p>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Exclude options */}
                <div className="space-y-3 pt-2 border-t border-border/40">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium">Exclude opted-out contacts</p>
                      <p className="text-xs text-muted-foreground">Skip contacts who have opted out of messages</p>
                    </div>
                    <button
                      onClick={() => up("excludeOptedOut", !form.excludeOptedOut)}
                      className={`relative w-10 h-5 rounded-full transition-colors ${form.excludeOptedOut ? "bg-primary" : "bg-muted"}`}
                    >
                      <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${form.excludeOptedOut ? "translate-x-5" : "translate-x-0.5"}`} />
                    </button>
                  </div>

                  <div className="flex items-center gap-3">
                    <div className="flex-1">
                      <p className="text-sm font-medium">Exclude recently messaged</p>
                      <p className="text-xs text-muted-foreground">Skip contacts who received a message recently</p>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <input
                        type="number"
                        min={0}
                        max={720}
                        value={form.excludeRecentHours || ""}
                        onChange={(e) => up("excludeRecentHours", parseInt(e.target.value) || 0)}
                        placeholder="0"
                        className="w-16 bg-muted/50 border border-border rounded-lg px-2 py-1.5 text-sm outline-none focus:border-primary/60 text-center"
                      />
                      <span className="text-xs text-muted-foreground">hrs</span>
                    </div>
                  </div>
                </div>

                {/* Audience count badge */}
                <div className="flex items-center gap-2 bg-muted/30 rounded-xl px-4 py-3 border border-border/40">
                  <Users className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                  {countLoading ? (
                    <div className="flex items-center gap-2">
                      <Loader2 className="w-3.5 h-3.5 animate-spin text-primary" />
                      <span className="text-sm text-muted-foreground">Calculating audience…</span>
                    </div>
                  ) : audienceCount !== null ? (
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-emerald-400">{audienceCount.toLocaleString()}</span>
                      <span className="text-sm text-muted-foreground">contacts estimated</span>
                    </div>
                  ) : (
                    <span className="text-sm text-muted-foreground">Select audience to see count</span>
                  )}
                </div>
              </div>
            )}

            {/* ── Step 3: Template ── */}
            {step === 3 && (
              <div className="space-y-4">
                <div>
                  <h3 className="font-semibold text-base mb-1">Select Template</h3>
                  <p className="text-xs text-muted-foreground">Only approved templates can be sent via WhatsApp</p>
                </div>

                {/* Search */}
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <input
                    value={templateSearch}
                    onChange={(e) => setTemplateSearch(e.target.value)}
                    placeholder="Search templates…"
                    className="w-full bg-muted/50 border border-border rounded-xl pl-9 pr-4 py-2.5 text-sm outline-none focus:border-primary/60 transition-all"
                  />
                </div>

                {/* Template list */}
                <div className="space-y-2 max-h-64 overflow-y-auto pr-1 scrollbar-thin">
                  {approvedTemplates.length === 0 ? (
                    <div className="text-center py-8 text-muted-foreground">
                      <MessageSquare className="w-8 h-8 mx-auto mb-2 opacity-30" />
                      <p className="text-sm">No approved templates found</p>
                      <Link href="/templates" className="text-xs text-primary hover:underline mt-1 inline-block">
                        Create a template →
                      </Link>
                    </div>
                  ) : approvedTemplates.map((t) => (
                    <button
                      key={t.id}
                      onClick={() => up("templateId", t.id)}
                      className={`w-full text-left p-4 rounded-xl border transition-all ${
                        form.templateId === t.id
                          ? "border-primary bg-primary/5 shadow-sm"
                          : "border-border hover:bg-muted/30"
                      }`}
                    >
                      <div className="flex items-center justify-between mb-1.5">
                        <p className="text-sm font-semibold">{t.displayName}</p>
                        <div className="flex items-center gap-1.5">
                          <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
                            t.category === "MARKETING"
                              ? "bg-blue-500/10 text-blue-400"
                              : t.category === "UTILITY"
                              ? "bg-emerald-500/10 text-emerald-400"
                              : "bg-amber-500/10 text-amber-400"
                          }`}>{t.category}</span>
                          {form.templateId === t.id && (
                            <div className="w-5 h-5 rounded-full bg-primary flex items-center justify-center">
                              <Check className="w-3 h-3 text-white" />
                            </div>
                          )}
                        </div>
                      </div>
                      <p className="text-xs text-muted-foreground line-clamp-2 leading-relaxed">{t.body}</p>
                    </button>
                  ))}
                </div>

                {/* Variable mapping */}
                {selectedTemplate && selectedTemplate.variables.length > 0 && (
                  <div className="border-t border-border/50 pt-4 space-y-3">
                    <p className="text-sm font-semibold">Personalize Variables</p>
                    {selectedTemplate.variables.map((varName, i) => {
                      const key = `v${i}`;
                      const mapping = form.variableMapping[key];
                      return (
                        <div key={key} className="space-y-1.5">
                          <label className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                            <span className="bg-primary/10 text-primary px-1.5 py-0.5 rounded text-[10px] font-bold">{`{{${i + 1}}}`}</span>
                            {varName}
                          </label>
                          <div className="flex gap-2">
                            <div className="relative flex-1">
                              <select
                                value={mapping?.type || "name"}
                                onChange={(e) => up("variableMapping", {
                                  ...form.variableMapping,
                                  [key]: { type: e.target.value as "name" | "phone" | "custom", value: "" },
                                })}
                                className="w-full appearance-none bg-muted/50 border border-border rounded-xl px-3 py-2 text-sm outline-none focus:border-primary/60 pr-8"
                              >
                                <option value="name">Contact Name</option>
                                <option value="phone">Contact Phone</option>
                                <option value="custom">Custom Value</option>
                              </select>
                              <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
                            </div>
                            {(mapping?.type === "custom") && (
                              <input
                                value={mapping?.value || ""}
                                onChange={(e) => up("variableMapping", {
                                  ...form.variableMapping,
                                  [key]: { type: "custom", value: e.target.value },
                                })}
                                placeholder="Custom text…"
                                className="flex-1 bg-muted/50 border border-border rounded-xl px-3 py-2 text-sm outline-none focus:border-primary/60"
                              />
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* ── Step 4: Review ── */}
            {step === 4 && (
              <div className="space-y-5">
                <div>
                  <h3 className="font-semibold text-base mb-1">Review & Launch</h3>
                  <p className="text-xs text-muted-foreground">Confirm your campaign settings before sending</p>
                </div>

                {/* Summary */}
                <div className="bg-muted/20 rounded-xl border border-border/40 overflow-hidden">
                  {[
                    { label: "Campaign Name", value: form.name },
                    { label: "Sending Number", value: selectedNumber ? `${selectedNumber.phoneNumber} (${selectedNumber.displayName})` : "—" },
                    { label: "Audience", value: form.audienceType === "csv" ? `${form.csvContacts.length} contacts (CSV)` : form.audienceType === "tags" && form.selectedTags.length > 0 ? `Tags: ${form.selectedTags.join(", ")}` : "All active contacts" },
                    { label: "Est. Recipients", value: audienceCount !== null ? `${audienceCount.toLocaleString()} contacts` : "—" },
                    { label: "Template", value: selectedTemplate?.displayName || "—" },
                  ].map(({ label, value }) => (
                    <div key={label} className="flex items-start justify-between px-4 py-3 border-b border-border/30 last:border-0">
                      <span className="text-sm text-muted-foreground">{label}</span>
                      <span className="text-sm font-medium text-right max-w-[55%]">{value}</span>
                    </div>
                  ))}
                </div>

                {/* Cost breakdown */}
                <div>
                  <p className="text-sm font-semibold mb-2">Cost Breakdown</p>
                  <div className="bg-muted/20 rounded-xl border border-border/40 overflow-hidden">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-border/30 bg-muted/30">
                          <th className="text-left px-4 py-2.5 text-xs text-muted-foreground font-medium">Item</th>
                          <th className="text-center px-4 py-2.5 text-xs text-muted-foreground font-medium">Rate</th>
                          <th className="text-right px-4 py-2.5 text-xs text-muted-foreground font-medium">Amount</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr className="border-b border-border/20">
                          <td className="px-4 py-2.5">
                            Meta fee
                            <span className="ml-1.5 text-[10px] text-blue-400">({selectedTemplate?.category || "UTILITY"})</span>
                          </td>
                          <td className="px-4 py-2.5 text-center text-muted-foreground text-xs">
                            {recipientCount} × ₹{metaCostPerMsg.toFixed(2)}
                          </td>
                          <td className="px-4 py-2.5 text-right font-medium">₹{metaFeeTotal.toFixed(2)}</td>
                        </tr>
                        <tr className="border-b border-border/20">
                          <td className="px-4 py-2.5">Platform fee</td>
                          <td className="px-4 py-2.5 text-center text-muted-foreground text-xs">
                            {recipientCount} × ₹{PLATFORM_FEE.toFixed(2)}
                          </td>
                          <td className="px-4 py-2.5 text-right font-medium">₹{platformFeeTotal.toFixed(2)}</td>
                        </tr>
                        <tr className="bg-muted/20">
                          <td className="px-4 py-3 font-semibold">Total</td>
                          <td className="px-4 py-3" />
                          <td className="px-4 py-3 text-right font-bold text-lg">₹{totalCost.toFixed(2)}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Wallet balance */}
                <div className={`flex items-center justify-between p-4 rounded-xl border ${
                  walletBalance === null
                    ? "bg-muted/20 border-border/40"
                    : walletSufficient && !walletWarning
                    ? "bg-emerald-500/5 border-emerald-500/20"
                    : walletWarning
                    ? "bg-amber-500/5 border-amber-500/20"
                    : "bg-red-500/5 border-red-500/20"
                }`}>
                  <div className="flex items-center gap-2.5">
                    <Wallet className={`w-4 h-4 ${
                      walletBalance === null ? "text-muted-foreground" :
                      walletSufficient && !walletWarning ? "text-emerald-400" :
                      walletWarning ? "text-amber-400" : "text-red-400"
                    }`} />
                    <div>
                      <p className="text-sm font-medium">Wallet Balance</p>
                      <p className={`text-xs ${
                        walletBalance === null ? "text-muted-foreground" :
                        walletSufficient && !walletWarning ? "text-emerald-400" :
                        walletWarning ? "text-amber-400" : "text-red-400"
                      }`}>
                        {walletBalance !== null
                          ? walletSufficient
                            ? "Sufficient balance"
                            : `Need ₹${(totalCost - walletBalance).toFixed(2)} more`
                          : "Loading…"}
                      </p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-lg font-bold">
                      {walletBalance !== null ? `₹${walletBalance.toFixed(2)}` : "—"}
                    </p>
                    {walletBalance !== null && !walletSufficient && (
                      <Link href="/billing/recharge" className="text-xs text-primary hover:underline">
                        Recharge Wallet →
                      </Link>
                    )}
                  </div>
                </div>

                {/* Smart Schedule Suggestion */}
                {(smartSchedule || smartLoading) && (
                  <div className={`p-4 rounded-xl border transition-all ${
                    useSmartTime ? "border-violet-500/40 bg-violet-500/5" : "border-border/50 bg-muted/20"
                  }`}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-start gap-2.5">
                        <div className="w-8 h-8 rounded-lg bg-violet-500/10 flex items-center justify-center flex-shrink-0">
                          <Brain className="w-4 h-4 text-violet-400" />
                        </div>
                        <div>
                          <p className="text-xs font-semibold flex items-center gap-1.5">
                            <Sparkles className="w-3 h-3 text-violet-400" />
                            Smart Schedule
                          </p>
                          {smartLoading ? (
                            <p className="text-xs text-muted-foreground mt-0.5">Analyzing your campaign data…</p>
                          ) : smartSchedule ? (
                            <p className="text-xs text-muted-foreground mt-0.5">{smartSchedule.recommendation}</p>
                          ) : null}
                          {smartSchedule && !smartSchedule.hasData && (
                            <p className="text-[10px] text-amber-400 mt-0.5">Based on industry benchmarks (send more campaigns to get personalised insights)</p>
                          )}
                        </div>
                      </div>
                      {smartSchedule && (
                        <button
                          onClick={() => {
                            setUseSmartTime(!useSmartTime);
                            if (!useSmartTime && smartSchedule.bestHours.length > 0) {
                              const h = smartSchedule.bestHours[0];
                              const pad = (n: number) => String(n).padStart(2, "0");
                              const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
                              up("sendNow", false);
                              up("scheduleDate", tomorrow.toISOString().split("T")[0]);
                              up("scheduleTime", `${pad(h)}:00`);
                            }
                          }}
                          className={`text-xs font-medium px-3 py-1.5 rounded-lg transition-all flex-shrink-0 ${
                            useSmartTime
                              ? "bg-violet-500 text-white"
                              : "border border-violet-500/40 text-violet-400 hover:bg-violet-500/10"
                          }`}
                        >
                          {useSmartTime ? "✓ Applied" : "Use this time"}
                        </button>
                      )}
                    </div>
                  </div>
                )}

                {/* Send timing */}
                <div>
                  <p className="text-sm font-semibold mb-2">Send Timing</p>
                  <div className="grid grid-cols-2 gap-2">
                    {[
                      { id: true, icon: Zap, label: "Send Now", desc: "Launch immediately" },
                      { id: false, icon: Clock, label: "Schedule", desc: "Pick date & time" },
                    ].map(({ id, icon: Icon, label, desc }) => (
                      <button
                        key={String(id)}
                        onClick={() => up("sendNow", id)}
                        className={`p-3.5 rounded-xl border text-left transition-all ${
                          form.sendNow === id
                            ? "border-primary bg-primary/5 shadow-sm"
                            : "border-border hover:bg-muted/30"
                        }`}
                      >
                        <Icon className={`w-4 h-4 mb-1 ${form.sendNow === id ? "text-primary" : "text-muted-foreground"}`} />
                        <p className={`text-sm font-semibold ${form.sendNow === id ? "text-primary" : ""}`}>{label}</p>
                        <p className="text-[11px] text-muted-foreground">{desc}</p>
                      </button>
                    ))}
                  </div>
                  {!form.sendNow && (
                    <div className="mt-3 grid grid-cols-2 gap-2">
                      <div>
                        <label className="text-xs text-muted-foreground block mb-1">Date</label>
                        <input
                          type="date"
                          value={form.scheduleDate}
                          onChange={(e) => up("scheduleDate", e.target.value)}
                          className="w-full bg-muted/50 border border-border rounded-xl px-3 py-2 text-sm outline-none focus:border-primary/60"
                        />
                      </div>
                      <div>
                        <label className="text-xs text-muted-foreground block mb-1">Time</label>
                        <input
                          type="time"
                          value={form.scheduleTime}
                          onChange={(e) => up("scheduleTime", e.target.value)}
                          className="w-full bg-muted/50 border border-border rounded-xl px-3 py-2 text-sm outline-none focus:border-primary/60"
                        />
                      </div>
                    </div>
                  )}
                </div>

                {/* Launch button */}
                <button
                  onClick={() => setShowConfirm(true)}
                  disabled={submitting || (walletBalance !== null && !walletSufficient)}
                  className="flex items-center justify-center gap-2 w-full wa-gradient text-white font-semibold py-3.5 rounded-xl hover:opacity-90 transition-all disabled:opacity-40 disabled:cursor-not-allowed shadow-lg shadow-primary/20"
                >
                  {submitting
                    ? <><Loader2 className="w-4 h-4 animate-spin" /> Launching…</>
                    : <><Megaphone className="w-4 h-4" /> {form.sendNow ? "Launch Campaign" : "Schedule Campaign"}</>
                  }
                </button>

                {walletBalance !== null && !walletSufficient && (
                  <p className="text-xs text-red-400 text-center flex items-center justify-center gap-1.5">
                    <AlertCircle className="w-3.5 h-3.5" />
                    Insufficient balance.{" "}
                    <Link href="/billing/recharge" className="underline font-medium">Recharge wallet →</Link>
                  </p>
                )}
              </div>
            )}

            {/* Navigation */}
            <div className="flex items-center gap-3 mt-6 pt-4 border-t border-border/50">
              {step > 1 && (
                <button
                  onClick={() => setStep((p) => (p - 1) as Step)}
                  className="flex items-center gap-2 px-4 py-2.5 rounded-xl border border-border hover:bg-accent text-sm font-medium transition-colors"
                >
                  <ArrowLeft className="w-4 h-4" /> Back
                </button>
              )}
              {step < 4 && (
                <button
                  onClick={() => canProceed[step] && setStep((p) => (p + 1) as Step)}
                  disabled={!canProceed[step]}
                  className="flex items-center gap-2 wa-gradient text-white font-semibold px-5 py-2.5 rounded-xl hover:opacity-90 transition-all disabled:opacity-40 disabled:cursor-not-allowed ml-auto shadow-md shadow-primary/20"
                >
                  Continue <ArrowRight className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>
        </div>

        {/* ── Right: Summary panel ── */}
        <div className="lg:col-span-2 space-y-4">
          <div className="bg-card rounded-2xl border border-border/50 p-5 sticky top-24">
            <p className="text-sm font-semibold mb-4">Live Summary</p>
            <div className="space-y-3">
              {[
                { label: "Name", value: form.name || "—", icon: Megaphone },
                { label: "Number", value: selectedNumber?.phoneNumber || "—", icon: Phone },
                { label: "Audience", value: audienceCount !== null ? `${audienceCount.toLocaleString()} contacts` : "—", icon: Users },
                { label: "Template", value: selectedTemplate?.displayName || "—", icon: MessageSquare },
                { label: "Schedule", value: form.sendNow ? "Send immediately" : form.scheduleDate || "—", icon: Clock },
              ].map(({ label, value, icon: Icon }) => (
                <div key={label} className="flex items-center gap-2.5">
                  <div className="w-7 h-7 rounded-lg bg-muted/50 flex items-center justify-center flex-shrink-0">
                    <Icon className="w-3.5 h-3.5 text-muted-foreground" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wide">{label}</p>
                    <p className="text-xs font-medium truncate">{value}</p>
                  </div>
                </div>
              ))}
            </div>

            {/* WhatsApp preview */}
            {selectedTemplate && (
              <WhatsAppPreview
                body={selectedTemplate.body}
                variables={selectedTemplate.variables}
                mapping={form.variableMapping}
                contact={{ name: "Rahul Kumar", phone: "+91 98765 43210" }}
              />
            )}

            {/* Cost summary */}
            {recipientCount > 0 && (
              <div className="mt-4 pt-4 border-t border-border/30 space-y-1.5">
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>Meta fee</span>
                  <span>₹{metaFeeTotal.toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>Platform fee</span>
                  <span>₹{platformFeeTotal.toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-sm font-bold pt-1 border-t border-border/30">
                  <span>Total</span>
                  <span className="text-amber-400">₹{totalCost.toFixed(2)}</span>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Confirm modal ── */}
      {showConfirm && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ backdropFilter: "blur(8px)", backgroundColor: "rgba(0,0,0,0.6)" }}
        >
          <div className="bg-card border border-border rounded-2xl p-6 w-full max-w-sm shadow-2xl">
            <div className="w-12 h-12 rounded-2xl wa-gradient flex items-center justify-center mx-auto mb-4">
              <Megaphone className="w-6 h-6 text-white" />
            </div>
            <h3 className="text-lg font-bold text-center mb-1">Confirm Campaign Launch</h3>
            <p className="text-sm text-muted-foreground text-center mb-5">
              You are about to send{" "}
              <span className="font-semibold text-foreground">{recipientCount.toLocaleString()} messages</span>
            </p>
            <div className="bg-muted/30 rounded-xl p-4 space-y-2 mb-5">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Campaign</span>
                <span className="font-medium truncate max-w-[55%] text-right">{form.name}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Estimated cost</span>
                <span className="font-bold text-amber-400">₹{totalCost.toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Wallet after</span>
                <span className={`font-medium ${walletSufficient ? "text-emerald-400" : "text-red-400"}`}>
                  ₹{walletBalance !== null ? (walletBalance - totalCost).toFixed(2) : "—"}
                </span>
              </div>
            </div>
            <p className="text-xs text-muted-foreground text-center mb-5">
              This amount will be deducted from your wallet balance. This action cannot be undone.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setShowConfirm(false)}
                className="flex-1 py-2.5 rounded-xl border border-border text-sm font-medium hover:bg-accent transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleLaunch}
                disabled={submitting}
                className="flex-1 py-2.5 rounded-xl wa-gradient text-white text-sm font-semibold hover:opacity-90 transition-all disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {submitting
                  ? <><Loader2 className="w-4 h-4 animate-spin" /> Sending…</>
                  : <><ArrowRight className="w-4 h-4" /> Confirm & Send</>
                }
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
