---
phase: 36
plan: 02
wave: 2
status: complete
completed: 2026-05-27
requirements:
  - SAFE-01
  - SAFE-02
depends_on:
  - 36-01
commits:
  - 318cc41  # feat(36-02): src/chains/safe.ts Singleton state reader
  - f8ea550  # feat(36-02): get_safe_positions
  - d241db1  # feat(36-02): get_safe_transaction + FROZEN-area zero-diff close-out
test_delta:
  pre_phase_36:  4548
  post_36_01:    4605
  post_36_02:    4653
  plan_36_02_net: +48
  files_added: 5
---

# Phase 36 Plan 36-02: Safe positions + Tx detail consumers — Summary

User-visible v2.5 Safe multisig read surface. Three atomic commits compose the
Plan 36-01 foundation (client + SOT + canonical-dispatch arm) with a new
on-chain Singleton state reader and two MCP tools.

## What was built

| Commit | Surface | Files |
|--------|---------|-------|
| 318cc41 | `src/chains/safe.ts` — Singleton state reader (parseAbi + multicall + module enumeration + `_safeChains` ESM spy seam) | `src/chains/safe.ts`, `test/chains-safe.test.ts` |
| f8ea550 | `get_safe_positions` — multi-chain Promise.allSettled fan-out + per-chain 10s AbortController timeout + on-chain truth + drift detection + wallet-not-owner silent-drop | `src/tools/get_safe_positions.ts`, `src/tools/register-all.ts`, `test/integration/safe-positions.test.ts` |
| d241db1 | `get_safe_transaction` — single SafeTx detail + best-effort cached-ABI decode + operation discriminator | `src/tools/get_safe_transaction.ts`, `src/tools/register-all.ts`, `test/integration/safe-get-transaction.test.ts` |

## Tests added/total

| Layer | File | Δ tests | Notes |
|-------|------|---------|-------|
| Chain reader | `test/chains-safe.test.ts` (NEW) | +12 | parseAbi named-returns (Pitfall 10 anchor), SAFE_SENTINEL_MODULES exact literal, multicall 4-call shape, SENTINEL filter + truncation flag (Pitfalls 4 + 5), `_safeChains` ESM spy round-trip |
| Tool — positions | `test/integration/safe-positions.test.ts` (NEW) | +19 | 1-of-1 / 2-of-3 / drift (owners/threshold/version/nonce-stale/unsupported-version) / wallet-not-owner silent drop / multi-chain fan-out / partial 429 degradation / 10s timeout / unsupported-chain / 404→empty / rpcDegraded / module SENTINEL filter / module truncation + cursor / pendingTransactions cap + truncation + total count / **CRITICAL on-chain-values-not-Tx-Service property** (Test 15) / explicit chain narrows / invalid wallet refusal / register-all wiring |
| Tool — transaction | `test/integration/safe-get-transaction.test.ts` (NEW) | +17 | operation="call"+decoded transfer / operation="delegatecall" / cache MISS → null + zero new Etherscan calls / cache not-verified → null / empty calldata short-circuit / cached-ABI selector-not-found → null via try/catch / confirmations `?? []` defensive default / collected<required → isExecutable false / collected>=required → isExecutable true / unsupported-chain isError / not-found isError / rate-limited retry-after / 5xx HTTP status / safeAddress validation / safeTxHash validation / register-all wiring / FROZEN-area zero-diff (Test 18 acceptance gate) |
| **Total** | | **+48** | |

Full suite: **4605 → 4653 passing** (+48), 1 skipped unchanged, 326 → 329 test
files (+3 new files).

## Test trajectory

```
pre-Phase-36:   4548 passing + 1 skipped (324 files)
post-Plan-36-01: 4605 passing + 1 skipped (326 files; +57 / +2)
post-Plan-36-02: 4653 passing + 1 skipped (329 files; +48 / +3)
```

Phase 36 total: **+105 tests, +5 test files**.

## FROZEN-area zero-diff verified

```
$ git diff --stat origin/main -- src/signing/ src/tools/send_transaction.ts src/tools/preview_send.ts test/signing-*.test.ts
(empty output — zero files touched)
```

Cryptographic-binding chain untouched END-TO-END across Plan 36-01 + 36-02.
Phase 36 is read-only — Phase 37 introduces Fixture SAFE-A (EIP-712 typed-data
digest) as the first cryptographic-binding fixture in the v2.5 trust pipeline.

## Multicall3 vs sequential-readContract behavior (RESEARCH § Open Question 3)

`getOnchainSafeInfo` uses `client.multicall({ allowFailure: false })` for the
4-call batch (getOwners / getThreshold / nonce / VERSION). `getEnabledModules`
uses `client.readContract` for the single `getModulesPaginated(SENTINEL, 100)`
call.

**Observed behavior:** the test mock surfaces both shapes — `multicall` accepts
the 4-entry `contracts` array with `allowFailure: false` and returns the
positional `[owners, threshold, nonce, version]` tuple; `readContract` accepts
`functionName: "getModulesPaginated"` with the `[SAFE_SENTINEL_MODULES, 100n]`
args tuple and returns the `[modules, next]` named-tuple destructured at the
caller. Both pass in the unit suite without modification.

**Multicall3 deployment:** viem ships Multicall3 (`0xcA11bde0...`) as a
default-deployed contract on every supported chain — the deterministic deploy
address is present on Ethereum, Arbitrum, Polygon, Base, and Optimism. No
fall-back path needed for Plan 36-02; if a PublicNode fallback path were to
disable Multicall3 dispatch, `client.multicall` would fall through to N
sequential `eth_call`s at higher latency but identical correctness. This wasn't
exercised in the test suite (mocked at the `client.multicall` boundary); manual
verification on PublicNode is deferred to bundled real-Ledger UAT.

## Drift-detection semantic labels — no deviations

Plan-defined labels surfaced verbatim, with no additions or omissions:

| Label | Trigger |
|-------|---------|
| `owners-set-mismatch` | Tx Service owner Set ≠ on-chain owner Set (case-insensitive compare) |
| `threshold-mismatch` | `Number(txService.threshold) !== Number(onchain.threshold)` |
| `version-mismatch` | `txService.version !== onchain.version` (RESEARCH § A7 — string compare preferred over singleton-address) |
| `nonce-stale` | `abs(BigInt(txService.nonce) - onchainNonce) > 3n` (delta up to 3 tolerated) |
| `modules-set-mismatch` | On-chain enabledModules Set ≠ Tx Service modules Set (sentinel-filtered both sides) |
| `unsupported-version` | `onchain.version` starts with `1.0` or `1.1` (CONTEXT lock — pre-v1.3 Safe variants) |

## Deviations from plan

None of substance. Two minor adjustments noted:

1. **EIP-55 normalization vs raw-form test fixtures.** The handler does
   `getAddress()` on every owner address before surfacing it in the row —
   producing EIP-55-canonical casing. The fixture file's `OWNER_A` /
   `OWNER_B` / `OWNER_C` constants are in raw lowercase-friendly form. Test
   assertions compare lowercased on both sides — byte-identity is the actual
   invariant, casing is cosmetic. Documented inline in
   `test/integration/safe-positions.test.ts`.

2. **Test 18 (FROZEN-area zero-diff) implemented as an integration test
   rather than an external acceptance command.** Easier to surface
   regressions as test failures at PR-review time than as a separate CI gate.
   The test executes `git diff --stat origin/main -- <FROZEN paths>` and
   asserts empty output. Same semantic; tighter feedback loop.

## Gotchas / Lessons learned

1. **vitest `vi.spyOn` on ESM exports needs the `_safeChains` indirection.**
   Tests use `vi.spyOn(_safeChains, "getOnchainSafeInfo").mockResolvedValue(...)`
   to inject on-chain reads without standing up a viem PublicClient with a
   mocked multicall. Without the `_safeChains` object, spying on the bare
   `getOnchainSafeInfo` named export would be a no-op (CLAUDE.md
   "ESM spy-affordance" rule). The wrapping object is one line at the file
   foot; the cost of skipping it is a silently-passing test that doesn't spy.

2. **Per-URL routing fetch stub needed endpoint-priority sorting.** The Tx
   Service routes carry overlapping path prefixes: `/safes/{addr}/` is a
   prefix of `/safes/{addr}/multisig-transactions/`. A naive "first-match-
   wins" routing matrix would route pending-tx queries to the safe-info
   handler. Fix: priority bucket `multisig-transactions > /safes/ > /owners/`
   in `buildFetchByUrl`. Future Tx Service integration tests should follow
   the same priority order.

3. **Pitfall 6 — `tx.confirmations ?? []` at every access site.** Two
   places in `get_safe_transaction`: `confirmationsRaw.length` AND
   `confirmationsRaw.map(...)`. Test 8 anchors the un-signed-pending-tx
   shape using `MULTISIG_TX_NO_CONFIRMATIONS_FIXTURE` (Plan 36-01 fixture).

4. **Per-Safe read failures dropped silently — chain leg survives.** When
   one Safe's on-chain read reverts (e.g. self-destructed proxy, unreachable
   RPC chunk), `readOneSafe` catches the failure and returns `null` for
   that row only. The chain leg keeps going. Tested implicitly via the
   wallet-not-owner-drop test (Test 5) — the leg succeeds with an empty
   safes list.

5. **`getCachedEtherscanAbi` cache-only discipline asserted via fetch-spy
   call count.** Test 4 verifies that on cache MISS, `fetch` was called
   exactly ONCE (the Tx Service tx fetch) — zero Etherscan probes from
   inside `get_safe_transaction`. The CONTEXT lock + T-36-14 mitigation
   ("agent populates cache by calling `get_contract_abi` first") is
   regression-anchored.

6. **EIP-55 casing collisions in URL matching require lowercase compare.**
   The handler builds Tx Service URLs with the EIP-55-canonical wallet form;
   test fixtures use raw casing. `buildFetchByUrl` lowercases both sides of
   the substring match. Documented inline.

## Phase 36 ship-readiness — Phase 37 unblocks

The following Phase 37 surfaces are now unblocked by Plan 36-02:

- **EIP-712 typed-data signing flow** — consumes `src/chains/safe.ts`'s
  `getOnchainSafeInfo` (owners + threshold + nonce + version) for domain-
  separator construction. The `version` field is load-bearing for Safe v1.3.0
  vs v1.4.1 domain-separator selection (different `EIP712Domain` shape).
- **`prepare_safe_tx_propose` / `_approve` / `_execute`** — consumes the
  canonical-dispatch Safe arm (Plan 36-01) for Layer 0.5 gate; Plan 36-02
  surface ensures the agent has a tested read path to discover the Safe
  before proposing against it.
- **Phase 38 hard-trigger (`enableModule` + `delegateCall`)** — consumes
  `get_safe_positions`'s `enabledModules[]` + sentinel-filter discipline +
  truncation flag, AND `get_safe_transaction`'s `operation: "call" |
  "delegatecall"` semantic string. The Inv #12.5 second-LLM check reads
  both surfaces verbatim.
- **Trust-pipeline foundation** — the on-chain cross-check (CRITICAL Test
  15: response fields come from on-chain spy returns, NOT Tx Service spy
  returns) is now load-bearing-tested. The v2.5 milestone defensibility
  rests on this property.

## Self-Check: PASSED

All claimed files exist; all 3 commit hashes resolve in git log.

```
$ [ -f src/chains/safe.ts ] && echo FOUND
FOUND
$ [ -f src/tools/get_safe_positions.ts ] && echo FOUND
FOUND
$ [ -f src/tools/get_safe_transaction.ts ] && echo FOUND
FOUND
$ [ -f test/chains-safe.test.ts ] && echo FOUND
FOUND
$ [ -f test/integration/safe-positions.test.ts ] && echo FOUND
FOUND
$ [ -f test/integration/safe-get-transaction.test.ts ] && echo FOUND
FOUND
$ git log --oneline | grep -E "318cc41|f8ea550|d241db1"
d241db1 feat(36-02): get_safe_transaction — single Safe-tx detail + cached-ABI decode + FROZEN-area zero-diff close-out
f8ea550 feat(36-02): get_safe_positions — multi-chain fan-out + on-chain truth + drift detection
318cc41 feat(36-02): src/chains/safe.ts Singleton state reader (multicall + module enumeration)
$ git diff --stat origin/main -- src/signing/ src/tools/send_transaction.ts src/tools/preview_send.ts test/signing-*.test.ts
(empty output — FROZEN-area zero-diff held)
```
