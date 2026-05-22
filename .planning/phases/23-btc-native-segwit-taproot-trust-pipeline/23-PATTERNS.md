# Phase 23: BTC native + segwit + taproot trust pipeline — Pattern Map

**Mapped:** 2026-05-22
**Files analyzed:** 18 (10 new, 8 modified)
**Analogs found:** 16 / 18 (2 greenfield — coin-selection algorithm + two-pass mixed-input signing)

## Orientation

VaultPilot is a multi-chain trust-pipeline MCP server. Phase 23 (BTC) is the **UTXO-model
mirror** of the account-model trust pipelines: Phase 4 (EVM), Phase 12 (Solana), Phase 18
(TRON). Every account-model phase laid down the same sibling-file pattern; Phase 23 copies
those siblings and adapts them to the UTXO shape. **TRON (Phase 18) is the most recent and
closest sibling — prefer TRON analogs over Solana where both exist** (TRON is the more
recent code and the `payloadFingerprint` over canonical serialized bytes is structurally
nearer to BTC's per-input sighash concat than Solana's whole-message hash).

**Two surprises the planner must absorb before assigning plans** — see `## Analog Mismatches & Surprises` at the bottom. They are load-bearing.

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/signing/btc-fingerprint.ts` | signing-primitive | transform | `src/signing/payload-fingerprint-tron.ts` | exact |
| `src/signing/btc-sighash.ts` | signing-primitive | transform | `src/signing/payload-fingerprint-tron.ts` (sibling-shape only) | role-match |
| `src/signing/btc-coin-select.ts` | utility (pure compute) | transform | `src/signing/aave-health.ts` / `compound-collateralization.ts` (pure-compute precedent) | partial |
| `src/signing/blocks-btc.ts` | template (format-fanout SOT) | — | `src/signing/blocks-tron.ts` | exact |
| `src/protocols/btc-psbt.ts` | protocol-encoder | transform | `src/protocols/tron-native.ts` / `solana-system.ts` | role-match |
| `src/chains/bitcoin/change-index.ts` | chain-shelf utility | request-response (HTTP fan-out) | `src/chains/bitcoin/xpub-scan.ts` | exact (extends it) |
| `src/tools/prepare_btc_send.ts` | tool (prepare) | request-response | `src/tools/prepare_tron_native_send.ts` | exact |
| `src/wallet/ledger-btc-transport.ts` (MOD) | transport | request-response (USB-HID) | `src/wallet/ledger-tron-transport.ts` | exact |
| `src/chains/bitcoin/esplora-client.ts` (MOD) | chain-shelf HTTP client | request-response | itself (Phase 22) + `src/clients/etherscan.ts` never-throws pattern | exact |
| `src/signing/handle-store.ts` (MOD) | model (state machine) | — | `PreparedTxTron` union-widening (Phase 18) | exact |
| `src/signing/error-codes.ts` (MOD) | model (error registry) | — | additive — existing TRON/Solana error codes | exact |
| `src/tools/preview_send.ts` (MOD) | tool (preview branch) | request-response | TRON branch (`sendTransactionTronBranch` sibling) in same file | exact |
| `src/tools/send_transaction.ts` (MOD) | tool (send dispatch arm) | request-response | TRON dispatch arm + `sendTransactionTronBranch` in same file | exact |
| `src/tools/register-all.ts` (MOD) | config (tool registry) | — | one-line side-effect import per prepare tool | exact |
| `src/demo/bitcoin-persona.ts` (MOD) | demo (persona registry) | — | `src/demo/tron-persona.ts` / existing file's `simulationEnvelopeShape` anchor | exact |
| `test/signing-fingerprint.test.ts` (MOD) | test | — | Fixtures A–U hardcoded `0x…` literal convention in same file | exact |
| `test/btc-coin-select.test.ts` | test | — | (greenfield — pure-compute regression suite) | partial |
| `test/btc-trust-pipeline.integration.test.ts` | test | — | persona-cycle byte-identity tests (TRON/Solana integration suites) | role-match |

## Pattern Assignments

---

### `src/signing/btc-fingerprint.ts` (signing-primitive, transform) — NEW

**Analog:** `src/signing/payload-fingerprint-tron.ts` (exact). RESEARCH already drafts this
file verbatim (RESEARCH § Code Examples). The TRON sibling is the structural template.

**Imports pattern** (`payload-fingerprint-tron.ts:31-32`):
```typescript
import { concat, keccak256, toBytes } from "viem";
import type { Hex } from "viem";
```

**Domain-tag export + length-invariant pattern** (`payload-fingerprint-tron.ts:41`):
```typescript
export const FINGERPRINT_DOMAIN_TAG_TRON = "VaultPilot-trontx-v1:";
```
BTC copies this as `FINGERPRINT_DOMAIN_TAG_BTC = "VaultPilot-btctx-v1:"` (21 UTF-8 bytes).
Tag-length collision with TRON's 21 bytes is harmless — the tag *string* differs (RESEARCH
BTC-PREP-01). The test suite asserts the byte-length invariant exactly as the TRON/Solana
tests do.

**Compute-function shape** (`payload-fingerprint-tron.ts:56-62`):
```typescript
export function computeTronPayloadFingerprint(input: {
  rawDataBytes: Uint8Array;
}): Hex {
  const tag = toBytes(FINGERPRINT_DOMAIN_TAG_TRON); // 21 bytes utf-8
  const preimage = concat([tag, input.rawDataBytes]);
  return keccak256(preimage);
}
```
BTC divergence: the preimage is `concat([tag, ...perInputSighashes])` — a **variadic spread
of N 32-byte sighashes**, not a single byte blob. Add the two input guards RESEARCH drafts
(non-empty array; every sighash exactly 32 bytes).

**ESM spy-affordance** (`payload-fingerprint-tron.ts:71`):
```typescript
export const _tronFingerprint = { computeTronPayloadFingerprint };
```
BTC copies as `export const _btcFingerprint = { computeBtcPayloadFingerprint };`.

**FROZEN guard:** `payload-fingerprint.ts` / `payload-fingerprint-solana.ts` /
`payload-fingerprint-tron.ts` are byte-untouched. `btc-fingerprint.ts` is a NEW sibling.

---

### `src/signing/btc-sighash.ts` (signing-primitive, transform) — NEW

**Analog:** no direct analog — sibling-file *shape* only (`payload-fingerprint-tron.ts`
header-comment + `_xxx` indirection style). RESEARCH drafts the file (§ Code Examples /
"Per-input sighash dispatch"). This is the per-input BIP-143/BIP-341 sighash compute that
feeds `btc-fingerprint.ts`.

**Core pattern** (from RESEARCH § Code Examples — probe-verified `bitcoinjs-lib@7.0.1`):
```typescript
import { Transaction } from "bitcoinjs-lib";

export function computeAllSighashes(unsignedTx: Transaction, inputs: readonly SighashInput[]): Uint8Array[] {
  const allScripts = inputs.map((i) => i.prevOutScript);
  const allValues = inputs.map((i) => i.valueSats);
  return inputs.map((inp, i) =>
    inp.scriptType === "p2wpkh"
      ? unsignedTx.hashForWitnessV0(i, inp.prevOutScript, inp.valueSats, Transaction.SIGHASH_ALL)
      : unsignedTx.hashForWitnessV1(i, allScripts, allValues, Transaction.SIGHASH_DEFAULT),
  );
}
export const _btcSighash = { computeAllSighashes };
```

**Load-bearing asymmetry (RESEARCH Pitfall 2 / Anti-Patterns):** `hashForWitnessV0` (segwit)
needs only *this* input's prevout script + value; `hashForWitnessV1` (taproot) needs **ALL**
inputs' prevout scripts + values (BIP-341 commits the whole prevout set). The module must
assemble `allScripts[]`/`allValues[]` once before computing any taproot sighash. There is no
prior-chain analog for this whole-set dependency — it is BTC-specific.

**ESM spy-affordance:** `export const _btcSighash = { computeAllSighashes };` — same
convention as `_tronNative`, `_solanaSystem`.

---

### `src/signing/btc-coin-select.ts` (utility, transform) — NEW — GREENFIELD

**Analog:** no algorithmic analog. Closest *role* precedent for "pure-bigint, no-I/O,
regression-tested signing-layer compute module" is `src/signing/aave-health.ts` and
`src/signing/compound-collateralization.ts`. RESEARCH OQ-2 locks the in-repo decision
(no `coinselect` npm package).

**What to copy from the precedent:**
- File placement under `src/signing/` (compute modules live here, not `src/protocols/`).
- Pure functions, all amounts `bigint`, never throws on normal input.
- A regression-fixture test file (`test/btc-coin-select.test.ts`) with hardcoded inputs and
  expected `{ selectedInputs[], changeSats }` outputs.
- ESM spy-affordance object `_btcCoinSelect = { selectCoinsBnb, ... }`.

**Algorithm spec (RESEARCH D-01 + Pitfall 3 — not copied, authored fresh):**
- BnB across the full UTXO set (bc1q + bc1p together); largest-first fallback when BnB
  finds no clean match.
- Per-script-type vbyte constant table for the fee estimate: P2WPKH input ≈ 68 vbytes,
  P2TR key-spend input ≈ 57.5, P2WPKH/P2TR output ≈ 31/43, overhead ≈ 10.5. `[CITED]`
  BIP-141 weight rules. Round up.
- Fee-rate sanity bounds (D-03): refuse `feeRate` < 1 sat/vB or > 10× high-priority estimate.
- Dust check (D-07): the *recipient* output below dust → refuse; the *change* output below
  dust → drop the change output, add the dust to the fee (Pitfall 4 — asymmetry is
  load-bearing).

---

### `src/signing/blocks-btc.ts` (template, format-fanout SOT) — NEW

**Analog:** `src/signing/blocks-tron.ts` (exact). Append-only sibling of `blocks-tron.ts`
(TRON) / `blocks-solana.ts` (Solana — FROZEN) / `blocks.ts` (EVM — FROZEN).

**PREPARE RECEIPT template pattern** (`blocks-tron.ts:51-59`):
```typescript
export const PREPARE_RECEIPT_TRON_NATIVE_TEMPLATE: string = [
  "PREPARE RECEIPT (TRON — native transfer)",
  "  chain:          TRON mainnet",
  "  to:             {TO}",
  "  sun:            {SUN}",
  "  refBlockBytes:  {REF_BLOCK_BYTES}",
  ...
].join("\n");
```
BTC version `PREPARE_RECEIPT_BTC_NATIVE_TEMPLATE` adds the UTXO-model slots: `{TO}`,
`{SATS}`, `{FEE_SATS}`, `{FEE_RATE}`, plus an inputs/outputs summary block (per
`23-CONTEXT.md` line 99 — "BTC receipt adds inputs/outputs/feeSats slots").

**LEDGER BLIND-SIGN HASH template pattern** (`blocks-tron.ts:88+`,
`LEDGER_BLIND_SIGN_HASH_TRON_TEMPLATE`): TRON surfaces one SHA-256 hash. **BTC surfaces
N per-input sighashes** (the device displays inputs/outputs/fee, not a single hash) — the
template must accommodate a repeated per-input line. This is the structural divergence;
the `.replace("{PLACEHOLDER}", value)` substitution discipline and the
format-fanout-sentinel rule (one declaration site, referenced from both production and
test) carry over unchanged.

**Format-fanout-sentinel rule (CLAUDE.md + `blocks-tron.ts:1-9`):** every multi-line block
string lives in ONE place; production handlers and tests both import and substitute
identically. Re-declaring a block elsewhere violates the invariant.

---

### `src/protocols/btc-psbt.ts` (protocol-encoder, transform) — NEW

**Analog:** `src/protocols/tron-native.ts` + `src/protocols/solana-system.ts` (role-match —
protocol-encoder pattern). The encoder/decoder + `_xxx` indirection shape is the analog;
the PSBT internals come from RESEARCH Pattern 1.

**Header-comment + format-fanout-sentinel pattern** (`tron-native.ts:1-11`,
`solana-system.ts:9-14`): the encoder is the ONLY place PSBT assembly happens; tools never
call `bitcoinjs-lib.Psbt` directly — they route through `_btcPsbt.buildBtcPsbt(...)` so the
test seam stays uniform.

**Encode-result interface pattern** (`tron-native.ts:52-69` `TronNativeEncodeResult`):
TRON's encoder returns a rich struct carrying everything the prepare tool needs
(`rawDataHex`, `rawDataBytes`, `instructionSummary`, ...). BTC's `buildBtcPsbt` returns the
analogous struct: `{ psbtBase64, unsignedTxHex, inputs[], outputs[], perInputPrevouts[],
feeSats, changeSats }` — and crucially the **stored canonical artifact for fingerprint
recompute** (see Pitfall 5 below).

**Decoder + discriminated-union pattern** (`tron-native.ts:160-246` `TronNativeDecoded` /
`decodeTronNativeCall`, `solana-system.ts:139-202` `SolanaSystemDecoded` /
`decodeSolanaSystemCall`): both return `{ kind: "transfer", ... } | { kind: "unknown" }`,
NEVER throw, fall back to `{ kind: "unknown" }` on any malformed input. The `preview_send`
BTC branch consumes this for its DECODED block.

**PSBT construction internals (RESEARCH Pattern 1 — probe-verified, NOT from a chain analog):**
```typescript
import { Psbt, networks, payments, initEccLib } from "bitcoinjs-lib";
import * as ecc from "tiny-secp256k1";
initEccLib(ecc); // REQUIRED once at module load — taproot p2tr throws without it
const RBF_DISABLED_SEQUENCE = 0xfffffffe; // D-06
```
Note: `src/chains/bitcoin/types.ts:47` already calls `initEccLib(tinySecp256k1)` at module
scope; a side-effect import of `../chains/bitcoin/types.js` (as `xpub-scan.ts:55` and
`bitcoin-persona.ts:54` do) is the established way to guarantee ECC init fires.

**ESM spy-affordance:** `export const _btcPsbt = { buildBtcPsbt, decodeBtcPsbt };`.

---

### `src/chains/bitcoin/change-index.ts` (chain-shelf utility, HTTP fan-out) — NEW

**Analog:** `src/chains/bitcoin/xpub-scan.ts` (exact — RESEARCH Pattern 4 resolves D-02 to
"extend the Phase 22 xpub gap-limit scan to also scan chain `1`"). This file is a thin
wrapper over (or a parameterized extension of) `xpub-scan.ts`.

**The reusable engine** (`xpub-scan.ts:129-155` `deriveAddress`): currently hardcodes
`node.derive(0)` (receive chain). Change-index tracking needs `node.derive(1)` (change
chain). RESEARCH Pattern 4: "the same algorithm with `.derive(1)` instead of `.derive(0)`
— a parameterization, not a new subsystem."

**What to copy:**
- The gap-limit-20 termination invariant (`xpub-scan.ts:204-264`) — "first address on
  chain `1` with `tx_count == 0`" is exactly the existing gap-limit scan's stop signal.
- The concurrency-5 batched fan-out + 5-min TTL cache keyed by `(xpub, scriptType, chain)`.
- `zpub→xpub` version-byte normalization (`xpub-scan.ts:108-118`).
- The `_resetXpubScanCacheForTesting()` test-seam convention (`xpub-scan.ts:280-282`).

**Approach:** add a `chain: 0 | 1` parameter to `deriveAddress` + `scanXpub` (additive,
back-compat default `0`), OR a `scanChangeChain(xpub, scriptType)` entry point. Either way
`change-index.ts` exposes `nextChangeIndex(xpub, scriptType)` → the next-unused chain-`1`
index, which `deriveChangeAddress` consumes. **Caveat (RESEARCH OQ-3):** two rapid prepares
both see the same "next unused" index — accept as residual, document it; do NOT build a
reservation system (that reintroduces the mutable-state surface Pattern 4 avoids).

---

### `src/tools/prepare_btc_send.ts` (tool, request-response) — NEW

**Analog:** `src/tools/prepare_tron_native_send.ts` (exact). The Solana sibling
`prepare_solana_native_send.ts` is a secondary reference. TRON is closer — same recent
vintage, same `registerTool` + `errEnvelope` + demo-first ordering.

**Imports + `errEnvelope` boundary cast** (`prepare_tron_native_send.ts:51-93`): copy the
`errEnvelope(code, message, cause?)` helper verbatim — it casts `makeStructuredError(...)`
to `Record<string, unknown> & StructuredError` at the tool-handler contract boundary.

**`registerTool` + DESCRIPTION + INPUT_SCHEMA shape** (`prepare_tron_native_send.ts:95-131`):
the DESCRIPTION is an agent routing prompt (CLAUDE.md — "Tool descriptions are agent routing
prompts"). State precisely when to use `prepare_btc_send` (a single BTC send, segwit OR
taproot) and when not (no RBF — Phase 24; no multisig — Phase 25). INPUT_SCHEMA:
`{ to, sats, feeRate?, utxoOverride? }`, `additionalProperties: false`.

**Handler ordering — three load-bearing invariants** (`prepare_tron_native_send.ts:132-256`):
1. **INPUT_VALIDATION FIRES FIRST** (lines 137-187) — validate `to` (BTC: two-gate
   `assertBtcSegwitAddress` / `assertBtcTaprootAddress` from `chains/bitcoin/types.ts`)
   and `sats` (decimal-string parse, decimals=0, dust-bound) BEFORE any state read.
2. **DEMO-MODE FIRST REFUSAL** (lines 189-256) — read the BTC persona registry
   (`getActiveBtcPersona()` — mirror `getActiveTronPersona()`); real-mode pairing check
   (`listAccounts({ chainFilter: "bitcoin" })`) happens AFTER the demo branch so
   `listAccounts` is never called in demo mode.
3. **PREPARE RECEIPT IS VERBATIM** (lines 328-351) — `prepareArgs` carries RAW agent
   strings; the receipt reads exclusively from `args`. No address normalization, no decimal
   scaling at the receipt layer.

**Encode → fingerprint → handle pipeline** (`prepare_tron_native_send.ts:258-337`):
```
get registry/client → _btcPsbt.buildBtcPsbt(...) → _btcSighash.computeAllSighashes(...)
  → _btcFingerprint.computeBtcPayloadFingerprint(perInputSighashes)
  → createHandle({ args: prepareArgs, tx: PreparedTxBtc, payloadFingerprint })
  → PREPARE_RECEIPT_BTC_NATIVE_TEMPLATE substitution
```

**Fixture cross-link** (`prepare_tron_native_send.ts:36-40`): the prepare-tool test
re-anchors the canonical Fixture O/P/Q literals (segwit / taproot / mixed) — drift fails at
both `signing-fingerprint.test.ts` AND the consumer test (load-bearing redundancy per
CLAUDE.md fixture discipline).

**Return shape** (`prepare_tron_native_send.ts:355-369`): `{ handle, chain: "bitcoin", to,
sats, inputs[], outputs[], feeSats, payloadFingerprint, prepareReceipt, txType: "btc" }`.

---

### `src/wallet/ledger-btc-transport.ts` (transport, USB-HID) — MODIFIED

**Analog:** `src/wallet/ledger-tron-transport.ts` (exact). The Phase 22 BTC transport
already exists (`pair_btc_ledger` USB-HID); Phase 23 ADDS `signBtcPsbt()`.

**Established patterns in `ledger-tron-transport.ts` to copy for the new `signBtcPsbt`:**
- **NodeNext default-export shim** (`ledger-tron-transport.ts:42-49`):
  `const TrxApp: any = (TrxAppModule as any).default ?? TrxAppModule;` — the Ledger packages
  declare `default` only; the shim picks the runtime constructor.
- **`_transport` spy-affordance indirection** (`ledger-tron-transport.ts:105-111`):
  production calls `_transport.open()` / `_transport.buildTrxApp(t)`, never the raw class —
  so `vi.spyOn(_transport, "open")` works across the ESM boundary. BTC adds
  `buildBtcApp(t)`.
- **Per-call transport + `try/finally` close** (`ledger-tron-transport.ts:200-229`
  `signTronTransaction`): NOT a singleton — open a fresh transport, `transport.close()` in
  `finally` unconditionally, log a warn on close failure. RESEARCH Pattern 3 reproduces
  this exact `try { ... } finally { try { await transport.close(); } catch ... }` shape.
- **`_xxxLedgerTransport` export object** (`ledger-tron-transport.ts:241-251`): the
  `send_transaction` branch calls `_btcLedgerTransport.signBtcPsbt(...)` so the test can
  `vi.spyOn(_btcLedgerTransport, "signBtcPsbt")`.
- **Named error classes** (`ledger-tron-transport.ts:73-95`
  `LedgerDeviceNotConnectedError`, `LedgerTronAppNotOpenError`): BTC adds
  `LedgerBtcAppNotOpenError` with a recovery-action message.

**BTC-specific divergence — the two-pass mixed-input split (RESEARCH Pattern 3, NO prior
analog):** `signPsbtBuffer` rejects a PSBT whose internal inputs span more than one script
type. `signBtcPsbt` partitions by script type, calls `signPsbtBuffer` once per group
(`accountPath` `m/84'/0'/0'` vs `m/86'/0'/0'`; `addressFormat` `bech32` vs `bech32m`),
then `Psbt.combine(...)` the partials → `finalizeAllInputs()` → `extractTransaction()`.
`knownAddressDerivations` is REQUIRED on every `signPsbtBuffer` call (probe-confirmed) and
must include the change address (load-bearing for D-02 change recognition). No TRON/Solana
analog covers this — see `## Analog Mismatches & Surprises`.

---

### `src/chains/bitcoin/esplora-client.ts` (chain-shelf HTTP client) — MODIFIED

**Analog:** the file itself (Phase 22 — never-throws 5-arm discriminated-union pattern) +
the never-throws HTTP-client precedent `src/clients/etherscan.ts` / `src/clients/fourbyte.ts`.

**Add `broadcastTx(rawTxHex)`** — RESEARCH § Code Examples drafts it verbatim. It mirrors the
existing `fetchAddressUtxos` / `fetchAddressInfo` arms (`esplora-client.ts:56-94`):
discriminated-union return `{ kind: "ok"; txid } | { kind: "rejected"; message } |
{ kind: "error"; message }`, `AbortController` timeout, never throws, routes the base URL
through `_bitcoinRegistry.getEsploraBaseUrl()`.

**Test seam:** `vi.stubGlobal("fetch", ...)` at the network boundary (CLAUDE.md — for
external network clients prefer `vi.stubGlobal("fetch")` over an internal indirection).

---

### `src/signing/handle-store.ts` (model, state machine) — MODIFIED

**Analog:** the `PreparedTxTron` union-widening (Phase 18 — `handle-store.ts:407-493`),
which itself mirrored `PreparedTxSolana` (Phase 12).

**Union-widening pattern** (`handle-store.ts:493`):
```typescript
export type PreparedTx = PreparedTxEvm | PreparedTxSolana | PreparedTxTron;
```
Phase 23 widens to `… | PreparedTxBtc`. `txType` literal-union widens `… | "btc"`.

**`PreparedTxTron` interface as the template** (`handle-store.ts:407-491`): copy the
structure exactly —
- EVM-shape **sentinel fields** (`chainId: 0`, `to: <zero address>`, `valueWei: 0n`,
  `data: "0x"`) so existing EVM consumers stay byte-identical without narrowing at every
  call site (lines 411-430). `PreparedTxBtc` carries the same sentinels.
- Chain-specific cryptographic-binding fields below (lines 432-491): for BTC — the PSBT
  base64, the **stored canonical artifact** for fingerprint recompute (unsigned tx hex +
  ordered per-input prevout scripts/values — Pitfall 5), per-input script types, the
  decoded `inputs[]`/`outputs[]` summary, `feeSats`, `changeSats`.
- A `kind` discriminator (`PreparedTxTron.kind` line 479) — BTC may use `kind: "native"`
  for now (RBF/multisig variants are Phase 24/25).

**FROZEN guard (RESEARCH § Project Constraints):** the `PreparedTx`-union TYPE widening is
additive and permitted (Phase 18 precedent); the handle-store STATE MACHINE + TTL logic
stay byte-identical.

**Companion type:** add a `BtcInstructionSummary` type alongside `TronInstructionSummary`
(`handle-store.ts:127`) for the decoded-args surface.

---

### `src/signing/error-codes.ts` (model, error registry) — MODIFIED

**Analog:** additive — the existing TRON/Solana error codes in the same file. Phase 23 adds
BTC-specific codes at the next free numbers (e.g. dust-below-threshold, fee-rate-out-of-
bounds, no-utxos-available, mixed-input-sign-failure). `makeStructuredError` /
`ErrorCode` / `StructuredError` are reused unchanged (consumed via `errEnvelope` in every
tool). Reuse the canonical codes where they fit — `WALLET_NOT_PAIRED`, `WRONG_MODE`,
`INVALID_INPUT`, `PAYLOAD_FINGERPRINT_DRIFT`, `BROADCAST_FAILED`, `LEDGER_REJECTED` — only
add genuinely new ones.

---

### `src/tools/preview_send.ts` (tool, preview branch) — MODIFIED

**Analog:** the TRON branch in the same file (`preview_send.ts:1194+`
`sendTransactionTronBranch` sibling) + the Solana branch (`preview_send.ts:847+`).

**Dispatch site** (`preview_send.ts:226-230`):
```typescript
const txType = record.tx.txType ?? "evm";
if (txType === "solana") { ... }
if (txType === "tron") { ... }
```
Phase 23 adds `if (txType === "btc") { return await previewSendBtcBranch(...); }` —
additive, BELOW the EVM FROZEN region, exactly as Solana (Plan 12-04) and TRON (Plan 18-04)
carved their arms.

**Branch responsibilities (RESEARCH BTC-PREP-02):**
- Recompute per-input sighashes — **from the stored canonical artifact, NOT a re-parsed
  PSBT** (Pitfall 5 — re-parsing can normalize fields and spuriously fail the drift gate).
- Assert recomputed fingerprint == stored fingerprint (Layer 1 drift defense).
- Emit the DECODED inputs/outputs/feeSats block (via `_btcPsbt.decodeBtcPsbt`).
- Emit the LEDGER BLIND-SIGN HASH block — **multi-hash for multi-input** (per-input
  sighashes) via `blocks-btc.ts` templates.
- Mint the `previewToken` UUID.

**`chunkHash` helper:** the TRON branch keeps `chunkTronHash` inline (`preview_send.ts:1212`)
to avoid touching the frozen `blocks-*.ts`. BTC mirrors with an inline `chunkBtcHash` per
sighash if needed.

---

### `src/tools/send_transaction.ts` (tool, send dispatch arm) — MODIFIED

**Analog:** the TRON dispatch arm + `sendTransactionTronBranch` in the same file
(`send_transaction.ts:1029+`), and the Solana arm (`:618+`).

**FROZEN three-gate region** (`send_transaction.ts:~280-371`) is byte-untouched. Two
additive touch-points, both matching the Phase 12/18 precedent exactly:

1. **Fingerprint-recompute discriminator** (`send_transaction.ts:325-340`): the existing
   `txType === "solana" ? … : txType === "tron" ? … : <EVM>` ternary gains a `"btc"` arm
   calling `computeBtcPayloadFingerprint(...)` over the stored canonical artifact. The
   gate's outer structure + refusal envelope + error message + `errorCode` stay
   BYTE-IDENTICAL across all branches — only the inner compute differs (the explicit lock
   at `send_transaction.ts:322-324`).

2. **Dispatch arm** (`send_transaction.ts:363-371`): the `if (txType === "solana") { … }` /
   `if (txType === "tron") { … }` pair gains `if (txType === "btc") { return await
   sendTransactionBtcBranch(...); }` — additive, BELOW the FROZEN region.

**`sendTransactionBtcBranch` shape** — mirror `sendTransactionTronBranch`
(`send_transaction.ts:1114+`) and its `buildTronDemoSimulationResponse`
(`send_transaction.ts:1057-1106`):
- Demo-mode short-circuit FIRST → mempool-replay simulation envelope (D-04 — see
  `bitcoin-persona.ts` below).
- Real mode: pairing check (`listAccounts({ chainFilter: "bitcoin" })`) → sign via
  `_btcLedgerTransport.signBtcPsbt(...)` (the two-pass split) → broadcast via
  `esplora-client.broadcastTx(rawTxHex)` → `transitionToSent`.
- Error envelope mapping mirrors TRON (`send_transaction.ts:1044-1046`): user rejection →
  `LEDGER_REJECTED`; Esplora `{ kind: "rejected" }` / `{ kind: "error" }` → `BROADCAST_FAILED`.
- BTC broadcasts directly via Esplora `POST /tx` — NOT the WalletConnect bridge (same as
  the Solana USB-HID direct-broadcast path, `send_transaction.ts:963-964`).

---

### `src/tools/register-all.ts` (config, tool registry) — MODIFIED

**Analog:** every prepare-tool side-effect import line in the file. Add one line:
`import "./prepare_btc_send.js"; // Phase 23 Plan 23-XX (BTC-PSBT-01)` next to the Phase 22
BTC read-tool imports / the other `prepare_*` imports. Tool modules register on import.

---

### `src/demo/bitcoin-persona.ts` (demo, persona registry) — MODIFIED

**Analog:** the file itself + `src/demo/tron-persona.ts`. The `simulationEnvelopeShape:
"psbt-mempool-replay"` field already exists on `BtcPersona` (`bitcoin-persona.ts:90`) as a
**Phase 23 anchor** — typed but not yet consumed. Phase 23 wires the D-04 mempool-replay
demo envelope to it.

**What to copy:** the `getActiveBtcPersona()` accessor convention (mirror
`getActiveTronPersona()` from `demo/state.ts`) consumed by `prepare_btc_send` and the
`send_transaction` BTC demo branch. Demo produces a fully-formed PSBT + a simulated
"broadcast accepted" envelope without touching a device (RESEARCH D-04) — structurally the
TRON `buildTronDemoSimulationResponse` shape (`send_transaction.ts:1057-1106`).

---

### `test/signing-fingerprint.test.ts` (test) — MODIFIED

**Analog:** Fixtures A–U in the same file (`signing-fingerprint.test.ts:16-221`). Phase 23
appends **Fixture O (segwit), P (taproot), Q (mixed)** as hardcoded `0x…` literals.

**Convention to copy exactly** (`signing-fingerprint.test.ts:16-23`):
```typescript
it("Fixture A — native send → 0x7e1867b2... byte-for-byte", () => {
  ...
  expect(fp).toBe("0x7e1867b2e6bc98cbce57bb901a33e973c749565eb19f8b86056197c7a20b2f5a");
});
```
Each fixture: a comment naming the input shape, the input constructed inline, a single
hardcoded `expect(fp).toBe("0x…")`. **NO `beforeAll`-snapshot** (CLAUDE.md — drift must fail
at a specific line). The literal values are computed once at execute time via `node -e`
(RESEARCH Claude's Discretion). Cross-link from the `prepare-btc-send` consumer test.

---

### `test/btc-coin-select.test.ts` + `test/btc-trust-pipeline.integration.test.ts` — NEW

**`btc-coin-select.test.ts`:** greenfield regression suite — hardcoded UTXO-set inputs →
expected `{ selectedInputs[], changeSats }`; cover BnB success, largest-first fallback,
fee-sanity bounds, dust asymmetry. Pure-compute, no mocks.

**`btc-trust-pipeline.integration.test.ts`:** persona-cycle byte-identity anchor (RESEARCH
§ Specific Ideas). Two assertions: (a) same `{to, sats}` across personas produces
**persona-distinct** fingerprints (UTXO sets differ → by construction); (b) same `{to,
sats}` + same UTXOs (manual override) produces **byte-identical** fingerprints (regression
anchor against preimage drift). This inverts the EVM/Solana/TRON persona-cycle test
intent — see `## Analog Mismatches & Surprises`.

## Shared Patterns

### `errEnvelope` boundary cast
**Source:** `src/tools/prepare_tron_native_send.ts:83-93`
**Apply to:** `prepare_btc_send.ts` (and any new BTC tool).
```typescript
function errEnvelope(code: ErrorCode, message: string, cause?: string): Record<string, unknown> {
  return makeStructuredError(code, message, cause) as unknown as Record<string, unknown> & StructuredError;
}
```

### ESM spy-affordance indirection
**Source:** CLAUDE.md convention; canonical examples `_tronNative` (`tron-native.ts:257`),
`_tronFingerprint` (`payload-fingerprint-tron.ts:71`), `_transport`
(`ledger-tron-transport.ts:105`), `_solanaSystem` (`solana-system.ts:213`).
**Apply to:** every new BTC module whose exports call each other internally —
`_btcFingerprint`, `_btcSighash`, `_btcPsbt`, `_btcCoinSelect`, `_btcLedgerTransport`. Add
the indirection at write time. For the Esplora network boundary use
`vi.stubGlobal("fetch", …)` instead (CLAUDE.md — outer-edge seam for network clients).

### Two-gate BTC address validation
**Source:** `src/chains/bitcoin/types.ts:108-152` (`assertBtcSegwitAddress`,
`assertBtcTaprootAddress`).
**Apply to:** `prepare_btc_send.ts` input validation, `btc-psbt.ts` recipient/change output
encoding. Regex fast-path gate + `bitcoinjs-lib.address.toOutputScript` full
bech32/bech32m checksum gate. Never regex alone.

### `initEccLib` guarantee
**Source:** `src/chains/bitcoin/types.ts:47` calls `initEccLib(tinySecp256k1)` at module
scope (idempotent). `xpub-scan.ts:55` and `bitcoin-persona.ts:54` import it for the
side effect.
**Apply to:** `btc-psbt.ts`, `btc-sighash.ts`, `change-index.ts` — any module touching
taproot `payments.p2tr` or taproot PSBT ops. Side-effect-import `../chains/bitcoin/types.js`.

### Never-throws discriminated-union HTTP client
**Source:** `src/chains/bitcoin/esplora-client.ts` 5-arm union; `src/clients/etherscan.ts`.
**Apply to:** `broadcastTx` — `{ kind: "ok" | "rejected" | "error" }`, `AbortController`
timeout, never throws.

### `txType` discriminator dispatch
**Source:** `send_transaction.ts:325` + `:363-371`; `preview_send.ts:226-230`.
**Apply to:** the BTC arms in `preview_send.ts` and `send_transaction.ts` — additive
`if (txType === "btc")` BELOW the FROZEN region; `record.tx.txType ?? "evm"` default
preserved.

### Format-fanout-sentinel block templates
**Source:** `src/signing/blocks-tron.ts:1-9`.
**Apply to:** `blocks-btc.ts` — every multi-line PREPARE RECEIPT / LEDGER BLIND-SIGN HASH
string declared once, `.replace("{SLOT}", value)` from both production handler and test.

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `src/signing/btc-coin-select.ts` | utility (pure compute) | transform | Branch-and-bound coin selection is genuinely greenfield. No prior chain is UTXO-model; account-model chains have no coin-selection concept. Closest *role* precedent (pure-compute, regression-tested signing module) is `aave-health.ts` — copy the file shape and test discipline, author the algorithm fresh from Erhardt 2016 + RESEARCH Pitfall 3. |
| `signBtcPsbt` two-pass split (in `ledger-btc-transport.ts`) | transport sub-routine | — | The mixed-script-type two-pass `signPsbtBuffer` + `Psbt.combine` flow (RESEARCH Pattern 3 / Pitfall 1) has NO prior analog. EVM/Solana/TRON each sign one blob in one call. Build it from RESEARCH Pattern 3; the *transport lifecycle* (open/finally-close, spy indirection) copies from `ledger-tron-transport.ts`, only the per-script-type partition is new. |

## Analog Mismatches & Surprises

**1. The UTXO model has no single-blob analog — the fingerprint preimage is structurally
new.** EVM hashes one tx; Solana hashes one `serializeMessage()` output; TRON hashes one
`raw_data_hex`. BTC hashes a **concatenation of N per-input sighashes**. `btc-fingerprint.ts`
copies the TRON sibling's *file shape* (domain tag, `keccak256`, `_xxx` indirection) but the
preimage assembly is a variadic spread, and `btc-sighash.ts` (the upstream producer) has no
analog at all. The taproot sighash (`hashForWitnessV1`) additionally depends on the **whole
prevout set** — `btc-sighash.ts` must hold every selected UTXO before computing any taproot
input's hash (RESEARCH Pitfall 2). No account-model chain has this whole-set dependency.

**2. Mixed-input signing has no prior analog and is a hard SDK constraint, not a design
choice.** `@ledgerhq/hw-app-btc@10.22.1`'s `signPsbtBuffer` *rejects* a PSBT whose internal
inputs span more than one script type (`validateScriptTypeConsistency` throws). SC#5 (mixed
segwit + taproot in one tx) is a locked success criterion AND the D-01 BnB default exercises
the mixed path by construction — so the two-pass split (RESEARCH Pattern 3) is mandatory,
not optional. The PSBT *construction* (`btc-psbt.ts`) handles mixed inputs fine; only the
*signing* step in `ledger-btc-transport.ts` splits by script-type group. Plan this as a
real subsystem in `signBtcPsbt`; do not assume the single-pass transport shape from
TRON/Solana carries over. RESEARCH Assumption A3 flags the real-hardware `Psbt.combine`
round-trip for verify-phase confirmation.

**3. The persona-cycle byte-identity test inverts intent.** EVM/Solana/TRON persona-cycle
tests prove the fingerprint is *stable* across persona swaps (or, for sender-dependent
chains, predictably distinct). For BTC the from-set is the **selected UTXO set**, which is
per-persona-distinct by construction — so the integration test must assert BOTH directions:
distinct fingerprints across personas (different UTXOs), AND byte-identical fingerprints for
same-`to`+same-`sats`+same-UTXOs (manual override). The planner should not copy the prior
persona-cycle assertion verbatim.

**4. Fingerprint recompute must read a stored canonical artifact, not the PSBT.** RESEARCH
Pitfall 5: re-parsing the stored PSBT via `Psbt.fromBase64` can normalize fields on
round-trip and spuriously fail the Layer 1 / Layer 3 drift gate. `PreparedTxBtc` must store
the unsigned tx hex + the ordered per-input prevout scripts/values, and both
`preview_send` and `send_transaction` recompute from *that* — mirroring how
`PreparedTxTron` stores `rawDataHex` (`handle-store.ts:441`) for exactly this reason.

**5. Change-index tracking touches the Phase 22 chain shelf.** D-02 / RESEARCH Pattern 4
extend `xpub-scan.ts` to also scan chain `1`. This is a small additive parameterization
(`derive(0)` → `derive(0|1)`), but it is a modification to a Phase 22 file the CONTEXT
described as "inherited with zero refactor". The planner should scope `change-index.ts` as
either a thin wrapper or a parameter addition and call out the `xpub-scan.ts` touch
explicitly.

## Metadata

**Analog search scope:** `src/signing/`, `src/protocols/`, `src/tools/`, `src/chains/bitcoin/`,
`src/wallet/`, `src/demo/`, `src/clients/`, `test/`.
**Files scanned:** 18 analog/target files read in full or in targeted ranges.
**Pattern extraction date:** 2026-05-22
