-- =====================================================
-- 015_api_messages_otp.sql  —  Integration layer: public send idempotency + OTP
--
-- api_messages : one row per public-API send. UNIQUE(user_id, client_reference)
--                gives caller-driven idempotency; wa_message_id lets the status
--                webhook correlate Meta callbacks back to client_reference.
-- otp_codes    : hashed one-time codes for resume-delivery verification.
--                Never stores raw codes. Short expiry + attempt cap + per-number
--                rate limiting (via created_at lookups).
-- Both user_id-scoped (the deployed tenant model).
-- =====================================================
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS api_messages (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_reference TEXT,
  to_phone         TEXT NOT NULL,
  type             TEXT NOT NULL CHECK (type IN ('document','text','template')),
  status           TEXT NOT NULL DEFAULT 'queued'
                    CHECK (status IN ('queued','sent','delivered','read','failed')),
  wa_message_id    TEXT,
  error            TEXT,
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  updated_at       TIMESTAMPTZ DEFAULT NOW()
);
-- Idempotency: a (tenant, client_reference) pair maps to exactly one message.
CREATE UNIQUE INDEX IF NOT EXISTS uq_api_messages_cref
  ON api_messages(user_id, client_reference) WHERE client_reference IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_api_messages_user ON api_messages(user_id);
CREATE INDEX IF NOT EXISTS idx_api_messages_wa
  ON api_messages(wa_message_id) WHERE wa_message_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS otp_codes (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  phone        TEXT NOT NULL,
  code_hash    TEXT NOT NULL,             -- sha256(code) — never the raw code
  expires_at   TIMESTAMPTZ NOT NULL,
  attempts     INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 5,
  consumed_at  TIMESTAMPTZ,               -- set on successful verify (single-use)
  created_at   TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_otp_user_phone ON otp_codes(user_id, phone, created_at DESC);
