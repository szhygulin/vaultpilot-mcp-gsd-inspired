// Phase 4 + Phase 5 structured error codes — single source of truth.
//
// Locked set (14 codes — research § Q15's 12 + DEMO_MODE_REFUSED lifted from
// Phase 3 DEMO-06 precedent + WRONG_MODE added in Plan 05-01). Adding/removing
// a code is a type-level breaking change: downstream plans' exhaustive
// `switch` statements over `ErrorCode` fail to typecheck, surfacing the
// omission BEFORE merge. Anti-foot-gun.
//
// Producer map (where each code is emitted — kept in sync with the plan):
//
//   WALLET_NOT_PAIRED        — Plans 04-02 (prepare_native_send),
//                              04-03 (preview_send),
//                              04-04 (send_transaction)
//                              (`session-manager.getStatus()` returned null)
//   HANDLE_NOT_FOUND         — Plans 04-03, 04-04, 04-05 (handle-store lookup miss)
//   HANDLE_EXPIRED           — Plans 04-03, 04-04, 04-05 (lookup past 15-min TTL)
//   WRONG_STATUS             — Plans 04-03, 04-04 (illegal state-machine transition)
//   PREVIEW_REQUIRED         — Plan 04-04 (send_transaction on prepared, not previewed handle)
//   PREVIEW_TOKEN_MISMATCH   — Plan 04-04 (args.previewToken !== record.pinned.previewToken)
//   PAYLOAD_FINGERPRINT_DRIFT — Plan 04-04 (PREP-08 — should be unreachable absent state corruption)
//   LEDGER_REJECTED          — Plan 04-04 (signClient.request reject — WC 5000 / "User rejected")
//   BROADCAST_FAILED         — Plan 04-04 (signClient.request reject — nonce / underpriced / relay)
//   USER_CANCELLED           — Plan 04-04 (userDecision: "cancel" — non-error structured exit)
//   DEMO_MODE_REFUSED        — Plans 04-02, 04-03, 04-04, 04-05
//                              (VAULTPILOT_DEMO=true — matches Phase 3 DEMO-06 precedent)
//   INVALID_INPUT            — All Plans 04-02..05 + 05-01 (defense-in-depth slug check)
//   INTERNAL_ERROR           — All Plans 04-02..05 + 05-01 (defensive catch-all — NOT a demo-mode fallback)
//   WRONG_MODE               — Plan 05-01 (set_demo_wallet called outside demo mode —
//                              T-PERSONA-CONFUSION-1 mitigation; state NOT mutated.
//                              Phase 5+ tools needing a similar mode check reuse the code
//                              via `makeStructuredError`.)

export type ErrorCode =
  | "WALLET_NOT_PAIRED"
  | "HANDLE_NOT_FOUND"
  | "HANDLE_EXPIRED"
  | "WRONG_STATUS"
  | "PREVIEW_REQUIRED"
  | "PREVIEW_TOKEN_MISMATCH"
  | "PAYLOAD_FINGERPRINT_DRIFT"
  | "LEDGER_REJECTED"
  | "BROADCAST_FAILED"
  | "USER_CANCELLED"
  | "DEMO_MODE_REFUSED"
  | "INVALID_INPUT"
  | "INTERNAL_ERROR"
  | "WRONG_MODE";

/**
 * Uniform structured-error envelope shape that all Phase 4 tool handlers
 * return inside `{ isError: true, content: [...], structuredContent: ... }`.
 * `cause` is an optional debug field — used by `BROADCAST_FAILED` and
 * `LEDGER_REJECTED` to attach the upstream WalletConnect error message
 * verbatim.
 */
export interface StructuredError {
  errorCode: ErrorCode;
  message: string;
  cause?: string;
}

/**
 * Build a `StructuredError`. Pure constructor — used by downstream plans to
 * keep envelope shape uniform across the four signing-flow tools.
 */
export function makeStructuredError(code: ErrorCode, message: string, cause?: string): StructuredError {
  if (cause !== undefined) {
    return { errorCode: code, message, cause };
  }
  return { errorCode: code, message };
}
