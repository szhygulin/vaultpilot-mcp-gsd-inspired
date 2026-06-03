---
phase: 49
slug: bittensor-diagnostics
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-06-03
---

# Phase 49 — Validation Strategy

> Per-phase validation contract. Smallest phase: 1 diagnostic tool (clone of get_tron_setup_status) + SECURITY.md v2.7 close-out section. Derived from 49-RESEARCH.md §Validation Architecture.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest (shipped) |
| **Config file** | repo root (existing vitest setup) |
| **Quick run command** | `npx vitest run test/get-bittensor-setup-status.test.ts --no-coverage` |
| **Full suite command** | `npx vitest run` |
| **Estimated runtime** | ~3s quick |

---

## Sampling Rate

- **After every task commit:** the quick command.
- **After every plan wave:** the full suite (incl. FROZEN regression suites).
- **Before `/gsd-verify-work`:** full suite green + FROZEN zero-diff (the binding modules + send_transaction three-gate are NOT touched — this phase adds 1 tool + at most 1 additive `_transport` helper + docs).
- **Max feedback latency:** < 15s.

---

## Per-Task Verification Map

| Req ID | Behavior | Test Type | Automated Command | File Exists | Status |
|--------|----------|-----------|-------------------|-------------|--------|
| TAO-DIAG-01 | Happy path: all 3 arms fulfilled → full envelope `{ledgerPolkadotAppVersion, walletAddressOnDevice, stakePositionsPresent}` | unit | `npx vitest run test/get-bittensor-setup-status.test.ts -t "all arms"` | ❌ W0 | ⬜ pending |
| TAO-DIAG-01 | ARM A (RPC) reject → `stakePositionsPresent:false` + `rpcDegraded`; others intact | unit | `… -t "rpc arm"` | ❌ W0 | ⬜ pending |
| TAO-DIAG-01 | ARM B (USB-HID) reject → `walletAddressOnDevice:null` + `deviceStatus`; others intact | unit | `… -t "usb-hid arm"` | ❌ W0 | ⬜ pending |
| TAO-DIAG-01 | ARM C (app-version) reject → `ledgerPolkadotAppVersion:null`; others intact | unit | `… -t "app-version arm"` | ❌ W0 | ⬜ pending |
| TAO-DIAG-01 | **No boot RPC:** `_bittensorRegistry.getApi` NOT called until the tool is invoked | unit | `… -t "no boot rpc"` | ❌ W0 | ⬜ pending |
| TAO-DIAG-01 | No-pairing → `INVALID_INPUT + hintTool` (no probe fired; error union FROZEN) | unit | `… -t "no pairing"` | ❌ W0 | ⬜ pending |
| TAO-DIAG-01 | SECURITY.md `## v2.7 Bittensor` section present + content (blind-sign residual + CheckMetadataHash + verify-phase-scope phrases) | smoke (grep/doc) | `npx vitest run test/security-doc.bittensor.test.ts` | ❌ W0 | ⬜ pending |

*Test seams (all shipped): `vi.spyOn(_bittensorRegistry,"getApi")` (ARM A — assert NOT called pre-invocation), `vi.spyOn(_transport, "getAddressEd25519ViaApp"|"getVersionViaApp"|"open")` (ARMs B/C), `vi.spyOn(non-evm-account-store,"listAccounts")` (pairing). Each arm tested INDEPENDENTLY: reject one seam, assert ONLY its field demotes + the others stay populated. NO live RPC/transport.*

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `test/get-bittensor-setup-status.test.ts` — the 6 arm/behavior cases above (spy the 3 shipped seams; assert no-boot-RPC; each demote-to-null arm independent)
- [ ] SECURITY.md `## v2.7 Bittensor` presence/content assertion — a focused grep test OR `test/security-doc.bittensor.test.ts` reading SECURITY.md and asserting the heading + the blind-sign-residual + `CheckMetadataHash` + verify-phase-scope phrases
- [ ] (no framework install — vitest shipped)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Real-Ledger Polkadot-Generic-app version + on-device address verify | TAO-DIAG-01 | Physical device | v2.7 verify-phase: run `get_bittensor_setup_status` against a paired device, confirm `ledgerPolkadotAppVersion` matches the device's app + `walletAddressOnDevice` matches the on-screen SS58 |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 15s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
