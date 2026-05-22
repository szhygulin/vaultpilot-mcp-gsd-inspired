---
phase: 25-btc-psbt-multisig-flow
plan: "01"
subsystem: btc-multisig-registry
tags:
  - bitcoin
  - multisig
  - psbt
  - bip-67
  - bip-380
  - esplora
  - atomic-write
dependency_graph:
  requires:
    - 22-01  # Esplora client
    - 22-03  # xpub-scan gap-limit pattern
    - 23-03  # btc-psbt base + BIP-32 derivation pattern
    - 24-01  # error-codes additive pattern (Phase 24 BTC block)
  provides:
    - btc-multisig-registry  # BtcMultisigWalletRecord CRUD at ~/.vaultpilot-mcp/btc-multisig.json
    - register_btc_multisig_wallet  # tool (BTC-PSBT-03)
    - get_btc_multisig_balance  # tool (BTC-PSBT-04)
    - get_btc_multisig_utxos  # tool (BTC-PSBT-04)
    - MULTISIG_* error codes  # 6 new codes in error-codes.ts
  affects:
    - 25-02  # combine_btc_psbts + finalize_btc_psbt read from this registry
    - 25-03  # sign_btc_multisig_psbt reads walletHmac from this registry
tech_stack:
  added:
    - bip32 (BIP32Factory) — already project dep; now used for multisig P2WSH address derivation
    - bitcoinjs-lib payments.p2ms + p2wsh — already project dep; used for BIP-67 witnessScript
  patterns:
    - atomic-write tempfile+rename at 0o600 (mirrors non-evm-account-store.ts)
    - _btcMultisigStorage ESM spy-affordance (mirrors _storage pattern)
    - vi.spyOn(_btcMultisigStorage) for fs seam in tests
    - vi.stubGlobal("fetch") for Esplora seam in read-tool tests
    - gap-limit scan (concurrency 5, 20-consecutive-unused) mirroring xpub-scan.ts
key_files:
  created:
    - src/config/btc-multisig-storage.ts
    - src/wallet/btc-multisig-store.ts
    - src/tools/register_btc_multisig_wallet.ts
    - src/tools/get_btc_multisig_balance.ts
    - src/tools/get_btc_multisig_utxos.ts
    - test/btc-multisig-store.test.ts
    - test/btc-multisig-address-derivation.test.ts
    - test/tools-register-btc-multisig-wallet.test.ts
  modified:
    - src/signing/error-codes.ts  # 6 new Phase 25 error codes
    - src/tools/register-all.ts   # 3 new Phase 25 imports
decisions:
  - HMAC-less registration: register_btc_multisig_wallet stores record WITHOUT walletHmac in this plan; device on-chain registration (AppClient.registerWallet) lands in Plan 25-03 per locked Fork 2 decision from RESEARCH.md
  - Descriptor validation: only /** key expression suffix accepted (refuses /* and /0/* per Pitfall 6); parseWshSortedMulti returns null on any violation before persistence
  - BIP-67 child sort: sort is on DERIVED CHILD pubkeys (not xpubs in descriptor) — per RESEARCH Pitfall 1; confirmed by hardcoded fixture addresses in test
  - Gap-limit scan for read tools: same BIP-44 gap-limit algorithm as xpub-scan.ts (20 consecutive unused, concurrency 5); derives P2WSH addresses not P2WPKH
metrics:
  duration_minutes: 45
  completed_date: "2026-05-22"
  tasks_completed: 3
  tasks_total: 3
  files_created: 8
  files_modified: 2
  tests_added: 51
---

# Phase 25 Plan 01: Multisig Wallet Registry Summary

**One-liner:** BTC M-of-N multisig wallet registry with BIP-67 P2WSH derivation, atomic 0o600 persistence, and three tools: register (validate+store descriptor), balance aggregate, and UTXO list via Esplora gap-limit scan.

## What Was Built

### Storage Layer (Task 1)
- `src/config/btc-multisig-storage.ts`: `getBtcMultisigStoragePath/Mode/Dir` + `ensureStorageDirWithPerms` — exact mirror of `non-evm-storage.ts` for the `~/.vaultpilot-mcp/btc-multisig.json` registry.
- `src/wallet/btc-multisig-store.ts`: Complete registry module — `BtcMultisigWalletRecord` interface (with optional `walletHmac`), `_btcMultisigStorage` ESM spy-affordance, `writeAtomic` (tempfile+rename at mode 0o600), `loadFromDisk` (drop-invalid without deleting file), `saveMultisigWallet` (upsert on `name`), `loadMultisigWallet`, `loadAllMultisigWallets`, `_resetBtcMultisigStoreForTesting`.
- Same module adds: `parseWshSortedMulti` (validates descriptor form + M/N bounds + `/**` suffix enforcement), `extractXpubFromKeyExpr` (bracketed + bare forms), `deriveMultisigAddress` (BIP-67 child pubkey sort + `payments.p2ms` + `payments.p2wsh`).

### Error Codes (Task 2)
- `src/signing/error-codes.ts` extended with 6 new Phase 25 codes (APPEND-ONLY): `PSBT_COMBINE_CONFLICT`, `PSBT_THRESHOLD_NOT_MET`, `MULTISIG_WALLET_NOT_FOUND`, `MULTISIG_WALLET_NOT_REGISTERED_ON_DEVICE`, `LEDGER_BTC_APP_VERSION_TOO_OLD`, `MULTISIG_DESCRIPTOR_INVALID`.

### Tools (Tasks 2+3)
- `src/tools/register_btc_multisig_wallet.ts`: validates descriptor via `parseWshSortedMulti`, enforces 16-byte name limit (Ledger APDU), checks threshold-equals-M, derives 5 P2WSH addresses, surfaces VERIFY-ON-DEVICE block, saves HMAC-less record. Demo-mode refused.
- `src/tools/get_btc_multisig_balance.ts`: gap-limit scan (concurrency 5, 20-consecutive-unused) over derived P2WSH addresses, aggregates confirmed + unconfirmed sats via Esplora.
- `src/tools/get_btc_multisig_utxos.ts`: same gap-limit scan, fetches UTXOs per active address via `fetchAddressUtxos`, returns flat UTXO list with (txid, vout, value as decimal string, address).
- `src/tools/register-all.ts`: 3 new imports for the Phase 25 tools.

### Tests (51 total)
- `test/btc-multisig-store.test.ts` (12 tests): CRUD, atomic-write 0o600, memory-mode no-disk, drop-invalid (persists on corrupt JSON), non-array guard.
- `test/btc-multisig-address-derivation.test.ts` (21 tests): descriptor accept/reject including M>N, M<1, `/*`, `/0/*`, no-suffix; `extractXpubFromKeyExpr` both forms; `deriveMultisigAddress` with hardcoded fixture addresses for index 0+1 (BIP-32 test vector 1 seed), BIP-67 xpub-order independence.
- `test/tools-register-btc-multisig-wallet.test.ts` (18 tests): valid registration + address count + HMAC-less, VERIFY-ON-DEVICE block content, various error paths (M>N, threshold mismatch, 17-byte name, demo mode, `/*` suffix), `get_btc_multisig_balance` and `get_btc_multisig_utxos` NOT_FOUND + INVALID_INPUT + Esplora-stubbed aggregation tests.

## Cryptographic-Binding Fixtures

Hardcoded P2WSH address literals in `test/btc-multisig-address-derivation.test.ts` computed from BIP-32 test vector 1 seed (`000102030405060708090a0b0c0d0e0f`) at paths `m/84'/0'/0..2'`, index 0+1:
- Index 0: `bc1q89z49nyykvr86hpyw3h34097336s095suwa2hflyvelsmnvp4xvsfw4cnj`
- Index 1: `bc1qkc9ehz2vq23757a4hzv2gt86n708eq8s6vhcq95stsv6xlw4sjmqza7crd`

## Commits

| Task | Commit | Description |
|------|--------|-------------|
| Task 1 (storage + derivation) | `abc3ce4` | feat(25-01): multisig storage config + registry store + descriptor parsing + BIP-67 P2WSH derivation |
| Tasks 2+3 (tools) | `4531f01` | feat(25-01): register_btc_multisig_wallet + MULTISIG_* error codes + get_btc_multisig_balance + get_btc_multisig_utxos + register-all wiring |

## Deviations from Plan

None — plan executed exactly as written. All must-have truths satisfied:
- User can register a `wsh(sortedmulti(M,...))` descriptor and get back the first 5 derived P2WSH addresses.
- Malformed descriptors, M>N, M<1, and non-`/**` key expressions are refused with `MULTISIG_DESCRIPTOR_INVALID`.
- Registry persists to `~/.vaultpilot-mcp/btc-multisig.json` with 0o600 permissions via tempfile+rename.
- User can read aggregate balance and raw UTXOs for a registered wallet via Esplora.
- Registration without Ledger stores the record HMAC-less; this is the default fallback (Plans 25-03 adds the device path).

## Known Stubs

None. All three tools are fully functional. `get_btc_multisig_utxos` returns `scriptpubkey: ""` (empty string) because the Esplora `/address/{addr}/utxo` endpoint does not include the scriptpubkey in its UTXO response — this is documented in the code and can be enriched via `GET /tx/{txid}` in Plan 25-03 if needed for PSBT construction. The empty field is clearly labeled and does not affect the plan's acceptance criteria.

## Threat Flags

None. All three trust boundaries in the plan's threat model are addressed:
- T-25-01 (descriptor tampering) — mitigated: `parseWshSortedMulti` validates before any persistence.
- T-25-02 (wrong address shown) — mitigated: first 5 derived addresses in VERIFY-ON-DEVICE block.
- T-25-03 (registry readable) — mitigated: `writeAtomic` with `mode: 0o600`.
- T-25-04 (Esplora malleable data) — accepted: read-only display path, no signing decision.
- T-25-05 (corrupt registry) — accepted: `loadFromDisk` drops invalid entries, never deletes.

## Self-Check: PASSED

Files created:
- `src/config/btc-multisig-storage.ts` — FOUND
- `src/wallet/btc-multisig-store.ts` — FOUND
- `src/tools/register_btc_multisig_wallet.ts` — FOUND
- `src/tools/get_btc_multisig_balance.ts` — FOUND
- `src/tools/get_btc_multisig_utxos.ts` — FOUND
- `test/btc-multisig-store.test.ts` — FOUND
- `test/btc-multisig-address-derivation.test.ts` — FOUND
- `test/tools-register-btc-multisig-wallet.test.ts` — FOUND

Commits present: abc3ce4, 4531f01 — FOUND

Full vitest suite: 2888 passed, 1 known flake (wallet-session-manager.test.ts WalletConnect load-sensitive).
