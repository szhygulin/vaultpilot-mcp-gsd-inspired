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
//   RATE_LIMIT_EXCEEDED      — Phase 10 Plan 10-04 (DIST-43) — fires when
//                              the 3-per-hour sliding-window rate-limit is
//                              exhausted for `request_capability`. The
//                              `cause` field carries `retryAfterMs` as a
//                              decimal string (agent consumers parse it
//                              back to number). Per-process restart resets
//                              the counter — Assumption A5 documented
//                              residual (friction-not-fortress; bypass
//                              cost is restarting the MCP server and
//                              losing the paired Ledger session-topic).
//   SIMULATION_REFUSED       — Phase 12 Plan 12-04 — Solana preview_send Layer
//                              0.7 mandatory simulation gate refusal. Fires
//                              when `simulateTransaction.err !== null`
//                              (DF-4 lock). EVM simulation stays advisory;
//                              this code is Solana-specific. Reuse
//                              `BROADCAST_FAILED` for the Solana
//                              `connection.sendRawTransaction` failure
//                              path (Plan 12-05) — generic enough per
//                              RESEARCH OQ-3.
//   LEDGER_NOT_CONNECTED     — Phase 12 Plan 12-05 — Solana `send_transaction`
//                              USB-HID open-time refusal: `node-hid` is
//                              unavailable OR no Ledger device is enumerated.
//                              EVM Ledger flow surfaces this via WC pairing
//                              loss (WALLET_NOT_PAIRED); Solana surfaces it
//                              at the transport-open step. Recovery: connect
//                              the Ledger, unlock it, open the Solana app,
//                              retry. Sibling EVM-side refusal: WC relay
//                              would fire BROADCAST_FAILED instead.
//   SOLANA_APP_NOT_OPEN      — Phase 12 Plan 12-05 — Solana `send_transaction`
//                              USB-HID first-APDU refusal: transport opens
//                              but `getAppConfiguration()` rejects, meaning
//                              the active app on the device is not Solana.
//                              Distinct from `LEDGER_NOT_CONNECTED` (device
//                              reachable; wrong app). Recovery: open the
//                              Solana app on the device, retry. Solana-
//                              specific; no EVM equivalent.

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
  | "DECODE_DIVERGENCE"
  | "RATE_LIMIT_EXCEEDED"
  | "SIMULATION_REFUSED"
  | "LEDGER_NOT_CONNECTED"
  | "SOLANA_APP_NOT_OPEN"
  //
  // Phase 23 Plan 23-03 — BTC-specific error codes (additive; do NOT
  // renumber or remove any existing code above).
  //
  //   BTC_DUST_OUTPUT           — Recipient output is below the BIP-141 dust
  //                               threshold (~330 sats segwit, ~546 sats legacy).
  //                               Refused at prepare time (D-07). Note: below-dust
  //                               CHANGE is folded into the fee (not refused) —
  //                               this code is RECIPIENT-only.
  //   BTC_FEE_RATE_OUT_OF_BOUNDS — feeRate < 1 sat/vB or > 10× current high-priority
  //                               estimate. Decimal-place-mistake defense (D-03).
  //   BTC_NO_UTXOS_AVAILABLE    — The paired BTC account has no spendable UTXOs,
  //                               or the UTXO set is insufficient for the requested
  //                               amount + fee. Recovery: check on-chain balance.
  //   BTC_MIXED_INPUT_SIGN_FAILURE — The two-pass signPsbtBuffer + Psbt.combine
  //                               flow (DF-3 workaround — Pattern 3) failed to
  //                               combine the partial signatures. Surfaces in the
  //                               Phase 23-04 send_transaction BTC branch. Not
  //                               emitted by the Phase 23-03 prepare tool.
  //   BTC_APP_NOT_OPEN             — USB-HID transport opens but the active app on
  //                               the Ledger is not Bitcoin (mirrors
  //                               SOLANA_APP_NOT_OPEN). Recovery: open the Bitcoin
  //                               app on the device and retry. WR-04 fix.
  | "BTC_DUST_OUTPUT"
  | "BTC_FEE_RATE_OUT_OF_BOUNDS"
  | "BTC_NO_UTXOS_AVAILABLE"
  | "BTC_MIXED_INPUT_SIGN_FAILURE"
  | "BTC_APP_NOT_OPEN"
  //
  // Phase 24 Plan 24-01 — RBF error codes (additive).
  //
  //   BTC_TX_ALREADY_CONFIRMED  — prepare_btc_rbf_bump refused: txid is
  //                               confirmed (RBF is mempool-only). Hint: use
  //                               CPFP (deferred to future plan) for confirmed-
  //                               parent fee bumps. (T-24-01 mitigation)
  //   BTC_NOT_RBF_SIGNALLED     — prepare_btc_rbf_bump refused: original tx
  //                               does not signal RBF (all inputs have
  //                               sequence >= 0xfffffffe). Hint: use
  //                               signalRbf: true on future prepare_btc_send.
  //                               (T-24-02 mitigation)
  //   BTC_RBF_INSUFFICIENT_FEE_RATE — new fee rate is not strictly higher than
  //                               original by at least 1 sat/vB (BIP-125 Rule 4).
  //                               Server computes original rate independently
  //                               from Esplora data. (T-24-04 mitigation)
  //   BTC_RBF_NO_CHANGE_OUTPUT  — original tx has no change output whose
  //                               scriptpubkey_address matches a paired BTC
  //                               account address; cannot absorb the fee delta.
  //   BTC_RBF_CANNOT_AFFORD     — fee delta exceeds the change output value
  //                               (new change would go negative); cannot bump
  //                               without adding inputs (which BIP-125 Rule 2
  //                               forbids in a pure fee bump). (T-24-03 mitigation)
  | "BTC_TX_ALREADY_CONFIRMED"
  | "BTC_NOT_RBF_SIGNALLED"
  | "BTC_RBF_INSUFFICIENT_FEE_RATE"
  | "BTC_RBF_NO_CHANGE_OUTPUT"
  | "BTC_RBF_CANNOT_AFFORD";

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
