// Plan 18-04 — get_tx_verification TRON branch regression file.
// Mirror of `test/get-tx-verification.solana.test.ts` shape; TRON-side load-bearing
// invariants:
//
//   1. **Additive structuredContent fields** — TRON handles return
//      `blockHeader: { refBlockBytes, refBlockHash, expiration }`, `rawDataHex`,
//      `txType: "tron"`, `kind: "native" | "trc20"`, `dispatchCheckResult`.
//   2. **dispatchCheckResult re-runs allowlist** — TRC-20 re-runs
//      `_canonicalDispatchTron.checkTronDispatchTarget` each call.
//      Native returns `{ kind: "not-applicable" }`.
//   3. **Demo-mode check fires FIRST** — TRON re-emit refused in demo mode
//      (no real TRON handles exist in demo anyway).
//   4. **Per-status re-emit** — prepared: blockHeader + rawDataHex; previewed:
//      also presignHash + previewToken + LEDGER BLIND-SIGN HASH block;
//      sent: also txHash + txID + broadcastedAt.
//   5. **text body includes LEDGER BLIND-SIGN HASH (TRON)** when previewed/sent.
//   6. **EVM back-compat** — EVM handles (txType absent) remain unaffected.
//
// Mocking strategy:
//   - `_canonicalDispatchTron.checkTronDispatchTarget` — allowlist control.
//   - `getStatus` from session-manager — stubbed (TRON doesn't need WC).
//   - handle-store stays REAL — seed via `createHandle` + `transitionToPreviewed`.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";

import { _tronRegistry } from "../src/chains/tron/registry.js";
import { _canonicalDispatchTron } from "../src/security/canonical-dispatch-tron.js";
import { _resetDemoModeForTesting } from "../src/config/env.js";
import { computeTronPayloadFingerprint } from "../src/signing/payload-fingerprint-tron.js";
import {
  _resetHandleStoreForTesting,
  createHandle,
  lookup,
  transitionToPreviewed,
  transitionToSent,
  transitionToCancelled,
  type PreparedTxTron,
} from "../src/signing/handle-store.js";
import {
  getRegisteredTool,
  type ToolHandlerResult,
} from "../src/tools/index.js";

await import("../src/tools/register-all.js");

async function callGetTxVerification(args: Record<string, unknown>): Promise<ToolHandlerResult> {
  const tool = getRegisteredTool("get_tx_verification");
  if (!tool) throw new Error("get_tx_verification not registered");
  return tool.handler(args);
}

// TRON test constants
const TRON_WHALE_ADDR = "TWd4WrZ9wn84f5x1hZhL4DHvk738ns5jwb";
const TRON_RECIPIENT = "TEkxiTehnzSmSe2XqrBj4w32RUN966rdz8";
const USDT_TRC20_ADDR = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";
const NON_ALLOWLIST_ADDR = "TXXXFakeNotInAllowlistXXXXXXXXXXXX1";
const DEMO_KEY = "VAULTPILOT_DEMO";

const NATIVE_RAW_DATA_HEX = "33".repeat(40);
const TRC20_RAW_DATA_HEX = "44".repeat(60);

function buildNativeTronHandle(): string {
  const rawDataObject = {
    contract: [],
    ref_block_bytes: "00aa",
    ref_block_hash: "aabbccddeeff0011",
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
    refBlockBytes: "00aa",
    refBlockHash: "aabbccddeeff0011",
    expiration: rawDataObject.expiration,
  };
  const payloadFingerprint = computeTronPayloadFingerprint({
    rawDataBytes: new Uint8Array(Buffer.from(NATIVE_RAW_DATA_HEX, "hex")),
  });
  return createHandle({
    tx: tronTx,
    args: { to: TRON_RECIPIENT, sun: "1000000" },
    payloadFingerprint,
  });
}

function buildTrc20TronHandle(): string {
  const rawDataObject = {
    contract: [],
    ref_block_bytes: "00bb",
    ref_block_hash: "bbccddee00112233",
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
    refBlockBytes: "00bb",
    refBlockHash: "bbccddee00112233",
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
  return createHandle({
    tx: tronTx,
    args: { to: TRON_RECIPIENT, tokenAddress: USDT_TRC20_ADDR, amount: "100" },
    payloadFingerprint,
  });
}

function previewHandle(handle: string, rawDataHex: string): string {
  const presignHash =
    "0x" + createHash("sha256").update(Buffer.from(rawDataHex, "hex")).digest("hex");
  const previewToken = "test-verify-token-" + handle.slice(0, 8);
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

let savedDemo: string | undefined;

beforeEach(() => {
  _resetHandleStoreForTesting();
  savedDemo = process.env[DEMO_KEY];
  process.env[DEMO_KEY] = "false";
  _resetDemoModeForTesting();
});

afterEach(() => {
  if (savedDemo === undefined) delete process.env[DEMO_KEY];
  else process.env[DEMO_KEY] = savedDemo;
  _resetDemoModeForTesting();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// 1. Native TRX — prepared status (blockHeader + rawDataHex + dispatchCheckResult).
// ---------------------------------------------------------------------------
describe("get_tx_verification TRON — native prepared", () => {
  it("returns blockHeader + rawDataHex + dispatchCheckResult.kind='not-applicable'", async () => {
    const handle = buildNativeTronHandle();

    const result = await callGetTxVerification({ handle });
    expect(result.isError).toBeFalsy();

    const sc = result.structuredContent as {
      status: string;
      txType: string;
      kind: string;
      payloadFingerprint: string;
      blockHeader: { refBlockBytes: string; refBlockHash: string; expiration: number };
      rawDataHex: string;
      dispatchCheckResult: { kind: string };
      txJson: null;
    };

    expect(sc.status).toBe("prepared");
    expect(sc.txType).toBe("tron");
    expect(sc.kind).toBe("native");
    expect(sc.payloadFingerprint).toMatch(/^0x[0-9a-f]{64}$/);
    expect(sc.blockHeader.refBlockBytes).toBe("00aa");
    expect(sc.blockHeader.refBlockHash).toBe("aabbccddeeff0011");
    expect(typeof sc.blockHeader.expiration).toBe("number");
    expect(sc.rawDataHex).toBe(NATIVE_RAW_DATA_HEX);
    expect(sc.dispatchCheckResult.kind).toBe("not-applicable");
    expect(sc.txJson).toBeNull();

    // Text body includes "(preview has not run yet)" note
    const text = result.content[0]?.text ?? "";
    expect(text).toMatch(/preview has not run yet/i);
  });
});

// ---------------------------------------------------------------------------
// 2. TRC-20 — prepared status + dispatchCheckResult.
// ---------------------------------------------------------------------------
describe("get_tx_verification TRON — TRC-20 prepared", () => {
  it("dispatchCheckResult re-runs allowlist for USDT (allowed)", async () => {
    const handle = buildTrc20TronHandle();

    const result = await callGetTxVerification({ handle });
    expect(result.isError).toBeFalsy();

    const sc = result.structuredContent as {
      txType: string;
      kind: string;
      dispatchCheckResult: { kind: string };
    };
    expect(sc.txType).toBe("tron");
    expect(sc.kind).toBe("trc20");
    // USDT is in the Phase 18 allowlist → allowed
    expect(sc.dispatchCheckResult.kind).toBe("allowed");
  });

  it("dispatchCheckResult reports refused for non-allowlisted TRC-20", async () => {
    // Build a handle with a non-allowlist contract
    const rawDataObject = {
      contract: [],
      ref_block_bytes: "00cc",
      ref_block_hash: "ccddee0011223344",
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
      refBlockBytes: "00cc",
      refBlockHash: "ccddee0011223344",
      expiration: rawDataObject.expiration,
      contractAddress: NON_ALLOWLIST_ADDR,
      instructionSummary: [
        {
          kind: "trc20-transfer",
          from: TRON_WHALE_ADDR,
          to: TRON_RECIPIENT,
          amount: 50_000_000n,
          tokenAddress: NON_ALLOWLIST_ADDR,
          decimals: 6,
          symbol: "UNKNOWN",
        },
      ],
    };
    const payloadFingerprintNon = computeTronPayloadFingerprint({
      rawDataBytes: new Uint8Array(Buffer.from(TRC20_RAW_DATA_HEX, "hex")),
    });
    const handle = createHandle({
      tx: tronTx,
      args: { to: TRON_RECIPIENT, tokenAddress: NON_ALLOWLIST_ADDR, amount: "50" },
      payloadFingerprint: payloadFingerprintNon,
    });

    // Mock checkTronDispatchTarget to refuse
    vi.spyOn(_canonicalDispatchTron, "checkTronDispatchTarget").mockReturnValue({
      kind: "refused",
      offenders: [NON_ALLOWLIST_ADDR],
      allowlist: [USDT_TRC20_ADDR],
    });

    const result = await callGetTxVerification({ handle });
    expect(result.isError).toBeFalsy(); // re-emit itself doesn't refuse

    const sc = result.structuredContent as {
      dispatchCheckResult: { kind: string; offenders?: string[] };
    };
    expect(sc.dispatchCheckResult.kind).toBe("refused");
  });
});

// ---------------------------------------------------------------------------
// 3. Previewed status — LEDGER BLIND-SIGN HASH block emitted.
// ---------------------------------------------------------------------------
describe("get_tx_verification TRON — previewed status", () => {
  it("previewed re-emit includes presignHash + LEDGER BLIND-SIGN HASH block", async () => {
    const handle = buildNativeTronHandle();
    previewHandle(handle, NATIVE_RAW_DATA_HEX);

    const result = await callGetTxVerification({ handle });
    expect(result.isError).toBeFalsy();

    const sc = result.structuredContent as {
      status: string;
      presignHash: string;
      previewToken: string;
    };
    expect(sc.status).toBe("previewed");
    expect(sc.presignHash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(sc.previewToken).toBeTruthy();

    // presignHash = SHA-256(rawDataBytes)
    const expectedPresignHash =
      "0x" + createHash("sha256").update(Buffer.from(NATIVE_RAW_DATA_HEX, "hex")).digest("hex");
    expect(sc.presignHash).toBe(expectedPresignHash);

    // Text body includes LEDGER BLIND-SIGN HASH block
    const text = result.content[0]?.text ?? "";
    expect(text).toMatch(/LEDGER\s+BLIND.SIGN\s+HASH/i);
  });
});

// ---------------------------------------------------------------------------
// 4. Sent status — txHash + txID + broadcastedAt.
// ---------------------------------------------------------------------------
describe("get_tx_verification TRON — sent status", () => {
  it("sent re-emit includes txHash + txID + BROADCAST CONFIRMATION block", async () => {
    const handle = buildNativeTronHandle();
    previewHandle(handle, NATIVE_RAW_DATA_HEX);
    const SENT_TX_HASH = "e".repeat(64);
    transitionToSent(handle, SENT_TX_HASH);

    const result = await callGetTxVerification({ handle });
    expect(result.isError).toBeFalsy();

    const sc = result.structuredContent as {
      status: string;
      txHash: string;
      txID: string;
      broadcastedAt: string;
    };
    expect(sc.status).toBe("sent");
    expect(sc.txHash).toBe(SENT_TX_HASH);
    expect(sc.txID).toBe(SENT_TX_HASH);
    expect(sc.broadcastedAt).toBeTruthy();

    const text = result.content[0]?.text ?? "";
    expect(text).toMatch(/BROADCAST CONFIRMATION/i);
    expect(text).toContain(SENT_TX_HASH);
  });
});

// ---------------------------------------------------------------------------
// 5. Cancelled status.
// ---------------------------------------------------------------------------
describe("get_tx_verification TRON — cancelled status", () => {
  it("cancelled re-emit includes CANCELLED block", async () => {
    const handle = buildNativeTronHandle();
    previewHandle(handle, NATIVE_RAW_DATA_HEX);
    transitionToCancelled(handle);

    const result = await callGetTxVerification({ handle });
    expect(result.isError).toBeFalsy();

    const sc = result.structuredContent as { status: string; cancelledAt?: string };
    expect(sc.status).toBe("cancelled");
    expect(sc.cancelledAt).toBeTruthy();

    const text = result.content[0]?.text ?? "";
    expect(text).toMatch(/CANCELLED/i);
  });
});

// ---------------------------------------------------------------------------
// 6. Demo-mode check fires FIRST.
// ---------------------------------------------------------------------------
describe("get_tx_verification TRON — demo-mode refused", () => {
  it("refuses in demo mode before handle lookup", async () => {
    process.env[DEMO_KEY] = "true";
    _resetDemoModeForTesting();

    const result = await callGetTxVerification({ handle: "any-handle" });
    expect(result.isError).toBe(true);
    const sc = result.structuredContent as { errorCode: string };
    expect(sc.errorCode).toBe("DEMO_MODE_REFUSED");
  });
});
