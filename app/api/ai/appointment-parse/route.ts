/**
 * POST /api/ai/appointment-parse — AI-assisted "Quick book" (task: appointment_nl_parse).
 *
 * Parses one line of natural language ("book Ramesh for a haircut tomorrow at 5pm")
 * into the SAME structured fields the manual booking form uses. It NEVER books
 * (rule 2) — it returns a draft the human confirms via the unchanged manual flow.
 *
 * Ambiguity is surfaced, not guessed: `missing[]` lists required fields the model
 * could not fill, so the UI pre-fills what parsed and drops the user into the
 * manual form for the rest (rule 8). `service` is constrained to the caller's
 * known service ids so it maps cleanly onto the existing selector.
 */
import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { getUserTier } from "@/lib/ai/config";
import { runTask } from "@/lib/ai/service";

interface ParsedBooking {
  customerName: string;
  customerPhone: string;
  service: string; // one of the provided ids, or "" if unclear
  date: string;    // YYYY-MM-DD or ""
  time: string;    // HH:MM (24h) or ""
  notes: string;
  confidence: number; // 0..1
  missing: string[];  // server-recomputed below (authoritative)
}

const REQUIRED: { key: keyof ParsedBooking; label: string }[] = [
  { key: "customerName", label: "customer name" },
  { key: "service", label: "service" },
  { key: "date", label: "date" },
  { key: "time", label: "time" },
];

export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const text = String(body?.text ?? "").trim();
  if (!text) return NextResponse.json({ error: "text is required" }, { status: 400 });

  // Caller-supplied service catalogue → the model must map to one of these ids.
  const services: { id: string; label: string }[] = Array.isArray(body?.services) ? body.services : [];
  const serviceList = services.map((s) => `${s.id} (${s.label})`).join(", ") || "any";
  const validIds = new Set(services.map((s) => s.id));
  const today = new Date().toISOString().slice(0, 10); // resolve relative dates server-side

  const parse = (raw: string): ParsedBooking => {
    const m = raw.match(/\{[\s\S]*\}/);
    if (!m) throw new Error("no JSON object in model output");
    const p = JSON.parse(m[0]) as Partial<ParsedBooking>;
    const service = validIds.size === 0 || (p.service && validIds.has(p.service)) ? String(p.service ?? "") : "";
    const parsed: ParsedBooking = {
      customerName: String(p.customerName ?? "").slice(0, 80),
      customerPhone: String(p.customerPhone ?? "").replace(/[^\d+]/g, "").slice(0, 20),
      service,
      date: /^\d{4}-\d{2}-\d{2}$/.test(String(p.date ?? "")) ? String(p.date) : "",
      time: /^\d{2}:\d{2}$/.test(String(p.time ?? "")) ? String(p.time) : "",
      notes: String(p.notes ?? "").slice(0, 300),
      confidence: typeof p.confidence === "number" ? Math.max(0, Math.min(1, p.confidence)) : 0.5,
      missing: [],
    };
    // Authoritative missing[]: never trust the model to police its own gaps.
    parsed.missing = REQUIRED.filter((r) => !String(parsed[r.key]).trim()).map((r) => r.label);
    return parsed;
  };

  const system = `You extract appointment booking details from one line of natural language for an Indian SMB.
Today is ${today} (Asia/Kolkata). Resolve relative dates ("tomorrow", "next Monday") against it.
Available services (map to the id): ${serviceList}.
Rules:
- Output ONLY valid JSON, no markdown.
- date = YYYY-MM-DD, time = 24-hour HH:MM. Leave a field as "" if not stated — never invent.
- service must be one of the listed ids, else "".
- confidence = your certainty 0..1.`;

  const prompt = `Parse this booking request into JSON:
"${text}"

Return exactly:
{ "customerName": "", "customerPhone": "", "service": "", "date": "", "time": "", "notes": "", "confidence": 0.0 }`;

  const tier = await getUserTier(user.id);
  const result = await runTask<ParsedBooking>({
    userId: user.id,
    tier,
    taskType: "appointment_nl_parse",
    system,
    prompt,
    maxTokens: 500,
    idempotencyKey: `appt:${user.id}:${Date.now()}`,
    parse,
  });

  if (result.status === "fallback") {
    return NextResponse.json({ status: "fallback", reason: result.reason, message: result.message });
  }
  return NextResponse.json({ status: "ok", parsed: result.data });
}
