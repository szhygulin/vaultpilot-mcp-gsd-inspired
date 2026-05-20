# Phase 18: TRON native + TRC-20 trust pipeline — Context

**Gathered:** 2026-05-20
**Status:** Ready for planning

<domain>
## Phase Boundary

Full `prepare → preview → send` flow for **native TRX transfers** (TransferContract) and **TRC-20 transfers** (TriggerSmartContract `transfer(to, amount)`). The v2.1 trust-pipeline mirror of Phase 4 (Ethereum) and Phase 12 (Solana).

TRON-specific primitives:
- **`payloadFingerprint`** = `keccak256("VaultPilot-trontx-v1:" ‖ <serialized Protobuf raw_data bytes>)` — domain-tag distinct from EVM (`"VaultPilot-txverify-v1:"`) and Solana (`"VaultPilot-soltx-v1:"`), so cross-chain fingerprint reuse is impossible by construction
- **Ledger blind-sign hash recompute** = `SHA-256(raw_data_bytes)` — TRON consensus uses SHA-256 (not keccak256) for tx-id derivation; the TRX app displays this hash on-screen in blind-sign mode
- **Layer 0.7 simulation gate**: asymmetric — TRC-20 mandatory `triggerconstantcontract` gate (refuses on revert); native TRX has no simulation API, surfaces explicit `[NO SIMULATION AVAILABLE — native TRX transfer]` advisory at preview (NOT a refusal — TransferContract is simple enough that PREPARE RECEIPT + blind-sign hash recompute are sufficient defense)
- **Ref-block pinning**: prepare-time captures `block_header.ref_block_bytes` + `ref_block_hash`. TRON's 1-hour ref-block window is shorter than EVM's nonce window but well outside `get_tx_verification`'s 15-min TTL

This phase ships the load-bearing TRON trust pipeline. Phases 19-21 build on it: TRC-20 approve + Stake 2.0 (Phase 19), SunSwap + LiFi bridging (Phase 20), TRON setup-status diagnostic + portfolio remainder (Phase 21).

**Out of Phase 18:** TRC-20 approve, revoke, and Stake 2.0 (FreezeBalanceV2 / unfreeze / vote / claim) — all Phase 19. SunSwap + LiFi — Phase 20.

</domain>

<decisions>
## Implementation Decisions

### Fingerprint preimage shape (D-01)

- **D-01a:** `payloadFingerprint = keccak256("VaultPilot-trontx-v1:" ‖ raw_data_bytes)` where `raw_data_bytes` is the canonical serialized Protobuf bytes of `transaction.raw_data` produced by `tronweb` (locked at Phase 17 — `tronweb@6.3.0`). The bytes are obtained via `Buffer.from(tx.raw_data_hex, "hex")` after `tronweb.transactionBuilder.*` produces the transaction. NOT the wrapping `transaction` envelope — only `raw_data`, because TRON consensus computes tx-id over `raw_data` only.
- **D-01b:** Domain tag literal `"VaultPilot-trontx-v1:"` (ASCII bytes, no trailing NUL). Distinct from EVM `"VaultPilot-txverify-v1:"` and Solana `"VaultPilot-soltx-v1:"`. Domain-tag uniqueness asserted at test time (a Fixture J–style chain-distinctness property test extension covering tron alongside the existing 5 EVM chains + Solana would be ideal but is **NOT required** in Phase 18 — Fixture J is a v1.2 single-chain-id property test; adding a multi-chain-architecture test family is its own scope).
- **D-01c:** Excludes the `signature[]` field of the outer `transaction` envelope (signatures fill post-prepare, by construction). Preimage stable across prepare → preview → send.

### Blind-sign hash recompute (D-02)

- **D-02a:** `ledgerBlindSignHash = SHA-256(raw_data_bytes)` — SAME input bytes as `payloadFingerprint`, different hash function. This is the TRON tx-id per consensus and what the Ledger TRX app displays on-screen in blind-sign mode.
- **D-02b:** Same input as fingerprint matches the Solana pattern (Phase 12 — message bytes hashed twice, once with keccak256 for VaultPilot fingerprint and once with SHA-256 for Ledger display). EVM is the outlier (different preimages for fingerprint vs presign — the EVM presign-hash is `keccak256(rlp_serialized_tx)` which differs in structure from the fingerprint preimage).

### Layer 0.7 simulation gate (D-03)

- **D-03a:** TRC-20 (`TriggerSmartContract`) — mandatory `triggerconstantcontract` RPC call against TronGrid (or `TRON_RPC_URL` override). Refuses with `SIMULATION_REFUSED` (errorCode 16 — additive-reuse of Phase 12's code; same shape, different chain) on `result.code !== "SUCCESS"`. Simulation envelope (`energy_used`, `constant_result`, `result`) goes into `CHECKS PERFORMED` verbatim.
- **D-03b:** Native TRX (`TransferContract`) — NO simulation API. `preview_send` emits `[NO SIMULATION AVAILABLE — native TRX transfer]` advisory inside `CHECKS PERFORMED`. NOT a refusal. PREPARE RECEIPT (Inv #2) + LEDGER BLIND-SIGN HASH (Inv #5) carry the defense. This is intentional asymmetry with Solana (where `simulateTransaction` works on all txs); the asymmetry is documented in SECURITY.md TRON section.
- **D-03c:** Layer 0.7 simulation gate lives in `src/signing/simulation-tron.ts` (new sibling module — mirrors `simulation-solana.ts` shape exactly). FROZEN EVM `simulation.ts` byte-untouched.

### Ledger TRX-app clear-sign coverage (D-04)

- **D-04a:** TRX app v0.5+ (per `ledger-app-tron` source) clear-signs both `TransferContract` (native) and `TriggerSmartContract.transfer(to, amount)` (TRC-20) for known TRC-20 contracts in the app's bundled token registry (USDT-TRC20, USDC-TRC20, USDD, TUSD per Phase 17's `tron-top-25.json` curated set).
- **D-04b:** Conditional `LEDGER NOTICE` block emitted at preview ONLY when the calldata target is OUTSIDE the TRX-app clear-sign registry (mirrors Phase 6 WETH9.withdraw + Phase 28 Compound LEDGER_NOTICE_COMPOUND_TEMPLATE pattern). For Phase 18's TRC-20 set, the registry hit-rate should be 100%; the conditional plumbing lands here so Phase 19's approve/Stake 2.0 (mostly NOT in CAL) and Phase 20's SunSwap (NOT in CAL) can reuse it.
- **D-04c:** Plan 18-04 includes a `LEDGER_NOTICE_TRON_TEMPLATE` constant in `src/signing/blocks-tron.ts` even though Phase 18 itself rarely emits it — pre-staged for Phase 19+ consumers, append-only.

### Persona-cycle byte-identity (D-05)

- **D-05a:** Native TRX (`TransferContract`) — fingerprint IS **sender-dependent** because `owner_address` is a Protobuf field inside `TransferContract`. Persona swap changes `owner_address`, which changes `raw_data` bytes, which changes the fingerprint. Distinct from Solana native SOL (where the from-account is in a separate header field that's also part of the preimage — both end up sender-dependent in practice, but for different structural reasons).
- **D-05b:** TRC-20 (`TriggerSmartContract`) — fingerprint IS **sender-dependent** because (1) `owner_address` is a Protobuf field, AND (2) the `transfer(to, amount)` calldata does NOT embed the sender (TRC-20 transfer ABI is identical to ERC-20). (1) is the load-bearing sender-dependency; (2) is a defense-in-depth check to confirm shape parity with Phase 6 ERC-20 (which is also sender-independent at the calldata level — the EVM `from` lives in the tx envelope, not the calldata).
- **D-05c:** Persona-cycle integration test shape mirrors Phase 7 Aave `T-INTEGRATION-FROM-DRIFT-2` + Phase 12 Solana `trust-pipeline-solana.integration.test.ts` — cycle through 3 personas, assert fingerprint differs across personas (sender-dependent), assert byte-identity within a persona.

### Ref-block pinning (D-06)

- **D-06a:** `prepare_tron_native_send` + `prepare_tron_trc20_send` call `tronweb.trx.getBlock("latest")` at prepare time. `block_header.ref_block_bytes` (last 2 bytes of block-number) + `block_header.ref_block_hash` (first 8 bytes of block-hash) are written into `raw_data` AND surfaced verbatim in PREPARE RECEIPT.
- **D-06b:** Ref-block 1-hour window > `get_tx_verification` 15-min TTL. No additional expiry handling needed at the MCP layer — the TRON network refuses expired txs at broadcast time and the refusal envelope surfaces in `send_transaction`'s response.
- **D-06c:** `get_tx_verification` TRON branch additively widens its response with `blockHeader` + `refBlockHash` fields so a context-evicted agent can re-render the canonical view. Mirrors Phase 9's v1.3 `txJson` additive + Phase 12's `solanaProgramSet` additive — same shape, same APPEND-ONLY discipline.

### Decimal handling (D-07)

- **D-07a:** `parseTronAmountStrict` in `src/signing/amount-tron.ts` (new sibling — mirrors `amount-solana.ts` shape). Native TRX = 6 decimals (sun unit). TRC-20 decimals vary per token (USDT = 6, USDC = 6, USDD = 18 — Phase 17's `tron-top-25.json` is the SOT).
- **D-07b:** Validate-before-delegate discipline: throw `INVALID_INPUT` on excess precision (e.g. `"1.0000001"` against 6-decimal TRX), throw on non-numeric, throw on negative. Mirrors `parseAmountStrict` (Phase 6) and `parseSolanaAmountStrict` (Phase 12) exactly.

### Fixture letters (D-08)

- **D-08a:** **Fixture M** — native TRX transfer fingerprint (`TransferContract` with `owner_address` = persona, `to_address` = recipient, `amount` = 1_000_000 sun).
- **D-08b:** **Fixture N** — TRC-20 transfer fingerprint (`TriggerSmartContract` with `contract_address` = USDT-TRC20, `data` = `transfer(recipient, 100_000_000)` ABI-encoded, `owner_address` = persona).
- **D-08c:** Letters M + N are the next-sequential available gap (Phase 12 used K + L; Phase 28 used R-U; M-Q were the implicit non-EVM reservation slot). Hardcoded `0x...` literals in NEW sibling file `test/signing-fingerprint-tron.test.ts` (NOT `test/signing-fingerprint.test.ts` — TRON Protobuf shape is structurally distinct enough to warrant the carve; mirrors Phase 12's `signing-fingerprint-solana.test.ts` carve). NO `beforeAll`-snapshot.
- **D-08d:** Cross-link from `prepare-tron-native-send.test.ts` + `prepare-tron-trc20-send.test.ts` consumer tests via T9-style re-anchor (each consumer test re-asserts the fingerprint at the consumer call site, so drift in the preimage assembly breaks at BOTH the anchor AND the consumer — load-bearing redundancy per CLAUDE.md fixture-pinning convention).

### Test file location (D-09)

- **D-09a:** New sibling file `test/signing-fingerprint-tron.test.ts` for Fixtures M + N — mirrors Phase 12's Solana carve. EVM-side `test/signing-fingerprint.test.ts` BYTE-UNTOUCHED.
- **D-09b:** Persona-cycle integration test in NEW file `test/trust-pipeline-tron.integration.test.ts` — mirrors `trust-pipeline-solana.integration.test.ts` + v1.0 `trust-pipeline.integration.test.ts`. EVM + Solana integration tests BYTE-UNTOUCHED.

### `send_transaction` TRON branch (D-10)

- **D-10a:** `src/tools/send_transaction.ts` already has a `txType` discriminator switch (`"evm"` default + `"solana"` branch from Phase 12). Phase 18 adds `"tron"` branch ADDITIVELY. The three-gate FROZEN region (`previewToken` + `userDecision: "send"` + `payloadFingerprint` drift) is reused unchanged — TRON branch routes through the same gate before forking to TRON-specific broadcast.
- **D-10b:** TRON broadcast path uses `tronweb.trx.sendRawTransaction(signedTransaction)` — distinct from EVM's WC-bridge path and Solana's USB-HID-direct path. The Ledger TRX-app signature (returned from `@ledgerhq/hw-app-trx` over USB-HID, same transport as Solana) is wrapped into the outer `transaction` envelope's `signature[]` field, then submitted to TronGrid.
- **D-10c:** Returns `{ txHash, broadcastedAt }` shape per v1.x convention. `txHash` is the SHA-256 of `raw_data` (same as `ledgerBlindSignHash` — TRON tx-id IS the blind-sign hash; the Ledger displays the literal tx-id at sign time).

### Canonical dispatch — TRON arm (D-11)

- **D-11a:** New file `src/security/canonical-dispatch-tron.ts` — mirrors `canonical-dispatch-solana.ts` shape. Allowlist: TRC-20 token contracts from Phase 17's `tron-top-25.json` (USDT-TRC20, USDC-TRC20, USDD, TUSD) for TRC-20 transfer targets. Native TRX `TransferContract` has no contract target — skip the allowlist check by `txType` discrimination.
- **D-11b:** Layer 0.5 (canonical-dispatch) sits before Layer 0.7 (simulation) — same ordering as v1.3 SEC-35 (EVM) and Phase 12 (Solana). Refusal at Layer 0.5 returns `DISPATCH_TARGET_REFUSED` (errorCode reuse from v1.3).
- **D-11c:** EVM `canonical-dispatch.ts` BYTE-UNTOUCHED. The 6-entry Compound allowlist landed at Phase 28 stays as-is.

### SECURITY.md update scope (D-12)

- **D-12a:** Ship the TRON SECURITY.md section in Plan 18-04 (the integration plan), NOT incrementally per plan. Sub-sections:
  1. USB-HID transport trust shape (mirrors Phase 12 Solana — `@ledgerhq/hw-transport-node-hid` only; no WC bridge)
  2. Protobuf raw_data hash vs EVM RLP keccak256 (structural distinction)
  3. SHA-256 tx-id vs Ethereum keccak256 (TRON consensus distinction; Ledger displays SHA-256)
  4. TRX blind-sign mode behavior + TRC-20 clear-sign coverage gap (if any)
  5. Layer 0.7 asymmetry — TRC-20 mandatory `triggerconstantcontract`, native TRX no-sim advisory (accepted residual, surfaced visibly)
  6. Ref-block 1-hour window (accepted residual; `get_tx_verification` TTL 15-min sits inside the window)
- **D-12b:** Future TRON phases (19/20/21) extend with their own protocol-specific notes (approve `⚠ UNLIMITED APPROVAL` surfacing, Stake 2.0 resource semantics, SunSwap MEV defense, LiFi `decodedFinalRecipient` assertion). Phase 18 does NOT inline these.

### Claude's Discretion

- Internal helper names (`encodeTronTransferContract`, `encodeTronTriggerSmartContract`, etc.) — bikeshedding-free
- Exact assertion shape for Fixture J–style chain-distinctness property test extension (TRON + Solana + 5 EVM chains) — defer to plan-checker; not load-bearing for Phase 18 alone
- Whether `_tronChains` ESM spy indirection lives in a single module or per-helper — researcher's call at execute time per the established Phase 28 `_compoundChains` precedent

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project context
- `CLAUDE.md` — fingerprint conventions; FROZEN-area discipline; ESM spy-affordance `_<scope>` indirection pattern; fixture-pinning literal-anchors-only-no-snapshots
- `.planning/PROJECT.md` — v2.1 TRON Active requirements (USB-HID transport + persistent non-EVM cache reuse + multi-chain portfolio extension)
- `.planning/REQUIREMENTS.md` §TRON-PREP-01..04 + §TRON-W-01..02 — exact Phase 18 requirement surface
- `.planning/ROADMAP.md` Phase 18 — Goal / Depends on (Phase 17) / Requirements / Success Criteria / Plans (4 plans estimated)
- `.planning/phases/17-tron-scaffolding-usb-hid-trx-reads-persistent-accounts/17-CONTEXT.md` — upstream context (USB-HID + tronweb@6.3.0 + PAIR-NEV-* `chain: "tron"` already wired)
- `.planning/phases/12-solana-native-spl-trust-pipeline/12-CONTEXT.md` — closest sibling phase; Solana trust pipeline is the load-bearing precedent

### Pattern references (load-bearing v1.x + v2.0 precedents to mirror)
- `src/signing/payload-fingerprint.ts` — EVM fingerprint (FROZEN; TRON variant is a parallel module at `src/signing/payload-fingerprint-tron.ts`, NOT a modification)
- `src/signing/payload-fingerprint-solana.ts` — Solana fingerprint (Phase 12; closest sibling-shape precedent)
- `src/signing/presign-hash.ts` — EVM EIP-1559 pre-sign hash (FROZEN; TRON variant uses SHA-256-over-raw_data recompute via new `presign-hash-tron.ts`)
- `src/signing/presign-hash-solana.ts` — Solana pre-sign hash sibling (Phase 12; shape mirror)
- `src/signing/simulation.ts` — EVM eth_call simulation (FROZEN; TRON variant uses `triggerconstantcontract` via new `simulation-tron.ts`)
- `src/signing/simulation-solana.ts` — Solana simulateTransaction sibling (Phase 12; shape mirror)
- `src/signing/blocks.ts` — `LEDGER BLIND-SIGN HASH` / `PREPARE RECEIPT` / `CHECKS PERFORMED` template constants (FROZEN; TRON templates land in new `blocks-tron.ts` sibling per Phase 12 precedent)
- `src/signing/blocks-solana.ts` — Solana template sibling (Phase 12; shape mirror)
- `src/signing/amount.ts` — `parseAmountStrict` (Phase 6; TRON variant clones to `amount-tron.ts`)
- `src/signing/amount-solana.ts` — Solana sibling (Phase 12; shape mirror)
- `src/signing/handle-store.ts` — handle state machine + 15-min TTL (REUSED unchanged; `record.tx.txType` discriminator already supports `"evm" | "solana"` — Phase 18 widens the literal-union to `"evm" | "solana" | "tron"`)
- `src/security/canonical-dispatch.ts` — EVM dispatch allowlist (FROZEN; 6 Compound Comets allowlist preserved per Phase 28)
- `src/security/canonical-dispatch-solana.ts` — Solana program-id allowlist (Phase 12; TRON variant lands in new `canonical-dispatch-tron.ts`)
- `src/tools/send_transaction.ts` — three-gate FROZEN region + `txType` discriminator switch (FROZEN gate region; additive TRON branch on the switch — same approach Phase 12 used to add Solana)
- `src/chains/tron/` — Phase 17 scaffolding (`address.ts`, `registry.ts`, `tron-rpc-client.ts`, `types.ts`) — already wired; Phase 18 extends with `tron-rpc-client.ts` ref-block read + transaction-builder integration
- `test/signing-fingerprint.test.ts` — Fixtures A-H + J (EVM) + R-U (Compound) literal anchors (FROZEN; do NOT modify in Phase 18)
- `test/signing-fingerprint-solana.test.ts` — Fixtures K + L (Solana; Phase 12; structurally distinct sibling file precedent)
- `test/trust-pipeline.integration.test.ts` (v1.0) + `test/trust-pipeline-solana.integration.test.ts` (v2.0 Phase 12) — persona-cycle byte-identity integration test shape

### External
- tronweb@6.3.0 docs — https://tronweb.network/docu/docs/intro/ (Phase 17 locked the version; raw_data serialization via `transaction.raw_data_hex`)
- TRON Protobuf specs — https://github.com/tronprotocol/protocol (TransferContract + TriggerSmartContract definitions; raw_data field-encoding stability)
- Ledger TRX app source — https://github.com/LedgerHQ/app-tron (blind-sign hash format = SHA-256 of raw_data; clear-sign coverage for TRC-20 token registry)
- `@ledgerhq/hw-app-trx` — https://www.npmjs.com/package/@ledgerhq/hw-app-trx (Ledger TRX-app interface; signTransaction returns signature bytes for the outer envelope)
- TronGrid `triggerconstantcontract` RPC — https://developers.tron.network/reference/triggerconstantcontract (Layer 0.7 TRC-20 simulation)
- TronGrid `broadcasttransaction` / `broadcasthex` — https://developers.tron.network/reference/broadcasttransaction (final broadcast endpoint for `send_transaction` TRON branch)
- TRON consensus tx-id derivation — https://developers.tron.network/docs/glossary (tx-id = sha256(raw_data); Ledger displays this hash on blind-sign mode)

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets

- **`src/signing/handle-store.ts`** — handle state machine + 15-min TTL + discriminated union `txType`. Already supports `"evm" | "solana"`; Phase 18 widens to `"evm" | "solana" | "tron"` via literal-union extension. NO schema change beyond the enum widening.
- **`src/tools/send_transaction.ts`** — three-gate FROZEN region (lines ~310-360 per the grep scout) + `txType` switch. Phase 12 demonstrated additive third-arm extension; Phase 18 replicates exactly.
- **`src/chains/tron/tron-rpc-client.ts`** — Phase 17 TRON RPC client; already exposes `getBlock("latest")` shape needed for ref-block pinning. May need a `triggerConstantContract` method addition for Layer 0.7 (additive).
- **`src/chains/tron/address.ts`** — `formatTronAddress` + `parseTronAddress` from Phase 17. Reused for `to_address` + `owner_address` Protobuf-field encoding (TRON addresses are 21-byte 0x41-prefixed; tronweb handles internally).
- **Persona system** — Phase 17 shipped a curated TRON whale persona; Phase 18 persona-cycle integration test uses 3 personas (existing TRON whale + 2 demo personas to be added per the integration-test plan).
- **`src/tools/preview_send.ts`** — already routes by `txType` (EVM + Solana branches). Phase 18 adds TRON branch additively.

### Established Patterns

- **`_<scope>` ESM spy-affordance indirection** (CLAUDE.md; canonical examples `_paths`, `_storage`, `_wcStorage`, `_compoundChains`). Phase 18 adds `_tronChains` indirection at `src/chains/tron/` for cross-export internal calls. WRITE AT IMPLEMENTATION TIME, NOT RETROACTIVELY.
- **Fixture pinning** = hardcoded `0x...` literals per shape, NO `beforeAll`-snapshot. Fixtures M + N in new sibling test file. Re-anchored at consumer test sites for load-bearing redundancy.
- **FROZEN-area zero-diff discipline** — Phase 18 FROZEN list (assertable via `git diff origin/main -- <paths>` returning empty):
  - `src/signing/payload-fingerprint.ts`
  - `src/signing/payload-fingerprint-solana.ts`
  - `src/signing/presign-hash.ts`
  - `src/signing/presign-hash-solana.ts`
  - `src/signing/simulation.ts`
  - `src/signing/simulation-solana.ts`
  - `src/signing/blocks.ts` (the EVM template constants — TRON templates land in new `blocks-tron.ts`)
  - `src/signing/blocks-solana.ts`
  - `src/signing/handle-store.ts` (other than the `txType` literal-union widening — that's an additive single-line edit)
  - `src/tools/send_transaction.ts` (three-gate region per Phase 12 invariant)
  - `src/security/canonical-dispatch.ts`
  - `src/security/canonical-dispatch-solana.ts`
  - `src/signing/error-codes.ts` — the 21-code locked union FROZEN; Phase 18 reuses existing codes (`SIMULATION_REFUSED` 16, `DISPATCH_TARGET_REFUSED` from v1.3) and adds **NONE**
- **APPEND-ONLY discipline** for templates — `blocks-tron.ts` is new (no append-only constraint inside the new file), but the new file appends to the system's template surface; coordinated additions across plans land at the BOTTOM of the new file in separate comment blocks per plan.

### Integration Points

- **`src/tools/register-all.ts`** — adds 2 new prepare-tool imports (`prepare_tron_native_send`, `prepare_tron_trc20_send`) after the existing TRON read-tool block. Additive only.
- **`src/signing/handle-store.ts`** — single-line `txType` literal-union widening (`"evm" | "solana"` → `"evm" | "solana" | "tron"`). Mechanically identical to Phase 12's widening.
- **`src/tools/preview_send.ts`** — TRON branch dispatcher addition mirroring the existing Solana branch. NEW per-branch render path; calls `simulation-tron.ts` for TRC-20, emits `[NO SIMULATION AVAILABLE]` advisory for native TRX.
- **`src/tools/send_transaction.ts`** — TRON branch addition on the existing `txType` switch. Three-gate region (above the switch) byte-untouched.
- **`src/tools/get_tx_verification.ts`** — TRON branch additive widening (returns `blockHeader` + `refBlockHash` for TRON handles, mirroring Phase 12's Solana additives + Phase 9's `txJson` v1.3 additive).

</code_context>

<specifics>
## Specific Ideas

- The TRON `payloadFingerprint` preimage MUST exclude the outer `transaction.signature[]` field (signatures fill post-prepare). Only `raw_data` bytes go through the keccak256.
- `triggerconstantcontract` is mandatory at preview time for TRC-20 calls, NOT advisory. Native TRX skips the gate with explicit visible advisory — defense relies on PREPARE RECEIPT + LEDGER BLIND-SIGN HASH alone for that arm.
- `userDecision: "send"` + `previewToken` gates land unchanged from v1.x / v2.0 — defense-in-depth uniform across EVM, Solana, and TRON. The three-gate FROZEN region in `send_transaction.ts` is the load-bearing invariant.
- TRX broadcast uses `tronweb.trx.sendRawTransaction(signedTransaction)` — bypasses both WC bridge (EVM) and the dual-broadcast-style of Solana. USB-HID is signing-only; broadcast goes through TronGrid HTTPS.
- TRON addresses internally are 21 bytes (0x41 || 20-byte-hash). External display is base58check ("T"-prefixed). Phase 17's `parseTronAddress` / `formatTronAddress` handle the conversion; Phase 18 plans should NOT inline byte-level address handling.
- The persona-cycle integration test for TRON re-anchors Fixtures M + N at consumer call sites (mirrors Phase 12's K + L re-anchoring). Drift in the preimage assembly fails at BOTH the anchor file AND the consumer file — load-bearing redundancy.

</specifics>

<deferred>
## Deferred Ideas

- **TRC-20 approve + revoke + unlimited-approval surfacing** — Phase 19 (TRON-PREP-05 + TRON-W-03). The `⚠ UNLIMITED APPROVAL` mechanic is the first non-trivial consumer of Phase 18's trust pipeline.
- **Stake 2.0** (`prepare_tron_stake_freeze`, `_unfreeze`, `_withdraw_expire_unfreeze`, `_vote`, `_claim_rewards`) — Phase 19. Requires `FreezeBalanceV2Contract` Protobuf encoding which is structurally distinct from `TransferContract` / `TriggerSmartContract`.
- **SunSwap V2 swap + LiFi bridging** — Phase 20. Sandwich-MEV slippage hint + `decodedFinalRecipient` assertion at preview (Inv #6b extension).
- **TRON setup-status diagnostic + multi-chain portfolio TRON leg remainder** — Phase 21 (note: TRON-READ-04 portfolio leg already shipped in Plan 17-04 per Phase 17 close-out; Phase 21 narrows to setup-status + SECURITY.md finalization).
- **Multi-address-per-chain TRON Ledger flow** (multiple derivation slots) — verify-phase feedback driven; not load-bearing for v2.1.
- **TRON Address-Lookup-Table equivalent** — TRON has no native ALT concept; this is a Solana-only concern, no TRON deferral.
- **TRC-721 / TRC-1155 NFT reads** — out of scope for v2.x (general NFT support deferred to v3.1).
- **Fixture J–style chain-distinctness property test extension** (TRON + Solana + 5 EVM chains in one set-of-fingerprints distinctness assertion) — out of Phase 18 scope; could ship as a Plan 18-04 stretch goal OR a separate cross-cutting test-hardening phase.

</deferred>

---

*Phase: 18-tron-native-trc20-trust-pipeline*
*Context gathered: 2026-05-20 (full context-gathering complete; auto-mode discuss-phase per CLAUDE.md feedback-auto-mode + user explicit phase-18 dispatch)*
