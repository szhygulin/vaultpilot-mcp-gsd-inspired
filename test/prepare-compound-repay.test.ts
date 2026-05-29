// prepare_compound_repay tests — Phase 28 Plan 28-03 (CMP-05 repay leg).
//
// 10+ cases covering:
//   T1: base-asset repay happy path (with debt, intent === "repay-debt")
//   T2: intent-gate refusal — non-base asset → INVALID_INPUT + hintTool: prepare_compound_supply
//   T3: intent-gate refusal — base-asset + no debt → INVALID_INPUT + hintTool: prepare_compound_supply
//   T4: non-canonical Comet refusal (cheap pre-RPC gate)
//   T5: "max" ACCEPTANCE happy path → MAX_UINT256 sentinel; RECEIPT shows "max" verbatim;
//       calldata decodes to (asset, MAX_UINT256); intent === "repay-debt"
//   T5a: T-MAX-SPELLING-1 strict-equality — "MAX" / "unlimited" / "infinite" reject
//   T6: parseAmountStrict format errors (non-"max")
//   T7: demo-mode refusal (WRONG_MODE — no persona)
//   T8: WC-session not paired (WALLET_NOT_PAIRED)
//   T9: Fixture U byte-identity integration anchor — supply(USDC, MAX_UINT256) on cUSDCv3,
//       cross-link to test/signing-fingerprint.test.ts (Plan 28-01)
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
      throw new Error("pair should not be called from prepare_compound_repay tests");
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
import { COMPOUND_REPAY_PREPARE_RECEIPT_TEMPLATE } from "../src/signing/blocks.js";
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
  const tool = getRegisteredTool("prepare_compound_repay");
  if (!tool) throw new Error("prepare_compound_repay not registered");
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

// Fixture U cross-link — see test/signing-fingerprint.test.ts (Plan 28-01
// hardcoded literal anchor). Fixture U is `supply(USDC, MAX_UINT256)` on
// cUSDCv3 chainId=1 value=0 — the full-position-close (repay-max) sentinel.
// The agent INTENT (repay vs supply) is orthogonal to the cryptographic
// binding: both tools emit byte-identical calldata for the supply selector
// against the same tx.to + amount.
const FIXTURE_U_FINGERPRINT =
  "0x287f7b8731dbe64fbfcaf023382eb31c385a33938b52548887daef807f7e480c";

// Install stable spies ONCE at module load. Restored in afterAll.
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

describe("prepare_compound_repay — T1: base-asset repay happy path (existing debt)", () => {
  it("USDC into cUSDCv3 with existing debt — handle created; intent === 'repay-debt'; selector === supply", async () => {
    getStatusSpy.mockResolvedValueOnce(PAIRED_STATUS);
    deriveIntentSpy.mockResolvedValueOnce("repay-debt");

    const result = await callTool({
      asset: USDC_CHECKSUMMED,
      amount: "50",
    });

    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as {
      handle: string;
      comet: string;
      asset: string;
      amount: string;
      amountWei: string;
      intent: string;
    };
    expect(sc.intent).toBe("repay-debt");
    expect(sc.comet).toBe(cUSDCv3);
    expect(sc.asset).toBe(USDC_CHECKSUMMED);
    expect(sc.amount).toBe("50");
    expect(sc.amountWei).toBe("50000000");

    // Stored tx — tx.to is the Comet; calldata starts with SUPPLY selector
    // (research § Topic 3 — repay emits the same selector as supply; the
    // intent is named at the tool surface).
    const record = _peekHandleForTesting(sc.handle);
    expect(record).toBeDefined();
    if (!record) return;
    expect(record.tx.to).toBe(cUSDCv3);
    expect(record.tx.data.slice(0, 10).toLowerCase()).toBe(COMPOUND_V3_SELECTORS.supply);

    expect(deriveIntentSpy).toHaveBeenCalledTimes(1);
    expect(deriveIntentSpy.mock.calls[0]?.[3]).toBe("supply");
    expect(readBaseTokenSpy).toHaveBeenCalledTimes(0); // happy path skips
  });
});

describe("prepare_compound_repay — T2: intent-gate refusal (non-base asset → collateral-supply confusion)", () => {
  it("WBTC into cUSDCv3 → INVALID_INPUT + hintTool: prepare_compound_supply; handle NOT created", async () => {
    getStatusSpy.mockResolvedValueOnce(PAIRED_STATUS);
    deriveIntentSpy.mockResolvedValueOnce("supply-collateral");
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
    expect(sc.hintTool).toBe("prepare_compound_supply");
    expect(sc.message).toContain("prepare_compound_supply");
    expect(sc.message).toContain("requires the Comet's base asset");
    expect(sc.message).toContain(WBTC_CHECKSUMMED);
    expect(sc.message).toContain(USDC_CHECKSUMMED); // baseToken surfaced

    expect(createHandleSpy).toHaveBeenCalledTimes(0);
  });
});

describe("prepare_compound_repay — T3: intent-gate refusal (base-asset + no debt → lender-deposit confusion)", () => {
  it("USDC into cUSDCv3 with no debt → INVALID_INPUT + hintTool: prepare_compound_supply", async () => {
    getStatusSpy.mockResolvedValueOnce(PAIRED_STATUS);
    // The shared deriveIntent helper returns "supply-collateral" for the
    // base-asset-no-debt case (the helper's 4-arm union collapses base-asset +
    // borrowBalanceOf === 0n into supply-collateral; see src/chains/compound-
    // v3.ts JSDoc).
    deriveIntentSpy.mockResolvedValueOnce("supply-collateral");
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
    expect(sc.hintTool).toBe("prepare_compound_supply");
    expect(sc.message).toContain("no outstanding debt");
    expect(sc.message).toContain("This is a supply, not a repay");
    expect(sc.message).toContain("prepare_compound_supply");

    expect(createHandleSpy).toHaveBeenCalledTimes(0);
  });
});

describe("prepare_compound_repay — T4: non-canonical Comet refusal (cheap pre-RPC gate)", () => {
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

describe("prepare_compound_repay — T5: 'max' ACCEPTANCE happy path (MAX_UINT256 sentinel)", () => {
  it("amount: 'max' → amountWei === MAX_UINT256.toString(); calldata decodes to (asset, MAX_UINT256); intent === 'repay-debt'", async () => {
    getStatusSpy.mockResolvedValueOnce(PAIRED_STATUS);
    deriveIntentSpy.mockResolvedValueOnce("repay-debt");

    const result = await callTool({
      asset: USDC_CHECKSUMMED,
      amount: "max",
    });

    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as {
      handle: string;
      amount: string;
      amountWei: string;
      intent: string;
    };
    // Verbatim "max" round-trip in structuredContent.amount.
    expect(sc.amount).toBe("max");
    expect(sc.amountWei).toBe(MAX_UINT256.toString());
    expect(sc.intent).toBe("repay-debt");

    // Stored calldata decodes back to MAX_UINT256.
    const record = _peekHandleForTesting(sc.handle);
    expect(record).toBeDefined();
    if (!record) return;
    const decoded = decodeCompoundV3Call(record.tx.data);
    expect(decoded.kind).toBe("compound-supply");
    if (decoded.kind !== "compound-supply") return;
    expect(decoded.amount).toBe(MAX_UINT256);
    expect(decoded.isMax).toBe(true);
  });

  it("PREPARE RECEIPT renders 'amount: max' verbatim (NOT the resolved hex)", async () => {
    getStatusSpy.mockResolvedValueOnce(PAIRED_STATUS);
    deriveIntentSpy.mockResolvedValueOnce("repay-debt");

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

describe("prepare_compound_repay — T5a: T-MAX-SPELLING-1 strict-equality (lowercase only)", () => {
  it("amount: 'MAX' (uppercase) → INVALID_INPUT via parseAmountStrict regex", async () => {
    getStatusSpy.mockResolvedValueOnce(PAIRED_STATUS);
    deriveIntentSpy.mockResolvedValueOnce("repay-debt");

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
    deriveIntentSpy.mockResolvedValueOnce("repay-debt");

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
    deriveIntentSpy.mockResolvedValueOnce("repay-debt");

    const result = await callTool({
      asset: USDC_CHECKSUMMED,
      amount: "infinite",
    });

    expect(result.isError).toBe(true);
    const sc = result.structuredContent as { errorCode: string };
    expect(sc.errorCode).toBe("INVALID_INPUT");
  });
});

describe("prepare_compound_repay — T6: parseAmountStrict format errors (non-'max' path)", () => {
  it("amount: '1,000.50' (comma) → INVALID_INPUT", async () => {
    getStatusSpy.mockResolvedValueOnce(PAIRED_STATUS);
    deriveIntentSpy.mockResolvedValueOnce("repay-debt");

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
    deriveIntentSpy.mockResolvedValueOnce("repay-debt");

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

describe("prepare_compound_repay — T7: demo-mode refusal (WRONG_MODE — no persona)", () => {
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

  it("demo + whale persona + 'max' → success (MAX_UINT256 sentinel; intent === 'repay-debt')", async () => {
    const WHALE_ADDRESS = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";
    process.env[DEMO_KEY] = "true";
    _resetDemoModeForTesting();
    setActivePersona("whale");
    deriveIntentSpy.mockResolvedValueOnce("repay-debt");

    const result = await callTool({
      asset: USDC_CHECKSUMMED,
      amount: "max",
    });

    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as {
      from: string;
      intent: string;
      amountWei: string;
    };
    expect(sc.from).toBe(WHALE_ADDRESS);
    expect(sc.intent).toBe("repay-debt");
    expect(sc.amountWei).toBe(MAX_UINT256.toString());
    expect(getStatusSpy).toHaveBeenCalledTimes(0);
  });
});

describe("prepare_compound_repay — T8: WC-session not paired (WALLET_NOT_PAIRED)", () => {
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
// T9: Fixture U byte-identity integration anchor — cross-link to
// test/signing-fingerprint.test.ts (Phase 28 Plan 28-01 hardcoded literal).
//
// Fixture U is `supply(USDC, MAX_UINT256)` on cUSDCv3 chainId=1 value=0 —
// the FULL-POSITION-CLOSE (repay-max) sentinel. This is the second
// MAX_UINT256 sentinel anchor in the Phase 28 fixture set (Fixture S was
// supply with concrete 100e6; Fixture U is the MAX_UINT256 case).
//
// The byte-identity assertion proves: (a) the "max" → MAX_UINT256 mapping
// in prepare_compound_repay produces the same calldata bytes as the
// standalone Fixture U computation in the fingerprint test; (b) drift in
// either side breaks both assertions simultaneously.
// ---------------------------------------------------------------------------
describe("prepare_compound_repay — T9: Fixture U fingerprint anchor (PREP-03 + T-BIND-1; MAX_UINT256 sentinel)", () => {
  it("real-mode anvil#1 paired + USDC + 'max' → payloadFingerprint === Fixture U literal", async () => {
    getStatusSpy.mockResolvedValueOnce(PAIRED_STATUS);
    deriveIntentSpy.mockResolvedValueOnce("repay-debt");

    const result = await callTool({
      asset: USDC_CHECKSUMMED,
      amount: "max",
    });

    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as {
      payloadFingerprint: string;
      amountWei: string;
    };
    expect(sc.payloadFingerprint).toBe(FIXTURE_U_FINGERPRINT);
    expect(sc.amountWei).toBe(MAX_UINT256.toString());
  });
});

describe("prepare_compound_repay — verbatim PREPARE RECEIPT (PREP-02)", () => {
  it("4-slot substitution: chain + comet + asset + amount round-trip byte-identically (decimal path)", async () => {
    getStatusSpy.mockResolvedValueOnce(PAIRED_STATUS);
    deriveIntentSpy.mockResolvedValueOnce("repay-debt");

    const result = await callTool({
      asset: USDC_CHECKSUMMED,
      amount: "50",
    });

    expect(result.isError).toBeFalsy();
    const text = result.content[0]?.text ?? "";

    const expected = COMPOUND_REPAY_PREPARE_RECEIPT_TEMPLATE
      .replace("{CHAIN}", "ethereum (chainId 1)")
      .replace("{COMET}", cUSDCv3)
      .replace("{ASSET}", USDC_CHECKSUMMED)
      .replace("{AMOUNT}", "50");
    expect(text).toBe(expected);
    expect(text).toContain("Compound V3 repay");
  });

  it("RECEIPT preserves 'max' verbatim in AMOUNT slot (not the resolved hex)", async () => {
    getStatusSpy.mockResolvedValueOnce(PAIRED_STATUS);
    deriveIntentSpy.mockResolvedValueOnce("repay-debt");

    const result = await callTool({
      asset: USDC_CHECKSUMMED,
      amount: "max",
    });

    expect(result.isError).toBeFalsy();
    const text = result.content[0]?.text ?? "";

    const expected = COMPOUND_REPAY_PREPARE_RECEIPT_TEMPLATE
      .replace("{CHAIN}", "ethereum (chainId 1)")
      .replace("{COMET}", cUSDCv3)
      .replace("{ASSET}", USDC_CHECKSUMMED)
      .replace("{AMOUNT}", "max");
    expect(text).toBe(expected);
    expect(text).toContain("amount:       max");
    expect(text).not.toContain(MAX_UINT256.toString());
  });
});

describe("prepare_compound_repay — register-all wiring (smoke)", () => {
  it("prepare_compound_repay is registered after register-all import", () => {
    const names = listRegisteredTools().map((t) => t.name);
    expect(names).toContain("prepare_compound_repay");
  });

  it("inputSchema requires chain + comet + asset + amount; chain enum widened to all 5 chains (Phase 41 Plan 41-02)", () => {
    const tool = getRegisteredTool("prepare_compound_repay");
    expect(tool).toBeDefined();
    if (!tool) return;
    expect(tool.inputSchema.required).toEqual(["chain", "comet", "asset", "amount"]);
    expect(tool.inputSchema.properties?.chain).toMatchObject({
      type: "string",
      enum: ["ethereum", "arbitrum", "polygon", "base", "optimism"],
    });
  });
});
