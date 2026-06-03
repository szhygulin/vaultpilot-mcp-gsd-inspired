---
phase: 46-bittensor-scaffolding
plan: 01
subsystem: infra
tags: [bittensor, substrate, polkadot, scaffolding, ss58, rao, decimal-aware]

# Dependency graph
requires:
  - phase: 11-solana-scaffolding
    provides: src/chains/solana/ registry + sol-rpc-client + persona patterns mirrored here
  - phase: PAIR-NEV (non-evm store)
    provides: chain-agnostic non-evm-account-store widened by one chain
provides:
  - "src/chains/bittensor/ shelf: lazy async ApiPromise singleton (registry), branded Ss58Address + checksum gate (types), RAO formatter + BittensorRpcError + read-helper scaffolding (tao-rpc-client)"
  - "getBittensorRpcUrl() env reader; NonEvmChain/VALID_CHAINS widened with bittensor (zero schema change)"
  - "Bittensor demo persona (DOA-validated) + state carve; bittensorRpcConfigured + bittensor in pairedNonEvmChains config-status surface"
  - "Resolved Open Question 1: currentAlphaPrice is RAO-per-alpha 1e9-scaled fixed-point (ALPHA_PRICE_SCALE=1e9)"
affects: [46-02 pairing, 46-03 reads, 47 signing]

# Tech tracking
tech-stack:
  added: ["@polkadot/api@16.5.6", "@zondax/ledger-substrate@2.3.4", "@polkadot/util-crypto@14.0.3"]
  patterns:
    - "Lazy async ApiPromise singleton with getResolvedRpcUrl resolving URL WITHOUT a live connect (Pitfall 5)"
    - "_bittensorRegistry ESM spy-affordance (mirror _solanaRegistry)"
    - "SubtensorRuntimeApi type-narrowing seam over @polkadot/api's dynamically-decorated custom runtime APIs"

key-files:
  created:
    - src/chains/bittensor/registry.ts
    - src/chains/bittensor/types.ts
    - src/chains/bittensor/tao-rpc-client.ts
    - src/demo/bittensor-persona.ts
    - test/chains-bittensor-rpc.test.ts
    - test/bittensor-persona.test.ts
    - test/get-vaultpilot-config-status-bittensor.test.ts
  modified:
    - package.json
    - src/config/env.ts
    - src/wallet/non-evm-account-store.ts
    - src/demo/state.ts
    - src/tools/get_vaultpilot_config_status.ts

key-decisions:
  - "currentAlphaPrice fixed-point scale is RAO-per-alpha / 1e9 (Open Question 1 resolved empirically against live Finney netuid-1 reserves + simSwapAlphaForTao)"
  - "Demo persona = 5GsbTgfvgCH4xdqSkiPb7EaBBFLHjWH5vfEALhJaewSFpZX9 (active validator coldkey, 74 stake positions, OFAC-clean)"
  - "SubtensorRuntimeApi type seam over @polkadot/api's dynamically-decorated runtime APIs (type-only, no behavior change)"

patterns-established:
  - "Pattern 1: getResolvedRpcUrl resolves the env-or-fallback URL string without opening a WS socket — status never hangs offline"
  - "Pattern 2: every amount labeled with its token (TAO vs alpha) — the off-by-unit discipline"

requirements-completed: [PAIR-NEV-* reuse, TAO-R-04]

# Metrics
duration: ~35min
completed: 2026-06-03
---

# Phase 46 Plan 01: Bittensor (Substrate) chain shelf Summary

**Substrate chain shelf for Bittensor: lazy async ApiPromise singleton + branded SS58 checksum gate + RAO decimal formatter, plus persistence widening, config-status surface, and a DOA-validated TAO demo persona — pure scaffolding, no signing.**

## Performance

- **Duration:** ~35 min
- **Tasks:** 3 (+ Task 0 checkpoint pre-approved by orchestrator)
- **Files modified:** 12 (7 created, 5 modified)

## Accomplishments
- Installed three Substrate SDKs (exact pins, deterministic lockfile); slopcheck [OK] on all three; @zondax has no postinstall; @polkadot/util + util-crypto dedupe to single version 14.0.3 (Pitfall 3)
- Built `src/chains/bittensor/` shelf mirroring `src/chains/solana/`: lazy async ApiPromise singleton with noInitWarn:true (Pitfall 4), getResolvedRpcUrl resolving the URL string without a live connect (Pitfall 5), branded Ss58Address with full prefix-42 checksum gate, RAO→decimal-string formatter with u128-safe bigint math, BittensorRpcError, and read-helper scaffolding wired to the decoded api.call.* runtime APIs
- Widened NonEvmChain union + VALID_CHAINS by one entry (zero schema change); added getBittensorRpcUrl() reader
- Shipped a DOA-validated OFAC-clean TAO demo persona + per-chain demo-state carve; surfaced bittensorRpcConfigured and bittensor in pairedNonEvmChains
- Resolved both execute-time open questions empirically against the live Finney chain (spec 413)

## Task Commits

1. **Task 1: Install SDKs + getBittensorRpcUrl + widen NonEvmChain** - `0ba6e01` (feat)
2. **Task 2: Build src/chains/bittensor/ shelf** - `044a8df` (feat, tdd: test+impl in one commit)
3. **Task 3: TAO persona + state carve + config-status** - `cdf8de4` (feat, tdd: test+impl in one commit)

## Files Created/Modified
- `src/chains/bittensor/registry.ts` - Lazy async ApiPromise singleton; _bittensorRegistry spy-affordance; getResolvedRpcUrl without live connect
- `src/chains/bittensor/types.ts` - Branded Ss58Address + SS58_ADDRESS_RE + assertSs58Address (decodeAddress prefix-42 checksum gate)
- `src/chains/bittensor/tao-rpc-client.ts` - formatRaoToTao + BittensorRpcError + read-helper scaffolding + ALPHA_PRICE_SCALE + _taoRpcInternals
- `src/demo/bittensor-persona.ts` - BITTENSOR_PERSONAS + DOA loop + find/list
- `src/config/env.ts` - getBittensorRpcUrl() reader
- `src/wallet/non-evm-account-store.ts` - NonEvmChain/VALID_CHAINS widening
- `src/demo/state.ts` - BittensorPersona interface + active-state carve + getters/setters
- `src/tools/get_vaultpilot_config_status.ts` - bittensorRpcConfigured surfacing

## Decisions Made
- **currentAlphaPrice scale (Open Question 1):** RAO-per-alpha as a 1e9-scaled fixed-point. Verified live: currentAlphaPrice(1)=9833079; taoIn/alphaIn ≈ 0.009833 ≈ 9833079/1e9; cross-checked against simSwapAlphaForTao(1, 1e9 alpha) → taoAmount 9828074 (matches to within AMM slippage/fee ~0.05%). Pinned as `ALPHA_PRICE_SCALE = 1_000_000_000n`; taoEquivRao = alphaRao × priceRaw / ALPHA_PRICE_SCALE.
- **Demo persona:** 5GsbTgfvgCH4xdqSkiPb7EaBBFLHjWH5vfEALhJaewSFpZX9 — a real active validator coldkey (74 per-subnet alpha stake positions, ~1 TAO free), DOA-validated via decodeAddress (prefix-42 re-encode round-trip identical), OFAC SDN cross-check clean.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] @polkadot/api typed subtensor's custom runtime APIs as possibly-undefined**
- **Found during:** Task 2 (shelf build)
- **Issue:** `api.query.system.account` + the custom `api.call.{stakeInfoRuntimeApi,swapRuntimeApi,subnetInfoRuntimeApi,neuronInfoRuntimeApi}` are decorated DYNAMICALLY from chain metadata at `ApiPromise.create` time — they are not in @polkadot/api's static type augmentation, so tsc reported them as `possibly undefined` (TS18048/TS2722). 12 errors.
- **Fix:** Added a `SubtensorRuntimeApi` narrowing interface + `asSubtensor(api)` accessor that pins the exact runtime-decorated subset read. Type-only — the runtime calls are identical to the generic surface.
- **Files modified:** src/chains/bittensor/tao-rpc-client.ts
- **Verification:** tsc --noEmit rc=0; shelf test still 14/14 green
- **Committed in:** 044a8df (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Necessary to compile against @polkadot/api's dynamic-runtime-API typing reality. No scope creep — the seam is the documented-correct way to access a custom Substrate chain's runtime APIs.

## Issues Encountered
- Full storage-map enumeration (`system.account.entries()`) timed out when searching for a high-balance persona; switched to enumerating real netuid-1 validator coldkeys via `getNeuronsLite` (decoded, one call) — picked the coldkey with the richest stake composition.

## User Setup Required
None - no external service configuration required. The public Finney subtensor RPC (`wss://entrypoint-finney.opentensor.ai:443`) works key-free; operators set `BITTENSOR_RPC_URL` for production reliability.

## Next Phase Readiness
- The shelf (registry + types + formatter), persistence widening, and config-status surface are live — 46-02 (pairing) and 46-03 (reads) both depend on these and are unblocked.
- Open Question 2 (validator enumeration) also resolved during this plan's live probing: `neuronInfoRuntimeApi.getNeuronsLite(netuid)` returns all 256 neurons with hotkey + uid + validatorPermit in one call (consumed by 46-03).
- FROZEN signing modules byte-identical to origin/main.

## Self-Check: PASSED

All 7 created files present on disk; all 3 task commits (0ba6e01, 044a8df, cdf8de4) present in git log.

---
*Phase: 46-bittensor-scaffolding*
*Completed: 2026-06-03*
