// Per-protocol decoder for the Safe Smart Account `enableModule(address)`
// calldata pattern — Phase 38 Plan 38-01 (SAFE-09).
//
// Inv #12.5 hard-trigger second-LLM check trigger: the SafeTx's INNER `data`
// field is inspected at four MCP-side emission sites; a selector match (data
// starts with `0x610b5925`) gated on `to === safeAddress` produces a
// `[HARD-TRIGGER — MODULE ENABLE]` block in the response text, instructing the
// agent to invoke `get_verification_artifact` + surface to the user before
// requesting `userDecision: "send"`.
//
// SDK reality (verified against viem@2.48.11):
//   - `viem.toFunctionSelector("enableModule(address)") === "0x610b5925"`
//     (computed in-session — drift here breaks Inv #12.5 trigger coupling).
//   - `enableModule(address)` signature is byte-identical across Safe v1.3.0
//     and v1.4.1 (single `address` parameter; no overloads). No version
//     branching required at the decode site.
//   - `disableModule(address,address)` (selector `0xe009cfde`) is the
//     contraction operation — explicitly DEFERRED to v2.5.x.
//
// Consumed by:
//   - src/tools/prepare_safe_tx_propose.ts (propose-side detection at prepare)
//   - src/tools/prepare_safe_tx_approve.ts (approve-side detection on Tx Service
//     data; defense-in-depth against compromised Tx Service feeds)
//   - src/tools/prepare_safe_tx_execute.ts (execute-side detection on inner
//     decoded SafeTx via decodeSingleSafeExecTransaction)
//   - src/tools/preview_send.ts            (re-emission at preview for the
//     cross-signer execute path — closes the cross-MCP-session gap)
//
// Format-fanout-sentinel: `ENABLE_MODULE_SELECTOR` lives in THIS file exactly
// once. The skill-side `vaultpilot-preflight` v1.4 Step 0.5 scan keys on the
// LITERAL block titles emitted by src/signing/blocks.ts (NOT on the selector
// directly) — drift in either the selector OR the block titles breaks Inv
// #12.5 enforcement coupling.

import {
  decodeFunctionData,
  parseAbi,
  type Address,
  type Hex,
} from "viem";

/**
 * 4-byte function selector for the Safe Smart Account `enableModule(address)`
 * write method. Universal (canonical Solidity function-signature hash) — drift
 * here breaks every `[HARD-TRIGGER — MODULE ENABLE]` emission across the four
 * MCP-side sites. Cross-checked in test/protocols-safe.test.ts via Fixture
 * SAFE-G byte-identity.
 */
export const ENABLE_MODULE_SELECTOR = "0x610b5925" as const;

/**
 * Safe `enableModule(address module)` ABI fragment. Module-private — the
 * decoder is the public surface; consumers never need the ABI directly.
 *
 * Pattern mirror of `src/signing/safe-exec-decode.ts:execTransactionAbi`
 * (single-method `parseAbi` array; viem's `decodeFunctionData` dispatches on
 * `functionName`).
 */
const enableModuleAbi = parseAbi(["function enableModule(address module)"]);

/**
 * Length-guarded + lowercase-normalized predicate. Returns `true` iff `data`
 * is a 0x-prefixed Hex with at least 10 characters AND whose 4-byte selector
 * (lowercased) equals `ENABLE_MODULE_SELECTOR`.
 *
 * Lowercase normalization is load-bearing — the Safe Tx Service can return
 * SafeTx calldata in mixed case; selector comparison MUST be case-insensitive
 * at this layer (viem.Hex is structurally a string and does not normalize
 * case on its own). Mirror of the discipline at
 * `src/protocols/erc20.ts:142` (`data.slice(0, 10).toLowerCase()`).
 *
 * Does NOT decode — call `decodeEnableModuleCalldata` to extract the module
 * address (and to surface a malformed-calldata error if decode throws).
 */
export function isEnableModuleCalldata(data: Hex): boolean {
  if (typeof data !== "string" || data.length < 10) return false;
  return data.slice(0, 10).toLowerCase() === ENABLE_MODULE_SELECTOR;
}

/**
 * Decode an `enableModule(address)` calldata blob and return the embedded
 * module address. Throws on:
 *   - viem-internal decode failure (truncated calldata / malformed arg)
 *   - functionName mismatch (selector pre-check skipped; defensive guard)
 *
 * Caller discipline (CONTEXT lock §"enableModule calldata parsing"):
 * `isEnableModuleCalldata(data)` MUST be checked first. A throw at this site
 * surfaces as a structured `INVALID_INPUT` refusal upstream (the bytes are
 * malformed, not the operation).
 *
 * Pattern mirror: `src/signing/safe-exec-decode.ts:decodeSingleSafeExecTransaction`
 * (parseAbi + decodeFunctionData + functionName defensive throw + readonly
 * tuple destructure for typed args).
 */
export function decodeEnableModuleCalldata(data: Hex): { module: Address } {
  const decoded = decodeFunctionData({ abi: enableModuleAbi, data });
  if (decoded.functionName !== "enableModule") {
    throw new Error(
      `decodeEnableModuleCalldata: expected functionName 'enableModule', got '${decoded.functionName}'`,
    );
  }
  const args = decoded.args as readonly [Address];
  return { module: args[0] };
}
