---
phase: 39
slug: bridge-tier-1-facet-decoders-final-recipient-assertion
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-05-28
---

# Phase 39 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Derived from 39-RESEARCH.md § Validation Architecture. Task IDs are assigned at planning; this draft maps at requirement granularity.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest (existing) |
| **Config file** | `vitest.config.ts` (existing) |
| **Quick run command** | `npx vitest run test/bridge-decoders-*.test.ts` |
| **Full suite command** | `npx vitest run` |
| **Estimated runtime** | ~quick: a few s; full suite: existing ~4850-test baseline |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run test/bridge-decoders-*.test.ts` (+ `test/preview-send.bridge-tier1.test.ts` once it exists)
- **After every plan wave:** Run `npx vitest run`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** < 30 seconds (quick); full suite per wave

---

## Per-Requirement Verification Map

| Requirement | Behavior | Test Type | Automated Command | File Exists | Status |
|-------------|----------|-----------|-------------------|-------------|--------|
| BRIDGE-T1-01 | Wormhole `transferTokensWithPayload`: decode recipient bytes32 (EVM last-20-bytes case) | unit | `npx vitest run test/bridge-decoders-wormhole.test.ts` | ❌ W0 | ⬜ pending |
| BRIDGE-T1-01 | Wormhole: decode recipient bytes32 (Solana full-32-byte → bs58 case) | unit | `npx vitest run test/bridge-decoders-wormhole.test.ts` | ❌ W0 | ⬜ pending |
| BRIDGE-T1-01 | Wormhole: selector mismatch → `{ kind: "error" }`, no throw | unit | `npx vitest run test/bridge-decoders-wormhole.test.ts` | ❌ W0 | ⬜ pending |
| BRIDGE-T1-02 | Mayan Swift: decode `destAddr` from `createOrderWithEth` (struct idx 0) | unit | `npx vitest run test/bridge-decoders-mayan-swift.test.ts` | ❌ W0 | ⬜ pending |
| BRIDGE-T1-02 | Mayan Swift: decode `destAddr` from `createOrderWithToken` (struct idx 2) | unit | `npx vitest run test/bridge-decoders-mayan-swift.test.ts` | ❌ W0 | ⬜ pending |
| BRIDGE-T1-03 | NEAR OmniBridge: decode receiver string; case-insensitive `.toLowerCase().trim()` compare | unit | `npx vitest run test/bridge-decoders-near-omnibridge.test.ts` | ❌ W0 | ⬜ pending |
| BRIDGE-T1-04 | Across V3 `depositV3`: decode recipient EVM `address` via `getAddress()` | unit | `npx vitest run test/bridge-decoders-across-v3.test.ts` | ❌ W0 | ⬜ pending |
| BRIDGE-T1-05 | Mismatch refusal text names bridge + decoded + supplied; errEnvelope `DECODED_RECIPIENT_DRIFT` | unit | `npx vitest run test/preview-send.bridge-tier1.test.ts` | ❌ W0 | ⬜ pending |
| BRIDGE-T1-05 | Malformed/truncated calldata → preview returns `isError: true` (no throw) | integration | `npx vitest run test/preview-send.bridge-tier1.test.ts` | ❌ W0 | ⬜ pending |
| (T1-06)* | DEX swap (Uniswap/Curve/SunSwap) calldata: no-match → Layer 0.6 no-op | integration | `npx vitest run test/preview-send.bridge-tier1.test.ts` | ❌ W0 | ⬜ pending |
| (T1-06)* | Layer ordering: 0.6 fires AFTER 0.5 canonical-dispatch, BEFORE Layer 2 chain-mismatch | unit | `npx vitest run test/preview-send.bridge-tier1.test.ts` | ❌ W0 | ⬜ pending |

\* BRIDGE-T1-06 is in REQUIREMENTS.md but not in the ROADMAP phase req-ID set (T1-01..05). Covered by the Wave-2 wiring plan; tracked here for completeness.

---

## Wave 0 Requirements

- [ ] `test/bridge-decoders-wormhole.test.ts` — stubs for BRIDGE-T1-01 (EVM + Solana + mismatch cases)
- [ ] `test/bridge-decoders-mayan-swift.test.ts` — stubs for BRIDGE-T1-02 (both selectors; Mayan fixture labeled SYNTHETIC)
- [ ] `test/bridge-decoders-near-omnibridge.test.ts` — stubs for BRIDGE-T1-03
- [ ] `test/bridge-decoders-across-v3.test.ts` — stubs for BRIDGE-T1-04
- [ ] `test/preview-send.bridge-tier1.test.ts` — stubs for BRIDGE-T1-05 + Layer-ordering + no-op
- [ ] `src/signing/error-codes.ts` — append `"DECODED_RECIPIENT_DRIFT"` to the `ErrorCode` union (append-only)
- [ ] `src/signing/blocks.ts` — add `DECODED_RECIPIENT_DRIFT_TEMPLATE`
- [ ] `src/protocols/bridge-decoders/index.ts` — selector→decoder registry (with `_`-indirection ESM spy seam)
- [ ] Handle-store widening — carry user-supplied `toAddress` on the EVM handle for the Layer 0.6 comparand

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Real-Ledger end-to-end bridge-tx refusal display | BRIDGE-T1-05 | Requires paired hardware + a live bridge tx; deferred to bundled HUMAN-UAT per project cadence | Construct a bridge prepare with mismatched recipient; confirm `[REFUSED — DECODED RECIPIENT DRIFT]` surfaces before any device prompt |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
