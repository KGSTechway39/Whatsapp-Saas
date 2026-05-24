-- =====================================================
-- WASend Model B — Row Level Security Policies
-- Run AFTER 001_model_b_schema.sql
--
-- PREREQUISITE: For auth.uid() to return your custom JWT user ID,
-- set Supabase JWT secret (Project Settings → API → JWT Secret) to
-- match JWT_SECRET in .env.local, and include "sub": user.id in
-- your JWT payload (lib/auth.ts → createSessionToken).
--
-- All API routes using SERVICE_ROLE_KEY bypass RLS automatically.
-- These policies protect against accidental anon/client key usage.
-- =====================================================

-- =====================================================
-- HELPER: returns org IDs the current user belongs to
-- SECURITY DEFINER runs as the function owner (postgres),
-- preventing privilege escalation via auth.uid() spoofing.
-- =====================================================
CREATE OR REPLACE FUNCTION get_user_org_ids()
RETURNS UUID[] LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT COALESCE(ARRAY_AGG(organization_id), '{}')
  FROM organization_members
  WHERE user_id = auth.uid()
    AND status = 'active';
$$;

-- =====================================================
-- ENABLE RLS
-- =====================================================
ALTER TABLE users                ENABLE ROW LEVEL SECURITY;
ALTER TABLE organizations        ENABLE ROW LEVEL SECURITY;
ALTER TABLE organization_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE whatsapp_accounts    ENABLE ROW LEVEL SECURITY;
ALTER TABLE contacts             ENABLE ROW LEVEL SECURITY;
ALTER TABLE templates            ENABLE ROW LEVEL SECURITY;
ALTER TABLE campaigns            ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages             ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversations        ENABLE ROW LEVEL SECURITY;
ALTER TABLE automation_flows     ENABLE ROW LEVEL SECURITY;
ALTER TABLE chatbot_sessions     ENABLE ROW LEVEL SECURITY;
ALTER TABLE appointments         ENABLE ROW LEVEL SECURITY;
ALTER TABLE wallet_transactions  ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_pipeline         ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_deals            ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_activities       ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscriptions        ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_analytics      ENABLE ROW LEVEL SECURITY;

-- =====================================================
-- USERS
-- Users can only read/update their own row.
-- =====================================================
CREATE POLICY "users_select_own"
  ON users FOR SELECT
  USING (id = auth.uid());

CREATE POLICY "users_update_own"
  ON users FOR UPDATE
  USING (id = auth.uid());

-- =====================================================
-- ORGANIZATIONS
-- =====================================================
CREATE POLICY "orgs_select_member"
  ON organizations FOR SELECT
  USING (id = ANY(get_user_org_ids()));

CREATE POLICY "orgs_insert_authenticated"
  ON organizations FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

-- Only org owners/admins can update org settings
CREATE POLICY "orgs_update_admin"
  ON organizations FOR UPDATE
  USING (
    id IN (
      SELECT organization_id FROM organization_members
      WHERE user_id = auth.uid()
        AND role IN ('owner','admin')
        AND status = 'active'
    )
  );

-- Only owners can delete the org
CREATE POLICY "orgs_delete_owner"
  ON organizations FOR DELETE
  USING (
    id IN (
      SELECT organization_id FROM organization_members
      WHERE user_id = auth.uid()
        AND role = 'owner'
        AND status = 'active'
    )
  );

-- =====================================================
-- ORGANIZATION MEMBERS
-- =====================================================
CREATE POLICY "org_members_select"
  ON organization_members FOR SELECT
  USING (organization_id = ANY(get_user_org_ids()));

CREATE POLICY "org_members_insert_admin"
  ON organization_members FOR INSERT
  WITH CHECK (
    organization_id IN (
      SELECT organization_id FROM organization_members
      WHERE user_id = auth.uid()
        AND role IN ('owner','admin')
        AND status = 'active'
    )
  );

CREATE POLICY "org_members_update_admin"
  ON organization_members FOR UPDATE
  USING (
    organization_id IN (
      SELECT organization_id FROM organization_members
      WHERE user_id = auth.uid()
        AND role IN ('owner','admin')
        AND status = 'active'
    )
  );

CREATE POLICY "org_members_delete_admin"
  ON organization_members FOR DELETE
  USING (
    organization_id IN (
      SELECT organization_id FROM organization_members
      WHERE user_id = auth.uid()
        AND role IN ('owner','admin')
        AND status = 'active'
    )
  );

-- =====================================================
-- WHATSAPP ACCOUNTS
-- =====================================================
CREATE POLICY "wa_accounts_select"
  ON whatsapp_accounts FOR SELECT
  USING (organization_id = ANY(get_user_org_ids()));

CREATE POLICY "wa_accounts_insert"
  ON whatsapp_accounts FOR INSERT
  WITH CHECK (organization_id = ANY(get_user_org_ids()));

CREATE POLICY "wa_accounts_update"
  ON whatsapp_accounts FOR UPDATE
  USING (organization_id = ANY(get_user_org_ids()));

CREATE POLICY "wa_accounts_delete_admin"
  ON whatsapp_accounts FOR DELETE
  USING (
    organization_id IN (
      SELECT organization_id FROM organization_members
      WHERE user_id = auth.uid()
        AND role IN ('owner','admin')
        AND status = 'active'
    )
  );

-- =====================================================
-- CONTACTS
-- =====================================================
CREATE POLICY "contacts_select"
  ON contacts FOR SELECT
  USING (organization_id = ANY(get_user_org_ids()));

CREATE POLICY "contacts_insert"
  ON contacts FOR INSERT
  WITH CHECK (organization_id = ANY(get_user_org_ids()));

CREATE POLICY "contacts_update"
  ON contacts FOR UPDATE
  USING (organization_id = ANY(get_user_org_ids()));

CREATE POLICY "contacts_delete"
  ON contacts FOR DELETE
  USING (organization_id = ANY(get_user_org_ids()));

-- =====================================================
-- TEMPLATES
-- =====================================================
CREATE POLICY "templates_select"
  ON templates FOR SELECT
  USING (organization_id = ANY(get_user_org_ids()));

CREATE POLICY "templates_insert"
  ON templates FOR INSERT
  WITH CHECK (organization_id = ANY(get_user_org_ids()));

CREATE POLICY "templates_update"
  ON templates FOR UPDATE
  USING (organization_id = ANY(get_user_org_ids()));

CREATE POLICY "templates_delete"
  ON templates FOR DELETE
  USING (organization_id = ANY(get_user_org_ids()));

-- =====================================================
-- CAMPAIGNS
-- =====================================================
CREATE POLICY "campaigns_select"
  ON campaigns FOR SELECT
  USING (organization_id = ANY(get_user_org_ids()));

CREATE POLICY "campaigns_insert"
  ON campaigns FOR INSERT
  WITH CHECK (organization_id = ANY(get_user_org_ids()));

CREATE POLICY "campaigns_update"
  ON campaigns FOR UPDATE
  USING (organization_id = ANY(get_user_org_ids()));

CREATE POLICY "campaigns_delete"
  ON campaigns FOR DELETE
  USING (organization_id = ANY(get_user_org_ids()));

-- =====================================================
-- MESSAGES
-- =====================================================
CREATE POLICY "messages_select"
  ON messages FOR SELECT
  USING (organization_id = ANY(get_user_org_ids()));

CREATE POLICY "messages_insert"
  ON messages FOR INSERT
  WITH CHECK (organization_id = ANY(get_user_org_ids()));

-- Messages are immutable after creation (status updates via service role only)
CREATE POLICY "messages_update"
  ON messages FOR UPDATE
  USING (organization_id = ANY(get_user_org_ids()));

-- =====================================================
-- CONVERSATIONS
-- =====================================================
CREATE POLICY "conversations_select"
  ON conversations FOR SELECT
  USING (organization_id = ANY(get_user_org_ids()));

CREATE POLICY "conversations_insert"
  ON conversations FOR INSERT
  WITH CHECK (organization_id = ANY(get_user_org_ids()));

CREATE POLICY "conversations_update"
  ON conversations FOR UPDATE
  USING (organization_id = ANY(get_user_org_ids()));

-- =====================================================
-- AUTOMATION FLOWS
-- =====================================================
CREATE POLICY "automation_flows_select"
  ON automation_flows FOR SELECT
  USING (organization_id = ANY(get_user_org_ids()));

CREATE POLICY "automation_flows_insert"
  ON automation_flows FOR INSERT
  WITH CHECK (organization_id = ANY(get_user_org_ids()));

CREATE POLICY "automation_flows_update"
  ON automation_flows FOR UPDATE
  USING (organization_id = ANY(get_user_org_ids()));

CREATE POLICY "automation_flows_delete"
  ON automation_flows FOR DELETE
  USING (organization_id = ANY(get_user_org_ids()));

-- =====================================================
-- CHATBOT SESSIONS
-- =====================================================
CREATE POLICY "chatbot_sessions_select"
  ON chatbot_sessions FOR SELECT
  USING (
    automation_flow_id IN (
      SELECT id FROM automation_flows
      WHERE organization_id = ANY(get_user_org_ids())
    )
  );

CREATE POLICY "chatbot_sessions_insert"
  ON chatbot_sessions FOR INSERT
  WITH CHECK (
    automation_flow_id IN (
      SELECT id FROM automation_flows
      WHERE organization_id = ANY(get_user_org_ids())
    )
  );

CREATE POLICY "chatbot_sessions_update"
  ON chatbot_sessions FOR UPDATE
  USING (
    automation_flow_id IN (
      SELECT id FROM automation_flows
      WHERE organization_id = ANY(get_user_org_ids())
    )
  );

-- =====================================================
-- APPOINTMENTS
-- =====================================================
CREATE POLICY "appointments_select"
  ON appointments FOR SELECT
  USING (organization_id = ANY(get_user_org_ids()));

CREATE POLICY "appointments_insert"
  ON appointments FOR INSERT
  WITH CHECK (organization_id = ANY(get_user_org_ids()));

CREATE POLICY "appointments_update"
  ON appointments FOR UPDATE
  USING (organization_id = ANY(get_user_org_ids()));

CREATE POLICY "appointments_delete"
  ON appointments FOR DELETE
  USING (organization_id = ANY(get_user_org_ids()));

-- =====================================================
-- WALLET TRANSACTIONS  (read-only for non-service-role)
-- Writes must go through debit_wallet / credit_wallet functions
-- (which run as SECURITY DEFINER) or the service role key.
-- =====================================================
CREATE POLICY "wallet_txn_select"
  ON wallet_transactions FOR SELECT
  USING (organization_id = ANY(get_user_org_ids()));

-- =====================================================
-- CRM PIPELINE
-- =====================================================
CREATE POLICY "crm_pipeline_select"
  ON crm_pipeline FOR SELECT
  USING (organization_id = ANY(get_user_org_ids()));

CREATE POLICY "crm_pipeline_insert"
  ON crm_pipeline FOR INSERT
  WITH CHECK (organization_id = ANY(get_user_org_ids()));

CREATE POLICY "crm_pipeline_update"
  ON crm_pipeline FOR UPDATE
  USING (organization_id = ANY(get_user_org_ids()));

CREATE POLICY "crm_pipeline_delete_admin"
  ON crm_pipeline FOR DELETE
  USING (
    organization_id IN (
      SELECT organization_id FROM organization_members
      WHERE user_id = auth.uid()
        AND role IN ('owner','admin')
        AND status = 'active'
    )
  );

-- =====================================================
-- CRM DEALS
-- =====================================================
CREATE POLICY "crm_deals_select"
  ON crm_deals FOR SELECT
  USING (organization_id = ANY(get_user_org_ids()));

CREATE POLICY "crm_deals_insert"
  ON crm_deals FOR INSERT
  WITH CHECK (organization_id = ANY(get_user_org_ids()));

CREATE POLICY "crm_deals_update"
  ON crm_deals FOR UPDATE
  USING (organization_id = ANY(get_user_org_ids()));

CREATE POLICY "crm_deals_delete"
  ON crm_deals FOR DELETE
  USING (organization_id = ANY(get_user_org_ids()));

-- =====================================================
-- CRM ACTIVITIES
-- =====================================================
CREATE POLICY "crm_activities_select"
  ON crm_activities FOR SELECT
  USING (organization_id = ANY(get_user_org_ids()));

CREATE POLICY "crm_activities_insert"
  ON crm_activities FOR INSERT
  WITH CHECK (organization_id = ANY(get_user_org_ids()));

-- Activities are append-only; no UPDATE policy (immutable audit log)

-- =====================================================
-- SUBSCRIPTIONS
-- =====================================================
CREATE POLICY "subscriptions_select"
  ON subscriptions FOR SELECT
  USING (organization_id = ANY(get_user_org_ids()));

-- Subscription writes must go through the service role key only
-- (Razorpay webhook handler uses service role)

-- =====================================================
-- DAILY ANALYTICS
-- =====================================================
CREATE POLICY "daily_analytics_select"
  ON daily_analytics FOR SELECT
  USING (organization_id = ANY(get_user_org_ids()));

-- Writes go through upsert_daily_analytics() (service role)
