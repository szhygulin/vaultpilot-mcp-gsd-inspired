// prepare_morpho_withdraw_collateral tests — Phase 29 Plan 29-03 (MOR-03).
//
// Cases: T1 happy path (asset === collateralToken); T2 asset-match refusal
// (asset === loanToken → hintTool: prepare_morpho_withdraw); T3 intent-vs-
// reality; T4 "max" rejected (no canonical sentinel for collateral withdraw);
// T5 WC-session not paired.

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
  const tool = getRegisteredTool("prepare_morpho_withdraw_collateral");
  if (!tool) throw new Error("prepare_morpho_withdraw_collateral not registered");
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
const readMarketParamsSpy = vi.fn<typeof _morphoChains.readMarketParams>();
_morphoChains.readMarketParams = readMarketParamsSpy as unknown as typeof _morphoChains.readMarketParams;

afterAll(() => {
  _morphoChains.readMarketParams = ORIGINAL_READ_MARKET_PARAMS;
});

beforeEach(() => {
  getStatusSpy.mockReset();
  createHandleSpy.mockClear();
  readMarketParamsSpy.mockReset();
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

describe("prepare_morpho_withdraw_collateral — T1: happy path (asset === collateralToken)", () => {
  it("wstETH 0.5 → selector === withdrawCollateral; receiver defaults to onBehalf", async () => {
    getStatusSpy.mockResolvedValueOnce(PAIRED_STATUS);
    readMarketParamsSpy.mockResolvedValueOnce(okParams);
    const result = await callTool({ marketId: MARKET_ID, asset: WSTETH, amount: "0.5" });
    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as { handle: string; receiver: string; amountWei: string };
    expect(sc.receiver).toBe(ONBEHALF);
    expect(sc.amountWei).toBe("500000000000000000");
    const record = _peekHandleForTesting(sc.handle);
    if (!record) throw new Error("handle missing");
    expect(record.tx.to).toBe(getMorphoBlueAddress(1));
    expect(record.tx.data.slice(0, 10).toLowerCase()).toBe(MORPHO_BLUE_SELECTORS.withdrawCollateral);
  });
});

describe("prepare_morpho_withdraw_collateral — T2: asset-match refusal (loanToken → hintTool: withdraw)", () => {
  it("USDC passed → INVALID_INPUT + hintTool", async () => {
    getStatusSpy.mockResolvedValueOnce(PAIRED_STATUS);
    readMarketParamsSpy.mockResolvedValueOnce(okParams);
    const result = await callTool({ marketId: MARKET_ID, asset: USDC, amount: "100" });
    expect(result.isError).toBe(true);
    const sc = result.structuredContent as { errorCode: string; hintTool: string };
    expect(sc.errorCode).toBe("INVALID_INPUT");
    expect(sc.hintTool).toBe("prepare_morpho_withdraw");
  });
});

describe("prepare_morpho_withdraw_collateral — T3: intent-vs-reality refusal", () => {
  it("zero-address loanToken → INVALID_INPUT", async () => {
    getStatusSpy.mockResolvedValueOnce(PAIRED_STATUS);
    readMarketParamsSpy.mockResolvedValueOnce({
      loanToken: ZERO, collateralToken: ZERO,
      oracle: ZERO, irm: ZERO, lltv: 0n,
    });
    const result = await callTool({ marketId: MARKET_ID, asset: WSTETH, amount: "0.5" });
    expect(result.isError).toBe(true);
    const sc = result.structuredContent as { errorCode: string };
    expect(sc.errorCode).toBe("INVALID_INPUT");
  });
});

describe("prepare_morpho_withdraw_collateral — T4: \"max\" rejected", () => {
  it("amount: \"max\" → parseAmountStrict format rejection", async () => {
    getStatusSpy.mockResolvedValueOnce(PAIRED_STATUS);
    readMarketParamsSpy.mockResolvedValueOnce(okParams);
    const result = await callTool({ marketId: MARKET_ID, asset: WSTETH, amount: "max" });
    expect(result.isError).toBe(true);
    const sc = result.structuredContent as { errorCode: string };
    expect(sc.errorCode).toBe("INVALID_INPUT");
  });
});

describe("prepare_morpho_withdraw_collateral — T5: WC-session not paired", () => {
  it("→ WALLET_NOT_PAIRED", async () => {
    getStatusSpy.mockResolvedValueOnce(null);
    const result = await callTool({ marketId: MARKET_ID, asset: WSTETH, amount: "0.5" });
    expect(result.isError).toBe(true);
    const sc = result.structuredContent as { errorCode: string };
    expect(sc.errorCode).toBe("WALLET_NOT_PAIRED");
  });
});
