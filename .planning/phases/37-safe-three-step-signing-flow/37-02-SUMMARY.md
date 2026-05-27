---
phase: 37-safe-three-step-signing-flow
plan: 02
wave: 2
status: complete
started: 2026-05-27T13:29:59Z
completed: 2026-05-27T13:53:51Z
requirements:
  - SAFE-06
  - SAFE-07
depends_on:
  - 37-01
subsystem: signing
tags: [safe, multisig, eip-712, ecdsa-recovery, tx-service, walletconnect]

# Dependency graph
requires:
  - phase: 37-01
    provides: "PreparedTxSafeTypedData discriminant, computeSafeTxHash, computeSafeTxPayloadFingerprint, buildSafeEIP712TypedData, Fixtures SAFE-A/B/C/D, _safeChains.getOnchainDomainSeparator, UNSUPPORTED_SAFE_VERSION error code, eth_signTypedData_v4 WC namespace"
  - phase: 36-safe-positions-tx-service
    provides: "5-arm Safe Tx Service client (getMultisigTransaction / getSafeInfo / etc.), _safeChains.getOnchainSafeInfo on-chain Safe reader, safeTxCache LRU"
provides:
  - "postSignature client method + PostSignatureResult 6-arm DU (extends Phase 36's 5-arm shape with `duplicate` for HTTP 200 idempotent re-post)"
  - "prepare_safe_tx_approve MCP tool — off-chain co-sign entry point with on-chain digest re-derivation gate (T-37-10 txServiceDrift defense)"
  - "submit_safe_tx_signature MCP tool — ECDSA-recover + paired-Ledger + on-chain owner cross-check ALL refusing BEFORE any POST"
  - "findHandlesBySafeTxHash handle-store helper (direct Map iteration; no _handles ESM indirection per CONTEXT lock)"
  - "INVALID_SIGNATURE_MODE error code (v in {0, 1} refusal — T-37-13)"
  - "WRONG_HANDLE_KIND error code (reserved for Plan 37-03 consumers)"
  - "Cache invalidation seam at safeTxCache.delete on successful postSignature (key shape `\${chainId}:\${safeTxHash.toLowerCase()}`)"
affects: ["37-03 prepare_safe_tx_execute (consumes findHandlesBySafeTxHash + WRONG_HANDLE_KIND)", "Phase 38 hard-trigger second-LLM check (reads operation discriminator from PreparedTxSafeTypedData)"]

# Tech tracking
tech-stack:
  added: ["viem.recoverAddress (ECDSA raw-digest recovery — no new npm packages added)"]
  patterns: ["v-byte gate before recovery", "ECDSA-recovery before network call", "on-chain Safe-owner cross-check defends against stale Tx Service post-removeOwner drift", "prepared → previewed → sent state-machine bridge with sentinel pinned values for safe-typed-data handles"]

key-files:
  created:
    - src/tools/prepare_safe_tx_approve.ts
    - src/tools/submit_safe_tx_signature.ts
    - test/prepare-safe-tx-approve.test.ts
    - test/submit-safe-tx-signature.test.ts
  modified:
    - src/clients/safe-tx-service.ts
    - src/signing/handle-store.ts
    - src/signing/error-codes.ts
    - src/tools/register-all.ts
    - test/clients-safe-tx-service.test.ts

key-decisions:
  - "Server-side ECDSA recovery via viem.recoverAddress over RAW 32-byte safeTxHash (NOT personal_sign-wrapped — RESEARCH Pitfall 8)"
  - "v-byte gate BEFORE recovery refuses v ∈ {0, 1} as INVALID_SIGNATURE_MODE; v ∈ {27, 28, 31, 32} accepted (RESEARCH Pitfall 6)"
  - "submit_safe_tx_signature internally bridges prepared → previewed → sent for safe-typed-data handles (no preview_send routing for off-chain typed-data)"
  - "Cache invalidation invalidates BOTH the verbatim-cased key AND the lowercased key for defense-in-depth against mixed-case mismatch"
  - "findHandlesBySafeTxHash iterates store Map directly with no _handles ESM-spy indirection (CONTEXT lock — one consumer, leaf read)"

patterns-established:
  - "Pre-flight pre-POST defense ordering: v-byte gate → ECDSA recovery → paired-wallet check → on-chain owner check → handle correlation → POST. Each layer refuses with `fetch not called` assertion."
  - "6-arm DU extension of 5-arm shape: `duplicate` is HTTP 200 idempotent re-post; `ok` is HTTP 201 first post. Tool layer surfaces `duplicateRePost: true` informationally."
  - "Cancel path: userDecision arg required by schema; cancel arm short-circuits via findHandlesBySafeTxHash → transitionToCancelled — no recovery, no POST, no on-chain read."

requirements-completed: [SAFE-06, SAFE-07]

# Metrics
duration: 23min
completed: 2026-05-27
---

# Phase 37 Plan 37-02: prepare_safe_tx_approve + submit_safe_tx_signature + postSignature — Summary

**ECDSA-recovery + on-chain owner cross-check defenses BEFORE any Tx Service POST, with handle-store correlation gating against payloadFingerprint drift.**

## Performance

- **Duration:** 23 min
- **Started:** 2026-05-27T13:29:59Z
- **Completed:** 2026-05-27T13:53:51Z
- **Tasks:** 3 (all autonomous, all TDD)
- **Files modified:** 5 (+ 4 created)

## Accomplishments

- `postSignature` client method extends Phase 36's safe-tx-service.ts surface with a 6-arm DU (5 + `duplicate` for HTTP 200 idempotent re-post). POST body shape locked: `{"signature":"0x..."}` ONLY — no `owner` / `signatureType` fields on the wire (T-37-15 mitigation). Cache invalidation invalidates the safeTxCache entry on success.
- `prepare_safe_tx_approve` MCP tool: off-chain co-sign entry point. Re-derives the SafeTx hash LOCALLY from on-chain VERSION() + Tx Service-reported fields; refuses `INVALID_INPUT + txServiceDrift` if Tx Service's reported safeTxHash diverges from the recompute (T-37-10 defense against a compromised Tx Service serving a wrong pending SafeTx). domainSeparatorDrift + duplicateSignWarning surface as INFORMATIONAL CHECKS PERFORMED notes (NOT refusals — the local typed-data digest is correct by construction).
- `submit_safe_tx_signature` MCP tool: the load-bearing trust-pipeline surface. Three pre-flight defenses fire BEFORE any network call: (1) v-byte gate refuses v ∈ {0, 1} as INVALID_SIGNATURE_MODE (T-37-13); (2) ECDSA-recover via viem.recoverAddress over RAW 32-byte safeTxHash (NOT personal_sign-wrapped — Pitfall 8); (3) recovered signer cross-checked against the WC paired set (T-37-09) AND on-chain `getOwners()` (T-37-11 against stale Tx Service post-removeOwner). Handle correlation via findHandlesBySafeTxHash → payloadFingerprint recompute → PAYLOAD_FINGERPRINT_DRIFT refusal on mismatch (T-37-14). On success: bridges prepared → previewed → sent with sentinel pinned values + stamps safeTxHash as record.txHash.
- `findHandlesBySafeTxHash` handle-store helper added (direct Map iteration — no `_handles` ESM-spy indirection per CONTEXT lock). Existing state-machine functions (createHandle / lookup / transitionToPreviewed / transitionToSent / transitionToCancelled) BYTE-IDENTICAL.
- `INVALID_SIGNATURE_MODE` + `WRONG_HANDLE_KIND` error codes appended to error-codes.ts (WRONG_HANDLE_KIND reserved for Plan 37-03 send_transaction / preview_send consumers).

## Task Commits

Each TDD task split into RED test commit + GREEN implementation commit:

1. **Task 1: postSignature client method (RED)** — `3f4634b` (test) — 13 new postSignature test cases
2. **Task 1: postSignature client method (GREEN)** — `e7e78de` (feat) — `postSignature` + 6-arm DU + cache invalidation
3. **Task 2: prepare_safe_tx_approve (RED)** — `7da651d` (test) — 16 new approve test cases
4. **Task 2: prepare_safe_tx_approve (GREEN)** — `3c01264` (feat) — MCP tool + register-all
5. **Task 3: submit_safe_tx_signature (RED)** — `c085e8e` (test) — 17 new submit test cases
6. **Task 3: submit_safe_tx_signature (GREEN)** — `2f34db4` (feat) — MCP tool + error codes + findHandlesBySafeTxHash + register-all
7. **Task 3: TS noUncheckedIndexedAccess fix** — `fbb20e2` (fix) — `matches[0]` narrowing via undefined-check (no runtime change)

## PostSignatureResult 6-arm DU shape

```typescript
export type PostSignatureResult =
  | { kind: "ok" }                                          // HTTP 201 first post
  | { kind: "duplicate" }                                   // HTTP 200 idempotent re-post
  | { kind: "not-found" }                                   // HTTP 404
  | { kind: "rate-limited"; message: string; retryAfterMs?: number }  // HTTP 429
  | { kind: "error"; message: string }                       // HTTP 5xx / non-canonical
  | { kind: "unsupported-chain"; chainId: ChainId };        // short-circuit BEFORE fetch
```

URL: `POST {endpoint}/v1/multisig-transactions/{safeTxHash}/confirmations/` — trailing slash required by Django REST router (RESEARCH §3).

Body: exactly `{"signature":"0x..."}`. Server derives owner via server-side ECDSA recovery (T-37-15 — no server-side ownership claim on the wire).

Cache invalidation key shape: `${chainId}:${safeTxHash.toLowerCase()}`. Implemented at `src/clients/safe-tx-service.ts:740-749` — invalidates BOTH the verbatim-cased key AND the lowercased key for defense-in-depth.

## findHandlesBySafeTxHash exported shape

```typescript
export function findHandlesBySafeTxHash(
  chain: ChainId,
  safeAddress: Address,
  safeTxHash: Hex,
): Array<{ handle: string; record: HandleRecord }>;
```

Implementation: `src/signing/handle-store.ts:1284-1308` — iterates internal `store` Map directly. Filters by `tx.txType === "safe-typed-data"` AND `tx.chain === chain` AND case-insensitive equality for safeAddress + safeTxHash. NO `_handles` ESM-spy indirection (CONTEXT lock + per-WARNING 4 resolution: one consumer, leaf read).

## ECDSA-recovery refusal gate code references

- v-byte gate: `src/tools/submit_safe_tx_signature.ts:236-247`
- ECDSA recovery: `src/tools/submit_safe_tx_signature.ts:251-269`
- Paired-Ledger cross-check: `src/tools/submit_safe_tx_signature.ts:274-296`
- On-chain owner cross-check: `src/tools/submit_safe_tx_signature.ts:298-334`
- payloadFingerprint drift gate: `src/tools/submit_safe_tx_signature.ts:367-413`

All four gates refuse BEFORE the postSignature call — verified by `expect(fetch).not.toHaveBeenCalled()` in the corresponding test cases.

## Hand-off surface for Plan 37-03

Plan 37-03 (prepare_safe_tx_execute + 3-step integration test) imports:

- `findHandlesBySafeTxHash` — for resolving the propose/approve handle by (chain, safeAddress, safeTxHash) when assembling execTransaction signatures
- `WRONG_HANDLE_KIND` error code — for the additive refusal arm in `src/tools/send_transaction.ts` + `src/tools/preview_send.ts` when handle.tx.txType === "safe-typed-data" reaches the EVM dispatch path
- `postSignature` for the integration test's propose→submit→approve×N→submit×N→execute flow
- All Fixtures (SAFE-A/B/C/D from Plan 37-01) for byte-identity cross-link across the integration test

## FROZEN-area zero-diff verification

```
$ git diff --stat origin/main -- src/tools/send_transaction.ts src/tools/preview_send.ts
(empty output — zero files touched)
```

Plan 37-01 + 37-02 zero-diff invariant held END-TO-END across the 11 commits. Plan 37-03 holds the only Phase-37 modifications of those two files (WRONG_HANDLE_KIND refusal arm + isSafeExecTransaction sentinel-flag bypass + composite-tx decode arm).

## Tests added

| Layer | File | Δ tests | Notes |
|-------|------|---------|-------|
| Tx Service client | `test/clients-safe-tx-service.test.ts` | +13 | postSignature 6-arm DU (ok/duplicate/not-found/rate-limited/error/unsupported-chain), per-session ceiling shared with read methods, cache invalidation (incl. mixed-case lowercase normalization), AbortController timeout, body byte-shape, lazy bearer auth |
| MCP tool — approve | `test/prepare-safe-tx-approve.test.ts` (NEW) | +16 | Happy path with Fixture SAFE-A cross-link, handle round-trip, PREPARE RECEIPT/LEDGER DISPLAY/CHECKS PERFORMED shape, txServiceDrift refusal (T-37-10), domainSeparatorDrift informational, duplicateSignWarning informational, Tx Service DU dispatch (4 arms), UNSUPPORTED_SAFE_VERSION, non-owner refusal, delegatecall path with SAFE-C cross-link |
| MCP tool — submit | `test/submit-safe-tx-signature.test.ts` (NEW) | +17 | Happy path (no handle / with handle + state transition), recovery-to-non-paired/non-owner refusals BEFORE POST (assert fetch not called), v-byte gate (v=0/1 refused, v=27/28/31 accepted), userDecision cancel path, schema gate, Tx Service DU dispatch (200/404/429/unsupported), PAYLOAD_FINGERPRINT_DRIFT refusal, findHandlesBySafeTxHash filter semantics, Fixture SAFE-A integration anchor |
| **Total** | | **+46 unique** | |

Full suite: **4850 → 4914 passing** (+64 cumulative, +46 unique — the diff is cross-imported fixture tests counted in consumer files). 1 skipped unchanged. `npx tsc --noEmit` exits 0.

## Decisions Made

- **v-byte gate fires BEFORE recovery** — the recovery is moot if the signature mode is unsupported; fail-fast on the cheap check first.
- **Lower the recovery-mismatch threshold to "EITHER paired OR owner"** — both must hold. A recovered signer that's a paired wallet but NOT an on-chain owner is refused (defends against stale paired state); a recovered signer that's an on-chain owner but NOT paired is refused (defends against the agent surreptitiously routing through a different wallet).
- **Cache invalidation invalidates BOTH cased keys** — defense-in-depth against any future caller using mixed-case hashes inconsistently. Cheap O(1) extra delete.
- **submit owns prepared→previewed→sent bridge** — preview_send is the EVM-on-chain trust gate; the Safe-typed-data flow has no broadcast step, so the submit tool internally bridges with sentinel pinned values to keep transitionToSent's contract intact (status === "previewed").
- **postSignature cache invalidation only touches safeTxCache** — the safeInfo cache is unaffected because confirmations live in the per-SafeTx record, not the per-Safe info record.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] TS noUncheckedIndexedAccess narrowing in submit_safe_tx_signature**

- **Found during:** Final `npx tsc --noEmit` verification step.
- **Issue:** `matches[0]` returns `T | undefined` under TS strict mode's noUncheckedIndexedAccess; `if (matches.length > 0)` doesn't propagate to index narrowing. Two sites flagged (cancel arm + handle-correlation arm).
- **Fix:** Renamed to `const target = matches[0]; if (target !== undefined)` — pure narrowing change; runtime behavior unchanged. The `matches.length > 0` guard is equivalent in semantics but TS strict mode can't propagate it.
- **Files modified:** `src/tools/submit_safe_tx_signature.ts`.
- **Verification:** `npx tsc --noEmit` exits 0; submit test suite green (26/26).
- **Committed in:** `fbb20e2`.

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Routine TS-strict-mode satisfaction. No scope creep.

## Issues Encountered

None — the cryptographic-binding chain + handle-store + Tx Service client surfaces composed cleanly from Plan 37-01's primitives. The synthetic ECDSA signer in the submit test file (deterministic 32-byte private key + @noble/curves recovery) gave clean live-signed signatures that recover correctly to the paired-wallet persona, anchoring the full happy-path integration test without test-file flakiness.

One pre-existing flaky test (`test/non-evm-store.eager-init.test.ts > order-of-operations regression`) timed out at 10s when the full suite ran concurrently (CPU saturation across 334 test files) but passes in isolation (4.14s). NOT introduced by this plan; surface for future investigation.

## Known stubs

None. Both prepare_safe_tx_approve and submit_safe_tx_signature emit fully-populated structuredContent from server-computed values (no placeholder text, no hardcoded mock data).

## Threat flags

None new. All Plan 37-02 threat-register entries (T-37-09 / T-37-10 / T-37-11 / T-37-12 / T-37-13 / T-37-14 / T-37-15 / T-37-16 / T-37-17 / T-37-18) are mitigated per the dispositions; no new attack surface introduced beyond the documented register.

## Next plan (37-03) readiness

- `findHandlesBySafeTxHash` available for execTransaction signature assembly resolution
- `WRONG_HANDLE_KIND` error code available for the additive refusal arms in send_transaction + preview_send
- `postSignature` available for the 3-step integration test (propose → submit → approve → submit → execute)
- All Fixtures (SAFE-A/B/C/D) available for byte-identity cross-link across the integration test
- FROZEN-area zero-diff invariant held — Plan 37-03 owns the only Phase-37 modifications of `src/tools/send_transaction.ts` + `src/tools/preview_send.ts`

## Self-Check: PASSED

```
$ ls src/tools/prepare_safe_tx_approve.ts src/tools/submit_safe_tx_signature.ts test/prepare-safe-tx-approve.test.ts test/submit-safe-tx-signature.test.ts
(all 4 created files exist)

$ git log --oneline origin/main..HEAD
fbb20e2 fix(37): satisfy TS noUncheckedIndexedAccess in submit_safe_tx_signature
2f34db4 feat(37): submit_safe_tx_signature + findHandlesBySafeTxHash + INVALID_SIGNATURE_MODE/WRONG_HANDLE_KIND error codes
c085e8e test(37): add failing tests for submit_safe_tx_signature
3c01264 feat(37): prepare_safe_tx_approve MCP tool + register-all extension
7da651d test(37): add failing tests for prepare_safe_tx_approve
e7e78de feat(37): postSignature client method + 6-arm DU + cache invalidation
3f4634b test(37): add failing tests for postSignature client method
(plus Plan 37-01 commits — 11 total ahead of origin/main)

$ git diff --stat origin/main -- src/tools/send_transaction.ts src/tools/preview_send.ts
(empty output — FROZEN-area zero-diff invariant held)

$ npx tsc --noEmit
(exit 0)

$ npx vitest run test/clients-safe-tx-service.test.ts test/prepare-safe-tx-approve.test.ts test/submit-safe-tx-signature.test.ts
Test Files  3 passed (3)
Tests       96 passed (96)
```

---

*Phase: 37-safe-three-step-signing-flow*
*Plan: 02*
*Completed: 2026-05-27*
