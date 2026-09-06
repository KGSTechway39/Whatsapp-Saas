/**
 * Resume parked automation flows.
 *
 * A waitNode parks a run in `chatbot_sessions` (status='waiting', resume_at,
 * current_node_id, context) and returns. Until now NOTHING read those rows back,
 * so any flow containing a delay stopped there permanently — the session sat in
 * 'waiting' forever and the customer never received the rest of the sequence.
 *
 * This is a SWEEP rather than a queue job: the trigger is the passage of time,
 * and there is no event to enqueue when a timer comes due. A scheduled caller
 * (/api/cron/resume-flows) asks for whatever is now due.
 *
 * Concurrency: each session is CLAIMED by flipping 'waiting' -> 'active' with a
 * compare-and-set before any work happens. Two overlapping sweeps therefore
 * cannot both resume the same session and double-send its remaining nodes.
 */

import { createClient } from "@/lib/supabase/server";
import { runFlow } from "./engine";
import { logger } from "@/lib/logger";

/** Sessions resumed per sweep. Bounded so one tick cannot run unboundedly long. */
const RESUME_BATCH = 25;

export interface ResumeSweepResult {
  due: number;
  resumed: number;
  parkedAgain: number;
  failed: number;
}

export async function resumeDueSessions(limit = RESUME_BATCH): Promise<ResumeSweepResult> {
  const supabase = createClient();
  const result: ResumeSweepResult = { due: 0, resumed: 0, parkedAgain: 0, failed: 0 };

  const { data: due, error } = await supabase
    .from("chatbot_sessions")
    .select("id, user_id, flow_id, contact_id, conversation_id, current_node_id, context")
    .eq("status", "waiting")
    .lte("resume_at", new Date().toISOString())
    .order("resume_at", { ascending: true })
    .limit(limit);

  if (error) {
    logger.error("resume sweep: query failed", { error: error.message });
    return result;
  }

  const sessions = (due ?? []) as Array<{
    id: string;
    user_id: string;
    flow_id: string;
    contact_id: string | null;
    conversation_id: string | null;
    current_node_id: string | null;
    context: Record<string, unknown> | null;
  }>;
  result.due = sessions.length;

  for (const session of sessions) {
    // Claim: only the sweep that flips this row proceeds.
    const { data: claimed } = await supabase
      .from("chatbot_sessions")
      .update({ status: "active", updated_at: new Date().toISOString() })
      .eq("id", session.id)
      .eq("status", "waiting")
      .select("id");

    if (!claimed || claimed.length === 0) continue; // another sweep took it

    try {
      const outcome = await runFlow({
        userId: session.user_id,
        flowId: session.flow_id,
        contactId: session.contact_id,
        conversationId: session.conversation_id,
        testMode: false,
        startNodeId: session.current_node_id,
        seedContext: session.context,
        resumeSessionId: session.id,
      });

      if (outcome.status === "waiting") {
        // Hit a second wait node; runFlow re-parked it with a fresh resume_at.
        result.parkedAgain++;
      } else if (outcome.status === "error") {
        result.failed++;
        logger.warn("resume sweep: flow errored", {
          sessionId: session.id,
          flowId: session.flow_id,
          error: outcome.error,
        });
      } else {
        result.resumed++;
      }
    } catch (err) {
      result.failed++;
      // Leave the session 'active' rather than forcing it back to 'waiting': a
      // resume_at in the past would make the next sweep retry immediately and
      // could loop on a permanently failing flow. An operator can requeue it.
      logger.error("resume sweep: unhandled error", {
        sessionId: session.id,
        flowId: session.flow_id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return result;
}
