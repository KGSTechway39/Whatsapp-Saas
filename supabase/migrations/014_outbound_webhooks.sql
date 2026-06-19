-- =====================================================
-- 014_outbound_webhooks.sql  —  Phase 4 / M5: outbound webhook delivery
--
-- Deploys the tables lib/webhooks-out.ts already expects (from the never-applied
-- 006): customer-registered endpoints + a per-attempt delivery log / retry queue.
-- User-scoped (legacy tenant model).
-- =====================================================
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS webhook_endpoints (
  id               UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id          UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name             TEXT,
  url              TEXT        NOT NULL,
  secret           TEXT        NOT NULL,
  events           TEXT[]      NOT NULL DEFAULT '{}',
  status           TEXT        NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active','paused','failed')),
  last_delivery_at TIMESTAMPTZ,
  last_success_at  TIMESTAMPTZ,
  failure_count    INTEGER     NOT NULL DEFAULT 0,
  total_deliveries BIGINT      NOT NULL DEFAULT 0,
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  updated_at       TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_webhook_endpoints_user   ON webhook_endpoints(user_id);
CREATE INDEX IF NOT EXISTS idx_webhook_endpoints_status ON webhook_endpoints(status);

CREATE TABLE IF NOT EXISTS webhook_deliveries (
  id              UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  endpoint_id     UUID        NOT NULL REFERENCES webhook_endpoints(id) ON DELETE CASCADE,
  user_id         UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event           TEXT        NOT NULL,
  payload         JSONB       NOT NULL,
  status          TEXT        NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending','success','failed','retrying')),
  attempts        INTEGER     NOT NULL DEFAULT 0,
  response_status INTEGER,
  response_body   TEXT,
  next_retry_at   TIMESTAMPTZ,
  duration_ms     INTEGER,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  completed_at    TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_endpoint ON webhook_deliveries(endpoint_id);
CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_user     ON webhook_deliveries(user_id);
CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_retry    ON webhook_deliveries(next_retry_at)
  WHERE status IN ('pending','retrying');

-- Success counter used by lib/webhooks-out.ts (it falls back gracefully if absent).
CREATE OR REPLACE FUNCTION increment_webhook_endpoint_success(p_id UUID)
RETURNS void LANGUAGE sql AS $$
  UPDATE webhook_endpoints
    SET last_delivery_at = NOW(), last_success_at = NOW(),
        failure_count = 0, total_deliveries = total_deliveries + 1
  WHERE id = p_id;
$$;
