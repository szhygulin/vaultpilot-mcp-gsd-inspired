// `preview_send` TRON approve/revoke arm regression. Phase 19 — Plan 19-01.
//
// Load-bearing invariants:
//
//   1. preview_send on approve handle → succeeds (no DISPATCH_TARGET_REFUSED, no
//      INTERNAL_ERROR from trc20-transfer guard); returns chain="tron", kind="trc20".
//   2. approve with amountIsMax=true → response text contains UNLIMITED APPROVAL header.
//   3. revoke handle → succeeds; no UNLIMITED APPROVAL block; PREPARE RECEIPT has amount="0".
//   4. approve with non-stablecoin tokenAddress → succeeds (no Layer 0.5 stablecoin gate).
//   5. selector pinned as "0x095ea7b3" (NOT "0xa9059cbb") via transitionToPreviewed.
//   6. shouldEmitTronLedgerNotice returns emit: true for trc20-approve/trc20-revoke;
//      LEDGER NOTICE (TRON) header appears in the response text.
//   7. Back-compat: existing Phase 18 trc20-transfer arm unaffected (no changes to
//      Layer 0.5/0.7 guards).
//   8. Approve arm emits NO_SIMULATION_AVAILABLE advisory (not a refusal — SIMULATION_REFUSED
//      never fires for approve/revoke since the simulation gate is bypassed).
//   9. structuredContent carries previewToken + presignHash + payloadFingerprint.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";

const { listAccountsSpy } = vi.hoisted(() => ({
  listAccountsSpy: vi.fn(),
}));

vi.mock("../src/wallet/non-evm-account-store.js", async () => {
  const actual = await vi.importActual<
    typeof import("../src/wallet/non-evm-account-store.js")
  >("../src/wallet/non-evm-account-store.js");
  return {
    ...actual,
    listAccounts: (...args: Parameters<typeof actual.listAccounts>) =>
      listAccountsSpy(...args),
  };
});

import { _tronRegistry } from "../src/chains/tron/registry.js";
import { _simulationTron } from "../src/signing/simulation-tron.js";
import { computeTronPayloadFingerprint } from "../src/signing/payload-fingerprint-tron.js";
import {
  _resetHandleStoreForTesting,
  createHandle,
  lookup,
  type PreparedTxTron,
} from "../src/signing/handle-store.js";
import {
  getRegisteredTool,
  type ToolHandlerResult,
} from "../src/tools/index.js";
import { U256_MAX } from "../src/signing/amount-tron.js";
import {
  FIXTURE_TRON_19_A_TOKEN,
  FIXTURE_TRON_19_A_SPENDER,
} from "./signing-fingerprint-tron-19.test.js";

await import("../src/tools/register-all.js");

async function callPreviewSend(args: Record<string, unknown>): Promise<ToolHandlerResult> {
  const tool = getRegisteredTool("preview_send");
  if (!tool) throw new Error("preview_send not registered");
  return tool.handler(args);
}

// Test constants
const TRON_WHALE_ADDR = "TWd4WrZ9wn84f5x1hZhL4DHvk738ns5jwb";
const USDT_TRC20_ADDR = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";
const SUNSWAP_V2_ROUTER = "TKzxdSv2FZKQrEqkKVgp5DcwEXBEKMg2Ax";
// A TRON address that is NOT in the 4-stablecoin canonical-dispatch-tron allowlist
const NON_STABLECOIN_TOKEN = "TBkXydBbMASCoD6P42YQ3LQQQMgNUYVSUF";

const APPROVE_RAW_DATA_HEX = "0c".repeat(60);
const APPROVE_EXPIRATION = Date.now() + 900_000;

function buildStubTronWebApprove() {
  const tx = {
    visible: false,
    txID: "approvetxid",
    raw_data: {
      contract: [],
      ref_block_bytes: "00ef",
      ref_block_hash: "cafebabecafebabe",
      expiration: APPROVE_EXPIRATION,
      timestamp: Date.now(),
    },
    raw_data_hex: APPROVE_RAW_DATA_HEX,
  };
  return {
    transactionBuilder: {
      triggerSmartContract: vi.fn(async () => ({ result: { result: true }, transaction: tx })),
      extendExpiration: vi.fn(async (t: unknown) => t),
    },
  };
}

/**
 * Build a prepared approve handle directly in the handle store (bypasses the prepare tool).
 * This is how preview-send tests work: they seed the handle store directly to isolate
 * preview_send behavior from prepare behavior.
 */
function buildApproveHandle(opts: {
  kind?: "trc20-approve" | "trc20-revoke";
  amountIsMax?: boolean;
  tokenAddress?: string;
  spender?: string;
  amount?: string;
} = {}) {
  const {
    kind = "trc20-approve",
    amountIsMax = false,
    tokenAddress = USDT_TRC20_ADDR,
    spender = SUNSWAP_V2_ROUTER,
    amount = amountIsMax ? "max" : "1",
  } = opts;

  const rawDataHex = APPROVE_RAW_DATA_HEX;
  const tronTx: PreparedTxTron = {
    txType: "tron",
    kind: "trc20",
    chainId: 0,
    to: "0x0000000000000000000000000000000000000000" as `0x${string}`,
    valueWei: 0n,
    data: "0x" as `0x${string}`,
    rawDataHex,
    rawDataObject: {
      contract: [],
      ref_block_bytes: "00ef",
      ref_block_hash: "cafebabecafebabe",
      expiration: APPROVE_EXPIRATION,
    },
    refBlockBytes: "00ef",
    refBlockHash: "cafebabecafebabe",
    expiration: APPROVE_EXPIRATION,
    contractAddress: tokenAddress,
    instructionSummary:
      kind === "trc20-revoke"
        ? [
            {
              kind: "trc20-revoke" as const,
              from: TRON_WHALE_ADDR,
              tokenAddress,
              spender,
              spenderLabel: "SunSwap V2 Router",
            },
          ]
        : [
            {
              kind: "trc20-approve" as const,
              from: TRON_WHALE_ADDR,
              tokenAddress,
              spender,
              amount: amountIsMax ? U256_MAX : 1_000_000n,
              amountIsMax,
              spenderLabel: "SunSwap V2 Router",
            },
          ],
  };
  const payloadFingerprint = computeTronPayloadFingerprint({
    rawDataBytes: new Uint8Array(Buffer.from(rawDataHex, "hex")),
  });
  return createHandle({
    tx: tronTx,
    args: {
      to: spender,
      tokenAddress,
      spender,
      amount,
      refBlockBytes: "00ef",
      refBlockHash: "cafebabecafebabe",
      expiration: String(APPROVE_EXPIRATION),
      valueWei: "0",
    },
    payloadFingerprint,
  });
}

beforeEach(() => {
  _resetHandleStoreForTesting();
  listAccountsSpy.mockReset();
  listAccountsSpy.mockReturnValue([
    {
      chain: "tron",
      address: TRON_WHALE_ADDR,
      derivationPath: "44'/195'/0'/0/0",
      pairedAt: new Date().toISOString(),
    },
  ]);
  vi.spyOn(_tronRegistry, "getTronWeb").mockReturnValue(
    buildStubTronWebApprove() as unknown as import("tronweb").TronWeb,
  );
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ============================================================================
// Test 1: Happy path — approve handle succeeds
// ============================================================================

describe("preview_send TRON approve — happy path", () => {
  it("Test 1: approve handle succeeds (no DISPATCH_TARGET_REFUSED, no INTERNAL_ERROR)", async () => {
    const handle = buildApproveHandle();
    const result = await callPreviewSend({ handle });

    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc.chain).toBe("tron");
    expect(sc.kind).toBe("trc20");
    expect(sc.previewToken).toBeTruthy();
    expect(sc.presignHash).toBeTruthy();
    expect(sc.payloadFingerprint).toBeTruthy();
  });

  it("PREPARE RECEIPT header 'PREPARE RECEIPT (TRON — TRC-20 approve)' present in response", async () => {
    const handle = buildApproveHandle();
    const result = await callPreviewSend({ handle });

    expect(result.isError).toBeFalsy();
    const textContent = result.content[0]?.text ?? "";
    expect(textContent).toContain("PREPARE RECEIPT (TRON — TRC-20 approve)");
    expect(textContent).toContain(SUNSWAP_V2_ROUTER);
  });

  it("structuredContent carries previewToken + presignHash + payloadFingerprint (Test 9)", async () => {
    const handle = buildApproveHandle();
    const result = await callPreviewSend({ handle });

    const sc = result.structuredContent as Record<string, unknown>;
    expect(typeof sc.previewToken).toBe("string");
    expect((sc.previewToken as string).length).toBeGreaterThan(10);
    expect(typeof sc.presignHash).toBe("string");
    expect((sc.presignHash as string).startsWith("0x")).toBe(true);
    expect(typeof sc.payloadFingerprint).toBe("string");
  });

  it("presignHash = SHA-256(rawDataBytes) — byte identity (Test 9)", async () => {
    const handle = buildApproveHandle();
    const result = await callPreviewSend({ handle });

    const sc = result.structuredContent as Record<string, unknown>;
    const expectedHash =
      "0x" +
      createHash("sha256")
        .update(Buffer.from(APPROVE_RAW_DATA_HEX, "hex"))
        .digest("hex");
    expect(sc.presignHash).toBe(expectedHash);
  });
});

// ============================================================================
// Test 2: UNLIMITED_APPROVAL_TRON_TEMPLATE emitted when amountIsMax === true
// ============================================================================

describe("preview_send TRON approve — unlimited approval block (Test 2)", () => {
  it("amountIsMax=true → response contains '⚠ UNLIMITED APPROVAL (TRON)' header", async () => {
    const handle = buildApproveHandle({ amountIsMax: true });
    const result = await callPreviewSend({ handle });

    expect(result.isError).toBeFalsy();
    const textContent = result.content[0]?.text ?? "";
    expect(textContent).toContain("⚠ UNLIMITED APPROVAL (TRON)");
    expect(textContent).toContain(USDT_TRC20_ADDR);
    expect(textContent).toContain(SUNSWAP_V2_ROUTER);
  });

  it("amountIsMax=false → response does NOT contain '⚠ UNLIMITED APPROVAL (TRON)' header", async () => {
    const handle = buildApproveHandle({ amountIsMax: false, amount: "1" });
    const result = await callPreviewSend({ handle });

    expect(result.isError).toBeFalsy();
    const textContent = result.content[0]?.text ?? "";
    expect(textContent).not.toContain("⚠ UNLIMITED APPROVAL (TRON)");
  });
});

// ============================================================================
// Test 3: Revoke handle — succeeds, no UNLIMITED block, amount="0" in PREPARE RECEIPT
// ============================================================================

describe("preview_send TRON revoke — happy path (Test 3)", () => {
  it("revoke handle succeeds; response does NOT contain '⚠ UNLIMITED APPROVAL (TRON)'", async () => {
    const handle = buildApproveHandle({ kind: "trc20-revoke", amount: "0" });
    const result = await callPreviewSend({ handle });

    expect(result.isError).toBeFalsy();
    const textContent = result.content[0]?.text ?? "";
    expect(textContent).not.toContain("⚠ UNLIMITED APPROVAL (TRON)");
    // PREPARE RECEIPT should still render (approve template is used for revoke too)
    expect(textContent).toContain("PREPARE RECEIPT (TRON — TRC-20 approve)");
  });

  it("revoke PREPARE RECEIPT has amount='0' from stored args", async () => {
    const handle = buildApproveHandle({ kind: "trc20-revoke", amount: "0" });
    const result = await callPreviewSend({ handle });

    const textContent = result.content[0]?.text ?? "";
    // The PREPARE RECEIPT template shows amount verbatim — should show "0"
    expect(textContent).toContain("amount:         0");
  });
});

// ============================================================================
// Test 4: Non-stablecoin tokenAddress → SUCCEEDS (no Layer 0.5 stablecoin gate)
// ============================================================================

describe("preview_send TRON approve — non-stablecoin token succeeds (Test 4)", () => {
  it("approve with non-stablecoin tokenAddress → succeeds (Layer 0.5 bypassed)", async () => {
    const handle = buildApproveHandle({ tokenAddress: NON_STABLECOIN_TOKEN });
    const result = await callPreviewSend({ handle });

    // Must succeed — approve/revoke bypass Layer 0.5 stablecoin allowlist
    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc.chain).toBe("tron");
    expect(sc.previewToken).toBeTruthy();
  });
});

// ============================================================================
// Test 5: Selector pinned as "0x095ea7b3" (NOT "0xa9059cbb")
// ============================================================================

describe("preview_send TRON approve — selector pinned correctly (Test 5)", () => {
  it("selector in post-transitionToPreviewed record is '0x095ea7b3'", async () => {
    const handle = buildApproveHandle();
    const result = await callPreviewSend({ handle });

    expect(result.isError).toBeFalsy();

    // Verify via the handle store lookup post-preview
    const lookupResult = lookup(handle);
    expect(lookupResult.ok).toBe(true);
    if (lookupResult.ok) {
      const pinned = lookupResult.record.pinned;
      expect(pinned).not.toBeNull();
      expect(pinned?.selector).toBe("0x095ea7b3");
    }
  });

  it("selector '0xa9059cbb' (transfer) does NOT appear for approve handles", async () => {
    const handle = buildApproveHandle();
    await callPreviewSend({ handle });

    const lookupResult = lookup(handle);
    if (lookupResult.ok) {
      expect(lookupResult.record.pinned?.selector).not.toBe("0xa9059cbb");
    }
  });
});

// ============================================================================
// Test 6: LEDGER NOTICE (TRON) emitted for approve/revoke (blind-sign UX defense)
// ============================================================================

describe("preview_send TRON approve — LEDGER NOTICE emitted (Test 6)", () => {
  it("approve handle → response contains 'LEDGER NOTICE (TRON)' header", async () => {
    const handle = buildApproveHandle();
    const result = await callPreviewSend({ handle });

    expect(result.isError).toBeFalsy();
    const textContent = result.content[0]?.text ?? "";
    // LEDGER_NOTICE_TRON_TEMPLATE header
    expect(textContent).toContain("LEDGER NOTICE (TRON)");
  });

  it("revoke handle → response contains 'LEDGER NOTICE (TRON)' header", async () => {
    const handle = buildApproveHandle({ kind: "trc20-revoke", amount: "0" });
    const result = await callPreviewSend({ handle });

    expect(result.isError).toBeFalsy();
    const textContent = result.content[0]?.text ?? "";
    expect(textContent).toContain("LEDGER NOTICE (TRON)");
  });

  it("approve: instructionName is 'TRC-20 approve' in LEDGER NOTICE", async () => {
    const handle = buildApproveHandle();
    const result = await callPreviewSend({ handle });

    const textContent = result.content[0]?.text ?? "";
    expect(textContent).toContain("TRC-20 approve");
  });

  it("revoke: instructionName is 'TRC-20 revoke' in LEDGER NOTICE", async () => {
    const handle = buildApproveHandle({ kind: "trc20-revoke", amount: "0" });
    const result = await callPreviewSend({ handle });

    const textContent = result.content[0]?.text ?? "";
    expect(textContent).toContain("TRC-20 revoke");
  });
});

// ============================================================================
// Test 8: NO_SIMULATION_AVAILABLE advisory — approve/revoke never SIMULATION_REFUSED
// ============================================================================

describe("preview_send TRON approve — no simulation (Test 8)", () => {
  it("approve handle: simulation status is 'not-applicable' in structuredContent", async () => {
    const handle = buildApproveHandle();
    const result = await callPreviewSend({ handle });

    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as Record<string, unknown>;
    const sim = sc.simulation as { status: string } | undefined;
    expect(sim?.status).toBe("not-applicable");
  });

  it("response text contains no-simulation advisory (TRON)", async () => {
    const handle = buildApproveHandle();
    const result = await callPreviewSend({ handle });

    const textContent = result.content[0]?.text ?? "";
    // NO_SIMULATION_AVAILABLE_TRON_TEMPLATE header
    expect(textContent).toMatch(/CHECKS PERFORMED.*TRON.*no simulation/i);
  });

  it("SIMULATION_REFUSED never fires for approve (runTronPreviewSimulation not called)", async () => {
    const runSimSpy = vi.spyOn(_simulationTron, "runTronPreviewSimulation");
    const handle = buildApproveHandle();
    await callPreviewSend({ handle });

    // The approve arm bypasses Layer 0.7 entirely — simulation spy NOT called
    expect(runSimSpy).not.toHaveBeenCalled();
  });
});

// ============================================================================
// Test 7: Back-compat — trc20-transfer handle still works (Layer 0.5/0.7 arms unchanged)
// ============================================================================

describe("preview_send TRON — back-compat: trc20-transfer arm unchanged (Test 7)", () => {
  it("trc20-transfer handle still routes to transfer arm (Layer 0.5 + Layer 0.7 guards intact)", async () => {
    // Build a trc20-transfer handle (Phase 18 shape)
    const rawDataHex = "0b".repeat(60);
    const tronTx: PreparedTxTron = {
      txType: "tron",
      kind: "trc20",
      chainId: 0,
      to: "0x0000000000000000000000000000000000000000" as `0x${string}`,
      valueWei: 0n,
      data: "0x" as `0x${string}`,
      rawDataHex,
      rawDataObject: {
        contract: [],
        ref_block_bytes: "00cd",
        ref_block_hash: "abcdef1234567890",
        expiration: Date.now() + 900_000,
      },
      refBlockBytes: "00cd",
      refBlockHash: "abcdef1234567890",
      expiration: Date.now() + 900_000,
      contractAddress: USDT_TRC20_ADDR,
      instructionSummary: [
        {
          kind: "trc20-transfer" as const,
          from: TRON_WHALE_ADDR,
          to: "TEkxiTehnzSmSe2XqrBj4w32RUN966rdz8",
          amount: 100_000_000n,
          tokenAddress: USDT_TRC20_ADDR,
          decimals: 6,
          symbol: "USDT",
        },
      ],
    };
    const payloadFingerprint = computeTronPayloadFingerprint({
      rawDataBytes: new Uint8Array(Buffer.from(rawDataHex, "hex")),
    });
    const handle = createHandle({
      tx: tronTx,
      args: { to: "TEkxiTehnzSmSe2XqrBj4w32RUN966rdz8", tokenAddress: USDT_TRC20_ADDR, amount: "100", valueWei: "0" },
      payloadFingerprint,
    });

    // Stub the allowlist check and simulation for the transfer arm
    const { _canonicalDispatchTron } = await import("../src/security/canonical-dispatch-tron.js");
    vi.spyOn(_canonicalDispatchTron, "checkTronDispatchTarget").mockReturnValue({ kind: "allowed" });
    vi.spyOn(_simulationTron, "runTronPreviewSimulation").mockResolvedValue({
      status: "ok",
      revertReason: null,
      energyUsed: 31895n,
      constantResult: ["0000000000000000000000000000000000000000000000000000000000000001"],
    });

    const result = await callPreviewSend({ handle });

    // The transfer handle must succeed (back-compat) — the approve/revoke arm
    // does NOT capture kind="trc20-transfer" handles
    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc.chain).toBe("tron");
    expect(sc.kind).toBe("trc20");
    expect(sc.previewToken).toBeTruthy();
  });
});
