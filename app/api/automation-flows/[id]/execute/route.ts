import { createClient } from "@/lib/supabase/server";
import { getSessionUser } from "@/lib/auth";
import { NextRequest, NextResponse } from "next/server";
import { sendTextMessage } from "@/lib/meta";

interface FlowNode {
  id: string;
  type: string;
  data: { label: string; config: Record<string, unknown> };
}
interface FlowEdge { id: string; source: string; target: string; sourceHandle?: string }
interface FlowData { nodes: FlowNode[]; edges: FlowEdge[] }

// Build source → [target, ...] adjacency map
function buildAdjacency(edges: FlowEdge[]): Map<string, { target: string; handle?: string }[]> {
  const map = new Map<string, { target: string; handle?: string }[]>();
  for (const e of edges) {
    if (!map.has(e.source)) map.set(e.source, []);
    map.get(e.source)!.push({ target: e.target, handle: e.sourceHandle });
  }
  return map;
}

function evaluateCondition(config: Record<string, unknown>, context: Record<string, unknown>): boolean {
  const { field, operator, value } = config as { field: string; operator: string; value: string };
  const actual = String(context[field] ?? "").toLowerCase();
  const expected = String(value ?? "").toLowerCase();
  switch (operator) {
    case "equals":      return actual === expected;
    case "not_equals":  return actual !== expected;
    case "contains":    return actual.includes(expected);
    case "starts_with": return actual.startsWith(expected);
    case "is_set":      return !!actual;
    case "is_not_set":  return !actual;
    default:            return false;
  }
}

function calcResumeAt(config: Record<string, unknown>): string {
  const duration = Number(config.duration) || 1;
  const unit = String(config.unit || "hours");
  const ms = unit === "minutes" ? duration * 60_000
           : unit === "days"    ? duration * 86_400_000
           :                      duration * 3_600_000;
  return new Date(Date.now() + ms).toISOString();
}

// POST /api/automation-flows/[id]/execute
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const supabase = createClient();
  const { contactId, conversationId, testMode = false } = await req.json();

  // Load flow
  const { data: flow, error: flowErr } = await supabase
    .from("automation_flows")
    .select("*")
    .eq("id", params.id)
    .eq("user_id", user.id)
    .single();

  if (flowErr || !flow) return NextResponse.json({ error: "Flow not found" }, { status: 404 });

  const { nodes, edges } = flow.flow_data as FlowData;
  const adj = buildAdjacency(edges);

  // Find trigger node
  const triggerNode = nodes.find((n) => n.type === "triggerNode");
  if (!triggerNode) return NextResponse.json({ error: "No trigger node found" }, { status: 400 });

  // Load contact context
  let context: Record<string, unknown> = {};
  if (contactId) {
    const { data: contact } = await supabase
      .from("contacts")
      .select("name, phone, crm_stage, crm_notes")
      .eq("id", contactId)
      .single();
    if (contact) context = { ...contact };
  }

  // Create/resume session
  let sessionId: string | null = null;
  if (!testMode && contactId) {
    const { data: existing } = await supabase
      .from("chatbot_sessions")
      .select("id")
      .eq("contact_id", contactId)
      .eq("flow_id", params.id)
      .eq("status", "active")
      .maybeSingle();

    if (existing) {
      sessionId = existing.id;
    } else {
      const { data: sess } = await supabase
        .from("chatbot_sessions")
        .insert({
          user_id: user.id,
          contact_id: contactId,
          conversation_id: conversationId || null,
          flow_id: params.id,
          current_node_id: triggerNode.id,
          status: "active",
          context,
        })
        .select("id")
        .single();
      sessionId = sess?.id ?? null;
    }
  }

  // Execution log
  const log: { nodeId: string; type: string; label: string; result: string; success: boolean }[] = [];

  // Walk the flow
  let currentNodeId: string | undefined = adj.get(triggerNode.id)?.[0]?.target;
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));

  while (currentNodeId) {
    const node = nodeMap.get(currentNodeId);
    if (!node) break;

    try {
      switch (node.type) {
        case "sendMessageNode": {
          const cfg = node.data.config;
          if (!testMode && contactId && conversationId) {
            const { data: conv } = await supabase
              .from("conversations")
              .select("contact_phone, whatsapp_numbers(phone_number_id, access_token)")
              .eq("id", conversationId)
              .single();

            const wn = (conv?.whatsapp_numbers as unknown) as { phone_number_id: string; access_token: string } | null;
            if (wn && conv?.contact_phone) {
              const text = String(cfg.text || "").replace(/\{\{name\}\}/g, String(context.name || "there"));
              await sendTextMessage(wn.phone_number_id, wn.access_token, conv.contact_phone, text);
            }
          }
          log.push({ nodeId: node.id, type: node.type, label: node.data.label, result: `Sent: "${String(node.data.config.text || "template").slice(0, 50)}"`, success: true });
          break;
        }

        case "waitNode": {
          if (!testMode && sessionId) {
            const resumeAt = calcResumeAt(node.data.config);
            await supabase.from("chatbot_sessions").update({ status: "waiting", current_node_id: node.id, resume_at: resumeAt, context }).eq("id", sessionId);
          }
          log.push({ nodeId: node.id, type: node.type, label: node.data.label, result: `Waiting ${node.data.config.duration} ${node.data.config.unit}`, success: true });
          if (!testMode) return NextResponse.json({ log, status: "waiting" });
          break;
        }

        case "conditionNode": {
          const met = evaluateCondition(node.data.config, context);
          log.push({ nodeId: node.id, type: node.type, label: node.data.label, result: `Condition ${met ? "TRUE" : "FALSE"}`, success: true });
          const next = adj.get(node.id)?.find((e) => e.handle === (met ? "true" : "false"));
          currentNodeId = next?.target;
          continue;
        }

        case "addTagNode": {
          const { action, tag } = node.data.config as { action: string; tag: string };
          if (!testMode && contactId && tag) {
            const { data: contact } = await supabase.from("contacts").select("crm_notes").eq("id", contactId).single();
            const notes = String(contact?.crm_notes || "");
            const marker = `#${tag}`;
            if (action === "add" && !notes.includes(marker)) {
              await supabase.from("contacts").update({ crm_notes: `${notes} ${marker}`.trim() }).eq("id", contactId);
            } else if (action === "remove") {
              await supabase.from("contacts").update({ crm_notes: notes.replace(marker, "").trim() }).eq("id", contactId);
            }
          }
          log.push({ nodeId: node.id, type: node.type, label: node.data.label, result: `${action === "add" ? "Added" : "Removed"} tag: #${tag}`, success: true });
          break;
        }

        case "httpRequestNode": {
          const { url, method = "POST", body: reqBody } = node.data.config as { url: string; method: string; body?: string };
          if (!testMode && url) {
            await fetch(url, {
              method,
              headers: { "Content-Type": "application/json" },
              body: method !== "GET" ? reqBody || JSON.stringify(context) : undefined,
            }).catch(() => null);
          }
          log.push({ nodeId: node.id, type: node.type, label: node.data.label, result: `${method} ${url}`, success: true });
          break;
        }

        case "aiReplyNode": {
          const { systemPrompt, model = "claude" } = node.data.config as { systemPrompt: string; model: string };
          let aiResponse = "[AI response would appear here]";
          if (!testMode && process.env.ANTHROPIC_API_KEY) {
            try {
              const { default: Anthropic } = await import("@anthropic-ai/sdk");
              const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
              const msg = await client.messages.create({
                model: model === "claude" ? "claude-sonnet-4-5-20251001" : "claude-haiku-4-5-20251001",
                max_tokens: 300,
                system: systemPrompt || "You are a helpful WhatsApp business assistant.",
                messages: [{ role: "user", content: String(context.last_message || "Hello") }],
              });
              aiResponse = (msg.content[0] as { type: string; text: string }).text ?? aiResponse;
            } catch { /* fallback to placeholder */ }
          }
          log.push({ nodeId: node.id, type: node.type, label: node.data.label, result: `AI: "${aiResponse.slice(0, 60)}"`, success: true });
          break;
        }

        case "assignAgentNode": {
          const { agentName } = node.data.config as { agentName: string };
          if (!testMode && conversationId) {
            await supabase.from("conversations").update({ status: "open" }).eq("id", conversationId);
          }
          log.push({ nodeId: node.id, type: node.type, label: node.data.label, result: `Assigned to: ${agentName || "Agent"}`, success: true });
          break;
        }

        case "updateContactNode": {
          const { field, value } = node.data.config as { field: string; value: string };
          if (!testMode && contactId && field) {
            await supabase.from("contacts").update({ [field]: value }).eq("id", contactId);
          }
          log.push({ nodeId: node.id, type: node.type, label: node.data.label, result: `Set ${field} = ${value}`, success: true });
          break;
        }

        case "endNode": {
          if (!testMode && sessionId) {
            await supabase.from("chatbot_sessions").update({ status: "completed", updated_at: new Date().toISOString() }).eq("id", sessionId);
          }
          log.push({ nodeId: node.id, type: node.type, label: node.data.label, result: "Flow completed", success: true });
          currentNodeId = undefined;
          continue;
        }

        default:
          log.push({ nodeId: node.id, type: node.type, label: node.data.label, result: "Skipped (unhandled)", success: true });
      }
    } catch (err) {
      log.push({ nodeId: node.id, type: node.type, label: node.data.label, result: err instanceof Error ? err.message : "Error", success: false });
    }

    // Advance to next node
    currentNodeId = adj.get(node.id)?.[0]?.target;
  }

  // Update trigger count
  if (!testMode) {
    await supabase.from("automation_flows")
      .update({ trigger_count: (flow.trigger_count || 0) + 1, last_triggered: new Date().toISOString() })
      .eq("id", params.id);
  }

  return NextResponse.json({ log, status: "completed", sessionId });
}
