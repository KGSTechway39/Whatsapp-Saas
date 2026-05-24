// Demo data for local development — returned when no Supabase auth is present

export const DEMO_USER = {
  id: "demo-user-001",
  email: "demo@wasend.app",
  name: "Vikram Malhotra",
  company: "WASend Business",
  phone: "+91 98765 43210",
  timezone: "Asia/Kolkata",
  avatarUrl: null,
};

export const DEMO_NUMBERS = [
  {
    id: "num-001",
    phoneNumber: "+91 98765 43210",
    displayName: "WASend Main",
    status: "active",
    dailyLimit: 1000,
    messagesSent: 8342,
    connectedDate: "2024-01-15",
    metaAccountId: "1234567890",
    phoneNumberId: "9876543210",
    isPrimary: true,
  },
  {
    id: "num-002",
    phoneNumber: "+91 87654 32109",
    displayName: "WASend Support",
    status: "active",
    dailyLimit: 500,
    messagesSent: 3120,
    connectedDate: "2024-03-10",
    metaAccountId: "1234567891",
    phoneNumberId: "9876543211",
    isPrimary: false,
  },
  {
    id: "num-003",
    phoneNumber: "+91 76543 21098",
    displayName: "WASend Sales",
    status: "disconnected",
    dailyLimit: 500,
    messagesSent: 910,
    connectedDate: "2024-05-01",
    metaAccountId: null,
    phoneNumberId: null,
    isPrimary: false,
  },
];

export const DEMO_CONTACTS = [
  { id: "c-001", name: "Priya Sharma", phone: "+91 90001 11111", email: "priya@example.com", group: "VIP Clients", tags: ["vip", "premium"], addedDate: "2024-01-10", status: "active" },
  { id: "c-002", name: "Rahul Verma", phone: "+91 90002 22222", email: "rahul@example.com", group: "Leads", tags: ["lead", "new"], addedDate: "2024-02-14", status: "active" },
  { id: "c-003", name: "Anita Singh", phone: "+91 90003 33333", email: "anita@example.com", group: "Customers", tags: ["customer"], addedDate: "2024-02-20", status: "active" },
  { id: "c-004", name: "Vikash Kumar", phone: "+91 90004 44444", email: "vikash@example.com", group: "Leads", tags: ["lead"], addedDate: "2024-03-05", status: "active" },
  { id: "c-005", name: "Sunita Patel", phone: "+91 90005 55555", email: "sunita@example.com", group: "VIP Clients", tags: ["vip"], addedDate: "2024-03-12", status: "active" },
  { id: "c-006", name: "Arjun Nair", phone: "+91 90006 66666", email: "arjun@example.com", group: "Customers", tags: ["customer", "repeat"], addedDate: "2024-03-18", status: "active" },
  { id: "c-007", name: "Deepa Menon", phone: "+91 90007 77777", email: "deepa@example.com", group: "Leads", tags: ["lead", "warm"], addedDate: "2024-04-01", status: "active" },
  { id: "c-008", name: "Karan Mehta", phone: "+91 90008 88888", email: "karan@example.com", group: "Customers", tags: ["customer"], addedDate: "2024-04-08", status: "inactive" },
  { id: "c-009", name: "Pooja Rao", phone: "+91 90009 99999", email: "pooja@example.com", group: "VIP Clients", tags: ["vip", "enterprise"], addedDate: "2024-04-15", status: "active" },
  { id: "c-010", name: "Sanjay Gupta", phone: "+91 90010 10101", email: "sanjay@example.com", group: "Customers", tags: ["customer"], addedDate: "2024-04-22", status: "active" },
  { id: "c-011", name: "Meera Joshi", phone: "+91 90011 11011", email: "meera@example.com", group: "Leads", tags: ["lead", "cold"], addedDate: "2024-05-01", status: "active" },
  { id: "c-012", name: "Ravi Iyer", phone: "+91 90012 12012", email: "ravi@example.com", group: "Customers", tags: ["customer", "referral"], addedDate: "2024-05-10", status: "active" },
];

export const DEMO_TEMPLATES = [
  { id: "t-001", name: "welcome_new_customer", displayName: "Welcome New Customer", category: "MARKETING", language: "en_IN", status: "APPROVED", body: "Hi {{1}}! 👋 Welcome to *{{2}}*. We're excited to have you on board! Feel free to reach out anytime.", variables: ["name", "company"], createdAt: "2024-01-10T10:00:00Z" },
  { id: "t-002", name: "order_confirmation", displayName: "Order Confirmation", category: "UTILITY", language: "en_IN", status: "APPROVED", body: "Hi {{1}}, your order *#{{2}}* has been confirmed! 🎉\n\nEstimated delivery: {{3}}\n\nTrack your order or contact us anytime.", variables: ["name", "order_id", "delivery_date"], createdAt: "2024-01-15T10:00:00Z" },
  { id: "t-003", name: "otp_verification", displayName: "OTP Verification", category: "AUTHENTICATION", language: "en_IN", status: "APPROVED", body: "Your WASend verification code is: *{{1}}*\n\nThis code expires in 10 minutes. Do not share it with anyone.", variables: ["otp"], createdAt: "2024-02-01T10:00:00Z" },
  { id: "t-004", name: "appointment_reminder", displayName: "Appointment Reminder", category: "UTILITY", language: "en_IN", status: "APPROVED", body: "Hi {{1}} 📅, reminder: your appointment is scheduled for *{{2}}* at *{{3}}*.\n\nReply YES to confirm or NO to reschedule.", variables: ["name", "date", "time"], createdAt: "2024-02-10T10:00:00Z" },
  { id: "t-005", name: "flash_sale", displayName: "Flash Sale Offer", category: "MARKETING", language: "en_IN", status: "APPROVED", body: "🔥 *Flash Sale Alert!*\n\nHi {{1}}, grab {{2}}% OFF on all products — today only!\n\nUse code: *{{3}}*\n\nShop now before it ends!", variables: ["name", "discount", "coupon"], createdAt: "2024-02-20T10:00:00Z" },
  { id: "t-006", name: "payment_receipt", displayName: "Payment Receipt", category: "UTILITY", language: "en_IN", status: "APPROVED", body: "Hi {{1}}, we've received your payment of *₹{{2}}* for order #{{3}}.\n\nThank you! 🙏", variables: ["name", "amount", "order_id"], createdAt: "2024-03-01T10:00:00Z" },
  { id: "t-007", name: "feedback_request", displayName: "Feedback Request", category: "MARKETING", language: "en_IN", status: "PENDING", body: "Hi {{1}}, how was your experience with us? 🌟\n\nWe'd love to hear your feedback. It only takes 2 minutes!", variables: ["name"], createdAt: "2024-03-10T10:00:00Z" },
  { id: "t-008", name: "shipping_update", displayName: "Shipping Update", category: "UTILITY", language: "en_IN", status: "APPROVED", body: "📦 Your order *#{{1}}* is on its way!\n\nExpected delivery: *{{2}}*\nTracking ID: {{3}}", variables: ["order_id", "delivery_date", "tracking_id"], createdAt: "2024-03-15T10:00:00Z" },
];

export const DEMO_CAMPAIGNS = [
  { id: "camp-001", name: "Diwali Sale 2024", status: "completed", templateId: "t-005", templateName: "Flash Sale Offer", numberId: "num-001", recipients: 3420, sent: 3420, delivered: 3251, failed: 169, read: 2180, scheduledAt: "2024-10-28T09:00:00Z", createdAt: "2024-10-25T10:00:00Z", completedAt: "2024-10-28T10:30:00Z", cost: 342.0 },
  { id: "camp-002", name: "New Year Welcome", status: "completed", templateId: "t-001", templateName: "Welcome New Customer", numberId: "num-001", recipients: 1850, sent: 1850, delivered: 1795, failed: 55, read: 1340, scheduledAt: "2025-01-01T09:00:00Z", createdAt: "2024-12-30T10:00:00Z", completedAt: "2025-01-01T10:15:00Z", cost: 185.0 },
  { id: "camp-003", name: "Product Launch - Feb", status: "running", templateId: "t-005", templateName: "Flash Sale Offer", numberId: "num-001", recipients: 2100, sent: 1450, delivered: 1398, failed: 52, read: 870, scheduledAt: null, createdAt: "2025-02-14T10:00:00Z", completedAt: null, cost: 145.0 },
  { id: "camp-004", name: "March Re-engagement", status: "scheduled", templateId: "t-007", templateName: "Feedback Request", numberId: "num-002", recipients: 980, sent: 0, delivered: 0, failed: 0, read: 0, scheduledAt: "2025-03-20T10:00:00Z", createdAt: "2025-03-15T10:00:00Z", completedAt: null, cost: 0 },
  { id: "camp-005", name: "Summer Collection", status: "draft", templateId: "t-005", templateName: "Flash Sale Offer", numberId: "num-001", recipients: 0, sent: 0, delivered: 0, failed: 0, read: 0, scheduledAt: null, createdAt: "2025-04-10T10:00:00Z", completedAt: null, cost: 0 },
];

export const DEMO_AUTOMATIONS = [
  { id: "auto-001", name: "Welcome New Contact", trigger: { type: "new_contact", value: null }, action: { type: "send_template", templateId: "t-001", groupName: null, tag: null, delayHours: null }, isActive: true, createdAt: "2024-01-20T10:00:00Z", lastTriggered: "2024-04-24T14:30:00Z" },
  { id: "auto-002", name: "Keyword Reply - PRICE", trigger: { type: "keyword", value: "PRICE" }, action: { type: "send_template", templateId: "t-005", groupName: null, tag: null, delayHours: null }, isActive: true, createdAt: "2024-02-10T10:00:00Z", lastTriggered: "2024-04-23T11:00:00Z" },
  { id: "auto-003", name: "Re-engage Inactive (7 days)", trigger: { type: "inactivity", value: "7" }, action: { type: "send_template", templateId: "t-007", groupName: null, tag: null, delayHours: null }, isActive: false, createdAt: "2024-02-20T10:00:00Z", lastTriggered: "2024-04-20T09:00:00Z" },
  { id: "auto-004", name: "Birthday Greeting", trigger: { type: "birthday", value: null }, action: { type: "send_template", templateId: "t-005", groupName: null, tag: null, delayHours: null }, isActive: true, createdAt: "2024-03-01T10:00:00Z", lastTriggered: "2024-04-22T08:00:00Z" },
  { id: "auto-005", name: "Tag VIP on High Value", trigger: { type: "payment", value: "5000" }, action: { type: "apply_tag", templateId: null, groupName: null, tag: "vip", delayHours: null }, isActive: true, createdAt: "2024-03-15T10:00:00Z", lastTriggered: "2024-04-21T16:00:00Z" },
];

export const DEMO_ANALYTICS = {
  totalSent: 12842,
  totalDelivered: 12291,
  totalFailed: 551,
  totalReplies: 3840,
  deliveryRate: 95.7,
  failedRate: 4.3,
  chartData: [
    { date: "Apr 18", sent: 1820, delivered: 1745, failed: 75 },
    { date: "Apr 19", sent: 1650, delivered: 1582, failed: 68 },
    { date: "Apr 20", sent: 2100, delivered: 2015, failed: 85 },
    { date: "Apr 21", sent: 1890, delivered: 1810, failed: 80 },
    { date: "Apr 22", sent: 2240, delivered: 2141, failed: 99 },
    { date: "Apr 23", sent: 1760, delivered: 1682, failed: 78 },
    { date: "Apr 24", sent: 1382, delivered: 1316, failed: 66 },
  ],
  campaignPerformance: [
    { campaignId: "camp-001", name: "Diwali Sale 2024", sent: 3420, delivered: 3251, failed: 169, read: 2180, cost: 342.0 },
    { campaignId: "camp-002", name: "New Year Welcome", sent: 1850, delivered: 1795, failed: 55, read: 1340, cost: 185.0 },
    { campaignId: "camp-003", name: "Product Launch - Feb", sent: 1450, delivered: 1398, failed: 52, read: 870, cost: 145.0 },
  ],
  numberBreakdown: [
    { numberId: "num-001", phoneNumber: "+91 98765 43210", sent: 9222, delivered: 8831, failed: 391 },
    { numberId: "num-002", phoneNumber: "+91 87654 32109", sent: 3620, delivered: 3460, failed: 160 },
  ],
};

export const DEMO_DASHBOARD = {
  profile: { name: "Vikram Malhotra", company: "WASend Business" },
  stats: {
    messagesSent: 12842,
    messagesSentTrend: 12.5,
    deliveryRate: 95.7,
    deliveryRateTrend: 1.2,
    failedMessages: 551,
    failedMessagesTrend: -8.3,
    walletBalance: 2450.0,
  },
  chartData: [
    { date: "Apr 18", sent: 1820, delivered: 1745, failed: 75 },
    { date: "Apr 19", sent: 1650, delivered: 1582, failed: 68 },
    { date: "Apr 20", sent: 2100, delivered: 2015, failed: 85 },
    { date: "Apr 21", sent: 1890, delivered: 1810, failed: 80 },
    { date: "Apr 22", sent: 2240, delivered: 2141, failed: 99 },
    { date: "Apr 23", sent: 1760, delivered: 1682, failed: 78 },
    { date: "Apr 24", sent: 1382, delivered: 1316, failed: 66 },
  ],
  recentCampaigns: [
    { id: "camp-001", name: "Diwali Sale 2024", status: "completed", templateName: "Flash Sale Offer", recipients: 3420, delivered: 3251, failed: 169, createdAt: "2024-10-25T10:00:00Z" },
    { id: "camp-002", name: "New Year Welcome", status: "completed", templateName: "Welcome New Customer", recipients: 1850, delivered: 1795, failed: 55, createdAt: "2024-12-30T10:00:00Z" },
    { id: "camp-003", name: "Product Launch - Feb", status: "running", templateName: "Flash Sale Offer", recipients: 2100, delivered: 1398, failed: 52, createdAt: "2025-02-14T10:00:00Z" },
  ],
  numbers: [
    { id: "num-001", phoneNumber: "+91 98765 43210", displayName: "WASend Main", status: "active", messagesSent: 8342 },
    { id: "num-002", phoneNumber: "+91 87654 32109", displayName: "WASend Support", status: "active", messagesSent: 3120 },
  ],
};

export const DEMO_WALLET = { balance: 2450.0, currency: "INR" };

export const DEMO_TRANSACTIONS = [
  { id: "tx-001", date: "2024-04-24T14:30:00Z", type: "debit", description: "Campaign: Diwali Sale 2024 (3420 messages)", amount: 342.0, balance: 2450.0 },
  { id: "tx-002", date: "2024-04-20T10:00:00Z", type: "credit", description: "Wallet recharge via UPI", amount: 1000.0, balance: 2792.0 },
  { id: "tx-003", date: "2024-04-15T09:00:00Z", type: "debit", description: "Campaign: New Year Welcome (1850 messages)", amount: 185.0, balance: 1792.0 },
  { id: "tx-004", date: "2024-04-10T11:00:00Z", type: "debit", description: "Campaign: Product Launch - Feb (1450 messages)", amount: 145.0, balance: 1977.0 },
  { id: "tx-005", date: "2024-04-05T16:00:00Z", type: "credit", description: "Wallet recharge via Net Banking", amount: 2000.0, balance: 2122.0 },
  { id: "tx-006", date: "2024-03-30T08:30:00Z", type: "debit", description: "Automation messages (840 messages)", amount: 84.0, balance: 122.0 },
  { id: "tx-007", date: "2024-03-25T12:00:00Z", type: "credit", description: "Wallet recharge via Credit Card", amount: 500.0, balance: 206.0 },
  { id: "tx-008", date: "2024-03-20T15:00:00Z", type: "debit", description: "Template submission fees", amount: 30.0, balance: -294.0 },
];

export const DEMO_TEAM_MEMBERS = [
  { id: "demo-user-001", name: "Vikram Malhotra", email: "vikram@wasend.app", role: "owner", status: "active", joinedDate: "2024-01-01T00:00:00Z", avatarUrl: null },
  { id: "team-001", name: "Priya Sharma", email: "priya@wasend.app", role: "admin", status: "active", joinedDate: "2024-02-01T00:00:00Z", avatarUrl: null },
  { id: "team-002", name: "Rahul Dev", email: "rahul@wasend.app", role: "member", status: "active", joinedDate: "2024-03-15T00:00:00Z", avatarUrl: null },
  { id: "team-003", name: "Sneha Kapoor", email: "sneha@wasend.app", role: "member", status: "invited", joinedDate: null, avatarUrl: null },
];
