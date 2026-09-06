# 12 — Security Report

## Executive summary

**Cryptography and transport security are done properly. Authorization and input
validation are not.**

The primitives are right: AES-256-GCM for Meta tokens at rest with a per-value random IV,
SHA-256 hashed API keys, bcrypt passwords, `timingSafeEqual` HMAC comparison over raw
webhook bytes, httpOnly/Secure/SameSite cookies, a hand-written CSP with documented
exceptions, and full security headers including HSTS with preload.

The gaps are structural rather than cryptographic:

- **Zero RLS policies** across 37 tables — tenant isolation has no database backstop.
- **Zod validation on 3 of 113 routes** (2.7%), with nine schemas written and unused.
- **`DEMO_AUTO_LOGIN=true` grants any anonymous visitor a full production session.**
- **Rate limiting does not function** on the deployment target (per-process `Map`s).
- **No audit trail on any financially sensitive action** (rates, margin, billing mode).

SQL injection is structurally impossible (no string-concatenated SQL anywhere) and XSS
risk is low (no `dangerouslySetInnerHTML` in the sampled code, React escaping by default).

**Risk level:** High · **Complexity:** Medium · **Confidence:** High (92%)

---

## 1. OWASP Top 10 (2021) assessment

| # | Category | Rating | Evidence |
|---|---|---|---|
| **A01** | **Broken Access Control** | 🔴 **Critical** | 0 RLS policies; no role model; one confirmed cross-tenant write (`webhook/whatsapp:386`); state-changing `GET` endpoints; `/api/*` not covered by middleware |
| **A02** | Cryptographic Failures | 🟡 Medium | AES-256-GCM ✅, bcrypt ✅, SHA-256 keys ✅. **But**: `meta_app_secret` plaintext; dev `ENCRYPTION_KEY` = 64 zeros; token in URL query string |
| **A03** | **Injection** | 🟢 Low | No raw SQL concatenation. All queries via `supabase-js` builder or parameterised RPC (`p_user`, `p_amount_paise`, …). `sanitizeSearch()` exists for `ilike` escaping — **but is never called** |
| **A04** | Insecure Design | 🟠 High | Prod demo bypass; two tenant models; 24h window unenforced on 5 of 7 send paths |
| **A05** | Security Misconfiguration | 🟡 Medium | Headers/CSP good ✅. **But**: no ESLint config, no CI, webhook signature bypass when `META_APP_SECRET` unset in non-prod, `search_path` unpinned on one function |
| **A06** | Vulnerable Components | 🟢 Low | 29 runtime deps; `npm audit --omit=dev --audit-level=high` is in the gate script. Next.js 14.2.35 is patched but a major behind |
| **A07** | **Identification & Authentication** | 🟠 High | Good cookie/JWT hygiene ✅. **But**: 7-day session with no revocation, no MFA, password reset non-functional, rate limiting ineffective, demo bypass |
| **A08** | Software & Data Integrity | 🟡 Medium | Webhook HMAC ✅, idempotency ✅. **But**: no CI, no signed commits, no dependency pinning beyond the lockfile, no SRI (all assets are self-hosted, so low impact) |
| **A09** | **Security Logging & Monitoring** | 🔴 **Critical** | Structured logger with **no sink**; `audit_logs` covers only ESU actions; **no financial-action audit**; no alerting; no APM; `webhook_logs` table missing so the webhook audit trail does not exist |
| **A10** | Server-Side Request Forgery | 🟡 Medium | `webhook_endpoints.url` is tenant-supplied and POSTed to by `lib/webhooks-out.ts`. **Unable to determine** whether internal/loopback ranges are blocked — `lib/webhooks-out.ts` (213 L) not read. `httpRequestNode` in the flow builder is a second SSRF surface |

---

## 2. Injection

### SQL injection — structurally prevented

```
grep for raw SQL string building in app/ and lib/  →  none found
```

Every query goes through one of two safe paths:

| Path | Safety |
|---|---|
| `supabase.from(t).select().eq(col, val)` | PostgREST parameterises values |
| `supabase.rpc("wallet_settle", { p_resv, p_actual_paise, … })` | Typed SQL function arguments |

**One `.or()` filter uses interpolation** and deserves a note:

```ts
// lib/whatsapp/status.ts:68
.or(`status.is.null,status.in.(${overwritable.join(",")})`)
```
`overwritable` comes from the hardcoded `OVERWRITABLE` map, keyed by a value validated
against that same map two lines earlier. **Not exploitable** — the input never reaches the
string. Worth a comment so a future edit does not make it dynamic.

A second, similar pattern:
```ts
// app/api/webhook/whatsapp/route.ts:305
.or(`ctwa_clid.eq.${clid},fb_campaign_id.eq.${clid}`)
```
Here `clid` **is** attacker-influenced (it comes from Meta's `referral` object). PostgREST
filter-syntax injection is a real class of bug (a crafted value containing `,` or `)` can
alter the filter tree). This is currently unreachable because `ad_campaigns` does not exist,
but it must be fixed before that table ships.

### `sanitizeSearch` is written and unused

```ts
// lib/validate.ts:132 — escapes % _ \ for ilike
export function sanitizeSearch(input: string): string { … }
```
Not imported anywhere. Any route doing `ilike %search%` with raw user input allows wildcard
injection — a performance/DoS vector (`%%%%%` forces full scans), not a data-disclosure one.

### XSS

| Vector | Status |
|---|---|
| `dangerouslySetInnerHTML` | Not found in sampled code (all `components/` + layouts read) |
| React default escaping | ✅ Active |
| `stripHtml()` helper | Exists (`validate.ts:137`), **never called** |
| CSP `script-src` | `'self' 'unsafe-eval' 'unsafe-inline' https://connect.facebook.net` — 🟠 both unsafe directives enabled |
| User content rendered | Template bodies, campaign copy, contact names, inbound message text — all React-escaped |

**`'unsafe-inline'` + `'unsafe-eval'` substantially weaken the CSP.** The config documents
why (`next.config.mjs:19`: *"unsafe-* needed for Next.js dev + Recharts"*), but shipping
them to production means the CSP provides little XSS defence-in-depth. Next.js supports a
nonce-based CSP for production, and Recharts' `eval` requirement should be re-verified —
it is often cited but not always current.

### CSRF

| Control | Status |
|---|---|
| `SameSite=Lax` cookie | ✅ Blocks cross-site form POST |
| CSRF token | 🔴 None |
| Origin/Referer check | 🔴 None |
| `Access-Control-Allow-Origin` on `/api/*` | ✅ Pinned to `NEXT_PUBLIC_SITE_URL` |

`SameSite=Lax` covers the common case, but **it does send the cookie on top-level GET
navigations.** Any state-changing `GET` is therefore CSRF-able by a simple link or
`<img src>`:

| Endpoint | Effect if triggered |
|---|---|
| `GET /api/billing/create-subscription` | Creates a Razorpay subscription |
| `GET /api/admin/verticals/seed` | Seeds/overwrites vertical library data |
| `GET /api/commerce/connect` | Initiates a connection |
| `GET /api/ads/callback` | OAuth callback processing |
| `GET /api/auth/dev-login` | Mints a session (when enabled) |

---

## 3. Secrets and environment

| Secret | Handling | Verdict |
|---|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` | Server-only, no `NEXT_PUBLIC_` prefix | ✅ |
| `JWT_SECRET` | Server-only; length warned if < 32 | ✅ |
| `ENCRYPTION_KEY` | 64 hex required in prod (throws), **64 zeros in dev** | 🟡 |
| `META_APP_SECRET` | Server-only; also verifies webhooks | ✅ |
| `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET` | Server-only | ✅ |
| `ANTHROPIC_API_KEY` | Server-only | ✅ |
| `CRON_SECRET` | Guards `/api/cron/drain-queue` | ✅ |
| `NEXT_PUBLIC_META_APP_ID` | Public by design (browser SDK) | ✅ Correct |
| `whatsapp_numbers.access_token` | **AES-256-GCM at rest** | ✅ |
| `whatsapp_numbers.meta_app_secret` | **plaintext `text` column** | 🔴 |
| `api_keys.key_hash` | SHA-256; only a 17-char prefix displayable | ✅ |
| `webhook_endpoints.secret` | HMAC secret, **plaintext** | 🟠 |
| `otp_codes.code_hash` | Hashed | ✅ |
| `users.password_hash` | bcrypt | ✅ |

**Repository hygiene:** `.env.local` exists locally. `production-check.sh:58` greps
`git ls-files` for `.env*`, `.DS_Store`, `tsbuildinfo`, `.next/`, and `setting.json` and
fails the build if any are tracked. Good — but nothing runs that script automatically.

**Two loose ends:** `.playwright-mcp/` (98 files of screenshots and logs) is not
gitignored and could contain session cookies or tokens captured during browser automation.
A root-level `setting.json` exists and is explicitly on the check script's junk list.

**No secret scanning** (gitleaks/trufflehog) in any pipeline — because there is no pipeline.

---

## 4. Authentication & session security

Covered fully in [06-AUTH.md](06-AUTH.md). Security-specific summary:

| Control | Status |
|---|---|
| Password hashing | ✅ bcrypt |
| Password policy | 🟡 8–128 chars, no complexity, no breach check |
| Session cookie | ✅ httpOnly, Secure (prod), SameSite=Lax, Path=/ |
| Session lifetime | 🟠 **7 days**, no refresh, **no revocation** |
| JWT algorithm | ✅ HS256, symmetric, single issuer |
| JWT claims | ✅ No tier/role — cannot be spoofed into privilege |
| MFA | 🔴 None, including for `ADMIN_EMAILS` |
| Login rate limit | 🟠 10/min **per instance** ⇒ ineffective |
| Account lockout | 🔴 None |
| Password reset | 🔴 Non-functional, unrated-limited, unvalidated |
| Email enumeration | ✅ Prevented on `forgot-password` |
| Open redirect | ✅ `from` validated in `dev-login:53` |
| **Prod demo bypass** | 🔴 `DEMO_AUTO_LOGIN=true` ⇒ anonymous full session |

### The demo bypass, precisely

```ts
// middleware.ts:54-61
const autoLoginEnabled =
  process.env.DEMO_AUTO_LOGIN === "true" ||
  (process.env.NODE_ENV !== "production" && process.env.DEV_AUTO_LOGIN === "true");
if (autoLoginEnabled) return NextResponse.redirect(new URL("/api/auth/dev-login", …));
```
```ts
// dev-login/route.ts:20-23
const demoMode = process.env.DEMO_AUTO_LOGIN === "true";
if (process.env.NODE_ENV === "production" && !demoMode) return 403;
```

Deliberate and documented (*"explicit opt-in that ALSO works in production (public demo
deployment — anyone with the URL enters as the demo user)"*). The risk is not the mechanism
but the **target**: `admin@sendanjal.com` is a real row in the real `users` table, sharing the
production database with real tenants, and able to send messages, spend wallet balance,
create API keys, and — if its email is in `ADMIN_EMAILS` — change platform rates.

---

## 5. Authorization

| Layer | Coverage |
|---|---|
| Page-level auth | ✅ 16 prefixes in `middleware.ts` |
| Route-level auth | ✅ 89 routes by convention; **no enforcement** |
| Admin | ✅ 8 routes, env allowlist, not self-grantable |
| API-key scopes | ✅ 6 scopes with inheritance |
| **Roles** | 🔴 None |
| **Object-level (IDOR)** | 🟡 Depends entirely on `.eq("user_id", …)` per query |
| **Database-level** | 🔴 0 RLS policies |
| **Function-level** | 🟡 `/api/*` outside middleware; a new route defaults to public |

**IDOR risk assessment.** Detail routes (`/api/campaigns/[id]`, `/api/contacts/[id]`,
`/api/crm/deals/[id]`, …) were audited programmatically: 78 of 113 files contain an
explicit tenant predicate. The remainder mostly operate on `user.id` directly or on global
config. **This audit did not read all 113 handlers**, so a per-route IDOR verification is
recommended and is exactly what an automated test would settle permanently.

---

## 6. Encryption

`lib/crypto.ts` (52 lines) — correctly implemented:

```ts
ALGO = "AES-GCM"; IV_LENGTH = 12;                     // 96-bit IV, correct for GCM
crypto.getRandomValues(new Uint8Array(12))            // fresh IV per value ✅
crypto.subtle.encrypt({name:"AES-GCM", iv}, key, …)   // WebCrypto ✅
→ `${ivHex}:${cipherHex}`
isEncrypted(v) = /^[0-9a-f]{24}:[0-9a-f]+$/           // legacy-plaintext migration ✅
decrypt(v) returns v unchanged if it has no ":"       // graceful legacy passthrough
```

| Property | Assessment |
|---|---|
| Algorithm | ✅ AES-256-GCM (AEAD — confidentiality **and** integrity) |
| IV | ✅ Random per value, correct length, prepended |
| Key management | 🟡 Single static key from env. **No rotation, no versioning** — a key change orphans every stored token |
| Dev fallback | 🟡 64 zeros; throws in production only |
| Key storage | 🟡 Env var. Not a KMS/HSM — acceptable at this stage |
| Encrypted at rest | ✅ Supabase disk encryption |
| Encrypted in transit | ✅ HTTPS everywhere; HSTS preload |
| Legacy-plaintext handling | ✅ Transparent, with a `token_encrypted` boolean to track migration |

**Missing:** a key-version prefix (e.g. `v1:iv:cipher`) so rotation is possible later.
Adding it now is cheap; adding it after tokens are stored is a migration.

---

## 7. Transport security & headers

`next.config.mjs` applies to all routes:

| Header | Value | Verdict |
|---|---|---|
| `Strict-Transport-Security` | `max-age=63072000; includeSubDomains; preload` | ✅ 2 years, preload |
| `X-Frame-Options` | `SAMEORIGIN` | ✅ |
| `X-Content-Type-Options` | `nosniff` | ✅ |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | ✅ |
| `Permissions-Policy` | `camera=(), microphone=(), geolocation=()` | ✅ |
| `X-DNS-Prefetch-Control` | `on` | ✅ |
| `poweredByHeader` | `false` | ✅ |
| `Content-Security-Policy` | see below | 🟡 |

### CSP, annotated

```
default-src 'self'
script-src  'self' 'unsafe-eval' 'unsafe-inline' https://connect.facebook.net   🟠
style-src   'self' 'unsafe-inline'                                              🟡
img-src     'self' data: blob: https://api.dicebear.com https://*.facebook.com  ✅
font-src    'self'                                                              ✅
connect-src 'self' https://*.supabase.co wss://*.supabase.co
            https://api.anthropic.com https://graph.facebook.com
            https://*.facebook.com                                              ✅
frame-src   'self' https://*.facebook.com                                       ✅ (ESU iframe)
frame-ancestors 'none'                                                          ✅
base-uri    'self'                                                              ✅
form-action 'self'                                                              ✅
```

Every exception is commented with its reason (the Meta Embedded Signup SDK needs
`connect.facebook.net`, a hidden `facebook.com` iframe for `postMessage`, and Graph XHR).
That is unusually good CSP discipline.

Two observations:

1. **`connect-src` includes `https://api.anthropic.com`.** That is only needed if the
   browser calls Anthropic directly — it does not; all AI calls are server-side
   (`lib/ai/service.ts`). This directive should be removed; leaving it advertises that an
   API key might be reachable client-side.
2. **`unsafe-eval` + `unsafe-inline` in `script-src`** neutralise most of the CSP's XSS
   value in production.

### CORS

| Scope | Policy | Verdict |
|---|---|---|
| `/api/webhook/*` | `Allow-Origin: https://graph.facebook.com` | ✅ Pinned |
| `/api/*` | `Allow-Origin: NEXT_PUBLIC_SITE_URL`, `Allow-Credentials: true` | ✅ |

Note that `Allow-Credentials: true` with an env-driven single origin is correct. It would
be dangerous only if the origin were `*` — it is not.

---

## 8. Rate limiting & DoS

| Surface | Limit | Effective? |
|---|---|---|
| `POST /api/auth/login` | 10 / 60 s per IP | 🔴 per-process |
| `POST /api/auth/register` | 10 / 60 s per IP | 🔴 per-process |
| `POST /api/webhook/whatsapp` | 200 / 10 s per IP | 🔴 per-process |
| `/api/v1/*` | per-key `rate_limit_per_min` (default 60) | 🔴 per-process |
| `POST /api/auth/forgot-password` | **none** | 🔴 |
| Everything else (~100 routes) | **none** | 🔴 |
| Platform DDoS | Vercel edge | ✅ |

```ts
// lib/rate-limit.ts:1-4
/** In-memory sliding-window rate limiter.
 *  NOTE: Works for single-process. For multi-instance (Vercel serverless) use Upstash Redis. */
const store = new Map<string, RateLimitEntry>();
```

The module is honest about this. On Vercel, concurrent requests fan out across instances,
each with an empty `Map` — so the effective login limit is `10 × instances`. Under a
credential-stuffing attack, instances scale up, and the limit scales with the attack.

`lib/api-keys.ts:121` has an independent `Map` with the same problem, and a
**second function also named `checkRateLimit`** with a different signature.

Additional DoS surfaces:
- `contacts/import` accepts up to 10,000 CSV contacts (`campaignSchema` caps it, but that
  schema is unused) with no size limit on the request body.
- `templates/sync` auto-paginates all Meta templates inline.
- `campaigns/execute` runs a 50-item sequential send loop in-request.
- Two `setInterval` timers (`rate-limit.ts:14`, `token-cache.ts:25`) run per instance;
  `token-cache` calls `.unref?.()`, `rate-limit` does not.

---

## 9. Tenant isolation & RLS

See [05-DATABASE.md §6](05-DATABASE.md#6-row-level-security--the-critical-finding) and
[16-MULTI-TENANCY.md](16-MULTI-TENANCY.md).

```
pg_policies WHERE schemaname='public'  →  0 rows
Supabase advisor: 37 × rls_enabled_no_policy
```

**Net posture:** anon/authenticated roles are denied everything (good — nothing is
readable from a browser), and every API route uses the service role (which bypasses RLS
entirely). Isolation is 100% application-layer, with one known defect.

The written policies in migrations `002`/`009` cannot work: they depend on `auth.uid()`,
and the app authenticates with its own JWT rather than Supabase Auth.

---

## 10. Logging & monitoring

| Requirement | Status |
|---|---|
| Structured logs | ✅ JSON, one line, typed context |
| Log sink | 🔴 stdout only (`logger.ts:21` says so) |
| Security event log | 🟡 `audit_logs` exists, covers **only** ESU/token actions |
| **Financial action audit** | 🔴 Rate, margin, billing-mode, tier, AI-config changes **unlogged** |
| Webhook audit trail | 🔴 `webhook_logs` table missing |
| Failed-login logging | **Unable to determine** — `auth/login` not read in full |
| Alerting | 🔴 None |
| APM / tracing | 🔴 None |
| Correlation ids | 🔴 None — webhook → queue → worker → Meta cannot be traced |
| Log redaction | 🟡 Tokens not logged; `logger.error` may include `err.message` from Graph responses |
| Retention | Vercel default |

For a payments-adjacent platform, **unlogged privileged pricing changes is the most
serious finding in this section.** `lib/audit.ts` already exists, never throws, and takes a
`details` object — extending it is roughly 20 lines plus call sites.

---

## 11. Supabase advisor findings (live)

| Lint | Level | Count | Assessment |
|---|---|---:|---|
| `rls_enabled_no_policy` | INFO | **37** | 🔴 Every table. Safe-by-deny at the edge, zero interior defence |
| `function_search_path_mutable` | **WARN** | 1 | `public.increment_campaign_stat`. Migrations 023/028 pinned others and missed this one. One-line fix |
| `unindexed_foreign_keys` | INFO | 13 | See [13-PERFORMANCE.md](13-PERFORMANCE.md) |
| `unused_index` | INFO | ~38 | **Not meaningful** — the database has zero rows, so no index has been exercised |

---

## Advantages

- Every cryptographic primitive is the correct modern choice, correctly used: AES-256-GCM
  with per-value IVs, bcrypt, SHA-256 key hashing, `timingSafeEqual`.
- Webhook signatures are computed over raw bytes read before JSON parsing — the classic
  mistake is avoided in both webhook handlers.
- Full security-header set including HSTS preload, and a hand-written CSP where **every
  exception carries a comment explaining why it exists**.
- Secrets are properly partitioned server/client; only `NEXT_PUBLIC_META_APP_ID` is public,
  correctly.
- SQL injection is structurally impossible.
- Admin privilege cannot be granted from inside the product.
- The session JWT omits entitlement claims, so privilege cannot be forged even with a
  signing oracle.
- ESU keeps the plaintext Meta token out of the browser entirely.
- Email enumeration prevented where it matters.
- A real production-readiness gate script exists, including `npm audit` and a
  tracked-secrets grep.

## Disadvantages

- Zero RLS policies: no database-level authorization for 37 tables.
- 2.7% input-validation coverage, with the schemas already written.
- Anonymous full-session access in production via `DEMO_AUTO_LOGIN`.
- Rate limiting is architecturally non-functional on the deployment target.
- No audit trail on any pricing, margin, or billing-mode change.
- No log sink, no alerting, no APM, no correlation ids.
- `unsafe-inline` + `unsafe-eval` neutralise most of the CSP.
- CSRF window on state-changing `GET` endpoints.
- `meta_app_secret` and `webhook_endpoints.secret` stored in plaintext.
- No MFA, no session revocation, no account lockout.
- Encryption key has no version prefix, so rotation is a migration.
- Potential PostgREST filter injection at `webhook/whatsapp:305` (currently unreachable).
- No CI ⇒ none of the above is regression-tested.

## Recommendations

Prioritised as a remediation plan.

| P | Recommendation | Effort | Closes |
|---|---|---|---|
| **P0** | Point `DEMO_AUTO_LOGIN` at an isolated sandbox tenant with zero wallet balance, no API keys, and sending disabled — or gate it behind a shared secret. | 1 day | A01, A07 |
| **P0** | Fix the cross-tenant `contacts` write. | 30 min | A01 |
| **P0** | Move rate limiting to Postgres so login, register, and webhook limits are real. | 2 days | A07 |
| **P0** | Extend `lib/audit.ts` to every privileged mutation: `rates.update`, `margin.update`, `billing_mode.change`, `ai_config.update`, `tier.change`, `vertical.assign`. | 2 days | A09 |
| **P0** | Add CI (GitHub Actions) running `npm run check`, plus `gitleaks`. Nothing else in this list stays fixed without it. | 4 hours | A05, A08 |
| P1 | `withValidation(schema, handler)` wrapper; apply the 9 existing Zod schemas, then require Zod on every mutating route. | 1 week | A03, A04 |
| P1 | Convert state-changing `GET` → `POST`; add an Origin check to mutating routes. | 3 days | A01 |
| P1 | Ship RLS. Short term: a CI lint that fails on any `.from(<tenant table>)` without a tenant predicate, plus cross-tenant integration tests. Long term: session-variable RLS policies. | 1–4 weeks | A01 |
| P1 | Encrypt `meta_app_secret` and `webhook_endpoints.secret`. | 1 day | A02 |
| P1 | Wire `logger.error` to Sentry; add alerts for auth failures, wallet errors, and webhook signature failures. | 1 day | A09 |
| P1 | Pin `search_path` on `increment_campaign_stat`. | 5 min | A05 |
| P1 | Gitignore `.playwright-mcp/`; remove root `setting.json`; audit both for captured credentials. | 2 hours | A02 |
| P2 | Nonce-based CSP for production; remove `unsafe-inline`, re-verify whether Recharts still needs `unsafe-eval`, and drop `api.anthropic.com` from `connect-src`. | 1 week | A03, A05 |
| P2 | Session revocation (`jti` + denylist) or shorten to 24 h with refresh. | 1 week | A07 |
| P2 | SSRF protection on `webhook_endpoints.url` and `httpRequestNode`: block loopback, link-local, and RFC1918 ranges; resolve-then-validate to prevent DNS rebinding. | 3 days | A10 |
| P2 | Add a key-version prefix to `lib/crypto.ts` output now, while there is no data to migrate. | 1 day | A02 |
| P2 | Rate-limit and validate `forgot-password`; then implement it. | 3 days | A07 |
| P2 | Fix the PostgREST filter interpolation at `webhook/whatsapp:305` before `ad_campaigns` ships. | 1 hour | A03 |
| P3 | MFA (TOTP) for `ADMIN_EMAILS`. | 1 week | A07 |
| P3 | Password breach check (HIBP k-anonymity) and account lockout. | 3 days | A07 |
| P3 | Correlation ids threaded from edge → queue → worker. | 3 days | A09 |
| P3 | Commission an external penetration test once P0/P1 are closed. | — | all |
