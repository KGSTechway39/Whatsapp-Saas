"use client";

/**
 * Connect your WhatsApp catalog.
 *
 * AUDIENCE: a shop owner, not an engineer. So the language is "your product
 * list on WhatsApp", never "Commerce Manager catalog entity" or "WABA".
 *
 * Two things this screen is careful about:
 *
 * 1. SendAnjal does NOT create the catalogue. Meta requires it to be built in
 *    Commerce Manager, so the honest instruction is "create it there, paste the
 *    ID here" — with a direct link, because hunting for that ID is the single
 *    most confusing step.
 *
 * 2. The cart/visibility switches reflect META's state, read back after every
 *    write. If a toggle silently didn't take, this shows it as off. A switch
 *    that lies is worse than one that errors: the owner then can't work out why
 *    no orders arrive.
 */

import { PageHeader } from "@/components/shared/PageHeader";
import { cn } from "@/lib/utils";
import {
  AlertCircle, ArrowLeft, Check, CheckCircle2, ExternalLink, Loader2,
  ShieldCheck, ShoppingBag, ShoppingCart, Eye,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

interface Connection {
  id: string;
  commerce_catalog_id: string;
  cart_enabled: boolean;
  catalog_visibility: boolean;
  status: "pending" | "linked" | "failed";
  last_error: string | null;
  linked_at: string | null;
}
interface Compliance {
  required: boolean;
  confirmed: boolean;
  confirmedAt: string | null;
  blocked: boolean;
  industry?: string | null;
}
interface Settings { cartEnabled: boolean; catalogVisible: boolean }

export default function ConnectCatalogPage() {
  const [connection, setConnection] = useState<Connection | null>(null);
  const [compliance, setCompliance] = useState<Compliance | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [loading, setLoading] = useState(true);
  const [catalogId, setCatalogId] = useState("");
  const [linking, setLinking] = useState(false);
  const [savingToggle, setSavingToggle] = useState<string | null>(null);
  const [attesting, setAttesting] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    fetch("/api/catalog/connection")
      .then((r) => r.json())
      .then((d) => {
        if (d.error) throw new Error(d.error);
        setConnection(d.connection);
        setCompliance(d.compliance);
        setSettings(d.settings);
      })
      .catch((err) => toast.error((err as Error).message || "Couldn't load your catalog"))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const attest = async (confirmed: boolean) => {
    setAttesting(true);
    try {
      const res = await fetch("/api/catalog/compliance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmed }),
      }).then((r) => r.json());
      if (res.error) throw new Error(res.error);
      setCompliance(res.compliance);
      toast.success(confirmed ? "Thanks — you can connect your catalog now" : "Declaration withdrawn");
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setAttesting(false);
    }
  };

  const link = async (e: React.FormEvent) => {
    e.preventDefault();
    setLinking(true);
    try {
      const res = await fetch("/api/catalog/connection", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ catalogId: catalogId.trim() }),
      }).then((r) => r.json());
      if (res.error) throw new Error(res.error);
      toast.success("Catalog connected");
      setCatalogId("");
      load();
    } catch (err) {
      toast.error((err as Error).message || "Couldn't connect that catalog");
    } finally {
      setLinking(false);
    }
  };

  const toggle = async (key: "cartEnabled" | "catalogVisible", value: boolean) => {
    setSavingToggle(key);
    try {
      const res = await fetch("/api/catalog/connection", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [key]: value }),
      }).then((r) => r.json());
      if (res.error) throw new Error(res.error);
      // Show what Meta reports, not what we asked for.
      setSettings(res.settings);
      if (res.settings && res.settings[key] !== value) {
        toast.warning("WhatsApp didn't apply that change — it may still be reviewing your catalog.");
      } else {
        toast.success("Saved");
      }
    } catch (err) {
      toast.error((err as Error).message || "Couldn't save that");
    } finally {
      setSavingToggle(null);
    }
  };

  if (loading) {
    return (
      <div className="max-w-3xl">
        <PageHeader title="Connect your catalog" subtitle="Show products inside WhatsApp" />
        <div className="flex items-center justify-center py-24">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      </div>
    );
  }

  const isLinked = connection?.status === "linked";

  return (
    <div className="max-w-3xl">
      <Link
        href="/catalog"
        className="mb-3 inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> Back to products
      </Link>

      <PageHeader
        title="Connect your catalog"
        subtitle="Let customers browse your products and send you an order, without leaving WhatsApp"
      />

      {/* ── Compliance gate — only when this industry requires it ── */}
      {compliance?.required && (
        <div
          className={cn(
            "mb-4 rounded-2xl border p-5",
            compliance.confirmed
              ? "border-success/25 bg-success-soft"
              : "border-warning/25 bg-warning-soft",
          )}
        >
          <div className="flex items-start gap-3">
            <ShieldCheck
              className={cn("mt-0.5 h-5 w-5 flex-shrink-0",
                compliance.confirmed ? "text-success" : "text-warning")}
            />
            <div className="min-w-0 flex-1">
              <p className="font-semibold">
                {compliance.confirmed ? "Selling declaration confirmed" : "Confirm before you sell"}
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                Selling on WhatsApp in India means confirming you&apos;re a genuine registered
                business and that what you sell follows the law. You&apos;re responsible for your
                own listings and orders.
              </p>
              {compliance.confirmed ? (
                <div className="mt-2 flex flex-wrap items-center gap-3">
                  <span className="text-xs text-muted-foreground">
                    Confirmed{compliance.confirmedAt
                      ? ` on ${new Date(compliance.confirmedAt).toLocaleDateString("en-IN")}`
                      : ""}
                  </span>
                  <button
                    onClick={() => attest(false)}
                    disabled={attesting}
                    className="text-xs font-medium text-muted-foreground underline hover:text-foreground"
                  >
                    Withdraw
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => attest(true)}
                  disabled={attesting}
                  className="mt-3 inline-flex min-h-10 items-center gap-2 rounded-xl bg-success px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-60"
                >
                  {attesting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                  I confirm this
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Linked state ── */}
      {isLinked ? (
        <div className="space-y-4">
          <div className="rounded-2xl border border-border/50 bg-card p-5">
            <div className="flex items-start gap-3">
              <CheckCircle2 className="mt-0.5 h-5 w-5 flex-shrink-0 text-success" />
              <div className="min-w-0 flex-1">
                <p className="font-semibold">Your catalog is connected</p>
                <p className="mt-0.5 text-sm text-muted-foreground">
                  Catalog ID <span className="font-mono">{connection!.commerce_catalog_id}</span>
                  {connection!.linked_at &&
                    ` · connected ${new Date(connection!.linked_at).toLocaleDateString("en-IN")}`}
                </p>
              </div>
              <Link
                href="/catalog/orders"
                className="flex-shrink-0 rounded-xl border border-border px-3 py-2 text-sm font-medium hover:bg-accent"
              >
                View orders
              </Link>
            </div>
          </div>

          <div className="rounded-2xl border border-border/50 bg-card p-5">
            <h3 className="font-semibold">What customers can do</h3>
            <p className="mt-0.5 text-sm text-muted-foreground">
              These come straight from WhatsApp — if one won&apos;t switch on, WhatsApp is still
              reviewing your catalog.
            </p>

            <div className="mt-4 space-y-3">
              <Toggle
                icon={ShoppingCart}
                title="Let customers add to a cart"
                help="They can pick several items and send you the whole list as one order."
                checked={settings?.cartEnabled ?? connection!.cart_enabled}
                busy={savingToggle === "cartEnabled"}
                onChange={(v) => toggle("cartEnabled", v)}
              />
              <Toggle
                icon={Eye}
                title="Show a catalog button on your profile"
                help="Anyone opening your WhatsApp profile sees a button to browse your products."
                checked={settings?.catalogVisible ?? connection!.catalog_visibility}
                busy={savingToggle === "catalogVisible"}
                onChange={(v) => toggle("catalogVisible", v)}
              />
            </div>
          </div>
        </div>
      ) : (
        /* ── Not linked ── */
        <div className="rounded-2xl border border-border/50 bg-card p-5">
          {connection?.status === "failed" && connection.last_error && (
            <div className="mb-4 flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/10 p-3">
              <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0 text-destructive" />
              <div className="min-w-0">
                <p className="text-sm font-medium">That didn&apos;t connect last time</p>
                {/* Meta's own words — vague paraphrase would leave them stuck. */}
                <p className="mt-0.5 text-xs text-muted-foreground">{connection.last_error}</p>
              </div>
            </div>
          )}

          <div className="flex items-start gap-3">
            <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-primary/10">
              <ShoppingBag className="h-5 w-5 text-primary" />
            </span>
            <div className="min-w-0">
              <h3 className="font-semibold">Two steps</h3>
              <ol className="mt-3 space-y-3 text-sm text-muted-foreground">
                <li>
                  <span className="font-medium text-foreground">1. Create your product list on Meta.</span>{" "}
                  WhatsApp keeps your products on Meta&apos;s own Commerce Manager — we can&apos;t
                  create it for you.
                  <a
                    href="https://business.facebook.com/commerce"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="ml-1 inline-flex items-center gap-1 font-medium text-primary hover:underline"
                  >
                    Open Commerce Manager <ExternalLink className="h-3 w-3" />
                  </a>
                </li>
                <li>
                  <span className="font-medium text-foreground">2. Paste the catalog ID below.</span>{" "}
                  In Commerce Manager, open your catalog and copy the long number from{" "}
                  <span className="font-medium">Settings → Catalog ID</span>.
                </li>
              </ol>
            </div>
          </div>

          <form onSubmit={link} className="mt-5 flex flex-col gap-2 sm:flex-row">
            <input
              value={catalogId}
              onChange={(e) => setCatalogId(e.target.value)}
              placeholder="e.g. 1234567890123456"
              inputMode="numeric"
              disabled={compliance?.blocked}
              className="min-h-11 flex-1 rounded-xl border border-border bg-background px-4 py-2.5 text-base outline-none focus:border-primary disabled:opacity-50"
            />
            <button
              type="submit"
              disabled={linking || !catalogId.trim() || compliance?.blocked}
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl wa-gradient px-5 py-2.5 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
            >
              {linking && <Loader2 className="h-4 w-4 animate-spin" />}
              Connect catalog
            </button>
          </form>

          {compliance?.blocked && (
            <p className="mt-2 text-xs text-warning dark:text-warning">
              Confirm the selling declaration above first.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/** Large-target switch row — this gets used on a phone behind a counter. */
function Toggle({
  icon: Icon, title, help, checked, busy, onChange,
}: {
  icon: React.ElementType; title: string; help: string;
  checked: boolean; busy: boolean; onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-border/50 p-3">
      <Icon className="mt-0.5 h-4 w-4 flex-shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{title}</p>
        <p className="text-xs text-muted-foreground">{help}</p>
      </div>
      <button
        role="switch"
        aria-checked={checked}
        aria-label={title}
        disabled={busy}
        onClick={() => onChange(!checked)}
        className={cn(
          "relative h-7 w-12 flex-shrink-0 rounded-full transition-colors disabled:opacity-60",
          checked ? "bg-success" : "bg-muted",
        )}
      >
        <span
          className={cn(
            "absolute top-1 h-5 w-5 rounded-full bg-card transition-transform",
            checked ? "translate-x-6" : "translate-x-1",
          )}
        />
        {busy && (
          <Loader2 className="absolute inset-0 m-auto h-3.5 w-3.5 animate-spin text-white" />
        )}
      </button>
    </div>
  );
}
