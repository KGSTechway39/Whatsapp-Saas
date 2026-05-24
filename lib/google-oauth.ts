/**
 * Google Sign-In via OAuth 2.0 + OpenID Connect.
 *
 * Required env:
 *   GOOGLE_CLIENT_ID
 *   GOOGLE_CLIENT_SECRET
 *   NEXT_PUBLIC_SITE_URL    (used to build the redirect URI)
 *
 * Authorized redirect URI to register in Google Cloud Console:
 *   {NEXT_PUBLIC_SITE_URL}/api/auth/google/callback
 */

import { randomBytes, createHash } from "crypto";

const AUTH_URL  = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";

export interface GoogleProfile {
  sub: string;            // Google user ID — stable, unique
  email: string;
  email_verified: boolean;
  name: string;
  given_name?: string;
  family_name?: string;
  picture?: string;
  locale?: string;
}

/** Build the URL to redirect the browser to for consent. */
export function buildAuthUrl(state: string): string {
  const url = new URL(AUTH_URL);
  url.searchParams.set("client_id",     process.env.GOOGLE_CLIENT_ID || "");
  url.searchParams.set("redirect_uri",  redirectUri());
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope",         "openid email profile");
  url.searchParams.set("access_type",   "online");
  url.searchParams.set("prompt",        "select_account");
  url.searchParams.set("state",         state);
  return url.toString();
}

export function redirectUri(): string {
  const base = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";
  return `${base.replace(/\/$/, "")}/api/auth/google/callback`;
}

/** A short, signed-ish state token: random + tied to the original `from` path. */
export function makeState(from?: string | null): string {
  const nonce = randomBytes(12).toString("hex");
  const fromB64 = Buffer.from(from || "/dashboard").toString("base64url");
  return `${nonce}.${fromB64}`;
}

export function parseState(state: string): { from: string } {
  const parts = state.split(".");
  if (parts.length !== 2) return { from: "/dashboard" };
  try {
    const from = Buffer.from(parts[1], "base64url").toString("utf8");
    return { from: from.startsWith("/") ? from : "/dashboard" };
  } catch {
    return { from: "/dashboard" };
  }
}

/** Exchange the authorization code for tokens and the parsed user profile. */
export async function exchangeCode(code: string): Promise<GoogleProfile> {
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
    throw new Error("Google OAuth not configured (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET)");
  }

  const params = new URLSearchParams({
    code,
    client_id:     process.env.GOOGLE_CLIENT_ID!,
    client_secret: process.env.GOOGLE_CLIENT_SECRET!,
    redirect_uri:  redirectUri(),
    grant_type:    "authorization_code",
  });

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error_description || data.error || "Token exchange failed");

  // The id_token is a JWT — payload is the second segment, base64url-encoded.
  // We trust it because we just got it over TLS from accounts.google.com via
  // a backchannel POST authenticated by our client_secret. (For belt-and-braces
  // verification, swap in a JWKS verify against https://www.googleapis.com/oauth2/v3/certs.)
  const idToken: string | undefined = data.id_token;
  if (!idToken) throw new Error("No id_token in Google response");

  const [, payloadB64] = idToken.split(".");
  const json = Buffer.from(payloadB64, "base64url").toString("utf8");
  const profile = JSON.parse(json) as GoogleProfile;

  if (!profile.email) throw new Error("Google did not return an email");
  return profile;
}

/** Fingerprint a value (useful for Google's `sub` if we ever need to log it). */
export function shortHash(s: string): string {
  return createHash("sha256").update(s).digest("hex").slice(0, 12);
}
