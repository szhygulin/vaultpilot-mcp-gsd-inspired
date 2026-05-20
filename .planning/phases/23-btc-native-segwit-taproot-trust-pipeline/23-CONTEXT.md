# Phase 23: BTC native + segwit + taproot trust pipeline (PSBT-based) — Context

**Gathered:** 2026-05-20
**Status:** Placeholder — context-gathering pending (run `/gsd-discuss-phase 23`)

<domain>
## Phase Boundary

Full prepare → preview → send flow works for native BTC sends. The BTC trust pipeline is structurally distinct: PSBT (BIP-174) serialization replaces the EVM/Solana/TRON single-blob shape; `payloadFingerprint` is computed over BIP-143 sighashes concatenated per input (not the whole tx); the Ledger BTC app signs each input via the PSBT workflow. Native segwit (bc1q…) AND taproot (bc1p…) script types both supported; mixed-script-type inputs supported (some segwit + some taproot in the same tx).

This is the load-bearing milestone for v2.2 — the BTC UTXO-model trust pipeline mirror of Phase 4 (EVM) / Phase 12 (Solana) / Phase 18 (TRON). Phase 24+ extends with RBF / message-signing / multisig — all reusing this pipeline.

</domain>

<decisions>
## Implementation Decisions

Pending — to be gathered during `/gsd-discuss-phase 23`. Anchor candidates:

- **Fingerprint preimage shape**: `keccak256("VaultPilot-btctx-v1:" ‖ <BIP-143 sighashes per input concat>)`. UTXO model means per-input sighashes must each appear in the preimage; multi-input transactions produce multi-hash fingerprints. Researcher confirms BIP-143 sighash byte-encoding stability across bitcoinjs-lib versions at execute time (DF).
- **PSBT version (DF)**: PSBT-v0 (BIP-174) is universally supported by Ledger BTC apps. PSBT-v2 (BIP-370) is newer and offers finer-grained input/output ordering control. Researcher to scope-probe `bitcoinjs-lib` PSBT-v2 support + Ledger BTC app PSBT-v2 acceptance at execute time. Default: PSBT-v0 for Phase 23; PSBT-v2 considered if researcher's probe finds clean support.
- **Coin-selection algorithm (DF)**: Branch-and-bound (BnB) is the recognized state-of-the-art (minimizes change-output dust + matches input set to output amount closely). Manual override (user supplies explicit UTXO selection) for advanced users. Fallback to FIFO/largest-first when BnB doesn't find a clean match.
- **Fee-rate sanity bounds**: prepare-time refuses if `feeRate` is < network minimum (1 sat/vB) or > 10x current Esplora high-priority estimate (defends against decimal-place mistakes — "10 sat/vB" vs "10,000 sat/vB" is one keystroke).
- **Dust-threshold enforcement**: outputs below the BIP-141 dust threshold (~330 sats for segwit, ~546 sats for legacy) refused at prepare-time.
- **Mixed-script-type handling**: when the user has both segwit and taproot UTXOs, the prepare tool can mix them in one tx; the PSBT carries per-input script-type metadata; the Ledger BTC app handles the per-input signing correctly per the PSBT workflow.

### Claude's Discretion

- Fixture O/P/Q literal anchor values — researcher computes at execute time via `node -e`
- Internal helper names (`buildBtcPsbt`, `selectCoinsBnb`, etc.)
- Whether `prepare_btc_send` defaults to segwit-only inputs when the user has both (cheaper fees) or mixes per coin-selection optimization

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project context
- `CLAUDE.md` — fingerprint conventions; FROZEN-area discipline
- `.planning/REQUIREMENTS.md` §BTC-PREP-* + §BTC-PSBT-01/02 + §BTC-W-01 — exact Phase 23 surface
- `.planning/ROADMAP.md` Phase 23 — Goal / Success Criteria / Plans

### Pattern references (v1.x + v2.0 + v2.1 precedents to mirror)
- `src/signing/payload-fingerprint.ts` (Plan 04-01) — EVM fingerprint; FROZEN; Phase 23 adds BTC sibling
- `src/signing/solana-fingerprint.ts` (Plan 12-01) — Solana fingerprint; sibling shape
- `src/signing/tron-fingerprint.ts` (Plan 18-01) — TRON fingerprint; sibling shape
- `src/protocols/solana-system.ts` + `src/protocols/solana-spl.ts` (Phase 12) — protocol-encoder pattern; Phase 23's `btc-psbt.ts` mirrors at higher level

### External
- BIP-174 (PSBT v0) — https://github.com/bitcoin/bips/blob/master/bip-0174.mediawiki
- BIP-370 (PSBT v2) — https://github.com/bitcoin/bips/blob/master/bip-0370.mediawiki
- BIP-143 (segwit sighash) — https://github.com/bitcoin/bips/blob/master/bip-0143.mediawiki
- BIP-341 (taproot) + BIP-342 (tapscript) — https://github.com/bitcoin/bips/blob/master/bip-0341.mediawiki
- Bitcoin coin-selection paper (BnB) — Erhardt 2016

</canonical_refs>

<specifics>
## Specific Ideas

- UTXO-model trust-pipeline fingerprint is fundamentally distinct from account-model: per-input sighashes commit to that input's spending authorization. Multi-input fingerprint = concat of N sighashes inside the domain-tagged preimage. Compromise model: if any single input's sighash drifts between prepare and send, the fingerprint diverges and the layer-3 drift gate refuses.
- The Ledger BTC app's PSBT-signing UX: device displays "Inputs / Outputs / Fee" summary; user confirms; per-input signing happens device-side. The `LEDGER BLIND-SIGN HASH` block surfaces the per-input sighashes the device will display.
- Persona-cycle byte-identity test shape: UTXO-derived from-set is per-persona-distinct (each persona has different UTXOs), so the fingerprint is BY CONSTRUCTION persona-distinct. Phase 23's integration test asserts: same `to` + `sats` produces persona-distinct fingerprints (because UTXOs differ); same `to` + `sats` + same UTXOs (manual override) produces byte-identical fingerprints (regression anchor against preimage drift).
- SECURITY.md updates: PSBT serialization trust shape, per-input BIP-143 sighash binding, multi-input sighash recompute as Layer 1 (preview) defense, Ledger BTC app's per-input signing flow.

</specifics>

<deferred>
## Deferred Ideas

- BIP-125 RBF + BIP-137 message signing — Phase 24
- PSBT multisig flow — Phase 25
- LTC native send (mirrors BTC) — Phase 26
- LiFi BTC bridging — Phase 26
- BIP-322 taproot message signing — future tool
- Replace-By-Fee (RBF) signaling AT prepare-time (whether to set `sequence < 0xfffffffe` by default) — Phase 24 introduces RBF tools; Phase 23 ships with RBF-disabled by default per standard wallet behavior

</deferred>

---

*Phase: 23-btc-native-segwit-taproot-trust-pipeline*
*Context placeholder: 2026-05-20 (full context-gathering at `/gsd-discuss-phase 23` time)*
