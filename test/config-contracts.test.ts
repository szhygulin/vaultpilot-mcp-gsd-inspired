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
  getAllCurvePoolsForChain,
  getCurvePoolByAddress,
  KNOWN_SPENDERS_ETHEREUM,
  ROCKET_POOL_MINIMUM_DEPOSIT_FALLBACK_WEI,
  chainIdFromName,
  chainNameFromId,
  getAaveV3IncentivesController,
  getAaveV3Oracle,
  getAaveV3PoolAddress,
  getAaveV3PoolAddressesProvider,
  getAaveV3UiPoolDataProvider,
  getAllCompoundCometsForChain,
  getAllEigenLayerStrategiesForChain,
  getCompoundCometAddress,
  getEigenLayerDelegationManagerAddress,
  getEigenLayerLstTokenAddress,
  getEigenLayerStrategyAddress,
  getEigenLayerStrategyManagerAddress,
  getLidoStethAddress,
  getLidoWstethAddress,
  getLidoWithdrawalQueueAddress,
  getMorphoBlueAddress,
  getRocketPoolDepositPoolAddress,
  getRocketPoolDepositSettingsAddress,
  getRocketPoolRethAddress,
  getSafeCompatibilityFallbackHandlerAddresses,
  getSafeMultiSendAddresses,
  getSafeMultiSendCallOnlyAddresses,
  getSafeProxyFactoryAddresses,
  getSafeSignMessageLibAddresses,
  getSafeSingletonAddresses,
  getUniswapV3NonfungiblePositionManagerAddress,
  getUniswapV3QuoterV2Address,
  getUniswapV3SwapRouter02Address,
  getWethAddress,
  lookupSpender,
  type ChainId,
  type ChainName,
  type CompoundCometBase,
  type EigenLayerLst,
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

  // T8 — Phase 41 Plan 41-01 extended Polygon with 2 Comet rows (USDC.e +
  // USDT); see the Phase 41 describe block below for per-chain assertions.
  // The stale "returns []" assertion for chainId 137 is intentionally removed
  // here — it would now be false.

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
// Compound V3 L2 SOT — Phase 41 Plan 41-01.
// Per-chain length + set-equality assertions for Arbitrum/Polygon/Base/Optimism;
// Ethereum-row-unchanged guard; USDbC deliberate-exclusion guard; USDC.e
// distinctness assertions.
// ---------------------------------------------------------------------------

describe("src/config/contracts.ts — Compound V3 L2 Comet SOT (Phase 41 Plan 41-01)", () => {
  // -----------------------------------------------------------------------
  // Arbitrum One (chainId 42161) — 4 Comets: USDC, USDC.e, USDT, WETH.
  // -----------------------------------------------------------------------
  it("Arbitrum — getAllCompoundCometsForChain(42161).length === 4", () => {
    expect(getAllCompoundCometsForChain(42161).length).toBe(4);
  });

  it("Arbitrum — getAllCompoundCometsForChain(42161) set-equals { USDC, USDC.e, USDT, WETH } lookups", () => {
    const comets = getAllCompoundCometsForChain(42161);
    const expected = new Set<string>([
      getCompoundCometAddress(42161, "USDC")!,
      getCompoundCometAddress(42161, "USDC.e")!,
      getCompoundCometAddress(42161, "USDT")!,
      getCompoundCometAddress(42161, "WETH")!,
    ]);
    expect(new Set(comets)).toEqual(expected);
  });

  it("Arbitrum — getCompoundCometAddress(42161, 'USDC') and 'USDC.e' are both non-null and distinct", () => {
    const usdc = getCompoundCometAddress(42161, "USDC");
    const usdce = getCompoundCometAddress(42161, "USDC.e");
    expect(usdc).not.toBeNull();
    expect(usdce).not.toBeNull();
    expect(usdc).not.toBe(usdce);
  });

  // -----------------------------------------------------------------------
  // Polygon PoS (chainId 137) — 2 Comets: USDC.e, USDT.
  // -----------------------------------------------------------------------
  it("Polygon — getAllCompoundCometsForChain(137).length === 2", () => {
    expect(getAllCompoundCometsForChain(137).length).toBe(2);
  });

  it("Polygon — getAllCompoundCometsForChain(137) set-equals { USDC.e, USDT } lookups", () => {
    const comets = getAllCompoundCometsForChain(137);
    const expected = new Set<string>([
      getCompoundCometAddress(137, "USDC.e")!,
      getCompoundCometAddress(137, "USDT")!,
    ]);
    expect(new Set(comets)).toEqual(expected);
  });

  it("Polygon — getCompoundCometAddress(137, 'USDC') is null (no native-USDC Comet); 'USDC.e' is non-null", () => {
    // Security: the agent cannot route native USDC as the Polygon base asset
    // by symbol confusion — the key "USDC" is absent; only "USDC.e" resolves.
    expect(getCompoundCometAddress(137, "USDC")).toBeNull();
    expect(getCompoundCometAddress(137, "USDC.e")).not.toBeNull();
  });

  // -----------------------------------------------------------------------
  // Base (chainId 8453) — 4 Comets: USDC, WETH, USDS, AERO.
  // USDbC deliberately excluded (Gauntlet Dec-2024 deprecation).
  // -----------------------------------------------------------------------
  it("Base — getAllCompoundCometsForChain(8453).length === 4", () => {
    expect(getAllCompoundCometsForChain(8453).length).toBe(4);
  });

  it("Base — getAllCompoundCometsForChain(8453) set-equals { USDC, WETH, USDS, AERO } lookups", () => {
    const comets = getAllCompoundCometsForChain(8453);
    const expected = new Set<string>([
      getCompoundCometAddress(8453, "USDC")!,
      getCompoundCometAddress(8453, "WETH")!,
      getCompoundCometAddress(8453, "USDS")!,
      getCompoundCometAddress(8453, "AERO")!,
    ]);
    expect(new Set(comets)).toEqual(expected);
  });

  it("Base — deprecated USDbC proxy 0x9c4ec768… is NOT in the Base arm (deliberate exclusion guard)", () => {
    // The deprecated USDbC Comet proxy (0x9c4ec768c28520B50860ea7a15bd7213a9fF58bf)
    // is intentionally excluded. It coincides with the Arbitrum USDC proxy on
    // a different chain — per-chain sets are disjoint; this assertion proves
    // the address is absent from the Base 8453 arm.
    const deprecatedUSDbC = getAddress("0x9c4ec768c28520B50860ea7a15bd7213a9fF58bf");
    const baseComets = getAllCompoundCometsForChain(8453);
    expect(baseComets).not.toContain(deprecatedUSDbC);
  });

  // -----------------------------------------------------------------------
  // OP Mainnet (chainId 10) — 3 Comets: USDC, USDT, WETH.
  // -----------------------------------------------------------------------
  it("Optimism — getAllCompoundCometsForChain(10).length === 3", () => {
    expect(getAllCompoundCometsForChain(10).length).toBe(3);
  });

  it("Optimism — getAllCompoundCometsForChain(10) set-equals { USDC, USDT, WETH } lookups", () => {
    const comets = getAllCompoundCometsForChain(10);
    const expected = new Set<string>([
      getCompoundCometAddress(10, "USDC")!,
      getCompoundCometAddress(10, "USDT")!,
      getCompoundCometAddress(10, "WETH")!,
    ]);
    expect(new Set(comets)).toEqual(expected);
  });

  // -----------------------------------------------------------------------
  // Ethereum-row-unchanged guard (byte-identity regression anchor).
  // Proves Task 1 did NOT perturb the 1: row; Fixtures R/S/T/U hardcoded
  // against these addresses remain valid.
  // -----------------------------------------------------------------------
  it("Ethereum-unchanged — getAllCompoundCometsForChain(1).length still === 6 after Phase 41 extension", () => {
    expect(getAllCompoundCometsForChain(1).length).toBe(6);
  });

  it("Ethereum-unchanged — getAllCompoundCometsForChain(1) set still equals { USDC, USDT, WETH, USDS, wstETH, WBTC } lookups", () => {
    const comets = getAllCompoundCometsForChain(1);
    const expected = new Set<string>(
      (["USDC", "USDT", "WETH", "USDS", "wstETH", "WBTC"] as CompoundCometBase[]).map(
        (b) => getCompoundCometAddress(1, b)!,
      ),
    );
    expect(new Set(comets)).toEqual(expected);
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

// =============================================================================
// Phase 30 — Plan 30-01: Lido SOT (T-LIDO-SPENDER-DRIFT-1 cross-view)
// =============================================================================
//
// T-LIDO-SPENDER-DRIFT-1: `KNOWN_SPENDERS_ETHEREUM` Lido rows must be
// byte-identical to the `getLido*Address(1)` SOT getter outputs. Drift between
// the two views means `prepare_token_approve` UX labels diverge from the actual
// addresses `prepare_lido_wrap` / `prepare_lido_unstake` route to — a subtle
// security hole where the user approves one address but the tx targets another.
//
// Addresses verified at research time (2026-05-23) against docs.lido.fi +
// lidofinance/core GitHub (research § Topic 1 + Topic 5).

describe("src/config/contracts.ts — Lido SOT (Phase 30 Plan 30-01)", () => {
  // T-LIDO-SPENDER-DRIFT-1a: wstETH row ↔ getLidoWstethAddress(1)
  it("T-LIDO-SPENDER-DRIFT-1a — KNOWN_SPENDERS_ETHEREUM 'Lido wstETH (for stETH wrap)' row ↔ getLidoWstethAddress(1) byte-identical", () => {
    const row = KNOWN_SPENDERS_ETHEREUM.find((r) => r.label === "Lido wstETH (for stETH wrap)");
    expect(row).toBeDefined();
    expect(row?.address).toBe(getLidoWstethAddress(1));
  });

  // T-LIDO-SPENDER-DRIFT-1b: WithdrawalQueue row ↔ getLidoWithdrawalQueueAddress(1)
  it("T-LIDO-SPENDER-DRIFT-1b — KNOWN_SPENDERS_ETHEREUM 'Lido WithdrawalQueueERC721 (for stETH unstake)' row ↔ getLidoWithdrawalQueueAddress(1) byte-identical", () => {
    const row = KNOWN_SPENDERS_ETHEREUM.find((r) => r.label === "Lido WithdrawalQueueERC721 (for stETH unstake)");
    expect(row).toBeDefined();
    expect(row?.address).toBe(getLidoWithdrawalQueueAddress(1));
  });

  // Ethereum literal anchors — byte-identity to research § Topic 1 verified addresses
  it("getLidoStethAddress(1) === verified stETH proxy literal (0xae7ab965...)", () => {
    expect(getLidoStethAddress(1)).toBe(getAddress("0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84"));
  });

  it("getLidoWstethAddress(1) === verified wstETH literal (0x7f39C581...)", () => {
    expect(getLidoWstethAddress(1)).toBe(getAddress("0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0"));
  });

  it("getLidoWithdrawalQueueAddress(1) === verified WithdrawalQueueERC721 literal (0x889edC2e...)", () => {
    expect(getLidoWithdrawalQueueAddress(1)).toBe(getAddress("0x889edC2eDab5f40e902b864aD4d7AdE8E412F9B1"));
  });

  // Arbitrum bridged wstETH literal anchor (research § Topic 5)
  it("getLidoWstethAddress(42161) === verified Arbitrum bridged wstETH (0x5979D7b5...)", () => {
    expect(getLidoWstethAddress(42161)).toBe(getAddress("0x5979D7b546E38E414F7E9822514be443A4800529"));
  });

  // Arbitrum sentinel documentation — address(0) for stETH + WithdrawalQueue
  it("getLidoWithdrawalQueueAddress(42161) returns address(0) sentinel (N/A on Arbitrum — dispatch filter removes it)", () => {
    // The Arbitrum slot carries address(0) for withdrawalQueue — it's a sentinel,
    // NOT a real WithdrawalQueue. The canonical-dispatch filter removes address(0)
    // entries from the Arbitrum allowlist arm automatically (D-10).
    const addr = getLidoWithdrawalQueueAddress(42161);
    expect(addr).toBe(getAddress("0x0000000000000000000000000000000000000000"));
  });

  // chainId pruning — non-Ethereum, non-Arbitrum chains return null
  it("getLidoStethAddress(137) returns null (Polygon not in LIDO_RAW)", () => {
    expect(getLidoStethAddress(137)).toBeNull();
  });

  it("getLidoStethAddress(8453) returns null (Base not in LIDO_RAW)", () => {
    expect(getLidoStethAddress(8453)).toBeNull();
  });

  it("getLidoStethAddress(10) returns null (Optimism not in LIDO_RAW)", () => {
    expect(getLidoStethAddress(10)).toBeNull();
  });

  // EIP-55 checksum guard — all Ethereum getters return checksummed addresses
  it("all getLido*Address(1) results are EIP-55 checksummed (corrupted-snapshot guard)", () => {
    const steth = getLidoStethAddress(1);
    const wsteth = getLidoWstethAddress(1);
    const wq = getLidoWithdrawalQueueAddress(1);
    expect(steth).not.toBeNull();
    expect(wsteth).not.toBeNull();
    expect(wq).not.toBeNull();
    expect(steth).toBe(getAddress(steth!));
    expect(wsteth).toBe(getAddress(wsteth!));
    expect(wq).toBe(getAddress(wq!));
  });

  // Additive row anchor — KNOWN_SPENDERS_ETHEREUM now has 2 more rows than the
  // Phase 29 baseline. No existing rows should be shifted.
  it("KNOWN_SPENDERS_ETHEREUM has exactly 2 Lido rows (no accidental duplication)", () => {
    const lidoRows = KNOWN_SPENDERS_ETHEREUM.filter((r) => r.label.startsWith("Lido "));
    expect(lidoRows.length).toBe(2);
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

// =============================================================================
// Phase 31 — Plan 31-01: EigenLayer SOT (T-EIGENLAYER-SPENDER-DRIFT-1)
// =============================================================================
//
// T-EIGENLAYER-SPENDER-DRIFT-1: KNOWN_SPENDERS_ETHEREUM "EigenLayer StrategyManager"
// row must be byte-identical to getEigenLayerStrategyManagerAddress(1). Drift means
// prepare_token_approve UX labels diverge from the address prepare_eigenlayer_deposit
// routes to — silent security hole.
//
// Addresses verified at planner-gate (2026-05-23) — see
// .planning/phases/31-evm-eigenlayer-rocket-pool/31-01-PLANNER-GATE-VERIFICATION.md
// for the audit trail (A1 / A2 / A4 RESOLVED).

describe("src/config/contracts.ts — EigenLayer SOT (Phase 31 Plan 31-01)", () => {
  // T-EIGENLAYER-SPENDER-DRIFT-1: StrategyManager row ↔ getter cross-view byte-identity.
  it("T-EIGENLAYER-SPENDER-DRIFT-1 — KNOWN_SPENDERS_ETHEREUM 'EigenLayer StrategyManager' row ↔ getEigenLayerStrategyManagerAddress(1) byte-identical", () => {
    const row = KNOWN_SPENDERS_ETHEREUM.find((r) => r.label === "EigenLayer StrategyManager");
    expect(row).toBeDefined();
    expect(row?.address).toBe(getEigenLayerStrategyManagerAddress(1));
  });

  // Ethereum literal anchors — StrategyManager + DelegationManager (research § Topic 1).
  it("getEigenLayerStrategyManagerAddress(1) === verified StrategyManager literal (0x85864637...)", () => {
    expect(getEigenLayerStrategyManagerAddress(1)).toBe(
      getAddress("0x858646372CC42E1A627fcE94aa7A7033e7CF075A"),
    );
  });

  it("getEigenLayerDelegationManagerAddress(1) === verified DelegationManager literal (0x39053D51...)", () => {
    expect(getEigenLayerDelegationManagerAddress(1)).toBe(
      getAddress("0x39053D51B77DC0d36036Fc1fCc8Cb819df8Ef37A"),
    );
  });

  // Per-strategy literal anchors (7 entries — research § Topic 1 + eigenlayer-contracts manifest).
  it("getEigenLayerStrategyAddress(1, 'stETH') === verified stETH-Strategy literal", () => {
    expect(getEigenLayerStrategyAddress(1, "stETH")).toBe(
      getAddress("0x93c4b944D05dfe6df7645A86cd2206016c51564D"),
    );
  });

  it("getEigenLayerStrategyAddress(1, 'rETH') === verified rETH-Strategy literal", () => {
    expect(getEigenLayerStrategyAddress(1, "rETH")).toBe(
      getAddress("0x1BeE69b7dFFfA4E2d53C2a2Df135C388AD25dCD2"),
    );
  });

  it("getEigenLayerStrategyAddress(1, 'cbETH') === verified cbETH-Strategy literal", () => {
    expect(getEigenLayerStrategyAddress(1, "cbETH")).toBe(
      getAddress("0x54945180dB7943c0ed0FEE7EdaB2Bd24620256bc"),
    );
  });

  it("getEigenLayerStrategyAddress(1, 'ETHx') === verified ETHx-Strategy literal", () => {
    expect(getEigenLayerStrategyAddress(1, "ETHx")).toBe(
      getAddress("0x9d7eD45EE2E8FC5482fa2428f15C971e6369011d"),
    );
  });

  it("getEigenLayerStrategyAddress(1, 'wBETH') === verified wBETH-Strategy literal", () => {
    expect(getEigenLayerStrategyAddress(1, "wBETH")).toBe(
      getAddress("0x7CA911E83dabf90C90dD3De5411a10F1A6112184"),
    );
  });

  it("getEigenLayerStrategyAddress(1, 'sfrxETH') === verified sfrxETH-Strategy literal", () => {
    expect(getEigenLayerStrategyAddress(1, "sfrxETH")).toBe(
      getAddress("0x8CA7A5d6f3acd3A7A8bC468a8CD0FB14B6BD28b6"),
    );
  });

  it("getEigenLayerStrategyAddress(1, 'mETH') === verified mETH-Strategy literal", () => {
    expect(getEigenLayerStrategyAddress(1, "mETH")).toBe(
      getAddress("0x298aFB19A105D59E74658C4C334Ff360BadE6dd2"),
    );
  });

  // Per-LST underlying-token assertions (7 entries; stETH + rETH are cross-SOT byte-identity anchors).
  it("getEigenLayerLstTokenAddress(1, 'stETH') === getLidoStethAddress(1) (cross-SOT byte-identity vs Phase 30 Lido SOT)", () => {
    expect(getEigenLayerLstTokenAddress(1, "stETH")).toBe(getLidoStethAddress(1));
  });

  it("getEigenLayerLstTokenAddress(1, 'rETH') === getRocketPoolRethAddress(1) (cross-SOT byte-identity vs Phase 31 Rocket Pool SOT)", () => {
    expect(getEigenLayerLstTokenAddress(1, "rETH")).toBe(getRocketPoolRethAddress(1));
  });

  it("getEigenLayerLstTokenAddress(1, 'cbETH') === verified cbETH literal (planner-gate A2 PASS)", () => {
    expect(getEigenLayerLstTokenAddress(1, "cbETH")).toBe(
      getAddress("0xBe9895146f7AF43049ca1c1AE358B0541Ea49704"),
    );
  });

  it("getEigenLayerLstTokenAddress(1, 'ETHx') === verified ETHx literal (planner-gate A2 PASS)", () => {
    expect(getEigenLayerLstTokenAddress(1, "ETHx")).toBe(
      getAddress("0xA35b1B31Ce002FBF2058D22F30f95D405200A15b"),
    );
  });

  it("getEigenLayerLstTokenAddress(1, 'wBETH') === verified wBETH literal (planner-gate A2 PASS)", () => {
    expect(getEigenLayerLstTokenAddress(1, "wBETH")).toBe(
      getAddress("0xa2E3356610840701BDf5611a53974510Ae27E2e1"),
    );
  });

  it("getEigenLayerLstTokenAddress(1, 'sfrxETH') === verified sfrxETH literal (planner-gate A2 PASS)", () => {
    expect(getEigenLayerLstTokenAddress(1, "sfrxETH")).toBe(
      getAddress("0xac3E018457B222d93114458476f3E3416Abbe38F"),
    );
  });

  it("getEigenLayerLstTokenAddress(1, 'mETH') === verified mETH literal (planner-gate A2 PASS)", () => {
    expect(getEigenLayerLstTokenAddress(1, "mETH")).toBe(
      getAddress("0xd5F7838F5C461fefF7FE49ea5ebaF7728bB0ADfa"),
    );
  });

  // Fan-out helper coverage.
  it("getAllEigenLayerStrategiesForChain(1) returns 7 rows (curated D-04 registry)", () => {
    const rows = getAllEigenLayerStrategiesForChain(1);
    expect(rows.length).toBe(7);
    const lsts = rows.map((r) => r.lst).sort();
    expect(lsts).toEqual(
      ["ETHx", "cbETH", "mETH", "rETH", "sfrxETH", "stETH", "wBETH"].sort(),
    );
    // Each row carries non-null strategy + lstToken.
    for (const row of rows) {
      expect(row.strategy).toMatch(/^0x[0-9a-fA-F]{40}$/);
      expect(row.lstToken).toMatch(/^0x[0-9a-fA-F]{40}$/);
    }
  });

  // chainId pruning — Phase 31 is Ethereum-only (D-03).
  it("getAllEigenLayerStrategiesForChain returns [] on non-Ethereum chains (D-03 Ethereum-only)", () => {
    const otherChains: readonly ChainId[] = [42161, 137, 8453, 10];
    for (const chainId of otherChains) {
      expect(getAllEigenLayerStrategiesForChain(chainId)).toEqual([]);
    }
  });

  it("getEigenLayerStrategyManagerAddress + getEigenLayerDelegationManagerAddress return null on non-Ethereum chains", () => {
    const otherChains: readonly ChainId[] = [42161, 137, 8453, 10];
    for (const chainId of otherChains) {
      expect(getEigenLayerStrategyManagerAddress(chainId)).toBeNull();
      expect(getEigenLayerDelegationManagerAddress(chainId)).toBeNull();
    }
  });

  it("getEigenLayerStrategyAddress + getEigenLayerLstTokenAddress return null on non-Ethereum chains", () => {
    const otherChains: readonly ChainId[] = [42161, 137, 8453, 10];
    const lsts: EigenLayerLst[] = ["stETH", "rETH", "cbETH", "ETHx", "wBETH", "sfrxETH", "mETH"];
    for (const chainId of otherChains) {
      for (const lst of lsts) {
        expect(getEigenLayerStrategyAddress(chainId, lst)).toBeNull();
        expect(getEigenLayerLstTokenAddress(chainId, lst)).toBeNull();
      }
    }
  });

  // EIP-55 round-trip — corrupted-snapshot guard fires at module load.
  it("all EigenLayer Ethereum getters return EIP-55 checksummed addresses", () => {
    const sm = getEigenLayerStrategyManagerAddress(1);
    const dm = getEigenLayerDelegationManagerAddress(1);
    expect(sm).not.toBeNull();
    expect(dm).not.toBeNull();
    expect(sm).toBe(getAddress(sm!));
    expect(dm).toBe(getAddress(dm!));
    for (const { strategy, lstToken } of getAllEigenLayerStrategiesForChain(1)) {
      expect(strategy).toBe(getAddress(strategy));
      expect(lstToken).toBe(getAddress(lstToken));
    }
  });
});

// =============================================================================
// Phase 31 — Plan 31-01: Rocket Pool SOT (T-ROCKETPOOL-SPENDER-DRIFT-1)
// =============================================================================
//
// T-ROCKETPOOL-SPENDER-DRIFT-1a: KNOWN_SPENDERS_ETHEREUM "Rocket Pool RocketDepositPool"
// row must be byte-identical to getRocketPoolDepositPoolAddress(1).
// T-ROCKETPOOL-SPENDER-DRIFT-1b: KNOWN_SPENDERS_ETHEREUM "Rocket Pool rETH token (burn target)"
// row must be byte-identical to getRocketPoolRethAddress(1).
//
// The settingsDeposit address was resolved at planner-gate 2026-05-23 via
// RocketStorage.getAddress(keccak256("contract.address", "rocketDAOProtocolSettingsDeposit"));
// see 31-01-PLANNER-GATE-VERIFICATION.md (A1 RESOLVED).

describe("src/config/contracts.ts — Rocket Pool SOT (Phase 31 Plan 31-01)", () => {
  // T-ROCKETPOOL-SPENDER-DRIFT-1a: depositPool row ↔ getter cross-view byte-identity.
  it("T-ROCKETPOOL-SPENDER-DRIFT-1a — KNOWN_SPENDERS_ETHEREUM 'Rocket Pool RocketDepositPool' row ↔ getRocketPoolDepositPoolAddress(1) byte-identical", () => {
    const row = KNOWN_SPENDERS_ETHEREUM.find(
      (r) => r.label === "Rocket Pool RocketDepositPool (stake — value-bearing)",
    );
    expect(row).toBeDefined();
    expect(row?.address).toBe(getRocketPoolDepositPoolAddress(1));
  });

  // T-ROCKETPOOL-SPENDER-DRIFT-1b: rETH row ↔ getter cross-view byte-identity.
  it("T-ROCKETPOOL-SPENDER-DRIFT-1b — KNOWN_SPENDERS_ETHEREUM 'Rocket Pool rETH token (burn target)' row ↔ getRocketPoolRethAddress(1) byte-identical", () => {
    const row = KNOWN_SPENDERS_ETHEREUM.find(
      (r) => r.label === "Rocket Pool rETH token (burn target)",
    );
    expect(row).toBeDefined();
    expect(row?.address).toBe(getRocketPoolRethAddress(1));
  });

  // Ethereum literal anchors.
  it("getRocketPoolDepositPoolAddress(1) === verified RocketDepositPool v1.2 literal (0xDD3f50F8...)", () => {
    expect(getRocketPoolDepositPoolAddress(1)).toBe(
      getAddress("0xDD3f50F8A6CafbE9b31a427582963f465E745AF8"),
    );
  });

  it("getRocketPoolRethAddress(1) === verified rETH literal (0xae78736C...)", () => {
    expect(getRocketPoolRethAddress(1)).toBe(
      getAddress("0xae78736Cd615f374D3085123A210448E74Fc6393"),
    );
  });

  // settingsDeposit — verified at planner-gate (A1 RESOLVED).
  it("getRocketPoolDepositSettingsAddress(1) === planner-gate-resolved RocketDAOProtocolSettingsDeposit literal (A1 RESOLVED 2026-05-23)", () => {
    const settings = getRocketPoolDepositSettingsAddress(1);
    expect(settings).not.toBeNull();
    expect(settings).toBe(getAddress("0x227BE8dD01DF8ad9BED0178e4F8cEC2996C5c365"));
  });

  // D-07 resilience constant.
  it("ROCKET_POOL_MINIMUM_DEPOSIT_FALLBACK_WEI === 1e16 wei (0.01 ETH; D-07 anchor)", () => {
    expect(ROCKET_POOL_MINIMUM_DEPOSIT_FALLBACK_WEI).toBe(10_000_000_000_000_000n);
  });

  // chainId pruning — Phase 31 is Ethereum-only (D-03).
  it("all 3 Rocket Pool getters return null on non-Ethereum chains (D-03)", () => {
    const otherChains: readonly ChainId[] = [42161, 137, 8453, 10];
    for (const chainId of otherChains) {
      expect(getRocketPoolDepositPoolAddress(chainId)).toBeNull();
      expect(getRocketPoolRethAddress(chainId)).toBeNull();
      expect(getRocketPoolDepositSettingsAddress(chainId)).toBeNull();
    }
  });

  // EIP-55 round-trip — corrupted-snapshot guard.
  it("all Rocket Pool Ethereum getters return EIP-55 checksummed addresses", () => {
    const dp = getRocketPoolDepositPoolAddress(1);
    const reth = getRocketPoolRethAddress(1);
    const settings = getRocketPoolDepositSettingsAddress(1);
    expect(dp).not.toBeNull();
    expect(reth).not.toBeNull();
    expect(settings).not.toBeNull();
    expect(dp).toBe(getAddress(dp!));
    expect(reth).toBe(getAddress(reth!));
    expect(settings).toBe(getAddress(settings!));
  });

  // KNOWN_SPENDERS_ETHEREUM additive count anchor — Phase 31 adds exactly 3 new rows.
  it("KNOWN_SPENDERS_ETHEREUM has exactly 1 EigenLayer + 2 Rocket Pool rows (no accidental duplication)", () => {
    const eigenRows = KNOWN_SPENDERS_ETHEREUM.filter((r) => r.label.startsWith("EigenLayer "));
    const rocketRows = KNOWN_SPENDERS_ETHEREUM.filter((r) => r.label.startsWith("Rocket Pool "));
    expect(eigenRows.length).toBe(1);
    expect(rocketRows.length).toBe(2);
  });
});

// =============================================================================
// Phase 32 — Plan 32-01: Uniswap V3 SOT (T-UNISWAP-V3-SPENDER-DRIFT-1)
// =============================================================================
//
// T-UNISWAP-V3-SPENDER-DRIFT-1: KNOWN_SPENDERS_ETHEREUM "Uniswap V3 SwapRouter02"
// row must be byte-identical to getUniswapV3SwapRouter02Address(1). The row was
// promoted from an inline literal at Phase 6 (lines 864-868) to a SOT-getter
// delegate at Phase 32 per D-13a — this drift-test enforces the cross-view
// byte-identity that prevents the two sources from silently diverging.
//
// Quoter V2 is intentionally NOT in KNOWN_SPENDERS_ETHEREUM (read-only contract
// per D-13a; spender labels are for approval-target UX, not read-only callees).
// NonfungiblePositionManager is pre-populated in UNISWAP_V3_RAW per D-01 but
// Phase 32 does not consume it; Phase 33 LP verbs read the existing SOT slot.

describe("src/config/contracts.ts — Uniswap V3 SOT (Phase 32 Plan 32-01)", () => {
  // T-UNISWAP-V3-SPENDER-DRIFT-1: SwapRouter02 row ↔ getter cross-view byte-identity.
  it("T-UNISWAP-V3-SPENDER-DRIFT-1 — KNOWN_SPENDERS_ETHEREUM 'Uniswap V3 SwapRouter02' row address matches getUniswapV3SwapRouter02Address(1)", () => {
    // 3-assertion regression block mirroring Phase 31 T-EIGENLAYER-SPENDER-DRIFT-1:
    // (1) SOT getter non-null on chainId=1.
    const sotAddr = getUniswapV3SwapRouter02Address(1);
    expect(sotAddr).not.toBeNull();
    // (2) The KNOWN_SPENDERS row's address equals the SOT getter return.
    const row = KNOWN_SPENDERS_ETHEREUM.find(
      (r) => r.label === "Uniswap V3 SwapRouter02",
    );
    expect(row).toBeDefined();
    expect(row?.address).toBe(sotAddr);
    // (3) Defense-in-depth — SOT getter returns the verified canonical literal.
    expect(sotAddr).toBe(getAddress("0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45"));
  });

  it("Ethereum literal anchor — getUniswapV3QuoterV2Address(1) === verified Quoter V2 literal (0x61fFE014...)", () => {
    expect(getUniswapV3QuoterV2Address(1)).toBe(
      getAddress("0x61fFE014bA17989E743c5F6cB21bF9697530B21e"),
    );
  });

  it("Ethereum literal anchor — getUniswapV3NonfungiblePositionManagerAddress(1) === verified NPM literal (0xC36442b4...)", () => {
    // RESERVED for Phase 33 LP verbs per D-01; pre-populated at Phase 32 so
    // Phase 33 reads the existing slot without re-extending the SOT.
    expect(getUniswapV3NonfungiblePositionManagerAddress(1)).toBe(
      getAddress("0xC36442b4a4522E871399CD717aBDD847Ab11FE88"),
    );
  });

  // chainId pruning — Phase 32 is Ethereum-only (D-03).
  it("all 3 Uniswap V3 getters return null on non-Ethereum chains (D-03)", () => {
    const otherChains: readonly ChainId[] = [42161, 137, 8453, 10];
    for (const chainId of otherChains) {
      expect(getUniswapV3SwapRouter02Address(chainId)).toBeNull();
      expect(getUniswapV3QuoterV2Address(chainId)).toBeNull();
      expect(getUniswapV3NonfungiblePositionManagerAddress(chainId)).toBeNull();
    }
  });

  // EIP-55 round-trip — corrupted-snapshot guard.
  it("all Uniswap V3 Ethereum getters return EIP-55 checksummed addresses", () => {
    const sr = getUniswapV3SwapRouter02Address(1);
    const qv2 = getUniswapV3QuoterV2Address(1);
    const npm = getUniswapV3NonfungiblePositionManagerAddress(1);
    expect(sr).not.toBeNull();
    expect(qv2).not.toBeNull();
    expect(npm).not.toBeNull();
    expect(sr).toBe(getAddress(sr!));
    expect(qv2).toBe(getAddress(qv2!));
    expect(npm).toBe(getAddress(npm!));
  });

  // KNOWN_SPENDERS row position preserved — D-13a promotion is IN-PLACE EDIT,
  // not a delete+re-add. The row's array index stays at 21 (matches pre-Phase-32
  // position recorded at planning time; drift here means the row was reordered
  // and the surrounding KNOWN_SPENDERS entries shifted unexpectedly).
  it("KNOWN_SPENDERS row position preserved — 'Uniswap V3 SwapRouter02' at index 21", () => {
    const idx = KNOWN_SPENDERS_ETHEREUM.findIndex(
      (r) => r.label === "Uniswap V3 SwapRouter02",
    );
    expect(idx).toBe(21);
  });

  // Quoter V2 NOT in KNOWN_SPENDERS_ETHEREUM (read-only contract per D-13a).
  it("KNOWN_SPENDERS_ETHEREUM does NOT include Quoter V2 (read-only per D-13a)", () => {
    const qv2 = getUniswapV3QuoterV2Address(1)!;
    const row = KNOWN_SPENDERS_ETHEREUM.find((r) => r.address === qv2);
    expect(row).toBeUndefined();
  });
});

// =============================================================================
// Phase 33 — Plan 33-01: NonfungiblePositionManager promoted to KNOWN_SPENDERS.
// =============================================================================
//
// T-UNISWAP-V3-NPM-SPENDER-DRIFT-1: KNOWN_SPENDERS_ETHEREUM "Uniswap V3
// NonfungiblePositionManager" row must be byte-identical to
// getUniswapV3NonfungiblePositionManagerAddress(1). NPM is a spender for
// mint / increaseLiquidity (internal TransferHelper.safeTransferFrom on BOTH
// token0 AND token1 — RESEARCH § Topic 8 CONFIRMED). The SOT slot was
// pre-populated at Phase 32 D-01; Phase 33 only adds the consumer row in
// KNOWN_SPENDERS — this drift-test enforces the cross-view byte-identity that
// prevents the two sources from silently diverging.

describe("src/config/contracts.ts — Phase 33 Uniswap V3 NPM KNOWN_SPENDERS promotion", () => {
  // T-UNISWAP-V3-NPM-SPENDER-DRIFT-1: NPM row ↔ getter cross-view byte-identity.
  it("T-UNISWAP-V3-NPM-SPENDER-DRIFT-1 — KNOWN_SPENDERS_ETHEREUM 'Uniswap V3 NonfungiblePositionManager' row address matches getUniswapV3NonfungiblePositionManagerAddress(1)", () => {
    // 3-assertion regression block mirroring Phase 32 T-UNISWAP-V3-SPENDER-DRIFT-1:
    // (1) SOT getter non-null on chainId=1.
    const sotAddr = getUniswapV3NonfungiblePositionManagerAddress(1);
    expect(sotAddr).not.toBeNull();
    // (2) The KNOWN_SPENDERS row's address equals the SOT getter return.
    const row = KNOWN_SPENDERS_ETHEREUM.find(
      (r) => r.label === "Uniswap V3 NonfungiblePositionManager",
    );
    expect(row).toBeDefined();
    expect(row?.address).toBe(sotAddr);
    // (3) Defense-in-depth — SOT getter returns the verified canonical literal.
    expect(sotAddr).toBe(getAddress("0xC36442b4a4522E871399CD717aBDD847Ab11FE88"));
  });

  // Insertion order: alphabetical-by-label — NPM row sits AFTER SwapRouter02,
  // BEFORE WETH9. Drift here means the row was inserted at the wrong position.
  it("KNOWN_SPENDERS row position — 'Uniswap V3 NonfungiblePositionManager' sits between SwapRouter02 and WETH9", () => {
    const npmIdx = KNOWN_SPENDERS_ETHEREUM.findIndex(
      (r) => r.label === "Uniswap V3 NonfungiblePositionManager",
    );
    const swapRouter02Idx = KNOWN_SPENDERS_ETHEREUM.findIndex(
      (r) => r.label === "Uniswap V3 SwapRouter02",
    );
    const wethIdx = KNOWN_SPENDERS_ETHEREUM.findIndex(
      (r) => r.label === "WETH9 (canonical wETH)",
    );
    expect(npmIdx).toBeGreaterThan(-1);
    expect(swapRouter02Idx).toBeGreaterThan(-1);
    expect(wethIdx).toBeGreaterThan(-1);
    expect(npmIdx).toBe(swapRouter02Idx + 1);
    expect(npmIdx).toBe(wethIdx - 1);
  });

  // EIP-55 round-trip — corrupted-snapshot guard.
  it("NPM KNOWN_SPENDERS row address is EIP-55 checksummed", () => {
    const row = KNOWN_SPENDERS_ETHEREUM.find(
      (r) => r.label === "Uniswap V3 NonfungiblePositionManager",
    );
    expect(row).toBeDefined();
    expect(row!.address).toBe(getAddress(row!.address));
  });
});

// =============================================================================
// Phase 34 — Plan 34-01: Curve pool registry + KNOWN_SPENDERS promotion
// =============================================================================
//
// T-CURVE-SPENDER-DRIFT-1: every entry in getAllCurvePoolsForChain(1) must have
// exactly one matching KNOWN_SPENDERS_ETHEREUM row with the same address AND
// label starting with "Curve ". Promotion is done via SOT-getter loop — manual
// rows cannot drift.
//
// T-CURVE-REGISTRY-INTEGRITY-1: exact 11-entry count + abiVersion split +
// stable_ng lpToken === pool invariant.
//
// T-CURVE-REGISTRY-DECIMALS-1: for each pool, each coinDecimals[idx] matches
// the hardcoded registry literal (purely literal-vs-literal, no RPC needed).

describe("src/config/contracts.ts — Phase 34 Curve pool registry (T-CURVE-REGISTRY-INTEGRITY-1)", () => {
  it("getAllCurvePoolsForChain(1) returns exactly 11 entries", () => {
    expect(getAllCurvePoolsForChain(1).length).toBe(11);
  });

  it("T-CURVE-REGISTRY-INTEGRITY-1a — exactly 1 entry has abiVersion='legacy'", () => {
    const legacy = getAllCurvePoolsForChain(1).filter((p) => p.abiVersion === "legacy");
    expect(legacy.length).toBe(1);
    expect(legacy[0].address).toBe(getAddress("0xDC24316b9AE028F1497c275EB9192a3Ea0f67022"));
  });

  it("T-CURVE-REGISTRY-INTEGRITY-1b — exactly 10 entries have abiVersion='stable_ng'", () => {
    const stableNg = getAllCurvePoolsForChain(1).filter((p) => p.abiVersion === "stable_ng");
    expect(stableNg.length).toBe(10);
  });

  it("T-CURVE-REGISTRY-INTEGRITY-1c — for every stable_ng entry, lpToken === pool.address", () => {
    const stableNg = getAllCurvePoolsForChain(1).filter((p) => p.abiVersion === "stable_ng");
    for (const entry of stableNg) {
      expect(entry.lpToken).toBe(entry.address);
    }
  });

  it("T-CURVE-REGISTRY-INTEGRITY-1d — legacy stETH/ETH pool has distinct lpToken", () => {
    const legacy = getAllCurvePoolsForChain(1).find((p) => p.abiVersion === "legacy");
    expect(legacy).toBeDefined();
    expect(legacy!.lpToken).toBe(getAddress("0x06325440D014e39736583c165C2963BA99fAf14E"));
    expect(legacy!.lpToken).not.toBe(legacy!.address);
  });

  it("getAllCurvePoolsForChain(42161) returns [] (Curve is Ethereum-only at Phase 34)", () => {
    expect(getAllCurvePoolsForChain(42161)).toEqual([]);
  });

  it("getCurvePoolByAddress case-insensitive lookup — Spark.fi PYUSD Reserve", () => {
    const entry = getCurvePoolByAddress(1, "0xa632d59b9b804a956bfaa9b48af3a1b74808fc1f" as Address);
    expect(entry).toBeDefined();
    expect(entry!.displayName).toBe("PYUSD/USDS (stable_ng)");
  });

  it("getCurvePoolByAddress returns undefined for unknown pool", () => {
    expect(getCurvePoolByAddress(1, getAddress("0x0000000000000000000000000000000000000001"))).toBeUndefined();
  });
});

describe("src/config/contracts.ts — Phase 34 Curve registry decimals (T-CURVE-REGISTRY-DECIMALS-1)", () => {
  // Hardcoded-table cross-check: registry coinDecimals vs the expected values
  // from the RESEARCH.md registry snapshot (no RPC needed — purely literal-vs-literal).

  const EXPECTED_DECIMALS: Array<{ address: string; coinDecimals: number[] }> = [
    // LEGACY
    { address: "0xDC24316b9AE028F1497c275EB9192a3Ea0f67022", coinDecimals: [18, 18] },
    // STABLE_NG 1 — Spark.fi PYUSD Reserve
    { address: "0xA632D59b9B804a956BfaA9b48Af3A1b74808FC1f", coinDecimals: [6, 18] },
    // STABLE_NG 2 — RLUSD/USDC
    { address: "0xD001aE433f254283FeCE51d4ACcE8c53263aa186", coinDecimals: [6, 18] },
    // STABLE_NG 3 — OETH/WETH
    { address: "0xcc7d5785AD5755B6164e21495E07aDb0Ff11C2A8", coinDecimals: [18, 18] },
    // STABLE_NG 4 — DOLA/sUSDe
    { address: "0x744793B5110f6ca9cC7CDfe1CE16677c3Eb192ef", coinDecimals: [18, 18] },
    // STABLE_NG 5 — FRAXUSDe
    { address: "0x5dc1BF6f1e983C0b21EfB003c105133736fA0743", coinDecimals: [18, 18] },
    // STABLE_NG 6 — PayPool (PYUSD/USDC)
    { address: "0x383E6b4437b59fff47B619CBA855CA29342A8559", coinDecimals: [6, 6] },
    // STABLE_NG 7 — Spark.fi USDT Reserve
    { address: "0x00836Fe54625BE242BcFA286207795405ca4fD10", coinDecimals: [18, 6] },
    // STABLE_NG 8 — apxUSD-USDC
    { address: "0xE1B96555BbecA40E583BbB41a11C68Ca4706A414", coinDecimals: [18, 6] },
    // STABLE_NG 9 — AUSD/USDC
    { address: "0xE79C1C7E24755574438A26D5e062Ad2626C04662", coinDecimals: [6, 6] },
    // STABLE_NG 10 — crvUSD/frxUSD
    { address: "0x13e12BB0E6A2f1A3d6901a59a9d585e89A6243e1", coinDecimals: [18, 18] },
  ];

  it("T-CURVE-REGISTRY-DECIMALS-1 — coinDecimals matches hardcoded table for all 11 pools", () => {
    const pools = getAllCurvePoolsForChain(1);
    for (const expected of EXPECTED_DECIMALS) {
      const pool = getCurvePoolByAddress(1, expected.address as Address);
      expect(pool, `pool not found: ${expected.address}`).toBeDefined();
      expect(pool!.coinDecimals, `decimals mismatch for ${expected.address}`).toEqual(expected.coinDecimals);
    }
  });
});

describe("src/config/contracts.ts — Phase 34 Curve KNOWN_SPENDERS promotion (T-CURVE-SPENDER-DRIFT-1)", () => {
  it("T-CURVE-SPENDER-DRIFT-1 — every Curve pool has exactly one KNOWN_SPENDERS_ETHEREUM row with matching address and 'Curve ' label prefix", () => {
    const curvePools = getAllCurvePoolsForChain(1);
    for (const pool of curvePools) {
      const matches = KNOWN_SPENDERS_ETHEREUM.filter(
        (s) => s.address === pool.address && s.label.startsWith("Curve "),
      );
      expect(
        matches.length,
        `Expected exactly 1 Curve KNOWN_SPENDERS row for pool ${pool.address} (${pool.displayName}), got ${matches.length}`,
      ).toBe(1);
    }
  });

  it("T-CURVE-SPENDER-DRIFT-1b — Curve KNOWN_SPENDERS label matches 'Curve {displayName}'", () => {
    const curvePools = getAllCurvePoolsForChain(1);
    for (const pool of curvePools) {
      const row = KNOWN_SPENDERS_ETHEREUM.find((s) => s.address === pool.address && s.label.startsWith("Curve "));
      expect(row).toBeDefined();
      expect(row!.label).toBe(`Curve ${pool.displayName}`);
    }
  });

  it("T-CURVE-SPENDER-DRIFT-1c — Curve KNOWN_SPENDERS source is 'https://curve.finance' for all rows", () => {
    const curvePools = getAllCurvePoolsForChain(1);
    for (const pool of curvePools) {
      const row = KNOWN_SPENDERS_ETHEREUM.find((s) => s.address === pool.address && s.label.startsWith("Curve "));
      expect(row!.source).toBe("https://curve.finance");
    }
  });
});

// =============================================================================
// Phase 36 — Plan 36-01: SafeContracts SOT
// =============================================================================
//
// Coverage:
//   - Test 1: shape — getSafeSingletonAddresses returns 4-length Address[]
//             for each supported chain
//   - Test 2: all 5 supported chains populated
//   - Test 3: T-SAFE-CANONICAL-ACROSS-EIP155 — same address set per chain
//   - Test 4: every Safe contract literal is EIP-55 checksummed (corrupted-
//             snapshot guard via getAddress at literal site)
//   - Test 5: spot-check the 4 mainnet singleton variants against the
//             RESEARCH § lines 870-886 literals (regression anchor)
//   - Test 6: getSafeSingletonAddresses(1) returns exactly the 4 expected
//             variants
//   - Test 7: getSafeSingletonAddresses for unconfigured chain returns []
//   - Test 8: per-role getters return Address[] (2 entries each)
//   - Test 9: the 4 singletons within a chain are DISTINCT (Set of 4)

const SAFE_CHAIN_IDS: readonly ChainId[] = [1, 10, 137, 8453, 42161] as const;

describe("SafeContracts SOT — Phase 36 Plan 36-01", () => {
  it("Test 1 — getSafeSingletonAddresses returns Address[] of length 4 for each supported chain", () => {
    for (const chainId of SAFE_CHAIN_IDS) {
      const singletons = getSafeSingletonAddresses(chainId);
      expect(singletons.length).toBe(4);
    }
  });

  it("Test 2 — SAFE_CONTRACTS_RAW covers all 5 supported chains", () => {
    for (const chainId of SAFE_CHAIN_IDS) {
      const singletons = getSafeSingletonAddresses(chainId);
      expect(singletons.length).toBeGreaterThan(0);
      const proxyFactories = getSafeProxyFactoryAddresses(chainId);
      expect(proxyFactories.length).toBe(2);
    }
  });

  it("Test 3 — T-SAFE-CANONICAL-ACROSS-EIP155 — same address set per chain", () => {
    // safe-deployments canonical-across-eip155: every supported chain shares
    // the SAME Safe address set per role. Pairwise check across the 5 chains.
    const reference = {
      singletons: getSafeSingletonAddresses(1),
      proxyFactory: getSafeProxyFactoryAddresses(1),
      multiSend: getSafeMultiSendAddresses(1),
      multiSendCallOnly: getSafeMultiSendCallOnlyAddresses(1),
      signMessageLib: getSafeSignMessageLibAddresses(1),
      compatFallback: getSafeCompatibilityFallbackHandlerAddresses(1),
    };
    for (const chainId of SAFE_CHAIN_IDS) {
      expect(getSafeSingletonAddresses(chainId)).toEqual(reference.singletons);
      expect(getSafeProxyFactoryAddresses(chainId)).toEqual(reference.proxyFactory);
      expect(getSafeMultiSendAddresses(chainId)).toEqual(reference.multiSend);
      expect(getSafeMultiSendCallOnlyAddresses(chainId)).toEqual(reference.multiSendCallOnly);
      expect(getSafeSignMessageLibAddresses(chainId)).toEqual(reference.signMessageLib);
      expect(getSafeCompatibilityFallbackHandlerAddresses(chainId)).toEqual(reference.compatFallback);
    }
  });

  it("Test 4 — EIP-55 checksum integrity (corrupted-snapshot guard via getAddress)", () => {
    // Every address surfaced via the per-role getters round-trips through
    // getAddress unchanged. A corrupted hex literal would have already thrown
    // at module load — this is the runtime regression anchor.
    for (const chainId of SAFE_CHAIN_IDS) {
      const allAddrs = [
        ...getSafeSingletonAddresses(chainId),
        ...getSafeProxyFactoryAddresses(chainId),
        ...getSafeMultiSendAddresses(chainId),
        ...getSafeMultiSendCallOnlyAddresses(chainId),
        ...getSafeSignMessageLibAddresses(chainId),
        ...getSafeCompatibilityFallbackHandlerAddresses(chainId),
      ];
      for (const addr of allAddrs) {
        expect(addr).toBe(getAddress(addr));
      }
    }
  });

  it("Test 5 — singleton variant pins — RESEARCH § 870-886 mainnet literals", () => {
    // Regression anchor: any address drift in SAFE_CANONICAL surfaces here as
    // a value mismatch. The 4 variants on chainId=1 match the RESEARCH table
    // verbatim.
    const singletons = getSafeSingletonAddresses(1);
    expect(singletons).toEqual([
      getAddress("0xd9Db270c1B5E3Bd161E8c8503c55cEABeE709552"), // v1.3.0-L1
      getAddress("0x3E5c63644E683549055b9Be8653de26E0B4CD36E"), // v1.3.0-L2
      getAddress("0x41675C099F32341bf84BFc5382aF534df5C7461a"), // v1.4.1-L1
      getAddress("0x29fcB43b46531BcA003ddC8FCB67FFE91900C762"), // v1.4.1-L2
    ]);
  });

  it("Test 6 — getSafeSingletonAddresses(1) returns exactly the 4-variant array", () => {
    const result = getSafeSingletonAddresses(1);
    expect(result.length).toBe(4);
    // All entries pass EIP-55 round-trip (Test 4 ensures, but explicit here too).
    for (const addr of result) {
      expect(addr).toBe(getAddress(addr));
      expect(addr.length).toBe(42); // 0x + 40 hex
    }
  });

  it("Test 7 — getSafeSingletonAddresses for unconfigured chain returns []", () => {
    // Compile-time the union prevents passing 999 directly. Cast to exercise
    // the runtime null-guard inside the getter (Partial<Record> arm).
    const result = getSafeSingletonAddresses(999 as ChainId);
    expect(result).toEqual([]);
  });

  it("Test 8 — per-role getters return Address[] of length 2", () => {
    for (const chainId of SAFE_CHAIN_IDS) {
      expect(getSafeProxyFactoryAddresses(chainId).length).toBe(2);
      expect(getSafeMultiSendAddresses(chainId).length).toBe(2);
      expect(getSafeMultiSendCallOnlyAddresses(chainId).length).toBe(2);
      expect(getSafeSignMessageLibAddresses(chainId).length).toBe(2);
      expect(getSafeCompatibilityFallbackHandlerAddresses(chainId).length).toBe(2);
    }
  });

  it("Test 9 — the 4 singletons within a chain are DISTINCT addresses", () => {
    // L1 ≠ L2 within a version; v1.3.0 ≠ v1.4.1 within a layer.
    const singletons = getSafeSingletonAddresses(1);
    const uniqueSet = new Set(singletons);
    expect(uniqueSet.size).toBe(4);
  });

  it("Test 10 — per-role pairs are DISTINCT within a chain (v130 ≠ v141)", () => {
    // Each per-role pair must carry two distinct addresses (a single-address
    // pair would silently fold v1.3.0 + v1.4.1 dispatches into one allowlist
    // entry — defensible only if the deployment is intentionally shared,
    // which is NOT the case for these Safe contracts).
    for (const chainId of SAFE_CHAIN_IDS) {
      const proxyFactory = getSafeProxyFactoryAddresses(chainId);
      expect(proxyFactory[0]).not.toBe(proxyFactory[1]);
      const multiSend = getSafeMultiSendAddresses(chainId);
      expect(multiSend[0]).not.toBe(multiSend[1]);
      const multiSendCallOnly = getSafeMultiSendCallOnlyAddresses(chainId);
      expect(multiSendCallOnly[0]).not.toBe(multiSendCallOnly[1]);
    }
  });
});
