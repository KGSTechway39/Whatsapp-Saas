# WASend — Founder Operating Guide

Practical runbook for you, the **platform owner / Meta Tech Provider (BSP)**: how the
admin page works, how *you* set up Embedded Signup once, and the exact order to get
your first paying client live.

---

## Part A — The Admin page (yes, you need it)

As the BSP you need an internal-only surface for things clients must never touch.

**Where:** `/admin` (same app, same login — it's not a separate system). It is hidden
from the sidebar and unlocks only for emails in the `ADMIN_EMAILS` allowlist.

**Access model (founder-stage):** `ADMIN_EMAILS` is an env allowlist, *not* a DB role —
so admin can't be self-granted. Add team roles later when you hire ops staff.

```env
ADMIN_EMAILS=you@yourbrand.com,ops@yourbrand.com
```

**What it does today:** look up a client by email → set their **tier**
(Starter / Growth / Enterprise). Setting a tier writes `billing_mode` + `waba_mode`
together and creates their wallet row if they go managed.

**What it grows into** (gated on the billing rate/markup schema — still proposed):
- Per-client **margin & revenue** (Meta wholesale cost vs. what you charged).
- **Rate/markup config** (edit Meta rates + markup % without code).
- **Wallet ops** (manual credit / refund / bonus).

---

## Part B — Embedded Signup: your one-time BSP setup

Two layers. Only the second is something *you* configure.

1. **Client-facing flow** — already built. Clients open `/numbers/connect`, pick a path
   (existing WA app / new number / managed), and click through Meta's official popup.

2. **Your BSP setup** — do this once on Meta's side to switch the client flow on:
   1. Create a **Business-type** Meta App at developers.facebook.com.
   2. Complete **Meta Business Verification**.
   3. Become a **Tech Provider / Solution Partner**.
   4. Add the **WhatsApp** and **Facebook Login for Business** products.
   5. Create an **Embedded Signup configuration** → copy the **`config_id`**.
   6. Submit **App Review** for advanced access to `whatsapp_business_management`
      and `whatsapp_business_messaging`.
   7. Per model:
      - **Growth (Model B):** enable **credit line sharing** so client-owned WABAs bill
        through you (you pay Meta wholesale, charge the client at markup).
      - **Starter (Model C):** provision **your own verified WABA + a phone-number pool**
        that Starter clients send under. *(Not built yet — operational/deferred.)*

   Then set the env the code already reads:
   ```env
   NEXT_PUBLIC_META_APP_ID=...
   META_APP_SECRET=...
   NEXT_PUBLIC_META_CONFIG_ID=...
   ```

> Until these are real, the client flow's **Manual Setup** tab still works: paste a real
> WABA ID + Phone Number ID + access token and a number connects + can send today.

---

## Part C — Launch path (do this in order)

**Stage 0 — make what's built actually run**
1. Apply migration `016_tiers.sql` in the Supabase SQL Editor (idempotent). → `/admin`
   tier selector works.
2. Set `ADMIN_EMAILS` to your email; set `NEXT_PUBLIC_SUPPORT_WHATSAPP` to your support
   number (powers the onboarding "Chat with us" button).

**Stage 1 — your first client, the no-Meta-friction way (Starter / Model C)**
3. Do your BSP setup (Part B) *or* connect a number via **Manual Setup** with a real token.
4. In `/admin`, set the client to **Growth** (managed) — Starter needs the number pool.
5. Top up their wallet → send a billed message. You now have a working managed client.

**Stage 2 — turn on self-serve onboarding (Growth / Model B)**
6. Finish Part B steps 1–6, including **credit line sharing**.
7. Clients self-onboard their own WABA via Embedded Signup; you assign Growth + they top up.

**Stage 3 — pricing & margin (needs the billing schema, currently proposed)**
8. Approve the rate/markup schema; seed Meta India wholesale rates + per-tier markup.
9. Build the admin margin/revenue + rate-config panels.

**Stage 4 — Starter at scale (Model C)**
10. Provision the platform WABA number pool; wire shared-WABA send routing; open Starter.

---

## Quick reference

| Thing | Value |
|---|---|
| Admin page | `/admin` (gated by `ADMIN_EMAILS`) |
| Client onboarding | `/numbers/connect` |
| Tiers → model | Starter=C (managed+shared) · Growth=B (managed+own) · Enterprise=A (byo+own) |
| Tier migration | `supabase/migrations/016_tiers.sql` (apply to prod) |
| Wallet model | prepaid credits (paise) + per-message deduction by category (migration 011) |
| Meta env | `NEXT_PUBLIC_META_APP_ID`, `META_APP_SECRET`, `NEXT_PUBLIC_META_CONFIG_ID` |
| Support button | `NEXT_PUBLIC_SUPPORT_WHATSAPP` |
