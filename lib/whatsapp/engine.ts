/**
 * Flow Automation Parser Engine
 *
 * Given an inbound message from Meta (text or interactive reply), this
 * engine resolves the tenant, finds the contact's running flow (or starts
 * a new one), advances the cursor, and emits the outbound Meta Graph
 * payload for the next node.
 *
 * Multi-tenant: every read/write is scoped via `whatsapp_accounts.phone_number_id`
 *               → organization_id. Contacts are uniquely (org_id, phone).
 *
 * Storage:
 *   - automation_flows.flow_data = { nodes: FlowNode[], edges: FlowEdge[] }
 *   - chatbot_sessions tracks (contact_id, automation_flow_id, current_node_id, session_data)
 *
 * The engine never sends to Meta itself — it returns a payload that the
 * caller (worker or API route) hands to `lib/whatsapp/sender.ts`.
 */

import { createServiceClient } from "@/lib/supabase/server";
import { logger } from "@/lib/logger";

// ─── Flow data model ──────────────────────────────────────────────────────

export type FlowNodeType =
  | "trigger"          // entry point (keyword / welcome / webhook)
  | "send_template"    // outbound HSM template
  | "send_text"        // outbound free-form text (only within 24h window)
  | "send_interactive" // outbound quick-reply / list message
  | "condition"        // branch on session_data / contact fields
  | "wait"             // pause for N seconds then continue
  | "set_variable"     // mutate session_data
  | "handover"         // assign to human agent
  | "end";             // flow complete

export interface FlowNode {
  id: string;
  type: FlowNodeType;
  data: {
    label?: string;
    config: Record<string, unknown>;
  };
}

export interface FlowEdge {
  id: string;
  source: string;
  target: string;
  /** For condition / interactive nodes — matches button id or "true"/"false". */
  sourceHandle?: string;
  /** Optional payload-id match for quick-reply / list buttons. */
  payloadId?: string;
}

export interface FlowGraph {
  nodes: FlowNode[];
  edges: FlowEdge[];
}

// ─── Incoming + outbound shapes ───────────────────────────────────────────

export type IncomingPayload =
  | { kind: "text";   text: string }
  | { kind: "button"; buttonId: string; text: string }
  | { kind: "list";   listId:   string; text: string };

export type OutboundPayload =
  | TextMessage
  | TemplateMessage
  | InteractiveMessage
  | null; // null = nothing to send (e.g., wait node)

interface BaseMessage {
  messaging_product: "whatsapp";
  recipient_type: "individual";
  to: string;
}

export interface TextMessage extends BaseMessage {
  type: "text";
  text: { body: string; preview_url?: boolean };
}

export interface TemplateMessage extends BaseMessage {
  type: "template";
  template: {
    name: string;
    language: { code: string };
    components?: unknown[];
  };
}

export interface InteractiveMessage extends BaseMessage {
  type: "interactive";
  interactive:
    | {
        type: "button";
        body: { text: string };
        action: { buttons: { type: "reply"; reply: { id: string; title: string } }[] };
      }
    | {
        type: "list";
        body: { text: string };
        action: {
          button: string;
          sections: { title: string; rows: { id: string; title: string; description?: string }[] }[];
        };
      };
}

// ─── Engine entry point ───────────────────────────────────────────────────

export interface ProcessIncomingArgs {
  phoneNumberId: string;
  fromPhone: string;
  incoming: IncomingPayload;
  eventId: string;
  receivedAt: number;
}

export interface ProcessResult {
  matched: boolean;
  flowId?: string;
  sessionId?: string;
  nextNodeId?: string;
  outbound?: OutboundPayload;
  reason?: string;
}

/**
 * Execution loop: given an incoming message, advance one step of the
 * matching flow and return the outbound Meta payload (if any).
 *
 * Steps:
 *   1. Resolve tenant (organization) from phone_number_id.
 *   2. Upsert contact (organization_id, phone).
 *   3. Find the contact's active chatbot_session OR find a flow whose
 *      trigger matches the incoming text/payload.
 *   4. Walk one edge from the current node → pick the next node.
 *   5. Render the next node into a Meta Graph API payload.
 *   6. Persist the cursor (current_node_id) on the session.
 */
export async function processIncomingMessage(
  args: ProcessIncomingArgs,
): Promise<ProcessResult> {
  const supabase = createServiceClient();

  // 1) Resolve org from the receiving phone number
  const { data: account, error: acctErr } = await supabase
    .from("whatsapp_accounts")
    .select("id, organization_id")
    .eq("phone_number_id", args.phoneNumberId)
    .maybeSingle();

  if (acctErr || !account) {
    logger.warn("engine: unknown phone_number_id", {
      phoneNumberId: args.phoneNumberId,
      err: acctErr?.message,
    });
    return { matched: false, reason: "unknown_phone_number_id" };
  }

  // 2) Upsert contact (org_id, phone) unique
  const contact = await upsertContact(supabase, account.organization_id, args.fromPhone);
  if (!contact) return { matched: false, reason: "contact_upsert_failed" };

  // 3) Active session, or trigger-match a new one
  let session = await getActiveSession(supabase, contact.id);
  let flow: FlowRow | null = session
    ? await loadFlow(supabase, session.automation_flow_id)
    : null;

  if (!session || !flow) {
    flow = await findMatchingFlow(supabase, account.organization_id, args.incoming);
    if (!flow) {
      logger.info("engine: no flow match", {
        orgId: account.organization_id,
        contactId: contact.id,
        incoming: args.incoming.kind,
      });
      return { matched: false, reason: "no_flow_match" };
    }
    session = await openSession(supabase, flow.id, contact.id);
  }

  // 4) Walk one edge
  const graph = (flow.flow_data ?? { nodes: [], edges: [] }) as FlowGraph;
  const currentNode = graph.nodes.find((n) => n.id === session!.current_node_id);
  if (!currentNode) {
    logger.warn("engine: current_node_id missing in graph", {
      sessionId: session.id,
      currentNodeId: session.current_node_id,
    });
    await closeSession(supabase, session.id, "expired");
    return { matched: false, reason: "stale_session" };
  }

  const nextNode = pickNextNode(graph, currentNode, args.incoming);
  if (!nextNode) {
    logger.info("engine: no outgoing edge matched", {
      sessionId: session.id,
      currentNodeId: currentNode.id,
      incoming: args.incoming,
    });
    return {
      matched: true,
      flowId: flow.id,
      sessionId: session.id,
      reason: "no_matching_edge",
    };
  }

  // 5) Render outbound payload
  const outbound = renderNode(nextNode, args.fromPhone);

  // 6) Persist cursor (or close on `end`)
  if (nextNode.type === "end") {
    await closeSession(supabase, session.id, "completed");
    await supabase
      .from("automation_flows")
      .update({ total_completed: (flow.total_completed ?? 0) + 1 })
      .eq("id", flow.id);
  } else {
    await supabase
      .from("chatbot_sessions")
      .update({
        current_node_id: nextNode.id,
        updated_at: new Date().toISOString(),
      })
      .eq("id", session.id);
  }

  logger.info("engine: advanced session", {
    orgId: account.organization_id,
    flowId: flow.id,
    sessionId: session.id,
    from: currentNode.id,
    to: nextNode.id,
  });

  return {
    matched: true,
    flowId: flow.id,
    sessionId: session.id,
    nextNodeId: nextNode.id,
    outbound,
  };
}

// ─── DB helpers (typed) ──────────────────────────────────────────────────

type SupabaseClient = ReturnType<typeof createServiceClient>;

interface ContactRow { id: string; organization_id: string }
interface SessionRow {
  id: string;
  automation_flow_id: string;
  contact_id: string;
  current_node_id: string | null;
  status: string;
  session_data: Record<string, unknown>;
}
interface FlowRow {
  id: string;
  organization_id: string;
  name: string;
  trigger_type: string;
  trigger_config: Record<string, unknown>;
  flow_data: FlowGraph;
  is_active: boolean;
  total_completed: number;
}

async function upsertContact(
  supabase: SupabaseClient,
  organizationId: string,
  phone: string,
): Promise<ContactRow | null> {
  const { data: existing } = await supabase
    .from("contacts")
    .select("id, organization_id")
    .eq("organization_id", organizationId)
    .eq("phone", phone)
    .maybeSingle();

  if (existing) return existing as ContactRow;

  const { data: inserted, error } = await supabase
    .from("contacts")
    .insert({
      organization_id: organizationId,
      phone,
      source: "webhook",
      opt_in_status: "opted_in",
    })
    .select("id, organization_id")
    .single();

  if (error) {
    logger.warn("engine: contact insert failed", { phone, err: error.message });
    return null;
  }
  return inserted as ContactRow;
}

async function getActiveSession(
  supabase: SupabaseClient,
  contactId: string,
): Promise<SessionRow | null> {
  const { data } = await supabase
    .from("chatbot_sessions")
    .select("id, automation_flow_id, contact_id, current_node_id, status, session_data")
    .eq("contact_id", contactId)
    .eq("status", "active")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as SessionRow) ?? null;
}

async function loadFlow(
  supabase: SupabaseClient,
  flowId: string,
): Promise<FlowRow | null> {
  const { data } = await supabase
    .from("automation_flows")
    .select("id, organization_id, name, trigger_type, trigger_config, flow_data, is_active, total_completed")
    .eq("id", flowId)
    .eq("is_active", true)
    .maybeSingle();
  return (data as FlowRow) ?? null;
}

async function findMatchingFlow(
  supabase: SupabaseClient,
  organizationId: string,
  incoming: IncomingPayload,
): Promise<FlowRow | null> {
  const { data: flows } = await supabase
    .from("automation_flows")
    .select("id, organization_id, name, trigger_type, trigger_config, flow_data, is_active, total_completed")
    .eq("organization_id", organizationId)
    .eq("is_active", true);

  if (!flows?.length) return null;

  for (const row of flows as FlowRow[]) {
    if (matchesTrigger(row, incoming)) return row;
  }
  return null;
}

function matchesTrigger(flow: FlowRow, incoming: IncomingPayload): boolean {
  if (flow.trigger_type === "keyword") {
    if (incoming.kind !== "text") return false;
    const cfg = flow.trigger_config as { keywords?: string[] | string };
    const list = Array.isArray(cfg.keywords)
      ? cfg.keywords
      : typeof cfg.keywords === "string"
      ? cfg.keywords.split(",").map((k) => k.trim())
      : [];
    const normalized = incoming.text.trim().toLowerCase();
    return list.some((k) => k && normalized.includes(k.toLowerCase()));
  }

  if (flow.trigger_type === "welcome") return true;

  if (flow.trigger_type === "webhook") {
    // External webhook triggers fire elsewhere; not from inbound message.
    return false;
  }

  return false;
}

async function openSession(
  supabase: SupabaseClient,
  flowId: string,
  contactId: string,
): Promise<SessionRow> {
  const { data: flow } = await supabase
    .from("automation_flows")
    .select("flow_data, total_triggered")
    .eq("id", flowId)
    .single();

  const graph = (flow?.flow_data ?? { nodes: [], edges: [] }) as FlowGraph;
  const trigger = graph.nodes.find((n) => n.type === "trigger") ?? graph.nodes[0];

  const { data: inserted, error } = await supabase
    .from("chatbot_sessions")
    .insert({
      automation_flow_id: flowId,
      contact_id: contactId,
      current_node_id: trigger?.id ?? null,
      status: "active",
      session_data: {},
    })
    .select("id, automation_flow_id, contact_id, current_node_id, status, session_data")
    .single();

  if (error || !inserted) {
    throw new Error(`engine: open_session failed — ${error?.message}`);
  }

  await supabase
    .from("automation_flows")
    .update({ total_triggered: (flow?.total_triggered ?? 0) + 1 })
    .eq("id", flowId);

  return inserted as SessionRow;
}

async function closeSession(
  supabase: SupabaseClient,
  sessionId: string,
  status: "completed" | "expired" | "handed_over",
): Promise<void> {
  await supabase
    .from("chatbot_sessions")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("id", sessionId);
}

// ─── Graph traversal ─────────────────────────────────────────────────────

function pickNextNode(
  graph: FlowGraph,
  current: FlowNode,
  incoming: IncomingPayload,
): FlowNode | null {
  const candidates = graph.edges.filter((e) => e.source === current.id);
  if (!candidates.length) return null;

  // 1) Exact payload-id match (quick-reply / list buttons)
  if (incoming.kind === "button" || incoming.kind === "list") {
    const id = incoming.kind === "button" ? incoming.buttonId : incoming.listId;
    const match =
      candidates.find((e) => e.payloadId === id) ??
      candidates.find((e) => e.sourceHandle === id);
    if (match) {
      return graph.nodes.find((n) => n.id === match.target) ?? null;
    }
  }

  // 2) Condition node: evaluate `true`/`false` handles
  if (current.type === "condition") {
    const cfg = current.data.config as {
      field?: string;
      operator?: "equals" | "contains" | "gt" | "lt";
      value?: string | number;
    };
    const subject =
      incoming.kind === "text"
        ? incoming.text
        : incoming.kind === "button"
        ? incoming.buttonId
        : incoming.listId;
    const result = evaluateCondition(subject, cfg);
    const branch = candidates.find((e) => e.sourceHandle === (result ? "true" : "false"));
    if (branch) return graph.nodes.find((n) => n.id === branch.target) ?? null;
  }

  // 3) Default — first unlabeled outgoing edge
  const fallback = candidates.find((e) => !e.sourceHandle) ?? candidates[0];
  return graph.nodes.find((n) => n.id === fallback.target) ?? null;
}

function evaluateCondition(
  subject: string,
  cfg: { operator?: "equals" | "contains" | "gt" | "lt"; value?: string | number },
): boolean {
  if (!cfg.operator || cfg.value === undefined) return false;
  const v = String(cfg.value).toLowerCase();
  const s = String(subject).toLowerCase();
  switch (cfg.operator) {
    case "equals":   return s === v;
    case "contains": return s.includes(v);
    case "gt":       return Number(subject) >  Number(cfg.value);
    case "lt":       return Number(subject) <  Number(cfg.value);
    default:         return false;
  }
}

// ─── Node renderer → Meta Graph API JSON ─────────────────────────────────

function renderNode(node: FlowNode, to: string): OutboundPayload {
  const base = { messaging_product: "whatsapp", recipient_type: "individual", to } as const;
  const cfg = node.data.config ?? {};

  switch (node.type) {
    case "send_text": {
      const text = String((cfg as { text?: string }).text ?? "").trim();
      if (!text) return null;
      return { ...base, type: "text", text: { body: text, preview_url: false } };
    }

    case "send_template": {
      const c = cfg as {
        templateName?: string;
        languageCode?: string;
        components?: unknown[];
      };
      if (!c.templateName) return null;
      return {
        ...base,
        type: "template",
        template: {
          name: c.templateName,
          language: { code: c.languageCode ?? "en" },
          components: c.components ?? [],
        },
      };
    }

    case "send_interactive": {
      const c = cfg as {
        kind?: "button" | "list";
        body?: string;
        buttons?: { id: string; title: string }[];
        list?: {
          buttonLabel: string;
          sections: { title: string; rows: { id: string; title: string; description?: string }[] }[];
        };
      };
      const body = c.body?.trim();
      if (!body) return null;

      if (c.kind === "list" && c.list) {
        return {
          ...base,
          type: "interactive",
          interactive: {
            type: "list",
            body: { text: body },
            action: {
              button: c.list.buttonLabel || "Choose",
              sections: c.list.sections,
            },
          },
        };
      }

      const buttons = (c.buttons ?? []).slice(0, 3);
      if (!buttons.length) return null;
      return {
        ...base,
        type: "interactive",
        interactive: {
          type: "button",
          body: { text: body },
          action: {
            buttons: buttons.map((b) => ({
              type: "reply",
              reply: { id: b.id, title: b.title },
            })),
          },
        },
      };
    }

    case "wait":
    case "set_variable":
    case "handover":
    case "condition":
    case "trigger":
    case "end":
    default:
      return null;
  }
}
