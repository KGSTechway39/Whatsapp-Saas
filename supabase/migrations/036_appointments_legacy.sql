-- =====================================================
-- 036_appointments_legacy.sql — appointments, on the model that is actually live
--
-- WHY: `appointments` was defined in 001 and 009, but both key it on
-- `organization_id` — the organization model that was CODED BUT NEVER DEPLOYED
-- (see CLAUDE.md "Deployment reality"). So no appointments table exists in
-- production at all, and the /appointments screen has been running on a
-- hardcoded DEMO_APPOINTMENTS array in React state: nothing was ever persisted.
--
-- This creates the table on the LEGACY user_id model that campaigns, contacts,
-- automations and conversations already use, so it is reachable by the code that
-- actually runs.
--
-- ─── DESIGN DECISIONS (defaults chosen deliberately; each is easy to revisit) ──
--
-- 1. starts_at is a single TIMESTAMPTZ, not date + time columns.
--    A reminder has to fire at a precise instant. Splitting the value means
--    every reader re-assembles it against some timezone, and they will not all
--    pick the same one. `display_timezone` is stored alongside so the UI can
--    render the tenant's local wall-clock without that ambiguity.
--
-- 2. display_timezone defaults to Asia/Kolkata.
--    SendAnjal's market is Indian SMBs. Stored per row rather than per tenant so
--    a business operating across zones is not forced into one.
--
-- 3. Reminders are three separate nullable timestamps, not booleans.
--    NULL means "not sent yet", which makes the sweep naturally idempotent:
--    it selects WHERE reminder_24h_sent_at IS NULL. A boolean loses WHEN it was
--    sent, which is exactly what you want when a customer disputes a no-show.
--
-- 4. Double-booking is ALLOWED.
--    No exclusion constraint on overlapping times. Small businesses deliberately
--    overlap (a clinic runs three chairs; a shop takes walk-ins). The API
--    reports conflicts so the UI can warn, but the database does not refuse.
--
-- 5. Cancellation is a status change, never a DELETE.
--    no_show and cancelled are the two states an owner most needs history for.
--
-- 6. RLS: ENABLE + FORCE with NO policies — the house pattern (022, 027).
--    Every read/write goes through the service-role client server-side, which
--    bypasses RLS; this is a deny-all boundary for anon/authenticated.
--
-- ADDITIVE & SAFE; idempotent. Creates nothing that existed before.
-- =====================================================

CREATE TABLE IF NOT EXISTS public.appointments (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id               UUID NOT NULL REFERENCES public.users(id)    ON DELETE CASCADE,
  -- Nullable: an appointment can be booked for a walk-in who is not yet a
  -- contact. contact_name/phone are therefore the authoritative display values.
  contact_id            UUID          REFERENCES public.contacts(id) ON DELETE SET NULL,
  contact_name          TEXT NOT NULL,
  contact_phone         TEXT NOT NULL,

  service               TEXT NOT NULL DEFAULT 'consultation'
                        CHECK (service IN ('consultation','follow_up','demo','checkup','meeting','callback')),
  title                 TEXT,
  notes                 TEXT,
  assigned_to           TEXT,

  starts_at             TIMESTAMPTZ NOT NULL,
  duration_minutes      INTEGER NOT NULL DEFAULT 30 CHECK (duration_minutes > 0 AND duration_minutes <= 1440),
  display_timezone      TEXT NOT NULL DEFAULT 'Asia/Kolkata',

  status                TEXT NOT NULL DEFAULT 'scheduled'
                        CHECK (status IN ('scheduled','confirmed','completed','cancelled','no_show','rescheduled')),

  -- Outbound touchpoints. NULL = not sent; the value is the audit trail.
  confirmation_sent_at  TIMESTAMPTZ,
  reminder_24h_sent_at  TIMESTAMPTZ,
  reminder_1h_sent_at   TIMESTAMPTZ,
  follow_up_sent_at     TIMESTAMPTZ,

  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- The screen's main query: this tenant's appointments over a date range.
CREATE INDEX IF NOT EXISTS idx_appointments_user_starts
  ON public.appointments(user_id, starts_at);

CREATE INDEX IF NOT EXISTS idx_appointments_contact
  ON public.appointments(contact_id) WHERE contact_id IS NOT NULL;

-- The reminder sweep's hot queries. Partial indexes so they stay small: a row
-- drops out of each one permanently once its reminder has gone.
CREATE INDEX IF NOT EXISTS idx_appointments_due_24h
  ON public.appointments(starts_at)
  WHERE reminder_24h_sent_at IS NULL AND status IN ('scheduled','confirmed');

CREATE INDEX IF NOT EXISTS idx_appointments_due_1h
  ON public.appointments(starts_at)
  WHERE reminder_1h_sent_at IS NULL AND status IN ('scheduled','confirmed');

-- Reuse the shared updated_at trigger if this database has it (026 defines it
-- with CREATE OR REPLACE). Guarded so the migration still applies where it does not.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'touch_updated_at') THEN
    DROP TRIGGER IF EXISTS trg_appointments_updated_at ON public.appointments;
    CREATE TRIGGER trg_appointments_updated_at
      BEFORE UPDATE ON public.appointments
      FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
  END IF;
END $$;

ALTER TABLE public.appointments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.appointments FORCE  ROW LEVEL SECURITY;

COMMENT ON COLUMN public.appointments.starts_at IS
  'Authoritative instant of the appointment. Reminders are scheduled off this; display_timezone is for rendering only.';
COMMENT ON COLUMN public.appointments.reminder_24h_sent_at IS
  'NULL until the 24h reminder is delivered. The sweep selects on NULL, which is what makes it idempotent.';
