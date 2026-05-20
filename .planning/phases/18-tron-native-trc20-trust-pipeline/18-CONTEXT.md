# Phase 18: TRON native + TRC-20 trust pipeline — Context

**Gathered:** 2026-05-20
**Status:** Placeholder — context-gathering pending (run `/gsd-discuss-phase 18`)

<domain>
## Phase Boundary

Full prepare → preview → send flow works for native TRX and TRC-20 transfers, with TRON-specific `payloadFingerprint` over serialized Protobuf raw_data bytes (domain-tagged `"VaultPilot-trontx-v1:"`), SHA-256 blind-sign hash recompute (TRON consensus hash, not keccak256), and Ledger TRX-app clear-sign coverage. The trust pipeline mirrors v1.x EVM + v2.0 Solana shape but with TRON-specific primitives.

This is the load-bearing milestone for v2.1 — the TRON trust pipeline mirror of Phase 4 (Ethereum) and Phase 12 (Solana). Phase 19+ extends with approvals, staking, swaps, and bridging — all reusing this pipeline.

</domain>

<decisions>
## Implementation Decisions

Pending — to be gathered during `/gsd-discuss-phase 18`. Anchor candidates:

- **Fingerprint preimage shape**: `keccak256("VaultPilot-trontx-v1:" ‖ <serialized Protobuf raw_data bytes>)`. Domain-tag distinct from EVM and Solana so cross-chain fingerprint reuse is impossible by construction. Researcher to verify the raw_data byte-order and field-encoding stability across tronweb versions at execute time (DF — Protobuf serialization can vary on field-ordering rules).
- **Blind-sign hash**: SHA-256 over raw_data (NOT keccak256 — TRON consensus uses SHA-256 internally for tx-id derivation). The Ledger TRX app displays this hash on-screen for blind-sign mode.
- **Layer 0.7 simulation gate**: TRON `triggerconstantcontract` is the analog of EVM `eth_call` for TRC-20 calls. Native sends (TransferContract) have no simulation API — Layer 0.7 skips them. Phase 12 Solana set the Layer 0.7 precedent; Phase 18 extends it.
- **Decimal handling**: `parseTronAmountStrict` mirrors `parseAmountStrict` (Phase 6) + `parseSolanaAmountStrict` (Phase 12). Same pre-filter discipline: validate-before-delegate, throw on excess precision.
- **Ref-block pinning**: prepare-time captures `block_header.ref_block_bytes` + `ref_block_hash`. The 1-hour TRON ref-block window is shorter than EVM's nonce window; `get_tx_verification` 15-min TTL is well within bounds.
- **Fixture pinning**: Fixture K (native TRX transfer) + Fixture L (TRC-20 transfer) hardcoded as `0x...` literals in `test/signing-fingerprint.test.ts` per CLAUDE.md convention. Persona-cycle integration test re-anchors byte-identity across persona swaps (sender-independent for native TRX; sender-dependent for TRC-20 where calldata embeds sender via `from` parameter).

### Claude's Discretion

- TronWeb vs `@tronprotocol/sdk` choice — researcher to lock at execute time per DF probe
- Internal helper names (`encodeTronTransferContract`, etc.)
- Whether SECURITY.md TRON section ships in this phase or splits across Phases 17-21

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project context
- `CLAUDE.md` — fingerprint conventions; FROZEN-area discipline
- `.planning/REQUIREMENTS.md` §TRON-PREP-* + §TRON-W-01/02 — exact Phase 18 surface
- `.planning/ROADMAP.md` Phase 18 — Goal / Success Criteria / Plans

### Pattern references (v1.x + v2.0 precedents to mirror)
- `src/signing/payload-fingerprint.ts` (Plan 04-01) — EVM fingerprint; FROZEN; Phase 18 adds TRON sibling
- `src/signing/solana-fingerprint.ts` (Plan 12-01) — Solana fingerprint; sibling shape Phase 18 mirrors with TRON domain tag
- `src/protocols/solana-system.ts` + `src/protocols/solana-spl.ts` (Phase 12) — native + token-program encoder pattern Phase 18 mirrors
- `src/signing/amount.ts` `parseAmountStrict` (Phase 6) — decimal pre-filter shape Phase 18 clones for `parseTronAmountStrict`
- Fixtures A/D/I/J (test/signing-fingerprint.test.ts) — hardcoded `0x...` literal pattern Phase 18 extends with Fixture K/L

### External
- tronweb API for raw_data serialization (researcher to verify)
- TRON Protobuf specs — https://github.com/tronprotocol/protocol
- Ledger TRX app source — for blind-sign hash format reference

</canonical_refs>

<specifics>
## Specific Ideas

- Phase 12 Solana set the Layer 0.7 pattern: simulation gate sits between Layer 0.5 (canonical dispatch) and Layer 2 (chain-mismatch). Phase 18 TRON branch slots in at the same layer with `triggerconstantcontract` for TRC-20 calls.
- Persona-cycle byte-identity test shape: native TRX is sender-independent (sender NOT in raw_data — TransferContract embeds it but the fingerprint preimage is the bytes including sender, so fingerprint IS sender-dependent — researcher needs to verify and Phase 18 plan-checker confirms which shape applies). TRC-20 transfer is calldata-embedded sender → persona-deterministic + cross-persona-distinct (matches Phase 7 Aave T-INTEGRATION-FROM-DRIFT-2 shape).
- SECURITY.md updates: TRON Protobuf raw_data hash vs EVM RLP keccak256 distinction; TRX blind-sign mode behavior; TRC-20 clear-sign coverage gap (if any) as documented residual.
- `prepare_tron_*` MUST NOT inline the TRX app's idiosyncratic display format — Ledger TRX app may show abbreviated addresses on small screens; the `LEDGER BLIND-SIGN HASH` block + `PREPARE RECEIPT` block remain the byte-faithful source-of-truth.

</specifics>

<deferred>
## Deferred Ideas

- TRC-20 approve + revoke — Phase 19 (this phase ships the trust pipeline; approve is the first non-trivial consumer)
- Stake 2.0 contracts — Phase 19
- SunSwap + LiFi TRON bridging — Phase 20
- TRON multi-address-per-chain support — verify-phase feedback driven
- TRON-USDT-resource-fee abstraction (TRON's "energy" rental model) — defer; surface in CHECKS PERFORMED as informational, not as a refusal gate

</deferred>

---

*Phase: 18-tron-native-trc20-trust-pipeline*
*Context placeholder: 2026-05-20 (full context-gathering at `/gsd-discuss-phase 18` time)*
