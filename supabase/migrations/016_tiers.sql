-- =====================================================
-- 016_tiers.sql  —  First-class product tiers (Starter / Growth / Enterprise)
--
-- Makes "tier" the single source of truth for a user's product plan. Tier
-- DERIVES two existing/new axes that the send paths already read:
--
--   tier        billing_mode   waba_mode   meaning
--   ----------  -------------  ----------  ---------------------------------------
--   starter     managed        shared      Model C — under the platform's WABA, capped
--   growth      managed        own         Model B — own WABA, credits billed via us
--   enterprise  byo            own         Model A — own WABA, client pays Meta direct
--
-- ADDITIVE & SAFE:
--   • billing_mode (from 011) is kept and stays the value the send path reads;
--     app-layer setTier() writes tier + billing_mode + waba_mode together.
--   • Existing users are backfilled from their current billing_mode, so behaviour
--     is unchanged: every current user is byo → enterprise.
--   • Default for NEW rows is 'enterprise' (= byo) on purpose: it's the only tier
--     that needs no prepaid balance / no shared WABA, so it can never strand a
--     fresh signup. Self-serve Starter/Growth assignment lands with Model C.
-- =====================================================

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS tier TEXT NOT NULL DEFAULT 'enterprise'
    CHECK (tier IN ('starter','growth','enterprise')),
  ADD COLUMN IF NOT EXISTS waba_mode TEXT NOT NULL DEFAULT 'own'
    CHECK (waba_mode IN ('own','shared'));

-- Backfill existing rows from billing_mode (all current users are byo → enterprise).
UPDATE users
  SET tier = CASE billing_mode WHEN 'managed' THEN 'growth' ELSE 'enterprise' END,
      waba_mode = 'own'
  WHERE tier IS NULL OR tier = 'enterprise';  -- safe to re-run

CREATE INDEX IF NOT EXISTS idx_users_tier ON users(tier);
