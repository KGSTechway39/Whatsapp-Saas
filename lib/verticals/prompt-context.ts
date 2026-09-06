/**
 * Vertical context for the three AI features (Phase 3 injection).
 *
 * Scope discipline, restated because it is easy to erode:
 *   • This ADDS CONTEXT to an existing prompt. It does not add a fourth AI
 *     feature, a new task_type, or any autopilot behaviour.
 *   • It is appended to the USER prompt, never to the SYSTEM prompt. The system
 *     prompts encode the output format and safety contract that
 *     `sanitizeFlowGraph` and the template parser depend on; polluting them with
 *     variable content risks the JSON contract for a cosmetic gain.
 *   • Every word injected comes from the database. Nothing about an industry is
 *     hardcoded here, so an admin-created "Gym" steers the model exactly as well
 *     as a shipped vertical does.
 *   • A tenant with no vertical gets `null`, and the caller must then send the
 *     byte-identical prompt it sends today.
 */

import { createServiceClient } from "@/lib/supabase/server";
import { getVerticalForUser } from "./repository";

/** How many example titles to borrow. Enough to steer, small enough to stay cheap. */
const MAX_EXAMPLES = 6;

/**
 * A short, plain-language description of the tenant's industry, suitable for
 * appending to any of the three AI user prompts.
 *
 * Returns null when the tenant has no industry — the caller must treat that as
 * "send today's prompt unchanged".
 */
export async function buildVerticalPromptContext(userId: string): Promise<string | null> {
  const vertical = await getVerticalForUser(userId);
  if (!vertical) return null;

  const supabase = createServiceClient();
  const { data } = await supabase
    .from("vertical_template_library")
    .select("title, kind")
    .eq("vertical_id", vertical.id)
    .eq("is_active", true)
    .order("sort_order", { ascending: true })
    .limit(30);

  const rows = (data ?? []) as { title: string; kind: string }[];
  // Message titles describe what this industry actually sends; they steer tone
  // and subject matter better than the industry name alone.
  const examples = rows
    .filter((r) => r.kind === "MESSAGE_TEMPLATE" || r.kind === "FLOW_JSON")
    .slice(0, MAX_EXAMPLES)
    .map((r) => r.title);

  const lines = [
    `Business context: this is a ${vertical.displayName} business.`,
    vertical.description ? `About them: ${vertical.description}` : null,
    examples.length
      ? `Messages this kind of business typically sends: ${examples.join("; ")}.`
      : null,
    `Write for this industry — use its everyday vocabulary and the situations its customers actually have. Do not mention this context in the output.`,
  ].filter(Boolean);

  return lines.join("\n");
}

/**
 * Append the industry context to a user prompt.
 *
 * Returns the prompt unchanged when there is no context, so every call site can
 * be a one-line change with no branching.
 */
export function withVerticalContext(prompt: string, context: string | null): string {
  return context ? `${prompt}\n\n${context}` : prompt;
}
