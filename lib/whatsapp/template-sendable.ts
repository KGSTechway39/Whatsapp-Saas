/**
 * Is a template actually sendable?
 *
 * THE TRAP THIS EXISTS TO CLOSE: `templates.status = 'APPROVED'` is our own
 * column. It does NOT mean Meta has the template. A row can be seeded, imported
 * or hand-edited to APPROVED while `meta_template_id` is null — meaning it was
 * never created at Meta and Meta has never heard of it.
 *
 * Sending one of those fails at Meta with:
 *     (#132001) Template name does not exist in the translation
 * which reads like a language problem and sends people hunting in the wrong
 * place. The real cause is that the template isn't there at all.
 *
 * So "sendable" requires BOTH:
 *   • status APPROVED   — Meta approved the content
 *   • meta_template_id  — Meta actually has it
 *
 * Checking one without the other is how a dashboard shows "4 approved
 * templates" while every send fails.
 */

export interface TemplateSendability {
  sendable: boolean;
  /** Machine-readable so callers can branch; null when sendable. */
  reason: "NOT_APPROVED" | "NOT_AT_META" | null;
  /** Plain language for a non-technical owner. */
  message: string | null;
}

export function templateSendability(t: {
  name?: string | null;
  status?: string | null;
  meta_template_id?: string | null;
  metaTemplateId?: string | null;
}): TemplateSendability {
  const metaId = t.meta_template_id ?? t.metaTemplateId ?? null;
  const name = t.name ?? "This template";

  if (t.status !== "APPROVED") {
    return {
      sendable: false,
      reason: "NOT_APPROVED",
      message:
        t.status === "PENDING"
          ? `${name} is still waiting for WhatsApp to approve it.`
          : t.status === "REJECTED"
            ? `${name} was rejected by WhatsApp, so it can't be sent.`
            : `${name} is a draft — submit it to WhatsApp before sending.`,
    };
  }

  if (!metaId) {
    return {
      sendable: false,
      reason: "NOT_AT_META",
      message:
        `${name} hasn't been created on WhatsApp yet, so WhatsApp doesn't recognise it. ` +
        `Sync your templates, or create it again and submit it for approval.`,
    };
  }

  return { sendable: true, reason: null, message: null };
}

/** Convenience for filtering lists down to what can really be sent. */
export function isSendableTemplate(t: {
  status?: string | null;
  meta_template_id?: string | null;
  metaTemplateId?: string | null;
}): boolean {
  return templateSendability(t).sendable;
}
