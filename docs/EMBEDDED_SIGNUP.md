# WhatsApp Embedded Signup — Implementation & Deployment Guide

End-to-end docs for the AiSensy-style "Apply for WhatsApp Business API" flow
in this app. Covers the file map, the database schema, the API contract, the
environment, and the production deployment runbook.

---

## 1. File map (what lives where)

| Layer        | File                                                            | Purpose                                                   |
|--------------|-----------------------------------------------------------------|-----------------------------------------------------------|
| Migration    | `supabase/migrations/009_model_b_unified.sql`                   | Core multi-tenant tables (organizations, accounts, …)     |
| Migration    | `supabase/migrations/010_embedded_signup_split.sql`             | `phone_numbers`, `access_tokens`, `webhook_subscriptions`, `audit_logs` |
| Prisma ref   | `prisma/schema.prisma`                                          | Reference data model (not used at runtime — Supabase is)  |
| Lib          | `lib/meta-client.ts`                                            | Graph v19.0 client (token exchange, debug, discovery, subscribe) |
| Lib          | `lib/whatsapp/onboarding-repo.ts`                               | Persistence helpers used by the `/api/meta/*` routes      |
| Lib          | `lib/whatsapp/token-cache.ts`                                   | Short-lived in-memory cache between exchange and save     |
| Lib          | `lib/audit.ts`                                                  | Append-only audit log writer                              |
| Lib          | `lib/whatsapp/engine.ts`                                        | Flow execution engine for inbound messages                |
| Lib          | `lib/whatsapp/queue.ts`                                         | Async worker boundary (swap for BullMQ / Vercel Queues)   |
| API          | `app/api/meta/exchange-token/route.ts`                          | `code` → token, discover WABAs, stash for save            |
| API          | `app/api/meta/save-account/route.ts`                            | Persist account / phone / encrypted token                 |
| API          | `app/api/meta/subscribe-webhook/route.ts`                       | Subscribe app to WABA, record subscription state          |
| API          | `app/api/meta/accounts/route.ts`                                | List connected accounts for the active org                |
| API          | `app/api/meta/disconnect/route.ts`                              | Tear down a connection (revoke token, unsubscribe)        |
| API          | `app/api/webhooks/whatsapp/route.ts`                            | Multi-tenant webhook ingress (fast 200 + queue)           |
| Frontend     | `components/whatsapp/EmbeddedSignupModal.tsx`                   | AiSensy-style modal                                       |
| Frontend     | `components/whatsapp/MetaConnectButton.tsx`                     | Trigger button that opens the modal                       |
| Frontend     | `app/(dashboard)/numbers/connect/page.tsx`                      | Connect page (CTA + 5-step self-host wizard)              |
| Types        | `types/facebook-sdk.d.ts`                                       | Global `window.FB` declarations                           |

---

## 2. Step-by-step implementation plan

The work has been done — these are the milestones in order, useful for code
review and future re-implementation.

1. **Database** — Apply migrations 009 and 010 in the Supabase SQL editor:
   https://supabase.com/dashboard/project/tbqfsudapxfqakzqbkgb/sql
   Run 009 first (organizations/accounts/contacts), then 010 (phone_numbers,
   access_tokens, webhook_subscriptions, audit_logs).
2. **Server libraries** — Verify `lib/crypto.ts` has a 64-hex `ENCRYPTION_KEY`,
   `lib/auth.ts` is signing JWTs with a stable `JWT_SECRET`, and
   `lib/supabase/server.ts` exports a working `createServiceClient`.
3. **Meta side** — Create a Business-type Meta App, add the WhatsApp +
   Facebook Login for Business products, create an Embedded Signup
   configuration with `whatsapp_business_management` and
   `whatsapp_business_messaging` scopes, and whitelist the app origin under
   Facebook Login → Allowed Domains.
4. **Env** — Set the variables listed in section 5.
5. **Frontend** — `MetaConnectButton` is already wired into
   `app/(dashboard)/numbers/connect/page.tsx`. Drop the button into any
   other page that needs a "Connect WhatsApp" CTA.
6. **Webhook** — Point Meta's webhook callback at
   `https://<your-host>/api/webhooks/whatsapp` with the verify token from
   env, and subscribe these fields: `messages`,
   `message_template_status_update`, `account_update`,
   `phone_number_quality_update`.
7. **Worker** — Replace the mock `enqueueWebhookEvent` (in
   `lib/whatsapp/queue.ts`) with a real producer (BullMQ + Redis, Vercel
   Queues / QStash, or Inngest). Run the worker that consumes events and
   calls `processIncomingMessage` from `lib/whatsapp/engine.ts`.
8. **Smoke test** — Use a test WhatsApp number in Meta's test list to:
   send a template, receive a status webhook, send an inbound message,
   confirm the engine advances the flow.

---

## 3. Data model summary

```
organizations            (id, name, plan, wallet_balance, …)
   │
   ├── organization_members  (user_id, role, status)
   │
   └── whatsapp_accounts     (id, organization_id, waba_id, business_id,
                              system_user_id, phone_number_id,
                              display_phone_number, status, webhook_verified)
        │
        ├── phone_numbers        (one per phone_number_id)
        ├── access_tokens        (rotated; only one is_active=true)
        └── webhook_subscriptions (one per account)

audit_logs                (append-only, scoped per org + user)
```

`whatsapp_accounts` is the join hub: every API call resolves the tenant from
`phone_number_id` → `organization_id`.

---

## 4. API contract

| Method | Path                          | Body / Query                                                              | Response                                                  |
|--------|-------------------------------|---------------------------------------------------------------------------|-----------------------------------------------------------|
| POST   | `/api/meta/exchange-token`    | `{ code }`                                                                | `{ transferId, expiresIn, systemUserId, scopes, wabas }`  |
| POST   | `/api/meta/save-account`      | `{ transferId, wabaId, phoneNumberId, businessId?, businessName?, phone? }` | `{ accountId, phoneRowId, refreshed }`                    |
| POST   | `/api/meta/subscribe-webhook` | `{ accountId }`                                                           | `{ status, subscribedFields }`                            |
| GET    | `/api/meta/accounts`          | —                                                                         | `{ organizationId, accounts: [...] }`                     |
| DELETE | `/api/meta/disconnect`        | `?accountId=...` or `{ accountId }`                                       | `{ status: 'disconnected', accountId }`                   |
| GET    | `/api/webhooks/whatsapp`      | `hub.mode`, `hub.verify_token`, `hub.challenge`                           | `200 <challenge>` if verify token matches                 |
| POST   | `/api/webhooks/whatsapp`      | Meta webhook envelope                                                     | `{ status: 'ok' }` returned in <100ms                     |

Errors follow `{ error: string, code: string }` shape with conventional
HTTP statuses (401 unauth, 400 bad input, 403 forbidden, 404 not found,
409 conflict, 410 expired transfer, 500 db, 502 Meta upstream).

---

## 5. Environment variables

```env
# ── Meta ─────────────────────────────────────────────────────────
NEXT_PUBLIC_META_APP_ID=              # client-side, used by FB.init
NEXT_PUBLIC_META_CONFIGURATION_ID=    # Embedded Signup config id
META_APP_SECRET=                      # server-side ONLY, used in oauth/access_token
WHATSAPP_WEBHOOK_VERIFY_TOKEN=        # 32+ random chars — set the same value in Meta

# ── Encryption ───────────────────────────────────────────────────
ENCRYPTION_KEY=                       # 64 hex chars (32 bytes), for AES-256-GCM

# ── Database / Auth (existing) ───────────────────────────────────
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
JWT_SECRET=                           # 64 random chars

# ── Site URL (used by callbacks) ─────────────────────────────────
NEXT_PUBLIC_SITE_URL=https://app.your-brand.com
```

The legacy `NEXT_PUBLIC_META_CONFIG_ID` continues to work — the new name
is preferred but the old one is honoured as fallback.

---

## 6. Security checklist

- [x] **Tokens encrypted at rest** with AES-256-GCM (`lib/crypto.ts`).
      `access_tokens.token_ciphertext` never contains plaintext.
- [x] **One-shot transfer cache** — the plaintext token between
      `exchange-token` and `save-account` lives in process memory for
      ≤5 minutes and is consumed on first read.
- [x] **JWT authentication** — every `/api/meta/*` route calls
      `getSessionUser()`. No anonymous access.
- [x] **Org-level isolation** — every read filters on
      `organization_id = ANY(get_user_org_ids())` via RLS. Service-role
      writes scope manually.
- [x] **Webhook signature** — `/api/webhooks/whatsapp` enforces
      `x-hub-signature-256` HMAC against `META_APP_SECRET`. Rejects 401.
- [x] **Audit log** — every onboarding step writes to `audit_logs`
      (`embedded_signup.*`, `whatsapp_account.*`, `access_token.*`).
- [x] **Token rotation** — `rotate_access_token()` RPC atomically
      revokes the previous active token and inserts the new one with
      `rotated_from` linkage.
- [x] **Cross-org takeover refused** — `save-account` returns 409
      `PHONE_TAKEN` if `phone_number_id` is already linked elsewhere.

For multi-instance production, replace `lib/whatsapp/token-cache.ts`
with a Redis-backed implementation (Upstash works on Vercel) — the
current in-memory cache is per-instance.

---

## 7. Production deployment guide

### 7.1 Provision

1. **Supabase** — Create a project, copy `URL` + `anon` + `service_role`
   into your env. Open SQL Editor and run migrations 001 → 010 in order.
2. **Hosting** — Deploy to Vercel (recommended). Add a custom domain
   (e.g. `app.your-brand.com`) and an internal env var
   `NEXT_PUBLIC_SITE_URL` matching the production URL.
3. **Encryption key** —
   `openssl rand -hex 32` → set as `ENCRYPTION_KEY`. **Never rotate**
   without a re-encrypt job.
4. **Meta app** — In the Meta App Dashboard:
   - Create a Business-type app.
   - Add WhatsApp + Facebook Login for Business products.
   - Create an Embedded Signup configuration with scopes
     `whatsapp_business_management` + `whatsapp_business_messaging`.
   - Whitelist the production origin under Facebook Login → Allowed Domains.
   - Submit for App Review when ready to onboard non-developer accounts.

### 7.2 Webhook setup

1. In your Meta App: **WhatsApp → Configuration → Webhook → Edit**.
2. Callback URL: `https://app.your-brand.com/api/webhooks/whatsapp`.
3. Verify token: paste the same value as `WHATSAPP_WEBHOOK_VERIFY_TOKEN`.
4. Subscribe fields: `messages`, `message_template_status_update`,
   `account_update`, `phone_number_quality_update`.
5. Click **Verify and save**. Meta will hit `GET /api/webhooks/whatsapp`
   once; if the verify token matches, the endpoint returns the
   challenge and the subscription becomes active.

### 7.3 Worker (recommended for production)

The mock queue runs the engine in-process. Under serverless platforms
this is fragile because the function can be reaped before the engine
finishes. Choose one of:

- **Vercel Queues** (QStash + a `POST /api/worker/whatsapp` route that
  receives the event JSON).
- **BullMQ + Redis** — run a dedicated long-running worker dyno that
  imports `processIncomingMessage` and calls it on every job.
- **Inngest** — wrap `processIncomingMessage` in an `inngest.createFunction`
  and let Inngest handle delivery + retries.

Pick one and replace the body of `enqueueWebhookEvent` in
`lib/whatsapp/queue.ts`.

### 7.4 Smoke test runbook

1. Open `/numbers/connect`. The "Connect WhatsApp" button should be
   enabled within ~1s of page load.
2. Click it → modal opens with the four requirements and two CTAs.
3. Click "Continue With Facebook" → Meta popup appears.
4. Complete signup with a test number.
5. After the popup closes, the modal should advance through
   `exchanging` → `success` (single number) or `choose` (multiple).
6. Verify rows landed in `whatsapp_accounts`, `phone_numbers`,
   `access_tokens`, `webhook_subscriptions`, and `audit_logs`.
7. Send yourself a message via `lib/whatsapp/sender.ts` (or curl).
8. Reply from WhatsApp → confirm the engine logs an "advanced session"
   line in your terminal.

---

## 8. Troubleshooting

| Symptom                                                | Likely cause                                                                         | Fix                                                                                  |
|--------------------------------------------------------|--------------------------------------------------------------------------------------|--------------------------------------------------------------------------------------|
| Modal stays disabled                                   | `NEXT_PUBLIC_META_APP_ID` or `NEXT_PUBLIC_META_CONFIGURATION_ID` not set             | Set both, restart `next dev`                                                          |
| `TRANSFER_EXPIRED` on save                             | More than 5 min between exchange and save, or function instance rotated              | Restart signup; consider Redis-backed cache for multi-instance                        |
| `PHONE_TAKEN` (409)                                    | The `phone_number_id` is linked to another org in `whatsapp_accounts`                | Disconnect it from the other org first, or contact support                            |
| `Invalid signature` on webhook                         | `META_APP_SECRET` mismatch or proxy mutates body                                     | Confirm raw body reaches the route untouched; verify secret                           |
| Webhook receives nothing                               | Subscription not active or fields not chosen                                         | Re-run subscribe in Meta dashboard; check `webhook_subscriptions.status`              |
| `engine: unknown phone_number_id`                      | Inbound webhook event for a phone not in `whatsapp_accounts`                         | Confirm onboarding completed; the cross-org takeover guard may have refused the save  |
| Audit log empty                                        | `audit_logs` migration not applied or service-role key not configured                | Apply migration 010; verify `SUPABASE_SERVICE_ROLE_KEY` is set in env                 |

---

## 9. What's deliberately *not* in this implementation

- **Multi-region tokens** — `lib/whatsapp/token-cache.ts` is in-process.
  Pick a Redis-backed cache before scaling to >1 instance.
- **Token refresh** — system-user tokens are long-lived; we record
  `expires_at` and surface it on `/api/meta/accounts`, but no automated
  refresh cron runs yet.
- **Sandbox routing** — every onboarding hits live Meta. For test
  environments, point a separate Meta App at a staging origin.
- **Org switching UI** — if a user belongs to multiple orgs, the API
  uses the first active membership. Add `?orgId=` support when you
  build a workspace switcher.
