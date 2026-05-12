import type { Address } from "viem";
import { getEnsAddress, getEnsName, normalize } from "viem/ens";

import { getEthereumClient } from "../chains/ethereum.js";

/**
 * Forward-resolve an ENS name to an address using viem's Universal Resolver.
 * Returns null when the name does not resolve (no records, expired, etc.).
 *
 * Names are normalized via ENSIP-15 (`viem.normalize`) before lookup; an
 * unnormalizable input throws — let the caller surface that as a tool error.
 */
export async function resolveEnsName(name: string): Promise<Address | null> {
  const client = getEthereumClient();
  const normalized = normalize(name);
  return client.getEnsAddress({ name: normalized });
}

/**
 * Reverse-resolve an address to its primary ENS name. Returns null when no
 * primary name is set (the common case — most addresses have none).
 *
 * Note: viem's `getEnsName` performs the forward-resolution round-trip, so a
 * non-null result has already been verified to point back at this address.
 */
export async function reverseResolveEns(address: Address): Promise<string | null> {
  const client = getEthereumClient();
  return client.getEnsName({ address });
}

// Re-export the viem actions in case downstream callers need the lower-level
// form with custom block tags or coinTypes.
export { getEnsAddress, getEnsName };
