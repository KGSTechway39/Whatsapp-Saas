-- =====================================================
-- 019_message_billing.sql  —  reserve → confirm-on-sent linkage
--
-- Links a sent message (Meta wa_message_id) to the wallet reservation that
-- holds its cost, so the Meta delivery-status webhook can CONFIRM (settle) the
-- reservation on sent/delivered, or RELEASE it on failed. Replaces the old
-- charge-then-refund flow in lib/billing/guarded-send.ts.
--
--   • A managed single send RESERVES (holds) the cost — no permanent debit.
--   • `sent`/`delivered` webhook → wallet_settle (the real debit) → status=settled.
--   • `failed` webhook          → wallet_release (frees the hold) → status=released.
--   • Idempotent: status guards re-processing; wallet RPCs idempotent per key.
--
-- ADDITIVE & SAFE: new table only. BYO and free (SERVICE @ 0) sends never get a row.
-- =====================================================
CREATE TABLE IF NOT EXISTS message_billing (
  wa_message_id   TEXT PRIMARY KEY,                 -- Meta message id == status.id
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reservation_id  UUID NOT NULL,                    -- wallet_reservations.id
  cost_paise      BIGINT NOT NULL CHECK (cost_paise >= 0),
  category        TEXT,                             -- margin trail
  wholesale_paise BIGINT,                           -- margin trail
  markup_bps      INTEGER,                          -- margin trail
  status          TEXT NOT NULL DEFAULT 'reserved'
                  CHECK (status IN ('reserved','settled','released')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  settled_at      TIMESTAMPTZ
);

-- Find still-open reservations (for a future lost-status sweeper).
CREATE INDEX IF NOT EXISTS idx_msgbill_open
  ON message_billing(created_at) WHERE status = 'reserved';
