"use client";

import { PageHeader } from "@/components/shared/PageHeader";
import { admin as adminApi, type AdminUser, type AdminMargin, type Tier } from "@/lib/api";
import { Loader2, Search, ShieldCheck, Wallet, TrendingUp, SlidersHorizontal } from "lucide-react";
import { useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";

const inr = (paise: number) =>
  `₹${(paise / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const TIER_INFO: Record<Tier, { label: string; model: string; blurb: string }> = {
  starter: {
    label: "Starter",
    model: "Model C · managed · shared WABA",
    blurb: "Prepaid wallet billing, sends under the platform's shared WhatsApp number.",
  },
  growth: {
    label: "Growth",
    model: "Model B · managed · own WABA",
    blurb: "Prepaid wallet billing, sends from the client's own connected number.",
  },
  enterprise: {
    label: "Enterprise",
    model: "Model A · BYO · own WABA",
    blurb: "No platform billing — client pays Meta directly from their own number.",
  },
};

const TIER_ORDER: Tier[] = ["starter", "growth", "enterprise"];

export default function AdminBillingPage() {
  const [authorized, setAuthorized] = useState<boolean | null>(null);
  const [email, setEmail] = useState("");
  const [user, setUser] = useState<AdminUser | null>(null);
  const [margin, setMargin] = useState<AdminMargin | null>(null);
  const [searching, setSearching] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    adminApi.check()
      .then(() => setAuthorized(true))
      .catch(() => setAuthorized(false));
  }, []);

  const lookup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;
    setSearching(true);
    setUser(null);
    setMargin(null);
    try {
      const { user } = await adminApi.lookup(email.trim());
      setUser(user);
      // Margin is best-effort — a fresh/unbilled client just shows zeros.
      adminApi.margin(user.id).then(({ margin }) => setMargin(margin)).catch(() => setMargin(null));
    } catch (err) {
      toast.error((err as Error).message || "User not found");
    } finally {
      setSearching(false);
    }
  };

  const assignTier = async (tier: Tier) => {
    if (!user || tier === user.tier) return;
    setSaving(true);
    try {
      const { user: updated } = await adminApi.setTier(user.email, tier);
      setUser(updated);
      toast.success(`Tier set to ${TIER_INFO[tier].label} (${updated.billing_mode.toUpperCase()})`);
    } catch (err) {
      toast.error((err as Error).message || "Failed to update");
    } finally {
      setSaving(false);
    }
  };

  if (authorized === null) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!authorized) {
    return (
      <div>
        <PageHeader title="Admin" subtitle="Platform administration" />
        <div className="rounded-xl border border-border bg-card p-8 text-center">
          <ShieldCheck className="mx-auto h-10 w-10 text-muted-foreground" />
          <p className="mt-3 font-medium">Not authorized</p>
          <p className="text-sm text-muted-foreground">
            This page is restricted to platform admins (ADMIN_EMAILS allowlist).
          </p>
        </div>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Tier"
        subtitle="Set a client's product tier (derives billing & WABA mode)"
        action={
          <Link
            href="/admin/rates"
            className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm font-medium hover:bg-muted/50"
          >
            <SlidersHorizontal className="h-4 w-4" /> Rates &amp; markup
          </Link>
        }
      />

      <form onSubmit={lookup} className="mb-6 flex gap-2">
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="client@example.com"
          className="flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
        />
        <button
          type="submit"
          disabled={searching}
          className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60"
        >
          {searching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
          Look up
        </button>
      </form>

      {user && (
        <div className="rounded-xl border border-border bg-card p-6">
          <div className="flex items-start justify-between">
            <div>
              <p className="font-medium">{user.full_name || "—"}</p>
              <p className="text-sm text-muted-foreground">{user.email}</p>
            </div>
            <span className="rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
              {TIER_INFO[user.tier].label.toUpperCase()}
            </span>
          </div>

          <div className="mt-3 text-xs text-muted-foreground">
            {user.billing_mode.toUpperCase()} billing · {user.waba_mode} WABA
          </div>

          <div className="mt-4 flex items-center gap-2 text-sm text-muted-foreground">
            <Wallet className="h-4 w-4" />
            Wallet balance: ₹{(user.balance_paise / 100).toFixed(2)}
          </div>

          {margin && (
            <div className="mt-5 rounded-xl border border-border/60 bg-background/40 p-4">
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                <TrendingUp className="h-3.5 w-3.5" /> Revenue &amp; margin
              </div>
              <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Metric label="Total revenue" value={inr(margin.totalRevenuePaise)} accent />
                <Metric label="Message margin" value={inr(margin.messageMarginPaise)} />
                <Metric label="Platform fees" value={inr(margin.platformPaidPaise)} />
                <Metric label="Messages billed" value={margin.messageCount.toLocaleString("en-IN")} />
              </div>
              <p className="mt-3 text-[11px] text-muted-foreground">
                Margin = charged − Meta wholesale on {margin.trackedCount.toLocaleString("en-IN")} tracked
                send{margin.trackedCount === 1 ? "" : "s"} (spend {inr(margin.messageChargedPaise)}, cost{" "}
                {inr(margin.messageCostPaise)}).
              </p>
            </div>
          )}

          <div className="mt-6 grid gap-3 sm:grid-cols-3">
            {TIER_ORDER.map((tier) => {
              const active = tier === user.tier;
              return (
                <button
                  key={tier}
                  onClick={() => assignTier(tier)}
                  disabled={saving || active}
                  className={`rounded-lg border p-4 text-left transition disabled:opacity-60 ${
                    active
                      ? "border-primary bg-primary/5 ring-1 ring-primary"
                      : "border-border hover:bg-muted/50"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-medium">{TIER_INFO[tier].label}</span>
                    {saving && !active ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : active ? (
                      <span className="text-xs font-medium text-primary">Current</span>
                    ) : null}
                  </div>
                  <div className="mt-1 text-[11px] uppercase tracking-wide text-muted-foreground">
                    {TIER_INFO[tier].model}
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground">{TIER_INFO[tier].blurb}</p>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function Metric({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div>
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={`mt-0.5 text-sm font-semibold ${accent ? "text-emerald-500" : ""}`}>{value}</p>
    </div>
  );
}
