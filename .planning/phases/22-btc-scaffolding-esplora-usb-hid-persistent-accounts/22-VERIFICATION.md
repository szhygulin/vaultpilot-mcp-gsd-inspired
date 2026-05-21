---
phase: 22-btc-scaffolding-esplora-usb-hid-persistent-accounts
verified: 2026-05-21T10:05:00Z
status: human_needed
score: 8/8 must-haves verified
overrides_applied: 0
human_verification:
  - test: "Real-Ledger USB-HID BTC app pair — physical device required"
    expected: "Connect Ledger, open Bitcoin app, run pair_btc_ledger(); device displays TWO addresses in sequence (segwit then taproot) matching the returned addresses.segwit (bc1q…) + addresses.taproot (bc1p…) byte-for-byte; persists 2 records under chain: 'bitcoin'"
    why_human: "Requires physical Ledger hardware + Bitcoin app installed; verifies that the dual-getWalletPublicKey calls + verify:true on-device confirmation correctly display through the device firmware. Cannot be exercised in CI."
  - test: "Live Esplora cross-check — blockstream.info + mempool.space endpoint compat"
    expected: "Run get_btc_balance against a known mainnet address; sat/BTC balance matches mempool.space or blockstream.info block-explorer UI; with BTC_ESPLORA_URL=https://mempool.space/api override, identical response shape"
    why_human: "Network-dependent; live API may drift; verifies the Esplora HTTP client's URL templating + parsing against actual production responses, not just fixture replays."
  - test: "Live xpub-scan against a known funded BIP-84 zpub"
    expected: "get_btc_account_balance({ xpub }) returns aggregate balance + correct addressesScanned count; gap-limit-20 terminates as expected; per-xpub 5-min TTL cache hit on second call"
    why_human: "Requires a real funded xpub with non-trivial derivation depth to confirm gap-limit + concurrency-5 + TTL behavior end-to-end against live Esplora; tests use mocked fixtures only."
  - test: "VERIFY-ON-DEVICE template renders correctly in agent UI"
    expected: "The full DUAL-address VERIFY-ON-DEVICE block is presented as readable, scannable text in the agent's chat surface; both addresses + both derivation paths appear; line breaks preserve formatting"
    why_human: "Display fidelity is a UX concern — only a human can confirm the text content is human-readable in the actual agent client."
  - test: "Demo persona end-to-end — set_demo_wallet btc-whale + read tools"
    expected: "Setting set_demo_wallet({ slug: 'btc-whale' }) and then running get_btc_balance against the persona's segwit address returns realistic mainnet data; the active envelope is sane"
    why_human: "Verifies the persona registry + demo state carve work as a complete agent-facing surface, not just in isolation."
---

# Phase 22: BTC Scaffolding — Esplora Reads + USB-HID + Persistent BTC Account — Verification Report

**Phase Goal:** USB-HID Ledger pairing for BTC works; BTC balance + UTXO + history readable via Esplora (mempool.space or blockstream.info); paired BTC account persists via the v2.0 Phase 11 cache under `chain: "bitcoin"` record key.

**Verified:** 2026-05-21T10:05:00Z
**Status:** human_needed (8/8 must-haves verified; awaiting hardware + live-network spot checks)
**Re-verification:** No — initial verification.

## Goal Achievement

### Observable Truths (ROADMAP Success Criteria)

| #   | Truth                                                                                                                       | Status     | Evidence                                                                                                                                                                                                            |
| --- | --------------------------------------------------------------------------------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `pair_btc_ledger()` returns first segwit (bc1q…) + first taproot (bc1p…) addresses + VERIFY-ON-DEVICE block over USB-HID    | VERIFIED   | `src/tools/pair_btc_ledger.ts` (10993B) imports `fetchBtcAddresses` from `ledger-btc-transport.ts`; 5 `saveAccount` lines; 5 `chain: "bitcoin"` literals; 19 segwit/taproot references; `VERIFY_ON_DEVICE_BTC_TEMPLATE` const exported. Transport uses `TransportNodeHidModule` + `BtcApp({ transport, currency: "bitcoin" })` + TWO `getWalletPublicKey` calls (BIP-84 `bech32` + BIP-86 `bech32m`, both `verify: true`). |
| 2   | `get_btc_status()` returns `{ paired, addresses: { segwit, taproot }, derivationPaths: { segwit, taproot }, esploraEndpoint, ledgerBtcAppVersion? }` | VERIFIED   | `src/tools/get_btc_status.ts:91-92` — `addresses: { segwit?, taproot? }` and `derivationPaths: { segwit?, taproot? }` as OBJECTS (plural); record discrimination via `r.address.startsWith("bc1q"/"bc1p")` lines 88-89; `esploraEndpoint` via `_bitcoinRegistry.getResolvedEsploraUrl()` line 102; staleAccountWarning per-record OR line 108-110; NO lazy probe (`_btcLedgerTransport` zero matches — deferred to Phase 27 per ROADMAP). |
| 3   | `get_btc_balance({ wallet })` returns sat + BTC-formatted balance via Esplora `/address/{addr}`                             | VERIFIED   | `src/tools/get_btc_balance.ts` imports `fetchAddressInfo` + `fetchAddressUtxos`; pattern-matches on 5-arm union; bigint at boundary; schema-level regex pattern `^bc1(q[...]\{38\}|p[...]\{58\})$`.                                                                                                                                                                                |
| 4   | `get_btc_balances({ wallet })` returns segwit + taproot balances separately (UTXOs distinct per script type)                | VERIFIED   | `src/tools/get_btc_balances.ts` uses `Promise.allSettled` (5 matches); 37 segwit/taproot references; defaults to paired wallet via `listAccounts({ chainFilter: "bitcoin" })`.                                                                                                                                                                                              |
| 5   | `get_btc_account_balance({ xpub })` aggregates across derived addresses via gap-limit-respecting scan                       | VERIFIED   | `src/chains/bitcoin/xpub-scan.ts` exports `scanXpub`, `BIP44_GAP_LIMIT = 20`, `SCAN_CONCURRENCY = 5`, `SCAN_TTL_MS = 5*60*1000`; combined `chain_stats.tx_count + mempool_stats.tx_count` termination; BIP-32 Test Vector 1 anchor hardcoded literals in tests (10 derivations + spec match). `get_btc_account_balance.ts` wraps `scanXpub` + INVALID_XPUB structured envelope on bip32 throw. |
| 6   | `get_btc_tx_history({ wallet, limit })` returns paginated recent transactions via Esplora `/address/{addr}/txs`             | VERIFIED   | `src/tools/get_btc_tx_history.ts` calls `fetchAddressTxs(wallet, { afterTxid: cursor })`; default limit 25; cursor pagination via Esplora `:last_seen_txid`; stripped row shape `{ txid, blockHeight?, confirmedAt?, fee }`.                                                                                                                                                |
| 7   | `get_btc_fee_estimates()` returns 5-key {1, 2, 3, 6, 144} sat/vB projection per ROADMAP SC#7                                | VERIFIED   | `src/tools/get_btc_fee_estimates.ts:23` — `TARGET_KEYS = ["1", "2", "3", "6", "144"]` (all 5 keys); structured-content unit `"sat/vB"`; missing-key guard maps to ESPLORA_ERROR; canonical `/fee-estimates` (NOT mempool.space proprietary path).                                                                                                                          |
| 8   | Paired BTC account persists under `chain: "bitcoin"` record key (PAIR-NEV-* multi-record-per-chain)                         | VERIFIED   | `src/wallet/non-evm-account-store.ts:43` — `NonEvmChain = "solana" | "tron" | "bitcoin" | "litecoin"` (literal-union includes "bitcoin"); line 48 — `"bitcoin"` registered in the chain list. Pair tool writes 2 records (5 saveAccount lines, both `chain: "bitcoin"`). FROZEN-area zero-diff against origin/main confirmed in SUMMARY — schema unchanged. |

**Score:** 8/8 ROADMAP Success Criteria verified.

### Required Artifacts (Level 1-3: exists + substantive + wired)

| Artifact                                          | Expected                                                                                                       | Exists | Substantive | Wired | Status     |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | ------ | ----------- | ----- | ---------- |
| `src/chains/bitcoin/registry.ts`                  | Lazy Esplora resolver + `_bitcoinRegistry` ESM spy seam + warn-once-on-fallback                                | YES    | YES (5180B) | YES   | VERIFIED   |
| `src/chains/bitcoin/types.ts`                     | Branded segwit + taproot types; two-gate assert; UtxoRow + BalanceReport; initEccLib(tinySecp256k1) at module-load | YES    | YES (8343B) | YES   | VERIFIED   |
| `src/chains/bitcoin/esplora-client.ts`            | 4 fetch helpers (info / utxos / txs / fee-estimates) + 5-arm union + LRU + AbortController                     | YES    | YES (20509B)| YES   | VERIFIED   |
| `src/chains/bitcoin/xpub-scan.ts`                 | Gap-limit-20 BIP-44 scanner + concurrency-5 + 5-min TTL cache + BIP-32 anchors                                 | YES    | YES (10780B)| YES   | VERIFIED   |
| `src/wallet/ledger-btc-transport.ts`              | USB-HID transport + dual `getWalletPublicKey` + `getAppConfiguration` BTC-app gate                             | YES    | YES (11849B)| YES   | VERIFIED   |
| `src/tools/pair_btc_ledger.ts`                    | Demo-mode-first + 60s race + dual saveAccount + DUAL VERIFY-ON-DEVICE                                          | YES    | YES (10993B)| YES   | VERIFIED   |
| `src/tools/get_btc_status.ts`                     | Dual-record envelope + esploraEndpoint + per-record stale OR                                                   | YES    | YES (6862B) | YES   | VERIFIED   |
| `src/tools/get_btc_balance.ts`                    | Single-address BalanceReport via Esplora                                                                       | YES    | YES (4616B) | YES   | VERIFIED   |
| `src/tools/get_btc_balances.ts`                   | Parallel segwit + taproot via `Promise.allSettled`                                                             | YES    | YES (6685B) | YES   | VERIFIED   |
| `src/tools/get_btc_account_balance.ts`            | xpub aggregator via `scanXpub`; INVALID_XPUB envelope                                                          | YES    | YES (5796B) | YES   | VERIFIED   |
| `src/tools/get_btc_tx_history.ts`                 | Paginated tx history via `:last_seen_txid` cursor                                                              | YES    | YES (5273B) | YES   | VERIFIED   |
| `src/tools/get_btc_fee_estimates.ts`              | 24-key → 5-key {1,2,3,6,144} sat/vB projection                                                                 | YES    | YES (3379B) | YES   | VERIFIED   |
| `src/demo/bitcoin-persona.ts`                     | Sibling-interface registry + DUAL DOA + OFAC-clean BTC whale                                                   | YES    | YES (9652B) | YES   | VERIFIED   |
| `src/config/env.ts`                               | Additive `getBtcEsploraUrl(): string \| null` at line 110                                                      | YES    | YES         | YES   | VERIFIED   |

All 14 expected artifacts present and substantively wired through `register-all.ts` (7 BTC tool imports verified).

### Key Link Verification (Wiring)

| From                                       | To                                          | Via                                                                | Status |
| ------------------------------------------ | ------------------------------------------- | ------------------------------------------------------------------ | ------ |
| `src/chains/bitcoin/registry.ts`           | `src/config/env.ts`                         | `getBtcEsploraUrl` import + call                                  | WIRED  |
| `src/chains/bitcoin/esplora-client.ts`     | `src/chains/bitcoin/registry.ts`            | `_bitcoinRegistry.getEsploraBaseUrl()` URL templating              | WIRED  |
| `src/chains/bitcoin/types.ts`              | `bitcoinjs-lib`                             | `address.toOutputScript(addr, networks.bitcoin)` checksum gate    | WIRED  |
| `src/tools/pair_btc_ledger.ts`             | `src/wallet/non-evm-account-store.ts`       | 2× `saveAccount({ chain: "bitcoin", ... })`                       | WIRED  |
| `src/wallet/ledger-btc-transport.ts`       | `@ledgerhq/hw-transport-node-hid` + `hw-app-btc` | `_transport` spy seam wrapping `TransportNodeHid` + `BtcApp({ currency: "bitcoin" })` | WIRED  |
| `src/wallet/ledger-btc-transport.ts`       | Ledger BTC app                              | TWO `getWalletPublicKey` calls (`bech32` + `bech32m`, `verify: true`) within ONE `try/finally close` | WIRED  |
| `src/tools/get_btc_balance.ts`             | `src/chains/bitcoin/esplora-client.ts`      | `fetchAddressInfo` + `fetchAddressUtxos`                          | WIRED  |
| `src/tools/get_btc_balances.ts`            | `Promise.allSettled`                        | parallel segwit + taproot fan-out                                  | WIRED  |
| `src/chains/bitcoin/xpub-scan.ts`          | `bitcoinjs-lib`                             | `bip32.fromBase58 + payments.p2wpkh/p2tr`                         | WIRED  |
| `src/tools/get_btc_fee_estimates.ts`       | `src/chains/bitcoin/esplora-client.ts`      | `fetchFeeEstimates`                                                | WIRED  |
| `src/tools/get_btc_status.ts`              | `src/wallet/non-evm-account-store.ts`       | `listAccounts({ chainFilter: "bitcoin" })`                        | WIRED  |
| `src/tools/get_btc_status.ts`              | `src/chains/bitcoin/registry.ts`            | `_bitcoinRegistry.getResolvedEsploraUrl()`                        | WIRED  |
| `src/demo/bitcoin-persona.ts`              | `bitcoinjs-lib`                             | DUAL `address.toOutputScript` at module load (DOA)                | WIRED  |
| `src/tools/set_demo_wallet.ts`             | `src/demo/bitcoin-persona.ts`               | `findBtcPersona` dispatch on `btc-whale` slug                     | WIRED  |
| `src/tools/register-all.ts`                | 7 BTC tools                                 | `import "./pair_btc_ledger.js"` + 5 read tools + `get_btc_status` | WIRED  |

All 15 key links verified.

### Data-Flow Trace (Level 4)

Read-only phase — data flows from Esplora HTTP API + Ledger device + the persistent JSON store into the tool responses. All tested via fetch-stubbed unit tests (fixtures captured from live Esplora responses per 22-RESEARCH §Validation Architecture #2). No hardcoded empty data; the test suite asserts realistic byte-for-byte response shapes.

| Artifact                              | Data Variable              | Source                                              | Produces Real Data | Status   |
| ------------------------------------- | -------------------------- | --------------------------------------------------- | ------------------ | -------- |
| `get_btc_balance.ts`                  | `result` (BalanceReport)   | `fetchAddressInfo` + `fetchAddressUtxos` (Esplora) | Yes (verified by 8 unit tests with live fixtures + bigint boundary tests) | FLOWING  |
| `get_btc_balances.ts`                 | `{ segwit, taproot }`      | 4× Esplora fetches via `Promise.allSettled`         | Yes (6 tests including one-side rate-limit)                                | FLOWING  |
| `get_btc_account_balance.ts`          | `scanXpub` result          | `bip32.fromBase58 → derive(0).derive(i)` + Esplora | Yes (BIP-32 Test Vector 1 deterministic anchors — 10 hardcoded literals)   | FLOWING  |
| `get_btc_tx_history.ts`               | `result.txs`               | `fetchAddressTxs` cursor pagination                 | Yes (7 tests covering pagination + stripped row shape)                     | FLOWING  |
| `get_btc_fee_estimates.ts`            | `result.estimates`         | `fetchFeeEstimates` Esplora                         | Yes (5 tests covering projection + missing-key guard)                      | FLOWING  |
| `get_btc_status.ts`                   | `records` (NonEvmAccountView[]) | `listAccounts({ chainFilter: "bitcoin" })`         | Yes (11 tests covering 0 / segwit-only / taproot-only / both record cases) | FLOWING  |
| `pair_btc_ledger.ts`                  | `addresses` (segwit + taproot) | `fetchBtcAddresses` → Ledger device (USB-HID)      | Yes (transport tests stub `_transport.list`/`open`/`buildBtcApp`; real device verifies in human check) | FLOWING (unit-tested; live-device check deferred to human) |
| `bitcoin-persona.ts`                  | `BTC_PERSONAS[0]`          | Hardcoded persona (Binance segwit cold wallet + BIP-86 spec taproot) | Yes (15 tests including DOA validation + bySlug round-trip) | FLOWING  |

### Behavioral Spot-Checks

| Behavior                                                                                  | Command                                                                                   | Result                                       | Status |
| ----------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | -------------------------------------------- | ------ |
| TypeScript compiles cleanly                                                               | `npx tsc --noEmit`                                                                        | exit 0 (no output)                            | PASS   |
| Full test suite passes                                                                    | `npm test`                                                                                | 2677 passed, 1 skipped, 0 failures (213 test files) | PASS   |
| 7 BTC tools registered                                                                    | `grep -E "import \"\\./(get_btc\|pair_btc)" src/tools/register-all.ts \| wc -l`           | 7 lines                                       | PASS   |
| `btcEsploraConfigured` surfaced at 4 sites in config-status                                | `grep -c "btcEsploraConfigured" src/tools/get_vaultpilot_config_status.ts`                | 4                                             | PASS   |
| `BIP44_GAP_LIMIT === 20`                                                                  | `grep "BIP44_GAP_LIMIT = 20" src/chains/bitcoin/xpub-scan.ts`                             | found                                         | PASS   |
| DEFAULT path constants pinned                                                              | `grep -E "(DEFAULT_BTC_SEGWIT_PATH\|DEFAULT_BTC_TAPROOT_PATH)\s*=" src/wallet/ledger-btc-transport.ts` | `84'/0'/0'/0/0` + `86'/0'/0'/0/0` | PASS   |
| `verify: true` on both `getWalletPublicKey` calls                                          | `grep -c "verify: true" src/wallet/ledger-btc-transport.ts`                                | 3 (2 calls + 1 doc comment)                  | PASS   |
| DUAL DOA in bitcoin-persona                                                                | `grep -c "toOutputScript" src/demo/bitcoin-persona.ts`                                     | 9 (includes ritual comment block)             | PASS   |

### Requirements Coverage

| Requirement   | Source Plan(s)     | Description                                                                                                       | Status     | Evidence                                                                                                                                                                            |
| ------------- | ------------------ | ----------------------------------------------------------------------------------------------------------------- | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PAIR-NEV-01   | 22-02              | Per-chain record schema with chain/address/derivationPath/pairedAt                                                | SATISFIED  | `src/wallet/non-evm-account-store.ts` schema unchanged (FROZEN); BTC writes use this surface. 2 records per pair.                                                                  |
| PAIR-NEV-02   | 22-02              | Cold-boot eager-load via existing startServer() path; first get_<chain>_status returns paired:true after restart  | SATISFIED  | `test/non-evm-store.eager-init.test.ts` extension covers dual-bitcoin-record cold-boot restore (Plan 22-02 Task 2).                                                                |
| PAIR-NEV-03   | 22-02              | Per-chain records keyed by chain; multiple addresses per chain supported                                          | SATISFIED  | `NonEvmChain` union includes `"bitcoin"` (line 43); `(chain, address)` upsert supports multi-record-per-chain; 2 sibling records under chain: "bitcoin" verified.                  |
| PAIR-NEV-04   | 22-04              | Stale-session detection on restore (>30 days → staleAccountWarning)                                               | SATISFIED  | `get_btc_status.ts:108-110` — envelope-level OR of per-record `staleAccountWarning`; tests cover EITHER segwit/taproot stale.                                                      |
| PAIR-NEV-05   | 22-02              | list_paired_non_evm_accounts + remove_paired_non_evm_account preserve (no derivationPath bleed)                   | SATISFIED  | SUMMARY confirms `src/tools/list_paired_non_evm_accounts.ts` BYTE-UNTOUCHED; `test/list-paired-non-evm-accounts.test.ts` still passes (shoulder-surfing defense intact).            |
| PAIR-NEV-06   | 22-02              | VAULTPILOT_NON_EVM_STORAGE=memory opt-out works                                                                   | SATISFIED  | Inherited from Phase 11; non-evm-account-store FROZEN-area zero-diff.                                                                                                              |
| PAIR-NEV-07   | 22-04              | get_vaultpilot_config_status surfaces pairedNonEvmChains + nonEvmStoragePersistent + pairedNonEvmAccountCount      | SATISFIED  | `get_vaultpilot_config_status.ts` has `btcEsploraConfigured` at 4 sites; `pairedNonEvmChains` aggregation auto-includes "bitcoin" via existing `new Set` (ZERO code change).        |
| BTC-PAIR-01   | 22-02              | pair_btc_ledger over USB-HID; returns first segwit + first taproot + VERIFY-ON-DEVICE                             | SATISFIED  | Transport + tool + 26+11 tests confirmed; 5+1 errorCode set locked; dual on-device verify with `verify: true`.                                                                     |
| BTC-PAIR-02   | 22-04              | get_btc_status returns dual-address envelope                                                                      | SATISFIED  | Spec correction (singular→plural object) shipped in PR #119; SUMMARY confirms ROADMAP + REQUIREMENTS lines pre-fixed.                                                              |
| BTC-READ-01   | 22-01, 22-03       | get_btc_balance via Esplora /address/{addr}                                                                       | SATISFIED  | `get_btc_balance.ts` + esplora-client `fetchAddressInfo` + 8 unit tests.                                                                                                            |
| BTC-READ-02   | 22-01, 22-03       | get_btc_balances segwit + taproot separately                                                                       | SATISFIED  | `get_btc_balances.ts` Promise.allSettled + 6 unit tests including one-side rate-limit isolation.                                                                                    |
| BTC-READ-03   | 22-01, 22-03       | get_btc_account_balance gap-limit-respecting xpub scan                                                            | SATISFIED  | `xpub-scan.ts` greenfield (10780B) with BIP44_GAP_LIMIT=20 + concurrency-5 + 5-min TTL; 14 unit tests + BIP-32 Test Vector 1 deterministic anchor.                                  |
| BTC-READ-04   | 22-01, 22-03       | get_btc_tx_history paginated via Esplora                                                                          | SATISFIED  | `get_btc_tx_history.ts` cursor pagination + default limit 25 + max 100; 7 unit tests.                                                                                              |
| BTC-READ-05   | 22-01, 22-03       | get_btc_fee_estimates sat/vB for 1/2/3/6/144 block targets                                                        | SATISFIED  | `get_btc_fee_estimates.ts:23` TARGET_KEYS = ["1","2","3","6","144"]; structured-content unit "sat/vB"; missing-key guard.                                                          |

All 14 declared requirement IDs satisfied. No orphaned IDs.

### Anti-Patterns Found

| File                                          | Line  | Pattern                | Severity | Impact                                                                                                            |
| --------------------------------------------- | ----- | ---------------------- | -------- | ----------------------------------------------------------------------------------------------------------------- |
| _(none)_                                      | _n/a_ | _n/a_                  | _n/a_    | All anti-pattern grep gates passed: 0 `Psbt` imports in Phase 22 surface; 0 `{57}` taproot regex (only documentation comment defending against the wrong shape exists at `src/chains/bitcoin/types.ts:87`); 0 `derivationPath` singular leak in `get_btc_status.ts` response surface (the 4 occurrences are field READS from `NonEvmAccountView.derivationPath` feeding into the plural-object `derivationPaths` output — lines 95/99/131/135 correctly read source field, emit plural target). |

False-positive triage:
- `{57}` match at `src/chains/bitcoin/types.ts:87` is a regression-anchor comment explicitly documenting that `{57}` would be WRONG (the correct `{58}` is enforced by `BTC_TAPROOT_RE`). The comment is load-bearing prose, not code.
- `derivationPath` singular matches at `get_btc_status.ts:95/99/131/135` read from `segwitRecord.derivationPath` and `taprootRecord.derivationPath` (the source field on `NonEvmAccountView`) to populate the plural-object `derivationPaths: { segwit, taproot }` response. Source-field reads are correct; response surface uses the plural-object shape.

### Goal-Backward Verification — 8 ROADMAP Success Criteria

| # | SC                                                                                                | Evidence-in-codebase                                                                                                                                                                                                                                                              |
| - | ------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 | `pair_btc_ledger()` over USB-HID, dual-address + VERIFY-ON-DEVICE                                 | `pair_btc_ledger.ts`: 5 `saveAccount` lines, 5 `chain: "bitcoin"` lines, 3 VERIFY_ON_DEVICE references, 19 segwit/taproot mentions. Transport: `BtcApp({ currency: "bitcoin" })`, 2 `getWalletPublicKey` calls, `verify: true` × 2. Demo-mode-FIRST gate present.                |
| 2 | `get_btc_status()` envelope with paired/addresses/derivationPaths/esploraEndpoint                  | `get_btc_status.ts`: 33 occurrences of envelope fields; `_bitcoinRegistry.getResolvedEsploraUrl()` at line 102; per-record staleAccountWarning OR at line 108; NO `_btcLedgerTransport` invocation (0 matches — no lazy probe).                                                |
| 3 | `get_btc_balance({ wallet })` sat + BTC via Esplora                                                | `get_btc_balance.ts`: imports `fetchAddressInfo` + `fetchAddressUtxos`; schema-level pattern gate; bigint at boundary; ESPLORA_RATE_LIMITED + ESPLORA_ERROR envelope codes.                                                                                                       |
| 4 | `get_btc_balances({ wallet })` segwit + taproot separate                                          | `get_btc_balances.ts`: 5 `Promise.allSettled` matches; 37 segwit/taproot mentions; defaults to paired wallet from `listAccounts({ chainFilter: "bitcoin" })`.                                                                                                                    |
| 5 | `get_btc_account_balance({ xpub })` gap-limit-20 scan                                              | `xpub-scan.ts`: `BIP44_GAP_LIMIT = 20`, `SCAN_CONCURRENCY = 5`, `SCAN_TTL_MS = 5*60*1000`, combined-count termination, BIP-32 Test Vector 1 anchors (10 hardcoded literals).                                                                                                     |
| 6 | `get_btc_tx_history({ wallet, limit })` paginated                                                  | `get_btc_tx_history.ts`: `fetchAddressTxs(wallet, { afterTxid: cursor })`; default limit 25; cursor pagination; stripped row shape.                                                                                                                                              |
| 7 | `get_btc_fee_estimates()` 5-key {1,2,3,6,144} sat/vB                                              | `get_btc_fee_estimates.ts:23`: `TARGET_KEYS = ["1", "2", "3", "6", "144"] as const`; structured `units: "sat/vB"`; missing-key guard maps to ESPLORA_ERROR.                                                                                                                       |
| 8 | PAIR-NEV-* persistence at `chain: "bitcoin"` record key                                            | `non-evm-account-store.ts:43`: `NonEvmChain = "solana" \| "tron" \| "bitcoin" \| "litecoin"`; line 48 enumerated; 2 sibling records per pair; FROZEN-area zero-diff confirmed — schema unchanged.                                                                                |

### Human Verification Required

See `human_verification` items in frontmatter — 5 items deferred for hardware + live-network spot checks per the 2026-05-16 directive (bundled with Phase 17/21 deferred items for v2.2 verify-phase).

### Gaps Summary

**None.** All 8 ROADMAP Success Criteria, 14 requirement IDs, 14 expected artifacts, and 15 key links are verified in the codebase. Full test suite passes (2677/2678 — 1 skipped, 0 failures). `tsc --noEmit` clean. Phase 22 is code-complete; status is `human_needed` solely because the goal "USB-HID Ledger pairing for BTC works" cannot be fully validated without physical Ledger hardware + the Bitcoin app — the automated unit tests cover the transport seam exhaustively, but the actual device interaction is necessarily a manual smoke test.

Test-count baseline matches the SUMMARY claim exactly: 2467 → 2677 (+210). All 4 plans landed clean per their SUMMARY documents. FROZEN-area zero-diff preserved across `src/wallet/non-evm-account-store.ts`, `src/tools/list_paired_non_evm_accounts.ts`, `src/chains/{solana,tron}/`, `src/clients/{etherscan,fourbyte}.ts`, and the existing EVM/Solana/TRON persona files — sibling-interface discipline held.

---

_Verified: 2026-05-21T10:05:00Z_
_Verifier: Claude (gsd-verifier, opus-4-7[1m])_
