---
phase: 18-tron-native-trc20-trust-pipeline
plan: 18-03
subsystem: prepare-tools
tags: [tron, trc20, trust-pipeline, prepare-tool, encoder, decoder, fixture-n]
requires:
  - 18-01
  - 18-02
provides:
  - src/protocols/tron-trc20.ts
  - src/tools/prepare_tron_trc20_send.ts
  - src/tools/register-all.ts (+1 line)
affects:
  - src/tools/register-all.ts
tech_stack:
  added:
    - tronweb@6.3.0 transactionBuilder.triggerSmartContract (TRC-20 ABI-encoded transfer)
    - tronweb@6.3.0 transactionBuilder.extendExpiration (15-min window)
  patterns:
    - ABI-identical TRC-20 calldata (selector 0xa9059cbb + 32-byte address + 32-byte uint256)
    - feeLimit:100_000_000 hardcoded (100 TRX cap per RESEARCH §Topic 3 + CONTEXT D-11)
    - parseTronAmountStrict(amount, decimals, "u256") for TRC-20 decimal-string validation
    - findByAddress() from tron-top-25.ts registry — no MCP round-trip (per CLAUDE.md no-self-call)
    - ESM spy-affordance _tronTrc20 indirection object
key_files:
  created:
    - src/protocols/tron-trc20.ts
    - src/tools/prepare_tron_trc20_send.ts
    - test/protocols-tron-trc20.test.ts
    - test/prepare-tron-trc20-send.test.ts
  modified:
    - src/tools/register-all.ts
decisions:
  - "D-01: rawDataHex from extendExpiration output is the canonical fingerprint preimage"
  - "D-07: parseTronAmountStrict(amount, decimals, 'u256') validates TRC-20 amounts with u256 overflow guard"
  - "D-08: Fixture N consumer re-anchor at test/prepare-tron-trc20-send.test.ts against 0xffa617dd3396eb038869b98e7385aa302e4ff69ed4d7cabe4904370c5015b520"
  - "D-11a: tokenAddress ANY value accepted at prepare; canonical-dispatch-tron allowlist enforced at Plan 18-04 preview (defense-in-depth)"
metrics:
  duration: "~25 minutes"
  completed: "2026-05-20"
  tasks_completed: 5
  tests_added: 38
  tests_total: 2005
---

# Phase 18 Plan 03: `prepare_tron_trc20_send` — TRC-20 Encoder/Decoder + Fixture N Consumer Re-anchor

TRC-20 transfer MCP tool with `TriggerSmartContract` + `transfer(address,uint256)` ABI-encoded calldata, Fixture N fingerprint consumer re-anchor, and decimal-aware amount handling via `findByAddress` registry.

## What Was Built

### `src/protocols/tron-trc20.ts` (new — 248 LOC)

- `encodeTronTrc20Transfer({ tronWeb, from, to, tokenAddress, amount, decimals })` — wraps `transactionBuilder.triggerSmartContract("transfer(address,uint256)", { feeLimit: 100_000_000, callValue: 0 }, ...)` + `extendExpiration(tx, 900)`. Returns `TronTrc20EncodeResult` with `rawDataHex`, `rawDataBytes`, `contractAddress`, `instructionSummary`.
- `decodeTronTrc20Call(transaction)` — manually slices the 136-char data hex: `selector[0..8]` + `to-address[8+24..8+64]` + `amount[8+64..8+128]`. Returns `TronTrc20Decoded` discriminated union. NEVER throws.
- `_tronTrc20` ESM spy-affordance per CLAUDE.md convention.

Key decisions:
- `amount.toString()` passed to tronweb (not bigint) — prevents silent truncation on ABI boundary.
- `unknown` cast via `txUnknown as any` to satisfy `extendExpiration<T extends Transaction>(t: T)` generic — avoids importing internal SDK types.
- `result.result.result === true` nested boolean (confirmed from tronweb@6.3.0 `.d.ts` — `TransactionWrapper.result: { result: boolean }`).

### `src/tools/prepare_tron_trc20_send.ts` (new — 301 LOC)

Input validation order:
1. `tronUtils.address.isAddress(to)` + `tronUtils.address.isAddress(tokenAddress)` (before any state read)
2. `findByAddress(tokenAddress)` registry lookup → INVALID_INPUT on miss (names USDT/USDC/USDD/TUSD set)
3. `parseTronAmountStrict(amount, metadata.decimals, "u256")` → catches fractional-overflow, format, u256-overflow, empty
4. Demo-mode FIRST / real-mode pairing check
5. `_tronRegistry.getTronWeb()` → `_tronTrc20.encodeTronTrc20Transfer`
6. `_tronFingerprint.computeTronPayloadFingerprint({ rawDataBytes })`
7. `PreparedTxTron { kind: "trc20", contractAddress: rawTokenAddress, ... }`
8. `PREPARE_RECEIPT_TRON_TRC20_TEMPLATE` substitution

### `src/tools/register-all.ts` (modified — +1 line)

```typescript
import "./prepare_tron_trc20_send.js";  // Phase 18 Plan 18-03 (TRON-W-02) — TRC-20 transfer
```
Inserted immediately after Plan 18-02's `prepare_tron_native_send` line.

### Tests (38 new tests)

`test/protocols-tron-trc20.test.ts` (17 tests):
- ABI selector `a9059cbb` regression
- `feeLimit:100_000_000 + callValue:0` regression (LOAD-BEARING)
- `extendExpiration(tx, 900)` invocation regression (LOAD-BEARING)
- `amount.toString()` string-not-bigint boundary regression
- Fixture N byte-stability + rawDataBytes length anchor (211 bytes)
- instructionSummary kind:trc20-transfer shape
- Decoder: transfer shape + 4 defensive paths (wrong type, truncated, wrong selector, empty, null)
- `_tronTrc20` ESM spy-affordance intercept

`test/prepare-tron-trc20-send.test.ts` (21 tests):
- Fixture N consumer re-anchor: `payloadFingerprint === "0xffa617dd3396eb038869b98e7385aa302e4ff69ed4d7cabe4904370c5015b520"` (LOAD-BEARING)
- PREPARE RECEIPT verbatim: uses `PREPARE_RECEIPT_TRON_TRC20_TEMPLATE` substitution; raw agent string `"100"` NOT scaled `"100000000"`
- `structuredContent.symbol = "USDT"` + `structuredContent.decimals = 6`
- Decimal-aware: `"100"` → 100_000_000n; `"100.5"` → 100_500_000n; `"0.000001"` → 1n
- `"0.0000001"` (7 fractional digits) → INVALID_INPUT fractional-overflow
- USDD 18-decimal: `"1"` → 1_000_000_000_000_000_000n
- u256-overflow, format, empty INVALID_INPUT kinds
- Token-not-in-registry → INVALID_INPUT
- WALLET_NOT_PAIRED (real mode, empty accounts)
- WRONG_MODE (demo mode, no persona set)
- Demo mode with persona set succeeds, `listAccounts` NOT consulted
- `kind: "trc20"` + `contractAddress` stored in PreparedTxTron handle
- Persona-cycle sender-dependence: fingerprints differ when rawDataBytes differ; `to` arg invariant (CONTEXT D-05b)
- Tool registration verification

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] tronweb `extendExpiration` type-safety via `unknown` cast**
- **Found during:** Task 1 (build)
- **Issue:** `extendExpiration<T extends Transaction>(t: T, n): Promise<T>` requires `T extends Transaction<ContractParamter>` which includes `visible` and `txID` fields. Our narrowed shape lacks these.
- **Fix:** Used `txUnknown as any` double-cast before `extendExpiration`, then re-cast the result to the narrowed shape. Mirrors what production tronweb consumers must do when working with unknown contract shapes.
- **Files modified:** `src/protocols/tron-trc20.ts`
- **Commit:** 7252968

**2. [Rule 1 - Bug] tronweb `triggerSmartContract` result shape**
- **Found during:** Task 1 (build)
- **Issue:** TypeScript typed `result.result` as `{ result: boolean }` (nested), not `boolean`. Plan comment mentioned checking "both shapes defensively" but only the nested shape exists in the `.d.ts`.
- **Fix:** Simplified check to `result.result.result === true` (nested only, matching the actual `.d.ts`). Used `unknown` intermediate cast for `rawResult` to avoid SDK-internal type coupling.
- **Files modified:** `src/protocols/tron-trc20.ts`
- **Commit:** 7252968

**3. [Rule 1 - Bug] Persona-cycle test mock architecture**
- **Found during:** Task 5 (`test/prepare-tron-trc20-send.test.ts`)
- **Issue:** `vi.restoreAllMocks()` called mid-test to swap mocks between "persona A" and "persona B" runs cleared the `vi.fn()` call counts on the mock objects, making the assertion `toHaveBeenCalledTimes(1)` fail with 0.
- **Fix:** Rewrote persona-cycle test to spy on `_tronTrc20.encodeTronTrc20Transfer` directly (via `mockImplementation`) and capture `to`/`from` args per call, returning persona-specific `rawDataBytes`. Cleaner and more direct: spies capture exactly what the plan cares about (D-05b: `to` is invariant, fingerprint differs).
- **Files modified:** `test/prepare-tron-trc20-send.test.ts`
- **Commit:** a4a8299

## Known Stubs

None — all data paths are wired to real registry lookups (`findByAddress`) and real cryptographic computation (`computeTronPayloadFingerprint`).

## Threat Flags

None — no new network endpoints or trust boundaries introduced. The `prepare_tron_trc20_send` tool follows the established prepare-tool pattern: no broadcast, no auth, returns an opaque handle. Layer 0.5 canonical-dispatch-tron allowlist enforcement deferred to Plan 18-04 preview_send (by design — defense-in-depth per D-11a).

## Self-Check: PASSED

| Check | Result |
|-------|--------|
| `src/protocols/tron-trc20.ts` exists | FOUND |
| `src/tools/prepare_tron_trc20_send.ts` exists | FOUND |
| `test/protocols-tron-trc20.test.ts` exists | FOUND |
| `test/prepare-tron-trc20-send.test.ts` exists | FOUND |
| Commit `7252968` (feat) exists | FOUND |
| Commit `a4a8299` (test) exists | FOUND |
| `npm run build` passes | PASSED |
| `npm test` — 2005 tests pass | PASSED |
| FROZEN-area zero-diff | VERIFIED EMPTY |
| register-all.ts diff — 1 additive line | VERIFIED |
