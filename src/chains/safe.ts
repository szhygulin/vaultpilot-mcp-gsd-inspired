// src/chains/safe.ts
//
// Phase 36 Plan 36-02 (SAFE-01) — Singleton state reader for v2.5 Safe multisig
// support. Mirror of `src/chains/aave-v3.ts` shape verbatim:
//   - `parseAbi` struct refs at the top of the file
//   - SOT-getter consumption (chains/registry PublicClient passed in by caller)
//   - `_safeChains` ESM spy indirection at the bottom (CLAUDE.md mandatory)
//
// Minimal ABI surface for Phase 36 reads only — Phase 37 will extend with
// `execTransaction` + `domainSeparator` + `getTransactionHash`, Phase 38 with
// `enableModule` write trigger. Phase 36 is read-only.
//
// Named-return discipline (Pitfall 10 from 36-RESEARCH.md § lines 556-564):
// every `returns (...)` clause uses NAMED parameters so viem multicall typing
// infers correctly. `getModulesPaginated(...) returns (address[] modules,
// address next)` — NOT the unnamed-tuple variant; downstream `client.multicall`
// destructuring relies on the named tuple components for type inference.
//
// SENTINEL filter discipline (Pitfall 4 from 36-RESEARCH.md § lines 496-504):
// `getModulesPaginated` returns a `next` cursor that equals `SAFE_SENTINEL_MODULES`
// (`0x0...001`) at end-of-list. We filter SENTINEL out of the module list
// defensively AND surface the `truncated`/`nextCursor` flags when `next` is not
// SENTINEL (>100-module Safes — extreme outliers).
//
// Module cap discipline (Pitfall 5 from 36-RESEARCH.md § lines 506-514): single
// `getModulesPaginated(SENTINEL, 100)` call — no recursion. >100-module Safes
// surface `truncated: true` + `nextCursor: <last seen>`. Consumers decide whether
// to issue a follow-up paginated call (out of scope at Phase 36).

import { type Address, type Hex, type PublicClient, parseAbi } from "viem";

import { type ChainId } from "../config/contracts.js";

/**
 * Safe module-list sentinel — the head AND tail of the linked-list stored in
 * the Safe Singleton's `modules` mapping. `getModulesPaginated(start, pageSize)`
 * takes SENTINEL as `start` to read from the head; returns SENTINEL as `next`
 * at end-of-list. Verbatim from Safe's `base/ModuleManager.sol`:
 *
 *   address internal constant SENTINEL_MODULES = address(0x1);
 */
export const SAFE_SENTINEL_MODULES: Address = "0x0000000000000000000000000000000000000001";

/**
 * Safe Singleton ABI fragment — 5 functions consumed at Phase 36:
 *   - `getOwners()` → owners array
 *   - `getThreshold()` → required signature count
 *   - `nonce()` → next executable safe-tx nonce
 *   - `VERSION()` → semver string (e.g. "1.4.1", "1.3.0")
 *   - `getModulesPaginated(address start, uint256 pageSize)` →
 *     (address[] modules, address next)
 *
 * Named return parameters MANDATORY per Pitfall 10 — viem multicall typing
 * infers result destructuring shape from the named components.
 *
 * Cross-verified against safe-smart-account@v1.4.1 `base/OwnerManager.sol` +
 * `base/ModuleManager.sol` (36-RESEARCH.md § lines 579-587).
 */
export const safeSingletonAbi = parseAbi([
  "function getOwners() view returns (address[])",
  "function getThreshold() view returns (uint256)",
  "function nonce() view returns (uint256)",
  "function VERSION() view returns (string)",
  "function getModulesPaginated(address start, uint256 pageSize) view returns (address[] modules, address next)",
  // Phase 37 Plan 37-01 (SAFE-05) — EIP-712 typed-data signing flow surface.
  // `domainSeparator()` is the on-chain cross-check feed for the prepare-side
  // CHECKS PERFORMED block (we re-compute the domain locally via
  // `viem.hashDomain` and assert byte-equality). `getTransactionHash(...)` is
  // surfaced for Plan 37-02 / 37-03 integration-test cross-verification of the
  // local `computeSafeTxHash` result against the on-chain canonical answer.
  "function domainSeparator() view returns (bytes32)",
  "function getTransactionHash(address to, uint256 value, bytes data, uint8 operation, uint256 safeTxGas, uint256 baseGas, uint256 gasPrice, address gasToken, address refundReceiver, uint256 _nonce) view returns (bytes32)",
]);

/**
 * Read the Singleton's owner set + threshold + nonce + VERSION via a single
 * multicall round-trip (4 contract reads → 1 RPC). `allowFailure: false`
 * because partial failure of any read invalidates the per-Safe row (the
 * caller drops the row rather than surface partial state).
 *
 * The destructured `owners` array is returned verbatim — the caller may
 * `getAddress`-wrap entries defensively at the consumer site for EIP-55
 * normalization (the upstream RPC should already return checksummed
 * addresses but the explicit wrap catches accidental lowercase leakage).
 */
export async function getOnchainSafeInfo(
  client: PublicClient,
  _chainId: ChainId,
  safe: Address,
): Promise<{ owners: readonly Address[]; threshold: bigint; nonce: bigint; version: string }> {
  const [owners, threshold, nonceVal, version] = await client.multicall({
    contracts: [
      { address: safe, abi: safeSingletonAbi, functionName: "getOwners" },
      { address: safe, abi: safeSingletonAbi, functionName: "getThreshold" },
      { address: safe, abi: safeSingletonAbi, functionName: "nonce" },
      { address: safe, abi: safeSingletonAbi, functionName: "VERSION" },
    ],
    allowFailure: false,
  });
  return { owners, threshold, nonce: nonceVal, version };
}

/**
 * Read the enabled-modules linked list via a single `getModulesPaginated`
 * call (cap-at-100 — Pitfall 5). The returned `next` cursor is SENTINEL at
 * end-of-list; non-SENTINEL signals truncation.
 *
 * SENTINEL is filtered out of the module list defensively (Pitfall 4) — even
 * if a downstream ABI quirk surfaces SENTINEL inside `modules` (shouldn't but
 * possible), the consumer-facing `modules` array never carries it.
 *
 * Case-insensitive comparison via `.toLowerCase()` — addresses from RPC are
 * checksummed but the constant is lowercase; equality must survive either.
 */
export async function getEnabledModules(
  client: PublicClient,
  _chainId: ChainId,
  safe: Address,
): Promise<{ modules: Address[]; truncated: boolean; nextCursor: Address | null }> {
  const result = await client.readContract({
    address: safe,
    abi: safeSingletonAbi,
    functionName: "getModulesPaginated",
    args: [SAFE_SENTINEL_MODULES, 100n],
  });
  const [rawModules, next] = result as unknown as readonly [readonly Address[], Address];
  // Pitfall 4 — SENTINEL never appears in the output module list.
  const modules = rawModules.filter(
    (m) => m.toLowerCase() !== SAFE_SENTINEL_MODULES.toLowerCase(),
  );
  const truncated = next.toLowerCase() !== SAFE_SENTINEL_MODULES.toLowerCase();
  return { modules, truncated, nextCursor: truncated ? next : null };
}

/**
 * Phase 37 Plan 37-01 (SAFE-05) — read the on-chain EIP-712 `domainSeparator()`
 * for the prepare-side CHECKS PERFORMED cross-verification. The local digest
 * path (`safe-tx-hash.ts::computeSafeTxHash` → `viem.hashTypedData`) is the
 * source-of-truth; this read is informational (a non-matching on-chain value
 * surfaces as a `domainSeparatorDrift` warning in the prepare response, but
 * does NOT refuse — the typed-data digest is correct by construction).
 *
 * Anti-pattern guard (RESEARCH §Anti-Patterns lines 348-350): the on-chain
 * value is NEVER substituted for the local digest input. EIP-712 mandates
 * client-side domain computation from `{chainId, verifyingContract}`.
 */
export async function getOnchainDomainSeparator(
  client: PublicClient,
  _chainId: ChainId,
  safe: Address,
): Promise<Hex> {
  return (await client.readContract({
    address: safe,
    abi: safeSingletonAbi,
    functionName: "domainSeparator",
  })) as Hex;
}

/**
 * ESM spy-affordance per CLAUDE.md "ESM spy-affordance indirection" convention.
 * Consumers (`get_safe_positions.ts`, Phase 37 `prepare_safe_tx_propose.ts`)
 * import `_safeChains` and call `_safeChains.getOnchainSafeInfo(...)` /
 * `_safeChains.getEnabledModules(...)` / `_safeChains.getOnchainDomainSeparator(...)`
 * so tests can `vi.spyOn(_safeChains, ...)` to intercept the RPC calls.
 * Added at write time — ESM named-export bindings are immutable; direct spies
 * on the bare named exports are no-ops for internal calls.
 *
 * Mirror of `_aaveChains` at `src/chains/aave-v3.ts:148`.
 */
export const _safeChains = {
  getOnchainSafeInfo,
  getEnabledModules,
  getOnchainDomainSeparator,
};
