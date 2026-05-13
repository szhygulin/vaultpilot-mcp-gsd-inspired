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
import type { Erc20Decoded } from "../protocols/erc20.js";
import { WETH9_DECIMALS } from "../protocols/weth9.js";
import type { SimulationResult } from "./simulation.js";

// Verbatim PREPARE RECEIPT (PREP-02 — verbatim args, NO normalization).
// PrepareArgs field types are `string` (not Address / not bigint) so the
// type system blocks normalization at the storage boundary.
export const PREPARE_RECEIPT_TEMPLATE: string = [
  "PREPARE RECEIPT",
  "  to:       {TO}",
  "  valueWei: {VALUE_WEI}",
].join("\n");

// LEDGER BLIND-SIGN HASH (PREP-04 + A1 mitigation — both forms).
// Per research A1, a device may chunk or truncate the display. We emit BOTH
// the unbroken 0x-prefixed hex AND the 16-group chunked form so the user
// can match either way regardless of how the device renders.
export const LEDGER_BLIND_SIGN_HASH_TEMPLATE: string = [
  "LEDGER BLIND-SIGN HASH",
  "  Expected on-device hash (full):    {HASH_FULL}",
  "  Expected on-device hash (chunked): {HASH_CHUNKED}",
  "",
  "Match this hash CHARACTER-FOR-CHARACTER against the value your Ledger device",
  "displays in blind-sign mode. The chunked form (4-char groups) helps when the",
  "device wraps or truncates the display. Any mismatch is a tamper signal — do",
  "not approve on the device if the hashes differ.",
].join("\n");

// AGENT TASK (PREP-05 — verbatim prose from research § Pattern 2 lines 364–384).
// The agent runs the four checks LOCALLY using viem (does not delegate to
// the server) and emits a `CHECKS PERFORMED` block before the confirm prompt.
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
  "Report results to the user in a `CHECKS PERFORMED` block before the confirm",
  "prompt. Format:",
  "",
  "  CHECKS PERFORMED",
  "    decoded.to:           <value or `error: …`>",
  "    decoded.value:        <value or `error: …`>",
  "    recomputed presign:   <value or `error: …`>",
  "    matches LEDGER block: <yes / no / error>",
  "",
  "If any check fails, halt and report the failure to the user — do not send.",
].join("\n");

// VERIFY BEFORE SIGNING — used by 04-03 + 04-05 as a user-facing summary of
// every cross-check artifact the user should read before approving on the
// device. No placeholders — constant prose.
export const VERIFY_BEFORE_SIGNING_TEMPLATE: string = [
  "VERIFY BEFORE SIGNING",
  "  1. Read the PREPARE RECEIPT — these are the args the agent passed, verbatim.",
  "  2. Read the LEDGER BLIND-SIGN HASH — match against your device screen.",
  "  3. Read the CHECKS PERFORMED block the agent emits in its response.",
  '  4. If anything disagrees, call send_transaction with userDecision: "cancel".',
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
  "  Match the LEDGER BLIND-SIGN HASH below CHARACTER-FOR-CHARACTER against",
  "  the value your device displays — this is the cryptographic anchor.",
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
    "          the LEDGER BLIND-SIGN HASH match above, not this simulation.",
  );
  return lines.join("\n");
}
