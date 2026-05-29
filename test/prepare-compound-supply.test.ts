// prepare_compound_supply tests — Phase 28 Plan 28-02 (CMP-03).
//
// 9 cases covering:
//   T1: collateral supply happy path (asset !== baseToken; intent gate cheap path)
//   T2: base-asset supply happy path WITH zero debt (lender position; intent gate runs but does NOT fire)
//   T3: intent-gate refusal — base-asset + outstanding debt → INVALID_INPUT + hintTool: prepare_compound_repay
//   T4: non-canonical Comet refusal (cheap pre-RPC gate)
//   T5: "max" rejection (supply does NOT accept the sentinel)
//   T6: parseAmountStrict format errors
//   T7: demo-mode refusal (WRONG_MODE — no persona)
//   T8: WC-session not paired (WALLET_NOT_PAIRED)
//   T9: Fixture R byte-identity integration anchor (cross-link to test/signing-fingerprint.test.ts)

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { getStatusSpy, createHandleSpy, deriveIntentSpy } = vi.hoisted(() => ({
  getStatusSpy: vi.fn(),
  createHandleSpy: vi.fn<typeof import("../src/signing/handle-store.js").createHandle>(),
  deriveIntentSpy: vi.fn(),
}));

vi.mock("../src/wallet/session-manager.js", async () => {
  const actual = await vi.importActual<typeof import("../src/wallet/session-manager.js")>(
    "../src/wallet/session-manager.js",
  );
  return {
    ...actual,
    getStatus: (...args: Parameters<typeof actual.getStatus>) => getStatusSpy(...args),
    pair: vi.fn(async () => {
      throw new Error("pair should not be called from prepare_compound_supply tests");
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

import { _compoundChains } from "../src/chains/compound-v3.js";
import { getCompoundCometAddress } from "../src/config/contracts.js";
import { COMPOUND_V3_SELECTORS } from "../src/protocols/compound-v3.js";
import { COMPOUND_SUPPLY_PREPARE_RECEIPT_TEMPLATE } from "../src/signing/blocks.js";
import {
  _peekHandleForTesting,
  _resetHandleStoreForTesting,
} from "../src/signing/handle-store.js";
import {
  getRegisteredTool,
  listRegisteredTools,
  type ToolHandlerResult,
} from "../src/tools/index.js";
import { _resetDemoModeForTesting } from "../src/config/env.js";
import {
  _resetActivePersonaForTesting,
  setActivePersona,
} from "../src/demo/state.js";

await import("../src/tools/register-all.js");

async function callTool(args: Record<string, unknown>): Promise<ToolHandlerResult> {
  const tool = getRegisteredTool("prepare_compound_supply");
  if (!tool) throw new Error("prepare_compound_supply not registered");
  // chain defaults to "ethereum"; comet defaults to cUSDCv3 if omitted.
  const merged = {
    chain: "ethereum",
    comet: getCompoundCometAddress(1, "USDC")!,
    ...args,
  };
  return tool.handler(merged);
}

const DEMO_KEY = "VAULTPILOT_DEMO";
let savedDemo: string | undefined;

const ANVIL_1 = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" as `0x${string}`;
const PAIRED_STATUS = {
  paired: true as const,
  accounts: [ANVIL_1],
  activeAccount: ANVIL_1,
  address: ANVIL_1,
  chainId: 1,
  sessionTopicLast8: "deadbeef",
  accountsByChain: { 1: [ANVIL_1] } as Record<number, `0x${string}`[]>,
};

const USDC_CHECKSUMMED = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
const WBTC_CHECKSUMMED = "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599";
const cUSDCv3 = getCompoundCometAddress(1, "USDC")!;

// Fixture R cross-link — see test/signing-fingerprint.test.ts (Phase 28 Plan
// 28-01 hardcoded anchor). Fixture R is `supply(USDC, 100e6)` on cUSDCv3 with
// chainId=1 and value=0. The prepare-tool integration test asserts the
// structuredContent.payloadFingerprint matches this literal byte-for-byte.
const FIXTURE_R_FINGERPRINT =
  "0x09410c3060d1da3b7434450f172e9951928c22b838193be3f7b9956a603dfa9d";
const FIXTURE_R_AMOUNT = "100";
const FIXTURE_R_AMOUNT_WEI = "100000000"; // 100 USDC, decimals=6

// Install a stable spy on _compoundChains.deriveIntent ONCE. Per-test
// behavior is controlled via `deriveIntentSpy.mockResolvedValueOnce(...)`
// (queued return) or `deriveIntentSpy.mockReset()` (clear queue). Avoids the
// vi.spyOn layering issue when re-installed every beforeEach. Restored in
// afterAll so sibling test files (e.g. prepare-compound-withdraw) see the
// canonical implementation.
const ORIGINAL_DERIVE_INTENT = _compoundChains.deriveIntent;
_compoundChains.deriveIntent = deriveIntentSpy as unknown as typeof _compoundChains.deriveIntent;

afterAll(() => {
  _compoundChains.deriveIntent = ORIGINAL_DERIVE_INTENT;
});

beforeEach(() => {
  getStatusSpy.mockReset();
  createHandleSpy.mockClear();
  deriveIntentSpy.mockReset();
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
  // NOTE: do NOT call vi.restoreAllMocks() here — that wipes the
  // createHandleSpy.mockImplementation wired by the module-level vi.mock
  // factory, causing subsequent createHandle calls to return undefined and
  // break handle-store lookups. The vi.spyOn(_compoundChains, "deriveIntent")
  // is reinstalled cleanly in beforeEach.
});

describe("prepare_compound_supply — T1: collateral supply happy path (asset !== baseToken)", () => {
  it("WBTC into cUSDCv3 — handle created; intent === 'supply-collateral'; selector === supply", async () => {
    getStatusSpy.mockResolvedValueOnce(PAIRED_STATUS);
    deriveIntentSpy.mockResolvedValueOnce("supply-collateral");

    const result = await callTool({
      asset: WBTC_CHECKSUMMED,
      amount: "0.5",
    });

    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as {
      handle: string;
      comet: string;
      asset: string;
      amount: string;
      intent: string;
      payloadFingerprint: string;
    };
    expect(sc.intent).toBe("supply-collateral");
    expect(sc.comet).toBe(cUSDCv3);
    expect(sc.asset).toBe(WBTC_CHECKSUMMED);
    expect(sc.amount).toBe("0.5");
    expect(sc.handle).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );

    // Stored tx — tx.to is the Comet; calldata starts with supply selector.
    const record = _peekHandleForTesting(sc.handle);
    expect(record).toBeDefined();
    if (!record) return;
    expect(record.tx.to).toBe(cUSDCv3);
    expect(record.tx.chainId).toBe(1);
    expect(record.tx.valueWei).toBe(0n);
    expect(record.tx.data.slice(0, 10).toLowerCase()).toBe(COMPOUND_V3_SELECTORS.supply);

    expect(createHandleSpy).toHaveBeenCalledTimes(1);
    expect(deriveIntentSpy).toHaveBeenCalledTimes(1);
    // Sanity: deriveIntent was called with selector "supply".
    expect(deriveIntentSpy.mock.calls[0]?.[3]).toBe("supply");
  });
});

describe("prepare_compound_supply — T2: base-asset supply with NO debt (lender position; gate does NOT fire)", () => {
  it("USDC into cUSDCv3 with 0 debt — handle created; intent === 'supply-collateral'", async () => {
    getStatusSpy.mockResolvedValueOnce(PAIRED_STATUS);
    deriveIntentSpy.mockResolvedValueOnce("supply-collateral");

    const result = await callTool({
      asset: USDC_CHECKSUMMED,
      amount: FIXTURE_R_AMOUNT,
    });

    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as {
      intent: string;
      asset: string;
      amount: string;
      amountWei: string;
    };
    expect(sc.intent).toBe("supply-collateral");
    expect(sc.asset).toBe(USDC_CHECKSUMMED);
    expect(sc.amountWei).toBe(FIXTURE_R_AMOUNT_WEI);
  });
});

describe("prepare_compound_supply — T3: intent-gate refusal (base-asset + outstanding debt → repay confusion)", () => {
  it("USDC into cUSDCv3 with debt → INVALID_INPUT + hintTool: prepare_compound_repay; handle NOT created", async () => {
    getStatusSpy.mockResolvedValueOnce(PAIRED_STATUS);
    deriveIntentSpy.mockResolvedValueOnce("repay-debt");

    const result = await callTool({
      asset: USDC_CHECKSUMMED,
      amount: FIXTURE_R_AMOUNT,
    });

    expect(result.isError).toBe(true);
    const sc = result.structuredContent as {
      errorCode: string;
      message: string;
      hintTool: string;
    };
    expect(sc.errorCode).toBe("INVALID_INPUT");
    expect(sc.hintTool).toBe("prepare_compound_repay");
    // Message names the correct tool explicitly.
    expect(sc.message).toContain("prepare_compound_repay");
    expect(sc.message).toContain("This is a repay, not a supply");

    // Short-circuit BEFORE encoding — createHandle NEVER called.
    expect(createHandleSpy).toHaveBeenCalledTimes(0);
  });
});

describe("prepare_compound_supply — T4: non-canonical Comet refusal (cheap pre-RPC gate)", () => {
  it("'0x1234...DEAD' Comet → INVALID_INPUT; deriveIntent NEVER called; createHandle NEVER called", async () => {
    getStatusSpy.mockResolvedValueOnce(PAIRED_STATUS);

    const result = await callTool({
      comet: "0x12345678901234567890123456789012345678EE",
      asset: USDC_CHECKSUMMED,
      amount: FIXTURE_R_AMOUNT,
    });

    expect(result.isError).toBe(true);
    const sc = result.structuredContent as { errorCode: string; message: string };
    expect(sc.errorCode).toBe("INVALID_INPUT");
    expect(sc.message).toContain("not in canonical Compound V3 mainnet allowlist");
    // The cheap gate fires BEFORE deriveIntent and createHandle.
    expect(deriveIntentSpy).toHaveBeenCalledTimes(0);
    expect(createHandleSpy).toHaveBeenCalledTimes(0);
  });
});

describe("prepare_compound_supply — T5: 'max' rejection (supply does NOT accept the sentinel)", () => {
  it("amount: 'max' → INVALID_INPUT via parseAmountStrict format regex", async () => {
    getStatusSpy.mockResolvedValueOnce(PAIRED_STATUS);
    deriveIntentSpy.mockResolvedValueOnce("supply-collateral");

    const result = await callTool({
      asset: USDC_CHECKSUMMED,
      amount: "max",
    });

    expect(result.isError).toBe(true);
    const sc = result.structuredContent as { errorCode: string };
    expect(sc.errorCode).toBe("INVALID_INPUT");
    expect(result.content[0]?.text ?? "").toMatch(/amount/i);
    expect(createHandleSpy).toHaveBeenCalledTimes(0);
  });
});

describe("prepare_compound_supply — T6: parseAmountStrict format errors", () => {
  it("amount: '1,000.50' (comma) → INVALID_INPUT", async () => {
    getStatusSpy.mockResolvedValueOnce(PAIRED_STATUS);
    deriveIntentSpy.mockResolvedValueOnce("supply-collateral");

    const result = await callTool({
      asset: USDC_CHECKSUMMED,
      amount: "1,000.50",
    });

    expect(result.isError).toBe(true);
    const sc = result.structuredContent as { errorCode: string };
    expect(sc.errorCode).toBe("INVALID_INPUT");
    expect(createHandleSpy).toHaveBeenCalledTimes(0);
  });

  it("amount: '1.1234567' fractional-overflow vs USDC decimals=6 → INVALID_INPUT", async () => {
    getStatusSpy.mockResolvedValueOnce(PAIRED_STATUS);
    deriveIntentSpy.mockResolvedValueOnce("supply-collateral");

    const result = await callTool({
      asset: USDC_CHECKSUMMED,
      amount: "1.1234567",
    });

    expect(result.isError).toBe(true);
    const sc = result.structuredContent as { errorCode: string };
    expect(sc.errorCode).toBe("INVALID_INPUT");
    expect(createHandleSpy).toHaveBeenCalledTimes(0);
  });
});

describe("prepare_compound_supply — T7: demo-mode refusal (WRONG_MODE — no persona)", () => {
  it("demo + no persona → WRONG_MODE; getStatus NEVER called; createHandle NEVER called", async () => {
    process.env[DEMO_KEY] = "true";
    _resetDemoModeForTesting();
    _resetActivePersonaForTesting();

    const result = await callTool({
      asset: USDC_CHECKSUMMED,
      amount: FIXTURE_R_AMOUNT,
    });

    expect(result.isError).toBe(true);
    const sc = result.structuredContent as { errorCode: string };
    expect(sc.errorCode).toBe("WRONG_MODE");
    expect(getStatusSpy).toHaveBeenCalledTimes(0);
    expect(createHandleSpy).toHaveBeenCalledTimes(0);
  });

  it("demo + whale persona + supply-collateral → success (intent gate runs with persona address)", async () => {
    const WHALE_ADDRESS = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";
    process.env[DEMO_KEY] = "true";
    _resetDemoModeForTesting();
    setActivePersona("whale");
    deriveIntentSpy.mockResolvedValueOnce("supply-collateral");

    const result = await callTool({
      asset: USDC_CHECKSUMMED,
      amount: FIXTURE_R_AMOUNT,
    });

    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as { from: string; intent: string };
    expect(sc.from).toBe(WHALE_ADDRESS);
    expect(sc.intent).toBe("supply-collateral");
    // T-DEMO-1: getStatus NEVER called in demo mode.
    expect(getStatusSpy).toHaveBeenCalledTimes(0);
  });
});

describe("prepare_compound_supply — T8: WC-session not paired (WALLET_NOT_PAIRED)", () => {
  it("getStatus returns null → WALLET_NOT_PAIRED; deriveIntent + createHandle NEVER called", async () => {
    getStatusSpy.mockResolvedValueOnce(null);

    const result = await callTool({
      asset: USDC_CHECKSUMMED,
      amount: FIXTURE_R_AMOUNT,
    });

    expect(result.isError).toBe(true);
    const sc = result.structuredContent as { errorCode: string };
    expect(sc.errorCode).toBe("WALLET_NOT_PAIRED");
    expect(deriveIntentSpy).toHaveBeenCalledTimes(0);
    expect(createHandleSpy).toHaveBeenCalledTimes(0);
  });
});

// ---------------------------------------------------------------------------
// T9: Fixture R byte-identity integration anchor — cross-link to
// test/signing-fingerprint.test.ts (Phase 28 Plan 28-01).
//
// Fixture R is `supply(USDC, 100e6)` on cUSDCv3 chainId=1 value=0. The
// prepare-tool integration test runs the full handler path (status mock,
// intent gate, decimals resolution, encoder, fingerprint computation) and
// asserts the resulting payloadFingerprint matches the literal anchor.
//
// Drift in the prepare-tool's preimage assembly OR in the encoder OR in the
// SOT Comet address resolution OR in the fingerprint helper itself breaks
// THIS assertion AND the standalone Fixture R assertion in the fingerprint
// test — both lines must move in lockstep.
// ---------------------------------------------------------------------------
describe("prepare_compound_supply — T9: Fixture R fingerprint anchor (PREP-03 + T-BIND-1)", () => {
  it("real-mode anvil#1 paired + USDC + 100 → payloadFingerprint === Fixture R literal", async () => {
    getStatusSpy.mockResolvedValueOnce(PAIRED_STATUS);
    deriveIntentSpy.mockResolvedValueOnce("supply-collateral");

    const result = await callTool({
      asset: USDC_CHECKSUMMED,
      amount: FIXTURE_R_AMOUNT,
    });

    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as { payloadFingerprint: string };
    expect(sc.payloadFingerprint).toBe(FIXTURE_R_FINGERPRINT);
  });
});

describe("prepare_compound_supply — verbatim PREPARE RECEIPT (PREP-02)", () => {
  it("4-slot substitution: chain + comet + asset + amount round-trip byte-identically", async () => {
    getStatusSpy.mockResolvedValueOnce(PAIRED_STATUS);
    deriveIntentSpy.mockResolvedValueOnce("supply-collateral");

    const result = await callTool({
      asset: USDC_CHECKSUMMED,
      amount: FIXTURE_R_AMOUNT,
    });

    expect(result.isError).toBeFalsy();
    const text = result.content[0]?.text ?? "";

    const expected = COMPOUND_SUPPLY_PREPARE_RECEIPT_TEMPLATE
      .replace("{CHAIN}", "ethereum (chainId 1)")
      .replace("{COMET}", cUSDCv3)
      .replace("{ASSET}", USDC_CHECKSUMMED)
      .replace("{AMOUNT}", FIXTURE_R_AMOUNT);
    expect(text).toBe(expected);
    expect(text).toContain("Compound V3 supply");
    expect(text).toContain(cUSDCv3);
    expect(text).toContain(USDC_CHECKSUMMED);
    expect(text).toContain(FIXTURE_R_AMOUNT);
  });
});

describe("prepare_compound_supply — register-all wiring (smoke)", () => {
  it("prepare_compound_supply is registered after register-all import", () => {
    const names = listRegisteredTools().map((t) => t.name);
    expect(names).toContain("prepare_compound_supply");
  });

  it("inputSchema requires chain + comet + asset + amount; chain enum widened to all 5 chains (Phase 41 Plan 41-02)", () => {
    const tool = getRegisteredTool("prepare_compound_supply");
    expect(tool).toBeDefined();
    if (!tool) return;
    expect(tool.inputSchema.required).toEqual(["chain", "comet", "asset", "amount"]);
    expect(tool.inputSchema.properties?.chain).toMatchObject({
      type: "string",
      enum: ["ethereum", "arbitrum", "polygon", "base", "optimism"],
    });
  });
});
