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
  {
    address: getAddress("0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45"),
    label: "Uniswap V3 SwapRouter02",
    source: "https://docs.uniswap.org",
  },
  {
    address: getAddress("0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2"),
    label: "WETH9 (canonical wETH)",
    source: "src/tools/get_portfolio_summary.ts:17 (consolidated in Plan 06-04)",
  },
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
