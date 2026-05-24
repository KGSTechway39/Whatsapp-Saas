-- =====================================================
-- Mark whatsapp_numbers.access_token as encrypted at rest
-- =====================================================
-- Tokens are encrypted with AES-256-GCM via lib/crypto.ts before insert/update.
-- This flag lets us detect legacy plaintext rows during a gradual rollout.

ALTER TABLE whatsapp_numbers
  ADD COLUMN IF NOT EXISTS token_encrypted BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS token_expires_at TIMESTAMPTZ;
