# Phase 23 Review Fixes

**Branch:** `feat/23-btc-trust-pipeline`
**Date:** 2026-05-22
**Status:** All findings resolved — `npx tsc --noEmit` clean; `npx vitest run` 2788 pass + 1 known pre-existing flake (`wallet-session-manager.test.ts` timing race)

---

## Commits

| Hash | Finding(s) | Description |
|------|-----------|-------------|
| `edb69c7` | IN-01 | Fix "21 UTF-8 bytes" → "20 UTF-8 bytes" in btc-fingerprint.ts comments |
| `c525a7a` | WR-04 | Add `BTC_APP_NOT_OPEN` error code; map `LedgerBtcAppNotOpenError` correctly |
| `542ab77` | WR-05 | Add 30s/60s TTLs to UTXO and fee-estimates caches in esplora-client.ts |
| `b64ea27` | WR-03 | Add `recipientScriptType` field to `CoinSelectArgs`; pass from `prepare_btc_send` |
| `ec95361` | CR-01, CR-02, CR-03, WR-01, WR-02 | xpub-based change derivation, confirmed-UTXO gate, real feeRate in receipt |

---

## Changes per Finding

### IN-01 — Comment: "21 UTF-8 bytes" should be "20" (`btc-fingerprint.ts`)

**Commit:** `edb69c7`

Fixed three comment occurrences of "21 UTF-8 bytes" → "20 UTF-8 bytes" and removed the
"same byte-count as TRON" claim (which was inaccurate). The domain tag
`"VaultPilot-btctx-v1:"` is 20 bytes, verified via `Buffer.from(tag).length`.

**Files modified:** `src/signing/btc-fingerprint.ts`

---

### WR-04 — `LedgerBtcAppNotOpenError` maps to `LEDGER_REJECTED` (`send_transaction.ts`)

**Commit:** `c525a7a`

Added `BTC_APP_NOT_OPEN` to the `ErrorCode` union type (mirror of `SOLANA_APP_NOT_OPEN`).
Changed the `LedgerBtcAppNotOpenError` catch handler in `send_transaction.ts` from
`LEDGER_REJECTED` to `BTC_APP_NOT_OPEN`. Updated `test/send-transaction.btc.test.ts`
(T-13) to expect `BTC_APP_NOT_OPEN`.

**Files modified:**
- `src/signing/error-codes.ts` — new `BTC_APP_NOT_OPEN` in `ErrorCode` union
- `src/tools/send_transaction.ts` — error-code mapping fix
- `test/send-transaction.btc.test.ts` — T-13 updated

---

### WR-05 — No TTL on fee-estimates or UTXO caches (`esplora-client.ts`)

**Commit:** `542ab77`

Added parallel timestamp maps (`addressUtxosCacheTs`, `feeEstimatesCacheTs`) alongside
existing LRU caches. Cache hits now require `Date.now() - cachedTs < TTL_MS`:
- `UTXOS_CACHE_TTL_MS = 30_000` (30 s) — UTXOs change on every confirmed block
- `FEE_ESTIMATES_CACHE_TTL_MS = 60_000` (60 s) — fee landscape changes every ~10 min
  but outlier spikes can occur at any time

`_resetEsploraCacheForTesting` extended to clear both timestamp maps.
Two new TTL tests added using `vi.useFakeTimers()` + `vi.advanceTimersByTime()`.

**Files modified:**
- `src/chains/bitcoin/esplora-client.ts`
- `test/chains-bitcoin-esplora-client.test.ts`

---

### WR-03 — `recipientScriptType()` proxies through `changeScriptType` (`btc-coin-select.ts`)

**Commit:** `b64ea27`

Removed the `recipientScriptType()` proxy function that incorrectly returned
`changeScriptType` as the recipient script type. Added a required `recipientScriptType`
field to `CoinSelectArgs`. Updated `prepare_btc_send.ts` to pass the caller-inferred
type (`bc1q` → `"p2wpkh"`, `bc1p` → `"p2tr"`). Updated all 9 `CoinSelectArgs` literals
in `test/btc-coin-select.test.ts` to include the new required field.

**Files modified:**
- `src/signing/btc-coin-select.ts` — interface + impl
- `src/tools/prepare_btc_send.ts` — pass `recipientScriptType: toScriptType`
- `test/btc-coin-select.test.ts` — 9 fixture literals updated

---

### CR-02 — `nextChangeIndex` called with bech32 address instead of xpub (`prepare_btc_send.ts`)

**Commit:** `ec95361`

**Root cause:** `change-index.ts`'s `nextChangeIndex(xpub, scriptType)` was being called
with the raw bech32 receive address. `bs58check.decode(bech32_address)` throws every time.

**Fix (locked design decision):** Store account-level xpub at pair time.

- `src/wallet/ledger-btc-transport.ts`: `fetchBtcAddresses` now calls
  `app.getWalletXpub({ path: "84'/0'/0'", xpubVersion: 0x0488B21E })` and
  `app.getWalletXpub({ path: "86'/0'/0'", xpubVersion: 0x0488B21E })` in the same
  USB-HID session. Both xpubs returned in the result (`segwit.xpub`, `taproot.xpub`).
- `src/wallet/non-evm-account-store.ts`: `xpub?: string` added to `NonEvmAccountRecord`.
  `validateRecord` carries through valid xpub strings, drops malformed ones with a warn.
- `src/tools/pair_btc_ledger.ts`: both `saveAccount` calls now include `xpub` from
  the `fetchBtcAddresses` result.
- `src/tools/prepare_btc_send.ts`: reads `fetchedKeys.segwit.xpub` / `.taproot.xpub`
  and passes the appropriate xpub to `_changeIndex.nextChangeIndex(activeXpub, scriptType)`.

**Fallback:** if xpub is absent (demo mode or legacy pre-CR-02 record), change is folded
into fee (`hasChangeOutput = false`). The user sees a no-change-output transaction and
can re-pair to restore full change support.

---

### CR-03 — Change address uses receive (chain-0) address instead of fresh chain-1 (`prepare_btc_send.ts`)

**Commit:** `ec95361`

**Root cause:** `const changeAddress = segwitAddress` (or `taprootAddress`) — always
the chain-0 receive address, not a freshly-derived chain-1 address.

**Fix:**
- `src/chains/bitcoin/xpub-scan.ts`: `deriveAddress()` exported (was previously private).
  Added `normalizeToXpub()` call inside it so callers can pass raw xpub or zpub.
- `src/tools/prepare_btc_send.ts`: added import of `deriveAddress` from `xpub-scan.js`.
  After `nextChangeIndex` returns `changeIdx`, derive the actual change address:
  `changeAddress = deriveAddress(activeXpub, changeIdx, dominantScriptType, 1)`.
  Build the 5-level BIP-44 path by splitting the address derivation path and replacing
  the last two segments (`/change/index`) with `/1/{changeIdx}`:
  `changePath = "m/" + accountBase + "/1/" + changeIdx`.

**Files modified:**
- `src/chains/bitcoin/xpub-scan.ts` — export `deriveAddress` with internal normalization
- `src/tools/prepare_btc_send.ts` — CR-03 derivation logic

---

### CR-01 — `signBtcPsbt` passes empty `knownAddressDerivations` (`send_transaction.ts`)

**Commit:** `ec95361`

**Root cause:** `_btcLedgerTransport.signBtcPsbt(psbt, signInputs, [])` — empty third
argument means the Ledger BTC app cannot identify the change output as "yours" and
displays it as a second send recipient (Pitfall 6).

**Fix:**
- `PreparedTxBtc` in `handle-store.ts` gains two new fields:
  - `changePath: string | null` — 5-level BIP-44 path of the change output
  - `changeAddress: string | null` — bech32/bech32m change address
  - (also `feeRate: number` for WR-02, see below)
- `src/tools/send_transaction.ts`:
  - Imports `address as btcAddressLib, networks as btcNetworks` from `bitcoinjs-lib`
  - Imports `type KnownAddressDerivation` from `ledger-btc-transport.js`
  - Builds `knownDerivations: KnownAddressDerivation[]` from `btcTx.changeAddress` +
    `btcTx.changePath`: converts the change address to its output script via
    `btcAddressLib.toOutputScript`, then extracts the scriptPubKey hash bytes
    (P2WPKH: bytes 2-22; P2TR: bytes 2-34) — the same logic as
    `@ledgerhq/psbtv2`'s `extractHashFromScriptPubKey`.
  - Passes `knownDerivations` to `signBtcPsbt` instead of `[]`.

**Files modified:**
- `src/signing/handle-store.ts` — additive widening of `PreparedTxBtc`
- `src/tools/send_transaction.ts` — CR-01 knownAddressDerivations population
- `src/tools/prepare_btc_send.ts` — populates `changePath` + `changeAddress` on tx

---

### WR-01 — Esplora UTXOs not filtered to confirmed-only (`prepare_btc_send.ts`)

**Commit:** `ec95361`

**Root cause:** All UTXOs (including unconfirmed, zero-conf) were passed to coin selection.
Spending unconfirmed UTXOs is double-spend-vulnerable.

**Fix:** In the Esplora UTXO fetch branch of `prepare_btc_send.ts`, added
`.filter((u) => u.confirmed)` to both segwit and taproot UTXO arrays.
Added explicit early-return when `allUtxos.length === 0` after filtering:
- If unconfirmed UTXOs exist: message says "wait for on-chain confirmation"
- Otherwise: "no UTXOs found"
Both return `BTC_NO_UTXOS_AVAILABLE` error code.

Note: the `utxoOverride` path is exempt — tests and tooling pass explicit UTXOs directly
and are responsible for their confirmation status.

**Files modified:** `src/tools/prepare_btc_send.ts`

---

### WR-02 — `{FEE_RATE}` replaced with literal `"auto"` in preview receipt (`preview_send.ts`)

**Commit:** `ec95361`

**Root cause:** `PREPARE_RECEIPT_BTC_NATIVE_TEMPLATE.replace("{FEE_RATE}", "auto")` hardcoded.

**Fix:**
- `PreparedTxBtc` gains `feeRate: number` field (additive — same commit as CR-01).
- `src/tools/prepare_btc_send.ts`: populates `feeRate` in the `PreparedTxBtc` object
  (the resolved fee rate from Esplora or the caller-supplied value).
- `src/tools/preview_send.ts`: `.replace("{FEE_RATE}", String(btcTx.feeRate))`

**Files modified:**
- `src/signing/handle-store.ts` — `feeRate: number` on `PreparedTxBtc`
- `src/tools/prepare_btc_send.ts` — populate `feeRate`
- `src/tools/preview_send.ts` — emit real value

---

## Test Updates

| Test File | Changes |
|-----------|---------|
| `test/btc-coin-select.test.ts` | Added `recipientScriptType` to 9 `CoinSelectArgs` literals |
| `test/chains-bitcoin-esplora-client.test.ts` | 2 new TTL-expiry tests (WR-05) |
| `test/send-transaction.btc.test.ts` | T-13 updated: `LEDGER_REJECTED` → `BTC_APP_NOT_OPEN` |
| `test/ledger-btc-transport.test.ts` | `MockBtcApp` interface + `makeMockApp` extended with `getWalletXpub`; LOAD-BEARING test asserts `segwit.xpub` + `taproot.xpub` returned; 2 inline stubs extended |
| `test/prepare-btc-send.test.ts` | `STUB_FETCH_BTC_ADDRESSES_RESULT` extended with `xpub` fields (BIP-32 test vector xpubs) |

---

## FROZEN Area Compliance

- `src/signing/payload-fingerprint{,-solana,-tron}.ts` — byte-identical to origin/main
- `src/signing/presign-hash*.ts` — byte-identical to origin/main
- `send_transaction.ts` three-gate region (previewToken / userDecision / payloadFingerprint-drift checks) — byte-identical; CR-01 change is below the frozen region in the BTC dispatch arm
- `handle-store.ts` state machine + TTL + `createHandle` + `transitionTo*` — byte-identical; `PreparedTxBtc` widening is strictly additive (3 new fields)

---

## Verification

```
npx tsc --noEmit  # → no output (clean)
npx vitest run    # → 2788 passed, 1 skipped, 1 known flake (wallet-session-manager timing race)
```
