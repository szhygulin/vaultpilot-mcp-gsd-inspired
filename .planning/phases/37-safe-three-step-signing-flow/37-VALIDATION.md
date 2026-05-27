---
phase: 37
slug: safe-three-step-signing-flow
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-05-27
---

# Phase 37 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution. Populated by the planner with Per-Task Verification Map rows after each PLAN.md is written.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 1.x (project default per `package.json`) |
| **Config file** | `vitest.config.ts` (existing) |
| **Quick run command** | `npm test -- --run test/signing-safe-tx-hash.test.ts test/prepare-safe-tx-propose.test.ts test/prepare-safe-tx-approve.test.ts test/submit-safe-tx-signature.test.ts test/prepare-safe-tx-execute.test.ts test/signing-fingerprint.test.ts` |
| **Full suite command** | `npm test -- --run` |
| **Estimated runtime** | Quick: ~12s · Full: ~90s |

---

## Sampling Rate

- **After every task commit:** Run the relevant per-file quick command (single `*.test.ts` file).
- **After every plan wave:** Run the full suite (W1: 37-01 quick suite; W2: 37-02 quick suite; W3: 37-03 full integration).
- **Before `/gsd-verify-work`:** Full suite must be green.
- **Max feedback latency:** ~12 seconds (quick).

---

## Per-Task Verification Map

> Populated by the planner after each PLAN.md is written. Each task row maps to its source `*.test.ts` file + an `npm test -- --run <file>` automated command.

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| _TBD by planner_ |  |  |  |  |  |  |  |  |  |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `test/signing-safe-tx-hash.test.ts` — stubs for Fixtures SAFE-A / SAFE-B / SAFE-C
- [ ] `test/signing-fingerprint.test.ts` — extends existing file with Fixture SAFE-D (`VaultPilot-safetx-v1:` preimage)
- [ ] `test/prepare-safe-tx-propose.test.ts` — stubs for SAFE-05 acceptance
- [ ] `test/prepare-safe-tx-approve.test.ts` — stubs for SAFE-06 acceptance
- [ ] `test/submit-safe-tx-signature.test.ts` — stubs for SAFE-07 acceptance
- [ ] `test/prepare-safe-tx-execute.test.ts` — stubs for SAFE-08 acceptance
- [ ] `test/integration/safe-three-step-flow.test.ts` — end-to-end propose → submit → approve × N → submit × N → execute integration test
- [ ] `test/clients-safe-tx-service.test.ts` — extend existing file with `postSignature` happy / 429 / 500 / unsupported-chain paths

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Ledger ETH app typed-data sign-display | SAFE-05 / SAFE-06 | Requires physical Ledger device + Safe deployment; no automated harness | Real-Ledger UAT — bundled per Phase 36 close-out cadence: pair Ledger → `prepare_safe_tx_propose({ chain: "ethereum", safeAddress: <user's 1-of-1 mainnet Safe>, to, value, data: "0x", operation: "call" })` → invoke `eth_signTypedData_v4` via WC → confirm Ledger ETH app displays the 32-byte safeTxHash (clear-sign if CAL covers Safe; blind-sign otherwise) → sign → `submit_safe_tx_signature` → confirm Tx Service shows the signature |
| WalletConnect `eth_signTypedData_v4` namespace compatibility | SAFE-05 / SAFE-06 | Requires Ledger Live + WC v2 bridge running | Same flow as above; verify no `eth_signTypedData_v4` method-not-supported error on the post-Phase 37 pairing |
| `prepare_safe_tx_execute` real-Ledger sign + mainnet broadcast | SAFE-08 | Real ETH consumption | After 2-of-3 SafeTx collects threshold, `prepare_safe_tx_execute` → `preview_send` → `send_transaction` with small-value mainnet broadcast |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 15s (quick)
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
