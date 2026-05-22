// Format-fanout-sentinel single source of truth for the BTC cross-check
// blocks Phase 23 tools emit. APPEND-ONLY sibling of
// `src/signing/blocks-tron.ts` (TRON — Phase 18),
// `src/signing/blocks-solana.ts` (Solana — Phase 12 — FROZEN), and
// `src/signing/blocks.ts` (EVM — FROZEN). Per the CLAUDE.md global
// "format-fanout-regex-sync" rule + the EVM/Solana/TRON precedent,
// these multi-line block-strings live in ONE place and are referenced via
// `.replace("{PLACEHOLDER}", value)` from both production handlers and
// tests. Re-declaring any of these blocks in another file violates the
// format-fanout-regex-sync invariant — a string-shape edit here would
// silently leave the duplicate behind.
//
// BTC structural divergence from TRON/Solana (RESEARCH BTC-PREP-02):
//   TRON/Solana surface ONE hash in the LEDGER BLIND-SIGN HASH block.
//   BTC surfaces N per-input sighashes — the device displays inputs +
//   outputs + fee summary, not a single hash. The template uses a
//   repeatable per-input line via {INPUT_SIGHASH_ROWS}, which the
//   prepare/preview handlers expand by joining N per-input lines.
//
// Block taxonomy (Phase 23 — Plan 23-03 ships templates; Plan 23-04
// wires preview_send + send_transaction substitution sites):
//   - PREPARE_RECEIPT_BTC_NATIVE_TEMPLATE  — Plan 23-03 (prepare_btc_send)
//   - LEDGER_BLIND_SIGN_HASH_BTC_TEMPLATE  — Plan 23-04 (preview_send BTC)
//   - INPUT_SIGHASH_ROW_BTC_TEMPLATE       — Plan 23-04 (per-input line)

/**
 * PREPARE RECEIPT — BTC native send (PSBT-based, verbatim agent args,
 * NO normalization). Substituted by `prepare_btc_send.ts` (Plan 23-03).
 * Slots:
 *   - `{TO}`        — recipient bech32/bech32m address (raw agent string).
 *   - `{SATS}`      — raw sat decimal string (raw agent string).
 *   - `{FEE_SATS}`  — computed miner fee in sats (decimal string,
 *                     server-derived via coin-selection + fee-rate).
 *   - `{FEE_RATE}`  — fee rate in sat/vB (decimal string; either the
 *                     agent-supplied feeRate or the D-03 default estimate).
 *   - `{INPUT_ROWS}` — expanded inline: one line per selected UTXO.
 *   - `{OUTPUT_ROWS}` — expanded inline: one line per PSBT output.
 *
 * PREP-02 invariant: the receipt surfaces what the agent claimed plus
 * the server-derived coin-selection summary. The cryptographic anchor
 * (payloadFingerprint = keccak256 over per-input sighashes) catches drift.
 *
 * Cross-ref: 23-CONTEXT.md line 99 — "BTC receipt adds inputs/outputs/feeSats slots".
 */
export const PREPARE_RECEIPT_BTC_NATIVE_TEMPLATE: string = [
  "PREPARE RECEIPT (BTC — native send)",
  "  chain:    Bitcoin mainnet",
  "  to:       {TO}",
  "  sats:     {SATS}",
  "  feeSats:  {FEE_SATS}",
  "  feeRate:  {FEE_RATE} sat/vB",
  "  inputs:",
  "{INPUT_ROWS}",
  "  outputs:",
  "{OUTPUT_ROWS}",
].join("\n");

/**
 * Single input row for `{INPUT_ROWS}` expansion in
 * `PREPARE_RECEIPT_BTC_NATIVE_TEMPLATE`. Two slots:
 *   - `{TXID_SHORT}` — first 8 hex chars of the txid (display-only).
 *   - `{VOUT}`       — output index (decimal).
 *   - `{VALUE_SATS}` — UTXO value in sats (decimal).
 *   - `{SCRIPT_TYPE}` — "p2wpkh" or "p2tr".
 *
 * Callers join N rendered rows with "\n" and substitute into `{INPUT_ROWS}`.
 */
export const INPUT_ROW_BTC_TEMPLATE: string =
  "    {TXID_SHORT}…:{VOUT}  {VALUE_SATS} sats  ({SCRIPT_TYPE})";

/**
 * Single output row for `{OUTPUT_ROWS}` expansion in
 * `PREPARE_RECEIPT_BTC_NATIVE_TEMPLATE`. Three slots:
 *   - `{ADDRESS_SHORT}` — first 12 chars of the address (display-only).
 *   - `{VALUE_SATS}`    — output value in sats (decimal).
 *   - `{ROLE}`          — "recipient" or "change".
 *
 * Callers join N rendered rows with "\n" and substitute into `{OUTPUT_ROWS}`.
 */
export const OUTPUT_ROW_BTC_TEMPLATE: string =
  "    {ADDRESS_SHORT}…  {VALUE_SATS} sats  ({ROLE})";

/**
 * LEDGER BLIND-SIGN HASH (BTC) — device-display hash surface, emitted
 * UNCONDITIONALLY by preview_send BTC branch (Plan 23-04). Three slots:
 *   - `{INPUT_COUNT}`          — number of inputs (decimal).
 *   - `{INPUT_SIGHASH_ROWS}`   — per-input sighash lines, one per input,
 *                                 joined with "\n". Each line uses
 *                                 `INPUT_SIGHASH_ROW_BTC_TEMPLATE`.
 *   - `{FEE_SATS}`             — total miner fee in sats.
 *
 * BTC divergence from TRON/Solana:
 *   The Ledger BTC app (v2.1.0+, descriptor-wallet protocol) displays
 *   INPUTS / OUTPUTS / FEE on-device, not a single 64-char hash. The
 *   per-input BIP-143/341 sighashes are the cryptographic binding; the
 *   user verifies the decoded inputs/outputs/fee against the PREPARE RECEIPT
 *   above, then approves on-device.
 *
 *   This is structurally distinct from `LEDGER_BLIND_SIGN_HASH_TRON_TEMPLATE`
 *   which surfaces one SHA-256 hash. BTC surfaces N sighashes (one per input).
 *   The domain tag `"VaultPilot-btctx-v1:"` in `btc-fingerprint.ts`
 *   is the cross-chain distinguisher at the keccak preimage level.
 *
 * Sibling of `LEDGER_BLIND_SIGN_HASH_TRON_TEMPLATE` in `blocks-tron.ts`
 * and `LEDGER_BLIND_SIGN_HASH_SOLANA_TEMPLATE` in `blocks-solana.ts`.
 */
export const LEDGER_BLIND_SIGN_HASH_BTC_TEMPLATE: string = [
  "LEDGER BLIND-SIGN HASH (BTC)",
  "  Inputs: {INPUT_COUNT}  Fee: {FEE_SATS} sats",
  "  Per-input BIP-143/341 sighashes (one per UTXO being spent):",
  "{INPUT_SIGHASH_ROWS}",
  "",
  "  The Ledger BTC app (BIP-84/86 descriptor-wallet, v2.1.0+) displays",
  "  the decoded INPUTS / OUTPUTS / FEE summary on-device and requests",
  "  per-input approval. Compare the on-device amounts character-for-character",
  "  against the PREPARE RECEIPT above.",
  "",
  "  After you say \"send\", your Ledger device will display the transaction",
  "  summary (inputs, outputs, fee). Compare character-for-character.",
  "  If they match → approve on the device. If they differ → REJECT (tamper signal).",
].join("\n");

/**
 * Single per-input sighash row for `{INPUT_SIGHASH_ROWS}` expansion in
 * `LEDGER_BLIND_SIGN_HASH_BTC_TEMPLATE`. Three slots:
 *   - `{INPUT_INDEX}`    — 0-based input index (decimal).
 *   - `{SCRIPT_TYPE}`    — "p2wpkh" (BIP-143) or "p2tr" (BIP-341 key-spend).
 *   - `{SIGHASH_HEX}`    — full 64-char hex of the per-input sighash (0x-prefixed).
 *
 * Callers join N rendered rows with "\n" and substitute into `{INPUT_SIGHASH_ROWS}`.
 */
export const INPUT_SIGHASH_ROW_BTC_TEMPLATE: string =
  "    input[{INPUT_INDEX}]  ({SCRIPT_TYPE})  {SIGHASH_HEX}";

// ─── Phase 24 Plan 24-01 — RBF fee-bump templates ────────────────────────────

/**
 * PREPARE RECEIPT — BTC RBF fee bump (PSBT-based, verbatim agent args,
 * NO normalization). Substituted by `prepare_btc_rbf_bump.ts` (Plan 24-01).
 * Slots:
 *   - `{ORIGINAL_TXID}` — txid of the original mempool-pending transaction.
 *   - `{NEW_FEE_RATE}`  — new fee rate in sat/vB (decimal string).
 *   - `{ORIGINAL_FEE_SATS}` — original fee in sats (decimal string).
 *   - `{ORIGINAL_FEE_RATE}` — original fee rate in sat/vB (decimal string).
 *   - `{NEW_FEE_SATS}`  — new fee in sats (decimal string).
 *   - `{FEE_DELTA_SATS}` — absolute fee increase in sats (decimal string).
 *   - `{INPUT_ROWS}`   — expanded inline: one line per input (reuses INPUT_ROW_BTC_TEMPLATE).
 *   - `{OUTPUT_ROWS}`  — expanded inline: one line per output (reuses OUTPUT_ROW_BTC_TEMPLATE).
 *
 * PREP-02 invariant: the receipt surfaces the original txid plus the server-
 * derived fee diff summary. The cryptographic anchor (payloadFingerprint = keccak256
 * over per-input sighashes with RBF-enabled sequence) catches drift.
 */
export const PREPARE_RECEIPT_BTC_RBF_TEMPLATE: string = [
  "PREPARE RECEIPT (BTC — RBF fee bump)",
  "  chain:         Bitcoin mainnet",
  "  originalTxid:  {ORIGINAL_TXID}",
  "  newFeeRate:    {NEW_FEE_RATE} sat/vB",
  "  originalFee:   {ORIGINAL_FEE_SATS} sats  ({ORIGINAL_FEE_RATE} sat/vB)",
  "  newFee:        {NEW_FEE_SATS} sats  (delta: +{FEE_DELTA_SATS} sats)",
  "  inputs:",
  "{INPUT_ROWS}",
  "  outputs:",
  "{OUTPUT_ROWS}",
].join("\n");

// ─── Phase 24 Plan 24-02 — BIP-137 message signing template ──────────────────

/**
 * LEDGER BLIND-SIGN HASH (BTC — message signing) — device-display hash surface
 * emitted by `sign_message_btc` (Plan 24-02). Two slots:
 *   - `{MESSAGE_TEXT}` — the raw message the agent passed in (verbatim).
 *   - `{MESSAGE_HASH}` — the server-computed BIP-137 double-SHA256 message hash
 *                       (0x-prefixed hex of double-SHA256(varint(24) ‖ magic ‖
 *                       varint(len) ‖ message)). This is what the device signs.
 *
 * BIP-137 divergence from the PSBT template:
 *   - `LEDGER_BLIND_SIGN_HASH_BTC_TEMPLATE` covers tx signing (N per-input
 *     BIP-143/341 sighashes, displayed as inputs/outputs/fee on-device).
 *   - THIS template covers message signing (single double-SHA256 hash; the
 *     device displays the message text on-screen for literal approval).
 *
 * Security: the device applies the `"Bitcoin Signed Message:\n"` magic prefix
 * internally — the message text shown on-device is the literal message, not a
 * binary hash. Compare character-for-character before approving.
 * T-24-07 mitigation: magic prefix makes BIP-137 signatures non-spendable
 * (cannot collide with a Bitcoin tx sighash); T-24-09 mitigation: this block
 * surfaces the server-computed hash so the user can verify independently.
 */
export const LEDGER_BLIND_SIGN_HASH_MSG_BTC_TEMPLATE: string = [
  "LEDGER BLIND-SIGN HASH (BTC — message signing)",
  "  Message:      {MESSAGE_TEXT}",
  "  BIP-137 hash: {MESSAGE_HASH}",
  "  (double-SHA256 of magic_prefix ‖ varint_len ‖ message)",
  "",
  "  Your Ledger BTC app displays the message text above on-device.",
  "  Compare the displayed message character-for-character against the agent's claim.",
  "  If they match → approve. If they differ → REJECT.",
].join("\n");
