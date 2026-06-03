// src/config/contracts.ts — single source of truth for canonical contract
// addresses (project CLAUDE.md convention). Regression-tested. Never inline
// an address in a tool implementation.
//
// Phase 6 — Plan 06-03. First occupant of the SOT. Phase 6 ships ethereum-
// only entries; Phase 7 (Aave V3 Pool) and Phase 8 (multi-chain) extend.
//
// Format-fanout-sentinel: every address literal here is wrapped in
// `getAddress(...)` so a corrupted snapshot — single hex digit flipped at
// rest — throws at module load. Mirror of src/tokens/registry.ts pattern.

import { getAddress, type Address } from "viem";
import { PublicKey } from "@solana/web3.js";

/**
 * Supported chain IDs. Phase 8 Plan 08-01 widened from the v1.0/v1.1
 * single-chain literal to the 5-chain multi-EVM union. Adding a new chain
 * is a 3-step ritual: extend this literal-union, extend `ChainName` below,
 * populate the `CONTRACTS_RAW` row, extend `PUBLICNODE_RPC_URLS` /
 * `PROVIDER_TEMPLATES` / `VIEM_CHAINS` in `src/chains/registry.ts`.
 */
export type ChainId = 1 | 42161 | 137 | 8453 | 10;

/**
 * Human-readable chain slug — mirrors the `viem/chains` named-export
 * shape. The literal-union pair (ChainId ↔ ChainName) is the source of
 * truth for any agent-facing `chain` arg in Phase 8 Plan 08-02+; the
 * JSON-schema enum at the dispatch boundary mirrors this list verbatim
 * (T-CHAIN-NAME-CASE-1 mitigation lives at the schema, not the type).
 */
export type ChainName = "ethereum" | "arbitrum" | "polygon" | "base" | "optimism";

const CHAIN_ID_BY_NAME: Record<ChainName, ChainId> = {
  ethereum: 1,
  arbitrum: 42161,
  polygon: 137,
  base: 8453,
  optimism: 10,
};

const CHAIN_NAME_BY_ID: Record<ChainId, ChainName> = Object.fromEntries(
  Object.entries(CHAIN_ID_BY_NAME).map(([name, id]) => [id, name]),
) as Record<ChainId, ChainName>;

/**
 * Map a `ChainName` → numeric `ChainId`. Total + byte-deterministic on the
 * 5-entry domain. Consumed by Plan 08-02's `chain` arg threading
 * (agent passes `"arbitrum"`, server resolves to `42161` for RPC + SOT
 * lookup).
 */
export function chainIdFromName(name: ChainName): ChainId {
  return CHAIN_ID_BY_NAME[name];
}

/**
 * Inverse of `chainIdFromName`. Total + byte-deterministic. Round-trip
 * holds for all 5 ChainNames: `chainNameFromId(chainIdFromName(n)) === n`.
 */
export function chainNameFromId(id: ChainId): ChainName {
  return CHAIN_NAME_BY_ID[id];
}

/**
 * Per-chain canonical contract registry shape. Plan 06-03 shipped `weth`
 * (consumed by Plan 06-04's prepare_weth_unwrap). Plan 07-01 adds the five
 * Aave V3 typed slots (Pool + PoolAddressesProvider + UiPoolDataProviderV3
 * + AaveOracle + IncentivesController) — cross-verified addresses from
 * research § Topic 1. The TYPE of the value is what makes this SOT —
 * `getWethAddress(1)` / `getAaveV3PoolAddress(1)` are type-safe; an unknown
 * chain triggers a compile error rather than a runtime undefined.
 * Phase 8+ may add: lido, eigenLayer, ...
 */
export interface ContractsForChain {
  weth: Address;
  aavePool: Address;                    // Phase 7 Plan 07-03 — prepare_aave_supply / withdraw tx.to
  aavePoolAddressesProvider: Address;   // Phase 7 Plan 07-02 — `provider` arg to UiPoolDataProviderV3 calls
  aaveUiPoolDataProvider: Address;      // Phase 7 Plan 07-02 — get_lending_positions reader target
  aaveOracle: Address;                  // Phase 7 forward-compat — price oracle (UiPoolDataProviderV3 surfaces priceInMarketReferenceCurrency per-reserve; oracle slot seeded for v1.x-future flexibility)
  aaveIncentivesController: Address;    // Phase 7 forward-compat — rewards-claim is v2.3+ scope; seed for forward use
}

// Per-chain addresses: bgd-labs/aave-address-book/src/AaveV3{Chain}.sol HEAD
// as of 2026-05-16 — re-verify on every Phase 8 plan touch. WETH:
// chain-specific canonical wrappers from each chain's docs/predeploys (Base +
// Optimism share the OP-Stack `0x4200…0006` predeploy). Each literal is
// `getAddress`-wrapped at the literal site so a corrupted snapshot — single
// hex digit flipped at rest — throws EIP-55 at module load.
const CONTRACTS_RAW: Record<ChainId, ContractsForChain> = {
  1: {
    // Canonical mainnet WETH9. Re-checksummed at module load via
    // `getAddress` (corrupted-snapshot guard — mirror of
    // src/tokens/registry.ts). Sourced from the existing inline literal at
    // src/tools/get_portfolio_summary.ts:17; Plan 06-04 will migrate that
    // file to import `getWethAddress(1)` from here (the SOT).
    weth: getAddress("0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2"),

    // Aave V3 Ethereum addresses (Phase 7 Plan 07-01). Cross-verified
    // against `bgd-labs/aave-address-book/src/AaveV3Ethereum.sol` AND
    // Etherscan (research § Topic 1). Each address re-checksummed at module
    // load via `getAddress` (corrupted-snapshot guard).
    //
    // The Aave V3 Pool address is an `InitializableImmutableAdminUpgradeabilityProxy`
    // — the proxy is verified on Etherscan; the implementation lives at a
    // separate address. Phase 7 calls (`supply` / `withdraw` /
    // `getUserAccountData`) target the proxy directly.
    aavePool: getAddress("0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2"),
    aavePoolAddressesProvider: getAddress("0x2f39d218133AFaB8F2B819B1066c7E434Ad94E9e"),
    aaveUiPoolDataProvider: getAddress("0x56b7A1012765C285afAC8b8F25C69Bf10ccfE978"),
    aaveOracle: getAddress("0x54586bE62E3c3580375aE3723C145253060Ca0C2"),
    aaveIncentivesController: getAddress("0x8164Cc65827dcFe994AB23944CBC90e0aa80bFcb"),
  },
  // Arbitrum One. WETH from arbitrum.io/docs (`0x82aF…3FBab1`). Aave V3
  // satellites from bgd-labs `AaveV3Arbitrum.sol`. The Pool address
  // `0x794a…14aD` is the canonical Aave V3 proxy shared with Polygon +
  // Optimism (cross-chain proxy reuse is intentional — same deployer
  // governance, identical implementation slot).
  42161: {
    weth: getAddress("0x82aF49447D8a07e3bd95BD0d56f35241523fBab1"),
    aavePool: getAddress("0x794a61358D6845594F94dc1DB02A252b5b4814aD"),
    aavePoolAddressesProvider: getAddress("0xa97684ead0e402dC232d5A977953DF7ECBaB3CDb"),
    aaveUiPoolDataProvider: getAddress("0x145dE30c929a065582da84Cf96F88460dB9745A7"),
    aaveOracle: getAddress("0xb56c2F0B653B2e0b10C9b928C8580Ac5Df02C7C7"),
    aaveIncentivesController: getAddress("0x929EC64c34a17401F460460D4B9390518E5B473e"),
  },
  // Polygon PoS. WETH from polygon.technology/tokens (Wrapped ETH bridged
  // via Polygon PoS bridge, NOT WMATIC). Aave V3 satellites from bgd-labs
  // `AaveV3Polygon.sol`. Pool + AddressesProvider + IncentivesController
  // shared with Arbitrum/Optimism (canonical proxies).
  137: {
    weth: getAddress("0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619"),
    aavePool: getAddress("0x794a61358D6845594F94dc1DB02A252b5b4814aD"),
    aavePoolAddressesProvider: getAddress("0xa97684ead0e402dC232d5A977953DF7ECBaB3CDb"),
    aaveUiPoolDataProvider: getAddress("0x68100bD5345eA474D93577127C11F39FF8463e93"),
    aaveOracle: getAddress("0xb023e699F5a33916Ea823A16485e259257cA8Bd1"),
    aaveIncentivesController: getAddress("0x929EC64c34a17401F460460D4B9390518E5B473e"),
  },
  // Base. WETH is the OP-Stack predeploy `0x4200…0006`. Aave V3 satellites
  // from bgd-labs `AaveV3Base.sol`. Base's Pool address is DISTINCT from
  // the Arbitrum/Polygon/Optimism canonical proxy — separate governance
  // deployment.
  8453: {
    weth: getAddress("0x4200000000000000000000000000000000000006"),
    aavePool: getAddress("0xA238Dd80C259a72e81d7e4664a9801593F98d1c5"),
    aavePoolAddressesProvider: getAddress("0xe20fCBdBfFC4Dd138cE8b2E6FBb6CB49777ad64D"),
    aaveUiPoolDataProvider: getAddress("0x174446a6741300cD2E7C1b1A636Fee99c8F83502"),
    aaveOracle: getAddress("0x2Cc0Fc26eD4563A5ce5e8bdcfe1A2878676Ae156"),
    aaveIncentivesController: getAddress("0xf9cc4F0D883F1a1eb2c253bdb46c254Ca51E1F44"),
  },
  // OP Mainnet (Optimism). WETH is the OP-Stack predeploy `0x4200…0006`
  // (shared with Base). Aave V3 satellites from bgd-labs `AaveV3Optimism.sol`.
  // Pool + AddressesProvider + IncentivesController shared with Arbitrum
  // and Polygon.
  10: {
    weth: getAddress("0x4200000000000000000000000000000000000006"),
    aavePool: getAddress("0x794a61358D6845594F94dc1DB02A252b5b4814aD"),
    aavePoolAddressesProvider: getAddress("0xa97684ead0e402dC232d5A977953DF7ECBaB3CDb"),
    aaveUiPoolDataProvider: getAddress("0xbd83DdBE37fc91923d59C8c1E0bDe0CccCa332d5"),
    aaveOracle: getAddress("0xD81eb3728a631871a7eBBaD631b5f424909f0c77"),
    aaveIncentivesController: getAddress("0x929EC64c34a17401F460460D4B9390518E5B473e"),
  },
};

/**
 * Get the canonical WETH9 contract address for the given chain. Type-safe —
 * unknown chains fail at compile time, not at runtime. Plan 06-04 wires this
 * to `prepare_weth_unwrap`'s `tx.to` and migrates
 * `src/tools/get_portfolio_summary.ts` to use this instead of the inlined
 * literal.
 */
export function getWethAddress(chainId: ChainId): Address {
  return CONTRACTS_RAW[chainId].weth;
}

/**
 * Get the canonical Aave V3 Pool contract address for the given chain.
 * Consumed by Plan 07-03's `prepare_aave_supply` / `prepare_aave_withdraw`
 * / `simulate_position_change` as `tx.to`. The same address is also seeded
 * in `KNOWN_SPENDERS_ETHEREUM` (row 0) for approval-label discovery; the
 * regression test asserts cross-view byte-identity between the two views.
 */
export function getAaveV3PoolAddress(chainId: ChainId): Address {
  return CONTRACTS_RAW[chainId].aavePool;
}

/**
 * Get the canonical Aave V3 `PoolAddressesProvider` for the given chain.
 * Consumed by Plan 07-02's `get_lending_positions` — passed as the
 * `provider` argument to UiPoolDataProviderV3's reader calls.
 */
export function getAaveV3PoolAddressesProvider(chainId: ChainId): Address {
  return CONTRACTS_RAW[chainId].aavePoolAddressesProvider;
}

/**
 * Get the canonical Aave V3 `UiPoolDataProviderV3` for the given chain.
 * Consumed by Plan 07-02's `get_lending_positions` reader as the call
 * target (`tx.to` for read-only `eth_call`).
 */
export function getAaveV3UiPoolDataProvider(chainId: ChainId): Address {
  return CONTRACTS_RAW[chainId].aaveUiPoolDataProvider;
}

/**
 * Get the canonical Aave V3 `AaveOracle` for the given chain. Forward-compat
 * slot — v1.1 surfaces use the per-reserve `priceInMarketReferenceCurrency`
 * exposed by UiPoolDataProviderV3 directly; the oracle is seeded for
 * v1.x-future flexibility.
 */
export function getAaveV3Oracle(chainId: ChainId): Address {
  return CONTRACTS_RAW[chainId].aaveOracle;
}

/**
 * Get the canonical Aave V3 `DEFAULT_INCENTIVES_CONTROLLER` for the given
 * chain. Forward-compat slot — rewards-claim is v2.3+ scope; the address is
 * seeded so a future plan can wire it without re-touching the SOT shape.
 */
export function getAaveV3IncentivesController(chainId: ChainId): Address {
  return CONTRACTS_RAW[chainId].aaveIncentivesController;
}

// ---------------------------------------------------------------------------
// Compound V3 Comet per-chain SOT — Phase 28 Plan 28-01.
// ---------------------------------------------------------------------------
//
// Sibling sub-table (NOT a widening of `ContractsForChain`) per patterns-mapper
// § 3: Compound V3 has 6 mainnet Comets that v2.3.x will extend to Polygon /
// Arbitrum / Base / Optimism. A `Partial<Record<ChainId, Partial<Record<base,
// Address>>>>` shape lets v2.3.x add chain rows incrementally without
// breaking the (existing) Aave-V3-shaped `ContractsForChain` contract.
//
// Provenance: 6 mainnet Comets cross-verified against the canonical Compound
// deployments registry — [compound-finance/comet/deployments/mainnet/*/roots.json](https://github.com/compound-finance/comet/tree/main/deployments)
// at research-time 2026-05-20 (Phase 28 research § Topic 1). Each literal
// `getAddress`-wrapped at the literal site so a corrupted snapshot — single
// hex digit flipped at rest — throws EIP-55 at module load.

/**
 * The base-asset symbols used across Compound V3 Comet markets on Ethereum
 * mainnet (Phase 28) and L2 chains (Phase 41 Plan 41-01: Arbitrum, Polygon,
 * Base, Optimism). The type only grows when a new BASE asset (not a new chain)
 * is added. Each Comet contract's `baseToken()` returns the specific ERC-20
 * corresponding to its symbol.
 *
 * "USDC.e" — the bridged-USDC base asset used by both the Arbitrum legacy
 * Comet (0xA5ED…dCA) and the Polygon Comet (0xF252…445). Per the Phase 41
 * locked decision: Polygon's "usdc" Comet base token IS bridged USDC.e
 * (0x2791…), NOT native Circle USDC. Using a distinct key avoids symbol
 * confusion in agent-side routing.
 *
 * "AERO" — the Aerodrome governance token; a non-stablecoin / volatile base
 * asset. Used exclusively by the Base AERO Comet (0x784e…). Borrow APR
 * dynamics differ from stablecoin Comets but the ABI is identical.
 */
export type CompoundCometBase =
  | "USDC"
  | "USDT"
  | "WETH"
  | "USDS"
  | "wstETH"
  | "WBTC"
  | "USDC.e" // bridged USDC — Arbitrum legacy Comet + Polygon Comet (base token = 0x2791…)
  | "AERO"; // Aerodrome token — volatile base asset, Base chain only (Phase 41)

/**
 * Per-chain Compound V3 Comet contracts. Partial-on-chain AND partial-on-base
 * because each chain's Comet base-asset coverage is a STRICT SUBSET of
 * Ethereum's. Phase 41 Plan 41-01 extends this table with 4 L2 chain rows
 * (Arbitrum, Polygon, Base, Optimism — 13 new Comet addresses). Getter helpers
 * below return `Address | null` (single market) and `Address[]` (chain
 * fan-out, empty for chains without rows).
 *
 * Format-fanout-sentinel: all Comet addresses live ONLY here. Plan 28-04
 * regression-test asserts `grep -n "0xc3d688B6\|0x3Afdc9BC\|..." src/ -r`
 * outside of this file is empty. The Phase 41 L2 addresses are likewise
 * exclusively in this table; canonical-dispatch auto-extends from the SOT
 * getter (`getAllCompoundCometsForChain`) with zero code change in
 * `canonical-dispatch.ts`.
 *
 * WETH cross-SOT consistency: the WETH Comet base-token addresses on Arbitrum
 * (0x82aF…3FBab1), Base (0x4200…0006), and Optimism (0x4200…0006) equal the
 * corresponding `getWethAddress(chainId)` values — mirroring the
 * EigenLayer/Lido cross-SOT pattern from Phase 31. (These are the base-token
 * addresses verified against `configuration.json`; this row stores the Comet
 * proxy, not the base token.)
 */
const COMPOUND_COMETS_RAW: Partial<Record<ChainId, Partial<Record<CompoundCometBase, Address>>>> = {
  // Ethereum mainnet (chainId 1) — UNCHANGED; Fixtures R/S/T/U are hardcoded
  // against these 6 addresses. Do NOT mutate this row.
  1: {
    USDC: getAddress("0xc3d688B66703497DAA19211EEdff47f25384cdc3"),
    USDT: getAddress("0x3Afdc9BCA9213A35503b077a6072F3D0d5AB0840"),
    WETH: getAddress("0xA17581A9E3356d9A858b789D68B4d866e593aE94"),
    USDS: getAddress("0x5D409e56D886231aDAf00c8775665AD0f9897b56"),
    wstETH: getAddress("0x3D0bb1ccaB520A66e607822fC55BC921738fAFE3"),
    WBTC: getAddress("0xe85Dc543813B8c2CFEaAc371517b925a166a9293"),
  },
  // Arbitrum One (chainId 42161) — Phase 41 Plan 41-01. 4 Comets.
  // Provenance: compound-finance/comet deployments/arbitrum/*/roots.json
  // (research-time 2026-05-29, HIGH confidence).
  //
  // ADDRESS-COINCIDENCE NOTE: the Arbitrum USDC Comet proxy
  // 0x9c4ec768c28520B50860ea7a15bd7213a9fF58bf is the SAME address as the
  // Base USDbC Comet proxy on chainId 8453. This is a genuine cross-chain
  // coincidence (identical CREATE2 salt / governance reuse) — NOT a
  // copy-paste error. It is harmless: canonical-dispatch sets are per-chain
  // (`CANONICAL_DISPATCH_TARGETS[42161]` ≠ `CANONICAL_DISPATCH_TARGETS[8453]`).
  42161: {
    USDC: getAddress("0x9c4ec768c28520B50860ea7a15bd7213a9fF58bf"), // native Circle USDC (launched Jan 2026); see ADDRESS-COINCIDENCE NOTE above
    "USDC.e": getAddress("0xA5EDBDD9646f8dFF606d7448e414884C7d905dCA"), // bridged USDC.e legacy market (runs alongside native USDC to avoid liquidity shock)
    USDT: getAddress("0xd98Be00b5D27fc98112BdE293e487f8D4cA57d07"),
    WETH: getAddress("0x6f7D514bbD4aFf3BcD1140B7344b32f063dEe486"),
  },
  // Polygon PoS (chainId 137) — Phase 41 Plan 41-01. 2 Comets.
  // Provenance: compound-finance/comet deployments/polygon/*/roots.json.
  //
  // NOTE: The "USDC.e" key maps to the Polygon "usdc" Comet directory in the
  // compound-finance/comet repo — but the configuration.json base token is
  // 0x2791bca1f2de4661ed88a30c99a7a9449aa84174 (bridged USDC.e), NOT native
  // Circle USDC (0x3c499c…). Using "USDC.e" makes this explicit in the type
  // system; getCompoundCometAddress(137, "USDC") returns null.
  137: {
    "USDC.e": getAddress("0xF25212E676D1F7F89Cd72fFEe66158f541246445"), // base token = 0x2791… bridged USDC.e (NOT native USDC per configuration.json)
    USDT: getAddress("0xaeB318360f27748Acb200CE616E389A6C9409a07"),
  },
  // Base (chainId 8453) — Phase 41 Plan 41-01. 4 Comets.
  // Provenance: compound-finance/comet deployments/base/*/roots.json.
  //
  // DELIBERATE EXCLUSION: the deprecated Base USDbC Comet
  // 0x9c4ec768c28520B50860ea7a15bd7213a9fF58bf (~$82k TVL, Gauntlet Dec-2024
  // deprecation recommendation) is INTENTIONALLY excluded from this SOT per
  // the Phase 41 locked decision. Users with legacy USDbC positions exit via
  // the existing `prepare_custom_call` escape hatch (Phase 35). Do NOT add a
  // USDbC row or a "USDbC" type key — the test in Plan 41-01 Task 2 asserts
  // this address is absent from the Base arm.
  8453: {
    USDC: getAddress("0xb125E6687d4313864e53df431d5425969c15Eb2F"),
    WETH: getAddress("0x46e6b214b524310239732D51387075E0e70970bf"),
    USDS: getAddress("0x2c776041CCFe903071AF44aa147368a9c8EEA518"),
    AERO: getAddress("0x784efeB622244d2348d4F2522f8860B96fbEcE89"), // Aerodrome governance token — volatile base asset (non-stablecoin Comet, Base only)
  },
  // OP Mainnet (chainId 10) — Phase 41 Plan 41-01. 3 Comets.
  // Provenance: compound-finance/comet deployments/optimism/*/roots.json.
  10: {
    USDC: getAddress("0x2e44e174f7D53F0212823acC11C01A11d58c5bCB"),
    USDT: getAddress("0x995E394b8B2437aC8Ce61Ee0bC610D617962B214"),
    WETH: getAddress("0xE36A30D249f7761327fd973001A32010b521b6Fd"),
  },
};

/**
 * Get the canonical Compound V3 Comet address for `(chainId, base)`. Returns
 * `null` when the market is not deployed on the given chain (v2.3.x will fill
 * in Polygon / Arbitrum / Base / Optimism rows). Consumed by Plan 28-02's
 * `prepare_compound_supply` / `prepare_compound_withdraw` and Plan 28-03's
 * `prepare_compound_borrow` / `prepare_compound_repay` as `tx.to`. The same
 * addresses are seeded in `KNOWN_SPENDERS_ETHEREUM` (6 new rows below) for
 * approval-label discovery; the regression test asserts cross-view byte-
 * identity (T-COMPOUND-COMET-ADDR-INLINE-1 anchor).
 */
export function getCompoundCometAddress(
  chainId: ChainId,
  base: CompoundCometBase,
): Address | null {
  return COMPOUND_COMETS_RAW[chainId]?.[base] ?? null;
}

/**
 * Get every Compound V3 Comet deployed on `chainId`. Returns `[]` (NOT
 * undefined / throw) for chains absent from `COMPOUND_COMETS_RAW` — Plan
 * 28-04 canonical-dispatch allowlist builds the Compound arm by mapping over
 * the result. Order follows `Object.values` iteration order; callers MUST
 * NOT depend on it.
 */
export function getAllCompoundCometsForChain(chainId: ChainId): Address[] {
  const row = COMPOUND_COMETS_RAW[chainId];
  if (!row) return [];
  return Object.values(row).filter((a): a is Address => !!a);
}

// ---------------------------------------------------------------------------
// Morpho Blue per-chain SOT — Phase 29 Plan 29-01.
// ---------------------------------------------------------------------------
//
// Sibling sub-table (NOT a widening of `ContractsForChain`) per Phase 28 § 3
// precedent: Morpho Blue ships ONE contract per chain (no per-base inner record
// — unlike Compound V3 Comets), so the type is the simpler
// `Partial<Record<ChainId, Address>>`. v2.3.x grows the table to chainId 8453
// (Base) and chainId 137 (Polygon) by adding rows; the getter signature stays
// stable.
//
// Provenance: Morpho Blue verified at `0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb`
// on all 40+ supported chains (research § Topic 1 — research date 2026-05-21).
// Canonical SOT URL: [docs.morpho.org/addresses](https://docs.morpho.org/addresses).
// Cross-verified against LedgerHQ ERC-7730 [calldata-MorphoBlue.json](https://github.com/LedgerHQ/clear-signing-erc7730-registry/blob/master/registry/morpho/calldata-MorphoBlue.json)
// contract address coverage (clear-sign metadata is keyed on this exact address).
//
// Phase 29 ships chainId 1 ONLY; Base (8453) + Polygon (137) deferred to
// v2.3.x mirroring Phase 28 Compound deferral pattern.
//
// Each literal `getAddress`-wrapped at the literal site so a corrupted snapshot
// — single hex digit flipped at rest — throws EIP-55 at module load.

/**
 * Per-chain Morpho Blue singleton contract addresses. The same proxy contract
 * is deployed at `0xBBBB…FFCb` on every supported chain (Morpho's `CREATE2`
 * vanity deployment). `Partial<Record<ChainId, Address>>` because v2.3.x grows
 * the table incrementally without disturbing existing callers.
 *
 * Format-fanout-sentinel: the Morpho Blue address literal lives ONLY here.
 * Plan 29-01 regression test asserts `grep -n "0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb" src/ -r`
 * outside of this file is empty.
 */
const MORPHO_BLUE_RAW: Partial<Record<ChainId, Address>> = {
  1: getAddress("0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb"),
};

/**
 * Get the canonical Morpho Blue contract address for the given chain. Returns
 * `null` when Morpho is not enumerated on the given chain (v2.3.x will fill in
 * Base / Polygon / Arbitrum / Optimism rows). Consumed by:
 *   - Plan 29-02's `get_morpho_positions` reader (`tx.to` for `eth_call`).
 *   - Plan 29-03's `prepare_morpho_*` tools (`tx.to` for the prepared tx).
 *   - Plan 29-03's `canonical-dispatch.ts` Ethereum allowlist arm.
 * The same address is also seeded in `KNOWN_SPENDERS_ETHEREUM` (Morpho Blue
 * row below) for approval-label discovery; the regression test asserts cross-
 * view byte-identity between the two views.
 */
export function getMorphoBlueAddress(chainId: ChainId): Address | null {
  return MORPHO_BLUE_RAW[chainId] ?? null;
}

// ---------------------------------------------------------------------------
// Lido per-chain SOT — Phase 30 Plan 30-01.
// ---------------------------------------------------------------------------
//
// Sibling sub-table (NOT a widening of `ContractsForChain`) per Phase 28/29
// precedent. Lido ships THREE contracts per chain in different roles:
//   - stETH proxy (Lido) — Ethereum mainnet only; `submit` = stake ETH.
//   - wstETH — Ethereum mainnet + Arbitrum (bridged ERC20Bridged); wrap/unwrap.
//   - WithdrawalQueueERC721 — Ethereum mainnet only; `requestWithdrawals` = unstake.
//
// Arbitrum slot carries wstETH only (bridged ERC20Bridged from lidofinance/lido-l2).
// steth + withdrawalQueue on Arbitrum are set to address(0) sentinels — D-03
// enforces that prepare_lido_* refuses for non-Ethereum chains before reaching
// these slots; D-10 canonical-dispatch filter removes address(0) entries from
// the Arbitrum allowlist arm automatically.
//
// Provenance (research date 2026-05-23 — research § Topic 1 + Topic 5):
//   - stETH proxy:            0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84 (Ethereum)
//   - wstETH:                 0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0 (Ethereum)
//   - WithdrawalQueueERC721:  0x889edC2eDab5f40e902b864aD4d7AdE8E412F9B1 (Ethereum)
//   - wstETH ERC20Bridged:    0x5979D7b546E38E414F7E9822514be443A4800529 (Arbitrum)
// All verified against docs.lido.fi/deployed-contracts + lidofinance/core GitHub.
//
// Each literal `getAddress`-wrapped at the literal site so a corrupted snapshot
// — single hex digit flipped at rest — throws EIP-55 at module load.
// T-LIDO-SPENDER-DRIFT-1 cross-view: `getLidoWstethAddress(1)` and
// `getLidoWithdrawalQueueAddress(1)` are byte-identical to their
// `KNOWN_SPENDERS_ETHEREUM` row addresses (asserted in test/config-contracts.test.ts).

/**
 * Per-chain Lido contract addresses. Ethereum has the full triple (stETH +
 * wstETH + WithdrawalQueueERC721). Arbitrum has wstETH bridged only; stETH
 * and WithdrawalQueue slots carry address(0) sentinels (D-01 / D-03).
 */
export interface LidoContracts {
  steth: Address;            // stETH proxy (Lido) — Ethereum only; address(0) on Arbitrum
  wsteth: Address;           // wstETH (Ethereum native + Arbitrum ERC20Bridged)
  withdrawalQueue: Address;  // WithdrawalQueueERC721 — Ethereum only; address(0) on Arbitrum
}

const LIDO_RAW: Partial<Record<ChainId, LidoContracts>> = {
  // Ethereum mainnet: full 3-contract set — all write tools land here.
  1: {
    steth: getAddress("0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84"),
    wsteth: getAddress("0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0"),
    withdrawalQueue: getAddress("0x889edC2eDab5f40e902b864aD4d7AdE8E412F9B1"),
  },
  // Arbitrum: wstETH bridged (read-only); steth + withdrawalQueue unused.
  // D-03: prepare_lido_* refuses for non-Ethereum chains before reaching this slot.
  // D-10: canonical-dispatch filter removes address(0) entries from the allowlist.
  42161: {
    steth: getAddress("0x0000000000000000000000000000000000000000"),   // N/A — no bridged stETH on Arbitrum
    wsteth: getAddress("0x5979D7b546E38E414F7E9822514be443A4800529"),  // ERC20Bridged from lidofinance/lido-l2
    withdrawalQueue: getAddress("0x0000000000000000000000000000000000000000"), // N/A
  },
};

/**
 * Get the canonical Lido stETH proxy address for the given chain. Returns
 * `null` for chains without a Lido stETH entry (all except Ethereum).
 * Note: Arbitrum returns the address(0) sentinel — callers that need a
 * non-null, non-zero result should check the return value.
 * Consumed by Plan 30-03's `prepare_lido_stake` and by canonical-dispatch.ts.
 */
export function getLidoStethAddress(chainId: ChainId): Address | null {
  return LIDO_RAW[chainId]?.steth ?? null;
}

/**
 * Get the canonical Lido wstETH contract address for the given chain. Returns
 * `null` for chains without a Lido wstETH entry. Ethereum returns the native
 * wstETH contract; Arbitrum returns the bridged ERC20Bridged proxy.
 * Consumed by Plan 30-03's `prepare_lido_wrap` / `prepare_lido_unwrap` and
 * by canonical-dispatch.ts + KNOWN_SPENDERS_ETHEREUM (T-LIDO-SPENDER-DRIFT-1).
 */
export function getLidoWstethAddress(chainId: ChainId): Address | null {
  return LIDO_RAW[chainId]?.wsteth ?? null;
}

/**
 * Get the canonical Lido WithdrawalQueueERC721 address for the given chain.
 * Returns `null` for chains without a WithdrawalQueue entry (all except
 * Ethereum). Note: Arbitrum returns the address(0) sentinel.
 * Consumed by Plan 30-03's `prepare_lido_unstake` and by canonical-dispatch.ts
 * + KNOWN_SPENDERS_ETHEREUM (T-LIDO-SPENDER-DRIFT-1).
 */
export function getLidoWithdrawalQueueAddress(chainId: ChainId): Address | null {
  return LIDO_RAW[chainId]?.withdrawalQueue ?? null;
}

// ---------------------------------------------------------------------------
// EigenLayer per-chain SOT — Phase 31 Plan 31-01.
// ---------------------------------------------------------------------------
//
// Sibling sub-table (NOT a widening of `ContractsForChain`) per Phase 28/29/30
// precedent. EigenLayer ships TWO core contracts per chain (StrategyManager +
// DelegationManager) plus a curated per-LST registry (D-04: top-7 by TVL —
// stETH / rETH / cbETH / ETHx / wBETH / sfrxETH / mETH). Phase 31 is Ethereum-
// only (D-03) so only chainId=1 is populated; the getters return null on
// 42161 / 137 / 8453 / 10 by construction.
//
// Provenance (research date 2026-05-23 — research § Topic 1 + planner-gate
// verification 2026-05-23 — see 31-01-PLANNER-GATE-VERIFICATION.md):
//   - StrategyManager:        0x858646372CC42E1A627fcE94aa7A7033e7CF075A
//   - DelegationManager:      0x39053D51B77DC0d36036Fc1fCc8Cb819df8Ef37A
//   - 7× per-strategy proxies + 7× underlying-token ERC-20s, all cross-verified
//     against eigenlayer-contracts/script/configs/mainnet-addresses.config.json
//     and against on-chain `Strategy.underlyingToken()` returns at planner-gate
//     (A2 RESOLVED — zero drift on cbETH / ETHx / wBETH / sfrxETH / mETH).
//
// Cross-SOT byte-identity invariants:
//   - EIGENLAYER_RAW[1].lstTokens.stETH === LIDO_RAW[1].steth (Phase 30 SOT)
//   - EIGENLAYER_RAW[1].lstTokens.rETH  === ROCKETPOOL_RAW[1].reth (this phase SOT)
//   T-EIGENLAYER-SPENDER-DRIFT-1 (StrategyManager ↔ KNOWN_SPENDERS) anchored in
//   test/config-contracts.test.ts.
//
// Each literal `getAddress`-wrapped at the literal site so a corrupted snapshot
// — single hex digit flipped at rest — throws EIP-55 at module load.

/**
 * The 7 LSTs whose EigenLayer strategies ship in the Phase 31 curated
 * registry (D-04 — top by TVL as of late 2025). Long-tail strategies refuse at
 * the tool surface with `INVALID_INPUT + hintTool → request_capability`.
 * Adding a new LST is a 2-step ritual: extend this literal-union, populate the
 * `strategies` + `lstTokens` rows for that LST.
 *
 * Ordering follows TVL rank (stETH first; mETH last) for code-review readability;
 * the type itself is order-agnostic.
 */
export type EigenLayerLst =
  | "stETH"
  | "rETH"
  | "cbETH"
  | "ETHx"
  | "wBETH"
  | "sfrxETH"
  | "mETH";

/**
 * Per-chain EigenLayer canonical contract registry. Phase 31 ships chainId=1
 * only; v2.x widens (e.g. if EigenLayer deploys on an L2). The `strategies` +
 * `lstTokens` inner records are `Partial` so a future LST addition that lacks
 * one chain's strategy proxy doesn't force a placeholder row.
 */
export interface EigenLayerContracts {
  strategyManager: Address;
  delegationManager: Address;
  /** Per-LST EigenLayer strategy proxy contracts (the `strategy` arg to `depositIntoStrategy`). */
  strategies: Partial<Record<EigenLayerLst, Address>>;
  /** Per-LST underlying ERC-20 token contracts (the `token` arg to `depositIntoStrategy`; also the user-approval target). */
  lstTokens: Partial<Record<EigenLayerLst, Address>>;
}

const EIGENLAYER_RAW: Partial<Record<ChainId, EigenLayerContracts>> = {
  1: {
    strategyManager: getAddress("0x858646372CC42E1A627fcE94aa7A7033e7CF075A"),
    delegationManager: getAddress("0x39053D51B77DC0d36036Fc1fCc8Cb819df8Ef37A"),
    strategies: {
      stETH:   getAddress("0x93c4b944D05dfe6df7645A86cd2206016c51564D"),
      rETH:    getAddress("0x1BeE69b7dFFfA4E2d53C2a2Df135C388AD25dCD2"),
      cbETH:   getAddress("0x54945180dB7943c0ed0FEE7EdaB2Bd24620256bc"),
      ETHx:    getAddress("0x9d7eD45EE2E8FC5482fa2428f15C971e6369011d"),
      wBETH:   getAddress("0x7CA911E83dabf90C90dD3De5411a10F1A6112184"),
      sfrxETH: getAddress("0x8CA7A5d6f3acd3A7A8bC468a8CD0FB14B6BD28b6"),
      mETH:    getAddress("0x298aFB19A105D59E74658C4C334Ff360BadE6dd2"),
    },
    lstTokens: {
      // stETH literal MUST stay byte-identical to LIDO_RAW[1].steth (Phase 30 SOT).
      // Cross-SOT byte-identity is asserted in test/config-contracts.test.ts.
      stETH:   getAddress("0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84"),
      // rETH literal MUST stay byte-identical to ROCKETPOOL_RAW[1].reth (declared below).
      rETH:    getAddress("0xae78736Cd615f374D3085123A210448E74Fc6393"),
      // cbETH / ETHx / wBETH / sfrxETH / mETH all VERIFIED via Strategy.underlyingToken()
      // at planner-gate 2026-05-23 (zero drift); see 31-01-PLANNER-GATE-VERIFICATION.md.
      cbETH:   getAddress("0xBe9895146f7AF43049ca1c1AE358B0541Ea49704"),
      ETHx:    getAddress("0xA35b1B31Ce002FBF2058D22F30f95D405200A15b"),
      wBETH:   getAddress("0xa2E3356610840701BDf5611a53974510Ae27E2e1"),
      sfrxETH: getAddress("0xac3E018457B222d93114458476f3E3416Abbe38F"),
      mETH:    getAddress("0xd5F7838F5C461fefF7FE49ea5ebaF7728bB0ADfa"),
    },
  },
};

/**
 * Get the canonical EigenLayer `StrategyManager` proxy address. Returns `null`
 * for chains without an EigenLayer deployment (everything except Ethereum at
 * Phase 31 scope). Consumed by Plan 31-02's `prepare_eigenlayer_deposit` and
 * the canonical-dispatch Ethereum arm + KNOWN_SPENDERS_ETHEREUM (T-EIGENLAYER-
 * SPENDER-DRIFT-1).
 */
export function getEigenLayerStrategyManagerAddress(chainId: ChainId): Address | null {
  return EIGENLAYER_RAW[chainId]?.strategyManager ?? null;
}

/**
 * Get the canonical EigenLayer `DelegationManager` proxy address. Returns
 * `null` for chains without an EigenLayer deployment. Consumed by Plan 31-02's
 * `get_eigenlayer_positions` queued-withdrawal read.
 */
export function getEigenLayerDelegationManagerAddress(chainId: ChainId): Address | null {
  return EIGENLAYER_RAW[chainId]?.delegationManager ?? null;
}

/**
 * Get the canonical EigenLayer per-strategy proxy address for `(chainId, lst)`.
 * Returns `null` for unsupported chains OR LSTs absent from the curated
 * registry (e.g. `ankrETH`, `swETH`, `lsETH`, `oETH`, `osETH` — these refuse at
 * the tool surface with `INVALID_INPUT + hintTool → request_capability` per D-04).
 */
export function getEigenLayerStrategyAddress(
  chainId: ChainId,
  lst: EigenLayerLst,
): Address | null {
  return EIGENLAYER_RAW[chainId]?.strategies[lst] ?? null;
}

/**
 * Get the canonical underlying ERC-20 token address for `(chainId, lst)` — the
 * contract the user APPROVES for the StrategyManager (D-05 pre-flight target).
 * Returns `null` for unsupported chains OR LSTs absent from the curated
 * registry.
 *
 * Cross-SOT byte-identity invariant for chainId=1:
 *   - getEigenLayerLstTokenAddress(1, "stETH") === getLidoStethAddress(1)
 *   - getEigenLayerLstTokenAddress(1, "rETH")  === getRocketPoolRethAddress(1)
 */
export function getEigenLayerLstTokenAddress(
  chainId: ChainId,
  lst: EigenLayerLst,
): Address | null {
  return EIGENLAYER_RAW[chainId]?.lstTokens[lst] ?? null;
}

/**
 * Fan-out helper — returns every `(lst, strategy, lstToken)` row deployed on
 * `chainId`. Returns `[]` (NOT undefined / throw) for chains absent from
 * `EIGENLAYER_RAW`. Consumed by the canonical-dispatch Ethereum arm (each
 * strategy proxy is a distinct dispatch target — T-DISPATCH-COLLISION-31).
 * Order follows `Object.keys` iteration of the `strategies` inner record;
 * callers MUST NOT depend on it.
 */
export function getAllEigenLayerStrategiesForChain(
  chainId: ChainId,
): Array<{ lst: EigenLayerLst; strategy: Address; lstToken: Address }> {
  const row = EIGENLAYER_RAW[chainId];
  if (!row) return [];
  const result: Array<{ lst: EigenLayerLst; strategy: Address; lstToken: Address }> = [];
  for (const lst of Object.keys(row.strategies) as EigenLayerLst[]) {
    const strategy = row.strategies[lst];
    const lstToken = row.lstTokens[lst];
    if (strategy && lstToken) result.push({ lst, strategy, lstToken });
  }
  return result;
}

// ---------------------------------------------------------------------------
// Rocket Pool per-chain SOT — Phase 31 Plan 31-01.
// ---------------------------------------------------------------------------
//
// Sibling sub-table (NOT a widening of `ContractsForChain`). Rocket Pool ships
// THREE contracts per chain in different roles:
//   - RocketDepositPool v1.2 — `deposit()` payable; value-bearing stake entry.
//   - rETH (RocketTokenRETH)  — `burn(uint256)` unstake; `getExchangeRate()` view.
//   - RocketDAOProtocolSettingsDeposit — `getMinimumDeposit()` view (D-07).
//
// Per D-07: a hardcoded `ROCKET_POOL_MINIMUM_DEPOSIT_FALLBACK_WEI` (0.01 ETH =
// 1e16 wei) anchors resilience if the on-chain read fails or times out.
//
// Per RESEARCH § Topic 1 Option A (recommended): the
// RocketDAOProtocolSettingsDeposit address is resolved ONCE via
// RocketStorage.getAddress(keccak256("contract.address",
// "rocketDAOProtocolSettingsDeposit")) at planner-gate and hardcoded here.
// See 31-01-PLANNER-GATE-VERIFICATION.md for the resolution audit trail (A1).
// A future Rocket Pool major version is a code change anyway; the dynamic
// lookup pattern is not load-bearing for v2.3.
//
// Phase 31 ships chainId=1 only (D-03 — Rocket Pool is Ethereum-mainnet-only
// at v2.3 scope). Each literal `getAddress`-wrapped at the literal site so a
// corrupted snapshot — single hex digit flipped at rest — throws EIP-55 at
// module load.
//
// Cross-SOT byte-identity invariant: ROCKETPOOL_RAW[1].reth ===
// EIGENLAYER_RAW[1].lstTokens.rETH (both equal the canonical rETH ERC-20).

/**
 * Per-chain Rocket Pool canonical contract registry. Phase 31 ships chainId=1
 * only; v2.6 cross-chain rETH bridging is a separate milestone surface.
 */
export interface RocketPoolContracts {
  /** RocketDepositPool v1.2 — value-bearing `deposit()` entry; also the `tx.to` for stake. */
  depositPool: Address;
  /** rETH (RocketTokenRETH) — the LST contract; `burn(uint256)` is the unstake entry. */
  reth: Address;
  /** RocketDAOProtocolSettingsDeposit — `getMinimumDeposit()` view; D-07 pre-flight read target. */
  settingsDeposit: Address;
}

const ROCKETPOOL_RAW: Partial<Record<ChainId, RocketPoolContracts>> = {
  1: {
    depositPool:     getAddress("0xDD3f50F8A6CafbE9b31a427582963f465E745AF8"),
    reth:            getAddress("0xae78736Cd615f374D3085123A210448E74Fc6393"),
    // VERIFIED via RocketStorage.getAddress(keccak256("contract.address",
    // "rocketDAOProtocolSettingsDeposit")) at planner-gate 2026-05-23;
    // supersedes RESEARCH § Topic 1 training-data literal 0xac2245BE…
    // See 31-01-PLANNER-GATE-VERIFICATION.md (A1 RESOLVED).
    settingsDeposit: getAddress("0x227BE8dD01DF8ad9BED0178e4F8cEC2996C5c365"),
  },
};

/**
 * Get the canonical RocketDepositPool v1.2 proxy address. Returns `null` for
 * chains without a Rocket Pool deployment (everything except Ethereum at Phase
 * 31 scope). Consumed by Plan 31-03's `prepare_rocketpool_stake` (as `tx.to`)
 * and the canonical-dispatch Ethereum arm + KNOWN_SPENDERS_ETHEREUM
 * (T-ROCKETPOOL-SPENDER-DRIFT-1).
 */
export function getRocketPoolDepositPoolAddress(chainId: ChainId): Address | null {
  return ROCKETPOOL_RAW[chainId]?.depositPool ?? null;
}

/**
 * Get the canonical rETH (RocketTokenRETH) ERC-20 address. Returns `null` for
 * chains without a Rocket Pool deployment. Consumed by Plan 31-03's
 * `prepare_rocketpool_unstake` (as `tx.to` for the `burn(uint256)` call) and
 * by `get_rocketpool_positions` (as the `balanceOf` / `getExchangeRate` call
 * target). Cross-SOT byte-identity: equals EIGENLAYER_RAW[1].lstTokens.rETH.
 */
export function getRocketPoolRethAddress(chainId: ChainId): Address | null {
  return ROCKETPOOL_RAW[chainId]?.reth ?? null;
}

/**
 * Get the canonical RocketDAOProtocolSettingsDeposit proxy. Returns `null` for
 * chains without a Rocket Pool deployment. Consumed by Plan 31-03's D-07
 * pre-flight read (`getMinimumDeposit()` against this address; falls back to
 * `ROCKET_POOL_MINIMUM_DEPOSIT_FALLBACK_WEI` on read failure).
 */
export function getRocketPoolDepositSettingsAddress(chainId: ChainId): Address | null {
  return ROCKETPOOL_RAW[chainId]?.settingsDeposit ?? null;
}

/**
 * D-07 resilience anchor — the minimum-deposit constant Rocket Pool enforces
 * at the `RocketDepositPool.deposit()` entry. 0.01 ETH = 1e16 wei. Verified
 * against docs.rocketpool.net + RocketDAOProtocolSettingsDeposit.sol source
 * at research time. Used by Plan 31-03's pre-flight when the on-chain
 * `getMinimumDeposit()` read against `RocketDAOProtocolSettingsDeposit` fails
 * or times out — protects against silent acceptance of an under-min stake.
 */
export const ROCKET_POOL_MINIMUM_DEPOSIT_FALLBACK_WEI: bigint = 10_000_000_000_000_000n;

// ---------------------------------------------------------------------------
// Uniswap V3 per-chain SOT — Phase 32 Plan 32-01.
// ---------------------------------------------------------------------------
//
// Sibling sub-table (NOT a widening of `ContractsForChain`) per Phase 28/29/30/31
// precedent. Uniswap V3 ships THREE core contracts per chain VaultPilot routes:
//   - SwapRouter02 — `exactInputSingle` / `exactInput` / `unwrapWETH9` / `multicall`
//     write surface; D-13 dispatch allowlist target.
//   - Quoter V2 — `quoteExactInputSingle` / `quoteExactInput` read surface; D-13
//     read-only, NOT in the canonical-dispatch allowlist.
//   - NonfungiblePositionManager — Phase 33 LP-verb dispatch target (RESERVED at
//     Phase 32 per D-01; Phase 32 itself does NOT consume but the slot is
//     pre-populated so Phase 33 reads the existing SOT without re-extending).
//
// Per D-03: Phase 32 is Ethereum-mainnet-only; chainId=1 populated, all other
// chains return null from the 3 getters. Multi-chain SwapRouter02 + Quoter V2
// deployments exist (per Uniswap docs) but their SOT extension is deferred
// (see CONTEXT.md § Deferred).
//
// Provenance (research date 2026-05-23 — RESEARCH § Topic 2 + Topic 1 + Topic 9):
// All three addresses cross-verified against docs.uniswap.org/contracts/v3/reference/
// deployments/ethereum-deployments + Etherscan proxy resolution. Canonical
// EIP-55 checksums applied at the `getAddress`-wrap below.
//
// Cross-view byte-identity invariant:
//   UNISWAP_V3_RAW[1].swapRouter02 === KNOWN_SPENDERS_ETHEREUM "Uniswap V3
//   SwapRouter02" row address (the inline literal at Phase 6 lines 864-868
//   is promoted to a SOT-getter delegate at Phase 32 per D-13a; the row's
//   array index + neighboring-row order are preserved byte-identically).
//   T-UNISWAP-V3-SPENDER-DRIFT-1 anchored in test/config-contracts.test.ts.
//
// Each literal `getAddress`-wrapped at the literal site so a corrupted snapshot
// — single hex digit flipped at rest — throws EIP-55 at module load.

/**
 * Per-chain Uniswap V3 canonical contract registry. Phase 32 ships chainId=1
 * only; v2.4+ may widen (all 5 EVM chains have SwapRouter02 + Quoter V2 +
 * NonfungiblePositionManager deployments per Uniswap docs, but Phase 32 keeps
 * the surface Ethereum-only by D-03).
 */
export interface UniswapV3Contracts {
  /** SwapRouter02 — D-13 dispatch target for every `prepare_uniswap_swap` call. */
  swapRouter02: Address;
  /** Quoter V2 — D-13 read-only (NOT in dispatch allowlist by design). */
  quoterV2: Address;
  /** NonfungiblePositionManager — RESERVED for Phase 33 LP verbs (D-01); pre-populated at Phase 32. */
  nonfungiblePositionManager: Address;
}

const UNISWAP_V3_RAW: Partial<Record<ChainId, UniswapV3Contracts>> = {
  1: {
    swapRouter02:               getAddress("0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45"),
    quoterV2:                   getAddress("0x61fFE014bA17989E743c5F6cB21bF9697530B21e"),
    nonfungiblePositionManager: getAddress("0xC36442b4a4522E871399CD717aBDD847Ab11FE88"),
  },
};

/**
 * Get the canonical Uniswap V3 SwapRouter02 address. Returns `null` for chains
 * without a Uniswap V3 SwapRouter02 SOT slot (everything except Ethereum at
 * Phase 32 scope). Consumed by Plan 32-03's `prepare_uniswap_swap` (as `tx.to`)
 * and the canonical-dispatch Ethereum arm + KNOWN_SPENDERS_ETHEREUM
 * (T-UNISWAP-V3-SPENDER-DRIFT-1).
 */
export function getUniswapV3SwapRouter02Address(chainId: ChainId): Address | null {
  return UNISWAP_V3_RAW[chainId]?.swapRouter02 ?? null;
}

/**
 * Get the canonical Uniswap V3 Quoter V2 address. Returns `null` for chains
 * without a Uniswap V3 Quoter V2 SOT slot. Consumed by Plan 32-02's
 * `get_uniswap_quote` (auto-fee-tier `quoteExactInputSingle` iteration +
 * multi-hop `quoteExactInput` path quote). Read-only; NOT added to the
 * canonical-dispatch allowlist by design (D-13a).
 */
export function getUniswapV3QuoterV2Address(chainId: ChainId): Address | null {
  return UNISWAP_V3_RAW[chainId]?.quoterV2 ?? null;
}

/**
 * Get the canonical Uniswap V3 NonfungiblePositionManager address. Returns
 * `null` for chains without an NPM SOT slot. RESERVED for Phase 33 LP verbs
 * (mint / increase / decrease / collect / burn / rebalance); pre-populated at
 * Phase 32 per D-01 so Phase 33 reads the existing slot without re-extending
 * the SOT.
 */
export function getUniswapV3NonfungiblePositionManagerAddress(
  chainId: ChainId,
): Address | null {
  return UNISWAP_V3_RAW[chainId]?.nonfungiblePositionManager ?? null;
}

// ---------------------------------------------------------------------------
// Curve Finance per-chain SOT — Phase 34 Plan 34-01.
// ---------------------------------------------------------------------------
//
// Sibling sub-table (NOT a widening of `ContractsForChain`) per Phase 28/29/30/31/32/33
// precedent. Curve ships a curated registry of 11 pools on Ethereum mainnet:
//   - 1 legacy stETH/ETH pool (separate LP-token ERC-20)
//   - 10 stable_ng plain pools (lpToken === pool.address for all stable_ng pools)
//
// Coverage at v2.4: stETH/ETH legacy pool + top-10 stable_ng plain pools by TVL
// on Ethereum (2026-05-26 Curve API snapshot). Multi-chain Curve deferred to v2.4.x.
//
// Provenance (research date 2026-05-26 — Curve API live snapshot):
//   - api.curve.finance/v1/getPools/ethereum/factory-stable-ng (stable_ng top-10)
//   - api.curve.finance/v1/getPools/ethereum/main (legacy stETH/ETH)
// All addresses cross-verified. coinDecimals verified against on-chain token.decimals()
// snapshot; T-CURVE-REGISTRY-DECIMALS-1 regression anchors literal-vs-literal.
//
// Per-pool `lpToken` discipline:
//   - stable_ng: lpToken === pool.address (pool IS its own LP ERC-20 — confirmed
//     from Curve API + Vyper source totalSupply/balanceOf built into pool contract)
//   - legacy stETH/ETH: lpToken = 0x06325440D014e39736583c165C2963BA99fAf14E
//     (separate ERC-20 — Pitfall 3 anchor from RESEARCH.md)
//
// Each literal `getAddress`-wrapped at the literal site so a corrupted snapshot
// — single hex digit flipped at rest — throws EIP-55 at module load.
// T-CURVE-SPENDER-DRIFT-1 cross-view: KNOWN_SPENDERS_ETHEREUM promotion is
// done via a SOT-getter loop (NOT 11 hand-written literals) so drift between
// the registry view and the spender view is impossible by construction.

/**
 * ABI version discriminator for Curve pool calldata dispatch. Phase 34 ships
 * two generations:
 *   - `"legacy"` — stETH/ETH archetype. `exchange(int128,int128,uint256,uint256)` payable.
 *   - `"stable_ng"` — factory-stable-ng archetype. `exchange(int128,int128,uint256,uint256,address)`.
 * The `abiVersion` tag is the load-bearing dispatch discriminator in
 * `prepare_curve_swap` (Plan 34-03). NEVER probe the ABI at call time.
 */
export type CurvePoolAbiVersion = "legacy" | "stable_ng";

/**
 * Per-pool Curve registry entry. The `abiVersion` tag drives calldata dispatch.
 * Every pool's `lpToken` is authoritative for `get_curve_positions` balance
 * reads — for stable_ng pools this equals `address`; for the legacy stETH pool
 * it is a separate ERC-20.
 *
 * Format-fanout-sentinel: every `address` and `lpToken` literal is
 * `getAddress()`-checksummed at the literal site. `coins` entries likewise.
 */
export interface CurvePoolEntry {
  address: Address;
  abiVersion: CurvePoolAbiVersion;
  coins: Address[];
  coinDecimals: number[];
  lpToken: Address;     // pool address === lpToken for stable_ng; separate for legacy
  displayName: string;  // human-readable label in preview blocks
}

const CURVE_POOLS_RAW: Partial<Record<ChainId, CurvePoolEntry[]>> = {
  1: [
    // ---------------------------------------------------------------------------
    // LEGACY: stETH/ETH pool — Phase 34 Plan 34-01
    // Source: Curve API (api.curve.finance/v1/getPools/ethereum/main) 2026-05-26
    // ---------------------------------------------------------------------------
    {
      address: getAddress("0xDC24316b9AE028F1497c275EB9192a3Ea0f67022"),
      abiVersion: "legacy",
      coins: [
        getAddress("0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE"), // ETH sentinel (coin 0; i=0 → ETH-in; payable)
        getAddress("0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84"), // stETH (coin 1)
      ],
      coinDecimals: [18, 18],
      // Separate LP token ERC-20 (Pitfall 3 anchor — NOT the pool address).
      lpToken: getAddress("0x06325440D014e39736583c165C2963BA99fAf14E"),
      displayName: "stETH/ETH (legacy)",
    },
    // ---------------------------------------------------------------------------
    // STABLE_NG top-10 plain pools — Phase 34 Plan 34-01
    // Source: Curve API (api.curve.finance/v1/getPools/ethereum/factory-stable-ng)
    // snapshot 2026-05-26. For all stable_ng pools: lpToken === pool.address
    // (pool IS its own LP ERC-20 — verified from Curve API isMetaPool=false).
    // ---------------------------------------------------------------------------
    // Rank 1 — Spark.fi PYUSD Reserve (~$100M TVL)
    {
      address: getAddress("0xA632D59b9B804a956BfaA9b48Af3A1b74808FC1f"),
      abiVersion: "stable_ng",
      coins: [
        getAddress("0x6c3ea9036406852006290770BEdFcAbA0e23A0e8"), // PYUSD (6 dec)
        getAddress("0xdC035D45d973E3EC169d2276DDab16f1e407384F"), // USDS (18 dec)
      ],
      coinDecimals: [6, 18],
      lpToken: getAddress("0xA632D59b9B804a956BfaA9b48Af3A1b74808FC1f"),
      displayName: "PYUSD/USDS (stable_ng)",
    },
    // Rank 2 — RLUSD/USDC (~$74M TVL)
    {
      address: getAddress("0xD001aE433f254283FeCE51d4ACcE8c53263aa186"),
      abiVersion: "stable_ng",
      coins: [
        getAddress("0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48"), // USDC (6 dec)
        getAddress("0x8292Bb45bf1Ee4d140127049757C2E0fF06317eD"), // RLUSD (18 dec)
      ],
      coinDecimals: [6, 18],
      lpToken: getAddress("0xD001aE433f254283FeCE51d4ACcE8c53263aa186"),
      displayName: "USDC/RLUSD (stable_ng)",
    },
    // Rank 3 — OETH/WETH (~$59M TVL)
    {
      address: getAddress("0xcc7d5785AD5755B6164e21495E07aDb0Ff11C2A8"),
      abiVersion: "stable_ng",
      coins: [
        getAddress("0x856c4Efb76C1D1AE02e20CEB03A2A6a08b0b8dC3"), // OETH (18 dec)
        getAddress("0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2"), // WETH (18 dec)
      ],
      coinDecimals: [18, 18],
      lpToken: getAddress("0xcc7d5785AD5755B6164e21495E07aDb0Ff11C2A8"),
      displayName: "OETH/WETH (stable_ng)",
    },
    // Rank 4 — DOLA/sUSDe (~$59M TVL)
    {
      address: getAddress("0x744793B5110f6ca9cC7CDfe1CE16677c3Eb192ef"),
      abiVersion: "stable_ng",
      coins: [
        getAddress("0x865377367054516e17014CcdED1e7d814EDC9ce4"), // DOLA (18 dec)
        getAddress("0x9D39A5DE30e57443BfF2A8307A4256c8797A3497"), // sUSDe (18 dec)
      ],
      coinDecimals: [18, 18],
      lpToken: getAddress("0x744793B5110f6ca9cC7CDfe1CE16677c3Eb192ef"),
      displayName: "DOLA/sUSDe (stable_ng)",
    },
    // Rank 5 — FRAXUSDe (~$55M TVL)
    {
      address: getAddress("0x5dc1BF6f1e983C0b21EfB003c105133736fA0743"),
      abiVersion: "stable_ng",
      coins: [
        getAddress("0x853d955aCEf822Db058eb8505911ED77F175b99e"), // FRAX (18 dec)
        getAddress("0x4c9EDD5852cd905f086C759E8383e09bff1E68B3"), // USDe (18 dec)
      ],
      coinDecimals: [18, 18],
      lpToken: getAddress("0x5dc1BF6f1e983C0b21EfB003c105133736fA0743"),
      displayName: "FRAX/USDe (stable_ng)",
    },
    // Rank 6 — PayPool PYUSD/USDC (~$51M TVL)
    {
      address: getAddress("0x383E6b4437b59fff47B619CBA855CA29342A8559"),
      abiVersion: "stable_ng",
      coins: [
        getAddress("0x6c3ea9036406852006290770BEdFcAbA0e23A0e8"), // PYUSD (6 dec)
        getAddress("0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48"), // USDC (6 dec)
      ],
      coinDecimals: [6, 6],
      lpToken: getAddress("0x383E6b4437b59fff47B619CBA855CA29342A8559"),
      displayName: "PYUSD/USDC (stable_ng)",
    },
    // Rank 7 — Spark.fi USDT Reserve (sUSDS/USDT) (~$50M TVL)
    {
      address: getAddress("0x00836Fe54625BE242BcFA286207795405ca4fD10"),
      abiVersion: "stable_ng",
      coins: [
        getAddress("0xa3931d71877C0E7a3148CB7Eb4463524FEc27fbD"), // sUSDS (18 dec)
        getAddress("0xdAC17F958D2ee523a2206206994597C13D831ec7"), // USDT (6 dec)
      ],
      coinDecimals: [18, 6],
      lpToken: getAddress("0x00836Fe54625BE242BcFA286207795405ca4fD10"),
      displayName: "sUSDS/USDT (stable_ng)",
    },
    // Rank 8 — apxUSD-USDC (~$40M TVL)
    {
      address: getAddress("0xE1B96555BbecA40E583BbB41a11C68Ca4706A414"),
      abiVersion: "stable_ng",
      coins: [
        getAddress("0x98A878b1Cd98131B271883B390f68D2c90674665"), // apxUSD (18 dec)
        getAddress("0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48"), // USDC (6 dec)
      ],
      coinDecimals: [18, 6],
      lpToken: getAddress("0xE1B96555BbecA40E583BbB41a11C68Ca4706A414"),
      displayName: "apxUSD/USDC (stable_ng)",
    },
    // Rank 9 — AUSD/USDC (~$25M TVL)
    // Note: AUSD token has an unusual zero-prefixed address — valid; getAddress()
    // checksums correctly.
    {
      address: getAddress("0xE79C1C7E24755574438A26D5e062Ad2626C04662"),
      abiVersion: "stable_ng",
      coins: [
        getAddress("0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48"), // USDC (6 dec)
        getAddress("0x00000000eFE302BEAA2b3e6e1b18d08D69a9012a"), // AUSD (6 dec)
      ],
      coinDecimals: [6, 6],
      lpToken: getAddress("0xE79C1C7E24755574438A26D5e062Ad2626C04662"),
      displayName: "USDC/AUSD (stable_ng)",
    },
    // Rank 10 — crvUSD/frxUSD (~$18M TVL)
    {
      address: getAddress("0x13e12BB0E6A2f1A3d6901a59a9d585e89A6243e1"),
      abiVersion: "stable_ng",
      coins: [
        getAddress("0xCAcd6fd266aF91b8AeD52aCCc382b4e165586E29"), // frxUSD (18 dec)
        getAddress("0xf939E0A03FB07F59A73314E73794Be0E57ac1b4E"), // crvUSD (18 dec)
      ],
      coinDecimals: [18, 18],
      lpToken: getAddress("0x13e12BB0E6A2f1A3d6901a59a9d585e89A6243e1"),
      displayName: "frxUSD/crvUSD (stable_ng)",
    },
  ],
};

/**
 * Get every Curve pool registered on `chainId`. Returns `[]` (NOT undefined /
 * throw) for chains absent from `CURVE_POOLS_RAW` — Phase 34 ships Ethereum
 * (chainId=1) only; other chains return empty by construction. Consumed by:
 *   - Plan 34-01 canonical-dispatch Curve arm (pool addresses → allowlist).
 *   - Plan 34-02 `get_curve_positions` (LP-balance multicall fan-out).
 *   - Plan 34-03 `prepare_curve_swap` / `prepare_curve_add_liquidity` (pool lookup).
 */
export function getAllCurvePoolsForChain(chainId: ChainId): CurvePoolEntry[] {
  const row = CURVE_POOLS_RAW[chainId];
  if (!row) return [];
  return [...row]; // defensive copy
}

/**
 * Get a specific Curve pool by its address on `chainId`. Applies `getAddress()`
 * normalization before equality check so unchecksummed / lowercase input matches.
 * Returns `undefined` when the address is not in the curated registry (the caller
 * should refuse with `INVALID_INPUT + "pool not in registry"` per Plan 34-03).
 */
export function getCurvePoolByAddress(
  chainId: ChainId,
  poolAddress: Address,
): CurvePoolEntry | undefined {
  return CURVE_POOLS_RAW[chainId]?.find(
    (p) => p.address === getAddress(poolAddress),
  );
}

// ---------------------------------------------------------------------------
// Safe (Gnosis) per-chain SOT — Phase 36 Plan 36-01.
// ---------------------------------------------------------------------------
//
// Sibling sub-table per Phase 28/29/30/31/32/33/34 precedent. Safe ships FOUR
// singleton variants in active production use (RESEARCH § Pitfall 2 + § lines
// 870-886): v1.3.0-L1, v1.3.0-L2, v1.4.1-L1, v1.4.1-L2. The L2 variants
// (GnosisSafeL2 / SafeL2 — emit per-tx events for L2 indexers) dominate on
// Polygon / Arbitrum / Base / Optimism; the L1 variants dominate on Ethereum
// mainnet. Both must be allowlisted (canonical-dispatch arm at Plan 36-01
// Task 3) because the Safe UI silently creates L2 Safes on L2 chains and
// users post-2022 on those chains are likely on the L2 variant.
//
// Provenance (research date 2026-05-27 — RESEARCH § lines 870-886, verbatim
// from `safe-deployments@main` JSON files via raw.githubusercontent.com):
//   - v1.3.0 — github.com/safe-global/safe-deployments@main/src/assets/v1.3.0/*.json
//   - v1.4.1 — github.com/safe-global/safe-deployments@main/src/assets/v1.4.1/*.json
// Safe-deployments treats canonical-across-eip155: the SAME singleton +
// proxyfactory + multisend addresses ship on all 5 supported EVM chains
// (CREATE2 deterministic addressing + single deployer governance).
//
// Cross-chain canonical lock: the SAFE_CANONICAL literal object is referenced
// by every chainId entry in SAFE_CONTRACTS_RAW. Property test
// `T-SAFE-CANONICAL-ACROSS-EIP155` asserts deep equality across the 5 chains.
//
// Each literal `getAddress`-wrapped at the literal site so a corrupted snapshot
// — single hex digit flipped at rest — throws EIP-55 at module load (format-
// fanout-sentinel discipline).

/**
 * Per-chain Safe contract registry. Surfaces FOUR singleton variants
 * (v1.3.0-L1, v1.3.0-L2, v1.4.1-L1, v1.4.1-L2) plus per-role address pairs
 * for v1.3.0 / v1.4.1 (proxyFactory, multiSend, multiSendCallOnly,
 * signMessageLib, compatibilityFallbackHandler). Phase 36 ships the read-side
 * foundation; Phase 37 consumes for prepare_safe_tx_propose / approve /
 * execute; Phase 38 consumes for enableModule hard-trigger detection.
 *
 * NOTE: `multiSendCallOnly` is the safer of the two MultiSend variants — it
 * refuses `delegatecall` operations in the batched payload. Phase 37 routes
 * batched ops through it by default; Phase 38 surfaces a hard-trigger warning
 * when a SafeTx targets `multiSend` (non-CallOnly) with `operation=1`.
 */
export interface SafeContracts {
  /** Up to 4 singleton variants. RESEARCH § Pitfall 2. */
  singletons: {
    v130L1: Address;
    v130L2: Address;
    v141L1: Address;
    v141L2: Address;
  };
  proxyFactoryV130: Address;
  proxyFactoryV141: Address;
  multiSendV130: Address;
  multiSendV141: Address;
  multiSendCallOnlyV130: Address;
  multiSendCallOnlyV141: Address;
  signMessageLibV130: Address;
  signMessageLibV141: Address;
  compatibilityFallbackHandlerV130: Address;
  compatibilityFallbackHandlerV141: Address;
}

/**
 * Canonical Safe deployment address set. The same object literal is referenced
 * by every supported chain in SAFE_CONTRACTS_RAW (canonical-across-eip155 per
 * safe-deployments). Future deviation (a chain with non-canonical addresses)
 * would require a per-chain literal — Phase 36's 5 supported chains all share
 * the canonical set, verified 2026-05-27.
 */
const SAFE_CANONICAL: SafeContracts = {
  singletons: {
    v130L1: getAddress("0xd9Db270c1B5E3Bd161E8c8503c55cEABeE709552"),
    v130L2: getAddress("0x3E5c63644E683549055b9Be8653de26E0B4CD36E"),
    v141L1: getAddress("0x41675C099F32341bf84BFc5382aF534df5C7461a"),
    v141L2: getAddress("0x29fcB43b46531BcA003ddC8FCB67FFE91900C762"),
  },
  proxyFactoryV130: getAddress("0xa6B71E26C5e0845f74c812102Ca7114b6a896AB2"),
  proxyFactoryV141: getAddress("0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67"),
  multiSendV130: getAddress("0xA238CBeb142c10Ef7Ad8442C6D1f9E89e07e7761"),
  multiSendV141: getAddress("0x38869bf66a61cF6bDB996A6aE40D5853Fd43B526"),
  multiSendCallOnlyV130: getAddress("0x40A2aCCbd92BCA938b02010E17A5b8929b49130D"),
  multiSendCallOnlyV141: getAddress("0x9641d764fc13c8B624c04430C7356C1C7C8102e2"),
  signMessageLibV130: getAddress("0xA65387F16B013cf2Af4605Ad8aA5ec25a2cbA3a2"),
  signMessageLibV141: getAddress("0xd53cd0aB83D845Ac265BE939c57F53AD838012c9"),
  compatibilityFallbackHandlerV130: getAddress("0xf48f2B2d2a534e402487b3ee7C18c33Aec0Fe5e4"),
  compatibilityFallbackHandlerV141: getAddress("0xfd0732Dc9E303f09fCEf3a7388Ad10A83459Ec99"),
};

/**
 * Per-chain Safe contracts. All 5 supported chains share the canonical address
 * set per `safe-deployments` (CREATE2 deterministic + single deployer
 * governance). Cross-chain byte-identity asserted in
 * test/config-contracts.test.ts T-SAFE-CANONICAL-ACROSS-EIP155.
 */
const SAFE_CONTRACTS_RAW: Partial<Record<ChainId, SafeContracts>> = {
  1: SAFE_CANONICAL,
  10: SAFE_CANONICAL,
  137: SAFE_CANONICAL,
  8453: SAFE_CANONICAL,
  42161: SAFE_CANONICAL,
};

/**
 * Returns all configured Safe Singleton addresses (up to 4 variants) for the
 * given chain. Returns `[]` for chains without a SafeContracts SOT entry.
 *
 * Consumed by `src/security/canonical-dispatch.ts` (Plan 36-01 Task 3) — every
 * variant is spread into the per-chain allowlist Set so Phase 37+ prepare-flow
 * dispatches resolve `ok` regardless of which Singleton variant the user's
 * Safe was deployed at.
 *
 * Property tested (T-SAFE-SINGLETON-DISPATCH-COVERAGE-1):
 *   `getSafeSingletonAddresses(chainId).every(a =>
 *      CANONICAL_DISPATCH_TARGETS[chainId].has(a))`
 */
export function getSafeSingletonAddresses(chainId: ChainId): Address[] {
  const c = SAFE_CONTRACTS_RAW[chainId];
  if (!c) return [];
  return [
    c.singletons.v130L1,
    c.singletons.v130L2,
    c.singletons.v141L1,
    c.singletons.v141L2,
  ];
}

/**
 * Returns the Safe ProxyFactory addresses (v1.3.0 + v1.4.1) for the given
 * chain. Returns `[]` for chains without a SafeContracts SOT entry. Forward-
 * compat for Phase 37+ — ProxyFactory dispatch is out of scope at Phase 36
 * (Safe creation via ProxyFactory deferred to v3.x; users create Safes via
 * the Safe UI per CONTEXT.md deferred-ideas section).
 */
export function getSafeProxyFactoryAddresses(chainId: ChainId): Address[] {
  const c = SAFE_CONTRACTS_RAW[chainId];
  if (!c) return [];
  return [c.proxyFactoryV130, c.proxyFactoryV141];
}

/**
 * Returns the Safe MultiSend addresses (v1.3.0 + v1.4.1) for the given chain.
 * Forward-compat for Phase 37+ batched ops + Phase 38 hard-trigger detection
 * (multiSend with `operation=1` is the delegatecall surface).
 */
export function getSafeMultiSendAddresses(chainId: ChainId): Address[] {
  const c = SAFE_CONTRACTS_RAW[chainId];
  if (!c) return [];
  return [c.multiSendV130, c.multiSendV141];
}

/**
 * Returns the Safe MultiSendCallOnly addresses (v1.3.0 + v1.4.1) for the given
 * chain. The CallOnly variant refuses delegatecall in batched payloads —
 * the safer routing target for Phase 37's prepare_safe_tx_propose.
 */
export function getSafeMultiSendCallOnlyAddresses(chainId: ChainId): Address[] {
  const c = SAFE_CONTRACTS_RAW[chainId];
  if (!c) return [];
  return [c.multiSendCallOnlyV130, c.multiSendCallOnlyV141];
}

/**
 * Returns the Safe SignMessageLib addresses (v1.3.0 + v1.4.1) for the given
 * chain. Forward-compat — used by Safe's EIP-1271 message signing flow,
 * out of scope at Phase 36.
 */
export function getSafeSignMessageLibAddresses(chainId: ChainId): Address[] {
  const c = SAFE_CONTRACTS_RAW[chainId];
  if (!c) return [];
  return [c.signMessageLibV130, c.signMessageLibV141];
}

/**
 * Returns the Safe CompatibilityFallbackHandler addresses (v1.3.0 + v1.4.1)
 * for the given chain. Forward-compat — used by Safe's fallback-handler
 * routing for unknown method selectors.
 */
export function getSafeCompatibilityFallbackHandlerAddresses(
  chainId: ChainId,
): Address[] {
  const c = SAFE_CONTRACTS_RAW[chainId];
  if (!c) return [];
  return [
    c.compatibilityFallbackHandlerV130,
    c.compatibilityFallbackHandlerV141,
  ];
}

// ---------------------------------------------------------------------------
// Known-spender table — PREP-30 surface for approval-class DECODED ARGS.
// ---------------------------------------------------------------------------

/**
 * A curated row in the known-spender table. The `address` is the on-chain
 * contract that receives approval; the `label` is the verbatim text surfaced
 * in preview_send's DECODED ARGS block; the `source` is a citation URL for
 * the regression test cross-check.
 *
 * Format-fanout-sentinel: every `address` is `getAddress`-checksummed at the
 * literal site so a corrupted snapshot is caught at module load — same guard
 * as the WETH address above + src/tokens/registry.ts.
 */
export interface KnownSpender {
  address: Address;
  label: string;
  source: string;
}

/**
 * 11 seeded entries from Plan 06-03 research § Topic 7. Each address re-
 * checksummed at module load. Aave V3 Pool sits at row 0 (alphabetical-by-
 * label). The row count anchor in the regression test asserts `>= 11` so
 * future additions (Phase 7+ bridge / DEX / lending integrations) don't
 * force test churn. Order is alphabetical-by-label for readability.
 */
export const KNOWN_SPENDERS_ETHEREUM: readonly KnownSpender[] = [
  {
    address: getAddress("0x87870bca3f3fd6335c3f4ce8392d69350b4fa4e2"),
    label: "Aave V3 Pool",
    source: "https://aave.com/docs/resources/addresses",
  },
  // Compound V3 Ethereum Comets — Phase 28 Plan 28-01. Six rows
  // alphabetical-by-label (cUSDCv3 / cUSDSv3 / cUSDTv3 / cWBTCv3 / cWETHv3 /
  // cwstETHv3). Each `address` references the SOT getter so the two views are
  // byte-identical by construction; the cross-view consistency regression
  // (test/config-contracts.test.ts T-COMPOUND-COMET-ADDR-INLINE-1) re-asserts
  // it. The `!` non-null assertion is safe — `getCompoundCometAddress(1, …)`
  // is total over `CompoundCometBase` for chainId=1 by construction.
  {
    address: getCompoundCometAddress(1, "USDC")!,
    label: "Compound V3 cUSDCv3",
    source: "https://docs.compound.finance/#networks",
  },
  {
    address: getCompoundCometAddress(1, "USDS")!,
    label: "Compound V3 cUSDSv3",
    source: "https://docs.compound.finance/#networks",
  },
  {
    address: getCompoundCometAddress(1, "USDT")!,
    label: "Compound V3 cUSDTv3",
    source: "https://docs.compound.finance/#networks",
  },
  {
    address: getCompoundCometAddress(1, "WBTC")!,
    label: "Compound V3 cWBTCv3",
    source: "https://docs.compound.finance/#networks",
  },
  {
    address: getCompoundCometAddress(1, "WETH")!,
    label: "Compound V3 cWETHv3",
    source: "https://docs.compound.finance/#networks",
  },
  {
    address: getCompoundCometAddress(1, "wstETH")!,
    label: "Compound V3 cwstETHv3",
    source: "https://docs.compound.finance/#networks",
  },
  {
    address: getAddress("0x9008D19f58AAbD9eD0D60971565AA8510560ab41"),
    label: "CowSwap GPv2Settlement",
    source: "https://etherscan.io/address/0x9008D19f58AAbD9eD0D60971565AA8510560ab41",
  },
  {
    address: getAddress("0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE"),
    label: "Li.Fi Diamond",
    source: "https://etherscan.io/address/0x1231deb6f5749ef6ce6943a275a1d3e7486f4eae",
  },
  // Morpho Blue — Phase 29 Plan 29-01. Single singleton contract per chain
  // (no per-market inner record — unlike Compound V3's 6-Comet table). The
  // `!` non-null assertion is safe: `MORPHO_BLUE_RAW[1]` is populated at
  // module load. T-29-01-T-FROZEN cross-view consistency anchor — drift
  // between this row and `getMorphoBlueAddress(1)` fails the
  // test/config-contracts.test.ts regression.
  {
    address: getMorphoBlueAddress(1)!,
    label: "Morpho Blue",
    source: "https://docs.morpho.org/addresses",
  },
  // Lido — Phase 30 Plan 30-01. Two spender entries for the approval pre-flight
  // gates (D-05): wstETH spender for `prepare_lido_wrap` (stETH → wstETH) and
  // WithdrawalQueueERC721 spender for `prepare_lido_unstake` (stETH → NFT receipt).
  // Both `address` fields delegate to the SOT getters so T-LIDO-SPENDER-DRIFT-1
  // cross-view byte-identity is enforced by construction. The `!` non-null
  // assertion is safe because `LIDO_RAW[1]` is populated at module load.
  {
    address: getLidoWstethAddress(1)!,
    label: "Lido wstETH (for stETH wrap)",
    source: "https://docs.lido.fi/deployed-contracts/",
  },
  {
    address: getLidoWithdrawalQueueAddress(1)!,
    label: "Lido WithdrawalQueueERC721 (for stETH unstake)",
    source: "https://docs.lido.fi/deployed-contracts/",
  },
  // EigenLayer + Rocket Pool — Phase 31 Plan 31-01. Three additive rows: the
  // EigenLayer StrategyManager is the LST approval target for
  // prepare_eigenlayer_deposit (per-LST users approve StrategyManager to
  // transferFrom their LST balance — D-05 pre-flight). The two Rocket Pool
  // rows are informational labels for preview_send DECODED ARGS coverage:
  // the stake call to RocketDepositPool is value-bearing (no approval) but
  // the row is included for symmetry; the rETH row tags the burn target.
  // All three `address` fields delegate to SOT getters so T-EIGENLAYER-SPENDER-
  // DRIFT-1 + T-ROCKETPOOL-SPENDER-DRIFT-1 cross-view byte-identity is
  // enforced by construction. The `!` non-null assertion is safe because
  // EIGENLAYER_RAW[1] and ROCKETPOOL_RAW[1] are both populated at module load.
  {
    address: getEigenLayerStrategyManagerAddress(1)!,
    label: "EigenLayer StrategyManager",
    source: "https://github.com/Layr-Labs/eigenlayer-contracts",
  },
  {
    address: getRocketPoolDepositPoolAddress(1)!,
    label: "Rocket Pool RocketDepositPool (stake — value-bearing)",
    source: "https://docs.rocketpool.net/",
  },
  {
    address: getRocketPoolRethAddress(1)!,
    label: "Rocket Pool rETH token (burn target)",
    source: "https://docs.rocketpool.net/",
  },
  {
    address: getAddress("0x111111125421cA6dc452d289314280a0F8842A65"),
    label: "1inch Aggregation Router V6",
    source: "https://portal.1inch.dev",
  },
  {
    address: getAddress("0x1E0049783F008A0085193E00003D00cd54003c71"),
    label: "OpenSea Conduit",
    source: "https://x.com/opensea_support/status/1540343956738670592",
  },
  {
    address: getAddress("0x00000000006c3852cbEf3e08E8dF289169EdE581"),
    label: "OpenSea Seaport 1.5",
    source: "https://docs.opensea.io/docs/seaport",
  },
  {
    address: getAddress("0x000000000022D473030F116dDEE9F6B43aC78BA3"),
    label: "Uniswap Permit2",
    source: "https://github.com/Uniswap/permit2",
  },
  {
    address: getAddress("0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D"),
    label: "Uniswap V2 Router 02",
    source: "https://docs.uniswap.org/contracts/v2/reference/smart-contracts/v2-deployments",
  },
  {
    address: getAddress("0xE592427A0AEce92De3Edee1F18E0157C05861564"),
    label: "Uniswap V3 SwapRouter",
    source: "https://docs.uniswap.org/contracts/v3/reference/deployments/ethereum-deployments",
  },
  // Address delegated to SOT getter per Phase 32 D-13a; promoted from inline
  // literal to break the drift seam between this view and
  // src/security/canonical-dispatch.ts. Cross-checked by T-UNISWAP-V3-SPENDER-DRIFT-1.
  {
    address: getUniswapV3SwapRouter02Address(1)!,
    label: "Uniswap V3 SwapRouter02",
    source: "https://docs.uniswap.org",
  },
  // Phase 33 Plan 33-01 — NPM promotion to KNOWN_SPENDERS_ETHEREUM per RESEARCH
  // § Topic 8 (CONFIRMED: NPM IS a spender for mint/increase via internal
  // TransferHelper.safeTransferFrom on BOTH token0 AND token1). Address
  // delegated to SOT getter for cross-view byte-identity
  // (T-UNISWAP-V3-NPM-SPENDER-DRIFT-1). The SOT slot is pre-populated at Phase
  // 32 D-01; Phase 33 only adds this consumer row.
  {
    address: getUniswapV3NonfungiblePositionManagerAddress(1)!,
    label: "Uniswap V3 NonfungiblePositionManager",
    source: "https://docs.uniswap.org/contracts/v3/reference/periphery/NonfungiblePositionManager",
  },
  {
    address: getAddress("0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2"),
    label: "WETH9 (canonical wETH)",
    source: "src/tools/get_portfolio_summary.ts:17 (consolidated in Plan 06-04)",
  },
  // Phase 34 Plan 34-01 — Curve pool KNOWN_SPENDERS promotion.
  // Each Curve pool address is a spender target: users approve the pool
  // contract for ERC-20 `transferFrom` before `exchange` / `add_liquidity`.
  //
  // PROMOTION STRATEGY: SOT-getter loop (D-13a pattern from Phase 32) — NOT
  // 11 hand-written literal objects. The loop sources every address from
  // `getAllCurvePoolsForChain(1)` so the spender view is byte-identical to the
  // registry view by construction. T-CURVE-SPENDER-DRIFT-1 regression anchors
  // this cross-view invariant.
  //
  // The `!` non-null assertion on `.address` is safe: `getAllCurvePoolsForChain(1)`
  // returns a non-empty typed array (11 entries populated above). The SOT is
  // established before KNOWN_SPENDERS_ETHEREUM is initialized — module-scope
  // ordering is top-to-bottom in this file.
  ...getAllCurvePoolsForChain(1).map((pool) => ({
    address: pool.address,
    label: `Curve ${pool.displayName}`,
    source: "https://curve.finance",
  })),
];

/**
 * Case-insensitive known-spender lookup. The agent may pass a lowercase or
 * mixed-case address; `getAddress` normalizes to EIP-55 checksum FIRST, then
 * the array `.find` does strict-equality against the curated table (which
 * stores checksummed addresses). Returns the matched `KnownSpender` row or
 * `undefined` for unknown spenders — the caller (preview_send via
 * buildDecodedArgsBlock) renders the
 * `(unknown spender — no prior interaction recorded)` fallback.
 *
 * T-SPENDER-CASE-1 mitigation: bypassing `getAddress` here would cause
 * silent (unknown spender) labels for known contracts. The
 * test/config-contracts.test.ts case-insensitivity assertion is the
 * regression anchor.
 */
export function lookupSpender(spender: Address): KnownSpender | undefined {
  const checksummed = getAddress(spender);
  return KNOWN_SPENDERS_ETHEREUM.find((s) => s.address === checksummed);
}

/**
 * ESM spy-affordance per CLAUDE.md "ESM spy-affordance indirection" convention.
 * `src/signing/blocks.ts` imports `_contracts` and calls
 * `_contracts.lookupSpender(...)` so tests can `vi.spyOn(_contracts, ...)` to
 * intercept the lookup without monkey-patching the production import path.
 */
export const _contracts = { lookupSpender };

// ---------------------------------------------------------------------------
// KNOWN_SPENDERS_TRON — Phase 19 Plan 19-01 (TRON-W-08).
// ---------------------------------------------------------------------------
//
// Sibling sub-table (NOT a widening of KNOWN_SPENDERS_ETHEREUM or any existing
// export). TRON addresses are base58check (T-prefixed, 34 chars) — NOT EIP-55
// checksummed 0x-prefixed. No `getAddress()` wrapping. DOA validation at module
// load via `tronUtils.address.isAddress()` (mirrors tron-top-25.ts validateEntry).
//
// Entries (D-07a + Task 0 defer-lifi outcome):
//   - SunSwap V2 Router (cross-verified: https://docs.sun.io)
//   - USDT-TRC20 contract (TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t — canonical Tether TRON)
//   - USDC-TRC20 contract (TEkxiTehnzSmSe2XqrBj4w32RUN966rdz8 — canonical Circle TRON)
//   - USDD contract (TPYmHEhy5n8TCEfYGqW2rPxsghSfzghPDn — Decentralized USD by TRON DAO)
//   - TUSD-TRC20 contract (TUpMhErZL2fhh4sVNULAbNKLokS4GjC1F4 — TrueUSD TRON)
//
// LiFi TRON facet: deferred to Phase 20 per Task 0 checkpoint:decision outcome
// (defer-lifi). Address was not verified against official deployment manifests at
// Phase 19 research time. Phase 20 adds it when TRON LiFi bridging ships.
//
// Format-fanout-sentinel: `_contractsTron.lookupTronSpender` is the only consumer
// of this table. NEVER inline TRON spender addresses in tool implementations.

import { utils as tronUtilsContracts } from "tronweb";

/**
 * A curated row in the TRON known-spender table. The `address` is the TRON
 * base58check (T-prefixed, 34 chars) contract that receives approval; the
 * `label` is the verbatim text surfaced in preview_send's DECODED ARGS block;
 * the `source` is a citation URL for the regression test cross-check.
 *
 * NOTE: Unlike `KnownSpender` (EVM), there is NO `getAddress()` checksumming —
 * TRON addresses are base58check, not EIP-55. Addresses validated at module
 * load via `tronUtilsContracts.address.isAddress()`.
 */
export interface KnownSpenderTron {
  /** TRON base58check address (T-prefixed, 34 chars). */
  address: string;
  /** Human-readable label surfaced in preview_send DECODED ARGS. */
  label: string;
  /** Citation URL for regression test cross-check. */
  source: string;
}

/**
 * Curated TRON known-spender table. Phase 19 Plan 19-01 — 5 entries.
 * Entry[0]: SunSwap V2 Router (the canonical TRON DEX for Phase 20+ LiFi flows).
 * Entries[1..4]: 4 canonical TRC-20 stablecoin token contracts — the same
 * 4-entry set that `canonical-dispatch-tron.ts` allowlists for Phase 18 transfers.
 *
 * LiFi TRON facet: deferred to Phase 20 per Task 0 checkpoint:decision.
 */
export const KNOWN_SPENDERS_TRON: readonly KnownSpenderTron[] = [
  {
    address: "TKzxdSv2FZKQrEqkKVgp5DcwEXBEKMg2Ax",
    label: "SunSwap V2 Router",
    source: "https://docs.sun.io",
  },
  {
    address: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t",
    label: "USDT-TRC20 (Tether USD)",
    source: "https://tronscan.org/#/token20/TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t",
  },
  {
    address: "TEkxiTehnzSmSe2XqrBj4w32RUN966rdz8",
    label: "USDC-TRC20 (USD Coin)",
    source: "https://tronscan.org/#/token20/TEkxiTehnzSmSe2XqrBj4w32RUN966rdz8",
  },
  {
    address: "TPYmHEhy5n8TCEfYGqW2rPxsghSfzghPDn",
    label: "USDD (Decentralized USD)",
    source: "https://tronscan.org/#/token20/TPYmHEhy5n8TCEfYGqW2rPxsghSfzghPDn",
  },
  {
    address: "TUpMhErZL2fhh4sVNULAbNKLokS4GjC1F4",
    label: "TUSD-TRC20 (TrueUSD)",
    source: "https://tronscan.org/#/token20/TUpMhErZL2fhh4sVNULAbNKLokS4GjC1F4",
  },
];

// DOA validation at module load — mirrors tron-top-25.ts validateEntry pattern.
// Catches typos / corrupted snapshots at server startup rather than at runtime.
for (const entry of KNOWN_SPENDERS_TRON) {
  if (!tronUtilsContracts.address.isAddress(entry.address)) {
    throw new Error(
      `[contracts.ts] KNOWN_SPENDERS_TRON: invalid TRON base58check address: "${entry.address}" (label: "${entry.label}"). ` +
        "Fix the address or remove the entry.",
    );
  }
}

/**
 * Exact-match TRON known-spender lookup by base58check address.
 * TRON base58check addresses are case-sensitive (unlike EIP-55 EVM addresses).
 * NO `getAddress()`-style normalization — `"TKzxdSv2FZKQrEqkKVgp5DcwEXBEKMg2Ax".toLowerCase()`
 * is NOT in the table, so callers MUST pass the exact base58check form.
 *
 * Returns the matched `KnownSpenderTron` row or `undefined` for unknown
 * spenders — the caller renders the `(unknown spender — no prior interaction
 * recorded)` fallback.
 */
export function lookupTronSpender(spender: string): KnownSpenderTron | undefined {
  return KNOWN_SPENDERS_TRON.find((s) => s.address === spender);
}

/**
 * ESM spy-affordance per CLAUDE.md "ESM spy-affordance indirection" convention.
 * `prepare_tron_token_approve.ts` (Plan 19-01) imports `_contractsTron` and
 * calls `_contractsTron.lookupTronSpender(...)` so tests can
 * `vi.spyOn(_contractsTron, "lookupTronSpender")` to intercept the lookup
 * without monkey-patching the production import path.
 */
export const _contractsTron = { lookupTronSpender };

// ---------------------------------------------------------------------------
// Solana lending SOT — Phase 13 Plan 13-01 (D-05, SOL-W-10).
// ---------------------------------------------------------------------------
//
// Sibling sub-table (NOT a widening of the EVM `ContractsForChain` / `ChainId`
// union) per the Compound/Morpho/Lido/EigenLayer precedent above. Keys on the
// literal `"solana"` (`Record<"solana", SolanaContracts>`) and stores RAW
// base58 strings — NO `getAddress` / EIP-55 normalization (that is EVM-only;
// Solana program IDs and market/group anchors are base58, case-sensitive).
//
// Scope: Phase 13 ships the MarginFi + Kamino lending program IDs + the
// MarginFi production group + the Kamino MAIN-market lending-market pubkey.
// MarginFi (plans 13-01..03) consumes `marginfiProgram` / `marginfiGroup` /
// `deriveMarginfiAccountPda`; the Kamino getters + PDA helpers
// (`kaminoLendProgram` / `kaminoMainMarket` / `deriveKaminoObligationPda` /
// `deriveKaminoUserMetadataPda`) are SEEDED here for the later Kamino batch
// (plans 13-04..06) so that batch reads the existing SOT without re-touching
// this file (conflict-graph hot spot — serialized 13 → 14 → 15 → 16).
//
// Verified addresses (plan-gate 2026-06-03, from the installed-SDK probe —
// 13-RESEARCH § Contracts SOT + § rnd VERDICT TABLE V5/V7):
//   marginfiProgram   MFv2hWf31Z9kbCa1snEPYctwafyhdvnV7FZnsebVacA  [SDK configs + IDL address]
//   marginfiGroup     4qp6Fx6tnZkY5Wropq9wUYgtFxXKwE6viZxFHg3rdAG8 [SDK configs — production group]
//   kaminoLendProgram KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD   [SDK @codegen/programId — production, NOT the SLendK… staging variant]
//   kaminoMainMarket  7u3HeHxYDLhnCoErrtycNokbQYbWGzLs6JSDqGAv5PfF  [Q1 RESOLVED — live Kamino market API isPrimary:true + klend-sdk README]
//
// Format-fanout-sentinel: each of these four base58 literals lives HERE
// exactly once. test/config-contracts.test.ts asserts
// `grep -rn "MFv2hWf31\|KLend2g3\|7u3HeHxY" src/` outside this file (comment
// lines filtered) is empty — mirror of the Compound/Morpho address-inline
// regression (SOL-W-10).

/**
 * Solana lending program IDs + market/group anchors. base58 strings — NO
 * EIP-55 normalization (Solana is not EVM). The TYPE is what makes this a SOT:
 * `getMarginfiProgramId()` is the only sanctioned read path; a tool that
 * inlines a base58 literal trips the no-inline grep sentinel.
 */
export interface SolanaContracts {
  /** MarginFi v2 program ID. */
  marginfiProgram: string;
  /** MarginFi production group (the marginfi_group account every lending ix references). */
  marginfiGroup: string;
  /** Kamino klend production program ID (NOT the SLendK… staging variant). */
  kaminoLendProgram: string;
  /** Kamino MAIN lending-market pubkey (Q1 resolved — isPrimary market). */
  kaminoMainMarket: string;
}

const SOLANA_CONTRACTS_RAW: Record<"solana", SolanaContracts> = {
  solana: {
    marginfiProgram: "MFv2hWf31Z9kbCa1snEPYctwafyhdvnV7FZnsebVacA",
    marginfiGroup: "4qp6Fx6tnZkY5Wropq9wUYgtFxXKwE6viZxFHg3rdAG8",
    kaminoLendProgram: "KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD",
    kaminoMainMarket: "7u3HeHxYDLhnCoErrtycNokbQYbWGzLs6JSDqGAv5PfF",
  },
};

/**
 * Get the MarginFi v2 program ID (base58). Consumed by
 * `src/protocols/marginfi.ts` (hand-encoded ix `programId`),
 * `src/chains/solana/marginfi.ts` (account-owner check), and the
 * `canonical-dispatch-solana` allowlist (D-06).
 */
export function getMarginfiProgramId(): string {
  return SOLANA_CONTRACTS_RAW.solana.marginfiProgram;
}

/**
 * Get the MarginFi production group (base58). Every `lending_account_*` ix
 * carries this as account[0]; the account-init PDA seed references it too.
 */
export function getMarginfiGroup(): string {
  return SOLANA_CONTRACTS_RAW.solana.marginfiGroup;
}

/**
 * Get the Kamino klend production program ID (base58). Seeded for the Kamino
 * batch (13-04..06) + the dispatch allowlist (D-06).
 */
export function getKaminoLendProgram(): string {
  return SOLANA_CONTRACTS_RAW.solana.kaminoLendProgram;
}

/**
 * Get the Kamino MAIN lending-market pubkey (base58). Seeded for the Kamino
 * batch (13-04..06). Q1 RESOLVED at plan gate (isPrimary market). Re-verify
 * against the live Kamino market API if the deployment changes.
 */
export function getKaminoMainMarket(): string {
  return SOLANA_CONTRACTS_RAW.solana.kaminoMainMarket;
}

// PDA-derivation helpers (D-05). Each returns a base58 string and is
// byte-deterministic for fixed inputs. The MarginFi helper uses the IDL-pinned
// seeds verbatim (NOT guessed — Don't-Hand-Roll); the Kamino helpers use the
// SDK's documented seed constants. Synchronous web3.js-v1 `PublicKey`
// derivation (the Kamino kit seed helpers are async/Address-typed — the
// documented seeds are reproduced here for the v1 SOT surface).

/** 2-byte little-endian encode of a u16 (MarginFi account_index / third_party_id seeds). */
function u16le(n: number): Buffer {
  const b = Buffer.alloc(2);
  b.writeUInt16LE(n, 0);
  return b;
}

/**
 * Derive the MarginfiAccount PDA for `(authority, accountIndex)` under the
 * production group. Seeds (IDL `marginfi_account_initialize_pda`, VERIFIED from
 * marginfi_0.1.8.json):
 *   ["marginfi_account", marginfiGroup, authority, account_index(u16 LE),
 *    third_party_id.unwrap_or(0)(u16 LE)]
 * `accountIndex` allows multiple MarginFi accounts per authority (default 0).
 * Returns the base58 PDA. Consumed by 13-02's PDA-presence read + 13-03's
 * D-03 gate + the init ix account list.
 */
export function deriveMarginfiAccountPda(
  authority: string,
  accountIndex: number,
): string {
  const program = new PublicKey(getMarginfiProgramId());
  const group = new PublicKey(getMarginfiGroup());
  const auth = new PublicKey(authority);
  const [pda] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("marginfi_account", "utf8"),
      group.toBuffer(),
      auth.toBuffer(),
      u16le(accountIndex),
      u16le(0), // third_party_id.unwrap_or(0)
    ],
    program,
  );
  return pda.toBase58();
}

/**
 * Derive the Kamino Obligation PDA for `(market, owner)`. Standard market
 * obligation: seeds = [tag(0u8), id(0u8), owner, market, default, default]
 * under the klend program. SEEDED for the Kamino batch (13-04..06); the Kamino
 * write plan re-verifies against the klend-sdk `Obligation` PDA at consumption.
 * Returns the base58 PDA.
 */
export function deriveKaminoObligationPda(market: string, owner: string): string {
  const program = new PublicKey(getKaminoLendProgram());
  const marketPk = new PublicKey(market);
  const ownerPk = new PublicKey(owner);
  const [pda] = PublicKey.findProgramAddressSync(
    [
      Buffer.from([0]), // tag — standard obligation
      Buffer.from([0]), // id
      ownerPk.toBuffer(),
      marketPk.toBuffer(),
      PublicKey.default.toBuffer(), // seed1Account — default for the base obligation
      PublicKey.default.toBuffer(), // seed2Account
    ],
    program,
  );
  return pda.toBase58();
}

/**
 * Derive the Kamino UserMetadata PDA for `owner`. Seed (klend-sdk
 * `BASE_SEED_USER_METADATA` constant, verbatim): ["user_meta", owner] under the
 * klend program. SEEDED for the Kamino batch (13-04..06). Returns the base58 PDA.
 */
export function deriveKaminoUserMetadataPda(owner: string): string {
  const program = new PublicKey(getKaminoLendProgram());
  const ownerPk = new PublicKey(owner);
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("user_meta", "utf8"), ownerPk.toBuffer()],
    program,
  );
  return pda.toBase58();
}
