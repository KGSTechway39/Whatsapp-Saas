"use client";

import { PageHeader } from "@/components/shared/PageHeader";
import {
  Book, Send, Users, MessageSquare, Megaphone, Webhook, Key, Shield,
  Copy, Check, Play, Loader2, ChevronRight,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

type Lang = "curl" | "node" | "python";

interface EndpointDoc {
  id: string;
  method: "GET" | "POST" | "PATCH" | "DELETE";
  path: string;
  title: string;
  description: string;
  scope: string;
  params?: { name: string; required?: boolean; type: string; desc: string }[];
  example_body?: object;
  example_response: object;
}

const SECTIONS = [
  { id: "intro",         label: "Introduction",      icon: Book },
  { id: "auth",          label: "Authentication",    icon: Key },
  { id: "errors",        label: "Errors",            icon: Shield },
  { id: "messages",      label: "Messages",          icon: Send },
  { id: "contacts",      label: "Contacts",          icon: Users },
  { id: "templates",     label: "Templates",         icon: MessageSquare },
  { id: "webhooks",      label: "Webhooks",          icon: Webhook },
];

const ENDPOINTS: EndpointDoc[] = [
  {
    id: "send_message",
    method: "POST",
    path: "/api/v1/messages",
    title: "Send a message",
    description: "Send a template or text message to a single recipient. Creates a contact if one doesn't already exist.",
    scope: "messages:write",
    params: [
      { name: "to",       required: true,  type: "string",  desc: "Recipient phone number in E.164 format" },
      { name: "type",     required: true,  type: "string",  desc: "'template' or 'text'" },
      { name: "from",     required: false, type: "string",  desc: "WhatsApp number ID (defaults to primary)" },
      { name: "template", required: false, type: "object",  desc: "{ name, language, variables[] } when type=template" },
      { name: "text",     required: false, type: "string",  desc: "Message body when type=text" },
    ],
    example_body: { to: "+919876543210", type: "template", template: { name: "order_confirmation", language: "en", variables: ["Rahul", "ORD-1234"] } },
    example_response: { id: "msg_abc123", object: "message", to: "+919876543210", from: "wa_xyz", type: "template", status: "pending", created_at: "2026-05-08T10:30:00Z" },
  },
  {
    id: "list_messages",
    method: "GET",
    path: "/api/v1/messages",
    title: "List messages",
    description: "Returns up to 100 most recent messages, optionally filtered by status.",
    scope: "messages:read",
    params: [
      { name: "limit",  required: false, type: "integer", desc: "1–100, default 20" },
      { name: "status", required: false, type: "string",  desc: "pending | sent | delivered | read | failed" },
    ],
    example_response: { data: [{ id: "msg_abc", object: "message", to: "+91...", status: "delivered", delivered_at: "2026-05-08T10:31:00Z" }], has_more: false },
  },
  {
    id: "get_message",
    method: "GET",
    path: "/api/v1/messages/{id}",
    title: "Retrieve a message",
    description: "Get the latest delivery status for a specific message.",
    scope: "messages:read",
    example_response: { id: "msg_abc", object: "message", to: "+91...", status: "read", delivered_at: "...", read_at: "..." },
  },
  {
    id: "list_contacts",
    method: "GET",
    path: "/api/v1/contacts",
    title: "List contacts",
    description: "Cursor-paginated list of contacts. Use `next_cursor` from the response as `starting_after` to fetch the next page.",
    scope: "contacts:read",
    params: [
      { name: "limit",          required: false, type: "integer", desc: "1–100, default 20" },
      { name: "search",         required: false, type: "string",  desc: "Match name, phone, or email" },
      { name: "starting_after", required: false, type: "string",  desc: "Cursor (contact id) for pagination" },
    ],
    example_response: { data: [{ id: "ct_abc", object: "contact", name: "Rahul Kumar", phone: "+91...", tags: ["vip"] }], has_more: true, next_cursor: "ct_xyz" },
  },
  {
    id: "create_contact",
    method: "POST",
    path: "/api/v1/contacts",
    title: "Create a contact",
    description: "Create a new contact. Returns 409 if a contact with the same phone already exists.",
    scope: "contacts:write",
    params: [
      { name: "name",      required: true,  type: "string", desc: "Display name" },
      { name: "phone",     required: true,  type: "string", desc: "E.164 phone" },
      { name: "email",     required: false, type: "string", desc: "Email address" },
      { name: "tags",      required: false, type: "array",  desc: "Array of tag strings" },
      { name: "company",   required: false, type: "string", desc: "Company name" },
      { name: "crm_stage", required: false, type: "string", desc: "new_lead | contacted | qualified | interested | converted" },
    ],
    example_body: { name: "Rahul Kumar", phone: "+919876543210", tags: ["vip"], company: "Acme Pvt Ltd" },
    example_response: { id: "ct_abc", object: "contact", name: "Rahul Kumar", phone: "+919876543210", tags: ["vip"], crm_stage: "new_lead", created_at: "..." },
  },
  {
    id: "update_contact",
    method: "PATCH",
    path: "/api/v1/contacts/{id}",
    title: "Update a contact",
    description: "Partially update a contact. Only provided fields are changed.",
    scope: "contacts:write",
    example_body: { tags: ["vip", "loyalty"], crm_stage: "qualified", deal_value: 25000 },
    example_response: { id: "ct_abc", object: "contact", crm_stage: "qualified", deal_value: 25000 },
  },
  {
    id: "list_templates",
    method: "GET",
    path: "/api/v1/templates",
    title: "List templates",
    description: "Returns your synced WhatsApp Business templates.",
    scope: "templates:read",
    params: [{ name: "status", required: false, type: "string", desc: "APPROVED | PENDING | REJECTED" }],
    example_response: { data: [{ id: "tmpl_abc", object: "template", name: "order_confirmation", category: "UTILITY", language: "en", status: "APPROVED" }] },
  },
];

const WEBHOOK_EVENTS = [
  { event: "message.sent",       desc: "A message was queued and accepted by Meta" },
  { event: "message.delivered",  desc: "Meta confirmed delivery to the recipient device" },
  { event: "message.read",       desc: "The recipient opened the message" },
  { event: "message.failed",     desc: "Delivery failed (recipient blocked, expired, etc.)" },
  { event: "message.received",   desc: "An inbound message from a customer" },
  { event: "contact.created",    desc: "A new contact was added" },
  { event: "contact.updated",    desc: "An existing contact's fields changed" },
  { event: "campaign.completed", desc: "A bulk campaign finished sending" },
];

export default function ApiDocsPage() {
  const [active, setActive] = useState<string>("intro");
  const [activeEndpoint, setActiveEndpoint] = useState<string | null>(null);
  const [lang, setLang] = useState<Lang>("curl");
  const [tryKey, setTryKey] = useState("");

  const scrollToSection = (id: string) => {
    setActive(id);
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <div className="max-w-7xl">
      <PageHeader
        title="API Documentation"
        subtitle="Complete reference for the WASend public API"
      />

      <div className="grid grid-cols-12 gap-6">
        {/* Sidebar */}
        <aside className="col-span-3 sticky top-20 self-start">
          <div className="bg-card border border-border/50 rounded-2xl p-3">
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground px-2 py-1.5">Reference</p>
            <nav className="space-y-0.5">
              {SECTIONS.map((s) => (
                <button
                  key={s.id}
                  onClick={() => scrollToSection(s.id)}
                  className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-sm transition-all ${
                    active === s.id ? "bg-primary/10 text-primary font-semibold" : "text-muted-foreground hover:bg-muted/40 hover:text-foreground"
                  }`}
                >
                  <s.icon className="w-3.5 h-3.5" />
                  {s.label}
                </button>
              ))}
            </nav>

            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground px-2 py-1.5 mt-3">Endpoints</p>
            <nav className="space-y-0.5">
              {ENDPOINTS.map((e) => (
                <button
                  key={e.id}
                  onClick={() => { setActiveEndpoint(e.id); document.getElementById(e.id)?.scrollIntoView({ behavior: "smooth" }); }}
                  className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs text-left transition-all ${
                    activeEndpoint === e.id ? "bg-muted/50 text-foreground font-semibold" : "text-muted-foreground hover:bg-muted/40 hover:text-foreground"
                  }`}
                >
                  <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${methodColor(e.method)}`}>{e.method}</span>
                  <span className="truncate">{e.title}</span>
                </button>
              ))}
            </nav>
          </div>
        </aside>

        {/* Content */}
        <main className="col-span-9 space-y-12 pb-20">
          {/* Intro */}
          <section id="intro" className="space-y-3">
            <h2 className="text-2xl font-bold">Introduction</h2>
            <p className="text-sm text-muted-foreground leading-relaxed">
              The WASend API is a JSON-over-HTTPS interface for sending WhatsApp messages, managing contacts,
              and receiving real-time events. All requests are authenticated with an API key (Bearer token).
            </p>
            <div className="bg-card border border-border/50 rounded-2xl p-4">
              <p className="text-xs text-muted-foreground mb-1">Base URL</p>
              <code className="text-sm font-mono">https://your-domain.com/api/v1</code>
            </div>
            <p className="text-sm text-muted-foreground">
              Need a key? <a href="/settings/api" className="text-primary hover:underline">Create one</a>.
              All endpoints return JSON. All timestamps are ISO 8601 UTC. Phone numbers must be E.164 (e.g.{" "}
              <code className="bg-muted/40 px-1 rounded text-xs">+919876543210</code>).
            </p>
          </section>

          {/* Auth */}
          <section id="auth" className="space-y-3">
            <h2 className="text-2xl font-bold">Authentication</h2>
            <p className="text-sm text-muted-foreground">
              Include your API key in the <code className="bg-muted/40 px-1 rounded text-xs">Authorization</code> header on every request:
            </p>
            <CodeBlock lang={lang} setLang={setLang} samples={{
              curl: `curl https://your-domain.com/api/v1/messages \\
  -H "Authorization: Bearer wsk_live_••••••••••••••••" \\
  -H "Content-Type: application/json"`,
              node: `const res = await fetch("https://your-domain.com/api/v1/messages", {
  headers: {
    Authorization: "Bearer wsk_live_••••••••••••••••",
    "Content-Type": "application/json",
  },
});`,
              python: `import requests
res = requests.get(
  "https://your-domain.com/api/v1/messages",
  headers={"Authorization": "Bearer wsk_live_••••••••••••••••"},
)`,
            }} />
            <div className="bg-amber-500/5 border border-amber-500/20 rounded-xl p-3 text-xs text-muted-foreground">
              <p className="font-semibold text-amber-400 mb-1">⚠ Never expose your key in client-side code</p>
              <p>Use <code className="bg-muted/40 px-1 rounded">test</code> environment keys for development; switch to <code className="bg-muted/40 px-1 rounded">live</code> in production. Test keys never charge your wallet.</p>
            </div>
          </section>

          {/* Errors */}
          <section id="errors" className="space-y-3">
            <h2 className="text-2xl font-bold">Errors</h2>
            <p className="text-sm text-muted-foreground">All errors return JSON with a stable <code className="bg-muted/40 px-1 rounded text-xs">code</code> field.</p>
            <div className="bg-card border border-border/50 rounded-2xl overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-muted/30 text-xs text-muted-foreground">
                  <tr><th className="text-left px-4 py-2 font-medium">Status</th><th className="text-left px-4 py-2 font-medium">Code</th><th className="text-left px-4 py-2 font-medium">Meaning</th></tr>
                </thead>
                <tbody>
                  {[
                    { s: 400, c: "VALIDATION_ERROR",  m: "Missing or invalid request fields" },
                    { s: 401, c: "INVALID_KEY",       m: "API key missing, malformed, or unknown" },
                    { s: 401, c: "KEY_REVOKED",       m: "Key was revoked by the user" },
                    { s: 401, c: "KEY_EXPIRED",       m: "Key passed its expiration date" },
                    { s: 403, c: "INSUFFICIENT_SCOPE",m: "Key lacks the scope required for this endpoint" },
                    { s: 404, c: "NOT_FOUND",         m: "Resource doesn't exist or doesn't belong to you" },
                    { s: 409, c: "DUPLICATE",         m: "Conflict — e.g. contact phone already exists" },
                    { s: 429, c: "RATE_LIMITED",      m: "Too many requests in the rolling 1-minute window" },
                    { s: 500, c: "INTERNAL",          m: "Unexpected server error — retry with backoff" },
                  ].map((r) => (
                    <tr key={r.c} className="border-t border-border/20">
                      <td className="px-4 py-2 font-mono text-xs">{r.s}</td>
                      <td className="px-4 py-2 font-mono text-xs">{r.c}</td>
                      <td className="px-4 py-2 text-xs text-muted-foreground">{r.m}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* Endpoint groups */}
          {(["messages", "contacts", "templates"] as const).map((group) => (
            <section key={group} id={group} className="space-y-4">
              <h2 className="text-2xl font-bold capitalize">{group}</h2>
              {ENDPOINTS.filter((e) => e.path.includes(`/v1/${group}`)).map((e) => (
                <EndpointCard key={e.id} endpoint={e} lang={lang} setLang={setLang} tryKey={tryKey} setTryKey={setTryKey} />
              ))}
            </section>
          ))}

          {/* Webhooks */}
          <section id="webhooks" className="space-y-3">
            <h2 className="text-2xl font-bold">Webhooks</h2>
            <p className="text-sm text-muted-foreground">
              We POST signed JSON events to your webhook URL when things happen. Configure endpoints at{" "}
              <a href="/settings/api" className="text-primary hover:underline">/settings/api</a>.
            </p>

            <h3 className="text-base font-semibold mt-4">Event types</h3>
            <div className="bg-card border border-border/50 rounded-2xl overflow-hidden">
              <table className="w-full text-sm">
                <tbody>
                  {WEBHOOK_EVENTS.map((e) => (
                    <tr key={e.event} className="border-b border-border/20 last:border-0">
                      <td className="px-4 py-2 font-mono text-xs w-1/3">{e.event}</td>
                      <td className="px-4 py-2 text-xs text-muted-foreground">{e.desc}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <h3 className="text-base font-semibold mt-4">Verifying signatures</h3>
            <p className="text-sm text-muted-foreground">
              Every request includes <code className="bg-muted/40 px-1 rounded text-xs">X-WASend-Signature: t={`{ts}`},v1={`{hmac}`}</code>.
              Compute <code className="bg-muted/40 px-1 rounded text-xs">HMAC-SHA256(secret, &quot;{`{ts}`}.{`{rawBody}`}&quot;)</code> and compare with constant-time equality.
            </p>
            <CodeBlock lang={lang} setLang={setLang} samples={{
              curl: `# Headers WASend sends:
X-WASend-Signature: t=1715164800,v1=abc123…
X-WASend-Event:     message.delivered
X-WASend-Delivery-Id: dlv_xxx`,
              node: `import { createHmac, timingSafeEqual } from "crypto";

function verify(rawBody, signatureHeader, secret) {
  const [tsPart, sigPart] = signatureHeader.split(",");
  const ts  = tsPart.split("=")[1];
  const sig = sigPart.split("=")[1];
  const expected = createHmac("sha256", secret).update(\`\${ts}.\${rawBody}\`).digest("hex");
  return timingSafeEqual(Buffer.from(expected), Buffer.from(sig));
}`,
              python: `import hmac, hashlib

def verify(raw_body: bytes, signature_header: str, secret: str) -> bool:
    ts_part, sig_part = signature_header.split(",")
    ts  = ts_part.split("=", 1)[1]
    sig = sig_part.split("=", 1)[1]
    expected = hmac.new(secret.encode(), f"{ts}.{raw_body.decode()}".encode(), hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, sig)`,
            }} />

            <h3 className="text-base font-semibold mt-4">Retries</h3>
            <p className="text-sm text-muted-foreground">
              If your endpoint doesn&apos;t return 2xx within 10 seconds, we retry up to 5 times with backoff:
              <span className="font-mono text-xs"> 1m → 5m → 30m → 2h → 12h</span>. After 10 consecutive failures
              the endpoint is auto-paused; resume from the dashboard once fixed.
            </p>
          </section>
        </main>
      </div>
    </div>
  );
}

// ── Helpers ──────────────────────────────────────────────────────────────
function methodColor(m: string) {
  return m === "GET"    ? "bg-emerald-500/15 text-emerald-400"
       : m === "POST"   ? "bg-blue-500/15 text-blue-400"
       : m === "PATCH"  ? "bg-amber-500/15 text-amber-400"
       : m === "DELETE" ? "bg-red-500/15 text-red-400"
       : "bg-muted/40 text-muted-foreground";
}

function CodeBlock({ lang, setLang, samples }: {
  lang: Lang; setLang: (l: Lang) => void;
  samples: Record<Lang, string>;
}) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(samples[lang]);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="bg-[#0d1117] border border-border/50 rounded-2xl overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border/40 bg-[#161b22]">
        <div className="flex gap-1">
          {(["curl", "node", "python"] as Lang[]).map((l) => (
            <button
              key={l}
              onClick={() => setLang(l)}
              className={`text-[11px] px-2 py-0.5 rounded font-mono transition-all ${
                lang === l ? "bg-card text-foreground" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {l}
            </button>
          ))}
        </div>
        <button onClick={copy} className="p-1 rounded hover:bg-muted/50 text-muted-foreground hover:text-foreground">
          {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
        </button>
      </div>
      <pre className="p-4 text-xs overflow-x-auto"><code className="text-[#c9d1d9]">{samples[lang]}</code></pre>
    </div>
  );
}

function EndpointCard({ endpoint, lang, setLang, tryKey, setTryKey }: {
  endpoint: EndpointDoc; lang: Lang; setLang: (l: Lang) => void;
  tryKey: string; setTryKey: (k: string) => void;
}) {
  const [response, setResponse] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  const baseUrl = typeof window !== "undefined" ? window.location.origin : "";
  const samplePath = endpoint.path.replace("{id}", "msg_abc123");

  const samples: Record<Lang, string> = {
    curl: buildCurl(endpoint, baseUrl, samplePath),
    node: buildNode(endpoint, baseUrl, samplePath),
    python: buildPython(endpoint, baseUrl, samplePath),
  };

  const tryIt = async () => {
    if (!tryKey.trim()) { toast.error("Paste your API key first"); return; }
    setRunning(true);
    try {
      const url = `${baseUrl}${samplePath.replace("{id}", "test_id")}`;
      const opts: RequestInit = {
        method: endpoint.method,
        headers: { Authorization: `Bearer ${tryKey.trim()}`, "Content-Type": "application/json" },
      };
      if (endpoint.example_body && (endpoint.method === "POST" || endpoint.method === "PATCH")) {
        opts.body = JSON.stringify(endpoint.example_body);
      }
      const res = await fetch(url, opts);
      const txt = await res.text();
      setResponse(`HTTP ${res.status}\n\n${tryFormat(txt)}`);
    } catch (err) {
      setResponse(err instanceof Error ? err.message : "Request failed");
    } finally {
      setRunning(false);
    }
  };

  return (
    <div id={endpoint.id} className="bg-card border border-border/50 rounded-2xl overflow-hidden scroll-mt-24">
      <div className="p-5 border-b border-border/40">
        <div className="flex items-center gap-2 mb-2">
          <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${methodColor(endpoint.method)}`}>{endpoint.method}</span>
          <code className="font-mono text-xs">{endpoint.path}</code>
          <span className="text-[10px] text-muted-foreground bg-muted/30 px-1.5 py-0.5 rounded font-mono ml-auto">scope: {endpoint.scope}</span>
        </div>
        <h3 className="text-base font-semibold mb-1">{endpoint.title}</h3>
        <p className="text-xs text-muted-foreground">{endpoint.description}</p>
      </div>

      {endpoint.params && endpoint.params.length > 0 && (
        <div className="p-5 border-b border-border/40">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Parameters</p>
          <table className="w-full text-xs">
            <tbody>
              {endpoint.params.map((p) => (
                <tr key={p.name} className="border-b border-border/20 last:border-0">
                  <td className="py-1.5 pr-3">
                    <code className="font-mono">{p.name}</code>
                    {p.required && <span className="text-red-400 ml-1">*</span>}
                  </td>
                  <td className="py-1.5 pr-3 text-muted-foreground">{p.type}</td>
                  <td className="py-1.5 text-muted-foreground">{p.desc}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="grid grid-cols-2 gap-0">
        <div className="border-r border-border/40">
          <p className="px-5 pt-4 pb-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Request</p>
          <div className="px-5 pb-5">
            <CodeBlock lang={lang} setLang={setLang} samples={samples} />
          </div>
        </div>
        <div>
          <p className="px-5 pt-4 pb-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Response</p>
          <div className="px-5 pb-5">
            <pre className="bg-[#0d1117] border border-border/50 rounded-2xl p-4 text-xs overflow-x-auto text-[#c9d1d9]">
              <code>{JSON.stringify(endpoint.example_response, null, 2)}</code>
            </pre>
          </div>
        </div>
      </div>

      {/* Try it */}
      <div className="p-5 border-t border-border/40 bg-muted/10">
        <div className="flex items-center gap-2 mb-2">
          <Play className="w-3.5 h-3.5 text-emerald-400" />
          <p className="text-xs font-semibold">Try it</p>
        </div>
        <div className="flex gap-2">
          <input
            value={tryKey}
            onChange={(e) => setTryKey(e.target.value)}
            placeholder="Paste your API key (wsk_live_… or wsk_test_…)"
            className="flex-1 bg-card border border-border/50 rounded-lg px-3 py-1.5 text-xs font-mono outline-none focus:border-primary/60"
          />
          <button
            onClick={tryIt}
            disabled={running || !tryKey.trim()}
            className="flex items-center gap-1.5 wa-gradient text-white text-xs font-semibold px-3 py-1.5 rounded-lg hover:opacity-90 disabled:opacity-40"
          >
            {running ? <Loader2 className="w-3 h-3 animate-spin" /> : <ChevronRight className="w-3 h-3" />}
            Send
          </button>
        </div>
        {response && (
          <pre className="bg-[#0d1117] border border-border/50 rounded-xl p-3 text-[11px] overflow-x-auto mt-2 text-[#c9d1d9] max-h-48"><code>{response}</code></pre>
        )}
      </div>
    </div>
  );
}

function buildCurl(e: EndpointDoc, base: string, path: string): string {
  const lines = [`curl ${base}${path} \\`];
  if (e.method !== "GET") lines.push(`  -X ${e.method} \\`);
  lines.push(`  -H "Authorization: Bearer wsk_live_••••" \\`);
  lines.push(`  -H "Content-Type: application/json"`);
  if (e.example_body) lines.push(`  -d '${JSON.stringify(e.example_body)}'`);
  return lines.join("\n");
}
function buildNode(e: EndpointDoc, base: string, path: string): string {
  const opts = [`  method: "${e.method}"`,
    `  headers: { Authorization: "Bearer wsk_live_••••", "Content-Type": "application/json" }`,
  ];
  if (e.example_body) opts.push(`  body: JSON.stringify(${JSON.stringify(e.example_body, null, 2).replace(/\n/g, "\n  ")})`);
  return `const res = await fetch("${base}${path}", {\n${opts.join(",\n")}\n});\nconst data = await res.json();`;
}
function buildPython(e: EndpointDoc, base: string, path: string): string {
  const lines = ["import requests", ""];
  if (e.example_body) lines.push(`payload = ${JSON.stringify(e.example_body, null, 2)}`, "");
  lines.push(`res = requests.${e.method.toLowerCase()}(`);
  lines.push(`  "${base}${path}",`);
  lines.push(`  headers={"Authorization": "Bearer wsk_live_••••", "Content-Type": "application/json"},`);
  if (e.example_body) lines.push(`  json=payload,`);
  lines.push(`)`);
  return lines.join("\n");
}
function tryFormat(s: string): string {
  try { return JSON.stringify(JSON.parse(s), null, 2); } catch { return s.slice(0, 500); }
}
