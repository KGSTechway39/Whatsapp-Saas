# 04 — System Architecture

## Executive summary

A **modular monolith on serverless**. One Next.js deployment holds the UI, the entire
HTTP API, and the background workers; Postgres is the only stateful component and also
serves as the job queue and the coordination primitive (row locks, unique constraints,
idempotency keys). There is no service mesh, no message broker, no cache tier.

The architecture is **event-driven at its edges** (Meta webhooks, Razorpay webhooks,
outbound webhooks to client systems) and **transactional at its core** (money mutations
in SQL functions). The dominant pattern is *fast-ack + async worker*: handlers verify,
persist, enqueue, and return.

The design is sound. The gap between design and deployment — one tenant model in the
DB, two in the code; a daily cron for a per-minute queue — is where the failures live.

**Risk level:** Medium · **Complexity:** Medium · **Confidence:** High (94%)

---

## 1. Container view

```mermaid
flowchart TB
    subgraph EXT["External actors"]
        SMB["SMB operator<br/>(browser)"]
        DEV["Integrator<br/>(API key)"]
        CONS["Consumer<br/>(WhatsApp)"]
        ADMIN["SendAnjal admin"]
    end

    subgraph VERCEL["Vercel — single Next.js 14 deployment (Node.js runtime)"]
        MW["middleware.ts<br/>JWT guard · 16 protected prefixes"]
        subgraph UI["UI layer"]
            AUTHP["(auth) — 4 pages"]
            DASHP["(dashboard) — 41 client pages"]
        end
        subgraph HTTP["HTTP layer — 113 route handlers"]
            RSESSION["Session routes (~95)"]
            RADMIN["Admin routes (8)"]
            RAPI["Public API v1 (9)"]
            RHOOK["Webhook receivers (3)"]
            RCRON["Cron (1)"]
        end
        subgraph DOMAIN["Domain layer — lib/"]
            BILL["billing/"]
            WA["whatsapp/"]
            AI["ai/"]
            AUTO["automation/"]
            VERT["verticals/"]
            Q["queue/"]
        end
        WORKER["Inbound worker<br/>(inline or pg-boss handler)"]
    end

    subgraph DATA["Supabase Postgres"]
        TABLES["37 tables"]
        FN["13 functions<br/>wallet_* · ai_wallet_* · increment_*"]
        PGB["pgboss schema"]
    end

    subgraph SVC["Third parties"]
        META["Meta Graph v22.0"]
        RZP["Razorpay"]
        ANT["Anthropic"]
        GO["Google OAuth"]
        RESEND["Resend"]
    end
    CLIENTSYS["Client's own systems<br/>(CRM / ERP)"]

    SMB --> MW --> DASHP -->|"lib/api.ts fetch"| RSESSION
    ADMIN --> RADMIN
    DEV -->|"Bearer wsk_*"| RAPI
    CONS <-->|"messages"| META
    META -->|"POST + X-Hub-Signature-256"| RHOOK
    RZP -->|"POST + x-razorpay-signature"| RHOOK
    RCRON --> Q

    RSESSION --> DOMAIN
    RADMIN --> DOMAIN
    RAPI --> DOMAIN
    RHOOK --> DOMAIN
    DOMAIN --> TABLES
    BILL -->|RPC| FN
    AI -->|RPC| FN
    WA --> META
    AI --> ANT
    RSESSION --> RZP
    RSESSION --> GO
    RHOOK --> RESEND
    Q --> PGB
    Q --> WORKER
    WORKER --> AUTO
    WORKER --> WA
    RHOOK -->|"outbound webhook + HMAC"| CLIENTSYS

    style DATA fill:#0B7285,color:#fff
    style BILL fill:#157F5B,color:#fff
```

**Architectural style:** modular monolith · event-driven edges · transactional core ·
serverless compute · single-database persistence.

---

## 2. Request flow — the general shape

```mermaid
sequenceDiagram
    autonumber
    participant B as Browser
    participant MW as middleware.ts
    participant R as Route handler
    participant L as lib/ domain
    participant PG as Postgres
    participant X as External API

    B->>MW: GET /campaigns
    MW->>MW: jwtVerify(wa_session, HS256)
    alt no/invalid token
        MW-->>B: 307 → /login (or /api/auth/dev-login if DEMO_AUTO_LOGIN)
    end
    MW-->>B: page shell (client component)
    B->>R: fetch /api/campaigns
    R->>R: getSessionUser() → 401 if null
    R->>R: (3 of 113 routes) Zod safeParse
    R->>L: domain call
    L->>PG: service-role query + .eq("user_id", user.id)
    PG-->>L: rows
    opt side effects
        L->>X: Meta / Razorpay / Anthropic
    end
    L-->>R: result
    R-->>B: NextResponse.json
```

**Invariant:** every read/write is tenant-scoped by an **explicit `.eq("user_id", …)` in
application code**. The database contributes no isolation (RLS enabled, 0 policies).
See [16](16-MULTI-TENANCY.md).

**Handler discipline (Law #4 — no synchronous external I/O in handlers):** honoured on
the webhook path (persist → enqueue → 200) but **violated on most session routes**,
which call Meta inline (`whatsapp/send`, `templates/sync`, `campaigns/execute`,
`meta/*`). That is a pragmatic choice for user-initiated actions where the user is
waiting, but it means p95 latency on those routes is Meta's latency.

---

## 3. Authentication flow

```mermaid
sequenceDiagram
    autonumber
    participant U as User
    participant P as /login page
    participant A as POST /api/auth/login
    participant PG as users table
    participant MW as middleware.ts

    U->>P: email + password
    P->>A: JSON
    A->>A: checkRateLimit(AUTH_LIMIT 10/60s) ⚠ per-instance
    A->>A: loginSchema.safeParse (Zod)
    A->>PG: select password_hash where email=?
    A->>A: bcrypt.compare
    A->>A: createSessionToken → jose SignJWT HS256, 7d
    A-->>U: Set-Cookie wa_session (httpOnly, secure, sameSite=lax, 7d)
    U->>MW: any /dashboard request
    MW->>MW: jwtVerify → allow
```

**Google OAuth** runs in parallel: `/api/auth/google` → consent → `/api/auth/google/callback`
→ upsert `users` → same `wa_session` cookie. **Password reset** stops at a `TODO`
(`app/api/auth/forgot-password/route.ts:20`) — it correctly returns a
non-enumerable response but sends nothing.

**The demo bypass.** When `DEMO_AUTO_LOGIN=true`, `middleware.ts:54-61` redirects any
unauthenticated request for a protected path to `/api/auth/dev-login`, which mints a
full 7-day session for `admin@sendanjal.com` — **in production**. Deliberate and
documented; see [12](12-SECURITY.md).

**JWT payload** is `{id, email, name, company}` (`lib/auth.ts:15`). It deliberately
carries **no tier and no role**, so both are re-read from the DB on every use
(`lib/ai/config.ts:63-74` explains this: "the authoritative gate, not a cached/spoofable
claim"). Good decision; costs a query per AI call.

---

## 4. Outbound message flow (the money path)

```mermaid
sequenceDiagram
    autonumber
    participant C as Caller (route/campaign/API)
    participant GS as guardedSingleSend
    participant PR as pricing/rates
    participant W as wallet RPCs
    participant M as lib/meta.ts
    participant MB as message_billing
    participant META as Meta Graph
    participant WH as webhook/whatsapp
    participant CF as confirmOrReleaseBilling

    C->>GS: {userId, category, send()}
    GS->>PR: getBillingMode(userId)
    alt billing_mode = 'byo'
        GS->>M: send() unchanged — no wallet
        M-->>C: {messageId}
    else billing_mode = 'managed'
        GS->>PR: quoteSend(user, category)
        Note over PR: 1 user override → 2 wholesale×(markup+buffer) → 3 legacy default
        alt chargedPaise = 0 (SERVICE)
            GS->>M: send() — free, no wallet
        else
            GS->>W: wallet_reserve (row-locked, idempotent)
            alt INSUFFICIENT_BALANCE
                W-->>C: throw → HTTP 402
            end
            GS->>M: send()
            alt send throws
                GS->>W: wallet_release
                GS-->>C: rethrow
            end
            M->>META: POST /{phone_number_id}/messages
            META-->>M: {messages:[{id}]}
            alt no messageId returned
                GS->>W: wallet_release (never hold forever)
            else
                GS->>MB: insert {wa_message_id, reservation_id, cost, wholesale, markup, status:'reserved'}
            end
        end
    end

    META->>WH: status event (sent/delivered/read/failed)
    WH->>WH: verify HMAC → dedup wa_status:{id}:{status}
    WH->>CF: confirmOrReleaseBilling(waMessageId, status)
    CF->>MB: select where status='reserved'
    alt sent | delivered | read
        CF->>W: wallet_settle(resv, cost, unit_idem=waMessageId)
        CF->>W: wallet_release (close the single-unit hold)
        CF->>MB: status='settled', settled_at
    else failed
        CF->>W: wallet_release
        CF->>MB: status='released'
    end
```

**Why this is correct:** the debit happens only after Meta confirms the message left
our hands. A hold is not revenue. Idempotency is triple-layered — `message_billing.status`
gates re-entry, `wallet_settle` is idempotent per `(reservation_id, wa_message_id)`, and
`wallet_release` is idempotent — so duplicate or out-of-order webhooks cannot
double-charge (`lib/billing/confirm.ts:9-15`).

**Campaign variant** (`app/api/campaigns/execute/route.ts`): reserve the **whole**
broadcast up-front (hard stop if unaffordable, campaign marked failed and nothing sends),
then `settle` one unit per success inside a `BATCH_SIZE = 50` loop, then `release` the
remainder at the end. Correct pattern for fan-out.

### Gap: the 24-hour window

```mermaid
flowchart LR
    subgraph GATED["✅ Window enforced"]
        D["lib/whatsapp/dispatch.ts:46<br/>canSend(kind, windowState)"]
        I["inbox/[id]/send:67-74<br/>inline is_within_24h_window check"]
    end
    subgraph UNGATED["🔴 No window check"]
        S1["/api/whatsapp/send"]
        S2["/api/v1/messages/send"]
        S3["/api/campaigns/execute"]
        S4["/api/products/send"]
        S5["/api/carts/[id]/recover"]
        S6["/api/meta/test-message"]
    end
    style UNGATED fill:#7f1d1d,color:#fff
```

`canSend()` has exactly **one** caller repo-wide. `/api/whatsapp/send` accepts
`type: "text"` (free-form) and sends it with no window evaluation
(`app/api/whatsapp/send/route.ts:51-80`). Outside an open window Meta returns error
**131047** and repeated attempts degrade the number's quality rating — a business-level
consequence, not just an error. Law #5 violation.

---

## 5. Inbound message flow

```mermaid
sequenceDiagram
    autonumber
    participant META as Meta
    participant WH as POST /api/webhook/whatsapp
    participant WI as webhook_inbox
    participant WL as webhook_logs
    participant PE as processed_events
    participant Q as lib/queue
    participant WK as runInboundWorker
    participant ENG as engine.ts (org)
    participant RT as automation/runtime.ts (legacy)
    participant DSP as dispatch.ts

    META->>WH: POST entry[].changes[].value
    WH->>WH: rate-limit wh:{ip} 200/10s ⚠ per-instance
    WH->>WH: HMAC verify X-Hub-Signature-256 (timingSafeEqual)
    alt invalid
        WH-->>META: 401
    end
    WH->>WI: persistRawEvent (replayable) ✅
    WH->>WH: resolve phone_number_id → whatsapp_accounts 🔴 table missing → NULL
    WH->>WL: insert audit row 🔴 table missing → warn, id=null
    WH->>PE: markEventProcessed(wa_enq:{msgId})
    WH->>Q: enqueueWebhookEvent (fire-and-forget)
    WH-->>META: 200 (fast ack)

    par Status branch (inline)
        WH->>PE: dedup wa_status:{id}:{status}
        WH->>WH: processStatusEvent → campaign_messages monotonic update ✅
        WH->>WH: confirmOrReleaseBilling ✅
        WH->>WH: dispatchEvent → client webhooks ✅
    and Message branch (inline)
        WH->>PE: dedup wa_msg:{id}
        WH->>WH: CTWA capture 🔴 ad_campaigns/ad_leads/contacts.ctwa_* missing
        WH->>WH: UPDATE contacts SET last_inbound_at WHERE phone=? 🔴 NO TENANT FILTER
        WH->>WH: upsert conversations ✅
        WH->>WH: insert messages 🔴 wrong column + missing NOT NULLs → FAILS
    and Worker branch (async)
        Q->>WK: InboundEvent
        WK->>ENG: processIncomingMessage
        ENG-->>WK: {matched:false, reason:"unknown_phone_number_id"} 🔴 always
        WK->>RT: resolveUserIdByPhoneNumberId → whatsapp_numbers ✅
        RT->>RT: classifyIntent (AI, 2s) → keyword fallback
        RT-->>WK: {flowId, flowData}
        WK->>WK: renderFirstReply — FIRST sendMessageNode only
        WK->>DSP: sendOutbound (window gate ✅)
        DSP->>DSP: whatsapp_accounts lookup 🔴 table missing → "NO_TOKEN"
    end
```

**Four defects visible in one diagram:**

| # | Defect | Consequence |
|---|---|---|
| 1 | `webhook_logs` missing | No webhook audit trail; the duplicate-detection branch (`code === "23505"`) can never fire, so the route relies solely on `processed_events` |
| 2 | `contacts` update has no tenant predicate | Cross-tenant write (`route.ts:386-389`) |
| 3 | `messages` insert uses `meta_message_id`, omits `user_id`/`type` | **Every inbound message fails to persist.** Inbox shows outbound only |
| 4 | Worker → `dispatch.ts` → `whatsapp_accounts` (missing) | The automation reply is computed, then **cannot be sent** — returns `NO_TOKEN` |

Defect 4 is the cruellest: `queue.ts:110-112` documents that a *previous* bug discarded
the engine's reply, and the fix was to call `sendOutbound`. But `sendOutbound` resolves
its token from the undeployed org table, so **the automation reply still does not go out.**
Fixing this is a ~6-line change: resolve the token from `whatsapp_numbers` instead.

**What does work inbound:** signature verification, raw-payload persistence for replay,
per-event idempotency, status processing, billing settlement, and outbound webhook
dispatch to client systems. The integrity machinery is right; the persistence targets
are wrong.

---

## 6. Payment flow

```mermaid
sequenceDiagram
    autonumber
    participant U as User
    participant P as /billing/recharge
    participant TU as POST /api/wallet/topup
    participant RZP as Razorpay
    participant WHK as POST /api/billing/webhook
    participant W as wallet_credit RPC
    participant E as Resend

    U->>P: enter amount (min ₹1,000)
    P->>TU: {amount}
    TU->>RZP: create order
    RZP-->>U: Razorpay checkout
    U->>RZP: pay (UPI/card/netbanking)
    RZP->>WHK: payment.captured / order.paid
    WHK->>WHK: verifyWebhookSignature(rawBody, x-razorpay-signature) → 401 if bad
    WHK->>WHK: insert-first idempotency on x-razorpay-event-id
    WHK->>WHK: resolveTopupBonusBps(amount) → 0% / 3% / 6%
    WHK->>W: wallet_credit(user, amount+bonus, 'recharge', idem)
    W-->>WHK: new balance
    WHK->>E: paymentSuccessEmail
    WHK-->>RZP: 200
```

Subscriptions follow the same shape via `subscription.*` events →
`POST /api/billing/create-subscription`. **Note:** `subscription` events would write a
`subscriptions` table that **does not exist** in production, so subscription state is
not persisted; only `users.tier` (set via `setTier`) survives.

**Correct details worth noting:** raw body read before JSON parse for signature
verification (`route.ts:17-18`), `runtime = "nodejs"` pinned, and insert-first
idempotency used as a lock rather than a check-then-act race.

---

## 7. Notification flow

Three distinct outbound channels:

```mermaid
flowchart LR
    subgraph SRC["Event sources"]
        S1["Meta status webhook"]
        S2["Razorpay webhook"]
        S3["Send actions"]
        S4["Low wallet balance"]
    end
    S1 -->|"message.delivered/read/failed"| OW["lib/webhooks-out.ts<br/>dispatchEvent + HMAC"]
    S3 -->|"message.sent"| OW
    OW --> WEP["webhook_endpoints (per-tenant URLs)"]
    OW --> WDL["webhook_deliveries<br/>attempts · next_retry_at · response_status"]
    WDL --> CLIENT["Client CRM / ERP"]

    S2 --> EM["lib/email.ts (Resend)"]
    EM --> USER["Tenant inbox"]

    S4 -.->|"threshold stored, no sender found"| NONE["❓ no notifier"]

    style NONE fill:#7f1d1d,color:#fff
```

| Channel | Status |
|---|---|
| **Outbound webhooks to clients** | ✅ Live. Signed, retried (`next_retry_at`), success counter via `increment_webhook_endpoint_success` RPC (exists in DB) |
| **Transactional email** | ✅ Live for payment success/failure. Console-logs if `RESEND_API_KEY` unset. Not in `package.json` — presumed REST |
| **Low-balance alert** | 🔴 `wallet.low_balance_threshold_paise` and `platform_settings.default_low_balance_threshold_paise` both exist and are read, but **no code sends the alert**. A managed tenant hits `INSUFFICIENT_BALANCE` with no prior warning — a churn event |
| **In-app notifications** | 🔴 None. No `notifications` table, no bell UI. Sidebar `badge: 3` on Inbox is **hardcoded** (`Sidebar.tsx:50`) |
| **Template approval/rejection** | 🔴 Meta sends `message_template_status_update` webhooks; the handler's `eventType` classifier has no branch for them (`route.ts:105-112` → `"unknown"`). A tenant is never told their template was approved or rejected |

---

## 8. Data flow summary

| Flow | Trigger | Path | Durability |
|---|---|---|---|
| Session read | Page load | client → `/api/*` → PG | none (no cache) |
| Single send | User action | route → `guardedSingleSend` → Meta | `wallet_reservations` + `message_billing` |
| Broadcast | Campaign launch | route → reserve-all → 50-batch loop → settle-per-unit | `campaigns`, `campaign_messages` |
| Status | Meta push | webhook → dedup → monotonic update → settle | `processed_events`, `campaign_messages` |
| Inbound | Meta push | webhook → `webhook_inbox` → queue → worker → reply | `webhook_inbox` ✅, `messages` 🔴 |
| AI draft | User action | route → `runTask` → adapter → debit → log | `ai_credit_ledger`, `ai_usage_log` |
| Payment | Razorpay push | webhook → verify → idempotent credit → email | `transactions`, `wallet` |
| Client webhook | Status/send | `dispatchEvent` → HMAC POST → retry | `webhook_deliveries` |
| Vertical provision | Admin action | route → `setVerticalForUser` (one column) | `users.vertical_id` |

---

## Advantages

- **One deploy unit** — no distributed-systems tax at this scale; a single `next build`
  is the whole platform.
- **Postgres as the coordination primitive** — row locks, unique constraints, and
  idempotency keys do work that would otherwise need Redis or a saga framework.
- **Persist-then-enqueue** on the webhook means no event is unrecoverable, even if the
  worker dies after the 200 ack.
- **Fast-ack** design keeps Meta from retry-storming.
- **Reserve/confirm** billing is the correct model for an unreliable downstream.
- The queue seam makes durability a configuration decision.

## Disadvantages

- Serverless + in-memory singletons (rate limiter, ESU token cache) is a semantic
  mismatch that both modules acknowledge.
- No cache tier ⇒ ~5 config reads before every managed send.
- Law #4 violated on user-facing routes (inline Meta calls) — acceptable but caps p95.
- The async worker path is **fully dead in production** because it resolves tenants and
  tokens from the undeployed org tables.
- Notification coverage is thin: no low-balance warning, no template-status relay.

## Recommendations

| P | Recommendation |
|---|---|
| **P0** | Repoint `lib/whatsapp/dispatch.ts` token resolution to `whatsapp_numbers` (~6 lines). This alone makes automation replies actually send. |
| **P0** | Fix the `messages` insert (correct column, add `user_id`/`type`) and add the tenant predicate to the `contacts` update. |
| P1 | Route every send through one function that enforces window + billing + logging. Delete the ungated paths. |
| P1 | Add a `message_template_status_update` branch to the webhook and notify the tenant. |
| P1 | Ship the low-balance notifier — the threshold columns already exist. |
| P2 | Cache the four config tables (60 s) to cut per-send latency. |
| P2 | Move Meta calls on non-interactive routes (`templates/sync`, `campaigns/execute`) onto the queue to honour Law #4. |
| P3 | Replace the hardcoded Inbox badge with a real unread count (`conversations.unread_count` exists). |
