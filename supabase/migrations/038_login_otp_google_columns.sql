-- =====================================================
-- 038 — Sign-in: Google columns (re-assert 007) + WhatsApp OTP login
-- =====================================================
-- 007_google_login was never applied to the deployed DB, so Google sign-in
-- failed at the user lookup even with credentials set. Its DDL is repeated
-- here idempotently so this migration alone brings a DB up to date.
--
-- login_otp_codes is PRE-AUTH state (the person is not signed in yet), so it
-- is keyed by phone, not tenant. It is service-role only: RLS on, no policies.

-- ── Google identity (same as 007) ───────────────────────────────────────────
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS google_id     TEXT UNIQUE,
  ADD COLUMN IF NOT EXISTS google_email  TEXT,
  ADD COLUMN IF NOT EXISTS auth_provider TEXT NOT NULL DEFAULT 'password'
    CHECK (auth_provider IN ('password','google','both'));

ALTER TABLE public.users ALTER COLUMN password_hash DROP NOT NULL;

CREATE INDEX IF NOT EXISTS idx_users_google_id ON public.users(google_id) WHERE google_id IS NOT NULL;

-- ── Normalized phone for OTP lookup ─────────────────────────────────────────
-- users.phone is free text from settings ("+91 98765 43210"). Digits only, and
-- a bare 10-digit Indian mobile gets the 91 country code.
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS phone_normalized TEXT GENERATED ALWAYS AS (
    CASE
      WHEN length(regexp_replace(coalesce(phone, ''), '\D', '', 'g')) = 10
        THEN '91' || regexp_replace(phone, '\D', '', 'g')
      ELSE nullif(regexp_replace(coalesce(phone, ''), '\D', '', 'g'), '')
    END
  ) STORED;

CREATE INDEX IF NOT EXISTS idx_users_phone_normalized
  ON public.users(phone_normalized) WHERE phone_normalized IS NOT NULL;

-- ── Login OTP codes ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.login_otp_codes (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone        TEXT NOT NULL,             -- normalized digits, e.g. 919876543210
  user_id      UUID REFERENCES public.users(id) ON DELETE CASCADE,  -- NULL = no account (nothing sent)
  code_hash    TEXT NOT NULL,             -- HMAC(code) — never the raw code
  expires_at   TIMESTAMPTZ NOT NULL,
  attempts     INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 5,
  consumed_at  TIMESTAMPTZ,
  ip           TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_login_otp_phone_created
  ON public.login_otp_codes(phone, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_login_otp_ip_created
  ON public.login_otp_codes(ip, created_at DESC);

ALTER TABLE public.login_otp_codes ENABLE ROW LEVEL SECURITY;
