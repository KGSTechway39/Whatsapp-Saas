# Phase 0 — Current State Report

**SendAnjal · KGS Techway Services · 2026-07-30 · read-only pass, no code modified**

## Purpose

Ground the redesign in what the repository and production database actually contain, and
name every place that diverges from the Ground Truth section of the operating prompt.

## Method & evidence standard

| Evidence class | Source | Confidence |
|---|---|---|
| Dependencies, files, code paths | Direct read of the working tree | **High** |
| Live schema, RLS, config rows | Direct SQL against Supabase project `tbqfsudapxfqakzqbkgb` | **High** |
| Build health | `tsc --noEmit` → 0, `next build` → 0 | **High** |
| Runtime behaviour | Dev server driven over HTTP this session | **High** |
| Meta platform roadmap (ESU v4, Oct 15 2026) | **Ground Truth only — not independently verifiable from this repo, and outside my knowledge cutoff** | **Unverified** |
| Vercel Deployment Protection state | **Not inspectable from the repo** | **Unverified** |

A full due-diligence review already exists at [`docs/architecture/`](architecture/README.md)
(22 documents). This report does not repeat it — it reconciles it against Ground Truth and
points into it.

---

## 🔴 Section A — Ground Truth reconciliation

**This is the most important section. Six of the stated constraints do not match the repository.**

### A.1 Stack

| Ground Truth states | Repository contains | Status |
|---|---|---|
| **Fastify** | **Next.js 14 App Router route handlers.** 113 `app/api/**/route.ts` files. `next@^14.2.35`. `fastify` **absent from package.json** | 🔴 **Diverges** |
| **Prisma ORM** | **Not a runtime dependency.** Neither `prisma` nor `@prisma/client` is in package.json; `PrismaClient` is imported **nowhere**. `prisma/schema.prisma` exists (671 lines, 20 models) but its own header (lines 1–14) declares it *"REFERENCE / DOCUMENTATION … The application talks to it via the @supabase/supabase-js client, not via Prisma at the moment."* It also models the **organization** tenant shape, which is not deployed | 🔴 **Diverges** |
| **Redis + BullMQ** | **pg-boss** (`pg-boss@^12.21.1`) behind a swappable driver (`lib/queue/index.ts`). `bullmq`, `ioredis`, `redis` all **absent**. The project's own `sendanjal-core` skill states: *"pg-boss for the job queue. NO Redis/BullMQ unless asked."* | 🔴 **Diverges** |
| **PostgreSQL with Row-Level Security** | Postgres ✅. RLS is **enabled on all 37 tables with ZERO policies** — `pg_policies` returns 0 rows; Supabase advisor reports 37 × `rls_enabled_no_policy`. Net effect: `anon`/`authenticated` are denied everything (safe), but every API route uses the **service-role key, which bypasses RLS entirely**. Tenant isolation is 100% hand-written `.eq("user_id", …)` across ~78 route files | 🟠 **Partially diverges — RLS exists as a switch, not as protection** |
| **React frontend** | React 18 ✅, but as Next.js App Router pages, not a separate SPA. 41 of 43 pages are `"use client"` | 🟡 **Nuance** |
| **Razorpay** | ✅ `razorpay@^2.9.6`, webhook HMAC-verified, insert-first idempotency | ✅ **Matches** |
| **Node.js / TypeScript** | ✅ TypeScript 5.9.3 `strict`, clean `tsc` | ✅ **Matches** |

### A.2 Database hosting — *Ground Truth asked to confirm this from the repo*

**Confirmed: Supabase**, project `tbqfsudapxfqakzqbkgb`.
`.env.local` sets `NEXT_PUBLIC_SUPABASE_URL=https://tbqfsudapxfqakzqbkgb.supabase.co`.

**`DATABASE_URL` is not set.** That matters: `lib/queue/index.ts:86-87` requires
`DATABASE_URL` for the pg-boss driver, so **pg-boss cannot run today even if enabled**.

### A.3 Other Ground Truth items

| Ground Truth states | Reality | Status |
|---|---|---|
| Meta rate table is a configurable DB table | ✅ `meta_rates` (4 live rows, region IN, Jan-2026 wholesale). Read at send time via `lib/billing/rates.ts`. Config-over-code precedent is real and worth extending | ✅ **Matches** |
| AI credits in a wallet separate from message credits | ✅ `ai_credit_wallet` / `ai_credit_ledger`, distinct from `wallet` / `transactions`. `lib/ai/wallet.ts:5-8` states the rule explicitly | ✅ **Matches** |
| AI scoped to 3 features; no Autopilot | ✅ No autopilot exists. ⚠️ But `ai_model_config` holds **6 task types**, not 3 (the 3 client-facing ones plus `automation_runtime_intent`, `appointment_nl_parse`, `reminder_draft`). `reminder_draft` is configured with **no call site** | 🟡 **Mostly matches** |
| Runtime intent classification on a cheap model (e.g. Gemini Flash-Lite) | 🔴 **Live config routes `automation_runtime_intent` to `anthropic` / `claude-haiku-4-5`** — not Gemini. A `GeminiAdapter` is fully implemented (`lib/ai/service.ts:82-108`) and **unused**. `lib/ai/service.ts:76-81` documents the intended Flash-Lite design; the DB row contradicts it | 🔴 **Diverges — and it is a margin leak** |
| Every AI output is a draft; nothing reaches a customer unconfirmed | ✅ Architecturally enforced — `runTask` never sends. One violation existed (`aiReplyNode` called the Anthropic SDK directly with hardcoded model ids, bypassing tier gating, credit metering and logging); **fixed earlier this session** and routed through `runTask` | ✅ **Now matches** |
| Tenant roles Owner / Manager / Staff | 🔴 **Do not exist.** No `users.role` column. `lib/auth.ts:44` states: *"There is no role column on `users` — admin is an operational allowlist."* `team_members.role` stores `owner`/`admin`/`agent` and is **never read by any authorization check**; invited members **have no login path** | 🔴 **Diverges** |
| `sendanjal-vertical-saas-blueprint.md` exists as v1 draft to extend | 🔴 **Not found** in the working tree, in git history, or in `~/Desktop`, `~/Documents`, `~/Downloads` | 🔴 **Missing input** |

---

## 🚧 Section B — The blocking question

**Is the Fastify / Prisma / Redis+BullMQ stack the intended *target* of this redesign, or a
mis-description of current state?**

The answer changes everything downstream, and I will not guess:

| If it is… | Then Phase 1 must… | Cost |
|---|---|---|
| **Target state** (deliberate migration) | Treat this as a **full backend re-platform** — 113 route handlers → Fastify, `supabase-js` → Prisma, pg-boss → BullMQ+Redis, plus the Railway/Render move | **Months.** Every Phase 2/3 estimate changes. Industry Packs and AI Center sit behind it |
| **Mis-description** (target stack written from a template/other project) | Design on the **actual** stack: Next.js route handlers, Supabase, pg-boss, and *add* Prisma only if type-safety is the goal (generated Supabase types achieve that more cheaply — see §E.1) | Roadmap proceeds as in `docs/architecture/21` |

**This has now been flagged twice.** `docs/verticals/PHASE-0-AUDIT.md:17-40` (2026-07-27)
raised the identical divergence — *"The master prompt describes a stack and a tenant model
that are not this repo"* — and resolved it by building on the real stack. The same
assumption has re-entered the planning input, which suggests a stale source document is
feeding these prompts.

**I need this answered before Phase 1.** It is question Q1 in §H.

---

## Section C — What exists and works today

Verified working, in production shape. **Do not rewrite these.**

| Capability | Where | Evidence |
|---|---|---|
| **Prepaid billing (reserve → confirm-on-delivery)** | `lib/billing/*` (6 files) | Reserve holds funds, Meta status webhook settles or releases. Integer paise, row-locked SQL RPCs, triple idempotency. *A message that never reaches `sent` is never charged* |
| **Margin trail per message** | `message_billing` | Snapshots `wholesale_paise` + `markup_bps` so margin survives rate changes |
| **Config-driven rates** | `meta_rates`, `plan_tiers`, `platform_settings`, `topup_bands` | All admin-editable, no deploy |
| **Webhook integrity** | `app/api/webhook/whatsapp/route.ts` | HMAC over raw bytes with `timingSafeEqual`; `processed_events` dedup with per-consumer keys; persist-then-enqueue to `webhook_inbox`; always-200 to prevent Meta retry storms |
| **Governed AI layer** | `lib/ai/service.ts` (344 L) | Single `runTask` path: config load → tier gate → credit pre-check → timed call → validate/retry → debit-on-success → always-log. No model id in any route |
| **Industry packs (data-driven)** | `lib/verticals/*` (2,333 L), migration 026 | **Deployed and seeded: 6 verticals, 58 artifacts.** Rule enforced (`lib/verticals/types.ts:4-7`): no vertical name/copy/flow may be hardcoded. Seed-time validation via `sanitizeFlowGraph` + a jargon blocklist |
| **Public API v1** | `app/api/v1/*` (9 routes) | SHA-256 hashed keys, 6 scopes with inheritance, per-key limits, `client_reference` idempotency, OTP flow |
| **Queue abstraction** | `lib/queue/index.ts` | Clean `QueueDriver` interface; durability is a config change |
| **Campaign fan-out** | `app/api/campaigns/execute` | Reserve-whole → 50-batch → settle-per-unit → release |

**Live tenant data:** 1 user (`admin@sendanjal.com`, enterprise/byo, vertical = `ecommerce`),
1 WhatsApp number, 21 contacts, 3 automation flows, 6 templates, 0 conversations, 0 messages.

---

## Section D — What is stubbed or unreachable

| Item | State | File |
|---|---|---|
| **Admin surface** | Pages exist and return 200 (`/admin`, `/admin/rates`, `/admin/clients/[id]/setup`) but **there is no Admin link in the sidebar** — reachable only by typing the URL | `components/layout/Sidebar.tsx` has zero admin entries |
| **Vertical rails** | Render only inside `/templates`, `/automation`, and campaign AI assist, gated `if (verticalId)`. No dedicated vertical surface | `components/verticals/Recommendations.tsx` |
| **Appointments** | 3 pages, 1,337 LOC, `DEMO_APPOINTMENTS` in `useState`. **No API, no table** | `app/(dashboard)/appointments/*` |
| **Team members** | UI invites people who then have **no way to log in** and whose role is never enforced | `app/(dashboard)/settings/team` |
| **Password reset** | UI collects an email and returns success; backend has `// TODO: integrate an email provider` and sends nothing | `app/api/auth/forgot-password/route.ts:20` |
| **Analytics** | Reads `daily_analytics`, which **nothing writes** — `upsert_daily_analytics()` is not deployed | `app/api/analytics` |
| **Multi-step flows** | `waitNode` correctly persists `status='waiting'` + `resume_at`, and the partial index exists — but **nothing reads `resume_at`**. Flows never resume | `app/api/automation-flows/[id]/execute/route.ts:160-168` |
| **Inbox badge** | Hardcoded to `3` | `Sidebar.tsx:50` |
| **`reminder_draft` AI task** | Configured in `ai_model_config`, no call site | — |

---

## Section E — What is missing

### E.1 Nineteen tables the code queries do not exist in production

Verified by cross-joining code-referenced table names against `information_schema.tables`:

`organizations` · `organization_members` · `whatsapp_accounts` · `phone_numbers` ·
`access_tokens` · `webhook_subscriptions` · `webhook_logs` · `ad_campaigns` · `ad_leads` ·
`products` · `carts` · `cart_items` · `crm_pipeline` · `crm_deals` · `crm_activities` ·
`appointments` · `subscriptions` · `agent_stats` · `segments`

Consequence: ~34 route files and 7 navigable pages (CRM, Catalog, Ads ROI, Segments,
Appointments) fail silently or 500. `supabase-js` returns `{data: null, error}` rather than
throwing, and most call sites ignore `error`.

> **Root cause, and the cheapest fix:** the type system cannot see the database. `tsc` passes
> cleanly on code that queries tables which do not exist. **`supabase gen types typescript`
> → `createClient<Database>()` converts this entire class of defect into build errors** —
> roughly 1–2 days, and materially cheaper than adopting Prisma, which would also fight the
> RPC-based money layer.

### E.2 Other structural gaps

| Missing | Impact |
|---|---|
| **RBAC of any kind** | No seats, no delegation, no Owner/Manager/Staff. Blocks reception staff, agencies, brokerages, and every enterprise conversation |
| **Organizations** | `users.id` **is** the tenant. No org, no tenant switcher, no seats |
| **RLS policies** | 0 across 37 tables. No database backstop for isolation |
| **Audit on financial actions** | `audit_logs` covers 10 ESU/token actions. **Zero coverage of rate, margin, billing-mode, tier or AI-config changes** — fails any financial-controls review |
| **Meta token rotation** | `token_expires_at` exists; nothing reads it. Long-lived tokens are ~60 days ⇒ predictable tenant-wide outages |
| **Notifications** | No low-balance alert (threshold columns exist and are read), no template approve/reject relay, no quality-rating alert |
| **GST invoicing** | Nothing generates an invoice. Hard blocker for India B2B |
| **Localisation** | `profileSchema` accepts 7 language codes; **nothing consumes them**. Zero strings externalised |
| **CI / tests** | No `.github/`, no ESLint config, **no unit tests**. 212 lines of Playwright e2e total. `npm run check` exists and is good, but nothing runs it |
| **Observability** | Structured JSON logger with **no sink**. No APM, no alerting, no correlation ids |

---

## Section F — The two P0 blockers

Per the operating prompt these get their own sequencing slot and were **not touched**.

### F.1 Webhook verification failing

**What I can confirm from code:** the handler is correct.

- `GET` verify: 403 if `WHATSAPP_WEBHOOK_VERIFY_TOKEN` unset; echoes `hub.challenge` when
  `hub.mode === "subscribe"` and the token matches exactly (`route.ts:41-56`).
- `POST` verify: HMAC-SHA256 over **raw bytes read before JSON parse**, compared with
  `timingSafeEqual` (`route.ts:18-33`). This is the correct implementation.
- `WHATSAPP_WEBHOOK_VERIFY_TOKEN` **is set** in `.env.local`.

**What I cannot confirm from the repo — and these are the likely causes:**

| Hypothesis | Why plausible | How to test |
|---|---|---|
| **Vercel Deployment Protection** | Intercepts the request before the route runs; Meta receives an auth page, never the challenge. Not visible in repo config | `curl` the production webhook URL unauthenticated — if you get an HTML auth page, this is it |
| **Env var not set in the Vercel project** | Set locally ≠ set in production | Vercel dashboard / `vercel env ls` |
| **Token mismatch** | Value in Meta App config ≠ value in Vercel env | Compare both |
| **Non-prod signature bypass** | `route.ts:19-22` returns `true` when `META_APP_SECRET` is unset **and** `NODE_ENV !== "production"`. Safe on Vercel (previews run as production) but unsafe on self-hosted staging | Confirm `META_APP_SECRET` is set in every environment |

⚠️ There are **two** webhook URLs: `/api/webhook/whatsapp` (canonical) and
`/api/webhooks/whatsapp` (a 19-line re-export alias). Numbers may be subscribed at either.
Verify which URL is registered in the Meta App.

### F.2 Persistent workers not supported on Vercel

**Confirmed, but differently shaped than Ground Truth describes** — there is no BullMQ.

| Layer | Reality |
|---|---|
| Driver in use | `QUEUE_DRIVER` **unset** → `InlineDriver`: `void Promise.resolve().then(handler)`. Runs in-process, detached from the response. **Not durable** — Vercel may freeze or terminate the function after the response, losing in-flight work |
| pg-boss driver | Implemented, but requires `DATABASE_URL` (session-mode, port 5432) which is **not set**. **Cannot run today** |
| Drain cron | `vercel.json` → `"schedule": "0 0 * * *"` — **once daily**. `CLAUDE.md` claims "every minute". With pg-boss enabled, an inbound automation reply could wait **24 hours** |
| Flow resumption | Not implemented at all — `resume_at` is written and never read |

**Implication for the redesign:** anything depending on reliable async — multi-step
journeys, reminder cadences, worker monitoring, queue-health dashboards — is blocked on the
Railway/Render migration **plus** `DATABASE_URL` **plus** a minute-granularity scheduler.
Design it; do not assume it.

**One positive:** every inbound webhook payload is already persisted to `webhook_inbox`
before processing, and the partial index `WHERE status <> 'processed'` exists — so a replay
job on the new host can recover anything lost. Nothing reads it yet.

---

## Section G — Embedded Signup status

**Ground Truth: "v2 → v4 migration, hard deadline October 15, 2026."**

What the code actually does (`components/whatsapp/EmbeddedSignupModal.tsx:415-440`):

```
FB.login(cb, {
  config_id: CONFIG_ID,
  response_type: "code",
  override_default_response_type: true,
  override_min_version: SDK_VERSION,          // v19.0
  extras: {
    feature: "whatsapp_embedded_signup",
    sessionInfoVersion: 3,                    // ← v3, not v2
    ...(path === "A" ? { featureType: "only_waba_sharing" } : {}),
    ...(setup ? { setup } : {}),              // pre-fills business name/city/vertical
  },
})
```

| Finding | Detail |
|---|---|
| Implemented version | **`sessionInfoVersion: 3`** — the code is **not on v2** |
| Docs are stale | `docs/embedded-signup.md:168,263` describe `sessionInfoVersion: 2` and reference a component `ConnectWhatsApp.tsx` that **does not exist** (it is `EmbeddedSignupModal.tsx`) |
| Version pinning | `lib/meta-version.ts` — `GRAPH_API_VERSION = v22.0`, `META_SDK_VERSION = v19.0`, deliberately separate with a documented reason |
| Config id | Falls back through `NEXT_PUBLIC_META_CONFIGURATION_ID` → `NEXT_PUBLIC_META_CONFIG_ID`, with placeholder sentinels at lines 156-157 |
| **Known runtime defect** | The token handoff between `exchange-token` and `save-account` uses a **per-process in-memory `Map`** (`lib/whatsapp/token-cache.ts:8`, self-documented "Single-instance only"). On Vercel these are separate invocations that may land on different instances ⇒ **onboarding fails intermittently**. Fix without new infra: a signed short-TTL JWE cookie |

⚠️ **I cannot verify the v4 requirements or the October 15 2026 deadline** — that is a Meta
platform fact outside this repository and outside my knowledge cutoff. Treating it as a
firm constraint per Ground Truth, but the **starting point is v3, not v2**, which likely
reduces the migration's size. Please confirm against Meta's current developer changelog.

---

## Section H — Tier & billing reality

Live `plan_tiers`:

| Tier | Price | Model | `billing_mode` | `waba_mode` | Markup | Cap | Can it send? |
|---|---:|---|---|---|---:|---:|---|
| starter | ₹999 | C | managed | **shared** | 2500 bps | 5,000/mo | 🔴 **No** |
| growth | ₹1,999 | B | managed | own | 1800 bps | — | ⚠️ Sends, but see below |
| enterprise | ₹4,999 | A | byo | own | 1000 bps | — | ✅ Yes |

**Ground Truth says Growth is broken. The code supports that, and Starter is broken too —
for a different reason.**

### H.1 Starter (Model C) cannot send

`lib/billing/tiers.ts:15-18`: *"`waba_mode='shared'` (starter / Model C) requires a
platform-owned WhatsApp number pool to actually send — that provisioning is deferred …
shared-WABA send routing is not built yet."*

So the tier aimed at the largest, most price-sensitive segment is **purchasable but not
usable**. Every micro-business must instead complete Embedded Signup with their own WABA —
exactly the complexity the product exists to remove.

### H.2 Growth (Model B) — the economics do not close

Code-verifiable: a `managed` send debits the SendAnjal wallet
(`lib/billing/guarded-send.ts`) **while sending via the client's own decrypted token**
(`app/api/whatsapp/send/route.ts:34,48`). The WABA is the client's, so Meta bills the
client; SendAnjal also charges them from the prepaid wallet. Either the client pays twice, or
SendAnjal collects revenue for conversations it never pays Meta for — and the `meta_rates`
wholesale figures, which assume SendAnjal is the payer, do not apply.

This corroborates the Ground Truth statement that Growth assumes a credit line the Tech
Provider tier does not have. **It needs restructuring, not a bug fix.**

### H.3 Additional revenue leaks

| Leak | Evidence |
|---|---|
| `monthly_msg_cap` (5,000 on Starter) is read into `TierConfig` and **never enforced** | `lib/billing/rates.ts:24` |
| `credit_validity_months = 12` is read and **never enforced** — breakage modelled, not collected | `platform_settings` |
| Pricing **fails soft to cheaper legacy defaults** if `plan_tiers`/`platform_settings` read fails: derived MARKETING = 110p vs legacy default 88p. Silent undercharge, no warning | `lib/billing/pricing.ts:46-77` |
| No `meta_rates` staleness alert | Rates change ~6-monthly; an unnoticed rise means selling below cost |
| `razorpay_plan_key` is NULL on all 3 tiers — env vars used instead | `plan_tiers` |

---

## Section I — Work completed earlier this session

For continuity. All verified: `tsc` 0, `next build` 0, exercised over HTTP against the
running app.

| Fix | File |
|---|---|
| 5 cross-tenant IDORs + upfront ownership gate — incl. one that decrypted **another tenant's WhatsApp token and sent as their business** | `app/api/automation-flows/[id]/execute/route.ts` |
| Unbounded flow loop → `visited` set + step cap; cycle rejection at save time | same + `lib/automation/flow-schema.ts` |
| `addTagNode` wrote to non-existent `crm_notes` → now `contacts.tags` | same |
| `aiReplyNode` bypassed AI governance with hardcoded model ids → routed through `runTask` | same + `lib/ai/config.ts` |
| Inbound `messages` insert used a non-existent column ⇒ **no inbound message ever persisted** | `app/api/webhook/whatsapp/route.ts` |
| Cross-tenant `contacts` write on the 24h-window field | same |
| Token resolution read the undeployed `whatsapp_accounts` ⇒ automation replies computed then dropped | `lib/whatsapp/dispatch.ts` |

---

## Assumptions & Open Questions

### Assumptions made in this report

| # | Assumption | Basis |
|---|---|---|
| A1 | Ground Truth's ESU v4 deadline of 2026-10-15 is accurate | Stated as constraint; not verifiable here |
| A2 | The Vercel project is the production deployment | `.vercel/` present, `vercel.json` crons |
| A3 | "Growth broken" refers to the Model B credit-line premise | Corroborated by §H.2 |
| A4 | `admin@sendanjal.com` is a seeded demo account, not a real customer | Name, and `ADMIN_EMAILS` membership |

### 🚧 Blocking questions — Phase 1 cannot start without Q1 and Q2

| # | Question | Why blocking |
|---|---|---|
| **Q1** | **Is the Fastify / Prisma / Redis+BullMQ stack a target-state migration, or a mis-description of current state?** | Determines whether Phase 1 designs a full re-platform (months, everything sequenced behind it) or extends the actual stack. See §B |
| **Q2** | **Where is `sendanjal-vertical-saas-blueprint.md`?** Not in the repo or git history. The prompt forbids regenerating it from scratch | Without it I cannot "extend, not restart." If it is lost, please confirm whether `docs/platform-v2/00–02` (written this session: vision, personas, module catalogue, IA) may serve as the v1 baseline instead |

### ❓ Decision questions — flagged per the prompt, not assumed

| # | Item | My recommendation, for your decision |
|---|---|---|
| **Q3** | Reseller / Partner / Sales & Finance role layer | **Defer.** It is a generalisation of multi-seat RBAC, which does not exist yet. Build `users.role` + Owner/Manager/Staff first; partner tenancy is a parent-child extension afterwards. Agencies are likely your strongest India channel, which is *why* it deserves its own architecture rather than being rushed |
| **Q4** | Multi-AI-provider abstraction | **Interface only.** `ProviderAdapter` + `getAdapter()` already exist and are the right seam. Two live providers per Ground Truth. **One live action needed: repoint `automation_runtime_intent` from Anthropic to the cheap model — a single DB row, no deploy** (§A.3) |
| **Q5** | GST / coupons / wallet / billing history | **Sequence after the Growth-tier restructure.** Building invoicing on top of a billing model whose economics don't close means rebuilding it. GST is a genuine India B2B sales blocker, so it should be next |
| **Q6** | Supabase vs plain Postgres | **Answered: Supabase** (§A.2). Sub-question for you: does the Railway/Render migration move *compute only*, or also the database? Moving compute only is far lower risk |

### Additional questions surfaced by this pass

| # | Question |
|---|---|
| Q7 | The 19 missing tables: for each feature (CRM, Catalog, Ads, Segments, Appointments), **deploy or delete?** This gates both roadmap scope and any UI work |
| Q8 | Given no RBAC exists, do you want `users.role` + Owner/Manager/Staff inside the Growth-tier fix window, or as its own workstream? It blocks 4 of the personas |
| Q9 | Confirm the production webhook URL registered with Meta — singular `/api/webhook/whatsapp` or the plural alias? |

---

## Phase 0 exit

**Status: complete. Awaiting approval to proceed to Phase 1.**

Per the operating prompt I am stopping here and will not chain to Phase 1. **Q1 and Q2 must
be answered first** — without Q1 the architecture is unbuildable, and without Q2 I would be
violating the "extend, don't regenerate" restriction.

**Files analysed:** `package.json`, `vercel.json`, `.env.local`, `lib/` (billing, ai,
whatsapp, verticals, automation, queue, auth, crypto), `app/api/**` (113 routes, 18 read in
full), `components/whatsapp/EmbeddedSignupModal.tsx`, `components/layout/Sidebar.tsx`,
`prisma/schema.prisma`, `supabase/migrations/` (34 files), all of `docs/`, plus the live
Supabase schema, constraints, indexes, policies and config rows.

**Not analysed:** Vercel project settings (not in repo), Meta App configuration (external),
36 page component bodies, `lib/{segments,commerce,meta-ads,webhooks-out,razorpay,google-oauth,email}.ts`.
