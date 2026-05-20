import { describe, expect, it } from "vitest";
import type { Address, Hex } from "viem";

import {
  FINGERPRINT_DOMAIN_TAG,
  computePayloadFingerprint,
} from "../src/signing/payload-fingerprint.js";
import { MAX_UINT256 } from "../src/protocols/erc20.js";
import {
  encodeCompoundSupply,
  encodeCompoundWithdraw,
} from "../src/protocols/compound-v3.js";
import { getCompoundCometAddress } from "../src/config/contracts.js";

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

  it("Fixture F — WETH9.withdraw(1e18) fingerprint (hardcoded literal anchor, Phase 6 / Plan 06-04)", () => {
    // 36-byte WETH9.withdraw(uint256) calldata = 0x + 8-hex selector
    // (0x2e1a7d4d) + 64-hex amount (1e18 = 0xde0b6b3a7640000, left-padded).
    const wethContract = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2" as Address;
    const withdrawData =
      "0x2e1a7d4d0000000000000000000000000000000000000000000000000de0b6b3a7640000" as Hex;
    expect(withdrawData.length).toBe(74);

    const fp = computePayloadFingerprint({
      chainId: 1,
      to: wethContract,
      valueWei: 0n,
      data: withdrawData,
    });

    // Hardcoded literal anchor (Plan 06-04 hardening — execute-time
    // computation pinned forever). Cross-linked from
    // test/prepare-weth-unwrap.test.ts. Drift in the preimage assembly for
    // WETH-shape data breaks THIS exact assertion at PR-review time.
    expect(fp).toBe("0x81a70e4a703de01b67ad1aaff7d97be8dde3ae6703a652a462f7de9e30e36596");
  });

  it("Fixture G — Aave V3 supply(USDC, 100e6, anvilWallet, 0) fingerprint (hardcoded literal anchor, Phase 7 / Plan 07-03)", () => {
    // 132-byte supply(asset, 100e6, anvil#1, referralCode=0) calldata against
    // the canonical Aave V3 Pool. 0x + 8-hex selector + 4 × 64-hex args = 266
    // chars total. Cross-linked from test/prepare-aave-supply.test.ts Test 7
    // and test/aave-v3-lifecycle.integration.test.ts persona-cycle.
    const aavePool = "0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2" as Address;
    const supplyData =
      "0x617ba037" +
      "000000000000000000000000a0b86991c6218b36c1d19d4a2e9eb0ce3606eb48" + // USDC
      "0000000000000000000000000000000000000000000000000000000005f5e100" + // 100e6
      "00000000000000000000000070997970c51812dc3a010c7d01b50e0d17dc79c8" + // onBehalfOf
      "0000000000000000000000000000000000000000000000000000000000000000"; // referralCode=0
    expect(supplyData.length).toBe(266);

    const fp = computePayloadFingerprint({
      chainId: 1,
      to: aavePool,
      valueWei: 0n,
      data: supplyData as Hex,
    });

    // Hardcoded literal anchor (Plan 07-03 hardening — execute-time
    // computation pinned forever). Drift in the preimage assembly for
    // Aave-supply-shape data breaks THIS exact assertion at PR-review time.
    expect(fp).toBe("0x67314a7f021fa9ba6d901ba555800a51d9f0e006f4e59489f69b486d009fce59");
  });

  it("Fixture H — Aave V3 withdraw(USDC, 100e6, anvilWallet) fingerprint (hardcoded literal anchor, Phase 7 / Plan 07-03)", () => {
    // 100-byte withdraw(asset, 100e6, anvil#1) calldata against the canonical
    // Aave V3 Pool. 0x + 8-hex selector + 3 × 64-hex args = 202 chars total.
    // Cross-linked from test/prepare-aave-withdraw.test.ts Test 7 and
    // test/aave-v3-lifecycle.integration.test.ts persona-cycle.
    const aavePool = "0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2" as Address;
    const withdrawData =
      "0x69328dec" +
      "000000000000000000000000a0b86991c6218b36c1d19d4a2e9eb0ce3606eb48" + // USDC
      "0000000000000000000000000000000000000000000000000000000005f5e100" + // 100e6
      "00000000000000000000000070997970c51812dc3a010c7d01b50e0d17dc79c8"; // to
    expect(withdrawData.length).toBe(202);

    const fp = computePayloadFingerprint({
      chainId: 1,
      to: aavePool,
      valueWei: 0n,
      data: withdrawData as Hex,
    });

    expect(fp).toBe("0x782dd9aa096d47a4036b2023c01c1306d3b325fbbbbd4da8a1a5cd3ce42be40d");
  });

  // -------------------------------------------------------------------------
  // Phase 28 — Plan 28-01. Fixtures R / S / T / U pin the payloadFingerprint
  // for the four canonical Compound V3 calldata shapes (USDC on cUSDCv3,
  // mainnet). Computed once at write-time via `encodeCompoundSupply` /
  // `encodeCompoundWithdraw` flowed through the FROZEN
  // `computePayloadFingerprint`. NO `beforeAll`-snapshot per CLAUDE.md
  // "Cryptographic-binding fixtures pinned as hardcoded literals".
  //
  // Computation script (recorded for reproducibility):
  //   node -e "
  //     const { encodeFunctionData, parseAbi } = require('viem');
  //     const { computePayloadFingerprint } = require('./dist/signing/payload-fingerprint.js');
  //     const ABI = parseAbi(['function supply(address,uint256)', 'function withdraw(address,uint256)']);
  //     const USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
  //     const cUSDCv3 = '0xc3d688B66703497DAA19211EEdff47f25384cdc3';
  //     const MAX = (1n << 256n) - 1n;
  //     for (const [label, data] of [
  //       ['R', encodeFunctionData({ abi: ABI, functionName: 'supply',   args: [USDC, 100000000n] })],
  //       ['S', encodeFunctionData({ abi: ABI, functionName: 'withdraw', args: [USDC, 100000000n] })],
  //       ['T', encodeFunctionData({ abi: ABI, functionName: 'withdraw', args: [USDC,  50000000n] })],
  //       ['U', encodeFunctionData({ abi: ABI, functionName: 'supply',   args: [USDC, MAX] })],
  //     ]) console.log(label, computePayloadFingerprint({ chainId: 1, to: cUSDCv3, valueWei: 0n, data }));
  //   "
  it("Fixture R — Compound V3 supply(USDC, 100e6) on cUSDCv3 fingerprint (hardcoded literal anchor, Phase 28 / Plan 28-01)", () => {
    const cUSDCv3 = getCompoundCometAddress(1, "USDC")!;
    const USDC = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48" as Address;
    const supplyData = encodeCompoundSupply(USDC, 100_000_000n);
    // 68 bytes = 4-byte selector + 2 × 32-byte args → 0x + 136 hex = 138 chars.
    expect(supplyData.length).toBe(138);
    expect(supplyData.slice(0, 10).toLowerCase()).toBe("0xf2b9fdb8");

    const fp = computePayloadFingerprint({
      chainId: 1,
      to: cUSDCv3,
      valueWei: 0n,
      data: supplyData,
    });

    // Hardcoded literal anchor (Plan 28-01 hardening — execute-time
    // computation pinned forever). Cross-linked from upcoming
    // test/prepare-compound-supply.test.ts (Plan 28-02) and
    // test/prepare-compound-repay.test.ts (Plan 28-03). Drift in the preimage
    // assembly for Compound-supply-shape data breaks THIS exact assertion at
    // PR-review time.
    expect(fp).toBe("0x09410c3060d1da3b7434450f172e9951928c22b838193be3f7b9956a603dfa9d");
  });

  it("Fixture S — Compound V3 withdraw(USDC, 100e6) on cUSDCv3 fingerprint (hardcoded literal anchor, Phase 28 / Plan 28-01)", () => {
    const cUSDCv3 = getCompoundCometAddress(1, "USDC")!;
    const USDC = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48" as Address;
    const withdrawData = encodeCompoundWithdraw(USDC, 100_000_000n);
    expect(withdrawData.length).toBe(138);
    expect(withdrawData.slice(0, 10).toLowerCase()).toBe("0xf3fef3a3");

    const fp = computePayloadFingerprint({
      chainId: 1,
      to: cUSDCv3,
      valueWei: 0n,
      data: withdrawData,
    });

    // Hardcoded literal anchor. Cross-linked from upcoming
    // test/prepare-compound-withdraw.test.ts (Plan 28-02).
    expect(fp).toBe("0x75d0cc3b899579ed4a7e2d8e6cb36386dc105ed97d326c73bcdafeed5dcfd70c");
  });

  it("Fixture T — Compound V3 withdraw(USDC, 50e6) on cUSDCv3 fingerprint — borrow-path (same calldata shape as Fixture S, distinct amount; proves byte-identity is selector + tx-to + amount dependent regardless of agent intent; hardcoded literal anchor, Phase 28 / Plan 28-01)", () => {
    const cUSDCv3 = getCompoundCometAddress(1, "USDC")!;
    const USDC = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48" as Address;
    const withdrawData = encodeCompoundWithdraw(USDC, 50_000_000n);
    expect(withdrawData.length).toBe(138);
    expect(withdrawData.slice(0, 10).toLowerCase()).toBe("0xf3fef3a3");

    const fp = computePayloadFingerprint({
      chainId: 1,
      to: cUSDCv3,
      valueWei: 0n,
      data: withdrawData,
    });

    // Hardcoded literal anchor — distinct from Fixture S despite identical
    // selector + tx-to because the amount slot differs. Plan 28-03's
    // prepare_compound_borrow shipping the same calldata bytes (via the same
    // encoder + asset) anchors against this fixture; the agent's INTENT
    // (borrow vs withdraw) is orthogonal to the cryptographic binding.
    expect(fp).toBe("0x7e31ff45686170495c8859b23712de665168bd53b44c248dc51459900246428c");
  });

  it("Fixture U — Compound V3 supply(USDC, MAX_UINT256) on cUSDCv3 fingerprint — repay full-position-close (hardcoded literal anchor, Phase 28 / Plan 28-01)", () => {
    const cUSDCv3 = getCompoundCometAddress(1, "USDC")!;
    const USDC = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48" as Address;
    const supplyData = encodeCompoundSupply(USDC, MAX_UINT256);
    expect(supplyData.length).toBe(138);
    expect(supplyData.slice(0, 10).toLowerCase()).toBe("0xf2b9fdb8");
    // The last 64 hex chars are the amount slot; MAX_UINT256 = 64 × 'f'.
    // Re-asserting here in the fingerprint test (not just the protocol test)
    // anchors the byte shape against any future preimage drift — a regression
    // that drops the MAX_UINT256 bytes would shift the fingerprint AND fail
    // this length-and-pattern check.
    expect(supplyData.slice(-64)).toBe("f".repeat(64));

    const fp = computePayloadFingerprint({
      chainId: 1,
      to: cUSDCv3,
      valueWei: 0n,
      data: supplyData,
    });

    // Hardcoded literal anchor — Compound V3 honors `supply(base, MAX_UINT256)`
    // as "close the entire borrow position" (full-repay sentinel). The
    // decoder's `isMax: boolean` arm surfaces this for preview_send.
    // Cross-linked from upcoming test/prepare-compound-repay.test.ts
    // (Plan 28-03) — the prepare tool emits this exact calldata when
    // `amount: "max"`.
    expect(fp).toBe("0x287f7b8731dbe64fbfcaf023382eb31c385a33938b52548887daef807f7e480c");
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

  // Phase 8 — Plan 08-02. Fixture J is a PROPERTY test, not a literal pin
  // (research § Topic 9 line 873-875 + CLAUDE.md "NO `beforeAll`-snapshot"):
  // pinning 5 fingerprints adds NO information beyond Fixture A (which
  // already proves chainId flows into the keccak). Fixture J proves the
  // FUNCTION is chain-distinct, which is the actually-load-bearing claim
  // for Phase 8's chain-id binding defense — a future edit to
  // payload-fingerprint.ts that accidentally drops the chainId slot from
  // the preimage produces 5 identical fingerprints and this test fires.
  it("Fixture J — chain-distinctness property (Phase 8 / Plan 08-02)", () => {
    const to = "0xab16a96d359ec26a11e2c2b3d8f8b8942d5bfcdb" as Address;
    const params = { to, valueWei: 10n ** 18n, data: "0x" as Hex };
    const fps = ([1, 42161, 137, 8453, 10] as const).map((chainId) =>
      computePayloadFingerprint({ chainId, ...params }),
    );
    // All 5 fingerprints distinct — chainId-dependence is load-bearing for
    // the Layer 3 cryptographic-binding gate in send_transaction.ts.
    expect(new Set(fps).size).toBe(5);
    // Each fingerprint is a 32-byte 0x-prefixed hex (66 chars total) — guards
    // against a regression where the encoder collapses to a shorter shape.
    for (const fp of fps) {
      expect(fp).toMatch(/^0x[0-9a-f]{64}$/);
    }
  });
});
