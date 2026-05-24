-- =====================================================
-- WASend Platform — Full Schema (consolidated)
-- Run this ONCE in your Supabase SQL Editor
-- Includes: base tables, CRM, subscriptions, helpers
-- =====================================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Drop old triggers/functions tied to auth.users (ignore errors)
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
DROP TRIGGER IF EXISTS on_auth_user_created_wallet ON auth.users;
DROP FUNCTION IF EXISTS handle_new_user();
DROP FUNCTION IF EXISTS handle_new_user_wallet();

-- Drop all tables (order matters for FK constraints)
DROP TABLE IF EXISTS cart_items CASCADE;
DROP TABLE IF EXISTS carts CASCADE;
DROP TABLE IF EXISTS products CASCADE;
DROP TABLE IF EXISTS commerce_connections CASCADE;
DROP TABLE IF EXISTS segments CASCADE;
DROP TABLE IF EXISTS ad_leads CASCADE;
DROP TABLE IF EXISTS ad_campaigns CASCADE;
DROP TABLE IF EXISTS ad_accounts CASCADE;
DROP TABLE IF EXISTS crm_activities CASCADE;
DROP TABLE IF EXISTS crm_deals CASCADE;
DROP TABLE IF EXISTS daily_analytics CASCADE;
DROP TABLE IF EXISTS team_members CASCADE;
DROP TABLE IF EXISTS transactions CASCADE;
DROP TABLE IF EXISTS subscriptions CASCADE;
DROP TABLE IF EXISTS wallet CASCADE;
DROP TABLE IF EXISTS automations CASCADE;
DROP TABLE IF EXISTS campaign_messages CASCADE;
DROP TABLE IF EXISTS campaigns CASCADE;
DROP TABLE IF EXISTS templates CASCADE;
DROP TABLE IF EXISTS contacts CASCADE;
DROP TABLE IF EXISTS whatsapp_numbers CASCADE;
DROP TABLE IF EXISTS profiles CASCADE;
DROP TABLE IF EXISTS users CASCADE;

-- =====================================================
-- USERS (custom auth — no Supabase Auth dependency)
-- =====================================================
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  full_name TEXT NOT NULL DEFAULT '',
  company_name TEXT NOT NULL DEFAULT '',
  phone TEXT,
  timezone TEXT DEFAULT 'Asia/Kolkata (IST)',
  avatar_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_users_email ON users(email);

-- =====================================================
-- WHATSAPP NUMBERS
-- =====================================================
CREATE TABLE whatsapp_numbers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  phone_number TEXT NOT NULL,
  display_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  daily_limit INTEGER DEFAULT 1000,
  messages_sent INTEGER DEFAULT 0,
  connected_date TIMESTAMPTZ DEFAULT NOW(),
  meta_app_id TEXT,
  meta_app_secret TEXT,
  waba_id TEXT,
  phone_number_id TEXT,
  access_token TEXT,
  webhook_verified BOOLEAN DEFAULT FALSE,
  is_primary BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_whatsapp_numbers_user_id ON whatsapp_numbers(user_id);

-- =====================================================
-- CONTACTS (with CRM columns)
-- =====================================================
CREATE TABLE contacts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  email TEXT,
  contact_group TEXT,
  tags TEXT[] DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  last_contacted TIMESTAMPTZ,
  added_date TIMESTAMPTZ DEFAULT NOW(),
  -- CRM fields
  crm_stage TEXT DEFAULT 'new_lead',
  crm_score INTEGER DEFAULT 50,
  deal_value DECIMAL(12,2) DEFAULT 0,
  company TEXT,
  crm_source TEXT DEFAULT 'manual' CHECK (crm_source IN ('whatsapp','import','campaign','manual','ctwa')),
  crm_notes TEXT,
  assigned_to UUID REFERENCES users(id) ON DELETE SET NULL,
  -- CTWA (Click-to-WhatsApp Ads) attribution
  ctwa_campaign_id TEXT,
  ctwa_ad_id TEXT,
  ctwa_campaign_name TEXT,
  ctwa_clicked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, phone)
);

CREATE INDEX idx_contacts_user_id ON contacts(user_id);
CREATE INDEX idx_contacts_phone ON contacts(user_id, phone);
CREATE INDEX idx_contacts_crm_stage ON contacts(user_id, crm_stage);
CREATE INDEX idx_contacts_ctwa_campaign ON contacts(user_id, ctwa_campaign_id) WHERE ctwa_campaign_id IS NOT NULL;

-- =====================================================
-- CRM ACTIVITIES
-- =====================================================
CREATE TABLE crm_activities (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('note','call','whatsapp','email','stage_change','deal')),
  content TEXT NOT NULL,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_crm_activities_contact ON crm_activities(contact_id);
CREATE INDEX idx_crm_activities_user ON crm_activities(user_id);

-- =====================================================
-- CRM DEALS
-- =====================================================
CREATE TABLE crm_deals (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  value DECIMAL(12,2) DEFAULT 0,
  stage TEXT NOT NULL DEFAULT 'prospecting' CHECK (stage IN ('prospecting','qualification','proposal','negotiation','closed_won','closed_lost')),
  probability INTEGER DEFAULT 20 CHECK (probability BETWEEN 0 AND 100),
  expected_close DATE,
  notes TEXT,
  won_at TIMESTAMPTZ,
  lost_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_crm_deals_user ON crm_deals(user_id);
CREATE INDEX idx_crm_deals_contact ON crm_deals(contact_id);

-- =====================================================
-- TEMPLATES
-- =====================================================
CREATE TABLE templates (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  display_name TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('MARKETING', 'UTILITY', 'AUTHENTICATION')),
  language TEXT DEFAULT 'en_IN',
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('APPROVED', 'PENDING', 'REJECTED')),
  body TEXT NOT NULL,
  variables TEXT[] DEFAULT '{}',
  meta_template_id TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_templates_user_id ON templates(user_id);

-- =====================================================
-- CAMPAIGNS
-- =====================================================
CREATE TABLE campaigns (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'scheduled', 'running', 'completed', 'failed')),
  template_id UUID REFERENCES templates(id) ON DELETE SET NULL,
  template_name TEXT,
  whatsapp_number_id UUID REFERENCES whatsapp_numbers(id) ON DELETE SET NULL,
  audience_type TEXT CHECK (audience_type IN ('all', 'group', 'tags', 'csv')),
  group_name TEXT,
  tags TEXT[] DEFAULT '{}',
  recipients_count INTEGER DEFAULT 0,
  sent_count INTEGER DEFAULT 0,
  delivered_count INTEGER DEFAULT 0,
  failed_count INTEGER DEFAULT 0,
  read_count INTEGER DEFAULT 0,
  scheduled_at TIMESTAMPTZ,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  cost DECIMAL(10,2) DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_campaigns_user_id ON campaigns(user_id);

-- =====================================================
-- CAMPAIGN MESSAGES
-- =====================================================
CREATE TABLE campaign_messages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  campaign_id UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
  phone TEXT NOT NULL,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'delivered', 'failed', 'read')),
  sent_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  read_at TIMESTAMPTZ,
  meta_message_id TEXT,
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_campaign_messages_campaign_id ON campaign_messages(campaign_id);
CREATE INDEX idx_campaign_messages_meta_id ON campaign_messages(meta_message_id);

-- =====================================================
-- AUTOMATIONS
-- =====================================================
CREATE TABLE automations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  is_active BOOLEAN DEFAULT TRUE,
  trigger_type TEXT NOT NULL CHECK (trigger_type IN ('new_contact', 'keyword', 'date_based', 'inactivity')),
  trigger_value TEXT,
  action_type TEXT NOT NULL CHECK (action_type IN ('send_template', 'add_to_group', 'apply_tag', 'wait_then_send')),
  action_template_id UUID REFERENCES templates(id) ON DELETE SET NULL,
  action_group_name TEXT,
  action_tag TEXT,
  action_delay_hours INTEGER,
  last_triggered TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_automations_user_id ON automations(user_id);

-- =====================================================
-- WALLET
-- =====================================================
CREATE TABLE wallet (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  balance DECIMAL(10,2) DEFAULT 0,
  currency TEXT DEFAULT 'INR',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- =====================================================
-- TRANSACTIONS
-- =====================================================
CREATE TABLE transactions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('credit', 'debit')),
  description TEXT NOT NULL,
  amount DECIMAL(10,2) NOT NULL,
  balance_after DECIMAL(10,2) NOT NULL,
  payment_method TEXT,
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_transactions_user_id ON transactions(user_id);

-- =====================================================
-- SUBSCRIPTIONS (Razorpay billing)
-- =====================================================
CREATE TABLE subscriptions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  plan_id TEXT NOT NULL DEFAULT 'free',
  billing_cycle TEXT DEFAULT 'monthly' CHECK (billing_cycle IN ('monthly', 'yearly')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'pending', 'cancelled', 'past_due', 'trialing')),
  razorpay_subscription_id TEXT UNIQUE,
  razorpay_customer_id TEXT,
  current_period_start TIMESTAMPTZ,
  current_period_end TIMESTAMPTZ,
  cancel_at_period_end BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_subscriptions_user_id ON subscriptions(user_id);
CREATE INDEX idx_subscriptions_razorpay_id ON subscriptions(razorpay_subscription_id);

-- =====================================================
-- TEAM MEMBERS
-- =====================================================
CREATE TABLE team_members (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'agent' CHECK (role IN ('owner', 'admin', 'agent')),
  status TEXT NOT NULL DEFAULT 'invited' CHECK (status IN ('active', 'invited', 'inactive')),
  avatar_url TEXT,
  joined_date TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_team_members_owner_id ON team_members(owner_id);

-- =====================================================
-- DAILY ANALYTICS (rollup)
-- =====================================================
CREATE TABLE daily_analytics (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  total_sent INTEGER DEFAULT 0,
  total_delivered INTEGER DEFAULT 0,
  total_failed INTEGER DEFAULT 0,
  total_replies INTEGER DEFAULT 0,
  total_cost DECIMAL(10,2) DEFAULT 0,
  UNIQUE(user_id, date)
);

CREATE INDEX idx_daily_analytics_user_date ON daily_analytics(user_id, date);

-- =====================================================
-- AD ACCOUNTS (Facebook / Meta Ads connection)
-- =====================================================
CREATE TABLE ad_accounts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  fb_account_id TEXT NOT NULL,             -- e.g. act_1234567890
  account_name TEXT,
  business_id TEXT,
  access_token TEXT NOT NULL,              -- long-lived FB access token
  token_expires_at TIMESTAMPTZ,
  currency TEXT DEFAULT 'INR',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','expired','disconnected')),
  last_synced_at TIMESTAMPTZ,
  connected_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, fb_account_id)
);

CREATE INDEX idx_ad_accounts_user ON ad_accounts(user_id);

-- =====================================================
-- AD CAMPAIGNS (synced from Meta Ads)
-- =====================================================
CREATE TABLE ad_campaigns (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ad_account_id UUID NOT NULL REFERENCES ad_accounts(id) ON DELETE CASCADE,
  fb_campaign_id TEXT NOT NULL,
  name TEXT NOT NULL,
  objective TEXT,                          -- e.g. MESSAGES, OUTCOME_TRAFFIC
  status TEXT,                             -- ACTIVE, PAUSED, etc.
  -- Tracking tag — appears in WhatsApp ad referral payload
  ctwa_clid TEXT,
  -- Insights (synced from FB)
  spend NUMERIC(12,2) DEFAULT 0,
  impressions INTEGER DEFAULT 0,
  clicks INTEGER DEFAULT 0,
  ctr NUMERIC(5,2) DEFAULT 0,
  cpm NUMERIC(8,2) DEFAULT 0,
  -- Internal attribution counts
  leads_count INTEGER DEFAULT 0,           -- contacts created via this campaign
  messages_sent INTEGER DEFAULT 0,         -- messages we've sent to those leads
  conversions_count INTEGER DEFAULT 0,     -- leads that became 'converted' in CRM
  conversion_value NUMERIC(12,2) DEFAULT 0,
  start_date DATE,
  end_date DATE,
  last_synced_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, fb_campaign_id)
);

CREATE INDEX idx_ad_campaigns_user ON ad_campaigns(user_id);
CREATE INDEX idx_ad_campaigns_account ON ad_campaigns(ad_account_id);
CREATE INDEX idx_ad_campaigns_clid ON ad_campaigns(ctwa_clid);

-- =====================================================
-- AD LEADS (CTWA referral events from WhatsApp webhook)
-- =====================================================
CREATE TABLE ad_leads (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ad_campaign_id UUID REFERENCES ad_campaigns(id) ON DELETE SET NULL,
  contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
  phone TEXT NOT NULL,
  ctwa_clid TEXT,
  fb_campaign_id TEXT,
  fb_ad_id TEXT,
  source_url TEXT,
  body TEXT,                               -- first message body
  raw_referral JSONB,                      -- full Meta referral payload
  is_new_contact BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_ad_leads_user ON ad_leads(user_id);
CREATE INDEX idx_ad_leads_campaign ON ad_leads(ad_campaign_id);
CREATE INDEX idx_ad_leads_contact ON ad_leads(contact_id);

-- =====================================================
-- SEGMENTS (saved customer segments with rule-based filters)
-- =====================================================
-- Rules schema (JSONB):
-- {
--   "operator": "AND" | "OR",
--   "conditions": [
--     { "field": "tags",          "op": "contains",     "value": "vip" },
--     { "field": "crm_stage",     "op": "equals",       "value": "converted" },
--     { "field": "deal_value",    "op": "gte",          "value": 5000 },
--     { "field": "last_contacted","op": "within_days",  "value": 30 },
--     { "field": "last_contacted","op": "older_than",   "value": 90 },
--     { "field": "added_date",    "op": "within_days",  "value": 7 },
--     { "field": "ctwa_campaign_id","op": "exists",     "value": null }
--   ]
-- }
CREATE TABLE segments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  color TEXT DEFAULT 'blue',                 -- blue | emerald | amber | red | violet | fuchsia
  icon TEXT DEFAULT 'users',                 -- lucide icon name
  rules JSONB NOT NULL DEFAULT '{"operator":"AND","conditions":[]}'::jsonb,
  is_system BOOLEAN DEFAULT FALSE,           -- TRUE for built-in (Active/Dormant/New/VIP)
  cached_count INTEGER DEFAULT 0,
  cached_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_segments_user ON segments(user_id);

-- =====================================================
-- COMMERCE CONNECTIONS (Shopify / WooCommerce / Manual)
-- =====================================================
CREATE TABLE commerce_connections (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('shopify','woocommerce','manual')),
  shop_domain TEXT,                        -- mystore.myshopify.com OR yourstore.com
  access_token TEXT,                       -- OAuth token (Shopify) or API key (Woo)
  api_secret TEXT,                         -- Woo consumer secret
  scope TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','expired','disconnected')),
  last_synced_at TIMESTAMPTZ,
  product_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_commerce_user ON commerce_connections(user_id);

-- =====================================================
-- PRODUCTS (catalog — synced or manual)
-- =====================================================
CREATE TABLE products (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  connection_id UUID REFERENCES commerce_connections(id) ON DELETE SET NULL,
  external_id TEXT,                        -- Shopify product ID / Woo product ID
  sku TEXT,
  name TEXT NOT NULL,
  description TEXT,
  price NUMERIC(10,2) NOT NULL DEFAULT 0,
  compare_at_price NUMERIC(10,2),          -- "was" price for sale display
  currency TEXT DEFAULT 'INR',
  image_url TEXT,
  product_url TEXT,
  category TEXT,
  tags TEXT[] DEFAULT '{}',
  in_stock BOOLEAN DEFAULT TRUE,
  inventory_count INTEGER,
  status TEXT DEFAULT 'active' CHECK (status IN ('active','archived','out_of_stock')),
  meta_catalog_id TEXT,                    -- if synced to Meta Commerce Catalog
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, external_id, connection_id)
);

CREATE INDEX idx_products_user ON products(user_id);
CREATE INDEX idx_products_status ON products(user_id, status);

-- =====================================================
-- CARTS (for abandoned cart recovery)
-- =====================================================
CREATE TABLE carts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  contact_id UUID REFERENCES contacts(id) ON DELETE CASCADE,
  external_id TEXT,                        -- Shopify checkout token / Woo order ID
  status TEXT DEFAULT 'active' CHECK (status IN ('active','abandoned','recovered','converted')),
  total NUMERIC(10,2) DEFAULT 0,
  currency TEXT DEFAULT 'INR',
  items_count INTEGER DEFAULT 0,
  checkout_url TEXT,
  abandoned_at TIMESTAMPTZ,
  recovered_at TIMESTAMPTZ,
  recovery_message_sent_at TIMESTAMPTZ,
  recovery_attempts INTEGER DEFAULT 0,
  last_activity_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_carts_user ON carts(user_id);
CREATE INDEX idx_carts_contact ON carts(contact_id);
CREATE INDEX idx_carts_status ON carts(user_id, status);

CREATE TABLE cart_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  cart_id UUID NOT NULL REFERENCES carts(id) ON DELETE CASCADE,
  product_id UUID REFERENCES products(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  quantity INTEGER DEFAULT 1,
  price NUMERIC(10,2) NOT NULL DEFAULT 0,
  image_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_cart_items_cart ON cart_items(cart_id);

-- =====================================================
-- HELPER FUNCTIONS
-- =====================================================

CREATE OR REPLACE FUNCTION increment_messages_sent(number_id UUID)
RETURNS void LANGUAGE sql AS $$
  UPDATE whatsapp_numbers SET messages_sent = messages_sent + 1 WHERE id = number_id;
$$;

CREATE OR REPLACE FUNCTION upsert_daily_analytics(
  p_user_id UUID,
  p_date DATE,
  p_sent INTEGER,
  p_delivered INTEGER,
  p_failed INTEGER
) RETURNS void LANGUAGE sql AS $$
  INSERT INTO daily_analytics (user_id, date, total_sent, total_delivered, total_failed)
  VALUES (p_user_id, p_date, p_sent, p_delivered, p_failed)
  ON CONFLICT (user_id, date)
  DO UPDATE SET
    total_sent      = daily_analytics.total_sent      + EXCLUDED.total_sent,
    total_delivered = daily_analytics.total_delivered + EXCLUDED.total_delivered,
    total_failed    = daily_analytics.total_failed    + EXCLUDED.total_failed;
$$;
