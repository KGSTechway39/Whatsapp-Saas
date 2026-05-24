"use client";

import { useState, useEffect } from "react";
import { Key, Plus, Trash2, Copy, Check, Eye, EyeOff, AlertTriangle, Code2, Loader2, Shield } from "lucide-react";
import { toast } from "sonner";
import { Skeleton } from "@/components/shared/Skeleton";

interface ApiKey {
  id: string; name: string; prefix: string; scopes: string[];
  last_used_at: string | null; created_at: string; is_active: boolean;
  rawKey?: string;
}

const ALL_SCOPES = [
  { id: "messages:send",    label: "Send Messages",    desc: "Send WhatsApp messages to contacts" },
  { id: "contacts:read",    label: "Read Contacts",    desc: "List and search contacts" },
  { id: "contacts:write",   label: "Write Contacts",   desc: "Create and update contacts" },
  { id: "templates:read",   label: "Read Templates",   desc: "List approved templates" },
  { id: "campaigns:read",   label: "Read Campaigns",   desc: "Get campaign stats" },
  { id: "webhooks:receive", label: "Receive Webhooks", desc: "Get event notifications" },
];

export default function ApiKeysPage() {
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [newKey, setNewKey] = useState<ApiKey | null>(null);
  const [showRaw, setShowRaw] = useState(false);
  const [copied, setCopied] = useState(false);
  const [form, setForm] = useState({ name: "", scopes: ["messages:send", "contacts:read"] });

  useEffect(() => {
    fetch("/api/api-keys")
      .then((r) => r.json())
      .then((d) => setKeys(d.keys ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const create = async () => {
    if (!form.name.trim()) { toast.error("Key name required"); return; }
    setCreating(true);
    try {
      const res = await fetch("/api/api-keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setNewKey(data.key);
      setKeys((prev) => [{ ...data.key, is_active: true }, ...prev]);
      setShowCreate(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create key");
    } finally {
      setCreating(false);
    }
  };

  const revoke = async (id: string) => {
    if (!confirm("Revoke this API key? Any apps using it will stop working.")) return;
    await fetch(`/api/api-keys/${id}`, { method: "DELETE" });
    setKeys((prev) => prev.filter((k) => k.id !== id));
    toast.success("Key revoked");
  };

  const copyKey = () => {
    if (newKey?.rawKey) {
      navigator.clipboard.writeText(newKey.rawKey);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      toast.success("Copied to clipboard");
    }
  };

  const toggleScope = (s: string) => {
    setForm((p) => ({
      ...p,
      scopes: p.scopes.includes(s) ? p.scopes.filter((x) => x !== s) : [...p.scopes, s],
    }));
  };

  return (
    <div className="max-w-4xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Key className="w-6 h-6 text-primary" />
            API Keys
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Manage API keys for programmatic access to WASend
          </p>
        </div>
        <div className="flex gap-2">
          <a href="/docs/api" className="flex items-center gap-2 px-4 py-2.5 rounded-xl border border-border text-sm font-medium hover:bg-accent transition-colors">
            <Code2 className="w-4 h-4" />
            API Docs
          </a>
          <button
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-2 wa-gradient text-white text-sm font-semibold px-4 py-2.5 rounded-xl hover:opacity-90 transition-all"
          >
            <Plus className="w-4 h-4" />
            New Key
          </button>
        </div>
      </div>

      {/* New key revealed */}
      {newKey && (
        <div className="bg-emerald-500/5 border border-emerald-500/30 rounded-2xl p-5">
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-xl bg-emerald-500/10 flex items-center justify-center flex-shrink-0">
              <Shield className="w-4.5 h-4.5 text-emerald-400" />
            </div>
            <div className="flex-1">
              <p className="font-semibold text-emerald-400">Key created — save it now!</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                This key will never be shown again. Copy it to a secure location.
              </p>
              <div className="mt-3 flex items-center gap-2">
                <code className={`flex-1 bg-black/40 border border-white/10 rounded-xl px-3 py-2 text-xs font-mono text-emerald-300 ${!showRaw ? "blur-[3px] select-none" : ""}`}>
                  {newKey.rawKey}
                </code>
                <button onClick={() => setShowRaw(!showRaw)} className="p-2 rounded-lg bg-white/5 hover:bg-white/10 transition-colors flex-shrink-0">
                  {showRaw ? <EyeOff className="w-4 h-4 text-muted-foreground" /> : <Eye className="w-4 h-4 text-muted-foreground" />}
                </button>
                <button onClick={copyKey} className="p-2 rounded-lg bg-emerald-500/20 hover:bg-emerald-500/30 transition-colors flex-shrink-0">
                  {copied ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4 text-emerald-400" />}
                </button>
              </div>
            </div>
          </div>
          <button onClick={() => setNewKey(null)} className="mt-3 text-xs text-muted-foreground hover:text-foreground">
            I've saved it, dismiss
          </button>
        </div>
      )}

      {/* Keys list */}
      <div className="bg-card rounded-2xl border border-border/50 overflow-hidden">
        <div className="p-4 border-b border-border/50">
          <h3 className="font-semibold text-sm">Active Keys ({keys.filter((k) => k.is_active).length}/5)</h3>
        </div>
        {loading ? (
          <div className="p-4 space-y-3">
            {Array.from({ length: 2 }).map((_, i) => <Skeleton key={i} className="h-16 rounded-xl" />)}
          </div>
        ) : keys.length === 0 ? (
          <div className="py-12 text-center text-sm text-muted-foreground">
            No API keys yet. Create one to start integrating.
          </div>
        ) : (
          <div className="divide-y divide-border/50">
            {keys.map((k) => (
              <div key={k.id} className="p-4 flex items-center gap-4 hover:bg-muted/20 transition-colors">
                <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
                  <Key className="w-4 h-4 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold">{k.name}</p>
                  <p className="text-xs text-muted-foreground font-mono mt-0.5">{k.prefix}…</p>
                  <div className="flex flex-wrap gap-1 mt-1.5">
                    {k.scopes.map((s) => (
                      <span key={s} className="text-[10px] bg-muted/50 px-1.5 py-0.5 rounded text-muted-foreground">{s}</span>
                    ))}
                  </div>
                </div>
                <div className="text-right flex-shrink-0">
                  <p className="text-xs text-muted-foreground">
                    {k.last_used_at ? `Used ${new Date(k.last_used_at).toLocaleDateString()}` : "Never used"}
                  </p>
                  <p className="text-[10px] text-muted-foreground/60 mt-0.5">
                    Created {new Date(k.created_at).toLocaleDateString()}
                  </p>
                </div>
                <button
                  onClick={() => revoke(k.id)}
                  className="p-2 rounded-lg hover:bg-red-500/10 transition-colors flex-shrink-0"
                >
                  <Trash2 className="w-4 h-4 text-red-400" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Usage example */}
      <div className="bg-card rounded-2xl border border-border/50 p-5">
        <h3 className="font-semibold text-sm mb-3 flex items-center gap-2">
          <Code2 className="w-4 h-4 text-primary" /> Quick Start
        </h3>
        <pre className="bg-[#0d1117] rounded-xl p-4 text-xs text-green-400 overflow-x-auto">
{`# Send a WhatsApp message via REST API
curl -X POST https://wasend.app/api/v1/messages/send \\
  -H "Authorization: Bearer wsk_live_YOUR_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "to": "+919876543210",
    "templateName": "order_confirmation",
    "variables": ["John", "ORD-1234", "₹599"]
  }'`}
        </pre>
        <a href="/docs/api" className="text-xs text-primary hover:underline mt-3 inline-block">
          View full API documentation →
        </a>
      </div>

      {/* Create modal */}
      {showCreate && (
        <>
          <div className="fixed inset-0 bg-black/60 z-40" onClick={() => setShowCreate(false)} />
          <div className="fixed inset-0 flex items-center justify-center z-50 p-4">
            <div className="bg-card border border-border rounded-2xl w-full max-w-md shadow-2xl">
              <div className="p-5 border-b border-border">
                <h3 className="font-semibold">Create API Key</h3>
                <p className="text-xs text-muted-foreground mt-0.5">Choose a name and permissions for this key</p>
              </div>
              <div className="p-5 space-y-4">
                <div>
                  <label className="text-sm font-medium block mb-1.5">Key Name *</label>
                  <input
                    value={form.name}
                    onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
                    placeholder="e.g. Production App, Shopify Integration"
                    className="w-full bg-muted/50 border border-border rounded-xl px-4 py-2.5 text-sm outline-none focus:border-primary/60"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium block mb-2">Permissions</label>
                  <div className="space-y-2">
                    {ALL_SCOPES.map((s) => (
                      <label key={s.id} className="flex items-start gap-3 p-3 rounded-xl hover:bg-muted/30 cursor-pointer transition-colors">
                        <input
                          type="checkbox"
                          checked={form.scopes.includes(s.id)}
                          onChange={() => toggleScope(s.id)}
                          className="mt-0.5 accent-primary"
                        />
                        <div>
                          <p className="text-sm font-medium">{s.label}</p>
                          <p className="text-xs text-muted-foreground">{s.desc}</p>
                        </div>
                      </label>
                    ))}
                  </div>
                </div>
                <div className="flex items-start gap-2 p-3 bg-amber-500/5 border border-amber-500/20 rounded-xl">
                  <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
                  <p className="text-xs text-amber-400">The key will be shown only once. Store it securely.</p>
                </div>
              </div>
              <div className="p-5 border-t border-border flex gap-2">
                <button onClick={() => setShowCreate(false)} className="flex-1 px-4 py-2.5 rounded-xl border border-border text-sm font-medium hover:bg-muted/40">Cancel</button>
                <button
                  onClick={create}
                  disabled={creating || !form.name.trim() || form.scopes.length === 0}
                  className="flex-1 flex items-center justify-center gap-2 wa-gradient text-white text-sm font-semibold py-2.5 rounded-xl hover:opacity-90 disabled:opacity-40"
                >
                  {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Key className="w-4 h-4" />}
                  Create Key
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
