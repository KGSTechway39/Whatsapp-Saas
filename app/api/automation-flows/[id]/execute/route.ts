/**
 * POST /api/automation-flows/[id]/execute — run one pass of a canvas flow.
 *
 * This route is now a thin HTTP wrapper. The walker itself lives in
 * lib/automation/engine.ts so that production inbound automation can run the
 * SAME code this endpoint previews — previously the full engine existed only
 * here, and inbound traffic went down a separate path that sent one reply and
 * ignored every node after it.
 *
 * The builder calls this with testMode:true, which walks every node and reports
 * what would happen without performing any side effect.
 *
 * TENANT SCOPING (Law #1): contactId/conversationId arrive in the request body
 * and are attacker-controlled. runFlow() re-validates that both belong to the
 * caller before anything uses them; it never trusts the ids on their own.
 */
import { getSessionUser } from "@/lib/auth";
import { NextRequest, NextResponse } from "next/server";
import { runFlow } from "@/lib/automation/engine";

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { contactId, conversationId, testMode = false } = await req.json();

  const result = await runFlow({
    userId: user.id,
    flowId: params.id,
    contactId,
    conversationId,
    testMode,
  });

  if (result.status === "error") {
    // "Flow not found" covers both a missing flow and one owned by someone else —
    // deliberately indistinguishable, so this cannot be used to probe for the
    // existence of another tenant's flows.
    const code = result.error === "Flow not found" ? 404 : 400;
    return NextResponse.json({ error: result.error ?? "Flow failed" }, { status: code });
  }

  return NextResponse.json({
    log: result.log,
    status: result.status,
    sessionId: result.sessionId,
  });
}
