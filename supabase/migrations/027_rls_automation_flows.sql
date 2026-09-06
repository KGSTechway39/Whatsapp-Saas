-- =====================================================
-- 027_rls_automation_flows.sql  —  close the RLS gap left by 003
--
-- Migration 003 created `automation_flows` and `chatbot_sessions` WITHOUT row-level
-- security, unlike every other table in this project. That leaves a tenant's
-- automation logic and their contacts' in-flight chatbot state (contact ids,
-- conversation ids, collected answers in `context`) readable/writable with the
-- anon key.
--
-- This is the same gap, and the same fix, as 022 (message_billing / webhook_inbox):
-- ENABLE + FORCE RLS with NO policies. All access is via SUPABASE_SERVICE_ROLE_KEY
-- (server-only), which bypasses RLS — so this is a deny-all boundary for the
-- anon/authenticated roles with zero functional impact.
--
-- Apply immediately after 003. ADDITIVE & SAFE; idempotent.
-- =====================================================
ALTER TABLE public.automation_flows  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.automation_flows  FORCE  ROW LEVEL SECURITY;
ALTER TABLE public.chatbot_sessions  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chatbot_sessions  FORCE  ROW LEVEL SECURITY;
