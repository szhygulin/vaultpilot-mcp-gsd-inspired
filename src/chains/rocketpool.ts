// src/chains/rocketpool.ts
//
// Per-chain read service for Rocket Pool rETH — Phase 31 Plan 31-03 (RP-01).
//
// Exports `readEthereumPositions(client, wallet)` — consumed by
// `get_rocketpool_positions`. Promise.all fan-out of two reads:
//   1. rETH.balanceOf(wallet)       → rethBalance
//   2. rETH.getExchangeRate()       → exchangeRate
// Computes `ethEquivalent` via `_rocketPoolRate.computeEthEquivalent` (pure
// bigint math; no `approx` flag — contrast with Lido's rebase model).
//
// Address resolution: ALWAYS via Plan 31-01's typed-slot SOT —
//   `getRocketPoolRethAddress(1)` from src/config/contracts.ts.
// NEVER inline an address here.
//
// ESM spy-affordance: `_rocketPoolChains` wraps the helper so tests can
// `vi.spyOn(_rocketPoolChains, "readEthereumPositions")` without
// monkey-patching named exports. Per CLAUDE.md § Conventions.
//
// Chain scope: Ethereum-mainnet ONLY at v2.3 (D-03). v2.6 cross-chain rETH
// bridging is a separate milestone surface (BRIDGE-T1).
//
// Consumed by:
//   - src/tools/get_rocketpool_positions.ts (Plan 31-03)
//   - test/get-rocketpool-positions.test.ts (Plan 31-03 unit tests)

import { type Address, type PublicClient } from "viem";

import { getRocketPoolRethAddress } from "../config/contracts.js";
import { RETH_ABI } from "../protocols/rocketpool.js";
import { _rocketPoolRate } from "../signing/rocketpool-rate.js";

// ---------------------------------------------------------------------------
// Result interface
// ---------------------------------------------------------------------------

/**
 * Result shape for Rocket Pool Ethereum-mainnet position read.
 *
 * All three numeric fields surface as DECIMAL STRINGS — JSON-safe (bigint
 * cannot be JSON-serialized) and consistent with `get_lending_positions` +
 * `get_lido_positions` shape. Conversion to human-readable ETH/rETH happens
 * in the tool layer via `formatUnits(..., 18)`.
 */
export interface RocketPoolEthereumReadResult {
  /** rETH balance from `rETH.balanceOf(wallet)`, as a wei decimal string. */
  rethBalance: string;
  /** 1e18-scaled rETH→ETH rate from `rETH.getExchangeRate()`, as a wei decimal string. */
  exchangeRate: string;
  /** Computed ETH equivalent of the rETH balance at the read block, as a wei decimal string. */
  ethEquivalent: string;
  /** Always "ethereum" at v2.3 (Rocket Pool is mainnet-only — D-03). */
  chain: "ethereum";
  /** Always 1 at v2.3. */
  chainId: 1;
}

// ---------------------------------------------------------------------------
// Read helper
// ---------------------------------------------------------------------------

/**
 * Read Rocket Pool rETH position for a wallet on Ethereum mainnet.
 *
 * 2-read concurrent Promise.all:
 *   1. rETH.balanceOf(wallet)       → rethBalance
 *   2. rETH.getExchangeRate()       → exchangeRate (1e18-scaled rETH→ETH rate)
 *
 * Then: ethEquivalent = computeEthEquivalent({ rethBalance, exchangeRate })
 *
 * Address resolution via Plan 31-01 SOT — NEVER inline.
 *
 * @param client  Ethereum mainnet viem PublicClient
 * @param wallet  EIP-55 checksummed wallet address
 */
export async function readEthereumPositions(
  client: PublicClient,
  wallet: Address,
): Promise<RocketPoolEthereumReadResult> {
  const rethAddr = getRocketPoolRethAddress(1)!;

  const [rethBalance, exchangeRate] = await Promise.all([
    client.readContract({
      address: rethAddr,
      abi: RETH_ABI,
      functionName: "balanceOf",
      args: [wallet],
    }) as Promise<bigint>,
    client.readContract({
      address: rethAddr,
      abi: RETH_ABI,
      functionName: "getExchangeRate",
    }) as Promise<bigint>,
  ]);

  const { ethEquivalent } = _rocketPoolRate.computeEthEquivalent({
    rethBalance,
    exchangeRate,
  });

  return {
    rethBalance: rethBalance.toString(),
    exchangeRate: exchangeRate.toString(),
    ethEquivalent: ethEquivalent.toString(),
    chain: "ethereum" as const,
    chainId: 1 as const,
  };
}

// ---------------------------------------------------------------------------
// ESM spy-affordance indirection (CLAUDE.md § Conventions)
// ---------------------------------------------------------------------------

/**
 * Mutable indirection object for ESM spy-affordance. Tests can
 * `vi.spyOn(_rocketPoolChains, "readEthereumPositions")` to intercept RPC
 * calls without monkey-patching named exports. Mirror of `_lidoChains` in
 * src/chains/lido.ts and `_eigenLayerChains` in src/chains/eigenlayer.ts.
 */
export const _rocketPoolChains = { readEthereumPositions };
