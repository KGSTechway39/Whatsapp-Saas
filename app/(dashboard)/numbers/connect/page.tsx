"use client";

/**
 * /numbers/connect — Connect WhatsApp number page.
 *
 * Mirrors AiSensy's "Get Setup" / Connect number wizard:
 *   • Big primary CTA opens EmbeddedSignupModal (Apply for WhatsApp Business API).
 *   • Underneath, a 5-step "Self-host setup" guide for teams running
 *     their own Meta app (Create Meta App → Configure Login → Whitelist
 *     URL → Add Env → Subscribe Webhook).
 *
 * On a successful signup we redirect to /numbers.
 */

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AppWindow,
  KeyRound,
  ShieldCheck,
  Webhook,
  Wrench,
  CheckCircle2,
  ChevronRight,
  Copy,
  ExternalLink,
  ArrowRight,
} from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/shared/PageHeader";
import { MetaConnectButton, type ConnectedAccount } from "@/components/whatsapp/MetaConnectButton";
import { SendTestMessage } from "@/components/whatsapp/SendTestMessage";

interface Step {
  key: string;
  title: string;
  description: string;
  icon: typeof Wrench;
  body: (helpers: { siteUrl: string; copy: (label: string, value: string) => void }) => JSX.Element;
}

export default function ConnectNumberPage(): JSX.Element {
  const router = useRouter();
  const [activeStep, setActiveStep] = useState(0);
  const [justConnected, setJustConnected] = useState<ConnectedAccount | null>(null);

  // Server and client must render the SAME initial siteUrl to avoid
  // hydration mismatch. We render the env default on first paint, then
  // upgrade to window.location.origin after mount.
  const ssrSiteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://your-app.example.com";
  const [siteUrl, setSiteUrl] = useState(ssrSiteUrl);
  useEffect(() => {
    if (typeof window !== "undefined") setSiteUrl(window.location.origin);
  }, []);

  const copy = (label: string, value: string) => {
    if (typeof navigator === "undefined") return;
    navigator.clipboard.writeText(value).then(
      () => toast.success(`${label} copied`),
      () => toast.error(`Couldn't copy ${label}`),
    );
  };

  const handleConnected = (acc: ConnectedAccount) => {
    // Keep the user here so they can send a trial message immediately.
    setJustConnected(acc);
  };

  // Suppress unused warning — we keep router for future "go to /numbers" CTAs.
  void router;

  const steps = useMemo<Step[]>(() => buildSteps(), []);
  const completed = activeStep === steps.length;

  return (
    <div className="max-w-3xl space-y-8">
      <PageHeader
        title="Connect WhatsApp Number"
        subtitle="One click via Meta's official Embedded Signup, or follow the self-host wizard below."
      />

      {justConnected && (
        <section className="rounded-2xl border border-emerald-500/30 bg-emerald-500/5 p-5">
          <p className="text-sm font-semibold">
            ✓ Connected {justConnected.displayPhoneNumber}
            {justConnected.businessName ? ` — ${justConnected.businessName}` : ""}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Send a trial message below to verify your integration.
          </p>
          <div className="mt-4">
            <SendTestMessage defaultAccountId={justConnected.accountId} />
          </div>
        </section>
      )}

      {/* Primary CTA card */}
      <section className="rounded-2xl border border-border/60 bg-card p-6 shadow-sm">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold">Apply for WhatsApp Business API</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Continue with Meta&apos;s official Embedded Signup. We&apos;ll handle the OAuth
              dance, encrypt your token, and subscribe webhooks automatically.
            </p>
          </div>
          <MetaConnectButton
            label="Connect WhatsApp"
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#25D366] px-5 py-3 font-semibold text-white transition-colors hover:bg-[#1DA851] sm:w-auto"
            onConnected={handleConnected}
            onMigrate={() => toast.info("Migration flow coming soon — contact support.")}
          />
        </div>
      </section>

      {/* Setup wizard — collapsible stepper */}
      <section>
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold">Self-host setup (optional)</h2>
            <p className="text-sm text-muted-foreground">
              Configure your own Meta app to support Embedded Signup. Skip if you&apos;re
              connecting via the button above.
            </p>
          </div>
          {completed && (
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-500">
              <CheckCircle2 className="w-3.5 h-3.5" /> All steps complete
            </span>
          )}
        </div>

        <ol className="space-y-3">
          {steps.map((step, i) => {
            const status: "done" | "active" | "pending" =
              i < activeStep ? "done" : i === activeStep ? "active" : "pending";
            return (
              <li
                key={step.key}
                className={`overflow-hidden rounded-2xl border ${
                  status === "active"
                    ? "border-emerald-500/40 bg-emerald-500/5"
                    : "border-border/60 bg-card"
                }`}
              >
                <button
                  type="button"
                  onClick={() => setActiveStep(i)}
                  className="flex w-full items-center gap-4 p-5 text-left"
                  aria-expanded={status === "active"}
                >
                  <span
                    className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-semibold ${
                      status === "done"
                        ? "bg-emerald-500 text-white"
                        : status === "active"
                        ? "bg-emerald-500/10 text-emerald-500"
                        : "bg-muted text-muted-foreground"
                    }`}
                  >
                    {status === "done" ? <CheckCircle2 className="w-4 h-4" /> : i + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <step.icon className="w-4 h-4 text-muted-foreground" />
                      <h3 className="text-sm font-semibold">{step.title}</h3>
                    </div>
                    <p className="mt-0.5 text-xs text-muted-foreground">{step.description}</p>
                  </div>
                  <ChevronRight
                    className={`w-4 h-4 text-muted-foreground transition-transform ${
                      status === "active" ? "rotate-90" : ""
                    }`}
                  />
                </button>

                {status === "active" && (
                  <div className="border-t border-border/40 px-5 pb-5 pt-4">
                    {step.body({ siteUrl, copy })}
                    <div className="mt-5 flex justify-between gap-3">
                      <button
                        type="button"
                        disabled={i === 0}
                        onClick={() => setActiveStep(i - 1)}
                        className="rounded-lg px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        Back
                      </button>
                      <button
                        type="button"
                        onClick={() => setActiveStep(i + 1)}
                        className="inline-flex items-center gap-2 rounded-lg bg-foreground px-3 py-2 text-sm font-medium text-background transition-colors hover:opacity-90"
                      >
                        {i === steps.length - 1 ? "Finish" : "Mark complete"}
                        <ArrowRight className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      </section>
    </div>
  );

  function buildSteps(): Step[] {
    return [
      {
        key: "create-app",
        title: "Create Meta App",
        description: "Spin up a Business-type Meta App with WhatsApp & Facebook Login products.",
        icon: AppWindow,
        body: () => (
          <div className="space-y-3 text-sm">
            <p className="text-muted-foreground">
              Open the Meta App Dashboard and create a new <strong>Business</strong> app. Add the{" "}
              <strong>WhatsApp</strong> and <strong>Facebook Login for Business</strong> products.
            </p>
            <a
              href="https://developers.facebook.com/apps/"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-emerald-500 hover:underline"
            >
              Open Meta App Dashboard <ExternalLink className="w-3.5 h-3.5" />
            </a>
          </div>
        ),
      },
      {
        key: "fb-login",
        title: "Configure Facebook Login",
        description: "Create an Embedded Signup configuration tied to whatsapp_business_management.",
        icon: KeyRound,
        body: () => (
          <div className="space-y-3 text-sm">
            <p className="text-muted-foreground">
              Inside your app, go to <strong>Facebook Login for Business → Configurations → New</strong>.
              Choose the <em>WhatsApp Embedded Signup</em> use case and grant these scopes:
            </p>
            <ul className="ml-5 list-disc space-y-1 text-muted-foreground">
              <li><code className="font-mono text-xs">whatsapp_business_management</code></li>
              <li><code className="font-mono text-xs">whatsapp_business_messaging</code></li>
              <li><code className="font-mono text-xs">business_management</code></li>
            </ul>
            <p className="text-muted-foreground">
              Copy the resulting <strong>Configuration ID</strong> — you&apos;ll paste it into env vars in step 4.
            </p>
          </div>
        ),
      },
      {
        key: "whitelist",
        title: "Whitelist Redirect URL",
        description: "Add this app's origin to Allowed Domains in Facebook Login settings.",
        icon: ShieldCheck,
        body: ({ siteUrl, copy }) => (
          <div className="space-y-3 text-sm">
            <p className="text-muted-foreground">
              Under <strong>Facebook Login → Settings → Allowed Domains for the JavaScript SDK</strong>,
              add this app&apos;s origin:
            </p>
            <div className="flex items-center justify-between gap-2 rounded-xl border border-border/60 bg-background p-3">
              <code className="truncate font-mono text-xs">{siteUrl}</code>
              <button
                type="button"
                onClick={() => copy("Origin", siteUrl)}
                className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                aria-label="Copy origin"
              >
                <Copy className="w-3.5 h-3.5" />
              </button>
            </div>
            <p className="text-muted-foreground">
              For production, also add your custom domain (e.g. <code className="font-mono text-xs">app.your-brand.com</code>).
            </p>
          </div>
        ),
      },
      {
        key: "env",
        title: "Add Environment Variables",
        description: "Set NEXT_PUBLIC_META_APP_ID, NEXT_PUBLIC_META_CONFIGURATION_ID, META_APP_SECRET.",
        icon: Wrench,
        body: ({ copy }) => {
          const envSnippet =
`NEXT_PUBLIC_META_APP_ID=...
NEXT_PUBLIC_META_CONFIGURATION_ID=...
META_APP_SECRET=...
WHATSAPP_WEBHOOK_VERIFY_TOKEN=replace-with-32-char-random
ENCRYPTION_KEY=replace-with-64-hex-chars`;
          return (
            <div className="space-y-3 text-sm">
              <p className="text-muted-foreground">
                Add these to <code className="font-mono text-xs">.env.local</code> (and to your hosting provider for production):
              </p>
              <pre className="overflow-x-auto rounded-xl border border-border/60 bg-background p-3 text-xs leading-relaxed">
                {envSnippet}
              </pre>
              <button
                type="button"
                onClick={() => copy("Env snippet", envSnippet)}
                className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-1.5 text-xs text-muted-foreground hover:bg-muted"
              >
                <Copy className="w-3.5 h-3.5" /> Copy snippet
              </button>
            </div>
          );
        },
      },
      {
        key: "subscribe-webhook",
        title: "Subscribe Webhook",
        description: "Point Meta's webhooks at /api/webhooks/whatsapp and verify the token.",
        icon: Webhook,
        body: ({ siteUrl, copy }) => {
          const url = `${siteUrl}/api/webhooks/whatsapp`;
          return (
            <div className="space-y-3 text-sm">
              <p className="text-muted-foreground">
                In your Meta app under <strong>WhatsApp → Configuration → Webhook</strong>, set the
                callback URL to:
              </p>
              <div className="flex items-center justify-between gap-2 rounded-xl border border-border/60 bg-background p-3">
                <code className="truncate font-mono text-xs">{url}</code>
                <button
                  type="button"
                  onClick={() => copy("Webhook URL", url)}
                  className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                  aria-label="Copy webhook URL"
                >
                  <Copy className="w-3.5 h-3.5" />
                </button>
              </div>
              <p className="text-muted-foreground">
                The verify token must match <code className="font-mono text-xs">WHATSAPP_WEBHOOK_VERIFY_TOKEN</code>.
                Subscribe these fields: <code className="font-mono text-xs">messages</code>,{" "}
                <code className="font-mono text-xs">message_template_status_update</code>,{" "}
                <code className="font-mono text-xs">account_update</code>,{" "}
                <code className="font-mono text-xs">phone_number_quality_update</code>.
              </p>
            </div>
          );
        },
      },
    ];
  }
}
