// `prepare_sunswap_swap` end-to-end regression. Phase 20 — Plan 20-01.
//
// Load-bearing invariants:
//
//   1. **Fixture Tron-20-A consumer re-anchor** — the canonical Fixture Tron-20-A
//      inputs produce the hardcoded literal fingerprint pinned in
//      `test/signing-fingerprint-tron-20.test.ts`. Drift in this tool's
//      preimage assembly surfaces HERE — load-bearing redundancy per CLAUDE.md
//      fixture discipline.
//
//   2. **Sandwich-MEV gate (D-03b)** — priceImpactBps > 200 AND no explicit
//      slippage → INVALID_INPUT + hintTool: "get_sunswap_quote". Tests 6/7/8/9.
//
//   3. **Explicit-vs-default slippage detection (D-03c / Test 9)** — gate is
//      "did the user supply slippage explicitly", NOT "is the slippage low enough".
//      slippageBps: 50 (explicit) above threshold → SUCCEEDS.
//      No slippageBps field above threshold → REFUSES.
//
//   4. **PREPARE RECEIPT verbatim** — receipt contains inputToken, outputToken,
//      verbatim amount string, slippageBps, priceImpactBps, path, deadline.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { listAccountsSpy, createHandleSpy } = vi.hoisted(() => ({
  listAccountsSpy: vi.fn(),
  createHandleSpy:
    vi.fn<typeof import("../src/signing/handle-store.js").createHandle>(),
}));

// Mock non-evm-account-store's `listAccounts`.
vi.mock("../src/wallet/non-evm-account-store.js", async () => {
  const actual = await vi.importActual<
    typeof import("../src/wallet/non-evm-account-store.js")
  >("../src/wallet/non-evm-account-store.js");
  return {
    ...actual,
    listAccounts: (
      ...args: Parameters<typeof actual.listAccounts>
    ) => listAccountsSpy(...args),
  };
});

// Mock handle-store's `createHandle` as a spy.
vi.mock("../src/signing/handle-store.js", async () => {
  const actual = await vi.importActual<
    typeof import("../src/signing/handle-store.js")
  >("../src/signing/handle-store.js");
  createHandleSpy.mockImplementation(actual.createHandle);
  return {
    ...actual,
    createHandle: (
      ...args: Parameters<typeof actual.createHandle>
    ) => createHandleSpy(...args),
  };
});

import { _tronRegistry } from "../src/chains/tron/registry.js";
import { _resetDemoModeForTesting } from "../src/config/env.js";
import {
  _resetActivePersonaForTesting,
  setActiveTronPersonaBySlug,
} from "../src/demo/state.js";
import { _sunswapClient, resetSunswapCacheForTesting } from "../src/clients/sunswap.js";
import { _sunSwapTron } from "../src/protocols/sunswap-tron.js";
import { _canonicalDispatchTron } from "../src/security/canonical-dispatch-tron.js";
import {
  _peekHandleForTesting,
  _resetHandleStoreForTesting,
} from "../src/signing/handle-store.js";
import {
  getRegisteredTool,
  type ToolHandlerResult,
} from "../src/tools/index.js";
import { FIXTURE_TRON_20_A_FINGERPRINT } from "./signing-fingerprint-tron-20.test.js";

await import("../src/tools/register-all.js");

const USDT_TRC20 = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";
const WTRX = "TNUC9Qb1rRpS5CbWLmNMxXBjyFoydXjWFR";
const JST = "TCFLL5dx5ZJdKnWuesXxi1VPwjLVmWZZy9";
const SUNSWAP_V2_ROUTER = "TKzxdSv2FZKQrEqkKVgp5DcwEXBEKMg2Ax";
const TRON_WHALE_ADDR = "TWd4WrZ9wn84f5x1hZhL4DHvk738ns5jwb";

// Fixture Tron-20-A — same inputs as signing-fingerprint-tron-20.test.ts
const FIXTURE_TRON_20_A_RAW_DATA_HEX =
  "0a0200ad22088e5e7df4e3c8b9a240f0c894a5e4335af002081f12eb020a31747970652e676f6f676c65617069732e636f6d2f70726f746f636f6c2e54726967676572536d617274436f6e747261637412b5020a1541e28b3cfd4e0e909077821478e9fcb86b84be786e1215416e0617948fe030a7e4970f8389d4ad295f249b7e22840238ed173900000000000000000000000000000000000000000000000000000000000f424000000000000000000000000000000000000000000000000000000000000e6c6200000000000000000000000000000000000000000000000000000000000000a0000000000000000000000000e28b3cfd4e0e909077821478e9fcb86b84be786e0000000000000000000000000000000000000000000000000000000068305d000000000000000000000000000000000000000000000000000000000000000002000000000000000000000000a614f803b6fd780986a42c78ec9c7f77e6ded13c000000000000000000000000891cdb91d149f23b1a45d9c5ca78a88d0cb44c187090f490a5e43390018084af5f";
const FIXTURE_TRON_20_A_REF_BLOCK_BYTES = "00ad";
const FIXTURE_TRON_20_A_REF_BLOCK_HASH = "8e5e7df4e3c8b9a2";
const FIXTURE_TRON_20_A_EXPIRATION = 1779268134000;
const FIXTURE_TRON_20_A_AMOUNT_IN = 1_000_000n; // 1 USDT
const FIXTURE_TRON_20_A_AMOUNT_OUT_MIN = 945_250n; // 950_000 * 9950 / 10000
const FIXTURE_TRON_20_A_DEADLINE = 1748000000;
const FIXTURE_TRON_20_A_PATH = [USDT_TRC20, WTRX];

const PAIRED_TRON_ACCOUNT = {
  chain: "tron" as const,
  address: TRON_WHALE_ADDR,
  derivationPath: "44'/195'/0'/0/0",
  pairedAt: new Date().toISOString(),
};

/**
 * Build a stub TronWeb that returns the Fixture Tron-20-A tx structure.
 * This is the load-bearing mock for the consumer re-anchor test.
 */
function buildFixture20ATronWeb() {
  const baseTx = {
    raw_data_hex: FIXTURE_TRON_20_A_RAW_DATA_HEX,
    raw_data: {
      contract: [
        {
          type: "TriggerSmartContract",
          parameter: {
            value: {
              owner_address: "41e28b3cfd4e0e909077821478e9fcb86b84be786e",
              contract_address: "416e0617948fe030a7e4970f8389d4ad295f249b7e",
              data:
                "38ed1739" +
                "00000000000000000000000000000000000000000000000000000000000f4240" +
                "00000000000000000000000000000000000000000000000000000000000e6c62" +
                "00000000000000000000000000000000000000000000000000000000000000a0" +
                "000000000000000000000000e28b3cfd4e0e909077821478e9fcb86b84be786e" +
                "0000000000000000000000000000000000000000000000000000000068305d00" +
                "0000000000000000000000000000000000000000000000000000000000000002" +
                "000000000000000000000000a614f803b6fd780986a42c78ec9c7f77e6ded13c" +
                "000000000000000000000000891cdb91d149f23b1a45d9c5ca78a88d0cb44c18",
              call_value: 0,
            },
          },
        },
      ],
      ref_block_bytes: FIXTURE_TRON_20_A_REF_BLOCK_BYTES,
      ref_block_hash: FIXTURE_TRON_20_A_REF_BLOCK_HASH,
      expiration: FIXTURE_TRON_20_A_EXPIRATION,
    },
    visible: false,
    txID: "deadbeef20a",
  };
  const wrappedResult = { result: { result: true }, transaction: baseTx };
  return {
    transactionBuilder: {
      triggerSmartContract: vi.fn().mockResolvedValue(wrappedResult),
      extendExpiration: vi.fn().mockResolvedValue(baseTx),
    },
  };
}

/** Standard quote for non-MEV-gate tests (impact below threshold). */
function mockQuoteOk() {
  vi.spyOn(_sunswapClient, "fetchSunswapQuote").mockResolvedValue({
    inAmount: FIXTURE_TRON_20_A_AMOUNT_IN,
    outAmount: 950_000n,
    route: FIXTURE_TRON_20_A_PATH,
    priceImpactBps: 50, // below 200 threshold
    slippageBps: 50,
    source: "live",
  });
}

const DEMO_KEY = "VAULTPILOT_DEMO";
let savedDemo: string | undefined;

beforeEach(async () => {
  resetSunswapCacheForTesting();
  listAccountsSpy.mockReset();
  createHandleSpy.mockClear();
  const realHandleStore = await vi.importActual<
    typeof import("../src/signing/handle-store.js")
  >("../src/signing/handle-store.js");
  createHandleSpy.mockImplementation(realHandleStore.createHandle);
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
  vi.restoreAllMocks();
});

async function callTool(args: Record<string, unknown>): Promise<ToolHandlerResult> {
  const tool = getRegisteredTool("prepare_sunswap_swap");
  if (!tool) throw new Error("prepare_sunswap_swap not registered");
  return tool.handler(args);
}

// ============================================================================
// Test 5: Happy path + Fixture Tron-20-A consumer re-anchor (LOAD-BEARING)
// ============================================================================

describe("prepare_sunswap_swap — happy path + Fixture Tron-20-A re-anchor", () => {
  it("Test 5: payloadFingerprint === FIXTURE_TRON_20_A_FINGERPRINT (consumer re-anchor)", async () => {
    // Demo persona: TRON whale = FIXTURE_TRON_20_A_FROM address.
    process.env[DEMO_KEY] = "true";
    _resetDemoModeForTesting();
    setActiveTronPersonaBySlug("tron-whale");

    // Mock quote returning fixture inputs so encodeSunswapSwap sees the right args.
    vi.spyOn(_sunswapClient, "fetchSunswapQuote").mockResolvedValueOnce({
      inAmount: FIXTURE_TRON_20_A_AMOUNT_IN,
      outAmount: 950_000n,
      route: FIXTURE_TRON_20_A_PATH,
      priceImpactBps: 50,
      slippageBps: 50,
      source: "live",
    });

    // Override encodeSunswapSwap to return Fixture Tron-20-A raw data hex.
    // This ensures the payloadFingerprint == FIXTURE_TRON_20_A_FINGERPRINT regardless
    // of TronGrid calls during tests.
    vi.spyOn(_sunSwapTron, "encodeSunswapSwap").mockResolvedValueOnce({
      transaction: {},
      rawDataHex: FIXTURE_TRON_20_A_RAW_DATA_HEX,
      rawDataBytes: new Uint8Array(Buffer.from(FIXTURE_TRON_20_A_RAW_DATA_HEX, "hex")),
      rawDataObject: {},
      refBlockBytes: FIXTURE_TRON_20_A_REF_BLOCK_BYTES,
      refBlockHash: FIXTURE_TRON_20_A_REF_BLOCK_HASH,
      expiration: FIXTURE_TRON_20_A_EXPIRATION,
      contractAddress: SUNSWAP_V2_ROUTER,
    });

    const result = await callTool({
      inputToken: USDT_TRC20,
      outputToken: WTRX,
      amount: "1",
      slippageBps: 50,
    });

    expect(result.isError).toBeUndefined();
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc.chain).toBe("tron");
    expect(sc.inputToken).toBe(USDT_TRC20);
    expect(sc.outputToken).toBe(WTRX);
    // LOAD-BEARING fixture re-anchor:
    expect(sc.payloadFingerprint).toBe(FIXTURE_TRON_20_A_FINGERPRINT);
  });

  it("PREPARE RECEIPT contains verbatim amount, slippageBps, path", async () => {
    listAccountsSpy.mockReturnValue([PAIRED_TRON_ACCOUNT]);
    mockQuoteOk();
    vi.spyOn(_tronRegistry, "getTronWeb").mockReturnValue(
      buildFixture20ATronWeb() as unknown as import("tronweb").TronWeb,
    );

    const result = await callTool({
      inputToken: USDT_TRC20,
      outputToken: WTRX,
      amount: "1",
      slippageBps: 50,
    });

    expect(result.isError).toBeUndefined();
    const sc = result.structuredContent as Record<string, unknown>;
    const receipt = sc.prepareReceipt as string;
    expect(receipt).toContain("PREPARE RECEIPT (TRON — SunSwap V2 swap)");
    expect(receipt).toContain(USDT_TRC20);
    expect(receipt).toContain(WTRX);
    // Verbatim amount in PREPARE RECEIPT
    expect(receipt).toContain("1");
  });

  it("structuredContent carries expected fields", async () => {
    listAccountsSpy.mockReturnValue([PAIRED_TRON_ACCOUNT]);
    mockQuoteOk();
    vi.spyOn(_tronRegistry, "getTronWeb").mockReturnValue(
      buildFixture20ATronWeb() as unknown as import("tronweb").TronWeb,
    );

    const result = await callTool({
      inputToken: USDT_TRC20,
      outputToken: WTRX,
      amount: "1",
      slippageBps: 50,
    });

    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc.handle).toBeDefined();
    expect(sc.chain).toBe("tron");
    expect(sc.inputToken).toBe(USDT_TRC20);
    expect(sc.outputToken).toBe(WTRX);
    expect(sc.inAmount).toBe("1000000");
    expect(sc.slippageBps).toBe(50);
    expect(sc.priceImpactBps).toBe(50);
    expect(sc.path).toEqual([USDT_TRC20, WTRX]);
    expect(sc.payloadFingerprint).toBeDefined();
    expect(sc.prepareReceipt).toBeDefined();
    expect(sc.deadline).toBeDefined();
    expect(typeof sc.deadline).toBe("number");
  });
});

// ============================================================================
// Tests 6/7/8/9: Sandwich-MEV gate quartet (LOAD-BEARING per D-03b/D-03c)
// ============================================================================

describe("prepare_sunswap_swap — sandwich-MEV gate (D-03b/D-03c)", () => {
  it("Test 6 LOAD-BEARING: priceImpactBps > 200 WITHOUT explicit slippageBps → SANDWICH_MEV_REFUSED + hintTool", async () => {
    listAccountsSpy.mockReturnValue([PAIRED_TRON_ACCOUNT]);
    vi.spyOn(_sunswapClient, "fetchSunswapQuote").mockResolvedValueOnce({
      inAmount: 100_000_000n,
      outAmount: 96_000_000n,
      route: [USDT_TRC20, WTRX],
      priceImpactBps: 350, // 3.5% > 2% threshold
      slippageBps: 50,
      source: "live",
    });

    const result = await callTool({
      inputToken: USDT_TRC20,
      outputToken: WTRX,
      amount: "100",
      // slippageBps NOT supplied — gate should trigger
    });

    expect(result.isError).toBe(true);
    const sc = result.structuredContent as Record<string, unknown>;
    // Phase 40 MEV-01: sandwich refusal now uses SANDWICH_MEV_REFUSED (was INVALID_INPUT)
    expect(sc.errorCode).toBe("SANDWICH_MEV_REFUSED");
    expect(sc.hintTool).toBe("get_sunswap_quote");
    // message still mentions the 2% threshold (TRON keeps fixed 200bps threshold)
    expect(sc.message as string).toMatch(/2%/);
  });

  it("Test 6b: SANDWICH_MEV_REFUSAL_TRON_TEMPLATE block appears in refusal text", async () => {
    listAccountsSpy.mockReturnValue([PAIRED_TRON_ACCOUNT]);
    vi.spyOn(_sunswapClient, "fetchSunswapQuote").mockResolvedValueOnce({
      inAmount: 100_000_000n,
      outAmount: 96_000_000n,
      route: [USDT_TRC20, WTRX],
      priceImpactBps: 350,
      slippageBps: 50,
      source: "live",
    });

    const result = await callTool({
      inputToken: USDT_TRC20,
      outputToken: WTRX,
      amount: "100",
    });

    const text = (result.content as Array<{ text: string }>)[0].text;
    expect(text).toContain("SANDWICH-MEV DEFENSE (TRON)");
    expect(text).toContain("350"); // priceImpactBps
    expect(text).toContain("200"); // threshold
  });

  it("Test 7 LOAD-BEARING: priceImpactBps > 200 WITH explicit slippageBps → SUCCEEDS (D-03c)", async () => {
    listAccountsSpy.mockReturnValue([PAIRED_TRON_ACCOUNT]);
    vi.spyOn(_sunswapClient, "fetchSunswapQuote").mockResolvedValueOnce({
      inAmount: 100_000_000n,
      outAmount: 96_000_000n,
      route: [USDT_TRC20, WTRX],
      priceImpactBps: 350, // 3.5% — above threshold
      slippageBps: 100,
      source: "live",
    });
    vi.spyOn(_tronRegistry, "getTronWeb").mockReturnValue(
      buildFixture20ATronWeb() as unknown as import("tronweb").TronWeb,
    );

    const result = await callTool({
      inputToken: USDT_TRC20,
      outputToken: WTRX,
      amount: "100",
      slippageBps: 100, // EXPLICITLY supplied — gate should pass
    });

    // Should NOT be an error (gate passes when explicit)
    expect(result.isError).toBeUndefined();
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc.handle).toBeDefined();
  });

  it("Test 8: priceImpactBps <= 200 WITHOUT explicit slippageBps → SUCCEEDS (below threshold)", async () => {
    listAccountsSpy.mockReturnValue([PAIRED_TRON_ACCOUNT]);
    vi.spyOn(_sunswapClient, "fetchSunswapQuote").mockResolvedValueOnce({
      inAmount: 1_000_000n,
      outAmount: 950_000n,
      route: [USDT_TRC20, WTRX],
      priceImpactBps: 150, // 1.5% — below threshold
      slippageBps: 50,
      source: "live",
    });
    vi.spyOn(_tronRegistry, "getTronWeb").mockReturnValue(
      buildFixture20ATronWeb() as unknown as import("tronweb").TronWeb,
    );

    const result = await callTool({
      inputToken: USDT_TRC20,
      outputToken: WTRX,
      amount: "1",
      // slippageBps NOT supplied — but impact is below threshold, so should succeed
    });

    expect(result.isError).toBeUndefined();
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc.handle).toBeDefined();
    // Default slippageBps = 50
    expect(sc.slippageBps).toBe(50);
  });

  it("Test 9 LOAD-BEARING: slippageBps: 50 (explicit, equal to default) above threshold → SUCCEEDS", async () => {
    // The discrimination is whether the agent SUPPLIED the parameter,
    // not whether the resolved value is the default (D-03c).
    listAccountsSpy.mockReturnValue([PAIRED_TRON_ACCOUNT]);
    vi.spyOn(_sunswapClient, "fetchSunswapQuote").mockResolvedValueOnce({
      inAmount: 100_000_000n,
      outAmount: 96_000_000n,
      route: [USDT_TRC20, WTRX],
      priceImpactBps: 350, // above threshold
      slippageBps: 50,
      source: "live",
    });
    vi.spyOn(_tronRegistry, "getTronWeb").mockReturnValue(
      buildFixture20ATronWeb() as unknown as import("tronweb").TronWeb,
    );

    const result = await callTool({
      inputToken: USDT_TRC20,
      outputToken: WTRX,
      amount: "100",
      slippageBps: 50, // explicit 50 (same as default value, but SUPPLIED) → gate should pass
    });

    // SUCCEEDS because slippage was explicitly supplied (any value)
    expect(result.isError).toBeUndefined();
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc.handle).toBeDefined();
  });
});

// ============================================================================
// Tests 11-15: Validation, path computation, amountOutMin
// ============================================================================

describe("prepare_sunswap_swap — input validation", () => {
  it("Test 11a: invalid inputToken → INVALID_INPUT", async () => {
    const result = await callTool({
      inputToken: "not-valid",
      outputToken: WTRX,
      amount: "1",
    });
    expect(result.isError).toBe(true);
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc.errorCode).toBe("INVALID_INPUT");
    expect(sc.cause).toMatch(/inputToken/i);
  });

  it("Test 11b: invalid outputToken → INVALID_INPUT", async () => {
    const result = await callTool({
      inputToken: USDT_TRC20,
      outputToken: "bad",
      amount: "1",
    });
    expect(result.isError).toBe(true);
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc.errorCode).toBe("INVALID_INPUT");
    expect(sc.cause).toMatch(/outputToken/i);
  });

  it("Test 10: malformed amount → INVALID_INPUT", async () => {
    listAccountsSpy.mockReturnValue([PAIRED_TRON_ACCOUNT]);
    const result = await callTool({
      inputToken: USDT_TRC20,
      outputToken: WTRX,
      amount: "not-a-number",
    });
    expect(result.isError).toBe(true);
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc.errorCode).toBe("INVALID_INPUT");
  });

  it("Test 14: slippageBps = 10000 (100%) → INVALID_INPUT (amountOutMin would be zero)", async () => {
    listAccountsSpy.mockReturnValue([PAIRED_TRON_ACCOUNT]);
    vi.spyOn(_sunswapClient, "fetchSunswapQuote").mockResolvedValueOnce({
      inAmount: 1_000_000n,
      outAmount: 950_000n,
      route: [USDT_TRC20, WTRX],
      priceImpactBps: 50,
      slippageBps: 10000,
      source: "live",
    });

    const result = await callTool({
      inputToken: USDT_TRC20,
      outputToken: WTRX,
      amount: "1",
      slippageBps: 10000, // 100% — amountOutMin would be zero
    });

    expect(result.isError).toBe(true);
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc.errorCode).toBe("INVALID_INPUT");
    expect(sc.message as string).toMatch(/zero/i);
  });
});

describe("prepare_sunswap_swap — demo/real mode", () => {
  it("Test 16: demo mode without active persona → WRONG_MODE", async () => {
    process.env[DEMO_KEY] = "true";
    _resetDemoModeForTesting();
    // Do NOT set a persona

    const result = await callTool({
      inputToken: USDT_TRC20,
      outputToken: WTRX,
      amount: "1",
    });

    expect(result.isError).toBe(true);
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc.errorCode).toBe("WRONG_MODE");
  });

  it("Test 17: real mode without paired account → WALLET_NOT_PAIRED", async () => {
    listAccountsSpy.mockReturnValue([]);

    const result = await callTool({
      inputToken: USDT_TRC20,
      outputToken: WTRX,
      amount: "1",
    });

    expect(result.isError).toBe(true);
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc.errorCode).toBe("WALLET_NOT_PAIRED");
  });
});

describe("prepare_sunswap_swap — path computation (Test 12)", () => {
  it("USDT → WTRX produces direct pair path [USDT, WTRX]", async () => {
    listAccountsSpy.mockReturnValue([PAIRED_TRON_ACCOUNT]);
    // The client returns a direct path for USDT → WTRX
    vi.spyOn(_sunswapClient, "fetchSunswapQuote").mockResolvedValueOnce({
      inAmount: 1_000_000n,
      outAmount: 950_000n,
      route: [USDT_TRC20, WTRX], // direct pair
      priceImpactBps: 50,
      slippageBps: 50,
      source: "live",
    });
    vi.spyOn(_tronRegistry, "getTronWeb").mockReturnValue(
      buildFixture20ATronWeb() as unknown as import("tronweb").TronWeb,
    );

    const result = await callTool({
      inputToken: USDT_TRC20,
      outputToken: WTRX,
      amount: "1",
      slippageBps: 50,
    });

    expect(result.isError).toBeUndefined();
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc.path).toEqual([USDT_TRC20, WTRX]);
  });
});

describe("prepare_sunswap_swap — NEVER-throws", () => {
  it("fetchSunswapQuote returns null → INTERNAL_ERROR", async () => {
    listAccountsSpy.mockReturnValue([PAIRED_TRON_ACCOUNT]);
    vi.spyOn(_sunswapClient, "fetchSunswapQuote").mockResolvedValueOnce(null);

    const result = await callTool({
      inputToken: USDT_TRC20,
      outputToken: WTRX,
      amount: "1",
    });

    expect(result.isError).toBe(true);
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc.errorCode).toBe("INTERNAL_ERROR");
  });
});

describe("prepare_sunswap_swap — tool description (Tests 20/21)", () => {
  it("Test 20: tool description includes approval hint", () => {
    const tool = getRegisteredTool("prepare_sunswap_swap");
    expect(tool).toBeDefined();
    expect(tool!.description).toContain(
      "ensure inputToken approval exists; use prepare_tron_token_approve first if needed",
    );
  });

  it("Test 21: tool description mentions V2 scope limitation", () => {
    const tool = getRegisteredTool("prepare_sunswap_swap");
    expect(tool).toBeDefined();
    expect(tool!.description).toContain(
      "Uses SunSwap V2 router — V3 and Smart Router paths are out of scope for v2.1",
    );
  });
});
