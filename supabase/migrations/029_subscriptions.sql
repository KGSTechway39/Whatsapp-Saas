-- =====================================================
-- 029_subscriptions.sql  —  create the `subscriptions` table on the deployed DB
--
-- WHY THIS EXISTS
-- `subscriptions` was only ever defined in the legacy single-file
-- supabase/schema.sql, which was never applied to the deployed project. The
-- numbered migrations (001…028) never created it. So the Razorpay
-- subscription code paths — /api/billing/create-subscription,
-- /api/billing/webhook, /api/billing/usage — have been writing to and reading
-- from a table that does not exist in production, and the admin overview
-- reports MRR as ₹0 with a "table not found" warning.
--
-- This is the same shape as the legacy definition, so nothing in the app needs
-- to change: one row per user (UNIQUE user_id — create-subscription does a
-- .single() lookup by user_id and upserts), keyed to Razorpay by
-- razorpay_subscription_id (the webhook's only handle on a row).
--
-- NOT BACKFILLED ON PURPOSE. No 'free' row is inserted for existing users:
-- a tenant with no row is "never subscribed", which is the truth, and is
-- exactly how /api/billing/usage already treats a missing row. Backfilling
-- would invent 1 active-subscription-per-user at ₹0 and inflate the count on
-- the admin dashboard.
--
-- Money note: no amount is stored here. What a plan costs lives in PLANS
-- (lib/razorpay.ts) and is the single source used to derive MRR — storing a
-- price copy here would be a second source of truth that silently goes stale
-- the day pricing changes.
--
-- ADDITIVE & SAFE; idempotent (IF NOT EXISTS throughout).
-- =====================================================

CREATE TABLE IF NOT EXISTS public.subscriptions (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- One subscription per tenant. The app relies on this: create-subscription
  -- looks the row up by user_id with .single() and updates it in place.
  user_id                  UUID NOT NULL UNIQUE REFERENCES public.users(id) ON DELETE CASCADE,
  -- A PlanId from lib/razorpay.ts: 'free' | 'starter_monthly' | 'starter_yearly'
  -- | 'growth_monthly' | 'growth_yearly' | 'pro_monthly' | 'pro_yearly'.
  -- Deliberately NOT constrained to that list — plans are added in code and a
  -- CHECK here would reject a new plan until a migration caught up.
  -- NOTE: these are NOT the values in plan_tiers.tier ('starter'/'growth'/
  -- 'enterprise'); the two pricing concepts are separate. Do not join them.
  plan_id                  TEXT NOT NULL DEFAULT 'free',
  billing_cycle            TEXT DEFAULT 'monthly'
                           CHECK (billing_cycle IN ('monthly', 'yearly')),
  -- Every value here is written by /api/billing/webhook: 'pending' on create,
  -- 'active' on subscription.activated/charged, 'past_due' on halt/payment
  -- failure, 'cancelled' on subscription.cancelled.
  status                   TEXT NOT NULL DEFAULT 'active'
                           CHECK (status IN ('active', 'pending', 'cancelled', 'past_due', 'trialing')),
  -- The webhook's ONLY join key back to a row — it matches on this, not user_id.
  razorpay_subscription_id TEXT UNIQUE,
  razorpay_customer_id     TEXT,
  current_period_start     TIMESTAMPTZ,
  current_period_end       TIMESTAMPTZ,
  cancel_at_period_end     BOOLEAN DEFAULT FALSE,
  created_at               TIMESTAMPTZ DEFAULT NOW(),
  updated_at               TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_subscriptions_user_id
  ON public.subscriptions(user_id);

-- The webhook resolves rows by Razorpay's id on every billing event.
CREATE INDEX IF NOT EXISTS idx_subscriptions_razorpay_id
  ON public.subscriptions(razorpay_subscription_id)
  WHERE razorpay_subscription_id IS NOT NULL;

-- The admin overview scans active rows to derive MRR.
CREATE INDEX IF NOT EXISTS idx_subscriptions_status
  ON public.subscriptions(status);

-- RLS: ENABLE + FORCE with NO policies — the same deny-all boundary used by
-- 022 and 027. All access is via SUPABASE_SERVICE_ROLE_KEY (server-only),
-- which bypasses RLS, so this locks the table to the anon/authenticated roles
-- with zero functional impact. Billing rows must never be client-readable.
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscriptions FORCE  ROW LEVEL SECURITY;
