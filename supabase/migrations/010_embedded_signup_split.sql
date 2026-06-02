-- =====================================================
-- Migration 010 — Embedded Signup: account / phone / token / webhook split
-- =====================================================
-- Splits the monolithic `whatsapp_accounts` row into:
--   • whatsapp_accounts       — one row per (organization, waba_id)
--   • phone_numbers           — one row per phone (waba_id, phone_number_id)
--   • access_tokens           — one row per token granted to the platform
--   • webhook_subscriptions   — subscription state per WABA
--   • audit_logs              — security + onboarding audit trail
--
-- This migration is idempotent — every statement uses IF NOT EXISTS / ADD
-- COLUMN IF NOT EXISTS. The previous schema continues to work while you
-- migrate (whatsapp_accounts.phone_number_id stays populated until you
-- backfill phone_numbers).
-- =====================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ── whatsapp_accounts: add system_user_id + business_id (no-op if present) ─
ALTER TABLE whatsapp_accounts
  ADD COLUMN IF NOT EXISTS business_id     TEXT,
  ADD COLUMN IF NOT EXISTS system_user_id  TEXT,
  ADD COLUMN IF NOT EXISTS profile_name    TEXT;

-- waba_id should be unique per organization
CREATE UNIQUE INDEX IF NOT EXISTS idx_wa_accounts_org_waba_uniq
  ON whatsapp_accounts(organization_id, waba_id);

-- ──────────────────────────────────────────────────────────────────────
-- phone_numbers
-- One row per (waba, phone_number_id). Decouples token rotation from
-- phone metadata and lets a WABA own multiple verified numbers.
-- ──────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS phone_numbers (
  id                   UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id      UUID NOT NULL REFERENCES organizations(id)      ON DELETE CASCADE,
  whatsapp_account_id  UUID NOT NULL REFERENCES whatsapp_accounts(id)  ON DELETE CASCADE,
  phone_number_id      TEXT NOT NULL,                 -- Meta phone_number_id
  display_phone_number TEXT NOT NULL,                 -- e.g. "+91 98765 43210"
  verified_name        TEXT,
  quality_rating       TEXT NOT NULL DEFAULT 'UNKNOWN'
                       CHECK (quality_rating IN ('GREEN','YELLOW','RED','UNKNOWN')),
  messaging_tier       TEXT DEFAULT 'TIER_1K',
  code_verification_status TEXT,
  status               TEXT NOT NULL DEFAULT 'pending'
                       CHECK (status IN ('pending','active','suspended','disconnected')),
  is_primary           BOOLEAN NOT NULL DEFAULT FALSE,
  metadata             JSONB NOT NULL DEFAULT '{}',
  created_at           TIMESTAMPTZ DEFAULT NOW(),
  updated_at           TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(phone_number_id)
);

CREATE INDEX IF NOT EXISTS idx_phone_numbers_org      ON phone_numbers(organization_id);
CREATE INDEX IF NOT EXISTS idx_phone_numbers_account  ON phone_numbers(whatsapp_account_id);
CREATE INDEX IF NOT EXISTS idx_phone_numbers_status   ON phone_numbers(organization_id, status);

-- ──────────────────────────────────────────────────────────────────────
-- access_tokens
-- Encrypted access-token vault. A WhatsApp account can own multiple
-- tokens over its lifetime (rotation, system-user vs page tokens).
-- Only the row with `is_active=true` should be used for outbound API calls.
-- ──────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS access_tokens (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id       UUID NOT NULL REFERENCES organizations(id)     ON DELETE CASCADE,
  whatsapp_account_id   UUID NOT NULL REFERENCES whatsapp_accounts(id) ON DELETE CASCADE,
  token_type            TEXT NOT NULL DEFAULT 'system_user'
                        CHECK (token_type IN ('system_user','user','page','debug')),
  token_ciphertext      TEXT NOT NULL,                  -- AES-256-GCM blob
  token_fingerprint     TEXT NOT NULL,                  -- sha256(plaintext) hex — for lookup without decrypt
  scopes                TEXT[] DEFAULT '{}',
  issued_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at            TIMESTAMPTZ,                    -- NULL = permanent (system-user)
  last_used_at          TIMESTAMPTZ,
  rotated_from          UUID REFERENCES access_tokens(id) ON DELETE SET NULL,
  is_active             BOOLEAN NOT NULL DEFAULT TRUE,
  revoked_at            TIMESTAMPTZ,
  revoked_reason        TEXT,
  created_at            TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(token_fingerprint)
);

CREATE INDEX IF NOT EXISTS idx_access_tokens_org      ON access_tokens(organization_id);
CREATE INDEX IF NOT EXISTS idx_access_tokens_account  ON access_tokens(whatsapp_account_id);
CREATE INDEX IF NOT EXISTS idx_access_tokens_active
  ON access_tokens(whatsapp_account_id) WHERE is_active = TRUE;
CREATE INDEX IF NOT EXISTS idx_access_tokens_expires
  ON access_tokens(expires_at) WHERE expires_at IS NOT NULL AND is_active = TRUE;

-- Only one active token per account
CREATE UNIQUE INDEX IF NOT EXISTS idx_access_tokens_one_active
  ON access_tokens(whatsapp_account_id) WHERE is_active = TRUE;

-- ──────────────────────────────────────────────────────────────────────
-- webhook_subscriptions
-- Tracks subscription state per WABA so we can re-subscribe automatically.
-- ──────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS webhook_subscriptions (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id       UUID NOT NULL REFERENCES organizations(id)     ON DELETE CASCADE,
  whatsapp_account_id   UUID NOT NULL REFERENCES whatsapp_accounts(id) ON DELETE CASCADE,
  waba_id               TEXT NOT NULL,
  callback_url          TEXT NOT NULL,
  verify_token_fingerprint TEXT NOT NULL,                -- sha256 of the verify token in use
  subscribed_fields     TEXT[] DEFAULT ARRAY[
                          'messages',
                          'message_template_status_update',
                          'account_update',
                          'phone_number_quality_update'
                        ]::TEXT[],
  status                TEXT NOT NULL DEFAULT 'active'
                        CHECK (status IN ('active','failed','revoked')),
  last_verified_at      TIMESTAMPTZ,
  last_error            TEXT,
  meta_response         JSONB,                            -- raw Graph response for debugging
  created_at            TIMESTAMPTZ DEFAULT NOW(),
  updated_at            TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(whatsapp_account_id)
);

CREATE INDEX IF NOT EXISTS idx_webhook_subs_org  ON webhook_subscriptions(organization_id);
CREATE INDEX IF NOT EXISTS idx_webhook_subs_waba ON webhook_subscriptions(waba_id);

-- ──────────────────────────────────────────────────────────────────────
-- audit_logs
-- Tamper-evident audit trail for security-sensitive events. Append-only —
-- no UPDATE / DELETE policy.
-- ──────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS audit_logs (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
  user_id         UUID REFERENCES users(id)         ON DELETE SET NULL,
  action          TEXT NOT NULL,        -- e.g. 'embedded_signup.success'
  resource_type   TEXT,                 -- 'whatsapp_account' | 'access_token' | …
  resource_id     TEXT,
  ip_address      TEXT,
  user_agent      TEXT,
  outcome         TEXT NOT NULL DEFAULT 'success'
                  CHECK (outcome IN ('success','failure')),
  details         JSONB NOT NULL DEFAULT '{}',
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_org      ON audit_logs(organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_user     ON audit_logs(user_id, created_at DESC) WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_audit_logs_action   ON audit_logs(action, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_resource ON audit_logs(resource_type, resource_id) WHERE resource_id IS NOT NULL;

-- ──────────────────────────────────────────────────────────────────────
-- RLS — org-scoped reads; writes only via SERVICE_ROLE_KEY
-- ──────────────────────────────────────────────────────────────────────
ALTER TABLE phone_numbers          ENABLE ROW LEVEL SECURITY;
ALTER TABLE access_tokens          ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhook_subscriptions  ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs             ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "phone_numbers_org_select"        ON phone_numbers;
DROP POLICY IF EXISTS "access_tokens_org_select"        ON access_tokens;
DROP POLICY IF EXISTS "webhook_subscriptions_org_select" ON webhook_subscriptions;
DROP POLICY IF EXISTS "audit_logs_org_select"           ON audit_logs;

CREATE POLICY "phone_numbers_org_select" ON phone_numbers FOR SELECT
  USING (organization_id = ANY(get_user_org_ids()));

CREATE POLICY "access_tokens_org_select" ON access_tokens FOR SELECT
  USING (organization_id = ANY(get_user_org_ids()));

CREATE POLICY "webhook_subscriptions_org_select" ON webhook_subscriptions FOR SELECT
  USING (organization_id = ANY(get_user_org_ids()));

CREATE POLICY "audit_logs_org_select" ON audit_logs FOR SELECT
  USING (organization_id = ANY(get_user_org_ids()));

-- ──────────────────────────────────────────────────────────────────────
-- updated_at triggers
-- ──────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION touch_updated_at() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END $$;

DO $$
DECLARE t TEXT;
BEGIN
  FOR t IN SELECT unnest(ARRAY['phone_numbers','webhook_subscriptions']) LOOP
    EXECUTE format(
      'DROP TRIGGER IF EXISTS trg_%1$s_touch ON %1$I; '
      'CREATE TRIGGER trg_%1$s_touch BEFORE UPDATE ON %1$I '
      'FOR EACH ROW EXECUTE FUNCTION touch_updated_at();', t);
  END LOOP;
END $$;

-- ──────────────────────────────────────────────────────────────────────
-- Helper: atomic token rotation. Marks every existing active token for
-- the account inactive, then inserts the new one as active.
-- ──────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION rotate_access_token(
  p_org_id            UUID,
  p_account_id        UUID,
  p_token_ciphertext  TEXT,
  p_token_fingerprint TEXT,
  p_token_type        TEXT,
  p_expires_at        TIMESTAMPTZ,
  p_scopes            TEXT[]
) RETURNS UUID LANGUAGE plpgsql AS $$
DECLARE
  v_old_id UUID;
  v_new_id UUID;
BEGIN
  SELECT id INTO v_old_id
    FROM access_tokens
    WHERE whatsapp_account_id = p_account_id
      AND is_active = TRUE
    LIMIT 1;

  IF v_old_id IS NOT NULL THEN
    UPDATE access_tokens
      SET is_active = FALSE,
          revoked_at = NOW(),
          revoked_reason = 'rotated'
      WHERE id = v_old_id;
  END IF;

  INSERT INTO access_tokens(
    organization_id, whatsapp_account_id, token_type,
    token_ciphertext, token_fingerprint, scopes,
    issued_at, expires_at, rotated_from, is_active
  ) VALUES (
    p_org_id, p_account_id, p_token_type,
    p_token_ciphertext, p_token_fingerprint, COALESCE(p_scopes, '{}'),
    NOW(), p_expires_at, v_old_id, TRUE
  )
  RETURNING id INTO v_new_id;

  RETURN v_new_id;
END;
$$;
