"use client";

import { Handle, Position, type NodeProps } from "@xyflow/react";
import {
  Zap, MessageSquare, Clock, GitBranch, Tag, Globe,
  Sparkles, UserCheck, RefreshCw, Flag,
  Calendar, Bell, Webhook,
} from "lucide-react";

// ─── Shared types ─────────────────────────────────────────────────────────────

export interface FlowNodeData {
  label:  string;
  config: Record<string, unknown>;
  stats?: { count: number };
}

// ─── Node palette catalogue ────────────────────────────────────────────────────

export const NODE_CATALOGUE = [
  {
    group: "Triggers",
    items: [
      { type: "triggerNode", label: "Trigger", icon: Zap,         desc: "Start the flow",             color: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30" },
    ],
  },
  {
    group: "Actions",
    items: [
      { type: "sendMessageNode", label: "Send Message", icon: MessageSquare, desc: "Send WhatsApp message",    color: "bg-blue-500/20 text-blue-400 border-blue-500/30"     },
      { type: "waitNode",        label: "Wait / Delay", icon: Clock,         desc: "Pause for a duration",    color: "bg-amber-500/20 text-amber-400 border-amber-500/30"  },
      { type: "conditionNode",   label: "Condition",    icon: GitBranch,     desc: "Branch on if / else",     color: "bg-violet-500/20 text-violet-400 border-violet-500/30"},
      { type: "addTagNode",      label: "Add / Remove Tag", icon: Tag,       desc: "Tag the contact",         color: "bg-pink-500/20 text-pink-400 border-pink-500/30"     },
      { type: "updateContactNode",label: "Update Contact",icon: RefreshCw,   desc: "Set a contact field",     color: "bg-orange-500/20 text-orange-400 border-orange-500/30"},
      { type: "assignAgentNode", label: "Assign Agent", icon: UserCheck,     desc: "Route to human agent",    color: "bg-teal-500/20 text-teal-400 border-teal-500/30"     },
      { type: "aiReplyNode",     label: "AI Reply",     icon: Sparkles,      desc: "Generate smart reply",    color: "bg-purple-500/20 text-purple-400 border-purple-500/30"},
      { type: "httpRequestNode", label: "HTTP Request", icon: Globe,         desc: "Call external webhook",   color: "bg-slate-500/20 text-slate-400 border-slate-500/30"  },
      { type: "endNode",         label: "End Flow",     icon: Flag,          desc: "Mark flow complete",      color: "bg-red-500/20 text-red-400 border-red-500/30"        },
    ],
  },
];

// Quick lookup: type → meta
type CatalogueItem = { type: string; label: string; icon: React.ElementType; desc: string; color: string };
const META_MAP = Object.fromEntries(
  (NODE_CATALOGUE as { group: string; items: CatalogueItem[] }[])
    .flatMap((g) => g.items)
    .map((item) => [item.type, item])
) as Record<string, CatalogueItem>;

// ─── Base node wrapper ─────────────────────────────────────────────────────────

function BaseNode({
  nodeType, selected, children, stats,
  hasInput = true, hasOutput = true,
  dualOutput = false,
}: {
  nodeType: string;
  selected: boolean;
  children: React.ReactNode;
  stats?: { count: number };
  hasInput?: boolean;
  hasOutput?: boolean;
  dualOutput?: boolean;
}) {
  const meta = META_MAP[nodeType];
  const Icon = meta?.icon ?? Zap;
  const colorClass = meta?.color ?? "bg-muted/20 text-muted-foreground border-muted/30";
  const [bg, text] = colorClass.split(" ");

  return (
    <div
      className={`w-52 rounded-xl border bg-[#111b21] shadow-md transition-all duration-150
        ${selected ? "ring-2 ring-primary ring-offset-1 ring-offset-[#111b21] shadow-lg shadow-primary/20" : "border-white/10"}
      `}
    >
      {/* Input handle */}
      {hasInput && (
        <Handle
          type="target"
          position={Position.Top}
          className="!w-3 !h-3 !border-2 !border-[#111b21] !bg-white/40"
        />
      )}

      {/* Header */}
      <div className={`flex items-center gap-2 px-3 py-2 rounded-t-xl border-b border-white/5 ${bg} bg-opacity-30`}>
        <Icon className={`w-3.5 h-3.5 flex-shrink-0 ${text}`} />
        <span className={`text-xs font-semibold truncate ${text}`}>{meta?.label ?? nodeType}</span>
        {stats && stats.count > 0 && (
          <span className="ml-auto text-[10px] bg-white/10 text-white/60 px-1.5 py-0.5 rounded-full font-medium flex-shrink-0">
            {stats.count}
          </span>
        )}
      </div>

      {/* Body */}
      <div className="px-3 py-2.5 text-xs text-white/60 min-h-[36px]">{children}</div>

      {/* Output handles */}
      {dualOutput ? (
        <>
          <Handle
            type="source"
            position={Position.Bottom}
            id="true"
            style={{ left: "30%" }}
            className="!w-3 !h-3 !border-2 !border-[#111b21] !bg-emerald-500"
          />
          <Handle
            type="source"
            position={Position.Bottom}
            id="false"
            style={{ left: "70%" }}
            className="!w-3 !h-3 !border-2 !border-[#111b21] !bg-red-500"
          />
        </>
      ) : hasOutput ? (
        <Handle
          type="source"
          position={Position.Bottom}
          className="!w-3 !h-3 !border-2 !border-[#111b21] !bg-white/40"
        />
      ) : null}
    </div>
  );
}

// ─── Trigger node ─────────────────────────────────────────────────────────────

const TRIGGER_LABELS: Record<string, { label: string; icon: React.ElementType }> = {
  keyword:       { label: "Keyword Match",    icon: MessageSquare },
  new_contact:   { label: "New Contact",      icon: UserCheck     },
  webhook:       { label: "Webhook",          icon: Webhook       },
  schedule:      { label: "Schedule",         icon: Calendar      },
  contact_tagged:{ label: "Contact Tagged",   icon: Tag           },
  opt_in:        { label: "Contact Opt-in",   icon: Bell          },
};

export function TriggerNode({ data, selected }: NodeProps) {
  const d = data as unknown as FlowNodeData;
  const cfg = d.config;
  const meta = TRIGGER_LABELS[String(cfg.triggerType || "keyword")];
  const TIcon = meta?.icon ?? Zap;

  return (
    <BaseNode nodeType="triggerNode" selected={selected} hasInput={false} stats={d.stats}>
      <div className="flex items-center gap-1.5">
        <TIcon className="w-3 h-3 text-emerald-400 flex-shrink-0" />
        <span className="font-medium text-white/80">{meta?.label ?? "Trigger"}</span>
      </div>
      {cfg.keywords ? (
        <p className="mt-1 truncate text-[11px]">Keywords: {String(cfg.keywords)}</p>
      ) : null}
      {cfg.scheduleTime ? (
        <p className="mt-1 text-[11px]">{String(cfg.scheduleTime)}</p>
      ) : null}
    </BaseNode>
  );
}

// ─── Send Message node ────────────────────────────────────────────────────────

export function SendMessageNode({ data, selected }: NodeProps) {
  const d = data as unknown as FlowNodeData;
  const cfg = d.config;
  const isTemplate = cfg.messageType === "template";

  return (
    <BaseNode nodeType="sendMessageNode" selected={selected} stats={d.stats}>
      <p className="font-medium text-white/80 truncate">
        {isTemplate ? `📋 ${String(cfg.templateName || "Pick template")}` : "💬 Custom text"}
      </p>
      {!isTemplate && cfg.text ? (
        <p className="mt-1 truncate text-[11px]">{String(cfg.text).slice(0, 48)}</p>
      ) : null}
    </BaseNode>
  );
}

// ─── Wait node ────────────────────────────────────────────────────────────────

export function WaitNode({ data, selected }: NodeProps) {
  const d = data as unknown as FlowNodeData;
  const { duration = 1, unit = "hours" } = d.config as { duration: number; unit: string };

  return (
    <BaseNode nodeType="waitNode" selected={selected} stats={d.stats}>
      <p className="font-medium text-white/80">
        ⏱&nbsp;{duration} {unit}
      </p>
    </BaseNode>
  );
}

// ─── Condition node ───────────────────────────────────────────────────────────

export function ConditionNode({ data, selected }: NodeProps) {
  const d = data as unknown as FlowNodeData;
  const { field = "—", operator = "contains", value = "—" } = d.config as {
    field: string; operator: string; value: string;
  };

  return (
    <BaseNode nodeType="conditionNode" selected={selected} dualOutput stats={d.stats}>
      <p className="font-medium text-white/80 truncate">if {field}</p>
      <p className="mt-0.5 text-[11px] truncate">{operator} "{value}"</p>
      <div className="flex justify-between mt-1.5 text-[10px]">
        <span className="text-emerald-400 font-semibold">✓ True</span>
        <span className="text-red-400 font-semibold">✗ False</span>
      </div>
    </BaseNode>
  );
}

// ─── Add Tag node ─────────────────────────────────────────────────────────────

export function AddTagNode({ data, selected }: NodeProps) {
  const d = data as unknown as FlowNodeData;
  const { action = "add", tag = "—" } = d.config as { action: string; tag: string };

  return (
    <BaseNode nodeType="addTagNode" selected={selected} stats={d.stats}>
      <p className="font-medium text-white/80">
        {action === "add" ? "➕" : "➖"} #{tag || "tag-name"}
      </p>
    </BaseNode>
  );
}

// ─── HTTP Request node ────────────────────────────────────────────────────────

export function HttpRequestNode({ data, selected }: NodeProps) {
  const d = data as unknown as FlowNodeData;
  const { method = "POST", url = "" } = d.config as { method: string; url: string };
  const shortUrl = url.replace(/^https?:\/\//, "").slice(0, 30) || "Enter URL";

  return (
    <BaseNode nodeType="httpRequestNode" selected={selected} stats={d.stats}>
      <span className="font-mono text-[10px] bg-white/10 px-1.5 py-0.5 rounded mr-1 font-semibold">
        {method}
      </span>
      <span className="text-[11px] truncate">{shortUrl}</span>
    </BaseNode>
  );
}

// ─── AI Reply node ────────────────────────────────────────────────────────────

export function AiReplyNode({ data, selected }: NodeProps) {
  const d = data as unknown as FlowNodeData;
  const { model = "claude" } = d.config as { model: string };
  const modelLabel = model === "claude" ? "Claude Sonnet" : "GPT-4o";

  return (
    <BaseNode nodeType="aiReplyNode" selected={selected} stats={d.stats}>
      <p className="font-medium text-white/80">✨ {modelLabel}</p>
      {d.config.systemPrompt ? (
        <p className="mt-1 text-[11px] truncate">{String(d.config.systemPrompt).slice(0, 40)}</p>
      ) : null}
    </BaseNode>
  );
}

// ─── Assign Agent node ────────────────────────────────────────────────────────

export function AssignAgentNode({ data, selected }: NodeProps) {
  const d = data as unknown as FlowNodeData;
  const { agentName = "—" } = d.config as { agentName: string };

  return (
    <BaseNode nodeType="assignAgentNode" selected={selected} stats={d.stats}>
      <p className="font-medium text-white/80 truncate">→ {agentName}</p>
    </BaseNode>
  );
}

// ─── Update Contact node ──────────────────────────────────────────────────────

export function UpdateContactNode({ data, selected }: NodeProps) {
  const d = data as unknown as FlowNodeData;
  const { field = "—", value = "—" } = d.config as { field: string; value: string };

  return (
    <BaseNode nodeType="updateContactNode" selected={selected} stats={d.stats}>
      <p className="font-medium text-white/80 truncate">Set {field}</p>
      <p className="mt-0.5 text-[11px] truncate">= "{value}"</p>
    </BaseNode>
  );
}

// ─── End node ─────────────────────────────────────────────────────────────────

export function EndNode({ data, selected }: NodeProps) {
  const d = data as unknown as FlowNodeData;

  return (
    <BaseNode nodeType="endNode" selected={selected} hasOutput={false} stats={d.stats}>
      <p className="font-medium text-white/80">✓ Flow Complete</p>
      {d.config.endReason ? (
        <p className="mt-0.5 text-[11px] truncate">{String(d.config.endReason)}</p>
      ) : null}
    </BaseNode>
  );
}

// ─── nodeTypes map for React Flow ─────────────────────────────────────────────

export const nodeTypes = {
  triggerNode:       TriggerNode,
  sendMessageNode:   SendMessageNode,
  waitNode:          WaitNode,
  conditionNode:     ConditionNode,
  addTagNode:        AddTagNode,
  httpRequestNode:   HttpRequestNode,
  aiReplyNode:       AiReplyNode,
  assignAgentNode:   AssignAgentNode,
  updateContactNode: UpdateContactNode,
  endNode:           EndNode,
} as const;

// ─── Default configs for new nodes ────────────────────────────────────────────

export const DEFAULT_CONFIGS: Record<string, Record<string, unknown>> = {
  triggerNode:        { triggerType: "keyword", keywords: "" },
  sendMessageNode:    { messageType: "text", text: "" },
  waitNode:           { duration: 1, unit: "hours" },
  conditionNode:      { field: "last_message", operator: "contains", value: "" },
  addTagNode:         { action: "add", tag: "" },
  httpRequestNode:    { url: "", method: "POST", body: "" },
  aiReplyNode:        { model: "claude", systemPrompt: "", maxTokens: 300 },
  assignAgentNode:    { agentName: "", note: "" },
  updateContactNode:  { field: "crm_stage", value: "" },
  endNode:            { endReason: "completed" },
};

export const DEFAULT_LABELS: Record<string, string> = {
  triggerNode:        "Trigger",
  sendMessageNode:    "Send Message",
  waitNode:           "Wait",
  conditionNode:      "Condition",
  addTagNode:         "Add Tag",
  httpRequestNode:    "HTTP Request",
  aiReplyNode:        "AI Reply",
  assignAgentNode:    "Assign Agent",
  updateContactNode:  "Update Contact",
  endNode:            "End Flow",
};
