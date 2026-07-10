/**
 * ALIAS → the canonical WhatsApp webhook lives at `/api/webhook/whatsapp`.
 *
 * Two paths existed historically:
 *   • `/api/webhook/whatsapp`  (singular) — the fully-implemented handler that
 *     runs against the DEPLOYED legacy schema (`whatsapp_numbers` / `user_id`):
 *     signature verify, dedup, CTWA capture, inbox + conversations, prepaid
 *     billing settlement, outbound webhook dispatch, and audit logging.
 *   • `/api/webhooks/whatsapp` (plural) — an earlier multi-tenant draft that
 *     resolved tenants from `whatsapp_accounts` / `organization_id`. That org
 *     model was never deployed, so in production it resolved no tenant and
 *     SILENTLY DROPPED every event.
 *
 * The onboarding UI and newer docs point Meta at this plural path, so we cannot
 * simply delete it — some numbers are already subscribed here. Instead this file
 * re-exports the canonical handlers, so both URLs behave identically and there is
 * ONE implementation to maintain. New integrations should use the singular path.
 */
export { GET, POST } from "@/app/api/webhook/whatsapp/route";
