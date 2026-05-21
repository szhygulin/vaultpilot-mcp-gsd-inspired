---
phase: 22-btc-scaffolding-esplora-usb-hid-persistent-accounts
plan: 02
subsystem: wallet
tags: [btc, ledger, usb-hid, pair, segwit, taproot, persistent-account]
requires:
  - 22-01  # chain shelf + bitcoinjs-lib + @ledgerhq/hw-app-btc deps + BTC_ESPLORA_URL env reader
provides:
  - tool:pair_btc_ledger
  - module:src/wallet/ledger-btc-transport
  - api:fetchBtcAddresses
  - api:_btcLedgerTransport (Plan 22-04 status surface)
  - api:VERIFY_ON_DEVICE_BTC_TEMPLATE
  - api:BtcApprovalTimeoutError
affects:
  - src/tools/register-all.ts  # additive import only — pair_btc_ledger.js side-effect
  - test/non-evm-account-store.test.ts  # 5 new dual-bitcoin-record assertions
  - test/non-evm-store.eager-init.test.ts  # 1 new dual-bitcoin-record cold-boot restore
tech-stack:
  added:
    - "@ledgerhq/hw-app-btc (named-arg ctor `new Btc({ transport, currency: \"bitcoin\" })`)"
  patterns:
    - "Per-call USB-HID transport (per-tool open + try/finally close)"
    - "Dual-address fetch in ONE device session (TWO getWalletPublicKey calls in ONE try/finally — NEW vs Solana/TRON single-address)"
    - "Demo-mode-FIRST gate before any transport open (T-DEMO-1 mitigation)"
    - "60s Promise.race timeout via APPROVAL_TIMEOUT_MS"
    - "Locked 5+1 errorCode set per pair tool"
    - "ESM spy-affordance: _transport + _btcLedgerTransport indirection"
    - "5-level BIP-44 path constants pinned + header-comment regression anchor (vs Solana 3-level copy-paste)"
    - "Multi-record-per-chain via (chain, address) tuple upsert — zero schema change to non-evm-account-store"
key-files:
  created:
    - src/wallet/ledger-btc-transport.ts
    - src/tools/pair_btc_ledger.ts
    - test/ledger-btc-transport.test.ts
    - test/pair-btc-ledger.test.ts
  modified:
    - src/tools/register-all.ts
    - test/non-evm-account-store.test.ts
    - test/non-evm-store.eager-init.test.ts
decisions:
  - "Hardcoded `currency: \"bitcoin\"` in _transport.buildBtcApp — Phase 26 LTC sharing decision deferred to Phase 26 plan; single point of change"
  - "verify: true opt-in on BOTH getWalletPublicKey calls — pair-time on-device address confirmation is the whole point of pairing"
  - "Module-local isUserRejection helper copy-pasted from pair_tron_ledger.ts:125-129 — follows existing per-tool duplication convention (same helper also lives in pair_solana_ledger.ts)"
  - "structuredContent.addresses is OBJECT { segwit, taproot } — downstream consumers must NOT assume single-address shape (no Solana/TRON-style `address` field)"
  - "saveAccount called twice (once per address) — multi-record-per-chain via existing PAIR-NEV-03 schema; ZERO schema change to non-evm-account-store.ts"
  - "INPUT_SCHEMA is empty object — no agent input (no derivationSlot widening in Phase 22; deferred to v2.2.x per RESEARCH § Plan 22-02 risks)"
metrics:
  duration: "~12 minutes"
  completed: "2026-05-21"
  tasks_completed: 2
  files_created: 4
  files_modified: 3
  tests_added: 43
  full_suite_after: "2566 passed | 1 skipped"
---

# Phase 22 Plan 22-02: pair_btc_ledger MCP tool + dual-address USB-HID transport — Summary

**One-liner:** Wires `pair_btc_ledger` over `@ledgerhq/hw-app-btc` to derive BOTH segwit (BIP-84, bc1q…) AND taproot (BIP-86, bc1p…) addresses in ONE device session and persist both as sibling records under `chain: "bitcoin"` via the existing PAIR-NEV-* surface with zero schema change.

## Scope

Plan 22-02 is the first device-touching tool of v2.2. It establishes the USB-HID transport pattern for downstream BTC tools (Phase 23 will reuse `_btcLedgerTransport` for PSBT signing). The NEW shape vs Solana / TRON precedent: TWO sequential `getWalletPublicKey` calls in ONE try/finally close (one per script type), surfacing both addresses + both derivation paths in one `pair_btc_ledger` call. The multi-record-per-chain persistence is "free" — `chain: "bitcoin"` was already in the `NonEvmChain` literal union (Phase 11 v2.0 design contract per PAIR-NEV-03), and `saveAccount`'s `(chain, address)` upsert tuple supports multi-record-per-chain by design.

## Tasks Completed

### Task 1 — Ledger BTC USB-HID transport with dual-address fetch in one try/finally

**Commit:** `7b9f28d` — `feat(22-02): Ledger BTC USB-HID transport with dual-address fetch (BTC-PAIR-01)`

Created `src/wallet/ledger-btc-transport.ts` mirroring `src/wallet/ledger-tron-transport.ts` with three divergences:

1. **TWO sequential `getWalletPublicKey` calls in ONE try/finally** — the NEW shape vs analog. `DEFAULT_BTC_SEGWIT_PATH = "84'/0'/0'/0/0"` (BIP-84 → bc1q…) + `DEFAULT_BTC_TAPROOT_PATH = "86'/0'/0'/0/0"` (BIP-86 → bc1p…). Both 5-level BIP-44 paths — same shape as TRON's `"44'/195'/0'/0/0"`; **distinct from Solana's 3-level** `"44'/501'/0'"`. Header comment names the 5-level shape (regression anchor).
2. **`BtcApp` named-arg constructor** — `new BtcApp({ transport: t, currency: "bitcoin" })` (RESEARCH A6). Phase 26 LTC sharing decision deferred.
3. **`getAppConfiguration()` gate FIRST** — maps throw to `LedgerBtcAppNotOpenError` (Pitfall 2 — APDU table overlap with Litecoin). Surfaces `cfg.version` as `appVersion`.

Exports:
- `DEFAULT_BTC_SEGWIT_PATH`, `DEFAULT_BTC_TAPROOT_PATH`, `APPROVAL_TIMEOUT_MS = 60_000`
- `LedgerDeviceNotConnectedError`, `LedgerBtcAppNotOpenError`
- `_transport = { isSupported, list, open, buildBtcApp }` ESM spy seam
- `openTransport()`, `fetchBtcAddresses(segwitPath?, taprootPath?)`
- `_btcLedgerTransport = { fetchBtcAddresses }` per-tool spy seam (Plan 22-04)
- `_resetLedgerBtcTransportForTesting()` no-op for parity

`verify: true` is passed on both `getWalletPublicKey` calls — forces on-device address display at pair time. Path mapping HARDCODED at module scope (BIP-84 → `bech32`, BIP-86 → `bech32m`); NEVER agent input (Pitfall 7).

**Tests created:** `test/ledger-btc-transport.test.ts` — 26 tests covering constants (5-level shape regression anchor), `openTransport` (happy path + 2 error arms), `fetchBtcAddresses` (dual-address fetch + bech32/bech32m prefix invariants + getAppConfiguration ordering + try/finally invariants + transport-close failure paths), `_transport` spy seam, `_btcLedgerTransport` spy seam, source-level grep gates (`bs58` not imported; "5-level" present; `verify: true` count = 2 in non-comment code).

### Task 2 — pair_btc_ledger MCP tool + dual saveAccount + DUAL VERIFY-ON-DEVICE template + register-all wiring + dual-record assertions

**Commit:** `2e3e0e2` — `feat(22-02): pair_btc_ledger MCP tool + dual saveAccount + DUAL VERIFY-ON-DEVICE (BTC-PAIR-01)`

Created `src/tools/pair_btc_ledger.ts` mirroring `src/tools/pair_tron_ledger.ts` with three divergences:

1. **TWO `saveAccount` calls** under `chain: "bitcoin"` — one per address. Both calls share the same `pairedAt` (one device session → one timestamp).
2. **DUAL-address `VERIFY_ON_DEVICE_BTC_TEMPLATE`** const at module scope (SOT). Two `.replace()` calls at use site — `{SEGWIT_ADDRESS}` + `{TAPROOT_ADDRESS}`.
3. **`structuredContent.addresses` is OBJECT** `{ segwit, taproot }`; `structuredContent.derivationPaths` is OBJECT `{ segwit, taproot }`. NO single-address field (PATTERNS § Plan 22-02).

Demo-mode-FIRST gate (T-DEMO-1 mitigation) refuses with `DEMO_MODE_REFUSED` before any `_transport.list` / `openTransport` / `fetchBtcAddresses` invocation. 60s race timer mirror of analog. Module-local `isUserRejection` helper copy-pasted from `pair_tron_ledger.ts:125-129`.

Locked 5+1 errorCode set:
- `DEMO_MODE_REFUSED`
- `LEDGER_NOT_CONNECTED`
- `BITCOIN_APP_NOT_OPEN`
- `USER_REJECTED`
- `APPROVAL_TIMEOUT`
- `INTERNAL_ERROR` (defensive catch-all)

`INPUT_SCHEMA` is empty object (no agent input — transport open is the entire effect). DESCRIPTION explicitly names the dual-address pair shape + demo-mode refusal + on-device dual-confirm requirement (CLAUDE.md tool-descriptions-as-agent-routing-prompts discipline).

**`src/tools/register-all.ts` extension:** additive `import "./pair_btc_ledger.js";` (single line; ZERO change to any existing tool registration).

**`test/non-evm-account-store.test.ts` extension:** 5 new dual-bitcoin-record assertions:
- Two `chain: "bitcoin"` saveAccount calls produce 2 coexisting records
- Calling pair twice (4 saveAccount calls with two distinct tuples) produces EXACTLY 2 records (idempotent upsert)
- Per-record aging — stale segwit does NOT mark sibling taproot stale (independent `staleAccountWarning`)
- removeAccount on one bitcoin record leaves sibling intact
- `chain: "bitcoin"` runtime trace through the NonEvmChain union

**`test/non-evm-store.eager-init.test.ts` extension:** 1 new dual-bitcoin-record cold-boot restore (PAIR-NEV-02 race-defense for multi-record-per-chain — proves zero new init code needed).

**Tests created:** `test/pair-btc-ledger.test.ts` — 11 tests covering demo-mode refusal (T-DEMO-1), happy-path dual-address shape + exact-match VERIFY-ON-DEVICE block + dual saveAccount, all 5+1 errorCode mappings (`LedgerDeviceNotConnectedError` → `LEDGER_NOT_CONNECTED`; `LedgerBtcAppNotOpenError` → `BITCOIN_APP_NOT_OPEN`; APDU 0x6985 → `USER_REJECTED`; 60s timeout → `APPROVAL_TIMEOUT` via fake-timers race; unknown Error → `INTERNAL_ERROR`), DESCRIPTION length gate (CLAUDE.md routing-prompt discipline), INPUT_SCHEMA empty-object shape, register-all.ts side-effect import grep gate, VERIFY_ON_DEVICE_BTC_TEMPLATE SOT verification.

## FROZEN-Area Zero-Diff Confirmation

`git diff origin/main` against each FROZEN path returns 0 lines:

- `src/chains/solana/` — byte-identical
- `src/chains/tron/` — byte-identical
- `src/clients/etherscan.ts` — byte-identical
- `src/clients/fourbyte.ts` — byte-identical
- `src/tools/pair_tron_ledger.ts` — byte-identical
- `src/tools/pair_solana_ledger.ts` — byte-identical
- `src/wallet/non-evm-account-store.ts` — byte-identical (Meta-Decision 1 verified: `"bitcoin"` already in `NonEvmChain` union; multi-record-per-chain is free)
- `src/wallet/session-manager.ts` — byte-identical (WC session manager unrelated to non-EVM cache)
- `src/wallet/ledger-tron-transport.ts` — byte-identical
- `src/wallet/ledger-solana-transport.ts` — byte-identical

## Test Status

- `npx vitest run test/ledger-btc-transport.test.ts test/pair-btc-ledger.test.ts test/non-evm-account-store.test.ts test/non-evm-store.eager-init.test.ts`: **68 tests passed**
- `npm test` (full suite): **2566 passed | 1 skipped** (regression-free)
- `npx tsc --noEmit`: clean

## Deviations from Plan

None — the plan was executed exactly as specified. Two minor implementation-detail choices worth noting:

1. **`verify: true` count test** — initial regex match found 3 occurrences (2 in code + 1 in inline comment). Tightened the grep gate to strip comment lines so the assertion is exactly 2 in non-comment code. This is a test-fixture refinement, not a functional deviation.

2. **Worktree path safety** — initial `Write` calls with absolute paths resolved to the main repo (not the worktree). Fixed by using **relative paths** for all subsequent `Write` / `Edit` calls — the relative path resolves against the worktree's cwd correctly. Documented as a worktree-isolation gotcha (#3099); no code impact.

## Pitfalls Encountered

- **Pitfall 2 (APDU table overlap with Litecoin):** mitigated via `getAppConfiguration()` gate FIRST — verified through ordering test that asserts `getAppConfiguration` is called before either `getWalletPublicKey`.
- **Pitfall 5 (transport handle leak):** mitigated via single `try/finally` wrapping BOTH `getWalletPublicKey` calls — verified through two test cases (close on first-call error + close on second-call error AFTER first succeeds).
- **Pitfall 7 (address-format mismatch):** mitigated by HARDCODED path/format mapping at module scope — verified through `bs58`-import-absence grep gate (the Ledger BTC app returns the address ALREADY ENCODED in the requested format; no client-side bech32 step).
- **Meta-Decision 2 (5-level BIP-44 path regression):** mitigated by 5-level header comment + segment-by-segment shape assertion in constants tests.

## Threat Surface

All STRIDE threats in the plan's `<threat_model>` are mitigated as specified:

| Threat ID | Status | Verified By |
|-----------|--------|-------------|
| T-22-05 (Wrong-app open with overlapping APDUs) | mitigated | `getAppConfiguration()` ordering test; `verify: true` opt-in forces on-device address display |
| T-22-06 (Address-format mismatch) | mitigated | path/format mapping HARDCODED at module scope; never agent input |
| T-22-07 (Persisted record tampering) | mitigated | (already mitigated by Phase 11 PAIR-NEV-* design; defense-in-depth via `verify: true` at pair time) |
| T-22-08 (USB-HID transport handle leak) | mitigated | two `try/finally` close tests covering both `getWalletPublicKey` error paths |
| T-22-09 (Demo-mode reaches device) | mitigated | T-DEMO-1 test asserts zero `fetchBtcAddresses` invocations when `isDemoMode() === true` |
| T-22-10 (5-level path copy-paste regression) | mitigated | header comment names 5-level shape; segment-by-segment constants assertion |
| T-22-11 (chainCode info disclosure) | accepted | chainCode is the public component of BIP-32 xpub per RESEARCH A7; required for downstream xpub-scan |

No new security-relevant surface was introduced outside the threat register.

## Known Stubs

None. Both addresses are wired to the persistent cache via real `saveAccount` calls; VERIFY-ON-DEVICE block is substituted from real device-returned addresses; appVersion flows from real `getAppConfiguration()` output. No mock data flows to the user-facing response.

## Commits

- `7b9f28d` — Task 1 (transport)
- `2e3e0e2` — Task 2 (tool + dual-record extensions + register-all)

## Self-Check: PASSED

- `src/wallet/ledger-btc-transport.ts` — **FOUND**
- `src/tools/pair_btc_ledger.ts` — **FOUND**
- `test/ledger-btc-transport.test.ts` — **FOUND**
- `test/pair-btc-ledger.test.ts` — **FOUND**
- Commit `7b9f28d` — **FOUND** in `git log`
- Commit `2e3e0e2` — **FOUND** in `git log`
- Full suite green (2566 tests passing, 1 skipped)
- tsc clean
- FROZEN-area zero-diff verified across all 10 paths
