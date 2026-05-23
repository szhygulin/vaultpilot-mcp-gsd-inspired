// Cryptographic-binding fingerprint test — Morpho Blue fixtures (Phase 29 / Plan 29-01).
//
// Sibling file to test/signing-fingerprint.test.ts (Phase 28 — BYTE-FROZEN
// per cross-phase fixture-file convention from Phase 18+). Precedent:
//   - Phase 12 added test/signing-fingerprint-solana.test.ts
//   - Phase 18 added test/signing-fingerprint-tron.test.ts
//   - Phase 19 added test/signing-fingerprint-tron-19.test.ts
//   - Phase 20 added test/signing-fingerprint-tron-20.test.ts
// The sibling-file pattern isolates per-protocol fixture surfaces while
// keeping any preimage drift in payload-fingerprint.ts visible — drift would
// fail across ALL fixture files simultaneously, so the per-file isolation
// does NOT lose any regression coverage.
//
// Fixtures V / W / X / Y (Plan 29-01) — assembled via the 6 encoders from
// src/protocols/morpho-blue.ts flowed through the FROZEN
// computePayloadFingerprint. Each `it(...)` block computes the fingerprint
// at runtime and asserts byte-identity against a hardcoded `0x...` literal
// pinned at write time. NO `beforeAll`-snapshot per CLAUDE.md
// "Cryptographic-binding fixtures pinned as hardcoded literals" Convention.
//
// Reproducer (regenerate the four literals after a verified preimage
// change):
//   node --input-type=module -e "
//     import { computePayloadFingerprint } from './dist/signing/payload-fingerprint.js';
//     import { encodeMorphoSupply, encodeMorphoBorrow, encodeMorphoRepay, encodeMorphoSupplyCollateral } from './dist/protocols/morpho-blue.js';
//     import { getMorphoBlueAddress } from './dist/config/contracts.js';
//     const USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
//     const WSTETH = '0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0';
//     const oracle = '0x48F7E36EB6B826B2dF4B2E630B62Cd25e89E40e2';
//     const irm    = '0x870aC11D48B15DB9a138Cf899d20F13F79Ba00BC';
//     const lltv = 860000000000000000n;
//     const params = { loanToken: USDC, collateralToken: WSTETH, oracle, irm, lltv };
//     const ONBEHALF = '0x000000000000000000000000000000000000dEaD';
//     const RECEIVER = '0x000000000000000000000000000000000000bEEF';
//     const morpho = getMorphoBlueAddress(1);
//     for (const [k, data] of [
//       ['V', encodeMorphoSupply(params, 100_000_000n, 0n, ONBEHALF, '0x')],
//       ['W', encodeMorphoBorrow(params, 50_000_000n, 0n, ONBEHALF, RECEIVER)],
//       ['X', encodeMorphoRepay(params, 0n, 1_000_000_000n, ONBEHALF, '0x')],
//       ['Y', encodeMorphoSupplyCollateral(params, 1_000_000_000_000_000_000n, ONBEHALF, '0x')],
//     ]) console.log(k, computePayloadFingerprint({ chainId: 1, to: morpho, valueWei: 0n, data }));
//   "

import { describe, expect, it } from "vitest";
import type { Address } from "viem";

import { getMorphoBlueAddress } from "../src/config/contracts.js";
import {
  encodeMorphoBorrow,
  encodeMorphoRepay,
  encodeMorphoSupply,
  encodeMorphoSupplyCollateral,
  type MorphoMarketParams,
} from "../src/protocols/morpho-blue.js";
import { computePayloadFingerprint } from "../src/signing/payload-fingerprint.js";

// Canonical wstETH/USDC mainnet market parameters — DRY shared with
// test/protocols-morpho-blue.test.ts. The deriveMarketId regression anchor
// (research § Topic 3) pins this tuple → market-id
// 0xb323495f...c86cc; any future verified-address update touches one site.
const USDC = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48" as Address;
const WSTETH = "0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0" as Address;
const WSTETH_USDC_ORACLE = "0x48F7E36EB6B826B2dF4B2E630B62Cd25e89E40e2" as Address;
const ADAPTIVE_CURVE_IRM = "0x870aC11D48B15DB9a138Cf899d20F13F79Ba00BC" as Address;
const LLTV_86 = 860000000000000000n;

const TEST_WSTETH_USDC_PARAMS: MorphoMarketParams = {
  loanToken: USDC,
  collateralToken: WSTETH,
  oracle: WSTETH_USDC_ORACLE,
  irm: ADAPTIVE_CURVE_IRM,
  lltv: LLTV_86,
};

// Documented test-only constants. The fingerprint is a function of
// {chainId, to, valueWei, data} — `data` contains `onBehalf` and `receiver`,
// so these literals are load-bearing for the V/W/X/Y anchors. NEVER touch
// without recomputing all 4 expected fingerprints.
const ONBEHALF = "0x000000000000000000000000000000000000dEaD" as Address;
const RECEIVER = "0x000000000000000000000000000000000000bEEF" as Address;

const MOCK_BORROW_SHARES = 1_000_000_000n;

describe("Morpho Blue cryptographic-binding fingerprint fixtures (Phase 29 / Plan 29-01) — V / W / X / Y", () => {
  it("Fixture V — Morpho Blue supply(USDC, 100e6) into wstETH/USDC market — lender position (hardcoded literal anchor, Phase 29 / Plan 29-01)", () => {
    const morpho = getMorphoBlueAddress(1);
    expect(morpho).not.toBeNull();

    const data = encodeMorphoSupply(
      TEST_WSTETH_USDC_PARAMS,
      100_000_000n, // 100 USDC, decimals=6
      0n,
      ONBEHALF,
      "0x",
    );
    // Selector slice — 0xa99aad89 (research § Topic 2 supply).
    expect(data.slice(0, 10).toLowerCase()).toBe("0xa99aad89");

    const fp = computePayloadFingerprint({
      chainId: 1,
      to: morpho!,
      valueWei: 0n,
      data,
    });

    // Hardcoded literal anchor (Plan 29-01 hardening — execute-time
    // computation pinned forever). Cross-linked from upcoming
    // test/prepare-morpho-supply.test.ts (Plan 29-03). Drift in the preimage
    // assembly for Morpho-supply-shape data breaks THIS exact assertion at
    // PR-review time.
    expect(fp).toBe("0x0324553236967490622dc8f9c073290508cfeb4f82acc8082db04641a7b3b1b0");
  });

  it("Fixture W — Morpho Blue borrow(USDC, 50e6) from wstETH/USDC market — debt position (hardcoded literal anchor, Phase 29 / Plan 29-01)", () => {
    const morpho = getMorphoBlueAddress(1);
    expect(morpho).not.toBeNull();

    const data = encodeMorphoBorrow(
      TEST_WSTETH_USDC_PARAMS,
      50_000_000n, // 50 USDC
      0n,
      ONBEHALF,
      RECEIVER,
    );
    // Selector slice — 0x50d8cd4b (research § Topic 2 borrow).
    expect(data.slice(0, 10).toLowerCase()).toBe("0x50d8cd4b");

    const fp = computePayloadFingerprint({
      chainId: 1,
      to: morpho!,
      valueWei: 0n,
      data,
    });

    // Hardcoded literal anchor. Cross-linked from upcoming
    // test/prepare-morpho-borrow.test.ts (Plan 29-03).
    expect(fp).toBe("0x38edb209009c27860acd9f5dc705b1314875646de33c0384820a4b828d58a078");
  });

  it("Fixture X — Morpho Blue repay(USDC, 0 assets, 1e9 mock borrowShares) into wstETH/USDC market — repay-max via share-based encoding (hardcoded literal anchor with MOCK borrowShares so the byte-identity is reproducible; the actual repay-max value is read from on-chain at prepare time per Plan 29-03; Phase 29 / Plan 29-01)", () => {
    const morpho = getMorphoBlueAddress(1);
    expect(morpho).not.toBeNull();

    // Mock borrowShares — documented test-only constant. Plan 29-03's
    // integration test re-anchors this fixture with `_morphoChains.readPosition`
    // stubbed to return the same mock value, proving byte-identity holds
    // end-to-end through the prepare-tool path.
    const data = encodeMorphoRepay(
      TEST_WSTETH_USDC_PARAMS,
      0n,
      MOCK_BORROW_SHARES,
      ONBEHALF,
      "0x",
    );
    // Selector slice — 0x20b76e81 (research § Topic 2 repay).
    expect(data.slice(0, 10).toLowerCase()).toBe("0x20b76e81");

    const fp = computePayloadFingerprint({
      chainId: 1,
      to: morpho!,
      valueWei: 0n,
      data,
    });

    // Hardcoded literal anchor — Morpho's canonical repay-max idiom is
    // share-based (NOT MAX_UINT256 like Compound). Research § Topic 5.
    // Cross-linked from upcoming test/prepare-morpho-repay.test.ts (Plan 29-03)
    // and from the integration test that re-anchors this fixture across
    // persona swaps.
    expect(fp).toBe("0x223f830e5d6bd6f544bd80bfd7afe90441c0038a7259a415e3af96127a9182a0");
  });

  it("Fixture Y — Morpho Blue supplyCollateral(wstETH, 1e18) into wstETH/USDC market — post collateral to enable borrowing (hardcoded literal anchor, Phase 29 / Plan 29-01)", () => {
    const morpho = getMorphoBlueAddress(1);
    expect(morpho).not.toBeNull();

    const data = encodeMorphoSupplyCollateral(
      TEST_WSTETH_USDC_PARAMS,
      1_000_000_000_000_000_000n, // 1 wstETH, decimals=18
      ONBEHALF,
      "0x",
    );
    // Selector slice — 0x238d6579 (research § Topic 2 supplyCollateral).
    expect(data.slice(0, 10).toLowerCase()).toBe("0x238d6579");

    const fp = computePayloadFingerprint({
      chainId: 1,
      to: morpho!,
      valueWei: 0n,
      data,
    });

    // Hardcoded literal anchor — collateral writes are asset-only (no shares
    // field; Morpho's collateral slot is a raw uint128, NOT a shares-receipt).
    // Cross-linked from upcoming test/prepare-morpho-supply-collateral.test.ts
    // (Plan 29-03).
    expect(fp).toBe("0x95d629f91d33efb39048fc7f09ef24d4f7452c9a4ee88100f8cfc008ce4c0539");
  });
});
