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
  chainIdFromName,
  chainNameFromId,
  getAaveV3IncentivesController,
  getAaveV3Oracle,
  getAaveV3PoolAddress,
  getAaveV3PoolAddressesProvider,
  getAaveV3UiPoolDataProvider,
  getWethAddress,
  lookupSpender,
  type ChainId,
  type ChainName,
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

describe("src/config/contracts.ts — Phase 8 ChainId narrowing (5-chain union)", () => {
  it("getWethAddress(1) compiles; getWethAddress(999) does NOT (ChainId narrows to 5-chain union)", () => {
    // Positive path — narrows to the 5 supported chains.
    const addr = getWethAddress(1);
    expect(addr).toMatch(/^0x[0-9a-fA-F]{40}$/);

    // Negative path — TS rejects 999 at compile time. The @ts-expect-error
    // directive proves the narrowing is enforced; if Phase 9 widens
    // ChainId to include 999, this directive will warn (signal to update
    // the test alongside the type change).
    // @ts-expect-error — chainId 999 not in the ChainId union (1 | 42161 | 137 | 8453 | 10)
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

  it("getAaveV3PoolAddress(999) is a TS compile error (ChainId narrows to 5-chain union)", () => {
    // Positive path — narrows to the supported chains.
    const addr = getAaveV3PoolAddress(1);
    expect(addr).toMatch(/^0x[0-9a-fA-F]{40}$/);
    // @ts-expect-error — chainId 999 not in the ChainId union (1 | 42161 | 137 | 8453 | 10)
    const _wrong = () => getAaveV3PoolAddress(999);
    expect(typeof _wrong).toBe("function");
  });
});

// ---------------------------------------------------------------------------
// Phase 8 Plan 08-01 — multi-chain SOT widening. 25 byte-identity pins
// (5 chains × 5 typed slots; the 5th chain's WETH covers slot 6) + EIP-55
// round-trip + ChainName helpers + KNOWN_SPENDERS Ethereum-only lock.
//
// Provenance: bgd-labs/aave-address-book/src/AaveV3{Chain}.sol HEAD as of
// 2026-05-16. The Aave Pool address `0x794a…14aD` is byte-identical on
// arbitrum / polygon / optimism (canonical proxy); Base ships its own
// distinct deployment `0xA238…d1c5`.
// ---------------------------------------------------------------------------

describe("src/config/contracts.ts — Phase 8 per-chain WETH (5 chains)", () => {
  it("Test 1 — getWethAddress(1) ethereum canonical WETH9", () => {
    expect(getWethAddress(1)).toBe(getAddress("0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2"));
  });
  it("Test 2 — getWethAddress(42161) arbitrum WETH", () => {
    expect(getWethAddress(42161)).toBe(getAddress("0x82aF49447D8a07e3bd95BD0d56f35241523fBab1"));
  });
  it("Test 3 — getWethAddress(137) polygon bridged WETH", () => {
    expect(getWethAddress(137)).toBe(getAddress("0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619"));
  });
  it("Test 4 — getWethAddress(8453) base OP-Stack WETH predeploy", () => {
    expect(getWethAddress(8453)).toBe(getAddress("0x4200000000000000000000000000000000000006"));
  });
  it("Test 5 — getWethAddress(10) optimism OP-Stack WETH predeploy", () => {
    expect(getWethAddress(10)).toBe(getAddress("0x4200000000000000000000000000000000000006"));
  });
});

describe("src/config/contracts.ts — Phase 8 per-chain Aave V3 Pool (5 chains)", () => {
  it("Test 6 — ethereum Aave V3 Pool unchanged from Phase 7", () => {
    expect(getAaveV3PoolAddress(1)).toBe(getAddress("0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2"));
  });
  it("Test 7 — arbitrum Aave V3 Pool (canonical proxy)", () => {
    expect(getAaveV3PoolAddress(42161)).toBe(getAddress("0x794a61358D6845594F94dc1DB02A252b5b4814aD"));
  });
  it("Test 8 — polygon Aave V3 Pool (canonical proxy — same as arbitrum/optimism)", () => {
    expect(getAaveV3PoolAddress(137)).toBe(getAddress("0x794a61358D6845594F94dc1DB02A252b5b4814aD"));
  });
  it("Test 9 — base Aave V3 Pool (distinct deployment)", () => {
    expect(getAaveV3PoolAddress(8453)).toBe(getAddress("0xA238Dd80C259a72e81d7e4664a9801593F98d1c5"));
  });
  it("Test 10 — optimism Aave V3 Pool (canonical proxy — same as arbitrum/polygon)", () => {
    expect(getAaveV3PoolAddress(10)).toBe(getAddress("0x794a61358D6845594F94dc1DB02A252b5b4814aD"));
  });
});

describe("src/config/contracts.ts — Phase 8 per-chain PoolAddressesProvider (5 chains)", () => {
  it("Test 11 — ethereum unchanged from Phase 7", () => {
    expect(getAaveV3PoolAddressesProvider(1)).toBe(
      getAddress("0x2f39d218133AFaB8F2B819B1066c7E434Ad94E9e"),
    );
  });
  it("Test 12 — arbitrum", () => {
    expect(getAaveV3PoolAddressesProvider(42161)).toBe(
      getAddress("0xa97684ead0e402dC232d5A977953DF7ECBaB3CDb"),
    );
  });
  it("Test 13 — polygon (shared canonical with arbitrum/optimism)", () => {
    expect(getAaveV3PoolAddressesProvider(137)).toBe(
      getAddress("0xa97684ead0e402dC232d5A977953DF7ECBaB3CDb"),
    );
  });
  it("Test 14 — base (distinct)", () => {
    expect(getAaveV3PoolAddressesProvider(8453)).toBe(
      getAddress("0xe20fCBdBfFC4Dd138cE8b2E6FBb6CB49777ad64D"),
    );
  });
  it("Test 15 — optimism (shared canonical with arbitrum/polygon)", () => {
    expect(getAaveV3PoolAddressesProvider(10)).toBe(
      getAddress("0xa97684ead0e402dC232d5A977953DF7ECBaB3CDb"),
    );
  });
});

describe("src/config/contracts.ts — Phase 8 per-chain UiPoolDataProviderV3 (5 chains)", () => {
  it("Test 16 — ethereum unchanged from Phase 7", () => {
    expect(getAaveV3UiPoolDataProvider(1)).toBe(
      getAddress("0x56b7A1012765C285afAC8b8F25C69Bf10ccfE978"),
    );
  });
  it("Test 17 — arbitrum", () => {
    expect(getAaveV3UiPoolDataProvider(42161)).toBe(
      getAddress("0x145dE30c929a065582da84Cf96F88460dB9745A7"),
    );
  });
  it("Test 18 — polygon", () => {
    expect(getAaveV3UiPoolDataProvider(137)).toBe(
      getAddress("0x68100bD5345eA474D93577127C11F39FF8463e93"),
    );
  });
  it("Test 19 — base", () => {
    expect(getAaveV3UiPoolDataProvider(8453)).toBe(
      getAddress("0x174446a6741300cD2E7C1b1A636Fee99c8F83502"),
    );
  });
  it("Test 20 — optimism", () => {
    expect(getAaveV3UiPoolDataProvider(10)).toBe(
      getAddress("0xbd83DdBE37fc91923d59C8c1E0bDe0CccCa332d5"),
    );
  });
});

describe("src/config/contracts.ts — Phase 8 per-chain AaveOracle + IncentivesController (5 chains)", () => {
  it("Test 21 — arbitrum AaveOracle", () => {
    expect(getAaveV3Oracle(42161)).toBe(getAddress("0xb56c2F0B653B2e0b10C9b928C8580Ac5Df02C7C7"));
  });
  it("Test 22 — polygon AaveOracle", () => {
    expect(getAaveV3Oracle(137)).toBe(getAddress("0xb023e699F5a33916Ea823A16485e259257cA8Bd1"));
  });
  it("Test 23 — base AaveOracle", () => {
    expect(getAaveV3Oracle(8453)).toBe(getAddress("0x2Cc0Fc26eD4563A5ce5e8bdcfe1A2878676Ae156"));
  });
  it("Test 24 — optimism AaveOracle", () => {
    expect(getAaveV3Oracle(10)).toBe(getAddress("0xD81eb3728a631871a7eBBaD631b5f424909f0c77"));
  });
  it("Test 25 — base IncentivesController is the distinct Base deployment (other 3 L2s share `0x929E…473e`)", () => {
    expect(getAaveV3IncentivesController(8453)).toBe(
      getAddress("0xf9cc4F0D883F1a1eb2c253bdb46c254Ca51E1F44"),
    );
    expect(getAaveV3IncentivesController(42161)).toBe(
      getAddress("0x929EC64c34a17401F460460D4B9390518E5B473e"),
    );
    expect(getAaveV3IncentivesController(137)).toBe(
      getAddress("0x929EC64c34a17401F460460D4B9390518E5B473e"),
    );
    expect(getAaveV3IncentivesController(10)).toBe(
      getAddress("0x929EC64c34a17401F460460D4B9390518E5B473e"),
    );
  });
});

describe("src/config/contracts.ts — Phase 8 EIP-55 round-trip across all chains/slots", () => {
  it("Test 26 — every per-chain Aave + WETH literal is EIP-55 round-trip (corrupted-snapshot guard)", () => {
    const chains: ChainId[] = [1, 42161, 137, 8453, 10];
    for (const c of chains) {
      for (const addr of [
        getWethAddress(c),
        getAaveV3PoolAddress(c),
        getAaveV3PoolAddressesProvider(c),
        getAaveV3UiPoolDataProvider(c),
        getAaveV3Oracle(c),
        getAaveV3IncentivesController(c),
      ]) {
        expect(addr).toBe(getAddress(addr));
      }
    }
  });
});

describe("src/config/contracts.ts — Phase 8 ChainName + chainIdFromName + chainNameFromId", () => {
  it("Test 27 — chainIdFromName total over the 5-name domain", () => {
    expect(chainIdFromName("ethereum")).toBe(1);
    expect(chainIdFromName("arbitrum")).toBe(42161);
    expect(chainIdFromName("polygon")).toBe(137);
    expect(chainIdFromName("base")).toBe(8453);
    expect(chainIdFromName("optimism")).toBe(10);
  });

  it("Test 28 — round-trip: chainNameFromId(chainIdFromName(n)) === n for all 5 ChainNames", () => {
    const names: ChainName[] = ["ethereum", "arbitrum", "polygon", "base", "optimism"];
    for (const n of names) {
      expect(chainNameFromId(chainIdFromName(n))).toBe(n);
    }
  });
});

describe("src/config/contracts.ts — KNOWN_SPENDERS Ethereum-only lock (Plan 08-01)", () => {
  it("Test 29 — KNOWN_SPENDERS_ETHEREUM length anchor unchanged at >= 11; Aave V3 Pool still at row 0", () => {
    expect(KNOWN_SPENDERS_ETHEREUM.length).toBeGreaterThanOrEqual(11);
    expect(KNOWN_SPENDERS_ETHEREUM[0]?.label).toBe("Aave V3 Pool");
  });
});

describe("src/config/contracts.ts — Phase 8 ChainId widening compile-time guards", () => {
  it("Test 30 — chainIdFromName narrows: chainIdFromName('not-a-chain') is a TS error", () => {
    // @ts-expect-error — 'not-a-chain' not in ChainName union
    const _wrong = () => chainIdFromName("not-a-chain");
    expect(typeof _wrong).toBe("function");
  });
});
