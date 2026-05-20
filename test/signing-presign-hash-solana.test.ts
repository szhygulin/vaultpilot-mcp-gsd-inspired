// SOL-PREP-02 — Solana presignHash canonical-fixture regression file.
// Sibling of `test/signing-presign-hash.test.ts` (EVM). Phase 12 — Plan 12-01.
//
// The Solana presignHash is the SHA-256 of `Transaction.serializeMessage()`
// bytes — what the Ledger SOL app displays in blind-sign mode (confirmed
// against `LedgerHQ/app-solana/src/handle_sign_message.c::cx_hash_sha256(...)`
// per RESEARCH Topic 2). Distinct from the Solana payloadFingerprint
// (keccak256 with domain tag) — the two helpers serve different layers:
// fingerprint binds at the server, presignHash is the on-device cross-check.

import { PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import { describe, expect, it, vi } from "vitest";

import {
  _solanaPresign,
  computeSolanaPresignHash,
} from "../src/signing/presign-hash-solana.js";

// Fixture K inputs — identical pinning to `test/signing-fingerprint-solana.test.ts`.
// Using the same fixture across fingerprint + presign tests proves they
// operate on the same `messageBytes` (same trust anchor across DF-1 + DF-2).
const FROM = new PublicKey("5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9");
const TO = new PublicKey("AKnL4NNf3DGWZJS6cPknBuEGnVsV4A4m5tgebLHaRSZ9");
const FIXED_BLOCKHASH = "11111111111111111111111111111111";

function buildFixtureKMessageBytes(): Uint8Array {
  const tx = new Transaction({ recentBlockhash: FIXED_BLOCKHASH, feePayer: FROM });
  tx.add(
    SystemProgram.transfer({
      fromPubkey: FROM,
      toPubkey: TO,
      lamports: 1_000_000_000,
    }),
  );
  return new Uint8Array(tx.serializeMessage());
}

describe("computeSolanaPresignHash — SOL-PREP-02 (DF-2 LOCKED)", () => {
  it("Fixture K presign hash (hardcoded SHA-256 literal anchor)", () => {
    const messageBytes = buildFixtureKMessageBytes();
    // Stable byte-length anchor (matches `test/signing-fingerprint-solana.test.ts`).
    expect(messageBytes.length).toBe(150);

    const result = computeSolanaPresignHash({ messageBytes });

    // Hardcoded SHA-256 literal — computed independently at PR-write time via:
    //   node -e 'console.log("0x" + require("crypto").createHash("sha256")
    //                       .update(<messageBytes hex>).digest("hex"))'
    // Per CLAUDE.md "drift must fail at a specific line" — NOT a
    // beforeAll-snapshot, NOT a self-referencing helper result. This literal
    // is the trust anchor: if the helper's hash function drifts (keccak256
    // sneak-in, SHA-384 typo, double-hash bug), this exact line fails.
    expect(result.presignHash).toBe(
      "0xe3556abe46f8dde70626fcf0f1afeaef6ff5328aa88f37931c9e7208e58617a2",
    );

    // Hash shape: 32-byte 0x-prefixed hex (66 chars including the prefix).
    expect(result.presignHash).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it("round-trip equality: helper does not mutate input bytes", () => {
    const messageBytes = buildFixtureKMessageBytes();
    const originalLength = messageBytes.length;
    const originalFirstByte = messageBytes[0];
    const originalLastByte = messageBytes[messageBytes.length - 1];

    const result = computeSolanaPresignHash({ messageBytes });

    // `messageBytes` field on the result is the SAME array (echoed back).
    // Helper does not deep-copy — the contract is "do not mutate".
    expect(result.messageBytes).toBe(messageBytes);
    // Defense-in-depth: byte-identity after the call (catches accidental
    // in-place mutation that a future refactor could introduce).
    expect(messageBytes.length).toBe(originalLength);
    expect(messageBytes[0]).toBe(originalFirstByte);
    expect(messageBytes[messageBytes.length - 1]).toBe(originalLastByte);
  });

  it("different inputs produce different hashes (sanity — catches constant-output bugs)", () => {
    const messageBytes = buildFixtureKMessageBytes();
    // Mutate a copy (so the test isn't sensitive to the no-mutation contract):
    // flip the first byte to produce a structurally-different input.
    const mutated = new Uint8Array(messageBytes);
    mutated[0] = (mutated[0]! ^ 0xff) & 0xff;

    const a = computeSolanaPresignHash({ messageBytes });
    const b = computeSolanaPresignHash({ messageBytes: mutated });

    expect(a.presignHash).not.toBe(b.presignHash);
  });

  it("_solanaPresign spy-affordance regression — ESM indirection intercepts", () => {
    // CLAUDE.md ESM spy-affordance non-negotiable (see `payload-fingerprint-solana.ts`).
    // Plan 12-04 preview_send Solana branch will spy on this indirection to
    // assert the presign-hash call shape; the seam must work.
    const spy = vi
      .spyOn(_solanaPresign, "computeSolanaPresignHash")
      .mockReturnValue({
        messageBytes: new Uint8Array([0]),
        presignHash: "0xdeadbeef" as `0x${string}`,
      });

    const fakeBytes = new Uint8Array([9, 8, 7]);
    const result = _solanaPresign.computeSolanaPresignHash({ messageBytes: fakeBytes });

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith({ messageBytes: fakeBytes });
    expect(result.presignHash).toBe("0xdeadbeef");

    spy.mockRestore();
  });
});
