# Phase 26: LTC scaffolding + LiFi BTC→EVM/Solana bridging — Pattern Map

**Mapped:** 2026-05-22
**Files analyzed:** 16 new files
**Analogs found:** 15 / 16

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/chains/litecoin/types.ts` | model | transform | `src/chains/bitcoin/types.ts` | exact |
| `src/chains/litecoin/registry.ts` | config | request-response | `src/chains/bitcoin/registry.ts` | exact |
| `src/chains/litecoin/esplora-client.ts` | service | request-response | `src/chains/bitcoin/esplora-client.ts` | exact (fee-estimates endpoint differs) |
| `src/signing/ltc-fingerprint.ts` | utility | transform | `src/signing/btc-fingerprint.ts` | exact |
| `src/clients/lifi.ts` | service | request-response | `src/clients/fourbyte.ts` + `src/clients/etherscan.ts` | role-match (no existing LiFi code) |
| `src/protocols/bridge-decoders/lifi-btc.ts` | utility | transform | `src/protocols/btc-psbt.ts` (decoder half) | partial-match |
| `src/tools/pair_litecoin_ledger.ts` | tool | request-response | `src/tools/pair_btc_ledger.ts` | exact |
| `src/tools/get_litecoin_balance.ts` | tool | request-response | `src/tools/get_btc_balance.ts` | exact |
| `src/tools/get_litecoin_tx_history.ts` | tool | request-response | `src/tools/get_btc_tx_history.ts` | exact |
| `src/tools/get_litecoin_fee_estimates.ts` | tool | request-response | `src/tools/get_btc_fee_estimates.ts` | exact (response mapping differs) |
| `src/tools/prepare_litecoin_native_send.ts` | tool | CRUD | `src/tools/prepare_btc_send.ts` | exact |
| `src/tools/sign_message_ltc.ts` | tool | request-response | `src/tools/sign_message_btc.ts` | exact (magic bytes differ) |
| `src/tools/prepare_btc_lifi_swap.ts` | tool | request-response | `src/tools/prepare_btc_send.ts` (structure) + SunSwap shape | role-match |
| `src/signing/blocks-btc.ts` (APPEND-ONLY) | utility | transform | self (existing APPEND-ONLY file) | exact |
| `test/signing-fingerprint.test.ts` (EXTEND) | test | transform | self (existing extend) | exact |
| `test/signing-bip137.test.ts` (new sibling) | test | transform | `test/signing-bip137.test.ts` | exact |

---

## Pattern Assignments

### `src/chains/litecoin/types.ts` (model, transform)

**Analog:** `src/chains/bitcoin/types.ts` (lines 1–201)

**Imports pattern** (lines 28–47 of analog):
```typescript
import { address as btcAddress, initEccLib, networks } from "bitcoinjs-lib";
import * as tinySecp256k1 from "tiny-secp256k1";

// One-time ECC library initialization — required for P2WPKH address validation.
// Idempotent on re-init.
initEccLib(tinySecp256k1);
```

**LTC divergence — custom network object (no built-in `networks.litecoin`):**
```typescript
// src/chains/litecoin/types.ts — NEW constant, NOT in bitcoinjs-lib@7
import type { Network } from "bitcoinjs-lib";

export const LTC_NETWORK: Network = {
  messagePrefix: "\x19Litecoin Signed Message:\n",
  bech32: "ltc",
  bip32: { public: 0x019da462, private: 0x019d9cfe },
  pubKeyHash: 0x30,  // 48 → L-prefix legacy addresses
  scriptHash: 0x32,  // 50 → M-prefix script hash
  wif: 0xb0,         // 176
};
```

**Address branded-type + two-gate assertion pattern** (lines 54–124 of analog):
```typescript
// Branded type + two-gate validation: regex THEN bitcoinjs-lib checksum check.
// LTC segwit uses "ltc1q" prefix; regex chars same bech32 alphabet.
export type LtcSegwitAddress = string & { readonly __brand: "ltc-segwit-address" };

export const LTC_SEGWIT_RE = /^ltc1q[02-9ac-hj-np-z]{38}$/;

export function assertLtcSegwitAddress(s: unknown): asserts s is LtcSegwitAddress {
  if (typeof s !== "string" || !LTC_SEGWIT_RE.test(s)) {
    throw new TypeError(`Not a valid LTC segwit address: ...`);
  }
  try {
    // Pass LTC_NETWORK — missing this defaults to Bitcoin mainnet (Pitfall 2)
    address.toOutputScript(s, LTC_NETWORK);
  } catch (err) {
    throw new TypeError(`Not a valid LTC segwit address: "${s}" failed bech32 checksum: ...`);
  }
}
```

**`UtxoRow` + `BalanceReport` types** (lines 171–201 of analog):
Copy verbatim from BTC analog — shape is chain-agnostic. These types flow into the esplora-client and tool layers.

---

### `src/chains/litecoin/registry.ts` (config, request-response)

**Analog:** `src/chains/bitcoin/registry.ts` (lines 1–125)

**Imports pattern** (lines 27–28 of analog):
```typescript
import { getLitecoinEsploraUrl } from "../../config/env.js";
import { log } from "../../diagnostics/logger.js";
```
Replace `getBtcEsploraUrl` → `getLitecoinEsploraUrl` (new env helper to add to `src/config/env.ts`).

**Default fallback + lazy-singleton pattern** (lines 41–84 of analog):
```typescript
// LTC public Esplora — litecoinspace.org (mempool.space fork, Esplora-compat for address/utxo/txs)
const PUBLIC_LITECOIN_ESPLORA_FALLBACK = "https://litecoinspace.org/api";

let cachedUrl: string | null = null;
let warnedFallback = false;

function getEsploraBaseUrl(): string {
  if (cachedUrl) return cachedUrl;
  const override = getLitecoinEsploraUrl();
  // ... same isFallback warn-latch pattern as BTC analog lines 69-84
}
```

**ESM spy-affordance indirection** (lines 115–124 of analog):
```typescript
export const _litecoinRegistry = {
  getEsploraBaseUrl,
  getResolvedEsploraUrl: getEsploraBaseUrl,
  getLitecoinEsploraUrl,
};
export { PUBLIC_LITECOIN_ESPLORA_FALLBACK, getEsploraBaseUrl };
```

**Test-only cache reset** (lines 94–97 of analog):
```typescript
export function _resetLitecoinRegistryForTesting(): void {
  cachedUrl = null;
  warnedFallback = false;
}
```

---

### `src/chains/litecoin/esplora-client.ts` (service, request-response)

**Analog:** `src/chains/bitcoin/esplora-client.ts` (lines 1–799)

**Key divergence from BTC analog — fee-estimates endpoint:**

The BTC analog calls `/fee-estimates` (Esplora standard, line 573). litecoinspace.org is a mempool.space fork and returns HTTP 404 on that endpoint. The LTC client's `fetchFeeEstimates` calls `/api/v1/fees/recommended` and maps the mempool.space response shape:

```typescript
// DIFFERS from BTC analog line 573:
// BTC: const url = `${_bitcoinRegistry.getEsploraBaseUrl()}/fee-estimates`;
// LTC: endpoint is /v1/fees/recommended (mempool.space shape)
interface LtcFeesBody {
  fastestFee: number;
  halfHourFee: number;
  hourFee: number;
  economyFee: number;
  minimumFee: number;
}

// Inside fetchFeeEstimates() — map mempool.space shape to standard 5-key object:
const estimates: Record<string, number> = {
  "1":   body.fastestFee,
  "2":   body.halfHourFee,
  "3":   body.hourFee,
  "6":   body.economyFee,
  "144": body.minimumFee,
};
result = { kind: "ok", estimates };
```

Everything else (NEVER-throws 5-arm union, LRU cache + TTLs, `doFetch` helper, `_resetEsploraCacheForTesting`, `broadcastTx` via POST /tx) copies verbatim from BTC analog with `_bitcoinRegistry` → `_litecoinRegistry` and env/log strings substituted.

**ESM spy-affordance:** Use `vi.stubGlobal("fetch", ...)` for tests — NOT an internal `_esploraClient` indirection (same as BTC analog per CLAUDE.md fetch-stub convention, line 14 of analog).

---

### `src/signing/ltc-fingerprint.ts` (utility, transform)

**Analog:** `src/signing/btc-fingerprint.ts` (lines 1–92)

This is a 90-line clone. The ONLY changes are:
1. Domain tag constant: `"VaultPilot-btctx-v1:"` → `"VaultPilot-ltctx-v1:"`
2. All export names: `BTC` → `LTC` / `Btc` → `Ltc`

**Full pattern** (analog lines 32–92):
```typescript
import { concat, keccak256, toBytes } from "viem";
import type { Hex } from "viem";

export const FINGERPRINT_DOMAIN_TAG_LTC = "VaultPilot-ltctx-v1:";

export function computeLtcPayloadFingerprint(
  perInputSighashes: readonly Uint8Array[],
): Hex {
  if (perInputSighashes.length === 0) {
    throw new Error("LTC payloadFingerprint requires at least one input sighash");
  }
  for (const sh of perInputSighashes) {
    if (sh.length !== 32) {
      throw new Error(`per-input sighash must be 32 bytes, got ${sh.length}`);
    }
  }
  const preimage = concat([
    toBytes(FINGERPRINT_DOMAIN_TAG_LTC),
    ...perInputSighashes,
  ]);
  return keccak256(preimage);
}

// ESM spy-affordance per CLAUDE.md convention
export const _ltcFingerprint = { computeLtcPayloadFingerprint };
```

**Critical:** Do NOT share with `btc-fingerprint.ts`. The distinct domain tag is the cross-chain tamper-detection mechanism.

---

### `src/clients/lifi.ts` (service, request-response)

**Analog:** `src/clients/fourbyte.ts` (lines 1–168) for NEVER-throws shape and `vi.stubGlobal` test seam.
**Secondary analog:** `src/clients/etherscan.ts` (lines 1–70) for discriminated union structure with more result arms.

**No existing LiFi code exists** — this file is built from scratch.

**Imports pattern** (from fourbyte.ts lines 31–32):
```typescript
import { log } from "../diagnostics/logger.js";

// No extra imports — raw fetch only. No @lifi/sdk.
```

**NEVER-throws discriminated union result type** (fourbyte analog lines 39–43):
```typescript
const LIFI_API_BASE = "https://li.quest";
const LIFI_TIMEOUT_MS = 10_000;  // LiFi is slower than 4byte — bridge API
const LIFI_BTC_CHAIN_ID = "20000000000001";  // Verified live 2026-05-22

export type LifiBtcQuoteResult =
  | { kind: "ok"; quote: LifiBtcQuote }
  | { kind: "not-found" }                      // 404 — no route found
  | { kind: "rate-limited"; message: string }  // 429
  | { kind: "error"; message: string };        // 4xx/5xx/timeout/parse
```

**Never-throws fetch pattern** (fourbyte analog lines 69–148):
```typescript
export async function fetchBtcLifiQuote(params: {
  btcAddress: string;
  amountSatoshi: bigint;
  toChain: string;
  toToken: string;
  toAddress: string;
}): Promise<LifiBtcQuoteResult> {
  const url = new URL(`${LIFI_API_BASE}/v1/quote`);
  url.searchParams.set("fromChain", "BTC");
  url.searchParams.set("fromToken", "bitcoin");  // token address form, NOT symbol
  url.searchParams.set("fromAddress", params.btcAddress);
  url.searchParams.set("fromAmount", params.amountSatoshi.toString());
  url.searchParams.set("toChain", params.toChain);
  url.searchParams.set("toToken", params.toToken);
  url.searchParams.set("toAddress", params.toAddress);
  url.searchParams.set("integrator", "vaultpilot-mcp");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LIFI_TIMEOUT_MS);
  try {
    const resp = await fetch(url.toString(), { signal: controller.signal });
    if (!resp.ok) {
      if (resp.status === 404) return { kind: "not-found" };
      if (resp.status === 429) return { kind: "rate-limited", message: `LiFi 429` };
      return { kind: "error", message: `LiFi returned HTTP ${resp.status}` };
    }
    let body: LifiBtcQuoteBody;
    try {
      body = (await resp.json()) as LifiBtcQuoteBody;
    } catch (parseErr) {
      return { kind: "error", message: `LiFi invalid JSON: ${...}` };
    }
    return { kind: "ok", quote: mapLifiResponse(body) };
  } catch (err) {
    const e = err as Error;
    if (e?.name === "AbortError") return { kind: "error", message: `LiFi unreachable (timeout ${LIFI_TIMEOUT_MS}ms)` };
    return { kind: "error", message: `LiFi unreachable: ${e?.message}` };
  } finally {
    clearTimeout(timer);
  }
}
```

**Test seam:** `vi.stubGlobal("fetch", ...)` at the OUTER network boundary (per CLAUDE.md convention shown in `fourbyte.ts` header line 13 and `esplora-client.ts` header lines 13–15). Do NOT add a `_lifiClient` indirection wrapper.

**Cache decision:** No cache. LiFi quotes are live market data with routes changing per block; caching a stale PSBT would produce a stale fee/output set.

---

### `src/protocols/bridge-decoders/lifi-btc.ts` (utility, transform)

**Analog:** `src/protocols/btc-psbt.ts` (decoder half, lines 1–50) for PSBT decode pattern.

No `bridge-decoders/` directory exists yet. This is the first file there. The module:
1. Receives the `transactionRequest.data` PSBT hex from the LiFi response.
2. Decodes it for human-readable display (output count, vault address, amount, OP_RETURN presence check).
3. Does NOT reconstruct or reorder — passes through verbatim.
4. Implements Inv#6b `decodedFinalRecipient` assertion.

**Core pattern:**
```typescript
import { Psbt } from "bitcoinjs-lib";
// Note: LTC network NOT needed here — the PSBT came from LiFi with BTC-origin outputs.
// This decoder only extracts + validates; it does not re-encode.

export interface LifiPsbtSummary {
  readonly vaultAddress: string;
  readonly amountSats: bigint;
  readonly hasOpReturn: boolean;
  readonly outputCount: number;
  readonly psbtHex: string;  // verbatim — output order is load-bearing
}

export function decodeLifiPsbt(psbtHex: string): LifiPsbtSummary {
  const psbt = Psbt.fromHex(psbtHex, { network: networks.bitcoin });
  // Extract outputs: deposit output (index 0), OP_RETURN (index 1), change (index 2)
  // DO NOT reorder. Output order is load-bearing for Chainflip bridge.
  // ...
}
```

**Inv#6b assertion** (RESEARCH Pattern 5):
```typescript
// Called from prepare_btc_lifi_swap BEFORE handle creation:
if (quote.action.toAddress?.toLowerCase() !== params.toAddress.toLowerCase()) {
  return makeStructuredError(
    "RECIPIENT_MISMATCH",
    `LiFi returned toAddress=${quote.action.toAddress} but you supplied toAddress=${params.toAddress}`,
  );
}
const decodedFinalRecipient = quote.action.toAddress;
```

---

### `src/tools/pair_litecoin_ledger.ts` (tool, request-response)

**Analog:** `src/tools/pair_btc_ledger.ts` (lines 1–283)

**Structural differences from BTC analog:**

1. **LTC-specific error class** (analog lines 54–61):
```typescript
export class LtcApprovalTimeoutError extends Error {
  constructor() {
    super("Ledger did not approve the LTC address fetch within 60 seconds...");
    this.name = "LtcApprovalTimeoutError";
  }
}
```

2. **`buildLtcApp` via `_transport` indirection** (RESEARCH Pattern 3):
```typescript
// ledger-btc-transport.ts gets a new `buildLtcApp` entry in _transport:
// export const _transport = {
//   ...existing BTC entries...
//   buildLtcApp: (t: unknown): any => new BtcApp({ transport: t, currency: "litecoin" }),
// };
```

3. **`getAppConfiguration()` gate** — assert app name is `"Litecoin"` (not `"Bitcoin"`):
```typescript
// Inside fetchLtcAddresses() in ledger-btc-transport.ts:
const config = await app.getAppConfiguration();
if (config.name !== "Litecoin") {  // ASSUMED — verify against real device
  throw new LedgerLtcAppNotOpenError();
}
```

4. **LTC dual-address derivation** (BIP-44 m/44'/2'/0'/0/0 → L-prefix + BIP-84 m/84'/2'/0'/0/0 → ltc1q):
```typescript
// fetchLtcAddresses() uses:
// format: "legacy"  → L-prefix (coin_type 2 via BtcOld APDU)
// format: "bech32"  → ltc1q prefix
const legacy = await app.getWalletPublicKey("m/44'/2'/0'/0/0", { verify: true, format: "legacy" });
const segwit = await app.getWalletPublicKey("m/84'/2'/0'/0/0", { verify: true, format: "bech32" });
```

5. **VERIFY-ON-DEVICE template** (analog lines 80–91): Clone for LTC with LTC-specific labels.

6. **Two `saveAccount` calls** under `chain: "litecoin"` (analog lines 171–184):
```typescript
saveAccount({ chain: "litecoin", address: legacy.address, derivationPath: "m/44'/2'/0'/0/0", pairedAt });
saveAccount({ chain: "litecoin", address: segwit.address, derivationPath: "m/84'/2'/0'/0/0", pairedAt });
```

7. **Error ladder** (analog lines 211–280): Replace `LedgerBtcAppNotOpenError` → `LedgerLtcAppNotOpenError`, errorCode `"BITCOIN_APP_NOT_OPEN"` → `"LITECOIN_APP_NOT_OPEN"`.

---

### `src/tools/get_litecoin_balance.ts` (tool, request-response)

**Analog:** `src/tools/get_btc_balance.ts` (lines 1–133)

Near-verbatim clone. Changes:
- Import from `../chains/litecoin/esplora-client.js`
- Address pattern in INPUT_SCHEMA: `"^(ltc1q[02-9ac-hj-np-z]{38}|L[1-9A-HJ-NP-Za-km-z]{33})$"` (ltc1q segwit + L-prefix legacy)
- All "BTC"/"bitcoin"/"bc1" references → "LTC"/"litecoin"/"ltc1q"
- Amount label "sats" → "litoshis" (same decimal scale, same bigint handling)

**Error code set, response shape, UTXO passthrough:** copy verbatim from analog.

---

### `src/tools/get_litecoin_tx_history.ts` (tool, request-response)

**Analog:** `src/tools/get_btc_tx_history.ts` (lines 1–147)

Near-verbatim clone. Changes:
- Import from `../chains/litecoin/esplora-client.js` → `fetchAddressTxs`
- Address pattern in INPUT_SCHEMA: LTC addresses
- All BTC string literals → LTC
- Response shape (txid, blockHeight, confirmedAt, fee, nextCursor) is identical

---

### `src/tools/get_litecoin_fee_estimates.ts` (tool, request-response)

**Analog:** `src/tools/get_btc_fee_estimates.ts` (lines 1–99)

Near-verbatim clone. The key difference is the response mapping note: the esplora-client already maps the mempool.space response to the standard 5-key shape before this tool sees it (the mapping lives in `esplora-client.ts` `fetchFeeEstimates`, unlike the BTC analog where the tool layer projects 24-key → 5-key).

**Pattern difference** (BTC analog lines 69–88):
```typescript
// BTC analog: tool layer projects 24-key Esplora response → 5 target keys
// LTC version: esplora-client already returns 5-key shape (mapped from mempool.space);
// tool layer's projection loop still works (5 keys present in result.estimates).
// No functional change — the `for (const key of TARGET_KEYS)` loop is identical.
```

---

### `src/tools/prepare_litecoin_native_send.ts` (tool, CRUD)

**Analog:** `src/tools/prepare_btc_send.ts` (lines 1–100+ — full file)

**Structural changes from BTC analog:**

1. **Import substitutions:**
```typescript
// Replace BTC with LTC throughout:
import { fetchAddressUtxos, fetchFeeEstimates } from "../chains/litecoin/esplora-client.js";
import { _ltcFingerprint } from "../signing/ltc-fingerprint.js";
import "../chains/litecoin/types.js";  // initEccLib side-effect
import { assertLtcSegwitAddress } from "../chains/litecoin/types.js";
// btc-sighash.ts is REUSED (same BIP-143 algorithm; only domain tag differs):
import { _btcSighash } from "../signing/btc-sighash.js";
// btc-psbt.ts is REUSED with LTC_NETWORK param:
import { _btcPsbt } from "../protocols/btc-psbt.js";
```

2. **fingerprint call:** `_ltcFingerprint.computeLtcPayloadFingerprint(perInputSighashes)` instead of `_btcFingerprint.computeBtcPayloadFingerprint`.

3. **PSBT construction:** Pass `{ network: LTC_NETWORK }` to every `bitcoinjs-lib` call (Pitfall 2 in RESEARCH.md). `_btcPsbt.buildBtcPsbt(...)` must accept a `network` parameter.

4. **Amount parameter:** `litoshi` (integer, same decimals=0 as `sats`). Use `parseTronAmountStrict(litoshi, 0, "u64")`.

5. **Chain field:** `chain: "litecoin"` in handle + response.

6. **PREPARE RECEIPT template:** Add `PREPARE_RECEIPT_LTC_NATIVE_TEMPLATE` to `blocks-btc.ts` (APPEND-ONLY — do not touch existing blocks). Mirror the BTC template with "Litecoin mainnet" label.

7. **Demo persona:** `getActiveLtcPersona()` (mirror of `getActiveBtcPersona()`).

---

### `src/tools/sign_message_ltc.ts` (tool, request-response)

**Analog:** `src/tools/sign_message_btc.ts` (lines 1–441)

Near-verbatim clone. **Critical differences from BTC analog:**

1. **LTC magic bytes** (RESEARCH Pitfall 5):
```typescript
// BTC analog line 122: const MAGIC = "Bitcoin Signed Message:\n"; // 24 bytes → varint 0x18
// LTC:
const MAGIC = "Litecoin Signed Message:\n"; // 25 bytes → varint 0x19
// The varint byte differs: encodeVarint(magicBuf.length) produces 0x18 for BTC, 0x19 for LTC
```

2. **BIP-137 header byte for P2WPKH bech32:** Base 39 is the same (P2WPKH header is address-format-agnostic for bech32 native segwit). No change to `assembleBip137CompactSig`.

3. **Import substitutions:**
```typescript
import { assertLtcSegwitAddress } from "../chains/litecoin/types.js";
import "../chains/litecoin/types.js"; // initEccLib side-effect
// _ltcLedgerTransport: new transport function buildLtcApp-based (mirrors _btcLedgerTransport)
import { _ltcLedgerTransport, LedgerLtcAppNotOpenError, LedgerDeviceNotConnectedError } from "../wallet/ledger-btc-transport.js";
```

4. **Export Fixture Z anchor:**
```typescript
// Exported for test cross-linking (Fixture Z anchor):
export const LTC_MAGIC_BYTES_HEX = "1a4c697465636f696e205369676e6564204d6573736167653a0a"; // 0x19 + "Litecoin Signed Message:\n"
```

5. **`listAccounts({ chainFilter: "litecoin" })`** in pairing check (analog line 302).

6. **LEDGER BLIND-SIGN HASH template:** Add `LEDGER_BLIND_SIGN_HASH_MSG_LTC_TEMPLATE` to `blocks-btc.ts` (APPEND-ONLY).

---

### `src/tools/prepare_btc_lifi_swap.ts` (tool, request-response)

**Analog:** `src/tools/prepare_btc_send.ts` (structure) — no exact analog exists for the swap flow.

**New `payloadFingerprint` domain tag:** `"VaultPilot-btclifi-v1:"` — distinct from both `"VaultPilot-btctx-v1:"` (native BTC send) and `"VaultPilot-ltctx-v1:"` (LTC send).

**Tool structure:**
```typescript
import { fetchBtcLifiQuote } from "../clients/lifi.js";
import { decodeLifiPsbt } from "../protocols/bridge-decoders/lifi-btc.js";
import { makeStructuredError } from "../signing/error-codes.js";
import { createHandle } from "../signing/handle-store.js";

// INPUT_SCHEMA:
// fromToken: { type: "string", enum: ["BTC"] }
// toChain:   { type: "string" }   — "ETH", "ARB", "POL", "SOL", etc.
// toToken:   { type: "string" }   — target token address or symbol
// amount:    { type: "string" }   — satoshi amount as decimal string
// toAddress: { type: "string" }   — destination address on target chain
```

**Handler flow:**
```typescript
registerTool("prepare_btc_lifi_swap", DESCRIPTION, INPUT_SCHEMA, async (args) => {
  // 1. Input validation (INVALID_INPUT first)
  // 2. Fetch paired BTC address from listAccounts({ chainFilter: "bitcoin" })
  // 3. fetchBtcLifiQuote(params) — NEVER throws; pattern-match on kind
  // 4. Inv#6b assert: quote.action.toAddress === params.toAddress
  //    → makeStructuredError("RECIPIENT_MISMATCH", ...) on mismatch
  // 5. Decode PSBT for display only (decodeLifiPsbt) — DO NOT reconstruct
  // 6. Compute payloadFingerprint = keccak256("VaultPilot-btclifi-v1:" ‖ PSBT_bytes)
  //    (viem concat + keccak256, same as ltc-fingerprint.ts pattern)
  // 7. createHandle({ args, tx: PreparedTxBtcLifi, payloadFingerprint })
  // 8. Return { handle, psbtHex, vaultAddress, amountSats, toAddress, toChain, toToken, prepareReceipt }
});
```

**Error codes:** `INVALID_INPUT`, `WALLET_NOT_PAIRED`, `LIFI_NO_ROUTE`, `RECIPIENT_MISMATCH`, `INTERNAL_ERROR`.

---

### `src/signing/blocks-btc.ts` (utility — APPEND-ONLY)

**Analog:** self — existing file (lines 1–60+ shown)

This file is APPEND-ONLY (per CLAUDE.md Phase 23 "FROZEN-area discipline" comment in the file header). New templates added at the bottom:

1. `PREPARE_RECEIPT_LTC_NATIVE_TEMPLATE` — mirrors `PREPARE_RECEIPT_BTC_NATIVE_TEMPLATE` with "Litecoin mainnet" label
2. `LEDGER_BLIND_SIGN_HASH_MSG_LTC_TEMPLATE` — mirrors `LEDGER_BLIND_SIGN_HASH_MSG_BTC_TEMPLATE`
3. `PREPARE_RECEIPT_BTC_LIFI_TEMPLATE` — for `prepare_btc_lifi_swap` PREPARE RECEIPT block

Do NOT modify any existing line. Append only.

---

### Test files — `test/signing-fingerprint.test.ts` (EXTEND) and `test/signing-bip137-ltc.test.ts` (NEW)

**Analog for signing-fingerprint.test.ts:** self — Fixture O/P/Q/X pattern (lines 332–684 of test file)

**Fixture assignments per RESEARCH.md:**
- **Fixture Y** — LTC native segwit send `payloadFingerprint`, domain `"VaultPilot-ltctx-v1:"`
- **Fixture Z** — LTC BIP-137 message hash for "Hello VaultPilot" under LTC magic bytes (lives in new `test/signing-bip137-ltc.test.ts`)
- **Fixture AA** — BTC LiFi PSBT `payloadFingerprint`, domain `"VaultPilot-btclifi-v1:"`

**Fixture pattern** (from test/signing-fingerprint.test.ts lines 390–400):
```typescript
// Fixture Y — LTC native segwit send, single-input P2WPKH
// Inputs: txid=bb*32, vout=0, value=1_000_000 litoshis, segwit, address=ltc1q...
// Output: to=ltc1q..., litoshis=900_000
// Domain tag: "VaultPilot-ltctx-v1:"
// Hardcoded 0x... literal — computed at write time, pinned forever
it("Fixture Y — LTC native segwit send, single-input P2WPKH → 0x[HARDCODED] byte-for-byte", () => {
  // ... same structure as Fixture O (lines 400-478 of analog)
  expect(computeLtcPayloadFingerprint([sighash])).toBe("0x[LITERAL]");
});
```

**Fixture Z** (in `test/signing-bip137-ltc.test.ts`):
```typescript
// Mirror of test/signing-bip137.test.ts Fixture W pattern (lines 57-94)
// LTC magic bytes: "\x19Litecoin Signed Message:\n" (26 bytes, varint 0x19)
// computeLtcBip137MessageHash("Hello VaultPilot") === "0x[LITERAL]"
// NOTE: this is distinct from Fixture W (BTC) — magic bytes differ
```

**NO `beforeAll`-snapshot rule** (CLAUDE.md): Hardcoded hex literal pinned at write time. Drift in preimage assembly fails at this test, not against a self-snapshotted value.

---

## Shared Patterns

### ESM Spy-Affordance Indirection
**Source:** `src/chains/bitcoin/registry.ts` lines 115–119; `src/signing/btc-fingerprint.ts` lines 90–91
**Apply to:** `src/chains/litecoin/registry.ts`, `src/signing/ltc-fingerprint.ts`, `src/wallet/ledger-btc-transport.ts` (new `buildLtcApp` entry)

Every module with internal-to-exported calls wraps the callable surface in an `_<scope>` object for `vi.spyOn`. Named exports alone are immutable ESM bindings — `vi.spyOn(module, "fn")` is a silent no-op for cross-export internal calls.

```typescript
// Pattern (from btc-fingerprint.ts line 91):
export const _ltcFingerprint = { computeLtcPayloadFingerprint };
// Pattern (from registry.ts lines 115-119):
export const _litecoinRegistry = { getEsploraBaseUrl, getResolvedEsploraUrl, getLitecoinEsploraUrl };
```

### NEVER-Throws 5-Arm Discriminated Union
**Source:** `src/chains/bitcoin/esplora-client.ts` lines 64–103; `src/clients/fourbyte.ts` lines 39–43
**Apply to:** `src/chains/litecoin/esplora-client.ts`, `src/clients/lifi.ts`

All HTTP client functions return a discriminated union. Never `throw`. Arms: `ok | not-found | rate-limited | error | not-applicable`. Tool handlers pattern-match on `kind` — no `try/catch` around client calls.

### Error Code Structured Envelope
**Source:** `src/signing/error-codes.ts`; used in `src/tools/sign_message_btc.ts` lines 56–66
**Apply to:** All new tool files

```typescript
import { type ErrorCode, type StructuredError, makeStructuredError } from "../signing/error-codes.js";

function errEnvelope(code: ErrorCode, message: string, cause?: string): Record<string, unknown> {
  return makeStructuredError(code, message, cause) as unknown as Record<string, unknown> & StructuredError;
}
```

### Demo-Mode Check First
**Source:** `src/tools/pair_btc_ledger.ts` lines 129–141; `src/tools/sign_message_btc.ts` lines 285–299
**Apply to:** `pair_litecoin_ledger.ts`, `sign_message_ltc.ts`, `prepare_litecoin_native_send.ts`, `prepare_btc_lifi_swap.ts`

Demo-mode check is ALWAYS first, before any USB-HID transport open or Esplora call.

### `vi.stubGlobal("fetch", ...)` Test Seam
**Source:** `src/chains/bitcoin/esplora-client.ts` header (lines 13–15); `src/clients/fourbyte.ts` header (line 13)
**Apply to:** `src/chains/litecoin/esplora-client.ts`, `src/clients/lifi.ts`

For external HTTP clients, the test seam is `vi.stubGlobal("fetch", ...)` at the OUTER network boundary. Do NOT add an internal `_esploraClient` or `_lifiClient` indirection — the CLAUDE.md convention explicitly prohibits this for external HTTP clients.

### PREPARE RECEIPT — Verbatim Args
**Source:** `src/signing/blocks-btc.ts` lines 27–56; `src/tools/prepare_btc_send.ts` header line 35
**Apply to:** `prepare_litecoin_native_send.ts`, `prepare_btc_lifi_swap.ts`

PREPARE RECEIPT blocks surface what the agent supplied (raw strings), never normalized values. The cryptographic `payloadFingerprint` is the drift-detection layer — not the receipt text.

### Hardcoded Fixture Literal Discipline
**Source:** CLAUDE.md "Cryptographic-binding fixtures pinned as hardcoded literals"; `test/signing-fingerprint.test.ts` line 400
**Apply to:** `test/signing-fingerprint.test.ts` (Fixtures Y, AA), `test/signing-bip137-ltc.test.ts` (Fixture Z)

Fixtures are pinned as hardcoded `0x...` literals computed at write time. Never `beforeAll`-snapshot. Drift fails at the specific test line, not against a self-captured value. Cross-link from consumer tests.

---

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `src/clients/lifi.ts` | service | request-response | No LiFi client has ever been built in this repo (Phase 16 and Phase 20 LiFi plans were never executed). The fourbyte/etherscan client shape is the closest analog for the NEVER-throws + `vi.stubGlobal` pattern, but the response schema is entirely new. |

---

## Metadata

**Analog search scope:** `src/chains/bitcoin/`, `src/clients/`, `src/signing/`, `src/tools/`, `src/protocols/`, `test/`
**Files scanned:** 14 production files read in full; 2 test files partially scanned via grep
**Pattern extraction date:** 2026-05-22
