// prepare_compound_borrow tests — Phase 28 Plan 28-03 (CMP-05 borrow leg).
//
// 9+ cases covering:
//   T1: base-asset borrow happy path (zero supply, intent === "borrow")
//   T2: intent-gate refusal — non-base asset → INVALID_INPUT + hintTool: prepare_compound_withdraw
//   T3: intent-gate refusal — base-asset + existing supply → INVALID_INPUT + hintTool: prepare_compound_withdraw
//   T4: non-canonical Comet refusal (cheap pre-RPC gate)
//   T5: "max" REJECTED — borrow does NOT accept the sentinel; parseAmountStrict regex fires
//   T6: parseAmountStrict format errors
//   T7: demo-mode refusal (WRONG_MODE — no persona)
//   T8: WC-session not paired (WALLET_NOT_PAIRED)
//   T9: Fixture T byte-identity integration anchor — withdraw(USDC, 50e6) on cUSDCv3,
//       cross-link to test/signing-fingerprint.test.ts (Plan 28-01 hardcoded literal)
//   + PREPARE RECEIPT verbatim assertion + register-all wiring smoke test

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { getStatusSpy, createHandleSpy, deriveIntentSpy, readBaseTokenSpy } = vi.hoisted(() => ({
  getStatusSpy: vi.fn(),
  createHandleSpy: vi.fn<typeof import("../src/signing/handle-store.js").createHandle>(),
  deriveIntentSpy: vi.fn(),
  readBaseTokenSpy: vi.fn(),
}));

vi.mock("../src/wallet/session-manager.js", async () => {
  const actual = await vi.importActual<typeof import("../src/wallet/session-manager.js")>(
    "../src/wallet/session-manager.js",
  );
  return {
    ...actual,
    getStatus: (...args: Parameters<typeof actual.getStatus>) => getStatusSpy(...args),
    pair: vi.fn(async () => {
      throw new Error("pair should not be called from prepare_compound_borrow tests");
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
import { COMPOUND_BORROW_PREPARE_RECEIPT_TEMPLATE } from "../src/signing/blocks.js";
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
  const tool = getRegisteredTool("prepare_compound_borrow");
  if (!tool) throw new Error("prepare_compound_borrow not registered");
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

// Fixture T cross-link — see test/signing-fingerprint.test.ts (Plan 28-01
// hardcoded literal anchor). Fixture T is `withdraw(USDC, 50e6)` on cUSDCv3
// with chainId=1 and value=0 — the borrow-path variant (same calldata SHAPE
// as Fixture S but distinct amount). The agent INTENT is orthogonal to the
// cryptographic binding: borrow + withdraw at the protocol layer emit byte-
// identical calldata; the fingerprint is selector + tx-to + amount dependent.
const FIXTURE_T_FINGERPRINT =
  "0x7e31ff45686170495c8859b23712de665168bd53b44c248dc51459900246428c";
const FIXTURE_T_AMOUNT = "50";
const FIXTURE_T_AMOUNT_WEI = "50000000"; // 50 USDC, decimals=6

// Install stable spies ONCE at module load. Restored in afterAll so sibling
// test files see the canonical implementation. See prepare-compound-supply.
// test.ts for the rationale (avoid vi.spyOn layering).
const ORIGINAL_DERIVE_INTENT = _compoundChains.deriveIntent;
const ORIGINAL_READ_BASE_TOKEN = _compoundChains.readBaseToken;
_compoundChains.deriveIntent = deriveIntentSpy as unknown as typeof _compoundChains.deriveIntent;
_compoundChains.readBaseToken = readBaseTokenSpy as unknown as typeof _compoundChains.readBaseToken;

afterAll(() => {
  _compoundChains.deriveIntent = ORIGINAL_DERIVE_INTENT;
  _compoundChains.readBaseToken = ORIGINAL_READ_BASE_TOKEN;
});

beforeEach(() => {
  getStatusSpy.mockReset();
  createHandleSpy.mockClear();
  deriveIntentSpy.mockReset();
  readBaseTokenSpy.mockReset();
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

describe("prepare_compound_borrow — T1: base-asset borrow happy path (zero supply position)", () => {
  it("USDC out of cUSDCv3 with zero supply — handle created; intent === 'borrow'; selector === withdraw", async () => {
    getStatusSpy.mockResolvedValueOnce(PAIRED_STATUS);
    deriveIntentSpy.mockResolvedValueOnce("borrow");

    const result = await callTool({
      asset: USDC_CHECKSUMMED,
      amount: "100",
    });

    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as {
      handle: string;
      comet: string;
      asset: string;
      amount: string;
      amountWei: string;
      intent: string;
      payloadFingerprint: string;
    };
    expect(sc.intent).toBe("borrow");
    expect(sc.comet).toBe(cUSDCv3);
    expect(sc.asset).toBe(USDC_CHECKSUMMED);
    expect(sc.amount).toBe("100");
    expect(sc.amountWei).toBe("100000000");
    expect(sc.handle).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );

    // Stored tx — tx.to is the Comet; calldata starts with WITHDRAW selector
    // (research § Topic 3 — borrow emits the same selector as withdraw; the
    // intent is named at the tool surface, not the calldata).
    const record = _peekHandleForTesting(sc.handle);
    expect(record).toBeDefined();
    if (!record) return;
    expect(record.tx.to).toBe(cUSDCv3);
    expect(record.tx.chainId).toBe(1);
    expect(record.tx.valueWei).toBe(0n);
    expect(record.tx.data.slice(0, 10).toLowerCase()).toBe(COMPOUND_V3_SELECTORS.withdraw);

    expect(createHandleSpy).toHaveBeenCalledTimes(1);
    expect(deriveIntentSpy).toHaveBeenCalledTimes(1);
    // Sanity: deriveIntent was called with selector "withdraw" (the borrow
    // tool routes through the withdraw selector at the protocol layer).
    expect(deriveIntentSpy.mock.calls[0]?.[3]).toBe("withdraw");
    // Refusal-path RPC NOT invoked on the happy path.
    expect(readBaseTokenSpy).toHaveBeenCalledTimes(0);
  });
});

describe("prepare_compound_borrow — T2: intent-gate refusal (non-base asset → collateral-withdraw confusion)", () => {
  it("WBTC into cUSDCv3 → INVALID_INPUT + hintTool: prepare_compound_withdraw; handle NOT created", async () => {
    getStatusSpy.mockResolvedValueOnce(PAIRED_STATUS);
    deriveIntentSpy.mockResolvedValueOnce("withdraw-collateral");
    // Refusal path reads baseToken to surface it in the human message.
    readBaseTokenSpy.mockResolvedValueOnce(USDC_CHECKSUMMED);

    const result = await callTool({
      asset: WBTC_CHECKSUMMED,
      amount: "0.5",
    });

    expect(result.isError).toBe(true);
    const sc = result.structuredContent as {
      errorCode: string;
      message: string;
      hintTool: string;
    };
    expect(sc.errorCode).toBe("INVALID_INPUT");
    expect(sc.hintTool).toBe("prepare_compound_withdraw");
    // Message names the correct tool explicitly + surfaces the actual base
    // token so the agent can self-correct.
    expect(sc.message).toContain("prepare_compound_withdraw");
    expect(sc.message).toContain("requires the Comet's base asset");
    expect(sc.message).toContain(WBTC_CHECKSUMMED);
    expect(sc.message).toContain(USDC_CHECKSUMMED); // baseToken surfaced

    // Short-circuit BEFORE encoding — createHandle NEVER called.
    expect(createHandleSpy).toHaveBeenCalledTimes(0);
  });
});

describe("prepare_compound_borrow — T3: intent-gate refusal (base-asset + existing supply position)", () => {
  it("USDC into cUSDCv3 with existing supply → INVALID_INPUT + hintTool: prepare_compound_withdraw", async () => {
    getStatusSpy.mockResolvedValueOnce(PAIRED_STATUS);
    // The shared deriveIntent helper returns "withdraw-collateral" for the
    // base-asset-with-supply case (the helper's 4-arm union collapses base-
    // asset + supply > 0n into withdraw-collateral; see src/chains/compound-
    // v3.ts JSDoc).
    deriveIntentSpy.mockResolvedValueOnce("withdraw-collateral");
    readBaseTokenSpy.mockResolvedValueOnce(USDC_CHECKSUMMED);

    const result = await callTool({
      asset: USDC_CHECKSUMMED,
      amount: "100",
    });

    expect(result.isError).toBe(true);
    const sc = result.structuredContent as {
      errorCode: string;
      message: string;
      hintTool: string;
    };
    expect(sc.errorCode).toBe("INVALID_INPUT");
    expect(sc.hintTool).toBe("prepare_compound_withdraw");
    // The base-asset path of the refusal message names "existing supply position".
    expect(sc.message).toContain("existing supply position");
    expect(sc.message).toContain("This is a withdraw, not a borrow");
    expect(sc.message).toContain("prepare_compound_withdraw");

    expect(createHandleSpy).toHaveBeenCalledTimes(0);
  });
});

describe("prepare_compound_borrow — T4: non-canonical Comet refusal (cheap pre-RPC gate)", () => {
  it("'0x1234...EE' Comet → INVALID_INPUT; deriveIntent + createHandle NEVER called", async () => {
    getStatusSpy.mockResolvedValueOnce(PAIRED_STATUS);

    const result = await callTool({
      comet: "0x12345678901234567890123456789012345678EE",
      asset: USDC_CHECKSUMMED,
      amount: "100",
    });

    expect(result.isError).toBe(true);
    const sc = result.structuredContent as { errorCode: string; message: string };
    expect(sc.errorCode).toBe("INVALID_INPUT");
    expect(sc.message).toContain("not in canonical Compound V3 mainnet allowlist");
    expect(deriveIntentSpy).toHaveBeenCalledTimes(0);
    expect(createHandleSpy).toHaveBeenCalledTimes(0);
  });
});

describe("prepare_compound_borrow — T5: 'max' REJECTION (borrow does NOT accept the sentinel)", () => {
  it("amount: 'max' → INVALID_INPUT via parseAmountStrict regex; no special-case branch", async () => {
    getStatusSpy.mockResolvedValueOnce(PAIRED_STATUS);
    deriveIntentSpy.mockResolvedValueOnce("borrow");

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

  it("amount: 'MAX' (uppercase) → INVALID_INPUT (T-MAX-SPELLING-1 doesn't apply — strict-equality short-circuit absent)", async () => {
    getStatusSpy.mockResolvedValueOnce(PAIRED_STATUS);
    deriveIntentSpy.mockResolvedValueOnce("borrow");

    const result = await callTool({
      asset: USDC_CHECKSUMMED,
      amount: "MAX",
    });

    expect(result.isError).toBe(true);
    const sc = result.structuredContent as { errorCode: string };
    expect(sc.errorCode).toBe("INVALID_INPUT");
  });
});

describe("prepare_compound_borrow — T6: parseAmountStrict format errors", () => {
  it("amount: '1,000.50' (comma) → INVALID_INPUT", async () => {
    getStatusSpy.mockResolvedValueOnce(PAIRED_STATUS);
    deriveIntentSpy.mockResolvedValueOnce("borrow");

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
    deriveIntentSpy.mockResolvedValueOnce("borrow");

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

describe("prepare_compound_borrow — T7: demo-mode refusal (WRONG_MODE — no persona)", () => {
  it("demo + no persona → WRONG_MODE; deriveIntent + createHandle NEVER called", async () => {
    process.env[DEMO_KEY] = "true";
    _resetDemoModeForTesting();
    _resetActivePersonaForTesting();

    const result = await callTool({
      asset: USDC_CHECKSUMMED,
      amount: "100",
    });

    expect(result.isError).toBe(true);
    const sc = result.structuredContent as { errorCode: string };
    expect(sc.errorCode).toBe("WRONG_MODE");
    expect(deriveIntentSpy).toHaveBeenCalledTimes(0);
    expect(createHandleSpy).toHaveBeenCalledTimes(0);
  });

  it("demo + whale persona + borrow → success (intent gate runs with persona address)", async () => {
    const WHALE_ADDRESS = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";
    process.env[DEMO_KEY] = "true";
    _resetDemoModeForTesting();
    setActivePersona("whale");
    deriveIntentSpy.mockResolvedValueOnce("borrow");

    const result = await callTool({
      asset: USDC_CHECKSUMMED,
      amount: "100",
    });

    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as { from: string; intent: string };
    expect(sc.from).toBe(WHALE_ADDRESS);
    expect(sc.intent).toBe("borrow");
    expect(getStatusSpy).toHaveBeenCalledTimes(0);
  });
});

describe("prepare_compound_borrow — T8: WC-session not paired (WALLET_NOT_PAIRED)", () => {
  it("getStatus returns null → WALLET_NOT_PAIRED; deriveIntent + createHandle NEVER called", async () => {
    getStatusSpy.mockResolvedValueOnce(null);

    const result = await callTool({
      asset: USDC_CHECKSUMMED,
      amount: "100",
    });

    expect(result.isError).toBe(true);
    const sc = result.structuredContent as { errorCode: string };
    expect(sc.errorCode).toBe("WALLET_NOT_PAIRED");
    expect(deriveIntentSpy).toHaveBeenCalledTimes(0);
    expect(createHandleSpy).toHaveBeenCalledTimes(0);
  });
});

// ---------------------------------------------------------------------------
// T9: Fixture T byte-identity integration anchor — cross-link to
// test/signing-fingerprint.test.ts (Phase 28 Plan 28-01 hardcoded literal).
//
// Fixture T is `withdraw(USDC, 50e6)` on cUSDCv3 chainId=1 value=0 — the
// BORROW-PATH variant. The agent INTENT (borrow vs withdraw) is orthogonal
// to the cryptographic binding: both tools emit byte-identical calldata
// against the same selector + tx.to + amount, so the payloadFingerprint
// matches Fixture T exactly when prepare_compound_borrow encodes
// withdraw(USDC, 50e6) on cUSDCv3.
//
// Drift in the prepare-tool's preimage assembly OR in the encoder OR in the
// SOT Comet address resolution OR in the fingerprint helper itself breaks
// THIS assertion AND the standalone Fixture T assertion in the fingerprint
// test — both lines must move in lockstep.
// ---------------------------------------------------------------------------
describe("prepare_compound_borrow — T9: Fixture T fingerprint anchor (PREP-03 + T-BIND-1)", () => {
  it("real-mode anvil#1 paired + USDC + 50 → payloadFingerprint === Fixture T literal", async () => {
    getStatusSpy.mockResolvedValueOnce(PAIRED_STATUS);
    deriveIntentSpy.mockResolvedValueOnce("borrow");

    const result = await callTool({
      asset: USDC_CHECKSUMMED,
      amount: FIXTURE_T_AMOUNT,
    });

    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as {
      payloadFingerprint: string;
      amountWei: string;
    };
    expect(sc.payloadFingerprint).toBe(FIXTURE_T_FINGERPRINT);
    expect(sc.amountWei).toBe(FIXTURE_T_AMOUNT_WEI);
  });
});

describe("prepare_compound_borrow — verbatim PREPARE RECEIPT (PREP-02)", () => {
  it("4-slot substitution: chain + comet + asset + amount round-trip byte-identically", async () => {
    getStatusSpy.mockResolvedValueOnce(PAIRED_STATUS);
    deriveIntentSpy.mockResolvedValueOnce("borrow");

    const result = await callTool({
      asset: USDC_CHECKSUMMED,
      amount: FIXTURE_T_AMOUNT,
    });

    expect(result.isError).toBeFalsy();
    const text = result.content[0]?.text ?? "";

    const expected = COMPOUND_BORROW_PREPARE_RECEIPT_TEMPLATE
      .replace("{CHAIN}", "ethereum (chainId 1)")
      .replace("{COMET}", cUSDCv3)
      .replace("{ASSET}", USDC_CHECKSUMMED)
      .replace("{AMOUNT}", FIXTURE_T_AMOUNT);
    expect(text).toBe(expected);
    expect(text).toContain("Compound V3 borrow");
    expect(text).toContain(cUSDCv3);
    expect(text).toContain(USDC_CHECKSUMMED);
    expect(text).toContain(FIXTURE_T_AMOUNT);
  });
});

describe("prepare_compound_borrow — register-all wiring (smoke)", () => {
  it("prepare_compound_borrow is registered after register-all import", () => {
    const names = listRegisteredTools().map((t) => t.name);
    expect(names).toContain("prepare_compound_borrow");
  });

  it("inputSchema requires chain + comet + asset + amount; chain enum widened to all 5 chains (Phase 41 Plan 41-02)", () => {
    const tool = getRegisteredTool("prepare_compound_borrow");
    expect(tool).toBeDefined();
    if (!tool) return;
    expect(tool.inputSchema.required).toEqual(["chain", "comet", "asset", "amount"]);
    expect(tool.inputSchema.properties?.chain).toMatchObject({
      type: "string",
      enum: ["ethereum", "arbitrum", "polygon", "base", "optimism"],
    });
  });
});
