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
  KeyRound,
  Sparkles,
  ArrowLeft,
  Info,
  Smartphone,
  PlayCircle,
  HelpCircle,
  MessageCircle,
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

type Phase = "fork" | "details" | "idle" | "managed" | "misconfigured" | "loading" | "exchanging" | "choose" | "saving" | "success" | "error";
type Tab   = "embedded" | "manual";
/** Onboarding fork: A = coexistence (existing app), B = fresh number, C = managed (our WABA). */
type OnboardPath = "A" | "B" | "C";

/** Business details collected up-front and injected into Meta's signup to skip screens. */
interface BusinessDetails {
  name: string;
  vertical: string; // WhatsApp business vertical code (see VERTICALS)
  city: string;
}

/** WhatsApp Business profile verticals (friendly label → Meta code). */
const VERTICALS: { label: string; code: string }[] = [
  { label: "Retail / Shop", code: "RETAIL" },
  { label: "Restaurant / Food", code: "RESTAURANT" },
  { label: "Grocery", code: "GROCERY" },
  { label: "Education / Coaching", code: "EDU" },
  { label: "Health / Clinic", code: "HEALTH" },
  { label: "Beauty / Salon", code: "BEAUTY" },
  { label: "Finance", code: "FINANCE" },
  { label: "Travel / Hotel", code: "TRAVEL" },
  { label: "Professional services", code: "PROF_SERVICES" },
  { label: "Other", code: "OTHER" },
];

/** Build Meta's `extras.setup` prefill (best-effort; Meta ignores unknown keys). */
function buildSetup(d: BusinessDetails): Record<string, unknown> | undefined {
  const business: Record<string, unknown> = {};
  if (d.name.trim()) business.name = d.name.trim();
  if (d.city.trim()) business.address = { city: d.city.trim(), country: "IN" };
  const phone: Record<string, unknown> = {};
  if (d.vertical) phone.vertical = d.vertical;
  if (Object.keys(business).length === 0 && Object.keys(phone).length === 0) return undefined;
  const setup: Record<string, unknown> = {};
  if (Object.keys(business).length) setup.business = business;
  if (Object.keys(phone).length) setup.phone = phone;
  return setup;
}

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

  // Persistent "Chat with us on WhatsApp" target (human assist is the real
  // differentiator for non-technical users). Set NEXT_PUBLIC_SUPPORT_WHATSAPP
  // to your support number; falls back to wa.me's contact chooser.
  const SUPPORT_WA = (process.env.NEXT_PUBLIC_SUPPORT_WHATSAPP ?? "").replace(/\D/g, "");
  const helpHref = SUPPORT_WA
    ? `https://wa.me/${SUPPORT_WA}?text=${encodeURIComponent("Hi! I need help connecting my WhatsApp Business account.")}`
    : "https://wa.me/";

  const [tab, setTab]           = useState<Tab>("embedded");
  // The fork is always the entry point — it precedes any Meta interaction, and
  // Path C needs no Meta at all. Missing creds only matter once a user picks a
  // Meta path (A/B), at which point we route them to the misconfigured screen.
  const [phase, setPhase]       = useState<Phase>("fork");
  const [path, setPath]         = useState<OnboardPath | null>(null);
  const [details, setDetails]   = useState<BusinessDetails>({ name: "", vertical: "", city: "" });
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
    setPhase("fork");
    setPath(null);
    setDetails({ name: "", vertical: "", city: "" });
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
    // If the SDK can't load (browser ad/tracking blocker, network), don't leave
    // the button silently disabled — tell the user and point them at Manual Setup.
    s.onerror = () => {
      initRef.current = false; // allow a retry on reopen
      setError(
        "Couldn't load Facebook sign-in. Disable any ad/tracking blocker for this site and retry, or use Manual Setup.",
      );
    };
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
        // Re-request so a second click never dead-ends on "already logged in".
        auth_type: "rerequest",
        response_type: "code",
        override_default_response_type: true,
        override_min_version: SDK_VERSION,
        extras: {
          feature: "whatsapp_embedded_signup",
          sessionInfoVersion: 3,
          // Path A (coexistence): share the existing WABA and skip number entry.
          ...(path === "A" ? { featureType: "only_waba_sharing" } : {}),
          // Pre-fill business name / city / vertical so Meta skips those screens.
          ...(buildSetup(details) ? { setup: buildSetup(details) } : {}),
        },
      },
    );
  }, [CONFIG_ID, embeddedConfigured, sdkReady, path, details]);

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

  // The "Continue With Facebook" footer only applies once the user has chosen
  // a Meta path (idle/error). The fork and managed screens have their own CTAs.
  const showEmbeddedFooter = tab === "embedded" && (phase === "idle" || phase === "error");
  void onMigrate; // retained for API compatibility; coexistence now lives in the fork

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
        className="relative flex max-h-[100dvh] w-full max-w-xl flex-col overflow-hidden rounded-t-3xl bg-card text-foreground shadow-2xl ring-1 ring-border/60 sm:max-h-[calc(100dvh-2rem)] sm:rounded-3xl"
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
                <a
                  href={helpHref}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-1.5 inline-flex items-center gap-1.5 text-xs font-medium text-[#128C7E] transition-colors hover:text-[#25D366]"
                >
                  <MessageCircle className="h-3.5 w-3.5" /> Need help? Chat with us on WhatsApp
                </a>
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
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
          {error && phase !== "success" && <ErrorBanner message={error} />}

          {phase === "misconfigured" && tab === "embedded" && <MisconfiguredBlock />}

          {/* Step 1 — the fork: route by what the user already has */}
          {phase === "fork" && tab === "embedded" && (
            <ForkBlock
              onPick={(p) => {
                setPath(p);
                // A/B collect business details next; C is the managed (no-Meta) screen.
                setPhase(p === "C" ? "managed" : "details");
                setError(null);
              }}
            />
          )}

          {/* Back to the fork from any embedded sub-screen */}
          {(phase === "details" || phase === "idle" || phase === "error" || phase === "managed" || phase === "misconfigured") && tab === "embedded" && path && (
            <button
              type="button"
              onClick={() => { setPath(null); setPhase("fork"); setError(null); }}
              className="mb-4 inline-flex items-center gap-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              <ArrowLeft className="h-3.5 w-3.5" /> Choose a different option
            </button>
          )}

          {/* Step 2 — collect business details up-front so Meta's screens are pre-filled */}
          {phase === "details" && tab === "embedded" && (
            <DetailsBlock
              path={path}
              initial={details}
              onSubmit={(d) => {
                setDetails(d);
                setPhase(embeddedConfigured ? "idle" : "misconfigured");
                setError(null);
                // Persist to our record up-front (best-effort) so we keep the
                // details even if the user doesn't finish Meta's signup.
                fetch("/api/onboarding/profile", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ businessName: d.name, vertical: d.vertical, city: d.city, path }),
                }).catch(() => undefined);
              }}
            />
          )}

          {phase === "managed" && tab === "embedded" && <ManagedBlock helpHref={helpHref} />}

          {(phase === "idle" || phase === "error") && tab === "embedded" && (
            path === "A" ? <CoexistenceNote /> : <RequirementsBlock />
          )}

          {tab === "manual" &&
            (phase === "fork" || phase === "idle" || phase === "error" || phase === "managed" || phase === "misconfigured") && (
              <ManualForm onSubmit={onManualConnect} />
            )}

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
                disabled={!embeddedConfigured || !sdkReady}
                onClick={launchSignup}
                className="inline-flex w-full items-center justify-center gap-3 rounded-xl bg-[#1877F2] px-5 py-3 font-semibold text-white shadow-sm shadow-blue-500/20 transition-colors hover:bg-[#1464D2] disabled:cursor-not-allowed disabled:opacity-60"
              >
                <Facebook className="h-5 w-5" />
                {path === "A" ? "Continue — connect my existing number" : "Continue With Facebook"}
              </button>

              <a
                href={helpHref}
                target="_blank"
                rel="noreferrer"
                className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-border bg-transparent px-5 py-3 text-sm font-medium text-foreground transition-colors hover:bg-muted"
              >
                <MessageCircle className="h-4 w-4" /> Need help? Chat with us on WhatsApp
              </a>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}

// ─── Building blocks ─────────────────────────────────────────────────────

/** Step 1 — fork by what the user already has (plain language, mobile-first). */
function ForkBlock({ onPick }: { onPick: (p: OnboardPath) => void }): JSX.Element {
  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-semibold">Do you already use the WhatsApp Business app?</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          Pick what matches you — we&apos;ll handle the rest.
        </p>
      </div>

      <div className="space-y-2">
        <ChoiceCard
          icon={Smartphone}
          title="Yes — I use the WhatsApp Business app"
          description="Keep your number and your chats. Quick QR scan + OTP, like linking WhatsApp Web."
          onClick={() => onPick("A")}
        />
        <ChoiceCard
          icon={Sparkles}
          title="No — set me up with a new number"
          description="We&apos;ll create everything for you through Meta&apos;s official signup."
          onClick={() => onPick("B")}
        />
        <ChoiceCard
          icon={HelpCircle}
          title="I don&apos;t have Facebook / prefer it managed"
          description="Send under our verified number — zero Meta setup. Start right away."
          onClick={() => onPick("C")}
        />
      </div>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <VideoSlot label="How to install WhatsApp Business app" />
        <VideoSlot label="How to create a Facebook account" />
      </div>
    </div>
  );
}

function ChoiceCard({
  icon: Icon,
  title,
  description,
  onClick,
}: {
  icon: typeof Smartphone;
  title: string;
  description: string;
  onClick: () => void;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-3 rounded-xl border border-border/60 bg-background/40 p-4 text-left transition-colors hover:border-emerald-500/50 hover:bg-emerald-500/5"
    >
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-500">
        <Icon className="h-5 w-5" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium leading-tight">{title}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
      </div>
      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
    </button>
  );
}

/** Short explainer-video slot (walkthrough content lands here later). */
function VideoSlot({ label }: { label: string }): JSX.Element {
  return (
    <button
      type="button"
      onClick={() => toast.info("Walkthrough video coming soon")}
      className="flex items-center gap-2 rounded-xl border border-border/60 bg-background/40 p-3 text-left text-xs font-medium text-muted-foreground transition-colors hover:bg-muted"
    >
      <PlayCircle className="h-4 w-4 shrink-0 text-emerald-500" />
      <span className="leading-tight">{label}</span>
    </button>
  );
}

/** Path A — what coexistence onboarding will do, in plain language. */
function CoexistenceNote(): JSX.Element {
  return (
    <div className="mb-4 rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-3 text-xs">
      <p className="font-medium">We&apos;ll connect your existing number</p>
      <p className="mt-1 text-muted-foreground">
        You keep your number and chat history. During setup you&apos;ll scan a QR code and enter a
        6-digit code from your WhatsApp Business app — that&apos;s it.
      </p>
    </div>
  );
}

/** Path C — managed (Model C) under our WABA. Human-assisted activation. */
function ManagedBlock({ helpHref }: { helpHref: string }): JSX.Element {
  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4">
        <h3 className="text-sm font-semibold">We&apos;ll run WhatsApp for you</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          On the <strong>Starter</strong> plan your messages go out under our verified WhatsApp
          number — no Facebook account or Meta setup needed. You can start sending right away at
          Starter limits.
        </p>
      </div>
      <a
        href={helpHref}
        target="_blank"
        rel="noreferrer"
        className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-[#25D366] px-5 py-3 font-semibold text-white transition-colors hover:bg-[#1DA851]"
      >
        <MessageCircle className="h-5 w-5" /> Chat with us to get started
      </a>
      <p className="text-center text-xs text-muted-foreground">
        Our team activates your Starter account in minutes.
      </p>
    </div>
  );
}

/** Step 2 — collect business details once, in our UI, to pre-fill Meta's signup. */
function DetailsBlock({
  path,
  initial,
  onSubmit,
}: {
  path: OnboardPath | null;
  initial: BusinessDetails;
  onSubmit: (d: BusinessDetails) => void;
}): JSX.Element {
  const [name, setName] = useState(initial.name);
  const [vertical, setVertical] = useState(initial.vertical);
  const [city, setCity] = useState(initial.city);
  const canSubmit = name.trim().length > 1;

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!canSubmit) return;
        onSubmit({ name: name.trim(), vertical, city: city.trim() });
      }}
      className="space-y-4"
    >
      <div>
        <h3 className="text-sm font-semibold">Tell us about your business</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          We&apos;ll pre-fill these on Meta&apos;s screens so you have fewer steps.
          {path === "A" ? " Your existing number and chats stay intact." : ""}
        </p>
      </div>

      <Field label="Business name" placeholder="e.g. Sharma Textiles" value={name} onChange={setName} required />

      <label className="block">
        <span className="mb-1.5 block text-xs font-medium text-muted-foreground">Category</span>
        <div className="rounded-xl border border-border bg-background px-3 py-2.5 focus-within:border-emerald-500/60">
          <select
            value={vertical}
            onChange={(e) => setVertical(e.target.value)}
            className="w-full bg-transparent text-sm outline-none"
          >
            <option value="">Select a category…</option>
            {VERTICALS.map((v) => (
              <option key={v.code} value={v.code}>{v.label}</option>
            ))}
          </select>
        </div>
      </label>

      <Field label="City" placeholder="e.g. Coimbatore" value={city} onChange={setCity} />

      <button
        type="submit"
        disabled={!canSubmit}
        className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-[#25D366] px-5 py-3 font-semibold text-white transition-colors hover:bg-[#1DA851] disabled:cursor-not-allowed disabled:opacity-60"
      >
        Continue <ChevronRight className="h-4 w-4" />
      </button>
    </form>
  );
}

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
      <h3 className="mt-4 text-base font-semibold">✅ Your WhatsApp is connected!</h3>
      <p className="mt-1 text-sm text-muted-foreground">
        <span className="font-mono">{summary.displayPhoneNumber}</span>
        {summary.businessName ? ` — ${summary.businessName}` : ""}
      </p>
      <p className="mt-2 text-xs text-muted-foreground">
        You can start sending messages and running campaigns right away.
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
