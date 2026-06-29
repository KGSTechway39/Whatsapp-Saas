"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { toast } from "sonner";
import Link from "next/link";
import { format, formatDistanceToNow, isToday, isYesterday, parseISO } from "date-fns";
import {
  Search, Filter, Send, Paperclip, Smile, Check, CheckCheck,
  AlertCircle, Clock, Users, Bot, CheckCircle2, XCircle,
  ChevronRight, MessageSquare, Phone, Mail, Tag, User,
  MoreVertical, UserCheck, RefreshCw, X, ChevronDown,
  Image, FileText, MapPin, Volume2, Loader2, Inbox,
  ExternalLink, Copy, Ban, Zap, Info, ArrowLeft, Star,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface ContactInfo {
  id: string; name: string; phone: string; email?: string;
  tags: string[]; crm_stage?: string; crm_score?: number;
  deal_value?: number; company?: string; crm_notes?: string;
  added_date?: string; status?: string;
}

interface WaNumber { id: string; phone_number: string; display_name: string; status: string; }

interface Conversation {
  id: string; status: "open" | "resolved" | "bot_handling";
  unread_count: number; last_message_at: string; last_message_preview: string;
  is_within_24h_window: boolean; window_expires_at?: string;
  contact_phone: string; contact_name: string;
  assigned_to?: string; contact_id?: string;
  contacts?: ContactInfo | null;
  whatsapp_number_id?: string;
  whatsapp_numbers?: WaNumber | null;
}

interface Message {
  id: string; direction: "inbound" | "outbound"; type: string;
  content: Record<string, unknown>; status: "pending" | "sent" | "delivered" | "read" | "failed";
  wa_message_id?: string; error_message?: string;
  sent_at?: string; delivered_at?: string; read_at?: string; created_at: string;
}

interface Template {
  id: string; name: string; displayName: string; category: string;
  language: string; status: string; body: string; variables: string[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function relativeTime(iso: string) {
  try {
    const d = parseISO(iso);
    if (isToday(d)) return format(d, "HH:mm");
    if (isYesterday(d)) return "Yesterday";
    return format(d, "d MMM");
  } catch { return ""; }
}

function groupLabel(iso: string) {
  try {
    const d = parseISO(iso);
    if (isToday(d)) return "Today";
    if (isYesterday(d)) return "Yesterday";
    return format(d, "d MMMM yyyy");
  } catch { return ""; }
}

function msgPreview(content: Record<string, unknown>, type: string) {
  if (type === "text") return (content.body as string) || "";
  if (type === "template") return `📋 ${content.template_name || "Template"}`;
  if (type === "image") return "📷 Image";
  if (type === "video") return "🎥 Video";
  if (type === "audio") return "🎵 Audio";
  if (type === "document") return `📄 ${content.filename || "Document"}`;
  if (type === "location") return "📍 Location";
  return "Message";
}

function initials(name: string) {
  return name.split(" ").map(n => n[0]).join("").slice(0, 2).toUpperCase();
}

// Status icons for outbound messages
function StatusIcon({ status }: { status: string }) {
  if (status === "pending") return <Clock className="w-3 h-3 text-muted-foreground/60" />;
  if (status === "sent") return <Check className="w-3 h-3 text-muted-foreground/80" />;
  if (status === "delivered") return <CheckCheck className="w-3 h-3 text-muted-foreground/80" />;
  if (status === "read") return <CheckCheck className="w-3 h-3 text-blue-400" />;
  if (status === "failed") return <XCircle className="w-3 h-3 text-red-400" />;
  return null;
}

// ─── Message Bubble ───────────────────────────────────────────────────────────

function MessageBubble({ msg }: { msg: Message }) {
  const out = msg.direction === "outbound";
  const time = msg.sent_at || msg.created_at;

  const renderContent = () => {
    const { content, type } = msg;
    if (type === "text") {
      return (
        <p className="text-sm leading-relaxed whitespace-pre-wrap break-words">
          {(content.body as string) || ""}
        </p>
      );
    }
    if (type === "template") {
      return (
        <div>
          <div className="flex items-center gap-1.5 mb-2 opacity-60">
            <MessageSquare className="w-3 h-3" />
            <span className="text-[10px] font-medium uppercase tracking-wide">Template</span>
          </div>
          <p className="text-sm leading-relaxed whitespace-pre-wrap">
            {(content.body as string) || (content.template_name as string) || "Template message"}
          </p>
        </div>
      );
    }
    if (type === "image") {
      return (
        <div className="space-y-1">
          <div className="w-48 h-32 bg-muted/50 rounded-xl flex items-center justify-center border border-border/30">
            <Image className="w-8 h-8 text-muted-foreground/40" />
          </div>
          {content.caption ? <p className="text-xs text-muted-foreground">{String(content.caption)}</p> : null}
        </div>
      );
    }
    if (type === "video") {
      return (
        <div className="w-48 h-32 bg-muted/50 rounded-xl flex items-center justify-center border border-border/30">
          <div className="text-center">
            <div className="w-10 h-10 rounded-full bg-background/80 flex items-center justify-center mx-auto mb-1">
              <span className="text-lg">▶</span>
            </div>
            <span className="text-xs text-muted-foreground">Video</span>
          </div>
        </div>
      );
    }
    if (type === "audio") {
      return (
        <div className="flex items-center gap-2 bg-muted/30 rounded-xl px-3 py-2 min-w-[140px]">
          <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center flex-shrink-0">
            <Volume2 className="w-4 h-4 text-primary" />
          </div>
          <div className="flex-1">
            <div className="h-1.5 bg-muted/50 rounded-full overflow-hidden">
              <div className="h-full bg-primary/40 rounded-full w-1/3" />
            </div>
            <span className="text-[10px] text-muted-foreground mt-0.5 block">Audio message</span>
          </div>
        </div>
      );
    }
    if (type === "document") {
      return (
        <div className="flex items-center gap-2.5 bg-muted/30 rounded-xl px-3 py-2.5 min-w-[160px]">
          <div className="w-8 h-8 rounded-lg bg-blue-500/20 flex items-center justify-center flex-shrink-0">
            <FileText className="w-4 h-4 text-blue-400" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium truncate">{(content.filename as string) || "Document"}</p>
            <p className="text-[10px] text-muted-foreground">Tap to open</p>
          </div>
        </div>
      );
    }
    if (type === "location") {
      const loc = content as { latitude?: number; longitude?: number; name?: string; address?: string };
      return (
        <div className="w-48 bg-muted/30 rounded-xl overflow-hidden border border-border/30">
          <div className="h-20 bg-emerald-500/10 flex items-center justify-center">
            <MapPin className="w-8 h-8 text-emerald-400" />
          </div>
          <div className="p-2">
            <p className="text-xs font-medium">{loc.name || "Location"}</p>
            {loc.address && <p className="text-[10px] text-muted-foreground truncate">{loc.address}</p>}
          </div>
        </div>
      );
    }
    return <p className="text-sm text-muted-foreground italic">Unsupported message</p>;
  };

  return (
    <div className={`flex ${out ? "justify-end" : "justify-start"} mb-1 group`}>
      <div className={`max-w-[72%] ${out ? "items-end" : "items-start"} flex flex-col`}>
        <div className={`relative px-3 py-2 rounded-2xl shadow-sm ${
          out
            ? "bg-[#005c4b] text-white rounded-tr-sm"
            : "bg-[#202c33] text-[#e9edef] rounded-tl-sm"
        }`}>
          {renderContent()}
          <div className={`flex items-center gap-1 mt-1 ${out ? "justify-end" : "justify-start"}`}>
            <span className="text-[10px] opacity-60">{relativeTime(time || "")}</span>
            {out && <StatusIcon status={msg.status} />}
          </div>
          {msg.error_message && (
            <p className="text-[10px] text-red-300 mt-0.5">{msg.error_message}</p>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Conversation Card ─────────────────────────────────────────────────────────

function ConvCard({ conv, active, onClick }: {
  conv: Conversation; active: boolean; onClick: () => void;
}) {
  const withinWindow = conv.is_within_24h_window &&
    conv.window_expires_at && new Date(conv.window_expires_at) > new Date();

  return (
    <button
      onClick={onClick}
      className={`w-full text-left flex items-start gap-3 px-4 py-3 border-b border-border/20 transition-colors hover:bg-accent/30 ${
        active ? "bg-primary/10 border-l-2 border-l-primary" : ""
      }`}
    >
      {/* Avatar */}
      <div className="relative flex-shrink-0">
        <div className={`w-11 h-11 rounded-full flex items-center justify-center text-sm font-bold text-white ${
          conv.status === "bot_handling" ? "bg-violet-500" :
          conv.status === "resolved" ? "bg-muted-foreground/50" :
          "wa-gradient"
        }`}>
          {initials(conv.contact_name || conv.contact_phone || "?")}
        </div>
        <span className={`absolute bottom-0 right-0 w-3 h-3 rounded-full border-2 border-background ${
          withinWindow ? "bg-emerald-400" : "bg-red-400"
        }`} title={withinWindow ? "24h window open" : "Window expired"} />
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between mb-0.5">
          <span className="text-sm font-semibold truncate pr-2">
            {conv.contact_name || conv.contact_phone}
          </span>
          <span className="text-[11px] text-muted-foreground flex-shrink-0">
            {relativeTime(conv.last_message_at)}
          </span>
        </div>
        <div className="flex items-center justify-between">
          <p className="text-xs text-muted-foreground truncate pr-2 flex-1">
            {conv.status === "bot_handling" && <span className="text-violet-400 mr-1">🤖</span>}
            {conv.last_message_preview || "No messages yet"}
          </p>
          {conv.unread_count > 0 && (
            <span className="flex-shrink-0 w-5 h-5 rounded-full bg-primary text-white text-[10px] font-bold flex items-center justify-center">
              {conv.unread_count > 9 ? "9+" : conv.unread_count}
            </span>
          )}
        </div>
        {conv.whatsapp_numbers?.display_name && (
          <p className="text-[10px] text-muted-foreground/60 mt-0.5 truncate">
            via {conv.whatsapp_numbers.display_name}
          </p>
        )}
      </div>
    </button>
  );
}

// ─── Template Picker ──────────────────────────────────────────────────────────

function TemplatePicker({
  templates, onSelect, onClose,
}: {
  templates: Template[];
  onSelect: (t: Template, vars: string[]) => void;
  onClose: () => void;
}) {
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Template | null>(null);
  const [vars, setVars] = useState<string[]>([]);

  const filtered = templates
    .filter(t => t.status === "APPROVED")
    .filter(t =>
      !search ||
      t.displayName.toLowerCase().includes(search.toLowerCase()) ||
      t.name.toLowerCase().includes(search.toLowerCase())
    );

  const handleSelect = (t: Template) => {
    setSelected(t);
    setVars(t.variables.map(() => ""));
  };

  return (
    <div className="absolute bottom-full left-0 right-0 mb-2 bg-[#111b21] border border-border/50 rounded-2xl shadow-2xl overflow-hidden z-30 flex flex-col max-h-[460px]">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border/40">
        <p className="text-sm font-semibold">Select Template</p>
        <button onClick={onClose} className="p-1 rounded-lg hover:bg-accent">
          <X className="w-4 h-4" />
        </button>
      </div>

      {!selected ? (
        <>
          <div className="px-3 py-2 border-b border-border/30">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
              <input
                autoFocus
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search templates…"
                className="w-full bg-muted/30 border border-border/40 rounded-xl pl-8 pr-3 py-1.5 text-sm outline-none focus:border-primary/50"
              />
            </div>
          </div>
          <div className="overflow-y-auto flex-1">
            {filtered.length === 0 ? (
              <div className="p-8 text-center text-sm text-muted-foreground">No approved templates</div>
            ) : filtered.map(t => (
              <button
                key={t.id}
                onClick={() => handleSelect(t)}
                className="w-full text-left px-4 py-3 hover:bg-accent/30 border-b border-border/20 last:border-0 transition-colors"
              >
                <div className="flex items-center justify-between mb-0.5">
                  <span className="text-sm font-medium">{t.displayName}</span>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${
                    t.category === "MARKETING" ? "bg-blue-500/15 text-blue-400" : "bg-emerald-500/15 text-emerald-400"
                  }`}>{t.category}</span>
                </div>
                <p className="text-xs text-muted-foreground line-clamp-2">{t.body}</p>
              </button>
            ))}
          </div>
        </>
      ) : (
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          <button
            onClick={() => setSelected(null)}
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="w-3.5 h-3.5" /> Back to templates
          </button>
          <div>
            <p className="text-sm font-semibold mb-1">{selected.displayName}</p>
            <p className="text-xs text-muted-foreground bg-muted/20 rounded-xl p-3 leading-relaxed whitespace-pre-wrap">
              {selected.body}
            </p>
          </div>
          {selected.variables.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Fill Variables</p>
              {selected.variables.map((v, i) => (
                <div key={i}>
                  <label className="text-xs text-muted-foreground mb-1 block">
                    {`{{${i + 1}}}`} — {v}
                  </label>
                  <input
                    value={vars[i] || ""}
                    onChange={e => { const copy = [...vars]; copy[i] = e.target.value; setVars(copy); }}
                    placeholder={`Enter ${v}…`}
                    className="w-full bg-muted/30 border border-border/40 rounded-xl px-3 py-1.5 text-sm outline-none focus:border-primary/50"
                  />
                </div>
              ))}
            </div>
          )}
          <button
            onClick={() => onSelect(selected, vars)}
            className="w-full wa-gradient text-white text-sm font-semibold py-2.5 rounded-xl hover:opacity-90 transition-all"
          >
            Send Template
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

const FILTERS = [
  { id: "open",     label: "All",       icon: Inbox },
  { id: "unread",   label: "Unread",    icon: MessageSquare },
  { id: "bot",      label: "Bot",       icon: Bot },
  { id: "resolved", label: "Resolved",  icon: CheckCircle2 },
] as const;
type FilterId = typeof FILTERS[number]["id"];

const QUICK_REPLIES = [
  "Sure, I'll check and get back to you shortly!",
  "Thank you for reaching out. How can I help?",
  "I've forwarded your request to the concerned team.",
  "Our team will contact you within 24 hours.",
];

export default function InboxPage() {
  const [conversations, setConversations]       = useState<Conversation[]>([]);
  const [selectedId, setSelectedId]             = useState<string | null>(null);
  const [messages, setMessages]                 = useState<Message[]>([]);
  const [templates, setTemplates]               = useState<Template[]>([]);
  const [filter, setFilter]                     = useState<FilterId>("open");
  const [search, setSearch]                     = useState("");
  const [sort, setSort]                         = useState<"latest" | "unread">("latest");
  const [inputText, setInputText]               = useState("");
  const [sending, setSending]                   = useState(false);
  const [loadingConvs, setLoadingConvs]         = useState(true);
  const [loadingMsgs, setLoadingMsgs]           = useState(false);
  const [rightOpen, setRightOpen]               = useState(true);
  const [showTemplatePicker, setShowTemplatePicker] = useState(false);
  const [showQuickReplies, setShowQuickReplies] = useState(false);
  const [showActions, setShowActions]           = useState(false);
  const [recentCampaigns, setRecentCampaigns]   = useState<unknown[]>([]);
  const [liveIndicator, setLiveIndicator]       = useState(true);

  const messagesEndRef  = useRef<HTMLDivElement>(null);
  const inputRef        = useRef<HTMLTextAreaElement>(null);
  const convPollRef     = useRef<ReturnType<typeof setInterval> | null>(null);
  const msgPollRef      = useRef<ReturnType<typeof setInterval> | null>(null);

  const selectedConv = conversations.find(c => c.id === selectedId) ?? null;
  const withinWindow = selectedConv?.is_within_24h_window &&
    selectedConv?.window_expires_at &&
    new Date(selectedConv.window_expires_at) > new Date();

  // ── Fetch conversations ──────────────────────────────────────────────────────
  const fetchConvs = useCallback(async (quiet = false) => {
    if (!quiet) setLoadingConvs(true);
    try {
      const q = new URLSearchParams({ status: filter, sort });
      if (search) q.set("search", search);
      const res = await fetch(`/api/inbox?${q}`);
      if (!res.ok) return;
      const data = await res.json();
      setConversations(data.conversations ?? []);
    } catch { /* silent */ } finally {
      if (!quiet) setLoadingConvs(false);
    }
  }, [filter, search, sort]);

  // ── Fetch messages for selected conversation ─────────────────────────────────
  const fetchMessages = useCallback(async (id: string, quiet = false) => {
    if (!quiet) setLoadingMsgs(true);
    try {
      const res = await fetch(`/api/inbox/${id}`);
      if (!res.ok) return;
      const data = await res.json();
      setMessages(data.messages ?? []);
      setRecentCampaigns(data.recentCampaigns ?? []);
      // Update unread in local state
      setConversations(prev => prev.map(c =>
        c.id === id ? { ...c, unread_count: 0 } : c
      ));
    } catch { /* silent */ } finally {
      if (!quiet) setLoadingMsgs(false);
    }
  }, []);

  // ── Fetch templates ──────────────────────────────────────────────────────────
  useEffect(() => {
    fetch("/api/templates")
      .then(r => r.json())
      .then(d => setTemplates(d.templates ?? []))
      .catch(() => {});
  }, []);

  // ── Initial load + polling ────────────────────────────────────────────────────
  useEffect(() => {
    fetchConvs();
  }, [fetchConvs]);

  // Poll conversation list every 6 seconds
  useEffect(() => {
    if (convPollRef.current) clearInterval(convPollRef.current);
    convPollRef.current = setInterval(() => fetchConvs(true), 6000);
    return () => { if (convPollRef.current) clearInterval(convPollRef.current); };
  }, [fetchConvs]);

  // Poll messages every 3 seconds when a conversation is open
  useEffect(() => {
    if (msgPollRef.current) clearInterval(msgPollRef.current);
    if (!selectedId) return;
    msgPollRef.current = setInterval(() => fetchMessages(selectedId, true), 3000);
    return () => { if (msgPollRef.current) clearInterval(msgPollRef.current); };
  }, [selectedId, fetchMessages]);

  // Live indicator pulse
  useEffect(() => {
    const t = setInterval(() => setLiveIndicator(v => !v), 2000);
    return () => clearInterval(t);
  }, []);

  // ── Select conversation ───────────────────────────────────────────────────────
  const handleSelectConv = async (id: string) => {
    if (id === selectedId) return;
    setSelectedId(id);
    setMessages([]);
    setShowTemplatePicker(false);
    setShowQuickReplies(false);
    await fetchMessages(id);
    setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: "smooth" }), 100);
    inputRef.current?.focus();
  };

  // ── Auto-scroll ───────────────────────────────────────────────────────────────
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  // ── Send message ──────────────────────────────────────────────────────────────
  const sendMessage = useCallback(async (overrideText?: string) => {
    if (!selectedId) return;
    const body = overrideText ?? inputText.trim();
    if (!body) return;

    setSending(true);
    const optimisticId = `opt-${Date.now()}`;
    const optimistic: Message = {
      id: optimisticId, direction: "outbound", type: "text",
      content: { body }, status: "pending",
      created_at: new Date().toISOString(),
    };
    setMessages(prev => [...prev, optimistic]);
    if (!overrideText) setInputText("");

    try {
      const res = await fetch(`/api/inbox/${selectedId}/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": optimisticId },
        body: JSON.stringify({ type: "text", text: body }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (data.code === "WINDOW_EXPIRED") {
          toast.error("24-hour window expired. Use a template to re-engage.");
          setShowTemplatePicker(true);
        } else {
          toast.error(data.error || "Send failed");
        }
        setMessages(prev => prev.filter(m => m.id !== optimisticId));
        return;
      }
      // Replace optimistic with real
      setMessages(prev => prev.map(m =>
        m.id === optimisticId
          ? { ...m, ...(data.message ?? {}), id: data.message?.id ?? optimisticId }
          : m
      ));
      setConversations(prev => prev.map(c =>
        c.id === selectedId
          ? { ...c, last_message_at: new Date().toISOString(), last_message_preview: body }
          : c
      ));
    } catch {
      toast.error("Failed to send message");
      setMessages(prev => prev.filter(m => m.id !== optimisticId));
    } finally {
      setSending(false);
    }
  }, [selectedId, inputText]);

  const sendTemplate = async (template: Template, vars: string[]) => {
    if (!selectedId) return;
    setShowTemplatePicker(false);
    setSending(true);

    const optimisticId = `opt-${Date.now()}`;
    const optimistic: Message = {
      id: optimisticId, direction: "outbound", type: "template",
      content: { template_name: template.name, body: template.body },
      status: "pending", created_at: new Date().toISOString(),
    };
    setMessages(prev => [...prev, optimistic]);

    try {
      const res = await fetch(`/api/inbox/${selectedId}/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": optimisticId },
        body: JSON.stringify({ type: "template", templateId: template.id, variableValues: vars }),
      });
      const data = await res.json();
      if (!res.ok) { toast.error(data.error || "Template send failed"); }
      else {
        toast.success("Template sent!");
        setMessages(prev => prev.map(m =>
          m.id === optimisticId ? { ...m, ...(data.message ?? {}) } : m
        ));
        // Update 24h window in selected conversation
        setConversations(prev => prev.map(c =>
          c.id === selectedId
            ? { ...c, is_within_24h_window: true, window_expires_at: new Date(Date.now() + 24 * 3600000).toISOString() }
            : c
        ));
      }
    } catch { toast.error("Failed to send template"); }
    finally { setSending(false); }
  };

  // ── Keyboard shortcuts ────────────────────────────────────────────────────────
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
    if (e.key === "Escape") {
      setSelectedId(null);
      setMessages([]);
    }
  };

  // ── Update conversation status ────────────────────────────────────────────────
  const updateConvStatus = async (id: string, status: "open" | "resolved") => {
    try {
      await fetch(`/api/inbox/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      setConversations(prev => prev.map(c => c.id === id ? { ...c, status } : c));
      if (status === "resolved") toast.success("Conversation resolved");
      else toast.success("Conversation reopened");
      setShowActions(false);
    } catch { toast.error("Failed to update conversation"); }
  };

  // ── Group messages by date ────────────────────────────────────────────────────
  const groupedMessages = messages.reduce<{ label: string; msgs: Message[] }[]>((acc, msg) => {
    const label = groupLabel(msg.created_at);
    const last = acc[acc.length - 1];
    if (last?.label === label) { last.msgs.push(msg); }
    else { acc.push({ label, msgs: [msg] }); }
    return acc;
  }, []);

  // ── Render ────────────────────────────────────────────────────────────────────
  return (
    <div className="h-[calc(100vh-4rem)] -m-4 sm:-m-6 flex overflow-hidden bg-[#0b141a]">

      {/* ── LEFT PANEL: Conversation List ────────────────────────────────────── */}
      <div className={`${selectedId ? "hidden lg:flex" : "flex"} flex-col w-full lg:w-[320px] border-r border-border/30 flex-shrink-0 bg-[#111b21]`}>
        {/* Header */}
        <div className="px-4 py-3 border-b border-border/30 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <MessageSquare className="w-5 h-5 text-primary" />
            <h2 className="text-base font-bold">Inbox</h2>
            <div className={`w-2 h-2 rounded-full transition-all ${liveIndicator ? "bg-emerald-400" : "bg-emerald-400/40"}`} title="Live" />
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setSort(sort === "latest" ? "unread" : "latest")}
              title={sort === "latest" ? "Sort: Latest first" : "Sort: Unread first"}
              className="p-1.5 rounded-lg hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
            >
              <Filter className="w-4 h-4" />
            </button>
            <button
              onClick={() => fetchConvs()}
              className="p-1.5 rounded-lg hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
            >
              <RefreshCw className={`w-4 h-4 ${loadingConvs ? "animate-spin" : ""}`} />
            </button>
          </div>
        </div>

        {/* Search */}
        <div className="px-3 py-2 border-b border-border/20">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search contacts…"
              className="w-full bg-[#202c33] border border-border/30 rounded-xl pl-8 pr-3 py-1.5 text-sm outline-none focus:border-primary/40 placeholder:text-muted-foreground/50"
            />
            {search && (
              <button onClick={() => setSearch("")} className="absolute right-2.5 top-1/2 -translate-y-1/2">
                <X className="w-3.5 h-3.5 text-muted-foreground" />
              </button>
            )}
          </div>
        </div>

        {/* Filter tabs */}
        <div className="flex border-b border-border/20 overflow-x-auto">
          {FILTERS.map(f => {
            const count = f.id === "unread"
              ? conversations.filter(c => c.unread_count > 0).length
              : 0;
            return (
              <button
                key={f.id}
                onClick={() => setFilter(f.id)}
                className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium whitespace-nowrap border-b-2 transition-all flex-1 justify-center ${
                  filter === f.id
                    ? "border-primary text-primary"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
              >
                <f.icon className="w-3.5 h-3.5" />
                {f.label}
                {count > 0 && f.id === "unread" && (
                  <span className="w-4 h-4 rounded-full bg-primary text-white text-[9px] font-bold flex items-center justify-center">
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Conversation list */}
        <div className="flex-1 overflow-y-auto scrollbar-thin">
          {loadingConvs ? (
            <div className="flex items-center justify-center h-32">
              <Loader2 className="w-5 h-5 animate-spin text-primary" />
            </div>
          ) : conversations.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full py-16 text-center px-6">
              <Inbox className="w-12 h-12 text-muted-foreground/20 mb-3" />
              <p className="text-sm font-medium text-muted-foreground">No conversations</p>
              <p className="text-xs text-muted-foreground/60 mt-1">
                Messages from your WhatsApp numbers will appear here
              </p>
            </div>
          ) : conversations.map(conv => (
            <ConvCard
              key={conv.id}
              conv={conv}
              active={conv.id === selectedId}
              onClick={() => handleSelectConv(conv.id)}
            />
          ))}
        </div>
      </div>

      {/* ── CENTER PANEL: Chat Window ─────────────────────────────────────────── */}
      <div className={`${selectedId ? "flex" : "hidden lg:flex"} flex-1 flex-col min-w-0`}>
        {!selectedId ? (
          /* Empty state */
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center">
              <div className="w-24 h-24 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-4">
                <MessageSquare className="w-10 h-10 text-primary/40" />
              </div>
              <h3 className="text-lg font-semibold text-muted-foreground mb-1">WhatsApp Inbox</h3>
              <p className="text-sm text-muted-foreground/60 max-w-xs">
                Select a conversation to start chatting
              </p>
            </div>
          </div>
        ) : (
          <>
            {/* Chat header */}
            <div className="h-14 flex items-center gap-3 px-4 border-b border-border/30 bg-[#202c33] flex-shrink-0">
              {/* Mobile back */}
              <button
                onClick={() => setSelectedId(null)}
                className="lg:hidden p-1.5 rounded-lg hover:bg-accent"
              >
                <ArrowLeft className="w-4 h-4" />
              </button>

              <div className="w-9 h-9 rounded-full wa-gradient flex items-center justify-center text-xs font-bold text-white flex-shrink-0">
                {initials(selectedConv?.contact_name || selectedConv?.contact_phone || "?")}
              </div>

              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold truncate">
                  {selectedConv?.contact_name || selectedConv?.contact_phone}
                </p>
                <div className="flex items-center gap-2">
                  <p className="text-[11px] text-muted-foreground truncate">
                    {selectedConv?.contact_phone}
                  </p>
                  {selectedConv?.whatsapp_numbers?.display_name && (
                    <span className="text-[10px] text-muted-foreground/60 hidden sm:block">
                      · via {selectedConv.whatsapp_numbers.display_name}
                    </span>
                  )}
                  {selectedConv?.status === "bot_handling" && (
                    <span className="text-[10px] bg-violet-500/15 text-violet-400 px-1.5 py-0.5 rounded-full font-medium hidden sm:flex items-center gap-1">
                      <Bot className="w-2.5 h-2.5" /> Bot
                    </span>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-1 flex-shrink-0">
                {/* Resolve / reopen */}
                <button
                  onClick={() => updateConvStatus(selectedId, selectedConv?.status === "resolved" ? "open" : "resolved")}
                  title={selectedConv?.status === "resolved" ? "Reopen" : "Resolve"}
                  className={`p-1.5 rounded-lg transition-colors ${
                    selectedConv?.status === "resolved"
                      ? "text-emerald-400 hover:bg-emerald-500/10"
                      : "text-muted-foreground hover:bg-accent hover:text-emerald-400"
                  }`}
                >
                  <CheckCircle2 className="w-4.5 h-4.5" />
                </button>

                {/* Toggle right panel */}
                <button
                  onClick={() => setRightOpen(!rightOpen)}
                  title="Contact info"
                  className={`p-1.5 rounded-lg transition-colors hidden lg:block ${
                    rightOpen ? "text-primary bg-primary/10" : "text-muted-foreground hover:bg-accent"
                  }`}
                >
                  <User className="w-4.5 h-4.5" />
                </button>

                {/* More actions */}
                <div className="relative">
                  <button
                    onClick={() => setShowActions(!showActions)}
                    className="p-1.5 rounded-lg hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <MoreVertical className="w-4.5 h-4.5" />
                  </button>
                  {showActions && (
                    <>
                      <div className="fixed inset-0 z-10" onClick={() => setShowActions(false)} />
                      <div className="absolute right-0 top-10 w-48 bg-card border border-border rounded-2xl shadow-2xl z-20 overflow-hidden">
                        {[
                          { label: "View contact", icon: User, href: selectedConv?.contact_id ? `/contacts` : null },
                          { label: selectedConv?.status === "resolved" ? "Reopen" : "Resolve", icon: CheckCircle2, action: () => updateConvStatus(selectedId, selectedConv?.status === "resolved" ? "open" : "resolved") },
                          { label: "Copy number", icon: Copy, action: () => { navigator.clipboard.writeText(selectedConv?.contact_phone ?? ""); toast.success("Copied!"); setShowActions(false); } },
                        ].map((item) => (
                          item.href ? (
                            <Link
                              key={item.label}
                              href={item.href}
                              onClick={() => setShowActions(false)}
                              className="flex items-center gap-2.5 px-4 py-2.5 text-sm hover:bg-accent transition-colors"
                            >
                              <item.icon className="w-4 h-4 text-muted-foreground" /> {item.label}
                            </Link>
                          ) : (
                            <button
                              key={item.label}
                              onClick={item.action}
                              className="flex items-center gap-2.5 px-4 py-2.5 text-sm hover:bg-accent transition-colors w-full text-left"
                            >
                              <item.icon className="w-4 h-4 text-muted-foreground" /> {item.label}
                            </button>
                          )
                        ))}
                      </div>
                    </>
                  )}
                </div>
              </div>
            </div>

            {/* 24h window banner */}
            {!withinWindow && selectedConv?.status !== "resolved" && (
              <div className="flex items-center gap-2.5 bg-amber-500/10 border-b border-amber-500/20 px-4 py-2.5 flex-shrink-0">
                <AlertCircle className="w-4 h-4 text-amber-400 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-amber-400">24-hour conversation window expired</p>
                  <p className="text-[11px] text-muted-foreground">Send a template message to re-engage this contact</p>
                </div>
                <button
                  onClick={() => setShowTemplatePicker(true)}
                  className="flex-shrink-0 text-xs bg-amber-500/20 text-amber-400 px-2.5 py-1 rounded-lg hover:bg-amber-500/30 font-medium transition-colors"
                >
                  Send Template
                </button>
              </div>
            )}

            {/* Resolved banner */}
            {selectedConv?.status === "resolved" && (
              <div className="flex items-center gap-2.5 bg-emerald-500/10 border-b border-emerald-500/20 px-4 py-2 flex-shrink-0">
                <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                <p className="text-xs text-emerald-400 flex-1">This conversation is resolved</p>
                <button
                  onClick={() => updateConvStatus(selectedId, "open")}
                  className="text-xs text-emerald-400 hover:underline font-medium"
                >
                  Reopen
                </button>
              </div>
            )}

            {/* Messages area */}
            <div
              className="flex-1 overflow-y-auto px-4 py-4 scrollbar-thin"
              style={{ backgroundImage: "radial-gradient(circle, rgba(255,255,255,0.02) 1px, transparent 1px)", backgroundSize: "20px 20px" }}
            >
              {loadingMsgs ? (
                <div className="flex items-center justify-center h-32">
                  <Loader2 className="w-5 h-5 animate-spin text-primary" />
                </div>
              ) : messages.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-center">
                  <MessageSquare className="w-10 h-10 text-muted-foreground/20 mb-2" />
                  <p className="text-sm text-muted-foreground">No messages yet</p>
                  <p className="text-xs text-muted-foreground/60 mt-1">Send a template to start the conversation</p>
                </div>
              ) : groupedMessages.map(group => (
                <div key={group.label}>
                  {/* Date separator */}
                  <div className="flex items-center gap-3 my-4">
                    <div className="flex-1 h-px bg-border/30" />
                    <span className="text-[11px] text-muted-foreground/60 bg-[#0b141a] px-2 py-0.5 rounded-full border border-border/20">
                      {group.label}
                    </span>
                    <div className="flex-1 h-px bg-border/30" />
                  </div>
                  {group.msgs.map(msg => (
                    <MessageBubble key={msg.id} msg={msg} />
                  ))}
                </div>
              ))}
              <div ref={messagesEndRef} />
            </div>

            {/* Input area */}
            <div className="border-t border-border/30 bg-[#202c33] px-3 py-2 flex-shrink-0">
              {/* Quick replies */}
              {showQuickReplies && (
                <div className="mb-2 flex flex-wrap gap-1.5">
                  {QUICK_REPLIES.map((qr, i) => (
                    <button
                      key={i}
                      onClick={() => { setInputText(qr); setShowQuickReplies(false); inputRef.current?.focus(); }}
                      className="text-xs bg-muted/30 border border-border/40 rounded-xl px-2.5 py-1.5 hover:bg-accent transition-colors text-left max-w-[200px] truncate"
                    >
                      {qr}
                    </button>
                  ))}
                  <button onClick={() => setShowQuickReplies(false)} className="text-xs text-muted-foreground p-1">
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}

              {/* Template picker */}
              {showTemplatePicker && (
                <div className="relative">
                  <TemplatePicker
                    templates={templates}
                    onSelect={sendTemplate}
                    onClose={() => setShowTemplatePicker(false)}
                  />
                </div>
              )}

              <div className="flex items-end gap-2">
                {/* Attachment */}
                <button
                  onClick={() => toast.info("File attachment coming soon")}
                  className="p-2 rounded-xl hover:bg-accent text-muted-foreground hover:text-foreground transition-colors flex-shrink-0 mb-0.5"
                  title="Attach file"
                >
                  <Paperclip className="w-4.5 h-4.5" />
                </button>

                {/* Quick replies */}
                <button
                  onClick={() => setShowQuickReplies(!showQuickReplies)}
                  className={`p-2 rounded-xl transition-colors flex-shrink-0 mb-0.5 ${
                    showQuickReplies ? "text-primary bg-primary/10" : "hover:bg-accent text-muted-foreground hover:text-foreground"
                  }`}
                  title="Quick replies"
                >
                  <Zap className="w-4.5 h-4.5" />
                </button>

                {/* Text input */}
                <textarea
                  ref={inputRef}
                  value={inputText}
                  onChange={e => setInputText(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder={
                    selectedConv?.status === "resolved"
                      ? "Conversation is resolved…"
                      : withinWindow
                      ? "Type a message…"
                      : "24h window expired — use template to re-engage"
                  }
                  disabled={selectedConv?.status === "resolved" || sending}
                  rows={1}
                  className="flex-1 bg-[#2a3942] border border-border/30 rounded-2xl px-4 py-2.5 text-sm outline-none focus:border-primary/40 resize-none placeholder:text-muted-foreground/50 max-h-24 disabled:opacity-50 disabled:cursor-not-allowed scrollbar-thin transition-all"
                  style={{ lineHeight: "1.5" }}
                  onInput={e => {
                    const t = e.currentTarget;
                    t.style.height = "auto";
                    t.style.height = Math.min(t.scrollHeight, 96) + "px";
                  }}
                />

                {/* Template */}
                <button
                  onClick={() => setShowTemplatePicker(!showTemplatePicker)}
                  disabled={selectedConv?.status === "resolved"}
                  className={`p-2 rounded-xl transition-colors flex-shrink-0 mb-0.5 ${
                    showTemplatePicker ? "text-primary bg-primary/10" : "hover:bg-accent text-muted-foreground hover:text-foreground"
                  } disabled:opacity-40 disabled:cursor-not-allowed`}
                  title="Send template"
                >
                  <MessageSquare className="w-4.5 h-4.5" />
                </button>

                {/* Send */}
                <button
                  onClick={() => sendMessage()}
                  disabled={sending || !inputText.trim() || selectedConv?.status === "resolved"}
                  className="p-2 rounded-xl wa-gradient text-white flex-shrink-0 mb-0.5 disabled:opacity-40 disabled:cursor-not-allowed hover:opacity-90 transition-all shadow-md"
                  title="Send (Enter)"
                >
                  {sending
                    ? <Loader2 className="w-4.5 h-4.5 animate-spin" />
                    : <Send className="w-4.5 h-4.5" />
                  }
                </button>
              </div>

              <p className="text-[10px] text-muted-foreground/40 mt-1.5 px-1 hidden sm:block">
                Enter to send · Shift+Enter for new line · Esc to close
              </p>
            </div>
          </>
        )}
      </div>

      {/* ── RIGHT PANEL: Contact Details ──────────────────────────────────────── */}
      {selectedId && rightOpen && (
        <div className="hidden lg:flex flex-col w-[280px] border-l border-border/30 bg-[#111b21] flex-shrink-0 overflow-y-auto scrollbar-thin">
          <div className="px-4 py-3 border-b border-border/30 flex items-center justify-between">
            <p className="text-sm font-semibold">Contact Info</p>
            <button onClick={() => setRightOpen(false)} className="p-1 rounded-lg hover:bg-accent text-muted-foreground">
              <X className="w-4 h-4" />
            </button>
          </div>

          {selectedConv && (
            <div className="p-4 space-y-5">
              {/* Avatar + name */}
              <div className="text-center">
                <div className="w-16 h-16 rounded-full wa-gradient flex items-center justify-center text-xl font-bold text-white mx-auto mb-3">
                  {initials(selectedConv.contact_name || selectedConv.contact_phone || "?")}
                </div>
                <p className="font-semibold text-sm">{selectedConv.contact_name}</p>
                <p className="text-xs text-muted-foreground">{selectedConv.contact_phone}</p>
              </div>

              {/* Contact fields */}
              <div className="space-y-2">
                {[
                  { icon: Phone, label: "Phone", value: selectedConv.contact_phone },
                  { icon: Mail, label: "Email", value: selectedConv.contacts?.email },
                  { icon: User, label: "Company", value: selectedConv.contacts?.company },
                ].filter(f => f.value).map(f => (
                  <div key={f.label} className="flex items-center gap-2.5">
                    <div className="w-7 h-7 rounded-lg bg-muted/40 flex items-center justify-center flex-shrink-0">
                      <f.icon className="w-3.5 h-3.5 text-muted-foreground" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-[10px] text-muted-foreground/60 uppercase tracking-wide">{f.label}</p>
                      <p className="text-xs truncate">{f.value}</p>
                    </div>
                  </div>
                ))}
              </div>

              {/* Tags */}
              {(selectedConv.contacts?.tags?.length ?? 0) > 0 && (
                <div>
                  <p className="text-[10px] text-muted-foreground/60 uppercase tracking-wide mb-1.5">Tags</p>
                  <div className="flex flex-wrap gap-1">
                    {selectedConv.contacts?.tags?.map(tag => (
                      <span key={tag} className="text-[11px] bg-primary/10 text-primary px-2 py-0.5 rounded-full border border-primary/20">
                        #{tag}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* CRM Stage */}
              {selectedConv.contacts?.crm_stage && (
                <div className="bg-muted/20 rounded-xl p-3 border border-border/30">
                  <p className="text-[10px] text-muted-foreground/60 uppercase tracking-wide mb-1.5">CRM Stage</p>
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium capitalize">
                      {selectedConv.contacts.crm_stage.replace(/_/g, " ")}
                    </span>
                    {selectedConv.contacts.crm_score && (
                      <div className="flex items-center gap-1">
                        <Star className="w-3 h-3 text-amber-400 fill-amber-400" />
                        <span className="text-xs font-bold text-amber-400">{selectedConv.contacts.crm_score}</span>
                      </div>
                    )}
                  </div>
                  {(selectedConv.contacts.deal_value ?? 0) > 0 && (
                    <p className="text-xs text-emerald-400 mt-1 font-medium">
                      ₹{Number(selectedConv.contacts.deal_value).toLocaleString()}
                    </p>
                  )}
                </div>
              )}

              {/* 24h window status */}
              <div className={`rounded-xl p-3 border ${
                withinWindow
                  ? "bg-emerald-500/5 border-emerald-500/20"
                  : "bg-red-500/5 border-red-500/20"
              }`}>
                <p className="text-[10px] uppercase tracking-wide mb-1 font-medium ${withinWindow ? 'text-emerald-400' : 'text-red-400'}">
                  {withinWindow ? "24h Window Open" : "Window Expired"}
                </p>
                <p className="text-[11px] text-muted-foreground">
                  {selectedConv.window_expires_at
                    ? withinWindow
                      ? `Expires ${formatDistanceToNow(parseISO(selectedConv.window_expires_at), { addSuffix: true })}`
                      : "Expired — send a template to re-engage"
                    : "No active window"
                  }
                </p>
              </div>

              {/* Recent campaigns */}
              {recentCampaigns.length > 0 && (
                <div>
                  <p className="text-[10px] text-muted-foreground/60 uppercase tracking-wide mb-2">Recent Campaigns</p>
                  <div className="space-y-1.5">
                    {(recentCampaigns as Array<{ campaigns?: { name?: string; status?: string }; status?: string; sent_at?: string }>).map((cm, i) => (
                      <div key={i} className="flex items-center justify-between text-xs bg-muted/20 rounded-lg px-2.5 py-1.5">
                        <span className="truncate flex-1 mr-2">{cm.campaigns?.name || "Campaign"}</span>
                        <span className={`flex-shrink-0 text-[10px] font-medium ${
                          cm.status === "delivered" ? "text-emerald-400" :
                          cm.status === "read" ? "text-blue-400" :
                          cm.status === "failed" ? "text-red-400" :
                          "text-muted-foreground"
                        }`}>{cm.status}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Quick actions */}
              <div>
                <p className="text-[10px] text-muted-foreground/60 uppercase tracking-wide mb-2">Quick Actions</p>
                <div className="grid grid-cols-2 gap-1.5">
                  {[
                    { label: "View Contact", icon: ExternalLink, href: `/contacts` },
                    { label: "CRM Pipeline", icon: Zap, href: `/crm` },
                    { label: "Send Template", icon: MessageSquare, action: () => setShowTemplatePicker(true) },
                    { label: "Copy Phone", icon: Copy, action: () => { navigator.clipboard.writeText(selectedConv.contact_phone); toast.success("Copied!"); } },
                  ].map(item => (
                    item.href ? (
                      <Link
                        key={item.label}
                        href={item.href}
                        className="flex items-center gap-1.5 px-2.5 py-2 rounded-xl border border-border/40 hover:bg-accent text-xs transition-colors"
                      >
                        <item.icon className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                        <span className="truncate">{item.label}</span>
                      </Link>
                    ) : (
                      <button
                        key={item.label}
                        onClick={item.action}
                        className="flex items-center gap-1.5 px-2.5 py-2 rounded-xl border border-border/40 hover:bg-accent text-xs transition-colors"
                      >
                        <item.icon className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                        <span className="truncate">{item.label}</span>
                      </button>
                    )
                  ))}
                </div>
              </div>

              {/* Notes */}
              {selectedConv.contacts?.crm_notes && (
                <div>
                  <p className="text-[10px] text-muted-foreground/60 uppercase tracking-wide mb-1.5">Notes</p>
                  <p className="text-xs text-muted-foreground bg-muted/20 rounded-xl p-3 border border-border/30 leading-relaxed">
                    {selectedConv.contacts.crm_notes}
                  </p>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
