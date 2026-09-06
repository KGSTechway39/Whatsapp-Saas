# SendAnjal — Architecture Discovery Knowledge Base

**Generated:** 2026-07-30 · **Branch:** `feat/whatsapp-core-media-templates` · **Mode:** discovery only, no code modified

This is the output of a 20-phase architecture due-diligence pass over the SendAnjal
repository. Every claim is traced to a file:line reference or a live database query.

## Method and evidence standard

| Evidence class | How obtained |
|---|---|
| Code structure | `find` / `grep` over the working tree (43,841 LOC of `.ts`/`.tsx`) |
| Code behaviour | Direct reads of the 62 files listed in [Files Analysed](#files-analysed) |
| **Live schema** | **Direct SQL against Supabase project `tbqfsudapxfqakzqbkgb`** (`information_schema`, `pg_proc`, `pg_indexes`, `pg_constraint`, `pg_policies`, `pg_trigger`) |
| Live security posture | Supabase advisor lint API |
| Build health | `npx tsc --noEmit` (exit 0) |

The live-database queries are what make this audit different from the existing
`docs/verticals/PHASE-0-AUDIT.md`: several conclusions in that document were correct
when written and are now **stale**. See [05-DATABASE.md § Drift register](05-DATABASE.md).

## Read in this order

| # | Document | What it answers |
|---|---|---|
| 00 | [Executive Summary](00-EXECUTIVE-SUMMARY.md) | CTO view, readiness score, risk matrix, top 10 findings |
| 01 | [Business & Product](01-BUSINESS.md) | What it is, who buys it, revenue model, feature truth table |
| 02 | [Repository Structure](02-REPOSITORY.md) | Every folder, why it exists, dependency graph, dead code |
| 03 | [Technology Stack](03-TECH-STACK.md) | Every technology, why chosen, alternatives, gaps |
| 04 | [System Architecture](04-SYSTEM-ARCHITECTURE.md) | Diagrams: request, auth, message, payment, notification flows |
| 05 | [Database](05-DATABASE.md) | Live ER diagram, all 37 tables, **schema drift register** |
| 06 | [Authentication & Authorization](06-AUTH.md) | JWT sessions, RBAC reality, tenant isolation, weaknesses |
| 07 | [API Catalogue](07-API-CATALOGUE.md) | All 113 route files, auth/validation/tenancy per endpoint |
| 08 | [Frontend](08-FRONTEND.md) | 43 pages, 21 components, design system, RSC finding |
| 09 | [Backend](09-BACKEND.md) | Layering, services, repositories, jobs, error handling |
| 10 | [AI Architecture](10-AI.md) | Provider routing, credit metering, prompts, safety |
| 11 | [WhatsApp Architecture](11-WHATSAPP.md) | Graph wrappers, webhook, templates, 24h window, media |
| 12 | [Security Report](12-SECURITY.md) | OWASP pass, secrets, RLS, encryption, headers |
| 13 | [Performance Report](13-PERFORMANCE.md) | Bundle, rendering, queries, N+1, caching, pagination |
| 14 | [Code Quality & Technical Debt](14-CODE-QUALITY.md) | Dead code, duplication, debt register |
| 15 | [Design Patterns](15-DESIGN-PATTERNS.md) | Patterns found, where, why, trade-offs |
| 16 | [Multi-Tenancy](16-MULTI-TENANCY.md) | Isolation strategy, cross-tenant risk analysis |
| 17 | [SaaS Maturity](17-SAAS-MATURITY.md) | Subscription, usage, audit, RBAC, enterprise readiness |
| 18 | [Vertical SaaS Readiness](18-VERTICAL-READINESS.md) | 12 industries assessed, reusable vs industry-specific |
| 19 | [Impact Analysis](19-IMPACT-ANALYSIS.md) | UI redesign + horizontal→vertical conversion blast radius |
| 20 | [Roadmap & ADRs](20-ROADMAP-ADR.md) | Prioritised refactoring, phased plan, ADRs, onboarding |
| **21** | **[Change Impact Analysis](21-CHANGE-IMPACT-ANALYSIS.md)** | **18 change sets × 20 impact dimensions, dependency graph, ordered roadmap. Supersedes the sequencing in 19. Contains CRIT-1** |

> **Start at [21](21-CHANGE-IMPACT-ANALYSIS.md) §0 if you read nothing else.** It documents
> a Critical cross-tenant credential-use vulnerability found in
> `app/api/automation-flows/[id]/execute/route.ts` that outranks every other finding, plus
> three other defects in the same file and one large positive discovery (the persistent
> worker is 90% built).

## Confidence legend

Used throughout. Confidence is about **this audit's claim**, not about code quality.

| Score | Meaning |
|---|---|
| **High (95–100%)** | Verified by live DB query, or by reading the complete file |
| **Medium (75–94%)** | Verified by reading the relevant code path, but adjacent paths sampled not read |
| **Low (50–74%)** | Inferred from naming/structure/grep counts; file not fully read |
| **Unable to determine** | Stated explicitly wherever it applies |

## Files Analysed

Read in full or in substantial part during this audit:

```
Config      package.json, tsconfig.json, next.config.mjs, tailwind.config.ts,
            vercel.json, playwright.config.ts, .gitignore, CLAUDE.md
Core lib    middleware.ts, lib/auth.ts, lib/supabase/server.ts, lib/crypto.ts,
            lib/validate.ts, lib/rate-limit.ts, lib/logger.ts, lib/audit.ts,
            lib/api-keys.ts, lib/api.ts (partial), lib/queue/index.ts
Billing     lib/billing/{guarded-send,wallet,pricing,rates,tiers,confirm}.ts  (all 6, full)
WhatsApp    lib/meta.ts, lib/meta-version.ts, lib/whatsapp/{engine,dispatch,queue,
            status,inbox,window,dedup,errors,token-cache}.ts
AI          lib/ai/{config,service,wallet}.ts  (all 3, full)
Automation  lib/automation/{runtime (partial),flow-schema (partial)}.ts
Verticals   lib/verticals/{types,repository}.ts
Routes      app/api/webhook/whatsapp/route.ts, app/api/webhooks/whatsapp/route.ts,
            app/api/whatsapp/send/route.ts, app/api/auth/dev-login/route.ts,
            app/api/auth/forgot-password/route.ts, app/api/billing/webhook (partial),
            app/api/v1/messages/send (partial), app/api/campaigns/execute (grepped),
            app/api/inbox/[id]/send (grepped), all 3 AI routes (grepped)
DB          all 34 files in supabase/migrations/ (object inventory),
            LIVE schema of tbqfsudapxfqakzqbkgb (full column/index/FK/policy dump)
Docs        docs/verticals/PHASE-0-AUDIT.md (full)
Scripts     scripts/production-check.sh
Prisma      prisma/schema.prisma (header + model count)
```

## Files NOT Analysed

Material that exists but was not read line-by-line. Conclusions touching these areas
are marked Low confidence or "Unable to determine".

```
Frontend    All 43 page.tsx bodies (inventoried by size + client/server directive only).
            components/whatsapp/EmbeddedSignupModal.tsx (1,313 lines) — largest file
            in the repo, read only via its meta-version coupling.
            components/layout/Sidebar.tsx — nav map extracted, render logic not read.
Routes      ~95 of 113 route.ts bodies. Audited programmatically for auth guard,
            Zod usage, rate limiting, and tenant filter; business logic not read.
Lib         lib/segments.ts (269), lib/commerce.ts (146), lib/meta-ads.ts (140),
            lib/meta-client.ts (314), lib/webhooks-out.ts (213), lib/razorpay.ts (89),
            lib/google-oauth.ts (105), lib/email.ts (64), lib/motion.ts, lib/utils.ts
            lib/whatsapp/{service,repository,onboarding-repo,dto,workspacecv-templates}.ts
            lib/verticals/{seed-data (1,315),seeder,flow-builders,preview,validate,
            validate-seed,prompt-context}.ts
SQL         Full bodies of the 34 migrations (functions read only in 011/024 summary form).
            supabase/schema.sql, seed.sql, add_crm.sql, add_subscriptions.sql (legacy).
            supabase/tests/prepaid_wallet_test.sql
Tests       e2e/*.spec.ts bodies (sizes only)
Other       .claude/skills/*/SKILL.md (6 files — domain rules; deferred to CLAUDE.md summary)
            docs/{EMBEDDED_SIGNUP,FOUNDER_GUIDE,ai-layer-architecture,embedded-signup}.md
            docs/verticals/PHASE-4-DESIGN-PLAN.md
            .playwright-mcp/ (98 files — screenshots/logs, generated)
```
