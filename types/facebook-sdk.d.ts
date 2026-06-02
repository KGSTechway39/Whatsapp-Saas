/**
 * Global type declarations for the Meta JavaScript SDK (Facebook Login
 * for Business / WhatsApp Embedded Signup).
 *
 * Loaded asynchronously at runtime from
 *   https://connect.facebook.net/en_US/sdk.js
 *
 * Keep this the single source of truth for `window.FB` — duplicate
 * `declare global` blocks in components produce TS2687 / TS2717.
 */

interface FbAuthResponse {
  code?: string;
  waba_id?: string;
  phone_number_id?: string;
}

interface FbLoginResponse {
  status: "connected" | "not_authorized" | "unknown" | string;
  authResponse?: FbAuthResponse;
}

interface FbLoginOptions {
  config_id: string;
  response_type: "code" | "token";
  override_default_response_type?: boolean;
  override_min_version?: string;
  extras?: Record<string, unknown>;
}

interface FbSdk {
  init: (cfg: {
    appId: string;
    autoLogAppEvents: boolean;
    xfbml: boolean;
    version: string;
  }) => void;
  login: (
    cb: (resp: FbLoginResponse) => void,
    opts: FbLoginOptions,
  ) => void;
}

declare global {
  interface Window {
    FB?: FbSdk;
    fbAsyncInit?: () => void;
  }
}

export {};
