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
  getAllCompoundCometsForChain,
  getCompoundCometAddress,
  getMorphoBlueAddress,
  getWethAddress,
  lookupSpender,
  type ChainId,
  type ChainName,
  type CompoundCometBase,
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

// ---------------------------------------------------------------------------
// Compound V3 Comet SOT (Phase 28 Plan 28-01) — 6 mainnet Comets +
// KNOWN_SPENDERS_ETHEREUM cross-view consistency. Provenance:
// [compound-finance/comet/deployments/mainnet](https://github.com/compound-finance/comet/tree/main/deployments)
// research-time 2026-05-20 (research § Topic 1).
// ---------------------------------------------------------------------------

describe("src/config/contracts.ts — Compound V3 Comet SOT (Phase 28 Plan 28-01)", () => {
  // T1-T6 — byte-identity per Comet getter (mainnet research § Topic 1).
  it("Test 1 — getCompoundCometAddress(1, 'USDC') returns canonical cUSDCv3 address", () => {
    expect(getCompoundCometAddress(1, "USDC")).toBe(
      getAddress("0xc3d688B66703497DAA19211EEdff47f25384cdc3"),
    );
  });

  it("Test 2 — getCompoundCometAddress(1, 'USDT') returns canonical cUSDTv3 address", () => {
    expect(getCompoundCometAddress(1, "USDT")).toBe(
      getAddress("0x3Afdc9BCA9213A35503b077a6072F3D0d5AB0840"),
    );
  });

  it("Test 3 — getCompoundCometAddress(1, 'WETH') returns canonical cWETHv3 address", () => {
    expect(getCompoundCometAddress(1, "WETH")).toBe(
      getAddress("0xA17581A9E3356d9A858b789D68B4d866e593aE94"),
    );
  });

  it("Test 4 — getCompoundCometAddress(1, 'USDS') returns canonical cUSDSv3 address", () => {
    expect(getCompoundCometAddress(1, "USDS")).toBe(
      getAddress("0x5D409e56D886231aDAf00c8775665AD0f9897b56"),
    );
  });

  it("Test 5 — getCompoundCometAddress(1, 'wstETH') returns canonical cwstETHv3 address", () => {
    expect(getCompoundCometAddress(1, "wstETH")).toBe(
      getAddress("0x3D0bb1ccaB520A66e607822fC55BC921738fAFE3"),
    );
  });

  it("Test 6 — getCompoundCometAddress(1, 'WBTC') returns canonical cWBTCv3 address", () => {
    expect(getCompoundCometAddress(1, "WBTC")).toBe(
      getAddress("0xe85Dc543813B8c2CFEaAc371517b925a166a9293"),
    );
  });

  // T7 — getAllCompoundCometsForChain(1) returns exactly 6 entries (set
  // equality, order-independent per JS Object.values stability).
  it("Test 7 — getAllCompoundCometsForChain(1) returns the 6 mainnet Comet addresses (set-equality)", () => {
    const comets = getAllCompoundCometsForChain(1);
    expect(comets.length).toBe(6);
    const expected = new Set(
      ["USDC", "USDT", "WETH", "USDS", "wstETH", "WBTC"].map(
        (b) => getCompoundCometAddress(1, b as CompoundCometBase)!,
      ),
    );
    expect(new Set(comets)).toEqual(expected);
  });

  // T8 — Compound-absent chain returns []. Polygon (137) is a valid
  // ChainId per Phase 8 widening but COMPOUND_COMETS_RAW has no row for it
  // (v2.3.x extends). The runtime returns [], NOT undefined / throw — the
  // canonical-dispatch allowlist in Plan 28-04 iterates this safely.
  it("Test 8a — getAllCompoundCometsForChain(137) (Polygon — valid ChainId, no Comet row yet) returns []", () => {
    expect(getAllCompoundCometsForChain(137)).toEqual([]);
  });

  // T8b — Compile-time narrowing: getAllCompoundCometsForChain(999) is a TS
  // error (999 not in the 5-chain ChainId union). The @ts-expect-error
  // directive proves the narrowing is enforced; if a future plan widens
  // ChainId to include 999, this directive warns (signal to update test
  // alongside the type change). The runtime call still returns [] (defensive
  // — `COMPOUND_COMETS_RAW[999]` is undefined; the function falls through
  // to the empty-array branch).
  it("Test 8b — getAllCompoundCometsForChain(999) is a TS compile error (ChainId narrows to 5-chain union)", () => {
    // @ts-expect-error — chainId 999 not in the ChainId union (1 | 42161 | 137 | 8453 | 10)
    const _wrong = () => getAllCompoundCometsForChain(999);
    expect(typeof _wrong).toBe("function");
    // Defensive runtime check — the function still returns [] for an
    // unknown chain (no throw; v2.3.x callers iterate safely).
    // @ts-expect-error — chainId 999 not in the ChainId union (1 | 42161 | 137 | 8453 | 10)
    expect(getAllCompoundCometsForChain(999)).toEqual([]);
  });

  // T9 — Cross-view consistency: KNOWN_SPENDERS_ETHEREUM rows match the SOT
  // getters byte-identical for all 6 base assets. T-COMPOUND-COMET-ADDR-INLINE-1
  // anchor — drift between the SOT and the spender row fails the test.
  it("Test 9 — KNOWN_SPENDERS_ETHEREUM Compound rows ↔ Comet getters byte-identical (cross-view consistency)", () => {
    const labelByBase: Record<CompoundCometBase, string> = {
      USDC: "Compound V3 cUSDCv3",
      USDS: "Compound V3 cUSDSv3",
      USDT: "Compound V3 cUSDTv3",
      WBTC: "Compound V3 cWBTCv3",
      WETH: "Compound V3 cWETHv3",
      wstETH: "Compound V3 cwstETHv3",
    };
    const bases: CompoundCometBase[] = ["USDC", "USDS", "USDT", "WBTC", "WETH", "wstETH"];
    for (const base of bases) {
      const spenderRow = KNOWN_SPENDERS_ETHEREUM.find((r) => r.label === labelByBase[base]);
      expect(spenderRow).toBeDefined();
      expect(getCompoundCometAddress(1, base)).toBe(spenderRow?.address);
    }
  });

  // Defensive — every Comet address is EIP-55 checksummed (corrupted-snapshot
  // guard fires at module load via `getAddress`).
  it("Bonus — every Comet address is EIP-55 round-trip (corrupted-snapshot guard)", () => {
    const bases: CompoundCometBase[] = ["USDC", "USDS", "USDT", "WBTC", "WETH", "wstETH"];
    for (const base of bases) {
      const addr = getCompoundCometAddress(1, base);
      expect(addr).not.toBeNull();
      expect(addr).toBe(getAddress(addr!));
    }
  });
});

// ---------------------------------------------------------------------------
// Morpho Blue SOT (Phase 29 Plan 29-01) — singleton-per-chain contract address
// + KNOWN_SPENDERS_ETHEREUM cross-view consistency + morpho-markets-ethereum.json
// shape. Provenance: docs.morpho.org/addresses + LedgerHQ ERC-7730
// calldata-MorphoBlue.json (research § Topic 1, research date 2026-05-21).
// ---------------------------------------------------------------------------

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

describe("src/config/contracts.ts — Morpho Blue SOT (Phase 29 Plan 29-01)", () => {
  // T1 — getMorphoBlueAddress(1) byte-identity against the canonical literal.
  // The address is a CREATE2-vanity deployment present on all 40+ supported
  // chains; Phase 29 ships chainId 1 ONLY.
  it("Test 1 — getMorphoBlueAddress(1) returns 0xBBBB…FFCb byte-identical (research § Topic 1)", () => {
    expect(getMorphoBlueAddress(1)).toBe(
      getAddress("0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb"),
    );
  });

  // T2 — chain narrowing: non-1 ChainId values return null (Phase 29
  // mainnet-only scope). 8453 (Base) and 137 (Polygon) compile because both
  // are valid ChainId members per Phase 8; runtime returns null (the row is
  // absent from MORPHO_BLUE_RAW). v2.3.x will populate these rows; the test
  // documents the current scope.
  it("Test 2a — getMorphoBlueAddress(8453) (Base — valid ChainId, no Morpho row yet) returns null", () => {
    expect(getMorphoBlueAddress(8453)).toBeNull();
  });

  it("Test 2b — getMorphoBlueAddress(137) (Polygon — valid ChainId, no Morpho row yet) returns null", () => {
    expect(getMorphoBlueAddress(137)).toBeNull();
  });

  it("Test 2c — getMorphoBlueAddress(42161) + getMorphoBlueAddress(10) return null (Arbitrum + Optimism)", () => {
    expect(getMorphoBlueAddress(42161)).toBeNull();
    expect(getMorphoBlueAddress(10)).toBeNull();
  });

  // T3 — Cross-view consistency: KNOWN_SPENDERS_ETHEREUM Morpho row matches
  // getMorphoBlueAddress(1) byte-identical. Drift = T-29-01-T-FROZEN signal.
  it("Test 3 — KNOWN_SPENDERS_ETHEREUM 'Morpho Blue' row ↔ getMorphoBlueAddress(1) byte-identical", () => {
    const morphoRow = KNOWN_SPENDERS_ETHEREUM.find((r) => r.label === "Morpho Blue");
    expect(morphoRow).toBeDefined();
    expect(morphoRow?.address).toBe(getMorphoBlueAddress(1));
  });

  // T3b — KNOWN_SPENDERS_ETHEREUM still grows by exactly 1 row (Plan 29-01
  // delta) from the Phase 28 baseline. Anchor count >= 11 (Phase 6 + Phase 28
  // baseline) keeps the test future-proof against further additions.
  it("Test 3b — KNOWN_SPENDERS_ETHEREUM length anchor >= 11 still holds (Phase 29 adds exactly 1 row)", () => {
    expect(KNOWN_SPENDERS_ETHEREUM.length).toBeGreaterThanOrEqual(11);
    // Confirms there is exactly one "Morpho Blue" row (no accidental dupes).
    const morphoRows = KNOWN_SPENDERS_ETHEREUM.filter((r) => r.label === "Morpho Blue");
    expect(morphoRows.length).toBe(1);
  });

  // Bonus — getMorphoBlueAddress(1) is EIP-55 checksummed (corrupted-snapshot
  // guard fires at module load via `getAddress`).
  it("Bonus — getMorphoBlueAddress(1) is EIP-55 round-trip (corrupted-snapshot guard)", () => {
    const addr = getMorphoBlueAddress(1);
    expect(addr).not.toBeNull();
    expect(addr).toBe(getAddress(addr!));
  });
});

// T4 — morpho-markets-ethereum.json shape validation. The registry is a
// labeling surface (NOT a trust gate); the test asserts the JSON snapshot
// is well-formed so a future contributor refreshing the registry catches
// typos / missing fields at PR-review time.
describe("src/tokens/morpho-markets-ethereum.json — 25-entry registry shape (Phase 29 Plan 29-01)", () => {
  // Resolve the JSON via its absolute file path so the test stays decoupled
  // from the build output's `dist/` layout.
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const REGISTRY_PATH = resolve(__dirname, "../src/tokens/morpho-markets-ethereum.json");

  interface MorphoMarketEntry {
    marketId: string;
    loanToken: { address: string; symbol: string; decimals: number };
    collateralToken: { address: string; symbol: string; decimals: number };
    oracle: string;
    irm: string;
    lltv: string;
    label: string;
  }

  const registry: MorphoMarketEntry[] = JSON.parse(readFileSync(REGISTRY_PATH, "utf-8"));

  it("Test 4 — registry has exactly 25 entries (top-by-TVL snapshot at planning time)", () => {
    expect(registry.length).toBe(25);
  });

  it("Test 4a — every marketId is a 0x-prefixed 66-char hex string (32-byte keccak256 output)", () => {
    for (const entry of registry) {
      expect(entry.marketId).toMatch(/^0x[0-9a-f]{64}$/i);
      expect(entry.marketId.length).toBe(66);
    }
  });

  it("Test 4b — every loanToken/collateralToken address is EIP-55 checksummed (round-trip via getAddress)", () => {
    for (const entry of registry) {
      expect(entry.loanToken.address).toBe(getAddress(entry.loanToken.address));
      expect(entry.collateralToken.address).toBe(getAddress(entry.collateralToken.address));
      expect(entry.loanToken.address.length).toBe(42);
      expect(entry.collateralToken.address.length).toBe(42);
    }
  });

  it("Test 4c — every loanToken/collateralToken decimals is a non-negative integer", () => {
    for (const entry of registry) {
      expect(Number.isInteger(entry.loanToken.decimals)).toBe(true);
      expect(entry.loanToken.decimals).toBeGreaterThanOrEqual(0);
      expect(Number.isInteger(entry.collateralToken.decimals)).toBe(true);
      expect(entry.collateralToken.decimals).toBeGreaterThanOrEqual(0);
    }
  });

  it("Test 4d — every oracle/irm address is EIP-55 checksummed (round-trip via getAddress)", () => {
    for (const entry of registry) {
      expect(entry.oracle).toBe(getAddress(entry.oracle));
      expect(entry.irm).toBe(getAddress(entry.irm));
      expect(entry.oracle.length).toBe(42);
      expect(entry.irm.length).toBe(42);
    }
  });

  it("Test 4e — every lltv is a decimal-string parseable as bigint with 0 < lltv < 1e18", () => {
    for (const entry of registry) {
      expect(typeof entry.lltv).toBe("string");
      // Must be all digits (decimal string, no `0x` prefix, no negative).
      expect(entry.lltv).toMatch(/^\d+$/);
      const lltvBig = BigInt(entry.lltv);
      expect(lltvBig).toBeGreaterThan(0n);
      // 1e18 = full LLTV (100%) — Morpho whitelisted markets are strictly below.
      expect(lltvBig).toBeLessThan(10n ** 18n);
    }
  });

  it("Test 4f — every label is a non-empty string", () => {
    for (const entry of registry) {
      expect(typeof entry.label).toBe("string");
      expect(entry.label.length).toBeGreaterThan(0);
    }
  });

  // Anchor — the wstETH/USDC market (the deriveMarketId regression literal)
  // is present in the snapshot. Re-anchors the cross-link between this
  // registry and test/protocols-morpho-blue.test.ts T2.
  it("Test 4g — wstETH/USDC market literal 0xb323495f...c86cc is present in the snapshot", () => {
    const wstethUsdc = registry.find(
      (e) => e.marketId === "0xb323495f7e4148be5643a4ea4a8221eef163e4bccfdedc2a6f4696baacbc86cc",
    );
    expect(wstethUsdc).toBeDefined();
    expect(wstethUsdc?.loanToken.symbol).toBe("USDC");
    expect(wstethUsdc?.collateralToken.symbol).toBe("wstETH");
  });
});
