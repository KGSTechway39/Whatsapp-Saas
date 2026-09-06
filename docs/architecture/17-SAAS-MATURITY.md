# 17 — SaaS Maturity Assessment

## Executive summary

SendAnjal's SaaS maturity is **strongly asymmetric**. The metering and monetisation layer —
usually the hardest and last thing a startup gets right — is already close to
enterprise-grade: a prepaid wallet with reserve/confirm semantics, integer-paise
arithmetic, a configurable COGS table, per-tier markup, top-up bonus bands, a separate
AI-credit ledger, and a full margin trail snapshotted onto every billed message.

Everything *around* that is early: no RBAC, no seats, no invoicing, no SSO, no feature-flag
system, no observability sink, no CI, no status page, and no automated tests over the money
code. Reports read a table nothing writes. The Team Members screen invites people who
cannot log in.

**Composite SaaS maturity: 44 / 100 — "Late MVP".**

The unusual shape here is worth stating plainly: most platforms at this stage have a
functioning product with broken billing. SendAnjal has correct billing with a partially
non-functional product. That is the better problem to have, because billing correctness is
the expensive thing to retrofit.

**Risk level:** Medium-High · **Complexity:** Medium · **Confidence:** High (92%)

---

## 1. Maturity scorecard

Levels: **0** absent · **1** stubbed · **2** functional · **3** production · **4** enterprise

| # | Capability | Level | Score | Evidence |
|---|---|:-:|---:|---|
| 1 | **Usage metering** | **4** | 95 | Per-message reserve/settle with `wholesale_paise` + `markup_bps` snapshotted per message; per-AI-call token + cost logging |
| 2 | **Prepaid wallet / credits** | **4** | 92 | Row-locked, idempotent, integer paise, never negative, ledger-backed, reservation model |
| 3 | **Pricing configurability** | **4** | 90 | `meta_rates` × `plan_tiers` × `platform_settings` + per-user overrides, all admin-editable with no deploy |
| 4 | **AI cost governance** | **4** | 88 | Separate credit ledger, tier gate, debit-on-success, always-logged |
| 5 | **Payments** | **3** | 80 | Razorpay orders + subscriptions, HMAC-verified webhook, insert-first idempotency, bonus bands |
| 6 | **Public API** | **3** | 78 | Key auth, SHA-256 hashes, 6 scopes with inheritance, per-key limits, `client_reference` idempotency, OTP flow, docs page |
| 7 | **Vertical packaging** | **3** | 80 | 6 verticals, 58 library artifacts, data-driven, AI injection at 3 sites |
| 8 | **Webhook integrity** | **3** | 82 | HMAC + `timingSafeEqual`, `processed_events` dedup, persist-then-enqueue, fast-ack |
| 9 | **Outbound webhooks (for clients)** | **3** | 75 | Per-tenant endpoints, HMAC signing, retry with `next_retry_at`, delivery log |
| 10 | **Subscription management** | **2** | 45 | Create/cancel work; `subscriptions` **table missing** so history is not persisted; `razorpay_plan_key` NULL (env used) |
| 11 | **Multi-tenancy** | **2** | 40 | Row-level, works — but 0 RLS policies, 1 confirmed cross-tenant write, two models in code |
| 12 | **Admin / back-office** | **2** | 55 | 8 admin routes covering rates, margin, billing mode, AI config, verticals — but **no audit on any of them** |
| 13 | **Reporting / analytics** | **1** | 25 | `/api/analytics` reads `daily_analytics`, which **nothing writes**. `ai_usage_log` written, never read. No margin dashboard |
| 14 | **Notifications** | **1** | 20 | Payment emails only. No low-balance alert (threshold stored), no template-approval relay, no in-app notifications |
| 15 | **Audit logging** | **1** | 25 | `audit_logs` covers 10 ESU/token actions. **Zero coverage of rates, margin, billing mode, tier, AI config.** `webhook_logs` table missing |
| 16 | **Observability** | **1** | 20 | Structured JSON logger with **no sink**; no APM, no alerting, no correlation ids, no tracing |
| 17 | **RBAC / permissions** | **1** | 15 | No `role` column; admin = env allowlist; `team_members.role` stored, never read; no team-member login |
| 18 | **Feature flags** | **1** | 20 | Env vars + `is_active` columns. No runtime flag service, no per-tenant targeting, no gradual rollout |
| 19 | **Testing / CI** | **1** | 12 | 212 LOC e2e; **0 unit tests**; no CI; no ESLint config; the one SQL test never runs |
| 20 | **Enterprise auth (SSO/SAML/SCIM/MFA)** | **0** | 5 | None |
| 21 | **Compliance (SOC2, DPDP, GDPR)** | **0** | 10 | No DPA, no retention policy, no erasure route, no export, no data-processing register |
| 22 | **Invoicing / tax (GST)** | **0** | 5 | Nothing generates an invoice. India B2B requires GST invoices |
| 23 | **SLA / status page / uptime** | **0** | 5 | `/api/health` (36 L) checks nothing external |
| 24 | **Onboarding / self-serve activation** | **2** | 50 | ESU works, but the token cache is per-process ⇒ intermittent failure; vertical assignment is admin-only |
| 25 | **Developer experience** | **2** | 60 | Good docs page and API design; no OpenAPI spec, no SDK, no sandbox environment, no webhook replay UI |
| 26 | **Scalability readiness** | **2** | 40 | Serverless + Postgres scales; but no cache, hottest join key unindexed, campaigns cap at ~1,000 recipients/invocation, rate limiting non-functional |

### Weighted composite

| Domain | Weight | Avg score | Weighted |
|---|---:|---:|---:|
| Monetisation (1–5, 10, 22) | 25% | 62 | 15.5 |
| Platform integrity (8, 9, 11, 15, 16) | 20% | 44 | 8.8 |
| Product completeness (7, 13, 14, 24) | 15% | 44 | 6.6 |
| Enterprise readiness (17, 20, 21, 23) | 15% | 9 | 1.4 |
| Engineering practice (19, 26) | 15% | 26 | 3.9 |
| Developer platform (6, 25) | 10% | 69 | 6.9 |
| **Composite** | **100%** | | **43.1** |

### **SaaS maturity: 44 / 100 — Late MVP**

| Band | Range |
|---|---|
| Prototype | 0–25 |
| Early MVP | 26–40 |
| **Late MVP** | **41–55** ← |
| Production SaaS | 56–75 |
| Enterprise SaaS | 76–90 |
| Best-in-class | 91–100 |

---

## 2. Subscription & billing

### What works

| Capability | Detail |
|---|---|
| Three coexisting billing models | A (BYO), B (managed/own WABA), C (managed/shared WABA) — branched on `billing_mode`, never assumed |
| Tier ⇄ axes lockstep | `setTier()` writes `tier`, `billing_mode`, `waba_mode` together so they cannot drift |
| Prepaid wallet | Reserve → send → settle-on-Meta-confirm, or release. **A message that never reaches `sent` is never charged** |
| Margin trail | `message_billing` snapshots `wholesale_paise` and `markup_bps` per message — margin stays reconstructible after a rate change |
| Idempotency | 5 partial-unique idempotency indexes; Razorpay webhook uses insert-first as a lock |
| Bonus bands | ≥₹1,000 → 0% · ≥₹5,000 → 3% · ≥₹10,000 → 6%, highest band cleared wins |
| Per-user price overrides | `message_pricing` with a partial unique for the platform default |

### What is missing or broken

| Gap | Impact |
|---|---|
| **`subscriptions` table missing** | Subscription lifecycle is not persisted. Only `users.tier` survives. No renewal history, no MRR reporting from data |
| **No invoicing / GST** | India B2B customers require GST invoices. Nothing generates one. This is a **sales blocker**, not a feature request |
| **`monthly_msg_cap` unenforced** | Starter's 5,000/month cap is stored and never checked. A funded Starter wallet sends unlimited |
| **`credit_validity_months` unenforced** | 12-month expiry is configured; no expiry job. Breakage revenue is modelled but not collected |
| **No dunning** | Failed payments email the user; no retry ladder, no grace period, no suspension flow |
| **No proration** | Mid-cycle tier changes have no proration logic |
| **Model C cannot send** | The cheapest tier is purchasable but not usable — no platform number pool |
| **Fallback undercharges** | If `plan_tiers`/`platform_settings` reads fail, pricing silently falls back to the cheaper legacy `message_pricing` defaults (MARKETING 88p vs derived 110p) with no warning |
| **No revenue reporting** | No MRR/ARR/churn/ARPU surface. The data exists in `transactions` and `platform_charges`; nothing reads it |

---

## 3. Usage tracking

| Signal | Captured? | Surfaced? |
|---|:-:|:-:|
| Messages sent, per tenant, per category | ✅ `message_billing`, `campaign_messages` | 🟡 `/api/billing/usage` |
| Cost of goods per message | ✅ `wholesale_paise` snapshot | 🔴 no report |
| Realised margin per message | ✅ derivable | 🔴 no report |
| AI tokens + raw cost per call | ✅ `ai_usage_log` (every call, incl. failures) | 🔴 **never read** |
| AI credits consumed | ✅ `ai_credit_ledger` | 🟡 `AICreditsIndicator` shows balance only |
| API-key request counts | ✅ `api_keys.request_count` | 🟡 |
| Daily rollups | 🔴 `daily_analytics` exists, **no writer** | 🔴 reads zeros |
| Delivery rates | ✅ `campaign_messages` status | 🟡 per-campaign only |
| Per-tenant quota consumption | 🔴 not tracked against `monthly_msg_cap` | 🔴 |

> **The most valuable unrealised asset in the platform.** `ai_usage_log` and
> `message_billing` together contain everything needed for per-tenant, per-task,
> per-category margin analysis — indexed and ready. No query reads either. A margin
> dashboard is a week of work against data already being collected.

---

## 4. RBAC & enterprise auth

| Requirement | Status |
|---|---|
| Roles | 🔴 No `role` column on `users` |
| Permissions | 🔴 None — any session can do anything within its tenant |
| Seats | 🔴 `team_members` rows exist; **no login path for a member** |
| Delegation | 🔴 |
| Admin | 🟡 `ADMIN_EMAILS` env allowlist — deliberately not in the DB "so it can't be self-granted" |
| **Admin action audit** | 🔴 **None on rates, margin, billing mode, tier, or AI config** |
| MFA | 🔴 Not even for admins who can change COGS |
| SSO / SAML / OIDC | 🔴 |
| SCIM provisioning | 🔴 |
| Session revocation | 🔴 7-day JWT, no denylist |
| IP allowlisting | 🔴 |
| API-key expiry | 🟡 Column exists, nothing sets it |

**The single most commercially serious item on this page:** an admin can change
`meta_rates` (COGS) or a tenant's `billing_mode` with **no audit record**. `lib/audit.ts`
exists, never throws, and takes a `details` object. Extending it to cover privileged
financial mutations is roughly 20 lines plus call sites, and it converts a hard finding in
any financial-controls review into a pass.

---

## 5. Feature flags

| Mechanism | Present |
|---|---|
| Env-var toggles | ✅ `QUEUE_DRIVER`, `DEMO_AUTO_LOGIN`, `DEV_AUTO_LOGIN`, `ANTHROPIC_API_KEY` presence |
| DB `is_active` columns | ✅ `industry_verticals`, `vertical_template_library`, `ai_model_config`, `api_keys`, `automation_flows` |
| **Tier-based gating** | ✅ `tierAllows(tier, taskType)` — server-side, per-capability |
| Runtime flag service | 🔴 |
| Per-tenant targeting | 🔴 |
| Gradual rollout / canary | 🔴 (Vercel Rolling Releases available, unused) |
| Kill switches | 🟡 `ai_model_config.is_active` acts as one for AI |

The tier gate is genuinely a well-built entitlement system. What is missing is per-tenant
overrides — there is no way to enable one feature for one customer without changing their tier.

**A concrete need already exists:** [10-AI.md](10-AI.md) recommends disabling AI intent
routing for the `hospital` and `school` verticals on data-protection grounds. There is no
mechanism to express that today.

---

## 6. Reports & notifications

### Reports

| Report | Status |
|---|---|
| Campaign performance | ✅ `/api/campaigns/[id]` with timeseries + cost breakdown |
| Wallet / transactions | ✅ |
| Billing usage | 🟡 `/api/billing/usage` |
| Dashboard summary | 🟡 partly reads the unwritten `daily_analytics` |
| Analytics over time | 🔴 reads `daily_analytics` — empty |
| Optimal send time | 🟡 `/api/analytics/optimal-time` exists |
| **Platform margin** | 🔴 none |
| **MRR / churn / ARPU** | 🔴 none |
| **AI cost & margin** | 🔴 none |
| Deliverability / quality rating | 🔴 none |
| Tenant health / activation funnel | 🔴 none |
| Exportable / scheduled reports | 🔴 none |

### Notifications

| Channel | Status |
|---|---|
| Payment success/failure email | ✅ Resend (console-logs if unset) |
| Outbound webhooks to client systems | ✅ signed, retried, logged |
| **Low wallet balance** | 🔴 Threshold columns exist on `wallet` **and** `platform_settings`; **no sender.** A managed tenant hits `INSUFFICIENT_BALANCE` with no warning — a churn event |
| **Template approved / rejected** | 🔴 No `message_template_status_update` webhook branch |
| **Number quality-rating drop** | 🔴 No `phone_number_quality_update` branch |
| **Token expiring** (~60 days) | 🔴 No rotation job, no alert |
| Campaign complete | 🔴 |
| In-app notifications | 🔴 No table, no UI. The Inbox nav badge is **hardcoded to `3`** (`Sidebar.tsx:50`) |
| Password reset email | 🔴 `TODO` |
| Admin alerts (rate staleness, wallet errors, webhook failures) | 🔴 |

**Four of these are silent-failure notifications** — low balance, template rejection,
quality drop, token expiry. Each one turns a preventable problem into a support ticket or a
churn event, and all four are cheap to build because the data is already in the database.

---

## 7. Scalability readiness

| Dimension | Assessment |
|---|---|
| Compute | ✅ Serverless, stateless handlers, Fluid Compute instance reuse |
| Database | 🟡 Single Postgres. Good tenant indexes — but the hottest join key (`whatsapp_numbers.phone_number_id`) is **unindexed**, plus 13 unindexed FKs |
| Caching | 🔴 None. ~8 DB round-trips per managed send |
| Queue | 🟡 Good abstraction; inline driver is non-durable on serverless and the pg-boss cron **fires daily** |
| Campaign throughput | 🔴 ~1,000 recipients per invocation; no continuation found |
| Rate limiting | 🔴 Per-process ⇒ non-functional |
| Meta rate limits | 🔴 Not modelled — no token bucket, no messaging-tier awareness |
| Token rotation | 🔴 None ⇒ ~60-day tenant outages |
| Connection pooling | 🟡 PostgREST is stateless ✅; pg-boss needs session-mode (5432) — connection exhaustion risk |
| Frontend | 🔴 41 client pages, no RSC, no `loading.tsx`, no virtualisation |
| Multi-region | 🔴 Single region |
| Horizontal DB scaling | 🔴 No read replicas, no sharding plan |

**First three walls, in order:** (1) `phone_number_id` sequential scan on inbound,
(2) the ~1,000-recipient campaign ceiling, (3) token expiry causing tenant-wide outages.
All three are days of work, not architecture changes.

---

## 8. Developer experience

| Item | Status |
|---|---|
| API design consistency | ✅ v1 routes use one `{error:{code,message}}` envelope |
| Authentication | ✅ Bearer key, clear format, scopes with inheritance |
| Idempotency | ✅ `client_reference` on sends |
| Rate-limit headers | ✅ `X-RateLimit-Remaining` / `-Reset` |
| Docs | 🟡 Two hand-written pages (`/docs/api` 274 L, `/settings/api/docs` 539 L) that will drift |
| **OpenAPI spec** | 🔴 |
| SDKs | 🔴 |
| Sandbox / test environment | 🟡 `environment: 'test'` on api_keys; **unable to determine** whether test keys behave differently |
| Webhook testing tools | 🔴 No replay UI, no test-event sender |
| Changelog / versioning | 🟡 `/v1` prefix exists; no deprecation policy |
| Status page | 🔴 |
| Error message quality | ✅ Actionable (e.g. the AUTHENTICATION-template rejection explains exactly what to use instead) |

---

## 9. Compliance & governance

| Requirement | Status | Note |
|---|---|---|
| **DPDP (India)** — the applicable regime | 🔴 | No DPA, no processing register, no consent record beyond `contacts.status`, no erasure route, no export, no retention policy |
| Data retention | 🔴 | `webhook_inbox` holds raw multi-tenant customer message content indefinitely, with no tenant column |
| Right to erasure | 🟡 | `ON DELETE CASCADE` would work; no route exposes it, and `webhook_inbox` would not be purged |
| Data portability | 🔴 | No export |
| **Cross-border processing disclosure** | 🔴 | Inbound customer message text is sent to Anthropic for intent classification on **every** inbound message, with no tenant opt-out. For hospitals (patient messages) and schools (parent/minor messages) this needs explicit disclosure |
| Encryption at rest | ✅ | AES-256-GCM for Meta tokens; Supabase disk encryption. 🔴 `meta_app_secret` plaintext |
| Encryption in transit | ✅ | HTTPS + HSTS preload |
| Audit trail | 🔴 | ESU only |
| SOC 2 / ISO 27001 | 🔴 | No controls framework, no evidence collection |
| PCI | ✅ N/A | Razorpay-hosted checkout; no card data touches SendAnjal |
| Accessibility (WCAG) | 🔴 | 8 `aria-label`s and **0 `htmlFor`** app-wide — a procurement blocker for the hospital and school verticals |

---

## Advantages

- **Metering and monetisation are near enterprise-grade** — the hardest layer to retrofit
  is already correct: reserve/confirm, integer paise, idempotent RPCs, per-message margin trail.
- **Pricing and AI cost are runtime-configurable** with no deploy. Rare and operationally valuable.
- **Three billing models coexist cleanly** behind two axes kept in lockstep.
- **Webhook integrity is production-grade**: HMAC, dedup, persist-first, fast-ack.
- **Tier gating is a real server-side entitlement system**, not UI hiding.
- **The public API is genuinely well-designed** — consistent envelopes, scopes, idempotency,
  rate-limit headers, OTP flow.
- **The vertical layer is a credible packaging/pricing lever** already live in the database.
- **All the telemetry needed for margin analysis is already being collected.**

## Disadvantages

- Zero enterprise auth: no RBAC, no seats, no SSO, no MFA, no SCIM.
- No audit trail on any pricing, margin, or billing-mode change.
- No invoicing or GST — a hard blocker for India B2B.
- Reports read a table nothing writes; the richest telemetry is never queried.
- Four silent-failure notifications missing (low balance, template rejection, quality drop,
  token expiry), all cheap to build.
- No CI, no unit tests over the money layer, no lint config.
- No observability sink, no alerting, no tracing.
- No compliance posture for the regime that actually applies (DPDP), and an undisclosed
  cross-border LLM processing flow for the most sensitive verticals.
- The cheapest tier cannot send; `monthly_msg_cap` and credit expiry are configured but
  unenforced, so two revenue mechanisms are modelled and uncollected.
- No feature-flag mechanism, despite a concrete per-vertical need already identified.

## Recommendations

Sequenced as a maturity ladder. Each rung is a prerequisite for the next commercial tier.

### Rung 1 — Reach "Production SaaS" (56–75). Target: 8 weeks.

| P | Recommendation |
|---|---|
| P0 | CI running `npm run check` + the SQL wallet test + unit tests on the 12 pure functions |
| P0 | Audit every privileged mutation via the existing `lib/audit.ts` |
| P0 | Fix the cross-tenant write; ship the tenant-predicate CI lint |
| P0 | Wire `logger.error` to Sentry; alert on auth failures, wallet errors, webhook signature failures |
| P0 | Deploy `upsert_daily_analytics()` — or replace analytics with live aggregates |
| P1 | Ship the four missing notifications (low balance, template status, quality rating, token expiry) |
| P1 | Token-rotation cron |
| P1 | Enforce `monthly_msg_cap` and credit expiry — both are uncollected revenue |
| P1 | Build the margin dashboard from `ai_usage_log` + `message_billing` |
| P1 | Persist subscriptions (create the missing table) and report MRR |

### Rung 2 — Reach "Enterprise-capable" (76–90). Target: +12 weeks.

| P | Recommendation |
|---|---|
| P1 | Real RBAC: `users.role`, team-member login, `can(user, action, resource)` |
| P1 | GST invoicing |
| P1 | Session-variable RLS (Option A in [16](16-MULTI-TENANCY.md)) |
| P2 | DPDP package: DPA, retention policy, erasure route, export endpoint, cross-border disclosure, per-tenant AI opt-out |
| P2 | Per-tenant feature flags (needed for the hospital/school AI opt-out) |
| P2 | OpenAPI spec + a real sandbox environment |
| P2 | Accessibility remediation (procurement blocker for the target verticals) |
| P2 | Status page + a meaningful `/api/health` |

### Rung 3 — Reach "Best-in-class" (91–100).

| P | Recommendation |
|---|---|
| P3 | SSO/SAML + SCIM + MFA |
| P3 | SOC 2 Type II |
| P3 | Multi-region / data residency options |
| P3 | Reseller/agency hierarchy — the India channel play |
| P3 | Usage-based overage billing with proration and dunning |
