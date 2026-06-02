-- =====================================================
-- WASend Model B — Unified Schema Fill-In  (idempotent)
-- =====================================================
-- This migration is safe to run on a fresh DB OR on a DB
-- that already has migrations 001-008 applied. Every statement
-- uses IF NOT EXISTS / ADD COLUMN IF NOT EXISTS / ON CONFLICT DO NOTHING.
--
-- It guarantees the final shape requested by the Model B spec:
--   organizations, whatsapp_accounts, contacts, templates, campaigns,
--   messages, conversations, automation_flows, chatbot_sessions,
--   appointments, wallet_transactions, crm_pipeline, crm_deals.
-- =====================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- =====================================================
-- ORGANIZATIONS
-- =====================================================
CREATE TABLE IF NOT EXISTS organizations (
  id                   UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
  name                 TEXT         NOT NULL,
  slug                 TEXT         UNIQUE NOT NULL,
  logo_url             TEXT,
  website              TEXT,
  plan                 TEXT         NOT NULL DEFAULT 'free'
                       CHECK (plan IN ('free','starter','growth','pro','enterprise')),
  wallet_balance       DECIMAL(12,2) NOT NULL DEFAULT 0,
  auto_recharge        BOOLEAN      NOT NULL DEFAULT FALSE,
  auto_recharge_amount DECIMAL(12,2) DEFAULT 0,
  meta_app_id          TEXT,
  meta_app_secret      TEXT,                 -- encrypted at app layer
  created_at           TIMESTAMPTZ  DEFAULT NOW(),
  updated_at           TIMESTAMPTZ  DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_organizations_slug ON organizations(slug);
CREATE INDEX IF NOT EXISTS idx_organizations_plan ON organizations(plan);

-- Membership table — required for RLS scoping
CREATE TABLE IF NOT EXISTS organization_members (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES users(id)         ON DELETE CASCADE,
  role            TEXT NOT NULL DEFAULT 'agent'
                  CHECK (role IN ('owner','admin','agent')),
  status          TEXT NOT NULL DEFAULT 'active'
                  CHECK (status IN ('active','invited','inactive')),
  invited_at      TIMESTAMPTZ DEFAULT NOW(),
  joined_at       TIMESTAMPTZ,
  UNIQUE(organization_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_org_members_org  ON organization_members(organization_id);
CREATE INDEX IF NOT EXISTS idx_org_members_user ON organization_members(user_id);

-- =====================================================
-- WHATSAPP ACCOUNTS
-- =====================================================
CREATE TABLE IF NOT EXISTS whatsapp_accounts (
  id                   UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id      UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  waba_id              TEXT NOT NULL,
  business_id          TEXT,
  phone_number_id      TEXT NOT NULL,
  display_phone_number TEXT NOT NULL,
  business_name        TEXT,
  quality_rating       TEXT DEFAULT 'GREEN'
                       CHECK (quality_rating IN ('GREEN','YELLOW','RED','UNKNOWN')),
  messaging_tier       TEXT DEFAULT 'TIER_1K',
  access_token         TEXT,                   -- encrypted at app layer
  token_encrypted      BOOLEAN NOT NULL DEFAULT TRUE,
  token_expires_at     TIMESTAMPTZ,
  status               TEXT NOT NULL DEFAULT 'pending'
                       CHECK (status IN ('pending','active','suspended','disconnected')),
  webhook_verified     BOOLEAN NOT NULL DEFAULT FALSE,
  created_at           TIMESTAMPTZ DEFAULT NOW(),
  updated_at           TIMESTAMPTZ DEFAULT NOW()
);

-- Add columns that older migrations may have missed
ALTER TABLE whatsapp_accounts ADD COLUMN IF NOT EXISTS business_id      TEXT;
ALTER TABLE whatsapp_accounts ADD COLUMN IF NOT EXISTS token_encrypted  BOOLEAN NOT NULL DEFAULT TRUE;

CREATE INDEX        IF NOT EXISTS idx_wa_accounts_org    ON whatsapp_accounts(organization_id);
CREATE INDEX        IF NOT EXISTS idx_wa_accounts_status ON whatsapp_accounts(status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_wa_accounts_phone_uniq
  ON whatsapp_accounts(phone_number_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_wa_accounts_waba_phone
  ON whatsapp_accounts(waba_id, phone_number_id);

-- =====================================================
-- CONTACTS  (multi-tenant; phone unique per org)
-- =====================================================
CREATE TABLE IF NOT EXISTS contacts (
  id                      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id         UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  phone                   TEXT NOT NULL,
  name                    TEXT,
  email                   TEXT,
  tags                    TEXT[] DEFAULT '{}',
  custom_fields           JSONB  DEFAULT '{}',
  opt_in_status           TEXT NOT NULL DEFAULT 'pending'
                          CHECK (opt_in_status IN ('opted_in','opted_out','pending')),
  last_message_at         TIMESTAMPTZ,
  total_messages_sent     INTEGER DEFAULT 0,
  total_messages_received INTEGER DEFAULT 0,
  source                  TEXT DEFAULT 'manual'
                          CHECK (source IN ('manual','import','webhook','chatbot','campaign')),
  assigned_to             UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at              TIMESTAMPTZ DEFAULT NOW(),
  updated_at              TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(organization_id, phone)
);

CREATE INDEX IF NOT EXISTS idx_contacts_org      ON contacts(organization_id);
CREATE INDEX IF NOT EXISTS idx_contacts_phone    ON contacts(organization_id, phone);
CREATE INDEX IF NOT EXISTS idx_contacts_tags     ON contacts USING GIN(tags);
CREATE INDEX IF NOT EXISTS idx_contacts_opt_in   ON contacts(organization_id, opt_in_status);
CREATE INDEX IF NOT EXISTS idx_contacts_last_msg ON contacts(organization_id, last_message_at DESC);
CREATE INDEX IF NOT EXISTS idx_contacts_assigned ON contacts(assigned_to) WHERE assigned_to IS NOT NULL;

-- =====================================================
-- TEMPLATES
-- =====================================================
CREATE TABLE IF NOT EXISTS templates (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id     UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  whatsapp_account_id UUID REFERENCES whatsapp_accounts(id) ON DELETE SET NULL,
  name                TEXT NOT NULL,
  category            TEXT NOT NULL
                      CHECK (category IN ('marketing','utility','authentication')),
  language            TEXT DEFAULT 'en',
  status              TEXT NOT NULL DEFAULT 'draft'
                      CHECK (status IN ('draft','pending','approved','rejected','paused')),
  header              JSONB,   -- {type, text|media_url}
  body                TEXT NOT NULL,
  footer              TEXT,
  buttons             JSONB DEFAULT '[]',
  meta_template_id    TEXT,
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX        IF NOT EXISTS idx_templates_org      ON templates(organization_id);
CREATE INDEX        IF NOT EXISTS idx_templates_status   ON templates(organization_id, status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_templates_name_uniq
  ON templates(organization_id, name, language);

-- =====================================================
-- CAMPAIGNS
-- =====================================================
CREATE TABLE IF NOT EXISTS campaigns (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id     UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  whatsapp_account_id UUID REFERENCES whatsapp_accounts(id) ON DELETE SET NULL,
  template_id         UUID REFERENCES templates(id)         ON DELETE SET NULL,
  name                TEXT NOT NULL,
  type                TEXT NOT NULL DEFAULT 'broadcast'
                      CHECK (type IN ('broadcast','drip','triggered','retarget')),
  status              TEXT NOT NULL DEFAULT 'draft'
                      CHECK (status IN ('draft','scheduled','running','paused','completed','failed')),
  audience_filter     JSONB DEFAULT '{}',
  scheduled_at        TIMESTAMPTZ,
  started_at          TIMESTAMPTZ,
  completed_at        TIMESTAMPTZ,
  total_recipients    INTEGER DEFAULT 0,
  sent_count          INTEGER DEFAULT 0,
  delivered_count     INTEGER DEFAULT 0,
  read_count          INTEGER DEFAULT 0,
  failed_count        INTEGER DEFAULT 0,
  replied_count       INTEGER DEFAULT 0,
  total_cost          DECIMAL(12,2) DEFAULT 0,
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_campaigns_org      ON campaigns(organization_id);
CREATE INDEX IF NOT EXISTS idx_campaigns_status   ON campaigns(organization_id, status);
CREATE INDEX IF NOT EXISTS idx_campaigns_template ON campaigns(template_id) WHERE template_id IS NOT NULL;

-- =====================================================
-- MESSAGES  (canonical event log)
-- =====================================================
CREATE TABLE IF NOT EXISTS messages (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id     UUID NOT NULL REFERENCES organizations(id)   ON DELETE CASCADE,
  campaign_id         UUID REFERENCES campaigns(id)                ON DELETE SET NULL,
  contact_id          UUID REFERENCES contacts(id)                 ON DELETE SET NULL,
  whatsapp_account_id UUID REFERENCES whatsapp_accounts(id)        ON DELETE SET NULL,
  wa_message_id       TEXT,
  direction           TEXT NOT NULL CHECK (direction IN ('outbound','inbound')),
  type                TEXT NOT NULL
                      CHECK (type IN (
                        'template','text','image','video','document',
                        'audio','location','button_reply','list_reply'
                      )),
  content             JSONB NOT NULL DEFAULT '{}',
  status              TEXT NOT NULL DEFAULT 'queued'
                      CHECK (status IN ('queued','sent','delivered','read','failed')),
  error_code          TEXT,
  error_message       TEXT,
  meta_cost           DECIMAL(8,4) DEFAULT 0,
  platform_fee        DECIMAL(8,4) DEFAULT 0,
  sent_at             TIMESTAMPTZ,
  delivered_at        TIMESTAMPTZ,
  read_at             TIMESTAMPTZ,
  created_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_wa_id
  ON messages(wa_message_id) WHERE wa_message_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_messages_org       ON messages(organization_id);
CREATE INDEX IF NOT EXISTS idx_messages_campaign  ON messages(campaign_id) WHERE campaign_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_messages_contact   ON messages(contact_id)  WHERE contact_id  IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_messages_status    ON messages(organization_id, status);
CREATE INDEX IF NOT EXISTS idx_messages_created   ON messages(organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_direction ON messages(organization_id, direction);

-- =====================================================
-- CONVERSATIONS (inbox)
-- =====================================================
CREATE TABLE IF NOT EXISTS conversations (
  id                   UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id      UUID NOT NULL REFERENCES organizations(id)    ON DELETE CASCADE,
  whatsapp_account_id  UUID REFERENCES whatsapp_accounts(id)         ON DELETE SET NULL,
  contact_id           UUID NOT NULL REFERENCES contacts(id)         ON DELETE CASCADE,
  last_message_at      TIMESTAMPTZ,
  last_message_preview TEXT,
  status               TEXT NOT NULL DEFAULT 'open'
                       CHECK (status IN ('open','resolved','pending','bot_handling')),
  assigned_to          UUID REFERENCES users(id) ON DELETE SET NULL,
  is_within_24h_window BOOLEAN NOT NULL DEFAULT FALSE,
  unread_count         INTEGER NOT NULL DEFAULT 0,
  created_at           TIMESTAMPTZ DEFAULT NOW(),
  updated_at           TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_conversations_org     ON conversations(organization_id);
CREATE INDEX IF NOT EXISTS idx_conversations_contact ON conversations(contact_id);
CREATE INDEX IF NOT EXISTS idx_conversations_status  ON conversations(organization_id, status);
CREATE INDEX IF NOT EXISTS idx_conversations_agent   ON conversations(assigned_to) WHERE assigned_to IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_conversations_last    ON conversations(organization_id, last_message_at DESC);

-- =====================================================
-- AUTOMATION FLOWS
-- =====================================================
CREATE TABLE IF NOT EXISTS automation_flows (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id  UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name             TEXT NOT NULL,
  trigger_type     TEXT NOT NULL
                   CHECK (trigger_type IN (
                     'keyword','welcome','out_of_hours','webhook','contact_tag','order_event'
                   )),
  trigger_config   JSONB DEFAULT '{}',
  flow_data        JSONB DEFAULT '{"nodes":[],"edges":[]}',
  is_active        BOOLEAN NOT NULL DEFAULT FALSE,
  total_triggered  INTEGER NOT NULL DEFAULT 0,
  total_completed  INTEGER NOT NULL DEFAULT 0,
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  updated_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_automation_flows_org    ON automation_flows(organization_id);
CREATE INDEX IF NOT EXISTS idx_automation_flows_active ON automation_flows(organization_id, is_active);

-- =====================================================
-- CHATBOT SESSIONS
-- =====================================================
CREATE TABLE IF NOT EXISTS chatbot_sessions (
  id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  automation_flow_id UUID NOT NULL REFERENCES automation_flows(id) ON DELETE CASCADE,
  contact_id         UUID NOT NULL REFERENCES contacts(id)         ON DELETE CASCADE,
  conversation_id    UUID REFERENCES conversations(id)             ON DELETE SET NULL,
  current_node_id    TEXT,
  session_data       JSONB DEFAULT '{}',
  status             TEXT NOT NULL DEFAULT 'active'
                     CHECK (status IN ('active','completed','handed_over','expired')),
  created_at         TIMESTAMPTZ DEFAULT NOW(),
  updated_at         TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_chatbot_sessions_flow    ON chatbot_sessions(automation_flow_id);
CREATE INDEX IF NOT EXISTS idx_chatbot_sessions_contact ON chatbot_sessions(contact_id);
CREATE INDEX IF NOT EXISTS idx_chatbot_sessions_status  ON chatbot_sessions(status);

-- =====================================================
-- APPOINTMENTS
-- =====================================================
CREATE TABLE IF NOT EXISTS appointments (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id  UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  contact_id       UUID REFERENCES contacts(id)              ON DELETE SET NULL,
  title            TEXT NOT NULL,
  date             DATE NOT NULL,
  time             TIME NOT NULL,
  duration_minutes INTEGER DEFAULT 30,
  status           TEXT NOT NULL DEFAULT 'scheduled'
                   CHECK (status IN ('scheduled','confirmed','cancelled','completed')),
  reminder_sent    BOOLEAN NOT NULL DEFAULT FALSE,
  notes            TEXT,
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  updated_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_appointments_org     ON appointments(organization_id);
CREATE INDEX IF NOT EXISTS idx_appointments_contact ON appointments(contact_id) WHERE contact_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_appointments_date    ON appointments(organization_id, date);
CREATE INDEX IF NOT EXISTS idx_appointments_status  ON appointments(organization_id, status);

-- =====================================================
-- WALLET TRANSACTIONS
-- =====================================================
CREATE TABLE IF NOT EXISTS wallet_transactions (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id     UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  type                TEXT NOT NULL
                      CHECK (type IN ('recharge','message_debit','refund','bonus')),
  amount              DECIMAL(12,2) NOT NULL,
  balance_after       DECIMAL(12,2) NOT NULL,
  description         TEXT,
  reference_id        TEXT,
  payment_gateway_id  TEXT,
  created_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_wallet_txn_org  ON wallet_transactions(organization_id);
CREATE INDEX IF NOT EXISTS idx_wallet_txn_type ON wallet_transactions(organization_id, type);
CREATE INDEX IF NOT EXISTS idx_wallet_txn_ref  ON wallet_transactions(reference_id) WHERE reference_id IS NOT NULL;

-- =====================================================
-- CRM PIPELINE + DEALS
-- =====================================================
CREATE TABLE IF NOT EXISTS crm_pipeline (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name            TEXT NOT NULL DEFAULT 'Sales Pipeline',
  stages          JSONB NOT NULL DEFAULT '[
    {"name":"New Lead",  "color":"#6366f1","order":1},
    {"name":"Contacted", "color":"#3b82f6","order":2},
    {"name":"Qualified", "color":"#f59e0b","order":3},
    {"name":"Proposal",  "color":"#8b5cf6","order":4},
    {"name":"Won",       "color":"#10b981","order":5}
  ]',
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_crm_pipeline_org ON crm_pipeline(organization_id);

CREATE TABLE IF NOT EXISTS crm_deals (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  pipeline_id     UUID NOT NULL REFERENCES crm_pipeline(id)   ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id)  ON DELETE CASCADE,
  contact_id      UUID REFERENCES contacts(id)                ON DELETE SET NULL,
  title           TEXT NOT NULL,
  value           DECIMAL(12,2) DEFAULT 0,
  stage_name      TEXT NOT NULL,
  assigned_to     UUID REFERENCES users(id)                   ON DELETE SET NULL,
  notes           TEXT,
  status          TEXT NOT NULL DEFAULT 'open'
                  CHECK (status IN ('open','won','lost')),
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_crm_deals_org      ON crm_deals(organization_id);
CREATE INDEX IF NOT EXISTS idx_crm_deals_pipeline ON crm_deals(pipeline_id);
CREATE INDEX IF NOT EXISTS idx_crm_deals_contact  ON crm_deals(contact_id)  WHERE contact_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_crm_deals_status   ON crm_deals(organization_id, status);
CREATE INDEX IF NOT EXISTS idx_crm_deals_assigned ON crm_deals(assigned_to) WHERE assigned_to IS NOT NULL;

-- =====================================================
-- ROW LEVEL SECURITY  (idempotent; safe to re-run)
-- =====================================================
-- All API routes use SERVICE_ROLE_KEY which bypasses RLS; these
-- policies protect against accidental anon/client-key reads.

CREATE OR REPLACE FUNCTION get_user_org_ids()
RETURNS UUID[] LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT COALESCE(ARRAY_AGG(organization_id), '{}')
  FROM organization_members
  WHERE user_id = auth.uid()
    AND status = 'active';
$$;

DO $$
DECLARE
  t TEXT;
BEGIN
  FOR t IN SELECT unnest(ARRAY[
    'organizations','organization_members','whatsapp_accounts','contacts',
    'templates','campaigns','messages','conversations','automation_flows',
    'chatbot_sessions','appointments','wallet_transactions',
    'crm_pipeline','crm_deals'
  ]) LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
  END LOOP;
END $$;

-- Drop + recreate the org-scoped policies to keep them consistent
DO $$
DECLARE
  t   TEXT;
  pol TEXT;
BEGIN
  FOR t IN SELECT unnest(ARRAY[
    'whatsapp_accounts','contacts','templates','campaigns','messages',
    'conversations','automation_flows','appointments',
    'wallet_transactions','crm_pipeline','crm_deals'
  ]) LOOP
    FOR pol IN
      SELECT policyname FROM pg_policies
      WHERE schemaname='public' AND tablename=t AND policyname LIKE '%_org_%'
    LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON %I', pol, t);
    END LOOP;

    EXECUTE format($q$
      CREATE POLICY "%1$s_org_select" ON %1$I FOR SELECT
        USING (organization_id = ANY(get_user_org_ids()));
      CREATE POLICY "%1$s_org_insert" ON %1$I FOR INSERT
        WITH CHECK (organization_id = ANY(get_user_org_ids()));
      CREATE POLICY "%1$s_org_update" ON %1$I FOR UPDATE
        USING (organization_id = ANY(get_user_org_ids()));
      CREATE POLICY "%1$s_org_delete" ON %1$I FOR DELETE
        USING (organization_id = ANY(get_user_org_ids()));
    $q$, t);
  END LOOP;
END $$;

-- chatbot_sessions scope through automation_flows.organization_id
DROP POLICY IF EXISTS "chatbot_sessions_org_select" ON chatbot_sessions;
DROP POLICY IF EXISTS "chatbot_sessions_org_insert" ON chatbot_sessions;
DROP POLICY IF EXISTS "chatbot_sessions_org_update" ON chatbot_sessions;
DROP POLICY IF EXISTS "chatbot_sessions_org_delete" ON chatbot_sessions;

CREATE POLICY "chatbot_sessions_org_select" ON chatbot_sessions FOR SELECT
  USING (automation_flow_id IN (
    SELECT id FROM automation_flows WHERE organization_id = ANY(get_user_org_ids())));
CREATE POLICY "chatbot_sessions_org_insert" ON chatbot_sessions FOR INSERT
  WITH CHECK (automation_flow_id IN (
    SELECT id FROM automation_flows WHERE organization_id = ANY(get_user_org_ids())));
CREATE POLICY "chatbot_sessions_org_update" ON chatbot_sessions FOR UPDATE
  USING (automation_flow_id IN (
    SELECT id FROM automation_flows WHERE organization_id = ANY(get_user_org_ids())));
CREATE POLICY "chatbot_sessions_org_delete" ON chatbot_sessions FOR DELETE
  USING (automation_flow_id IN (
    SELECT id FROM automation_flows WHERE organization_id = ANY(get_user_org_ids())));

-- =====================================================
-- HELPER: ensure every user has at least one organization
-- (creates a personal org on first login if missing)
-- =====================================================
CREATE OR REPLACE FUNCTION ensure_personal_org(p_user_id UUID, p_name TEXT DEFAULT NULL)
RETURNS UUID LANGUAGE plpgsql AS $$
DECLARE
  v_org_id UUID;
  v_slug   TEXT;
BEGIN
  SELECT organization_id INTO v_org_id
    FROM organization_members
    WHERE user_id = p_user_id AND status = 'active'
    LIMIT 1;

  IF v_org_id IS NOT NULL THEN
    RETURN v_org_id;
  END IF;

  v_slug := 'org-' || substr(replace(p_user_id::text, '-', ''), 1, 12);

  INSERT INTO organizations (name, slug)
  VALUES (COALESCE(p_name, 'My Workspace'), v_slug)
  RETURNING id INTO v_org_id;

  INSERT INTO organization_members (organization_id, user_id, role, status, joined_at)
  VALUES (v_org_id, p_user_id, 'owner', 'active', NOW());

  RETURN v_org_id;
END;
$$;
