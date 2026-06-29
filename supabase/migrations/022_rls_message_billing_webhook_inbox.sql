-- =====================================================
-- 022_rls_message_billing_webhook_inbox.sql  —  close RLS gap
--
-- Tables added in 019 (message_billing) and 021 (webhook_inbox) were created
-- WITHOUT row-level security, unlike every other table in this project. That
-- left billing/margin data and raw inbound webhook payloads (phone numbers,
-- message content) readable/writable with the anon key.
--
-- Fix matches the established project posture: ENABLE + FORCE RLS with NO
-- policies. All DB access is via SUPABASE_SERVICE_ROLE_KEY (server-only), which
-- bypasses RLS — so this is a deny-all boundary for the anon/authenticated roles
-- with zero functional impact. ADDITIVE & SAFE; idempotent.
-- =====================================================
ALTER TABLE public.message_billing ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.message_billing FORCE  ROW LEVEL SECURITY;
ALTER TABLE public.webhook_inbox   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.webhook_inbox   FORCE  ROW LEVEL SECURITY;
