// src/signing/btc-coin-select.ts — Phase 23 Plan 23-02 Task 1.
//
// Branch-and-bound (BnB) coin selection + largest-first fallback.
// Pure-bigint, no I/O — regression-tested against hardcoded fixture inputs.
//
// Placement under src/signing/ mirrors pure-compute precedents:
//   - src/signing/aave-health.ts   (Aave V3 health factor math)
//   - src/signing/compound-collateralization.ts (Compound V3 health math)
//
// Design decisions honored:
//   - D-01: BnB across the full UTXO set regardless of script type;
//            largest-first fallback when BnB finds no clean match.
//   - D-03: feeRate sanity bounds — refuse feeRate < 1 sat/vB or
//            > 10× highPriorityEstimate (decimal-place-mistake defense).
//   - D-07: DUST ASYMMETRY (Pitfall 4 — load-bearing):
//            • Recipient output below dust → { kind: "refused" }.
//            • Change output below dust → drop change, add dust to fee
//              (changeSats = 0n) — NEVER refuse for below-dust change.
//
// Vbyte constant table [CITED: BIP-141 weight rules, https://github.com/bitcoin/bips/blob/master/bip-0141.mediawiki]:
//   P2WPKH input  = 68 vbytes   (41B non-witness + 107B witness / 4 = 41 + 26.75 ≈ 68)
//   P2TR key-spend input = 58 vbytes (41B non-witness + 65B witness / 4 = 41 + 16.25 ≈ 57.5 → 58)
//   P2WPKH output = 31 vbytes
//   P2TR output   = 43 vbytes
//   Fixed overhead = 11 vbytes (10.5 → 11, covers version + marker + flag + locktime)
//
// ESM spy-affordance indirection: export _btcCoinSelect for vi.spyOn() support
// across ESM module boundaries (CLAUDE.md — add at write time).
//
// All sat amounts are bigint throughout. `feeRate` is a plain JS number
// (sat/vB) because it's a per-unit rate, not an amount.

// ─── Public types ─────────────────────────────────────────────────────────────

/** A single UTXO eligible for selection. */
export interface UtxoEntry {
  readonly txid: string;
  readonly vout: number;
  readonly valueSats: bigint;
  readonly scriptType: "p2wpkh" | "p2tr";
}

/** Arguments to selectCoinsBnb. */
export interface CoinSelectArgs {
  /** Full UTXO set to select from. Mixed script types allowed (D-01). */
  readonly utxos: readonly UtxoEntry[];
  /** Amount to send to the recipient (sats). NOT the total tx value. */
  readonly targetSats: bigint;
  /**
   * Fee rate in sat/vB.
   * Sanity bounds (D-03): must be ≥ 1 and ≤ 10 × highPriorityEstimate.
   * Number (not bigint) — per-unit rate, not a sat amount.
   */
  readonly feeRate: number;
  /**
   * High-priority fee rate estimate (sat/vB). Used to enforce the 10×
   * upper bound on feeRate (D-03 decimal-place-mistake defense).
   */
  readonly highPriorityEstimate: number;
  /**
   * Script type of the change output. Used to compute the change output's
   * vbyte contribution in the fee estimate.
   */
  readonly changeScriptType: "p2wpkh" | "p2tr";
  /**
   * Script type of the recipient output. Inferred from the `to` address prefix:
   * `bc1q…` → `p2wpkh`, `bc1p…` → `p2tr`. WR-03 fix: pass the caller-inferred
   * recipient script type rather than proxying via change script type.
   */
  readonly recipientScriptType: "p2wpkh" | "p2tr";
  /**
   * Dust threshold in sats. Outputs below this value are "dust":
   *   - recipient below dust → refused
   *   - change below dust → folded into fee (D-07)
   */
  readonly dustThresholdSats: bigint;
}

/** Successful coin selection result. */
export interface CoinSelectOk {
  readonly kind: "ok";
  /** The selected UTXO inputs. */
  readonly selectedInputs: readonly UtxoEntry[];
  /** Change amount in sats. 0n if change was folded into the fee (D-07). */
  readonly changeSats: bigint;
  /**
   * Total miner fee in sats.
   * If change was below-dust, feeSats absorbs the dust (feeSats > baseline fee).
   */
  readonly feeSats: bigint;
}

/** Coin selection refusal result. */
export interface CoinSelectRefused {
  readonly kind: "refused";
  /** Human-readable reason for the refusal. */
  readonly reason: string;
}

export type CoinSelectResult = CoinSelectOk | CoinSelectRefused;

// ─── Vbyte constants [CITED: BIP-141 weight rules] ───────────────────────────

/** Fixed overhead (version 4B + marker 1B + flag 1B + input-count 1B + output-count 1B + locktime 4B − witness discount = 10.5 → 11). */
const OVERHEAD_VBYTES = 11;

/** P2WPKH input: 41B non-witness + 107B witness / 4 ≈ 67.75 → 68. */
const P2WPKH_INPUT_VBYTES = 68;

/** P2TR key-spend input: 41B non-witness + 65B witness / 4 ≈ 57.5 → 58. */
const P2TR_INPUT_VBYTES = 58;

/** P2WPKH output: 8B value + 23B scriptPubKey = 31. */
const P2WPKH_OUTPUT_VBYTES = 31;

/** P2TR output: 8B value + 35B scriptPubKey = 43. */
const P2TR_OUTPUT_VBYTES = 43;

// ─── Internal helpers ─────────────────────────────────────────────────────────

function inputVbytes(scriptType: "p2wpkh" | "p2tr"): number {
  return scriptType === "p2wpkh" ? P2WPKH_INPUT_VBYTES : P2TR_INPUT_VBYTES;
}

function outputVbytes(scriptType: "p2wpkh" | "p2tr"): number {
  return scriptType === "p2wpkh" ? P2WPKH_OUTPUT_VBYTES : P2TR_OUTPUT_VBYTES;
}

/**
 * Estimate transaction vbytes given the selected inputs and the script types
 * of the recipient and (optionally) change outputs.
 *
 * Rounds up per BIP-141 weight rules (weight / 4, ceiling).
 */
function estimateVbytes(
  inputs: readonly UtxoEntry[],
  recipientScriptType: "p2wpkh" | "p2tr",
  changeScriptType: "p2wpkh" | "p2tr" | null,
): number {
  const inputTotal = inputs.reduce((acc, u) => acc + inputVbytes(u.scriptType), 0);
  const outputTotal =
    outputVbytes(recipientScriptType) + (changeScriptType !== null ? outputVbytes(changeScriptType) : 0);
  return OVERHEAD_VBYTES + inputTotal + outputTotal;
}

/**
 * Compute the estimated fee in sats given a set of inputs.
 * Always rounds up to the nearest sat.
 */
function estimateFee(
  inputs: readonly UtxoEntry[],
  recipientScriptType: "p2wpkh" | "p2tr",
  changeScriptType: "p2wpkh" | "p2tr" | null,
  feeRate: number,
): bigint {
  const vbytes = estimateVbytes(inputs, recipientScriptType, changeScriptType);
  return BigInt(Math.ceil(vbytes * feeRate));
}

// (WR-03) recipientScriptType() proxy function removed — callers now pass
// the recipient script type directly via CoinSelectArgs.recipientScriptType.

// ─── BnB coin-selection algorithm (Erhardt 2016) ─────────────────────────────
//
// Branch-and-bound explores all subsets of the sorted UTXO set looking for a
// subset whose sum lies within [target + fee, target + fee + cost-of-change].
// The "effective value" of each UTXO is valueSats − (inputVbytes × feeRate),
// i.e. the value after paying its own inclusion fee.
//
// "Zero-change" target: we want selectedSum === targetSats + fee (no change output).
// Tolerance: allow up to `BNB_TOLERANCE` sats over the zero-change target to
// account for rounding (comparable to a typical change output's dust threshold).
//
// Fallback: if BnB finds no clean match, we fall back to a largest-first
// accumulative algorithm (FIFO/largest-first per D-01).

const BNB_TOLERANCE_SATS = 500n; // sats; generous tolerance for rounding
const BNB_MAX_TRIES = 10_000; // iteration cap to bound worst-case runtime

/**
 * BnB recursive search. Returns the best subset found (fewest extra sats
 * above the target), or null if no match within BNB_MAX_TRIES iterations.
 *
 * The search target is `targetSats + fee_with_NO_change_output`, computed
 * dynamically for each candidate subset based on its actual input count and
 * script types. A subset "matches" when:
 *   selectedSum ∈ [exact_target, exact_target + BNB_TOLERANCE_SATS]
 *
 * UTXOs must be sorted by value descending so remaining-sum pruning works.
 */
function bnbSearch(
  sortedUtxos: readonly UtxoEntry[],
  targetSats: bigint, // the recipient send amount
  recipientST: "p2wpkh" | "p2tr",
  feeRate: number,
  current: UtxoEntry[],
  currentSum: bigint,
  index: number,
  tries: { count: number },
): UtxoEntry[] | null {
  if (tries.count > BNB_MAX_TRIES) return null;
  tries.count++;

  // For the current subset, compute what a no-change tx would cost.
  if (current.length > 0) {
    const feeNoChange = estimateFee(current, recipientST, null, feeRate);
    const exact = targetSats + feeNoChange;
    if (currentSum >= exact && currentSum <= exact + BNB_TOLERANCE_SATS) {
      return [...current]; // exact or near-exact match
    }
    // If currentSum already exceeds the best window, prune (inputs are added in
    // descending order so remaining UTXOs can only grow the sum further).
    if (currentSum > exact + BNB_TOLERANCE_SATS) return null;
  }

  if (index >= sortedUtxos.length) return null;

  // Remaining sum if we include every remaining UTXO.
  let remainingSum = 0n;
  for (let i = index; i < sortedUtxos.length; i++) {
    remainingSum += sortedUtxos[i]!.valueSats;
  }
  // Even with the minimum single-input fee, we need at least targetSats covered.
  if (currentSum + remainingSum < targetSats) return null;

  const utxo = sortedUtxos[index]!;

  // Branch: include this UTXO.
  current.push(utxo);
  const withUtxo = bnbSearch(
    sortedUtxos,
    targetSats,
    recipientST,
    feeRate,
    current,
    currentSum + utxo.valueSats,
    index + 1,
    tries,
  );
  current.pop();

  if (withUtxo !== null) return withUtxo;

  // Branch: skip this UTXO.
  return bnbSearch(sortedUtxos, targetSats, recipientST, feeRate, current, currentSum, index + 1, tries);
}

// ─── Main entry point ─────────────────────────────────────────────────────────

/**
 * Select UTXOs for a BTC transaction using branch-and-bound (Erhardt 2016)
 * with a largest-first fallback.
 *
 * Returns a discriminated-union result — never throws on valid input.
 */
export function selectCoinsBnb(args: CoinSelectArgs): CoinSelectResult {
  const { utxos, targetSats, feeRate, highPriorityEstimate, changeScriptType, recipientScriptType: recType, dustThresholdSats } = args;

  // ── D-03: fee-rate sanity bounds ──────────────────────────────────────────
  if (feeRate < 1) {
    return {
      kind: "refused",
      reason: `feeRate ${feeRate} sat/vB is below the minimum of 1 sat/vB`,
    };
  }
  if (feeRate > 10 * highPriorityEstimate) {
    return {
      kind: "refused",
      reason:
        `feeRate ${feeRate} sat/vB exceeds 10× the high-priority estimate ` +
        `(${highPriorityEstimate} sat/vB × 10 = ${10 * highPriorityEstimate} sat/vB)`,
    };
  }

  // ── D-07: refuse recipient output below dust ──────────────────────────────
  if (targetSats < dustThresholdSats) {
    return {
      kind: "refused",
      reason:
        `recipient output of ${targetSats} sats is below the dust threshold ` +
        `(${dustThresholdSats} sats)`,
    };
  }

  if (utxos.length === 0) {
    return { kind: "refused", reason: "no UTXOs available for selection" };
  }

  // Sort UTXOs by value descending (BnB prunes on remaining-sum).
  const sorted = [...utxos].sort((a, b) => (a.valueSats > b.valueSats ? -1 : a.valueSats < b.valueSats ? 1 : 0));

  // recType is destructured from args above (WR-03 — use caller-supplied recipientScriptType)
  const totalUtxoSum = sorted.reduce((acc, u) => acc + u.valueSats, 0n);

  // ── Attempt BnB: look for a zero-change solution ──────────────────────────
  let selected: UtxoEntry[] | null = null;

  if (totalUtxoSum >= targetSats) {
    const tries = { count: 0 };
    selected = bnbSearch(sorted, targetSats, recType, feeRate, [], 0n, 0, tries);
  }

  if (selected !== null) {
    // BnB found an exact-enough match (zero or near-zero change).
    const selectedSum = selected.reduce((acc, u) => acc + u.valueSats, 0n);
    const feeSats = selectedSum - targetSats;
    return {
      kind: "ok",
      selectedInputs: selected,
      changeSats: 0n,
      feeSats,
    };
  }

  // ── Fallback: largest-first accumulative ─────────────────────────────────
  // Pick UTXOs in descending order until we cover target + fee (with change output).
  const accumulated: UtxoEntry[] = [];
  let accSum = 0n;

  for (const utxo of sorted) {
    accumulated.push(utxo);
    accSum += utxo.valueSats;

    // Re-estimate fee with the current accumulation (with change output).
    const fee = estimateFee(accumulated, recType, changeScriptType, feeRate);
    const needed = targetSats + fee;

    if (accSum >= needed) {
      const rawChange = accSum - needed;
      if (rawChange < dustThresholdSats) {
        // Change is below dust — fold into fee (D-07).
        return {
          kind: "ok",
          selectedInputs: accumulated,
          changeSats: 0n,
          feeSats: accSum - targetSats, // absorbs dust
        };
      }
      return {
        kind: "ok",
        selectedInputs: accumulated,
        changeSats: rawChange,
        feeSats: fee,
      };
    }
  }

  // Exhausted all UTXOs without covering target.
  return {
    kind: "refused",
    reason: `insufficient funds: total UTXOs ${totalUtxoSum} sats cannot cover target ${targetSats} sats plus fees`,
  };
}

// ─── ESM spy-affordance (CLAUDE.md) ──────────────────────────────────────────

/** Indirection object for vi.spyOn across ESM module boundaries. */
export const _btcCoinSelect = { selectCoinsBnb };
