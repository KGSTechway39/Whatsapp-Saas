# WASend AI-Assist Layer — Architecture & Impact Analysis

**Author:** Principal Full-Stack Engineer (architecture pass)
**Status:** Design — pre-implementation. No code merged yet.
**Scope:** Optional AI accelerator over Campaign Creation, Automation Creation, Appointment Booking, plus backend runtime intent classification.

---

## 0. TL;DR for reviewers

We are adding an **optional** AI draft/pre-fill layer on top of three existing manual flows. Manual stays the source of truth; AI never auto-executes a customer-facing action. This is **additive and low-blast-radius** — it introduces new tables, a new service, and new *secondary* UI entry points. It does **not** modify the send pipeline, the message wallet, the webhook fast-ack path, or the 24h window guard beyond *reading* them.

Two prompt assumptions do not match the deployed stack and are corrected below (Prisma → Supabase SQL migrations; `tenant_id` → `user_id`). One existing AI endpoint (`/api/templates/generate`) is unmetered and hardcoded — this work **absorbs** it rather than leaving a second, ungoverned AI path.

---

## 1. Audit — what actually exists today

Verified against the working tree (not CLAUDE.md, which is stale).

| Area | Reality on disk | Consequence for AI layer |
|---|---|---|
| **ORM** | `prisma/schema.prisma` exists but **Prisma is not a dependency** and is not used. Persistence = Supabase Postgres via numbered SQL migrations (`supabase/migrations/001…023`) + row-locked SQL RPCs. | **Deliver SQL migration `024_ai_layer.sql`, not Prisma.** (§3) |
| **Tenant key** | Message wallet (`lib/billing/wallet.ts`) is **keyed by `user_id`** — comment: *"the deployed legacy tenant model."* Newer Model-B automation tables carry `organization_id`, but the deployed billing/tenant unit is `user_id`. | **AI wallet keys by `user_id`** to mirror the message wallet exactly. `ai_usage_log` also stores `organization_id` (nullable) for flow-scoped calls. (§3) |
| **Message wallet** | `wallet_credit / wallet_reserve / wallet_settle / wallet_release / wallet_charge` SQL RPCs — integer **paise**, `SELECT … FOR UPDATE`, ledger + idempotency keys, `InsufficientBalanceError`. | **Mirror the pattern** for AI credits as its own table + RPCs, metered in **integer credits**, not paise. Separate ledger — never merged. (§3, §4) |
| **Rate/markup config** | `meta_rates` (versioned by `effective_from`) + `plan_tiers.markup_bps`, editable at runtime via `/api/admin/rates` (`requireAdmin`, `ADMIN_EMAILS` allowlist). No redeploy needed. | **`ai_model_config` mirrors `meta_rates`** — config-driven routing, admin-editable. Margin view mirrors `/api/admin/margin`. (§3, §7) |
| **Tiers** | `users.tier ∈ {starter, growth, enterprise}` already exists (migration 016), plus `billing_mode`, `waba_mode`. | **Tier gating uses the existing column** — no new plan model. (§6) |
| **Automation engine** | `lib/whatsapp/engine.ts` — `FlowGraph = { nodes: FlowNode[], edges: FlowEdge[] }`, 9 node types, canvas is `@xyflow/react`. `automation_flows.flow_data` stored **with no server-side schema validation today**. | AI flow-builder must emit this exact shape and validate with **zod** (already a dep) before render. **The validator also hardens the manual path.** (§5.2) |
| **24h window guard** | `lib/whatsapp/window.ts` — `getWindowState()`, `canSend()`. Enforced on inbound-triggered sends (commit `96969a7`). | Runtime intent classification **reuses `canSend()`**; never calls the model outside the window. (§5.4) |
| **Queue / worker** | `pg-boss` + `/api/cron/drain-queue`; webhook uses fast-ack + async worker. | Runtime intent runs **inline in the worker** with a hard ≤2s timeout, not as a new queue. (§5.4) |
| **Existing AI (!)** | `app/api/templates/generate/route.ts` calls `@anthropic-ai/sdk` directly, **model hardcoded** `claude-sonnet-4-6`, **no wallet, no metering, no usage log, no tier gate.** | This is the exact anti-pattern rule 4 forbids. **Absorb it into `AIProviderService`** as `task_type = template_content` in phase 2 — one governed AI path, not two. (§8) |

---

## 2. Non-negotiables → how each is honored

| Rule | Mechanism |
|---|---|
| 1. Manual + AI both permanent; manual is default | AI entry points are collapsible/secondary components that only `onGenerate(draft)` into the **existing** form/canvas/booking state. Zero change to submit handlers. |
| 2. AI never auto-executes | Endpoints return a **draft object only**. No endpoint calls the send/publish/launch path. Confirm/Publish/Send remain the untouched manual actions. |
| 3. Separate AI Credits wallet | New `ai_credit_wallet` / `ai_credit_ledger` + `ai_wallet_*` RPCs. **No FK, no shared row, no shared RPC** with the paise wallet. |
| 4. Config-driven routing | `ai_model_config` table read at request time by `AIProviderService`. No model id in code. |
| 5. Task→model defaults + flow validation/retry | Defaults seeded in `ai_model_config`; overridable by row update. Flow JSON validated server-side, silent retry ×2 with schema error appended, then graceful manual fallback. |
| 6. Meter by action, markup on raw cost | `ai_usage_log` records tokens + raw paise cost (margin truth). Wallet deducts **whole credits** per action. `credits_per_action` & `markup_bps` per `task_type` in config. |
| 7. Server-side regen caps | Enforced in the API layer via a per-draft counter (`ai_regen_count`), not the UI. |
| 8. Graceful degradation | Any failure / timeout / zero-credit → structured `fallback` response; UI shows non-blocking notice and the manual form stays fully usable. |

---

## 3. Data model — `supabase/migrations/024_ai_layer.sql`

Mirrors existing migration conventions (integer paise for cost, RLS, idempotency, `updated_at`). Keyed by `user_id`.

```
ai_model_config
  id, task_type (enum), provider, model_id,
  input_price_per_million_paise, output_price_per_million_paise,
  markup_bps,               -- default 500–800 (5–8x) per task_type
  credits_per_action,       -- customer-facing meter (e.g. flow_builder = 3, campaign = 1)
  timeout_ms,               -- per task_type (runtime_intent = 2000)
  max_regens,               -- campaign 5, flow 3
  is_active, effective_from, updated_at
  -- routing = latest active row per task_type (mirrors meta_rates versioning)

ai_credit_wallet
  user_id PK, balance_credits INT NOT NULL DEFAULT 0 CHECK (>=0),
  trial_granted BOOL, monthly_quota INT, quota_reset_at, updated_at

ai_credit_ledger
  id, user_id, delta_credits, type (grant|topup|debit|refund|quota_reset|trial),
  task_type, ref_id, idempotency_key UNIQUE, description, created_at

ai_usage_log
  id, user_id, organization_id NULL, task_type, provider, model_id,
  tokens_in, tokens_out, raw_cost_paise, credits_deducted,
  status (ok|fallback|timeout|invalid|error), latency_ms, created_at
  -- raw_cost_paise vs credits→revenue = per-task margin (mirrors /admin/margin)

task_type enum:
  campaign_content | automation_flow_builder | automation_runtime_intent
  | appointment_nl_parse | reminder_draft | template_content(absorbed, phase 2)
```

**RPCs (mirror `wallet_*`, row-locked + idempotent):**
`ai_wallet_grant` (trial/quota), `ai_wallet_topup`, `ai_wallet_debit` (throws `INSUFFICIENT_AI_CREDITS`), `ai_wallet_refund`. AI actions are atomic single calls → no reserve/settle split needed; **debit-on-success**.

---

## 4. `AIProviderService` — provider-agnostic core (`lib/ai/service.ts`)

```
runTask({ userId, orgId?, taskType, input, signal }) → {
  status: 'ok' | 'fallback',
  data?, usage?: { tokensIn, tokensOut, rawCostPaise, creditsDeducted },
  fallbackReason?
}
```

Pipeline (every task, no exceptions):
1. **Load config** — latest active `ai_model_config` row for `taskType`. Missing/inactive → `fallback('not_configured')`.
2. **Tier gate** — `assertTierAllows(user.tier, taskType)` (server-side, §6). Deny → `fallback('tier_locked')`.
3. **Credit check** — read balance ≥ `credits_per_action`. Insufficient → `fallback('no_credits')`.
4. **Provider call** — routed adapter (`AnthropicAdapter`, `GeminiAdapter`, or Vercel AI Gateway `provider/model` string) with `AbortSignal` at `config.timeout_ms`.
5. **Debit on success only** — `ai_wallet_debit(credits_per_action, idempotencyKey)`.
6. **Log always** — `ai_usage_log` on every outcome (raw cost from token counts × config price × markup).

Provider adapters implement one interface (`generate(prompt, opts) → { text, tokensIn, tokensOut }`). **New provider = new adapter class + config row. No route changes.** Recommended: route through **Vercel AI Gateway** using `"provider/model"` strings so provider swaps are pure config.

---

## 5. Feature designs

### 5.1 Campaign — `POST /api/ai/campaign-draft`  (task: `campaign_content`)
Input: goal, audience, tone, language (en/hi/ta/te min). Output: `{ body, variables[], suggestedSendTime }` → pre-fills existing campaign form fields. Stateless single call. Regen cap 5 (server counter keyed by draft session). Component: collapsible `<AICampaignAssist>` **above** the manual form.

### 5.2 Automation — `POST /api/ai/automation-flow`  (task: `automation_flow_builder`)
Input: free-text logic. Output: candidate `FlowGraph`. **Server-side zod schema (`lib/ai/flow-schema.ts`) mirrors `engine.ts` `FlowNode`/`FlowEdge`/node-type enum.** Validate → on failure retry silently ×2 with the zod error appended to context → on repeated failure return `fallback('build_manually')`. Only a validated graph reaches the `@xyflow/react` canvas, fully editable. Publish unchanged. Regen cap 3. **Bonus:** wire the same zod validator into the manual `POST /api/automation-flows` (which validates nothing today).

### 5.3 Appointment — `POST /api/ai/appointment-parse`  (task: `appointment_nl_parse`)
Input: "book Ramesh for a haircut tomorrow at 5pm". Output: `{ customer, service, date, time, confidence, missing[] }` → **confirmation card** requiring explicit "Confirm Booking." Ambiguity (missing service / unclear time) → fall back to manual form **pre-filled** with what parsed; never guess, never block.

### 5.4 Runtime intent — backend only (task: `automation_runtime_intent`)
Runs **inside the async webhook worker**, *after* rule/keyword matching misses, *only if* `canSend()` says the 24h window is open. Hard `timeout_ms` (2000). Timeout or `confidence < threshold` → fall back to existing rule-based/default flow matching. Highest-volume call → cheapest model, tightest markup. Never blocks fast-ack.

---

## 6. Tier gating (server-side, in `AIProviderService`)

| Tier | campaign | appointment | flow_builder | runtime_intent | Quota |
|---|---|---|---|---|---|
| **starter** | trial pool only | trial pool only | ❌ | ❌ | one-time 10-action trial grant |
| **growth** | ✅ | ✅ | ❌ | ✅ | configurable monthly quota + top-up |
| **enterprise** | ✅ | ✅ | ✅ | ✅ | higher/custom + per-task model choice |

Enforced by config-backed `TIER_TASKS` map checked in step 2 — UI hiding is cosmetic only.

---

## 7. Admin (mirrors `/api/admin/rates` + `/api/admin/margin`)
- `GET/POST /api/admin/ai-config` — CRUD `ai_model_config` (provider, model, prices, markup, credits/action, timeout, caps). `requireAdmin`.
- `GET /api/admin/ai-margin?userId=` — per-tenant credits consumed vs Σ`raw_cost_paise` by `task_type` (margin visibility).

---

## 8. Impact analysis — blast radius

**Additive / no behavior change:** send pipeline, message wallet & ledger, webhook fast-ack, template/campaign/automation submit handlers, middleware, existing schema. AI code only *reads* window/tier/config.

**Touched (deliberately):**
1. **`/api/templates/generate`** — refactor onto `AIProviderService` as `template_content` (phase 2) to eliminate the second ungoverned AI path. *Risk: low; same output contract.*
2. **`/api/automation-flows` POST** — add zod `flow_data` validation (currently none). *Risk: could reject previously-accepted malformed graphs — ship warn-only first, enforce after a bake.*
3. **Webhook worker** — one new branch after rule-miss, behind window + timeout guards. *Risk: contained by hard timeout + fallback; cannot delay ack.*
4. **New env:** `ANTHROPIC_API_KEY` (present), optional `AI_GATEWAY_API_KEY`, `GEMINI_API_KEY`.

**Net:** three new secondary UI components, one service, ~6 endpoints, one migration, two admin routes. No existing customer-facing action is replaced, degraded, or bypassed.

---

## 9. Phased delivery

- **P1 — Foundation:** migration `024`, `ai_wallet_*` RPCs, `AIProviderService` + one adapter, config seed, admin config route. *(No user-facing change; testable via admin.)*
- **P2 — Campaign + absorb template-gen:** `/api/ai/campaign-draft`, `<AICampaignAssist>`, refactor `/templates/generate`. AI Credits indicator (styled like message-credit indicator).
- **P3 — Appointment:** parse endpoint + confirmation card + manual pre-fill fallback.
- **P4 — Flow builder:** zod schema, generate endpoint + retry, canvas render, harden manual validation.
- **P5 — Runtime intent:** worker branch, window + timeout + confidence fallback, load-test the 2s budget.
- **P6 — Margin admin + tier trial grants + quota reset cron.**

Each phase is independently shippable and dark-launchable (config `is_active=false`).
```
