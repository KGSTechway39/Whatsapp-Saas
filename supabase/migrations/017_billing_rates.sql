-- =====================================================
-- 017_billing_rates.sql  —  Rate/markup config (the margin core) + platform fees
--
-- Makes the charged per-message price DERIVED, not hand-set:
--
--   charged_paise = round( wholesale_paise × (1 + (tier_markup_bps + buffer_bps)/10000) )
--
--   • wholesale_paise — Meta's cost, from `meta_rates` (versioned, configurable).
--   • tier_markup_bps — your margin per tier, from `plan_tiers` (basis points).
--   • buffer_bps      — global safety margin so a Meta rate hike can't erase margin.
--   • A per-user row in `message_pricing` (migration 011) still overrides everything.
--
-- ADDITIVE & SAFE:
--   • Nothing here is read unless a user is on a managed tier; the wallet itself
--     (single-balance, migration 011) is unchanged. Credit EXPIRY is config-only
--     (`credit_validity_months`) — the lot-based engine is intentionally deferred.
--   • Pre-migration the app falls back to the existing `message_pricing` defaults,
--     so deploying the code before this SQL is harmless.
-- =====================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ── meta_rates: Meta wholesale cost, versioned by effective_from ─────────────
-- A new Meta rate = a new row (history kept for back-dated margin reports).
CREATE TABLE IF NOT EXISTS meta_rates (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  region          TEXT NOT NULL DEFAULT 'IN',
  category        TEXT NOT NULL
                  CHECK (category IN ('MARKETING','UTILITY','AUTHENTICATION','SERVICE')),
  wholesale_paise BIGINT NOT NULL CHECK (wholesale_paise >= 0),
  effective_from  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  note            TEXT
);
CREATE INDEX IF NOT EXISTS idx_meta_rates_lookup
  ON meta_rates(region, category, effective_from DESC);

-- Meta India wholesale, Jan-2026 (paise). Auth 14.5p stored as 15 (round up — never
-- let rounding put the charged price below cost).
INSERT INTO meta_rates (region, category, wholesale_paise, note) VALUES
  ('IN','MARKETING',      86, 'Meta India wholesale Jan-2026'),
  ('IN','UTILITY',        13, 'Meta India wholesale Jan-2026'),
  ('IN','AUTHENTICATION', 15, 'Meta India wholesale Jan-2026 (14.5 rounded up)'),
  ('IN','SERVICE',         0, 'Customer-initiated service = free')
ON CONFLICT DO NOTHING;

-- ── plan_tiers: tier is config, not just an enum ────────────────────────────
CREATE TABLE IF NOT EXISTS plan_tiers (
  tier                 TEXT PRIMARY KEY
                       CHECK (tier IN ('starter','growth','enterprise')),
  model                CHAR(1) NOT NULL CHECK (model IN ('A','B','C')),
  billing_mode         TEXT NOT NULL CHECK (billing_mode IN ('byo','managed')),
  waba_mode            TEXT NOT NULL CHECK (waba_mode IN ('own','shared')),
  monthly_fee_paise    BIGINT  NOT NULL DEFAULT 0,
  onboarding_fee_paise BIGINT  NOT NULL DEFAULT 0,
  default_markup_bps   INTEGER NOT NULL DEFAULT 0,   -- 2500 = 25%
  monthly_msg_cap      INTEGER,                       -- NULL = uncapped
  razorpay_plan_key    TEXT,
  updated_at           TIMESTAMPTZ DEFAULT NOW()
);
INSERT INTO plan_tiers
  (tier, model, billing_mode, waba_mode, monthly_fee_paise, onboarding_fee_paise, default_markup_bps, monthly_msg_cap) VALUES
  ('starter',    'C', 'managed', 'shared',  99900, 0, 2500, 5000),
  ('growth',     'B', 'managed', 'own',    199900, 0, 1800, NULL),
  ('enterprise', 'A', 'byo',     'own',    499900, 0, 1000, NULL)
ON CONFLICT (tier) DO NOTHING;

-- ── platform_settings: global knobs (singleton row, id = 1) ──────────────────
CREATE TABLE IF NOT EXISTS platform_settings (
  id                                  INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  buffer_bps                          INTEGER NOT NULL DEFAULT 1000,   -- +10% safety vs Meta hikes
  min_topup_paise                     BIGINT  NOT NULL DEFAULT 100000, -- ₹1,000 floor
  default_low_balance_threshold_paise BIGINT  NOT NULL DEFAULT 20000,  -- ₹200 alert
  credit_validity_months              INTEGER NOT NULL DEFAULT 12,     -- config only (expiry deferred)
  updated_at                          TIMESTAMPTZ DEFAULT NOW()
);
INSERT INTO platform_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- ── topup_bands: bigger wallet load = more bonus credits ─────────────────────
CREATE TABLE IF NOT EXISTS topup_bands (
  id        UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  min_paise BIGINT  NOT NULL CHECK (min_paise >= 0),
  bonus_bps INTEGER NOT NULL DEFAULT 0,   -- 300 = +3% credits
  UNIQUE (min_paise)
);
INSERT INTO topup_bands (min_paise, bonus_bps) VALUES
  ( 100000,   0),   -- ₹1,000+  : no bonus
  ( 500000, 300),   -- ₹5,000+  : +3%
  (1000000, 600)    -- ₹10,000+ : +6%
ON CONFLICT (min_paise) DO NOTHING;

-- ── transactions: per-message margin trail (populated on managed debits) ─────
-- Margin per client = Σ(−amount_paise on debits) − Σ(wholesale_paise).
ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS category        TEXT,
  ADD COLUMN IF NOT EXISTS wholesale_paise BIGINT,
  ADD COLUMN IF NOT EXISTS markup_bps      INTEGER;

-- ── platform_charges: platform fees kept SEPARATE from the message wallet ────
CREATE TABLE IF NOT EXISTS platform_charges (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind         TEXT NOT NULL CHECK (kind IN ('subscription','onboarding','addon')),
  amount_paise BIGINT NOT NULL CHECK (amount_paise >= 0),
  period       TEXT,                 -- e.g. '2026-06' for a monthly fee
  razorpay_ref TEXT,
  status       TEXT NOT NULL DEFAULT 'pending'
               CHECK (status IN ('pending','paid','failed','refunded')),
  created_at   TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_platform_charges_user
  ON platform_charges(user_id, created_at DESC);

-- ── RLS: config/fee tables are server-only (service role bypasses) ───────────
-- Matches the project posture: browser never reads these directly.
ALTER TABLE meta_rates        ENABLE ROW LEVEL SECURITY;
ALTER TABLE meta_rates        FORCE  ROW LEVEL SECURITY;
ALTER TABLE plan_tiers        ENABLE ROW LEVEL SECURITY;
ALTER TABLE plan_tiers        FORCE  ROW LEVEL SECURITY;
ALTER TABLE platform_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_settings FORCE  ROW LEVEL SECURITY;
ALTER TABLE topup_bands       ENABLE ROW LEVEL SECURITY;
ALTER TABLE topup_bands       FORCE  ROW LEVEL SECURITY;
ALTER TABLE platform_charges  ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_charges  FORCE  ROW LEVEL SECURITY;
