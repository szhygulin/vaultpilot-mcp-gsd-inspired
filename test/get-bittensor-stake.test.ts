// test/get-bittensor-stake.test.ts — Phase 46 Plan 46-03 (TAO-R-02).
//
// Covers get_bittensor_stake through a MOCKED ApiPromise at the
// `_bittensorRegistry.getApi` boundary — NEVER a real WsProvider socket.
// The load-bearing assertion: per-(hotkey,netuid) `.stake` is labeled
// ALPHA (the source of truth), DISTINCT from the derived `taoEquivalent`
// column (priced via currentAlphaPrice). Off-by-unit footgun guard
// (Pitfall 2 / T-46-R02).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  _bittensorRegistry,
  _resetBittensorRegistryForTesting,
} from "../src/chains/bittensor/registry.js";
import {
  getRegisteredTool,
  type ToolHandlerResult,
} from "../src/tools/index.js";

await import("../src/tools/get_bittensor_stake.js");

async function callTool(
  args: Record<string, unknown> = {},
): Promise<ToolHandlerResult> {
  const tool = getRegisteredTool("get_bittensor_stake");
  if (!tool) throw new Error("get_bittensor_stake not registered");
  return tool.handler(args);
}

const VALID_WALLET = "5C62Ck4UrFPiBtoCmeSrgF7x9yv9mn38446dhCpsi2mLHiFT";

function makeFakeApi(opts: {
  stakeRows: Array<{
    hotkey: string;
    netuid: number;
    stake: string | number;
    isRegistered: boolean;
  }>;
  priceByNetuid: Record<number, string>;
}): unknown {
  return {
    query: { system: { account: vi.fn() } },
    call: {
      stakeInfoRuntimeApi: {
        getStakeInfoForColdkey: vi.fn().mockResolvedValue({
          toJSON: () => opts.stakeRows,
        }),
      },
      swapRuntimeApi: {
        currentAlphaPrice: vi.fn().mockImplementation((netuid: number) =>
          Promise.resolve({ toString: () => opts.priceByNetuid[netuid] ?? "0" }),
        ),
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

describe("get_bittensor_stake — per-(hotkey,netuid) alpha labeled distinct from TAO-equiv (TAO-R-02)", () => {
  it("each row carries alpha (ALPHA) + taoEquivalent (TAO) with explicit unit labels", async () => {
    vi.spyOn(_bittensorRegistry, "getApi").mockResolvedValue(
      makeFakeApi({
        stakeRows: [
          // 2.5 alpha at price 0.4 TAO/alpha (400_000_000 RAO) → 1 TAO-equiv.
          { hotkey: "5Hotkey1", netuid: 1, stake: "2500000000", isRegistered: true },
          // 1 alpha at price 9_833_079 RAO/alpha → 0.009833079 TAO-equiv.
          { hotkey: "5Hotkey2", netuid: 2, stake: "1000000000", isRegistered: false },
        ],
        priceByNetuid: { 1: "400000000", 2: "9833079" },
      }) as never,
    );

    const result = await callTool({ wallet: VALID_WALLET });

    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as {
      positions: Array<{
        hotkey: string;
        netuid: number;
        alpha: string;
        alphaUnit: string;
        taoEquivalent: string;
        taoEquivalentUnit: string;
        isRegistered: boolean;
      }>;
      positionCount: number;
    };

    expect(sc.positionCount).toBe(2);

    const row1 = sc.positions.find((p) => p.netuid === 1)!;
    expect(row1.hotkey).toBe("5Hotkey1");
    expect(row1.alpha).toBe("2.5");
    expect(row1.alphaUnit).toBe("ALPHA");
    expect(row1.taoEquivalent).toBe("1"); // 2.5 × 0.4 = 1.0 TAO
    expect(row1.taoEquivalentUnit).toBe("TAO");
    expect(row1.isRegistered).toBe(true);
    // The two amounts are DISTINCT — alpha is NOT the TAO-equiv.
    expect(row1.alpha).not.toBe(row1.taoEquivalent);

    const row2 = sc.positions.find((p) => p.netuid === 2)!;
    expect(row2.alpha).toBe("1");
    expect(row2.alphaUnit).toBe("ALPHA");
    expect(row2.taoEquivalent).toBe("0.009833079");
    expect(row2.taoEquivalentUnit).toBe("TAO");
    expect(row2.isRegistered).toBe(false);
  });

  it("text response makes the alpha-vs-TAO distinction explicit", async () => {
    vi.spyOn(_bittensorRegistry, "getApi").mockResolvedValue(
      makeFakeApi({
        stakeRows: [
          { hotkey: "5Hotkey1", netuid: 7, stake: "1000000000", isRegistered: true },
        ],
        priceByNetuid: { 7: "1000000000" },
      }) as never,
    );

    const result = await callTool({ wallet: VALID_WALLET });
    const text = result.content[0]?.text ?? "";
    expect(text).toMatch(/ALPHA/);
    expect(text).toMatch(/TAO-equiv/);
    expect(text).toMatch(/netuid 7/);
  });

  it("empty stake set → zero positions, no crash", async () => {
    vi.spyOn(_bittensorRegistry, "getApi").mockResolvedValue(
      makeFakeApi({ stakeRows: [], priceByNetuid: {} }) as never,
    );
    const result = await callTool({ wallet: VALID_WALLET });
    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as { positionCount: number };
    expect(sc.positionCount).toBe(0);
    expect(result.content[0]?.text ?? "").toMatch(/no active stake/i);
  });
});

describe("get_bittensor_stake — SS58 input gate (V5 / T-46-R01)", () => {
  it("rejects a wrong-checksum wallet with INVALID_INPUT BEFORE any RPC", async () => {
    const getApiSpy = vi.spyOn(_bittensorRegistry, "getApi");
    const bad = "5C62Ck4UrFPiBtoCmeSrgF7x9yv9mn38446dhCpsi2mLHiFX";
    const result = await callTool({ wallet: bad });
    expect(result.isError).toBe(true);
    expect((result.structuredContent as { errorCode: string }).errorCode).toBe(
      "INVALID_INPUT",
    );
    expect(getApiSpy).not.toHaveBeenCalled();
  });
});
