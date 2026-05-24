// preview_send Uniswap V3 LP composite-multicall tests —
// Phase 33 Plan 33-03 Task 2 (UNI-09 + T-COMPOSITE-DECODE-SOT).
//
// Composite-multicall arm correctness:
//   - (tx.to=NPM, selector=0xac9650d8) → composite DECODED ARGS block with
//     3 step sub-blocks rendered in LOAD-BEARING order
//     (decreaseLiquidity → collect → mint).
//   - SHARED `decodeSingleNpmCall` helper from Plan 33-02 is the single
//     source of truth for inner-call decoding — Pitfall 7 anchor. Spy
//     asserts it's called exactly 3 times (one per inner call).
//   - Each step sub-block surfaces its own decoded args with 2-space indent.
//   - LEDGER NOTICE present in composite response (T-LEDGER-BLIND-SIGN-NPM-
//     COMPOSITE).
//
// Cross-link: Fixture UNI-LP-F (test/signing-fingerprint.test.ts) anchors
// the composite multicall payloadFingerprint over the SAME calldata shape
// this test exercises.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getAddress, type Address, type Hex } from "viem";

import type { FourbyteResult } from "../src/clients/fourbyte.js";

const {
  getStatusSpy,
  getTransactionCountSpy,
  estimateFeesPerGasSpy,
  estimateGasSpy,
  callSpy,
  lookupSelectorSpy,
} = vi.hoisted(() => ({
  getStatusSpy: vi.fn(),
  getTransactionCountSpy: vi.fn(),
  estimateFeesPerGasSpy: vi.fn(),
  estimateGasSpy: vi.fn(),
  callSpy: vi.fn(),
  lookupSelectorSpy: vi.fn<[Hex | null], Promise<FourbyteResult>>(),
}));

vi.mock("../src/wallet/session-manager.js", async () => {
  const actual = await vi.importActual<typeof import("../src/wallet/session-manager.js")>(
    "../src/wallet/session-manager.js",
  );
  return {
    ...actual,
    getStatus: (...a: Parameters<typeof actual.getStatus>) => getStatusSpy(...a),
    pair: vi.fn(async () => {
      throw new Error("pair should not be called");
    }),
    disconnect: vi.fn(async () => undefined),
  };
});

vi.mock("viem/actions", async () => {
  const actual = await vi.importActual<typeof import("viem/actions")>("viem/actions");
  return {
    ...actual,
    getTransactionCount: (...a: Parameters<typeof actual.getTransactionCount>) =>
      getTransactionCountSpy(...a),
    estimateFeesPerGas: (...a: Parameters<typeof actual.estimateFeesPerGas>) =>
      estimateFeesPerGasSpy(...a),
    estimateGas: (...a: Parameters<typeof actual.estimateGas>) => estimateGasSpy(...a),
    call: (...a: Parameters<typeof actual.call>) => callSpy(...a),
  };
});

vi.mock("../src/clients/fourbyte.js", async () => {
  const actual = await vi.importActual<typeof import("../src/clients/fourbyte.js")>(
    "../src/clients/fourbyte.js",
  );
  return {
    ...actual,
    lookupSelector: (sel: Hex | null) => lookupSelectorSpy(sel),
  };
});

import { _resetDemoModeForTesting } from "../src/config/env.js";
import { _resetActivePersonaForTesting } from "../src/demo/state.js";
import {
  getUniswapV3NonfungiblePositionManagerAddress,
} from "../src/config/contracts.js";
import {
  UNISWAP_V3_LP_SELECTORS,
  _uniswapV3LpProtocol,
} from "../src/protocols/uniswap-v3-lp.js";
import { LEDGER_NOTICE_UNISWAP_V3_LP_TEMPLATE } from "../src/signing/blocks.js";
import {
  _resetHandleStoreForTesting,
  createHandle,
} from "../src/signing/handle-store.js";
import {
  getRegisteredTool,
  type ToolHandlerResult,
} from "../src/tools/index.js";
// Import the preview_send module's SOT spy-affordance indirection
// `_npmDecodeShared` so we can `vi.spyOn(_npmDecodeShared, "decodeSingleNpmCall")`
// — Pitfall 7 SHARED-decoder discipline anchor. Direct named-export spying
// is a no-op on ESM (bindings are immutable); the indirection object is the
// canonical CLAUDE.md spy seam.
import { _npmDecodeShared } from "../src/tools/preview_send.js";

await import("../src/tools/register-all.js");

async function callTool(args: Record<string, unknown>): Promise<ToolHandlerResult> {
  const tool = getRegisteredTool("preview_send");
  if (!tool) throw new Error("preview_send not registered");
  return tool.handler(args);
}

const SENDER = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" as Address;
const PAIRED_STATUS = {
  paired: true as const,
  accounts: [SENDER],
  activeAccount: SENDER,
  address: SENDER,
  chainId: 1,
  sessionTopicLast8: "deadbeef",
};

const FIXTURE_FP =
  "0x7e1867b2e6bc98cbce57bb901a33e973c749565eb19f8b86056197c7a20b2f5a" as Hex;

const USDC: Address = getAddress("0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48");
const WETH: Address = getAddress("0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2");
const REB_TOKEN_ID = 12345n;
const REB_EXISTING_LIQUIDITY = 3_289_473_921n;
const REB_DEADLINE = 1748707200n;

function seedHandle(to: Address, valueWei: bigint, data: Hex): string {
  return createHandle({
    args: {
      to: "",
      valueWei: valueWei.toString(),
      tokenAddress: to,
      amount: "1.0",
    },
    tx: { chainId: 1, to, valueWei, data },
    payloadFingerprint: FIXTURE_FP,
  });
}

function scriptStdMocks(): void {
  getStatusSpy.mockResolvedValue(PAIRED_STATUS);
  getTransactionCountSpy.mockResolvedValue(7);
  estimateFeesPerGasSpy.mockResolvedValue({
    maxFeePerGas: 30_000_000_000n,
    maxPriorityFeePerGas: 1_000_000_000n,
  });
  estimateGasSpy.mockResolvedValue(200_000n);
  callSpy.mockResolvedValue({ data: "0x" as Hex });
  lookupSelectorSpy.mockResolvedValue({
    status: "ok" as const,
    selector: null,
    matchCount: 0,
    matchedAbi: null,
    primary: null,
    candidates: [],
  });
}

function composeRebalance(): Hex {
  return _uniswapV3LpProtocol.composeRebalanceCalldata({
    tokenId: REB_TOKEN_ID,
    existingLiquidity: REB_EXISTING_LIQUIDITY,
    collectRecipient: SENDER,
    mintParams: {
      token0: USDC,
      token1: WETH,
      fee: 500,
      tickLower: -207000,
      tickUpper: -202000,
      amount0Desired: 100_000000n,
      amount1Desired: 50_000_000_000_000_000n,
      amount0Min: 99_500000n,
      amount1Min: 49_750_000_000_000_000n,
      recipient: SENDER,
      deadline: REB_DEADLINE,
    },
    decreaseAmount0Min: 0n,
    decreaseAmount1Min: 0n,
    deadline: REB_DEADLINE,
  });
}

beforeEach(() => {
  _resetHandleStoreForTesting();
  _resetDemoModeForTesting();
  _resetActivePersonaForTesting();
  getStatusSpy.mockReset();
  getTransactionCountSpy.mockReset();
  estimateFeesPerGasSpy.mockReset();
  estimateGasSpy.mockReset();
  callSpy.mockReset();
  lookupSelectorSpy.mockReset();
});

afterEach(() => {
  _resetDemoModeForTesting();
  _resetActivePersonaForTesting();
});

describe("preview_send Uniswap V3 LP composite-multicall — outer arm shape", () => {
  it("(tx.to=NPM, selector=0xac9650d8) → composite DECODED ARGS block + LEDGER NOTICE", async () => {
    scriptStdMocks();
    const npm = getUniswapV3NonfungiblePositionManagerAddress(1)!;
    const data = composeRebalance();
    // Outer selector pin BEFORE preview dispatch.
    expect(data.slice(0, 10).toLowerCase()).toBe(
      UNISWAP_V3_LP_SELECTORS.multicallBytes,
    );
    expect(data.slice(0, 10).toLowerCase()).toBe("0xac9650d8");

    const handle = seedHandle(npm, 0n, data);
    const r = await callTool({ handle });
    expect(r.isError).toBeFalsy();
    const text = (r.content as { type: string; text: string }[])[0]!.text;
    expect(text).toContain("DECODED ARGS — composite multicall");
    expect(text).toContain("Uniswap V3 NonfungiblePositionManager");
    expect(text).toContain("3 inner calls");
    expect(text).toContain("selector 0xac9650d8");
    expect(text).toContain(LEDGER_NOTICE_UNISWAP_V3_LP_TEMPLATE);
  });

  it("renders 3 step sub-blocks in LOAD-BEARING order with verb labels", async () => {
    scriptStdMocks();
    const npm = getUniswapV3NonfungiblePositionManagerAddress(1)!;
    const handle = seedHandle(npm, 0n, composeRebalance());

    const r = await callTool({ handle });
    expect(r.isError).toBeFalsy();
    const text = (r.content as { type: string; text: string }[])[0]!.text;

    // Step headers — selector + verb label in LOAD-BEARING order.
    expect(text).toMatch(/Step 1 of 3: 0x0c49ccbe \(decreaseLiquidity\)/);
    expect(text).toMatch(/Step 2 of 3: 0xfc6f7865 \(collect\)/);
    expect(text).toMatch(/Step 3 of 3: 0x88316456 \(mint\)/);

    // Step 1 < step 2 < step 3 (order check via index positions).
    const step1Idx = text.indexOf("Step 1 of 3");
    const step2Idx = text.indexOf("Step 2 of 3");
    const step3Idx = text.indexOf("Step 3 of 3");
    expect(step1Idx).toBeGreaterThan(0);
    expect(step2Idx).toBeGreaterThan(step1Idx);
    expect(step3Idx).toBeGreaterThan(step2Idx);
  });

  it("each step sub-block carries its own decoded args (decrease liquidity / collect MAX_UINT128 / mint tick range)", async () => {
    scriptStdMocks();
    const npm = getUniswapV3NonfungiblePositionManagerAddress(1)!;
    const handle = seedHandle(npm, 0n, composeRebalance());

    const r = await callTool({ handle });
    expect(r.isError).toBeFalsy();
    const text = (r.content as { type: string; text: string }[])[0]!.text;

    // Step 1 decreaseLiquidity carries the 100% existingLiquidity + tokenId.
    expect(text).toContain("decreaseLiquidity");
    expect(text).toContain(REB_EXISTING_LIQUIDITY.toString());
    expect(text).toContain(REB_TOKEN_ID.toString());

    // Step 2 collect surfaces MAX_UINT128 sentinels rendered as the human label.
    expect(text).toContain("MAX_UINT128");
    expect(text).toContain("collect everything");

    // Step 3 mint surfaces token0/token1 + new tick range.
    expect(text).toContain(USDC);
    expect(text).toContain(WETH);
    expect(text).toContain("-207000");
    expect(text).toContain("-202000");
  });

  it("structuredContent.decodedArgs surfaces composite-multicall kind with 3 sub-call serialized entries", async () => {
    scriptStdMocks();
    const npm = getUniswapV3NonfungiblePositionManagerAddress(1)!;
    const handle = seedHandle(npm, 0n, composeRebalance());

    const r = await callTool({ handle });
    expect(r.isError).toBeFalsy();
    const sc = r.structuredContent as {
      decodedArgs: {
        kind: string;
        subCalls: Array<{ kind: string }>;
      };
      ledgerNotice: string | null;
    };
    expect(sc.decodedArgs.kind).toBe("uniswap-v3-lp-composite-multicall");
    expect(sc.decodedArgs.subCalls.length).toBe(3);
    expect(sc.decodedArgs.subCalls[0]!.kind).toBe(
      "uniswap-v3-lp-decrease-liquidity",
    );
    expect(sc.decodedArgs.subCalls[1]!.kind).toBe("uniswap-v3-lp-collect");
    expect(sc.decodedArgs.subCalls[2]!.kind).toBe("uniswap-v3-lp-mint");
    expect(sc.ledgerNotice).toBe("uniswap-v3-lp-blind-sign");
  });
});

describe("preview_send Uniswap V3 LP composite-multicall — Pitfall 7 SHARED-decoder discipline (T-COMPOSITE-DECODE-SOT)", () => {
  it("decodeSingleNpmCall is invoked exactly 3 times (one per inner call) — single source of truth", async () => {
    scriptStdMocks();
    const npm = getUniswapV3NonfungiblePositionManagerAddress(1)!;
    const handle = seedHandle(npm, 0n, composeRebalance());

    const spy = vi.spyOn(_npmDecodeShared, "decodeSingleNpmCall");
    try {
      const r = await callTool({ handle });
      expect(r.isError).toBeFalsy();
      expect(spy).toHaveBeenCalledTimes(3);

      // Each call's selector argument matches the LOAD-BEARING order.
      expect(spy.mock.calls[0]![1].toLowerCase()).toBe(
        UNISWAP_V3_LP_SELECTORS.decreaseLiquidity,
      );
      expect(spy.mock.calls[1]![1].toLowerCase()).toBe(
        UNISWAP_V3_LP_SELECTORS.collect,
      );
      expect(spy.mock.calls[2]![1].toLowerCase()).toBe(
        UNISWAP_V3_LP_SELECTORS.mint,
      );
    } finally {
      spy.mockRestore();
    }
  });
});

describe("preview_send Uniswap V3 LP composite-multicall — (to, selector) tuple dispatch defense", () => {
  it("(tx.to !== NPM, selector=0xac9650d8) → composite arm is NEVER rendered (defense in depth)", async () => {
    scriptStdMocks();
    // Some OTHER contract that just happens to share the bytes-only
    // multicall selector. The first defense layer is the canonical-dispatch
    // allowlist (Layer 0.5) which refuses any non-canonical tx.to; the second
    // is the (tx.to === NPM SOT) guard in the composite arm itself. Either
    // way, the composite DECODED ARGS block must NOT render against a
    // non-NPM target.
    const other = getAddress("0x1111111111111111111111111111111111111111");
    const data = composeRebalance();

    const handle = seedHandle(other, 0n, data);
    const r = await callTool({ handle });
    // Two valid defense paths: (a) Layer 0.5 refuses (r.isError === true), or
    // (b) we got through but the composite arm guard fell through. In BOTH
    // cases the composite DECODED ARGS block must NOT be present.
    const text =
      ((r.content as { type: string; text: string }[])[0]?.text ?? "");
    expect(text).not.toContain("DECODED ARGS — composite multicall");

    const sc = r.structuredContent as {
      decodedArgs?: unknown;
    };
    if (sc.decodedArgs !== undefined && sc.decodedArgs !== null) {
      expect(sc.decodedArgs).not.toMatchObject({
        kind: "uniswap-v3-lp-composite-multicall",
      });
    }
  });
});
