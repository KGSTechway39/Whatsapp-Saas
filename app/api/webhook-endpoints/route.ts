import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { generateSecret } from "@/lib/webhooks-out";

const SUPPORTED_EVENTS = [
  "message.sent", "message.delivered", "message.read", "message.failed", "message.received",
  "contact.created", "contact.updated", "campaign.completed",
];

// GET /api/webhook-endpoints — list user's outbound webhooks
export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const supabase = createClient();
  const { data, error } = await supabase
    .from("webhook_endpoints")
    .select("id, name, url, events, status, last_delivery_at, last_success_at, failure_count, total_deliveries, created_at")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ endpoints: data, supported_events: SUPPORTED_EVENTS });
}

// POST /api/webhook-endpoints — create endpoint (returns signing secret ONCE)
export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  if (!body.url?.trim()) return NextResponse.json({ error: "url is required" }, { status: 400 });
  try {
    const u = new URL(body.url);
    if (!/^https?:$/.test(u.protocol)) throw new Error("URL must be http(s)");
  } catch {
    return NextResponse.json({ error: "Invalid URL" }, { status: 400 });
  }

  const events: string[] = Array.isArray(body.events) && body.events.length > 0
    ? body.events.filter((e: string) => SUPPORTED_EVENTS.includes(e))
    : SUPPORTED_EVENTS;

  const secret = generateSecret();

  const supabase = createClient();
  const { data, error } = await supabase
    .from("webhook_endpoints")
    .insert({
      user_id: user.id,
      name: body.name?.trim() || null,
      url: body.url.trim(),
      secret,
      events,
      status: "active",
    })
    .select("id, name, url, events, status, created_at")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({
    endpoint: { ...data, signing_secret: secret },
    warning: "Save this signing secret now — it won't be shown again. Use it to verify the X-WASend-Signature header on every event.",
  }, { status: 201 });
}
