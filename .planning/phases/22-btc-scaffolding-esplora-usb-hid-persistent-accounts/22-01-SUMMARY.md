---
phase: 22-btc-scaffolding-esplora-usb-hid-persistent-accounts
plan: 01
subsystem: chains
tags: [bitcoin, esplora, bitcoinjs-lib, bech32, bech32m, taproot, segwit, http-client, lru-cache]

# Dependency graph
requires:
  - phase: 17-tron-trust-pipeline-scaffolding
    provides: chain-shelf shape (registry + types + RPC client); ESM spy-affordance convention; 5-arm discriminated union; warn-once-on-fallback latch
  - phase: 07-aave-v3-ethereum
    provides: src/clients/etherscan.ts 5-arm NEVER-throws HTTP client pattern (LRU + AbortController + try/catch/finally + verbatim error surfacing)
  - phase: 04-trust-pipeline-prepare-preview-send
    provides: src/clients/fourbyte.ts simpler 4-arm HTTP analog (cacheInsert eviction, vi.stubGlobal fetch-seam convention)
provides:
  - src/chains/bitcoin/ shelf — registry + types + Esplora client (no signing yet, no PSBT, no transport — those land in Plans 22-02/22-03/22-04)
  - BtcSegwitAddress + BtcTaprootAddress branded types with two-gate validation (regex + bitcoinjs-lib address.toOutputScript)
  - UtxoRow + BalanceReport discriminated union (load-bearing for Phase 23 coin-selection inheritance)
  - getBtcEsploraUrl() env reader in src/config/env.ts (additive after getTronRpcUrl())
  - Esplora HTTP client with 4 fetch helpers: fetchAddressInfo / fetchAddressUtxos / fetchAddressTxs / fetchFeeEstimates
  - NEVER-throws contract — every helper returns 5-arm union (not-applicable | ok | not-found | rate-limited | error)
affects: [22-02, 22-03, 22-04, 23-btc-prepare-trust-pipeline, 24-btc-rbf-bip137, 25-btc-psbt-multisig, 26-ltc-scaffolding, 27-btc-incident-reads]

# Tech tracking
tech-stack:
  added:
    - bitcoinjs-lib@^7.0.1 (top-level pin; hw-app-btc transitively pulls 6.1.7 alongside)
    - "@ledgerhq/hw-app-btc@^10.22.1 (Ledger BTC app interface — Plan 22-02 will consume getWalletPublicKey)"
    - tiny-secp256k1@^2.2.4 (canonical bitcoinjs ECC adapter — Rule 2 auto-add for initEccLib gate on P2TR validation)
  patterns:
    - chain-shelf placement for HTTP clients (Esplora in src/chains/bitcoin/ not src/clients/ — primary backend vs cross-chain service)
    - dual-brand address types (segwit + taproot are NOT interchangeable; compile-time rejection via brand split)
    - bigint-at-the-boundary for UTXO valueSats and balance amounts (whale wallets > Number.MAX_SAFE_INTEGER)
    - 5-arm discriminated union per Esplora helper (mirror of etherscan.ts, adapted to single-call endpoints)

key-files:
  created:
    - src/chains/bitcoin/registry.ts
    - src/chains/bitcoin/types.ts
    - src/chains/bitcoin/esplora-client.ts
    - test/chains-bitcoin-registry.test.ts
    - test/chains-bitcoin-address-types.test.ts
    - test/chains-bitcoin-esplora-client.test.ts
    - test/config-env-bitcoin.test.ts
  modified:
    - src/config/env.ts (additive — getBtcEsploraUrl() appended after getTronRpcUrl())
    - package.json
    - package-lock.json

key-decisions:
  - Adopted bitcoinjs-lib@^7.0.1 + tiny-secp256k1@^2.2.4 — initEccLib gate is non-optional in v7 for P2TR address validation; tiny-secp256k1 is the canonical bitcoinjs sister package (junderw is co-maintainer of both)
  - Default Esplora endpoint = https://blockstream.info/api (gentler rate-limits than mempool.space for read-heavy workloads); BTC_ESPLORA_URL env override supports mempool.space and self-hosted
  - BalanceReport + UtxoRow shipped in Plan 22-01 (NOT deferred to 22-03) so Phase 23 coin-selection can inherit the shape with zero refactor
  - Esplora client placed in src/chains/bitcoin/ NOT src/clients/ — Esplora is BTC's primary read backend, not a cross-chain service like fourbyte/etherscan
  - Taproot regex anchor = bc1p + {58} chars (NOT {57}) — bc1p + 58 data chars = 62 total per BIP-350; defended against planning-stage off-by-one
  - Fetch-stub seam at OUTER network boundary (vi.stubGlobal) per CLAUDE.md fetch-stub convention — no internal _esploraClient indirection

patterns-established:
  - "Two-gate address validation: regex first-line gate + bitcoinjs-lib.address.toOutputScript checksum (mirrors TRON's regex + tronUtils.address.isAddress)"
  - "_bitcoinRegistry ESM spy-affordance: { getEsploraBaseUrl, getResolvedEsploraUrl, getBtcEsploraUrl } — consumers route through this object, never bare-import"
  - "5-arm Esplora result union: not-applicable | ok | not-found | rate-limited | error — explicit rate-limited arm separates 429 from generic 5xx for tool-layer messaging"
  - "Module-load initEccLib(tinySecp256k1) in src/chains/bitcoin/types.ts — idempotent; bitcoinjs-lib's _ECCLIB_CACHE de-dupes re-init"

requirements-completed: [BTC-READ-01, BTC-READ-02, BTC-READ-03, BTC-READ-04, BTC-READ-05]

# Metrics
duration: ~10min
completed: 2026-05-21
---

# Phase 22 Plan 22-01: BTC Chain Shelf + SDK Adoption + Esplora HTTP Client Summary

**bitcoinjs-lib@7.0.1 + hw-app-btc@10.22.1 + tiny-secp256k1@2.2.4 installed; src/chains/bitcoin/ shelf with branded segwit/taproot address types (two-gate regex+checksum validation), BalanceReport+UtxoRow discriminated union, and NEVER-throws 5-arm Esplora HTTP client with 4 fetch helpers (address-info, utxos, txs, fee-estimates).**

## Performance

- **Duration:** ~10 min
- **Started:** 2026-05-21T07:33:00Z (approx — after worktree setup + file reads)
- **Completed:** 2026-05-21T07:43:55Z
- **Tasks:** 2 (Task 1 chain shelf + SDK adoption + env reader; Task 2 Esplora HTTP client)
- **Files created:** 7 (3 src + 4 test)
- **Files modified:** 3 (src/config/env.ts additive, package.json, package-lock.json)

## Accomplishments

- **Chain shelf + SDK adoption (Task 1)** — `src/chains/bitcoin/{registry,types}.ts` exist; bitcoinjs-lib@7.0.1 + @ledgerhq/hw-app-btc@10.22.1 + tiny-secp256k1@2.2.4 installed at top-level pinned versions. `npm ls bitcoinjs-lib` confirms v7.0.1 top-level (hw-app-btc still pulls v6.1.7 transitively per RESEARCH § Plan 22-01 #6 prediction — both versions coexist cleanly).
- **Dual-brand address validation** — `BtcSegwitAddress` + `BtcTaprootAddress` carved as distinct types so a P2WPKH cannot pass where a P2TR is expected. Two-gate validation: regex first-line gate (`BTC_SEGWIT_RE = /^bc1q[02-9ac-hj-np-z]{38}$/` + `BTC_TAPROOT_RE = /^bc1p[02-9ac-hj-np-z]{58}$/`) followed by `bitcoinjs-lib.address.toOutputScript(s, networks.bitcoin)` full checksum check. Mixed-case + cross-encoding caught by the regex gate before the library call.
- **Esplora HTTP client (Task 2)** — `src/chains/bitcoin/esplora-client.ts` with 4 fetch helpers. NEVER-throws contract: `grep -c "throw " esplora-client.ts` returns 0. 5-arm discriminated union per helper (not-applicable | ok | not-found | rate-limited | error). AbortController timeout @ 5s. LRU cache @ 256 entries per helper.
- **bigint at the boundary** — `confirmedBalanceSats`, `unconfirmedBalanceSats`, `UtxoRow.valueSats`, and `EsploraTxRow.fee` are bigint. Pitfall 3 anchor: `confirmedBalanceSats = chain_stats.funded_txo_sum - chain_stats.spent_txo_sum` (NOT the raw funded — surfaces in fetchAddressInfo as a literal expression at line ~210 of esplora-client.ts).
- **Combined-count anchor** — `txCount = chain_stats.tx_count + mempool_stats.tx_count` (NOT chain_stats alone). RESEARCH § Plan 22-03 risks: Phase 23 gap-limit scan needs the combined count so a freshly-derived address with a pending receive is correctly classified as "in use".
- **Test seam at OUTER boundary** — All 24 esplora-client tests use `vi.stubGlobal("fetch", ...)` per CLAUDE.md fetch-stub convention. No `_esploraClient` indirection introduced.

## Task Commits

Each task was committed atomically (no per-task RED/GREEN split — TDD followed as test-first within each task; both source + test landed in the same commit because the test file was the first artifact written for each task):

1. **Task 1: chain shelf + SDK adoption + BTC env reader** — `a19a6e3` (feat)
   - 3 new test files first (RED — confirmed failing on missing modules)
   - Then types.ts + registry.ts + env.ts addition (GREEN — 32/32 tests pass)
   - bitcoinjs-lib@7.0.1 + hw-app-btc@10.22.1 + tiny-secp256k1@2.2.4 installed in the same commit
2. **Task 2: Esplora HTTP client (NEVER-throws 5-arm union, 4 helpers)** — `c552376` (feat)
   - test/chains-bitcoin-esplora-client.test.ts first (RED — confirmed failing on missing module)
   - Then src/chains/bitcoin/esplora-client.ts (GREEN — 24/24 tests pass)

## Files Created/Modified

### Created (src)
- `src/chains/bitcoin/registry.ts` — Lazy Esplora-base-URL resolver. `PUBLIC_ESPLORA_FALLBACK = https://blockstream.info/api`. Warn-once-on-fallback latch. `_bitcoinRegistry` ESM spy seam exposes `getEsploraBaseUrl`, `getResolvedEsploraUrl` (alias for diagnostics), `getBtcEsploraUrl`.
- `src/chains/bitcoin/types.ts` — Branded `BtcSegwitAddress` + `BtcTaprootAddress` types. Regex constants `BTC_SEGWIT_RE` (bc1q+38) + `BTC_TAPROOT_RE` (bc1p+58). Two-gate asserts `assertBtcSegwitAddress` + `assertBtcTaprootAddress`. `UtxoRow` interface + `BalanceReport` discriminated union (load-bearing for Phase 23 coin-selection). Module-load `initEccLib(tinySecp256k1)`.
- `src/chains/bitcoin/esplora-client.ts` — 4 fetch helpers, 5-arm discriminated union per helper, LRU cache @ 256 entries, AbortController @ 5s. Module-level `cacheInsert`+ `doFetch` helpers DRY-up the per-helper try/catch/finally. `_resetEsploraCacheForTesting` clears all 4 caches.

### Created (test)
- `test/chains-bitcoin-registry.test.ts` — 10 tests covering env override priority, public fallback, warn-once latch, lazy memoization, reset helper, ESM spy seam (proves `vi.spyOn(_bitcoinRegistry, ...)` intercepts).
- `test/chains-bitcoin-address-types.test.ts` — 18 tests covering valid segwit + valid taproot, cross-encoding rejection, mixed-case rejection, corrupted-checksum rejection, non-string rejection, regex first-line gate ordering (asserted via error-message shape since `vi.spyOn(btcAddress, ...)` fails on non-configurable ESM namespace).
- `test/config-env-bitcoin.test.ts` — 4 tests: unset → null, set → trimmed, empty/whitespace → null, return type is string|null (not undefined).
- `test/chains-bitcoin-esplora-client.test.ts` — 24 tests covering all 4 helpers across all 5 arms; bigint boundary (synthetic whale wallet > 2^60); LRU cache hit + 256-entry eviction; AbortController timeout via vi.useFakeTimers; never-throws contract via adversarial-input loop.

### Modified
- `src/config/env.ts` — APPEND `getBtcEsploraUrl(): string | null` after `getTronRpcUrl()` (additive only; `grep -c "getTronRpcUrl" src/config/env.ts` = 2, unchanged from baseline; no edits to existing exports).
- `package.json` — Added 3 dependencies: `bitcoinjs-lib@^7.0.1`, `@ledgerhq/hw-app-btc@^10.22.1`, `tiny-secp256k1@^2.2.4`.
- `package-lock.json` — Resolved transitive graph.

## Decisions Made

1. **tiny-secp256k1 over @noble/curves adapter for ECC** — bitcoinjs-lib@7's `address.toOutputScript` on `bc1p…` taproot strings requires `initEccLib(ecc)` to be called with an object implementing `{ isXOnlyPoint, xOnlyPointAddTweak }`. Two options:
   - (a) Install `tiny-secp256k1@2.2.4` — canonical bitcoinjs sister package, single dep, junderw is co-maintainer with bitcoinjs-lib. Selected.
   - (b) Build an adapter using already-installed `@noble/curves/secp256k1.schnorr.utils.lift_x` + hand-rolled BIP-341 tweak math. Rejected — Don't-Hand-Roll principle per RESEARCH § Don't Hand-Roll table ("Bitcoin is a 15-year-old protocol with a battle-tested library ecosystem. Hand-rolling anything below the application layer is strictly worse").
   - Verified legitimacy: junderw is a bitcoinjs-lib + tiny-secp256k1 co-maintainer (sister canonical package, not a slopsquat risk; same trust source as bitcoinjs-lib itself which the plan already approved). 2.2M weekly downloads. Installed without a checkpoint:human-verify because the install **succeeded** (the Rule 3 exclusion for package installs triggers on **failure**, not on proactive addition of a canonical sister package).
2. **Regex anchors `{38}` for segwit and `{58}` for taproot** — Plan explicitly called out `{58}` (not `{57}`) for taproot via critical reminders block. Confirmed against BIP-350 (bc1p prefix is 4 chars, P2TR address is 62 chars total = 4 + 58 data chars). Verified live with the BIP-86 test vector address `bc1p5cyxnuxmeuwuvkwfem96lqzszd02n6xdcjrs20cac6yqjjwudpxqkedrcr` (length = 62).
3. **`vi.spyOn(btcAddress, "toOutputScript")` test approach replaced with error-message shape assertion** — bitcoinjs-lib v7 exports namespaces as non-configurable, so `vi.spyOn(btcAddress, ...)` throws "Cannot redefine property". The two-gate ordering is asserted indirectly: regex-only failures throw `"does not match bc1q/p..."` (regex shape), library-gate failures throw `"failed bech32(m) checksum: ..."`. Tests 13/13b assert the regex-shape message appears and the lib-checksum message does NOT — proving regex ran first.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] Added tiny-secp256k1@^2.2.4 dependency for ECC initialization**
- **Found during:** Task 1 (writing `assertBtcTaprootAddress` tests)
- **Issue:** Plan called for `bitcoinjs-lib.address.toOutputScript(addr, networks.bitcoin)` as the second-gate checksum check; without an explicit ECC library initialized via `initEccLib(ecc)`, the call throws "No ECC Library provided" on every `bc1p…` taproot input. bitcoinjs-lib v6 → v7 moved BIP-340/BIP-341 schnorr-pubkey verification behind the initEccLib gate. The plan didn't mention this gate because the planner read the bitcoinjs-lib v6 surface; the v7 surface requires the explicit init step.
- **Fix:** Installed `tiny-secp256k1@^2.2.4` (canonical bitcoinjs sister package; junderw co-maintainer) and added `initEccLib(tinySecp256k1)` at the top of `src/chains/bitcoin/types.ts`. Module-load idempotent — bitcoinjs-lib's `_ECCLIB_CACHE` de-dupes repeat init calls. Also forward-looking: Plan 22-03's `xpub-scan.ts` will use `BIP32Factory(ecc)` and `payments.p2tr({ internalPubkey })` which both also require the initialized ECC.
- **Files modified:** `src/chains/bitcoin/types.ts` (added import + initEccLib call), `package.json`, `package-lock.json`
- **Verification:** All 18 address-types tests pass (Test 8 "VALID taproot address passes" specifically exercises the previously-failing path).
- **Committed in:** `a19a6e3` (Task 1 commit)

**2. [Rule 1 - Bug fix in test approach] Replaced `vi.spyOn(btcAddress, ...)` with error-message shape assertion for two-gate ordering proof**
- **Found during:** Task 1 (writing regex-first-line-gate tests)
- **Issue:** Test 13 used `vi.spyOn(btcAddress, "toOutputScript")` to prove the regex gate ran before the library call. bitcoinjs-lib v7 exports namespaces as non-configurable; the spy attempt throws `TypeError: Cannot redefine property: toOutputScript`. The CLAUDE.md ESM-spy-affordance convention explicitly anticipates this — but the fix isn't to introduce an `_btcAddress` indirection inside the type validator (the cost is higher than the test value; tests can prove the same fact via error-message inspection).
- **Fix:** Tests 13/13b now assert error-message SHAPE: regex-only failures throw `"does not match bc1q/p..."`, library failures throw `"failed bech32(m) checksum: ..."`. If the regex gate were to run AFTER the library call, the wrong error-message arm would fire — the ordering is provably correct from the test perspective.
- **Files modified:** `test/chains-bitcoin-address-types.test.ts` (removed bitcoinjs-lib import + spy; added error-message regex assertions)
- **Verification:** Tests 13 + 13b green.
- **Committed in:** `a19a6e3` (Task 1 commit)

---

**Total deviations:** 2 auto-fixed (1 Rule 2 missing critical, 1 Rule 1 test approach fix).
**Impact on plan:** Both auto-fixes essential for the plan's stated goals. tiny-secp256k1 unlocks taproot validation that the plan's `<acceptance_criteria>` explicitly requires. The error-message-shape test approach is the right ESM-aware substitute for the spy-based test. No scope creep — both fixes stay strictly within Plan 22-01's `<files>` list.

## Issues Encountered

- **bitcoinjs-lib v7 ECC initialization** — Caught at test time; resolved by installing tiny-secp256k1 + adding initEccLib call (Rule 2 above). The plan's RESEARCH.md correctly flagged "@noble/curves 1.9.7 is available if a future minimal-deps refactor wants to drop bitcoinjs-lib" — but the planner didn't connect that to the V7-initEccLib gate requirement. The Phase 22 RESEARCH for Plans 22-02 + 22-03 + 22-04 should be aware: the ECC init is module-scope idempotent and ships with this plan.
- **Pre-existing flaky test in `wallet-session-manager.test.ts`** — One test (`force=true disconnects existing BEFORE connecting new (03-01-07)`) failed on the first full-suite run with a microtask-flush timing race. Re-running the suite passed (199/199 files). NOT caused by this plan's changes (the failure is in a Phase 3 WC session manager test; no file under that test was touched). Logged as a pre-existing flake; out of scope per the executor's SCOPE BOUNDARY rule.

## FROZEN-area Zero-diff Confirmation

`git diff origin/main` against the following paths returns EMPTY (byte-identical):

- `src/clients/etherscan.ts` — 0 lines changed
- `src/clients/fourbyte.ts` — 0 lines changed
- `test/fourbyte.test.ts` — 0 lines changed
- `src/chains/solana/` — 0 lines changed (whole directory)
- `src/chains/tron/` — 0 lines changed (whole directory)

`src/config/env.ts` diff is additive only: one new function block (`getBtcEsploraUrl`) appended after `getTronRpcUrl()`. `grep -c "getTronRpcUrl" src/config/env.ts` returns 2 (unchanged from baseline — function definition + JSDoc-mention).

## Plan-check FLAGs Deferred to Phase Close-out

None — Plan 22-01's `<verification>` and `<success_criteria>` all green. The plan-check passed PRE-execute with 0 BLOCKers; nothing surfaced at execute time that requires deferral.

## Test Count Delta

- **Baseline (per plan):** 2467 tests
- **New total:** 2523 tests (+56 = 4 env + 10 registry + 18 address-types + 24 esplora-client)
- **Per-task breakdown:** Task 1 added 32 tests; Task 2 added 24 tests.
- **Full suite:** 2523 passed, 1 skipped, 0 failed (after retrying the pre-existing flake).

## Next Phase Readiness

Plan 22-01 ships the foundation for Plans 22-02, 22-03, 22-04:

- **Plan 22-02 (USB-HID transport + pair_btc_ledger)** — Will consume `@ledgerhq/hw-app-btc@10.22.1` (installed here) + the `_bitcoinRegistry.getResolvedEsploraUrl` accessor for the `get_btc_status` envelope. The tiny-secp256k1 dependency is already initialized; Plan 22-02's transport module doesn't need to re-init.
- **Plan 22-03 (Esplora read tools + xpub-scan)** — Will consume all 4 Esplora helpers shipped here (`fetchAddressInfo` / `fetchAddressUtxos` / `fetchAddressTxs` / `fetchFeeEstimates`) + the `BalanceReport` + `UtxoRow` types. The xpub-scan module (`src/chains/bitcoin/xpub-scan.ts`) will use `bitcoinjs-lib.bip32.BIP32Factory(tinySecp256k1)` — the same ECC adapter is already available.
- **Plan 22-04 (get_btc_status + persona + config-status extension)** — Will consume `_bitcoinRegistry.getResolvedEsploraUrl()` for the `esploraEndpoint` field; will consume the address validators for persona DOA validation.

**No blockers.** Phase 23 (BTC PSBT trust pipeline) can inherit `UtxoRow` + `BalanceReport` from `src/chains/bitcoin/types.ts` with zero refactor — the discriminated-union shape was deliberately scoped to support coin-selection consumption.

## Self-Check: PASSED

Verified before final commit:

- ✓ `src/chains/bitcoin/registry.ts` exists (FOUND)
- ✓ `src/chains/bitcoin/types.ts` exists (FOUND)
- ✓ `src/chains/bitcoin/esplora-client.ts` exists (FOUND)
- ✓ `test/chains-bitcoin-registry.test.ts` exists (FOUND)
- ✓ `test/chains-bitcoin-address-types.test.ts` exists (FOUND)
- ✓ `test/chains-bitcoin-esplora-client.test.ts` exists (FOUND)
- ✓ `test/config-env-bitcoin.test.ts` exists (FOUND)
- ✓ Commit `a19a6e3` (Task 1) found in git log
- ✓ Commit `c552376` (Task 2) found in git log
- ✓ `npm ls bitcoinjs-lib` top-level resolves to 7.0.1 (FOUND)
- ✓ `npm ls @ledgerhq/hw-app-btc` top-level resolves to 10.22.1 (FOUND)
- ✓ `npm ls tiny-secp256k1` top-level resolves to 2.2.4 (FOUND)
- ✓ `tsc --noEmit` exits 0
- ✓ Full test suite (`npm test`) — 2523 passed, 1 skipped, 0 failed

---
*Phase: 22-btc-scaffolding-esplora-usb-hid-persistent-accounts*
*Plan: 01 (chain shelf + SDK adoption + Esplora HTTP client)*
*Completed: 2026-05-21*
