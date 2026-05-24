-- =====================================================
-- Google OAuth login support
-- =====================================================
-- Existing users table is bcrypt-only. We add columns so a single user
-- row can be authenticated either by password OR by Google identity.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS google_id     TEXT UNIQUE,
  ADD COLUMN IF NOT EXISTS google_email  TEXT,
  ADD COLUMN IF NOT EXISTS auth_provider TEXT NOT NULL DEFAULT 'password'
    CHECK (auth_provider IN ('password','google','both'));

-- Allow Google-only users (no password set).
ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;

CREATE INDEX IF NOT EXISTS idx_users_google_id ON users(google_id) WHERE google_id IS NOT NULL;
