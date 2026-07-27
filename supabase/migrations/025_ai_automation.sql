-- =====================================================
-- 025_ai_automation.sql  —  Automation AI: point runtime intent at the cheap
-- fast provider, now that a Google/Gemini adapter exists in lib/ai/service.ts.
--
-- Additive & safe: only UPDATEs an existing ai_model_config seed row (024). No
-- table is created or altered. Re-runnable (idempotent UPDATE). Deploying the app
-- without this SQL stays harmless — the router keeps using the 024 seed and every
-- AI entry point still falls back cleanly to the manual flow (rule 8).
--
-- Two automation AI task_types were seeded in 024:
--   • automation_flow_builder   — DESIGN-TIME, stronger model (Sonnet class),
--       JSON flow correctness matters. Left as-is (already Sonnet-class).
--   • automation_runtime_intent — RUNTIME, runs on EVERY inbound message. This
--       migration moves it to the cheapest/fastest model (Gemini Flash-Lite class)
--       and keeps 0 credits (logged for MARGIN only, never billed) + strict 2s.
--
-- If GEMINI_API_KEY is unset the adapter returns null → runtime intent falls back
-- to plain keyword matching (lib/automation/runtime.ts). So this is safe to apply
-- before the key is provisioned; flip provider back via /api/admin/ai-config any
-- time, no redeploy (rule 4).
-- =====================================================

UPDATE ai_model_config
SET provider                       = 'google',
    model_id                       = 'gemini-2.5-flash-lite',
    -- Placeholder paise/million (₹1≈8300 paise) — Flash-Lite class is far cheaper
    -- than the Haiku placeholder it replaces. Admin-editable; never authoritative
    -- in code. Kept non-zero so the margin log reflects real spend.
    input_price_per_million_paise  = 800,
    output_price_per_million_paise = 3300,
    credits_per_action             = 0,      -- volume task: metered for margin, not billed
    timeout_ms                     = 2000,   -- strict — this runs per inbound message
    max_regens                     = 0,
    updated_at                     = NOW(),
    note                           = 'runtime intent — cheapest fast model (Gemini Flash-Lite class); 0 credits, margin-logged only'
WHERE task_type = 'automation_runtime_intent';

-- Note: flow intents live inside flow_data (the trigger node's config.intents /
-- config.keywords), read by lib/automation/flow-schema.ts#extractFlowIntents — so
-- no new column on automation_flows is needed for runtime classification.
