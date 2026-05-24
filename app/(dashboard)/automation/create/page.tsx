"use client";

import "@xyflow/react/dist/style.css";

import {
  ReactFlow, ReactFlowProvider, Background, BackgroundVariant, Controls,
  MiniMap, useNodesState, useEdgesState, addEdge, useReactFlow,
  type Connection, type Node, type Edge,
} from "@xyflow/react";
import {
  nodeTypes, NODE_CATALOGUE, DEFAULT_CONFIGS, DEFAULT_LABELS,
  type FlowNodeData,
} from "@/components/automation/FlowNodes";
import {
  Save, Play, Zap, ChevronLeft, X, Trash2, Copy, Check,
  Loader2, ToggleLeft, ToggleRight, Info, Terminal,
} from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState, Suspense } from "react";
import { toast } from "sonner";

// ─── Node Config Panel ────────────────────────────────────────────────────────

interface Template { id: string; name: string; display_name: string; body: string }

function NodeConfigPanel({
  node,
  onUpdate,
  onClose,
  onDelete,
}: {
  node: Node & { data: FlowNodeData };
  onUpdate: (id: string, cfg: Record<string, unknown>, label?: string) => void;
  onClose: () => void;
  onDelete: (id: string) => void;
}) {
  const [templates, setTemplates] = useState<Template[]>([]);
  const cfg = node.data.config;

  const set = (key: string, val: unknown) =>
    onUpdate(node.id, { ...cfg, [key]: val });

  useEffect(() => {
    if (node.type === "sendMessageNode") {
      fetch("/api/templates").then((r) => r.json()).then((d) => setTemplates(d.templates || [])).catch(() => {});
    }
  }, [node.type]);

  const inputCls = "w-full bg-[#202c33] border border-white/10 rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-primary/60 focus:ring-1 focus:ring-primary/30 transition-all placeholder:text-white/30";
  const labelCls = "text-xs font-medium text-white/50 uppercase tracking-wide block mb-1.5";

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/8 flex-shrink-0">
        <p className="text-sm font-semibold text-white truncate pr-2">{node.data.label || "Configure Node"}</p>
        <div className="flex items-center gap-1 flex-shrink-0">
          <button
            onClick={() => onDelete(node.id)}
            className="p-1.5 rounded-lg hover:bg-red-500/20 text-red-400 transition-colors"
            title="Delete node"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-white/10 transition-colors">
            <X className="w-3.5 h-3.5 text-white/60" />
          </button>
        </div>
      </div>

      {/* Node label */}
      <div className="px-4 pt-4 pb-2 flex-shrink-0">
        <label className={labelCls}>Node Label</label>
        <input
          className={inputCls}
          value={node.data.label}
          onChange={(e) => onUpdate(node.id, cfg, e.target.value)}
        />
      </div>

      {/* Type-specific config */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">

        {/* ── Trigger ── */}
        {node.type === "triggerNode" && (
          <>
            <div>
              <label className={labelCls}>Trigger Type</label>
              <select className={inputCls} value={String(cfg.triggerType || "keyword")} onChange={(e) => set("triggerType", e.target.value)}>
                <option value="keyword">Keyword Match</option>
                <option value="new_contact">New Contact Added</option>
                <option value="webhook">Incoming Webhook</option>
                <option value="schedule">Schedule</option>
                <option value="contact_tagged">Contact Tagged</option>
                <option value="opt_in">Contact Opt-in</option>
              </select>
            </div>
            {cfg.triggerType === "keyword" && (
              <div>
                <label className={labelCls}>Keywords (comma-separated)</label>
                <input className={inputCls} value={String(cfg.keywords || "")} onChange={(e) => set("keywords", e.target.value)} placeholder="hello, hi, start, menu" />
                <p className="text-[11px] text-white/30 mt-1">Matches if message contains any keyword</p>
              </div>
            )}
            {cfg.triggerType === "contact_tagged" && (
              <div>
                <label className={labelCls}>Tag Name</label>
                <input className={inputCls} value={String(cfg.tagName || "")} onChange={(e) => set("tagName", e.target.value)} placeholder="vip-customer" />
              </div>
            )}
            {cfg.triggerType === "schedule" && (
              <div>
                <label className={labelCls}>Schedule Time</label>
                <input type="datetime-local" className={inputCls} value={String(cfg.scheduleTime || "")} onChange={(e) => set("scheduleTime", e.target.value)} />
              </div>
            )}
            {cfg.triggerType === "webhook" && (
              <div className="bg-white/5 rounded-lg p-3">
                <p className="text-xs text-white/50 mb-1">Webhook Endpoint</p>
                <p className="text-[11px] font-mono text-primary/80 break-all">POST /api/automation-flows/{"{id}"}/execute</p>
              </div>
            )}
          </>
        )}

        {/* ── Send Message ── */}
        {node.type === "sendMessageNode" && (
          <>
            <div>
              <label className={labelCls}>Message Type</label>
              <div className="grid grid-cols-2 gap-2">
                {(["text", "template"] as const).map((t) => (
                  <button
                    key={t}
                    onClick={() => set("messageType", t)}
                    className={`py-2 rounded-lg text-xs font-semibold border transition-all ${cfg.messageType === t ? "border-primary bg-primary/15 text-primary" : "border-white/10 text-white/50 hover:border-white/25"}`}
                  >
                    {t === "text" ? "💬 Custom Text" : "📋 Template"}
                  </button>
                ))}
              </div>
            </div>
            {cfg.messageType === "template" ? (
              <div>
                <label className={labelCls}>Select Template</label>
                <select
                  className={inputCls}
                  value={String(cfg.templateId || "")}
                  onChange={(e) => {
                    const tmpl = templates.find((t) => t.id === e.target.value);
                    onUpdate(node.id, { ...cfg, templateId: e.target.value, templateName: tmpl?.name || "" });
                  }}
                >
                  <option value="">— pick a template —</option>
                  {templates.map((t) => (
                    <option key={t.id} value={t.id}>{t.display_name || t.name}</option>
                  ))}
                </select>
                {cfg.templateId ? (
                  <p className="mt-2 text-[11px] text-white/40 bg-white/5 rounded-lg p-2 leading-relaxed">
                    {templates.find((t) => t.id === String(cfg.templateId))?.body ?? ""}
                  </p>
                ) : null}
              </div>
            ) : (
              <div>
                <label className={labelCls}>Message Text</label>
                <textarea
                  rows={4}
                  className={`${inputCls} resize-none`}
                  value={String(cfg.text || "")}
                  onChange={(e) => set("text", e.target.value)}
                  placeholder={"Hi {{name}}, thanks for reaching out!"}
                />
                <p className="text-[11px] text-white/30 mt-1">Use {"{{name}}"} for contact name</p>
              </div>
            )}
          </>
        )}

        {/* ── Wait ── */}
        {node.type === "waitNode" && (
          <div>
            <label className={labelCls}>Wait Duration</label>
            <div className="flex gap-2">
              <input
                type="number"
                min={1}
                className={inputCls}
                value={String(cfg.duration ?? 1)}
                onChange={(e) => set("duration", parseInt(e.target.value) || 1)}
              />
              <select className={`${inputCls} w-36 flex-shrink-0`} value={String(cfg.unit || "hours")} onChange={(e) => set("unit", e.target.value)}>
                <option value="minutes">Minutes</option>
                <option value="hours">Hours</option>
                <option value="days">Days</option>
              </select>
            </div>
          </div>
        )}

        {/* ── Condition ── */}
        {node.type === "conditionNode" && (
          <>
            <div>
              <label className={labelCls}>Check Field</label>
              <select className={inputCls} value={String(cfg.field || "last_message")} onChange={(e) => set("field", e.target.value)}>
                <option value="last_message">Last Message</option>
                <option value="name">Contact Name</option>
                <option value="phone">Phone Number</option>
                <option value="crm_stage">CRM Stage</option>
                <option value="crm_notes">CRM Notes / Tags</option>
              </select>
            </div>
            <div>
              <label className={labelCls}>Operator</label>
              <select className={inputCls} value={String(cfg.operator || "contains")} onChange={(e) => set("operator", e.target.value)}>
                <option value="contains">Contains</option>
                <option value="equals">Equals</option>
                <option value="not_equals">Not Equals</option>
                <option value="starts_with">Starts With</option>
                <option value="is_set">Is Set</option>
                <option value="is_not_set">Is Not Set</option>
              </select>
            </div>
            {!["is_set", "is_not_set"].includes(String(cfg.operator)) && (
              <div>
                <label className={labelCls}>Value</label>
                <input className={inputCls} value={String(cfg.value || "")} onChange={(e) => set("value", e.target.value)} placeholder="Value to compare" />
              </div>
            )}
            <div className="flex gap-3 text-xs pt-1">
              <span className="flex items-center gap-1.5 text-emerald-400">
                <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block" /> True → left handle
              </span>
              <span className="flex items-center gap-1.5 text-red-400">
                <span className="w-2 h-2 rounded-full bg-red-500 inline-block" /> False → right handle
              </span>
            </div>
          </>
        )}

        {/* ── Add Tag ── */}
        {node.type === "addTagNode" && (
          <>
            <div>
              <label className={labelCls}>Action</label>
              <div className="grid grid-cols-2 gap-2">
                {(["add", "remove"] as const).map((a) => (
                  <button key={a} onClick={() => set("action", a)}
                    className={`py-2 rounded-lg text-xs font-semibold border transition-all ${cfg.action === a ? "border-primary bg-primary/15 text-primary" : "border-white/10 text-white/50 hover:border-white/25"}`}
                  >
                    {a === "add" ? "➕ Add Tag" : "➖ Remove Tag"}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className={labelCls}>Tag Name</label>
              <input className={inputCls} value={String(cfg.tag || "")} onChange={(e) => set("tag", e.target.value)} placeholder="vip, interested, unsubscribed" />
            </div>
          </>
        )}

        {/* ── HTTP Request ── */}
        {node.type === "httpRequestNode" && (
          <>
            <div>
              <label className={labelCls}>Method</label>
              <select className={inputCls} value={String(cfg.method || "POST")} onChange={(e) => set("method", e.target.value)}>
                {["GET", "POST", "PUT", "DELETE"].map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
            <div>
              <label className={labelCls}>URL</label>
              <input className={inputCls} value={String(cfg.url || "")} onChange={(e) => set("url", e.target.value)} placeholder="https://your-webhook.com/endpoint" />
            </div>
            {["POST", "PUT"].includes(String(cfg.method || "POST")) && (
              <div>
                <label className={labelCls}>Request Body (JSON)</label>
                <textarea
                  rows={4}
                  className={`${inputCls} resize-none font-mono text-[11px]`}
                  value={String(cfg.body || "")}
                  onChange={(e) => set("body", e.target.value)}
                  placeholder={'{"phone": "{{phone}}", "name": "{{name}}"}'}
                />
              </div>
            )}
          </>
        )}

        {/* ── AI Reply ── */}
        {node.type === "aiReplyNode" && (
          <>
            <div>
              <label className={labelCls}>AI Model</label>
              <select className={inputCls} value={String(cfg.model || "claude")} onChange={(e) => set("model", e.target.value)}>
                <option value="claude">Claude Sonnet (Recommended)</option>
                <option value="claude-haiku">Claude Haiku (Faster)</option>
              </select>
            </div>
            <div>
              <label className={labelCls}>System Prompt</label>
              <textarea
                rows={5}
                className={`${inputCls} resize-none`}
                value={String(cfg.systemPrompt || "")}
                onChange={(e) => set("systemPrompt", e.target.value)}
                placeholder={"You are a helpful WhatsApp business assistant. Answer questions about our products and pricing. Be concise and friendly."}
              />
            </div>
            <div>
              <label className={labelCls}>Max Response Tokens</label>
              <input type="number" min={50} max={1000} className={inputCls} value={String(cfg.maxTokens || 300)} onChange={(e) => set("maxTokens", parseInt(e.target.value) || 300)} />
            </div>
          </>
        )}

        {/* ── Assign Agent ── */}
        {node.type === "assignAgentNode" && (
          <>
            <div>
              <label className={labelCls}>Assign To</label>
              <input className={inputCls} value={String(cfg.agentName || "")} onChange={(e) => set("agentName", e.target.value)} placeholder="Sales Team / agent@company.com" />
            </div>
            <div>
              <label className={labelCls}>Handoff Note (optional)</label>
              <textarea rows={3} className={`${inputCls} resize-none`} value={String(cfg.note || "")} onChange={(e) => set("note", e.target.value)} placeholder="Contact is a hot lead..." />
            </div>
          </>
        )}

        {/* ── Update Contact ── */}
        {node.type === "updateContactNode" && (
          <>
            <div>
              <label className={labelCls}>Field to Update</label>
              <select className={inputCls} value={String(cfg.field || "crm_stage")} onChange={(e) => set("field", e.target.value)}>
                <option value="name">Name</option>
                <option value="crm_stage">CRM Stage</option>
                <option value="crm_notes">CRM Notes</option>
                <option value="crm_score">Lead Score</option>
                <option value="company">Company</option>
              </select>
            </div>
            <div>
              <label className={labelCls}>New Value</label>
              {cfg.field === "crm_stage" ? (
                <select className={inputCls} value={String(cfg.value || "")} onChange={(e) => set("value", e.target.value)}>
                  <option value="">— select stage —</option>
                  {["new_lead", "contacted", "qualified", "interested", "converted"].map((s) => (
                    <option key={s} value={s}>{s.replace(/_/g, " ")}</option>
                  ))}
                </select>
              ) : (
                <input className={inputCls} value={String(cfg.value || "")} onChange={(e) => set("value", e.target.value)} placeholder="New value..." />
              )}
            </div>
          </>
        )}

        {/* ── End ── */}
        {node.type === "endNode" && (
          <div>
            <label className={labelCls}>End Reason</label>
            <select className={inputCls} value={String(cfg.endReason || "completed")} onChange={(e) => set("endReason", e.target.value)}>
              <option value="completed">Completed</option>
              <option value="resolved">Resolved</option>
              <option value="opted_out">Opted Out</option>
              <option value="timeout">Timeout</option>
            </select>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Test Modal ───────────────────────────────────────────────────────────────

type LogEntry = { nodeId: string; type: string; label: string; result: string; success: boolean };

function TestModal({ flowId, onClose }: { flowId: string | null; onClose: () => void }) {
  const [running, setRunning] = useState(false);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [done, setDone] = useState(false);

  const run = async () => {
    if (!flowId) { toast.error("Save the flow first"); return; }
    setRunning(true);
    setLog([]);
    setDone(false);
    try {
      const res = await fetch(`/api/automation-flows/${flowId}/execute`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ testMode: true }),
      });
      const data = await res.json();
      setLog(data.log || []);
      setDone(true);
    } catch {
      toast.error("Test failed");
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="w-full max-w-lg bg-[#111b21] border border-white/10 rounded-2xl shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/8">
          <div className="flex items-center gap-2.5">
            <Terminal className="w-4 h-4 text-primary" />
            <p className="font-semibold text-sm">Test Flow Simulation</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-white/10 transition-colors">
            <X className="w-4 h-4 text-white/60" />
          </button>
        </div>
        <div className="p-5 space-y-4">
          <div className="flex items-start gap-2 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2.5">
            <Info className="w-3.5 h-3.5 text-amber-400 flex-shrink-0 mt-0.5" />
            <p className="text-xs text-amber-300">Test mode simulates the flow with a sample contact. No real messages are sent.</p>
          </div>
          {log.length > 0 && (
            <div className="bg-[#0d1117] rounded-xl p-4 space-y-2 max-h-64 overflow-y-auto font-mono">
              {log.map((entry, i) => (
                <div key={i} className="flex items-start gap-2 text-xs">
                  {entry.success
                    ? <Check className="w-3 h-3 text-emerald-400 flex-shrink-0 mt-0.5" />
                    : <X className="w-3 h-3 text-red-400 flex-shrink-0 mt-0.5" />}
                  <span className="text-white/30">[{entry.type}]</span>
                  <span className="text-white/60 flex-shrink-0">{entry.label}</span>
                  <span className={`flex-1 truncate ${entry.success ? "text-emerald-400/80" : "text-red-400/80"}`}>{entry.result}</span>
                </div>
              ))}
              {done && (
                <div className="pt-2 border-t border-white/10 text-emerald-400 text-xs flex items-center gap-2">
                  <Check className="w-3 h-3" /> Simulation complete
                </div>
              )}
            </div>
          )}
          <div className="flex gap-3">
            <button
              onClick={run}
              disabled={running}
              className="flex-1 flex items-center justify-center gap-2 wa-gradient text-white text-sm font-semibold py-2.5 rounded-xl hover:opacity-90 transition-all disabled:opacity-50"
            >
              {running ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
              {running ? "Running..." : "Run Simulation"}
            </button>
            <button onClick={onClose} className="px-5 py-2.5 rounded-xl border border-white/10 text-sm text-white/60 hover:bg-white/5 transition-colors">
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Flow Canvas ──────────────────────────────────────────────────────────────

const INITIAL_TRIGGER: Node = {
  id: "node_trigger",
  type: "triggerNode",
  position: { x: 240, y: 60 },
  data: { label: "Trigger", config: { triggerType: "keyword", keywords: "" } },
};

function FlowCanvas({
  flowId,
  initialData,
}: {
  flowId: string | null;
  initialData?: { nodes: Node[]; edges: Edge[]; name: string; is_active: boolean };
}) {
  const router = useRouter();
  const { screenToFlowPosition } = useReactFlow();
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>(
    initialData?.nodes?.length ? initialData.nodes : [INITIAL_TRIGGER]
  );
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(initialData?.edges || []);
  const [selectedNode, setSelectedNode] = useState<Node | null>(null);
  const [flowName, setFlowName] = useState(initialData?.name || "Untitled Flow");
  const [isActive, setIsActive] = useState(initialData?.is_active ?? false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [showTest, setShowTest] = useState(false);
  const [savedFlowId, setSavedFlowId] = useState(flowId);
  const flowWrapperRef = useRef<HTMLDivElement>(null);

  const onConnect = useCallback(
    (params: Connection) =>
      setEdges((eds) =>
        addEdge({ ...params, animated: true, style: { stroke: "rgba(255,255,255,0.2)", strokeWidth: 2 } }, eds)
      ),
    [setEdges]
  );

  const onNodeClick = useCallback((_: React.MouseEvent, node: Node) => {
    setSelectedNode(node);
  }, []);

  const onPaneClick = useCallback(() => setSelectedNode(null), []);

  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  }, []);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const nodeType = e.dataTransfer.getData("nodeType");
      if (!nodeType) return;
      const position = screenToFlowPosition({ x: e.clientX, y: e.clientY });
      const id = `node_${Date.now()}`;
      const newNode: Node = {
        id,
        type: nodeType,
        position,
        data: {
          label: DEFAULT_LABELS[nodeType] || nodeType,
          config: { ...DEFAULT_CONFIGS[nodeType] },
        },
      };
      setNodes((nds) => [...nds, newNode]);
      setSelectedNode(newNode);
    },
    [screenToFlowPosition, setNodes]
  );

  const updateNodeConfig = useCallback(
    (id: string, config: Record<string, unknown>, label?: string) => {
      setNodes((nds) =>
        nds.map((n) =>
          n.id === id ? { ...n, data: { ...n.data, config, label: label ?? (n.data as unknown as FlowNodeData).label } } : n
        )
      );
      setSelectedNode((prev) =>
        prev?.id === id ? { ...prev, data: { ...prev.data, config, label: label ?? (prev.data as unknown as FlowNodeData).label } } : prev
      );
    },
    [setNodes]
  );

  const deleteNode = useCallback(
    (id: string) => {
      setNodes((nds) => nds.filter((n) => n.id !== id));
      setEdges((eds) => eds.filter((e) => e.source !== id && e.target !== id));
      setSelectedNode(null);
    },
    [setNodes, setEdges]
  );

  const triggerType =
    ((nodes.find((n) => n.type === "triggerNode")?.data as unknown as FlowNodeData | undefined)?.config?.triggerType as string) || "keyword";

  const handleSave = async () => {
    if (!flowName.trim()) { toast.error("Flow needs a name"); return; }
    setSaving(true);
    try {
      const payload = {
        name: flowName,
        trigger_type: triggerType,
        flow_data: {
          nodes: nodes.map((n) => ({ id: n.id, type: n.type, position: n.position, data: n.data })),
          edges: edges.map((e) => ({ id: e.id, source: e.source, target: e.target, sourceHandle: e.sourceHandle ?? undefined, label: e.label })),
        },
        is_active: isActive,
      };
      const res = savedFlowId
        ? await fetch(`/api/automation-flows/${savedFlowId}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) })
        : await fetch("/api/automation-flows", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setSavedFlowId(data.flow.id);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      toast.success("Flow saved!");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const handleToggleActive = async () => {
    const next = !isActive;
    setIsActive(next);
    if (savedFlowId) {
      await fetch(`/api/automation-flows/${savedFlowId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_active: next }),
      }).catch(() => {});
    }
    toast.success(next ? "Flow activated" : "Flow paused");
  };

  return (
    <div className="h-full flex flex-col">
      {/* Toolbar */}
      <div className="h-12 flex items-center gap-3 px-4 border-b border-white/8 bg-[#111b21] flex-shrink-0">
        <button
          onClick={() => router.push("/automation")}
          className="flex items-center gap-1.5 text-xs text-white/50 hover:text-white/80 transition-colors flex-shrink-0"
        >
          <ChevronLeft className="w-4 h-4" />
          <span className="hidden sm:inline">Automations</span>
        </button>
        <div className="w-px h-5 bg-white/10" />
        <input
          value={flowName}
          onChange={(e) => setFlowName(e.target.value)}
          className="flex-1 bg-transparent text-sm font-semibold text-white outline-none placeholder:text-white/30 min-w-0"
          placeholder="Flow name..."
        />
        <div className="flex items-center gap-2 flex-shrink-0">
          <button
            onClick={() => setShowTest(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-white/10 text-xs font-medium text-white/60 hover:bg-white/5 hover:text-white transition-all"
          >
            <Play className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Test</span>
          </button>
          {selectedNode && (
            <button
              onClick={() => {
                const newNode: Node = {
                  ...selectedNode,
                  id: `node_${Date.now()}`,
                  position: { x: selectedNode.position.x + 30, y: selectedNode.position.y + 30 },
                  data: JSON.parse(JSON.stringify(selectedNode.data)),
                };
                setNodes((nds) => [...nds, newNode]);
                toast.success("Node duplicated");
              }}
              className="p-1.5 rounded-lg border border-white/10 hover:bg-white/5 transition-all"
              title="Duplicate node"
            >
              <Copy className="w-3.5 h-3.5 text-white/60" />
            </button>
          )}
          <button
            onClick={handleToggleActive}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all border ${
              isActive
                ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/30"
                : "border-white/10 text-white/50 hover:bg-white/5"
            }`}
          >
            {isActive ? <ToggleRight className="w-3.5 h-3.5" /> : <ToggleLeft className="w-3.5 h-3.5" />}
            {isActive ? "Active" : "Inactive"}
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-1.5 px-3 py-1.5 wa-gradient text-white text-xs font-semibold rounded-lg hover:opacity-90 transition-all disabled:opacity-50 shadow-lg shadow-primary/20"
          >
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : saved ? <Check className="w-3.5 h-3.5" /> : <Save className="w-3.5 h-3.5" />}
            {saved ? "Saved!" : "Save"}
          </button>
        </div>
      </div>

      {/* Main area */}
      <div className="flex flex-1 min-h-0">
        {/* Left palette */}
        <div className="w-48 border-r border-white/8 bg-[#0d1117] overflow-y-auto flex-shrink-0">
          <div className="p-3 space-y-4">
            <p className="text-[10px] font-semibold text-white/30 uppercase tracking-wider px-1 pt-1">Drag to canvas</p>
            {NODE_CATALOGUE.map((group) => (
              <div key={group.group}>
                <p className="text-[10px] font-semibold text-white/25 uppercase tracking-wider mb-2 px-1">{group.group}</p>
                <div className="space-y-1.5">
                  {group.items.map((item) => {
                    const Icon = item.icon;
                    const parts = item.color.split(" ");
                    const bg = parts[0], text = parts[1], border = parts[2];
                    return (
                      <div
                        key={item.type}
                        draggable
                        onDragStart={(e) => {
                          e.dataTransfer.setData("nodeType", item.type);
                          e.dataTransfer.effectAllowed = "copy";
                        }}
                        className={`flex items-center gap-2 px-2.5 py-2 rounded-lg border cursor-grab active:cursor-grabbing transition-opacity hover:opacity-80 select-none ${bg} ${border}`}
                      >
                        <Icon className={`w-3.5 h-3.5 flex-shrink-0 ${text}`} />
                        <span className={`text-xs font-medium leading-tight ${text}`}>{item.label}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Canvas */}
        <div className="flex-1 relative min-w-0" ref={flowWrapperRef} onDragOver={onDragOver} onDrop={onDrop}>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeClick={onNodeClick}
            onPaneClick={onPaneClick}
            nodeTypes={nodeTypes}
            fitView
            deleteKeyCode="Delete"
            style={{ background: "#0b141a" }}
            defaultEdgeOptions={{
              animated: true,
              style: { stroke: "rgba(255,255,255,0.2)", strokeWidth: 2 },
            }}
          >
            <Background variant={BackgroundVariant.Dots} gap={24} size={1} color="rgba(255,255,255,0.06)" />
            <Controls
              style={{ background: "#111b21", border: "1px solid rgba(255,255,255,0.08)" }}
              showInteractive={false}
            />
            <MiniMap
              style={{ background: "#0d1117", border: "1px solid rgba(255,255,255,0.08)" }}
              nodeColor="#1e3a2f"
              maskColor="rgba(0,0,0,0.5)"
            />
          </ReactFlow>

          {nodes.length === 0 && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="text-center space-y-2">
                <Zap className="w-12 h-12 text-white/8 mx-auto" />
                <p className="text-sm text-white/20 font-medium">Drop nodes here to build your flow</p>
                <p className="text-xs text-white/12">Drag from the panel on the left</p>
              </div>
            </div>
          )}
        </div>

        {/* Right config panel */}
        {selectedNode && (
          <div className="w-72 border-l border-white/8 bg-[#111b21] flex flex-col flex-shrink-0 overflow-hidden">
            <NodeConfigPanel
              node={selectedNode as Node & { data: FlowNodeData }}
              onUpdate={updateNodeConfig}
              onClose={() => setSelectedNode(null)}
              onDelete={deleteNode}
            />
          </div>
        )}
      </div>

      {showTest && <TestModal flowId={savedFlowId} onClose={() => setShowTest(false)} />}
    </div>
  );
}

// ─── Page wrapper ─────────────────────────────────────────────────────────────

function FlowBuilderInner() {
  const searchParams = useSearchParams();
  const flowId = searchParams.get("id");
  const [initialData, setInitialData] = useState<{
    nodes: Node[]; edges: Edge[]; name: string; is_active: boolean;
  } | null>(null);
  const [loading, setLoading] = useState(!!flowId);

  useEffect(() => {
    if (!flowId) return;
    fetch(`/api/automation-flows/${flowId}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.flow) setInitialData({ nodes: d.flow.flow_data?.nodes || [], edges: d.flow.flow_data?.edges || [], name: d.flow.name, is_active: d.flow.is_active });
      })
      .catch(() => toast.error("Failed to load flow"))
      .finally(() => setLoading(false));
  }, [flowId]);

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <ReactFlowProvider>
      <FlowCanvas flowId={flowId} initialData={initialData ?? undefined} />
    </ReactFlowProvider>
  );
}

export default function AutomationCreatePage() {
  return (
    <div className="h-[calc(100vh-4rem)] -mx-4 sm:-mx-6 overflow-hidden bg-[#0b141a]">
      <Suspense
        fallback={
          <div className="h-full flex items-center justify-center">
            <Loader2 className="w-8 h-8 animate-spin text-primary" />
          </div>
        }
      >
        <FlowBuilderInner />
      </Suspense>
    </div>
  );
}
