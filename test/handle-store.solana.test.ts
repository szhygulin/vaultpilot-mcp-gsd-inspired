// handle-store — Plan 12-01 discriminated-union widening regression. Sibling of
// `test/signing-handle-store.test.ts`, which stays byte-frozen (asserts every
// Phase 4-11 EVM-side handle flow still passes byte-identically — back-compat
// witness).
//
// What this file proves:
//   1. Default `txType` for an EVM handle is `"evm"` (or absent) — every
//      Phase 4-11 call site that omits the field flows through this widening
//      without change.
//   2. Solana handles round-trip via `createHandle` / `lookup`: discriminator
//      preserved, messageBytes byte-identical.
//   3. `PreviewPinned` shape stays uniform across chains via the sentinel-
//      zero pattern (Solana branch fills `nonce`/`gas`/etc with zero,
//      `selector: null`).
//   4. State-machine transitions (prepared → previewed → sent, prepared →
//      cancelled, illegal transitions refused) work UNCHANGED on Solana
//      handles — the discriminator is the only additive shape.
//   5. TTL eviction (15 min) fires UNCHANGED on Solana handles.

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
  PreparedTx,
  PreparedTxSolana,
  PreviewPinned,
} from "../src/signing/handle-store.js";

// --- Fixtures ---------------------------------------------------------------

const FINGERPRINT = "0x7c3d1fbcea9a6823b6e1bbb76b45ec68cd4998f25727d3bfb7b17a389040d0d3" as Hex;
const PRESIGN_HASH = "0xe3556abe46f8dde70626fcf0f1afeaef6ff5328aa88f37931c9e7208e58617a2" as Hex;

const SOLANA_WHALE = "5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9";
const SOLANA_RECIPIENT = "AKnL4NNf3DGWZJS6cPknBuEGnVsV4A4m5tgebLHaRSZ9";
const SYSTEM_PROGRAM = "11111111111111111111111111111111";
const FIXED_BLOCKHASH = SYSTEM_PROGRAM;

// Build a Solana PreparedTx. The EVM-shape sentinel fields are populated with
// the canonical zero values (rationale lives in `handle-store.ts` next to
// `PreparedTxSolana` definition — keep the discriminated union accessible by
// existing EVM consumers without forcing narrowing at every site).
function buildSolanaPreparedTx(): PreparedTxSolana {
  return {
    txType: "solana",
    chainId: 0,
    to: "0x0000000000000000000000000000000000000000" as Address,
    valueWei: 0n,
    data: "0x" as Hex,
    messageBytes: new Uint8Array([
      // First 32 bytes of Fixture K message — sufficient for round-trip
      // byte-identity; full bytes live in the fingerprint test.
      0x01, 0x00, 0x01, 0x03, 0x48, 0xc0, 0x1b, 0x50, 0x59, 0x00, 0x54, 0x55,
      0xd9, 0xdc, 0xb0, 0xc6, 0xbc, 0xec, 0xdc, 0xb4, 0xfb, 0x5b, 0x2e, 0xab,
      0xc1, 0xa9, 0xa8, 0x2b, 0x57, 0x39, 0x2b, 0xaa,
    ]),
    feePayer: SOLANA_WHALE,
    recentBlockhash: FIXED_BLOCKHASH,
    programIds: [SYSTEM_PROGRAM],
    instructionSummary: [
      {
        kind: "native-transfer",
        from: SOLANA_WHALE,
        to: SOLANA_RECIPIENT,
        lamports: 1_000_000_000n,
      },
    ],
  };
}

function buildSolanaPinned(
  previewToken = "ccccccc1-cccc-4ccc-8ccc-ccccccccccc1",
): PreviewPinned {
  return {
    // Sentinel zeros — Solana branch never reads these; preview_send Solana
    // branch + send_transaction Solana branch consume only `previewToken` +
    // `presignHash`. Type-stability preserved across chains.
    nonce: 0,
    gas: 0n,
    maxFeePerGas: 0n,
    maxPriorityFeePerGas: 0n,
    previewToken,
    presignHash: PRESIGN_HASH,
    selector: null,
  };
}

// --- Tests ------------------------------------------------------------------

beforeEach(() => {
  _resetHandleStoreForTesting();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("handle-store — Plan 12-01 back-compat: default txType for EVM handles", () => {
  it("Phase 4-11 EVM handle without txType: record.tx.txType is undefined; ?? \"evm\" yields evm", () => {
    // Mirrors the existing test/signing-handle-store.test.ts shape — no
    // txType field. The widening MUST leave this byte-identical.
    const handle = createHandle({
      args: { to: "0xabc", valueWei: "1000000000000000000" },
      tx: {
        chainId: 1,
        to: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" as Address,
        valueWei: 1_000_000_000_000_000_000n,
        data: "0x" as Hex,
      },
      payloadFingerprint:
        "0x7e1867b2e6bc98cbce57bb901a33e973c749565eb19f8b86056197c7a20b2f5a" as Hex,
    });

    const result = lookup(handle);
    expect(result.ok).toBe(true);
    if (result.ok) {
      // Default narrowing pattern downstream consumers will use:
      //   const txType = record.tx.txType ?? "evm";
      const txType = (result.record.tx as PreparedTx).txType ?? "evm";
      expect(txType).toBe("evm");
      // Existing EVM fields preserved.
      expect(result.record.tx.chainId).toBe(1);
      expect(result.record.tx.to).toBe(
        "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
      );
    }
  });
});

describe("handle-store — Plan 12-01 Solana round-trip", () => {
  it("createHandle + lookup preserves the Solana discriminator + messageBytes byte-identically", () => {
    const tx = buildSolanaPreparedTx();
    const originalBytes = tx.messageBytes;

    const handle = createHandle({
      args: {
        to: SOLANA_RECIPIENT,
        valueWei: "0",
        lamports: "1000000000",
        recentBlockhash: FIXED_BLOCKHASH,
      },
      tx,
      payloadFingerprint: FINGERPRINT,
    });

    const result = lookup(handle);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.record.status).toBe("prepared");
      expect(result.record.tx.txType).toBe("solana");
      if (result.record.tx.txType === "solana") {
        // messageBytes byte-identical to input (live reference, not deep-copy
        // — handle-store doesn't deep-copy; existing EVM behavior preserved).
        expect(result.record.tx.messageBytes).toBe(originalBytes);
        expect(result.record.tx.feePayer).toBe(SOLANA_WHALE);
        expect(result.record.tx.recentBlockhash).toBe(FIXED_BLOCKHASH);
        expect(result.record.tx.programIds).toEqual([SYSTEM_PROGRAM]);
        expect(result.record.tx.instructionSummary).toBeDefined();
        expect(result.record.tx.instructionSummary?.[0]?.kind).toBe("native-transfer");
      }
      // PrepareArgs widening surfaces lamports + recentBlockhash + verbatim agent strings.
      expect(result.record.args.lamports).toBe("1000000000");
      expect(result.record.args.recentBlockhash).toBe(FIXED_BLOCKHASH);
      expect(result.record.args.to).toBe(SOLANA_RECIPIENT);
    }
  });
});

describe("handle-store — Plan 12-01 PreviewPinned sentinel-zeros for Solana", () => {
  it("transitionToPreviewed populates Solana branch with sentinel zeros + non-zero previewToken + presignHash", () => {
    const handle = createHandle({
      args: { to: SOLANA_RECIPIENT, valueWei: "0", lamports: "1000000000" },
      tx: buildSolanaPreparedTx(),
      payloadFingerprint: FINGERPRINT,
    });
    const pinned = buildSolanaPinned();
    const result = transitionToPreviewed(handle, pinned);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.record.status).toBe("previewed");
      expect(result.record.pinned).toBe(pinned);
      // Sentinel zeros preserved (proves type-stability: same shape as EVM
      // PreviewPinned; Solana branch never reads these fields).
      expect(result.record.pinned?.nonce).toBe(0);
      expect(result.record.pinned?.gas).toBe(0n);
      expect(result.record.pinned?.maxFeePerGas).toBe(0n);
      expect(result.record.pinned?.maxPriorityFeePerGas).toBe(0n);
      expect(result.record.pinned?.selector).toBeNull();
      // Load-bearing fields populated.
      expect(result.record.pinned?.previewToken).toBe(
        "ccccccc1-cccc-4ccc-8ccc-ccccccccccc1",
      );
      expect(result.record.pinned?.presignHash).toBe(PRESIGN_HASH);
    }
  });
});

describe("handle-store — Plan 12-01 Solana state-machine transitions UNCHANGED", () => {
  it("prepared → previewed → sent legal sequence on Solana handle", () => {
    const handle = createHandle({
      args: { to: SOLANA_RECIPIENT, valueWei: "0", lamports: "1000000000" },
      tx: buildSolanaPreparedTx(),
      payloadFingerprint: FINGERPRINT,
    });

    expect(transitionToPreviewed(handle, buildSolanaPinned()).ok).toBe(true);

    // For Solana, "txHash" is the broadcast tx signature in base58 — but the
    // handle-store stores it as Hex (existing field type). Plan 12-05 will
    // surface a Solana-flavored signature via a separate field; for Plan
    // 12-01 we use a hex-shape placeholder to exercise the transition path
    // byte-identically.
    const placeholderHash =
      "0xfeedface00000000000000000000000000000000000000000000000000000000" as Hex;
    const sent = transitionToSent(handle, placeholderHash);
    expect(sent.ok).toBe(true);
    if (sent.ok) {
      expect(sent.record.status).toBe("sent");
      expect(sent.record.txHash).toBe(placeholderHash);
    }
  });

  it("illegal: prepared → sent (no preview) refuses with WRONG_STATUS on Solana handle", () => {
    const handle = createHandle({
      args: { to: SOLANA_RECIPIENT, valueWei: "0", lamports: "1" },
      tx: buildSolanaPreparedTx(),
      payloadFingerprint: FINGERPRINT,
    });

    const placeholderHash =
      "0xfeedface00000000000000000000000000000000000000000000000000000000" as Hex;
    const result = transitionToSent(handle, placeholderHash);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errorCode).toBe("WRONG_STATUS");
    }
    // Record status unchanged.
    const after = lookup(handle);
    expect(after.ok && after.record.status).toBe("prepared");
  });

  it("prepared → cancelled on Solana handle; subsequent transitionToPreviewed refuses", () => {
    const handle = createHandle({
      args: { to: SOLANA_RECIPIENT, valueWei: "0", lamports: "1" },
      tx: buildSolanaPreparedTx(),
      payloadFingerprint: FINGERPRINT,
    });

    const cancelled = transitionToCancelled(handle);
    expect(cancelled.ok).toBe(true);
    if (cancelled.ok) {
      expect(cancelled.record.status).toBe("cancelled");
      expect(typeof cancelled.record.cancelledAt).toBe("number");
    }

    const rePreview = transitionToPreviewed(handle, buildSolanaPinned());
    expect(rePreview.ok).toBe(false);
    if (!rePreview.ok) expect(rePreview.errorCode).toBe("WRONG_STATUS");
  });
});

describe("handle-store — Plan 12-01 Solana TTL UNCHANGED (15 min lazy eviction)", () => {
  it("lookup past HANDLE_TTL_MS on a Solana handle returns HANDLE_EXPIRED + evicts", () => {
    vi.useFakeTimers();
    const handle = createHandle({
      args: { to: SOLANA_RECIPIENT, valueWei: "0", lamports: "1" },
      tx: buildSolanaPreparedTx(),
      payloadFingerprint: FINGERPRINT,
    });

    vi.advanceTimersByTime(HANDLE_TTL_MS + 1);

    const result = lookup(handle);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errorCode).toBe("HANDLE_EXPIRED");

    // Eviction confirmed — second lookup returns HANDLE_NOT_FOUND.
    const after = lookup(handle);
    expect(after.ok).toBe(false);
    if (!after.ok) expect(after.errorCode).toBe("HANDLE_NOT_FOUND");
  });
});
