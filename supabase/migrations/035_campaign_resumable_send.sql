-- =====================================================
-- 035_campaign_resumable_send.sql — make campaign fan-out durable & resumable
--
-- WHY: /api/campaigns/execute called processCampaign() WITHOUT awaiting it
-- ("fire-and-forget") and returned 201 immediately. On a serverless platform the
-- instance may be frozen or reclaimed the moment the response is flushed, so a
-- large broadcast is silently truncated part-way through — and because the
-- prepaid reservation is only released at the END of that loop, a truncated run
-- also strands the hold on the tenant's wallet.
--
-- This violates Law #4 (no synchronous/detached external I/O in a request
-- handler — handlers verify + persist + enqueue + return fast).
--
-- The fix moves the fan-out onto the existing job queue (lib/queue). A worker
-- can only rehydrate a campaign if everything it needs is PERSISTED, and three
-- things were being held in request memory only:
--   • variable_mapping  — how template variables bind to each contact
--   • reservation_id    — the prepaid hold to settle per success / release at end
--   • unit_cost_paise   — the resolved per-message price (rate table + markup),
--                         captured at send time so a mid-flight rate change
--                         cannot repnice an in-progress broadcast
-- plus billing_mode, so a worker never has to re-derive which model applied.
--
-- campaign_messages.recipient_name exists because CSV-uploaded recipients have
-- no contacts row (synthetic "csv-" ids were skipped entirely), so their name —
-- needed for template variables — had nowhere to live. Persisting it makes
-- campaign_messages the single source of truth for "who still needs sending",
-- which is what makes the worker resumable: it drives off status='pending'.
--
-- Money semantics are UNCHANGED. This migration only persists values that were
-- already being computed; it does not alter pricing, reservation or settlement.
--
-- ADDITIVE & SAFE; idempotent. No backfill of historical campaigns: completed
-- runs need none, and inventing a reservation_id for them would be fabricating
-- a money reference that never existed.
-- =====================================================

ALTER TABLE public.campaigns
  ADD COLUMN IF NOT EXISTS variable_mapping jsonb,
  ADD COLUMN IF NOT EXISTS reservation_id   uuid,
  ADD COLUMN IF NOT EXISTS unit_cost_paise  integer,
  ADD COLUMN IF NOT EXISTS billing_mode     text;

-- Guard the two value columns rather than trusting callers: a negative unit cost
-- would invert a debit, and billing_mode drives which wallet path runs at all.
ALTER TABLE public.campaigns DROP CONSTRAINT IF EXISTS chk_campaigns_unit_cost_nonneg;
ALTER TABLE public.campaigns
  ADD CONSTRAINT chk_campaigns_unit_cost_nonneg
  CHECK (unit_cost_paise IS NULL OR unit_cost_paise >= 0);

ALTER TABLE public.campaigns DROP CONSTRAINT IF EXISTS chk_campaigns_billing_mode;
ALTER TABLE public.campaigns
  ADD CONSTRAINT chk_campaigns_billing_mode
  CHECK (billing_mode IS NULL OR billing_mode IN ('byo', 'managed'));

ALTER TABLE public.campaign_messages
  ADD COLUMN IF NOT EXISTS recipient_name text;

-- The worker's hot query is "next N pending rows for this campaign". Partial
-- index: once a row leaves 'pending' it is never fetched this way again, so the
-- index stays small no matter how large the campaign history grows.
CREATE INDEX IF NOT EXISTS idx_campaign_messages_pending
  ON public.campaign_messages(campaign_id)
  WHERE status = 'pending';

-- Resuming must never re-send. The worker claims rows by flipping 'pending' to a
-- terminal status, so a duplicate (campaign_id, contact_id) row would be a
-- double-send AND a double-settle. Contact-backed rows are deduped and made
-- unique; CSV rows (contact_id IS NULL) are keyed on phone instead.
DELETE FROM public.campaign_messages t
USING (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY campaign_id, contact_id
           ORDER BY (meta_message_id IS NOT NULL) DESC, created_at DESC
         ) AS rn
  FROM public.campaign_messages
  WHERE contact_id IS NOT NULL
) d
WHERE t.id = d.id AND d.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS uq_campaign_messages_campaign_contact
  ON public.campaign_messages(campaign_id, contact_id)
  WHERE contact_id IS NOT NULL;

DELETE FROM public.campaign_messages t
USING (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY campaign_id, phone
           ORDER BY (meta_message_id IS NOT NULL) DESC, created_at DESC
         ) AS rn
  FROM public.campaign_messages
  WHERE contact_id IS NULL
) d
WHERE t.id = d.id AND d.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS uq_campaign_messages_campaign_phone
  ON public.campaign_messages(campaign_id, phone)
  WHERE contact_id IS NULL;

COMMENT ON COLUMN public.campaigns.reservation_id IS
  'Prepaid wallet hold for this broadcast (managed mode). Settled one unit per successful send; released once when the campaign finalises.';
COMMENT ON COLUMN public.campaigns.unit_cost_paise IS
  'Per-message price in integer paise, frozen at launch so an in-flight campaign cannot be repriced by a meta_rates change.';
