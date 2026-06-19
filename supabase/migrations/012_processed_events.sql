-- =====================================================
-- 012_processed_events.sql  —  Phase 4 / M3: webhook idempotency
--
-- Records every external webhook event we've handled, keyed by the provider's
-- unique event id. The billing webhook inserts a row before processing; a
-- unique-violation means "already handled" → we ack and skip. Combined with the
-- idempotency keys inside wallet_credit, a replayed Razorpay event credits once.
-- =====================================================
CREATE TABLE IF NOT EXISTS processed_events (
  event_id     TEXT PRIMARY KEY,            -- e.g. Razorpay x-razorpay-event-id
  source       TEXT NOT NULL DEFAULT 'razorpay',
  event_type   TEXT,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
