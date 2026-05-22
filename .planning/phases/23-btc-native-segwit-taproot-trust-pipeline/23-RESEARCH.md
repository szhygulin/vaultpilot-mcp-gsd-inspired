# Phase 23: BTC native + segwit + taproot trust pipeline (PSBT-based) — Research

**Researched:** 2026-05-22
**Domain:** UTXO-model signing trust pipeline — PSBT (BIP-174) construction + per-input BIP-143/BIP-341 sighash binding + Ledger BTC-app PSBT signing
**Confidence:** HIGH — all three design forks (DF-1/DF-2/DF-3) resolved against installed `.d.ts` + runtime probes of `bitcoinjs-lib@7.0.1` and `@ledgerhq/hw-app-btc@10.22.1` in `/tmp/btc-probe`. One **load-bearing conflict surfaced** (mixed-input signing — see DF-3 + Open Question #1).

## Summary

Phase 23 ships the **prepare → preview → send** trust pipeline for native BTC, mirroring Phase 4 (EVM) / Phase 12 (Solana) / Phase 18 (TRON) but on the UTXO model. The structural divergences are real and load-bearing: the transaction is a **PSBT** (BIP-174), not a single signing blob; the `payloadFingerprint` commits to **N per-input sighashes concatenated**, not one whole-tx hash; coin-selection (BnB) is a genuinely new subsystem with no precedent in the codebase; and the Ledger BTC app signs via a **descriptor-wallet PSBT workflow** (`signPsbtBuffer`), not the legacy `createPaymentTransaction` flow.

All three design forks resolved cleanly against source-of-truth:
- **DF-1 — PSBT version: ship PSBT-v0 (BIP-174).** `bitcoinjs-lib@7.0.1`'s `Psbt` class is BIP-174-only — there is no BIP-370 `setInputCount`/`PSBT_GLOBAL_VERSION` API. `@ledgerhq/hw-app-btc@10.22.1`'s `signPsbtBuffer` **accepts a v0 buffer and converts it to v2 internally** (`parsePsbt.deserializePsbt` handles both). VaultPilot constructs v0; the Ledger layer up-converts. v2 construction is not an option with the installed `bitcoinjs-lib` and is not needed.
- **DF-2 — sighash byte-encoding: `Transaction.hashForWitnessV0` (BIP-143 segwit) + `Transaction.hashForWitnessV1` (BIP-341 taproot key-spend).** Both verified deterministic across repeated runs in the probe — identical bytes run-to-run. These are the two APIs the BTC fingerprint preimage consumes; both are stable to pin Fixtures O/P/Q as hardcoded `0x…` literals.
- **DF-3 — Ledger signing API: `Btc.signPsbtBuffer(psbtBuffer, options)`.** This is the v10 descriptor-wallet PSBT workflow. **Critical finding:** `signPsbtBuffer` **rejects mixed-script-type inputs in a single call** — `validateScriptTypeConsistency` throws `"Mixed input types detected in PSBT"` if one call sees both segwit and taproot internal inputs. SC#5 (mixed-script-type inputs) therefore requires **two sequential `signPsbtBuffer` calls** — one per script-type group — combined into the final transaction. See Open Question #1 for the resolution.

**Primary recommendation:** Build a PSBT-v0 with `bitcoinjs-lib.Psbt`; compute `payloadFingerprint` over `keccak256("VaultPilot-btctx-v1:" ‖ sighash₀ ‖ sighash₁ ‖ … ‖ sighashₙ₋₁)` where each sighash comes from `Transaction.hashForWitnessV0` (segwit input) or `hashForWitnessV1` (taproot input); sign via `signPsbtBuffer` with **per-script-type-group calls** to satisfy mixed-input support; broadcast the finalized tx via Esplora `POST /tx`. Coin-selection is a new `selectCoinsBnb` module (Erhardt BnB + largest-first fallback).

## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01 — Coin selection:** branch-and-bound (BnB) across the **full UTXO set regardless of script type** (BnB optimizes over bc1q + bc1p UTXOs together). Manual UTXO override always available. **FIFO/largest-first fallback** when BnB finds no clean match. Mixed-script-type inputs are a required success criterion (SC#5) — the BnB-default path exercises the mixed-input code path by construction.
- **D-02 — Change-output address:** change goes to a **fresh derived change-chain address** — next unused address on the change chain (`m/84'/0'/0'/1/k` segwit, `m/86'/0'/0'/1/k` taproot). Change script type **matches the dominant input script type**. Change MUST be a Ledger-derivable address on the paired account so the BTC app displays it as "change", not a send.
  - *Researcher must resolve:* Phase 22's xpub gap-limit scan covered the **receive** chain (chain `0`). Change-chain (chain `1`) index tracking is new — confirm whether to (a) extend the Phase 22 xpub scan to also scan chain `1`, or (b) track a per-account change index in the persistent cache. **→ Resolved below (Architecture Patterns / Pattern 4 + Open Question #3).**
- **D-03 — Default fee rate:** when `feeRate` omitted, default to the **~3-block (balanced) Esplora estimate** from `get_btc_fee_estimates` (the `{1,2,3,6,144}`-block projection shipped in Phase 22). `feeSats` always surfaced verbatim in the `PREPARE RECEIPT`. Fee-rate sanity bounds: prepare-time **refuses `feeRate` < 1 sat/vB or > 10× current high-priority estimate**.
- **D-04 — Demo mode:** demo-mode BTC send uses a **mempool-replay envelope** — demo produces a fully-formed PSBT + a simulated "broadcast accepted" envelope without touching a device, mirroring the Solana/TRON demo-mode signing shape. Wires to the BTC whale persona added in Phase 22.
- **D-05 — Fingerprint preimage:** `payloadFingerprint = keccak256("VaultPilot-btctx-v1:" ‖ <BIP-143 sighashes per input, concatenated>)` — domain-tagged, distinct from EVM/Solana/TRON tags, per-input commitment. Multi-input tx → multi-hash preimage. (BTC-PREP-01.)
- **D-06 — RBF disabled:** Phase 23 ships **RBF-disabled by default** — `sequence ≥ 0xfffffffe`. RBF signaling is Phase 24's concern.
- **D-07 — Dust-threshold enforcement:** outputs below the BIP-141 dust threshold (~330 sats segwit, ~546 sats legacy) refused at prepare-time.

### Claude's Discretion

- Fixture O/P/Q literal anchor values — researcher computes at execute time via `node -e`.
- Internal helper names (`buildBtcPsbt`, `selectCoinsBnb`, `deriveChangeAddress`, etc.).
- Test mocking strategy for the Ledger BTC-app transport (mirror the Solana/TRON USB-HID mock pattern).

### Deferred Ideas (OUT OF SCOPE)

- BIP-125 RBF + BIP-137 message signing — Phase 24.
- PSBT multisig flow (register / combine / sign / finalize) — Phase 25.
- LTC native send (mirrors BTC) + LiFi BTC bridging — Phase 26.
- BIP-322 taproot message signing — future tool (`sign_message_btc_bip322`).
- RBF signaling at prepare-time (`sequence < 0xfffffffe`) — Phase 24.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| BTC-PREP-01 | `payloadFingerprint = keccak256("VaultPilot-btctx-v1:" ‖ concat(BIP-143 sighashes per input))` — domain-tagged, prepare-time stable, distinct tag | DF-2 resolved — `Transaction.hashForWitnessV0`/`hashForWitnessV1` deterministic (probe-verified). New sibling `src/signing/btc-fingerprint.ts` mirrors `payload-fingerprint-tron.ts`; `keccak256`+`concat`+`toBytes` from viem. Domain tag `"VaultPilot-btctx-v1:"` = 21 UTF-8 bytes — distinct from EVM 23 / Solana 20 / TRON 21 (tag-length collision with TRON is harmless — the tag STRING differs). |
| BTC-PREP-02 | `preview_send` BTC branch surfaces decoded inputs/outputs + per-input sighash + Ledger PSBT-signing flow in `LEDGER BLIND-SIGN HASH` block (multi-hash for multi-input) | `preview_send.ts` BTC branch mirrors Solana/TRON branches. The "blind-sign hash" for BTC is the **set of per-input sighashes** (the device displays inputs/outputs/fee, not a single hash). Block template = new `blocks-btc.ts` sibling of `blocks-tron.ts`. |
| BTC-PREP-03 | `send_transaction` BTC branch enforces `previewToken` + `userDecision: "send"` + `payloadFingerprint` drift gate identically to EVM/Solana/TRON | FROZEN three-gate region of `send_transaction.ts` is byte-untouched; BTC dispatch arm is additive BELOW it via the `txType` discriminator (same site Phase 12 carved Solana / Phase 18 carved TRON). `handle-store.ts` `PreparedTx` union widens to add `PreparedTxBtc`; `txType` literal-union widens `…| "btc"`. |
| BTC-PSBT-01 | `prepare_btc_send({ to, sats, feeRate? })` returns `{ handle, psbt, inputs[], outputs[], feeSats, payloadFingerprint, prepareReceipt }`; BnB coin-selection + manual override; segwit AND taproot both work via the same tool | `bitcoinjs-lib.Psbt` (v0) construction verified. BnB = new `src/signing/btc-coin-select.ts` (no precedent — greenfield). `psbt` field is the base64 PSBT string. |
| BTC-PSBT-02 | Mixed-script-type inputs supported (some segwit + some taproot in one tx) | **DF-3 conflict:** `signPsbtBuffer` rejects mixed inputs in one call. Resolution: PSBT *construction* handles mixed inputs fine (`bitcoinjs-lib.Psbt` happily holds both); the *signing* step splits into per-script-type-group `signPsbtBuffer` calls. See Open Question #1. |
| BTC-W-01 | `prepare_btc_send` produces the canonical PSBT-based unsigned transaction; native segwit + taproot both supported | Covered by BTC-PSBT-01. `payments.p2wpkh` (segwit witnessUtxo) + `payments.p2tr` (taproot witnessUtxo + `tapInternalKey`) are the two input shapes. |
</phase_requirements>

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| UTXO fetch for coin-selection | API/Backend (Esplora HTTP) | — | Reuses Phase 22 `esplora-client.fetchAddressUtxos`; `BalanceReport.utxos[]` is the load-bearing shape. |
| Coin selection (BnB) | API/Backend (pure compute) | — | Deterministic, no I/O; pure-bigint module, regression-tested. New subsystem. |
| PSBT construction | API/Backend (`bitcoinjs-lib`) | — | Server assembles the unsigned PSBT-v0; agent supplies only `{ to, sats, feeRate? }` + optional UTXO override. |
| Sighash computation (fingerprint preimage) | API/Backend (`bitcoinjs-lib.Transaction`) | — | Per-input BIP-143/341 sighash; pure compute; the cryptographic-binding primitive. |
| Change-address derivation | API/Backend (`bitcoinjs-lib.bip32`) + Hardware | Hardware (Ledger displays as "change") | Server derives the change address from the paired xpub; the Ledger BTC app independently re-derives it to mark it "change". Both tiers must agree. |
| PSBT signing | Hardware (Ledger BTC app) | API/Backend (transport lifecycle) | The MCP server owns transport open/close; the Ledger BTC app owns keys + per-input signing. |
| Broadcast | API/Backend (Esplora `POST /tx`) | — | Finalized raw tx hex posted to Esplora; mirrors Solana USB-HID direct broadcast (not the WC bridge). |
| Demo simulation envelope | API/Backend (in-memory) | — | Process-local mempool-replay envelope; no device, no broadcast. |

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `bitcoinjs-lib` | `^7.0.1` `[VERIFIED: probe — installed in /tmp/btc-probe, version 7.0.1]` `[CITED: bitcoinjs-lib docs]` | PSBT-v0 construction (`Psbt`), per-input sighash (`Transaction.hashForWitnessV0/V1`), address↔script (`address.toOutputScript`), payment helpers (`payments.p2wpkh`/`p2tr`), BIP-32 child derivation | Already in `package.json` (Phase 22). Canonical pure-JS Bitcoin library; the `Psbt` + `Transaction` API surface was probed directly. |
| `@ledgerhq/hw-app-btc` | `^10.22.1` `[VERIFIED: probe — installed in /tmp/btc-probe, version 10.22.1]` | Ledger BTC-app interface — `signPsbtBuffer(psbtBuffer, options)` PSBT-signing workflow; `getWalletXpub` for xpub export; `getWalletPublicKey` (Phase 22) | Already in `package.json` (Phase 22). v10 = descriptor-wallet (`BtcNew`) protocol for BTC-app ≥ 2.1.0. |
| `@ledgerhq/hw-transport-node-hid` | `^6.33.2` `[VERIFIED: package.json — ALREADY INSTALLED]` | USB-HID transport — reused from Phase 11/17/22 | Zero new transport surface. |
| `bip32` | `^5.0.1` `[VERIFIED: package.json — ALREADY INSTALLED]` | `BIP32Factory(ecc)` — xpub→child-pubkey derivation for change-address derivation and known-address map | Phase 22 already adopted it for `xpub-scan.ts`. |
| `tiny-secp256k1` | `^2.2.4` `[VERIFIED: package.json — ALREADY INSTALLED]` | secp256k1 ECC backend for `bip32` + `bitcoinjs-lib.initEccLib` (required for taproot `p2tr`) | Phase 22 already adopted it; **Phase 23 must call `bitcoinjs-lib.initEccLib(ecc)` once at module load** — taproot `payments.p2tr` throws without an ECC backend (probe-confirmed). |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `viem` | `^2.48.0` (installed) | `keccak256` / `concat` / `toBytes` for the fingerprint preimage | The BTC fingerprint hash function is keccak256 (same binding-layer hash as EVM/Solana/TRON — D-05). Reuse viem's keccak as `payload-fingerprint-tron.ts` does. |
| `@ledgerhq/psbtv2` | (transitive of `@ledgerhq/hw-app-btc`) | `PsbtV2` — the v2 representation `signPsbtBuffer` converts to internally | **No direct import needed.** `signPsbtBuffer` accepts a v0 buffer and runs `deserializePsbt` (v0→v2) itself. Listed only to document the internal mechanism. |
| `@noble/hashes` | `^2.2.0` (transitive) | `bytesToHex` for Uint8Array→hex (Pitfall 6 from Phase 22 — `bitcoinjs-lib` v7 is Buffer-free) | Use `bytesToHex` instead of `.toString("hex")` on any `bitcoinjs-lib` v7 return value. |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| PSBT-v0 (BIP-174) | PSBT-v2 (BIP-370) | **Rejected by source-of-truth probe.** `bitcoinjs-lib@7.0.1`'s `Psbt` has no BIP-370 API (no `setInputCount`, no `PSBT_GLOBAL_VERSION` field — probe-confirmed: `psbt.setInputCount` is `undefined`). The `psbt.version` setter sets the *transaction* version (1/2), not the BIP-370 PSBT version. v2 construction is not possible with the installed library; v0 is the only option. `signPsbtBuffer` up-converts v0→v2 internally regardless, so there is zero functional loss. **DECISION: PSBT-v0.** |
| `signPsbtBuffer` (descriptor-wallet) | `createPaymentTransaction` (legacy `BtcOld` flow) | `createPaymentTransaction` is the pre-2.1.0 BTC-app protocol; it does NOT support taproot inputs (`bech32m` spending). The BTC app ≥ 2.1.0 (which all current Ledger firmware ships) routes through `BtcNew` → `signPsbtBuffer`. **DECISION: `signPsbtBuffer`** — it is the only path that handles taproot. |
| Hand-rolled BnB coin-selection | `coinselect` npm package | The `coinselect` package (`bitcoinjs/coinselect`) implements BnB + accumulative fallback but: (a) is a separate dependency with its own slopcheck/version-verification cost, (b) does not natively understand mixed segwit/taproot vbyte weights without a custom `feeRate`-per-input shim, (c) D-01 specifies a precise fallback order (BnB → FIFO/largest-first). A focused in-repo `selectCoinsBnb` is ~150 LOC of pure-bigint code, regression-testable with hardcoded fixtures, and matches the project's "pure-compute signing module" precedent (`aave-health.ts`, `compound-collateralization.ts`). **DECISION: in-repo `src/signing/btc-coin-select.ts`** — no new dependency. (If the planner prefers the package, it must be slopcheck-verified — see Open Question #2.) |

**Installation:**
```bash
# NOTHING NEW. All five core libraries are already in package.json from Phase 22.
# Verify the lockfile pins match before Plan 23-01:
npm view bitcoinjs-lib version           # → 7.0.1
npm view @ledgerhq/hw-app-btc version    # → 10.22.1
```

## Package Legitimacy Audit

Phase 23 installs **no new external packages** — every library it consumes (`bitcoinjs-lib`, `@ledgerhq/hw-app-btc`, `@ledgerhq/hw-transport-node-hid`, `bip32`, `tiny-secp256k1`, `viem`) was adopted and audited in Phase 22 or earlier. No `## Package Legitimacy Audit` table action is required for Phase 23.

| Package | Registry | Disposition |
|---------|----------|-------------|
| `bitcoinjs-lib` | npm | Pre-vetted (Phase 22 audit — established maintainers, no postinstall, 727k/wk). No change. |
| `@ledgerhq/hw-app-btc` | npm | Pre-vetted (Phase 22 audit — Ledger official org). No change. |
| `bip32` / `tiny-secp256k1` / `@ledgerhq/hw-transport-node-hid` | npm | Pre-vetted (Phase 22 + Phase 11). No change. |

**Packages removed due to slopcheck [SLOP] verdict:** none — no new packages.
**Packages flagged as suspicious [SUS]:** none.

*If the planner adopts the `coinselect` npm package instead of an in-repo BnB module (NOT recommended — see Alternatives Considered), that package MUST go through the full Package Legitimacy Gate before Plan 23-02. The in-repo recommendation avoids this entirely.*

## Architecture Patterns

### System Architecture Diagram

```
agent (Claude Code / Cursor / Desktop)
   │  prepare_btc_send({ to, sats, feeRate?, utxoOverride? })
   ▼
prepare_btc_send.ts ──────────────────────────────────────────┐
   │                                                          │
   ├─▶ esplora-client.fetchAddressUtxos(segwit + taproot)      │  PHASE 22 reuse
   │      → BalanceReport.utxos[]  (full UTXO set)             │
   │                                                          │
   ├─▶ btc-coin-select.selectCoinsBnb(utxos, targetSats,       │  NEW (D-01)
   │      feeRate)  → { selectedInputs[], changeSats }         │
   │      └─ fallback: largest-first if BnB no clean match     │
   │                                                          │
   ├─▶ deriveChangeAddress(xpub, dominantScriptType,           │  NEW (D-02)
   │      nextChangeIndex)  → fresh m/8X'/0'/0'/1/k address    │
   │                                                          │
   ├─▶ btc-psbt.buildBtcPsbt(inputs, outputs, change)          │  NEW
   │      → Psbt(v0)  [sequence ≥ 0xfffffffe — RBF off, D-06]  │
   │      └─ dust check on every output (D-07)                 │
   │                                                          │
   ├─▶ btc-fingerprint.computeBtcPayloadFingerprint(           │  NEW (D-05)
   │      perInputSighashes[])                                 │
   │      sighash = Transaction.hashForWitnessV0 (segwit)      │
   │              | Transaction.hashForWitnessV1 (taproot)     │
   │      preimage = "VaultPilot-btctx-v1:" ‖ sh₀ ‖ … ‖ shₙ    │
   │                                                          │
   └─▶ handle-store.createHandle({ txType: "btc", … })  ───────┘
          → { handle, psbt(base64), inputs[], outputs[],
              feeSats, payloadFingerprint, prepareReceipt }

   │  preview_send({ handle })
   ▼
preview_send.ts  BTC branch ──────────────────────────────────┐
   ├─ recompute per-input sighashes  (Layer 1 drift defense)   │
   ├─ assert recomputed fingerprint == stored fingerprint      │
   ├─ emit DECODED inputs/outputs/feeSats block                │
   ├─ emit LEDGER BLIND-SIGN HASH block (per-input sighashes)  │
   └─ mint previewToken UUID                                   │
                                                              │
   │  send_transaction({ handle, previewToken, userDecision }) │
   ▼                                                          │
send_transaction.ts  ── FROZEN three-gate region (byte-identical)
   │  BTC dispatch arm ADDITIVE below FROZEN region            │
   ├─ re-check payloadFingerprint (Layer 3 drift gate)         │
   ├─ ledger-btc-transport.signBtcPsbt(psbt)                   │  NEW
   │    └─ split by script-type group → signPsbtBuffer × {1,2} │  DF-3 workaround
   │    └─ combine signed PSBTs → finalize → extract raw tx    │
   └─ esplora-client.broadcastTx(rawTxHex)  → { txid }         │
          │  Esplora POST /tx
          ▼
       Bitcoin mempool
```

### Recommended Project Structure

```
src/
├── signing/
│   ├── btc-fingerprint.ts      # NEW — keccak256 over concat(per-input sighashes); sibling of payload-fingerprint-tron.ts
│   ├── btc-sighash.ts          # NEW — per-input BIP-143/341 sighash compute (hashForWitnessV0/V1 dispatch by script type)
│   ├── btc-coin-select.ts      # NEW — selectCoinsBnb + largest-first fallback (pure-bigint, regression-tested)
│   ├── blocks-btc.ts           # NEW — PREPARE RECEIPT + LEDGER BLIND-SIGN HASH templates; sibling of blocks-tron.ts
│   ├── handle-store.ts         # MODIFIED — PreparedTx union += PreparedTxBtc; txType += "btc"
│   ├── error-codes.ts          # MODIFIED — additive BTC error codes (next free numbers)
│   ├── payload-fingerprint*.ts # FROZEN — byte-untouched
│   └── presign-hash*.ts        # FROZEN — byte-untouched
├── protocols/
│   └── btc-psbt.ts             # NEW — buildBtcPsbt(): bitcoinjs-lib.Psbt assembly; dust check; change-output insertion
├── chains/bitcoin/
│   ├── esplora-client.ts       # MODIFIED — add broadcastTx(rawTxHex) → POST /tx ; fetchAddressUtxos already exists
│   ├── change-index.ts         # NEW — change-chain (m/.../1/k) next-unused-index tracking (see Pattern 4)
│   └── (registry/types/xpub-scan unchanged)
├── wallet/
│   └── ledger-btc-transport.ts # MODIFIED — add signBtcPsbt() (signPsbtBuffer wrapper, per-script-type-group split)
├── tools/
│   ├── prepare_btc_send.ts     # NEW — the prepare tool
│   ├── preview_send.ts         # MODIFIED — additive BTC branch
│   ├── send_transaction.ts     # MODIFIED — additive BTC dispatch arm BELOW the FROZEN three-gate region
│   └── register-all.ts         # MODIFIED — register prepare_btc_send
└── demo/
    └── bitcoin-persona.ts      # MODIFIED — wire mempool-replay simulation envelope (simulationEnvelopeShape anchor exists)
test/
├── signing-fingerprint.test.ts # MODIFIED — append Fixture O (segwit) + P (taproot) + Q (mixed) hardcoded 0x… literals
├── btc-coin-select.test.ts     # NEW
├── btc-psbt.test.ts            # NEW
├── prepare-btc-send.test.ts    # NEW
├── preview-send.btc.test.ts    # NEW
├── ledger-btc-transport.test.ts# MODIFIED — add signBtcPsbt mock coverage
└── btc-trust-pipeline.integration.test.ts  # NEW — persona-cycle byte-identity
```

### Pattern 1: PSBT-v0 construction with per-input witnessUtxo

**What:** Build an unsigned PSBT-v0 with `bitcoinjs-lib.Psbt`. Segwit (P2WPKH) inputs need `witnessUtxo`; taproot (P2TR) inputs need `witnessUtxo` + `tapInternalKey`. The PSBT also carries BIP-32 derivation per input so the Ledger device recognizes which inputs are "internal" (signable).

**When to use:** `buildBtcPsbt` in `src/protocols/btc-psbt.ts`.

**Example:**
```typescript
// Source: bitcoinjs-lib@7.0.1 psbt.d.ts — probe-verified API surface.
import { Psbt, networks, payments, initEccLib } from "bitcoinjs-lib";
import * as ecc from "tiny-secp256k1";
import { bytesToHex } from "@noble/hashes/utils";

initEccLib(ecc); // REQUIRED once at module load — taproot p2tr throws without it.

const RBF_DISABLED_SEQUENCE = 0xfffffffe; // D-06 — RBF off.

// Segwit (P2WPKH) input:
psbt.addInput({
  hash: utxo.txid,            // string — bitcoinjs reverses internally
  index: utxo.vout,
  sequence: RBF_DISABLED_SEQUENCE,
  witnessUtxo: { script: p2wpkhOutputScript, value: BigInt(utxo.valueSats) },
  bip32Derivation: [{ masterFingerprint, pubkey, path: "m/84'/0'/0'/0/0" }],
});

// Taproot (P2TR) input — note tapInternalKey (x-only, 32 bytes) + tapBip32Derivation:
psbt.addInput({
  hash: utxo.txid,
  index: utxo.vout,
  sequence: RBF_DISABLED_SEQUENCE,
  witnessUtxo: { script: p2trOutputScript, value: BigInt(utxo.valueSats) },
  tapInternalKey: xOnlyPubkey,   // 32-byte x-only key
  tapBip32Derivation: [{ masterFingerprint, pubkey: xOnlyPubkey, path: "m/86'/0'/0'/0/0", leafHashes: [] }],
});

psbt.addOutput({ address: recipientAddress, value: BigInt(satsToSend) });
psbt.addOutput({ address: changeAddress,    value: BigInt(changeSats) }); // D-02
// psbt.toBase64() → the `psbt` field in the prepare response.
```

**Note:** `bitcoinjs-lib` v7 uses `bigint` for all `value` fields (probe-confirmed — `TransactionOutput.value: bigint`). Sat amounts cross the codebase as `bigint`; the agent boundary serializes them as decimal strings per CLAUDE.md.

### Pattern 2: Per-input sighash + fingerprint preimage

**What:** Each input's sighash is computed against an *unsigned* `Transaction` extracted from the PSBT. Segwit inputs use `hashForWitnessV0` (BIP-143); taproot inputs use `hashForWitnessV1` (BIP-341 key-spend). The fingerprint concatenates all N sighashes inside the domain-tagged preimage.

**When to use:** `btc-sighash.ts` (compute) + `btc-fingerprint.ts` (preimage assembly).

**Example:**
```typescript
// Source: bitcoinjs-lib@7.0.1 transaction.d.ts lines 50-52 — probe-verified deterministic.
import { Transaction } from "bitcoinjs-lib";
import { concat, keccak256, toBytes } from "viem";

export const FINGERPRINT_DOMAIN_TAG_BTC = "VaultPilot-btctx-v1:"; // 21 UTF-8 bytes

// Per-input sighash dispatch:
function inputSighash(tx: Transaction, i: number, input: BtcSelectedInput): Uint8Array {
  if (input.scriptType === "p2wpkh") {
    // BIP-143 — segwit. SIGHASH_ALL = 1.
    return tx.hashForWitnessV0(i, input.prevOutScript, input.valueSats, Transaction.SIGHASH_ALL);
  }
  // BIP-341 — taproot key-spend. SIGHASH_DEFAULT = 0. Needs ALL prevout scripts + ALL values.
  return tx.hashForWitnessV1(i, allPrevOutScripts, allPrevOutValues, Transaction.SIGHASH_DEFAULT);
}

export function computeBtcPayloadFingerprint(perInputSighashes: readonly Uint8Array[]): Hex {
  const tag = toBytes(FINGERPRINT_DOMAIN_TAG_BTC);
  const preimage = concat([tag, ...perInputSighashes]);
  return keccak256(preimage);
}
export const _btcFingerprint = { computeBtcPayloadFingerprint }; // ESM spy-affordance
```

**Critical asymmetry between the two sighash APIs (probe-verified signatures):**
- `hashForWitnessV0(inIndex, prevOutScript, value, hashType)` — needs **only this input's** prevout script + value.
- `hashForWitnessV1(inIndex, prevOutScripts[], values[], hashType, leafHash?, annex?)` — needs **ALL inputs'** prevout scripts and values (BIP-341 commits to the whole prevout set). The taproot sighash for input *i* is therefore not computable without every selected UTXO's script + value. `selectCoinsBnb` must surface the full selected set, and `btc-sighash.ts` must hold all prevouts before computing any taproot sighash.

### Pattern 3: Ledger PSBT signing — per-script-type-group split (DF-3 workaround)

**What:** `signPsbtBuffer` rejects a PSBT whose internal (device-signable) inputs span more than one script type. For a mixed segwit+taproot tx (SC#5), sign in two passes: one `signPsbtBuffer` call sees only the segwit inputs as internal, the other only the taproot inputs, then combine.

**When to use:** `ledger-btc-transport.signBtcPsbt`.

**Mechanism (probe-verified):** `signPsbtBuffer` determines which inputs are "internal" via `analyzeInput` → `belongsToSigner`, which is `true` only when the input's BIP-32 derivation matches the device master fingerprint. `validateScriptTypeConsistency` then throws if the internal inputs disagree on script type. The lever: **a PSBT input with no matching BIP-32 derivation is skipped** (`belongsToSigner: false`). So:

1. Build PSBT-A = full PSBT but with `bip32Derivation`/`tapBip32Derivation` populated **only on the segwit inputs**. `signPsbtBuffer(A, { accountPath: "m/84'/0'/0'", addressFormat: "bech32", … })` signs only those.
2. Build PSBT-B = full PSBT with derivation populated **only on the taproot inputs**. `signPsbtBuffer(B, { accountPath: "m/86'/0'/0'", addressFormat: "bech32m", … })` signs only those.
3. `bitcoinjs-lib.Psbt.combine(A', B')` merges the partial signatures; `finalizeAllInputs()` → `extractTransaction()` → raw tx hex.

**Example:**
```typescript
// Source: @ledgerhq/hw-app-btc@10.22.1 Btc.d.ts signPsbtBuffer + signPsbt/types.d.ts — probe-verified.
import { Psbt } from "bitcoinjs-lib";

export async function signBtcPsbt(psbtBase64: string): Promise<{ rawTxHex: string }> {
  const transport = await openTransport();
  try {
    const app = _transport.buildBtcApp(transport);
    const masterFp = await app.getWalletXpub /* or getMasterFingerprint via AppClient */;

    const groups = partitionInputsByScriptType(psbtBase64); // → { segwit, taproot }
    const signedParts: Psbt[] = [];
    for (const group of groups) {
      if (group.internalInputCount === 0) continue;
      const { psbt: signedBuf } = await app.signPsbtBuffer(group.psbtBuffer, {
        finalizePsbt: false,
        accountPath: group.accountPath,      // "m/84'/0'/0'" or "m/86'/0'/0'"
        addressFormat: group.addressFormat,  // "bech32" | "bech32m"
        knownAddressDerivations: group.knownAddressDerivations, // REQUIRED — see note
      });
      signedParts.push(Psbt.fromBuffer(signedBuf));
    }
    const combined = signedParts[0];
    for (let i = 1; i < signedParts.length; i++) combined.combine(signedParts[i]);
    combined.finalizeAllInputs();
    return { rawTxHex: combined.extractTransaction().toHex() };
  } finally {
    try { await transport.close(); } catch (err) { log("warn", `transport.close failed: ${err}`); }
  }
}
```

**`knownAddressDerivations` is REQUIRED** (probe-confirmed — `SignPsbtBufferOptions.knownAddressDerivations: KnownAddressDerivationsMap`, not optional). It is a `Map<scriptPubKeyHashHex, { pubkey, path }>` the caller builds from the wallet's known receive + change addresses — it lets the device populate missing BIP-32 derivations and recognize the **change output** as its own (load-bearing for D-02: the BTC app marks the change output "change" only if it appears in this map). The planner must build this map from the paired account's xpub-derived receive + change addresses.

**For the single-script-type case (no mix)** the split degenerates to one `signPsbtBuffer` call — the common path is unaffected.

### Pattern 4: Change-chain index tracking (resolves D-02's open sub-question)

**What:** D-02 needs the *next unused* change-chain (`.../1/k`) address. The Phase 22 xpub-scan only covered the receive chain (`.../0/k`).

**Recommendation: option (a) — extend the xpub gap-limit scan to also scan chain `1`.** Rationale:
- Phase 22's `xpub-scan.ts` already implements gap-limit-20 scanning with concurrency-5 and a 5-min TTL cache. Scanning chain `1` is the *same algorithm with `.derive(1)` instead of `.derive(0)`* — a parameterization, not a new subsystem.
- Option (b) (a persisted per-account change index) introduces a **new mutable persistent-state surface** that can desync from on-chain reality (if the user signs a change-creating tx outside VaultPilot, the cached index is stale and VaultPilot reuses an address — an address-reuse privacy bug). The on-chain scan is self-correcting.
- The change index is "first address on chain `1` with `tx_count == 0`" — exactly the gap-limit scan's existing termination signal.

**Implementation:** add a `scanChangeChain(xpub, scriptType)` entry point to `xpub-scan.ts` (or a thin `change-index.ts` wrapper) returning the next-unused change index. `deriveChangeAddress` then derives `m/8X'/0'/0'/1/<thatIndex>` and matches the script type to the dominant input type (D-02).

**Caveat (Open Question #3):** within a single multi-output prepare flow there is no on-chain confirmation between calls, so two `prepare_btc_send` calls in quick succession both see the same "next unused" index. This is acceptable for Phase 23 (the user signs one tx at a time; an unused-but-derived change address is harmless — it just gets skipped next scan). The planner should document this as accepted-residual, not engineer around it.

### Anti-Patterns to Avoid

- **Computing the taproot sighash with only one input's prevout.** `hashForWitnessV1` commits to the *entire* prevout set (BIP-341). Passing `[thisScript]`/`[thisValue]` instead of the full arrays produces a wrong-but-plausible hash that the device will reject. The fingerprint preimage assembly must hold all selected UTXOs before computing any taproot sighash.
- **Calling `signPsbtBuffer` once on a mixed-input PSBT.** Throws `"Mixed input types detected"`. Always partition by script type (Pattern 3).
- **Forgetting `initEccLib(ecc)`.** Taproot `payments.p2tr` and any taproot PSBT operation throw `"No ECC Library provided"` without it. Call once at module load in `btc-psbt.ts`.
- **Treating `psbt.version` as the PSBT format version.** `bitcoinjs-lib`'s `psbt.version` is the *transaction* version (1/2). There is no BIP-370 PSBT-version API. The PSBT is always BIP-174 v0.
- **Mutating the FROZEN region of `send_transaction.ts`.** The BTC dispatch arm is additive BELOW the three-gate region via the `txType` discriminator — same site Phase 12 carved Solana / Phase 18 carved TRON. `payload-fingerprint.ts` / `presign-hash.ts` / `handle-store.ts` *state machine* stay byte-identical (the `PreparedTx` *union widening* in `handle-store.ts` is additive type surface — the state machine + TTL logic is untouched, exactly as Phase 18 did it).
- **`.toString("hex")` on a `bitcoinjs-lib` v7 return value.** v7 is Buffer-free; returns are `Uint8Array`. Use `@noble/hashes/utils.bytesToHex` (Phase 22 Pitfall 6).
- **Omitting `knownAddressDerivations` from `signPsbtBuffer` options.** It is required, and without the change address in it the Ledger displays the change output as a *send* — defeating D-02.
- **`beforeAll`-snapshotting the Fixture O/P/Q values.** Per CLAUDE.md — hardcode the `0x…` literals computed once via `node -e`; drift must fail at a specific line.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| PSBT serialization | Custom BIP-174 key-value writer | `bitcoinjs-lib.Psbt.toBase64()` | BIP-174 has per-input/per-output typed key-value maps with subtle ordering rules; the lib is the reference impl. |
| BIP-143 segwit sighash | Hand-rolled double-SHA256 preimage | `Transaction.hashForWitnessV0` | The BIP-143 preimage (hashPrevouts/hashSequence/hashOutputs) is exactly the historical-bug surface. Probe-verified deterministic. |
| BIP-341 taproot sighash | Hand-rolled tagged-hash preimage | `Transaction.hashForWitnessV1` | Taproot sighash uses BIP-340 tagged hashes + a new epoch byte + SHA_SINGLE caches. Hand-rolling is a near-certain consensus mismatch. |
| Witness/scriptSig finalization | Manual witness-stack assembly | `psbt.finalizeAllInputs()` + `extractTransaction()` | Finalization differs per script type (P2WPKH witness vs P2TR key-spend witness); the lib dispatches correctly. |
| PSBT combine (merge partial sigs) | Manual key-value merge | `psbt.combine(...)` | Combine must detect identical underlying tx + merge non-conflicting fields — used in the DF-3 two-pass signing. |
| Change/recipient address → output script | Custom bech32/bech32m decoder | `bitcoinjs-lib.address.toOutputScript(addr, networks.bitcoin)` | Phase 22 Pitfall 1 — bech32 vs bech32m checksum constants differ. |
| Transaction vbyte/weight estimation (for fee math) | Manual size counter | `psbt.extractTransaction().virtualSize()` on a dummy-signed clone, OR a per-script-type vbyte table | P2WPKH ≈ 68 vbytes/input, P2TR ≈ 57.5 vbytes/input, output ≈ 31-43 vbytes. BnB needs vbyte estimates *before* signing — a documented per-script-type constant table is acceptable (see Common Pitfalls / Pitfall 3). |
| Ledger BTC-app PSBT protocol | Raw APDU exchange | `@ledgerhq/hw-app-btc.signPsbtBuffer` | The descriptor-wallet protocol (`BtcNew`) is a multi-APDU streaming exchange documented only in the Ledger app spec. |

**Key insight:** Every cryptographic primitive below the application layer (PSBT, sighashes, finalization, address encoding) is a consensus-critical, historically bug-prone surface with a battle-tested implementation in `bitcoinjs-lib`. VaultPilot's *only* hand-rolled code in Phase 23 is the **coin-selection algorithm** (pure compute, no consensus surface) and the **fingerprint preimage assembly** (a keccak concat — trivial, and regression-pinned by Fixtures O/P/Q).

## Runtime State Inventory

Phase 23 is **greenfield** for BTC signing — no rename / refactor / migration. One persistent-state interaction worth noting:

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | `~/.vaultpilot-mcp/non-evm-accounts.json` — Phase 22's BTC records (segwit + taproot, `chain: "bitcoin"`). Phase 23 **reads** these to know the paired xpub/addresses; writes nothing. | None — read-only consumption. |
| Live service config | None — Esplora endpoint config is Phase 22's `BTC_ESPLORA_URL`; Phase 23 adds a `POST /tx` call to the same endpoint. | None. |
| OS-registered state | None. | None. |
| Secrets/env vars | None new. Phase 23 reuses `BTC_ESPLORA_URL`. | None. |
| Build artifacts | None — no `pyproject.toml`/egg-info; TypeScript compiled fresh. | None. |
| In-process state | `handle-store.ts` `PreparedTx` union widens (additive `PreparedTxBtc`). Existing EVM/Solana/TRON handles unaffected — all new fields optional/discriminated. | Type widening only; state-machine logic byte-identical (Phase 18 precedent). |

**Change-chain index is NOT persisted state** — per Pattern 4 it is derived fresh from an on-chain xpub scan, deliberately avoiding a new mutable-state surface.

## Common Pitfalls

### Pitfall 1: Mixed-input signing rejection (the DF-3 conflict)

**What goes wrong:** A naive `prepare_btc_send` that BnB-selects a mix of bc1q + bc1p UTXOs (the D-01 default path — SC#5 by construction) builds one PSBT, then `send_transaction` calls `signPsbtBuffer` once → `"Mixed input types detected in PSBT"` thrown by the Ledger layer. The whole send fails.

**Why it happens:** `@ledgerhq/hw-app-btc@10.22.1`'s descriptor-wallet model assumes one wallet policy (one script type) per signing session. `validateScriptTypeConsistency` enforces it.

**How to avoid:** Pattern 3 — partition the PSBT's internal inputs by script type, call `signPsbtBuffer` once per group with the matching `accountPath`/`addressFormat`, `Psbt.combine` the partials. The single-script-type case degenerates to one call.

**Warning signs:** A two-script-type integration test throws `"Mixed input types"`; a single-script-type test passes — masking the bug until the mixed-input case runs.

### Pitfall 2: Taproot sighash missing the full prevout set

**What goes wrong:** Computing input *i*'s taproot sighash with `hashForWitnessV1(i, [scriptᵢ], [valueᵢ], …)` instead of all-inputs arrays yields a hash that diverges from what the device computes. The fingerprint is wrong; either the preview drift gate fires spuriously, or (worse) the device rejects the signature.

**Why it happens:** BIP-341 commits the sighash to `sha_prevouts`/`sha_amounts`/`sha_scriptpubkeys` over **every** input — taproot deliberately signs the whole prevout set. `hashForWitnessV0` (segwit) does not, so a developer porting the segwit path forgets the difference.

**How to avoid:** `btc-sighash.ts` assembles `allPrevOutScripts[]` and `allPrevOutValues[]` once from the full selected-UTXO set, then computes each input's sighash. Add a regression-anchor comment naming the BIP-341 whole-prevout-set requirement.

**Warning signs:** Segwit-only Fixture O passes; taproot Fixture P or mixed Fixture Q produces a fingerprint that changes when an unrelated input is added.

### Pitfall 3: Fee math before signatures exist (vbyte estimation)

**What goes wrong:** `feeSats = feeRate × txVbytes`, but `txVbytes` depends on the witness data that does not exist until the device signs. A coin-selection that uses the *unsigned* PSBT size underpays; one that double-counts overpays. An underpaid tx sits unconfirmed.

**Why it happens:** Segwit witness data is ~107 weight units (P2WPKH) / ~64 (P2TR key-spend) per input, discounted 4× in vbyte terms — invisible in the unsigned PSBT.

**How to avoid:** Use a per-script-type vbyte constant table for the estimate: P2WPKH input ≈ 68 vbytes, P2TR key-spend input ≈ 57.5 vbytes, P2WPKH/P2TR output ≈ 31/43 vbytes, overhead ≈ 10.5 vbytes. `selectCoinsBnb` computes `estVbytes = overhead + Σ inputVbytes + Σ outputVbytes` from this table. Round up. Document the table with a `[CITED]` reference to the BIP-141 weight rules.

**Warning signs:** Esplora `getFeeRate()` on the extracted tx differs materially from the requested `feeRate`; testnet broadcasts sit unconfirmed.

### Pitfall 4: Dust-threshold check applied to the wrong outputs

**What goes wrong:** D-07 says outputs below dust (~330 sats segwit, ~546 sats legacy) are refused at prepare-time. A naive check rejects the *recipient* output but not the *change* output — a tiny change amount (e.g. 200 sats) silently produces an unrelayable tx, or worse, gets dropped and the 200 sats are donated to miners as extra fee.

**Why it happens:** The change amount is computed (`selectedSum − sendSats − feeSats`), not user-supplied, so it is easy to forget it is also an output.

**How to avoid:** `buildBtcPsbt` runs the dust check on **every** output (recipient + change). If the change is below dust, the correct behavior is to **drop the change output and add the dust to the fee** (standard wallet behavior) — not to refuse the whole tx. Refusal is for the *recipient* output only. Document this asymmetry.

**Warning signs:** A send that leaves ~300 sats change either fails at prepare or produces a tx with a phantom unrelayable output.

### Pitfall 5: Fingerprint drift from PSBT re-serialization

**What goes wrong:** `preview_send` recomputes the fingerprint to detect drift (Layer 1 defense). If it re-derives the sighashes from a *re-parsed* PSBT (`Psbt.fromBase64(storedPsbt)`) and `bitcoinjs-lib` normalizes any field on round-trip, the recomputed fingerprint differs from the stored one → spurious drift refusal on a legitimate flow.

**Why it happens:** PSBT round-trips can reorder unknown key-values or normalize witnessUtxo encoding.

**How to avoid:** Store the **per-input sighashes themselves** (or the unsigned `Transaction` hex) in the handle alongside the PSBT, and recompute the fingerprint from *that* canonical artifact — not from a re-parsed PSBT. The TRON precedent (`payload-fingerprint-tron.ts`) stores `raw_data_hex` for exactly this reason. Mirror it: store the unsigned tx hex + the ordered prevout set.

**Warning signs:** `preview_send` intermittently refuses with `payloadFingerprint drift` on transactions that were never tampered with.

### Pitfall 6: `signPsbtBuffer` change-output not recognized as change

**What goes wrong:** The Ledger BTC app displays the change output as a normal *send* recipient — the user sees two "send" lines and (correctly) gets suspicious, or (incorrectly) approves a tx they do not understand.

**Why it happens:** The device marks an output "change" only when it can derive that output's address from the wallet policy AND the address appears in `knownAddressDerivations` / the PSBT's output BIP-32 derivation.

**How to avoid:** (a) The change address MUST be a real `m/8X'/0'/0'/1/k` derivation of the paired account (D-02). (b) `buildBtcPsbt` MUST populate the change output's `bip32Derivation`/`tapBip32Derivation`. (c) `signBtcPsbt` MUST include the change address in `knownAddressDerivations`. All three are required together.

**Warning signs:** Real-device test (verify-phase) shows the change output rendered as a send.

## Code Examples

### Fingerprint module (sibling of payload-fingerprint-tron.ts)

```typescript
// src/signing/btc-fingerprint.ts — Phase 23 Plan 23-01 (BTC-PREP-01, D-05).
// Sibling of payload-fingerprint-tron.ts. FROZEN: payload-fingerprint{,-solana,-tron}.ts.
//
// preimage = "VaultPilot-btctx-v1:" (21 UTF-8 bytes) ‖ sighash₀ ‖ … ‖ sighashₙ₋₁
// Each sighash is 32 bytes — BIP-143 (segwit) or BIP-341 (taproot key-spend).
// Multi-input tx → multi-hash preimage; per-input commitment per the UTXO model.
import { concat, keccak256, toBytes } from "viem";
import type { Hex } from "viem";

export const FINGERPRINT_DOMAIN_TAG_BTC = "VaultPilot-btctx-v1:";

export function computeBtcPayloadFingerprint(perInputSighashes: readonly Uint8Array[]): Hex {
  if (perInputSighashes.length === 0) {
    throw new Error("BTC payloadFingerprint requires at least one input sighash");
  }
  for (const sh of perInputSighashes) {
    if (sh.length !== 32) throw new Error(`per-input sighash must be 32 bytes, got ${sh.length}`);
  }
  const preimage = concat([toBytes(FINGERPRINT_DOMAIN_TAG_BTC), ...perInputSighashes]);
  return keccak256(preimage);
}
export const _btcFingerprint = { computeBtcPayloadFingerprint };
```

### Per-input sighash dispatch

```typescript
// src/signing/btc-sighash.ts — Phase 23 Plan 23-01.
// hashForWitnessV0/V1 verified deterministic in /tmp/btc-probe (run-to-run byte-identical).
import { Transaction } from "bitcoinjs-lib";

interface SighashInput {
  scriptType: "p2wpkh" | "p2tr";
  prevOutScript: Uint8Array;
  valueSats: bigint;
}

/** Compute all per-input sighashes for an unsigned tx. Taproot needs the full prevout set. */
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

### Esplora broadcast (additive to Phase 22's esplora-client.ts)

```typescript
// ADD to src/chains/bitcoin/esplora-client.ts — Phase 23 Plan 23-04.
// Esplora POST /tx accepts the raw tx hex as the request body; returns the txid as plain text.
export type EsploraBroadcastResult =
  | { kind: "ok"; txid: string }
  | { kind: "rejected"; message: string }   // mempool-rejection (e.g. min-relay-fee, double-spend)
  | { kind: "error"; message: string };

export async function broadcastTx(rawTxHex: string): Promise<EsploraBroadcastResult> {
  const url = `${_bitcoinRegistry.getEsploraBaseUrl()}/tx`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ESPLORA_TIMEOUT_MS);
  try {
    const resp = await fetch(url, { method: "POST", body: rawTxHex, signal: controller.signal });
    const text = await resp.text();
    if (resp.ok) return { kind: "ok", txid: text.trim() };
    if (resp.status === 400) return { kind: "rejected", message: text }; // Esplora 400 = mempool reject
    return { kind: "error", message: `Esplora POST /tx HTTP ${resp.status}: ${text}` };
  } catch (err) {
    const e = err as Error;
    return { kind: "error", message: e?.name === "AbortError" ? "Esplora broadcast timeout" : `Esplora unreachable: ${e?.message}` };
  } finally {
    clearTimeout(timer);
  }
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Ledger `createPaymentTransaction` (legacy `BtcOld` APDU flow) | `signPsbtBuffer` descriptor-wallet flow (`BtcNew`) | BTC app v2.1.0 (2022); `hw-app-btc` v10 routes ≥2.1.0 firmware through `BtcNew` automatically | Legacy flow has no taproot support; PSBT flow is the only path for bc1p inputs. |
| PSBT-v0 only (BIP-174) | PSBT-v2 (BIP-370) added to the ecosystem | BIP-370 finalized 2021; `@ledgerhq/psbtv2` is v2-native | `bitcoinjs-lib@7.0.1` is **still v0-only** at the `Psbt` API. `signPsbtBuffer` bridges by up-converting v0→v2 internally. VaultPilot stays on v0 construction. |
| `Buffer`-based bitcoinjs-lib (v6) | `Uint8Array`-based (v7) | bitcoinjs-lib v7 (2024) | All values are `bigint`/`Uint8Array`; use `@noble/hashes/utils.bytesToHex`, never `.toString("hex")`. |

**Deprecated/outdated:**
- `createPaymentTransaction` for taproot — does not support it; use `signPsbtBuffer`.
- Any tutorial showing `bitcoinjs-lib` with `Buffer` returns or `number`-typed `value` fields — pre-v7, stale.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | The Ledger BTC app firmware on the user's device is ≥ 2.1.0 (so `signPsbtBuffer`/`BtcNew` is the active protocol). | DF-3 / Pattern 3 | If a user runs pre-2.1.0 firmware, `signPsbtBuffer` is unavailable and taproot cannot be signed at all. Verify-phase real-device smoke must confirm firmware version; surface a structured refusal with an upgrade hint if too old. `[ASSUMED]` — current Ledger firmware ships ≥2.1.0, but not probe-verifiable without hardware. |
| A2 | Esplora `POST /tx` returns the txid as plain-text body on 200 and a reject reason as plain-text body on 400. | Code Examples / broadcast | If the response shape differs (JSON envelope), `broadcastTx` mis-parses. `[ASSUMED]` from Esplora API.md convention — verify against a live testnet broadcast in the verify-phase. |
| A3 | The mixed-input two-pass `signPsbtBuffer` + `Psbt.combine` round-trip preserves both partial signature sets without conflict (the two passes touch disjoint inputs). | DF-3 / Pattern 3 | If `combine` rejects the merge (e.g. it requires identical global fields and a pass mutates one), mixed-input sends fail. `[ASSUMED]` — `combine` is documented to merge non-conflicting fields and the two passes sign disjoint input sets; not probe-verifiable without a device. Verify-phase must exercise a real mixed-input send. |
| A4 | Per-script-type vbyte constants (P2WPKH ≈68, P2TR ≈57.5, output ≈31/43, overhead ≈10.5) are accurate enough for `feeRate` targeting within one block-target band. | Pitfall 3 | A material underestimate underpays the fee. `[ASSUMED]` from BIP-141 weight rules — standard wallet constants; the verify-phase confirms `getFeeRate()` on the extracted tx is within tolerance. |
| A5 | `getMasterFingerprint` (via `AppClient`) or `getWalletXpub` gives VaultPilot the device master fingerprint needed to build `bip32Derivation` entries and `knownAddressDerivations`. | Pattern 3 | Without the master fingerprint the device cannot match internal inputs. The `AppClient.getMasterFingerprint(): Promise<Buffer>` API exists (probe-verified in `newops/appClient.d.ts`) but the umbrella `Btc` class does not expose it directly — the planner must reach it via the `BtcNew` impl or `getWalletXpub`. `[ASSUMED]` resolvable — flag for the planner to type-check the exact accessor at execute time. |

**These five assumptions are all confirmable in the v2.2 verify-phase real-Ledger smoke** (bundled with the Phase 17/21/22 deferred items). None blocks code-completion; all block the verify-phase sign-off.

## Open Questions

1. **Mixed-input signing — two-pass `signPsbtBuffer` vs. descope.**
   - What we know: `signPsbtBuffer` rejects mixed-script-type inputs in one call (probe-verified — `validateScriptTypeConsistency` throws). SC#5 + D-01 require mixed-input support.
   - What's unclear: whether the two-pass `signPsbtBuffer` + `Psbt.combine` approach (Pattern 3) round-trips cleanly on real hardware (Assumption A3).
   - Recommendation: **Implement the two-pass split (Pattern 3).** It is the architecturally correct fit — the PSBT *construction* genuinely supports mixed inputs; only the *signing transport* needs the split, and the split is mechanical. Do NOT descope mixed-input support — SC#5 is a locked success criterion and the BnB default exercises the path by construction. Gate the real-hardware confirmation behind the verify-phase. If A3 fails on hardware, the fallback is constraining BnB to single-script-type selection (a coin-selection change, not a pipeline change) — but plan for the two-pass path.

2. **Coin-selection: in-repo BnB vs. `coinselect` npm package.**
   - What we know: D-01 specifies BnB + largest-first fallback. The `coinselect` package implements BnB but does not natively handle per-script-type vbyte weights for mixed sets.
   - What's unclear: whether the planner prefers the dependency-free in-repo module (Standard Stack recommendation) or the package.
   - Recommendation: **In-repo `src/signing/btc-coin-select.ts`** — ~150 LOC pure-bigint, regression-testable, matches the `aave-health.ts`/`compound-collateralization.ts` precedent, and avoids a new slopcheck-gated dependency. If the planner overrides to the package, it MUST run the full Package Legitimacy Gate first.

3. **Change-index race within rapid successive prepares.**
   - What we know: Pattern 4 derives the change index from a fresh on-chain xpub scan. Two `prepare_btc_send` calls before the first tx confirms both see the same "next unused" index.
   - What's unclear: nothing — the impact is benign (a derived-but-unused change address is harmless; the next scan skips it).
   - Recommendation: **Accept as residual.** Document it in the prepare tool's behavior notes. Do not engineer a reservation system — that reintroduces the mutable-state surface Pattern 4 deliberately avoids.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| `bitcoinjs-lib` | PSBT + sighash | ✓ (probe-installed; in package.json) | 7.0.1 | — |
| `@ledgerhq/hw-app-btc` | PSBT signing | ✓ (probe-installed; in package.json) | 10.22.1 | — |
| `bip32` + `tiny-secp256k1` | change-address derivation, ECC backend | ✓ (in package.json) | 5.0.1 / 2.2.4 | — |
| `viem` | keccak256 fingerprint | ✓ (in package.json) | 2.x | — |
| Esplora endpoint (`POST /tx`) | broadcast | ✓ (Phase 22 `BTC_ESPLORA_URL`; default blockstream.info) | — | — |
| `node_modules` populated | all code | ✗ at research time (repo had no `node_modules`) | — | `npm install` before any execute work — standard. |
| Ledger device + BTC app ≥2.1.0 | real signing (verify-phase only) | ✗ (no hardware in research env) | — | Code-complete uses mocked transport; real-device smoke deferred to verify-phase per the 2026-05-16 directive. |

**Missing dependencies with no fallback:** none for code-completion. The Ledger hardware is verify-phase-only (consistent with all prior v2.x phases).

## Validation Architecture

> `.planning/config.json` was not present at research time. Treating `workflow.nyquist_validation` as enabled (absent = enabled).

### Test Framework

| Property | Value |
|----------|-------|
| Framework | `vitest@^2.1.0` |
| Config file | `vitest` config in `package.json` / project root (existing — Phase 1) |
| Quick run command | `npx vitest run test/btc-coin-select.test.ts test/btc-psbt.test.ts` |
| Full suite command | `npx vitest run` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| BTC-PREP-01 | Fingerprint = keccak over domain-tag ‖ concat(sighashes); Fixtures O/P/Q pinned | unit | `npx vitest run test/signing-fingerprint.test.ts` | ✅ (append O/P/Q) |
| BTC-PREP-01 | Per-input sighash deterministic (segwit `hashForWitnessV0`, taproot `hashForWitnessV1`) | unit | `npx vitest run test/btc-sighash.test.ts` | ❌ Wave 0 |
| BTC-PREP-02 | `preview_send` BTC branch — decoded inputs/outputs + per-input sighash block + drift recompute | unit | `npx vitest run test/preview-send.btc.test.ts` | ❌ Wave 0 |
| BTC-PREP-03 | `send_transaction` BTC branch — previewToken + userDecision + fingerprint-drift gate | unit | `npx vitest run test/send-transaction.btc.test.ts` (or extend `send-transaction` suite) | ❌ Wave 0 |
| BTC-PSBT-01 | `prepare_btc_send` returns `{handle, psbt, inputs[], outputs[], feeSats, fingerprint, prepareReceipt}`; BnB + manual override | unit | `npx vitest run test/prepare-btc-send.test.ts` | ❌ Wave 0 |
| BTC-PSBT-01 | BnB selection + largest-first fallback; fee-sanity bounds (D-03); dust refusal (D-07) | unit | `npx vitest run test/btc-coin-select.test.ts` | ❌ Wave 0 |
| BTC-PSBT-02 | Mixed segwit+taproot inputs build a valid PSBT; two-pass signing combines correctly (mocked transport) | unit + integration | `npx vitest run test/btc-psbt.test.ts test/ledger-btc-transport.test.ts` | ❌ Wave 0 (extend existing transport test) |
| BTC-W-01 | Native segwit AND taproot sends both produce valid PSBTs via the same tool | unit | `npx vitest run test/prepare-btc-send.test.ts` | ❌ Wave 0 |
| (cross) | Persona-cycle byte-identity — same `{to, sats}` + same UTXOs → byte-identical fingerprint; different UTXOs → distinct fingerprint | integration | `npx vitest run test/btc-trust-pipeline.integration.test.ts` | ❌ Wave 0 |

### Sampling Rate

- **Per task commit:** `npx vitest run <the plan's new/modified test files>`
- **Per wave merge:** `npx vitest run` (full suite — must stay green; current baseline 2677 tests)
- **Phase gate:** Full suite green + `tsc` clean before `/gsd-verify-work`.

### Wave 0 Gaps

- [ ] `test/btc-sighash.test.ts` — per-input BIP-143/341 sighash determinism; covers BTC-PREP-01
- [ ] `test/btc-coin-select.test.ts` — BnB + largest-first fallback + fee-sanity + dust; covers BTC-PSBT-01 / D-01 / D-03 / D-07
- [ ] `test/btc-psbt.test.ts` — `buildBtcPsbt` segwit/taproot/mixed; covers BTC-PSBT-01 / BTC-PSBT-02
- [ ] `test/prepare-btc-send.test.ts` — the prepare tool end-to-end (mocked Esplora + transport); covers BTC-PSBT-01 / BTC-W-01
- [ ] `test/preview-send.btc.test.ts` — preview BTC branch; covers BTC-PREP-02
- [ ] `test/btc-trust-pipeline.integration.test.ts` — persona-cycle byte-identity regression anchor
- [ ] Fixture O (segwit) + P (taproot) + Q (mixed) appended to `test/signing-fingerprint.test.ts` as hardcoded `0x…` literals (computed once via `node -e`, NO `beforeAll`-snapshot)
- [ ] `test/ledger-btc-transport.test.ts` extension — `signBtcPsbt` two-pass mock coverage
- [ ] `test/send-transaction.btc.test.ts` (or extension) — BTC dispatch arm gates; FROZEN-region zero-diff assertion

*Framework is already installed (Phase 1) — no framework-install task needed.*

## Security Domain

> `security_enforcement` config key absent at research time → treated as enabled.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | No user auth surface — the Ledger device is the authority. |
| V3 Session Management | yes | `handle-store.ts` 15-min TTL handles + `previewToken` UUID + `userDecision: "send"` schema gate — reused unchanged from Phase 4. |
| V4 Access Control | yes | `send_transaction` three-gate region (previewToken + userDecision + fingerprint drift) — FROZEN, reused. |
| V5 Input Validation | yes | Recipient address: `bitcoinjs-lib.address.toOutputScript` two-gate (Phase 22 `assertBtcSegwit/TaprootAddress`); `sats`/`feeRate` decimal-string parsing with sanity bounds (D-03: feeRate ∈ [1, 10×high-priority]; D-07: dust threshold). |
| V6 Cryptography | yes | Sighashes via `bitcoinjs-lib` (never hand-rolled — Don't Hand-Roll table); fingerprint via viem `keccak256`. No key material in the codebase (CLAUDE.md hard rule). |

### Known Threat Patterns for the BTC PSBT pipeline

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Agent tampers with recipient/amount between prepare and send | Tampering | `payloadFingerprint` re-check at send time (Layer 3 drift gate); per-input sighash recompute at preview (Layer 1). A changed output → different sighashes → different fingerprint → refusal. |
| Change output redirected to attacker address | Tampering | Change MUST be a Ledger-derivable `m/8X'/0'/0'/1/k` address (D-02) populated in `knownAddressDerivations`; the BTC app independently re-derives and marks it "change". A non-derivable change address renders on-device as a *send* — visible mismatch. |
| Fee inflated to drain the wallet ("fee-as-theft") | Tampering / DoS | `feeSats` surfaced verbatim in `PREPARE RECEIPT` and on-device; fee-rate sanity bounds refuse `feeRate > 10× high-priority estimate` (D-03). |
| Per-input sighash drift (single input swapped) | Tampering | Multi-hash preimage (D-05) — any one input's sighash drifting changes the concatenated fingerprint. Per-input commitment is the UTXO-model equivalent of the EVM whole-tx fingerprint. |
| Cross-chain fingerprint reuse | Spoofing | Domain tag `"VaultPilot-btctx-v1:"` distinct from EVM/Solana/TRON tags — cross-chain reuse impossible at the keccak preimage level. |
| Malicious PSBT round-trip normalization causing spurious refusal (availability) | DoS | Recompute the fingerprint from a stored canonical artifact (unsigned tx hex + ordered prevouts), NOT a re-parsed PSBT (Pitfall 5). |
| Mixed-input signing silently dropping an input | Tampering | The two-pass split (Pattern 3) signs disjoint input sets; `finalizeAllInputs()` throws if any input is unsigned — a dropped input fails loudly, never silently. |

**SECURITY.md update (Plan 23-04):** add a BTC section — PSBT serialization trust shape, per-input BIP-143/341 sighash binding, multi-input sighash recompute as the Layer 1 (preview) defense, the Ledger BTC-app per-input signing flow, and the mixed-input two-pass signing as an accepted-mechanism (not a residual risk — it is mechanically equivalent to a single-pass sign).

## Sources

### Primary (HIGH confidence)
- `bitcoinjs-lib@7.0.1` — `/tmp/btc-probe/node_modules/bitcoinjs-lib/src/cjs/psbt.d.ts` + `transaction.d.ts` + `index.d.ts` — probed directly; `Psbt` API, `Transaction.hashForWitnessV0/V1` signatures, `bigint` value types. Runtime probe (`probe.mjs`) confirmed sighash determinism + absence of BIP-370 API.
- `@ledgerhq/hw-app-btc@10.22.1` — `/tmp/btc-probe/node_modules/@ledgerhq/hw-app-btc/lib-es/Btc.d.ts` + `BtcNew.d.ts` + `signPsbt/types.d.ts` + `signPsbt/inputAnalysis.{d.ts,js}` + `signPsbt/parsePsbt.d.ts` — probed directly; `signPsbtBuffer` signature, `SignPsbtBufferOptions` shape, `validateScriptTypeConsistency` mixed-input rejection logic, v0→v2 conversion in `deserializePsbt`.
- `@ledgerhq/psbtv2` — `psbtv2.d.ts` `PsbtV2` surface (transitive — documents the internal v2 representation).
- Phase 22 `22-RESEARCH.md` + `22-PATTERNS.md` — Esplora client shape, `BalanceReport.utxos[]`, USB-HID transport pattern, BIP-84/86 paths, ESM spy-affordance convention.
- `src/signing/payload-fingerprint-tron.ts` + `handle-store.ts` (read) — sibling-file fingerprint pattern + `PreparedTx` union widening precedent.
- `CLAUDE.md` + `23-CONTEXT.md` + `ROADMAP.md` Phase 23 + `REQUIREMENTS.md` §BTC-PREP/PSBT/W.

### Secondary (MEDIUM confidence)
- BIP-174 (PSBT v0), BIP-370 (PSBT v2), BIP-143 (segwit sighash), BIP-341/342 (taproot) — referenced via `23-CONTEXT.md` canonical links for the protocol-level claims (sighash structure, dust rules, sequence semantics).
- BIP-141 weight/vbyte rules — basis for the per-script-type vbyte constants (Pitfall 3).

### Tertiary (LOW confidence)
- None — every load-bearing claim is probe-verified or BIP-cited. The five Assumptions (A1-A5) are the only LOW-confidence items and are explicitly flagged for verify-phase confirmation.

## Project Constraints (from CLAUDE.md)

- **FROZEN-area discipline:** `src/signing/payload-fingerprint.ts` + `presign-hash.ts` + `handle-store.ts` *state machine* + `src/tools/send_transaction.ts` three-gate region are BYTE-UNTOUCHED. New BTC fingerprint = NEW SIBLING `src/signing/btc-fingerprint.ts`. BTC `send_transaction` dispatch arm is ADDITIVE below the FROZEN region. `handle-store.ts` `PreparedTx`-union *type widening* is permitted (Phase 18 precedent — type surface additive, logic untouched).
- **Cryptographic-binding fixtures:** Fixtures O (segwit) / P (taproot) / Q (mixed) pinned as hardcoded `0x…` literals in `test/signing-fingerprint.test.ts`. NO `beforeAll`-snapshot. Cross-link from `prepare-btc-send` consumer tests. Integration test re-anchors persona-cycle byte-identity.
- **ESM spy-affordance indirection** for cross-export internal calls (`_btcFingerprint`, `_btcSighash`, etc.). `vi.stubGlobal("fetch")` at the network boundary for Esplora.
- **`prepare_*` returns an opaque handle** + a `PREPARE RECEIPT` block with verbatim args (`to`, `sats`, `feeRate` — plus BTC-specific `inputs`/`outputs`/`feeSats` slots).
- **`previewToken` + `userDecision: "send"`** required on every `send_transaction`.
- **No private key material crosses any boundary.** The Ledger device holds keys; VaultPilot builds unsigned PSBTs only.
- **Decimal-aware arithmetic:** sat amounts are `bigint` internally, decimal strings on the agent boundary. 1 BTC = 100_000_000 sats (8 decimals).
- **Stderr for diagnostics, stdout for MCP protocol.**
- **Tool descriptions are agent routing prompts** — `prepare_btc_send`'s description must state precisely when to use it (single BTC send, segwit or taproot) and when not.
- **Single-context repo** — `docs/adr/` at root; no per-package CLAUDE.md. **No project skills found** (`.claude/skills/` absent).

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — every library probed at the installed version; no new packages.
- Architecture (PSBT construction, sighash, fingerprint): HIGH — `bitcoinjs-lib` API probed + sighash determinism runtime-verified.
- DF-1 (PSBT version): HIGH — resolved by probe; v0 is the only option, v0→v2 conversion confirmed.
- DF-2 (sighash byte-encoding): HIGH — `hashForWitnessV0/V1` probed deterministic; safe to pin fixtures.
- DF-3 (Ledger signing API): HIGH on the API surface; the mixed-input two-pass workaround is HIGH on mechanism (rejection logic read in source) but its real-hardware round-trip is Assumption A3 (verify-phase).
- Pitfalls: HIGH — derived from probed API asymmetries (taproot whole-prevout-set, mixed-input rejection) and BIP rules.
- Coin-selection (BnB): MEDIUM — the algorithm is well-defined (Erhardt 2016) but the in-repo implementation is greenfield; regression fixtures will anchor it.

**Research date:** 2026-05-22
**Valid until:** 2026-06-21 (30 days — `bitcoinjs-lib`/`hw-app-btc` are stable; probe pins exact versions). Re-probe `@ledgerhq/hw-app-btc` if a new minor lands before execute, as the `signPsbt` internals are recent additions.
