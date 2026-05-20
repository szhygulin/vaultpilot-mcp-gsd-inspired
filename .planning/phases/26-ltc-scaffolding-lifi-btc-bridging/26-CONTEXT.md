# Phase 26: LTC scaffolding + LiFi BTC→EVM/Solana bridging — Context

**Gathered:** 2026-05-20
**Status:** Placeholder — context-gathering pending (run `/gsd-discuss-phase 26`)

<domain>
## Phase Boundary

LTC mirrors BTC scaffolding scaled down — `pair_litecoin_ledger` + `get_litecoin_balance` + `get_litecoin_tx_history` + `get_litecoin_fee_estimates` against litecoinspace.org Esplora-compatible endpoint; `prepare_litecoin_native_send` mirrors `prepare_btc_send` PSBT-based shape with LTC domain tag; `sign_message_ltc` mirrors `sign_message_btc` with LTC magic bytes. The Ledger BTC app handles LTC mode per account-config (or a separate Ledger Litecoin app on older firmware — researcher to verify at execute time).

This phase also lands LiFi-routed BTC bridging to EVM and Solana via the shared `src/clients/lifi.ts` shelf (factored at v2.0 Phase 16 + extended at v2.1 Phase 20; Phase 26 extends with BTC-from support).

</domain>

<decisions>
## Implementation Decisions

Pending — to be gathered during `/gsd-discuss-phase 26`. Anchor candidates:

- **Ledger LTC app vs BTC-app-LTC-mode (DF)**: older Ledger firmware required a separate Litecoin app; newer firmware uses the BTC app with LTC account-config. Researcher to verify at execute time which path is canonical for the current Ledger firmware (Nano S Plus / Nano X / Stax + Flex).
- **LTC derivation**: BIP-44 m/44'/2'/0' (legacy M-prefixed) + BIP-84 m/84'/2'/0' (ltc1q-segwit). Phase 26 pairs both at first-pair time mirroring Phase 22's BTC dual-derivation pattern.
- **LTC Esplora endpoint**: litecoinspace.org is the canonical Esplora-compatible LTC API; expose `LITECOIN_ESPLORA_URL` env override.
- **PAIR-NEV-* schema reuse**: zero schema change required; `chain: "litecoin"` record key.
- **LTC fingerprint domain tag**: `"VaultPilot-ltctx-v1:"` distinct from BTC's `"VaultPilot-btctx-v1:"`. Whether to factor a shared `utxo-fingerprint.ts` module (Phase 26 + Phase 23 BTC both extending) is a Phase 26 plan-checker call — if the only delta is the domain tag, sharing wins; if BTC vs LTC sighash assembly diverges, keep them separate.
- **LiFi BTC-from support**: shared `src/clients/lifi.ts` shelf adds `fromToken: "BTC"` enum value; LiFi BTC-side decoder lives in `src/protocols/bridge-decoders/lifi-btc.ts` (mirrors v2.6 `bridge-decoders/*.ts` per-bridge module shape); Inv #6b `decodedFinalRecipient` assertion at preview time.
- **BTC → Solana cross-chain support**: LiFi quote API supports BTC → EVM and (per LiFi docs) BTC → Solana via aggregated routes. Phase 26 verifies the Solana destination route is live at planning time.

### Claude's Discretion

- Internal helper names (`LtcEsploraClient`, `LifiBtcDecoder`, etc.)
- Whether `prepare_litecoin_native_send` and `prepare_btc_send` share a common `prepareUtxoSendInternal` helper (DRY) or stay separate per-chain (mirrors Phase 6 distinct-prepare-tool convention)
- Whether Fixture R (LTC native send) literal anchor lands in Phase 26 or splits to Phase 27

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project context
- `CLAUDE.md` — PSBT-based UTXO patterns from Phase 23; LiFi shared shelf factoring rule
- `.planning/REQUIREMENTS.md` §LTC-PAIR-* + §LTC-READ-* + §LTC-W-* + §BTC-LIFI-01 — exact Phase 26 surface
- `.planning/ROADMAP.md` Phase 26 — Goal / Success Criteria / Plans

### Pattern references (Phase 22-25 + v2.0 + v2.1 precedents to mirror)
- `src/chains/bitcoin/` (Plan 22-01) — Phase 26 adds `src/chains/litecoin/` mirroring this exactly (Esplora client + types)
- `src/tools/pair_btc_ledger.ts` (Plan 22-02) — pair-tool template; Phase 26 clones for LTC
- `src/tools/prepare_btc_send.ts` (Plan 23-03) — PSBT-based prepare; Phase 26 clones for LTC with LTC fingerprint domain tag
- `src/clients/lifi.ts` (Plan 16-01 if factored at v2.0 + Plan 20-02 extension) — shared LiFi client; Phase 26 extends with BTC-from support

### External
- Litecoinspace.org Esplora-compat API — https://litecoinspace.org/docs
- Ledger BTC app LTC account-config — Ledger device docs (researcher to verify)
- LiFi BTC route docs — https://docs.li.fi/li.fi-api

</canonical_refs>

<specifics>
## Specific Ideas

- LTC vs BTC fingerprint domain tags being distinct prevents cross-chain fingerprint reuse by construction (same Inv #2.5 chain-explicitness principle as v2.0 Solana vs v1.x EVM).
- The Ledger BTC app's LTC mode produces signatures that broadcast on the LTC chain; the underlying signing primitive is identical, only the address format + magic bytes differ. Phase 26's `prepare_litecoin_native_send` reuses the Phase 23 PSBT infrastructure with LTC-specific witness encoding.
- LiFi shared shelf factoring: if v2.0 Phase 16 + v2.1 Phase 20 left `src/clients/lifi.ts` clean, Phase 26 just extends. If the BTC integration uncovers a missing abstraction (e.g. UTXO-side calldata isn't a calldata at all — it's a destination address on the destination chain that LiFi watches for native-BTC deposit), Phase 26 plan-checker calls out the refactor.
- BIP-322 LTC message signing follows the same status as BTC — deferred to a future `sign_message_ltc_bip322` tool. Phase 26 ships BIP-137-equivalent (LTC magic bytes `"\x19Litecoin Signed Message:\n"`).

</specifics>

<deferred>
## Deferred Ideas

- LTC PSBT multisig — out of scope for v2.2 (BTC multisig is Phase 25; LTC multisig is hypothetical demand-driven; defer)
- LTC BIP-322 message signing — future tool
- Bitcoin/Litecoin Core RPC forensic reads — Phase 27
- `build_incident_report` — Phase 27
- LTC LiFi bridging (LTC → EVM) — defer; LiFi LTC support is more sparse than BTC; ship BTC bridging in Phase 26, LTC bridging as v2.2.x follow-up if LiFi adds support

</deferred>

---

*Phase: 26-ltc-scaffolding-lifi-btc-bridging*
*Context placeholder: 2026-05-20 (full context-gathering at `/gsd-discuss-phase 26` time)*
