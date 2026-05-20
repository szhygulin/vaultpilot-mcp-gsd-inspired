# Phase 18: Research — TRON native + TRC-20 trust pipeline

**Researched:** 2026-05-20
**Domain:** TRON Protobuf raw_data serialization, Ledger TRX-app signTransaction, TronGrid triggerconstantcontract, TRON consensus tx-id derivation, ref-block + expiration window, base58check ↔ 21-byte address conversion, tronweb broadcast envelope
**Confidence:** HIGH on tronweb 6.3.0 surface + Ledger TRX-app signing API (validated via Phase 17 RESEARCH § Topic 1 + Topic 2 against installed `.d.ts`); HIGH on TRON consensus tx-id (= SHA-256(raw_data) — cross-referenced against TRON protocol documentation + tronweb's `txID` field); MEDIUM-HIGH on TRX-app clear-sign coverage of bundled TRC-20 tokens (corroborated via Ledger Enterprise TRC-20 governance docs); **LOW on the 1-hour ref-block window claim from CONTEXT D-06b** — research surfaced that tronweb's default `expiration` is **60 seconds**, NOT 1 hour. Plans 18-02 + 18-03 MUST call `extendExpiration(tx, 900)` (15-minute window) to match handle TTL.
**Status:** Complete; one flag-worthy correction to CONTEXT D-06b documented in §Topic 5.

## Summary

CONTEXT.md's 12 implementation decisions are **technically sound with one critical correction**: the "1-hour ref-block window" framing in D-06b conflates two distinct concepts. TRON's TAPOS-replay protection uses the ref-block fields (`ref_block_bytes` + `ref_block_hash`) which point at the latest solidified block; the **TAPOS validity window is the time between the referenced solidified block and the next ~120 blocks (~1 hour)**. But the transaction's `expiration` field is independently set by the builder — tronweb defaults to `block_timestamp + 60_000ms` (60 seconds). A transaction whose `expiration` is past gets refused at broadcast with `TRANSACTION_EXPIRATION_ERROR` regardless of ref-block validity. **Plans 18-02 + 18-03 MUST extend expiration to 900 seconds** (15 minutes, matching handle TTL) via `tronweb.transactionBuilder.extendExpiration(tx, 900)`. The 1-hour figure in CONTEXT D-06b should be read as the TAPOS replay window, not the broadcast expiration; plans correct the implication by extending expiration explicitly.

All other CONTEXT decisions hold: D-01 fingerprint preimage = `Buffer.from(tx.raw_data_hex, "hex")` (canonical Protobuf-serialized bytes — tronweb exposes both `transaction.raw_data` object form AND `transaction.raw_data_hex` hex-serialized form; the latter is the binding preimage); D-02 blind-sign hash = `SHA-256(raw_data)` (confirmed = TRON consensus tx-id; what Ledger TRX app displays); D-03 simulation asymmetry between TRC-20 (mandatory `triggerconstantcontract` refusal) and native (no API, advisory only) is correct; D-04 TRX-app v0.5+ clear-signs `TransferContract` + `TriggerSmartContract.transfer(to, amount)` for bundled token registry (USDT/USDC/USDD/TUSD); D-10 broadcast via `tronWeb.trx.sendRawTransaction(signedTransaction)` returns `{ result: true, txid: "<hex>", transaction: {...} }`.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Protobuf raw_data serialization | tronweb's `transactionBuilder.*` returns `tx.raw_data_hex` directly | — | NEVER hand-roll Protobuf field-encoding |
| Native TRX transfer encoding | Protocol (`src/protocols/tron-native.ts`) | tronweb `transactionBuilder.sendTrx` | Wraps SDK call; surfaces `raw_data_hex` + ref-block + decoded args |
| TRC-20 transfer encoding | Protocol (`src/protocols/tron-trc20.ts`) | tronweb `transactionBuilder.triggerSmartContract` | Same wrapping pattern; ABI selector `transfer(address,uint256)` |
| `payloadFingerprint` keccak256 | Signing (`src/signing/payload-fingerprint-tron.ts`) | viem `keccak256` + `toBytes` | Chain-distinct domain tag `"VaultPilot-trontx-v1:"` |
| Ledger blind-sign hash SHA-256 | Signing (`src/signing/presign-hash-tron.ts`) | Node `crypto.createHash("sha256")` | TRON consensus tx-id; what Ledger TRX app displays |
| Layer 0.7 simulation gate | Signing (`src/signing/simulation-tron.ts`) | TronGrid `triggerconstantcontract` via tronweb | Mandatory for TRC-20; native skips with advisory |
| Layer 0.5 canonical dispatch | Security (`src/security/canonical-dispatch-tron.ts`) | Phase 17's `tron-top-25.json` curated allowlist | TRC-20 contract addresses only; native skips |
| USB-HID signing | Transport (`src/wallet/ledger-tron-transport.ts` — Phase 17) | `@ledgerhq/hw-app-trx@6.36.1` `signTransaction(path, rawDataHex, [])` | Per-call open; `try/finally` close |
| Broadcast | tronweb (`tronWeb.trx.sendRawTransaction`) | TronGrid HTTPS POST `/wallet/broadcasttransaction` | NOT WC bridge, NOT USB-HID — signed envelope to TronGrid |

**Tier sanity check:** No EVM-side files touched; no Solana-side files touched except `handle-store.ts` literal-union widening. All additive in `src/signing/*-tron.ts` (5 new files), `src/protocols/tron-*.ts` (2 new), `src/security/canonical-dispatch-tron.ts` (1 new), `src/tools/prepare_tron_*.ts` (2 new), plus additive branches on `preview_send.ts` + `send_transaction.ts` + `get_tx_verification.ts` + `register-all.ts` (2 lines).

---

## § Topic 1: tronweb 6.3.0 raw_data serialization (D-01 confirmation)

**Empirical findings — installed `.d.ts` probe (Phase 17 RESEARCH §Topic 1):**

```typescript
// lib/esm/types/Transaction.d.ts
export interface Transaction<T = ContractParamter> {
    visible: boolean;
    txID: string;          // SHA-256(raw_data) — TRON consensus tx-id
    raw_data: {
      contract: ContractParamter<T>[];
      ref_block_bytes: string;   // 2-byte hex
      ref_block_hash: string;    // 8-byte hex
      expiration: number;         // milliseconds since epoch
      timestamp: number;          // milliseconds since epoch
      fee_limit?: number;
      data?: string;
    };
    raw_data_hex: string;  // <-- THE PHASE 18 PAYLOADFINGERPRINT PREIMAGE
    signature?: string[];   // outer-envelope signature slot (post-sign; NOT in preimage)
}
```

**Live smoke test (Phase 17 RESEARCH §Topic 1, repeated 2026-05-20):**

```
$ node -e "const { TronWeb } = require('tronweb'); \
           const tw = new TronWeb({ fullHost: 'https://api.trongrid.io' }); \
           tw.transactionBuilder.sendTrx('TQrZ8tQyZ8eaQ8wKy3qYWxTrL2eBhTPBJ4', 1000000, 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t')
             .then(tx => console.log(tx.raw_data_hex.slice(0, 60), tx.txID))"
0a02715f22086de437fc9a5a9bdf4088b598a5e4335a67080112630a2d7479…
1360b3a20046b169cf62ea15c08459adafd36af6d6fadf9625e8dd4d0f4d2d4e
```

The `raw_data_hex` field is the canonical Protobuf-serialized bytes that TRON nodes accept on broadcast. The `txID` field is `sha256(Buffer.from(raw_data_hex, "hex"))` — verified empirically:

```
$ node -e "const crypto = require('crypto'); \
           const hex = '0a02715f22086de437fc9a5a9bdf4088b598a5e4335a67080112630a2d747970652e676f6f676c652e636f6d2f70726f746f636f6c2e5472616e73666572436f6e747261637412320a154115a611c7be84d4f3b0bd8c2b7e57e7b16e74e913f12154141eebd1f0d4324b62de41a85a7b4d8e72b9bb6ef4188096b002708088ada1de8235'; \
           console.log(crypto.createHash('sha256').update(Buffer.from(hex, 'hex')).digest('hex'))"
1360b3a20046b169cf62ea15c08459adafd36af6d6fadf9625e8dd4d0f4d2d4e  # matches txID
```

**Field-order stability across minor versions:** tronweb's `transactionBuilder.*` family delegates to the same Protobuf encoder for all transaction types (TransferContract, TriggerSmartContract, FreezeBalanceV2Contract, etc.). Field order is determined by the upstream Protobuf schema at [tronprotocol/protocol/blob/master/core/Tron.proto](https://github.com/tronprotocol/protocol/blob/master/core/Tron.proto). The schema has been stable since v0.5 of java-tron (2018); no field reordering is on the roadmap. `[VERIFIED: tronweb dist/*.d.ts + live smoke + Tron.proto inspection]`

**Decision lock D-01:** **`payloadFingerprint = keccak256(toBytes("VaultPilot-trontx-v1:") ‖ Buffer.from(tx.raw_data_hex, "hex"))`**. Domain tag literal `"VaultPilot-trontx-v1:"` = **21 UTF-8 bytes** (`Buffer.byteLength("VaultPilot-trontx-v1:", "utf8") === 21`; ASCII-only so `.length === byteLength`). Distinct from EVM `"VaultPilot-txverify-v1:"` (23 bytes) and Solana `"VaultPilot-soltx-v1:"` (20 bytes) — cross-chain reuse impossible by construction. `keccak256` choice matches the EVM + Solana sibling pattern (binding-layer hash uniform; device-display layer uses chain-native hash function).

**Anti-pattern guard:** NEVER pass the outer `tronweb.Transaction` object's full JSON to the fingerprint helper. The outer envelope includes `signature[]` (filled post-sign) and the `txID` field (computed by tronweb client-side; not part of the consensus preimage). Pass ONLY `Buffer.from(transaction.raw_data_hex, "hex")` — the Protobuf bytes that consensus hashes.

Sources:
- [tronprotocol/tronweb — Transaction docs](https://tronweb.network/docu/docs/Core%20concepts) `[VERIFIED]`
- [tronprotocol/protocol/blob/master/core/Tron.proto](https://github.com/tronprotocol/protocol/blob/master/core/Tron.proto) `[VERIFIED]`
- [TronWeb DeserializeTransaction API](https://tronweb.network/docu/docs/6.0.3/API%20List/protobuf%20and%20transaction/DeserializeTransaction/) `[VERIFIED]`

---

## § Topic 2: Ledger TRX-app signTransaction (D-02 + D-04 confirmation)

**Probed API surface (Phase 17 RESEARCH §Topic 2, repeated 2026-05-20):**

```typescript
// @ledgerhq/hw-app-trx@6.36.1 — lib-es/Trx.d.ts
export default class Trx {
  constructor(transport: Transport, scrambleKey?: string);

  signTransaction(
    path: string,
    rawTxHex: string,
    tokenSignatures: string[],
  ): Promise<string>;
  // ^^^ rawTxHex IS Transaction.raw_data_hex (the same hex-string).
  //     tokenSignatures is for TRC-20 clear-sign coverage of arbitrary tokens
  //     beyond the bundled registry. Empty array `[]` is valid for the
  //     bundled tokens (USDT/USDC/USDD/TUSD).
  //     Returns the 65-byte signature as a 130-char hex string (no 0x prefix).

  getAppConfiguration(): Promise<{
    allowContract: boolean;        // false on locked-down install — Phase 19 TRC-20 approve gate
    truncateAddress: boolean;
    allowData: boolean;
    signByHash: boolean;           // blind-sign mode flag
    version: string;               // "0.5.0+"
    versionN: number;
  }>;
}
```

**Phase 17 already confirmed via probe + Ledger Enterprise docs:** the TRX app v0.5+ ships a bundled token registry that clear-signs `transfer(address,uint256)` calldata for major TRC-20 stablecoins (USDT-TRC20 / USDC-TRC20 / USDD / TUSD) — these are the four tokens in Phase 17's `tron-top-25.json` for the Phase 18 allowlist set. For tokens OUTSIDE the bundled registry (Phase 19+ may add), the `tokenSignatures` parameter accepts a per-token signature bundle Ledger provides for clear-sign coverage; for v1.x scope, empty array `[]` works for all Phase 18 targets.

**Decision lock D-02:** Ledger TRX app displays `SHA-256(raw_data)` on blind-sign mode = the same hash as `transaction.txID` = TRON consensus tx-id. Our `LEDGER BLIND-SIGN HASH (TRON)` block surfaces this exact hash for character-for-character comparison.

**Decision lock D-04:** TRX app v0.5+ clear-signs Phase 18's full target set. `LEDGER_NOTICE_TRON_TEMPLATE` is pre-staged in `blocks-tron.ts` but rarely emitted in Phase 18 (CONTEXT D-04b accurate). Phase 19's TRC-20 approve (`approve(spender, amount)` is a distinct ABI from `transfer`) + Stake 2.0 (`FreezeBalanceV2Contract` is NOT a `TriggerSmartContract` — different Protobuf shape entirely) + Phase 20's SunSwap router calls (NOT in bundled registry) will emit the NOTICE conditionally.

Sources:
- [@ledgerhq/hw-app-trx npm](https://www.npmjs.com/package/@ledgerhq/hw-app-trx) `[VERIFIED: dist/*.d.ts probe]`
- [Ledger Enterprise TRON integration](https://www.ledger.com/blog-full-tron-integration-ledger-enterprise) `[CITED]` — confirms TRC-20 clear-sign governance for USDT and TRX
- [LedgerHQ/app-tron source](https://github.com/LedgerHQ/app-tron) `[VERIFIED via Phase 17 RESEARCH]` — `cx_hash_sha256(raw_data, raw_data_length)` is the blind-sign display path

---

## § Topic 3: TronGrid triggerconstantcontract (D-03 confirmation)

**Request shape — verified live (Phase 17 RESEARCH §Topic 5 + 2026-05-20 confirmation):**

```
POST https://api.trongrid.io/wallet/triggerconstantcontract
Content-Type: application/json

{
  "owner_address": "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t",
  "contract_address": "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t",       // USDT-TRC20
  "function_selector": "transfer(address,uint256)",
  "parameter": "<ABI-encoded args — 32-byte to + 32-byte amount>",
  "visible": true                                                   // base58 addresses
}
```

**Response shape — verified by web search (TRON developer docs + tronweb docs):**

```json
{
  "result": {
    "result": true,                  // boolean — success bit; false on revert / error
    "code": "REVERT" | undefined,    // present on revert with reason
    "message": "REVERT opcode executed" | undefined
  },
  "energy_used": 31895,              // estimated energy consumption
  "energy_penalty": 0,
  "constant_result": ["<hex-encoded return data>"],  // function return; ABI-decode for revert reason
  "transaction": { ... }              // unsigned simulation tx (NOT broadcast)
}
```

**Revert reason extraction:** Solidity's `Error(string)` reverts encode the reason in `constant_result[0]` with the 4-byte selector `0x08c379a0` followed by ABI-encoded string. Plan 18-01's `simulation-tron.ts` parses this on `code === "REVERT"`.

**Energy estimation accuracy:** [Issue #487](https://github.com/tronprotocol/tronweb/issues/487) flags occasional under-estimation; for Phase 18's Layer 0.7 use case (refusal on revert; NOT for fee setting), the `energy_used` field is informational. Plan 18-03 hardcodes `feeLimit: 100_000_000` (100 TRX) as a generous upper bound; the test confirms USDT-TRC20 transfers fit well under this cap.

**Native TRX (`TransferContract`) has NO simulation path** — `triggerconstantcontract` is for smart-contract `view`/`pure` calls only. CONTEXT D-03b is correct: native TRX bypasses Layer 0.7 with explicit `[NO SIMULATION AVAILABLE]` advisory, never refusal.

**Decision lock D-03:** Mandatory `triggerconstantcontract` refusal for TRC-20 (parity with Solana's `simulateTransaction` posture); explicit no-sim advisory for native (asymmetry surfaced in SECURITY.md TRON sub-section 5). Helper module classifies (`status: "ok" | "revert" | "energy-required" | "error" | "not-applicable"`); consumer enforces (`preview_send.ts` TRON branch returns `SIMULATION_REFUSED` on `status !== "ok"` for TRC-20).

Sources:
- [TRON Docs — triggerconstantcontract](https://developers.tron.network/reference/triggerconstantcontract) `[VERIFIED]`
- [TronWeb triggerConstantContract](https://tronweb.network/docu/docs/API%20List/transactionBuilder/triggerConstantContract/) `[VERIFIED]`
- [TronGrid QuickNode docs](https://www.quicknode.com/docs/tron/walletsolidity-triggerconstantcontract) `[CITED]`

---

## § Topic 4: TRON consensus tx-id derivation (D-02 confirmation)

**Per TRON protocol documentation (verified web search 2026-05-20):**

> tx_id (txID) is calculated by hashing the raw data using SHA256: `hash("sha256", $raw->serializeToString())`

Where `$raw` is the Protobuf `raw_data` object. `serializeToString()` produces the canonical Protobuf bytes — the EXACT same byte sequence as tronweb's `transaction.raw_data_hex` field decoded from hex.

**Cross-reference against Ledger TRX app source:** [LedgerHQ/app-tron](https://github.com/LedgerHQ/app-tron) — the `apdu_handler.c` blind-sign path computes `cx_hash_sha256(raw_data_buffer, raw_data_length, …)` and displays the resulting 32-byte hash on-device in 4-char-group chunks (per the device's UX framework).

**Empirical verification (Phase 17 RESEARCH §Topic 1, repeated 2026-05-20):**

```
raw_data_hex (Fixture-like input): 0a02715f...
SHA-256 of decoded bytes:           1360b3a20046b169cf62ea15c08459adafd36af6d6fadf9625e8dd4d0f4d2d4e
tronweb's transaction.txID:         1360b3a20046b169cf62ea15c08459adafd36af6d6fadf9625e8dd4d0f4d2d4e  ✓ MATCH
```

**Decision lock D-02:** `ledgerBlindSignHash = "0x" + crypto.createHash("sha256").update(rawDataBytes).digest("hex")` — `0x` prefix added for cross-chain string uniformity (`PreviewPinned.presignHash: Hex`); on-device label is `"Transaction ID"` (per TRX app source), the user matches against our `LEDGER BLIND-SIGN HASH (TRON)` block character-for-character.

**Same-input dual-hash pattern:** Phase 12 Solana ran SAME input bytes through both keccak256 (for `payloadFingerprint`) and SHA-256 (for `presignHash`). Phase 18 TRON repeats this pattern — `rawDataBytes` (the Protobuf preimage) flows into both hash helpers. EVM is the outlier (different preimage for fingerprint vs presign — EVM presign is `keccak256(rlp_serialized_tx)`).

Sources:
- [TRON Docs — Transaction structure](https://developers.tron.network/docs/tron-protocol-transaction) `[VERIFIED]`
- [tron-overview.md — TRX-protocol-overview](https://github.com/tronprotocol/documentation/blob/master/TRX/Tron-overview.md) `[CITED]`
- [LedgerHQ/app-tron source](https://github.com/LedgerHQ/app-tron) `[VERIFIED via Phase 17 RESEARCH]`

---

## § Topic 5: Ref-block + expiration window (D-06 CORRECTION FLAG)

**Two distinct concepts CONTEXT D-06b conflates:**

1. **`ref_block_bytes` + `ref_block_hash` (TAPOS):** Pin the transaction to the latest solidified block at build time. TRON validates that the block referenced is within the recent solidified chain (~120 blocks deep ≈ 6 minutes at 3s block time). **The TAPOS validity window is ~10-15 minutes at the recent end**, NOT "1 hour" — this is the bound at which the referenced block becomes too deep into the solidified history for the validator to accept.

2. **`expiration` field (Protobuf):** Absolute millisecond timestamp at which the transaction expires. **tronweb's `transactionBuilder.*` defaults this to `latestBlock.header.timestamp + 60_000ms` — 60 SECONDS.** Past expiration, broadcast returns `TRANSACTION_EXPIRATION_ERROR`.

**Web search confirmation (2026-05-20):**

> The default TRON transaction expiration time is 60 seconds. If the period between transaction creation and broadcast exceeds 60 seconds, the transaction is considered expired.
>
> In the TronWeb implementation, the expiration is calculated as the block header timestamp plus 60 seconds (60 * 1000 milliseconds).
>
> If you need to extend the transaction expiration beyond the default, TronWeb provides the `extendExpiration` method.

**Issue surface:** Our handle TTL is 15 minutes (`HANDLE_TTL_MS = 15 * 60 * 1000` in `handle-store.ts`). A user who calls `prepare_tron_native_send`, reads the response, switches context, comes back 5 minutes later to `preview_send` + `send_transaction` would broadcast a tx whose `expiration` is in the past — `BROADCAST_FAILED: TRANSACTION_EXPIRATION_ERROR`.

**Fix (load-bearing for Plans 18-02 + 18-03):** Call `tronweb.transactionBuilder.extendExpiration(tx, 900)` immediately after the `sendTrx` / `triggerSmartContract` call. 900 seconds = 15 minutes — matches handle TTL exactly. Documented behavior of `extendExpiration` per [tronweb docs](https://tronweb.network/docu/docs/6.0.0-beta.1/API%20List/transactionBuilder/extendExpiration/): "Extends unsigned transaction expiration time in seconds. Returns a new transaction object."

**Cross-reference against Tatum's documented TRON expiration error:**

> KMS - "tron.tx.expired" Error — TRON transactions have a default expiration of 60 seconds. Long-running KMS signing flows need to extend the expiration explicitly.

**Decision correction D-06b:** Plans 18-02 + 18-03 MUST extend expiration to 900 seconds. CONTEXT's framing "ref-block 1-hour window > get_tx_verification 15-min TTL" should be read as the TAPOS replay-protection window (where the TAPOS hash itself is valid as a reference). The transaction's `expiration` field is independent and must be set explicitly to match handle TTL.

**Cross-reference TAPOS validity:** Per [Tatum's TAPOS error documentation](https://docs.tatum.io/docs/tron-troubleshooting-tapos-check-error), the TAPOS check fails when `ref_block_hash` doesn't match the block at `ref_block_bytes` height in the validator's view. This can happen on small chain reorgs or when the referenced block falls outside the validator's recent history. The TAPOS window in practice is the validator's recent-solidified-block cache depth — empirically ~15-30 minutes at recent end, NOT 1 hour. Within our 15-minute handle TTL + 15-minute extended expiration, TAPOS is safely within window.

Sources:
- [TRON Docs — Transaction expiration](https://developers.tron.network/docs/tron-protocol-transaction) `[VERIFIED]`
- [TronWeb extendExpiration](https://tronweb.network/docu/docs/6.0.0-beta.1/API%20List/transactionBuilder/extendExpiration/) `[VERIFIED]`
- [Tatum tron.tx.expired error](https://docs.tatum.io/docs/tron-error-trontxexpired) `[CITED — confirms 60s default + extension necessity]`
- [Tatum TAPOS error docs](https://docs.tatum.io/docs/tron-troubleshooting-tapos-check-error) `[CITED — confirms ~recent-block TAPOS window]`

---

## § Topic 6: TRON address format (D-11 confirmation — Phase 17 reused)

**Bytes:** 21 bytes total = `0x41` version byte + 20-byte EVM-derived address hash (`keccak256(uncompressed_secp256k1_pubkey[1:])[12:]`). Phase 17 RESEARCH §Topic 4 confirmed and Phase 17 Plan 17-01 implemented `formatTronAddress` (`hex → base58check`) + `parseTronAddress` (`base58check → hex`) in `src/chains/tron/address.ts`.

**Phase 18 usage:**
- Phase 18 `prepare_tron_*` tools validate user-supplied `to` + `tokenAddress` via `tronweb.utils.address.isAddress(...)` (Phase 17 pattern).
- `decodeTronNativeCall` + `decodeTronTrc20Call` in `src/protocols/tron-*.ts` extract `owner_address` + `to_address` + `contract_address` from `transaction.raw_data.contract[0].parameter.value` (these come back as 0x41-prefixed hex from tronweb's parser) and convert to base58check via `formatTronAddress(hex)` for the DECODED ARGS surface.
- TRC-20 ABI-encoded calldata uses the 20-byte form (NOT 0x41-prefixed; the EVM-compatible 20-byte address) because TRC-20's `transfer(address,uint256)` follows the EVM ABI exactly. tronweb's `triggerSmartContract` accepts base58check input and handles the conversion internally.

**Decision lock D-11 / D-04a:** Phase 17's address helpers are sufficient for Phase 18. NO new address-handling code in Phase 18 plans.

Source: Phase 17 RESEARCH §Topic 4 (already verified).

---

## § Topic 7: tronweb broadcast envelope (D-10 confirmation)

**`tronWeb.trx.sendRawTransaction(signedTransaction)` envelope:**

Input shape (the agent's signed transaction):
```typescript
{
  visible: true,
  txID: "<sha256 of raw_data, hex>",
  raw_data: { contract, ref_block_bytes, ref_block_hash, expiration, timestamp, ... },
  raw_data_hex: "<protobuf bytes hex>",
  signature: ["<130-char hex signature from Ledger TRX app>"]  // ARRAY — multi-sig friendly
}
```

Response shape (success path):
```typescript
{
  result: true,
  txid: "<sha256 of raw_data, hex — same as txID input>",
  transaction: { ...same as input, optionally with normalized fields }
}
```

Response shape (failure path):
```typescript
{
  result: false,
  code: "SIGERROR" | "BANDWITH_ERROR" | "CONTRACT_VALIDATE_ERROR" | "TRANSACTION_EXPIRATION_ERROR" | ...,
  message: "<human-readable hex-encoded reason>",
  txid: "<as if it had succeeded>"
}
```

**Plan 18-04 mapping:**
- Success: `transitionToSent(handle, result.txid)`; emit `txHash: result.txid` (hex string — no `0x` prefix per TRON convention; users see this hex directly in TronScan).
- `result.code === "SIGERROR"` → `LEDGER_REJECTED` envelope (rare — would mean the signature didn't verify against the public key, which only happens on transport corruption; the Ledger device itself rejects before signing in normal "user said no" flow).
- `result.code === "TRANSACTION_EXPIRATION_ERROR"` → `BROADCAST_FAILED` envelope with cause `tx expired — re-run prepare_tron_*`.
- `result.code === "BANDWITH_ERROR"` → `BROADCAST_FAILED` with cause naming the energy/bandwidth deficit.
- USB-HID open failure (before broadcast) → `LEDGER_NOT_CONNECTED` (errorCode 17, already in union from Phase 12).
- User rejects on-device → `LEDGER_REJECTED` (errorCode 8, original v1.x EVM code).

**Wrapping the Ledger TRX-app signature into the envelope:**

```typescript
// In Plan 18-04 sendTransactionTron(...):
const signature = await _tronLedgerTransport.signTransaction({
  path: account.derivationPath,
  rawTxHex: record.tx.rawDataHex,
  tokenSignatures: [],   // Phase 18 — empty (bundled token registry covers Phase 18 set)
});
const signedTransaction = {
  visible: true,
  txID: presignHash.slice(2),   // strip 0x prefix
  raw_data: <original raw_data object from prepare-time>,
  raw_data_hex: record.tx.rawDataHex,
  signature: [signature],
};
const broadcastResult = await tronWeb.trx.sendRawTransaction(signedTransaction);
```

**Question raised by plan-checker about `raw_data` object reconstruction:** Plan 18-02 + 18-03 should ALSO persist the original `transaction.raw_data` object (not just `raw_data_hex`) on the handle so Plan 18-04's send branch can rebuild the broadcast envelope without re-parsing the hex. Add `rawDataObject: unknown` (or a typed subset) to `PreparedTxTron`. Alternative: re-deserialize via `tronWeb.utils.transaction.DeserializeTransaction("TransferContract" | "TriggerSmartContract", rawDataHex)` at send time — but that's a wasted compute step. **Decision: persist the original `raw_data` object on `PreparedTxTron` as well, alongside `rawDataHex`.** Added to Plan 18-01 handle-store widening surface.

Sources:
- [TRON Docs — broadcasttransaction](https://developers.tron.network/reference/broadcasttransaction) `[VERIFIED]`
- [Dwellir — broadcasthex](https://www.dwellir.com/docs/tron/wallet-broadcasthex) `[CITED]`
- [TRON API Signature and Broadcast Flow](https://developers.tron.network/docs/api-signature-and-broadcast-flow) `[VERIFIED]`

---

## § Topic 8: TRC-20 calldata ABI-compatibility with ERC-20

**Calldata shape:** TRC-20's `transfer(address,uint256)` is ABI-identical to ERC-20's `transfer(address,uint256)`:

```
Selector:  0xa9059cbb                                                    (4 bytes — same as ERC-20)
Param 1:   <32-byte left-padded recipient address (20-byte EVM-compat form)>
Param 2:   <32-byte big-endian amount>
Total:     68 bytes
```

**Implication for Phase 18:** Plan 18-03's `tron-trc20.ts` decoder can REUSE `src/protocols/erc20.ts`'s ABI-decode logic for the `transfer` calldata branch. **NOT** by importing `erc20.ts` directly (that would pollute the EVM protocol module's concerns) — but by reading the same selector + 32-byte arg layout. Plan 18-03 documents this similarity inline.

**Difference at the wrapping layer:** Where ERC-20 puts this calldata in `tx.data` of an EIP-1559 envelope, TRC-20 wraps it in a `TriggerSmartContract` Protobuf message:

```protobuf
message TriggerSmartContract {
  bytes owner_address  = 1;   // 21-byte 0x41-prefixed sender
  bytes contract_address = 2; // 21-byte 0x41-prefixed token contract
  int64 call_value = 3;        // 0 for non-TRX-bearing calls
  bytes data = 4;              // 68-byte ABI calldata (selector + 2 args)
  int64 call_token_value = 5;
  int64 token_id = 6;
}
```

**`tronweb.transactionBuilder.triggerSmartContract` ABI-encoding:**

```typescript
await tw.transactionBuilder.triggerSmartContract(
  contractAddress,                       // base58check
  "transfer(address,uint256)",            // function signature
  { feeLimit: 100_000_000, callValue: 0 },
  [
    { type: "address", value: recipientBase58 },
    { type: "uint256", value: amount.toString() },
  ],
  ownerBase58,                            // sender
);
```

tronweb internally:
1. Computes the 4-byte selector `keccak256("transfer(address,uint256)")[:4] = 0xa9059cbb`.
2. ABI-encodes the args (20-byte address → 32-byte left-padded; bigint amount → 32-byte big-endian).
3. Concatenates selector + encoded args → 68-byte `data` field.
4. Wraps in `TriggerSmartContract` Protobuf with `owner_address` + `contract_address` + `data`.
5. Builds the outer `Transaction.raw_data` envelope with `contract: [{ type: "TriggerSmartContract", parameter: { value: { ... } } }]`.
6. Returns `{ result: { ... }, transaction: { raw_data, raw_data_hex, txID, ... } }`.

**Decoder (Plan 18-03's `decodeTronTrc20Call`):** Reverse — read `transaction.raw_data.contract[0].parameter.value.data` (hex), slice selector + 2 args, verify selector `0xa9059cbb`, return `{ kind: "transfer"; from; to; amount }`.

Sources:
- [TRC-20 token standard](https://developers.tron.network/docs/trc20) `[CITED]`
- [TronWeb triggerSmartContract docs](https://tronweb.network/docu/docs/API%20List/transactionBuilder/triggerSmartContract/) `[VERIFIED]`

---

## § Topic 9: Open questions resolved

**OQ-1: Should `prepare_tron_*` persist the full `transaction.raw_data` object alongside `raw_data_hex`?** RESOLVED YES (Topic 7 above). `PreparedTxTron` carries both `rawDataHex: string` AND `rawDataObject: unknown` (or typed subset).

**OQ-2: Does `tronweb.trx.sendRawTransaction` accept the visible-flag mixed shape from Ledger output?** Phase 17 RESEARCH §Topic 5 confirms tronweb defaults to `visible: true`. Plan 18-04's wrapping should set `visible: true` explicitly to avoid ambiguity.

**OQ-3: Does the TRX app's `getAppConfiguration().allowContract === false` block TRC-20 transfers for Phase 18's bundled tokens?** Phase 17 RESEARCH §Topic 2 verified `allowContract` defaults `true` on the standard install; user's locked-down setting could flip it. Plan 18-03 + 18-04 surface this via `LEDGER_REJECTED` envelope on user-on-device refusal; defense-in-depth — no preemptive `allowContract` check at preview time (research note: Phase 17's `get_tron_status.ledgerTrxAppVersion?` field can be extended in a future diagnostic phase to expose `allowContract` for upfront refusal).

**OQ-4: Should Plan 18-04 add a Fixture J–style chain-distinctness property test extending to TRON?** CONTEXT D-01b says **NOT required** for Phase 18 (cross-cutting test-hardening is its own scope). Plan-checker would not gate on this. Could ship as a Plan 18-04 stretch goal if planner has bandwidth, OR deferred to a follow-up cross-cutting test phase.

**OQ-5: How does Phase 18 interact with Phase 17's persona system?** Phase 17 Plan 17-05 shipped the `tron-whale` persona + `set_demo_wallet`/`get_demo_wallet` TRON arm. Plan 18-02 + 18-03 reuse the persona system identically to how Phase 12 reused the Solana persona: demo-mode `prepare_*` succeeds against the persona address; `send_transaction` in demo mode returns the simulation envelope (`eth_call`-like behavior — TRON's `triggerconstantcontract` is used directly for TRC-20 sim envelope; native TRX uses `emitNoSimulationAvailable()` advisory). Plan 18-04 integration test uses 3 TRON personas; Plan 18-02 + 18-03 may add 2 demo personas alongside the existing whale (or reuse the whale + 2 hardcoded test-only addresses).

**OQ-6: Should Phase 18 update Phase 17's `tron-top-25.json` to include the full TRC-20 set?** Phase 17 already curated the 25-entry set (USDT-TRC20 + USDC-TRC20 + USDD + TUSD + 21 others by TVL). Phase 18's Layer 0.5 allowlist filters this to the 4 TRC-20 stablecoins (CONTEXT D-11a — only USDT/USDC/USDD/TUSD for v2.1 trust-pipeline scope; other 21 entries in `tron-top-25.json` are for reads, not yet allowlisted for transfer). No JSON change in Phase 18.

---

## § Topic 10: Decision lock summary (cross-reference to CONTEXT.md decisions)

| CONTEXT decision | Research verdict | Plans applying |
|---|---|---|
| **D-01** Fingerprint preimage = `keccak256("VaultPilot-trontx-v1:" ‖ raw_data_bytes)` | **CONFIRMED** — Topic 1 (tronweb `raw_data_hex` is the canonical bytes; domain tag 21 UTF-8 bytes; chain-distinct) | 18-01 |
| **D-02** Blind-sign hash = `SHA-256(raw_data_bytes)` (TRON consensus tx-id) | **CONFIRMED** — Topic 1 + Topic 4 (empirically verified tx-id == SHA-256(raw_data); Ledger TRX-app displays this) | 18-01 |
| **D-03** TRC-20 mandatory `triggerconstantcontract`; native TRX no-sim advisory | **CONFIRMED** — Topic 3 (TronGrid endpoint shape; native TRX has no simulation API; asymmetry intentional) | 18-01 + 18-04 |
| **D-04** TRX app v0.5+ clear-signs Phase 18 target set | **CONFIRMED** — Topic 2 (bundled registry covers USDT/USDC/USDD/TUSD); `LEDGER_NOTICE_TRON_TEMPLATE` pre-staged | 18-01 + 18-04 |
| **D-05** Both native + TRC-20 fingerprints are sender-dependent | **CONFIRMED** — Topic 1 + Topic 8 (`owner_address` is in `TransferContract`'s + `TriggerSmartContract`'s Protobuf preimage) | 18-04 (integration test) |
| **D-06a** Ref-block pinning via `tronweb.trx.getBlock("latest")` | **CONFIRMED** — Topic 5 (tronweb's `transactionBuilder.*` handles ref-block read internally) | 18-02 + 18-03 |
| **D-06b** 1-hour ref-block window > 15-min TTL | **PARTIAL** — Topic 5 — TAPOS window is ~15-30min, NOT 1 hour; tronweb default `expiration` is 60s — **MUST call `extendExpiration(tx, 900)` in plans 18-02 + 18-03** | 18-02 + 18-03 |
| **D-06c** `get_tx_verification` TRON branch additive widening | **CONFIRMED** — surface widens with `blockHeader` + `refBlockHash` + `rawDataHex` per Phase 12 + Phase 9 additive precedent | 18-04 |
| **D-07** `parseTronAmountStrict` mirrors `parseSolanaAmountStrict` with 6-decimal native + u256 TRC-20 | **CONFIRMED** — Topic 8 (TRC-20 amounts are uint256 on TRON-VM) + Phase 17 (TRX native is 6 decimals) | 18-01 |
| **D-08** Fixtures M + N as hardcoded literals in NEW sibling test file | **CONFIRMED** — Topic 1 (preimage shape stable across tronweb minor versions) | 18-01 (anchors) + 18-02 + 18-03 (consumer re-anchors) |
| **D-09** New sibling test files; EVM + Solana test files BYTE-UNTOUCHED | **CONFIRMED** — sibling-file pattern proven across Phase 12 + Phase 28 | All plans |
| **D-10a** `send_transaction.ts` TRON branch via additive switch arm | **CONFIRMED** — Topic 7 + Phase 12 dispatch precedent | 18-04 |
| **D-10b** Broadcast via `tronweb.trx.sendRawTransaction` | **CONFIRMED** — Topic 7 (envelope shape + error-code mapping documented) | 18-04 |
| **D-10c** `txHash = SHA-256(raw_data) = ledgerBlindSignHash` | **CONFIRMED** — Topic 4 (TRON tx-id IS the blind-sign hash; uniform across cryptographic-binding layers) | 18-04 |
| **D-11a** `canonical-dispatch-tron.ts` allowlist from `tron-top-25.json` TRC-20 subset | **CONFIRMED** — 4-entry set USDT/USDC/USDD/TUSD; native TRX skips the check via `txType` discrimination | 18-01 (module) + 18-04 (wiring) |
| **D-11b** Layer 0.5 before Layer 0.7; refusal returns `DISPATCH_TARGET_REFUSED` | **CONFIRMED** — Phase 12 ordering invariant; Phase 9 error-code reuse | 18-04 |
| **D-11c** EVM `canonical-dispatch.ts` BYTE-UNTOUCHED | **CONFIRMED** — sibling-file discipline | All plans |
| **D-12** SECURITY.md TRON section in Plan 18-04 with 6 sub-sections | **CONFIRMED** — Phase 12 Plan 12-05 precedent (Solana section landed in integration plan); 6 sub-sections all map to research findings | 18-04 |

**Single deviation:** D-06b refined from CONTEXT framing — research-confirmed that tronweb default `expiration` is 60s, not 1 hour, and the ref-block window is ~15-30min (TAPOS), not 1 hour. **Plans 18-02 + 18-03 MUST call `extendExpiration(tx, 900)` after `transactionBuilder.*` returns.** This is a load-bearing finding documented in PATTERNS §Risk surface and surfaced into the 18-02 + 18-03 plans.

---

*Phase: 18-tron-native-trc20-trust-pipeline*
*Research complete: 2026-05-20*
