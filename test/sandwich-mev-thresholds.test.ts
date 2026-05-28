// test/sandwich-mev-thresholds.test.ts
//
// Unit coverage for src/config/sandwich-mev-thresholds.ts.
// Phase 40 Plan 40-01 Task 1 (RED gate).
//
// Covers:
//   (a) 5-chain table exact {defaultSlippageBps, priceImpactRefusalPct} values
//   (b) getSandwichThresholds returns table defaults with no env override
//   (c) valid MEV_THRESHOLD_<CHAIN> override mutates defaultSlippageBps only
//   (d) lazy call-time read: mutating process.env between calls flips result
//   (e) invalid override values throw InvalidMevThresholdError
//   (f) boundary values "1" and "10000" are accepted
//   (g) per-chain bar differential: 250bps > polygon (2.0%×100=200) but < arbitrum (3.0%×100=300)

import { afterEach, describe, expect, it } from "vitest";
import {
  SANDWICH_MEV_THRESHOLDS,
  getSandwichThresholds,
  InvalidMevThresholdError,
} from "../src/config/sandwich-mev-thresholds.js";

// -------------------------------------------------------------------------
// (a) Table values
// -------------------------------------------------------------------------
describe("SANDWICH_MEV_THRESHOLDS — 5-chain table", () => {
  it("ethereum (1): defaultSlippageBps=50, priceImpactRefusalPct=2.0", () => {
    expect(SANDWICH_MEV_THRESHOLDS[1].defaultSlippageBps).toBe(50);
    expect(SANDWICH_MEV_THRESHOLDS[1].priceImpactRefusalPct).toBe(2.0);
  });

  it("polygon (137): defaultSlippageBps=100, priceImpactRefusalPct=2.0", () => {
    expect(SANDWICH_MEV_THRESHOLDS[137].defaultSlippageBps).toBe(100);
    expect(SANDWICH_MEV_THRESHOLDS[137].priceImpactRefusalPct).toBe(2.0);
  });

  it("arbitrum (42161): defaultSlippageBps=30, priceImpactRefusalPct=3.0", () => {
    expect(SANDWICH_MEV_THRESHOLDS[42161].defaultSlippageBps).toBe(30);
    expect(SANDWICH_MEV_THRESHOLDS[42161].priceImpactRefusalPct).toBe(3.0);
  });

  it("optimism (10): defaultSlippageBps=30, priceImpactRefusalPct=3.0", () => {
    expect(SANDWICH_MEV_THRESHOLDS[10].defaultSlippageBps).toBe(30);
    expect(SANDWICH_MEV_THRESHOLDS[10].priceImpactRefusalPct).toBe(3.0);
  });

  it("base (8453): defaultSlippageBps=30, priceImpactRefusalPct=3.0", () => {
    expect(SANDWICH_MEV_THRESHOLDS[8453].defaultSlippageBps).toBe(30);
    expect(SANDWICH_MEV_THRESHOLDS[8453].priceImpactRefusalPct).toBe(3.0);
  });
});

// -------------------------------------------------------------------------
// (b) getSandwichThresholds returns table defaults with no env override
// -------------------------------------------------------------------------
describe("getSandwichThresholds — no env override", () => {
  afterEach(() => {
    delete process.env.MEV_THRESHOLD_ETHEREUM;
    delete process.env.MEV_THRESHOLD_POLYGON;
    delete process.env.MEV_THRESHOLD_ARBITRUM;
    delete process.env.MEV_THRESHOLD_OPTIMISM;
    delete process.env.MEV_THRESHOLD_BASE;
  });

  it("ethereum: returns {defaultSlippageBps:50, priceImpactRefusalPct:2.0} with no env", () => {
    const result = getSandwichThresholds(1);
    expect(result.defaultSlippageBps).toBe(50);
    expect(result.priceImpactRefusalPct).toBe(2.0);
  });

  it("polygon: returns {defaultSlippageBps:100, priceImpactRefusalPct:2.0} with no env", () => {
    const result = getSandwichThresholds(137);
    expect(result.defaultSlippageBps).toBe(100);
    expect(result.priceImpactRefusalPct).toBe(2.0);
  });

  it("arbitrum: returns {defaultSlippageBps:30, priceImpactRefusalPct:3.0} with no env", () => {
    const result = getSandwichThresholds(42161);
    expect(result.defaultSlippageBps).toBe(30);
    expect(result.priceImpactRefusalPct).toBe(3.0);
  });
});

// -------------------------------------------------------------------------
// (c) Valid override applies to defaultSlippageBps only
// -------------------------------------------------------------------------
describe("getSandwichThresholds — valid env override", () => {
  afterEach(() => {
    delete process.env.MEV_THRESHOLD_ETHEREUM;
    delete process.env.MEV_THRESHOLD_POLYGON;
  });

  it("MEV_THRESHOLD_ETHEREUM=100 → defaultSlippageBps=100, priceImpactRefusalPct unchanged at 2.0", () => {
    process.env.MEV_THRESHOLD_ETHEREUM = "100";
    const result = getSandwichThresholds(1);
    expect(result.defaultSlippageBps).toBe(100);
    expect(result.priceImpactRefusalPct).toBe(2.0);
  });

  it("MEV_THRESHOLD_POLYGON=200 → defaultSlippageBps=200, priceImpactRefusalPct unchanged at 2.0", () => {
    process.env.MEV_THRESHOLD_POLYGON = "200";
    const result = getSandwichThresholds(137);
    expect(result.defaultSlippageBps).toBe(200);
    expect(result.priceImpactRefusalPct).toBe(2.0);
  });

  it("boundary MEV_THRESHOLD_ETHEREUM=1 → accepted, defaultSlippageBps=1", () => {
    process.env.MEV_THRESHOLD_ETHEREUM = "1";
    const result = getSandwichThresholds(1);
    expect(result.defaultSlippageBps).toBe(1);
  });

  it("boundary MEV_THRESHOLD_ETHEREUM=10000 → accepted, defaultSlippageBps=10000", () => {
    process.env.MEV_THRESHOLD_ETHEREUM = "10000";
    const result = getSandwichThresholds(1);
    expect(result.defaultSlippageBps).toBe(10000);
  });
});

// -------------------------------------------------------------------------
// (d) Lazy call-time read: mutating process.env between calls flips result
// -------------------------------------------------------------------------
describe("getSandwichThresholds — lazy call-time read", () => {
  afterEach(() => {
    delete process.env.MEV_THRESHOLD_ETHEREUM;
  });

  it("setting env after first call changes result on second call", () => {
    // No env set — returns default
    const before = getSandwichThresholds(1);
    expect(before.defaultSlippageBps).toBe(50);

    // Set env between calls
    process.env.MEV_THRESHOLD_ETHEREUM = "75";
    const after = getSandwichThresholds(1);
    expect(after.defaultSlippageBps).toBe(75);
  });

  it("deleting env after setting it reverts to default on next call", () => {
    process.env.MEV_THRESHOLD_ETHEREUM = "80";
    expect(getSandwichThresholds(1).defaultSlippageBps).toBe(80);

    delete process.env.MEV_THRESHOLD_ETHEREUM;
    expect(getSandwichThresholds(1).defaultSlippageBps).toBe(50);
  });
});

// -------------------------------------------------------------------------
// (e) Invalid override values throw InvalidMevThresholdError
// -------------------------------------------------------------------------
describe("getSandwichThresholds — invalid override refuses (throws InvalidMevThresholdError)", () => {
  afterEach(() => {
    delete process.env.MEV_THRESHOLD_ETHEREUM;
  });

  const INVALID_CASES = [
    "abc",
    "0",
    "-5",
    "10001",
    "1.5",
    "",
  ] as const;

  for (const value of INVALID_CASES) {
    it(`MEV_THRESHOLD_ETHEREUM="${value}" → throws InvalidMevThresholdError`, () => {
      process.env.MEV_THRESHOLD_ETHEREUM = value;
      expect(() => getSandwichThresholds(1)).toThrow(InvalidMevThresholdError);
    });
  }

  it("thrown InvalidMevThresholdError carries chain + rawValue", () => {
    process.env.MEV_THRESHOLD_ETHEREUM = "abc";
    try {
      getSandwichThresholds(1);
      expect.fail("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(InvalidMevThresholdError);
      const typed = err as InvalidMevThresholdError;
      expect(typed.chain).toBe("ethereum");
      expect(typed.rawValue).toBe("abc");
    }
  });
});

// -------------------------------------------------------------------------
// (g) Per-chain bar differential: 250bps > polygon (200) but < arbitrum (300)
// -------------------------------------------------------------------------
describe("getSandwichThresholds — per-chain bar differential", () => {
  it("priceImpactRefusalPct*100 for polygon is 200, for arbitrum is 300", () => {
    const polygon = getSandwichThresholds(137);
    const arbitrum = getSandwichThresholds(42161);
    // 250bps impact: above polygon bar (200) → refuse; below arbitrum bar (300) → pass
    const impact = 250;
    expect(impact).toBeGreaterThan(polygon.priceImpactRefusalPct * 100);
    expect(impact).toBeLessThan(arbitrum.priceImpactRefusalPct * 100);
  });
});
