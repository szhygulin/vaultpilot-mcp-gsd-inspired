---
phase: 41-compound-v3-multi-chain-expansion-polygon-arbitrum-base-opti
plan: 01
subsystem: config/contracts
tags: [compound-v3, sot, l2, arbitrum, polygon, base, optimism, type-widening]
dependency_graph:
  requires: []
  provides:
    - COMPOUND_COMETS_RAW rows for chainId 42161/137/8453/10 (13 new Comet addresses)
    - CompoundCometBase widened with "USDC.e" and "AERO"
    - getAllCompoundCometsForChain(42161/137/8453/10) now return non-empty arrays
  affects:
    - src/security/canonical-dispatch.ts (buildPerChainAllowlist auto-extends from SOT getter — zero code change)
    - Plan 41-02 (tool-gate removal unblocked — SOT rows now present)
tech_stack:
  added: []
  patterns:
    - Phase 28 COMPOUND_COMETS_RAW additive-extension pattern applied to 4 L2 chains
    - EIP-55 getAddress() wrapping at every new literal site (module-load checksum guard)
key_files:
  created: []
  modified:
    - src/config/contracts.ts
    - test/config-contracts.test.ts
decisions:
  - "USDC.e" distinct type key for both Arbitrum legacy bridged market and Polygon bridged USDC.e market (not "USDC") — per Phase 41 locked decision; getCompoundCometAddress(137,"USDC") returns null
  - Base USDbC Comet (0x9c4ec768…) deliberately excluded — Gauntlet Dec-2024 deprecation, ~$82k TVL; users exit via prepare_custom_call (Phase 35)
  - AERO Comet included with "volatile base asset" comment — code complexity identical; broadens coverage
  - canonical-dispatch.ts NOT touched — stale per-chain count comment intentionally left to preserve FROZEN zero-diff; SOT getter is the runtime source of truth
metrics:
  duration: "~12 minutes"
  completed: "2026-05-29"
  tasks_completed: 2
  files_modified: 2
---

# Phase 41 Plan 01: Compound V3 L2 SOT Extension Summary

**One-liner:** COMPOUND_COMETS_RAW extended with 13 verified L2 Comet proxy addresses across Arbitrum/Polygon/Base/Optimism; CompoundCometBase widened with "USDC.e" (bridged-USDC key for Arbitrum+Polygon) and "AERO" (volatile Base Comet).

## What Was Built

### Task 1 — Widen CompoundCometBase + extend COMPOUND_COMETS_RAW (commit 35110c8)

Extended `src/config/contracts.ts` with:

- `CompoundCometBase` type widened: `"USDC.e"` and `"AERO"` appended; existing 6 members order-stable.
- 4 new chain rows in `COMPOUND_COMETS_RAW`:
  - **42161 (Arbitrum):** USDC / USDC.e / USDT / WETH (4 Comets)
  - **137 (Polygon):** USDC.e / USDT (2 Comets; "USDC" key absent — native USDC has no Polygon Comet)
  - **8453 (Base):** USDC / WETH / USDS / AERO (4 Comets; deprecated USDbC excluded)
  - **10 (Optimism):** USDC / USDT / WETH (3 Comets)
- Ethereum `1:` row: byte-unchanged (Fixtures R/S/T/U unaffected).
- Both getters (`getCompoundCometAddress`, `getAllCompoundCometsForChain`) byte-unchanged.

Three required code comments present:
1. Arbitrum/Base address-coincidence note — `0x9c4ec768…` is the Arbitrum USDC proxy AND the deprecated Base USDbC proxy (genuine cross-chain coincidence; per-chain dispatch sets are disjoint).
2. Base USDbC deliberate-exclusion note — Gauntlet Dec-2024 deprecation, ~$82k TVL; users exit via `prepare_custom_call` (Phase 35).
3. WETH cross-SOT consistency note — Arbitrum/Base/Optimism WETH Comet base-token addresses equal `getWethAddress(chainId)` values (mirrors Phase 31 EigenLayer/Lido pattern; comment notes these are verified against `configuration.json`).

### Task 2 — Per-chain SOT assertions + Ethereum-row-unchanged guard (commit 3b50cda)

Extended `test/config-contracts.test.ts` with a new Phase 41 describe block (13 new tests, 164 total):

- Per-chain length assertions: 42161→4, 137→2, 8453→4, 10→3.
- Per-chain set-equality assertions mirroring Phase 28 Test-7 shape.
- Base USDbC exclusion guard: `getAllCompoundCometsForChain(8453)` does not contain `0x9c4ec768…`.
- Ethereum-row-unchanged guard: length still 6; set still equals original 6 base-asset lookups.
- USDC.e distinctness: `getCompoundCometAddress(137,"USDC") === null`; `(137,"USDC.e")` non-null; Arbitrum both non-null and distinct.
- Removed stale Test 8a (`getAllCompoundCometsForChain(137) returns []`) — now false; Test 8b (TS @ts-expect-error narrowing) intact.

## Verification

- `npx tsc --noEmit` exits 0.
- `npx vitest run test/config-contracts.test.ts` exits 0 (164/164 pass).
- FROZEN-area zero-diff: `git diff origin/main -- src/signing/payload-fingerprint.ts src/signing/presign-hash.ts src/signing/handle-store.ts src/tools/send_transaction.ts src/protocols/compound-v3.ts src/security/canonical-dispatch.ts` is EMPTY.

## Deviations from Plan

None — plan executed exactly as written. The canonical-dispatch.ts stale count comment was deliberately NOT updated per the plan's explicit "DELIBERATE NON-UPDATE" instruction (preserving FROZEN zero-diff is the correct trade).

## Threat Flags

None — this plan only extends the SOT data object and its tests. No new network endpoints, auth paths, or schema changes at trust boundaries. The per-chain `getAllCompoundCometsForChain` getter is already wired into `buildPerChainAllowlist` in `canonical-dispatch.ts`; adding rows extends the allowlist at module-load time with zero code path changes.

## Known Stubs

None — this is a pure data SOT extension. All 13 new addresses are EIP-55 checksummed at module load via `getAddress(...)`. The `getCompoundCometAddress` and `getAllCompoundCometsForChain` getters are fully functional over the widened data.

## Self-Check: PASSED

- `src/config/contracts.ts` — FOUND, contains all 13 new getAddress literals
- `test/config-contracts.test.ts` — FOUND, 164 tests pass
- Commit `35110c8` — FOUND in git log
- Commit `3b50cda` — FOUND in git log
- FROZEN-area diff — EMPTY (verified)
