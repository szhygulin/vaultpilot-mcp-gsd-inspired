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
 * Supported chain IDs. v1.x is ethereum mainnet only (PROJECT.md vertical
 * slice). Phase 8 widens this union when multi-chain lands.
 */
export type ChainId = 1;

/**
 * Per-chain canonical contract registry shape. Plan 06-03 ships `weth`
 * (consumed by Plan 06-04's prepare_weth_unwrap). Plan 07 adds `aavePool`.
 * The TYPE of the value is what makes this SOT — `getWethAddress(1)` is
 * type-safe; an unknown chain triggers a compile error rather than a
 * runtime undefined.
 */
export interface ContractsForChain {
  weth: Address;
  // Phase 7 will add: aavePool: Address;
  // Phase 7+ may add: lido, eigenLayer, ...
}

const CONTRACTS_RAW: Record<ChainId, ContractsForChain> = {
  1: {
    // Canonical mainnet WETH9. Re-checksummed at module load via
    // `getAddress` (corrupted-snapshot guard — mirror of
    // src/tokens/registry.ts). Sourced from the existing inline literal at
    // src/tools/get_portfolio_summary.ts:17; Plan 06-04 will migrate that
    // file to import `getWethAddress(1)` from here (the SOT).
    weth: getAddress("0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2"),
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
 * 11 seeded entries from research § Topic 7. Each address re-checksummed at
 * module load. The 12th candidate slot is reserved for Phase 7 (Aave V3
 * Pool gets added at lending-tool time — its row IS already here as the
 * canonical Aave V3 Pool address, but the row count anchor in the regression
 * test asserts `>= 11` so future additions don't force test churn). Order
 * is alphabetical-by-label for readability.
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
