/**
 * Starter templates — a curated set SendAnjal creates on a tenant's own WABA.
 *
 * WHY THIS REPLACES THE OLD "META TEMPLATE LIBRARY" PANEL:
 * that panel called `GET /{waba_id}/template_library`, which is not a real
 * Graph endpoint ("Unknown path components: /template_library"). Every request
 * failed and silently fell back to a hardcoded array, so the UI showed ten
 * templates that looked like Meta's and could never be added. Meta does not
 * hand out ready-made templates — every template is created by the business
 * and reviewed by Meta.
 *
 * So these are OUR starter definitions, created through the real
 * `POST /{waba_id}/message_templates` path (lib/meta.ts createTemplate). They
 * are honest: a tenant who adds one gets a genuine PENDING template on their
 * WABA that becomes sendable when Meta approves it.
 *
 * DESIGN RULES for anything added here:
 *  • UTILITY only. Marketing templates are rejected far more often, and a
 *    starter set whose first suggestion gets rejected teaches people the
 *    feature is broken.
 *  • Transactional, specific, and clearly triggered by a customer action —
 *    that is what Meta approves.
 *  • Placeholders numbered from {{1}} with a plain-language label each, so the
 *    UI can ask "what goes in slot 1?" without the owner learning Meta syntax.
 *  • No promotional language, no "click here", no URL shorteners — all common
 *    rejection triggers.
 */

export interface StarterTemplate {
  /** Meta template name: lowercase, digits, underscores. */
  name: string;
  /** Shown to the owner. */
  displayName: string;
  /** One line on what it is for. */
  purpose: string;
  category: "UTILITY";
  language: string;
  body: string;
  footer?: string;
  /** Human labels for {{1}}, {{2}} … in order. */
  variableLabels: string[];
  /** Example values — Meta requires samples for any template with variables. */
  examples: string[];
}

export const STARTER_TEMPLATES: StarterTemplate[] = [
  {
    name: "order_confirmation_v1",
    displayName: "Order confirmed",
    purpose: "Send as soon as someone places an order.",
    category: "UTILITY",
    language: "en_US",
    body:
      "Hi {{1}}, we've received your order {{2}}. Total: {{3}}. " +
      "We'll message you again when it's on the way.",
    footer: "Reply to this message if anything looks wrong.",
    variableLabels: ["Customer name", "Order number", "Order total"],
    examples: ["Anita", "#1042", "₹1,299"],
  },
  {
    name: "order_shipped_v1",
    displayName: "Order on the way",
    purpose: "Send when the order is dispatched.",
    category: "UTILITY",
    language: "en_US",
    body:
      // Must not end on a placeholder — see the note on enquiry_received_v1.
      "Hi {{1}}, your order {{2}} is on its way. " +
      "Expected delivery: {{3}}. We'll let you know when it arrives.",
    variableLabels: ["Customer name", "Order number", "Expected delivery date"],
    examples: ["Anita", "#1042", "Friday 8 August"],
  },
  {
    name: "appointment_reminder_v1",
    displayName: "Appointment reminder",
    purpose: "Send the day before a booking so fewer people miss it.",
    category: "UTILITY",
    language: "en_US",
    body:
      "Hi {{1}}, this is a reminder of your appointment on {{2}} at {{3}}. " +
      "Reply CHANGE if you need a different time.",
    variableLabels: ["Customer name", "Appointment date", "Appointment time"],
    examples: ["Anita", "5 August", "4:30 PM"],
  },
  {
    name: "appointment_confirmed_v1",
    displayName: "Appointment confirmed",
    purpose: "Send immediately after a booking is made.",
    category: "UTILITY",
    language: "en_US",
    body:
      "Hi {{1}}, your appointment is confirmed for {{2}} at {{3}}. " +
      "We'll send a reminder the day before.",
    variableLabels: ["Customer name", "Appointment date", "Appointment time"],
    examples: ["Anita", "5 August", "4:30 PM"],
  },
  {
    name: "payment_received_v1",
    displayName: "Payment received",
    purpose: "Confirm a payment so the customer has a record.",
    category: "UTILITY",
    language: "en_US",
    body: "Hi {{1}}, we've received your payment of {{2}} for {{3}}. Thank you.",
    variableLabels: ["Customer name", "Amount paid", "What it was for"],
    examples: ["Anita", "₹1,299", "order #1042"],
  },
  {
    name: "enquiry_received_v1",
    displayName: "We got your enquiry",
    purpose: "Acknowledge an enquiry so the customer isn't left waiting.",
    category: "UTILITY",
    language: "en_US",
    body:
      // Meta rejects a body whose variable sits at the very start or end
      // ("Variables can't be at the start or end of the template"), and a
      // trailing "{{2}}." counts as the end. Keep real words after the last
      // placeholder.
      "Hi {{1}}, thanks for getting in touch. We've received your enquiry and " +
      "someone will reply within {{2}} — thanks for your patience.",
    variableLabels: ["Customer name", "Response time"],
    examples: ["Anita", "24 hours"],
  },
];

/**
 * Build Meta's `components` array for a starter template.
 *
 * Meta REQUIRES an `example.body_text` for any body containing placeholders —
 * without it the template is rejected at submission, not at review, which
 * looks like an unexplained failure.
 */
export function buildComponents(t: StarterTemplate): Record<string, unknown>[] {
  const components: Record<string, unknown>[] = [
    {
      type: "BODY",
      text: t.body,
      ...(t.variableLabels.length
        ? { example: { body_text: [t.examples] } }
        : {}),
    },
  ];
  if (t.footer) components.push({ type: "FOOTER", text: t.footer });
  return components;
}

export function getStarter(name: string): StarterTemplate | undefined {
  return STARTER_TEMPLATES.find((t) => t.name === name);
}

/**
 * Meta rejects a body that begins or ends with a placeholder
 * ("Variables can't be at the start or end of the template"), and trailing
 * punctuation after the last {{n}} still counts as the end. Two starters
 * shipped with that defect and only failed at submission, so assert it here —
 * a bad starter should fail the build, not a customer's first attempt.
 */
export function validateStarterBody(body: string): string | null {
  const trimmed = body.trim();
  if (/^\{\{\d+\}\}/.test(trimmed)) return "Body starts with a variable.";
  // Anything after the final placeholder that is only punctuation/space.
  if (/\{\{\d+\}\}[\s.,!?;:—-]*$/.test(trimmed)) return "Body ends with a variable.";
  return null;
}

// Fail fast in development if a starter violates Meta's rule.
if (process.env.NODE_ENV !== "production") {
  for (const t of STARTER_TEMPLATES) {
    const problem = validateStarterBody(t.body);
    if (problem) {
      // eslint-disable-next-line no-console
      console.warn(`[starter-templates] ${t.name}: ${problem} Meta will reject this.`);
    }
  }
}
