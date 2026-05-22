---
phase: 26-ltc-scaffolding-lifi-btc-bridging
reviewed: 2026-05-23T00:00:00Z
depth: standard
files_reviewed: 40
findings:
  critical: 1
  warning: 6
  info: 2
  total: 9
status: issues_found
---

# Phase 26: Code Review Report

**Reviewed:** 2026-05-23
**Depth:** standard
**Files Reviewed:** 40
**Status:** issues_found

## Summary

Phase 26 introduces LTC native send scaffolding (Esplora client, Ledger transport, PSBT pipeline, BIP-137 message signing) and a BTC→EVM/SOL bridge flow via LiFi (`prepare_btc_lifi_swap`). Structurally sound; mirrors established BTC patterns. ESM spy-affordance indirection is applied consistently. Domain-tag isolation across the three fingerprint modules (`btc` / `ltc` / `btclifi`) is correct. Inv#6b (`toAddress` assertion) is implemented and tested.

**One critical defect:** the BTC-LiFi `payloadFingerprint` is computed over the UTF-8 encoding of the hex-string representation of the PSBT rather than the PSBT binary bytes — at both prepare-time and send-time recompute paths. The drift gate still detects tampering (UTF-8-of-hex is a bijection on bytes), so the security property survives mathematically, but the implementation diverges from the documented "binds the bytes the device signs" contract and produces a fingerprint that external verifiers can't recompute without knowing to UTF-8-encode the hex string first. Six warnings cover error-code union gaps, a NEVER-throws violation, an unbounded cache, silent change-forfeiture, a silent derivation fallback, and generic error mapping.

## Critical Issues

### CR-01: `toBytes(psbtHex)` encodes UTF-8 not hex — payloadFingerprint commits to phantom bytes

**Files:** `src/tools/prepare_btc_lifi_swap.ts:284`, `src/tools/send_transaction.ts:386`

`psbtHex` is a raw hex string from `Psbt.toHex()` with NO `0x` prefix (starts `"70736274ff…"`). viem's `toBytes()` checks for the prefix at runtime: without it, the string is treated as UTF-8 and each character becomes one byte. The `as \`0x${string}\`` cast at `send_transaction.ts:386` is a type-level lie — the runtime check still falls through to UTF-8. Both prepare-time and send-time use the same wrong encoding, so the drift gate passes; the broadcast path at `send_transaction.ts:2118` uses correct `Buffer.from(psbtHex, "hex")` decoding, so the device receives the real PSBT bytes.

Net effect: fingerprint binding is preserved (UTF-8(hex(bytes)) is a bijection) but the documented contract "commits to exact byte sequence the Ledger device signs" (T-26-11, T-26-14) is violated. Fixture AA encodes the phantom UTF-8 bytes, not the actual PSBT bytes.

**Fix:**
```ts
// prepare_btc_lifi_swap.ts:284 — BEFORE
const psbtBytes = toBytes(psbtHex);
// AFTER
const psbtBytes = Buffer.from(psbtHex, "hex");
```
```ts
// send_transaction.ts:386 — BEFORE
toBytes((record.tx as PreparedTxBtcLifi).psbtHex as `0x${string}`)
// AFTER
Buffer.from((record.tx as PreparedTxBtcLifi).psbtHex, "hex")
```
Recompute Fixture AA in `test/signing-fingerprint.test.ts` against the corrected encoding. The hardcoded literal `0x8b014bc1…` must change; the existing test will fail until updated and serves as the regression anchor for the fix.

## Warnings

### WR-01: Error codes in `pair_litecoin_ledger.ts` are absent from the `ErrorCode` union
**File:** `src/tools/pair_litecoin_ledger.ts:217,231,245` — `LITECOIN_APP_NOT_OPEN`, `APPROVAL_TIMEOUT`, `USER_REJECTED` are not in `src/signing/error-codes.ts`. `structuredContent` is typed as `Record<string, unknown>`, so the gap compiles silently. Agent consumers branching on `errorCode` fall through to unknown-code handling. Add the three codes to the union (preferred) or rename to existing equivalents (`BTC_APP_NOT_OPEN`, `USER_CANCELLED`, `LEDGER_REJECTED`).

### WR-02: `decodeLifiPsbt` throws instead of returning a discriminated union — violates NEVER-throws convention
**File:** `src/protocols/bridge-decoders/lifi-btc.ts:68-70` — All other parsers in this codebase use the `{ kind: "ok" | "error" }` shape. The current caller wraps in `try/catch`; a future caller following project convention would silently swallow exceptions. Return `{ kind: "ok"; summary } | { kind: "error"; message }` and branch the caller.

### WR-03: `addressInfoCache` in LTC Esplora client has no TTL — stale confirmed-balance served indefinitely
**File:** `src/chains/litecoin/esplora-client.ts:101` — `addressInfoCache` is a plain `Map`; `addressUtxosCache` (30s TTL) and `feeEstimatesCache` (60s TTL) have companion `*CacheTs` maps. Address-info data is the user-visible balance surface. A confirmed deposit after pairing will not appear until process restart or LRU eviction. Apply the same 30s TTL pattern.

### WR-04: Change always folded into miner fee without surfacing the forfeited amount
**File:** `src/tools/prepare_litecoin_native_send.ts:488-490` — `changeAddress = null` unconditionally; `changeSats > 0n` silently inflates the miner fee. A 1 LTC UTXO sending 0.001 LTC forfeits ~0.999 LTC. PREPARE RECEIPT does not disclose the forfeit. Surface the forfeited amount in the receipt block (`CHANGE FORFEITED: {changeSats} litoshi (xpub change-address support deferred)`) and add a refusal threshold (~10,000 litoshi) with `INVALID_INPUT`.

### WR-05: Silent fallback to default derivation path when segwit account is absent
**File:** `src/tools/prepare_litecoin_native_send.ts:315-318` — `segwitAccount?.derivationPath` passes `undefined` to `fetchLtcAddresses` if the store is missing the segwit record; the transport falls through to a default path, the PSBT carries wrong derivation metadata, and the Ledger rejects at sign time with a confusing error rather than a clear prepare-time refusal. Add a `WALLET_NOT_PAIRED` refusal at prepare time.

### WR-06: `LedgerLtcAppNotOpenError` / `LedgerDeviceNotConnectedError` mapped to generic `INTERNAL_ERROR`
**File:** `src/tools/sign_message_ltc.ts:398-429` — Agents can't distinguish "device disconnected" from a coding bug, and can't surface a useful recovery hint. After WR-01's codes are added, map the two error classes to `LITECOIN_APP_NOT_OPEN` / `LEDGER_NOT_CONNECTED` (mirrors Solana tool).

## Info

### IN-01: Import path in `lifi-btc.ts` is semantically fragile
**File:** `src/protocols/bridge-decoders/lifi-btc.ts:27` — `"../../../src/chains/bitcoin/types.js"` traverses out of `src/` and back in. Correct relative path is `"../../chains/bitcoin/types.js"`. Resolves today; breaks if `src/` is renamed or the file moves.

### IN-02: Dead named import `computeBtcLifiPayloadFingerprint`
**File:** `src/tools/prepare_btc_lifi_swap.ts:39` — Imported but never called directly; all calls go through the `_btcLifiFingerprint` indirection object. Will produce an unused-import lint warning. Remove from the import list.

---

*Reviewer: Claude (gsd-code-reviewer) · Depth: standard*
