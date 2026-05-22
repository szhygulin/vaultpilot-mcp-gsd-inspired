# Phase 25: PSBT Multisig Flow — Research

**Researched:** 2026-05-22
**Domain:** Bitcoin BIP-174 PSBT multisig (M-of-N), descriptor parsing, Ledger multisig signing
**Confidence:** HIGH (stack verified from installed source; Ledger SDK probed empirically)

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **Descriptor format**: BIP-380 descriptors (`sortedmulti(M, key1, key2, ...)`) are the canonical multisig representation. MuSig (Schnorr-aggregated multisig) deferred until Ledger BTC app supports MuSig signing natively.
- **Descriptor validation at registration time**: parse the descriptor; verify key fingerprints + derivation paths; refuse on malformed descriptors. The registered descriptor's first 5 derived addresses surface in `register_btc_multisig_wallet` response for the user to verify against their co-signers.
- **Storage shape**: JSON file at `~/.vaultpilot-mcp/btc-multisig.json` (0o600 file); per-wallet record: `{ name, descriptor, threshold, fingerprints[], firstAddresses[], registeredAt }`. Atomic-write via tempfile + rename mirrors v2.0 PAIR-NEV-* pattern.
- **PSBT combine logic**: input-by-input + key-by-key merge; conflict on the same key signing the same input differently → structured error naming the conflicting signatures (defense against silent overwrites of co-signer signatures).
- **Threshold enforcement at finalize**: refuse `finalize_btc_psbt` if signature count < threshold per input. Surface which inputs are under-threshold.
- **Per-input signer-key surfacing in CHECKS PERFORMED**: preview block shows which inputs the user is a signer on + which co-signers have already signed + how many signatures still needed.

### Claude's Discretion
- Internal helper names (`combineBtcPsbt`, `finalizeBtcPsbt`, etc.)
- Whether `register_btc_multisig_wallet` accepts wallet-discovery files (Sparrow/Specter format) or pure descriptor strings
- Test fixture multisig descriptors (2-of-3 from known test xpubs)

### Deferred Ideas (OUT OF SCOPE)
- LTC scaffolding + LiFi BTC bridging — Phase 26
- Bitcoin/Litecoin Core RPC + incident report — Phase 27
- MuSig (Schnorr-aggregated multisig) — defer until Ledger BTC app supports MuSig signing
- Coordinator-mode (server-side PSBT escrow + multi-party coordination) — out of scope
- Threshold signatures (FROST / threshold ECDSA) — out of scope
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| BTC-PSBT-03 | `register_btc_multisig_wallet({ name, descriptor, threshold })` — records a known M-of-N multisig descriptor; validates; stored at `~/.vaultpilot-mcp/btc-multisig.json` (0o600) | Descriptor parsing via `@bitcoinerlab/descriptors`; atomic-write pattern from `non-evm-account-store.ts` |
| BTC-PSBT-04 | `get_btc_multisig_balance` + `get_btc_multisig_utxos` — aggregate via Esplora at descriptor's derived addresses | Existing Esplora client + `xpub-scan.ts`-style derivation loop over descriptor addresses |
| BTC-PSBT-05 | `combine_btc_psbts({ psbts: [...] })` — merge partially-signed PSBTs; conflict detection on same-key-same-input mismatch | `bitcoinjs-lib Psbt.combine` silently skips duplicates (self wins); Phase 25 MUST implement per-key conflict scan BEFORE calling combine |
| BTC-PSBT-06 | `sign_btc_multisig_psbt({ psbt, walletName })` — adds user's signature via Ledger; prepare→preview→send pipeline | Ledger multisig path uses `@ledgerhq/ledger-bitcoin` `AppClient.signPsbt` with registered `WalletPolicy`; NOT `signPsbtBuffer` |
| BTC-PSBT-07 | `finalize_btc_psbt({ psbt })` — builds final witness; refuses if threshold not met | `bitcoinjs-lib Psbt.finalizeAllInputs` + threshold check via `partialSig.length >= M` per input |
| BTC-W-04 | PSBT multisig flow (BTC-PSBT-03..07) — combine / sign / finalize lifecycle | Covered by the five requirements above |
</phase_requirements>

---

## Summary

Phase 25 adds M-of-N Bitcoin multisig participation: a persistent wallet descriptor registry, Esplora-backed balance/UTXO reads, a PSBT combiner, a Ledger-backed signer, and a threshold-enforcing finalizer. All five capabilities extend the Phase 22/23/24 BTC trust pipeline — none require rebuilding existing primitives.

The most load-bearing discovery is the **Ledger SDK fork**: `@ledgerhq/hw-app-btc@11 signPsbtBuffer` is limited to single-key default wallet policies (`pkh(@0/**)`, `wpkh(@0/**)`, `tr(@0/**)`). Multisig in the BTC app v2.1+ uses a wallet-policy registration APDU flow that is exposed only through the low-level `AppClient` in the newer `@ledgerhq/ledger-bitcoin` package. Phase 25 must decide: (a) add `@ledgerhq/ledger-bitcoin` alongside the existing `@ledgerhq/hw-app-btc`, or (b) reach into `BtcNew._impl.client` (the AppClient instance inside the existing package). Option (a) is cleaner and is the recommended path — `@ledgerhq/ledger-bitcoin` is an official Ledger package, slopcheck OK, passes npm registry check.

The second key finding is **PSBT combine conflict semantics**: `bitcoinjs-lib`'s `Psbt.combine` (via bip174 v3.0.0 `keyPusher`) silently ignores duplicate keys — when the same key already exists in `self`, it returns without error. This is intentional per the BIP-174 combiner spec ("the psbt calling combine will always have precedence"), but it means **Phase 25 must scan for same-key same-input conflicts BEFORE calling combine** and surface them as structured errors. The current library does not do this automatically.

Descriptor parsing for `wsh(sortedmulti(M, [fp/path]xpub, ...))` is well-supported by `@bitcoinerlab/descriptors` (slopcheck OK), which is already an indirect dependency (via `@ledgerhq/ledger-bitcoin`). Address derivation for the first N multisig addresses can use the existing `BIP32Factory(tinySecp256k1)` in the project, plus `bitcoinjs-lib payments.p2wsh` + `payments.p2ms` for the witnessScript construction.

**Primary recommendation:** Add `@ledgerhq/ledger-bitcoin` for multisig wallet-policy signing. Implement conflict detection manually before combine. Use `@bitcoinerlab/descriptors-core` regex parsing (already installed transitively) for descriptor validation. Mirror the `non-evm-account-store.ts` atomic-write pattern for the multisig registry.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Descriptor parsing + validation | API/Backend | — | Pure computation; no network needed; server owns the validation surface |
| Multisig wallet registry persistence | API/Backend | — | JSON on-disk; mirrors non-evm-account-store; no client exposure |
| Multisig address derivation | API/Backend | — | BIP-32 from xpubs in descriptor; server-computed; sent to agent for VERIFY-ON-DEVICE |
| Balance/UTXO reads (Esplora) | API/Backend → CDN/Static | — | Esplora HTTP reads; same path as existing get_btc_balance |
| PSBT combine + conflict detection | API/Backend | — | Computation on PSBT bytes; no chain I/O |
| PSBT signing (Ledger) | API/Backend → Device | — | USB-HID transport to Ledger hardware; trust boundary is device screen |
| PSBT threshold check + finalization | API/Backend | — | Signature count math + witness construction; no network needed |

---

## Standard Stack

### Core (already in project)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `bitcoinjs-lib` | `^7.0.1` (installed: 7.x) | PSBT v0 construction, combine, finalize, address derivation | Project standard; Phase 23 locked |
| `@ledgerhq/hw-app-btc` | `11.0.0` (installed) | Single-sig PSBT signing via `signPsbtBuffer`; NOT used for multisig signing | Already in project; multisig requires different API |
| `@ledgerhq/hw-transport-node-hid` | Already installed | USB-HID transport | Project standard |
| `bip32` | `^5.0.1` (already in project) | BIP-32 xpub child-key derivation for address scan | Already used in `xpub-scan.ts` |
| `tiny-secp256k1` | `2.2.4` (already in project) | ECC library for taproot; `BIP32Factory` adapter | Project standard |
| `@noble/hashes` | Already installed | `keccak256` for payloadFingerprint; `bytesToHex` | Project standard |

### New Addition Required

| Library | Version | Purpose | Why Needed |
|---------|---------|---------|------------|
| `@ledgerhq/ledger-bitcoin` | `0.3.1` | `AppClient.registerWallet` + `AppClient.signPsbt` for multisig WalletPolicy | `signPsbtBuffer` in `hw-app-btc` only handles DefaultDescriptorTemplate; multisig requires WalletPolicy APDU flow only available via this package's `AppClient` |

**Slopcheck result:** `@ledgerhq/ledger-bitcoin` — [OK] (official Ledger package, Apache-2.0, published 2023-12+, maintainers `phenry-ledger` + `sergii-shkolin` + `gbrahm-ledger`, source repo github.com/LedgerHQ/app-bitcoin-new) [VERIFIED: npm registry]

### Supporting (new indirect dependency already transitively installed)

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `@bitcoinerlab/descriptors` | `3.1.7` | `sortedmulti` descriptor regex parsing (via `descriptors-core/re.js`) | Descriptor validation in `register_btc_multisig_wallet`; already installed transitively under `@ledgerhq/ledger-bitcoin` |

**Slopcheck result:** `@bitcoinerlab/descriptors` — [OK] (MIT, published 2023-02, last updated 2026-03, source repo github.com/bitcoinerlab/descriptors, 38 published versions) [VERIFIED: npm registry]

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `@ledgerhq/ledger-bitcoin` | Bypass via `(app as any)._impl.client` to reach AppClient inside `hw-app-btc` | Avoids new dep but relies on private API that can break with any hw-app-btc version bump; not worth the brittleness |
| `@bitcoinerlab/descriptors` for address derivation | Hand-rolled BIP-32 + `payments.p2wsh` + BIP-67 key-sort | Descriptor library is already transitively installed; hand-rolling BIP-67 sortedmulti key comparison is a Don't-Hand-Roll violation |
| `Psbt.combine` conflict detection via bitcoinjs-lib | Third-party merge library | BIP-174's own behavior is documented; manual pre-scan is minimal code and keeps full control over structured error shape |

**Installation:**
```bash
npm install @ledgerhq/ledger-bitcoin
```

**Version verification:**
```
npm view @ledgerhq/ledger-bitcoin version   → 0.3.1
npm view @bitcoinerlab/descriptors version  → 3.1.7  (already transitively installed)
```

---

## Package Legitimacy Audit

| Package | Registry | Age | Downloads | Source Repo | slopcheck | Disposition |
|---------|----------|-----|-----------|-------------|-----------|-------------|
| `@ledgerhq/ledger-bitcoin` | npm | ~2.5 yrs | Official Ledger | github.com/LedgerHQ/app-bitcoin-new | [OK] | Approved |
| `@bitcoinerlab/descriptors` | npm | ~3 yrs | Active community | github.com/bitcoinerlab/descriptors | [OK] | Approved (transitively installed) |

**Packages removed due to slopcheck [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none

---

## Architecture Patterns

### System Architecture Diagram

```
Agent request
    │
    ▼
register_btc_multisig_wallet
    │  parse descriptor (bitcoinerlab regex)
    │  derive first 5 addrs (BIP-32 + p2wsh)
    │  → VERIFY-ON-DEVICE block
    │  persist to btc-multisig.json (atomic write, 0o600)
    ▼
get_btc_multisig_balance / _utxos
    │  load registry → get descriptor
    │  derive N addresses (gap-limit scan)
    │  Esplora /address/{addr}/utxo ×N (fan-out)
    ▼
combine_btc_psbts (Combiner — direct tool, no handle)
    │  parse each PSBT
    │  per-input per-key conflict scan (manual — BEFORE combine)
    │  conflict? → PSBT_COMBINE_CONFLICT structured error
    │  no conflict → bitcoinjs-lib Psbt.combine
    │  return merged PSBT base64
    ▼
sign_btc_multisig_psbt (prepare→preview→send)
    │  load wallet from registry
    │  parse externally-supplied PSBT
    │  compute payloadFingerprint (btc-fingerprint.ts — reuse FROZEN module)
    │  createHandle({ kind: "multisig-psbt" })
    │  → PREPARE RECEIPT block
preview_send (BTC branch extends for multisig kind)
    │  per-input: identify which inputs user is a signer on
    │  show co-signer partial signatures already present
    │  CHECKS PERFORMED: N-of-M per input
    │  mint previewToken
send_transaction (BTC branch)
    │  payloadFingerprint drift gate (Layer 3)
    │  @ledgerhq/ledger-bitcoin AppClient.signPsbt
    │       with WalletPolicy("wsh(sortedmulti(...))", walletHMAC)
    │  Ledger device shows multisig policy name + tx on screen
    │  append partialSig to PSBT inputs
    │  return updated PSBT base64 (NOT a broadcast txid)
    ▼
finalize_btc_psbt (Finalizer — direct tool, no handle)
    │  parse PSBT
    │  per-input: partialSig count >= threshold? else PSBT_THRESHOLD_NOT_MET
    │  bitcoinjs-lib Psbt.finalizeAllInputs
    │  return final PSBT base64 + extractTransaction().toHex()
```

### Recommended Project Structure (additive)

```
src/
├── protocols/
│   └── btc-psbt.ts           ← EXTEND: add combineBtcPsbts + finalizeBtcPsbt helpers
├── signing/
│   ├── btc-fingerprint.ts    ← FROZEN — reuse as-is for multisig fingerprint
│   ├── btc-sighash.ts        ← FROZEN — reuse as-is for multisig per-input sighash
│   └── handle-store.ts       ← EXTEND: kind union adds "multisig-psbt"
├── wallet/
│   ├── ledger-btc-transport.ts  ← EXTEND: add signBtcMultisigPsbt using AppClient
│   └── btc-multisig-store.ts    ← NEW: mirrors non-evm-account-store.ts shape
├── config/
│   └── btc-multisig-storage.ts  ← NEW: mirrors non-evm-storage.ts (path + mode)
└── tools/
    ├── register_btc_multisig_wallet.ts  ← NEW
    ├── get_btc_multisig_balance.ts      ← NEW
    ├── get_btc_multisig_utxos.ts        ← NEW
    ├── combine_btc_psbts.ts             ← NEW
    ├── sign_btc_multisig_psbt.ts        ← NEW (prepare arm)
    └── finalize_btc_psbt.ts             ← NEW
```

### Pattern 1: Descriptor Parsing with `@bitcoinerlab/descriptors-core`

**What:** Validate a `wsh(sortedmulti(M, [fp/path]xpub, ...))` descriptor string.
**When to use:** `register_btc_multisig_wallet` input validation.

```typescript
// Source: node_modules/@bitcoinerlab/descriptors/node_modules/@bitcoinerlab/descriptors-core/dist/re.js
// The regex is at exports.reSegwitSortedMulti — matches sortedmulti inside wsh()
// Use the regex for fast-path validation, then parse key entries manually.

// Pattern (confirmed from re.js source):
//   reSegwitSortedMulti captures: "M,key1,key2,..." where each key is
//   "[fingerprint/path]xpub/**" or "xpub/**" 
// Phase 25 only needs: parse M, count N keys, extract each key string.

import { reSegwitSortedMulti } from "@bitcoinerlab/descriptors-core/re.js";
// Alternative: regex from scratch matching the known BIP-380 pattern:
const SORTEDMULTI_WSH_RE = /^wsh\(sortedmulti\((\d+),((?:\[[0-9a-f]{8}(?:\/\d+'?)+\][xyYzZuvUV]pub[1-9A-HJ-NP-Za-km-z]+\/\*\*|[xyYzZuvUV]pub[1-9A-HJ-NP-Za-km-z]+\/\*\*),?)+\)\)$/;
// Verification: parse M <= N; reject M > N or M < 1.
```

### Pattern 2: Multisig Address Derivation (sortedmulti BIP-67)

**What:** Derive the first N P2WSH-wrapped `wsh(sortedmulti(...))` addresses for balance scanning and user verification.
**When to use:** `register_btc_multisig_wallet` (first 5 addresses) and `get_btc_multisig_balance`/`_utxos` (gap-limit scan).

```typescript
// Source: Project xpub-scan.ts (BIP32Factory pattern), bitcoinjs-lib payments.p2wsh + p2ms
import { BIP32Factory } from "bip32";
import * as tinySecp256k1 from "tiny-secp256k1";
import { payments, crypto as btcCrypto, networks } from "bitcoinjs-lib";

const bip32 = BIP32Factory(tinySecp256k1);

/**
 * Derive the P2WSH address for sortedmulti at a given derivation index.
 * BIP-67: keys MUST be sorted lexicographically by compressed pubkey before
 * building the witnessScript. p2ms({ pubkeys: sorted, m }) + p2wsh wraps it.
 */
function deriveMultisigAddress(
  xpubs: string[],  // account-level xpubs parsed from descriptor
  paths: string[],  // derivation paths per xpub (e.g. "0/0" for receive index 0)
  m: number,
  index: number,
): string {
  // Derive child pubkeys at change=0, index for each xpub
  const pubkeys = xpubs.map((xpub, i) => {
    const node = bip32.fromBase58(xpub, networks.bitcoin);
    const child = node.derive(0).derive(index); // change=0, receive index
    return Buffer.from(child.publicKey);
  });
  // BIP-67: sort pubkeys lexicographically
  const sorted = [...pubkeys].sort(Buffer.compare);
  // Build witnessScript: OP_M <pk1> ... <pkN> OP_N OP_CHECKMULTISIG
  const p2ms_payment = payments.p2ms({ m, pubkeys: sorted, network: networks.bitcoin });
  const p2wsh_payment = payments.p2wsh({ redeem: p2ms_payment, network: networks.bitcoin });
  return p2wsh_payment.address!;
}
```

### Pattern 3: PSBT Conflict Detection BEFORE Combine

**What:** Detect same-key-same-input signature conflicts before calling `Psbt.combine`.
**When to use:** `combine_btc_psbts`.

```typescript
// Source: Empirical probe of bip174 v3.0.0 combiner/index.js:
// `keyPusher` does `if (selfSet.has(key)) return;` — self wins silently.
// BIP-174 spec says: if the same key appears twice in an input with different
// values, that is a conflict. The library DOES NOT surface this — it ignores
// the other PSBTs' value entirely.

// Phase 25 MUST implement pre-scan before bitcoinjs-lib combine:
function detectPsbtConflicts(psbts: Psbt[]): ConflictResult {
  // For each input index, for each PSBT, collect (pubkey → signature) map.
  // If two PSBTs have the same pubkey on the same input but different sigs → conflict.
  // ConflictResult: { inputIndex, pubkeyHex, sigs: [sigHex, sigHex] }[]
}
// After conflict-free confirmation: psbts[0].combine(...psbts.slice(1))
```

### Pattern 4: Ledger Multisig Signing via `@ledgerhq/ledger-bitcoin` AppClient

**What:** Sign a multisig PSBT using the Ledger BTC app v2.1+'s wallet-policy APDU flow.
**When to use:** `sign_btc_multisig_psbt` → `send_transaction` BTC multisig branch.

```typescript
// Source: @ledgerhq/ledger-bitcoin/build/main/lib/appClient.d.ts (verified installed)
import AppClient, { WalletPolicy } from "@ledgerhq/ledger-bitcoin";
// (imported via the package's default export path)

// Registration (once per wallet, stores hmac in registry):
const [walletId, walletHmac] = await appClient.registerWallet(walletPolicy);

// Signing (uses stored hmac — walletHMAC is null for default policies only):
const sigs: [number, PartialSignature][] = await appClient.signPsbt(
  psbtBase64,          // base64 string accepted per d.ts
  walletPolicy,        // WalletPolicy with "wsh(sortedmulti(M,@0/**,@1/**))"
  walletHmac,          // 32-byte Buffer from registration
);
// sigs is Map: inputIndex → PartialSignature { pubkey: Buffer, signature: Buffer }
// Caller inserts sigs into PSBT.data.inputs[i].partialSig array.
```

**Critical difference from single-sig:** `signPsbtBuffer` (used in Phase 23/24) internally builds a `WalletPolicy` with `DefaultDescriptorTemplate` only. For `wsh(sortedmulti(...))`, `BtcNew.signPsbt` is called with a `WalletPolicy` whose `descriptorTemplate` is NOT one of the 4 default templates — and the high-level `signPsbtBuffer` cannot construct that policy. The AppClient's low-level `signPsbt` accepts any `WalletPolicy` string. [VERIFIED: hw-app-btc/lib/BtcNew.d.ts + policy.d.ts; ledger-bitcoin/build/main/lib/appClient.d.ts]

### Pattern 5: PSBT Threshold Check + Finalization

**What:** Count partial signatures per input and refuse if any input has fewer than M.
**When to use:** `finalize_btc_psbt`.

```typescript
// Source: bitcoinjs-lib/src/esm/psbt.js lines 988-1001
// partialSig array on psbt.data.inputs[i] holds { pubkey, signature }[] entries.

function checkThresholdAndFinalize(psbt: Psbt, m: number): ThresholdResult {
  const underThreshold: number[] = [];
  for (let i = 0; i < psbt.data.inputs.length; i++) {
    const sigs = psbt.data.inputs[i]?.partialSig ?? [];
    if (sigs.length < m) underThreshold.push(i);
  }
  if (underThreshold.length > 0) {
    return { ok: false, underThresholdInputs: underThreshold };
  }
  psbt.finalizeAllInputs(); // Uses p2ms getSortedSigs + p2wsh wrapping internally
  return { ok: true, txHex: psbt.extractTransaction().toHex() };
}
```

### Pattern 6: Multisig Registry Persistence (mirrors `non-evm-account-store.ts`)

**What:** Atomic-write JSON registry at `~/.vaultpilot-mcp/btc-multisig.json` (0o600).
**When to use:** `register_btc_multisig_wallet` write path; all 6 tools read it.

```typescript
// Source: src/wallet/non-evm-account-store.ts + src/config/non-evm-storage.ts
// Exact same pattern: writeFileSync(tmp, json, { mode: 0o600 }); renameSync(tmp, path)
// Storage path: join(homedir(), ".vaultpilot-mcp", "btc-multisig.json")
// ESM spy-affordance: export const _btcMultisigStorage = { existsSync, readFileSync, ... }
```

### Anti-Patterns to Avoid

- **Using `signPsbtBuffer` for multisig:** `hw-app-btc signPsbtBuffer` hardcodes single-key `WalletPolicy`. Calling it with a multisig PSBT will fail ("Mixed input types" or incorrect WalletPolicy) — use `AppClient.signPsbt` from `@ledgerhq/ledger-bitcoin` instead.
- **Calling `Psbt.combine` without conflict pre-scan:** The combiner silently drops duplicate keys (self wins). Two co-signers can have signed with different sighash types, and the silently discarded one would leave a corrupt PSBT.
- **Hardcoding key sort order:** `sortedmulti` requires keys sorted by compressed 33-byte pubkey at SCRIPT time (BIP-67). The sorting happens on the derived child pubkeys at each index — NOT on the xpubs in the descriptor. Sorting the descriptor's xpubs is a no-op.
- **Storing wallet_hmac outside the registry:** The `walletHmac` (32 bytes) returned by `registerWallet` must be stored alongside the descriptor in `btc-multisig.json`. Without it, every subsequent `signPsbt` call requires re-registration (user interaction on device again). The CONTEXT.md registry schema must be widened to include `{ ..., walletHmac: string (hex) }`.
- **Using `finalizeAllInputs` before threshold check:** If fewer than M signatures exist, `finalizeAllInputs` will throw an opaque error from the p2ms path. Always check threshold first.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| BIP-67 key sort + P2WSH witnessScript construction | Custom pubkey sort + OP_CHECKMULTISIG assembler | `bitcoinjs-lib payments.p2ms({ pubkeys: sorted, m }) + p2wsh` | Edge cases in sort order (compressed vs uncompressed, 33-byte buffer comparison); p2ms handles OP_M/OP_N encoding |
| BIP-174 PSBT parsing | Custom PSBT parser | `bitcoinjs-lib Psbt.fromBase64` | BIP-174 encoding is non-trivial; varint, key-value maps, psbtv0 vs psbtv2 conversions |
| `sortedmulti` descriptor regex | Custom parser | `@bitcoinerlab/descriptors-core` re.js patterns | BIP-380/381 descriptor grammar has many edge cases; key expression forms vary; library is already transitively installed |
| BIP-32 child key derivation from xpub | Custom ECDH derivation | `bip32.fromBase58(xpub).derive(0).derive(index)` | Project already uses `BIP32Factory(tinySecp256k1)` in xpub-scan.ts |
| Ledger BTC app wallet-policy APDU | Raw APDU construction | `@ledgerhq/ledger-bitcoin AppClient` | Wallet policy serialization, Merkle tree of keys, HMAC derivation — all proprietary Ledger APDU extensions |

**Key insight:** The multisig address derivation, PSBT assembly, and PSBT finalization primitives are all already available in the installed bitcoinjs-lib. The only new code required is the orchestration layer and conflict detection.

---

## Ledger SDK Fork — Critical Design Decision

### What the installed `@ledgerhq/hw-app-btc@11` provides

The `signPsbtBuffer` method (used in Phase 23/24 for single-sig) internally:
1. Creates a `WalletPolicy` with `DefaultDescriptorTemplate` (`wpkh(@0/**)` or `tr(@0/**)`)
2. Calls `AppClient.signPsbt(psbt, walletPolicy, Buffer.alloc(32, 0), callback)`
3. The `walletHMAC` is always `Buffer.alloc(32, 0)` (all-zeros) for default wallets

The `WalletPolicy` class constructor is typed as `(descriptorTemplate: DefaultDescriptorTemplate, key: string)` — only 4 template strings accepted at the TypeScript level. The runtime does NOT enforce this (just stores the string), but `signPsbtBuffer` only ever constructs default policies. [VERIFIED: hw-app-btc/lib/BtcNew.js line 127 + policy.d.ts]

### What multisig requires (Ledger BTC app v2.1+ wallet policy)

From `LedgerHQ/app-bitcoin-new/doc/wallet.md` [CITED: https://github.com/LedgerHQ/app-bitcoin-new/blob/master/doc/wallet.md]:
- Non-default policies (including `wsh(sortedmulti(...))`) require **wallet registration** via `registerWallet` APDU
- Registration returns a 32-byte `walletHMAC` that must be stored and passed on every subsequent `signPsbt` call
- The `WalletPolicy` for multisig uses a full key array: `new WalletPolicy(name, "wsh(sortedmulti(2,@0/**,@1/**,@2/**))", [key0, key1, key2])`
- `@ledgerhq/ledger-bitcoin`'s `WalletPolicy` class takes `(name: string, descriptorTemplate: string, keys: readonly string[])` — accepts any string for the template [VERIFIED: @ledgerhq/ledger-bitcoin/build/main/lib/policy.d.ts]

### Recommended resolution

Add `@ledgerhq/ledger-bitcoin@0.3.1` alongside the existing `@ledgerhq/hw-app-btc`. The two packages share the same low-level `AppClient` APDU implementation but have different high-level wrappers. The new package's `AppClient` wraps the same underlying transport; `ledger-btc-transport.ts` already opens the transport via `TransportNodeHid.open(null)` — Phase 25's `signBtcMultisigPsbt` passes the opened transport to `new AppClient(transport)` from `@ledgerhq/ledger-bitcoin`.

```typescript
// ledger-btc-transport.ts extension (new export):
import AppClient, { WalletPolicy, PartialSignature } from "@ledgerhq/ledger-bitcoin";
// Transport is opened via the same existing openTransport() helper
```

**Phase 25 adds `walletHmac` to the registry record schema.** The `registerWallet` call happens at `register_btc_multisig_wallet` time — device interaction required once. Subsequent `sign_btc_multisig_psbt` calls use the stored hmac.

---

## PSBT Combine Semantics — Confirmed Behavior

**Empirically confirmed** from bip174 v3.0.0 `combiner/index.js` installed in project:

```javascript
function keyPusher(selfSet, selfKeyVals, otherKeyVals) {
  return key => {
    if (selfSet.has(key)) return;  // ← SILENT NO-OP if key already exists
    const newKv = otherKeyVals.filter(kv => tools.toHex(kv.key) === key)[0];
    selfKeyVals.push(newKv);
    selfSet.add(key);
  };
}
```

This means: when `self.combine(other)` and both have a `PSBT_IN_PARTIAL_SIG` for the same pubkey on the same input, `other`'s signature is silently discarded. The PSBT key for a partial signature encodes the pubkey as part of the key bytes — same pubkey on same input = same PSBT key = silent drop.

**Conflict scenario:** Co-signer A and co-signer B both sign input 0 with the same key but different sighash types (e.g., one uses SIGHASH_ALL, the other uses SIGHASH_ALL|ANYONECANPAY). Calling `psbtA.combine(psbtB)` keeps A's signature and discards B's without error.

**Phase 25 MUST pre-scan:** For each PSBT pair, for each input, for each pubkey present in both: if the signature bytes differ, surface `PSBT_COMBINE_CONFLICT` error naming input index, pubkey hex, and both conflicting signature hexes. [VERIFIED: bip174/src/esm/lib/combiner/index.js — confirmed via source read]

---

## Trust Pipeline Mapping for the 6 New Tools

| Tool | Pipeline Role | Has Handle | payloadFingerprint | Notes |
|------|--------------|------------|-------------------|-------|
| `register_btc_multisig_wallet` | Read + Persist | No | No | Validation + address derivation + VERIFY-ON-DEVICE + atomic write |
| `get_btc_multisig_balance` | Read | No | No | Esplora reads; no signing pipeline |
| `get_btc_multisig_utxos` | Read | No | No | Esplora reads; no signing pipeline |
| `combine_btc_psbts` | PSBT transform | No | No | Conflict scan + combine; returns updated PSBT; user passes result to sign |
| `sign_btc_multisig_psbt` | Prepare step | YES (kind: "multisig-psbt") | YES (reuse btc-fingerprint.ts) | Flows through preview_send + send_transaction; PSBT source is external |
| `finalize_btc_psbt` | PSBT transform | No | No | Threshold check + finalize; returns final PSBT + txHex for broadcast; NOT a prepare tool |

**Key insight:** `combine` and `finalize` are pure PSBT transforms — they do not produce unsigned transactions for Ledger signing. Only `sign_btc_multisig_psbt` flows through the prepare→preview→send trust pipeline.

**Externally-supplied PSBT for `sign_btc_multisig_psbt`:** The PSBT comes from the user (pasted or loaded from disk), not built by the server. The `payloadFingerprint` must be computed over the PSBT's per-input sighashes (same `computeAllSighashes` + `computeBtcPayloadFingerprint` path used in Phase 23/24). The FROZEN modules `btc-sighash.ts` and `btc-fingerprint.ts` are reused unchanged — the fingerprint commits to the UTXO set, so two different externally-supplied PSBTs produce different fingerprints by construction.

**`handle-store.ts` kind union** must be widened: `kind: "native" | "rbf" | "multisig-psbt"`. State machine + TTL byte-identical (FROZEN). [VERIFIED: src/signing/handle-store.ts line 570]

---

## Registry Schema — Widened from CONTEXT.md

The CONTEXT.md schema `{ name, descriptor, threshold, fingerprints[], firstAddresses[], registeredAt }` must be extended to include `walletHmac` for Ledger multisig signing:

```typescript
interface BtcMultisigWalletRecord {
  name: string;           // user-assigned wallet name (max 16 chars per Ledger APDU limit)
  descriptor: string;     // full wsh(sortedmulti(M, ...)) descriptor string
  threshold: number;      // M — the signing threshold (redundant but pre-validated for fast reads)
  totalSigners: number;   // N — total number of keys
  keyFingerprints: string[];  // 8-hex-char fingerprints extracted from descriptor
  firstAddresses: string[];   // first 5 derived P2WSH receive addresses (for user verification)
  registeredAt: string;       // ISO-8601 UTC
  walletHmac?: string;        // 32-byte hex from Ledger registerWallet; absent on pre-Phase25 records
  //                             or when Ledger registration was deferred (no device at register time)
}
```

**Note on `walletHmac` optionality:** A user may register a multisig descriptor without a Ledger connected (for balance-checking purposes only). In this case, `walletHmac` is absent. `sign_btc_multisig_psbt` must refuse with a clear error if `walletHmac` is absent (`MULTISIG_WALLET_NOT_REGISTERED_ON_DEVICE`) and surface the resolution: call `register_btc_multisig_wallet` again with the device connected.

**Name length constraint:** The Ledger BTC app limits wallet policy names to 16 ASCII bytes. Enforce this at registration time; refuse with clear error on truncation. [VERIFIED: @ledgerhq/ledger-bitcoin WalletPolicy constructor + Ledger wallet.md]

---

## Common Pitfalls

### Pitfall 1: BIP-67 Key Sort at Script Time vs Descriptor Order
**What goes wrong:** Multisig addresses are computed wrong, producing addresses that don't match what co-signers see.
**Why it happens:** `sortedmulti` sorts the derived child pubkeys (33-byte compressed) per-address, not the xpubs in the descriptor. The xpubs in the descriptor are listed in the coordinator's preferred order; the final witnessScript sorts them lexicographically at each derivation index.
**How to avoid:** Use `Buffer.compare` on derived child pubkeys before `payments.p2ms`. The sort is per-index, not per-xpub.
**Warning signs:** First N derived addresses from Phase 25 don't match Sparrow/Specter addresses for the same descriptor.

### Pitfall 2: `Psbt.combine` Silent Conflict (CRITICAL)
**What goes wrong:** Two co-signers produce conflicting partial signatures (different sighash type, or different nonce in rare edge cases). The conflict is silently discarded. The combined PSBT looks valid but may fail on broadcast or produce an unexpected spend.
**Why it happens:** bip174 `keyPusher` silently skips duplicate keys — documented behavior ("self has precedence").
**How to avoid:** Pre-scan all input pairs before calling `Psbt.combine`. Surface any mismatch as `PSBT_COMBINE_CONFLICT` with input index + pubkey + both signature hexes. Only call `Psbt.combine` after the pre-scan confirms no conflicts.
**Warning signs:** Any `combine_btc_psbts` call where two PSBTs both carry partial signatures for the same input.

### Pitfall 3: `walletHmac` Lost Between Sessions
**What goes wrong:** `registerWallet` returns a 32-byte hmac; if not persisted, every subsequent `signPsbt` requires re-registration (user has to interact with device again, approve the wallet policy again).
**Why it happens:** `walletHmac` is session-specific in the Ledger app — it's deterministic from the device seed so the same policy always yields the same hmac, but the *client* is responsible for storing it.
**How to avoid:** Persist `walletHmac` as hex in `btc-multisig.json` at `registerWallet` time. On `sign_btc_multisig_psbt`, load from registry. If absent, surface clear error directing user to run `register_btc_multisig_wallet` with device connected.

### Pitfall 4: `finalizeAllInputs` Throws on Under-Threshold PSBT
**What goes wrong:** `psbt.finalizeAllInputs()` throws an opaque error ("Not enough signers") from within bitcoinjs-lib's p2ms finalizer.
**Why it happens:** bitcoinjs-lib calls `getSortedSigs` which compares `neededSigs` against `partialSig.length`. If `partialSig.length < m`, it throws inside `checkForInput`.
**How to avoid:** Check `partialSig.length >= m` per input BEFORE calling `finalizeAllInputs`. Surface `PSBT_THRESHOLD_NOT_MET` with the list of under-threshold input indices.

### Pitfall 5: `@ledgerhq/ledger-bitcoin` AppClient transport wiring
**What goes wrong:** `new AppClient(transport)` from `@ledgerhq/ledger-bitcoin` expects a `@ledgerhq/hw-transport` Transport instance — the same interface that `TransportNodeHid.open()` returns. Using the wrong import path or double-wrapping the transport causes APDU errors.
**Why it happens:** Both `@ledgerhq/hw-app-btc` and `@ledgerhq/ledger-bitcoin` accept the same `Transport` type; the transport opened via the existing `openTransport()` helper can be passed directly to `new AppClient(transport)`.
**How to avoid:** Reuse `openTransport()` from `ledger-btc-transport.ts`. Pass the opened transport directly to `new AppClient(transport as unknown as Transport)` (the Transport interface is structurally identical). Close in `finally` — same discipline as existing transport patterns.

### Pitfall 6: Descriptor Parsing — `xpub/**` vs `xpub/0/*` vs `xpub/0/**`
**What goes wrong:** The derivation suffix in the descriptor key expression varies. `[fp/path]xpub/**` means the xpub is at the account level; derivation appends `/change/index`. `xpub/0/*` means change=0 hardcoded. Phase 25 must parse the suffix correctly to know whether to derive `xpub.derive(change).derive(index)` or `xpub.derive(index)`.
**Why it happens:** BIP-380 allows both forms. Sparrow typically exports `[fp/84h/0h/0h]xpub.../**` (account-level, user provides change+index). Some tools export `[fp/84h/0h/0h/0]xpub.../*` (change hardcoded).
**How to avoid:** At registration, parse the derivation suffix. Enforce `/**` form in Phase 25 (the canonical form for Sparrow/Specter exports). Refuse `/*` or `/0/*` forms with an explicit error. The `@bitcoinerlab/descriptors-core` regex `reSegwitKeyExp` accepts both; Phase 25 should constrain to `/**` only.

### Pitfall 7: `payments.p2wsh` witnessScript hash vs redeemScript
**What goes wrong:** P2WSH address is computed from SHA256 of the witnessScript (not the redeemScript, not HASH160). Mixing up SHA256 with HASH160 produces wrong addresses silently.
**Why it happens:** P2SH uses HASH160(redeemScript); P2WSH uses SHA256(witnessScript). They are different constructions.
**How to avoid:** Always use `payments.p2wsh({ redeem: p2ms_payment })` — bitcoinjs-lib handles the SHA256 internally. Never hand-roll the witnessScript hash.

---

## Code Examples

### Key expression parsing from `wsh(sortedmulti(M, key1, key2, ...))`

```typescript
// Source: Empirical from @bitcoinerlab/descriptors-core re.js (installed)
// Pattern for phase 25: parse the M and xpubs from the descriptor
function parseWshSortedMulti(descriptor: string): {
  m: number;
  keys: string[];  // raw key expressions e.g. "[deadbeef/84'/0'/0']xpub.../**"
} | null {
  // BIP-381 wsh(sortedmulti(M, kp_1, kp_2, ..., kp_n)) 
  const match = descriptor.match(
    /^wsh\(sortedmulti\((\d+),([\s\S]+)\)\)$/
  );
  if (!match) return null;
  const m = parseInt(match[1]!, 10);
  const keyExpStr = match[2]!;
  // Split keys — naive split on ',' is wrong for key expressions with ','
  // inside derivation paths (those don't contain commas), so simple split works:
  const keys = keyExpStr.split(",").map(k => k.trim());
  if (m < 1 || m > keys.length) return null;
  return { m, keys };
}
```

### BIP-32 xpub extraction from key expression

```typescript
// Key expression forms: "[deadbeef/84'/0'/0']xpub...//**" or "xpub/**"
function extractXpubFromKeyExpr(keyExpr: string): {
  masterFingerprint: string | null;  // 8 hex chars or null
  xpub: string;
} {
  const withFp = keyExpr.match(/^\[([0-9a-f]{8})(?:[/\d']+)?\](\w+)\/\*\*$/i);
  if (withFp) return { masterFingerprint: withFp[1]!, xpub: withFp[2]! };
  const bare = keyExpr.match(/^(\w+)\/\*\*$/);
  if (bare) return { masterFingerprint: null, xpub: bare[1]! };
  throw new Error(`Unrecognized key expression: ${keyExpr}`);
}
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Legacy Ledger BTC app P2SH multisig (createPaymentTransaction + signP2SHTransaction) | Ledger BTC app v2.1+ wallet-policy APDU + PSBT signing | BTC app v2.1.0 (2022) | Registration-based; more secure; requires new AppClient |
| `ledger-bitcoin` npm package | `@ledgerhq/ledger-bitcoin` npm package | 2024 (ledger-bitcoin deprecated) | Different package name; same AppClient API |
| Manual p2ms address derivation | bitcoinjs-lib `payments.p2ms + p2wsh` | long-standing | Canonical approach; handles OP_M/OP_N encoding |

**Deprecated/outdated:**
- `ledger-bitcoin` (npm): deprecated in favor of `@ledgerhq/ledger-bitcoin` — both expose the same `AppClient`; `@ledgerhq/ledger-bitcoin` is the official canonical package per npm deprecation notice [VERIFIED: npm registry deprecation message]
- `signP2SHTransaction`: legacy Ledger API for old P2SH multisig (not PSBTv0); superceded by `AppClient.signPsbt` with wallet policies

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `@ledgerhq/ledger-bitcoin AppClient.signPsbt` works with custom `WalletPolicy` for `wsh(sortedmulti(...))` on BTC app v2.1+ device | Ledger SDK Fork section | If device firmware < 2.1, registration APDU fails; plan must gate on `appVersion` check |
| A2 | `bitcoinjs-lib Psbt.finalizeAllInputs` correctly handles P2WSH multisig (p2wsh wrapping p2ms) with partial signatures | Pattern 5 | If finalizer doesn't handle `p2wsh(p2ms)`, manual finalization needed |
| A3 | Sparrow/Specter descriptor format always uses `/**` suffix (account-level xpub) | Pitfall 6 | If common tools export `/0/*` form, descriptor parsing is more complex |

**If this table is empty:** N/A — 3 assumptions logged.

---

## Open Questions / Design Forks (RESOLVED)

> All forks resolved at the planning gate — recommendations adopted into the Phase 25 plans.

### Fork 1: `register_btc_multisig_wallet` — Pure Descriptor String vs Wallet-Discovery File
**Context:** CONTEXT.md §Claude's Discretion asks for a recommendation.
**Recommendation: Pure descriptor string only.**
- A `wsh(sortedmulti(M, [fp/path]xpub/**,...))` string is the universal interchange format — both Sparrow and Specter export it (File → Export Wallet → Output Descriptor). It's a single short string the agent can paste.
- Sparrow's `.json` format and Specter's `.json` format are different from each other AND from Coldcard's format. Supporting all would add format-detection complexity and external parsing surface.
- The descriptor string is the smallest, most interoperable input. Planner should lock this as the Phase 25 scope.

### Fork 2: Ledger Registration at `register_btc_multisig_wallet` Time vs `sign_btc_multisig_psbt` Time
**Context:** `registerWallet` requires device interaction (user approves on Ledger screen). Should it happen at registration or at first-sign?
**Recommendation: At `register_btc_multisig_wallet` time, with device-absent fallback.**
- Rationale: User is already performing a setup action; adding an on-device confirmation at that point is natural and matches the Ledger UX model ("register, then use").
- `walletHmac` is stored in registry. If device absent at registration time, store without hmac; `sign_btc_multisig_psbt` checks for hmac and surfaces `MULTISIG_WALLET_NOT_REGISTERED_ON_DEVICE` if absent.
- This design makes the tool symmetric with `pair_btc_ledger` (pair once, use many times).

### Fork 3: `combine_btc_psbts` Order Semantics
**Context:** `Psbt.combine` makes the first PSBT the "self" and gives it precedence on conflict. Phase 25's conflict detection makes this moot (conflict → error before combine), but the order still determines the returned PSBT's metadata.
**Recommendation:** Accept the `psbts` array in canonical order (as the agent received them from co-signers); do conflict scan across all pairs; if no conflict, use the first PSBT as self. Document this in the tool description.

### Fork 4: `sign_btc_multisig_psbt` — PSBT Source
**Context:** The PSBT comes externally (user pastes base64 from a co-signer). Unlike `prepare_btc_send` which builds the PSBT from scratch, `sign_btc_multisig_psbt` operates on an already-assembled PSBT.
**Implication:** The `payloadFingerprint` still uses `computeAllSighashes` + `computeBtcPayloadFingerprint` (FROZEN modules reused unchanged), but the PSBT is parsed from the user-supplied base64, not from `buildBtcPsbt`. The handle stores the parsed PSBT's `perInputPrevouts` extracted from the PSBT's `witnessUtxo` fields. This is safe — `witnessUtxo` in a well-formed external PSBT carries the prevout script and value needed for sighash computation.

---

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest (existing) |
| Config file | `vitest.config.ts` (root) |
| Quick run command | `npx vitest run test/tools-register-btc-multisig-wallet.test.ts` |
| Full suite command | `npx vitest run` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| BTC-PSBT-03 | Descriptor parsing accepts valid `wsh(sortedmulti(...))` | unit | `npx vitest run test/btc-multisig-store.test.ts` | ❌ Wave 0 |
| BTC-PSBT-03 | Descriptor parsing rejects malformed descriptors | unit | same | ❌ Wave 0 |
| BTC-PSBT-03 | First 5 addresses derived correctly (BIP-67 sort) | unit | `npx vitest run test/btc-multisig-address-derivation.test.ts` | ❌ Wave 0 |
| BTC-PSBT-03 | Registry atomic-write + 0o600 perms | unit | `npx vitest run test/btc-multisig-store.test.ts` | ❌ Wave 0 |
| BTC-PSBT-05 | Combine detects same-key same-input conflict | unit | `npx vitest run test/btc-multisig-combine.test.ts` | ❌ Wave 0 |
| BTC-PSBT-05 | Combine succeeds when no conflict | unit | same | ❌ Wave 0 |
| BTC-PSBT-06 | payloadFingerprint for multisig PSBT — Fixture X literal | unit | `npx vitest run test/signing-fingerprint.test.ts` | ❌ Needs Fixture X |
| BTC-PSBT-07 | Finalize refuses when signature count < M (per input) | unit | `npx vitest run test/btc-multisig-finalize.test.ts` | ❌ Wave 0 |
| BTC-PSBT-07 | Finalize succeeds with M signatures per input | unit | same | ❌ Wave 0 |

### Cryptographic-Binding Fixture X

**Fixture X: 2-of-3 multisig PSBT payloadFingerprint.** This is the next free fixture letter after W (V = RBF PSBT fingerprint in `signing-fingerprint.test.ts`; W = BIP-137 message hash in `signing-bip137.test.ts`).

The fixture must use a known 2-of-3 test descriptor with deterministic test xpubs (BIP-32 test vectors or hardcoded test keys). It pins the `computeBtcPayloadFingerprint` output for a 1-input P2WSH multisig spend — identical function as Fixtures O/P/Q/V but with a P2WSH prevout script.

Planner must add Fixture X to `test/signing-fingerprint.test.ts` in Wave 0 before any multisig signing code.

Cross-link: `test/tools-sign-btc-multisig-psbt.test.ts` consumer re-anchor.

### Sampling Rate
- **Per task commit:** `npx vitest run test/btc-multisig-store.test.ts test/btc-multisig-combine.test.ts test/btc-multisig-finalize.test.ts`
- **Per wave merge:** `npx vitest run`
- **Phase gate:** Full suite green before `/gsd-verify-work`

### Wave 0 Gaps
- [ ] `test/btc-multisig-store.test.ts` — covers BTC-PSBT-03 registry + atomic-write
- [ ] `test/btc-multisig-address-derivation.test.ts` — covers BIP-67 sortedmulti address derivation
- [ ] `test/btc-multisig-combine.test.ts` — covers BTC-PSBT-05 conflict detection
- [ ] `test/btc-multisig-finalize.test.ts` — covers BTC-PSBT-07 threshold enforcement
- [ ] `test/signing-fingerprint.test.ts` — Fixture X literal added for multisig PSBT fingerprint
- [ ] `test/tools-sign-btc-multisig-psbt.test.ts` — Fixture X consumer re-anchor + prepare pipeline unit tests

---

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | — |
| V3 Session Management | no | — |
| V4 Access Control | no | — |
| V5 Input Validation | yes | Descriptor string parsing + xpub format validation before BIP-32 derivation |
| V6 Cryptography | yes | `computeBtcPayloadFingerprint` (btc-fingerprint.ts FROZEN); BIP-143 sighash (btc-sighash.ts FROZEN) |

### Known Threat Patterns for BTC Multisig Stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Malleable PSBT (co-signer injects extra inputs/outputs before signing) | Tampering | `payloadFingerprint` computed at prepare time over original PSBT; send_transaction drift gate catches modification |
| Conflicting signature injection (co-signer provides a PSBT with a different sig for a key already signed) | Tampering | Pre-combine conflict scan; `PSBT_COMBINE_CONFLICT` structured error surfaces the conflict |
| Under-threshold broadcast (user tries to broadcast before M sigs collected) | Spoofing | `finalize_btc_psbt` threshold check per input; refuses with per-input deficit detail |
| Lost `walletHmac` (user loses the stored HMAC, must re-register) | Information Disclosure | `walletHmac` stored in 0o600 registry file; absent → clear error directing re-registration |
| Wrong multisig address (address shown to user doesn't match co-signers' view) | Spoofing | First 5 derived addresses surfaced in `register_btc_multisig_wallet` response; user verifies against co-signers before using |

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| `@ledgerhq/hw-app-btc` | Single-sig signing (existing) | ✓ | 11.0.0 | — |
| `@ledgerhq/ledger-bitcoin` | Multisig wallet-policy signing | ✓ (just installed) | 0.3.1 | — |
| `@bitcoinerlab/descriptors` | Descriptor parsing (transitive) | ✓ (transitive dep) | 3.1.7 | — |
| `bitcoinjs-lib` | PSBT combine + finalize | ✓ | ^7.0.1 | — |
| `bip32` | xpub derivation | ✓ | ^5.0.1 | — |
| Ledger BTC app v2.1+ | `registerWallet` APDU | — | unknown (device-dependent) | If device has app < 2.1, registerWallet will fail; surface as `LEDGER_BTC_APP_VERSION_TOO_OLD` structured error |

**Missing dependencies with no fallback:**
- Ledger BTC app v2.1+ is required for wallet-policy registration. If the device has an older app, the user must update Ledger Live to get the new BTC app. Phase 25 should check `appVersion` via `getAppConfiguration()` and refuse with a version hint if < 2.1.0.

---

## Sources

### Primary (HIGH confidence)
- `src/protocols/btc-psbt.ts` — PSBT assembly + combine usage patterns; Phase 23 design decisions
- `src/signing/btc-sighash.ts` — BIP-143/BIP-341 sighash logic; FROZEN
- `src/signing/btc-fingerprint.ts` — domain-tagged keccak256 fingerprint; FROZEN
- `src/wallet/non-evm-account-store.ts` — atomic-write persistence pattern to mirror
- `src/wallet/ledger-btc-transport.ts` — Phase 23/24 signBtcPsbt two-pass pattern; `signPsbtBuffer` usage
- `src/signing/handle-store.ts` — PreparedTxBtc kind union; discriminated union widening pattern
- `node_modules/@ledgerhq/hw-app-btc/lib/BtcNew.d.ts` — signPsbtBuffer type + WalletPolicy limitation
- `node_modules/@ledgerhq/hw-app-btc/lib/newops/policy.js` — WalletPolicy runtime code; DefaultDescriptorTemplate only in signPsbtBuffer path
- `node_modules/@ledgerhq/ledger-bitcoin/build/main/lib/appClient.d.ts` — AppClient.registerWallet + signPsbt full API
- `node_modules/@ledgerhq/ledger-bitcoin/build/main/lib/policy.d.ts` — WalletPolicy with flexible `string` descriptorTemplate
- `node_modules/bip174/src/esm/lib/combiner/index.js` — `keyPusher` silent-drop confirmed
- `node_modules/@bitcoinerlab/descriptors/node_modules/@bitcoinerlab/descriptors-core/dist/re.js` — sortedmulti regex patterns
- `test/signing-fingerprint.test.ts` — fixture letter assignments; confirmed V = last BTC fixture, X = next free

### Secondary (MEDIUM confidence)
- [Ledger app-bitcoin-new wallet.md](https://github.com/LedgerHQ/app-bitcoin-new/blob/master/doc/wallet.md) — wallet policy registration, non-default policy requirements, walletHMAC mechanism [CITED: https://github.com/LedgerHQ/app-bitcoin-new/blob/master/doc/wallet.md]

### Tertiary (LOW confidence)
- None

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all libraries verified from installed source files and npm registry
- Ledger SDK fork: HIGH — empirically confirmed from .d.ts files that signPsbtBuffer is limited to DefaultDescriptorTemplate; AppClient.signPsbt in @ledgerhq/ledger-bitcoin accepts WalletPolicy with any string template
- PSBT combine conflict semantics: HIGH — confirmed from bip174 combiner/index.js source read
- Architecture patterns: HIGH — derived from existing Phase 23/24 patterns in codebase
- Ledger device BTC app version requirement: MEDIUM — documented requirement but not verified against a real device in this session

**Research date:** 2026-05-22
**Valid until:** 2026-06-22 (Ledger SDK updates are infrequent; bitcoinjs-lib API stable)
