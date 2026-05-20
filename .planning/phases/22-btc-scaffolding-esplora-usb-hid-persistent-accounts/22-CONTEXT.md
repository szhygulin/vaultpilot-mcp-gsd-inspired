# Phase 22: BTC scaffolding — Esplora reads + USB-HID + persistent BTC account — Context

**Gathered:** 2026-05-20
**Status:** Placeholder — context-gathering pending (run `/gsd-discuss-phase 22`)

<domain>
## Phase Boundary

USB-HID Ledger pairing for BTC works; BTC balance + UTXO + history readable via Esplora (default blockstream.info; mempool.space alt-default DF); paired BTC account persists via the v2.0 Phase 11 cache under `chain: "bitcoin"` record key. Multi-derivation-path slots supported via the v2.0 multi-record-per-chain provision (one record per segwit slot + one per taproot slot).

No signing yet — Phase 23 lands the BTC PSBT-based trust pipeline. No RBF / message-signing — Phase 24. No multisig — Phase 25.

This is the v2.2 entry phase. The UTXO model introduces structurally distinct read shape (per-input UTXOs, gap-limit-respecting xpub scans, fee-rate-by-confirmation-target estimates) vs the account-model chains in v1.x/v2.0/v2.1.

</domain>

<decisions>
## Implementation Decisions

Pending — to be gathered during `/gsd-discuss-phase 22`. Anchor candidates:

- **BTC SDK choice (DF)**: `bitcoinjs-lib` (mature, full PSBT support, broad ecosystem) vs `@noble/curves/secp256k1` for taproot key-spending + minimal PSBT helpers. Researcher should scope-probe at execute time per `rnd`; full bitcoinjs-lib is likely the right call for v2.2 scope (PSBT multisig in Phase 25 needs the full PSBT serializer).
- **USB-HID transport reuse**: `@ledgerhq/hw-transport-node-hid` (Phase 11 Solana + Phase 17 TRON precedent); `@ledgerhq/hw-app-btc` is the Ledger BTC app interface.
- **Default Esplora endpoint**: blockstream.info (`https://blockstream.info/api`) vs mempool.space (`https://mempool.space/api`) — both are free public Esplora-compatible APIs. Researcher to pick at planning gate; mempool.space tends to have better mempool data, blockstream.info tends to have better long-term archive reliability. Plan should expose `BTC_ESPLORA_URL` env override.
- **PAIR-NEV-* schema reuse**: zero schema change required; `chain: "bitcoin"` record key with multi-record-per-chain slots (one per derivation-path slot — segwit + taproot at minimum).
- **Address derivations**: BIP-84 for segwit (m/84'/0'/0'/0/0 → bc1q…) + BIP-86 for taproot (m/86'/0'/0'/0/0 → bc1p…). Phase 22 pairs both at first-pair time; account-level xpub scanning is BIP-84 + BIP-86 each with gap-limit 20.
- **Demo persona**: add a BTC whale persona (e.g. a known top-50 BTC holder); demo-mode signing on BTC simulates via a "mempool-replay" envelope shape (Phase 23 wires this).

### Claude's Discretion

- Internal helper names (`BtcEsploraClient`, `BtcXpubScanner`, etc.)
- Whether `get_btc_account_balance` ships in Phase 22 or splits to a Phase 23 follow-up (xpub gap-limit scan is non-trivial — researcher to assess effort at planning time)
- Test mocking strategy for Esplora HTTP (fetch-stub at the network boundary per CLAUDE.md convention)

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project context
- `CLAUDE.md` — stack choices, ESM spy-affordance + fetch-stub conventions
- `.planning/REQUIREMENTS.md` §BTC-PAIR-* + §BTC-READ-* — exact Phase 22 surface
- `.planning/ROADMAP.md` Phase 22 — Goal / Success Criteria / Plans

### Pattern references (v1.x + v2.0 + v2.1 precedents to mirror)
- `src/wallet/non-evm-account-store.ts` (v2.0 Phase 11 Plan 11-02) — canonical persistence shape; Phase 22 adds `"bitcoin"` to the chain enum
- `src/chains/solana/` + `src/chains/tron/` — non-EVM chain-shelf pattern; Phase 22 adds `src/chains/bitcoin/`
- `src/clients/etherscan.ts` + `src/clients/fourbyte.ts` — HTTP client shape (never-throws, LRU cache, 5-arm discriminated union); Phase 22's Esplora client mirrors this
- PR [#61](https://github.com/szhygulin/vaultpilot-mcp-gsd-inspired/pull/61) — eager-init at `startServer()` race-defense rationale

### External
- `bitcoinjs-lib` — https://github.com/bitcoinjs/bitcoinjs-lib (full PSBT + script support)
- `@ledgerhq/hw-app-btc` — https://www.npmjs.com/package/@ledgerhq/hw-app-btc
- Esplora API — https://github.com/Blockstream/esplora/blob/master/API.md
- BIP-84 (segwit derivation) — https://github.com/bitcoin/bips/blob/master/bip-0084.mediawiki
- BIP-86 (taproot derivation) — https://github.com/bitcoin/bips/blob/master/bip-0086.mediawiki

</canonical_refs>

<specifics>
## Specific Ideas

- BTC reads have a structurally different shape from EVM/Solana/TRON: per-address balances are UTXO sums, not account-balance state. The `BalanceReport` discriminated union should surface `utxos[]` alongside the sum so downstream tools can do coin-selection without re-fetching.
- xpub-level account aggregation requires gap-limit-respecting scan (BIP-44 gap-limit is 20 unused-in-a-row before stopping). The scan should be cached per-xpub with a TTL — re-scanning on every read is expensive.
- mempool.space vs blockstream.info: mempool.space exposes richer mempool data (fee-rate histograms; cluster fees) but has stricter rate limits; blockstream.info has gentler limits but less mempool detail. Default to one; expose both as documented choices.
- The Ledger BTC app handles both segwit and taproot natively per v2.1+; no app-mode switching needed at pair-time.

</specifics>

<deferred>
## Deferred Ideas

- BTC `prepare_*` PSBT-based trust pipeline — Phase 23 (this phase is reads + pairing only)
- BIP-125 RBF + BIP-137 message signing — Phase 24
- PSBT multisig flow — Phase 25
- LTC scaffolding — Phase 26 (shares BTC infra; deliberately split to keep Phase 22 atomic)
- Bitcoin Core RPC forensic reads — Phase 27 (Esplora is Phase 22's read surface; Core RPC is optional layer-on)
- BIP-322 taproot message signing — future tool (`sign_message_btc_bip322`)

</deferred>

---

*Phase: 22-btc-scaffolding-esplora-usb-hid-persistent-accounts*
*Context placeholder: 2026-05-20 (full context-gathering at `/gsd-discuss-phase 22` time)*
