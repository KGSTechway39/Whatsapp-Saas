-- =====================================================
-- 033_catalog_commerce.sql — Meta Commerce catalog messaging
--
-- PHASE 0 AUDIT (done before writing this; nothing here duplicates what exists):
--   • `products` (004) is the tenant's LOCAL catalogue, and `commerce_connections`
--     links Shopify/WooCommerce as a product SOURCE. Neither is a Meta Commerce
--     catalogue, and `lib/commerce.ts buildProductMessage()` returns plain TEXT,
--     not a native WhatsApp product card. So Meta catalogue linkage is genuinely
--     new — this migration adds it without touching either existing table.
--   • The 24h service window already exists (lib/whatsapp/window.ts). Part 3's
--     billing rule reuses `getWindowState`; no window logic is added here.
--   • The vertical seed kit is ONE polymorphic table
--     (`vertical_template_library`, kind = FLOW_JSON | CAMPAIGN_PROMPT |
--     MESSAGE_TEMPLATE), already seeded for ecommerce with 6 flows / 2 prompts /
--     5 templates. No new seed tables.
--   • Tenants are `users` (legacy user_id model). There is no `waba_connections`
--     table in this project; numbers live in `whatsapp_numbers`.
--
-- ADDITIVE & SAFE; idempotent.
-- =====================================================

-- ── catalog_connections — a tenant's Meta Commerce catalogue ────────────────
-- SendAnjal does NOT create catalogues on Meta's behalf. The tenant creates one in
-- Commerce Manager and pastes its id; we link it to their WABA. One row per
-- tenant per catalogue.
CREATE TABLE IF NOT EXISTS public.catalog_connections (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  commerce_catalog_id TEXT NOT NULL,
  -- The number the catalogue is surfaced on. Commerce settings (cart /
  -- visibility) are per phone number in Meta's API, not per WABA.
  whatsapp_number_id  UUID REFERENCES public.whatsapp_numbers(id) ON DELETE SET NULL,

  -- Mirrors of Meta's commerce settings. Written only from a READ-BACK of
  -- Meta's state, never optimistically from our own write — a toggle that
  -- reports success while Meta silently kept the old value is worse than an
  -- error, because the tenant then can't explain why carts don't appear.
  cart_enabled        BOOLEAN NOT NULL DEFAULT TRUE,
  catalog_visibility  BOOLEAN NOT NULL DEFAULT FALSE,

  status              TEXT NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending','linked','failed')),
  -- Why a link failed, in Meta's words, so support can act without re-running it.
  last_error          TEXT,
  linked_at           TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (user_id, commerce_catalog_id)
);

CREATE INDEX IF NOT EXISTS idx_catalog_conn_user ON public.catalog_connections(user_id);
-- The send path asks "does this tenant have a usable catalogue?" on every
-- catalog message.
CREATE INDEX IF NOT EXISTS idx_catalog_conn_linked
  ON public.catalog_connections(user_id) WHERE status = 'linked';

-- ── catalog_orders — carts customers submit from a catalogue ────────────────
-- Meta's cart is NOT a checkout: no payment happens, and fulfilment always
-- needs a human. This table is a work queue, which is why it carries a status
-- and not a payment reference.
CREATE TABLE IF NOT EXISTS public.catalog_orders (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  contact_id     UUID REFERENCES public.contacts(id) ON DELETE SET NULL,
  customer_phone TEXT NOT NULL,

  -- Meta's order id from the webhook. UNIQUE per tenant so a redelivered
  -- webhook cannot create a second order for the same cart — Meta retries
  -- aggressively and duplicate orders would be double-fulfilled.
  wa_order_id    TEXT,

  catalog_id     TEXT,
  -- [{ product_retailer_id, quantity, item_price, currency }]
  order_items    JSONB NOT NULL DEFAULT '[]',
  -- Integer paise. Meta sends item_price as a decimal in the cart currency;
  -- we normalise to paise on ingest so money is never a float here either.
  total_paise    BIGINT NOT NULL DEFAULT 0,
  currency       TEXT NOT NULL DEFAULT 'INR',

  status         TEXT NOT NULL DEFAULT 'received'
                 CHECK (status IN ('received','processing','completed','cancelled')),
  -- Free-text for the human doing fulfilment (payment link sent, courier ref…).
  notes          TEXT,

  received_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_catalog_orders_wa_id
  ON public.catalog_orders(user_id, wa_order_id) WHERE wa_order_id IS NOT NULL;

-- The default view is "what still needs work, newest first".
CREATE INDEX IF NOT EXISTS idx_catalog_orders_open
  ON public.catalog_orders(user_id, received_at DESC)
  WHERE status IN ('received','processing');

CREATE INDEX IF NOT EXISTS idx_catalog_orders_contact
  ON public.catalog_orders(contact_id) WHERE contact_id IS NOT NULL;

-- ── Compliance attestation — data-driven, never `if (vertical = ecommerce)` ─
-- Same mechanism as 031's consent flag: the requirement lives on the vertical
-- row, so a future regulated vertical enables it with an UPDATE.
ALTER TABLE public.industry_verticals
  ADD COLUMN IF NOT EXISTS requires_compliance_attestation BOOLEAN NOT NULL DEFAULT FALSE;

UPDATE public.industry_verticals SET requires_compliance_attestation = TRUE
  WHERE slug = 'ecommerce';

-- The attestation itself, on the tenant. Timestamp is written with the flag —
-- "attested, but we don't know when" is not a defensible record.
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS commerce_compliance_confirmed BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS commerce_compliance_at TIMESTAMPTZ;

ALTER TABLE public.users DROP CONSTRAINT IF EXISTS chk_users_commerce_attestation;
ALTER TABLE public.users
  ADD CONSTRAINT chk_users_commerce_attestation
    CHECK (commerce_compliance_confirmed = FALSE OR commerce_compliance_at IS NOT NULL)
    NOT VALID;  -- applies going forward; does not fail on legacy rows

-- ── RLS: deny-all, service-role only (022 / 027 / 029 / 030 / 031 posture) ──
ALTER TABLE public.catalog_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.catalog_connections FORCE  ROW LEVEL SECURITY;
ALTER TABLE public.catalog_orders      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.catalog_orders      FORCE  ROW LEVEL SECURITY;
