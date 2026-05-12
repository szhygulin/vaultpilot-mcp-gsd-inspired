// CAIP-10 account-ID parsing for EVM accounts.
//
// Thin wrapper around `parseAccountId` from `@walletconnect/utils`. The
// wrapper exists to (a) normalize the chainId to the numeric form viem
// uses elsewhere in the codebase (`chain.id`), and (b) refuse non-`eip155`
// namespaces explicitly — v1.x is Ethereum-only; a Solana account flowing
// through this surface is a sign that something upstream is wrong.
//
// We MUST NOT split the CAIP-10 string by hand (e.g. `caip10.slice(9)` for
// "eip155:1:"). That works for chain ID 1 only; multi-digit chain IDs
// (Polygon 137, Arbitrum 42161) break it silently. `parseAccountId` is the
// SDK-tracked source of truth.

import type { Address } from "viem";
import { parseAccountId } from "@walletconnect/utils";

/**
 * Parse a CAIP-10 EVM account identifier like `eip155:1:0xAbc...` into
 * `{ chainId: number, address: 0x-string }`.
 *
 * Throws when the chain namespace is not `eip155` — v1.x is Ethereum-only;
 * Phase 8 fans this out via a chain-registry. Until then, refuse hard so a
 * non-eip155 account doesn't silently flow through into an EVM-only
 * transaction path.
 */
export function parseEvmAccountId(caip10: string): { chainId: number; address: Address } {
  const { namespace, reference, address } = parseAccountId(caip10);
  if (namespace !== "eip155") {
    throw new Error(
      `unsupported CAIP-2 chain namespace: ${namespace} (only eip155 is supported in v1.x)`,
    );
  }
  const numericChainId = Number(reference);
  if (!Number.isInteger(numericChainId) || numericChainId <= 0) {
    throw new Error(`invalid eip155 chain reference: ${reference}`);
  }
  return { chainId: numericChainId, address: address as Address };
}
