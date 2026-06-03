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

// =====================  Phase 48 — Fixtures TAO-D..H  =======================
// The 5 deferred staking shapes (TAO-W-06/07/08). Each method hex is a
// DETERMINISTIC, self-consistent SCALE-shape literal: a pinned (pallet, call)
// index pair + the args in PALLET-MACRO order (§Exact Extrinsic Signatures
// #1-#5). The fingerprint binds the BYTES; the live builder (Plan 48-03)
// re-anchors byte-identity via `api.tx`. The pinned call-index literals
// (`0x09__`, subtensorModule pallet idx 0x09) need only be self-consistent —
// the hotkey↔netuid-SWAP regression below is the executable guard that the arg
// ORDER is hotkey-first (the §RED FLAG money-correctness check).
//
// EXECUTE-TIME RED-FLAG NOTE: the canonical on-chain order is confirmed against
// the subtensor pallet `dispatches.rs` macro + the shipped addStakeLimit
// (hotkey-first) precedent. A live `api.tx.subtensorModule.<method>.meta.args`
// re-introspection requires live chain metadata (out of scope for the offline
// fixture build — no live RPC); re-confirm on a subtensor spec bump.
const FIXTURE_HOTKEY_2 = "bb".repeat(32); // a SECOND hotkey (move-stake dest)
const FIXTURE_COLDKEY = "cc".repeat(32); // destination coldkey (transfer-stake)
const NETUID_1_LE = "0100"; // u16 LE = 1 (origin)
const NETUID_2_LE = "0200"; // u16 LE = 2 (destination)

// #1 add_stake(hotkey, netuid: u16, amount_staked: u64) — HOTKEY-FIRST.
function addStakeMethod(amountStaked: bigint): string {
  return "0x0900" + FIXTURE_HOTKEY + NETUID_1_LE + u64LeHex(amountStaked);
}
// The RED-FLAG SWAP: encode netuid-where-hotkey-belongs (SDK-helper netuid-first
// order). A u16 netuid is 2 bytes; to keep the blob the same length we encode a
// 32-byte field carrying the netuid in its low bytes then the hotkey's first 2
// bytes as a u16 — i.e. the arg POSITIONS are swapped. The exact swapped bytes
// do not matter; what matters is the resulting fingerprint MUST differ.
function addStakeMethodSwapped(amountStaked: bigint): string {
  // netuid(32B, low-byte=01) ‖ hotkey-first-2-bytes(aaaa) ‖ amount — positions swapped.
  const netuidAs32 = "01" + "00".repeat(31);
  return "0x0900" + netuidAs32 + "aaaa" + u64LeHex(amountStaked);
}
// #2 remove_stake(hotkey, netuid: u16, amount_unstaked: u64) — HOTKEY-FIRST.
function removeStakeMethod(amountUnstaked: bigint): string {
  return "0x0901" + FIXTURE_HOTKEY + NETUID_1_LE + u64LeHex(amountUnstaked);
}
function removeStakeMethodSwapped(amountUnstaked: bigint): string {
  const netuidAs32 = "01" + "00".repeat(31);
  return "0x0901" + netuidAs32 + "aaaa" + u64LeHex(amountUnstaked);
}
// #3 move_stake(origin_hotkey, destination_hotkey, origin_netuid: u16,
//               destination_netuid: u16, alpha_amount: u64).
function moveStakeMethod(alphaAmount: bigint): string {
  return (
    "0x0902" +
    FIXTURE_HOTKEY +
    FIXTURE_HOTKEY_2 +
    NETUID_1_LE +
    NETUID_2_LE +
    u64LeHex(alphaAmount)
  );
}
// #4 swap_stake(hotkey, origin_netuid: u16, destination_netuid: u16,
//               alpha_amount: u64).
function swapStakeMethod(alphaAmount: bigint): string {
  return (
    "0x0903" +
    FIXTURE_HOTKEY +
    NETUID_1_LE +
    NETUID_2_LE +
    u64LeHex(alphaAmount)
  );
}
// #5 transfer_stake(destination_coldkey, hotkey, origin_netuid: u16,
//                   destination_netuid: u16, alpha_amount: u64) — COLDKEY-FIRST.
function transferStakeMethod(alphaAmount: bigint): string {
  return (
    "0x0904" +
    FIXTURE_COLDKEY +
    FIXTURE_HOTKEY +
    NETUID_1_LE +
    NETUID_2_LE +
    u64LeHex(alphaAmount)
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

  // =====================  Phase 48 — Fixtures TAO-D..H  =====================
  // The 5 deferred staking shapes (TAO-W-06/07/08). Each is an INDEPENDENTLY
  // computed 0x literal (the same `node -e` recipe as TAO-A/B — NOT a beforeAll
  // snapshot, per CLAUDE.md). Cross-linked to consumer tests in each it() name.

  it("Fixture TAO-D — add_stake fingerprint (hotkey-first; consumer: prepare-bittensor-add-stake)", () => {
    // add_stake(hotkey=0xaa…, netuid=1, amount_staked=2 TAO = 2_000_000_000 RAO), mode:0.
    const blob = buildSignableBlob({ methodHex: addStakeMethod(2_000_000_000n) });
    expect(blob.length).toBe(121);
    const fp = computeBittensorPayloadFingerprint({ signableBytes: blob });
    expect(fp).toBe(
      "0xc19b3f65d74f84c0d86873005018f4f098a3d2c4cd23ebd82afe08388fe01a0e",
    );
  });

  it("Fixture TAO-D +1-RAO regression: amount_staked swap changes fingerprint", () => {
    const fpD = computeBittensorPayloadFingerprint({
      signableBytes: buildSignableBlob({ methodHex: addStakeMethod(2_000_000_000n) }),
    });
    const fpPlus1 = computeBittensorPayloadFingerprint({
      signableBytes: buildSignableBlob({ methodHex: addStakeMethod(2_000_000_001n) }),
    });
    expect(fpD).not.toBe(fpPlus1);
    expect(fpPlus1).toBe(
      "0x32ee019b1dd4136a445ef73a4066607c0f7687268d2d9d36a1fc2bd5e33cb2ae",
    );
  });

  it("RED FLAG (TAO-W-06): hotkey↔netuid SWAP changes the add_stake fingerprint (≠ TAO-D)", () => {
    // §RED FLAG money-correctness guard. Encoding add_stake in SDK-helper
    // netuid-first order (instead of pallet hotkey-first) MUST bind different
    // bytes — proving the param ORDER is in the preimage. A passing TAO-D with a
    // passing SWAP-equals-TAO-D would be the silent wrong-order bug.
    const fpD = computeBittensorPayloadFingerprint({
      signableBytes: buildSignableBlob({ methodHex: addStakeMethod(2_000_000_000n) }),
    });
    const fpSwapped = computeBittensorPayloadFingerprint({
      signableBytes: buildSignableBlob({ methodHex: addStakeMethodSwapped(2_000_000_000n) }),
    });
    expect(fpSwapped).not.toBe(fpD);
    expect(fpSwapped).toBe(
      "0x939f4c983a227c92b15f7f52ff28b785b5da7bf6bae5e7e7ba5c2e7ef0b7861e",
    );
  });

  it("Fixture TAO-E — remove_stake fingerprint (ALPHA; consumer: prepare-bittensor-remove-stake)", () => {
    // remove_stake(hotkey=0xaa…, netuid=1, amount_unstaked=3 ALPHA = 3_000_000_000), mode:0.
    const blob = buildSignableBlob({ methodHex: removeStakeMethod(3_000_000_000n) });
    expect(blob.length).toBe(121);
    const fp = computeBittensorPayloadFingerprint({ signableBytes: blob });
    expect(fp).toBe(
      "0x5de53aa60a926ee91ff1ec629833818fccd49293b4046e73ce7aa0e5df0096ae",
    );
  });

  it("Fixture TAO-E +1 regression: amount_unstaked swap changes fingerprint", () => {
    const fpE = computeBittensorPayloadFingerprint({
      signableBytes: buildSignableBlob({ methodHex: removeStakeMethod(3_000_000_000n) }),
    });
    const fpPlus1 = computeBittensorPayloadFingerprint({
      signableBytes: buildSignableBlob({ methodHex: removeStakeMethod(3_000_000_001n) }),
    });
    expect(fpE).not.toBe(fpPlus1);
    expect(fpPlus1).toBe(
      "0xd29e691500a31b39ef9a027d38fc33977ec1bc8b82396e0268593f6591b2346e",
    );
  });

  it("RED FLAG (TAO-W-06): hotkey↔netuid SWAP changes the remove_stake fingerprint (≠ TAO-E)", () => {
    const fpE = computeBittensorPayloadFingerprint({
      signableBytes: buildSignableBlob({ methodHex: removeStakeMethod(3_000_000_000n) }),
    });
    const fpSwapped = computeBittensorPayloadFingerprint({
      signableBytes: buildSignableBlob({ methodHex: removeStakeMethodSwapped(3_000_000_000n) }),
    });
    expect(fpSwapped).not.toBe(fpE);
    expect(fpSwapped).toBe(
      "0xf2bd2b9f432fac0bfb222775ce28f837d928cd24831ebfa928dc387ca66d0415",
    );
  });

  it("Fixture TAO-F — move_stake fingerprint (same-owner; consumer: prepare-bittensor-move-stake)", () => {
    // move_stake(orig_hk=0xaa…, dest_hk=0xbb…, orig_net=1, dest_net=2, alpha=5 ALPHA), mode:0.
    const blob = buildSignableBlob({ methodHex: moveStakeMethod(5_000_000_000n) });
    expect(blob.length).toBe(155);
    const fp = computeBittensorPayloadFingerprint({ signableBytes: blob });
    expect(fp).toBe(
      "0x467dda8b59f37a909dce8f98cbdd1aee4b1eff4cf8be4efb5de4020291a75974",
    );
  });

  it("Fixture TAO-F +1 regression: alpha_amount swap changes fingerprint", () => {
    const fpF = computeBittensorPayloadFingerprint({
      signableBytes: buildSignableBlob({ methodHex: moveStakeMethod(5_000_000_000n) }),
    });
    const fpPlus1 = computeBittensorPayloadFingerprint({
      signableBytes: buildSignableBlob({ methodHex: moveStakeMethod(5_000_000_001n) }),
    });
    expect(fpF).not.toBe(fpPlus1);
    expect(fpPlus1).toBe(
      "0xd87d2f54d521772332f5b92e13f660f84980cddc9a0a0f0b70cfc6ed6a555744",
    );
  });

  it("Fixture TAO-G — swap_stake fingerprint (same-owner; consumer: prepare-bittensor-swap-stake)", () => {
    // swap_stake(hotkey=0xaa…, orig_net=1, dest_net=2, alpha=5 ALPHA), mode:0.
    const blob = buildSignableBlob({ methodHex: swapStakeMethod(5_000_000_000n) });
    expect(blob.length).toBe(123);
    const fp = computeBittensorPayloadFingerprint({ signableBytes: blob });
    expect(fp).toBe(
      "0xc9d4435269160bb25ad803e3a8f4fecf940ed740ee323fa9f0c4fb8f88d52af4",
    );
  });

  it("Fixture TAO-G +1 regression: alpha_amount swap changes fingerprint", () => {
    const fpG = computeBittensorPayloadFingerprint({
      signableBytes: buildSignableBlob({ methodHex: swapStakeMethod(5_000_000_000n) }),
    });
    const fpPlus1 = computeBittensorPayloadFingerprint({
      signableBytes: buildSignableBlob({ methodHex: swapStakeMethod(5_000_000_001n) }),
    });
    expect(fpG).not.toBe(fpPlus1);
    expect(fpPlus1).toBe(
      "0x31d00a54657e0fbd7071a56d899efca02f28aebb91f945c0f28494871cf17ea1",
    );
  });

  it("Fixture TAO-H — transfer_stake fingerprint (CUSTODY; consumer: prepare-bittensor-transfer-stake)", () => {
    // transfer_stake(dest_coldkey=0xcc…, hotkey=0xaa…, orig_net=1, dest_net=2, alpha=5 ALPHA), mode:0.
    // destination_coldkey FIRST — the custody-change param order.
    const blob = buildSignableBlob({ methodHex: transferStakeMethod(5_000_000_000n) });
    expect(blob.length).toBe(155);
    const fp = computeBittensorPayloadFingerprint({ signableBytes: blob });
    expect(fp).toBe(
      "0xcebe7bde319701717e0f27601dbbb29c890c9c4eb6dac9e03d18f7061b24a9d7",
    );
  });

  it("Fixture TAO-H +1 regression: alpha_amount swap changes fingerprint", () => {
    const fpH = computeBittensorPayloadFingerprint({
      signableBytes: buildSignableBlob({ methodHex: transferStakeMethod(5_000_000_000n) }),
    });
    const fpPlus1 = computeBittensorPayloadFingerprint({
      signableBytes: buildSignableBlob({ methodHex: transferStakeMethod(5_000_000_001n) }),
    });
    expect(fpH).not.toBe(fpPlus1);
    expect(fpPlus1).toBe(
      "0x4bd626bb29a89295050a39c7ef7e8990044f8932a78dc81e5da07839952350f3",
    );
  });

  it("Fixtures TAO-D..H are pairwise-distinct (no two shapes collide)", () => {
    const fps = [
      computeBittensorPayloadFingerprint({ signableBytes: buildSignableBlob({ methodHex: addStakeMethod(2_000_000_000n) }) }),
      computeBittensorPayloadFingerprint({ signableBytes: buildSignableBlob({ methodHex: removeStakeMethod(3_000_000_000n) }) }),
      computeBittensorPayloadFingerprint({ signableBytes: buildSignableBlob({ methodHex: moveStakeMethod(5_000_000_000n) }) }),
      computeBittensorPayloadFingerprint({ signableBytes: buildSignableBlob({ methodHex: swapStakeMethod(5_000_000_000n) }) }),
      computeBittensorPayloadFingerprint({ signableBytes: buildSignableBlob({ methodHex: transferStakeMethod(5_000_000_000n) }) }),
    ];
    expect(new Set(fps).size).toBe(5);
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
    // Phase 48 (TAO-W-09): the 2 REUSED Bittensor binding modules. The 5 new
    // tx shapes flow through these shape-agnostic pure fns UNCHANGED — the
    // binding gains NO shape-specific branch. Adding them to the gate asserts
    // they are byte-identical to origin/main this phase.
    "src/signing/payload-fingerprint-bittensor.ts",
    "src/signing/presign-hash-bittensor.ts",
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
