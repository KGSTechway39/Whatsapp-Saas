-- =====================================================
-- WASend Model B — Core Schema Migration
-- Model B: Platform provides WhatsApp API access via Embedded Signup
-- Architecture: Organization-scoped multi-tenant
-- Run in Supabase SQL Editor
-- =====================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- =====================================================
-- DROP LEGACY MODEL A TABLES (order: leaf → root)
-- =====================================================
DROP TABLE IF EXISTS crm_activities      CASCADE;
DROP TABLE IF EXISTS crm_deals           CASCADE;
DROP TABLE IF EXISTS daily_analytics     CASCADE;
DROP TABLE IF EXISTS team_members        CASCADE;
DROP TABLE IF EXISTS transactions        CASCADE;
DROP TABLE IF EXISTS subscriptions       CASCADE;
DROP TABLE IF EXISTS wallet              CASCADE;
DROP TABLE IF EXISTS automations         CASCADE;
DROP TABLE IF EXISTS campaign_messages   CASCADE;
DROP TABLE IF EXISTS campaigns           CASCADE;
DROP TABLE IF EXISTS templates           CASCADE;
DROP TABLE IF EXISTS contacts            CASCADE;
DROP TABLE IF EXISTS whatsapp_numbers    CASCADE;
DROP TABLE IF EXISTS users               CASCADE;

-- =====================================================
-- USERS  (custom auth — no Supabase Auth dependency)
-- NOTE: JWT payload must include "sub": user.id for RLS to work.
--       Set JWT_SECRET in Supabase → Project Settings → API → JWT Secret
--       to match your JWT_SECRET env variable.
-- =====================================================
CREATE TABLE users (
  id            UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  email         TEXT        UNIQUE NOT NULL,
  password_hash TEXT        NOT NULL,
  full_name     TEXT        NOT NULL DEFAULT '',
  phone         TEXT,
  avatar_url    TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_users_email ON users(email);

-- =====================================================
-- ORGANIZATIONS
-- =====================================================
CREATE TABLE organizations (
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
  -- Store encrypted at the application layer before writing here
  meta_app_id          TEXT,
  meta_app_secret      TEXT,
  created_at           TIMESTAMPTZ  DEFAULT NOW(),
  updated_at           TIMESTAMPTZ  DEFAULT NOW()
);

CREATE INDEX idx_organizations_slug ON organizations(slug);

-- =====================================================
-- ORGANIZATION MEMBERS  (replaces team_members)
-- =====================================================
CREATE TABLE organization_members (
  id              UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id         UUID        NOT NULL REFERENCES users(id)         ON DELETE CASCADE,
  role            TEXT        NOT NULL DEFAULT 'agent'
                  CHECK (role IN ('owner','admin','agent')),
  status          TEXT        NOT NULL DEFAULT 'invited'
                  CHECK (status IN ('active','invited','inactive')),
  invited_at      TIMESTAMPTZ DEFAULT NOW(),
  joined_at       TIMESTAMPTZ,
  UNIQUE(organization_id, user_id)
);

CREATE INDEX idx_org_members_org  ON organization_members(organization_id);
CREATE INDEX idx_org_members_user ON organization_members(user_id);

-- =====================================================
-- WHATSAPP ACCOUNTS  (connected numbers via Embedded Signup)
-- =====================================================
CREATE TABLE whatsapp_accounts (
  id                   UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id      UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  waba_id              TEXT        NOT NULL,
  phone_number_id      TEXT        NOT NULL,
  display_phone_number TEXT        NOT NULL,
  business_name        TEXT,
  quality_rating       TEXT        DEFAULT 'GREEN'
                       CHECK (quality_rating IN ('GREEN','YELLOW','RED','UNKNOWN')),
  messaging_tier       TEXT        DEFAULT 'TIER_1K',
  -- Encrypt access_token at application layer before storing
  access_token         TEXT,
  token_expires_at     TIMESTAMPTZ,
  status               TEXT        NOT NULL DEFAULT 'pending'
                       CHECK (status IN ('pending','active','suspended','disconnected')),
  webhook_verified     BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at           TIMESTAMPTZ DEFAULT NOW(),
  updated_at           TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_wa_accounts_org    ON whatsapp_accounts(organization_id);
CREATE INDEX idx_wa_accounts_waba   ON whatsapp_accounts(waba_id);
CREATE INDEX idx_wa_accounts_status ON whatsapp_accounts(status);

-- =====================================================
-- CONTACTS
-- =====================================================
CREATE TABLE contacts (
  id                      UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id         UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  phone                   TEXT        NOT NULL,
  name                    TEXT,
  email                   TEXT,
  tags                    TEXT[]      DEFAULT '{}',
  custom_fields           JSONB       DEFAULT '{}',
  opt_in_status           TEXT        NOT NULL DEFAULT 'pending'
                          CHECK (opt_in_status IN ('opted_in','opted_out','pending')),
  last_message_at         TIMESTAMPTZ,
  total_messages_sent     INTEGER     DEFAULT 0,
  total_messages_received INTEGER     DEFAULT 0,
  source                  TEXT        DEFAULT 'manual'
                          CHECK (source IN ('manual','import','webhook','chatbot','campaign')),
  -- CRM fields (kept for backward compat; detailed CRM uses crm_deals/crm_pipeline)
  crm_stage               TEXT,
  crm_score               INTEGER     DEFAULT 50,
  deal_value              DECIMAL(12,2) DEFAULT 0,
  company                 TEXT,
  crm_notes               TEXT,
  assigned_to             UUID        REFERENCES users(id) ON DELETE SET NULL,
  created_at              TIMESTAMPTZ DEFAULT NOW(),
  updated_at              TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(organization_id, phone)
);

CREATE INDEX idx_contacts_org       ON contacts(organization_id);
CREATE INDEX idx_contacts_phone     ON contacts(organization_id, phone);
CREATE INDEX idx_contacts_tags      ON contacts USING GIN(tags);
CREATE INDEX idx_contacts_opt_in    ON contacts(organization_id, opt_in_status);
CREATE INDEX idx_contacts_last_msg  ON contacts(organization_id, last_message_at DESC);

-- =====================================================
-- TEMPLATES
-- =====================================================
CREATE TABLE templates (
  id                   UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id      UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  whatsapp_account_id  UUID        REFERENCES whatsapp_accounts(id) ON DELETE SET NULL,
  name                 TEXT        NOT NULL,
  category             TEXT        NOT NULL
                       CHECK (category IN ('marketing','utility','authentication')),
  language             TEXT        DEFAULT 'en',
  status               TEXT        NOT NULL DEFAULT 'draft'
                       CHECK (status IN ('draft','pending','approved','rejected','paused')),
  -- header: {type: 'text'|'image'|'video'|'document', text?, media_url?}
  header               JSONB,
  body                 TEXT        NOT NULL,
  footer               TEXT,
  -- buttons: [{type: 'quick_reply'|'url'|'phone_number', text, url?, phone_number?}]
  buttons              JSONB       DEFAULT '[]',
  meta_template_id     TEXT,
  created_at           TIMESTAMPTZ DEFAULT NOW(),
  updated_at           TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_templates_org    ON templates(organization_id);
CREATE INDEX idx_templates_status ON templates(organization_id, status);

-- =====================================================
-- CAMPAIGNS
-- =====================================================
CREATE TABLE campaigns (
  id                  UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id     UUID         NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  whatsapp_account_id UUID         REFERENCES whatsapp_accounts(id) ON DELETE SET NULL,
  template_id         UUID         REFERENCES templates(id)          ON DELETE SET NULL,
  name                TEXT         NOT NULL,
  type                TEXT         NOT NULL DEFAULT 'broadcast'
                      CHECK (type IN ('broadcast','drip','triggered','retarget')),
  status              TEXT         NOT NULL DEFAULT 'draft'
                      CHECK (status IN ('draft','scheduled','running','paused','completed','failed')),
  -- audience_filter: {tags?: [], segments?: [], contact_ids?: []}
  audience_filter     JSONB        DEFAULT '{}',
  scheduled_at        TIMESTAMPTZ,
  started_at          TIMESTAMPTZ,
  completed_at        TIMESTAMPTZ,
  total_recipients    INTEGER      DEFAULT 0,
  sent_count          INTEGER      DEFAULT 0,
  delivered_count     INTEGER      DEFAULT 0,
  read_count          INTEGER      DEFAULT 0,
  failed_count        INTEGER      DEFAULT 0,
  replied_count       INTEGER      DEFAULT 0,
  total_cost          DECIMAL(12,2) DEFAULT 0,
  created_at          TIMESTAMPTZ  DEFAULT NOW(),
  updated_at          TIMESTAMPTZ  DEFAULT NOW()
);

CREATE INDEX idx_campaigns_org    ON campaigns(organization_id);
CREATE INDEX idx_campaigns_status ON campaigns(organization_id, status);

-- =====================================================
-- MESSAGES  (replaces campaign_messages; covers all in/outbound)
-- =====================================================
CREATE TABLE messages (
  id                  UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id     UUID        NOT NULL REFERENCES organizations(id)   ON DELETE CASCADE,
  campaign_id         UUID        REFERENCES campaigns(id)                ON DELETE SET NULL,
  contact_id          UUID        REFERENCES contacts(id)                 ON DELETE SET NULL,
  whatsapp_account_id UUID        REFERENCES whatsapp_accounts(id)        ON DELETE SET NULL,
  -- wa_message_id returned by Meta API / sent in webhook callbacks
  wa_message_id       TEXT,
  direction           TEXT        NOT NULL CHECK (direction IN ('outbound','inbound')),
  type                TEXT        NOT NULL
                      CHECK (type IN (
                        'template','text','image','video','document',
                        'audio','location','button_reply','list_reply'
                      )),
  -- content: {body?, media_url?, template_name?, variables?, caption?}
  content             JSONB       NOT NULL DEFAULT '{}',
  status              TEXT        NOT NULL DEFAULT 'queued'
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

CREATE UNIQUE INDEX idx_messages_wa_id     ON messages(wa_message_id) WHERE wa_message_id IS NOT NULL;
CREATE INDEX        idx_messages_org       ON messages(organization_id);
CREATE INDEX        idx_messages_campaign  ON messages(campaign_id)   WHERE campaign_id IS NOT NULL;
CREATE INDEX        idx_messages_contact   ON messages(contact_id)    WHERE contact_id  IS NOT NULL;
CREATE INDEX        idx_messages_status    ON messages(organization_id, status);
CREATE INDEX        idx_messages_created   ON messages(organization_id, created_at DESC);

-- =====================================================
-- CONVERSATIONS  (inbox / live chat view)
-- =====================================================
CREATE TABLE conversations (
  id                    UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id       UUID        NOT NULL REFERENCES organizations(id)    ON DELETE CASCADE,
  whatsapp_account_id   UUID        REFERENCES whatsapp_accounts(id)         ON DELETE SET NULL,
  contact_id            UUID        NOT NULL REFERENCES contacts(id)         ON DELETE CASCADE,
  last_message_at       TIMESTAMPTZ,
  last_message_preview  TEXT,
  status                TEXT        NOT NULL DEFAULT 'open'
                        CHECK (status IN ('open','resolved','pending','bot_handling')),
  assigned_to           UUID        REFERENCES users(id)                     ON DELETE SET NULL,
  is_within_24h_window  BOOLEAN     NOT NULL DEFAULT FALSE,
  unread_count          INTEGER     NOT NULL DEFAULT 0,
  created_at            TIMESTAMPTZ DEFAULT NOW(),
  updated_at            TIMESTAMPTZ DEFAULT NOW(),
  -- one active conversation per contact per WhatsApp number
  UNIQUE(whatsapp_account_id, contact_id)
);

CREATE INDEX idx_conversations_org     ON conversations(organization_id);
CREATE INDEX idx_conversations_contact ON conversations(contact_id);
CREATE INDEX idx_conversations_status  ON conversations(organization_id, status);
CREATE INDEX idx_conversations_agent   ON conversations(assigned_to) WHERE assigned_to IS NOT NULL;
CREATE INDEX idx_conversations_last    ON conversations(organization_id, last_message_at DESC);

-- =====================================================
-- AUTOMATION FLOWS  (replaces automations; supports visual builder)
-- =====================================================
CREATE TABLE automation_flows (
  id               UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id  UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name             TEXT        NOT NULL,
  trigger_type     TEXT        NOT NULL
                   CHECK (trigger_type IN (
                     'keyword','welcome','out_of_hours','webhook','contact_tag','order_event'
                   )),
  -- trigger_config: {keywords?: [], schedule?: {}, conditions?: []}
  trigger_config   JSONB       DEFAULT '{}',
  -- flow_data: {nodes: [...], edges: [...]} — flow builder canvas data
  flow_data        JSONB       DEFAULT '{"nodes":[],"edges":[]}',
  is_active        BOOLEAN     NOT NULL DEFAULT FALSE,
  total_triggered  INTEGER     NOT NULL DEFAULT 0,
  total_completed  INTEGER     NOT NULL DEFAULT 0,
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  updated_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_automation_flows_org    ON automation_flows(organization_id);
CREATE INDEX idx_automation_flows_active ON automation_flows(organization_id, is_active);

-- =====================================================
-- CHATBOT SESSIONS
-- =====================================================
CREATE TABLE chatbot_sessions (
  id                 UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  automation_flow_id UUID        NOT NULL REFERENCES automation_flows(id) ON DELETE CASCADE,
  contact_id         UUID        NOT NULL REFERENCES contacts(id)         ON DELETE CASCADE,
  conversation_id    UUID        REFERENCES conversations(id)             ON DELETE SET NULL,
  current_node_id    TEXT,
  -- session_data: arbitrary key-value state collected during the flow
  session_data       JSONB       DEFAULT '{}',
  status             TEXT        NOT NULL DEFAULT 'active'
                     CHECK (status IN ('active','completed','handed_over','expired')),
  created_at         TIMESTAMPTZ DEFAULT NOW(),
  updated_at         TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_chatbot_sessions_flow    ON chatbot_sessions(automation_flow_id);
CREATE INDEX idx_chatbot_sessions_contact ON chatbot_sessions(contact_id);
CREATE INDEX idx_chatbot_sessions_status  ON chatbot_sessions(status);

-- =====================================================
-- APPOINTMENTS
-- =====================================================
CREATE TABLE appointments (
  id               UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id  UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  contact_id       UUID        REFERENCES contacts(id)              ON DELETE SET NULL,
  title            TEXT        NOT NULL,
  date             DATE        NOT NULL,
  time             TIME        NOT NULL,
  duration_minutes INTEGER     DEFAULT 30,
  status           TEXT        NOT NULL DEFAULT 'scheduled'
                   CHECK (status IN ('scheduled','confirmed','cancelled','completed')),
  reminder_sent    BOOLEAN     NOT NULL DEFAULT FALSE,
  notes            TEXT,
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  updated_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_appointments_org     ON appointments(organization_id);
CREATE INDEX idx_appointments_contact ON appointments(contact_id) WHERE contact_id IS NOT NULL;
CREATE INDEX idx_appointments_date    ON appointments(organization_id, date);

-- =====================================================
-- WALLET TRANSACTIONS  (replaces wallet + transactions)
-- Balance is the canonical value on organizations.wallet_balance
-- =====================================================
CREATE TABLE wallet_transactions (
  id                  UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id     UUID         NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  type                TEXT         NOT NULL
                      CHECK (type IN ('recharge','message_debit','refund','bonus')),
  amount              DECIMAL(12,2) NOT NULL,
  balance_after       DECIMAL(12,2) NOT NULL,
  description         TEXT,
  reference_id        TEXT,
  payment_gateway_id  TEXT,
  created_at          TIMESTAMPTZ  DEFAULT NOW()
);

CREATE INDEX idx_wallet_txn_org  ON wallet_transactions(organization_id);
CREATE INDEX idx_wallet_txn_type ON wallet_transactions(organization_id, type);
CREATE INDEX idx_wallet_txn_ref  ON wallet_transactions(reference_id) WHERE reference_id IS NOT NULL;

-- =====================================================
-- CRM PIPELINE
-- =====================================================
CREATE TABLE crm_pipeline (
  id               UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id  UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name             TEXT        NOT NULL DEFAULT 'Sales Pipeline',
  -- stages: [{name, color, order}]
  stages           JSONB       NOT NULL DEFAULT '[
    {"name":"New Lead",  "color":"#6366f1","order":1},
    {"name":"Contacted", "color":"#3b82f6","order":2},
    {"name":"Qualified", "color":"#f59e0b","order":3},
    {"name":"Proposal",  "color":"#8b5cf6","order":4},
    {"name":"Won",       "color":"#10b981","order":5}
  ]',
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_crm_pipeline_org ON crm_pipeline(organization_id);

-- =====================================================
-- CRM DEALS
-- =====================================================
CREATE TABLE crm_deals (
  id               UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
  pipeline_id      UUID         NOT NULL REFERENCES crm_pipeline(id) ON DELETE CASCADE,
  organization_id  UUID         NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  contact_id       UUID         REFERENCES contacts(id)              ON DELETE SET NULL,
  title            TEXT         NOT NULL,
  value            DECIMAL(12,2) DEFAULT 0,
  stage_name       TEXT         NOT NULL,
  assigned_to      UUID         REFERENCES users(id)                 ON DELETE SET NULL,
  notes            TEXT,
  status           TEXT         NOT NULL DEFAULT 'open'
                   CHECK (status IN ('open','won','lost')),
  created_at       TIMESTAMPTZ  DEFAULT NOW(),
  updated_at       TIMESTAMPTZ  DEFAULT NOW()
);

CREATE INDEX idx_crm_deals_org      ON crm_deals(organization_id);
CREATE INDEX idx_crm_deals_pipeline ON crm_deals(pipeline_id);
CREATE INDEX idx_crm_deals_contact  ON crm_deals(contact_id)  WHERE contact_id IS NOT NULL;
CREATE INDEX idx_crm_deals_status   ON crm_deals(organization_id, status);

-- =====================================================
-- CRM ACTIVITIES  (timeline log per contact)
-- =====================================================
CREATE TABLE crm_activities (
  id               UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id  UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  contact_id       UUID        NOT NULL REFERENCES contacts(id)      ON DELETE CASCADE,
  user_id          UUID        REFERENCES users(id)                  ON DELETE SET NULL,
  type             TEXT        NOT NULL
                   CHECK (type IN ('note','call','whatsapp','email','stage_change','deal')),
  content          TEXT        NOT NULL,
  metadata         JSONB       DEFAULT '{}',
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_crm_activities_org     ON crm_activities(organization_id);
CREATE INDEX idx_crm_activities_contact ON crm_activities(contact_id);

-- =====================================================
-- SUBSCRIPTIONS  (per org, Razorpay billing)
-- =====================================================
CREATE TABLE subscriptions (
  id                        UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id           UUID        NOT NULL UNIQUE REFERENCES organizations(id) ON DELETE CASCADE,
  plan_id                   TEXT        NOT NULL DEFAULT 'free',
  billing_cycle             TEXT        DEFAULT 'monthly'
                            CHECK (billing_cycle IN ('monthly','yearly')),
  status                    TEXT        NOT NULL DEFAULT 'active'
                            CHECK (status IN ('active','pending','cancelled','past_due','trialing')),
  razorpay_subscription_id  TEXT        UNIQUE,
  razorpay_customer_id      TEXT,
  current_period_start      TIMESTAMPTZ,
  current_period_end        TIMESTAMPTZ,
  cancel_at_period_end      BOOLEAN     DEFAULT FALSE,
  created_at                TIMESTAMPTZ DEFAULT NOW(),
  updated_at                TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_subscriptions_org        ON subscriptions(organization_id);
CREATE INDEX idx_subscriptions_razorpay   ON subscriptions(razorpay_subscription_id)
  WHERE razorpay_subscription_id IS NOT NULL;

-- =====================================================
-- DAILY ANALYTICS  (per-org rollup)
-- =====================================================
CREATE TABLE daily_analytics (
  id                  UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id     UUID        NOT NULL REFERENCES organizations(id)    ON DELETE CASCADE,
  whatsapp_account_id UUID        REFERENCES whatsapp_accounts(id)         ON DELETE SET NULL,
  date                DATE        NOT NULL,
  total_sent          INTEGER     DEFAULT 0,
  total_delivered     INTEGER     DEFAULT 0,
  total_failed        INTEGER     DEFAULT 0,
  total_replies       INTEGER     DEFAULT 0,
  total_cost          DECIMAL(10,2) DEFAULT 0,
  UNIQUE(organization_id, whatsapp_account_id, date)
);

CREATE INDEX idx_daily_analytics_org  ON daily_analytics(organization_id, date DESC);

-- =====================================================
-- HELPER FUNCTIONS
-- =====================================================

-- Atomically debit wallet and record transaction
CREATE OR REPLACE FUNCTION debit_wallet(
  p_org_id     UUID,
  p_amount     DECIMAL,
  p_desc       TEXT,
  p_ref_id     TEXT DEFAULT NULL
) RETURNS DECIMAL LANGUAGE plpgsql AS $$
DECLARE
  v_balance DECIMAL;
BEGIN
  UPDATE organizations
    SET wallet_balance = wallet_balance - p_amount,
        updated_at     = NOW()
  WHERE id = p_org_id
  RETURNING wallet_balance INTO v_balance;

  INSERT INTO wallet_transactions(organization_id, type, amount, balance_after, description, reference_id)
  VALUES (p_org_id, 'message_debit', p_amount, v_balance, p_desc, p_ref_id);

  RETURN v_balance;
END;
$$;

-- Atomically credit wallet and record transaction
CREATE OR REPLACE FUNCTION credit_wallet(
  p_org_id   UUID,
  p_amount   DECIMAL,
  p_type     TEXT,   -- 'recharge' | 'refund' | 'bonus'
  p_desc     TEXT,
  p_gw_id    TEXT DEFAULT NULL
) RETURNS DECIMAL LANGUAGE plpgsql AS $$
DECLARE
  v_balance DECIMAL;
BEGIN
  UPDATE organizations
    SET wallet_balance = wallet_balance + p_amount,
        updated_at     = NOW()
  WHERE id = p_org_id
  RETURNING wallet_balance INTO v_balance;

  INSERT INTO wallet_transactions(organization_id, type, amount, balance_after, description, payment_gateway_id)
  VALUES (p_org_id, p_type, p_amount, v_balance, p_desc, p_gw_id);

  RETURN v_balance;
END;
$$;

-- Atomically increment one stat counter on a campaign row (used by webhook handler)
CREATE OR REPLACE FUNCTION increment_campaign_stat(p_campaign_id UUID, p_field TEXT)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE format(
    'UPDATE campaigns SET %I = %I + 1, updated_at = NOW() WHERE id = $1',
    p_field, p_field
  ) USING p_campaign_id;
END;
$$;

-- Upsert daily analytics rollup
CREATE OR REPLACE FUNCTION upsert_daily_analytics(
  p_org_id    UUID,
  p_wa_id     UUID,
  p_date      DATE,
  p_sent      INTEGER,
  p_delivered INTEGER,
  p_failed    INTEGER,
  p_replies   INTEGER DEFAULT 0,
  p_cost      DECIMAL DEFAULT 0
) RETURNS void LANGUAGE sql AS $$
  INSERT INTO daily_analytics
    (organization_id, whatsapp_account_id, date, total_sent, total_delivered, total_failed, total_replies, total_cost)
  VALUES
    (p_org_id, p_wa_id, p_date, p_sent, p_delivered, p_failed, p_replies, p_cost)
  ON CONFLICT (organization_id, whatsapp_account_id, date) DO UPDATE SET
    total_sent      = daily_analytics.total_sent      + EXCLUDED.total_sent,
    total_delivered = daily_analytics.total_delivered + EXCLUDED.total_delivered,
    total_failed    = daily_analytics.total_failed    + EXCLUDED.total_failed,
    total_replies   = daily_analytics.total_replies   + EXCLUDED.total_replies,
    total_cost      = daily_analytics.total_cost      + EXCLUDED.total_cost;
$$;
