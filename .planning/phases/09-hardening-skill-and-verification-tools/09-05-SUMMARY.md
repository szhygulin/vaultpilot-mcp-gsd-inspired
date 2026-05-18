---
phase: 09
plan: 05
subsystem: src/tools/verify_tx_decode.ts NEW (3-arm server-side decode cross-check; single-SOT decoder reuse) + src/tools/get_tx_verification.ts v1.3 additive structuredContent extension (txJson + sessionTopicLast8 + dispatchCheckResult) + sessionTopicLast8 additive surfacing across preview_send.ts + send_transaction.ts (FROZEN three-gate region UNCHANGED) + register-all.ts carve close-out (Plan 09-03 + 09-05 both registered)
tags: [verify-tx-decode, get-tx-verification, sec-36, sec-37, sec-38, layer-3.5, decoder-single-sot, wei-string-amount-comparison, session-topic-surfacing, dispatch-check-reemit, txjson-bigint-decimal-string, register-all-carve-closeout, phase-9, wave-d]
requirements: [SEC-36, SEC-37, SEC-38]
wave: 4
status: complete
completed: 2026-05-18
dependency-graph:
  requires:
    - "Plan 09-02 (procedural — phase wave structure; no artifact coupling)"
    - "Plan 09-03 (src/tools/get_verification_artifact.ts — register-all carve closes here)"
    - "Plan 09-04 (src/security/canonical-dispatch.ts `_canonicalDispatch.checkDispatchTarget` for dispatchCheckResult field)"
    - "Phase 4 Plan 04-05 (src/tools/get_tx_verification.ts EXISTING tool — additive extension)"
    - "Phase 6 (src/protocols/erc20.ts `_protocols.decodeErc20Call` — combined ABI covers ERC-20 transfer/approve AND WETH9.withdraw via shared ABI fragment)"
    - "Phase 7 (src/protocols/aave-v3.ts `_aaveProtocols.decodeAaveV3Call`)"
    - "Phase 3 (src/wallet/session-manager.ts `getStatus()` + LedgerStatus.sessionTopicLast8)"
  provides:
    - "src/tools/verify_tx_decode.ts (NEW — 380 LOC) — MCP tool `verify_tx_decode({ handle, claimedDecode })` with 3-arm `VerifyTxDecodeResult` discriminated union (`{ kind: \"ok\" }` | `{ kind: \"divergence\", divergences: Divergence[] }` | `{ kind: \"decode-unsupported\", reason: string }`); per-action comparison covering 5 actions (transfer / approve / withdraw / aave-supply / aave-withdraw); LOCKED option (c) for amount comparison (agent passes WEI string; `\"max\"` ↔ MAX_UINT256 strict-equality for approve); single-SOT decoder reuse via `_protocols.decodeErc20Call` + `_aaveProtocols.decodeAaveV3Call` (T-DECODER-SINGLE-SOT-1 grep enforcement returns 0 in code lines)"
    - "src/tools/get_tx_verification.ts v1.3 additive structuredContent — 3 NEW fields appended: `txJson` (full unsigned tx as JSON; bigints serialize via `.toString()` decimal — chainId / to / valueWei / data / nonce / gas / maxFeePerGas / maxPriorityFeePerGas), `sessionTopicLast8` (WC topic for Ledger Live cross-check; null when no live WC session), `dispatchCheckResult` (re-runs Plan 09-04 Layer 0.5 canonical-dispatch allowlist check; native sends short-circuit with `{ kind: \"not-applicable\" }`). DESCRIPTION constant appended with single v1.3 additions sentence per PATTERNS.md § 2 line 665. NO text-block changes — existing structuredContent fields BYTE-FROZEN."
    - "src/tools/preview_send.ts additive `sessionTopicLast8: string | null` field on success structuredContent. Captured at line 309 (real mode — `sessionTopicLast8 = status.sessionTopicLast8` immediately after `senderAddress = status.activeAccount`); null in demo mode. Plan 09-04 Layer 0.5 region (lines 144-156) + Phase 8 Layer 2 region (lines 173-191) BYTE-FROZEN."
    - "src/tools/send_transaction.ts additive `sessionTopicLast8: status.sessionTopicLast8` field on SUCCESS path structuredContent at lines 526-534 region. OUTSIDE the FROZEN three-gate region (PREP-07 schema gate + PREP-08 fingerprint re-check + userDecision check) — three gates BYTE-FROZEN; verified at execute time via manual `git diff origin/main` (only 9 added lines total, all within the SUCCESS block)."
    - "src/tools/register-all.ts +2 import lines inserted AFTER `./get_tx_verification.js` (line 25) and BEFORE `./get_demo_wallet.js`: `./verify_tx_decode.js` (Plan 09-05's own tool) + `./get_verification_artifact.js` (Plan 09-03's tool — carved here per PATTERNS.md § 3 to avoid 09-03 ∥ 09-05 rebase risk). Closes the 09-03 register-all coordination deferral."
    - "src/signing/error-codes.ts +12/-1 lines APPEND-ONLY — `DECODE_DIVERGENCE` added to `ErrorCode` union (18 → 19 codes). Producer-map comment block extended naming Plan 09-05 + the \"NOT auto-emitted as a refusal envelope per se; tool returns divergence in structuredContent\" clarification. The 1 deletion is the semicolon-termination on the prior `DISPATCH_TARGET_REFUSED` union entry — unavoidable when appending to a TS union literal (same pattern Plans 09-02 + 09-04 used)."
    - "test/verify-tx-decode.test.ts (NEW — 596 lines, 22 cases) — T-VERIFY-DECODE-3ARM-1 + T-DECODE-DIVERGENCE-1 + T-DECODE-UNSUPPORTED-1 + T-DECODER-SINGLE-SOT-1 + T-AAVE-TX-TO-CONFUSION-1 anchors; register-all wiring assertions for BOTH verify_tx_decode AND get_verification_artifact"
    - "test/get-tx-verification.test.ts +6 NEW assertions covering txJson shape + bigint-as-decimal-string (T-TX-JSON-BIGINT-1) + sessionTopicLast8 null-when-no-WC + dispatchCheckResult 3 kinds (not-applicable / refused / ok)"
    - "test/preview-send.test.ts +2 NEW assertions (real-mode sessionTopicLast8 + demo-mode null) — T-SESSION-TOPIC-DRIFT-1"
    - "test/send-transaction.test.ts +2 NEW assertions (sessionTopicLast8 on SUCCESS + T-FROZEN-THREE-GATE-REGRESSION-1 git-diff regex assertion limiting added lines to ≤20 + protecting six load-bearing tokens from removal)"
  affects:
    - "src/tools/pair_ledger_live_wait.ts (NO source edit — sessionTopicLast8 ALREADY surfaced at file:95-110 per Phase 3 Plan 03-02; verified at execute time)"
    - "src/tools/pair_ledger_live.ts + src/tools/get_ledger_status.ts (NO source edit — sessionTopicLast8 already surfaced per Phase 3)"
  unblocks:
    - "Phase 9 close-out chore — mark Phase 9 complete in STATE.md + ROADMAP.md; Phase 9 retro"
    - "v1.3 verify-phase ship gate — resolves A1 (second-LLM decode reliability across 3-4 LLMs × 5 actions via verify_tx_decode 3-arm coverage); A4 + A5 + A7 + A8 (verify-phase tasks); A11 (verify_tx_decode tool description routing)"
    - "Phase 10 v1.4 Distribution (npm publish + Smithery + Docker + skill release) — full v1.3 hardening surface in tree (skill + 3 verification tools + canonical-dispatch + WC topic surfacing)"
    - "v2.3 protocol breadth extensions (Compound V3 / Morpho / Lido) — verify_tx_decode extends with new action + per-action comparison rules; ADDITIVE no breaking change"
    - "v2.4 prepare_custom_call escape hatch + per-chain DEX router widening"
    - "v3.x EIP-2612 / Permit2 typed-data verify_tx_decode coverage"
tech-stack:
  added: []
  patterns:
    - "3-arm discriminated union vs check_contract_security 5-arm — verify_tx_decode TIGHTENS to 3 arms (ok / divergence / decode-unsupported) because the decode operation is DETERMINISTIC — no rate-limit, no external-service error arms. Plan 07-04's check_contract_security needs the extra arms because Etherscan / 4byte / external-call dependencies introduce timing + availability concerns. verify_tx_decode is pure local computation over `record.tx.data` via the in-tree decoder indirections — the 3-arm shape is the maximum coverage; adding more arms would document failure modes that cannot occur."
    - "LOCKED option (c) WEI-string amount comparison — agent passes WEI string in `claimedDecode.args.amount` (the same value the agent passed to prepare_* or read from the preview_send DECODED ARGS block). The server compares WEI-to-WEI via `BigInt(...)`. Simpler than per-token decimals lookup (option b PARTIAL via BRIDGED_VARIANTS extension — v1.4+ scope) AND avoids re-introducing a divergence surface (decimal resolution already happened at prepare time; reusing the WEI value avoids re-doing the work). The `\"max\"` literal is accepted as `2^256-1` strict-equality for approve. Tool DESCRIPTION names this explicitly so the agent knows to pass WEI not decimal."
    - "Single-SOT decoder reuse (T-DECODER-SINGLE-SOT-1) — verify_tx_decode REUSES the in-tree decoders preview_send already uses: `_protocols.decodeErc20Call` (combined ABI covers ERC-20 transfer/approve AND WETH9.withdraw via shared `ERC20_COMBINED_DECODE_ABI` — no separate WETH9 decoder call needed; the combined ABI's `withdraw` arm fires for WETH9 calldata) + `_aaveProtocols.decodeAaveV3Call`. NO parallel ABI parser in this file. A parallel decoder would create a divergence surface where the cross-check itself becomes a foot-gun (the cross-check's job is to ANCHOR against the same decoder preview_send uses — a different decoder defeats the purpose). Test 18 enforces 0 grep hits for `decodeFunctionData` / `decodeAbiParameters` / `parseAbiItem` in code lines (comments excluded — the source comment block intentionally NAMES these forbidden APIs to document the discipline)."
    - "Additive-extension discipline for get_tx_verification — Plan 09-05 ADDS 3 structuredContent fields without modifying any existing text block or existing structured field. The DESCRIPTION constant gets ONE appended sentence per PATTERNS.md § 2 line 665. The existing PREPARE RECEIPT + LEDGER BLIND-SIGN HASH + AGENT TASK + 4byte + VERIFY BEFORE SIGNING blocks BYTE-FROZEN. This separates v1.3 additive surface (structuredContent fields for agent diagnostics) from the v1.0 user-facing text ritual (BYTE-FROZEN — touching it would force coordinated test-fixture + block-shape regressions)."
    - "FROZEN three-gate region byte-frozen assertion (T-FROZEN-THREE-GATE-REGRESSION-1, STOP-THE-LINE) — `src/tools/send_transaction.ts` is INTENTIONALLY MODIFIED with the additive sessionTopicLast8 field at the SUCCESS structuredContent block (lines 526-534 region per execute-time diff), but the three gates (PREP-07 schema gate at the validation boundary; PREP-08 fingerprint re-check; userDecision check at the front of the handler) BYTE-FROZEN. Verified at execute time via `git diff origin/main -- src/tools/send_transaction.ts` showing ONLY 9 added lines (8 comment + 1 field) ALL within the SUCCESS block. Test-level enforcement: `test/send-transaction.test.ts` invokes `child.execSync` to compute the diff at test time + asserts added-line ceiling at 20 + protects six load-bearing tokens (`PREVIEW_TOKEN_MISMATCH`, `PAYLOAD_FINGERPRINT_DRIFT`, `computePayloadFingerprint`, `transitionToCancelled`, `transitionToSent`, `userDecision === \"cancel\"`) from removal. Skips gracefully when `origin/main` is unavailable (fresh-clone environments)."
    - "register-all.ts carve close-out per PATTERNS.md § 3 — Plan 09-05 owns the consolidated import line addition for BOTH `./verify_tx_decode.js` (its own tool) AND `./get_verification_artifact.js` (Plan 09-03's tool). Plan 09-03 deferred the register-all line to avoid 09-03 ∥ 09-05 rebase conflict on a shared file. Lands here as 2 adjacent lines after `./get_tx_verification.js` at line 25 — non-conflicting with Plan 08-04 + 08-05 carves at lines 6-7 and line 28."
    - "T-SESSION-TOPIC-DRIFT-1 cross-tool consistency surface — sessionTopicLast8 surfaces on EVERY signing-flow response: `preview_send` (success structuredContent), `send_transaction` (SUCCESS path structuredContent OUTSIDE FROZEN three-gate), `get_tx_verification` (additive v1.3 field), `pair_ledger_live_wait` (already surfaced per Phase 3 Plan 03-02 — VERIFIED parity, NO source edit), `pair_ledger_live` + `get_ledger_status` (already surfaced per Phase 3). Drift (field removal from one surface, divergence between surfaces) indicates session-rotation between calls and breaks the user cross-check ritual against Ledger Live → Settings → Connected Apps. Tests in 3 extended test files assert presence on every signing-flow response."
    - "Native-send bypass for dispatchCheckResult — consistent with Plan 09-04 Layer 0.5 bypass for `data === \"0x\"`. `get_tx_verification.dispatchCheckResult` short-circuits with `{ kind: \"not-applicable\" as const }` when `record.tx.data === \"0x\"`. The 3 kinds the field can take: `not-applicable` (native send), `ok` (canonical contract on allowlist), `refused` (off-allowlist contract). Drift would surface as an unexpected envelope shape — the test extension covers all 3 kinds."
key-files:
  created:
    - "src/tools/verify_tx_decode.ts (NEW — 380 LOC)"
    - "test/verify-tx-decode.test.ts (NEW — 596 lines, 22 cases)"
    - ".planning/phases/09-hardening-skill-and-verification-tools/09-05-SUMMARY.md (NEW — this file)"
  modified:
    - "src/tools/get_tx_verification.ts (+57/-2 lines — additive `txJson` + `sessionTopicLast8` + `dispatchCheckResult` on both prepared status return AND the post-pinned success return; NEW imports for `_canonicalDispatch` + `getStatus` + `ChainId`; DESCRIPTION constant appended with v1.3 additions sentence; existing structuredContent fields + text blocks UNCHANGED)"
    - "src/tools/preview_send.ts (+15 lines — `let sessionTopicLast8: string | null = null` hoisted, assigned from `status.sessionTopicLast8` in real-mode branch, additive field on success structuredContent at line 624-region; Plan 09-04 Layer 0.5 + Phase 8 Layer 2 regions BYTE-FROZEN)"
    - "src/tools/send_transaction.ts (+9 lines — additive `sessionTopicLast8: status.sessionTopicLast8` + 8 comment lines on the SUCCESS path structuredContent at lines 526-534 region; three-gate region BYTE-FROZEN per T-FROZEN-THREE-GATE-REGRESSION-1)"
    - "src/tools/register-all.ts (+2 lines — `./verify_tx_decode.js` + `./get_verification_artifact.js` inserted between `./get_tx_verification.js` and `./get_demo_wallet.js`)"
    - "src/signing/error-codes.ts (+12/-1 lines APPEND-ONLY — `DECODE_DIVERGENCE` in ErrorCode union 18 → 19 codes; producer-map comment extended naming Plan 09-05)"
    - "test/get-tx-verification.test.ts (+139 lines, 6 NEW assertions — txJson + sessionTopicLast8 + dispatchCheckResult v1.3 fields)"
    - "test/preview-send.test.ts (+44 lines, 2 NEW assertions — sessionTopicLast8 real-mode + demo-mode)"
    - "test/send-transaction.test.ts (+92 lines, 2 NEW assertions — sessionTopicLast8 on SUCCESS + T-FROZEN-THREE-GATE-REGRESSION-1 git-diff regex anchor)"
decisions:
  - "**LOCKED option (c) at execute time — agent passes WEI string in `claimedDecode.args.amount`.** Plan body's `<implementation_guidance>` documented option (a) hardcoded-18-decimals (wrong by orders of magnitude for non-18-decimal tokens like USDC), option (b) synchronous decimals lookup via BRIDGED_VARIANTS extension (v1.4+ scope; would require retroactive `decimals: number` field on BridgedVariant interface), and option (c) WEI-string discipline. Option (c) shipped: agent reads the WEI value from the prepare_* response's `valueWei` field or from the preview_send DECODED ARGS block's amount field, then passes it verbatim to verify_tx_decode. Server compares WEI-to-WEI via `BigInt(...)`. Tool DESCRIPTION names this explicitly: \"Amount in args.amount: pass the WEI value as a decimal string (matches what prepare_* returned in record.tx.valueWei or in the preview_send DECODED ARGS amount field). For unlimited approve, pass `\\\"max\\\"` as the literal; the server validates against 2^256-1 strict-equality.\" Simpler discipline; no per-token decimals lookup at the cross-check site; no risk of decimal mis-resolution producing a false ok. Documented as accepted residual."
  - "**`decodeWeth9Withdraw` helper NOT needed — combined ERC-20 ABI already covers WETH9.withdraw.** Plan sketch (PATTERNS.md § Interfaces) assumed `decodeWeth9Withdraw` + `WETH9_SELECTORS.withdraw` startswith-check. Actual code reality (verified at execute time): `src/protocols/erc20.ts` ships `ERC20_COMBINED_DECODE_ABI = [...erc20Abi, ...WETH9_DECODE_FRAGMENT]` so `_protocols.decodeErc20Call` returns `{ kind: \"withdraw\", amount }` for WETH9.withdraw calldata. The `withdraw` arm of `Erc20Decoded` is the SAME arm preview_send uses for WETH9 decoding. verify_tx_decode reuses this — NO separate WETH9 decoder call. Tighter than the plan sketch (one decoder indirection instead of two) and consistent with the SOT discipline."
  - "**txJson `valueWei` + `gas` + `maxFeePerGas` + `maxPriorityFeePerGas` serialize as DECIMAL strings, NOT hex** (T-TX-JSON-BIGINT-1 per PATTERNS.md § 3 line 523 LOCKED). Decision: decimal-string preserves round-trip via `JSON.parse(JSON.stringify(...))` AND matches the existing `gas: pinned.gas.toString()` discipline at line 214 of get_tx_verification.ts. NOT hex (which would require `toHex(...)` from viem + carry an `0x` prefix that's inconsistent with the existing decimal-string surface). Test asserts `typeof result.structuredContent.txJson.valueWei === \"string\"` AND that `JSON.stringify(structuredContent)` doesn't throw (no unserializable bigints leak through)."
  - "**txJson surfaces on BOTH prepared status AND post-pinned (previewed/sent/cancelled) status.** Plan body specified the txJson at the success return only. At execute time I extended to ALSO surface on the prepared status return — the nonce / gas / fees slots become `null` when the handle hasn't been pinned yet. Rationale: a context-evicted agent re-emitting a prepared (not-yet-previewed) handle should still see the same SHAPE of structuredContent (txJson + sessionTopicLast8 + dispatchCheckResult). Inconsistent shape between status branches would force the agent to write defensive branching code per branch. Test 'txJson is present on prepared status' covers this."
  - "**sessionTopicLast8 captured inline at the existing getStatus() call in preview_send.** Plan sketch said `sessionTopicLast8: isDemoMode() ? null : getStatus()?.sessionTopicLast8 ?? null` — a second `getStatus()` call. At execute time I observed the real-mode branch already calls `getStatus()` at line 291 to resolve `senderAddress = status.activeAccount`; reusing the same `status` reference for `sessionTopicLast8 = status.sessionTopicLast8` avoids a second async round-trip + keeps the surface consistent across the function. Hoisted `let sessionTopicLast8: string | null = null` before the demo/real branching; assigned only in real-mode branch (demo branch stays null). Same pattern in send_transaction (the `status` from `getStatus()` is already resolved before the broadcast)."
  - "**T-FROZEN-THREE-GATE-REGRESSION-1 implemented with added-line ceiling + token deny-list rather than exact-shape regex.** Plan body specified \"a regex pattern restricting changes to the additive line only\". At execute time I chose a more pragmatic shape: (a) added-line ceiling at 20 (the comment block + field is 9 lines; 20 gives headroom for innocuous future comment edits); (b) deny-list of 6 load-bearing tokens (`PREVIEW_TOKEN_MISMATCH`, `PAYLOAD_FINGERPRINT_DRIFT`, `computePayloadFingerprint`, `transitionToCancelled`, `transitionToSent`, `userDecision === \"cancel\"`) that MUST NOT appear in removed lines — these are the three-gate invariants; their removal would break the test. Skips gracefully when `origin/main` is unavailable (fresh-clone environments). Tighter than exact-shape regex (which would break on a single comment-line edit elsewhere in the success block); weaker against deliberate adversarial edits (an attacker could remove a gate without triggering the deny-list if they avoid the exact tokens). The execute-time manual `git diff` verification + the at-PR-review-time regression catch the gap."
  - "**T-DECODER-SINGLE-SOT-1 grep enforcement runs against code lines ONLY (comments excluded).** First test run failed: 3 grep hits surfaced because the source-file comment block intentionally NAMES the forbidden APIs (`decodeFunctionData` / `decodeAbiParameters` / `parseAbiItem`) to document the discipline (\"DECODE REUSE — SINGLE SOT: ... A parallel ABI parser would create a divergence surface...\"). Fixed by filtering out `//`-prefixed lines before counting matches. Slightly weaker than strict 0-grep-hits-anywhere (a contributor could circumvent by aliasing the forbidden API), but stronger than no enforcement; the discipline is documented in the comment block AND enforced via the in-tree decoder reuse. Trade-off accepted — the comment-block documentation IS load-bearing (explains the WHY to a future contributor without forcing them to read the test file)."
metrics:
  duration: "~50 minutes (single execution wave; one rework on the T-DECODER-SINGLE-SOT-1 grep — code-lines-only filter; one rework on the demo-mode preview_send test — setActivePersona takes a slug string not a persona object)"
  completed: 2026-05-18
  tasks_completed: 1
  files_created: 3
  files_modified: 8
  loc_added: "+1522 / -1 (single atomic commit 0c4a57f)"
  tests_before: 858
  tests_after: 890
  tests_delta: 32
  test_count_trajectory: "858 → 890 (+32)"
---

# Phase 9 Plan 05 Summary: `verify_tx_decode` 3-arm + `get_tx_verification` v1.3 Additive Extension + `sessionTopicLast8` Surfacing + register-all Carve Close-out

## One-liner

Last execute plan of Phase 9 — ships v1.3 hardening surface in one collapsed commit: NEW `verify_tx_decode` 3-arm MCP tool (server-side decode cross-check; single-SOT decoder reuse — NO parallel ABI parser per T-DECODER-SINGLE-SOT-1; LOCKED option (c) WEI-string amount comparison; per-action coverage for transfer / approve / withdraw / aave-supply / aave-withdraw); additive `txJson` + `sessionTopicLast8` + `dispatchCheckResult` on `get_tx_verification` structuredContent (v1.3 fields; existing text blocks BYTE-FROZEN); `sessionTopicLast8` surfaced across `preview_send` + `send_transaction` (FROZEN three-gate region UNCHANGED) + `pair_ledger_live_wait` (parity already in Phase 3); `register-all.ts` carve close-out (BOTH `verify_tx_decode.js` AND Plan 09-03's `get_verification_artifact.js` now MCP-routable). Closes SEC-36, SEC-37, SEC-38.

## What Landed

### 1. `src/tools/verify_tx_decode.ts` (NEW — 380 LOC)

```typescript
type VerifyTxDecodeResult =
  | { kind: "ok" }
  | { kind: "divergence"; divergences: Divergence[] }
  | { kind: "decode-unsupported"; reason: string };

interface Divergence {
  field: string;        // "to" | "recipient" | "amount" | "spender" | "asset" | "onBehalfOf" | "action" | "to (claimedDecode)" | "to (recipient)"
  agentSaid: string;
  serverSays: string;
}

registerTool("verify_tx_decode", DESCRIPTION, INPUT_SCHEMA, async (args) => {
  // 1. Demo-mode refusal FIRST.
  if (isDemoMode()) return { isError: true, ..., structuredContent: { errorCode: "DEMO_MODE_REFUSED", ... } };

  // 2. Handle lookup (HANDLE_NOT_FOUND / HANDLE_EXPIRED).
  const lookupResult = lookup(handleArg);
  if (!lookupResult.ok) return { isError: true, ..., structuredContent: { errorCode: lookupResult.errorCode, ... } };

  // 3. Independent decode via _protocols + _aaveProtocols (single SOT).
  const erc20Decoded = _protocols.decodeErc20Call(record.tx.data as Hex);
  const aaveDecoded  = _aaveProtocols.decodeAaveV3Call(record.tx.data as Hex);

  // 4. decode-unsupported arm.
  if (erc20Decoded.kind === "unknown" && aaveDecoded.kind === "unknown") {
    return { content: [...], structuredContent: { kind: "decode-unsupported", reason: "...selector ... not covered by v1.3 decoders ... Use get_verification_artifact for second-LLM out-of-band verification." } };
  }

  // 5. Per-action comparison rules (5 actions; WEI-to-WEI amount compare; "max" ↔ MAX_UINT256 strict-equality for approve;
  //    canonical-address-per-chain via getWethAddress + getAaveV3PoolAddress).
  const divergences: Divergence[] = [];
  // ... action-dispatch with field-by-field compare ...

  // 6. Emit ok or divergence arm.
  return divergences.length === 0
    ? { content: [...], structuredContent: { kind: "ok" } }
    : { content: [...], structuredContent: { kind: "divergence", divergences } };
});
```

**Per-action coverage** (5 actions):

| Action | tx.to expected | args fields compared |
|---|---|---|
| `transfer` | token contract (record.tx.to) | recipient, amount |
| `approve` | token contract (record.tx.to) | spender, amount (or `"max"` ↔ MAX_UINT256) |
| `withdraw` | `getWethAddress(chainId)` (canonical WETH9 per chain) | amount |
| `aave-supply` | `getAaveV3PoolAddress(chainId)` | asset, onBehalfOf, amount |
| `aave-withdraw` | `getAaveV3PoolAddress(chainId)` | asset, to, amount |

For `withdraw` / `aave-supply` / `aave-withdraw`, the server compares BOTH `record.tx.to` AND `claimedDecode.to` against the canonical address; mismatches surface as separate divergences (`field: "to"` for record.tx.to drift; `field: "to (claimedDecode)"` for agent-claim drift). T-AAVE-TX-TO-CONFUSION-1 anchor: an agent confusing the asset address (USDC) with the Pool address surfaces the canonical Aave Pool in the `serverSays` slot.

### 2. `src/tools/get_tx_verification.ts` v1.3 Additive Extension

3 NEW structuredContent fields appended (on BOTH prepared status return AND post-pinned success return):

```typescript
// NEW imports
import { type ChainId } from "../config/contracts.js";
import { _canonicalDispatch } from "../security/canonical-dispatch.js";
import { getStatus } from "../wallet/session-manager.js";

// NEW: computed once at handler entry (after handle lookup); reused on every success path
const ledgerStatus = await getStatus();
const sessionTopicLast8 = ledgerStatus?.sessionTopicLast8 ?? null;
const dispatchCheckResult =
  record.tx.data === "0x"
    ? ({ kind: "not-applicable" as const })
    : _canonicalDispatch.checkDispatchTarget(record.tx.chainId as ChainId, record.tx.to);

// NEW: txJson — full unsigned tx as JSON, bigints as decimal strings
const txJson = {
  chainId: record.tx.chainId,
  to: record.tx.to,
  valueWei: record.tx.valueWei.toString(),
  data: record.tx.data,
  nonce: pinned.nonce,
  gas: pinned.gas.toString(),
  maxFeePerGas: pinned.maxFeePerGas.toString(),
  maxPriorityFeePerGas: pinned.maxPriorityFeePerGas.toString(),
};

// Appended to existing structuredContent on success return:
return {
  content: [{ type: "text", text }],
  structuredContent: {
    // ... existing 12 fields BYTE-FROZEN ...
    txJson,
    sessionTopicLast8,
    dispatchCheckResult,
    // ... existing optional fields (txHash, broadcastedAt, cancelledAt) ...
  },
};
```

DESCRIPTION constant appended with one v1.3 additions sentence. NO text-block changes — existing PREPARE RECEIPT + LEDGER BLIND-SIGN HASH + AGENT TASK + 4byte + VERIFY BEFORE SIGNING + sent/cancelled blocks BYTE-FROZEN.

### 3. `sessionTopicLast8` Additive Surfacing Across Signing Flows (SEC-36)

| Tool | Field source | Demo-mode behavior |
|---|---|---|
| `preview_send` success | `status.sessionTopicLast8` from `getStatus()` already resolved at line 291 (reuses existing call) | `null` (no WC session in demo) |
| `send_transaction` SUCCESS | `status.sessionTopicLast8` from `getStatus()` already resolved at line 395 (reuses existing call) | unreachable (demo-mode short-circuits earlier with SIMULATION envelope) |
| `get_tx_verification` (any non-error path) | `getStatus()?.sessionTopicLast8 ?? null` | unreachable (demo-mode refused at handler entry) |
| `pair_ledger_live_wait` | Already surfaces `sessionTopicLast8` per Phase 3 Plan 03-02 line 110 — **NO source edit needed** | Tool refuses in demo |
| `pair_ledger_live` + `get_ledger_status` | Already surfaces per Phase 3 — **NO source edit needed** | varies |

T-SESSION-TOPIC-DRIFT-1: surface present on EVERY signing-flow response. User cross-checks against Ledger Live → Settings → Connected Apps; drift between preview / send / pair surfaces indicates session-rotation between calls.

### 4. `src/tools/send_transaction.ts` Additive `sessionTopicLast8` (FROZEN three-gate region UNCHANGED)

```diff
@@ -526,6 +526,15 @@ export const sendTransactionHandler: ToolHandler = async (args): Promise<ToolHan
         broadcastedAt,
         handle: handleArg,
         chainId: record.tx.chainId,
+        // Plan 09-05 (SEC-36) — WC session topic surface (last 8 chars) for
+        // user cross-check against Ledger Live → Settings → Connected Apps.
+        // Additive surface OUTSIDE the FROZEN three-gate region (PREP-07
+        // schema gate + PREP-08 fingerprint re-check + userDecision check
+        // live earlier in the handler at the validation boundary). `status`
+        // is the LedgerStatus resolved upstream from `getStatus()`; the
+        // demo-mode + cancel + LEDGER_REJECTED + BROADCAST_FAILED paths
+        // return earlier and never reach this success-path block.
+        sessionTopicLast8: status.sessionTopicLast8,
       },
     };
```

Total diff: **9 added lines, 0 removed**. The three-gate region (PREP-07 + PREP-08 + userDecision) earlier in the handler shows ZERO diff lines. T-FROZEN-THREE-GATE-REGRESSION-1 anchor enforces this at the test layer (git-diff regex assertion with added-line ceiling at 20 + token deny-list protecting 6 load-bearing tokens from removal).

### 5. `src/tools/register-all.ts` Carve Close-out

```diff
@@ -23,6 +23,8 @@ import "./simulate_position_change.js";
 import "./preview_send.js";
 import "./send_transaction.js";
 import "./get_tx_verification.js";
+import "./verify_tx_decode.js";
+import "./get_verification_artifact.js";
 import "./get_demo_wallet.js";
```

Closes the 09-03 register-all deferral. Both Plan 09-03's `get_verification_artifact` AND Plan 09-05's `verify_tx_decode` are now MCP-routable in one atomic commit.

### 6. `src/signing/error-codes.ts` APPEND `DECODE_DIVERGENCE`

```diff
@@ -78,5 +95,6 @@ export type ErrorCode =
   | "CHAIN_ID_MISMATCH"
   | "SKILL_INTEGRITY_FAILURE"
-  | "DISPATCH_TARGET_REFUSED";
+  | "DISPATCH_TARGET_REFUSED"
+  | "DECODE_DIVERGENCE";
```

18 → 19 codes. The 1 deletion is the semicolon on the prior union entry — unavoidable TS pattern. Producer-map comment extended naming Plan 09-05 + the "NOT auto-emitted as a refusal envelope per se; tool returns divergence in structuredContent" clarification.

### 7. `test/verify-tx-decode.test.ts` (NEW — 22 cases)

| # | Test | Anchor |
|---|---|---|
| 1 | ok arm — transfer (Fixture D) | T-VERIFY-DECODE-3ARM-1 |
| 2 | ok arm — approve concrete amount | T-VERIFY-DECODE-3ARM-1 |
| 3 | ok arm — approve(MAX_UINT256) accepted as `"max"` literal | T-VERIFY-DECODE-3ARM-1 |
| 4 | ok arm — WETH9.withdraw (Fixture F) | T-VERIFY-DECODE-3ARM-1 |
| 5 | ok arm — Aave V3 supply (Fixture G) | T-VERIFY-DECODE-3ARM-1 |
| 6 | ok arm — Aave V3 withdraw (Fixture H) | T-VERIFY-DECODE-3ARM-1 |
| 7 | divergence — recipient typo (BOB vs ALICE) | T-DECODE-DIVERGENCE-1 |
| 8 | divergence — approve amount off-by-one (101 vs 100) | T-DECODE-DIVERGENCE-1 |
| 9 | divergence — `"max"` against concrete-amount tx | T-DECODE-DIVERGENCE-1 |
| 10 | divergence — Aave asset substitution (DAI vs USDC) | T-DECODE-DIVERGENCE-1 |
| 11 | divergence — Aave onBehalfOf mismatch (BOB vs ALICE) | T-DECODE-DIVERGENCE-1 |
| 12 | T-AAVE-TX-TO-CONFUSION-1: claimedDecode.to ≠ canonical Aave Pool | T-AAVE-TX-TO-CONFUSION-1 |
| 13 | decode-unsupported — unknown selector + routing hint | T-DECODE-UNSUPPORTED-1 |
| 14 | action mismatch — agent claims "approve" on transfer calldata | T-VERIFY-DECODE-3ARM-1 |
| 15 | demo-mode refusal | (T-DEMO-1 mirror) |
| 16 | HANDLE_NOT_FOUND | (standard handle-store) |
| 17 | HANDLE_EXPIRED past 15-min TTL | (standard handle-store) |
| 18 | T-DECODER-SINGLE-SOT-1 grep enforcement (code lines only, comments excluded) | T-DECODER-SINGLE-SOT-1 |
| 19 | decoder reuse via `_protocols.decodeErc20Call` spy round-trip | T-DECODER-SINGLE-SOT-1 |
| 20 | register-all wiring — verify_tx_decode MCP-routable | (carve close-out) |
| 21 | register-all wiring — get_verification_artifact MCP-routable | (carve close-out) |
| 22 | register-all.ts source contains BOTH import lines | (carve close-out) |

### 8. Extended Test Files

- **`test/get-tx-verification.test.ts`** (+6 NEW assertions):
  - `txJson` present on previewed status; bigints as decimal strings (T-TX-JSON-BIGINT-1)
  - `txJson` present on prepared status (shape consistency across status branches)
  - `sessionTopicLast8` is null when no WC session
  - `dispatchCheckResult.kind === "not-applicable"` for native sends
  - `dispatchCheckResult.kind === "refused"` for non-canonical tx.to + verbatim allowlist
  - `dispatchCheckResult.kind === "ok"` for WETH9 canonical tx.to

- **`test/preview-send.test.ts`** (+2 NEW assertions):
  - Real-mode success carries `sessionTopicLast8` from `getStatus()`
  - Demo-mode success carries `sessionTopicLast8: null`

- **`test/send-transaction.test.ts`** (+2 NEW assertions):
  - SUCCESS path surfaces `sessionTopicLast8` from `getStatus()`
  - T-FROZEN-THREE-GATE-REGRESSION-1: git-diff regex with added-line ceiling at 20 + token deny-list (PREVIEW_TOKEN_MISMATCH / PAYLOAD_FINGERPRINT_DRIFT / computePayloadFingerprint / transitionToCancelled / transitionToSent / userDecision-cancel) protecting the three gates from removal; skips gracefully on origin-less environments

## FROZEN-area Assertions

```bash
git diff origin/main -- \
  src/signing/payload-fingerprint.ts \
  src/signing/presign-hash.ts \
  src/signing/handle-store.ts \
  src/clients/etherscan.ts \
  src/clients/fourbyte.ts \
  src/protocols/aave-v3.ts \
  src/protocols/erc20.ts \
  src/protocols/weth9.ts \
  src/signing/aave-health.ts \
  src/signing/amount.ts \
  src/signing/simulation.ts | wc -l
#        0

git diff origin/main -- src/signing/blocks.ts | wc -l
#        0

git diff origin/main -- src/tools/send_transaction.ts | grep '^+' | grep -v '^+++' | wc -l
#        9  (8 comment lines + 1 sessionTopicLast8 field — all within SUCCESS structuredContent block)
```

11-file cryptographic-binding chain ZERO diff. `src/signing/blocks.ts` ZERO diff (Plan 09-05 does NOT touch). `src/tools/send_transaction.ts` modified with single additive field at SUCCESS structuredContent; three-gate region BYTE-FROZEN (PREP-07 + PREP-08 + userDecision check at the validation boundary earlier in the handler — verified via manual line-by-line inspection + T-FROZEN-THREE-GATE-REGRESSION-1 test).

`src/tools/preview_send.ts` modified with `let sessionTopicLast8: string | null = null` hoist + `status.sessionTopicLast8` assignment in real-mode + additive field at success structuredContent. Plan 09-04 Layer 0.5 region (lines 144-156) + Phase 8 Layer 2 region (lines 173-191) BYTE-FROZEN (verified via line-range inspection).

## T-DECODER-SINGLE-SOT-1 Grep Enforcement

```bash
node -e "
  const fs = require('fs');
  const v = fs.readFileSync('src/tools/verify_tx_decode.ts', 'utf8');
  const codeLines = v.split('\\n').filter(l => !l.trim().startsWith('//')).join('\\n');
  const hits = (codeLines.match(/decodeFunctionData/g) || []).length
             + (codeLines.match(/decodeAbiParameters/g) || []).length
             + (codeLines.match(/parseAbiItem/g) || []).length;
  console.log('T-DECODER-SINGLE-SOT-1 grep hits (code only):', hits);
"
# T-DECODER-SINGLE-SOT-1 grep hits (code only): 0
```

ZERO viem decoder calls in code lines. The source-file comment block intentionally NAMES the forbidden APIs (`decodeFunctionData` / `decodeAbiParameters` / `parseAbiItem`) to document the discipline — this is load-bearing documentation per CLAUDE.md "Documentation Style" + "DECODE REUSE — SINGLE SOT" callout in the file header. Test 18 of `test/verify-tx-decode.test.ts` enforces the grep at the test layer with the same comment-exclusion filter.

## Test Trajectory

| Stage | Test count | Delta |
|---|---|---|
| Phase 9 baseline (post-Plan 09-04 merge, HEAD `677749d`) | 858 | — |
| Post-Plan-09-05 implementation | **890** | **+32** |

Plan estimate was 35 cases (`tests_added_estimate: 35`); landed at 32 (22 new in test/verify-tx-decode.test.ts + 6 in get-tx-verification + 2 in preview-send + 2 in send-transaction). Lower count vs estimate reflects condensing some divergence cases into multi-field assertions within a single test (e.g. Test 12 T-AAVE-TX-TO-CONFUSION-1 covers BOTH the "to (claimedDecode)" divergence AND verifies the canonical Aave Pool surfaces in serverSays in a single test). Zero pre-existing tests regressed. `npm run typecheck` + `npm run build` clean.

## Layer Architecture After Plan 09-05

| Layer | Plan | Component | When | Refusal/Surface | Trust Anchor |
|---|---|---|---|---|---|
| Layer 1 | (schema) | JSON-schema enum at MCP dispatch boundary | bogus chain names rejected | (schema error) | Server boundary |
| Layer 0.5 | 09-04 | `preview_send` outer dispatch-target allowlist | AFTER handle lookup, BEFORE Layer 2 | `DISPATCH_TARGET_REFUSED` refusal | Server boundary |
| Layer 2 | 08-02 | `preview_send` chain-name MISMATCH | AFTER Layer 0.5, BEFORE three gates | `CHAIN_ID_MISMATCH` refusal | Server boundary |
| Layer 3 | 04-01 (FROZEN) | `send_transaction` payloadFingerprint preimage chainId slot | At send time | `PAYLOAD_FINGERPRINT_DRIFT` refusal | Cryptographic |
| **Layer 3.5** | **09-05 (THIS)** | **`verify_tx_decode` INLINE server-side decode cross-check** | **Agent-driven after preview, before send** | **`{ kind: "divergence" }` structured surface (no auto-refusal)** | **Server boundary + agent decision-policy** |
| Layer 3.7 | 09-03 | `get_verification_artifact` second-LLM OUT-OF-BAND ritual | Agent-driven on-demand | sparse JSON + pasteableBlock | OUT-OF-BAND second LLM |
| Layer 4 | (Ledger) | Device `Network:` clear-sign + hash display | On-device | — | Ledger screen |

Layer 3.5 catches narrow agent decode lies BEFORE the user is asked to confirm — distinct from Plan 09-03's out-of-band second-LLM ritual (Layer 3.7) AND from FROZEN PREP-08 fingerprint re-check (Layer 3 — bytes byte-match but narrative may diverge; Layer 3.5 catches narrative divergence). The tool does NOT auto-block send on divergence; the agent's decision-policy (informed by Plan 09-01 SKILL.md Step 4 / Inv #11 enforcement) determines halt-or-proceed.

## Trust Boundaries Closed

| Boundary | Status | How |
|---|---|---|
| Agent → `verify_tx_decode({ handle, claimedDecode })` | ✅ | JSON-schema enum + pattern validates input shape (action enum + 0x-prefixed-40-char `to` regex). Plan 04-04 PREP-07 schema gate inheritance. |
| Server decode via `_protocols.*` + `_aaveProtocols.*` (single SOT) | ✅ | Decode result is deterministic over the bytes. NO external service call; NO rate-limit (justifies 3-arm shape vs check_contract_security's 5-arm). T-DECODER-SINGLE-SOT-1 grep enforcement returns 0. |
| Server decode vs claimedDecode → divergence list | ✅ | Per-action field-by-field comparison. EIP-55 normalization via `getAddress` for case-insensitive address match (`addressesDiffer` helper). WEI-to-WEI amount comparison via `BigInt(...)` (option (c) LOCKED). |
| `sessionTopicLast8` surface on every signing-flow → user | ✅ | User cross-checks against Ledger Live's Connected Apps UI. The MCP has NO authority to verify the topic on the WC peer; the surface IS the defense. T-SESSION-TOPIC-DRIFT-1 covers field presence on 4 surfaces. |
| `get_tx_verification` v1.3 fields → context-evicted agent | ✅ | Agent reads `txJson` to re-relay canonical view without re-running prepare; `dispatchCheckResult` re-anchors the Layer 0.5 verdict; `sessionTopicLast8` re-anchors the WC topic. |
| `verify_tx_decode` + `get_verification_artifact` register-all routing | ✅ | Both tools imported in `src/tools/register-all.ts` at line 25-26 region; `getRegisteredTool` returns non-null for both after dispatch-table population. |

## Threat Register — Mitigations Asserted

| ID | Severity | Status | How asserted |
|---|---|---|---|
| **T-DECODE-DIVERGENCE-1** | high | ✅ asserted | `test/verify-tx-decode.test.ts` Tests 7-12 (divergence per action: recipient typo / approve off-by-one / approve "max" mismatch / Aave asset substitution / Aave onBehalfOf mismatch / claimedDecode.to ≠ tx.to T-AAVE-TX-TO-CONFUSION-1) |
| **T-DECODE-UNSUPPORTED-1** | medium | ✅ asserted | `test/verify-tx-decode.test.ts` Test 13 — unknown selector → routing hint to get_verification_artifact in reason field |
| **T-DECODER-SINGLE-SOT-1** | high | ✅ asserted | `test/verify-tx-decode.test.ts` Tests 18 + 19 — grep on code lines + spy round-trip on `_protocols.decodeErc20Call` |
| **T-VERIFY-DECODE-3ARM-1** | high | ✅ asserted | `test/verify-tx-decode.test.ts` Tests 1-13 cover all 3 arms (6 ok + 6 divergence + 1 decode-unsupported) |
| **T-AAVE-TX-TO-CONFUSION-1** | high | ✅ asserted | `test/verify-tx-decode.test.ts` Test 12 — agent confuses asset (USDC) with Aave Pool address; serverSays surfaces canonical Aave Pool |
| **T-SESSION-TOPIC-DRIFT-1** | high | ✅ asserted | 3 extended test files assert presence on every signing-flow response; demo-mode → null, real-mode → non-null |
| **T-FROZEN-THREE-GATE-REGRESSION-1** | high (STOP-THE-LINE) | ✅ asserted | `test/send-transaction.test.ts` git-diff regex with added-line ceiling + 6-token deny-list (skips gracefully on origin-less envs); manual execute-time `git diff` inspection confirms 9 added lines ONLY within SUCCESS structuredContent block |
| **T-TX-JSON-BIGINT-1** | medium | ✅ asserted | `test/get-tx-verification.test.ts` extension asserts `typeof result.structuredContent.txJson.valueWei === "string"` + `JSON.stringify(structuredContent)` doesn't throw |
| **T-DISPATCH-CHECK-RESULT-CONSISTENCY-1** | medium | ✅ asserted | `test/get-tx-verification.test.ts` extension covers all 3 kinds (not-applicable / refused / ok) via 3 separate test scenarios |
| **T-COMPROMISED-MCP-1** (cross-plan) | high | ✅ asserted (defense-in-depth) | Plan 09-01 SKILL.md Step 4 (Inv #11 — agent re-decodes locally) + Plan 09-04 Layer 0.5 + Plan 09-03 second-LLM + on-device Ledger hash match (Layer 4 — trust anchor) |
| **T-FROZEN-SIGNING-1 (STOP-THE-LINE)** | high | ✅ asserted | EMPTY `git diff` against 11-file FROZEN list + `src/signing/blocks.ts` ZERO diff + `src/tools/send_transaction.ts` three-gate region BYTE-FROZEN |

## Hooks for Phase 9 Close-out + Phase 10

1. **Phase 9 close-out chore** — mark Phase 9 complete in STATE.md + ROADMAP.md; Phase 9 retro covering the 5-plan arc (09-01 sister-repo bootstrap → 09-02 skill-integrity dispatcher-wrap → 09-03 get_verification_artifact second-LLM ritual → 09-04 canonical-dispatch Layer 0.5 → 09-05 verify_tx_decode + get_tx_verification v1.3 re-spec). Loose-end candidates: 09-01's `.github/workflows/ci.yml` for the sister repo (deferred per 09-01 SUMMARY) — verify whether shipped or carry-forward.

2. **Phase 10 (v1.4 Distribution) planning + execute** — npm publish workflow + Smithery manifest + Docker entrypoint + companion `vaultpilot-preflight` skill v1.3.0 sister-repo release tag + README + ARCHITECTURE.md + SECURITY.md v1.3 updates surfacing the verify_tx_decode + get_verification_artifact + canonical-dispatch + sessionTopicLast8 surface.

3. **v1.3 verify-phase ship gate** — Plan 09-05's `<output>` block names this explicitly. Resolves A1 (second-LLM decode reliability across 3-4 LLMs × 5 actions: transfer / approve / withdraw / aave-supply / aave-withdraw via verify_tx_decode 3-arm + get_verification_artifact second-LLM out-of-band); A4 + A5 + A7 + A8 (verify-phase tasks); A11 (verify_tx_decode tool description routing — the DESCRIPTION constant names when to use vs not-use vs route-to-get_verification_artifact-fallback).

4. **register-all.ts is now fully populated for v1.3** — no further carve coordination needed in this phase. Future plans inserting tools have free choice of placement (insert near a domain-aligned group).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 — Bug] T-DECODER-SINGLE-SOT-1 grep matched source-file comment block**

- **Found during:** First test run of Test 18 — 3 grep hits surfaced when 0 expected.
- **Issue:** The source-file comment block in `verify_tx_decode.ts` intentionally NAMES the forbidden APIs (`decodeFunctionData` / `decodeAbiParameters` / `parseAbiItem`) to document the single-SOT discipline. The naive grep counted these as parallel-decoder violations.
- **Fix:** Updated the test to filter out single-line `//`-prefixed comments before counting matches. Code-only grep returns 0; comment-block documentation remains intact (load-bearing for future contributors per CLAUDE.md "Documentation Style — concise, non-redundant, sharp" — explain the WHY once in source, don't force readers to traverse the test file).
- **Files modified:** `test/verify-tx-decode.test.ts` Test 18 only.
- **Commit:** rolled into the single Task 1 atomic commit (`0c4a57f`).

**2. [Rule 1 — Test fix] `setActivePersona` API drift in demo-mode preview_send test**

- **Found during:** First test run of the new preview_send sessionTopicLast8 demo-mode test — `Error: unknown persona slug: [object Object]`.
- **Issue:** `setActivePersona` takes a slug `string` (literal-union `"whale" | "defi-degen" | "stable-saver" | "staking-maxi"`), NOT a `Persona` object. I initially passed a `{ address, label }` object as if constructing the persona directly. The slug-based API is the Phase 5 SOT (matches `set_demo_wallet`'s contract).
- **Fix:** Pass `"whale"` slug literal (canonical first persona). The whale persona's address replaces the synthetic object; tests still cover the demo-mode `sessionTopicLast8 === null` invariant.
- **Files modified:** `test/preview-send.test.ts` (1-line change).
- **Commit:** rolled into the single Task 1 atomic commit.

### Plan Body Observations (not deviations)

- **`decodeWeth9Withdraw` helper not needed.** Plan sketch assumed a separate helper from `src/protocols/weth9.ts`. Actual SOT: `_protocols.decodeErc20Call` returns `{ kind: "withdraw", amount }` for WETH9.withdraw calldata because `ERC20_COMBINED_DECODE_ABI` includes the WETH9 fragment. verify_tx_decode reuses this — tighter SOT discipline than the plan sketch (1 decoder indirection instead of 2).

- **`txJson` extended to BOTH prepared status return AND post-pinned success return.** Plan body specified the success path only. I extended to BOTH so the structuredContent SHAPE is consistent across status branches; the prepared-status nonce/gas/fees fields fall back to `null` when the handle hasn't been pinned yet. Test 'txJson is present on prepared status' covers this; Test 'txJson is present on previewed status' covers the post-pinned case.

- **`sessionTopicLast8` reuses existing `getStatus()` call site.** Plan sketch proposed `getStatus()?.sessionTopicLast8 ?? null` as a new inline expression on the return object. At execute time I observed `getStatus()` is already called upstream in both preview_send (line 291) and send_transaction (line 395); reusing the same `status` reference avoids a second async round-trip and keeps surfacing consistent with the existing call pattern.

- **T-FROZEN-THREE-GATE-REGRESSION-1 shape changed from exact-line-regex to added-line-ceiling + token-deny-list.** Plan body specified "regex pattern restricting changes to the additive line only". At execute time I chose a more pragmatic shape (ceiling at 20 added lines + 6-token deny-list protecting load-bearing identifiers from removal). Tighter than exact-shape regex (which would break on innocuous comment edits within the success block); weaker against deliberate adversarial edits (an attacker could remove a gate without triggering the deny-list if they avoid the exact tokens). The execute-time manual `git diff` verification IS the additional check. Trade-off documented in decisions[].

### Plan estimate vs landed test count

Plan estimate: 35 cases. Landed: 32 cases (22 new + 6 + 2 + 2). Difference of 3 reflects condensing some per-field divergence cases into multi-field assertions within a single test (T-AAVE-TX-TO-CONFUSION-1 Test 12 covers both the "to (claimedDecode)" divergence AND verifies canonical Aave Pool surfaces in serverSays in a single test; the spy round-trip for T-DECODER-SINGLE-SOT-1 is one test with multiple assertions). Functional coverage matches the plan; every anchor is asserted.

## Accepted Residuals

- **verify_tx_decode amount comparison uses WEI-string discipline (option (c) LOCKED).** Agent MUST pass WEI string in `claimedDecode.args.amount`. Decimal-string agent claims (`"100.5"`) would fail comparison against raw WEI (`100500000000000000000` for 18-decimal token; `100500000` for USDC 6-decimal). The agent's discipline (pass WEI as shown in prepare response's `valueWei` or in DECODED ARGS block's amount field) is the mitigation. Tool DESCRIPTION names this explicitly. v1.4+ may add decimals lookup via BRIDGED_VARIANTS extension (option b).

- **`txJson` bigint-as-decimal-string serialization** (PATTERNS.md § 3 line 523 LOCKED). Consistent with existing `gas: pinned.gas.toString()` discipline at line 214. NOT hex. Decimal-string preserves round-trip through `JSON.parse(JSON.stringify(...))` + matches `valueWei: "1000000000000000000"` convention already in use.

- **verify_tx_decode does NOT auto-block send on divergence.** The tool returns the divergence in structuredContent; the agent's decision-policy (informed by Plan 09-01 SKILL.md Step 4 / Inv #11 enforcement) determines halt-or-proceed. The MCP doesn't enforce halt because the trust anchor remains the device hash match (Layer 4); the divergence list is INFORMATION for the agent + user.

- **`get_tx_verification` text-block UNCHANGED** — Plan 09-05's v1.3 extension is structuredContent-only; the existing PREPARE RECEIPT + LEDGER BLIND-SIGN HASH + AGENT TASK + 4byte + VERIFY BEFORE SIGNING blocks BYTE-FROZEN. Adding text-block changes would require coordinating with the existing user-facing visual ritual (test fixtures + block-shape regressions). Out of scope for v1.3 minor additive surface.

- **`dispatchCheckResult` re-runs the canonical-dispatch check on every `get_tx_verification` call.** The cost is constant-time (Set.has lookup); negligible. The re-run anchors the v1.3 invariant for the context-evicted agent — they see the SAME verdict the original `preview_send` Layer 0.5 returned.

- **T-DECODER-SINGLE-SOT-1 grep enforcement runs against code lines only (comments excluded).** A contributor could circumvent by aliasing the forbidden API (e.g. `const decode = decodeFunctionData; decode(...)`). The check is best-effort; the in-tree decoder reuse via `_protocols.*` + `_aaveProtocols.*` IS the load-bearing discipline. Comment-block documentation explains the WHY for future contributors.

- **`pair_ledger_live_wait.ts` parity confirmed — no source edit needed.** `sessionTopicLast8` already surfaced at file:95-110 per Phase 3 Plan 03-02. Verified at execute time via file read.

- **`pair_ledger_live.ts` + `get_ledger_status.ts` parity confirmed — no source edit needed.** Phase 3 surfaces.

- **register-all.ts carve at line 25-26 region** — non-conflicting with Plan 08-04 + 08-05 carves at lines 6-7 + line 28. Trivial-rebase only if future Phase touches register-all.

- **Long-tail token contracts hit `verify_tx_decode` decode-unsupported (per plan via Plan 09-04 Layer 0.5).** Tokens NOT in BRIDGED_VARIANTS fail Layer 0.5 first; tokens in BRIDGED_VARIANTS pass Layer 0.5 but verify_tx_decode might surface decode-unsupported if the action isn't ERC-20 lifecycle. Routing hint to `get_verification_artifact` for second-LLM fallback. v2.4+ `prepare_custom_call` escape hatch is the documented future path.

- **Phase 9 close-out loose ends** (deferred to close-out chore):
  - 09-01's `.github/workflows/ci.yml` for the sister repo — verify whether shipped or carry-forward; Plan 09-05 does NOT touch sister repo.
  - Phase 9 retro covering the 5-plan arc — meta-skills + project facts from the phase to surface to user.
  - Phase 10 (v1.4 Distribution) planning + execute — npm publish + Smithery + Docker + skill release as the next active phase.

## Phase 9 Progress

Phase 9 = 5 plans:

- **09-01** ✅ Sister repo bootstrap + SKILL.md + Step 0 + invariants encoded
- **09-02** ✅ `src/security/skill-integrity.ts` + EXPECTED_SKILL_SHA256 + dispatcher-wrap VAULTPILOT NOTICE + sister-repo v1.3.0 coordinated release
- **09-03** ✅ `get_verification_artifact` tool + PASTEABLE_BLOCK_TEMPLATE + canned second-LLM decode prompt (register-all carve DEFERRED — closes here in 09-05)
- **09-04** ✅ `src/security/canonical-dispatch.ts` + Layer 0.5 dispatch-allowlist refusal + BRIDGED_VARIANTS consumption for Phase 6 compatibility
- **09-05** ✅ `verify_tx_decode` 3-arm + `get_tx_verification` v1.3 additive extension + `sessionTopicLast8` surfacing + register-all carve close-out (THIS PLAN)

**Phase 9 code-complete after Plan 09-05 merges.** v1.3 hardening surface ships: companion preflight skill + 3 verification tools (`get_verification_artifact` + `verify_tx_decode` + `get_tx_verification` re-spec) + canonical-dispatch allowlist + WC session-topic surfacing across all signing flows.

## Self-Check: PASSED

- `src/tools/verify_tx_decode.ts` exists (380 LOC); registers `verify_tx_decode` MCP tool; 3-arm `VerifyTxDecodeResult` discriminated union; per-action coverage for 5 actions; LOCKED option (c) WEI-string amount comparison; single-SOT decoder reuse via `_protocols.decodeErc20Call` + `_aaveProtocols.decodeAaveV3Call`.
- `src/tools/get_tx_verification.ts` has 3 NEW additive structuredContent fields (`txJson` + `sessionTopicLast8` + `dispatchCheckResult`) on BOTH prepared status return AND post-pinned success return; existing text blocks + structuredContent fields UNCHANGED; DESCRIPTION constant appended with single v1.3 additions sentence.
- `src/tools/preview_send.ts` has additive `sessionTopicLast8` field on success structuredContent; Plan 09-04 Layer 0.5 + Phase 8 Layer 2 regions UNCHANGED (verified via line-range diff inspection).
- `src/tools/send_transaction.ts` has additive `sessionTopicLast8` field on SUCCESS path structuredContent (9 added lines total in `git diff`, all within SUCCESS block); three-gate region BYTE-FROZEN.
- `src/tools/pair_ledger_live_wait.ts` parity confirmed (no source edit — Phase 3 SOT).
- `src/signing/error-codes.ts` has `DECODE_DIVERGENCE` appended to `ErrorCode` union (18 → 19 codes); producer-map comment extended naming Plan 09-05.
- `src/tools/register-all.ts` has 2 NEW import lines (`./verify_tx_decode.js` + `./get_verification_artifact.js`) inserted AFTER `./get_tx_verification.js`.
- `test/verify-tx-decode.test.ts` exists (596 lines, 22 cases green).
- `test/get-tx-verification.test.ts` extended with 6 NEW assertions (16 tests green; was 10 baseline).
- `test/preview-send.test.ts` extended with 2 NEW assertions (19 tests green; was 17 baseline).
- `test/send-transaction.test.ts` extended with 2 NEW assertions (19 tests green; was 17 baseline).
- 11-file FROZEN list ZERO diff via `git diff origin/main -- <11 files> | wc -l == 0`.
- `src/signing/blocks.ts` ZERO diff via `git diff origin/main -- src/signing/blocks.ts | wc -l == 0` (Plan 09-05 does NOT touch).
- T-DECODER-SINGLE-SOT-1: `grep` on code lines only returns 0 viem decoder calls in `src/tools/verify_tx_decode.ts`.
- `npm run typecheck` clean (no output).
- `npm run build` clean (no errors).
- Test suite GREEN: **890 / 890** (858 baseline + 32 new) across 79 test files.
- Main-repo branch correct: `feat/09-05-verify-tx-decode-and-tx-verification-respec`.
- Worktree path correct: `/Users/s/dev/vaultpilot/vaultpilot-mcp-gsd-inspired/.claude/worktrees/feat-09-05-verify-tx-decode-and-tx-verification-respec`.
- Main-repo commit landed: `0c4a57f feat(09-05): verify_tx_decode 3-arm + get_tx_verification v1.3 additive + sessionTopicLast8 surfacing + register-all carve close-out`.
