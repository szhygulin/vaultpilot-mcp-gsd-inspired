// prepare_morpho_withdraw tests — Phase 29 Plan 29-03 (MOR-03).
//
// Cases: T1 concrete-amount happy path; T2 asset-match refusal (collateralToken →
// hintTool: prepare_morpho_withdraw_collateral); T3 "max" path via toAssetsDown;
// T4 "max" with zero supplyShares → INVALID_INPUT; T5 intent-vs-reality refusal;
// T6 WC-session not paired.

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
  const tool = getRegisteredTool("prepare_morpho_withdraw");
  if (!tool) throw new Error("prepare_morpho_withdraw not registered");
  return tool.handler({ chain: "ethereum", ...args });
}

const DEMO_KEY = "VAULTPILOT_DEMO";
let savedDemo: string | undefined;

const USDC = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48" as `0x${string}`;
const WSTETH = "0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0" as `0x${string}`;
const ORACLE = "0x48F7E36EB6B826B2dF4B2E630B62Cd25e89E40e2" as `0x${string}`;
const IRM = "0x870aC11D48B15DB9a138Cf899d20F13F79Ba00BC" as `0x${string}`;
const LLTV = 860000000000000000n;
const ZERO = "0x0000000000000000000000000000000000000000" as `0x${string}`;
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

const okParams = {
  loanToken: USDC,
  collateralToken: WSTETH,
  oracle: ORACLE,
  irm: IRM,
  lltv: LLTV,
};

describe("prepare_morpho_withdraw — T1: concrete amount happy path", () => {
  it("USDC withdraw 50 — handle created; selector === withdraw", async () => {
    getStatusSpy.mockResolvedValueOnce(PAIRED_STATUS);
    readMarketParamsSpy.mockResolvedValueOnce(okParams);

    const result = await callTool({ marketId: MARKET_ID, asset: USDC, amount: "50" });
    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as {
      handle: string; amountWei: string; receiver: string; onBehalf: string;
    };
    expect(sc.amountWei).toBe("50000000");
    expect(sc.receiver).toBe(ONBEHALF); // defaults to onBehalf
    const record = _peekHandleForTesting(sc.handle);
    if (!record) throw new Error("handle missing");
    expect(record.tx.to).toBe(getMorphoBlueAddress(1));
    expect(record.tx.data.slice(0, 10).toLowerCase()).toBe(MORPHO_BLUE_SELECTORS.withdraw);
  });
});

describe("prepare_morpho_withdraw — T2: asset-match refusal (collateralToken → hintTool: withdraw_collateral)", () => {
  it("wstETH passed → INVALID_INPUT + hintTool", async () => {
    getStatusSpy.mockResolvedValueOnce(PAIRED_STATUS);
    readMarketParamsSpy.mockResolvedValueOnce(okParams);
    const result = await callTool({ marketId: MARKET_ID, asset: WSTETH, amount: "1" });
    expect(result.isError).toBe(true);
    const sc = result.structuredContent as { errorCode: string; hintTool: string };
    expect(sc.errorCode).toBe("INVALID_INPUT");
    expect(sc.hintTool).toBe("prepare_morpho_withdraw_collateral");
  });
});

describe("prepare_morpho_withdraw — T3: \"max\" path via toAssetsDown", () => {
  it("max → reads position+market, encodes resolved assets, RECEIPT renders amount: max VERBATIM", async () => {
    getStatusSpy.mockResolvedValueOnce(PAIRED_STATUS);
    readMarketParamsSpy.mockResolvedValueOnce(okParams);
    readPositionSpy.mockResolvedValueOnce({
      supplyShares: 1_000_000_000n,
      borrowShares: 0n,
      collateral: 0n,
    });
    readMarketSpy.mockResolvedValueOnce({
      totalSupplyAssets: 100_000_000n,
      totalSupplyShares: 1_000_000_000n,
      totalBorrowAssets: 0n,
      totalBorrowShares: 0n,
      lastUpdate: 0n,
      fee: 0n,
    });

    const result = await callTool({ marketId: MARKET_ID, asset: USDC, amount: "max" });
    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as {
      amount: string;
      amountWei: string;
      resolvedMaxAssets: string;
    };
    // RECEIPT renders verbatim; structured carries the resolved value
    expect(sc.amount).toBe("max");
    expect(sc.resolvedMaxAssets).toBeDefined();
    expect(BigInt(sc.amountWei)).toBeGreaterThan(0n);
    const text = (result.content as { type: string; text: string }[])[0]!.text;
    expect(text).toContain("amount:       max");
    expect(text).toContain("Withdraw-max resolved");
  });
});

describe("prepare_morpho_withdraw — T4: \"max\" with zero supplyShares → INVALID_INPUT", () => {
  it("supplyShares === 0n → refusal; handle NOT created", async () => {
    getStatusSpy.mockResolvedValueOnce(PAIRED_STATUS);
    readMarketParamsSpy.mockResolvedValueOnce(okParams);
    readPositionSpy.mockResolvedValueOnce({
      supplyShares: 0n,
      borrowShares: 0n,
      collateral: 0n,
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
    expect(sc.message).toMatch(/no supply position/);
    expect(createHandleSpy).toHaveBeenCalledTimes(0);
  });
});

describe("prepare_morpho_withdraw — T5: intent-vs-reality refusal (zero-address loanToken)", () => {
  it("non-existent market → INVALID_INPUT \"does not exist\"", async () => {
    getStatusSpy.mockResolvedValueOnce(PAIRED_STATUS);
    readMarketParamsSpy.mockResolvedValueOnce({
      loanToken: ZERO, collateralToken: ZERO,
      oracle: ZERO, irm: ZERO, lltv: 0n,
    });
    const result = await callTool({ marketId: MARKET_ID, asset: USDC, amount: "10" });
    expect(result.isError).toBe(true);
    const sc = result.structuredContent as { errorCode: string; message: string };
    expect(sc.errorCode).toBe("INVALID_INPUT");
    expect(sc.message).toMatch(/does not exist/);
  });
});

describe("prepare_morpho_withdraw — T6: WC-session not paired", () => {
  it("→ WALLET_NOT_PAIRED", async () => {
    getStatusSpy.mockResolvedValueOnce(null);
    const result = await callTool({ marketId: MARKET_ID, asset: USDC, amount: "10" });
    expect(result.isError).toBe(true);
    const sc = result.structuredContent as { errorCode: string };
    expect(sc.errorCode).toBe("WALLET_NOT_PAIRED");
  });
});
