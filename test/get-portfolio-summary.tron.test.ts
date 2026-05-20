// test/get-portfolio-summary.tron.test.ts — Phase 17 Plan 17-04
// (TRON-READ-04).
//
// Mirror of test/get-portfolio-summary.solana.test.ts but for the TRON
// leg in the multi-chain fan-out. Coverage:
//   1. Real-mode resolution — paired record present → TRON leg fans out.
//   2. Demo-mode fallback — no paired record + isDemoMode + active TRON
//      persona → TRON leg uses persona address.
//   3. Real-mode preference over demo persona — paired wins when both.
//   4. Silent skip when neither source applies (no chainErrors entry).
//   5. includeTron=false suppresses leg even when address resolvable.
//   6. Per-row chain="tron" discriminator on fungibleBalances + native.
//   7. NATIVE_PRICING_PROXY.tron = WTRX — DefiLlama `tron:TNUC...FR`
//      keys native TRX pricing.
//   8. USDD decimals=18 REGRESSION ANCHOR — TRC-20 balance
//      1_000_000_000_000_000_000n must surface as "1" (NOT 1e12-shifted).
//   9. Per-token RPC failure preserves row with `error` field — leg still
//      returns; one bad contract doesn't poison the leg.
//  10. Discriminated-union widening — TRON fungibleBalances rows carry
//      base58check tokenAddress (NOT 0x-hex) + chain="tron".

import type { Address } from "viem";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const FIXTURE_PAIRED_TRON_ADDR = "TWd4WrZ9wn84f5x1hZhL4DHvk738ns5jwb";
const FIXTURE_PERSONA_TRON_ADDR = "TJqWLLfNcEhdvixFW9JEAr34iy8eYHHN6N";
const USDT_TRC20 = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";
const USDC_TRC20 = "TEkxiTehnzSmSe2XqrBj4w32RUN966rdz8";
const USDD_TRC20 = "TPYmHEhy5n8TCEfYGqW2rPxsghSfzghPDn";
const WTRX = "TNUC9Qb1rRpS5CbWLmNMxXBjyFoydXjWFR";

// ---- EVM legs return zero so the test focuses on TRON behaviour.
type ChainId = 1 | 42161 | 137 | 8453 | 10;
const evmState: Record<ChainId, { nativeBalance: bigint; erc20: never[] }> = {
  1: { nativeBalance: 0n, erc20: [] },
  42161: { nativeBalance: 0n, erc20: [] },
  137: { nativeBalance: 0n, erc20: [] },
  8453: { nativeBalance: 0n, erc20: [] },
  10: { nativeBalance: 0n, erc20: [] },
};

vi.mock("../src/chains/registry.js", () => ({
  getChainClient: (chainId: ChainId) => ({
    getBalance: vi.fn(async () => evmState[chainId].nativeBalance),
  }),
  isPublicNodeFallback: () => false,
  _resetChainRegistryForTesting: () => {},
  PUBLICNODE_RPC_URLS: { 1: "https://test.invalid" },
}));

vi.mock("../src/chains/erc20-scanner.js", async () => {
  const real = await vi.importActual<
    typeof import("../src/chains/erc20-scanner.js")
  >("../src/chains/erc20-scanner.js");
  return {
    ...real,
    scanErc20Balances: vi.fn(async () => []),
  };
});

// Mock the non-evm-account-store to control the paired-record source.
const accountStoreState: {
  paired: Array<{ chain: string; address: string }>;
} = { paired: [] };
vi.mock("../src/wallet/non-evm-account-store.js", () => ({
  listAccounts: vi.fn((filter?: { chainFilter?: string }) => {
    if (filter?.chainFilter) {
      return accountStoreState.paired.filter(
        (a) => a.chain === filter.chainFilter,
      );
    }
    return accountStoreState.paired;
  }),
}));

// Mock demo state — control isDemoMode + getActiveTronPersona.
const demoState: {
  isDemo: boolean;
  tronPersona: { tronAddress: string; slug: string } | null;
} = { isDemo: false, tronPersona: null };
vi.mock("../src/config/env.js", async () => {
  const real = await vi.importActual<typeof import("../src/config/env.js")>(
    "../src/config/env.js",
  );
  return {
    ...real,
    isDemoMode: () => demoState.isDemo,
  };
});
vi.mock("../src/demo/state.js", async () => {
  const real = await vi.importActual<typeof import("../src/demo/state.js")>(
    "../src/demo/state.js",
  );
  return {
    ...real,
    getActiveTronPersona: () => demoState.tronPersona,
    getActiveSolanaPersona: () => null,
  };
});

import { _tronRegistry } from "../src/chains/tron/registry.js";
import { _resetPriceCacheForTesting } from "../src/pricing/defillama.js";
import {
  _resetRegistryForTesting,
  getRegisteredTool,
  type ToolHandlerResult,
} from "../src/tools/index.js";
import "../src/tools/register-all.js";

const EVM_WALLET: Address = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";

/**
 * Build a stub TronWeb instance for the integration test. Drives
 * `tw.trx.getBalance(wallet)` and `tw.contract(...).methods.balanceOf(...).call()`
 * per-contract balance reads. The fan-out reader hits balanceOf once per
 * curated registry entry, then prices via DefiLlama.
 */
function makeStubTronWeb(opts: {
  /** sun amount returned by `trx.getBalance`. */
  nativeSun: number | bigint;
  /** Per-contract bigint balance (or `Error` to simulate per-token RPC failure). */
  balances: Record<string, bigint | Error>;
}): { tw: object; getBalance: ReturnType<typeof vi.fn> } {
  const getBalance = vi.fn().mockResolvedValue(opts.nativeSun);
  const contract = vi.fn(async (_abi: unknown, addr: string) => {
    const v = opts.balances[addr];
    return {
      methods: {
        balanceOf: (_w: string) => ({
          call: async () => {
            if (v instanceof Error) throw v;
            // tronweb returns a BigNumber-like; .toString() yields decimal
            // digits — the rpc-client wraps via BigInt(result.toString()).
            return { toString: () => (v ?? 0n).toString() };
          },
        }),
      },
    };
  });
  const tw = {
    trx: { getBalance },
    contract,
  };
  return { tw, getBalance };
}

/** Build a fetch mock for DefiLlama with EVM + TRON keys. */
function makeMixedFetch(
  evmPrices: Record<string, number>,
  tronPrices: Record<string, number>,
): ReturnType<typeof vi.fn> {
  return vi.fn(async (url: string) => {
    const coins: Record<
      string,
      { price: number; symbol?: string; decimals?: number }
    > = {};
    for (const [key, price] of Object.entries(evmPrices)) {
      const [chain, addr] = key.split(":");
      coins[`${chain}:${addr!.toLowerCase()}`] = { price };
    }
    for (const [addr, price] of Object.entries(tronPrices)) {
      coins[`tron:${addr}`] = { price };
    }
    const matched: Record<string, { price: number }> = {};
    for (const [k, v] of Object.entries(coins)) {
      if (url.includes(k)) matched[k] = v;
    }
    return { ok: true, json: async () => ({ coins: matched }) };
  });
}

beforeEach(() => {
  accountStoreState.paired = [];
  demoState.isDemo = false;
  demoState.tronPersona = null;
  for (const id of [1, 42161, 137, 8453, 10] as ChainId[]) {
    evmState[id] = { nativeBalance: 0n, erc20: [] };
  }
  _resetPriceCacheForTesting();
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
  void _resetRegistryForTesting;
});

async function callTool(args: Record<string, unknown>): Promise<ToolHandlerResult> {
  const tool = getRegisteredTool("get_portfolio_summary");
  if (!tool) throw new Error("get_portfolio_summary not registered");
  return tool.handler(args);
}

describe("get_portfolio_summary TRON leg (Phase 17 Plan 17-04 TRON-READ-04)", () => {
  it("Test 1 — real-mode address resolution — paired TRON record routes fan-out to that address", async () => {
    accountStoreState.paired = [
      { chain: "tron", address: FIXTURE_PAIRED_TRON_ADDR },
    ];
    const { tw, getBalance } = makeStubTronWeb({
      nativeSun: 1_500_000, // 1.5 TRX
      balances: { [USDT_TRC20]: 2_000_000n }, // 2 USDT
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.spyOn(_tronRegistry, "getTronWeb").mockReturnValue(tw as any);
    vi.stubGlobal("fetch", makeMixedFetch({}, { [WTRX]: 0.357, [USDT_TRC20]: 1.0 }));

    const result = await callTool({ wallet: EVM_WALLET });
    expect(result.isError).toBeUndefined();
    const out = result.structuredContent as {
      perChain: Record<string, { chain: string; totalUsd: string; fungibleBalances: unknown[] }>;
      chainErrors: Array<{ chain: string; reason: string }>;
    };
    expect(out.perChain.tron).toBeDefined();
    expect(out.perChain.tron?.chain).toBe("tron");
    // getBalance called against the PAIRED address.
    expect(getBalance).toHaveBeenCalledWith(FIXTURE_PAIRED_TRON_ADDR);
  });

  it("Test 2 — demo-mode FALLBACK — no paired record + isDemoMode=true + active TRON persona → leg uses persona address", async () => {
    accountStoreState.paired = [];
    demoState.isDemo = true;
    demoState.tronPersona = {
      slug: "tron-whale",
      tronAddress: FIXTURE_PERSONA_TRON_ADDR,
    };
    const { tw, getBalance } = makeStubTronWeb({
      nativeSun: 2_000_000, // 2 TRX
      balances: {},
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.spyOn(_tronRegistry, "getTronWeb").mockReturnValue(tw as any);
    vi.stubGlobal("fetch", makeMixedFetch({}, { [WTRX]: 0.357 }));

    const result = await callTool({ wallet: EVM_WALLET });
    const out = result.structuredContent as {
      perChain: Record<string, { chain: string } | undefined>;
    };
    expect(out.perChain.tron).toBeDefined();
    expect(out.perChain.tron?.chain).toBe("tron");
    expect(getBalance).toHaveBeenCalledWith(FIXTURE_PERSONA_TRON_ADDR);
  });

  it("Test 3 — silent skip — no paired record AND not in demo mode → no TRON leg, no chainErrors entry", async () => {
    accountStoreState.paired = [];
    demoState.isDemo = false;
    vi.stubGlobal("fetch", makeMixedFetch({}, {}));

    const result = await callTool({ wallet: EVM_WALLET });
    const out = result.structuredContent as {
      perChain: Record<string, unknown>;
      chainErrors: Array<{ chain: string; reason: string }>;
    };
    expect(out.perChain.tron).toBeUndefined();
    expect(out.chainErrors.find((e) => e.chain === "tron")).toBeUndefined();
  });

  it("Test 4 — real-mode preference — paired record AND demo persona BOTH present → paired wins", async () => {
    accountStoreState.paired = [
      { chain: "tron", address: FIXTURE_PAIRED_TRON_ADDR },
    ];
    demoState.isDemo = true;
    demoState.tronPersona = {
      slug: "tron-whale",
      tronAddress: FIXTURE_PERSONA_TRON_ADDR,
    };
    const { tw, getBalance } = makeStubTronWeb({
      nativeSun: 1_000_000,
      balances: {},
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.spyOn(_tronRegistry, "getTronWeb").mockReturnValue(tw as any);
    vi.stubGlobal("fetch", makeMixedFetch({}, { [WTRX]: 0.357 }));

    await callTool({ wallet: EVM_WALLET });
    expect(getBalance).toHaveBeenCalledWith(FIXTURE_PAIRED_TRON_ADDR);
    expect(getBalance).not.toHaveBeenCalledWith(FIXTURE_PERSONA_TRON_ADDR);
  });

  it("Test 5 — includeTron=false suppresses TRON leg even with paired record present", async () => {
    accountStoreState.paired = [
      { chain: "tron", address: FIXTURE_PAIRED_TRON_ADDR },
    ];
    const { tw, getBalance } = makeStubTronWeb({
      nativeSun: 1_000_000,
      balances: {},
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.spyOn(_tronRegistry, "getTronWeb").mockReturnValue(tw as any);
    vi.stubGlobal("fetch", makeMixedFetch({}, { [WTRX]: 0.357 }));

    const result = await callTool({ wallet: EVM_WALLET, includeTron: false });
    const out = result.structuredContent as { perChain: Record<string, unknown> };
    expect(out.perChain.tron).toBeUndefined();
    // TRON RPC was never touched.
    expect(getBalance).not.toHaveBeenCalled();
  });

  it("Test 6 — per-row chain='tron' discriminator on nativeBalance + each fungibleBalances row", async () => {
    accountStoreState.paired = [
      { chain: "tron", address: FIXTURE_PAIRED_TRON_ADDR },
    ];
    const { tw } = makeStubTronWeb({
      nativeSun: 1_000_000,
      balances: { [USDT_TRC20]: 5_000_000n },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.spyOn(_tronRegistry, "getTronWeb").mockReturnValue(tw as any);
    vi.stubGlobal("fetch", makeMixedFetch({}, { [WTRX]: 0.357, [USDT_TRC20]: 1.0 }));

    const result = await callTool({ wallet: EVM_WALLET });
    const out = result.structuredContent as {
      perChain: Record<
        string,
        {
          chain: string;
          nativeBalance: { chain: string };
          fungibleBalances: Array<{ chain: string; tokenAddress: string }>;
        }
      >;
    };
    const tronPortfolio = out.perChain.tron!;
    expect(tronPortfolio.chain).toBe("tron");
    expect(tronPortfolio.nativeBalance.chain).toBe("tron");
    for (const row of tronPortfolio.fungibleBalances) {
      expect(row.chain).toBe("tron");
    }
  });

  it("Test 7 — NATIVE_PRICING_PROXY.tron = WTRX — DefiLlama keyed as `tron:TNUC...FR` for native TRX", async () => {
    accountStoreState.paired = [
      { chain: "tron", address: FIXTURE_PAIRED_TRON_ADDR },
    ];
    const { tw } = makeStubTronWeb({ nativeSun: 1_000_000, balances: {} });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.spyOn(_tronRegistry, "getTronWeb").mockReturnValue(tw as any);
    const fetchStub = makeMixedFetch({}, { [WTRX]: 0.357 });
    vi.stubGlobal("fetch", fetchStub);

    await callTool({ wallet: EVM_WALLET });
    const tronCallUrl = fetchStub.mock.calls
      .map((c) => c[0] as string)
      .find((u) => u.includes("tron:"));
    expect(tronCallUrl).toBeDefined();
    expect(tronCallUrl).toMatch(new RegExp(`tron:${WTRX}`));
  });

  it("Test 8 — USDD decimals=18 REGRESSION ANCHOR: 1e18 raw balance must surface as '1' (NOT '1000000000000' default-to-6 corruption)", async () => {
    accountStoreState.paired = [
      { chain: "tron", address: FIXTURE_PAIRED_TRON_ADDR },
    ];
    const { tw } = makeStubTronWeb({
      nativeSun: 0,
      // 1 USDD = 1e18 raw — at 6 decimals would render as 1e12; at 18 → "1".
      balances: { [USDD_TRC20]: 1_000_000_000_000_000_000n },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.spyOn(_tronRegistry, "getTronWeb").mockReturnValue(tw as any);
    vi.stubGlobal("fetch", makeMixedFetch({}, { [WTRX]: 0.357, [USDD_TRC20]: 0.999 }));

    const result = await callTool({ wallet: EVM_WALLET });
    const out = result.structuredContent as {
      perChain: {
        tron?: {
          fungibleBalances: Array<{
            tokenAddress: string;
            symbol: string;
            decimals: number;
            balance: string;
          }>;
        };
      };
    };
    const usdd = out.perChain.tron!.fungibleBalances.find(
      (r) => r.tokenAddress === USDD_TRC20,
    );
    expect(usdd).toBeDefined();
    expect(usdd?.decimals).toBe(18);
    expect(usdd?.symbol).toBe("USDD");
    // Hard-coded literal — REGRESSION ANCHOR. Failure here means USDD got
    // default-to-6 treatment.
    expect(usdd?.balance).toBe("1");
  });

  it("Test 9 — per-token RPC failure preserves row with `error` field; leg still returns", async () => {
    accountStoreState.paired = [
      { chain: "tron", address: FIXTURE_PAIRED_TRON_ADDR },
    ];
    const { tw } = makeStubTronWeb({
      nativeSun: 1_000_000,
      balances: {
        [USDT_TRC20]: 1_000_000n,
        // USDC contract throws — verify it doesn't poison the leg.
        [USDC_TRC20]: new Error("contract call failed"),
      },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.spyOn(_tronRegistry, "getTronWeb").mockReturnValue(tw as any);
    vi.stubGlobal(
      "fetch",
      makeMixedFetch({}, { [WTRX]: 0.357, [USDT_TRC20]: 1.0 }),
    );

    const result = await callTool({ wallet: EVM_WALLET });
    const out = result.structuredContent as {
      perChain: {
        tron?: {
          fungibleBalances: Array<{
            tokenAddress: string;
            error?: string;
          }>;
        };
      };
    };
    // Leg returned despite the per-token failure.
    expect(out.perChain.tron).toBeDefined();
    // Failing row carries `error` field.
    const usdcRow = out.perChain.tron!.fungibleBalances.find(
      (r) => r.tokenAddress === USDC_TRC20,
    );
    expect(usdcRow).toBeDefined();
    expect(usdcRow?.error).toMatch(/contract call failed/);
    // USDT row still surfaced normally.
    const usdtRow = out.perChain.tron!.fungibleBalances.find(
      (r) => r.tokenAddress === USDT_TRC20,
    );
    expect(usdtRow).toBeDefined();
    expect(usdtRow?.error).toBeUndefined();
  });

  it("Test 10 — discriminated-union widening: TRON fungibleBalances rows carry base58check tokenAddress (NOT 0x-hex) + chain='tron'", async () => {
    accountStoreState.paired = [
      { chain: "tron", address: FIXTURE_PAIRED_TRON_ADDR },
    ];
    const { tw } = makeStubTronWeb({
      nativeSun: 0,
      balances: { [USDT_TRC20]: 1_000_000n },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.spyOn(_tronRegistry, "getTronWeb").mockReturnValue(tw as any);
    vi.stubGlobal(
      "fetch",
      makeMixedFetch({}, { [WTRX]: 0.357, [USDT_TRC20]: 1.0 }),
    );

    const result = await callTool({ wallet: EVM_WALLET });
    const out = result.structuredContent as {
      perChain: {
        tron?: {
          fungibleBalances: Array<{ chain: string; tokenAddress: string }>;
        };
      };
    };
    const row = out.perChain.tron!.fungibleBalances[0]!;
    expect(row.chain).toBe("tron");
    // TRON base58check is T-prefixed; NOT 0x-prefixed.
    expect(row.tokenAddress).toBe(USDT_TRC20);
    expect(row.tokenAddress.startsWith("T")).toBe(true);
    expect(row.tokenAddress.startsWith("0x")).toBe(false);
  });
});
