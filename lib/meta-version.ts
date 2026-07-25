/**
 * Single source of truth for Meta Graph / SDK versions.
 *
 * Two constants because two things move independently:
 *
 * - GRAPH_API_VERSION — plain server-to-server Graph calls (messaging, media,
 *   templates, Marketing/CTWA). Bump here to upgrade every such caller at once.
 *
 * - META_SDK_VERSION — the Embedded Signup chain, which MUST match the Facebook
 *   JS SDK version loaded in the browser (components/whatsapp/EmbeddedSignupModal
 *   → FB.init({ version })). The onboard/token-exchange server routes share it so
 *   the whole ESU handshake speaks one version. Upgrading this requires retesting
 *   Embedded Signup end-to-end — do not bump it casually.
 */
export const GRAPH_API_VERSION = "v22.0";
export const META_SDK_VERSION = "v19.0";

/** Base URLs derived from the constants above — prefer these over string literals. */
export const GRAPH_API_BASE = `https://graph.facebook.com/${GRAPH_API_VERSION}`;
export const GRAPH_SDK_BASE = `https://graph.facebook.com/${META_SDK_VERSION}`;
/** Facebook OAuth dialog host (www, not graph). */
export const FB_DIALOG_BASE = `https://www.facebook.com/${GRAPH_API_VERSION}`;
