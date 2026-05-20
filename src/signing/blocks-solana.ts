// Format-fanout-sentinel single source of truth for the six Solana cross-check
// blocks Phase 12 tools emit. APPEND-ONLY sibling of `src/signing/blocks.ts` —
// EVM templates stay byte-frozen; Solana templates live in THIS file. Per the
// CLAUDE.md global "format-fanout-regex-sync" rule + the EVM `blocks.ts`
// precedent, these multi-line block-strings live in ONE place and are
// referenced via `.replace("{PLACEHOLDER}", value)` from both production
// handlers and tests. Re-declaring any of these blocks in another file
// violates the format-fanout-regex-sync invariant — a string-shape edit here
// would silently leave the duplicate behind.
//
// Block taxonomy (Phase 12 — Wave 1 ships the templates; Waves 2-5 wire the
// substitution sites):
//   - PREPARE_RECEIPT_SOLANA_NATIVE_TEMPLATE       — Plan 12-02 (native SOL transfer)
//   - PREPARE_RECEIPT_SOLANA_SPL_TEMPLATE          — Plan 12-03 (SPL TransferChecked)
//   - LEDGER_BLIND_SIGN_HASH_SOLANA_TEMPLATE       — Plan 12-04 (preview_send Solana)
//   - LEDGER_NOTICE_SOLANA_BLIND_SIGN_TEMPLATE     — Plan 12-04 (conditional — edge cases)
//   - SIMULATION_BLOCK_SOLANA_TEMPLATE             — Plan 12-04 (DF-4 envelope surface)
//   - VERIFY_BEFORE_SIGNING_SOLANA_TEMPLATE        — Plan 12-04 + 12-05 (user-facing summary)
//
// The corresponding EVM templates in `blocks.ts` are FROZEN. preview_send /
// send_transaction Solana branches NEVER inline these strings — they import
// from THIS file and substitute slots at call time (same format-fanout-
// sentinel discipline as the EVM templates).

/**
 * PREPARE RECEIPT — Solana native SOL transfer (PREP-02 — verbatim agent args,
 * NO normalization). Substituted by `prepare_solana_native_send.ts` (Plan
 * 12-02). Three slots:
 *   - `{TO}`               — recipient base58 pubkey (raw agent string).
 *   - `{LAMPORTS}`         — raw lamports decimal string (raw agent string).
 *   - `{RECENT_BLOCKHASH}` — pinned at prepare time so preview re-derivation
 *                            matches the byte-bound payloadFingerprint.
 *
 * Reads EXCLUSIVELY from the agent's raw args — never the base58-normalized
 * form. PREP-02 invariant: the receipt surfaces what the agent claimed; the
 * cryptographic anchor (payloadFingerprint + presignHash) catches any
 * normalization drift.
 */
export const PREPARE_RECEIPT_SOLANA_NATIVE_TEMPLATE: string = [
  "PREPARE RECEIPT (Solana — native transfer)",
  "  chain:           solana mainnet-beta",
  "  to:              {TO}",
  "  lamports:        {LAMPORTS}",
  "  recentBlockhash: {RECENT_BLOCKHASH}",
].join("\n");

/**
 * PREPARE RECEIPT — Solana SPL TransferChecked (PREP-02). Substituted by
 * `prepare_solana_spl_send.ts` (Plan 12-03). Five slots:
 *   - `{TO}`               — recipient owner base58 pubkey (NOT the destination
 *                            ATA — the ATA is derived server-side from
 *                            owner + mint).
 *   - `{MINT}`              — SPL mint base58 pubkey (raw agent string).
 *   - `{AMOUNT}`            — raw token amount as decimal string (decimal-aware
 *                            arithmetic per CLAUDE.md — agent passes the
 *                            human-units amount, server resolves decimals
 *                            via mint metadata).
 *   - `{RECENT_BLOCKHASH}`  — pinned at prepare time.
 *   - `{ATA_NOTICE}`        — populated with a one-line "destination ATA must
 *                            be created in-tx (~0.002 SOL rent)" notice when
 *                            the destination ATA does not exist; empty
 *                            string otherwise. Empty lines filtered at the
 *                            substitution site to keep the block tight.
 */
export const PREPARE_RECEIPT_SOLANA_SPL_TEMPLATE: string = [
  "PREPARE RECEIPT (Solana — SPL transfer)",
  "  chain:           solana mainnet-beta",
  "  to:              {TO}",
  "  mint:            {MINT}",
  "  amount:          {AMOUNT}",
  "  recentBlockhash: {RECENT_BLOCKHASH}",
  "{ATA_NOTICE}",
].join("\n");

/**
 * LEDGER BLIND-SIGN HASH (Solana) — DF-2 device-display hash surface, emitted
 * UNCONDITIONALLY by preview_send Solana branch (Plan 12-04). Two slots:
 *   - `{HASH_FULL_64HEX}`            — full 64-char hex (with 0x prefix) of the
 *                                      SHA-256 message hash.
 *   - `{HASH_CHUNKED_4_CHAR_GROUPS}` — same hash chunked into 4-char groups
 *                                      separated by single spaces (mirrors
 *                                      the EVM `chunkHex` helper for
 *                                      readable on-device comparison).
 *
 * Distinct from the EVM `LEDGER_BLIND_SIGN_HASH_TEMPLATE` in `blocks.ts`:
 *   1. Hash function is SHA-256 (not keccak256) — what the Ledger SOL app
 *      actually displays per `cx_hash_sha256(...)` in
 *      `LedgerHQ/app-solana/src/handle_sign_message.c`.
 *   2. Header line names "Solana" explicitly so the cross-chain user can
 *      distinguish the two blocks in a mixed-portfolio session.
 *   3. Sub-line names the SOL app v1.4+ clear-sign coverage so the user
 *      knows when to expect decoded args vs the raw hash.
 *
 * The trust anchor remains the on-device hash match — the user reads the
 * device screen and compares character-for-character against the
 * `{HASH_FULL_64HEX}` line.
 */
export const LEDGER_BLIND_SIGN_HASH_SOLANA_TEMPLATE: string = [
  "LEDGER BLIND-SIGN HASH (Solana)",
  "  Predicted hash (full):    {HASH_FULL_64HEX}",
  "  Predicted hash (chunked): {HASH_CHUNKED_4_CHAR_GROUPS}",
  "",
  "  SOL app v1.4+ clear-signs native + SPL transfers. If your device shows",
  "  only this hash, the instruction is blind-sign-only — see LEDGER NOTICE",
  "  block above (when present).",
  "",
  "  After you say \"send\", your Ledger device will display \"Message Hash\"",
  "  on its physical screen. Compare it character-for-character to the",
  "  predicted hash above. If they match → approve on the device. If they",
  "  differ → REJECT on the device (tamper signal).",
].join("\n");

/**
 * LEDGER NOTICE (Solana) — emitted CONDITIONALLY by preview_send Solana branch
 * (Plan 12-04) ABOVE the LEDGER BLIND-SIGN HASH (Solana) block for tx shapes
 * the SOL app does NOT clear-sign. v1.x scope: native SOL + SPL
 * TransferChecked DO clear-sign on SOL app v1.4+, so this NOTICE is rarely
 * emitted in v1.x. Reserved for edge cases (durable-nonce setup, custom
 * program calls) that land in v2.0.x.
 *
 * Mirrors `LEDGER_NOTICE_WETH_UNWRAP_TEMPLATE` from `blocks.ts:389` (Phase 6
 * A2 mitigation precedent — blind-sign-enabled-in-settings UX defense). One
 * slot:
 *   - `{INSTRUCTION_NAME}` — human-readable name of the instruction shape
 *                            the SOL app cannot clear-sign (e.g.
 *                            "AdvanceNonceAccount").
 */
export const LEDGER_NOTICE_SOLANA_BLIND_SIGN_TEMPLATE: string = [
  "LEDGER NOTICE (Solana)",
  "  This transaction includes a {INSTRUCTION_NAME} instruction which the",
  "  Ledger Solana app does NOT clear-sign. Your device will likely BLIND-SIGN",
  "  this transaction (display only the message hash, no decoded args).",
  "  If your device refuses with \"Blind signing is not enabled\":",
  "    1. Open the Solana app on your device",
  "    2. Settings → Blind signing → Enabled",
  "    3. Retry send_transaction",
  "  After send_transaction fires, compare the PREDICTED hash below to the",
  "  value your hardware device displays — character-for-character. This",
  "  on-device match is the cryptographic anchor.",
].join("\n");

/**
 * CHECKS PERFORMED (Solana simulation — Layer 0.7) — emitted UNCONDITIONALLY by
 * preview_send Solana branch (Plan 12-04). Surfaces the
 * `simulateTransaction` envelope verbatim per DF-4 mandatory simulation
 * gate. Layer 0.7 sits between Layer 0.5 (canonical-dispatch-solana
 * allowlist refusal) and Layer 1 (handle lookup) in preview_send.
 *
 * On non-`ok` status, preview_send PROMOTES this block into a
 * SIMULATION_REFUSED refusal envelope and DOES NOT emit the LEDGER
 * BLIND-SIGN HASH block — the user is NEVER asked to blind-sign a
 * transaction whose outcome we could not verify. Distinguishes from the
 * EVM `buildSimulationBlock` in `blocks.ts` (advisory — emits even on
 * revert).
 *
 * Five slots:
 *   - `{STATUS}`             — classified status string (`ok` /
 *                              `program-error` / `insufficient-lamports` /
 *                              `error`).
 *   - `{ERR}`                — stringified `value.err`; empty when ok.
 *   - `{UNITS_CONSUMED}`     — compute-units used (decimal string or `n/a`).
 *   - `{LOG_COUNT}`          — total log line count.
 *   - `{LOG_PREVIEW_LINES}`  — first 3 log lines, newline-joined with 4-space
 *                              indent. structuredContent carries the full list.
 */
export const SIMULATION_BLOCK_SOLANA_TEMPLATE: string = [
  "CHECKS PERFORMED (Solana simulation — Layer 0.7)",
  "  status:         {STATUS}",
  "  err:            {ERR}",
  "  unitsConsumed:  {UNITS_CONSUMED}",
  "  log count:      {LOG_COUNT}",
  "  log preview (first 3 lines; full list in structuredContent.simulation.logs):",
  "{LOG_PREVIEW_LINES}",
  "",
  "  DF-4: a non-ok status refuses preview with SIMULATION_REFUSED. The user",
  "  is NEVER asked to blind-sign a transaction whose simulated outcome we",
  "  could not classify. The trust anchor remains the on-device hash match;",
  "  this gate sits BEFORE that match to fail-safe at the server.",
].join("\n");

/**
 * VERIFY BEFORE SIGNING (Solana) — user-facing summary of every cross-check
 * artifact the user should read before approving on the device. Mirrors
 * `VERIFY_BEFORE_SIGNING_TEMPLATE` from `blocks.ts:150` but swaps the
 * `"Network: Ethereum"` line for `"Network: Solana mainnet-beta"`. Body
 * shape (6-step post-send sequence) identical — the temporal-flow
 * correction from issue #63 applies uniformly across chains.
 *
 * No placeholders — constant prose, except the network line which is the
 * one-line chain identifier.
 */
export const VERIFY_BEFORE_SIGNING_SOLANA_TEMPLATE: string = [
  "VERIFY BEFORE SIGNING",
  "  Network: Solana mainnet-beta",
  "",
  "  Pre-send pre-flight (now, before you say \"send\"):",
  "    a. Read the PREPARE RECEIPT — these are the args the agent passed, verbatim.",
  "    b. Read the CHECKS PERFORMED (Solana simulation — Layer 0.7) block —",
  "       status must be `ok`. A non-ok status refuses preview before this block emits.",
  "    c. Note the LEDGER BLIND-SIGN HASH (Solana) hash above — you will compare",
  "       it against your physical device in step 4.",
  "    d. If anything disagrees, call send_transaction with userDecision: \"cancel\".",
  "",
  "  Post-send on-device ritual (the 6-step sequence):",
  "    1. You say \"send\" — send_transaction fires the WalletConnect request.",
  "    2. The Solana wallet (Phantom / Solflare / Ledger Live) routes the request",
  "       to your hardware device.",
  "    3. Your hardware device wakes and displays a hash on its physical screen",
  "       (labeled \"Message Hash\" on Ledger SOL app).",
  "    4. You compare the device screen to the PREDICTED hash above,",
  "       character-for-character.",
  "    5. If they match → approve on the device.",
  "    6. If they differ → REJECT on the device. This is a tamper signal.",
].join("\n");
