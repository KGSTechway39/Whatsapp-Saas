-- =====================================================
-- 030_support_tickets.sql  —  support ticketing for the Tenant Admin console
--
-- WHY: the ops/support console needs a queue of tenant problems ("webhook not
-- receiving replies", "template rejected by Meta", "number stuck on Embedded
-- Signup"). Nothing in the schema modelled this — support was happening
-- outside the product entirely.
--
-- SCOPE: platform-side support. A ticket ALWAYS belongs to one tenant
-- (user_id) so ops can see whose problem it is, and is worked by platform
-- staff. It is deliberately not a client-facing helpdesk — no client UI reads
-- this table, and RLS keeps it server-only.
--
-- The category list mirrors where tenants actually get stuck in this product
-- (onboarding/ESU, number connection, template approval, billing/wallet,
-- webhooks, public API) — those buckets make the queue triageable instead of
-- being one undifferentiated pile.
--
-- ADDITIVE & SAFE; idempotent.
-- =====================================================

CREATE TABLE IF NOT EXISTS public.support_tickets (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- The tenant this ticket is ABOUT. Not nullable: a support ticket with no
  -- tenant can't be triaged, routed, or measured.
  user_id      UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,

  subject      TEXT NOT NULL,
  body         TEXT NOT NULL DEFAULT '',

  category     TEXT NOT NULL DEFAULT 'other'
               CHECK (category IN ('onboarding','number','template','billing','webhook','api','other')),
  priority     TEXT NOT NULL DEFAULT 'medium'
               CHECK (priority IN ('low','medium','high','urgent')),
  -- 'waiting' = blocked on the tenant or on Meta, which is NOT the same as
  -- in_progress. Without it, everything parked on a third party looks active
  -- and the queue stops telling ops the truth about what they can act on.
  status       TEXT NOT NULL DEFAULT 'open'
               CHECK (status IN ('open','in_progress','waiting','resolved','closed')),

  -- Platform staff. NULL = unassigned (the triage queue).
  assigned_to  UUID REFERENCES public.users(id) ON DELETE SET NULL,
  -- Who opened it — staff logging a call, or the tenant later on.
  created_by   UUID REFERENCES public.users(id) ON DELETE SET NULL,

  -- Set when status first becomes resolved/closed; drives time-to-resolution.
  resolved_at  TIMESTAMPTZ,

  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- The console's default view is "everything still open, worst first".
CREATE INDEX IF NOT EXISTS idx_support_tickets_open
  ON public.support_tickets(priority, created_at DESC)
  WHERE status IN ('open','in_progress','waiting');

CREATE INDEX IF NOT EXISTS idx_support_tickets_user
  ON public.support_tickets(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_support_tickets_status
  ON public.support_tickets(status);

-- RLS: ENABLE + FORCE with NO policies — the deny-all boundary used by 022,
-- 027 and 029. Access is exclusively via SUPABASE_SERVICE_ROLE_KEY behind
-- requireAdmin(). Ticket bodies describe other tenants' problems, so this
-- table must never be reachable with the anon key.
ALTER TABLE public.support_tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.support_tickets FORCE  ROW LEVEL SECURITY;
