"use client";

import { PageHeader } from "@/components/shared/PageHeader";
import {
  admin as adminApi,
  type RateConfig,
  type RateCategory,
  type PlanTier,
} from "@/lib/api";
import { Loader2, Save, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

const CATEGORIES: RateCategory[] = ["MARKETING", "UTILITY", "AUTHENTICATION", "SERVICE"];
const TIER_LABEL: Record<string, string> = { starter: "Starter", growth: "Growth", enterprise: "Enterprise" };

const paiseToRupees = (p: number) => (p / 100).toString();
const rupeesToPaise = (r: string) => Math.round(Number(r) * 100);
const bpsToPct = (b: number) => (b / 100).toString();
const pctToBps = (p: string) => Math.round(Number(p) * 100);

export default function AdminRatesPage() {
  const [authorized, setAuthorized] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [cfg, setCfg] = useState<RateConfig | null>(null);

  // Editable mirrors (friendly units: paise for wholesale, % for markup/buffer, ₹ for fees).
  const [wholesale, setWholesale] = useState<Record<RateCategory, string>>({} as Record<RateCategory, string>);
  const [tiers, setTiers] = useState<PlanTier[]>([]);
  const [bufferPct, setBufferPct] = useState("");
  const [minTopup, setMinTopup] = useState("");
  const [lowBal, setLowBal] = useState("");
  const [validity, setValidity] = useState("");

  const hydrate = (c: RateConfig) => {
    setCfg(c);
    if (c.rates) setWholesale(Object.fromEntries(CATEGORIES.map((k) => [k, String(c.rates![k])])) as Record<RateCategory, string>);
    if (c.tiers) setTiers(c.tiers);
    if (c.settings) {
      setBufferPct(bpsToPct(c.settings.buffer_bps));
      setMinTopup(paiseToRupees(c.settings.min_topup_paise));
      setLowBal(paiseToRupees(c.settings.default_low_balance_threshold_paise));
      setValidity(String(c.settings.credit_validity_months));
    }
  };

  useEffect(() => {
    adminApi
      .check()
      .then(() => {
        setAuthorized(true);
        return adminApi.ratesGet();
      })
      .then((c) => c && hydrate(c))
      .catch(() => setAuthorized((a) => (a === null ? false : a)))
      .finally(() => setLoading(false));
  }, []);

  const setTierField = (tier: string, field: keyof PlanTier, value: string) => {
    setTiers((prev) => prev.map((t) => (t.tier === tier ? { ...t, [field]: value === "" ? null : Number(value) } : t)));
  };

  const save = async () => {
    setSaving(true);
    try {
      const body = {
        rates: Object.fromEntries(CATEGORIES.map((k) => [k, Math.round(Number(wholesale[k]))])) as Record<RateCategory, number>,
        tiers: tiers.map((t) => ({
          tier: t.tier,
          default_markup_bps: Number(t.default_markup_bps),
          monthly_fee_paise: Number(t.monthly_fee_paise),
          onboarding_fee_paise: Number(t.onboarding_fee_paise),
          monthly_msg_cap: t.monthly_msg_cap === null ? null : Number(t.monthly_msg_cap),
        })),
        settings: {
          buffer_bps: pctToBps(bufferPct),
          min_topup_paise: rupeesToPaise(minTopup),
          default_low_balance_threshold_paise: rupeesToPaise(lowBal),
          credit_validity_months: Math.round(Number(validity)),
        },
      };
      const fresh = await adminApi.ratesSave(body);
      hydrate(fresh);
      toast.success("Rate config saved");
    } catch (err) {
      toast.error((err as Error).message || "Save failed");
    } finally {
      setSaving(false);
    }
  };

  if (authorized === null || loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!authorized) {
    return (
      <div>
        <PageHeader title="Rates & markup" subtitle="Platform administration" />
        <div className="rounded-xl border border-border bg-card p-8 text-center">
          <ShieldCheck className="mx-auto h-10 w-10 text-muted-foreground" />
          <p className="mt-3 font-medium">Not authorized</p>
          <p className="text-sm text-muted-foreground">Restricted to platform admins (ADMIN_EMAILS).</p>
        </div>
      </div>
    );
  }

  if (!cfg?.rates || !cfg.tiers || !cfg.settings) {
    return (
      <div>
        <PageHeader title="Rates & markup" subtitle="Edit Meta rates, markup & limits" />
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-6 text-sm">
          Apply migration <code className="font-mono text-xs">017_billing_rates.sql</code> to configure rates.
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-3xl space-y-6">
      <PageHeader title="Rates & markup" subtitle="Edit Meta wholesale, per-tier markup & global limits" />

      {/* Meta wholesale */}
      <Section title="Meta wholesale (cost)" hint="Per message, in paise. Saving a change keeps history (versioned).">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {CATEGORIES.map((cat) => (
            <Field
              key={cat}
              label={cat}
              suffix="paise"
              value={wholesale[cat] ?? ""}
              onChange={(v) => setWholesale((p) => ({ ...p, [cat]: v }))}
              hint={`₹${(Number(wholesale[cat] || 0) / 100).toFixed(2)}`}
            />
          ))}
        </div>
      </Section>

      {/* Tiers */}
      <Section title="Tiers" hint="Markup % and monthly fee per tier. Charged = wholesale × (1 + markup + buffer).">
        <div className="space-y-3">
          {tiers.map((t) => (
            <div key={t.tier} className="rounded-xl border border-border/60 bg-background/40 p-3">
              <p className="mb-2 text-sm font-medium">
                {TIER_LABEL[t.tier] ?? t.tier}{" "}
                <span className="text-xs text-muted-foreground">· Model {t.model} · {t.billing_mode}</span>
              </p>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Field
                  label="Markup"
                  suffix="bps"
                  value={String(t.default_markup_bps)}
                  onChange={(v) => setTierField(t.tier, "default_markup_bps", v)}
                  hint={`${bpsToPct(Number(t.default_markup_bps) || 0)}%`}
                />
                <Field
                  label="Monthly fee"
                  suffix="paise"
                  value={String(t.monthly_fee_paise)}
                  onChange={(v) => setTierField(t.tier, "monthly_fee_paise", v)}
                  hint={`₹${(Number(t.monthly_fee_paise) || 0) / 100}`}
                />
                <Field
                  label="Onboarding fee"
                  suffix="paise"
                  value={String(t.onboarding_fee_paise)}
                  onChange={(v) => setTierField(t.tier, "onboarding_fee_paise", v)}
                  hint={`₹${(Number(t.onboarding_fee_paise) || 0) / 100}`}
                />
                <Field
                  label="Monthly cap"
                  suffix="msgs"
                  value={t.monthly_msg_cap === null ? "" : String(t.monthly_msg_cap)}
                  onChange={(v) => setTierField(t.tier, "monthly_msg_cap", v)}
                  hint={t.monthly_msg_cap === null ? "uncapped" : ""}
                />
              </div>
            </div>
          ))}
        </div>
      </Section>

      {/* Global settings */}
      <Section title="Global settings">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Field label="Buffer" suffix="%" value={bufferPct} onChange={setBufferPct} hint="safety vs Meta hikes" />
          <Field label="Min top-up" suffix="₹" value={minTopup} onChange={setMinTopup} />
          <Field label="Low-balance alert" suffix="₹" value={lowBal} onChange={setLowBal} />
          <Field label="Credit validity" suffix="months" value={validity} onChange={setValidity} />
        </div>
      </Section>

      <button
        onClick={save}
        disabled={saving}
        className="inline-flex items-center gap-2 rounded-lg bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground disabled:opacity-60"
      >
        {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
        Save changes
      </button>
    </div>
  );
}

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-border/60 bg-card p-5">
      <h2 className="text-sm font-semibold">{title}</h2>
      {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}

function Field({
  label,
  suffix,
  value,
  onChange,
  hint,
}: {
  label: string;
  suffix?: string;
  value: string;
  onChange: (v: string) => void;
  hint?: string;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] uppercase tracking-wide text-muted-foreground">{label}</span>
      <div className="flex items-center gap-1 rounded-lg border border-border bg-background px-2.5 py-2 focus-within:border-primary">
        <input
          inputMode="numeric"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full bg-transparent text-sm outline-none"
        />
        {suffix && <span className="text-[11px] text-muted-foreground">{suffix}</span>}
      </div>
      {hint && <span className="mt-0.5 block text-[10px] text-muted-foreground">{hint}</span>}
    </label>
  );
}
