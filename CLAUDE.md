# WASend — WhatsApp Business SaaS Platform

## What is this project?

WASend is a **WhatsApp Business SaaS platform** built for Indian businesses. It lets companies send bulk WhatsApp messages, manage contacts, run campaigns, build automations, and track analytics — all from a web dashboard.

Think of it like a "Mailchimp for WhatsApp".

---

## Tech Stack (What technologies are used)

| Layer | Technology | Why |
|-------|-----------|-----|
| Frontend | Next.js 14 (React) | Full-stack web framework |
| Styling | Tailwind CSS | Utility-first CSS |
| Database | Supabase (PostgreSQL) | Hosted database + auth |
| Auth | Custom JWT (jose) | Session cookies, no Supabase Auth |
| Payments | Razorpay | Indian payment gateway |
| WhatsApp API | Meta Business API | Official WhatsApp messaging |
| Email | Resend | Transactional emails |
| Icons | Lucide React | Icon library |
| Charts | Recharts | Dashboard analytics charts |
| Toasts | Sonner | Notification popups |

---

## How to Run Locally

```bash
# Step 1: Install dependencies
npm install

# Step 2: Copy env file and fill in your Supabase keys
# (see Environment Variables section below)

# Step 3: Run the development server
npm run dev

# App opens at http://localhost:3000
```

**Test login credentials:**
- Email: `admin@wasend.demo`
- Password: `Test@12345`

---

## Environment Variables (`.env.local`)

Create a `.env.local` file in the root with these values:

```env
# Supabase — get from https://supabase.com/dashboard/project/YOUR_PROJECT/settings/api
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...     # Keep this SECRET — never expose to browser

# App URL
NEXT_PUBLIC_SITE_URL=http://localhost:3000

# JWT secret for session cookies — generate a random 64-char string
JWT_SECRET=your_random_64_char_secret

# WhatsApp webhook verification
WHATSAPP_WEBHOOK_VERIFY_TOKEN=your_webhook_token

# Razorpay — get from https://dashboard.razorpay.com/app/keys
RAZORPAY_KEY_ID=rzp_test_xxx
RAZORPAY_KEY_SECRET=your_secret
RAZORPAY_WEBHOOK_SECRET=your_webhook_secret
RAZORPAY_PLAN_STARTER_MONTHLY=plan_xxx
RAZORPAY_PLAN_STARTER_YEARLY=plan_xxx
RAZORPAY_PLAN_PRO_MONTHLY=plan_xxx
RAZORPAY_PLAN_PRO_YEARLY=plan_xxx

# Meta / WhatsApp Business
NEXT_PUBLIC_META_APP_ID=your_meta_app_id
META_APP_SECRET=your_meta_app_secret
NEXT_PUBLIC_META_CONFIG_ID=your_embedded_signup_config_id

# Email (optional — logs to console if not set)
RESEND_API_KEY=re_xxx
EMAIL_FROM=WASend <noreply@yourdomain.com>
```

---

## Database Setup (Supabase)

The app uses a **custom users table** (NOT Supabase Auth). You must run the SQL files in order:

### Step 1 — Create all tables
Go to [Supabase SQL Editor](https://supabase.com/dashboard/project/tbqfsudapxfqakzqbkgb/sql) and paste + run:
```
supabase/schema.sql
```

### Step 2 — Insert test data
Then run:
```
supabase/seed.sql
```

This creates the test user (`admin@wasend.demo`) and 60 sample contacts, 6 templates, campaigns, etc.

> **Note:** `schema.sql` uses `DROP TABLE CASCADE` — it will delete all existing data. Only run it on a fresh database or when you want to reset.

---

## Project Structure (Folder by folder)

```
wa-saas-platform/
├── app/                        # All Next.js pages and API routes
│   ├── (auth)/                 # Login, Register, Forgot Password pages
│   │   ├── login/page.tsx
│   │   ├── register/page.tsx
│   │   └── forgot-password/page.tsx
│   ├── (dashboard)/            # All pages after login (protected)
│   │   ├── layout.tsx          # Sidebar + Navbar wrapper for all dashboard pages
│   │   ├── dashboard/page.tsx  # Home dashboard with stats
│   │   ├── contacts/page.tsx   # Contact list with search/filter
│   │   ├── contacts/import/    # CSV import page
│   │   ├── templates/page.tsx  # WhatsApp message templates
│   │   ├── templates/send/     # Send a template manually
│   │   ├── campaigns/page.tsx  # Bulk message campaigns
│   │   ├── campaigns/create/   # Create new campaign
│   │   ├── automation/page.tsx # Automation rules
│   │   ├── automation/create/  # Create new automation
│   │   ├── crm/page.tsx        # CRM pipeline (Kanban board)
│   │   ├── crm/[id]/page.tsx   # Single contact CRM detail
│   │   ├── analytics/page.tsx  # Charts and stats
│   │   ├── numbers/page.tsx    # Connected WhatsApp numbers
│   │   ├── numbers/connect/    # Connect a new WhatsApp number
│   │   ├── billing/page.tsx    # Subscription and wallet
│   │   ├── billing/plans/      # Plan selection page
│   │   ├── billing/recharge/   # Add money to wallet
│   │   ├── settings/page.tsx   # Profile and account settings
│   │   ├── settings/team/      # Team members management
│   │   └── appointments/       # Appointment scheduling feature
│   ├── api/                    # Backend API routes (server-side)
│   │   ├── auth/               # login, register, logout, me, forgot-password
│   │   ├── contacts/           # CRUD + bulk import/delete
│   │   ├── templates/          # CRUD for message templates
│   │   ├── campaigns/          # CRUD + launch campaign
│   │   ├── automations/        # CRUD for automation rules
│   │   ├── crm/                # CRM contacts, deals, activities, pipeline
│   │   ├── whatsapp-numbers/   # CRUD for connected numbers
│   │   ├── whatsapp/           # connect + send message
│   │   ├── analytics/          # Analytics data
│   │   ├── dashboard/          # Dashboard stats
│   │   ├── wallet/             # Wallet balance + recharge
│   │   ├── transactions/       # Transaction history
│   │   ├── team-members/       # Team CRUD
│   │   ├── settings/           # Profile + password update
│   │   ├── billing/            # Subscriptions + usage
│   │   └── webhook/whatsapp/   # Receives incoming WhatsApp messages from Meta
│   ├── layout.tsx              # Root HTML wrapper (theme, fonts)
│   └── page.tsx                # Root redirect → /dashboard
│
├── components/                 # Reusable UI components
│   ├── layout/
│   │   ├── Sidebar.tsx         # Left navigation menu
│   │   └── Navbar.tsx          # Top bar (search, notifications, user menu)
│   └── shared/
│       ├── PageHeader.tsx      # Page title + action button header
│       ├── StatsCard.tsx       # Metric card with trend arrow
│       ├── StatusBadge.tsx     # Colored status pill (active/pending/etc)
│       └── EmptyState.tsx      # "Nothing here" placeholder with icon
│
├── lib/                        # Utility/helper code
│   ├── api.ts                  # All fetch calls to API routes (used by pages)
│   ├── auth.ts                 # JWT create/verify + getSessionUser()
│   ├── supabase/
│   │   ├── server.ts           # Supabase client using SERVICE_ROLE_KEY (for API routes)
│   │   └── client.ts           # Supabase client using ANON_KEY (for browser, if needed)
│   ├── utils.ts                # formatDate, formatCurrency, cn() helper
│   ├── meta.ts                 # Meta WhatsApp API calls (send message, etc.)
│   ├── razorpay.ts             # Razorpay subscription helpers
│   ├── email.ts                # Send email via Resend
│   └── demo-data.ts            # Fallback demo data (used in some UI previews)
│
├── types/index.ts              # TypeScript type definitions for all data models
├── middleware.ts               # Auth guard — redirects unauthenticated users to /login
├── supabase/
│   ├── schema.sql              # FULL database schema — run this first
│   ├── seed.sql                # Test data — run after schema.sql
│   ├── add_crm.sql             # (legacy — now merged into schema.sql)
│   └── add_subscriptions.sql  # (legacy — now merged into schema.sql)
├── .env.local                  # Secret keys (never commit this file!)
└── next.config.mjs             # Next.js config
```

---

## How Authentication Works

WASend uses **custom JWT authentication** (not Supabase Auth).

```
User submits login form
      ↓
POST /api/auth/login
      ↓
Looks up user in `users` table, checks bcrypt password hash
      ↓
Creates JWT token (signed with JWT_SECRET, expires in 7 days)
      ↓
Sets `wa_session` cookie (httpOnly — JS can't read it)
      ↓
Every page load: middleware.ts reads cookie → verifies JWT
      ↓
Every API call: getSessionUser() reads cookie → returns user object
```

**Key files:**
- `lib/auth.ts` — `createSessionToken()`, `verifySessionToken()`, `getSessionUser()`
- `middleware.ts` — protects all dashboard pages, redirects to `/login` if no valid session
- `app/api/auth/login/route.ts` — the login endpoint

---

## Database Tables

All tables are in `supabase/schema.sql`. Here's what each one stores:

| Table | Purpose |
|-------|---------|
| `users` | All platform users. Stores email, bcrypt password hash, name, company |
| `whatsapp_numbers` | Connected WhatsApp Business numbers per user |
| `contacts` | Customer contacts with CRM fields (stage, score, deal value) |
| `crm_activities` | Notes, calls, stage changes logged against a contact |
| `crm_deals` | Sales deals linked to contacts |
| `templates` | WhatsApp message templates (must be approved by Meta) |
| `campaigns` | Bulk message campaigns with recipient/delivery counts |
| `campaign_messages` | Individual message records per campaign (delivery status) |
| `automations` | Automation rules (trigger → action) |
| `wallet` | User wallet balance (one row per user) |
| `transactions` | Wallet credit/debit history |
| `subscriptions` | Razorpay subscription plan per user |
| `team_members` | Team members invited under an account |
| `daily_analytics` | Rolled-up daily message counts for charts |

---

## How API Routes Work

Every page fetches data from API routes in `app/api/`. API routes:
1. Call `getSessionUser()` → if no valid session, return `401 Unauthorized`
2. Call `createClient()` → gets a Supabase client with the service role key
3. Query the database using `supabase.from('table_name').select(...)` 
4. Return JSON

**Example flow — Contacts page:**
```
Browser loads /contacts
      ↓
contacts/page.tsx calls contactsApi.list()  [lib/api.ts]
      ↓
fetch('/api/contacts?page=1&limit=20')
      ↓
app/api/contacts/route.ts:
  - getSessionUser() → gets user.id from cookie
  - supabase.from('contacts').select('*').eq('user_id', user.id)
  - returns { contacts: [...], total: 60 }
      ↓
Page renders the table
```

---

## How `lib/api.ts` Works

This file is the **central API client** used by all frontend pages. It wraps `fetch()` so pages don't need to write fetch logic themselves.

```typescript
// Instead of writing this in every page:
const res = await fetch('/api/contacts')
const data = await res.json()

// Pages just write:
const data = await contacts.list()
```

Every function in `lib/api.ts` maps to one API route:
- `contacts.list()` → `GET /api/contacts`
- `contacts.create(data)` → `POST /api/contacts`
- `contacts.remove(id)` → `DELETE /api/contacts/:id`
- `templates.list()` → `GET /api/templates`
- `campaigns.create(data)` → `POST /api/campaigns`
- etc.

---

## How the CRM Works

The CRM is a Kanban-style pipeline for tracking leads/sales.

**Stages (columns):** `new_lead → contacted → qualified → interested → converted`

**Key files:**
- `app/(dashboard)/crm/page.tsx` — Kanban board UI
- `app/(dashboard)/crm/[id]/page.tsx` — Single contact detail with activity timeline
- `app/api/crm/contacts/` — CRM contact endpoints
- `app/api/crm/deals/` — Deal management
- `app/api/crm/pipeline/` — Pipeline stats (total deals, revenue)

**Database columns added to `contacts`:** `crm_stage`, `crm_score`, `deal_value`, `company`, `crm_source`, `crm_notes`, `assigned_to`

---

## How Campaigns Work

A campaign sends a WhatsApp template to many contacts at once.

```
Create campaign (pick template + audience)
      ↓
POST /api/campaigns → saves to `campaigns` table
      ↓
Launch: POST /api/campaigns/:id/launch
      ↓
Loops through contacts → calls Meta API to send each message
      ↓
Saves each message to `campaign_messages` table
      ↓
Updates sent/delivered/failed counts on `campaigns` row
      ↓
Meta sends delivery status updates to /api/webhook/whatsapp
```

---

## How Automations Work

Automations run in the background based on triggers.

| Trigger | What it watches for |
|---------|-------------------|
| `new_contact` | When a new contact is added |
| `keyword` | When a WhatsApp reply contains a keyword |
| `date_based` | On a specific date (e.g., birthday) |
| `inactivity` | Contact hasn't been messaged in N days |

| Action | What it does |
|--------|-------------|
| `send_template` | Sends a WhatsApp template |
| `add_to_group` | Moves contact to a group |
| `apply_tag` | Adds a tag to the contact |
| `wait_then_send` | Waits N hours then sends a template |

---

## How Billing Works

- Plans: **Free**, **Starter**, **Pro**
- Billing: Monthly or Yearly via **Razorpay Subscriptions**
- Wallet: Pre-paid credits deducted per message sent

**Key files:**
- `app/(dashboard)/billing/page.tsx` — Current plan + usage
- `app/(dashboard)/billing/plans/page.tsx` — Upgrade page
- `app/(dashboard)/billing/recharge/page.tsx` — Add wallet balance
- `app/api/billing/create-subscription/route.ts` — Create/cancel Razorpay subscription
- `app/api/billing/webhook/route.ts` — Razorpay sends payment events here
- `lib/razorpay.ts` — Razorpay API helper

---

## Shared Components (How to use them)

### `PageHeader`
```tsx
<PageHeader
  title="Contacts"
  subtitle="60 total contacts"
  action={<button>Add Contact</button>}   // optional right-side button
/>
```

### `StatsCard`
```tsx
<StatsCard
  title="Messages Sent"
  value="3,842"
  trend={12.5}          // positive = green arrow up, negative = red arrow down
  icon={MessageSquare}
/>
```

### `StatusBadge`
```tsx
<StatusBadge status="active" />     // green
<StatusBadge status="pending" />    // yellow
<StatusBadge status="rejected" />   // red
<StatusBadge status="approved" />   // green
```

### `EmptyState`
```tsx
<EmptyState
  icon={Users}
  title="No contacts yet"
  description="Import a CSV or add contacts manually"
  action={<button>Add Contact</button>}
/>
```

---

## Middleware (Route Protection)

`middleware.ts` runs on every page request **before** the page loads.

**Protected paths** (require login):
`/dashboard`, `/numbers`, `/contacts`, `/templates`, `/campaigns`, `/automation`, `/analytics`, `/billing`, `/settings`, `/crm`, `/appointments`

**Auth paths** (redirect to dashboard if already logged in):
`/login`, `/register`, `/forgot-password`

If you add a new protected page, add its path to the `protectedPaths` array in `middleware.ts`.

---

## TypeScript Types (`types/index.ts`)

All data shapes are defined here. When adding a new field to a table, update the corresponding interface:

```typescript
// Example: Adding a new field to Contact
export interface Contact {
  id: string;
  name: string;
  phone: string;
  // ... existing fields
  newField?: string;   // add your new field here
}
```

---

## How to Add a New Page (Step-by-step for freshers)

1. **Create the page file:**
   ```
   app/(dashboard)/my-new-page/page.tsx
   ```

2. **Add the API route:**
   ```
   app/api/my-new-data/route.ts
   ```

3. **Add the API call to `lib/api.ts`:**
   ```typescript
   export const myData = {
     list: () => request<{ items: MyItem[] }>('/api/my-new-data'),
   };
   ```

4. **Add the nav link in `components/layout/Sidebar.tsx`**

5. **Add the path to `protectedPaths` in `middleware.ts`** (if it needs login)

---

## Common Errors and Fixes

| Error | Cause | Fix |
|-------|-------|-----|
| `Unauthorized` on API | Not logged in / session expired | Log in at `/login` |
| `relation "contacts" does not exist` | Schema not run | Run `schema.sql` in Supabase SQL Editor |
| `Invalid credentials` | Wrong password or user not seeded | Run `seed.sql` to create test user |
| Page shows blank / loading forever | API error in console | Open browser DevTools → Network tab → check the failing API call |
| `JWT_SECRET is not defined` | Missing `.env.local` | Create `.env.local` with all required variables |
| Port 3000 in use | Another server running | App will auto-use 3001, 3002, etc. |

---

## Supabase Project Details

- **Project URL:** `https://tbqfsudapxfqakzqbkgb.supabase.co`
- **Project ID:** `tbqfsudapxfqakzqbkgb`
- **SQL Editor:** https://supabase.com/dashboard/project/tbqfsudapxfqakzqbkgb/sql
- **Table Editor:** https://supabase.com/dashboard/project/tbqfsudapxfqakzqbkgb/editor

---

## What's NOT yet implemented (Future work)

- Real Meta WhatsApp API integration (currently saves to DB but doesn't actually send)
- Push notifications
- Multi-language UI
- Mobile app
- Role-based access control (admin vs agent permissions in UI)
- Report export (PDF/Excel)
- WhatsApp chatbot builder
