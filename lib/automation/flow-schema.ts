/**
 * Canvas flow-graph schema — the server-side contract for AI-generated automation
 * flows, and the sanitizer that makes model output safe to render on the builder.
 *
 * This is intentionally a PLAIN module (no React / lucide imports) so it can be
 * used from a route handler. The node-type vocabulary mirrors the renderer in
 * components/automation/FlowNodes.tsx (`nodeTypes` / `DEFAULT_CONFIGS`) and the
 * prompt in lib/ai/prompts/flow-builder.ts — keep the three in sync.
 *
 * The graph shape matches exactly what the manual builder saves to
 * automation_flows.flow_data, so an AI draft drops onto the canvas and is then
 * fully drag/edit-able like any hand-built flow (rule: AI only pre-fills; the
 * human still edits and must Activate manually before it ever runs).
 */

/** Allowed canvas node "type" values. Source of truth for the AI contract. */
export const CANVAS_NODE_TYPES = [
  "triggerNode",
  "sendMessageNode",
  "waitNode",
  "conditionNode",
  "addTagNode",
  "updateContactNode",
  "assignAgentNode",
  "httpRequestNode",
  "endNode",
] as const;

export type CanvasNodeType = (typeof CANVAS_NODE_TYPES)[number];

const DEFAULT_LABELS: Record<CanvasNodeType, string> = {
  triggerNode: "Trigger",
  sendMessageNode: "Send Message",
  waitNode: "Wait",
  conditionNode: "Condition",
  addTagNode: "Add Tag",
  updateContactNode: "Update Contact",
  assignAgentNode: "Assign Agent",
  httpRequestNode: "HTTP Request",
  endNode: "End Flow",
};

export interface CanvasNode {
  id: string;
  type: CanvasNodeType;
  position: { x: number; y: number };
  data: { label: string; config: Record<string, unknown> };
}

export interface CanvasEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string;
  label?: string;
}

export interface CanvasGraph {
  name?: string;
  nodes: CanvasNode[];
  edges: CanvasEdge[];
}

/** Hard cap so a runaway model can't produce a giant graph. */
const MAX_NODES = 25;
const MAX_EDGES = 40;

function isType(t: unknown): t is CanvasNodeType {
  return typeof t === "string" && (CANVAS_NODE_TYPES as readonly string[]).includes(t);
}

/**
 * Validate + coerce raw model JSON into a safe CanvasGraph. Throws (with a message
 * the caller feeds back on a silent retry) when the output cannot be salvaged.
 * On success the graph is guaranteed renderable: valid node types, referential
 * edges, exactly one trigger, laid-out positions, string ids.
 */
export function sanitizeFlowGraph(raw: unknown): CanvasGraph {
  if (!raw || typeof raw !== "object") throw new Error("output is not an object");
  const obj = raw as Record<string, unknown>;

  const rawNodes = Array.isArray(obj.nodes) ? obj.nodes : null;
  const rawEdges = Array.isArray(obj.edges) ? obj.edges : [];
  if (!rawNodes || rawNodes.length === 0) throw new Error("no nodes in output");
  if (rawNodes.length > MAX_NODES) throw new Error(`too many nodes (max ${MAX_NODES})`);

  const nodes: CanvasNode[] = [];
  const seenIds = new Set<string>();

  for (let i = 0; i < rawNodes.length; i++) {
    const n = rawNodes[i] as Record<string, unknown>;
    if (!n || typeof n !== "object") continue;
    if (!isType(n.type)) throw new Error(`invalid node type "${String(n.type)}"`);

    let id = typeof n.id === "string" && n.id.trim() ? n.id.trim() : `n${i + 1}`;
    while (seenIds.has(id)) id = `${id}_${i}`;
    seenIds.add(id);

    const pos = (n.position ?? {}) as { x?: unknown; y?: unknown };
    const data = (n.data ?? {}) as { label?: unknown; config?: unknown };
    const config =
      data.config && typeof data.config === "object" ? (data.config as Record<string, unknown>) : {};

    nodes.push({
      id,
      type: n.type,
      position: {
        x: Number.isFinite(Number(pos.x)) ? Number(pos.x) : 240,
        y: Number.isFinite(Number(pos.y)) ? Number(pos.y) : 60 + i * 130,
      },
      data: {
        label: typeof data.label === "string" && data.label.trim() ? data.label.trim() : DEFAULT_LABELS[n.type],
        config,
      },
    });
  }

  if (nodes.length === 0) throw new Error("no valid nodes after sanitizing");

  const triggers = nodes.filter((n) => n.type === "triggerNode");
  if (triggers.length !== 1) throw new Error(`need exactly one triggerNode, got ${triggers.length}`);

  // Keep only edges whose endpoints exist; drop the rest silently.
  const idSet = new Set(nodes.map((n) => n.id));
  const edges: CanvasEdge[] = [];
  for (let i = 0; i < rawEdges.length && edges.length < MAX_EDGES; i++) {
    const e = rawEdges[i] as Record<string, unknown>;
    if (!e || typeof e !== "object") continue;
    const source = typeof e.source === "string" ? e.source : "";
    const target = typeof e.target === "string" ? e.target : "";
    if (!idSet.has(source) || !idSet.has(target)) continue;
    edges.push({
      id: typeof e.id === "string" && e.id.trim() ? e.id.trim() : `e${i + 1}`,
      source,
      target,
      sourceHandle: e.sourceHandle === "true" || e.sourceHandle === "false" ? e.sourceHandle : undefined,
      label: typeof e.label === "string" ? e.label : undefined,
    });
  }

  return {
    name: typeof obj.name === "string" ? obj.name.trim().slice(0, 60) : undefined,
    nodes,
    edges,
  };
}

/**
 * Pull the natural-language intents a flow should match, from its trigger node.
 * Used by the runtime classifier. Falls back to keyword tokens so a flow built
 * purely by hand (no AI intents) still classifies sensibly.
 */
export function extractFlowIntents(flowData: unknown): string[] {
  const graph = flowData as { nodes?: CanvasNode[] } | null;
  const trigger = graph?.nodes?.find((n) => n?.type === "triggerNode");
  const cfg = (trigger?.data?.config ?? {}) as { intents?: unknown; keywords?: unknown };
  const phrases: string[] = [];
  if (Array.isArray(cfg.intents)) phrases.push(...cfg.intents.map((p) => String(p)).filter(Boolean));
  if (typeof cfg.keywords === "string") {
    phrases.push(...cfg.keywords.split(",").map((k) => k.trim()).filter(Boolean));
  }
  return phrases;
}
