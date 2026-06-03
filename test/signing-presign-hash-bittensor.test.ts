// TAO-PREP-02 — Bittensor pre-sign (device-display) hash canonical-fixture
// regression file. Sibling of `test/signing-presign-hash-solana.test.ts`
// (Solana SHA-256) — Phase 47 Plan 47-01.
//
//   Fixture TAO-C — blake2-256 device-display hash over the SAME signable blob
//                   that feeds Fixture TAO-A in
//                   `test/signing-fingerprint-bittensor.test.ts`. This is the
//                   hash the Polkadot Generic Ledger app displays in blind-sign
//                   mode; the user matches it against the LEDGER BLIND-SIGN HASH
//                   (Bittensor) block emitted in preview_send (Plan 47-03).
//
// THE DIVERGENCE: blake2-256 (Substrate convention), NOT SHA-256 (Solana/TRON).
// The binding keccak256 fingerprint is unchanged across chains; only this
// device-display hash differs.
//
// The signable blob is rebuilt identically to Fixture TAO-A (offline
// `ExtrinsicPayload.toU8a({method:true})` with the pinned subtensor
// signed-extension tuple). NO `beforeAll`-snapshot — drift fails at the
// specific literal line (CLAUDE.md cryptographic-binding-fixture rule).

import { TypeRegistry } from "@polkadot/types";
import { compactToU8a } from "@polkadot/util";

import { describe, expect, it, vi } from "vitest";

import {
  _bittensorPresign,
  computeBittensorPresignHash,
} from "../src/signing/presign-hash-bittensor.js";

// Identical offline blob construction to Fixture TAO-A (cross-linked) so the
// presign hash is computed over the SAME bytes the fingerprint binds.
const SUBTENSOR_SIGNED_EXTENSIONS = [
  "CheckNonZeroSender",
  "CheckSpecVersion",
  "CheckTxVersion",
  "CheckGenesis",
  "CheckMortality",
  "CheckNonce",
  "CheckWeight",
  "ChargeTransactionPayment",
  "CheckMetadataHash",
];
const BLOCK_HASH = "0x" + "11".repeat(32);
const GENESIS_HASH = "0x" + "22".repeat(32);
const DEST_ACCOUNT = "00".repeat(32);

function taoABlob(rao: bigint): Uint8Array {
  const registry = new TypeRegistry();
  registry.setSignedExtensions(SUBTENSOR_SIGNED_EXTENSIONS);
  const compact = Buffer.from(compactToU8a(rao)).toString("hex");
  const methodHex = "0x0500" + "00" + DEST_ACCOUNT + compact;
  const payload = {
    method: methodHex,
    nonce: "0x00",
    tip: "0x00",
    blockHash: BLOCK_HASH,
    genesisHash: GENESIS_HASH,
    era: "0x00",
    specVersion: "0x000000ab",
    transactionVersion: "0x00000001",
    mode: 0,
    metadataHash: null,
    version: 4,
  };
  const ep = registry.createType("ExtrinsicPayload", payload, { version: 4 });
  return ep.toU8a({ method: true });
}

describe("computeBittensorPresignHash — TAO-PREP-02 (blake2-256 device hash)", () => {
  it("Fixture TAO-C — blake2-256 over the SAME TAO-A blob (hardcoded literal anchor)", () => {
    const blob = taoABlob(1_000_000_000n); // identical to Fixture TAO-A
    expect(blob.length).toBe(116); // same byte-length anchor as TAO-A

    const { presignHash, signableBytes } = computeBittensorPresignHash({
      signableBytes: blob,
    });

    // Helper echoes the input bytes back verbatim (no mutation).
    expect(signableBytes).toBe(blob);
    // Well-formed 32-byte 0x-prefixed blake2-256 hash.
    expect(presignHash).toMatch(/^0x[0-9a-f]{64}$/);
    // Hardcoded literal — independently computed at PR-write time via:
    //   const { blake2AsHex } = require("@polkadot/util-crypto");
    //   blake2AsHex(blob, 256)   // over the SAME TAO-A blob
    // Cross-linked to Fixture TAO-A's blob construction in
    // test/signing-fingerprint-bittensor.test.ts.
    expect(presignHash).toBe(
      "0x8c126b797439debc1c803e2395a02cc7732e21a15e5793b7ea942c3596d42136",
    );
  });

  it("presign hash changes when the blob changes (+1 RAO)", () => {
    const a = computeBittensorPresignHash({
      signableBytes: taoABlob(1_000_000_000n),
    }).presignHash;
    const b = computeBittensorPresignHash({
      signableBytes: taoABlob(1_000_000_001n),
    }).presignHash;
    expect(a).not.toBe(b);
    expect(a).toBe(
      "0x8c126b797439debc1c803e2395a02cc7732e21a15e5793b7ea942c3596d42136",
    );
  });

  it("_bittensorPresign spy-affordance regression — ESM indirection intercepts", () => {
    const spy = vi
      .spyOn(_bittensorPresign, "computeBittensorPresignHash")
      .mockReturnValue({
        signableBytes: new Uint8Array(),
        presignHash: "0xdeadbeef" as `0x${string}`,
      });
    const fakeBytes = new Uint8Array([9, 9, 9]);
    const result = _bittensorPresign.computeBittensorPresignHash({
      signableBytes: fakeBytes,
    });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith({ signableBytes: fakeBytes });
    expect(result.presignHash).toBe("0xdeadbeef");
    spy.mockRestore();
  });
});
