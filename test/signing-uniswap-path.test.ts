// test/signing-uniswap-path.test.ts
//
// Phase 32 Plan 32-01 — Uniswap V3 packed-path encoder regression suite.
//
// Pins canonical hex-literal fixtures for the packed-bytes path format.
// Drift in encodePacked vs encodeAbiParameters OR drift in the types-array
// shape silently produces wrong-path calldata; the byte-length + exact-hex
// assertions fail at the line a drift introduces.
//
// Anchored fixtures (from .planning/phases/32-evm-uniswap-v3-swap/32-RESEARCH.md
// § Topic 3 + 32-01-PLAN.md `verified_values`):
//   - single-hop USDC→WETH 0.05%: 43 bytes
//   - 2-hop USDC→WETH→WBTC 0.30%: 66 bytes (contains 000bb8 twice)
//   - fee 100   encodes 0x000064
//   - fee 10000 encodes 0x002710

import { describe, expect, it } from "vitest";
import { getAddress, type Address } from "viem";

import { encodeV3Path, _uniswapV3Path } from "../src/signing/uniswap-path.js";

// Token literals — EIP-55-checksummed at definition time (CLAUDE.md address-discipline).
const USDC: Address = getAddress("0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48");
const WETH: Address = getAddress("0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2");
const WBTC: Address = getAddress("0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599");

describe("src/signing/uniswap-path.ts — encodeV3Path (Phase 32 Plan 32-01)", () => {
  it("single-hop USDC→WETH 0.05% produces 43-byte packed hex matching pinned fixture", () => {
    const path = encodeV3Path([
      { tokenIn: USDC, fee: 500, tokenOut: WETH },
    ]);
    // 43 bytes = 20 + 3 + 20; hex length = 2 (0x prefix) + 86 chars = 88.
    expect(path.length).toBe(88);
    // Hardcoded canonical hex literal (lowercase) — drift fires this exact line.
    expect(path.toLowerCase()).toBe(
      "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb480001f4c02aaa39b223fe8d0a0e5c4f27ead9083c756cc2",
    );
  });

  it("2-hop USDC→WETH→WBTC at 0.30% each produces 66-byte packed hex", () => {
    const path = encodeV3Path([
      { tokenIn: USDC, fee: 3000, tokenOut: WETH },
      { tokenIn: WETH, fee: 3000, tokenOut: WBTC },
    ]);
    // 66 bytes = 20 + 3 + 20 + 3 + 20; hex length = 2 + 132 = 134.
    expect(path.length).toBe(134);
    // fee 3000 = 0x000bb8 must appear exactly twice (one per hop).
    const matches = path.toLowerCase().match(/000bb8/g);
    expect(matches).not.toBeNull();
    expect(matches!.length).toBe(2);
    // Starts with USDC address (lowercase, no leading 0x because path starts after the 0x prefix).
    expect(path.toLowerCase().startsWith("0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48")).toBe(true);
    // Ends with WBTC address (lowercase).
    expect(path.toLowerCase().endsWith("2260fac5e5542a773aa44fbcfedf7c193bc2c599")).toBe(true);
  });

  it("empty hops array throws", () => {
    expect(() => encodeV3Path([])).toThrow(/empty hops/);
  });

  it("intermediate-token mismatch throws with hop index in message", () => {
    // hop 1 tokenIn = USDC but hop 0 tokenOut = WETH → mismatch.
    expect(() =>
      encodeV3Path([
        { tokenIn: USDC, fee: 500, tokenOut: WETH },
        { tokenIn: USDC, fee: 500, tokenOut: WBTC },
      ]),
    ).toThrow(/hop\s+1\s+tokenIn\s+does\s+not\s+match\s+hop\s+0\s+tokenOut/);
  });

  it("ESM spy-affordance — _uniswapV3Path.encodeV3Path is the same function reference as the named export", () => {
    expect(_uniswapV3Path.encodeV3Path).toBe(encodeV3Path);
  });

  it("fee 100 encodes as 0x000064 (uint24)", () => {
    const path = encodeV3Path([
      { tokenIn: USDC, fee: 100, tokenOut: WETH },
    ]);
    const matches = path.toLowerCase().match(/000064/g);
    expect(matches).not.toBeNull();
    expect(matches!.length).toBe(1);
  });

  it("fee 10000 encodes as 0x002710 (uint24)", () => {
    const path = encodeV3Path([
      { tokenIn: USDC, fee: 10000, tokenOut: WETH },
    ]);
    const matches = path.toLowerCase().match(/002710/g);
    expect(matches).not.toBeNull();
    expect(matches!.length).toBe(1);
  });

  it("3-hop path produces 89-byte packed hex (20+3+20+3+20+3+20)", () => {
    // Defense-in-depth — confirms the linear N-hop scaling.
    const path = encodeV3Path([
      { tokenIn: USDC, fee: 500,  tokenOut: WETH },
      { tokenIn: WETH, fee: 3000, tokenOut: WBTC },
      { tokenIn: WBTC, fee: 3000, tokenOut: USDC },
    ]);
    // 89 bytes = hex length 2 + 178 = 180.
    expect(path.length).toBe(180);
  });
});
