// test/chains-uniswap-v3.test.ts — Phase 32 Plan 32-02 (UNI-01).
//
// Quoter V2 chain client wrapper regression. Structural mirror of
// test/chains-aave-v3.test.ts + test/get-rocketpool-positions.test.ts mock
// conventions.
//
// Load-bearing invariants:
//   - quoteAllSingleHopFeeTiers iterates EXACTLY 4 fee tiers [100, 500, 3000,
//     10000] in order — assertion preserves arg shape (Pitfall 1 anchor).
//   - Per-tier reverts mapped to null; NO throw escapes the function
//     (T-32-QUOTER-REVERT-POISON mitigation — Promise.allSettled discipline).
//   - Quoter V2 readContract args object carries the 5 fields in EXACT order
//     (tokenIn, tokenOut, amountIn, fee, sqrtPriceLimitX96) — drift here
//     silently breaks Fixture UNI-A (Plan 32-01 cross-link).
//   - CANONICAL_FEE_TIERS has exactly 7 entries; lookupCanonicalFee is
//     order-independent.
//   - Multi-hop candidate iteration skips degenerate hops (tokenIn or
//     tokenOut IS the anchor); unknown-pair returns [].
//
// Cross-link to Fixture UNI-A in test/signing-fingerprint.test.ts: Plan 32-01
// pinned UNI-A as the cryptographic-binding anchor for USDC→WETH single-hop
// fee=500. This test exercises the Quoter V2 read leg of the same swap.

import type { Address, PublicClient } from "viem";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  CANONICAL_FEE_TIERS,
  _uniswapV3Chain,
  lookupCanonicalFee,
  pairKey,
  quoteAllSingleHopFeeTiers,
  quoteMultiHopCandidates,
} from "../src/chains/uniswap-v3.js";

const USDC: Address = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
const USDT: Address = "0xdAC17F958D2ee523a2206206994597C13D831ec7";
const DAI: Address = "0x6B175474E89094C44Da98b954EedeAC495271d0F";
const WETH: Address = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";
const WBTC: Address = "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599";
const RAND_TOKEN_A: Address = "0x1111111111111111111111111111111111111111";
const RAND_TOKEN_B: Address = "0x2222222222222222222222222222222222222222";

const AMOUNT_IN = 100_000_000n; // 100 USDC at 6 decimals

function makeMockClient(
  readContract: ReturnType<typeof vi.fn>,
): PublicClient {
  return { readContract } as unknown as PublicClient;
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// CANONICAL_FEE_TIERS + pairKey + lookupCanonicalFee
// ---------------------------------------------------------------------------

describe("CANONICAL_FEE_TIERS — Phase 32 Plan 32-02 (RESEARCH § Topic 10)", () => {
  it("contains exactly 7 entries", () => {
    expect(Object.keys(CANONICAL_FEE_TIERS).length).toBe(7);
  });

  it("WETH↔USDC = 500 (0.05%)", () => {
    expect(lookupCanonicalFee(WETH, USDC)).toBe(500);
  });

  it("WETH↔USDT = 3000 (0.30%)", () => {
    expect(lookupCanonicalFee(WETH, USDT)).toBe(3000);
  });

  it("WETH↔WBTC = 3000 (0.30%)", () => {
    expect(lookupCanonicalFee(WETH, WBTC)).toBe(3000);
  });

  it("WETH↔DAI = 3000 (0.30%)", () => {
    expect(lookupCanonicalFee(WETH, DAI)).toBe(3000);
  });

  it("USDC↔USDT = 100 (0.01%)", () => {
    expect(lookupCanonicalFee(USDC, USDT)).toBe(100);
  });

  it("USDC↔DAI = 100 (0.01%)", () => {
    expect(lookupCanonicalFee(USDC, DAI)).toBe(100);
  });

  it("USDT↔DAI = 100 (0.01%)", () => {
    expect(lookupCanonicalFee(USDT, DAI)).toBe(100);
  });

  it("lookupCanonicalFee is order-independent: (USDC, WETH) === (WETH, USDC)", () => {
    expect(lookupCanonicalFee(USDC, WETH)).toBe(lookupCanonicalFee(WETH, USDC));
    expect(lookupCanonicalFee(USDC, WETH)).toBe(500);
  });

  it("Unknown pair returns null", () => {
    expect(lookupCanonicalFee(RAND_TOKEN_A, RAND_TOKEN_B)).toBeNull();
  });

  it("pairKey sorts addresses (order-independent) and uses '|' separator", () => {
    const k1 = pairKey(WETH, USDC);
    const k2 = pairKey(USDC, WETH);
    expect(k1).toBe(k2);
    expect(k1).toContain("|");
    // Lowercase-sorted form — USDC starts with 0xa0..., WETH with 0xc0...
    expect(k1.startsWith(USDC.toLowerCase())).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// quoteAllSingleHopFeeTiers
// ---------------------------------------------------------------------------

describe("quoteAllSingleHopFeeTiers — Phase 32 Plan 32-02 (D-04 step 1+2)", () => {
  it("Happy path: 4 tiers all fulfilled → 4 non-null entries in [100,500,3000,10000] order", async () => {
    const readContract = vi.fn().mockResolvedValue([1000n, 0n, 0, 0n]);
    const client = makeMockClient(readContract);

    const result = await quoteAllSingleHopFeeTiers(client, {
      tokenIn: USDC,
      tokenOut: WETH,
      amountIn: AMOUNT_IN,
    });

    expect(result).toHaveLength(4);
    expect(result.every((r) => r !== null)).toBe(true);
    expect(result[0]?.fee).toBe(100);
    expect(result[1]?.fee).toBe(500);
    expect(result[2]?.fee).toBe(3000);
    expect(result[3]?.fee).toBe(10000);
    expect(result.every((r) => r?.amountOut === 1000n)).toBe(true);
  });

  it("Partial revert: 2 tiers fulfilled / 2 reverted → mixed null + non-null (T-32-QUOTER-REVERT-POISON mitigation)", async () => {
    const readContract = vi.fn().mockImplementation(({ args }) => {
      const fee = args[0].fee as number;
      // Tiers 100 and 10000 revert; 500 and 3000 fulfilled.
      if (fee === 100 || fee === 10000) {
        return Promise.reject(new Error("no pool at this tier"));
      }
      return Promise.resolve([2000n, 0n, 0, 0n]);
    });
    const client = makeMockClient(readContract);

    const result = await quoteAllSingleHopFeeTiers(client, {
      tokenIn: USDC,
      tokenOut: WETH,
      amountIn: AMOUNT_IN,
    });

    expect(result).toHaveLength(4);
    expect(result[0]).toBeNull();           // fee=100 reverted
    expect(result[1]?.fee).toBe(500);       // fee=500 fulfilled
    expect(result[1]?.amountOut).toBe(2000n);
    expect(result[2]?.fee).toBe(3000);      // fee=3000 fulfilled
    expect(result[3]).toBeNull();           // fee=10000 reverted
  });

  it("All reverts: returns 4 nulls (function does NOT throw)", async () => {
    const readContract = vi
      .fn()
      .mockRejectedValue(new Error("no pool at any tier"));
    const client = makeMockClient(readContract);

    const result = await quoteAllSingleHopFeeTiers(client, {
      tokenIn: USDC,
      tokenOut: WETH,
      amountIn: AMOUNT_IN,
    });

    expect(result).toHaveLength(4);
    expect(result.every((r) => r === null)).toBe(true);
  });

  it("Quoter V2 readContract args carry the QUOTER struct field order (Pitfall 1 anchor; Fixture UNI-A cross-link)", async () => {
    // Fixture UNI-A canonical shape: USDC → WETH, fee=500, amountIn=100e6.
    // Quoter V2 struct order: (tokenIn, tokenOut, amountIn, fee,
    // sqrtPriceLimitX96) — amountIn BEFORE fee; no recipient; no
    // amountOutMinimum. Drift here silently breaks Fixture UNI-A in
    // test/signing-fingerprint.test.ts.
    const readContract = vi.fn().mockResolvedValue([1000n, 0n, 0, 0n]);
    const client = makeMockClient(readContract);

    await quoteAllSingleHopFeeTiers(client, {
      tokenIn: USDC,
      tokenOut: WETH,
      amountIn: AMOUNT_IN,
    });

    expect(readContract).toHaveBeenCalledTimes(4);
    // Inspect the first call's args[0] — the QuoteExactInputSingleParams tuple.
    const firstCall = readContract.mock.calls[0]?.[0] as {
      functionName: string;
      args: ReadonlyArray<Record<string, unknown>>;
    };
    expect(firstCall.functionName).toBe("quoteExactInputSingle");
    const params = firstCall.args[0]!;
    // Field-by-field check — proves the canonical field set + values.
    expect(params.tokenIn).toBe(USDC);
    expect(params.tokenOut).toBe(WETH);
    expect(params.amountIn).toBe(AMOUNT_IN);
    expect([100, 500, 3000, 10000]).toContain(params.fee);
    expect(params.sqrtPriceLimitX96).toBe(0n);
    // Anti-collision: the SwapRouter02-specific fields MUST NOT appear in
    // the Quoter V2 struct (Pitfall 1 — silent-bug class).
    expect((params as Record<string, unknown>).recipient).toBeUndefined();
    expect((params as Record<string, unknown>).amountOutMinimum).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// quoteMultiHopCandidates
// ---------------------------------------------------------------------------

describe("quoteMultiHopCandidates — Phase 32 Plan 32-02 (D-04 step 3)", () => {
  it("USDC ↔ WBTC produces 1 WETH-anchored candidate (USDC-anchored skipped: tokenIn IS USDC)", async () => {
    const readContract = vi
      .fn()
      .mockResolvedValue([1500n, [], [], 0n]);
    const client = makeMockClient(readContract);

    const result = await quoteMultiHopCandidates(client, {
      tokenIn: USDC,
      tokenOut: WBTC,
      amountIn: AMOUNT_IN,
    });

    // Only WETH-anchored candidate — USDC-anchored skipped (tokenIn IS USDC).
    expect(result).toHaveLength(1);
    expect(result[0]?.amountOut).toBe(1500n);
    expect(result[0]?.path).toHaveLength(2);
    expect(result[0]?.path[0]?.tokenIn).toBe(USDC);
    expect(result[0]?.path[0]?.tokenOut).toBe(WETH);
    expect(result[0]?.path[1]?.tokenIn).toBe(WETH);
    expect(result[0]?.path[1]?.tokenOut).toBe(WBTC);
  });

  it("USDT ↔ DAI produces 2 candidates (WETH-anchored + USDC-anchored)", async () => {
    const readContract = vi
      .fn()
      .mockResolvedValue([2500n, [], [], 0n]);
    const client = makeMockClient(readContract);

    const result = await quoteMultiHopCandidates(client, {
      tokenIn: USDT,
      tokenOut: DAI,
      amountIn: AMOUNT_IN,
    });

    expect(result).toHaveLength(2);
    expect(result.every((r) => r !== null)).toBe(true);
    expect(result[0]?.path).toHaveLength(2);
    expect(result[1]?.path).toHaveLength(2);
    // The two candidates use different anchors — at least one hop must
    // differ across the two paths.
    expect(result[0]?.path[0]?.tokenOut).not.toBe(result[1]?.path[0]?.tokenOut);
  });

  it("Unknown alt-token pair returns [] (no anchor available in canonical mapping)", async () => {
    const readContract = vi.fn();
    const client = makeMockClient(readContract);

    const result = await quoteMultiHopCandidates(client, {
      tokenIn: RAND_TOKEN_A,
      tokenOut: RAND_TOKEN_B,
      amountIn: AMOUNT_IN,
    });

    expect(result).toEqual([]);
    expect(readContract).not.toHaveBeenCalled();
  });

  it("Per-candidate revert mapped to null (T-32-QUOTER-REVERT-POISON applied at multi-hop arm)", async () => {
    // USDT ↔ DAI builds 2 candidates; mock both reads to reject.
    const readContract = vi
      .fn()
      .mockRejectedValue(new Error("path reverted"));
    const client = makeMockClient(readContract);

    const result = await quoteMultiHopCandidates(client, {
      tokenIn: USDT,
      tokenOut: DAI,
      amountIn: AMOUNT_IN,
    });

    expect(result).toHaveLength(2);
    expect(result.every((r) => r === null)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// ESM spy-affordance
// ---------------------------------------------------------------------------

describe("_uniswapV3Chain ESM spy-affordance — CLAUDE.md § Conventions", () => {
  it("wraps quoteAllSingleHopFeeTiers, quoteMultiHopCandidates, lookupCanonicalFee", () => {
    expect(_uniswapV3Chain.quoteAllSingleHopFeeTiers).toBe(
      quoteAllSingleHopFeeTiers,
    );
    expect(_uniswapV3Chain.quoteMultiHopCandidates).toBe(quoteMultiHopCandidates);
    expect(_uniswapV3Chain.lookupCanonicalFee).toBe(lookupCanonicalFee);
  });
});
