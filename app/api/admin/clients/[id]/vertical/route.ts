/**
 * Admin: read / set / clear a client's industry.
 *
 *   GET  → { client: { id, email, full_name, tier }, vertical | null }
 *   POST { verticalId: string | null } → provisions, changes, or clears it
 *
 * NON-DESTRUCTIVE by construction: this writes exactly one column
 * (users.vertical_id). Flows, campaigns and templates the client already has are
 * their own rows and are never touched — changing the industry only changes what
 * appears on their "recommended" rails.
 *
 * Vertical is orthogonal to tier/billing: nothing here reads or writes
 * billing_mode, tier or waba_mode.
 *
 * Platform staff only (requirePlatformStaff: super_admin or tenant_admin).
 */
import { NextRequest, NextResponse } from "next/server";
import { requirePlatformStaff } from "@/lib/roles";
import { audit } from "@/lib/audit";
import { createServiceClient } from "@/lib/supabase/server";
import { getVerticalById, setVerticalForUser } from "@/lib/verticals/repository";
import { logger } from "@/lib/logger";

interface ClientRow {
  id: string;
  email: string;
  full_name: string | null;
  tier: string | null;
  vertical_id: string | null;
}

async function loadClient(userId: string): Promise<ClientRow | null> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("users")
    .select("id, email, full_name, tier, vertical_id")
    .eq("id", userId)
    .maybeSingle<ClientRow>();
  if (error) throw new Error(error.message);
  return data ?? null;
}

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const admin = await requirePlatformStaff();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  let client: ClientRow | null;
  try {
    client = await loadClient(params.id);
  } catch (err) {
    logger.warn("admin.clients.vertical: lookup failed", { error: (err as Error).message });
    return NextResponse.json({ error: "We couldn't load this client. Please try again." }, { status: 500 });
  }
  if (!client) return NextResponse.json({ error: "We couldn't find that client." }, { status: 404 });

  const vertical = client.vertical_id ? await getVerticalById(client.vertical_id) : null;
  return NextResponse.json({
    client: { id: client.id, email: client.email, full_name: client.full_name, tier: client.tier },
    vertical,
  });
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const admin = await requirePlatformStaff();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  let verticalId: string | null;
  try {
    ({ verticalId } = (await req.json()) as { verticalId: string | null });
  } catch {
    return NextResponse.json({ error: "We couldn't read that request. Please try again." }, { status: 400 });
  }

  let client: ClientRow | null;
  try {
    client = await loadClient(params.id);
  } catch {
    return NextResponse.json({ error: "We couldn't load this client. Please try again." }, { status: 500 });
  }
  if (!client) return NextResponse.json({ error: "We couldn't find that client." }, { status: 404 });

  try {
    await setVerticalForUser(client.id, verticalId ?? null);
  } catch (err) {
    logger.warn("admin.clients.vertical: update failed", { error: (err as Error).message });
    return NextResponse.json(
      { error: "We couldn't save the industry. Check your connection and try again." },
      { status: 500 },
    );
  }

  const vertical = verticalId ? await getVerticalById(verticalId) : null;
  await audit({
    action: "vertical.assign",
    userId: admin.id,
    resourceType: "users",
    resourceId: client.id,
    request: req,
    details: { target_email: client.email, vertical_id: verticalId ?? null, vertical_slug: vertical?.slug ?? null },
  });
  return NextResponse.json({
    client: { id: client.id, email: client.email, full_name: client.full_name, tier: client.tier },
    vertical,
  });
}
