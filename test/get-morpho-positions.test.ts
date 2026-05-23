// test/get-morpho-positions.test.ts — Phase 29 Plan 29-02 (MOR-01).
//
// MCP tool integration tests. Mocks the per-chain registry + spies on
// `_morphoChains.scanTouchedMarkets / readPosition / readMarket /
// readMarketParams` so the real RPC plumbing stays out of the test process.
//
// Coverage (mapped to plan tests T1-T9):
//   T1: zero-position happy path (empty Set from scan → empty positions)
//   T2: single-market with known-market label (wstETH/USDC anchor from
//       Plan 29-01's curated registry — cross-link to test/signing-fingerprint-morpho.test.ts
//       Fixture Morpho-29-A market params)
//   T3: multi-market sorted descending by (supplyAssetsExpected + borrowAssetsExpected)
//   T4: unlabeled-market flag — isUnlabeled:true + ERC-20 metadata fallback
//   T5: rpcDegraded on scanTouchedMarkets failure (top-level)
//   T6: rpcDegraded on per-market read failure (per-position row)
//   T7: demo-mode persona routing — set_demo_wallet active routes wallet to
//       persona.address (mirror of Phase 28 get_lending_positions demo test)
//   T8: non-ethereum chain refusal → INVALID_INPUT with v2.3.x deferral hint
//   T9: lookbackWarn surface when lookback exceeds available chain history

import type { Address, Hex, PublicClient } from "viem";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let publicNodeFallback = false;
const latestBlock = 20_000_000n;

// Per-test readContract responses for the ERC-20 metadata fallback path. T4
// populates these to return non-default symbol + decimals; other tests don't
// touch the unlabeled-market path so the default sentinels are fine.
const erc20Responses: Map<string, { symbol: string; decimals: number }> = new Map();

vi.mock("../src/chains/registry.js", () => {
  return {
    getChainClient: () =>
      ({
        getBlockNumber: vi.fn(async () => latestBlock),
        readContract: vi.fn(async (call: { address: Address; functionName: string }) => {
          // ERC-20 metadata fallback path — unlabeled markets fan out per-token
          // symbol + decimals reads. Default sentinel (?, 18) unless the test
          // populated a response for this token address.
          const key = `${call.address.toLowerCase()}:${call.functionName}`;
          const populated = erc20Responses.get(call.address.toLowerCase());
          if (populated) {
            if (call.functionName === "symbol") return populated.symbol;
            if (call.functionName === "decimals") return populated.decimals;
          }
          throw new Error(`unmocked readContract: ${key}`);
        }),
        // getLogs is never called directly — scanTouchedMarkets is mocked via
        // _morphoChains spy. Stubbed for type-safety.
        getLogs: vi.fn(async () => []),
      }) as unknown as PublicClient,
    isPublicNodeFallback: () => publicNodeFallback,
    _resetChainRegistryForTesting: () => {},
    PUBLICNODE_RPC_URLS: { 1: "https://test.invalid" },
  };
});

import { _morphoChains } from "../src/chains/morpho-blue.js";
import {
  _resetActivePersonaForTesting,
  setActivePersona,
} from "../src/demo/state.js";
import { getRegisteredTool, type ToolHandlerResult } from "../src/tools/index.js";
import "../src/tools/register-all.js";

// NOT vitalik.eth — that's the `whale` demo persona; T7 needs the caller's
// WALLET to differ from the persona address to exercise the override branch.
const WALLET: Address = "0x1111111111111111111111111111111111111111";
// wstETH/USDC marketId (Plan 29-01 registry anchor — research § Topic 3).
// The literal lives in test/ only — the `grep -n "0xb323..." src/` guard
// keeps it out of source files (registry-only contract).
const WSTETH_USDC_MARKET_ID: Hex =
  "0xb323495f7e4148be5643a4ea4a8221eef163e4bccfdedc2a6f4696baacbc86cc";
const USDC: Address = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
const WSTETH: Address = "0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0";
const WSTETH_USDC_ORACLE: Address = "0x48F7E36EB6B826B2dF4B2E630B62Cd25e89E40e2";
const ADAPTIVE_IRM: Address = "0x870aC11D48B15DB9a138Cf899d20F13F79Ba00BC";
const LLTV_86: bigint = 860000000000000000n;

// USDT/wstETH marketId (Plan 29-01 registry entry — research § Topic 3).
const USDT_WSTETH_MARKET_ID: Hex =
  "0xe7e9694b754c4d4f7e21faf7223f6fa71abaeb10296a4c43a54a7977149687d2";
const USDT: Address = "0xdAC17F958D2ee523a2206206994597C13D831ec7";

// Unlabeled marketId (NOT in registry).
const UNLABELED_MARKET_ID: Hex =
  "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef";
const UNLABELED_LOAN_TOKEN: Address = "0x0000000000000000000000000000000000001111";
const UNLABELED_COLLATERAL_TOKEN: Address = "0x0000000000000000000000000000000000002222";

beforeEach(() => {
  publicNodeFallback = false;
  erc20Responses.clear();
  _resetActivePersonaForTesting();
});

afterEach(() => {
  vi.restoreAllMocks();
});

async function callTool(args: Record<string, unknown>): Promise<ToolHandlerResult> {
  const tool = getRegisteredTool("get_morpho_positions");
  if (!tool) throw new Error("get_morpho_positions not registered");
  return tool.handler(args);
}

describe("get_morpho_positions — T1 zero-position happy path", () => {
  it("returns empty positions array when scanTouchedMarkets returns empty Set", async () => {
    vi.spyOn(_morphoChains, "scanTouchedMarkets").mockResolvedValue(new Set());

    const result = await callTool({ wallet: WALLET });
    const sc = result.structuredContent as Record<string, unknown>;

    expect(sc.chain).toBe("ethereum");
    expect(sc.chainId).toBe(1);
    expect(sc.wallet).toBe(WALLET);
    expect(sc.positions).toEqual([]);
    expect(sc.marketsTouched).toBe(0);
    expect(sc.marketsActive).toBe(0);
    expect(sc.rpcDegraded).toBeUndefined();
  });
});

describe("get_morpho_positions — T2 single-market with known-market label (Fixture Morpho-29-A cross-link)", () => {
  it("returns 1 entry with marketLabel from registry + isUnlabeled:false + computed supplyAssetsExpected", async () => {
    // See Fixture Morpho-29-A cross-link in test/signing-fingerprint-morpho.test.ts
    // (same wstETH/USDC market params surface for byte-identity).
    vi.spyOn(_morphoChains, "scanTouchedMarkets").mockResolvedValue(
      new Set([WSTETH_USDC_MARKET_ID]),
    );
    vi.spyOn(_morphoChains, "readPosition").mockResolvedValue({
      supplyShares: 1_000_000_000n,
      borrowShares: 0n,
      collateral: 0n,
    });
    vi.spyOn(_morphoChains, "readMarket").mockResolvedValue({
      totalSupplyAssets: 1_000_000_000_000n,
      totalSupplyShares: 1_000_000_000n,
      totalBorrowAssets: 500_000_000_000n,
      totalBorrowShares: 500_000_000n,
      lastUpdate: 1700000000n,
      fee: 0n,
    });
    vi.spyOn(_morphoChains, "readMarketParams").mockResolvedValue({
      loanToken: USDC,
      collateralToken: WSTETH,
      oracle: WSTETH_USDC_ORACLE,
      irm: ADAPTIVE_IRM,
      lltv: LLTV_86,
    });

    const result = await callTool({ wallet: WALLET });
    const sc = result.structuredContent as Record<string, unknown>;
    const positions = sc.positions as Array<Record<string, unknown>>;

    expect(positions.length).toBe(1);
    expect(positions[0]?.marketId).toBe(WSTETH_USDC_MARKET_ID);
    // Registry label MUST surface — drift here = registry indexing regression.
    expect(positions[0]?.marketLabel).toBe("USDC/wstETH (86% LLTV)");
    expect(positions[0]?.isUnlabeled).toBe(false);
    // SharesMathLib: supplyShares=1e9, totalSupplyAssets=1e12, totalSupplyShares=1e9
    // → toAssetsDown = 999000999001n
    expect(positions[0]?.supplyAssetsExpected).toBe("999000999001");
    expect(positions[0]?.borrowShares).toBe("0");
    expect(positions[0]?.borrowAssetsExpected).toBe("0");
    expect(positions[0]?.collateral).toBe("0");
    expect(positions[0]?.lltv).toBe(LLTV_86.toString());
    expect(positions[0]?.displayValue).toMatch(/stale market state/);
    expect(sc.marketsTouched).toBe(1);
    expect(sc.marketsActive).toBe(1);
  });
});

describe("get_morpho_positions — T3 multi-market sorted desc by (supply + borrow) assets", () => {
  it("filters all-zero markets and sorts active positions by aggregate assets descending", async () => {
    const SMALL_MARKET = WSTETH_USDC_MARKET_ID;
    const LARGE_MARKET = USDT_WSTETH_MARKET_ID;
    const EMPTY_MARKET = UNLABELED_MARKET_ID;

    vi.spyOn(_morphoChains, "scanTouchedMarkets").mockResolvedValue(
      new Set([SMALL_MARKET, LARGE_MARKET, EMPTY_MARKET]),
    );

    vi.spyOn(_morphoChains, "readPosition").mockImplementation(
      async (_c, _m, id) => {
        if (id === SMALL_MARKET)
          return { supplyShares: 100_000_000n, borrowShares: 0n, collateral: 0n };
        if (id === LARGE_MARKET)
          return { supplyShares: 0n, borrowShares: 500_000_000n, collateral: 0n };
        // EMPTY_MARKET — all-zero position → filtered out
        return { supplyShares: 0n, borrowShares: 0n, collateral: 0n };
      },
    );
    vi.spyOn(_morphoChains, "readMarket").mockResolvedValue({
      totalSupplyAssets: 1_000_000_000_000n,
      totalSupplyShares: 1_000_000_000n,
      totalBorrowAssets: 1_000_000_000_000n,
      totalBorrowShares: 1_000_000_000n,
      lastUpdate: 1700000000n,
      fee: 0n,
    });
    vi.spyOn(_morphoChains, "readMarketParams").mockImplementation(async (_c, _m, id) => {
      if (id === SMALL_MARKET)
        return {
          loanToken: USDC,
          collateralToken: WSTETH,
          oracle: WSTETH_USDC_ORACLE,
          irm: ADAPTIVE_IRM,
          lltv: LLTV_86,
        };
      if (id === LARGE_MARKET)
        return {
          loanToken: USDT,
          collateralToken: WSTETH,
          oracle: WSTETH_USDC_ORACLE,
          irm: ADAPTIVE_IRM,
          lltv: LLTV_86,
        };
      // EMPTY_MARKET — return zero-shape; readPosition gates on supplyShares first.
      return {
        loanToken: USDC,
        collateralToken: WSTETH,
        oracle: WSTETH_USDC_ORACLE,
        irm: ADAPTIVE_IRM,
        lltv: LLTV_86,
      };
    });

    const result = await callTool({ wallet: WALLET });
    const sc = result.structuredContent as Record<string, unknown>;
    const positions = sc.positions as Array<Record<string, unknown>>;

    expect(positions.length).toBe(2);
    // Largest position first — LARGE_MARKET has borrowAssetsExpected ~500e6
    // vs SMALL_MARKET supplyAssetsExpected ~100e6.
    expect(positions[0]?.marketId).toBe(LARGE_MARKET);
    expect(positions[1]?.marketId).toBe(SMALL_MARKET);
    expect(sc.marketsTouched).toBe(3);
    expect(sc.marketsActive).toBe(2);
  });
});

describe("get_morpho_positions — T4 unlabeled-market flag (registry miss)", () => {
  it("marks isUnlabeled:true and falls back to ERC-20 metadata fetch for symbol + decimals", async () => {
    vi.spyOn(_morphoChains, "scanTouchedMarkets").mockResolvedValue(
      new Set([UNLABELED_MARKET_ID]),
    );
    vi.spyOn(_morphoChains, "readPosition").mockResolvedValue({
      supplyShares: 100_000_000n,
      borrowShares: 0n,
      collateral: 0n,
    });
    vi.spyOn(_morphoChains, "readMarket").mockResolvedValue({
      totalSupplyAssets: 1_000_000_000_000n,
      totalSupplyShares: 1_000_000_000n,
      totalBorrowAssets: 0n,
      totalBorrowShares: 0n,
      lastUpdate: 1700000000n,
      fee: 0n,
    });
    vi.spyOn(_morphoChains, "readMarketParams").mockResolvedValue({
      loanToken: UNLABELED_LOAN_TOKEN,
      collateralToken: UNLABELED_COLLATERAL_TOKEN,
      oracle: WSTETH_USDC_ORACLE,
      irm: ADAPTIVE_IRM,
      lltv: LLTV_86,
    });
    erc20Responses.set(UNLABELED_LOAN_TOKEN.toLowerCase(), {
      symbol: "MYSTERY",
      decimals: 6,
    });
    erc20Responses.set(UNLABELED_COLLATERAL_TOKEN.toLowerCase(), {
      symbol: "MYSTERY-COLL",
      decimals: 18,
    });

    const result = await callTool({ wallet: WALLET });
    const sc = result.structuredContent as Record<string, unknown>;
    const positions = sc.positions as Array<Record<string, unknown>>;

    expect(positions.length).toBe(1);
    expect(positions[0]?.isUnlabeled).toBe(true);
    expect(positions[0]?.marketLabel).toBe(null);
    const loanToken = positions[0]?.loanToken as { symbol: string; decimals: number };
    expect(loanToken.symbol).toBe("MYSTERY");
    expect(loanToken.decimals).toBe(6);
    const collateralToken = positions[0]?.collateralToken as {
      symbol: string;
      decimals: number;
    };
    expect(collateralToken.symbol).toBe("MYSTERY-COLL");
    expect(collateralToken.decimals).toBe(18);
  });
});

describe("get_morpho_positions — T5 rpcDegraded on scanTouchedMarkets failure (top-level)", () => {
  it("surfaces rpcDegraded:true + reason at top level when scanTouchedMarkets throws", async () => {
    vi.spyOn(_morphoChains, "scanTouchedMarkets").mockRejectedValue(
      new Error("rpc timed out"),
    );

    const result = await callTool({ wallet: WALLET });
    const sc = result.structuredContent as Record<string, unknown>;

    expect(sc.rpcDegraded).toBe(true);
    expect(sc.reason).toMatch(/rpc timed out/);
    expect(sc.positions).toEqual([]);
    expect(sc.marketsTouched).toBe(0);
  });
});

describe("get_morpho_positions — T6 rpcDegraded on per-market read failure", () => {
  it("surfaces a per-position rpcDegraded row when one market's reads throw", async () => {
    const GOOD_MARKET = WSTETH_USDC_MARKET_ID;
    const BAD_MARKET = USDT_WSTETH_MARKET_ID;

    vi.spyOn(_morphoChains, "scanTouchedMarkets").mockResolvedValue(
      new Set([GOOD_MARKET, BAD_MARKET]),
    );
    vi.spyOn(_morphoChains, "readPosition").mockImplementation(async (_c, _m, id) => {
      if (id === BAD_MARKET) throw new Error("per-market rpc died");
      return { supplyShares: 1_000_000_000n, borrowShares: 0n, collateral: 0n };
    });
    vi.spyOn(_morphoChains, "readMarket").mockResolvedValue({
      totalSupplyAssets: 1_000_000_000_000n,
      totalSupplyShares: 1_000_000_000n,
      totalBorrowAssets: 0n,
      totalBorrowShares: 0n,
      lastUpdate: 1700000000n,
      fee: 0n,
    });
    vi.spyOn(_morphoChains, "readMarketParams").mockResolvedValue({
      loanToken: USDC,
      collateralToken: WSTETH,
      oracle: WSTETH_USDC_ORACLE,
      irm: ADAPTIVE_IRM,
      lltv: LLTV_86,
    });

    const result = await callTool({ wallet: WALLET });
    const sc = result.structuredContent as Record<string, unknown>;
    const positions = sc.positions as Array<Record<string, unknown>>;

    // 1 active row + 1 degraded row.
    expect(positions.length).toBe(2);
    const goodRow = positions.find((p) => p.marketId === GOOD_MARKET);
    const badRow = positions.find((p) => p.marketId === BAD_MARKET);
    expect(goodRow?.isUnlabeled).toBe(false);
    expect(badRow?.rpcDegraded).toBe(true);
    expect(badRow?.reason).toMatch(/per-market rpc died/);
    expect(sc.rpcDegraded).toBe(true);
  });
});

describe("get_morpho_positions — T7 demo-mode persona routing", () => {
  it("routes wallet to persona.address when set_demo_wallet is active", async () => {
    const persona = setActivePersona("whale");
    const PERSONA_ADDRESS = persona.address;
    expect(PERSONA_ADDRESS).not.toBe(WALLET);

    const scanSpy = vi
      .spyOn(_morphoChains, "scanTouchedMarkets")
      .mockResolvedValue(new Set());

    const result = await callTool({ wallet: WALLET });
    const sc = result.structuredContent as Record<string, unknown>;

    // Persona override → the scan was called with persona.address, not WALLET.
    expect(scanSpy).toHaveBeenCalled();
    const firstCallWallet = scanSpy.mock.calls[0]?.[1];
    expect(firstCallWallet).toBe(PERSONA_ADDRESS);
    // Surfaced flag for downstream traceability.
    expect(sc.demoPersonaRouted).toBe("whale");
    expect(sc.wallet).toBe(PERSONA_ADDRESS);
  });
});

describe("get_morpho_positions — T8 non-ethereum chain refusal", () => {
  it("refuses chain:\"base\" with INVALID_INPUT + v2.3.x deferral hint", async () => {
    const result = await callTool({ wallet: WALLET, chain: "base" });

    expect(result.isError).toBe(true);
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc.errorCode).toBe("INVALID_INPUT");
    expect(result.content[0]?.text).toMatch(/chainId 1.*only/);
    expect(result.content[0]?.text).toMatch(/v2\.3\.x/);
  });

  it("refuses chain:\"polygon\" with INVALID_INPUT", async () => {
    const result = await callTool({ wallet: WALLET, chain: "polygon" });
    expect(result.isError).toBe(true);
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc.errorCode).toBe("INVALID_INPUT");
  });
});

describe("get_morpho_positions — T9 lookbackWarn surface", () => {
  it("surfaces lookbackWarn:true when lookback exceeds chain history", async () => {
    // The mock getChainClient returns latestBlock=20_000_000n; the default
    // lookback (1M) is less than this → lookbackWarn should NOT fire.
    // To trigger lookbackWarn, override the env to a value LARGER than
    // latestBlock (e.g. 30_000_000) — the tool clamps `fromBlock` to 0n and
    // flags the truncation.
    const original = process.env.VAULTPILOT_MORPHO_LOG_LOOKBACK;
    process.env.VAULTPILOT_MORPHO_LOG_LOOKBACK = "30000000";
    try {
      vi.spyOn(_morphoChains, "scanTouchedMarkets").mockResolvedValue(new Set());

      const result = await callTool({ wallet: WALLET });
      const sc = result.structuredContent as Record<string, unknown>;
      expect(sc.lookbackWarn).toBe(true);
      expect(sc.lookbackBlocks).toBe(30_000_000);
    } finally {
      if (original === undefined) delete process.env.VAULTPILOT_MORPHO_LOG_LOOKBACK;
      else process.env.VAULTPILOT_MORPHO_LOG_LOOKBACK = original;
    }
  });
});

describe("get_morpho_positions — input validation guards", () => {
  it("rejects missing wallet → INVALID_INPUT", async () => {
    const result = await callTool({});
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toMatch(/wallet/);
  });

  it("rejects malformed wallet (not 40-hex) → INVALID_INPUT", async () => {
    const result = await callTool({ wallet: "not-an-address" });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toMatch(/valid 0x-prefixed/);
  });

  it("accepts chain:\"ethereum\" explicitly as a no-op", async () => {
    vi.spyOn(_morphoChains, "scanTouchedMarkets").mockResolvedValue(new Set());
    const result = await callTool({ wallet: WALLET, chain: "ethereum" });
    expect(result.isError).toBeUndefined();
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc.chain).toBe("ethereum");
  });
});

describe("get_morpho_positions — public-node fallback rpcDegraded surface", () => {
  it("surfaces rpcDegraded:true when isPublicNodeFallback(1) is true", async () => {
    publicNodeFallback = true;
    vi.spyOn(_morphoChains, "scanTouchedMarkets").mockResolvedValue(new Set());

    const result = await callTool({ wallet: WALLET });
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc.rpcDegraded).toBe(true);
  });
});
