# 13 — Performance Report

## Executive summary

Performance has not yet been engineered — which is reasonable for a pre-launch product,
but three problems are structural rather than incremental and will not be fixable by tuning:

1. **Frontend: no server rendering of data.** 41 of 43 pages are `"use client"`. Every
   screen is HTML shell → JS bundle → hydrate → `useEffect` → `fetch` → render. There is no
   `loading.tsx` anywhere, so every navigation shows a blank main area. 17,247 LOC of
   dashboard ships to the browser.
2. **Backend: no caching.** Four config tables (`meta_rates`, `plan_tiers`,
   `platform_settings`, `ai_model_config`) are re-read on every send and every AI call. A
   single managed send performs **≈7 sequential Postgres round-trips** before it reaches Meta.
3. **Database: the hottest join key is unindexed.** `whatsapp_numbers.phone_number_id` is
   read on every inbound webhook event and has no index. Plus 13 unindexed foreign keys
   (Supabase advisor).

Nothing here is dangerous at current scale (the database has zero rows). All three become
walls at roughly 100 tenants / 10k messages a day.

**Risk level:** Medium · **Complexity:** Medium · **Confidence:** Medium-High (82%) —
DB facts are from live queries and the advisor; frontend facts are from directive/hook
scans; **no runtime profiling, Lighthouse run, or bundle analysis was performed.**

---

## 1. Largest components

| File | LOC | Type | Concern |
|---|---:|---|---|
| `components/whatsapp/EmbeddedSignupModal.tsx` | **1,313** | client | Largest file in the repo. Loads the Facebook JS SDK. Almost certainly in the `/numbers/connect` bundle |
| `app/(dashboard)/inbox/page.tsx` | **1,198** | client | Real-time-ish list + thread + composer in one component |
| `app/(dashboard)/campaigns/create/page.tsx` | **1,167** | client | Multi-step wizard, all `useState` |
| `app/(dashboard)/templates/page.tsx` | **1,073** | client | |
| `app/(dashboard)/automation/create/page.tsx` | **893** | client | `@xyflow/react` canvas |
| `app/(dashboard)/catalog/page.tsx` | 727 | client | 🔴 no backing table |
| `app/(dashboard)/segments/page.tsx` | 711 | client | 🔴 no backing table |
| `app/(dashboard)/settings/api/page.tsx` | 647 | client | |
| `app/(dashboard)/billing/page.tsx` | 622 | client | |
| `app/(dashboard)/automation/page.tsx` | 573 | client | |
| `app/(dashboard)/settings/api/docs/page.tsx` | 539 | client | Duplicate of `/docs/api` |
| `app/(dashboard)/ads/page.tsx` | 528 | client | 🔴 no backing table |

**Six components exceed 700 lines; two exceed 1,150.** At that size a component cannot be
memoised meaningfully, code-split, or reasoned about for re-render behaviour.

### Re-render risk

| Signal | Count | Implication |
|---|---:|---|
| `useState` | 50 files | Every state change re-renders the whole page component |
| `useMemo` | **3 files** | Expensive derivations recompute on every render |
| `useCallback` | 9 files | Child props change identity each render |
| `React.memo` | **not found** | No render bailouts |
| `useTransition` / `useOptimistic` | 0 | No concurrent-rendering benefits |

A 1,198-line component with ~15 `useState` hooks and no memoisation re-renders its entire
tree on every keystroke in a filter input. This is the most likely source of perceived UI
sluggishness on the data-dense screens (`inbox`, `segments`, `catalog`, `templates`).

---

## 2. Rendering strategy

| Capability | Status |
|---|---|
| React Server Components for data | 🔴 **None** |
| Streaming / `Suspense` boundaries for data | 🔴 None (3 files mention `Suspense`, none for fetching) |
| `loading.tsx` | 🔴 **0 files** |
| `error.tsx` | 🔴 0 files |
| Partial Prerendering (PPR) | 🔴 Requires Next 15+ |
| Static generation | 🔴 Everything is dynamic |
| ISR / `revalidate` | 🔴 Not used |
| `force-dynamic` | ✅ Used deliberately on `app/page.tsx` (commit `b27c093`) |

### The root cause, again

```ts
// app/(dashboard)/layout.tsx:1
"use client";
…
const [sidebarOpen, setSidebarOpen] = useState(false);
const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
```

Two booleans force the entire dashboard subtree into the client bundle. Extracting a
`<SidebarShell>` client island (~20 lines) makes the layout a Server Component and unblocks
RSC for all 41 pages. **This is the single highest-leverage performance change available.**

### Waterfall cost per navigation

```
Navigate → HTML shell (fast)
        → download + parse JS bundle          ~?ms   (unmeasured)
        → hydrate                              ~?ms
        → useEffect fires
        → fetch /api/x                         ~100–300ms
        → API: getSessionUser (JWT verify)     ~1ms
        → API: 1–5 Postgres queries            ~20–100ms
        → render
```

With no `loading.tsx`, the user sees a **blank `<main>`** for the whole of that chain.
Time-to-first-meaningful-paint on any dashboard page is bounded below by
bundle + hydrate + round-trip. Server rendering would collapse this to one round-trip
with visible content in the initial HTML.

---

## 3. Bundle size

**Not measured.** No `@next/bundle-analyzer`, no build output captured in this audit.
Qualitative inventory of what ships to the client:

| Contributor | Weight class | Notes |
|---|---|---|
| `framer-motion` ^12 | Heavy | Plus `tailwindcss-animate` — **two animation systems** |
| `recharts` ^2.12 | Heavy | Also the stated reason for `unsafe-eval` in the CSP |
| `@xyflow/react` ^12 | Heavy | Needed only by `/automation/create` |
| `react-day-picker` + `date-fns` | Medium | Used mainly by the **demo-only** appointments pages |
| `lucide-react` | Light | Tree-shakeable |
| 3 Google font families, 12 weights total | Medium | Plus Jakarta Sans (5 weights), Bricolage Grotesque (4), JetBrains Mono. `display: "swap"` ✅, `subsets: ["latin"]` ✅ |
| Facebook JS SDK | External | Loaded only in the ESU modal path |
| 41 client pages | **17,247 LOC** | App Router code-splits per route, so not all at once |

| Optimisation | Status |
|---|---|
| Route-level code splitting | ✅ Automatic (App Router) |
| `next/dynamic` for heavy components | 🔴 Not found — `@xyflow`, `recharts`, and `EmbeddedSignupModal` are all statically imported |
| `next/image` | 🟡 Configured (`remotePatterns` for dicebear) — but only **1 `alt=`** in the whole app, so images are barely used |
| Font optimisation | ✅ `next/font` with swap and latin subset |
| Tree shaking | ✅ Default |
| Bundle analyzer | 🔴 Not installed |

**Three specific wins available:** `next/dynamic` around the xyflow canvas, around Recharts
in `analytics`/`campaigns/[id]`, and around `EmbeddedSignupModal` (1,313 lines loaded on
`/numbers/connect` for a modal most users open once).

---

## 4. Database performance

### Live advisor results

| Lint | Count | Real? |
|---|---:|---|
| `unindexed_foreign_keys` | **13** | ✅ Genuine |
| `unused_index` | ~38 | ❌ **Meaningless** — the DB has zero rows, so no index has been exercised. Do not act on these |

### Unindexed foreign keys (all 13)

| Table | FK column |
|---|---|
| `automations` | `action_template_id` |
| `campaign_messages` | `contact_id` |
| `campaigns` | `template_id`, `whatsapp_number_id` |
| `chatbot_sessions` | `conversation_id`, `user_id` |
| `conversations` | `assigned_to`, `contact_id`, `whatsapp_number_id` |
| `message_billing` | `user_id` |
| `messages` | `campaign_id`, `contact_id`, `whatsapp_number_id` |

Consequence: `ON DELETE CASCADE` on a parent row triggers a sequential scan of the child
table. Deleting a `contact` with many `messages` scans `messages` fully. Also affects any
join on those columns.

### The missing index that matters most

```sql
-- NOT PRESENT
CREATE INDEX idx_whatsapp_numbers_pnid ON whatsapp_numbers(phone_number_id);
```

`phone_number_id` is how **every inbound webhook event** resolves its tenant:

| Site | Query |
|---|---|
| `lib/automation/runtime.ts:44-50` | `whatsapp_numbers.select("user_id").eq("phone_number_id", …)` |
| `app/api/webhook/whatsapp/route.ts:294-297` | CTWA path |
| `app/api/webhook/whatsapp/route.ts:394-398` | conversation path |

At 1,000 connected numbers × every inbound message, this is a sequential scan on the
platform's hottest read. **5-minute fix, first scaling wall removed.**

### Query patterns

| Pattern | Assessment |
|---|---|
| Tenant-scoped reads | ✅ Well indexed (`idx_*_user_id` on 8 tables) |
| Composite hot paths | ✅ `(user_id, phone)`, `(user_id, last_message_at DESC)`, `(user_id, status)`, `(conversation_id, created_at)` |
| Partial indexes | ✅ 6 of them, well chosen (`WHERE status='held'`, `WHERE status='reserved'`, `WHERE status<>'processed'`, …) |
| Webhook status join | ✅ `idx_campaign_messages_meta_id` |
| Config lookups | ✅ `(region, category, effective_from DESC)`, `(task_type, is_active, effective_from DESC)` |
| **Views / materialized views** | 🔴 **0** — every route re-derives its joins in TypeScript |
| `daily_analytics` | 🔴 Read by `/api/analytics`, **written by nothing** (`upsert_daily_analytics()` is not deployed) |

### N+1 patterns found

| # | Site | Pattern |
|---|---|---|
| 1 | `lib/meta.ts:70-122` `getWABAsForToken` | **1 + N + M sequential Graph calls**: `/me/businesses`, then per business `/whatsapp_business_accounts`, then per WABA `/phone_numbers`. Graph supports field expansion — this could be 1 call |
| 2 | `app/api/campaigns/execute` | Per-recipient `settle()` inside a 50-item loop → 50 RPC calls per batch. **Correct for money** (each unit must settle independently), so not a bug — but it is the throughput ceiling |
| 3 | `lib/whatsapp/engine.ts:398-427` `openSession` | select flow → insert session → select `total_triggered` → update. 4 round-trips (dead path) |
| 4 | `app/api/webhook/whatsapp:369-378` | select `leads_count` → update `leads_count + 1`. Read-modify-write instead of `SET leads_count = leads_count + 1` (dead path) |
| 5 | `lib/whatsapp/engine.ts:224-238` | Same read-modify-write on `total_completed` (dead path) |
| 6 | Frontend | Wallet balance, AI credits, and session user are each fetched independently by every page that needs them — a client-side N+1 across the app |

### The managed-send round-trip chain

```
guardedSingleSend
 ├─ getBillingMode      → SELECT users.billing_mode                    (1)
 ├─ quoteSend
 │   ├─ message_pricing override                                        (2)
 │   └─ deriveQuote
 │       ├─ SELECT users.tier                                           (3)
 │       └─ Promise.all([plan_tiers, platform_settings, meta_rates])  (4,5,6) ✅ parallel
 ├─ wallet_reserve RPC                                                  (7)
 ├─ ────── Meta Graph call ──────
 └─ message_billing INSERT                                              (8)
```

**8 database operations per managed message**, of which 3 are parallelised. The three
config reads (`plan_tiers`, `platform_settings`, `meta_rates`) hit tables with 3, 1, and 4
rows that change perhaps weekly. **A 60-second cache removes 3–5 round-trips from every
send** — roughly a 50% reduction in pre-Meta latency.

---

## 5. Pagination

| Surface | Status |
|---|---|
| `paginationSchema` (`lib/validate.ts:24`, max limit 200) | 🔴 Defined, **never imported** |
| `contacts.list` | ✅ Passes `page`/`limit` (`lib/api.ts:34-41`) |
| `campaigns.list` | 🟡 Passes `limit` only, no offset |
| `templates.list` | 🔴 No parameters |
| `automations.list` | 🔴 No parameters |
| `transactions`, `inbox`, `crm/*`, `segments`, `products` | **Unable to determine** — routes not read individually |
| Infinite scroll / virtualisation | 🔴 Not found. `inbox` (1,198 LOC) and `contacts` render full lists |

At 10,000 contacts, an unpaginated `templates` or `inbox` list transfers and renders
everything. With no list virtualisation, the DOM node count becomes the bottleneck before
the query does.

---

## 6. Caching

**Zero caching at every layer.**

| Layer | Available | Used |
|---|---|:-:|
| Browser HTTP cache | `Cache-Control` on API responses | 🔴 |
| Next.js `fetch` cache | Automatic for server `fetch` | 🔴 (no server fetching) |
| `unstable_cache` / `use cache` | Available | 🔴 |
| ISR / `revalidate` | Available | 🔴 |
| Vercel Runtime Cache | Available | 🔴 |
| Distributed cache (Redis/Upstash) | Not provisioned | 🔴 |
| In-process memoisation | Trivial to add | 🔴 |
| Client data cache (TanStack Query/SWR) | Not installed | 🔴 |
| CDN static assets | Vercel automatic | ✅ |

The only in-memory state is the two `Map`s used for rate limiting and the ESU token cache —
and both are *semantically wrong* on serverless rather than performance wins.

**Highest-value cache targets**, in order:

| Target | Reads | TTL | Saving |
|---|---|---|---|
| `plan_tiers`, `platform_settings` | every managed send | 300 s | 2 round-trips/send |
| `meta_rates` | every managed send | 60 s | 1 round-trip/send |
| `ai_model_config` | every AI call | 60 s | 1 round-trip/call |
| `users.tier` + `billing_mode` | every send + AI call | 30 s | 2 round-trips |
| `industry_verticals` + library | every AI call with a vertical | 300 s | 2 round-trips |

---

## 7. Serverless & memory characteristics

| Concern | Assessment |
|---|---|
| Cold starts | Mitigated by Fluid Compute instance reuse; 29 deps keeps the bundle small |
| Function timeout | Vercel default is now 300 s — comfortable for the 50-item campaign batch, but `campaigns/execute` caps at roughly 1,000 recipients per invocation at ~300 ms/send |
| **Continuation for large campaigns** | **Unable to determine** — no resume mechanism found. A 50,000-recipient campaign appears unsupported |
| Memory | No large in-memory structures except the two `Map`s (bounded by sweep timers) |
| `setInterval` on serverless | 🟡 `lib/rate-limit.ts:14` runs a 5-minute sweep **without `.unref()`**; `token-cache.ts:30` correctly calls `.unref?.()`. A non-unref'd timer can keep an instance alive |
| Connection pooling | 🟡 `supabase-js` is HTTP/PostgREST (stateless, fine). `pg-boss` needs **session-mode** Postgres (5432, no pooler) — one real connection per invocation |
| DB connection exhaustion | 🟠 Real risk if `QUEUE_DRIVER=pgboss` under concurrency |
| Response streaming | 🔴 Not used anywhere (streaming works on the Node.js runtime with no config) |

---

## 8. Network calls

| Path | External calls | Blocking the user? |
|---|---:|---|
| `/api/whatsapp/send` | 1 Graph | ✅ yes (acceptable — user-initiated) |
| `/api/templates/sync` | N Graph (auto-paginated) | ✅ yes 🟠 |
| `/api/meta/accounts` | 1 + N + M Graph | ✅ yes 🔴 N+1 |
| `/api/ai/*` | 1 provider (15–30 s timeout) | ✅ yes, with a spinner and no streaming 🟠 |
| `/api/campaigns/execute` | up to 1,000 Graph | ✅ yes 🔴 |
| `/api/webhook/whatsapp` | 0 before the 200 ack | ✅ correct |
| Client webhook dispatch | 1 per endpoint | ✅ async |

**Law #4** ("no synchronous external I/O in request handlers") is honoured on the webhook
path and violated on the user-facing routes. For interactive actions that is a defensible
trade — the user is waiting anyway — but `templates/sync` and `campaigns/execute` are
batch operations that belong on the queue.

---

## Advantages

- Index coverage for the *live* tenant model is genuinely good: 8 `user_id` indexes, 4
  well-chosen composites, and 6 partial indexes.
- Idempotency uniques are partial (`WHERE key IS NOT NULL`), so they cost nothing on rows
  without keys.
- `deriveQuote` parallelises its three config reads with `Promise.all`.
- The status update is a single race-safe UPDATE, not a read-modify-write.
- Campaign fan-out is batched (50) rather than unbounded.
- Fonts are optimised correctly (`next/font`, `swap`, latin subset).
- Route-level code splitting comes free with the App Router.
- Zero rows today ⇒ every fix below can be applied without a performance migration.

## Disadvantages

- No server rendering of data; every page is a client waterfall with a blank loading state.
- No caching anywhere ⇒ 8 DB operations per managed send.
- The hottest join key in the system is unindexed, plus 13 unindexed FKs.
- Six components over 700 lines with 3 `useMemo` and no `React.memo`.
- No `next/dynamic` on three heavy libraries.
- No list virtualisation; pagination inconsistent and the schema for it unused.
- Two animation libraries; `react-day-picker` shipped for a demo-only feature.
- N+1 Graph calls in WABA discovery.
- No streaming, despite it being free on the Node.js runtime.
- `daily_analytics` is read but never written, so analytics is both slow *and* empty.
- No measurement: no bundle analyzer, no Lighthouse baseline, no APM, no slow-query log.

## Recommendations

| P | Recommendation | Effort | Expected impact |
|---|---|---|---|
| **P0** | `CREATE INDEX idx_whatsapp_numbers_pnid ON whatsapp_numbers(phone_number_id)`. | 5 min | Removes a seq-scan from every inbound event |
| **P0** | Add the 13 missing FK indexes. | 30 min | Fixes cascade-delete scans and joins |
| **P0** | Establish a baseline: install `@next/bundle-analyzer`, capture a Lighthouse run on `/dashboard` and `/inbox`, enable Vercel Speed Insights. **Everything below should be measured, not assumed.** | 1 day | Makes the rest quantifiable |
| **P0** | Make `(dashboard)/layout.tsx` a Server Component via a `<SidebarShell>` island. | ~20 lines | Unblocks RSC for 41 pages |
| **P1** | Cache the 5 config reads (60–300 s) using Vercel Runtime Cache or `unstable_cache`. | 1 day | −3 to −5 round-trips per send, ~50% less pre-Meta latency |
| **P1** | Add `loading.tsx` + `error.tsx` per route group. | 1 day | Eliminates blank-screen navigation |
| **P1** | `next/dynamic` for `@xyflow/react`, `recharts`, and `EmbeddedSignupModal`. | 1 day | Meaningful reduction on 4 heavy routes |
| **P1** | Migrate the 10 heaviest pages to RSC data fetching. | 3 weeks | Removes the hydrate→fetch waterfall |
| P2 | Adopt TanStack Query (or Server Actions) for remaining client fetches — dedupes the wallet/credits/session N+1. | 1 week | Fewer requests, instant back-navigation |
| P2 | Batch `getWABAsForToken` using Graph field expansion. | 1 day | 1 + N + M → 1 call |
| P2 | Apply `paginationSchema` to every list route; virtualise `inbox` and `contacts`. | 1 week | Bounded payloads and DOM |
| P2 | Move `templates/sync` and `campaigns/execute` onto the queue with continuation for large campaigns. | 2 weeks | Removes the ~1,000-recipient ceiling; honours Law #4 |
| P2 | Deploy `upsert_daily_analytics()` or replace the analytics queries with live aggregates over `campaign_messages`. | 3 days | Analytics stops being empty |
| P2 | Add `.unref()` to the `rate-limit.ts` sweep interval. | 5 min | Avoids keeping instances warm needlessly |
| P3 | Add `React.memo` + `useMemo` to the six 700+ line pages; ideally split them first. | 2 weeks | Fixes keystroke-level re-render cost |
| P3 | Drop one animation library; drop `react-day-picker` with the appointments demo. | 3 days | Bundle |
| P3 | Introduce views for the repeated inbox/campaign/analytics joins. | 1 week | Fewer round-trips, one place to optimise |
| P3 | Stream AI responses (works on the Node.js runtime, no config). | 1 week | Turns 30 s spinners into progressive output |
| P3 | Plan Next.js 15/16 for PPR + Cache Components + Turbopack. Defer until the drift register is closed. | — | |
