// test/protocols-uniswap-v3.test.ts
//
// Phase 32 Plan 32-01 — Uniswap V3 protocol-decoder regression suite.
//
// Coverage:
//   - Byte-identity for all 6 UNISWAP_V3_SELECTORS literals vs
//     viem.toFunctionSelector(canonical_signature) — T-32-SELECTOR-DRIFT.
//   - Encoder calldata selector-prefix + length assertions for the 4 write
//     encoders + composeMulticallWithUnwrap helper.
//   - Multicall deadline-overload (0x5ae401dc) selector pin — the bytes-only
//     overload selector 0xac9650d8 must NOT appear in src/protocols/uniswap-v3.ts
//     (Pitfall 4 enforcement; covered by the grep-based acceptance criterion
//     in 32-01-PLAN.md but cross-asserted at runtime here too).
//   - ESM spy-affordance round-trip via `_uniswapV3Protocol`.

import { describe, expect, it } from "vitest";
import { decodeFunctionData, getAddress, toFunctionSelector, type Address } from "viem";

import {
  MULTICALL_DEADLINE_ABI,
  QUOTER_V2_ABI,
  SWAP_ROUTER_02_ABI,
  UNISWAP_V3_SELECTORS,
  _uniswapV3Protocol,
  composeMulticallWithUnwrap,
  encodeExactInput,
  encodeExactInputSingle,
  encodeMulticallWithDeadline,
  encodeUnwrapWeth9,
  getUniswapV3SwapRouter02Address,
} from "../src/protocols/uniswap-v3.js";

// Token literals — EIP-55-checksummed.
const USDC: Address = getAddress("0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48");
const WETH: Address = getAddress("0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2");
const ANVIL: Address = getAddress("0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266");

// Sanity arbitrary inputs reused across encoder tests.
const ARBITRARY_AMOUNT_IN = 100_000000n;
const ARBITRARY_MIN_OUT = 1n;
const DEADLINE = 1748707200n;

describe("src/protocols/uniswap-v3.ts — UNISWAP_V3_SELECTORS byte-identity (Phase 32 Plan 32-01)", () => {
  // 6 cross-assertions: each hardcoded selector must match viem.toFunctionSelector.
  // Drift in either the literal or the parseAbi fragment is a silent
  // attacker-controllable seam — T-32-SELECTOR-DRIFT.

  it("exactInputSingle === toFunctionSelector('function exactInputSingle((address,address,uint24,address,uint256,uint256,uint160))')", () => {
    expect(UNISWAP_V3_SELECTORS.exactInputSingle).toBe(
      toFunctionSelector(
        "function exactInputSingle((address,address,uint24,address,uint256,uint256,uint160))",
      ),
    );
  });

  it("exactInput === toFunctionSelector('function exactInput((bytes,address,uint256,uint256))')", () => {
    expect(UNISWAP_V3_SELECTORS.exactInput).toBe(
      toFunctionSelector("function exactInput((bytes,address,uint256,uint256))"),
    );
  });

  it("multicallWithDeadline === toFunctionSelector('function multicall(uint256,bytes[])')", () => {
    expect(UNISWAP_V3_SELECTORS.multicallWithDeadline).toBe(
      toFunctionSelector("function multicall(uint256,bytes[])"),
    );
  });

  it("unwrapWETH9 === toFunctionSelector('function unwrapWETH9(uint256,address)')", () => {
    expect(UNISWAP_V3_SELECTORS.unwrapWETH9).toBe(
      toFunctionSelector("function unwrapWETH9(uint256,address)"),
    );
  });

  it("quoteExactInputSingle === toFunctionSelector('function quoteExactInputSingle((address,address,uint256,uint24,uint160))') — Pitfall 1 struct order", () => {
    // The Quoter V2 struct field order differs from SwapRouter02 — amountIn
    // comes BEFORE fee. Harmonizing with SwapRouter02's order would change
    // the selector to a non-existent function and the cross-assertion would
    // fail HERE.
    expect(UNISWAP_V3_SELECTORS.quoteExactInputSingle).toBe(
      toFunctionSelector(
        "function quoteExactInputSingle((address,address,uint256,uint24,uint160))",
      ),
    );
  });

  it("quoteExactInput === toFunctionSelector('function quoteExactInput(bytes,uint256)')", () => {
    expect(UNISWAP_V3_SELECTORS.quoteExactInput).toBe(
      toFunctionSelector("function quoteExactInput(bytes,uint256)"),
    );
  });

  it("multicall(bytes[]) selector 0xac9650d8 is DISTINCT from the deadline-overload selector (Pitfall 4)", () => {
    // Defense-in-depth assertion — the bytes-only overload is a DIFFERENT
    // selector and Phase 32 NEVER uses it. If a future refactor inverts the
    // wrapping, this test fires.
    const bytesOnlyOverload = toFunctionSelector("function multicall(bytes[])");
    expect(bytesOnlyOverload).toBe("0xac9650d8");
    expect(UNISWAP_V3_SELECTORS.multicallWithDeadline).not.toBe(bytesOnlyOverload);
  });
});

describe("src/protocols/uniswap-v3.ts — encoder calldata prefixes", () => {
  it("encodeExactInputSingle produces calldata starting with 0x04e45aaf", () => {
    const cd = encodeExactInputSingle({
      tokenIn: USDC,
      tokenOut: WETH,
      fee: 500,
      recipient: ANVIL,
      amountIn: ARBITRARY_AMOUNT_IN,
      amountOutMinimum: ARBITRARY_MIN_OUT,
      sqrtPriceLimitX96: 0n,
    });
    expect(cd.slice(0, 10).toLowerCase()).toBe("0x04e45aaf");
  });

  it("encodeExactInput produces calldata starting with 0xb858183f", () => {
    const cd = encodeExactInput({
      path: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb480001f4c02aaa39b223fe8d0a0e5c4f27ead9083c756cc2",
      recipient: ANVIL,
      amountIn: ARBITRARY_AMOUNT_IN,
      amountOutMinimum: ARBITRARY_MIN_OUT,
    });
    expect(cd.slice(0, 10).toLowerCase()).toBe("0xb858183f");
  });

  it("encodeUnwrapWeth9 produces calldata starting with 0x49404b7c and 68-byte total payload (138-char hex)", () => {
    const cd = encodeUnwrapWeth9(ARBITRARY_MIN_OUT, ANVIL);
    expect(cd.slice(0, 10).toLowerCase()).toBe("0x49404b7c");
    // 4-byte selector + 2 × 32-byte args = 68 bytes total = 0x + 136 hex chars = 138 chars.
    expect(cd.length).toBe(138);
  });

  it("encodeMulticallWithDeadline produces calldata starting with 0x5ae401dc (NOT 0xac9650d8 — Pitfall 4)", () => {
    const inner = encodeExactInputSingle({
      tokenIn: USDC,
      tokenOut: WETH,
      fee: 500,
      recipient: ANVIL,
      amountIn: ARBITRARY_AMOUNT_IN,
      amountOutMinimum: ARBITRARY_MIN_OUT,
      sqrtPriceLimitX96: 0n,
    });
    const cd = encodeMulticallWithDeadline(DEADLINE, [inner]);
    expect(cd.slice(0, 10).toLowerCase()).toBe("0x5ae401dc");
    // Defense-in-depth — explicit assertion that the bytes-only overload
    // selector does NOT prefix the output.
    expect(cd.slice(0, 10).toLowerCase()).not.toBe("0xac9650d8");
  });
});

describe("src/protocols/uniswap-v3.ts — composeMulticallWithUnwrap (ETH-out helper)", () => {
  it("produces a 2-inner-call multicall with exactInputSingle then unwrapWETH9", () => {
    const swapRouter = getUniswapV3SwapRouter02Address(1)!;
    const cd = composeMulticallWithUnwrap({
      deadline: DEADLINE,
      exactInputSingleParamsWithRouterRecipient: {
        tokenIn: USDC,
        tokenOut: WETH,
        fee: 500,
        // PITFALL 3 — recipient MUST be the router itself, not the user.
        recipient: swapRouter,
        amountIn: ARBITRARY_AMOUNT_IN,
        amountOutMinimum: ARBITRARY_MIN_OUT,
        sqrtPriceLimitX96: 0n,
      },
      finalAmountOutMin: ARBITRARY_MIN_OUT,
      finalRecipient: ANVIL,
    });
    // Outer selector is multicall(uint256,bytes[]) — deadline overload.
    expect(cd.slice(0, 10).toLowerCase()).toBe("0x5ae401dc");

    // Decode the outer multicall and assert inner-call count + selectors.
    const decoded = decodeFunctionData({
      abi: MULTICALL_DEADLINE_ABI,
      data: cd,
    });
    expect(decoded.functionName).toBe("multicall");
    // args[0] = deadline (bigint); args[1] = bytes[] inner calls.
    const args = decoded.args as readonly [bigint, readonly `0x${string}`[]];
    expect(args[0]).toBe(DEADLINE);
    expect(args[1].length).toBe(2);
    expect(args[1][0]!.slice(0, 10).toLowerCase()).toBe("0x04e45aaf");
    expect(args[1][1]!.slice(0, 10).toLowerCase()).toBe("0x49404b7c");
  });
});

describe("src/protocols/uniswap-v3.ts — ESM spy-affordance", () => {
  it("_uniswapV3Protocol exports all 5 encoders + composeMulticallWithUnwrap by named reference", () => {
    expect(_uniswapV3Protocol.encodeExactInputSingle).toBe(encodeExactInputSingle);
    expect(_uniswapV3Protocol.encodeExactInput).toBe(encodeExactInput);
    expect(_uniswapV3Protocol.encodeUnwrapWeth9).toBe(encodeUnwrapWeth9);
    expect(_uniswapV3Protocol.encodeMulticallWithDeadline).toBe(encodeMulticallWithDeadline);
    expect(_uniswapV3Protocol.composeMulticallWithUnwrap).toBe(composeMulticallWithUnwrap);
  });
});

describe("src/protocols/uniswap-v3.ts — ABI fragment exports", () => {
  it("SWAP_ROUTER_02_ABI + QUOTER_V2_ABI + MULTICALL_DEADLINE_ABI are non-empty fragments", () => {
    expect(SWAP_ROUTER_02_ABI.length).toBeGreaterThan(0);
    expect(QUOTER_V2_ABI.length).toBeGreaterThan(0);
    expect(MULTICALL_DEADLINE_ABI.length).toBeGreaterThan(0);
  });
});
