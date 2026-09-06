"use client";

/**
 * Orders customers sent from your catalog.
 *
 * THE THING THIS SCREEN MUST NOT IMPLY: these are not paid orders. WhatsApp's
 * cart takes no payment — a customer picks items and sends you the list. Money
 * is collected outside WhatsApp, by you.
 *
 * So this is a work queue, not a sales ledger. There is deliberately no "mark
 * as paid" button: SendAnjal never sees the payment, and a status we cannot verify
 * would be a lie sitting in the owner's dashboard. The states are about what
 * *you* have done — new, working on it, done, cancelled.
 */

import { PageHeader } from "@/components/shared/PageHeader";
import { EmptyState } from "@/components/shared/EmptyState";
import { cn } from "@/lib/utils";
import {
  ArrowLeft, ChevronDown, Info, Loader2, MessageCircle, Package,
  ShoppingCart,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

type OrderStatus = "received" | "processing" | "completed" | "cancelled";

interface OrderItem {
  product_retailer_id: string;
  quantity: number;
  item_price_paise: number;
  currency: string;
}
interface Order {
  id: string;
  customer_phone: string;
  contact_id: string | null;
  order_items: OrderItem[];
  total_paise: number;
  currency: string;
  status: OrderStatus;
  notes: string | null;
  received_at: string;
}

const TABS: { key: string; label: string }[] = [
  { key: "open", label: "Needs action" },
  { key: "completed", label: "Done" },
  { key: "cancelled", label: "Cancelled" },
  { key: "all", label: "All" },
];

const STATUS_STYLE: Record<OrderStatus, string> = {
  received: "bg-warning-soft text-warning dark:text-warning",
  processing: "bg-accent text-primary dark:text-primary",
  completed: "bg-success-soft text-success dark:text-success",
  cancelled: "bg-muted text-muted-foreground",
};
const STATUS_LABEL: Record<OrderStatus, string> = {
  received: "New", processing: "Working on it", completed: "Done", cancelled: "Cancelled",
};

const inr = (paise: number, currency = "INR") =>
  `${currency === "INR" ? "₹" : `${currency} `}${(paise / 100).toLocaleString("en-IN", {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  })}`;

function relTime(iso: string) {
  const s = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

export default function CatalogOrdersPage() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [tab, setTab] = useState("open");
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    fetch(`/api/catalog/orders?status=${tab}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.error) throw new Error(d.error);
        setOrders(d.orders);
        setCounts(d.counts ?? {});
      })
      .catch((err) => toast.error((err as Error).message || "Couldn't load orders"))
      .finally(() => setLoading(false));
  }, [tab]);

  useEffect(() => { load(); }, [load]);

  const setStatus = async (order: Order, status: OrderStatus) => {
    setBusyId(order.id);
    try {
      const res = await fetch("/api/catalog/orders", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: order.id, status }),
      }).then((r) => r.json());
      if (res.error) throw new Error(res.error);
      toast.success(`Marked ${STATUS_LABEL[status].toLowerCase()}`);
      load();
    } catch (err) {
      toast.error((err as Error).message || "Couldn't update that");
    } finally {
      setBusyId(null);
    }
  };

  const openCount = (counts.received ?? 0) + (counts.processing ?? 0);

  return (
    <div className="max-w-4xl">
      <Link
        href="/catalog"
        className="mb-3 inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> Back to products
      </Link>

      <PageHeader
        title="Catalog orders"
        subtitle={openCount > 0
          ? `${openCount} ${openCount === 1 ? "order needs" : "orders need"} your attention`
          : "Orders customers send from your catalog"}
      />

      {/* The single most important thing on this screen. */}
      <div className="mb-4 flex items-start gap-3 rounded-2xl border border-primary/25 bg-accent p-4">
        <Info className="mt-0.5 h-4 w-4 flex-shrink-0 text-primary" />
        <p className="text-sm text-muted-foreground">
          <span className="font-medium text-foreground">These aren&apos;t paid yet.</span>{" "}
          WhatsApp lets a customer send you their basket — it doesn&apos;t take their money.
          Message them to confirm the order and collect payment however you normally do.
        </p>
      </div>

      <div className="mb-4 flex flex-wrap gap-1 rounded-xl bg-muted/40 p-1">
        {TABS.map((t) => {
          const n = t.key === "open" ? openCount
            : t.key === "all" ? Object.values(counts).reduce((a, b) => a + b, 0)
            : counts[t.key] ?? 0;
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={cn(
                "inline-flex min-h-10 items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                tab === t.key ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {t.label}
              {n > 0 && <span className="rounded-full bg-muted px-1.5 text-xs">{n}</span>}
            </button>
          );
        })}
      </div>

      {loading && orders.length === 0 ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : orders.length === 0 ? (
        <EmptyState
          icon={ShoppingCart}
          title={tab === "open" ? "Nothing waiting" : "No orders here"}
          description={
            tab === "open"
              ? "When a customer sends you their basket from WhatsApp, it lands here."
              : "Try another tab."
          }
          action={
            <Link
              href="/catalog/connect"
              className="rounded-xl border border-border px-4 py-2 text-sm font-medium hover:bg-accent"
            >
              Catalog settings
            </Link>
          }
        />
      ) : (
        <div className="space-y-3">
          {orders.map((o) => {
            const isOpen = expanded === o.id;
            return (
              <div key={o.id} className="rounded-2xl border border-border/50 bg-card p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-semibold">{o.customer_phone}</p>
                      <span className={cn("rounded-full px-2.5 py-0.5 text-xs font-semibold", STATUS_STYLE[o.status])}>
                        {STATUS_LABEL[o.status]}
                      </span>
                    </div>
                    <p className="mt-0.5 text-sm text-muted-foreground">
                      {o.order_items.length} {o.order_items.length === 1 ? "item" : "items"} ·{" "}
                      <span className="font-medium text-foreground">{inr(o.total_paise, o.currency)}</span>
                      {" · "}{relTime(o.received_at)}
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    {/* Reply is the actual next step — payment happens in the
                        conversation, not in this app. */}
                    <Link
                      href={o.contact_id ? `/inbox?contact=${o.contact_id}` : "/inbox"}
                      className="inline-flex min-h-10 items-center gap-1.5 rounded-xl border border-border px-3 py-2 text-sm font-medium hover:bg-accent"
                    >
                      <MessageCircle className="h-4 w-4" /> Reply
                    </Link>

                    {o.status === "received" && (
                      <button
                        onClick={() => setStatus(o, "processing")}
                        disabled={busyId === o.id}
                        className="inline-flex min-h-10 items-center gap-1.5 rounded-xl wa-gradient px-3 py-2 text-sm font-semibold text-white disabled:opacity-60"
                      >
                        {busyId === o.id ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                        Start
                      </button>
                    )}
                    {o.status === "processing" && (
                      <button
                        onClick={() => setStatus(o, "completed")}
                        disabled={busyId === o.id}
                        className="inline-flex min-h-10 items-center gap-1.5 rounded-xl bg-success px-3 py-2 text-sm font-semibold text-white disabled:opacity-60"
                      >
                        {busyId === o.id ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                        Mark done
                      </button>
                    )}
                    {(o.status === "received" || o.status === "processing") && (
                      <button
                        onClick={() => setStatus(o, "cancelled")}
                        disabled={busyId === o.id}
                        className="min-h-10 rounded-xl px-2 text-sm font-medium text-muted-foreground hover:text-foreground disabled:opacity-60"
                      >
                        Cancel
                      </button>
                    )}

                    <button
                      onClick={() => setExpanded(isOpen ? null : o.id)}
                      aria-label={isOpen ? "Hide items" : "Show items"}
                      className="inline-flex min-h-10 items-center gap-1 rounded-xl px-2 text-sm font-medium text-primary"
                    >
                      Items <ChevronDown className={cn("h-4 w-4 transition-transform", isOpen && "rotate-180")} />
                    </button>
                  </div>
                </div>

                {isOpen && (
                  <div className="mt-3 space-y-2 border-t border-border/50 pt-3">
                    {o.order_items.map((it, i) => (
                      <div key={i} className="flex items-center justify-between gap-3 text-sm">
                        <span className="flex min-w-0 items-center gap-2">
                          <Package className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
                          {/* The retailer ID is the tenant's own SKU — the one
                              thing that identifies the product in their system. */}
                          <span className="truncate font-mono text-xs">{it.product_retailer_id}</span>
                          <span className="flex-shrink-0 text-muted-foreground">× {it.quantity}</span>
                        </span>
                        <span className="flex-shrink-0 font-medium">
                          {inr(it.item_price_paise * it.quantity, it.currency)}
                        </span>
                      </div>
                    ))}
                    {o.notes && (
                      <p className="mt-2 rounded-lg bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                        {o.notes}
                      </p>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
