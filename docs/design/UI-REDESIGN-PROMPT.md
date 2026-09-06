# SendAnjal UI Redesign — Brief

> **How to use this file.** Paste the whole thing into a fresh Claude Code session opened at the
> repo root. It is written to be executed, not admired: every claim in it was measured against this
> codebase on 2026-09-05, and the file paths and counts are real. Work the phases in order. Do not
> skip Phase 0 — three of the findings there are why the product currently looks unfinished, and no
> amount of restyling fixes them.

---

## 0. Read this first — three defects that are masquerading as design problems

Fix these before you form any opinion about how the app looks. Two of them mean **you have never
actually seen this product's intended design**, and one means a core flow may be broken.

### 0.1 The entire app renders in Times New Roman

Three fonts are downloaded on every page load. **None of them reach the screen.** Verified live:

```
getComputedStyle(document.body).fontFamily          → "Times"
getComputedStyle(document.querySelector('h1'))      → "Times"
getComputedStyle(document.documentElement)
  .getPropertyValue('--font-geist-sans')            → ""          ← undefined at <html>
getComputedStyle(document.body)
  .getPropertyValue('--font-geist-sans')            → "'__Plus_Jakarta_Sans_a11773', …"
```

**Cause.** `app/layout.tsx:88` puts the font variables on `<body>`:

```tsx
<body className={`${sans.variable} ${display.variable} ${jetbrainsMono.variable} antialiased`}>
```

Tailwind Preflight emits `html { font-family: var(--font-geist-sans), system-ui, sans-serif }`.
At `<html>` that variable does not exist, so the whole declaration is invalid at computed-value
time and `<html>` falls back to the browser default — Times. `<body>` inherits it, because the
`body` rule in `app/globals.css:169-175` sets background, colour, `font-feature-settings` and
`line-height` but never `font-family`. Nothing in the app uses `font-sans`, so Tailwind never even
emits `.font-sans` as a rescue.

**Fix.** Move the variable classes to `<html>` (keep `suppressHydrationWarning`), and add an
explicit `font-family` to the `body` rule in `globals.css` as a belt-and-braces guard.

Plus Jakarta Sans, Bricolage Grotesque and JetBrains Mono were all chosen deliberately and are all
good choices. **Do not re-pick fonts.** Make the existing ones render.

### 0.2 Every Tailwind size in the app is 1.25× what the source says

`app/globals.css` `@layer base`:

```css
html { font-size: 125%; }                            /* 16px → 20px */
@media (max-width: 640px) { html { font-size: 112.5%; } }
```

Confirmed live: `getComputedStyle(document.documentElement).fontSize === "20px"`.

So `text-sm` is 17.5px, not 14px. `p-6` is 30px, not 24px. Every judgement you make from reading
class names is wrong by 25%, and any mockup drawn at nominal Tailwind sizes will not match.

**Decide explicitly and state the decision in your commit:** either drop to `100%` and re-scale the
type ramp honestly, or keep the zoom and document it at the top of `globals.css`. Do not leave it
undeclared. Given the audience reads on small Android screens, the zoom is defensible — but it must
be a decision, not an accident.

### 0.3 The auth pages are built for a dark theme the app does not ship

`app/layout.tsx:97` — `defaultTheme="light"`, `enableSystem={false}`. The app is light by default.
All three auth pages hardcode dark chrome:

```tsx
// app/(auth)/login/page.tsx:71
<div className="min-h-screen bg-[#0f1117] grid-bg …">
// app/(auth)/login/page.tsx:114
className="w-full bg-white/5 border rounded-xl … text-white placeholder:text-slate-600 …"
```

Same at `register/page.tsx:91,129,155` and `forgot-password/page.tsx:44,107`. On a light mint
ground, `bg-white/5` is invisible and `text-white` input text is invisible on white.
**Verify whether login is actually usable in the default theme before anything else.** (Local dev
hides this — `DEV_AUTO_LOGIN=true` skips the login screen entirely.)

Also broken and trivial to fix while you are in there:

- `w-4.5 h-4.5` is used **16 times** but is not in Tailwind's spacing scale and is not added by the
  config — confirmed absent from the built CSS. Those Lucide icons silently render at their default
  24px instead of 18px. Worst offenders are the persistent chrome: `components/layout/Navbar.tsx:89,91,103`
  (theme toggle, bell) and `app/(dashboard)/inbox/page.tsx:805,816,825,964,975,1011,1022,1023`
  (the entire inbox action bar and send button).
- `bg-rec`, `bg-rec/40`, `border-rec-border` in `components/verticals/NewVerticalForm.tsx:156,271`
  reference a `rec` colour defined nowhere. Those fieldsets render with no background and no border.
- `.admin-console` is applied as a class 6 times (`admin/page.tsx:461`, `industries/page.tsx:275`,
  `industries/[id]:274`, `tenants/page.tsx:394`, `audit/page.tsx:250`, `ops/page.tsx:384`) but
  **there is no `.admin-console { }` rule anywhere.** The `--a-*` tokens sit on `:root`. The comment
  at `globals.css:68` claiming the palette is *"scoped to `.admin-console` so it can never bleed
  into client screens"* describes scoping that does not exist.

---

## 1. What this product is and who uses it

SendAnjal is a multi-tenant WhatsApp Business API SaaS for the Indian market, operating as a Meta
Tech Provider / BSP. It onboards small businesses onto the WhatsApp Business API, routes their
messaging, and bills them, so the client never touches Meta's technical complexity.

**The person on the other side of the screen is not a SaaS power user.** They are a clinic
receptionist, a salon owner, a restaurant manager, a coaching-centre admin, a shopkeeper. Design
implications that are not negotiable:

1. **Phone-first.** This audience works on a mid-range Android in daylight. Low-contrast pastels,
   thin greys and 10px labels do not survive that. See §7 — this is currently the product's largest
   gap.
2. **Money anxiety is a real, constant state.** Billing is prepaid: when the wallet empties, all
   sending stops. Balance and cost must be legible at a glance and never ambiguous. A higher
   per-message rate is *information*, not an error — the repo already encodes this
   (`--cost-note`, amber, with the comment *"a higher per-message cost is information, not an
   error"*). Honour it: **never render a cost in red.**
3. **Plain language beats jargon.** The best copy in the repo already does this —
   `app/(dashboard)/automation/page.tsx` says *"Ready-made replies for your business. Open one,
   change the wording, then turn it on."* and labels a preview *"WHAT YOUR CUSTOMER SEES"*. That
   voice is an asset. Extend it; do not replace it with SaaS-speak.
4. **Reversibility must be visible.** Users are nervous about broadcasting to real customers. The
   existing *"Pre-fill only — nothing sends until you confirm"* pattern is exactly right.

Competitive context: WATI, AiSensy, Interakt and DoubleTick are all glossy gradient-and-pastel
admin dashboards. Looking like them is not a goal.

---

## 2. Design direction — "Quiet Ledger"

**Promote the design language that already exists in this repo, on the existing teal brand.**

`components/verticals/ui.tsx` (267 lines) is the best-designed thing in the codebase and the only
real primitive set: `Eyebrow`, `Annotation`, `Panel`, `PanelHeading`, `Lede`, `Chip`, `CodeBlock`,
`ButtonPrimary`, `ButtonAssist`, `ButtonQuiet`, `Dot`, `CustomerMessage`, `ConfirmNote`. It uses
zero raw colours, has real `focus-visible` rings, a shared `BTN_BASE`, a `min-h-[2.75rem]` touch
target, and a documented philosophy:

> *Warm paper ground, white cards, ONE hairline weight, no shadows… ONE green accent.*

That is the direction. Four reasons it is the right one here:

1. **It already exists, is token-pure, and has primitives.** Promoting it is cheaper and safer than
   inventing a fourth language on top of the three already in the repo.
2. **It differentiates.** A calm, document-like surface reads as trustworthy for software that
   spends a shop owner's prepaid wallet in real time. Gradients and glow read as marketing.
3. **It survives the real viewing conditions.** The current pastel chips (`Marketing ₹2.00` in
   pink-on-pink on `/billing`), gradient buttons and hover shadow-lifts do not.
4. **The palette is not the problem — the discipline is.** The teal token set measures well:
   foreground on card 15.78:1, muted-foreground on card 6.22:1, primary on card 5.60:1, white on
   primary 5.60:1. All pass AA. Keep it.

**Keep teal `#0B7285`.** It was chosen deliberately as *not* WhatsApp green, and that judgement was
correct — a BSP that looks like WhatsApp itself invites confusion about who the customer's
relationship is with.

### The rules that make it "Quiet Ledger"

| | Rule |
|---|---|
| Surfaces | One card treatment. One hairline weight. No `border-border/20…/80` opacity soup. |
| Elevation | Shadows only for things that genuinely float — modals, popovers, dropdowns. **No hover shadow-lifts on cards.** |
| Gradients | None on chrome. `.wa-gradient` is retired from buttons, avatars and tiles. |
| Accent | Teal is the only accent. Emerald is reserved for *delivered / sent*. Amber for *cost*. Rose for *destructive and failure only*. |
| Rainbow | No per-item pastel icon chips. The four gradient quick-action tiles on `/dashboard` and the five pastel KPI chips on `/campaigns` go. |
| Numbers | All money and metrics get `font-variant-numeric: tabular-nums`. Money uses the existing `formatCurrency` from `lib/utils.ts` (INR, `en-IN`, 0 decimals). |
| Eyebrows | Mono uppercase (`font-mono text-[0.6875rem] tracking-wider`) for machine data and section labels — the `Eyebrow` pattern from `components/verticals/ui.tsx`. |
| Emoji | Not iconography. Replace `🤖 📋 📷 🎥 🎵 📄 📍 🟢 🟡 ✅ 📅 🔔 😊 🙏 🌟 👇` with Lucide. They render inconsistently across platforms and ignore the theme. |

---

## 3. Tokens

### Keep as-is

The core semantic set in `app/globals.css` — `--background --foreground --card --popover --primary
--primary-hover --secondary --muted --accent --destructive --success --warning --border --input
--ring --radius` — in both `:root/.light` and `.dark`. Light primary is `189 85% 28%` (`#0B7285`),
background `178 44% 96%`, radius `0.75rem`. The `.dark` block is a complete parallel set. All
contrast pairs pass AA. **Do not re-pick these values.**

Also keep: `--cost-note` (amber, cost is information) and the reduced-motion block at
`globals.css:349-362`, which is correctly written.

### Consolidate

There are currently **three full palettes** in one product:

| Palette | Scope today |
|---|---|
| Teal app chrome (`--primary`, …) | all tenant screens |
| `--v-*` warm workbench | vertical/industry screens + `admin/clients/[id]/setup` |
| `--a-*` indigo console | 6 of 9 admin screens |

An admin clicking **Overview → Rates → Client setup** crosses all three. `/admin` is indigo-on-paper
and `/admin/rates` is teal-on-mint, under the same nav.

**Target: one core token set, plus a single admin *accent* override.** Keep the visual signal that
"you are in the platform console" — that is genuinely useful — but express it as an accent swap
(indigo `--a-primary` → `--primary` within a real, actually-defined `.admin-console` scope), not as
a second ground, second card, second hairline and second type scale. Delete `--v-*` as a separate
language once its patterns are absorbed into the core primitives.

### Fix

- **`rounded-lg` and `rounded-xl` are both 12px.** `--radius: 0.75rem` remaps `lg`, but `xl`/`2xl`
  are left at Tailwind defaults. So a hierarchy that reads as deliberate in source renders as
  identical. Define the full radius scale in `tailwind.config.ts` and pick **one** card radius.
  For reference, card surfaces today: `rounded-2xl` ×123, `rounded-xl` ×17, `rounded-lg` ×5 — while
  the system's own `.card-surface` specifies `rounded-xl`. The majority contradicts the token.
- **Chart series still use the pre-rebrand WhatsApp green.** `#25D366` / `#128C7E` in
  `dashboard/page.tsx:308-310`, `analytics/page.tsx:160-162,211-212`, `billing/page.tsx:497`
  (spelled lowercase there), `campaigns/[id]/page.tsx:346,354`. Plus raw `#25D366`/`#1DA851` chrome
  in `numbers/connect/page.tsx:113`, `EmbeddedSignupModal.tsx` (8 sites), `MetaConnectButton.tsx:44`,
  `SendTestMessage.tsx:225`. Move all chart colours onto tokens the way the admin charts already do
  (`stroke="hsl(var(--a-line))"`).
- **Dark-only chart chrome on a light app**: `stroke="rgba(255,255,255,0.05)"` on `CartesianGrid`
  (`dashboard:303`, `analytics:155,207`, `campaigns/[id]:330`, `billing:480`) is invisible; the
  tooltip at `billing/page.tsx:490` is `background: "#1a2535"` — a dark tooltip on a light chart.
- **`public/manifest.json`** still carries `"theme_color": "#25D366"` and
  `"background_color": "#0b141a"`; `app/layout.tsx:72-75` `viewport.themeColor` is `#0b141a`/`#ffffff`.
  None match the teal brand.
- **Rename `.wa-gradient`** (36 usages) — the name says WhatsApp, the value is teal. The name keeps
  pulling contributors back to green. Retire the class with the gradient.

---

## 4. Type system

Today there are **9 distinct `<h1>` treatments** for the same hierarchy level, **14 for `<h2>`**, and
**353 arbitrary sizes across 14 distinct values** (`text-[11px]` ×140, `text-[10px]` ×134,
`text-[9px]` ×11, plus both `px` and `rem` idioms and `text-[0.875rem]`, which is `text-sm` written
the long way). On top of 631 `text-xs`.

Meanwhile `globals.css` already defines a type scale — `.text-page-title`, `.text-section-title`,
`.text-card-title`, `.text-body`, `.text-caption` — with **zero usages between them.** Same for
`.card-surface` and `.card-pad`. The design system exists on paper and is used nowhere.

**Do one of two things, not neither:** make those classes real and adopt them everywhere, or delete
them and express the scale through the primitives in §5. Either is fine; the current state is not.

Ship a closed ramp. Nothing outside it, no arbitrary `text-[Npx]` in feature code:

| Role | Face | Use |
|---|---|---|
| Page title | Bricolage Grotesque (`font-display`) | one per screen |
| Section title | Plus Jakarta 600 | panel and group headings |
| Body | Plus Jakarta 400 | prose, table cells |
| Label / eyebrow | JetBrains Mono, uppercase, tracked | machine data, column heads, section labels |
| Numeric | Plus Jakarta, `tabular-nums` | money, counts, rates |

Note this finally gives Bricolage Grotesque a job — it is loaded on every page today and rendered
essentially nowhere (`font-display` appears in 3 places, two of which are the dead CSS classes).

---

## 5. Build the primitive layer — this is the root cause

There is no `components/ui/`. No shadcn, no Radix, no cva. `lib/utils.ts` has the canonical `cn()`
helper and nothing consumes a primitive set. 47 pages hand-roll every button, card, input and table.
That single absence produces every symptom below:

| Symptom | Measured |
|---|---|
| Raw palette utilities (`emerald` 310, `amber` 210, `violet` 192, `red` 166, `blue` 150, `slate` 52, …) | **1,234 across 54 of 73 files** |
| `text-white` | 256, against only 36 `dark:` variants app-wide |
| Distinct text-input class strings for the same control | 25+ |
| Hand-rolled modals | 33 across 21 files, **13 different backdrops** (scrim `/50`–`/70`, blur `sm`/`md`/none, z-index 10/30/40/50) |
| Modals with `role="dialog"` + `aria-modal` + Escape | **1 of 33** |
| Native `confirm()` as the destructive dialog | 9 |
| `<thead>` re-declared | 25 across 22 files |
| Pagination re-implemented | 16 times, two incompatible idioms (`/contacts` renders *every* page number, unbounded) |
| Tab bars re-implemented | 10 |
| KPI/stat card implementations | 5 competing, plus 32 pages with inline stat grids |
| `Field` implementations | 3, with label type `text-[11px] uppercase` vs `text-xs font-medium` vs `text-base font-medium` |
| Spinners vs skeletons | 98 spinners across 44 files; `Skeleton.tsx` used by 5 |
| `htmlFor` | **0**, against 174 form controls and 120 `<label>` elements |
| `aria-label` | 12 total; ~57 icon-only buttons unlabeled; 35 `<X>` close buttons, 1 labeled |
| `outline-none` with no replacement ring on the same element | 75 of 117 |
| `role=` attributes | 2 in the entire app |

**Build `components/ui/` first.** Nothing else in this brief is durable without it.

Required, with variants:

- `Button` — `primary | secondary | quiet | destructive`, sizes `sm | md`, `loading`, `iconOnly`
  (which **requires** an `aria-label` at the type level). Flat fill, no gradient, no shadow.
  `min-h-[2.75rem]` for touch on `md`.
- `Card` / `Panel` — one radius, one hairline, `p-5`, optional `header` slot. No hover shadow.
- `Field` — owns `htmlFor`/`id` generation via `useId()`, label, required marker, hint, error slot.
  **Every input in the app must go through it.** This closes the entire form-a11y gap in one move.
- `Input`, `Textarea`, `Select`, `Checkbox`, `Radio`, `Switch` — one focus treatment,
  `focus-visible` ring (not `focus:`, and not a 1px border tint — `focus:border-primary/60` appears
  verbatim 22 times and is not a WCAG 2.4.7-adequate indicator).
- `Table` — `Table/Head/Row/Cell`, sticky header, one header casing, zebra-free, plus a
  **`renderCard` prop that collapses each row to a card below `md`** (see §7).
- `Badge` — absorb `StatusBadge`. Its `running` and `scheduled` states currently escape to raw
  `blue-500`/`purple-500` while every sibling uses tokens; map them onto the token set.
- `Modal` — one backdrop, focus trap, Escape, `role="dialog"`, `aria-modal`, labeled close, body
  scroll lock. Migrate all 33.
- `ConfirmDialog` — replaces all 9 native `confirm()` calls. Consequence-explaining copy, and the
  destructive verb on the button, not "OK".
- `Tabs`, `Pagination`, `EmptyState`, `LoadingState`, `ErrorState`, `Tooltip`.

**Reuse what is already good** — do not rebuild these:

- `cn()`, `formatCurrency`, `formatNumber`, `formatDate`, `formatDateTime`, `getInitials` —
  `lib/utils.ts`
- `lib/motion.ts` — a well-written token file (`durations`, `easing`, `transitions`, `fadeUp`,
  `staggerContainer`, `modal`, `drawer`, `wizardStep`, `press`). It has **two consumers today**;
  `Sidebar.tsx` reimplements its own timings inline. Route all animation through it, and add the
  `useReducedMotion()` guard its own header recommends — the global CSS media query does not stop
  framer-motion's JS-driven animations.
- The patterns in `components/verticals/ui.tsx` — port them up into `components/ui/`.

---

## 6. Screens, in the order this audience touches them

Priority is by real traffic for a small Indian business, not by code size.

1. **`/inbox`** — `app/(dashboard)/inbox/page.tsx`, 1200 lines. The #1 daily screen; a shop owner
   lives here. Three panes, ~11px type throughout, 47 raw-palette hits, and it hardcodes WhatsApp's
   own dark chat chrome (`#0b141a`, `#111b21`, `#202c33`) inside a light app — which is why the
   conversation list renders as a dark slab against the mint ground. Rebuild on tokens. It is also
   the one genuinely mobile-aware screen in the app (list/thread swap, `lg:hidden` back arrow) —
   preserve that and make it the model for the rest.
2. **`/billing`** — 622 lines, one breakpoint. Second in importance: prepaid means users check the
   balance constantly. Balance is the hero. Fix the "Numbers connected 1/1" bar currently rendering
   **full red** — at-capacity is not an error. Replace the pastel `Marketing / Utility / Auth` rate
   chips (pink/blue/amber on tinted grounds) with a legible rate table on tabular numerals.
3. **`/dashboard`** — the best-adapted screen today (16 breakpoints) and the landing page every
   session. Kill the four rainbow gradient quick-action tiles (`from-green-500/20 / blue / purple /
   amber` — the canonical Tailwind admin rainbow, `dashboard/page.tsx:21-26`). Keep the Getting
   Started checklist; it is doing real onboarding work.
4. **`/numbers/connect`** — make-or-break. A non-technical owner either gets through Meta Embedded
   Signup here or churns. Route the 1313-line `EmbeddedSignupModal` (53 raw-palette hits, 8 hardcoded
   `#25D366`) onto the new `Modal`. It is currently the *only* accessible modal in the app — keep
   that behaviour and generalise it.
5. **`/templates`** — 1094 lines, 3 composer modes, live bubble preview. Template approval is the
   single biggest friction point in WhatsApp BSP onboarding; the preview is the most valuable thing
   on the screen. Give it room.
6. **`/campaigns/create`** — 1167 lines, the revenue action. The 4-step stepper and Live Summary
   panel are genuinely good; keep the structure, restyle it.
7. **`/contacts` + `/contacts/import`** — the first-run path. Getting a customer list in is step one
   for every new tenant.

Then: `/campaigns`, `/segments`, `/automation`, `/crm`, `/catalog`, `/analytics`, `/appointments`.
Last: `/settings/*`, `/ads`, and the 9 admin screens.

**Resolve the duplicate routes rather than styling both:**

- `/segments` (in nav) vs `/contacts/segments` (orphaned, not in nav)
- `/settings/api` (in nav) vs `/settings/api-keys` (orphaned) — both do API-key CRUD, both have
  their own `confirm("Revoke this API key…")` with *different copy*
- `/settings/api/docs` vs `/docs/api` — two API references
- `/billing/recharge` vs the top-up inside `/billing`

**Two feature areas are static mockups, not backends.** `app/(dashboard)/appointments/page.tsx`
(506 lines) and `appointments/automations/page.tsx` (379 lines) never call `fetch` — they render
`DEMO_APPOINTMENTS` / `INITIAL_AUTOMATIONS` with names like "Rajesh Kumar" and hardcoded 2026 dates,
while sitting in the sidebar as real features. Redesign them as UI, but **do not present them as
working**, and flag the gap.

---

## 7. Mobile is the biggest product gap, not a polish item

The shell is responsive. The content is not.

- **9 screens contain zero responsive classes** — all 5 settings screens, `/catalog/orders`, and all
  3 auth screens. `/settings/api` is 647 lines with not one breakpoint.
- 5 more have exactly one, including `/billing` (622 lines, with a transaction table).
- **~22 screens use `<table>` and none collapse to cards.** `overflow-x-auto` is the entire mobile
  strategy. `/campaigns` puts 9 columns behind a scrollbar on a 360px phone.
- Unguarded fixed grids hold their column count at 320px: `grid-cols-2` ×7, `grid-cols-3`,
  `grid-cols-7` (the appointments calendar), `grid-cols-5`.
- `app/layout.tsx:78` sets `maximumScale: 1` — **pinch-zoom is blocked.** Remove it; it is an
  accessibility failure and this audience zooms.
- `/automation/create` is a React Flow drag-drop canvas — structurally unusable on touch. Give it an
  honest desktop-only message rather than a broken screen.

**The mandate:** every list gets a card layout below `md` via the `Table` primitive's `renderCard`.
Every screen must be usable at 390px. For a phone-first audience this outranks most of the visual work.

---

## 8. Shell defects to fix in Phase 2

`components/layout/Navbar.tsx` currently reads as a demo:

- `pageTitles` (`:21-38`) is a hardcoded map of **17 routes**. There are 42 dashboard pages, so 25
  render the title **"Dashboard"** — `/crm`, `/catalog`, `/ads`, `/appointments` and every `/admin/*`
  page included. `/admin/ops` shows a topbar reading "Dashboard" above an `<h1>` reading "Tenant
  Admin Dashboard". Derive titles from a route config instead.
- Notifications (`:118-146`) are three hardcoded fake items.
- The avatar hardcodes `VM` / "Vikram Malhotra" / `admin@sendanjal.com` (`:162,172`) **while the
  sidebar shows the real signed-in user** — two conflicting identities on screen at once.
- The search input (`:73-78`) has no state and no handler. Wire it or remove it.
- Its logout only clears `localStorage`; it never calls the logout API, unlike the sidebar's.

`components/layout/Sidebar.tsx`:

- All groups default to expanded — with admin on, that is 11 top-level items + 22 children =
  **33 rows**, well past one viewport. Default to collapsed-except-active.
- Collapse state is not persisted; it resets to expanded on every reload.
- `{ label: "Inbox", badge: 3 }` (`:57`) is a hardcoded unread count.
- CRM is filed under Campaigns. Revisit the IA — 12 groups is too many for this audience.
- The user block is `hover:bg-accent` but is not a button and has no menu; the hover implies
  clickability it does not have.
- Logout uses `text-red-400 hover:bg-red-500/10` — should be `destructive`.

`app/layout.tsx`: `<Toaster theme="light" />` is hardcoded, so Sonner's chrome stays light in dark
mode. Drive it from `useTheme()`.

---

## 9. Hard rules

1. **Visual layer only.** Do not modify `lib/billing/**`, `lib/whatsapp/**`, `lib/queue/**`,
   `lib/meta*.ts`, or any file under `app/api/**`. If a redesign appears to need a data shape that
   does not exist, stop and say so rather than inventing an endpoint.
2. **Never fabricate a metric.** If a number is not in the API response, do not render a placeholder
   that looks real. This applies especially to the admin consoles.
3. **Keep `/admin` and `/admin/ops` separate.** The split is deliberate and documented in the file
   headers: `/admin` carries revenue, MRR and margin; `/admin/ops` deliberately carries **no**
   revenue data. Do not merge them.
4. **Preserve `invertDelta`** (`admin/ops/page.tsx`) — for failure counts a rise is bad, and the
   colour must not read "up = good". Carry this into the new `Badge`/`Delta` primitive.
5. **Cost is never red.** Amber (`--cost-note`). A higher per-message rate is information.
6. **Do not touch money formatting logic.** Money is integer paise; use `formatCurrency`.
7. **Do not re-pick the fonts or the core palette.** Both are already good; §0.1 explains why you
   have not seen them.
8. **Preserve the plain-language copy voice.** Do not "professionalise" it into jargon.
9. One phase per commit. Do not start the next phase until the previous one's gate passes.

---

## 10. Phases

| Phase | Scope | Gate |
|---|---|---|
| **0** | Font fix; root font-size decision; `w-4.5`/`bg-rec` dead classes; real `.admin-console` scope; auth-page light-mode break; manifest + `viewport.themeColor`; remove `maximumScale` | App renders in Plus Jakarta; login usable in light mode; before/after screenshots |
| **1** | `components/ui/` primitives + token consolidation + radius scale + type ramp | Every primitive rendered on a scratch route, light + dark, keyboard-navigable |
| **2** | Shell — Sidebar IA + collapse memory, Navbar real titles/identity/search | Nav usable at 390px; no route titled "Dashboard" incorrectly |
| **3** | `/inbox`, `/billing`, `/dashboard`, `/numbers/connect` | Each passes at 390px and 1440px, light + dark |
| **4** | `/templates`, `/campaigns/*`, `/contacts/*`, `/segments`, `/automation`, `/crm`, `/catalog` | Duplicate routes resolved |
| **5** | Admin consoles, `/settings/*`, auth pages, `/analytics`, `/ads`, `/appointments` | Three design languages reduced to one + admin accent |
| **6** | Codemod sweep: raw palette → tokens (`emerald`→`success`, `red`→`destructive`, `amber`→`warning`), starting with the 10 worst files | See §11 |

Worst files by raw-palette count, for Phase 6 ordering: `automation/page.tsx` (92),
`appointments/automations/page.tsx` (68), `appointments/page.tsx` (67), `crm/[id]/page.tsx` (56),
`EmbeddedSignupModal.tsx` (53), `crm/page.tsx` (53), `campaigns/create/page.tsx` (53),
`ads/page.tsx` (52), `inbox/page.tsx` (47), `campaigns/page.tsx` (44).

---

## 11. Verification — run this after every phase

```bash
npm run check          # tsc + lint + build + audit (scripts/production-check.sh)
npm run dev            # :3000 — DEV_AUTO_LOGIN=true lands you on /dashboard
```

Test account: `admin@sendanjal.com` / `Test@12345`. Auto-login is on, so you go straight to
`/dashboard` — to test the auth pages you must visit them with auto-login off.

Drive the browser and check, per redesigned screen, at **1440px and 390px, light and dark**:

```js
// Phase 0 gate — must contain Plus_Jakarta_Sans, must not be "Times"
getComputedStyle(document.body).fontFamily

// no element may sit below 4.5:1; the current token set already passes,
// so this is a no-regression gate, not a new bar
```

Regression greps — each should trend to zero outside `components/ui/`:

```bash
# raw palette utilities across every colour family — 1,234 in 54 files today
grep -rhoE "\b(bg|text|border|ring|from|to|via|shadow|fill|stroke)-(emerald|amber|violet|red|blue|slate|purple|orange|pink|cyan|green|teal|indigo|yellow|fuchsia|sky|gray|rose|lime)-[0-9]{2,3}" app components | wc -l

grep -rnE "bg-\[#|text-white|bg-slate-|text-slate-|bg-gray-|text-gray-" app components | wc -l   # 329 today
grep -rn "w-4\.5\|h-4\.5" app components | wc -l                                                  # 16 today
grep -rn "confirm(" app components | wc -l                                                        # 9 today
grep -rn "25D366\|128C7E\|1DA851" app components public | wc -l                                   # 25 today
grep -rn "<label" app components | wc -l   # 120 today, all needing htmlFor via <Field>
grep -rn "htmlFor" app components | wc -l  # 0 today — this is the number that must move
```

Accessibility floor before any phase is called done: every icon-only button has an `aria-label`;
every input is reached through `Field` with a real `htmlFor`; every modal traps focus and closes on
Escape; every interactive element has a visible `focus-visible` ring.

---

## 12. Where the facts in this brief came from

Measured against this repo on 2026-09-05, at commit on branch `feat/whatsapp-core-media-templates`.
47 `page.tsx` files (~21,500 lines of route code), 73 `.tsx` files across `app/` + `components/`.
Font and contrast figures were read out of the running app, not inferred. Key files to re-read
before you start: `app/layout.tsx`, `app/globals.css`, `tailwind.config.ts`, `lib/motion.ts`,
`lib/utils.ts`, `components/verticals/ui.tsx`, `components/layout/{Sidebar,Navbar}.tsx`,
`components/shared/*`, and `CLAUDE.md` for the non-negotiable domain rules.
