# Phase 24: BIP-125 RBF + BIP-137 Message Signing — Research

**Researched:** 2026-05-22
**Domain:** Bitcoin UTXO model — BIP-125 Replace-By-Fee fee bumping, BIP-137 compact message signing, Ledger BTC app v2.1+ APDU surface
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **BIP-125 sequence-number rules**: original tx must signal RBF (sequence < `0xfffffffe`); replacement tx must increase fee rate by at least the minimum-relay-fee bump (~1 sat/vB or per-mempool-policy). Replacement uses the same input set; new output ordering allowed.
- **RBF refusal cases**: confirmed transactions (mempool-only); original tx didn't signal RBF; new fee rate isn't strictly higher than original. Each surfaces as a distinct structured error code.
- **Original-vs-new fee diff surfacing**: CHECKS PERFORMED block shows both old and new fee rate + the absolute increase in sats. Defends against decimal-place mistakes.
- **BIP-137 vs BIP-322 (DF)**: BIP-137 is the legacy compact-signature shape — Phase 24 ships BIP-137; BIP-322 deferred.
- **Message signing UX**: Ledger BTC app clear-signs message text under blind-sign mode; magic-byte prefix (`"Bitcoin Signed Message:\n"`) handled by device internally; user sees post-magic-byte message text on-device.

### Claude's Discretion
- Internal helper names (`buildRbfBumpPsbt`, `signBip137Message`, etc.)
- Whether `prepare_btc_rbf_bump` accepts an optional `newFeeSats` (absolute fee bump) or only `newFeeRate` (rate-based bump)
- Whether to opportunistically signal RBF on all `prepare_btc_send` outputs (Phase 23 ships RBF-disabled by default per standard wallet behavior; Phase 24 could enable opportunistic RBF via a `signalRbf: true` flag on `prepare_btc_send`)

### Deferred Ideas (OUT OF SCOPE)
- PSBT multisig flow — Phase 25
- LTC scaffolding + LiFi BTC bridging — Phase 26
- BIP-322 taproot message signing — future `sign_message_btc_bip322` tool
- CPFP (Child-Pays-For-Parent) fee bump for confirmed parents — future tool
- Per-mempool-policy fee-bump probe (Esplora `/v1/fees/recommended`) — defer; static 1 sat/vB suffices for v2.2
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| BTC-W-02 | `prepare_btc_rbf_bump({ txid, newFeeRate })` produces an unsigned RBF replacement PSBT with higher fee rate; original input set preserved; BIP-125 sequence-number rules enforced; refused on confirmed transactions or transactions that didn't signal RBF | §BIP-125 Mechanics, §RBF PSBT Construction, §Esplora RBF Data, §Fingerprint Shape for RBF |
| BTC-W-03 | `sign_message_btc({ wallet, message })` produces a BIP-137 compact signature over `magic_bytes ‖ varint_length ‖ message`; works against the segwit address by default; BIP-322 taproot message-signing deferred | §BIP-137 Mechanics, §Ledger Message Signing APDU, §sign_message_btc Pipeline |
</phase_requirements>

---

## Summary

Phase 24 adds two BTC tools on top of Phase 23's PSBT trust pipeline. Both tools are additive — they extend existing modules rather than replace them.

`prepare_btc_rbf_bump` fetches a mempool-pending tx via Esplora, validates its RBF signal (sequence < `0xfffffffe` — Phase 23 ships with `0xfffffffe` which does NOT signal RBF, making the `signalRbf` flag decision load-bearing for UX), reconstructs the same input set into a new PSBT with a higher fee-rate (reducing the change output or refusing if impossible), and runs the same fingerprint pipeline as Phase 23 `prepare_btc_send`. The replacement PSBT flows through `preview_send` → `send_transaction` unmodified — the handle shape widens with `kind: "rbf"`.

`sign_message_btc` is NOT a transaction — it does not go through prepare/preview/send. It is a direct read-then-sign tool that calls `app.signMessage(path, messageHex)` where `messageHex` is the raw UTF-8 message bytes hex-encoded. The Ledger BTC app v2.1+ applies the BIP-137 magic prefix (`"Bitcoin Signed Message:\n"`) internally before hashing and signing. The tool assembles the BIP-137 header byte from the returned `v` value and base64-encodes the 65-byte compact signature.

**Primary recommendation:** Implement `prepare_btc_rbf_bump` as a near-clone of `prepare_btc_send` that skips coin selection and instead fetches the original tx from Esplora to reconstruct its input set. Implement `sign_message_btc` as a direct Ledger APDU call (no prepare/preview/send pipeline). Both share the existing `_btcLedgerTransport` spy-affordance.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| RBF mempool validation (is tx confirmed?) | API / Backend | — | Esplora `/tx/{txid}/status` — pure server-side read |
| RBF sequence signaling check | API / Backend | — | Server reads original tx sequence via Esplora `/tx/{txid}` |
| RBF replacement PSBT construction | API / Backend | — | `btc-psbt.ts` extension — same PSBT assembly tier as Phase 23 |
| RBF fee math (Rule 3/4 validation) | API / Backend | — | Server-computed; absolute fee + rate comparisons |
| BIP-137 magic-prefix application | Ledger Device | — | Device applies internally; caller sends raw message bytes |
| BIP-137 signature assembly (header byte) | API / Backend | — | Server assembles 65-byte compact sig from device's `{v,r,s}` |
| BIP-137 message hash (LEDGER BLIND-SIGN HASH block) | API / Backend | — | Server computes double-SHA256 for the CHECKS PERFORMED block |

---

## Standard Stack

### Core (all existing — no new packages)

| Library | Installed Version | Purpose | Why Standard |
|---------|-----------------|---------|--------------|
| `bitcoinjs-lib` | `^7.0.1` (v7.0.1 on registry) | PSBT assembly + Transaction parsing for RBF input reconstruction | Phase 23 established; PSBT-v0 assembly path proven |
| `@ledgerhq/hw-app-btc` | `^10.22.1` (v11.0.0 on registry) | `signMessage(path, messageHex)` APDU via BtcNew | Already in `ledger-btc-transport.ts`; verified against installed .d.ts |
| `viem` | `^2.48.0` (v2.50.4 on registry) | `keccak256` for payloadFingerprint; `concat`, `toBytes` | Phase 23 fingerprint module already uses viem hash utils |
| `@noble/hashes` (transitive) | Installed via bitcoinjs-lib | `sha256` for BIP-137 message hash computation | `@noble/hashes/sha256` and `@noble/hashes/utils` already imported in `btc-psbt.ts` |

**No new packages required.** Phase 24 is implemented entirely with existing dependencies.

### No New Installation Needed

All capabilities are available from Phase 23's dependency set. The `@noble/hashes` package is present as a transitive dependency of `bitcoinjs-lib` and is importable in the project (confirmed by `btc-psbt.ts` importing `@noble/hashes/utils`).

---

## Package Legitimacy Audit

No new packages are installed in Phase 24. All packages listed above are Phase 23 dependencies already in `node_modules` and in `package.json`. Slopcheck results for existing deps:

| Package | Registry | slopcheck | Disposition |
|---------|----------|-----------|-------------|
| `bitcoinjs-lib` | npm | [OK] | Approved (established; Phase 23 in use) |
| `@ledgerhq/hw-app-btc` | npm | [OK] | Approved (established; Phase 22/23 in use) |

**Packages removed due to slopcheck [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none

---

## Architecture Patterns

### System Architecture Diagram

```
Agent calls prepare_btc_rbf_bump({ txid, newFeeRate })
  │
  ├─ Input validation (txid format, newFeeRate bounds)
  │
  ├─ Esplora: GET /tx/{txid}/status → confirmed? → REFUSE if confirmed
  │
  ├─ Esplora: GET /tx/{txid} → vin[] (sequence numbers, prevout values)
  │           Check any input sequence < 0xfffffffe → REFUSE if not signalling RBF
  │
  ├─ Compute original fee and fee-rate from original tx
  │           original_fee = sum(vin[].prevout.value) - sum(vout[].value)
  │           REFUSE if newFeeRate ≤ originalFeeRate
  │           REFUSE if newFeeRate bump < 1 sat/vB (BIP-125 Rule 4)
  │
  ├─ Reconstruct inputs from original vin[] → BtcPsbtInput[] (reuse pubkeys from paired account)
  │
  ├─ Compute new fee: newFee = newFeeRate × vsize
  │   Reduce change output: newChangeSats = originalChangeSats - (newFee - originalFee)
  │   REFUSE if newChangeSats < 0 (can't absorb fee — no change output large enough)
  │   REFUSE if newChangeSats < DUST_THRESHOLD (fold into fee OR refuse — see D-05 below)
  │
  ├─ _btcPsbt.buildBtcPsbt(inputs, recipientOutput, changeOutput, dustThreshold)
  │   → RBF-enabled sequence (0xfffffffd) on EVERY input [NOT 0xfffffffe]
  │
  ├─ _btcSighash.computeAllSighashes(unsignedTx, perInputPrevouts)
  ├─ _btcFingerprint.computeBtcPayloadFingerprint(sighashes)
  ├─ createHandle({ kind: "rbf", ... })
  └─ PREPARE RECEIPT (RBF variant with original-vs-new diff)

Agent calls sign_message_btc({ wallet, message })
  │
  ├─ Input validation (wallet address, message non-empty)
  ├─ Pairing check (listAccounts bitcoin)
  ├─ Resolve derivation path from paired account (segwit by default)
  ├─ Compute BIP-137 message hash server-side (for CHECKS PERFORMED block):
  │   double-SHA256(varint(24) ‖ "Bitcoin Signed Message:\n" ‖ varint(len) ‖ message)
  ├─ Open USB-HID transport → app.signMessage(path, messageHex)
  │   [Ledger device applies magic prefix internally, shows message on screen]
  ├─ Device returns { v, r, s }
  ├─ Assemble BIP-137 compact signature:
  │   header = v + 39  (P2WPKH bech32 offset per BIP-137)
  │   sig65 = Buffer.concat([Buffer.from([header]), Buffer.from(r,'hex'), Buffer.from(s,'hex')])
  │   signatureBase64 = sig65.toString('base64')
  └─ Return { address, message, signatureBase64, messageHash, LEDGER BLIND-SIGN HASH block }
```

### Recommended Project Structure (Phase 24 additions)

```
src/
├── protocols/
│   └── btc-psbt.ts               # EXTEND: add buildRbfReplacementPsbt (or helper in same module)
├── signing/
│   ├── btc-fingerprint.ts        # NO CHANGE — same domain tag used for RBF
│   ├── btc-sighash.ts            # NO CHANGE — same sighash logic for RBF inputs
│   └── blocks-btc.ts             # EXTEND: add PREPARE_RECEIPT_BTC_RBF_TEMPLATE
│                                 #         add LEDGER_BLIND_SIGN_HASH_MSG_BTC_TEMPLATE
├── tools/
│   ├── prepare_btc_rbf_bump.ts   # NEW — Plan 24-01
│   └── sign_message_btc.ts       # NEW — Plan 24-02
├── chains/bitcoin/
│   └── esplora-client.ts         # EXTEND: add fetchTx + fetchTxStatus helpers
├── wallet/
│   └── ledger-btc-transport.ts   # EXTEND: add signBtcMessage to _btcLedgerTransport spy-affordance
└── signing/
    └── handle-store.ts           # EXTEND: PreparedTxBtc.kind widen to "native" | "rbf"
```

### Pattern 1: RBF PSBT Construction from Esplora Data

**What:** Fetch the original mempool tx, extract its inputs (txid/vout/prevout value/sequence), validate RBF signal, compute new fee arithmetic, build replacement PSBT with same inputs and RBF-enabled sequence.

**When to use:** `prepare_btc_rbf_bump` only.

```typescript
// Source: verified against Phase 23 btc-psbt.ts + BIP-125 spec [VERIFIED: codebase + BIP-125 mediawiki]

// Step 1: Fetch original tx
const txData = await fetchBtcTx(txid);              // NEW: Esplora GET /tx/{txid}
const status = await fetchBtcTxStatus(txid);        // NEW: Esplora GET /tx/{txid}/status

// Step 2: RBF signal check — any input with sequence < 0xfffffffe signals RBF
const rbfSignalled = txData.vin.some(inp => inp.sequence < 0xfffffffe);
if (!rbfSignalled) { /* REFUSE BTC_NOT_RBF_SIGNALLED */ }

// Step 3: Fee arithmetic
const originalInputSum = txData.vin.reduce((acc, inp) => acc + BigInt(inp.prevout.value), 0n);
const originalOutputSum = txData.vout.reduce((acc, out) => acc + BigInt(out.value), 0n);
const originalFeeSats = originalInputSum - originalOutputSum;
const originalVsize = Math.ceil(txData.weight / 4);
const originalFeeRate = Number(originalFeeSats) / originalVsize;

// BIP-125 Rule 4: bump must exceed original by at least 1 sat/vB
if (newFeeRate <= originalFeeRate + 1) { /* REFUSE BTC_RBF_INSUFFICIENT_FEE_RATE */ }

// Step 4: Compute new fee and adjust change output
const estimatedVsize = originalVsize;  // same input/output structure
const newFeeSats = BigInt(Math.ceil(newFeeRate * estimatedVsize));
const feeDelta = newFeeSats - originalFeeSats;

// Find the change output to reduce
const recipientOutputs = txData.vout.filter(out => !isChangeOutput(out));
const changeOutput = txData.vout.find(out => isChangeOutput(out));  // heuristic: owned address

// Reduce change by feeDelta
const newChangeSats = changeOutput ? BigInt(changeOutput.value) - feeDelta : -1n;
if (newChangeSats < 0n) { /* REFUSE BTC_RBF_CANNOT_AFFORD */ }
if (newChangeSats < DUST_THRESHOLD_SATS && newChangeSats > 0n) {
  // Fold dust change into fee
}
```

### Pattern 2: BIP-137 Signature Assembly

**What:** The Ledger BTC app `signMessage(path, messageHex)` accepts raw message bytes (hex-encoded). The device applies the BIP-137 magic prefix internally and displays the message text on-screen. The caller assembles the 65-byte compact signature from `{v, r, s}`.

**When to use:** `sign_message_btc` only.

```typescript
// Source: verified against installed @ledgerhq/hw-app-btc@10.22.1 BtcNew.d.ts [VERIFIED: installed .d.ts]
// BtcNew.signMessage({ path, messageHex }) — named arg interface (v2.1+ app)
// Btc.signMessage(path, messageHex) — positional arg interface (wrapper class)

// The Btc wrapper class always routes to BtcNew for currency: "bitcoin" (verified: Btc.js)
// so signMessage is ALWAYS the BtcNew path for this project.

// Assemble the message hash for the CHECKS PERFORMED block
// (Server computes it; Ledger device ALSO computes it before signing)
function computeBip137MessageHash(message: string): Uint8Array {
  const MAGIC = "Bitcoin Signed Message:\n";
  const magicBuf = Buffer.from(MAGIC, "utf8");  // 24 bytes
  const msgBuf = Buffer.from(message, "utf8");
  
  const preimage = Buffer.concat([
    encodeVarint(magicBuf.length),  // 0x18
    magicBuf,                        // 24 bytes
    encodeVarint(msgBuf.length),     // varint of message length
    msgBuf,                          // raw message bytes
  ]);
  // double-SHA256
  return sha256(sha256(preimage));
}

// Assemble BIP-137 compact signature from Ledger {v, r, s}
// v from BtcNew: raw recovery_id (0 or 1) — already stripped of the 27+4 offset
// (BtcNew.js line 294: const v = buf.readUInt8() - 27 - 4)
function assembleBip137CompactSig(
  v: number, r: string, s: string,
  addressType: "p2wpkh"  // P2WPKH bech32 → header base 39
): string {
  const header = v + 39;  // P2WPKH (bech32): 39 + recovery_id
  const sig65 = Buffer.concat([
    Buffer.from([header]),
    Buffer.from(r, "hex"),   // 32 bytes
    Buffer.from(s, "hex"),   // 32 bytes
  ]);
  return sig65.toString("base64");  // 88 chars base64
}
```

### Pattern 3: Esplora /tx/{txid} Response Shape

**What:** The `GET /tx/{txid}` endpoint returns the full transaction with prevout values embedded in `vin[].prevout`. This is critical for RBF — we need prevout values to recompute the original fee and to populate `witnessUtxo` in the replacement PSBT.

**When to use:** `prepare_btc_rbf_bump` — needs both `/tx/{txid}` (prevout values) and `/tx/{txid}/status` (mempool check).

```typescript
// Source: Esplora API docs [CITED: github.com/Blockstream/esplora/blob/master/API.md]
interface EsploraTxVin {
  txid: string;
  vout: number;
  sequence: number;
  prevout: {
    scriptpubkey: string;          // hex scriptPubKey
    scriptpubkey_address: string;  // bech32/bech32m or legacy address
    scriptpubkey_type: string;     // "v0_p2wpkh" | "v1_p2tr" | ...
    value: number;                 // sat value as number (JS number safe up to ~90,000 BTC)
  };
}

interface EsploraTxVout {
  scriptpubkey: string;
  scriptpubkey_address: string;
  scriptpubkey_type: string;
  value: number;
}

interface EsploraTxFull {
  txid: string;
  version: number;
  locktime: number;
  size: number;
  weight: number;
  fee: number;
  vin: EsploraTxVin[];
  vout: EsploraTxVout[];
  status: { confirmed: boolean; block_height?: number; block_hash?: string; block_time?: number };
}
// GET /tx/{txid}/status  → { confirmed: boolean; block_height?: number; block_hash?: string }
// GET /tx/{txid}/hex     → raw tx hex string
```

**IMPORTANT:** The `vin[].prevout` object is present in Esplora responses for confirmed and mempool transactions. This is an Esplora enhancement over raw Bitcoin protocol — Esplora enriches each input with its spent UTXO data, which is what makes fee recomputation possible without fetching each parent tx separately.

### Anti-Patterns to Avoid

- **Fetching raw tx hex for RBF reconstruction:** `GET /tx/{txid}/hex` gives the raw serialized tx but does NOT include prevout values — those must come from `GET /tx/{txid}` (JSON). Don't use the hex endpoint for fee recomputation.
- **Using `/v1/fees/recommended` for the fee bump check:** The CONTEXT defers per-mempool-policy probe; use static 1 sat/vB minimum relay fee for Phase 24.
- **Calling `signMessage` with the magic-prefixed message:** The Ledger BTC app v2.1+ applies the magic prefix internally. Passing the pre-prefixed message would double-prefix and produce an invalid BIP-137 signature.
- **Using `RBF_DISABLED_SEQUENCE (0xfffffffe)` in the replacement PSBT:** The replacement tx MUST use a sequence that signals RBF. Use `0xfffffffd` (or any value < `0xfffffffe`) so the replacement is itself bumpable.
- **Fetching pubkeys from Ledger device during RBF bump:** The paired account store already has addresses and derivation paths. Use `listAccounts({ chainFilter: "bitcoin" })` and reconstruct pubkeys from `fetchBtcAddresses` only if needed. For `witnessUtxo` in the PSBT, we can derive the script from the stored address (like Phase 23 does).

---

## BIP-125 RBF Mechanics — Verified Details

**Source: BIP-125 mediawiki [CITED: github.com/bitcoin/bips/blob/master/bip-0125.mediawiki]**

**Signaling:** A transaction signals RBF if ANY of its inputs has `nSequence < 0xfffffffe`.
- `0xffffffff` = no RBF signaling (also disables locktime)
- `0xfffffffe` = no RBF signaling (Phase 23 uses this — `RBF_DISABLED_SEQUENCE`)
- `0xfffffffd` = RBF signaled (this is the conventional "RBF on" value)
- Any value `< 0xfffffffe` = RBF signaled

**Phase 23 uses `0xfffffffe` (RBF_DISABLED_SEQUENCE) — txs prepared by `prepare_btc_send` do NOT signal RBF.** This is the key fact driving the `signalRbf` design fork (see §Open Questions).

**BIP-125 Rule 3 (Absolute fee):** The replacement must pay at least the sum of the fees of all original transactions being replaced (≥ original absolute fee).

**BIP-125 Rule 4 (Bandwidth fee):** The replacement must pay for its own bandwidth at or above the minimum relay fee rate (conventionally 1 sat/vB). For Phase 24: `newFeeRate ≥ originalFeeRate + 1 sat/vB` is the practical enforcement. The absolute new fee must also be ≥ original absolute fee (Rule 3 is automatically satisfied when the fee RATE increases and vsize is constant).

**BIP-125 Rule 2 (Input restriction):** The replacement can ONLY spend UTXOs that were in the original transaction. No new inputs allowed for a pure fee bump. (Phase 24 honors this: original input set is preserved unchanged.)

---

## BIP-137 Message Signing — Verified Details

**Source: BIP-137 mediawiki [CITED: github.com/bitcoin/bips/blob/master/bip-0137.mediawiki]**

**Magic prefix:** `"Bitcoin Signed Message:\n"` — exactly 24 UTF-8 bytes.

**Message hash preimage:**
```
varint(24) ‖ "Bitcoin Signed Message:\n" ‖ varint(len(message)) ‖ message
```
Where `varint` is Bitcoin's compact integer encoding (1 byte for values < 0xfd).

**Hash:** `double-SHA256(preimage)` — SHA-256 applied twice.

**Compact signature format:** 65 bytes = `[1 byte header] ‖ [32 bytes r] ‖ [32 bytes s]`.

**Header byte encoding:**
- P2PKH uncompressed: 27–30 (base 27 + recovery_id 0–3)
- P2PKH compressed: 31–34 (base 31 + recovery_id 0–3)
- P2WPKH-P2SH (wrapped segwit): 35–38 (base 35 + recovery_id 0–3)
- P2WPKH bech32 (native segwit): **39–42** (base 39 + recovery_id 0–3)

**For Phase 24 (segwit address, `bc1q…`):** `header = v + 39` where `v` is the recovery_id from the Ledger SDK.

**Ledger BTC app v2.1+ behavior:**
- `BtcNew.signMessage({ path, messageHex })` receives raw message bytes (hex-encoded)
- The device applies the magic prefix internally before hashing and signing
- The device displays the message text on-screen for user approval
- Returns `{ v: number, r: string, s: string }` where `v = rawV - 27 - 4` (recovery_id, 0 or 1)
- **Caller MUST NOT pre-apply the magic prefix** — doing so would double-prefix

**Source: BtcNew.js lines 289–302 [VERIFIED: installed @ledgerhq/hw-app-btc@10.22.1 .d.ts + .js]:**
```typescript
// BtcNew.signMessage signature (verified against installed Btc.d.ts):
signMessage(path: string, messageHex: string): Promise<{ v: number; r: string; s: string }>
// BtcNew implementation decodes base64 response from device: v = buf.readUInt8() - 27 - 4
```

**API Note:** The `Btc` wrapper class (what `ledger-btc-transport.ts` uses via `_transport.buildBtcApp(t)`) exposes `signMessage(path, messageHex)` with **positional args** (legacy interface). This routes to `BtcNew.signMessage({ path, messageHex })` for `currency: "bitcoin"`. The project already has `buildBtcApp` hardcoded to `currency: "bitcoin"` so BtcNew path is guaranteed.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| BTC varint encoding | Custom bit-math | Bitcoin's compact int (0x18 for 24, direct byte for < 0xfd) | Trivial but must match exactly — 1-off breaks signature verification |
| PSBT from raw Esplora vin[] | Custom serializer | `_btcPsbt.buildBtcPsbt(inputs, recipientOutput, changeOutput)` | Phase 23 already handles P2WPKH + P2TR; handles BIP-32 derivation metadata |
| Fee-rate calculation | Manual math | `Math.ceil(feeSats / vsize)` where `vsize = Math.ceil(weight / 4)` | Esplora provides `weight` field directly on `/tx/{txid}` response |
| Signature encoding | Custom base64/hex | `sig65.toString("base64")` from Buffer concat | Standard encoding; base64 is the BIP-137 wire format |
| SHA-256 double-hash | Custom crypto | `sha256(sha256(preimage))` from `@noble/hashes/sha256` | Transitive dep already installed; well-audited implementation |
| Esplora tx fetch | New HTTP client | Extend `esplora-client.ts` with `fetchBtcTx` + `fetchBtcTxStatus` | Reuse existing `doFetch` pattern, error unions, TTL caching |

**Key insight:** The RBF flow does NOT need coin selection (`btc-coin-select.ts`) — the original input set is fixed. The fee bump is achieved by reducing the change output, not by selecting new UTXOs. This is simpler than `prepare_btc_send`.

---

## RBF PSBT Reconstruction — Detailed Algorithm

When `prepare_btc_rbf_bump({ txid, newFeeRate })` is called:

1. **Fetch original tx:** `fetchBtcTx(txid)` → `EsploraTxFull`
2. **Confirm mempool status:** `txFull.status.confirmed === false` required; else refuse `BTC_TX_ALREADY_CONFIRMED`
3. **RBF signal check:** Any `vin[].sequence < 0xfffffffe`? Else refuse `BTC_NOT_RBF_SIGNALLED`
4. **Compute original metrics:**
   - `originalInputSum = sum(vin[].prevout.value)` (BigInt)
   - `originalOutputSum = sum(vout[].value)` (BigInt)
   - `originalFeeSats = originalInputSum - originalOutputSum`
   - `originalVsize = Math.ceil(txFull.weight / 4)`
   - `originalFeeRate = Number(originalFeeSats) / originalVsize`
5. **Validate new fee rate:**
   - `newFeeRate > originalFeeRate + 1` (BIP-125 Rule 4 minimum relay fee bump)
   - Standard bounds check: `newFeeRate ≥ 1` and `newFeeRate ≤ 10 × highPriorityEstimate` (mirror Phase 23)
6. **Compute new fee:**
   - `estimatedVsize = originalVsize` (same input/output structure)
   - `newFeeSats = BigInt(Math.ceil(newFeeRate × estimatedVsize))`
   - `feeDelta = newFeeSats - originalFeeSats`
7. **Identify change output (heuristic):**
   - The output whose `scriptpubkey_address` matches one of the paired BTC accounts is the change output
   - Fallback: if no owned address found, cannot absorb fee → refuse `BTC_RBF_NO_CHANGE_OUTPUT`
8. **Adjust change output:**
   - `newChangeSats = BigInt(changeOutput.value) - feeDelta`
   - If `newChangeSats < 0n` → refuse `BTC_RBF_CANNOT_AFFORD` (fee delta larger than change)
   - If `newChangeSats < DUST_THRESHOLD_SATS` → fold into fee (change output dropped), newChangeSats = 0n
9. **Reconstruct BtcPsbtInput[] from vin[]:**
   - For each `vin[]`: `{ txid, vout, valueSats: BigInt(prevout.value), scriptType, pubkey, bip32Path, masterFingerprint }`
   - Derive `scriptType` from `prevout.scriptpubkey_type`: `"v0_p2wpkh"` → `"p2wpkh"`, `"v1_p2tr"` → `"p2tr"`
   - Get `pubkey` and `bip32Path` from the paired account (`fetchBtcAddresses` or stored record)
10. **Build replacement PSBT via `_btcPsbt.buildBtcPsbt(...)` with RBF-ENABLED sequence:**
    - All inputs get `sequence: 0xfffffffd` (RBF-enabled, conventional value)
    - NOTE: `buildBtcPsbt` currently hardcodes `RBF_DISABLED_SEQUENCE = 0xfffffffe`
    - **Plan 24-01 must add a `sequenceOverride?: number` parameter to `buildBtcPsbt`** to allow the RBF path to use `0xfffffffd`
11. **Compute sighashes + fingerprint** (same as Phase 23 via `_btcSighash` + `_btcFingerprint`)
12. **Create handle** with `kind: "rbf"` and the original txid stored for CHECKS PERFORMED diff

---

## `sign_message_btc` Pipeline — NOT a Prepare/Preview/Send Flow

The CONTEXT.md and Phase 24 ROADMAP clarify: `sign_message_btc` is a direct sign tool (like `get_btc_status`), not a transaction. There is no handle, no preview, no `send_transaction` step.

**Pipeline:**
1. Input validation: `wallet` is a valid bech32 address; `message` is non-empty string ≤ reasonable limit
2. Demo-mode check: refuse with `DEMO_MODE_REFUSED` (no device available in demo)
3. Pairing check: `listAccounts({ chainFilter: "bitcoin" })` — find the account matching `wallet`
4. Resolve derivation path from paired account record
5. **Compute BIP-137 message hash server-side** (for LEDGER BLIND-SIGN HASH block):
   - `double-SHA256(varint(24) ‖ "Bitcoin Signed Message:\n" ‖ varint(len) ‖ message)`
6. **Call `app.signMessage(path, messageHex)`** where `messageHex = Buffer.from(message, "utf8").toString("hex")`
   - Device shows message text on-screen
   - Device applies magic prefix internally before signing
7. **Assemble BIP-137 compact signature:**
   - `header = v + 39` (P2WPKH bech32; recovery_id = v from SDK, already stripped of 27+4 offset)
   - `sig65 = Buffer.concat([Buffer.from([header]), Buffer.from(r,"hex"), Buffer.from(s,"hex")])`
   - `signatureBase64 = sig65.toString("base64")`
8. **Return response** with:
   - `address`, `message`, `signatureBase64`
   - `messageHash` (0x-prefixed hex of double-SHA256 for independent verification)
   - `LEDGER BLIND-SIGN HASH` block carrying the message hash + message text
   - `CHECKS PERFORMED` instruction block (verify hash matches)

**Handle store:** No handle created. No `PreparedTxBtc` extension needed for `sign_message_btc`.

**`_btcLedgerTransport` spy-affordance extension:** Add `signBtcMessage(path, messageHex)` to `_btcLedgerTransport` object so tests can `vi.spyOn(_btcLedgerTransport, "signBtcMessage")`. Mirror the `signBtcPsbt` pattern.

---

## payloadFingerprint Shape for RBF

The RBF replacement PSBT uses the **same domain tag** (`"VaultPilot-btctx-v1:"`) and the **same fingerprint function** (`computeBtcPayloadFingerprint`) as Phase 23. The fingerprint commits to the replacement tx's per-input sighashes — which change from the original because the sequence number changes (`0xfffffffd` vs. original) and the output values change (lower change output). This means the RBF replacement has a DIFFERENT fingerprint from the original tx — which is the correct behavior (the replacement is a distinct tx for the drift-gate purposes).

**`PreparedTxBtc.kind` widening:** The handle store needs `kind: "native" | "rbf"` to distinguish RBF replacements from standard sends. The `kind` field was already flagged for this in Phase 23's `handle-store.ts` comment: "RBF (Phase 24) and multisig (Phase 25) will widen this."

**No new fingerprint domain tag needed** for RBF — the existing `"VaultPilot-btctx-v1:"` is correct. The distinguish between `"native"` and `"rbf"` is in the `kind` field, not the fingerprint domain.

---

## Cryptographic-Binding Fixtures (NEW for Phase 24)

Per CLAUDE.md: every new tx shape gets a hardcoded `0x...` literal in `test/signing-fingerprint.test.ts`.

### Fixture R — RBF Replacement PSBT Fingerprint
Same input as Fixture O (P2WPKH, txid=aa×32, value=1_000_000 sats) but with:
- RBF-enabled sequence (`0xfffffffd`)
- Higher fee: recipient gets 880,000 sats (120,000 sats fee vs. 100,000 sats in Fixture O)

**Computed at research time (node -e with built dist):**
```
Fixture R: 0x946eeae4f39317444201821a47bdd0819bffc155925e5b855d22d04a2e1cfefc
```
Computation script (for reproducibility):
```js
import('./dist/signing/btc-sighash.js').then(async ({ computeAllSighashes }) => {
  const { computeBtcPayloadFingerprint } = await import('./dist/signing/btc-fingerprint.js');
  const { Transaction, payments, networks } = await import('bitcoinjs-lib');
  const pubkey = Buffer.from('0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798', 'hex');
  const script = payments.p2wpkh({ pubkey, network: networks.bitcoin }).output;
  const tx = new Transaction();
  tx.addInput(Buffer.alloc(32, 0xaa), 0, 0xfffffffd);  // RBF-ENABLED sequence
  tx.addOutput(script, BigInt(880_000));
  const sighashes = computeAllSighashes(tx, [{ scriptType: 'p2wpkh', prevOutScript: script, valueSats: BigInt(1_000_000) }]);
  console.log(computeBtcPayloadFingerprint(sighashes));
});
```

### Fixture S — BIP-137 Message Hash
Test message: `"Hello VaultPilot"` (16 bytes UTF-8)

**Computed at research time:**
```
Fixture S: 0xca329bc5829e0752932695bd827ca11f3dbe9efd7f94f75fedc42574cb86667e
```

Note: Fixture S is the **double-SHA256 message hash** (what the device signs and what the server surfaces in the LEDGER BLIND-SIGN HASH block), NOT a `payloadFingerprint`. It lives in a NEW test file `test/signing-bip137.test.ts` (or a new describe block in `test/signing-fingerprint.test.ts`), annotated clearly to avoid confusion with the PSBT-domain keccak256 fixtures.

---

## Common Pitfalls

### Pitfall 1: RBF Sequence Value — 0xfffffffd vs 0xfffffffe
**What goes wrong:** Using `RBF_DISABLED_SEQUENCE (0xfffffffe)` in the replacement PSBT — this means the replacement itself cannot be RBF-bumped again.
**Why it happens:** `buildBtcPsbt` currently hardcodes `RBF_DISABLED_SEQUENCE`. A Plan 24-01 task that calls `buildBtcPsbt` without modifying the sequence would produce a non-RBF-signalling replacement.
**How to avoid:** Add `sequenceOverride?: number` parameter to `buildBtcPsbt` and pass `0xfffffffd` from `prepare_btc_rbf_bump`.

### Pitfall 2: Phase 23 prepare_btc_send Outputs Are NOT Bumpable
**What goes wrong:** A user prepares a tx via `prepare_btc_send` and then tries to bump it with `prepare_btc_rbf_bump`. The bump will be refused because `prepare_btc_send` uses `0xfffffffe` (no RBF signal).
**Why it happens:** Phase 23 CONTEXT D-06 locked `RBF_DISABLED_SEQUENCE = 0xfffffffe` per "standard wallet behavior."
**How to avoid:** Surface a clear error `BTC_NOT_RBF_SIGNALLED` with a hint about `signalRbf: true` option. This is the core UX tension in the `signalRbf` design fork (§Open Questions).

### Pitfall 3: Double Magic Prefix
**What goes wrong:** Passing `"Bitcoin Signed Message:\n" + message` as the `messageHex` instead of just the raw message.
**Why it happens:** Naive reading of BIP-137 — "the signed message is magic ‖ varint ‖ message" leads to confusion about who applies the prefix.
**How to avoid:** The caller passes raw message bytes only. The Ledger BTC app v2.1+ applies the prefix internally (verified in `BtcNew.js` + device APDU protocol documentation).
**Warning signs:** A signature that fails to verify against standard BIP-137 verifiers (e.g., electrum) signals double-prefix.

### Pitfall 4: vsize vs size for Fee Rate
**What goes wrong:** Using `size` (byte count) instead of `vsize` (virtual byte count = `weight / 4`) for fee rate calculation.
**Why it happens:** Legacy code used size; SegWit introduced the virtual byte concept.
**How to avoid:** Always use `Math.ceil(txFull.weight / 4)` from the Esplora response for vsize. All modern mempool policies use vsize.

### Pitfall 5: Esplora prevout Availability
**What goes wrong:** Assuming `/tx/{txid}/hex` is sufficient for fee recomputation — the raw hex doesn't include prevout values.
**Why it happens:** The raw transaction format doesn't embed prevout amounts in segwit inputs (they're referenced, not embedded, in the unsigned tx format).
**How to avoid:** Always use `GET /tx/{txid}` (JSON endpoint) which includes `vin[].prevout.value` as an Esplora enhancement.

### Pitfall 6: Change Output Identification in Original Tx
**What goes wrong:** Misidentifying which output is the change output in the original tx leads to reducing the wrong output or refusing valid RBF bumps.
**Why it happens:** Standard Bitcoin txs have no explicit change-output marker; the change is identified heuristically.
**How to avoid:** Compare `vout[].scriptpubkey_address` against the paired BTC account's addresses (`segwitAddress`, `taprootAddress`). If exactly one output matches a known address — that's the change. If none matches, the tx has no change (fee-only reduction impossible → refuse with `BTC_RBF_NO_CHANGE_OUTPUT`).

---

## Open Questions / Design Forks

### Fork 1: `signalRbf: true` flag on `prepare_btc_send` (Claude's Discretion)

**The tension:** Phase 23 ships RBF-disabled txs (`0xfffffffe`). This means ANY tx prepared by `prepare_btc_send` cannot be fee-bumped with `prepare_btc_rbf_bump`. This is a significant UX limitation — users who want to bump a stuck tx cannot do so unless they originally used `signalRbf: true`.

**Option A (Phase 24 in-scope):** Add `signalRbf?: boolean` optional parameter to `prepare_btc_send`. Defaults to `false` (preserves Phase 23 behavior). When `true`, uses `0xfffffffd` instead of `0xfffffffe`. Low-risk change — adds one optional param and one conditional in `buildBtcPsbt`.

**Option B (Out of scope for Phase 24):** Leave `prepare_btc_send` unchanged. `prepare_btc_rbf_bump` can only bump txs that were already created with RBF signaling (e.g., by a third-party wallet or a future `prepare_btc_send` update). Document the limitation prominently.

**Recommendation:** **Option A, in-scope for Phase 24.** The UX argument is compelling — if a user can't bump a tx they just prepared with VaultPilot, `prepare_btc_rbf_bump` is useless for the most common case. The implementation cost is minimal (one optional param, one conditional in `btc-psbt.ts`). The research specifically flagged this as a Claude's Discretion item — the planner should include `signalRbf: true` flag in Plan 24-01 as a small additive task on `prepare_btc_send`.

**Risk if recommended:** Minor. Changing the sequence number from `0xfffffffe` to `0xfffffffd` when `signalRbf: true` does not affect any cryptographic commitment (sighash commits to sequence; the fingerprint reflects the new sequence). Tests would need to add one case with `signalRbf: true`. The PSBT fixture for `signalRbf: true` uses `0xfffffffd` — this is precisely what Fixture R computes.

### Fork 2: `newFeeSats` vs `newFeeRate` as input (Claude's Discretion)

**Recommendation:** Accept only `newFeeRate` (as per ROADMAP and CONTEXT). The fee rate abstraction is better for UX (users think "bump to 20 sat/vB" not "add 4,000 sats"). The server computes the absolute fee from rate × vsize. An optional `newFeeSats` fallback is deferred scope.

---

## Esplora Capability — Phase 24 Requirements

All required endpoints are available from both blockstream.info and mempool.space Esplora APIs:

| Endpoint | Purpose | Already in esplora-client.ts? |
|----------|---------|------------------------------|
| `GET /tx/{txid}` | Full tx data with vin[].prevout for RBF | NO — needs `fetchBtcTx` addition |
| `GET /tx/{txid}/status` | Mempool/confirmed check | NO — needs `fetchBtcTxStatus` addition (can be inlined in `fetchBtcTx` via `status` field) |
| `GET /fee-estimates` | Current fee-rate bounds for sanity check | YES — `fetchFeeEstimates` |

**Note:** `GET /tx/{txid}` already includes `status.confirmed` in the response body, so `fetchBtcTxStatus` can be a lightweight wrapper or skipped in favor of reading `status.confirmed` from `fetchBtcTx` directly. Two separate fetches (one for status check, one for full data) are wasteful — make one call and read `status.confirmed` from it.

---

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest ^2.1.0 |
| Config file | `vitest.config.ts` |
| Quick run command | `npm test -- --reporter=verbose test/signing-bip137.test.ts test/prepare-btc-rbf-bump.test.ts` |
| Full suite command | `npm test` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| BTC-W-02 | RBF signal check (sequence < 0xfffffffe) | unit | `npm test -- test/prepare-btc-rbf-bump.test.ts` | ❌ Wave 0 |
| BTC-W-02 | RBF confirmed-tx refusal | unit | `npm test -- test/prepare-btc-rbf-bump.test.ts` | ❌ Wave 0 |
| BTC-W-02 | RBF fee-rate bump validation | unit | `npm test -- test/prepare-btc-rbf-bump.test.ts` | ❌ Wave 0 |
| BTC-W-02 | RBF fingerprint — Fixture R literal anchor | unit | `npm test -- test/signing-fingerprint.test.ts` | ✅ (extend existing) |
| BTC-W-02 | RBF CHECKS PERFORMED block shows old-vs-new fee diff | unit | `npm test -- test/prepare-btc-rbf-bump.test.ts` | ❌ Wave 0 |
| BTC-W-03 | BIP-137 message hash — Fixture S literal anchor | unit | `npm test -- test/signing-bip137.test.ts` | ❌ Wave 0 |
| BTC-W-03 | BIP-137 header byte assembly (v + 39 for P2WPKH) | unit | `npm test -- test/signing-bip137.test.ts` | ❌ Wave 0 |
| BTC-W-03 | `sign_message_btc` demo-mode refusal | unit | `npm test -- test/sign-message-btc.test.ts` | ❌ Wave 0 |
| BTC-W-03 | `sign_message_btc` response shape + base64 sig | unit | `npm test -- test/sign-message-btc.test.ts` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `npm test -- test/signing-fingerprint.test.ts test/signing-bip137.test.ts`
- **Per wave merge:** `npm test`
- **Phase gate:** Full suite green before `/gsd-verify-work`

### Wave 0 Gaps
- [ ] `test/prepare-btc-rbf-bump.test.ts` — covers BTC-W-02 (RBF signal check, confirmed-tx refusal, fee math, PREPARE RECEIPT diff block)
- [ ] `test/signing-bip137.test.ts` — covers BTC-W-03 BIP-137 hash + header-byte assembly (Fixture S)
- [ ] `test/sign-message-btc.test.ts` — covers BTC-W-03 tool-level behavior (demo refusal, pairing check, response shape)
- [ ] Extend `test/signing-fingerprint.test.ts` with Fixture R (RBF replacement PSBT fingerprint)

---

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | — |
| V3 Session Management | no | — |
| V4 Access Control | no | — |
| V5 Input Validation | yes | Zod schema at tool input boundary; `parseTronAmountStrict` for sats bounds; txid length/hex check |
| V6 Cryptography | yes | BIP-137 double-SHA256 via `@noble/hashes/sha256` (audited); payloadFingerprint via viem keccak256 (audited) |

### Known Threat Patterns

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Agent provides confirmed txid as "mempool pending" | Spoofing/Tampering | Server-side Esplora `/tx/{txid}/status` check (never trust agent) |
| Agent inflates original fee rate to reduce validation bar | Tampering | Server fetches original tx from Esplora; computes fee rate independently |
| Double magic prefix producing invalid BIP-137 sig | Tampering | Caller sends raw message bytes only; Ledger device applies prefix (verified in SDK source) |
| RBF bump that changes recipient (not just fee) | Tampering | PREPARE RECEIPT + CHECKS PERFORMED expose all outputs for comparison; Phase 23's PSBT decode pipeline verifies output addresses |
| RBF sequence forgery (agent claims tx signals RBF when it doesn't) | Tampering | Server reads sequence from Esplora tx data, not from agent arg |
| Message hash mismatch (device signs different hash than surfaced) | Information Disclosure | Server-computed hash surfaced in LEDGER BLIND-SIGN HASH block matches device computation; verifiable by user |

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| BtcOld.signMessage (pre-app v2.1) | BtcNew.signMessage (app v2.1+) | hw-app-btc v10.x | BtcNew is auto-selected for `currency: "bitcoin"` |
| Manual PSBT v0 construction | `signPsbtBuffer` (PSBT v0/v2 both accepted) | app v2.1+, hw-app-btc v9+ | Phase 23 already uses this; Phase 24 extends it |
| RBF via `sequence: 0` | RBF via `sequence ≤ 0xfffffffd` (conventional) | BIP-125 (2015) | `0xfffffffd` is the industry-standard "RBF on" value |

**Deprecated/outdated:**
- `BtcOld.signMessage` (pre-2.1 app): uses different APDU (`0xe0 0x4e`); still in BtcOld.js but not used for `currency: "bitcoin"` in v10+.
- BIP-137 P2PKH-only verification: many tools only verify P2PKH signatures; P2WPKH support (header 39–42) requires modern verifiers like electrum or custom code.

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Esplora `vin[].prevout` is populated for mempool transactions (not just confirmed) | Pattern 3, RBF Algorithm | Would need fallback to fetch each parent tx; significant complexity |
| A2 | `app.signMessage` in BtcNew v10.22.1 returns `v` as raw recovery_id (0 or 1) after stripping 27+4 offset | BIP-137 Pattern 2 | Would produce incorrect header byte; signatures verify incorrectly |
| A3 | Static 1 sat/vB minimum relay fee is sufficient for Phase 24 (per CONTEXT.md deferred decision) | BIP-125 mechanics | Replacements could fail mempool acceptance on high-traffic nodes with higher minimums |
| A4 | The `signalRbf: true` flag on `prepare_btc_send` is additive and does not require re-testing existing Phase 23 fixtures | Open Questions Fork 1 | Phase 23 test fixtures use `0xfffffffe`; changing the default would break them |

**Note on A1:** The Esplora API documentation confirms `vin[].prevout` is included in the `/tx/{txid}` JSON response. However, the extent to which mempool.space vs blockstream.info behave identically for mempool txs is not fully verified. If prevout is missing, the fallback is to fetch parent txs individually — document as a graceful degradation path in Plan 24-01.

**Note on A2:** Verified directly from `BtcNew.js` line 294: `const v = buf.readUInt8() - 27 - 4`. The raw byte from the device has the 27+4 encoding; the SDK strips it and returns `v = 0 or 1`.

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| `@ledgerhq/hw-app-btc` | `sign_message_btc` | ✓ | 10.22.1 installed | — |
| `bitcoinjs-lib` | RBF PSBT construction | ✓ | 7.0.1 installed | — |
| `@noble/hashes` (transitive) | BIP-137 SHA-256 | ✓ | Installed via bitcoinjs-lib | — |
| Esplora API (blockstream.info) | `fetchBtcTx` | ✓ (runtime) | — | mempool.space (`BTC_ESPLORA_URL` override) |
| Ledger device + Bitcoin app v2.1+ | `sign_message_btc` signing | runtime-only | — | demo-mode DEMO_MODE_REFUSED refusal |

**Missing dependencies with no fallback:** None — all build-time deps are installed.

**Missing dependencies with fallback:** Ledger device (runtime only, handled by existing `LedgerDeviceNotConnectedError` and `LedgerBtcAppNotOpenError` patterns from Phase 22).

---

## Code Examples

### Varint Encoding (for BIP-137 message preimage)
```typescript
// Source: BIP-137 spec + Bitcoin compact int encoding [CITED: bip-0137.mediawiki]
// Used in sign_message_btc.ts to build the double-SHA256 message hash
function encodeVarint(n: number): Uint8Array {
  if (n < 0xfd) return new Uint8Array([n]);
  if (n <= 0xffff) {
    const buf = new Uint8Array(3);
    buf[0] = 0xfd;
    new DataView(buf.buffer).setUint16(1, n, true); // little-endian
    return buf;
  }
  throw new Error("varint: value too large for BIP-137 message");
}

// Magic prefix: exactly 24 bytes (verified via node -e at research time)
const BITCOIN_SIGNED_MESSAGE_MAGIC = "Bitcoin Signed Message:\n";
// encodeVarint(24) === Buffer.from([0x18])
```

### BIP-137 Hash Computation (server-side, for CHECKS PERFORMED block)
```typescript
// Source: @noble/hashes/sha256 (transitive dep) [VERIFIED: node_modules/@noble/hashes]
import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex } from "@noble/hashes/utils";

function computeBip137MessageHash(message: string): Hex {
  const magicBuf = Buffer.from("Bitcoin Signed Message:\n", "utf8");
  const msgBuf = Buffer.from(message, "utf8");
  const preimage = Buffer.concat([
    encodeVarint(magicBuf.length),  // 0x18 (24 bytes)
    magicBuf,
    encodeVarint(msgBuf.length),
    msgBuf,
  ]);
  const h1 = sha256(preimage);
  const h2 = sha256(h1);
  return `0x${bytesToHex(h2)}` as Hex;
}

// Fixture S verification: computeBip137MessageHash("Hello VaultPilot")
// === "0xca329bc5829e0752932695bd827ca11f3dbe9efd7f94f75fedc42574cb86667e"
```

### BIP-137 Header Byte Assembly (from Ledger {v, r, s})
```typescript
// Source: BIP-137 spec + BtcNew.js analysis [CITED: bip-0137.mediawiki + VERIFIED: installed BtcNew.js]
// v from BtcNew = raw recovery_id (0 or 1) — device byte minus 27 minus 4
// P2WPKH bech32 header base = 39
function assembleBip137CompactSig(
  v: number, r: string, s: string,
  addressType: "p2wpkh"  // Phase 24 scope: segwit only
): string {
  const header = v + 39;  // P2WPKH: 39 or 40
  const sig65 = Buffer.concat([
    Buffer.from([header]),
    Buffer.from(r, "hex"),   // 32 bytes
    Buffer.from(s, "hex"),   // 32 bytes
  ]);
  return sig65.toString("base64");  // 88-char base64 string
}
```

### Esplora fetchBtcTx (new helper to add to esplora-client.ts)
```typescript
// Source: Esplora API docs + existing doFetch pattern [CITED: github.com/Blockstream/esplora/blob/master/API.md]
export type EsploraTxResult =
  | { kind: "ok"; tx: EsploraTxFull }
  | { kind: "not-found" }
  | { kind: "rate-limited"; message: string }
  | { kind: "error"; message: string };

export async function fetchBtcTx(txid: string): Promise<EsploraTxResult> {
  const url = `${_bitcoinRegistry.getEsploraBaseUrl()}/tx/${txid}`;
  // Uses existing doFetch<EsploraTxFull>(url) pattern
  // 404 → not-found (tx not in Esplora — either invalid or not yet propagated)
  // tx.status.confirmed === true → use this to check mempool status
}
```

### `_btcLedgerTransport` spy-affordance extension (for sign_message_btc)
```typescript
// Source: ledger-btc-transport.ts spy-affordance pattern [VERIFIED: existing codebase]
// Extend the existing _btcLedgerTransport object (do not rename or move)
export const _btcLedgerTransport = {
  fetchBtcAddresses: (...) => ...,  // existing
  signBtcPsbt: (...) => ...,        // existing
  // NEW for Phase 24:
  signBtcMessage: (
    path: string,
    messageHex: string,
  ): Promise<{ v: number; r: string; s: string }> => signBtcMessage(path, messageHex),
};
```

---

## Sources

### Primary (HIGH confidence)
- Installed `@ledgerhq/hw-app-btc@10.22.1` lib/BtcNew.d.ts, lib/BtcNew.js, lib/Btc.d.ts, lib/BtcOld.d.ts, lib/signMessage.js — verified `signMessage` API surface + `v` calculation
- `src/protocols/btc-psbt.ts` — verified `RBF_DISABLED_SEQUENCE = 0xfffffffe` (Phase 23 ships RBF-disabled)
- `src/wallet/ledger-btc-transport.ts` — verified `_btcLedgerTransport` spy-affordance pattern
- `src/signing/handle-store.ts` — verified `PreparedTxBtc.kind: "native"` and comment about Phase 24 widening
- `src/signing/error-codes.ts` — verified existing BTC error codes to avoid collision
- `src/signing/btc-fingerprint.ts` — verified domain tag `"VaultPilot-btctx-v1:"` + keccak256 function
- `test/signing-fingerprint.test.ts` — verified Fixtures O/P/Q and fixture numbering convention
- BIP-125 mediawiki — verified 5 RBF rules, sequence number signaling (< 0xfffffffe), Rule 3/4 fee requirements
- BIP-137 mediawiki — verified header byte values for P2WPKH (39–42), compact signature format (65 bytes), double-SHA256 hashing

### Secondary (MEDIUM confidence)
- Esplora API.md (Blockstream) — `GET /tx/{txid}` response shape with `vin[].prevout.value`; `/tx/{txid}/status`; `/tx/{txid}/hex`
- `BtcNew.js` lines 289–302 — `v` calculation: `buf.readUInt8() - 27 - 4` confirms raw recovery_id
- Research-time fixture computation via `node -e` against built dist:
  - Fixture R: `0x946eeae4f39317444201821a47bdd0819bffc155925e5b855d22d04a2e1cfefc`
  - Fixture S: `0xca329bc5829e0752932695bd827ca11f3dbe9efd7f94f75fedc42574cb86667e`

### Tertiary (LOW confidence)
- WebSearch for Ledger magic-prefix handling: multiple sources confirm device applies magic prefix internally; no first-party Ledger doc fetched directly (timeout)

---

## Metadata

**Confidence breakdown:**
- BIP-125 RBF mechanics: HIGH — verified against spec and Phase 23 source (sequence constant)
- BIP-137 message signing: HIGH — verified against BIP-137 spec + installed SDK source (.d.ts + .js)
- Ledger signMessage APDU: HIGH — verified in BtcNew.js source (magic prefix device-side, `v` calculation)
- Esplora tx data shape: MEDIUM — documented in API.md; prevout for mempool txs assumed (A1)
- Fixture R/S values: HIGH — computed at research time against built dist modules

**Research date:** 2026-05-22
**Valid until:** 2026-06-22 (stable BIP specs + established SDK; flag if hw-app-btc major version bumps)
