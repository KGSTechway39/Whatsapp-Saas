"use client";

import { useState, useEffect, useCallback } from "react";
import { toast } from "sonner";
import {
  CheckCircle2,
  Loader2,
  AlertCircle,
  Smartphone,
  ExternalLink,
  ArrowRight,
  Copy,
  Check,
  ChevronDown,
} from "lucide-react";
import Link from "next/link";

// FB SDK types live in `types/facebook-sdk.d.ts` (single source of truth).

export interface ConnectedAccount {
  id: string;
  displayPhoneNumber: string;
  businessName: string | null;
  wabaId: string;
  status: string;
  updated?: boolean;
}

interface Props {
  onConnected?: (accounts: ConnectedAccount[]) => void;
  /** If set, renders only the button + inline success; no surrounding card chrome */
  compact?: boolean;
}

export function ConnectWhatsApp({ onConnected, compact = false }: Props) {
  const [sdkReady, setSdkReady]       = useState(false);
  const [connecting, setConnecting]   = useState(false);
  const [connected, setConnected]     = useState<ConnectedAccount[]>([]);
  const [error, setError]             = useState<string | null>(null);

  const APP_ID    = process.env.NEXT_PUBLIC_META_APP_ID;
  const CONFIG_ID = process.env.NEXT_PUBLIC_META_CONFIG_ID;
  const configured = !!(APP_ID && CONFIG_ID && APP_ID !== "your_meta_app_id");

  const initFB = useCallback(() => {
    if (!APP_ID || !configured) return;

    window.fbAsyncInit = () => {
      window.FB?.init({
        appId: APP_ID,
        autoLogAppEvents: true,
        xfbml: true,
        version: "v21.0",
      });
      setSdkReady(true);
    };

    if (document.getElementById("facebook-jssdk")) {
      // SDK script already present; mark ready if FB is already initialised
      if (window.FB) setSdkReady(true);
      return;
    }

    const script = document.createElement("script");
    script.id    = "facebook-jssdk";
    script.src   = "https://connect.facebook.net/en_US/sdk.js";
    script.async = true;
    script.defer = true;
    document.body.appendChild(script);
  }, [APP_ID, configured]);

  useEffect(() => {
    initFB();
  }, [initFB]);

  const launchEmbeddedSignup = () => {
    if (!sdkReady || !CONFIG_ID || !window.FB) return;
    setError(null);
    setConnecting(true);

    window.FB.login(
      async (response) => {
        if (!response.authResponse?.code) {
          setConnecting(false);
          if (response.status !== "unknown") {
            setError("Connection cancelled or failed. Please try again.");
          }
          return;
        }

        const { code, waba_id, phone_number_id } = response.authResponse;

        try {
          const res = await fetch("/api/whatsapp/embedded-signup", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              code,
              wabaId: waba_id,
              phoneNumberId: phone_number_id,
            }),
          });

          const data = await res.json();
          if (!res.ok) throw new Error(data.error ?? "Connection failed");

          const accounts = data.connected as ConnectedAccount[];
          setConnected(accounts);
          toast.success(
            accounts.length === 1
              ? "WhatsApp number connected!"
              : `${accounts.length} numbers connected!`
          );
          onConnected?.(accounts);
        } catch (err) {
          const msg = err instanceof Error ? err.message : "Connection failed";
          setError(msg);
          toast.error(msg);
        } finally {
          setConnecting(false);
        }
      },
      {
        config_id: CONFIG_ID,
        response_type: "code",
        override_default_response_type: true,
        extras: { sessionInfoVersion: 2 },
      }
    );
  };

  // ── Success state ──────────────────────────────────────────────────────────
  if (connected.length > 0) {
    return (
      <div className={compact ? "" : "bg-card rounded-2xl border border-border/50 p-8 text-center"}>
        <div className="w-16 h-16 rounded-full bg-emerald-500/10 flex items-center justify-center mx-auto mb-4">
          <CheckCircle2 className="w-8 h-8 text-emerald-400" />
        </div>
        <h3 className="text-lg font-bold mb-1">
          {connected.length === 1 ? "Number Connected!" : `${connected.length} Numbers Connected!`}
        </h3>
        <p className="text-sm text-muted-foreground mb-6">
          Your WhatsApp Business account is ready to use.
        </p>

        <div className="space-y-3 mb-8 text-left">
          {connected.map((acc) => (
            <div
              key={acc.id}
              className="flex items-center gap-3 bg-muted/50 rounded-xl p-4"
            >
              <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                <Smartphone className="w-5 h-5 text-primary" />
              </div>
              <div className="min-w-0">
                <p className="font-semibold text-sm truncate">{acc.displayPhoneNumber}</p>
                {acc.businessName && (
                  <p className="text-xs text-muted-foreground truncate">{acc.businessName}</p>
                )}
                {acc.updated && (
                  <span className="text-xs text-amber-400">Token refreshed</span>
                )}
              </div>
              <CheckCircle2 className="w-4 h-4 text-emerald-400 ml-auto shrink-0" />
            </div>
          ))}
        </div>

        <div className="flex gap-3 justify-center">
          <Link
            href="/numbers"
            className="flex items-center gap-2 wa-gradient text-white font-semibold px-5 py-2.5 rounded-xl hover:opacity-90 transition-all text-sm"
          >
            View Numbers <ArrowRight className="w-4 h-4" />
          </Link>
          <Link
            href="/dashboard"
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl border border-border hover:bg-accent text-sm font-medium transition-colors"
          >
            Dashboard
          </Link>
        </div>
      </div>
    );
  }

  // ── Unconfigured: inline setup wizard ─────────────────────────────────────
  if (!configured) {
    return <SetupWizard compact={compact} />;
  }

  // ── Connect button ─────────────────────────────────────────────────────────
  return (
    <div className={compact ? "" : "bg-card rounded-2xl border border-border/50 p-8"}>
      {!compact && (
        <div className="text-center mb-8">
          <div className="w-16 h-16 rounded-2xl bg-[#25D366]/10 flex items-center justify-center mx-auto mb-4">
            <WhatsAppIcon className="w-8 h-8 fill-[#25D366]" />
          </div>
          <h3 className="text-lg font-bold mb-2">Connect via Meta Embedded Signup</h3>
          <p className="text-sm text-muted-foreground">
            Securely connect your WhatsApp Business Account. You&apos;ll be guided through
            Meta&apos;s official setup flow.
          </p>
        </div>
      )}

      {error && (
        <div className="flex items-start gap-3 bg-destructive/10 border border-destructive/20 rounded-xl p-4 mb-6">
          <AlertCircle className="w-4 h-4 text-destructive shrink-0 mt-0.5" />
          <p className="text-sm text-destructive">{error}</p>
        </div>
      )}

      <button
        onClick={launchEmbeddedSignup}
        disabled={connecting || !sdkReady}
        className="w-full flex items-center justify-center gap-3 wa-gradient text-white font-semibold px-6 py-4 rounded-xl hover:opacity-90 transition-all disabled:opacity-50 disabled:cursor-not-allowed text-base"
      >
        {connecting || !sdkReady ? (
          <>
            <Loader2 className="w-5 h-5 animate-spin" />
            {connecting ? "Connecting…" : "Loading…"}
          </>
        ) : (
          <>
            <FacebookIcon className="w-5 h-5 fill-white" />
            Continue with Meta
          </>
        )}
      </button>
    </div>
  );
}

// ─── Setup Wizard (shown when env vars not set) ──────────────────────────
function SetupWizard({ compact }: { compact: boolean }) {
  const [openStep, setOpenStep] = useState<number>(1);
  const redirectUri = typeof window !== "undefined"
    ? `${window.location.origin}/api/auth/google/callback`
    : "";
  const webhookUrl = typeof window !== "undefined"
    ? `${window.location.origin}/api/webhook/whatsapp`
    : "";
  const oauthRedirect = typeof window !== "undefined"
    ? `${window.location.origin}/api/whatsapp/embedded-signup`
    : "";

  const envSnippet =
`# Meta — get from https://developers.facebook.com/apps
NEXT_PUBLIC_META_APP_ID=1234567890
NEXT_PUBLIC_META_CONFIG_ID=987654321
META_APP_ID=1234567890
META_APP_SECRET=your_meta_app_secret
WHATSAPP_WEBHOOK_VERIFY_TOKEN=any_random_string`;

  const steps = [
    {
      n: 1,
      title: "Create a Meta app",
      body: (
        <>
          <p className="text-xs text-muted-foreground mb-2">
            Go to Meta&apos;s developer console and create a new app.
          </p>
          <ol className="text-xs text-muted-foreground space-y-1 list-decimal list-inside mb-3">
            <li>Open <a href="https://developers.facebook.com/apps" target="_blank" rel="noreferrer" className="text-primary hover:underline">developers.facebook.com/apps</a> → <strong>Create app</strong></li>
            <li>Use case: <strong>Other</strong> → Type: <strong>Business</strong></li>
            <li>Add product → <strong>WhatsApp</strong></li>
            <li>Add product → <strong>Facebook Login for Business</strong></li>
          </ol>
          <a href="https://developers.facebook.com/apps" target="_blank" rel="noreferrer"
            className="inline-flex items-center gap-1.5 text-xs bg-[#1877F2] text-white px-3 py-1.5 rounded-lg hover:opacity-90">
            Open Meta Console <ExternalLink className="w-3 h-3" />
          </a>
        </>
      ),
    },
    {
      n: 2,
      title: "Configure Facebook Login for Business",
      body: (
        <>
          <p className="text-xs text-muted-foreground mb-2">
            In your app, open <strong>Facebook Login for Business → Configurations</strong> and create one:
          </p>
          <ul className="text-xs text-muted-foreground space-y-1 list-disc list-inside mb-3">
            <li>Login type: <strong>Business login</strong></li>
            <li>Choose <strong>Tech provider</strong></li>
            <li>Permissions: <code className="bg-muted/50 px-1 rounded">whatsapp_business_management</code>, <code className="bg-muted/50 px-1 rounded">whatsapp_business_messaging</code>, <code className="bg-muted/50 px-1 rounded">business_management</code></li>
          </ul>
          <p className="text-xs text-muted-foreground">After creating, copy the <strong>Configuration ID</strong> — you&apos;ll need it in step 4.</p>
        </>
      ),
    },
    {
      n: 3,
      title: "Whitelist OAuth redirect",
      body: (
        <>
          <p className="text-xs text-muted-foreground mb-2">
            In <strong>Facebook Login for Business → Settings</strong>, add this URL under <em>Valid OAuth Redirect URIs</em>:
          </p>
          <CopyBlock value={oauthRedirect} />
          <p className="text-[11px] text-muted-foreground mt-2">
            Also add your domain to <em>App Domains</em>: <code className="bg-muted/50 px-1 rounded">{typeof window !== "undefined" ? window.location.host : ""}</code>
          </p>
        </>
      ),
    },
    {
      n: 4,
      title: "Add env vars to .env.local",
      body: (
        <>
          <p className="text-xs text-muted-foreground mb-2">
            Copy your <strong>App ID</strong> + <strong>App Secret</strong> (App settings → Basic) and the <strong>Configuration ID</strong> from step 2.
            Append to <code className="bg-muted/50 px-1 rounded">.env.local</code>:
          </p>
          <CopyBlock value={envSnippet} multiline />
          <p className="text-[11px] text-amber-400 mt-2">
            ⚠ Restart the dev server after editing <code className="bg-muted/50 px-1 rounded">.env.local</code> — Next.js reads it at boot.
          </p>
        </>
      ),
    },
    {
      n: 5,
      title: "Subscribe webhook in Meta",
      body: (
        <>
          <p className="text-xs text-muted-foreground mb-2">
            In <strong>WhatsApp → Configuration</strong>, set the callback URL + verify token:
          </p>
          <p className="text-[11px] text-muted-foreground mb-1">Callback URL</p>
          <CopyBlock value={webhookUrl} />
          <p className="text-[11px] text-muted-foreground mt-2 mb-1">Verify token (must match <code className="bg-muted/50 px-1 rounded">WHATSAPP_WEBHOOK_VERIFY_TOKEN</code>)</p>
          <CopyBlock value="any_random_string" />
          <p className="text-[11px] text-muted-foreground mt-2">Subscribe to fields: <strong>messages, message_template_status_update, account_alerts</strong>.</p>
        </>
      ),
    },
  ];

  return (
    <div className={compact ? "" : "bg-card rounded-2xl border border-border/50 p-6"}>
      <div className="flex items-start gap-3 mb-4 p-3 bg-amber-500/5 border border-amber-500/20 rounded-xl">
        <AlertCircle className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
        <div className="text-xs">
          <p className="font-semibold text-amber-400 mb-0.5">Meta app not configured yet</p>
          <p className="text-muted-foreground">Follow the 5 steps below — most users complete this in under 10 minutes.</p>
        </div>
      </div>

      <div className="space-y-2">
        {steps.map((step) => (
          <div key={step.n} className="border border-border/50 rounded-xl overflow-hidden">
            <button
              onClick={() => setOpenStep(openStep === step.n ? 0 : step.n)}
              className="w-full flex items-center gap-3 p-3 hover:bg-muted/30 transition-colors"
            >
              <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${
                openStep === step.n ? "wa-gradient text-white" : "bg-muted/40 text-muted-foreground"
              }`}>
                {step.n}
              </div>
              <p className="text-sm font-semibold flex-1 text-left">{step.title}</p>
              <ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform ${openStep === step.n ? "rotate-180" : ""}`} />
            </button>
            {openStep === step.n && (
              <div className="px-4 pb-4 pl-[52px]">
                {step.body}
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="flex items-center gap-2 mt-4 pt-4 border-t border-border/40">
        <a
          href="https://developers.facebook.com/docs/whatsapp/embedded-signup"
          target="_blank"
          rel="noreferrer"
          className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
        >
          Full Meta docs <ExternalLink className="w-3 h-3" />
        </a>
        <span className="text-xs text-muted-foreground">·</span>
        <a
          href="/docs/embedded-signup.md"
          target="_blank"
          rel="noreferrer"
          className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
        >
          Internal architecture guide
        </a>
      </div>
    </div>
  );
}

function CopyBlock({ value, multiline = false }: { value: string; multiline?: boolean }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="bg-[#0d1117] border border-border/40 rounded-lg flex items-start gap-2 p-2.5">
      <pre className={`flex-1 text-[11px] font-mono text-[#c9d1d9] overflow-x-auto ${multiline ? "whitespace-pre" : "whitespace-nowrap"}`}><code>{value}</code></pre>
      <button onClick={copy} className="flex-shrink-0 p-1 rounded hover:bg-white/5 text-muted-foreground hover:text-foreground transition-colors">
        {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
      </button>
    </div>
  );
}

// ─── Inline SVG icons (no extra deps) ────────────────────────────────────────
function WhatsAppIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className}>
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z" />
    </svg>
  );
}

function FacebookIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className}>
      <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
    </svg>
  );
}
