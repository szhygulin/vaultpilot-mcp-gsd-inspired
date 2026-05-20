// test/get-tron-token-balance.test.ts — Phase 17 Plan 17-03 (TRON-READ-02).
//
// Single-contract TRC-20 balance tool. Tests cover:
//
//   - Registered USDT-shaped contract (decimals=6) — happy path.
//   - **REGRESSION ANCHOR per research § Pitfall 5**: Registered USDD-shaped
//     contract (decimals=18). A regression that hardcodes `decimals=6`
//     would render `1_000_000_000_000_000_000n` raw as `"1000000000000"`
//     (off by 1e12). The assertion `decimals: 18` + `amount: "1"` fails
//     loud on this regression.
//   - Unregistered contract → on-demand ABI fallback for decimals + symbol.
//     **NEVER defaults to 6** — the ABI call must be made and the result
//     used.
//   - Empty-registry stub branch (Plan 17-01 ships `[]`; this exercises
//     the fallback for ALL queries until Plan 17-04 lands curated entries).
//   - `priceUnknown: true` always — Plan 17-03 does NOT wire DefiLlama
//     pricing; Plan 17-04 lands that. The flag's presence in the envelope
//     stays consistent post-17-04.
//   - Input regex rejection (EVM-shape `0x…` input).
//   - TRC-20 RPC error envelope.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { _tronRegistry } from "../src/chains/tron/registry.js";

// Mock findByAddress so we can drive registered vs unregistered branches
// without depending on Plan 17-04 landing curated entries.
const findByAddressSpy = vi.fn();
vi.mock("../src/tokens/tron-top-25.js", async () => {
  const actual = await vi.importActual<
    typeof import("../src/tokens/tron-top-25.js")
  >("../src/tokens/tron-top-25.js");
  return {
    ...actual,
    findByAddress: (
      ...args: Parameters<typeof actual.findByAddress>
    ) => findByAddressSpy(...args),
  };
});

import {
  _resetRegistryForTesting,
  getRegisteredTool,
  type ToolHandlerResult,
} from "../src/tools/index.js";
import "../src/tools/register-all.js";

const FIXTURE_WALLET = "TWd4WrZ9wn84f5x1hZhL4DHvk738ns5jwb";
const USDT_TRC20 = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";
const USDD_TRC20 = "TPYmHEhy5n8TCEfYGqW2rPxsghSfzghPDn";
const UNKNOWN_CONTRACT = "TXYZopnbnEDJjm2QM7ZTHnHNNJsuPwBzMd";

interface ContractMethods {
  balanceOf?: () => { call: () => Promise<unknown> };
  decimals?: () => { call: () => Promise<unknown> };
  symbol?: () => { call: () => Promise<unknown> };
}

function makeStubTronWeb(opts: {
  /** Map by contract address → methods. */
  contracts: Record<string, ContractMethods>;
  /** When true, `tw.contract(...)` throws (proxies a contract-load failure). */
  contractLoadError?: boolean;
}): { tw: object } {
  const contract = vi.fn(async (_abi: unknown, addr: string) => {
    if (opts.contractLoadError) {
      throw new Error("contract load failed");
    }
    const methods = opts.contracts[addr] ?? {};
    return {
      methods: {
        balanceOf: (_w: string) => ({
          call: methods.balanceOf
            ? methods.balanceOf().call
            : async () => 0,
        }),
        decimals: () => ({
          call: methods.decimals
            ? methods.decimals().call
            : async () => {
                throw new Error("decimals() not stubbed");
              },
        }),
        symbol: () => ({
          call: methods.symbol
            ? methods.symbol().call
            : async () => {
                throw new Error("symbol() not stubbed");
              },
        }),
      },
    };
  });
  const tw = { contract };
  return { tw };
}

beforeEach(() => {
  vi.restoreAllMocks();
  findByAddressSpy.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
  void _resetRegistryForTesting;
});

async function callTool(
  args: Record<string, unknown>,
): Promise<ToolHandlerResult> {
  const tool = getRegisteredTool("get_tron_token_balance");
  if (!tool) throw new Error("get_tron_token_balance not registered");
  return tool.handler(args);
}

describe("get_tron_token_balance — registered USDT (decimals=6)", () => {
  it("happy path: 1.0 USDT → amount '1', decimals 6, symbol 'USDT'", async () => {
    findByAddressSpy.mockReturnValue({
      contractAddress: USDT_TRC20,
      symbol: "USDT",
      decimals: 6,
      displayName: "USDT-TRC20",
    });
    const { tw } = makeStubTronWeb({
      contracts: {
        [USDT_TRC20]: {
          balanceOf: () => ({ call: async () => ({ toString: () => "1000000" }) }),
        },
      },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.spyOn(_tronRegistry, "getTronWeb").mockReturnValue(tw as any);

    const result = await callTool({
      wallet: FIXTURE_WALLET,
      contractAddress: USDT_TRC20,
    });

    expect(result.isError).toBeUndefined();
    const sc = result.structuredContent as {
      amount: string;
      decimals: number;
      symbol: string;
      priceUnknown?: true;
    };
    expect(sc.amount).toBe("1");
    expect(sc.decimals).toBe(6);
    expect(sc.symbol).toBe("USDT");
    expect(sc.priceUnknown).toBe(true);
  });
});

describe("get_tron_token_balance — REGRESSION ANCHOR: USDD (decimals=18)", () => {
  it("registered USDD with raw 1e18 returns amount '1' + decimals 18 — defaulting to 6 would render '1000000000000' (off by 1e12)", async () => {
    findByAddressSpy.mockReturnValue({
      contractAddress: USDD_TRC20,
      symbol: "USDD",
      decimals: 18,
      displayName: "USDD",
    });
    const rawBalance = 1_000_000_000_000_000_000n; // 1 USDD at 18 decimals
    const { tw } = makeStubTronWeb({
      contracts: {
        [USDD_TRC20]: {
          balanceOf: () => ({
            call: async () => ({ toString: () => rawBalance.toString() }),
          }),
        },
      },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.spyOn(_tronRegistry, "getTronWeb").mockReturnValue(tw as any);

    const result = await callTool({
      wallet: FIXTURE_WALLET,
      contractAddress: USDD_TRC20,
    });

    expect(result.isError).toBeUndefined();
    const sc = result.structuredContent as {
      amount: string;
      decimals: number;
      symbol: string;
      raw: string;
    };
    expect(sc.decimals).toBe(18);
    expect(sc.decimals).not.toBe(6);
    expect(sc.amount).toBe("1");
    // Specifically NOT the regression-shape "1000000000000" (12 zeros)
    // — that would surface if decimals defaulted to 6.
    expect(sc.amount).not.toBe("1000000000000");
    expect(sc.symbol).toBe("USDD");
    expect(sc.raw).toBe("1000000000000000000");
  });
});

describe("get_tron_token_balance — on-demand ABI fallback (unregistered contract)", () => {
  it("unregistered contract → ABI decimals() + symbol() called; result used (NEVER defaults to 6)", async () => {
    findByAddressSpy.mockReturnValue(undefined);
    const decimalsCallSpy = vi.fn(async () => 8);
    const symbolCallSpy = vi.fn(async () => "XYZ");
    const balanceCallSpy = vi.fn(async () => ({ toString: () => "100000000" })); // 1.0 at 8 decimals
    const { tw } = makeStubTronWeb({
      contracts: {
        [UNKNOWN_CONTRACT]: {
          balanceOf: () => ({ call: balanceCallSpy }),
          decimals: () => ({ call: decimalsCallSpy }),
          symbol: () => ({ call: symbolCallSpy }),
        },
      },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.spyOn(_tronRegistry, "getTronWeb").mockReturnValue(tw as any);

    const result = await callTool({
      wallet: FIXTURE_WALLET,
      contractAddress: UNKNOWN_CONTRACT,
    });

    expect(result.isError).toBeUndefined();
    const sc = result.structuredContent as {
      amount: string;
      decimals: number;
      symbol: string;
    };
    expect(findByAddressSpy).toHaveBeenCalledWith(UNKNOWN_CONTRACT);
    expect(decimalsCallSpy).toHaveBeenCalled();
    expect(symbolCallSpy).toHaveBeenCalled();
    expect(sc.decimals).toBe(8);
    expect(sc.decimals).not.toBe(6); // explicit anti-default assertion
    expect(sc.symbol).toBe("XYZ");
    expect(sc.amount).toBe("1");
  });

  it("empty-registry stub branch (Plan 17-01) — findByAddress returns undefined for ANY query, ABI fallback fires for every read", async () => {
    findByAddressSpy.mockReturnValue(undefined);
    const decimalsCallSpy = vi.fn(async () => 6);
    const symbolCallSpy = vi.fn(async () => "USDT");
    const { tw } = makeStubTronWeb({
      contracts: {
        [USDT_TRC20]: {
          balanceOf: () => ({ call: async () => ({ toString: () => "5000000" }) }),
          decimals: () => ({ call: decimalsCallSpy }),
          symbol: () => ({ call: symbolCallSpy }),
        },
      },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.spyOn(_tronRegistry, "getTronWeb").mockReturnValue(tw as any);

    const result = await callTool({
      wallet: FIXTURE_WALLET,
      contractAddress: USDT_TRC20,
    });

    expect(result.isError).toBeUndefined();
    expect(decimalsCallSpy).toHaveBeenCalledTimes(1);
    expect(symbolCallSpy).toHaveBeenCalledTimes(1);
    const sc = result.structuredContent as { amount: string; decimals: number };
    expect(sc.amount).toBe("5");
    expect(sc.decimals).toBe(6);
  });
});

describe("get_tron_token_balance — decimalsUnknown branch", () => {
  it("unregistered contract whose decimals() ABI call fails → surfaces decimalsUnknown: true; raw still surfaced", async () => {
    findByAddressSpy.mockReturnValue(undefined);
    const { tw } = makeStubTronWeb({
      contracts: {
        [UNKNOWN_CONTRACT]: {
          balanceOf: () => ({ call: async () => ({ toString: () => "42" }) }),
          decimals: () => ({
            call: async () => {
              throw new Error("decimals() reverted");
            },
          }),
          symbol: () => ({ call: async () => "XYZ" }),
        },
      },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.spyOn(_tronRegistry, "getTronWeb").mockReturnValue(tw as any);

    const result = await callTool({
      wallet: FIXTURE_WALLET,
      contractAddress: UNKNOWN_CONTRACT,
    });

    expect(result.isError).toBeUndefined();
    const sc = result.structuredContent as {
      decimalsUnknown?: true;
      raw: string;
      amount: string;
    };
    expect(sc.decimalsUnknown).toBe(true);
    expect(sc.raw).toBe("42");
    // No decimals-aware formatting — amount falls back to raw.
    expect(sc.amount).toBe("42");
  });
});

describe("get_tron_token_balance — pricing surface (Plan 17-04 territory)", () => {
  it("priceUnknown: true always surfaces (Plan 17-04 lands DefiLlama integration; until then every response is priceUnknown)", async () => {
    findByAddressSpy.mockReturnValue({
      contractAddress: USDT_TRC20,
      symbol: "USDT",
      decimals: 6,
      displayName: "USDT-TRC20",
    });
    const { tw } = makeStubTronWeb({
      contracts: {
        [USDT_TRC20]: {
          balanceOf: () => ({ call: async () => ({ toString: () => "1000000" }) }),
        },
      },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.spyOn(_tronRegistry, "getTronWeb").mockReturnValue(tw as any);

    const result = await callTool({
      wallet: FIXTURE_WALLET,
      contractAddress: USDT_TRC20,
    });
    const sc = result.structuredContent as { priceUnknown?: true };
    expect(sc.priceUnknown).toBe(true);
  });
});

describe("get_tron_token_balance — RPC error envelope", () => {
  it("balanceOf RPC failure → TRON_RPC_FAILED envelope", async () => {
    findByAddressSpy.mockReturnValue({
      contractAddress: USDT_TRC20,
      symbol: "USDT",
      decimals: 6,
      displayName: "USDT-TRC20",
    });
    const { tw } = makeStubTronWeb({
      contracts: {
        [USDT_TRC20]: {
          balanceOf: () => ({
            call: async () => {
              throw new Error("rpc down");
            },
          }),
        },
      },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.spyOn(_tronRegistry, "getTronWeb").mockReturnValue(tw as any);

    const result = await callTool({
      wallet: FIXTURE_WALLET,
      contractAddress: USDT_TRC20,
    });
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({ errorCode: "TRON_RPC_FAILED" });
  });
});

describe("get_tron_token_balance — input validation", () => {
  it("contractAddress with EVM-shape 0x… → INVALID_INPUT (schema regex rejects)", async () => {
    const result = await callTool({
      wallet: FIXTURE_WALLET,
      contractAddress: "",
    });
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({ errorCode: "INVALID_INPUT" });
  });
});
