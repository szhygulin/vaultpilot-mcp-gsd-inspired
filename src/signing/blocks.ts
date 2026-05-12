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
//
// Plan 04-05 will add `build4byteBlock(...)` to this file alongside
// `chunkHex` — do NOT anticipate it here.

import type { Hex } from "viem";

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
