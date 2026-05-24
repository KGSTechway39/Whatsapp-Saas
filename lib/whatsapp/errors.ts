/**
 * Typed error classes for the WhatsApp module.
 *
 * Routes catch WhatsAppError and serialize {error, code} → HTTP. Anything
 * un-typed bubbles to a 500 with a generic message — never leak stack traces
 * or Meta error bodies to clients verbatim.
 */

export class WhatsAppError extends Error {
  /** HTTP status to return. */
  status: number;
  /** Stable code for clients to switch on (e.g. METAKIT_TOKEN_EXPIRED). */
  code: string;
  /** Optional structured details surfaced to logs (never to clients). */
  details?: Record<string, unknown>;

  constructor(message: string, opts: { status?: number; code?: string; details?: Record<string, unknown> } = {}) {
    super(message);
    this.status  = opts.status ?? 500;
    this.code    = opts.code   ?? "WHATSAPP_ERROR";
    this.details = opts.details;
  }
}

// ── Concrete subclasses ───────────────────────────────────────────────────

export class UnauthorizedError extends WhatsAppError {
  constructor(message = "Unauthorized") {
    super(message, { status: 401, code: "UNAUTHORIZED" });
  }
}

export class ForbiddenError extends WhatsAppError {
  constructor(message = "Forbidden") {
    super(message, { status: 403, code: "FORBIDDEN" });
  }
}

export class ValidationError extends WhatsAppError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, { status: 400, code: "VALIDATION_ERROR", details });
  }
}

export class TokenExchangeError extends WhatsAppError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, { status: 400, code: "TOKEN_EXCHANGE_FAILED", details });
  }
}

export class GraphApiError extends WhatsAppError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, { status: 502, code: "GRAPH_API_ERROR", details });
  }
}

export class NotFoundError extends WhatsAppError {
  constructor(resource = "Resource") {
    super(`${resource} not found`, { status: 404, code: "NOT_FOUND" });
  }
}

export class NoOrganizationError extends WhatsAppError {
  constructor() {
    super("No organization found for current user", { status: 403, code: "NO_ORGANIZATION" });
  }
}

export class NoWABAError extends WhatsAppError {
  constructor() {
    super(
      "No WhatsApp Business Accounts found in this Meta login. Make sure you granted access during signup.",
      { status: 400, code: "NO_WABA" },
    );
  }
}

// ── Adapter: turn any caught value into a serializable HTTP response ─────

import { ApiErrorResponse } from "./dto";

export function toApiError(err: unknown): { status: number; body: ApiErrorResponse } {
  if (err instanceof WhatsAppError) {
    return { status: err.status, body: { error: err.message, code: err.code } };
  }
  // Don't leak internals — but keep server logs detailed.
  const msg = err instanceof Error ? err.message : "Internal server error";
  return { status: 500, body: { error: msg, code: "INTERNAL_ERROR" } };
}
