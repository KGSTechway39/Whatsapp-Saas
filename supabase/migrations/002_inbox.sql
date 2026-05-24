-- =====================================================
-- Inbox Tables: conversations + messages
-- Run in Supabase SQL Editor AFTER schema.sql
-- =====================================================

-- CONVERSATIONS
CREATE TABLE IF NOT EXISTS conversations (
  id                   UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id              UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  contact_id           UUID REFERENCES contacts(id) ON DELETE SET NULL,
  whatsapp_number_id   UUID REFERENCES whatsapp_numbers(id) ON DELETE SET NULL,
  status               TEXT NOT NULL DEFAULT 'open'
                         CHECK (status IN ('open', 'resolved', 'bot_handling')),
  assigned_to          UUID REFERENCES users(id) ON DELETE SET NULL,
  unread_count         INTEGER DEFAULT 0,
  last_message_at      TIMESTAMPTZ DEFAULT NOW(),
  last_message_preview TEXT DEFAULT '',
  is_within_24h_window BOOLEAN DEFAULT FALSE,
  window_expires_at    TIMESTAMPTZ,
  contact_phone        TEXT,
  contact_name         TEXT,
  created_at           TIMESTAMPTZ DEFAULT NOW(),
  updated_at           TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_conversations_user_id ON conversations(user_id);
CREATE INDEX IF NOT EXISTS idx_conversations_last_msg ON conversations(user_id, last_message_at DESC);
CREATE INDEX IF NOT EXISTS idx_conversations_status ON conversations(user_id, status);

-- One conversation per contact per number per user
CREATE UNIQUE INDEX IF NOT EXISTS idx_conversations_unique
  ON conversations(user_id, contact_id, whatsapp_number_id)
  WHERE contact_id IS NOT NULL AND whatsapp_number_id IS NOT NULL;

-- MESSAGES
CREATE TABLE IF NOT EXISTS messages (
  id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  conversation_id    UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_id            UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  contact_id         UUID REFERENCES contacts(id) ON DELETE SET NULL,
  whatsapp_number_id UUID REFERENCES whatsapp_numbers(id) ON DELETE SET NULL,
  campaign_id        UUID REFERENCES campaigns(id) ON DELETE SET NULL,
  wa_message_id      TEXT,
  direction          TEXT NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  type               TEXT NOT NULL DEFAULT 'text',
  content            JSONB DEFAULT '{}',
  status             TEXT NOT NULL DEFAULT 'pending'
                       CHECK (status IN ('pending', 'sent', 'delivered', 'read', 'failed')),
  error_message      TEXT,
  sent_at            TIMESTAMPTZ,
  delivered_at       TIMESTAMPTZ,
  read_at            TIMESTAMPTZ,
  created_at         TIMESTAMPTZ DEFAULT NOW(),
  updated_at         TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_messages_conv_created ON messages(conversation_id, created_at);
CREATE INDEX IF NOT EXISTS idx_messages_wa_id ON messages(wa_message_id) WHERE wa_message_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_messages_user_id ON messages(user_id);

-- RPC used by webhook to atomically bump campaign counters
CREATE OR REPLACE FUNCTION increment_campaign_stat(
  p_campaign_id UUID,
  p_field       TEXT
) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE format('UPDATE campaigns SET %I = %I + 1 WHERE id = $1', p_field, p_field)
  USING p_campaign_id;
END;
$$;

-- Enable Supabase Realtime on inbox tables
ALTER PUBLICATION supabase_realtime ADD TABLE conversations;
ALTER PUBLICATION supabase_realtime ADD TABLE messages;

-- =====================================================
-- Demo seed data for inbox (uses fixed demo user ID)
-- =====================================================
DO $$
DECLARE
  v_uid   UUID := 'a1b2c3d4-0000-0000-0000-000000000001';
  v_wn1   UUID := 'b1000000-0000-0000-0000-000000000001';
  v_wn2   UUID := 'b1000000-0000-0000-0000-000000000002';
  c1 UUID; c2 UUID; c3 UUID; c4 UUID; c5 UUID;
  conv1 UUID; conv2 UUID; conv3 UUID; conv4 UUID; conv5 UUID;
BEGIN
  -- only seed if user exists
  IF NOT EXISTS (SELECT 1 FROM users WHERE id = v_uid) THEN RETURN; END IF;

  -- Delete old demo inbox data
  DELETE FROM messages      WHERE user_id = v_uid;
  DELETE FROM conversations WHERE user_id = v_uid;

  -- Get a few contact IDs
  SELECT id INTO c1 FROM contacts WHERE user_id = v_uid ORDER BY created_at LIMIT 1 OFFSET 0;
  SELECT id INTO c2 FROM contacts WHERE user_id = v_uid ORDER BY created_at LIMIT 1 OFFSET 1;
  SELECT id INTO c3 FROM contacts WHERE user_id = v_uid ORDER BY created_at LIMIT 1 OFFSET 2;
  SELECT id INTO c4 FROM contacts WHERE user_id = v_uid ORDER BY created_at LIMIT 1 OFFSET 3;
  SELECT id INTO c5 FROM contacts WHERE user_id = v_uid ORDER BY created_at LIMIT 1 OFFSET 4;

  IF c1 IS NULL THEN RETURN; END IF;

  -- Create conversations
  INSERT INTO conversations (id, user_id, contact_id, whatsapp_number_id, status,
    unread_count, last_message_at, last_message_preview,
    is_within_24h_window, window_expires_at, contact_phone, contact_name)
  SELECT
    gen_random_uuid(), v_uid, c1, v_wn1, 'open',
    3, NOW() - INTERVAL '5 minutes', 'Yes, I''d like to know more about the pricing',
    TRUE, NOW() + INTERVAL '22 hours',
    phone, name
  FROM contacts WHERE id = c1
  RETURNING id INTO conv1;

  INSERT INTO conversations (id, user_id, contact_id, whatsapp_number_id, status,
    unread_count, last_message_at, last_message_preview,
    is_within_24h_window, window_expires_at, contact_phone, contact_name)
  SELECT
    gen_random_uuid(), v_uid, c2, v_wn1, 'open',
    1, NOW() - INTERVAL '2 hours', 'Can you send me the catalogue?',
    TRUE, NOW() + INTERVAL '20 hours',
    phone, name
  FROM contacts WHERE id = c2
  RETURNING id INTO conv2;

  INSERT INTO conversations (id, user_id, contact_id, whatsapp_number_id, status,
    unread_count, last_message_at, last_message_preview,
    is_within_24h_window, window_expires_at, contact_phone, contact_name)
  SELECT
    gen_random_uuid(), v_uid, c3, v_wn2, 'open',
    0, NOW() - INTERVAL '6 hours', 'Thank you! I''ll place the order today.',
    TRUE, NOW() + INTERVAL '18 hours',
    phone, name
  FROM contacts WHERE id = c3
  RETURNING id INTO conv3;

  INSERT INTO conversations (id, user_id, contact_id, whatsapp_number_id, status,
    unread_count, last_message_at, last_message_preview,
    is_within_24h_window, window_expires_at, contact_phone, contact_name)
  SELECT
    gen_random_uuid(), v_uid, c4, v_wn1, 'bot_handling',
    2, NOW() - INTERVAL '30 minutes', 'HELP',
    TRUE, NOW() + INTERVAL '23 hours',
    phone, name
  FROM contacts WHERE id = c4
  RETURNING id INTO conv4;

  INSERT INTO conversations (id, user_id, contact_id, whatsapp_number_id, status,
    unread_count, last_message_at, last_message_preview,
    is_within_24h_window, window_expires_at, contact_phone, contact_name)
  SELECT
    gen_random_uuid(), v_uid, c5, v_wn1, 'resolved',
    0, NOW() - INTERVAL '2 days', 'Got it, thank you!',
    FALSE, NOW() - INTERVAL '1 day',
    phone, name
  FROM contacts WHERE id = c5
  RETURNING id INTO conv5;

  -- Messages for conv1
  INSERT INTO messages (conversation_id, user_id, contact_id, whatsapp_number_id, direction, type, content, status, sent_at, delivered_at) VALUES
  (conv1, v_uid, c1, v_wn1, 'outbound', 'template', '{"body": "Hi Priya! 👋 Welcome to TechSell Solutions. We''re excited to have you on board!", "template_name": "welcome_new_user"}'::jsonb, 'read', NOW() - INTERVAL '2 hours', NOW() - INTERVAL '2 hours'),
  (conv1, v_uid, c1, v_wn1, 'inbound',  'text',     '{"body": "Hi! Thanks for reaching out."}'::jsonb, 'delivered', NOW() - INTERVAL '1 hour 50 minutes', NOW() - INTERVAL '1 hour 50 minutes'),
  (conv1, v_uid, c1, v_wn1, 'outbound', 'text',     '{"body": "Great to hear from you! How can I help you today?"}'::jsonb, 'read', NOW() - INTERVAL '1 hour 45 minutes', NOW() - INTERVAL '1 hour 45 minutes'),
  (conv1, v_uid, c1, v_wn1, 'inbound',  'text',     '{"body": "I wanted to ask about your premium plan pricing"}'::jsonb, 'delivered', NOW() - INTERVAL '20 minutes', NOW() - INTERVAL '20 minutes'),
  (conv1, v_uid, c1, v_wn1, 'outbound', 'text',     '{"body": "Sure! Our plans start from ₹999/month. Shall I send you the full details?"}'::jsonb, 'delivered', NOW() - INTERVAL '15 minutes', NOW() - INTERVAL '15 minutes'),
  (conv1, v_uid, c1, v_wn1, 'inbound',  'text',     '{"body": "Yes, I''d like to know more about the pricing"}'::jsonb, 'delivered', NOW() - INTERVAL '5 minutes', NOW() - INTERVAL '5 minutes');

  -- Messages for conv2
  INSERT INTO messages (conversation_id, user_id, contact_id, whatsapp_number_id, direction, type, content, status, sent_at, delivered_at) VALUES
  (conv2, v_uid, c2, v_wn1, 'outbound', 'text', '{"body": "Hello Rajesh! How can we help you today?"}'::jsonb, 'read', NOW() - INTERVAL '3 hours', NOW() - INTERVAL '3 hours'),
  (conv2, v_uid, c2, v_wn1, 'inbound',  'text', '{"body": "I saw your ad on Instagram, very interesting"}'::jsonb, 'delivered', NOW() - INTERVAL '2 hours 30 minutes', NOW() - INTERVAL '2 hours 30 minutes'),
  (conv2, v_uid, c2, v_wn1, 'inbound',  'text', '{"body": "Can you send me the catalogue?"}'::jsonb, 'delivered', NOW() - INTERVAL '2 hours', NOW() - INTERVAL '2 hours');

  -- Messages for conv3
  INSERT INTO messages (conversation_id, user_id, contact_id, whatsapp_number_id, direction, type, content, status, sent_at, delivered_at) VALUES
  (conv3, v_uid, c3, v_wn2, 'outbound', 'template', '{"body": "Hi Sunita, your order #ORD-2847 has been confirmed! Total: ₹4,500.", "template_name": "order_confirmation"}'::jsonb, 'read', NOW() - INTERVAL '7 hours', NOW() - INTERVAL '7 hours'),
  (conv3, v_uid, c3, v_wn2, 'inbound',  'text',     '{"body": "Wow that was fast! Thank you"}'::jsonb, 'delivered', NOW() - INTERVAL '6 hours 30 minutes', NOW() - INTERVAL '6 hours 30 minutes'),
  (conv3, v_uid, c3, v_wn2, 'inbound',  'text',     '{"body": "Thank you! I''ll place the order today."}'::jsonb, 'delivered', NOW() - INTERVAL '6 hours', NOW() - INTERVAL '6 hours');

  -- Messages for conv4 (bot handling)
  INSERT INTO messages (conversation_id, user_id, contact_id, whatsapp_number_id, direction, type, content, status, sent_at, delivered_at) VALUES
  (conv4, v_uid, c4, v_wn1, 'inbound', 'text', '{"body": "HELP"}'::jsonb, 'delivered', NOW() - INTERVAL '35 minutes', NOW() - INTERVAL '35 minutes'),
  (conv4, v_uid, c4, v_wn1, 'outbound', 'text', '{"body": "🤖 Hi! I''m the TechSell assistant. How can I help you?\n1. Product info\n2. Order status\n3. Talk to agent"}'::jsonb, 'delivered', NOW() - INTERVAL '34 minutes', NOW() - INTERVAL '34 minutes'),
  (conv4, v_uid, c4, v_wn1, 'inbound', 'text', '{"body": "2"}'::jsonb, 'delivered', NOW() - INTERVAL '30 minutes', NOW() - INTERVAL '30 minutes');

  -- Update unread counts correctly (inbound unread messages)
  UPDATE conversations SET unread_count = 3 WHERE id = conv1;
  UPDATE conversations SET unread_count = 1 WHERE id = conv2;
  UPDATE conversations SET unread_count = 2 WHERE id = conv4;

END $$;
