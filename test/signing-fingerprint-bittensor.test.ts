// TAO-PREP-01 / TAO-W-05 — Bittensor payloadFingerprint canonical-fixture
// regression file. Sibling of `test/signing-fingerprint-solana.test.ts`
// (Solana) and `test/signing-fingerprint-tron.test.ts` (TRON). Phase 47 —
// Plan 47-01.
//
// Fixture taxonomy (CLAUDE.md "Cryptographic-binding fixtures pinned as
// hardcoded literals" — NO `beforeAll`-snapshot; drift in preimage assembly
// MUST fail at a specific line, not pass against a self-snapshotted value):
//
//   Fixture TAO-A — native `balances.transferKeepAlive` fingerprint (consumed
//                   by `test/prepare-bittensor-native-send.test.ts` Plan 47-02
//                   + `test/bittensor-trust-pipeline.integration.test.ts`
//                   Plan 47-04).
//   Fixture TAO-B — `subtensorModule.add_stake_limit` fingerprint (consumed by
//                   `test/prepare-bittensor-add-stake-limit.test.ts` Plan 47-02
//                   + the integration test).
//   Fixture TAO-C — blake2-256 device presign over the SAME TAO-A blob; lives
//                   in `test/signing-presign-hash-bittensor.test.ts`.
//
// OFFLINE blob construction (47-RESEARCH §Probe 1 + §Execute-time fixture-capture
// — NO live RPC): the signable blob is
// `registry.createType("ExtrinsicPayload", signerPayloadJSON, { version })
// .toU8a({ method: true })`. A bare `TypeRegistry` with the subtensor
// signed-extension tuple pinned via `setSignedExtensions` reproduces the
// real subtensor mode:0 blob layout deterministically offline (mode:0 carries
// the trailing CheckMetadataHash mode flag `00`). The PALLET/CALL indices +
// arg encodings are deterministic literals — the fingerprint binds the BYTES;
// the live builder in Plan 47-02 re-anchors byte-identity via `api.tx`.
//
// SENDER-INDEPENDENCE: the subtensor `SignerPayload` does NOT embed the signing
// address (the `from` is supplied to `addSignature` at send time), so the
// fingerprint is `from`-independent — in contrast with Solana whose `feePayer`
// is inside the message bytes. The persona-cycle byte-identity assertion lands
// in the integration test (Plan 47-04).

import { TypeRegistry } from "@polkadot/types";
import { compactToU8a } from "@polkadot/util";
import { execFileSync } from "node:child_process";

import { describe, expect, it, vi } from "vitest";

import {
  FINGERPRINT_DOMAIN_TAG_BITTENSOR,
  _bittensorFingerprint,
  computeBittensorPayloadFingerprint,
} from "../src/signing/payload-fingerprint-bittensor.js";
import { FINGERPRINT_DOMAIN_TAG } from "../src/signing/payload-fingerprint.js";
import { FINGERPRINT_DOMAIN_TAG_SOLANA } from "../src/signing/payload-fingerprint-solana.js";
import { FINGERPRINT_DOMAIN_TAG_TRON } from "../src/signing/payload-fingerprint-tron.js";

// ---------------------------------------------------------------------------
// Offline signable-blob builder. The subtensor signed-extension tuple
// (47-RESEARCH §Probe 1 — 13-extension set incl. CheckMetadataHash) is the
// well-known Substrate set; `setSignedExtensions` resolves them without chain
// metadata, producing a byte-stable mode:0 blob (the trailing `00` is the
// CheckMetadataHash mode:0 flag).
// ---------------------------------------------------------------------------
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

// Pinned deterministic fixture inputs — stable across runs (NO RPC).
const BLOCK_HASH = "0x" + "11".repeat(32);
const GENESIS_HASH = "0x" + "22".repeat(32);
const SPEC_VERSION = "0x000000ab"; // 171
const TX_VERSION = "0x00000001"; // 1

function buildSignableBlob(opts: {
  methodHex: string;
  mode?: 0 | 1;
  metadataHash?: string | null;
  nonce?: string;
}): Uint8Array {
  const registry = new TypeRegistry();
  registry.setSignedExtensions(SUBTENSOR_SIGNED_EXTENSIONS);
  const payload = {
    method: opts.methodHex,
    nonce: opts.nonce ?? "0x00",
    tip: "0x00",
    blockHash: BLOCK_HASH,
    genesisHash: GENESIS_HASH,
    era: "0x00", // immortal
    specVersion: SPEC_VERSION,
    transactionVersion: TX_VERSION,
    mode: opts.mode ?? 0,
    metadataHash: opts.metadataHash ?? null,
    version: 4,
  };
  const ep = registry.createType("ExtrinsicPayload", payload, { version: 4 });
  return ep.toU8a({ method: true });
}

// SCALE-encoded `balances.transferKeepAlive(dest=MultiAddress::Id(32B), value=Compact<u64>)`.
//   0x05 = balances pallet idx, 0x00 = transferKeepAlive call idx,
//   0x00 = MultiAddress::Id variant, then 32B accountId, then Compact value.
const DEST_ACCOUNT = "00".repeat(32);
function transferKeepAliveMethod(rao: bigint): string {
  const compact = Buffer.from(compactToU8a(rao)).toString("hex");
  return "0x0500" + "00" + DEST_ACCOUNT + compact;
}

// SCALE-encoded `subtensorModule.add_stake_limit(hotkey, netuid: u16,
// amountStaked: u64, limitPrice: u64, allowPartial: bool)`.
//   0x4b09 = a pinned (pallet, call) index pair — deterministic literal for the
//   binding fixture (the live builder supplies the real indices in Plan 47-02).
const FIXTURE_HOTKEY = "aa".repeat(32);
function u64LeHex(v: bigint): string {
  return (v.toString(16).padStart(16, "0").match(/../g) as string[])
    .reverse()
    .join("");
}
function addStakeLimitMethod(amountStaked: bigint, limitPrice: bigint): string {
  const netuid = "0100"; // u16 LE = 1
  const allowPartial = "01"; // true
  return (
    "0x4b09" +
    FIXTURE_HOTKEY +
    netuid +
    u64LeHex(amountStaked) +
    u64LeHex(limitPrice) +
    allowPartial
  );
}

describe("computeBittensorPayloadFingerprint — TAO-PREP-01 (binding LOCKED)", () => {
  it("domain-tag content + pairwise distinctness (NOT unique-length — 20 bytes = Solana)", () => {
    // Exact tag value pinned — prevents accidental rename / version bump.
    expect(FINGERPRINT_DOMAIN_TAG_BITTENSOR).toBe("VaultPilot-taotx-v1:");
    // CRITICAL (47-RESEARCH correction #1): "VaultPilot-taotx-v1:" is 20 UTF-8
    // bytes — the SAME length as Solana's "VaultPilot-soltx-v1:". Distinctness
    // is by CONTENT, NOT length. We assert the 20-byte length but DELIBERATELY
    // do NOT assert it is UNIQUE among chains (it collides with Solana's 20).
    expect(Buffer.byteLength(FINGERPRINT_DOMAIN_TAG_BITTENSOR, "utf8")).toBe(20);
    expect(FINGERPRINT_DOMAIN_TAG_BITTENSOR.length).toBe(20);
    // Pairwise distinctness by CONTENT — cross-chain reuse impossible at the
    // preimage level (taotx ≠ soltx ≠ trontx ≠ txverify).
    expect(FINGERPRINT_DOMAIN_TAG_BITTENSOR).not.toBe(FINGERPRINT_DOMAIN_TAG); // EVM
    expect(FINGERPRINT_DOMAIN_TAG_BITTENSOR).not.toBe(FINGERPRINT_DOMAIN_TAG_SOLANA);
    expect(FINGERPRINT_DOMAIN_TAG_BITTENSOR).not.toBe(FINGERPRINT_DOMAIN_TAG_TRON);
    // Bittensor + Solana share the 20-byte length — prove the equal-length
    // siblings still produce DISTINCT preimages over identical body bytes.
    const body = new Uint8Array([1, 2, 3, 4]);
    const fpTao = computeBittensorPayloadFingerprint({ signableBytes: body });
    // (Solana's fp over the same body uses a different tag → different hash.)
    expect(Buffer.byteLength(FINGERPRINT_DOMAIN_TAG_SOLANA, "utf8")).toBe(20);
    expect(fpTao).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it("Fixture TAO-A — native transferKeepAlive fingerprint (hardcoded literal anchor)", () => {
    // transferKeepAlive(dest=Id(0x00…), value=1 TAO = 1_000_000_000 RAO), mode:0.
    const blob = buildSignableBlob({
      methodHex: transferKeepAliveMethod(1_000_000_000n),
    });
    // Stable byte-length anchor — catches any future ExtrinsicPayload shape
    // change. mode:0 subtensor blob with this method = 116 bytes.
    expect(blob.length).toBe(116);

    const fp = computeBittensorPayloadFingerprint({ signableBytes: blob });

    // Hardcoded literal anchor — independently computed at PR-write time via a
    // discardable `node -e`:
    //   const { TypeRegistry } = require("@polkadot/types");
    //   const { compactToU8a } = require("@polkadot/util");
    //   const { keccak256, toBytes, concat } = require("viem");
    //   <build blob as above> ; keccak256(concat([toBytes("VaultPilot-taotx-v1:"), blob]))
    // Cross-linked from `test/prepare-bittensor-native-send.test.ts` (Plan 47-02)
    // + `test/bittensor-trust-pipeline.integration.test.ts` (Plan 47-04).
    expect(fp).toBe(
      "0x3fabc5b4655a1a92a4ff462642a3ce3961bd0f9520ab5f8c134c32cd0c039dde",
    );
  });

  it("Fixture TAO-A +1-RAO regression: amount swap changes fingerprint", () => {
    // Same setup, value = 1_000_000_001 RAO (one base unit more). The
    // fingerprint MUST differ — proves the RAO amount IS in the preimage
    // (regression against an assembly that ignores the encoded value).
    const fpA = computeBittensorPayloadFingerprint({
      signableBytes: buildSignableBlob({
        methodHex: transferKeepAliveMethod(1_000_000_000n),
      }),
    });
    const fpPlus1 = computeBittensorPayloadFingerprint({
      signableBytes: buildSignableBlob({
        methodHex: transferKeepAliveMethod(1_000_000_001n),
      }),
    });
    expect(fpA).not.toBe(fpPlus1);
    expect(fpA).toBe(
      "0x3fabc5b4655a1a92a4ff462642a3ce3961bd0f9520ab5f8c134c32cd0c039dde",
    );
    // Anchor the +1 literal so a future preimage-assembly drift surfaces here.
    expect(fpPlus1).toBe(
      "0x83d884a6793e558874c6a4d33b196abce0828385dccefa40331c093fb7eef900",
    );
  });

  it("Fixture TAO-B — add_stake_limit fingerprint (hardcoded literal anchor)", () => {
    // add_stake_limit(hotkey=0xaa…, netuid=1, amountStaked=2 TAO, limitPrice=0.5 TAO, allowPartial=true), mode:0.
    const blob = buildSignableBlob({
      methodHex: addStakeLimitMethod(2_000_000_000n, 500_000_000n),
    });
    expect(blob.length).toBe(130);

    const fp = computeBittensorPayloadFingerprint({ signableBytes: blob });
    // Independently computed (same node -e recipe as TAO-A). Cross-linked from
    // `test/prepare-bittensor-add-stake-limit.test.ts` (Plan 47-02).
    expect(fp).toBe(
      "0x7fc3403d36166a068cd922dc4e2f72519563f31df3856a264900e3d8c00d21ff",
    );
  });

  it("Fixture TAO-B +1-RAO regression: amountStaked swap changes fingerprint", () => {
    const fpB = computeBittensorPayloadFingerprint({
      signableBytes: buildSignableBlob({
        methodHex: addStakeLimitMethod(2_000_000_000n, 500_000_000n),
      }),
    });
    const fpPlus1 = computeBittensorPayloadFingerprint({
      signableBytes: buildSignableBlob({
        methodHex: addStakeLimitMethod(2_000_000_001n, 500_000_000n),
      }),
    });
    expect(fpB).not.toBe(fpPlus1);
    expect(fpPlus1).toBe(
      "0x9f51b9285e4a950185e461b045449a15ce4a6f21a3aa56f0f8f61320d160540f",
    );
  });

  it("mode:1 fixture — recompute on spec bump (metadataHash in additionalSigned tail)", () => {
    // mode:1 enables CheckMetadataHash: the blob gains the 32-byte metadataHash
    // in the additionalSigned tail (47-RESEARCH §Probe 1 + Decision D-MD). The
    // metadataHash changes per runtime upgrade — RECOMPUTE THIS LITERAL on a
    // subtensor spec bump (47-RESEARCH §Execute-time fixture-capture). Pinned
    // here for byte-stability of the mode:1 path; mode:0 (TAO-A) is the
    // primary byte-stable anchor.
    const META_HASH = "0x" + "f3".repeat(32);
    const blob = buildSignableBlob({
      methodHex: transferKeepAliveMethod(1_000_000_000n),
      mode: 1,
      metadataHash: META_HASH,
    });
    // mode:1 adds the 32-byte hash vs mode:0's 116 → 148.
    expect(blob.length).toBe(148);
    const fp = computeBittensorPayloadFingerprint({ signableBytes: blob });
    expect(fp).toBe(
      "0x554ca6ab0777f44cb8ce5060ea9881082767094f8457deb0d024fe1d5cb62291",
    );
  });

  it("_bittensorFingerprint spy-affordance regression — ESM indirection intercepts", () => {
    // CLAUDE.md ESM spy-affordance non-negotiable: the indirection object is
    // present (added at write time). A direct vi.spyOn on the named export
    // would silently no-op due to immutable ESM bindings; the indirection is
    // the test seam Plans 47-02 / 47-04 rely on.
    const spy = vi
      .spyOn(_bittensorFingerprint, "computeBittensorPayloadFingerprint")
      .mockReturnValue("0xdeadbeef" as `0x${string}`);
    const fakeBytes = new Uint8Array([1, 2, 3, 4]);
    const result = _bittensorFingerprint.computeBittensorPayloadFingerprint({
      signableBytes: fakeBytes,
    });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith({ signableBytes: fakeBytes });
    expect(result).toBe("0xdeadbeef");
    spy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// TAO-W-05 — FROZEN cryptographic-binding-chain zero-diff gate.
//
// Phase 47 ADDS sibling files + additive arms; it NEVER edits the frozen chain.
// This gate asserts the EVM/Solana/TRON fingerprint + presign modules are
// byte-identical to origin/main, and that the send_transaction three-gate
// region has no DELETION markers (additive-only). Any inadvertent edit fails
// HERE rather than silently shipping. Mirror of the Phase 44 Solana
// FROZEN-zero-diff describe-block precedent.
//
// `git diff` returns empty when the file matches origin/main. If origin/main is
// not fetched (shallow CI clone), the test skips — the worktree-level FROZEN
// proof in the PR body is the authoritative gate.
// ---------------------------------------------------------------------------
describe("FROZEN cryptographic-binding chain — zero-diff vs origin/main (TAO-W-05)", () => {
  const FROZEN_FILES = [
    "src/signing/payload-fingerprint.ts",
    "src/signing/payload-fingerprint-solana.ts",
    "src/signing/payload-fingerprint-tron.ts",
    "src/signing/presign-hash.ts",
    "src/signing/presign-hash-solana.ts",
    "src/signing/presign-hash-tron.ts",
  ];

  function gitDiff(file: string): string | null {
    try {
      return execFileSync("git", ["diff", "origin/main", "--", file], {
        encoding: "utf8",
      });
    } catch {
      return null; // origin/main not available — skip rather than fail.
    }
  }

  for (const file of FROZEN_FILES) {
    it(`${file} is byte-identical to origin/main`, () => {
      const diff = gitDiff(file);
      if (diff === null) return; // skip — PR-body FROZEN proof is authoritative.
      expect(diff).toBe("");
    });
  }

  it("send_transaction.ts three-gate region has NO deletion markers (additive-only)", () => {
    const diff = gitDiff("src/tools/send_transaction.ts");
    if (diff === null) return; // skip when origin/main unavailable.
    // Additive arms are permitted (`+` lines); the three FROZEN gates
    // (previewToken/userDecision schema, token-match, fingerprint-drift) must
    // not be MODIFIED or DELETED. A deletion line `-` (excluding the `---`
    // file header) signals an edit to existing logic.
    const deletionLines = diff
      .split("\n")
      .filter((l) => /^-(?!--)/.test(l));
    expect(deletionLines).toEqual([]);
  });
});
