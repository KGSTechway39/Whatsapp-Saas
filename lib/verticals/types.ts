/**
 * Industry vertical types — the TS mirror of migration 026_verticals.sql.
 *
 * IMPORTANT (standing restriction): no vertical NAME, COPY, FLOW or TEMPLATE may
 * be hardcoded in TypeScript or React. This module defines SHAPES only. Every
 * value comes from the `industry_verticals` / `vertical_template_library` tables,
 * so an admin can add "Gym" through the UI without a deploy.
 */

import type { CanvasGraph } from "@/lib/automation/flow-schema";

export const VERTICAL_TEMPLATE_KINDS = ["CAMPAIGN_PROMPT", "FLOW_JSON", "MESSAGE_TEMPLATE"] as const;
export type VerticalTemplateKind = (typeof VERTICAL_TEMPLATE_KINDS)[number];

export const META_TEMPLATE_CATEGORIES = ["UTILITY", "MARKETING", "AUTHENTICATION"] as const;
export type MetaTemplateCategory = (typeof META_TEMPLATE_CATEGORIES)[number];

export interface IndustryVertical {
  id: string;
  slug: string;
  displayName: string;
  description: string;
  icon: string | null;
  isActive: boolean;
  sortOrder: number;
  isBuiltin: boolean;
  /**
   * Data-driven compliance switch. When true, a contact must have given
   * explicit consent before any automation or campaign for this vertical may
   * target them (DPDP for health data, minors' data for schools).
   *
   * Deliberately a column, never `if (slug === 'hospital')` — a new regulated
   * vertical turns this on with an UPDATE, not a deploy.
   */
  requiresExplicitConsent: boolean;
  /**
   * Attestation gate (033). When true, the tenant must confirm a compliance
   * declaration before commerce/catalog features activate. Data-driven for the
   * same reason as consent: a future regulated vertical flips a boolean.
   */
  requiresComplianceAttestation: boolean;
}

/**
 * The booking/inquiry generalization from the Phase 0 audit.
 *
 * Hospital appointments, Real Estate site visits, School counselor slots and
 * Salon bookings are the SAME engine (`capture → qualify → confirm → remind`)
 * with different config — not forked implementations. This config rides along
 * with the flow so the copy and cadence are data, never code.
 */
export interface BookingContext {
  /** What to ask the customer, in order. Labels are shown verbatim. */
  captureFields: {
    key: string;
    label: string;
    /** Optional fixed choices; free text when omitted. */
    options?: string[];
    required?: boolean;
  }[];
  /** What to send back once the booking is captured. May use {{placeholders}}. */
  confirmationCopy: string;
  /**
   * When to nudge, as hours BEFORE the booked time (e.g. [24, 2, 0.5]).
   *
   * Runtime caveat (Phase 0 §2): production currently sends only a flow's FIRST
   * reply — multi-step cadences store and edit correctly but do not fully fire
   * until the persistent worker lands. Do not promise them in client copy.
   */
  reminderCadenceHours: number[];
}

/** payload shape when kind = 'FLOW_JSON' */
export interface FlowJsonPayload {
  /** MUST pass sanitizeFlowGraph — validated at seed time, not at render time. */
  flow: CanvasGraph;
  /** Mirrors automation_flows.trigger_type, e.g. 'keyword' | 'new_contact'. */
  triggerType: string;
  bookingContext?: BookingContext;
}

/** payload shape when kind = 'CAMPAIGN_PROMPT' */
export interface CampaignPromptPayload {
  /** Pre-fills the generation input at /api/ai/campaign-draft. Client can edit. */
  prompt: string;
  goal?: string;
  audienceHint?: string;
}

/** payload shape when kind = 'MESSAGE_TEMPLATE' */
export interface MessageTemplatePayload {
  body: string;
  footer?: string;
  /** Names for the {{1}}, {{2}} … positions, in order. */
  variableNames: string[];
  language: string;
}

export type VerticalTemplatePayload = FlowJsonPayload | CampaignPromptPayload | MessageTemplatePayload;

interface VerticalTemplateBase {
  id: string;
  verticalId: string;
  title: string;
  description: string;
  outcome: string;
  adminNote: string | null;
  isActive: boolean;
  sortOrder: number;
}

/**
 * Discriminated on `kind` so `metaCategory` is only reachable — and is
 * non-nullable — on message templates, matching the DB CHECK constraints.
 */
export type VerticalTemplateItem =
  | (VerticalTemplateBase & { kind: "FLOW_JSON";        payload: FlowJsonPayload;        metaCategory: null })
  | (VerticalTemplateBase & { kind: "CAMPAIGN_PROMPT";  payload: CampaignPromptPayload;  metaCategory: null })
  | (VerticalTemplateBase & { kind: "MESSAGE_TEMPLATE"; payload: MessageTemplatePayload; metaCategory: MetaTemplateCategory });

/** A vertical plus everything seeded for it — what the admin preview panel renders. */
export interface VerticalWithLibrary {
  vertical: IndustryVertical;
  flows: Extract<VerticalTemplateItem, { kind: "FLOW_JSON" }>[];
  campaignPrompts: Extract<VerticalTemplateItem, { kind: "CAMPAIGN_PROMPT" }>[];
  messageTemplates: Extract<VerticalTemplateItem, { kind: "MESSAGE_TEMPLATE" }>[];
}
