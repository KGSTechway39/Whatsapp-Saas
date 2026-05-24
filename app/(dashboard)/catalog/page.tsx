"use client";

import { PageHeader } from "@/components/shared/PageHeader";
import { EmptyState } from "@/components/shared/EmptyState";
import {
  ShoppingBag, Plus, Search, X, Loader2, RefreshCw, Trash2, Edit3,
  Package, ImageIcon, IndianRupee, Tag as TagIcon, Send, ShoppingCart,
  AlertCircle, Check, ExternalLink, Store, Globe,
} from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

interface Product {
  id: string;
  name: string;
  description: string | null;
  price: number;
  compare_at_price: number | null;
  currency: string;
  image_url: string | null;
  product_url: string | null;
  category: string | null;
  tags: string[];
  sku: string | null;
  in_stock: boolean;
  status: "active" | "archived" | "out_of_stock";
}

interface Connection {
  id: string;
  provider: "shopify" | "woocommerce" | "manual";
  shop_domain: string | null;
  status: "active" | "expired" | "disconnected";
  last_synced_at: string | null;
  product_count: number;
}

interface CartRow {
  id: string;
  status: "active" | "abandoned" | "recovered" | "converted";
  total: number;
  currency: string;
  items_count: number;
  checkout_url: string | null;
  abandoned_at: string | null;
  recovery_message_sent_at: string | null;
  recovery_attempts: number;
  contact: { id: string; name: string; phone: string };
  cart_items: { name: string; quantity: number; price: number; image_url: string | null }[];
}

const formatINR = (n: number) =>
  n >= 100000 ? `₹${(n / 100000).toFixed(2)}L` : n >= 1000 ? `₹${(n / 1000).toFixed(1)}k` : `₹${n.toFixed(0)}`;

export default function CatalogPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [total, setTotal] = useState(0);
  const [connections, setConnections] = useState<Connection[]>([]);
  const [carts, setCarts] = useState<CartRow[]>([]);
  const [cartSummary, setCartSummary] = useState<{ abandoned: number; recovered: number; abandoned_value: number; recovered_value: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState<"products" | "carts">("products");
  const [showAdd, setShowAdd] = useState(false);
  const [showConnect, setShowConnect] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [syncing, setSyncing] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const q = new URLSearchParams();
      if (search) q.set("search", search);
      const [pRes, cRes, cartRes] = await Promise.all([
        fetch(`/api/products?${q}`).then((r) => r.json()),
        fetch("/api/commerce/connect").then((r) => r.json()),
        fetch("/api/carts").then((r) => r.json()),
      ]);
      setProducts(pRes.products || []);
      setTotal(pRes.total || 0);
      setConnections(cRes.connections || []);
      setCarts(cartRes.carts || []);
      setCartSummary(cartRes.summary || null);
    } catch {
      toast.error("Failed to load catalog");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [search]);

  const handleSync = async (connectionId: string) => {
    setSyncing(connectionId);
    try {
      const res = await fetch("/api/commerce/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ connectionId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success(`Synced ${data.synced} products`);
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Sync failed");
    } finally {
      setSyncing(null);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this product?")) return;
    try {
      await fetch(`/api/products/${id}`, { method: "DELETE" });
      toast.success("Product deleted");
      load();
    } catch {
      toast.error("Failed to delete");
    }
  };

  const handleDisconnect = async (id: string) => {
    if (!confirm("Disconnect this store? Synced products will remain.")) return;
    await fetch(`/api/commerce/connect?id=${id}`, { method: "DELETE" });
    toast.success("Store disconnected");
    load();
  };

  return (
    <div className="max-w-7xl">
      <PageHeader
        title="Catalog & Shop"
        subtitle="Sync products from Shopify/WooCommerce or add manually — send via WhatsApp"
        action={
          <div className="flex items-center gap-2">
            {connections.length === 0 ? (
              <button
                onClick={() => setShowConnect(true)}
                className="flex items-center gap-2 px-4 py-2.5 rounded-xl border border-border hover:bg-accent text-sm font-medium transition-colors"
              >
                <Store className="w-4 h-4" />
                Connect Store
              </button>
            ) : null}
            <button
              onClick={() => setShowAdd(true)}
              className="flex items-center gap-2 wa-gradient text-white font-semibold px-4 py-2.5 rounded-xl hover:opacity-90 transition-all shadow-lg shadow-primary/25"
            >
              <Plus className="w-4 h-4" />
              Add Product
            </button>
          </div>
        }
      />

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <KPICard label="Products" value={total.toString()} icon={Package} color="text-blue-400" bg="bg-blue-500/10" />
        <KPICard label="In Stock" value={products.filter((p) => p.in_stock).length.toString()} icon={Check} color="text-emerald-400" bg="bg-emerald-500/10" />
        <KPICard
          label="Abandoned Carts"
          value={cartSummary?.abandoned.toString() || "0"}
          sub={cartSummary ? formatINR(cartSummary.abandoned_value) : undefined}
          icon={ShoppingCart}
          color="text-amber-400"
          bg="bg-amber-500/10"
        />
        <KPICard
          label="Recovered"
          value={cartSummary?.recovered.toString() || "0"}
          sub={cartSummary ? formatINR(cartSummary.recovered_value) : undefined}
          icon={IndianRupee}
          color="text-emerald-400"
          bg="bg-emerald-500/10"
        />
      </div>

      {/* Connected stores */}
      {connections.length > 0 && (
        <div className="bg-card border border-border/50 rounded-2xl p-4 mb-6">
          <p className="text-sm font-semibold mb-3">Connected Stores ({connections.length})</p>
          <div className="space-y-2">
            {connections.map((c) => (
              <div key={c.id} className="flex items-center justify-between p-3 rounded-xl border border-border/40 bg-muted/20">
                <div className="flex items-center gap-3">
                  <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${
                    c.provider === "shopify" ? "bg-emerald-500/10" : c.provider === "woocommerce" ? "bg-violet-500/10" : "bg-blue-500/10"
                  }`}>
                    <Store className={`w-4 h-4 ${
                      c.provider === "shopify" ? "text-emerald-400" : c.provider === "woocommerce" ? "text-violet-400" : "text-blue-400"
                    }`} />
                  </div>
                  <div>
                    <p className="text-sm font-semibold capitalize">{c.provider}</p>
                    <p className="text-[11px] text-muted-foreground">{c.shop_domain} · {c.product_count} products</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handleSync(c.id)}
                    disabled={syncing === c.id}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border hover:bg-accent text-xs font-medium transition-colors disabled:opacity-50"
                  >
                    <RefreshCw className={`w-3 h-3 ${syncing === c.id ? "animate-spin" : ""}`} />
                    {syncing === c.id ? "Syncing…" : "Sync"}
                  </button>
                  <button
                    onClick={() => handleDisconnect(c.id)}
                    className="p-1.5 rounded-lg text-muted-foreground hover:text-red-400 hover:bg-red-500/10"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 mb-4 bg-muted/20 p-1 rounded-xl w-fit">
        {[
          { id: "products" as const, label: "Products", count: total },
          { id: "carts"    as const, label: "Abandoned Carts", count: cartSummary?.abandoned || 0 },
        ].map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-all ${
              tab === t.id ? "bg-card shadow text-foreground" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {t.label}
            {t.count > 0 && <span className="ml-1.5 text-xs opacity-60">({t.count})</span>}
          </button>
        ))}
      </div>

      {tab === "products" ? (
        <>
          {/* Search */}
          <div className="relative mb-4">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search products by name, SKU, category…"
              className="w-full bg-card border border-border/50 rounded-xl pl-11 pr-4 py-2.5 text-sm outline-none focus:border-primary/60 transition-all"
            />
          </div>

          {/* Product grid */}
          {loading ? (
            <div className="py-12 text-center"><Loader2 className="w-6 h-6 animate-spin text-primary mx-auto" /></div>
          ) : products.length === 0 ? (
            <EmptyState
              icon={Package}
              title="No products yet"
              description="Add a product manually or connect Shopify / WooCommerce to sync your catalog"
              action={
                <button onClick={() => setShowAdd(true)} className="flex items-center gap-2 wa-gradient text-white font-semibold px-5 py-2.5 rounded-xl">
                  <Plus className="w-4 h-4" /> Add Product
                </button>
              }
            />
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {products.map((p) => (
                <ProductCard
                  key={p.id}
                  product={p}
                  onDelete={() => handleDelete(p.id)}
                  onEdit={() => setEditingProduct(p)}
                  onSend={() => toast.info("Open Send Message → choose this product")}
                />
              ))}
            </div>
          )}
        </>
      ) : (
        <CartList carts={carts} onChanged={load} />
      )}

      {showAdd && <ProductModal onClose={() => setShowAdd(false)} onSaved={load} />}
      {editingProduct && <ProductModal product={editingProduct} onClose={() => setEditingProduct(null)} onSaved={load} />}
      {showConnect && <ConnectStoreModal onClose={() => setShowConnect(false)} onConnected={load} />}
    </div>
  );
}

// ── KPI Card ──────────────────────────────────────────────────────────────
function KPICard({ label, value, sub, icon: Icon, color, bg }: { label: string; value: string; sub?: string; icon: React.ComponentType<{ className?: string }>; color: string; bg: string }) {
  return (
    <div className="bg-card border border-border/50 rounded-2xl p-4">
      <div className="flex items-start justify-between mb-2">
        <span className="text-xs text-muted-foreground font-medium">{label}</span>
        <div className={`w-7 h-7 rounded-lg ${bg} flex items-center justify-center`}>
          <Icon className={`w-3.5 h-3.5 ${color}`} />
        </div>
      </div>
      <p className="text-2xl font-bold tracking-tight">{value}</p>
      {sub && <p className={`text-[11px] font-medium mt-0.5 ${color}`}>{sub}</p>}
    </div>
  );
}

// ── Product card ──────────────────────────────────────────────────────────
function ProductCard({ product, onDelete, onEdit, onSend }: { product: Product; onDelete: () => void; onEdit: () => void; onSend: () => void }) {
  const isOnSale = product.compare_at_price && product.compare_at_price > product.price;
  return (
    <div className="bg-card border border-border/50 rounded-2xl overflow-hidden group hover:border-primary/40 transition-all">
      <div className="relative aspect-square bg-muted/20 overflow-hidden">
        {product.image_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={product.image_url} alt={product.name} className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <ImageIcon className="w-10 h-10 text-muted-foreground/30" />
          </div>
        )}
        {!product.in_stock && (
          <div className="absolute top-2 left-2 bg-red-500/90 text-white text-[10px] font-bold px-2 py-0.5 rounded-full">
            OUT OF STOCK
          </div>
        )}
        {isOnSale && product.in_stock && (
          <div className="absolute top-2 left-2 bg-amber-500/90 text-white text-[10px] font-bold px-2 py-0.5 rounded-full">
            SALE
          </div>
        )}
        <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity flex gap-1">
          <button onClick={onEdit} className="w-7 h-7 rounded-lg bg-card/95 backdrop-blur border border-border/40 flex items-center justify-center hover:bg-card">
            <Edit3 className="w-3.5 h-3.5" />
          </button>
          <button onClick={onDelete} className="w-7 h-7 rounded-lg bg-card/95 backdrop-blur border border-border/40 flex items-center justify-center hover:bg-red-500/20 hover:text-red-400">
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
      <div className="p-3">
        <p className="text-sm font-semibold line-clamp-1">{product.name}</p>
        {product.category && <p className="text-[10px] text-muted-foreground mt-0.5">{product.category}</p>}
        <div className="flex items-center justify-between mt-2">
          <div>
            <span className="text-base font-bold">₹{product.price.toLocaleString()}</span>
            {isOnSale && product.compare_at_price && (
              <span className="text-[11px] text-muted-foreground line-through ml-1.5">₹{product.compare_at_price.toLocaleString()}</span>
            )}
          </div>
          <button
            onClick={onSend}
            className="flex items-center gap-1 text-[11px] text-primary hover:underline"
          >
            <Send className="w-3 h-3" /> Send
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Add/Edit Product Modal ────────────────────────────────────────────────
function ProductModal({ product, onClose, onSaved }: { product?: Product; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({
    name: product?.name || "",
    description: product?.description || "",
    price: product?.price?.toString() || "",
    compareAtPrice: product?.compare_at_price?.toString() || "",
    currency: product?.currency || "INR",
    imageUrl: product?.image_url || "",
    productUrl: product?.product_url || "",
    category: product?.category || "",
    sku: product?.sku || "",
    inStock: product?.in_stock ?? true,
  });
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!form.name.trim() || !form.price) { toast.error("Name and price required"); return; }
    setSaving(true);
    try {
      const url    = product ? `/api/products/${product.id}` : "/api/products";
      const method = product ? "PATCH" : "POST";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name:           form.name,
          description:    form.description || null,
          price:          Number(form.price),
          compareAtPrice: form.compareAtPrice ? Number(form.compareAtPrice) : null,
          currency:       form.currency,
          imageUrl:       form.imageUrl || null,
          productUrl:     form.productUrl || null,
          category:       form.category || null,
          sku:            form.sku || null,
          inStock:        form.inStock,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success(product ? "Product updated" : "Product added");
      onSaved();
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="bg-card border border-border rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b border-border sticky top-0 bg-card z-10">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl wa-gradient flex items-center justify-center">
              <Package className="w-4 h-4 text-white" />
            </div>
            <div>
              <h3 className="font-semibold">{product ? "Edit Product" : "Add Product"}</h3>
              <p className="text-xs text-muted-foreground">Manual catalog entry</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-muted/50"><X className="w-4 h-4" /></button>
        </div>
        <div className="p-5 grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="md:col-span-2">
            <label className="text-sm font-medium block mb-1.5">Name *</label>
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="Wireless Earbuds Pro"
              className="w-full bg-muted/50 border border-border rounded-xl px-3 py-2 text-sm outline-none focus:border-primary/60" />
          </div>
          <div className="md:col-span-2">
            <label className="text-sm font-medium block mb-1.5">Description</label>
            <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })}
              rows={3} placeholder="Bluetooth 5.3, 30hr battery, IPX5 waterproof"
              className="w-full bg-muted/50 border border-border rounded-xl px-3 py-2 text-sm outline-none focus:border-primary/60 resize-none" />
          </div>
          <div>
            <label className="text-sm font-medium block mb-1.5">Price (₹) *</label>
            <input value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })}
              type="number" placeholder="2999"
              className="w-full bg-muted/50 border border-border rounded-xl px-3 py-2 text-sm outline-none focus:border-primary/60" />
          </div>
          <div>
            <label className="text-sm font-medium block mb-1.5">Compare-at price (was)</label>
            <input value={form.compareAtPrice} onChange={(e) => setForm({ ...form, compareAtPrice: e.target.value })}
              type="number" placeholder="3999"
              className="w-full bg-muted/50 border border-border rounded-xl px-3 py-2 text-sm outline-none focus:border-primary/60" />
          </div>
          <div className="md:col-span-2">
            <label className="text-sm font-medium block mb-1.5">Image URL</label>
            <input value={form.imageUrl} onChange={(e) => setForm({ ...form, imageUrl: e.target.value })}
              placeholder="https://cdn.example.com/product.jpg"
              className="w-full bg-muted/50 border border-border rounded-xl px-3 py-2 text-sm outline-none focus:border-primary/60" />
          </div>
          <div className="md:col-span-2">
            <label className="text-sm font-medium block mb-1.5">Product URL</label>
            <input value={form.productUrl} onChange={(e) => setForm({ ...form, productUrl: e.target.value })}
              placeholder="https://yourstore.com/products/earbuds-pro"
              className="w-full bg-muted/50 border border-border rounded-xl px-3 py-2 text-sm outline-none focus:border-primary/60" />
          </div>
          <div>
            <label className="text-sm font-medium block mb-1.5">Category</label>
            <input value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}
              placeholder="Electronics"
              className="w-full bg-muted/50 border border-border rounded-xl px-3 py-2 text-sm outline-none focus:border-primary/60" />
          </div>
          <div>
            <label className="text-sm font-medium block mb-1.5">SKU</label>
            <input value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })}
              placeholder="EAR-PRO-01"
              className="w-full bg-muted/50 border border-border rounded-xl px-3 py-2 text-sm outline-none focus:border-primary/60" />
          </div>
          <div className="md:col-span-2 flex items-center gap-3">
            <button
              onClick={() => setForm({ ...form, inStock: !form.inStock })}
              className={`relative w-10 h-5 rounded-full transition-colors ${form.inStock ? "bg-emerald-500" : "bg-muted"}`}
            >
              <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${form.inStock ? "translate-x-5" : "translate-x-0.5"}`} />
            </button>
            <span className="text-sm">{form.inStock ? "In stock" : "Out of stock"}</span>
          </div>
        </div>
        <div className="flex justify-end gap-2 p-5 border-t border-border sticky bottom-0 bg-card">
          <button onClick={onClose} className="px-4 py-2 rounded-xl border border-border hover:bg-accent text-sm font-medium">Cancel</button>
          <button onClick={save} disabled={saving}
            className="flex items-center gap-2 wa-gradient text-white font-semibold px-5 py-2 rounded-xl hover:opacity-90 disabled:opacity-40">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
            {saving ? "Saving…" : product ? "Update" : "Add Product"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Connect Store Modal ───────────────────────────────────────────────────
function ConnectStoreModal({ onClose, onConnected }: { onClose: () => void; onConnected: () => void }) {
  const [provider, setProvider] = useState<"shopify" | "woocommerce">("shopify");
  const [shopDomain, setShopDomain] = useState("");
  const [accessToken, setAccessToken] = useState("");
  const [apiSecret, setApiSecret] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    if (!shopDomain.trim() || !accessToken.trim()) { toast.error("Domain and token required"); return; }
    setSubmitting(true);
    try {
      const res = await fetch("/api/commerce/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider, shopDomain, accessToken, apiSecret }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success("Store connected — click Sync to import products");
      onConnected();
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Connect failed");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="bg-card border border-border rounded-2xl shadow-2xl w-full max-w-lg">
        <div className="flex items-center justify-between p-5 border-b border-border">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-emerald-500/10 flex items-center justify-center">
              <Store className="w-4 h-4 text-emerald-400" />
            </div>
            <div>
              <h3 className="font-semibold">Connect a Store</h3>
              <p className="text-xs text-muted-foreground">Sync products from Shopify or WooCommerce</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-muted/50"><X className="w-4 h-4" /></button>
        </div>
        <div className="p-5 space-y-4">
          {/* Provider */}
          <div className="grid grid-cols-2 gap-2">
            {([
              { id: "shopify"     as const, label: "Shopify",     color: "emerald" },
              { id: "woocommerce" as const, label: "WooCommerce", color: "violet" },
            ]).map((p) => (
              <button
                key={p.id}
                onClick={() => setProvider(p.id)}
                className={`p-3 rounded-xl border text-left transition-all ${
                  provider === p.id ? "border-primary bg-primary/5" : "border-border hover:bg-muted/30"
                }`}
              >
                <Globe className={`w-4 h-4 mb-1 text-${p.color}-400`} />
                <p className="text-sm font-semibold">{p.label}</p>
              </button>
            ))}
          </div>

          {/* Help */}
          <div className="bg-blue-500/5 border border-blue-500/20 rounded-xl p-3 text-xs text-muted-foreground">
            {provider === "shopify" ? (
              <>
                <p className="font-medium text-foreground mb-1">Shopify Admin API token</p>
                <p>Settings → Apps → Develop apps → Create app → grant <code className="bg-muted/50 px-1 rounded">read_products</code> scope → Install → copy Admin API access token.</p>
              </>
            ) : (
              <>
                <p className="font-medium text-foreground mb-1">WooCommerce REST API key</p>
                <p>WP Admin → WooCommerce → Settings → Advanced → REST API → Add key (Read permission). Copy both Consumer Key and Secret.</p>
              </>
            )}
          </div>

          <div>
            <label className="text-sm font-medium block mb-1.5">
              {provider === "shopify" ? "Shop domain *" : "Store URL *"}
            </label>
            <input
              value={shopDomain}
              onChange={(e) => setShopDomain(e.target.value)}
              placeholder={provider === "shopify" ? "mystore.myshopify.com" : "https://yourstore.com"}
              className="w-full bg-muted/50 border border-border rounded-xl px-3 py-2 text-sm outline-none focus:border-primary/60"
            />
          </div>

          <div>
            <label className="text-sm font-medium block mb-1.5">
              {provider === "shopify" ? "Admin API access token *" : "Consumer Key *"}
            </label>
            <input
              value={accessToken}
              onChange={(e) => setAccessToken(e.target.value)}
              placeholder={provider === "shopify" ? "shpat_…" : "ck_…"}
              className="w-full bg-muted/50 border border-border rounded-xl px-3 py-2 text-xs font-mono outline-none focus:border-primary/60"
            />
          </div>

          {provider === "woocommerce" && (
            <div>
              <label className="text-sm font-medium block mb-1.5">Consumer Secret *</label>
              <input
                value={apiSecret}
                onChange={(e) => setApiSecret(e.target.value)}
                placeholder="cs_…"
                className="w-full bg-muted/50 border border-border rounded-xl px-3 py-2 text-xs font-mono outline-none focus:border-primary/60"
              />
            </div>
          )}

          <button
            onClick={submit}
            disabled={submitting}
            className="w-full flex items-center justify-center gap-2 wa-gradient text-white font-semibold py-2.5 rounded-xl hover:opacity-90 disabled:opacity-50"
          >
            {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
            {submitting ? "Connecting…" : "Connect Store"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Cart list ─────────────────────────────────────────────────────────────
function CartList({ carts, onChanged }: { carts: CartRow[]; onChanged: () => void }) {
  const [recoveringId, setRecoveringId] = useState<string | null>(null);

  const recover = async (cartId: string) => {
    const templateId = prompt("Template ID for recovery message:");
    if (!templateId) return;
    setRecoveringId(cartId);
    try {
      const res = await fetch(`/api/carts/${cartId}/recover`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ templateId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success(`Recovery sent to ${data.sentTo}`);
      onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Send failed");
    } finally {
      setRecoveringId(null);
    }
  };

  if (carts.length === 0) {
    return (
      <EmptyState
        icon={ShoppingCart}
        title="No abandoned carts"
        description="Carts created via /api/carts will appear here. Connect a Shopify webhook to capture abandoned checkouts automatically."
      />
    );
  }

  return (
    <div className="bg-card border border-border/50 rounded-2xl overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-xs text-muted-foreground border-b border-border/40 bg-muted/30">
            <th className="text-left px-4 py-3 font-medium">Customer</th>
            <th className="text-left px-4 py-3 font-medium">Items</th>
            <th className="text-right px-4 py-3 font-medium">Value</th>
            <th className="text-left px-4 py-3 font-medium">Status</th>
            <th className="text-left px-4 py-3 font-medium">Last activity</th>
            <th className="text-right px-4 py-3 font-medium">Actions</th>
          </tr>
        </thead>
        <tbody>
          {carts.map((c) => (
            <tr key={c.id} className="border-b border-border/20 last:border-0 hover:bg-muted/20">
              <td className="px-4 py-3">
                <p className="font-medium">{c.contact?.name}</p>
                <p className="text-[11px] text-muted-foreground">{c.contact?.phone}</p>
              </td>
              <td className="px-4 py-3 text-muted-foreground">{c.items_count} items</td>
              <td className="px-4 py-3 text-right font-semibold">{formatINR(c.total)}</td>
              <td className="px-4 py-3">
                <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
                  c.status === "abandoned" ? "bg-amber-500/10 text-amber-400 border border-amber-500/20" :
                  c.status === "recovered" ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20" :
                  c.status === "converted" ? "bg-blue-500/10 text-blue-400 border border-blue-500/20" :
                                              "bg-muted/40 text-muted-foreground"
                }`}>
                  {c.status}
                </span>
              </td>
              <td className="px-4 py-3 text-[11px] text-muted-foreground">
                {c.recovery_message_sent_at
                  ? `Recovery sent · ${new Date(c.recovery_message_sent_at).toLocaleDateString()}`
                  : c.abandoned_at
                  ? new Date(c.abandoned_at).toLocaleDateString()
                  : "—"}
              </td>
              <td className="px-4 py-3 text-right">
                {c.status === "abandoned" && (
                  <button
                    onClick={() => recover(c.id)}
                    disabled={recoveringId === c.id}
                    className="flex items-center gap-1.5 ml-auto px-3 py-1.5 rounded-lg wa-gradient text-white text-xs font-semibold hover:opacity-90 disabled:opacity-50"
                  >
                    {recoveringId === c.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}
                    Send Recovery
                  </button>
                )}
                {c.checkout_url && (
                  <a href={c.checkout_url} target="_blank" rel="noreferrer"
                    className="text-xs text-muted-foreground hover:text-primary inline-flex items-center gap-1 ml-2">
                    <ExternalLink className="w-3 h-3" />
                  </a>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
