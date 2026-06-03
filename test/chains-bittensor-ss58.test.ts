// test/chains-bittensor-ss58.test.ts — Phase 46 Plan 46-02 Task 1
// (TAO-PAIR-01). Hardcoded {pubKeyHex → ss58} literal anchors via
// encodeAddress(_, 42) + the inverse round-trip.
//
// FIXTURE DISCIPLINE (CLAUDE.md): these are HARDCODED LITERALS — NO
// beforeAll-snapshot. A drift in @polkadot/util-crypto's prefix-42 SS58
// encoder must fail at a specific line, not pass against a self-snapshotted
// value (same spirit as the BTC BIP-32 bc1q/bc1p anchors). The anchors are
// deterministic offline derivations; the device round-trip is the v2.7
// real-Ledger integration test.

import { describe, expect, it } from "vitest";

import { encodeAddress, decodeAddress } from "@polkadot/util-crypto";
import { hexToU8a, u8aToHex } from "@polkadot/util";

import { BITTENSOR_SS58_PREFIX } from "../src/chains/bittensor/types.js";

// Hardcoded {pubKeyHex → ss58} anchors, prefix 42. Derived offline via
// encodeAddress(hexToU8a(pubKeyHex), 42) and pinned here as literals.
//   - "01".repeat(32) → 5C62Ck4U… is the RESEARCH-verified anchor.
//   - the all-zero pubkey is the canonical low-edge vector.
//   - the Alice well-known dev pubkey → 5GrwvaEF… is a recognizable anchor.
const SS58_VECTORS: ReadonlyArray<{ pubKeyHex: string; ss58: string }> = [
  {
    pubKeyHex: "0x" + "01".repeat(32),
    ss58: "5C62Ck4UrFPiBtoCmeSrgF7x9yv9mn38446dhCpsi2mLHiFT",
  },
  {
    pubKeyHex: "0x" + "00".repeat(32),
    ss58: "5C4hrfjw9DjXZTzV3MwzrrAr9P1MJhSrvWGWqi1eSuyUpnhM",
  },
  {
    // Alice (//Alice ed25519-ish well-known dev pubkey), prefix 42.
    pubKeyHex:
      "0xd43593c715fdd31c61141abd04a99fd6822c8558854ccde39a5684e7a56da27d",
    ss58: "5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY",
  },
];

describe("Bittensor SS58 vectors — encodeAddress(_, 42) literal anchors (TAO-PAIR-01)", () => {
  it("uses prefix 42", () => {
    expect(BITTENSOR_SS58_PREFIX).toBe(42);
  });

  for (const { pubKeyHex, ss58 } of SS58_VECTORS) {
    it(`encodeAddress(${pubKeyHex.slice(0, 10)}…, 42) === "${ss58.slice(0, 8)}…"`, () => {
      expect(encodeAddress(hexToU8a(pubKeyHex), BITTENSOR_SS58_PREFIX)).toBe(
        ss58,
      );
    });

    it(`round-trip: u8aToHex(decodeAddress("${ss58.slice(0, 8)}…")) === ${pubKeyHex.slice(0, 10)}…`, () => {
      expect(u8aToHex(decodeAddress(ss58))).toBe(pubKeyHex);
    });
  }
});
