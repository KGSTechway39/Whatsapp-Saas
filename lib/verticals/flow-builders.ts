/**
 * Canvas graph builders shared by the shipped seed content and the admin
 * "Add new vertical" seed-kit form.
 *
 * They exist so an admin never authors flow JSON by hand. The guided form
 * collects plain-language answers ("what should we ask?", "what should we send
 * back?") and these helpers assemble a graph that is guaranteed to use only the
 * 9 canvas node types, with exactly one trigger — the shape sanitizeFlowGraph
 * accepts and the canvas builder can open.
 *
 * Config keys match what the executor actually reads
 * (app/api/automation-flows/[id]/execute/route.ts). Changing one means changing
 * both.
 */

import type { CanvasGraph, CanvasNodeType } from "@/lib/automation/flow-schema";

export interface NodeSpec {
  id: string;
  type: CanvasNodeType;
  label: string;
  config?: Record<string, unknown>;
}

const COL_X = 260;

function node(spec: NodeSpec, index: number, x = COL_X) {
  return {
    id: spec.id,
    type: spec.type,
    position: { x, y: 60 + index * 130 },
    data: { label: spec.label, config: spec.config ?? {} },
  };
}

/** A straight-line flow: each node feeds the next. Covers most seeded shapes. */
export function linear(specs: NodeSpec[]): CanvasGraph {
  return {
    nodes: specs.map((s, i) => node(s, i)),
    edges: specs.slice(0, -1).map((s, i) => ({
      id: `e${i + 1}`,
      source: s.id,
      target: specs[i + 1].id,
    })),
  };
}

/** A flow with one yes/no branch that rejoins at the end. */
export function branched(args: {
  before: NodeSpec[];
  condition: NodeSpec;
  onYes: NodeSpec[];
  onNo: NodeSpec[];
  end: NodeSpec;
}): CanvasGraph {
  const { before, condition, onYes, onNo, end } = args;
  const nodes = [
    ...before.map((s, i) => node(s, i)),
    node(condition, before.length),
    ...onYes.map((s, i) => node(s, before.length + 1 + i, COL_X - 200)),
    ...onNo.map((s, i) => node(s, before.length + 1 + i, COL_X + 200)),
    node(end, before.length + 1 + Math.max(onYes.length, onNo.length)),
  ];

  const edges: CanvasGraph["edges"] = [];
  let n = 0;
  const link = (source: string, target: string, extra?: { sourceHandle?: string; label?: string }) =>
    edges.push({ id: `e${++n}`, source, target, ...extra });

  before.forEach((s, i) => link(s.id, i + 1 < before.length ? before[i + 1].id : condition.id));
  link(condition.id, onYes[0].id, { sourceHandle: "true", label: "Yes" });
  link(condition.id, onNo[0].id, { sourceHandle: "false", label: "No" });
  onYes.forEach((s, i) => link(s.id, i + 1 < onYes.length ? onYes[i + 1].id : end.id));
  onNo.forEach((s, i) => link(s.id, i + 1 < onNo.length ? onNo[i + 1].id : end.id));

  return { nodes, edges };
}

export const trigger = (keywords: string, intents: string[], label = "Customer messages you"): NodeSpec => ({
  id: "n1",
  type: "triggerNode",
  label,
  config: { triggerType: "keyword", keywords, intents },
});

export const say = (id: string, label: string, text: string): NodeSpec => ({
  id,
  type: "sendMessageNode",
  label,
  config: { messageType: "text", text },
});

export const wait = (id: string, duration: number, unit: "minutes" | "hours" | "days"): NodeSpec => ({
  id,
  type: "waitNode",
  label: `Wait ${duration} ${unit}`,
  config: { duration, unit },
});

export const tag = (id: string, tagName: string): NodeSpec => ({
  id,
  type: "addTagNode",
  label: `Mark as ${tagName}`,
  config: { action: "add", tag: tagName },
});

export const handoff = (id: string, agentName: string, note: string): NodeSpec => ({
  id,
  type: "assignAgentNode",
  label: `Hand to ${agentName}`,
  config: { agentName, note },
});

export const asks = (id: string, value: string, label: string): NodeSpec => ({
  id,
  type: "conditionNode",
  label,
  config: { field: "last_message", operator: "contains", value },
});

export const done = (id = "nz"): NodeSpec => ({
  id,
  type: "endNode",
  label: "Finished",
  config: { endReason: "completed" },
});

/**
 * Assemble the seed-kit's "booking / inquiry" flow from an admin's plain-language
 * answers: greet and ask → mark the contact → hand to a person → finish.
 *
 * Deliberately ends in a human handoff rather than an automatic confirmation. A
 * brand-new vertical has no verified templates and no tested cadence yet, so the
 * safe default is "a person confirms", which also satisfies the rule that nothing
 * reaches a customer without human review.
 */
export function buildBookingFlow(args: {
  keywords: string;
  intents: string[];
  askMessage: string;
  tagName: string;
  handoffTo: string;
}): CanvasGraph {
  return linear([
    trigger(args.keywords, args.intents),
    say("n2", "Reply and ask", args.askMessage),
    tag("n3", args.tagName),
    handoff("n4", args.handoffTo, "New request captured — confirm with the customer."),
    done(),
  ]);
}

/**
 * Assemble the seed-kit's "reminder / status" flow: something is due, ready or
 * changing → tell the customer → let them reply in the same chat.
 */
export function buildStatusFlow(args: {
  keywords: string;
  intents: string[];
  notifyMessage: string;
  triggerLabel: string;
}): CanvasGraph {
  return linear([
    {
      id: "n1",
      type: "triggerNode",
      label: args.triggerLabel,
      config: { triggerType: "keyword", keywords: args.keywords, intents: args.intents },
    },
    say("n2", "Tell the customer", args.notifyMessage),
    done(),
  ]);
}
