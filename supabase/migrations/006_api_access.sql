-- =====================================================
-- API ACCESS — extend api_keys + add outbound webhooks
-- (api_keys table itself was created in 004_new_features.sql)
-- =====================================================

-- ── Extend existing api_keys for production-grade key management ─────────
ALTER TABLE api_keys
  ADD COLUMN IF NOT EXISTS environment        TEXT    NOT NULL DEFAULT 'live'
    CHECK (environment IN ('live','test')),
  ADD COLUMN IF NOT EXISTS rate_limit_per_min INTEGER NOT NULL DEFAULT 60,
  ADD COLUMN IF NOT EXISTS request_count      BIGINT  NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS expires_at         TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS revoked_at         TIMESTAMPTZ;

-- ── Webhook Endpoints ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS webhook_endpoints (
  id                 UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id            UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name               TEXT,
  url                TEXT        NOT NULL,
  secret             TEXT        NOT NULL,
  events             TEXT[]      NOT NULL DEFAULT '{}',
  status             TEXT        NOT NULL DEFAULT 'active'
                      CHECK (status IN ('active','paused','failed')),
  last_delivery_at   TIMESTAMPTZ,
  last_success_at    TIMESTAMPTZ,
  failure_count      INTEGER     NOT NULL DEFAULT 0,
  total_deliveries   BIGINT      NOT NULL DEFAULT 0,
  created_at         TIMESTAMPTZ DEFAULT NOW(),
  updated_at         TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_webhook_endpoints_user   ON webhook_endpoints(user_id);
CREATE INDEX IF NOT EXISTS idx_webhook_endpoints_status ON webhook_endpoints(status);

-- ── Webhook Deliveries (per-attempt log + retry queue) ───────────────────
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
