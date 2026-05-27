---
phase: 37
slug: safe-three-step-signing-flow
status: planned
nyquist_compliant: true
wave_0_complete: false
created: 2026-05-27
updated: 2026-05-27
---

# Phase 37 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution. Populated by the planner with Per-Task Verification Map rows after each PLAN.md is written.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 1.x (project default per `package.json`) |
| **Config file** | `vitest.config.ts` (existing) |
| **Quick run command** | `npm test -- --run test/signing-safe-tx-hash.test.ts test/signing-safe-exec-decode.test.ts test/prepare-safe-tx-propose.test.ts test/prepare-safe-tx-approve.test.ts test/submit-safe-tx-signature.test.ts test/prepare-safe-tx-execute.test.ts test/signing-fingerprint.test.ts` |
| **Full suite command** | `npm test -- --run` |
| **Estimated runtime** | Quick: ~13s · Full: ~90s |

---

## Sampling Rate

- **After every task commit:** Run the relevant per-file quick command (single `*.test.ts` file).
- **After every plan wave:** Run the full suite (W1: 37-01 quick suite; W2: 37-02 quick suite; W3: 37-03 full integration).
- **Before `/gsd-verify-work`:** Full suite must be green.
- **Max feedback latency:** ~13 seconds (quick).

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 37-01-01 | 37-01 | 1 | SAFE-05 | T-37-01 / T-37-02 / T-37-04 / T-37-SC | `computeSafeTxHash` matches viem.hashTypedData canonical EIP-712 digest for v1.3.0 + v1.4.1; fixtures SAFE-A/B/C/D hardcoded `0x…` literals; endianness-LE for chain uint64 in fingerprint preimage | unit | `npm test -- --run test/signing-safe-tx-hash.test.ts test/signing-fingerprint.test.ts` | ❌ Wave 0 (NEW: test/signing-safe-tx-hash.test.ts; EXTEND: test/signing-fingerprint.test.ts) | ⬜ pending |
| 37-01-02 | 37-01 | 1 | SAFE-05 | T-37-04 | `PreparedTxSafeTypedData` discriminant added; PreparedTx union widens to 7 arms; existing state-machine BYTE-IDENTICAL; transitionToSent accepts SafeTx hash as txHash arg (string-widened); shape-expansion rationale block present in Task 2 action (sentinel EVM-shape fields + `safeTx*`-suffix collision avoidance + `kind`→`txType` per codebase pattern) | unit | `npm test -- --run test/signing-handle-store.test.ts && npx tsc --noEmit` | ❌ Wave 0 (EXTEND or NEW: test/signing-handle-store.test.ts) | ⬜ pending |
| 37-01-03 | 37-01 | 1 | SAFE-05 | T-37-03 / T-37-05 / T-37-08 | `prepare_safe_tx_propose` returns handle + safeTxHash + typedDataStructure + payloadFingerprint matching Fixture SAFE-A + SAFE-D; UNSUPPORTED_SAFE_VERSION pre-v1.3.0 gate; on-chain owner cross-check; eth_signTypedData_v4 in WC namespace; getOnchainDomainSeparator wired | unit | `npm test -- --run test/prepare-safe-tx-propose.test.ts test/wallet-session-manager.test.ts test/chains-safe.test.ts` | ❌ Wave 0 (NEW: test/prepare-safe-tx-propose.test.ts; EXTEND: test/wallet-session-manager.test.ts + test/chains-safe.test.ts) | ⬜ pending |
| 37-02-01 | 37-02 | 2 | SAFE-07 | T-37-15 / T-37-SC | `postSignature` 6-arm DU (ok / duplicate / not-found / rate-limited / error / unsupported-chain); POST body shape `{signature}` only (no owner, no signatureType); trailing-slash URL; cache invalidation on success with key shape `${chainId}:${safeTxHash.toLowerCase()}` (matches existing getMultisigTransaction keying) | unit | `npm test -- --run test/clients-safe-tx-service.test.ts` | ❌ Wave 0 (EXTEND: test/clients-safe-tx-service.test.ts) | ⬜ pending |
| 37-02-02 | 37-02 | 2 | SAFE-06 | T-37-10 / T-37-18 | `prepare_safe_tx_approve` fetches via Tx Service + recomputes safeTxHash from on-chain state; txServiceDrift refusal on mismatch; domainSeparatorDrift informational; duplicateSignWarning informational | unit | `npm test -- --run test/prepare-safe-tx-approve.test.ts` | ❌ Wave 0 (NEW: test/prepare-safe-tx-approve.test.ts) | ⬜ pending |
| 37-02-03 | 37-02 | 2 | SAFE-07 | T-37-09 / T-37-11 / T-37-12 / T-37-13 / T-37-14 | `submit_safe_tx_signature` ECDSA-recovers via viem.recoverAddress (raw digest, no personal_sign wrapping); refuses non-paired + non-owner BEFORE POST; v ∈ {0, 1} INVALID_SIGNATURE_MODE BEFORE recovery; handle transitions to "sent" on success; `findHandlesBySafeTxHash` filter semantics correct (focused exported helper iterates internal Map directly; no _handles ESM indirection per WARNING 4 resolution) | unit | `npm test -- --run test/submit-safe-tx-signature.test.ts` | ❌ Wave 0 (NEW: test/submit-safe-tx-signature.test.ts) | ⬜ pending |
| 37-03-01 | 37-03 | 3 | SAFE-08 | T-37-21 / T-37-22 / T-37-23 / T-37-24 / T-37-26 | `prepare_safe_tx_execute` assembles signatures ASCENDING by signer address; per-confirmation ECDSA-recovery + on-chain owner cross-check; INSUFFICIENT_SIGNATURES / STALE_SIGNATURE / UNSUPPORTED_SAFE_VERSION / nonce-drift refusals; encapsulated-op composite preview via SHARED `src/signing/safe-exec-decode.ts` decoder; payloadFingerprint uses VaultPilot-txverify-v1: tag (NOT safetx tag); outer dispatch target `tx.to = safeAddress` (user's Safe proxy, NOT Singleton — LOCKED per CONTEXT); `isSafeExecTransaction: true` sentinel set via createHandle; selector match `0x6a761202` sanity (Invariant #1) | unit | `npm test -- --run test/prepare-safe-tx-execute.test.ts test/signing-safe-exec-decode.test.ts` | ❌ Wave 0 (NEW: test/prepare-safe-tx-execute.test.ts + test/signing-safe-exec-decode.test.ts) | ⬜ pending |
| 37-03-02 | 37-03 | 3 | SAFE-08 | T-37-19 / T-37-20 / T-37-26 / T-37-28 | `send_transaction(PreparedTxSafeTypedData)` returns WRONG_HANDLE_KIND refusal (ONE additive arm in `src/tools/send_transaction.ts`); `preview_send(PreparedTxSafeTypedData)` returns WRONG_HANDLE_KIND refusal; `preview_send` Layer 0.5 bypass extended with `\|\| record.isSafeExecTransaction === true` (additive `\|\|` line at preview_send.ts:811-812 — mirror of Phase 35 escape-hatch precedent); preview_send composite-tx dispatch arm for selector 0x6a761202 decodes encapsulated op via SHARED decoder; WARN-block re-emission byte-identical to prepare-side (mirror Phase 35 T-35-03-G) | unit | `npm test -- --run test/preview-send.test.ts test/send-transaction.test.ts` | ❌ Wave 0 (EXTEND: test/preview-send.test.ts + test/send-transaction.test.ts; possibly NEW: test/send-transaction-safe-refusal.test.ts) | ⬜ pending |
| 37-03-03 | 37-03 | 3 | SAFE-05..08 | T-37-19 / T-37-21 / T-37-26 / T-37-27 | End-to-end three-step flow: 1-of-1 propose → submit → execute (handle transition + execTransaction calldata byte-equality + `isSafeExecTransaction === true` on handle record) + 2-of-3 propose → submit → approve → submit → execute (Anvil-address ascending-sort discipline: acct2 < acct1 < acct0; signers {acct0, acct1}; Tx Service insertion proposer-first = [acct0, acct1] REVERSED to ascending [acct1, acct0]); persona-cycle byte-identity for SafeTx hash + propose payloadFingerprint (`from`-independent); FROZEN-area additive-arms acceptance gate (Test 18-equivalent — deletion-marker grep returns empty); **`isSafeExecTransaction` grep-guard: EXACTLY 2 functional source-file references — one assignment in `prepare_safe_tx_execute.ts`, one read in `preview_send.ts` — mirror Phase 35 Test 6 (T-37-26 anchor)**; WARN-block byte-identity prepare-vs-preview | integration | `npm test -- --run test/integration/safe-three-step-flow.test.ts` | ❌ Wave 0 (NEW: test/integration/safe-three-step-flow.test.ts) | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `test/signing-safe-tx-hash.test.ts` — NEW. Fixtures SAFE-A (v1.3.0 call) / SAFE-B (v1.4.1 call) / SAFE-C (v1.3.0 delegatecall) hardcoded `0x…` literals; v1.3.0-vs-v1.4.1 byte-identity sanity + nonce-distinctness sanity. EXPORTED `FIXTURE_SAFE_A_HASH`, `FIXTURE_SAFE_B_HASH`, `FIXTURE_SAFE_C_HASH` for consumer cross-link.
- [ ] `test/signing-fingerprint.test.ts` — EXTEND. Append EXPORTED `FIXTURE_SAFE_D_FP` literal after existing FIXTURE_P_FP export; add Fixture SAFE-D `VaultPilot-safetx-v1:` preimage assertion + endianness-distinctness sanity test.
- [ ] `test/signing-handle-store.test.ts` (EXTEND or NEW) — `PreparedTxSafeTypedData` discriminant round-trips via createHandle/lookup; `transitionToSent(handle, safeTxHash)` accepts string; switch-narrowing compiles. Plus `isSafeExecTransaction?: true` sentinel field on PreparedTxEvm round-trips (Plan 37-03 Task 1 Step B — mirror of `acknowledgeNonProtocolTarget?: true`).
- [ ] `test/prepare-safe-tx-propose.test.ts` — NEW. Happy path + cross-link to Fixture SAFE-A + Fixture SAFE-D; UNSUPPORTED_SAFE_VERSION / WALLET_NOT_PAIRED / non-owner refusals; PREPARE RECEIPT / CHECKS PERFORMED / LEDGER DISPLAY block presence; domain-separator cross-check.
- [ ] `test/wallet-session-manager.test.ts` — EXTEND. Single assertion: `REQUIRED_NAMESPACES.eip155.methods` contains `"eth_signTypedData_v4"`.
- [ ] `test/chains-safe.test.ts` — EXTEND. `getOnchainDomainSeparator` reader + `_safeChains` ESM spy round-trip; Phase 36 surface unchanged.
- [ ] `test/clients-safe-tx-service.test.ts` — EXTEND. New `describe("postSignature", …)` block: 6-arm DU (201/200/404/429/5xx/unsupported-chain) + POST body shape + trailing-slash URL + Content-Type header + per-session ceiling + cache invalidation on success (key shape `${chainId}:${safeTxHash.toLowerCase()}`) + idempotent re-post.
- [ ] `test/prepare-safe-tx-approve.test.ts` — NEW. Happy path + cross-link to Fixture SAFE-A; txServiceDrift refusal; domainSeparatorDrift informational; duplicateSignWarning informational; Tx Service 5-arm DU dispatch; UNSUPPORTED_SAFE_VERSION / non-owner refusals; delegatecall informational note.
- [ ] `test/submit-safe-tx-signature.test.ts` — NEW. ECDSA-recovery happy path + handle transition to sent; refusals (non-paired, non-owner, v ∈ {0, 1}, payloadFingerprint drift, Tx Service 404/429/error/unsupported-chain); userDecision cancel path bypasses POST; v ∈ {27, 28, 31, 32} accepted; cross-link to Fixture SAFE-A end-to-end with synthetic signature; `findHandlesBySafeTxHash` filter semantics correct.
- [ ] `test/signing-safe-exec-decode.test.ts` — NEW. SHARED decoder round-trip: encode execTransaction via `encodeFunctionData({abi: execTransactionAbi})`, assert `decodeSingleSafeExecTransaction(encoded)` byte-identical to original args; selector match (`encoded.slice(0,10) === EXEC_TRANSACTION_SELECTOR`); `operation` narrowing throws on invalid value.
- [ ] `test/prepare-safe-tx-execute.test.ts` — NEW. 1-of-1 + 2-of-3 happy paths; ascending-sort byte-equality; INSUFFICIENT_SIGNATURES / INVALID_SIGNATURE_MODE / STALE_SIGNATURE / UNSUPPORTED_SAFE_VERSION / nonce-drift refusals; composite-tx preview decoded + undecoded paths; delegatecall informational; payloadFingerprint uses VaultPilot-txverify-v1 tag; `isSafeExecTransaction === true` on handle record (sentinel set); outer dispatch target = safeAddress (user's Safe proxy, NOT Singleton); selector match Invariant #1 sanity.
- [ ] `test/preview-send.test.ts` — EXTEND. (selector 0x6a761202) composite-tx dispatch arm; PreparedTxSafeTypedData → WRONG_HANDLE_KIND refusal; cached-ABI inner decode + undecoded fallback; payloadFingerprint stays over outer calldata; Layer 0.5 bypass via `isSafeExecTransaction` sentinel (positive case + negative case without sentinel for defense-in-depth).
- [ ] `test/send-transaction.test.ts` (EXTEND or new focused file) — PreparedTxSafeTypedData → WRONG_HANDLE_KIND refusal; handle state unchanged; WC signClient.request not invoked in refusal path; existing dispatch arms unchanged.
- [ ] `test/integration/safe-three-step-flow.test.ts` — NEW. 1-of-1 + 2-of-3 fixtures; Anvil-address ascending-sort anchor block as comment (acct2 < acct1 < acct0; signers {acct0, acct1}); Tx Service insertion proposer-first reversed to ascending; persona-cycle byte-identity for SafeTx hash; FROZEN-area additive-arms Test 18-equivalent (deletion-marker grep returns empty); **`isSafeExecTransaction` grep-guard: exactly 2 functional source-file references (mirror Phase 35 Test 6 — T-37-26 anchor)**; WARN-block byte-identity prepare-vs-preview.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Ledger ETH app typed-data sign-display (clear-sign OR blind-sign on safeTxHash) | SAFE-05 / SAFE-06 | Requires physical Ledger device + real Safe deployment; no automated harness | Real-Ledger UAT — bundled per Phase 36 close-out cadence: pair Ledger → `prepare_safe_tx_propose({chain: "ethereum", safeAddress: <user's 1-of-1 mainnet Safe>, to, value, data: "0x", operation: "call"})` → invoke `eth_signTypedData_v4` via WC → confirm Ledger ETH app displays the 32-byte safeTxHash (clear-sign if CAL covers this Safe contract; blind-sign otherwise) → sign → `submit_safe_tx_signature` → confirm Tx Service shows the signature via independent UI |
| WalletConnect `eth_signTypedData_v4` namespace compatibility | SAFE-05 / SAFE-06 | Requires Ledger Live + WC v2 bridge running | Same flow as above; verify no `eth_signTypedData_v4` method-not-supported error on the post-Phase-37 pairing; also test that PRE-Phase-37 paired sessions surface the INVALID_INPUT + re-pair hint |
| `prepare_safe_tx_execute` real-Ledger sign + mainnet broadcast | SAFE-08 | Real ETH consumption | After 2-of-3 SafeTx collects threshold via the typed-data flow above, `prepare_safe_tx_execute` → `preview_send` (verify composite-tx preview surfaces encapsulated op correctly AND Layer 0.5 bypass authorized) → `send_transaction` with small-value mainnet broadcast → confirm execTransaction lands and the inner op executes on the user's Safe |
| Pre-v1.3.0 Safe REFUSAL — real-Safe smoke | SAFE-05 | Requires identifying a v1.1.x or v1.2.x Safe on mainnet (rare; or deploying one for the smoke) | Find or deploy a pre-v1.3.0 Safe; invoke `prepare_safe_tx_propose` against it; confirm UNSUPPORTED_SAFE_VERSION refusal carries the recovery hint |
| Real Safe Tx Service rate-limit behavior | SAFE-07 | Requires hitting actual Safe Tx Service IP-throttling | Smoke test the `submit_safe_tx_signature` repeat-call path against the real Tx Service; verify the rate-limited arm surfaces the canonical retry-after envelope |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify (every task has its own `<automated>` command)
- [x] Wave 0 covers all MISSING references (every NEW or EXTENDED test file listed above)
- [x] No watch-mode flags
- [x] Feedback latency < 15s (quick suite)
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved at plan-phase 2026-05-27 — REVISED per checker feedback (BLOCKER 1 sentinel-flag pattern PIN + BLOCKER 2 FROZEN-area path alignment + WARNING 1 Anvil ordering + WARNING 3 shared decoder file + WARNING 4 findHandlesBySafeTxHash shape + WARNING 5 T-37-26 update + WARNING 6 cache key shape). Real-Ledger Manual-Only verifications bundled into v2.5 verify-phase per Phase 36 close-out cadence.
