-- =====================================================
-- WEBHOOK LOGS — every inbound payload from Meta is logged
-- =====================================================
-- Used for: debugging, replay-on-failure, audit trail, analytics.
-- Retention should be enforced via a scheduled cleanup (e.g. drop > 30d).

CREATE TABLE IF NOT EXISTS webhook_logs (
  id                   UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id      UUID        REFERENCES organizations(id) ON DELETE CASCADE,
  whatsapp_account_id  UUID        REFERENCES whatsapp_accounts(id) ON DELETE SET NULL,

  -- Meta-side identifiers
  waba_id              TEXT,
  phone_number_id      TEXT,
  event_type           TEXT        NOT NULL,           -- 'message' | 'status' | 'errors' | 'unknown'
  meta_event_id        TEXT,                            -- e.g. message id or status id (used for idempotency)

  -- Payload
  signature_valid      BOOLEAN     NOT NULL DEFAULT FALSE,
  raw_payload          JSONB       NOT NULL,
  processing_status    TEXT        NOT NULL DEFAULT 'pending'
                        CHECK (processing_status IN ('pending','processed','failed','duplicate')),
  processing_error     TEXT,
  processing_attempts  INTEGER     NOT NULL DEFAULT 0,
  processed_at         TIMESTAMPTZ,
  received_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (meta_event_id)                                -- enforces idempotency
);

CREATE INDEX IF NOT EXISTS idx_webhook_logs_org        ON webhook_logs(organization_id);
CREATE INDEX IF NOT EXISTS idx_webhook_logs_account    ON webhook_logs(whatsapp_account_id);
CREATE INDEX IF NOT EXISTS idx_webhook_logs_received   ON webhook_logs(received_at DESC);
CREATE INDEX IF NOT EXISTS idx_webhook_logs_status     ON webhook_logs(processing_status, received_at)
  WHERE processing_status IN ('pending','failed');

-- Sentinel column to mark whether access_token has been encrypted at the
-- application layer (lib/crypto.ts). Lets us roll out encryption gradually
-- without breaking any rows still holding plaintext.
ALTER TABLE whatsapp_accounts
  ADD COLUMN IF NOT EXISTS token_encrypted BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE whatsapp_accounts
  ADD COLUMN IF NOT EXISTS business_id TEXT;
