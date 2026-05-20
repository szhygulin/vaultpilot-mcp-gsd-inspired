// Format-fanout-sentinel single source of truth for the seven TRON cross-check
// blocks Phase 18 tools emit. APPEND-ONLY sibling of `src/signing/blocks-solana.ts`
// (Solana — FROZEN) and `src/signing/blocks.ts` (EVM — FROZEN). Per the
// CLAUDE.md global "format-fanout-regex-sync" rule + the EVM/Solana precedent,
// these multi-line block-strings live in ONE place and are referenced via
// `.replace("{PLACEHOLDER}", value)` from both production handlers and tests.
// Re-declaring any of these blocks in another file violates the format-fanout-
// regex-sync invariant — a string-shape edit here would silently leave the
// duplicate behind.
//
// Asymmetric-simulation note (TRON only — distinct from EVM and Solana):
//   TRC-20 transfers: mandatory simulation via `triggerConstantcontract` (DF-3).
//     `SIMULATION_BLOCK_TRON_TEMPLATE` surfaces the result; non-ok status refuses.
//   Native TRX transfers: NO simulation API on TronGrid (TransferContract is a
//     node-level primitive, not a smart contract). `emitNoSimulationAvailable()`
//     returns a `not-applicable` sentinel; consumer emits
//     `NO_SIMULATION_AVAILABLE_TRON_TEMPLATE` as an advisory (NOT a refusal).
//   This asymmetry is documented in SECURITY.md TRON section (5) — accepted
//   residual risk surfaced visibly.
//
// LEDGER_NOTICE_TRON_TEMPLATE is pre-staged for Phase 19+ consumers. In Phase 18
// scope (USDT/USDC/USDD/TUSD), these tokens are in the TRX-app bundled clear-sign
// registry, so the NOTICE is rarely emitted. It lands here now under the append-
// only constraint so Phase 19+ can consume it without touching frozen files.
//
// Block taxonomy (Phase 18 — Plan 18-01 ships templates; Plans 18-02 + 18-03
// wire substitution sites):
//   - PREPARE_RECEIPT_TRON_NATIVE_TEMPLATE    — Plan 18-02 (native TRX transfer)
//   - PREPARE_RECEIPT_TRON_TRC20_TEMPLATE     — Plan 18-03 (TRC-20 transfer)
//   - LEDGER_BLIND_SIGN_HASH_TRON_TEMPLATE    — Plan 18-04 (preview_send TRON)
//   - LEDGER_NOTICE_TRON_TEMPLATE             — Plan 18-04 (conditional — Phase 19+ consumers)
//   - SIMULATION_BLOCK_TRON_TEMPLATE          — Plan 18-04 (TRC-20 DF-3 gate)
//   - NO_SIMULATION_AVAILABLE_TRON_TEMPLATE   — Plan 18-04 (native TRX advisory)
//   - VERIFY_BEFORE_SIGNING_TRON_TEMPLATE     — Plan 18-04 + 18-05 (user-facing summary)

/**
 * PREPARE RECEIPT — TRON native TRX transfer (PREP-02 — verbatim agent args,
 * NO normalization). Substituted by `prepare_tron_native_send.ts` (Plan
 * 18-02). Five slots:
 *   - `{TO}`             — recipient base58check address (raw agent string).
 *   - `{SUN}`            — raw sun decimal string (raw agent string; 1 TRX = 1_000_000 sun).
 *   - `{REF_BLOCK_BYTES}` — pinned at prepare time; surfaced verbatim.
 *   - `{REF_BLOCK_HASH}` — pinned at prepare time; surfaced verbatim.
 *   - `{EXPIRATION}`     — expiration timestamp (ms); surfaced verbatim.
 *
 * Reads EXCLUSIVELY from the agent's raw args + server-derived pinned
 * ref-block fields. PREP-02 invariant: the receipt surfaces what the agent
 * claimed; the cryptographic anchor (payloadFingerprint + presignHash)
 * catches any drift.
 */
export const PREPARE_RECEIPT_TRON_NATIVE_TEMPLATE: string = [
  "PREPARE RECEIPT (TRON — native transfer)",
  "  chain:          TRON mainnet",
  "  to:             {TO}",
  "  sun:            {SUN}",
  "  refBlockBytes:  {REF_BLOCK_BYTES}",
  "  refBlockHash:   {REF_BLOCK_HASH}",
  "  expiration:     {EXPIRATION}",
].join("\n");

/**
 * PREPARE RECEIPT — TRON TRC-20 transfer (PREP-02). Substituted by
 * `prepare_tron_trc20_send.ts` (Plan 18-03). Six slots:
 *   - `{TO}`             — recipient base58check address (NOT the ATA — TRON
 *                          addresses are not program-derived; the recipient IS
 *                          the address the agent passed).
 *   - `{TOKEN_ADDRESS}`  — TRC-20 contract base58check address (raw agent string).
 *   - `{AMOUNT}`         — raw token amount as decimal string (decimal-aware
 *                          arithmetic per CLAUDE.md — agent passes the
 *                          human-units amount, server resolves decimals via
 *                          `get_tron_token_metadata`).
 *   - `{REF_BLOCK_BYTES}` — pinned at prepare time; surfaced verbatim.
 *   - `{REF_BLOCK_HASH}` — pinned at prepare time; surfaced verbatim.
 *   - `{EXPIRATION}`     — expiration timestamp (ms); surfaced verbatim.
 */
export const PREPARE_RECEIPT_TRON_TRC20_TEMPLATE: string = [
  "PREPARE RECEIPT (TRON — TRC-20 transfer)",
  "  chain:          TRON mainnet",
  "  to:             {TO}",
  "  tokenAddress:   {TOKEN_ADDRESS}",
  "  amount:         {AMOUNT}",
  "  refBlockBytes:  {REF_BLOCK_BYTES}",
  "  refBlockHash:   {REF_BLOCK_HASH}",
  "  expiration:     {EXPIRATION}",
].join("\n");

/**
 * LEDGER BLIND-SIGN HASH (TRON) — DF-2 device-display hash surface, emitted
 * UNCONDITIONALLY by preview_send TRON branch (Plan 18-04). Two slots:
 *   - `{HASH_FULL_64HEX}`            — full 64-char hex (with 0x prefix) of the
 *                                      SHA-256 presign hash.
 *   - `{HASH_CHUNKED_4_CHAR_GROUPS}` — same hash chunked into 4-char groups
 *                                      separated by single spaces (mirrors the
 *                                      EVM/Solana `chunkHex` helper for
 *                                      readable on-device comparison).
 *
 * TRON consensus tx-id derivation:
 *   SHA-256(raw_data) = transaction.txID (tronweb client-side field).
 *   The Ledger TRX app displays this hash in blind-sign mode under the label
 *   "Transaction ID" (per LedgerHQ/app-tron source — `cx_hash_sha256` over
 *   the raw_data Protobuf bytes). The user MUST compare character-for-character
 *   against the `{HASH_FULL_64HEX}` line. If they match → approve on device.
 *   If they differ → REJECT on device (tamper signal).
 *
 * Distinct from `LEDGER_BLIND_SIGN_HASH_SOLANA_TEMPLATE` in `blocks-solana.ts`:
 *   1. Hash function is SHA-256 over raw_data Protobuf bytes (same as Solana's
 *      SHA-256 over serialized message bytes — shared hash function, different
 *      preimage). NOT keccak256 (that lives in `payload-fingerprint-tron.ts`).
 *   2. Header line names "TRON" explicitly for cross-chain session distinction.
 *   3. Sub-line names the TRON tx-id derivation + TRX app on-device label.
 */
export const LEDGER_BLIND_SIGN_HASH_TRON_TEMPLATE: string = [
  "LEDGER BLIND-SIGN HASH (TRON)",
  "  Predicted hash (full):    {HASH_FULL_64HEX}",
  "  Predicted hash (chunked): {HASH_CHUNKED_4_CHAR_GROUPS}",
  "",
  "  TRON consensus tx-id = SHA-256(raw_data) = transaction.txID.",
  "  The Ledger TRX app displays this hash on blind-sign mode (label:",
  "  \"Transaction ID\"). Compare character-for-character against the",
  "  on-device value.",
  "",
  "  After you say \"send\", your Ledger device will display \"Transaction ID\"",
  "  on its physical screen. Compare it character-for-character to the",
  "  predicted hash above. If they match → approve on the device. If they",
  "  differ → REJECT on the device (tamper signal).",
].join("\n");

/**
 * LEDGER NOTICE (TRON) — emitted CONDITIONALLY by preview_send TRON branch
 * (Plan 18-04) ABOVE the LEDGER BLIND-SIGN HASH (TRON) block when the TRC-20
 * token is NOT in the Ledger TRX-app bundled clear-sign registry. Two slots:
 *   - `{INSTRUCTION_NAME}` — human-readable instruction name (e.g.
 *                            "TRC-20 transfer" or the token symbol).
 *   - `{REGISTRY_STATUS}`  — short string describing registry coverage (e.g.
 *                            "NOT in TRX app clear-sign registry v3.0.4" or
 *                            "Custom TRC-20 token — no clear-sign support").
 *
 * Pre-staged for Phase 19+ consumers. In Phase 18 scope (USDT/USDC/USDD/TUSD),
 * these tokens ARE in the TRX-app bundled registry so this NOTICE is rarely
 * emitted. It lands here now under the append-only constraint so Phase 19+
 * consumers can import it without touching FROZEN files.
 *
 * Mirrors `LEDGER_NOTICE_SOLANA_BLIND_SIGN_TEMPLATE` in `blocks-solana.ts`
 * (Phase 12 Plan 12-04 precedent — blind-sign-not-enabled UX defense).
 */
export const LEDGER_NOTICE_TRON_TEMPLATE: string = [
  "LEDGER NOTICE (TRON)",
  "  This transaction includes a {INSTRUCTION_NAME} instruction which the",
  "  Ledger TRX app may NOT clear-sign ({REGISTRY_STATUS}).",
  "  Your device will BLIND-SIGN this transaction (display only the",
  "  Transaction ID hash, no decoded contract args).",
  "  If your device refuses with \"Blind signing is not enabled\":",
  "    1. Open the TRON app on your device",
  "    2. Settings → Blind signing → Enabled",
  "    3. Retry send_transaction",
  "  After send_transaction fires, compare the PREDICTED hash below to the",
  "  value your hardware device displays — character-for-character. This",
  "  on-device match is the cryptographic anchor.",
].join("\n");

/**
 * CHECKS PERFORMED (TRON simulation — Layer 0.7) — emitted by preview_send
 * TRON branch (Plan 18-04) for TRC-20 transactions. Surfaces the
 * `triggerConstantContract` envelope per DF-3 mandatory simulation gate.
 * Layer 0.7 sits between Layer 0.5 (canonical-dispatch-tron allowlist refusal)
 * and Layer 1 (handle lookup) in preview_send.
 *
 * On non-ok status, preview_send PROMOTES this block into a SIMULATION_REFUSED
 * refusal envelope and DOES NOT emit the LEDGER BLIND-SIGN HASH block — the
 * user is NEVER asked to blind-sign a TRC-20 transaction whose simulated outcome
 * we could not classify.
 *
 * DF-3: a non-ok status refuses preview with SIMULATION_REFUSED for TRC-20.
 * The user is NEVER asked to blind-sign a TRC-20 transaction whose simulated
 * outcome we could not classify. Native TRX skips this gate — see the
 * NO_SIMULATION_AVAILABLE block below.
 *
 * Four slots:
 *   - `{STATUS}`                 — classified status string (`ok` / `revert` /
 *                                  `energy-required` / `error`).
 *   - `{REVERT_REASON}`          — decoded Solidity revert reason string, or
 *                                  `n/a` when status is `ok` or no reason.
 *   - `{ENERGY_USED}`            — estimated energy consumed (decimal string or
 *                                  `n/a`).
 *   - `{CONSTANT_RESULT_PREVIEW}` — first result hex (truncated); `n/a` when
 *                                  empty.
 */
export const SIMULATION_BLOCK_TRON_TEMPLATE: string = [
  "CHECKS PERFORMED (TRON simulation — Layer 0.7)",
  "  status:               {STATUS}",
  "  revertReason:         {REVERT_REASON}",
  "  energyUsed:           {ENERGY_USED}",
  "  constantResult[0]:    {CONSTANT_RESULT_PREVIEW}",
  "",
  "  DF-3: a non-ok status refuses preview with SIMULATION_REFUSED for TRC-20.",
  "  The user is NEVER asked to blind-sign a TRC-20 transaction whose simulated",
  "  outcome we could not classify. The trust anchor remains the on-device hash",
  "  match; this gate sits BEFORE that match to fail-safe at the server.",
  "  Native TRX skips this gate — see NO_SIMULATION_AVAILABLE block.",
].join("\n");

/**
 * CHECKS PERFORMED (TRON — no simulation available) — emitted by preview_send
 * TRON branch (Plan 18-04) for native TRX transfers. No slots — constant prose.
 *
 * TransferContract (native TRX transfer) has no on-chain simulation API.
 * TronGrid's /wallet/triggerconstantcontract is for smart-contract view/pure
 * calls only; native TRX transfer is a node-level primitive, not a smart
 * contract interaction. The defense for native TRX relies entirely on:
 *   1. PREPARE RECEIPT (verbatim agent args, byte-bound to the fingerprint).
 *   2. LEDGER BLIND-SIGN HASH (on-device match against the SHA-256 tx-id).
 *
 * This asymmetry is documented in SECURITY.md TRON section (5) — accepted
 * residual risk surfaced visibly. The user MUST read the PREPARE RECEIPT above
 * and match the device hash exactly.
 */
export const NO_SIMULATION_AVAILABLE_TRON_TEMPLATE: string = [
  "CHECKS PERFORMED (TRON — no simulation available)",
  "  TransferContract (native TRX transfer) has no on-chain simulation API.",
  "  TronGrid's /wallet/triggerconstantcontract is for smart-contract view/pure",
  "  calls only. Defense for native TRX relies on:",
  "    1. PREPARE RECEIPT (verbatim agent args, byte-bound via payloadFingerprint).",
  "    2. LEDGER BLIND-SIGN HASH (on-device match against the SHA-256 tx-id).",
  "  This asymmetry is documented in SECURITY.md TRON section (5) — accepted",
  "  residual risk surfaced visibly. You MUST read the PREPARE RECEIPT above",
  "  and match the device hash exactly before approving.",
].join("\n");

/**
 * VERIFY BEFORE SIGNING (TRON) — user-facing summary of every cross-check
 * artifact the user should read before approving on the device. Mirrors
 * `VERIFY_BEFORE_SIGNING_SOLANA_TEMPLATE` from `blocks-solana.ts` but swaps
 * the `"Network: Solana mainnet-beta"` line for `"Network: TRON mainnet"` and
 * names the TRX app's on-device label `"Transaction ID"`.
 *
 * The temporal-flow correction from issue #63 (post-send, not pre-send, ritual
 * ordering) applies uniformly across chains. No slots — constant prose, except
 * the network line.
 */
export const VERIFY_BEFORE_SIGNING_TRON_TEMPLATE: string = [
  "VERIFY BEFORE SIGNING",
  "  Network: TRON mainnet",
  "",
  "  Pre-send pre-flight (now, before you say \"send\"):",
  "    a. Read the PREPARE RECEIPT — these are the args the agent passed, verbatim.",
  "    b. For TRC-20: read the CHECKS PERFORMED (TRON simulation — Layer 0.7) block —",
  "       status must be `ok`. A non-ok status refuses preview before this block emits.",
  "       For native TRX: read the CHECKS PERFORMED (TRON — no simulation available)",
  "       block — defense relies on PREPARE RECEIPT + on-device hash match only.",
  "    c. Note the LEDGER BLIND-SIGN HASH (TRON) hash above — you will compare",
  "       it against your physical device in step 4.",
  "    d. If anything disagrees, call send_transaction with userDecision: \"cancel\".",
  "",
  "  Post-send on-device ritual (the 6-step sequence):",
  "    1. You say \"send\" — send_transaction fires the WalletConnect request.",
  "    2. The TRON wallet (TronLink / Ledger Live) routes the request to your",
  "       hardware device.",
  "    3. Your hardware device wakes and displays a 64-char hex hash on its physical",
  "       screen (Ledger TRX app, labeled \"Transaction ID\" in blind-sign mode).",
  "    4. You compare the device screen to the PREDICTED hash above,",
  "       character-for-character.",
  "    5. If they match → approve on the device.",
  "    6. If they differ → REJECT on the device. This is a tamper signal.",
].join("\n");
