import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";

const JWT_SECRET = new TextEncoder().encode(process.env.JWT_SECRET!);
export const SESSION_COOKIE = "wa_session";

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  company: string;
}

export async function createSessionToken(user: SessionUser): Promise<string> {
  return new SignJWT({ id: user.id, email: user.email, name: user.name, company: user.company })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(JWT_SECRET);
}

export async function verifySessionToken(token: string): Promise<SessionUser | null> {
  try {
    const { payload } = await jwtVerify(token, JWT_SECRET);
    return {
      id: payload.id as string,
      email: payload.email as string,
      name: payload.name as string,
      company: payload.company as string,
    };
  } catch {
    return null;
  }
}

export async function getSessionUser(): Promise<SessionUser | null> {
  const token = cookies().get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return verifySessionToken(token);
}

/**
 * Platform admins are defined by the ADMIN_EMAILS env var (comma-separated,
 * case-insensitive). There is no role column on `users` — admin is an operational
 * allowlist, kept out of the DB so it can't be self-granted.
 */
export function isAdminEmail(email?: string | null): boolean {
  if (!email) return false;
  const allow = (process.env.ADMIN_EMAILS || "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  return allow.includes(email.toLowerCase());
}

/** Return the session user only if they are a platform admin, else null. */
export async function requireAdmin(): Promise<SessionUser | null> {
  const user = await getSessionUser();
  if (!user || !isAdminEmail(user.email)) return null;
  return user;
}
