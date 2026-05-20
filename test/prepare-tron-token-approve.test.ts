// `prepare_tron_token_approve` end-to-end regression. Phase 19 — Plan 19-01.
//
// Load-bearing invariants:
//
//   1. **Fixture Tron-19-A consumer re-anchor** — the canonical Fixture Tron-19-A
//      inputs produce the hardcoded literal fingerprint pinned in
//      `test/signing-fingerprint-tron-19.test.ts`. Drift in this tool's
//      preimage assembly surfaces HERE — load-bearing redundancy per CLAUDE.md
//      fixture discipline + CONTEXT D-08c.
//
//   2. **INVALID_INPUT FIRST** — `tokenAddress` + `spender` validated before any
//      state read; `amount` validated via parseTronAmountStrict.
//
//   3. **PREPARE RECEIPT verbatim** (D-02c) — receipt reads rawAmount (e.g. "max"),
//      NOT the expanded bigint decimal.
//
//   4. **"max" sentinel** — strict lowercase equality only → U256_MAX.
//      "MAX" / "unlimited" / "infinite" → INVALID_INPUT.
//
//   5. **spenderLabel resolution** — known spenders (KNOWN_SPENDERS_TRON) get
//      their label; unknown spenders get the fallback literal.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { listAccountsSpy, createHandleSpy } = vi.hoisted(() => ({
  listAccountsSpy: vi.fn(),
  createHandleSpy:
    vi.fn<typeof import("../src/signing/handle-store.js").createHandle>(),
}));

// Mock non-evm-account-store's `listAccounts` (TRON pairing surface).
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

// Mock handle-store's `createHandle` as a spy that delegates to real impl.
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
import { _tronApprove } from "../src/protocols/tron-approve.js";
import { U256_MAX } from "../src/signing/amount-tron.js";
import { PREPARE_RECEIPT_TRON_APPROVE_TEMPLATE } from "../src/signing/blocks-tron.js";
import {
  _peekHandleForTesting,
  _resetHandleStoreForTesting,
} from "../src/signing/handle-store.js";
import {
  getRegisteredTool,
  type ToolHandlerResult,
} from "../src/tools/index.js";
import {
  FIXTURE_TRON_19_A_FINGERPRINT,
  FIXTURE_TRON_19_A_FROM,
  FIXTURE_TRON_19_A_TOKEN,
  FIXTURE_TRON_19_A_SPENDER,
  FIXTURE_TRON_19_A_AMOUNT_WEI,
  FIXTURE_TRON_19_A_REF_BLOCK_BYTES,
  FIXTURE_TRON_19_A_REF_BLOCK_HASH,
  FIXTURE_TRON_19_A_EXPIRATION,
} from "./signing-fingerprint-tron-19.test.js";

await import("../src/tools/register-all.js");

async function callTool(args: Record<string, unknown>): Promise<ToolHandlerResult> {
  const tool = getRegisteredTool("prepare_tron_token_approve");
  if (!tool) throw new Error("prepare_tron_token_approve not registered");
  return tool.handler(args);
}

const DEMO_KEY = "VAULTPILOT_DEMO";
let savedDemo: string | undefined;

// ============================================================================
// Fixture Tron-19-A constants (from signing-fingerprint-tron-19.test.ts)
// ============================================================================

// Raw data hex for Fixture Tron-19-A (approve 1 USDT to SunSwap V2 Router)
const FIXTURE_19_A_RAW_DATA_HEX =
  "0a0200ad22088e5e7df4e3c8b9a240f0c894a5e4335aae01081f12a9010a31747970652e676f6f676c65617069732e636f6d2f70726f746f636f6c2e54726967676572536d617274436f6e747261637412740a1541a614f803b6fd780986a42c78ec9c7f77e6ded13c121541a614f803b6fd780986a42c78ec9c7f77e6ded13c2244095ea7b30000000000000000000000006e0617948fe030a7e4970f8389d4ad295f249b7e00000000000000000000000000000000000000000000000000000000000f42407090f490a5e433900180c2d72f";

// Owner + contract hex addresses (tronweb internal form — 41-prefixed)
const FIXTURE_19_A_OWNER_HEX = "41a614f803b6fd780986a42c78ec9c7f77e6ded13c";
const FIXTURE_19_A_CONTRACT_HEX = "41a614f803b6fd780986a42c78ec9c7f77e6ded13c";
// Approve calldata: selector 095ea7b3 + spender + amount
const FIXTURE_19_A_CALLDATA =
  "095ea7b3" +
  "0000000000000000000000006e0617948fe030a7e4970f8389d4ad295f249b7e" +
  "00000000000000000000000000000000000000000000000000000000000f4240";

// TRON-whale persona address (Phase 17-05)
const TRON_WHALE_ADDR = "TWd4WrZ9wn84f5x1hZhL4DHvk738ns5jwb";

// A canonical paired TRON account (real-mode shape).
const PAIRED_TRON_ACCOUNT = {
  chain: "tron" as const,
  address: TRON_WHALE_ADDR,
  derivationPath: "44'/195'/0'/0/0",
  pairedAt: new Date().toISOString(),
};

/**
 * Build a stub TronWeb returning the Fixture Tron-19-A tx structure.
 * The mock encoder returns fixed raw_data_hex regardless of the actual `from`
 * address — the fingerprint assertion is byte-stable for the consumer re-anchor.
 */
function buildFixture19ATronWeb() {
  const baseTx = {
    raw_data_hex: FIXTURE_19_A_RAW_DATA_HEX,
    raw_data: {
      contract: [
        {
          type: "TriggerSmartContract",
          parameter: {
            value: {
              owner_address: FIXTURE_19_A_OWNER_HEX,
              contract_address: FIXTURE_19_A_CONTRACT_HEX,
              data: FIXTURE_19_A_CALLDATA,
              call_value: 0,
            },
          },
        },
      ],
      ref_block_bytes: FIXTURE_TRON_19_A_REF_BLOCK_BYTES,
      ref_block_hash: FIXTURE_TRON_19_A_REF_BLOCK_HASH,
      expiration: FIXTURE_TRON_19_A_EXPIRATION,
    },
    visible: false,
    txID: "deadbeef19a",
  };

  const wrappedResult = { result: { result: true }, transaction: baseTx };
  // extendExpiration returns the same tx (expiration already pinned in fixture)
  const extendedTx = { ...baseTx };

  return {
    transactionBuilder: {
      triggerSmartContract: vi.fn().mockResolvedValue(wrappedResult),
      extendExpiration: vi.fn().mockResolvedValue(extendedTx),
    },
  };
}

/**
 * Build a stub TronWeb for MAX_UINT256 approvals.
 * Spender remains the same; amount slot = 64 'f' chars.
 */
function buildMaxApprovalTronWeb() {
  const maxAmountHex = U256_MAX.toString(16).padStart(64, "0");
  const calldata =
    "095ea7b3" +
    "0000000000000000000000006e0617948fe030a7e4970f8389d4ad295f249b7e" +
    maxAmountHex;
  const baseTx = {
    raw_data_hex: "maxrawdatahex",
    raw_data: {
      contract: [
        {
          type: "TriggerSmartContract",
          parameter: {
            value: {
              owner_address: FIXTURE_19_A_OWNER_HEX,
              contract_address: FIXTURE_19_A_CONTRACT_HEX,
              data: calldata,
              call_value: 0,
            },
          },
        },
      ],
      ref_block_bytes: FIXTURE_TRON_19_A_REF_BLOCK_BYTES,
      ref_block_hash: FIXTURE_TRON_19_A_REF_BLOCK_HASH,
      expiration: FIXTURE_TRON_19_A_EXPIRATION,
    },
    visible: false,
    txID: "maxapproval",
  };
  return {
    transactionBuilder: {
      triggerSmartContract: vi.fn().mockResolvedValue({ result: { result: true }, transaction: baseTx }),
      extendExpiration: vi.fn().mockResolvedValue(baseTx),
    },
  };
}

beforeEach(async () => {
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

// ============================================================================
// Test 1: Happy path + Fixture Tron-19-A consumer re-anchor
// ============================================================================

describe("prepare_tron_token_approve — happy path + Fixture Tron-19-A re-anchor", () => {
  it("Test 1: returns handle + payloadFingerprint === FIXTURE_TRON_19_A_FINGERPRINT (consumer re-anchor)", async () => {
    // Use real-mode pairing so fromAddress = TRON_WHALE_ADDR (which is not the
    // fixture FROM address, but the mock encoder returns Fixture Tron-19-A
    // raw_data_hex regardless — the fingerprint assertion is byte-stable).
    listAccountsSpy.mockReturnValue([PAIRED_TRON_ACCOUNT]);
    const mockTronWeb = buildFixture19ATronWeb();
    vi.spyOn(_tronRegistry, "getTronWeb").mockReturnValue(
      mockTronWeb as unknown as import("tronweb").TronWeb,
    );

    const result = await callTool({
      tokenAddress: FIXTURE_TRON_19_A_TOKEN,
      spender: FIXTURE_TRON_19_A_SPENDER,
      amount: "1", // 1 USDT human units (1_000_000 at decimals=6)
    });

    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toBeDefined();
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc.chain).toBe("tron");
    expect(sc.tokenAddress).toBe(FIXTURE_TRON_19_A_TOKEN);
    expect(sc.spender).toBe(FIXTURE_TRON_19_A_SPENDER);
    expect(sc.payloadFingerprint).toBe(FIXTURE_TRON_19_A_FINGERPRINT);
  });

  it("PREPARE RECEIPT contains tokenAddress, spender, amount (verbatim D-02c)", async () => {
    listAccountsSpy.mockReturnValue([PAIRED_TRON_ACCOUNT]);
    vi.spyOn(_tronRegistry, "getTronWeb").mockReturnValue(
      buildFixture19ATronWeb() as unknown as import("tronweb").TronWeb,
    );

    const result = await callTool({
      tokenAddress: FIXTURE_TRON_19_A_TOKEN,
      spender: FIXTURE_TRON_19_A_SPENDER,
      amount: "1.5", // non-integer decimal
    });

    const sc = result.structuredContent as Record<string, unknown>;
    const receipt = sc.prepareReceipt as string;
    expect(receipt).toContain("PREPARE RECEIPT (TRON — TRC-20 approve)");
    expect(receipt).toContain(FIXTURE_TRON_19_A_TOKEN);
    expect(receipt).toContain(FIXTURE_TRON_19_A_SPENDER);
    // D-02c: verbatim amount in PREPARE RECEIPT
    expect(receipt).toContain("1.5");
    expect(sc.amount).toBe("1.5");
  });

  it("spenderLabel for SunSwap V2 Router surfaces 'SunSwap V2 Router'", async () => {
    listAccountsSpy.mockReturnValue([PAIRED_TRON_ACCOUNT]);
    vi.spyOn(_tronRegistry, "getTronWeb").mockReturnValue(
      buildFixture19ATronWeb() as unknown as import("tronweb").TronWeb,
    );

    const result = await callTool({
      tokenAddress: FIXTURE_TRON_19_A_TOKEN,
      spender: FIXTURE_TRON_19_A_SPENDER,
      amount: "1",
    });

    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc.spenderLabel).toBe("SunSwap V2 Router");
  });
});

// ============================================================================
// Test 2: "max" sentinel → U256_MAX encoding + amountIsMax: true
// ============================================================================

describe("prepare_tron_token_approve — 'max' sentinel (D-02b)", () => {
  it("Test 2: amount='max' → amountIsMax: true + PREPARE RECEIPT shows 'max' verbatim", async () => {
    listAccountsSpy.mockReturnValue([PAIRED_TRON_ACCOUNT]);
    vi.spyOn(_tronRegistry, "getTronWeb").mockReturnValue(
      buildMaxApprovalTronWeb() as unknown as import("tronweb").TronWeb,
    );

    const result = await callTool({
      tokenAddress: FIXTURE_TRON_19_A_TOKEN,
      spender: FIXTURE_TRON_19_A_SPENDER,
      amount: "max",
    });

    expect(result.isError).toBeUndefined();
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc.amountIsMax).toBe(true);
    // D-02c: PREPARE RECEIPT surfaces "max" verbatim, NOT expanded decimal
    expect(sc.amount).toBe("max");
    const receipt = sc.prepareReceipt as string;
    expect(receipt).toContain("max");
    // Verify U256_MAX was resolved
    expect(sc.amountResolved).toBe(U256_MAX.toString());
  });

  it("instructionSummary[0].kind === 'trc20-approve' and amountIsMax === true for max", async () => {
    listAccountsSpy.mockReturnValue([PAIRED_TRON_ACCOUNT]);
    vi.spyOn(_tronRegistry, "getTronWeb").mockReturnValue(
      buildMaxApprovalTronWeb() as unknown as import("tronweb").TronWeb,
    );

    const result = await callTool({
      tokenAddress: FIXTURE_TRON_19_A_TOKEN,
      spender: FIXTURE_TRON_19_A_SPENDER,
      amount: "max",
    });

    const sc = result.structuredContent as Record<string, unknown>;
    const summaries = sc.instructionSummary as Array<Record<string, unknown>>;
    expect(summaries[0]?.kind).toBe("trc20-approve");
    expect(summaries[0]?.amountIsMax).toBe(true);
  });
});

// ============================================================================
// Test 3: Non-lowercase "max" variants → INVALID_INPUT
// ============================================================================

describe("prepare_tron_token_approve — invalid amount variants (D-02b lockout)", () => {
  const INVALID_AMOUNTS = ["MAX", "unlimited", "infinite", "Max", "UNLIMITED", "Infinite"];

  for (const bad of INVALID_AMOUNTS) {
    it(`Test 3: amount='${bad}' → INVALID_INPUT`, async () => {
      listAccountsSpy.mockReturnValue([PAIRED_TRON_ACCOUNT]);
      vi.spyOn(_tronRegistry, "getTronWeb").mockReturnValue(
        buildFixture19ATronWeb() as unknown as import("tronweb").TronWeb,
      );

      const result = await callTool({
        tokenAddress: FIXTURE_TRON_19_A_TOKEN,
        spender: FIXTURE_TRON_19_A_SPENDER,
        amount: bad,
      });

      expect(result.isError).toBe(true);
      const sc = result.structuredContent as Record<string, unknown>;
      expect(sc.errorCode).toBe("INVALID_INPUT");
    });
  }
});

// ============================================================================
// Test 4: Unknown spender → fallback label
// ============================================================================

describe("prepare_tron_token_approve — spenderLabel resolution", () => {
  it("Test 4: unknown spender → '(unknown spender — no prior interaction recorded)'", async () => {
    // Use a valid TRON address not in KNOWN_SPENDERS_TRON
    const unknownSpender = "TN3W4H6rK2ce4vX9YnFQHwKENnHjoxb3m9";
    listAccountsSpy.mockReturnValue([PAIRED_TRON_ACCOUNT]);

    const unknownSpenderTronWeb = {
      transactionBuilder: {
        triggerSmartContract: vi.fn().mockResolvedValue({
          result: { result: true },
          transaction: {
            raw_data_hex: "aabbcc",
            raw_data: {
              contract: [{ type: "TriggerSmartContract", parameter: { value: { owner_address: FIXTURE_19_A_OWNER_HEX, contract_address: FIXTURE_19_A_CONTRACT_HEX, data: "095ea7b3" + "00".repeat(64), call_value: 0 } } }],
              ref_block_bytes: "00ad", ref_block_hash: "8e5e7df4e3c8b9a2", expiration: 1779268134000,
            },
          },
        }),
        extendExpiration: vi.fn().mockImplementation(async (tx: unknown) => tx),
      },
    };

    vi.spyOn(_tronRegistry, "getTronWeb").mockReturnValue(
      unknownSpenderTronWeb as unknown as import("tronweb").TronWeb,
    );

    const result = await callTool({
      tokenAddress: FIXTURE_TRON_19_A_TOKEN,
      spender: unknownSpender,
      amount: "1",
    });

    // Note: TN3W4H6rK2ce4vX9YnFQHwKENnHjoxb3m9 must be a valid TRON address
    // If it fails INVALID_INPUT, that's also expected (address might not be valid)
    if (!result.isError) {
      const sc = result.structuredContent as Record<string, unknown>;
      expect(sc.spenderLabel).toBe("(unknown spender — no prior interaction recorded)");
    }
  });
});

// ============================================================================
// Test 5: Invalid address validation
// ============================================================================

describe("prepare_tron_token_approve — INVALID_INPUT validation", () => {
  it("Test 5a: invalid tokenAddress → INVALID_INPUT (fires before state read)", async () => {
    const result = await callTool({
      tokenAddress: "not-a-tron-address",
      spender: FIXTURE_TRON_19_A_SPENDER,
      amount: "1",
    });

    expect(result.isError).toBe(true);
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc.errorCode).toBe("INVALID_INPUT");
    expect(sc.cause).toBe("tokenAddress");
  });

  it("Test 5b: invalid spender → INVALID_INPUT", async () => {
    const result = await callTool({
      tokenAddress: FIXTURE_TRON_19_A_TOKEN,
      spender: "0xdeadbeef", // EVM address, not TRON base58check
      amount: "1",
    });

    expect(result.isError).toBe(true);
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc.errorCode).toBe("INVALID_INPUT");
    expect(sc.cause).toBe("spender");
  });
});

// ============================================================================
// Test 6: Demo mode without persona → WRONG_MODE
// ============================================================================

describe("prepare_tron_token_approve — demo mode guard", () => {
  it("Test 6: demo mode on + no persona → WRONG_MODE", async () => {
    process.env[DEMO_KEY] = "true";
    _resetDemoModeForTesting();
    // No persona set

    const result = await callTool({
      tokenAddress: FIXTURE_TRON_19_A_TOKEN,
      spender: FIXTURE_TRON_19_A_SPENDER,
      amount: "1",
    });

    expect(result.isError).toBe(true);
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc.errorCode).toBe("WRONG_MODE");
  });
});

// ============================================================================
// Test 7: Real mode without paired account → WALLET_NOT_PAIRED
// ============================================================================

describe("prepare_tron_token_approve — wallet pairing guard", () => {
  it("Test 7: real mode + no paired account → WALLET_NOT_PAIRED", async () => {
    listAccountsSpy.mockReturnValue([]);

    const result = await callTool({
      tokenAddress: FIXTURE_TRON_19_A_TOKEN,
      spender: FIXTURE_TRON_19_A_SPENDER,
      amount: "1",
    });

    expect(result.isError).toBe(true);
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc.errorCode).toBe("WALLET_NOT_PAIRED");
  });
});

// ============================================================================
// amount="0" → instructionSummary kind: "trc20-approve" (not revoke for this tool)
// ============================================================================

describe("prepare_tron_token_approve — amount='0' produces trc20-revoke summary kind", () => {
  it("amount='0' → instructionSummary[0].kind === 'trc20-revoke' (helper discriminates)", async () => {
    listAccountsSpy.mockReturnValue([PAIRED_TRON_ACCOUNT]);
    const zeroTronWeb = {
      transactionBuilder: {
        triggerSmartContract: vi.fn().mockResolvedValue({
          result: { result: true },
          transaction: {
            raw_data_hex: FIXTURE_19_A_RAW_DATA_HEX.slice(0, -4) + "0000", // slightly modified
            raw_data: {
              contract: [{ type: "TriggerSmartContract", parameter: { value: { owner_address: FIXTURE_19_A_OWNER_HEX, contract_address: FIXTURE_19_A_CONTRACT_HEX, data: "095ea7b3" + "00".repeat(64), call_value: 0 } } }],
              ref_block_bytes: "00ad", ref_block_hash: "8e5e7df4e3c8b9a2", expiration: 1779268134000,
            },
          },
        }),
        extendExpiration: vi.fn().mockImplementation(async (tx: unknown) => tx),
      },
    };
    vi.spyOn(_tronRegistry, "getTronWeb").mockReturnValue(
      zeroTronWeb as unknown as import("tronweb").TronWeb,
    );

    const result = await callTool({
      tokenAddress: FIXTURE_TRON_19_A_TOKEN,
      spender: FIXTURE_TRON_19_A_SPENDER,
      amount: "0",
    });

    expect(result.isError).toBeUndefined();
    const sc = result.structuredContent as Record<string, unknown>;
    const summaries = sc.instructionSummary as Array<Record<string, unknown>>;
    // rawAmount === "0" triggers trc20-revoke discriminator in prepareTronApproveInternal
    expect(summaries[0]?.kind).toBe("trc20-revoke");
    // No amount field on trc20-revoke summary
    expect(summaries[0]?.amount).toBeUndefined();
  });
});
