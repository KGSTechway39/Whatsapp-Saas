-- =====================================================
-- 021_webhook_inbox.sql  —  persist-then-enqueue (replayable pipeline)
--
-- Every inbound Meta webhook payload is stored RAW here BEFORE any processing or
-- enqueue, so a crash/driver loss after the 200-ack can be replayed from the
-- stored payload instead of being lost. Distinct from:
--   • processed_events  — per-event dedup keys (no payload)
--   • message_billing   — reservation linkage
--
-- ADDITIVE & SAFE: new table only.
-- =====================================================
CREATE TABLE IF NOT EXISTS webhook_inbox (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source          TEXT NOT NULL DEFAULT 'whatsapp',
  route           TEXT,                              -- which endpoint received it
  signature_valid BOOLEAN NOT NULL DEFAULT TRUE,
  raw_payload     JSONB NOT NULL,
  status          TEXT NOT NULL DEFAULT 'received'
                  CHECK (status IN ('received','processed','failed')),
  error           TEXT,
  received_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at    TIMESTAMPTZ
);

-- Find rows that still need processing / replay.
CREATE INDEX IF NOT EXISTS idx_webhook_inbox_pending
  ON webhook_inbox(received_at) WHERE status <> 'processed';
