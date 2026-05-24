-- =====================================================
-- CRM Schema Additions
-- Run in Supabase SQL Editor after schema.sql
-- =====================================================

-- Add CRM columns to contacts
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS crm_stage TEXT DEFAULT 'new_lead';
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS crm_score INTEGER DEFAULT 50;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS deal_value DECIMAL(12,2) DEFAULT 0;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS company TEXT;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS crm_source TEXT DEFAULT 'manual' CHECK (crm_source IN ('whatsapp','import','campaign','manual'));
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS crm_notes TEXT;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS assigned_to UUID REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_contacts_crm_stage ON contacts(user_id, crm_stage);

-- ─── CRM Activities ────────────────────────────────
CREATE TABLE IF NOT EXISTS crm_activities (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('note','call','whatsapp','email','stage_change','deal')),
  content TEXT NOT NULL,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_crm_activities_contact ON crm_activities(contact_id);
CREATE INDEX IF NOT EXISTS idx_crm_activities_user ON crm_activities(user_id);

-- ─── CRM Deals ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS crm_deals (
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

CREATE INDEX IF NOT EXISTS idx_crm_deals_user ON crm_deals(user_id);
CREATE INDEX IF NOT EXISTS idx_crm_deals_contact ON crm_deals(contact_id);

-- ─── Backfill seed data with CRM fields ────────────
UPDATE contacts SET
  crm_stage  = CASE
    WHEN tags && ARRAY['vip']      THEN 'interested'
    WHEN tags && ARRAY['customer'] THEN 'converted'
    WHEN tags && ARRAY['warm']     THEN 'qualified'
    WHEN tags && ARRAY['cold']     THEN 'new_lead'
    ELSE 'contacted'
  END,
  crm_score  = CASE
    WHEN tags && ARRAY['vip']      THEN 85 + (RANDOM() * 15)::INTEGER
    WHEN tags && ARRAY['customer'] THEN 70 + (RANDOM() * 20)::INTEGER
    WHEN tags && ARRAY['warm']     THEN 55 + (RANDOM() * 20)::INTEGER
    WHEN tags && ARRAY['cold']     THEN 20 + (RANDOM() * 20)::INTEGER
    ELSE 40 + (RANDOM() * 20)::INTEGER
  END,
  deal_value = CASE
    WHEN tags && ARRAY['vip']      THEN (5000  + (RANDOM() * 45000)::INTEGER)::DECIMAL
    WHEN tags && ARRAY['customer'] THEN (1000  + (RANDOM() * 15000)::INTEGER)::DECIMAL
    WHEN tags && ARRAY['warm']     THEN (500   + (RANDOM() * 5000)::INTEGER)::DECIMAL
    ELSE NULL
  END,
  crm_source = CASE
    WHEN tags && ARRAY['import']   THEN 'import'
    WHEN tags && ARRAY['campaign'] THEN 'campaign'
    ELSE 'manual'
  END
WHERE crm_stage = 'new_lead' OR crm_score = 50;
