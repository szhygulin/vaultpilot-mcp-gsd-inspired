// parseAmountStrict — load-bearing decimal-overflow guard for ERC-20 prepare tools.
//
// Phase 6 — Plan 06-01. DF-2 LOCKED placement: lives on the `src/signing/` shelf
// next to payload-fingerprint.ts / presign-hash.ts / handle-store.ts so the four
// downstream prepare tools (06-02 prepare_token_send, 06-03 prepare_token_approve
// + prepare_revoke_approval, 06-04 prepare_weth_unwrap) import from one canonical
// location.
//
// Why this exists: `viem.parseUnits` is the wrong PRIMARY overflow guard.
// Empirically verified at /tmp/viem-probe (research § Topic 3 § A1, 2026-05-12):
//   parseUnits("100.5", 0)      → 101n     // SILENT ROUND — off-by-decimal
//   parseUnits("", 18)          → 0n       // empty string silently accepted
//   parseUnits("-1", 18)        → -1e18n   // negative silently accepted
//   parseUnits(".5", 18)        → 5e17n    // leading dot silently accepted
//   parseUnits("100.", 18)      → 1e20n    // trailing dot silently accepted
//   parseUnits("1e6", 18)       → THROWS InvalidDecimalNumberError
//   parseUnits("1,000", 18)     → THROWS InvalidDecimalNumberError
//   parseUnits("abc", 18)       → THROWS InvalidDecimalNumberError
//
// The strict-regex pre-filter rejects the 9 known weakness cases (empty,
// whitespace-only, leading-dot, trailing-dot, multi-dot, negative,
// scientific notation, comma-grouped, alpha, and — most importantly —
// fractional-overflow against the resolved token decimals).
//
// Delegation invariant: for every ACCEPTED input X with decimals D,
//   parseAmountStrict(X, D) === parseUnits(X, D)
// The strict guard is a pre-filter, NEVER a re-implementation. This is what
// the test suite's case-1..4 delegation cross-check (parse-amount-strict.test.ts)
// pins as a regression contract.

import { parseUnits } from "viem";

/**
 * Distinct error class so callers can `instanceof`-match without coupling to
 * a generic Error. THROW-shape (parseAmountStrict throws synchronously); the
 * caller (a prepare_* tool handler) catches and converts to the structured
 * `errEnvelope("INVALID_INPUT", ...)` shape at the tool boundary.
 *
 * `kind` discriminator lets the prepare-tool layer emit different user-facing
 * messages without re-parsing the error.message string.
 */
export class InvalidAmountError extends Error {
  readonly kind: "empty" | "format" | "fractional-overflow";
  constructor(message: string, kind: "empty" | "format" | "fractional-overflow") {
    super(message);
    this.name = "InvalidAmountError";
    this.kind = kind;
  }
}

/**
 * Strict pre-validation guard before `viem.parseUnits`.
 *
 * Three-step gate:
 *   1. Empty / whitespace-only check     → InvalidAmountError(kind: "empty")
 *   2. Strict regex `^[0-9]+(\.[0-9]+)?$` rejects:
 *      - leading dot ".5"
 *      - trailing dot "100."
 *      - multi-dot "1.2.3"
 *      - negative "-1"
 *      - scientific notation "1e6"
 *      - comma-grouped "1,000"
 *      - alpha "abc"
 *      → InvalidAmountError(kind: "format")
 *   3. Fractional-digit count check      → InvalidAmountError(kind: "fractional-overflow")
 *      (the load-bearing off-by-decimal guard: T-PARSE-AMOUNT-1 mitigation —
 *      project CLAUDE.md "Decimal-aware arithmetic" rule, the most common
 *      user-facing bug class)
 *
 * Accepts and delegates byte-identically to `viem.parseUnits` for:
 *   - integer-only digit strings   "100"
 *   - decimal strings with ≤ decimals   "100.5", "1.123456" (decimals=6)
 *   - "0"
 *
 * @throws InvalidAmountError on any rejected input.
 */
export function parseAmountStrict(amountStr: string, decimals: number): bigint {
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
  if (dotIdx !== -1) {
    const fractionalDigits = amountStr.length - dotIdx - 1;
    if (fractionalDigits > decimals) {
      throw new InvalidAmountError(
        `amount has ${fractionalDigits} fractional digits but token decimals=${decimals}; ` +
          `viem.parseUnits would silently round. Truncate to ${decimals} decimals or correct the amount.`,
        "fractional-overflow",
      );
    }
  }

  // 4. Delegate to viem.parseUnits — guaranteed safe for accepted shapes.
  return parseUnits(amountStr, decimals);
}
