# Phase 24: BIP-125 RBF + BIP-137 Message Signing — Pattern Map

**Mapped:** 2026-05-22
**Files analyzed:** 10 new/modified files
**Analogs found:** 10 / 10

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `src/tools/prepare_btc_rbf_bump.ts` | tool/controller | request-response | `src/tools/prepare_btc_send.ts` | exact (same prepare-tool shape, skips coin-selection) |
| `src/tools/sign_message_btc.ts` | tool/controller | request-response | `src/tools/prepare_btc_send.ts` (structure) + `src/wallet/ledger-btc-transport.ts` (Ledger call) | role-match |
| `src/protocols/btc-psbt.ts` (extend) | protocol helper | transform | `src/protocols/btc-psbt.ts` | exact (self-analog — add `sequenceOverride?` param) |
| `src/chains/bitcoin/esplora-client.ts` (extend) | API client | request-response | `src/chains/bitcoin/esplora-client.ts` | exact (self-analog — add `fetchBtcTx` following `fetchAddressUtxos` pattern) |
| `src/signing/blocks-btc.ts` (extend) | format-sentinel | transform | `src/signing/blocks-btc.ts` | exact (self-analog — append two new templates) |
| `src/signing/handle-store.ts` (extend) | store/model | CRUD | `src/signing/handle-store.ts` | exact (self-analog — widen `PreparedTxBtc.kind`) |
| `src/wallet/ledger-btc-transport.ts` (extend) | transport | request-response | `src/wallet/ledger-btc-transport.ts` | exact (self-analog — add `signBtcMessage` to `_btcLedgerTransport`) |
| `src/tools/preview_send.ts` (extend BTC branch) | tool/controller | request-response | `src/tools/preview_send.ts` BTC branch (lines ~2043–2200) | exact (add `kind: "rbf"` arm) |
| `src/tools/send_transaction.ts` (extend BTC branch) | tool/controller | request-response | `src/tools/send_transaction.ts` BTC branch (lines ~1344–1550) | exact (add `kind: "rbf"` arm) |
| `src/signing/error-codes.ts` (extend) | shared type | — | `src/signing/error-codes.ts` | exact (self-analog — append BTC-W-02/03 error codes) |
| `test/prepare-btc-rbf-bump.test.ts` | test | — | `test/prepare-btc-send.test.ts` | exact |
| `test/sign-message-btc.test.ts` | test | — | `test/prepare-btc-send.test.ts` (structure) | role-match |
| `test/signing-bip137.test.ts` | test | — | `test/signing-fingerprint.test.ts` BTC block | exact |
| `test/signing-fingerprint.test.ts` (extend) | test | — | `test/signing-fingerprint.test.ts` Fixture O/P/Q block | exact |

---

## Pattern Assignments

### `src/tools/prepare_btc_rbf_bump.ts` (tool, request-response)

**Analog:** `src/tools/prepare_btc_send.ts`

**Imports pattern** (lines 52–86 of analog):
```typescript
import { Transaction } from "bitcoinjs-lib";

import { fetchFeeEstimates } from "../chains/bitcoin/esplora-client.js";
// Phase 24 adds: import { fetchBtcTx } from "../chains/bitcoin/esplora-client.js";
import "../chains/bitcoin/types.js"; // initEccLib side-effect
import { assertBtcSegwitAddress, assertBtcTaprootAddress } from "../chains/bitcoin/types.js";
import { isDemoMode } from "../config/env.js";
import { getActiveBtcPersona } from "../demo/state.js";
import {
  INPUT_ROW_BTC_TEMPLATE,
  OUTPUT_ROW_BTC_TEMPLATE,
  PREPARE_RECEIPT_BTC_RBF_TEMPLATE, // NEW in Phase 24
} from "../signing/blocks-btc.js";
import { _btcFingerprint } from "../signing/btc-fingerprint.js";
import { _btcSighash } from "../signing/btc-sighash.js";
import {
  type ErrorCode,
  type StructuredError,
  makeStructuredError,
} from "../signing/error-codes.js";
import {
  type PrepareArgs,
  type PreparedTxBtc,
  createHandle,
} from "../signing/handle-store.js";
import { _btcPsbt, type BtcPsbtInput } from "../protocols/btc-psbt.js";
import { listAccounts } from "../wallet/non-evm-account-store.js";
import { _btcLedgerTransport } from "../wallet/ledger-btc-transport.js";
import { registerTool } from "./index.js";
```

**Error envelope pattern** (lines 90–100 of analog — copy verbatim):
```typescript
function errEnvelope(
  code: ErrorCode,
  message: string,
  cause?: string,
): Record<string, unknown> {
  return makeStructuredError(code, message, cause) as unknown as Record<
    string,
    unknown
  > &
    StructuredError;
}
```

**Constants pattern** (lines 103–113 of analog):
```typescript
const DUST_THRESHOLD_SATS = 330n;
const ZERO_EVM_ADDRESS = "0x0000000000000000000000000000000000000000" as `0x${string}`;
const ZERO_MASTER_FINGERPRINT = new Uint8Array(4);
// Phase 24 adds:
const RBF_ENABLED_SEQUENCE = 0xfffffffd; // BIP-125: signals RBF; distinct from RBF_DISABLED_SEQUENCE (0xfffffffe)
const MIN_RELAY_FEE_BUMP_SATS_PER_VB = 1; // BIP-125 Rule 4 static enforcement (Phase 24 hardcoded)
```

**Demo-mode FIRST refusal pattern** (lines 288–398 of analog — the canonical ordering):
```typescript
// Step 1: input validation FIRES FIRST (before any state read)
// Step 2: demo-mode FIRST refusal — read BTC persona BEFORE listAccounts
const demoActive = isDemoMode();
const btcPersona = getActiveBtcPersona();
if (demoActive) {
  if (!btcPersona) {
    return { isError: true, content: [...], structuredContent: errEnvelope("WRONG_MODE", ...) };
  }
  // Use persona addresses + stub pubkeys (like prepare_btc_send)
} else {
  // Real mode — listAccounts ONLY reached here
  const accounts = listAccounts({ chainFilter: "bitcoin" });
  if (accounts.length === 0) {
    return { isError: true, ..., structuredContent: errEnvelope("WALLET_NOT_PAIRED", ...) };
  }
}
```

**Esplora fetch + RBF validation pattern** (new in Phase 24, per RESEARCH Pattern 1 + Algorithm):
```typescript
// NEW: fetch full tx (includes vin[].prevout.value + status.confirmed)
const txResult = await fetchBtcTx(txid);  // GET /tx/{txid} JSON
if (txResult.kind === "not-found") {
  return errEnvelope("INVALID_INPUT", `txid ${txid} not found in Esplora`);
}
const txData = txResult.tx;

// Confirmed-tx refusal
if (txData.status.confirmed) {
  return errEnvelope("BTC_TX_ALREADY_CONFIRMED",
    `txid ${txid} is already confirmed; use CPFP (deferred) for confirmed-parent fee bumps`);
}

// RBF signal check — any input sequence < 0xfffffffe signals RBF
const rbfSignalled = txData.vin.some(inp => inp.sequence < 0xfffffffe);
if (!rbfSignalled) {
  return errEnvelope("BTC_NOT_RBF_SIGNALLED",
    `txid ${txid} does not signal RBF (all inputs have sequence >= 0xfffffffe); ` +
    `use signalRbf: true on prepare_btc_send to make future txs bumpable`);
}

// Fee math (per RESEARCH Algorithm steps 4-6)
const originalInputSum = txData.vin.reduce((acc, inp) => acc + BigInt(inp.prevout.value), 0n);
const originalOutputSum = txData.vout.reduce((acc, out) => acc + BigInt(out.value), 0n);
const originalFeeSats = originalInputSum - originalOutputSum;
const originalVsize = Math.ceil(txData.weight / 4);
const originalFeeRate = Number(originalFeeSats) / originalVsize;

// BIP-125 Rule 4: new rate must exceed original by at least 1 sat/vB
if (newFeeRate <= originalFeeRate + MIN_RELAY_FEE_BUMP_SATS_PER_VB) {
  return errEnvelope("BTC_RBF_INSUFFICIENT_FEE_RATE", ...);
}
```

**PSBT build + fingerprint pattern** (lines 664–735 of analog — same pipeline):
```typescript
// Calls _btcPsbt.buildBtcPsbt with sequenceOverride: RBF_ENABLED_SEQUENCE
// Then: _btcSighash.computeAllSighashes + _btcFingerprint.computeBtcPayloadFingerprint
// Then: createHandle({ args: prepareArgs, tx: PreparedTxBtc, payloadFingerprint })
// tx.kind = "rbf" (widened from "native")
```

**PREPARE RECEIPT pattern** (lines 780–809 of analog):
```typescript
// Use PREPARE_RECEIPT_BTC_RBF_TEMPLATE from blocks-btc.ts
// Same .replace("{PLACEHOLDER}", value) substitution chain
// RBF variant adds: {ORIGINAL_TXID}, {ORIGINAL_FEE_SATS}, {ORIGINAL_FEE_RATE}, {NEW_FEE_SATS}, {NEW_FEE_RATE}
```

**Outer try/catch + error return** (lines 835–853 of analog — copy verbatim):
```typescript
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  return {
    isError: true,
    content: [{ type: "text", text: `error: prepare_btc_rbf_bump failed: ${message}` }],
    structuredContent: errEnvelope("INTERNAL_ERROR", "prepare_btc_rbf_bump failed", message),
  };
}
```

---

### `src/tools/sign_message_btc.ts` (tool, request-response)

**Analog:** `src/tools/prepare_btc_send.ts` (structure) + `src/wallet/ledger-btc-transport.ts` (Ledger call pattern)

**Key divergence:** No prepare/preview/send pipeline. Direct Ledger call. No handle created. Demo mode → DEMO_MODE_REFUSED (not WRONG_MODE).

**Imports pattern:**
```typescript
import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex } from "@noble/hashes/utils";

import "../chains/bitcoin/types.js"; // initEccLib side-effect
import { assertBtcSegwitAddress } from "../chains/bitcoin/types.js";
import { isDemoMode } from "../config/env.js";
import { getActiveBtcPersona } from "../demo/state.js";
import {
  LEDGER_BLIND_SIGN_HASH_MSG_BTC_TEMPLATE, // NEW in Phase 24
} from "../signing/blocks-btc.js";
import { type ErrorCode, type StructuredError, makeStructuredError } from "../signing/error-codes.js";
import { listAccounts } from "../wallet/non-evm-account-store.js";
import { _btcLedgerTransport } from "../wallet/ledger-btc-transport.ts";
import { registerTool } from "./index.js";
```

**Demo-mode pattern for direct-sign tools** (analogous to `prepare_btc_send` Step 2):
```typescript
// Direct-sign tool: demo mode → DEMO_MODE_REFUSED (no device available in demo)
const demoActive = isDemoMode();
if (demoActive) {
  return {
    isError: true,
    content: [{ type: "text", text: "error: sign_message_btc is not available in demo mode (no Ledger device)." }],
    structuredContent: errEnvelope("DEMO_MODE_REFUSED", "sign_message_btc unavailable in demo mode"),
  };
}
// Real mode only: pairing check
const accounts = listAccounts({ chainFilter: "bitcoin" });
if (accounts.length === 0) {
  return errEnvelope("WALLET_NOT_PAIRED", "no paired BTC account; call pair_btc_ledger first");
}
```

**Ledger signMessage call pattern** (extends `_btcLedgerTransport` spy-affordance from `ledger-btc-transport.ts`):
```typescript
// Call through _btcLedgerTransport spy-affordance (not raw app.signMessage)
const { v, r, s } = await _btcLedgerTransport.signBtcMessage(path, messageHex);
// messageHex = Buffer.from(message, "utf8").toString("hex")
// Ledger BTC app applies magic prefix internally — do NOT pre-apply it
```

**BIP-137 assembly pattern** (per RESEARCH Pattern 2 + Code Examples):
```typescript
// Varint encoding for BIP-137 preimage (Bitcoin compact int)
function encodeVarint(n: number): Uint8Array {
  if (n < 0xfd) return new Uint8Array([n]);
  if (n <= 0xffff) {
    const buf = new Uint8Array(3);
    buf[0] = 0xfd;
    new DataView(buf.buffer).setUint16(1, n, true);
    return buf;
  }
  throw new Error("varint: value too large for BIP-137 message");
}

// Server-side BIP-137 message hash (for LEDGER BLIND-SIGN HASH block)
function computeBip137MessageHash(message: string): string {
  const magicBuf = Buffer.from("Bitcoin Signed Message:\n", "utf8"); // 24 bytes
  const msgBuf = Buffer.from(message, "utf8");
  const preimage = Buffer.concat([
    encodeVarint(magicBuf.length), // 0x18
    magicBuf,
    encodeVarint(msgBuf.length),
    msgBuf,
  ]);
  const h1 = sha256(preimage);
  const h2 = sha256(h1);
  return `0x${bytesToHex(h2)}`;
}

// Assemble BIP-137 compact signature from Ledger { v, r, s }
// v from BtcNew = raw recovery_id (0 or 1) — SDK strips 27+4 offset (BtcNew.js line 294)
function assembleBip137CompactSig(v: number, r: string, s: string): string {
  const header = v + 39; // P2WPKH bech32: base 39 + recovery_id
  const sig65 = Buffer.concat([
    Buffer.from([header]),
    Buffer.from(r, "hex"),  // 32 bytes
    Buffer.from(s, "hex"),  // 32 bytes
  ]);
  return sig65.toString("base64"); // 88-char base64
}
```

---

### `src/protocols/btc-psbt.ts` (extend — `sequenceOverride?` param)

**Analog:** `src/protocols/btc-psbt.ts` itself (self-analog — surgical add)

**The single load-bearing change** (per RESEARCH Pitfall 1 + Algorithm step 10):

Current constant at line 42:
```typescript
const RBF_DISABLED_SEQUENCE = 0xfffffffe;
```

Current `BtcPsbtArgs` interface at line 79–89:
```typescript
export interface BtcPsbtArgs {
  readonly inputs: readonly BtcPsbtInput[];
  readonly recipientOutput: BtcPsbtOutput;
  readonly changeOutput: BtcPsbtOutput | null;
  readonly dustThresholdSats: bigint;
  // Phase 24 ADD:
  readonly sequenceOverride?: number;  // For RBF: pass 0xfffffffd; omit for normal sends
}
```

Current `psbt.addInput` calls at lines ~243, ~265 (both segwit and taproot arms):
```typescript
// BEFORE (hardcoded constant):
sequence: RBF_DISABLED_SEQUENCE,

// AFTER (one-line conditional):
sequence: args.sequenceOverride ?? RBF_DISABLED_SEQUENCE,
```

`signalRbf` flag on `prepare_btc_send` (Design Fork 1 resolution — adopt, default false):
```typescript
// In INPUT_SCHEMA for prepare_btc_send:
signalRbf: {
  type: "boolean",
  description: "If true, signals RBF (BIP-125) on all inputs (sequence 0xfffffffd instead of 0xfffffffe). Default: false. Set to true to allow fee-bumping this tx with prepare_btc_rbf_bump.",
}
// In handler: pass sequenceOverride: rawSignalRbf ? 0xfffffffd : undefined to buildBtcPsbt
```

---

### `src/chains/bitcoin/esplora-client.ts` (extend — `fetchBtcTx`)

**Analog:** `src/chains/bitcoin/esplora-client.ts` — `fetchAddressUtxos` function (lines 296–384) is the exact pattern to follow.

**New type declarations** (following `EsploraUtxoBody` at line ~142):
```typescript
// Phase 24 — EsploraTxFull types for GET /tx/{txid}
interface EsploraTxVin {
  txid: string;
  vout: number;
  sequence: number;
  prevout: {
    scriptpubkey: string;
    scriptpubkey_address: string;
    scriptpubkey_type: string;  // "v0_p2wpkh" | "v1_p2tr" | ...
    value: number;               // sats as JS number (safe up to ~90,000 BTC)
  };
}

interface EsploraTxVout {
  scriptpubkey: string;
  scriptpubkey_address: string;
  scriptpubkey_type: string;
  value: number;
}

interface EsploraTxFullBody {
  txid: string;
  version: number;
  locktime: number;
  size: number;
  weight: number;        // Used for vsize = Math.ceil(weight / 4)
  fee: number;
  vin: EsploraTxVin[];
  vout: EsploraTxVout[];
  status: { confirmed: boolean; block_height?: number; block_hash?: string; block_time?: number };
}
```

**Result union type** (following `EsploraUtxosResult` pattern at line 77):
```typescript
export type EsploraTxResult =
  | { kind: "not-applicable" }
  | { kind: "ok"; tx: EsploraTxFullBody }
  | { kind: "not-found" }
  | { kind: "rate-limited"; message: string }
  | { kind: "error"; message: string };
```

**`fetchBtcTx` function pattern** (copy `fetchAddressUtxos` structure lines 296–384, adapt URL):
```typescript
export async function fetchBtcTx(txid: string): Promise<EsploraTxResult> {
  // NOTE: NO cache for mempool txs — mempool state changes between calls
  // (tx can confirm). Callers must always fetch fresh status.
  const url = `${_bitcoinRegistry.getEsploraBaseUrl()}/tx/${txid}`;
  const outcome = await doFetch<EsploraTxFullBody>(url);
  // 5-arm union handling: mirrors fetchAddressUtxos error-arm structure verbatim
  // 404 → { kind: "not-found" }
  // 429 → { kind: "rate-limited", message }
  // network/timeout → { kind: "error", message }
  // parse error → { kind: "error", message }
  // ok → { kind: "ok", tx: outcome.body }
}
```

**Important:** `fetchBtcTx` result includes `tx.status.confirmed` — no separate `fetchBtcTxStatus` call needed. One fetch covers both the mempool check and full tx data (per RESEARCH Esplora Capability table note).

**Test seam:** `vi.stubGlobal("fetch", ...)` at the OUTER network boundary (same as existing tests — do NOT introduce `_esploraClient` wrapper, per `esplora-client.ts` comment at line 15).

---

### `src/signing/blocks-btc.ts` (extend — two new templates)

**Analog:** `src/signing/blocks-btc.ts` itself — APPEND-ONLY pattern (line 1 comment: "APPEND-ONLY sibling").

**Template 1 — `PREPARE_RECEIPT_BTC_RBF_TEMPLATE`** (follows `PREPARE_RECEIPT_BTC_NATIVE_TEMPLATE` pattern at lines 45–56):
```typescript
export const PREPARE_RECEIPT_BTC_RBF_TEMPLATE: string = [
  "PREPARE RECEIPT (BTC — RBF fee bump)",
  "  chain:         Bitcoin mainnet",
  "  originalTxid:  {ORIGINAL_TXID}",
  "  newFeeRate:    {NEW_FEE_RATE} sat/vB",
  "  originalFee:   {ORIGINAL_FEE_SATS} sats  ({ORIGINAL_FEE_RATE} sat/vB)",
  "  newFee:        {NEW_FEE_SATS} sats  (delta: +{FEE_DELTA_SATS} sats)",
  "  inputs:",
  "{INPUT_ROWS}",
  "  outputs:",
  "{OUTPUT_ROWS}",
].join("\n");
```

**Template 2 — `LEDGER_BLIND_SIGN_HASH_MSG_BTC_TEMPLATE`** (new shape for message signing — distinct from `LEDGER_BLIND_SIGN_HASH_BTC_TEMPLATE`):
```typescript
export const LEDGER_BLIND_SIGN_HASH_MSG_BTC_TEMPLATE: string = [
  "LEDGER BLIND-SIGN HASH (BTC — message signing)",
  "  Message:      {MESSAGE_TEXT}",
  "  BIP-137 hash: {MESSAGE_HASH}",
  "  (double-SHA256 of magic_prefix ‖ varint_len ‖ message)",
  "",
  "  Your Ledger BTC app displays the message text above on-device.",
  "  Compare the displayed message character-for-character against the agent's claim.",
  "  If they match → approve. If they differ → REJECT.",
].join("\n");
```

---

### `src/signing/handle-store.ts` (extend — `PreparedTxBtc.kind` widen)

**Analog:** `src/signing/handle-store.ts` itself — surgical one-line change at line 569.

**Current** (line 569):
```typescript
kind: "native";
```

**After** (Phase 24 widening, matching the comment at line 567–568):
```typescript
/**
 * BTC send kind. `"native"` covers all Phase 23 sends.
 * `"rbf"` covers Phase 24 RBF replacement transactions.
 * Multisig (Phase 25) will widen further.
 */
kind: "native" | "rbf";
```

**Pattern note:** Every existing consumer narrowing on `kind` must be audited:
- `send_transaction.ts` BTC branch (grep `btcTx.kind`) — add `"rbf"` arm
- `preview_send.ts` BTC branch (grep `btcTx.kind`) — add `"rbf"` arm  
- `blocks-btc.ts` template selection in preview branch — add `"rbf"` → `PREPARE_RECEIPT_BTC_RBF_TEMPLATE`

---

### `src/wallet/ledger-btc-transport.ts` (extend — `signBtcMessage` to `_btcLedgerTransport`)

**Analog:** `src/wallet/ledger-btc-transport.ts` — `signBtcPsbt` in `_btcLedgerTransport` at lines 484–489 is the exact pattern.

**New internal function** (mirrors `signBtcPsbt` function structure at lines 343–464):
```typescript
export async function signBtcMessage(
  path: string,
  messageHex: string,
): Promise<{ v: number; r: string; s: string }> {
  const transport = await openTransport();
  try {
    const app = _transport.buildBtcApp(transport);
    // App check (mirrors fetchBtcAddresses + signBtcPsbt pattern)
    try {
      await app.getAppConfiguration();
    } catch {
      throw new LedgerBtcAppNotOpenError();
    }
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call
    const result = await app.signMessage(path, messageHex);
    return result as { v: number; r: string; s: string };
  } finally {
    try {
      await transport.close();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log("warn", `transport.close() failed during signBtcMessage cleanup: ${message}`);
    }
  }
}
```

**`_btcLedgerTransport` extension** (lines 475–490 of analog — add `signBtcMessage`):
```typescript
export const _btcLedgerTransport = {
  fetchBtcAddresses: (...) => fetchBtcAddresses(...),  // existing
  signBtcPsbt: (...) => signBtcPsbt(...),              // existing
  // Phase 24 NEW:
  signBtcMessage: (
    path: string,
    messageHex: string,
  ): Promise<{ v: number; r: string; s: string }> => signBtcMessage(path, messageHex),
};
```

**CRITICAL:** The `app.signMessage` positional-arg interface on the `Btc` wrapper class is confirmed in RESEARCH (`Btc.signMessage(path, messageHex)` — NOT named args; BtcNew handles named internally). The `_transport.buildBtcApp(t)` with `currency: "bitcoin"` guarantees BtcNew routing, so `v` returned is already the stripped recovery_id (0 or 1).

---

### `src/tools/preview_send.ts` (extend BTC branch — `kind: "rbf"` arm)

**Analog:** `src/tools/preview_send.ts` BTC branch at lines ~2043–2200 (self-analog).

**Pattern:** The existing BTC preview branch already handles `kind: "native"`. The `"rbf"` arm diverges only in the PREPARE RECEIPT template selection:
```typescript
// In the BTC preview branch, after the fingerprint drift check:
const prepareReceiptBlock = btcTx.kind === "rbf"
  ? PREPARE_RECEIPT_BTC_RBF_TEMPLATE
    .replace("{ORIGINAL_TXID}", btcTx.originalTxid!)
    .replace("{NEW_FEE_RATE}", String(btcTx.feeRate))
    .replace("{ORIGINAL_FEE_SATS}", String(btcTx.originalFeeSats!))
    .replace("{ORIGINAL_FEE_RATE}", String(btcTx.originalFeeRate!))
    .replace("{NEW_FEE_SATS}", String(btcTx.feeSats))
    .replace("{FEE_DELTA_SATS}", String(btcTx.feeSats - btcTx.originalFeeSats!))
    .replace("{INPUT_ROWS}", inputRows)
    .replace("{OUTPUT_ROWS}", outputRows)
  : PREPARE_RECEIPT_BTC_NATIVE_TEMPLATE  // existing "native" path
    .replace("{TO}", record.args.sats ?? btcTx.outputs[0]?.valueSats.toString() ?? "0")
    // ... existing native template substitutions
```

---

### `src/tools/send_transaction.ts` (extend BTC branch — `kind: "rbf"` arm)

**Analog:** `src/tools/send_transaction.ts` BTC branch at lines ~1344–1550 (self-analog).

**Pattern:** `kind: "rbf"` flows through the SAME signing path as `kind: "native"`. No separate arm needed for the sign call — `_btcLedgerTransport.signBtcPsbt` works for both. The `kind` distinction matters only in:
1. The simulation envelope label (`buildBtcSimulationEnvelope` at line ~1371): `btcTx.kind` label
2. The structuredContent response shape: include `originalTxid` for `"rbf"` handles

```typescript
// In buildBtcSimulationEnvelope (lines 1371–1400 of analog):
`  kind:              ${btcTx.kind}`,   // already uses btcTx.kind — no change needed

// In the success response structuredContent (lines ~1540–1560):
// Add for "rbf" handles:
...(btcTx.kind === "rbf" ? { originalTxid: btcTx.originalTxid } : {}),
```

---

### `src/signing/error-codes.ts` (extend — Phase 24 BTC error codes)

**Analog:** `src/signing/error-codes.ts` — BTC error codes block at lines 130–158 (additive; follow comment format).

**New codes to append** (after `"BTC_APP_NOT_OPEN"` at line 158):
```typescript
// Phase 24 Plan 24-01 — RBF error codes (additive).
//   BTC_TX_ALREADY_CONFIRMED — prepare_btc_rbf_bump refused: txid is confirmed
//                               (RBF is mempool-only). Hint: use CPFP (deferred).
//   BTC_NOT_RBF_SIGNALLED    — prepare_btc_rbf_bump refused: original tx does not
//                               signal RBF (all inputs have sequence >= 0xfffffffe).
//                               Hint: use signalRbf: true on future prepare_btc_send.
//   BTC_RBF_INSUFFICIENT_FEE_RATE — new fee rate is not strictly higher than original
//                               by at least 1 sat/vB (BIP-125 Rule 4).
//   BTC_RBF_NO_CHANGE_OUTPUT — original tx has no change output owned by the paired
//                               account; cannot absorb the fee delta.
//   BTC_RBF_CANNOT_AFFORD    — fee delta exceeds the change output value (new change
//                               would go negative); cannot bump without adding inputs.
| "BTC_TX_ALREADY_CONFIRMED"
| "BTC_NOT_RBF_SIGNALLED"
| "BTC_RBF_INSUFFICIENT_FEE_RATE"
| "BTC_RBF_NO_CHANGE_OUTPUT"
| "BTC_RBF_CANNOT_AFFORD";
```

---

## Shared Patterns

### ESM Spy-Affordance Indirection
**Source:** `src/wallet/ledger-btc-transport.ts` lines 475–490; `src/protocols/btc-psbt.ts` line 440; `src/signing/btc-fingerprint.ts` line 91
**Apply to:** All new/extended modules with internal-call surfaces
```typescript
// Pattern: export const _<scope> = { functionA, functionB }
// Tests: vi.spyOn(_btcLedgerTransport, "signBtcMessage")
// Never spy on the named export binding directly (ESM bindings are immutable)
export const _btcLedgerTransport = {
  fetchBtcAddresses: (...) => fetchBtcAddresses(...),
  signBtcPsbt: (...) => signBtcPsbt(...),
  signBtcMessage: (...) => signBtcMessage(...),  // Phase 24
};
```

### Error Envelope Pattern
**Source:** `src/tools/prepare_btc_send.ts` lines 90–100
**Apply to:** All tool files (`prepare_btc_rbf_bump.ts`, `sign_message_btc.ts`)
```typescript
function errEnvelope(
  code: ErrorCode,
  message: string,
  cause?: string,
): Record<string, unknown> {
  return makeStructuredError(code, message, cause) as unknown as Record<string, unknown> & StructuredError;
}
```

### Esplora `doFetch` + 5-arm discriminated union
**Source:** `src/chains/bitcoin/esplora-client.ts` lines 166–191 (`doFetch`) + lines 296–384 (`fetchAddressUtxos` as the full pattern)
**Apply to:** `fetchBtcTx` addition in `esplora-client.ts`
```typescript
// Never throws — always returns a discriminated union
// 404 → { kind: "not-found" }
// 429 → { kind: "rate-limited", message }
// timeout/network → { kind: "error", message }
// parse error → { kind: "error", message }
// ok → { kind: "ok", ... }
```

### Format-Fanout-Sentinel Template Pattern
**Source:** `src/signing/blocks-btc.ts` lines 45–134
**Apply to:** All new template strings in `blocks-btc.ts`; all `.replace("{SLOT}", value)` substitution sites in tools and tests
```typescript
// NEVER re-declare template strings in tools or tests
// Import the SAME template constant, substitute with .replace()
// Both production handler AND test import the SAME template for byte-identity assertion
import { PREPARE_RECEIPT_BTC_RBF_TEMPLATE } from "../signing/blocks-btc.js";
```

### Cryptographic-Binding Fixture Discipline
**Source:** `test/signing-fingerprint.test.ts` lines 329–440 (BTC Fixtures O/P/Q block)
**Apply to:** `test/signing-fingerprint.test.ts` (Fixture V), `test/signing-bip137.test.ts` (Fixture W)
> NOTE: fixture letters assigned by the PLAN files — A–U are all claimed (R/S/T reserved for Phase 28 Compound V3), so Phase 24 uses **V** (RBF fingerprint) and **W** (BIP-137 message hash). Computed `0x…` values below are unchanged.
```typescript
// MANDATORY: hardcoded 0x... literal, computed ONCE at write-time, pinned forever
// NO beforeAll-snapshot — drift fails at the specific assertion line
// Fixture V: RBF replacement PSBT fingerprint (0xfffffffd sequence, 120,000 sats fee)
//   0x946eeae4f39317444201821a47bdd0819bffc155925e5b855d22d04a2e1cfefc
// Fixture W: BIP-137 message hash for "Hello VaultPilot"
//   0xca329bc5829e0752932695bd827ca11f3dbe9efd7f94f75fedc42574cb86667e

it("Fixture V — RBF replacement PSBT fingerprint → 0x946eea... byte-for-byte", () => {
  const tx = new Transaction();
  tx.addInput(Buffer.alloc(32, 0xaa), 0, 0xfffffffd); // RBF-ENABLED sequence
  tx.addOutput(BTC_FIXTURE_SEGWIT_SCRIPT, BigInt(880_000)); // 120,000 sats fee
  const sighashes = computeAllSighashes(tx, [
    { scriptType: "p2wpkh", prevOutScript: BTC_FIXTURE_SEGWIT_SCRIPT, valueSats: BigInt(1_000_000) },
  ]);
  expect(computeBtcPayloadFingerprint(sighashes)).toBe(
    "0x946eeae4f39317444201821a47bdd0819bffc155925e5b855d22d04a2e1cfefc",
  );
});
```

### `openTransport` + `try/finally` transport lifecycle
**Source:** `src/wallet/ledger-btc-transport.ts` lines 166–175 (`openTransport`) + lines 349–464 (`signBtcPsbt` try/finally pattern)
**Apply to:** `signBtcMessage` in `ledger-btc-transport.ts`
```typescript
// Per-call transport — NOT a singleton. MUST close in finally.
const transport = await openTransport();
try {
  const app = _transport.buildBtcApp(transport);
  try { await app.getAppConfiguration(); } catch { throw new LedgerBtcAppNotOpenError(); }
  // ... APDU calls ...
} finally {
  try { await transport.close(); }
  catch (err) { log("warn", `transport.close() failed: ...`); }
}
```

### Test Spy Hoisting + `vi.mock` Pattern
**Source:** `test/prepare-btc-send.test.ts` lines 41–76
**Apply to:** `test/prepare-btc-rbf-bump.test.ts`, `test/sign-message-btc.test.ts`
```typescript
// Hoist spies BEFORE imports; mock module with ...actual spread
const { listAccountsSpy } = vi.hoisted(() => ({
  listAccountsSpy: vi.fn(),
}));

vi.mock("../src/wallet/non-evm-account-store.js", async () => {
  const actual = await vi.importActual<typeof import(...)>("...");
  return { ...actual, listAccounts: (...args) => listAccountsSpy(...args) };
});

// Spy on _btcLedgerTransport spy-affordance methods:
vi.spyOn(_btcLedgerTransport, "signBtcMessage").mockResolvedValue({ v: 0, r: "aa".repeat(32), s: "bb".repeat(32) });
```

---

## No Analog Found

All Phase 24 files have analogs in the existing codebase. No file requires falling back to RESEARCH.md patterns exclusively.

| File | Role | Data Flow | Note |
|---|---|---|---|
| `test/signing-bip137.test.ts` | test | — | New test file for BIP-137 hash + header byte; analog is `test/signing-fingerprint.test.ts` BTC block but for SHA-256 not keccak256 — pattern is identical (hardcoded literals, no beforeAll-snapshot) |

---

## Metadata

**Analog search scope:** `src/tools/`, `src/protocols/`, `src/chains/bitcoin/`, `src/signing/`, `src/wallet/`, `test/`
**Files scanned:** 9 source files read in full
**Pattern extraction date:** 2026-05-22

### Critical Implementation Notes

1. **`sequenceOverride?` in `buildBtcPsbt`** — the single most important change to `btc-psbt.ts`. Without it, the replacement PSBT silently uses `RBF_DISABLED_SEQUENCE (0xfffffffe)` and cannot itself be bumped. The `signalRbf: true` flag on `prepare_btc_send` passes `sequenceOverride: 0xfffffffd` to `buildBtcPsbt`.

2. **`app.signMessage` positional-arg form** — the `Btc` wrapper (what `buildBtcApp` returns) uses `signMessage(path, messageHex)` positional args. Do NOT pass named `{ path, messageHex }` object — that is the `BtcNew` form. The wrapper class routes to BtcNew internally.

3. **`fetchBtcTx` no-cache rule** — unlike `fetchAddressUtxos` (30s TTL), `fetchBtcTx` must NOT cache. Mempool status can change between two calls within the same prepare session (tx confirms while user is typing). Always fetch fresh.

4. **`PreparedTxBtc` extension fields for RBF** — besides widening `kind` to `"native" | "rbf"`, the `PreparedTxBtc` interface needs two optional fields for the CHECKS PERFORMED diff block in preview: `originalTxid?: string`, `originalFeeSats?: bigint`, `originalFeeRate?: number`. These carry the original tx's metrics through the handle to preview time.

5. **Fixture V vs Fixture O** — differ only in sequence number (`0xfffffffd` vs `0xfffffffe`) and output value (`880_000` vs `900_000` sats). The distinct sequence is what changes the sighash preimage → distinct fingerprint. This confirms the RBF replacement's fingerprint is cryptographically distinct from the original tx's fingerprint.
