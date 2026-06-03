// parseBittensorAmountStrict — Bittensor sibling of
// `src/signing/amount-solana.ts` (`parseSolanaAmountStrict`). Phase 47 —
// Plan 47-01 (TAO-W-01).
//
// Why a sibling rather than reusing the Solana parser directly: the parser is
// chain-named for call-site clarity (the prepare tools read
// `parseBittensorAmountStrict`), and the unit semantics differ at the CALL
// SITE — `add_stake_limit.amount_staked` is TAO/RAO while
// `remove_stake_limit.amount_unstaked` is ALPHA (47-RESEARCH §Pitfall 3). Both
// are 9-decimal u64, so the arithmetic is identical to the Solana sibling. The
// PER-EXTRINSIC unit labeling lives at the CALL SITE (Plan 47-02), NOT in this
// pure parser — the parser is unit-agnostic.
//
// `InvalidAmountError` is RE-EXPORTED from `amount-solana.ts` rather than
// redefined: the two classes would be structurally identical (same `kind`
// discriminator, same `name`), and a second class with the same name in a
// different module would break consumer `instanceof` checks if a value
// crosses module boundaries. One canonical class, re-exported, keeps
// `err instanceof InvalidAmountError` working uniformly across the
// prepare-tool layer (47-01-PLAN Task 1 directive).
//
// Same rejection ladder as `parseSolanaAmountStrict` (empty / format /
// fractional-overflow / u64-overflow). Off-by-decimal is the most common
// user-facing bug class per CLAUDE.md "Decimal-aware arithmetic".

import { InvalidAmountError } from "./amount-solana.js";

// Re-export so Plan 47-02 prepare tools import the single canonical class from
// the Bittensor module (`instanceof InvalidAmountError` stays uniform).
export { InvalidAmountError };

/**
 * `2^64 - 1` — the maximum representable RAO / ALPHA value on the wire. Both
 * `balances.transferKeepAlive.value` (Compact<u64>) and the staking
 * extrinsics' `amount_staked` / `amount_unstaked` (u64) truncate to u64
 * on-chain. Reject server-side so the user never sees a silent overflow at
 * prepare time.
 */
const U64_MAX: bigint = (1n << 64n) - 1n;

/**
 * Strict pre-validation guard for Bittensor token amounts (RAO and ALPHA —
 * both 9-decimal u64).
 *
 * Four-step gate (identical shape to `parseSolanaAmountStrict`):
 *   1. Empty / whitespace-only check     → InvalidAmountError(kind: "empty")
 *   2. Strict regex `^[0-9]+(\.[0-9]+)?$` rejects leading/trailing dot,
 *      multi-dot, negative, scientific notation, comma-grouping, alpha
 *      → InvalidAmountError(kind: "format")
 *   3. Fractional-digit count check      → InvalidAmountError(kind: "fractional-overflow")
 *      (the load-bearing off-by-decimal guard — passing decimal TAO like
 *      "1.5" into a decimals=0 RAO field would silently round; we reject
 *      explicitly)
 *   4. u64-overflow check (RAO / ALPHA is u64 on-wire) →
 *      InvalidAmountError(kind: "u64-overflow")
 *
 * `decimals` defaults to 9 (the TAO/RAO and ALPHA protocol decimals — chain
 * props symbol=TAO, decimals=9, probed 2026-06-03). The per-extrinsic UNIT
 * (TAO/RAO vs ALPHA) is labeled at the call site, never here.
 *
 * @throws InvalidAmountError on any rejected input.
 */
export function parseBittensorAmountStrict(
  amountStr: string,
  decimals = 9,
): bigint {
  // 1. Empty / whitespace-only.
  if (!amountStr.trim()) {
    throw new InvalidAmountError("amount cannot be empty", "empty");
  }

  // 2. Strict regex — only [0-9]+(\.[0-9]+)? shapes accepted.
  if (!/^[0-9]+(\.[0-9]+)?$/.test(amountStr)) {
    throw new InvalidAmountError(
      `amount must match /^[0-9]+(\\.[0-9]+)?$/; got "${amountStr}"`,
      "format",
    );
  }

  // 3. Fractional-digit overflow against the resolved token decimals.
  const dotIdx = amountStr.indexOf(".");
  let wholePart: string;
  let fracPart: string;
  if (dotIdx === -1) {
    wholePart = amountStr;
    fracPart = "";
  } else {
    wholePart = amountStr.slice(0, dotIdx);
    fracPart = amountStr.slice(dotIdx + 1);
    if (fracPart.length > decimals) {
      throw new InvalidAmountError(
        `amount has ${fracPart.length} fractional digits but token decimals=${decimals}; ` +
          `naive scaling would silently round. Truncate to ${decimals} decimals or correct the amount.`,
        "fractional-overflow",
      );
    }
  }

  // Right-pad the fractional part to `decimals` so the concatenation is the
  // integer-scaled representation. e.g. ("1", "5", decimals=9) → "1500000000".
  const fracPadded = fracPart.padEnd(decimals, "0");
  const scaledStr = wholePart + fracPadded;
  const scaled = BigInt(scaledStr);

  // 4. u64-overflow guard. RAO / ALPHA are u64 on-wire.
  if (scaled > U64_MAX) {
    throw new InvalidAmountError(
      `amount "${amountStr}" scales to ${scaled.toString()} which exceeds u64 max (${U64_MAX.toString()})`,
      "u64-overflow",
    );
  }

  return scaled;
}
