// parseSolanaAmountStrict — Solana sibling of `src/signing/amount.ts`
// (`parseAmountStrict`). Phase 12 — Plan 12-02.
//
// Why a sibling rather than extending the EVM module: the EVM `parseAmountStrict`
// delegates to `viem.parseUnits` (which handles the wei boundary; viem is
// EVM-only and not in the Solana SDK graph). The Solana sibling re-implements
// the same strict-regex pre-filter + decimal arithmetic without the viem
// dependency. The delegation invariant (accepted-input parity with the EVM
// branch's `parseAmountStrict(X, D) === parseUnits(X, D)`) is preserved by
// hand-rolling the same arithmetic in `bigint` space.
//
// Two consumer shapes (CRITICAL caller-side discipline):
//
//   - `prepare_solana_native_send` (Plan 12-02): `lamports` arg is RAW
//     LAMPORTS (decimals=0). The handler validates the integer shape via
//     `parseSolanaAmountStrict(args.lamports, 0)` and uses the resulting
//     `bigint` directly. 1 SOL = 1_000_000_000 raw lamports.
//
//   - `prepare_solana_spl_send` (Plan 12-03): `amount` arg is HUMAN UNITS
//     (e.g. `"100.5"` for 100.5 USDC). The handler resolves the mint's
//     `decimals` via `getMintDecimals(args.mint)` and calls
//     `parseSolanaAmountStrict(args.amount, mintDecimals)`.
//
// Same rejection ladder as `parseAmountStrict` (empty / format / fractional-
// overflow) plus a Solana-specific u64-overflow rejection (lamports is u64;
// the on-wire format truncates anything larger). Off-by-decimal is the most
// common user-facing bug class per CLAUDE.md "Decimal-aware arithmetic".

/**
 * `2^64 - 1` — the maximum representable lamports value on the wire.
 * `SystemProgram.transfer` accepts a `bigint` larger than this client-side,
 * but the on-chain serialization truncates to u64. Reject server-side so
 * the user never sees a silent overflow attack vector at prepare time.
 */
const U64_MAX: bigint = (1n << 64n) - 1n;

/**
 * Distinct error class so callers can `instanceof`-match without coupling to
 * a generic `Error`. THROW-shape (parseSolanaAmountStrict throws
 * synchronously); the caller (a prepare_solana_* tool handler) catches and
 * converts to the structured `errEnvelope("INVALID_INPUT", ...)` shape at
 * the tool boundary.
 *
 * `kind` discriminator lets the prepare-tool layer emit different user-facing
 * messages without re-parsing the error.message string. Sibling shape to
 * `InvalidAmountError` from `src/signing/amount.ts`; both expose
 * `{ name: "InvalidAmountError", kind, message }` and are interchangeable
 * at the structured-envelope boundary.
 *
 * `u64-overflow` is Solana-specific — added because lamports is a u64
 * on-wire; the EVM `wei` field is a uint256 and overflow at that boundary
 * is unrepresentable practically.
 */
export class InvalidAmountError extends Error {
  readonly kind: "empty" | "format" | "fractional-overflow" | "u64-overflow";
  constructor(
    message: string,
    kind: "empty" | "format" | "fractional-overflow" | "u64-overflow",
  ) {
    super(message);
    this.name = "InvalidAmountError";
    this.kind = kind;
  }
}

/**
 * Strict pre-validation guard for Solana token amounts.
 *
 * Four-step gate (mirrors `parseAmountStrict` shape + u64-overflow):
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
 *      (the load-bearing off-by-decimal guard — passing decimal SOL like
 *      "1.5" into a decimals=0 lamports field would silently round to 1
 *      lamport via naive parsing; we reject explicitly)
 *   4. u64-overflow check (lamports/SPL is u64 on-wire) →
 *      InvalidAmountError(kind: "u64-overflow")
 *
 * Accepts and returns the integer-bigint scaling for:
 *   - integer-only digit strings   "100"
 *   - decimal strings with ≤ decimals   "100.5", "1.123456" (decimals=6)
 *   - "0"
 *
 * @throws InvalidAmountError on any rejected input.
 */
export function parseSolanaAmountStrict(
  amountStr: string,
  decimals: number,
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

  // 4. u64-overflow guard. Solana lamports + SPL token amounts are u64
  // on-wire; the SDK accepts a larger bigint client-side and silently
  // truncates at serialization time. Reject explicitly so the user never
  // sees a value at prepare time that wouldn't survive the on-wire
  // encoding.
  if (scaled > U64_MAX) {
    throw new InvalidAmountError(
      `amount "${amountStr}" scales to ${scaled.toString()} which exceeds u64 max (${U64_MAX.toString()})`,
      "u64-overflow",
    );
  }

  return scaled;
}
