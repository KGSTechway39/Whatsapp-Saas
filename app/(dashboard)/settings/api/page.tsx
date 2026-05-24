"use client";

import { PageHeader } from "@/components/shared/PageHeader";
import { EmptyState } from "@/components/shared/EmptyState";
import {
  Key, Plus, Loader2, X, Copy, Check, Trash2, AlertCircle, BookOpen,
  Webhook, Eye, EyeOff, Activity, Pause, Play, ExternalLink,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { toast } from "sonner";

interface ApiKey {
  id: string;
  name: string;
  prefix: string;
  environment: "live" | "test";
  scopes: string[];
  rate_limit_per_min: number;
  is_active: boolean;
  last_used_at: string | null;
  request_count: number;
  expires_at: string | null;
  created_at: string;
}

interface AvailableScope {
  key: string;
  label: string;
  group: string;
}

interface WebhookEndpoint {
  id: string;
  name: string | null;
  url: string;
  events: string[];
  status: "active" | "paused" | "failed";
  last_delivery_at: string | null;
  last_success_at: string | null;
  failure_count: number;
  total_deliveries: number;
  created_at: string;
}

export default function ApiSettingsPage() {
  const [tab, setTab] = useState<"keys" | "webhooks">("keys");
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [scopes, setScopes] = useState<AvailableScope[]>([]);
  const [endpoints, setEndpoints] = useState<WebhookEndpoint[]>([]);
  const [supportedEvents, setSupportedEvents] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [showWebhookCreate, setShowWebhookCreate] = useState(false);
  const [newKey, setNewKey] = useState<{ full_key: string; name: string; prefix: string } | null>(null);
  const [newSecret, setNewSecret] = useState<{ secret: string; url: string } | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const [k, w] = await Promise.all([
        fetch("/api/api-keys").then((r) => r.json()),
        fetch("/api/webhook-endpoints").then((r) => r.json()),
      ]);
      setKeys(k.keys || []);
      setScopes(k.available_scopes || []);
      setEndpoints(w.endpoints || []);
      setSupportedEvents(w.supported_events || []);
    } catch {
      toast.error("Failed to load");
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, []);

  const revokeKey = async (id: string) => {
    if (!confirm("Revoke this API key? Apps using it will stop working immediately.")) return;
    await fetch(`/api/api-keys/${id}`, { method: "DELETE" });
    toast.success("Key revoked");
    load();
  };

  const toggleEndpoint = async (ep: WebhookEndpoint) => {
    const next = ep.status === "paused" ? "active" : "paused";
    await fetch(`/api/webhook-endpoints/${ep.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: next }),
    });
    toast.success(`Endpoint ${next}`);
    load();
  };

  const deleteEndpoint = async (id: string) => {
    if (!confirm("Delete this webhook endpoint? Pending retries will be discarded.")) return;
    await fetch(`/api/webhook-endpoints/${id}`, { method: "DELETE" });
    toast.success("Endpoint deleted");
    load();
  };

  return (
    <div className="max-w-5xl">
      <PageHeader
        title="API & Webhooks"
        subtitle="Programmatic access to send messages, manage contacts, and receive events"
        action={
          <Link
            href="/settings/api/docs"
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl border border-border hover:bg-accent text-sm font-medium transition-colors"
          >
            <BookOpen className="w-4 h-4" />
            API Docs
          </Link>
        }
      />

      {/* Tabs */}
      <div className="flex gap-1 mb-6 bg-muted/20 p-1 rounded-xl w-fit">
        {[
          { id: "keys"     as const, label: "API Keys",        count: keys.length, icon: Key },
          { id: "webhooks" as const, label: "Webhook Endpoints", count: endpoints.length, icon: Webhook },
        ].map(({ id, label, count, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`flex items-center gap-2 px-4 py-1.5 rounded-lg text-sm font-medium transition-all ${
              tab === id ? "bg-card shadow text-foreground" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Icon className="w-3.5 h-3.5" />
            {label}
            {count > 0 && <span className="text-xs opacity-60">({count})</span>}
          </button>
        ))}
      </div>

      {tab === "keys" ? (
        <KeysPanel
          keys={keys}
          loading={loading}
          onRevoke={revokeKey}
          onCreate={() => setShowCreate(true)}
        />
      ) : (
        <WebhooksPanel
          endpoints={endpoints}
          loading={loading}
          onToggle={toggleEndpoint}
          onDelete={deleteEndpoint}
          onCreate={() => setShowWebhookCreate(true)}
        />
      )}

      {showCreate && (
        <CreateKeyModal
          scopes={scopes}
          onClose={() => setShowCreate(false)}
          onCreated={(k) => { setNewKey(k); setShowCreate(false); load(); }}
        />
      )}
      {newKey && <ShowKeyOnceModal data={newKey} onClose={() => setNewKey(null)} />}

      {showWebhookCreate && (
        <CreateWebhookModal
          supportedEvents={supportedEvents}
          onClose={() => setShowWebhookCreate(false)}
          onCreated={(s, url) => { setNewSecret({ secret: s, url }); setShowWebhookCreate(false); load(); }}
        />
      )}
      {newSecret && <ShowSecretOnceModal data={newSecret} onClose={() => setNewSecret(null)} />}
    </div>
  );
}

// ── Keys Panel ────────────────────────────────────────────────────────────
function KeysPanel({ keys, loading, onRevoke, onCreate }: {
  keys: ApiKey[]; loading: boolean; onRevoke: (id: string) => void; onCreate: () => void;
}) {
  if (loading) return <div className="py-12 text-center"><Loader2 className="w-6 h-6 animate-spin text-primary mx-auto" /></div>;

  return (
    <>
      <div className="flex items-center justify-between mb-3">
        <p className="text-sm text-muted-foreground">
          Use API keys to authenticate programmatic requests. Each key has a fixed set of scopes.
        </p>
        <button
          onClick={onCreate}
          className="flex items-center gap-2 wa-gradient text-white text-sm font-semibold px-4 py-2 rounded-xl hover:opacity-90"
        >
          <Plus className="w-4 h-4" /> New Key
        </button>
      </div>

      {keys.length === 0 ? (
        <EmptyState
          icon={Key}
          title="No API keys yet"
          description="Create your first key to start sending messages programmatically"
          action={<button onClick={onCreate} className="wa-gradient text-white px-4 py-2 rounded-xl text-sm font-semibold">Create Key</button>}
        />
      ) : (
        <div className="bg-card border border-border/50 rounded-2xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/30">
              <tr className="text-xs text-muted-foreground border-b border-border/40">
                <th className="text-left px-4 py-3 font-medium">Name</th>
                <th className="text-left px-4 py-3 font-medium">Key</th>
                <th className="text-left px-4 py-3 font-medium">Env</th>
                <th className="text-left px-4 py-3 font-medium">Scopes</th>
                <th className="text-right px-4 py-3 font-medium">Requests</th>
                <th className="text-left px-4 py-3 font-medium">Last used</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {keys.map((k) => (
                <tr key={k.id} className={`border-b border-border/20 last:border-0 ${!k.is_active ? "opacity-50" : ""}`}>
                  <td className="px-4 py-3">
                    <p className="font-medium">{k.name}</p>
                    <p className="text-[10px] text-muted-foreground">created {new Date(k.created_at).toLocaleDateString()}</p>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs">{k.prefix}…</td>
                  <td className="px-4 py-3">
                    <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${
                      k.environment === "live" ? "bg-emerald-500/10 text-emerald-400" : "bg-amber-500/10 text-amber-400"
                    }`}>
                      {k.environment.toUpperCase()}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1">
                      {(k.scopes || []).slice(0, 3).map((s) => (
                        <span key={s} className="text-[10px] bg-muted/40 px-1.5 py-0.5 rounded font-mono">{s}</span>
                      ))}
                      {(k.scopes || []).length > 3 && (
                        <span className="text-[10px] text-muted-foreground">+{(k.scopes || []).length - 3}</span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">{(k.request_count || 0).toLocaleString()}</td>
                  <td className="px-4 py-3 text-[11px] text-muted-foreground">
                    {k.last_used_at ? new Date(k.last_used_at).toLocaleString() : "Never"}
                  </td>
                  <td className="px-4 py-3">
                    {k.is_active ? (
                      <button onClick={() => onRevoke(k.id)} className="p-1.5 rounded-lg text-muted-foreground hover:text-red-400 hover:bg-red-500/10">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    ) : (
                      <span className="text-[10px] text-muted-foreground">Revoked</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

// ── Webhooks Panel ────────────────────────────────────────────────────────
function WebhooksPanel({ endpoints, loading, onToggle, onDelete, onCreate }: {
  endpoints: WebhookEndpoint[]; loading: boolean;
  onToggle: (ep: WebhookEndpoint) => void; onDelete: (id: string) => void; onCreate: () => void;
}) {
  if (loading) return <div className="py-12 text-center"><Loader2 className="w-6 h-6 animate-spin text-primary mx-auto" /></div>;

  return (
    <>
      <div className="flex items-center justify-between mb-3">
        <p className="text-sm text-muted-foreground">
          We POST signed events to your endpoints. Verify <code className="bg-muted/40 px-1 rounded">X-WASend-Signature</code> with the signing secret.
        </p>
        <button
          onClick={onCreate}
          className="flex items-center gap-2 wa-gradient text-white text-sm font-semibold px-4 py-2 rounded-xl hover:opacity-90"
        >
          <Plus className="w-4 h-4" /> Add Endpoint
        </button>
      </div>

      {endpoints.length === 0 ? (
        <EmptyState
          icon={Webhook}
          title="No webhook endpoints"
          description="Get notified in real time when messages are delivered, read, or replied to"
          action={<button onClick={onCreate} className="wa-gradient text-white px-4 py-2 rounded-xl text-sm font-semibold">Add Endpoint</button>}
        />
      ) : (
        <div className="space-y-3">
          {endpoints.map((ep) => (
            <div key={ep.id} className="bg-card border border-border/50 rounded-2xl p-4">
              <div className="flex items-start justify-between gap-3 mb-3">
                <div className="flex items-start gap-3 min-w-0 flex-1">
                  <div className={`w-9 h-9 rounded-lg flex-shrink-0 flex items-center justify-center ${
                    ep.status === "active" ? "bg-emerald-500/10" : ep.status === "paused" ? "bg-amber-500/10" : "bg-red-500/10"
                  }`}>
                    <Webhook className={`w-4 h-4 ${
                      ep.status === "active" ? "text-emerald-400" : ep.status === "paused" ? "text-amber-400" : "text-red-400"
                    }`} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold truncate">{ep.name || ep.url}</p>
                    <p className="text-[11px] text-muted-foreground font-mono truncate">{ep.url}</p>
                  </div>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
                    ep.status === "active" ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20" :
                    ep.status === "paused" ? "bg-amber-500/10 text-amber-400 border border-amber-500/20" :
                                              "bg-red-500/10 text-red-400 border border-red-500/20"
                  }`}>
                    {ep.status}
                  </span>
                  <button onClick={() => onToggle(ep)} className="p-1.5 rounded-lg hover:bg-muted/50 text-muted-foreground hover:text-foreground">
                    {ep.status === "paused" ? <Play className="w-3.5 h-3.5" /> : <Pause className="w-3.5 h-3.5" />}
                  </button>
                  <button onClick={() => onDelete(ep.id)} className="p-1.5 rounded-lg hover:bg-red-500/10 text-muted-foreground hover:text-red-400">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
              <div className="flex flex-wrap gap-1 mb-3">
                {ep.events.map((e) => (
                  <span key={e} className="text-[10px] bg-muted/40 px-1.5 py-0.5 rounded font-mono">{e}</span>
                ))}
              </div>
              <div className="flex items-center gap-4 text-[11px] text-muted-foreground">
                <span className="flex items-center gap-1"><Activity className="w-3 h-3" /> {ep.total_deliveries} delivered</span>
                <span>Last: {ep.last_delivery_at ? new Date(ep.last_delivery_at).toLocaleString() : "Never"}</span>
                {ep.failure_count > 0 && (
                  <span className="text-red-400">⚠ {ep.failure_count} consecutive failures</span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

// ── Create Key Modal ──────────────────────────────────────────────────────
function CreateKeyModal({ scopes, onClose, onCreated }: {
  scopes: AvailableScope[];
  onClose: () => void;
  onCreated: (k: { full_key: string; name: string; prefix: string }) => void;
}) {
  const [name, setName] = useState("");
  const [environment, setEnvironment] = useState<"live" | "test">("live");
  const [selectedScopes, setSelectedScopes] = useState<string[]>(["messages:write", "contacts:read"]);
  const [rateLimit, setRateLimit] = useState(60);
  const [submitting, setSubmitting] = useState(false);

  const toggleScope = (s: string) => {
    setSelectedScopes((prev) => prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]);
  };

  const submit = async () => {
    if (!name.trim()) { toast.error("Name required"); return; }
    if (selectedScopes.length === 0) { toast.error("Select at least one scope"); return; }
    setSubmitting(true);
    try {
      const res = await fetch("/api/api-keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, environment, scopes: selectedScopes, rate_limit_per_min: rateLimit }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      onCreated(data.key);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Create failed");
    } finally {
      setSubmitting(false);
    }
  };

  // Group scopes
  const grouped: Record<string, AvailableScope[]> = {};
  for (const s of scopes) {
    if (!grouped[s.group]) grouped[s.group] = [];
    grouped[s.group].push(s);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="bg-card border border-border rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b border-border sticky top-0 bg-card z-10">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl wa-gradient flex items-center justify-center"><Key className="w-4 h-4 text-white" /></div>
            <div>
              <h3 className="font-semibold">Create API Key</h3>
              <p className="text-xs text-muted-foreground">Generate a key for programmatic access</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-muted/50"><X className="w-4 h-4" /></button>
        </div>
        <div className="p-5 space-y-4">
          <div>
            <label className="text-sm font-medium block mb-1.5">Key name *</label>
            <input value={name} onChange={(e) => setName(e.target.value)}
              placeholder="Production webhook receiver"
              className="w-full bg-muted/50 border border-border rounded-xl px-3 py-2 text-sm outline-none focus:border-primary/60" />
          </div>

          <div>
            <label className="text-sm font-medium block mb-2">Environment</label>
            <div className="grid grid-cols-2 gap-2">
              {(["live", "test"] as const).map((env) => (
                <button
                  key={env}
                  onClick={() => setEnvironment(env)}
                  className={`p-3 rounded-xl border text-left transition-all ${
                    environment === env ? "border-primary bg-primary/5" : "border-border hover:bg-muted/30"
                  }`}
                >
                  <p className="text-sm font-semibold">{env === "live" ? "🟢 Live" : "🟡 Test"}</p>
                  <p className="text-[10px] text-muted-foreground">{env === "live" ? "Real messages, billed" : "Sandbox, no charges"}</p>
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="text-sm font-medium block mb-2">Scopes</label>
            <div className="space-y-3">
              {Object.entries(grouped).map(([group, items]) => (
                <div key={group}>
                  <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1.5">{group}</p>
                  <div className="space-y-1">
                    {items.map((s) => (
                      <label key={s.key} className="flex items-center gap-2 p-2 rounded-lg hover:bg-muted/30 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={selectedScopes.includes(s.key)}
                          onChange={() => toggleScope(s.key)}
                          className="rounded"
                        />
                        <span className="text-xs font-mono">{s.key}</span>
                        <span className="text-[11px] text-muted-foreground ml-auto">{s.label}</span>
                      </label>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div>
            <label className="text-sm font-medium block mb-1.5">Rate limit (requests/min)</label>
            <input type="number" value={rateLimit} min={1} max={1000}
              onChange={(e) => setRateLimit(Number(e.target.value))}
              className="w-full bg-muted/50 border border-border rounded-xl px-3 py-2 text-sm outline-none focus:border-primary/60" />
          </div>
        </div>
        <div className="flex justify-end gap-2 p-5 border-t border-border sticky bottom-0 bg-card">
          <button onClick={onClose} className="px-4 py-2 rounded-xl border border-border hover:bg-accent text-sm font-medium">Cancel</button>
          <button onClick={submit} disabled={submitting}
            className="flex items-center gap-2 wa-gradient text-white font-semibold px-5 py-2 rounded-xl hover:opacity-90 disabled:opacity-40">
            {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
            {submitting ? "Creating…" : "Create Key"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Show Key Once Modal ──────────────────────────────────────────────────
function ShowKeyOnceModal({ data, onClose }: {
  data: { full_key: string; name: string; prefix: string }; onClose: () => void;
}) {
  const [reveal, setReveal] = useState(false);
  const [copied, setCopied] = useState(false);

  const copy = () => {
    navigator.clipboard.writeText(data.full_key);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="bg-card border border-border rounded-2xl shadow-2xl w-full max-w-xl">
        <div className="p-5 border-b border-border">
          <div className="flex items-center gap-3 mb-1">
            <div className="w-10 h-10 rounded-xl bg-amber-500/10 flex items-center justify-center">
              <AlertCircle className="w-5 h-5 text-amber-400" />
            </div>
            <div>
              <h3 className="font-semibold">Save this key now</h3>
              <p className="text-xs text-muted-foreground">{data.name} — won&apos;t be shown again</p>
            </div>
          </div>
        </div>
        <div className="p-5 space-y-4">
          <div className="bg-muted/30 border border-border/50 rounded-xl p-3 font-mono text-xs break-all flex items-center gap-2">
            <span className="flex-1">{reveal ? data.full_key : data.full_key.replace(/(?<=^.{20}).+/, "•".repeat(40))}</span>
            <button onClick={() => setReveal(!reveal)} className="p-1.5 rounded-lg hover:bg-muted/50">
              {reveal ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
            </button>
            <button onClick={copy} className="p-1.5 rounded-lg hover:bg-muted/50">
              {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
            </button>
          </div>
          <div className="bg-blue-500/5 border border-blue-500/20 rounded-xl p-3 text-xs text-muted-foreground space-y-1.5">
            <p className="font-semibold text-foreground">How to use</p>
            <pre className="bg-muted/30 rounded-lg p-2 overflow-x-auto"><code>{`curl https://your-domain.com/api/v1/messages \\
  -H "Authorization: Bearer ${reveal ? data.full_key : data.prefix + "…"}" \\
  -H "Content-Type: application/json" \\
  -d '{"to":"+919876543210","type":"text","text":"Hi!"}'`}</code></pre>
          </div>
        </div>
        <div className="p-5 border-t border-border flex justify-end">
          <button onClick={onClose} className="wa-gradient text-white px-5 py-2 rounded-xl text-sm font-semibold">
            I&apos;ve saved my key
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Create Webhook Modal ──────────────────────────────────────────────────
function CreateWebhookModal({ supportedEvents, onClose, onCreated }: {
  supportedEvents: string[];
  onClose: () => void;
  onCreated: (secret: string, url: string) => void;
}) {
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [selected, setSelected] = useState<string[]>(supportedEvents);
  const [submitting, setSubmitting] = useState(false);

  const toggle = (e: string) => setSelected((p) => p.includes(e) ? p.filter((x) => x !== e) : [...p, e]);

  const submit = async () => {
    if (!url.trim()) { toast.error("URL required"); return; }
    setSubmitting(true);
    try {
      const res = await fetch("/api/webhook-endpoints", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name || null, url, events: selected }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      onCreated(data.endpoint.signing_secret, data.endpoint.url);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="bg-card border border-border rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b border-border sticky top-0 bg-card z-10">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl wa-gradient flex items-center justify-center"><Webhook className="w-4 h-4 text-white" /></div>
            <div>
              <h3 className="font-semibold">Add Webhook Endpoint</h3>
              <p className="text-xs text-muted-foreground">Receive event notifications via HTTP POST</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-muted/50"><X className="w-4 h-4" /></button>
        </div>
        <div className="p-5 space-y-4">
          <div>
            <label className="text-sm font-medium block mb-1.5">Endpoint URL *</label>
            <input value={url} onChange={(e) => setUrl(e.target.value)}
              placeholder="https://api.yourdomain.com/wasend/events"
              className="w-full bg-muted/50 border border-border rounded-xl px-3 py-2 text-sm outline-none focus:border-primary/60" />
          </div>
          <div>
            <label className="text-sm font-medium block mb-1.5">Description <span className="text-muted-foreground font-normal">(optional)</span></label>
            <input value={name} onChange={(e) => setName(e.target.value)}
              placeholder="Production CRM sync"
              className="w-full bg-muted/50 border border-border rounded-xl px-3 py-2 text-sm outline-none focus:border-primary/60" />
          </div>
          <div>
            <label className="text-sm font-medium block mb-2">Events to subscribe</label>
            <div className="space-y-1">
              {supportedEvents.map((ev) => (
                <label key={ev} className="flex items-center gap-2 p-2 rounded-lg hover:bg-muted/30 cursor-pointer">
                  <input type="checkbox" checked={selected.includes(ev)} onChange={() => toggle(ev)} className="rounded" />
                  <span className="text-xs font-mono">{ev}</span>
                </label>
              ))}
            </div>
          </div>
        </div>
        <div className="flex justify-end gap-2 p-5 border-t border-border sticky bottom-0 bg-card">
          <button onClick={onClose} className="px-4 py-2 rounded-xl border border-border hover:bg-accent text-sm font-medium">Cancel</button>
          <button onClick={submit} disabled={submitting}
            className="flex items-center gap-2 wa-gradient text-white font-semibold px-5 py-2 rounded-xl hover:opacity-90 disabled:opacity-40">
            {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
            {submitting ? "Creating…" : "Add Endpoint"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Show Webhook Secret Once ──────────────────────────────────────────────
function ShowSecretOnceModal({ data, onClose }: { data: { secret: string; url: string }; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const copy = () => { navigator.clipboard.writeText(data.secret); setCopied(true); setTimeout(() => setCopied(false), 2000); };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="bg-card border border-border rounded-2xl shadow-2xl w-full max-w-xl">
        <div className="p-5 border-b border-border">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-500/10 flex items-center justify-center"><AlertCircle className="w-5 h-5 text-amber-400" /></div>
            <div>
              <h3 className="font-semibold">Signing secret — save now</h3>
              <p className="text-xs text-muted-foreground">{data.url} — won&apos;t be shown again</p>
            </div>
          </div>
        </div>
        <div className="p-5 space-y-4">
          <div className="bg-muted/30 border border-border/50 rounded-xl p-3 font-mono text-xs break-all flex items-center gap-2">
            <span className="flex-1">{data.secret}</span>
            <button onClick={copy} className="p-1.5 rounded-lg hover:bg-muted/50">
              {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
            </button>
          </div>
          <p className="text-xs text-muted-foreground">
            Verify the <code className="bg-muted/40 px-1 rounded font-mono">X-WASend-Signature</code> header on every request to prove the
            event came from us. See <Link href="/settings/api/docs" className="text-primary hover:underline inline-flex items-center gap-0.5">webhook signing docs <ExternalLink className="w-3 h-3" /></Link>.
          </p>
        </div>
        <div className="p-5 border-t border-border flex justify-end">
          <button onClick={onClose} className="wa-gradient text-white px-5 py-2 rounded-xl text-sm font-semibold">Got it</button>
        </div>
      </div>
    </div>
  );
}
