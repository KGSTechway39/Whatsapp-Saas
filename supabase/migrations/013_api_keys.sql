-- =====================================================
-- 013_api_keys.sql  —  Phase 4 / M4: public API keys (legacy user_id model)
--
-- Consolidates the never-applied 004 (base) + 006 (extensions) into one table,
-- aligned with lib/api-keys.ts. Keys are user-scoped (the deployed tenant model),
-- SHA-256 hashed, with scopes, environment, expiry and per-key rate limit.
-- =====================================================
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS api_keys (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name               TEXT NOT NULL,
  prefix             TEXT NOT NULL,               -- first chars, for display
  key_hash           TEXT NOT NULL,               -- sha256 of the raw key
  scopes             TEXT[] DEFAULT '{}',
  environment        TEXT NOT NULL DEFAULT 'live' CHECK (environment IN ('live','test')),
  rate_limit_per_min INTEGER NOT NULL DEFAULT 60,
  request_count      BIGINT  NOT NULL DEFAULT 0,
  is_active          BOOLEAN DEFAULT TRUE,
  last_used_at       TIMESTAMPTZ,
  expires_at         TIMESTAMPTZ,
  revoked_at         TIMESTAMPTZ,
  created_at         TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_api_keys_user ON api_keys(user_id);
CREATE INDEX IF NOT EXISTS idx_api_keys_hash ON api_keys(key_hash) WHERE is_active = TRUE;
