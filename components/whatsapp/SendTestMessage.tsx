"use client";

/**
 * SendTestMessage — small inline panel for sending a trial WhatsApp
 * message from any connected number. Used on `/numbers` after a fresh
 * connection so users can verify their integration in one click.
 */

import { useEffect, useState } from "react";
import { Send, Loader2, CheckCircle2, AlertCircle, MessageCircle } from "lucide-react";
import { toast } from "sonner";

interface Account {
  id: string;
  displayPhoneNumber: string;
  businessName: string | null;
  status: string;
}

interface Props {
  /** Optionally pre-select a specific accountId. */
  defaultAccountId?: string;
  /** Pass a list to skip the /api/meta/accounts fetch. */
  accounts?: Account[];
}

export function SendTestMessage({ defaultAccountId, accounts: accountsProp }: Props): JSX.Element {
  const [accounts, setAccounts]       = useState<Account[]>(accountsProp ?? []);
  const [accountId, setAccountId]     = useState<string>(defaultAccountId ?? "");
  const [to, setTo]                   = useState("");
  const [kind, setKind]               = useState<"template" | "text">("template");
  const [templateName, setTemplateName] = useState("hello_world");
  const [language, setLanguage]       = useState("en_US");
  const [text, setText]               = useState("Hello from WASend! 👋");
  const [sending, setSending]         = useState(false);
  const [result, setResult]           = useState<{ ok: boolean; message: string; waMessageId?: string } | null>(null);

  useEffect(() => {
    if (accountsProp) return;
    fetch("/api/meta/accounts")
      .then((r) => r.json())
      .then((data: { accounts?: Account[] }) => {
        const list = (data.accounts ?? []).map((a) => ({
          id: a.id,
          displayPhoneNumber: a.displayPhoneNumber,
          businessName: a.businessName,
          status: a.status,
        }));
        setAccounts(list);
        if (!accountId && list[0]) setAccountId(list[0].id);
      })
      .catch(() => undefined);
  }, [accountsProp, accountId]);

  const canSend = accountId && to.replace(/[^0-9]/g, "").length >= 8 && !sending;

  const send = async () => {
    setSending(true);
    setResult(null);
    try {
      const body: Record<string, unknown> = {
        accountId,
        to: to.replace(/[^0-9]/g, ""),
        kind,
      };
      if (kind === "template") {
        body.templateName = templateName.trim();
        body.languageCode = language.trim();
      } else {
        body.body = text;
      }

      const res = await fetch("/api/meta/test-message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json()) as { ok?: boolean; waMessageId?: string; error?: string };
      if (!res.ok) throw new Error(data.error || "Send failed");

      setResult({
        ok: true,
        message: `Sent to +${body.to as string}`,
        waMessageId: data.waMessageId,
      });
      toast.success("Test message sent");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Send failed";
      setResult({ ok: false, message: msg });
      toast.error(msg);
    } finally {
      setSending(false);
    }
  };

  if (!accounts.length) {
    return (
      <div className="rounded-2xl border border-border/60 bg-card p-5 text-sm text-muted-foreground">
        Connect a WhatsApp number above to enable test messages.
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-border/60 bg-card p-5">
      <div className="mb-4 flex items-center gap-2">
        <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-500">
          <MessageCircle className="h-4 w-4" />
        </span>
        <div>
          <h3 className="text-sm font-semibold leading-tight">Send a test message</h3>
          <p className="text-xs text-muted-foreground">
            Verify your integration by sending a real WhatsApp message right now.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="block sm:col-span-2">
          <span className="mb-1.5 block text-xs font-medium text-muted-foreground">From</span>
          <select
            className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm outline-none focus:border-emerald-500/60 focus:ring-2 focus:ring-emerald-500/20"
            value={accountId}
            onChange={(e) => setAccountId(e.target.value)}
          >
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.displayPhoneNumber} {a.businessName ? `— ${a.businessName}` : ""}
                {a.status !== "active" ? ` (${a.status})` : ""}
              </option>
            ))}
          </select>
        </label>

        <label className="block sm:col-span-2">
          <span className="mb-1.5 block text-xs font-medium text-muted-foreground">To (E.164, e.g. 919876543210)</span>
          <input
            type="tel"
            inputMode="numeric"
            placeholder="9198xxxxxxxx"
            className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm outline-none focus:border-emerald-500/60 focus:ring-2 focus:ring-emerald-500/20"
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
        </label>

        <label className="block">
          <span className="mb-1.5 block text-xs font-medium text-muted-foreground">Message type</span>
          <div className="flex rounded-xl border border-border bg-background p-1">
            <button
              type="button"
              onClick={() => setKind("template")}
              className={`flex-1 rounded-lg px-3 py-1.5 text-xs font-medium ${
                kind === "template" ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" : "text-muted-foreground"
              }`}
            >
              Template
            </button>
            <button
              type="button"
              onClick={() => setKind("text")}
              className={`flex-1 rounded-lg px-3 py-1.5 text-xs font-medium ${
                kind === "text" ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" : "text-muted-foreground"
              }`}
            >
              Text (24h window)
            </button>
          </div>
        </label>

        {kind === "template" ? (
          <div className="grid grid-cols-2 gap-3 sm:col-span-1">
            <label className="block">
              <span className="mb-1.5 block text-xs font-medium text-muted-foreground">Template</span>
              <input
                className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm outline-none focus:border-emerald-500/60 focus:ring-2 focus:ring-emerald-500/20"
                value={templateName}
                onChange={(e) => setTemplateName(e.target.value)}
              />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-xs font-medium text-muted-foreground">Language</span>
              <input
                className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm outline-none focus:border-emerald-500/60 focus:ring-2 focus:ring-emerald-500/20"
                value={language}
                onChange={(e) => setLanguage(e.target.value)}
              />
            </label>
          </div>
        ) : (
          <label className="block sm:col-span-1">
            <span className="mb-1.5 block text-xs font-medium text-muted-foreground">Body</span>
            <textarea
              rows={2}
              className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm outline-none focus:border-emerald-500/60 focus:ring-2 focus:ring-emerald-500/20"
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
          </label>
        )}
      </div>

      {result && (
        <div
          className={`mt-4 flex items-start gap-2 rounded-xl border p-3 text-sm ${
            result.ok
              ? "border-emerald-500/30 bg-emerald-500/5 text-emerald-700 dark:text-emerald-300"
              : "border-destructive/30 bg-destructive/5 text-destructive"
          }`}
        >
          {result.ok ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> : <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />}
          <div>
            <p className="font-medium">{result.message}</p>
            {result.waMessageId && (
              <p className="mt-0.5 font-mono text-xs opacity-70">wamid: {result.waMessageId}</p>
            )}
          </div>
        </div>
      )}

      <button
        type="button"
        disabled={!canSend}
        onClick={send}
        className="mt-4 inline-flex items-center justify-center gap-2 rounded-xl bg-[#25D366] px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#1DA851] disabled:cursor-not-allowed disabled:opacity-60"
      >
        {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        {sending ? "Sending…" : "Send test message"}
      </button>
    </div>
  );
}
