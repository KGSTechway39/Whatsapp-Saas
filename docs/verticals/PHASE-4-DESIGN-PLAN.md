# Phase 4 — Design plan (gate before any vertical screen)

Required by the master prompt before writing screen code. Users: a hospital
receptionist, a school front-office clerk, a shop owner. Many on modest Android
phones, at a counter, mid-task.

---

## 1. The honest finding first: this product already has a design system

The prompt asks for a type pairing and a 4–6 value palette, with an explicit warning
against generic AI defaults (cream+serif, black+neon, dense broadsheet grids). SendAnjal
already ships something specific and none of those:

| | Already in the repo | Where |
|---|---|---|
| Display | **Bricolage Grotesque** — editorial, slightly warm, real character | `app/layout.tsx:17` |
| Body | **Plus Jakarta Sans** — humanist workhorse, deliberately "distinct from generic Inter" (their comment) | `app/layout.tsx:9` |
| Mono | JetBrains Mono | `app/layout.tsx:24` |
| Primary | Teal-blue `#0B7285` (`--primary: 189 85% 28%`) | `app/globals.css:23` |
| Surface | Cool mint tint `178 44% 96%` — light; deep slate-navy `222 47% 7%` — dark | `app/globals.css:16,49` |

**So the design decision here is: extend, do not replace.** Inventing a competing
palette (the terracotta-and-paper direction I first sketched) would have looked
considered in isolation and fragmented the product in practice — a client would meet
one visual language in Billing and another in Recommendations. The existing teal
already reads as "calm, trustworthy communications tool," which is the brief. It passes
the "would this look like any other AI dashboard" test on its own merits: warm editorial
display face, mint-tinted rather than pure-white surface, no neon.

What follows is therefore a **token extension** plus the rules the vertical screens add.

## 2. Palette extension — 5 named values

Semantic tokens layered on the existing scale. HSL to match `globals.css`; both themes.

| Token | Light | Dark | Used for |
|---|---|---|---|
| `--rec-surface` | `184 52% 95%` | `222 38% 14%` | The "Recommended for you" rail background — a tint of the existing accent, so the assisted path reads as *offered*, not *promoted* |
| `--rec-border` | `189 40% 82%` | `187 40% 28%` | Rail + card edges |
| `--preview-bubble` | `0 0% 100%` | `222 30% 22%` | The customer-message bubble in a preview (§4) |
| `--cost-note` | `32 85% 44%` | `38 90% 62%` | Amber, for the plain-language "costs more per message" note on Marketing templates — deliberately **not** `--destructive`; higher cost is information, not an error |
| `--vertical-chip` | `189 85% 28%` | `187 78% 58%` | Existing `--primary`, reused verbatim for vertical identity so a track never gets its own brand colour |

Deliberate omission: **no per-vertical colour scheme.** Hospital does not get a blue
theme and Restaurant an orange one. Verticals are content, not brand — and a colour per
vertical would be exactly the hardcoded-in-CSS content the restrictions forbid.

## 3. Typography rules the vertical screens enforce

- **16px body floor.** No `text-xs` (12px) or `text-sm` (14px) on any client-facing
  label, value, or helper text on these screens. `text-xs` is permitted only on the
  admin preview panel's metadata.
- Line-height `1.6` on all prose; `1.4` on headings.
- Display face (Bricolage) for card titles and screen headings only. Body face for
  everything a person has to *read*, including `outcome` copy.
- Touch targets ≥ 44×44px; vertical picker cards ≥ 96px tall.

## 4. Signature layout idea — "show the bubble, not the blueprint"

Specific to SendAnjal, and the one thing that makes these screens not a generic card grid:

> **Every vertical recommendation leads with the actual WhatsApp message the customer
> will receive, rendered as a chat bubble — never with a node graph, JSON, or a
> step count.**

A receptionist cannot evaluate `triggerNode → sendMessageNode → waitNode`. She can
evaluate *"Hi Anita, your appointment with Dr. Rao is confirmed for Tue 3:00 PM."*
instantly, because it is the thing her patient will see on their phone.

Layout of a recommendation card:

```
┌─────────────────────────────────────────────────────────────┐
│  Appointment reminders            ┌───────────────────────┐  │
│  ─────────────────────            │ ▌Hi Anita, this is a  │  │
│  Reminds patients before          │ ▌reminder for your    │  │
│  their visit so fewer people      │ ▌appointment tomorrow │  │
│  miss their slot.                 │ ▌at 3:00 PM.          │  │
│                                   └───────────────────────┘  │
│  [ Review and set up ]              what your customer sees  │
└─────────────────────────────────────────────────────────────┘
```

Left: plain-language `title` + `outcome`, one primary action. Right: the real first
message, in a bubble. The technical structure stays available behind "Review and set
up," which opens the existing canvas builder — the capable path, quieter, never hidden.

This also solves the Phase 0 §2 honesty problem cleanly: the card shows the *first*
message because the first message is what production actually sends today.

## 5. Copy rules (admin and client alike)

- Banned in client-facing surfaces: *webhook, payload, WABA, node, trigger, endpoint,
  API, JSON, conversation object, opt-in status*. Enforced in code by
  `findJargon()` in `lib/verticals/validate.ts` — a seed row with jargon fails the
  seed. This is a lint for English, and it runs on our content, not just on theory.
- Verb-to-toast mapping: "Save changes" → "Changes saved". "Set up this automation" →
  "Automation set up — review it before turning it on".
- Empty states are invitations: no vertical set → *"Pick an industry to get ready-made
  message ideas"* with the action inline, never a blank rail.
- Errors say what happened and what to do: *"We couldn't save the industry. Check your
  connection and try again."* Never a Postgres or Meta error string.
- **"Skip / not sure" is rendered at exactly the same size and weight as any vertical
  card** — same component, same height, same border. Not a text link underneath.

## 6. Interaction & accessibility

- One primary action per screen (`--primary` filled). Everything else is outline/ghost.
- Responsive to 360px: picker grid `1 → 2 → 3` columns; cards stack bubble under text
  below `sm`.
- Visible focus rings via the existing `--ring`; never `outline: none` without a
  replacement.
- `prefers-reduced-motion: reduce` → no card lift/scale transitions, opacity only.
- The AI-assisted path is visually *easy* (filled primary, top of page); the manual
  path is visually *capable* (outline button, equal prominence in the layout, never
  behind a disclosure).

## 7. Self-check against "does this look like any other AI-generated dashboard"

| Trap | Avoided how |
|---|---|
| Cream background + serif headings | Mint-tinted surface, grotesque display face — already shipped |
| Near-black + neon accent | Teal `#0B7285` on mint; amber for cost notes, no neon anywhere |
| Dense broadsheet stat grid | These screens have **no stat tiles at all** — they are content cards with message previews |
| Generic card grid with an icon and two lines | The message bubble is the card's primary visual; the icon is secondary |
| Per-feature accent colours | One primary, reused; no vertical gets its own colour |
