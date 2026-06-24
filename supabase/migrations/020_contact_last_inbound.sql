-- =====================================================
-- 020_contact_last_inbound.sql  —  24-hour window tracking
--
-- The WhatsApp customer-service window OPENS when a user messages the business
-- and lasts 24h. The messaging skill tracks this per-contact via `last_inbound_at`;
-- a canSendFreeform(contact) guard compares it against now() before any free-form
-- send. This column is refreshed on every inbound message webhook.
--
-- ADDITIVE & SAFE: new nullable column only.
-- =====================================================
ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS last_inbound_at TIMESTAMPTZ;
