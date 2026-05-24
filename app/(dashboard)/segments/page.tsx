"use client";

import { PageHeader } from "@/components/shared/PageHeader";
import { EmptyState } from "@/components/shared/EmptyState";
import {
  Users, Activity, Moon, Sparkles, Crown, Target, Facebook,
  Plus, X, Trash2, ChevronRight, Loader2, Filter, Eye, Send,
  Wand2, BarChart3, AlertCircle, Check, GitBranch,
} from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import Link from "next/link";

const ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  Users, Activity, Moon, Sparkles, Crown, Target, Facebook, GitBranch, Filter,
};

const COLORS: Record<string, { bg: string; text: string; border: string; ring: string }> = {
  blue:     { bg: "bg-blue-500/10",     text: "text-blue-400",     border: "border-blue-500/20",     ring: "ring-blue-500/30" },
  emerald:  { bg: "bg-emerald-500/10",  text: "text-emerald-400",  border: "border-emerald-500/20",  ring: "ring-emerald-500/30" },
  amber:    { bg: "bg-amber-500/10",    text: "text-amber-400",    border: "border-amber-500/20",    ring: "ring-amber-500/30" },
  red:      { bg: "bg-red-500/10",      text: "text-red-400",      border: "border-red-500/20",      ring: "ring-red-500/30" },
  violet:   { bg: "bg-violet-500/10",   text: "text-violet-400",   border: "border-violet-500/20",   ring: "ring-violet-500/30" },
  fuchsia:  { bg: "bg-fuchsia-500/10",  text: "text-fuchsia-400",  border: "border-fuchsia-500/20",  ring: "ring-fuchsia-500/30" },
};

interface Condition {
  field: string;
  op: string;
  value: string | number;
}

interface SegmentRules {
  operator: "AND" | "OR";
  conditions: Condition[];
}

interface SegmentRow {
  id: string;
  key?: string;
  name: string;
  description: string | null;
  color: string;
  icon: string;
  rules: SegmentRules;
  is_system: boolean;
  count: number;
}

interface RFMData {
  total: number;
  buckets: Record<string, number>;
  heatmap: number[][];
  contacts: { contact_id: string; recency_days: number | null; frequency: number; monetary: number; r_score: number; f_score: number; m_score: number; segment: string }[];
}

const FIELD_OPTIONS: { value: string; label: string; type: "text" | "number" | "tag" | "stage" | "date" | "exists" }[] = [
  { value: "tags",             label: "Tag",                 type: "tag" },
  { value: "crm_stage",        label: "CRM stage",           type: "stage" },
  { value: "crm_score",        label: "CRM score",           type: "number" },
  { value: "deal_value",       label: "Deal value (₹)",      type: "number" },
  { value: "company",          label: "Company",             type: "text" },
  { value: "name",             label: "Name",                type: "text" },
  { value: "email",            label: "Email",               type: "text" },
  { value: "last_contacted",   label: "Last contacted",      type: "date" },
  { value: "added_date",       label: "Added date",          type: "date" },
  { value: "ctwa_campaign_id", label: "CTWA ad lead",        type: "exists" },
];

const OPS_BY_TYPE: Record<string, { value: string; label: string }[]> = {
  text:   [{ value: "equals", label: "is" }, { value: "contains", label: "contains" }, { value: "not_contains", label: "doesn't contain" }],
  number: [{ value: "gte", label: "≥" }, { value: "lte", label: "≤" }, { value: "gt", label: ">" }, { value: "lt", label: "<" }, { value: "equals", label: "=" }],
  tag:    [{ value: "contains", label: "has tag" }, { value: "not_contains", label: "missing tag" }],
  stage:  [{ value: "equals", label: "is" }, { value: "not_equals", label: "is not" }],
  date:   [{ value: "within_days", label: "within last N days" }, { value: "older_than", label: "older than N days" }],
  exists: [{ value: "exists", label: "is set" }, { value: "is_null", label: "is empty" }],
};

const STAGES = ["new_lead", "contacted", "qualified", "interested", "converted"];

export default function SegmentsPage() {
  const [system, setSystem] = useState<SegmentRow[]>([]);
  const [custom, setCustom] = useState<SegmentRow[]>([]);
  const [rfm, setRfm] = useState<RFMData | null>(null);
  const [loading, setLoading] = useState(true);
  const [showBuilder, setShowBuilder] = useState(false);
  const [activeSegment, setActiveSegment] = useState<SegmentRow | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const [segRes, rfmRes] = await Promise.all([
        fetch("/api/segments").then((r) => r.json()),
        fetch("/api/segments/rfm").then((r) => r.json()),
      ]);
      setSystem(segRes.system || []);
      setCustom(segRes.custom || []);
      setRfm(rfmRes);
    } catch {
      toast.error("Failed to load segments");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this segment?")) return;
    try {
      await fetch(`/api/segments/${id}`, { method: "DELETE" });
      toast.success("Segment deleted");
      load();
    } catch {
      toast.error("Failed to delete");
    }
  };

  return (
    <div className="max-w-7xl">
      <PageHeader
        title="Smart Segments"
        subtitle="Auto-grouped audiences + custom rules with RFM scoring"
        action={
          <button
            onClick={() => setShowBuilder(true)}
            className="flex items-center gap-2 wa-gradient text-white font-semibold px-4 py-2.5 rounded-xl hover:opacity-90 transition-all shadow-lg shadow-primary/25"
          >
            <Plus className="w-4 h-4" />
            New Segment
          </button>
        }
      />

      {loading ? (
        <div className="py-16 text-center">
          <Loader2 className="w-6 h-6 animate-spin text-primary mx-auto" />
        </div>
      ) : (
        <>
          {/* Auto-segments */}
          <div className="mb-6">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
              Auto-segments
            </p>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
              {system.map((s) => {
                const Icon = ICONS[s.icon] || Users;
                const c = COLORS[s.color] || COLORS.blue;
                return (
                  <button
                    key={s.id}
                    onClick={() => setActiveSegment(s)}
                    className={`text-left p-4 rounded-2xl border ${c.border} ${c.bg} hover:ring-2 ${c.ring} transition-all group`}
                  >
                    <div className={`w-9 h-9 rounded-xl bg-card border ${c.border} flex items-center justify-center mb-3`}>
                      <Icon className={`w-4 h-4 ${c.text}`} />
                    </div>
                    <p className="text-sm font-semibold mb-0.5">{s.name}</p>
                    <p className="text-[10px] text-muted-foreground leading-tight line-clamp-2 mb-2">{s.description}</p>
                    <p className={`text-2xl font-bold ${c.text}`}>{s.count.toLocaleString()}</p>
                    <p className="text-[10px] text-muted-foreground">contacts</p>
                  </button>
                );
              })}
            </div>
          </div>

          {/* RFM Analysis */}
          {rfm && rfm.total > 0 && (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
              {/* RFM heatmap */}
              <div className="lg:col-span-2 bg-card border border-border/50 rounded-2xl p-5">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <p className="text-sm font-semibold flex items-center gap-2">
                      <BarChart3 className="w-4 h-4 text-violet-400" />
                      RFM Heatmap
                    </p>
                    <p className="text-[11px] text-muted-foreground mt-0.5">Recency × Frequency • {rfm.total} contacts scored</p>
                  </div>
                  <Link href="#" className="text-xs text-primary hover:underline">Learn more →</Link>
                </div>

                {/* Y-axis: Recency 5→1, X-axis: Frequency 1→5 */}
                <div className="flex gap-2 items-start">
                  <div className="flex flex-col items-end gap-1 pt-7">
                    <span className="text-[10px] text-muted-foreground -rotate-90 origin-right whitespace-nowrap mt-2">Recency</span>
                  </div>
                  <div className="flex-1">
                    <div className="grid grid-cols-5 gap-1.5 mb-1.5">
                      {[1, 2, 3, 4, 5].map((r) => (
                        <div key={r} className="text-[10px] text-muted-foreground text-center">F={r}</div>
                      ))}
                    </div>
                    <div className="space-y-1.5">
                      {rfm.heatmap.map((row, ri) => {
                        const r = 5 - ri;
                        const max = Math.max(...rfm.heatmap.flat()) || 1;
                        return (
                          <div key={ri} className="flex items-center gap-1.5">
                            <span className="text-[10px] text-muted-foreground w-6 text-right">R={r}</span>
                            {row.map((v, fi) => {
                              const intensity = v / max;
                              const isHigh = r >= 4 && (fi + 1) >= 4;
                              const isLow = r <= 2 && (fi + 1) <= 2;
                              return (
                                <div
                                  key={fi}
                                  className={`flex-1 aspect-square rounded-md flex items-center justify-center text-[10px] font-bold transition-all hover:ring-2 hover:ring-violet-500/50 ${
                                    v === 0
                                      ? "bg-muted/20 text-muted-foreground/40"
                                      : isHigh
                                      ? "text-emerald-100"
                                      : isLow
                                      ? "text-red-100"
                                      : "text-violet-100"
                                  }`}
                                  style={{
                                    backgroundColor: v === 0 ? undefined : isHigh
                                      ? `rgba(16, 185, 129, ${0.25 + intensity * 0.55})`
                                      : isLow
                                      ? `rgba(239, 68, 68, ${0.25 + intensity * 0.55})`
                                      : `rgba(139, 92, 246, ${0.2 + intensity * 0.5})`,
                                  }}
                                >
                                  {v > 0 ? v : ""}
                                </div>
                              );
                            })}
                          </div>
                        );
                      })}
                    </div>
                    <p className="text-[10px] text-muted-foreground text-center mt-2">Frequency →</p>
                  </div>
                </div>
              </div>

              {/* RFM buckets */}
              <div className="bg-card border border-border/50 rounded-2xl p-5">
                <p className="text-sm font-semibold mb-3 flex items-center gap-2">
                  <Target className="w-4 h-4 text-violet-400" />
                  Customer Tiers
                </p>
                <div className="space-y-2">
                  {Object.entries(rfm.buckets)
                    .sort((a, b) => b[1] - a[1])
                    .map(([bucket, count]) => {
                      const pct = (count / rfm.total) * 100;
                      const color =
                        bucket === "Champions"      ? "emerald" :
                        bucket === "Loyal"          ? "blue"    :
                        bucket === "Big Spenders"   ? "fuchsia" :
                        bucket === "New Customers"  ? "violet"  :
                        bucket === "At Risk"        ? "amber"   :
                        bucket === "Cannot Lose"    ? "amber"   :
                        bucket === "Lost"           ? "red"     :
                                                       "blue";
                      const c = COLORS[color];
                      return (
                        <div key={bucket}>
                          <div className="flex items-center justify-between text-xs mb-1">
                            <span className={`font-medium ${c.text}`}>{bucket}</span>
                            <span className="text-muted-foreground tabular-nums">{count} <span className="opacity-60">({pct.toFixed(0)}%)</span></span>
                          </div>
                          <div className="h-1.5 bg-muted/30 rounded-full overflow-hidden">
                            <div className={c.bg.replace("/10", "/60")} style={{ width: `${pct}%`, height: "100%" }} />
                          </div>
                        </div>
                      );
                    })}
                </div>
              </div>
            </div>
          )}

          {/* Custom segments */}
          <div className="mb-6">
            <div className="flex items-center justify-between mb-3">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                Saved Segments ({custom.length})
              </p>
            </div>

            {custom.length === 0 ? (
              <div className="bg-card border border-border/50 rounded-2xl p-12 text-center">
                <Filter className="w-10 h-10 text-muted-foreground/40 mx-auto mb-3" />
                <p className="text-sm font-medium mb-1">No custom segments yet</p>
                <p className="text-xs text-muted-foreground mb-4">Build a segment to target high-value contacts with precision</p>
                <button
                  onClick={() => setShowBuilder(true)}
                  className="inline-flex items-center gap-2 wa-gradient text-white font-semibold px-4 py-2 rounded-xl text-sm hover:opacity-90"
                >
                  <Plus className="w-3.5 h-3.5" /> Create Segment
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {custom.map((s) => {
                  const Icon = ICONS[s.icon] || Users;
                  const c = COLORS[s.color] || COLORS.blue;
                  return (
                    <div
                      key={s.id}
                      className="bg-card border border-border/50 rounded-2xl p-4 hover:border-primary/40 transition-all group cursor-pointer"
                      onClick={() => setActiveSegment(s)}
                    >
                      <div className="flex items-start justify-between mb-3">
                        <div className={`w-9 h-9 rounded-xl ${c.bg} border ${c.border} flex items-center justify-center`}>
                          <Icon className={`w-4 h-4 ${c.text}`} />
                        </div>
                        <button
                          onClick={(e) => { e.stopPropagation(); handleDelete(s.id); }}
                          className="opacity-0 group-hover:opacity-100 p-1.5 rounded-lg hover:bg-red-500/10 text-muted-foreground hover:text-red-400 transition-all"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                      <p className="text-sm font-semibold mb-0.5">{s.name}</p>
                      {s.description && <p className="text-[11px] text-muted-foreground line-clamp-2 mb-3">{s.description}</p>}
                      <div className="flex items-end justify-between">
                        <p className={`text-2xl font-bold ${c.text}`}>{s.count.toLocaleString()}</p>
                        <span className="text-[10px] text-muted-foreground bg-muted/40 px-2 py-0.5 rounded-full font-medium">
                          {s.rules.conditions.length} rule{s.rules.conditions.length !== 1 ? "s" : ""} · {s.rules.operator}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </>
      )}

      {showBuilder && <SegmentBuilder onClose={() => setShowBuilder(false)} onSaved={load} />}
      {activeSegment && <SegmentDetail segment={activeSegment} onClose={() => setActiveSegment(null)} />}
    </div>
  );
}

// ── Segment Builder Modal ────────────────────────────────────────────────
function SegmentBuilder({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [color, setColor] = useState("blue");
  const [operator, setOperator] = useState<"AND" | "OR">("AND");
  const [conditions, setConditions] = useState<Condition[]>([{ field: "tags", op: "contains", value: "" }]);
  const [preview, setPreview] = useState<{ count: number; sample: { id: string; name: string; phone: string }[] } | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [saving, setSaving] = useState(false);

  const addCondition = () => setConditions((c) => [...c, { field: "tags", op: "contains", value: "" }]);
  const removeCondition = (i: number) => setConditions((c) => c.filter((_, idx) => idx !== i));
  const updateCondition = (i: number, patch: Partial<Condition>) => {
    setConditions((c) => c.map((x, idx) => idx === i ? { ...x, ...patch } : x));
  };

  const runPreview = async () => {
    setPreviewing(true);
    try {
      const res = await fetch("/api/segments/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rules: { operator, conditions } }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setPreview(data);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Preview failed");
    } finally {
      setPreviewing(false);
    }
  };

  const save = async () => {
    if (!name.trim()) { toast.error("Name is required"); return; }
    setSaving(true);
    try {
      const res = await fetch("/api/segments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, description, color, icon: "Filter", rules: { operator, conditions } }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success(`Segment "${name}" created`);
      onSaved();
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="bg-card border border-border rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between p-5 border-b border-border flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl wa-gradient flex items-center justify-center">
              <Wand2 className="w-4 h-4 text-white" />
            </div>
            <div>
              <h3 className="font-semibold">Build Segment</h3>
              <p className="text-xs text-muted-foreground">Define rules — see matching contacts in real time</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-muted/50 text-muted-foreground transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {/* Name + color */}
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2">
              <label className="text-sm font-medium block mb-1.5">Segment Name *</label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. High-value Mumbai customers"
                className="w-full bg-muted/50 border border-border rounded-xl px-3 py-2 text-sm outline-none focus:border-primary/60"
              />
            </div>
            <div>
              <label className="text-sm font-medium block mb-1.5">Color</label>
              <div className="flex gap-1">
                {Object.keys(COLORS).map((c) => (
                  <button
                    key={c}
                    onClick={() => setColor(c)}
                    className={`flex-1 h-9 rounded-lg ${COLORS[c].bg} border ${
                      color === c ? `ring-2 ${COLORS[c].ring}` : "border-transparent"
                    } transition-all`}
                  />
                ))}
              </div>
            </div>
          </div>

          <div>
            <label className="text-sm font-medium block mb-1.5">Description <span className="text-muted-foreground font-normal">(optional)</span></label>
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What does this segment represent?"
              className="w-full bg-muted/50 border border-border rounded-xl px-3 py-2 text-sm outline-none focus:border-primary/60"
            />
          </div>

          {/* Match operator */}
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">Match</span>
            <div className="flex bg-muted/40 rounded-lg p-0.5">
              {(["AND", "OR"] as const).map((op) => (
                <button
                  key={op}
                  onClick={() => setOperator(op)}
                  className={`px-3 py-1 rounded-md text-xs font-semibold transition-all ${
                    operator === op ? "bg-primary text-white shadow-sm" : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {op === "AND" ? "ALL" : "ANY"}
                </button>
              ))}
            </div>
            <span className="text-sm text-muted-foreground">of these conditions</span>
          </div>

          {/* Conditions */}
          <div className="space-y-2">
            {conditions.map((cond, i) => {
              const fieldDef = FIELD_OPTIONS.find((f) => f.value === cond.field) || FIELD_OPTIONS[0];
              const ops = OPS_BY_TYPE[fieldDef.type];
              const showValue = !["exists", "is_null"].includes(cond.op);

              return (
                <div key={i} className="flex items-center gap-2 p-3 bg-muted/20 border border-border/40 rounded-xl">
                  {i > 0 && (
                    <span className="text-xs font-bold text-muted-foreground bg-muted/40 px-2 py-0.5 rounded-md">
                      {operator === "AND" ? "AND" : "OR"}
                    </span>
                  )}

                  <select
                    value={cond.field}
                    onChange={(e) => {
                      const newField = e.target.value;
                      const newDef = FIELD_OPTIONS.find((f) => f.value === newField)!;
                      updateCondition(i, { field: newField, op: OPS_BY_TYPE[newDef.type][0].value, value: "" });
                    }}
                    className="flex-1 bg-card border border-border/50 rounded-lg px-2.5 py-1.5 text-xs outline-none focus:border-primary/60"
                  >
                    {FIELD_OPTIONS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
                  </select>

                  <select
                    value={cond.op}
                    onChange={(e) => updateCondition(i, { op: e.target.value })}
                    className="bg-card border border-border/50 rounded-lg px-2.5 py-1.5 text-xs outline-none focus:border-primary/60"
                  >
                    {ops.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>

                  {showValue && (
                    fieldDef.type === "stage" ? (
                      <select
                        value={cond.value}
                        onChange={(e) => updateCondition(i, { value: e.target.value })}
                        className="flex-1 bg-card border border-border/50 rounded-lg px-2.5 py-1.5 text-xs outline-none focus:border-primary/60"
                      >
                        <option value="">Pick stage</option>
                        {STAGES.map((s) => <option key={s} value={s}>{s.replace("_", " ")}</option>)}
                      </select>
                    ) : (
                      <input
                        type={fieldDef.type === "number" || fieldDef.type === "date" ? "number" : "text"}
                        value={cond.value}
                        onChange={(e) => updateCondition(i, { value: fieldDef.type === "number" || fieldDef.type === "date" ? Number(e.target.value) : e.target.value })}
                        placeholder={
                          fieldDef.type === "tag" ? "vip, retail…" :
                          fieldDef.type === "date" ? "days" :
                          "value"
                        }
                        className="flex-1 bg-card border border-border/50 rounded-lg px-2.5 py-1.5 text-xs outline-none focus:border-primary/60"
                      />
                    )
                  )}

                  {conditions.length > 1 && (
                    <button
                      onClick={() => removeCondition(i)}
                      className="p-1.5 rounded-lg text-muted-foreground hover:text-red-400 hover:bg-red-500/10"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              );
            })}

            <button
              onClick={addCondition}
              className="w-full flex items-center justify-center gap-1.5 py-2 rounded-xl border border-dashed border-border hover:border-primary/40 hover:bg-primary/5 text-xs text-muted-foreground hover:text-primary transition-all"
            >
              <Plus className="w-3.5 h-3.5" /> Add condition
            </button>
          </div>

          {/* Preview */}
          <div className="border-t border-border/40 pt-4">
            <div className="flex items-center justify-between mb-3">
              <p className="text-sm font-medium">Live Preview</p>
              <button
                onClick={runPreview}
                disabled={previewing}
                className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-border hover:bg-accent transition-colors disabled:opacity-50"
              >
                {previewing ? <Loader2 className="w-3 h-3 animate-spin" /> : <Eye className="w-3 h-3" />}
                {previewing ? "Calculating…" : "Run Preview"}
              </button>
            </div>

            {preview && (
              <div className="p-4 bg-emerald-500/5 border border-emerald-500/20 rounded-xl">
                <p className="text-2xl font-bold text-emerald-400">{preview.count.toLocaleString()}</p>
                <p className="text-xs text-muted-foreground mb-3">contacts match these rules</p>
                {preview.sample.length > 0 && (
                  <div className="space-y-1">
                    <p className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground mb-1">First {preview.sample.length}</p>
                    {preview.sample.slice(0, 5).map((c) => (
                      <div key={c.id} className="flex items-center gap-2 text-xs">
                        <Check className="w-3 h-3 text-emerald-400" />
                        <span className="font-medium truncate">{c.name}</span>
                        <span className="text-muted-foreground">{c.phone}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center justify-between p-5 border-t border-border flex-shrink-0">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-xl border border-border hover:bg-accent text-sm font-medium"
          >
            Cancel
          </button>
          <button
            onClick={save}
            disabled={!name.trim() || saving}
            className="flex items-center gap-2 wa-gradient text-white font-semibold px-5 py-2 rounded-xl hover:opacity-90 transition-all disabled:opacity-40"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
            {saving ? "Saving…" : "Save Segment"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Segment Detail Modal ─────────────────────────────────────────────────
function SegmentDetail({ segment, onClose }: { segment: SegmentRow; onClose: () => void }) {
  const [contacts, setContacts] = useState<{ id: string; name: string; phone: string; tags: string[]; crm_stage: string; deal_value: number; last_contacted: string | null }[]>([]);
  const [loading, setLoading] = useState(true);
  const c = COLORS[segment.color] || COLORS.blue;
  const Icon = ICONS[segment.icon] || Users;

  useEffect(() => {
    fetch(`/api/segments/${segment.id}/contacts?limit=50`)
      .then((r) => r.json())
      .then((data) => setContacts(data.contacts || []))
      .catch(() => toast.error("Failed to load contacts"))
      .finally(() => setLoading(false));
  }, [segment.id]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="bg-card border border-border rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between p-5 border-b border-border flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-xl ${c.bg} border ${c.border} flex items-center justify-center`}>
              <Icon className={`w-5 h-5 ${c.text}`} />
            </div>
            <div>
              <h3 className="font-semibold">{segment.name}</h3>
              <p className="text-xs text-muted-foreground">
                {segment.count.toLocaleString()} contacts · {segment.rules.conditions.length} rule{segment.rules.conditions.length !== 1 ? "s" : ""} · {segment.rules.operator}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-muted/50 text-muted-foreground transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="py-12 text-center"><Loader2 className="w-5 h-5 animate-spin text-primary mx-auto" /></div>
          ) : contacts.length === 0 ? (
            <EmptyState
              icon={Users}
              title="No contacts in this segment"
              description="Adjust the rules or wait for matching contacts to come in"
            />
          ) : (
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-card border-b border-border/40">
                <tr className="text-xs text-muted-foreground">
                  <th className="text-left px-5 py-3 font-medium">Name</th>
                  <th className="text-left px-5 py-3 font-medium">Phone</th>
                  <th className="text-left px-5 py-3 font-medium">Stage</th>
                  <th className="text-right px-5 py-3 font-medium">Deal value</th>
                </tr>
              </thead>
              <tbody>
                {contacts.map((c) => (
                  <tr key={c.id} className="border-b border-border/20 last:border-0 hover:bg-muted/20">
                    <td className="px-5 py-2.5">
                      <p className="font-medium">{c.name}</p>
                      <div className="flex flex-wrap gap-1 mt-0.5">
                        {(c.tags || []).slice(0, 3).map((t) => (
                          <span key={t} className="text-[10px] bg-muted/40 text-muted-foreground px-1.5 py-0.5 rounded">{t}</span>
                        ))}
                      </div>
                    </td>
                    <td className="px-5 py-2.5 font-mono text-xs text-muted-foreground">{c.phone}</td>
                    <td className="px-5 py-2.5">
                      <span className="text-[11px] bg-muted/40 px-2 py-0.5 rounded-full">{(c.crm_stage || "").replace("_", " ")}</span>
                    </td>
                    <td className="px-5 py-2.5 text-right tabular-nums font-medium">
                      {c.deal_value > 0 ? `₹${Number(c.deal_value).toLocaleString()}` : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="flex items-center justify-between gap-3 p-5 border-t border-border flex-shrink-0">
          <p className="text-xs text-muted-foreground">
            Showing {contacts.length} of {segment.count.toLocaleString()}
          </p>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-xl border border-border hover:bg-accent text-sm font-medium"
            >
              Close
            </button>
            <Link
              href={`/campaigns/create?segment=${segment.id}`}
              className="flex items-center gap-1.5 wa-gradient text-white text-sm font-semibold px-4 py-2 rounded-xl hover:opacity-90"
            >
              <Send className="w-3.5 h-3.5" /> Send Campaign <ChevronRight className="w-3.5 h-3.5" />
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
