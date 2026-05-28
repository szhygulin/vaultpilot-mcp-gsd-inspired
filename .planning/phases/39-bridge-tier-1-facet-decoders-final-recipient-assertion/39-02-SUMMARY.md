---
phase: 39-bridge-tier-1-facet-decoders-final-recipient-assertion
plan: 02
subsystem: signing
tags: [viem, bridge, evm, solana, bs58, security, mcp, tdd, bytes32-normalization]

# Dependency graph
requires:
  - phase: 39-bridge-tier-1-facet-decoders-final-recipient-assertion
    plan: 01
    provides: BridgeFacetDecodeResult DU + TIER1_DECODERS skeleton + _bridgeTier1Decoders ESM seam
provides:
  - src/protocols/bridge-decoders/across-v3.ts — decodeAcrossV3Deposit + ACROSS_V3_SELECTORS
  - src/protocols/bridge-decoders/near-omnibridge.ts — decodeNearOmniBridgeTransfer + NEAR_SELECTORS
  - src/protocols/bridge-decoders/wormhole.ts — decodeWormholeTransferWithPayload + WORMHOLE_SELECTORS
  - src/protocols/bridge-decoders/mayan-swift.ts — decodeMayanSwiftOrder + MAYAN_SWIFT_SELECTORS
  - src/protocols/bridge-decoders/index.ts — TIER1_DECODERS map populated with all five selectors
affects:
  - 39-03 (preview_send Layer 0.6 wiring calls _bridgeTier1Decoders.decodeBridgeTier1FacetRecipient)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Encoding-aware bytes32 normalization: Solana (chain 1 or non-zero-leading-12-bytes) → bs58.encode(full 32 bytes); EVM → getAddress(last-20-bytes)"
    - "Structural Mayan EVM/Solana discrimination: leading-12-zero-bytes test on destAddr bytes32 (chain-id-scheme-independent)"
    - "NEVER-throws DU + selector-prefix guard pattern across all four decoders"
    - "ESM spy-affordance _<bridge>Helpers per decoder + _mayanSwiftHelpers dual-path (decodeWithEth/decodeWithToken)"
    - "TDD RED/GREEN discipline: test files committed before source files"

key-files:
  created:
    - src/protocols/bridge-decoders/across-v3.ts
    - src/protocols/bridge-decoders/near-omnibridge.ts
    - src/protocols/bridge-decoders/wormhole.ts
    - src/protocols/bridge-decoders/mayan-swift.ts
    - test/bridge-decoders-across-v3.test.ts
    - test/bridge-decoders-near-omnibridge.test.ts
    - test/bridge-decoders-wormhole.test.ts
    - test/bridge-decoders-mayan-swift.test.ts
  modified:
    - src/protocols/bridge-decoders/index.ts
    - test/bridge-decoders-index.test.ts

key-decisions:
  - "Mayan EVM/Solana discrimination: structural 12-leading-zero-byte test rather than chain-ID-scheme comparison — chain-id-scheme-independent (RESEARCH Open Q1 resolved)"
  - "Wormhole unsupported chain → { kind: error } rather than false-pass/false-mismatch — prevents spoofing via Terra/NEAR/Cosmos chain IDs"
  - "NEAR account ID normalization: toLowerCase().trim() on both sides of comparison — NEAR IDs are case-insensitive in practice; normalization at decoder time"
  - "Mayan fixtures labeled // SYNTHETIC — no direct createOrderWithEth mainnet tx found; ABI confirmed from Etherscan; acceptable per lifi-btc.ts PSBT fixture precedent"

requirements-completed: [BRIDGE-T1-01, BRIDGE-T1-02, BRIDGE-T1-03, BRIDGE-T1-04]

# Metrics
duration: 15min
completed: 2026-05-28
---

# Phase 39 Plan 02: Tier-1 Bridge Facet Decoders Summary

**Four Tier-1 bridge decoders with encoding-aware bytes32 normalization (EVM vs Solana base58), NEVER-throws DU, registered in the bridge-decoders/index.ts dispatcher — correctness core of Phase 39**

## Performance

- **Duration:** ~15 min
- **Started:** 2026-05-28T19:44:00Z
- **Completed:** 2026-05-28T19:58:00Z
- **Tasks:** 3 (2 TDD, 1 standard)
- **Files modified:** 10 (4 new source, 4 new test, 2 extended)
- **Test delta:** +47 (5027 → 5074)

## Accomplishments

- Implemented `decodeAcrossV3Deposit` (across-v3.ts): recipient is plain EVM address → `getAddress()` EIP-55; selector 0x7b939232; `_acrossV3Helpers` ESM seam; NEVER-throws DU
- Implemented `decodeNearOmniBridgeTransfer` (near-omnibridge.ts): recipient is ABI string → `.toLowerCase().trim()`; selector 0xdeb915b8; `_nearHelpers` ESM seam; NEVER-throws DU
- Implemented `decodeWormholeTransferWithPayload` (wormhole.ts): bytes32 recipient; encoding-aware branch on recipientChain: Solana (1) → `bs58.encode(full 32 bytes)` (NEVER truncate, NEVER toLowerCase, base58 is case-sensitive); EVM set {2,4,5,6,16,23,24,30} → `getAddress(last-20-bytes)`; unsupported chain → `{ kind: error }`; selector 0xc5a5ebda; `_wormholeHelpers` ESM seam
- Implemented `decodeMayanSwiftOrder` (mayan-swift.ts): two selectors 0xb866e173 (createOrderWithEth, tuple at args[0]) + 0x8e8d142b (createOrderWithToken, tuple at args[2]); bytes32 destAddr structural discrimination (12 leading zero bytes → EVM; else → Solana bs58); `_mayanSwiftHelpers` with decodeWithEth + decodeWithToken; NEVER-throws DU
- Populated `TIER1_DECODERS` map in index.ts with all five selector→adapter entries; adapters carry human bridge names; `decodeBridgeTier1FacetRecipient` body and `_bridgeTier1Decoders` seam unchanged
- 57 new bridge-decoder tests (15 Across/NEAR + 24 Wormhole/Mayan + 18 index routing)
- Full suite green: 5074 tests (no regressions)
- FROZEN-area zero-diff: `lifi-btc.ts`, `payload-fingerprint.ts`, `presign-hash.ts`, `send_transaction.ts`, `preview_send.ts` byte-identical to origin/main

## Task Commits

1. **Task 1 RED: Failing tests for Across V3 + NEAR OmniBridge** — `cf39234` (test)
2. **Task 1 GREEN: Implement Across V3 + NEAR OmniBridge decoders** — `1d5aaa0` (feat)
3. **Task 2 RED: Failing tests for Wormhole + Mayan Swift** — `44a67ba` (test)
4. **Task 2 GREEN: Implement Wormhole + Mayan Swift decoders** — `292da7d` (feat)
5. **Task 3: Register all five selectors in index.ts registry** — `6c07edf` (feat)

## Files Created/Modified

- `src/protocols/bridge-decoders/across-v3.ts` — NEW: `decodeAcrossV3Deposit` + `ACROSS_V3_SELECTORS` + `AcrossV3Summary` + `_acrossV3Helpers`
- `src/protocols/bridge-decoders/near-omnibridge.ts` — NEW: `decodeNearOmniBridgeTransfer` + `NEAR_SELECTORS` + `NearOmniBridgeSummary` + `_nearHelpers`
- `src/protocols/bridge-decoders/wormhole.ts` — NEW: `decodeWormholeTransferWithPayload` + `WORMHOLE_SELECTORS` + `WormholeSummary` + `_wormholeHelpers`
- `src/protocols/bridge-decoders/mayan-swift.ts` — NEW: `decodeMayanSwiftOrder` + `MAYAN_SWIFT_SELECTORS` + `MayanSwiftSummary` + `_mayanSwiftHelpers`
- `src/protocols/bridge-decoders/index.ts` — EXTENDED: imports + populated TIER1_DECODERS map (5 entries)
- `test/bridge-decoders-across-v3.test.ts` — NEW: 8 tests (real mainnet fixture, WR-02, EIP-55)
- `test/bridge-decoders-near-omnibridge.test.ts` — NEW: 7 tests (real mainnet fixture, WR-02, lowercase normalization)
- `test/bridge-decoders-wormhole.test.ts` — NEW: 12 tests (EVM real fixture + Solana EXACT base58 literal — T-39-02-SOLANA-NORM regression guard)
- `test/bridge-decoders-mayan-swift.test.ts` — NEW: 12 tests (SYNTHETIC fixtures labeled, both selectors, PITFALL-6, EVM+Solana)
- `test/bridge-decoders-index.test.ts` — EXTENDED: 18 tests (was 10 → 18; added routing + updated 39-01 no-match tests to reflect populated registry)

## Decisions Made

- Mayan EVM/Solana discrimination uses structural 12-leading-zero-byte test on destAddr bytes32 rather than chain-id-scheme comparison. Rationale: RESEARCH Open Q1 resolution — Mayan's chain-id scheme is uncertain; structural test is chain-id-scheme-independent and safe regardless.
- Wormhole unsupported chains (not in EVM set {2,4,5,6,16,23,24,30} and not Solana 1) return `{ kind: error, message: "unsupported..." }` rather than attempting extraction. Rationale: RESEARCH §Pitfall 1 — Terra/NEAR/Cosmos have custom encoding; a false-positive extraction is worse than a refusal.
- `NEAR_CALLDATA` in tests uses viem-re-encoded calldata (matching RESEARCH verified decode) rather than verbatim on-chain hex. Rationale: the on-chain hex in RESEARCH had partial/abbreviated representation for dynamic types; the re-encoded calldata decodes to identical values and is verifiably correct.

## Deviations from Plan

### Auto-fixed Issues

None — plan executed exactly as written. All FROZEN-area files zero-diff vs origin/main.

## Issues Encountered

None.

## User Setup Required

None — no new packages installed; bs58 and viem were already project dependencies.

## Known Stubs

None — all four decoders fully implemented and wired. No hardcoded empty values, no placeholder text, no unwired components.

## Threat Flags

None — all new files are decoder-only (no new network endpoints, no new auth paths, no schema changes at trust boundaries). The four decoders implement the T-39-02-SOLANA-NORM and T-39-02-DECODER-DOS mitigations from the plan's threat register.

## Next Phase Readiness

- Plan 39-03 can now import `_bridgeTier1Decoders` from `bridge-decoders/index.ts` and wire Layer 0.6 into `preview_send.ts`.
- All four decoders are NEVER-throws; plan 39-03 integration test can pass malformed calldata without worrying about decoder exceptions.
- `record.tx.bridgeParams?.toAddress` (from Plan 39-01) is the comparand for Layer 0.6 assertion.
- No blockers.

## Self-Check: PASSED

- FOUND: `src/protocols/bridge-decoders/across-v3.ts`
- FOUND: `src/protocols/bridge-decoders/near-omnibridge.ts`
- FOUND: `src/protocols/bridge-decoders/wormhole.ts`
- FOUND: `src/protocols/bridge-decoders/mayan-swift.ts`
- FOUND: `src/protocols/bridge-decoders/index.ts` (populated)
- FOUND: `test/bridge-decoders-across-v3.test.ts`
- FOUND: `test/bridge-decoders-near-omnibridge.test.ts`
- FOUND: `test/bridge-decoders-wormhole.test.ts`
- FOUND: `test/bridge-decoders-mayan-swift.test.ts`
- FOUND: `test/bridge-decoders-index.test.ts` (extended)
- FOUND: commit `cf39234` (Task 1 RED)
- FOUND: commit `1d5aaa0` (Task 1 GREEN)
- FOUND: commit `44a67ba` (Task 2 RED)
- FOUND: commit `292da7d` (Task 2 GREEN)
- FOUND: commit `6c07edf` (Task 3)
- VERIFIED: 5074 tests pass (5027 baseline + 47 new)
- VERIFIED: `npx tsc --noEmit` exits 0
- VERIFIED: FROZEN-area zero-diff (lifi-btc.ts, payload-fingerprint.ts, presign-hash.ts, send_transaction.ts, preview_send.ts)
- VERIFIED: all five selectors in index.ts (0x7b939232, 0xdeb915b8, 0xc5a5ebda, 0xb866e173, 0x8e8d142b)
- VERIFIED: Solana base58 test pins EXACT case-sensitive literal "2hh484NLjrMsKxrFXnF3e3yd2cimKo33TR2jidY7j6W5"
