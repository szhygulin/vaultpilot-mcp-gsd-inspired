import { describe, expect, it } from "vitest";
import type { Address, Hex } from "viem";

import {
  FINGERPRINT_DOMAIN_TAG,
  computePayloadFingerprint,
} from "../src/signing/payload-fingerprint.js";

describe("computePayloadFingerprint — PREP-03 + T-BIND-1", () => {
  it("Fixture A — native send → 0x7e1867b2... byte-for-byte", () => {
    const fp = computePayloadFingerprint({
      chainId: 1,
      to: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" as Address,
      valueWei: 1000000000000000000n,
      data: "0x",
    });
    expect(fp).toBe("0x7e1867b2e6bc98cbce57bb901a33e973c749565eb19f8b86056197c7a20b2f5a");
    // Byte-length invariant (research line 879) — 23 UTF-8 bytes for the
    // domain tag "VaultPilot-txverify-v1:".
    expect(FINGERPRINT_DOMAIN_TAG.length).toBe(23);
  });

  it("Fixture B — ERC-20 transfer fingerprint (hardcoded literal anchor, Phase 6 hardened)", () => {
    // 68-byte transfer(0x...dEAD, 1e18) calldata = 0x + 8 hex selector + 64 hex to + 64 hex amount.
    const erc20Data =
      "0xa9059cbb000000000000000000000000000000000000000000000000000000000000dEAD0000000000000000000000000000000000000000000000000DE0B6B3A7640000" as Hex;
    // 138 chars total (0x + 136 hex = 4-byte selector + 32-byte to + 32-byte amount).
    expect(erc20Data.length).toBe(138);

    const fp = computePayloadFingerprint({
      chainId: 1,
      to: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" as Address,
      valueWei: 0n,
      data: erc20Data,
    });

    // Hardcoded literal anchor (Phase 6 / Plan 06-01 hardening). Computed
    // once at execute-time against the in-tree `computePayloadFingerprint`,
    // pinned forever. Drift in the preimage assembly for non-empty `data`
    // breaks THIS exact assertion at PR-review time — not at Phase 6+
    // verify-phase, which was the previous (self-referencing-snapshot) anti-pattern.
    expect(fp).toBe("0x20fe784f2025af75b0f47cbb71c217c7c121caee89bb64a91b6419282348108c");
  });

  it("invalid `to` (not a 0x-prefixed 20-byte hex) → throws via viem.hexToBytes", () => {
    expect(() =>
      computePayloadFingerprint({
        chainId: 1,
        to: "0xnotahex" as Address,
        valueWei: 0n,
        data: "0x",
      }),
    ).toThrow(/hex|notahex/i);
  });
});
