// test/protocols-uniswap-v3-lp.test.ts
//
// Phase 33 Plan 33-02 — Uniswap V3 NonfungiblePositionManager (NPM) protocol-
// decoder regression suite.
//
// Coverage:
//   - Byte-identity for all 5 UNISWAP_V3_LP_SELECTORS literals vs
//     viem.toFunctionSelector(canonical_signature) — T-33-NPM-SELECTOR-DRIFT.
//   - Encoder round-trip: encode → decodeFunctionData → byte-identical args.
//   - Selector-collision documentation: NPM.burn === rETH.burn (Phase 31)
//     === ERC-20 Burnable — resolved via (tx.to, selector) tuple dispatch.
//   - MAX_UINT128 sentinel value identity.
//   - Anti-pattern guard: Phase 32 deadline-overload selector 0x5ae401dc
//     NEVER appears in src/protocols/uniswap-v3-lp.ts (the module owns the
//     bytes-only NPM multicall, Plan 33-03 adds the slot).
//   - ESM spy-affordance round-trip via `_uniswapV3LpProtocol`.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { describe, expect, it } from "vitest";
import {
  decodeFunctionData,
  getAddress,
  toFunctionSelector,
  type Address,
} from "viem";

import {
  MAX_UINT128,
  MULTICALL_BYTES_ABI,
  NPM_WRITE_ABI,
  UNISWAP_V3_LP_SELECTORS,
  _uniswapV3LpProtocol,
  composeRebalanceCalldata,
  encodeBurn,
  encodeCollect,
  encodeDecreaseLiquidity,
  encodeIncreaseLiquidity,
  encodeMint,
  encodeMulticallBytes,
  type MintParams,
} from "../src/protocols/uniswap-v3-lp.js";
import { ROCKETPOOL_SELECTORS } from "../src/protocols/rocketpool.js";
import { UNISWAP_V3_SELECTORS } from "../src/protocols/uniswap-v3.js";

// Canonical EIP-55-checksummed token literals shared across encoder fixtures.
const USDC: Address = getAddress("0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48");
const WETH: Address = getAddress("0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2");
const ANVIL_1: Address = getAddress(
  "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
);

// Arbitrary inputs reused across encoder tests.
const ARB_TOKEN_ID = 12345n;
const ARB_AMOUNT0 = 100_000000n;
const ARB_AMOUNT1 = 50_000_000_000_000_000n;
const ARB_LIQUIDITY = 1_000_000_000_000_000n;
const ARB_DEADLINE = 1748707200n;
const TICK_LOWER = -60;
const TICK_UPPER = 60;

describe("src/protocols/uniswap-v3-lp.ts — UNISWAP_V3_LP_SELECTORS byte-identity (Phase 33 Plan 33-02)", () => {
  it("mint === toFunctionSelector('function mint((address,address,uint24,int24,int24,uint256,uint256,uint256,uint256,address,uint256))')", () => {
    expect(UNISWAP_V3_LP_SELECTORS.mint).toBe(
      toFunctionSelector(
        "function mint((address,address,uint24,int24,int24,uint256,uint256,uint256,uint256,address,uint256))",
      ),
    );
    expect(UNISWAP_V3_LP_SELECTORS.mint).toBe("0x88316456");
  });

  it("increaseLiquidity === toFunctionSelector('function increaseLiquidity((uint256,uint256,uint256,uint256,uint256,uint256))')", () => {
    expect(UNISWAP_V3_LP_SELECTORS.increaseLiquidity).toBe(
      toFunctionSelector(
        "function increaseLiquidity((uint256,uint256,uint256,uint256,uint256,uint256))",
      ),
    );
    expect(UNISWAP_V3_LP_SELECTORS.increaseLiquidity).toBe("0x219f5d17");
  });

  it("decreaseLiquidity === toFunctionSelector('function decreaseLiquidity((uint256,uint128,uint256,uint256,uint256))')", () => {
    expect(UNISWAP_V3_LP_SELECTORS.decreaseLiquidity).toBe(
      toFunctionSelector(
        "function decreaseLiquidity((uint256,uint128,uint256,uint256,uint256))",
      ),
    );
    expect(UNISWAP_V3_LP_SELECTORS.decreaseLiquidity).toBe("0x0c49ccbe");
  });

  it("collect === toFunctionSelector('function collect((uint256,address,uint128,uint128))')", () => {
    expect(UNISWAP_V3_LP_SELECTORS.collect).toBe(
      toFunctionSelector("function collect((uint256,address,uint128,uint128))"),
    );
    expect(UNISWAP_V3_LP_SELECTORS.collect).toBe("0xfc6f7865");
  });

  it("burn === toFunctionSelector('function burn(uint256)')", () => {
    expect(UNISWAP_V3_LP_SELECTORS.burn).toBe(
      toFunctionSelector("function burn(uint256)"),
    );
    expect(UNISWAP_V3_LP_SELECTORS.burn).toBe("0x42966c68");
  });

  it("multicallBytes === toFunctionSelector('function multicall(bytes[])') — Plan 33-03", () => {
    expect(UNISWAP_V3_LP_SELECTORS.multicallBytes).toBe(
      toFunctionSelector("function multicall(bytes[])"),
    );
    expect(UNISWAP_V3_LP_SELECTORS.multicallBytes).toBe("0xac9650d8");
  });

  it("multicallBytes is DISTINCT from Phase 32's deadline-overload multicall selector (T-MULTICALL-SELECTOR-DRIFT)", () => {
    // NPM uses `multicall(bytes[])` 0xac9650d8 — inherited from IMulticall.
    // SwapRouter02 uses `multicall(uint256,bytes[])` (the deadline-overload
    // — see src/protocols/uniswap-v3.ts UNISWAP_V3_SELECTORS.multicallWithDeadline)
    // — inherited from IMulticallExtended. Different overloads on different
    // contracts; the two selectors MUST NEVER collapse. A regression that
    // accidentally reused the deadline-overload literal here would silently
    // shift every ABI decode slot.
    expect(UNISWAP_V3_LP_SELECTORS.multicallBytes).not.toBe(
      UNISWAP_V3_SELECTORS.multicallWithDeadline,
    );
  });
});

describe("src/protocols/uniswap-v3-lp.ts — MAX_UINT128 sentinel (T-MAX-UINT128-SENTINEL)", () => {
  it("MAX_UINT128 === (2 ** 128) - 1", () => {
    expect(MAX_UINT128).toBe(340282366920938463463374607431768211455n);
    expect(MAX_UINT128).toBe(2n ** 128n - 1n);
    expect(MAX_UINT128).toBe((1n << 128n) - 1n);
  });
});

describe("src/protocols/uniswap-v3-lp.ts — selector-collision documentation (T-SELECTOR-COLLISION-BURN)", () => {
  it("NPM.burn selector matches Phase 31 rETH.burn selector — preview_send (tx.to, selector) tuple dispatch resolves", () => {
    // Both contracts share the canonical `burn(uint256)` selector. Phase 33's
    // dispatch table at preview_send uses (tx.to === NPM SOT) vs
    // (tx.to === rETH SOT) to distinguish — selector alone is ambiguous.
    expect(UNISWAP_V3_LP_SELECTORS.burn).toBe(ROCKETPOOL_SELECTORS.burn);
    expect(UNISWAP_V3_LP_SELECTORS.burn).toBe("0x42966c68");
  });
});

describe("src/protocols/uniswap-v3-lp.ts — encoder round-trip (encode → decodeFunctionData byte-identical)", () => {
  it("encodeMint round-trips through viem.decodeFunctionData byte-identically", () => {
    const params = {
      token0: USDC,
      token1: WETH,
      fee: 500 as const,
      tickLower: TICK_LOWER,
      tickUpper: TICK_UPPER,
      amount0Desired: ARB_AMOUNT0,
      amount1Desired: ARB_AMOUNT1,
      amount0Min: ARB_AMOUNT0 / 2n,
      amount1Min: ARB_AMOUNT1 / 2n,
      recipient: ANVIL_1,
      deadline: ARB_DEADLINE,
    };
    const data = encodeMint(params);
    expect(data.slice(0, 10).toLowerCase()).toBe("0x88316456");

    const decoded = decodeFunctionData({ abi: NPM_WRITE_ABI, data });
    expect(decoded.functionName).toBe("mint");
    const [decodedParams] = decoded.args as [typeof params];
    expect(decodedParams.token0).toBe(params.token0);
    expect(decodedParams.token1).toBe(params.token1);
    expect(decodedParams.fee).toBe(params.fee);
    expect(decodedParams.tickLower).toBe(params.tickLower);
    expect(decodedParams.tickUpper).toBe(params.tickUpper);
    expect(decodedParams.amount0Desired).toBe(params.amount0Desired);
    expect(decodedParams.amount1Desired).toBe(params.amount1Desired);
    expect(decodedParams.amount0Min).toBe(params.amount0Min);
    expect(decodedParams.amount1Min).toBe(params.amount1Min);
    expect(decodedParams.recipient).toBe(params.recipient);
    expect(decodedParams.deadline).toBe(params.deadline);
  });

  it("encodeIncreaseLiquidity round-trips byte-identically", () => {
    const params = {
      tokenId: ARB_TOKEN_ID,
      amount0Desired: ARB_AMOUNT0,
      amount1Desired: ARB_AMOUNT1,
      amount0Min: ARB_AMOUNT0 / 2n,
      amount1Min: ARB_AMOUNT1 / 2n,
      deadline: ARB_DEADLINE,
    };
    const data = encodeIncreaseLiquidity(params);
    expect(data.slice(0, 10).toLowerCase()).toBe("0x219f5d17");

    const decoded = decodeFunctionData({ abi: NPM_WRITE_ABI, data });
    expect(decoded.functionName).toBe("increaseLiquidity");
    const [decodedParams] = decoded.args as [typeof params];
    expect(decodedParams.tokenId).toBe(params.tokenId);
    expect(decodedParams.amount0Desired).toBe(params.amount0Desired);
    expect(decodedParams.amount1Desired).toBe(params.amount1Desired);
    expect(decodedParams.amount0Min).toBe(params.amount0Min);
    expect(decodedParams.amount1Min).toBe(params.amount1Min);
    expect(decodedParams.deadline).toBe(params.deadline);
  });

  it("encodeDecreaseLiquidity round-trips byte-identically", () => {
    const params = {
      tokenId: ARB_TOKEN_ID,
      liquidity: ARB_LIQUIDITY,
      amount0Min: ARB_AMOUNT0 / 2n,
      amount1Min: ARB_AMOUNT1 / 2n,
      deadline: ARB_DEADLINE,
    };
    const data = encodeDecreaseLiquidity(params);
    expect(data.slice(0, 10).toLowerCase()).toBe("0x0c49ccbe");

    const decoded = decodeFunctionData({ abi: NPM_WRITE_ABI, data });
    expect(decoded.functionName).toBe("decreaseLiquidity");
    const [decodedParams] = decoded.args as [typeof params];
    expect(decodedParams.tokenId).toBe(params.tokenId);
    expect(decodedParams.liquidity).toBe(params.liquidity);
    expect(decodedParams.amount0Min).toBe(params.amount0Min);
    expect(decodedParams.amount1Min).toBe(params.amount1Min);
    expect(decodedParams.deadline).toBe(params.deadline);
  });

  it("encodeCollect round-trips byte-identically (including MAX_UINT128 sentinel)", () => {
    const params = {
      tokenId: ARB_TOKEN_ID,
      recipient: ANVIL_1,
      amount0Max: MAX_UINT128,
      amount1Max: MAX_UINT128,
    };
    const data = encodeCollect(params);
    expect(data.slice(0, 10).toLowerCase()).toBe("0xfc6f7865");

    const decoded = decodeFunctionData({ abi: NPM_WRITE_ABI, data });
    expect(decoded.functionName).toBe("collect");
    const [decodedParams] = decoded.args as [typeof params];
    expect(decodedParams.tokenId).toBe(params.tokenId);
    expect(decodedParams.recipient).toBe(params.recipient);
    expect(decodedParams.amount0Max).toBe(MAX_UINT128);
    expect(decodedParams.amount1Max).toBe(MAX_UINT128);
  });

  it("encodeBurn round-trips byte-identically", () => {
    const data = encodeBurn(ARB_TOKEN_ID);
    expect(data.slice(0, 10).toLowerCase()).toBe("0x42966c68");

    const decoded = decodeFunctionData({ abi: NPM_WRITE_ABI, data });
    expect(decoded.functionName).toBe("burn");
    const [decodedTokenId] = decoded.args as [bigint];
    expect(decodedTokenId).toBe(ARB_TOKEN_ID);
  });
});

describe("src/protocols/uniswap-v3-lp.ts — encodeMulticallBytes (Plan 33-03)", () => {
  it("encodeMulticallBytes([]) returns calldata with selector 0xac9650d8", () => {
    const data = encodeMulticallBytes([]);
    expect(data.slice(0, 10).toLowerCase()).toBe("0xac9650d8");
  });

  it("encodeMulticallBytes round-trips through decodeFunctionData byte-identically", () => {
    const inner: readonly `0x${string}`[] = [
      "0xdeadbeef" as const,
      "0xcafebabe1234" as const,
    ];
    const data = encodeMulticallBytes(inner);
    expect(data.slice(0, 10).toLowerCase()).toBe("0xac9650d8");

    const decoded = decodeFunctionData({ abi: MULTICALL_BYTES_ABI, data });
    expect(decoded.functionName).toBe("multicall");
    const [calls] = decoded.args as [readonly `0x${string}`[]];
    expect(calls.length).toBe(2);
    expect(calls[0]).toBe("0xdeadbeef");
    expect(calls[1]).toBe("0xcafebabe1234");
  });
});

describe("src/protocols/uniswap-v3-lp.ts — composeRebalanceCalldata (Plan 33-03 — UNI-09)", () => {
  // Canonical rebalance composition inputs reused across tests in this block.
  const REB_TOKEN_ID = 12345n;
  const REB_EXISTING_LIQUIDITY = 3_289_473_921n;
  const REB_NEW_TICK_LOWER = -207000;
  const REB_NEW_TICK_UPPER = -202000;
  const REB_DEADLINE = 1748707200n;

  const mintParams: MintParams = {
    token0: USDC,
    token1: WETH,
    fee: 500,
    tickLower: REB_NEW_TICK_LOWER,
    tickUpper: REB_NEW_TICK_UPPER,
    amount0Desired: 100_000000n,
    amount1Desired: 50_000_000_000_000_000n,
    amount0Min: 99_500000n,
    amount1Min: 49_750_000_000_000_000n,
    recipient: ANVIL_1,
    deadline: REB_DEADLINE,
  };

  function compose(): `0x${string}` {
    return composeRebalanceCalldata({
      tokenId: REB_TOKEN_ID,
      existingLiquidity: REB_EXISTING_LIQUIDITY,
      collectRecipient: ANVIL_1,
      mintParams,
      decreaseAmount0Min: 0n,
      decreaseAmount1Min: 0n,
      deadline: REB_DEADLINE,
    });
  }

  it("outer selector is 0xac9650d8 (multicall(bytes[]))", () => {
    const data = compose();
    expect(data.slice(0, 10).toLowerCase()).toBe("0xac9650d8");
  });

  it("decoded bytes[] has exactly 3 inner calls", () => {
    const data = compose();
    const decoded = decodeFunctionData({ abi: MULTICALL_BYTES_ABI, data });
    const [calls] = decoded.args as [readonly `0x${string}`[]];
    expect(calls.length).toBe(3);
  });

  it("inner selectors are LOAD-BEARING order: decreaseLiquidity → collect → mint", () => {
    const data = compose();
    const decoded = decodeFunctionData({ abi: MULTICALL_BYTES_ABI, data });
    const [calls] = decoded.args as [readonly `0x${string}`[]];
    expect(calls[0]!.slice(0, 10).toLowerCase()).toBe(
      UNISWAP_V3_LP_SELECTORS.decreaseLiquidity,
    );
    expect(calls[1]!.slice(0, 10).toLowerCase()).toBe(
      UNISWAP_V3_LP_SELECTORS.collect,
    );
    expect(calls[2]!.slice(0, 10).toLowerCase()).toBe(
      UNISWAP_V3_LP_SELECTORS.mint,
    );
  });

  it("inner[0] decreaseLiquidity carries tokenId + 100% existingLiquidity + supplied amount mins + deadline", () => {
    const data = compose();
    const decoded = decodeFunctionData({ abi: MULTICALL_BYTES_ABI, data });
    const [calls] = decoded.args as [readonly `0x${string}`[]];
    const innerDecoded = decodeFunctionData({
      abi: NPM_WRITE_ABI,
      data: calls[0]!,
    });
    expect(innerDecoded.functionName).toBe("decreaseLiquidity");
    const [params] = innerDecoded.args as [
      {
        tokenId: bigint;
        liquidity: bigint;
        amount0Min: bigint;
        amount1Min: bigint;
        deadline: bigint;
      },
    ];
    expect(params.tokenId).toBe(REB_TOKEN_ID);
    expect(params.liquidity).toBe(REB_EXISTING_LIQUIDITY);
    expect(params.amount0Min).toBe(0n);
    expect(params.amount1Min).toBe(0n);
    expect(params.deadline).toBe(REB_DEADLINE);
  });

  it("inner[1] collect uses MAX_UINT128 sentinel for both amount maxes (collect-everything)", () => {
    const data = compose();
    const decoded = decodeFunctionData({ abi: MULTICALL_BYTES_ABI, data });
    const [calls] = decoded.args as [readonly `0x${string}`[]];
    const innerDecoded = decodeFunctionData({
      abi: NPM_WRITE_ABI,
      data: calls[1]!,
    });
    expect(innerDecoded.functionName).toBe("collect");
    const [params] = innerDecoded.args as [
      {
        tokenId: bigint;
        recipient: typeof ANVIL_1;
        amount0Max: bigint;
        amount1Max: bigint;
      },
    ];
    expect(params.tokenId).toBe(REB_TOKEN_ID);
    expect(params.recipient).toBe(ANVIL_1);
    expect(params.amount0Max).toBe(MAX_UINT128);
    expect(params.amount1Max).toBe(MAX_UINT128);
  });

  it("inner[2] mint carries supplied MintParams at the NEW tick range", () => {
    const data = compose();
    const decoded = decodeFunctionData({ abi: MULTICALL_BYTES_ABI, data });
    const [calls] = decoded.args as [readonly `0x${string}`[]];
    const innerDecoded = decodeFunctionData({
      abi: NPM_WRITE_ABI,
      data: calls[2]!,
    });
    expect(innerDecoded.functionName).toBe("mint");
    const [params] = innerDecoded.args as [typeof mintParams];
    expect(params.token0).toBe(USDC);
    expect(params.token1).toBe(WETH);
    expect(params.fee).toBe(500);
    expect(params.tickLower).toBe(REB_NEW_TICK_LOWER);
    expect(params.tickUpper).toBe(REB_NEW_TICK_UPPER);
    expect(params.recipient).toBe(ANVIL_1);
    expect(params.deadline).toBe(REB_DEADLINE);
  });
});

describe("src/protocols/uniswap-v3-lp.ts — anti-pattern guard (Phase 32 deadline-overload selector MUST NOT appear)", () => {
  it("source file does NOT contain the literal 0x5ae401dc (Phase 32 multicallWithDeadline)", () => {
    // Defense-in-depth file-level grep: NPM uses multicall(bytes[]) =
    // 0xac9650d8 (Plan 33-03 reserves), NOT the deadline overload Phase 32's
    // SwapRouter02 uses. Cross-import would conflate two distinct multicall
    // overloads.
    const here = path.dirname(fileURLToPath(import.meta.url));
    const src = readFileSync(
      path.join(here, "..", "src", "protocols", "uniswap-v3-lp.ts"),
      "utf8",
    );
    expect(src.includes("0x5ae401dc")).toBe(false);
  });
});

describe("src/protocols/uniswap-v3-lp.ts — ESM spy-affordance", () => {
  it("_uniswapV3LpProtocol exports all 5 single-step encoders + Plan 33-03 composite helpers by named reference", () => {
    expect(_uniswapV3LpProtocol.encodeMint).toBe(encodeMint);
    expect(_uniswapV3LpProtocol.encodeIncreaseLiquidity).toBe(
      encodeIncreaseLiquidity,
    );
    expect(_uniswapV3LpProtocol.encodeDecreaseLiquidity).toBe(
      encodeDecreaseLiquidity,
    );
    expect(_uniswapV3LpProtocol.encodeCollect).toBe(encodeCollect);
    expect(_uniswapV3LpProtocol.encodeBurn).toBe(encodeBurn);
    expect(_uniswapV3LpProtocol.encodeMulticallBytes).toBe(encodeMulticallBytes);
    expect(_uniswapV3LpProtocol.composeRebalanceCalldata).toBe(
      composeRebalanceCalldata,
    );
  });

  it("_uniswapV3LpProtocol surface widens from 5 → 7 keys at Plan 33-03", () => {
    expect(Object.keys(_uniswapV3LpProtocol).sort()).toEqual([
      "composeRebalanceCalldata",
      "encodeBurn",
      "encodeCollect",
      "encodeDecreaseLiquidity",
      "encodeIncreaseLiquidity",
      "encodeMint",
      "encodeMulticallBytes",
    ]);
  });
});

describe("src/protocols/uniswap-v3-lp.ts — ABI fragment exports", () => {
  it("NPM_WRITE_ABI is a non-empty fragment containing all 5 verbs", () => {
    expect(NPM_WRITE_ABI.length).toBe(5);
    const names = NPM_WRITE_ABI.map((f) => (f as { name?: string }).name).sort();
    expect(names).toEqual([
      "burn",
      "collect",
      "decreaseLiquidity",
      "increaseLiquidity",
      "mint",
    ]);
  });

  it("MULTICALL_BYTES_ABI is a 1-entry fragment containing the bytes-only multicall (Plan 33-03)", () => {
    expect(MULTICALL_BYTES_ABI.length).toBe(1);
    const names = MULTICALL_BYTES_ABI.map((f) => (f as { name?: string }).name);
    expect(names).toEqual(["multicall"]);
  });
});
