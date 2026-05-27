// handle-store — Phase 37 Plan 37-01 (SAFE-05) discriminated-union widening
// regression. Sibling of `test/handle-store.solana.test.ts` (Plan 12-01) and
// the byte-frozen `test/signing-handle-store.test.ts` (Phase 4 EVM precedent).
//
// What this file proves:
//   1. createHandle accepts a PreparedTxSafeTypedData tx — round-trips via lookup;
//      the `txType: "safe-typed-data"` discriminant survives + all
//      Safe-specific cryptographic-binding fields preserved byte-identical.
//   2. transitionToSent accepts the SafeTx hash (FIXTURE_SAFE_A_HASH from Plan
//      37-01 fixture file) as the `txHash` argument — the field was widened to
//      `string` in Plan 12-05 explicitly for non-EVM identifiers; Safe-typed-data
//      handles reuse this widening for the off-chain digest.
//   3. TypeScript discriminated-union narrowing — a `switch (record.tx.txType)`
//      block with the new "safe-typed-data" arm compiles + routes at runtime.
//   4. State-machine transitions (prepared → previewed → sent, prepared →
//      cancelled, illegal transitions refused) work UNCHANGED on Safe-typed-data
//      handles — the new discriminant is the only additive shape.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Address, Hex } from "viem";

import {
  _resetHandleStoreForTesting,
  createHandle,
  lookup,
  transitionToCancelled,
  transitionToPreviewed,
  transitionToSent,
} from "../src/signing/handle-store.js";
import type {
  PreparedTx,
  PreparedTxSafeTypedData,
  PreviewPinned,
} from "../src/signing/handle-store.js";
import {
  FIXTURE_SAFE_A_HASH,
  FIXTURE_SAFE_A_INPUT,
} from "./signing-safe-tx-hash.test.js";
import { buildSafeEIP712TypedData } from "../src/signing/safe-tx-hash.js";

// ---------------------------------------------------------------------------
// Fixtures — SAFE-A-derived to anchor cross-link with Plan 37-01 fixture file.
// ---------------------------------------------------------------------------

const SAFE_FINGERPRINT =
  "0xbd55bd01d22779249cb10b8ecea6f87c85f511a024175b7dc0aa3ac1c7dad71b" as Hex; // FIXTURE_SAFE_D_FP

function buildSafePreparedTx(): PreparedTxSafeTypedData {
  return {
    txType: "safe-typed-data",
    // EVM-shape sentinels — every field set to its canonical zero value.
    chainId: 0,
    to: "0x0000000000000000000000000000000000000000" as Address,
    valueWei: 0n,
    data: "0x" as Hex,
    // Safe-specific cryptographic-binding fields — sourced from Fixture SAFE-A.
    chain: FIXTURE_SAFE_A_INPUT.chain,
    safeAddress: FIXTURE_SAFE_A_INPUT.safeAddress,
    safeVersion: FIXTURE_SAFE_A_INPUT.safeVersion,
    safeTxHash: FIXTURE_SAFE_A_HASH,
    safeNonce: FIXTURE_SAFE_A_INPUT.nonce,
    operation: "call",
    safeTxTo: FIXTURE_SAFE_A_INPUT.to,
    safeTxValue: FIXTURE_SAFE_A_INPUT.value,
    safeTxData: FIXTURE_SAFE_A_INPUT.data,
    safeTxGas: 0n,
    baseGas: 0n,
    gasPrice: 0n,
    gasToken: "0x0000000000000000000000000000000000000000" as Address,
    refundReceiver: "0x0000000000000000000000000000000000000000" as Address,
    typedDataStructure: buildSafeEIP712TypedData(FIXTURE_SAFE_A_INPUT),
  };
}

function buildSafePinned(
  previewToken = "11111111-2222-4222-8222-222222222222",
): PreviewPinned {
  // Safe typed-data handles never reach preview_send through the EVM branch
  // (Plan 37-03 wires the WRONG_HANDLE_KIND refusal arm for send_transaction).
  // Sentinel zeros mirror the Solana / TRON / BTC precedents — type-stability
  // preserved across the union; the values are never read.
  return {
    nonce: 0,
    gas: 0n,
    maxFeePerGas: 0n,
    maxPriorityFeePerGas: 0n,
    previewToken,
    presignHash:
      "0x0000000000000000000000000000000000000000000000000000000000000000" as Hex,
    selector: null,
  };
}

beforeEach(() => {
  _resetHandleStoreForTesting();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("handle-store — PreparedTxSafeTypedData round-trip (Phase 37 Plan 37-01)", () => {
  it("createHandle accepts a PreparedTxSafeTypedData tx — lookup returns the same shape byte-identical", () => {
    const tx = buildSafePreparedTx();
    const handle = createHandle({
      args: { to: "", valueWei: "0" },
      tx,
      payloadFingerprint: SAFE_FINGERPRINT,
    });

    const result = lookup(handle);
    expect(result.ok).toBe(true);
    if (!result.ok) return; // type guard for the rest of the block
    expect(result.record.tx.txType).toBe("safe-typed-data");

    // Narrow on the discriminant + assert every Safe-specific field round-tripped.
    const recoveredTx = result.record.tx as PreparedTxSafeTypedData;
    expect(recoveredTx.chain).toBe(FIXTURE_SAFE_A_INPUT.chain);
    expect(recoveredTx.safeAddress).toBe(FIXTURE_SAFE_A_INPUT.safeAddress);
    expect(recoveredTx.safeVersion).toBe("1.3.0");
    expect(recoveredTx.safeTxHash).toBe(FIXTURE_SAFE_A_HASH);
    expect(recoveredTx.safeNonce).toBe(FIXTURE_SAFE_A_INPUT.nonce);
    expect(recoveredTx.operation).toBe("call");
    expect(recoveredTx.safeTxTo).toBe(FIXTURE_SAFE_A_INPUT.to);
    expect(recoveredTx.safeTxValue).toBe(FIXTURE_SAFE_A_INPUT.value);
    expect(recoveredTx.safeTxData).toBe(FIXTURE_SAFE_A_INPUT.data);
    // EVM-shape sentinels preserved at zero.
    expect(recoveredTx.chainId).toBe(0);
    expect(recoveredTx.valueWei).toBe(0n);
    expect(recoveredTx.data).toBe("0x");
    // typedDataStructure is the full domain+types+message — surface check.
    expect(recoveredTx.typedDataStructure.primaryType).toBe("SafeTx");
    expect(recoveredTx.typedDataStructure.domain.verifyingContract).toBe(
      FIXTURE_SAFE_A_INPUT.safeAddress,
    );
  });

  it("transitionToSent accepts the SafeTx hash (string) as txHash argument", () => {
    const tx = buildSafePreparedTx();
    const handle = createHandle({
      args: { to: "", valueWei: "0" },
      tx,
      payloadFingerprint: SAFE_FINGERPRINT,
    });
    const previewRes = transitionToPreviewed(handle, buildSafePinned());
    expect(previewRes.ok).toBe(true);

    // Pass the SafeTx hash (the EIP-712 digest) — same field, different
    // semantic (RESEARCH §Open Question 1; Plan 12-05 widening).
    const sentRes = transitionToSent(handle, FIXTURE_SAFE_A_HASH);
    expect(sentRes.ok).toBe(true);
    if (!sentRes.ok) return;
    expect(sentRes.record.status).toBe("sent");
    expect(sentRes.record.txHash).toBe(FIXTURE_SAFE_A_HASH);
    expect(sentRes.record.sentAt).toBeGreaterThan(0);
  });

  it("discriminated-union narrowing — a switch on record.tx.txType compiles + routes the new 'safe-typed-data' arm", () => {
    const tx = buildSafePreparedTx();
    const handle = createHandle({
      args: { to: "", valueWei: "0" },
      tx,
      payloadFingerprint: SAFE_FINGERPRINT,
    });
    const res = lookup(handle);
    if (!res.ok) throw new Error("lookup failed");

    // The runtime switch exercises the compile-time discriminated-union
    // narrowing. TS strict mode rejects this block if PreparedTxSafeTypedData
    // is missing from the PreparedTx union or if "safe-typed-data" is not the
    // discriminator literal. The arm-per-kind shape mirrors the existing
    // send_transaction.ts dispatch surface (Phase 37-03 wires the actual arm
    // there as a WRONG_HANDLE_KIND refusal; this test is the typed-narrowing
    // smoke test).
    function discriminate(record: { tx: PreparedTx }): string {
      const txType = record.tx.txType ?? "evm";
      switch (txType) {
        case "evm":
          return "evm";
        case "solana":
          return "solana";
        case "tron":
          return "tron";
        case "btc":
          return "btc";
        case "litecoin":
          return "litecoin";
        case "btc-lifi":
          return "btc-lifi";
        case "safe-typed-data":
          return "safe-typed-data";
        default: {
          // Exhaustiveness check — TS errors here if any union arm is missed.
          const _exhaustive: never = txType;
          return _exhaustive;
        }
      }
    }
    expect(discriminate(res.record)).toBe("safe-typed-data");
  });

  it("state machine — prepared → previewed → sent path unchanged on Safe-typed-data handles", () => {
    const tx = buildSafePreparedTx();
    const handle = createHandle({
      args: { to: "", valueWei: "0" },
      tx,
      payloadFingerprint: SAFE_FINGERPRINT,
    });
    const initial = lookup(handle);
    expect(initial.ok).toBe(true);
    if (!initial.ok) return;
    expect(initial.record.status).toBe("prepared");

    const previewed = transitionToPreviewed(handle, buildSafePinned());
    expect(previewed.ok).toBe(true);
    if (!previewed.ok) return;
    expect(previewed.record.status).toBe("previewed");

    const sent = transitionToSent(handle, FIXTURE_SAFE_A_HASH);
    expect(sent.ok).toBe(true);
    if (!sent.ok) return;
    expect(sent.record.status).toBe("sent");
  });

  it("state machine — prepared → cancelled path unchanged on Safe-typed-data handles", () => {
    const tx = buildSafePreparedTx();
    const handle = createHandle({
      args: { to: "", valueWei: "0" },
      tx,
      payloadFingerprint: SAFE_FINGERPRINT,
    });
    const cancelled = transitionToCancelled(handle);
    expect(cancelled.ok).toBe(true);
    if (!cancelled.ok) return;
    expect(cancelled.record.status).toBe("cancelled");
  });

  it("state machine — sent → cancelled refused (terminal status invariant) on Safe-typed-data handles", () => {
    const tx = buildSafePreparedTx();
    const handle = createHandle({
      args: { to: "", valueWei: "0" },
      tx,
      payloadFingerprint: SAFE_FINGERPRINT,
    });
    transitionToPreviewed(handle, buildSafePinned());
    transitionToSent(handle, FIXTURE_SAFE_A_HASH);
    const refused = transitionToCancelled(handle);
    expect(refused.ok).toBe(false);
    if (refused.ok) return;
    expect(refused.errorCode).toBe("WRONG_STATUS");
  });
});
