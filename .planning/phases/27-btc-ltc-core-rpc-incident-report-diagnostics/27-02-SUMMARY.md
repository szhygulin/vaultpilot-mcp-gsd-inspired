---
phase: 27-btc-ltc-core-rpc-incident-report-diagnostics
plan: "02"
subsystem: btc-ltc-forensics-mempool-config-status
tags:
  - bitcoin
  - litecoin
  - core-rpc
  - mempool
  - diagnostics
  - config-status
dependency_graph:
  requires:
    - src/clients/bitcoin-core-rpc.ts (callBitcoinCoreRpc — chain-agnostic reuse)
    - src/config/bitcoin-core-env.ts (LTC readers added in Plan 27-01)
    - src/chains/litecoin/registry.ts (_litecoinRegistry spy seam — Phase 26)
    - src/tools/get_btc_chain_tips.ts (Core-only refusal pattern reference)
    - src/tools/get_btc_block_tip.ts (2-call sequence + Esplora fallback pattern)
  provides:
    - src/tools/get_btc_mempool_summary.ts (BTC-FORENSIC-05)
    - src/tools/get_litecoin_block_tip.ts (LTC-FORENSIC-01 / tip)
    - src/tools/get_litecoin_mempool_summary.ts (LTC-FORENSIC-01 / mempool)
    - src/tools/get_vaultpilot_config_status.ts (bitcoinCoreConfigured + litecoinCoreConfigured booleans)
  affects:
    - src/tools/register-all.ts (3 additive imports)
tech_stack:
  added: []
  patterns:
    - Core-only refusal envelope with esploraFallbackAvailable:false (mempool tools)
    - feeHistogram literal "not-available-without-getrawmempool" (RESEARCH §PR #21422 anchor)
    - LTC = BTC mirror with parameterized URL/creds + per-chain LITECOIN_CORE_* errorCode prefix
    - Index-signature [key:string]:unknown absorbs MWEB fields (RESEARCH §Pitfall 5)
    - ASSUMED A2 regression anchor — chain field NOT validated (litecoin vs main)
    - Pitfall-6 defense: method-assertion test confirms only getmempoolinfo sent
    - T-27-CORE-CRED-LEAK: URL readers only imported into config-status; _USER/_PASS structurally absent
key_files:
  created:
    - src/tools/get_btc_mempool_summary.ts
    - src/tools/get_litecoin_block_tip.ts
    - src/tools/get_litecoin_mempool_summary.ts
    - test/tools-get-btc-mempool-summary.test.ts
    - test/tools-get-litecoin-block-tip.test.ts
    - test/tools-get-litecoin-mempool-summary.test.ts
  modified:
    - src/tools/get_vaultpilot_config_status.ts (additive — bitcoinCoreConfigured + litecoinCoreConfigured)
    - test/get-vaultpilot-config-status.test.ts (additive — 5 new tests 50-54)
    - src/tools/register-all.ts (3 additive imports)
decisions:
  - "LTC env readers were already present in bitcoin-core-env.ts from Plan 27-01 — Task 1 required no file modification (decision made proactively at Plan 27-01 time)"
  - "ASSUMED A2 (LTC chain field value): tool does NOT validate the chain field from getblockchaininfo; index signature absorbs whatever value LTC Core returns; regression test anchors chain: 'main' is accepted"
  - "litecoinspace.org /blocks/tip/* endpoint shape assumed to mirror Esplora based on mempool.space-fork documentation; same assumption as BTC's ASSUMED A1 (verified at Plan 27-01 time)"
  - "getrawmempool word appears in comments and the feeHistogram literal string — not as an RPC method call; Pitfall-6 defense is structural (method-assertion test) not grep-based"
  - "Per-chain distinct errorCode prefix (LITECOIN_CORE_RPC_ERROR vs BITCOIN_CORE_RPC_ERROR) allows the agent to route diagnostically without string parsing"
metrics:
  duration: "8m"
  completed_date: "2026-05-23"
  tasks_completed: 3
  tasks_total: 3
  files_changed: 9
---

# Phase 27 Plan 02: BTC Mempool Summary + LTC Forensic Mirror + Config-Status Extension Summary

BTC-FORENSIC-05 (mempool census), LTC-FORENSIC-01 (block tip + mempool), and `get_vaultpilot_config_status` extended with `bitcoinCoreConfigured` + `litecoinCoreConfigured` booleans — all under T-27-CORE-CRED-LEAK structural defense.

## What Was Built

### Task 1: `get_btc_mempool_summary` (BTC-FORENSIC-05) + Litecoin Core env readers

**`src/tools/get_btc_mempool_summary.ts`** — BTC-FORENSIC-05:
- Core-only refusal: `esploraFallbackAvailable: false` when `BITCOIN_CORE_RPC_URL` unset
- Calls `getmempoolinfo` ONLY — `getrawmempool` NEVER called (Pitfall-6 defense)
- `feeHistogram: "not-available-without-getrawmempool" as const` anchors RESEARCH §PR #21422 (fee histogram not in Core)
- Returns `{ size, bytes, mempoolminfee, minrelaytxfee, maxmempool, unbroadcastcount, feeHistogram, source }`
- `BITCOIN_CORE_RPC_ERROR / RATE_LIMITED / NETWORK_ERROR` errorCode mapping

**`src/config/bitcoin-core-env.ts`** — LTC readers already present from Plan 27-01. No modification needed.

**Test coverage:** 7 tests including: core-not-configured (esploraFallbackAvailable false), ok path with all fields, feeHistogram literal assertion, HTTP 500 rpc-error, AbortError network-error, credential-scrub (T-27-CORE-CRED-LEAK), method-assertion (only getmempoolinfo sent — Pitfall-6 defense).

### Task 2: LTC forensic mirror tools (LTC-FORENSIC-01)

**`src/tools/get_litecoin_block_tip.ts`** — LTC-FORENSIC-01 / tip:
- Core path: 2-call sequence `getblockchaininfo` → `getblockheader(bestblockhash)` (same Pitfall-1 anchor as BTC)
- Esplora fallback: `_litecoinRegistry.getEsploraBaseUrl() + /blocks/tip/height` + `/blocks/tip/hash` (litecoinspace.org)
- `source: "litecoin-core"` on Core path; `source: "esplora-litecoinspace"` on fallback
- `LITECOIN_CORE_RPC_ERROR / RATE_LIMITED / NETWORK_ERROR` errorCode prefix (distinct from BTC)
- ASSUMED A2: `chain` field NOT validated — `[key: string]: unknown` absorbs whatever LTC Core returns

**`src/tools/get_litecoin_mempool_summary.ts`** — LTC-FORENSIC-01 / mempool:
- Core-only; `esploraFallbackAvailable: false` when `LITECOIN_CORE_RPC_URL` unset
- `GetMempoolInfoResult` with `[key: string]: unknown` absorbs MWEB fields (Pitfall-5 anchor)
- MWEB fields (e.g. `mweb_usage`, `mweb_size`) absorbed but NOT surfaced in response
- Same `feeHistogram` literal and Pitfall-6 defense as BTC counterpart

**Test coverage (10 tests across 2 files):**
- `get_litecoin_block_tip`: Esplora fallback (source=esplora-litecoinspace), Core 2-call sequence, ASSUMED A2 chain='main' anchor, LITECOIN_CORE_RPC_ERROR distinct from BTC prefix, credential-scrub
- `get_litecoin_mempool_summary`: core-not-configured, MWEB field exclusion (injects mweb_usage + mweb_size, asserts absent from sc), rpc-error, credential-scrub, Pitfall-6 method-assertion

### Task 3: `get_vaultpilot_config_status` extension

**`src/tools/get_vaultpilot_config_status.ts`** — additive extension:
- `getBitcoinCoreRpcUrl` + `getLitecoinCoreRpcUrl` imported (URL readers ONLY — `_USER`/`_PASS` structurally absent)
- `bitcoinCoreConfigured = getBitcoinCoreRpcUrl() !== null` and `litecoinCoreConfigured = getLitecoinCoreRpcUrl() !== null` derivations
- Both booleans added to the structured object (adjacent to `btcEsploraConfigured`)
- Both booleans added to the text-block lines (column-aligned with existing peers)
- DESCRIPTION extended: `Returns {…}` enumeration + prose explaining semantics and secret-safety
- `grep -c "getBitcoinCoreRpcUser|getBitcoinCoreRpcPass|getLitecoinCoreRpcUser|getLitecoinCoreRpcPass" src/tools/get_vaultpilot_config_status.ts` → 0 (T-27-CORE-CRED-LEAK structural defense verified)

**Test coverage (5 new tests):**
- Test 50: BTC unset → false
- Test 51: BTC set → true
- Test 52: LTC unset → false
- Test 53: LTC set → true
- Test 54 (LOAD-BEARING): all 8 credential sentinel values absent from `JSON.stringify(structuredContent)` and `content[0].text`; booleans correct

## ASSUMED A2 LTC Chain Field Handling

RESEARCH §Assumption Log A2: LTC Core's `getblockchaininfo` `chain` field may return `"litecoin"` or `"main"` (or another value). Verification was not possible at write time — no LTC Core node available. The implementation does NOT validate the `chain` field. The `[key: string]: unknown` index signature on `GetBlockchainInfoResult` absorbs whatever value is returned. The test "succeeds regardless of chain field value (ASSUMED A2 — index signature absorbs chain: 'main')" is the regression anchor — if LTC Core returns `chain: "main"`, the tool succeeds and returns the tip data.

## litecoinspace.org /blocks/tip/* Endpoint Verification

litecoinspace.org is a mempool.space fork. The `/blocks/tip/height` and `/blocks/tip/hash` endpoints are standard mempool.space/Esplora paths confirmed present in mempool.space documentation and consistent with the litecoinspace.org API documentation. The test stubs these endpoints successfully (same assumption as BTC's ASSUMED A1, verified at Plan 27-01 time for blockstream.info/mempool.space).

## Deviations from Plan

**1. LTC env readers already present** — Plan 27-01 proactively added `getLitecoinCoreRpcUrl/User/Pass()` to `src/config/bitcoin-core-env.ts`. Task 1 required no modification of that file. The plan's instruction "Extend `src/config/bitcoin-core-env.ts` with LTC env readers" was a no-op (already done). This is recorded in the 27-01 SUMMARY as an intentional decision, not a deviation.

**2. `getrawmempool` grep assertion** — The plan's acceptance criterion `grep -c "getrawmempool" src/tools/get_btc_mempool_summary.ts` returns 0 cannot be satisfied alongside `feeHistogram: "not-available-without-getrawmempool" as const` (the literal contains the word). The intent — never calling `getrawmempool` as an RPC method — is enforced by the method-assertion test instead. Both mempool tools have a test that asserts `calledMethods === ["getmempoolinfo"]` and `calledMethods.not.toContain("getrawmempool")`.

## Known Stubs

None — all tools return real data from configured endpoints or structured refusals with `esploraFallbackAvailable: false`.

## Threat Surface Scan

All plan-documented T-27-* threats mitigated:
- **T-27-CORE-CRED-LEAK** (config-status): `grep -c "getBitcoinCoreRpcUser|getBitcoinCoreRpcPass|getLitecoinCoreRpcUser|getLitecoinCoreRpcPass" src/tools/get_vaultpilot_config_status.ts` = 0. Runtime scrub test (Test 54) asserts 8 secret sentinel values absent from both response surfaces.
- **T-27-LTC-CRED-LEAK** (block tip + mempool): per-tool credential-scrub tests assert `JSON.stringify(result).includes(secret) === false`.
- **T-27-MEMPOOL-DOS** (Pitfall-6): `getrawmempool` never called — method-assertion tests in both mempool tools enforce structural Pitfall-6 defense.
- **T-27-LTC-CHAIN-FIELD-DRIFT** (ASSUMED A2): chain field not validated; regression test anchors.
- **T-27-MWEB-FIELD**: MWEB fields absorbed via index signature; test injects fictitious `mweb_*` fields and asserts absent from `structuredContent`.

No new network endpoints, auth paths, or schema changes beyond the plan's threat model.

## Final Metrics

| Metric | Value |
|--------|-------|
| New tool files | 3 |
| Modified files | 3 (register-all.ts, get_vaultpilot_config_status.ts, config-status test — all additive) |
| New test files | 3 |
| New tests | 22 (7 + 10 + 5) |
| Full suite at completion | 254 test files / 3209 tests passed / 1 skipped |
| TypeScript errors | 0 |
| New npm dependencies | 0 |
| FROZEN regions touched | 0 |

## Commits

| Hash | Task | Message |
|------|------|---------|
| 50e1639 | Task 1 | feat(27-02): get_btc_mempool_summary (BTC-FORENSIC-05) + Core env readers extension |
| a933258 | Task 2 | feat(27-02): LTC forensic mirror tools — block tip + mempool summary (LTC-FORENSIC-01) |
| 29a0ffb | Task 3 | feat(27-02): config-status extension — bitcoinCoreConfigured + litecoinCoreConfigured booleans |

## Self-Check: PASSED

- [x] `src/tools/get_btc_mempool_summary.ts` — created
- [x] `src/tools/get_litecoin_block_tip.ts` — created
- [x] `src/tools/get_litecoin_mempool_summary.ts` — created
- [x] `src/tools/get_vaultpilot_config_status.ts` — modified (additive)
- [x] `src/tools/register-all.ts` — modified (3 additive imports)
- [x] `test/tools-get-btc-mempool-summary.test.ts` — created
- [x] `test/tools-get-litecoin-block-tip.test.ts` — created
- [x] `test/tools-get-litecoin-mempool-summary.test.ts` — created
- [x] `test/get-vaultpilot-config-status.test.ts` — modified (5 new tests)
- [x] `grep -c "getBitcoinCoreRpcUser|...|getLitecoinCoreRpcPass" get_vaultpilot_config_status.ts` = 0 (T-27-CORE-CRED-LEAK)
- [x] Commits 50e1639, a933258, 29a0ffb verified in git log
- [x] `npx tsc --noEmit` exits 0
- [x] `npx vitest run` — 254 files / 3209 tests passed
