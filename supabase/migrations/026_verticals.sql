-- =====================================================
-- 026_verticals.sql  —  Industry verticals + per-vertical seed content library
--
-- Lets an admin provision a client into an industry track (Hospital, E-commerce,
-- School, Real Estate, Restaurant, Salon, …). The vertical then PRE-FILLS the
-- three existing AI features (campaign_content / automation_flow_builder /
-- template_content) with industry-appropriate starting points. It gates nothing.
--
-- Tenant model: LEGACY user_id (see CLAUDE.md "Deployment reality"). Each user IS
-- the tenant, so vertical_id lands on `users`, exactly like tier/waba_mode (016)
-- and business_name/city (018). The organization model is NOT deployed and is not
-- referenced here.
--
-- ADDITIVE & SAFE:
--   • Two new tables + ONE nullable column on users. Nothing existing is altered.
--   • users.vertical_id defaults to NULL and is NOT backfilled. NULL = today's
--     exact behaviour, so every current user is unaffected by deploying this.
--   • FK is ON DELETE SET NULL: retiring a vertical un-pins tenants, never
--     cascades into their data.
--   • Idempotent (IF NOT EXISTS throughout) — safe to re-run.
--
-- DELIBERATELY NOT COUPLED TO BILLING: vertical_id has no relationship to tier,
-- billing_mode, waba_mode, or the wallet. No code path reads both. A Starter
-- hospital and an Enterprise hospital get identical vertical content.
--
-- NO CONTENT LIVES IN CODE: every vertical name, flow, prompt and template body
-- is a row in these tables (seeded by 027). TypeScript/React must never hardcode
-- one, so admins can add "Gym" without a deploy.
-- =====================================================

-- ── industry_verticals: the tracks an admin can provision a client into ──────
CREATE TABLE IF NOT EXISTS industry_verticals (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  slug          TEXT NOT NULL UNIQUE,          -- 'hospital' | 'ecommerce' | 'school' | 'real_estate' | …
  display_name  TEXT NOT NULL,                 -- shown on the picker card
  -- One plain-language line for the picker card. Non-technical audience: say what
  -- the business does, not what the software does.
  description   TEXT NOT NULL DEFAULT '',
  icon          TEXT,                          -- lucide icon name, resolved at render
  is_active     BOOLEAN NOT NULL DEFAULT TRUE, -- false = hidden from the picker, existing tenants keep it
  sort_order    INTEGER NOT NULL DEFAULT 0,
  -- TRUE for the tracks SendAnjal ships and supports; FALSE for ones an admin created
  -- through the Phase 2 seed-kit form. Purely informational — no behaviour branches
  -- on it — but it lets the admin UI distinguish "shipped" from "you built this".
  is_builtin    BOOLEAN NOT NULL DEFAULT FALSE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_industry_verticals_active
  ON industry_verticals(is_active, sort_order);

-- ── vertical_template_library: the seed content shown to a provisioned client ─
-- Three kinds share one table because they share one lifecycle (seeded together,
-- previewed together, activated the same way) and one plain-language contract
-- (title/description/outcome). `payload` is kind-specific:
--
--   FLOW_JSON        → { flow: { nodes:[…], edges:[…] }, triggerType, bookingContext? }
--                      `flow` MUST validate against lib/automation/flow-schema.ts
--                      #sanitizeFlowGraph using ONLY the 9 canvas node types.
--                      Seeding is gated on that check (see 027 / seed script).
--   CAMPAIGN_PROMPT  → { prompt, goal?, audienceHint? }   pre-fills /api/ai/campaign-draft
--   MESSAGE_TEMPLATE → { body, footer?, variableNames:[…], language }
--
--   bookingContext (optional, FLOW_JSON only) is the booking/inquiry generalization
--   from the Phase 0 audit: { captureFields:[…], confirmationCopy, reminderCadence:[…] }.
--   Hospital appointments, Real Estate site visits, School counselor slots and Salon
--   bookings are THE SAME FLOW SHAPE with different config — not forked engines.
CREATE TABLE IF NOT EXISTS vertical_template_library (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  vertical_id   UUID NOT NULL REFERENCES industry_verticals(id) ON DELETE CASCADE,
  kind          TEXT NOT NULL
                  CHECK (kind IN ('CAMPAIGN_PROMPT','FLOW_JSON','MESSAGE_TEMPLATE')),
  title         TEXT NOT NULL,
  -- Plain language, one sentence, shown to a non-technical owner. No jargon:
  -- never "webhook", "payload", "WABA", "conversation object".
  description   TEXT NOT NULL,
  -- The business benefit in the owner's words, e.g. "Reminds patients the day
  -- before so fewer people miss their slot."
  outcome       TEXT NOT NULL,
  payload       JSONB NOT NULL,
  -- Meta's billing category. REQUIRED for MESSAGE_TEMPLATE because it decides what
  -- the client pays per message (MARKETING costs more than UTILITY) and whether the
  -- 24h window applies. NULL for the other two kinds.
  -- MARGIN NOTE: this is the category we SUBMIT to Meta. It is never a price source
  -- — send-time pricing always reads meta_rates (Law 2). Meta can also re-categorise
  -- a template on review, so treat this as intent, not as settled billing.
  meta_category TEXT
                  CHECK (meta_category IN ('UTILITY','MARKETING','AUTHENTICATION')),
  -- Free-text note surfaced to the ADMIN only (not the client) on the preview panel
  -- — e.g. "keep the RERA registration number in this copy".
  admin_note    TEXT,
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order    INTEGER NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- A message template with no category can't be submitted to Meta, and would leave
  -- the client unable to see what it costs. Reject at the DB, not at review time.
  CONSTRAINT vertical_tpl_meta_category_required
    CHECK (kind <> 'MESSAGE_TEMPLATE' OR meta_category IS NOT NULL),
  -- Conversely, a category on a flow/prompt row is meaningless and would be a
  -- copy/paste slip in a seed script.
  CONSTRAINT vertical_tpl_meta_category_only_on_template
    CHECK (kind =  'MESSAGE_TEMPLATE' OR meta_category IS NULL)
);

CREATE INDEX IF NOT EXISTS idx_vertical_tpl_lookup
  ON vertical_template_library(vertical_id, kind, is_active, sort_order);

-- ── users.vertical_id: which track this tenant was provisioned into ──────────
-- Nullable on purpose and never backfilled. NULL is a first-class state, not an
-- unconfigured one: it means "no industry track", which is the "Skip / not sure"
-- path and must stay fully functional. ON DELETE SET NULL so deactivating a
-- vertical un-pins its tenants without touching a single flow or campaign of theirs.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS vertical_id UUID REFERENCES industry_verticals(id) ON DELETE SET NULL;

-- NOTE: users.business_category already exists (018) and holds META's WhatsApp
-- vertical code (e.g. RETAIL) submitted during Embedded Signup. It is a Meta API
-- field with Meta's own value set — NOT this product concept. Keep them separate;
-- never read one where the other is meant.

CREATE INDEX IF NOT EXISTS idx_users_vertical_id
  ON users(vertical_id) WHERE vertical_id IS NOT NULL;

-- ── updated_at triggers ─────────────────────────────────────────────────────
-- Defined here with CREATE OR REPLACE rather than assumed from 010, because 010 is
-- an organization-model migration and may not have been applied to this database.
CREATE OR REPLACE FUNCTION touch_updated_at() RETURNS TRIGGER
  LANGUAGE plpgsql
  SET search_path = public   -- pinned, per 023 (function_search_path_mutable)
  AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END $$;

DROP TRIGGER IF EXISTS trg_industry_verticals_touch ON industry_verticals;
CREATE TRIGGER trg_industry_verticals_touch BEFORE UPDATE ON industry_verticals
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

DROP TRIGGER IF EXISTS trg_vertical_template_library_touch ON vertical_template_library;
CREATE TRIGGER trg_vertical_template_library_touch BEFORE UPDATE ON vertical_template_library
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- ── RLS ─────────────────────────────────────────────────────────────────────
-- Matches the established project posture (022): ENABLE + FORCE with NO policies.
-- Every read goes through a route handler using SUPABASE_SERVICE_ROLE_KEY, which
-- bypasses RLS — so this is a deny-all boundary for anon/authenticated with zero
-- functional impact. Writes are admin-only at the route layer (ADMIN_EMAILS).
ALTER TABLE public.industry_verticals       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.industry_verticals       FORCE  ROW LEVEL SECURITY;
ALTER TABLE public.vertical_template_library ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vertical_template_library FORCE  ROW LEVEL SECURITY;
