/**
 * Data Transfer Objects for the WhatsApp Embedded Signup module.
 *
 * Shape of objects flowing across layers:
 *   Controller (route)  ⇄  Service  ⇄  Repository  ⇄  DB
 *
 * All persisted secrets live in the Repository layer only — DTOs returned to
 * the controller MUST NOT include access_token, app_secret, or any other
 * credential.
 */

// ── INBOUND from Embedded Signup ──────────────────────────────────────────

/** Payload posted by the Embedded Signup popup callback. */
export interface ExchangeCodeRequest {
  /** Short-lived authorization code from FB.login() callback. */
  code: string;
  /** Optional hints from `session_info` v2 — narrows multi-WABA accounts. */
  wabaId?: string;
  phoneNumberId?: string;
}

// ── PERSISTED (Repository layer) ──────────────────────────────────────────

/** Full row from `whatsapp_accounts`. Internal use only. */
export interface WhatsAppAccountRow {
  id: string;
  organization_id: string;
  waba_id: string;
  business_id: string | null;
  phone_number_id: string;
  display_phone_number: string;
  business_name: string | null;
  quality_rating: "GREEN" | "YELLOW" | "RED" | "UNKNOWN";
  messaging_tier: string;
  /** Always encrypted at rest via lib/crypto.ts (token_encrypted=true). */
  access_token: string | null;
  token_encrypted: boolean;
  token_expires_at: string | null;
  status: "pending" | "active" | "suspended" | "disconnected";
  webhook_verified: boolean;
  created_at: string;
  updated_at: string;
}

// ── OUTBOUND to controller / frontend ─────────────────────────────────────

/** Public-safe view of a connected account (no token). */
export interface WhatsAppAccountDTO {
  id: string;
  wabaId: string;
  businessId: string | null;
  businessName: string | null;
  phoneNumberId: string;
  displayPhoneNumber: string;
  qualityRating: WhatsAppAccountRow["quality_rating"];
  status: WhatsAppAccountRow["status"];
  webhookVerified: boolean;
  connectedAt: string;
}

/** Result of a successful Embedded Signup exchange. */
export interface ExchangeCodeResult {
  connected: WhatsAppAccountDTO[];
  /** True when an existing row was refreshed (e.g. token rotation). */
  refreshed: number;
  /** True when a brand-new account was inserted. */
  created: number;
}

// ── WEBHOOK LOGS ──────────────────────────────────────────────────────────

export type WebhookEventType = "message" | "status" | "errors" | "ctwa_referral" | "unknown";
export type WebhookProcessingStatus = "pending" | "processed" | "failed" | "duplicate";

export interface WebhookLogInsert {
  organization_id?: string;
  whatsapp_account_id?: string;
  waba_id?: string;
  phone_number_id?: string;
  event_type: WebhookEventType;
  meta_event_id?: string;
  signature_valid: boolean;
  raw_payload: unknown;
  processing_status?: WebhookProcessingStatus;
  processing_error?: string;
}

// ── ERROR SHAPES (for HTTP response bodies) ───────────────────────────────

export interface ApiErrorResponse {
  error: string;
  code?: string;
  details?: Record<string, unknown>;
}
