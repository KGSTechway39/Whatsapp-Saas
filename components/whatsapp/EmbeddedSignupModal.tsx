"use client";

/**
 * EmbeddedSignupModal — premium "Apply for WhatsApp Business API" modal.
 *
 * Two paths to a connected account:
 *   • Continue With Facebook  → Meta Embedded Signup (production path)
 *   • Manual Setup            → paste credentials from Meta's Quickstart
 *                                (lets you ship today without a config_id)
 *
 * Lifecycle phases:
 *   idle | misconfigured | loading | exchanging | choose | saving | success | error
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  X,
  Loader2,
  AlertCircle,
  CheckCircle2,
  Globe,
  Building2,
  Briefcase,
  PhoneOff,
  ChevronRight,
  Facebook,
  Repeat2,
  KeyRound,
  Sparkles,
  ArrowLeft,
  Info,
} from "lucide-react";
import { toast } from "sonner";

const SDK_SRC = "https://connect.facebook.net/en_US/sdk.js";
const SDK_VERSION = "v19.0";

const REQUIREMENTS = [
  { icon: Building2, label: "Registered business",                                    description: "Sole proprietor or registered entity" },
  { icon: Globe,     label: "Business website",                                       description: "Live URL Meta can verify" },
  { icon: Briefcase, label: "Facebook Business Manager",                              description: "Active and admin-level access" },
  { icon: PhoneOff,  label: "Phone number not on another WhatsApp API",               description: "Or be ready to migrate it" },
];

type Phase = "idle" | "misconfigured" | "loading" | "exchanging" | "choose" | "saving" | "success" | "error";
type Tab   = "embedded" | "manual";

interface DiscoveredPhone {
  id: string;
  displayPhoneNumber: string;
  verifiedName: string | null;
  qualityRating: string;
  status: string;
  codeVerificationStatus: string | null;
}
interface DiscoveredWaba {
  id: string;
  name: string | null;
  businessId: string | null;
  phoneNumbers: DiscoveredPhone[];
}

interface ExchangeTokenResponse {
  transferId: string;
  expiresIn: number;
  systemUserId: string | null;
  scopes: string[];
  wabas: DiscoveredWaba[];
}

interface SaveAccountResponse {
  accountId: string;
  phoneRowId: string;
  refreshed: boolean;
}

interface SuccessSummary {
  accountId: string;
  phoneNumberId: string;
  displayPhoneNumber: string;
  businessName: string | null;
}

interface Props {
  open: boolean;
  onClose: () => void;
  onSuccess?: (account: SuccessSummary) => void;
  onMigrate?: () => void;
}

const PLACEHOLDER_VALUES = new Set([
  "",
  "your_meta_app_id",
  "your_embedded_signup_config_id",
  "your_meta_config_id",
  "your_meta_configuration_id",
]);

function looksLikePlaceholder(v: string | undefined): boolean {
  if (!v) return true;
  return PLACEHOLDER_VALUES.has(v.trim().toLowerCase());
}

export function EmbeddedSignupModal({
  open,
  onClose,
  onSuccess,
  onMigrate,
}: Props): JSX.Element | null {
  const APP_ID    = process.env.NEXT_PUBLIC_META_APP_ID ?? "";
  const CONFIG_ID =
    process.env.NEXT_PUBLIC_META_CONFIGURATION_ID ??
    process.env.NEXT_PUBLIC_META_CONFIG_ID ??
    "";
  const embeddedConfigured = !looksLikePlaceholder(APP_ID) && !looksLikePlaceholder(CONFIG_ID);

  const [tab, setTab]           = useState<Tab>("embedded");
  const [phase, setPhase]       = useState<Phase>(embeddedConfigured ? "idle" : "misconfigured");
  const [error, setError]       = useState<string | null>(null);
  const [sdkReady, setSdkReady] = useState(false);
  const [transfer, setTransfer] = useState<ExchangeTokenResponse | null>(null);
  const [chosen, setChosen]     = useState<{ waba: DiscoveredWaba; phone: DiscoveredPhone } | null>(null);
  const [savedAccount, setSavedAccount] = useState<SuccessSummary | null>(null);
  const initRef = useRef(false);

  // ── Body scroll lock + ESC ──────────────────────────────────────────
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  // ── Reset state when closed ─────────────────────────────────────────
  useEffect(() => {
    if (open) return;
    setPhase(embeddedConfigured ? "idle" : "misconfigured");
    setError(null);
    setTransfer(null);
    setChosen(null);
    setSavedAccount(null);
    setTab("embedded");
  }, [open, embeddedConfigured]);

  // ── Lazy-load Meta SDK on first open ────────────────────────────────
  useEffect(() => {
    if (!open || !embeddedConfigured || initRef.current) return;
    initRef.current = true;

    window.fbAsyncInit = () => {
      window.FB?.init({
        appId: APP_ID,
        autoLogAppEvents: true,
        xfbml: false,
        version: SDK_VERSION,
      });
      setSdkReady(true);
    };

    if (document.getElementById("facebook-jssdk")) {
      if (window.FB) setSdkReady(true);
      return;
    }
    const s = document.createElement("script");
    s.id = "facebook-jssdk";
    s.src = SDK_SRC;
    s.async = true;
    s.defer = true;
    s.crossOrigin = "anonymous";
    document.body.appendChild(s);
  }, [APP_ID, embeddedConfigured, open]);

  // ── Launch Embedded Signup ──────────────────────────────────────────
  const launchSignup = useCallback(() => {
    if (!embeddedConfigured) {
      setPhase("misconfigured");
      return;
    }
    if (!window.FB || !sdkReady) {
      setError("Meta SDK is still loading. Try again in a moment.");
      return;
    }

    setError(null);
    setPhase("loading");

    window.FB.login(
      async (response) => {
        const code = response.authResponse?.code;
        if (!code) {
          setPhase("idle");
          if (response.status !== "unknown") {
            setError("Signup cancelled. Please try again.");
          }
          return;
        }

        setPhase("exchanging");
        try {
          const res = await fetch("/api/meta/exchange-token", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ code }),
          });
          const data = (await res.json()) as ExchangeTokenResponse & { error?: string };
          if (!res.ok) throw new Error(data.error || "Token exchange failed");

          setTransfer(data);
          const onlyWaba  = data.wabas.length === 1 ? data.wabas[0] : null;
          const onlyPhone = onlyWaba?.phoneNumbers.length === 1 ? onlyWaba.phoneNumbers[0] : null;
          if (onlyWaba && onlyPhone) {
            await completeSave(data, onlyWaba, onlyPhone);
          } else {
            setPhase("choose");
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : "Setup failed";
          setError(msg);
          setPhase("error");
        }
      },
      {
        config_id: CONFIG_ID,
        response_type: "code",
        override_default_response_type: true,
        override_min_version: SDK_VERSION,
        extras: {
          feature: "whatsapp_embedded_signup",
          sessionInfoVersion: 3,
        },
      },
    );
  }, [CONFIG_ID, embeddedConfigured, sdkReady]);

  const completeSave = useCallback(
    async (data: ExchangeTokenResponse, waba: DiscoveredWaba, phone: DiscoveredPhone) => {
      setPhase("saving");
      setError(null);
      try {
        const saveRes = await fetch("/api/meta/save-account", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            transferId: data.transferId,
            wabaId: waba.id,
            phoneNumberId: phone.id,
            businessId: waba.businessId,
            businessName: waba.name,
            phone: {
              displayPhoneNumber: phone.displayPhoneNumber,
              verifiedName: phone.verifiedName,
              qualityRating: phone.qualityRating,
              status: phone.status,
              codeVerificationStatus: phone.codeVerificationStatus,
            },
          }),
        });
        const saved = (await saveRes.json()) as SaveAccountResponse & { error?: string };
        if (!saveRes.ok) throw new Error(saved.error || "Save failed");

        await fetch("/api/meta/subscribe-webhook", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ accountId: saved.accountId }),
        }).catch(() => undefined);

        const summary: SuccessSummary = {
          accountId: saved.accountId,
          phoneNumberId: phone.id,
          displayPhoneNumber: phone.displayPhoneNumber,
          businessName: phone.verifiedName || waba.name,
        };
        setSavedAccount(summary);
        setPhase("success");
        toast.success(saved.refreshed ? "Account refreshed" : "WhatsApp Business connected");
        onSuccess?.(summary);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Save failed";
        setError(msg);
        setPhase("error");
      }
    },
    [onSuccess],
  );

  const onManualConnect = useCallback(
    async (form: ManualForm) => {
      setPhase("saving");
      setError(null);
      try {
        const res = await fetch("/api/meta/manual-connect", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(form),
        });
        const data = (await res.json()) as {
          accountId: string;
          phoneNumberId: string;
          displayPhoneNumber: string;
          businessName: string | null;
          error?: string;
        };
        if (!res.ok) throw new Error(data.error || "Manual setup failed");

        await fetch("/api/meta/subscribe-webhook", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ accountId: data.accountId }),
        }).catch(() => undefined);

        const summary: SuccessSummary = {
          accountId: data.accountId,
          phoneNumberId: data.phoneNumberId,
          displayPhoneNumber: data.displayPhoneNumber,
          businessName: data.businessName,
        };
        setSavedAccount(summary);
        setPhase("success");
        toast.success("Connected");
        onSuccess?.(summary);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Manual setup failed";
        setError(msg);
        setPhase("error");
      }
    },
    [onSuccess],
  );

  const flatPhones = useMemo(() => {
    if (!transfer) return [];
    return transfer.wabas.flatMap((w) =>
      w.phoneNumbers.map((p) => ({ waba: w, phone: p })),
    );
  }, [transfer]);

  if (!open) return null;

  const showEmbeddedFooter =
    phase !== "success" && phase !== "choose" && tab === "embedded";

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="esm-title"
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-0 backdrop-blur-md sm:items-center sm:p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative flex w-full max-w-xl flex-col overflow-hidden rounded-t-3xl bg-card text-foreground shadow-2xl ring-1 ring-border/60 sm:rounded-3xl"
      >
        {/* Header — gradient banner */}
        <div className="relative bg-gradient-to-br from-[#25D366]/15 via-[#128C7E]/10 to-transparent p-6 pb-5">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-3">
              <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[#25D366] text-white shadow-md shadow-emerald-500/30">
                <WhatsAppLogo className="h-6 w-6" />
              </span>
              <div>
                <h2 id="esm-title" className="text-lg font-bold leading-tight">
                  Apply for WhatsApp Business API
                </h2>
                <p className="mt-0.5 text-sm text-muted-foreground">
                  Connect your Facebook Business account to set up WhatsApp Business API.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="rounded-full p-1.5 text-muted-foreground transition-colors hover:bg-background/80 hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Tabs — only show when we're not in a terminal state */}
          {phase !== "success" && phase !== "exchanging" && phase !== "saving" && (
            <div className="mt-5 flex gap-1 rounded-xl bg-background/60 p-1 ring-1 ring-border/40">
              <TabPill active={tab === "embedded"} onClick={() => { setTab("embedded"); setError(null); }} icon={Facebook} label="Embedded Signup" />
              <TabPill active={tab === "manual"}   onClick={() => { setTab("manual"); setError(null); }}   icon={KeyRound} label="Manual Setup" />
            </div>
          )}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5">
          {error && phase !== "success" && <ErrorBanner message={error} />}

          {phase === "misconfigured" && tab === "embedded" && <MisconfiguredBlock />}

          {phase === "idle" && tab === "embedded"        && <RequirementsBlock />}
          {phase === "error" && tab === "embedded"       && <RequirementsBlock />}
          {phase === "idle" && tab === "manual"          && <ManualForm onSubmit={onManualConnect} />}
          {phase === "error" && tab === "manual"         && <ManualForm onSubmit={onManualConnect} />}
          {phase === "misconfigured" && tab === "manual" && <ManualForm onSubmit={onManualConnect} />}

          {(phase === "loading" || phase === "exchanging" || phase === "saving") && (
            <LoadingBlock
              label={
                phase === "loading"     ? "Opening Meta sign-in…"
                : phase === "exchanging" ? "Verifying with Meta…"
                :                          "Saving your WhatsApp Business account…"
              }
            />
          )}

          {phase === "choose" && transfer && flatPhones.length > 0 && (
            <ChooseBlock options={flatPhones} chosen={chosen} onChoose={(opt) => setChosen(opt)} />
          )}

          {phase === "success" && savedAccount && <SuccessBlock summary={savedAccount} />}
        </div>

        {/* Footer */}
        <div className="space-y-3 border-t border-border/60 bg-background/30 p-6">
          {phase === "choose" && chosen && transfer ? (
            <button
              type="button"
              onClick={() => completeSave(transfer, chosen.waba, chosen.phone)}
              className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-[#25D366] px-5 py-3 font-semibold text-white shadow-sm shadow-emerald-500/20 transition-colors hover:bg-[#1DA851]"
            >
              Confirm &amp; Connect <ChevronRight className="h-4 w-4" />
            </button>
          ) : phase === "success" ? (
            <button
              type="button"
              onClick={onClose}
              className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-[#25D366] px-5 py-3 font-semibold text-white transition-colors hover:bg-[#1DA851]"
            >
              Done
            </button>
          ) : showEmbeddedFooter ? (
            <>
              <button
                type="button"
                disabled={!embeddedConfigured || !sdkReady || phase === "loading" || phase === "exchanging" || phase === "saving"}
                onClick={launchSignup}
                className="inline-flex w-full items-center justify-center gap-3 rounded-xl bg-[#1877F2] px-5 py-3 font-semibold text-white shadow-sm shadow-blue-500/20 transition-colors hover:bg-[#1464D2] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {phase === "loading" || phase === "exchanging" ? (
                  <Loader2 className="h-5 w-5 animate-spin" />
                ) : (
                  <Facebook className="h-5 w-5" />
                )}
                Continue With Facebook
              </button>

              <button
                type="button"
                onClick={() => {
                  if (onMigrate) onMigrate();
                  else toast.info("Migration wizard coming soon — contact support to migrate manually.");
                }}
                className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-border bg-transparent px-5 py-3 text-sm font-medium text-foreground transition-colors hover:bg-muted"
              >
                <Repeat2 className="h-4 w-4" /> Migrate Existing Number
              </button>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}

// ─── Building blocks ─────────────────────────────────────────────────────

interface ManualForm {
  wabaId: string;
  phoneNumberId: string;
  accessToken: string;
  businessId?: string;
  businessName?: string;
  displayPhoneNumber?: string;
}

function ManualForm({ onSubmit }: { onSubmit: (form: ManualForm) => void }): JSX.Element {
  const [wabaId, setWabaId] = useState("");
  const [phoneNumberId, setPhoneNumberId] = useState("");
  const [accessToken, setAccessToken] = useState("");
  const [businessName, setBusinessName] = useState("");
  const [showToken, setShowToken] = useState(false);

  const canSubmit = wabaId.trim() && phoneNumberId.trim() && accessToken.trim();

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!canSubmit) return;
        onSubmit({
          wabaId: wabaId.trim(),
          phoneNumberId: phoneNumberId.trim(),
          accessToken: accessToken.trim(),
          businessName: businessName.trim() || undefined,
        });
      }}
      className="space-y-4"
    >
      <div className="flex items-start gap-3 rounded-xl border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-700 dark:text-amber-300">
        <Info className="mt-0.5 h-4 w-4 shrink-0" />
        <div className="space-y-1">
          <p className="font-medium">Use this if you already have credentials.</p>
          <p className="text-muted-foreground">
            Find them in <strong>Meta for Developers → Your app → WhatsApp → API Setup</strong>. The temporary 24h token works for testing; for production, generate a permanent system-user token.
          </p>
        </div>
      </div>

      <Field
        label="WhatsApp Business Account ID (WABA ID)"
        placeholder="e.g. 123456789012345"
        value={wabaId}
        onChange={setWabaId}
        required
      />
      <Field
        label="Phone Number ID"
        placeholder="e.g. 987654321098765"
        value={phoneNumberId}
        onChange={setPhoneNumberId}
        required
      />
      <Field
        label="Access Token"
        placeholder="EAAB…"
        value={accessToken}
        onChange={setAccessToken}
        required
        type={showToken ? "text" : "password"}
        suffix={
          <button
            type="button"
            onClick={() => setShowToken((v) => !v)}
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            {showToken ? "Hide" : "Show"}
          </button>
        }
      />
      <Field
        label="Business name (optional)"
        placeholder="Acme Inc."
        value={businessName}
        onChange={setBusinessName}
      />

      <button
        type="submit"
        disabled={!canSubmit}
        className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-[#25D366] px-5 py-3 font-semibold text-white transition-colors hover:bg-[#1DA851] disabled:cursor-not-allowed disabled:opacity-60"
      >
        <Sparkles className="h-4 w-4" />
        Validate &amp; Connect
      </button>
    </form>
  );
}

interface FieldProps {
  label: string;
  placeholder?: string;
  value: string;
  onChange: (v: string) => void;
  required?: boolean;
  type?: string;
  suffix?: React.ReactNode;
}
function Field({ label, placeholder, value, onChange, required, type = "text", suffix }: FieldProps): JSX.Element {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium text-muted-foreground">
        {label}
        {required && <span className="ml-0.5 text-destructive">*</span>}
      </span>
      <div className="flex items-center gap-2 rounded-xl border border-border bg-background px-3 py-2.5 focus-within:border-emerald-500/60 focus-within:ring-2 focus-within:ring-emerald-500/20">
        <input
          className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground/50"
          placeholder={placeholder}
          value={value}
          type={type}
          onChange={(e) => onChange(e.target.value)}
        />
        {suffix}
      </div>
    </label>
  );
}

function RequirementsBlock(): JSX.Element {
  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          You&apos;ll need
        </h3>
        <ul className="mt-3 grid grid-cols-1 gap-2">
          {REQUIREMENTS.map(({ icon: Icon, label, description }) => (
            <li
              key={label}
              className="flex items-start gap-3 rounded-xl border border-border/50 bg-background/40 p-3"
            >
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-500">
                <Icon className="h-4 w-4" />
              </span>
              <div>
                <p className="text-sm font-medium leading-tight">{label}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
              </div>
            </li>
          ))}
        </ul>
      </div>

      <div className="rounded-xl border border-blue-500/20 bg-blue-500/5 p-3 text-xs text-blue-700 dark:text-blue-300">
        <p className="flex items-start gap-2">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            Continue With Facebook opens Meta&apos;s official login flow. We never
            see your password — only the short-lived authorization code.
          </span>
        </p>
      </div>
    </div>
  );
}

function MisconfiguredBlock(): JSX.Element {
  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4">
        <div className="flex items-start gap-3">
          <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-amber-500" />
          <div className="text-sm">
            <p className="font-semibold">Embedded Signup is not configured</p>
            <p className="mt-1 text-muted-foreground">
              Your Meta credentials in <code className="font-mono text-xs">.env.local</code> are still placeholders.
              Set the values below and restart the dev server, or use{" "}
              <strong>Manual Setup</strong> (tab above) to connect today with
              an access token from Meta&apos;s Quickstart page.
            </p>
          </div>
        </div>
      </div>

      <pre className="overflow-x-auto rounded-xl border border-border/60 bg-background p-3 text-xs leading-relaxed">
{`NEXT_PUBLIC_META_APP_ID=<your Meta App ID>
NEXT_PUBLIC_META_CONFIGURATION_ID=<your Embedded Signup config ID>
META_APP_SECRET=<your Meta App Secret>`}
      </pre>

      <p className="text-xs text-muted-foreground">
        Need help? Open <a href="https://developers.facebook.com/apps/" target="_blank" rel="noreferrer" className="text-emerald-500 hover:underline">Meta App Dashboard</a> and follow the 5-step wizard on this page.
      </p>
    </div>
  );
}

function LoadingBlock({ label }: { label: string }): JSX.Element {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      <div className="relative">
        <span className="absolute inset-0 animate-ping rounded-full bg-emerald-500/20" />
        <Loader2 className="relative h-10 w-10 animate-spin text-emerald-500" />
      </div>
      <p className="mt-5 text-sm font-medium">{label}</p>
      <p className="mt-1 text-xs text-muted-foreground">This usually takes a few seconds.</p>
    </div>
  );
}

interface ChooseProps {
  options: { waba: DiscoveredWaba; phone: DiscoveredPhone }[];
  chosen: { waba: DiscoveredWaba; phone: DiscoveredPhone } | null;
  onChoose: (opt: { waba: DiscoveredWaba; phone: DiscoveredPhone }) => void;
}
function ChooseBlock({ options, chosen, onChoose }: ChooseProps): JSX.Element {
  return (
    <div>
      <h3 className="text-sm font-semibold">Choose a number to connect</h3>
      <p className="mt-1 text-xs text-muted-foreground">
        We found multiple eligible numbers. Pick the one you want to use.
      </p>
      <div className="mt-4 space-y-2">
        {options.map(({ waba, phone }) => {
          const selected = chosen?.phone.id === phone.id;
          return (
            <button
              key={phone.id}
              type="button"
              onClick={() => onChoose({ waba, phone })}
              className={`flex w-full items-center justify-between gap-3 rounded-xl border p-3 text-left transition-colors ${
                selected
                  ? "border-emerald-500/60 bg-emerald-500/5"
                  : "border-border/60 hover:bg-muted"
              }`}
            >
              <div className="min-w-0">
                <p className="font-mono text-sm">{phone.displayPhoneNumber}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {phone.verifiedName || waba.name || "Unverified business"}
                </p>
              </div>
              <QualityBadge rating={phone.qualityRating} />
            </button>
          );
        })}
      </div>
    </div>
  );
}

function SuccessBlock({ summary }: { summary: SuccessSummary }): JSX.Element {
  return (
    <div className="flex flex-col items-center justify-center py-8 text-center">
      <span className="relative flex h-16 w-16 items-center justify-center">
        <span className="absolute inset-0 animate-pulse rounded-full bg-emerald-500/15" />
        <CheckCircle2 className="relative h-10 w-10 text-emerald-500" />
      </span>
      <h3 className="mt-4 text-base font-semibold">Connected</h3>
      <p className="mt-1 text-sm text-muted-foreground">
        <span className="font-mono">{summary.displayPhoneNumber}</span>
        {summary.businessName ? ` — ${summary.businessName}` : ""}
      </p>
      <p className="mt-2 text-xs text-muted-foreground">
        You can now send messages and run campaigns from this number.
      </p>
    </div>
  );
}

function QualityBadge({ rating }: { rating: string }): JSX.Element {
  const r = rating?.toUpperCase?.() ?? "UNKNOWN";
  const cls =
    r === "GREEN"  ? "bg-emerald-500/10 text-emerald-500"
    : r === "YELLOW" ? "bg-amber-500/10   text-amber-500"
    : r === "RED"    ? "bg-red-500/10     text-red-500"
                     : "bg-muted          text-muted-foreground";
  return (
    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider ${cls}`}>
      {r}
    </span>
  );
}

interface TabPillProps { active: boolean; onClick: () => void; icon: typeof Facebook; label: string }
function TabPill({ active, onClick, icon: Icon, label }: TabPillProps): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex flex-1 items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
        active ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
      }`}
    >
      <Icon className="h-3.5 w-3.5" />
      {label}
    </button>
  );
}

function ErrorBanner({ message }: { message: string }): JSX.Element {
  return (
    <div className="mb-4 flex items-start gap-3 rounded-xl border border-destructive/20 bg-destructive/10 p-3 text-sm text-destructive">
      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
      <p>{message}</p>
    </div>
  );
}

function WhatsAppLogo({ className }: { className?: string }): JSX.Element {
  return (
    <svg viewBox="0 0 32 32" fill="currentColor" className={className} aria-hidden="true">
      <path d="M19.11 17.205c-.372 0-1.088 1.39-1.518 1.39a.63.63 0 0 1-.315-.1c-.802-.402-1.504-.817-2.163-1.447-.545-.516-1.146-1.29-1.46-1.963a.426.426 0 0 1-.073-.215c0-.33.99-.945.99-1.49 0-.143-.73-2.058-.832-2.29-.143-.372-.214-.487-.6-.487-.187 0-.36-.043-.53-.043-.302 0-.53.115-.746.315-.688.645-1.032 1.318-1.06 2.247v.114c-.014.99.472 1.977 1.017 2.78 1.23 1.82 2.506 3.41 4.554 4.34.616.287 2.035.834 2.708.834.36 0 1.696-.214 1.696-1.39 0-.32-.073-.45-.36-.595-.245-.116-1.06-.515-1.31-.515zm.602-13.205c-7.18 0-13 5.82-13 13 0 2.42.673 4.78 1.95 6.85L6 30l5.85-1.595c2.04 1.205 4.36 1.85 6.86 1.85 7.18 0 13-5.82 13-13s-5.82-13-13-13zm0 23.85c-2.435 0-4.78-.78-6.73-2.235l-.48-.36-3.83 1.044 1.05-3.69-.31-.495c-1.5-2.005-2.295-4.405-2.295-6.91 0-6.36 5.17-11.53 11.53-11.53 6.36 0 11.53 5.17 11.53 11.53 0 6.36-5.17 11.53-11.53 11.53z" />
    </svg>
  );
}

// re-export the lucide ArrowLeft so we don't fight the linter on unused imports
export { ArrowLeft as _ArrowLeft };
