---
phase: 26-ltc-scaffolding-lifi-btc-bridging
plan: "01"
subsystem: litecoin
tags: [ltc, ledger, esplora, pairing, read-tools, tdd]
dependency_graph:
  requires: []
  provides: [LTC-PAIR-01, LTC-READ-01, LTC-READ-02]
  affects: [pair_litecoin_ledger, get_litecoin_balance, get_litecoin_tx_history, get_litecoin_fee_estimates]
tech_stack:
  added: []
  patterns: [NEVER-throws discriminated union, ESM spy-affordance indirection, vi.stubGlobal fetch seam, TDD RED/GREEN/REFACTOR]
key_files:
  created:
    - src/chains/litecoin/types.ts
    - src/chains/litecoin/registry.ts
    - src/chains/litecoin/esplora-client.ts
    - src/tools/pair_litecoin_ledger.ts
    - src/tools/get_litecoin_balance.ts
    - src/tools/get_litecoin_tx_history.ts
    - src/tools/get_litecoin_fee_estimates.ts
    - test/litecoin-types.test.ts
    - test/litecoin-esplora-client.test.ts
    - test/pair-litecoin-ledger.test.ts
    - test/get-litecoin-balance.test.ts
    - test/get-litecoin-tx-history.test.ts
    - test/get-litecoin-fee-estimates.test.ts
  modified:
    - src/config/env.ts
    - src/wallet/ledger-btc-transport.ts
    - src/tools/register-all.ts
    - test/ledger-btc-transport.test.ts
decisions:
  - "LTC_NETWORK defined locally (bitcoinjs-lib has no built-in networks.litecoin)"
  - "fetchFeeEstimates calls /v1/fees/recommended not /fee-estimates (litecoinspace.org Pitfall 1)"
  - "getAppConfiguration().name === 'Litecoin' gate added with ASSUMED A1 comment (verify against real device)"
  - "ledger-btc-transport.ts append-only — all LTC additions at end of file"
metrics:
  duration: "~70 minutes"
  completed: "2026-05-22T20:36:48Z"
  tasks_completed: 3
  tasks_total: 3
  files_created: 13
  files_modified: 4
---

# Phase 26 Plan 01: LTC Chains Shelf + Pairing + Read Tools Summary

**One-liner:** Litecoin scaffold — LTC_NETWORK + litecoinspace.org Esplora client (mempool.space fee endpoint) + dual-address Ledger pairing + three MCP read tools, 3024 tests green.

## Tasks Completed

| Task | Name | Commit | Key Files |
|------|------|--------|-----------|
| 1 | LTC chains shelf — types + registry + esplora-client | ebaf243 | src/chains/litecoin/{types,registry,esplora-client}.ts, test/litecoin-{types,esplora-client}.test.ts |
| 2 | pair_litecoin_ledger tool + buildLtcApp transport entry | 8c36e83 | src/tools/pair_litecoin_ledger.ts, src/wallet/ledger-btc-transport.ts (append-only), test/pair-litecoin-ledger.test.ts |
| 3 | LTC read tools — balance + tx history + fee estimates | 6bb65c6 | src/tools/get_litecoin_{balance,tx_history,fee_estimates}.ts, test/get-litecoin-{balance,tx-history,fee-estimates}.test.ts |

## Decisions Made

1. **LTC_NETWORK local definition** — bitcoinjs-lib has no built-in `networks.litecoin`. Defined locally with pubKeyHash=0x30, scriptHash=0x32, bech32="ltc", wif=0xb0, bip32 ext key bytes from the Litecoin protocol spec. All bitcoinjs-lib calls receive this network explicitly (RESEARCH Pitfall 2).

2. **Fee endpoint divergence** — litecoinspace.org (a mempool.space fork) returns HTTP 404 on the Esplora-standard `/fee-estimates` path. The correct endpoint is `/v1/fees/recommended` with a `{ fastestFee, halfHourFee, hourFee, economyFee, minimumFee }` response mapped internally to the standard 5-key shape. The mapping lives in the Esplora client, not the tool layer.

3. **Append-only ledger-btc-transport.ts** — `buildLtcApp`, `LedgerLtcAppNotOpenError`, `LtcApprovalTimeoutError`, `fetchLtcAddresses`, and `_ltcLedgerTransport` appended at end of file with zero modifications to existing BTC symbols. `git diff --stat` shows additions only.

4. **ASSUMED A1 — `config.name === "Litecoin"`** — The exact string returned by `getAppConfiguration()` when the Litecoin Ledger app is open is assumed to be `"Litecoin"`. A `// ASSUMED A1: verify against real device` comment marks the assertion in `fetchLtcAddresses`. The verify-phase must confirm this against a physical device.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Updated verify:true count assertion in ledger-btc-transport.test.ts**
- **Found during:** Task 3 full-suite run
- **Issue:** `test/ledger-btc-transport.test.ts` asserted `verify: true` appears exactly 2 times in non-comment code. Appending `fetchLtcAddresses` (Task 2) added 2 more occurrences (one per LTC `getWalletPublicKey` call), causing the count to be 4.
- **Fix:** Updated the test's expected count from 2 to 4 with an updated comment: "2 for BTC (fetchBtcAddresses) + 2 for LTC (fetchLtcAddresses) — Phase 26".
- **Files modified:** test/ledger-btc-transport.test.ts
- **Commit:** 6bb65c6

## Requirements Satisfied

| Requirement | Status | Evidence |
|-------------|--------|----------|
| LTC-PAIR-01 | DONE | pair_litecoin_ledger returns L-prefix + ltc1q addresses, gates on Litecoin app, saves two records under chain: "litecoin" |
| LTC-READ-01 | DONE | get_litecoin_balance returns litoshi balance + UTXOs via litecoinspace.org |
| LTC-READ-02 | DONE | get_litecoin_tx_history (paginated) + get_litecoin_fee_estimates (/v1/fees/recommended → 5-key) |

## Test Coverage

| Test File | Tests | Status |
|-----------|-------|--------|
| test/litecoin-types.test.ts | 28 | PASS |
| test/litecoin-esplora-client.test.ts | 15 | PASS |
| test/pair-litecoin-ledger.test.ts | 10 | PASS |
| test/get-litecoin-balance.test.ts | 8 | PASS |
| test/get-litecoin-tx-history.test.ts | 7 | PASS |
| test/get-litecoin-fee-estimates.test.ts | 5 | PASS |
| **Full suite** | 3024 | PASS (0 regressions) |

## Threat Flags

No new security-relevant surface not covered by the plan's threat model. All four LTC trust boundaries (agent→MCP, MCP→litecoinspace.org, MCP→Ledger, address validation) have mitigations implemented as planned.

## Known Stubs

None. All tool implementations wire live Esplora data; no hardcoded placeholders.

## Self-Check: PASSED
