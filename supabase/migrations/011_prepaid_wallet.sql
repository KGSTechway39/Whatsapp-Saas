-- =====================================================
-- 011_prepaid_wallet.sql  —  Phase 4 / M1: Money core (LEGACY user_id model)
--
-- Prepaid credit wallet for the MANAGED (Model A) billing track, attached to
-- the *deployed* legacy schema (users / wallet / transactions, keyed by user_id).
--
--   • Integer paise only (1 credit = ₹1 = 100 paise). No floats in new code.
--   • Never negative. Hard stop at zero (reservations guard the balance).
--   • Row-locked (SELECT … FOR UPDATE on the wallet row) — no double-spend.
--   • Ledger-backed + idempotency keys — duplicate webhooks credit once.
--
-- ADDITIVE & SAFE:
--   • Existing columns (wallet.balance, transactions.type/amount/balance_after)
--     are kept and mirrored for backward-compatible display. New code uses the
--     *_paise columns + the RPCs below as the source of truth.
--   • BYO users (billing_mode='byo', the default) are never touched by this.
-- =====================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ── users: billing mode flag ────────────────────────────────────────────────
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS billing_mode TEXT NOT NULL DEFAULT 'byo'
    CHECK (billing_mode IN ('byo','managed'));

-- ── wallet: integer-paise balance (canonical) ───────────────────────────────
ALTER TABLE wallet
  ADD COLUMN IF NOT EXISTS balance_paise               BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS low_balance_threshold_paise BIGINT NOT NULL DEFAULT 0;

-- ── transactions: richer ledger columns ─────────────────────────────────────
-- Legacy columns (type CHECK('credit','debit'), amount, balance_after, description)
-- are still populated for backward compatibility; new code reads the *_paise cols.
ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS entry_type          TEXT,    -- recharge|debit|refund|bonus
  ADD COLUMN IF NOT EXISTS amount_paise        BIGINT,  -- signed: +credit / -debit
  ADD COLUMN IF NOT EXISTS balance_after_paise BIGINT,
  ADD COLUMN IF NOT EXISTS idempotency_key     TEXT,
  ADD COLUMN IF NOT EXISTS reservation_id      UUID;

-- One ledger row per idempotency key, per user → retried webhook/send applies once.
CREATE UNIQUE INDEX IF NOT EXISTS uq_txn_idem
  ON transactions(user_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- ── message_pricing: category-based per-message cost (paise) ─────────────────
CREATE TABLE IF NOT EXISTS message_pricing (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID REFERENCES users(id) ON DELETE CASCADE,  -- NULL = platform default
  category    TEXT NOT NULL
              CHECK (category IN ('MARKETING','UTILITY','AUTHENTICATION','SERVICE')),
  price_paise BIGINT NOT NULL CHECK (price_paise >= 0),
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (user_id, category)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_message_pricing_default
  ON message_pricing(category) WHERE user_id IS NULL;

INSERT INTO message_pricing (user_id, category, price_paise) VALUES
  (NULL, 'MARKETING',      88),
  (NULL, 'UTILITY',        16),
  (NULL, 'AUTHENTICATION', 30),
  (NULL, 'SERVICE',         0)
ON CONFLICT DO NOTHING;

-- ── wallet_reservations: holds against the balance for broadcasts ────────────
CREATE TABLE IF NOT EXISTS wallet_reservations (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  held_paise      BIGINT NOT NULL CHECK (held_paise >= 0),
  consumed_paise  BIGINT NOT NULL DEFAULT 0 CHECK (consumed_paise >= 0),
  status          TEXT NOT NULL DEFAULT 'held' CHECK (status IN ('held','closed')),
  reference_id    TEXT,
  idempotency_key TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  closed_at       TIMESTAMPTZ,
  CHECK (consumed_paise <= held_paise)
);

CREATE INDEX IF NOT EXISTS idx_wallet_resv_user
  ON wallet_reservations(user_id) WHERE status = 'held';
CREATE UNIQUE INDEX IF NOT EXISTS uq_wallet_resv_idem
  ON wallet_reservations(user_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- =====================================================
-- HELPER: spendable = balance − open holds (paise)
-- =====================================================
CREATE OR REPLACE FUNCTION wallet_open_holds_paise(p_user UUID)
RETURNS BIGINT LANGUAGE sql STABLE AS $$
  SELECT COALESCE(SUM(held_paise - consumed_paise), 0)::BIGINT
  FROM wallet_reservations
  WHERE user_id = p_user AND status = 'held';
$$;

-- Ensure a wallet row exists for a user (managed users get one on first touch).
CREATE OR REPLACE FUNCTION _wallet_ensure(p_user UUID)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO wallet (user_id, balance, balance_paise)
  VALUES (p_user, 0, 0)
  ON CONFLICT (user_id) DO NOTHING;
END;
$$;

-- Internal: write a balance-affecting ledger row + mirror the legacy columns.
CREATE OR REPLACE FUNCTION _wallet_ledger_write(
  p_user          UUID,
  p_entry_type    TEXT,      -- recharge|debit|refund|bonus
  p_amount_paise  BIGINT,    -- signed
  p_balance_paise BIGINT,
  p_desc          TEXT,
  p_ref           TEXT,
  p_idem          TEXT,
  p_resv          UUID,
  p_method        TEXT
) RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  v_legacy_type TEXT := CASE WHEN p_entry_type = 'debit' THEN 'debit' ELSE 'credit' END;
BEGIN
  INSERT INTO transactions(
    user_id, type, description, amount, balance_after,
    entry_type, amount_paise, balance_after_paise,
    idempotency_key, reservation_id, payment_method
  ) VALUES (
    p_user, v_legacy_type, COALESCE(p_desc, p_entry_type),
    (p_amount_paise / 100.0), (p_balance_paise / 100.0),
    p_entry_type, p_amount_paise, p_balance_paise,
    p_idem, p_resv, p_method
  );
END;
$$;

-- =====================================================
-- RPC: wallet_credit — idempotent top-up / refund / bonus
-- =====================================================
CREATE OR REPLACE FUNCTION wallet_credit(
  p_user         UUID,
  p_amount_paise BIGINT,
  p_type         TEXT,            -- recharge|refund|bonus
  p_idem         TEXT,
  p_desc         TEXT DEFAULT NULL,
  p_method       TEXT DEFAULT NULL
) RETURNS BIGINT LANGUAGE plpgsql AS $$
DECLARE v_balance BIGINT;
BEGIN
  IF p_amount_paise <= 0 THEN RAISE EXCEPTION 'INVALID_AMOUNT'; END IF;
  IF p_type NOT IN ('recharge','refund','bonus') THEN RAISE EXCEPTION 'INVALID_CREDIT_TYPE'; END IF;

  -- Idempotency: if this key already applied, return current balance unchanged.
  IF p_idem IS NOT NULL THEN
    PERFORM 1 FROM transactions WHERE user_id = p_user AND idempotency_key = p_idem LIMIT 1;
    IF FOUND THEN
      SELECT balance_paise INTO v_balance FROM wallet WHERE user_id = p_user;
      RETURN COALESCE(v_balance, 0);
    END IF;
  END IF;

  PERFORM _wallet_ensure(p_user);

  SELECT balance_paise INTO v_balance FROM wallet WHERE user_id = p_user FOR UPDATE;

  v_balance := v_balance + p_amount_paise;
  UPDATE wallet
    SET balance_paise = v_balance,
        balance       = v_balance / 100.0,
        updated_at    = NOW()
  WHERE user_id = p_user;

  PERFORM _wallet_ledger_write(p_user, p_type, p_amount_paise, v_balance,
                               p_desc, NULL, p_idem, NULL, p_method);
  RETURN v_balance;
END;
$$;

-- =====================================================
-- RPC: wallet_reserve — hard-stop hold for a broadcast
-- =====================================================
CREATE OR REPLACE FUNCTION wallet_reserve(
  p_user         UUID,
  p_amount_paise BIGINT,
  p_ref          TEXT DEFAULT NULL,
  p_idem         TEXT DEFAULT NULL
) RETURNS UUID LANGUAGE plpgsql AS $$
DECLARE v_balance BIGINT; v_holds BIGINT; v_resv UUID;
BEGIN
  IF p_amount_paise <= 0 THEN RAISE EXCEPTION 'INVALID_AMOUNT'; END IF;

  IF p_idem IS NOT NULL THEN
    SELECT id INTO v_resv FROM wallet_reservations
    WHERE user_id = p_user AND idempotency_key = p_idem LIMIT 1;
    IF FOUND THEN RETURN v_resv; END IF;
  END IF;

  -- Lock the wallet row so concurrent reserves can't both pass the check.
  SELECT balance_paise INTO v_balance FROM wallet WHERE user_id = p_user FOR UPDATE;
  v_balance := COALESCE(v_balance, 0);
  v_holds   := wallet_open_holds_paise(p_user);

  -- HARD STOP: spendable (balance − open holds) must cover the new hold.
  IF (v_balance - v_holds) < p_amount_paise THEN
    RAISE EXCEPTION 'INSUFFICIENT_BALANCE'
      USING DETAIL = format('need %s, spendable %s', p_amount_paise, v_balance - v_holds);
  END IF;

  INSERT INTO wallet_reservations(user_id, held_paise, reference_id, idempotency_key)
  VALUES (p_user, p_amount_paise, p_ref, p_idem)
  RETURNING id INTO v_resv;
  RETURN v_resv;
END;
$$;

-- =====================================================
-- RPC: wallet_settle — consume part of a reservation (one send), idempotent
-- =====================================================
CREATE OR REPLACE FUNCTION wallet_settle(
  p_resv         UUID,
  p_actual_paise BIGINT,
  p_unit_idem    TEXT,
  p_desc         TEXT DEFAULT NULL,
  p_ref          TEXT DEFAULT NULL
) RETURNS BIGINT LANGUAGE plpgsql AS $$
DECLARE v_user UUID; v_held BIGINT; v_consumed BIGINT; v_status TEXT; v_balance BIGINT;
BEGIN
  IF p_actual_paise < 0 THEN RAISE EXCEPTION 'INVALID_AMOUNT'; END IF;

  IF p_unit_idem IS NOT NULL THEN
    PERFORM 1 FROM transactions WHERE reservation_id = p_resv AND idempotency_key = p_unit_idem LIMIT 1;
    IF FOUND THEN
      SELECT w.balance_paise INTO v_balance
      FROM wallet_reservations r JOIN wallet w ON w.user_id = r.user_id WHERE r.id = p_resv;
      RETURN v_balance;
    END IF;
  END IF;

  SELECT user_id, held_paise, consumed_paise, status
    INTO v_user, v_held, v_consumed, v_status
  FROM wallet_reservations WHERE id = p_resv FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'RESERVATION_NOT_FOUND'; END IF;
  IF v_status <> 'held' THEN RAISE EXCEPTION 'RESERVATION_CLOSED'; END IF;
  IF v_consumed + p_actual_paise > v_held THEN RAISE EXCEPTION 'RESERVATION_OVERRUN'; END IF;

  SELECT balance_paise INTO v_balance FROM wallet WHERE user_id = v_user FOR UPDATE;
  v_balance := v_balance - p_actual_paise;   -- safe: actual ≤ held ≤ spendable-at-reserve
  UPDATE wallet
    SET balance_paise = v_balance, balance = v_balance / 100.0, updated_at = NOW()
  WHERE user_id = v_user;

  UPDATE wallet_reservations SET consumed_paise = consumed_paise + p_actual_paise WHERE id = p_resv;

  IF p_actual_paise > 0 THEN
    PERFORM _wallet_ledger_write(v_user, 'debit', -p_actual_paise, v_balance,
                                 p_desc, p_ref, p_unit_idem, p_resv, NULL);
  END IF;
  RETURN v_balance;
END;
$$;

-- =====================================================
-- RPC: wallet_release — close a reservation, free the unused hold (idempotent)
-- =====================================================
CREATE OR REPLACE FUNCTION wallet_release(p_resv UUID)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_status TEXT;
BEGIN
  SELECT status INTO v_status FROM wallet_reservations WHERE id = p_resv FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'RESERVATION_NOT_FOUND'; END IF;
  IF v_status = 'closed' THEN RETURN; END IF;
  UPDATE wallet_reservations SET status = 'closed', closed_at = NOW() WHERE id = p_resv;
END;
$$;

-- =====================================================
-- RPC: wallet_charge — fast path for a single send (reserve+settle atomic)
-- =====================================================
CREATE OR REPLACE FUNCTION wallet_charge(
  p_user         UUID,
  p_amount_paise BIGINT,
  p_idem         TEXT,
  p_desc         TEXT DEFAULT NULL,
  p_ref          TEXT DEFAULT NULL
) RETURNS BIGINT LANGUAGE plpgsql AS $$
DECLARE v_balance BIGINT; v_holds BIGINT;
BEGIN
  IF p_amount_paise < 0 THEN RAISE EXCEPTION 'INVALID_AMOUNT'; END IF;

  IF p_idem IS NOT NULL THEN
    SELECT balance_after_paise INTO v_balance
    FROM transactions WHERE user_id = p_user AND idempotency_key = p_idem LIMIT 1;
    IF FOUND THEN RETURN v_balance; END IF;
  END IF;

  SELECT balance_paise INTO v_balance FROM wallet WHERE user_id = p_user FOR UPDATE;
  v_balance := COALESCE(v_balance, 0);
  v_holds   := wallet_open_holds_paise(p_user);
  IF (v_balance - v_holds) < p_amount_paise THEN
    RAISE EXCEPTION 'INSUFFICIENT_BALANCE'
      USING DETAIL = format('need %s, spendable %s', p_amount_paise, v_balance - v_holds);
  END IF;

  v_balance := v_balance - p_amount_paise;
  UPDATE wallet
    SET balance_paise = v_balance, balance = v_balance / 100.0, updated_at = NOW()
  WHERE user_id = p_user;

  IF p_amount_paise > 0 THEN
    PERFORM _wallet_ledger_write(p_user, 'debit', -p_amount_paise, v_balance,
                                 p_desc, p_ref, p_idem, NULL, NULL);
  END IF;
  RETURN v_balance;
END;
$$;
