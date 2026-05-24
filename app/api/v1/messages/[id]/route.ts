import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { withApiAuth, ApiAuthError } from "@/lib/api-keys";

// GET /api/v1/messages/:id — retrieve a single message status
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const ctx = await withApiAuth(req, "messages:read");
    const supabase = createServiceClient();

    const { data: msg } = await supabase
      .from("campaign_messages")
      .select("id, campaign_id, phone, status, sent_at, delivered_at, read_at, error_message, created_at, campaigns!inner(user_id)")
      .eq("id", params.id)
      .single();

    type Joined = { campaigns: { user_id: string } | { user_id: string }[] };
    const campaign = (msg as Joined | null)?.campaigns;
    const ownerId = Array.isArray(campaign) ? campaign[0]?.user_id : campaign?.user_id;
    if (!msg || ownerId !== ctx.userId) {
      return NextResponse.json({ error: "Not found", code: "NOT_FOUND" }, { status: 404 });
    }

    return NextResponse.json({
      id: msg.id,
      object: "message",
      to: msg.phone,
      status: msg.status,
      sent_at: msg.sent_at,
      delivered_at: msg.delivered_at,
      read_at: msg.read_at,
      created_at: msg.created_at,
      error: msg.error_message,
    });
  } catch (err) {
    if (err instanceof ApiAuthError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
    }
    return NextResponse.json({ error: err instanceof Error ? err.message : "Internal error", code: "INTERNAL" }, { status: 500 });
  }
}
