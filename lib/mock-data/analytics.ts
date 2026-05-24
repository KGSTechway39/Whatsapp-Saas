import { AnalyticsData, ChartDataPoint } from "@/types";

export const mockChartData: ChartDataPoint[] = [
  { date: "Jan 14", sent: 145, delivered: 138, failed: 7 },
  { date: "Jan 15", sent: 232, delivered: 219, failed: 13 },
  { date: "Jan 16", sent: 189, delivered: 181, failed: 8 },
  { date: "Jan 17", sent: 78, delivered: 74, failed: 4 },
  { date: "Jan 18", sent: 312, delivered: 295, failed: 17 },
  { date: "Jan 19", sent: 267, delivered: 251, failed: 16 },
  { date: "Jan 20", sent: 189, delivered: 179, failed: 10 },
];

export const mockAnalyticsData: AnalyticsData = {
  totalSent: 1412,
  totalDelivered: 1337,
  totalFailed: 75,
  totalReplies: 234,
  deliveryRate: 94.7,
  failedRate: 5.3,
  chartData: mockChartData,
  campaignPerformance: [
    {
      campaignId: "camp1",
      name: "Diwali Campaign 2024",
      sent: 1250,
      delivered: 1189,
      failed: 61,
      read: 945,
      cost: 2500,
    },
    {
      campaignId: "camp2",
      name: "January Sale",
      sent: 445,
      delivered: 423,
      failed: 22,
      read: 312,
      cost: 890,
    },
    {
      campaignId: "camp4",
      name: "Welcome Series",
      sent: 450,
      delivered: 438,
      failed: 12,
      read: 389,
      cost: 450,
    },
    {
      campaignId: "camp5",
      name: "Payment Reminder Blast",
      sent: 45,
      delivered: 39,
      failed: 6,
      read: 28,
      cost: 90,
    },
  ],
  numberBreakdown: [
    {
      numberId: "n1",
      phoneNumber: "+91 98765 00001",
      sent: 1120,
      delivered: 1063,
      failed: 57,
    },
    {
      numberId: "n2",
      phoneNumber: "+91 98765 00002",
      sent: 292,
      delivered: 274,
      failed: 18,
    },
  ],
};

export const mockTransactions = [
  {
    id: "tx1",
    date: "2024-01-20",
    type: "debit" as const,
    description: "Campaign: January Sale (445 messages)",
    amount: -890,
    balance: 2500,
    invoiceUrl: "#",
  },
  {
    id: "tx2",
    date: "2024-01-15",
    type: "credit" as const,
    description: "Wallet Recharge via Razorpay",
    amount: 2000,
    balance: 3390,
    invoiceUrl: "#",
  },
  {
    id: "tx3",
    date: "2024-01-10",
    type: "debit" as const,
    description: "Campaign: Payment Reminder Blast (45 messages)",
    amount: -90,
    balance: 1390,
    invoiceUrl: "#",
  },
  {
    id: "tx4",
    date: "2024-01-05",
    type: "credit" as const,
    description: "Wallet Recharge via Razorpay",
    amount: 1000,
    balance: 1480,
    invoiceUrl: "#",
  },
  {
    id: "tx5",
    date: "2023-12-28",
    type: "debit" as const,
    description: "Campaign: Welcome Series (450 messages)",
    amount: -450,
    balance: 480,
    invoiceUrl: "#",
  },
];

export const mockTeamMembers = [
  {
    id: "tm1",
    name: "Vikram Malhotra",
    email: "admin@wasend.com",
    role: "owner" as const,
    status: "active" as const,
    joinedDate: "2023-10-01",
  },
  {
    id: "tm2",
    name: "Sneha Kapoor",
    email: "sneha@wasend.com",
    role: "admin" as const,
    status: "active" as const,
    joinedDate: "2023-11-15",
  },
  {
    id: "tm3",
    name: "Rohan Verma",
    email: "rohan@wasend.com",
    role: "agent" as const,
    status: "invited" as const,
    joinedDate: "2024-01-10",
  },
];

export const mockAutomations = [
  {
    id: "auto1",
    name: "Welcome Message",
    trigger: { type: "new_contact" as const },
    action: {
      type: "send_template" as const,
      templateId: "t3",
    },
    isActive: true,
    createdAt: "2023-11-20",
    lastTriggered: "2024-01-19",
  },
  {
    id: "auto2",
    name: "Appointment Reminder",
    trigger: { type: "date_based" as const, value: "1 day before" },
    action: {
      type: "send_template" as const,
      templateId: "t1",
    },
    isActive: true,
    createdAt: "2023-12-01",
    lastTriggered: "2024-01-18",
  },
  {
    id: "auto3",
    name: "Re-engagement Flow",
    trigger: { type: "inactivity" as const, value: "30 days" },
    action: {
      type: "send_template" as const,
      templateId: "t2",
    },
    isActive: false,
    createdAt: "2024-01-05",
  },
];
