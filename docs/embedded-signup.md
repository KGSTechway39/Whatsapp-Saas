# WhatsApp Embedded Signup — Production Guide

How this module works, how to configure Meta for it, and how to scale it.
Comparable to the onboarding flow in Wati / AiSensy / Interakt.

---

## 1. Architecture

```
┌────────────────────────────────────────────────────────────────────┐
│  BROWSER                                                           │
│  components/whatsapp/ConnectWhatsApp.tsx                           │
│   ├─ Loads Facebook JS SDK (connect.facebook.net/en_US/sdk.js)     │
│   ├─ FB.login({config_id, response_type: "code", session v2})      │
│   └─ POSTs { code, wabaId, phoneNumberId } → /api/whatsapp/        │
│                                                       embedded-signup
└────────────────────────────────────────────────────────────────────┘
                               │ HTTPS
                               ▼
┌────────────────────────────────────────────────────────────────────┐
│  CONTROLLER  app/api/whatsapp/embedded-signup/route.ts             │
│   • Parse JSON, auth user, delegate to service.                    │
│   • Catches WhatsAppError → typed HTTP body { error, code }.       │
└────────────────────────────────────────────────────────────────────┘
                               │
                               ▼
┌────────────────────────────────────────────────────────────────────┐
│  SERVICE  lib/whatsapp/service.ts                                  │
│   1. exchangeCodeForToken(code)        → short-lived token         │
│   2. extendToken(short)                → ~60-day long-lived        │
│   3. getWABAsForToken(long)            → [{waba, phones[]}]        │
│   4. subscribeWABAToApp(waba)          → webhook delivery          │
│   5. upsertAccount(...)                → encrypted persist         │
└────────────────────────────────────────────────────────────────────┘
                               │
                               ▼
┌────────────────────────────────────────────────────────────────────┐
│  REPOSITORY  lib/whatsapp/repository.ts                            │
│   • encrypt(token)  via lib/crypto.ts (AES-256-GCM)                │
│   • Scopes every query to organization_id (multi-tenant)           │
└────────────────────────────────────────────────────────────────────┘
                               │
                               ▼
┌────────────────────────────────────────────────────────────────────┐
│  POSTGRES                                                          │
│   organizations  organization_members  whatsapp_accounts (RLS)     │
│   webhook_logs   templates             messages                    │
└────────────────────────────────────────────────────────────────────┘
```

---

## 2. Multi-tenant invariants

- Each customer = one **organization** (`organizations.id`).
- A customer's WABAs/phones are owned by the **organization**, not the user.
  Multiple agents in the same org share the same connection.
- A `phone_number_id` may exist in **at most one** organization at a time.
  The repository's `upsertAccount` looks up by `(organization_id, phone_number_id)`
  before inserting — preventing two tenants from claiming the same number.
- Postgres RLS (see `002_model_b_rls.sql`) enforces this server-side too.
- Tokens are **encrypted at rest** via AES-256-GCM. The DB column carries
  `iv:cipher` hex strings; a `token_encrypted` flag tracks the rollout.

---

## 3. Meta dashboard configuration

### 3.1 Create a Meta App

1. https://developers.facebook.com/apps → **Create App** → use case
   **Other** → type **Business**.
2. Add product: **WhatsApp** (gives you a WABA/phone for testing).
3. Add product: **Facebook Login for Business** (this is the gate to the
   Embedded Signup popup).
4. Note the **App ID** and **App Secret** → set:
   - `NEXT_PUBLIC_META_APP_ID` (browser)
   - `META_APP_ID` (server)
   - `META_APP_SECRET` (server)

### 3.2 Configure Facebook Login for Business

1. Open the product **Facebook Login for Business** → **Configurations**.
2. Click **Create configuration** → **Login flow**.
3. Login type: **Business login** → choose **Tech provider**.
4. Required permissions:
   - `whatsapp_business_management`
   - `whatsapp_business_messaging`
   - `business_management`
5. Copy the resulting **Configuration ID** → set
   `NEXT_PUBLIC_META_CONFIG_ID`.

### 3.3 OAuth redirect URLs

In **Facebook Login for Business → Settings**:

```
https://your-domain.com/                              ← App Domain
https://your-domain.com/api/whatsapp/embedded-signup  ← Valid OAuth redirect (not strictly needed for response_type=code with override_default_response_type=true, but add it as a safety net)
```

For local dev, use `http://localhost:3000`.

### 3.4 Webhook subscription

Under **WhatsApp → Configuration**:

```
Callback URL  https://your-domain.com/api/webhook/whatsapp
Verify token  ${WHATSAPP_WEBHOOK_VERIFY_TOKEN}
```

Subscribe to fields: **messages, message_template_status_update,
account_alerts, account_review_update**.

The service layer auto-calls `POST /{waba_id}/subscribed_apps` after each
successful Embedded Signup, so per-WABA subscription happens transparently.

### 3.5 App review & business verification

For **production traffic**, Meta requires:

- Business verification on the Meta Business Manager owning the app.
- App review for Advanced access on `whatsapp_business_messaging`.
- For Tech Provider scope: a **Solution Partner** application
  (https://www.facebook.com/business/partner-directory/search?solution_type=tech).

Until then, the app runs in **Development** mode — only test users you list
can complete Embedded Signup.

---

## 4. Required environment variables

```env
# Meta
NEXT_PUBLIC_META_APP_ID=…             # public — used by FB SDK
NEXT_PUBLIC_META_CONFIG_ID=…          # public — Login for Business config
META_APP_ID=…                          # server-only fallback
META_APP_SECRET=…                      # server-only — code exchange
WHATSAPP_WEBHOOK_VERIFY_TOKEN=…        # any string you choose

# App
NEXT_PUBLIC_SITE_URL=https://your-domain.com
JWT_SECRET=…                           # 64-char hex
ENCRYPTION_KEY=…                       # 64-char hex — encrypts access_token

# Supabase
NEXT_PUBLIC_SUPABASE_URL=…
NEXT_PUBLIC_SUPABASE_ANON_KEY=…
SUPABASE_SERVICE_ROLE_KEY=…
```

Generate secrets quickly:

```bash
node -e "console.log(crypto.randomBytes(32).toString('hex'))"
```

---

## 5. End-to-end signup flow

| # | Actor    | Step                                                                  |
|---|----------|-----------------------------------------------------------------------|
| 1 | Browser  | Customer clicks **Connect WhatsApp**. SDK loads.                       |
| 2 | Browser  | `FB.login(cb, {config_id, response_type: "code", extras: {sessionInfoVersion:2}})` opens Meta popup. |
| 3 | Meta     | Customer logs in, picks WABA + phone, accepts permissions.            |
| 4 | Browser  | SDK callback fires with `{authResponse: {code, waba_id, phone_number_id}}`. |
| 5 | Browser  | `POST /api/whatsapp/embedded-signup` with that body.                  |
| 6 | Server   | Service exchanges code → long-lived token (~60d).                     |
| 7 | Server   | `GET /me/businesses` → `/{biz}/whatsapp_business_accounts` → phones.  |
| 8 | Server   | `POST /{waba}/subscribed_apps` to receive webhooks for this WABA.     |
| 9 | Server   | Repository encrypts token + upserts row scoped to `organization_id`.  |
| 10| Browser  | `201 { connected, created, refreshed }` → success UI.                 |

---

## 6. Webhook handling

`POST /api/webhook/whatsapp`

1. Meta signs the body with `X-Hub-Signature-256 = sha256=<hex>`. We
   verify with `META_APP_SECRET` using `crypto.timingSafeEqual`.
2. Every payload is logged into `webhook_logs` with the message/status
   id as the unique key — duplicates auto-collapse via UNIQUE constraint.
3. The handler dispatches:
   - `messages[]` → `messages` table + last_contacted on contact
     + CTWA referral attribution if `referral.ctwa_clid` present.
   - `statuses[]` → updates `campaign_messages.status` to `sent | delivered | read | failed`.
4. The audit row's `processing_status` flips to `processed | failed`,
   keeping the raw payload for replay.

### 6.1 Idempotency contract

| Source of replay | Handled by |
|------------------|------------|
| Meta retry (we returned non-200 once) | UNIQUE on `webhook_logs.meta_event_id` |
| Same payload arrives in two app instances | Same — DB-level dedupe |
| Local cache miss | In-memory 10-min set (`processedEvents`) — best-effort fast path |

We always return `200` — otherwise Meta retries indefinitely with
exponential backoff up to 24 hours.

### 6.2 Token refresh & expiry

Long-lived tokens last ~60 days. Strategy:

- Persist `token_expires_at` at exchange time.
- A nightly Vercel cron (or Supabase scheduled function) selects
  `WHERE token_expires_at < now() + interval '7 days' AND status = 'active'`,
  notifies the org admin via email/in-app, and surfaces a **Reconnect**
  button on `/numbers`. The reconnect path is the same Embedded Signup
  popup — `upsertAccount` refreshes the row in place.
- On any Graph API call that returns `error.code = 190` (token expired),
  the service flips `status = 'pending'` and surfaces the reconnect UX.

---

## 7. API contract summary

| Method | Path                                  | Purpose                                  |
|--------|---------------------------------------|------------------------------------------|
| POST   | /api/whatsapp/embedded-signup         | Exchange code, persist accounts          |
| GET    | /api/whatsapp/accounts                | List connected accounts (no token)       |
| DELETE | /api/whatsapp/accounts/:id            | Soft-disconnect an account               |
| POST   | /api/templates/sync                   | Pull templates from every connected WABA |
| GET    | /api/templates/library                | Browse Meta's curated library           |
| POST   | /api/templates/use-library            | Submit a library template for approval   |
| GET    | /api/webhook/whatsapp                 | Meta webhook verification challenge      |
| POST   | /api/webhook/whatsapp                 | Receive messages + status updates        |

---

## 8. Scaling considerations

| Concern               | Approach                                                 |
|-----------------------|----------------------------------------------------------|
| Webhook bursts        | DB row-per-event lets you drain async. Hand off heavy CRM work (CTWA attribution, automation triggers) to a Supabase queue / pg_cron consumer instead of doing it inline. |
| Outgoing send rate    | Meta tier caps (1k/day → 100k/day). Our `whatsapp_accounts.messaging_tier` mirrors Meta's tier so scheduler can throttle. |
| Token rotation        | Background job + reconnect UX (see §6.2).                |
| Multi-region          | Pin webhook origin to a single region (lowest cold-start) and use Vercel Edge Config or Supabase reads from edge for fast lookups. |
| Audit retention       | `webhook_logs` grows fast. Add a daily `DELETE FROM webhook_logs WHERE received_at < now() - interval '30 days'` job. |
| RLS                   | Always use `createServiceClient()` for cross-tenant ops (webhook); regular `createClient()` for user-scoped routes. |

---

## 9. How AiSensy / Wati likely architect this

Based on public docs and observed behaviour:

- **Tech Provider** account on Meta — same Embedded Signup config (#3.2).
- One **Meta App** per platform; customers connect their own WABAs into it.
- Tokens stored encrypted, mirrored across regions for HA.
- A queue (Kafka/RabbitMQ/Redis Streams) sits between the webhook receiver
  and the per-feature consumers (CRM updater, deliverability tracker,
  campaign retry scheduler) — exactly the trigger we left as a TODO.
- Their template library tab fetches Meta's `template_library` endpoint
  the same way `app/api/templates/library/route.ts` here does.
- **Reconnect** flow shows the original Embedded Signup popup again with
  hints (`waba_id`, `phone_number_id`) so customers don't pick the wrong
  WABA — see `extras: { sessionInfoVersion: 2 }` in `ConnectWhatsApp.tsx`.

---

## 10. Folder layout

```
app/api/whatsapp/
  embedded-signup/route.ts     ← controller (slim)
  accounts/route.ts            ← GET list
  accounts/[id]/route.ts       ← DELETE disconnect
  webhook/whatsapp/route.ts    ← signed webhook receiver

lib/whatsapp/
  dto.ts          ← typed request/response shapes
  errors.ts       ← WhatsAppError + concrete subclasses + toApiError
  repository.ts   ← Supabase access; encrypt/decrypt; tenant scoping
  service.ts      ← business logic (Meta + repo orchestration)

lib/
  meta.ts         ← thin Graph API client
  meta-ads.ts     ← Marketing API (CTWA)
  crypto.ts       ← AES-256-GCM helpers

supabase/migrations/
  001_model_b_schema.sql       ← orgs, members, accounts, contacts, …
  002_model_b_rls.sql          ← Row-Level Security policies
  005_webhook_logs.sql         ← audit trail
```
