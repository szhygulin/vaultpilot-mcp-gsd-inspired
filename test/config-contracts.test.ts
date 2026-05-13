// src/config/contracts.ts — SOT for canonical contract addresses (project
// CLAUDE.md mandated location). Phase 6 — Plan 06-03.
//
// Regression test discipline:
//   - getWethAddress(1) byte-identical to the hardcoded literal in
//     src/tools/get_portfolio_summary.ts:17 (cross-link assertion; Plan 06-04
//     will eliminate the duplicate by importing from here)
//   - KNOWN_SPENDERS_ETHEREUM.length >= 11 (Phase 7 may add the 12th slot
//     for Aave V3 Pool — although Aave is ALREADY in the seeded 11; if Phase
//     7 ships an additional bridge / lending integration, the count grows
//     without churning this test)
//   - Each row's address byte-identical to the hardcoded literal (re-checksum
//     invariant; T-SPENDER-LABEL-INJECTION-1 defense layer)
//   - lookupSpender case-insensitive (T-SPENDER-CASE-1 mitigation)
//   - lookupSpender unknown spender → undefined
//   - Phase 8 forward-compat: ChainId is currently `1`; getWethAddress(999)
//     is a compile error (proves the SOT cannot silently leak across chains)

import { describe, expect, it } from "vitest";
import { getAddress, type Address } from "viem";

import {
  KNOWN_SPENDERS_ETHEREUM,
  getAaveV3IncentivesController,
  getAaveV3Oracle,
  getAaveV3PoolAddress,
  getAaveV3PoolAddressesProvider,
  getAaveV3UiPoolDataProvider,
  getWethAddress,
  lookupSpender,
} from "../src/config/contracts.js";

describe("src/config/contracts.ts — getWethAddress(1)", () => {
  it("returns the canonical WETH9 address (byte-identical to get_portfolio_summary.ts:17)", () => {
    // The literal in src/tools/get_portfolio_summary.ts line 17 must match.
    // Plan 06-04 will eliminate the duplicate (migrate that file to import
    // from here); until then, the byte-identity is the cross-link.
    expect(getWethAddress(1)).toBe("0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2");
  });

  it("returned address is EIP-55 checksummed (passes through getAddress unchanged)", () => {
    const addr = getWethAddress(1);
    expect(addr).toBe(getAddress(addr));
  });
});

describe("src/config/contracts.ts — KNOWN_SPENDERS_ETHEREUM table", () => {
  it("ships at least 11 seeded entries (Phase 7 may add more without churn)", () => {
    expect(KNOWN_SPENDERS_ETHEREUM.length).toBeGreaterThanOrEqual(11);
  });

  it("every row's address is EIP-55 checksummed (corrupted-snapshot guard)", () => {
    for (const row of KNOWN_SPENDERS_ETHEREUM) {
      expect(row.address).toBe(getAddress(row.address));
    }
  });

  it("every row has a non-empty label AND a non-empty source citation", () => {
    for (const row of KNOWN_SPENDERS_ETHEREUM) {
      expect(row.label.length).toBeGreaterThan(0);
      expect(row.source.length).toBeGreaterThan(0);
    }
  });

  it("includes the Uniswap V3 SwapRouter row at its hardcoded literal (T-SPENDER-LABEL-INJECTION-1 anchor)", () => {
    const row = KNOWN_SPENDERS_ETHEREUM.find((r) => r.label === "Uniswap V3 SwapRouter");
    expect(row).toBeDefined();
    expect(row?.address).toBe("0xE592427A0AEce92De3Edee1F18E0157C05861564");
  });

  it("includes the Aave V3 Pool row at its hardcoded literal", () => {
    const row = KNOWN_SPENDERS_ETHEREUM.find((r) => r.label === "Aave V3 Pool");
    expect(row).toBeDefined();
    // Aave V3 Pool address. Source: https://aave.com/docs/resources/addresses
    expect(row?.address).toBe(getAddress("0x87870bca3f3fd6335c3f4ce8392d69350b4fa4e2"));
  });
});

describe("src/config/contracts.ts — lookupSpender (T-SPENDER-CASE-1 mitigation)", () => {
  const UNISWAP_V3_CHECKSUMMED = "0xE592427A0AEce92De3Edee1F18E0157C05861564" as Address;

  it("happy path: checksummed input → returns the matched row", () => {
    const row = lookupSpender(UNISWAP_V3_CHECKSUMMED);
    expect(row).toBeDefined();
    expect(row?.label).toBe("Uniswap V3 SwapRouter");
  });

  it("case-insensitive: lowercase input → returns the same row", () => {
    const lower = UNISWAP_V3_CHECKSUMMED.toLowerCase() as Address;
    const row = lookupSpender(lower);
    expect(row).toBeDefined();
    expect(row?.label).toBe("Uniswap V3 SwapRouter");
  });

  it("case-insensitive: uppercase input → returns the same row", () => {
    // Build an all-uppercase variant of the hex body (preserve 0x prefix).
    const upper = ("0x" + UNISWAP_V3_CHECKSUMMED.slice(2).toUpperCase()) as Address;
    const row = lookupSpender(upper);
    expect(row).toBeDefined();
    expect(row?.label).toBe("Uniswap V3 SwapRouter");
  });

  it("unknown spender → returns undefined (caller renders fallback label)", () => {
    const unknownAddr = ("0x" + "00".repeat(20)) as Address;
    expect(lookupSpender(unknownAddr)).toBeUndefined();
  });

  it("another known row: Uniswap Permit2 surfaces by checksummed address", () => {
    const row = lookupSpender("0x000000000022D473030F116dDEE9F6B43aC78BA3" as Address);
    expect(row?.label).toBe("Uniswap Permit2");
  });
});

describe("src/config/contracts.ts — Phase 8 forward-compat (ChainId narrowing)", () => {
  it("getWethAddress(1) compiles; getWethAddress(999) does NOT (ChainId narrows)", () => {
    // Positive path — narrows to the only known chain.
    const addr = getWethAddress(1);
    expect(addr).toMatch(/^0x[0-9a-fA-F]{40}$/);

    // Negative path — TS rejects 999 at compile time. The @ts-expect-error
    // directive proves the narrowing is enforced; if Phase 8 widens
    // ChainId to include 999, this directive will warn (signal to update
    // the test alongside the type change). Mirror of Plan 05-01's
    // set_demo_wallet TS-narrowing test.
    // @ts-expect-error — chainId 999 not in the ChainId union (only `1` ships in v1.x)
    const _wrong = () => getWethAddress(999);
    expect(typeof _wrong).toBe("function");
  });
});

describe("src/config/contracts.ts — Aave V3 typed slots (Phase 7 Plan 07-01)", () => {
  // Cross-verified addresses from research § Topic 1 (bgd-labs/aave-address-book
  // + Etherscan). Byte-identity assertions per slot — drift between the SOT
  // and the research literal fails the test at PR-review time. PREP-24
  // regression anchor.

  it("getAaveV3PoolAddress(1) returns the canonical Aave V3 Pool address (byte-identical to research literal)", () => {
    expect(getAaveV3PoolAddress(1)).toBe(getAddress("0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2"));
  });

  it("getAaveV3PoolAddressesProvider(1) returns the canonical PoolAddressesProvider", () => {
    expect(getAaveV3PoolAddressesProvider(1)).toBe(getAddress("0x2f39d218133AFaB8F2B819B1066c7E434Ad94E9e"));
  });

  it("getAaveV3UiPoolDataProvider(1) returns the canonical UiPoolDataProviderV3", () => {
    expect(getAaveV3UiPoolDataProvider(1)).toBe(getAddress("0x56b7A1012765C285afAC8b8F25C69Bf10ccfE978"));
  });

  it("getAaveV3Oracle(1) returns the canonical AaveOracle", () => {
    expect(getAaveV3Oracle(1)).toBe(getAddress("0x54586bE62E3c3580375aE3723C145253060Ca0C2"));
  });

  it("getAaveV3IncentivesController(1) returns the canonical DEFAULT_INCENTIVES_CONTROLLER", () => {
    expect(getAaveV3IncentivesController(1)).toBe(getAddress("0x8164Cc65827dcFe994AB23944CBC90e0aa80bFcb"));
  });

  it("every Aave V3 typed slot is EIP-55 checksummed (corrupted-snapshot guard fires at module load)", () => {
    for (const addr of [
      getAaveV3PoolAddress(1),
      getAaveV3PoolAddressesProvider(1),
      getAaveV3UiPoolDataProvider(1),
      getAaveV3Oracle(1),
      getAaveV3IncentivesController(1),
    ]) {
      expect(addr).toBe(getAddress(addr));
    }
  });

  it("Aave V3 Pool typed-slot value is byte-identical to KNOWN_SPENDERS_ETHEREUM Aave V3 Pool row (cross-view consistency — T-AAVE-SPENDER-DRIFT-1 anchor)", () => {
    const spenderRow = KNOWN_SPENDERS_ETHEREUM.find((r) => r.label === "Aave V3 Pool");
    expect(spenderRow).toBeDefined();
    expect(getAaveV3PoolAddress(1)).toBe(spenderRow?.address);
  });

  it("getAaveV3PoolAddress(999) is a TS compile error (ChainId narrows) — proves the v1.1 single-chain lock", () => {
    // Positive path — narrows to the only known chain.
    const addr = getAaveV3PoolAddress(1);
    expect(addr).toMatch(/^0x[0-9a-fA-F]{40}$/);
    // @ts-expect-error — chainId 999 not in the ChainId union (only `1` ships in v1.x; Phase 8 widens)
    const _wrong = () => getAaveV3PoolAddress(999);
    expect(typeof _wrong).toBe("function");
  });
});
