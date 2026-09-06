/**
 * The seed-content gate, deliberately free of any database dependency.
 *
 * Split out from seeder.ts so it can run anywhere — a script, a CI step, the
 * admin dry-run endpoint — without Supabase credentials. Phase 0 risk #2 is a
 * content bug, and content bugs should be catchable without a database.
 */

import { SEED_VERTICALS, type SeedItem, type SeedVertical } from "./seed-data";
import {
  VerticalSeedError,
  looksLikeClinicalData,
  validateCampaignPromptPayload,
  validateCopy,
  validateFlowPayload,
  validateMessageTemplatePayload,
} from "./validate";

/**
 * Validate one library item completely. Throws VerticalSeedError on the first
 * problem, with enough context to fix the seed data.
 */
export function validateSeedItem(item: SeedItem, verticalSlug: string): void {
  validateCopy(item, { vertical: verticalSlug, kind: item.kind });

  switch (item.kind) {
    case "FLOW_JSON":
      validateFlowPayload(item.payload, { title: item.title, vertical: verticalSlug });
      break;

    case "CAMPAIGN_PROMPT":
      validateCampaignPromptPayload(item.payload, { title: item.title, vertical: verticalSlug });
      break;

    case "MESSAGE_TEMPLATE": {
      validateMessageTemplatePayload(item.payload, item.metaCategory, {
        title: item.title,
        vertical: verticalSlug,
      });
      // Applies to every vertical, not just hospital: a message body is the one
      // place a result must never appear. Cheap to satisfy, irreversible to get
      // wrong (DPDP exposure — see the report-ready "doorbell" seeds).
      if (looksLikeClinicalData(item.payload.body)) {
        throw new VerticalSeedError(
          "template body looks like it contains a clinical result or reading. " +
            "Announce that a report is ready; never put the result in the message.",
          { title: item.title, kind: item.kind, vertical: verticalSlug },
        );
      }
      break;
    }
  }
}

/** Validate every shipped vertical. Returns human-readable errors; [] means clean. */
export function validateAllSeedData(verticals: SeedVertical[] = SEED_VERTICALS): string[] {
  const errors: string[] = [];
  for (const v of verticals) {
    if (!v.slug?.trim()) errors.push("a vertical has no slug");
    if (!v.items.length) errors.push(`${v.slug}: has no seed content`);
    for (const item of v.items) {
      try {
        validateSeedItem(item, v.slug);
      } catch (err) {
        errors.push(err instanceof Error ? `${v.slug} / ${item.title}: ${err.message}` : String(err));
      }
    }
  }
  return errors;
}
