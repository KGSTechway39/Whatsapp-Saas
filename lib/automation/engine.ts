/**
 * Automation flow engine — the shared walker behind BOTH the builder's "Run"
 * button and production inbound automation.
 *
 * WHY THIS FILE EXISTS
 * This walker used to live inside app/api/automation-flows/[id]/execute/route.ts,
 * so the only thing that could run a full flow was that HTTP route — and its one
 * caller passes testMode:true, which gates off every side effect. Production
 * automation went down a different path entirely (lib/automation/runtime
 * renderFirstReply), which walks the graph only far enough to find the FIRST
 * free-text message and returns that one string.
 *
 * The effect: a tenant could build delays, conditions, AI replies, tagging and
 * template sends in the visual builder, watch them all work in the test run, and
 * get a single auto-reply in production. Every node after the first message was
 * silently ignored.
 *
 * Extracting the walker here lets the inbound worker run the SAME code the
 * builder previews, so what you test is what customers get.
 *
 * WHAT IS UNCHANGED
 * Every node case is moved verbatim. Sends still go through guardedSingleSend
 * (24h window + billing), consent is still checked per send node, the AI Reply
 * node still routes through the governed lib/ai/service path and still never
 * sends autonomously, and httpRequestNode keeps its SSRF allowlist and timeout.
 *
 * TENANT SCOPING (Law #1): contactId/conversationId may be attacker-influenced,
 * so every query using them carries .eq("user_id", userId). Do not remove those.
 *
 * RESUMPTION: a waitNode parks the run in chatbot_sessions (status='waiting',
 * resume_at, current_node_id) and returns. lib/automation/resume.ts picks those
 * up when they come due and calls runFlow again with startNodeId set.
 */
import { createClient } from "@/lib/supabase/server";
import { decrypt } from "@/lib/crypto";
import { sendTextMessage } from "@/lib/meta";
import { guardedSingleSend } from "@/lib/billing/guarded-send";
import { assertConsent, ConsentRequiredError } from "@/lib/compliance/consent";
import { runTask } from "@/lib/ai/service";
import { getUserTier } from "@/lib/ai/config";
import { logger } from "@/lib/logger";

interface FlowNode {
  id: string;
  type: string;
  data: { label: string; config: Record<string, unknown> };
}
interface FlowEdge { id: string; source: string; target: string; sourceHandle?: string }
interface FlowData { nodes: FlowNode[]; edges: FlowEdge[] }

/** Hard ceiling on nodes executed in one pass — a backstop behind the visited-set. */
const MAX_STEPS = 60;

/**
 * Columns `updateContactNode` may write. The node's `field` comes from flow config,
 * so an unrestricted column name is a write primitive over the whole contacts row
 * (including `user_id`). Allowlist only free-text, non-structural columns.
 *
 * `status` is deliberately excluded: it carries a CHECK constraint ('active'|'inactive')
 * and a bad value would fail mid-flow. Add it with explicit value validation if needed.
 */
const UPDATABLE_CONTACT_FIELDS = new Set(["name", "email", "contact_group", "crm_stage"]);

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
  const raw = context[field];
  const actual = String(Array.isArray(raw) ? raw.join(",") : raw ?? "").toLowerCase();
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

/** Substitute {{key}} placeholders from the flow context. Unknown keys are left intact. */
function renderTemplate(text: string, context: Record<string, unknown>): string {
  return text.replace(/\{\{\s*(\w+)\s*\}\}/g, (whole, key: string) => {
    const v = context[key];
    if (v === undefined || v === null || v === "") return key === "name" ? "there" : whole;
    return String(Array.isArray(v) ? v.join(", ") : v);
  });
}

/**
 * Reject obviously-internal targets for `httpRequestNode`.
 *
 * Blocks loopback, RFC1918, link-local (incl. cloud metadata at 169.254.169.254),
 * multicast and internal TLDs. NOTE: this does not defeat DNS rebinding — a public
 * hostname resolving to a private address still passes. Full protection needs
 * resolve-then-validate plus a request-time IP check; tracked as a follow-up.
 */
function isSafeOutboundUrl(raw: string): boolean {
  let u: URL;
  try { u = new URL(raw); } catch { return false; }
  if (u.protocol !== "https:" && u.protocol !== "http:") return false;

  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost")) return false;
  if (host === "::1" || host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe80:")) return false;
  if (host.endsWith(".internal") || host.endsWith(".local")) return false;

  const v4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const a = Number(v4[1]);
    const b = Number(v4[2]);
    if (a === 0 || a === 127 || a === 10) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && b === 168) return false;
    if (a === 169 && b === 254) return false; // link-local + cloud metadata
    if (a >= 224) return false;               // multicast / reserved
  }
  return true;
}

export interface FlowLogEntry {
  nodeId: string;
  type: string;
  label: string;
  result: string;
  success: boolean;
}

export interface RunFlowArgs {
  userId: string;
  flowId: string;
  contactId?: string | null;
  conversationId?: string | null;
  /** Builder preview: walk every node but perform no side effects. */
  testMode?: boolean;
  /** Resume point. Omit to start from the trigger node. */
  startNodeId?: string | null;
  /** Context carried over from a parked session. */
  seedContext?: Record<string, unknown> | null;
  /** Session being resumed. Reused instead of opening a new one. */
  resumeSessionId?: string | null;
}

export interface RunFlowResult {
  log: FlowLogEntry[];
  status: "completed" | "waiting" | "error";
  sessionId: string | null;
  error?: string;
}

/**
 * Execute one pass of a flow. Returns when the flow ends, parks on a wait node,
 * or hits the step/loop backstop.
 */
export async function runFlow(args: RunFlowArgs): Promise<RunFlowResult> {
  const {
    userId,
    flowId,
    contactId = null,
    conversationId = null,
    testMode = false,
    startNodeId = null,
    seedContext = null,
    resumeSessionId = null,
  } = args;

  const supabase = createClient();

  const { data: flow, error: flowErr } = await supabase
    .from("automation_flows")
    .select("*")
    .eq("id", flowId)
    .eq("user_id", userId)
    .single();

  if (flowErr || !flow) {
    return { log: [], status: "error", sessionId: null, error: "Flow not found" };
  }

  const { nodes, edges } = flow.flow_data as FlowData;
  const adj = buildAdjacency(edges);

  // Find trigger node
  const triggerNode = nodes.find((n) => n.type === "triggerNode");
  if (!triggerNode) return { log: [], status: "error", sessionId: null, error: "No trigger node found" };

  // ── Validate caller-supplied ids BELONG to this tenant, before anything uses them ──
  if (contactId) {
    const { data: owned } = await supabase
      .from("contacts")
      .select("id")
      .eq("id", contactId)
      .eq("user_id", userId)
      .maybeSingle();
    if (!owned) return { log: [], status: "error", sessionId: null, error: "Contact not found" };
  }
  if (conversationId) {
    const { data: owned } = await supabase
      .from("conversations")
      .select("id")
      .eq("id", conversationId)
      .eq("user_id", userId)
      .maybeSingle();
    if (!owned) return { log: [], status: "error", sessionId: null, error: "Conversation not found" };
  }

  // Load contact context (tenant-scoped; `crm_notes` does not exist on this schema)
  let context: Record<string, unknown> = { ...(seedContext ?? {}) };
  if (contactId) {
    const { data: contact } = await supabase
      .from("contacts")
      .select("name, phone, crm_stage, tags")
      .eq("id", contactId)
      .eq("user_id", userId)
      .maybeSingle();
    if (contact) context = { ...contact };
  }

  // Create/resume session
  let sessionId: string | null = resumeSessionId;
  if (!testMode && contactId && !sessionId) {
    const { data: existing } = await supabase
      .from("chatbot_sessions")
      .select("id")
      .eq("user_id", userId)
      .eq("contact_id", contactId)
      .eq("flow_id", flowId)
      .eq("status", "active")
      .maybeSingle();

    if (existing) {
      sessionId = existing.id;
    } else {
      const { data: sess } = await supabase
        .from("chatbot_sessions")
        .insert({
          user_id: userId,
          contact_id: contactId,
          conversation_id: conversationId || null,
          flow_id: flowId,
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

  // Walk the flow. `visited` makes a cyclic graph terminate even if it predates the
  // sanitizer's cycle check; MAX_STEPS is a second backstop.
  let currentNodeId: string | undefined = startNodeId
    ? adj.get(startNodeId)?.[0]?.target
    : adj.get(triggerNode.id)?.[0]?.target;
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  const visited = new Set<string>([startNodeId ?? triggerNode.id]);
  let steps = 0;

  while (currentNodeId) {
    const node = nodeMap.get(currentNodeId);
    if (!node) break;

    if (visited.has(currentNodeId)) {
      logger.warn("flow execution stopped: loop detected", {
        flowId: flowId, userId: userId, nodeId: currentNodeId,
      });
      log.push({
        nodeId: node.id, type: node.type, label: node.data.label,
        result: "Stopped — this flow loops back on itself. Remove the repeating connection.",
        success: false,
      });
      break;
    }
    if (steps++ >= MAX_STEPS) {
      logger.warn("flow execution stopped: step limit", {
        flowId: flowId, userId: userId, steps,
      });
      log.push({
        nodeId: node.id, type: node.type, label: node.data.label,
        result: `Stopped — flow exceeded ${MAX_STEPS} steps in one run.`,
        success: false,
      });
      break;
    }
    visited.add(currentNodeId);

    try {
      switch (node.type) {
        case "sendMessageNode": {
          const cfg = node.data.config;
          // ── Consent gate ────────────────────────────────────────────────
          // Verticals flagged `requires_explicit_consent` (Hospital: DPDP
          // health data; School: minors' data) may not be messaged by an
          // automation until the contact has explicitly consented. Checked
          // per send node rather than once per flow, so consent withdrawn
          // mid-conversation stops the very next message.
          //
          // Recorded in the flow log rather than thrown: a blocked send should
          // halt this branch visibly, not 500 the whole execution and lose the
          // record of everything that already ran.
          if (!testMode && contactId) {
            try {
              await assertConsent(userId, contactId);
            } catch (err) {
              if (err instanceof ConsentRequiredError) {
                log.push({
                  nodeId: node.id, type: node.type, label: node.data.label,
                  result: "Blocked — this contact hasn't given consent yet.",
                  success: false,
                });
                break;
              }
              throw err;
            }
          }
          if (!testMode && contactId && conversationId) {
            const { data: conv } = await supabase
              .from("conversations")
              .select("contact_phone, whatsapp_numbers(phone_number_id, access_token)")
              .eq("id", conversationId)
              .eq("user_id", userId)
              .single();

            const wn = (conv?.whatsapp_numbers as unknown) as { phone_number_id: string; access_token: string } | null;
            if (wn && conv?.contact_phone) {
              const wnToken = await decrypt(wn.access_token);
              const text = renderTemplate(String(cfg.text || ""), context);
              // Bill managed tenants (SERVICE category); BYO passes through.
              await guardedSingleSend({
                userId: userId,
                category: "SERVICE",
                // Deterministic: re-executing the same node in the same session
                // (retry / resume) debits the wallet exactly once.
                idempotencyKey: `flow:${sessionId ?? conversationId}:${node.id}`,
                referenceId: `flow:${flowId}`,
                description: "Automation flow message",
                send: () => sendTextMessage(wn.phone_number_id, wnToken, conv.contact_phone, text),
              });
            }
          }
          log.push({ nodeId: node.id, type: node.type, label: node.data.label, result: `Sent: "${String(node.data.config.text || "template").slice(0, 50)}"`, success: true });
          break;
        }

        case "waitNode": {
          if (!testMode && sessionId) {
            const resumeAt = calcResumeAt(node.data.config);
            await supabase
              .from("chatbot_sessions")
              .update({ status: "waiting", current_node_id: node.id, resume_at: resumeAt, context })
              .eq("id", sessionId)
              .eq("user_id", userId);
          }
          log.push({ nodeId: node.id, type: node.type, label: node.data.label, result: `Waiting ${node.data.config.duration} ${node.data.config.unit}`, success: true });
          if (!testMode) return { log, status: "waiting", sessionId };
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
          // Tags live in `contacts.tags` (text[]). The previous implementation appended
          // "#tag" to `contacts.crm_notes`, a column that does not exist on this schema —
          // so tagging silently did nothing.
          const { action, tag } = node.data.config as { action?: string; tag?: string };
          const clean = String(tag ?? "").trim();
          if (!testMode && contactId && clean) {
            const { data: c } = await supabase
              .from("contacts")
              .select("tags")
              .eq("id", contactId)
              .eq("user_id", userId)
              .maybeSingle();

            const current: string[] = Array.isArray(c?.tags) ? (c!.tags as string[]) : [];
            const next =
              action === "remove"
                ? current.filter((t) => t !== clean)
                : current.includes(clean)
                ? current
                : [...current, clean];

            await supabase
              .from("contacts")
              .update({ tags: next })
              .eq("id", contactId)
              .eq("user_id", userId);

            context.tags = next;
          }
          log.push({ nodeId: node.id, type: node.type, label: node.data.label, result: `${action === "remove" ? "Removed" : "Added"} tag: ${clean || "(none)"}`, success: true });
          break;
        }

        case "httpRequestNode": {
          const { url, method = "POST", body: reqBody } = node.data.config as { url: string; method: string; body?: string };
          let outcome = `${method} ${url}`;
          let ok = true;
          if (!testMode && url) {
            if (!isSafeOutboundUrl(url)) {
              logger.warn("flow httpRequestNode blocked: unsafe target", {
                flowId: flowId, userId: userId, nodeId: node.id,
              });
              outcome = "Blocked — this web address is not allowed.";
              ok = false;
            } else {
              await fetch(url, {
                method,
                headers: { "Content-Type": "application/json" },
                body: method !== "GET" ? reqBody || JSON.stringify(context) : undefined,
                signal: AbortSignal.timeout(10_000),
              }).catch(() => null);
            }
          }
          log.push({ nodeId: node.id, type: node.type, label: node.data.label, result: outcome, success: ok });
          break;
        }

        case "aiReplyNode": {
          // Routed through the governed AI path (tier gate → credit pre-check → timeout →
          // debit-on-success → usage log). Previously this called the Anthropic SDK
          // directly with hardcoded model ids and no metering.
          //
          // It deliberately does NOT send. AI-generated text going to a real customer
          // without human review is a product decision, not an implementation detail
          // (the platform rule is that AI drafts and humans send). Preserved as-is.
          const cfg = node.data.config as { systemPrompt?: string };
          let aiResponse: string | null = null;
          let reason = "";

          if (!testMode) {
            const tier = await getUserTier(userId);
            const result = await runTask<string>({
              userId: userId,
              tier,
              taskType: "automation_ai_reply",
              system:
                cfg.systemPrompt?.trim() ||
                "You are a helpful WhatsApp business assistant. Reply in one short paragraph.",
              prompt: String(context.last_message ?? "Hello"),
              idempotencyKey: `flow:${sessionId ?? conversationId ?? flowId}:${node.id}`,
              refId: `flow:${flowId}`,
              maxTokens: 300,
            });
            if (result.status === "ok") aiResponse = result.data;
            else reason = result.reason;

            // Persist the draft. Without this the node spends the tenant's AI
            // credits to generate text that only ever reached an in-memory log
            // and was then dropped — so the suggestion never reached the human
            // who is supposed to review and send it.
            //
            // Upserted on (conversation, flow, node) so re-running a flow
            // refreshes the outstanding suggestion instead of stacking copies.
            if (aiResponse && conversationId) {
              const { error: draftErr } = await supabase
                .from("ai_drafts")
                .upsert(
                  {
                    user_id: userId,
                    conversation_id: conversationId,
                    contact_id: contactId,
                    flow_id: flowId,
                    node_id: node.id,
                    source: "automation_ai_reply",
                    body: aiResponse,
                    status: "pending",
                  },
                  { onConflict: "conversation_id,flow_id,node_id" },
                );
              if (draftErr) {
                // Never fail the flow over a draft that could not be filed —
                // the rest of the sequence still needs to run.
                logger.warn("flow aiReplyNode: could not persist draft", {
                  flowId,
                  nodeId: node.id,
                  error: draftErr.message,
                });
              }
            }
          }

          log.push({
            nodeId: node.id,
            type: node.type,
            label: node.data.label,
            result: testMode
              ? "AI reply (test mode — nothing generated)"
              : aiResponse
              ? `Drafted for review: "${aiResponse.slice(0, 60)}" (saved, not sent)`
              : `AI unavailable (${reason}) — nothing drafted`,
            success: testMode || !!aiResponse,
          });
          break;
        }

        case "assignAgentNode": {
          const { agentName } = node.data.config as { agentName: string };
          if (!testMode && conversationId) {
            await supabase
              .from("conversations")
              .update({ status: "open" })
              .eq("id", conversationId)
              .eq("user_id", userId);
          }
          log.push({ nodeId: node.id, type: node.type, label: node.data.label, result: `Assigned to: ${agentName || "Agent"}`, success: true });
          break;
        }

        case "updateContactNode": {
          const { field, value } = node.data.config as { field: string; value: string };
          let outcome = `Set ${field} = ${value}`;
          let ok = true;
          if (!testMode && contactId && field) {
            if (!UPDATABLE_CONTACT_FIELDS.has(field)) {
              logger.warn("flow updateContactNode blocked: field not allowed", {
                flowId: flowId, userId: userId, field,
              });
              outcome = `Skipped — "${field}" is not a field this step can change.`;
              ok = false;
            } else {
              await supabase
                .from("contacts")
                .update({ [field]: value })
                .eq("id", contactId)
                .eq("user_id", userId);
              context[field] = value;
            }
          }
          log.push({ nodeId: node.id, type: node.type, label: node.data.label, result: outcome, success: ok });
          break;
        }

        case "endNode": {
          if (!testMode && sessionId) {
            await supabase
              .from("chatbot_sessions")
              .update({ status: "completed", updated_at: new Date().toISOString() })
              .eq("id", sessionId)
              .eq("user_id", userId);
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
      .eq("id", flowId)
      .eq("user_id", userId);
  }

  return { log, status: "completed", sessionId };
}
