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

  it("Fixture D — USDC transfer fingerprint (hardcoded literal anchor, Phase 6 / Plan 06-02)", () => {
    // 100 USDC transfer to 0x70997970... — decimals=6 → 100_000_000n = 0x5f5e100.
    // Recipient + amount embedded in the canonical viem-encoded transfer
    // calldata (lowercase; hexToBytes is case-insensitive). USDC contract
    // address case-preserved in EIP-55.
    const usdcContract = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48" as Address;
    const usdcData =
      "0xa9059cbb00000000000000000000000070997970c51812dc3a010c7d01b50e0d17dc79c80000000000000000000000000000000000000000000000000000000005f5e100" as Hex;
    expect(usdcData.length).toBe(138);

    const fp = computePayloadFingerprint({
      chainId: 1,
      to: usdcContract,
      valueWei: 0n,
      data: usdcData,
    });

    // Hardcoded literal anchor (Plan 06-02 hardening — execute-time
    // computation pinned forever). Cross-linked from
    // test/prepare-token-send.test.ts and test/preview-send.erc20.test.ts.
    expect(fp).toBe("0x52f396cfab6f8f4dfbf10b36734e7d22e944d54657a72dc2c8d67e91f8c49f85");
  });

  it("Fixture E — WETH approve(Uniswap V3 SwapRouter, MAX_UINT256) fingerprint (hardcoded literal anchor, Phase 6 / Plan 06-03)", () => {
    // 68-byte approve(spender, amount) calldata = 0x + 8-hex selector
    // (0x095ea7b3) + 64-hex spender (left-padded address) + 64-hex amount
    // (MAX_UINT256 = (1n << 256n) - 1n; 64 hex `f`s).
    const wethContract = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2" as Address;
    const approveData =
      "0x095ea7b3000000000000000000000000e592427a0aece92de3edee1f18e0157c05861564ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff" as Hex;
    expect(approveData.length).toBe(138);

    const fp = computePayloadFingerprint({
      chainId: 1,
      to: wethContract,
      valueWei: 0n,
      data: approveData,
    });

    // Hardcoded literal anchor (Plan 06-03 hardening — execute-time
    // computation pinned forever). Cross-linked from
    // test/prepare-token-approve.test.ts. Drift in the preimage assembly
    // for approve-shape data breaks THIS exact assertion at PR-review time.
    expect(fp).toBe("0x46e20ff806defcabda8eb090f6cba368cb5b84ad058ff9eefd08c662185a8f5a");
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
