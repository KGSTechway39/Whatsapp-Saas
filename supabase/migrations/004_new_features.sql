-- ─── API Keys ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS api_keys (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  prefix       TEXT NOT NULL,              -- first 16 chars for display
  key_hash     TEXT NOT NULL,              -- sha256 of raw key
  scopes       TEXT[] DEFAULT '{}',
  is_active    BOOLEAN DEFAULT TRUE,
  last_used_at TIMESTAMPTZ,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_api_keys_user   ON api_keys(user_id);
CREATE INDEX IF NOT EXISTS idx_api_keys_hash   ON api_keys(key_hash) WHERE is_active = TRUE;

-- ─── Products / Catalog ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS products (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  description  TEXT,
  price        NUMERIC(12,2) DEFAULT 0,
  currency     TEXT DEFAULT 'INR',
  sku          TEXT,
  category     TEXT,
  image_url    TEXT,
  is_active    BOOLEAN DEFAULT TRUE,
  stock        INTEGER DEFAULT -1,        -- -1 = unlimited
  source       TEXT DEFAULT 'manual',     -- manual | shopify | woocommerce
  external_id  TEXT,                      -- SKU from external store
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_products_user ON products(user_id);

-- ─── CTWA Ad Campaigns ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ad_campaigns (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  fb_campaign_id  TEXT,
  fb_adset_id     TEXT,
  fb_ad_id        TEXT,
  spend           NUMERIC(12,2) DEFAULT 0,
  impressions     INTEGER DEFAULT 0,
  clicks          INTEGER DEFAULT 0,
  leads           INTEGER DEFAULT 0,
  conversions     INTEGER DEFAULT 0,
  revenue         NUMERIC(12,2) DEFAULT 0,
  status          TEXT DEFAULT 'active',
  tag_contacts_as TEXT,                   -- auto-tag contacts from this ad
  started_at      TIMESTAMPTZ,
  ended_at        TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ad_campaigns_user ON ad_campaigns(user_id);

-- ─── White-label branding config ─────────────────────────────────────────────
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS brand_name        TEXT,
  ADD COLUMN IF NOT EXISTS brand_logo_url    TEXT,
  ADD COLUMN IF NOT EXISTS brand_primary_color TEXT DEFAULT '#25D366',
  ADD COLUMN IF NOT EXISTS custom_domain     TEXT,
  ADD COLUMN IF NOT EXISTS white_label       BOOLEAN DEFAULT FALSE;

-- ─── Team member response stats (for Team Analytics) ─────────────────────────
CREATE TABLE IF NOT EXISTS agent_stats (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  agent_id            UUID,               -- team member id
  agent_name          TEXT NOT NULL,
  date                DATE NOT NULL DEFAULT CURRENT_DATE,
  conversations_handled INTEGER DEFAULT 0,
  messages_sent        INTEGER DEFAULT 0,
  avg_response_time_sec INTEGER DEFAULT 0,
  csat_score          NUMERIC(3,2),        -- 1.00–5.00
  sla_met             INTEGER DEFAULT 0,
  sla_missed          INTEGER DEFAULT 0,
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, agent_id, date)
);
CREATE INDEX IF NOT EXISTS idx_agent_stats_user ON agent_stats(user_id, date);
