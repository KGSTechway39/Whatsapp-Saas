/**
 * In-memory cache for the short window between `exchange-token` and
 * `save-account`. The plaintext access token NEVER reaches the browser —
 * the client only sees an opaque `transferId`.
 *
 * Constraints:
 *   • TTL ≤ 10 minutes
 *   • Single-instance only — for multi-instance deployments swap this
 *     for Redis (Upstash) or signed JWE cookies.
 *   • A second `get()` consumes the entry (one-shot semantics).
 */

interface CachedToken {
  token: string;
  expiresInSeconds: number | null;
  systemUserId: string | null;
  scopes: string[];
  userId: string;
  createdAt: number;
}

const cache = new Map<string, { value: CachedToken; expiresAt: number }>();

const SWEEP_INTERVAL = 60 * 1000;
setInterval(() => {
  const now = Date.now();
  Array.from(cache.entries()).forEach(([k, e]) => {
    if (e.expiresAt <= now) cache.delete(k);
  });
}, SWEEP_INTERVAL).unref?.();

export function putTokenInCache(
  transferId: string,
  value: CachedToken,
  ttlSeconds: number,
): void {
  cache.set(transferId, {
    value,
    expiresAt: Date.now() + Math.min(ttlSeconds, 600) * 1000,
  });
}

export function consumeTokenFromCache(transferId: string): CachedToken | null {
  const e = cache.get(transferId);
  if (!e) return null;
  cache.delete(transferId);
  if (e.expiresAt <= Date.now()) return null;
  return e.value;
}
