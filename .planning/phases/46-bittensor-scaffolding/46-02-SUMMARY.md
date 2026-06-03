---
phase: 46-bittensor-scaffolding
plan: 02
subsystem: wallet
tags: [bittensor, substrate, polkadot, pairing, ledger, ss58, usb-hid]

# Dependency graph
requires:
  - phase: 46-01
    provides: src/chains/bittensor/ shelf (registry getResolvedRpcUrl, types), non-evm-account-store widened with bittensor, transport shelf
  - phase: 11-solana-scaffolding
    provides: pair_solana_ledger + get_solana_status mirror patterns
provides:
  - "pair_bittensor_ledger: ed25519-coldkey USB-HID pair via PolkadotGenericApp.getAddressEd25519; demo-first refusal; VERIFY-ON-DEVICE block (SS58 verbatim); persist chain:bittensor"
  - "get_bittensor_status: never-errors contract; rpcEndpoint via getResolvedRpcUrl (no live WS connect); 30-day staleAccountWarning"
  - "test/ledger-bittensor-transport.test.ts: _transport-spied transport unit coverage (no real transport)"
affects: [46-03 reads, 47 signing]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Demo-mode FIRST refusal before any USB-HID transport open (T-46-DEMO) — proven by zero _transport invocations"
    - "VERIFY_ON_DEVICE_BITTENSOR_TEMPLATE single-source-of-truth const; tests import + substitute identically (format-fanout-regex-sync)"
    - "Status resolves rpcEndpoint from URL string without getApi() (Pitfall 5) — test asserts getApi never called"

key-files:
  created:
    - src/tools/pair_bittensor_ledger.ts
    - src/tools/get_bittensor_status.ts
    - test/ledger-bittensor-transport.test.ts
    - test/pair-bittensor-ledger.test.ts
    - test/get-bittensor-status.test.ts
  modified:
    - src/tools/register-all.ts

key-decisions:
  - "Reused LedgerDeviceNotConnectedError from ledger-solana-transport.ts (device-absence is chain-agnostic); LedgerBittensorAppNotOpenError is a Bittensor-named sibling (already in the 46-02 transport shelf)"
  - "5-level derivation path slot index 0; full path appears only inside the parenthesized VERIFY-block hint (T-46-LEAK shoulder-surfing defense)"
  - "keyType:\"ed25519\" surfaced in structuredContent + the ed25519-vs-sr25519-coldkey statement in the VERIFY block (TAO-PAIR-01)"

patterns-established:
  - "register-all carve: 46-02 pair/status imports in a distinct contiguous Phase-46 block, separate from where 46-03's read imports land — avoids the 46-02 ∥ 46-03 register-all merge conflict"

requirements-completed: [TAO-PAIR-01, TAO-PAIR-02]

# Metrics
duration: ~20min
completed: 2026-06-03
---

# Phase 46 Plan 02: Bittensor pairing + status Summary

**ed25519 Ledger coldkey pairing for Bittensor over USB-HID via the PolkadotGenericApp class (device returns the SS58 pre-encoded — no client-side re-encode), with demo-first refusal, a VERIFY-ON-DEVICE block, persistence under chain:"bittensor", and a never-errors status tool that resolves rpcEndpoint without opening a WS socket.**

## Performance

- **Duration:** ~20 min
- **Tasks:** 3 (transport unit test + 2 tools + register-all, all in one commit)
- **Files modified:** 6 (5 created, 1 modified)

## Accomplishments
- `pair_bittensor_ledger`: demo-mode FIRST refusal (T-46-DEMO) before any transport open; races `fetchBittensorAddress` against a 60s timer; returns the device-pre-encoded SS58 verbatim plus the `VERIFY_ON_DEVICE_BITTENSOR_TEMPLATE` block (states ed25519 coldkey, distinct from sr25519); persists `chain:"bittensor"`; locked errorCode ladder (LEDGER_NOT_CONNECTED / BITTENSOR_APP_NOT_OPEN / APPROVAL_TIMEOUT / USER_REJECTED / INTERNAL_ERROR)
- `get_bittensor_status`: verbatim mirror of get_solana_status — never errors, 30-day staleAccountWarning, rpcEndpoint via `_bittensorRegistry.getResolvedRpcUrl()` WITHOUT a live connect (Pitfall 5)
- `test/ledger-bittensor-transport.test.ts`: the transport unit test the prior executor was killed before writing — every assertion routes through the `_transport` spy seam (NO real transport / WsProvider / node-hid socket): openTransport-throw on no-device, fetchBittensorAddress SS58-verbatim + finally-close (happy AND error path), version-probe → BITTENSOR_APP_NOT_OPEN
- register-all: 46-02 imports in a distinct Phase-46 block (carve-safe vs 46-03)

## Task Commits

1. **All of 46-02 (transport test + pair + status + register-all)** - `a412b61` (feat)

## Files Created/Modified
- `src/tools/pair_bittensor_ledger.ts` - Pairing tool; demo-first refusal; VERIFY_ON_DEVICE_BITTENSOR_TEMPLATE; ed25519-coldkey statement; saveAccount chain:"bittensor"; locked errorCode ladder
- `src/tools/get_bittensor_status.ts` - Status tool; never-errors; getResolvedRpcUrl (no live connect); 30-day stale
- `test/ledger-bittensor-transport.test.ts` - _transport-spied openTransport-throw + fetchBittensorAddress verbatim + finally-close + app-not-open mapping (5 tests)
- `test/pair-bittensor-ledger.test.ts` - T-46-DEMO zero _transport invocations + happy path + all error mappings (7 tests)
- `test/get-bittensor-status.test.ts` - never-errors + Pitfall-5 getApi-never-called (4 tests)
- `src/tools/register-all.ts` - 46-02 Phase-46 import block

## Decisions Made
- **LedgerDeviceNotConnectedError reuse:** the device-absence condition is chain-agnostic, so the pairing tool imports the existing class from `ledger-solana-transport.ts` (matches how the committed transport shelf already does it). `LedgerBittensorAppNotOpenError` is the Bittensor-named sibling for the app-not-open mapping.
- **No client-side SS58 re-encode:** the device returns the address PRE-ENCODED under prefix 42 via `getAddressEd25519`; the handler surfaces it verbatim (the key divergence from Solana's raw-pubkey + bs58.encode path). `grep -c "bs58\|encodeAddress" src/tools/pair_bittensor_ledger.ts` === 0.

## Deviations from Plan
None — plan executed exactly as written. The transport shelf (Task 1's `src/wallet/ledger-bittensor-transport.ts`) and the SS58 vector test (`test/chains-bittensor-ss58.test.ts`) were already committed in the partial 46-02 commit (91c5747); this plan completed the remaining Task 1 transport unit test plus Tasks 2-3.

## Threat Surface Scan
No new security-relevant surface beyond the plan's threat_model. T-46-DEMO (demo-first refusal), T-46-PATH (5-level path const), T-46-LEAK (slot-index-only VERIFY block), T-46-STATUS (no forced connect) all test-covered.

## User Setup Required
None. Pairing requires a physical Ledger with the Polkadot Generic app at the v2.7 real-Ledger verify-phase; the unit surface is covered via the `_transport` spy.

## Next Phase Readiness
- Pairing + status are live and registered; 46-03 reads depend only on the 46-01 shelf (already complete) and are unblocked.
- FROZEN signing modules byte-identical to origin/main (verified: zero-diff).

## Self-Check: PASSED

All 5 created files present on disk; commit a412b61 present in git log; 50/50 bittensor-scoped tests green; tsc rc=0.

---
*Phase: 46-bittensor-scaffolding*
*Completed: 2026-06-03*
