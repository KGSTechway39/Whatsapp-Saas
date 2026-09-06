-- =====================================================
-- 032_seed_origin_and_draft.sql — make seed adoption modellable
--
-- Two defects found by actually running the adoption path against this schema:
--
-- 1. `templates.status` CHECK allowed only ('APPROVED','PENDING','REJECTED').
--    A template copied from an industry seed kit has NOT been submitted to
--    Meta, so none of those three is true of it. 'PENDING' would be an active
--    lie — it means "Meta is reviewing this" — and would make the go-live
--    check "at least one template approved" unreachable while also implying a
--    submission that never happened. Add 'DRAFT'.
--
-- 2. Adoption was tracked by stuffing a key into `templates.variables` /
--    `automation_flows.flow_data`. `variables` is a JSON ARRAY, so that write
--    failed outright — and even where it worked (flow_data) it polluted a
--    payload the workflow engine owns. Provenance belongs in its own column.
--
-- `seed_origin_id` also makes "which tenants took this seed item?" a real
-- query, which the payload-stuffing approach could never answer.
--
-- ADDITIVE & SAFE; idempotent.
-- =====================================================

-- ── 1. DRAFT is a real template state ───────────────────────────────────────
ALTER TABLE public.templates DROP CONSTRAINT IF EXISTS templates_status_check;
ALTER TABLE public.templates
  ADD CONSTRAINT templates_status_check
    CHECK (status IN ('DRAFT','PENDING','APPROVED','REJECTED'));

-- ── 2. Provenance, as a column ──────────────────────────────────────────────
-- ON DELETE SET NULL: retiring a seed item must not delete a tenant's copy of
-- it. They own that row; we only remember where it came from.
ALTER TABLE public.templates
  ADD COLUMN IF NOT EXISTS seed_origin_id UUID
    REFERENCES public.vertical_template_library(id) ON DELETE SET NULL;

ALTER TABLE public.automation_flows
  ADD COLUMN IF NOT EXISTS seed_origin_id UUID
    REFERENCES public.vertical_template_library(id) ON DELETE SET NULL;

-- One copy of a given seed item per tenant — the DB enforces the idempotency
-- the service also checks, so a race between two admins clicking "Add" cannot
-- create a duplicate flow that then fires twice on the same keyword.
CREATE UNIQUE INDEX IF NOT EXISTS uq_templates_seed_origin
  ON public.templates(user_id, seed_origin_id) WHERE seed_origin_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_flows_seed_origin
  ON public.automation_flows(user_id, seed_origin_id) WHERE seed_origin_id IS NOT NULL;
