/**
 * Prompt template for `automation_runtime_intent` (runtime, cheapest fast model).
 *
 * This runs on EVERY inbound customer message at scale, so the prompt is kept
 * deliberately tiny — a strict classify-only instruction, no chit-chat, minimal
 * output tokens — to protect margin. It does NOT generate customer-facing text;
 * it only picks which already-approved flow (if any) an inbound message matches.
 *
 * Contract: given the customer's message and a numbered list of candidate intents
 * (each intent belongs to one published flow), return ONLY JSON:
 *   { "id": <candidate id or "none">, "confidence": <0..1> }
 */

export interface IntentCandidate {
  /** Stable id the caller maps back to a flow (e.g. the flow id). */
  id: string;
  /** Natural-language descriptions of what this flow is for. */
  phrases: string[];
}

export const INTENT_SYSTEM_PROMPT =
  `You match one customer WhatsApp message to the single best-fitting category, or to "none".
Reply with ONLY a JSON object: {"id":"<category id or none>","confidence":<number 0 to 1>}.
No other text. Pick "none" if nothing clearly fits (confidence below ~0.55).`;

export function intentUserPrompt(message: string, candidates: IntentCandidate[]): string {
  const list = candidates
    .map((c) => `- id "${c.id}": ${c.phrases.filter(Boolean).join("; ")}`)
    .join("\n");
  return `Message: "${message.trim().slice(0, 500)}"

Categories:
${list}

Return the JSON now.`;
}
