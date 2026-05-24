import { z } from "zod";

// ─── Primitives ────────────────────────────────────────────────────────────────

export const phoneSchema = z
  .string()
  .min(7)
  .max(20)
  .regex(/^\+?[\d\s\-().]+$/, "Invalid phone number format");

export const emailSchema = z
  .string()
  .email("Invalid email address")
  .max(254)
  .transform((e) => e.toLowerCase().trim());

export const passwordSchema = z
  .string()
  .min(8, "Password must be at least 8 characters")
  .max(128, "Password too long");

export const uuidSchema = z.string().uuid("Invalid ID format");

export const paginationSchema = z.object({
  page:  z.coerce.number().int().min(1).max(10000).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

// ─── Auth ──────────────────────────────────────────────────────────────────────

export const loginSchema = z.object({
  email:    emailSchema,
  password: z.string().min(1).max(128),
});

export const registerSchema = z.object({
  email:       emailSchema,
  password:    passwordSchema,
  fullName:    z.string().min(2).max(100).trim(),
  companyName: z.string().min(1).max(100).trim(),
});

export const passwordChangeSchema = z.object({
  currentPassword: z.string().min(1, "Current password required"),
  newPassword:     passwordSchema,
});

export const forgotPasswordSchema = z.object({
  email: emailSchema,
});

// ─── Contacts ─────────────────────────────────────────────────────────────────

export const contactSchema = z.object({
  name:  z.string().min(1).max(100).trim(),
  phone: phoneSchema,
  email: z.string().email().max(254).optional().or(z.literal("")),
  group: z.string().max(50).optional(),
  tags:  z.array(z.string().max(30)).max(20).optional(),
  crm_stage:  z.string().max(50).optional(),
  crm_notes:  z.string().max(2000).optional(),
  deal_value: z.coerce.number().min(0).max(1e9).optional(),
  company:    z.string().max(100).optional(),
});

export const contactSearchSchema = paginationSchema.extend({
  search: z.string().max(100).optional(),
  group:  z.string().max(50).optional(),
  stage:  z.string().max(50).optional(),
});

// ─── Templates ────────────────────────────────────────────────────────────────

export const templateSchema = z.object({
  name:        z.string().min(1).max(100).regex(/^[a-z0-9_]+$/, "Name must be lowercase alphanumeric with underscores"),
  displayName: z.string().min(1).max(100).trim(),
  category:    z.enum(["MARKETING", "UTILITY", "AUTHENTICATION"]),
  language:    z.string().length(2).default("en"),
  body:        z.string().min(1).max(4096),
  variables:   z.array(z.string().max(50)).max(20).default([]),
  header:      z.string().max(2048).optional(),
  footer:      z.string().max(200).optional(),
  buttons:     z.array(z.object({
    type: z.enum(["QUICK_REPLY", "URL", "PHONE_NUMBER"]),
    text: z.string().max(25),
    url:  z.string().url().optional(),
    phone_number: phoneSchema.optional(),
  })).max(3).optional(),
});

// ─── Campaigns ────────────────────────────────────────────────────────────────

export const campaignSchema = z.object({
  name:        z.string().min(1).max(100).trim(),
  templateId:  uuidSchema,
  numberId:    uuidSchema,
  audienceType: z.enum(["all", "tags", "csv"]),
  selectedTags: z.array(z.string().max(30)).max(20).optional(),
  csvContacts: z.array(z.object({
    name:  z.string().max(100),
    phone: phoneSchema,
  })).max(10000).optional(),
  excludeOptedOut: z.boolean().default(true),
  scheduleDate: z.string().optional(),
  scheduleTime: z.string().optional(),
});

// ─── Wallet ───────────────────────────────────────────────────────────────────

export const walletRechargeSchema = z.object({
  amount: z.number().int().min(100, "Minimum recharge ₹100").max(100000, "Maximum recharge ₹1,00,000"),
});

// ─── Settings ─────────────────────────────────────────────────────────────────

const IANA_TIMEZONES = new Set(Intl.supportedValuesOf("timeZone"));

export const profileSchema = z.object({
  name:      z.string().min(1).max(100).trim().optional(),
  company:   z.string().max(100).trim().optional(),
  phone:     phoneSchema.optional().or(z.literal("")),
  timezone:  z.string().max(50).refine(
    (tz) => !tz || IANA_TIMEZONES.has(tz),
    { message: "Invalid timezone" }
  ).optional(),
  language:  z.enum(["en", "hi", "ta", "te", "bn", "mr", "gu"]).optional(),
});

// ─── Sanitization helpers ──────────────────────────────────────────────────────

/** Strip characters that could break ilike queries */
export function sanitizeSearch(input: string): string {
  return input.replace(/[%_\\]/g, (c) => `\\${c}`).slice(0, 100);
}

/** Strip HTML tags to prevent XSS if value ends up in HTML */
export function stripHtml(input: string): string {
  return input.replace(/<[^>]*>/g, "").trim();
}
