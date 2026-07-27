/**
 * Prompt templates for `automation_flow_builder` (design-time, stronger model).
 *
 * The model turns a shop owner's plain-language description ("if a customer asks
 * about price, send our price list and tag them as a hot lead") into a canvas
 * flow graph that renders on the SAME @xyflow/react builder the manual palette
 * uses. Correctness of the JSON matters (it drives a visual editor), so this task
 * routes to a Sonnet-class model and the route schema-validates + silently
 * retries (runTask `parse` + `appendOnRetry`).
 *
 * The node-type vocabulary here MUST stay in sync with lib/automation/flow-schema.ts
 * (the server validator) and components/automation/FlowNodes.tsx (the renderer).
 */

import { CANVAS_NODE_TYPES } from "@/lib/automation/flow-schema";

const LANGS: Record<string, string> = {
  en: "English", en_IN: "Indian English", hi: "Hindi", ta: "Tamil",
  te: "Telugu", mr: "Marathi", bn: "Bengali", kn: "Kannada",
};

export function flowBuilderSystemPrompt(language = "en"): string {
  const langName = LANGS[language] ?? "English";
  // We describe the node vocabulary in business terms — the model never sees the
  // word "JSON schema" phrased as jargon to the user; this is the model contract.
  return `You design WhatsApp auto-reply flows for Indian small businesses. You turn a
plain-language description of "when a customer does X, do Y" into a visual flow made
of connected steps.

You output ONLY a JSON object — no markdown fences, no commentary. Shape:
{
  "name": "short flow name (max 60 chars)",
  "nodes": [ { "id": "n1", "type": <one of the step types>, "position": {"x": <int>, "y": <int>}, "data": { "label": "short label", "config": { ... } } } ],
  "edges": [ { "id": "e1", "source": "n1", "target": "n2", "sourceHandle": "true|false (only from a condition step)", "label": "Yes|No (optional)" } ]
}

Step types (the "type" field) and their "config":
- "triggerNode"  — the entry point. Exactly ONE, and it must be the first node.
    config: { "triggerType": "keyword", "keywords": "comma, separated, words", "intents": ["short intent phrase", ...] }
    Put the customer situations that should start this flow in "intents" (e.g. ["asks about price","wants a demo"]).
- "sendMessageNode" — send a WhatsApp reply.
    config: { "messageType": "text", "text": "the reply, use {{name}} for the customer's name" }
- "conditionNode" — branch yes/no. It has TWO outgoing edges: sourceHandle "true" and "false".
    config: { "field": "last_message", "operator": "contains", "value": "word" }
- "addTagNode" — label the customer.
    config: { "action": "add", "tag": "hot-lead" }
- "assignAgentNode" — hand the chat to a human.
    config: { "agentName": "Sales Team", "note": "why" }
- "updateContactNode" — set a contact field.
    config: { "field": "crm_stage", "value": "interested" }
- "waitNode" — pause before the next step.
    config: { "duration": 1, "unit": "hours" }
- "endNode" — finish the flow. config: { "endReason": "completed" }

Rules:
- Allowed "type" values, EXACTLY: ${CANVAS_NODE_TYPES.join(", ")}.
- Start with one triggerNode; end each path with an endNode.
- Every node id is referenced by at least one edge (no orphans); every edge source/target is a real node id.
- Lay nodes out top-to-bottom: increase "y" by ~130 per step; branches spread on "x".
- Keep message copy in ${langName}, warm and simple. No links/URLs, no ALL-CAPS, no spammy claims.
- 3–8 nodes is ideal. Never invent step types beyond the list above.`;
}

export function flowBuilderUserPrompt(description: string, businessName?: string): string {
  return `Business: ${businessName?.trim() || "a small business"}
Describe-in-plain-language automation the owner wants:
"${description.trim()}"

Return the flow JSON now.`;
}

/** Fed back on a silent retry when the previous output failed validation. */
export function flowBuilderRetryHint(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  return `Your previous answer was rejected: ${msg}
Return corrected JSON only — same shape, valid node types, all edges referencing real node ids, one triggerNode first, endNode on each path.`;
}
