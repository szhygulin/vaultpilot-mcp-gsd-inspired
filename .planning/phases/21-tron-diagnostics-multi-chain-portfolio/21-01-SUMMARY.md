---
phase: 21-tron-diagnostics-multi-chain-portfolio
plan: "01"
subsystem: tron-diagnostics
tags:
  - tron
  - diagnostics
  - setup-status
  - stake-2.0
  - v2.1-milestone-close-out
dependency_graph:
  requires:
    - 17-01  # TRON shelf (tronweb + registry)
    - 17-02  # USB-HID ledger-tron-transport (fetchTronAddress)
    - 17-03  # PAIR-NEV-store TRON record + non-evm-account-store
    - 18-01  # TRON signing primitives shelf
    - 19-03  # Stake 2.0 frozenV2 API surface (tronWeb.trx.getAccount)
  provides:
    - TRON-DIAG-01  # get_tron_setup_status MCP tool
  affects:
    - SECURITY.md  # APPEND-ONLY v2.1 milestone close-out summary
tech_stack:
  added: []
  patterns:
    - Promise.allSettled parallel probe fan-out (mirrors get_portfolio_summary Phase 08-03)
    - ESM spy-affordance _tronLedgerTransport.fetchTronAddress (additive widening of Phase 18 seam)
    - INVALID_INPUT + hintTool refusal pattern (no new error codes; 21-code union FROZEN)
    - Lazy probe (zero RPC at server boot — mirrors v1.4 request_capability + v2.0 SOL-DIAG-01)
key_files:
  created:
    - src/tools/get_tron_setup_status.ts
    - test/get-tron-setup-status.test.ts
  modified:
    - src/wallet/ledger-tron-transport.ts  # _tronLedgerTransport ADDITIVE widening (+fetchTronAddress)
    - src/tools/register-all.ts            # +1 import line (ADDITIVE)
    - test/server-bootstrap.test.ts        # +1 lazy-probe assertion arm (ADDITIVE)
    - SECURITY.md                          # APPEND-ONLY new ## section (no existing lines modified)
decisions:
  - "fetchTronAddress spy seam via _tronLedgerTransport.fetchTronAddress (additive widening of Phase 18 object; cleanest seam per D-06)"
  - "Both Ledger app-version + address come from the SAME fetchTronAddress call (one transport open; D-03a resolved)"
  - "Promise.allSettled for TronGrid + USB-HID probes in parallel (independent failures; mirrors Phase 08-03)"
  - "INVALID_INPUT reused (not a new code) for no-pairing case per 21-code FROZEN union discipline"
metrics:
  duration_minutes: 35
  completed_date: "2026-05-21"
  tasks_completed: 2
  tasks_total: 2
  files_created: 2
  files_modified: 4
  tests_added: 12
  tests_baseline: 2455
  tests_final: 2467
---

# Phase 21 Plan 01: TRON Setup Diagnostic Tool + v2.1 Milestone Close-Out Summary

TRON per-wallet diagnostic tool (`get_tron_setup_status`) with parallel USB-HID + TronGrid probes, Stake 2.0 frozen-resource amounts surfaced separately (Energy + Bandwidth), addressVerified T-PAIRING-DRIFT mitigation, and SECURITY.md v2.1 milestone close-out section.

## Tasks Completed

| Task | Name | Commit | Key Files |
|------|------|--------|-----------|
| 1 | `get_tron_setup_status` MCP tool + lazy-probe boot guarantee | `002a7c7` | `src/tools/get_tron_setup_status.ts`, `test/get-tron-setup-status.test.ts`, `src/wallet/ledger-tron-transport.ts`, `src/tools/register-all.ts`, `test/server-bootstrap.test.ts` |
| 2 | SECURITY.md §6 APPEND-ONLY v2.1 milestone close-out summary | `b5e6b08` | `SECURITY.md` |

## What Was Built

### Task 1: `get_tron_setup_status` MCP tool

New MCP tool implementing the D-01a surface:
```
{ chain: "tron", walletAddress, ledgerTrxAppVersion, walletAddressOnDevice,
  addressVerified, resourceAccountPresent, frozenEnergyAmount,
  frozenBandwidthAmount, rpcDegraded?, deviceStatus? }
```

Key implementation decisions:

- **Three independent probes, parallel via `Promise.allSettled`**: TronGrid `getAccount` (5s timeout) + Ledger USB-HID `fetchTronAddress` (10s timeout). Each degrades independently — TronGrid failure sets `rpcDegraded.reason` + safe defaults; Ledger failure sets `walletAddressOnDevice: null` + `ledgerTrxAppVersion: null` + `deviceStatus.reason`.

- **`fetchTronAddress` already bundles `getAppConfiguration()`** in Phase 17's shelf (one transport open + close). D-03a resolved: `appVersion` comes from the same call as `address`, not a separate round-trip. Both `walletAddressOnDevice` and `ledgerTrxAppVersion` share the same failure surface.

- **`addressVerified = walletAddress === walletAddressOnDevice`** (strict equality). When device probe fails, `walletAddressOnDevice = null`, so `addressVerified = false` — the correct safe default. T-PAIRING-DRIFT mitigation (D-03c).

- **`frozenV2` decoding per D-01d**: entries with `type === "ENERGY"` → `frozenEnergyAmount`; entries with `!type || type === "BANDWIDTH"` → `frozenBandwidthAmount`. Never composite. SUN-unit decimal strings via `String(amount)`.

- **Spy seam**: `_tronLedgerTransport` object widened ADDITIVELY to export `fetchTronAddress` (pre-existing `signTransaction` byte-identical). Tests use `vi.spyOn(_tronLedgerTransport, "fetchTronAddress")`.

- **No new error codes**: INVALID_INPUT reused (21-code union FROZEN per D-06) for the no-pairing case with `hintTool: "pair_tron_ledger"`.

Test coverage: 11 arms covering happy path + addressVerified:false + Bandwidth-only-no-type (D-01d) + both Energy+Bandwidth + empty-frozenV2 + never-touched-account + RPC-fail + USB-HID-fail (×2 — LedgerDeviceNotConnectedError + LedgerTronAppNotOpenError) + explicit-wallet-override + no-pairing-INVALID_INPUT.

Server-bootstrap lazy-probe assertion: `_tronRegistry.getTronWeb` must have 0 calls after server startup (D-02a invariant).

### Task 2: SECURITY.md §6 APPEND-ONLY

Appended `## TRON v2.1 milestone close-out summary` at the END of SECURITY.md. All existing Phase 18/19/20 sub-sections byte-identical (`git diff origin/main -- SECURITY.md | grep "^-[^-]" | wc -l` = 0). `grep -c "^## "` count: 10 → 11 (+1 exactly).

Section contains 5 sub-blocks:
1. Milestone PRs (Phase 17: #83/#84/#88/#91/#92; Phase 18: #97/#98/#99/#100; Phase 19: #106/#107/#108/#109; Phase 20: #113)
2. Trust-shape recap (USB-HID direct broadcast + domain-tagged payloadFingerprint + SHA-256 presignHash + Layer 0.7 asymmetry + extendExpiration(tx, 900))
3. 21-code error union FROZEN (INVALID_INPUT + hintTool canonical adopters)
4. Accepted residual risks (LiFi deferred + SR registry snapshot cadence + v2.1 verify-phase pending)
5. Phase 21 threat register (T-PAIRING-DRIFT + T-RPC-FAILURE-MASKED-AS-EMPTY + T-LEDGER-APP-VERSION-LIES + T-FROZEN)

## Verification Results

- **Full test suite**: 2467 tests pass (baseline 2455; +12 new tests) — 195 test files
- **TypeScript**: `npx tsc --noEmit` clean
- **FROZEN-area zero-diff**: `git diff origin/main -- <33 FROZEN files> | wc -l` = 0
- **SECURITY.md APPEND-ONLY**: 0 removed lines in `git diff origin/main -- SECURITY.md`
- **register-all.ts ADDITIVE**: exactly +1 line, 0 removed

## Deviations from Plan

None — plan executed exactly as written.

The spy-seam decision from the ADDITIVE-WIDENING list (Option B: `_tronLedgerTransport.fetchTronAddress` widening) was chosen over Option A (`_transport` lower-level spies) because it provides a cleaner test surface at the right abstraction level and requires only 5 lines of additive code in `ledger-tron-transport.ts`.

## Known Stubs

None — all data is wired from live probes (TronGrid + Ledger USB-HID). No placeholder values, hardcoded mocks in production code, or "coming soon" fields.

## Threat Flags

None — no new network endpoints, auth paths, or trust boundaries introduced. `get_tron_setup_status` is a READ-ONLY diagnostic tool that does not create handles, does not interact with the trust pipeline, and does not introduce new dispatch allowlist entries.

## Self-Check

**Files exist:**
- `src/tools/get_tron_setup_status.ts`: FOUND (created in Task 1)
- `test/get-tron-setup-status.test.ts`: FOUND (created in Task 1)
- `.planning/phases/21-tron-diagnostics-multi-chain-portfolio/21-01-SUMMARY.md`: FOUND (this file)

**Commits exist:**
- `002a7c7`: feat(21-01): get_tron_setup_status MCP tool + lazy-probe boot guarantee — FOUND
- `b5e6b08`: docs(21-01): SECURITY.md §6 APPEND-ONLY v2.1 milestone close-out summary — FOUND

## Self-Check: PASSED
