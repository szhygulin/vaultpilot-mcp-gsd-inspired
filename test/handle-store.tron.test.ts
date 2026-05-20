// test/handle-store.tron.test.ts — Phase 18 Plan 18-01 discriminated-union
// widening regression. Sibling of `test/handle-store.solana.test.ts` (Phase 12
// — FROZEN) and `test/signing-handle-store.test.ts` (Phase 4-11 EVM — FROZEN).
//
// What this file proves:
//   1. PreparedTxTron discriminator round-trip via createHandle / lookup:
//      `txType: "tron"` preserved, `kind: "native"` and `kind: "trc20"` both work.
//   2. `contractAddress` populated only for trc20 kind (undefined for native).
//   3. Back-compat: EVM handles without `txType` field → `txType ?? "evm"` === "evm".
//   4. PrepareArgs additive TRON fields (sun, expiration, refBlockBytes, refBlockHash)
//      round-trip correctly.
//   5. TronInstructionSummary discriminated union shapes accessible.
//   6. State-machine transitions (prepared → previewed → sent, prepared →
//      cancelled) work UNCHANGED on TRON handles.
//   7. TTL eviction fires UNCHANGED on TRON handles.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Address, Hex } from "viem";

import {
  HANDLE_TTL_MS,
  _resetHandleStoreForTesting,
  createHandle,
  lookup,
  transitionToCancelled,
  transitionToPreviewed,
  transitionToSent,
} from "../src/signing/handle-store.js";
import type {
  PrepareArgs,
  PreparedTx,
  PreparedTxTron,
  PreviewPinned,
  TronInstructionSummary,
} from "../src/signing/handle-store.js";

// ============================================================================
// Fixtures
// ============================================================================

const FINGERPRINT =
  "0xaa8305509481b97e50acb9e4d582bb53a1db1c99f9c357febe1fbf7389ffd4fa" as Hex;
const PRESIGN_HASH =
  "0xa056782c3943d1a0c94c6eb30c6175b34c47cf8f42a2e88f95bbadcb22fbf400" as Hex;

const FROM_ADDR = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";
const TO_ADDR = "TEkxiTehnzSmSe2XqrBj4w32RUN966rdz8";
const USDT_ADDR = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";
const FIXTURE_M_RAW_DATA_HEX =
  "0a0200ad22088e5e7df4e3c8b9a240f0c894a5e4335a67080112630a2d747970652e676f6f676c65617069732e636f6d2f70726f746f636f6c2e5472616e73666572436f6e747261637412320a1541a614f803b6fd780986a42c78ec9c7f77e6ded13c1215413487b63d30b5b2c87fb7ffa8bcfade38eaac1abe18c0843d7090f490a5e433";

function buildNativeTronPreparedTx(): PreparedTxTron {
  return {
    txType: "tron",
    // EVM sentinel fields
    chainId: 0,
    to: "0x0000000000000000000000000000000000000000" as Address,
    valueWei: 0n,
    data: "0x" as Hex,
    // TRON-specific fields
    rawDataHex: FIXTURE_M_RAW_DATA_HEX,
    rawDataObject: { contract: [{ type: "TransferContract" }] },
    refBlockBytes: "00ad",
    refBlockHash: "8e5e7df4e3c8b9a2",
    expiration: 1779268134000,
    kind: "native",
    instructionSummary: [
      {
        kind: "native-transfer",
        from: FROM_ADDR,
        to: TO_ADDR,
        sun: 1_000_000n,
      } satisfies TronInstructionSummary,
    ],
  };
}

function buildTrc20TronPreparedTx(): PreparedTxTron {
  return {
    txType: "tron",
    chainId: 0,
    to: "0x0000000000000000000000000000000000000000" as Address,
    valueWei: 0n,
    data: "0x" as Hex,
    rawDataHex: FIXTURE_M_RAW_DATA_HEX, // reuse for shape test; content not load-bearing here
    rawDataObject: { contract: [{ type: "TriggerSmartContract" }] },
    refBlockBytes: "00ad",
    refBlockHash: "8e5e7df4e3c8b9a2",
    expiration: 1779268134000,
    kind: "trc20",
    contractAddress: USDT_ADDR,
    instructionSummary: [
      {
        kind: "trc20-transfer",
        from: FROM_ADDR,
        to: TO_ADDR,
        tokenAddress: USDT_ADDR,
        amount: 100_000_000n,
        decimals: 6,
      } satisfies TronInstructionSummary,
    ],
  };
}

function buildTronPrepareArgs(): PrepareArgs {
  return {
    to: TO_ADDR,
    valueWei: "0",
    sun: "1000000",
    expiration: "900",
    refBlockBytes: "00ad",
    refBlockHash: "8e5e7df4e3c8b9a2",
  };
}

function buildTronPinned(): PreviewPinned {
  return {
    nonce: 0,
    gas: 0n,
    maxFeePerGas: 0n,
    maxPriorityFeePerGas: 0n,
    previewToken: "test-preview-token-tron",
    presignHash: PRESIGN_HASH,
    selector: null,
  };
}

// ============================================================================
// Setup / teardown
// ============================================================================

beforeEach(() => {
  _resetHandleStoreForTesting();
});

afterEach(() => {
  vi.useRealTimers();
  _resetHandleStoreForTesting();
});

// ============================================================================
// Test 1 — PreparedTxTron discriminator round-trip (native kind)
// ============================================================================
describe("PreparedTxTron — native kind round-trip", () => {
  it("createHandle → lookup preserves txType: 'tron' and kind: 'native'", () => {
    const tx = buildNativeTronPreparedTx();
    const handle = createHandle({
      args: buildTronPrepareArgs(),
      tx,
      payloadFingerprint: FINGERPRINT,
    });

    const result = lookup(handle);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const stored = result.record.tx as PreparedTxTron;
    expect(stored.txType).toBe("tron");
    expect(stored.kind).toBe("native");
    expect(stored.rawDataHex).toBe(FIXTURE_M_RAW_DATA_HEX);
    expect(stored.refBlockBytes).toBe("00ad");
    expect(stored.refBlockHash).toBe("8e5e7df4e3c8b9a2");
    expect(stored.expiration).toBe(1779268134000);
    expect(stored.contractAddress).toBeUndefined(); // native has no contract
  });

  it("instructionSummary native-transfer shape preserved", () => {
    const tx = buildNativeTronPreparedTx();
    const handle = createHandle({
      args: buildTronPrepareArgs(),
      tx,
      payloadFingerprint: FINGERPRINT,
    });

    const result = lookup(handle);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const stored = result.record.tx as PreparedTxTron;
    const summary = stored.instructionSummary?.[0];
    expect(summary?.kind).toBe("native-transfer");
    if (summary?.kind === "native-transfer") {
      expect(summary.from).toBe(FROM_ADDR);
      expect(summary.to).toBe(TO_ADDR);
      expect(summary.sun).toBe(1_000_000n);
    }
  });

  it("EVM sentinel fields present with zero values", () => {
    const tx = buildNativeTronPreparedTx();
    const handle = createHandle({
      args: buildTronPrepareArgs(),
      tx,
      payloadFingerprint: FINGERPRINT,
    });

    const result = lookup(handle);
    if (!result.ok) return;
    const stored = result.record.tx as PreparedTxTron;

    expect(stored.chainId).toBe(0);
    expect(stored.to).toBe("0x0000000000000000000000000000000000000000");
    expect(stored.valueWei).toBe(0n);
    expect(stored.data).toBe("0x");
  });
});

// ============================================================================
// Test 2 — PreparedTxTron discriminator round-trip (trc20 kind)
// ============================================================================
describe("PreparedTxTron — trc20 kind round-trip", () => {
  it("kind: 'trc20' + contractAddress preserved", () => {
    const tx = buildTrc20TronPreparedTx();
    const handle = createHandle({
      args: { ...buildTronPrepareArgs(), tokenAddress: USDT_ADDR },
      tx,
      payloadFingerprint: FINGERPRINT,
    });

    const result = lookup(handle);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const stored = result.record.tx as PreparedTxTron;
    expect(stored.txType).toBe("tron");
    expect(stored.kind).toBe("trc20");
    expect(stored.contractAddress).toBe(USDT_ADDR);
  });

  it("instructionSummary trc20-transfer shape preserved", () => {
    const tx = buildTrc20TronPreparedTx();
    const handle = createHandle({
      args: { ...buildTronPrepareArgs(), tokenAddress: USDT_ADDR },
      tx,
      payloadFingerprint: FINGERPRINT,
    });

    const result = lookup(handle);
    if (!result.ok) return;

    const stored = result.record.tx as PreparedTxTron;
    const summary = stored.instructionSummary?.[0];
    expect(summary?.kind).toBe("trc20-transfer");
    if (summary?.kind === "trc20-transfer") {
      expect(summary.from).toBe(FROM_ADDR);
      expect(summary.to).toBe(TO_ADDR);
      expect(summary.tokenAddress).toBe(USDT_ADDR);
      expect(summary.amount).toBe(100_000_000n);
      expect(summary.decimals).toBe(6);
    }
  });
});

// ============================================================================
// Test 3 — Back-compat: EVM handles without txType field
// ============================================================================
describe("back-compat: EVM handle without txType uses txType ?? 'evm'", () => {
  it("EVM PreparedTxEvm shape (no txType) → txType ?? 'evm' === 'evm'", () => {
    const evmTx: PreparedTx = {
      // No txType field — Phase 4-11 EVM shape
      chainId: 1,
      to: "0xabc0000000000000000000000000000000000001" as Address,
      valueWei: 1_000_000_000_000_000_000n,
      data: "0x" as Hex,
    };

    const handle = createHandle({
      args: { to: "0xabc...", valueWei: "1000000000000000000" },
      tx: evmTx,
      payloadFingerprint: "0xdeadbeef" as Hex,
    });

    const result = lookup(handle);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const stored = result.record.tx;
    // The `txType` field is absent (undefined) on EVM handles — consumers use `txType ?? "evm"`.
    expect((stored as { txType?: string }).txType ?? "evm").toBe("evm");
  });
});

// ============================================================================
// Test 4 — PrepareArgs TRON additive fields round-trip
// ============================================================================
describe("PrepareArgs TRON additive fields", () => {
  it("sun + expiration + refBlockBytes + refBlockHash round-trip", () => {
    const args = buildTronPrepareArgs();
    const handle = createHandle({
      args,
      tx: buildNativeTronPreparedTx(),
      payloadFingerprint: FINGERPRINT,
    });

    const result = lookup(handle);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.record.args.sun).toBe("1000000");
    expect(result.record.args.expiration).toBe("900");
    expect(result.record.args.refBlockBytes).toBe("00ad");
    expect(result.record.args.refBlockHash).toBe("8e5e7df4e3c8b9a2");
  });
});

// ============================================================================
// Test 5 — State-machine transitions on TRON handle
// ============================================================================
describe("state machine — TRON handle transitions", () => {
  it("prepared → previewed → sent (happy path)", () => {
    const handle = createHandle({
      args: buildTronPrepareArgs(),
      tx: buildNativeTronPreparedTx(),
      payloadFingerprint: FINGERPRINT,
    });

    const previewResult = transitionToPreviewed(handle, buildTronPinned());
    expect(previewResult.ok).toBe(true);
    expect(previewResult.ok ? previewResult.record.status : null).toBe("previewed");

    const sendResult = transitionToSent(handle, "deadbeef01234567");
    expect(sendResult.ok).toBe(true);
    expect(sendResult.ok ? sendResult.record.status : null).toBe("sent");
    expect(sendResult.ok ? sendResult.record.txHash : null).toBe("deadbeef01234567");
  });

  it("prepared → cancelled (legal)", () => {
    const handle = createHandle({
      args: buildTronPrepareArgs(),
      tx: buildNativeTronPreparedTx(),
      payloadFingerprint: FINGERPRINT,
    });

    const cancelResult = transitionToCancelled(handle);
    expect(cancelResult.ok).toBe(true);
    expect(cancelResult.ok ? cancelResult.record.status : null).toBe("cancelled");
  });

  it("sent → cancelled (illegal — WRONG_STATUS)", () => {
    const handle = createHandle({
      args: buildTronPrepareArgs(),
      tx: buildNativeTronPreparedTx(),
      payloadFingerprint: FINGERPRINT,
    });
    transitionToPreviewed(handle, buildTronPinned());
    transitionToSent(handle, "txhash");

    const cancelResult = transitionToCancelled(handle);
    expect(cancelResult.ok).toBe(false);
    if (!cancelResult.ok) {
      expect(cancelResult.errorCode).toBe("WRONG_STATUS");
    }
  });
});

// ============================================================================
// Test 6 — TTL eviction on TRON handle
// ============================================================================
describe("TTL eviction — TRON handle", () => {
  it("handle expires after HANDLE_TTL_MS (15 min)", () => {
    vi.useFakeTimers();

    const handle = createHandle({
      args: buildTronPrepareArgs(),
      tx: buildNativeTronPreparedTx(),
      payloadFingerprint: FINGERPRINT,
    });

    expect(lookup(handle).ok).toBe(true);

    // Advance time by 15 min + 1 ms to trigger lazy TTL eviction.
    vi.advanceTimersByTime(HANDLE_TTL_MS + 1);

    const result = lookup(handle);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errorCode).toBe("HANDLE_EXPIRED");
    }
  });
});
