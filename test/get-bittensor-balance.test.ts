// test/get-bittensor-balance.test.ts — Phase 46 Plan 46-03 (TAO-R-01).
//
// Covers get_bittensor_balance + the getFreeBalance/getStakeInfo decode
// path through a MOCKED ApiPromise. The mock is installed at the
// `_bittensorRegistry.getApi` boundary (the ESM spy-affordance) — NEVER a
// real WsProvider / ApiPromise socket (the sandbox blocks the real RPC; a
// real connect would hang). Every codec value (`.toBigInt()` / `.toJSON()`
// / `.toString()`) is faked to match the live-probe shapes documented in
// 46-RESEARCH §Reads.
//
// Behaviors:
//   1. free RAO → decimal TAO via system.account.data.free (formatter edge
//      cases through the tool: 0, 1 RAO, 2.5 TAO, u128-scale).
//   2. assertSs58Address rejects a wrong-checksum wallet BEFORE any RPC
//      (getApi NEVER called on bad input — V5 input gate).
//   3. staked TAO-equivalent = sum of per-row alpha priced to TAO via
//      currentAlphaPrice (1e9-scaled).
//   4. decimal STRINGS cross the boundary, never Number.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  _bittensorRegistry,
  _resetBittensorRegistryForTesting,
} from "../src/chains/bittensor/registry.js";
import {
  getRegisteredTool,
  type ToolHandlerResult,
} from "../src/tools/index.js";

await import("../src/tools/get_bittensor_balance.js");

async function callTool(
  args: Record<string, unknown> = {},
): Promise<ToolHandlerResult> {
  const tool = getRegisteredTool("get_bittensor_balance");
  if (!tool) throw new Error("get_bittensor_balance not registered");
  return tool.handler(args);
}

// The RESEARCH-verified valid prefix-42 coldkey anchor.
const VALID_WALLET = "5C62Ck4UrFPiBtoCmeSrgF7x9yv9mn38446dhCpsi2mLHiFT";

// Build a fake ApiPromise shaped exactly like the SubtensorRuntimeApi seam
// in tao-rpc-client.ts. `free` is a codec with `.toBigInt()`; the stake +
// price runtime APIs return codecs with `.toJSON()` / `.toString()`. Derived
// from the 46-RESEARCH §Reads probe shapes.
function makeFakeApi(opts: {
  freeRao: bigint;
  stakeRows?: Array<{
    hotkey: string;
    netuid: number;
    stake: string | number;
    isRegistered: boolean;
  }>;
  priceByNetuid?: Record<number, string>;
}): unknown {
  return {
    query: {
      system: {
        account: vi.fn().mockResolvedValue({
          data: { free: { toBigInt: () => opts.freeRao } },
        }),
      },
    },
    call: {
      stakeInfoRuntimeApi: {
        getStakeInfoForColdkey: vi.fn().mockResolvedValue({
          toJSON: () => opts.stakeRows ?? [],
        }),
      },
      swapRuntimeApi: {
        currentAlphaPrice: vi.fn().mockImplementation((netuid: number) => {
          const px = opts.priceByNetuid?.[netuid] ?? "0";
          return Promise.resolve({ toString: () => px });
        }),
      },
    },
  };
}

beforeEach(() => {
  _resetBittensorRegistryForTesting();
});

afterEach(() => {
  _resetBittensorRegistryForTesting();
  vi.restoreAllMocks();
});

describe("get_bittensor_balance — free RAO → decimal TAO (TAO-R-01 formatter edge cases)", () => {
  it("0 RAO free, no stake → freeTao \"0\", stakedTaoEquiv \"0\", strings not numbers", async () => {
    vi.spyOn(_bittensorRegistry, "getApi").mockResolvedValue(
      makeFakeApi({ freeRao: 0n }) as never,
    );

    const result = await callTool({ wallet: VALID_WALLET });

    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as {
      freeRao: string;
      freeTao: string;
      stakedTaoEquiv: string;
      decimals: number;
      symbol: string;
    };
    expect(sc.freeRao).toBe("0");
    expect(sc.freeTao).toBe("0");
    expect(sc.stakedTaoEquiv).toBe("0");
    expect(sc.decimals).toBe(9);
    expect(sc.symbol).toBe("TAO");
    // Decimal-string discipline: every amount is a string, never a number.
    expect(typeof sc.freeRao).toBe("string");
    expect(typeof sc.freeTao).toBe("string");
    expect(typeof sc.stakedTaoEquiv).toBe("string");
  });

  it("1 RAO free → freeTao \"0.000000001\" (no Number precision loss)", async () => {
    vi.spyOn(_bittensorRegistry, "getApi").mockResolvedValue(
      makeFakeApi({ freeRao: 1n }) as never,
    );
    const result = await callTool({ wallet: VALID_WALLET });
    const sc = result.structuredContent as { freeTao: string; freeRao: string };
    expect(sc.freeTao).toBe("0.000000001");
    expect(sc.freeRao).toBe("1");
  });

  it("2_500_000_000 RAO free → freeTao \"2.5\" (trailing-zero trim)", async () => {
    vi.spyOn(_bittensorRegistry, "getApi").mockResolvedValue(
      makeFakeApi({ freeRao: 2_500_000_000n }) as never,
    );
    const result = await callTool({ wallet: VALID_WALLET });
    const sc = result.structuredContent as { freeTao: string };
    expect(sc.freeTao).toBe("2.5");
  });

  it("u128-scale free balance formats without precision loss", async () => {
    // Beyond Number.MAX_SAFE_INTEGER.
    vi.spyOn(_bittensorRegistry, "getApi").mockResolvedValue(
      makeFakeApi({ freeRao: 9_007_199_254_740_993n }) as never,
    );
    const result = await callTool({ wallet: VALID_WALLET });
    const sc = result.structuredContent as { freeTao: string; freeRao: string };
    expect(sc.freeTao).toBe("9007199.254740993");
    expect(sc.freeRao).toBe("9007199254740993");
  });
});

describe("get_bittensor_balance — staked TAO-equivalent from per-row alpha (TAO-R-01)", () => {
  it("sums per-row alpha priced to TAO via currentAlphaPrice (1e9-scaled)", async () => {
    // Two positions: netuid 1 (price 9_833_079 RAO/alpha) holding 1e9 alpha,
    // netuid 2 (price 500_000_000 = 0.5 TAO/alpha) holding 2e9 alpha.
    //   netuid1: 1e9 alpha × 9_833_079 / 1e9 = 9_833_079 RAO
    //   netuid2: 2e9 alpha × 500_000_000 / 1e9 = 1_000_000_000 RAO
    //   total   = 1_009_833_079 RAO = 1.009833079 TAO
    vi.spyOn(_bittensorRegistry, "getApi").mockResolvedValue(
      makeFakeApi({
        freeRao: 1_000_000_000n, // 1 TAO free
        stakeRows: [
          { hotkey: "5Hotkey1", netuid: 1, stake: "1000000000", isRegistered: true },
          { hotkey: "5Hotkey2", netuid: 2, stake: 2_000_000_000, isRegistered: true },
        ],
        priceByNetuid: { 1: "9833079", 2: "500000000" },
      }) as never,
    );

    const result = await callTool({ wallet: VALID_WALLET });

    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as {
      freeTao: string;
      stakedTaoEquiv: string;
    };
    expect(sc.freeTao).toBe("1");
    expect(sc.stakedTaoEquiv).toBe("1.009833079");
    // Text response references the per-position count + points at the stake tool.
    const text = result.content[0]?.text ?? "";
    expect(text).toMatch(/2 positions/);
    expect(text).toMatch(/get_bittensor_stake/);
  });
});

describe("get_bittensor_balance — SS58 input gate (V5 / T-46-R01)", () => {
  it("rejects a wrong-checksum wallet with INVALID_INPUT BEFORE any RPC (getApi NEVER called)", async () => {
    const getApiSpy = vi.spyOn(_bittensorRegistry, "getApi");
    // Last char flipped from the valid anchor — bad blake2 checksum.
    const bad = "5C62Ck4UrFPiBtoCmeSrgF7x9yv9mn38446dhCpsi2mLHiFX";

    const result = await callTool({ wallet: bad });

    expect(result.isError).toBe(true);
    expect((result.structuredContent as { errorCode: string }).errorCode).toBe(
      "INVALID_INPUT",
    );
    // Load-bearing: the bad address short-circuits BEFORE the RPC round-trip.
    expect(getApiSpy).not.toHaveBeenCalled();
  });

  it("rejects an empty wallet with INVALID_INPUT", async () => {
    const getApiSpy = vi.spyOn(_bittensorRegistry, "getApi");
    const result = await callTool({ wallet: "" });
    expect(result.isError).toBe(true);
    expect((result.structuredContent as { errorCode: string }).errorCode).toBe(
      "INVALID_INPUT",
    );
    expect(getApiSpy).not.toHaveBeenCalled();
  });
});
