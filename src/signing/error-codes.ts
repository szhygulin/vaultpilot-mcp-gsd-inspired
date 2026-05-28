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
  | "BTC_RBF_CANNOT_AFFORD"
  //
  // Phase 25 Plan 25-01 — BTC multisig error codes (additive).
  // APPEND-ONLY — do not reorder existing codes above.
  //
  //   PSBT_COMBINE_CONFLICT         — combine_btc_psbts detected same-key
  //                                   same-input conflicting signatures in two
  //                                   input PSBTs. Surfaces inputIndex +
  //                                   pubkeyHex + both sig hexes. (Plan 25-02)
  //   PSBT_THRESHOLD_NOT_MET        — finalize_btc_psbt refused: one or more
  //                                   inputs have fewer than M partial
  //                                   signatures. Lists under-threshold input
  //                                   indices. (Plan 25-02)
  //   MULTISIG_WALLET_NOT_FOUND     — get_btc_multisig_balance / _utxos /
  //                                   sign_btc_multisig_psbt: walletName not
  //                                   found in btc-multisig.json registry.
  //   MULTISIG_WALLET_NOT_REGISTERED_ON_DEVICE — sign_btc_multisig_psbt:
  //                                   walletHmac absent from registry record
  //                                   (device was not connected at register
  //                                   time). Recovery: re-run
  //                                   register_btc_multisig_wallet with device
  //                                   connected. (Plan 25-03)
  //   LEDGER_BTC_APP_VERSION_TOO_OLD — registerWallet APDU rejected; BTC app
  //                                   < v2.1. Recovery: update Ledger Live to
  //                                   get BTC app 2.1+. (Plan 25-03)
  //   MULTISIG_DESCRIPTOR_INVALID   — descriptor string did not match
  //                                   wsh(sortedmulti(M, ...)) form, or M > N,
  //                                   or M < 1, or key expression not using
  //                                   /** suffix form.
  | "PSBT_COMBINE_CONFLICT"
  | "PSBT_THRESHOLD_NOT_MET"
  | "MULTISIG_WALLET_NOT_FOUND"
  | "MULTISIG_WALLET_NOT_REGISTERED_ON_DEVICE"
  | "LEDGER_BTC_APP_VERSION_TOO_OLD"
  | "MULTISIG_DESCRIPTOR_INVALID"
  //
  // Phase 26 Plan 26-03 — BTC LiFi bridge error codes (additive).
  // APPEND-ONLY — do not reorder existing codes above.
  //
  //   LIFI_NO_ROUTE       — prepare_btc_lifi_swap: LiFi returned HTTP 404 (no route
  //                         for the requested BTC→toChain swap). Recovery: try a
  //                         different toChain / toToken, or check LiFi availability.
  //   RECIPIENT_MISMATCH  — prepare_btc_lifi_swap: Inv#6b assertion failed —
  //                         quote.action.toAddress.toLowerCase() !== params.toAddress.toLowerCase().
  //                         A tampered or malicious LiFi route redirected funds to a
  //                         different recipient. Handle NOT created. (T-26-10 mitigation)
  | "LIFI_NO_ROUTE"
  | "RECIPIENT_MISMATCH"
  //
  // Phase 26 Plan 26-01 — LTC pairing error codes (additive).
  // APPEND-ONLY — do not reorder existing codes above.
  //
  //   LITECOIN_APP_NOT_OPEN — pair_litecoin_ledger / sign_message_ltc: transport
  //                           opens but the active app on the Ledger is not
  //                           Litecoin. Recovery: open the Litecoin app on the
  //                           device, retry. Mirrors BTC_APP_NOT_OPEN +
  //                           SOLANA_APP_NOT_OPEN.
  //   APPROVAL_TIMEOUT      — pair_litecoin_ledger: device did not approve the
  //                           address fetch within the 60-second window. Recovery:
  //                           re-call pair_litecoin_ledger and approve on device.
  //   USER_REJECTED         — pair_litecoin_ledger: user rejected the pairing
  //                           request on the Ledger device (APDU 0x6985).
  //                           Non-error structured exit — analogous to USER_CANCELLED.
  | "LITECOIN_APP_NOT_OPEN"
  | "APPROVAL_TIMEOUT"
  | "USER_REJECTED"
  //
  // Phase 35 Plan 35-01 — get_contract_abi / fetchEtherscanAbi ABI fetch
  // failure (reserved here so Plan 35-02 `read_contract` can reuse the
  // same code without touching the file in parallel).
  //
  //   ABI_NOT_AVAILABLE  — fetchEtherscanAbi returned not-verified, the
  //                        requested function is missing from the ABI, or
  //                        the verified contract on Etherscan has an ABI
  //                        that does not match the request shape. Distinct
  //                        from INTERNAL_ERROR (which surfaces transient
  //                        network failure) — ABI_NOT_AVAILABLE is the
  //                        persistent "we asked, the answer is no ABI".
  | "ABI_NOT_AVAILABLE"
  //
  // Phase 35 Plan 35-02 — read_contract refuses state-mutating function.
  //
  //   NON_VIEW_FUNCTION   — read_contract gating: the requested function's
  //                         ABI entry has stateMutability ∉ {view, pure}.
  //                         Refusal directs the agent to prepare_custom_call
  //                         (which bypasses canonical-dispatch and requires
  //                         the load-bearing acknowledgeNonProtocolTarget
  //                         flag — Plan 35-03). Distinct from
  //                         ABI_NOT_AVAILABLE (which is "function not in
  //                         ABI at all") — NON_VIEW_FUNCTION fires when the
  //                         function IS in the ABI but is state-mutating.
  | "NON_VIEW_FUNCTION"
  //
  // Phase 35 Plan 35-03 — prepare_custom_call escape-hatch acknowledgment gate.
  //
  //   NON_PROTOCOL_TARGET_NOT_ACKNOWLEDGED — prepare_custom_call invoked
  //                        without `acknowledgeNonProtocolTarget: true`. The
  //                        JSON-Schema literal-true gate
  //                        (`{ const: true, type: "boolean" }`) at the
  //                        dispatch boundary catches `false` BEFORE the
  //                        handler runs; the handler-side check covers the
  //                        `undefined` / missing case (defense-in-depth).
  //                        Refusal text uses NON_PROTOCOL_TARGET_REFUSAL_TEMPLATE
  //                        and surfaces a canonical-alternative suggestion
  //                        via `lookupCanonicalAlternative(selector)` when
  //                        the data's selector matches a known
  //                        protocol-aware prepare_* tool.
  | "NON_PROTOCOL_TARGET_NOT_ACKNOWLEDGED"
  //
  // Phase 37 Plan 37-01 — Safe multisig signing-flow refusal codes.
  //
  //   UNSUPPORTED_SAFE_VERSION — prepare_safe_tx_propose refused: on-chain
  //                        Safe.VERSION() is NOT one of "1.3.0" / "1.4.1".
  //                        Pre-v1.3.0 Safes have an EIP-712 domain WITHOUT
  //                        chainId → cross-chain replay risk. v2.5 explicitly
  //                        refuses these. Recovery hint: re-deploy via the
  //                        Safe UI to v1.3.0+ or use a different Safe.
  | "UNSUPPORTED_SAFE_VERSION"
  //
  // Phase 37 Plan 37-02 — Safe multisig submit signature refusal codes.
  //
  //   INVALID_SIGNATURE_MODE — submit_safe_tx_signature refused: signature's
  //                        v-byte is in {0, 1} (EIP-1271 contract signature
  //                        or pre-approved hash mode). Phase 37 accepts ONLY
  //                        ECDSA (v ∈ {27, 28}) and Safe's eth_sign mode
  //                        (v ∈ {31, 32}). Contract signatures + pre-approved
  //                        hashes are deferred to v3.x. T-37-13 mitigation.
  //   WRONG_HANDLE_KIND     — Reserved for Plan 37-03's send_transaction +
  //                        preview_send refusal arms when a Safe-typed-data
  //                        handle is routed through the on-chain dispatch
  //                        path (off-chain typed-data signatures do NOT
  //                        broadcast). Plan 37-02 declares the code; Plan
  //                        37-03 wires the consumers.
  | "INVALID_SIGNATURE_MODE"
  | "WRONG_HANDLE_KIND"
  //
  // Phase 37 Plan 37-03 — Safe multisig execute refusal codes.
  //
  //   INSUFFICIENT_SIGNATURES — prepare_safe_tx_execute refused: the number
  //                        of collected confirmations from the Tx Service is
  //                        strictly less than the current on-chain threshold.
  //                        Client-side early refusal so the user does not
  //                        pay gas for a guaranteed on-chain revert.
  //                        Hint: "Need {N} more signatures. Use
  //                        prepare_safe_tx_approve to collect more."
  //   STALE_SIGNATURE      — prepare_safe_tx_execute refused: one of the
  //                        confirmations ECDSA-recovers to an address that
  //                        is no longer in on-chain getOwners(). Defends
  //                        against owner-set drift (a `removeOwner` ops tx
  //                        landed between approve and execute). Hint:
  //                        "Confirmation by {addr} no longer maps to a
  //                        current Safe owner. Re-collect signatures via
  //                        prepare_safe_tx_approve."
  | "INSUFFICIENT_SIGNATURES"
  | "STALE_SIGNATURE"
  //
  // Phase 39 Plan 39-01 — Bridge Tier-1 final-recipient assertion (Inv #6b EVM path).
  //
  //   DECODED_RECIPIENT_DRIFT — preview_send Layer 0.6 refused: the recipient
  //                        address decoded from a Tier-1 bridge calldata field
  //                        (e.g. Wormhole `recipient`, Across V3 `recipient`,
  //                        NEAR OmniBridge `recipient`, Mayan Swift `destAddr`)
  //                        does NOT match the user-supplied `toAddress` stored
  //                        in `PreparedTxEvm.bridgeParams.toAddress`.
  //
  //                        This defends against a compromised agent that encodes
  //                        an attacker-controlled destination inside opaque bridge
  //                        calldata that the Ledger device cannot decode on-screen.
  //
  //                        Recovery hint: Do NOT sign. Re-verify the intended
  //                        destination address and re-prepare the transaction via
  //                        the bridge prepare tool.
  | "DECODED_RECIPIENT_DRIFT"
  //
  // Phase 40 Plan 40-01 — Per-chain sandwich-MEV refusal (MEV-01, append-only).
  // APPEND-ONLY — do NOT reorder existing codes above.
  //
  //   SANDWICH_MEV_REFUSED  — Emitted by two producers:
  //
  //                         1. prepare_uniswap_swap (EVM, per-chain bar):
  //                            priceImpactBps > priceImpactRefusalPct*100 AND
  //                            slippageBps was NOT explicitly supplied. The
  //                            threshold is per-chain from the
  //                            src/config/sandwich-mev-thresholds.ts SOT
  //                            (ethereum 2.0%, polygon 2.0%, arbitrum/optimism/
  //                            base 3.0%). Migrated from INVALID_INPUT in Phase
  //                            40 for one consistent refusal contract across
  //                            all chains.
  //
  //                         2. prepare_sunswap_swap (TRON, fixed 200bps):
  //                            priceImpactBps > 200 AND slippageBps was NOT
  //                            explicitly supplied. TRON keeps its own threshold
  //                            + template; only the errorcode migrated from
  //                            INVALID_INPUT to SANDWICH_MEV_REFUSED.
  //
  //                         ALSO emitted when a MEV_THRESHOLD_<CHAIN> env
  //                         override is present but invalid (non-integer /
  //                         <1 / >10000 / decimal). The consuming tool catches
  //                         InvalidMevThresholdError from getSandwichThresholds
  //                         and maps it to this code, naming chain + raw value.
  //
  //                         Recovery hint: Pass slippageBps explicitly to
  //                         acknowledge the high price impact, or correct the
  //                         MEV_THRESHOLD_<CHAIN> env override.
  | "SANDWICH_MEV_REFUSED";

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
