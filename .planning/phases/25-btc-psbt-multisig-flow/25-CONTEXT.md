# Phase 25: PSBT multisig flow (combine / sign / finalize + multisig wallet registry) — Context

**Gathered:** 2026-05-20
**Status:** Placeholder — context-gathering pending (run `/gsd-discuss-phase 25`)

<domain>
## Phase Boundary

User can participate in M-of-N multisig PSBT workflows — register a multisig wallet descriptor, read multisig wallet balances + UTXOs, combine partially-signed PSBTs from co-signers, sign their input contribution, finalize the fully-signed PSBT for broadcast. Multisig wallet registry tracks known M-of-N descriptors persistently at `~/.vaultpilot-mcp/btc-multisig.json`.

</domain>

<decisions>
## Implementation Decisions

Pending — to be gathered during `/gsd-discuss-phase 25`. Anchor candidates:

- **Descriptor format**: BIP-380 descriptors (`sortedmulti(M, key1, key2, ...)`) are the canonical multisig representation. MuSig (Schnorr-aggregated multisig) deferred until Ledger BTC app supports MuSig signing natively (status TBD at execute time).
- **Descriptor validation at registration time**: parse the descriptor via bitcoinjs-lib (or equivalent); verify key fingerprints + derivation paths; refuse on malformed descriptors. The registered descriptor's first 5 derived addresses surface in `register_btc_multisig_wallet` response for the user to verify against their co-signers.
- **Storage shape**: JSON file at `~/.vaultpilot-mcp/btc-multisig.json` (0o600 file); per-wallet record: `{ name, descriptor, threshold, fingerprints[], firstAddresses[], registeredAt }`. Atomic-write via tempfile + rename mirrors v2.0 PAIR-NEV-* pattern.
- **PSBT combine logic**: input-by-input + key-by-key merge; conflict on the same key signing the same input differently → structured error naming the conflicting signatures (defense against silent overwrites of co-signer signatures).
- **Threshold enforcement at finalize**: refuse `finalize_btc_psbt` if signature count < threshold per input. Surface which inputs are under-threshold (some inputs may have enough signatures; others not).
- **Per-input signer-key surfacing in CHECKS PERFORMED**: when the user signs a multisig PSBT, the preview block shows which inputs they're a signer on + which co-signers have already signed + how many signatures still needed.

### Claude's Discretion

- Internal helper names (`combineBtcPsbt`, `finalizeBtcPsbt`, etc.)
- Whether `register_btc_multisig_wallet` accepts wallet-discovery files (Sparrow/Specter format) or pure descriptor strings
- Test fixture multisig descriptors (2-of-3 from known test xpubs)

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project context
- `CLAUDE.md` — persistence + atomic-write conventions
- `.planning/REQUIREMENTS.md` §BTC-PSBT-03..07 + §BTC-W-04 — exact Phase 25 surface
- `.planning/ROADMAP.md` Phase 25 — Goal / Success Criteria / Plans

### Pattern references (v2.0 + Phase 23 precedents to mirror)
- `src/wallet/non-evm-account-store.ts` (Plan 11-02) — JSON-backed persistence shape; Phase 25 mirrors for multisig descriptor registry
- `src/protocols/btc-psbt.ts` (Plan 23-02) — PSBT helpers; Phase 25 extends with combine + finalize
- `src/tools/prepare_btc_send.ts` (Plan 23-03) — PSBT-based prepare-tool template; Phase 25's `sign_btc_multisig_psbt` clones with multisig-input-aware signing

### External
- BIP-174 (PSBT v0) — https://github.com/bitcoin/bips/blob/master/bip-0174.mediawiki (combine + finalize semantics)
- BIP-380 (Descriptor Specification) — https://github.com/bitcoin/bips/blob/master/bip-0380.mediawiki
- BIP-381 (Non-Tapscript Descriptors) — https://github.com/bitcoin/bips/blob/master/bip-0381.mediawiki
- BIP-87 (Multi-sig Hierarchical Deterministic Wallets) — derivation path conventions
- Specter / Sparrow wallet — reference multisig coordinator implementations

</canonical_refs>

<specifics>
## Specific Ideas

- Multisig descriptor validation is non-trivial — keys can be xpubs at various derivation paths, fingerprints can disagree with the actual keys (intentionally for hardware-wallet xpubs derived without master fingerprint). Phase 25 plan-checker should call out which validation guarantees are load-bearing vs which are best-effort.
- PSBT combine conflict detection: when two co-signers sign the same input with different signatures (e.g. one signed with the wrong sighash type), the combine MUST refuse rather than silently choose one. Each conflict surfaces with the conflicting signer keys + the input being conflicted.
- The user's signing flow for multisig is identical to Phase 23 single-sig: prepare → preview → send. The difference is the prepare tool now operates on a partially-signed PSBT (loaded from disk or pasted by the user) rather than building from scratch. The send tool's "broadcast" step is replaced by "output finalized PSBT for broadcast elsewhere" — the user's Ledger doesn't have authority to finalize unilaterally.
- Test fixtures: use a 2-of-3 test descriptor with known test xpubs (from the bitcoin test vectors); fixture PSBTs at each stage of the multi-signer flow (1-sig, 2-sig, finalized).

</specifics>

<deferred>
## Deferred Ideas

- LTC scaffolding + LiFi BTC bridging — Phase 26
- Bitcoin/Litecoin Core RPC + incident report — Phase 27
- MuSig (Schnorr-aggregated multisig) — defer until Ledger BTC app supports MuSig signing
- Coordinator-mode (server-side PSBT escrow + multi-party coordination) — out of scope; the user remains a participant in external coordinators
- Threshold signatures (FROST / threshold ECDSA) — out of scope; M-of-N multisig is the BIP-174 model

</deferred>

---

*Phase: 25-btc-psbt-multisig-flow*
*Context placeholder: 2026-05-20 (full context-gathering at `/gsd-discuss-phase 25` time)*
