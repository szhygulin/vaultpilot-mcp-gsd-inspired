// prepare_morpho_borrow tests — Phase 29 Plan 29-03 (MOR-03 borrow leg).
//
// Cases: T1 happy path with sufficient collateral; T2 asset-match refusal;
// T3 collateral-present refusal (collateral === 0n); T4 intent-vs-reality;
// T5 Fixture W byte-identity; T6 WC-session not paired; T7 "max" rejected.

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
  const tool = getRegisteredTool("prepare_morpho_borrow");
  if (!tool) throw new Error("prepare_morpho_borrow not registered");
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

// Fixture W cross-link — borrow(USDC, 50e6, 0n, ONBEHALF, RECEIVER).
const FIXTURE_W_FINGERPRINT =
  "0x38edb209009c27860acd9f5dc705b1314875646de33c0384820a4b828d58a078";

const ORIGINAL_READ_MARKET_PARAMS = _morphoChains.readMarketParams;
const ORIGINAL_READ_POSITION = _morphoChains.readPosition;
const readMarketParamsSpy = vi.fn<typeof _morphoChains.readMarketParams>();
const readPositionSpy = vi.fn<typeof _morphoChains.readPosition>();
_morphoChains.readMarketParams = readMarketParamsSpy as unknown as typeof _morphoChains.readMarketParams;
_morphoChains.readPosition = readPositionSpy as unknown as typeof _morphoChains.readPosition;

afterAll(() => {
  _morphoChains.readMarketParams = ORIGINAL_READ_MARKET_PARAMS;
  _morphoChains.readPosition = ORIGINAL_READ_POSITION;
});

beforeEach(() => {
  getStatusSpy.mockReset();
  createHandleSpy.mockClear();
  readMarketParamsSpy.mockReset();
  readPositionSpy.mockReset();
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

describe("prepare_morpho_borrow — T1: happy path with sufficient collateral", () => {
  it("USDC borrow 50 against 1e18 collateral → handle created; selector === borrow", async () => {
    getStatusSpy.mockResolvedValueOnce(PAIRED_STATUS);
    readMarketParamsSpy.mockResolvedValueOnce(okParams);
    readPositionSpy.mockResolvedValueOnce({
      supplyShares: 0n, borrowShares: 0n, collateral: 1_000_000_000_000_000_000n,
    });

    const result = await callTool({ marketId: MARKET_ID, asset: USDC, amount: "50" });
    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as { handle: string; amountWei: string; receiver: string };
    expect(sc.amountWei).toBe("50000000");
    expect(sc.receiver).toBe(ONBEHALF);
    const record = _peekHandleForTesting(sc.handle);
    if (!record) throw new Error("handle missing");
    expect(record.tx.to).toBe(getMorphoBlueAddress(1));
    expect(record.tx.data.slice(0, 10).toLowerCase()).toBe(MORPHO_BLUE_SELECTORS.borrow);
  });
});

describe("prepare_morpho_borrow — T2: asset-match refusal (not loanToken)", () => {
  it("wstETH passed → INVALID_INPUT + hintTool: prepare_morpho_supply_collateral", async () => {
    getStatusSpy.mockResolvedValueOnce(PAIRED_STATUS);
    readMarketParamsSpy.mockResolvedValueOnce(okParams);
    const result = await callTool({ marketId: MARKET_ID, asset: WSTETH, amount: "1" });
    expect(result.isError).toBe(true);
    const sc = result.structuredContent as { errorCode: string; hintTool: string };
    expect(sc.errorCode).toBe("INVALID_INPUT");
    expect(sc.hintTool).toBe("prepare_morpho_supply_collateral");
  });
});

describe("prepare_morpho_borrow — T3: collateral-present refusal (collateral === 0n)", () => {
  it("no collateral → INVALID_INPUT + hintTool: prepare_morpho_supply_collateral; handle NOT created", async () => {
    getStatusSpy.mockResolvedValueOnce(PAIRED_STATUS);
    readMarketParamsSpy.mockResolvedValueOnce(okParams);
    readPositionSpy.mockResolvedValueOnce({
      supplyShares: 0n, borrowShares: 0n, collateral: 0n,
    });
    const result = await callTool({ marketId: MARKET_ID, asset: USDC, amount: "50" });
    expect(result.isError).toBe(true);
    const sc = result.structuredContent as { errorCode: string; hintTool: string; message: string };
    expect(sc.errorCode).toBe("INVALID_INPUT");
    expect(sc.hintTool).toBe("prepare_morpho_supply_collateral");
    expect(sc.message).toMatch(/no collateral/i);
    expect(createHandleSpy).toHaveBeenCalledTimes(0);
  });
});

describe("prepare_morpho_borrow — T4: intent-vs-reality refusal", () => {
  it("zero-address loanToken → INVALID_INPUT", async () => {
    getStatusSpy.mockResolvedValueOnce(PAIRED_STATUS);
    readMarketParamsSpy.mockResolvedValueOnce({
      loanToken: ZERO, collateralToken: ZERO,
      oracle: ZERO, irm: ZERO, lltv: 0n,
    });
    const result = await callTool({ marketId: MARKET_ID, asset: USDC, amount: "50" });
    expect(result.isError).toBe(true);
    const sc = result.structuredContent as { errorCode: string };
    expect(sc.errorCode).toBe("INVALID_INPUT");
  });
});

describe("prepare_morpho_borrow — T5: Fixture W byte-identity", () => {
  it("borrow(USDC, 50e6, ONBEHALF, RECEIVER) → fingerprint matches Fixture W", async () => {
    getStatusSpy.mockResolvedValueOnce(PAIRED_STATUS);
    readMarketParamsSpy.mockResolvedValueOnce(okParams);
    readPositionSpy.mockResolvedValueOnce({
      supplyShares: 0n, borrowShares: 0n, collateral: 1_000_000_000_000_000_000n,
    });
    const result = await callTool({
      marketId: MARKET_ID, asset: USDC, amount: "50",
      onBehalf: ONBEHALF, receiver: RECEIVER,
    });
    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as { payloadFingerprint: string };
    expect(sc.payloadFingerprint).toBe(FIXTURE_W_FINGERPRINT);
  });
});

describe("prepare_morpho_borrow — T6: WC-session not paired", () => {
  it("→ WALLET_NOT_PAIRED", async () => {
    getStatusSpy.mockResolvedValueOnce(null);
    const result = await callTool({ marketId: MARKET_ID, asset: USDC, amount: "50" });
    expect(result.isError).toBe(true);
    const sc = result.structuredContent as { errorCode: string };
    expect(sc.errorCode).toBe("WALLET_NOT_PAIRED");
  });
});

describe("prepare_morpho_borrow — T7: \"max\" rejected (no canonical sentinel for borrow)", () => {
  it("amount: \"max\" → parseAmountStrict format rejection", async () => {
    getStatusSpy.mockResolvedValueOnce(PAIRED_STATUS);
    readMarketParamsSpy.mockResolvedValueOnce(okParams);
    readPositionSpy.mockResolvedValueOnce({
      supplyShares: 0n, borrowShares: 0n, collateral: 1_000_000_000_000_000_000n,
    });
    const result = await callTool({ marketId: MARKET_ID, asset: USDC, amount: "max" });
    expect(result.isError).toBe(true);
    const sc = result.structuredContent as { errorCode: string };
    expect(sc.errorCode).toBe("INVALID_INPUT");
  });
});
