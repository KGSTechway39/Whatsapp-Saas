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
    return request<{ contacts: Contact[]; total: number }>(`/api/contacts?${q}`);
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
