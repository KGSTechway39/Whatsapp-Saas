# Phase 0 — Impact Audit: Verticalized SendAnjal

**Date:** 2026-07-27 · **Branch:** `feat/whatsapp-core-media-templates` · **Status:** gate for Phase 1

This audit is the mandatory gate before any vertical schema or UI work. It inventories
what exists today, states what breaks, and fixes the constraints Phase 1–5 must build
inside. Three findings below change the plan materially — they are marked **⚠ PLAN
CHANGE**.

---

## 0. Two premise corrections before anything else

The master prompt describes a stack and a tenant model that are not this repo. Both
change the deliverable shape, so they are settled here rather than discovered mid-build.

### 0.1 ⚠ PLAN CHANGE — stack: Fastify/Prisma/Redis+BullMQ → Next.js/Supabase/pg-boss

| Prompt says | Repo actually is | Evidence |
|---|---|---|
| Fastify | Next.js 14 App Router route handlers | `app/api/**/route.ts` |
| Prisma (runtime) | `@supabase/supabase-js`, service-role | `lib/supabase/server.ts` |
| Redis + BullMQ | pg-boss behind a swappable driver | `lib/queue/index.ts` |
| React SPA | Next.js RSC + client components | `app/(dashboard)/**` |

`prisma/schema.prisma` **does** exist (580 lines) but its own header declares it
*"REFERENCE / DOCUMENTATION … The application talks to it via the @supabase/supabase-js
client, not via Prisma at the moment."* It also models the **organization** shape, which
is not deployed (§0.2).

**Resolution.** The requested "Prisma schema diff" is delivered as a real artifact — it is
the documentation source of truth and the prompt asks for it — but it is **not** the
runtime change. The runtime change is a numbered SQL migration `026_verticals.sql`,
consistent with `001…025`. Anything that ships as Prisma-only would be a no-op against
the live database. Both artifacts land, and they must agree.

Redis/BullMQ is **not** introduced. `sendanjal-core` law: *"pg-boss for the job queue. NO
Redis/BullMQ unless asked."* Nothing in verticalization needs a queue anyway — seeding is
a synchronous admin action.

### 0.2 ⚠ PLAN CHANGE — tenant: there is no `Client` model; the live tenant is `users.id`

The prompt says "add nullable `verticalId` to the tenant/`Client` model." No `Client`
model exists. Two tenant models exist in code, and **the one in the migrations is not the
one in production**:

- **Legacy `user_id` model — LIVE.** Each user *is* the tenant. Numbers in
  `whatsapp_numbers`. This is what production runs.
- **Organization model — CODED, NEVER DEPLOYED.** `organizations` / `whatsapp_accounts` /
  `organization_id`. Present in `001`, `009`, and `prisma/schema.prisma`.

**Resolution.** `vertical_id` goes on **`users`**, as a nullable FK, following the exact
pattern already used by `016_tiers.sql` (`tier`, `waba_mode`) and `018_business_profile.sql`
(`business_name`, `business_category`, `city`). That is the additive-column convention
this schema already established for per-tenant config.

Note `users.business_category` already exists — it stores **Meta's** WhatsApp vertical
code (e.g. `RETAIL`), sent to Meta during Embedded Signup. It is a Meta API field, not a
product concept, and must **not** be overloaded to carry SendAnjal verticals. Separate
column, separate meaning. (Phase 2 may *suggest* a vertical from it as a convenience.)

**Tier decoupling holds.** `tier` lives on `users` and drives `billing_mode`/`waba_mode`;
`vertical_id` is a sibling column with no read or write relationship to any of them. No
code path will branch on both.

---

## 1. Appointment booking + tracking

### What exists

| Layer | Reality |
|---|---|
| Table `appointments` | Defined in `001_model_b_schema.sql:326` and `009_model_b_unified.sql:291` — **keyed `organization_id`** |
| Deployed? | **No.** It is org-model-only, and the org model was never deployed (§0.2) |
| UI `/appointments` | 100% client-side. `DEMO_APPOINTMENTS` array → `useState`, hardcoded `new Date(2026, 3, 1)` |
| API routes | **None.** No `app/api/appointments/*` exists |
| Only backend touchpoint | `POST /api/ai/appointment-parse` — NL → structured JSON. Parses; **persists nothing** |

### ⚠ PLAN CHANGE — finding: there is no live appointment system to break

The prompt's central risk — *"do not silently modify or risk-break the existing live
appointment booking/tracking system"* and *"existing hospital clients already live on the
platform"* — **does not apply to appointments.** There is no persistence layer, no API, no
deployed table, and therefore no live hospital appointment data. The constraint is
correctly stated as a principle; it just has no subject here.

This is good news and it makes the highest-leverage refactor nearly free: **there is no
hospital-shaped booking code to generalize away from.** We are not de-forking an existing
implementation, we are choosing the right shape on a blank slate.

### What booking actually is today

The only *live* booking-capable primitive is the **automation flow engine** (§2):
`automation_flows` + `chatbot_sessions`, both `user_id`-scoped and both deployed (`003`).
A booking today is expressed as a flow, not as an appointment record.

### Recommendation

Do **not** build a parallel booking primitive, and do **not** revive the org-keyed
`appointments` table. Booking/inquiry is a **configured instance of the flow engine**:

```
bookingContext = {
  captureFields:   [...]   // what to ask
  confirmationCopy: "..."  // what to say back
  reminderCadence: [...]   // when to nudge
}
```

stored on the `VerticalTemplateLibrary` row's `payload`, alongside the flow JSON.
`capture intent → qualify → confirm → remind` is then genuinely one engine:

| Vertical | Same shape, different config |
|---|---|
| Hospital | appointment → dept/doctor/slot → confirm → 24h/2h/30min |
| Real Estate | site visit → budget/purpose/timeline → confirm → pre-visit |
| School | counselor slot → grade/program → confirm → day-before |
| Salon/Gym ("Other") | booking → service/stylist → confirm → day-before |

A persisted `appointments` table (re-keyed to `user_id`) is a legitimate follow-up, but it
is **out of Phase 1 scope**: nothing in Phases 1–5 requires it, and adding it would mean
shipping a live booking backend under cover of a verticalization prompt. Flagged, not
built. The `/appointments` demo UI is left untouched.

---

## 2. Automation engine

### Confirmed

Flows are JSON in Postgres: `automation_flows.flow_data JSONB`, `user_id`-scoped,
default `{"nodes":[],"edges":[]}` (`003_automation_flows.sql`). Cursor state in
`chatbot_sessions` (`current_node_id`, `status`, `context`, `resume_at`). ✅ Matches the
pattern the prompt assumes.

### ⚠ PLAN CHANGE — finding: three node vocabularies, and the live runtime is a one-reply subset

Three separate things read/write `flow_data`, and they do not agree:

| # | Component | Vocabulary | Live? |
|---|---|---|---|
| 1 | Canvas builder + `sanitizeFlowGraph` (`lib/automation/flow-schema.ts`) | camelCase `triggerNode`, `sendMessageNode`, `waitNode`, `conditionNode`, `addTagNode`, `updateContactNode`, `assignAgentNode`, `httpRequestNode`, `endNode` (**9**) | ✅ authoring |
| 2 | `app/api/automation-flows/[id]/execute/route.ts` | Same camelCase **+ `aiReplyNode`** (**10**) | manual invoke only |
| 3 | `lib/whatsapp/engine.ts` | snake_case `send_text`, `send_template`, `send_interactive`, `wait`, `condition`, `set_variable`, `handover`, `trigger`, `end` | ❌ **org-model — not deployed** |

And the actual production inbound path is none of the three in full:

```
lib/whatsapp/queue.ts:140  resolveFlowForInbound()   → picks the flow (AI intent, keyword fallback)
lib/whatsapp/queue.ts:142  renderFirstReply()        → BFS trigger → FIRST sendMessageNode → send ONE text
```

`renderFirstReply` carries its own `TODO(persistent-worker)`: *"full multi-step traversal
(waits, conditions, sessions, templates, interactive) belongs on a persistent worker
host."* So **today, in production, an inbound message triggers exactly one text reply.**

**Consequences for Phase 5 — both non-negotiable:**

1. **Seed flows must use only vocabulary #1 (the 9 types).** `sanitizeFlowGraph` *throws*
   on an unknown `type`, so a seed row using `aiReplyNode` or `send_text` would be
   unopenable in the builder and unusable by the AI path. Every seeded `FLOW_JSON`
   payload will be run through `sanitizeFlowGraph` at seed time as a build gate.
2. **Client-facing `outcome` copy must not promise multi-step behavior that won't fire
   yet.** A "3-stage reminder (24h/2h/30min)" flow will store, render, and edit correctly
   — and will send only its first message until the persistent worker lands. Seeding it is
   right (it is a correct artifact, and it becomes fully live with zero migration). Telling
   a hospital receptionist it "reminds patients twice" today would be false. Phase 3 shows
   multi-step flows with an explicit, plain-language status rather than an unqualified
   outcome claim.

### Do the Phase 5 flows need new node types?

Assessed against the 9 sanctioned types. **No schema migration and no new node types are
required.**

| Phase 5 need | Expressible today? |
|---|---|
| 3-touch cart recovery, reminder sequences | ✅ `sendMessageNode` + `waitNode` chains |
| Lead qualification (budget/purpose/timeline) | ✅ `conditionNode` on `last_message` + `addTagNode` |
| COD confirmation | ✅ `sendMessageNode` → `conditionNode` (`contains` "yes") → branch. The `sourceHandle: "true"/"false"` convention is already supported by both sanitizer and executor |
| "Where's my order" self-serve | ✅ runtime intent routing (`extractFlowIntents` → `classifyIntent`) + `httpRequestNode` |
| Attendance alert, report-ready doorbell | ✅ `sendMessageNode` |
| Broker broadcast (separate flow type) | ✅ separate flow row, distinct `trigger_type` |
| **Fee reminder with payment link** | ⚠️ **degraded.** No `paymentLinkNode`. A Razorpay URL goes in `sendMessageNode` text — it sends fine, but there is no link-click tracking or paid/unpaid state |

**Recommendation:** ship Phase 5 on the existing 9 types. A dedicated `paymentLinkNode` is
a real improvement for the School vertical but is a **follow-up**, because adding a node
type requires synchronized edits in four places (`flow-schema.ts` `CANVAS_NODE_TYPES`,
`components/automation/FlowNodes.tsx` `nodeTypes`/`DEFAULT_CONFIGS`/labels, the executor
switch, and `lib/ai/prompts/flow-builder.ts`) and changes the AI generation contract. That
is its own change with its own blast radius; bundling it into verticalization would put an
untested node type into every seeded school tenant at once.

**Pre-existing drift worth logging (not caused by us, not fixed here):** `aiReplyNode` is
renderable and executable but absent from `CANVAS_NODE_TYPES`, so a hand-built flow using
"AI Reply" fails `sanitizeFlowGraph`. Separate bug; noted so Phase 5 avoids the node.

---

## 3. AI feature layer

### Confirmed: three client-facing features, and the routing table is real

`ai_model_config` (`024_ai_layer.sql`) versions provider/model/price/credits/timeout per
`task_type`, newest active row wins, editable at `/api/admin/ai-config` with no redeploy.
Six task types exist — **three are the client-facing features named in the prompt**, three
are internal:

| `task_type` | Entry point | Prompt's "three features"? |
|---|---|---|
| `campaign_content` | `POST /api/ai/campaign-draft` | ✅ **1. AI Campaign Creation** |
| `automation_flow_builder` | `POST /api/ai/flow-draft` | ✅ **2. Automation flow generation** |
| `template_content` | `POST /api/templates/generate` | ✅ **3. AI Template Creation** |
| `automation_runtime_intent` | `lib/automation/intent.ts` | internal — inbound routing |
| `appointment_nl_parse` | `POST /api/ai/appointment-parse` | internal — quick-book parse |
| `reminder_draft` | seeded, unused | internal |

### Vertical prompt-injection hooks — exactly three call sites, no fourth feature

All three routes follow one shape: build `system` + `prompt`, call `runTask({...})` from
`lib/ai/service.ts`. Injection is **additive context appended to the user `prompt`**, never
to `system` (system prompts encode format/safety contracts; polluting them risks the JSON
contract that `sanitizeFlowGraph` and the template parser depend on).

| # | File | Hook point |
|---|---|---|
| 1 | `app/api/ai/campaign-draft/route.ts:90` | after `const prompt = ...` |
| 2 | `app/api/ai/flow-draft/route.ts` (`flowBuilderUserPrompt(description, businessName)`) | third arg / appended vertical context |
| 3 | `app/api/templates/generate/route.ts` (`userPrompt`) | appended vertical context |

The injected text is read from `VerticalTemplateLibrary` — **never** hardcoded in TS/TSX,
per the standing restriction. No new `task_type`, no `ai_model_config` CHECK-constraint
change, no fourth feature, no autopilot. Tier gating (`lib/ai/config.ts`), credit metering,
and the graceful "fallback → manual flow" envelope are all untouched and continue to work
identically when `ANTHROPIC_API_KEY` is unset.

---

## 4. Output — reuse / generalize / net-new / risk

### (a) Reused as-is — not modified

- `automation_flows` + `chatbot_sessions` storage and `user_id` scoping
- `sanitizeFlowGraph` (becomes the **seed-time validator** — new use, unchanged code)
- `ai_model_config` routing, `ai_credit_wallet`, tier gating, `runTask` envelope
- Wallet/billing, `guardedSingleSend`, `meta_rates`, webhook verify/dedupe — **untouched**
- `middleware.ts` auth guard; `/admin` `ADMIN_EMAILS` gate (Phase 2 reuses it)
- Meta's own Template Library proxy (`/api/templates/library`) — unrelated to, and not
  replaced by, `VerticalTemplateLibrary`. Different things, confusingly similar names.

### (b) Generalized / refactored

- **Booking → flow-engine config** (`bookingContext` in the seed payload), not a fork
- **Three AI prompts** gain an optional vertical-context suffix — additive, no signature
  break, absent vertical = byte-identical prompt to today

### (c) Net-new

- `026_verticals.sql`: `industry_verticals`, `vertical_template_library`,
  `users.vertical_id` (nullable FK)
- Mirrored Prisma models (documentation artifact, §0.1)
- Admin: `/admin/clients/[id]/setup` + provisioning/seed-kit API
- Client: "Recommended for [Vertical]" rails on flow builder, campaign, template screens
- Seed script: Hospital, E-commerce, School, Real Estate, Restaurant, Salon
- Design tokens + type spec (Phase 4)

### (d) Breaking-change risk register

| # | Risk | Sev | Mitigation |
|---|---|---|---|
| 1 | Live hospital clients' appointment flows break | **None** | No live appointment system exists (§1). No mitigation needed — the risk was mis-scoped, not accepted |
| 2 | Seeded `FLOW_JSON` rejected by `sanitizeFlowGraph` → unopenable flow in a provisioned tenant | **High** | Run every seed payload through `sanitizeFlowGraph` in the seed script; **fail the seed, not the tenant**. Use only the 9 sanctioned node types |
| 3 | Client believes a multi-step seeded flow fully runs today, when only the first reply fires | **High** | Do not overclaim in `outcome` copy; multi-step flows carry an explicit plain-language status in Phase 3 (§2) |
| 4 | Existing users with `vertical_id = NULL` see a degraded/broken dashboard | **Med** | Nullable column, no backfill, no default. NULL = today's exact behavior. Every rail renders only `if (verticalId)`; "Skip / not sure" is a first-class equal-weight path |
| 5 | Vertical accidentally gates a core feature | **Med** | Vertical is read **only** by the three AI routes and the recommendation rails. Inbox, contacts, billing, manual builder, manual broadcast, manual template creation never read `vertical_id` |
| 6 | Vertical confused with `users.business_category` (Meta's code) | **Med** | Separate column; `business_category` keeps its Meta-API meaning and is still what's sent to Meta (§0.2) |
| 7 | Marketing-category seeded templates cost more per message than clients expect | **Med** | **Margin-affecting — flagged per `sendanjal-core`.** `metaCategory` is required on `MESSAGE_TEMPLATE` rows; Phase 3 surfaces a plain-language cost note next to every Marketing template. Rates still read live from `meta_rates` at send time — never from a seed row |
| 8 | Hospital seeds leak lab values/diagnoses into message bodies (DPDP) | **Med** | Report-ready seeds use the doorbell pattern (notify, never disclose); template editor warns on lab-value-shaped content |
| 9 | Prisma schema and SQL migration drift | **Low** | Both land in the same commit; `prisma/schema.prisma` stays documentation-only |
| 10 | Changing a client's vertical destroys their work | **Low** | Change/clear only rewrites `users.vertical_id`. Already-copied flows/campaigns/templates are the tenant's own rows and are never deleted — they unpin from the "recommended" rail |

---

---

## Correction (added after Phase 3, from inspecting the live database)

This audit assumed `automation_flows` / `chatbot_sessions` were deployed because
migration `003` exists and `CLAUDE.md` lists automations as "fully wired". **That was
wrong.** Listing the live tables in project `tbqfsudapxfqakzqbkgb` shows only 31 tables,
and these are **not among them**:

| Missing table | From migration | Consequence today |
|---|---|---|
| `automation_flows`, `chatbot_sessions` | `003` | `GET`/`POST /api/automation-flows` return **500** (`Could not find the table 'public.automation_flows'`). The visual builder opens and edits, but **cannot save**. |
| `ai_model_config`, `ai_credit_wallet`, `ai_credit_ledger`, `ai_usage_log` | `024`, `025` | `loadModelConfig()` finds nothing → every AI feature takes its designed graceful fallback to the manual path. |

This is **pre-existing** and unrelated to verticalization — the 500 reproduces on
`/automation` before any Phase 3 code runs. It does not change any conclusion in §1–§3:
the node-vocabulary constraint, the `renderFirstReply` single-reply limit, and the
three AI injection points are all still correct, and the vertical tables (`026`) are
deployed and working.

What it does change is the **honest status of two Phase 3 paths**:

- "Review and set up" opens a seeded automation on the canvas correctly, but **Save
  fails** until `003` is applied.
- The vertical prompt context is built and appended correctly (verified end-to-end),
  but the AI call itself falls back to manual until `024` is applied.

**Deploy order to make both live:** `003` → `024` → `025`. Both are additive; neither
touches `026` or any vertical data.

---

## Gate check

- Consistent with the schema Phase 1 is about to build: **yes** — `vertical_id` on `users`
  (not `Client`), SQL migration `026` as runtime truth with Prisma mirrored for reference.
- Blocking unknowns: **none.**
- Carried into Phase 1 as hard constraints: 9 node types only · seed-time
  `sanitizeFlowGraph` validation · prompt-suffix injection at 3 call sites · `vertical_id`
  nullable and never coupled to `tier` · no new AI feature, no new node type.

**Deferred, deliberately (each is its own change):** persistent worker for multi-step flow
execution · `paymentLinkNode` · `aiReplyNode` sanitizer drift · persisted `user_id`-keyed
`appointments` table.
