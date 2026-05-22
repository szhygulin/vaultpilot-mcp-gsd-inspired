# Phase 23: BTC native + segwit + taproot trust pipeline (PSBT-based) - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-22
**Phase:** 23-btc-native-segwit-taproot-trust-pipeline
**Areas discussed:** Coin selection, Change address, Default fee, Demo signing

---

## Coin selection

| Option | Description | Selected |
|--------|-------------|----------|
| BnB across both | Branch-and-bound optimizes over the full UTXO set regardless of script type; best fee efficiency; exercises mixed-input path by default; manual override available | ✓ |
| Segwit-only preferred | Use only bc1q UTXOs; pull in taproot only when segwit insufficient; simpler but can strand taproot funds | |
| Taproot-only preferred | Use only bc1p UTXOs first; smaller witnesses; strands segwit funds | |

**User's choice:** BnB across both
**Notes:** Mixed-input support is a required success criterion (SC#5) regardless; BnB-default exercises that path by construction.

---

## Change address

| Option | Description | Selected |
|--------|-------------|----------|
| Fresh derived change address | Next unused change-chain address (m/84'/0'/0'/1/k or m/86'.../1/k); standard wallet privacy practice; requires change-chain gap-limit tracking | ✓ |
| Reuse the paired receive address | Change back to index-0 receive address; simplest, but address reuse degrades privacy | |
| Change to largest-input's address | Return change to the largest input's address; no new derivation but still address reuse | |

**User's choice:** Fresh derived change address
**Notes:** Researcher must resolve change-chain (chain `1`) index tracking — Phase 22's xpub scan only covered the receive chain. Change must be a Ledger-derivable address so the BTC app displays it as "change".

---

## Default fee

| Option | Description | Selected |
|--------|-------------|----------|
| Balanced — 3-block target | Defaults to ~3-block (~30 min) Esplora rate; reasonable speed without overpaying | ✓ |
| Economy — 6-block target | Defaults to ~6-block (~1 hr) rate; cheapest but slower, mempool-eviction risk | |
| Require explicit feeRate | No default; refuse if feeRate omitted; most surprise-proof, least ergonomic | |

**User's choice:** Balanced — 3-block target
**Notes:** `feeSats` always surfaced in PREPARE RECEIPT and approved on-device; the default is convenience, not a hidden cost.

---

## Demo signing

| Option | Description | Selected |
|--------|-------------|----------|
| Mempool-replay envelope | Demo produces a fully-formed PSBT + simulated broadcast-accepted envelope without a device; mirrors Solana/TRON demo shape | ✓ |
| Defer demo signing | Phase 23 ships reads-only demo; demo signing wired later; breaks cross-chain demo parity | |

**User's choice:** Mempool-replay envelope
**Notes:** Wires to the BTC whale persona added in Phase 22; keeps demo-mode parity across all chains.

---

## Claude's Discretion

- Fixture O/P/Q literal anchor values — researcher computes at execute time via `node -e`.
- Internal helper names (`buildBtcPsbt`, `selectCoinsBnb`, `deriveChangeAddress`, etc.).
- Test mocking strategy for the Ledger BTC-app transport (mirror the Solana/TRON USB-HID mock pattern).

## Deferred Ideas

- BIP-125 RBF + BIP-137 message signing — Phase 24
- PSBT multisig flow — Phase 25
- LTC native send + LiFi BTC bridging — Phase 26
- BIP-322 taproot message signing — future tool
