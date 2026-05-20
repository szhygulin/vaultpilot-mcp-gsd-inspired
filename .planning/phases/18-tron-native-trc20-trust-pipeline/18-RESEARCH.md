# Phase 18: Research — TRON native + TRC-20 trust pipeline

**Researched:** 2026-05-20
**Domain:** TRON Protobuf transaction shape, `payloadFingerprint` preimage, Ledger TRX-app blind-sign hash recompute, `triggerconstantcontract` simulation posture, `sendRawTransaction` broadcast, `signTransaction` flow, FROZEN-area discipline against v1.x EVM + v2.0 Solana
**Confidence:** HIGH (Protobuf `raw_data_hex` preimage path + SHA-256 blind-sign hash form + tronweb API surface + Ledger TRX-app `Trx.d.ts` shape all empirically verified against installed `dist/*.d.ts` + LedgerHQ/app-tron `src/handlers/sign.c` C source + live TronGrid probe)
**Status:** Complete

## Summary

Phase 18 extends the v1.x → v2.0 prepare → preview → send trust pipeline to TRON via a third sibling `payloadFingerprint` module (domain tag `"VaultPilot-trontx-v1:"`), a TRON-specific preview-time `triggerconstantcontract` ADVISORY simulation gate (NOT mandatory like Solana DF-4 — the TRON API only covers TRC-20, returns false-reverts for unfunded callers, and is hit-by-rate-limit), USB-HID Ledger signing via `@ledgerhq/hw-app-trx@6.36.1`, and prepare-time `blockHeader` pinning to defend against tronweb's **60-second default expiration window** (much shorter than the Phase 18 prompt's "60-minute" approximation — TRON consensus allows up to 1 hour, tronweb defaults to 1 minute).

Seven FROZEN modules are byte-untouched (the entire v1.x EVM signing stack + the v2.0 Solana sibling stack). The additive surface lands in NEW sibling modules: `src/signing/payload-fingerprint-tron.ts`, `presign-hash-tron.ts`, `simulation-tron.ts`, `blocks-tron.ts`, `src/protocols/tron-native.ts`, `src/protocols/tron-trc20.ts`, `src/tools/prepare_tron_native_send.ts`, `src/tools/prepare_tron_trc20_send.ts`, `src/tools/send_transaction_tron.ts`.

**Primary recommendation:** Adopt **Option A (`payloadFingerprint = keccak256("VaultPilot-trontx-v1:" ‖ Buffer.from(Transaction.raw_data_hex, "hex"))`)**. Empirically verified: `sha256(raw_data_hex)` reproduces `Transaction.txID` exactly (probe 1+2 below) AND the Ledger TRX app's `sign.c` computes `cx_hash_no_throw((cx_hash_t *) &txContext.sha2, ...)` (where `sha2: cx_sha256_t` per `parse.h:112`) over the SAME bytes streamed from the host as `rawTxHex`. So the same byte sequence drives BOTH the agent-to-server fingerprint AND the device-side hash recompute, mirroring v1.x EVM (`keccak256` over RLP envelope) + v2.0 Solana (`keccak256` over `serializeMessage()`) exactly.

**Topic count:** 10. **DF count:** 4. **Open Questions:** 3. **Fixtures added:** K (native TRX transfer) + L (TRC-20 `transfer(address,uint256)`) — both hardcoded literals in NEW `test/signing-fingerprint-tron.test.ts` (sibling file mirroring Phase 12's `test/signing-fingerprint-solana.test.ts` namespace separation).

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Protobuf raw_data preimage assembly | Signing (`src/signing/payload-fingerprint-tron.ts`) | — | Sibling of `payload-fingerprint-solana.ts`. Reads `Transaction.raw_data_hex` from tronweb — no manual Protobuf encoding |
| TRX-app blind-sign hash recompute | Signing (`src/signing/presign-hash-tron.ts`) | — | SHA-256 over raw_data bytes per `LedgerHQ/app-tron/src/handlers/sign.c:177`. Sibling of `presign-hash-solana.ts` |
| TransferContract encoding | Protocols (`src/protocols/tron-native.ts`) | Chains (read pinned blockHeader from `_tronRegistry`) | Thin wrapper around `tronWeb.transactionBuilder.sendTrx(to, amount, from, { blockHeader })`. tronweb does the Protobuf work |
| TriggerSmartContract encoding (TRC-20) | Protocols (`src/protocols/tron-trc20.ts`) | — | Thin wrapper around `tronWeb.transactionBuilder.triggerSmartContract(contract, "transfer(address,uint256)", { feeLimit, blockHeader }, params, from)` |
| `triggerconstantcontract` simulation | Signing (`src/signing/simulation-tron.ts`) | Chains (RPC) | Classifier-only (mirror of `simulation-solana.ts` shape); ADVISORY in preview (NOT refusal-blocking — see DF-4) |
| Decimal-aware amount parsing | Signing (`src/signing/amount-tron.ts` NEW) | — | `parseTronAmountStrict(str, decimals)`. Mirrors `parseAmountStrict` (EVM) + `parseSolanaAmountStrict` (Solana) |
| PREPARE RECEIPT template | Signing (`src/signing/blocks-tron.ts` NEW) | — | Sibling APPEND of `blocks.ts` (EVM) + `blocks-solana.ts`. Format-fanout-sentinel single source for TRON prose blocks |
| Handle store discriminator extension | Signing (`src/signing/handle-store.ts` EXTEND) | — | Additive widening — add `PreparedTxTron` arm to `PreparedTx` union with sentinel EVM fields (mirrors `PreparedTxSolana` precedent) |
| Prepare tool (native) | Tools (`src/tools/prepare_tron_native_send.ts` NEW) | — | TRON-W-01. Calls protocol encoder, derives fingerprint, persists handle |
| Prepare tool (TRC-20) | Tools (`src/tools/prepare_tron_trc20_send.ts` NEW) | — | TRON-W-02. Same shape; resolves decimals via `get_tron_token_metadata` lookup |
| preview_send dispatch | Tools (`src/tools/preview_send.ts` EXTEND additively) | — | Append discriminator check `txType === "tron"` → dispatch to `previewTronTx(record)` after the Solana branch (FROZEN) |
| send_transaction dispatch | Tools (`src/tools/send_transaction.ts` EXTEND additively) | — | Append `txType === "tron"` branch AFTER the Solana branch (FROZEN). Sub-handler in NEW `src/tools/send_transaction_tron.ts` |

**Tier sanity check:** No EVM-side files touched (Phase 4-11 byte-frozen). No Solana-side files touched (Phase 12 byte-frozen). All Phase 18 changes additive in `src/signing/{payload-fingerprint,presign-hash,simulation,blocks,amount}-tron.ts`, `src/protocols/tron-native.ts` + `tron-trc20.ts`, `src/tools/{prepare_tron_*, send_transaction_tron}.ts`, and EXTENSION ONLY in `handle-store.ts` + `preview_send.ts` + `send_transaction.ts` (additive `txType === "tron"` arm).

## § Topic 1: TRON raw_data preimage — `payloadFingerprint` shape (DF-1)

### Empirical probe (installed `.d.ts` at `/tmp/tron-probe-18/node_modules/tronweb/lib/esm/types/Transaction.d.ts`)

```typescript
export interface Transaction<T = ContractParamter> {
  visible: boolean;
  txID: string;                       // 64 hex chars = sha256(raw_data_hex)
  raw_data: {
    contract: TransactionContract<T>[];   // [{ type: "TransferContract" | "TriggerSmartContract" | ..., parameter: {...} }]
    ref_block_bytes: string;              // hex, 4 chars (2 bytes)
    ref_block_hash: string;               // hex, 16 chars (8 bytes)
    expiration: number;                   // unix ms
    timestamp: number;                    // unix ms
    fee_limit?: number;                   // TriggerSmartContract only (sun)
    data?: string;                        // optional memo
  };
  raw_data_hex: string;               // ← Phase 18 payloadFingerprint preimage
}
```

### Live empirical probe (`/tmp/tron-probe-18/smoke.mjs` against `api.trongrid.io` 2026-05-20)

```
=== Probe 1: sendTrx (TransferContract) ===
txID:                  d4bfe8e4ffb4a49184483c1d7f9f77444a516e4f7aef2c55bcb1e12ae5473500
raw_data_hex (first 80): 0a027f6d22089392a232ae0dd43b4088ccabaae4335a67080112630a2d747970652e676f6f676c65
raw_data_hex length:   266 hex chars = 133 bytes
ref_block_bytes:       7f6d
ref_block_hash:        9392a232ae0dd43b
expiration:            1779278997000 (2026-05-20T12:09:57.000Z)
timestamp:             1779278937000 (2026-05-20T12:08:57.000Z)
expiration window:     1 MINUTE                                ← see Topic 3
contract type:         TransferContract
recomputed sha256(raw_data_hex):  d4bfe8e4ffb4a49184483c1d7f9f77444a516e4f7aef2c55bcb1e12ae5473500
matches tx.txID:       TRUE                                    ← canonical preimage proof
```

`sha256(raw_data_hex)` reproduces `tx.txID` byte-for-byte. The Ledger TRX app SHA-256s the **same bytes** received over APDU (`Trx.js:112: const rawTx = Buffer.from(rawTxHex, "hex")`). So the `raw_data_hex` field is the canonical signed-preimage shape — no library-side reserialization risk.

### Option comparison

| Option | Preimage | Verdict |
|---|---|---|
| **A: `keccak256("VaultPilot-trontx-v1:" ‖ Buffer.from(Transaction.raw_data_hex, "hex"))`** | The actual bytes the device SHA-256s | **ADOPT** — same shape device hashes; minimal preimage assembly; tronweb produces the bytes canonically |
| B: Custom Protobuf tuple `(contractType, owner_address, to_address, amount, ref_block_*, expiration, timestamp)` | Hand-assembled tuple | REJECT — duplicates what tronweb already does; CLAUDE.md "Don't hand-roll" forbids; future contract types (Stake 2.0, votes, swaps) need 20+ more tuple shapes |
| C: Re-use EVM shape adapted `(chainId, to, value, data)` | viem-shape adapted | REJECT — TRON has no `chainId`, no flat `(to, value, data)` shape (`TriggerSmartContract` has `data` as calldata + `contract_address` separately; ref-block + expiration + timestamp have no EVM analog) |
| D: `keccak256(raw_data_hex_utf8_string)` | UTF-8 of the hex *string* | REJECT — encodes the hex twice; non-canonical |

### Decision lock — DF-1: Adopt Option A

```typescript
export const FINGERPRINT_DOMAIN_TAG_TRON = "VaultPilot-trontx-v1:";  // 21 UTF-8 bytes

export function computeTronPayloadFingerprint(input: { rawDataHex: string }): Hex {
  const tag = toBytes(FINGERPRINT_DOMAIN_TAG_TRON);                  // 21 bytes utf-8
  const rawDataBytes = Buffer.from(input.rawDataHex.replace(/^0x/, ""), "hex");
  const preimage = concat([tag, rawDataBytes]);
  return keccak256(preimage);                                        // sibling of EVM + Solana fingerprints
}
```

Distinct domain tag `"VaultPilot-trontx-v1:"` (**21 UTF-8 bytes** — pin in Fixture K test) versus EVM's `"VaultPilot-txverify-v1:"` (23 bytes) and Solana's `"VaultPilot-soltx-v1:"` (20 bytes) makes cross-chain fingerprint reuse impossible by construction. The `keccak256` choice (NOT SHA-256) is deliberate and consistent with Phase 12 DF-1: the **binding-layer** hash is keccak; the **device-display** hash (Topic 2) is SHA-256 — these are distinct artifacts serving distinct purposes.

### TRX-vs-TRC-20 fingerprint discriminator (Topic 9 sister)

Both TRX-native and TRC-20 share the `raw_data_hex` envelope shape. The discriminator lives in `raw_data.contract[0].type`:

- `TransferContract` → native TRX (`raw_data_hex` includes `TransferContract` value-tuple with `owner_address`, `to_address`, `amount`)
- `TriggerSmartContract` → TRC-20 / SunSwap / arbitrary smart-contract (`raw_data_hex` includes `TriggerSmartContract` value-tuple with `owner_address`, `contract_address`, `data` calldata, optional `fee_limit`)

The same domain tag `"VaultPilot-trontx-v1:"` covers both — the **inner bytes** differ (probe 5: native_fp `0x1dd7daca…` vs trc20_fp `0x3dad5cd7…` — distinct). No need for separate tags per inner contract type.

### Format-fanout-sentinel test invariants

- `FINGERPRINT_DOMAIN_TAG_TRON.length === 21` — byte-length pin in Fixture K.
- **Fixture K (native TRX transfer):** hardcoded `0x…` literal — `from = personaTron[0]`, `to = personaTron[1]`, `amount = 1_000_000` sun, pinned `blockHeader: { ref_block_bytes, ref_block_hash, expiration, timestamp }` (fixed values from a checked-in fixture block-header). FINGERPRINT IS SENDER-DEPENDENT (owner_address is embedded in raw_data_hex inner value-tuple) — same shape as Phase 12 Solana Fixture I.
- **Fixture L (TRC-20 transfer):** hardcoded `0x…` literal — `contract = USDT-TRC20 mainnet (TR7NHqj…)`, `from = personaTron[0]`, `to = personaTron[1]`, `amount = 1_000_000` (1 USDT, 6 dec), pinned `blockHeader`. FINGERPRINT IS SENDER-DEPENDENT (owner_address in raw_data + calldata embeds recipient — but NOT sender position; sender appears in `owner_address` only).

**Cross-anchor:** Persona-cycle integration test (`test/tron-trust-pipeline.integration.test.ts`) re-anchors byte-identity across persona swaps — proves fingerprint changes when persona changes (matches Phase 7 `T-INTEGRATION-FROM-DRIFT-2` shape).

`[VERIFIED: installed dist/*.d.ts probe + live TronGrid probe 2026-05-20] + [CITED: LedgerHQ/app-tron/src/handlers/sign.c]`.

## § Topic 2: Ledger TRX-app blind-sign hash form (DF-2)

### Empirical probe (`LedgerHQ/app-tron/src/handlers/sign.c`, fetched via gh API 2026-05-20)

```c
// Line 132 — incremental hash of each APDU chunk (streaming raw_data bytes):
CX_ASSERT(cx_hash_no_throw((cx_hash_t *) &txContext.sha2, 0, workBuffer, dataLength, NULL, 32));

// Line 177 — finalize the hash into transactionContext.hash (32 bytes):
CX_ASSERT(cx_hash_no_throw((cx_hash_t *) &txContext.sha2,
                           CX_LAST,
                           workBuffer,
                           0,
                           transactionContext.hash,
                           32));
```

Per `src/parse.h:112`:

```c
typedef struct txContext_t {
    ...
    cx_sha256_t sha2;     // ← SHA-256 context — DEFINITIVE
    ...
} txContext_t;
```

**Confirmed: hash form is SHA-256 (32 bytes, 64 hex chars) — NOT keccak, NOT RIPEMD-160.**

### What the device DISPLAYS

Looking at the rest of `sign.c`:

- **Clear-sign path (TransferContract — native TRX):** `APPROVAL_TRANSFER` flow — device displays decoded `Recipient` + `Amount` (in TRX, decimals applied via `print_amount(... SUN_DIG)`). **No hash on-screen.**
- **Clear-sign path (TriggerSmartContract — TRC-20 `transfer` method 1):** also `APPROVAL_TRANSFER` flow — device displays `Asset`, `Recipient` (`To`), `Amount` (with token decimals from a built-in tokens table or APDU-supplied tokenSignatures). **No hash on-screen for canonical TRC-20 mainnet stablecoins.**
- **Blind-sign path (`default` case + permission-update + unrecognized contract types):** requires user-enabled `S_SIGN_BY_HASH` setting (else refuses with `E_MISSING_SETTING_SIGN_BY_HASH`). Device displays `format_hex(transactionContext.hash, 32, fullHash, ...)` — the 32-byte SHA-256 of raw_data — via `APPROVAL_SIMPLE_TRANSACTION` flow.
- **Custom smart-contract path (TriggerSmartContract with `TRC20Method != 1 && != 2`):** requires user-enabled `S_CUSTOM_CONTRACT` setting; device displays contract address + 4-byte selector + value (TRX/token) via `APPROVAL_CUSTOM_CONTRACT` flow. **Hash NOT displayed.**

The signature is ALWAYS computed over the SHA-256 hash regardless of which display path fires (`transactionContext.hash` is the secp256k1 sign target). Phase 18 emits the `LEDGER BLIND-SIGN HASH (TRON)` block **UNCONDITIONALLY** at preview time so the user has the predicted hash regardless of which device flow fires — even when the device clear-signs (the hash is the trust anchor *behind* the decoded args).

### Block emission

Phase 18 emits a `LEDGER BLIND-SIGN HASH (TRON)` block parallel to the Solana template:

```
LEDGER BLIND-SIGN HASH (TRON)
  Predicted hash (full):    0xa3b2c4d5…(64 hex chars)
  Predicted hash (chunked): a3b2 c4d5 … (4-char groups for readable on-device match)

  TRX app v0.3.0+ CLEAR-SIGNS native TRX (TransferContract) and TRC-20
  transfer() (TriggerSmartContract with method == 1) — device shows decoded
  Recipient + Amount in those flows. The predicted hash above is still the
  cryptographic anchor your device signs over (sha256(raw_data) per
  app-tron/src/handlers/sign.c). For unrecognized contract types, the device
  enters blind-sign mode and DISPLAYS this hash directly — match character-
  for-character.
```

Recompute path: `crypto.createHash("sha256").update(Buffer.from(rawDataHex, "hex")).digest()` — pure Node stdlib. Mints locally at preview time; device computes the SAME value because both sides operate on the identical `raw_data_hex` bytes.

### Decision lock — DF-2: Emit the `LEDGER BLIND-SIGN HASH (TRON)` block UNCONDITIONALLY

Mirrors Phase 12 DF-2 exactly. The hash is the trust anchor regardless of clear-sign coverage. A sibling `LEDGER NOTICE (TRON)` block is emitted CONDITIONALLY when the tx shape will trigger blind-sign mode (custom-contract call, permission-update, or any non-method-1/method-2 TriggerSmartContract) — names the device-settings prerequisite.

`[VERIFIED: LedgerHQ/app-tron/src/handlers/sign.c gh API fetch 2026-05-20] + [VERIFIED: src/parse.h:112 cx_sha256_t type declaration]`.

## § Topic 3: TRON ref-block / expiration window (TRON-PREP timing)

### Critical correction to the prompt's "60-minute" framing

The Phase 18 prompt anchors a **60-minute** ref-block window; the empirical probe shows the **tronweb DEFAULT expiration is 60 SECONDS** (probe 1, expiration_window line). Source — `tronweb/lib/esm/lib/trx.js:973-987` `getCurrentRefBlockParams`:

```javascript
async getCurrentRefBlockParams() {
  const { block_header, blockID } = await this.tronWeb.fullNode.request('wallet/getblock', ...);
  const { number, timestamp } = block_header.raw_data;
  return {
    ref_block_bytes: number.toString(16).slice(-4).padStart(4, '0'),
    ref_block_hash: blockID.slice(16, 32),
    expiration: timestamp + 60 * 1000,                      // ← 60 SECONDS, not 60 minutes
    timestamp,
  };
}
```

### Layered window semantics

| Window | Bound by | Default tronweb value | TRON consensus max |
|---|---|---|---|
| `expiration` field (per-tx) | tronweb default | `timestamp + 60_000` ms = **1 minute** | up to 24 hours (Java-tron `MAXIMUM_TIME_UNTIL_EXPIRATION = 86_400_000` ms) |
| ref-block validity | TRON consensus | Pinned to a specific block (~6_500 ms each); tx invalid once that block is more than ~250 blocks old | **~1 hour** (the original "60-minute window" the prompt anchors) |

The tronweb default `expiration = +60s` is **shorter** than the consensus ref-block window. Phase 18 has TWO knobs:

- **`raw_data.expiration`** — agent-overridable via `transactionCommonOptions.blockHeader.expiration`. Recommend pinning to **`timestamp + 60 * 60 * 1000`** (1 hour, matches the consensus ref-block window) at prepare time — gives users a forgiving send window across the prepare → preview → on-device-approval → send sequence. Surface in PREPARE RECEIPT as `expiresAt: <ISO8601>` so the user sees the deadline.
- **ref-block pinning** — `blockHeader.ref_block_bytes` + `blockHeader.ref_block_hash` captured at prepare time. Pinning these freezes the fingerprint preimage (otherwise the timestamp/block-hash drift between prepare and send-time re-derivation would break the fingerprint stability invariant).

### Decision lock — pin both `blockHeader.{ref_block_bytes, ref_block_hash, expiration, timestamp}` at prepare time

```typescript
// In prepare_tron_native_send.ts (and prepare_tron_trc20_send.ts):
const tw = _tronRegistry.getTronWeb();
const refBlockParams = await tw.trx.getCurrentRefBlockParams();
const pinnedHeader = {
  ref_block_bytes: refBlockParams.ref_block_bytes,
  ref_block_hash: refBlockParams.ref_block_hash,
  timestamp: refBlockParams.timestamp,
  expiration: refBlockParams.timestamp + 60 * 60 * 1000,    // 1-hour window (consensus max)
};
const tx = await tw.transactionBuilder.sendTrx(to, sunAmount, fromAddress, {
  blockHeader: pinnedHeader,
});
```

Verified at probe 7: same `(to, amount, from, blockHeader)` inputs produce identical `raw_data_hex` AND identical `txID`. The fingerprint is stable iff the blockHeader is pinned.

### Surface in PREPARE RECEIPT

```
PREPARE RECEIPT (TRON — native transfer)
  chain:           tron mainnet
  to:              TLa2f6VPqDgRE67v1736s7bJ8Ray5wYjU7
  sun:             1000000           (raw units; 1 TRX = 10^6 sun, decimals = 6)
  ref_block_bytes: 7f6d
  ref_block_hash:  9392a232ae0dd43b
  expiresAt:       2026-05-20T13:08:57Z   (1 hour from prepare; broadcast before then)
```

The `expiresAt` line is an **advisory** — preview_send does NOT refuse on an expired window (the tx will fail at broadcast with `TRANSACTION_EXPIRATION_ERROR` per `BroadcastReturn_response_code = 8`); the user sees the deadline and the agent surfaces a `BROADCAST_FAILED` errorCode if they wait too long.

### Decision lock — DF-3: 1-hour expiration window, pinned at prepare time

Phase 18 prepare tools default `blockHeader.expiration = timestamp + 60 * 60 * 1000` (1 hour). User cannot extend further — TRON consensus rejects > 24-hour windows but 1 hour is the practical ref-block validity ceiling per the [TRON Protobuf protocol docs](https://github.com/tronprotocol/protocol/blob/master/protocol/core/Tron.proto). Override path deferred to a future capability tool.

`[VERIFIED: tronweb/lib/esm/lib/trx.js:973-987] + [VERIFIED: live probe 2026-05-20] + [CITED: tronprotocol/protocol Tron.proto]`.

## § Topic 4: Native TRX transfer encoding (TransferContract)

### Empirical probe — `tronWeb.transactionBuilder.sendTrx`

```typescript
// tronweb/lib/esm/lib/TransactionBuilder/TransactionBuilder.d.ts:15
sendTrx(
  to: string,                                           // base58check address (T-prefixed)
  amount?: number,                                      // sun (1 TRX = 10^6 sun)
  from?: string,                                        // base58check address — sender
  options?: TransactionCommonOptions,                   // { blockHeader?, permissionId? }
): Promise<Transaction<TransferContract>>;
```

### Probe 1 live result

```
contract type:        TransferContract
contract param:       {"value":{
                         "to_address":"4174472e7d35395a6b5add427eecb7f4b62ad2b071",
                         "owner_address":"41a614f803b6fd780986a42c78ec9c7f77e6ded13c",
                         "amount":1000000
                       },
                       "type_url":"type.googleapis.com/protocol.TransferContract"}
```

Internally tronweb encodes the Protobuf `TransferContract` with three fields: `owner_address`, `to_address` (both as `0x41`-prefixed 21-byte hex), `amount` (varint, sun). The serialized bytes flow into `raw_data_hex`. NO library-specific reserialization risk — same input deterministically produces same `raw_data_hex` (probe 7).

### Decision lock — Use `tronWeb.transactionBuilder.sendTrx(to, sun, from, { blockHeader })`

```typescript
// In src/protocols/tron-native.ts
export async function encodeTronNativeTransfer(input: {
  to: string;                  // base58check
  sun: bigint;                 // raw sun
  from: string;                // base58check (paired account)
  blockHeader: PinnedBlockHeader;
}): Promise<TronTransaction> {
  const tw = _tronRegistry.getTronWeb();
  return await tw.transactionBuilder.sendTrx(
    input.to,
    Number(input.sun),                       // tronweb takes number; widen at boundary
    input.from,
    { blockHeader: input.blockHeader },
  );
}
```

**Note: `sendTrx(amount: number)` — narrowing risk.** Native TRX whale balances can exceed `Number.MAX_SAFE_INTEGER` (= 9.007e15 sun ≈ 9 billion TRX); single-tx transfers above this would lose precision. Mitigation: `parseTronAmountStrict` (Topic 6) returns `bigint`; cast to `number` ONLY at the boundary AFTER asserting `sun <= BigInt(Number.MAX_SAFE_INTEGER)` and refusing with `INVALID_INPUT` otherwise. v1.x scope this is theoretical — practical max single-tx TRX transfer is far below the JS Number ceiling — but the check belongs at the boundary anyway. Phase 17 already established the same pattern (`getBalance` returns `number`; wrap in `BigInt(...)` at the read boundary).

`[VERIFIED: tronweb installed .d.ts + live probe]`.

## § Topic 5: TRC-20 transfer encoding (TriggerSmartContract)

### Empirical probe — `tronWeb.transactionBuilder.triggerSmartContract`

```typescript
// tronweb/lib/esm/lib/TransactionBuilder/TransactionBuilder.d.ts:30
triggerSmartContract(
  contractAddress: string,                              // base58check (T-prefixed) — TRC-20 contract
  functionSelector: string,                             // e.g. "transfer(address,uint256)"
  options?: TriggerSmartContractOptions,                // { feeLimit?, callValue?, blockHeader? }
  parameters?: ContractFunctionParameter[],             // [{ type: "address", value: <to> }, { type: "uint256", value: <amount> }]
  issuerAddress?: string,                               // base58check — sender (owner)
): Promise<TransactionWrapper>;                         // wrapper.transaction is the Transaction<TriggerSmartContract>
```

### Probe 2 live result

```
wrapper.result:       { result: true }
transaction.txID:     fad6c82997913e6a9ec2bb8ebc306c1130a484e427df4fe619bb0e4fecf9a091
raw_data_hex length:  422 hex chars (211 bytes)
contract type:        TriggerSmartContract
contract param:       {"value":{
                         "data":"a9059cbb00000000000000000000000074472e7d35395a6b5add427eecb7f4b62ad2b07100000000000000000000000000000000000000000000000000000000000f4240",
                         "owner_address":"41a614f803b6fd780986a42c78ec9c7f77e6ded13c",
                         "contract_address":"41a614f803b6fd780986a42c78ec9c7f77e6ded13c"
                       },
                       "type_url":"type.googleapis.com/protocol.TriggerSmartContract"}
recomputed sha256(raw_data_hex):  fad6c82997913e6a9ec2bb8ebc306c1130a484e427df4fe619bb0e4fecf9a091
matches tx2 txID:     TRUE
```

`a9059cbb` is the EVM-standard `transfer(address,uint256)` selector — TRON's smart-contract layer is EVM-compatible, so the calldata is byte-identical to Ethereum's TRC-20 → ERC-20 cousin. The `to_address` (`74472e7d…`) is the 20-byte EVM-form address (NO `0x41` prefix in calldata — only the `owner_address` + `contract_address` at the Protobuf-envelope layer carry the `0x41`-prefixed 21-byte TRON form). **Critical: TRC-20 calldata embeds the EVM-form 20-byte address; the Protobuf envelope embeds the TRON-form 21-byte (`0x41`-prefixed) addresses.** Phase 18 callers convert via `tronWeb.address.toHex` (returns the `0x41`-prefixed form); tronweb itself strips the `0x41` prefix internally when encoding calldata `address` parameters.

### Decision lock — Use `tronWeb.transactionBuilder.triggerSmartContract`

```typescript
// In src/protocols/tron-trc20.ts
export async function encodeTronTrc20Transfer(input: {
  tokenAddress: string;        // base58check (T-prefixed) TRC-20 contract
  to: string;                  // base58check (T-prefixed) recipient
  amount: bigint;              // raw token units
  from: string;                // base58check (paired account)
  blockHeader: PinnedBlockHeader;
  feeLimit?: bigint;           // sun; default 100_000_000 (= 100 TRX), TRON-recommended cap
}): Promise<TronTransactionWrapper> {
  const tw = _tronRegistry.getTronWeb();
  return await tw.transactionBuilder.triggerSmartContract(
    input.tokenAddress,
    "transfer(address,uint256)",
    {
      feeLimit: Number(input.feeLimit ?? 100_000_000n),     // bigint→number at boundary
      blockHeader: input.blockHeader,
    },
    [
      { type: "address", value: input.to },
      { type: "uint256", value: input.amount.toString() },  // tronweb accepts decimal string
    ],
    input.from,
  );
}
```

**`feeLimit` discipline:** TRON requires `feeLimit` for `TriggerSmartContract` calls. Without it, the broadcast fails with `CONTRACT_VALIDATE_ERROR`. Phase 18 default: `100_000_000` sun = 100 TRX. Real TRC-20 transfer typical cost: 15-30 TRX (energy + bandwidth). Surface in `CHECKS PERFORMED` as informational; **don't refuse on fee_limit-vs-actual-energy mismatch** — that's the user's call.

`[VERIFIED: tronweb installed .d.ts + live probe]`.

## § Topic 6: Simulation API — `triggerconstantcontract` posture (DF-4)

### Empirical probe — `tronWeb.transactionBuilder.triggerConstantContract`

```typescript
// tronweb/lib/esm/lib/TransactionBuilder/TransactionBuilder.d.ts:31
triggerConstantContract(
  contractAddress: string,
  functionSelector: string,
  options?: TriggerConstantContractOptions,
  parameters?: ContractFunctionParameter[],
  issuerAddress?: string,
): Promise<TransactionWrapper>;
```

### Probe 3 + 4 live results

```
=== Probe 3: triggerConstantContract (balanceOf — read call) ===
sim.result:           { result: true }
constant_result:      0000000000000000000000000000000000000000000000000000007a88822652
energy_used:          4062
(transaction.txID built but NOT broadcast): dc318997ac44c3e6c02ea4c358335e03207e9b86cb2301d8c4b93212d5e5ced2

=== Probe 4: triggerConstantContract (transfer simulation — write call) ===
xfer-sim error:       REVERT opcode executed                  ← false-revert from unfunded caller
```

### Critical findings

1. **`triggerconstantcontract` is the CLOSEST TRON analog to `eth_call` / Solana `simulateTransaction`.** It executes the contract function in a sandbox without broadcasting, returning the result + energy estimate.

2. **For READ calls (balanceOf, allowance, decimals, etc.) — `triggerconstantcontract` works cleanly.** Used by `get_tron_token_metadata` + balance reads (Phase 17 scope).

3. **For WRITE calls (`transfer`, `approve`) — `triggerconstantcontract` is HIGH-FALSE-POSITIVE.** Probe 4 above: a `transfer` simulation from the `USDT contract address itself` REVERTed because that address doesn't own USDT. In practice, real users calling `triggerconstantcontract` for a `transfer` they *would* succeed on will likely return `result: true`, but **the false-revert rate from edge cases (state staleness, fee-limit configuration drift, on-chain-balance shifts mid-prepare) is non-trivial.**

4. **`triggerconstantcontract` does NOT cover native TRX `TransferContract`.** There is no `TransferContract` simulation API — `wallet/triggertransfer` or similar doesn't exist; the only TRX-specific RPC is `wallet/getaccount` for balance pre-check.

5. **TronGrid rate limits (probe 6 hit HTTP 429 on the 6th sequential call within ~10 seconds).** The free tier is ~5 req/sec / IP. Phase 18's preview gate makes 1-2 simulation calls per preview; if a user previews aggressively the rate-limit could fire. **A rate-limit response MUST demote to ADVISORY status, not refusal** — same posture as the simulation error case in the EVM `simulation.ts` helper.

### Option comparison — posture choice

| Posture | Behavior on revert | Behavior on RPC error | Verdict |
|---|---|---|---|
| **A: MANDATORY refusal (mirror Phase 12 DF-4 Solana)** | Refuse with `TRON_SIMULATION_REVERT` | Refuse with `TRON_SIMULATION_ERROR` | REJECT — false-positive rate too high; TRON-side simulation is less-reliable than Solana's, and 429-rate-limit demotion would block legitimate flows |
| B: NO simulation gate (skip Layer 0.7 entirely) | n/a | n/a | REJECT — loses the catch-bad-tx-before-on-device-approval defense entirely |
| **C: ADVISORY (mirror v1.x EVM `simulation.ts`) — TRC-20 only** | Surface in `CHECKS PERFORMED` as informational; preview emits `LEDGER BLIND-SIGN HASH` regardless | Demote to `status: "error"` + advisory note | **ADOPT** — catches the easy cases (insufficient balance, allowance not set, contract paused) without false-positive refusals; user decides on the basis of the simulation note + on-device hash match |
| D: ADVISORY for TRC-20, SKIP for native TRX | TRC-20 simulated; TRX skipped with explicit `SKIPPED` note in `CHECKS PERFORMED` | Demote to error advisory | **ADOPT** — recognizes the API surface gap |

### Decision lock — DF-4: ADVISORY simulation gate; TRC-20 only; native TRX skipped

Phase 18 `preview_send` TRON branch composition:

```
1. Layer 0.5 — canonical dispatch (Phase 9 SEC-35) — TRON arm DEFERS to Phase 19 (SunSwap + LiFi
   facet IDs); Phase 18 native + canonical TRC-20 stablecoin transfers BYPASS Layer 0.5
   (`TransferContract` and `TriggerSmartContract.transfer()` against curated TRC-20 mints
   are universally trusted by this defense layer — the trust delegation is to the contracts
   themselves, not to a dispatch table)
2. Layer 0.7 — NEW — TRON triggerconstantcontract (ADVISORY)
   - TRC-20: run triggerconstantcontract; surface result/energy/revert in CHECKS PERFORMED
     with status string ("ok" | "revert" | "error" | "rate-limited"). DO NOT refuse on revert.
   - TRX native: SKIP simulation; surface "no simulation API for TransferContract — see
     `get_tron_balance` for pre-flight balance check" advisory in CHECKS PERFORMED
3. Layer 2 — chain-mismatch (Phase 8) — N/A for TRON (single network mainnet; testnet via env override)
4. Layer 3 — payloadFingerprint drift gate at send time (Phase 4 invariant — UNCHANGED — sibling-additive)
```

**Why ADVISORY (not refusal) is the right posture for TRON:**
- TRON's simulation surface (`triggerconstantcontract`) targets contract function execution only — not the full Protobuf envelope (so ref-block validity, expiration, fee_limit-vs-energy-actual aren't simulated).
- False-revert rate is higher than Solana (probe 4 above).
- Rate-limiting demotes to error frequently on free-tier; refusing on RPC-error would degrade UX too much.
- TRON's broadcast endpoint surfaces revert clearly via `BroadcastReturn.code = CONTRACT_EXE_ERROR` — Phase 18 `send_transaction` TRON branch maps that into a `BROADCAST_FAILED` errorCode with the contract-execution-error reason. The user gets caught at broadcast even if preview was advisory-ok.

### CHECKS PERFORMED block prose

TRC-20 simulation ok:
```
CHECKS PERFORMED (TRON simulation — Layer 0.7 / ADVISORY)
  status:         ok (no revert)
  energy_used:    14823            (≤ feeLimit 100000000 sun — see PREPARE RECEIPT)
  constant_result: (none)          (transfer() returns void / true on success — empty constant_result)
```

TRC-20 simulation revert:
```
CHECKS PERFORMED (TRON simulation — Layer 0.7 / ADVISORY)
  status:         revert (REVERT opcode executed)
  energy_used:    n/a
  reason:         REVERT opcode executed
  ⚠ ADVISORY only — Phase 18 preview does NOT refuse on revert. Common causes:
    insufficient balance, allowance not set, contract paused. Verify via
    get_tron_token_balance + on-device hash match before approving.
```

Native TRX simulation skipped:
```
CHECKS PERFORMED (TRON simulation — Layer 0.7 / ADVISORY)
  status:         skipped (no simulation API for native TransferContract)
  advisory:       Run get_tron_balance to verify the paired account has sufficient TRX
                  for amount + bandwidth fee (1 sun ≈ 1 byte; typical TRX-send fee ~280 bandwidth).
```

`[VERIFIED: live triggerConstantContract probe 2026-05-20] + [CITED: developers.tron.network/reference/triggerconstantcontract]`.

## § Topic 7: TRON broadcast — `sendRawTransaction`

### Empirical probe

```typescript
// tronweb/lib/esm/lib/trx.d.ts:90
sendRawTransaction<T extends SignedTransaction>(
  signedTransaction: T,
): Promise<BroadcastReturn<T>>;

// tronweb/lib/esm/types/Trx.d.ts:175
export interface BroadcastReturn<T extends SignedTransaction> {
  result: boolean;          // true on success
  txid: string;             // 64-hex-char tx ID (base16, NOT base58 — confirmed via probe 1's
                            //   recomputed sha256(raw_data_hex))
  code: BroadcastReturn_response_code;
  message: string;          // human-readable error on failure
  transaction: T;
}

// Response codes (Trx.d.ts:160-174):
SUCCESS = 0,
SIGERROR = 1,                     // signature verification failed
CONTRACT_VALIDATE_ERROR = 2,      // tx shape rejected at validate-time (e.g. missing feeLimit)
CONTRACT_EXE_ERROR = 3,           // tx executed but reverted (TRC-20 revert lands here)
BANDWITH_ERROR = 4,               // (sic) bandwidth insufficient
DUP_TRANSACTION_ERROR = 5,        // already broadcast
TAPOS_ERROR = 6,                  // ref_block_bytes/hash mismatch (stale ref-block)
TOO_BIG_TRANSACTION_ERROR = 7,
TRANSACTION_EXPIRATION_ERROR = 8, // expiration field is in the past
SERVER_BUSY = 9,
NO_CONNECTION = 10,
NOT_ENOUGH_EFFECTIVE_CONNECTION = 11,
OTHER_ERROR = 20,
```

### Critical: txid is base16 hex, NOT base58

The prompt anchored "txid base16 (not base58)" — confirmed. The `txid` field is the same 64-hex-char string as `Transaction.txID` (= `sha256(raw_data_hex)`). NOT a base58-encoded fee-payer signature like Solana. Phase 18 stores this `txid` in `handle-store.ts:HandleRecord.txHash` (the field was widened in Phase 12 from `Hex` to `string` for cross-chain compatibility — works for TRON unchanged).

### Decision lock — broadcast via `tronWeb.trx.sendRawTransaction`

```typescript
// In send_transaction_tron.ts (NEW)
const tw = _tronRegistry.getTronWeb();

// 1. Sign on device (via @ledgerhq/hw-app-trx — Topic 8)
const signatureHex = await trxApp.signTransaction(DEFAULT_TRON_DERIVATION_PATH, rawDataHex, []);

// 2. Attach signature to the prepared tx (single-sig is single-element array)
const signedTx: SignedTransaction = {
  ...preparedTx,
  signature: [signatureHex],
};

// 3. Broadcast
const result = await tw.trx.sendRawTransaction(signedTx);
if (!result.result) {
  // Map BroadcastReturn_response_code into BROADCAST_FAILED errorCode +
  // surface result.code + result.message in the structured envelope's cause field
  return errEnvelope("BROADCAST_FAILED", `tron broadcast rejected: code=${result.code} message=${result.message}`);
}
return { txHash: result.txid, broadcastedAt: new Date().toISOString() };
```

### Error mapping (additive to existing error-codes.ts taxonomy)

| Source | Phase 18 surface |
|---|---|
| `LedgerDeviceNotConnectedError` | `LEDGER_NOT_CONNECTED` (existing — Phase 11/17) |
| `LedgerTronAppNotOpenError` | `TRON_APP_NOT_OPEN` (NEW — additive; mirrors `SOLANA_APP_NOT_OPEN` from Phase 11) |
| APDU `0x6985` user-rejected | `USER_REJECTED` errorCode → reuses Phase 11's `isUserRejection` substring match (same Ledger SDK) |
| `BroadcastReturn.result === false` | `BROADCAST_FAILED` errorCode (existing — reused from Phase 4 WC + Phase 12 Solana) — `cause` field carries the TRON-specific `code` + `message` |
| `tronweb` HTTP error | `TRON_RPC_FAILED` (NEW — additive) |

### Confirmation polling

Phase 18 v1.x scope MAY ship `get_tron_transaction_status({ txid })` parallel to Phase 4's `get_tx_verification` — uses `tw.trx.getTransaction(txid)` (probe surface verified in `trx.d.ts:36`). Returns `{ confirmed: boolean, blockNumber?: number }`. **Recommend deferring to Phase 21 diagnostics** unless the v2.0 Solana retro pulled `get_solana_transaction_status` into Phase 12 scope — verify against `src/tools/*` actual file list. Found: `src/tools/get_solana_transaction_status.ts` does NOT exist (Phase 12 shipped without it per the retro note). Phase 18 follows the same posture: defer `get_tron_transaction_status` to Phase 21.

`[VERIFIED: tronweb installed .d.ts + live probes 1-2]`.

## § Topic 8: USB-HID signing flow — `@ledgerhq/hw-app-trx`

### Empirical probe (`@ledgerhq/hw-app-trx@6.36.1` installed `.d.ts`)

```typescript
// node_modules/@ledgerhq/hw-app-trx/lib-es/Trx.d.ts:27-39
signTransaction(
  path: string,                      // BIP-32 path — DEFAULT_TRON_DERIVATION_PATH = "44'/195'/0'/0/0"
  rawTxHex: string,                  // The Protobuf raw_data_hex — IDENTICAL to Transaction.raw_data_hex
  tokenSignatures: string[],         // TRC-10 token-name signatures (empty array for TRX + TRC-20)
): Promise<string>;                  // 65-byte signature as 130-hex-char string (recoverable secp256k1, includes v byte)
```

### Critical: the `tokenSignatures` arg is `string[]`, NOT a version number

The doc-example in `Trx.d.ts:37` shows `signTransaction("44'/195'/0'/0/0", "0a02f594...", [], 105)` — the literal `105` reads as a 4th arg but the TYPED signature has only 3 params. Reading the JS implementation (`Trx.js:110-174`) confirms ONLY `(path, rawTxHex, tokenSignatures)` are consumed; the `105` is a stale doc artifact (likely from an older version that had a `version` param). **Phase 18 ALWAYS passes `[]` as the 3rd arg** (TRC-10 token-signature payload is irrelevant for TRX native + TRC-20).

### Signature shape — 65-byte recoverable secp256k1

```javascript
// Trx.js:170
return response.slice(0, 65).toString("hex");
```

65 bytes = 64-byte (r ‖ s) + 1-byte recovery-id (v). Tron's `SignedTransaction.signature: string[]` is the multi-sig array; **single-sig flow = single-element array**:

```typescript
const signedTx: SignedTransaction = {
  ...preparedTx,
  signature: [signatureHex],         // 130 hex chars, no 0x prefix per tronweb convention
};
```

### Critical: `signTransaction` vs `signTransactionHash`

Two device-side flows:

| Method | Input | Use case |
|---|---|---|
| `signTransaction(path, rawTxHex, tokens)` | Full `raw_data_hex` (1-1000 bytes; device chunks via APDU) | **Phase 18 default** — device parses the Protobuf on-device for clear-sign display; SHA-256s the bytes incrementally during streaming |
| `signTransactionHash(path, rawTxHashHex)` | Pre-computed 32-byte SHA-256 hash | **AVOID** — bypasses the device's clear-sign capability; the device cannot display decoded args because it only sees the hash. Only useful for tx shapes that exceed the APDU buffer size |

**Decision lock — Phase 18 uses `signTransaction(path, rawTxHex, [])` exclusively.** Even if a future tx shape grows beyond the APDU chunk size, the right answer is the multi-chunk streaming `signTransaction` (which already chunks internally per `Trx.js:120-134`), NOT `signTransactionHash`.

### Per-call transport discipline

Phase 17 already wired per-call USB-HID transport open/close in `src/wallet/ledger-tron-transport.ts:130-182` (`openTransport()` + `fetchTronAddress()`). Phase 18 adds a SECOND consumer: `signTronTransaction(rawTxHex)`. Per-call discipline mirrors Phase 11 + Phase 17 + Phase 12 — open within try/finally; close unconditionally on both happy + error paths. Holding the transport open across `send_transaction` calls makes the next `pair_tron_ledger` fail with "device busy".

### Decision lock — Phase 18 transport addition

```typescript
// In src/wallet/ledger-tron-transport.ts (additive)
export async function signTronTransaction(input: {
  derivationPath?: string;     // defaults to DEFAULT_TRON_DERIVATION_PATH
  rawTxHex: string;
}): Promise<{ signatureHex: string }> {
  const transport = await openTransport();
  try {
    const app = _transport.buildTrxApp(transport);
    try {
      await app.getAppConfiguration();   // assert TRON app is open
    } catch {
      throw new LedgerTronAppNotOpenError();
    }
    const signatureHex: string = await app.signTransaction(
      input.derivationPath ?? DEFAULT_TRON_DERIVATION_PATH,
      input.rawTxHex,
      [],
    );
    return { signatureHex };
  } finally {
    try { await transport.close(); } catch (e) { log("warn", `transport.close() failed: ${(e as Error)?.message}`); }
  }
}
```

`[VERIFIED: @ledgerhq/hw-app-trx installed .d.ts + JS source at /tmp/tron-probe-18/node_modules/@ledgerhq/hw-app-trx/lib-es/Trx.{d.ts,js}]`.

## § Topic 9: TRX-vs-TRC-20 fingerprint distinctness (cross-discriminator)

### Verdict — same domain tag, distinct inner bytes

Both `TransferContract` (native TRX) and `TriggerSmartContract` (TRC-20) share the outer `raw_data_hex` envelope (`raw_data.contract[0].type` is the inner discriminator). The same domain tag `"VaultPilot-trontx-v1:"` covers both because:

- Inner `raw_data_hex` bytes ALWAYS differ between the two contract types — the `type_url` field (`type.googleapis.com/protocol.TransferContract` vs `protocol.TriggerSmartContract`) is part of `raw_data_hex` itself.
- Probe 5 confirmed: native_fp `0x1dd7daca…` vs trc20_fp `0x3dad5cd7…` — distinct.

### Decision lock — single tag covers both inner types

```typescript
export const FINGERPRINT_DOMAIN_TAG_TRON = "VaultPilot-trontx-v1:";  // 21 UTF-8 bytes

// Same function handles both — discriminator-blind by design:
computeTronPayloadFingerprint({ rawDataHex });
```

The CHECKS PERFORMED block surfaces the discriminator separately:

```
DECODED ARGS (TRON — TransferContract — native TRX transfer)
  contract type:    TransferContract
  to:               TLa2f6VPqDgRE67v1736s7bJ8Ray5wYjU7  (base58check)
  to (hex):         4174472e7d35395a6b5add427eecb7f4b62ad2b071  (Protobuf envelope form)
  sun:              1000000                                 (= 1 TRX)
```

```
DECODED ARGS (TRON — TriggerSmartContract — TRC-20 transfer)
  contract type:    TriggerSmartContract
  contract:         TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t  (USDT-TRC20)
  selector:         0xa9059cbb                          (transfer(address,uint256))
  to:               TLa2f6VPqDgRE67v1736s7bJ8Ray5wYjU7  (base58check; decoded from calldata)
  to (hex calldata): 74472e7d35395a6b5add427eecb7f4b62ad2b071  (EVM-form 20 bytes, no 0x41 prefix)
  amount:           1000000                              (raw; 1 USDT @ 6 decimals)
  feeLimit:         100000000 sun                        (= 100 TRX)
```

### Critical: TRC-20 calldata address has NO `0x41` prefix

Confirmed in probe 2: calldata `to` is `74472e7d35395a6b5add427eecb7f4b62ad2b071` (20 bytes, EVM-form). The Protobuf-envelope `to_address` (in TransferContract) is `4174472e7d35395a6b5add427eecb7f4b62ad2b071` (21 bytes, TRON-form with `0x41` prefix). **Address-format-fanout regression risk** — Phase 18 protocols MUST use `tronWeb.address.toHex()` for both layers and let tronweb strip the prefix in calldata contexts. Phase 17 Pitfall 4 already flagged this; Phase 18 inherits the same discipline.

`[VERIFIED: live probe 2 calldata inspection]`.

## § Topic 10: FROZEN-area discipline + module layout

### FROZEN modules (read-only for Phase 18; byte-untouched at test time)

| Module | Why FROZEN | Phase 18 strategy |
|---|---|---|
| `src/signing/payload-fingerprint.ts` | EVM preimage shape is the v1.x trust anchor; Fixtures A-H must stay green | NEW sibling `src/signing/payload-fingerprint-tron.ts` |
| `src/signing/payload-fingerprint-solana.ts` | Solana preimage shape; Fixtures I+J must stay green | NEW sibling `src/signing/payload-fingerprint-tron.ts` (third sibling) |
| `src/signing/presign-hash.ts` | EIP-1559 RLP wrapping; viem-coupled; EVM-frozen | NEW sibling `src/signing/presign-hash-tron.ts` (SHA-256 of raw_data bytes) |
| `src/signing/presign-hash-solana.ts` | Solana SHA-256 of messageBytes; FROZEN | NEW sibling `src/signing/presign-hash-tron.ts` |
| `src/signing/simulation.ts` | EVM advisory simulation; FROZEN | NEW sibling `src/signing/simulation-tron.ts` (advisory; TRC-20 only) |
| `src/signing/simulation-solana.ts` | Solana mandatory simulation classifier; FROZEN | NEW sibling `src/signing/simulation-tron.ts` |
| `src/signing/blocks.ts` | EVM template strings byte-frozen | APPEND-ONLY new templates in NEW `src/signing/blocks-tron.ts` |
| `src/signing/blocks-solana.ts` | Solana templates byte-frozen | NEW sibling `src/signing/blocks-tron.ts` |
| `src/signing/amount.ts` (EVM `parseAmountStrict`) | FROZEN | NEW sibling `src/signing/amount-tron.ts` (`parseTronAmountStrict`) |
| `src/signing/amount-solana.ts` | FROZEN | NEW sibling `src/signing/amount-tron.ts` |
| `src/signing/handle-store.ts` | State machine + EVM `PreparedTxEvm` + Solana `PreparedTxSolana` shapes FROZEN; widening is ADDITIVE | EXTEND additively — add `PreparedTxTron` arm; widen `PreparedTx` union (mirrors Phase 12 Plan 12-01) |
| `src/tools/send_transaction.ts` | Three-gate region byte-frozen; EVM + Solana dispatch FROZEN | EXTEND additively — append `if (txType === "tron")` branch AFTER the Solana branch; sub-handler in NEW `src/tools/send_transaction_tron.ts` |
| `src/tools/preview_send.ts` | EVM + Solana branches FROZEN | EXTEND additively — append `if (txType === "tron")` dispatch to `previewTronTx(record)` after the Solana branch |
| `src/security/canonical-dispatch.ts` | EVM `CANONICAL_DISPATCH_TARGETS` table byte-frozen; Solana arm FROZEN | TRON arm DEFERS to Phase 19 (SunSwap V2 router + LiFi facet); Phase 18 native + canonical TRC-20 transfers BYPASS Layer 0.5 (universally-trusted contracts) |
| `src/protocols/solana-*.ts` | Phase 12 protocol encoders FROZEN | NEW sibling files in `src/protocols/tron-*.ts` |
| `src/wallet/ledger-solana-transport.ts` | Phase 11/12 transport FROZEN | EXTEND additively `src/wallet/ledger-tron-transport.ts` — Phase 17 already shipped `fetchTronAddress`; Phase 18 adds `signTronTransaction` to the SAME file |
| Fixture pinning files (`test/signing-fingerprint.test.ts` + `test/signing-fingerprint-solana.test.ts`) | FROZEN | NEW `test/signing-fingerprint-tron.test.ts` (sibling file — namespace separation, mirrors Phase 12 OQ-2 resolution) |

### NEW Phase 18 modules

| File | Purpose |
|---|---|
| `src/signing/payload-fingerprint-tron.ts` | `FINGERPRINT_DOMAIN_TAG_TRON = "VaultPilot-trontx-v1:"` + `computeTronPayloadFingerprint({ rawDataHex }) → keccak256(tag ‖ bytes)` |
| `src/signing/presign-hash-tron.ts` | `computeTronPresignHash(rawDataHex: string): { presignHash: Hex }` — `sha256(Buffer.from(rawDataHex, "hex"))` matches device hash byte-for-byte |
| `src/signing/simulation-tron.ts` | `runTronPreviewSimulation({ tw, tx, contractAddress, functionSelector, parameters, from }) → { status: "ok" | "revert" | "error" | "skipped" | "rate-limited"; energyUsed, reason, constantResult }`; `_simulationTron` indirection; ADVISORY-only (consumer surfaces but does NOT refuse) |
| `src/signing/amount-tron.ts` | `parseTronAmountStrict(amountStr: string, decimals: number): bigint` — mirror of `parseAmountStrict` + `parseSolanaAmountStrict`; decimal-string-at-the-boundary; fractional-overflow refuses |
| `src/signing/blocks-tron.ts` | All TRON template strings — `PREPARE_RECEIPT_TRON_NATIVE_TEMPLATE`, `PREPARE_RECEIPT_TRON_TRC20_TEMPLATE`, `LEDGER_BLIND_SIGN_HASH_TRON_TEMPLATE`, `LEDGER_NOTICE_TRON_BLIND_SIGN_TEMPLATE`, `SIMULATION_BLOCK_TRON_TEMPLATE`, `VERIFY_BEFORE_SIGNING_TRON_TEMPLATE` |
| `src/protocols/tron-native.ts` | `encodeTronNativeTransfer({ to, sun, from, blockHeader }) → Transaction<TransferContract>` — thin wrapper around `tw.transactionBuilder.sendTrx` |
| `src/protocols/tron-trc20.ts` | `encodeTronTrc20Transfer({ tokenAddress, to, amount, from, blockHeader, feeLimit }) → Transaction<TriggerSmartContract>` — thin wrapper around `tw.transactionBuilder.triggerSmartContract`; ATA-equivalent NOT needed (TRC-20 is account-based, not ATA-based like SPL) |
| `src/protocols/tron-address.ts` | `tronAddressToProtobufHex(base58: string): string` (returns `0x41…` 21-byte hex); helper centralization for the Phase 17 Pitfall 4 regression |
| `src/tools/prepare_tron_native_send.ts` | MCP tool — TRON-W-01; resolves paired account; pins blockHeader; encodes via protocol; persists handle |
| `src/tools/prepare_tron_trc20_send.ts` | MCP tool — TRON-W-02; same shape; resolves decimals via `get_tron_token_metadata` |
| `src/tools/send_transaction_tron.ts` | Internal sub-handler imported by `send_transaction.ts` (mirror of `send_transaction.ts:sendTransactionSolanaBranch`) |
| `test/signing-fingerprint-tron.test.ts` | NEW Fixture K + L literal anchors (per CLAUDE.md fixture discipline) |
| `test/tron-trust-pipeline.integration.test.ts` | Persona-cycle byte-identity test |
| `src/wallet/ledger-tron-transport.ts` | EXTEND additively — Phase 17 already shipped `fetchTronAddress`; Phase 18 adds `signTronTransaction` |

### handle-store.ts widening (additive, mirrors Plan 12-01)

```typescript
// In handle-store.ts (additive):
export interface PreparedTxTron {
  txType: "tron";                       // required discriminator

  // ---------------------------------------------------------------------
  // EVM-shape sentinel fields (mirror PreparedTxSolana convention) —
  // present so the discriminated union is accessible to existing
  // EVM-side consumers without forcing narrowing at every site.
  // ---------------------------------------------------------------------
  chainId: 0;                           // TRON has no EVM chainId concept
  to: "0x0000000000000000000000000000000000000000";
  valueWei: 0n;
  data: "0x";
  // ---------------------------------------------------------------------
  // TRON-specific cryptographic-binding fields
  // ---------------------------------------------------------------------
  rawDataHex: string;                    // Transaction.raw_data_hex — preimage for both
                                          //   payloadFingerprint AND presignHash
  txID: string;                          // tronweb-computed txID = sha256(rawDataHex);
                                          //   useful for cross-check at preview
  blockHeader: {
    ref_block_bytes: string;
    ref_block_hash: string;
    timestamp: number;
    expiration: number;                  // pinned at prepare; advisory for user
  };
  contractType: "TransferContract" | "TriggerSmartContract";   // inner discriminator
  instructionSummary?: TronInstructionSummary;                 // for DECODED ARGS surface
}

export type TronInstructionSummary =
  | { kind: "native-transfer"; from: string; to: string; sun: bigint }
  | { kind: "trc20-transfer"; tokenAddress: string; from: string; to: string;
      amount: bigint; decimals: number; feeLimit: bigint };

export type PreparedTx = PreparedTxEvm | PreparedTxSolana | PreparedTxTron;
```

And `PrepareArgs` widens additively with TRON fields:

```typescript
export interface PrepareArgs {
  // ... existing EVM + Solana fields (UNCHANGED) ...

  // Phase 18 TRON fields (all optional — TRON callers populate these,
  // EVM + Solana callers populate their own):
  sun?: string;                         // native TRX amount as decimal sun string
  trc20Amount?: string;                 // TRC-20 amount as decimal-human-units string;
                                         //   server resolves decimals via metadata
                                         // (NOT named `amount` to avoid collision with
                                         //  EVM's `amount` field which carries different
                                         //  semantics for ERC-20 vs LP-add etc.; use a
                                         //  TRON-distinct name to keep PrepareArgs as
                                         //  the verbatim agent-string store).
}
```

### Plan-checker assertions

- Zero diff against `src/signing/payload-fingerprint.ts`, `src/signing/payload-fingerprint-solana.ts`
- Zero diff against `src/signing/presign-hash.ts`, `src/signing/presign-hash-solana.ts`
- Zero diff against `src/signing/blocks.ts`, `src/signing/blocks-solana.ts`
- Zero diff against `src/signing/amount.ts`, `src/signing/amount-solana.ts`
- Zero diff against `src/signing/simulation.ts`, `src/signing/simulation-solana.ts`
- Zero diff against `src/signing/canonical-dispatch.ts` (TRON arm deferred to Phase 19)
- Zero diff against `src/protocols/solana-*.ts`
- `src/wallet/ledger-tron-transport.ts` — additive only (Phase 17 surface preserved byte-for-byte)
- `src/signing/handle-store.ts` — additive only (no deletion of `PreparedTxEvm`/`PreparedTxSolana` shapes)
- `src/tools/preview_send.ts` + `src/tools/send_transaction.ts` — additive only (existing branches byte-frozen; TRON branch appended)

### Fixture discipline (CLAUDE.md non-negotiable)

NEW test file `test/signing-fingerprint-tron.test.ts` carries Fixture K + Fixture L as hardcoded `0x…` literals:

```typescript
// Fixture K — native TRX transfer fingerprint
//   to = "TLa2f6VPqDgRE67v1736s7bJ8Ray5wYjU7"
//   from = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t"
//   sun = 1_000_000n (= 1 TRX)
//   blockHeader = TRON_FIXTURE_BLOCK_HEADER (pinned constant)
it("Fixture K — native TRX transfer fingerprint (hardcoded literal anchor)", () => {
  const fp = computeTronPayloadFingerprint({ rawDataHex: NATIVE_FIXTURE_RAW_DATA_HEX });
  expect(fp).toBe("0x<computed-at-execute-time-and-pinned>");
  expect(FINGERPRINT_DOMAIN_TAG_TRON.length).toBe(21);          // byte-length pin
});

// Fixture L — TRC-20 transfer(address,uint256) fingerprint
//   tokenAddress = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t"  (USDT-TRC20 mainnet)
//   to = "TLa2f6VPqDgRE67v1736s7bJ8Ray5wYjU7"
//   from = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t"
//   amount = 1_000_000n (1 USDT @ 6 dec)
//   feeLimit = 100_000_000n (= 100 TRX)
//   blockHeader = TRON_FIXTURE_BLOCK_HEADER (pinned)
it("Fixture L — TRC-20 transfer fingerprint (hardcoded literal anchor)", () => {
  const fp = computeTronPayloadFingerprint({ rawDataHex: TRC20_FIXTURE_RAW_DATA_HEX });
  expect(fp).toBe("0x<computed-at-execute-time-and-pinned>");
});

// Distinctness assertion — cross-chain fingerprint reuse impossible at preimage level
it("Phase 18 fingerprints disjoint from EVM (A-H) + Solana (I-J)", () => {
  const fpK = computeTronPayloadFingerprint({ rawDataHex: NATIVE_FIXTURE_RAW_DATA_HEX });
  expect(EVM_FIXTURES_FINGERPRINTS).not.toContain(fpK);
  expect(SOLANA_FIXTURES_FINGERPRINTS).not.toContain(fpK);
});
```

NO `beforeAll`-snapshot. NO self-referencing assertions. Cross-link from `prepare_tron_native_send.test.ts` + `prepare_tron_trc20_send.test.ts` consumer tests so a drift in preimage assembly fires at a specific line.

**Persona-cycle integration test:** NEW `test/tron-trust-pipeline.integration.test.ts` re-anchors byte-identity across persona swaps. Both native TRX AND TRC-20 are SENDER-DEPENDENT (owner_address embeds in raw_data_hex Protobuf-envelope layer for both — sender swap → different fingerprint). Pattern matches Phase 7 Aave `T-INTEGRATION-FROM-DRIFT-2` + Phase 12 Solana persona-cycle test.

`[VERIFIED: existing Phase 12 module layout at src/signing/*-solana.ts as the precedent]`.

## Decision Locks Summary (DF-1 through DF-4)

| DF | Locked | Rationale |
|---|---|---|
| **DF-1** | `payloadFingerprint = keccak256("VaultPilot-trontx-v1:" ‖ Buffer.from(Transaction.raw_data_hex, "hex"))` | `raw_data_hex` is the canonical Protobuf-serialized bytes the network signs AND the Ledger TRX app SHA-256s; tronweb produces them deterministically via tronweb's internal Protobuf encoder; verified `sha256(raw_data_hex) === Transaction.txID` |
| **DF-2** | Emit `LEDGER BLIND-SIGN HASH (TRON)` block UNCONDITIONALLY; SHA-256 form | Empirically confirmed via `LedgerHQ/app-tron/src/handlers/sign.c::cx_hash_no_throw((cx_hash_t *) &txContext.sha2, ...)` where `sha2` is `cx_sha256_t` (parse.h:112). Hash is signed regardless of which display flow (clear-sign or blind-sign) fires |
| **DF-3** | Pin `blockHeader.{ref_block_bytes, ref_block_hash, timestamp, expiration}` at prepare time; default 1-hour expiration window (override tronweb's 60-second default) | tronweb default expiration = 60s — too short for prepare → preview → device-approval → send. 1 hour = TRON consensus ref-block window. Pinning blockHeader is REQUIRED for fingerprint stability (otherwise `getCurrentRefBlockParams` re-derives non-deterministic ref-block + timestamp between prepare and any send-time recompute) |
| **DF-4** | `triggerconstantcontract` at preview is ADVISORY (not refusal); TRC-20 only; native TRX SKIPS simulation | TRON's simulation surface has high false-revert rate + free-tier rate limits + no native-TRX simulation API. Refusal posture would degrade UX disproportionately. The broadcast endpoint surfaces revert clearly via `BroadcastReturn.code = CONTRACT_EXE_ERROR` — second-line catch at send time |

## Architecture Patterns

### System Architecture Diagram (TRON branch — Phase 18 surface)

```
agent (Claude Code / Cursor / Desktop)
   │  stdio  (MCP protocol)
   ▼
vaultpilot-mcp                                    (this codebase)
   │
   ├── prepare_tron_native_send / prepare_tron_trc20_send   ───┐
   │       │                                                    │
   │       │  reads paired account (non-evm-account-store)     │  PREPARE
   │       │  resolves blockHeader (_tronRegistry.getTronWeb.trx.getCurrentRefBlockParams)
   │       │  pin expiration = timestamp + 60*60*1000 ms (1 hour)
   │       │  encode via tw.transactionBuilder.{sendTrx, triggerSmartContract}
   │       │  → Transaction.raw_data_hex (Protobuf bytes)
   │       │  computeTronPayloadFingerprint(rawDataHex) — keccak256(domain ‖ bytes)
   │       │  persist HandleRecord with PreparedTxTron + payloadFingerprint
   │       │
   ├── preview_send (TRON branch — additive after Solana branch)
   │       │
   │       │  Layer 0.5 — canonical-dispatch (TRON arm DEFERRED to Phase 19)
   │       │  Layer 0.7 — simulation-tron (TRC-20 ADVISORY / TRX SKIPPED)
   │       │  Layer 1   — handle-store lookup + status gate (FROZEN)
   │       │  Layer 2   — chain-mismatch (N/A for TRON)
   │       │  emit DECODED ARGS + CHECKS PERFORMED + LEDGER BLIND-SIGN HASH + VERIFY BEFORE SIGNING
   │       │  computeTronPresignHash(rawDataHex) — sha256(bytes) — same bytes as fingerprint
   │       │  transitionToPreviewed(handle, { previewToken, presignHash, ... })
   │       │
   ├── send_transaction (TRON branch — additive after Solana branch)
   │       │
   │       │  Layer 1   — handle lookup + status === "previewed" (FROZEN)
   │       │  Layer 2   — previewToken match (FROZEN)
   │       │  Layer 3   — userDecision schema gate (FROZEN)
   │       │  Layer 4   — payloadFingerprint drift recompute (sibling-additive — TRON arm)
   │       │  USB-HID:
   │       │    - openTransport → buildTrxApp → getAppConfiguration
   │       │    - app.signTransaction(path, rawDataHex, []) → 65-byte hex signature
   │       │    - tw.trx.sendRawTransaction({ ...preparedTx, signature: [sigHex] })
   │       │    - returns BroadcastReturn { result, txid, code, message }
   │       │  transitionToSent(handle, txid)
   │
   │  USB-HID  (Ledger TRX app v0.3.0+)
   ▼
Ledger device                                     (the only trusted display)
   │  receives rawTxHex over chunked APDU
   │  SHA-256 hashes incrementally (cx_hash_no_throw → cx_sha256_t)
   │  parses Protobuf raw_data on-device for clear-sign display
   │  → TransferContract: shows "To", "Amount" in TRX
   │  → TriggerSmartContract method 1: shows "Asset" (token), "To", "Amount"
   │  → other: requires SIGN_BY_HASH setting; shows raw 64-hex-char hash
   │  user approves → device returns 65-byte secp256k1 signature (recoverable form)
```

The trust boundary is the Ledger screen. Phase 18 cryptographic binding: agent passes args → server stores raw args + computes `payloadFingerprint(raw_data_hex)` at prepare → re-checks at send → device SHA-256s the SAME bytes → user matches device-display hash against `LEDGER BLIND-SIGN HASH (TRON)` block AT preview time.

### Pattern 1: Sibling-additive module convention (sibling of v2.0 Solana)

**What:** every Phase 18 module is a NEW file in `src/signing/`, `src/protocols/`, `src/tools/` parallel to the existing v1.x (EVM) + v2.0 (Solana) siblings.

**When to use:** all Phase 18 work. No exception.

**Example:** `src/signing/payload-fingerprint-tron.ts` parallel to `src/signing/payload-fingerprint-solana.ts` parallel to `src/signing/payload-fingerprint.ts` (EVM). All three implement the same shape (domain tag + bytes-of-the-preimage + keccak256) — only the preimage source differs.

### Pattern 2: Discriminator dispatch at preview_send + send_transaction tail

**What:** existing branches (EVM, Solana) stay byte-frozen. Phase 18 appends `if (txType === "tron")` checks AFTER the Solana branch returns / dispatches.

**Example:**

```typescript
// In send_transaction.ts, additive after existing solana dispatch:
if (txType === "solana") {
  return await sendTransactionSolanaBranch(record, handleArg);
}
if (txType === "tron") {                       // NEW Phase 18
  return await sendTransactionTronBranch(record, handleArg);
}
// ===== EVM branch (FROZEN — DEMO-05 + WC routing unchanged) =====
```

### Pattern 3: Blockheader pinning for fingerprint stability

**What:** capture `ref_block_bytes`, `ref_block_hash`, `timestamp`, `expiration` once at prepare time; reuse the same values for all later re-derivations (preview-time hash recompute, send-time fingerprint drift check).

**When to use:** any tronweb prepare call. Without pinning, `getCurrentRefBlockParams` re-derives different values and the fingerprint shifts.

**Example:** Topic 3 above.

### Anti-Patterns to Avoid

- **Hand-rolling Protobuf TransferContract / TriggerSmartContract encoding.** tronweb does it. CLAUDE.md "Don't hand-roll" non-negotiable.
- **Using `signTransactionHash` to bypass the Ledger's clear-sign UI.** The device shows only the hash; user loses decoded-args verification. Use `signTransaction(path, rawDataHex, [])` exclusively.
- **Embedding `0x41`-prefixed addresses in TRC-20 calldata.** Calldata uses EVM-form 20-byte addresses; only Protobuf envelope uses `0x41`-prefixed 21-byte form. tronweb handles the boundary; don't mix.
- **Refusing on `triggerconstantcontract` revert in preview.** TRON simulation is advisory (DF-4). Refusing on revert blocks legitimate flows where the simulation's state model differs from the broadcast state.
- **Letting tronweb's default 60-second `expiration` reach the user.** Pin to 1 hour at prepare.
- **Trusting the Ledger TRX-app `getAppConfiguration()` `signByHash` bool as the blind-sign indicator.** Tx shape determines clear-sign vs blind-sign on-device (see `sign.c` switch on `contractType`); `signByHash` is the user's settings-side enable. Phase 18 emits the hash block unconditionally so the device flow doesn't matter to the trust anchor.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---|---|---|---|
| Protobuf TransferContract encoding | Manual `protobufjs` schema + `owner_address` + `to_address` + `amount` byte layout | `tw.transactionBuilder.sendTrx(to, sun, from, { blockHeader })` | tronweb maintains the wire-format-canonical Protobuf; field-order shifts upstream would silently break a hand-rolled encoder |
| Protobuf TriggerSmartContract encoding + ABI calldata | Manual `abi-coder` for `transfer(address,uint256)` selector + 32-byte-padded args | `tw.transactionBuilder.triggerSmartContract(contract, selector, options, params, from)` | Selector hash + calldata padding correct under tronweb; Topic 5 verified the produced calldata matches the EVM-compatible TRC-20 `0xa9059cbb...` shape |
| ABI selector hash (`keccak256("transfer(address,uint256)")[:4]`) | viem `toFunctionSelector` | tronweb's built-in selector hashing inside `triggerSmartContract` | tronweb already hashes; no separate viem call needed |
| TRON address base58check ↔ hex | Manual base58check encode + `0x41` prefix | `tronWeb.utils.address.toHex` / `fromHex` / `isAddress` | Phase 17 lock; Pitfall 4 |
| Decimal-aware amount parsing | Manual `parseFloat` + `* 10^decimals` | `parseTronAmountStrict(str, decimals): bigint` (NEW, mirror of `parseAmountStrict` + `parseSolanaAmountStrict`) | Float arithmetic loses precision; raw-units bigint at boundary |
| SHA-256 of raw_data | `crypto-js` / `noble-hashes` | `node:crypto.createHash("sha256")` | Stdlib; byte-for-byte matches the Ledger TRX-app on-device hash (per `parse.h:112` cx_sha256_t) |
| Recover-id (v) extraction from signature | Manual `signature[64]` byte slicing | `signTransaction` returns the full 65-byte recoverable form; just store as-is | Tron's `SignedTransaction.signature: string[]` accepts the full 130-hex-char signature verbatim |
| feeLimit calculation | Live energy-estimate via `estimateEnergy` then multiply | Pin a conservative `100_000_000` sun (100 TRX) default | `estimateEnergy` adds an RPC round-trip per prepare + the v1.x scope is canonical TRC-20 transfers; 100 TRX is far above typical actual cost |
| Broadcast retry / backoff | Custom `setTimeout` loop on `result.code === SERVER_BUSY` | Single broadcast; let user retry by re-running `send_transaction` (handle is in `sent` state on success only) | Retry on a half-succeeded broadcast risks double-broadcast (`DUP_TRANSACTION_ERROR`); user-driven retry preserves the single-send invariant |

**Key insight:** TRON's wire-format complexity (Protobuf envelope, EVM-compatible calldata, base58check + `0x41`-prefixed-hex address dance, multi-sig signature array, 65-byte recoverable signatures) makes hand-rolling a 500+-line accident waiting to happen. tronweb is the canonical SDK — adopt it wholly. The Phase 17 SDK-adoption decision is final.

## Common Pitfalls

### Pitfall 1: tronweb default `expiration = timestamp + 60s` reaches the user
**What goes wrong:** `prepare_tron_native_send` returns a handle; user takes 90 seconds to read the preview + approve on Ledger; `send_transaction` broadcasts; receives `BroadcastReturn.code = TRANSACTION_EXPIRATION_ERROR (8)`. User has to re-prepare from scratch.
**Why it happens:** tronweb's `getCurrentRefBlockParams` defaults `expiration` to `timestamp + 60_000` ms; without `blockHeader.expiration` override, that value flows into `raw_data.expiration`.
**How to avoid:** Pin `expiration = timestamp + 60 * 60 * 1000` (1 hour) explicitly at prepare time. Surface `expiresAt: <ISO8601>` in PREPARE RECEIPT so the user sees the deadline.
**Warning signs:** PREPARE RECEIPT shows no `expiresAt` line; or a prepared handle ages past 60s in tests without explicit `blockHeader.expiration` override.

### Pitfall 2: Same `(to, amount, from)` builds non-deterministic `raw_data_hex` between calls
**What goes wrong:** `payloadFingerprint` at prepare differs from re-derivation at send. PAYLOAD_FINGERPRINT_DRIFT refusal fires on legitimate flows.
**Why it happens:** Without `blockHeader` override, tronweb re-fetches a fresh `getCurrentRefBlockParams` per call (probe 6+7 confirmed). New timestamp + new ref-block bytes → new `raw_data_hex`.
**How to avoid:** ALWAYS pin `blockHeader` at prepare time. Store the pinned `blockHeader` in `PreparedTxTron`. Send-time re-derivation reads the stored blockHeader.
**Warning signs:** A prepare-tool function body that doesn't call `getCurrentRefBlockParams` itself + pin the result before passing to `sendTrx` / `triggerSmartContract`.

### Pitfall 3: TRC-20 calldata embeds 20-byte EVM-form addresses; Protobuf envelope embeds 21-byte TRON-form
**What goes wrong:** A DECODED ARGS surface displays the calldata `to` as a `0x41`-prefixed hex (`4174472e...`) but the actual calldata holds the EVM form (`74472e...`). User reads a different hex than what tronweb actually wrote. Latent risk: the user's on-device-hash compare passes but the displayed-to differs subtly from the actually-encoded-to.
**Why it happens:** Two layers; two address forms; the boundary lives inside tronweb.
**How to avoid:** Use `tronWeb.address.toHex(base58)` for Protobuf-envelope addresses (gives `0x41`-prefixed 21-byte form). For DECODED ARGS surfacing of calldata addresses, decode the calldata via `tw.utils.abi.decodeParams(...)` or extract via known offset; the decoded `address` should be the EVM-form 20-byte hex. Display BOTH forms to the user — base58check (T-prefixed) is the canonical user-facing form; the hex form is debug-only.
**Warning signs:** Any helper that pads or strips a leading `41` byte without going through `tronWeb.utils.address`.

### Pitfall 4: `triggerconstantcontract` for TRC-20 transfer simulation false-reverts
**What goes wrong:** Preview gate calls `triggerConstantContract(USDT, "transfer(address,uint256)", {}, [...], from)`. The simulation REVERTs (probe 4 above). If Phase 18 had adopted MANDATORY refusal posture, preview would refuse on what is actually a legitimate flow.
**Why it happens:** `triggerconstantcontract` re-executes against the `from` address's actual on-chain state; if `from` has 0 USDT balance OR if the on-chain state differs from `from`'s expected state at broadcast time (between-block updates), revert.
**How to avoid:** DF-4 ADVISORY posture. Surface revert reason verbatim in CHECKS PERFORMED but DO NOT refuse. The user retains the on-device hash match as the trust anchor.
**Warning signs:** A `preview_send` TRON branch that returns an `errEnvelope("TRON_SIMULATION_REVERT", ...)` — that's the rejected DF-4 Option A.

### Pitfall 5: TronGrid free-tier rate limit (HTTP 429) on the 6th preview call
**What goes wrong:** Aggressive user previews 6+ times in 10 seconds (e.g. flipping between `prepare → preview → cancel → prepare → preview` repeatedly to tune args). 6th preview call to `triggerconstantcontract` returns HTTP 429. If preview refused on RPC-error, the user is unblocked.
**Why it happens:** `api.trongrid.io` free tier ≈ 5 req/sec per IP (probe 6 confirmed).
**How to avoid:** Simulation classifier (`runTronPreviewSimulation`) maps HTTP 429 → `status: "rate-limited"`; consumer surfaces in CHECKS PERFORMED as advisory; does NOT refuse. For sustained-volume users, `TRON_RPC_URL` env override → private RPC provider (TronGrid paid tier, Quicknode, GetBlock).
**Warning signs:** A `status: "rate-limited"` case that flows into a refusal envelope instead of an advisory block.

### Pitfall 6: `signTransaction` returns hex without `0x` prefix; `tronweb` `SignedTransaction.signature[0]` expects unprefixed hex
**What goes wrong:** Phase 18 prepends `0x` to the device signature; `tw.trx.sendRawTransaction` rejects with `SIGERROR (1)`.
**Why it happens:** `@ledgerhq/hw-app-trx::signTransaction` returns `response.slice(0, 65).toString("hex")` (line 170 in `Trx.js`) — unprefixed. Tronweb's `signature: string[]` convention is also unprefixed hex.
**How to avoid:** Attach the signature verbatim: `signedTx.signature = [signatureHex]` (no `0x` prefix). The 130 hex chars are the canonical wire form.
**Warning signs:** Any string-manipulation on the device-returned signature before attaching to `signedTx`.

### Pitfall 7: `signTransaction` 3rd arg `tokenSignatures` confused with the doc-example's `105` literal
**What goes wrong:** Phase 18 plan author copies the doc-example literal `signTransaction("44'/195'/0'/0/0", "0a02f594...", [], 105)` and assumes the 4th arg is needed. Typescript compilation refuses; runtime call with the 4th arg silently ignored.
**Why it happens:** `Trx.d.ts:37` example shows a stale 4-arg form from an older version; the TYPED signature has only 3 args (`Trx.d.ts:39`). Reading `Trx.js:110-174` confirms only 3 are consumed.
**How to avoid:** TYPE-CHECK call sketches against the installed `.d.ts` (CLAUDE.md SDK Scope-Probing Discipline). Always call `signTransaction(path, rawTxHex, [])` with empty `tokenSignatures` for TRX-native + canonical-TRC-20 paths.
**Warning signs:** A `signTransaction(...)` call with 4 args (or a non-empty `tokenSignatures` array unless explicit TRC-10 token-signature flow).

### Pitfall 8: feeLimit too low → `CONTRACT_VALIDATE_ERROR` at broadcast
**What goes wrong:** Phase 18 defaults `feeLimit` to 1 TRX = 1_000_000 sun; broadcast rejects because TRC-20 transfer needs ~15-30 TRX of energy budget.
**Why it happens:** TRON's energy model burns TRX for smart-contract execution; `feeLimit` is the user's maximum-burn budget. Without sufficient budget, validation refuses pre-execution.
**How to avoid:** Default `feeLimit = 100_000_000` sun (= 100 TRX) — far above typical actual cost (15-30 TRX). Surface in PREPARE RECEIPT so user sees the cap.
**Warning signs:** A `feeLimit` constant lower than ~50_000_000 sun in `prepare_tron_trc20_send.ts`.

### Pitfall 9: Forgetting `expiration` advisory at preview leads to expired-broadcast surprise
**What goes wrong:** User reads preview, walks away, comes back 65 minutes later, says "send"; broadcast fails with `TRANSACTION_EXPIRATION_ERROR (8)`. No prior warning.
**Why it happens:** Phase 18 doesn't enforce the 1-hour deadline at preview (the handle's 15-min TTL is independent; the on-chain expiration is separate).
**How to avoid:** Surface `expiresAt: <ISO8601>` in PREPARE RECEIPT + VERIFY BEFORE SIGNING block. Phase 18 `send_transaction` MAY add a pre-broadcast check `if (Date.now() > preparedTx.blockHeader.expiration)` → refuse with `TRON_TX_EXPIRED` errorCode — recommended addition (lightweight; catches the issue server-side before broadcast).
**Warning signs:** No `expiresAt` surface in PREPARE RECEIPT; no pre-broadcast expiration check in `send_transaction_tron.ts`.

### Pitfall 10: ESM-spy-affordance gap on cross-export internal calls
**What goes wrong:** `vi.spyOn(tronFingerprintModule, "computeTronPayloadFingerprint")` silently no-ops because ESM named-export bindings are immutable.
**How to avoid:** Phase 18 modules carry `_tronFingerprint`, `_tronPresign`, `_tronProtocols`, `_simulationTron`, `_tronAmount` indirection objects per CLAUDE.md convention. Add at write time, not retroactively.
**Warning signs:** A `vi.spyOn` on a Phase 18 module that returns 0 call-counts in tests where the underlying flow definitively fires.

## Runtime State Inventory

| Category | Items Found | Action Required |
|----------|-------------|-----------------|
| Stored data | None — Phase 17 already established `non-evm-account-store.ts` with `chain: "tron"` records; Phase 18 reads-only from that store (per `record.address` for the paired account's TRON base58check). No new persistent state. | None |
| Live service config | None — TronGrid endpoint URL is env-resolved at startup (`TRON_RPC_URL` → fallback `https://api.trongrid.io`). No service config outside the repo. | None |
| OS-registered state | None | None |
| Secrets / env vars | `TRON_RPC_URL` already declared in Phase 17 `src/config/env.ts`. Phase 18 adds NO new env vars. | None |
| Build artifacts | tronweb (`6.3.0`) + `@ledgerhq/hw-app-trx` (`6.36.1`) already in `package.json` (Phase 17 install). Confirmed via `grep -E "tronweb\|hw-app-trx" package.json`. **NO new installs.** | None |

**Nothing found in any category beyond Phase 17's already-shipped scope.** Phase 18 is purely additive code + tests against an already-instrumented dependency set.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| tronweb | All Phase 18 flows | ✓ | 6.3.0 | — |
| @ledgerhq/hw-app-trx | USB-HID signing | ✓ | 6.36.1 | — |
| @ledgerhq/hw-transport-node-hid | USB-HID transport | ✓ | 6.33.2 (Phase 11) | — |
| TronGrid endpoint | RPC reads + simulation | ✓ live probe 2026-05-20 | n/a | `TRON_RPC_URL` env override → private RPC provider |
| LedgerHQ/app-tron firmware | On-device signing | n/a — runtime user-installed | v0.3.0+ (clear-sign coverage) | None — phase requires real device for full e2e |
| Node.js crypto (stdlib SHA-256) | Blind-sign hash recompute | ✓ | Node ≥ 18.17 | — |
| viem keccak256 / toBytes | payloadFingerprint binding | ✓ | (v1.x) | — |

**Missing dependencies with no fallback:** None for Phase 18 code work. Real-Ledger smoke testing requires a physical device + TRON app installed; verify-phase only.

**Missing dependencies with fallback:** TronGrid free-tier 429-rate-limit → planner adds env-override note in the prepare-tools' MCP descriptions.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest ≥ 3.2.4 (v1.x lock) |
| Config file | `vitest.config.ts` at repo root |
| Quick run command | `npx vitest run test/signing-fingerprint-tron.test.ts -t "Fixture K"` (single fixture) |
| Full suite command | `npx vitest run` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| TRON-PREP-01 | `payloadFingerprint = keccak256(tag ‖ raw_data_hex)` stable + sender-dependent | unit | `npx vitest run test/signing-fingerprint-tron.test.ts -t "Fixture K"` | ❌ Wave 0 |
| TRON-PREP-01 | TRC-20 fingerprint distinct from TRX-native; both distinct from EVM + Solana | unit | `npx vitest run test/signing-fingerprint-tron.test.ts -t "Fixture L"` + `-t "chain-distinct"` | ❌ Wave 0 |
| TRON-PREP-02 | preview_send TRON branch emits `LEDGER BLIND-SIGN HASH (TRON)` block | unit + integration | `npx vitest run test/preview-send-tron.test.ts -t "blind-sign hash"` | ❌ Wave 0 |
| TRON-PREP-02 | preview_send TRC-20 surfaces `triggerconstantcontract` revert as ADVISORY | unit | `npx vitest run test/preview-send-tron.test.ts -t "advisory simulation"` | ❌ Wave 0 |
| TRON-PREP-02 | preview_send native-TRX skips simulation with explicit `SKIPPED` advisory | unit | `npx vitest run test/preview-send-tron.test.ts -t "native simulation skipped"` | ❌ Wave 0 |
| TRON-PREP-03 | send_transaction TRON branch enforces previewToken + userDecision schema gates | unit | `npx vitest run test/send-transaction-tron.test.ts -t "preview token"` | ❌ Wave 0 |
| TRON-PREP-03 | send_transaction TRON branch refuses on payloadFingerprint drift | unit | `npx vitest run test/send-transaction-tron.test.ts -t "fingerprint drift"` | ❌ Wave 0 |
| TRON-PREP-04 | `get_tron_status` surfaces `transport: "usb-hid"` | unit | `npx vitest run test/get-tron-status.test.ts -t "transport"` | (extend Phase 17 test) |
| TRON-W-01 | `prepare_tron_native_send({ to, sun })` produces TransferContract + handle | unit | `npx vitest run test/prepare-tron-native-send.test.ts` | ❌ Wave 0 |
| TRON-W-02 | `prepare_tron_trc20_send({ to, tokenAddress, amount })` produces TriggerSmartContract + handle; decimals resolved via metadata | unit | `npx vitest run test/prepare-tron-trc20-send.test.ts` | ❌ Wave 0 |
| Cross-cutting | Persona-cycle byte-identity for TRON fingerprints | integration | `npx vitest run test/tron-trust-pipeline.integration.test.ts` | ❌ Wave 0 |
| Cross-cutting | FROZEN-area: zero diff against EVM + Solana signing/protocols/tests | manual + structural | `git diff --stat src/signing/payload-fingerprint{,-solana}.ts ...` should show 0 line changes post-merge | structural — plan-checker assertion |

### Sampling Rate
- **Per task commit:** `npx vitest run test/signing-fingerprint-tron.test.ts test/prepare-tron-native-send.test.ts` (quick — fixture + adjacent consumer)
- **Per wave merge:** `npx vitest run` (full suite — proves FROZEN files stay green)
- **Phase gate:** full suite green + integration test green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `test/signing-fingerprint-tron.test.ts` — covers TRON-PREP-01 (Fixture K + L + chain-distinct property)
- [ ] `test/signing-presign-hash-tron.test.ts` — covers DF-2 SHA-256 recompute (or fold into the fingerprint test file)
- [ ] `test/simulation-tron.test.ts` — covers DF-4 ADVISORY status classification
- [ ] `test/prepare-tron-native-send.test.ts` — covers TRON-W-01
- [ ] `test/prepare-tron-trc20-send.test.ts` — covers TRON-W-02
- [ ] `test/preview-send-tron.test.ts` — covers TRON-PREP-02
- [ ] `test/send-transaction-tron.test.ts` — covers TRON-PREP-03
- [ ] `test/tron-trust-pipeline.integration.test.ts` — covers persona-cycle byte-identity + end-to-end flow
- [ ] Existing `test/get-tron-status.test.ts` (Phase 17) — extend with `transport: "usb-hid"` assertion (TRON-PREP-04)

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no — agent-side; trust anchor is the Ledger device | (n/a) |
| V3 Session Management | yes — handle-store TTL (15 min), previewToken (per-preview UUID v4) | reuse `crypto.randomUUID()` + existing `handle-store.ts` state machine; no Phase-18-specific change |
| V4 Access Control | no — single-user CLI MCP | (n/a) |
| V5 Input Validation | yes — base58check address validation, decimal-string amount, sun/raw-units bigint widening | `tronWeb.utils.address.isAddress`; `parseTronAmountStrict` (NEW, mirror of Phase 6 + Phase 12 strict-parsers); typed PrepareArgs (verbatim agent strings) |
| V6 Cryptography | yes — SHA-256 for blind-sign hash, keccak256 for payloadFingerprint binding, secp256k1 for signature | Node stdlib `crypto.createHash("sha256")`; `viem.keccak256`; `@ledgerhq/hw-app-trx::signTransaction` (device-side secp256k1) — NEVER hand-roll any of these |
| V8 Data Protection | yes — no private keys cross any boundary (device-bound) | CLAUDE.md non-negotiable; verified by the absence of any `privateKey` symbol in any Phase 18 module |
| V11 Business Logic | yes — payloadFingerprint drift gate, previewToken match, userDecision schema enforcement | reuse `handle-store.ts` three-gate region (FROZEN); Phase 18 dispatch is additive after the gates |
| V14 Configuration | yes — TRON_RPC_URL env override; default TronGrid fallback | reuse Phase 17 `_tronRegistry` resolution |

### Known Threat Patterns for TRON stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Compromised MCP swaps `to` between prepare and send | Tampering | payloadFingerprint drift gate (Phase 4 Layer 3; Phase 18 sibling-additive) — recompute over stored `rawDataHex` at send time |
| Compromised agent claims different `to` than passed to prepare | Tampering | LEDGER BLIND-SIGN HASH (TRON) on-device match — user reads the device screen, not the agent transcript |
| Compromised TronGrid endpoint serves stale ref-block | Tampering | Pinned blockHeader at prepare; user re-prepares after the 1-hour window |
| Address-format confusion (base58check vs `0x41`-hex vs EVM-form 20-byte) | Tampering | `tronWeb.utils.address` centralized boundary; `tron-address.ts` helper module; Pitfall 3 documented |
| TRX-app blind-sign mode silently disabled on device | Spoofing (perceived) | LEDGER NOTICE (TRON) block surfaces blind-sign-required note when tx shape will trigger it |
| `feeLimit` set too low — TRC-20 transfer rejected at broadcast | DoS / Availability | Default 100_000_000 sun (= 100 TRX); surface in PREPARE RECEIPT |
| Energy / bandwidth exhaustion at the user account | Availability | Surface `energy_used` from simulation in CHECKS PERFORMED (advisory; user provisions resources via `get_tron_status` Stake 2.0 view in Phase 21) |
| TRC-20 contract paused / blacklisted address | Information Disclosure (failed-tx surfaces account state) | Advisory simulation surface; broadcast-failure surface via `BroadcastReturn.code = CONTRACT_EXE_ERROR` |
| Replay attack via duplicate broadcast | Tampering | `DUP_TRANSACTION_ERROR` returned by `sendRawTransaction`; Phase 18 surfaces `BROADCAST_FAILED` with the duplicate-detection reason |
| TRC-20 false-revert in simulation (e.g. probe 4 above) | Availability | DF-4 ADVISORY posture — preview does NOT refuse on simulation revert |

### Residual Risks (document in SECURITY.md TRON section)

- **Compromised TRC-20 contract code** — VaultPilot does not introspect contract bytecode. The user signs over `transfer(address,uint256)` calldata regardless of whether the underlying contract behaves as documented. Mitigation: curated `tron-trc20.json` registry from Phase 17 limits the surface to known stablecoins + majors.
- **TronGrid free-tier rate limit** — sustained 5+ req/sec users hit HTTP 429; degrades to advisory-rate-limited status in preview gate. Mitigation: `TRON_RPC_URL` env override for paid endpoint.
- **TRX-app blind-sign mode disabled by default on Ledger** — until v0.3.0 firmware, custom-contract calls require the user to enable "Allow signing data" + "Sign by hash" in the device's TRX app settings. Phase 18 LEDGER NOTICE block names the workflow.
- **No native-TRX simulation API** — Phase 18 cannot pre-flight check insufficient-balance for native sends; the user must run `get_tron_balance` separately. CHECKS PERFORMED advisory states this explicitly.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `tronWeb.address.toHex` strips the `0x41` prefix when encoding `address` parameter in calldata (and re-adds in the Protobuf envelope) | Topic 5 | If wrong, calldata addresses would carry an extra `0x41` prefix byte → revert at broadcast. Mitigation: Fixture L hardcoded literal anchor verifies the canonical calldata shape end-to-end |
| A2 | Ledger TRX app v0.3.0+ clear-signs both TransferContract AND TriggerSmartContract method-1 transfer | Topic 2 | If wrong (device blind-signs anyway), user UX degrades but trust anchor (hash match) is unchanged. LEDGER NOTICE block names the fallback |
| A3 | tronweb signature attachment via `signedTx.signature = [hexString]` is the canonical single-sig wire form | Topic 7-8 | If wrong, broadcast fails with `SIGERROR`. Verified at probe 1 + tronweb `SignedTransaction.signature: string[]` typed signature |
| A4 | `triggerconstantcontract`'s revert classification (`REVERT opcode executed` substring) is stable across TronGrid versions | Topic 6 | If string format shifts upstream, the simulation classifier mis-categorizes the status. Mitigation: classifier ALSO checks `result.result === false` as a defensive backstop |

## Open Questions

### OQ-1: Should Phase 18 ship a `get_tron_transaction_status({ txid })` tool?

**What we know:** Phase 4 shipped `get_tx_verification` for EVM. Phase 12 deferred `get_solana_transaction_status` (file does not exist in src/tools). Phase 18 has the surface ready via `tw.trx.getTransaction(txid)`.

**Recommendation:** Defer to Phase 21 (TRON diagnostics) per the Phase 12 precedent. Phase 18 ships `send_transaction` TRON branch returning `{ txHash: txid, broadcastedAt }`; user verifies via TronScan link OR Phase 21's diagnostic tool. Planner reads this OQ; the discuss-phase or plan-checker MAY override if a user-facing follow-up tool is needed in v1.x scope.

### OQ-2: Fixture K/L naming + namespace separation

**What we know:** Phase 8 → Fixture J (EVM chain-distinctness). Phase 12 → Fixture I + J (Solana — namespace-separated in `test/signing-fingerprint-solana.test.ts`). Phase 18-CONTEXT promises Fixture K + L.

**Recommendation:** Phase 18 anchors live in NEW `test/signing-fingerprint-tron.test.ts` — sibling file. Refer to them as `Fixture K (TRON native)` + `Fixture L (TRON TRC-20)` in commit messages + planning docs. Sibling-file separation cleaner than reusing the EVM file (Phase 12 already established this convention).

### OQ-3: Error-code taxonomy additions

**What we know:** Phase 18 introduces NEW errorCodes:
- `TRON_APP_NOT_OPEN` — Ledger TRX app not the active app (NEW; additive)
- `TRON_RPC_FAILED` — tronweb HTTP error (NEW; additive)
- `TRON_TX_EXPIRED` — pre-broadcast expiration check fires (NEW; additive; Pitfall 9)
- `BROADCAST_FAILED` — reused from Phase 4 + Phase 12 (existing; `cause` field carries TRON-specific `code` + `message`)
- `LEDGER_NOT_CONNECTED` — reused from Phase 11/17 (existing)
- `USER_REJECTED` — reused from Phase 4 + Phase 11/12 (existing)

**Recommendation:** Phase 18 lands an ADDITIVE 3-entry extension to `src/signing/error-codes.ts`. Recommend reusing `BROADCAST_FAILED` (errorCode is user-facing taxonomy; granularity in `cause` field). Recommend reusing `LEDGER_NOT_CONNECTED`. Add `TRON_APP_NOT_OPEN` + `TRON_RPC_FAILED` + `TRON_TX_EXPIRED` as new entries. Planner to confirm against the existing taxonomy at plan-time.

## Sources

### Primary (HIGH confidence)
- [`tronweb@6.3.0` installed `.d.ts`](file:///tmp/tron-probe-18/node_modules/tronweb/lib/esm/types/Transaction.d.ts) — Transaction interface (raw_data_hex field), BroadcastReturn shape (Trx.d.ts:175), BroadcastReturn_response_code enum
- [`tronweb@6.3.0` installed JS](file:///tmp/tron-probe-18/node_modules/tronweb/lib/esm/lib/trx.js#L973) — `getCurrentRefBlockParams` default expiration `timestamp + 60 * 1000` ms (line 980)
- [`tronweb@6.3.0` TransactionBuilder.d.ts](file:///tmp/tron-probe-18/node_modules/tronweb/lib/esm/lib/TransactionBuilder/TransactionBuilder.d.ts) — `sendTrx`, `triggerSmartContract`, `triggerConstantContract`, `freezeBalanceV2` etc. signatures
- [`tronweb@6.3.0` helper.js](file:///tmp/tron-probe-18/node_modules/tronweb/lib/esm/lib/TransactionBuilder/helper.js#L65) — `createTransaction` body confirming blockHeader override path + `raw_data_hex` derivation via `txPbToRawDataHex(pb).toLowerCase()`
- [`@ledgerhq/hw-app-trx@6.36.1` installed `Trx.d.ts`](file:///tmp/tron-probe-18/node_modules/@ledgerhq/hw-app-trx/lib-es/Trx.d.ts) — `signTransaction(path, rawTxHex, tokenSignatures)` signature
- [`@ledgerhq/hw-app-trx@6.36.1` installed `Trx.js`](file:///tmp/tron-probe-18/node_modules/@ledgerhq/hw-app-trx/lib-es/Trx.js#L110) — `signTransaction` body confirming `response.slice(0, 65).toString("hex")` 65-byte signature return
- [LedgerHQ/app-tron `src/handlers/sign.c`](https://github.com/LedgerHQ/app-tron/blob/develop/src/handlers/sign.c) — empirically confirmed `cx_hash_no_throw((cx_hash_t *) &txContext.sha2, ...)` SHA-256 hashing path; clear-sign vs blind-sign dispatch
- [LedgerHQ/app-tron `src/parse.h`](https://github.com/LedgerHQ/app-tron/blob/develop/src/parse.h#L112) — `cx_sha256_t sha2;` type confirmation
- Phase 12 artifacts (this repo) — `src/signing/payload-fingerprint-solana.ts`, `src/signing/presign-hash-solana.ts`, `src/signing/simulation-solana.ts`, `src/signing/blocks-solana.ts`, `src/signing/handle-store.ts` (PreparedTx discriminated union widening pattern), `src/tools/preview_send.ts` + `src/tools/send_transaction.ts` (additive-dispatch pattern at lines 350+ + 700+ respectively)
- Phase 17 artifacts (this repo) — `src/chains/tron/*`, `src/wallet/ledger-tron-transport.ts` (USB-HID + `fetchTronAddress` precedent; `_transport.buildTrxApp` indirection ready for Phase 18 `signTronTransaction` extension), `src/tools/{pair_tron_ledger,get_tron_*}.ts`
- Live empirical probe (`/tmp/tron-probe-18/smoke.mjs` 2026-05-20) — 7 probes verifying `raw_data_hex` canonicality, txID = sha256(raw_data_hex), TRC-20 calldata shape, `triggerconstantcontract` simulation behavior + rate-limit hit, blockHeader pinning determinism

### Secondary (MEDIUM confidence — cross-referenced)
- [TRON Protobuf protocol — Tron.proto](https://github.com/tronprotocol/protocol/blob/master/protocol/core/Tron.proto) — Protobuf field schema for Transaction.raw_data + 24-hour MAX_EXPIRATION constant
- [TRON Developer docs — triggerconstantcontract](https://developers.tron.network/reference/triggerconstantcontract) — REST API spec for the simulation gate
- [TRON Developer docs — broadcasttransaction](https://developers.tron.network/reference/broadcasttransaction) — broadcast response shape
- [TRON Developer docs — TIP-712 typed-data signing](https://developers.tron.network/reference/sign-tron-eip712-typed-data-tip-712) — TIP-712 (TRON's EIP-712 cousin) reserved for future capability tools
- [tronprotocol/java-tron — MAXIMUM_TIME_UNTIL_EXPIRATION](https://github.com/tronprotocol/java-tron/) — 24-hour consensus expiration cap
- [TronScan API — tx details](https://tronscan.org/) — surface for `get_tron_transaction_status` future tool (Phase 21)

### Tertiary (LOW confidence — surface-level)
- WebSearch on "Ledger TRX app clear-sign Method 1 transfer" — confirms TRC-20 method-1 transfer is clear-sign-enabled in app-tron v0.3.0+; exact version-to-coverage mapping defer to verify-phase real-device smoke

## Metadata

**Confidence breakdown:**
- Cryptographic preimage shape (DF-1): HIGH — empirically verified `sha256(raw_data_hex) === Transaction.txID` byte-for-byte (probes 1+2); `raw_data_hex` is the canonical Protobuf bytes the network signs
- Blind-sign hash form (DF-2): HIGH — C source quoted directly from `app-tron/src/handlers/sign.c` lines 132+177; `sha2` field type confirmed `cx_sha256_t` in `parse.h:112`
- Ref-block expiration window (DF-3): HIGH — tronweb default 60s line-pinned in `trx.js:980`; TRON consensus 1-hour window referenced from Tron.proto
- Simulation posture (DF-4): HIGH — `triggerconstantcontract` API surface empirically probed; revert + rate-limit + native-TRX-skip semantics verified live
- USB-HID signing flow (Topic 8): HIGH — `@ledgerhq/hw-app-trx` `.d.ts` + JS source line-pinned (`response.slice(0, 65)`); Phase 17 transport infrastructure already in place
- FROZEN-area discipline (Topic 10): HIGH — Phase 18 module layout follows the Phase 12 → Phase 11 precedent verbatim (sibling-additive pattern proven in Phase 12 with byte-frozen v1.x + v2.0 modules)

**Research date:** 2026-05-20
**Valid until:** 2026-06-20 (TronWeb v6.x ecosystem is stable; revisit if `@tronprotocol/sdk` ships as a real SDK during planning or if Ledger app-tron firmware introduces TIP-712-only signing paths)
