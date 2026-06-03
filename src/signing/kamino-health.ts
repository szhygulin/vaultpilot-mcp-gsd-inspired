// src/signing/kamino-health.ts
//
// Pure-bigint Kamino per-reserve-LTV / liquidation-threshold health math (D-07).
// Phase 13 — Plan 13-04. Sibling of `src/signing/marginfi-health.ts` +
// `src/signing/aave-health.ts` — same shape: pinned fixed-point constants, an
// input interface, a `compute*Health` pure function, and a `classify*Risk`
// band. Pure functions ONLY — NO side effects, NO RPC, NO module-load state,
// bigint-only (no `Number` / float in the math path).
//
// Kamino uses the Solend-lineage LTV / liquidation-threshold model (distinct
// from MarginFi's per-bank asset/liability WEIGHTS). Per-reserve params arrive
// as bps (loanToValuePct / liquidationThresholdPct × 100, converted at the
// decoder seam in `src/chains/solana/kamino.ts`).
//
// Formula (13-RESEARCH § Health Math, re-derived on-chain-accurate per D-07 —
// NOT imported from the SDK; the SDK `loanToValue()` / per-Reserve
// `loanToValue`/`liquidationThreshold` are the REFERENCE to verify against):
//   borrowPower      = Σ (depositValue_i × loanToValueBps_i / 10000)
//   liquidationLine  = Σ (depositValue_i × liquidationThresholdBps_i / 10000)
//   borrowedValue    = Σ borrowedValue_j
//   Display health factor = liquidationLine / borrowedValue  (> 1 safe — mirror
//     Aave's weightedLT/debt shape for cross-protocol display consistency).
//
// Threat anchors:
//   - T-13-10 (Tampering): bps scale-constant drift mis-bands risk. `KAMINO_BPS`
//     is pinned + a deterministic input → expected scaled-bigint anchor
//     (Pitfall 4) in test/signing-kamino-health.test.ts.
//   - T-13-09 (Information disclosure): a stale oracle invalidates a "safe"
//     claim. `oracleStale` surfaces verbatim — the reader never asserts
//     liquidation safety on a stale price (mirror Aave/MarginFi). No throw —
//     surface, don't crash (reads).

/**
 * Kamino per-reserve LTV / liquidation-threshold scale — basis points (10_000 =
 * 100%). PINNED (Pitfall 4 / T-13-10): the SDK exposes `loanToValuePct` /
 * `liquidationThresholdPct` as percent integers (0–100); the decoder seam
 * multiplies ×100 to bps so this module's arithmetic is integer-exact. A wrong
 * scale silently mis-displays liquidation risk, a trust surface.
 */
export const KAMINO_BPS: bigint = 10_000n;

/**
 * Display health-factor scale — 1e18. Mirrors `aave-health.ts` `HF_SCALE` +
 * `marginfi-health.ts` `MARGINFI_HF_SCALE` for cross-protocol display
 * consistency (the agent reads one HF scale across Aave + MarginFi + Kamino).
 */
export const KAMINO_HF_SCALE: bigint = 10n ** 18n;

/**
 * A single deposit (collateral) position. `depositValue` is the scope-priced
 * deposit value (bigint, decoder-resolved); `loanToValueBps` /
 * `liquidationThresholdBps` are the reserve config params in bps.
 */
export interface KaminoDepositPosition {
  /** Deposit-reserve pubkey, base58 (provenance for the surface). */
  reserve: string;
  /** Scope-priced deposit value (bigint native units at the decoder seam). */
  depositValue: bigint;
  /** Reserve loanToValue in bps (loanToValuePct × 100). */
  loanToValueBps: bigint;
  /** Reserve liquidationThreshold in bps (liquidationThresholdPct × 100). */
  liquidationThresholdBps: bigint;
}

/** A single borrow (liability) position. `borrowedValue` is scope-priced. */
export interface KaminoBorrowPosition {
  /** Borrow-reserve pubkey, base58. */
  reserve: string;
  /** Scope-priced borrowed value (bigint native units at the decoder seam). */
  borrowedValue: bigint;
}

export interface KaminoHealthInput {
  deposits: KaminoDepositPosition[];
  borrows: KaminoBorrowPosition[];
  /** Elevation-group id — surfaced verbatim (A5 — no group-LTV substitution). */
  elevationGroup: number;
  /** True when ANY priced position carries a stale oracle (T-13-09). */
  oracleStale: boolean;
}

export interface KaminoHealthOutput {
  /** Σ (depositValue × loanToValueBps / 10000) — the borrow capacity. */
  borrowPowerScaled: bigint;
  /** Σ (depositValue × liqThresholdBps / 10000) — the liquidation line. */
  liquidationLineScaled: bigint;
  /** Σ borrowedValue. */
  borrowedValueScaled: bigint;
  /**
   * Health factor = liquidationLine / borrowed, rescaled to `KAMINO_HF_SCALE`
   * (1e18). `null` when `noDebt === true` (mirror the aave/marginfi
   * null-not-MAX_UINT256 lock — agents read `noDebt` FIRST). When borrowed > 0
   * but liquidationLine == 0, returns `0n` (NOT null — there IS debt).
   */
  healthFactorScaled: bigint | null;
  /** True when there is no debt and the ratio is mathematically undefined. */
  noDebt: boolean;
  /** Elevation-group id surfaced verbatim (A5). */
  elevationGroup: number;
  /** True when ANY input position carries a stale oracle (T-13-09). */
  oracleStale: boolean;
}

/**
 * Compute Kamino per-reserve-LTV health (D-07). Pure bigint. No RPC, no float.
 *
 * Each deposit contributes `depositValue × ltvBps / 10000` to borrow power and
 * `depositValue × liqThresholdBps / 10000` to the liquidation line. The display
 * health factor is `liquidationLine / borrowed` rescaled to 1e18 (> 1 safe).
 *
 * `oracleStale` + `elevationGroup` are surfaced verbatim — the reader never
 * substitutes a group-specific LTV (A5) nor asserts safety on a stale price.
 */
export function computeKaminoHealth(
  input: KaminoHealthInput,
): KaminoHealthOutput {
  let borrowPowerScaled = 0n;
  let liquidationLineScaled = 0n;
  for (const d of input.deposits) {
    borrowPowerScaled += (d.depositValue * d.loanToValueBps) / KAMINO_BPS;
    liquidationLineScaled +=
      (d.depositValue * d.liquidationThresholdBps) / KAMINO_BPS;
  }

  let borrowedValueScaled = 0n;
  for (const b of input.borrows) {
    borrowedValueScaled += b.borrowedValue;
  }

  if (borrowedValueScaled === 0n) {
    return {
      borrowPowerScaled,
      liquidationLineScaled,
      borrowedValueScaled: 0n,
      healthFactorScaled: null,
      noDebt: true,
      elevationGroup: input.elevationGroup,
      oracleStale: input.oracleStale,
    };
  }

  return {
    borrowPowerScaled,
    liquidationLineScaled,
    borrowedValueScaled,
    // liquidationLine / borrowed, rescaled to 1e18 (> 1 safe).
    healthFactorScaled:
      (liquidationLineScaled * KAMINO_HF_SCALE) / borrowedValueScaled,
    noDebt: false,
    elevationGroup: input.elevationGroup,
    oracleStale: input.oracleStale,
  };
}

export type KaminoLiquidationRisk = "safe" | "warning" | "danger" | "noDebt";

/**
 * Classify the health factor into a 4-arm band. Thresholds mirror
 * `aave-health.ts` / `marginfi-health.ts` for cross-protocol consistency:
 *   - hf ≥ 1.50 → "safe"
 *   - 1.10 ≤ hf < 1.50 → "warning"
 *   - hf < 1.10 → "danger"
 *   - noDebt → "noDebt"
 *
 * Pure classification, no side effects. `healthFactorScaled === null` with
 * `noDebt === false` is defensively treated as "noDebt" (unreachable — the
 * compute fn returns 0n, not null, when there is debt with zero collateral).
 */
export function classifyKaminoRisk(
  healthFactorScaled: bigint | null,
  noDebt: boolean,
): KaminoLiquidationRisk {
  if (noDebt) return "noDebt";
  if (healthFactorScaled === null) return "noDebt";
  const SAFE_THRESHOLD = 15n * 10n ** 17n; // 1.50e18
  const WARNING_THRESHOLD = 11n * 10n ** 17n; // 1.10e18
  if (healthFactorScaled >= SAFE_THRESHOLD) return "safe";
  if (healthFactorScaled >= WARNING_THRESHOLD) return "warning";
  return "danger";
}
