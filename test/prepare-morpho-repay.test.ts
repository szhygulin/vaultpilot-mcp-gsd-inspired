// prepare_morpho_repay tests — Phase 29 Plan 29-03 (MOR-04).
//
// MOST COMPLEX TEST FILE due to repay-max path:
//   T1: concrete happy path
//   T2: asset-match refusal
//   T3: REPAY-MAX HAPPY PATH — Fixture X byte-identity (mocked borrowShares =
//       1_000_000_000n; encoder receives (params, 0n, 1e9n, ONBEHALF, "0x"));
//       RECEIPT renders amount: max VERBATIM; CHECKS PERFORMED carries the
//       resolved-borrowShares value
//   T4: repay-max with no debt (borrowShares === 0n) → INVALID_INPUT
//   T5: MAX_UINT256 anti-pattern rejection (research § Pitfall 3)
//   T6: WC-session not paired
//   T7 (WR-03): repay-max with allowance < MAX_UINT256 → preFlightNote fires
//   T8 (WR-03): repay-max with allowance === MAX_UINT256 → NO preFlightNote
//   T9 (WR-03): structuredContent carries repayMaxAmountWeiNote on repay-max

import type { PublicClient } from "viem";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// WR-03: mock the chain client so we can inject controlled allowance reads
// per test. The default returns 0n (allowance unknown); per-test cases
// override via the readContractSpy. Mirror of test/get-lending-positions.test.ts
// chains/registry mock.
const { readContractSpy } = vi.hoisted(() => ({
  readContractSpy: vi.fn(),
}));

vi.mock("../src/chains/registry.js", async () => {
  const actual = await vi.importActual<typeof import("../src/chains/registry.js")>(
    "../src/chains/registry.js",
  );
  return {
    ...actual,
    getChainClient: () =>
      ({ readContract: readContractSpy }) as unknown as PublicClient,
  };
});

const { getStatusSpy, createHandleSpy } = vi.hoisted(() => ({
  getStatusSpy: vi.fn(),
  createHandleSpy: vi.fn<typeof import("../src/signing/handle-store.js").createHandle>(),
}));

vi.mock("../src/wallet/session-manager.js", async () => {
  const actual = await vi.importActual<typeof import("../src/wallet/session-manager.js")>(
    "../src/wallet/session-manager.js",
  );
  return {
    ...actual,
    getStatus: (...args: Parameters<typeof actual.getStatus>) => getStatusSpy(...args),
    pair: vi.fn(async () => { throw new Error("pair should not be called"); }),
    disconnect: vi.fn(async () => undefined),
  };
});

vi.mock("../src/signing/handle-store.js", async () => {
  const actual = await vi.importActual<typeof import("../src/signing/handle-store.js")>(
    "../src/signing/handle-store.js",
  );
  createHandleSpy.mockImplementation(actual.createHandle);
  return {
    ...actual,
    createHandle: (...args: Parameters<typeof actual.createHandle>) => createHandleSpy(...args),
  };
});

import { _morphoChains } from "../src/chains/morpho-blue.js";
import { getMorphoBlueAddress } from "../src/config/contracts.js";
import { _resetDemoModeForTesting } from "../src/config/env.js";
import { _resetActivePersonaForTesting } from "../src/demo/state.js";
import { MORPHO_BLUE_SELECTORS } from "../src/protocols/morpho-blue.js";
import {
  _peekHandleForTesting,
  _resetHandleStoreForTesting,
} from "../src/signing/handle-store.js";
import { getRegisteredTool, type ToolHandlerResult } from "../src/tools/index.js";

await import("../src/tools/register-all.js");

async function callTool(args: Record<string, unknown>): Promise<ToolHandlerResult> {
  const tool = getRegisteredTool("prepare_morpho_repay");
  if (!tool) throw new Error("prepare_morpho_repay not registered");
  return tool.handler({ chain: "ethereum", ...args });
}

const DEMO_KEY = "VAULTPILOT_DEMO";
let savedDemo: string | undefined;

const USDC = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48" as `0x${string}`;
const WSTETH = "0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0" as `0x${string}`;
const ORACLE = "0x48F7E36EB6B826B2dF4B2E630B62Cd25e89E40e2" as `0x${string}`;
const IRM = "0x870aC11D48B15DB9a138Cf899d20F13F79Ba00BC" as `0x${string}`;
const LLTV = 860000000000000000n;
const MARKET_ID =
  "0xb323495f7e4148be5643a4ea4a8221eef163e4bccfdedc2a6f4696baacbc86cc" as `0x${string}`;
const ONBEHALF = "0x000000000000000000000000000000000000dEaD" as `0x${string}`;
const PAIRED_STATUS = {
  paired: true as const,
  accounts: [ONBEHALF],
  activeAccount: ONBEHALF,
  address: ONBEHALF,
  chainId: 1,
  sessionTopicLast8: "deadbeef",
  accountsByChain: { 1: [ONBEHALF] } as Record<number, `0x${string}`[]>,
};

// Fixture X cross-link — repay(params, 0n, 1_000_000_000n, ONBEHALF, "0x").
const FIXTURE_X_FINGERPRINT =
  "0x223f830e5d6bd6f544bd80bfd7afe90441c0038a7259a415e3af96127a9182a0";
const MOCK_BORROW_SHARES = 1_000_000_000n;

const MAX_UINT256_DECIMAL =
  "115792089237316195423570985008687907853269984665640564039457584007913129639935";

const ORIGINAL_READ_MARKET_PARAMS = _morphoChains.readMarketParams;
const ORIGINAL_READ_POSITION = _morphoChains.readPosition;
const ORIGINAL_READ_MARKET = _morphoChains.readMarket;
const readMarketParamsSpy = vi.fn<typeof _morphoChains.readMarketParams>();
const readPositionSpy = vi.fn<typeof _morphoChains.readPosition>();
const readMarketSpy = vi.fn<typeof _morphoChains.readMarket>();
_morphoChains.readMarketParams = readMarketParamsSpy as unknown as typeof _morphoChains.readMarketParams;
_morphoChains.readPosition = readPositionSpy as unknown as typeof _morphoChains.readPosition;
_morphoChains.readMarket = readMarketSpy as unknown as typeof _morphoChains.readMarket;

afterAll(() => {
  _morphoChains.readMarketParams = ORIGINAL_READ_MARKET_PARAMS;
  _morphoChains.readPosition = ORIGINAL_READ_POSITION;
  _morphoChains.readMarket = ORIGINAL_READ_MARKET;
});

beforeEach(() => {
  getStatusSpy.mockReset();
  createHandleSpy.mockClear();
  readMarketParamsSpy.mockReset();
  readPositionSpy.mockReset();
  readMarketSpy.mockReset();
  // Default: any client.readContract call rejects → readAllowance catches
  // and returns null → no preFlightNote. Per-test cases (WR-03 T7-T9)
  // override with a controlled resolved value.
  readContractSpy.mockReset();
  readContractSpy.mockRejectedValue(new Error("readContract not configured for test"));
  _resetHandleStoreForTesting();
  savedDemo = process.env[DEMO_KEY];
  process.env[DEMO_KEY] = "false";
  _resetDemoModeForTesting();
  _resetActivePersonaForTesting();
});

afterEach(() => {
  if (savedDemo === undefined) delete process.env[DEMO_KEY];
  else process.env[DEMO_KEY] = savedDemo;
  _resetDemoModeForTesting();
  _resetActivePersonaForTesting();
});

const okParams = {
  loanToken: USDC,
  collateralToken: WSTETH,
  oracle: ORACLE,
  irm: IRM,
  lltv: LLTV,
};

describe("prepare_morpho_repay — T1: concrete amount happy path", () => {
  it("USDC repay 25 → selector === repay; encoder receives (params, 25e6, 0n, ...)", async () => {
    getStatusSpy.mockResolvedValueOnce(PAIRED_STATUS);
    readMarketParamsSpy.mockResolvedValueOnce(okParams);
    const result = await callTool({ marketId: MARKET_ID, asset: USDC, amount: "25" });
    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as { handle: string; amountWei: string };
    expect(sc.amountWei).toBe("25000000");
    const record = _peekHandleForTesting(sc.handle);
    if (!record) throw new Error("handle missing");
    expect(record.tx.to).toBe(getMorphoBlueAddress(1));
    expect(record.tx.data.slice(0, 10).toLowerCase()).toBe(MORPHO_BLUE_SELECTORS.repay);
  });
});

describe("prepare_morpho_repay — T2: asset-match refusal (asset !== loanToken)", () => {
  it("wstETH passed → INVALID_INPUT + hintTool", async () => {
    getStatusSpy.mockResolvedValueOnce(PAIRED_STATUS);
    readMarketParamsSpy.mockResolvedValueOnce(okParams);
    const result = await callTool({ marketId: MARKET_ID, asset: WSTETH, amount: "1" });
    expect(result.isError).toBe(true);
    const sc = result.structuredContent as { errorCode: string; hintTool: string };
    expect(sc.errorCode).toBe("INVALID_INPUT");
    expect(sc.hintTool).toBe("prepare_morpho_supply_collateral");
  });
});

describe("prepare_morpho_repay — T3: REPAY-MAX HAPPY PATH (Fixture X byte-identity)", () => {
  it("amount: max with mocked borrowShares = 1e9n → fingerprint matches Fixture X; RECEIPT renders amount: max VERBATIM; CHECKS PERFORMED carries the resolved borrowShares", async () => {
    getStatusSpy.mockResolvedValueOnce(PAIRED_STATUS);
    readMarketParamsSpy.mockResolvedValueOnce(okParams);
    readPositionSpy.mockResolvedValueOnce({
      supplyShares: 0n, borrowShares: MOCK_BORROW_SHARES, collateral: 1_000_000_000_000_000_000n,
    });
    readMarketSpy.mockResolvedValueOnce({
      totalSupplyAssets: 100_000_000n,
      totalSupplyShares: 1_000_000_000n,
      totalBorrowAssets: 50_000_000n,
      totalBorrowShares: 500_000_000n,
      lastUpdate: 0n,
      fee: 0n,
    });

    const result = await callTool({
      marketId: MARKET_ID, asset: USDC, amount: "max", onBehalf: ONBEHALF,
    });
    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as {
      handle: string;
      amount: string;
      payloadFingerprint: string;
      resolvedBorrowShares: string;
    };
    // The RECEIPT renders verbatim
    expect(sc.amount).toBe("max");
    // structuredContent surfaces the resolved value separately
    expect(sc.resolvedBorrowShares).toBe(MOCK_BORROW_SHARES.toString());
    // Fixture X byte-identity — proves the share-based encoding round-trips
    // through the prepare-tool layer
    expect(sc.payloadFingerprint).toBe(FIXTURE_X_FINGERPRINT);
    // RECEIPT contains amount: max VERBATIM (not the resolved hex)
    const text = (result.content as { type: string; text: string }[])[0]!.text;
    expect(text).toContain("amount:       max");
    expect(text).toContain("Repay-max resolved");
    expect(text).toContain(MOCK_BORROW_SHARES.toString());
  });
});

describe("prepare_morpho_repay — T4: repay-max with no debt", () => {
  it("borrowShares === 0n → INVALID_INPUT \"No outstanding borrow\"; handle NOT created", async () => {
    getStatusSpy.mockResolvedValueOnce(PAIRED_STATUS);
    readMarketParamsSpy.mockResolvedValueOnce(okParams);
    readPositionSpy.mockResolvedValueOnce({
      supplyShares: 0n, borrowShares: 0n, collateral: 0n,
    });
    readMarketSpy.mockResolvedValueOnce({
      totalSupplyAssets: 0n, totalSupplyShares: 0n,
      totalBorrowAssets: 0n, totalBorrowShares: 0n,
      lastUpdate: 0n, fee: 0n,
    });
    const result = await callTool({ marketId: MARKET_ID, asset: USDC, amount: "max" });
    expect(result.isError).toBe(true);
    const sc = result.structuredContent as { errorCode: string; message: string };
    expect(sc.errorCode).toBe("INVALID_INPUT");
    expect(sc.message).toMatch(/no outstanding borrow/i);
    expect(createHandleSpy).toHaveBeenCalledTimes(0);
  });
});

describe("prepare_morpho_repay — T5: MAX_UINT256 anti-pattern explicit rejection", () => {
  it("amount: MAX_UINT256.toString() → INVALID_INPUT naming the lowercase \"max\" sentinel", async () => {
    getStatusSpy.mockResolvedValueOnce(PAIRED_STATUS);
    // No RPC mocks needed — the MAX_UINT256 check fires BEFORE readMarketParams.
    const result = await callTool({
      marketId: MARKET_ID, asset: USDC, amount: MAX_UINT256_DECIMAL,
    });
    expect(result.isError).toBe(true);
    const sc = result.structuredContent as { errorCode: string; message: string };
    expect(sc.errorCode).toBe("INVALID_INPUT");
    expect(sc.message).toMatch(/MAX_UINT256/);
    expect(sc.message).toMatch(/max/);
    expect(createHandleSpy).toHaveBeenCalledTimes(0);
  });
});

describe("prepare_morpho_repay — T6: WC-session not paired", () => {
  it("→ WALLET_NOT_PAIRED", async () => {
    getStatusSpy.mockResolvedValueOnce(null);
    const result = await callTool({ marketId: MARKET_ID, asset: USDC, amount: "25" });
    expect(result.isError).toBe(true);
    const sc = result.structuredContent as { errorCode: string };
    expect(sc.errorCode).toBe("WALLET_NOT_PAIRED");
  });
});

// ---------------------------------------------------------------------------
// Phase 29 code-review WR-03 — repay-max approval gate uses MAX_UINT256.
//
// The repay-max branch encodes share-based repay (assets=0, shares=
// borrowShares); the on-chain safeTransferFrom pulls assetsRepaid resolved
// AT TX TIME after accrueInterest, NOT the stale toAssetsUp estimate. Any
// allowance short of MAX_UINT256 may revert when interest accrues between
// prepare time and tx time. The pre-flight note now fires whenever
// allowance < MAX_UINT256 on the repay-max path.
// ---------------------------------------------------------------------------

const MAX_UINT256_VALUE = (1n << 256n) - 1n;

describe("prepare_morpho_repay — T7 (WR-03): repay-max with allowance < MAX_UINT256 → preFlightNote fires", () => {
  it("allowance = 1e30 (very large but < MAX_UINT256) → preFlightNote emitted (MAX_UINT256 idiom hinted)", async () => {
    getStatusSpy.mockResolvedValueOnce(PAIRED_STATUS);
    readMarketParamsSpy.mockResolvedValueOnce(okParams);
    readPositionSpy.mockResolvedValueOnce({
      supplyShares: 0n,
      borrowShares: MOCK_BORROW_SHARES,
      collateral: 1_000_000_000_000_000_000n,
    });
    readMarketSpy.mockResolvedValueOnce({
      totalSupplyAssets: 100_000_000n,
      totalSupplyShares: 1_000_000_000n,
      totalBorrowAssets: 50_000_000n,
      totalBorrowShares: 500_000_000n,
      lastUpdate: 0n,
      fee: 0n,
    });
    // allowance = 1e30 (way above the stale toAssetsUp asset figure, but
    // strictly less than MAX_UINT256 — the repay-max gate fires regardless).
    readContractSpy.mockResolvedValueOnce(10n ** 30n);

    const result = await callTool({
      marketId: MARKET_ID,
      asset: USDC,
      amount: "max",
      onBehalf: ONBEHALF,
    });
    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as {
      preFlightNote?: string;
      repayMaxAmountWeiNote?: string;
    };
    expect(sc.preFlightNote).toBeDefined();
    expect(sc.preFlightNote).toMatch(/repay-max/);
    expect(sc.preFlightNote).toMatch(/MAX_UINT256/);
  });
});

describe("prepare_morpho_repay — T8 (WR-03): repay-max with allowance === MAX_UINT256 → NO preFlightNote", () => {
  it("allowance === MAX_UINT256 → preFlightNote is absent (canonical max-approval idiom satisfied)", async () => {
    getStatusSpy.mockResolvedValueOnce(PAIRED_STATUS);
    readMarketParamsSpy.mockResolvedValueOnce(okParams);
    readPositionSpy.mockResolvedValueOnce({
      supplyShares: 0n,
      borrowShares: MOCK_BORROW_SHARES,
      collateral: 1_000_000_000_000_000_000n,
    });
    readMarketSpy.mockResolvedValueOnce({
      totalSupplyAssets: 100_000_000n,
      totalSupplyShares: 1_000_000_000n,
      totalBorrowAssets: 50_000_000n,
      totalBorrowShares: 500_000_000n,
      lastUpdate: 0n,
      fee: 0n,
    });
    readContractSpy.mockResolvedValueOnce(MAX_UINT256_VALUE);

    const result = await callTool({
      marketId: MARKET_ID,
      asset: USDC,
      amount: "max",
      onBehalf: ONBEHALF,
    });
    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as { preFlightNote?: string };
    expect(sc.preFlightNote).toBeUndefined();
  });
});

describe("prepare_morpho_repay — T9 (WR-03): structuredContent carries repayMaxAmountWeiNote", () => {
  it("repay-max → structuredContent.repayMaxAmountWeiNote annotates the amountWei semantic", async () => {
    getStatusSpy.mockResolvedValueOnce(PAIRED_STATUS);
    readMarketParamsSpy.mockResolvedValueOnce(okParams);
    readPositionSpy.mockResolvedValueOnce({
      supplyShares: 0n,
      borrowShares: MOCK_BORROW_SHARES,
      collateral: 1_000_000_000_000_000_000n,
    });
    readMarketSpy.mockResolvedValueOnce({
      totalSupplyAssets: 100_000_000n,
      totalSupplyShares: 1_000_000_000n,
      totalBorrowAssets: 50_000_000n,
      totalBorrowShares: 500_000_000n,
      lastUpdate: 0n,
      fee: 0n,
    });
    // allowance read can fail — repayMaxAmountWeiNote is independent of the
    // allowance check, surfaces whenever the path is repay-max.

    const result = await callTool({
      marketId: MARKET_ID,
      asset: USDC,
      amount: "max",
      onBehalf: ONBEHALF,
    });
    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as {
      repayMaxAmountWeiNote?: string;
      resolvedBorrowShares?: string;
    };
    // Annotation explains amountWei is the toAssetsUp approval-threshold
    // estimate (NOT the encoded shares value; NOT the on-chain transfer).
    expect(sc.repayMaxAmountWeiNote).toBeDefined();
    expect(sc.repayMaxAmountWeiNote).toMatch(/amountWei/);
    expect(sc.repayMaxAmountWeiNote).toMatch(/toAssetsUp/);
    expect(sc.repayMaxAmountWeiNote).toMatch(/STALE/);
    expect(sc.repayMaxAmountWeiNote).toMatch(/resolvedBorrowShares/);
    expect(sc.resolvedBorrowShares).toBe(MOCK_BORROW_SHARES.toString());
  });

  it("concrete amount (NOT repay-max) → structuredContent.repayMaxAmountWeiNote is absent", async () => {
    getStatusSpy.mockResolvedValueOnce(PAIRED_STATUS);
    readMarketParamsSpy.mockResolvedValueOnce(okParams);
    const result = await callTool({ marketId: MARKET_ID, asset: USDC, amount: "25" });
    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as { repayMaxAmountWeiNote?: string };
    expect(sc.repayMaxAmountWeiNote).toBeUndefined();
  });
});
