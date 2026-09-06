# 07 — API Catalogue

## Executive summary

**113 route files** exposing **~190 method-endpoints** across 30 resource families.
Auth coverage is good (only 7 intentionally-public routes). Two structural problems:

- **Validation coverage is 3 / 113.** Only `auth/login`, `auth/register`, and
  `settings/password` use Zod. Everything else does ad-hoc `if (!x) return 400`. Nine
  written-and-unused Zod schemas sit in `lib/validate.ts`.
- **~34 route files (30%) target tables that do not exist**, so they return 500s or
  empty results. They are indistinguishable from working endpoints in the catalogue.

The **public API v1** (9 routes) is the best-engineered slice: consistent
`{error:{code,message}}` envelopes, E.164 validation, scope enforcement, per-key rate
limits, and idempotency via `client_reference`.

**Risk level:** Medium · **Complexity:** Medium · **Confidence:** High (93%) — auth,
validation, rate-limit, and tenancy flags were derived programmatically from all 113
files; individual business logic was read for ~18 of them.

---

## 1. Coverage summary

| Auth scheme | Route files | Notes |
|---|---:|---|
| Session cookie (`getSessionUser`) | **89** | The product surface |
| Platform admin (`requireAdmin`) | 8 | `ADMIN_EMAILS` allowlist |
| API key (`withApiAuth`) | 9 | `/api/v1/*`, scoped + rate-limited |
| Meta HMAC | 1 | `webhook/whatsapp` |
| Razorpay HMAC | 1 | `billing/webhook` |
| Cron secret | 1 | `cron/drain-queue` |
| **Intentionally public** | 6 | `auth/{login,register,logout,forgot-password,google,google/callback}`, `health` |
| **Re-export alias** | 1 | `webhooks/whatsapp` |

| Quality dimension | Coverage |
|---|---|
| Zod validation | **3 / 113 (2.7%)** 🔴 |
| Rate limiting | 12 / 113 (login, register, webhook, 9 × v1) 🟠 |
| Explicit tenant predicate | 78 / 113 🟡 |
| Target table exists in prod | 79 / 113 (**34 dead**) 🔴 |

---

## 2. Full catalogue

Legend — **Auth**: `sess` session · `admin` · `key` API key · `hmac` · `cron` · `pub` public.
**Z**: Zod. **RL**: rate limited. **T**: tenant predicate (`uid` = `user_id`, `ORG` = org
model). **Live**: does the target table exist in production?

### Authentication (7 files)

| Endpoint | Methods | Auth | Z | RL | Live | Purpose |
|---|---|---|:-:|:-:|:-:|---|
| `/api/auth/login` | POST | pub | ✅ | ✅ | ✅ | bcrypt + JWT + cookie |
| `/api/auth/register` | POST | pub | ✅ | ✅ | ✅ | Create tenant |
| `/api/auth/logout` | POST | pub | — | — | ✅ | Clear cookie (8 lines) |
| `/api/auth/me` | GET | sess | — | — | ✅ | Current session user |
| `/api/auth/forgot-password` | POST | pub | 🔴 | 🔴 | ✅ | **Stub — `TODO`, sends nothing** |
| `/api/auth/google` | GET | pub | — | — | ✅ | OAuth redirect |
| `/api/auth/google/callback` | GET | pub | — | — | ✅ | Upsert + session |
| `/api/auth/dev-login` | GET | pub | — | 🔴 | ✅ | 🔴 **Prod bypass when `DEMO_AUTO_LOGIN=true`** |

### WhatsApp numbers & onboarding (11 files)

| Endpoint | Methods | Auth | T | Live | Purpose |
|---|---|---|:-:|:-:|---|
| `/api/whatsapp-numbers` | GET, POST | sess | uid | ✅ | List / add number |
| `/api/whatsapp-numbers/[id]` | PATCH, DELETE | sess | uid | ✅ | Update / remove |
| `/api/whatsapp/connect` | POST | sess | uid | ✅ | Manual connect |
| `/api/whatsapp/embedded-signup` | POST | sess | uid | ✅ | ESU entry (192 L) |
| `/api/whatsapp/onboard` | POST | sess | uid | ⚠️ | **451 L — largest route.** Writes both models |
| `/api/whatsapp/send` | POST | sess | uid | ✅ | Single send → `guardedSingleSend` |
| `/api/whatsapp/accounts` | GET | sess | — | 🔴 | `whatsapp_accounts` missing |
| `/api/whatsapp/accounts/[id]` | DELETE | sess | — | 🔴 | same |
| `/api/meta/accounts` | GET | sess | uid | ✅ | List WABAs from Graph |
| `/api/meta/exchange-token` | POST | sess | — | ⚠️ | ESU token exchange → in-memory cache |
| `/api/meta/save-account` | POST | sess | — | ⚠️ | Persists to both models (178 L) |
| `/api/meta/manual-connect` | POST | sess | — | ⚠️ | 172 L |
| `/api/meta/subscribe-webhook` | POST | sess | uid | ⚠️ | `webhook_subscriptions` missing |
| `/api/meta/test-message` | POST | sess | uid | ✅ | 🔴 no 24h window check |
| `/api/meta/disconnect` | DELETE | sess | uid | ✅ | Revoke + delete |

### Contacts & segments (11 files)

| Endpoint | Methods | Auth | T | Live | Notes |
|---|---|---|:-:|:-:|---|
| `/api/contacts` | GET, POST | sess | uid | ✅ | `contactSchema` exists but **unused** |
| `/api/contacts/[id]` | PATCH, DELETE | sess | uid | ✅ | |
| `/api/contacts/count` | GET | sess | uid | ✅ | Audience sizing |
| `/api/contacts/import` | POST, DELETE | sess | uid | ✅ | Bulk CSV; DELETE = bulk delete |
| `/api/contacts/segments` | GET | sess | uid | ✅ | Derived groups (136 L) |
| `/api/segments` | GET, POST | sess | uid | 🔴 | `segments` table missing |
| `/api/segments/[id]` | PATCH, DELETE | sess | uid | 🔴 | |
| `/api/segments/[id]/contacts` | GET | sess | uid | 🔴 | |
| `/api/segments/preview` | POST | sess | uid | 🔴 | |
| `/api/segments/rfm` | GET | sess | — | 🔴 | RFM scoring |

> **Duplicate concept:** `/api/contacts/segments` (live) and `/api/segments` (dead) are
> two different segmentation implementations. The sidebar links to `/segments`, the dead one.

### Templates (5 files)

| Endpoint | Methods | Auth | T | Live | Notes |
|---|---|---|:-:|:-:|---|
| `/api/templates` | GET, POST | sess | uid | ✅ | `templateSchema` **unused** |
| `/api/templates/sync` | POST | sess | uid | ✅ | Pull from Meta, auto-paginates |
| `/api/templates/library` | GET | sess | uid | ✅ | **Meta's** shared library proxy |
| `/api/templates/use-library` | POST | sess | uid | ✅ | Instantiate a Meta library template |
| `/api/templates/generate` | POST | sess | — | ✅ | AI (`template_content`) + vertical context |

> **Name collision worth flagging:** `/api/templates/library` proxies *Meta's* template
> library. `vertical_template_library` is SendAnjal's own seed catalogue. Unrelated,
> confusingly similar — `PHASE-0-AUDIT.md:249` raised the same point.

### Campaigns (4 files)

| Endpoint | Methods | Auth | T | Live | Notes |
|---|---|---|:-:|:-:|---|
| `/api/campaigns` | GET, POST | sess | uid | ✅ | `campaignSchema` **unused** |
| `/api/campaigns/[id]` | GET, PATCH, DELETE | sess | uid | ✅ | Detail + timeseries + cost breakdown |
| `/api/campaigns/[id]/launch` | POST | sess | uid | ✅ | 265 L |
| `/api/campaigns/execute` | POST | sess | uid | ✅ | **499 L — largest handler.** reserve-all → 50-batch → settle-per-unit → release |

> `campaigns/[id]/launch` (265 L) and `campaigns/execute` (499 L) are **two send paths**
> for the same operation. Duplication risk on the money path.

### Automation (5 files)

| Endpoint | Methods | Auth | T | Live | Notes |
|---|---|---|:-:|:-:|---|
| `/api/automations` | GET, POST | sess | uid | ✅ | Simple trigger→action rules |
| `/api/automations/[id]` | PATCH, DELETE | sess | uid | ✅ | |
| `/api/automation-flows` | GET, POST | sess | uid | ✅ | Canvas flows (now live — see [05](05-DATABASE.md)) |
| `/api/automation-flows/[id]` | GET, PUT, PATCH, DELETE | sess | uid | ✅ | |
| `/api/automation-flows/[id]/execute` | POST | sess | uid | ✅ | **Manual invoke only.** 273 L, 10 node types incl. `aiReplyNode` |

### Inbox (3 files)

| Endpoint | Methods | Auth | T | Live | Notes |
|---|---|---|:-:|:-:|---|
| `/api/inbox` | GET | sess | uid | ✅ | Conversation list |
| `/api/inbox/[id]` | GET, PATCH | sess | uid | ⚠️ | Thread — **inbound messages absent** (insert fails upstream) |
| `/api/inbox/[id]/send` | POST | sess | uid | ✅ | ✅ **Enforces 24h window** (`:67-74`) and reopens it on template send (`:141-144`) |

### Billing & wallet (7 files)

| Endpoint | Methods | Auth | T | Live | Notes |
|---|---|---|:-:|:-:|---|
| `/api/wallet` | GET, POST | sess | uid | ✅ | Balance |
| `/api/wallet/topup` | POST | sess | — | ✅ | Razorpay order; `walletRechargeSchema` **unused** |
| `/api/transactions` | GET | sess | uid | ✅ | Ledger |
| `/api/billing/usage` | GET | sess | uid | ✅ | Consumption |
| `/api/billing/create-subscription` | POST, **GET**, DELETE | sess | uid | 🔴 | `subscriptions` missing. **GET mutates → CSRF-able** |
| `/api/billing/webhook` | GET, POST | rzp-hmac | uid | ⚠️ | 283 L. Insert-first idempotency ✅. Wallet credit works; subscription persistence does not |

### Admin (8 files)

| Endpoint | Methods | Auth | Live | Business lever |
|---|---|---|:-:|---|
| `/api/admin/rates` | GET, POST | admin | ✅ | **Sets COGS** — 🔴 unaudited |
| `/api/admin/margin` | GET | admin | ✅ | Margin view |
| `/api/admin/billing-mode` | GET, POST | admin | ✅ | byo ⇄ managed — 🔴 unaudited |
| `/api/admin/ai-config` | GET, POST, PATCH | admin | ✅ | Model routing, no redeploy — 🔴 unaudited |
| `/api/admin/verticals` | GET, POST | admin | ✅ | Vertical CRUD (228 L) |
| `/api/admin/verticals/[id]` | GET | admin | ✅ | With library |
| `/api/admin/verticals/seed` | **GET**, POST | admin | ✅ | 🔴 **GET seeds data → CSRF-able** |
| `/api/admin/clients/[id]/vertical` | GET, POST | admin | ✅ | Assign / clear |

### AI (4 files)

| Endpoint | Methods | Auth | Task type | Credits | Vertical ctx |
|---|---|---|---|---:|:-:|
| `/api/ai/campaign-draft` | POST | sess | `campaign_content` | 1 | ✅ `:104` |
| `/api/ai/flow-draft` | POST | sess | `automation_flow_builder` | 3 | ✅ `:76` |
| `/api/templates/generate` | POST | sess | `template_content` | 0 | ✅ `:101` |
| `/api/ai/appointment-parse` | POST | sess | `appointment_nl_parse` | 1 | — |
| `/api/ai/wallet` | GET | sess | — | — | — |

### Verticals (3 client-facing files)

| Endpoint | Methods | Auth | Live | Purpose |
|---|---|---|:-:|---|
| `/api/verticals/me` | GET | sess | ✅ | Tenant's vertical (NULL is valid) |
| `/api/verticals/suggestions/[id]` | GET | sess | ✅ | Recommendation rails |

### Public API v1 (9 files) — the best-built slice

| Endpoint | Methods | Scope | RL | Notes |
|---|---|---|:-:|---|
| `POST /api/v1/messages/send` | POST | `messages:write` | ✅ | 206 L. E.164 regex, type ∈ {document, text, template}, `require_otp` gate (15-min window), `client_reference` idempotency, `guardedSingleSend`. 🔴 no 24h window check |
| `/api/v1/messages` | POST, GET | `messages:write` / `:read` | ✅ | 249 L |
| `/api/v1/messages/[id]` | GET | `messages:read` | ✅ | Status |
| `/api/v1/documents/send` | POST | `messages:write` | ✅ | 124 L |
| `/api/v1/contacts` | GET, POST | `contacts:*` | ✅ | 121 L |
| `/api/v1/contacts/[id]` | GET, PATCH, DELETE | `contacts:*` | ✅ | |
| `/api/v1/templates` | GET | `templates:read` | ✅ | |
| `/api/v1/otp/request` | POST | `messages:write` | ✅ | 121 L. Hashed code, `max_attempts` |
| `/api/v1/otp/verify` | POST | `messages:write` | ✅ | 68 L |

### Webhooks, cron, health (5 files)

| Endpoint | Methods | Auth | Notes |
|---|---|---|---|
| `/api/webhook/whatsapp` | GET, POST | Meta HMAC | 471 L. GET = `hub.challenge` verify. POST = the canonical ingest |
| `/api/webhooks/whatsapp` | (re-export) | — | ✅ 19-line alias, correctly done |
| `/api/webhook-endpoints` | GET, POST | sess | Client's outbound URLs |
| `/api/webhook-endpoints/[id]` | PATCH, DELETE | sess | |
| `/api/cron/drain-queue` | GET | `CRON_SECRET` | 🔴 fires **daily**, not per-minute |
| `/api/health` | GET | pub | 36 L |

### Dead families (34 files total)

| Family | Files | Missing table |
|---|---:|---|
| `crm/*` | 6 | `crm_deals`, `crm_pipeline`, `crm_activities` |
| `ads/*` | 6 | `ad_campaigns`, `ad_leads` |
| `products/*`, `carts/*`, `commerce/*` | 8 | `products`, `carts`, `cart_items` |
| `segments/*` | 5 | `segments` |
| `whatsapp/accounts/*` | 2 | `whatsapp_accounts` |
| Partially dead (org-model writes) | 5 | `organizations`, `phone_numbers`, `webhook_subscriptions` |
| `billing/create-subscription` | 1 | `subscriptions` |
| Appointments | **0 routes exist** | UI is a `useState` demo |

---

## 3. Error handling

Three inconsistent conventions.

| Convention | Shape | Used by |
|---|---|---|
| **A — bare** | `{error: "message"}` | Most session routes |
| **B — coded** | `{error: "message", code: "SNAKE_CASE"}` | `whatsapp/send` (402 `INSUFFICIENT_BALANCE`), `inbox/[id]/send` (`WINDOW_EXPIRED`) |
| **C — envelope** | `{error: {code, message}}` via `err(status, code, msg)` | All 9 `v1/*` routes |
| **D — typed adapter** | `toApiError(err)` → `{error, code}` from the `WhatsAppError` hierarchy | `lib/whatsapp/errors.ts:82` — defined, used only on org-model routes (dead) |

So there is a well-designed typed error adapter (`lib/whatsapp/errors.ts`, 10 subclasses,
correct "never leak stack traces" comment) that is only wired into the dead branch.

| Status code | Usage | Correct? |
|---|---|---|
| 400 | Validation | ✅ |
| 401 | No session / bad key / bad HMAC | ✅ |
| 402 | `INSUFFICIENT_BALANCE` | ✅ Semantically ideal |
| 403 | Admin denied, webhook verify-token mismatch | ✅ |
| 404 | Not found | ✅ |
| 429 | Rate limited, with `X-RateLimit-*` headers | ✅ |
| 500 | Unhandled | ⚠️ Sometimes leaks `err.message` (e.g. `whatsapp/send:93`) |
| 502 | `GraphApiError` | ✅ defined, dead branch only |
| **200 on webhook error** | `webhook/whatsapp:453-454` returns 200 even on internal failure | ✅ **Deliberately correct** — otherwise Meta retries indefinitely; the raw payload is already in `webhook_inbox` for replay |

---

## 4. Performance characteristics

| Route | Concern |
|---|---|
| `campaigns/execute` (499 L) | Sequential sends inside a 50-item batch. At Vercel's 300 s ceiling and ~300 ms/send, one invocation caps at roughly 1,000 recipients. **Unable to determine** whether continuation/resume exists — no evidence found |
| `whatsapp/send` | Managed path: `getBillingMode` → `quoteSend` (up to 3 queries) → `deriveQuote` (3 more) → `wallet_reserve` → Meta → `message_billing` insert. **≈7 DB round-trips + 1 Graph call per message** |
| `templates/sync` | Auto-paginates all Meta templates inline (`lib/meta.ts:198-215`); a tenant with many templates blocks the request |
| `meta/accounts` | `getWABAsForToken` does N+1 Graph calls: `/me/businesses` → per business `/whatsapp_business_accounts` → per WABA `/phone_numbers` (`lib/meta.ts:70-122`) |
| `webhook/whatsapp` | Persist + resolve + log + dedup + status loop + message loop, all before the 200. Fast-ack is partially undermined by inline work |
| `dashboard`, `analytics` | Multiple sequential aggregate queries; `daily_analytics` has no writer so numbers are likely zero |
| All list endpoints | `paginationSchema` exists (max limit 200) but is **unused**; **unable to determine** per-route pagination without reading each — `contacts.list` in `lib/api.ts:34-41` does pass `page`/`limit`, so at least contacts is paginated |

---

## 5. Duplicate & unused endpoints

| # | Issue | Detail |
|---|---|---|
| 1 | Two campaign send paths | `campaigns/[id]/launch` (265 L) vs `campaigns/execute` (499 L) |
| 2 | Two segmentation APIs | `contacts/segments` (live) vs `segments/*` (dead) — nav points at the dead one |
| 3 | Two API-docs pages | `/docs/api` vs `/settings/api/docs` |
| 4 | Two "accounts" endpoints | `whatsapp/accounts` (org, dead) vs `whatsapp-numbers` (live) |
| 5 | Three connect paths | `whatsapp/connect`, `whatsapp/embedded-signup`, `meta/manual-connect` |
| 6 | `webhooks/whatsapp` alias | ✅ Intentional and correct |
| 7 | Unused: `ai/appointment-parse` | Parses NL → JSON, **persists nothing**; the only appointments backend |
| 8 | Unused: `ads/callback`, `commerce/connect` | OAuth callbacks for dead features |

---

## Advantages

- Auth coverage is near-complete; the 6 public routes are all intentional.
- `/api/v1/*` is genuinely production-quality: consistent envelopes, scopes with
  inheritance, per-key rate limits, E.164 validation, `client_reference` idempotency,
  and an OTP-gated document flow.
- Status-code discipline is good, including the unusual-but-correct 402 and the
  deliberate 200-on-webhook-error.
- The webhook alias pattern (re-export, not fork) is exactly right.
- Route file sizes are mostly modest (median ~80 lines).

## Disadvantages

- 2.7% Zod coverage, with the schemas already written.
- 30% of route files address non-existent tables and fail silently or 500.
- Four competing error conventions; the best one (`toApiError`) is only on dead paths.
- Rate limiting covers 12 routes and does not work on the deployment target.
- Several state-changing `GET` endpoints (CSRF exposure under `SameSite=Lax`).
- `campaigns/execute` and `whatsapp/onboard` are 499 and 451 lines — too large to test.

## Recommendations

| P | Recommendation | Effort |
|---|---|---|
| **P0** | Adopt one error convention repo-wide — extend `toApiError` and wrap every handler. | 1 week |
| **P0** | Return 501/404 with an explicit "not enabled" body from the 34 dead route files until their tables ship, so failures are legible instead of 500s. | 2 days |
| P1 | Apply the 9 existing Zod schemas, then require Zod on every mutating route via a shared `withValidation(schema, handler)` wrapper. | 1 week |
| P1 | Merge `campaigns/[id]/launch` into `campaigns/execute`. Two money paths is one too many. | 3 days |
| P1 | Convert state-changing `GET` → `POST` (`billing/create-subscription`, `admin/verticals/seed`, `commerce/connect`). | 1 day |
| P1 | Point the sidebar's "Smart Segments" at the live `contacts/segments` implementation. | 1 hour |
| P2 | Extract the send loop from `campaigns/execute` into `lib/whatsapp/broadcast.ts`; add batch continuation for >1,000 recipients. | 1 week |
| P2 | Batch the `getWABAsForToken` Graph calls (Graph supports field expansion) to kill the N+1. | 1 day |
| P2 | Generate an OpenAPI spec for `/api/v1/*` from the route handlers; the docs page is hand-maintained. | 3 days |
| P3 | Add `/api/health` checks for DB, Meta reachability, and queue depth. | 1 day |
