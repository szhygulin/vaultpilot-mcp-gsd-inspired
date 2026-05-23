// Phase 29 Plan 29-03 — Morpho Blue lifecycle integration test.
//
// Exercises the 4-state state-machine across the 6 prepare_morpho_* tools:
//   State 1: supplyCollateral wstETH → wallet has collateral (Fixture Y anchor)
//   State 2: borrow USDC → wallet has debt (Fixture W anchor)
//   State 3: repay (amount: "max") → debt cleared (Fixture X anchor)
//   State 4: withdrawCollateral wstETH → wallet back to zero
//
// Asset-match refusal scenarios re-verified via the full pipeline (not just
// unit mocks):
//   - prepare_morpho_supply with wstETH → INVALID_INPUT + hintTool
//   - prepare_morpho_supply_collateral with USDC → INVALID_INPUT + hintTool
//   - prepare_morpho_repay with MAX_UINT256 → INVALID_INPUT (research § Pitfall 3)
//   - prepare_morpho_borrow against zero-collateral → INVALID_INPUT + hintTool
//
// Byte-identity discipline: Fixtures V/W/X/Y from Plan 29-01 are re-anchored
// through the full prepare-tool pipeline (proves byte-identity holds end-to-
// end). Persona variation (different onBehalf addresses) is covered by the
// asymmetric expectation: fingerprint changes IFF onBehalf changes, since
// onBehalf is encoded into tx.data.

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
import { _resetDemoModeForTesting } from "../src/config/env.js";
import { _resetActivePersonaForTesting } from "../src/demo/state.js";
import { _resetHandleStoreForTesting } from "../src/signing/handle-store.js";
import { getRegisteredTool, type ToolHandlerResult } from "../src/tools/index.js";

await import("../src/tools/register-all.js");

async function callTool(toolName: string, args: Record<string, unknown>): Promise<ToolHandlerResult> {
  const tool = getRegisteredTool(toolName);
  if (!tool) throw new Error(`${toolName} not registered`);
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
const RECEIVER = "0x000000000000000000000000000000000000bEEF" as `0x${string}`;
const PAIRED_STATUS = {
  paired: true as const,
  accounts: [ONBEHALF],
  activeAccount: ONBEHALF,
  address: ONBEHALF,
  chainId: 1,
  sessionTopicLast8: "deadbeef",
  accountsByChain: { 1: [ONBEHALF] } as Record<number, `0x${string}`[]>,
};

// Plan 29-01 fixture cross-links.
const FIXTURE_V = "0x0324553236967490622dc8f9c073290508cfeb4f82acc8082db04641a7b3b1b0";
const FIXTURE_W = "0x38edb209009c27860acd9f5dc705b1314875646de33c0384820a4b828d58a078";
const FIXTURE_X = "0x223f830e5d6bd6f544bd80bfd7afe90441c0038a7259a415e3af96127a9182a0";
const FIXTURE_Y = "0x95d629f91d33efb39048fc7f09ef24d4f7452c9a4ee88100f8cfc008ce4c0539";
const MOCK_BORROW_SHARES = 1_000_000_000n;

const MAX_UINT256_DECIMAL =
  "115792089237316195423570985008687907853269984665640564039457584007913129639935";

const okParams = {
  loanToken: USDC,
  collateralToken: WSTETH,
  oracle: ORACLE,
  irm: IRM,
  lltv: LLTV,
};

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

describe("Morpho Blue lifecycle — 4-state state-machine integration", () => {
  it("State 1: supplyCollateral wstETH 1.0 → Fixture Y byte-identity", async () => {
    getStatusSpy.mockResolvedValueOnce(PAIRED_STATUS);
    readMarketParamsSpy.mockResolvedValueOnce(okParams);
    const result = await callTool("prepare_morpho_supply_collateral", {
      marketId: MARKET_ID, asset: WSTETH, amount: "1", onBehalf: ONBEHALF,
    });
    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as { payloadFingerprint: string };
    expect(sc.payloadFingerprint).toBe(FIXTURE_Y);
  });

  it("State 2: borrow USDC 50 against 1e18 collateral → Fixture W byte-identity", async () => {
    getStatusSpy.mockResolvedValueOnce(PAIRED_STATUS);
    readMarketParamsSpy.mockResolvedValueOnce(okParams);
    readPositionSpy.mockResolvedValueOnce({
      supplyShares: 0n,
      borrowShares: 0n,
      collateral: 1_000_000_000_000_000_000n,
    });
    const result = await callTool("prepare_morpho_borrow", {
      marketId: MARKET_ID, asset: USDC, amount: "50",
      onBehalf: ONBEHALF, receiver: RECEIVER,
    });
    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as { payloadFingerprint: string };
    expect(sc.payloadFingerprint).toBe(FIXTURE_W);
  });

  it("State 3: repay max via mocked borrowShares = 1e9n → Fixture X byte-identity + RECEIPT renders amount: max VERBATIM", async () => {
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
    const result = await callTool("prepare_morpho_repay", {
      marketId: MARKET_ID, asset: USDC, amount: "max", onBehalf: ONBEHALF,
    });
    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as {
      payloadFingerprint: string;
      amount: string;
      resolvedBorrowShares: string;
    };
    // Fixture X byte-identity through the prepare-tool pipeline
    expect(sc.payloadFingerprint).toBe(FIXTURE_X);
    // RECEIPT discipline — amount: max VERBATIM (NOT the resolved shares)
    expect(sc.amount).toBe("max");
    expect(sc.resolvedBorrowShares).toBe(MOCK_BORROW_SHARES.toString());
    const text = (result.content as { type: string; text: string }[])[0]!.text;
    expect(text).toContain("amount:       max");
    expect(text).toContain("Repay-max resolved");
  });

  it("State 4: withdrawCollateral wstETH 1.0 → wallet back to zero", async () => {
    getStatusSpy.mockResolvedValueOnce(PAIRED_STATUS);
    readMarketParamsSpy.mockResolvedValueOnce(okParams);
    const result = await callTool("prepare_morpho_withdraw_collateral", {
      marketId: MARKET_ID, asset: WSTETH, amount: "1", onBehalf: ONBEHALF,
    });
    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as { handle: string; amountWei: string };
    expect(sc.amountWei).toBe("1000000000000000000");
  });
});

describe("Morpho Blue lifecycle — asset-match gate refusals re-verified via full pipeline", () => {
  it("prepare_morpho_supply called with wstETH (collateralToken) → INVALID_INPUT + hintTool: prepare_morpho_supply_collateral", async () => {
    getStatusSpy.mockResolvedValueOnce(PAIRED_STATUS);
    readMarketParamsSpy.mockResolvedValueOnce(okParams);
    const result = await callTool("prepare_morpho_supply", {
      marketId: MARKET_ID, asset: WSTETH, amount: "1",
    });
    expect(result.isError).toBe(true);
    const sc = result.structuredContent as { errorCode: string; hintTool: string };
    expect(sc.errorCode).toBe("INVALID_INPUT");
    expect(sc.hintTool).toBe("prepare_morpho_supply_collateral");
  });

  it("prepare_morpho_supply_collateral called with USDC (loanToken) → INVALID_INPUT + hintTool: prepare_morpho_supply", async () => {
    getStatusSpy.mockResolvedValueOnce(PAIRED_STATUS);
    readMarketParamsSpy.mockResolvedValueOnce(okParams);
    const result = await callTool("prepare_morpho_supply_collateral", {
      marketId: MARKET_ID, asset: USDC, amount: "100",
    });
    expect(result.isError).toBe(true);
    const sc = result.structuredContent as { errorCode: string; hintTool: string };
    expect(sc.errorCode).toBe("INVALID_INPUT");
    expect(sc.hintTool).toBe("prepare_morpho_supply");
  });

  it("prepare_morpho_repay called with MAX_UINT256.toString() → INVALID_INPUT naming the lowercase \"max\" sentinel (research § Pitfall 3)", async () => {
    getStatusSpy.mockResolvedValueOnce(PAIRED_STATUS);
    const result = await callTool("prepare_morpho_repay", {
      marketId: MARKET_ID, asset: USDC, amount: MAX_UINT256_DECIMAL,
    });
    expect(result.isError).toBe(true);
    const sc = result.structuredContent as { errorCode: string; message: string };
    expect(sc.errorCode).toBe("INVALID_INPUT");
    expect(sc.message).toMatch(/MAX_UINT256/);
    expect(sc.message).toMatch(/max/);
  });

  it("prepare_morpho_borrow against zero-collateral → INVALID_INPUT + hintTool: prepare_morpho_supply_collateral", async () => {
    getStatusSpy.mockResolvedValueOnce(PAIRED_STATUS);
    readMarketParamsSpy.mockResolvedValueOnce(okParams);
    readPositionSpy.mockResolvedValueOnce({
      supplyShares: 0n, borrowShares: 0n, collateral: 0n,
    });
    const result = await callTool("prepare_morpho_borrow", {
      marketId: MARKET_ID, asset: USDC, amount: "50",
    });
    expect(result.isError).toBe(true);
    const sc = result.structuredContent as { errorCode: string; hintTool: string };
    expect(sc.errorCode).toBe("INVALID_INPUT");
    expect(sc.hintTool).toBe("prepare_morpho_supply_collateral");
  });
});

describe("Morpho Blue lifecycle — persona swap (Fixture V cross-link)", () => {
  it("Fixture V re-anchored: supply(USDC, 100e6) with ONBEHALF persona → fingerprint matches Plan 29-01 anchor", async () => {
    getStatusSpy.mockResolvedValueOnce(PAIRED_STATUS);
    readMarketParamsSpy.mockResolvedValueOnce(okParams);
    const result = await callTool("prepare_morpho_supply", {
      marketId: MARKET_ID, asset: USDC, amount: "100", onBehalf: ONBEHALF,
    });
    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as { payloadFingerprint: string };
    expect(sc.payloadFingerprint).toBe(FIXTURE_V);
  });

  it("Persona swap: same supply call with DIFFERENT onBehalf produces DIFFERENT fingerprint (onBehalf is in tx.data preimage)", async () => {
    const PERSONA_2 = "0x000000000000000000000000000000000000bEEF" as `0x${string}`;
    getStatusSpy.mockResolvedValueOnce({
      ...PAIRED_STATUS,
      accounts: [PERSONA_2],
      activeAccount: PERSONA_2,
      address: PERSONA_2,
      accountsByChain: { 1: [PERSONA_2] },
    });
    readMarketParamsSpy.mockResolvedValueOnce(okParams);
    const result = await callTool("prepare_morpho_supply", {
      marketId: MARKET_ID, asset: USDC, amount: "100", onBehalf: PERSONA_2,
    });
    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as { payloadFingerprint: string };
    // Different persona → different fingerprint (proves onBehalf is in the
    // cryptographic-binding preimage via tx.data; cross-persona byte-distinction
    // is the load-bearing invariant).
    expect(sc.payloadFingerprint).not.toBe(FIXTURE_V);
  });
});
