import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { withApiAuth, ApiAuthError } from "@/lib/api-keys";
import { dispatchEvent } from "@/lib/webhooks-out";

// POST /api/v1/messages
// Auth: Bearer wasend_… with scope `messages:write`
//
// Body:
// {
//   "to":          "+919876543210",         // E.164
//   "from":        "<whatsapp_number_id>",   // optional; defaults to primary
//   "type":        "template" | "text",
//   "template":    { "name": "...", "language": "en", "variables": ["...", ...] },
//   "text":        "Hello!"
// }
export async function POST(req: NextRequest) {
  try {
    const ctx = await withApiAuth(req, "messages:write");
    const body = await req.json();

    if (!body.to || typeof body.to !== "string") {
      return NextResponse.json({ error: "to is required (E.164 phone)", code: "VALIDATION_ERROR" }, { status: 400 });
    }
    const to = body.to.replace(/[^\d+]/g, "");
    const type = body.type === "text" ? "text" : "template";

    if (type === "template" && !body.template?.name) {
      return NextResponse.json({ error: "template.name required for type=template", code: "VALIDATION_ERROR" }, { status: 400 });
    }
    if (type === "text" && !body.text) {
      return NextResponse.json({ error: "text required for type=text", code: "VALIDATION_ERROR" }, { status: 400 });
    }

    const supabase = createServiceClient();

    // Pick sending number
    let numberId = body.from as string | undefined;
    if (!numberId) {
      const { data: num } = await supabase
        .from("whatsapp_numbers")
        .select("id")
        .eq("user_id", ctx.userId)
        .eq("status", "active")
        .order("is_primary", { ascending: false })
        .limit(1)
        .maybeSingle();
      numberId = num?.id;
    }
    if (!numberId) {
      return NextResponse.json({ error: "No active WhatsApp number connected", code: "NO_ACTIVE_NUMBER" }, { status: 400 });
    }

    // Look up the contact (or create one if not present — convenience for API users)
    let contactId: string | null = null;
    const { data: existing } = await supabase
      .from("contacts")
      .select("id")
      .eq("user_id", ctx.userId)
      .eq("phone", to)
      .maybeSingle();
    if (existing) {
      contactId = existing.id;
    } else {
      const { data: created } = await supabase
        .from("contacts")
        .insert({
          user_id: ctx.userId,
          name: body.name || `Lead ${to.slice(-4)}`,
          phone: to,
          crm_source: "manual",
          tags: ["api"],
        })
        .select("id")
        .single();
      contactId = created?.id ?? null;
    }

    // Wrap in a synthetic campaign (single recipient) so analytics + tracking
    // flow through the existing pipeline.
    const { data: campaign } = await supabase
      .from("campaigns")
      .insert({
        user_id: ctx.userId,
        name: `API send to ${to}`,
        description: `Sent via API (${ctx.environment}) — ${type}`,
        status: "running",
        whatsapp_number_id: numberId,
        audience_type: "tags",
        recipients_count: 1,
        started_at: new Date().toISOString(),
      })
      .select("id")
      .single();

    if (!campaign) {
      return NextResponse.json({ error: "Failed to create message", code: "INTERNAL" }, { status: 500 });
    }

    const { data: msg, error: msgErr } = await supabase
      .from("campaign_messages")
      .insert({
        campaign_id: campaign.id,
        contact_id: contactId,
        phone: to,
        status: "pending",
      })
      .select("id, status, created_at")
      .single();

    if (msgErr) return NextResponse.json({ error: msgErr.message, code: "DB_ERROR" }, { status: 500 });

    // Fire 'message.sent' webhook (the actual Meta send happens in the
    // campaign worker / direct integration; status webhooks fire when Meta
    // delivery callbacks come in via /api/webhook/whatsapp).
    dispatchEvent(supabase, ctx.userId, "message.sent", {
      id: msg.id,
      to,
      from_number_id: numberId,
      type,
      template: body.template || null,
      text: body.text || null,
      created_at: msg.created_at,
    }).catch(() => {});

    return NextResponse.json({
      id: msg.id,
      object: "message",
      to,
      from: numberId,
      type,
      status: msg.status,
      created_at: msg.created_at,
    }, { status: 201 });
  } catch (err) {
    if (err instanceof ApiAuthError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
    }
    return NextResponse.json({ error: err instanceof Error ? err.message : "Internal error", code: "INTERNAL" }, { status: 500 });
  }
}

// GET /api/v1/messages?limit=20&status=delivered
export async function GET(req: NextRequest) {
  try {
    const ctx = await withApiAuth(req, "messages:read");
    const sp = req.nextUrl.searchParams;
    const limit = Math.min(100, Math.max(1, Number(sp.get("limit")) || 20));
    const status = sp.get("status");

    const supabase = createServiceClient();
    // Pull messages by joining campaigns of this user.
    const { data: campaigns } = await supabase
      .from("campaigns")
      .select("id")
      .eq("user_id", ctx.userId)
      .order("created_at", { ascending: false })
      .limit(500);

    const ids = (campaigns || []).map((c) => c.id);
    if (ids.length === 0) return NextResponse.json({ data: [], has_more: false });

    let q = supabase
      .from("campaign_messages")
      .select("id, campaign_id, contact_id, phone, status, sent_at, delivered_at, read_at, created_at, error_message")
      .in("campaign_id", ids)
      .order("created_at", { ascending: false })
      .limit(limit);
    if (status) q = q.eq("status", status);

    const { data } = await q;
    return NextResponse.json({
      data: (data || []).map((m) => ({
        id: m.id,
        object: "message",
        to: m.phone,
        status: m.status,
        sent_at: m.sent_at,
        delivered_at: m.delivered_at,
        read_at: m.read_at,
        created_at: m.created_at,
        error: m.error_message,
      })),
      has_more: (data?.length ?? 0) === limit,
    });
  } catch (err) {
    if (err instanceof ApiAuthError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
    }
    return NextResponse.json({ error: err instanceof Error ? err.message : "Internal error", code: "INTERNAL" }, { status: 500 });
  }
}
