/**
 * The 24-hour customer service window (Law #5).
 *
 * "Free-form only inside an open window; templates required outside it." Getting
 * this wrong is not a cosmetic bug: a free-form send outside the window is
 * rejected by Meta with 131047, and the reverse mistake (refusing a send that
 * was actually allowed) silently drops customer replies.
 *
 * `now` is injected into windowStateFrom, so these assert real boundaries rather
 * than mocking the clock.
 */
import { describe, it, expect } from "vitest";
import { windowStateFrom, canSend, WINDOW_MS } from "@/lib/whatsapp/window";

const NOW = Date.parse("2026-09-08T12:00:00.000Z");
const iso = (ms: number) => new Date(ms).toISOString();

describe("windowStateFrom", () => {
  it("is closed when the contact has never messaged in", () => {
    for (const empty of [null, undefined, ""]) {
      const s = windowStateFrom(empty as string | null, NOW);
      expect(s.open).toBe(false);
      expect(s.expiresAt).toBeNull();
      expect(s.msRemaining).toBe(0);
    }
  });

  it("is open just inside 24 hours", () => {
    const s = windowStateFrom(iso(NOW - WINDOW_MS + 1000), NOW);
    expect(s.open).toBe(true);
    expect(s.msRemaining).toBe(1000);
  });

  it("is closed exactly at the boundary", () => {
    // Exactly 24h elapsed means remaining === 0, which is NOT open. An
    // off-by-one here would send a free-form message Meta then rejects.
    const s = windowStateFrom(iso(NOW - WINDOW_MS), NOW);
    expect(s.open).toBe(false);
    expect(s.msRemaining).toBe(0);
  });

  it("is closed past the boundary and never reports negative time", () => {
    const s = windowStateFrom(iso(NOW - WINDOW_MS - 60_000), NOW);
    expect(s.open).toBe(false);
    expect(s.msRemaining).toBe(0);
  });

  it("reports the expiry as exactly 24h after the last inbound", () => {
    const last = iso(NOW - 3 * 60 * 60 * 1000);
    const s = windowStateFrom(last, NOW);
    expect(s.expiresAt).toBe(iso(Date.parse(last) + WINDOW_MS));
    expect(s.msRemaining).toBe(21 * 60 * 60 * 1000);
  });

  it("treats a future last_inbound_at as open rather than throwing", () => {
    // Clock skew between Meta's timestamp and ours must not crash the send path.
    const s = windowStateFrom(iso(NOW + 60_000), NOW);
    expect(s.open).toBe(true);
  });
});

describe("canSend", () => {
  const open = windowStateFrom(iso(NOW - 1000), NOW);
  const closed = windowStateFrom(iso(NOW - WINDOW_MS - 1000), NOW);
  const never = windowStateFrom(null, NOW);

  it("always allows a template — that is what templates are for", () => {
    for (const state of [open, closed, never]) {
      expect(canSend("template", state)).toEqual({ ok: true });
    }
  });

  it("allows free-form only while the window is open", () => {
    for (const kind of ["text", "interactive"] as const) {
      expect(canSend(kind, open)).toEqual({ ok: true });
      expect(canSend(kind, closed)).toEqual({ ok: false, reason: "OUTSIDE_24H_WINDOW" });
      expect(canSend(kind, never)).toEqual({ ok: false, reason: "OUTSIDE_24H_WINDOW" });
    }
  });

  it("returns a reason code callers can branch on", () => {
    const verdict = canSend("text", closed);
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.reason).toBe("OUTSIDE_24H_WINDOW");
  });
});
