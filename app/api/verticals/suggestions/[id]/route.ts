/**
 * GET /api/verticals/suggestions/[id] — the flow graph behind one suggestion,
 * so the builder can open it on the canvas.
 *
 * This is the ONE place raw flow structure is sent to a client, and only because
 * the canvas editor needs it. It is never rendered as structure: the rails show
 * the customer's message, and the graph only appears once the person has chosen
 * to open the builder.
 *
 * Scoped to the caller's own industry — a client can only open suggestions from
 * the industry they were provisioned into.
 *
 * The graph is re-validated through `sanitizeFlowGraph` on the way out. The seeder
 * already validated it going in; doing it again here means an edited or
 * hand-inserted library row can never hand the canvas something it cannot render.
 *
 * Draft only: nothing is saved and nothing is activated. The person edits, saves
 * and turns it on themselves.
 */
import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";
import { getVerticalForUser } from "@/lib/verticals/repository";
import { sanitizeFlowGraph } from "@/lib/automation/flow-schema";
import { logger } from "@/lib/logger";
import type { FlowJsonPayload } from "@/lib/verticals/types";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const vertical = await getVerticalForUser(user.id);
  if (!vertical) {
    return NextResponse.json({ error: "This suggestion isn't available." }, { status: 404 });
  }

  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("vertical_template_library")
    .select("title, kind, payload, vertical_id, is_active")
    .eq("id", params.id)
    .eq("vertical_id", vertical.id) // scoped to the caller's own industry
    .eq("kind", "FLOW_JSON")
    .eq("is_active", true)
    .maybeSingle();

  if (error || !data) {
    return NextResponse.json({ error: "This suggestion isn't available." }, { status: 404 });
  }

  const row = data as { title: string; payload: FlowJsonPayload };
  try {
    const flow = sanitizeFlowGraph(row.payload.flow);
    return NextResponse.json({ name: row.title, flow });
  } catch (err) {
    // A library row that can't be rendered is our bug, not the client's problem.
    logger.warn("verticals: suggestion failed validation on read", {
      id: params.id,
      error: (err as Error).message,
    });
    return NextResponse.json({ error: "We couldn't open this suggestion. Please try another." }, { status: 500 });
  }
}
