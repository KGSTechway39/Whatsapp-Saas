-- =====================================================
-- prepaid_wallet_test.sql  —  M1 money-core tests (legacy user_id model)
--
-- Pure-SQL assertions (no JS test runner needed). Run against a Postgres
-- that has had the legacy schema + migration 011 applied:
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/prepaid_wallet_test.sql
--
-- Wrapped in a transaction and ROLLED BACK at the end — leaves no data.
-- =====================================================
BEGIN;

DO $$
DECLARE
  v_user UUID;
  v_bal  BIGINT;
  v_sum  BIGINT;
  v_resv UUID;
  v_err  TEXT;
BEGIN
  -- Fixture: a managed user with an empty wallet.
  INSERT INTO users(email, password_hash, full_name, billing_mode)
  VALUES ('wallet-test-' || gen_random_uuid() || '@example.com', 'x', 'Wallet Test', 'managed')
  RETURNING id INTO v_user;

  -- T1: duplicate webhook credits exactly once
  v_bal := wallet_credit(v_user, 10000, 'recharge', 'evt_abc', 'top-up', 'razorpay'); -- ₹100
  ASSERT v_bal = 10000, format('T1a expected 10000, got %s', v_bal);
  v_bal := wallet_credit(v_user, 10000, 'recharge', 'evt_abc', 'top-up', 'razorpay'); -- replay
  ASSERT v_bal = 10000, format('T1b duplicate credit changed balance: %s', v_bal);

  -- T2: insufficient balance blocks (hard stop), never negative
  BEGIN
    PERFORM wallet_charge(v_user, 15000, 'over_1', 'too big');
    ASSERT FALSE, 'T2 expected INSUFFICIENT_BALANCE';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
    ASSERT v_err = 'INSUFFICIENT_BALANCE', format('T2 wrong error: %s', v_err);
  END;
  SELECT balance_paise INTO v_bal FROM wallet WHERE user_id = v_user;
  ASSERT v_bal = 10000 AND v_bal >= 0, format('T2 balance moved/negative: %s', v_bal);

  -- T3: holds prevent over-spend + reserve idempotent
  v_resv := wallet_reserve(v_user, 8000, 'broadcast_1', 'resv_idem_1');
  BEGIN
    PERFORM wallet_reserve(v_user, 5000, 'broadcast_2', 'resv_idem_2');
    ASSERT FALSE, 'T3 second reserve should have failed';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
    ASSERT v_err = 'INSUFFICIENT_BALANCE', format('T3 wrong error: %s', v_err);
  END;
  ASSERT wallet_reserve(v_user, 8000, 'broadcast_1', 'resv_idem_1') = v_resv,
         'T3 reserve not idempotent';

  -- settle (with duplicate unit webhook) + release leftover
  PERFORM wallet_settle(v_resv, 1000, 'msg_1');
  PERFORM wallet_settle(v_resv, 1000, 'msg_2');
  PERFORM wallet_settle(v_resv, 1000, 'msg_2');  -- duplicate send webhook → debited once
  PERFORM wallet_settle(v_resv, 1000, 'msg_3');
  PERFORM wallet_release(v_resv);
  PERFORM wallet_release(v_resv);                -- idempotent
  SELECT balance_paise INTO v_bal FROM wallet WHERE user_id = v_user;
  ASSERT v_bal = 7000, format('T3b expected 7000, got %s', v_bal);

  -- T4: ledger sum == balance
  SELECT COALESCE(SUM(amount_paise), 0) INTO v_sum
  FROM transactions WHERE user_id = v_user AND amount_paise IS NOT NULL;
  ASSERT v_sum = v_bal, format('T4 ledger sum %s != balance %s', v_sum, v_bal);

  RAISE NOTICE '✅ ALL PREPAID WALLET TESTS PASSED (balance=%)', v_bal;
END $$;

ROLLBACK;
