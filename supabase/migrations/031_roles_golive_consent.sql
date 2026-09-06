-- =====================================================
-- 031_roles_golive_consent.sql
--   • users.role        — the four-role model (replaces "every admin is a god")
--   • users.status      — tenant lifecycle: setup → active
--   • tenant_golive_checks — recorded proof for the event-type go-live items
--   • contacts consent  — DPDP-driven, data-driven (NOT "if hospital")
--   • industry_verticals.requires_explicit_consent — the flag that drives it
--
-- PHASE 0 AUDIT (done before writing this — nothing here duplicates existing
-- structure):
--   • `waba_connections` does NOT exist in this project. Numbers live in
--     `whatsapp_numbers`, keyed by user_id (the legacy model that is actually
--     deployed). This migration touches neither.
--   • The vertical seed kit ALREADY exists as `industry_verticals` +
--     `vertical_template_library` (one polymorphic table, kind = FLOW_JSON |
--     CAMPAIGN_PROMPT | MESSAGE_TEMPLATE, 58 seeded rows across 6 verticals).
--     It already has `is_active`. We EXTEND it; we do not fork it into three
--     parallel tables.
--   • Per-tenant template approval state already exists: `templates` is
--     user_id-scoped with `status` + `meta_template_id`. No new queue table.
--
-- ADDITIVE & SAFE; idempotent.
-- =====================================================

-- ── users.role ──────────────────────────────────────────────────────────────
-- super_admin  — founder. Billing, rate card, markup, all tenants' money.
-- tenant_admin — SendAnjal internal support. Setup + support, NEVER money.
-- tenant_owner — the client's own admin. Their own tenant only.
-- tenant_staff — the client's agents. Their own tenant, narrower still.
--
-- Default is tenant_owner: every existing row is a real client signup, and the
-- founder is resolved via the ADMIN_EMAILS allowlist in application code, so
-- defaulting nobody to an admin role cannot escalate anyone.
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'tenant_owner'
    CHECK (role IN ('super_admin','tenant_admin','tenant_owner','tenant_staff'));

CREATE INDEX IF NOT EXISTS idx_users_role ON public.users(role)
  WHERE role IN ('super_admin','tenant_admin');

-- ── users.status — tenant lifecycle ─────────────────────────────────────────
-- 'setup' gates the go-live checklist; 'active' is a fully live tenant.
-- Backfilled to 'active' for every existing row: they are already sending, and
-- defaulting live tenants into 'setup' would gate working accounts behind a
-- checklist they never went through.
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'setup'
    CHECK (status IN ('setup','active','suspended')),
  ADD COLUMN IF NOT EXISTS activated_at TIMESTAMPTZ;

UPDATE public.users SET status = 'active', activated_at = COALESCE(activated_at, created_at)
  WHERE status = 'setup' AND created_at < NOW();

CREATE INDEX IF NOT EXISTS idx_users_status ON public.users(status);

-- ── tenant_golive_checks — proof for the EVENT-type checklist items ─────────
-- Three of the six go-live items are computable live (WABA connected, a
-- template approved, wallet funded) and are NEVER stored — a stored copy would
-- drift from the truth and let a tenant activate on a stale tick.
--
-- The other three are events that happened once and leave no queryable trace
-- ("a test message was delivered", "a test inbound routed here", "a flow ran
-- end to end"). Those are recorded here, with WHO verified them, so activation
-- is auditable rather than self-asserted.
CREATE TABLE IF NOT EXISTS public.tenant_golive_checks (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  check_key   TEXT NOT NULL
              CHECK (check_key IN ('test_outbound_delivered','test_inbound_routed','automation_tested')),
  passed_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  verified_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  -- Evidence: the wa_message_id, the flow id, whatever proves it happened.
  details     JSONB NOT NULL DEFAULT '{}',
  UNIQUE (user_id, check_key)
);

CREATE INDEX IF NOT EXISTS idx_golive_user ON public.tenant_golive_checks(user_id);

-- ── Consent — data-driven, never "if vertical = hospital" ───────────────────
-- The rule lives on the vertical row, so School (minors' data) or any future
-- regulated vertical turns it on by flipping a boolean, with no code change.
ALTER TABLE public.industry_verticals
  ADD COLUMN IF NOT EXISTS requires_explicit_consent BOOLEAN NOT NULL DEFAULT FALSE;

-- Hospital: DPDP Act, health data. School: minors' data.
UPDATE public.industry_verticals SET requires_explicit_consent = TRUE
  WHERE slug IN ('hospital','school');

-- Consent is recorded on the CONTACT, because consent is given by a person
-- about their own data. Nullable timestamp on purpose: NULL means "never
-- given", which is materially different from "given then withdrawn".
ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS sensitive_data_consent BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS consent_timestamp TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS consent_source TEXT;

-- The hot query is "which of this tenant's contacts may I send to?"
CREATE INDEX IF NOT EXISTS idx_contacts_consent
  ON public.contacts(user_id) WHERE sensitive_data_consent = TRUE;

-- Consent must never be silently granted by a bulk update that forgets the
-- timestamp — if the flag is true the timestamp is required.
ALTER TABLE public.contacts
  DROP CONSTRAINT IF EXISTS chk_contacts_consent_timestamp;
ALTER TABLE public.contacts
  ADD CONSTRAINT chk_contacts_consent_timestamp
    CHECK (sensitive_data_consent = FALSE OR consent_timestamp IS NOT NULL)
    NOT VALID;  -- NOT VALID: applies to new/updated rows, does not fail on legacy data

-- ── RLS on the new table (deny-all; service-role only, as everywhere here) ──
ALTER TABLE public.tenant_golive_checks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenant_golive_checks FORCE  ROW LEVEL SECURITY;
