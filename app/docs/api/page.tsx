"use client";

import { useState } from "react";
import { Copy, Check, ChevronDown, ChevronRight, Zap, MessageSquare, Users, BarChart3, Webhook } from "lucide-react";
import Link from "next/link";

interface Endpoint {
  method: "GET" | "POST" | "PUT" | "DELETE" | "PATCH";
  path: string;
  desc: string;
  body?: string;
  response: string;
  auth: boolean;
}

const METHOD_COLORS: Record<string, string> = {
  GET:    "bg-emerald-500/10 text-emerald-400 border-emerald-500/30",
  POST:   "bg-blue-500/10 text-blue-400 border-blue-500/30",
  PUT:    "bg-amber-500/10 text-amber-400 border-amber-500/30",
  PATCH:  "bg-violet-500/10 text-violet-400 border-violet-500/30",
  DELETE: "bg-red-500/10 text-red-400 border-red-500/30",
};

const SECTIONS = [
  {
    id: "auth",
    label: "Authentication",
    icon: Zap,
    desc: "Include your API key in every request as a Bearer token.",
    endpoints: [] as Endpoint[],
  },
  {
    id: "messages",
    label: "Messages",
    icon: MessageSquare,
    endpoints: [
      {
        method: "POST" as const,
        path: "/api/v1/messages/send",
        desc: "Send a WhatsApp template message to a contact",
        auth: true,
        body: JSON.stringify({ to: "+919876543210", templateName: "order_confirmation", variables: ["John", "ORD-1234", "₹599"] }, null, 2),
        response: JSON.stringify({ success: true, messageId: "wamid.xxx", status: "sent" }, null, 2),
      },
      {
        method: "GET" as const,
        path: "/api/v1/messages/{messageId}",
        desc: "Get delivery status of a message",
        auth: true,
        response: JSON.stringify({ id: "wamid.xxx", status: "delivered", deliveredAt: "2026-05-07T10:30:00Z" }, null, 2),
      },
    ],
  },
  {
    id: "contacts",
    label: "Contacts",
    icon: Users,
    endpoints: [
      {
        method: "GET" as const,
        path: "/api/v1/contacts",
        desc: "List contacts with optional search and pagination",
        auth: true,
        response: JSON.stringify({ contacts: [{ id: "uuid", name: "John", phone: "+91..." }], total: 100, page: 1 }, null, 2),
      },
      {
        method: "POST" as const,
        path: "/api/v1/contacts",
        desc: "Create a new contact",
        auth: true,
        body: JSON.stringify({ name: "Jane Doe", phone: "+919876543210", tags: ["vip"] }, null, 2),
        response: JSON.stringify({ id: "uuid", name: "Jane Doe", phone: "+919876543210", created: true }, null, 2),
      },
      {
        method: "DELETE" as const,
        path: "/api/v1/contacts/{id}",
        desc: "Delete a contact by ID",
        auth: true,
        response: JSON.stringify({ success: true }, null, 2),
      },
    ],
  },
  {
    id: "campaigns",
    label: "Campaigns",
    icon: BarChart3,
    endpoints: [
      {
        method: "GET" as const,
        path: "/api/v1/campaigns",
        desc: "List all campaigns with delivery stats",
        auth: true,
        response: JSON.stringify({ campaigns: [{ id: "uuid", name: "Diwali Sale", sent: 1000, delivered: 945, status: "completed" }] }, null, 2),
      },
    ],
  },
  {
    id: "webhooks",
    label: "Webhooks",
    icon: Webhook,
    desc: "WASend posts events to your endpoint when messages are delivered, read, or replied to.",
    endpoints: [
      {
        method: "POST" as const,
        path: "Your webhook URL",
        desc: "Event payload sent to your registered endpoint",
        auth: false,
        body: JSON.stringify({ event: "message.delivered", messageId: "wamid.xxx", to: "+91...", timestamp: "2026-05-07T10:30:00Z" }, null, 2),
        response: "// Return HTTP 200 to acknowledge. Retry on 4xx/5xx.",
      },
    ],
  },
];

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => { navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
      className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 transition-colors"
    >
      {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5 text-muted-foreground" />}
    </button>
  );
}

function EndpointCard({ ep }: { ep: Endpoint }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border border-border/60 rounded-xl overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-3 p-4 hover:bg-muted/20 transition-colors text-left"
      >
        <span className={`text-xs font-bold px-2 py-0.5 rounded border font-mono flex-shrink-0 ${METHOD_COLORS[ep.method]}`}>
          {ep.method}
        </span>
        <code className="text-sm font-mono flex-1">{ep.path}</code>
        <span className="text-xs text-muted-foreground hidden sm:block">{ep.desc}</span>
        {open ? <ChevronDown className="w-4 h-4 text-muted-foreground flex-shrink-0" /> : <ChevronRight className="w-4 h-4 text-muted-foreground flex-shrink-0" />}
      </button>
      {open && (
        <div className="border-t border-border/50 p-4 space-y-4 bg-muted/5">
          <p className="text-sm text-muted-foreground">{ep.desc}</p>
          {ep.auth && (
            <div className="text-xs text-amber-400 flex items-center gap-1.5">
              <Zap className="w-3 h-3" /> Requires Authorization: Bearer wsk_live_…
            </div>
          )}
          {ep.body && (
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Request Body</p>
                <CopyButton text={ep.body} />
              </div>
              <pre className="bg-[#0d1117] rounded-xl p-4 text-xs text-blue-300 overflow-x-auto">{ep.body}</pre>
            </div>
          )}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Response</p>
              <CopyButton text={ep.response} />
            </div>
            <pre className="bg-[#0d1117] rounded-xl p-4 text-xs text-emerald-300 overflow-x-auto">{ep.response}</pre>
          </div>
        </div>
      )}
    </div>
  );
}

export default function ApiDocsPage() {
  const [activeSection, setActiveSection] = useState("messages");

  return (
    <div className="min-h-screen bg-[#0b141a]">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="p-8 pb-0">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-9 h-9 rounded-xl wa-gradient flex items-center justify-center">
              <Zap className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-bold">WASend API</h1>
              <p className="text-sm text-muted-foreground">v1 · REST · JSON</p>
            </div>
          </div>
          <p className="text-sm text-muted-foreground mt-4 max-w-2xl">
            Programmatic access to WhatsApp messaging, contacts, and campaigns.
            Base URL: <code className="bg-white/5 px-1.5 py-0.5 rounded text-primary">https://wasend.app</code>
          </p>
          <div className="flex gap-2 mt-4">
            <Link href="/settings/api-keys" className="text-xs wa-gradient text-white px-3 py-1.5 rounded-lg font-medium hover:opacity-90">
              Get API Key →
            </Link>
            <a href="#" className="text-xs border border-border px-3 py-1.5 rounded-lg font-medium hover:bg-accent text-muted-foreground hover:text-foreground">
              Postman Collection
            </a>
          </div>
        </div>

        <div className="flex gap-6 p-8">
          {/* Sidebar nav */}
          <div className="w-48 flex-shrink-0">
            <div className="sticky top-6 space-y-0.5">
              {SECTIONS.map((s) => (
                <button
                  key={s.id}
                  onClick={() => setActiveSection(s.id)}
                  className={`w-full flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-medium transition-colors text-left ${
                    activeSection === s.id ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground hover:bg-muted/30"
                  }`}
                >
                  <s.icon className="w-4 h-4 flex-shrink-0" />
                  {s.label}
                </button>
              ))}
            </div>
          </div>

          {/* Content */}
          <div className="flex-1 space-y-8">
            {/* Auth section */}
            {activeSection === "auth" && (
              <div className="space-y-4">
                <h2 className="text-xl font-bold">Authentication</h2>
                <p className="text-sm text-muted-foreground">
                  All API requests must include your API key as a Bearer token in the Authorization header.
                </p>
                <div className="relative">
                  <pre className="bg-[#0d1117] border border-border/50 rounded-2xl p-5 text-sm text-green-400 overflow-x-auto">
{`curl https://wasend.app/api/v1/contacts \\
  -H "Authorization: Bearer wsk_live_YOUR_API_KEY"`}
                  </pre>
                  <div className="absolute top-3 right-3">
                    <CopyButton text={`curl https://wasend.app/api/v1/contacts \\\n  -H "Authorization: Bearer wsk_live_YOUR_API_KEY"`} />
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  {[
                    { code: "200", desc: "Success" },
                    { code: "401", desc: "Invalid or missing key" },
                    { code: "429", desc: "Rate limit exceeded (100 req/min)" },
                  ].map((r) => (
                    <div key={r.code} className="p-3 bg-card border border-border/50 rounded-xl">
                      <p className="font-mono text-sm font-bold text-primary">{r.code}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">{r.desc}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {SECTIONS.filter((s) => s.id === activeSection && s.id !== "auth").map((section) => (
              <div key={section.id} className="space-y-4">
                <div className="flex items-center gap-2">
                  <section.icon className="w-5 h-5 text-primary" />
                  <h2 className="text-xl font-bold">{section.label}</h2>
                </div>
                {section.desc && <p className="text-sm text-muted-foreground">{section.desc}</p>}
                <div className="space-y-3">
                  {section.endpoints.map((ep, i) => (
                    <EndpointCard key={i} ep={ep} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
