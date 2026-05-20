// Plan 18-04 — send_transaction TRON branch regression file.
// Mirror of `test/send-transaction.solana.test.ts` shape; TRON-side load-bearing
// invariants:
//
//   1. **EVM branch back-compat** — EVM handles (txType absent / "evm") flow through
//      the unchanged Phase 4-9 body. Defense against accidental TRON-branch hijack.
//   2. **Three FROZEN gates re-anchored byte-identical for TRON**:
//      PREVIEW_REQUIRED, PREVIEW_TOKEN_MISMATCH, PAYLOAD_FINGERPRINT_DRIFT fire
//      identically on TRON handles via the discriminator dispatch on the recompute call.
//      The refusal envelope + errorCode is byte-identical to the EVM path.
//   3. **Cancel branch** — `userDecision: "cancel"` transitions TRON handle to cancelled
//      WITHOUT signing OR broadcasting (T-CANCEL-1 mirror).
//   4. **USB-HID sign path** — happy path stubs `_tronLedgerTransport.signTransaction`
//      + `sendRawTransactionSpy`; asserts `txHash` and `txID` returned.
//   5. **FLAG-1.5: txID in broadcast envelope = presignHash.slice(2)** (SHA-256 of
//      raw_data = TRON consensus tx-id), NOT payloadFingerprint.slice(2) (keccak256).
//   6. **Broadcast defensive handling** — both flat `{result: true}` and nested
//      `{result: {result: true}}` shapes produce success.
//   7. **Error mapping** — LEDGER_NOT_CONNECTED, LEDGER_REJECTED (TRX app not open),
//      LEDGER_REJECTED (user reject), BROADCAST_FAILED, BROADCAST_FAILED (SIGERROR).
//   8. **WALLET_NOT_PAIRED** — no paired TRON account refuses before signing.
//   9. **Demo-mode short-circuit** — simulation envelope returned; sign spy = 0 calls.
//
// Mocking strategy:
//   - `_tronLedgerTransport.signTransaction` spy — full control over the Ledger sign.
//   - `_tronRegistry.getTronWeb().trx.sendRawTransaction` spy via `sendRawTransactionSpy`.
//   - `listAccounts` from `non-evm-account-store` — mocked for TRON pairing.
//   - `_simulationTron.runTronPreviewSimulation` — demo-mode sim control.
//   - handle-store stays REAL — seed handles via `createHandle`, assert via `lookup()`.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";

const { listAccountsSpy, sendRawTransactionSpy } = vi.hoisted(() => ({
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

import { _tronRegistry } from "../src/chains/tron/registry.js";
import { _resetDemoModeForTesting } from "../src/config/env.js";
import {
  _resetActivePersonaForTesting,
  setActiveTronPersonaBySlug,
} from "../src/demo/state.js";
import { computeTronPayloadFingerprint } from "../src/signing/payload-fingerprint-tron.js";
import { _simulationTron } from "../src/signing/simulation-tron.js";
import {
  _peekHandleForTesting,
  _resetHandleStoreForTesting,
  createHandle,
  lookup,
  transitionToPreviewed,
  type PreparedTxTron,
} from "../src/signing/handle-store.js";
import {
  LedgerDeviceNotConnectedError as LedgerTronDeviceNotConnectedError,
  LedgerTronAppNotOpenError,
  _tronLedgerTransport,
} from "../src/wallet/ledger-tron-transport.js";
import {
  getRegisteredTool,
  type ToolHandlerResult,
} from "../src/tools/index.js";

await import("../src/tools/register-all.js");

async function callSendTx(args: Record<string, unknown>): Promise<ToolHandlerResult> {
  const tool = getRegisteredTool("send_transaction");
  if (!tool) throw new Error("send_transaction not registered");
  return tool.handler(args);
}

// TRON test constants
const TRON_WHALE_ADDR = "TWd4WrZ9wn84f5x1hZhL4DHvk738ns5jwb";
const TRON_RECIPIENT = "TEkxiTehnzSmSe2XqrBj4w32RUN966rdz8";
const USDT_TRC20_ADDR = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";
const FAKE_SIGNATURE = "a".repeat(130); // 65-byte hex, no 0x
const FAKE_TX_ID = "c".repeat(64);      // TRON txID hex, no 0x prefix
const DEMO_KEY = "VAULTPILOT_DEMO";

const NATIVE_RAW_DATA_HEX = "11".repeat(40);
const TRC20_RAW_DATA_HEX = "22".repeat(60);

function buildNativeTronHandle(): { handle: string; presignHash: string } {
  const rawDataObject = {
    contract: [],
    ref_block_bytes: "00ab",
    ref_block_hash: "1234567890abcdef",
    expiration: Date.now() + 900_000,
    timestamp: Date.now(),
  };
  const tronTx: PreparedTxTron = {
    txType: "tron",
    kind: "native",
    chainId: 0,
    to: TRON_RECIPIENT,
    valueWei: 0n,
    data: "0x",
    rawDataHex: NATIVE_RAW_DATA_HEX,
    rawDataObject,
    refBlockBytes: "00ab",
    refBlockHash: "1234567890abcdef",
    expiration: rawDataObject.expiration,
  };
  const payloadFingerprint = computeTronPayloadFingerprint({
    rawDataBytes: new Uint8Array(Buffer.from(NATIVE_RAW_DATA_HEX, "hex")),
  });
  const handle = createHandle({
    tx: tronTx,
    args: { to: TRON_RECIPIENT, sun: "1000000" },
    payloadFingerprint,
  });

  const presignHash =
    "0x" + createHash("sha256").update(Buffer.from(NATIVE_RAW_DATA_HEX, "hex")).digest("hex");
  return { handle, presignHash };
}

function buildTrc20TronHandle(): { handle: string; presignHash: string } {
  const rawDataObject = {
    contract: [],
    ref_block_bytes: "00cd",
    ref_block_hash: "abcdef1234567890",
    expiration: Date.now() + 900_000,
    timestamp: Date.now(),
  };
  const tronTx: PreparedTxTron = {
    txType: "tron",
    kind: "trc20",
    chainId: 0,
    to: TRON_RECIPIENT,
    valueWei: 0n,
    data: "0x",
    rawDataHex: TRC20_RAW_DATA_HEX,
    rawDataObject,
    refBlockBytes: "00cd",
    refBlockHash: "abcdef1234567890",
    expiration: rawDataObject.expiration,
    contractAddress: USDT_TRC20_ADDR,
    instructionSummary: [
      {
        kind: "trc20-transfer",
        from: TRON_WHALE_ADDR,
        to: TRON_RECIPIENT,
        amount: 100_000_000n,
        tokenAddress: USDT_TRC20_ADDR,
        decimals: 6,
        symbol: "USDT",
      },
    ],
  };
  const payloadFingerprint = computeTronPayloadFingerprint({
    rawDataBytes: new Uint8Array(Buffer.from(TRC20_RAW_DATA_HEX, "hex")),
  });
  const handle = createHandle({
    tx: tronTx,
    args: { to: TRON_RECIPIENT, tokenAddress: USDT_TRC20_ADDR, amount: "100" },
    payloadFingerprint,
  });

  const presignHash =
    "0x" + createHash("sha256").update(Buffer.from(TRC20_RAW_DATA_HEX, "hex")).digest("hex");
  return { handle, presignHash };
}

function previewHandle(handle: string, presignHash: string): string {
  const previewToken = "test-preview-token-" + handle.slice(0, 8);
  transitionToPreviewed(handle, {
    nonce: 0,
    gas: 0n,
    maxFeePerGas: 0n,
    maxPriorityFeePerGas: 0n,
    previewToken,
    presignHash,
    selector: null,
  });
  return previewToken;
}

function buildStubTronWeb() {
  return {
    transactionBuilder: {
      triggerConstantContract: vi.fn(async () => ({ result: { result: true }, energy_used: 0 })),
    },
    trx: {
      sendRawTransaction: sendRawTransactionSpy,
    },
    utils: { abi: { encodeParamsV2ByABI: vi.fn(() => "00") } },
  };
}

let savedDemo: string | undefined;

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
  sendRawTransactionSpy.mockReset();
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
// 1. Happy path — native TRX send.
// ---------------------------------------------------------------------------
describe("send_transaction TRON — native TRX happy path", () => {
  it("signs + broadcasts; txHash + txID in structuredContent", async () => {
    const { handle, presignHash } = buildNativeTronHandle();
    const previewToken = previewHandle(handle, presignHash);

    const result = await callSendTx({
      handle,
      previewToken,
      userDecision: "send",
    });
    expect(result.isError).toBeFalsy();

    const sc = result.structuredContent as {
      txHash: string;
      txID: string;
      txType: string;
      kind: string;
      sessionTopicLast8: null;
    };
    expect(sc.txHash).toBe(FAKE_TX_ID);
    expect(sc.txID).toBe(FAKE_TX_ID);
    expect(sc.txType).toBe("tron");
    expect(sc.kind).toBe("native");
    expect(sc.sessionTopicLast8).toBeNull();

    // _tronLedgerTransport.signTransaction called with correct args
    const signSpy = vi.mocked(_tronLedgerTransport.signTransaction);
    expect(signSpy).toHaveBeenCalledTimes(1);
    expect(signSpy.mock.calls[0]![0].rawTxHex).toBe(NATIVE_RAW_DATA_HEX);
    expect(signSpy.mock.calls[0]![0].tokenSignatures).toEqual([]);
    expect(signSpy.mock.calls[0]![0].path).toBe("44'/195'/0'/0/0");

    // handle transitioned to sent
    const lookupResult = lookup(handle);
    if (!lookupResult.ok) throw new Error("handle not found");
    expect(lookupResult.record.status).toBe("sent");
    expect(lookupResult.record.txHash).toBe(FAKE_TX_ID);
  });
});

// ---------------------------------------------------------------------------
// 2. Happy path — TRC-20 send.
// ---------------------------------------------------------------------------
describe("send_transaction TRON — TRC-20 happy path", () => {
  it("signs + broadcasts TRC-20; kind='trc20' in structuredContent", async () => {
    const { handle, presignHash } = buildTrc20TronHandle();
    const previewToken = previewHandle(handle, presignHash);

    const result = await callSendTx({
      handle,
      previewToken,
      userDecision: "send",
    });
    expect(result.isError).toBeFalsy();

    const sc = result.structuredContent as { txHash: string; kind: string };
    expect(sc.txHash).toBe(FAKE_TX_ID);
    expect(sc.kind).toBe("trc20");
    expect(vi.mocked(_tronLedgerTransport.signTransaction)).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// 3. FLAG-1.5 — txID in broadcast envelope = presignHash.slice(2) (SHA-256),
//    NOT payloadFingerprint.slice(2) (keccak256).
// ---------------------------------------------------------------------------
describe("send_transaction TRON — FLAG-1.5 txID = presignHash.slice(2)", () => {
  it("signedTransaction.txID uses presignHash (SHA-256), not payloadFingerprint (keccak256)", async () => {
    const { handle, presignHash } = buildNativeTronHandle();
    const previewToken = previewHandle(handle, presignHash);

    // Make broadcast return a different txid so we can tell which one was used
    const BROADCAST_TX_ID = "d".repeat(64);
    sendRawTransactionSpy.mockResolvedValue({ result: true, txid: BROADCAST_TX_ID });

    const result = await callSendTx({
      handle,
      previewToken,
      userDecision: "send",
    });
    expect(result.isError).toBeFalsy();

    // The broadcast call receives a signedTransaction object with txID from presignHash
    const broadcastCallArgs = sendRawTransactionSpy.mock.calls[0]![0] as {
      txID: string;
      visible: boolean;
      raw_data_hex: string;
      signature: string[];
    };
    const expectedTxID = presignHash.slice(2); // strip 0x prefix
    expect(broadcastCallArgs.txID).toBe(expectedTxID);
    expect(broadcastCallArgs.visible).toBe(true);
    expect(broadcastCallArgs.raw_data_hex).toBe(NATIVE_RAW_DATA_HEX);
    expect(broadcastCallArgs.signature).toEqual([FAKE_SIGNATURE]);

    // Verify presignHash is SHA-256, not keccak256
    const sha256Hash = createHash("sha256").update(Buffer.from(NATIVE_RAW_DATA_HEX, "hex")).digest("hex");
    expect(expectedTxID).toBe(sha256Hash);
  });
});

// ---------------------------------------------------------------------------
// 4. Broadcast defensive handling — both flat and nested result shapes.
// ---------------------------------------------------------------------------
describe("send_transaction TRON — broadcast result shape handling", () => {
  it("flat {result: true} shape succeeds", async () => {
    sendRawTransactionSpy.mockResolvedValue({ result: true, txid: FAKE_TX_ID });

    const { handle, presignHash } = buildNativeTronHandle();
    const previewToken = previewHandle(handle, presignHash);
    const result = await callSendTx({ handle, previewToken, userDecision: "send" });
    expect(result.isError).toBeFalsy();
  });

  it("nested {result: {result: true}} shape succeeds", async () => {
    sendRawTransactionSpy.mockResolvedValue({
      result: { result: true },
      txid: FAKE_TX_ID,
    });

    const { handle, presignHash } = buildNativeTronHandle();
    const previewToken = previewHandle(handle, presignHash);
    const result = await callSendTx({ handle, previewToken, userDecision: "send" });
    expect(result.isError).toBeFalsy();
  });

  it("broadcast {result: false, code: 'CONTRACT_VALIDATE_ERROR'} → BROADCAST_FAILED", async () => {
    sendRawTransactionSpy.mockResolvedValue({
      result: false,
      code: "CONTRACT_VALIDATE_ERROR",
      message: "validation failed",
    });

    const { handle, presignHash } = buildNativeTronHandle();
    const previewToken = previewHandle(handle, presignHash);
    const result = await callSendTx({ handle, previewToken, userDecision: "send" });
    expect(result.isError).toBe(true);
    const sc = result.structuredContent as { errorCode: string };
    expect(sc.errorCode).toBe("BROADCAST_FAILED");
  });

  it("broadcast {result: false, code: 'SIGERROR'} → LEDGER_REJECTED", async () => {
    sendRawTransactionSpy.mockResolvedValue({
      result: false,
      code: "SIGERROR",
      message: "signature mismatch",
    });

    const { handle, presignHash } = buildNativeTronHandle();
    const previewToken = previewHandle(handle, presignHash);
    const result = await callSendTx({ handle, previewToken, userDecision: "send" });
    expect(result.isError).toBe(true);
    const sc = result.structuredContent as { errorCode: string };
    expect(sc.errorCode).toBe("LEDGER_REJECTED");
  });
});

// ---------------------------------------------------------------------------
// 5. Cancel branch.
// ---------------------------------------------------------------------------
describe("send_transaction TRON — cancel branch", () => {
  it("cancel transitions handle; no signing; no broadcast", async () => {
    const { handle, presignHash } = buildNativeTronHandle();
    const previewToken = previewHandle(handle, presignHash);

    const result = await callSendTx({
      handle,
      previewToken,
      userDecision: "cancel",
    });
    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as { userCancelled: boolean };
    expect(sc.userCancelled).toBe(true);

    expect(vi.mocked(_tronLedgerTransport.signTransaction)).not.toHaveBeenCalled();
    expect(sendRawTransactionSpy).not.toHaveBeenCalled();

    const lookupResult = lookup(handle);
    if (!lookupResult.ok) throw new Error("handle not found");
    expect(lookupResult.record.status).toBe("cancelled");
  });
});

// ---------------------------------------------------------------------------
// 6. Three FROZEN gates — byte-identical to EVM/Solana paths.
// ---------------------------------------------------------------------------
describe("send_transaction TRON — FROZEN gates byte-identical (T-FROZEN-TRON)", () => {
  it("PREVIEW_REQUIRED: refuses when handle not yet previewed", async () => {
    const { handle } = buildNativeTronHandle();
    const result = await callSendTx({
      handle,
      previewToken: "any-token",
      userDecision: "send",
    });
    expect(result.isError).toBe(true);
    const sc = result.structuredContent as { errorCode: string };
    expect(sc.errorCode).toBe("PREVIEW_REQUIRED");
    expect(vi.mocked(_tronLedgerTransport.signTransaction)).not.toHaveBeenCalled();
  });

  it("PREVIEW_TOKEN_MISMATCH: refuses on wrong previewToken", async () => {
    const { handle, presignHash } = buildNativeTronHandle();
    previewHandle(handle, presignHash);

    const result = await callSendTx({
      handle,
      previewToken: "wrong-token-uuid-0000-0000-000000000000",
      userDecision: "send",
    });
    expect(result.isError).toBe(true);
    const sc = result.structuredContent as { errorCode: string };
    expect(sc.errorCode).toBe("PREVIEW_TOKEN_MISMATCH");
    expect(vi.mocked(_tronLedgerTransport.signTransaction)).not.toHaveBeenCalled();
  });

  it("PAYLOAD_FINGERPRINT_DRIFT: refuses when stored fingerprint mutated", async () => {
    const { handle, presignHash } = buildNativeTronHandle();
    const previewToken = previewHandle(handle, presignHash);

    // Mutate the stored payloadFingerprint to simulate in-process corruption
    const record = _peekHandleForTesting(handle);
    if (record) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (record as any).payloadFingerprint = "0x" + "ff".repeat(32);
    }

    const result = await callSendTx({
      handle,
      previewToken,
      userDecision: "send",
    });
    expect(result.isError).toBe(true);
    const sc = result.structuredContent as { errorCode: string };
    expect(sc.errorCode).toBe("PAYLOAD_FINGERPRINT_DRIFT");
    // signTransaction MUST NOT be called when drift gate fires
    expect(vi.mocked(_tronLedgerTransport.signTransaction)).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 7. Ledger error mapping.
// ---------------------------------------------------------------------------
describe("send_transaction TRON — Ledger error mapping", () => {
  it("LedgerDeviceNotConnectedError → LEDGER_NOT_CONNECTED", async () => {
    vi.mocked(_tronLedgerTransport.signTransaction).mockRejectedValue(
      new LedgerTronDeviceNotConnectedError(),
    );

    const { handle, presignHash } = buildNativeTronHandle();
    const previewToken = previewHandle(handle, presignHash);
    const result = await callSendTx({ handle, previewToken, userDecision: "send" });
    expect(result.isError).toBe(true);
    const sc = result.structuredContent as { errorCode: string };
    expect(sc.errorCode).toBe("LEDGER_NOT_CONNECTED");
  });

  it("LedgerTronAppNotOpenError → LEDGER_REJECTED", async () => {
    vi.mocked(_tronLedgerTransport.signTransaction).mockRejectedValue(
      new LedgerTronAppNotOpenError(),
    );

    const { handle, presignHash } = buildNativeTronHandle();
    const previewToken = previewHandle(handle, presignHash);
    const result = await callSendTx({ handle, previewToken, userDecision: "send" });
    expect(result.isError).toBe(true);
    const sc = result.structuredContent as { errorCode: string };
    expect(sc.errorCode).toBe("LEDGER_REJECTED");
  });

  it("user-reject error (message contains 'reject') → LEDGER_REJECTED", async () => {
    vi.mocked(_tronLedgerTransport.signTransaction).mockRejectedValue(
      new Error("User rejected the transaction"),
    );

    const { handle, presignHash } = buildNativeTronHandle();
    const previewToken = previewHandle(handle, presignHash);
    const result = await callSendTx({ handle, previewToken, userDecision: "send" });
    expect(result.isError).toBe(true);
    const sc = result.structuredContent as { errorCode: string };
    expect(sc.errorCode).toBe("LEDGER_REJECTED");
  });

  it("unknown signing error → INTERNAL_ERROR", async () => {
    vi.mocked(_tronLedgerTransport.signTransaction).mockRejectedValue(
      new Error("some unexpected error"),
    );

    const { handle, presignHash } = buildNativeTronHandle();
    const previewToken = previewHandle(handle, presignHash);
    const result = await callSendTx({ handle, previewToken, userDecision: "send" });
    expect(result.isError).toBe(true);
    const sc = result.structuredContent as { errorCode: string };
    expect(sc.errorCode).toBe("INTERNAL_ERROR");
  });
});

// ---------------------------------------------------------------------------
// 8. WALLET_NOT_PAIRED.
// ---------------------------------------------------------------------------
describe("send_transaction TRON — WALLET_NOT_PAIRED", () => {
  it("refuses when no TRON account paired", async () => {
    listAccountsSpy.mockReturnValue([]); // no paired accounts

    const { handle, presignHash } = buildNativeTronHandle();
    const previewToken = previewHandle(handle, presignHash);
    const result = await callSendTx({ handle, previewToken, userDecision: "send" });
    expect(result.isError).toBe(true);
    const sc = result.structuredContent as { errorCode: string };
    expect(sc.errorCode).toBe("WALLET_NOT_PAIRED");
    expect(vi.mocked(_tronLedgerTransport.signTransaction)).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 9. Demo-mode short-circuit (DEMO-05 TRON mirror).
// ---------------------------------------------------------------------------
describe("send_transaction TRON — demo-mode short-circuit", () => {
  it("demo mode returns simulation envelope; no sign; no broadcast", async () => {
    process.env[DEMO_KEY] = "true";
    _resetDemoModeForTesting();
    // Set a TRON persona (required in demo mode)
    setActiveTronPersonaBySlug("tron-whale");

    const { handle, presignHash } = buildNativeTronHandle();
    const previewToken = previewHandle(handle, presignHash);

    const result = await callSendTx({
      handle,
      previewToken,
      userDecision: "send",
    });
    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as {
      demoMode: boolean;
      simulated: boolean;
      txType: string;
    };
    expect(sc.demoMode).toBe(true);
    expect(sc.simulated).toBe(true);
    expect(sc.txType).toBe("tron");

    // Ledger sign must NOT be called in demo mode
    expect(vi.mocked(_tronLedgerTransport.signTransaction)).not.toHaveBeenCalled();
    // broadcast must NOT be called in demo mode
    expect(sendRawTransactionSpy).not.toHaveBeenCalled();
  });

  it("demo mode without TRON persona set → WRONG_MODE", async () => {
    process.env[DEMO_KEY] = "true";
    _resetDemoModeForTesting();
    // Do NOT call setActiveTronPersonaBySlug

    const { handle, presignHash } = buildNativeTronHandle();
    const previewToken = previewHandle(handle, presignHash);

    const result = await callSendTx({
      handle,
      previewToken,
      userDecision: "send",
    });
    expect(result.isError).toBe(true);
    const sc = result.structuredContent as { errorCode: string };
    expect(sc.errorCode).toBe("WRONG_MODE");
  });
});
