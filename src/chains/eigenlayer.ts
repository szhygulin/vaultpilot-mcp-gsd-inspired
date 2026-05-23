// src/chains/eigenlayer.ts
//
// Per-chain read service for EigenLayer — Phase 31 (Plan 31-02).
//
// Exports one read helper consumed by `get_eigenlayer_positions`:
//   - `readEthereumPositions(client, wallet)` — Ethereum mainnet (D-03 lock).
//     Per-strategy fan-out for `stakerStrategyShares` across the curated
//     7-LST registry, filtered to non-zero balances, then per-strategy
//     `sharesToUnderlyingView` and a single `DelegationManager.getQueuedWithdrawals`
//     call. Returns `{deposits, pendingWithdrawals, totalEthEquivalent, approx: true}`.
//
// Address resolution: ALWAYS via Plan 31-01's typed-slot SOT —
// `getEigenLayerStrategyManagerAddress` / `getEigenLayerDelegationManagerAddress` /
// `getAllEigenLayerStrategiesForChain` from src/config/contracts.ts.
// NEVER inline an address here.
//
// ESM spy-affordance: `_eigenLayerChains` wraps the helper so tests can
// `vi.spyOn(_eigenLayerChains, "readEthereumPositions")` without monkey-
// patching named exports. Per CLAUDE.md § Conventions.
//
// approx: true LOAD-BEARING (D-11): the ethEquivalent column is computed
// from on-chain `sharesToUnderlyingView` which is canonical for the strategy,
// but ETH-equivalence for non-ETH-pegged LSTs (none in the Phase 31 curated
// set) would require a price oracle. Phase 31 assumes 1:1 underlying↔ETH for
// the 7 curated LSTs (all ETH-pegged within slippage); flag stays true.
//
// Consumed by:
//   - src/tools/get_eigenlayer_positions.ts (Plan 31-02)
//   - test/get-eigenlayer-positions.test.ts (Plan 31-02 unit tests)
//
// RESEARCH § Topic 5 anti-pattern (EIGENLAYER_WITHDRAWAL_DELAY_BLOCKS): the
// 50_400-block constant is the canonical mainnet `minWithdrawalDelayBlocks`
// at RESEARCH date but is governance-mutable. Phase 31 v1.x ships the
// constant for read-only ergonomics; v2.x backlog item is to read
// `DelegationManager.minWithdrawalDelayBlocks()` dynamically.

import { type Address, type PublicClient } from "viem";

import {
  STRATEGY_MANAGER_ABI,
  STRATEGY_BASE_ABI,
  DELEGATION_MANAGER_ABI,
  getEigenLayerStrategyManagerAddress,
  getEigenLayerDelegationManagerAddress,
  getAllEigenLayerStrategiesForChain,
  type EigenLayerLst,
} from "../protocols/eigenlayer.js";

// ---------------------------------------------------------------------------
// Withdrawal-delay constant (RESEARCH § Topic 5 — Phase 31 v1.x snapshot)
// ---------------------------------------------------------------------------

/**
 * EigenLayer canonical mainnet `minWithdrawalDelayBlocks` value at Phase 31
 * RESEARCH date (2026-05-23). NOT load-bearing for any cryptographic-binding
 * gate — used only to surface a human-readable "claimableAfterBlock" estimate
 * in `pendingWithdrawals` rows. Governance-mutable; v2.x backlog: read via
 * `DelegationManager.minWithdrawalDelayBlocks()` dynamically.
 */
export const EIGENLAYER_WITHDRAWAL_DELAY_BLOCKS = 50400n;

// ---------------------------------------------------------------------------
// Result interfaces
// ---------------------------------------------------------------------------

export interface EigenLayerDepositRow {
  /** LST symbol from the curated 7-member registry. */
  lst: EigenLayerLst;
  /** Per-strategy proxy address (the `strategy` slot of `depositIntoStrategy`). */
  strategy: Address;
  /** Shares the staker holds in this strategy (raw bigint as decimal string). */
  shares: string;
  /** On-chain `sharesToUnderlyingView(shares)` result (raw bigint as decimal string). */
  underlyingAmount: string;
  /**
   * Best-effort ETH-equivalent (raw bigint as decimal string). For Phase 31
   * curated LSTs (all ETH-pegged), defaults to `underlyingAmount` verbatim.
   * The `approx: true` flag at the parent level signals the user should
   * cross-check against a price oracle for non-pegged LSTs (none in v1.x).
   */
  ethEquivalent: string;
}

export interface EigenLayerPendingWithdrawalRow {
  /** LST symbol from the curated 7-member registry, or "unknown" for off-registry strategies. */
  lst: EigenLayerLst | "unknown";
  /** Per-strategy proxy address (from the Withdrawal struct). */
  strategy: Address;
  /** Shares queued for withdrawal in this strategy (raw bigint as decimal string). */
  shares: string;
  /** Withdrawer address (the recipient of the eventual claim). */
  withdrawer: Address;
  /** Block at which the withdrawal was queued (uint32 from the Withdrawal struct). */
  startBlock: number;
  /** Estimated block at which the withdrawal becomes claimable. */
  claimableAfterBlock: string;
}

export interface EigenLayerReadResult {
  deposits: EigenLayerDepositRow[];
  pendingWithdrawals: EigenLayerPendingWithdrawalRow[];
  /** Sum of `ethEquivalent` across all deposit rows (raw bigint as decimal string). */
  totalEthEquivalent: string;
  /** D-11 load-bearing — ALWAYS the literal `true`. */
  approx: true;
  /** Set when any per-call RPC fan-out throws (partial failure). */
  rpcDegraded?: boolean;
}

// ---------------------------------------------------------------------------
// Ethereum read helper
// ---------------------------------------------------------------------------

/**
 * Read EigenLayer per-strategy positions for a wallet on Ethereum mainnet.
 *
 * Fan-out (3 passes):
 *   1. For each curated strategy, `StrategyManager.stakerStrategyShares(wallet, strategy)`
 *      (Promise.all over the 7 curated strategies; non-throwing partial-result
 *      handling via Promise.allSettled).
 *   2. For each non-zero shares result, `Strategy.sharesToUnderlyingView(shares)`
 *      (Promise.all over the filtered set).
 *   3. Single `DelegationManager.getQueuedWithdrawals(wallet)` call; decompose
 *      the `(Withdrawal[], uint256[][])` return into a flat row array.
 *
 * Partial-failure surface: if any fan-out call throws, the result's
 * `rpcDegraded: true` flag is set; whatever data succeeded is returned.
 *
 * Address resolution via Plan 31-01 SOT — NEVER inline.
 *
 * @param client   Ethereum mainnet viem PublicClient
 * @param wallet   EIP-55 checksummed wallet address
 */
export async function readEthereumPositions(
  client: PublicClient,
  wallet: Address,
): Promise<EigenLayerReadResult> {
  const strategyManagerAddr = getEigenLayerStrategyManagerAddress(1)!;
  const delegationManagerAddr = getEigenLayerDelegationManagerAddress(1)!;
  const curated = getAllEigenLayerStrategiesForChain(1); // 7 rows for Phase 31

  // Lookup: per-strategy `lst` symbol for the queued-withdrawal reverse-mapping.
  const strategyToLst = new Map<string, EigenLayerLst>();
  for (const row of curated) {
    strategyToLst.set(row.strategy.toLowerCase(), row.lst);
  }

  let rpcDegraded = false;

  // --- Pass 1: stakerStrategyShares fan-out (7 calls) ---
  const sharesResults = await Promise.allSettled(
    curated.map((row) =>
      client.readContract({
        address: strategyManagerAddr,
        abi: STRATEGY_MANAGER_ABI,
        functionName: "stakerStrategyShares",
        args: [wallet, row.strategy],
      }) as Promise<bigint>,
    ),
  );

  const nonZeroRows: Array<{ lst: EigenLayerLst; strategy: Address; shares: bigint }> = [];
  for (let i = 0; i < sharesResults.length; i++) {
    const res = sharesResults[i];
    const row = curated[i];
    if (!res || !row) continue;
    if (res.status === "rejected") {
      rpcDegraded = true;
      continue;
    }
    if (res.value > 0n) {
      nonZeroRows.push({ lst: row.lst, strategy: row.strategy, shares: res.value });
    }
  }

  // --- Pass 2: sharesToUnderlyingView fan-out (only non-zero rows) ---
  const underlyingResults = await Promise.allSettled(
    nonZeroRows.map((row) =>
      client.readContract({
        address: row.strategy,
        abi: STRATEGY_BASE_ABI,
        functionName: "sharesToUnderlyingView",
        args: [row.shares],
      }) as Promise<bigint>,
    ),
  );

  const deposits: EigenLayerDepositRow[] = [];
  for (let i = 0; i < underlyingResults.length; i++) {
    const res = underlyingResults[i];
    const row = nonZeroRows[i];
    if (!res || !row) continue;
    if (res.status === "rejected") {
      rpcDegraded = true;
      // Surface the deposit with shares but no underlyingAmount estimate; the
      // ethEquivalent collapses to `shares` (1:1 baseline) when underlying read
      // fails, signaling drift in the rpcDegraded flag.
      deposits.push({
        lst: row.lst,
        strategy: row.strategy,
        shares: row.shares.toString(),
        underlyingAmount: row.shares.toString(),
        ethEquivalent: row.shares.toString(),
      });
      continue;
    }
    const underlyingAmount = res.value;
    deposits.push({
      lst: row.lst,
      strategy: row.strategy,
      shares: row.shares.toString(),
      underlyingAmount: underlyingAmount.toString(),
      // D-11 Phase 31 v1.x assumption: all 7 curated LSTs are ETH-pegged (no
      // price oracle needed). Non-pegged LSTs would require a multi-source
      // pricing call (deferred to v2.x); the `approx: true` parent flag is
      // the user-facing disclaimer.
      ethEquivalent: underlyingAmount.toString(),
    });
  }

  // --- Pass 3: DelegationManager.getQueuedWithdrawals (single call) ---
  type Withdrawal = {
    staker: Address;
    delegatedTo: Address;
    withdrawer: Address;
    nonce: bigint;
    startBlock: number;
    strategies: readonly Address[];
    shares: readonly bigint[];
  };

  const pendingWithdrawals: EigenLayerPendingWithdrawalRow[] = [];
  try {
    const result = (await client.readContract({
      address: delegationManagerAddr,
      abi: DELEGATION_MANAGER_ABI,
      functionName: "getQueuedWithdrawals",
      args: [wallet],
    })) as readonly [readonly Withdrawal[], readonly (readonly bigint[])[]];

    const withdrawals = result[0] ?? [];
    for (const w of withdrawals) {
      const strategies = w.strategies ?? [];
      const sharesArr = w.shares ?? [];
      const startBlockNum = Number(w.startBlock);
      const claimableAfterBlock = (
        BigInt(startBlockNum) + EIGENLAYER_WITHDRAWAL_DELAY_BLOCKS
      ).toString();
      for (let i = 0; i < strategies.length; i++) {
        const strategy = strategies[i];
        const shares = sharesArr[i] ?? 0n;
        if (!strategy) continue;
        const lst = strategyToLst.get(strategy.toLowerCase()) ?? "unknown";
        pendingWithdrawals.push({
          lst,
          strategy,
          shares: shares.toString(),
          withdrawer: w.withdrawer,
          startBlock: startBlockNum,
          claimableAfterBlock,
        });
      }
    }
  } catch {
    rpcDegraded = true;
  }

  // --- Aggregate totalEthEquivalent ---
  let total = 0n;
  for (const d of deposits) total += BigInt(d.ethEquivalent);

  const result: EigenLayerReadResult = {
    deposits,
    pendingWithdrawals,
    totalEthEquivalent: total.toString(),
    approx: true,
  };
  if (rpcDegraded) result.rpcDegraded = true;
  return result;
}

// ---------------------------------------------------------------------------
// ESM spy-affordance indirection (CLAUDE.md § Conventions)
// ---------------------------------------------------------------------------

/**
 * Mutable indirection object for ESM spy-affordance. Tests can
 * `vi.spyOn(_eigenLayerChains, "readEthereumPositions")` to intercept the
 * RPC fan-out without monkey-patching named exports. Mirror of `_lidoChains`
 * in src/chains/lido.ts.
 */
export const _eigenLayerChains = { readEthereumPositions };
