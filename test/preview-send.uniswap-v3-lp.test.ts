// preview_send Uniswap V3 NonfungiblePositionManager (NPM) tests —
// Phase 33 Plan 33-02 Task 3.
//
// (tx.to, selector) tuple-dispatch correctness anchor for the 5 NPM verbs
// AND the cross-protocol burn-selector collision with Phase 31 rETH.burn:
//
//   T1: (tx.to=NPM, selector=NPM.mint 0x88316456) → NPM mint DECODED ARGS +
//       LEDGER NOTICE (Uniswap V3 LP template).
//   T2: (tx.to=NPM, selector=NPM.burn 0x42966c68) → NPM burn DECODED ARGS +
//       LEDGER NOTICE — distinct from Phase 31 rETH.burn arm (collision
//       resolution).
//   T3: (tx.to=rETH, selector=0x42966c68) → STILL routes to Phase 31 Rocket
//       Pool burn arm (Pitfall 2 regression — Plan 33-02 must NOT break the
//       prior phase's behavior).
//   T4: (tx.to=NPM, selector=NPM.collect 0xfc6f7865) → NPM collect with
//       MAX_UINT128 sentinel surface intact.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Address, Hex } from "viem";

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
  getRocketPoolRethAddress,
  getUniswapV3NonfungiblePositionManagerAddress,
} from "../src/config/contracts.js";
import {
  MAX_UINT128,
  _uniswapV3LpProtocol,
} from "../src/protocols/uniswap-v3-lp.js";
import { encodeRocketPoolBurn } from "../src/protocols/rocketpool.js";
import { LEDGER_NOTICE_UNISWAP_V3_LP_TEMPLATE } from "../src/signing/blocks.js";
import {
  _resetHandleStoreForTesting,
  createHandle,
} from "../src/signing/handle-store.js";
import {
  getRegisteredTool,
  type ToolHandlerResult,
} from "../src/tools/index.js";

import { getAddress } from "viem";

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
  estimateGasSpy.mockResolvedValue(100_000n);
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

describe("preview_send Uniswap V3 LP — T1 mint arm (positive case)", () => {
  it("(tx.to=NPM, selector=NPM.mint) → DECODED ARGS + LEDGER NOTICE (Uniswap V3 LP template)", async () => {
    scriptStdMocks();
    const npm = getUniswapV3NonfungiblePositionManagerAddress(1)!;
    const USDC = getAddress("0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48");
    const WETH = getAddress("0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2");
    const data = _uniswapV3LpProtocol.encodeMint({
      token0: USDC,
      token1: WETH,
      fee: 500,
      tickLower: -60,
      tickUpper: 60,
      amount0Desired: 100_000000n,
      amount1Desired: 50_000_000_000_000_000n,
      amount0Min: 99_500000n,
      amount1Min: 49_750_000_000_000_000n,
      recipient: SENDER,
      deadline: 1748707200n,
    });
    const handle = seedHandle(npm, 0n, data);

    const r = await callTool({ handle });
    expect(r.isError).toBeFalsy();
    const text = (r.content as { type: string; text: string }[])[0]!.text;
    expect(text).toContain("DECODED ARGS — mint");
    expect(text).toContain("NonfungiblePositionManager");
    expect(text).toContain(LEDGER_NOTICE_UNISWAP_V3_LP_TEMPLATE);

    const sc = r.structuredContent as {
      decodedArgs: { kind: string; token0: string; token1: string };
      ledgerNotice: string | null;
    };
    expect(sc.decodedArgs.kind).toBe("uniswap-v3-lp-mint");
    expect(sc.decodedArgs.token0).toBe(USDC);
    expect(sc.decodedArgs.token1).toBe(WETH);
    expect(sc.ledgerNotice).toBe("uniswap-v3-lp-blind-sign");
  });
});

describe("preview_send Uniswap V3 LP — T2 burn arm (selector collision with Phase 31 rETH.burn — positive case for NPM)", () => {
  it("(tx.to=NPM, selector=0x42966c68) → NPM burn DECODED ARGS + LEDGER NOTICE (Uniswap V3 LP template)", async () => {
    scriptStdMocks();
    const npm = getUniswapV3NonfungiblePositionManagerAddress(1)!;
    const data = _uniswapV3LpProtocol.encodeBurn(12345n);
    expect(data.slice(0, 10).toLowerCase()).toBe("0x42966c68");

    const handle = seedHandle(npm, 0n, data);
    const r = await callTool({ handle });
    expect(r.isError).toBeFalsy();
    const text = (r.content as { type: string; text: string }[])[0]!.text;
    expect(text).toContain("DECODED ARGS — burn");
    expect(text).toContain("NonfungiblePositionManager");
    expect(text).toContain(LEDGER_NOTICE_UNISWAP_V3_LP_TEMPLATE);

    const sc = r.structuredContent as {
      decodedArgs: { kind: string; tokenId: string };
      ledgerNotice: string | null;
    };
    expect(sc.decodedArgs.kind).toBe("uniswap-v3-lp-burn");
    expect(sc.decodedArgs.tokenId).toBe("12345");
    expect(sc.ledgerNotice).toBe("uniswap-v3-lp-blind-sign");
  });
});

describe("preview_send Uniswap V3 LP — T3 burn collision regression (Phase 31 rETH.burn route still intact)", () => {
  it("(tx.to=rETH, selector=0x42966c68) → STILL routes to Phase 31 Rocket Pool burn arm (NOT NPM)", async () => {
    scriptStdMocks();
    const reth = getRocketPoolRethAddress(1)!;
    const data = encodeRocketPoolBurn(1_000_000_000_000_000_000n);
    expect(data.slice(0, 10).toLowerCase()).toBe("0x42966c68");

    const handle = seedHandle(reth, 0n, data);
    const r = await callTool({ handle });
    expect(r.isError).toBeFalsy();
    const text = (r.content as { type: string; text: string }[])[0]!.text;
    // Routes to Phase 31 rocketpool-burn DECODED ARGS, NOT Phase 33 NPM.
    expect(text).toContain("Rocket Pool unstake (burn)");
    expect(text).not.toContain("DECODED ARGS — burn (Uniswap V3");

    const sc = r.structuredContent as {
      decodedArgs: { kind: string };
      ledgerNotice: string | null;
    };
    expect(sc.decodedArgs.kind).toBe("rocketpool-burn");
    expect(sc.decodedArgs.kind).not.toBe("uniswap-v3-lp-burn");
    expect(sc.ledgerNotice).toBe("rocketpool-blind-sign");
  });
});

describe("preview_send Uniswap V3 LP — T4 collect arm (MAX_UINT128 sentinel surface intact)", () => {
  it("(tx.to=NPM, selector=NPM.collect, MAX_UINT128 sentinels) → DECODED ARGS renders 'collect everything'", async () => {
    scriptStdMocks();
    const npm = getUniswapV3NonfungiblePositionManagerAddress(1)!;
    const data = _uniswapV3LpProtocol.encodeCollect({
      tokenId: 12345n,
      recipient: SENDER,
      amount0Max: MAX_UINT128,
      amount1Max: MAX_UINT128,
    });
    const handle = seedHandle(npm, 0n, data);

    const r = await callTool({ handle });
    expect(r.isError).toBeFalsy();
    const text = (r.content as { type: string; text: string }[])[0]!.text;
    expect(text).toContain("DECODED ARGS — collect");
    // The sentinel renders as a human-readable label rather than raw bigint.
    expect(text).toContain("MAX_UINT128");
    expect(text).toContain("collect everything");

    const sc = r.structuredContent as {
      decodedArgs: {
        kind: string;
        amount0Max: string;
        amount1Max: string;
      };
    };
    expect(sc.decodedArgs.kind).toBe("uniswap-v3-lp-collect");
    expect(sc.decodedArgs.amount0Max).toBe(MAX_UINT128.toString());
    expect(sc.decodedArgs.amount1Max).toBe(MAX_UINT128.toString());
  });
});
