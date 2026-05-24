export interface Contact {
  id: string;
  name: string;
  phone: string;
  email?: string;
  group?: string;
  tags: string[];
  addedDate: string;
  status: "active" | "inactive";
}

export interface Template {
  id: string;
  name: string;
  displayName: string;
  category: "MARKETING" | "UTILITY" | "AUTHENTICATION";
  language: string;
  status: "APPROVED" | "PENDING" | "REJECTED";
  body: string;
  variables: string[];
  createdAt: string;
}

export interface Campaign {
  id: string;
  name: string;
  status: "draft" | "scheduled" | "running" | "completed" | "failed";
  templateId: string;
  templateName: string;
  numberId: string;
  recipients: number;
  sent: number;
  delivered: number;
  failed: number;
  read: number;
  scheduledAt?: string;
  createdAt: string;
  completedAt?: string;
  cost: number;
}

export interface Automation {
  id: string;
  name: string;
  trigger: {
    type: "new_contact" | "keyword" | "date_based" | "inactivity";
    value?: string;
  };
  action: {
    type: "send_template" | "add_to_group" | "apply_tag" | "wait_then_send";
    templateId?: string;
    groupName?: string;
    tag?: string;
    delayHours?: number;
  };
  isActive: boolean;
  createdAt: string;
  lastTriggered?: string;
}

export interface WhatsAppNumber {
  id: string;
  phoneNumber: string;
  displayName: string;
  status: "active" | "inactive";
  dailyLimit: number;
  messagesSent: number;
  connectedDate: string;
  metaAccountId?: string;
  phoneNumberId?: string;
}

export interface Transaction {
  id: string;
  date: string;
  type: "credit" | "debit";
  description: string;
  amount: number;
  balance: number;
  invoiceUrl?: string;
}

export interface TeamMember {
  id: string;
  name: string;
  email: string;
  role: "owner" | "admin" | "agent";
  status: "active" | "invited" | "inactive";
  joinedDate: string;
  avatarUrl?: string;
}

export interface DashboardStats {
  messagesSent: number;
  messagesSentTrend: number;
  deliveryRate: number;
  deliveryRateTrend: number;
  failedMessages: number;
  failedMessagesTrend: number;
  walletBalance: number;
}

export interface ChartDataPoint {
  date: string;
  sent: number;
  delivered: number;
  failed: number;
}

export interface AnalyticsData {
  totalSent: number;
  totalDelivered: number;
  totalFailed: number;
  totalReplies: number;
  deliveryRate: number;
  failedRate: number;
  chartData: ChartDataPoint[];
  campaignPerformance: {
    campaignId: string;
    name: string;
    sent: number;
    delivered: number;
    failed: number;
    read: number;
    cost: number;
  }[];
  numberBreakdown: {
    numberId: string;
    phoneNumber: string;
    sent: number;
    delivered: number;
    failed: number;
  }[];
}

export interface Subscription {
  id?: string;
  planId: string;
  tier: "free" | "starter" | "pro";
  status: "active" | "pending" | "cancelled" | "past_due" | "trialing";
  billingCycle?: "monthly" | "yearly";
  currentPeriodEnd?: string;
  cancelAtPeriodEnd?: boolean;
  razorpaySubscriptionId?: string;
}

export interface BillingUsage {
  plan: Subscription & { name?: string; cycle?: string };
  usage: {
    messages: { used: number; limit: number; percent: number };
    numbers: { used: number; limit: number; percent: number };
    campaigns: { used: number; limit: number; percent: number };
  };
  limits: {
    numbers: number;
    messagesPerMonth: number;
    templates: number;
    campaignsPerMonth: number;
    teamMembers: number;
    apiAccess: boolean;
  };
  period: { start: string; end: string };
}

// ── Segments ────────────────────────────────────────────────────────────
export interface SegmentCondition {
  field: string;
  op: string;
  value?: string | number | null;
}

export interface SegmentRules {
  operator: "AND" | "OR";
  conditions: SegmentCondition[];
}

// ── CTWA Ads ────────────────────────────────────────────────────────────
export interface AdAccount {
  id: string;
  fb_account_id: string;
  account_name: string;
  business_id: string | null;
  currency: string;
  status: "active" | "expired" | "disconnected";
  last_synced_at: string | null;
  token_expires_at: string | null;
  connected_at: string;
}

export interface ROICampaign {
  id: string;
  name: string;
  status: string | null;
  account: string | null;
  currency: string;
  ctwa_clid: string;
  spend: number;
  impressions: number;
  clicks: number;
  ctr: number;
  cpm: number;
  cpc: number;
  leads: number;
  messages_sent: number;
  conversions: number;
  revenue: number;
  cac: number;
  conversion_rate: number;
  roas: number;
  profit: number;
}

export interface ROISummary {
  spend: number;
  impressions: number;
  clicks: number;
  leads: number;
  messages: number;
  conversions: number;
  revenue: number;
  cac: number;
  roas: number;
  profit: number;
  conversion_rate: number;
}

export type StatusType =
  | "active"
  | "inactive"
  | "approved"
  | "pending"
  | "rejected"
  | "running"
  | "completed"
  | "failed"
  | "scheduled"
  | "draft"
  | "invited";
