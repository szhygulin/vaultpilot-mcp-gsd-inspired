// Phase 37 Plan 37-01 (SAFE-05) — `src/signing/safe-tx-hash.ts` fixture pins.
//
// Fixtures SAFE-A (v1.3.0 call) / SAFE-B (v1.4.1 call) / SAFE-C (v1.3.0
// delegatecall) anchor the EIP-712 typed-data digest as hardcoded `0x…` literals.
// EXPORTED so consumer tests (`test/prepare-safe-tx-propose.test.ts`,
// `test/signing-fingerprint.test.ts` Fixture SAFE-D, future 37-02 / 37-03 plans)
// can cross-link by import.
//
// NO `beforeAll`-snapshot per CLAUDE.md "Cryptographic-binding fixtures pinned
// as hardcoded literals". Drift in EIP-712 preimage assembly fails at a
// SPECIFIC line — not against a self-snapshotted value.
//
// Captured at write-time (2026-05-27) via placeholder-literal workflow:
// (1) wrote with `"0xPLACEHOLDER"`, (2) ran vitest, (3) copied actual hash,
// (4) pinned literal, (5) re-ran — green.
//
// Cross-verification (RESEARCH §1 finding — load-bearing): Safe v1.3.0 and
// v1.4.1 share BYTE-IDENTICAL EIP-712 typehashes. The `safeVersion` field is
// used at the refusal gate in `prepare_safe_tx_propose` (pre-v1.3.0 has no
// chainId in domain → cross-chain replay risk); the digest path itself is
// single. Test `"v1.3.0 and v1.4.1 share byte-identical digest"` anchors
// this finding.

import { describe, expect, it } from "vitest";
import type { Address, Hex } from "viem";

import {
  buildSafeEIP712TypedData,
  computeSafeTxHash,
} from "../src/signing/safe-tx-hash.js";

// ---------------------------------------------------------------------------
// Canonical fixture inputs. Mainnet Safe addresses + deterministic agent args.
// Persona = Anvil account 1 (0x70997970…) — matches every other fixture in
// this codebase (signing-fingerprint.test.ts FIXTURE_PERSONA + Fixture A/B/D
// `to` literals).
// ---------------------------------------------------------------------------

const FIXTURE_PERSONA: Address = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";

// SAFE-A — v1.3.0 mainnet Safe; native ETH transfer (data=0x); operation=call
// (the canonical "Alice sends 1 ETH to Bob through her v1.3.0 multisig" case).
// safeAddress lowercased so viem.hashTypedData (EIP-55 validator) accepts it
// without us needing to checksum mock test addresses.
export const FIXTURE_SAFE_A_INPUT = {
  chain: 1 as const,
  safeAddress: "0x1234567890123456789012345678901234567890" as Address,
  safeVersion: "1.3.0" as const,
  to: FIXTURE_PERSONA,
  value: 1_000_000_000_000_000_000n, // 1 ETH
  data: "0x" as Hex,
  operation: 0 as const, // call
  nonce: 42n,
};

// SAFE-B — v1.4.1 mainnet Safe; different fixture safeAddress + inputs.
// Calldata-bearing ERC-20 transfer to anchor a non-empty `data` slot.
// safeAddress lowercased per the rationale at SAFE-A above.
export const FIXTURE_SAFE_B_INPUT = {
  chain: 1 as const,
  safeAddress: "0xabcdef0123456789abcdef0123456789abcdef01" as Address,
  safeVersion: "1.4.1" as const,
  to: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48" as Address, // USDC (checksummed)
  value: 0n,
  // transfer(0x70997970…, 100e6) — canonical USDC transfer
  data: "0xa9059cbb00000000000000000000000070997970c51812dc3a010c7d01b50e0d17dc79c80000000000000000000000000000000000000000000000000000000005f5e100" as Hex,
  operation: 0 as const, // call
  nonce: 7n,
};

// SAFE-C — v1.3.0 mainnet Safe; SAME args as SAFE-A but operation=1
// (delegatecall). Anchors the delegatecall-discriminant path Phase 38's
// `enableModule + delegatecall` hard-trigger second-LLM check will key on.
export const FIXTURE_SAFE_C_INPUT = {
  ...FIXTURE_SAFE_A_INPUT,
  operation: 1 as const, // delegatecall
};

// ---------------------------------------------------------------------------
// Pinned fixture hashes. Hardcoded `0x…` literals — drift fails THIS LINE.
// ---------------------------------------------------------------------------

/** Fixture SAFE-A — v1.3.0 SafeTx hash (operation=0, call). */
export const FIXTURE_SAFE_A_HASH: Hex =
  "0xf5073f5eabcb7ff540becf339c3bbe2b5f41b5f9fec8ae1e42847d9a25fedf0a";

/** Fixture SAFE-B — v1.4.1 SafeTx hash (operation=0, call; ERC-20 transfer). */
export const FIXTURE_SAFE_B_HASH: Hex =
  "0xf198ea4907964d6b024affd19f0e81424bb9f2544e8a4904db1d1585b4fc49d0";

/** Fixture SAFE-C — v1.3.0 SafeTx hash (operation=1, delegatecall). */
export const FIXTURE_SAFE_C_HASH: Hex =
  "0x2f5b398a4f868a3149fcda1a097f6229f544554fe5e69c0c219c2f8c6080e4e2";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("computeSafeTxHash — Phase 37 / Plan 37-01 / SAFE-05", () => {
  it("Fixture SAFE-A — v1.3.0 call SafeTx → hardcoded literal byte-for-byte", () => {
    const hash = computeSafeTxHash(FIXTURE_SAFE_A_INPUT);
    expect(hash).toBe(FIXTURE_SAFE_A_HASH);
  });

  it("Fixture SAFE-B — v1.4.1 call SafeTx (ERC-20 transfer) → hardcoded literal byte-for-byte", () => {
    const hash = computeSafeTxHash(FIXTURE_SAFE_B_INPUT);
    expect(hash).toBe(FIXTURE_SAFE_B_HASH);
  });

  it("Fixture SAFE-C — v1.3.0 delegatecall SafeTx → hardcoded literal byte-for-byte (anchors Phase 38 hard-trigger discriminant)", () => {
    const hash = computeSafeTxHash(FIXTURE_SAFE_C_INPUT);
    expect(hash).toBe(FIXTURE_SAFE_C_HASH);
  });

  it("v1.3.0 and v1.4.1 share byte-identical digest for identical inputs (RESEARCH §1 — same typehashes across both versions)", () => {
    // The v1.3.0 and v1.4.1 EIP-712 typehashes are byte-identical (verified
    // against safe-smart-account source per RESEARCH §1). So a SafeTx with
    // safeVersion: "1.3.0" and one with safeVersion: "1.4.1" and ALL OTHER
    // inputs identical MUST produce the SAME safeTxHash. This anchors the
    // "single digest path" decision in safe-tx-hash.ts.
    const a = computeSafeTxHash({ ...FIXTURE_SAFE_A_INPUT, safeVersion: "1.3.0" });
    const b = computeSafeTxHash({ ...FIXTURE_SAFE_A_INPUT, safeVersion: "1.4.1" });
    expect(a).toBe(b);
  });

  it("nonce-distinctness sanity — same inputs at nonce: 0n vs 1n produce different digests", () => {
    const a = computeSafeTxHash({ ...FIXTURE_SAFE_A_INPUT, nonce: 0n });
    const b = computeSafeTxHash({ ...FIXTURE_SAFE_A_INPUT, nonce: 1n });
    expect(a).not.toBe(b);
  });

  it("operation-distinctness — SAFE-A (call) and SAFE-C (delegatecall) produce DIFFERENT digests", () => {
    // Cryptographic-binding correctness: the `operation` field IS part of the
    // SafeTx struct EIP-712 hash → call vs delegatecall MUST differ. This
    // anchors the Phase 38 hard-trigger discriminant — if SAFE-A and SAFE-C
    // ever collapse to the same digest, the discriminant is broken.
    expect(FIXTURE_SAFE_A_HASH).not.toBe(FIXTURE_SAFE_C_HASH);
  });

  it("buildSafeEIP712TypedData defaults gas-relay fields to zero per Safe v1.3.0+ non-relayed convention", () => {
    // RESEARCH §Pitfall 7 — modern Safe non-relayed txs set all 5 gas-relay
    // fields to zero. Defaulting them at the builder level keeps the digest
    // matched with the standard Safe UI flow.
    const td = buildSafeEIP712TypedData(FIXTURE_SAFE_A_INPUT);
    expect(td.message.safeTxGas).toBe(0n);
    expect(td.message.baseGas).toBe(0n);
    expect(td.message.gasPrice).toBe(0n);
    expect(td.message.gasToken).toBe("0x0000000000000000000000000000000000000000");
    expect(td.message.refundReceiver).toBe("0x0000000000000000000000000000000000000000");
  });

  it("buildSafeEIP712TypedData carries chainId as number (not bigint) — RESEARCH §Pitfall 2 pin", () => {
    const td = buildSafeEIP712TypedData(FIXTURE_SAFE_A_INPUT);
    expect(typeof td.domain.chainId).toBe("number");
    expect(td.domain.chainId).toBe(1);
  });

  it("Fixtures SAFE-A / SAFE-B / SAFE-C produce 3 distinct digests", () => {
    // Sanity: if SAFE-A and SAFE-B accidentally collapse (e.g. a regression
    // that drops the safeAddress slot from the domain), this Set-size
    // assertion fires before the per-fixture assertions.
    const distinct = new Set([FIXTURE_SAFE_A_HASH, FIXTURE_SAFE_B_HASH, FIXTURE_SAFE_C_HASH]);
    expect(distinct.size).toBe(3);
  });
});
