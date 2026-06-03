// Format-fanout-sentinel single source of truth for the Bittensor cross-check
// blocks the Phase 47 tools emit. APPEND-ONLY sibling of `blocks-solana.ts` /
// `blocks-tron.ts` — EVM/Solana/TRON templates stay byte-frozen; Bittensor
// templates live in THIS file. Per the CLAUDE.md "format-fanout-regex-sync"
// rule, these multi-line block-strings live in ONE place and are referenced
// via `.replace("{PLACEHOLDER}", value)` from both production handlers (the
// prepare tools, this plan) and the preview arm (Plan 47-03). Re-declaring any
// block in another file violates the format-fanout invariant.
//
// Block taxonomy:
//   - PREPARE_RECEIPT_BITTENSOR_NATIVE_TEMPLATE      — prepare_bittensor_native_send (47-02)
//   - PREPARE_RECEIPT_BITTENSOR_ADD_STAKE_TEMPLATE   — prepare_bittensor_add_stake_limit (47-02)
//   - PREPARE_RECEIPT_BITTENSOR_REMOVE_STAKE_TEMPLATE— prepare_bittensor_remove_stake_limit (47-02)
//   - LEDGER_BLIND_SIGN_HASH_BITTENSOR_TEMPLATE      — preview_send Bittensor (47-03) — blake2-256
//   - DECODED_ARGS_BITTENSOR_TEMPLATE                — preview_send Bittensor (47-03)
//   - VERIFY_BEFORE_SIGNING_BITTENSOR_TEMPLATE       — preview_send (47-03)
//
// UNIT DISCIPLINE (47-RESEARCH §Pitfall 3): the add-stake receipt labels its
// amount "TAO/RAO"; the remove-stake receipt labels its amount "ALPHA". The
// labels are LOAD-BEARING — they are the user-facing guard against the
// TAO-vs-ALPHA off-by-unit class. Do NOT genericize the label to "amount".

/**
 * PREPARE RECEIPT — Bittensor native TAO transfer (verbatim agent args, NO
 * normalization). Substituted by `prepare_bittensor_native_send.ts`. Slots:
 *   - `{TO}`  — recipient SS58 (raw agent string, full, untruncated).
 *   - `{RAO}` — amount in RAO (raw agent string).
 */
export const PREPARE_RECEIPT_BITTENSOR_NATIVE_TEMPLATE: string = [
  "PREPARE RECEIPT (Bittensor — native transfer)",
  "  chain:    bittensor (subtensor / Finney)",
  "  call:     balances.transferKeepAlive",
  "  to:       {TO}",
  "  rao:      {RAO}",
].join("\n");

/**
 * PREPARE RECEIPT — Bittensor add_stake_limit (the DEFAULT slippage-guarded
 * staking entry). Substituted by `prepare_bittensor_add_stake_limit.ts`.
 * The amount is LABELED "TAO/RAO" (Pitfall 3 — NEVER alpha here). Slots:
 *   - `{HOTKEY}`        — validator hotkey SS58 (FULL, untruncated — TAO-W-04).
 *   - `{NETUID}`        — subnet id.
 *   - `{SUBNET}`        — netuid→subnet identity (name) echoed; empty if unknown.
 *   - `{AMOUNT_RAO}`    — amount_staked in RAO (raw agent string).
 *   - `{LIMIT_PRICE}`   — derived RAO-per-alpha slippage ceiling.
 *   - `{TOLERANCE_PCT}` — the applied tolerance %.
 */
export const PREPARE_RECEIPT_BITTENSOR_ADD_STAKE_TEMPLATE: string = [
  "PREPARE RECEIPT (Bittensor — add_stake_limit, slippage-guarded)",
  "  chain:            bittensor (subtensor / Finney)",
  "  call:             subtensorModule.add_stake_limit",
  "  hotkey:           {HOTKEY}",
  "  netuid:           {NETUID}",
  "  subnet:           {SUBNET}",
  "  amount (TAO/RAO): {AMOUNT_RAO}",
  "  limit_price:      {LIMIT_PRICE}  (max RAO-per-alpha; ceiling = price + {TOLERANCE_PCT}%)",
  "  allow_partial:    {ALLOW_PARTIAL}",
].join("\n");

/**
 * PREPARE RECEIPT — Bittensor remove_stake_limit (the DEFAULT slippage-guarded
 * staking exit). Substituted by `prepare_bittensor_remove_stake_limit.ts`.
 * The amount is LABELED "ALPHA" — a DISTINCT unit from TAO despite the shared
 * 9-decimal scale (Pitfall 3). Slots mirror the add template, amount is alpha.
 */
export const PREPARE_RECEIPT_BITTENSOR_REMOVE_STAKE_TEMPLATE: string = [
  "PREPARE RECEIPT (Bittensor — remove_stake_limit, slippage-guarded)",
  "  chain:           bittensor (subtensor / Finney)",
  "  call:            subtensorModule.remove_stake_limit",
  "  hotkey:          {HOTKEY}",
  "  netuid:          {NETUID}",
  "  subnet:          {SUBNET}",
  "  amount (ALPHA):  {AMOUNT_ALPHA}",
  "  limit_price:     {LIMIT_PRICE}  (min RAO-per-alpha; floor = price − {TOLERANCE_PCT}%)",
  "  allow_partial:   {ALLOW_PARTIAL}",
].join("\n");

/**
 * LEDGER BLIND-SIGN HASH (Bittensor) — the blake2-256 device-display hash
 * surface, emitted by the preview_send Bittensor branch (Plan 47-03). THE
 * DIVERGENCE: blake2-256 (Substrate convention), NOT SHA-256 (Solana/TRON) or
 * keccak256 (EVM). Slots:
 *   - `{HASH_FULL_64HEX}`            — full 0x-prefixed 64-char blake2-256 hash.
 *   - `{HASH_CHUNKED_4_CHAR_GROUPS}` — same hash chunked into 4-char groups.
 *
 * The trust anchor is the on-device hash match — the user reads the Polkadot
 * Generic app screen and compares character-for-character against the full
 * hash line. The Generic app may blind-sign (display only the hash) for the
 * stake extrinsics — that residual is documented in SECURITY.md (TAO-W-05);
 * the (section,method) allowlist + the on-device hash match + chain-enforced
 * CheckMetadataHash are the compensating controls.
 */
export const LEDGER_BLIND_SIGN_HASH_BITTENSOR_TEMPLATE: string = [
  "LEDGER BLIND-SIGN HASH (Bittensor)",
  "  Predicted hash (full):    {HASH_FULL_64HEX}",
  "  Predicted hash (chunked): {HASH_CHUNKED_4_CHAR_GROUPS}",
  "",
  "  This is the blake2-256 of the unsigned extrinsic payload — the hash the",
  "  Polkadot Generic Ledger app displays when blind-signing. After you say",
  "  \"send\", your Ledger device displays a hash on its physical screen. Compare",
  "  it character-for-character to the predicted hash above. If they match →",
  "  approve on the device. If they differ → REJECT on the device (tamper signal).",
].join("\n");

/**
 * DECODED ARGS (Bittensor) — the decoded extrinsic surface emitted by the
 * preview_send Bittensor branch (Plan 47-03). One slot carries the
 * pre-formatted, per-extrinsic-unit-labeled body lines (the preview arm
 * formats the discriminated `BittensorInstructionSummary` into this block).
 */
export const DECODED_ARGS_BITTENSOR_TEMPLATE: string = [
  "DECODED ARGS (Bittensor)",
  "{DECODED_BODY}",
].join("\n");

/**
 * VERIFY BEFORE SIGNING (Bittensor) — user-facing pre-flight + post-send
 * ritual summary. Mirror of the Solana template; the network line names
 * Bittensor and the device-app line names the Polkadot Generic app. Constant
 * prose, no placeholders.
 */
export const VERIFY_BEFORE_SIGNING_BITTENSOR_TEMPLATE: string = [
  "VERIFY BEFORE SIGNING",
  "  Network: Bittensor (subtensor / Finney)",
  "",
  "  Pre-send pre-flight (now, before you say \"send\"):",
  "    a. Read the PREPARE RECEIPT — these are the args the agent passed, verbatim.",
  "       Confirm the AMOUNT UNIT: add_stake is TAO/RAO; remove_stake is ALPHA.",
  "    b. For staking: confirm the limit_price guard direction (add = price ceiling,",
  "       remove = price floor) protects you against the dTAO AMM slippage.",
  "    c. Note the LEDGER BLIND-SIGN HASH (Bittensor) hash above — you will compare",
  "       it against your physical device in step 4.",
  "    d. If anything disagrees, call send_transaction with userDecision: \"cancel\".",
  "",
  "  Post-send on-device ritual (the 6-step sequence):",
  "    1. You say \"send\" — send_transaction assembles + broadcasts the extrinsic.",
  "    2. The Polkadot Generic Ledger app routes the signing request to your device.",
  "    3. Your hardware device wakes and displays a hash on its physical screen.",
  "    4. You compare the device screen to the PREDICTED hash above,",
  "       character-for-character.",
  "    5. If they match → approve on the device.",
  "    6. If they differ → REJECT on the device. This is a tamper signal.",
].join("\n");
