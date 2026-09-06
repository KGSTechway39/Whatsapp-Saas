/**
 * Money arithmetic and category mapping (Law #3: integer paise, never floats).
 *
 * Only the PURE helpers are covered here — quoteSend and friends read meta_rates
 * from the database and belong in an integration test with a real connection.
 * What is testable without a DB is exactly the part where a rounding slip turns
 * into a systematic under- or over-charge across every message sent.
 */
import { describe, it, expect } from "vitest";
import { toBillableCategory, rupeesToPaise, paiseToRupees } from "@/lib/billing/pricing";

describe("toBillableCategory", () => {
  it("maps the three billable Meta categories", () => {
    expect(toBillableCategory("MARKETING")).toBe("MARKETING");
    expect(toBillableCategory("UTILITY")).toBe("UTILITY");
    expect(toBillableCategory("AUTHENTICATION")).toBe("AUTHENTICATION");
  });

  it("is case-insensitive, because Meta and our own rows disagree on case", () => {
    expect(toBillableCategory("marketing")).toBe("MARKETING");
    expect(toBillableCategory("Utility")).toBe("UTILITY");
  });

  it("falls back to SERVICE for anything else", () => {
    // Free-form replies, media, and unknown/missing categories are all service
    // conversations. Defaulting to a BILLABLE category instead would charge
    // tenants for messages Meta does not bill us for.
    for (const input of [null, undefined, "", "  ", "SOMETHING_NEW"]) {
      expect(toBillableCategory(input)).toBe("SERVICE");
    }
  });
});

describe("rupeesToPaise", () => {
  it("converts whole rupees exactly", () => {
    expect(rupeesToPaise(1)).toBe(100);
    expect(rupeesToPaise(0)).toBe(0);
    expect(rupeesToPaise(1234)).toBe(123400);
  });

  it("rounds rather than truncating", () => {
    expect(rupeesToPaise(0.005)).toBe(1); // would be 0 if truncated
    expect(rupeesToPaise(0.004)).toBe(0);
  });

  it("survives binary floating point representations", () => {
    // 0.1 + 0.2 === 0.30000000000000004; a truncating conversion yields 30
    // paise here instead of 30 — and 8.7 * 100 is 869.9999... in IEEE 754,
    // which truncates to 869. Both are silent one-paise-per-message losses.
    expect(rupeesToPaise(0.1 + 0.2)).toBe(30);
    expect(rupeesToPaise(8.7)).toBe(870);
    expect(rupeesToPaise(1.005)).toBe(100); // JS rounds 100.49999... down
  });

  it("always returns an integer", () => {
    for (const r of [0.78, 1.15, 99.99, 0.001]) {
      expect(Number.isInteger(rupeesToPaise(r))).toBe(true);
    }
  });
});

describe("paiseToRupees", () => {
  it("is the inverse for whole paise", () => {
    expect(paiseToRupees(100)).toBe(1);
    expect(paiseToRupees(78)).toBe(0.78);
    expect(paiseToRupees(0)).toBe(0);
  });

  it("round-trips through rupeesToPaise for realistic per-message prices", () => {
    // These are the shapes real quotes take: sub-rupee marketing/utility sends.
    for (const paise of [78, 80, 150, 30, 1, 999999]) {
      expect(rupeesToPaise(paiseToRupees(paise))).toBe(paise);
    }
  });
});

describe("paise arithmetic invariants", () => {
  it("accumulates a broadcast without drift", () => {
    // A 6,250-recipient campaign at 78 paise. Summing in RUPEES accumulates
    // float error; summing in paise cannot.
    const unitPaise = 78;
    const recipients = 6250;
    let total = 0;
    for (let i = 0; i < recipients; i++) total += unitPaise;
    expect(total).toBe(487500);
    expect(Number.isInteger(total)).toBe(true);
    expect(paiseToRupees(total)).toBe(4875);
  });
});
