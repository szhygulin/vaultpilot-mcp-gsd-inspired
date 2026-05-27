---
phase: 37
plan: 01
wave: 1
status: complete
completed: 2026-05-27
requirements:
  - SAFE-05
depends_on: []
commits:
  - 905a95e  # feat(37): safe-tx-hash + VaultPilot-safetx-v1 fingerprint + Fixtures SAFE-A/B/C/D
  - de07829  # feat(37): PreparedTxSafeTypedData discriminant + handle-store union widening
  - 1b26ca8  # feat(37): prepare_safe_tx_propose + WC eth_signTypedData_v4 namespace + safe.ts domainSeparator
test_delta:
  pre_phase_37:    4653
  post_plan_37_01: 4850
  plan_37_01_net:  +197
  files_added: 4
  files_modified: 7
key_files:
  created:
    - src/signing/safe-tx-hash.ts
    - src/tools/prepare_safe_tx_propose.ts
    - test/signing-safe-tx-hash.test.ts
    - test/handle-store.safe-typed-data.test.ts
    - test/prepare-safe-tx-propose.test.ts
  modified:
    - src/signing/payload-fingerprint.ts
    - src/signing/handle-store.ts
    - src/signing/error-codes.ts
    - src/wallet/session-manager.ts
    - src/chains/safe.ts
    - src/tools/register-all.ts
    - test/signing-fingerprint.test.ts
    - test/chains-safe.test.ts
    - test/wallet-session-manager.test.ts
    - test/integration/safe-get-transaction.test.ts
fixtures:
  SAFE-A: "0xf5073f5eabcb7ff540becf339c3bbe2b5f41b5f9fec8ae1e42847d9a25fedf0a"
  SAFE-B: "0xf198ea4907964d6b024affd19f0e81424bb9f2544e8a4904db1d1585b4fc49d0"
  SAFE-C: "0x2f5b398a4f868a3149fcda1a097f6229f544554fe5e69c0c219c2f8c6080e4e2"
  SAFE-D: "0xbd55bd01d22779249cb10b8ecea6f87c85f511a024175b7dc0aa3ac1c7dad71b"
new_exports_for_plans_37_02_37_03:
  - computeSafeTxHash (src/signing/safe-tx-hash.ts)
  - buildSafeEIP712TypedData (src/signing/safe-tx-hash.ts)
  - SafeOperation / SupportedSafeVersion / SafeEIP712TypedData types
  - computeSafeTxPayloadFingerprint (src/signing/payload-fingerprint.ts)
  - SAFE_TX_FINGERPRINT_DOMAIN_TAG (src/signing/payload-fingerprint.ts)
  - PreparedTxSafeTypedData (src/signing/handle-store.ts)
  - getOnchainDomainSeparator (src/chains/safe.ts)
  - _safeChains.getOnchainDomainSeparator (ESM spy seam)
  - UNSUPPORTED_SAFE_VERSION error code
---

# Phase 37 Plan 37-01: safe-tx-hash + propose + namespace + Fixtures SAFE-A/B/C/D — Summary

The v2.5 Safe trust-pipeline foundation. First off-chain EIP-712 typed-data
signing path into the existing handle-store + payloadFingerprint pipeline.
Three atomic commits compose pure cryptographic-binding primitives + the
7th `PreparedTx` union member + the first prepare tool that does NOT broadcast.

## What was built

| Commit | Surface | Files |
|--------|---------|-------|
| 905a95e | `safe-tx-hash.ts` — EIP-712 typed-data digest (v1.3.0 + v1.4.1 single path) + `payload-fingerprint.ts` extension (`VaultPilot-safetx-v1:` tag) + Fixtures SAFE-A/B/C/D as hardcoded `0x…` literals | `src/signing/safe-tx-hash.ts` (NEW), `src/signing/payload-fingerprint.ts`, `test/signing-safe-tx-hash.test.ts` (NEW), `test/signing-fingerprint.test.ts` |
| de07829 | `PreparedTxSafeTypedData` — 7th `PreparedTx` discriminant + sentinel EVM-shape fields + Safe-specific cryptographic-binding fields + state-machine BYTE-IDENTICAL | `src/signing/handle-store.ts`, `test/handle-store.safe-typed-data.test.ts` (NEW) |
| 1b26ca8 | `prepare_safe_tx_propose` tool + WC `eth_signTypedData_v4` namespace + `safe.ts::domainSeparator()` ABI extension + `getOnchainDomainSeparator` reader + `_safeChains` extension + register-all + `UNSUPPORTED_SAFE_VERSION` error code | `src/tools/prepare_safe_tx_propose.ts` (NEW), `src/tools/register-all.ts`, `src/wallet/session-manager.ts`, `src/chains/safe.ts`, `src/signing/error-codes.ts`, `test/prepare-safe-tx-propose.test.ts` (NEW), `test/wallet-session-manager.test.ts`, `test/chains-safe.test.ts`, `test/integration/safe-get-transaction.test.ts` |

## Fixtures pinned as hardcoded `0x…` literals (CLAUDE.md mandatory)

| Fixture | Inputs | Hash |
|---------|--------|------|
| **SAFE-A** — v1.3.0 mainnet Safe, native ETH transfer, operation=call | safeAddress `0x1234…7890`, to=Anvil#1, value=1 ETH, data=`0x`, nonce=42n | `0xf5073f5eabcb7ff540becf339c3bbe2b5f41b5f9fec8ae1e42847d9a25fedf0a` |
| **SAFE-B** — v1.4.1 mainnet Safe, USDC transfer calldata, operation=call | safeAddress `0xabcdef…ef01`, to=USDC, value=0n, ERC-20 transfer calldata, nonce=7n | `0xf198ea4907964d6b024affd19f0e81424bb9f2544e8a4904db1d1585b4fc49d0` |
| **SAFE-C** — v1.3.0 mainnet Safe, SAME args as SAFE-A but operation=delegatecall | ...delta from SAFE-A: operation=1 | `0x2f5b398a4f868a3149fcda1a097f6229f544554fe5e69c0c219c2f8c6080e4e2` |
| **SAFE-D** — `VaultPilot-safetx-v1:` payloadFingerprint over SAFE-A inputs | computeSafeTxPayloadFingerprint({SAFE-A inputs + safeTxHash=FIXTURE_SAFE_A_HASH}) | `0xbd55bd01d22779249cb10b8ecea6f87c85f511a024175b7dc0aa3ac1c7dad71b` |

NO `beforeAll`-snapshot. Drift in EIP-712 preimage assembly fails at a SPECIFIC
line, not against a self-snapshotted value (CLAUDE.md cryptographic-binding rule).

## Tests added/total

| Layer | File | Δ tests | Notes |
|-------|------|---------|-------|
| Crypto primitives | `test/signing-safe-tx-hash.test.ts` (NEW) | +9 | Fixtures SAFE-A/B/C hardcoded literals + v1.3.0/v1.4.1 byte-identity sanity (RESEARCH §1) + nonce-distinctness + operation-distinctness + gas-relay defaults + chainId pin (RESEARCH §Pitfall 2) + 3-distinct-digests Set |
| Fingerprint extension | `test/signing-fingerprint.test.ts` | +3 | Fixture SAFE-D anchor + tag length/distinctness pin + endianness-distinctness sanity (RESEARCH §Pitfall A4) + nonce-distinctness |
| Handle-store widening | `test/handle-store.safe-typed-data.test.ts` (NEW) | +6 | createHandle round-trip + transitionToSent with SafeTx hash as txHash + exhaustive switch narrowing + prepared→previewed→sent + prepared→cancelled + sent→cancelled refused |
| Chain reader extension | `test/chains-safe.test.ts` | +3 | safeSingletonAbi 7-fn assertion (was 5) + domainSeparator + getTransactionHash sig checks + getOnchainDomainSeparator unit + `_safeChains` spy for new reader |
| Session manager | `test/wallet-session-manager.test.ts` | +1 | `requiredNamespaces.eip155.methods` contains `eth_signTypedData_v4` |
| Tool unit | `test/prepare-safe-tx-propose.test.ts` (NEW) | +20 | Fixture SAFE-A + SAFE-D cross-link regression anchors + handle round-trip + PREPARE RECEIPT verbatim + CHECKS PERFORMED (version/owner/nonce/domainSeparator) + LEDGER DISPLAY (clear-sign + blind-sign) + delegatecall path + v1.4.1 accept + UNSUPPORTED_SAFE_VERSION (1.1.1 / 1.0.0 / 1.5.0+) + WALLET_NOT_PAIRED + INVALID_INPUT (non-owner / bad operation / negative value / malformed address) + gas-relay default-zero + non-zero WARN + drift-into-hash |
| **Total** | | **+42 unique** | |

Full suite: **4653 → 4850 passing** (+197 cumulative, **+42 unique** — the
difference is fixture-test re-runs from cross-imports in consumer test files,
expected behavior). 1 skipped unchanged.

## Test trajectory

```
pre-Phase-37:    4653 passing + 1 skipped (329 files)
post-Plan-37-01: 4850 passing + 1 skipped (333 files; +197 / +4)
```

## FROZEN-area zero-diff acceptance gate

Per `37-CONTEXT.md §"FROZEN-area zero-diff invariant"` lines 132-140 — the
authoritative paths are `src/tools/send_transaction.ts` +
`src/tools/preview_send.ts` (the cryptographic-binding-chain CONSUMER files).
Plans 37-01 + 37-02 zero-diff; Plan 37-03 adds additive arms only.

```
$ git diff --stat origin/main -- src/tools/send_transaction.ts src/tools/preview_send.ts
(empty output — zero files touched)
```

Phase 37 Plan 37-01 EXTENDS `src/signing/` deliberately (new safe-tx-hash.ts +
handle-store widening + payload-fingerprint SafeTx tag) — that's the point of
this plan. Phase 36's Test 18 had asserted `src/signing/` zero-diff against
origin/main; this Phase 37 plan re-anchored the test to the narrower Phase 37
boundary (deviation [Rule 3] — Phase-boundary correction; Phase 36 test scope
was Phase-36-bounded; Phase 37 owns the new boundary).

## New exports surface for Plans 37-02 + 37-03

```typescript
// src/signing/safe-tx-hash.ts
export type SafeOperation = 0 | 1;
export type SupportedSafeVersion = "1.3.0" | "1.4.1";
export interface SafeEIP712TypedData { /* full domain+types+message */ }
export function buildSafeEIP712TypedData(input): SafeEIP712TypedData;
export function computeSafeTxHash(input): Hex;

// src/signing/payload-fingerprint.ts (extension)
export const SAFE_TX_FINGERPRINT_DOMAIN_TAG = "VaultPilot-safetx-v1:";
export function computeSafeTxPayloadFingerprint(input): Hex;

// src/signing/handle-store.ts (widening)
export interface PreparedTxSafeTypedData {
  txType: "safe-typed-data";
  /* sentinel EVM-shape + Safe cryptographic-binding + typedDataStructure */
}
export type PreparedTx = ... | PreparedTxSafeTypedData;  // 7th arm

// src/chains/safe.ts (extension)
export async function getOnchainDomainSeparator(client, chainId, safe): Promise<Hex>;
export const _safeChains = {
  getOnchainSafeInfo,
  getEnabledModules,
  getOnchainDomainSeparator,  // NEW
};

// src/signing/error-codes.ts (extension)
| "UNSUPPORTED_SAFE_VERSION"   // pre-v1.3.0 Safes refused → cross-chain replay risk
```

## Three load-bearing research findings preserved end-to-end

1. **v1.3.0 + v1.4.1 share byte-identical EIP-712 typehashes** (RESEARCH §Pitfall 1).
   `safe-tx-hash.ts::computeSafeTxHash` has a SINGLE digest path — no branch on
   `safeVersion`. The version is load-bearing only at the refusal gate in
   `prepare_safe_tx_propose` (pre-v1.3.0 has no chainId in domain → cross-chain
   replay risk). Anchored by the `"v1.3.0 and v1.4.1 share byte-identical
   digest"` test that asserts SAFE-A's computeSafeTxHash returns the same
   bytes for both versions.

2. **`chain` as uint64 LE** in the payloadFingerprint preimage (RESEARCH
   §Pitfall A4). viem `numberToBytes` defaults to BIG-ENDIAN; the CONTEXT lock
   encodes `chain` as LITTLE-ENDIAN. Implementation uses
   `new Uint8Array(numberToBytes(input.chain, { size: 8 })).reverse()` —
   anchored by the endianness-distinctness sanity test that constructs a
   manually-BE preimage and proves it produces a DIFFERENT fingerprint than
   the canonical LE-anchored FIXTURE_SAFE_D_FP.

3. **`chainId: number` (not bigint)** in the typed-data domain (RESEARCH
   §Pitfall 2). viem accepts `number | bigint` and encodes as uint256 either
   way; pinning `number` keeps consistency with the rest of the codebase.
   Anchored by the `"buildSafeEIP712TypedData carries chainId as number"`
   test. The viem type system wants `bigint` — `safe-tx-hash.ts` and
   `prepare_safe_tx_propose.ts` cast through `TypedData` to satisfy the
   typecheck while preserving the runtime `number` choice.

## Architectural decisions

- **`txType: "safe-typed-data"` discriminator** consumed by `submit_safe_tx_signature`
  (Plan 37-02) and refused by `send_transaction` (Plan 37-03 — WRONG_HANDLE_KIND
  structured-refusal arm). Type-level impossibility established at Plan 37-01.
- **`txHash` field semantics on Safe handles**: the SafeTx hash (EIP-712 digest)
  doubles as the `txHash` stamped at `transitionToSent` — different semantic,
  same field. Matches the BTC `txHash` widening pattern from Plan 12-05.
- **`PreparedTxSafeTypedData` field expansion rationale** (planner-resolved per
  WARNING 2 checker feedback): CONTEXT.md drafted 12 logical fields; the
  implementation expands to ~20 because (a) every union arm carries EVM-shape
  sentinel fields for union accessibility, (b) Safe-specific business fields
  suffix `safeTx*` to avoid sentinel collision, (c) `kind` → `txType` matches
  the established codebase convention.
- **`SAFE_TX_FINGERPRINT_DOMAIN_TAG` is 21 bytes utf-8** (not the 22 the
  CONTEXT preimage diagram claimed). The "VaultPilot-safetx-v1:" string is
  21 chars exactly. Verified in the byte-length invariant test; the comment
  in `payload-fingerprint.ts` was corrected at write time.
- **CAL coverage detection is NOT attempted server-side** (CONTEXT lock —
  no public Ledger API). The `LEDGER DISPLAY` block surfaces BOTH possible
  on-device displays (clear-sign field-by-field + blind-sign Sign Hash) so
  the user knows what to expect either way.

## Deviations from plan

### [Rule 3 - Auto-fix] Phase 36 FROZEN-area test scope correction

**Found during:** Task 3 close-out (full suite run).
**Issue:** `test/integration/safe-get-transaction.test.ts` Test 18 (Phase 36
close-out gate) asserted `git diff origin/main -- src/signing/` returned
empty. Phase 37 Plan 37-01 explicitly extends `src/signing/` (new
safe-tx-hash.ts + handle-store union widening + payload-fingerprint SafeTx
tag) — the test's scope was Phase-36-bounded.
**Fix:** Re-scoped Test 18 to Phase 37's authoritative paths per `37-CONTEXT.md
§"FROZEN-area zero-diff invariant"` lines 132-140: `src/tools/send_transaction.ts`
+ `src/tools/preview_send.ts`. Inline comment block explains the Phase-boundary
correction.
**Files modified:** `test/integration/safe-get-transaction.test.ts`.
**Commit:** 1b26ca8.

### [Rule 1 - Bug] Fixture SAFE-B safeAddress checksum

**Found during:** Task 1 first vitest run.
**Issue:** Initial SAFE-B fixture used `"0xAbCdEf0123456789AbCdEf0123456789AbCdEf01"`
as the safeAddress — viem rejects this with `InvalidAddressError` because the
mixed-case hex doesn't satisfy EIP-55 checksum.
**Fix:** Lowercased to `"0xabcdef0123456789abcdef0123456789abcdef01"` — viem
accepts lowercase as a "skip checksum" signal. The SAFE-A address was already
all-lowercase by accident; documented the rationale at the fixture sites.
**Files modified:** `test/signing-safe-tx-hash.test.ts`.
**Commit:** 905a95e.

## Known stubs

None. Plan 37-01 has no UI/data-binding surface (the tool emits text + structured
content from server-computed values).

## Threat flags

None. Plan 37-01 introduces ONLY cryptographic-binding primitives + an off-chain
typed-data prepare tool. The on-chain reads (`getOnchainSafeInfo` +
`getOnchainDomainSeparator`) reuse Phase 36's read-only Safe Singleton ABI
surface; no new mutating surface, no new network endpoint, no schema change at
trust boundaries. All threat-register dispositions in PLAN.md `<threat_model>`
are honored:

- T-37-01 (EIP-712 tampering) → viem.hashTypedData + Fixtures SAFE-A/B/C
  hardcoded literals.
- T-37-02 (`chain` LE endianness) → endianness-distinctness sanity test +
  Fixture SAFE-D byte-pin.
- T-37-03 (pre-v1.3.0 Safe cross-chain replay) → `UNSUPPORTED_SAFE_VERSION`
  refusal at prepare time.
- T-37-04 (`chainId` number vs bigint) → pinned `Number(input.chain)` + Fixture
  SAFE-A regression anchor.
- T-37-05 (non-owner sender) → on-chain `getOwners()` cross-check refusal.
- T-37-08 (eth_signTypedData_v4 namespace expansion) → method-scoped to Safe
  typed-data flow; blind-sign hash surface via LEDGER DISPLAY block.

## Plan 37-02 + 37-03 unblocked surfaces

Plan 37-02 (`prepare_safe_tx_approve` + `submit_safe_tx_signature`) imports:
- `computeSafeTxHash` (for the approve flow's local re-derivation)
- `computeSafeTxPayloadFingerprint` (for the submit-time fingerprint re-check)
- `PreparedTxSafeTypedData` (for the approve flow's handle-mint)
- `FIXTURE_SAFE_A_HASH` + `FIXTURE_SAFE_D_FP` (for byte-identity cross-link)

Plan 37-03 (`prepare_safe_tx_execute` + 3-step integration test) imports:
- `_safeChains.getOnchainDomainSeparator` (for execute-time cross-check)
- All fixtures (the integration test re-anchors byte-identity across the
  propose-approve-execute flow)

Self-Check: PASSED

```
$ ls src/signing/safe-tx-hash.ts src/tools/prepare_safe_tx_propose.ts test/signing-safe-tx-hash.test.ts test/handle-store.safe-typed-data.test.ts test/prepare-safe-tx-propose.test.ts
(all 5 files exist)

$ git log --oneline -3
1b26ca8 feat(37): prepare_safe_tx_propose + WC eth_signTypedData_v4 namespace + safe.ts domainSeparator
de07829 feat(37): PreparedTxSafeTypedData discriminant + handle-store union widening
905a95e feat(37): safe-tx-hash + VaultPilot-safetx-v1 fingerprint + Fixtures SAFE-A/B/C/D
```
