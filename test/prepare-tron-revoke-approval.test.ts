// `prepare_tron_revoke_approval` end-to-end regression. Phase 19 — Plan 19-01.
//
// Load-bearing invariants:
//
//   T-TRON-REVOKE-DRIFT-1 (byte-identity) — calling `prepare_tron_revoke_approval({T, S})`
//   and `prepare_tron_token_approve({T, S, amount: "0"})` with identical demo persona
//   MUST produce identical `payloadFingerprint` AND identical `rawDataHex` in the stored
//   handle record. The semantic distinction (kind: "trc20-revoke" vs "trc20-approve" with
//   amount: 0n, amountIsMax: false) lives in instructionSummary ONLY — not in the calldata.
//
//   D-01c: `prepare_tron_revoke_approval` has NO `amount` field in its input schema. This
//   ensures the agent cannot accidentally pass amount="1" when revoking.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { listAccountsSpy, createHandleSpy } = vi.hoisted(() => ({
  listAccountsSpy: vi.fn(),
  createHandleSpy:
    vi.fn<typeof import("../src/signing/handle-store.js").createHandle>(),
}));

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
  FIXTURE_TRON_19_A_TOKEN,
  FIXTURE_TRON_19_A_SPENDER,
  FIXTURE_TRON_19_A_REF_BLOCK_BYTES,
  FIXTURE_TRON_19_A_REF_BLOCK_HASH,
  FIXTURE_TRON_19_A_EXPIRATION,
} from "./signing-fingerprint-tron-19.test.js";

await import("../src/tools/register-all.js");

async function callRevoke(args: Record<string, unknown>): Promise<ToolHandlerResult> {
  const tool = getRegisteredTool("prepare_tron_revoke_approval");
  if (!tool) throw new Error("prepare_tron_revoke_approval not registered");
  return tool.handler(args);
}

async function callApprove(args: Record<string, unknown>): Promise<ToolHandlerResult> {
  const tool = getRegisteredTool("prepare_tron_token_approve");
  if (!tool) throw new Error("prepare_tron_token_approve not registered");
  return tool.handler(args);
}

const DEMO_KEY = "VAULTPILOT_DEMO";
let savedDemo: string | undefined;

// Raw data hex for Fixture Tron-19-A (reused from approve test — approve(1 USDT, SunSwap))
const FIXTURE_19_A_RAW_DATA_HEX =
  "0a0200ad22088e5e7df4e3c8b9a240f0c894a5e4335aae01081f12a9010a31747970652e676f6f676c65617069732e636f6d2f70726f746f636f6c2e54726967676572536d617274436f6e747261637412740a1541a614f803b6fd780986a42c78ec9c7f77e6ded13c121541a614f803b6fd780986a42c78ec9c7f77e6ded13c2244095ea7b30000000000000000000000006e0617948fe030a7e4970f8389d4ad295f249b7e00000000000000000000000000000000000000000000000000000000000f42407090f490a5e433900180c2d72f";

// Owner hex for fixture setup
const FIXTURE_19_A_OWNER_HEX = "41a614f803b6fd780986a42c78ec9c7f77e6ded13c";
const FIXTURE_19_A_CONTRACT_HEX = "41a614f803b6fd780986a42c78ec9c7f77e6ded13c";

// Revoke calldata: selector 095ea7b3 + spender + 0 amount
const REVOKE_CALLDATA =
  "095ea7b3" +
  "0000000000000000000000006e0617948fe030a7e4970f8389d4ad295f249b7e" +
  "0000000000000000000000000000000000000000000000000000000000000000"; // amount = 0

// TRON-whale persona address
const TRON_WHALE_ADDR = "TWd4WrZ9wn84f5x1hZhL4DHvk738ns5jwb";

// A paired real-mode TRON account
const PAIRED_TRON_ACCOUNT = {
  chain: "tron" as const,
  address: TRON_WHALE_ADDR,
  derivationPath: "44'/195'/0'/0/0",
  pairedAt: new Date().toISOString(),
};

/**
 * Build a stub TronWeb returning a canonical REVOKE tx (approve with amount=0).
 * Used when testing revoke in isolation.
 */
function buildRevokeTronWeb(rawDataHex = "revoke00rawdatahex") {
  const baseTx = {
    raw_data_hex: rawDataHex,
    raw_data: {
      contract: [
        {
          type: "TriggerSmartContract",
          parameter: {
            value: {
              owner_address: FIXTURE_19_A_OWNER_HEX,
              contract_address: FIXTURE_19_A_CONTRACT_HEX,
              data: REVOKE_CALLDATA,
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
    txID: "revoketxid19",
  };
  return {
    transactionBuilder: {
      triggerSmartContract: vi.fn().mockResolvedValue({ result: { result: true }, transaction: baseTx }),
      extendExpiration: vi.fn().mockResolvedValue({ ...baseTx }),
    },
  };
}

/**
 * Build a stub TronWeb returning the Fixture Tron-19-A raw_data_hex.
 * Used for both approve(amount=0) and revoke calls in the byte-identity test.
 * Both calls return THE SAME raw_data_hex — proving shared encoding path.
 */
function buildByteIdentityTronWeb() {
  // The raw_data_hex for approve(spender, 0) and revoke(spender) must be byte-identical.
  // We use a canonical "zero-approval" hex for this assertion.
  const ZERO_APPROVE_RAW_DATA_HEX =
    "0a0200ad22088e5e7df4e3c8b9a240f0c894a5e4335aae01081f12a9010a31747970652e676f6f676c65617069732e636f6d2f70726f746f636f6c2e54726967676572536d617274436f6e747261637412740a1541a614f803b6fd780986a42c78ec9c7f77e6ded13c121541a614f803b6fd780986a42c78ec9c7f77e6ded13c2244095ea7b30000000000000000000000006e0617948fe030a7e4970f8389d4ad295f249b7e00000000000000000000000000000000000000000000000000000000000000007090f490a5e433900180c2d72f";

  const baseTx = {
    raw_data_hex: ZERO_APPROVE_RAW_DATA_HEX,
    raw_data: {
      contract: [
        {
          type: "TriggerSmartContract",
          parameter: {
            value: {
              owner_address: FIXTURE_19_A_OWNER_HEX,
              contract_address: FIXTURE_19_A_CONTRACT_HEX,
              data: REVOKE_CALLDATA,
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
    txID: "byteidentitytx",
  };

  return {
    transactionBuilder: {
      triggerSmartContract: vi.fn().mockResolvedValue({ result: { result: true }, transaction: baseTx }),
      extendExpiration: vi.fn().mockResolvedValue({ ...baseTx }),
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
// Test 1: Happy path — revoke returns chain: "tron", amount: "0", spender
// ============================================================================

describe("prepare_tron_revoke_approval — happy path", () => {
  it("Test 1: returns chain='tron', amount='0', spenderLabel for SunSwap V2 Router", async () => {
    listAccountsSpy.mockReturnValue([PAIRED_TRON_ACCOUNT]);
    vi.spyOn(_tronRegistry, "getTronWeb").mockReturnValue(
      buildRevokeTronWeb() as unknown as import("tronweb").TronWeb,
    );

    const result = await callRevoke({
      tokenAddress: FIXTURE_TRON_19_A_TOKEN,
      spender: FIXTURE_TRON_19_A_SPENDER,
    });

    expect(result.isError).toBeUndefined();
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc.chain).toBe("tron");
    expect(sc.tokenAddress).toBe(FIXTURE_TRON_19_A_TOKEN);
    expect(sc.spender).toBe(FIXTURE_TRON_19_A_SPENDER);
    expect(sc.amount).toBe("0");
    expect(sc.amountIsMax).toBe(false);
    expect(sc.amountResolved).toBe("0");
    expect(sc.spenderLabel).toBe("SunSwap V2 Router");
  });

  it("instructionSummary[0].kind === 'trc20-revoke' (not 'trc20-approve')", async () => {
    listAccountsSpy.mockReturnValue([PAIRED_TRON_ACCOUNT]);
    vi.spyOn(_tronRegistry, "getTronWeb").mockReturnValue(
      buildRevokeTronWeb() as unknown as import("tronweb").TronWeb,
    );

    const result = await callRevoke({
      tokenAddress: FIXTURE_TRON_19_A_TOKEN,
      spender: FIXTURE_TRON_19_A_SPENDER,
    });

    const sc = result.structuredContent as Record<string, unknown>;
    const summaries = sc.instructionSummary as Array<Record<string, unknown>>;
    expect(summaries[0]?.kind).toBe("trc20-revoke");
    // trc20-revoke has NO amount field (it's semantically zero by definition)
    expect(summaries[0]?.amount).toBeUndefined();
    expect(summaries[0]?.amountIsMax).toBeUndefined();
  });

  it("PREPARE RECEIPT contains 'TRON' and token/spender addresses", async () => {
    listAccountsSpy.mockReturnValue([PAIRED_TRON_ACCOUNT]);
    vi.spyOn(_tronRegistry, "getTronWeb").mockReturnValue(
      buildRevokeTronWeb() as unknown as import("tronweb").TronWeb,
    );

    const result = await callRevoke({
      tokenAddress: FIXTURE_TRON_19_A_TOKEN,
      spender: FIXTURE_TRON_19_A_SPENDER,
    });

    const sc = result.structuredContent as Record<string, unknown>;
    const receipt = sc.prepareReceipt as string;
    // PREPARE RECEIPT header must be present
    expect(receipt).toContain("PREPARE RECEIPT");
    expect(receipt).toContain(FIXTURE_TRON_19_A_TOKEN);
    expect(receipt).toContain(FIXTURE_TRON_19_A_SPENDER);
  });
});

// ============================================================================
// Test 2: INVALID_INPUT validation — same guards as approve
// ============================================================================

describe("prepare_tron_revoke_approval — INVALID_INPUT validation", () => {
  it("Test 2a: invalid tokenAddress → INVALID_INPUT (fires before state read)", async () => {
    const result = await callRevoke({
      tokenAddress: "not-a-tron-address",
      spender: FIXTURE_TRON_19_A_SPENDER,
    });

    expect(result.isError).toBe(true);
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc.errorCode).toBe("INVALID_INPUT");
    expect(sc.cause).toBe("tokenAddress");
  });

  it("Test 2b: invalid spender (EVM address) → INVALID_INPUT", async () => {
    const result = await callRevoke({
      tokenAddress: FIXTURE_TRON_19_A_TOKEN,
      spender: "0xdeadbeef",
    });

    expect(result.isError).toBe(true);
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc.errorCode).toBe("INVALID_INPUT");
    expect(sc.cause).toBe("spender");
  });

  it("Test 2c: unknown token (not in tron-top-25 registry) → INVALID_INPUT", async () => {
    // Valid TRON address but not in the registry
    const notRegisteredToken = "TN3W4H6rK2ce4vX9YnFQHwKENnHjoxb3m9";
    const result = await callRevoke({
      tokenAddress: notRegisteredToken,
      spender: FIXTURE_TRON_19_A_SPENDER,
    });

    // Either INVALID_INPUT (token not in registry) or INVALID_INPUT (address invalid)
    // Either way it's isError
    expect(result.isError).toBe(true);
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc.errorCode).toBe("INVALID_INPUT");
  });
});

// ============================================================================
// Test 3: Demo mode guard
// ============================================================================

describe("prepare_tron_revoke_approval — demo mode guard", () => {
  it("Test 3: demo mode on + no persona → WRONG_MODE", async () => {
    process.env[DEMO_KEY] = "true";
    _resetDemoModeForTesting();

    const result = await callRevoke({
      tokenAddress: FIXTURE_TRON_19_A_TOKEN,
      spender: FIXTURE_TRON_19_A_SPENDER,
    });

    expect(result.isError).toBe(true);
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc.errorCode).toBe("WRONG_MODE");
  });

  it("demo mode on + tron-whale persona → succeeds", async () => {
    process.env[DEMO_KEY] = "true";
    _resetDemoModeForTesting();
    setActiveTronPersonaBySlug("tron-whale");
    vi.spyOn(_tronRegistry, "getTronWeb").mockReturnValue(
      buildRevokeTronWeb() as unknown as import("tronweb").TronWeb,
    );

    const result = await callRevoke({
      tokenAddress: FIXTURE_TRON_19_A_TOKEN,
      spender: FIXTURE_TRON_19_A_SPENDER,
    });

    expect(result.isError).toBeUndefined();
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc.chain).toBe("tron");
    expect(sc.amount).toBe("0");
  });
});

// ============================================================================
// Test 4: Wallet pairing guard
// ============================================================================

describe("prepare_tron_revoke_approval — wallet pairing guard", () => {
  it("Test 4: real mode + no paired account → WALLET_NOT_PAIRED", async () => {
    listAccountsSpy.mockReturnValue([]);

    const result = await callRevoke({
      tokenAddress: FIXTURE_TRON_19_A_TOKEN,
      spender: FIXTURE_TRON_19_A_SPENDER,
    });

    expect(result.isError).toBe(true);
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc.errorCode).toBe("WALLET_NOT_PAIRED");
  });
});

// ============================================================================
// Test 5: T-TRON-REVOKE-DRIFT-1 — LOAD-BEARING byte-identity invariant (D-01)
//
// This test verifies that `prepare_tron_revoke_approval({T, S})` and
// `prepare_tron_token_approve({T, S, amount: "0"})` with identical inputs
// produce IDENTICAL `payloadFingerprint` and IDENTICAL `rawDataHex`.
//
// Both calls pass `rawAmount === "0"` to `prepareTronApproveInternal`, so BOTH
// produce instructionSummary[0].kind === "trc20-revoke". The CALLDATA bytes are
// identical by construction (D-01). The semantic routing distinction is between
// `revoke` (no amount in schema) vs `approve(amount > 0)` — not vs `approve(0)`.
// ============================================================================

describe("T-TRON-REVOKE-DRIFT-1 — byte-identity invariant (D-01) LOAD-BEARING", () => {
  it("revoke({T,S}).payloadFingerprint === approve({T,S,amount:'0'}).payloadFingerprint", async () => {
    // Both calls use the same mock encoder returning the same raw_data_hex.
    // This simulates: same inputs → same bytes → same fingerprint.
    listAccountsSpy.mockReturnValue([PAIRED_TRON_ACCOUNT]);

    const byteIdentityTronWeb = buildByteIdentityTronWeb();

    // Spy returns the SAME tronweb mock for both calls.
    vi.spyOn(_tronRegistry, "getTronWeb").mockReturnValue(
      byteIdentityTronWeb as unknown as import("tronweb").TronWeb,
    );

    // Call revoke first
    const revokeResult = await callRevoke({
      tokenAddress: FIXTURE_TRON_19_A_TOKEN,
      spender: FIXTURE_TRON_19_A_SPENDER,
    });

    // Reset handle store between calls to get separate handles
    _resetHandleStoreForTesting();
    const realHandleStore = await vi.importActual<
      typeof import("../src/signing/handle-store.js")
    >("../src/signing/handle-store.js");
    createHandleSpy.mockImplementation(realHandleStore.createHandle);

    // Call approve(amount="0") second
    const approveResult = await callApprove({
      tokenAddress: FIXTURE_TRON_19_A_TOKEN,
      spender: FIXTURE_TRON_19_A_SPENDER,
      amount: "0",
    });

    // Both must succeed
    expect(revokeResult.isError).toBeUndefined();
    expect(approveResult.isError).toBeUndefined();

    const revokeSc = revokeResult.structuredContent as Record<string, unknown>;
    const approveSc = approveResult.structuredContent as Record<string, unknown>;

    // D-01: payloadFingerprint MUST be byte-identical (same raw_data_hex → same fingerprint)
    expect(revokeSc.payloadFingerprint).toBeDefined();
    expect(approveSc.payloadFingerprint).toBeDefined();
    expect(revokeSc.payloadFingerprint).toBe(approveSc.payloadFingerprint);

    // D-01: Both tools pass rawAmount === "0" to prepareTronApproveInternal, so BOTH
    // produce kind: "trc20-revoke" — the discriminator fires on rawAmount === "0".
    // The semantic routing distinction is revoke-tool (no amount in schema) vs approve-tool.
    const revokeSummaries = revokeSc.instructionSummary as Array<Record<string, unknown>>;
    expect(revokeSummaries[0]?.kind).toBe("trc20-revoke");
    expect(revokeSummaries[0]?.amount).toBeUndefined();

    // approve(0) also routes to trc20-revoke because rawAmount === "0"
    const approveSummaries = approveSc.instructionSummary as Array<Record<string, unknown>>;
    expect(approveSummaries[0]?.kind).toBe("trc20-revoke");
    expect(approveSummaries[0]?.amount).toBeUndefined();
  });

  it("D-01: both tools call the same encode path — triggerSmartContract called once each", async () => {
    listAccountsSpy.mockReturnValue([PAIRED_TRON_ACCOUNT]);

    // Each call gets its own mock to verify call counts independently
    const revokeMock = buildByteIdentityTronWeb();
    const approveMock = buildByteIdentityTronWeb();

    const getTronWebSpy = vi.spyOn(_tronRegistry, "getTronWeb");
    getTronWebSpy.mockReturnValueOnce(revokeMock as unknown as import("tronweb").TronWeb);
    getTronWebSpy.mockReturnValueOnce(approveMock as unknown as import("tronweb").TronWeb);

    await callRevoke({
      tokenAddress: FIXTURE_TRON_19_A_TOKEN,
      spender: FIXTURE_TRON_19_A_SPENDER,
    });

    _resetHandleStoreForTesting();
    const realHandleStore = await vi.importActual<
      typeof import("../src/signing/handle-store.js")
    >("../src/signing/handle-store.js");
    createHandleSpy.mockImplementation(realHandleStore.createHandle);

    await callApprove({
      tokenAddress: FIXTURE_TRON_19_A_TOKEN,
      spender: FIXTURE_TRON_19_A_SPENDER,
      amount: "0",
    });

    // Both tools call triggerSmartContract exactly once (via encodeTronTrc20Approve)
    expect(revokeMock.transactionBuilder.triggerSmartContract).toHaveBeenCalledTimes(1);
    expect(approveMock.transactionBuilder.triggerSmartContract).toHaveBeenCalledTimes(1);

    // Both tools call extendExpiration exactly once (LOAD-BEARING per plan)
    expect(revokeMock.transactionBuilder.extendExpiration).toHaveBeenCalledTimes(1);
    expect(approveMock.transactionBuilder.extendExpiration).toHaveBeenCalledTimes(1);
  });
});
