# WASend — WhatsApp Business SaaS Platform

## What is this project?

WASend is a **multi-tenant WhatsApp Business API SaaS** for the Indian market. WASend
operates as a **Meta Tech Provider / BSP**: it onboards small businesses onto the
WhatsApp Business API, routes their messaging, and bills them — so clients never touch
Meta's technical complexity. Think "Mailchimp for WhatsApp", but where WASend is also
the telecom-style intermediary that fronts Meta.

> **Read the skills first.** Deep domain rules live in `.claude/skills/`. Always read
> `wasend-core` before touching any code, plus the relevant skill for the area:
> `messaging`, `billing-wallet`, `onboarding-signup`, `webhooks-automation`,
> `integrations`. Those skills — not this file — are the source of truth for the
> non-negotiable rules.

---

## The Laws (from `wasend-core` — violating any is a bug even if tests pass)

1. **Multi-tenant isolation is sacred** — every client-data table is tenant-scoped;
   never query across tenants.
2. **Meta wholesale rates are NEVER hardcoded** — they live in the `meta_rates` table
   (configurable, category × region × effective date). Read them at send time.
3. **Money mutations are atomic** — wallet deduction + send record in one DB
   transaction / RPC. Money is stored in **integer paise** (₹1 = 100 paise). No floats.
4. **No synchronous external I/O in request handlers** — handlers verify + persist +
   enqueue + return fast; workers call Meta.
5. **The 24-hour customer-service window governs every send** — free-form only inside
   an open window; templates required outside it.
6. **All Meta webhooks are verified + idempotent** — check `X-Hub-Signature-256`,
   dedupe on Meta's message/status id.
7. **Three billing models coexist** (A: client pays Meta; B: platform routes via shared
   credit line — the default profit engine; C: client under platform WABA — Starter
   tier). Code branches on the user's `billing_mode` (`byo` | `managed`); never assume.

All Meta Graph calls go through the typed wrappers in `lib/meta.ts` / `lib/meta-client.ts`
— never scatter `fetch('https://graph.facebook.com...')` in features.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 14 (App Router), full-stack TypeScript (`strict`) |
| Styling | Tailwind CSS, framer-motion, next-themes |
| Database | Supabase (PostgreSQL). Service-role client in API routes. **No Prisma.** |
| Auth | Custom JWT (`jose`) session cookie + Google OAuth. **Not** Supabase Auth. |
| Job queue | pg-boss (Postgres-backed), behind a swappable driver. **No Redis/BullMQ** unless asked. |
| Payments | Razorpay (subscriptions + wallet top-ups) |
| WhatsApp | Meta Business / Graph API (Embedded Signup onboarding) |
| AI | `@anthropic-ai/sdk` via a config-driven, credit-metered AI layer (`lib/ai/`) |
| Flow builder | `@xyflow/react` (automation flows) |
| Email | Resend (optional; logs to console if unset) |
| Charts / Icons / Toasts | Recharts / Lucide / Sonner |

---

## ⚠️ Deployment reality (important nuance)

The **deployed** production DB uses the **legacy `user_id` model** (each user IS the
tenant; data scoped by `user_id`, WhatsApp numbers in `whatsapp_numbers`). A newer
**organization model** (`organization_id`, `whatsapp_accounts`) exists in code and
migrations but **was never deployed**. When resolving tenants or writing tenant-scoped
queries in production paths, prefer the `user_id` / `whatsapp_numbers` model. Some newer
files assume the org model — treat those as not-yet-live.

---

## How to Run Locally

```bash
npm install          # install deps
# create .env.local (see below)
npm run dev          # http://localhost:3000
npm run check        # production-readiness gate (tsc, lint, build, audit) — scripts/production-check.sh
```

**Test login:** `admin@wasend.demo` / `Test@12345`
(`DEV_AUTO_LOGIN=1` enables a dev bypass via `/api/auth/dev-login`.)

---

## Environment Variables (`.env.local`)

```env
# ── Supabase ──
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJ...          # SECRET — server only
DATABASE_URL=postgres://...:5432/postgres # session-mode (5432), only needed for QUEUE_DRIVER=pgboss

# ── App / auth ──
NEXT_PUBLIC_SITE_URL=http://localhost:3000
JWT_SECRET=<64-char random>
ENCRYPTION_KEY=<key for encrypting Meta tokens at rest>  # lib/crypto.ts
ADMIN_EMAILS=you@brand.com,ops@brand.com  # allowlist that unlocks /admin
GOOGLE_CLIENT_ID=...                       # Google OAuth login (optional)
GOOGLE_CLIENT_SECRET=...

# ── Meta / WhatsApp ──
NEXT_PUBLIC_META_APP_ID=...
META_APP_ID=...
META_APP_SECRET=...                        # also verifies webhook signatures
WHATSAPP_WEBHOOK_VERIFY_TOKEN=...

# ── Queue (optional; default is in-process inline driver) ──
QUEUE_DRIVER=pgboss                         # omit for inline; pgboss needs DATABASE_URL
CRON_SECRET=...                             # protects /api/cron/drain-queue

# ── AI layer (optional; falls back to manual flows if unset) ──
ANTHROPIC_API_KEY=...
# AI_GATEWAY_API_KEY / GEMINI_API_KEY — alternate providers (config-driven)

# ── Razorpay ──
RAZORPAY_KEY_ID=... / RAZORPAY_KEY_SECRET=... / RAZORPAY_WEBHOOK_SECRET=...
RAZORPAY_PLAN_STARTER_MONTHLY / _YEARLY, RAZORPAY_PLAN_GROWTH_MONTHLY / _YEARLY, RAZORPAY_PLAN_PRO_MONTHLY / _YEARLY

# ── Email (optional) ──
RESEND_API_KEY=re_... / EMAIL_FROM="WASend <noreply@yourdomain.com>"
```

---

## Database & Migrations

Schema is managed as **ordered migrations** in `supabase/migrations/` (`001_…` →
`024_…`), applied in sequence. Highlights:

- `001/002/009` Model B schema + RLS · `011` prepaid wallet · `012` processed_events
  (webhook idempotency) · `013` API keys · `014` outbound webhooks · `015` API
  messages + OTP · `016` tiers · `017` billing rates (`meta_rates`, markup) · `019`
  message billing · `021/022` webhook inbox + RLS · `024` AI layer.
- The top-level `supabase/schema.sql` + `seed.sql` are the **legacy single-file** setup;
  the numbered migrations are authoritative. `add_crm.sql` / `add_subscriptions.sql` are
  legacy and merged in.

Supabase project: `tbqfsudapxfqakzqbkgb` · [SQL editor](https://supabase.com/dashboard/project/tbqfsudapxfqakzqbkgb/sql)

---

## Architecture — the money & message path (the important part)

**Outbound send** (`POST /api/whatsapp/send`, campaigns, automations):
```
route handler
  → getSessionUser()  (401 if none)
  → resolve number (whatsapp_numbers), decrypt access token (lib/crypto)
  → guardedSingleSend()  [lib/billing/guarded-send.ts]
       • billing_mode='byo'     → send unchanged, no wallet
       • billing_mode='managed' → quote via meta_rates × tier markup,
         RESERVE (hold) on prepaid wallet (hard-stop if insufficient),
         send via lib/meta.ts, link wa_message_id → reservation (message_billing)
  → returns fast
Meta delivery-status webhook  →  confirmOrReleaseBilling()  [lib/billing/confirm.ts]
       • sent/delivered/read → wallet SETTLE (the real debit)
       • failed              → wallet RELEASE (free the hold)
```
A message that never reaches `sent` is never charged. Never deduct-then-send across
awaits. See the `billing-wallet` skill.

**Inbound webhook** (`/api/webhook/whatsapp` — the canonical route):
```
verify X-Hub-Signature-256  →  rate-limit  →  persist raw payload (webhook inbox)
  →  webhook_logs audit + dedup (processed_events)
  →  status events → processStatusEvent + confirmOrReleaseBilling
  →  inbound messages → CTWA capture, contacts/conversations, enqueue to engine
  →  return 200 fast; the automation engine reply is delivered by the worker
```
> `/api/webhooks/whatsapp` (plural) is a **thin alias** that re-exports the canonical
> singular route, so numbers subscribed at either URL behave identically. Do not fork it.

**Job queue** (`lib/queue/index.ts`): generic `enqueue()` / `registerHandler()` with a
swappable driver. Default = **inline** (runs in-process, off the response path). Set
`QUEUE_DRIVER=pgboss` for durable Postgres-backed jobs, drained by the Vercel cron
`/api/cron/drain-queue` (runs every minute — see `vercel.json`).

**Billing models & pricing** (`lib/billing/`): `rates.ts` (reads `meta_rates`, derives
price = wholesale × (1 + tier markup + buffer)), `pricing.ts` (per-message quote),
`wallet.ts` (reserve/settle/release RPCs), `tiers.ts` (Starter/Growth/Enterprise).

**AI layer** (`lib/ai/`): one governed path (`service.ts`) for every AI action —
config-driven provider routing (`ai_model_config`, editable at `/api/admin/ai-config`,
no redeploy), tier gating, a **separate** AI-credit wallet (never merged with the message
wallet), debit-on-success, always-logged for margin. Missing config → graceful fallback
to manual flows. Only produces drafts for a human to confirm; never sends autonomously.

---

## Directory map (real)

```
app/
  (auth)/            login, register, forgot-password
  (dashboard)/       dashboard, contacts (+import, +segments), templates (+send),
                     campaigns (+create, +[id]), automation (+create), crm (+[id]),
                     inbox, analytics, numbers (+connect), billing (+plans, +recharge),
                     settings (+team, +api, +api-keys, +api/docs), appointments,
                     ads, catalog, segments, admin (+rates)
  api/
    auth/            login, register, logout, me, forgot-password, google/*, dev-login
    whatsapp/        send, connect, onboard, embedded-signup, accounts/*
    meta/            accounts, exchange-token, manual-connect, save-account,
                     subscribe-webhook, test-message, disconnect
    webhook/whatsapp     canonical Meta webhook (verify + ingest)
    webhooks/whatsapp    alias → re-exports the canonical route
    campaigns/       CRUD, [id]/launch, execute (fan-out sender)
    automations/, automation-flows/[id]/execute   rules + visual flow engine
    contacts/, crm/, segments/, inbox/, templates/ (+ library, sync, generate)
    billing/ (create-subscription, usage, webhook), wallet/ (+topup), transactions/
    admin/ (ai-config, billing-mode, margin, rates)
    ads/ (accounts, campaigns, connect, roi, track-lead, callback)  CTWA / Meta Ads
    commerce/, products/, carts/   catalog + abandoned-cart recovery
    api-keys/, webhook-endpoints/, v1/*   public API (API-key auth, OTP, messages)
    cron/drain-queue, health
lib/
  auth.ts, crypto.ts, supabase/server.ts, logger.ts, audit.ts, rate-limit.ts, validate.ts
  meta.ts, meta-client.ts, meta-ads.ts        Meta Graph wrappers (single source)
  whatsapp/   engine, dispatch, service, repository, queue, window, status, dedup,
              inbox, token-cache, onboarding-repo, errors, dto
  billing/    guarded-send, wallet, pricing, rates, tiers, confirm
  ai/         service, config, wallet
  queue/      generic swappable job queue
  segments.ts, commerce.ts, webhooks-out.ts, api-keys.ts, razorpay.ts, google-oauth.ts
components/   layout/, shared/, ai/, auth/, automation/, whatsapp/, ErrorBoundary
middleware.ts   auth guard for protected paths
supabase/migrations/   001…024 (authoritative schema)
scripts/production-check.sh   deploy gate
```

---

## Auth

Custom JWT (not Supabase Auth). `POST /api/auth/login` checks a bcrypt hash in `users`,
signs a JWT (`jose`, `JWT_SECRET`), sets the httpOnly `wa_session` cookie. `middleware.ts`
guards protected paths; API routes call `getSessionUser()`. Google OAuth via
`/api/auth/google/*`. Admin surface (`/admin`) unlocks only for `ADMIN_EMAILS`.

Protected paths (add new ones to `protectedPaths` in `middleware.ts`): `/dashboard`,
`/inbox`, `/numbers`, `/contacts`, `/templates`, `/campaigns`, `/automation`,
`/analytics`, `/billing`, `/settings`, `/crm`, `/appointments`, `/ads`, `/segments`,
`/catalog`, `/admin`.

---

## Feature status (what's real vs. shell)

**Fully wired:** send pipeline + prepaid billing, inbound webhook (verify/dedup/CTWA/
inbox/conversations), campaigns (batch fan-out + per-unit settle), automations + visual
flow engine, CRM, contacts/import, segments (incl. RFM), templates (Meta sync + library +
AI generate), inbox, Meta Embedded Signup + token encryption, public API v1 (API keys +
OTP + messages), outbound webhooks, Razorpay subscriptions + wallet top-up, admin rate/
margin/tier config, AI layer, ads/CTWA attribution.

**UI shell / not backed yet:**
- **Appointments** — `DEMO_APPOINTMENTS` in local state; no backend/persistence (only
  `/api/ai/appointment-parse` exists).
- **Password reset email** — `/api/auth/forgot-password` has a `TODO`; no Resend wiring.
- Inbox file attachments, number-migration flow — "coming soon".
- **Organization/multi-tenant model** — coded but not deployed (see Deployment reality).

---

## Conventions

- Money in **integer paise**; never float currency.
- Meta Graph version pinned in one constant; upgrade in one place. Meta errors map to an
  internal `MetaError` preserving `code`/`error_subcode` (billing/retry depend on them).
- Prefer `lib/logger` over `console.*` in `app/`/`lib/` (the prod-check flags stray logs).
- When a decision affects margin (rates, markup, bundling, breakage), flag it explicitly
  rather than guessing.
