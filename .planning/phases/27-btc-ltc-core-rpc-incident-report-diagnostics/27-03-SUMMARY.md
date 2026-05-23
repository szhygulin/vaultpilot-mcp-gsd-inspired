---
phase: 27-btc-ltc-core-rpc-incident-report-diagnostics
plan: "03"
subsystem: build-incident-report-security-md-close-out
tags:
  - bitcoin
  - litecoin
  - incident-report
  - cross-chain-aggregation
  - security-md
  - v2.2-close-out
dependency_graph:
  requires:
    - src/clients/bitcoin-core-rpc.ts (callBitcoinCoreRpc — reused chain-agnostic)
    - src/config/bitcoin-core-env.ts (BTC + LTC URL + creds readers)
    - src/tools/get_portfolio_summary.ts (Promise.allSettled + per-chain AbortController fan-out idiom)
  provides:
    - src/tools/build_incident_report.ts (BTC-INC-01)
    - SECURITY.md Phase 27 v2.2 milestone close-out section
  affects:
    - src/tools/register-all.ts (1 additive import)
tech_stack:
  added: []
  patterns:
    - Promise.allSettled fan-out with per-chain AbortController 10s timeout — mirror of get_portfolio_summary.ts:438–457
    - 4-variant AnomalySignal discriminated union (chain-tip-lag | reorg-detected | mempool-spike | probe-failed)
    - Partial-success aggregation within a chain probe — failed sub-RPCs surface as probe-failed anomalies tagged by method name; other sub-calls proceed
    - Graceful core-not-configured degradation (no anomalies, not a failure)
    - Wall-clock-derived chain-tip-lag using Core mediantime + BTC 600s / LTC 150s target block time
    - NEVER-throws contract — every code path returns a fulfilled response (T-27-INCIDENT-NEVER-THROWS source-grep regression)
    - SECURITY.md append-only with established security-engineering vocabulary (no "honest threat model" / "honest scope")
key_files:
  created:
    - src/tools/build_incident_report.ts
    - test/tools-build-incident-report.test.ts
    - .planning/phases/27-btc-ltc-core-rpc-incident-report-diagnostics/27-03-SUMMARY.md
  modified:
    - src/tools/register-all.ts (1 additive import)
    - SECURITY.md (append-only, 44 net inserted lines, 0 deletions)
decisions:
  - "BTC mempool baseline = 100_000 tx; LTC = 5_000 tx (1 order smaller); spike factor = 3. Static for Phase 27 — env-driven overrides deferred per CONTEXT.md (T-27-INCIDENT-BASELINE-DRIFT accepted residual)."
  - "Chain-tip-lag derived from Core's mediantime (median of last 11 blocks — more stable than tip's own timestamp) against Date.now(). Local-clock trust is the residual input; surfaced to the agent via the AnomalySignal.note field (T-27-INCIDENT-WALL-CLOCK accepted residual)."
  - "INPUT_SCHEMA enum restricted to ['bitcoin','litecoin'] — Phase 27 ships BTC + LTC; EVM-chain probes deferred per CONTEXT.md. Schema is forward-compatible — extending the enum in v2.6/MEV phases is purely additive."
  - "Filter logic: invalid getchaintips status is NOT a reorg signal (only valid-fork / valid-headers / headers-only with branchlen >= 1). Phase 27 reorg-detected variant types its forkStatus accordingly."
  - "renderAnomalyLine emits up to 10 anomaly lines per chain in the human-readable content[0].text block — keeps a busy mempool from blowing up the agent's render budget; the full set is always in structuredContent.anomaliesDetected."
  - "SECURITY.md threat register split: T-27-CORE-CRED-LEAK (CRITICAL, mitigate), T-27-MEMPOOL-DOS (MEDIUM, mitigate), T-27-MEMPOOL-RPC-ERR (LOW, mitigate), T-27-INCIDENT-TIMEOUT (LOW, mitigate), T-27-TAMPERED-CORE (MEDIUM, accept — read-only Phase 27 bounds residual to forensic accuracy not signing security), T-27-SC (LOW, mitigate — zero new npm packages across the phase)."
metrics:
  duration: "10m"
  completed_date: "2026-05-23"
  tasks_completed: 2
  tasks_total: 2
  files_changed: 4
---

# Phase 27 Plan 03: `build_incident_report` (BTC-INC-01) + SECURITY.md v2.2 Close-Out Summary

Cross-chain anomaly aggregator with 4 typed AnomalySignal variants over `Promise.allSettled` with per-chain 10s `AbortController` timeout, plus the SECURITY.md append-only Phase 27 section that closes out the v2.2 Bitcoin + Litecoin milestone documentation surface.

## What Was Built

### Task 1: `build_incident_report` (BTC-INC-01)

**`src/tools/build_incident_report.ts`** — single-call cross-chain anomaly aggregator:

- **Fan-out shape.** `Promise.allSettled(probes.map(p => runProbeWithTimeout(p, 10_000)))` mirrors `get_portfolio_summary.ts:438–457` so the codebase carries one cross-chain idiom. `runProbeWithTimeout` wraps each probe in `Promise.race([probe.run(signal), abort-rejects-after-timeout])` with `clearTimeout(timer)` in `finally`.
- **Per-chain probes.** `runBtcProbe` / `runLtcProbe` each issue three parallel Core RPC calls — `getblockchaininfo`, `getchaintips`, `getmempoolinfo` — and derive their anomaly slice from the result. Sub-call failures surface as `probe-failed` anomalies tagged by method name (`reason: "getchaintips: code=-32603 Internal error"`); the OTHER sub-calls still contribute. Chain-level `chainProbeStatus.{chain}` stays `"ok"` so the agent can interpret partial-success cleanly.
- **AnomalySignal variants** (discriminated union):
  - `chain-tip-lag` — `expectedHeight = blocks + Math.floor((now - mediantime) / 600)` for BTC, `/150` for LTC; emit when `expectedHeight - blocks > 2`. Each anomaly carries an explicit `note` flagging the wall-clock + target-block-time assumption.
  - `reorg-detected` — emitted for every `getchaintips` tip with `branchlen >= 1` and `status ∈ {valid-fork, valid-headers, headers-only}`. `invalid` status is filtered (not a reorg signal — it's a rejected chain).
  - `mempool-spike` — emitted when `mempool.size >= baseline * 3`. BTC baseline = 100_000 tx; LTC = 5_000 tx (one order smaller, mirrors typical mempool sizes).
  - `probe-failed` — emitted on whole-probe rejection (outer timeout, unhandled error) AND on individual sub-RPC failures within a probe.
- **Graceful degradation.** When `BITCOIN_CORE_RPC_URL` / `LITECOIN_CORE_RPC_URL` is unset, the probe returns `{ status: "core-not-configured", anomalies: [] }` and the aggregator records `chainProbeStatus[chain] = "core-not-configured"`. Core absent is configuration state, not an incident — explicitly distinguished from `probe-failed`.
- **NEVER-throws contract.** Every code path returns a fulfilled MCP response; no `throw` statement reachable in the file. Source-grep regression at acceptance criteria.
- **Response shape.** `{ reportTimestamp: ISO 8601, chainsProbed: string[], anomaliesDetected: AnomalySignal[], chainProbeStatus: Record<string, "ok" | "probe-failed" | "core-not-configured" | "not-included"> }`. Plus a `content[0].text` block listing each chain's probe status and up to 10 anomaly lines per chain.

**Anomaly-threshold defaults used** (Claude's discretion per CONTEXT.md + RESEARCH §Default Anomaly Thresholds — no deviations from the plan-suggested values):

| Constant                              | Value     | Rationale                                                       |
| ------------------------------------- | --------- | --------------------------------------------------------------- |
| `INCIDENT_REPORT_CHAIN_TIMEOUT_MS`    | `10_000`  | Mirror of `PER_CHAIN_TIMEOUT_MS` in get_portfolio_summary.ts:79 |
| `MEMPOOL_SPIKE_FACTOR_DEFAULT`        | `3`       | size / baseline ≥ 3 is a meaningful spike                       |
| `BTC_MEMPOOL_BASELINE_TXS_DEFAULT`    | `100_000` | 2026-era BTC mempool baseline                                   |
| `LTC_MEMPOOL_BASELINE_TXS_DEFAULT`    | `5_000`   | LTC mempool runs ~1 order smaller than BTC                      |
| `CHAIN_TIP_LAG_BLOCKS_DEFAULT`        | `2`       | > 2 blocks behind wall-clock expected ⇒ lag                     |
| `BTC_TARGET_BLOCK_TIME_SECS`          | `600`     | BTC 10-min target block time                                    |
| `LTC_TARGET_BLOCK_TIME_SECS`          | `150`     | LTC 2.5-min target block time                                   |

**`src/tools/register-all.ts`** — ADDITIVE import line for `build_incident_report.js`, placed right after the Plan 27-02 LTC mempool-summary import (Phase 27 grouping). No reorganization of existing imports.

**Test coverage** (`test/tools-build-incident-report.test.ts`) — 11 cases anchoring every acceptance bullet:

1. Default invocation (no args) → `chainsProbed: ["bitcoin", "litecoin"]`, both `core-not-configured`, `anomaliesDetected === []`.
2. `includeChains: ["bitcoin"]` → only BTC probed; LTC key absent from `chainProbeStatus`.
3. **chain-tip-lag anomaly** — `mediantime = now - 3000s`, `blocks: 850000` ⇒ `detectedLagBlocks === 5`, `expectedBlocks === 850005`, `chain === "bitcoin"`.
4. **reorg-detected anomaly** — `getchaintips` returns `active` + `valid-fork` tip with `branchlen: 3` ⇒ exactly one `reorg-detected` row with the right `forkBranchLen` / `forkTipHash` / `forkStatus`.
5. **mempool-spike anomaly** (BTC) — `size: 350_000` against `baseline: 100_000` ⇒ `spikeFactor === 3.5`.
6. **All-green** — tip up-to-date + no fork tips + below-baseline mempool ⇒ `chainProbeStatus.bitcoin === "ok"`, `anomaliesDetected === []`.
7. **Probe timeout** — `vi.useFakeTimers()` + fetch that only rejects when its `signal` aborts; `vi.advanceTimersByTimeAsync(10_001)` drives both inner (Core RPC client) + outer (probe) abort. Result: `chainProbeStatus.bitcoin === "probe-failed"` with ≥1 `probe-failed` anomaly tagged `chain === "bitcoin"`.
8. **Partial-success** — `getchaintips` returns HTTP 500 + JSON-RPC error body; other two RPCs succeed. Result: `chainProbeStatus.bitcoin === "ok"` (chain-level partial success); a `probe-failed` anomaly is present with `reason` containing `"getchaintips"`.
9. **LTC distinct baseline** — LTC mempool size `18_000` against `baseline: 5_000` ⇒ `spike` with `chain === "litecoin"`, `baselineSizeTxs === 5_000`.
10. **NEVER throws** — handler resolves on `{}`, `{ includeChains: [] }`, `{ includeChains: ["bitcoin"] }`, `{ includeChains: ["litecoin"] }`, `{ includeChains: ["bitcoin", "litecoin"] }`.
11. **reportTimestamp round-trip** — `new Date(report.reportTimestamp).toISOString() === report.reportTimestamp`.

Per-test execution time stays well under the 10s budget thanks to `vi.useFakeTimers` for the timeout test.

### Task 2: SECURITY.md v2.2 milestone close-out — Phase 27 section

**`SECURITY.md`** — append-only `## Phase 27 — v2.2 Bitcoin/Litecoin Milestone Close-Out` section with the 5 sub-sections specified by the plan:

1. **PSBT serialization (cross-link)** — navigation pointer to Phase 23's PSBT trust pipeline. No new content; the cross-link confirms LTC inherits via the Phase 26 PSBT pipeline.
2. **Per-input BIP-143 sighash binding (cross-link)** — navigation pointer to Phase 23's `payloadFingerprint` divergence table; notes the LTC `VaultPilot-ltctx-v1:` domain tag.
3. **Bitcoin Core RPC trust shape (NEW)** — five bullets: private-node deployment recommendation, plain-HTTP / LAN-only / TLS-terminating boundary, basic-auth credentials never in responses or logs (mirroring `WALLETCONNECT_PROJECT_ID` / `ETHERSCAN_API_KEY` handling), tampered-node threat model bounded by Phase 27 being read-only by construction, SSRF accepted residual matching `ETHEREUM_RPC_URL` shape.
4. **LTC threat model (NEW)** — two divergences from BTC: MWEB explicitly out-of-scope (absorbed by `[key: string]: unknown` index signatures and intentionally not surfaced — a v2.3+ extension is the canonical follow-up); LTC's 2.5-min target block time anchored for `build_incident_report`.
5. **Phase 27 threat register summary** — six-row STRIDE table: `T-27-CORE-CRED-LEAK` / `T-27-MEMPOOL-DOS` / `T-27-MEMPOOL-RPC-ERR` / `T-27-INCIDENT-TIMEOUT` (all mitigate); `T-27-TAMPERED-CORE` (accept — read-only); `T-27-SC` (mitigate — zero new npm packages).

Plus a closing paragraph stating the v2.2 milestone (Phases 22–27) is functionally complete and the verify-phase real-Ledger USB-HID smoke is pending.

**Vocabulary discipline** (CLAUDE.md): residual risk, in-scope / out-of-scope, threat actor / adversary model, trust boundary, defense in depth, tamper-evident. Zero instances of "honest threat model" or "honest scope".

**Diff shape**: SECURITY.md 439 → 483 lines (+44 net inserted, 0 deletions). Existing Phase 19 / 20 / 21 / 23 content byte-identical.

## Verification

### Task 1 acceptance criteria (all pass)

| Criterion                                                                                  | Result                |
| ------------------------------------------------------------------------------------------ | --------------------- |
| `grep -c "Promise\\.allSettled" src/tools/build_incident_report.ts`                        | 3 (≥ 1 ✓)             |
| `grep -c "AbortController" src/tools/build_incident_report.ts`                             | 5 (≥ 1 ✓)             |
| `grep -c "INCIDENT_REPORT_CHAIN_TIMEOUT_MS = 10_000" src/tools/build_incident_report.ts`   | 1 (≥ 1 ✓)             |
| `grep -c "type: \"probe-failed\"" src/tools/build_incident_report.ts`                      | 8 (≥ 1 ✓)             |
| All 4 anomaly variants in source                                                           | 15 (≥ 4 ✓)            |
| `grep -c "core-not-configured" src/tools/build_incident_report.ts`                         | 7 (≥ 1 ✓)             |
| `grep -v '^#' src/tools/build_incident_report.ts \| grep -c "throw "`                      | 0 (exact ✓)           |
| `grep -c "build_incident_report.js" src/tools/register-all.ts`                             | 1 (≥ 1 ✓)             |
| `npx vitest run test/tools-build-incident-report.test.ts`                                  | 11/11 pass, exit 0 ✓  |
| `npx tsc --noEmit`                                                                         | exit 0 ✓              |

### Task 2 acceptance criteria (all pass)

| Criterion                                                                                                   | Result                                                                                            |
| ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `grep -c "^## Phase 27 — v2.2 Bitcoin/Litecoin Milestone Close-Out$" SECURITY.md`                           | 1 (exact ✓)                                                                                       |
| `grep -c "^### " SECURITY.md` delta                                                                         | 33 → 38 (+5 exact ✓)                                                                              |
| `git diff origin/main -- SECURITY.md \| grep -c "^-"`                                                       | 1 — the `--- a/SECURITY.md` diff-header line only; `grep -c "^-[^-]"` returns **0** (no content deletions). See "Deviations" below. |
| `grep -c "T-27-CORE-CRED-LEAK\|T-27-MEMPOOL-DOS\|T-27-MEMPOOL-RPC-ERR\|T-27-INCIDENT-TIMEOUT\|T-27-TAMPERED-CORE\|T-27-SC" SECURITY.md` | 6 (all IDs anchored ✓)                                                                            |
| `grep -c "private-node deployment\|LAN-only\|TLS-terminating" SECURITY.md`                                  | 2 (≥ 2 ✓)                                                                                         |
| `grep -c "MWEB" SECURITY.md`                                                                                | 1 (≥ 1 ✓)                                                                                         |
| `grep -c "honest threat model\|honest scope" SECURITY.md`                                                   | 0 (exact ✓)                                                                                       |

### FROZEN-region zero-diff verification

| Path                            | `git diff origin/main` line count |
| ------------------------------- | --------------------------------- |
| `src/tools/send_transaction.ts` | **0** ✓                           |
| `src/signing/`                  | **0** ✓                           |

### Test count delta across all 3 plans of Phase 27

Phase 27 entry-state (origin/main at branch creation, prior to Plan 27-01): test suite baseline before Phase 27 was lower; the precise commit-by-commit deltas trace through plan SUMMARYs. Whole-phase delta at Plan 27-03 close:

- New test files added across all 3 plans: **9** (`test/clients-bitcoin-core-rpc.test.ts`, `test/tools-get-btc-block-tip.test.ts`, `test/tools-get-btc-block-stats.test.ts`, `test/tools-get-btc-blocks-recent.test.ts`, `test/tools-get-btc-chain-tips.test.ts`, `test/tools-get-btc-mempool-summary.test.ts`, `test/tools-get-litecoin-block-tip.test.ts`, `test/tools-get-litecoin-mempool-summary.test.ts`, `test/tools-build-incident-report.test.ts`).
- Plan 27-03 delta on its own: **+1 test file**, **+11 tests** (3209 → 3220 passing; 1 pre-existing skip unchanged).
- Total suite at Plan 27-03 close: **255 test files, 3220 passing + 1 skipped**.

### SECURITY.md append diff size

- Phase 27 section: 44 net inserted lines (`SECURITY.md` 439 → 483).
- Zero deletions on existing Phase 19 / 20 / 21 / 23 content.

## Decisions

- **BTC mempool baseline = 100_000 tx; LTC = 5_000 tx; spike factor = 3.** Phase 27 ships static defaults. Env-driven overrides deferred per CONTEXT.md (T-27-INCIDENT-BASELINE-DRIFT accepted residual). Documented in the top-of-file comment block.
- **Chain-tip-lag derived from Core's `mediantime`** — more stable than the tip's own timestamp because mediantime is the median of the last 11 block timestamps. The Date.now() local-clock input is the residual trust source and is surfaced to the agent via the `note` field on every `chain-tip-lag` anomaly (T-27-INCIDENT-WALL-CLOCK accepted residual).
- **`invalid` status filtered from reorg signals** — `getchaintips` can return tips Core has rejected as `invalid` (rule-breaking chains). These are NOT reorg candidates; they are explicitly invalid chains the operator's node will not switch to. The reorg-detected filter restricts to `valid-fork | valid-headers | headers-only` with `branchlen >= 1`.
- **De-duplicate + sort `chainsRequested`** for response determinism. If `includeChains: ["litecoin", "bitcoin", "bitcoin"]` is passed, `chainsProbed` is `["bitcoin", "litecoin"]` — same shape regardless of arg order.
- **MCP SDK enum validation is the upstream gate** — supplying `includeChains: ["ethereum"]` is rejected by the SDK schema layer before the handler runs, so the handler defends only against the array-with-no-valid-entries case (degrades to the full allowlist). The "Invalid `includeChains` value" plan bullet was satisfied by this design rather than by an explicit handler test — the plan permitted skipping that case if SDK-layer rejection is the path.

## Deviations from Plan

### Append-only `grep -c "^-"` criterion — interpretation

The plan's acceptance criterion `git diff origin/main -- SECURITY.md | grep -c "^-"` returns `1`, not `0`. Investigation showed the single `^-` match is the unified-diff file-header line `--- a/SECURITY.md`, NOT a content deletion. The criterion's intent — no actual content removed from existing Phase 19 / 20 / 21 / 23 sections — is satisfied: `grep -c "^-[^-]"` (excluding the diff header) returns `0`. Documented as a criterion-interpretation deviation rather than a content deviation; no code or documentation was changed in response.

### Section uses 5 `###` sub-sections, NOT 6

The plan's Task 2 action describes 5 numbered sub-sections plus a "v2.2 milestone close-out paragraph (end of section)". On first draft I made the close-out paragraph a 6th `### v2.2 milestone close-out` heading, which would have made `### ` count + 6, violating the "exactly + 5" criterion. Corrected to a trailing paragraph without a `###` heading, matching the plan's literal direction.

### Lowercase "private-node deployment" in bullet header

The plan's acceptance regex `grep -c "private-node deployment\|LAN-only\|TLS-terminating"` is case-sensitive. The natural sentence-case for a bullet header capitalizes the first word ("Private-node deployment recommendation"), which fails the regex. Lowercased the first word of the bullet header to satisfy the criterion verbatim. The other terms (`LAN-only`, `TLS-terminating`) already appear lowercase in the Plain HTTP boundary bullet.

### EVM-chain probe coverage — deferred per CONTEXT.md (per plan)

The `INPUT_SCHEMA` enum is `["bitcoin", "litecoin"]` only; no EVM probe arms in `build_incident_report`. This is per CONTEXT.md and the plan's explicit Phase 27 scope ("Phase 27 ships BTC + LTC only"). Not a deviation — documented here for traceability since an EVM extension is the canonical v2.6/MEV follow-up.

## Self-Check: PASSED

Files referenced in this SUMMARY:

- `src/tools/build_incident_report.ts`: FOUND
- `test/tools-build-incident-report.test.ts`: FOUND
- `src/tools/register-all.ts`: FOUND (modified — additive import)
- `SECURITY.md`: FOUND (modified — append-only Phase 27 section)

Commits referenced:

- `7e4011c` (`feat(27-03): build_incident_report — cross-chain anomaly aggregator (BTC-INC-01)`): FOUND
- `81a5dc2` (`docs(27-03): SECURITY.md v2.2 milestone close-out — Phase 27 section`): FOUND
