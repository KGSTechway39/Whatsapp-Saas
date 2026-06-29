-- =====================================================
-- 018_business_profile.sql  —  Capture onboarding business details on the user row
--
-- Populated from the pre-signup form (DetailsBlock in EmbeddedSignupModal) so we
-- keep the business name / category / city even if the user bails before they
-- finish Meta's Embedded Signup. Additive & safe (all nullable, IF NOT EXISTS).
-- =====================================================

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS business_name     TEXT,
  ADD COLUMN IF NOT EXISTS business_category TEXT,   -- WhatsApp vertical code (e.g. RETAIL)
  ADD COLUMN IF NOT EXISTS city              TEXT,
  ADD COLUMN IF NOT EXISTS onboarding_path   TEXT
    CHECK (onboarding_path IN ('A','B','C'));
