---
phase: 23-btc-native-segwit-taproot-trust-pipeline
reviewed: 2026-05-22
depth: deep
files_reviewed: 16
findings:
  critical: 3
  warning: 5
  info: 1
  total: 9
status: resolved
resolution: All 9 findings fixed — see 23-REVIEW-FIXES.md (commits edb69c7 / c525a7a / 542ab77 / b64ea27 / ec95361).
---

# Phase 23: Code Review Report

**Reviewed:** 2026-05-22 · **Depth:** deep (security-critical signing pipeline) · **Files:** 16
**Status:** issues_found at review time → **all resolved** (see `23-REVIEW-FIXES.md`).

## Summary

Phase 23 introduces the BTC native/segwit/taproot PSBT trust pipeline: coin selection (BnB + largest-first fallback), PSBT construction, BIP-143/BIP-341 sighash computation, keccak256 `payloadFingerprint`, Ledger USB-HID two-pass signing, Esplora broadcast. The cryptographic core (`btc-sighash.ts`, `btc-fingerprint.ts`, the `send_transaction.ts` three-gate region) is structurally sound — BIP-341 whole-prevout-set assembly correct, preimage properly domain-separated, FROZEN region intact.

Three blockers existed in the change-address path: D-02 ("fresh derived change-chain address") was non-functional because the Phase 22 account store persisted no xpub. Resolved by the user-approved fix (store xpub at pair time).

## Critical Issues — all RESOLVED

- **CR-01** — `send_transaction.ts`: `signBtcPsbt(…, [])` passed an empty `knownAddressDerivations`; the Ledger could not identify the change output and displayed it as an extra send recipient (trust-display violation). **Fixed** (`ec95361`): `knownAddressDerivations` populated from the stored `changeAddress`/`changePath`.
- **CR-02** — `prepare_btc_send.ts`: `nextChangeIndex()` was called with a bech32 address; `bs58check.decode` threw on every call, silently caught. **Fixed** (`ec95361`): called with the real account xpub now persisted at pair time.
- **CR-03** — `prepare_btc_send.ts`: change fell back to the receive address (address reuse) and `changePath` did not match `changeAddress`. **Fixed** (`ec95361`): change address derived chain-1 from the xpub, `changeAddress` and `changePath` correspond to the same key; refuses with a re-pair hint if no xpub is stored.

## Warnings — all RESOLVED

- **WR-01** — unconfirmed UTXOs entered coin selection (child-of-unconfirmed mempool-rejection risk). **Fixed** (`ec95361`): confirmed-only UTXO filter + refusal when none confirmed.
- **WR-02** — `{FEE_RATE}` rendered as the literal `"auto"` in the preview receipt, breaking the verbatim PREPARE RECEIPT invariant. **Fixed** (`ec95361`): `feeRate` stored on `PreparedTxBtc`, real value emitted.
- **WR-03** — `recipientScriptType()` used the change script type as a proxy → ~12-vbyte fee error. **Fixed** (`b64ea27`): `recipientScriptType` is a required `CoinSelectArgs` field, caller-supplied.
- **WR-04** — `LedgerBtcAppNotOpenError` mapped to `LEDGER_REJECTED` (misleading recovery guidance). **Fixed** (`c525a7a`): new `BTC_APP_NOT_OPEN` error code (mirrors `SOLANA_APP_NOT_OPEN`).
- **WR-05** — Esplora fee-estimate / UTXO caches had no TTL (stale data for the process lifetime). **Fixed** (`542ab77`): 60s fee-estimate / 30s UTXO TTLs.

## Info — RESOLVED

- **IN-01** — `btc-fingerprint.ts` comments claimed the `"VaultPilot-btctx-v1:"` domain tag is 21 UTF-8 bytes; it is 20. **Fixed** (`edb69c7`).

---

*Reviewer: gsd-code-reviewer · Resolutions: see `23-REVIEW-FIXES.md`*
