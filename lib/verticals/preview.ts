/**
 * Turning a flow graph into something a non-technical person can judge.
 *
 * The Phase 4 signature rule is "show the bubble, not the blueprint": every
 * recommendation is presented as the actual WhatsApp message the customer
 * receives, never as a node graph. These helpers extract that message.
 *
 * `firstMessageOf` deliberately mirrors `renderFirstReply` in
 * lib/automation/runtime.ts — same breadth-first walk from the trigger to the
 * first text message — because that is precisely what production sends today.
 * The preview therefore shows the truth, not an aspiration.
 */

import type { CanvasGraph } from "@/lib/automation/flow-schema";

interface LooseNode {
  id: string;
  type?: string;
  data?: { config?: Record<string, unknown> };
}

/**
 * The first message a customer would actually receive from this flow.
 * Returns null for a flow whose first action isn't a message (rare in seeds).
 */
export function firstMessageOf(graph: CanvasGraph | null | undefined, contactName = "Anita"): string | null {
  const nodes = (graph?.nodes ?? []) as LooseNode[];
  const edges = graph?.edges ?? [];
  const trigger = nodes.find((n) => n.type === "triggerNode");
  if (!trigger) return null;

  const byId = new Map(nodes.map((n) => [n.id, n]));
  const queue = [trigger.id];
  const seen = new Set<string>();

  while (queue.length) {
    const id = queue.shift();
    if (!id || seen.has(id)) continue;
    seen.add(id);

    const node = byId.get(id);
    if (node?.type === "sendMessageNode") {
      const cfg = node.data?.config ?? {};
      if (cfg.messageType !== "template" && typeof cfg.text === "string" && cfg.text.trim()) {
        // Owners write {{name}}; never show a raw placeholder in a preview.
        return cfg.text.trim().replace(/\{\{\s*name\s*\}\}/gi, contactName);
      }
    }
    for (const e of edges) if (e.source === id) queue.push(e.target);
  }
  return null;
}

/**
 * How many messages this flow sends when it runs in full.
 *
 * The UI uses this to be honest about the Phase 0 §2 limitation: production
 * currently delivers only the first reply, so a flow with more than one message
 * is labelled as such rather than silently over-promising.
 */
export function flowStepCount(graph: CanvasGraph | null | undefined): number {
  return ((graph?.nodes ?? []) as LooseNode[]).filter((n) => n.type === "sendMessageNode").length;
}
