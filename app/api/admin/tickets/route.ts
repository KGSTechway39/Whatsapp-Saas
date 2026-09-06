/**
 * Admin: support tickets (platform-side, ops console).
 *
 *   GET    ?status=open|all&limit=  → { tickets }
 *   POST   { userId|email, subject, body?, category?, priority? }  → { ticket }
 *   PATCH  { id, status?, priority?, assignedTo? }                 → { ticket }
 *
 * Gated by requireAdmin() (ADMIN_EMAILS allowlist); 403 otherwise. Every
 * mutation is audited — support staff act on other people's accounts, so who
 * changed what has to be reconstructable.
 */
import { NextRequest, NextResponse } from "next/server";
import { requirePlatformStaff } from "@/lib/roles";
import { audit } from "@/lib/audit";
import { createServiceClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const CATEGORIES = ["onboarding", "number", "template", "billing", "webhook", "api", "other"] as const;
const PRIORITIES = ["low", "medium", "high", "urgent"] as const;
const STATUSES = ["open", "in_progress", "waiting", "resolved", "closed"] as const;
/** Terminal states — entering one stamps resolved_at, leaving one clears it. */
const CLOSED_STATES = new Set(["resolved", "closed"]);

// The embed names its FK constraint explicitly: support_tickets has THREE
// foreign keys to users (user_id, assigned_to, created_by), so a bare
// `users(...)` is ambiguous and PostgREST refuses it. We always want the
// tenant the ticket is about.
const SELECT = "id, subject, body, category, priority, status, assigned_to, created_at, updated_at, resolved_at, user_id, users!support_tickets_user_id_fkey(email, full_name, company_name)";

interface Row {
  id: string;
  subject: string;
  body: string;
  category: string;
  priority: string;
  status: string;
  assigned_to: string | null;
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
  user_id: string;
  users: { email: string; full_name: string | null; company_name: string | null } | null;
}

function shape(r: Row) {
  return {
    id: r.id,
    subject: r.subject,
    body: r.body,
    category: r.category,
    priority: r.priority,
    status: r.status,
    assignedTo: r.assigned_to,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    resolvedAt: r.resolved_at,
    userId: r.user_id,
    tenant: r.users?.company_name || r.users?.full_name || r.users?.email || "Unknown tenant",
    tenantEmail: r.users?.email ?? "",
  };
}

export async function GET(request: NextRequest) {
  const admin = await requirePlatformStaff();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const status = request.nextUrl.searchParams.get("status") ?? "open";
  const limit = Math.min(Number(request.nextUrl.searchParams.get("limit")) || 50, 200);

  const supabase = createServiceClient();
  let q = supabase.from("support_tickets").select(SELECT);
  // "open" means everything still actionable, not literally status='open' —
  // a ticket parked on Meta is still the ops team's problem.
  if (status === "open") q = q.in("status", ["open", "in_progress", "waiting"]);
  else if (status !== "all") q = q.eq("status", status);

  const { data, error } = await q.order("created_at", { ascending: false }).limit(limit);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ tickets: ((data ?? []) as unknown as Row[]).map(shape) });
}

export async function POST(request: NextRequest) {
  const admin = await requirePlatformStaff();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await request.json().catch(() => ({}));
  const subject = String(body.subject ?? "").trim();
  if (!subject) return NextResponse.json({ error: "subject is required" }, { status: 400 });

  const category = CATEGORIES.includes(body.category) ? body.category : "other";
  const priority = PRIORITIES.includes(body.priority) ? body.priority : "medium";

  const supabase = createServiceClient();

  // Resolve the tenant by id or email — support staff normally have an email.
  let userId: string | null = body.userId ?? null;
  if (!userId && body.email) {
    const { data: user } = await supabase
      .from("users")
      .select("id")
      .eq("email", String(body.email).toLowerCase())
      .maybeSingle<{ id: string }>();
    userId = user?.id ?? null;
  }
  if (!userId) {
    return NextResponse.json({ error: "Tenant not found — pass a valid userId or email" }, { status: 404 });
  }

  const { data, error } = await supabase
    .from("support_tickets")
    .insert({
      user_id: userId,
      subject,
      body: String(body.body ?? ""),
      category,
      priority,
      status: "open",
      created_by: admin.id,
    })
    .select(SELECT)
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await audit({
    action: "support_ticket.create",
    userId: admin.id,
    resourceType: "support_tickets",
    resourceId: (data as unknown as Row).id,
    request,
    details: { tenant_id: userId, subject, category, priority },
  });

  return NextResponse.json({ ticket: shape(data as unknown as Row) }, { status: 201 });
}

export async function PATCH(request: NextRequest) {
  const admin = await requirePlatformStaff();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await request.json().catch(() => ({}));
  const id = String(body.id ?? "").trim();
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (body.status !== undefined) {
    if (!STATUSES.includes(body.status)) {
      return NextResponse.json({ error: `status must be one of ${STATUSES.join(", ")}` }, { status: 400 });
    }
    patch.status = body.status;
    // Keep resolved_at consistent with status in the same write, so
    // time-to-resolution can never be computed from a stale timestamp.
    patch.resolved_at = CLOSED_STATES.has(body.status) ? new Date().toISOString() : null;
  }
  if (body.priority !== undefined) {
    if (!PRIORITIES.includes(body.priority)) {
      return NextResponse.json({ error: `priority must be one of ${PRIORITIES.join(", ")}` }, { status: 400 });
    }
    patch.priority = body.priority;
  }
  if (body.assignedTo !== undefined) patch.assigned_to = body.assignedTo || null;

  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("support_tickets")
    .update(patch)
    .eq("id", id)
    .select(SELECT)
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Ticket not found" }, { status: 404 });

  await audit({
    action: "support_ticket.update",
    userId: admin.id,
    resourceType: "support_tickets",
    resourceId: id,
    request,
    details: patch,
  });

  return NextResponse.json({ ticket: shape(data as unknown as Row) });
}
