// Segment rule evaluator + RFM scoring.
// Translates a segment's JSONB rules into a Supabase query, and computes
// Recency / Frequency / Monetary scores from campaign_messages + contacts.

import type { SupabaseClient } from "@supabase/supabase-js";

export type SegmentField =
  | "tags" | "crm_stage" | "crm_score" | "deal_value" | "company"
  | "last_contacted" | "added_date" | "ctwa_campaign_id" | "phone" | "email" | "name";

export type SegmentOp =
  | "equals" | "not_equals"
  | "contains" | "not_contains"
  | "gte" | "lte" | "gt" | "lt"
  | "within_days" | "older_than"
  | "exists" | "is_null";

export interface SegmentCondition {
  field: SegmentField;
  op: SegmentOp;
  value?: string | number | null;
}

export interface SegmentRules {
  operator: "AND" | "OR";
  conditions: SegmentCondition[];
}

/** Apply rules to a Supabase contacts query. Returns the modified query. */
// We accept the loosely-typed Supabase query builder. Full typing isn't
// available without generated types, so we keep `any` here intentionally.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function applyRules(query: any, rules: SegmentRules) {
  if (!rules || !rules.conditions || rules.conditions.length === 0) return query;

  const orFilters: string[] = [];

  for (const c of rules.conditions) {
    const filter = conditionToFilter(c);
    if (!filter) continue;

    if (rules.operator === "OR") {
      orFilters.push(filter);
    } else {
      // AND: chain filters via raw `or` strings — but for AND we use multiple .filter calls.
      const [col, op, val] = parseFilter(filter);
      query = query.filter(col, op, val);
    }
  }

  if (rules.operator === "OR" && orFilters.length > 0) {
    query = query.or(orFilters.join(","));
  }
  return query;
}

function conditionToFilter(c: SegmentCondition): string | null {
  const v = c.value;
  switch (c.op) {
    case "equals":       return `${c.field}.eq.${v}`;
    case "not_equals":   return `${c.field}.neq.${v}`;
    case "gte":          return `${c.field}.gte.${v}`;
    case "lte":          return `${c.field}.lte.${v}`;
    case "gt":           return `${c.field}.gt.${v}`;
    case "lt":           return `${c.field}.lt.${v}`;
    case "contains":
      // Array column (tags) → contains element. Text column → ilike.
      if (c.field === "tags") return `${c.field}.cs.{${v}}`;
      return `${c.field}.ilike.*${v}*`;
    case "not_contains":
      if (c.field === "tags") return `${c.field}.not.cs.{${v}}`;
      return `${c.field}.not.ilike.*${v}*`;
    case "within_days": {
      const cutoff = new Date(Date.now() - Number(v) * 86400_000).toISOString();
      return `${c.field}.gte.${cutoff}`;
    }
    case "older_than": {
      const cutoff = new Date(Date.now() - Number(v) * 86400_000).toISOString();
      return `${c.field}.lt.${cutoff}`;
    }
    case "exists":   return `${c.field}.not.is.null`;
    case "is_null":  return `${c.field}.is.null`;
    default:         return null;
  }
}

function parseFilter(filter: string): [string, string, string] {
  // "field.op.value" → ["field", "op", "value"]  (value may contain dots)
  const [col, op, ...rest] = filter.split(".");
  return [col, op, rest.join(".")];
}

// ── Built-in system segments ─────────────────────────────────────────────
export interface SystemSegment {
  key: string;
  name: string;
  description: string;
  color: string;
  icon: string;
  rules: SegmentRules;
}

export const SYSTEM_SEGMENTS: SystemSegment[] = [
  {
    key: "active",
    name: "Active",
    description: "Messaged within last 7 days",
    color: "emerald",
    icon: "Activity",
    rules: { operator: "AND", conditions: [{ field: "last_contacted", op: "within_days", value: 7 }] },
  },
  {
    key: "dormant",
    name: "Dormant",
    description: "Not messaged in 30+ days",
    color: "amber",
    icon: "Moon",
    rules: { operator: "AND", conditions: [{ field: "last_contacted", op: "older_than", value: 30 }] },
  },
  {
    key: "new",
    name: "New",
    description: "Added in last 7 days",
    color: "violet",
    icon: "Sparkles",
    rules: { operator: "AND", conditions: [{ field: "added_date", op: "within_days", value: 7 }] },
  },
  {
    key: "vip",
    name: "VIP",
    description: "Deal value ≥ ₹10,000 or tagged 'vip'",
    color: "fuchsia",
    icon: "Crown",
    rules: {
      operator: "OR",
      conditions: [
        { field: "deal_value", op: "gte", value: 10000 },
        { field: "tags", op: "contains", value: "vip" },
      ],
    },
  },
  {
    key: "converted",
    name: "Converted",
    description: "Reached the 'converted' CRM stage",
    color: "blue",
    icon: "Target",
    rules: {
      operator: "AND",
      conditions: [{ field: "crm_stage", op: "equals", value: "converted" }],
    },
  },
  {
    key: "ctwa",
    name: "From Ads",
    description: "Came in through Click-to-WhatsApp ads",
    color: "blue",
    icon: "Facebook",
    rules: {
      operator: "AND",
      conditions: [{ field: "ctwa_campaign_id", op: "exists" }],
    },
  },
];

// ── RFM Scoring ──────────────────────────────────────────────────────────
// Recency:  days since last_contacted        (lower = better)
// Frequency: # campaign messages received    (higher = better)
// Monetary:  deal_value on contact           (higher = better)
//
// Each dimension scored 1–5 by quintile across the user's contact base.
// RFM_score = R*100 + F*10 + M (e.g. 555 = best)

export interface RFMRow {
  contact_id: string;
  recency_days: number | null;
  frequency: number;
  monetary: number;
  r_score: number;
  f_score: number;
  m_score: number;
  rfm_score: number;
  segment: string;
}

export async function computeRFM(supabase: SupabaseClient, userId: string): Promise<RFMRow[]> {
  const { data: contacts } = await supabase
    .from("contacts")
    .select("id, last_contacted, deal_value, added_date")
    .eq("user_id", userId);

  if (!contacts || contacts.length === 0) return [];

  // Get message-frequency per contact in one pass.
  const { data: msgs } = await supabase
    .from("campaign_messages")
    .select("contact_id")
    .in("contact_id", contacts.map((c) => c.id));

  const freqMap = new Map<string, number>();
  for (const m of msgs || []) {
    if (!m.contact_id) continue;
    freqMap.set(m.contact_id, (freqMap.get(m.contact_id) || 0) + 1);
  }

  const now = Date.now();
  const rows = contacts.map((c) => ({
    contact_id: c.id,
    recency_days: c.last_contacted ? Math.floor((now - new Date(c.last_contacted).getTime()) / 86400_000) : null,
    frequency: freqMap.get(c.id) || 0,
    monetary: Number(c.deal_value) || 0,
  }));

  // Quintile thresholds for each dimension
  const recencyValues   = rows.map((r) => r.recency_days ?? 9999).sort((a, b) => a - b);
  const frequencyValues = rows.map((r) => r.frequency).sort((a, b) => b - a);
  const monetaryValues  = rows.map((r) => r.monetary).sort((a, b) => b - a);

  const quintile = (sorted: number[], reverse = false): ((v: number) => number) => {
    if (sorted.length === 0) return () => 3;
    const cuts = [0.2, 0.4, 0.6, 0.8].map((p) => sorted[Math.floor(sorted.length * p)]);
    return (v: number) => {
      // For ascending sort (recency: lower = better), score 5 if v ≤ cuts[0].
      // For descending sort (freq/monetary: higher = better), score 5 if v ≥ cuts[0].
      if (reverse) {
        if (v <= cuts[0]) return 5;
        if (v <= cuts[1]) return 4;
        if (v <= cuts[2]) return 3;
        if (v <= cuts[3]) return 2;
        return 1;
      }
      if (v >= cuts[0]) return 5;
      if (v >= cuts[1]) return 4;
      if (v >= cuts[2]) return 3;
      if (v >= cuts[3]) return 2;
      return 1;
    };
  };

  const rScore = quintile(recencyValues, true);
  const fScore = quintile(frequencyValues);
  const mScore = quintile(monetaryValues);

  return rows.map((r) => {
    const rs = rScore(r.recency_days ?? 9999);
    const fs = fScore(r.frequency);
    const ms = mScore(r.monetary);
    const total = rs * 100 + fs * 10 + ms;
    return {
      ...r,
      r_score: rs,
      f_score: fs,
      m_score: ms,
      rfm_score: total,
      segment: classifyRFM(rs, fs, ms),
    };
  });
}

function classifyRFM(r: number, f: number, m: number): string {
  if (r >= 4 && f >= 4 && m >= 4)  return "Champions";
  if (r >= 4 && f >= 3)             return "Loyal";
  if (r >= 4 && f <= 2)             return "New Customers";
  if (r >= 3 && m >= 4)              return "Big Spenders";
  if (r === 2 && f >= 3)             return "At Risk";
  if (r === 1 && f >= 4)             return "Cannot Lose";
  if (r === 1 && f <= 2)             return "Lost";
  return "Needs Attention";
}
