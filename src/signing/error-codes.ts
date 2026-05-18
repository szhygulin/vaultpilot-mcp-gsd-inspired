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
//   INVALID_ACCOUNT          — `set_active_account` (requested address is not in
//                              the live WC session's approved set; surfaces the
//                              in-session list so the agent can self-correct
//                              without a second tool call).
//   CHAIN_ID_MISMATCH        — Phase 8 Plan 08-02 — Layer 2 defense-in-depth at
//                              `preview_send` + `send_transaction` when the
//                              agent's optional `chain` arg disagrees with the
//                              chainId bound into the prepared transaction.
//                              ONE code for any chain-discrepancy refusal
//                              regardless of layer (research § line 926 lock).
//   SKILL_INTEGRITY_FAILURE  — Phase 9 Plan 09-02 — companion `vaultpilot-
//                              preflight` skill probe fails: SKILL.md missing
//                              at every probe path OR SHA-256 does not match
//                              `EXPECTED_SKILL_SHA256`. NOT emitted as a
//                              refusal envelope — surfaces via the
//                              `VAULTPILOT NOTICE` dispatcher-wrap prepend on
//                              the first tool response of the session. The
//                              code exists for the diagnostics surface
//                              (`get_vaultpilot_config_status.skillIntegrity`)
//                              and for skill-side test scaffolding.
//   DISPATCH_TARGET_REFUSED  — Phase 9 Plan 09-04 — Layer 0.5 preview_send
//                              refusal when `record.tx.to` is not in
//                              `CANONICAL_DISPATCH_TARGETS` for the bound
//                              chain. Fires for contract calls only —
//                              native sends (`record.tx.data === "0x"`)
//                              bypass per RESEARCH § Topic 6 lock. Layer 0.5
//                              fires BEFORE Phase 8 Layer 2 chain-name
//                              mismatch (a refusal that triggers BOTH
//                              surfaces DISPATCH_TARGET_REFUSED first — the
//                              more fundamental issue).
//   DECODE_DIVERGENCE        — Phase 9 Plan 09-05 — `verify_tx_decode`
//                              divergence arm. NOT auto-emitted as a refusal
//                              envelope per se; the tool returns the
//                              divergence list in structuredContent and the
//                              agent's decision-policy + skill enforcement
//                              determine halt-or-proceed. The code exists for
//                              uniform envelope discipline (downstream
//                              telemetry / diagnostics surfaces).

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
  | "WRONG_MODE"
  | "INVALID_ACCOUNT"
  | "CHAIN_ID_MISMATCH"
  | "SKILL_INTEGRITY_FAILURE"
  | "DISPATCH_TARGET_REFUSED"
  | "DECODE_DIVERGENCE";

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
