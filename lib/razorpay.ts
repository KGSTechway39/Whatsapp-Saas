import Razorpay from "razorpay";
import crypto from "crypto";

let _client: Razorpay | null = null;

export function getRazorpay(): Razorpay {
  if (!_client) {
    if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) {
      throw new Error("RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET must be set");
    }
    _client = new Razorpay({
      key_id: process.env.RAZORPAY_KEY_ID,
      key_secret: process.env.RAZORPAY_KEY_SECRET,
    });
  }
  return _client;
}

export type PlanId =
  | "free"
  | "starter_monthly" | "starter_yearly"
  | "growth_monthly"  | "growth_yearly"
  | "pro_monthly"     | "pro_yearly";

export interface Plan {
  id: PlanId;
  name: string;
  tier: "free" | "starter" | "growth" | "pro";
  cycle: "monthly" | "yearly";
  priceINR: number;
  razorpayPlanId: string | null;
  limits: {
    numbers: number;
    messagesPerMonth: number;
    templates: number;         // -1 = unlimited
    campaignsPerMonth: number; // -1 = unlimited
    teamMembers: number;
    apiAccess: boolean;
    whiteLabel: boolean;
  };
}

export const PLANS: Record<PlanId, Plan> = {
  free: {
    id: "free", name: "Free", tier: "free", cycle: "monthly", priceINR: 0,
    razorpayPlanId: null,
    limits: { numbers: 1, messagesPerMonth: 100, templates: 3, campaignsPerMonth: 0, teamMembers: 1, apiAccess: false, whiteLabel: false },
  },
  starter_monthly: {
    id: "starter_monthly", name: "Starter", tier: "starter", cycle: "monthly", priceINR: 999,
    razorpayPlanId: process.env.RAZORPAY_PLAN_STARTER_MONTHLY || null,
    limits: { numbers: 1, messagesPerMonth: 5000, templates: 20, campaignsPerMonth: 10, teamMembers: 2, apiAccess: false, whiteLabel: false },
  },
  starter_yearly: {
    id: "starter_yearly", name: "Starter", tier: "starter", cycle: "yearly", priceINR: 9590,
    razorpayPlanId: process.env.RAZORPAY_PLAN_STARTER_YEARLY || null,
    limits: { numbers: 1, messagesPerMonth: 5000, templates: 20, campaignsPerMonth: 10, teamMembers: 2, apiAccess: false, whiteLabel: false },
  },
  growth_monthly: {
    id: "growth_monthly", name: "Growth", tier: "growth", cycle: "monthly", priceINR: 2999,
    razorpayPlanId: process.env.RAZORPAY_PLAN_GROWTH_MONTHLY || null,
    limits: { numbers: 2, messagesPerMonth: 25000, templates: 50, campaignsPerMonth: 30, teamMembers: 5, apiAccess: false, whiteLabel: false },
  },
  growth_yearly: {
    id: "growth_yearly", name: "Growth", tier: "growth", cycle: "yearly", priceINR: 28790,
    razorpayPlanId: process.env.RAZORPAY_PLAN_GROWTH_YEARLY || null,
    limits: { numbers: 2, messagesPerMonth: 25000, templates: 50, campaignsPerMonth: 30, teamMembers: 5, apiAccess: false, whiteLabel: false },
  },
  pro_monthly: {
    id: "pro_monthly", name: "Pro", tier: "pro", cycle: "monthly", priceINR: 9999,
    razorpayPlanId: process.env.RAZORPAY_PLAN_PRO_MONTHLY || null,
    limits: { numbers: 5, messagesPerMonth: 100000, templates: -1, campaignsPerMonth: -1, teamMembers: 10, apiAccess: true, whiteLabel: true },
  },
  pro_yearly: {
    id: "pro_yearly", name: "Pro", tier: "pro", cycle: "yearly", priceINR: 95990,
    razorpayPlanId: process.env.RAZORPAY_PLAN_PRO_YEARLY || null,
    limits: { numbers: 5, messagesPerMonth: 100000, templates: -1, campaignsPerMonth: -1, teamMembers: 10, apiAccess: true, whiteLabel: true },
  },
};

export function verifyWebhookSignature(rawBody: string, signature: string): boolean {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET!;
  const expected = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  try {
    return crypto.timingSafeEqual(Buffer.from(signature, "hex"), Buffer.from(expected, "hex"));
  } catch {
    return false;
  }
}
