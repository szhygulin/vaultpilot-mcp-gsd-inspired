# Phase 24: BIP-125 RBF + BIP-137 message signing — Context

**Gathered:** 2026-05-20
**Status:** Placeholder — context-gathering pending (run `/gsd-discuss-phase 24`)

<domain>
## Phase Boundary

User can bump fees on confirmed-pending BTC transactions via BIP-125 Replace-By-Fee, and sign arbitrary messages with their BTC keys per BIP-137 (canonical signature shape for wallet ownership proof — used widely for off-chain wallet attestation, exchange KYC verification, etc.).

BIP-322 taproot message signing is explicitly deferred — separate `sign_message_btc_bip322` tool in future v2.x backlog.

</domain>

<decisions>
## Implementation Decisions

Pending — to be gathered during `/gsd-discuss-phase 24`. Anchor candidates:

- **BIP-125 sequence-number rules**: original tx must signal RBF (sequence < `0xfffffffe`); replacement tx must increase fee rate by at least the minimum-relay-fee bump (~1 sat/vB or per-mempool-policy). Replacement uses the same input set; new output ordering allowed.
- **RBF refusal cases**: confirmed transactions (mempool-only); original tx didn't signal RBF; new fee rate isn't strictly higher than original. Each surfaces as a distinct structured error code.
- **Original-vs-new fee diff surfacing**: CHECKS PERFORMED block shows both old and new fee rate + the absolute increase in sats. Defends against decimal-place mistakes ("0.5 sat/vB bump" vs "5 sat/vB bump").
- **BIP-137 vs BIP-322 (DF)**: BIP-137 is the legacy compact-signature shape — universally supported, works against legacy + segwit addresses. BIP-322 is the modern taproot-aware shape — Ledger BTC app may or may not support BIP-322 message signing at Phase 24 planning time (researcher to verify). Phase 24 ships BIP-137; BIP-322 deferred per CONTEXT.md `<deferred>`.
- **Message signing UX**: Ledger BTC app clear-signs message text in blind-sign mode; user sees the message bytes on-device. Magic-byte prefix (`"Bitcoin Signed Message:\n"`) handled server-side per BIP-137; user sees the post-magic-byte message text on-device.

### Claude's Discretion

- Internal helper names (`buildRbfBumpPsbt`, `signBip137Message`, etc.)
- Whether `prepare_btc_rbf_bump` accepts an optional `newFeeSats` (absolute fee bump) or only `newFeeRate` (rate-based bump)
- Whether to opportunistically signal RBF on all `prepare_btc_send` outputs (Phase 23 ships RBF-disabled by default per standard wallet behavior; Phase 24 could enable opportunistic RBF via a `signalRbf: true` flag on `prepare_btc_send`)

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project context
- `CLAUDE.md` — refusal-shape conventions
- `.planning/REQUIREMENTS.md` §BTC-W-02 + §BTC-W-03 — exact Phase 24 surface
- `.planning/ROADMAP.md` Phase 24 — Goal / Success Criteria / Plans

### Pattern references (v2.0 + v2.1 + Phase 23 precedents to mirror)
- `src/tools/prepare_btc_send.ts` (Plan 23-03) — PSBT-based prepare-tool template; Phase 24 RBF tool clones with sequence + fee-rate logic
- `src/protocols/btc-psbt.ts` (Plan 23-02) — PSBT helper module; Phase 24 extends with RBF replacement helpers

### External
- BIP-125 (Replace-By-Fee) — https://github.com/bitcoin/bips/blob/master/bip-0125.mediawiki
- BIP-137 (Signed Message Format) — https://github.com/bitcoin/bips/blob/master/bip-0137.mediawiki
- BIP-322 (Generic Signed Message Format — taproot-aware) — https://github.com/bitcoin/bips/blob/master/bip-0322.mediawiki

</canonical_refs>

<specifics>
## Specific Ideas

- RBF is mempool-only by definition; the prepare tool MUST verify the original tx is unconfirmed via Esplora before building the replacement. Confirmed-tx refusal surfaces with a one-line hint pointing at CPFP (Child-Pays-For-Parent) as the alternative (deferred to future).
- BIP-137 compact signature format: header byte (1) + R (32) + S (32) = 65 bytes; header byte encodes the recovery_id + script_type (P2PKH/P2WPKH-P2SH/P2WPKH). Ledger BTC app produces this format directly via `signMessage` command.
- The Ledger BTC app shows the message text on-screen in blind-sign mode; users should verify the message matches the agent's claim before confirming. The `LEDGER BLIND-SIGN HASH` block surfaces both the magic-bytes-prefixed hash AND the post-prefix message text so the agent has a faithful artifact to relay.
- Fee-rate bump validation: the new rate must exceed the old rate by at least the minimum-relay-fee policy (typically 1 sat/vB). Phase 24 hardcodes this at 1 sat/vB; future could probe Esplora's `/v1/fees/recommended` for dynamic bumps.

</specifics>

<deferred>
## Deferred Ideas

- PSBT multisig flow — Phase 25
- LTC scaffolding + LiFi BTC bridging — Phase 26
- BIP-322 taproot message signing — future `sign_message_btc_bip322` tool
- CPFP (Child-Pays-For-Parent) fee bump for confirmed parents — future tool
- Per-mempool-policy fee-bump probe (Esplora `/v1/fees/recommended`) — defer; static 1 sat/vB suffices for v2.2

</deferred>

---

*Phase: 24-btc-bip125-rbf-bip137-message-signing*
*Context placeholder: 2026-05-20 (full context-gathering at `/gsd-discuss-phase 24` time)*
