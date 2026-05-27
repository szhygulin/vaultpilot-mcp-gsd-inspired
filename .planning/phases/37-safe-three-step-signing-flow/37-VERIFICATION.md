---
phase: 37-safe-three-step-signing-flow
verified: 2026-05-27T17:40:00Z
status: passed
score: 6/6 ROADMAP success criteria verified (17/17 detailed checks)
overrides_applied: 0
re_verification:
  previous_status: none
  previous_score: n/a
  gaps_closed: []
  gaps_remaining: []
  regressions: []
---

# Phase 37: Safe three-step signing flow — Verification Report

**Phase Goal:** User can propose a Safe transaction (off-chain — signs a SafeTx hash, submits to Tx Service for co-signer collection), approve a pending transaction (signs the SafeTx hash they didn't propose), execute a fully-signed transaction (on-chain), and submit individual signatures to the Tx Service.

**Verified:** 2026-05-27T17:40:00Z
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### ROADMAP Success Criteria

| #   | Truth (ROADMAP SC)                                                                                                                                  | Status     | Evidence                                                                                                                                                            |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `prepare_safe_tx_propose({ chain, safeAddress, to, value, data, operation })` builds SafeTx hash + EIP-712 typed-data structure; user signs via Ledger | VERIFIED   | `src/tools/prepare_safe_tx_propose.ts` (603 lines); registered in `register-all.ts:119`; consumes `computeSafeTxHash` + `buildSafeEIP712TypedData` from `src/signing/safe-tx-hash.ts`. |
| 2   | `prepare_safe_tx_approve({ chain, safeAddress, safeTxHash })` fetches pending SafeTx + surfaces decoded operation in CHECKS PERFORMED                | VERIFIED   | `src/tools/prepare_safe_tx_approve.ts` (478 lines); registered at `register-all.ts:120`; fetches via Phase 36 `getMultisigTransaction` and decodes operation.        |
| 3   | `submit_safe_tx_signature({ chain, safeAddress, safeTxHash, signature })` submits signature to Tx Service (off-chain)                                | VERIFIED   | `src/tools/submit_safe_tx_signature.ts` (557 lines); registered at `register-all.ts:121`; POSTs via new `postSignature` 6-arm DU in `src/clients/safe-tx-service.ts:670`. |
| 4   | `prepare_safe_tx_execute({ chain, safeAddress, safeTxHash })` builds on-chain execution tx; signatures assembled from Tx Service state               | VERIFIED   | `src/tools/prepare_safe_tx_execute.ts` (620 lines); registered at `register-all.ts:122`; ascending-sort assembly at line 408-410; PreparedTxEvm + isSafeExecTransaction sentinel. |
| 5   | Three-step flow surfaces explicitly in agent-facing tool descriptions; each step is a distinct named tool                                            | VERIFIED   | 4 distinct tools, each with role-explicit description (propose / approve / submit / execute). DESCRIPTION constants in each tool file enumerate when to use vs not. |
| 6   | SafeTx hash computation in `src/signing/safe-tx-hash.ts` (EIP-712 typed-data digest); regression-tested with fixture Safe transactions               | VERIFIED   | `src/signing/safe-tx-hash.ts` (174 lines, viem.hashTypedData based); regression-tested via Fixtures SAFE-A/B/C (hardcoded `0x…` literals) in `test/signing-safe-tx-hash.test.ts`. |

**Score:** 6/6 ROADMAP success criteria VERIFIED.

### Detailed Verification Checks (17 of 17 passing)

| #   | Check                                                                                                          | Status     | Evidence                                                                                                                                                       |
| --- | -------------------------------------------------------------------------------------------------------------- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | 4 new MCP tools registered                                                                                     | VERIFIED   | `register-all.ts:119-122` imports all four. All files exist (603/478/557/620 lines).                                                                            |
| 2   | `safe-tx-hash.ts` exists with `computeSafeTxHash` + `buildSafeEIP712TypedData`; SAFE-A/B/C hardcoded literals  | VERIFIED   | Exports confirmed at `src/signing/safe-tx-hash.ts:110, 166`. Fixtures SAFE-A (v1.3.0 call), SAFE-B (v1.4.1 call), SAFE-C (v1.3.0 delegatecall) in `test/signing-safe-tx-hash.test.ts:83-91`. |
| 3   | `payloadFingerprint` domain tag `VaultPilot-safetx-v1:`; SAFE-D hardcoded literal                              | VERIFIED   | `SAFE_TX_FINGERPRINT_DOMAIN_TAG = "VaultPilot-safetx-v1:"` at `src/signing/payload-fingerprint.ts:37`; `computeSafeTxPayloadFingerprint` at line 95. SAFE-D pinned at `test/signing-fingerprint.test.ts:1886`. |
| 4   | `PreparedTxSafeTypedData` added to union; `isSafeExecTransaction?: true` on HandleRecord                       | VERIFIED   | Union widening at `src/signing/handle-store.ts:1057`; `PreparedTxSafeTypedData` interface at line 982; `isSafeExecTransaction?: true` on HandleRecord at line 1145, createHandle input at line 1195. |
| 5   | `postSignature` added to safe-tx-service client with 6-arm DU                                                  | VERIFIED   | `PostSignatureResult` DU at `src/clients/safe-tx-service.ts:191-197` — 6 arms: ok / duplicate / not-found / rate-limited / error / unsupported-chain. `postSignature` export at line 670. |
| 6   | WC namespace methods array includes `eth_signTypedData_v4`                                                     | VERIFIED   | `src/wallet/session-manager.ts:85` — `methods: ["eth_sendTransaction", "personal_sign", "eth_signTypedData_v4"]`.                                              |
| 7   | `findHandlesBySafeTxHash` exported from handle-store.ts                                                        | VERIFIED   | `src/signing/handle-store.ts:1318` — public export iterating the internal map by (chain, safeAddress, safeTxHash) tuple.                                       |
| 8   | `send_transaction.ts`: exactly ONE additive WRONG_HANDLE_KIND arm for `txType: "safe-typed-data"`              | VERIFIED   | `git diff origin/main -- src/tools/send_transaction.ts`: 0 deletion lines, +26 addition lines, single contiguous arm at line 244-269.                          |
| 9   | `preview_send.ts`: exactly 3 additive sites (refusal gate, `||` isSafeExecTransaction bypass, composite decode) | VERIFIED   | Diff shows three sites: (a) lines 759-783 refusal gate; (b) line 861 `||` extension of `acknowledgeNonProtocolTarget` bypass; (c) lines 1873-1969 composite-tx decode arm. Two "-" diff lines are paired with adjacent additions (additive extension). |
| 10  | Grep-guard for `isSafeExecTransaction` — exactly right set                                                     | VERIFIED   | `grep -rn isSafeExecTransaction src/` → assignments in `prepare_safe_tx_execute.ts:491, 599`, read in `preview_send.ts:862`, type field in `handle-store.ts:1145, 1195`. Two functional source sites as documented. |
| 11  | Composite-tx preview surfaces encapsulated `(to, value, data, operation)` via shared decoder                   | VERIFIED   | `src/signing/safe-exec-decode.ts` exports `EXEC_TRANSACTION_SELECTOR = "0x6a761202"` + `decodeSingleSafeExecTransaction`. Consumed BOTH by `prepare_safe_tx_execute.ts:460` AND `preview_send.ts:1888`. `encapsulatedOperation` field in response at `prepare_safe_tx_execute.ts:590`. |
| 12  | ECDSA signer-recovery via `viem.recoverAddress` over raw 32-byte digest; on-chain owner cross-check            | VERIFIED   | `submit_safe_tx_signature.ts:275-278`: `recoverAddress({ hash: safeTxHash, signature })` — NOT personal_sign wrapped. Owner cross-check at line 324+ via `_safeChains.getOnchainSafeInfo`. Comment at line 15 + 271 explicitly anchors raw-digest discipline. |
| 13  | v-byte modes: accept v ∈ {27, 28, 31, 32}; refuse v ∈ {0, 1} with INVALID_SIGNATURE_MODE                       | VERIFIED   | `submit_safe_tx_signature.ts:259-269` — `if (vByte < 27)` refuses with INVALID_SIGNATURE_MODE. Accepts 27/28 (ECDSA) and 31/32 (Safe eth_sign mode). DESCRIPTION line 87 enumerates the rule. |
| 14  | Full test suite `npm test -- --run` passes                                                                     | VERIFIED   | 339 test files, **4969 tests passed**, 1 skipped, 0 failed. Duration 192.96s.                                                                                  |
| 15  | TypeScript clean — `npx tsc --noEmit` exits 0                                                                  | VERIFIED   | No output (clean exit 0).                                                                                                                                      |
| 16  | FROZEN-area gates — only additive lines                                                                        | VERIFIED   | `git diff origin/main -- src/tools/send_transaction.ts`: 0 deletions. `git diff origin/main -- src/tools/preview_send.ts`: 2 "-" lines, both paired with same-line additive replacements (`||` extension + ternary continuation) per CONTEXT §FROZEN-area lines 132-141. |
| 17  | Integration test exercises full three-step flow: 1-of-1 + 2-of-3 + ascending-sort verification                 | VERIFIED   | `test/integration/safe-three-step-flow.test.ts` (711 lines, 19 test cases). describe-block at line 263 (1-of-1 propose→submit→execute) + line 337 (2-of-3 ascending-sort discipline; Tx Service insertion REVERSE of ascending). Comments at lines 14-27 document the persona/ordering. |

### Required Artifacts (Level 1-3: exists / substantive / wired)

| Artifact                                       | Expected                                                | Status     | Details                                                                                                       |
| ---------------------------------------------- | ------------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------- |
| `src/signing/safe-tx-hash.ts`                  | EIP-712 typed-data digest                               | VERIFIED   | 174 lines; `computeSafeTxHash` + `buildSafeEIP712TypedData` exports; consumed by all 4 tools.                  |
| `src/signing/safe-exec-decode.ts`              | SHARED decoder for execTransaction selector + ABI       | VERIFIED   | 138 lines; `EXEC_TRANSACTION_SELECTOR` + `execTransactionAbi` + `decodeSingleSafeExecTransaction` exports; consumed by prepare_safe_tx_execute + preview_send. |
| `src/tools/prepare_safe_tx_propose.ts`         | NEW tool — propose + EIP-712 sign                       | VERIFIED   | 603 lines; registered + wired to handle-store + session-manager.                                              |
| `src/tools/prepare_safe_tx_approve.ts`         | NEW tool — fetch + co-sign                              | VERIFIED   | 478 lines; registered + wired to safe-tx-service `getMultisigTransaction`.                                    |
| `src/tools/submit_safe_tx_signature.ts`        | NEW tool — POST signature + ECDSA recover + owner check | VERIFIED   | 557 lines; registered + wired to `postSignature` client + `_safeChains.getOnchainSafeInfo`.                   |
| `src/tools/prepare_safe_tx_execute.ts`         | NEW tool — on-chain execTransaction builder             | VERIFIED   | 620 lines; registered + wired to safe-exec-decode + Layer 0.5 sentinel.                                       |
| `src/tools/register-all.ts`                    | 4 new tools registered                                  | VERIFIED   | Lines 119-122 import all four `.js` side-effect register modules.                                             |
| `src/signing/handle-store.ts`                  | PreparedTxSafeTypedData + isSafeExecTransaction field   | VERIFIED   | Discriminant union extended at line 1057; sentinel field optional at 1145 + 1195.                             |
| `src/signing/payload-fingerprint.ts`           | VaultPilot-safetx-v1: tag + computeSafeTxPayloadFingerprint | VERIFIED | Tag at line 37; function at line 95.                                                                          |
| `src/clients/safe-tx-service.ts`               | postSignature with 6-arm DU                             | VERIFIED   | 6-arm DU at line 191-197; postSignature export at line 670.                                                   |
| `src/chains/safe.ts`                           | domainSeparator() reader                                | VERIFIED   | ABI extended at line 71; exported reader at line 136+.                                                        |
| `src/wallet/session-manager.ts`                | eth_signTypedData_v4 in WC namespace methods            | VERIFIED   | Methods array at line 85 includes the new method.                                                             |
| `src/tools/send_transaction.ts`                | ONE additive WRONG_HANDLE_KIND arm; existing arms byte-identical | VERIFIED | 0 deletion lines in diff; single 26-line arm at 244-269.                                                      |
| `src/tools/preview_send.ts`                    | 3 additive sites; existing arms byte-identical          | VERIFIED   | Diff shows exactly the 3 authorized sites; "deletions" are paired same-line additive extensions.              |

### Key Link Verification (Wiring)

| From                                | To                                              | Via                                                                       | Status | Details                                                                                                                     |
| ----------------------------------- | ----------------------------------------------- | ------------------------------------------------------------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------- |
| `prepare_safe_tx_propose`           | safe-tx-hash module                             | `import { computeSafeTxHash, buildSafeEIP712TypedData }`                  | WIRED  | EIP-712 digest computed at prepare time.                                                                                    |
| `prepare_safe_tx_approve`           | Phase 36 `safe-tx-service.getMultisigTransaction` | DI-injected `_clients.fetchMultisigTransaction`                          | WIRED  | Fetches pending SafeTx, decodes operation in CHECKS PERFORMED.                                                              |
| `submit_safe_tx_signature`          | `viem.recoverAddress`                           | Direct import                                                             | WIRED  | Raw 32-byte digest recovery — NOT personal_sign wrapped (line 275).                                                         |
| `submit_safe_tx_signature`          | safe-tx-service `postSignature`                 | DI-injected `_clients.postSignature`                                      | WIRED  | 6-arm DU consumed; cache invalidation on success.                                                                           |
| `submit_safe_tx_signature`          | `src/chains/safe.ts getOnchainSafeInfo`         | `_safeChains.getOnchainSafeInfo`                                          | WIRED  | On-chain owner cross-check via existing Phase 36 ABI reader.                                                                |
| `prepare_safe_tx_execute`           | safe-exec-decode SHARED decoder                 | `decodeSingleSafeExecTransaction`, `EXEC_TRANSACTION_SELECTOR`, `execTransactionAbi` | WIRED | Ascending-sort assembly + WARN block + Invariant #1 selector match.                                                         |
| `preview_send`                      | safe-exec-decode SHARED decoder                 | Same imports                                                              | WIRED  | Composite-tx decode arm at line 1873-1969; byte-identical WARN block re-emission for prepare-vs-preview drift detection.    |
| `preview_send`                      | `record.isSafeExecTransaction` Layer 0.5 bypass | `|| record.isSafeExecTransaction === true` extension at line 861        | WIRED  | Authorized server-side by the 5 prepare-time invariants enumerated in `prepare_safe_tx_execute.ts`.                          |
| `send_transaction`                  | WRONG_HANDLE_KIND refusal for safe-typed-data   | Discriminant check at line 256                                            | WIRED  | Refuses BEFORE state-machine gate — type-mismatch impossible-by-construction.                                               |

### Data-Flow Trace (Level 4)

| Artifact                            | Data Variable                          | Source                                                                | Produces Real Data | Status   |
| ----------------------------------- | -------------------------------------- | --------------------------------------------------------------------- | ------------------ | -------- |
| `prepare_safe_tx_propose`           | SafeTx hash + typed-data structure     | On-chain `nonce()` + `getOwners()` + `VERSION()` reads via Phase 36   | Yes — viem.publicClient reads | FLOWING  |
| `prepare_safe_tx_approve`           | Pending SafeTx + confirmations         | Tx Service `getMultisigTransaction(chain, safeAddress, safeTxHash)`  | Yes — real HTTP API | FLOWING  |
| `submit_safe_tx_signature`          | Recovered signer + posted signature    | viem.recoverAddress over raw digest + Tx Service `POST /api/v1/multisig-transactions/{hash}/confirmations/` | Yes | FLOWING  |
| `prepare_safe_tx_execute`           | execTransaction calldata + signatures blob | Tx Service confirmations + ascending sort + viem.encodeFunctionData | Yes | FLOWING  |

### Behavioral Spot-Checks

| Behavior                                          | Command                                       | Result        | Status |
| ------------------------------------------------- | --------------------------------------------- | ------------- | ------ |
| TypeScript clean                                  | `npx tsc --noEmit`                            | exit 0        | PASS   |
| Full test suite                                   | `npm test -- --run`                           | 4969 pass     | PASS   |
| Fixture SAFE-A/B/C byte-identity                  | `test/signing-safe-tx-hash.test.ts` (3 fixtures) | green        | PASS   |
| Fixture SAFE-D payloadFingerprint byte-identity   | `test/signing-fingerprint.test.ts:1886`       | green         | PASS   |
| Integration 1-of-1 + 2-of-3 flow                  | `test/integration/safe-three-step-flow.test.ts` (19 cases) | green | PASS   |
| Grep-guard for isSafeExecTransaction               | `test/preview-send.safe-execute.test.ts` (grep-guard) | green | PASS   |
| FROZEN-area additive-only on send_transaction.ts  | `test/send-transaction-safe-refusal.test.ts` | green         | PASS   |
| FROZEN-area additive-only on preview_send.ts (Test 18) | `test/integration/safe-get-transaction.test.ts` | green   | PASS   |

### Probe Execution

No conventional `scripts/*/tests/probe-*.sh` defined in this project. PLAN files reference the full vitest suite + TypeScript compile as the runnable checks; both executed above.

### Requirements Coverage

| Requirement | Source Plan       | Description                                                                                                  | Status   | Evidence                                                                  |
| ----------- | ----------------- | ------------------------------------------------------------------------------------------------------------ | -------- | ------------------------------------------------------------------------- |
| SAFE-05     | 37-01-PLAN.md     | `prepare_safe_tx_propose` builds SafeTx hash + EIP-712 typed-data; safe-tx-hash.ts; regression-tested        | SATISFIED | `src/tools/prepare_safe_tx_propose.ts` + `src/signing/safe-tx-hash.ts` + Fixtures SAFE-A/B/C/D |
| SAFE-06     | 37-02-PLAN.md     | `prepare_safe_tx_approve` fetches pending SafeTx + decoded op in CHECKS PERFORMED                            | SATISFIED | `src/tools/prepare_safe_tx_approve.ts` (478 lines, decoded-op surface)    |
| SAFE-07     | 37-02-PLAN.md     | `submit_safe_tx_signature` posts to Tx Service (off-chain)                                                   | SATISFIED | `src/tools/submit_safe_tx_signature.ts` (557 lines) + `postSignature` 6-arm DU client method |
| SAFE-08     | 37-03-PLAN.md     | `prepare_safe_tx_execute` builds on-chain execTransaction; signatures assembled from Tx Service              | SATISFIED | `src/tools/prepare_safe_tx_execute.ts` (620 lines, ascending-sort assembly + composite preview) |

### Anti-Patterns Scanned

| File                                       | Result                                                                                                       |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| `src/signing/safe-tx-hash.ts`              | Clean — no TBD/FIXME/XXX; viem.hashTypedData consumed (no hand-rolled EIP-712 encoder).                       |
| `src/signing/safe-exec-decode.ts`          | Clean — SHARED single-source decoder; throws on selector mismatch + invalid operation.                        |
| `src/tools/prepare_safe_tx_propose.ts`     | Clean — full structured-refusal arms; no placeholder returns.                                                 |
| `src/tools/prepare_safe_tx_approve.ts`     | Clean — DU dispatch + txServiceDrift gate; no stubs.                                                          |
| `src/tools/submit_safe_tx_signature.ts`    | Clean — v-byte gate + recoverAddress + owner cross-check + payloadFingerprint re-check; no stubs.             |
| `src/tools/prepare_safe_tx_execute.ts`     | Clean — INSUFFICIENT_SIGNATURES + STALE_SIGNATURE + ascending-sort + Invariant #1 sanity; no stubs.           |
| `src/tools/send_transaction.ts`            | Clean diff — single additive WRONG_HANDLE_KIND arm; existing arms byte-identical (0 deletions).               |
| `src/tools/preview_send.ts`                | Clean diff — 3 authorized additive sites; existing arms byte-identical (2 "-" lines are paired same-line additive extensions per CONTEXT §FROZEN-area). |

No blockers. No warnings. No info-level notes.

### Human Verification Required

Per Phase 36 close-out cadence (bundle real-Ledger UAT into the next milestone close-out, not per-phase), the following items require human verification on real Ledger Live + a real test Safe. These are NOT phase-37 blockers — they are accepted-residual UAT items deferred per CONTEXT §Claude's Discretion + SECURITY.md residual-risk doc:

1. **Real Ledger clear-sign typed-data display** — `prepare_safe_tx_propose` returns `typedDataStructure`. Verify the Ledger ETH app DISPLAYS field-by-field SafeTx (To / Value / Data / operation) when CAL coverage is present, OR the 32-byte digest only when CAL coverage is absent. (Accepted residual per CONTEXT §Typed-data signing transport.)
   - **Why human:** CAL coverage varies per Safe contract + Ledger firmware version; no public API to detect.
2. **WC re-pair UX for legacy sessions** — Sessions paired before Phase 37 lack `eth_signTypedData_v4` in their namespace. Verify the MCP surfaces the structured refusal hint `"Re-pair Ledger Live: pair_ledger_live({ force: true })"` cleanly.
   - **Why human:** End-to-end pair / unpair / re-pair flow with real Ledger Live.
3. **1-of-1 Safe full flow** — Real testnet Safe, single owner, propose → submit → execute. Confirm on-chain execTransaction lands + Tx Service confirmations populate.
   - **Why human:** Real RPC + Tx Service + Ledger device interaction.
4. **2-of-3 Safe with ascending-sort discipline** — Two real Ledgers (acct1 + acct0 in lex order). Confirm Safe contract accepts the ascending-sorted assembled signature blob.
   - **Why human:** Multi-Ledger choreography + on-chain `checkSignatures` iteration order.

Bundle these into the v2.5 milestone close-out UAT (after Phase 38 second-LLM hard-trigger lands), per Phase 36 cadence.

### Gaps Summary

None. All 6 ROADMAP success criteria are observably true in the codebase; all 17 detailed checks pass; 4969 tests green; TypeScript clean; FROZEN-area gates enforced; grep-guard discipline satisfied.

---

_Verified: 2026-05-27T17:40:00Z_
_Verifier: Claude (gsd-verifier)_
