import { createPublicClient, http, type PublicClient } from "viem";
import { mainnet } from "viem/chains";

import { getEthereumRpcUrl } from "../config/env.js";
import { log } from "../diagnostics/logger.js";

export const PUBLICNODE_ETHEREUM_RPC_URL = "https://ethereum-rpc.publicnode.com";

let cachedClient: PublicClient | undefined;
let cachedUsedFallback = false;
let warnedFallback = false;

export function getEthereumClient(): PublicClient {
  if (cachedClient) return cachedClient;

  const override = getEthereumRpcUrl();
  const url = override ?? PUBLICNODE_ETHEREUM_RPC_URL;
  cachedUsedFallback = override === undefined;

  if (cachedUsedFallback && !warnedFallback) {
    log(
      "warn",
      `ETHEREUM_RPC_URL not set — using PublicNode public RPC (${PUBLICNODE_ETHEREUM_RPC_URL}); set ETHEREUM_RPC_URL for production traffic`,
    );
    warnedFallback = true;
  }

  cachedClient = createPublicClient({
    chain: mainnet,
    transport: http(url),
  });
  return cachedClient;
}

export function isPublicNodeFallback(): boolean {
  if (!cachedClient) getEthereumClient();
  return cachedUsedFallback;
}

export function _resetEthereumClientForTesting(): void {
  cachedClient = undefined;
  cachedUsedFallback = false;
  warnedFallback = false;
}
