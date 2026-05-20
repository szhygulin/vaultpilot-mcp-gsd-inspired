// Format-fanout-sentinel single source of truth for the four cross-check
// blocks Phase 4 tools emit. Per the CLAUDE.md global rule + Phase 3
// precedent (`src/tools/pair_ledger_live.ts:53` — `VERIFY_ON_DEVICE_TEMPLATE`),
// these multi-line block-strings live in ONE place and are referenced via
// `.replace("{PLACEHOLDER}", value)` from both production handlers and
// tests. Re-declaring any of these blocks in another file violates the
// format-fanout-regex-sync invariant — a string-shape edit here would
// silently leave the duplicate behind.
//
// Block taxonomy:
//   - PREPARE_RECEIPT_TEMPLATE         — PREP-02 (verbatim agent args)
//   - LEDGER_BLIND_SIGN_HASH_TEMPLATE  — PREP-04 + A1 mitigation (full + chunked)
//   - AGENT_TASK_TEMPLATE              — PREP-05 (agent runs viem checks locally)
//   - VERIFY_BEFORE_SIGNING_TEMPLATE   — used by 04-03 + 04-05 (user-facing summary)
//   - build4byteBlock(...)             — PREP-06 (selector cross-check, four kinds)
//
// Plan 04-03 imports `build4byteBlock` from this file — no inline version
// lives in `preview_send.ts` or `get_tx_verification.ts`. Same format-fanout-
// sentinel discipline as the four block templates above.

import { formatUnits, type Address, type Hex } from "viem";

import type { FourbyteResult } from "../clients/fourbyte.js";
import { _contracts } from "../config/contracts.js";
import type { AaveV3Decoded } from "../protocols/aave-v3.js";
import type { Erc20Decoded } from "../protocols/erc20.js";
import { WETH9_DECIMALS } from "../protocols/weth9.js";
import type { SimulationResult } from "./simulation.js";

/**
 * Phase 8 — Plan 08-02. Layer 2 chain-mismatch refusal block emitted by
 * `preview_send` + `send_transaction` BEFORE the existing three gates when
 * the agent-supplied `chain` arg does NOT match the chainId bound into the
 * prepared transaction. NOT a cryptographic gate — Layer 3 (payloadFingerprint
 * drift) already byte-binds chainId; this Layer 2 catches the case where the
 * agent's natural-language story ("this is an Ethereum tx") diverges from
 * the bytes ("record.tx.chainId === 137") at preview/send time, so the user
 * sees a structured refusal instead of an on-device Network mismatch surprise.
 *
 * Substituted by preview_send + send_transaction with `{REQUESTED_CHAIN}`,
 * `{STORED_CHAIN}`, `{STORED_CHAIN_ID}`. Format-fanout-sentinel: one block,
 * one home; both callsites import this template.
 */
export const CHAIN_ID_MISMATCH_REFUSAL_TEMPLATE: string = [
  "CHAIN ID MISMATCH",
  "  agent requested:  {REQUESTED_CHAIN}",
  "  handle prepared:  {STORED_CHAIN} (chainId {STORED_CHAIN_ID})",
  "  refusal:          the agent's `chain` parameter does not match the chain bound into the prepared transaction.",
  "                    re-call prepare_* with the correct chain and try again.",
].join("\n");

// Verbatim PREPARE RECEIPT (PREP-02 — verbatim args, NO normalization).
// PrepareArgs field types are `string` (not Address / not bigint) so the
// type system blocks normalization at the storage boundary.
//
// Phase 8 — Plan 08-02: `{CHAIN}` slot widening — uniform across all 6
// PREPARE_RECEIPT templates (native + ERC-20 + approve + WETH unwrap + Aave
// supply + Aave withdraw). Substituted to e.g. "polygon (chainId 137)".
export const PREPARE_RECEIPT_TEMPLATE: string = [
  "PREPARE RECEIPT",
  "  chain:    {CHAIN}",
  "  to:       {TO}",
  "  valueWei: {VALUE_WEI}",
].join("\n");

// LEDGER BLIND-SIGN HASH (PREP-04 + A1 mitigation — both forms).
// Per research A1, a device may chunk or truncate the display. We emit BOTH
// the unbroken 0x-prefixed hex AND the 16-group chunked form so the user
// can match either way regardless of how the device renders.
//
// Issue #63 — temporal-flow correction. The previous wording instructed the
// user to compare the predicted hash against the device screen AT PREVIEW
// TIME, but no WC `eth_sendTransaction` request has been transmitted yet —
// the device screen is dark. The comparison ritual is operationally possible
// only AFTER `send_transaction` fires the WC request and the device wakes.
// Rewrite states the temporal flow explicitly so the agent + user perform
// the cryptographic-anchor check at the moment it actually exists.
export const LEDGER_BLIND_SIGN_HASH_TEMPLATE: string = [
  'EXPECTED LEDGER DEVICE DISPLAY (after you say "send")',
  "",
  "  Predicted hash (full):    {HASH_FULL}",
  "  Predicted hash (chunked): {HASH_CHUNKED}",
  "",
  "This is what your Ledger HARDWARE DEVICE will display in blind-sign mode AFTER",
  'you say "send" and the request reaches the device. The device screen is dark',
  "right now — there is nothing to compare against until send_transaction fires.",
  "",
  "Sequence:",
  '  1. You tell the agent "send" (or "cancel" to abort cleanly with no broadcast)',
  "  2. send_transaction fires the WalletConnect request to Ledger Live",
  "  3. Ledger Live wakes your hardware device",
  "  4. The device displays a hash on its physical screen",
  "  5. You compare the device screen to the PREDICTED hash above —",
  "     character-for-character",
  "  6. If they match → approve on the device",
  "     If they differ → REJECT on the device (tamper signal)",
  "",
  "The cryptographic trust anchor is step 5: YOUR EYES comparing the predicted",
  "hash above against the hash your physical device displays. Steps 1-4 are the",
  "agent + this MCP + WalletConnect + Ledger Live — all untrusted relays. Only",
  "the device screen at step 4 is the trusted display.",
  "",
  "DO NOT confuse Ledger Live (desktop app, routes WC requests) with the Ledger",
  "device (hardware screen, trusted display). The hash to compare is on the",
  "DEVICE, not in Ledger Live.",
].join("\n");

// AGENT TASK (PREP-05 — verbatim prose from research § Pattern 2 lines 364–384).
// The agent runs the four checks LOCALLY using viem (does not delegate to
// the server) and emits a `CHECKS PERFORMED (pre-send, by agent)` block
// before the confirm prompt. Issue #63 temporal-flow correction: the block
// splits pre-send (agent-runs local cryptographic checks) from post-send
// (user compares device screen vs the predicted hash after send_transaction
// fires) so the user is not asked to perform an on-device match at a moment
// when the device is dark.
export const AGENT_TASK_TEMPLATE: string = [
  "[AGENT TASK — RUN THESE CHECKS NOW]",
  "Before asking the user to confirm, perform the following local verification",
  "in your own runtime (do not delegate to the server):",
  "",
  "  1. Re-decode the unsigned tx bytes using viem.parseTransaction.",
  "  2. Assert decoded.to === {TO} and decoded.value === {VALUE_WEI}.",
  "  3. Recompute keccak256(viem.serializeTransaction(decoded)) and confirm it",
  "     equals {PRESIGN_HASH}.",
  "",
  "Report results to the user in a two-part block before the confirm prompt.",
  "Format:",
  "",
  "  CHECKS PERFORMED (pre-send, by agent)",
  "    decoded.to:           <value or `error: …`>",
  "    decoded.value:        <value or `error: …`>",
  "    recomputed presign:   <value or `error: …`>",
  "    matches predicted:    <yes / no / error>",
  "",
  "  USER MUST PERFORM (post-send, on device)",
  '    After saying "send", your Ledger device screen will display a hash.',
  "    Compare it to the PREDICTED hash above. Approve only if they match.",
  "",
  "If any pre-send check fails, halt and report the failure to the user — do",
  "not send.",
].join("\n");

// VERIFY BEFORE SIGNING — used by 04-03 + 04-05 as a user-facing summary of
// every cross-check artifact the user should read before approving on the
// device. No placeholders — constant prose. Issue #63: rewritten as a
// 6-step temporal sequence (pre-send pre-flight → say send → WC routes →
// device wakes → user compares → approve OR reject on device) so the
// on-device cryptographic-anchor check sits at the moment the device is
// actually displaying a hash.
export const VERIFY_BEFORE_SIGNING_TEMPLATE: string = [
  "VERIFY BEFORE SIGNING",
  "  Pre-send pre-flight (now, before you say \"send\"):",
  "    a. Read the PREPARE RECEIPT — these are the args the agent passed, verbatim.",
  "    b. Read the CHECKS PERFORMED (pre-send, by agent) block — every line must say yes.",
  "    c. Note the EXPECTED LEDGER DEVICE DISPLAY hash above — you will compare it",
  "       against your physical device in step 4.",
  '    d. If anything disagrees, call send_transaction with userDecision: "cancel".',
  "",
  "  Post-send on-device ritual (the 6-step sequence):",
  '    1. You say "send" — send_transaction fires the WalletConnect request.',
  "    2. Ledger Live routes the request to your hardware device.",
  "    3. Your hardware device wakes and displays a hash on its physical screen.",
  "    4. You compare the device screen to the PREDICTED hash above,",
  "       character-for-character.",
  "    5. If they match → approve on the device.",
  "    6. If they differ → REJECT on the device. This is a tamper signal.",
].join("\n");

/**
 * Split a 32-byte `0x`-prefixed hex into 16 groups of 4 hex chars separated
 * by single spaces. Strips the `0x` prefix. Example:
 *
 *   chunkHex("0xb28e48247c132650294459b31a5ad7e4e9ad187abb0f984388629b2c29e27e85")
 *   // => "b28e 4824 7c13 2650 2944 59b3 1a5a d7e4 e9ad 187a bb0f 9843 8862 9b2c 29e2 7e85"
 *
 * Throws on any input that is not a strict 32-byte 0x-prefixed hex string.
 */
export function chunkHex(hex: Hex): string {
  if (!/^0x[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error("chunkHex requires a 32-byte 0x-prefixed hex string");
  }
  const body = hex.slice(2);
  const groups = body.match(/.{1,4}/g);
  // body.length === 64 → groups is always 16 entries, never null.
  return (groups as string[]).join(" ");
}

/**
 * Render the PREP-06 4byte cross-check block from a `FourbyteResult`.
 *
 * Output is a multi-line `4BYTE CROSS-CHECK` block whose body depends on
 * `result.kind`:
 *
 *   - `not-applicable` (selector === null, native sends): names the
 *     condition explicitly ("no function call data — native value
 *     transfer"); the user sees a deliberate not-applicable status,
 *     not a missing block.
 *   - `found`: shows the selector AND the verbatim `text_signature`.
 *     The signature ships through VERBATIM — never parsed, never
 *     used in dispatch decisions (T-4BYTE-1). Cross-check artifact
 *     only.
 *   - `not-found`: shows the selector + a "no signature found in
 *     4byte.directory" note. User decides whether to proceed; the
 *     LEDGER BLIND-SIGN HASH match is the load-bearing check.
 *   - `error`: shows the selector + the verbatim upstream error
 *     message (HTTP status, timeout, network unreachable). NEVER
 *     masked as `not-found` (PREP-06 + T-4BYTE-MASK-1).
 *
 * Used by:
 *   - Plan 04-03 `preview_send` (first emission)
 *   - Plan 04-05 `get_tx_verification` (re-emission)
 *
 * Both call sites import THIS function — no inline duplicate exists.
 */
export function build4byteBlock(selector: Hex | null, result: FourbyteResult): string {
  switch (result.kind) {
    case "not-applicable":
      return [
        "4BYTE CROSS-CHECK",
        "  status:   not-applicable (no function call data — native value transfer)",
      ].join("\n");
    case "found":
      return [
        "4BYTE CROSS-CHECK",
        `  selector:  ${selector ?? "(null)"}`,
        `  signature: ${result.textSignature}`,
      ].join("\n");
    case "not-found":
      return [
        "4BYTE CROSS-CHECK",
        `  selector: ${selector ?? "(null)"}`,
        "  status:   no known signature found in 4byte.directory",
      ].join("\n");
    case "error":
      return [
        "4BYTE CROSS-CHECK",
        `  selector: ${selector ?? "(null)"}`,
        `  error:    ${result.message}`,
      ].join("\n");
  }
}

// -----------------------------------------------------------------------------
// Phase 6 — Plan 06-02 additive extensions. The Phase 4 templates above stay
// unchanged (FROZEN — Plan 04-02 / 04-03 / 04-05 callers byte-identical).
// -----------------------------------------------------------------------------

/**
 * ERC-20 PREPARE RECEIPT (PREP-02 — verbatim agent args, NO normalization).
 *
 * Parallel template to PREPARE_RECEIPT_TEMPLATE for ERC-20 prepare tools.
 * 06-PATTERNS.md line 97 calls this out explicitly: token-aware receipts are
 * semantically different from native-send receipts (three fields, all of
 * which the user must inspect on the device), so a second template is the
 * clean shape — NOT a widening of the native template.
 *
 * Substituted by `prepare_token_send.ts` (06-02) and reused by
 * `prepare_token_approve.ts` / `prepare_revoke_approval.ts` (06-03) with the
 * `{TO}` slot relabeled as `spender` in the inheriting receipt text. Plan
 * 06-04's `prepare_weth_unwrap` ships its own receipt template (no `to`).
 */
export const ERC20_PREPARE_RECEIPT_TEMPLATE: string = [
  "PREPARE RECEIPT",
  "  chain:        {CHAIN}",
  "  tokenAddress: {TOKEN_ADDRESS}",
  "  to:           {TO}",
  "  amount:       {AMOUNT}",
].join("\n");

/**
 * DECODED ARGS block — transfer(to, amount) shape. Preview-time-decoded
 * args from the prepared transaction's calldata, surfaced for the agent's
 * CHECKS PERFORMED block to corroborate.
 *
 * Plan 06-02 ships this template + the transfer branch of
 * `buildDecodedArgsBlock`. Plan 06-03 adds the approve template (with the
 * `⚠ UNLIMITED APPROVAL` conditional sub-block). Plan 06-04 adds the
 * withdraw template (WETH unwrap).
 */
export const DECODED_ARGS_TEMPLATE_TRANSFER: string = [
  "DECODED ARGS",
  "  function:  transfer",
  "  token:     {TOKEN}",
  "  recipient: {RECIPIENT}",
  "  amount:    {AMOUNT_HUMAN}",
  "  amountWei: {AMOUNT_WEI}",
].join("\n");

/**
 * ERC-20 APPROVE PREPARE RECEIPT (PREP-02). Plan 06-03 ships a dedicated
 * template (distinct from `ERC20_PREPARE_RECEIPT_TEMPLATE` which uses a
 * `to:` slot — approves have no `to`, only a `spender:`). The two templates
 * stay separate per the format-fanout-sentinel rule + 06-PATTERNS.md line 97:
 * approve receipts are semantically a different shape from transfer
 * receipts; one block, one home.
 *
 * Substituted by `prepare_token_approve.ts` and `prepare_revoke_approval.ts`
 * — both go through the shared `prepareApproveInternal` helper so the
 * substitution shape stays byte-identical between the two tools.
 */
export const APPROVE_PREPARE_RECEIPT_TEMPLATE: string = [
  "PREPARE RECEIPT",
  "  chain:        {CHAIN}",
  "  tokenAddress: {TOKEN_ADDRESS}",
  "  spender:      {SPENDER}",
  "  amount:       {AMOUNT}",
].join("\n");

/**
 * DECODED ARGS block — approve(spender, amount) shape. Plan 06-03 ships the
 * full surface: function/token/spender/spenderLabel/amount/amountWei plus a
 * conditional `⚠ UNLIMITED APPROVAL` substitution + revoke-hint line.
 *
 * The `{REVOKE_HINT}` slot is filtered out when empty so the bounded path
 * emits a tight block; the unlimited path adds the one-line revoke pointer
 * directly after `amountWei:`.
 *
 * Unlimited threshold per research § Topic 6 is STRICT equality to
 * MAX_UINT256 (Etherscan / Revoke.cash / OpenZeppelin consensus). Fuzzy
 * `> 1e30` thresholds are explicitly rejected — `decodeErc20Call` returns
 * `isUnlimited: amount === MAX_UINT256` (src/protocols/erc20.ts line 158),
 * the only sentinel.
 */
export const DECODED_ARGS_TEMPLATE_APPROVE: string = [
  "DECODED ARGS",
  "  function:     approve",
  "  token:        {TOKEN}",
  "  spender:      {SPENDER}",
  "  spenderLabel: {SPENDER_LABEL}",
  "  amount:       {AMOUNT_HUMAN}",
  "  amountWei:    {AMOUNT_WEI}",
  "{REVOKE_HINT}",
].join("\n");

/**
 * WETH UNWRAP PREPARE RECEIPT (PREP-02). Plan 06-04 ships a dedicated
 * template — WETH unwrap has no `to` (no recipient; the burn returns native
 * ETH to the caller) and no `spender` (no approval surface), so the receipt
 * has two slots: tokenAddress + amount. The receipt is short by design — the
 * operation is unambiguous, and the agent that surfaces an extra slot has
 * drifted from the SOT.
 *
 * Substituted by `prepare_weth_unwrap.ts`. Format-fanout-sentinel: one
 * block, one home.
 */
export const WETH_UNWRAP_PREPARE_RECEIPT_TEMPLATE: string = [
  "PREPARE RECEIPT",
  "  operation:    WETH unwrap",
  "  chain:        {CHAIN}",
  "  tokenAddress: {TOKEN_ADDRESS}",
  "  amount:       {AMOUNT}",
].join("\n");

/**
 * DECODED ARGS block — withdraw(amount) shape. Plan 06-04 replaces Plan
 * 06-02's TODO stub with the real WETH9 surfacing. The `{TOKEN}` slot
 * renders the WETH9 contract address + a "(WETH9 — canonical)" label so the
 * user can cross-check against src/config/contracts.ts. The `{AMOUNT_HUMAN}`
 * slot uses formatUnits(amount, WETH9_DECIMALS=18); the `{AMOUNT_WEI}` slot
 * carries the raw bigint string.
 */
export const DECODED_ARGS_TEMPLATE_WITHDRAW: string = [
  "DECODED ARGS",
  "  function:  withdraw",
  "  token:     {TOKEN}",
  "  amount:    {AMOUNT_HUMAN}",
  "  amountWei: {AMOUNT_WEI}",
].join("\n");

/**
 * LEDGER NOTICE block — emitted in preview_send ABOVE the LEDGER BLIND-SIGN
 * HASH for the WETH9.withdraw selector. Research § Topic 5 (A2 mitigation):
 * the Ledger Ethereum app's ERC-20 clear-sign plugin does NOT cover WETH9's
 * withdraw method, so the device will display the raw hash rather than
 * decoded args. Devices ship with blind-sign DISABLED by default; the user
 * hits a confusing refusal ("Blind signing is not enabled") unless they
 * enable the setting first.
 *
 * The block carries the exact Ledger UI navigation path so the user can
 * enable the setting without leaving the rehearsal. Non-cryptographic UX
 * defense — the trust anchor remains the LEDGER BLIND-SIGN HASH match
 * (which the block re-anchors in its closing line).
 *
 * Conditional emission: ONLY for the withdraw selector. Transfer + approve
 * + revoke are clear-signed on known tokens; native sends have no selector
 * to dispatch on. preview_send's selector-routed condition is
 * `selector === WETH9_SELECTORS.withdraw && record.tx.to === getWethAddress(1)`.
 */
export const LEDGER_NOTICE_WETH_UNWRAP_TEMPLATE: string = [
  "LEDGER NOTICE",
  "  WETH unwrap is NOT covered by the Ledger Ethereum app's ERC-20 clear-sign plugin.",
  "  Your device will likely BLIND-SIGN this transaction (display a raw hash, no decoded args).",
  "  If your device refuses with \"Blind signing is not enabled\":",
  "    1. Open the Ethereum app on your device",
  "    2. Settings → Blind signing → Enabled",
  "    3. Retry send_transaction",
  "  After send_transaction fires, compare the PREDICTED hash below to the",
  "  value your hardware device displays — character-for-character. This",
  "  on-device match is the cryptographic anchor.",
].join("\n");

/**
 * Render the DECODED ARGS block from an `Erc20Decoded` result + optional
 * token decimals context.
 *
 *   - `kind: "transfer"`: substitute the transfer template; render
 *     `amountHuman` via `formatUnits(amount, tokenContext.decimals)` when
 *     `tokenContext` is non-null, else show the raw bigint amount with a
 *     "(decimals unknown — call get_token_metadata)" note.
 *   - `kind: "approve"`: stub block (Plan 06-03 replaces with the real
 *     approve template + UNLIMITED APPROVAL surfacing).
 *   - `kind: "withdraw"`: stub block (Plan 06-04 replaces with the WETH
 *     unwrap surfacing).
 *   - `kind: "unknown"`: returns empty string — preview_send filters empty
 *     blocks from the text-array join so native sends (selector === null,
 *     `decodeErc20Call("0x")` → unknown) don't emit a stray empty block.
 *
 * `tokenContext` is supplied by preview_send from the top-50 token registry
 * lookup against `record.tx.to` (the token contract). Off-list tokens
 * surface `null` and the block emits the raw bigint amount.
 */
export function buildDecodedArgsBlock(
  decoded: Erc20Decoded,
  tokenContext: { symbol: string; decimals: number } | null,
  recordTxTo: Address,
): string {
  switch (decoded.kind) {
    case "transfer": {
      const amountHuman =
        tokenContext !== null
          ? `${formatUnits(decoded.amount, tokenContext.decimals)} ${tokenContext.symbol}`
          : `${decoded.amount.toString()} (decimals unknown — call get_token_metadata)`;
      return DECODED_ARGS_TEMPLATE_TRANSFER
        .replace("{TOKEN}", tokenContext !== null ? tokenContext.symbol : "(off-list token)")
        .replace("{RECIPIENT}", decoded.to)
        .replace("{AMOUNT_HUMAN}", amountHuman)
        .replace("{AMOUNT_WEI}", decoded.amount.toString());
    }
    case "approve": {
      // PREP-29 unlimited surfacing: STRICT equality to MAX_UINT256 only
      // (decoded.isUnlimited is the source of truth, set by
      // decodeErc20Call). No fuzzy `> 1e30` thresholds — industry-aligned
      // per research § Topic 6 (Etherscan / Revoke.cash / OpenZeppelin
      // consensus).
      //
      // PREP-30 spender label: lookupSpender via the `_contracts`
      // indirection (ESM spy-affordance). The fallback string is the
      // canonical PREP-30 literal — tested byte-identically in
      // test/preview-send.erc20.test.ts.
      const spenderRow = _contracts.lookupSpender(decoded.spender);
      const spenderLabel =
        spenderRow?.label ?? "(unknown spender — no prior interaction recorded)";

      const amountHuman = decoded.isUnlimited
        ? "⚠ UNLIMITED APPROVAL"
        : tokenContext !== null
          ? `${formatUnits(decoded.amount, tokenContext.decimals)} ${tokenContext.symbol}`
          : `${decoded.amount.toString()} (decimals unknown — call get_token_metadata)`;

      const revokeHint = decoded.isUnlimited
        ? "  (call prepare_revoke_approval with the same tokenAddress + spender to revoke)"
        : "";

      const tokenSlot = tokenContext !== null ? tokenContext.symbol : recordTxTo;

      // Filter empty REVOKE_HINT line so the bounded path emits a tight
      // block (no trailing blank line) — same shape as the transfer
      // branch's filter-empty-on-join discipline.
      const lines = DECODED_ARGS_TEMPLATE_APPROVE
        .replace("{TOKEN}", String(tokenSlot))
        .replace("{SPENDER}", decoded.spender)
        .replace("{SPENDER_LABEL}", spenderLabel)
        .replace("{AMOUNT_HUMAN}", amountHuman)
        .replace("{AMOUNT_WEI}", decoded.amount.toString())
        .replace("{REVOKE_HINT}", revokeHint)
        .split("\n")
        .filter((line) => line !== "");
      return lines.join("\n");
    }
    case "withdraw": {
      // Plan 06-04: real WETH9.withdraw surfacing. WETH9_DECIMALS is hard-
      // coded to 18 (the canonical contract is immutable on mainnet) so no
      // registry/RPC lookup is needed for the formatUnits call.
      //
      // The `{TOKEN}` slot renders the WETH9 contract address from
      // record.tx.to + a "(WETH9 — canonical)" label so the user can cross-
      // check against src/config/contracts.ts. tokenContext is ignored here
      // (callers may pass null) — the WETH9 decimals constant is the SOT.
      return DECODED_ARGS_TEMPLATE_WITHDRAW
        .replace("{TOKEN}", `${recordTxTo} (WETH9 — canonical)`)
        .replace("{AMOUNT_HUMAN}", `${formatUnits(decoded.amount, WETH9_DECIMALS)} WETH`)
        .replace("{AMOUNT_WEI}", decoded.amount.toString());
    }
    case "unknown":
      // preview_send filters empty strings from the text-array join so
      // native sends (selector === null) don't emit a stray DECODED ARGS
      // block alongside the 4byte not-applicable block.
      return "";
  }
}

/**
 * Render the SIMULATION block from a `SimulationResult`. Trust-boundary prose
 * is part of the block itself: the note line names the simulation as a
 * non-binding cross-check (the trust anchor is the device hash match) and
 * the residual T-SIMULATION-FALSE-OK-1 limitation.
 *
 * Emitted for ALL tx shapes (native + transfer + approve + withdraw) —
 * defense-in-depth uniform per research § Topic 9 (DF-1 LOCKED).
 */
export function buildSimulationBlock(result: SimulationResult): string {
  const lines = ["SIMULATION (preview-time eth_call)", `  status: ${result.status}`];
  if (result.status === "ok") {
    lines.push(`  result: ${result.resultData ?? "0x"}`);
  } else if (result.status === "revert") {
    lines.push(`  revert: ${result.errorMessage ?? "(no reason provided)"}`);
  } else {
    lines.push(`  error:  ${result.errorMessage ?? "(unknown)"}`);
  }
  lines.push(
    "  note:   This simulation predicts the on-chain outcome. A 'revert' means",
    "          the transaction would fail when broadcast — review the args",
    "          before confirming. An 'ok' status does NOT guarantee broadcast",
    "          success (gas/nonce drift can still revert). The trust anchor is",
    "          the post-send on-device hash match (compare your device screen",
    "          to the PREDICTED hash above), not this simulation.",
  );
  return lines.join("\n");
}

// -----------------------------------------------------------------------------
// Phase 7 — Plan 07-03 additive extensions (APPEND-ONLY). The Phase 4 + Phase 6
// templates above stay byte-identical (FROZEN). Existing `buildDecodedArgsBlock`
// helper for ERC-20 is byte-unchanged.
//
// NO LEDGER NOTICE template here. Research § Topic 6 verified clear-sign
// coverage in `LedgerHQ/clear-signing-erc7730-registry/registry/aave/
// calldata-lpv3.json` for supply + withdraw on chainId=1 Aave V3 Pool — devices
// display human-readable args, no blind-sign fallback expected. The Phase 6
// `LEDGER_NOTICE_WETH_UNWRAP_TEMPLATE` is the only NOTICE template; preview_send
// does NOT extend its emission condition to Aave selectors.
//
// T-AAVE-LEDGER-NOTICE-PREEMPTIVE-1 negative-anchor: any future addition of
// an Aave LEDGER NOTICE template would surface as an unused export here AND
// would fail `test/preview-send.aave.test.ts` Test 5 (asserts response text
// does NOT contain `LEDGER NOTICE` for Aave selectors).
// -----------------------------------------------------------------------------

// -----------------------------------------------------------------------------
// Phase 8 — Plan 08-04 additive extension. `SET_LEVEL_ENUMERATION_TEMPLATE`
// is the verbatim block shape emitted by `get_token_allowances` (READ-44).
//
// LOAD-BEARING for v1.3 Inv #14: the companion `vaultpilot-preflight` skill
// parses this verbatim text to assemble the outer dispatch-target allowlist
// for revoke-flow enforcement. Drift in this template breaks the v1.3 parser
// at PR-review time — Test 4 in `test/get-token-allowances.test.ts` anchors
// the shape via a hardcoded literal. Keep this template + the substitution
// logic in `get_token_allowances.ts` in lockstep.
//
// All Phase 4 / 6 / 7 / 08-02 templates above BYTE-FROZEN — this is an
// append-only addition (format-fanout-sentinel: one block, one home).
// -----------------------------------------------------------------------------

/**
 * `[SET-LEVEL ENUMERATION]` block template (Phase 8 — Plan 08-04, READ-44).
 *
 * Slots (substituted by `get_token_allowances.ts`):
 *   - `{SCOPE}`           — wallet address (full, 0x-prefixed)
 *   - `{CHAIN}`           — `<chain-name> (chainId <id>)` (e.g. `ethereum (chainId 1)`)
 *   - `{FROM_BLOCK}`      — scan window start block (decimal string)
 *   - `{TO_BLOCK}`        — scan window end block (decimal string)
 *   - `{LOOKBACK_BLOCKS}` — width of the scan window (decimal string)
 *   - `{ROW_COUNT}`       — number of active rows (after multicall cross-check)
 *   - `{TABLE}`           — Unicode-box-drawing table body (or "no active allowances")
 *
 * The block opens with `[SET-LEVEL ENUMERATION]` and closes with
 * `[END SET-LEVEL ENUMERATION]` so a downstream parser (the v1.3 preflight
 * skill) can extract the block by simple delimiter scan. The `scope:` /
 * `chain:` / `fromBlock:` / `toBlock:` / `active rows:` lines are stable
 * `<label>:<padding><value>` shapes — parsers split on `: ` and strip
 * leading whitespace from the value. The `{TABLE}` slot's per-row shape is
 * documented at the substitution site (`get_token_allowances.ts`).
 */
export const SET_LEVEL_ENUMERATION_TEMPLATE: string = [
  "[SET-LEVEL ENUMERATION]",
  "  scope:        {SCOPE}",
  "  chain:        {CHAIN}",
  "  fromBlock:    {FROM_BLOCK}",
  "  toBlock:      {TO_BLOCK} ({LOOKBACK_BLOCKS} blocks)",
  "  active rows:  {ROW_COUNT}",
  "",
  "{TABLE}",
  "[END SET-LEVEL ENUMERATION]",
].join("\n");

/**
 * Aave V3 supply PREPARE RECEIPT (PREP-02 — verbatim agent args).
 *
 * Two slots: asset + amount. `onBehalfOf` is server-derived (hardcoded to
 * sender per research § Topic 5 reasonable-call lock), not surfaced in the
 * receipt — the user reads the on-device clear-sign display for `onBehalfOf`.
 *
 * Substituted by `prepare_aave_supply.ts`. Format-fanout-sentinel: one block,
 * one home.
 */
export const AAVE_SUPPLY_PREPARE_RECEIPT_TEMPLATE: string = [
  "PREPARE RECEIPT",
  "  operation:    Aave V3 supply",
  "  chain:        {CHAIN}",
  "  asset:        {ASSET}",
  "  amount:       {AMOUNT}",
].join("\n");

/**
 * Aave V3 withdraw PREPARE RECEIPT (PREP-02 — verbatim agent args).
 *
 * Two slots: asset + amount. `to` is server-derived (hardcoded to sender —
 * explicit-self-recipient lock per research § Topic 5), not surfaced in the
 * receipt.
 *
 * Substituted by `prepare_aave_withdraw.ts`.
 */
export const AAVE_WITHDRAW_PREPARE_RECEIPT_TEMPLATE: string = [
  "PREPARE RECEIPT",
  "  operation:    Aave V3 withdraw",
  "  chain:        {CHAIN}",
  "  asset:        {ASSET}",
  "  amount:       {AMOUNT}",
].join("\n");

/**
 * DECODED ARGS block — Aave V3 `supply(asset, amount, onBehalfOf, referralCode)`
 * shape. Surfaces the four decoded fields plus the pool address (canonical SOT
 * from `getAaveV3PoolAddress(1)`) so the user can cross-check against
 * `src/config/contracts.ts`.
 *
 * `{ASSET}` is the underlying asset contract from `decodedArgs.asset` (NOT
 * `record.tx.to` — `record.tx.to` is the Pool address). The
 * T-AAVE-TX-TO-CONFUSION-1 mitigation lives at the preview_send call site:
 * `tokenContext` resolution looks up `decodedArgs.asset` against the registry.
 */
export const DECODED_ARGS_TEMPLATE_AAVE_SUPPLY: string = [
  "DECODED ARGS",
  "  function:     supply",
  "  pool:         {POOL_ADDRESS} (Aave V3 Pool — canonical)",
  "  asset:        {ASSET} {ASSET_LABEL}",
  "  amount:       {AMOUNT_HUMAN}",
  "  amountWei:    {AMOUNT_WEI}",
  "  onBehalfOf:   {ON_BEHALF_OF}",
  "  referralCode: {REFERRAL_CODE}",
].join("\n");

/**
 * DECODED ARGS block — Aave V3 `withdraw(asset, amount, to)` shape. Same
 * asset-from-decodedArgs discipline as the supply template.
 *
 * `{AMOUNT_HUMAN}` surfaces "ENTIRE BALANCE (uint256.max)" when the decoded
 * amount equals MAX_UINT256 — defense for any third-party calldata routed
 * through preview_send. v1.1's `prepare_aave_withdraw` does NOT accept the
 * "max" sentinel from the agent (concrete decimal required); the decoder still
 * detects the case for forward-compat.
 */
export const DECODED_ARGS_TEMPLATE_AAVE_WITHDRAW: string = [
  "DECODED ARGS",
  "  function:  withdraw",
  "  pool:      {POOL_ADDRESS} (Aave V3 Pool — canonical)",
  "  asset:     {ASSET} {ASSET_LABEL}",
  "  amount:    {AMOUNT_HUMAN}",
  "  amountWei: {AMOUNT_WEI}",
  "  to:        {TO}",
].join("\n");

/**
 * Render the DECODED ARGS block for an Aave V3 decoded call. Parallel helper
 * to `buildDecodedArgsBlock` — separate function so the existing ERC-20 helper
 * stays byte-frozen. preview_send selects which helper to call based on which
 * decoder returned a non-"unknown" kind.
 *
 *   - `kind: "aave-supply"`: substitute the supply template; render
 *     `amountHuman` via `formatUnits(amount, tokenContext.decimals)` when
 *     `tokenContext` is non-null, else fall back to the raw bigint with an
 *     "(unknown asset — no registry match)" label.
 *   - `kind: "aave-withdraw"`: same shape; `isMax` swaps the human amount for
 *     "ENTIRE BALANCE (uint256.max)".
 *
 * `tokenContext` is supplied by preview_send from a lookup against
 * `decodedArgs.asset` (T-AAVE-TX-TO-CONFUSION-1: NOT `record.tx.to` — that's
 * the Pool address). Off-list assets surface `null` and the block emits a
 * fallback label.
 */
export function buildAaveDecodedArgsBlock(
  decoded: Exclude<AaveV3Decoded, { kind: "unknown" }>,
  tokenContext: { symbol: string; decimals: number } | null,
  poolAddress: Address,
): string {
  const assetLabel = tokenContext
    ? `(${tokenContext.symbol})`
    : "(unknown asset — no registry match)";
  const decimals = tokenContext?.decimals ?? 18;
  if (decoded.kind === "aave-supply") {
    return DECODED_ARGS_TEMPLATE_AAVE_SUPPLY
      .replace("{POOL_ADDRESS}", poolAddress)
      .replace("{ASSET}", decoded.asset)
      .replace("{ASSET_LABEL}", assetLabel)
      .replace("{AMOUNT_HUMAN}", formatUnits(decoded.amount, decimals))
      .replace("{AMOUNT_WEI}", decoded.amount.toString())
      .replace("{ON_BEHALF_OF}", decoded.onBehalfOf)
      .replace("{REFERRAL_CODE}", String(decoded.referralCode));
  }
  // aave-withdraw
  const amountHuman = decoded.isMax
    ? "ENTIRE BALANCE (uint256.max)"
    : formatUnits(decoded.amount, decimals);
  return DECODED_ARGS_TEMPLATE_AAVE_WITHDRAW
    .replace("{POOL_ADDRESS}", poolAddress)
    .replace("{ASSET}", decoded.asset)
    .replace("{ASSET_LABEL}", assetLabel)
    .replace("{AMOUNT_HUMAN}", amountHuman)
    .replace("{AMOUNT_WEI}", decoded.amount.toString())
    .replace("{TO}", decoded.to);
}

// -----------------------------------------------------------------------------
// Phase 9 — Plan 09-02 additive extensions (APPEND-ONLY). All Phase 4 / 6 / 7 /
// 8 templates above stay byte-identical (FROZEN). These two new templates back
// the `VAULTPILOT NOTICE` dispatcher-wrap blocks emitted by
// `src/security/skill-integrity.ts::consumeSkillIntegrityNotice` on the first
// tool response of a session when the companion `vaultpilot-preflight` skill is
// either missing (no SKILL.md at any probe path) OR tampered (SKILL.md found
// but SHA-256 differs from `EXPECTED_SKILL_SHA256`).
//
// Format-fanout-sentinel: one block, one home. `consumeSkillIntegrityNotice`
// imports both templates from this file; no inline duplicate exists. Drift in
// either template breaks the `test/security-skill-integrity.test.ts` tests
// that compare the post-substitution output to the imported constant.
// -----------------------------------------------------------------------------

/**
 * `VAULTPILOT NOTICE — vaultpilot-preflight skill not installed` template.
 * Substituted with the newline-indented list of probed paths in the `{PATHS}`
 * slot. Prepended to the first tool response of a session when the probe
 * returns `{ kind: "missing", pathsProbed }`; subsequent responses in the
 * same session do NOT re-prepend (dedup via `noticeEmitted` flag in
 * `src/security/skill-integrity.ts`).
 *
 * Surfaces the canonical install one-liner so the user can recover without
 * leaving the rehearsal. The trust anchor remains the Ledger device screen;
 * the skill is defense-in-depth against a compromised-MCP scenario (without
 * it, MCP-side checks are the only defense layer).
 */
export const VAULTPILOT_NOTICE_TEMPLATE_MISSING: string = [
  "VAULTPILOT NOTICE — vaultpilot-preflight skill not installed",
  "  The companion preflight skill is not installed at any of:",
  "    {PATHS}",
  "  Without the skill, defense-in-depth against a compromised-MCP scenario is",
  "  reduced to MCP-side checks only (the trust anchor remains the Ledger device",
  "  screen). To install:",
  "    git clone https://github.com/szhygulin/vaultpilot-preflight-skill ~/.claude/skills/vaultpilot-preflight",
  "    cd ~/.claude/skills/vaultpilot-preflight && git checkout v1.3.0",
  "  See ./SECURITY.md for the full residual-risk model.",
].join("\n");

/**
 * `VAULTPILOT NOTICE — vaultpilot-preflight skill integrity mismatch` template.
 * Three slots: `{PATH}` (discovered SKILL.md path), `{COMPUTED}` (runtime
 * SHA-256 hex), `{EXPECTED}` (`EXPECTED_SKILL_SHA256` constant value).
 * Prepended to the first tool response of a session when the probe returns
 * `{ kind: "tampered", path, computed, expected }`.
 *
 * Names the three likely causes (local tamper / newer skill / older skill) so
 * the user can self-diagnose. The trust anchor remains the Ledger device
 * screen — a tampered skill MAY not enforce the invariants correctly, but
 * the MCP-side FROZEN three-gate + Layer 0.5 dispatch allowlist + Layer 2
 * chain-mismatch refusal still fire on the server side.
 */
export const VAULTPILOT_NOTICE_TEMPLATE_TAMPERED: string = [
  "VAULTPILOT NOTICE — vaultpilot-preflight skill integrity mismatch",
  "  Skill at: {PATH}",
  "  Computed SHA-256: {COMPUTED}",
  "  Expected SHA-256: {EXPECTED}",
  "  The skill content differs from the version this MCP build pins. Either:",
  "    (a) the skill was tampered with locally — re-clone or reset to the pinned tag",
  "    (b) you have a newer skill version than this MCP — upgrade vaultpilot-mcp",
  "    (c) you have an older skill version than this MCP — git checkout v1.3.0 in",
  "        ~/.claude/skills/vaultpilot-preflight",
  "  Until resolved, treat skill output as untrusted (the Ledger device screen",
  "  remains the trust anchor; the skill is defense-in-depth).",
].join("\n");

// -----------------------------------------------------------------------------
// Phase 9 Plan 09-03 — PASTEABLE_BLOCK_TEMPLATE (SEC-34).
//
// Audience: a FRESH chat session with no shared context — a SECOND LLM acts as
// independent decoder. The MCP provides the bytes; the second LLM tells the
// user what they mean. Defense-in-depth against fully-coordinated agent
// compromise (where the original agent's args AND narrative are both
// tampered with).
//
// Six slots: {CHAIN_ID}, {TO}, {VALUE_WEI}, {DATA}, {PAYLOAD_FINGERPRINT},
// {PRESIGN_HASH}. The 80-char `>>>>` open + `<<<<` close markers bound the
// region the user copies into the second LLM's chat. The canned prompt's
// 5-step decode instruction is LOCKED — drift breaks the second LLM's
// parser AND the T-PASTEABLE-BYTE-IDENTITY-1 byte-level fixture in
// `test/get-verification-artifact.test.ts`.
//
// Unicode `‖` (U+2016 DOUBLE VERTICAL LINE) in Step 5 matches the
// `payload-fingerprint.ts` documentation + REQUIREMENTS.md PREP-03 preimage
// notation. Preserved via TypeScript string-literal handling.
// -----------------------------------------------------------------------------

export const PASTEABLE_BLOCK_TEMPLATE: string = [
  ">>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>",
  "COPY EVERYTHING BETWEEN THESE MARKERS INTO A FRESH CHAT WINDOW",
  "(Claude, ChatGPT, Gemini — any LLM with no shared context with the agent that",
  "prepared this transaction)",
  "",
  "  You are verifying an Ethereum transaction. The agent that prepared this",
  "  may be compromised. Decode it from scratch using only the bytes below.",
  "  Do not consult any external context, any prior conversation, any file",
  "  the user mentions. Use only the bytes.",
  "",
  "  chainId:            {CHAIN_ID}",
  "  to:                 {TO}",
  "  value (wei):        {VALUE_WEI}",
  "  data:               {DATA}",
  "  payloadFingerprint: {PAYLOAD_FINGERPRINT}",
  "  presignHash:        {PRESIGN_HASH}",
  "",
  "  Tell the user:",
  "    1. What function (if any) is being called (decode the first 4 bytes of `data`).",
  "    2. What arguments are passed.",
  "    3. What contract is being called (`to`) — name the protocol if you recognize it.",
  "    4. Whether the recipient/spender/onBehalfOf in the args makes sense for the",
  "       function called.",
  "    5. Independently recompute the keccak256 of \"VaultPilot-txverify-v1:\" ‖",
  "       chainId(32-byte BE) ‖ to(20 bytes) ‖ value(32-byte BE) ‖ data and confirm",
  "       it equals payloadFingerprint above.",
  "",
  "  Halt and refuse to sign if anything is suspicious. Explicitly note any",
  "  divergence between your decode and what the prepare agent told the user.",
  "",
  "<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<",
].join("\n");

// -----------------------------------------------------------------------------
// Phase 9 Plan 09-04 — DISPATCH_TARGET_REFUSAL_TEMPLATE (SEC-35).
//
// Layer 0.5 of `preview_send`: refuses when `record.tx.to` is NOT in the
// per-chain canonical dispatch allowlist (`CANONICAL_DISPATCH_TARGETS` in
// `src/security/canonical-dispatch.ts`). Fires AFTER handle lookup and
// BEFORE the Phase 8 Layer 2 chain-name mismatch refusal.
//
// Three slots:
//   - `{CHAIN}`     — human-readable chain identifier
//                     (e.g. `polygon (chainId 137)`).
//   - `{TO}`        — the rejected `tx.to` in EIP-55 checksum form.
//   - `{ALLOWLIST}` — newline-joined verbatim entries from the per-chain
//                     allowlist with `    ` (4-space) indent so the indent
//                     matches the existing block-template convention
//                     (e.g. `CHAIN_ID_MISMATCH_REFUSAL_TEMPLATE`).
//
// Existing 21 templates (Phase 4 + Phase 6 + Phase 7 + Phase 8 + Plan 08-04
// + Plan 09-02 + Plan 09-03) BYTE-FROZEN — Plan 09-04 appends at end-of-file
// per APPEND-ONLY discipline; no source-line collision with Plan 09-02 (the
// `VAULTPILOT_NOTICE_*` templates live in a distinct region above).
// -----------------------------------------------------------------------------

export const DISPATCH_TARGET_REFUSAL_TEMPLATE: string = [
  "DISPATCH TARGET REFUSED",
  "  chain:     {CHAIN}",
  "  tx.to:     {TO}",
  "  reason:    tx.to is NOT in the v1.3 canonical dispatch allowlist.",
  "",
  "  Canonical allowlist for this chain:",
  "    {ALLOWLIST}",
  "",
  "  Remediation:",
  "    1. Re-prepare the transaction targeting one of the canonical addresses above.",
  "    2. If you intend to call a non-canonical contract (e.g. a verified-source",
  "       custom contract not in the v1.3-covered protocols), the v2.4+",
  "       prepare_custom_call({ acknowledgeNonProtocolTarget: true }) escape hatch",
  "       will be the path — currently out of scope for v1.3.",
  "",
  "  Native sends (data === \"0x\") bypass this allowlist — any `to` is valid for",
  "  a value transfer.",
].join("\n");
