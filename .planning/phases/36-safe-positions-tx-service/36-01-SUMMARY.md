---
phase: 36
plan: 01
wave: 1
status: complete
completed: 2026-05-27
requirements:
  - SAFE-03
  - SAFE-04
commits:
  - a18f728  # feat(36-01): Safe Tx Service HTTP client
  - 1f47cf0  # feat(36-01): SafeContracts SOT
  - 3e6ce1d  # feat(36-01): canonical-dispatch + safeTxServiceApiKeyPresent
test_delta:
  before: 4548 passing + 1 skipped (324 files)
  after:  4605 passing + 1 skipped (326 files)
  net:    +57 tests, +2 files
---

# Phase 36 Plan 36-01: Safe Tx Service foundation + SafeContracts SOT + canonical-dispatch wiring — Summary

Read-only foundation for v2.5 Safe multisig support. Three atomic commits land
the never-throws Safe Tx Service HTTP client, the `SafeContracts` per-chain
SOT extension (4 singleton variants × 5 chains), and the canonical-dispatch
Safe arm. No live consumers in Plan 36-01 — Wave 2 (Plan 36-02) will compose
all three surfaces.

## Tests added/total

| Layer | File | Δ tests | Notes |
|-------|------|---------|-------|
| Client | `test/clients-safe-tx-service.test.ts` (NEW) | +32 | All 5 DU arms × 4 endpoints, URL migration anchor, v1/v2 path mix, ordering=nonce explicit, per-session ceiling, LRU eviction at 32/64, lazy bearer-token threading, T-SAFE-KEY-LEAK-1 audit |
| SOT | `test/config-contracts.test.ts` (extended) | +10 | Shape, 5-chain population, T-SAFE-CANONICAL-ACROSS-EIP155 byte-identity, EIP-55 round-trip, mainnet singleton spot-check, per-role pair distinctness |
| Dispatch | `test/security-canonical-dispatch-safe.test.ts` (NEW) | +12 | T-SAFE-SINGLETON-DISPATCH-COVERAGE-1 (4×5=20), Pitfall 2 L2-on-L2-chain anchor, refused-baseline sanity, EIP-55 case-insensitive inheritance |
| Dispatch | `test/security-canonical-dispatch.test.ts` (4 count anchors updated) | 0 | 51 → 55 per-chain counts updated; no new tests |
| Config | `test/get-vaultpilot-config-status.test.ts` (extended) | +3 | env unset → false, env set → true, T-SAFE-KEY-LEAK-1 sentinel scan |
| **Total** | | **+57** | |

Full suite: **4548 → 4605 passing** (+57), 1 skipped unchanged, 324 → 326 test files (+2 new files).

## FROZEN-area zero-diff verified

```
$ git diff --stat origin/main -- src/signing/ src/tools/send_transaction.ts src/tools/preview_send.ts test/signing-*.test.ts
(empty output — zero files touched)
```

Cryptographic-binding chain untouched. Phase 36 is read-only — Phase 37 will
introduce Fixture SAFE-A (EIP-712 typed-data digest) as the first
cryptographic-binding fixture in the v2.5 trust pipeline.

## Per-chain canonical-dispatch count bumps

| Chain | Pre-Phase-36 | Phase 36 delta | Post-Phase-36 |
|-------|--------------|----------------|---------------|
| Ethereum (1) | 51 | +4 | 55 |
| Arbitrum (42161) | (smaller — Ethereum-only arms not present) | +4 | (+4) |
| Polygon (137) | (smaller) | +4 | (+4) |
| Base (8453) | (smaller) | +4 | (+4) |
| Optimism (10) | (smaller) | +4 | (+4) |

Safe-deployments canonical-across-eip155: the SAME 4 singleton addresses
(v1.3.0-L1, v1.3.0-L2, v1.4.1-L1, v1.4.1-L2) ship on every supported chain.
Pairwise byte-identity asserted in `T-SAFE-CANONICAL-ACROSS-EIP155`.

## New exports — Plan 36-02 hand-off surface

Plan 36-02 (Wave 2 consumers — `src/chains/safe.ts` + `get_safe_positions` +
`get_safe_transaction`) imports the following from Plan 36-01:

**From `src/clients/safe-tx-service.ts`:**
- `getSafesByOwner(chainId, owner) → SafesByOwnerResult`
- `getSafeInfo(chainId, safe) → SafeInfoResult`
- `getPendingTransactions(chainId, safe, { currentNonce, limit? }) → PendingListResult`
- `getMultisigTransaction(chainId, safeTxHash) → SafeTxResult`
- DU types: `SafesByOwnerResult`, `SafeInfoResult`, `PendingListResult`, `SafeTxResult`
- Wire types: `SafeInfoResponseDecoded`, `SafeMultisigTransactionResponse`, `SafeMultisigConfirmationResponse`
- Test-only resets: `_resetSafeTxServiceCachesForTesting`, `_resetSafeTxServiceRateCounterForTesting`

**From `src/config/contracts.ts`:**
- `interface SafeContracts`
- `getSafeSingletonAddresses(chainId) → Address[]` (up to 4)
- `getSafeProxyFactoryAddresses(chainId) → Address[]` (up to 2)
- `getSafeMultiSendAddresses(chainId) → Address[]`
- `getSafeMultiSendCallOnlyAddresses(chainId) → Address[]`
- `getSafeSignMessageLibAddresses(chainId) → Address[]`
- `getSafeCompatibilityFallbackHandlerAddresses(chainId) → Address[]`

**From `src/config/env.ts`:**
- `getSafeTxServiceApiKey() → string | undefined`

## DU shapes Plan 36-02 pattern-matches against

Each method returns one of FIVE arms (CLAUDE.md never-throws contract):

```typescript
type SafeInfoResult =
  | { kind: "ok"; safe: SafeInfoResponseDecoded }
  | { kind: "not-found" }
  | { kind: "rate-limited"; message: string; retryAfterMs?: number }
  | { kind: "error"; message: string }
  | { kind: "unsupported-chain"; chainId: ChainId };
```

Same shape (with arm-specific payload field) for `SafesByOwnerResult`,
`PendingListResult`, `SafeTxResult`. Plan 36-02 maps `not-found` from
`getSafesByOwner` to `{ safes: [] }` at the orchestration tier (Pitfall 7 —
Tx Service "no safes" indistinguishable from indexer lag without on-chain
probe).

## Deviations from plan

None of substance. Two minor adjustments noted:

1. **Test 10 (per-session ceiling) regex** — initial assertion regex
   `/per-session limit \(30\) exceeded/` missed the literal " calls" between
   `(30` and `)`. Fixed during Task 1 (1-character regex update). Caught at
   first test run; no commit churn beyond the in-task fix.

2. **Doc-comment per-chain count format** — RESEARCH § Pitfall stated
   "Ethereum 40→44, Arbitrum 21→25, …" but the existing doc-comment did not
   carry the absolute pre-Phase-36 counts for the L2 chains (only Ethereum
   had a hard-pinned 40). The doc-comment now describes the uniform +4
   delta per chain rather than absolute counts (canonical-across-eip155
   makes the per-chain absolutes a function of pre-Phase-36 chain state).
   The 4 pre-existing absolute count assertions for Ethereum in
   `test/security-canonical-dispatch.test.ts` were updated from 51 → 55
   (regression anchor preserved).

## Gotchas / Lessons learned

1. **`getSafesByOwner` cache space-sharing with `getSafeInfo`** — both keys
   live in `safeInfoCache` (distinct keyspace: `owner:${chainId}:${owner}`
   vs `${chainId}:${safe}`). Plan 36-01 documents this in the cache-scheme
   header comment. Plan 36-02 consumers should not assume the cache is
   single-purpose.

2. **`getPendingTransactions` deliberately not cached** — the nonce window
   changes frequently and a single pinned entry would surface stale data.
   Per-session counter still consumes a slot on every call. Plan 36-02
   `get_safe_positions` should hit this endpoint at most once per Safe
   per request (no retry loops).

3. **`confirmations` field is OPTIONAL on the wire (Pitfall 6)** — the
   client preserves `undefined` verbatim; Plan 36-02 consumers do
   `tx.confirmations ?? []` at use site.

4. **Numeric strings preserved (Pitfall 3)** — `nonce`, `value`, `safeTxGas`,
   `baseGas`, `gasPrice` arrive as JSON strings from the Tx Service. Plan
   36-02 consumers `BigInt(...)` at use site when comparing to on-chain
   bigint values from `client.multicall`.

5. **L2 singletons dominate on L2 chains (Pitfall 2)** — the property test
   `Pitfall 2 anchor: checkDispatchTarget allows v1.3.0-L2 on Polygon`
   captures the dominant-variant case. Phase 37 prepare-flow must NOT
   assume the L1 variant on non-Ethereum chains.

## Self-Check: PASSED

All claimed files exist; all 3 commit hashes resolve in git log.

```
$ [ -f src/clients/safe-tx-service.ts ] && echo FOUND
FOUND
$ [ -f src/config/contracts.ts ] && echo FOUND
FOUND  (extended)
$ [ -f src/security/canonical-dispatch.ts ] && echo FOUND
FOUND  (extended)
$ [ -f src/tools/get_vaultpilot_config_status.ts ] && echo FOUND
FOUND  (extended)
$ [ -f src/config/env.ts ] && echo FOUND
FOUND  (extended)
$ [ -f test/clients-safe-tx-service.test.ts ] && echo FOUND
FOUND
$ [ -f test/fixtures/safe-tx-service-responses.ts ] && echo FOUND
FOUND
$ [ -f test/security-canonical-dispatch-safe.test.ts ] && echo FOUND
FOUND
$ git log --oneline | grep -E "a18f728|1f47cf0|3e6ce1d"
3e6ce1d feat(36-01): wire Safe singletons into canonical-dispatch + surface safeTxServiceApiKeyPresent
1f47cf0 feat(36-01): SafeContracts SOT — 4 singleton variants × 5 chains + per-role getters
a18f728 feat(36-01): Safe Tx Service HTTP client (never-throws 5-arm DU, dual LRU, lazy bearer auth)
```
