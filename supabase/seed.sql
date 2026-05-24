-- =====================================================
-- WASend — Seed Data for Testing
-- Test login: admin@wasend.demo / Test@12345
-- Run in Supabase SQL Editor AFTER schema.sql
-- =====================================================

-- Clean up any existing seed data
DELETE FROM crm_activities   WHERE user_id IN (SELECT id FROM users WHERE email = 'admin@wasend.demo');
DELETE FROM crm_deals        WHERE user_id IN (SELECT id FROM users WHERE email = 'admin@wasend.demo');
DELETE FROM daily_analytics  WHERE user_id IN (SELECT id FROM users WHERE email = 'admin@wasend.demo');
DELETE FROM transactions     WHERE user_id IN (SELECT id FROM users WHERE email = 'admin@wasend.demo');
DELETE FROM team_members     WHERE owner_id IN (SELECT id FROM users WHERE email = 'admin@wasend.demo');
DELETE FROM subscriptions    WHERE user_id IN (SELECT id FROM users WHERE email = 'admin@wasend.demo');
DELETE FROM campaign_messages WHERE campaign_id IN (SELECT id FROM campaigns WHERE user_id IN (SELECT id FROM users WHERE email = 'admin@wasend.demo'));
DELETE FROM campaigns        WHERE user_id IN (SELECT id FROM users WHERE email = 'admin@wasend.demo');
DELETE FROM automations      WHERE user_id IN (SELECT id FROM users WHERE email = 'admin@wasend.demo');
DELETE FROM templates        WHERE user_id IN (SELECT id FROM users WHERE email = 'admin@wasend.demo');
DELETE FROM contacts         WHERE user_id IN (SELECT id FROM users WHERE email = 'admin@wasend.demo');
DELETE FROM whatsapp_numbers WHERE user_id IN (SELECT id FROM users WHERE email = 'admin@wasend.demo');
DELETE FROM wallet           WHERE user_id IN (SELECT id FROM users WHERE email = 'admin@wasend.demo');
DELETE FROM users            WHERE email = 'admin@wasend.demo';

-- =====================================================
-- USER
-- =====================================================
INSERT INTO users (id, email, password_hash, full_name, company_name, phone, timezone)
VALUES (
  'a1b2c3d4-0000-0000-0000-000000000001',
  'admin@wasend.demo',
  '$2b$12$nH2GwSd0w4dLDGK0ifh6EuJRzmB6wqpPSkCoYnDLIYbVT2Zaufcl.',  -- Test@12345
  'Arjun Sharma',
  'TechSell Solutions',
  '+91 98765 43210',
  'Asia/Kolkata (IST)'
);

-- =====================================================
-- WALLET
-- =====================================================
INSERT INTO wallet (user_id, balance, currency)
VALUES ('a1b2c3d4-0000-0000-0000-000000000001', 4850.00, 'INR');

-- =====================================================
-- SUBSCRIPTION (Pro plan)
-- =====================================================
INSERT INTO subscriptions (user_id, plan_id, billing_cycle, status)
VALUES ('a1b2c3d4-0000-0000-0000-000000000001', 'pro', 'monthly', 'active');

-- =====================================================
-- WHATSAPP NUMBERS
-- =====================================================
INSERT INTO whatsapp_numbers (id, user_id, phone_number, display_name, status, daily_limit, messages_sent, waba_id, phone_number_id, access_token, is_primary, webhook_verified)
VALUES
  ('b1000000-0000-0000-0000-000000000001', 'a1b2c3d4-0000-0000-0000-000000000001',
   '+91 98765 43210', 'TechSell Main', 'active', 1000, 3842,
   '123456789012345', '987654321098765', 'EAABs__DEMO_TOKEN_PRIMARY__xyzabc123',
   TRUE, TRUE),
  ('b1000000-0000-0000-0000-000000000002', 'a1b2c3d4-0000-0000-0000-000000000001',
   '+91 91234 56789', 'TechSell Support', 'active', 500, 1204,
   '123456789012345', '112233445566778', 'EAABs__DEMO_TOKEN_SUPPORT__xyzabc456',
   FALSE, TRUE);

-- =====================================================
-- TEMPLATES
-- =====================================================
INSERT INTO templates (id, user_id, name, display_name, category, language, status, body, variables)
VALUES
  ('c1000000-0000-0000-0000-000000000001', 'a1b2c3d4-0000-0000-0000-000000000001',
   'welcome_new_user', 'Welcome New User', 'MARKETING', 'en_IN', 'APPROVED',
   'Hi {{1}}! 👋 Welcome to TechSell Solutions. We''re excited to have you on board. Explore our latest deals at techsell.in and get 10% off your first order with code WELCOME10.',
   ARRAY['customer_name']),

  ('c1000000-0000-0000-0000-000000000002', 'a1b2c3d4-0000-0000-0000-000000000001',
   'order_confirmation', 'Order Confirmation', 'UTILITY', 'en_IN', 'APPROVED',
   'Hi {{1}}, your order #{{2}} has been confirmed! 🎉 Total: ₹{{3}}. Expected delivery: {{4}}. Track your order at techsell.in/track. Thank you for shopping with us!',
   ARRAY['customer_name', 'order_id', 'amount', 'delivery_date']),

  ('c1000000-0000-0000-0000-000000000003', 'a1b2c3d4-0000-0000-0000-000000000001',
   'flash_sale_alert', 'Flash Sale Alert', 'MARKETING', 'en_IN', 'APPROVED',
   '🔥 FLASH SALE ALERT! {{1}}, grab up to {{2}}% OFF on selected products. Hurry! Offer valid only till {{3}}. Shop now 👉 techsell.in/sale',
   ARRAY['customer_name', 'discount_percent', 'expiry_date']),

  ('c1000000-0000-0000-0000-000000000004', 'a1b2c3d4-0000-0000-0000-000000000001',
   'appointment_reminder', 'Appointment Reminder', 'UTILITY', 'en_IN', 'APPROVED',
   'Hi {{1}}, this is a reminder for your appointment on {{2}} at {{3}}. Please reply CONFIRM to confirm or CANCEL to reschedule. See you soon! 🗓️',
   ARRAY['customer_name', 'date', 'time']),

  ('c1000000-0000-0000-0000-000000000005', 'a1b2c3d4-0000-0000-0000-000000000001',
   'payment_due_reminder', 'Payment Due Reminder', 'UTILITY', 'en_IN', 'PENDING',
   'Hi {{1}}, your payment of ₹{{2}} is due on {{3}}. Please make the payment to avoid service interruption. Pay now at techsell.in/pay',
   ARRAY['customer_name', 'amount', 'due_date']),

  ('c1000000-0000-0000-0000-000000000006', 'a1b2c3d4-0000-0000-0000-000000000001',
   'diwali_special_offer', 'Diwali Special Offer', 'MARKETING', 'en_IN', 'REJECTED',
   '🪔 Diwali Dhamaka! {{1}}, celebrate with flat ₹{{2}} OFF on orders above ₹999. Use code DIWALI{{3}}. Shop at techsell.in 🎆',
   ARRAY['customer_name', 'discount_amount', 'year']);

-- =====================================================
-- CONTACTS (60 contacts across groups with CRM data)
-- =====================================================
INSERT INTO contacts (user_id, name, phone, email, contact_group, tags, status, last_contacted, crm_stage, crm_score, deal_value, crm_source) VALUES
-- VIP Clients (15)
('a1b2c3d4-0000-0000-0000-000000000001', 'Priya Mehta',      '+919876543201', 'priya@example.com',    'VIP Clients', ARRAY['vip','customer'],  'active', NOW() - INTERVAL '2 days',  'interested',  90, 32000, 'manual'),
('a1b2c3d4-0000-0000-0000-000000000001', 'Rajesh Kumar',     '+919876543202', 'rajesh@example.com',   'VIP Clients', ARRAY['vip','lead'],      'active', NOW() - INTERVAL '5 days',  'qualified',   85, 28000, 'manual'),
('a1b2c3d4-0000-0000-0000-000000000001', 'Sunita Patel',     '+919876543203', 'sunita@example.com',   'VIP Clients', ARRAY['vip','customer'],  'active', NOW() - INTERVAL '1 day',   'converted',   95, 45000, 'campaign'),
('a1b2c3d4-0000-0000-0000-000000000001', 'Amit Singh',       '+919876543204', 'amit@example.com',     'VIP Clients', ARRAY['vip'],             'active', NOW() - INTERVAL '3 days',  'interested',  88, 15000, 'whatsapp'),
('a1b2c3d4-0000-0000-0000-000000000001', 'Kavya Reddy',      '+919876543205', 'kavya@example.com',    'VIP Clients', ARRAY['vip','customer'],  'active', NOW() - INTERVAL '1 day',   'converted',   92, 38000, 'manual'),
('a1b2c3d4-0000-0000-0000-000000000001', 'Deepak Nair',      '+919876543206', 'deepak@example.com',   'VIP Clients', ARRAY['vip'],             'active', NOW() - INTERVAL '7 days',  'qualified',   82, 22000, 'import'),
('a1b2c3d4-0000-0000-0000-000000000001', 'Ananya Sharma',    '+919876543207', 'ananya@example.com',   'VIP Clients', ARRAY['vip','lead'],      'active', NOW() - INTERVAL '4 days',  'interested',  87, 19000, 'manual'),
('a1b2c3d4-0000-0000-0000-000000000001', 'Vikram Joshi',     '+919876543208', 'vikram@example.com',   'VIP Clients', ARRAY['vip','customer'],  'active', NOW() - INTERVAL '6 days',  'converted',   91, 41000, 'campaign'),
('a1b2c3d4-0000-0000-0000-000000000001', 'Meera Iyer',       '+919876543209', 'meera@example.com',    'VIP Clients', ARRAY['vip'],             'active', NOW() - INTERVAL '2 days',  'qualified',   84, 17000, 'whatsapp'),
('a1b2c3d4-0000-0000-0000-000000000001', 'Suresh Babu',      '+919876543210', 'suresh@example.com',   'VIP Clients', ARRAY['vip','customer'],  'active', NOW() - INTERVAL '9 days',  'converted',   89, 33000, 'manual'),
('a1b2c3d4-0000-0000-0000-000000000001', 'Lakshmi Devi',     '+919876543211', 'lakshmi@example.com',  'VIP Clients', ARRAY['vip'],             'active', NOW() - INTERVAL '3 days',  'interested',  86, 12000, 'import'),
('a1b2c3d4-0000-0000-0000-000000000001', 'Harish Chand',     '+919876543212', 'harish@example.com',   'VIP Clients', ARRAY['vip','lead'],      'active', NOW() - INTERVAL '11 days', 'qualified',   83, 24000, 'manual'),
('a1b2c3d4-0000-0000-0000-000000000001', 'Nisha Gupta',      '+919876543213', 'nisha@example.com',    'VIP Clients', ARRAY['vip','customer'],  'active', NOW() - INTERVAL '5 days',  'converted',   93, 47000, 'campaign'),
('a1b2c3d4-0000-0000-0000-000000000001', 'Ravi Shankar',     '+919876543214', 'ravi@example.com',     'VIP Clients', ARRAY['vip'],             'active', NOW() - INTERVAL '8 days',  'interested',  81, 11000, 'whatsapp'),
('a1b2c3d4-0000-0000-0000-000000000001', 'Pooja Agarwal',    '+919876543215', 'pooja@example.com',    'VIP Clients', ARRAY['vip','customer'],  'active', NOW() - INTERVAL '2 days',  'converted',   94, 50000, 'manual'),

-- E-commerce (15)
('a1b2c3d4-0000-0000-0000-000000000001', 'Sanjay Mishra',    '+919876543216', 'sanjay@example.com',   'E-commerce', ARRAY['customer','warm'],  'active', NOW() - INTERVAL '10 days', 'contacted',   65, 8000,  'campaign'),
('a1b2c3d4-0000-0000-0000-000000000001', 'Divya Kapoor',     '+919876543217', 'divya@example.com',    'E-commerce', ARRAY['lead','warm'],      'active', NOW() - INTERVAL '12 days', 'qualified',   70, 6500,  'import'),
('a1b2c3d4-0000-0000-0000-000000000001', 'Aryan Verma',      '+919876543218', 'aryan@example.com',    'E-commerce', ARRAY['customer'],         'active', NOW() - INTERVAL '15 days', 'converted',   75, 9200,  'manual'),
('a1b2c3d4-0000-0000-0000-000000000001', 'Shreya Das',       '+919876543219', 'shreya@example.com',   'E-commerce', ARRAY['lead'],             'active', NOW() - INTERVAL '20 days', 'new_lead',    45, 0,     'campaign'),
('a1b2c3d4-0000-0000-0000-000000000001', 'Mohit Tiwari',     '+919876543220', 'mohit@example.com',    'E-commerce', ARRAY['customer','warm'],  'active', NOW() - INTERVAL '8 days',  'interested',  68, 7800,  'whatsapp'),
('a1b2c3d4-0000-0000-0000-000000000001', 'Rekha Pillai',     '+919876543221', 'rekha@example.com',    'E-commerce', ARRAY['customer'],         'active', NOW() - INTERVAL '14 days', 'converted',   72, 11000, 'manual'),
('a1b2c3d4-0000-0000-0000-000000000001', 'Gaurav Bose',      '+919876543222', 'gaurav@example.com',   'E-commerce', ARRAY['lead','cold'],      'active', NOW() - INTERVAL '25 days', 'new_lead',    30, 0,     'import'),
('a1b2c3d4-0000-0000-0000-000000000001', 'Preeti Saxena',    '+919876543223', 'preeti@example.com',   'E-commerce', ARRAY['customer'],         'active', NOW() - INTERVAL '6 days',  'contacted',   60, 5500,  'campaign'),
('a1b2c3d4-0000-0000-0000-000000000001', 'Nikhil Rao',       '+919876543224', 'nikhil@example.com',   'E-commerce', ARRAY['lead','warm'],      'active', NOW() - INTERVAL '18 days', 'qualified',   67, 4200,  'manual'),
('a1b2c3d4-0000-0000-0000-000000000001', 'Shweta Jain',      '+919876543225', 'shweta@example.com',   'E-commerce', ARRAY['customer'],         'active', NOW() - INTERVAL '22 days', 'converted',   73, 13000, 'whatsapp'),
('a1b2c3d4-0000-0000-0000-000000000001', 'Pranav Khanna',    '+919876543226', 'pranav@example.com',   'E-commerce', ARRAY['lead'],             'active', NOW() - INTERVAL '30 days', 'new_lead',    42, 0,     'campaign'),
('a1b2c3d4-0000-0000-0000-000000000001', 'Asha Srivastava',  '+919876543227', 'asha@example.com',     'E-commerce', ARRAY['customer','warm'],  'active', NOW() - INTERVAL '9 days',  'interested',  66, 6800,  'import'),
('a1b2c3d4-0000-0000-0000-000000000001', 'Siddharth Roy',    '+919876543228', 'siddharth@example.com','E-commerce', ARRAY['cold'],             'inactive', NULL,                      'new_lead',    22, 0,     'manual'),
('a1b2c3d4-0000-0000-0000-000000000001', 'Pallavi Menon',    '+919876543229', 'pallavi@example.com',  'E-commerce', ARRAY['customer'],         'active', NOW() - INTERVAL '16 days', 'contacted',   58, 4800,  'campaign'),
('a1b2c3d4-0000-0000-0000-000000000001', 'Rohit Bansal',     '+919876543230', 'rohit@example.com',    'E-commerce', ARRAY['lead','cold'],      'active', NOW() - INTERVAL '28 days', 'new_lead',    28, 0,     'whatsapp'),

-- Healthcare (15)
('a1b2c3d4-0000-0000-0000-000000000001', 'Dr. Radhika Shah',  '+919876543231', 'radhika@example.com', 'Healthcare', ARRAY['customer','warm'],  'active', NOW() - INTERVAL '3 days',  'interested',  72, 9500,  'manual'),
('a1b2c3d4-0000-0000-0000-000000000001', 'Dr. Vinay Kumar',   '+919876543232', 'vinay@example.com',   'Healthcare', ARRAY['lead'],             'active', NOW() - INTERVAL '7 days',  'qualified',   60, 0,     'import'),
('a1b2c3d4-0000-0000-0000-000000000001', 'Swati Bhatt',       '+919876543233', 'swati@example.com',   'Healthcare', ARRAY['customer'],         'active', NOW() - INTERVAL '5 days',  'converted',   78, 7200,  'campaign'),
('a1b2c3d4-0000-0000-0000-000000000001', 'Kiran Malhotra',    '+919876543234', 'kiran@example.com',   'Healthcare', ARRAY['lead','warm'],      'active', NOW() - INTERVAL '12 days', 'contacted',   55, 3400,  'manual'),
('a1b2c3d4-0000-0000-0000-000000000001', 'Ashok Shetty',      '+919876543235', 'ashok@example.com',   'Healthcare', ARRAY['customer'],         'active', NOW() - INTERVAL '19 days', 'converted',   76, 8800,  'whatsapp'),
('a1b2c3d4-0000-0000-0000-000000000001', 'Madhuri Patil',     '+919876543236', 'madhuri@example.com', 'Healthcare', ARRAY['customer','warm'],  'active', NOW() - INTERVAL '4 days',  'interested',  69, 5600,  'manual'),
('a1b2c3d4-0000-0000-0000-000000000001', 'Balaji Krishnan',   '+919876543237', 'balaji@example.com',  'Healthcare', ARRAY['lead'],             'active', NOW() - INTERVAL '21 days', 'new_lead',    40, 0,     'campaign'),
('a1b2c3d4-0000-0000-0000-000000000001', 'Indira Mohan',      '+919876543238', 'indira@example.com',  'Healthcare', ARRAY['customer'],         'active', NOW() - INTERVAL '6 days',  'contacted',   62, 4100,  'import'),
('a1b2c3d4-0000-0000-0000-000000000001', 'Arun Pillai',       '+919876543239', 'arun@example.com',    'Healthcare', ARRAY['lead','cold'],      'active', NOW() - INTERVAL '35 days', 'new_lead',    25, 0,     'manual'),
('a1b2c3d4-0000-0000-0000-000000000001', 'Geeta Narayan',     '+919876543240', 'geeta@example.com',   'Healthcare', ARRAY['customer'],         'active', NOW() - INTERVAL '8 days',  'converted',   74, 6300,  'whatsapp'),
('a1b2c3d4-0000-0000-0000-000000000001', 'Manoj Thakur',      '+919876543241', 'manoj@example.com',   'Healthcare', ARRAY['customer','warm'],  'active', NOW() - INTERVAL '13 days', 'interested',  70, 5200,  'campaign'),
('a1b2c3d4-0000-0000-0000-000000000001', 'Usha Rani',         '+919876543242', 'usha@example.com',    'Healthcare', ARRAY['lead'],             'inactive', NULL,                      'new_lead',    32, 0,     'manual'),
('a1b2c3d4-0000-0000-0000-000000000001', 'Prakash Nambiar',   '+919876543243', 'prakash@example.com', 'Healthcare', ARRAY['customer'],         'active', NOW() - INTERVAL '17 days', 'contacted',   57, 3800,  'import'),
('a1b2c3d4-0000-0000-0000-000000000001', 'Vijaya Laxmi',      '+919876543244', 'vijaya@example.com',  'Healthcare', ARRAY['warm'],             'active', NOW() - INTERVAL '10 days', 'qualified',   63, 4500,  'campaign'),
('a1b2c3d4-0000-0000-0000-000000000001', 'Chandra Sekhar',    '+919876543245', 'chandra@example.com', 'Healthcare', ARRAY['customer'],         'active', NOW() - INTERVAL '24 days', 'converted',   71, 7700,  'manual'),

-- Retail (15)
('a1b2c3d4-0000-0000-0000-000000000001', 'Hari Prasad',       '+919876543246', 'hari@example.com',    'Retail', ARRAY['customer','warm'],  'active', NOW() - INTERVAL '2 days',  'interested',  68, 6200,  'manual'),
('a1b2c3d4-0000-0000-0000-000000000001', 'Sonal Desai',       '+919876543247', 'sonal@example.com',   'Retail', ARRAY['lead'],             'active', NOW() - INTERVAL '11 days', 'new_lead',    44, 0,     'campaign'),
('a1b2c3d4-0000-0000-0000-000000000001', 'Tushar Pawar',      '+919876543248', 'tushar@example.com',  'Retail', ARRAY['customer'],         'active', NOW() - INTERVAL '16 days', 'converted',   74, 8900,  'import'),
('a1b2c3d4-0000-0000-0000-000000000001', 'Kamala Hegde',      '+919876543249', 'kamala@example.com',  'Retail', ARRAY['lead','warm'],      'active', NOW() - INTERVAL '23 days', 'qualified',   61, 3700,  'whatsapp'),
('a1b2c3d4-0000-0000-0000-000000000001', 'Santosh Mane',      '+919876543250', 'santosh@example.com', 'Retail', ARRAY['customer'],         'active', NOW() - INTERVAL '7 days',  'contacted',   59, 4600,  'manual'),
('a1b2c3d4-0000-0000-0000-000000000001', 'Hemalatha Nair',    '+919876543251', 'hema@example.com',    'Retail', ARRAY['cold'],             'inactive', NULL,                      'new_lead',    20, 0,     'campaign'),
('a1b2c3d4-0000-0000-0000-000000000001', 'Dinesh Garg',       '+919876543252', 'dinesh@example.com',  'Retail', ARRAY['customer','warm'],  'active', NOW() - INTERVAL '4 days',  'interested',  66, 5900,  'import'),
('a1b2c3d4-0000-0000-0000-000000000001', 'Sushma Yadav',      '+919876543253', 'sushma@example.com',  'Retail', ARRAY['lead'],             'active', NOW() - INTERVAL '31 days', 'new_lead',    38, 0,     'manual'),
('a1b2c3d4-0000-0000-0000-000000000001', 'Naresh Solanki',    '+919876543254', 'naresh@example.com',  'Retail', ARRAY['customer'],         'active', NOW() - INTERVAL '9 days',  'converted',   73, 10200, 'whatsapp'),
('a1b2c3d4-0000-0000-0000-000000000001', 'Ratna Kumari',      '+919876543255', 'ratna@example.com',   'Retail', ARRAY['lead','cold'],      'active', NOW() - INTERVAL '40 days', 'new_lead',    26, 0,     'campaign'),
('a1b2c3d4-0000-0000-0000-000000000001', 'Ramesh Pandey',     '+919876543256', 'ramesh@example.com',  'Retail', ARRAY['customer'],         'active', NOW() - INTERVAL '6 days',  'contacted',   56, 3900,  'manual'),
('a1b2c3d4-0000-0000-0000-000000000001', 'Vimala Srinivas',   '+919876543257', 'vimala@example.com',  'Retail', ARRAY['warm'],             'active', NOW() - INTERVAL '14 days', 'qualified',   64, 4300,  'import'),
('a1b2c3d4-0000-0000-0000-000000000001', 'Girish Kulkarni',   '+919876543258', 'girish@example.com',  'Retail', ARRAY['customer'],         'active', NOW() - INTERVAL '18 days', 'converted',   77, 9600,  'campaign'),
('a1b2c3d4-0000-0000-0000-000000000001', 'Sumithra Balan',    '+919876543259', 'sumithra@example.com','Retail', ARRAY['lead','warm'],      'active', NOW() - INTERVAL '26 days', 'qualified',   58, 3100,  'whatsapp'),
('a1b2c3d4-0000-0000-0000-000000000001', 'Pavan Kumar',       '+919876543260', 'pavan@example.com',   'Retail', ARRAY['customer'],         'active', NOW() - INTERVAL '3 days',  'interested',  69, 7100,  'manual');

-- =====================================================
-- CAMPAIGNS
-- =====================================================
INSERT INTO campaigns (id, user_id, name, description, status, template_id, template_name, whatsapp_number_id, audience_type, group_name, recipients_count, sent_count, delivered_count, failed_count, read_count, cost, started_at, completed_at, created_at)
VALUES
  ('d1000000-0000-0000-0000-000000000001', 'a1b2c3d4-0000-0000-0000-000000000001',
   'Diwali Flash Sale 2024', 'Special Diwali offers for all customers',
   'completed', 'c1000000-0000-0000-0000-000000000003', 'flash_sale_alert',
   'b1000000-0000-0000-0000-000000000001', 'all', NULL,
   1250, 1230, 1180, 20, 680, 738.00,
   NOW() - INTERVAL '15 days', NOW() - INTERVAL '15 days' + INTERVAL '2 hours',
   NOW() - INTERVAL '16 days'),

  ('d1000000-0000-0000-0000-000000000002', 'a1b2c3d4-0000-0000-0000-000000000001',
   'Welcome New Users — Oct', 'Onboarding message for October signups',
   'completed', 'c1000000-0000-0000-0000-000000000001', 'welcome_new_user',
   'b1000000-0000-0000-0000-000000000001', 'group', 'E-commerce',
   342, 339, 325, 3, 201, 203.40,
   NOW() - INTERVAL '10 days', NOW() - INTERVAL '10 days' + INTERVAL '30 minutes',
   NOW() - INTERVAL '11 days'),

  ('d1000000-0000-0000-0000-000000000003', 'a1b2c3d4-0000-0000-0000-000000000001',
   'VIP Exclusive Offer', 'Special discount for VIP members',
   'completed', 'c1000000-0000-0000-0000-000000000003', 'flash_sale_alert',
   'b1000000-0000-0000-0000-000000000001', 'group', 'VIP Clients',
   156, 154, 149, 2, 112, 92.40,
   NOW() - INTERVAL '5 days', NOW() - INTERVAL '5 days' + INTERVAL '15 minutes',
   NOW() - INTERVAL '6 days'),

  ('d1000000-0000-0000-0000-000000000004', 'a1b2c3d4-0000-0000-0000-000000000001',
   'Order Confirmations Batch', 'Automated order confirmation messages',
   'running', 'c1000000-0000-0000-0000-000000000002', 'order_confirmation',
   'b1000000-0000-0000-0000-000000000001', 'tags', NULL,
   89, 67, 61, 4, 38, 0.00,
   NOW() - INTERVAL '2 hours', NULL,
   NOW() - INTERVAL '3 hours'),

  ('d1000000-0000-0000-0000-000000000005', 'a1b2c3d4-0000-0000-0000-000000000001',
   'Weekend Mega Sale', 'Flash sale for the upcoming weekend',
   'scheduled', 'c1000000-0000-0000-0000-000000000003', 'flash_sale_alert',
   'b1000000-0000-0000-0000-000000000001', 'all', NULL,
   1800, 0, 0, 0, 0, 0.00,
   NULL, NULL,
   NOW() - INTERVAL '1 day'),

  ('d1000000-0000-0000-0000-000000000006', 'a1b2c3d4-0000-0000-0000-000000000001',
   'Healthcare Appointment Reminders', 'Remind healthcare contacts of upcoming slots',
   'draft', 'c1000000-0000-0000-0000-000000000004', 'appointment_reminder',
   'b1000000-0000-0000-0000-000000000002', 'group', 'Healthcare',
   0, 0, 0, 0, 0, 0.00,
   NULL, NULL,
   NOW() - INTERVAL '2 days');

-- =====================================================
-- CAMPAIGN MESSAGES (sample for completed campaigns)
-- =====================================================
INSERT INTO campaign_messages (campaign_id, phone, status, meta_message_id, sent_at, delivered_at, read_at)
SELECT
  'd1000000-0000-0000-0000-000000000001',
  phone,
  CASE (ROW_NUMBER() OVER ())::int % 10
    WHEN 9 THEN 'failed'
    WHEN 8 THEN 'sent'
    WHEN 7 THEN 'sent'
    ELSE 'delivered'
  END,
  'wamid.demo_' || LEFT(MD5(phone), 16),
  NOW() - INTERVAL '15 days',
  CASE (ROW_NUMBER() OVER ())::int % 10
    WHEN 9 THEN NULL
    WHEN 8 THEN NULL
    ELSE NOW() - INTERVAL '14 days 22 hours'
  END,
  CASE (ROW_NUMBER() OVER ())::int % 10
    WHEN 0 THEN NOW() - INTERVAL '14 days 20 hours'
    WHEN 1 THEN NOW() - INTERVAL '14 days 18 hours'
    ELSE NULL
  END
FROM contacts
WHERE user_id = 'a1b2c3d4-0000-0000-0000-000000000001'
LIMIT 30;

-- =====================================================
-- AUTOMATIONS
-- =====================================================
INSERT INTO automations (user_id, name, is_active, trigger_type, trigger_value, action_type, action_template_id, action_delay_hours, last_triggered)
VALUES
  ('a1b2c3d4-0000-0000-0000-000000000001',
   'New Contact Welcome Flow',
   TRUE, 'new_contact', NULL, 'send_template',
   'c1000000-0000-0000-0000-000000000001', 0,
   NOW() - INTERVAL '3 hours'),

  ('a1b2c3d4-0000-0000-0000-000000000001',
   'Order Keyword Auto-Reply',
   TRUE, 'keyword', 'ORDER', 'send_template',
   'c1000000-0000-0000-0000-000000000002', 0,
   NOW() - INTERVAL '45 minutes'),

  ('a1b2c3d4-0000-0000-0000-000000000001',
   'Weekly Re-engagement (Inactive 30 days)',
   FALSE, 'inactivity', '30', 'send_template',
   'c1000000-0000-0000-0000-000000000003', 24,
   NOW() - INTERVAL '8 days');

-- =====================================================
-- TEAM MEMBERS
-- =====================================================
INSERT INTO team_members (owner_id, name, email, role, status, joined_date)
VALUES
  ('a1b2c3d4-0000-0000-0000-000000000001', 'Sneha Rao',      'sneha@techsell.in',  'admin', 'active',   NOW() - INTERVAL '60 days'),
  ('a1b2c3d4-0000-0000-0000-000000000001', 'Karthik Varma',  'karthik@techsell.in','agent', 'active',   NOW() - INTERVAL '30 days'),
  ('a1b2c3d4-0000-0000-0000-000000000001', 'Nandini Bhat',   'nandini@techsell.in','agent', 'invited',  NOW());

-- =====================================================
-- TRANSACTIONS
-- =====================================================
INSERT INTO transactions (user_id, type, description, amount, balance_after, payment_method, created_at)
VALUES
  ('a1b2c3d4-0000-0000-0000-000000000001', 'credit', 'Wallet Recharge — Razorpay',    5000.00, 5000.00, 'razorpay',  NOW() - INTERVAL '30 days'),
  ('a1b2c3d4-0000-0000-0000-000000000001', 'debit',  'Campaign: Diwali Flash Sale',    -738.00, 4262.00, NULL,        NOW() - INTERVAL '15 days'),
  ('a1b2c3d4-0000-0000-0000-000000000001', 'debit',  'Campaign: Welcome New Users',    -203.40, 4058.60, NULL,        NOW() - INTERVAL '10 days'),
  ('a1b2c3d4-0000-0000-0000-000000000001', 'credit', 'Wallet Recharge — UPI',         1000.00, 5058.60, 'upi',       NOW() - INTERVAL '8 days'),
  ('a1b2c3d4-0000-0000-0000-000000000001', 'debit',  'Campaign: VIP Exclusive Offer',  -92.40, 4966.20, NULL,        NOW() - INTERVAL '5 days'),
  ('a1b2c3d4-0000-0000-0000-000000000001', 'debit',  'Campaign: Order Confirmations',   -40.20, 4926.00, NULL,        NOW() - INTERVAL '2 hours'),
  ('a1b2c3d4-0000-0000-0000-000000000001', 'debit',  'Subscription — Pro Plan',         -76.00, 4850.00, 'razorpay',  NOW() - INTERVAL '1 day');

-- =====================================================
-- CRM ACTIVITIES (sample)
-- =====================================================
INSERT INTO crm_activities (contact_id, user_id, type, content, created_at)
SELECT
  c.id,
  'a1b2c3d4-0000-0000-0000-000000000001',
  'note',
  'Initial contact made. Interested in bulk order pricing.',
  NOW() - INTERVAL '5 days'
FROM contacts c
WHERE c.user_id = 'a1b2c3d4-0000-0000-0000-000000000001'
  AND c.crm_stage IN ('qualified', 'interested', 'converted')
LIMIT 15;

-- =====================================================
-- CRM DEALS (sample for top contacts)
-- =====================================================
INSERT INTO crm_deals (user_id, contact_id, title, value, stage, probability, expected_close, created_at)
SELECT
  'a1b2c3d4-0000-0000-0000-000000000001',
  c.id,
  c.name || ' — Bulk Order Deal',
  c.deal_value,
  CASE c.crm_stage
    WHEN 'new_lead'   THEN 'prospecting'
    WHEN 'contacted'  THEN 'qualification'
    WHEN 'qualified'  THEN 'proposal'
    WHEN 'interested' THEN 'negotiation'
    WHEN 'converted'  THEN 'closed_won'
    ELSE 'prospecting'
  END,
  CASE c.crm_stage
    WHEN 'new_lead'   THEN 10
    WHEN 'contacted'  THEN 25
    WHEN 'qualified'  THEN 50
    WHEN 'interested' THEN 70
    WHEN 'converted'  THEN 100
    ELSE 10
  END,
  CURRENT_DATE + INTERVAL '30 days',
  NOW() - INTERVAL '10 days'
FROM contacts c
WHERE c.user_id = 'a1b2c3d4-0000-0000-0000-000000000001'
  AND c.deal_value > 0
LIMIT 20;

-- =====================================================
-- DAILY ANALYTICS (last 30 days — realistic curve)
-- =====================================================
INSERT INTO daily_analytics (user_id, date, total_sent, total_delivered, total_failed)
SELECT
  'a1b2c3d4-0000-0000-0000-000000000001',
  CURRENT_DATE - (s || ' days')::INTERVAL,
  CASE
    WHEN s = 15 THEN 1230
    WHEN s = 10 THEN 339
    WHEN s = 5  THEN 154
    WHEN s % 7 = 0 THEN 0
    ELSE (40 + (s * 3) % 80)
  END AS total_sent,
  CASE
    WHEN s = 15 THEN 1180
    WHEN s = 10 THEN 325
    WHEN s = 5  THEN 149
    WHEN s % 7 = 0 THEN 0
    ELSE (36 + (s * 3) % 75)
  END AS total_delivered,
  CASE
    WHEN s = 15 THEN 20
    WHEN s = 10 THEN 3
    WHEN s = 5  THEN 2
    WHEN s % 7 = 0 THEN 0
    ELSE ((s * 2) % 5)
  END AS total_failed
FROM generate_series(0, 29) AS s;
