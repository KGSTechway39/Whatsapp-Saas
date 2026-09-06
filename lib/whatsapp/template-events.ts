/**
 * Template lifecycle events from Meta — the "templates arrive automatically" path.
 *
 * We already subscribe to `message_template_status_update` (see
 * /api/meta/subscribe-webhook), so Meta pushes an event every time a template
 * is created, approved, rejected, disabled or re-categorised. The webhook was
 * throwing those away — it only looked at `messages` and `statuses` and never
 * branched on `change.field`. That is why a template approved at Meta never
 * showed up here until someone pressed Sync by hand.
 *
 * With this, approval lands in the app within seconds and with no polling.
 * A periodic sync remains useful as a backstop for events missed while the
 * app was down, but it is no longer the only way templates arrive.
 *
 * Meta's payload:
 *   field: "message_template_status_update"
 *   value: {
 *     event: APPROVED | REJECTED | PENDING | PENDING_DELETION | DISABLED | FLAGGED,
 *     message_template_id, message_template_name, message_template_language,
 *     reason
 *   }
 */
import { createServiceClient } from "@/lib/supabase/server";
import { logger } from "@/lib/logger";

export interface TemplateStatusValue {
  event?: string;
  message_template_id?: number | string;
  message_template_name?: string;
  message_template_language?: string;
  reason?: string;
}

/** Meta's lifecycle events → our three-state column. */
function mapStatus(event: string | undefined): "APPROVED" | "PENDING" | "REJECTED" | null {
  switch ((event ?? "").toUpperCase()) {
    case "APPROVED":
      return "APPROVED";
    case "PENDING":
    case "PENDING_DELETION":
      return "PENDING";
    case "REJECTED":
    case "DISABLED":
    // FLAGGED means Meta has paused it — it cannot be sent, so treat it the
    // same as rejected rather than leaving it looking sendable.
    case "FLAGGED":
      return "REJECTED";
    default:
      return null;
  }
}

/**
 * Apply one template status event.
 *
 * Matching is by Meta's template id first, then by (name, language) — a
 * template created outside SendAnjal has no local row carrying its id yet, and
 * name+language is Meta's own uniqueness key for a template.
 *
 * Always writes `meta_template_id`. That column is what makes a row actually
 * sendable (see lib/whatsapp/template-sendable.ts): a row without it has never
 * been to Meta, and sending it fails with a misleading "(#132001) does not
 * exist". An approval event is precisely the moment we learn that id.
 */
export async function applyTemplateStatusEvent(
  wabaId: string | null,
  value: TemplateStatusValue,
): Promise<{ applied: boolean; reason: string }> {
  const status = mapStatus(value.event);
  const name = value.message_template_name;
  const metaId = value.message_template_id != null ? String(value.message_template_id) : null;

  if (!status || !name) {
    return { applied: false, reason: `unhandled event '${value.event ?? "?"}'` };
  }

  const supabase = createServiceClient();

  // Resolve the owning tenant from the WABA that raised the event. Without it
  // we cannot scope the write, and writing an unscoped template row would be
  // a cross-tenant leak (Law 1).
  let userId: string | null = null;
  if (wabaId) {
    const { data } = await supabase
      .from("whatsapp_numbers")
      .select("user_id")
      .eq("waba_id", wabaId)
      .limit(1)
      .maybeSingle<{ user_id: string }>();
    userId = data?.user_id ?? null;
  }
  if (!userId) {
    return { applied: false, reason: `no tenant for waba ${wabaId ?? "(none)"}` };
  }

  const language = value.message_template_language ?? "en_US";

  // Find the local row: by Meta id, else by name+language.
  let localId: string | null = null;
  if (metaId) {
    const { data } = await supabase
      .from("templates")
      .select("id")
      .eq("user_id", userId)
      .eq("meta_template_id", metaId)
      .maybeSingle<{ id: string }>();
    localId = data?.id ?? null;
  }
  if (!localId) {
    const { data } = await supabase
      .from("templates")
      .select("id")
      .eq("user_id", userId)
      .eq("name", name)
      .eq("language", language)
      .maybeSingle<{ id: string }>();
    localId = data?.id ?? null;
  }

  // Explicitly typed: the inferred literal union collides with the generated
  // Supabase row type, and the column is plain text.
  const patch: Record<string, unknown> = {
    status,
    meta_template_id: metaId,
    language,
    updated_at: new Date().toISOString(),
  };

  // The library mirrors what Meta has APPROVED. A template Meta rejects,
  // disables or flags can never be sent, so it is removed rather than left
  // sitting in the picker as a row that fails at send time.
  if (status === "REJECTED") {
    if (localId) {
      await supabase.from("templates").delete().eq("user_id", userId).eq("id", localId);
      logger.info("templates: removed after Meta rejected/disabled it", { name, metaId });
      return { applied: true, reason: `removed ${name} (rejected by Meta)` };
    }
    return { applied: true, reason: `ignored rejection for unknown ${name}` };
  }

  if (localId) {
    const { error } = await supabase.from("templates").update(patch).eq("id", localId);
    if (error) return { applied: false, reason: error.message };
    logger.info("templates: status updated from Meta", { name, templateStatus: status, metaId });
    return { applied: true, reason: `updated ${name} → ${status}` };
  }

  // Only APPROVED templates get created from an event for a template we have
  // never seen. A PENDING one we do not know about has nothing to show yet and
  // would appear as an unsendable row; it arrives on approval instead.
  if (status !== "APPROVED") {
    return { applied: true, reason: `ignored ${status} for unknown ${name}` };
  }

  // Created directly in Meta's UI / Business Manager — bring it in rather than
  // ignoring it. Body is left empty here because this event carries no content;
  // the next sync fills it. Recording it now means it is visible immediately
  // and its approval state is right.
  const { error } = await supabase.from("templates").insert({
    user_id: userId,
    name,
    display_name: name.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
    category: "UTILITY",
    body: "",
    variables: [],
    ...patch,
  });
  if (error) return { applied: false, reason: error.message };

  logger.info("templates: new template received from Meta", { name, templateStatus: status, metaId });
  return { applied: true, reason: `created ${name} → ${status}` };
}
