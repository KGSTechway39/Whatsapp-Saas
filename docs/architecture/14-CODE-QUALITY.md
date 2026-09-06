# 14 — Code Quality & Technical Debt

## Executive summary

Code quality is **bimodal and unusually self-aware**.

The `lib/` domain modules are among the better TypeScript I have reviewed at this stage of
company: `strict` mode with a clean `tsc`, no `any` epidemic, typed error hierarchies,
discriminated unions, and — most distinctively — **nearly every module opens with a
rationale block that explains the design decision *and its known caveats*.**
`lib/rate-limit.ts` says it does not work on serverless. `lib/whatsapp/token-cache.ts` says
it is single-instance only. `lib/whatsapp/queue.ts` carries a `TODO(persistent-worker)`
naming exactly what it cannot do. This audit was fast because the code told the truth about itself.

The debt is concentrated in three places: **~5,000 LOC that cannot run against the deployed
database**, **17,247 LOC of monolithic client pages**, and **cross-cutting concerns that are
built but not applied** (Zod at 2.7%, `toApiError` only on dead paths, audit missing every
financial action).

The single largest quality risk is not any of that. It is that **there is no CI, no lint
config, and no unit tests** — so none of the above is prevented from getting worse.

**Risk level:** Medium-High · **Complexity:** Medium · **Confidence:** High (91%)

---

## 1. Objective quality metrics

| Metric | Value | Assessment |
|---|---|---|
| Total TS/TSX | 43,841 LOC / 249 files | |
| `tsc --noEmit` | **exit 0** | ✅ Clean under `strict` |
| ESLint config | **absent** | 🔴 `next lint` step degrades to a warning |
| Unit tests | **0** | 🔴 |
| E2E tests | 4 files, 212 LOC | 🟠 |
| SQL tests | 1 file (`prepaid_wallet_test.sql`) | 🟡 Valuable, not in CI |
| CI pipeline | **none** (`.github/` absent) | 🔴 |
| `console.log`/`debug` in `app`+`lib` | **1** | ✅ |
| `console.error` in `app`+`lib` | present on money paths | 🟠 |
| Circular dependencies | none detected | ✅ |
| Median route handler | ~80 LOC | ✅ |
| Median page component | 370 LOC | 🔴 |
| Files > 700 LOC | 8 | 🟠 |
| Files > 1,000 LOC | 4 | 🔴 |
| Dead code vs live DB | **≈5,000 LOC (11%)** | 🔴 |

---

## 2. Dead code

### Dead against the deployed database

| Module group | LOC | Blocked by |
|---|---:|---|
| `lib/whatsapp/{engine,dispatch,service,repository,dto}.ts` | ~1,200 | `whatsapp_accounts`, `organizations` |
| `app/api/crm/**` (6 routes) + `crm` pages (1,013) | ~1,490 | `crm_deals`, `crm_pipeline`, `crm_activities` |
| `app/api/ads/**` (6) + `lib/meta-ads.ts` + `ads` page (528) | ~1,370 | `ad_campaigns`, `ad_leads` |
| `app/api/{products,carts,commerce}/**` (8) + `lib/commerce.ts` + `catalog` page (727) | ~1,570 | `products`, `carts`, `cart_items` |
| `app/api/segments/**` (5) + `lib/segments.ts` + `segments` page (711) | ~1,270 | `segments` |
| `appointments` pages (3) | 1,337 | nothing — pure `useState` demo |
| CTWA block in `webhook/whatsapp:290-382` | ~92 | `ad_campaigns`, `contacts.ctwa_*` |
| `whatsapp/accounts` routes (2) | ~47 | `whatsapp_accounts` |
| **Total** | **≈8,400 LOC** including UI | |

Backend-only dead code is ≈5,000 LOC. **None of it is marked as dead.** Two prior audits
(this one and `docs/verticals/PHASE-0-AUDIT.md`) each spent effort discovering the same
thing independently.

### Written and never used

| Item | Location |
|---|---|
| **9 of 12 Zod schemas** | `lib/validate.ts` — `contactSchema`, `templateSchema`, `campaignSchema`, `walletRechargeSchema`, `profileSchema`, `paginationSchema`, `forgotPasswordSchema`, `contactSearchSchema`, `uuidSchema` |
| `sanitizeSearch()`, `stripHtml()` | `lib/validate.ts:132,137` |
| `toApiError()` + 10 error subclasses | `lib/whatsapp/errors.ts` — used only on dead org-model routes |
| `GeminiAdapter` | `lib/ai/service.ts:82-108` — fully implemented, no config row selects it |
| `getWindowState(contactId)` | `lib/whatsapp/window.ts:55` — the DB-backed variant has no caller |
| `ModelConfig.markupMultiplier` | `lib/ai/config.ts:103` — loaded, never used in any calculation |
| `plan_tiers.monthly_msg_cap` | Read into `TierConfig`, never enforced |
| `platform_settings.credit_validity_months` | Read, no expiry job |
| `wallet.low_balance_threshold_paise` | Read, no notifier |
| `team_members.role` | Stored, never checked |
| `conversations.assigned_to` | Column + FK + index; no assignment route |
| `ai_model_config` row `reminder_draft` | Configured, no call site |
| `ai_usage_log` | Written on every AI call, **read by nothing** — no margin dashboard |
| `daily_analytics` | Read by `/api/analytics`, **written by nothing** (`upsert_daily_analytics()` not deployed) |
| `@supabase/ssr` dependency | No import site found |
| `prisma/schema.prisma` (671 LOC, 20 models) | Documentation for a schema deployed nowhere |

### RPCs called but not deployed

| RPC | Call site |
|---|---|
| `increment_messages_sent` | `app/api/whatsapp/send/route.ts:83` |
| `increment_ad_campaign_leads` | ads path |
| `ensure_personal_org` | org onboarding |

All three are fire-and-forget, so they fail silently.

### Generated / junk in the tree

| Path | Note |
|---|---|
| `.playwright-mcp/` — **98 files** | Screenshots + logs, not gitignored. May contain captured session cookies |
| `setting.json` (root) | Misspelled, purpose unclear; `production-check.sh:58` treats it as leaked junk |
| `tsconfig.tsbuildinfo`, `.next/`, `.DS_Store` | Guarded by the check script, not by `.gitignore` review |

---

## 3. Duplicate code

| # | Duplication | Severity | Detail |
|---|---|---|---|
| 1 | **Two tenant models** | 🔴 Critical | 12 org-model files vs 34 legacy files. The root cause of most defects |
| 2 | **Two Graph API clients** | 🟠 High | `lib/meta.ts` (own `graphGet`/`graphPost`, plain `Error`) vs `lib/meta-client.ts` (`MetaApiError` with `code`). `CLAUDE.md` requires the typed variant; the live send path uses the untyped one |
| 3 | **Two 24h-window implementations** | 🟠 High | `contacts.last_inbound_at` (via `window.ts`) vs `conversations.is_within_24h_window`/`window_expires_at` (inline in `inbox/[id]/send`). **They can disagree** |
| 4 | **Two campaign send paths** | 🟠 High | `campaigns/[id]/launch` (265) and `campaigns/execute` (499). Both touch money |
| 5 | **Two `checkRateLimit` functions** | 🟠 Medium | `lib/rate-limit.ts:32` `(id, cfg)` and `lib/api-keys.ts:123` `(ctx)`. Same name, different signature, separate `Map`s |
| 6 | **Two segmentation APIs** | 🟡 Medium | `contacts/segments` (live) vs `segments/*` (dead). The sidebar links to the dead one |
| 7 | **Two API-docs pages** | 🟡 Low | `/docs/api` (274) and `/settings/api/docs` (539) — will drift |
| 8 | **Three node-type vocabularies** | 🟠 High | `flow-schema.ts` (9 camelCase), `automation-flows/[id]/execute` (**10** — adds `aiReplyNode`), `whatsapp/engine.ts` (9 snake_case). Documented in `PHASE-0-AUDIT.md:139-146` |
| 9 | Hand-rolled UI controls | 🔴 Critical | Buttons/inputs/tables/modals re-implemented across 41 pages — the direct cause of the 421-LOC average |
| 10 | `conversations`/`messages` DDL 3× | 🟡 Low | Migrations `001`, `002_inbox`, `009` — likely how `wa_message_id` vs `meta_message_id` diverged |
| 11 | Auth boilerplate ×89 | 🟡 Medium | `const user = await getSessionUser(); if (!user) return 401` repeated verbatim |
| 12 | Webhook alias | 🟢 **Not a problem** | Re-export, deliberate, documented |

### The `aiReplyNode` drift (worth its own note)

`aiReplyNode` is renderable (`components/automation/FlowNodes.tsx`) and executable
(`automation-flows/[id]/execute`) but **absent from `CANVAS_NODE_TYPES`** in
`lib/automation/flow-schema.ts:17-27`. Since `sanitizeFlowGraph` throws on an unknown
`type`, a hand-built flow using "AI Reply" **cannot be saved**. Pre-existing bug, correctly
logged in `PHASE-0-AUDIT.md:195-197`, still open.

Adding any node type requires synchronised edits in four places (`CANVAS_NODE_TYPES`,
`FlowNodes.tsx` `nodeTypes`/`DEFAULT_CONFIGS`/labels, the executor switch, and
`lib/ai/prompts/flow-builder.ts`). That coupling is itself the debt.

---

## 4. Code smells

| Smell | Instances | Severity |
|---|---|---|
| **God components** | `EmbeddedSignupModal` 1,313 · `inbox` 1,198 · `campaigns/create` 1,167 · `templates` 1,073 · `automation/create` 893 | 🔴 |
| **God handlers** | `campaigns/execute` 499 · `webhook/whatsapp` 471 · `whatsapp/onboard` 451 | 🟠 |
| Long functions | `POST` in `campaigns/execute`; `processIncomingMessage` (`engine.ts:149-256`); the message loop in `webhook/whatsapp:275-431` (156 lines, 6 nesting levels) | 🟠 |
| Deep nesting | `webhook/whatsapp:290-382` — CTWA block reaches 7 levels | 🟠 |
| Primitive obsession | Money passed as bare `number` everywhere; only the parameter *name* (`amountPaise`) distinguishes paise from rupees. A `Paise` branded type would make the unit a compile-time property | 🟡 |
| **Dual-representation money** | `wallet.balance numeric` + `balance_paise bigint`; `transactions.amount numeric` + `amount_paise bigint`. Two ways to store the same value | 🟠 |
| Boolean/flag parameters | `listVerticals({includeInactive})`, `persistRawEvent(…, signatureValid)` | 🟢 Fine |
| Silent catch | `catch {}` and `.catch(() => {})` appear in several places. Correct for audit/telemetry; questionable elsewhere | 🟡 |
| Magic numbers | `BATCH_SIZE = 50`, `MAX_NODES = 25`, `MAX_EDGES = 40`, `MAX_EXAMPLES = 6`, `MIN_CONFIDENCE = 0.55`, `OTP_VERIFIED_WINDOW_MIN = 15` | 🟢 All named constants ✅ |
| Stringly-typed status | `'reserved'`/`'settled'`/`'released'`, `'sent'`/`'delivered'`/… as bare strings | 🟡 Some have union types, some don't |
| Inconsistent naming | `wa_message_id` vs `meta_message_id` vs `metaMessageId` for the same concept across DB, code, and API | 🟠 **This inconsistency caused the broken inbound insert** |
| Copy-paste auth | 89× | 🟡 |
| `any` usage | 1 (`lib/queue/index.ts:20`, with an eslint-disable and a justification) | ✅ |

### The naming inconsistency is a real defect source

The same Meta message identifier is called:

| Name | Where |
|---|---|
| `wa_message_id` | `messages` column (live), `message_billing` PK, `api_messages` column |
| `meta_message_id` | `campaign_messages` column (live) |
| `metaMessageId` | `lib/whatsapp/status.ts` variable |
| `waMessageId` | `lib/billing/confirm.ts` parameter |
| `message.id` | Meta's payload |

The broken inbound insert (`webhook/whatsapp:425` writes `meta_message_id` into `messages`,
whose column is `wa_message_id`) is **exactly** this inconsistency producing a production
bug. Both spellings are correct — for different tables.

---

## 5. Architecture violations

Measured against the seven Laws in `CLAUDE.md`.

| Law | Status | Violations |
|---|:-:|---|
| **1. Multi-tenant isolation is sacred** | 🔴 | `webhook/whatsapp:386-389` updates `contacts` by `phone` with no tenant predicate. Plus 0 RLS policies as a backstop |
| **2. Meta rates NEVER hardcoded** | ✅ | Only reader is `getWholesalePaise`. No literal rate anywhere. **Fully held** |
| **3. Money mutations are atomic** | ✅ | All via row-locked SQL RPCs; integer paise. **Held** — the residual risk is the legacy `numeric` columns, not the logic |
| **4. No synchronous external I/O in handlers** | 🟠 | Held on the webhook path. Violated by `whatsapp/send`, `templates/sync`, `campaigns/execute`, `meta/*`, all `ai/*`. Defensible for interactive routes; not for `templates/sync`/`campaigns/execute` |
| **5. The 24h window governs every send** | 🔴 | Enforced on 2 of 7 send paths, via 2 different mechanisms |
| **6. Webhooks verified + idempotent** | ✅ | HMAC + `timingSafeEqual` + `processed_events` with per-consumer keys. **Held, and well done** |
| **7. Three billing models coexist; never assume** | ✅ | `getBillingMode` branches correctly; BYO passes through untouched. **Held** — but Model C cannot actually send |

Additional stated conventions:

| Convention | Status |
|---|---|
| Money in integer paise, never float | ✅ in logic; 🟠 dual `numeric` columns remain in schema |
| Graph version pinned in one place | ✅ `lib/meta-version.ts` |
| Meta errors map to a typed error preserving `code` | 🔴 Only `meta-client.ts` does; the live send path (`lib/meta.ts`) discards codes |
| Prefer `lib/logger` over `console.*` | 🟠 1 stray `console.log`; `console.error` on wallet settle/release in `campaigns/execute:143,228` |
| Flag margin-affecting decisions explicitly | ✅ Consistently done in comments — genuinely followed |
| No Prisma at runtime | ✅ Held (not a dependency, never imported) |
| No Redis/BullMQ | ✅ Held |

**5 of 7 Laws held or substantially held.** The two violated (1 and 5) are both in the
webhook/send path and both have small, well-understood fixes.

---

## 6. Testing

| Layer | Coverage |
|---|---|
| Unit | **0%** — no test runner installed |
| Integration | **0%** |
| E2E | 3 specs, 212 LOC: `auth.spec.ts` (55), `campaign-flow.spec.ts` (70), `inbox.spec.ts` (67), plus `global-setup.ts` (20) |
| SQL | `supabase/tests/prepaid_wallet_test.sql` — the **only** test of the money layer |
| CI | **none** |
| Coverage reporting | none |

**The money layer — the most correctness-critical code in the product — has no automated
test that runs.** There is one SQL test file, and nothing executes it.

### The cheap wins are unusually cheap

These functions are pure or near-pure and need **zero mocking**:

| Function | File | Why it matters |
|---|---|---|
| `windowStateFrom(lastInboundAt, now)` | `whatsapp/window.ts:36` | Law #5 logic |
| `canSend(kind, state)` | `whatsapp/window.ts:72` | Law #5 decision |
| `toBillableCategory(templateCategory)` | `billing/pricing.ts:19` | Category → price |
| `rupeesToPaise` / `paiseToRupees` | `billing/pricing.ts:90` | Money conversion |
| `tierAxes(tier)` | `billing/tiers.ts:29` | Tier invariant |
| `rawCostPaise(cfg, in, out)` | `ai/config.ts:112` | AI margin |
| `tierAllows(tier, task)` | `ai/config.ts:59` | Entitlement gate |
| `sanitizeFlowGraph(raw)` | `automation/flow-schema.ts:78` | AI output safety |
| `normalizeTemplateStatus` / `extractTemplateBody` | `meta.ts:235,218` | Template sync |
| `parseIntent(raw, candidates)` | `automation/intent.ts:34` | Hallucination guard |
| `isEncrypted(v)` | `crypto.ts:50` | Legacy migration |
| `OVERWRITABLE` rank logic | `whatsapp/status.ts:19` | Status monotonicity |

Roughly **a week of work covers the entire correctness-critical surface** of billing,
window, AI metering, and flow validation — with no test doubles required. That is the
highest-ROI quality investment available.

---

## 7. Technical Debt Register

Scored: **Impact** × **Likelihood** ÷ **Effort**.

| ID | Debt | Impact | Effort | Priority | Interest accruing |
|---|---|---|---|---|---|
| **TD-01** | 19 code-referenced tables missing from prod | Critical | 2–3 wks | **P0** | Every new feature built on a dead table compounds this |
| **TD-02** | Two tenant models in one codebase | Critical | 1–2 wks | **P0** | Every new file must choose; wrong choices keep being made |
| **TD-03** | Inbound `messages` insert broken (column drift) | Critical | 1 hr | **P0** | Inbox is unusable; no message history accumulating |
| **TD-04** | Cross-tenant `contacts` write | Critical | 30 min | **P0** | Corrupts window state across tenants |
| **TD-05** | Zero RLS policies | Critical | 1–4 wks | **P0** | Every new route is a potential leak |
| **TD-06** | No CI / no lint config / no unit tests | High | 1 wk | **P0** | **Compounding** — nothing prevents regression |
| **TD-07** | 24h window enforced on 2 of 7 paths | High | 1 wk | **P1** | Meta quality-rating damage per violation |
| **TD-08** | ≈5,000 LOC dead, unmarked | High | 2 days to mark | **P1** | Repeated audit cost; onboarding confusion |
| **TD-09** | 41 client pages, no RSC | High | 3–4 wks | **P1** | Redesign cost scales with page LOC |
| **TD-10** | Zod on 3 of 113 routes | High | 1 wk | **P1** | Every new route inherits the gap |
| **TD-11** | In-memory rate limiter + ESU token cache | High | 2 days | **P1** | Intermittent onboarding failure; ineffective limits |
| **TD-12** | Two Graph clients; Meta error codes lost | Medium | 1 wk | **P1** | Blocks retry classification |
| **TD-13** | No financial-action audit | High | 2 days | **P1** | Fails financial control review |
| **TD-14** | No token-rotation job | High | 3 days | **P1** | ~60-day silent tenant outages |
| **TD-15** | No shared UI primitives (0 Button/Input/Modal) | High | 2 wks | **P1** | Every page pays the cost again |
| **TD-16** | `whatsapp_numbers.phone_number_id` unindexed + 13 FK indexes | Medium | 30 min | **P1** | First scaling wall |
| **TD-17** | Three flow node vocabularies + `aiReplyNode` drift | Medium | 1 wk | P2 | Any node-type change is a 4-file edit |
| **TD-18** | No caching (8 DB ops per send) | Medium | 1 day | P2 | Latency scales with volume |
| **TD-19** | Dual-representation money columns | Medium | 1 day | P2 | A write to the wrong column is a silent money bug |
| **TD-20** | Four error-response conventions | Medium | 1 wk | P2 | API consumers must handle all four |
| **TD-21** | Naming inconsistency (`wa_` vs `meta_message_id`) | Medium | 3 days | P2 | Already caused TD-03 |
| **TD-22** | Two campaign send paths | Medium | 3 days | P2 | Two money paths to keep correct |
| **TD-23** | `prisma/schema.prisma` describes an undeployed schema | Low | 1 hr | P2 | Misleads every reader; already misled two audits |
| **TD-24** | Six 700+ LOC components | Medium | 3 wks | P2 | Unreviewable, unmemoisable |
| **TD-25** | No log sink / no APM / no correlation ids | Medium | 1 day | P2 | Incidents are un-diagnosable |
| **TD-26** | Accessibility unimplemented (0 `htmlFor`) | Medium | 2 wks | P2 | Procurement blocker for hospitals/schools |
| **TD-27** | `daily_analytics` read, never written | Low | 3 days | P2 | Analytics shows zeros |
| **TD-28** | Migration `002` numbering collision; DDL 3× | Low | 1 hr | P3 | Ordering ambiguity |
| **TD-29** | Two animation libraries; unused `@supabase/ssr`, `react-day-picker` | Low | 3 days | P3 | Bundle |
| **TD-30** | `.playwright-mcp/` (98 files) + root `setting.json` tracked | Low | 2 hrs | P3 | Possible credential leak |
| **TD-31** | No pagination on most list routes; schema unused | Medium | 1 wk | P3 | Grows with data |
| **TD-32** | `markupMultiplier` / `monthly_msg_cap` / `credit_validity_months` read but unenforced | Medium | 1 wk | P3 | Revenue not collected |

**Estimated total: 4–6 engineer-months** to clear P0 + P1.

---

## 8. Refactoring opportunities, ranked by leverage

| # | Refactor | Effort | Unlocks |
|---|---|---|---|
| 1 | **Generate Supabase types** (`supabase gen types typescript` → `createClient<Database>()`) | 1–2 days | Turns TD-01, TD-03, TD-19, TD-21 into **compile-time errors**. Highest leverage in the repo |
| 2 | **`<SidebarShell>` island** so `(dashboard)/layout.tsx` is a Server Component | ~20 lines | Unblocks RSC for 41 pages (TD-09) |
| 3 | **Route middleware stack** (`withAuth` · `withValidation` · `withRateLimit` · `withErrorMapping`) | 2 wks | Fixes TD-10, TD-11, TD-20 and the 89× auth boilerplate together |
| 4 | **One `sendMessage()` choke point** enforcing window + billing + logging | 1 wk | Fixes TD-07, TD-22; makes Law #5 unbypassable |
| 5 | **Delete the org-model branch** (12 files) | 1 wk | Fixes TD-02, most of TD-08 |
| 6 | **UI primitive library** (consider `shadcn/ui` — it maps onto the existing Tailwind + CSS-variable tokens directly) | 2 wks | Fixes TD-15, TD-24, TD-26 and halves the redesign surface |
| 7 | **Repository per resource family** | 3 wks | Localises schema knowledge; makes drift a one-file compile error |
| 8 | **Unit tests for the 12 pure functions** | 1 wk | Fixes TD-06 for the code that matters most |
| 9 | **CI: `npm run check` + gitleaks on every PR** | 4 hrs | Stops all of the above regressing |
| 10 | **Config cache layer** | 1 day | Fixes TD-18 |

---

## Advantages

- `strict` TypeScript with a **clean `tsc`** across 43,841 lines, and essentially no `any`
  (one instance, disabled with a justification).
- **Self-documenting rationale headers** on nearly every `lib/` module, which state the
  design intent *and the known limitations*. `rate-limit.ts`, `token-cache.ts`, `tiers.ts`,
  `dedup.ts`, and `queue.ts` all disclose their own constraints. This is rare and valuable.
- Failure philosophies are explicit per module (fail-soft, fail-open, never-throw) rather
  than accidental.
- Named constants instead of magic numbers, throughout.
- No circular dependencies.
- Typed error hierarchy, discriminated unions, and typed row mappers where used.
- Margin-affecting decisions are consistently flagged in comments — the `CLAUDE.md`
  convention is genuinely followed.
- A real production-readiness gate script (`npm run check`) covering env, secrets, types,
  lint, build, audit, and stray logs.
- The newest code (`lib/verticals/*`, `components/verticals/*`) is the **best** code — the
  quality trend is upward.

## Disadvantages

- ~11% of the codebase cannot run against the deployed database, and none of it is marked.
- Two tenant models, two Graph clients, two window implementations, two send paths, two
  rate limiters, three node vocabularies.
- Cross-cutting concerns built and unapplied: Zod 2.7%, `toApiError` on dead paths only,
  audit missing all financial actions.
- 17,247 LOC of monolithic client pages with no shared primitives.
- Zero unit tests over the money layer; no CI; no lint config.
- Naming inconsistency has already produced a production bug.
- `console.error` on the two most critical error paths.
- Money is a bare `number`, and the schema still holds two representations of it.

## Recommendations

| P | Recommendation |
|---|---|
| **P0** | Ship CI first. Every other fix on this list decays without it. `npm run check` already exists — wire it to GitHub Actions and add `gitleaks`. |
| **P0** | Generate Supabase types. One command converts the entire drift register from runtime surprises into build failures. |
| **P0** | Publish a **live-surface manifest** and add `// DEAD IN PROD: requires <table>` headers to all ~5,000 dead lines. Two audits have now paid this cost. |
| **P0** | Fix TD-03 and TD-04 (2 hours combined, both Critical). |
| P1 | Build the route middleware stack — it collapses four systemic gaps into one mechanical migration. |
| P1 | Unit-test the 12 pure functions. A week, no mocking, covers billing/window/AI-metering/flow-validation correctness. |
| P1 | Choose one tenant model and delete the other. Do not carry both into the vertical-SaaS work. |
| P1 | `npx next lint` once, so the lint gate actually gates. |
| P2 | Introduce a `Paise` branded type: `type Paise = number & {__brand:'paise'}`. Compile-time protection against the rupee/paise class of bug. |
| P2 | Normalise the identifier naming (`wa_message_id` everywhere) with a migration + rename. |
| P2 | Move `prisma/schema.prisma` to `docs/reference/`, or `prisma db pull` it against the live DB. |
| P3 | Add a `paymentLinkNode` and fix the `aiReplyNode` sanitizer drift **as one change**, since both touch the same four coupled files. |
