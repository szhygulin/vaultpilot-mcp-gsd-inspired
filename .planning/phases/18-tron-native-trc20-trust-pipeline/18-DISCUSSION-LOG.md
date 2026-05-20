# Phase 18: TRON native + TRC-20 trust pipeline - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-20
**Phase:** 18-tron-native-trc20-trust-pipeline
**Areas discussed:** Fingerprint preimage; Blind-sign hash; Layer 0.7 simulation gate; Ledger TRX-app clear-sign; Persona-cycle byte-identity; Ref-block pinning; Decimal handling; Fixture letters; Test file location; send_transaction TRON branch; Canonical dispatch TRON arm; SECURITY.md update scope

**Mode:** auto-mode (per CLAUDE.md `feedback_auto_mode.md` + global Auto Mode reminder + user explicit "go ahead" after `/gsd-progress phase 18` route). No interactive AskUserQuestion calls. Each gray area resolved by reasonable-default-with-precedent.

---

## Fingerprint preimage shape

| Option | Description | Selected |
|--------|-------------|----------|
| keccak256(domain-tag ‖ raw_data_hex_bytes) | Mirrors Solana shape (Phase 12 K + L); single hash function for cross-chain consistency on the VaultPilot-side | ✓ |
| keccak256(domain-tag ‖ outer-transaction-bytes) | Includes signature[] slots which fill post-prepare → preimage instability across prepare → send | |
| SHA-256(domain-tag ‖ raw_data_bytes) | Matches TRON consensus tx-id; collapses fingerprint + blind-sign hash into one value → loses domain-tagging cross-chain distinction | |

**Choice:** keccak256(`"VaultPilot-trontx-v1:"` ‖ raw_data_bytes).
**Why:** Domain-tag uniqueness across EVM (`"VaultPilot-txverify-v1:"`) + Solana (`"VaultPilot-soltx-v1:"`) + TRON (`"VaultPilot-trontx-v1:"`) makes cross-chain fingerprint reuse impossible by construction. Same hash function as EVM + Solana on the VaultPilot side keeps the cryptographic-binding chain coherent. The Ledger-side hash is decoupled (SHA-256 per consensus) — different concern, different decision (D-02).

---

## Blind-sign hash recompute

| Option | Description | Selected |
|--------|-------------|----------|
| SHA-256(raw_data_bytes) | TRON consensus tx-id; what the Ledger TRX app displays on blind-sign mode | ✓ |
| keccak256(raw_data_bytes) | Inconsistent with TRON consensus; the on-device display would diverge from agent-relayed value | |

**Choice:** SHA-256 over raw_data_bytes.
**Why:** TRON consensus defines tx-id as `sha256(raw_data)`. The Ledger TRX app displays this hash literally. Computing anything else means the on-device hash diverges from the agent-relayed `LEDGER BLIND-SIGN HASH` value, breaking Inv #5 (final on-device match). Same input bytes as `payloadFingerprint` per D-01 (Solana pattern — preimage shared across two different hash functions).

---

## Layer 0.7 simulation gate

| Option | Description | Selected |
|--------|-------------|----------|
| Mandatory `triggerconstantcontract` for TRC-20; explicit no-sim advisory for native TRX | Asymmetric per TRON's actual capability surface; visible to the agent + user | ✓ |
| Mandatory simulation for both; native TRX simulates with no-op | TRON has no simulation API for native sends — would require fabricating a fake gate | |
| Skip Layer 0.7 entirely for TRON | Loses TRC-20 revert detection at preview time | |

**Choice:** TRC-20 mandatory `triggerconstantcontract`; native TRX surfaces `[NO SIMULATION AVAILABLE — native TRX transfer]` advisory in `CHECKS PERFORMED` without refusing.
**Why:** TRON's native `TransferContract` doesn't go through the TVM, so there's no simulation surface. Fabricating a no-op gate would hide the asymmetry. Surfacing the advisory visibly + relying on PREPARE RECEIPT (Inv #2) + LEDGER BLIND-SIGN HASH (Inv #5) for native sends is the documented-residual approach used elsewhere (Phase 6 WETH9.withdraw; Phase 28 Compound LEDGER NOTICE). SECURITY.md TRON section documents the asymmetry explicitly.

---

## Ledger TRX-app clear-sign coverage

| Option | Description | Selected |
|--------|-------------|----------|
| Conditional `LEDGER NOTICE` block — emit only when calldata target is outside TRX-app clear-sign registry | Mirrors Phase 6 WETH9.withdraw + Phase 28 Compound NOTICE precedent | ✓ |
| Always emit a NOTICE block for TRC-20 calls | Over-warns on the clear-sign happy path | |
| Never emit a NOTICE block | Phases 19+ (approve, Stake 2.0) NEED the plumbing for outside-CAL targets | |

**Choice:** Conditional NOTICE; plumb the template through `blocks-tron.ts` in Plan 18-04 even though the Phase 18 surface (USDT/USDC/USDD/TUSD per Phase 17 curated set) has 100% clear-sign coverage.
**Why:** The plumbing is load-bearing for Phase 19's approve-out-of-CAL case and Phase 20's SunSwap (NOT in CAL). Pre-staging the template + conditional emit logic in Phase 18 keeps Phase 19+ additive-only.

---

## Persona-cycle byte-identity

| Option | Description | Selected |
|--------|-------------|----------|
| Native TRX + TRC-20 both sender-dependent | Persona swap changes raw_data (owner_address Protobuf field) → fingerprint shifts | ✓ |
| Native TRX sender-independent (Solana-shape) | Incorrect — Solana native SOL is also sender-dependent in practice; the structural reason differs but the cycle behavior matches | |

**Choice:** Both arms sender-dependent. Persona-cycle integration test mirrors Phase 7 Aave `T-INTEGRATION-FROM-DRIFT-2` shape.
**Why:** TRON `TransferContract` includes `owner_address` as a Protobuf field inside raw_data. `TriggerSmartContract.transfer(to, amount)` calldata does NOT embed the sender (ABI-identical to ERC-20), but the wrapping `TriggerSmartContract` Protobuf message DOES include `owner_address`. Both end up sender-dependent through the wrapping Protobuf field.

---

## Ref-block pinning

| Option | Description | Selected |
|--------|-------------|----------|
| Pin block_header at prepare; surface in PREPARE RECEIPT; refuse-with-expiry at network | TRON network refuses expired txs at broadcast; 1-hour window > `get_tx_verification` 15-min TTL | ✓ |
| Repin at send time | Breaks fingerprint stability (raw_data bytes change → fingerprint shifts) | |
| Skip ref-block handling | tronweb requires it; would cause broadcast failures | |

**Choice:** Pin at prepare; surface verbatim in PREPARE RECEIPT; rely on network-side refusal for expiry.
**Why:** Fingerprint stability requires raw_data to be byte-identical across prepare → preview → send. Repinning at send time would break Inv #5 (the device would compute a different blind-sign hash from what was previewed). The 1-hour ref-block window comfortably exceeds the 15-min handle TTL.

---

## Decimal handling

| Option | Description | Selected |
|--------|-------------|----------|
| `parseTronAmountStrict` in new `amount-tron.ts` sibling | Mirrors `parseAmountStrict` (Phase 6) + `parseSolanaAmountStrict` (Phase 12) | ✓ |
| Extend `parseAmountStrict` with a chain param | Couples EVM + Solana + TRON into one function — harder to reason about | |

**Choice:** New sibling file. Validate-before-delegate discipline same as the two precedents.
**Why:** Same pattern Phase 12 used. Each chain's decimals + sign rules stay locally readable; the cross-chain helper would force conditional logic the call sites don't need.

---

## Fixture letters

| Option | Description | Selected |
|--------|-------------|----------|
| M (native TRX) + N (TRC-20) | Sequential after Solana's K + L; uses the implicit M-Q reservation gap Phase 28 left | ✓ |
| V + W (sequential after Compound's U) | Skips the M-Q gap entirely → leaves a permanent "what was M-Q for?" question | |
| Reuse K + L with TRON namespace prefix | Breaks the single-letter literal-anchor convention | |

**Choice:** Fixture M (native TRX) + Fixture N (TRC-20) as hardcoded `0x...` literals.
**Why:** Phase 28's choice of R-U over M-Q implicitly reserved M-Q for non-EVM chains (Solana took K + L; BTC/LTC may take O + P + Q later). M + N is the next-sequential available gap. New sibling test file `test/signing-fingerprint-tron.test.ts` (mirrors Phase 12's Solana carve).

---

## Test file location

| Option | Description | Selected |
|--------|-------------|----------|
| New sibling file `test/signing-fingerprint-tron.test.ts` | Mirrors Phase 12 Solana carve; TRON Protobuf shape is structurally distinct from EVM RLP | ✓ |
| Append Fixtures M + N to `test/signing-fingerprint.test.ts` | Pollutes the EVM-only file with Protobuf fixtures | |
| Append to `test/signing-fingerprint-solana.test.ts` | Wrong non-EVM bucket — Solana ≠ TRON Protobuf | |

**Choice:** New sibling file. Integration test in new `test/trust-pipeline-tron.integration.test.ts` (mirrors Phase 12's Solana integration test file).
**Why:** Same structural distinction Phase 12 used. Each chain's preimage assembly stays locally readable; cross-chain test files would force conditional shape logic.

---

## send_transaction TRON branch

| Option | Description | Selected |
|--------|-------------|----------|
| Additive `"tron"` arm on the `txType` switch; TRON branch broadcasts via `tronweb.trx.sendRawTransaction` | Three-gate FROZEN region byte-untouched; transport-specific broadcast in the branch | ✓ |
| Refactor `send_transaction.ts` to a per-chain dispatcher class | Touches the FROZEN three-gate region; violates Phase 12's invariant | |

**Choice:** Additive branch matching Phase 12's Solana extension.
**Why:** The three-gate region (`previewToken` + `userDecision: "send"` + `payloadFingerprint` drift check) is the load-bearing FROZEN invariant. Phase 12 demonstrated the additive third-arm extension works without touching the gate. Phase 18 replicates exactly.

---

## Canonical dispatch — TRON arm

| Option | Description | Selected |
|--------|-------------|----------|
| New `src/security/canonical-dispatch-tron.ts` sibling | Mirrors Solana sibling shape; EVM allowlist untouched | ✓ |
| Extend `canonical-dispatch.ts` with TRON arm | Forces EVM file to know about Protobuf shape | |

**Choice:** New sibling file. Allowlist: USDT-TRC20, USDC-TRC20, USDD, TUSD (Phase 17 `tron-top-25.json` SOT). Native TRX `TransferContract` skips allowlist check by `txType` discrimination.
**Why:** Same architecture Phase 12 used for Solana. Each chain's dispatch surface stays locally readable. EVM Compound allowlist (Phase 28; 6 Comets) byte-untouched.

---

## SECURITY.md update scope

| Option | Description | Selected |
|--------|-------------|----------|
| Ship the TRON SECURITY.md section in the integration plan (Plan 18-04); 6 sub-sections | One coordinated update with all the threat-model framings landed | ✓ |
| Append per plan as each piece lands | Fragmented narrative; harder to review the threat model coherently | |
| Defer SECURITY.md update entirely to Phase 21 close-out | Inv #5 / Inv #2 framing for TRON should land WITH the trust pipeline | |

**Choice:** Ship in Plan 18-04 with 6 sub-sections (USB-HID transport; Protobuf vs RLP; SHA-256 vs keccak256; TRX clear-sign; Layer 0.7 asymmetry; ref-block window).
**Why:** Mirrors Phase 12's Solana SECURITY.md update placement (with the trust pipeline integration plan, not split across plans). Future Phase 19+ extends with protocol-specific notes (approve unlimited surfacing, Stake 2.0 semantics, SunSwap MEV defense).

---

## Claude's Discretion

- Internal helper names (`encodeTronTransferContract`, `encodeTronTriggerSmartContract`, etc.)
- Exact assertion shape for a Fixture J–style chain-distinctness property test extension covering TRON alongside Solana + 5 EVM chains — defer to plan-checker; not load-bearing for Phase 18 alone
- Whether `_tronChains` ESM spy indirection lives in a single module or per-helper — per Phase 28 `_compoundChains` precedent, researcher's call at execute time
- Test mocking strategy for USB-HID TRX-app — reuse the Phase 11/12 mock-transport pattern

## Deferred Ideas

- TRC-20 approve + revoke + unlimited-approval surfacing — Phase 19
- Stake 2.0 (FreezeBalanceV2 / unfreeze / vote / claim) — Phase 19
- SunSwap V2 + LiFi TRON bridging + Inv #6b extension — Phase 20
- TRON setup-status diagnostic + SECURITY.md finalization — Phase 21
- Multi-address-per-chain TRON Ledger flow — verify-phase feedback driven
- TRC-721 / TRC-1155 NFT reads — out of scope for v2.x (general NFT support is v3.1)
- Fixture J–style chain-distinctness property test extension (TRON + Solana + 5 EVM in one set-distinctness assertion) — stretch goal or separate cross-cutting hardening phase
