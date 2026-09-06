/**
 * AI tier gating and cost arithmetic.
 *
 * Two things are being protected here:
 *
 * 1. `tierAllows` is the HARD capability gate. Hiding a button in the UI is
 *    cosmetic; this map is what actually stops a Starter tenant running a
 *    Growth-tier task. A wrong entry is an entitlement bug, not a styling one.
 *
 * 2. `rawCostPaise` is the margin denominator — the provider's real token cost,
 *    before markup. If it understates, every margin figure on the platform is
 *    optimistic, and nobody notices until the AI bill arrives.
 */
import { describe, it, expect } from "vitest";
import { tierAllows, rawCostPaise, type ModelConfig } from "@/lib/ai/config";

/** Haiku 4.5 at $1/$5 per MTok, in paise, matching the seeded config rows. */
const HAIKU: ModelConfig = {
  taskType: "campaign_content",
  provider: "anthropic",
  modelId: "claude-haiku-4-5",
  inputPricePerMillionPaise: 8300,
  outputPricePerMillionPaise: 41500,
  markupMultiplier: 6,
  creditsPerAction: 1,
  timeoutMs: 15000,
  maxRegens: 5,
};

describe("tierAllows", () => {
  it("gives Starter only the entry-level tasks", () => {
    expect(tierAllows("starter", "campaign_content")).toBe(true);
    expect(tierAllows("starter", "appointment_nl_parse")).toBe(true);
    // template_content predates AI credits and is free on every tier.
    expect(tierAllows("starter", "template_content")).toBe(true);
  });

  it("withholds the automation tasks from Starter", () => {
    for (const task of [
      "automation_flow_builder",
      "automation_runtime_intent",
      "automation_ai_reply",
      "reminder_draft",
    ] as const) {
      expect(tierAllows("starter", task)).toBe(false);
    }
  });

  it("gives Growth and Enterprise the full set", () => {
    for (const tier of ["growth", "enterprise"] as const) {
      for (const task of [
        "campaign_content",
        "appointment_nl_parse",
        "automation_flow_builder",
        "automation_runtime_intent",
        "automation_ai_reply",
        "reminder_draft",
        "template_content",
      ] as const) {
        expect(tierAllows(tier, task)).toBe(true);
      }
    }
  });

  it("denies an unknown tier rather than defaulting open", () => {
    // Fail CLOSED. A typo'd or future tier string must not inherit full access.
    expect(tierAllows("pro" as never, "campaign_content")).toBe(false);
    expect(tierAllows("" as never, "campaign_content")).toBe(false);
  });

  it("reminder_draft is Growth+ — the tier the new route inherits", () => {
    expect(tierAllows("starter", "reminder_draft")).toBe(false);
    expect(tierAllows("growth", "reminder_draft")).toBe(true);
  });
});

describe("rawCostPaise", () => {
  it("computes a realistic draft's cost", () => {
    // 2,000 in + 500 out on Haiku: (2000/1e6)*8300 + (500/1e6)*41500
    //                            = 16.6 + 20.75 = 37.35 -> ceil 38
    expect(rawCostPaise(HAIKU, 2000, 500)).toBe(38);
  });

  it("rounds UP, never down — cost must never be understated", () => {
    // Any non-zero usage costs at least 1 paise. Rounding to nearest would
    // report 0 here and make the action look free.
    expect(rawCostPaise(HAIKU, 1, 0)).toBe(1);
    expect(rawCostPaise(HAIKU, 0, 1)).toBe(1);
  });

  it("is zero only for zero usage", () => {
    expect(rawCostPaise(HAIKU, 0, 0)).toBe(0);
  });

  it("always returns an integer number of paise", () => {
    for (const [i, o] of [
      [1, 1],
      [999, 333],
      [123456, 7890],
    ] as const) {
      const cost = rawCostPaise(HAIKU, i, o);
      expect(Number.isInteger(cost)).toBe(true);
      expect(cost).toBeGreaterThan(0);
    }
  });

  it("prices output above input, as the provider does", () => {
    // Output is 5x input on Haiku; a swapped multiplication would invert this
    // and systematically under-bill output-heavy tasks like drafting.
    expect(rawCostPaise(HAIKU, 10_000, 0)).toBeLessThan(rawCostPaise(HAIKU, 0, 10_000));
  });

  it("scales linearly with volume", () => {
    // 1M input tokens = exactly the per-million price.
    expect(rawCostPaise(HAIKU, 1_000_000, 0)).toBe(8300);
    expect(rawCostPaise(HAIKU, 0, 1_000_000)).toBe(41500);
  });

  it("tracks a model swap through config, not code", () => {
    // Sonnet 4.6 at $3/$15 costs 3x Haiku for the same tokens. This is the
    // check that would catch a model change whose prices were not updated
    // alongside it — the cost row and the model id must move together.
    const sonnet: ModelConfig = {
      ...HAIKU,
      modelId: "claude-sonnet-4-6",
      inputPricePerMillionPaise: 24900,
      outputPricePerMillionPaise: 124500,
    };
    expect(rawCostPaise(sonnet, 1_000_000, 0)).toBe(24900);
    expect(rawCostPaise(sonnet, 1_000_000, 0)).toBe(3 * rawCostPaise(HAIKU, 1_000_000, 0));
  });
});
