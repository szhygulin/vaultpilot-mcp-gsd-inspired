// prepare_compound_withdraw tests — Phase 28 Plan 28-02 (CMP-04).
//
// 10 cases covering:
//   T1: collateral withdraw happy path (asset !== baseToken)
//   T2: base-asset withdraw happy path WITH supply position (intent gate runs but does NOT fire)
//   T3: intent-gate refusal — base-asset + no supply → INVALID_INPUT + hintTool: prepare_compound_borrow
//   T4: non-canonical Comet refusal (cheap pre-RPC gate)
//   T5: "max" happy path → MAX_UINT256 sentinel; RECEIPT shows "max" verbatim
//   T5a: T-MAX-SPELLING-1 strict-equality — "MAX" rejects via parseAmountStrict
//   T6: parseAmountStrict format errors
//   T7: demo-mode refusal (WRONG_MODE — no persona)
//   T8: WC-session not paired (WALLET_NOT_PAIRED)
//   T9: Fixture S byte-identity integration anchor

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
      throw new Error("pair should not be called from prepare_compound_withdraw tests");
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
import { COMPOUND_V3_SELECTORS, decodeCompoundV3Call } from "../src/protocols/compound-v3.js";
import { MAX_UINT256 } from "../src/protocols/erc20.js";
import { COMPOUND_WITHDRAW_PREPARE_RECEIPT_TEMPLATE } from "../src/signing/blocks.js";
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
  const tool = getRegisteredTool("prepare_compound_withdraw");
  if (!tool) throw new Error("prepare_compound_withdraw not registered");
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

// Fixture S cross-link — see test/signing-fingerprint.test.ts (Phase 28 Plan
// 28-01 hardcoded anchor). Fixture S is `withdraw(USDC, 100e6)` on cUSDCv3
// chainId=1 value=0.
const FIXTURE_S_FINGERPRINT =
  "0x75d0cc3b899579ed4a7e2d8e6cb36386dc105ed97d326c73bcdafeed5dcfd70c";
const FIXTURE_S_AMOUNT = "100";
const FIXTURE_S_AMOUNT_WEI = "100000000";

// See prepare-compound-supply.test.ts for the rationale — install the spy
// ONCE at module load to avoid vi.spyOn layering on each beforeEach. Restored
// in afterAll so sibling test files see the canonical implementation.
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
  // NOTE: do NOT call vi.restoreAllMocks() here — see prepare-compound-
  // supply.test.ts for the rationale (wipes the createHandleSpy
  // implementation set by the module-level vi.mock factory).
});

describe("prepare_compound_withdraw — T1: collateral withdraw happy path (asset !== baseToken)", () => {
  it("WBTC out of cUSDCv3 — handle created; intent === 'withdraw-collateral'; selector === withdraw", async () => {
    getStatusSpy.mockResolvedValueOnce(PAIRED_STATUS);
    deriveIntentSpy.mockResolvedValueOnce("withdraw-collateral");

    const result = await callTool({
      asset: WBTC_CHECKSUMMED,
      amount: "0.25",
    });

    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as {
      handle: string;
      intent: string;
      comet: string;
      asset: string;
      amount: string;
    };
    expect(sc.intent).toBe("withdraw-collateral");
    expect(sc.comet).toBe(cUSDCv3);
    expect(sc.asset).toBe(WBTC_CHECKSUMMED);
    expect(sc.amount).toBe("0.25");

    const record = _peekHandleForTesting(sc.handle);
    expect(record).toBeDefined();
    if (!record) return;
    expect(record.tx.to).toBe(cUSDCv3);
    expect(record.tx.data.slice(0, 10).toLowerCase()).toBe(COMPOUND_V3_SELECTORS.withdraw);

    expect(deriveIntentSpy.mock.calls[0]?.[3]).toBe("withdraw");
  });
});

describe("prepare_compound_withdraw — T2: base-asset withdraw with supply position (gate does NOT fire)", () => {
  it("USDC out of cUSDCv3 with 100 supplied → handle created; intent === 'withdraw-collateral'", async () => {
    getStatusSpy.mockResolvedValueOnce(PAIRED_STATUS);
    deriveIntentSpy.mockResolvedValueOnce("withdraw-collateral");

    const result = await callTool({
      asset: USDC_CHECKSUMMED,
      amount: FIXTURE_S_AMOUNT,
    });

    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as {
      intent: string;
      amount: string;
      amountWei: string;
    };
    expect(sc.intent).toBe("withdraw-collateral");
    expect(sc.amountWei).toBe(FIXTURE_S_AMOUNT_WEI);
  });
});

describe("prepare_compound_withdraw — T3: intent-gate refusal (base-asset + no supply → borrow confusion)", () => {
  it("USDC out of cUSDCv3 with NO supply → INVALID_INPUT + hintTool: prepare_compound_borrow; handle NOT created", async () => {
    getStatusSpy.mockResolvedValueOnce(PAIRED_STATUS);
    deriveIntentSpy.mockResolvedValueOnce("borrow");

    const result = await callTool({
      asset: USDC_CHECKSUMMED,
      amount: FIXTURE_S_AMOUNT,
    });

    expect(result.isError).toBe(true);
    const sc = result.structuredContent as {
      errorCode: string;
      message: string;
      hintTool: string;
    };
    expect(sc.errorCode).toBe("INVALID_INPUT");
    expect(sc.hintTool).toBe("prepare_compound_borrow");
    expect(sc.message).toContain("prepare_compound_borrow");
    expect(sc.message).toContain("Compound V3 withdraw against zero base supply IS a borrow");

    // Short-circuit BEFORE encoding.
    expect(createHandleSpy).toHaveBeenCalledTimes(0);
  });
});

describe("prepare_compound_withdraw — T4: non-canonical Comet refusal (cheap pre-RPC gate)", () => {
  it("'0x1234...EE' Comet → INVALID_INPUT; deriveIntent + createHandle NEVER called", async () => {
    getStatusSpy.mockResolvedValueOnce(PAIRED_STATUS);

    const result = await callTool({
      comet: "0x12345678901234567890123456789012345678EE",
      asset: USDC_CHECKSUMMED,
      amount: FIXTURE_S_AMOUNT,
    });

    expect(result.isError).toBe(true);
    const sc = result.structuredContent as { errorCode: string; message: string };
    expect(sc.errorCode).toBe("INVALID_INPUT");
    expect(sc.message).toContain("not in canonical Compound V3 mainnet allowlist");
    expect(deriveIntentSpy).toHaveBeenCalledTimes(0);
    expect(createHandleSpy).toHaveBeenCalledTimes(0);
  });
});

describe("prepare_compound_withdraw — T5: 'max' happy path (MAX_UINT256 sentinel)", () => {
  it("amount: 'max' → amountWei === MAX_UINT256.toString(); calldata decodes to (asset, MAX_UINT256)", async () => {
    getStatusSpy.mockResolvedValueOnce(PAIRED_STATUS);
    deriveIntentSpy.mockResolvedValueOnce("withdraw-collateral");

    const result = await callTool({
      asset: USDC_CHECKSUMMED,
      amount: "max",
    });

    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as {
      handle: string;
      amount: string;
      amountWei: string;
    };
    // Verbatim "max" round-trip in structuredContent.amount.
    expect(sc.amount).toBe("max");
    expect(sc.amountWei).toBe(MAX_UINT256.toString());

    // Stored calldata decodes back to MAX_UINT256.
    const record = _peekHandleForTesting(sc.handle);
    expect(record).toBeDefined();
    if (!record) return;
    const decoded = decodeCompoundV3Call(record.tx.data);
    expect(decoded.kind).toBe("compound-withdraw");
    if (decoded.kind !== "compound-withdraw") return;
    expect(decoded.amount).toBe(MAX_UINT256);
    expect(decoded.isMax).toBe(true);
  });

  it("PREPARE RECEIPT renders 'amount: max' verbatim (NOT the resolved hex)", async () => {
    getStatusSpy.mockResolvedValueOnce(PAIRED_STATUS);
    deriveIntentSpy.mockResolvedValueOnce("withdraw-collateral");

    const result = await callTool({
      asset: USDC_CHECKSUMMED,
      amount: "max",
    });

    expect(result.isError).toBeFalsy();
    const text = result.content[0]?.text ?? "";
    expect(text).toContain("amount:       max");
    // The resolved MAX_UINT256 hex must NOT bleed into the receipt.
    expect(text).not.toContain("0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff");
    expect(text).not.toContain(MAX_UINT256.toString());
  });
});

describe("prepare_compound_withdraw — T5a: T-MAX-SPELLING-1 strict-equality (lowercase only)", () => {
  it("amount: 'MAX' (uppercase) → INVALID_INPUT via parseAmountStrict regex", async () => {
    getStatusSpy.mockResolvedValueOnce(PAIRED_STATUS);
    deriveIntentSpy.mockResolvedValueOnce("withdraw-collateral");

    const result = await callTool({
      asset: USDC_CHECKSUMMED,
      amount: "MAX",
    });

    expect(result.isError).toBe(true);
    const sc = result.structuredContent as { errorCode: string };
    expect(sc.errorCode).toBe("INVALID_INPUT");
    expect(createHandleSpy).toHaveBeenCalledTimes(0);
  });

  it("amount: 'unlimited' → INVALID_INPUT", async () => {
    getStatusSpy.mockResolvedValueOnce(PAIRED_STATUS);
    deriveIntentSpy.mockResolvedValueOnce("withdraw-collateral");

    const result = await callTool({
      asset: USDC_CHECKSUMMED,
      amount: "unlimited",
    });

    expect(result.isError).toBe(true);
    const sc = result.structuredContent as { errorCode: string };
    expect(sc.errorCode).toBe("INVALID_INPUT");
    expect(createHandleSpy).toHaveBeenCalledTimes(0);
  });

  it("amount: 'infinite' → INVALID_INPUT", async () => {
    getStatusSpy.mockResolvedValueOnce(PAIRED_STATUS);
    deriveIntentSpy.mockResolvedValueOnce("withdraw-collateral");

    const result = await callTool({
      asset: USDC_CHECKSUMMED,
      amount: "infinite",
    });

    expect(result.isError).toBe(true);
    const sc = result.structuredContent as { errorCode: string };
    expect(sc.errorCode).toBe("INVALID_INPUT");
  });
});

describe("prepare_compound_withdraw — T6: parseAmountStrict format errors", () => {
  it("amount: '1,000.50' (comma) → INVALID_INPUT", async () => {
    getStatusSpy.mockResolvedValueOnce(PAIRED_STATUS);
    deriveIntentSpy.mockResolvedValueOnce("withdraw-collateral");

    const result = await callTool({
      asset: USDC_CHECKSUMMED,
      amount: "1,000.50",
    });

    expect(result.isError).toBe(true);
    const sc = result.structuredContent as { errorCode: string };
    expect(sc.errorCode).toBe("INVALID_INPUT");
    expect(createHandleSpy).toHaveBeenCalledTimes(0);
  });
});

describe("prepare_compound_withdraw — T7: demo-mode refusal (WRONG_MODE — no persona)", () => {
  it("demo + no persona → WRONG_MODE; deriveIntent + createHandle NEVER called", async () => {
    process.env[DEMO_KEY] = "true";
    _resetDemoModeForTesting();
    _resetActivePersonaForTesting();

    const result = await callTool({
      asset: USDC_CHECKSUMMED,
      amount: FIXTURE_S_AMOUNT,
    });

    expect(result.isError).toBe(true);
    const sc = result.structuredContent as { errorCode: string };
    expect(sc.errorCode).toBe("WRONG_MODE");
    expect(deriveIntentSpy).toHaveBeenCalledTimes(0);
    expect(createHandleSpy).toHaveBeenCalledTimes(0);
  });
});

describe("prepare_compound_withdraw — T8: WC-session not paired (WALLET_NOT_PAIRED)", () => {
  it("getStatus returns null → WALLET_NOT_PAIRED; createHandle NEVER called", async () => {
    getStatusSpy.mockResolvedValueOnce(null);

    const result = await callTool({
      asset: USDC_CHECKSUMMED,
      amount: FIXTURE_S_AMOUNT,
    });

    expect(result.isError).toBe(true);
    const sc = result.structuredContent as { errorCode: string };
    expect(sc.errorCode).toBe("WALLET_NOT_PAIRED");
    expect(createHandleSpy).toHaveBeenCalledTimes(0);
  });
});

// ---------------------------------------------------------------------------
// T9: Fixture S byte-identity integration anchor — cross-link to
// test/signing-fingerprint.test.ts (Phase 28 Plan 28-01).
//
// Fixture S is `withdraw(USDC, 100e6)` on cUSDCv3 chainId=1 value=0. Same
// drift-guarantee as Fixture R: this assertion and the standalone anchor in
// the fingerprint test move in lockstep.
// ---------------------------------------------------------------------------
describe("prepare_compound_withdraw — T9: Fixture S fingerprint anchor (PREP-03 + T-BIND-1)", () => {
  it("real-mode anvil#1 paired + USDC + 100 → payloadFingerprint === Fixture S literal", async () => {
    getStatusSpy.mockResolvedValueOnce(PAIRED_STATUS);
    deriveIntentSpy.mockResolvedValueOnce("withdraw-collateral");

    const result = await callTool({
      asset: USDC_CHECKSUMMED,
      amount: FIXTURE_S_AMOUNT,
    });

    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as { payloadFingerprint: string };
    expect(sc.payloadFingerprint).toBe(FIXTURE_S_FINGERPRINT);
  });
});

describe("prepare_compound_withdraw — verbatim PREPARE RECEIPT (PREP-02)", () => {
  it("4-slot substitution: chain + comet + asset + amount round-trip byte-identically", async () => {
    getStatusSpy.mockResolvedValueOnce(PAIRED_STATUS);
    deriveIntentSpy.mockResolvedValueOnce("withdraw-collateral");

    const result = await callTool({
      asset: USDC_CHECKSUMMED,
      amount: FIXTURE_S_AMOUNT,
    });

    expect(result.isError).toBeFalsy();
    const text = result.content[0]?.text ?? "";

    const expected = COMPOUND_WITHDRAW_PREPARE_RECEIPT_TEMPLATE
      .replace("{CHAIN}", "ethereum (chainId 1)")
      .replace("{COMET}", cUSDCv3)
      .replace("{ASSET}", USDC_CHECKSUMMED)
      .replace("{AMOUNT}", FIXTURE_S_AMOUNT);
    expect(text).toBe(expected);
    expect(text).toContain("Compound V3 withdraw");
  });
});

describe("prepare_compound_withdraw — register-all wiring (smoke)", () => {
  it("prepare_compound_withdraw is registered after register-all import", () => {
    const names = listRegisteredTools().map((t) => t.name);
    expect(names).toContain("prepare_compound_withdraw");
  });

  it("inputSchema requires chain + comet + asset + amount; chain enum locked to ['ethereum']", () => {
    const tool = getRegisteredTool("prepare_compound_withdraw");
    expect(tool).toBeDefined();
    if (!tool) return;
    expect(tool.inputSchema.required).toEqual(["chain", "comet", "asset", "amount"]);
    expect(tool.inputSchema.properties?.chain).toMatchObject({
      type: "string",
      enum: ["ethereum"],
    });
  });
});
