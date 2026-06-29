-- =====================================================
-- 023_pin_function_search_path.sql  —  fix function_search_path_mutable
--
-- The wallet RPCs (migration 011) and increment_webhook_endpoint_success (014)
-- had a role-mutable search_path, flagged by the Supabase security linter. They
-- reference public objects UNQUALIFIED (e.g. `wallet`, `wallet_reservations`,
-- `_wallet_ledger_write(...)`), so we pin search_path to `public` rather than ''
-- to avoid rewriting every body. ALTER-only: behaviour unchanged, just removes
-- the role-mutability. Idempotent.
-- =====================================================
ALTER FUNCTION public._wallet_ensure(p_user uuid) SET search_path = public;
ALTER FUNCTION public._wallet_ledger_write(p_user uuid, p_entry_type text, p_amount_paise bigint, p_balance_paise bigint, p_desc text, p_ref text, p_idem text, p_resv uuid, p_method text) SET search_path = public;
ALTER FUNCTION public.increment_webhook_endpoint_success(p_id uuid) SET search_path = public;
ALTER FUNCTION public.wallet_charge(p_user uuid, p_amount_paise bigint, p_idem text, p_desc text, p_ref text) SET search_path = public;
ALTER FUNCTION public.wallet_credit(p_user uuid, p_amount_paise bigint, p_type text, p_idem text, p_desc text, p_method text) SET search_path = public;
ALTER FUNCTION public.wallet_open_holds_paise(p_user uuid) SET search_path = public;
ALTER FUNCTION public.wallet_release(p_resv uuid) SET search_path = public;
ALTER FUNCTION public.wallet_reserve(p_user uuid, p_amount_paise bigint, p_ref text, p_idem text) SET search_path = public;
ALTER FUNCTION public.wallet_settle(p_resv uuid, p_actual_paise bigint, p_unit_idem text, p_desc text, p_ref text) SET search_path = public;
