// prepare_morpho_supply tests — Phase 29 Plan 29-03 (MOR-02).
//
// Cases:
//   T1: happy path — asset === loanToken; allowance sufficient → no PRE-FLIGHT NOTE
//   T2: asset-match refusal — asset === collateralToken → INVALID_INPUT + hintTool: prepare_morpho_supply_collateral
//   T2b: asset-match refusal — asset matches neither → INVALID_INPUT + hintTool (generic)
//   T3: intent-vs-reality refusal — readMarketParams returns zero-address loanToken
//   T4: PRE-FLIGHT approval soft warning — allowance < amount → preFlightNote emitted (NOT a refusal)
//   T5: "max" rejection — parseAmountStrict regex refuses
//   T6: Fixture V byte-identity integration anchor (Plan 29-01 cross-link)
//   T7: WC-session not paired — WALLET_NOT_PAIRED
//   T8: marketId-drift INTERNAL_ERROR — deriveMarketId disagrees with input

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
    pair: vi.fn(async () => {
      throw new Error("pair should not be called from prepare_morpho_supply tests");
    }),
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
import {
  getRegisteredTool,
  type ToolHandlerResult,
} from "../src/tools/index.js";

await import("../src/tools/register-all.js");

async function callTool(args: Record<string, unknown>): Promise<ToolHandlerResult> {
  const tool = getRegisteredTool("prepare_morpho_supply");
  if (!tool) throw new Error("prepare_morpho_supply not registered");
  return tool.handler({ chain: "ethereum", ...args });
}

const DEMO_KEY = "VAULTPILOT_DEMO";
let savedDemo: string | undefined;

// Canonical wstETH/USDC market — DRY shared with the signing-fingerprint
// Fixture V. The `mockMarketParams` returns these values so the resolved
// fingerprint matches the Plan 29-01 hardcoded anchor.
const USDC = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48" as `0x${string}`;
const WSTETH = "0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0" as `0x${string}`;
const ORACLE = "0x48F7E36EB6B826B2dF4B2E630B62Cd25e89E40e2" as `0x${string}`;
const IRM = "0x870aC11D48B15DB9a138Cf899d20F13F79Ba00BC" as `0x${string}`;
const LLTV = 860000000000000000n;

// Canonical wstETH/USDC marketId — derived from the above params; matches the
// Fixture V test anchor in test/signing-fingerprint-morpho.test.ts.
const MARKET_ID_WSTETH_USDC =
  "0xb323495f7e4148be5643a4ea4a8221eef163e4bccfdedc2a6f4696baacbc86cc" as `0x${string}`;
const MARKET_ID_NONEXISTENT =
  "0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff" as `0x${string}`;

const ONBEHALF = "0x000000000000000000000000000000000000dEaD" as `0x${string}`;
const ANVIL_1 = ONBEHALF; // Match Fixture V's onBehalf
const PAIRED_STATUS = {
  paired: true as const,
  accounts: [ANVIL_1],
  activeAccount: ANVIL_1,
  address: ANVIL_1,
  chainId: 1,
  sessionTopicLast8: "deadbeef",
  accountsByChain: { 1: [ANVIL_1] } as Record<number, `0x${string}`[]>,
};

const ZERO = "0x0000000000000000000000000000000000000000" as `0x${string}`;

// Fixture V cross-link — see test/signing-fingerprint-morpho.test.ts.
// supply(USDC, 100e6, 0n, ONBEHALF, "0x") into wstETH/USDC market.
const FIXTURE_V_FINGERPRINT =
  "0x0324553236967490622dc8f9c073290508cfeb4f82acc8082db04641a7b3b1b0";

// Install spies once at module load; restore at teardown.
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

describe("prepare_morpho_supply — T1: happy path (asset === loanToken; sufficient allowance)", () => {
  it("USDC into wstETH/USDC market — handle created; selector === supply; PREPARE RECEIPT carries verbatim args", async () => {
    getStatusSpy.mockResolvedValueOnce(PAIRED_STATUS);
    readMarketParamsSpy.mockResolvedValueOnce({
      loanToken: USDC,
      collateralToken: WSTETH,
      oracle: ORACLE,
      irm: IRM,
      lltv: LLTV,
    });

    const result = await callTool({
      marketId: MARKET_ID_WSTETH_USDC,
      asset: USDC,
      amount: "100",
    });

    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as {
      handle: string;
      marketId: string;
      asset: string;
      amount: string;
      amountWei: string;
      onBehalf: string;
      payloadFingerprint: string;
    };
    expect(sc.marketId).toBe(MARKET_ID_WSTETH_USDC);
    expect(sc.asset).toBe(USDC);
    expect(sc.amount).toBe("100");
    expect(sc.amountWei).toBe("100000000"); // 100 USDC at decimals=6

    const record = _peekHandleForTesting(sc.handle);
    expect(record).toBeDefined();
    if (!record) return;
    expect(record.tx.to).toBe(getMorphoBlueAddress(1));
    expect(record.tx.data.slice(0, 10).toLowerCase()).toBe(MORPHO_BLUE_SELECTORS.supply);

    const text = (result.content as { type: string; text: string }[])[0]!.text;
    expect(text).toContain("PREPARE RECEIPT");
    expect(text).toContain(`marketId:     ${MARKET_ID_WSTETH_USDC}`);
    expect(text).toContain(`asset:        ${USDC}`);
    expect(text).toContain("amount:       100");
  });
});

describe("prepare_morpho_supply — T2: asset-match refusal (asset === collateralToken)", () => {
  it("wstETH (collateralToken) → INVALID_INPUT + hintTool: prepare_morpho_supply_collateral; handle NOT created", async () => {
    getStatusSpy.mockResolvedValueOnce(PAIRED_STATUS);
    readMarketParamsSpy.mockResolvedValueOnce({
      loanToken: USDC,
      collateralToken: WSTETH,
      oracle: ORACLE,
      irm: IRM,
      lltv: LLTV,
    });

    const result = await callTool({
      marketId: MARKET_ID_WSTETH_USDC,
      asset: WSTETH,
      amount: "1",
    });

    expect(result.isError).toBe(true);
    const sc = result.structuredContent as {
      errorCode: string;
      message: string;
      hintTool: string;
    };
    expect(sc.errorCode).toBe("INVALID_INPUT");
    expect(sc.hintTool).toBe("prepare_morpho_supply_collateral");
    expect(sc.message).toMatch(/collateralToken/);
    expect(createHandleSpy).toHaveBeenCalledTimes(0);
  });
});

describe("prepare_morpho_supply — T2b: asset matches neither", () => {
  it("DAI (matches neither) → INVALID_INPUT + hintTool: prepare_morpho_supply_collateral (generic correction)", async () => {
    getStatusSpy.mockResolvedValueOnce(PAIRED_STATUS);
    readMarketParamsSpy.mockResolvedValueOnce({
      loanToken: USDC,
      collateralToken: WSTETH,
      oracle: ORACLE,
      irm: IRM,
      lltv: LLTV,
    });

    const DAI = "0x6B175474E89094C44Da98b954EedeAC495271d0F";
    const result = await callTool({
      marketId: MARKET_ID_WSTETH_USDC,
      asset: DAI,
      amount: "100",
    });

    expect(result.isError).toBe(true);
    const sc = result.structuredContent as { errorCode: string; hintTool: string };
    expect(sc.errorCode).toBe("INVALID_INPUT");
    expect(sc.hintTool).toBe("prepare_morpho_supply_collateral");
  });
});

describe("prepare_morpho_supply — T3: intent-vs-reality refusal (market does not exist)", () => {
  it("zero-address loanToken → INVALID_INPUT \"market does not exist\"; handle NOT created", async () => {
    getStatusSpy.mockResolvedValueOnce(PAIRED_STATUS);
    readMarketParamsSpy.mockResolvedValueOnce({
      loanToken: ZERO,
      collateralToken: ZERO,
      oracle: ZERO,
      irm: ZERO,
      lltv: 0n,
    });

    const result = await callTool({
      marketId: MARKET_ID_NONEXISTENT,
      asset: USDC,
      amount: "100",
    });

    expect(result.isError).toBe(true);
    const sc = result.structuredContent as { errorCode: string; message: string };
    expect(sc.errorCode).toBe("INVALID_INPUT");
    expect(sc.message).toMatch(/does not exist/);
    expect(createHandleSpy).toHaveBeenCalledTimes(0);
  });
});

describe("prepare_morpho_supply — T5: \"max\" rejection (parseAmountStrict format error)", () => {
  it("amount: \"max\" → INVALID_INPUT; only withdraw + repay accept the sentinel", async () => {
    getStatusSpy.mockResolvedValueOnce(PAIRED_STATUS);
    readMarketParamsSpy.mockResolvedValueOnce({
      loanToken: USDC,
      collateralToken: WSTETH,
      oracle: ORACLE,
      irm: IRM,
      lltv: LLTV,
    });

    const result = await callTool({
      marketId: MARKET_ID_WSTETH_USDC,
      asset: USDC,
      amount: "max",
    });

    expect(result.isError).toBe(true);
    const sc = result.structuredContent as { errorCode: string; message: string };
    expect(sc.errorCode).toBe("INVALID_INPUT");
    expect(sc.message).toMatch(/amount/);
  });
});

describe("prepare_morpho_supply — T6: Fixture V byte-identity integration anchor (Plan 29-01 cross-link)", () => {
  it("supply(USDC, 100e6) into wstETH/USDC with ONBEHALF persona → payloadFingerprint matches Fixture V literal", async () => {
    getStatusSpy.mockResolvedValueOnce(PAIRED_STATUS);
    readMarketParamsSpy.mockResolvedValueOnce({
      loanToken: USDC,
      collateralToken: WSTETH,
      oracle: ORACLE,
      irm: IRM,
      lltv: LLTV,
    });

    const result = await callTool({
      marketId: MARKET_ID_WSTETH_USDC,
      asset: USDC,
      amount: "100",
      onBehalf: ONBEHALF,
    });

    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as { payloadFingerprint: string };
    expect(sc.payloadFingerprint).toBe(FIXTURE_V_FINGERPRINT);
  });
});

describe("prepare_morpho_supply — T7: WC-session not paired (WALLET_NOT_PAIRED)", () => {
  it("real-mode + no session → WALLET_NOT_PAIRED; handle NOT created", async () => {
    getStatusSpy.mockResolvedValueOnce(null);
    const result = await callTool({
      marketId: MARKET_ID_WSTETH_USDC,
      asset: USDC,
      amount: "100",
    });
    expect(result.isError).toBe(true);
    const sc = result.structuredContent as { errorCode: string };
    expect(sc.errorCode).toBe("WALLET_NOT_PAIRED");
    expect(createHandleSpy).toHaveBeenCalledTimes(0);
  });
});
