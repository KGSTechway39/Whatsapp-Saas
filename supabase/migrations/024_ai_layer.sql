-- =====================================================
-- 024_ai_layer.sql  —  Optional AI-assist layer (SEPARATE from the message wallet)
--
-- Adds a config-driven AI accelerator over Campaign / Automation / Appointment
-- flows. Nothing here touches the message wallet (011), meta_rates (017), or the
-- send path. The manual flows stay the source of truth; AI only pre-fills drafts.
--
-- Two ledgers, never merged (rule 3):
--   • MESSAGE wallet  → integer PAISE, per-WhatsApp-message unit economics (011).
--   • AI CREDIT wallet (this file) → integer CREDITS, per-AI-action unit economics.
--     1 credit = 1 user-facing AI action (a campaign draft, a flow build, …).
--     Provider token cost is logged for MARGIN only (ai_usage_log), never billed
--     to the customer directly — customers see whole credits (rule 6).
--
-- Keyed by user_id — mirrors lib/billing/wallet.ts ("the deployed legacy tenant
-- model"). organization_id is captured on usage rows for flow-scoped attribution.
--
-- Config-driven routing (rule 4): model/provider/price live in ai_model_config,
-- editable at runtime via /api/admin/ai-config — never a redeploy, exactly like
-- meta_rates. Latest active row per task_type wins.
--
-- ADDITIVE & SAFE: no existing table is altered. Deploying the app before this
-- SQL is harmless — AIProviderService treats a missing config as "not configured"
-- and every AI entry point falls back cleanly to the manual flow (rule 8).
-- =====================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Task types the router knows about. CHECK (not a native enum) to match project
-- style (billing_mode, tier, …) and so adding a task_type is an ALTER, not a
-- fragile enum migration.
--   campaign_content         → mid-tier model, campaign copy pre-fill
--   automation_flow_builder  → stronger model, JSON flow (schema-validated)
--   automation_runtime_intent→ cheapest/fastest, inbound intent (backend only)
--   appointment_nl_parse     → cheap/fast, NL → structured booking
--   reminder_draft           → cheap/fast, reminder copy
--   template_content         → absorbs the legacy /api/templates/generate path

-- ── ai_model_config: provider/model/price/meter per task_type ────────────────
-- Versioned by effective_from + is_active, like meta_rates. The router reads the
-- newest active row for a task_type; flipping is_active=false dark-launches.
CREATE TABLE IF NOT EXISTS ai_model_config (
  id                            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  task_type                     TEXT NOT NULL
    CHECK (task_type IN (
      'campaign_content','automation_flow_builder','automation_runtime_intent',
      'appointment_nl_parse','reminder_draft','template_content')),
  provider                      TEXT NOT NULL,                     -- 'anthropic' | 'google' | 'gateway'
  model_id                      TEXT NOT NULL,                     -- e.g. 'claude-haiku-4-5' or 'google/gemini-2.5-flash'
  input_price_per_million_paise  BIGINT  NOT NULL DEFAULT 0 CHECK (input_price_per_million_paise  >= 0),
  output_price_per_million_paise BIGINT  NOT NULL DEFAULT 0 CHECK (output_price_per_million_paise >= 0),
  markup_multiplier             NUMERIC(6,2) NOT NULL DEFAULT 6.0 CHECK (markup_multiplier >= 1), -- 5–8x guidance (rule 6)
  credits_per_action            INTEGER NOT NULL DEFAULT 1 CHECK (credits_per_action >= 0),       -- customer-facing meter
  timeout_ms                    INTEGER NOT NULL DEFAULT 15000 CHECK (timeout_ms > 0),            -- runtime_intent = 2000
  max_regens                    INTEGER NOT NULL DEFAULT 5 CHECK (max_regens >= 0),               -- server-side cap (rule 7)
  is_active                     BOOLEAN NOT NULL DEFAULT TRUE,
  effective_from                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  note                          TEXT
);
CREATE INDEX IF NOT EXISTS idx_ai_model_config_lookup
  ON ai_model_config(task_type, is_active, effective_from DESC);

-- Seed defaults (rule 5). Provider = anthropic to match the SDK already wired in
-- (@anthropic-ai/sdk). Prices are placeholder paise/million (₹1≈8300 paise) —
-- admin-editable, never authoritative in code. Swap model_id to Gemini via config.
INSERT INTO ai_model_config
  (task_type, provider, model_id, input_price_per_million_paise, output_price_per_million_paise,
   credits_per_action, timeout_ms, max_regens, note) VALUES
  ('campaign_content',          'anthropic','claude-haiku-4-5',   8300,  41500, 1, 15000, 5, 'mid-tier, low volume'),
  ('automation_flow_builder',   'anthropic','claude-sonnet-4-6', 24900, 124500, 3, 30000, 3, 'structured JSON, correctness-critical'),
  ('automation_runtime_intent', 'anthropic','claude-haiku-4-5',   8300,  41500, 0,  2000, 0, 'highest volume, backend only, strict 2s'),
  ('appointment_nl_parse',      'anthropic','claude-haiku-4-5',   8300,  41500, 1,  8000, 3, 'cheap/fast NL parse'),
  ('reminder_draft',            'anthropic','claude-haiku-4-5',   8300,  41500, 1, 10000, 3, 'cheap/fast reminder copy'),
  ('template_content',          'anthropic','claude-sonnet-4-6', 24900, 124500, 0, 20000, 5, 'absorbs legacy /templates/generate — 0 credits preserves its free behaviour; flip to bill later')
ON CONFLICT DO NOTHING;

-- ── ai_credit_wallet: one row per user (mirrors wallet, but in CREDITS) ───────
CREATE TABLE IF NOT EXISTS ai_credit_wallet (
  user_id           UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  balance_credits   INTEGER NOT NULL DEFAULT 0 CHECK (balance_credits >= 0),  -- never negative (rule 3)
  monthly_quota     INTEGER NOT NULL DEFAULT 0,   -- credits granted each cycle (0 = none / top-up only)
  quota_reset_at    TIMESTAMPTZ,                  -- next monthly grant boundary
  trial_granted     BOOLEAN NOT NULL DEFAULT FALSE, -- starter one-time trial pool applied (rule/tier)
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── ai_credit_ledger: idempotent, one row per movement ───────────────────────
CREATE TABLE IF NOT EXISTS ai_credit_ledger (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  delta_credits   INTEGER NOT NULL,   -- signed: +grant/topup/refund, −debit
  balance_after   INTEGER NOT NULL,
  entry_type      TEXT NOT NULL CHECK (entry_type IN ('trial','grant','topup','quota_reset','debit','refund')),
  task_type       TEXT,               -- set on debit/refund
  ref_id          TEXT,               -- draft id / usage log id / payment ref
  idempotency_key TEXT,
  description     TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_ai_ledger_idem
  ON ai_credit_ledger(user_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ai_ledger_user ON ai_credit_ledger(user_id, created_at DESC);

-- ── ai_usage_log: the MARGIN truth (tokens + raw cost vs credits charged) ─────
-- Written on EVERY call outcome (ok|fallback|timeout|invalid|error) so we can see
-- provider spend even when nothing was billed (rule 6, margin visibility rule).
CREATE TABLE IF NOT EXISTS ai_usage_log (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  organization_id  UUID,                -- flow-scoped attribution when available
  task_type        TEXT NOT NULL,
  provider         TEXT,
  model_id         TEXT,
  tokens_in        INTEGER NOT NULL DEFAULT 0,
  tokens_out       INTEGER NOT NULL DEFAULT 0,
  raw_cost_paise   BIGINT  NOT NULL DEFAULT 0,   -- token cost pre-markup (margin denominator)
  credits_deducted INTEGER NOT NULL DEFAULT 0,   -- what the customer paid (0 on fallback)
  status           TEXT NOT NULL CHECK (status IN ('ok','fallback','timeout','invalid','error')),
  latency_ms       INTEGER,
  ref_id           TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ai_usage_user ON ai_usage_log(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_usage_task ON ai_usage_log(task_type, created_at DESC);

-- =====================================================
-- RPCs — mirror the wallet_* family: row-locked + idempotent, integer credits.
-- AI actions are atomic single calls, so there is no reserve/settle split;
-- ai_wallet_debit is the single debit-on-success path.
-- =====================================================

-- Ensure a wallet row exists (managed on first touch).
CREATE OR REPLACE FUNCTION _ai_wallet_ensure(p_user UUID)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO ai_credit_wallet (user_id) VALUES (p_user)
  ON CONFLICT (user_id) DO NOTHING;
END;
$$;

-- Idempotent credit (trial grant / monthly quota / top-up / refund).
CREATE OR REPLACE FUNCTION ai_wallet_credit(
  p_user    UUID,
  p_credits INTEGER,
  p_type    TEXT,               -- trial|grant|topup|quota_reset|refund
  p_idem    TEXT,
  p_task    TEXT DEFAULT NULL,
  p_ref     TEXT DEFAULT NULL,
  p_desc    TEXT DEFAULT NULL
) RETURNS INTEGER LANGUAGE plpgsql AS $$
DECLARE v_balance INTEGER;
BEGIN
  IF p_credits <= 0 THEN RAISE EXCEPTION 'INVALID_CREDITS'; END IF;
  IF p_type NOT IN ('trial','grant','topup','quota_reset','refund') THEN
    RAISE EXCEPTION 'INVALID_CREDIT_TYPE';
  END IF;

  -- Idempotency: already applied → return current balance unchanged.
  IF p_idem IS NOT NULL THEN
    PERFORM 1 FROM ai_credit_ledger WHERE user_id = p_user AND idempotency_key = p_idem LIMIT 1;
    IF FOUND THEN
      SELECT balance_credits INTO v_balance FROM ai_credit_wallet WHERE user_id = p_user;
      RETURN COALESCE(v_balance, 0);
    END IF;
  END IF;

  PERFORM _ai_wallet_ensure(p_user);
  SELECT balance_credits INTO v_balance FROM ai_credit_wallet WHERE user_id = p_user FOR UPDATE;

  v_balance := v_balance + p_credits;
  UPDATE ai_credit_wallet
    SET balance_credits = v_balance,
        trial_granted   = trial_granted OR (p_type = 'trial'),
        updated_at      = NOW()
  WHERE user_id = p_user;

  INSERT INTO ai_credit_ledger(user_id, delta_credits, balance_after, entry_type,
                               task_type, ref_id, idempotency_key, description)
  VALUES (p_user, p_credits, v_balance, p_type, p_task, p_ref, p_idem, p_desc);
  RETURN v_balance;
END;
$$;

-- Idempotent debit on a successful AI action. Hard stop at zero.
CREATE OR REPLACE FUNCTION ai_wallet_debit(
  p_user    UUID,
  p_credits INTEGER,
  p_idem    TEXT,
  p_task    TEXT DEFAULT NULL,
  p_ref     TEXT DEFAULT NULL,
  p_desc    TEXT DEFAULT NULL
) RETURNS INTEGER LANGUAGE plpgsql AS $$
DECLARE v_balance INTEGER;
BEGIN
  IF p_credits < 0 THEN RAISE EXCEPTION 'INVALID_CREDITS'; END IF;

  -- Idempotency: replayed debit → return the balance we recorded then.
  IF p_idem IS NOT NULL THEN
    SELECT balance_after INTO v_balance
    FROM ai_credit_ledger WHERE user_id = p_user AND idempotency_key = p_idem LIMIT 1;
    IF FOUND THEN RETURN v_balance; END IF;
  END IF;

  PERFORM _ai_wallet_ensure(p_user);
  SELECT balance_credits INTO v_balance FROM ai_credit_wallet WHERE user_id = p_user FOR UPDATE;
  v_balance := COALESCE(v_balance, 0);

  IF v_balance < p_credits THEN
    RAISE EXCEPTION 'INSUFFICIENT_AI_CREDITS'
      USING DETAIL = format('need %s, have %s', p_credits, v_balance);
  END IF;

  v_balance := v_balance - p_credits;
  UPDATE ai_credit_wallet SET balance_credits = v_balance, updated_at = NOW()
  WHERE user_id = p_user;

  IF p_credits > 0 THEN
    INSERT INTO ai_credit_ledger(user_id, delta_credits, balance_after, entry_type,
                                 task_type, ref_id, idempotency_key, description)
    VALUES (p_user, -p_credits, v_balance, 'debit', p_task, p_ref, p_idem, p_desc);
  END IF;
  RETURN v_balance;
END;
$$;

-- ── RLS: config + wallet + ledger + usage are server-only (service role bypass) ─
ALTER TABLE ai_model_config  ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_model_config  FORCE  ROW LEVEL SECURITY;
ALTER TABLE ai_credit_wallet ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_credit_wallet FORCE  ROW LEVEL SECURITY;
ALTER TABLE ai_credit_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_credit_ledger FORCE  ROW LEVEL SECURITY;
ALTER TABLE ai_usage_log     ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_usage_log     FORCE  ROW LEVEL SECURITY;
