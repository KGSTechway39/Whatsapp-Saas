/**
 * Validation for vertical library rows.
 *
 * This is the gate the Phase 0 audit called for (risk #2). A seeded flow that
 * fails `sanitizeFlowGraph` would land in a provisioned tenant as a card that
 * cannot be opened on the canvas — a broken dashboard for a real client, created
 * by us, silently. So the seed script validates every payload BEFORE insert and
 * fails the SEED rather than the TENANT.
 *
 * The same functions back the admin "Add new vertical" form, so an admin cannot
 * hand-author a broken seed kit either.
 */

import { sanitizeFlowGraph, CANVAS_NODE_TYPES } from "@/lib/automation/flow-schema";
import {
  META_TEMPLATE_CATEGORIES,
  type MetaTemplateCategory,
  type VerticalTemplateKind,
  type CampaignPromptPayload,
  type FlowJsonPayload,
  type MessageTemplatePayload,
} from "./types";

export class VerticalSeedError extends Error {
  constructor(
    message: string,
    readonly context: { title?: string; kind?: VerticalTemplateKind; vertical?: string },
  ) {
    super(message);
    this.name = "VerticalSeedError";
  }
}

/** Plain-language copy rules that apply to every client-facing string. */
const JARGON = [
  "webhook", "payload", "waba", "api", "endpoint", "json", "node", "trigger webhook",
  "meta template object", "conversation object", "opt-in status", "cron",
];

/**
 * Client-facing copy must not leak platform jargon (Phase 4 copy rules).
 * Returns the offending terms; empty array means clean.
 */
export function findJargon(text: string): string[] {
  const lower = ` ${text.toLowerCase()} `;
  return JARGON.filter((term) => lower.includes(` ${term} `) || lower.includes(` ${term}s `));
}

/**
 * Heuristic detector for clinical results embedded in message copy.
 *
 * Hospital messaging must use the "doorbell" pattern — tell the patient their
 * report is ready, never put the result in the WhatsApp body. That is a DPDP Act
 * exposure (message content sits unencrypted-at-rest in Meta's logs, on shared
 * family phones, and in our own webhook inbox) and it is irreversible once sent.
 *
 * Applied to ALL verticals, not just hospital: it is a content-safety check, not
 * vertical content, so it never hardcodes an industry. False positives are cheap
 * (a warning the author can dismiss); a leaked diagnosis is not.
 */
export function looksLikeClinicalData(text: string): boolean {
  const t = text.toLowerCase();
  // Measurement with a clinical unit, e.g. "hb 11.2 g/dl", "bp 140/90", "12 mg/dl".
  const unit = /\b\d+(\.\d+)?\s?(mg\/dl|g\/dl|mmol\/l|mm\s?hg|iu\/l|ng\/ml|meq\/l|bpm|mcg)\b/;
  // "<marker>: <number>" e.g. "hba1c: 6.4", "wbc 11000".
  const marker = /\b(hb|hba1c|wbc|rbc|tsh|ldl|hdl|creatinine|bilirubin|platelet|glucose|sugar|cholesterol|bp|spo2)\b[\s:=-]*\d/;
  // Outcome words that turn a notification into a disclosure.
  const verdict = /\b(positive|negative|reactive|non-reactive|malignant|benign|abnormal|normal range|diagnos(is|ed)|biopsy|tumou?r)\b/;
  return unit.test(t) || marker.test(t) || verdict.test(t);
}

/**
 * Validate a FLOW_JSON payload.
 *
 * Hard gate: the graph must survive `sanitizeFlowGraph`, which enforces exactly
 * one trigger, referential edges, and — critically — only the 9 canvas node
 * types. Anything else (aiReplyNode, or the snake_case vocabulary from the
 * undeployed org-model engine) is rejected here rather than at the client's
 * first click.
 */
export function validateFlowPayload(payload: FlowJsonPayload, ctx: { title: string; vertical?: string }): void {
  const where = { ...ctx, kind: "FLOW_JSON" as const };

  if (!payload?.flow) throw new VerticalSeedError("payload.flow is missing", where);
  if (!payload.triggerType?.trim()) throw new VerticalSeedError("payload.triggerType is required", where);

  try {
    sanitizeFlowGraph(payload.flow);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new VerticalSeedError(
      `flow rejected by sanitizeFlowGraph: ${reason} ` +
        `(allowed node types: ${CANVAS_NODE_TYPES.join(", ")})`,
      where,
    );
  }

  const booking = payload.bookingContext;
  if (booking) {
    if (!booking.captureFields?.length) {
      throw new VerticalSeedError("bookingContext.captureFields cannot be empty", where);
    }
    if (!booking.confirmationCopy?.trim()) {
      throw new VerticalSeedError("bookingContext.confirmationCopy is required", where);
    }
    if (booking.reminderCadenceHours?.some((h) => !(h > 0))) {
      throw new VerticalSeedError("bookingContext.reminderCadenceHours must all be > 0", where);
    }
  }
}

export function validateCampaignPromptPayload(
  payload: CampaignPromptPayload,
  ctx: { title: string; vertical?: string },
): void {
  const where = { ...ctx, kind: "CAMPAIGN_PROMPT" as const };
  const prompt = payload?.prompt?.trim();
  if (!prompt) throw new VerticalSeedError("payload.prompt is required", where);
  // Long enough to steer the model, short enough that the client can read and
  // edit it in the input before generating.
  if (prompt.length < 20) throw new VerticalSeedError("payload.prompt is too short to be useful", where);
  if (prompt.length > 600) throw new VerticalSeedError("payload.prompt is too long to edit comfortably (max 600)", where);
}

/** Meta caps: body 1024, footer 60. Enforced here so a seed can never fail review. */
export function validateMessageTemplatePayload(
  payload: MessageTemplatePayload,
  metaCategory: MetaTemplateCategory | null,
  ctx: { title: string; vertical?: string },
): void {
  const where = { ...ctx, kind: "MESSAGE_TEMPLATE" as const };

  if (!metaCategory) throw new VerticalSeedError("metaCategory is required for MESSAGE_TEMPLATE", where);
  if (!META_TEMPLATE_CATEGORIES.includes(metaCategory)) {
    throw new VerticalSeedError(`unknown metaCategory "${metaCategory}"`, where);
  }

  const body = payload?.body?.trim();
  if (!body) throw new VerticalSeedError("payload.body is required", where);
  if (body.length > 1024) throw new VerticalSeedError("payload.body exceeds Meta's 1024-char limit", where);
  if (payload.footer && payload.footer.length > 60) {
    throw new VerticalSeedError("payload.footer exceeds Meta's 60-char limit", where);
  }
  if (!payload.language?.trim()) throw new VerticalSeedError("payload.language is required", where);

  // Placeholders must be {{1}}, {{2}}, … contiguous from 1, and every one of them
  // needs a name — otherwise the client sees an unlabelled blank at send time.
  const positions: number[] = [];
  const placeholder = /\{\{\s*(\d+)\s*\}\}/g;
  let match: RegExpExecArray | null;
  while ((match = placeholder.exec(body)) !== null) positions.push(Number(match[1]));
  const unique = positions.filter((p, i) => positions.indexOf(p) === i).sort((a, b) => a - b);
  const expected = unique.map((_, i) => i + 1);
  if (unique.join(",") !== expected.join(",")) {
    throw new VerticalSeedError(
      `placeholders must run 1..n with no gaps; found {{${unique.join("}}, {{")}}}`,
      where,
    );
  }
  if (payload.variableNames.length !== unique.length) {
    throw new VerticalSeedError(
      `variableNames has ${payload.variableNames.length} entries but body uses ${unique.length} placeholder(s)`,
      where,
    );
  }
}

/**
 * Validate the plain-language fields every kind shares. These are what a hospital
 * receptionist actually reads, so they are held to the Phase 4 copy rules.
 */
export function validateCopy(
  item: { title: string; description: string; outcome: string },
  ctx: { vertical?: string; kind?: VerticalTemplateKind },
): void {
  const where = { ...ctx, title: item.title };
  if (!item.title?.trim()) throw new VerticalSeedError("title is required", where);
  if (!item.description?.trim()) throw new VerticalSeedError("description is required", where);
  if (!item.outcome?.trim()) throw new VerticalSeedError("outcome is required", where);

  for (const [field, value] of [
    ["title", item.title],
    ["description", item.description],
    ["outcome", item.outcome],
  ] as const) {
    const found = findJargon(value);
    if (found.length) {
      throw new VerticalSeedError(
        `${field} contains jargon a non-technical client won't understand: ${found.join(", ")}`,
        where,
      );
    }
  }
}
