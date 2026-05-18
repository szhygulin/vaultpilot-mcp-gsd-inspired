// ONE-WAVE COMPAT SHIM (Phase 8 Plan 08-01).
// Delete in Plan 08-02 after all callers migrate to getChainClient(chain).
//
// Phase 2's `getEthereumClient()` singleton kept all Phase 2-7 callers
// (`get_portfolio_summary`, `get_lending_positions`, `prepare_*`, etc.)
// pointed at a single PublicClient. Plan 08-01 widens the registry to
// `getChainClient(chainId)`; rather than touch every caller in one shot
// (the carve-anchor lives at Plan 08-02 driven by the `chainId: 1` literal
// errors), this file becomes a thin pass-through delegating to chainId=1.
//
// Phase 2-7 callers do NOT change — they keep importing from
// `../chains/ethereum.js`. Plan 08-02 deletes this file after threading
// the `chain` arg through every callsite.

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
