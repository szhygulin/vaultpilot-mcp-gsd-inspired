// src/config/sandwich-mev-thresholds.ts — per-chain sandwich-MEV threshold SOT.
//
// Phase 40 Plan 40-01 (MEV-01). Extends the Phase-32 Ethereum-only fixed gate
// (50bps default / >2% refusal) to per-chain thresholds keyed on the EVM
// ChainId literal-union from src/config/contracts.ts.
//
// Design decisions (CONTEXT.md LOCKED):
//   - SOT shape mirrors CONTRACTS_RAW + PUBLICNODE_RPC_URLS: Record<ChainId, {...}>
//   - getSandwichThresholds reads MEV_THRESHOLD_<CHAIN> at CALL TIME (lazy — never
//     module-load, no cached override) so tests can mutate process.env freely.
//   - Override scope: defaultSlippageBps ONLY (priceImpactRefusalPct stays from table).
//   - Invalid override → throws InvalidMevThresholdError (consuming tools map to
//     SANDWICH_MEV_REFUSED envelope). "Refuse on invalid" per CONTEXT + RESEARCH Q5.
//   - Strict integer parse: /^[1-9][0-9]*$/ + range [1,10000]. Rejects "1.5", "01",
//     "abc", "0", negative, >10000. Decimal-place-mistake defense mirrors project posture.
//
// Per-chain calibration rationale:
//   ethereum  50/2.0  — public mempool, highest sandwich exposure (Phase-32 baseline)
//   polygon  100/2.0  — public Bor mempool + active MEV searchers; higher default slippage
//   arbitrum  30/3.0  — private centralized-sequencer mempool; sandwich structurally near-impossible
//   optimism  30/3.0  — same private-sequencer property as Arbitrum
//   base      30/3.0  — OP-stack private sequencer, same as Optimism
//
// These are a CALIBRATION, not a security boundary. See SECURITY.md per-L2 MEV section.

import { type ChainId, type ChainName, chainNameFromId } from "./contracts.js";

// ---------------------------------------------------------------------------
// Per-chain threshold table
// ---------------------------------------------------------------------------

/**
 * Per-chain sandwich-MEV thresholds.
 *
 * `defaultSlippageBps`:      Default slippage when the agent does not supply one explicitly.
 * `priceImpactRefusalPct`:   Price impact percentage above which the sandwich-MEV gate fires
 *                            when slippage is NOT explicitly supplied. Multiply by 100 for bps.
 */
export const SANDWICH_MEV_THRESHOLDS: Record<
  ChainId,
  { defaultSlippageBps: number; priceImpactRefusalPct: number }
> = {
  1:     { defaultSlippageBps: 50,  priceImpactRefusalPct: 2.0 }, // ethereum
  137:   { defaultSlippageBps: 100, priceImpactRefusalPct: 2.0 }, // polygon
  42161: { defaultSlippageBps: 30,  priceImpactRefusalPct: 3.0 }, // arbitrum
  10:    { defaultSlippageBps: 30,  priceImpactRefusalPct: 3.0 }, // optimism
  8453:  { defaultSlippageBps: 30,  priceImpactRefusalPct: 3.0 }, // base
};

// ---------------------------------------------------------------------------
// Invalid override error
// ---------------------------------------------------------------------------

/**
 * Thrown by getSandwichThresholds when MEV_THRESHOLD_<CHAIN> is set but is not
 * a valid base-10 integer in [1, 10000]. Consuming tools catch this and return
 * a SANDWICH_MEV_REFUSED structured envelope naming the chain + raw value.
 */
export class InvalidMevThresholdError extends Error {
  constructor(
    public readonly chain: ChainName,
    public readonly rawValue: string,
    message: string,
  ) {
    super(message);
    this.name = "InvalidMevThresholdError";
  }
}

// ---------------------------------------------------------------------------
// Resolver
// ---------------------------------------------------------------------------

/**
 * Resolve sandwich-MEV thresholds for a given chainId.
 *
 * Starts from SANDWICH_MEV_THRESHOLDS[chainId], then layers the
 * MEV_THRESHOLD_<CHAIN> env override onto `defaultSlippageBps` ONLY.
 * Read is call-time (NOT cached at module load) so tests can mutate
 * process.env between calls.
 *
 * @throws InvalidMevThresholdError when the env override is present but invalid
 *         (non-integer string, out of [1,10000], decimal, negative, zero).
 */
export function getSandwichThresholds(chainId: ChainId): {
  defaultSlippageBps: number;
  priceImpactRefusalPct: number;
} {
  const base = SANDWICH_MEV_THRESHOLDS[chainId];
  const chainName = chainNameFromId(chainId);
  const varName = `MEV_THRESHOLD_${chainName.toUpperCase()}`;

  // Inline trimmed read — module-private; do NOT import read() from env.ts.
  const raw = process.env[varName];

  if (raw === undefined) {
    // Env var not set at all — return table defaults unchanged.
    return { ...base };
  }

  const trimmed = raw.trim();

  // Empty string (set but blank) is an invalid override, not "unset".
  // This mirrors the decimal-strictness posture: "set but non-parseable" → refuse.
  if (trimmed.length === 0) {
    throw new InvalidMevThresholdError(
      chainName,
      raw,
      `MEV_THRESHOLD_${chainName.toUpperCase()} is set but empty; must be a base-10 integer in [1, 10000]`,
    );
  }

  // Strict base-10 positive integer parse: [1-9][0-9]* rejects "0", "01",
  // leading-minus, decimals, whitespace-only-after-trim (already handled above).
  if (!/^[1-9][0-9]*$/.test(trimmed)) {
    throw new InvalidMevThresholdError(
      chainName,
      trimmed,
      `MEV_THRESHOLD_${chainName.toUpperCase()} must be a base-10 integer in [1, 10000], got "${trimmed}"`,
    );
  }

  const parsed = Number(trimmed);
  if (parsed < 1 || parsed > 10000) {
    throw new InvalidMevThresholdError(
      chainName,
      trimmed,
      `MEV_THRESHOLD_${chainName.toUpperCase()} must be in [1, 10000], got ${parsed}`,
    );
  }

  return {
    defaultSlippageBps: parsed,
    priceImpactRefusalPct: base.priceImpactRefusalPct,
  };
}
