---
phase: 46-bittensor-scaffolding
plan: 03
subsystem: chains
tags: [bittensor, substrate, polkadot, reads, dtao, alpha, decimal-aware]

# Dependency graph
requires:
  - phase: 46-01
    provides: tao-rpc-client shelf (formatRaoToTao, getFreeBalance, getStakeInfo, getAlphaPriceForNetuid, alphaToTaoEquivRao, ALPHA_PRICE_SCALE), _bittensorRegistry, assertSs58Address
  - phase: 46-02
    provides: register-all Phase-46 carve (pair/status block) — read imports land in a separate region
provides:
  - "get_bittensor_balance (TAO-R-01): free RAO→decimal TAO + summed per-position alpha→TAO-equiv; SS58 gate before RPC"
  - "get_bittensor_stake (TAO-R-02): per-(hotkey,netuid) rows, alpha labeled ALPHA distinct from derived taoEquivalent (TAO)"
  - "get_bittensor_subnets + get_bittensor_validators (TAO-R-03): decoded runtime-API enumeration; byte-array name/symbol → UTF-8; minimal validator list with take%"
  - "tao-rpc-client getSubnets + getValidators decode bodies (was stubbed [] in 46-01)"
affects: [47 signing, 48 validator-identity-enrichment (TAO-R-05)]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Byte-array (.toJSON() Vec<u8>) decode handling BOTH 0x-hex-string AND number-array shapes — codec serialization is a @polkadot/api version + chain-metadata detail"
    - "Per-netuid price memoization in the balance/stake fan-out (one currentAlphaPrice round-trip per distinct netuid)"
    - "All read tests mock ApiPromise at the _bittensorRegistry.getApi boundary — never a real WsProvider socket (sandbox blocks the RPC; a real connect hangs)"

key-files:
  created:
    - src/tools/get_bittensor_balance.ts
    - src/tools/get_bittensor_stake.ts
    - src/tools/get_bittensor_subnets.ts
    - src/tools/get_bittensor_validators.ts
    - test/get-bittensor-balance.test.ts
    - test/get-bittensor-stake.test.ts
    - test/get-bittensor-subnets.test.ts
  modified:
    - src/chains/bittensor/tao-rpc-client.ts
    - src/tools/register-all.ts

key-decisions:
  - "currentAlphaPrice scale = RAO-per-alpha / 1e9 (ALPHA_PRICE_SCALE=1e9) — re-confirmed; getSubnets derives the SAME fixed-point from taoIn/alphaIn reserves (taoIn × 1e9 / alphaIn), unit-consistent with currentAlphaPrice"
  - "Validator enumeration = neuronInfoRuntimeApi.getNeuronsLite(netuid) (one decoded call: hotkey + uid + validatorPermit + take); filter validatorPermit===true; normalize u16 take (÷65535 × 100) to a percentage string"
  - "getValidators netuid REQUIRED (per-subnet); tool schema marks it optional per requirement text {netuid?} but the handler refuses missing netuid with INVALID_INPUT — a chain-wide N-round-trip scan is out of scope for the minimal v2.7 enumeration"
  - "Byte-string decoder handles both hex-string and number-array .toJSON() shapes + trims trailing NUL padding (Rule 2: robust decode against unknown codec serialization)"

patterns-established:
  - "Off-by-unit discipline end-to-end: alpha (source of truth) labeled distinct from taoEquivalent (derived display) in BOTH text + structuredContent — alphaUnit:'ALPHA' / taoEquivalentUnit:'TAO'"

requirements-completed: [TAO-R-01, TAO-R-02, TAO-R-03, TAO-R-04]

# Metrics
duration: ~25min
completed: 2026-06-03
---

# Phase 46 Plan 03: Bittensor read tools Summary

**Four Bittensor read tools — balance (free + staked TAO-equiv), stake (per-(hotkey,netuid) alpha with strict alpha-vs-TAO unit labeling), subnets (byte-array name/symbol decode + reserves + price), and validators (per-netuid permit-holders + take%) — all routing through the decoded api.call.* runtime APIs via the _bittensorRegistry seam, with decimal-string boundaries and SS58 input gating.**

## Performance

- **Duration:** ~25 min
- **Tasks:** 2 (rpc-client decode bodies + 4 tools + register-all + 3 tests, in one commit)
- **Files modified:** 9 (7 created, 2 modified)

## Accomplishments
- Fleshed out the two remaining `tao-rpc-client` decode bodies that 46-01 left as `[]` stubs: `getSubnets` (getAllDynamicInfo → byte-array name/symbol → UTF-8 + reserves + derived alpha price) and `getValidators` (getNeuronsLite → filter validatorPermit + normalize take%). The balance/stake helpers were already complete in 46-01.
- `get_bittensor_balance` (TAO-R-01): SS58 checksum gate BEFORE any RPC; free RAO→decimal TAO; summed per-position alpha priced to a single TAO-equivalent (per-netuid price memoized); decimal strings, bigint not Number.
- `get_bittensor_stake` (TAO-R-02): per-(hotkey,netuid) rows where `alpha` (labeled ALPHA, source of truth) is DISTINCT from `taoEquivalent` (labeled TAO, derived via the chain price) — the off-by-unit footgun guarded in both text + structuredContent.
- `get_bittensor_subnets` + `get_bittensor_validators` (TAO-R-03): decoded runtime-API enumeration; minimal validator list (TAO-R-05 identity enrichment explicitly deferred to Phase 48).
- All 3 read-tool test files mock the ApiPromise at the `_bittensorRegistry.getApi` boundary — NO real WsProvider socket (the discipline that avoids the RPC-hang trap).

## Task Commits

1. **All of 46-03 (rpc-client decode bodies + 4 tools + register-all + 3 tests)** - `36c3741` (feat)

## Files Created/Modified
- `src/chains/bittensor/tao-rpc-client.ts` - getSubnets + getValidators decode bodies; decodeByteString (hex + number-array shapes); toBigIntSafe; normalizeTakePercent; BittensorSubnetRow/ValidatorRow shapes enriched (taoIn/alphaIn decimal strings, takePercent)
- `src/tools/get_bittensor_balance.ts` - TAO-R-01 free + staked TAO-equiv; SS58 gate; decimal strings
- `src/tools/get_bittensor_stake.ts` - TAO-R-02 per-(hotkey,netuid) alpha vs TAO-equiv labeling
- `src/tools/get_bittensor_subnets.ts` - TAO-R-03 subnet enumeration
- `src/tools/get_bittensor_validators.ts` - TAO-R-03 validator enumeration (minimal)
- `src/tools/register-all.ts` - 46-03 read imports in the read-tool region (carve-safe)
- `test/get-bittensor-balance.test.ts` - RAO edge cases + SS58 reject-before-RPC + staked-sum (7 tests)
- `test/get-bittensor-stake.test.ts` - alpha-vs-TAO labeling distinct (4 tests)
- `test/get-bittensor-subnets.test.ts` - byte-array decode (hex + number-array) + validator filter+take (5 tests)

## Decisions Made — the two execute-time Open Questions
- **Open Question 1 — currentAlphaPrice fixed-point scale:** RAO-per-alpha / 1e9 (`ALPHA_PRICE_SCALE = 1_000_000_000n`). Resolved in 46-01 against the live Finney chain (currentAlphaPrice(1)=9833079 ≈ taoIn/alphaIn ≈ 0.009833; cross-checked vs simSwapAlphaForTao). Re-confirmed here: `getSubnets` derives the SAME fixed-point INDEPENDENTLY from the AMM reserves (`taoIn × ALPHA_PRICE_SCALE / alphaIn`), so the subnet-listing price and the stake-conversion price are unit-consistent — two derivation paths agree on the 1e9 scale.
- **Open Question 2 — lowest-round-trip validator enumeration:** `neuronInfoRuntimeApi.getNeuronsLite(netuid)` — ONE decoded call returns all neurons with `hotkey` (SS58) + `uid` + `validatorPermit` + `take`. Resolved in 46-01's live probing. The minimal enumeration filters `validatorPermit === true` and normalizes the u16 `take` (÷65535 × 100) to a percentage string. NO raw `api.query.subtensorModule.validatorPermit` fallback was needed — the lite shape carried everything the minimal enumeration requires, so the Anti-Pattern (raw storage decode) is entirely avoided this phase (`grep -c "api.query.subtensorModule" src/chains/bittensor/tao-rpc-client.ts` === 0).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing critical functionality] Byte-array decode robustness for both .toJSON() codec shapes**
- **Found during:** Task 2 (getSubnets decode)
- **Issue:** The plan says decode `subnetName`/`tokenSymbol` byte arrays to strings, but `.toJSON()` on a Substrate `Vec<u8>` / `[u8; N]` serializes EITHER as a `0x…` hex string OR as a number array depending on the exact codec the chain metadata declares for the field — relying on a single shape would silently produce a garbled/empty name on the other.
- **Fix:** `decodeByteString` handles both shapes + trims trailing NUL padding + falls back to the empty string on an undecodable value (a malformed name should still let the subnet enumerate). Both shapes are test-covered (hex-string for netuid 0, number-array for netuid 1).
- **Files modified:** src/chains/bittensor/tao-rpc-client.ts
- **Commit:** 36c3741

**2. [Rule 3 - Blocking] getValidators signature tightened to required netuid**
- **Found during:** Task 2 (getValidators decode)
- **Issue:** The 46-01 stub typed `getValidators(netuid?: number)`, but `getNeuronsLite` is strictly per-subnet — a `netuid?` with no chain-wide enumeration path is a half-built contract. A chain-wide scan would be N round-trips (out of scope for the minimal v2.7 enumeration).
- **Fix:** Tightened the helper to `getValidators(netuid: number)`; the tool schema keeps `netuid?` per the requirement text `{netuid?}` but the handler refuses a missing netuid with INVALID_INPUT (and points the agent at get_bittensor_subnets to discover netuids). Documented inline.
- **Files modified:** src/chains/bittensor/tao-rpc-client.ts, src/tools/get_bittensor_validators.ts
- **Commit:** 36c3741

---

**Total deviations:** 2 auto-fixed (1 missing-functionality, 1 blocking). No architectural change, no FROZEN-file touch.
**Impact on plan:** Both serve correctness — the byte-decode robustness prevents garbled subnet names; the netuid tightening makes the per-subnet contract explicit rather than silently returning `[]`.

## Threat Surface Scan
No new security-relevant surface beyond the plan's threat_model. T-46-R01 (assertSs58Address gate before RPC, test-asserted getApi-never-called), T-46-R02 (alpha-vs-TAO per-field labeling), T-46-R04 (decoded api.call.* runtime APIs only — zero raw subtensorModule storage decode this phase) all covered.

## User Setup Required
None. Reads run key-free over the public Finney subtensor RPC; operators set `BITTENSOR_RPC_URL` for production reliability.

## Next Phase Readiness
- All four read tools are live and registered; the shelf decode bodies are complete (no remaining stubs).
- Phase 47 (signing) consumes the shelf's price/stake helpers; Phase 48 (TAO-R-05) enriches the minimal validator list with delegate identity + richer commission.
- FROZEN signing modules byte-identical to origin/main (verified: zero-diff).

## Self-Check: PASSED

All 7 created files present on disk; commit 36c3741 present in git log; 66/66 bittensor-scoped tests green; tsc rc=0.

---
*Phase: 46-bittensor-scaffolding*
*Completed: 2026-06-03*
