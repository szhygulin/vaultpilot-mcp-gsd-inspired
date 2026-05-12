// Shared WalletConnect error predicates.
//
// Extracted from `src/wallet/session-manager.ts` in Plan 04-04 because the
// Phase 3 pair flow + Phase 4 send flow both need the SAME predicate to
// distinguish user-rejected interactions (route to a domain error /
// `LEDGER_REJECTED` structured refusal) from other operational failures
// (route to `BROADCAST_FAILED` / generic error propagation).
//
// The WalletConnect SDK signals user rejection two equivalent ways across
// versions and surfaces:
//
//   1. `{ code: 5000, message: "User rejected." }` — the canonical
//      SDK_ERRORS.USER_REJECTED shape from `@walletconnect/utils`.
//   2. Any error whose `.message` contains the case-insensitive substring
//      "user rejected" — Ledger Live + other wallet UIs sometimes emit
//      slightly varied prose without the numeric code.
//
// Phase 3 verified both shapes against `@walletconnect/utils@2.23.9`;
// Plan 04-04 inherits the predicate verbatim. Tests live in
// `test/wallet-session-manager.test.ts` (the user-rejected pair path) +
// `test/send-transaction.test.ts` (the user-rejected send path); both
// exercise this predicate transitively.

/**
 * Predicate: does this WC error represent a user-rejected interaction?
 *
 * Returns true for:
 *   - `err.code === 5000` (WC SDK_ERRORS.USER_REJECTED canonical code)
 *   - any error whose `err.message` matches `/user rejected/i`
 *
 * Returns false for null / non-objects / errors without those signals.
 */
export function isUserRejectedError(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const candidate = err as { code?: unknown; message?: unknown };
  if (candidate.code === 5000) return true;
  if (typeof candidate.message === "string" && /user rejected/i.test(candidate.message)) {
    return true;
  }
  return false;
}
