// src/chains/lido.ts
//
// Per-chain read service for Lido stETH + wstETH — Phase 30 (Plan 30-02).
//
// Exports two read helpers consumed by `get_lido_positions`:
//   - `readEthereumPositions(client, wallet)` — Ethereum mainnet: full 5-field
//     set (stethBalance, stethShares, wstethBalance, conversionRate,
//     accruedRebaseRewards). 4-read Promise.all fan-out + computeRebaseRewards.
//   - `readArbitrumPositions(arbClient, ethClient, wallet)` — Arbitrum bridged-
//     wstETH only: wstethBalance from Arbitrum + conversionRate from Ethereum
//     L1 (Pitfall 5 — see load-bearing comment below). stethBalance, stethShares,
//     accruedRebaseRewards all return null (no bridged stETH on Arbitrum).
//
// Address resolution: ALWAYS via Plan 30-01's typed-slot SOT —
//   `getLidoStethAddress` / `getLidoWstethAddress` from src/config/contracts.ts.
// NEVER inline an address here.
//
// ESM spy-affordance: `_lidoChains` wraps both helpers so tests can
// `vi.spyOn(_lidoChains, "readEthereumPositions")` without monkey-patching
// named exports. Per CLAUDE.md § Conventions.
//
// Consumed by:
//   - src/tools/get_lido_positions.ts (Plan 30-02)
//   - test/get-lido-positions.test.ts (Plan 30-02 unit tests)
//
// Pitfall 5 load-bearing invariant:
//   The BRIDGED Arbitrum wstETH (`0x5979D7b546E38E414F7E9822514be443A4800529`)
//   does NOT implement `stEthPerToken()`. Calling it on the Arbitrum RPC would
//   revert. The conversion rate MUST be read from Ethereum L1 wstETH
//   (`0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0`) which does implement it.
//   The rate is L1-authoritative and globally applicable (Arbitrum bridging
//   does not change the stETH/wstETH exchange rate). See RESEARCH § Topic 5.

import { type Address, type PublicClient, parseAbi } from "viem";

import {
  getLidoStethAddress,
  getLidoWstethAddress,
} from "../config/contracts.js";
import { _lidoRebase } from "../signing/lido-rebase.js";

// ---------------------------------------------------------------------------
// ABI fragments (read functions only — write ABIs live in src/protocols/lido.ts)
// ---------------------------------------------------------------------------

/**
 * stETH ERC-20 read ABI fragments consumed by `readEthereumPositions`.
 * - `balanceOf(address) → uint256` — rebase-adjusted balance
 * - `sharesOf(address) → uint256`  — rebase-invariant share count
 *
 * The stETH contract address resolution uses the SOT getter
 * `getLidoStethAddress(1)` — NEVER inline the address here.
 */
const STETH_READ_ABI = parseAbi([
  "function balanceOf(address account) view returns (uint256)",
  "function sharesOf(address account) view returns (uint256)",
]);

/**
 * wstETH read ABI fragments consumed by both Ethereum and Arbitrum branches.
 * - `balanceOf(address) → uint256`   — wstETH balance (same on Ethereum + Arbitrum)
 * - `stEthPerToken() → uint256`      — 1e18-scaled stETH-per-wstETH conversion rate
 *                                       ETHEREUM MAINNET ONLY — Pitfall 5 (bridged
 *                                       Arbitrum wstETH reverts on this call).
 *
 * The wstETH contract address resolution uses the SOT getter
 * `getLidoWstethAddress(chainId)` — NEVER inline the address here.
 */
const WSTETH_READ_ABI = parseAbi([
  "function balanceOf(address account) view returns (uint256)",
  "function stEthPerToken() view returns (uint256)",
]);

// ---------------------------------------------------------------------------
// Result interfaces
// ---------------------------------------------------------------------------

/**
 * Result shape for Ethereum mainnet reads. All 5 fields are populated.
 * `accruedRebaseRewards` carries the D-09 approximate formula result
 * (= currentStethBalance - shares; bigint; load-bearing `approx: true`).
 */
export interface LidoEthereumReadResult {
  stethBalance: bigint;
  stethShares: bigint;
  wstethBalance: bigint;
  /** 1e18-scaled wstETH→stETH conversion rate from `WstETH.stEthPerToken()`. */
  conversionRate: bigint;
  /** Approximate accrued rebase rewards; D-09 formula. */
  accruedRebaseRewards: bigint;
}

/**
 * Result shape for Arbitrum read. Only wstETH fields are populated; stETH
 * fields are null (no separately-bridged stETH on Arbitrum; no on-chain
 * share tracking on L2). `conversionRate` is fetched from Ethereum L1
 * (Pitfall 5 — bridged Arbitrum wstETH does NOT implement `stEthPerToken()`).
 */
export interface LidoArbitrumReadResult {
  stethBalance: null;
  stethShares: null;
  wstethBalance: bigint;
  /** 1e18-scaled wstETH→stETH rate; read from Ethereum L1 (Pitfall 5). */
  conversionRate: bigint;
  accruedRebaseRewards: null;
}

// ---------------------------------------------------------------------------
// Ethereum read helper
// ---------------------------------------------------------------------------

/**
 * Read Lido stETH + wstETH positions for a wallet on Ethereum mainnet.
 *
 * 4-read concurrent Promise.all:
 *   1. stETH.balanceOf(wallet) → stethBalance
 *   2. stETH.sharesOf(wallet)  → stethShares
 *   3. wstETH.balanceOf(wallet) → wstethBalance
 *   4. wstETH.stEthPerToken()   → conversionRate
 *
 * Then: accruedRebaseRewards = computeRebaseRewards({ shares, currentStethBalance })
 *
 * Address resolution via Plan 30-01 SOT — NEVER inline.
 *
 * @param client   Ethereum mainnet viem PublicClient
 * @param wallet   EIP-55 checksummed wallet address
 */
export async function readEthereumPositions(
  client: PublicClient,
  wallet: Address,
): Promise<LidoEthereumReadResult> {
  const stethAddr = getLidoStethAddress(1)!;
  const wstethAddr = getLidoWstethAddress(1)!;

  const [stethBalance, stethShares, wstethBalance, conversionRate] = await Promise.all([
    client.readContract({
      address: stethAddr,
      abi: STETH_READ_ABI,
      functionName: "balanceOf",
      args: [wallet],
    }) as Promise<bigint>,
    client.readContract({
      address: stethAddr,
      abi: STETH_READ_ABI,
      functionName: "sharesOf",
      args: [wallet],
    }) as Promise<bigint>,
    client.readContract({
      address: wstethAddr,
      abi: WSTETH_READ_ABI,
      functionName: "balanceOf",
      args: [wallet],
    }) as Promise<bigint>,
    client.readContract({
      address: wstethAddr,
      abi: WSTETH_READ_ABI,
      functionName: "stEthPerToken",
    }) as Promise<bigint>,
  ]);

  const { accruedRebaseRewards } = _lidoRebase.computeRebaseRewards({
    shares: stethShares,
    currentStethBalance: stethBalance,
  });

  return {
    stethBalance,
    stethShares,
    wstethBalance,
    conversionRate,
    accruedRebaseRewards,
  };
}

// ---------------------------------------------------------------------------
// Arbitrum read helper
// ---------------------------------------------------------------------------

/**
 * Read Lido wstETH position for a wallet on Arbitrum.
 *
 * Two-client concurrent Promise.all:
 *   1. arbClient: bridged wstETH.balanceOf(wallet) → wstethBalance
 *      (Arbitrum chain; address from getLidoWstethAddress(42161))
 *   2. ethClient: Ethereum wstETH.stEthPerToken()  → conversionRate
 *      (ETHEREUM L1 — Pitfall 5 load-bearing: the BRIDGED Arbitrum wstETH
 *      does NOT implement stEthPerToken() and would REVERT if called on the
 *      Arbitrum RPC. The rate is L1-authoritative and globally applicable.)
 *
 * All stETH fields (stethBalance, stethShares, accruedRebaseRewards) are
 * null — there is no separately-bridged stETH on Arbitrum and no on-chain
 * share tracking on L2.
 *
 * @param arbClient  Arbitrum viem PublicClient
 * @param ethClient  Ethereum mainnet viem PublicClient (for L1 stEthPerToken)
 * @param wallet     EIP-55 checksummed wallet address
 */
export async function readArbitrumPositions(
  arbClient: PublicClient,
  ethClient: PublicClient,
  wallet: Address,
): Promise<LidoArbitrumReadResult> {
  const arbWstethAddr = getLidoWstethAddress(42161)!;
  const ethWstethAddr = getLidoWstethAddress(1)!;

  // Pitfall 5 (load-bearing): arbClient reads bridged wstETH balance;
  // ethClient reads stEthPerToken from L1 wstETH — the Arbitrum bridged
  // wstETH does NOT implement stEthPerToken() and would REVERT if called
  // on the Arbitrum RPC. The rate is L1-authoritative and globally applicable.
  const [wstethBalance, conversionRate] = await Promise.all([
    arbClient.readContract({
      address: arbWstethAddr,
      abi: WSTETH_READ_ABI,
      functionName: "balanceOf",
      args: [wallet],
    }) as Promise<bigint>,
    ethClient.readContract({
      address: ethWstethAddr,
      abi: WSTETH_READ_ABI,
      functionName: "stEthPerToken",
    }) as Promise<bigint>,
  ]);

  return {
    stethBalance: null,
    stethShares: null,
    wstethBalance,
    conversionRate,
    accruedRebaseRewards: null,
  };
}

// ---------------------------------------------------------------------------
// ESM spy-affordance indirection (CLAUDE.md § Conventions)
// ---------------------------------------------------------------------------

/**
 * Mutable indirection object for ESM spy-affordance. Tests can
 * `vi.spyOn(_lidoChains, "readEthereumPositions")` or
 * `vi.spyOn(_lidoChains, "readArbitrumPositions")` to intercept RPC calls
 * without monkey-patching named exports (ESM bindings are immutable; direct
 * spies are no-ops for module-internal calls). Mirror of `_aaveChains` in
 * src/chains/aave-v3.ts.
 */
export const _lidoChains = { readEthereumPositions, readArbitrumPositions };
