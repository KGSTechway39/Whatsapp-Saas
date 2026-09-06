/**
 * Consent gate — the send-time enforcement of the vertical consent rule.
 *
 * THE RULE: when a tenant's industry is flagged `requires_explicit_consent`,
 * no automation or campaign send may target a contact who has not explicitly
 * consented. Hospital (health data, DPDP Act) and School (minors' data) are
 * flagged today.
 *
 * DATA-DRIVEN, NOT HARDCODED. There is no `if (vertical === 'hospital')` in
 * this file and there must never be one — the rule is a boolean column on
 * industry_verticals, so a new regulated vertical is an UPDATE, not a deploy.
 *
 * ── What is gated, and what deliberately is not ────────────────────────────
 * GATED   — campaign fan-out and automation flows. These are sends the BUSINESS
 *           initiates against a list. That is exactly the processing consent
 *           exists to govern.
 * NOT GATED — a human replying in the inbox to someone who just messaged in.
 *           The contact opened the conversation; blocking the front desk from
 *           answering a patient who asked a question would be both a product
 *           failure and a worse outcome for that patient. Service replies
 *           inside the 24h window stay allowed.
 *
 * ── Failure directions (chosen deliberately, not by accident) ──────────────
 * • Policy lookup fails → treat as NOT required, log loudly. The alternative
 *   blocks every send for all six verticals on a transient DB blip, when only
 *   two are regulated. The blast radius of failing closed here is far larger
 *   than the risk it removes.
 * • Policy is known to be required, per-contact consent unknown/missing →
 *   BLOCK. Once we know the rule applies, absence of consent is never
 *   permission.
 */
import { createServiceClient } from "@/lib/supabase/server";
import { getVerticalForUser } from "@/lib/verticals/repository";
import { logger } from "@/lib/logger";

/** Thrown when a single-target send is blocked. Callers map this to a 4xx. */
export class ConsentRequiredError extends Error {
  readonly code = "CONSENT_REQUIRED";
  constructor(
    public readonly contactId: string,
    public readonly verticalName: string,
  ) {
    super(
      `This contact hasn't given consent yet. ${verticalName} accounts need explicit ` +
      `consent before automated or campaign messages can be sent to them.`,
    );
    this.name = "ConsentRequiredError";
  }
}

export interface ConsentPolicy {
  required: boolean;
  /** Human name of the industry that imposes the rule, for error copy. */
  verticalName: string;
}

/**
 * Does this tenant's industry require explicit consent?
 * Resolved per call; cheap (one indexed lookup) and always current, so turning
 * the flag on for a vertical takes effect immediately with no cache to bust.
 */
export async function consentPolicyFor(userId: string): Promise<ConsentPolicy> {
  try {
    const vertical = await getVerticalForUser(userId);
    if (!vertical) return { required: false, verticalName: "" };
    return {
      required: vertical.requiresExplicitConsent,
      verticalName: vertical.displayName,
    };
  } catch (err) {
    // See "Failure directions" above — fail open here, loudly.
    logger.warn("consent: policy lookup failed, treating as not required", {
      userId,
      error: (err as Error).message,
    });
    return { required: false, verticalName: "" };
  }
}

export interface ConsentSplit {
  allowed: string[];
  blocked: string[];
  policy: ConsentPolicy;
}

/**
 * Split a contact list into who may be messaged and who may not.
 *
 * Used by campaign fan-out, where blocking the whole send because 3 of 800
 * contacts lack consent would be worse than sending to the 797 who gave it.
 * The caller reports the blocked count so it is visible, never silent.
 */
export async function splitByConsent(userId: string, contactIds: string[]): Promise<ConsentSplit> {
  const policy = await consentPolicyFor(userId);
  if (!policy.required || contactIds.length === 0) {
    return { allowed: contactIds, blocked: [], policy };
  }

  const supabase = createServiceClient();
  const consented = new Set<string>();

  // Chunked: `in` on a very large list is a query-size problem, and a campaign
  // audience is routinely thousands of contacts.
  const CHUNK = 500;
  for (let i = 0; i < contactIds.length; i += CHUNK) {
    const slice = contactIds.slice(i, i + CHUNK);
    const { data, error } = await supabase
      .from("contacts")
      .select("id")
      .eq("user_id", userId)              // tenant scoping — never trust the id list alone
      .eq("sensitive_data_consent", true)
      .in("id", slice);
    if (error) {
      // Fail closed: the policy IS required and we cannot prove consent.
      logger.warn("consent: contact check failed, blocking slice", { userId, error: error.message });
      continue;
    }
    for (const r of (data ?? []) as { id: string }[]) consented.add(r.id);
  }

  return {
    allowed: contactIds.filter((id) => consented.has(id)),
    blocked: contactIds.filter((id) => !consented.has(id)),
    policy,
  };
}

/**
 * Single-target gate for automation flows. Throws ConsentRequiredError when the
 * send must not proceed.
 *
 * A contact id we cannot resolve is treated as not-consented: an automation
 * firing at an unknown contact is precisely the case where guessing is unsafe.
 */
export async function assertConsent(userId: string, contactId: string | null | undefined): Promise<void> {
  const policy = await consentPolicyFor(userId);
  if (!policy.required) return;

  if (!contactId) {
    throw new ConsentRequiredError("(unknown)", policy.verticalName);
  }

  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("contacts")
    .select("sensitive_data_consent")
    .eq("user_id", userId)
    .eq("id", contactId)
    .maybeSingle<{ sensitive_data_consent: boolean }>();

  if (error || !data || data.sensitive_data_consent !== true) {
    throw new ConsentRequiredError(contactId, policy.verticalName);
  }
}

/**
 * Record (or withdraw) a contact's consent.
 *
 * The timestamp is written with the flag, never separately — migration 031 has
 * a CHECK enforcing that pairing, because "consented, but we don't know when"
 * is not a defensible record. Withdrawal clears the flag but KEEPS the original
 * timestamp and source, so the history of what was true remains readable.
 */
export async function setContactConsent(
  userId: string,
  contactId: string,
  given: boolean,
  source: string,
): Promise<{ id: string; sensitive_data_consent: boolean; consent_timestamp: string | null }> {
  const supabase = createServiceClient();
  const patch = given
    ? { sensitive_data_consent: true, consent_timestamp: new Date().toISOString(), consent_source: source }
    : { sensitive_data_consent: false };

  const { data, error } = await supabase
    .from("contacts")
    .update(patch)
    .eq("user_id", userId)               // tenant scoping
    .eq("id", contactId)
    .select("id, sensitive_data_consent, consent_timestamp")
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) throw new Error("We couldn't find that contact.");
  return data as { id: string; sensitive_data_consent: boolean; consent_timestamp: string | null };
}
