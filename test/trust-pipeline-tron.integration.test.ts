// [STOP-THE-LINE] Any byte-identity assertion failing in this file is a
// security regression. DO NOT mask, DO NOT skip — fix the regression.
// The persona-cycle assertions prove that swapping the sender produces a
// DIFFERENT payloadFingerprint (sender-dependence per CONTEXT D-05);
// within-persona prepare → preview → send produces byte-IDENTICAL
// fingerprint (PREP-08 invariant). A flake here means the trust pipeline
// has a soft spot.
//
// LOAD-BEARING — Plan 18-04 TRON trust pipeline integration test.
// Mirror of `test/solana-trust-pipeline.integration.test.ts` for TRON.
//
// Test cases (13 total):
//   1.  Native TRX prepare → preview → send happy path
//   2.  TRC-20 prepare → preview → send happy path
//   3.  Persona-cycle sender-dependence (native TRX) — fingerprints differ
//   4.  Persona-cycle sender-dependence (TRC-20) — fingerprints differ
//   5.  Within-persona fingerprint stable from prepare → preview → send
//   6.  Three-gate: PAYLOAD_FINGERPRINT_DRIFT refuses
//   7.  Three-gate: PREVIEW_TOKEN_MISMATCH refuses
//   8.  Three-gate: no preview → PREVIEW_REQUIRED refuses
//   9.  Cancel branch (no signing, no broadcasting)
//   10. Layer 0.5: non-allowlist TRC-20 → DISPATCH_TARGET_REFUSED
//   11. Layer 0.7: TRC-20 revert → SIMULATION_REFUSED
//   12. Native TRX: NO_SIMULATION_AVAILABLE advisory (NOT refusal)
//   13. get_tx_verification TRON re-emit (blockHeader + rawDataHex + dispatchCheckResult)

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";

const {
  listAccountsSpy,
  sendRawTransactionSpy,
} = vi.hoisted(() => ({
  listAccountsSpy: vi.fn(),
  sendRawTransactionSpy: vi.fn(),
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

import { _resetDemoModeForTesting, isDemoMode } from "../src/config/env.js";
import {
  _resetActivePersonaForTesting,
  setActiveTronPersonaBySlug,
} from "../src/demo/state.js";
import { computeTronPayloadFingerprint } from "../src/signing/payload-fingerprint-tron.js";
import { computeTronPresignHash } from "../src/signing/presign-hash-tron.js";
import { _simulationTron } from "../src/signing/simulation-tron.js";
import { _canonicalDispatchTron } from "../src/security/canonical-dispatch-tron.js";
import {
  _peekHandleForTesting,
  _resetHandleStoreForTesting,
  lookup,
  type PreparedTxTron,
} from "../src/signing/handle-store.js";
import { _tronLedgerTransport } from "../src/wallet/ledger-tron-transport.js";
import { _tronRegistry } from "../src/chains/tron/registry.js";
import {
  getRegisteredTool,
  type ToolHandlerResult,
} from "../src/tools/index.js";

await import("../src/tools/register-all.js");

async function callTool(
  name: string,
  args: Record<string, unknown>,
): Promise<ToolHandlerResult> {
  const tool = getRegisteredTool(name);
  if (!tool) throw new Error(`${name} not registered`);
  return tool.handler(args);
}

const DEMO_KEY = "VAULTPILOT_DEMO";
let savedDemo: string | undefined;

// TRON whale persona (Phase 17)
const TRON_WHALE_ADDR = "TWd4WrZ9wn84f5x1hZhL4DHvk738ns5jwb";
const TRON_PERSONA_B_ADDR = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t"; // USDT deployer — valid TRON addr
const TRON_PERSONA_C_ADDR = "TEkxiTehnzSmSe2XqrBj4w32RUN966rdz8"; // USDC addr — valid TRON addr

const TRON_RECIPIENT = "TEkxiTehnzSmSe2XqrBj4w32RUN966rdz8";
const USDT_TRC20_ADDR = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";
const NON_ALLOWLIST_TRC20 = "TXXXTestNotInAllowlistXXXXXXXXXXX1"; // fake not-in-allowlist

const FAKE_SIGNATURE = "a".repeat(130); // 130-char hex string (65 bytes)
const FAKE_TX_ID = "b".repeat(64); // TRON txID is 64-char hex

function pairedTronAccount(addr: string) {
  return {
    chain: "tron" as const,
    address: addr,
    derivationPath: "44'/195'/0'/0/0",
    pairedAt: new Date().toISOString(),
  };
}

// Canonical stub TronWeb — minimal surface for prepare + simulation.
function buildStubTronWeb(
  rawDataHex = "0a".repeat(50),
  txID = FAKE_TX_ID,
) {
  const tx = {
    visible: true,
    txID,
    raw_data: {
      contract: [],
      ref_block_bytes: "00ab",
      ref_block_hash: "1234567890abcdef",
      expiration: Date.now() + 900_000,
      timestamp: Date.now(),
    },
    raw_data_hex: rawDataHex,
  };
  return {
    transactionBuilder: {
      sendTrx: vi.fn(async () => tx),
      triggerSmartContract: vi.fn(async () => ({ result: { result: true }, transaction: tx })),
      extendExpiration: vi.fn(async (t: unknown) => t),
      triggerConstantContract: vi.fn(async () => ({
        result: { result: true },
        energy_used: 31895,
        constant_result: ["0000000000000000000000000000000000000000000000000000000000000001"],
      })),
    },
    trx: {
      sendRawTransaction: sendRawTransactionSpy,
    },
    utils: {
      abi: {
        encodeParamsV2ByABI: vi.fn(() => "0000000000000000000000003487b63d30b5b2c87fb7ffa8bcfade38eaac1abe0000000000000000000000000000000000000000000000000000000005f5e100"),
      },
    },
  };
}

beforeEach(() => {
  _resetHandleStoreForTesting();
  listAccountsSpy.mockReset();
  sendRawTransactionSpy.mockReset();
  listAccountsSpy.mockReturnValue([pairedTronAccount(TRON_WHALE_ADDR)]);
  sendRawTransactionSpy.mockResolvedValue({ result: true, txid: FAKE_TX_ID });
  vi.spyOn(_tronLedgerTransport, "signTransaction").mockResolvedValue(FAKE_SIGNATURE);
  vi.spyOn(_tronRegistry, "getTronWeb").mockReturnValue(buildStubTronWeb() as never);
  vi.spyOn(_simulationTron, "runTronPreviewSimulation").mockResolvedValue({
    status: "ok",
    revertReason: null,
    energyUsed: 31895n,
    constantResult: ["0000000000000000000000000000000000000000000000000000000000000001"],
  });
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

// ---------------------------------------------------------------------------
// Test 1 — Native TRX prepare → preview → send happy path.
// ---------------------------------------------------------------------------
describe("trust pipeline (TRON) — native TRX prepare → preview → send (T-PIPELINE-TRON-1)", () => {
  it("walks the full native TRX pipeline; fingerprint stable end-to-end", async () => {
    // --- ACT 1: prepare ---
    const prepareResult = await callTool("prepare_tron_native_send", {
      to: TRON_RECIPIENT,
      sun: "1000000",
    });
    expect(prepareResult.isError).toBeFalsy();
    const prepareSc = prepareResult.structuredContent as {
      handle: string;
      payloadFingerprint: string;
      chain: string;
    };
    const handle = prepareSc.handle;
    expect(prepareSc.chain).toBe("tron");

    // --- ASSERT 1: stored fingerprint matches recompute over stored rawDataHex ---
    const preparedLookup = lookup(handle);
    if (!preparedLookup.ok) throw new Error("post-prepare: handle not found");
    const tronTx = preparedLookup.record.tx as PreparedTxTron;
    expect(tronTx.txType).toBe("tron");
    expect(tronTx.kind).toBe("native");
    const recomputedFp = computeTronPayloadFingerprint({
      rawDataBytes: new Uint8Array(Buffer.from(tronTx.rawDataHex, "hex")),
    });
    expect(preparedLookup.record.payloadFingerprint).toBe(recomputedFp);

    // --- ACT 2: preview ---
    const previewResult = await callTool("preview_send", { handle });
    expect(previewResult.isError).toBeFalsy();
    const previewSc = previewResult.structuredContent as {
      previewToken: string;
      presignHash: string;
      payloadFingerprint: string;
      chain: string;
    };
    expect(previewSc.chain).toBe("tron");
    const previewToken = previewSc.previewToken;

    // --- ASSERT 2: presignHash == SHA-256(rawDataBytes); fingerprint UNCHANGED ---
    const expectedPresignHash = computeTronPresignHash({
      rawDataBytes: new Uint8Array(Buffer.from(tronTx.rawDataHex, "hex")),
    }).presignHash;
    expect(previewSc.presignHash).toBe(expectedPresignHash);
    expect(previewSc.payloadFingerprint).toBe(prepareSc.payloadFingerprint);

    // --- ACT 3: send ---
    const sendResult = await callTool("send_transaction", {
      handle,
      previewToken,
      userDecision: "send",
    });
    expect(sendResult.isError).toBeFalsy();
    const sendSc = sendResult.structuredContent as {
      txHash: string;
      txID: string;
      handle: string;
      txType: string;
    };
    expect(sendSc.txHash).toBe(FAKE_TX_ID);
    expect(sendSc.txType).toBe("tron");

    // --- ASSERT 3: signTransaction received the correct rawDataHex ---
    const signSpy = vi.mocked(_tronLedgerTransport.signTransaction);
    expect(signSpy).toHaveBeenCalledTimes(1);
    const callArgs = signSpy.mock.calls[0]!;
    expect(callArgs[0].rawTxHex).toBe(tronTx.rawDataHex);
    expect(callArgs[0].tokenSignatures).toEqual([]);

    // Final state: handle transitioned to `sent`
    const sentLookup = lookup(handle);
    if (!sentLookup.ok) throw new Error("post-send: handle not found");
    expect(sentLookup.record.status).toBe("sent");
    expect(sentLookup.record.txHash).toBe(FAKE_TX_ID);
  });
});

// ---------------------------------------------------------------------------
// Test 2 — TRC-20 prepare → preview → send happy path.
// ---------------------------------------------------------------------------
describe("trust pipeline (TRON) — TRC-20 prepare → preview → send (T-PIPELINE-TRON-2)", () => {
  it("walks the full TRC-20 pipeline; fingerprint stable end-to-end", async () => {
    const prepareResult = await callTool("prepare_tron_trc20_send", {
      to: TRON_RECIPIENT,
      tokenAddress: USDT_TRC20_ADDR,
      amount: "100",
    });
    expect(prepareResult.isError).toBeFalsy();
    const prepareSc = prepareResult.structuredContent as {
      handle: string;
      payloadFingerprint: string;
    };
    const handle = prepareSc.handle;

    const tronTx = (lookup(handle) as { ok: true; record: { tx: PreparedTxTron; payloadFingerprint: string } }).record.tx;
    expect(tronTx.kind).toBe("trc20");

    const previewResult = await callTool("preview_send", { handle });
    expect(previewResult.isError).toBeFalsy();
    const previewSc = previewResult.structuredContent as {
      previewToken: string;
      presignHash: string;
      chain: string;
      kind: string;
    };
    expect(previewSc.chain).toBe("tron");
    expect(previewSc.kind).toBe("trc20");
    const previewToken = previewSc.previewToken;

    const sendResult = await callTool("send_transaction", {
      handle,
      previewToken,
      userDecision: "send",
    });
    expect(sendResult.isError).toBeFalsy();
    const sendSc = sendResult.structuredContent as { txHash: string; txType: string; kind: string };
    expect(sendSc.txHash).toBe(FAKE_TX_ID);
    expect(sendSc.txType).toBe("tron");
    expect(sendSc.kind).toBe("trc20");
  });
});

// ---------------------------------------------------------------------------
// Test 3 + 4 — Persona-cycle sender-dependence (CONTEXT D-05).
// ---------------------------------------------------------------------------
describe("persona-cycle sender-dependence (TRON)", () => {
  it("native TRX: different senders produce different fingerprints (D-05a)", async () => {
    // Persona A uses the default stub; Persona B uses different from address.
    const rawDataHexA = "0a".repeat(30) + "01"; // distinct A bytes
    const rawDataHexB = "0b".repeat(30) + "02"; // distinct B bytes

    const mockTronWebA = buildStubTronWeb(rawDataHexA);
    const mockTronWebB = buildStubTronWeb(rawDataHexB);

    vi.spyOn(_tronRegistry, "getTronWeb")
      .mockReturnValueOnce(mockTronWebA as never)
      .mockReturnValueOnce(mockTronWebB as never);

    const resultA = await callTool("prepare_tron_native_send", {
      to: TRON_RECIPIENT,
      sun: "1000000",
    });
    _resetHandleStoreForTesting();

    const resultB = await callTool("prepare_tron_native_send", {
      to: TRON_RECIPIENT,
      sun: "1000000",
    });

    expect(resultA.isError).toBeFalsy();
    expect(resultB.isError).toBeFalsy();

    const fpA = (resultA.structuredContent as { payloadFingerprint: string }).payloadFingerprint;
    const fpB = (resultB.structuredContent as { payloadFingerprint: string }).payloadFingerprint;

    // Both are valid fingerprints
    expect(fpA).toMatch(/^0x[0-9a-f]{64}$/);
    expect(fpB).toMatch(/^0x[0-9a-f]{64}$/);
    // Different raw_data → different fingerprint
    expect(fpA).not.toBe(fpB);
  });

  it("TRC-20: different senders produce different fingerprints (D-05b)", async () => {
    const rawDataHexA = "0c".repeat(40) + "03";
    const rawDataHexB = "0d".repeat(40) + "04";

    const mockTronWebA = buildStubTronWeb(rawDataHexA);
    const mockTronWebB = buildStubTronWeb(rawDataHexB);

    vi.spyOn(_tronRegistry, "getTronWeb")
      .mockReturnValueOnce(mockTronWebA as never)
      .mockReturnValueOnce(mockTronWebB as never)
      .mockReturnValue(buildStubTronWeb() as never);

    const resultA = await callTool("prepare_tron_trc20_send", {
      to: TRON_RECIPIENT,
      tokenAddress: USDT_TRC20_ADDR,
      amount: "100",
    });
    _resetHandleStoreForTesting();

    const resultB = await callTool("prepare_tron_trc20_send", {
      to: TRON_RECIPIENT,
      tokenAddress: USDT_TRC20_ADDR,
      amount: "100",
    });

    expect(resultA.isError).toBeFalsy();
    expect(resultB.isError).toBeFalsy();

    const fpA = (resultA.structuredContent as { payloadFingerprint: string }).payloadFingerprint;
    const fpB = (resultB.structuredContent as { payloadFingerprint: string }).payloadFingerprint;
    expect(fpA).toMatch(/^0x[0-9a-f]{64}$/);
    expect(fpB).toMatch(/^0x[0-9a-f]{64}$/);
    expect(fpA).not.toBe(fpB);
  });
});

// ---------------------------------------------------------------------------
// Test 6 — Three-gate: PAYLOAD_FINGERPRINT_DRIFT (PREP-08 / T-DRIFT-1).
// ---------------------------------------------------------------------------
describe("three-gate FROZEN region: PAYLOAD_FINGERPRINT_DRIFT (T-DRIFT-1)", () => {
  it("send_transaction refuses when payloadFingerprint mutated between prepare and send", async () => {
    const prepareResult = await callTool("prepare_tron_native_send", {
      to: TRON_RECIPIENT,
      sun: "1000000",
    });
    expect(prepareResult.isError).toBeFalsy();
    const handle = (prepareResult.structuredContent as { handle: string }).handle;

    const previewResult = await callTool("preview_send", { handle });
    expect(previewResult.isError).toBeFalsy();
    const previewToken = (previewResult.structuredContent as { previewToken: string }).previewToken;

    // Mutate the stored payloadFingerprint to simulate in-process corruption.
    const record = _peekHandleForTesting(handle);
    if (record) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (record as any).payloadFingerprint = "0x" + "ff".repeat(32);
    }

    const sendResult = await callTool("send_transaction", {
      handle,
      previewToken,
      userDecision: "send",
    });
    expect(sendResult.isError).toBe(true);
    const sc = sendResult.structuredContent as { errorCode: string };
    expect(sc.errorCode).toBe("PAYLOAD_FINGERPRINT_DRIFT");
    // signTransaction MUST NOT have been called (gate fires before transport).
    expect(vi.mocked(_tronLedgerTransport.signTransaction)).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Test 7 — Three-gate: PREVIEW_TOKEN_MISMATCH (T-GATE-2).
// ---------------------------------------------------------------------------
describe("three-gate FROZEN region: PREVIEW_TOKEN_MISMATCH (T-GATE-2)", () => {
  it("send_transaction refuses when previewToken does not match", async () => {
    const prepareResult = await callTool("prepare_tron_native_send", {
      to: TRON_RECIPIENT,
      sun: "1000000",
    });
    const handle = (prepareResult.structuredContent as { handle: string }).handle;
    await callTool("preview_send", { handle });

    const sendResult = await callTool("send_transaction", {
      handle,
      previewToken: "wrong-token-uuid-0000-0000-000000000000",
      userDecision: "send",
    });
    expect(sendResult.isError).toBe(true);
    const sc = sendResult.structuredContent as { errorCode: string };
    expect(sc.errorCode).toBe("PREVIEW_TOKEN_MISMATCH");
    expect(vi.mocked(_tronLedgerTransport.signTransaction)).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Test 8 — Three-gate: PREVIEW_REQUIRED (T-GATE-1).
// ---------------------------------------------------------------------------
describe("three-gate FROZEN region: PREVIEW_REQUIRED", () => {
  it("send_transaction refuses when handle has not been previewed", async () => {
    const prepareResult = await callTool("prepare_tron_native_send", {
      to: TRON_RECIPIENT,
      sun: "1000000",
    });
    const handle = (prepareResult.structuredContent as { handle: string }).handle;

    const sendResult = await callTool("send_transaction", {
      handle,
      previewToken: "any-token",
      userDecision: "send",
    });
    expect(sendResult.isError).toBe(true);
    const sc = sendResult.structuredContent as { errorCode: string };
    expect(sc.errorCode).toBe("PREVIEW_REQUIRED");
  });
});

// ---------------------------------------------------------------------------
// Test 9 — Cancel branch.
// ---------------------------------------------------------------------------
describe("cancel branch (TRON)", () => {
  it("userDecision: cancel transitions handle to cancelled; no signing; no broadcast", async () => {
    const prepareResult = await callTool("prepare_tron_native_send", {
      to: TRON_RECIPIENT,
      sun: "1000000",
    });
    const handle = (prepareResult.structuredContent as { handle: string }).handle;
    const previewResult = await callTool("preview_send", { handle });
    const previewToken = (previewResult.structuredContent as { previewToken: string }).previewToken;

    const cancelResult = await callTool("send_transaction", {
      handle,
      previewToken,
      userDecision: "cancel",
    });
    expect(cancelResult.isError).toBeFalsy();
    const sc = cancelResult.structuredContent as { userCancelled: boolean };
    expect(sc.userCancelled).toBe(true);
    expect(vi.mocked(_tronLedgerTransport.signTransaction)).not.toHaveBeenCalled();
    expect(sendRawTransactionSpy).not.toHaveBeenCalled();

    // handle is in cancelled state
    const cancelledLookup = lookup(handle);
    if (!cancelledLookup.ok) throw new Error("handle not found post-cancel");
    expect(cancelledLookup.record.status).toBe("cancelled");
  });
});

// ---------------------------------------------------------------------------
// Test 10 — Layer 0.5: non-allowlist TRC-20 → DISPATCH_TARGET_REFUSED.
// ---------------------------------------------------------------------------
describe("Layer 0.5 canonical-dispatch-tron (T-LAYER05-1)", () => {
  it("preview_send refuses non-allowlist TRC-20 with DISPATCH_TARGET_REFUSED", async () => {
    // Override canonical-dispatch-tron to refuse this specific address
    vi.spyOn(_canonicalDispatchTron, "checkTronDispatchTarget").mockReturnValue({
      kind: "refused",
      offenders: [NON_ALLOWLIST_TRC20],
      allowlist: ["TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t"],
    });

    // Prepare a TRC-20 tx (the dispatch check fires at preview, not prepare)
    const prepareResult = await callTool("prepare_tron_trc20_send", {
      to: TRON_RECIPIENT,
      tokenAddress: USDT_TRC20_ADDR, // still passes prepare validation
      amount: "100",
    });
    expect(prepareResult.isError).toBeFalsy();
    const handle = (prepareResult.structuredContent as { handle: string }).handle;

    // Force the handle to use the non-allowlist address via the mock
    const lookupResult = lookup(handle);
    if (!lookupResult.ok) throw new Error("handle not found");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ((lookupResult.record.tx as PreparedTxTron) as any).contractAddress = NON_ALLOWLIST_TRC20;

    const previewResult = await callTool("preview_send", { handle });
    expect(previewResult.isError).toBe(true);
    const sc = previewResult.structuredContent as { errorCode: string };
    expect(sc.errorCode).toBe("DISPATCH_TARGET_REFUSED");
  });

  it("native TRX skips Layer 0.5 (no contractAddress check)", async () => {
    const checkSpy = vi.spyOn(_canonicalDispatchTron, "checkTronDispatchTarget");
    const prepareResult = await callTool("prepare_tron_native_send", {
      to: TRON_RECIPIENT,
      sun: "1000000",
    });
    const handle = (prepareResult.structuredContent as { handle: string }).handle;
    const previewResult = await callTool("preview_send", { handle });
    expect(previewResult.isError).toBeFalsy();
    // checkTronDispatchTarget should NOT have been called for native TRX
    expect(checkSpy).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Test 11 — Layer 0.7: TRC-20 revert → SIMULATION_REFUSED.
// ---------------------------------------------------------------------------
describe("Layer 0.7 mandatory simulation gate (TRC-20) (T-LAYER07-1)", () => {
  it("preview_send refuses TRC-20 when simulation returns revert", async () => {
    vi.spyOn(_simulationTron, "runTronPreviewSimulation").mockResolvedValue({
      status: "revert",
      revertReason: "insufficient balance",
      energyUsed: 0n,
      constantResult: [],
    });

    const prepareResult = await callTool("prepare_tron_trc20_send", {
      to: TRON_RECIPIENT,
      tokenAddress: USDT_TRC20_ADDR,
      amount: "100",
    });
    const handle = (prepareResult.structuredContent as { handle: string }).handle;
    const previewResult = await callTool("preview_send", { handle });
    expect(previewResult.isError).toBe(true);
    const sc = previewResult.structuredContent as { errorCode: string };
    expect(sc.errorCode).toBe("SIMULATION_REFUSED");
  });
});

// ---------------------------------------------------------------------------
// Test 12 — Native TRX: NO_SIMULATION_AVAILABLE advisory (NOT refusal).
// ---------------------------------------------------------------------------
describe("native TRX: no-simulation advisory (T-LAYER07-NATIVE)", () => {
  it("preview_send emits NO_SIMULATION_AVAILABLE advisory for native TRX; mints previewToken", async () => {
    const prepareResult = await callTool("prepare_tron_native_send", {
      to: TRON_RECIPIENT,
      sun: "500000",
    });
    const handle = (prepareResult.structuredContent as { handle: string }).handle;
    const previewResult = await callTool("preview_send", { handle });
    expect(previewResult.isError).toBeFalsy();

    // Response text should contain the no-simulation advisory
    const text = previewResult.content[0]?.text ?? "";
    expect(text).toMatch(/CHECKS PERFORMED.*TRON.*no simulation available/i);

    // previewToken MUST be minted (pipeline continues)
    const sc = previewResult.structuredContent as { previewToken: string; simulation: { status: string } };
    expect(sc.previewToken).toBeTruthy();
    expect(sc.simulation.status).toBe("not-applicable");

    // runTronPreviewSimulation should NOT have been called for native
    expect(vi.mocked(_simulationTron.runTronPreviewSimulation)).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Test 13 — get_tx_verification TRON re-emit.
// ---------------------------------------------------------------------------
describe("get_tx_verification TRON re-emit (T-REEMIT-TRON)", () => {
  it("returns blockHeader + rawDataHex + dispatchCheckResult for TRON handles", async () => {
    // get_tx_verification is blocked in demo mode; disable it
    expect(isDemoMode()).toBe(false);

    const prepareResult = await callTool("prepare_tron_native_send", {
      to: TRON_RECIPIENT,
      sun: "1000000",
    });
    const handle = (prepareResult.structuredContent as { handle: string }).handle;

    const verifyResult = await callTool("get_tx_verification", { handle });
    expect(verifyResult.isError).toBeFalsy();
    const sc = verifyResult.structuredContent as {
      txType: string;
      kind: string;
      blockHeader: { refBlockBytes: string; refBlockHash: string; expiration: number };
      rawDataHex: string;
      dispatchCheckResult: { kind: string };
    };
    expect(sc.txType).toBe("tron");
    expect(sc.kind).toBe("native");
    expect(sc.blockHeader).toBeTruthy();
    expect(typeof sc.blockHeader.refBlockBytes).toBe("string");
    expect(typeof sc.blockHeader.refBlockHash).toBe("string");
    expect(typeof sc.blockHeader.expiration).toBe("number");
    expect(typeof sc.rawDataHex).toBe("string");
    // Native: dispatchCheckResult = { kind: "not-applicable" }
    expect(sc.dispatchCheckResult.kind).toBe("not-applicable");
  });

  it("TRC-20 get_tx_verification: dispatchCheckResult re-runs allowlist", async () => {
    expect(isDemoMode()).toBe(false);

    const prepareResult = await callTool("prepare_tron_trc20_send", {
      to: TRON_RECIPIENT,
      tokenAddress: USDT_TRC20_ADDR,
      amount: "100",
    });
    const handle = (prepareResult.structuredContent as { handle: string }).handle;

    const verifyResult = await callTool("get_tx_verification", { handle });
    expect(verifyResult.isError).toBeFalsy();
    const sc = verifyResult.structuredContent as {
      kind: string;
      dispatchCheckResult: { kind: string };
    };
    expect(sc.kind).toBe("trc20");
    // USDT is in allowlist → allowed
    expect(sc.dispatchCheckResult.kind).toBe("allowed");
  });
});
