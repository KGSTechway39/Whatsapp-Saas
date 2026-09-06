-- =====================================================
-- 028_pin_ai_function_search_path.sql  —  same fix as 023, for the AI wallet RPCs
--
-- The functions added in 024 (_ai_wallet_ensure, ai_wallet_credit, ai_wallet_debit)
-- have a role-mutable search_path, which the Supabase security linter flags
-- (function_search_path_mutable) — exactly the issue 023 fixed for the message
-- wallet family. They reference public objects UNQUALIFIED (ai_credit_wallet,
-- ai_credit_ledger, _ai_wallet_ensure), so pin to `public` rather than '' to avoid
-- rewriting every body.
--
-- ALTER-only: behaviour unchanged, just removes the role-mutability. Idempotent.
-- =====================================================
ALTER FUNCTION public._ai_wallet_ensure(p_user uuid) SET search_path = public;

ALTER FUNCTION public.ai_wallet_credit(
  p_user uuid, p_credits integer, p_type text, p_idem text,
  p_task text, p_ref text, p_desc text
) SET search_path = public;

ALTER FUNCTION public.ai_wallet_debit(
  p_user uuid, p_credits integer, p_idem text,
  p_task text, p_ref text, p_desc text
) SET search_path = public;
