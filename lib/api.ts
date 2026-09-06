async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  const data = await res.json();
  if (!res.ok) {
    const msg = data.error || "Request failed";
    const err = new Error(msg) as Error & { status: number };
    err.status = res.status;
    throw err;
  }
  return data as T;
}

// Auth
export const auth = {
  login: (email: string, password: string) =>
    request("/api/auth/login", { method: "POST", body: JSON.stringify({ email, password }) }),

  register: (payload: { email: string; password: string; fullName: string; companyName: string }) =>
    request("/api/auth/register", { method: "POST", body: JSON.stringify(payload) }),

  logout: () => request("/api/auth/logout", { method: "POST" }),

  me: () => request("/api/auth/me"),

  forgotPassword: (email: string) =>
    request("/api/auth/forgot-password", { method: "POST", body: JSON.stringify({ email }) }),
};

// Contacts
export const contacts = {
  list: (params?: { search?: string; group?: string; page?: number; limit?: number }) => {
    const q = new URLSearchParams();
    if (params?.search) q.set("search", params.search);
    if (params?.group) q.set("group", params.group);
    if (params?.page) q.set("page", String(params.page));
    if (params?.limit) q.set("limit", String(params.limit));
    return request<{
      contacts: Contact[];
      total: number;
      /** True when this tenant's industry requires explicit consent. */
      consentRequired?: boolean;
      consentRequiredBecause?: string | null;
    }>(`/api/contacts?${q}`);
  },
  create: (data: Partial<Contact>) =>
    request<Contact>("/api/contacts", { method: "POST", body: JSON.stringify(data) }),
  update: (id: string, data: Partial<Contact>) =>
    request<Contact>(`/api/contacts/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  remove: (id: string) =>
    request(`/api/contacts/${id}`, { method: "DELETE" }),
  bulkImport: (items: Partial<Contact>[]) =>
    request<{ imported: number }>("/api/contacts/import", { method: "POST", body: JSON.stringify({ contacts: items }) }),
  bulkDelete: (ids: string[]) =>
    request("/api/contacts/import", { method: "DELETE", body: JSON.stringify({ ids }) }),

  /** Record or withdraw consent for one contact. */
  setConsent: (id: string, given: boolean, source?: string) =>
    request<{ consent: { contactId: string; given: boolean; at: string | null; source: string | null } }>(
      `/api/contacts/${id}/consent`,
      { method: "POST", body: JSON.stringify({ given, source }) },
    ),

  /** Record or withdraw consent for many contacts at once. */
  setConsentBulk: (contactIds: string[], given: boolean, source?: string) =>
    request<{ updated: number; failed: { id: string; error: string }[] }>("/api/contacts/consent", {
      method: "POST",
      body: JSON.stringify({ contactIds, given, source }),
    }),
  count: (params?: { audienceType?: string; tags?: string; excludeRecentHours?: number }) => {
    const q = new URLSearchParams();
    if (params?.audienceType) q.set("audienceType", params.audienceType);
    if (params?.tags) q.set("tags", params.tags);
    if (params?.excludeRecentHours) q.set("excludeRecentHours", String(params.excludeRecentHours));
    return request<{ count: number }>(`/api/contacts/count?${q}`);
  },
};

// WhatsApp Numbers
export const numbers = {
  list: () => request<{ numbers: WhatsAppNumber[] }>("/api/whatsapp-numbers"),
  create: (data: Partial<WhatsAppNumber> & { metaAppId?: string; metaAppSecret?: string; wabaId?: string; accessToken?: string }) =>
    request<WhatsAppNumber>("/api/whatsapp-numbers", { method: "POST", body: JSON.stringify(data) }),
  update: (id: string, data: Partial<WhatsAppNumber>) =>
    request<WhatsAppNumber>(`/api/whatsapp-numbers/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  remove: (id: string) =>
    request(`/api/whatsapp-numbers/${id}`, { method: "DELETE" }),
};

// Templates
export const templates = {
  list: () => request<{ templates: Template[] }>("/api/templates"),
  create: (data: Partial<Template> & { metaTemplateId?: string }) =>
    request<Template>("/api/templates", { method: "POST", body: JSON.stringify(data) }),
};

// Campaigns
export const campaigns = {
  list: (params?: { status?: string; limit?: number }) => {
    const q = new URLSearchParams();
    if (params?.status) q.set("status", params.status);
    if (params?.limit) q.set("limit", String(params.limit));
    return request<{ campaigns: Campaign[] }>(`/api/campaigns?${q}`);
  },
  create: (data: Partial<Campaign> & Record<string, unknown>) =>
    request<Campaign>("/api/campaigns", { method: "POST", body: JSON.stringify(data) }),
  update: (id: string, data: Partial<Campaign> & Record<string, unknown>) =>
    request(`/api/campaigns/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  remove: (id: string) =>
    request(`/api/campaigns/${id}`, { method: "DELETE" }),
  execute: (data: Record<string, unknown>) =>
    request<{ campaignId: string; status: string; recipients: number }>("/api/campaigns/execute", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  get: (id: string) =>
    request<{
      campaign: Record<string, unknown>;
      timeSeries: unknown[];
      failedMessages: unknown[];
      costBreakdown: Record<string, number>;
    }>(`/api/campaigns/${id}`),
};

// Automations
export const automations = {
  list: () => request<{ automations: Automation[] }>("/api/automations"),
  create: (data: Partial<Automation>) =>
    request<Automation>("/api/automations", { method: "POST", body: JSON.stringify(data) }),
  update: (id: string, data: { isActive?: boolean; name?: string }) =>
    request(`/api/automations/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  remove: (id: string) =>
    request(`/api/automations/${id}`, { method: "DELETE" }),
};

// Analytics
export const analytics = {
  get: (days = 7) => request<AnalyticsData>(`/api/analytics?days=${days}`),
  optimalTime: () => request<{
    hasData: boolean; bestHours: number[]; bestDays: string[];
    recommendation: string; byHour: { hour: number; sent: number; deliveryRate: number; readRate: number; score: number }[];
    totalAnalyzed?: number;
  }>("/api/analytics/optimal-time"),
};

// Smart Segments
export const segments = {
  list: () => request<{ system: SegmentRow[]; custom: SegmentRow[] }>("/api/segments"),
  create: (data: { name: string; description?: string; color?: string; icon?: string; rules: import("@/types").SegmentRules }) =>
    request<{ segment: SegmentRow }>("/api/segments", { method: "POST", body: JSON.stringify(data) }),
  update: (id: string, data: Partial<{ name: string; description: string; color: string; icon: string; rules: import("@/types").SegmentRules }>) =>
    request(`/api/segments/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  remove: (id: string) =>
    request(`/api/segments/${id}`, { method: "DELETE" }),
  preview: (rules: import("@/types").SegmentRules) =>
    request<{ count: number; sample: { id: string; name: string; phone: string }[] }>(
      "/api/segments/preview",
      { method: "POST", body: JSON.stringify({ rules }) },
    ),
  contacts: (id: string, limit = 50) =>
    request<{ contacts: import("@/types").Contact[] }>(`/api/segments/${id}/contacts?limit=${limit}`),
  rfm: () => request<{
    total: number; buckets: Record<string, number>; heatmap: number[][];
    contacts: { contact_id: string; recency_days: number | null; frequency: number; monetary: number; r_score: number; f_score: number; m_score: number; segment: string }[];
  }>("/api/segments/rfm"),
};

interface SegmentRow {
  id: string;
  name: string;
  description: string | null;
  color: string;
  icon: string;
  rules: import("@/types").SegmentRules;
  is_system: boolean;
  count: number;
}

// Ads (Click-to-WhatsApp)
export const ads = {
  startConnect: () => request<{ url: string }>("/api/ads/connect"),
  connectWithToken: (accessToken: string) =>
    request<{ connected: number }>("/api/ads/connect", { method: "POST", body: JSON.stringify({ accessToken }) }),
  listAccounts: () => request<{ accounts: import("@/types").AdAccount[] }>("/api/ads/accounts"),
  disconnect: (id: string) =>
    request(`/api/ads/accounts?id=${encodeURIComponent(id)}`, { method: "DELETE" }),
  syncCampaigns: (adAccountId?: string, days = 30) =>
    request<{ synced: number; errors: string[] }>("/api/ads/campaigns", {
      method: "POST",
      body: JSON.stringify({ adAccountId, days }),
    }),
  roi: () => request<{ summary: import("@/types").ROISummary; campaigns: import("@/types").ROICampaign[] }>("/api/ads/roi"),
  trackLead: (data: { phone: string; name?: string; ctwa_clid?: string; fb_campaign_id?: string; fb_ad_id?: string; source_url?: string; body?: string; raw?: unknown }) =>
    request("/api/ads/track-lead", { method: "POST", body: JSON.stringify(data) }),
};

// Dashboard
export const dashboard = {
  get: () => request<DashboardData>("/api/dashboard"),
};

// Wallet & Transactions
export const wallet = {
  get: () => request<{ balance: number; currency: string }>("/api/wallet"),
  recharge: (amount: number, paymentMethod?: string, metadata?: Record<string, unknown>) =>
    request<{ balance: number; added: number }>("/api/wallet", {
      method: "POST",
      body: JSON.stringify({ amount, paymentMethod, metadata }),
    }),
};

export const transactions = {
  list: (params?: { page?: number; limit?: number }) => {
    const q = new URLSearchParams();
    if (params?.page) q.set("page", String(params.page));
    if (params?.limit) q.set("limit", String(params.limit));
    return request<{ transactions: Transaction[]; total: number }>(`/api/transactions?${q}`);
  },
};

// Team
export const team = {
  list: () => request<{ members: TeamMember[] }>("/api/team-members"),
  invite: (data: { name?: string; email: string; role: string }) =>
    request<TeamMember>("/api/team-members", { method: "POST", body: JSON.stringify(data) }),
  update: (id: string, data: { role?: string; status?: string }) =>
    request(`/api/team-members/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  remove: (id: string) =>
    request(`/api/team-members/${id}`, { method: "DELETE" }),
};

// Settings
export const settings = {
  getProfile: () => request("/api/settings/profile"),
  updateProfile: (data: { name?: string; company?: string; phone?: string; timezone?: string }) =>
    request("/api/settings/profile", { method: "PATCH", body: JSON.stringify(data) }),
  updatePassword: (newPassword: string) =>
    request("/api/settings/password", { method: "POST", body: JSON.stringify({ newPassword }) }),
};

// Billing / Subscriptions
export const billing = {
  getSubscription: () => request<{ subscription: import("@/types").Subscription }>("/api/billing/create-subscription"),
  createSubscription: (planId: string) =>
    request<{ subscriptionId: string; paymentUrl: string | null; planName: string; amount: number; cycle: string }>(
      "/api/billing/create-subscription", { method: "POST", body: JSON.stringify({ planId }) }
    ),
  cancelSubscription: () =>
    request("/api/billing/create-subscription", { method: "DELETE" }),
  getUsage: () => request<import("@/types").BillingUsage>("/api/billing/usage"),
};

// Admin (platform-owner only; gated by ADMIN_EMAILS allowlist server-side)
export type Tier = "starter" | "growth" | "enterprise";

export interface AdminUser {
  id: string;
  email: string;
  full_name: string | null;
  tier: Tier;
  billing_mode: "byo" | "managed";
  waba_mode: "own" | "shared";
  balance_paise: number;
}

export interface AdminMargin {
  messageChargedPaise: number;
  messageCostPaise: number;
  messageMarginPaise: number;
  messageCount: number;
  trackedCount: number;
  platformPaidPaise: number;
  totalRevenuePaise: number;
}

/** Platform-wide aggregates behind the super-admin dashboard. Money in paise. */
export interface AdminOverview {
  generatedAt: string;
  days: number;
  tenants: {
    total: number;
    active: number;
    newInPeriod: number;
    byTier: Record<string, number>;
  };
  people: { tenantOwners: number; seats: number; total: number };
  numbers: { total: number; active: number };
  messages: {
    allTime: number;
    period: number;
    byStatus: Record<string, number>;
    series: {
      date: string;
      marketing: number;
      utility: number;
      authentication: number;
      service: number;
      billed: number;
      total: number;
    }[];
  };
  revenue: {
    mrrPaise: number;
    activeSubscriptions: number;
    payingSubscriptions: number;
    unpricedSubscriptions: number;
    platformFeesPaise: number;
    topupPaise: number;
    messageMarginPaise: number;
    messageChargedPaise: number;
    messageWholesalePaise: number;
    marginTrackedCount: number;
    walletFloatPaise: number;
  };
  /** Period-over-period % change. null = not computable → render no chip. */
  deltas: {
    tenants: number | null;
    activeTenants: number | null;
    people: number | null;
    numbers: number | null;
    mrr: number | null;
    messages: number | null;
  };
  ai: { requests: number; costPaise: number; creditsDeducted: number; nonOk: number };
  campaigns: { active: number };
  topTenants: {
    id: string;
    name: string;
    email: string;
    industry: string;
    tier: string;
    billingMode: string;
    sent: number;
    deliveredPct: number;
    readPct: number;
    failed: number;
  }[];
  health: {
    key: string;
    label: string;
    status: "ok" | "warn" | "down" | "unknown";
    detail: string;
  }[];
  warnings: string[];
}

export type TicketStatus = "open" | "in_progress" | "waiting" | "resolved" | "closed";
export type TicketPriority = "low" | "medium" | "high" | "urgent";
export type TicketCategory =
  | "onboarding" | "number" | "template" | "billing" | "webhook" | "api" | "other";

export interface SupportTicket {
  id: string;
  subject: string;
  body?: string;
  category: TicketCategory;
  priority: TicketPriority;
  status: TicketStatus;
  createdAt: string;
  userId: string;
  tenant: string;
  tenantEmail: string;
}

/** Operational (non-financial) state for the support & ops console. */
export interface AdminOps {
  generatedAt: string;
  hours: number;
  kpis: {
    activeTenants: number;
    connectedNumbers: number;
    activeNumbers: number;
    apiMessages: number;
    apiFailed: number;
    failedMessages: number;
    totalMessages: number;
    openTickets: number;
    urgentOpen: number;
  };
  deltas: {
    activeTenants: number | null;
    apiMessages: number | null;
    failedMessages: number | null;
    messages: number | null;
  };
  series: { label: string; messages: number; apiMessages: number }[];
  tickets: SupportTicket[];
  ticketsByStatus: Record<string, number>;
  events: {
    id: string;
    source: string;
    route: string | null;
    status: string;
    error: string | null;
    receivedAt: string;
  }[];
  health: AdminOverview["health"];
  warnings: string[];
}

export const admin = {
  // Confirms the current session is a platform admin (403 → not admin).
  check: () => request<{ admin: true }>("/api/admin/billing-mode"),

  // Whole-platform aggregates for the super-admin dashboard.
  overview: (days = 7) =>
    request<{ overview: AdminOverview }>(`/api/admin/overview?days=${days}`),

  // Operational state for the support & ops console (no financial data).
  ops: (hours = 24) => request<{ ops: AdminOps }>(`/api/admin/ops?hours=${hours}`),

  // ── Support tickets ──
  tickets: (status: "open" | "all" | TicketStatus = "open") =>
    request<{ tickets: SupportTicket[] }>(`/api/admin/tickets?status=${status}`),

  ticketCreate: (body: {
    email?: string;
    userId?: string;
    subject: string;
    body?: string;
    category?: TicketCategory;
    priority?: TicketPriority;
  }) =>
    request<{ ticket: SupportTicket }>("/api/admin/tickets", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  ticketUpdate: (body: { id: string; status?: TicketStatus; priority?: TicketPriority }) =>
    request<{ ticket: SupportTicket }>("/api/admin/tickets", {
      method: "PATCH",
      body: JSON.stringify(body),
    }),

  lookup: (email: string) =>
    request<{ user: AdminUser }>(`/api/admin/billing-mode?email=${encodeURIComponent(email)}`),

  // Tier is the source of truth; the server derives billing_mode + waba_mode.
  setTier: (email: string, tier: Tier) =>
    request<{ user: AdminUser }>("/api/admin/billing-mode", {
      method: "POST",
      body: JSON.stringify({ email, tier }),
    }),

  // Per-client revenue & margin (message margin + platform fees).
  margin: (userId: string) =>
    request<{ margin: AdminMargin }>(`/api/admin/margin?userId=${encodeURIComponent(userId)}`),

  // Rate/markup config editor.
  ratesGet: () => request<RateConfig>("/api/admin/rates"),
  ratesSave: (body: RateConfigUpdate) =>
    request<RateConfig>("/api/admin/rates", { method: "POST", body: JSON.stringify(body) }),

  // ── Industry verticals ──
  // The catalogue for the picker (never hardcoded in the UI).
  verticals: () => request<{ verticals: AdminVertical[] }>("/api/admin/verticals"),

  // Everything a client would receive — powers the preview panel.
  verticalPreview: (verticalId: string) =>
    request<VerticalPreview>(`/api/admin/verticals/${encodeURIComponent(verticalId)}`),

  // Create a new industry from the guided seed-kit form.
  verticalCreate: (body: VerticalSeedKit) =>
    request<{ vertical: { id: string; slug: string; displayName: string }; itemsCreated: number }>(
      "/api/admin/verticals",
      { method: "POST", body: JSON.stringify(body) },
    ),

  // Catalogue state: activate/deactivate, rename, re-icon, reorder.
  verticalUpdate: (
    verticalId: string,
    patch: { isActive?: boolean; displayName?: string; description?: string; icon?: string | null; sortOrder?: number },
  ) =>
    request<{ vertical: AdminVertical }>(
      `/api/admin/verticals/${encodeURIComponent(verticalId)}`,
      { method: "PATCH", body: JSON.stringify(patch) },
    ),

  // The audit trail (read-only).
  audit: (params: {
    action?: string; outcome?: string; actor?: string; resourceType?: string;
    q?: string; days?: number; page?: number; limit?: number;
  } = {}) => {
    const qs = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== "" && v !== 0) qs.set(k, String(v));
    });
    return request<AuditPage>(`/api/admin/audit?${qs}`);
  },

  // Re-seed the shipped industries (idempotent).
  verticalsSeed: () =>
    request<{ ok: boolean; verticalsUpserted: number; itemsUpserted: number; errors: string[] }>(
      "/api/admin/verticals/seed",
      { method: "POST" },
    ),

  // The tenant directory — search/filter, with industry + tier per row.
  clients: (params: { q?: string; vertical?: string; tier?: string; page?: number; limit?: number } = {}) => {
    const qs = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== "" && v !== 0) qs.set(k, String(v));
    });
    return request<AdminClientPage>(`/api/admin/clients?${qs}`);
  },

  // Assign an industry to many tenants at once. Reports partial success.
  clientsBulkVertical: (userIds: string[], verticalId: string | null) =>
    request<{ assigned: number; failed: { id: string; error: string }[] }>("/api/admin/clients", {
      method: "POST",
      body: JSON.stringify({ userIds, verticalId }),
    }),

  // A client's current industry.
  clientVertical: (userId: string) =>
    request<{ client: AdminVerticalClient; vertical: AdminVertical | null }>(
      `/api/admin/clients/${encodeURIComponent(userId)}/vertical`,
    ),

  // Provision, change or clear it. Pass null to clear.
  clientVerticalSet: (userId: string, verticalId: string | null) =>
    request<{ client: AdminVerticalClient; vertical: AdminVertical | null }>(
      `/api/admin/clients/${encodeURIComponent(userId)}/vertical`,
      { method: "POST", body: JSON.stringify({ verticalId }) },
    ),
};

export interface AuditEntry {
  id: string;
  at: string;
  action: string;
  outcome: "success" | "failure";
  resourceType: string | null;
  resourceId: string | null;
  ip: string | null;
  userAgent: string | null;
  details: Record<string, unknown>;
  actorId: string | null;
  /** Resolved name/email, or "Deleted user" / "System" — never blank. */
  actor: string;
  actorEmail: string | null;
}

export interface AuditPage {
  entries: AuditEntry[];
  total: number;
  page: number;
  pages: number;
  /** Facets for the filter bar, from a recent slice of the table. */
  actions: string[];
  actors: { id: string; email: string }[];
  warning?: string;
}

/** One row in the tenant directory. */
export interface AdminClient {
  id: string;
  email: string;
  name: string;
  tier: string;
  billingMode: string;
  wabaMode: string;
  /** null = no industry track. A real state, not "unconfigured". */
  vertical: { id: string; slug: string; displayName: string; icon: string | null; isActive: boolean } | null;
  numbers: number;
  balancePaise: number;
  createdAt: string | null;
}

export interface AdminClientPage {
  clients: AdminClient[];
  total: number;
  page: number;
  pages: number;
  /** The industry catalogue, for the filter and the assign control. */
  verticals: { id: string; slug: string; displayName: string; icon: string | null; isActive: boolean }[];
}

export interface AdminVertical {
  id: string;
  slug: string;
  displayName: string;
  description: string;
  icon: string | null;
  isActive: boolean;
  sortOrder: number;
  isBuiltin: boolean;
  /** Consent rule for this industry — drives the send-time gate. */
  requiresExplicitConsent?: boolean;
  counts?: { flows: number; campaignPrompts: number; messageTemplates: number };
}

export interface AdminVerticalClient {
  id: string;
  email: string;
  full_name: string | null;
  tier: string | null;
}

export type MetaCategory = "UTILITY" | "MARKETING" | "AUTHENTICATION";

export interface VerticalPreview {
  vertical: AdminVertical;
  flows: {
    id: string;
    title: string;
    description: string;
    outcome: string;
    adminNote: string | null;
    /** The message the customer actually receives — shown as a chat bubble. */
    firstMessage: string | null;
    /** How many messages the flow sends when it runs in full. */
    steps: number;
    collectsBooking: boolean;
  }[];
  campaignPrompts: {
    id: string;
    title: string;
    description: string;
    outcome: string;
    adminNote: string | null;
    prompt: string;
  }[];
  messageTemplates: {
    id: string;
    title: string;
    description: string;
    outcome: string;
    adminNote: string | null;
    metaCategory: MetaCategory;
    body: string;
    footer: string | null;
  }[];
}

export interface VerticalSeedKit {
  displayName: string;
  description: string;
  icon?: string;
  bookingFlow: { title: string; description: string; outcome: string; keywords: string; askMessage: string };
  statusFlow: { title: string; description: string; outcome: string; keywords: string; notifyMessage: string };
  campaignPrompt: { title: string; description: string; outcome: string; prompt: string };
  templates: {
    title: string;
    description: string;
    outcome: string;
    body: string;
    footer?: string;
    variableNames: string[];
    metaCategory: MetaCategory;
  }[];
}

export type RateCategory = "MARKETING" | "UTILITY" | "AUTHENTICATION" | "SERVICE";

export interface PlanTier {
  tier: Tier;
  model: string;
  billing_mode: string;
  waba_mode: string;
  default_markup_bps: number;
  monthly_fee_paise: number;
  onboarding_fee_paise: number;
  monthly_msg_cap: number | null;
}

export interface PlatformSettings {
  buffer_bps: number;
  min_topup_paise: number;
  default_low_balance_threshold_paise: number;
  credit_validity_months: number;
}

export interface RateConfig {
  rates: Record<RateCategory, number> | null;
  tiers: PlanTier[] | null;
  settings: PlatformSettings | null;
}

export interface RateConfigUpdate {
  rates?: Partial<Record<RateCategory, number>>;
  tiers?: Array<Partial<PlanTier> & { tier: Tier }>;
  settings?: Partial<PlatformSettings>;
}

// Type re-exports (mirrors types/index.ts for convenience)
import type { Contact, Template, Campaign, Automation, WhatsAppNumber, Transaction, TeamMember, AnalyticsData } from "@/types";

interface DashboardData {
  profile: { name: string; company: string };
  stats: {
    messagesSent: number;
    messagesSentTrend: number;
    deliveryRate: number;
    deliveryRateTrend: number;
    failedMessages: number;
    failedMessagesTrend: number;
    walletBalance: number;
  };
  chartData: { date: string; sent: number; delivered: number; failed: number }[];
  recentCampaigns: {
    id: string;
    name: string;
    status: string;
    templateName: string;
    recipients: number;
    delivered: number;
    failed: number;
    createdAt: string;
  }[];
  numbers: { id: string; phoneNumber: string; displayName: string; status: string; messagesSent: number }[];
}
