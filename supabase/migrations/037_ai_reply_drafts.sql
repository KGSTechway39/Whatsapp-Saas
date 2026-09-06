-- =====================================================
-- 037_ai_reply_drafts.sql — make the flow "AI Reply" node actually usable
--
-- TWO PROBLEMS, BOTH OF WHICH MADE THE NODE DEAD WEIGHT:
--
-- 1. It could never be configured. `ai_model_config.task_type` carries a CHECK
--    listing six task types, and 'automation_ai_reply' is not one of them — so
--    no config row could exist, loadModelConfig() always returned null, and
--    runTask() always degraded to `not_configured`. The node has never once run.
--
-- 2. Its output had nowhere to go. The node deliberately does not send (the
--    platform rule is that AI drafts and a human sends — correct), but the draft
--    was only pushed into an in-memory execution log and then dropped. Simply
--    fixing (1) would have meant spending a tenant's AI credits to generate text
--    that nobody ever sees. Worse than leaving it off.
--
-- So this migration widens the constraint AND gives drafts somewhere to land.
--
-- WHY A SEPARATE TABLE RATHER THAN messages.status = 'draft':
-- `messages` is what the inbox renders, what analytics counts, and what the
-- delivery-status webhook updates. A draft row in there would be counted as a
-- real message by code that predates the idea of drafts. A separate table
-- cannot be mistaken for something that was sent.
--
-- The seeded config row is DELIBERATELY is_active = false: switching it on
-- starts spending AI credits on live customer conversations, which is a margin
-- decision for the operator to make in /admin/ai-config, not one to inherit
-- silently from a migration.
--
-- ADDITIVE & SAFE; idempotent.
-- =====================================================

-- ── 1. Let the task type be configured at all ────────────────────────────────
ALTER TABLE public.ai_model_config DROP CONSTRAINT IF EXISTS ai_model_config_task_type_check;
ALTER TABLE public.ai_model_config
  ADD CONSTRAINT ai_model_config_task_type_check
  CHECK (task_type = ANY (ARRAY[
    'campaign_content',
    'automation_flow_builder',
    'automation_runtime_intent',
    'appointment_nl_parse',
    'reminder_draft',
    'template_content',
    'automation_ai_reply'
  ]));

-- ── 2. Somewhere for a draft to land ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ai_drafts (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id         UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  conversation_id UUID REFERENCES public.conversations(id) ON DELETE CASCADE,
  contact_id      UUID REFERENCES public.contacts(id)      ON DELETE SET NULL,

  -- Provenance: which flow and node produced this, so an owner can tell why a
  -- suggestion appeared and switch off the node that keeps getting it wrong.
  flow_id         UUID,
  node_id         TEXT,
  source          TEXT NOT NULL DEFAULT 'automation_ai_reply',

  body            TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','sent','dismissed','expired')),
  sent_message_id UUID,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at     TIMESTAMPTZ
);

-- The inbox's query: outstanding suggestions for a conversation.
CREATE INDEX IF NOT EXISTS idx_ai_drafts_pending
  ON public.ai_drafts(conversation_id)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_ai_drafts_user
  ON public.ai_drafts(user_id, created_at DESC);

-- One outstanding suggestion per flow node per conversation. Re-running a flow
-- must not stack up duplicate drafts for an agent to wade through; the engine
-- upserts on this.
CREATE UNIQUE INDEX IF NOT EXISTS uq_ai_drafts_pending_node
  ON public.ai_drafts(conversation_id, flow_id, node_id)
  WHERE status = 'pending';

ALTER TABLE public.ai_drafts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_drafts FORCE  ROW LEVEL SECURITY;

-- ── 3. Configure the task, switched OFF ──────────────────────────────────────
-- Haiku: this runs inside a live conversation, so latency matters more than
-- depth. Prices are paise per million tokens and match Haiku 4.5's $1/$5 at the
-- same 83 paise-per-cent basis the other rows use — NOT hardcoded Meta rates
-- (Law #2 is about meta_rates; AI pricing is its own table and is editable in
-- /admin/ai-config without a redeploy).
INSERT INTO public.ai_model_config (
  task_type, provider, model_id,
  input_price_per_million_paise, output_price_per_million_paise,
  markup_multiplier, credits_per_action, timeout_ms, max_regens, is_active, note
)
SELECT
  'automation_ai_reply', 'anthropic', 'claude-haiku-4-5',
  8300, 41500,
  6.00, 1, 10000, 0, FALSE,
  'Drafts a reply inside a live flow; never sends. OFF by default — enabling it spends credits on customer conversations.'
WHERE NOT EXISTS (
  SELECT 1 FROM public.ai_model_config WHERE task_type = 'automation_ai_reply'
);

COMMENT ON TABLE public.ai_drafts IS
  'AI-generated reply suggestions awaiting human review. Never sent automatically — the platform rule is that AI drafts and a human sends.';
