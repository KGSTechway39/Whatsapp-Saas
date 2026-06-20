"use client";

import { PageHeader } from "@/components/shared/PageHeader";
import { EmptyState } from "@/components/shared/EmptyState";
import {
  Megaphone, RefreshCw, Loader2, ExternalLink, Trash2, Facebook,
  TrendingUp, TrendingDown, Users, MessageSquare, Target,
  IndianRupee, MousePointerClick, Eye, Plus, X, Info,
  AlertCircle, CheckCircle2, Sparkles, ArrowRight,
} from "lucide-react";
import { Suspense, useEffect, useState } from "react";
import { toast } from "sonner";
import { useSearchParams, useRouter } from "next/navigation";

interface AdAccount {
  id: string;
  fb_account_id: string;
  account_name: string;
  business_id: string | null;
  currency: string;
  status: "active" | "expired" | "disconnected";
  last_synced_at: string | null;
  token_expires_at: string | null;
  connected_at: string;
}

interface ROICampaign {
  id: string;
  name: string;
  status: string | null;
  account: string | null;
  currency: string;
  ctwa_clid: string;
  spend: number;
  impressions: number;
  clicks: number;
  ctr: number;
  cpm: number;
  cpc: number;
  leads: number;
  messages_sent: number;
  conversions: number;
  revenue: number;
  cac: number;
  conversion_rate: number;
  roas: number;
  profit: number;
}

interface ROISummary {
  spend: number;
  impressions: number;
  clicks: number;
  leads: number;
  messages: number;
  conversions: number;
  revenue: number;
  cac: number;
  roas: number;
  profit: number;
  conversion_rate: number;
}

const formatINR = (n: number) =>
  n >= 100000 ? `₹${(n / 100000).toFixed(2)}L` : n >= 1000 ? `₹${(n / 1000).toFixed(1)}k` : `₹${n.toFixed(0)}`;

const fmtNum = (n: number) =>
  n >= 1000000 ? `${(n / 1000000).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : n.toString();

function AdsPageContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [accounts, setAccounts] = useState<AdAccount[]>([]);
  const [summary, setSummary] = useState<ROISummary | null>(null);
  const [campaigns, setCampaigns] = useState<ROICampaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [showConnect, setShowConnect] = useState(false);

  // Toast on OAuth callback redirect
  useEffect(() => {
    if (searchParams.get("connected")) {
      toast.success("Ads account connected!");
      router.replace("/ads");
    } else if (searchParams.get("error")) {
      toast.error(`Connection failed: ${searchParams.get("error")}`);
      router.replace("/ads");
    }
  }, [searchParams, router]);

  const load = async () => {
    setLoading(true);
    try {
      const [accRes, roiRes] = await Promise.all([
        fetch("/api/ads/accounts").then((r) => r.json()),
        fetch("/api/ads/roi").then((r) => r.json()),
      ]);
      setAccounts(accRes.accounts || []);
      setSummary(roiRes.summary || null);
      setCampaigns(roiRes.campaigns || []);
    } catch {
      toast.error("Failed to load ads data");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const handleConnect = async () => {
    try {
      const res = await fetch("/api/ads/connect");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      window.location.href = data.url;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to start connection");
    }
  };

  const handleSync = async () => {
    setSyncing(true);
    try {
      const res = await fetch("/api/ads/campaigns", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success(`Synced ${data.synced} campaigns`);
      if (data.errors?.length) toast.warning(`Issues: ${data.errors[0]}`);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Sync failed");
    } finally {
      setSyncing(false);
    }
  };

  const handleDisconnect = async (id: string) => {
    if (!confirm("Disconnect this ad account? Synced campaigns will remain.")) return;
    try {
      await fetch(`/api/ads/accounts?id=${id}`, { method: "DELETE" });
      toast.success("Account disconnected");
      load();
    } catch {
      toast.error("Failed to disconnect");
    }
  };

  // ── Empty state: no accounts connected ──────────────────────────────────
  if (!loading && accounts.length === 0) {
    return (
      <div className="max-w-5xl">
        <PageHeader
          title="Click-to-WhatsApp Ads"
          subtitle="Track Facebook ads → WhatsApp leads → conversions in one view"
        />

        <div className="bg-card border border-border/50 rounded-2xl p-12 text-center">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-blue-500/20 to-violet-500/20 flex items-center justify-center mx-auto mb-5 border border-blue-500/20">
            <Facebook className="w-8 h-8 text-blue-400" />
          </div>
          <h2 className="text-2xl font-bold mb-2">Connect your Facebook Ads</h2>
          <p className="text-sm text-muted-foreground max-w-md mx-auto mb-6">
            Sync campaigns from Meta Ads, attribute leads from Click-to-WhatsApp ads to contacts,
            and see real ROI — ad spend → messages sent → conversions.
          </p>

          <div className="grid grid-cols-3 gap-4 max-w-2xl mx-auto mb-8">
            {[
              { icon: Target, title: "Auto-attribute leads", desc: "Tag contacts that reach you via CTWA ads" },
              { icon: TrendingUp, title: "Real-time ROI", desc: "Spend, leads, conversions, ROAS in one place" },
              { icon: Sparkles, title: "Campaign-level reports", desc: "See which ads drive the best conversations" },
            ].map(({ icon: Icon, title, desc }) => (
              <div key={title} className="text-left p-4 rounded-xl bg-muted/20 border border-border/40">
                <Icon className="w-4 h-4 text-blue-400 mb-2" />
                <p className="text-sm font-medium mb-0.5">{title}</p>
                <p className="text-[11px] text-muted-foreground leading-relaxed">{desc}</p>
              </div>
            ))}
          </div>

          <div className="flex items-center justify-center gap-3">
            <button
              onClick={handleConnect}
              className="flex items-center gap-2 bg-[#1877F2] hover:bg-[#0e64d6] text-white font-semibold px-5 py-2.5 rounded-xl transition-all shadow-lg shadow-blue-500/20"
            >
              <Facebook className="w-4 h-4" />
              Connect with Facebook
            </button>
            <button
              onClick={() => setShowConnect(true)}
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl border border-border hover:bg-accent text-sm font-medium transition-colors"
            >
              <Plus className="w-4 h-4" />
              Paste Access Token
            </button>
          </div>

          <p className="text-[11px] text-muted-foreground mt-5">
            Required permissions: <code className="bg-muted/50 px-1.5 py-0.5 rounded">ads_read</code>,{" "}
            <code className="bg-muted/50 px-1.5 py-0.5 rounded">ads_management</code>,{" "}
            <code className="bg-muted/50 px-1.5 py-0.5 rounded">business_management</code>
          </p>
        </div>

        {showConnect && <ManualTokenModal onClose={() => setShowConnect(false)} onConnected={load} />}
      </div>
    );
  }

  return (
    <div className="max-w-7xl">
      <PageHeader
        title="Click-to-WhatsApp Ads"
        subtitle="Spend, leads, and conversions across all your Meta campaigns"
        action={
          <div className="flex items-center gap-2">
            <button
              onClick={handleSync}
              disabled={syncing}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl border border-border hover:bg-accent text-sm font-medium transition-colors disabled:opacity-50"
            >
              <RefreshCw className={`w-4 h-4 ${syncing ? "animate-spin" : ""}`} />
              {syncing ? "Syncing…" : "Sync from Meta"}
            </button>
            <button
              onClick={handleConnect}
              className="flex items-center gap-2 bg-[#1877F2] hover:bg-[#0e64d6] text-white text-sm font-semibold px-4 py-2.5 rounded-xl transition-colors"
            >
              <Plus className="w-4 h-4" />
              Add Account
            </button>
          </div>
        }
      />

      {/* Summary KPI cards */}
      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          {[
            { label: "Ad Spend",     value: formatINR(summary.spend),         icon: IndianRupee,       color: "text-amber-400",  bg: "bg-amber-500/10" },
            { label: "Leads",        value: fmtNum(summary.leads),            icon: Users,             color: "text-blue-400",   bg: "bg-blue-500/10" },
            { label: "Conversions",  value: `${fmtNum(summary.conversions)}`, icon: Target,            color: "text-emerald-400", bg: "bg-emerald-500/10",
              sub: `${summary.conversion_rate}% conv rate` },
            { label: "ROAS",         value: `${summary.roas.toFixed(2)}x`,    icon: TrendingUp,        color: summary.roas >= 1 ? "text-emerald-400" : "text-red-400",
              bg: summary.roas >= 1 ? "bg-emerald-500/10" : "bg-red-500/10",
              sub: summary.profit >= 0 ? `+${formatINR(summary.profit)} profit` : `-${formatINR(Math.abs(summary.profit))} loss` },
          ].map(({ label, value, icon: Icon, color, bg, sub }) => (
            <div key={label} className="bg-card border border-border/50 rounded-2xl p-4">
              <div className="flex items-start justify-between mb-2">
                <span className="text-xs text-muted-foreground font-medium">{label}</span>
                <div className={`w-7 h-7 rounded-lg ${bg} flex items-center justify-center`}>
                  <Icon className={`w-3.5 h-3.5 ${color}`} />
                </div>
              </div>
              <p className="text-2xl font-bold tracking-tight">{value}</p>
              {sub && <p className={`text-[11px] font-medium mt-0.5 ${color}`}>{sub}</p>}
            </div>
          ))}
        </div>
      )}

      {/* Funnel mini-viz */}
      {summary && summary.spend > 0 && (
        <div className="bg-card border border-border/50 rounded-2xl p-5 mb-6">
          <div className="flex items-center justify-between mb-4">
            <p className="text-sm font-semibold">Conversion Funnel</p>
            <p className="text-xs text-muted-foreground">CAC: <span className="font-semibold text-foreground">{formatINR(summary.cac)}</span></p>
          </div>
          <div className="flex items-end gap-1.5 h-24">
            {[
              { label: "Impressions",  value: summary.impressions, color: "from-blue-500/40    to-blue-500/20" },
              { label: "Clicks",       value: summary.clicks,      color: "from-violet-500/50  to-violet-500/20" },
              { label: "Leads",        value: summary.leads,       color: "from-fuchsia-500/60 to-fuchsia-500/20" },
              { label: "Messages",     value: summary.messages,    color: "from-emerald-500/60 to-emerald-500/20" },
              { label: "Conversions",  value: summary.conversions, color: "from-amber-500/70   to-amber-500/20" },
            ].map(({ label, value, color }, i, arr) => {
              const max = arr[0].value || 1;
              const pct = Math.max(8, (value / max) * 100);
              return (
                <div key={label} className="flex-1 flex flex-col items-center justify-end gap-2">
                  <span className="text-xs font-bold">{fmtNum(value)}</span>
                  <div
                    className={`w-full bg-gradient-to-t ${color} border-t border-white/10 rounded-t-lg`}
                    style={{ height: `${pct}%` }}
                  />
                  <span className="text-[10px] text-muted-foreground">{label}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Connected accounts */}
      <div className="bg-card border border-border/50 rounded-2xl p-5 mb-6">
        <p className="text-sm font-semibold mb-3">Connected Ad Accounts ({accounts.length})</p>
        <div className="space-y-2">
          {accounts.map((acc) => (
            <div key={acc.id} className="flex items-center justify-between p-3 rounded-xl border border-border/40 bg-muted/20">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg bg-blue-500/10 flex items-center justify-center">
                  <Facebook className="w-4 h-4 text-blue-400" />
                </div>
                <div>
                  <p className="text-sm font-semibold">{acc.account_name || acc.fb_account_id}</p>
                  <p className="text-[11px] text-muted-foreground font-mono">{acc.fb_account_id} · {acc.currency}</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
                  acc.status === "active"
                    ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                    : "bg-red-500/10 text-red-400 border border-red-500/20"
                }`}>
                  {acc.status}
                </span>
                {acc.last_synced_at && (
                  <span className="text-[11px] text-muted-foreground">
                    Synced {new Date(acc.last_synced_at).toLocaleDateString()}
                  </span>
                )}
                <button
                  onClick={() => handleDisconnect(acc.id)}
                  className="p-1.5 rounded-lg text-muted-foreground hover:text-red-400 hover:bg-red-500/10 transition-colors"
                  title="Disconnect"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Campaign ROI table */}
      <div className="bg-card border border-border/50 rounded-2xl overflow-hidden">
        <div className="p-5 border-b border-border/40 flex items-center justify-between">
          <p className="text-sm font-semibold">Campaign Performance</p>
          {syncing && <Loader2 className="w-4 h-4 animate-spin text-primary" />}
        </div>

        {loading ? (
          <div className="p-12 text-center"><Loader2 className="w-6 h-6 animate-spin text-primary mx-auto" /></div>
        ) : campaigns.length === 0 ? (
          <EmptyState
            icon={Megaphone}
            title="No campaigns synced yet"
            description="Click 'Sync from Meta' to pull campaigns and insights from your connected ad accounts"
            action={
              <button
                onClick={handleSync}
                disabled={syncing}
                className="flex items-center gap-2 wa-gradient text-white font-semibold px-5 py-2.5 rounded-xl hover:opacity-90 transition-all"
              >
                <RefreshCw className="w-4 h-4" /> Sync Now
              </button>
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/30">
                <tr className="text-xs text-muted-foreground border-b border-border/40">
                  <th className="text-left px-4 py-3 font-medium">Campaign</th>
                  <th className="text-right px-3 py-3 font-medium">Spend</th>
                  <th className="text-right px-3 py-3 font-medium">Impr.</th>
                  <th className="text-right px-3 py-3 font-medium">Clicks</th>
                  <th className="text-right px-3 py-3 font-medium">Leads</th>
                  <th className="text-right px-3 py-3 font-medium">Msgs</th>
                  <th className="text-right px-3 py-3 font-medium">Conv.</th>
                  <th className="text-right px-3 py-3 font-medium">CAC</th>
                  <th className="text-right px-3 py-3 font-medium">Revenue</th>
                  <th className="text-right px-3 py-3 font-medium">ROAS</th>
                </tr>
              </thead>
              <tbody>
                {campaigns.map((c) => {
                  const isProfit = c.roas >= 1;
                  return (
                    <tr key={c.id} className="border-b border-border/20 last:border-0 hover:bg-muted/20 transition-colors">
                      <td className="px-4 py-3">
                        <p className="font-medium truncate max-w-[200px]">{c.name}</p>
                        <p className="text-[10px] text-muted-foreground font-mono truncate max-w-[200px]">{c.account || "—"}</p>
                      </td>
                      <td className="px-3 py-3 text-right tabular-nums">{formatINR(c.spend)}</td>
                      <td className="px-3 py-3 text-right tabular-nums text-muted-foreground">{fmtNum(c.impressions)}</td>
                      <td className="px-3 py-3 text-right tabular-nums">{fmtNum(c.clicks)}</td>
                      <td className="px-3 py-3 text-right tabular-nums font-semibold text-blue-400">{c.leads}</td>
                      <td className="px-3 py-3 text-right tabular-nums text-muted-foreground">{c.messages_sent}</td>
                      <td className="px-3 py-3 text-right tabular-nums">
                        <span className="font-semibold text-emerald-400">{c.conversions}</span>
                        {c.leads > 0 && (
                          <span className="text-[10px] text-muted-foreground ml-1">({c.conversion_rate}%)</span>
                        )}
                      </td>
                      <td className="px-3 py-3 text-right tabular-nums">
                        {c.leads > 0 ? formatINR(c.cac) : "—"}
                      </td>
                      <td className="px-3 py-3 text-right tabular-nums">
                        {c.revenue > 0 ? formatINR(c.revenue) : "—"}
                      </td>
                      <td className="px-3 py-3 text-right">
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold ${
                          c.spend === 0
                            ? "bg-muted/40 text-muted-foreground"
                            : isProfit
                            ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                            : "bg-red-500/10 text-red-400 border border-red-500/20"
                        }`}>
                          {c.spend === 0 ? "—" : isProfit ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                          {c.spend === 0 ? "" : `${c.roas.toFixed(2)}x`}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Info footer */}
      <div className="mt-6 p-4 bg-blue-500/5 border border-blue-500/20 rounded-xl flex items-start gap-3">
        <Info className="w-4 h-4 text-blue-400 flex-shrink-0 mt-0.5" />
        <div className="text-xs text-muted-foreground leading-relaxed">
          <strong className="text-foreground">How CTWA attribution works:</strong> when a customer taps your Facebook
          Click-to-WhatsApp ad, Meta sends a referral payload to your webhook. WASend matches it to the campaign,
          tags the contact (<code className="bg-muted/50 px-1 rounded">crm_source = ctwa</code>), and increments
          this campaign&apos;s lead count. ROAS updates automatically as those contacts move to{" "}
          <code className="bg-muted/50 px-1 rounded">crm_stage = converted</code> with a <code className="bg-muted/50 px-1 rounded">deal_value</code>.
        </div>
      </div>

      {showConnect && <ManualTokenModal onClose={() => setShowConnect(false)} onConnected={load} />}
    </div>
  );
}

// ── Manual token paste modal (alternative to OAuth) ─────────────────────
function ManualTokenModal({ onClose, onConnected }: { onClose: () => void; onConnected: () => void }) {
  const [token, setToken] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    if (!token.trim()) return;
    setSubmitting(true);
    try {
      const res = await fetch("/api/ads/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accessToken: token.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success(`Connected ${data.connected} ad accounts`);
      onConnected();
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to connect");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="bg-card border border-border rounded-2xl shadow-2xl w-full max-w-lg">
        <div className="flex items-center justify-between p-5 border-b border-border">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-blue-500/10 flex items-center justify-center">
              <Facebook className="w-4 h-4 text-blue-400" />
            </div>
            <div>
              <h3 className="font-semibold">Connect with Access Token</h3>
              <p className="text-xs text-muted-foreground">Paste a token from Meta Business Suite</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-muted/50 text-muted-foreground transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div className="bg-blue-500/5 border border-blue-500/20 rounded-xl p-3 text-xs text-muted-foreground space-y-1.5">
            <p className="font-medium text-foreground">How to get a token:</p>
            <ol className="list-decimal list-inside space-y-0.5">
              <li>Go to <a href="https://developers.facebook.com/tools/explorer/" target="_blank" rel="noreferrer" className="text-blue-400 hover:underline inline-flex items-center gap-0.5">Graph API Explorer <ExternalLink className="w-3 h-3" /></a></li>
              <li>Select your Meta App and add scopes: <code className="bg-muted/50 px-1 rounded">ads_read, ads_management, business_management</code></li>
              <li>Generate token and paste below — we&apos;ll auto-upgrade to long-lived</li>
            </ol>
          </div>

          <div>
            <label className="text-sm font-medium block mb-1.5">Access Token *</label>
            <textarea
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="EAAB..."
              rows={4}
              className="w-full bg-muted/50 border border-border rounded-xl px-3 py-2.5 text-xs font-mono outline-none focus:border-primary/60 resize-none"
            />
          </div>

          <button
            onClick={submit}
            disabled={!token.trim() || submitting}
            className="w-full flex items-center justify-center gap-2 bg-[#1877F2] hover:bg-[#0e64d6] disabled:opacity-50 text-white font-semibold py-2.5 rounded-xl transition-colors"
          >
            {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
            {submitting ? "Validating…" : "Connect Account"}
          </button>
        </div>
      </div>
    </div>
  );
}

// useSearchParams() requires a Suspense boundary for static prerender (Next 14).
export default function AdsPage() {
  return (
    <Suspense fallback={null}>
      <AdsPageContent />
    </Suspense>
  );
}
