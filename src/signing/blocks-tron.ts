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

// ---------------------------------------------------------------------------
// Phase 19 Plan 19-01 — APPEND-ONLY templates for TRC-20 approve/revoke.
// DO NOT modify the 7 templates above — they are BYTE-FROZEN (Phase 18).
// ---------------------------------------------------------------------------

/**
 * PREPARE RECEIPT — TRON TRC-20 approve (Plan 19-01 — verbatim agent args,
 * NO normalization). Substituted by `prepare_tron_token_approve.ts` (Plan
 * 19-01) and re-rendered in `preview_send.ts` TRON approve arm. Seven slots:
 *   - `{CHAIN}`           — always `"TRON mainnet"` (kept as slot for symmetry
 *                           with native + TRC-20 transfer templates).
 *   - `{TOKEN}`           — TRC-20 contract base58check address (raw agent string).
 *   - `{SPENDER}`         — spender base58check address (raw agent string).
 *   - `{AMOUNT}`          — VERBATIM agent input per D-02c — surfaces `"max"` not
 *                           the expanded decimal; `"0"` for revoke.
 *   - `{REF_BLOCK_BYTES}` — pinned at prepare time; surfaced verbatim.
 *   - `{REF_BLOCK_HASH}`  — pinned at prepare time; surfaced verbatim.
 *   - `{EXPIRATION}`      — expiration timestamp (ms); surfaced verbatim.
 *
 * The spender LABEL lives in the separate `KNOWN_SPENDER_LABEL_TRON_TEMPLATE`
 * block, NOT here — keeps this template stable when the label table churns.
 * Mirrors the Plan 18-03 `PREPARE_RECEIPT_TRON_TRC20_TEMPLATE` shape.
 */
export const PREPARE_RECEIPT_TRON_APPROVE_TEMPLATE: string = [
  "PREPARE RECEIPT (TRON — TRC-20 approve)",
  "  chain:          {CHAIN}",
  "  tokenAddress:   {TOKEN}",
  "  spender:        {SPENDER}",
  "  amount:         {AMOUNT}",
  "  refBlockBytes:  {REF_BLOCK_BYTES}",
  "  refBlockHash:   {REF_BLOCK_HASH}",
  "  expiration:     {EXPIRATION}",
].join("\n");

/**
 * UNLIMITED APPROVAL (TRON) — emitted CONDITIONALLY by preview_send TRON approve
 * arm (Plan 19-01) ONLY when `summary.kind === "trc20-approve" && summary.amountIsMax === true`.
 * NOT emitted for revoke (summary.kind === "trc20-revoke"). Two slots:
 *   - `{TOKEN}`   — TRC-20 contract base58check address.
 *   - `{SPENDER}` — spender base58check address.
 *
 * Mirrors the EVM `UNLIMITED_APPROVAL_TEMPLATE` from `blocks.ts` (Plan 06-03)
 * but adapted for TRON base58check address disclosure and hints at the TRON
 * revoke tool `prepare_tron_revoke_approval`.
 *
 * T-19-01-T-MAX-EXPLICIT mitigation: the `"max"` sentinel (lowercase strict
 * equality per D-02b) always produces `amountIsMax: true` on the stored summary,
 * so this block ALWAYS fires for unlimited approvals without needing the agent
 * to explicitly request the warning.
 */
export const UNLIMITED_APPROVAL_TRON_TEMPLATE: string = [
  "⚠ UNLIMITED APPROVAL (TRON)",
  "  Token:   {TOKEN}",
  "  Spender: {SPENDER}",
  "",
  "  You are approving an UNLIMITED allowance (MAX_UINT256) on this TRON token.",
  "  This spender will be able to transfer any amount of this token at any time.",
  "  TRON base58check addresses are the authoritative identifiers — verify the",
  "  on-device display matches the SPENDER address above character-for-character.",
  "",
  "  To revoke this approval later, call:",
  "    prepare_tron_revoke_approval({ tokenAddress: \"{TOKEN}\", spender: \"{SPENDER}\" })",
  "",
  "  Only approve if you trust the spender contract explicitly.",
].join("\n");

/**
 * SPENDER LABEL (TRON) — emitted by preview_send TRON approve arm (Plan 19-01)
 * to surface the `KNOWN_SPENDERS_TRON` lookup result for the spender address.
 * Three slots:
 *   - `{SPENDER}` — spender base58check address.
 *   - `{LABEL}`   — resolved label from KNOWN_SPENDERS_TRON, or the literal
 *                   `(unknown spender — no prior interaction recorded)` for
 *                   spenders not in the table.
 *   - `{SOURCE}`  — citation source for the label (e.g. the SOT URL).
 *
 * The label is ADVISORY ONLY — on-device spender address (base58check) is the
 * trust anchor per T-19-01-T-SPENDER-LABEL. A stale label is degraded UX,
 * not a safety failure. The regression test in `config-contracts.tron.test.ts`
 * asserts the table SOT doesn't silently drift.
 */
export const KNOWN_SPENDER_LABEL_TRON_TEMPLATE: string = [
  "SPENDER LABEL (TRON)",
  "  Spender:   {SPENDER}",
  "  Label:     {LABEL}",
  "  Source:    {SOURCE}",
].join("\n");

// ---------------------------------------------------------------------------
// Phase 19 Plan 19-02 — APPEND-ONLY templates for TRON Stake 2.0.
// DO NOT modify the 10 templates above — they are BYTE-FROZEN (Phase 18 + Plan 19-01).
// ---------------------------------------------------------------------------

/**
 * PREPARE RECEIPT — TRON Stake 2.0 freeze (FreezeBalanceV2Contract).
 * Plan 19-02 — verbatim agent args, NO normalization. Five slots:
 *   - `{RESOURCE}`        — "ENERGY" or "BANDWIDTH" (verbatim agent string).
 *   - `{SUN}`             — raw SUN amount decimal string (verbatim agent string).
 *   - `{REF_BLOCK_BYTES}` — pinned at prepare time; surfaced verbatim.
 *   - `{REF_BLOCK_HASH}`  — pinned at prepare time; surfaced verbatim.
 *   - `{EXPIRATION}`      — expiration timestamp (ms); surfaced verbatim.
 *
 * Mirrors the Phase 18 PREPARE_RECEIPT_TRON_NATIVE_TEMPLATE shape but names
 * the Stake 2.0 contract type explicitly.
 */
export const PREPARE_RECEIPT_TRON_STAKE_FREEZE_TEMPLATE: string = [
  "PREPARE RECEIPT (TRON — Stake 2.0 freeze)",
  "  chain:          TRON mainnet",
  "  resource:       {RESOURCE}",
  "  sun:            {SUN}",
  "  refBlockBytes:  {REF_BLOCK_BYTES}",
  "  refBlockHash:   {REF_BLOCK_HASH}",
  "  expiration:     {EXPIRATION}",
].join("\n");

/**
 * PREPARE RECEIPT — TRON Stake 2.0 unfreeze (UnfreezeBalanceV2Contract).
 * Plan 19-02 — verbatim agent args, NO normalization. Five slots:
 *   - `{RESOURCE}`        — "ENERGY" or "BANDWIDTH" (verbatim agent string).
 *   - `{SUN}`             — raw SUN amount decimal string (verbatim agent string).
 *   - `{REF_BLOCK_BYTES}` — pinned at prepare time; surfaced verbatim.
 *   - `{REF_BLOCK_HASH}`  — pinned at prepare time; surfaced verbatim.
 *   - `{EXPIRATION}`      — expiration timestamp (ms); surfaced verbatim.
 *
 * Note: unfreeze initiates the 14-day waiting period; the STAKE_WAITING_PERIOD_TRON_TEMPLATE
 * block is emitted separately (not in this template) for clear-sign readability.
 */
export const PREPARE_RECEIPT_TRON_STAKE_UNFREEZE_TEMPLATE: string = [
  "PREPARE RECEIPT (TRON — Stake 2.0 unfreeze)",
  "  chain:          TRON mainnet",
  "  resource:       {RESOURCE}",
  "  sun:            {SUN}",
  "  refBlockBytes:  {REF_BLOCK_BYTES}",
  "  refBlockHash:   {REF_BLOCK_HASH}",
  "  expiration:     {EXPIRATION}",
].join("\n");

/**
 * PREPARE RECEIPT — TRON Stake 2.0 withdraw-expire-unfreeze (WithdrawExpireUnfreezeContract).
 * Plan 19-02 — zero-arg contract (no resource, no sun). Three slots:
 *   - `{REF_BLOCK_BYTES}` — pinned at prepare time; surfaced verbatim.
 *   - `{REF_BLOCK_HASH}`  — pinned at prepare time; surfaced verbatim.
 *   - `{EXPIRATION}`      — expiration timestamp (ms); surfaced verbatim.
 *
 * NO `{RESOURCE}` or `{SUN}` slots — `WithdrawExpireUnfreezeContract` takes
 * no parameters; the protocol auto-withdraws ALL expired-unfreeze records for
 * the caller (per RESEARCH §Topic 3 Pitfall — second arg is TransactionCommonOptions, not amount).
 */
export const PREPARE_RECEIPT_TRON_WITHDRAW_EXPIRE_TEMPLATE: string = [
  "PREPARE RECEIPT (TRON — Stake 2.0 withdraw expired unfreeze)",
  "  chain:          TRON mainnet",
  "  refBlockBytes:  {REF_BLOCK_BYTES}",
  "  refBlockHash:   {REF_BLOCK_HASH}",
  "  expiration:     {EXPIRATION}",
].join("\n");

/**
 * CHECKS PERFORMED (TRON — Stake 2.0 resource) — surfaces the resource
 * semantics for freeze and unfreeze operations. Two slots:
 *   - `{RESOURCE}`             — "ENERGY" or "BANDWIDTH".
 *   - `{RESOURCE_DESCRIPTION}` — human-readable description of the resource
 *                                (e.g. "ENERGY (consumed by TRC-20 transfers + contract calls)"
 *                                or "BANDWIDTH (consumed by tx broadcast)").
 *
 * Emitted by prepare_tron_stake_freeze and prepare_tron_stake_unfreeze.
 * NOT emitted by prepare_tron_withdraw_expire_unfreeze (zero-arg; no resource context).
 * Per CONTEXT §Specifics: Energy reduces TRC-20 transfer costs; Bandwidth reduces
 * native send costs.
 */
export const STAKE_RESOURCE_TRON_TEMPLATE: string = [
  "CHECKS PERFORMED (TRON — Stake 2.0 resource)",
  "  resource:      {RESOURCE}",
  "  description:   {RESOURCE_DESCRIPTION}",
].join("\n");

/**
 * CHECKS PERFORMED (TRON — Stake 2.0 waiting period) — informs the user of
 * the 14-day waiting period after unfreeze. No slots — constant prose.
 *
 * Emitted ONLY by prepare_tron_stake_unfreeze (D-04a advisory surfacing).
 * NOT emitted by freeze or withdraw-expire.
 * The 14-day window is NOT enforced server-side at prepare time — enforcement
 * happens via the Layer 0.7 mandatory-refusal gate in preview_send.ts for
 * the withdraw-expire handle (D-04b asymmetric promotion).
 */
export const STAKE_WAITING_PERIOD_TRON_TEMPLATE: string = [
  "CHECKS PERFORMED (TRON — Stake 2.0 waiting period)",
  "  Unfreeze becomes withdrawable after 14 days; this tx initiates the waiting period.",
  "  After 14 days, call `prepare_tron_withdraw_expire_unfreeze` to withdraw.",
  "  Calling withdraw-expire before 14 days elapses will be refused at preview time",
  "  (Layer 0.7 mandatory refusal — no withdrawable balance).",
].join("\n");

/**
 * CHECKS PERFORMED (TRON — withdrawable balance found) — emitted by preview_send
 * TRON branch for `stake-withdraw-expire` handles when `checkWithdrawableBalance`
 * returns `withdrawable > 0n`. Two slots:
 *   - `{WITHDRAWABLE_SUN}` — sum of expired-unfreeze records' amounts (decimal SUN).
 *   - `{EARLIEST_EXPIRY_ISO}` — ISO 8601 timestamp of earliest-expired record, or
 *                               "n/a" when all records have already expired.
 *
 * D-04b Layer 0.7 advisory PASS for stake-withdraw-expire — signals that
 * the withdraw is eligible. Asymmetric: TRC-20 + stake-withdraw-expire use
 * mandatory refusal; this template surfaces the PASS advisory when eligible.
 */
export const WITHDRAWABLE_BALANCE_TRON_TEMPLATE: string = [
  "CHECKS PERFORMED (TRON — withdrawable balance found)",
  "  withdrawableSun: {WITHDRAWABLE_SUN}",
  "  earliestExpiry:  {EARLIEST_EXPIRY_ISO}",
  "",
  "  D-04b Layer 0.7 PASS: at least one unfreeze record has expired and",
  "  is eligible for withdrawal. Proceed to on-device signing.",
].join("\n");

// ---------------------------------------------------------------------------
// Phase 19 Plan 19-03 — APPEND-ONLY templates for TRON Stake 2.0 vote + claim rewards.
// DO NOT modify the 16 templates above — they are BYTE-FROZEN (Phase 18 + Plans 19-01 + 19-02).
// ---------------------------------------------------------------------------

/**
 * PREPARE RECEIPT — TRON Stake 2.0 vote (VoteWitnessContract).
 * Plan 19-03 — verbatim agent args, NO normalization. Three slots + per-SR rows:
 *   - `{TOTAL_COUNT}`     — total vote power allocated across all SRs (decimal string).
 *   - `{REF_BLOCK_BYTES}` — pinned at prepare time; surfaced verbatim.
 *   - `{REF_BLOCK_HASH}`  — pinned at prepare time; surfaced verbatim.
 *   - `{EXPIRATION}`      — expiration timestamp (ms); surfaced verbatim.
 *   - `{VOTE_ROWS}`       — one `SR_LABEL_TRON_TEMPLATE` block per SR (expanded inline).
 *
 * SR labels are ADVISORY per D-05c — on-device `vote_address` (base58check)
 * is the trust anchor. `{SR_SOURCE}` surfaces `"live"` or `"snapshot-fallback"`
 * so the user knows whether labels came from live data or the bundled snapshot.
 *
 * Mirrors the Plan 19-02 PREPARE_RECEIPT_TRON_STAKE_FREEZE_TEMPLATE shape.
 */
export const PREPARE_RECEIPT_TRON_VOTE_TEMPLATE: string = [
  "PREPARE RECEIPT (TRON — Stake 2.0 vote)",
  "  chain:          TRON mainnet",
  "  totalCount:     {TOTAL_COUNT}",
  "  srSource:       {SR_SOURCE}",
  "  refBlockBytes:  {REF_BLOCK_BYTES}",
  "  refBlockHash:   {REF_BLOCK_HASH}",
  "  expiration:     {EXPIRATION}",
  "{VOTE_ROWS}",
].join("\n");

/**
 * SR LABEL (TRON vote) — one entry per SR in the vote. Repeated N times and
 * joined inline into `{VOTE_ROWS}` in `PREPARE_RECEIPT_TRON_VOTE_TEMPLATE`.
 * Three slots:
 *   - `{SR_RANK}`    — vote rank or "unknown" for SRs not in the registry.
 *   - `{SR_ADDRESS}` — SR base58check address. Trust anchor on-device.
 *   - `{SR_LABEL}`   — advisory SR label from D-05c:
 *                       "(SR: <name> — vote rank <N>)" for known SRs, or
 *                       "(unverified SR — confirm address)" for unknown SRs.
 *   - `{SR_COUNT}`   — vote power allocated to this SR (decimal string).
 *
 * Advisory label only — the on-device `vote_address` is the trust anchor per D-05c.
 */
export const SR_LABEL_TRON_TEMPLATE: string = [
  "  vote[{SR_RANK}]:  {SR_ADDRESS}  {SR_LABEL}  count: {SR_COUNT}",
].join("\n");

/**
 * PREPARE RECEIPT — TRON Stake 2.0 claim rewards (WithdrawBalanceContract).
 * Plan 19-03 — zero-arg contract (no resource, no sun). Three slots:
 *   - `{REF_BLOCK_BYTES}` — pinned at prepare time; surfaced verbatim.
 *   - `{REF_BLOCK_HASH}`  — pinned at prepare time; surfaced verbatim.
 *   - `{EXPIRATION}`      — expiration timestamp (ms); surfaced verbatim.
 *
 * D-06c: NO intent-vs-reality gate on claim rewards. The calldata is zero-arg;
 * `estimatedRewardSun` is advisory — the REWARD_ESTIMATE_TRON_TEMPLATE block
 * is emitted separately (not in this template) when estimate is available.
 *
 * Mirrors the Plan 19-02 PREPARE_RECEIPT_TRON_WITHDRAW_EXPIRE_TEMPLATE shape.
 */
export const PREPARE_RECEIPT_TRON_CLAIM_REWARDS_TEMPLATE: string = [
  "PREPARE RECEIPT (TRON — Stake 2.0 claim rewards)",
  "  chain:          TRON mainnet",
  "  refBlockBytes:  {REF_BLOCK_BYTES}",
  "  refBlockHash:   {REF_BLOCK_HASH}",
  "  expiration:     {EXPIRATION}",
].join("\n");

/**
 * CHECKS PERFORMED (TRON — estimated reward) — emitted by prepare_tron_stake_claim_rewards
 * CONDITIONALLY when `getReward(from)` returns a non-null result. One slot:
 *   - `{ESTIMATED_REWARD_SUN}` — estimated reward in SUN (decimal string).
 *
 * D-06c: advisory only — null is valid; this block is OMITTED when fetch fails
 * or returns zero. NOT a refusal gate. The user is asked to approve regardless.
 * The estimate is best-effort and may differ from the actual on-chain reward at
 * execution time (TRON block rewards update every 3 seconds).
 */
export const REWARD_ESTIMATE_TRON_TEMPLATE: string = [
  "CHECKS PERFORMED (TRON — estimated reward)",
  "  estimatedRewardSun: {ESTIMATED_REWARD_SUN}",
  "",
  "  D-06c advisory: actual reward may differ from estimate (updates every ~3s).",
  "  This advisory does NOT block the prepare flow. Claim proceeds regardless.",
].join("\n");
