// COMPAT SHIM (Phase 8 Plan 08-01 — survives Plan 08-02; deleted by a
// follow-up plan once the three FROZEN/out-of-scope callers below migrate).
//
// Plan 08-02 migrated every in-scope chain-taking tool from the singleton
// `getEthereumClient()` to the per-chain `getChainClient(chainId)` factory.
// THREE callers survive:
//
//   1. `src/tools/send_transaction.ts` — FROZEN under Plan 08-02 constraints
//      (the THREE-GATE logic is byte-identical to Phase 4). The demo-mode
//      simulation `eth_call` is the only consumer; chainId=1 is correct
//      because the prepare → preview → send pipeline is single-chain per
//      handle (Layer 3 fingerprint-drift binds chainId byte-for-byte; the
//      simulation client only needs to match the handle's chain, which is
//      ALWAYS 1 in current shipped demo personas — Phase 5 lock).
//
//   2. `src/ens/resolver.ts` — ENS is Ethereum-only (research § Topic 4 line
//      327: "ENS L1 root is on mainnet; cross-chain resolution is via CCIP-Read
//      v2.x scope"). Migration would change the call site without changing the
//      effective chain.
//
//   3. `src/tools/get_portfolio_summary.ts` — cross-chain fan-out is Plan
//      08-03 scope. Plan 08-03 widens both `get_portfolio_summary` AND
//      this shim's last importer in one wave.
//
// Phase 2-7 callers + the three above keep importing from `../chains/ethereum.js`
// — the shim re-exports the Phase 2 surface byte-for-byte.

import {
  PUBLICNODE_RPC_URLS,
  _resetChainRegistryForTesting,
  getChainClient,
  isPublicNodeFallback as registryIsPublicNodeFallback,
} from "./registry.js";

export const PUBLICNODE_ETHEREUM_RPC_URL = PUBLICNODE_RPC_URLS[1];

export function getEthereumClient() {
  return getChainClient(1);
}

export function isPublicNodeFallback(): boolean {
  return registryIsPublicNodeFallback(1);
}

export function _resetEthereumClientForTesting(): void {
  _resetChainRegistryForTesting();
}
