-- ──────────────────────────────────────────────────────────────────────────────
-- 003: Visual Automation Flow Builder
-- Run in Supabase SQL editor: supabase.com/dashboard/project/tbqfsudapxfqakzqbkgb/sql
-- ──────────────────────────────────────────────────────────────────────────────

-- automation_flows: stores full flow JSON (nodes + edges)
CREATE TABLE IF NOT EXISTS automation_flows (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name            TEXT NOT NULL DEFAULT 'Untitled Flow',
  description     TEXT,
  is_active       BOOLEAN DEFAULT FALSE,
  trigger_type    TEXT NOT NULL DEFAULT 'keyword',
  flow_data       JSONB NOT NULL DEFAULT '{"nodes":[],"edges":[]}',
  trigger_count   INTEGER DEFAULT 0,
  last_triggered  TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_automation_flows_user_id      ON automation_flows(user_id);
CREATE INDEX IF NOT EXISTS idx_automation_flows_trigger_type ON automation_flows(trigger_type);
CREATE INDEX IF NOT EXISTS idx_automation_flows_is_active    ON automation_flows(is_active);

-- chatbot_sessions: tracks where each contact is in a flow
CREATE TABLE IF NOT EXISTS chatbot_sessions (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  contact_id      UUID REFERENCES contacts(id) ON DELETE CASCADE,
  conversation_id UUID REFERENCES conversations(id) ON DELETE SET NULL,
  flow_id         UUID NOT NULL REFERENCES automation_flows(id) ON DELETE CASCADE,
  current_node_id TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active', 'waiting', 'completed', 'failed')),
  context         JSONB NOT NULL DEFAULT '{}',
  resume_at       TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_chatbot_sessions_contact_id  ON chatbot_sessions(contact_id);
CREATE INDEX IF NOT EXISTS idx_chatbot_sessions_flow_id     ON chatbot_sessions(flow_id);
CREATE INDEX IF NOT EXISTS idx_chatbot_sessions_status      ON chatbot_sessions(status);
CREATE INDEX IF NOT EXISTS idx_chatbot_sessions_resume_at
  ON chatbot_sessions(resume_at) WHERE status = 'waiting';

-- ── Seed demo flows for test user ────────────────────────────────────────────
DO $$
DECLARE
  v_user_id UUID := 'a1b2c3d4-0000-0000-0000-000000000001';
BEGIN
  INSERT INTO automation_flows (user_id, name, description, is_active, trigger_type, trigger_count, flow_data)
  VALUES (
    v_user_id,
    'Welcome New Contacts',
    'Greets every new contact and follows up after 1 day',
    true,
    'new_contact',
    47,
    '{
      "nodes":[
        {"id":"n1","type":"triggerNode","position":{"x":240,"y":40},"data":{"label":"New Contact Added","config":{"triggerType":"new_contact"}}},
        {"id":"n2","type":"sendMessageNode","position":{"x":240,"y":170},"data":{"label":"Send Welcome","config":{"messageType":"text","text":"Hi {{name}}, welcome! How can we help you today?"}}},
        {"id":"n3","type":"waitNode","position":{"x":240,"y":300},"data":{"label":"Wait 1 Day","config":{"duration":1,"unit":"days"}}},
        {"id":"n4","type":"sendMessageNode","position":{"x":240,"y":430},"data":{"label":"Follow-up","config":{"messageType":"text","text":"Just checking in, {{name}}! Let us know if you need anything."}}},
        {"id":"n5","type":"endNode","position":{"x":240,"y":560},"data":{"label":"Flow Complete","config":{}}}
      ],
      "edges":[
        {"id":"e1","source":"n1","target":"n2","animated":true},
        {"id":"e2","source":"n2","target":"n3","animated":true},
        {"id":"e3","source":"n3","target":"n4","animated":true},
        {"id":"e4","source":"n4","target":"n5","animated":true}
      ]
    }'::jsonb
  ) ON CONFLICT DO NOTHING;

  INSERT INTO automation_flows (user_id, name, description, is_active, trigger_type, trigger_count, flow_data)
  VALUES (
    v_user_id,
    'Keyword: PRICING',
    'Auto-replies to pricing inquiries and routes hot leads to agents',
    true,
    'keyword',
    23,
    '{
      "nodes":[
        {"id":"n1","type":"triggerNode","position":{"x":240,"y":40},"data":{"label":"Keyword Match","config":{"triggerType":"keyword","keywords":"pricing, price, cost, how much"}}},
        {"id":"n2","type":"sendMessageNode","position":{"x":240,"y":170},"data":{"label":"Send Pricing Info","config":{"messageType":"text","text":"Our plans start at ₹999\/month. Reply DEMO to book a free demo!"}}},
        {"id":"n3","type":"conditionNode","position":{"x":240,"y":300},"data":{"label":"Replied DEMO?","config":{"field":"last_message","operator":"contains","value":"DEMO"}}},
        {"id":"n4","type":"assignAgentNode","position":{"x":100,"y":440},"data":{"label":"Assign to Sales","config":{"agentName":"Sales Team","note":"Hot lead — interested in demo"}}},
        {"id":"n5","type":"addTagNode","position":{"x":390,"y":440},"data":{"label":"Tag: Browsing","config":{"action":"add","tag":"browsing"}}},
        {"id":"n6","type":"endNode","position":{"x":240,"y":570},"data":{"label":"Flow Complete","config":{}}}
      ],
      "edges":[
        {"id":"e1","source":"n1","target":"n2","animated":true},
        {"id":"e2","source":"n2","target":"n3","animated":true},
        {"id":"e3","source":"n3","target":"n4","sourceHandle":"true","label":"Yes"},
        {"id":"e4","source":"n3","target":"n5","sourceHandle":"false","label":"No"},
        {"id":"e5","source":"n4","target":"n6"},
        {"id":"e6","source":"n5","target":"n6"}
      ]
    }'::jsonb
  ) ON CONFLICT DO NOTHING;
END $$;
