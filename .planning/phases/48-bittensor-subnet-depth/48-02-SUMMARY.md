---
phase: 48-bittensor-subnet-depth
plan: 02
subsystem: api
tags: [bittensor, subtensor, validator-enrichment, delegate-info, identitiesV2, dtao, read]

# Dependency graph
requires:
  - phase: 47-bittensor-trust-pipeline
    provides: getValidators (getNeuronsLite lite shape) + normalizeTakePercent + BittensorRpcError + _bittensorRegistry spy seam + decodeByteString/toBigIntSafe helpers
provides:
  - getValidators enriched with delegate identity name + take% + per-netuid registeredNetuids
  - isHotkeyRegisteredOnNetuid(hotkey, netuid) read helper (getNeuronsLite presence)
  - get_bittensor_validators tool surfacing identity + take% + registeredNetuids (deferral language removed)
affects: [48-03]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Best-effort per-hotkey enrichment: getDelegate-None / empty identitiesV2 degrade to null, never error (OQ-1)"
    - "Per-netuid registration signal = getNeuronsLite presence test (OQ-2)"

key-files:
  created:
    - test/get-bittensor-validators-enrichment.test.ts
  modified:
    - src/chains/bittensor/tao-rpc-client.ts
    - src/tools/get_bittensor_validators.ts

key-decisions:
  - "Enrich the enumerated permit-holder set eagerly (research discretion); per-hotkey enrich failures tolerated"
  - "take% prefers the decoded DelegateInfo take, falls back to the lite take when getDelegate returns None"
  - "identity decoder tolerates { name } byte-vector / bare string / null (OQ-1 fixture-at-execute shape)"

patterns-established:
  - "Pattern: identitiesV2 value decode via decodeByteString over a tolerant { name } field"
  - "Pattern: isHotkeyRegisteredOnNetuid as the per-target-subnet registration signal for preview warnings"

requirements-completed: [TAO-R-05]

# Metrics
duration: ~10min
completed: 2026-06-03
---

# Phase 48 Plan 02: Validator enrichment (identity + commission + registration) Summary

**`get_bittensor_validators` now surfaces on-chain delegate identity, take% commission, and per-netuid registration via `delegateInfoRuntimeApi.getDelegate` + `identitiesV2`, plus the `isHotkeyRegisteredOnNetuid` per-netuid signal that Plan 48-03's preview-warning consumes — all mocked at the `_bittensorRegistry` seam, no live socket.**

## Performance

- **Duration:** ~10 min
- **Started:** 2026-06-03T18:24Z
- **Completed:** 2026-06-03T18:28Z
- **Tasks:** 3
- **Files modified:** 3 (1 created)

## Accomplishments
- Enriched `getValidators`: each permit-holder row gains `identity` (name), `takePercent` (decoded DelegateInfo take via the shipped `normalizeTakePercent`, lite-take fallback), and `registeredNetuids` (from `DelegateInfo.registrations`).
- Added `isHotkeyRegisteredOnNetuid(hotkey, netuid)` — the per-target-subnet registration signal via `getNeuronsLite` presence (OQ-2 resolution).
- `get_bittensor_validators` surfaces the enrichment in both text (`identity · hotkey · take`) and structuredContent; deferral language removed.
- New spy-based enrichment test (6 cases) covering enriched rows, empty-identity tolerance, getDelegate-None tolerance, permit-only filtering, and the registration signal both directions.

## Task Commits

1. **Task 1: enrich getValidators + isHotkeyRegisteredOnNetuid** - `1051c01` (feat)
2. **Task 2: surface enrichment in get_bittensor_validators** - `3dae39b` (feat)
3. **Task 3: enrichment spy test** - `c743fca` (test)

## Files Created/Modified
- `src/chains/bittensor/tao-rpc-client.ts` - BittensorValidatorRow +identity/+registeredNetuids; getValidators enrichment; +isHotkeyRegisteredOnNetuid; +DelegateInfoJson/decodeIdentityName; SubtensorRuntimeApi +delegateInfoRuntimeApi/+identitiesV2
- `src/tools/get_bittensor_validators.ts` - enriched text + structuredContent rows; DESCRIPTION/note deferral language removed
- `test/get-bittensor-validators-enrichment.test.ts` - 6-case spy test (NEW)

## Decisions Made
- **Best-effort enrichment:** a per-hotkey `getDelegate`/`identitiesV2` failure degrades to null/[] rather than failing the whole enumeration (mirrors the shipped null-take tolerance).
- **take% source precedence:** decoded `DelegateInfo.take` first, lite take as fallback — so an enumerated permit-holder that is also a registered delegate gets the authoritative commission.

## Deviations from Plan

None - plan executed exactly as written.

## Open-Question resolutions (execute-time)
- **OQ-1 (identitiesV2 value-struct field names):** the live decoded shape requires live RPC (blocked). The decoder (`decodeIdentityName`) tolerates the likely `{ name }` byte-vector shape, a bare string, and null/absent → null. Re-probe `identitiesV2(<live coldkey>)` to pin the exact field name on a spec bump; the null-tolerance path is the safe default.
- **OQ-2 (per-netuid registration signal):** resolved to `getNeuronsLite(netuid)` presence (one decoded call, the exact target subnet) for `isHotkeyRegisteredOnNetuid`; `getDelegate.registrations` powers the enumeration `registeredNetuids`. Both are exercised in the test.

## Issues Encountered
- **Shipped `get-bittensor-subnets.test.ts` regression risk:** that test drives the OLD minimal mock (no `delegateInfoRuntimeApi`/`identitiesV2`). The enriched `getValidators` calls them inside a tolerant try/catch, so the missing mock surfaces degrade to null/[]; the shipped test (which asserts only uid/hotkey/take/permit) stays green — confirmed.

## Verification
- `npx vitest run test/get-bittensor-validators-enrichment.test.ts test/get-bittensor-subnets.test.ts test/signing-fingerprint-bittensor.test.ts test/security-canonical-dispatch-bittensor.test.ts --no-coverage` → 56 passed
- `npx vitest run test/send-transaction.test.ts --no-coverage` (EVM regression) → 19 passed
- `npx tsc --noEmit` → RC 0
- FROZEN zero-diff: all 8 binding modules byte-identical to origin/main; send_transaction.ts 0 deletion lines
- No live socket opened (spy on `_bittensorRegistry.getApi`)

## Next Phase Readiness
- Plan 48-03 consumes `isHotkeyRegisteredOnNetuid` for the preview-time unregistered-hotkey warning + the 5 builder kinds (48-01) for the 5 prepare tools.

---
*Phase: 48-bittensor-subnet-depth*
*Completed: 2026-06-03*
