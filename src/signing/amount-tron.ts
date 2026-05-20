// parseTronAmountStrict — TRON sibling of `src/signing/amount-solana.ts`
// (`parseSolanaAmountStrict`). Phase 18 — Plan 18-01.
//
// Why a sibling rather than extending the Solana module: the Solana sibling is
// u64-only (lamports / SPL amounts are both u64 on-wire). TRON requires BOTH
// u64 (native TRX sun — int64 on-wire, effectively u64 for positive amounts)
// AND u256 (TRC-20 token amounts — ABI-identical uint256 to ERC-20). The
// `overflowBound` arg discriminates at call time, avoiding two separate helper
// functions that share 95% of their body.
//
// Two consumer shapes (CRITICAL caller-side discipline):
//
//   - `prepare_tron_native_send` (Plan 18-02): `sun` arg is RAW SUN (decimals=0).
//     The handler validates via `parseTronAmountStrict(args.sun, 0, "u64")` and
//     uses the resulting `bigint` directly. 1 TRX = 1_000_000 raw sun (6-decimal
//     native — distinct from Solana's 9-decimal lamports).
//
//   - `prepare_tron_trc20_send` (Plan 18-03): `amount` arg is HUMAN UNITS
//     (e.g. `"100.5"` for 100.5 USDT-TRC20). The handler resolves the token's
//     `decimals` via `get_tron_token_metadata` and calls
//     `parseTronAmountStrict(args.amount, tokenDecimals, "u256")`.
//
// Same rejection ladder as `parseSolanaAmountStrict` (empty / format /
// fractional-overflow / overflow) plus the `overflowBound` arg to
// discriminate between u64 (native TRX) and u256 (TRC-20). Off-by-decimal
// is the most common user-facing bug class per CLAUDE.md "Decimal-aware
// arithmetic". The `u256-overflow` kind is added here (Solana had only
// `u64-overflow`); EVM's uint256 overflow is practically unrepresentable
// but must be guarded for TRC-20 ABI conformance.

/**
 * `2^64 - 1` — the maximum representable sun value on the wire.
 * TRON's `TransferContract` uses an `int64 amount` field in Protobuf; positive
 * values are bounded by this constant. Reject server-side so the user never
 * sees a silent overflow attack vector at prepare time.
 */
export const U64_MAX: bigint = (1n << 64n) - 1n;

/**
 * `2^256 - 1` — the maximum representable uint256 value for TRC-20 token
 * amounts. TRC-20 token amounts are ABI-identical to ERC-20 uint256. Reject
 * server-side for conformance; practically unrepresentable for real-world
 * token supplies but the guard is load-bearing for input sanitization.
 */
export const U256_MAX: bigint = (1n << 256n) - 1n;

/**
 * Distinct error class so callers can `instanceof`-match without coupling to
 * a generic `Error`. THROW-shape (parseTronAmountStrict throws synchronously);
 * the caller (a prepare_tron_* tool handler) catches and converts to the
 * structured `errEnvelope("INVALID_INPUT", ...)` shape at the tool boundary.
 *
 * `kind` discriminator lets the prepare-tool layer emit different user-facing
 * messages without re-parsing the error.message string. Sibling shape to
 * `InvalidAmountError` from `src/signing/amount.ts` and
 * `src/signing/amount-solana.ts`; all three expose
 * `{ name: "InvalidAmountError", kind, message }` and are interchangeable
 * at the structured-envelope boundary.
 *
 * `u64-overflow` matches the Solana sibling (lamports / native TRX sun are
 * both u64 on-wire). `u256-overflow` is TRON-specific — added for TRC-20
 * token amounts (ABI uint256; not a practical concern for real token supplies
 * but required for correct ABI-conformance validation).
 */
export class InvalidAmountError extends Error {
  readonly kind:
    | "empty"
    | "format"
    | "fractional-overflow"
    | "u64-overflow"
    | "u256-overflow";

  constructor(
    message: string,
    kind:
      | "empty"
      | "format"
      | "fractional-overflow"
      | "u64-overflow"
      | "u256-overflow",
  ) {
    super(message);
    this.name = "InvalidAmountError";
    this.kind = kind;
  }
}

/**
 * Strict pre-validation guard for TRON token amounts.
 *
 * Four-step gate (mirrors `parseSolanaAmountStrict` shape + overflowBound):
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
 *      (the load-bearing off-by-decimal guard — passing decimal TRX like
 *      "1.5" into a decimals=0 sun field would silently round to 1 sun via
 *      naive parsing; we reject explicitly)
 *   4. Overflow check against `overflowBound`:
 *      - "u64"  → U64_MAX guard → InvalidAmountError(kind: "u64-overflow")
 *      - "u256" → U256_MAX guard → InvalidAmountError(kind: "u256-overflow")
 *
 * Accepts and returns the integer-bigint scaling for:
 *   - integer-only digit strings   "100"
 *   - decimal strings with ≤ decimals   "100.5", "1.123456" (decimals=6)
 *   - "0"
 *
 * @param amountStr    — raw agent string (decimal representation of the amount).
 * @param decimals     — token decimals (0 for native TRX sun; 6 for USDT-TRC20; etc.).
 * @param overflowBound — "u64" for native TRX sun; "u256" for TRC-20 token amounts.
 * @throws InvalidAmountError on any rejected input.
 */
export function parseTronAmountStrict(
  amountStr: string,
  decimals: number,
  overflowBound: "u64" | "u256",
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
  // integer-scaled representation. e.g. ("100", "5", decimals=6) → "100500000".
  const fracPadded = fracPart.padEnd(decimals, "0");
  const scaledStr = wholePart + fracPadded;
  // Empty-scaled is only possible when both whole+frac are empty — already
  // rejected at step 2. Defense-in-depth: a zero-length string would parse
  // to `0n` via BigInt, but the regex above guarantees at least one digit.
  const scaled = BigInt(scaledStr);

  // 4. Overflow guard — discriminated by overflowBound.
  if (overflowBound === "u64") {
    // Native TRX sun is int64 on-wire (TransferContract.amount field in Protobuf).
    // Positive amounts are bounded by U64_MAX; reject explicitly so the user
    // never sees a value at prepare time that wouldn't survive the on-wire encoding.
    if (scaled > U64_MAX) {
      throw new InvalidAmountError(
        `amount "${amountStr}" scales to ${scaled.toString()} which exceeds u64 max (${U64_MAX.toString()})`,
        "u64-overflow",
      );
    }
  } else {
    // TRC-20 token amounts are ABI uint256 — guard for conformance. Practically
    // unrepresentable for real token supplies but required for correctness.
    if (scaled > U256_MAX) {
      throw new InvalidAmountError(
        `amount "${amountStr}" scales to ${scaled.toString()} which exceeds u256 max`,
        "u256-overflow",
      );
    }
  }

  return scaled;
}
