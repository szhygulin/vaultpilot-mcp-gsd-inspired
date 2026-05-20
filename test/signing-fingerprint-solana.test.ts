// SOL-PREP-01 — Solana payloadFingerprint canonical-fixture regression file.
// Sibling of `test/signing-fingerprint.test.ts` (EVM). Phase 12 — Plan 12-01.
//
// Fixture taxonomy (CLAUDE.md "Cryptographic-binding fixtures pinned as
// hardcoded literals" — NO `beforeAll`-snapshot; drift in preimage assembly
// MUST fail at a specific line, not pass against a self-snapshotted value):
//
//   Fixture K — native SOL transfer fingerprint (consumed by
//               `test/prepare-solana-native-send.test.ts` Plan 12-02 +
//               `test/solana-trust-pipeline.integration.test.ts` Plan 12-05).
//   Fixture L — SPL TransferChecked fingerprint (consumed by
//               `test/prepare-solana-spl-send.test.ts` Plan 12-03 +
//               `test/solana-trust-pipeline.integration.test.ts` Plan 12-05).
//
// Phase 8 Fixture J at `test/signing-fingerprint.test.ts:182` (chain-distinctness
// property over the EVM family of chainIds) is FROZEN — Solana fixtures live
// here per RESEARCH OQ-2 lock.
//
// SENDER-DEPENDENCE: the Solana fingerprint includes `feePayer` (account_keys[0]
// of `Transaction.serializeMessage()`), so swapping the feePayer DOES change the
// fingerprint. This is correct — Solana's signed message bytes include
// account_keys[0], unlike EVM's EIP-1559 preimage which omits the `from`
// field. The persona-cycle property assertion lands in the integration test
// (Plan 12-05), mirroring Phase 7's T-INTEGRATION-FROM-DRIFT-2 precedent.

import { PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import {
  createTransferCheckedInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { describe, expect, it, vi } from "vitest";

import {
  FINGERPRINT_DOMAIN_TAG_SOLANA,
  _solanaFingerprint,
  computeSolanaPayloadFingerprint,
} from "../src/signing/payload-fingerprint-solana.js";

// Pinned inputs — used identically by Fixture K + L. Stable across runs.
// `FROM` is the curated `solana-whale` persona address from Plan 11-06
// (Binance hot wallet). `TO` is a deterministic on-curve recipient generated
// from `Keypair.fromSeed(Buffer.alloc(32, 1))` — pinned as a literal so the
// test does not depend on Keypair internals.
const FROM = new PublicKey("5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9");
const TO = new PublicKey("AKnL4NNf3DGWZJS6cPknBuEGnVsV4A4m5tgebLHaRSZ9");
// Fixed-blockhash sentinel — all-1s base58 form is the canonical
// "system program address" pubkey shape; pinned here as a deterministic
// blockhash value so message serialization is stable across test runs.
const FIXED_BLOCKHASH = "11111111111111111111111111111111";

describe("computeSolanaPayloadFingerprint — SOL-PREP-01 (DF-1 LOCKED)", () => {
  it("domain-tag length invariant: 20 UTF-8 bytes (distinct from EVM 23-byte tag)", () => {
    // String-length invariant (matches the plan's success criterion).
    expect(FINGERPRINT_DOMAIN_TAG_SOLANA.length).toBe(20);
    // UTF-8 byte-length invariant — load-bearing: cross-chain reuse impossible
    // by construction (EVM tag is 23 bytes; mismatched-length preimage cannot
    // collide). Plan 12-PLAN-CHECK verified the two assertions agree because
    // the tag contains only ASCII characters (each ≤ 0x7F, so .length === byteLength).
    expect(Buffer.byteLength(FINGERPRINT_DOMAIN_TAG_SOLANA, "utf8")).toBe(20);
    // Exact tag value pinned — prevents accidental rename / version bump
    // without explicit intent. v2 fingerprint format would change "v1:" → "v2:".
    expect(FINGERPRINT_DOMAIN_TAG_SOLANA).toBe("VaultPilot-soltx-v1:");
  });

  it("Fixture K — native SOL transfer fingerprint (hardcoded literal anchor)", () => {
    // Build the canonical Fixture K transaction:
    //   feePayer = solana-whale persona
    //   instruction = SystemProgram.transfer(FROM → TO, 1_000_000_000 lamports = 1 SOL)
    //   recentBlockhash = "1111…" sentinel (pinned for deterministic message bytes)
    const tx = new Transaction({
      recentBlockhash: FIXED_BLOCKHASH,
      feePayer: FROM,
    });
    tx.add(
      SystemProgram.transfer({
        fromPubkey: FROM,
        toPubkey: TO,
        lamports: 1_000_000_000,
      }),
    );
    const messageBytes = new Uint8Array(tx.serializeMessage());
    // Stable byte-length anchor — catches any future serializeMessage shape change.
    expect(messageBytes.length).toBe(150);

    const fp = computeSolanaPayloadFingerprint({ messageBytes });

    // Hardcoded literal anchor (Plan 12-01 hardening — execute-time
    // computation pinned forever). Independently computed at PR-write time
    // via a discardable `node -e` script:
    //   const { keccak256, toBytes, concat } = require("viem");
    //   const tag = toBytes("VaultPilot-soltx-v1:");
    //   keccak256(concat([tag, messageBytes]))
    // Cross-linked from `test/prepare-solana-native-send.test.ts` (Plan
    // 12-02) and `test/solana-trust-pipeline.integration.test.ts` (Plan 12-05).
    expect(fp).toBe("0x7c3d1fbcea9a6823b6e1bbb76b45ec68cd4998f25727d3bfb7b17a389040d0d3");
  });

  it("Fixture L — SPL TransferChecked fingerprint (hardcoded literal anchor)", () => {
    // Build the canonical Fixture L transaction:
    //   feePayer = solana-whale persona
    //   instruction = TransferChecked(sourceAta → destAta, 100_000_000 raw, decimals=6)
    //     mint     = USDC-Solana (EPjF…)
    //     authority = FROM (the owner of sourceAta)
    //   recentBlockhash = "1111…" sentinel.
    // Both ATAs are deterministic per `getAssociatedTokenAddressSync` (derived
    // from owner + mint via PDA seeds) — no random Keypair involvement.
    const USDC_MINT = new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
    const sourceAta = getAssociatedTokenAddressSync(USDC_MINT, FROM);
    const destAta = getAssociatedTokenAddressSync(USDC_MINT, TO);
    // Stable ATA literals — catches any future ATA-derivation change.
    expect(sourceAta.toBase58()).toBe("FzbcyEZ9m8xjtergWgWDq7mfPoHEbboBF791B6cTpzbq");
    expect(destAta.toBase58()).toBe("3wvJdyFnGvaMWpbq93NU91SggiVRveULUXL6iX5VZDGP");

    const tx = new Transaction({
      recentBlockhash: FIXED_BLOCKHASH,
      feePayer: FROM,
    });
    tx.add(
      createTransferCheckedInstruction(
        sourceAta,
        USDC_MINT,
        destAta,
        FROM,
        100_000_000,
        6,
      ),
    );
    const messageBytes = new Uint8Array(tx.serializeMessage());
    expect(messageBytes.length).toBe(214);

    const fp = computeSolanaPayloadFingerprint({ messageBytes });

    // Hardcoded literal anchor (Plan 12-01 hardening). Cross-linked from
    // `test/prepare-solana-spl-send.test.ts` (Plan 12-03) and
    // `test/solana-trust-pipeline.integration.test.ts` (Plan 12-05).
    expect(fp).toBe("0xabc93c06958f81a6bf9e626f9ac6437c80aac0ee55a1bafb984c266619e8bd92");
  });

  it("Fixture L calldata-embedding regression: amount swap changes fingerprint", () => {
    // Same setup as Fixture L but with amount = 100_000_001 (one raw unit
    // more). The fingerprint MUST differ — proves the instruction data IS
    // in the preimage (regression against an accidentally-static preimage
    // assembly that ignores instruction data). Mirrors Phase 6 Fixture D
    // shape.
    const USDC_MINT = new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
    const sourceAta = getAssociatedTokenAddressSync(USDC_MINT, FROM);
    const destAta = getAssociatedTokenAddressSync(USDC_MINT, TO);

    const txA = new Transaction({ recentBlockhash: FIXED_BLOCKHASH, feePayer: FROM });
    txA.add(
      createTransferCheckedInstruction(sourceAta, USDC_MINT, destAta, FROM, 100_000_000, 6),
    );
    const fpA = computeSolanaPayloadFingerprint({
      messageBytes: new Uint8Array(txA.serializeMessage()),
    });

    const txB = new Transaction({ recentBlockhash: FIXED_BLOCKHASH, feePayer: FROM });
    txB.add(
      createTransferCheckedInstruction(sourceAta, USDC_MINT, destAta, FROM, 100_000_001, 6),
    );
    const fpB = computeSolanaPayloadFingerprint({
      messageBytes: new Uint8Array(txB.serializeMessage()),
    });

    expect(fpA).not.toBe(fpB);
    // Both are well-formed 32-byte 0x-prefixed hex strings (66 chars total).
    expect(fpA).toMatch(/^0x[0-9a-f]{64}$/);
    expect(fpB).toMatch(/^0x[0-9a-f]{64}$/);
    // Anchor on the +1 fixture literal so a future preimage-assembly drift
    // surfaces at this exact line rather than as a generic "not equal".
    expect(fpB).toBe("0x9b6b628f30ed1dc6eeefa3dc258586fc3e21422000d09ad72cc2e7c67a8060fe");
  });

  it("_solanaFingerprint spy-affordance regression — ESM indirection intercepts", () => {
    // CLAUDE.md ESM spy-affordance non-negotiable: the indirection object is
    // present (added at write time, NOT retroactively). A direct
    // `vi.spyOn(*, "computeSolanaPayloadFingerprint")` on the named export
    // would silently no-op due to immutable ESM bindings; the indirection
    // is the test seam. This test proves the seam works — Plans 12-02 /
    // 12-04 / 12-05 will rely on it.
    const spy = vi
      .spyOn(_solanaFingerprint, "computeSolanaPayloadFingerprint")
      .mockReturnValue("0xdeadbeef" as `0x${string}`);

    const fakeBytes = new Uint8Array([1, 2, 3, 4]);
    const result = _solanaFingerprint.computeSolanaPayloadFingerprint({
      messageBytes: fakeBytes,
    });

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith({ messageBytes: fakeBytes });
    expect(result).toBe("0xdeadbeef");

    spy.mockRestore();
  });
});
