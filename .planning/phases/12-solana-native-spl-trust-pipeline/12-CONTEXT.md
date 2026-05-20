# Phase 12: Solana native + SPL trust pipeline — Context

**Gathered:** 2026-05-20
**Status:** Placeholder — context-gathering pending (run `/gsd-discuss-phase 12`)

<domain>
## Phase Boundary

Full prepare → preview → send flow works for native SOL and SPL transfers. Solana-specific `payloadFingerprint` (over serialized transaction message bytes pre-signature) lands here, distinct from EVM's preimage shape. Mandatory `simulateTransaction` preview gate refuses on program-error or insufficient-lamports. Per-wallet durable-nonce account setup tools land here so prepare → sign flows survive past the 150-slot recent-blockhash window. Ledger SOL-app blind-sign hash recompute mirrors the EVM `LEDGER BLIND-SIGN HASH` block.

This is the load-bearing milestone for v2.0 — the Solana trust-pipeline mirror of Phase 4's Ethereum one. New fixture literals (I native SOL, J SPL transfer) anchor the Solana-side cryptographic-binding chain.

</domain>

<decisions>
## Implementation Decisions

Pending — to be gathered during `/gsd-discuss-phase 12`. Anchor candidates:

- **Domain-tagged fingerprint**: `payloadFingerprint = keccak256("VaultPilot-soltx-v1:" ‖ <serialized message bytes pre-signature>)`. Distinct domain tag from EVM's `"VaultPilot-txverify-v1:"` so cross-chain fingerprint reuse is impossible by construction (sister rule to v1.x PREP-03 domain-tagging).
- **Serialized message bytes**: Solana uses `TransactionMessage.compileToV0Message()` or legacy `Message`; researcher to lock the message-format choice (v0 with Address Lookup Tables — DF) at planning gate.
- **Simulation gate placement**: Layer 0.7 — sits between v1.3 canonical-dispatch Layer 0.5 and v1.2 chain-mismatch Layer 2. Refusal on program-error returns the simulation logs verbatim in `CHECKS PERFORMED`.
- **Durable-nonce setup**: `prepare_solana_nonce_init` creates the nonce account + sets NonceAuthorized; `prepare_solana_nonce_close` reclaims rent. Both go through the standard preview → send gates.
- **Fixture anchoring**: I (native SOL transfer) + J (SPL transfer) as hardcoded `0x...` literals in `test/signing-fingerprint.test.ts`; cross-link from `prepare-solana-*` consumer tests. NO `beforeAll`-snapshot per CLAUDE.md convention.
- **Persona-cycle integration test shape**: native SOL = sender-independent fingerprint (only `to` + `lamports` + nonce in preimage); SPL = sender-dependent because the source SPL token account is derived from the sender (pattern matches Phase 7 Aave `T-INTEGRATION-FROM-DRIFT-2` shape).
- **Ledger blind-sign hash**: SOL app v1.4+ clear-signs native + SPL transfers; conditional LEDGER NOTICE block only when CAL coverage absent (pattern matches Phase 6 WETH9.withdraw).
- **SECURITY.md update**: Solana threat-model section names the USB-HID vs WC transport trust shape, durable-nonce TTL extension as accepted residual, simulation gate as Layer 0.7 defense.

### Claude's Discretion

- Internal helper names (`SolanaFingerprint`, `SolanaPresignHash`, etc.)
- Whether to ship a Solana variant of `get_tx_verification` (15-min handle re-emit) — likely yes, mirrors v1.x; researcher to confirm shape compatibility

</decisions>

<canonical_refs>
## Canonical References

### Project context
- `.planning/REQUIREMENTS.md` §SOL-PREP-01..05, §SOL-W-01..02 — exact Phase 12 requirement surface
- `.planning/ROADMAP.md` Phase 12 — Success Criteria + Plans list
- `.planning/phases/11-…/11-CONTEXT.md` — upstream context (USB-HID transport already wired)

### Pattern references (load-bearing v1.x precedents)
- `src/signing/payload-fingerprint.ts` — EVM fingerprint module (FROZEN; Solana variant is a parallel module, NOT a modification)
- `src/signing/presign-hash.ts` — EVM EIP-1559 pre-sign hash (FROZEN; Solana variant uses message-bytes recompute)
- `src/signing/handle-store.ts` — handle state machine + 15-min TTL (reused unchanged)
- `src/tools/send_transaction.ts` — three-gate region (FROZEN; Solana branch is additive)
- `src/signing/blocks.ts` — `LEDGER BLIND-SIGN HASH` / `PREPARE RECEIPT` / `CHECKS PERFORMED` templates (Solana variant follows same shape)
- `test/signing-fingerprint.test.ts` — Fixtures A-H literal anchors (Solana adds I + J)
- `test/trust-pipeline.integration.test.ts` (v1.0) + `test/erc20-lifecycle.integration.test.ts` (v1.1) — persona-cycle integration test shape

### External
- Solana transaction format docs — https://solana.com/docs/core/transactions
- v0 transactions + Address Lookup Tables — https://solana.com/developers/guides/advanced/lookup-tables
- `simulateTransaction` RPC — https://solana.com/docs/rpc/http/simulatetransaction
- Durable nonces — https://solana.com/developers/guides/advanced/introduction-to-durable-nonces
- Ledger SOL app clear-sign coverage — https://github.com/LedgerHQ/app-solana

</canonical_refs>

<specifics>
## Specific Ideas

- The Solana `payloadFingerprint` preimage MUST exclude the signature slots (signatures are filled in post-prepare). The serialized MESSAGE bytes (not the full transaction bytes) are the load-bearing input.
- `simulateTransaction` is mandatory at preview time, not advisory. The simulation envelope (compute units consumed, logs, return data) goes into `CHECKS PERFORMED` verbatim so the agent can surface it to the user.
- `userDecision: "send"` + `previewToken` gates land unchanged from v1.x — defense-in-depth uniform across EVM and Solana.

</specifics>

<deferred>
## Deferred Ideas

- MarginFi / Kamino / Jupiter / Marinade / Jito prepare tools — Phases 13-15
- LiFi-routed EVM↔Solana bridging — Phase 16
- Solana Address Lookup Table creation tooling — defer; researcher to confirm whether v0-transaction adoption forces ALT-creation as a sub-helper at write time
- Cross-program-invocation decoder for arbitrary calls — defer to v2.x escape-hatch (parallels v2.4 EVM `prepare_custom_call`)

</deferred>

---

*Phase: 12-solana-native-spl-trust-pipeline*
*Context placeholder: 2026-05-20 (full context-gathering at `/gsd-discuss-phase 12` time)*
