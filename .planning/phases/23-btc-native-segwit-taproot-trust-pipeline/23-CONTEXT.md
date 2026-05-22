# Phase 23: BTC native + segwit + taproot trust pipeline (PSBT-based) - Context

**Gathered:** 2026-05-22
**Status:** Ready for planning

<domain>
## Phase Boundary

Full prepare → preview → send flow works for native BTC sends. The BTC trust pipeline is structurally distinct: PSBT (BIP-174) serialization replaces the EVM/Solana/TRON single-blob shape; `payloadFingerprint` is computed over BIP-143 sighashes concatenated per input (not the whole tx); the Ledger BTC app signs each input via the PSBT workflow. Native segwit (bc1q…) AND taproot (bc1p…) script types both supported; mixed-script-type inputs supported (some segwit + some taproot in the same tx).

This is the load-bearing milestone for v2.2 — the BTC UTXO-model trust pipeline mirror of Phase 4 (EVM) / Phase 12 (Solana) / Phase 18 (TRON). Phase 24+ extends with RBF / message-signing / multisig — all reusing this pipeline.

**In scope:** BTC-PREP-01..03, BTC-PSBT-01, BTC-PSBT-02, BTC-W-01 — `prepare_btc_send` + `preview_send` BTC branch + `send_transaction` BTC branch; segwit + taproot + mixed-input.
**Out of scope:** RBF (Phase 24), BIP-137 message signing (Phase 24), PSBT multisig (Phase 25), LTC (Phase 26), LiFi BTC bridging (Phase 26).

</domain>

<decisions>
## Implementation Decisions

### Coin selection
- **D-01:** Default coin-selection is **branch-and-bound (BnB) across the full UTXO set regardless of script type** — BnB optimizes over both bc1q and bc1p UTXOs together. Manual UTXO override always available for advanced users. Mixed-script-type inputs are a required success criterion (SC#5) and the BnB-default path exercises that mixed-input code path by construction. FIFO/largest-first is the fallback when BnB finds no clean match (per the placeholder DF).

### Change-output address
- **D-02:** Change goes to a **fresh derived change-chain address** — the next unused address on the change chain (`m/84'/0'/0'/1/k` for segwit, `m/86'/0'/0'/1/k` for taproot). Standard wallet privacy practice; avoids address reuse. The Ledger BTC app must recognize the change address as its own to display it as "change" rather than a send — so change MUST be a Ledger-derivable address on the paired account.
  - **Researcher must resolve:** Phase 22's xpub gap-limit scan covered the *receive* chain (chain `0`). Change-chain (chain `1`) index tracking is new for Phase 23 — confirm whether to (a) extend the Phase 22 xpub scan to also scan chain `1`, or (b) track a per-account change index in the persistent cache. Match the change output's script type to the dominant input script type (segwit change for a segwit-majority tx; taproot change for taproot-majority) so the Ledger app's change verification path stays clean.

### Default fee rate
- **D-03:** When `feeRate` is omitted, `prepare_btc_send` defaults to the **~3-block (balanced) Esplora estimate** from `get_btc_fee_estimates` (the `{1,2,3,6,144}`-block projection shipped in Phase 22). `feeSats` is always surfaced verbatim in the `PREPARE RECEIPT` and approved on-device — the default is a convenience, not a hidden cost. Fee-rate sanity bounds still apply: prepare-time refuses `feeRate` < 1 sat/vB or > 10× current high-priority estimate (decimal-place-mistake defense).

### Demo mode
- **D-04:** Demo-mode BTC send uses a **mempool-replay envelope** — demo produces a fully-formed PSBT + a simulated "broadcast accepted" envelope without touching a device, mirroring the Solana/TRON demo-mode signing shape. Keeps demo-mode parity across all chains. Wires to the BTC whale persona added in Phase 22.

### Locked from placeholder / roadmap (carried forward, not re-discussed)
- **D-05:** Fingerprint preimage: `keccak256("VaultPilot-btctx-v1:" ‖ <BIP-143 sighashes per input, concatenated>)` — domain-tagged, distinct from EVM/Solana/TRON tags, per-input commitment. Multi-input tx → multi-hash preimage. (BTC-PREP-01.)
- **D-06:** Phase 23 ships **RBF-disabled by default** — `sequence ≥ 0xfffffffe`. RBF signaling is Phase 24's concern.
- **D-07:** Dust-threshold enforcement: outputs below the BIP-141 dust threshold (~330 sats segwit, ~546 sats legacy) refused at prepare-time.

### Design forks for the researcher (resolve at execute time per `rnd`)
- **DF-1 — PSBT version:** PSBT-v0 (BIP-174) is the Phase 23 default — universally supported by Ledger BTC apps. Scope-probe `bitcoinjs-lib` v7 PSBT-v2 (BIP-370) support + Ledger BTC app PSBT-v2 acceptance; adopt v2 only if the probe finds clean support on both sides.
- **DF-2 — BIP-143 sighash byte-encoding stability:** Confirm `bitcoinjs-lib` v7's BIP-143 (segwit) and BIP-341 (taproot) sighash byte-encoding is stable and reproducible across versions before pinning Fixture O/P/Q literals.
- **DF-3 — `@ledgerhq/hw-app-btc` v10 PSBT-signing API surface:** Type-check the per-input PSBT-signing call sketches against the installed `.d.ts` — confirm the v10 API exposes the PSBT workflow (`signPsbt` / equivalent) and surfaces per-input sighashes for the `LEDGER BLIND-SIGN HASH` block.

### Claude's Discretion
- Fixture O/P/Q literal anchor values — researcher computes at execute time via `node -e`.
- Internal helper names (`buildBtcPsbt`, `selectCoinsBnb`, `deriveChangeAddress`, etc.).
- Test mocking strategy for the Ledger BTC-app transport (mirror the Solana/TRON USB-HID mock pattern).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project context
- `CLAUDE.md` — fingerprint conventions; FROZEN-area discipline; cryptographic-binding fixture pinning rules
- `.planning/REQUIREMENTS.md` §BTC-PREP-01..03 + §BTC-PSBT-01/02 + §BTC-W-01 — exact Phase 23 surface
- `.planning/ROADMAP.md` Phase 23 (lines 629-651) — Goal / Success Criteria / 4-plan breakdown
- `.planning/phases/22-btc-scaffolding-esplora-usb-hid-persistent-accounts/22-CONTEXT.md` + `22-RESEARCH.md` + `22-PATTERNS.md` — Phase 22 shapes Phase 23 inherits with zero refactor

### Pattern references (v1.x + v2.0 + v2.1 precedents to mirror)
- `src/signing/payload-fingerprint.ts` (Plan 04-01) — EVM fingerprint; FROZEN; Phase 23 adds `btc-fingerprint.ts` sibling
- `src/signing/payload-fingerprint-solana.ts` (Plan 12-01) — Solana fingerprint; sibling shape
- `src/signing/payload-fingerprint-tron.ts` (Plan 18-01) — TRON fingerprint; sibling shape
- `src/signing/presign-hash-solana.ts` + `presign-hash-tron.ts` — blind-sign hash precedents
- `src/protocols/solana-system.ts` + `solana-spl.ts` — protocol-encoder pattern; Phase 23's `btc-psbt.ts` mirrors at a higher level
- `src/signing/blocks-solana.ts` + `blocks-tron.ts` — `PREPARE RECEIPT` / preview block templates
- `src/chains/bitcoin/` (`esplora-client.ts` + `registry.ts` + `types.ts` + `xpub-scan.ts`) — Phase 22 BTC chain shelf; `BalanceReport` discriminated union carries `utxos[]` load-bearing for coin selection
- `src/tools/get_btc_fee_estimates.ts` — Phase 22 `{1,2,3,6,144}`-block fee projection consumed by D-03 default
- `src/tools/send_transaction.ts` — FROZEN three-gate region; BTC dispatch arm is additive BELOW the FROZEN region (same site Phase 12 carved Solana / Phase 18 carved TRON)
- `test/signing-fingerprint.test.ts` — Fixtures A-N; Phase 23 appends Fixture O (segwit) + P (taproot) + Q (mixed) as hardcoded `0x…` literals

### External
- BIP-174 (PSBT v0) — https://github.com/bitcoin/bips/blob/master/bip-0174.mediawiki
- BIP-370 (PSBT v2) — https://github.com/bitcoin/bips/blob/master/bip-0370.mediawiki
- BIP-143 (segwit sighash) — https://github.com/bitcoin/bips/blob/master/bip-0143.mediawiki
- BIP-341 (taproot) + BIP-342 (tapscript) — https://github.com/bitcoin/bips/blob/master/bip-0341.mediawiki
- `bitcoinjs-lib` v7 — https://github.com/bitcoinjs/bitcoinjs-lib (PSBT serializer + script support)
- `@ledgerhq/hw-app-btc` v10 — https://www.npmjs.com/package/@ledgerhq/hw-app-btc (PSBT-signing workflow)
- Bitcoin coin-selection paper (BnB) — Erhardt 2016

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/chains/bitcoin/esplora-client.ts` — never-throws 5-arm HTTP client; Phase 23 reuses it to fetch UTXOs for coin selection and to broadcast the finalized tx.
- `src/chains/bitcoin/types.ts` `BalanceReport` discriminated union — already surfaces `utxos[]` separately (per Phase 22 RESEARCH Pitfall 3); coin selection consumes this directly, no re-fetch.
- `src/chains/bitcoin/xpub-scan.ts` — gap-limit-20 scan; D-02 needs this extended (or a sibling) to cover the change chain (`1`).
- `src/signing/handle-store.ts` — opaque handle store; `prepare_btc_send` creates a handle exactly like the EVM/Solana/TRON prepare tools.
- `@ledgerhq/hw-app-btc` ^10.22.1 + `bitcoinjs-lib` ^7.0.1 — already in `package.json` (Phase 22). No new top-level deps expected.

### Established Patterns
- **FROZEN three-gate region** of `send_transaction.ts` is byte-untouched across Solana + TRON; the BTC dispatch arm is additive below it via the `txType` discriminator.
- **Sibling-file fingerprint modules** — never modify EVM/Solana/TRON fingerprint files; add `btc-fingerprint.ts` as a new sibling.
- **Cryptographic-binding fixtures as hardcoded literals** — Fixtures O/P/Q follow the `signing-fingerprint.test.ts` convention; NO `beforeAll`-snapshot.
- **`PREPARE RECEIPT` block** — verbatim args; never elided. BTC receipt adds inputs/outputs/feeSats slots.

### Integration Points
- `send_transaction.ts` BTC dispatch arm — below the FROZEN region.
- `preview_send.ts` — new BTC branch; per-input sighash recompute as the Layer 1 defense.
- `register-all` tool registration — `prepare_btc_send` registered alongside the Phase 22 BTC read tools.

</code_context>

<specifics>
## Specific Ideas

- UTXO-model trust-pipeline fingerprint is fundamentally distinct from account-model: per-input sighashes commit to that input's spending authorization. Multi-input fingerprint = concat of N sighashes inside the domain-tagged preimage. Compromise model: if any single input's sighash drifts between prepare and send, the fingerprint diverges and the Layer-3 drift gate refuses.
- The Ledger BTC app's PSBT-signing UX: device displays "Inputs / Outputs / Fee" summary; user confirms; per-input signing happens device-side. The `LEDGER BLIND-SIGN HASH` block surfaces the per-input sighashes the device will display.
- Persona-cycle byte-identity test shape: the UTXO-derived from-set is per-persona-distinct (each persona has different UTXOs), so the fingerprint is BY CONSTRUCTION persona-distinct. Phase 23's integration test asserts: same `to` + `sats` produces persona-distinct fingerprints (UTXOs differ); same `to` + `sats` + same UTXOs (manual override) produces byte-identical fingerprints (regression anchor against preimage drift).
- SECURITY.md updates: PSBT serialization trust shape, per-input BIP-143 sighash binding, multi-input sighash recompute as Layer 1 (preview) defense, Ledger BTC app's per-input signing flow.

</specifics>

<deferred>
## Deferred Ideas

- BIP-125 RBF + BIP-137 message signing — Phase 24
- PSBT multisig flow (register / combine / sign / finalize) — Phase 25
- LTC native send (mirrors BTC) + LiFi BTC bridging — Phase 26
- BIP-322 taproot message signing — future tool (`sign_message_btc_bip322`)
- RBF signaling at prepare-time (`sequence < 0xfffffffe`) — Phase 24 introduces RBF tools; Phase 23 ships RBF-disabled (D-06)

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 23-btc-native-segwit-taproot-trust-pipeline*
*Context gathered: 2026-05-22*
