# Phase 25: PSBT Multisig Flow — Pattern Map

**Mapped:** 2026-05-22
**Files analyzed:** 13 new/modified files
**Analogs found:** 13 / 13

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/config/btc-multisig-storage.ts` | config | request-response | `src/config/non-evm-storage.ts` | exact |
| `src/wallet/btc-multisig-store.ts` | service | CRUD | `src/wallet/non-evm-account-store.ts` | exact |
| `src/protocols/btc-psbt.ts` (EXTEND) | utility | transform | itself | self |
| `src/signing/handle-store.ts` (EXTEND) | utility | request-response | itself (PreparedTxBtc kind union) | self |
| `src/signing/error-codes.ts` (EXTEND) | utility | request-response | itself (Phase 24 BTC additive block) | self |
| `src/signing/blocks-btc.ts` (EXTEND) | utility | request-response | itself (Phase 24 RBF template append) | self |
| `src/wallet/ledger-btc-transport.ts` (EXTEND) | service | request-response | itself (`_btcLedgerTransport` spy-affordance) | self |
| `src/tools/register_btc_multisig_wallet.ts` | tool/controller | request-response | `src/tools/pair_btc_ledger.ts` | exact |
| `src/tools/get_btc_multisig_balance.ts` | tool/controller | CRUD | `src/tools/get_btc_account_balance.ts` | exact |
| `src/tools/get_btc_multisig_utxos.ts` | tool/controller | CRUD | `src/tools/get_btc_account_balance.ts` | role-match |
| `src/tools/combine_btc_psbts.ts` | tool/controller | transform | `src/protocols/btc-psbt.ts` (decodeBtcPsbt) | role-match |
| `src/tools/sign_btc_multisig_psbt.ts` | tool/controller | request-response | `src/tools/prepare_btc_rbf_bump.ts` | exact |
| `src/tools/finalize_btc_psbt.ts` | tool/controller | transform | `src/protocols/btc-psbt.ts` (buildBtcPsbt) | role-match |
| `test/signing-fingerprint.test.ts` (EXTEND) | test | — | itself (Fixture V block as Wave-0 anchor) | self |
| `test/btc-multisig-store.test.ts` (NEW) | test | — | existing `test/tools-pair-btc-ledger.test.ts` | role-match |
| `test/btc-multisig-combine.test.ts` (NEW) | test | — | `test/tools-prepare-btc-rbf-bump.test.ts` | role-match |
| `test/btc-multisig-finalize.test.ts` (NEW) | test | — | `test/tools-prepare-btc-rbf-bump.test.ts` | role-match |
| `test/tools-sign-btc-multisig-psbt.test.ts` (NEW) | test | — | `test/tools-prepare-btc-rbf-bump.test.ts` | exact |

---

## Pattern Assignments

---

### `src/config/btc-multisig-storage.ts` (config, request-response)

**Analog:** `src/config/non-evm-storage.ts`

**Imports pattern** (`non-evm-storage.ts` lines 29–32):
```typescript
import { existsSync, mkdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { log } from "../diagnostics/logger.js";
```

**Core pattern** (`non-evm-storage.ts` lines 52–82):
```typescript
export type BtcMultisigStorageMode = "memory" | "persist";

export function getBtcMultisigStorageMode(): BtcMultisigStorageMode {
  const raw = read("VAULTPILOT_BTC_MULTISIG_STORAGE");
  if (raw === undefined) return "persist";
  if (raw === "memory") return "memory";
  if (raw === "persist") return "persist";
  log("error", `VAULTPILOT_BTC_MULTISIG_STORAGE must be "memory" or "persist"; got "${raw}". Refusing to boot.`);
  process.exit(1);
}

export function getBtcMultisigStorageDir(): string {
  return join(homedir(), ".vaultpilot-mcp");
}

export function getBtcMultisigStoragePath(): string {
  return join(getBtcMultisigStorageDir(), "btc-multisig.json");
}
```

**`ensureStorageDirWithPerms` pattern** (`non-evm-storage.ts` lines 100–143): copy verbatim; swap `VAULTPILOT_NON_EVM_STORAGE` references to the new env var name (but the storage dir is the same `~/.vaultpilot-mcp/`).

---

### `src/wallet/btc-multisig-store.ts` (service, CRUD)

**Analog:** `src/wallet/non-evm-account-store.ts`

**File-header comment pattern** (`non-evm-account-store.ts` lines 1–32): Copy the comment shape explaining: what lives in the file, the atomic-write discipline, ESM spy-affordance note.

**Imports pattern** (`non-evm-account-store.ts` lines 33–41):
```typescript
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { log } from "../diagnostics/logger.js";
import {
  ensureStorageDirWithPerms,
  getBtcMultisigStorageDir,      // Phase 25 name
  getBtcMultisigStorageMode,     // Phase 25 name
  getBtcMultisigStoragePath,     // Phase 25 name
} from "../config/btc-multisig-storage.js";
```

**Record interface pattern** (`non-evm-account-store.ts` lines 52–70):
```typescript
export interface BtcMultisigWalletRecord {
  name: string;           // user-assigned wallet name (max 16 chars — Ledger APDU limit)
  descriptor: string;     // full wsh(sortedmulti(M, ...)) descriptor string
  threshold: number;      // M
  totalSigners: number;   // N
  keyFingerprints: string[];   // 8-hex-char fingerprints from descriptor
  firstAddresses: string[];    // first 5 derived P2WSH receive addresses
  registeredAt: string;        // ISO-8601 UTC
  walletHmac?: string;         // 32-byte hex from Ledger registerWallet; optional
}
```

**ESM spy-affordance pattern** (`non-evm-account-store.ts` lines 93–99):
```typescript
export const _btcMultisigStorage = {
  existsSync,
  readFileSync,
  writeFileSync,
  renameSync,
  ensureStorageDirWithPerms,
};
```

**Atomic-write pattern** (`non-evm-account-store.ts` lines 160–170):
```typescript
function writeAtomic(records: BtcMultisigWalletRecord[]): void {
  const path = getBtcMultisigStoragePath();
  const tmp = `${path}.tmp.${process.pid}`;
  const json = JSON.stringify(records, null, 2);
  _btcMultisigStorage.writeFileSync(tmp, json, { mode: 0o600 });
  _btcMultisigStorage.renameSync(tmp, path);
}
```

**`loadFromDisk` pattern** (`non-evm-account-store.ts` lines 194–249):
- Same try/catch on `readFileSync` → log warn + return
- Same try/catch on `JSON.parse` → log warn + return (do NOT delete file — forensic option)
- `!Array.isArray(parsed)` guard → log warn + return
- `validateRecord(entry)` per-entry drop-invalid approach

**`saveAccount`/`saveMultisigWallet` pattern** (`non-evm-account-store.ts` lines 263–274):
```typescript
export function saveMultisigWallet(record: BtcMultisigWalletRecord): void {
  loadFromDisk();
  // Upsert on `name` uniqueness key (Phase 25 — name is the PK, not (chain, address))
  const filtered = inMemoryStore.filter((r) => r.name !== record.name);
  filtered.push(record);
  inMemoryStore = filtered;
  if (getBtcMultisigStorageMode() === "memory") return;
  _btcMultisigStorage.ensureStorageDirWithPerms(getBtcMultisigStorageDir());
  writeAtomic(inMemoryStore);
}
```

**`_resetForTesting` pattern** (`non-evm-account-store.ts` lines 354–358): copy verbatim, rename to `_resetBtcMultisigStoreForTesting`.

---

### `src/protocols/btc-psbt.ts` (EXTEND — add `combineBtcPsbts` + `finalizeBtcPsbt` helpers)

**Analog:** itself (Phase 23/24 existing content)

**File structure to follow** (`btc-psbt.ts` lines 1–32): The existing module comment lists "Consumed by:" — append Phase 25 tools. The ESM spy-affordance indirection object at line 452 must be extended:

**ESM spy-affordance extension** (`btc-psbt.ts` line 452):
```typescript
// Before (Phase 23):
export const _btcPsbt = { buildBtcPsbt, decodeBtcPsbt };

// After (Phase 25 additive extension):
export const _btcPsbt = { buildBtcPsbt, decodeBtcPsbt, combineBtcPsbts, finalizeBtcPsbt };
```

**New exports to add** (modeled after the discriminated-union return style seen in `decodeBtcPsbt`):

```typescript
/** Result from combineBtcPsbts — discriminated union, NEVER throws. */
export type BtcCombineResult =
  | { readonly kind: "ok"; readonly psbtBase64: string }
  | { readonly kind: "conflict"; readonly conflicts: readonly BtcPsbtConflict[] }
  | { readonly kind: "error"; readonly message: string };

export interface BtcPsbtConflict {
  readonly inputIndex: number;
  readonly pubkeyHex: string;
  readonly sigHex0: string;   // signature from first PSBT in the array
  readonly sigHex1: string;   // conflicting signature from another PSBT
}

/** Result from finalizeBtcPsbt — discriminated union, NEVER throws. */
export type BtcFinalizeResult =
  | { readonly kind: "ok"; readonly finalPsbtBase64: string; readonly txHex: string }
  | { readonly kind: "threshold-not-met"; readonly underThresholdInputs: readonly number[] }
  | { readonly kind: "error"; readonly message: string };
```

**Combine conflict-scan pattern** (from RESEARCH Pattern 3 + confirmed bip174 source):
```typescript
// Pre-scan BEFORE Psbt.combine — bip174 keyPusher silently drops duplicate keys.
// Only call Psbt.combine after this returns no conflicts.
export function combineBtcPsbts(psbtBase64s: readonly string[], threshold: number): BtcCombineResult {
  // 1. Parse all PSBTs (catch malformed input — return "error" kind)
  // 2. For each pair (i, j), for each input index, for each pubkey in BOTH:
  //    if sig bytes differ → push to conflicts[]
  // 3. If conflicts.length > 0 → return { kind: "conflict", conflicts }
  // 4. psbts[0].combine(...psbts.slice(1))
  // 5. return { kind: "ok", psbtBase64: combined.toBase64() }
}
```

**Finalize threshold-check pattern** (from RESEARCH Pattern 5):
```typescript
export function finalizeBtcPsbt(psbtBase64: string, threshold: number): BtcFinalizeResult {
  try {
    const psbt = Psbt.fromBase64(psbtBase64);
    const underThreshold: number[] = [];
    for (let i = 0; i < psbt.data.inputs.length; i++) {
      const sigs = psbt.data.inputs[i]?.partialSig ?? [];
      if (sigs.length < threshold) underThreshold.push(i);
    }
    if (underThreshold.length > 0) {
      return { kind: "threshold-not-met", underThresholdInputs: underThreshold };
    }
    psbt.finalizeAllInputs();
    return { kind: "ok", finalPsbtBase64: psbt.toBase64(), txHex: psbt.extractTransaction().toHex() };
  } catch (err) {
    return { kind: "error", message: err instanceof Error ? err.message : String(err) };
  }
}
```

---

### `src/signing/handle-store.ts` (EXTEND — widen `kind` union)

**Analog:** itself (Phase 24 RBF widening at line 570)

**Widening pattern** (`handle-store.ts` lines 565–570):
```typescript
// Phase 23 (original):
kind: "native" | "rbf";

// Phase 25 widening (additive — state machine + TTL BYTE-IDENTICAL):
kind: "native" | "rbf" | "multisig-psbt";
```

**Comment to add** (mirror of Phase 24 comment at line 570):
```typescript
/**
 * BTC send kind. `"native"` covers all Phase 23 sends (segwit / taproot /
 * mixed-input). `"rbf"` covers Phase 24 RBF replacement transactions.
 * `"multisig-psbt"` covers Phase 25 M-of-N multisig PSBT signing.
 */
kind: "native" | "rbf" | "multisig-psbt";
```

**New optional fields to add** (additive on `PreparedTxBtc`, after existing RBF-only fields):
```typescript
// -----------------------------------------------------------------------
// Multisig-PSBT-only optional fields (Phase 25 — Plan 25-xx).
// Present only when `kind === "multisig-psbt"`.
// -----------------------------------------------------------------------

/**
 * Name of the registered multisig wallet from btc-multisig.json.
 * Non-null when `kind === "multisig-psbt"`.
 */
multisigWalletName?: string;

/**
 * Threshold M for this multisig wallet.
 * Non-null when `kind === "multisig-psbt"`.
 */
multisigThreshold?: number;

/**
 * Total signers N for this multisig wallet.
 * Non-null when `kind === "multisig-psbt"`.
 */
multisigTotalSigners?: number;
```

**No state-machine changes:** The state machine (`createHandle`, `transitionToPreviewed`, `transitionToSent`, `transitionToCancelled`) is FROZEN and unchanged. Only the `PreparedTxBtc` interface and the `kind` literal union are widened.

---

### `src/signing/error-codes.ts` (EXTEND — add Phase 25 BTC multisig error codes)

**Analog:** itself (Phase 24 additive block at lines 159–186)

**Additive pattern** (mirror Phase 24's comment block + union extension at lines 160–186):
```typescript
// Phase 25 Plan 25-xx — BTC multisig error codes (additive).
//
//   PSBT_COMBINE_CONFLICT         — combine_btc_psbts detected same-key same-input
//                                   conflicting signatures in two input PSBTs.
//                                   surfaces inputIndex + pubkeyHex + both sig hexes.
//   PSBT_THRESHOLD_NOT_MET        — finalize_btc_psbt refused: one or more inputs
//                                   have fewer than M partial signatures. Lists
//                                   under-threshold input indices.
//   MULTISIG_WALLET_NOT_FOUND     — sign_btc_multisig_psbt or get_btc_multisig_balance:
//                                   walletName not found in btc-multisig.json registry.
//   MULTISIG_WALLET_NOT_REGISTERED_ON_DEVICE — sign_btc_multisig_psbt: walletHmac
//                                   absent from registry record (device was not
//                                   connected at register time). Recovery: re-run
//                                   register_btc_multisig_wallet with device connected.
//   LEDGER_BTC_APP_VERSION_TOO_OLD — registerWallet APDU rejected; BTC app < v2.1.
//                                   Recovery: update Ledger Live to get BTC app 2.1+.
//   MULTISIG_DESCRIPTOR_INVALID   — descriptor string did not match
//                                   wsh(sortedmulti(M, ...)) form or M > N or M < 1.
| "PSBT_COMBINE_CONFLICT"
| "PSBT_THRESHOLD_NOT_MET"
| "MULTISIG_WALLET_NOT_FOUND"
| "MULTISIG_WALLET_NOT_REGISTERED_ON_DEVICE"
| "LEDGER_BTC_APP_VERSION_TOO_OLD"
| "MULTISIG_DESCRIPTOR_INVALID";
```

---

### `src/signing/blocks-btc.ts` (EXTEND — add Phase 25 multisig templates)

**Analog:** itself (Phase 24 RBF append at lines 135–199)

**New template pattern** (mirror `PREPARE_RECEIPT_BTC_RBF_TEMPLATE` structure at lines 154–165):
```typescript
// Phase 25 — Plan 25-xx — multisig PSBT signing templates (APPEND-ONLY)

export const PREPARE_RECEIPT_BTC_MULTISIG_TEMPLATE: string = [
  "PREPARE RECEIPT (BTC — multisig PSBT sign)",
  "  chain:          Bitcoin mainnet",
  "  walletName:     {WALLET_NAME}",
  "  threshold:      {THRESHOLD}-of-{TOTAL_SIGNERS}",
  "  inputs:",
  "{INPUT_ROWS}",
  "  outputs:",
  "{OUTPUT_ROWS}",
  "  feeSats:  {FEE_SATS}",
  "  co-signer status per input:",
  "{COSIGNER_STATUS_ROWS}",
].join("\n");

export const COSIGNER_STATUS_ROW_TEMPLATE: string =
  "    input[{INPUT_INDEX}]: {SIGS_PRESENT} of {THRESHOLD} sigs present — {STILL_NEEDED} still needed";
```

---

### `src/wallet/ledger-btc-transport.ts` (EXTEND — add `signBtcMultisigPsbt`)

**Analog:** itself (`signBtcPsbt` function at lines 343–464 + `_btcLedgerTransport` at lines 529–550)

**New import block to add at top** (mirror the NodeNext ESM default-export drift shim for the new package):
```typescript
import AppClientModule from "@ledgerhq/ledger-bitcoin";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const AppClient: any = (AppClientModule as any).default ?? AppClientModule;
```

**New error class** (mirror `LedgerBtcAppNotOpenError` at lines 120–127):
```typescript
export class LedgerBtcAppVersionTooOldError extends Error {
  constructor() {
    super(
      "Ledger Bitcoin app version too old for multisig wallet policies. " +
      "Update Ledger Live to install Bitcoin app 2.1+ on your device, then retry.",
    );
    this.name = "LedgerBtcAppVersionTooOldError";
  }
}
```

**New function `signBtcMultisigPsbt`** (mirror `signBtcPsbt` structure at lines 343–464):
```typescript
export async function signBtcMultisigPsbt(
  psbtBase64: string,
  walletName: string,
  descriptorTemplate: string,    // "wsh(sortedmulti(M,@0/**,@1/**,...))"
  keys: readonly string[],        // key expressions from descriptor
  walletHmacHex: string,          // 32-byte hex from registry
): Promise<{ updatedPsbtBase64: string }> {
  const transport = await openTransport();
  try {
    const app = _transport.buildBtcApp(transport);
    // Check BTC app version >= 2.1 (registerWallet APDU requires v2.1+)
    try {
      const cfg = await app.getAppConfiguration();
      // version check: if cfg.version < "2.1.0" → throw LedgerBtcAppVersionTooOldError
    } catch (e) {
      if (e instanceof LedgerBtcAppVersionTooOldError) throw e;
      throw new LedgerBtcAppNotOpenError();
    }
    // Build AppClient from @ledgerhq/ledger-bitcoin using the SAME transport
    const appClient = new AppClient(transport);
    const walletPolicy = new WalletPolicy(walletName, descriptorTemplate, keys);
    const walletHmac = Buffer.from(walletHmacHex, "hex");
    // signPsbt returns Map<inputIndex, PartialSignature>
    const sigs = await appClient.signPsbt(psbtBase64, walletPolicy, walletHmac);
    // Insert sigs into PSBT.data.inputs[i].partialSig
    const psbt = Psbt.fromBase64(psbtBase64);
    for (const [inputIndex, partialSig] of sigs) {
      psbt.data.inputs[inputIndex]!.partialSig ??= [];
      psbt.data.inputs[inputIndex]!.partialSig!.push({
        pubkey: partialSig.pubkey,
        signature: partialSig.signature,
      });
    }
    return { updatedPsbtBase64: psbt.toBase64() };
  } finally {
    try { await transport.close(); } catch (err) {
      log("warn", `transport.close() failed during signBtcMultisigPsbt cleanup: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}
```

**ESM spy-affordance extension** (`_btcLedgerTransport` at lines 529–550):
```typescript
// Phase 25 — extend _btcLedgerTransport with signBtcMultisigPsbt:
export const _btcLedgerTransport = {
  fetchBtcAddresses: (...) => fetchBtcAddresses(...),
  signBtcPsbt: (...) => signBtcPsbt(...),
  signBtcMessage: (...) => signBtcMessage(...),
  // Phase 25:
  signBtcMultisigPsbt: (
    psbtBase64: string,
    walletName: string,
    descriptorTemplate: string,
    keys: readonly string[],
    walletHmacHex: string,
  ): Promise<{ updatedPsbtBase64: string }> =>
    signBtcMultisigPsbt(psbtBase64, walletName, descriptorTemplate, keys, walletHmacHex),
};
```

---

### `src/tools/register_btc_multisig_wallet.ts` (tool, request-response)

**Analog:** `src/tools/pair_btc_ledger.ts`

**Full tool registration pattern** (`pair_btc_ledger.ts` lines 38–46):
```typescript
import { isDemoMode } from "../config/env.js";
import { saveMultisigWallet } from "../wallet/btc-multisig-store.js";
import {
  LedgerBtcAppNotOpenError,
  LedgerDeviceNotConnectedError,
  _btcLedgerTransport,
} from "../wallet/ledger-btc-transport.js";
import {
  type ErrorCode,
  type StructuredError,
  makeStructuredError,
} from "../signing/error-codes.js";
import { registerTool } from "./index.js";
```

**VERIFY-ON-DEVICE block pattern** (`pair_btc_ledger.ts` lines 80–): Copy the template-constant + `.replace("{PLACEHOLDER}", value)` substitution approach. Phase 25 needs a VERIFY-ON-DEVICE block showing the first 5 derived P2WSH addresses:
```typescript
export const VERIFY_ON_DEVICE_MULTISIG_TEMPLATE: string = [
  "VERIFY ON DEVICE (BTC — multisig wallet registration)",
  "  walletName:  {WALLET_NAME}",
  "  threshold:   {THRESHOLD}-of-{TOTAL_SIGNERS}",
  "  First 5 derived P2WSH receive addresses — verify against your co-signers:",
  "{ADDRESS_ROWS}",
  "  If these addresses match your co-signers' view, registration is correct.",
  "  If any address differs — STOP. Do not use this wallet for signing.",
].join("\n");
```

**Demo-mode refusal pattern** (copy `pair_btc_ledger.ts` DEMO_MODE_REFUSED guard):
```typescript
if (isDemoMode()) {
  return {
    isError: true,
    content: [{ type: "text", text: "error: register_btc_multisig_wallet is not available in demo mode." }],
    structuredContent: errEnvelope("DEMO_MODE_REFUSED", "register_btc_multisig_wallet unavailable in demo mode"),
  };
}
```

**Descriptor validation + address derivation:** Use RESEARCH Patterns 1 + 2 (parseWshSortedMulti + deriveMultisigAddress). After validation, derive 5 addresses. Then call `_btcLedgerTransport.signBtcMultisigPsbt`-related `registerWallet` path — or expose a separate `registerBtcMultisigWallet` helper if the plan splits device-registration from descriptor-registration.

---

### `src/tools/get_btc_multisig_balance.ts` and `get_btc_multisig_utxos.ts` (tool, CRUD)

**Analog:** `src/tools/get_btc_account_balance.ts`

**Tool registration pattern** (`get_btc_account_balance.ts` lines 71–80):
```typescript
registerTool(
  "get_btc_multisig_balance",
  DESCRIPTION,
  INPUT_SCHEMA,
  async (args) => {
    const walletNameArg = typeof args.walletName === "string" ? args.walletName : undefined;
    if (!walletNameArg) {
      return { isError: true, content: [{ type: "text", text: "error: walletName required" }],
               structuredContent: errEnvelope("INVALID_INPUT", "walletName required") };
    }
    // Load registry → get descriptor → derive addresses → fan-out Esplora reads
    const record = loadMultisigWallet(walletNameArg);
    if (!record) {
      return { isError: true, content: [{ type: "text", text: `error: wallet "${walletNameArg}" not found` }],
               structuredContent: errEnvelope("MULTISIG_WALLET_NOT_FOUND", `wallet "${walletNameArg}" not registered`) };
    }
    // ... address derivation + Esplora fan-out (mirrors scanXpub gap-limit pattern)
  }
);
```

**Gap-limit scan pattern** (see `src/chains/bitcoin/xpub-scan.ts` — existing `scanXpub` logic covers per-address Esplora reads with concurrency cap 5 and 20-consecutive-unused stop). Phase 25 derives P2WSH addresses instead of P2WPKH/P2TR, then calls the same per-address Esplora endpoints.

---

### `src/tools/combine_btc_psbts.ts` (tool, transform)

**Analog:** `src/protocols/btc-psbt.ts` (`decodeBtcPsbt` never-throws pattern)

**Key constraint:** `combine_btc_psbts` is a direct transform — NO handle, NO payloadFingerprint. Returns the merged PSBT base64 directly.

**Tool registration pattern** (same `registerTool` shape + `errEnvelope` helper from `prepare_btc_rbf_bump.ts` lines 61–72):
```typescript
registerTool(
  "combine_btc_psbts",
  DESCRIPTION,
  INPUT_SCHEMA,
  async (args) => {
    try {
      const psbtArray = Array.isArray(args.psbts) ? args.psbts as unknown[] : [];
      if (psbtArray.length < 2) { ... INVALID_INPUT ... }
      // Validate each element is a non-empty string
      const psbtBase64s: string[] = ...;
      // Call _btcPsbt.combineBtcPsbts (spy-affordance — testable)
      const result = _btcPsbt.combineBtcPsbts(psbtBase64s, /* threshold from args */);
      if (result.kind === "conflict") {
        return { isError: true, ..., structuredContent: errEnvelope("PSBT_COMBINE_CONFLICT", ...) };
      }
      if (result.kind === "error") {
        return { isError: true, ..., structuredContent: errEnvelope("INTERNAL_ERROR", result.message) };
      }
      return { content: [{ type: "text", text: `Combined PSBT:\n${result.psbtBase64}` }],
               structuredContent: { combinedPsbt: result.psbtBase64 } };
    } catch (err) { ... INTERNAL_ERROR ... }
  }
);
```

---

### `src/tools/sign_btc_multisig_psbt.ts` (tool, request-response — prepare arm)

**Analog:** `src/tools/prepare_btc_rbf_bump.ts` (closest: Phase 24, most recent PSBT-based prepare tool)

**Full handler pattern** (`prepare_btc_rbf_bump.ts` lines 60–767):

**Imports** (`prepare_btc_rbf_bump.ts` lines 33–58):
```typescript
import { Transaction } from "bitcoinjs-lib";
import { isDemoMode } from "../config/env.js";
import { getActiveBtcPersona } from "../demo/state.js";
import { PREPARE_RECEIPT_BTC_MULTISIG_TEMPLATE, INPUT_ROW_BTC_TEMPLATE, OUTPUT_ROW_BTC_TEMPLATE, COSIGNER_STATUS_ROW_TEMPLATE } from "../signing/blocks-btc.js";
import { _btcFingerprint } from "../signing/btc-fingerprint.js";
import { _btcSighash } from "../signing/btc-sighash.js";
import { type ErrorCode, type StructuredError, makeStructuredError } from "../signing/error-codes.js";
import { type PrepareArgs, type PreparedTxBtc, createHandle } from "../signing/handle-store.js";
import { loadMultisigWallet } from "../wallet/btc-multisig-store.js";
import { registerTool } from "./index.js";
```

**Step ordering** (mirror `prepare_btc_rbf_bump.ts` steps 1–15):
1. Input validation — FIRES FIRST (psbt base64 format, walletName non-empty)
2. Demo-mode refusal (same DEMO_MODE_REFUSED pattern)
3. Load multisig wallet from registry — MULTISIG_WALLET_NOT_FOUND if absent
4. Check walletHmac present — MULTISIG_WALLET_NOT_REGISTERED_ON_DEVICE if absent
5. Parse externally-supplied PSBT: `Psbt.fromBase64(psbtBase64)` — INVALID_INPUT if malformed
6. Extract `perInputPrevouts` from `psbt.data.inputs[i].witnessUtxo` (script + value)
7. Build `unsignedTxHex` from `psbt.data.globalMap.unsignedTx.toBuffer()` (reuse btc-psbt.ts pattern)
8. Compute per-input sighashes: `_btcSighash.computeAllSighashes(unsignedTx, sighashInputs)`
9. Compute `payloadFingerprint`: `_btcFingerprint.computeBtcPayloadFingerprint(perInputSighashes)`
10. Determine co-signer status per input: count `partialSig.length` vs threshold
11. Build `PreparedTxBtc` with `kind: "multisig-psbt"` + multisig fields
12. `createHandle({ args: prepareArgs, tx, payloadFingerprint })`
13. Build PREPARE RECEIPT using `PREPARE_RECEIPT_BTC_MULTISIG_TEMPLATE`
14. Return handle + payloadFingerprint + prepareReceipt

**PreparedTxBtc construction** (mirror `prepare_btc_rbf_bump.ts` lines 644–668):
```typescript
const tx: PreparedTxBtc = {
  txType: "btc",
  // EVM-shape sentinel fields (all zeros):
  chainId: 0,
  to: ZERO_EVM_ADDRESS,
  valueWei: 0n,
  data: "0x" as `0x${string}`,
  // BTC-specific:
  kind: "multisig-psbt",
  psbtBase64,                  // externally-supplied PSBT
  unsignedTxHex,               // from globalMap.unsignedTx
  perInputPrevouts,            // from psbt.data.inputs[i].witnessUtxo
  inputScriptTypes,            // "p2wsh" for all multisig inputs
  inputs: decodedInputs,
  outputs: decodedOutputs,
  feeSats,
  changeSats: 0n,              // multisig PSBT may or may not have change; compute from outputs
  feeRate: 0,                  // not known from external PSBT
  changePath: null,
  changeAddress: null,
  // Multisig-specific:
  multisigWalletName: walletName,
  multisigThreshold: record.threshold,
  multisigTotalSigners: record.totalSigners,
};
```

---

### `src/tools/finalize_btc_psbt.ts` (tool, transform)

**Analog:** `src/protocols/btc-psbt.ts` (`buildBtcPsbt` never-throws-at-call-site pattern) + `combine_btc_psbts.ts` (direct transform, no handle)

**Key constraint:** direct transform — NO handle, NO payloadFingerprint. Returns finalized PSBT + txHex.

**Tool registration pattern**:
```typescript
registerTool(
  "finalize_btc_psbt",
  DESCRIPTION,
  INPUT_SCHEMA,
  async (args) => {
    try {
      const psbtBase64 = typeof args.psbt === "string" ? args.psbt : "";
      const threshold = typeof args.threshold === "number" ? args.threshold : undefined;
      if (!psbtBase64) { ... INVALID_INPUT ... }
      if (threshold === undefined || threshold < 1) { ... INVALID_INPUT ... }
      const result = _btcPsbt.finalizeBtcPsbt(psbtBase64, threshold);
      if (result.kind === "threshold-not-met") {
        return { isError: true, ..., structuredContent: errEnvelope("PSBT_THRESHOLD_NOT_MET",
          `under-threshold inputs: ${result.underThresholdInputs.join(", ")}`) };
      }
      if (result.kind === "error") { ... INTERNAL_ERROR ... }
      return { content: [{ type: "text", text: `Final PSBT:\n${result.finalPsbtBase64}\ntxHex: ${result.txHex}` }],
               structuredContent: { finalPsbtBase64: result.finalPsbtBase64, txHex: result.txHex } };
    } catch (err) { ... }
  }
);
```

---

### `preview_send.ts` (EXTEND — multisig-psbt branch in `previewSendBtcBranch`)

**Analog:** `src/tools/preview_send.ts` lines 2084–2232 (`previewSendBtcBranch`)

**Key change:** When `btcTx.kind === "multisig-psbt"`, the PREPARE RECEIPT uses `PREPARE_RECEIPT_BTC_MULTISIG_TEMPLATE` and adds co-signer status rows. The payloadFingerprint recompute is identical (lines 2093–2104). The `previewToken` minting and `transitionToPreviewed` pattern (lines 2121–2142) is BYTE-IDENTICAL.

**Co-signer status logic to add** in the multisig branch:
```typescript
if (btcTx.kind === "multisig-psbt") {
  const psbt = Psbt.fromBase64(btcTx.psbtBase64);
  const cosignerRows = psbt.data.inputs.map((inp, idx) => {
    const sigsPresent = inp.partialSig?.length ?? 0;
    const stillNeeded = Math.max(0, (btcTx.multisigThreshold ?? 1) - sigsPresent);
    return COSIGNER_STATUS_ROW_TEMPLATE
      .replace("{INPUT_INDEX}", String(idx))
      .replace("{SIGS_PRESENT}", String(sigsPresent))
      .replace("{THRESHOLD}", String(btcTx.multisigThreshold ?? 1))
      .replace("{STILL_NEEDED}", String(stillNeeded));
  }).join("\n");
  // ... substitute into PREPARE_RECEIPT_BTC_MULTISIG_TEMPLATE
}
```

**`rerunTool` branch extension** (`preview_send.ts` line 2108):
```typescript
// Before:
const rerunTool = btcTx.kind === "rbf" ? "prepare_btc_rbf_bump" : "prepare_btc_send";
// After:
const rerunTool = btcTx.kind === "rbf" ? "prepare_btc_rbf_bump"
                : btcTx.kind === "multisig-psbt" ? "sign_btc_multisig_psbt"
                : "prepare_btc_send";
```

---

### `send_transaction.ts` (EXTEND — multisig-psbt dispatch in `sendTransactionBtcBranch`)

**Analog:** `src/tools/send_transaction.ts` lines 1400–1598 (`sendTransactionBtcBranch`)

**Key divergence from single-sig:** Instead of `_btcLedgerTransport.signBtcPsbt` (two-pass split), call `_btcLedgerTransport.signBtcMultisigPsbt` and return the updated PSBT base64 (NOT a broadcast txid):

```typescript
if (btcTx.kind === "multisig-psbt") {
  // Load registry to get walletHmac + descriptor
  const multisigRecord = loadMultisigWallet(btcTx.multisigWalletName!);
  if (!multisigRecord?.walletHmac) {
    return errResult("MULTISIG_WALLET_NOT_REGISTERED_ON_DEVICE", ...);
  }
  const { updatedPsbtBase64 } = await _btcLedgerTransport.signBtcMultisigPsbt(
    btcTx.psbtBase64,
    multisigRecord.name,
    buildDescriptorTemplate(multisigRecord.descriptor), // "@0/**,@1/**..." form
    extractKeys(multisigRecord.descriptor),
    multisigRecord.walletHmac,
  );
  // Return updated PSBT (NOT a broadcast txid)
  return {
    content: [{ type: "text", text: `Updated PSBT (your signature appended):\n${updatedPsbtBase64}` }],
    structuredContent: { updatedPsbtBase64, chain: "bitcoin", kind: "multisig-psbt", txType: "btc" },
  };
}
```

---

### `test/signing-fingerprint.test.ts` (EXTEND — add Fixture X)

**Analog:** itself — Fixture V block (lines 577–633)

**Fixture X placement:** After Fixture V (line 633). Fixture W does not exist in this file (see `test/signing-bip137.test.ts`), so X is the next letter.

**Fixture X template** (mirror Fixture V structure at lines 577–633):
```typescript
// --------------------------------------------------------------------------
// Fixture X — BTC multisig PSBT payloadFingerprint.
//
// Phase 25 / Plan 25-xx — 2-of-3 multisig P2WSH single-input.
//
// Input: P2WSH prevout script (wsh(sortedmulti(2, key0, key1, key2))),
// value=1_000_000 sats, txid=bb*32, vout=0, sequence=0xfffffffe.
// Output: P2WPKH (BTC_FIXTURE_SEGWIT_SCRIPT); value=900_000 sats.
//
// Hardcoded 0x… literal computed once at execute time via:
//   node -e "
//     import('./dist/signing/btc-sighash.js').then(async ({ computeAllSighashes }) => {
//       const { computeBtcPayloadFingerprint } = await import('./dist/signing/btc-fingerprint.js');
//       const { Transaction, payments, networks, crypto: btcCrypto } = await import('bitcoinjs-lib');
//       const { BIP32Factory } = await import('bip32');
//       const tinySecp = await import('tiny-secp256k1');
//       const bip32 = BIP32Factory(tinySecp.default);
//       // Use 3 known test xpubs derived from BIP-32 test vectors
//       // ... derive child pubkeys, sort, build p2ms + p2wsh witnessScript ...
//       const p2wsh = payments.p2wsh({ redeem: payments.p2ms({ m: 2, pubkeys: sorted, network: networks.bitcoin }) });
//       const script = p2wsh.output;
//       const tx = new Transaction();
//       tx.addInput(Buffer.alloc(32, 0xbb), 0, 0xfffffffe);
//       tx.addOutput(/* BTC_FIXTURE_SEGWIT_SCRIPT */, BigInt(900_000));
//       const sighashes = computeAllSighashes(tx, [{ scriptType: 'p2wsh', prevOutScript: script, valueSats: BigInt(1_000_000) }]);
//       console.log(computeBtcPayloadFingerprint(sighashes));
//     })
//   "
//
// NO `beforeAll`-snapshot per CLAUDE.md.
// Cross-link: consumed by test/tools-sign-btc-multisig-psbt.test.ts (Fixture X re-anchor).
// --------------------------------------------------------------------------
it("Fixture X — BTC 2-of-3 multisig P2WSH single-input → 0x<COMPUTED_AT_EXECUTE_TIME>... byte-for-byte", () => {
  // ... construct P2WSH prevout script from test xpubs + BIP-67 sort ...
  const fp = computeBtcPayloadFingerprint(sighashes);
  expect(fp).toBe("0x<COMPUTED_AT_EXECUTE_TIME>");
});
```

**CRITICAL:** The actual `0x...` hex literal MUST be computed at execute time (not estimated). The planner should instruct the implementer to compute and hardcode it in Wave 0 before any multisig signing code is written.

---

## Shared Patterns

### Atomic-write + 0o600 file permissions
**Source:** `src/wallet/non-evm-account-store.ts` lines 160–170
**Apply to:** `src/wallet/btc-multisig-store.ts` (the only Phase 25 file with disk writes)
```typescript
function writeAtomic(records: BtcMultisigWalletRecord[]): void {
  const path = getBtcMultisigStoragePath();
  const tmp = `${path}.tmp.${process.pid}`;
  const json = JSON.stringify(records, null, 2);
  _btcMultisigStorage.writeFileSync(tmp, json, { mode: 0o600 });
  _btcMultisigStorage.renameSync(tmp, path);
}
```

### ESM spy-affordance indirection
**Source:** `src/wallet/non-evm-account-store.ts` lines 93–99 + `src/wallet/ledger-btc-transport.ts` lines 141–147
**Apply to:** ALL new/modified files that have internal cross-export calls:
- `btc-multisig-store.ts` → `export const _btcMultisigStorage = { existsSync, readFileSync, writeFileSync, renameSync, ensureStorageDirWithPerms }`
- `btc-psbt.ts` (EXTEND) → extend `_btcPsbt` with new exports
- `ledger-btc-transport.ts` (EXTEND) → extend `_btcLedgerTransport` with `signBtcMultisigPsbt`

Pattern:
```typescript
export const _<scope> = {
  <functionName>: <functionName>,  // or inline arrow when needed for type narrowing
};
```

### `errEnvelope` local helper
**Source:** `src/tools/prepare_btc_rbf_bump.ts` lines 61–72
**Apply to:** ALL new tool handlers
```typescript
function errEnvelope(
  code: ErrorCode,
  message: string,
  cause?: string,
): Record<string, unknown> {
  return makeStructuredError(code, message, cause) as unknown as Record<string, unknown> & StructuredError;
}
```

### ZERO_EVM_ADDRESS sentinel
**Source:** `src/tools/prepare_btc_rbf_bump.ts` line 80
**Apply to:** `sign_btc_multisig_psbt.ts`
```typescript
const ZERO_EVM_ADDRESS = "0x0000000000000000000000000000000000000000" as `0x${string}`;
```

### NodeNext ESM default-export drift shim
**Source:** `src/wallet/ledger-btc-transport.ts` lines 69–76
**Apply to:** Any new import of `@ledgerhq/ledger-bitcoin` (AppClient)
```typescript
import AppClientModule from "@ledgerhq/ledger-bitcoin";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const AppClient: any = (AppClientModule as any).default ?? AppClientModule;
```

### Cryptographic-binding fixture discipline (NO beforeAll-snapshot)
**Source:** `test/signing-fingerprint.test.ts` Fixture V block (lines 577–633) + CLAUDE.md rule
**Apply to:** `test/signing-fingerprint.test.ts` Fixture X
- Hardcode the `0x...` literal in the test (computed once at execute time)
- Never use `beforeAll(() => { expected = computeBtcPayloadFingerprint(...); })` — drift must fail at a specific line

### BTC app guard (`getAppConfiguration()` call)
**Source:** `src/wallet/ledger-btc-transport.ts` lines 350–356
**Apply to:** `signBtcMultisigPsbt` (same guard pattern before any APDU exchange)
```typescript
try {
  await app.getAppConfiguration();
} catch {
  throw new LedgerBtcAppNotOpenError();
}
```

### Transport close in `finally`
**Source:** `src/wallet/ledger-btc-transport.ts` lines 456–463
**Apply to:** `signBtcMultisigPsbt`
```typescript
} finally {
  try {
    await transport.close();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log("warn", `transport.close() failed during <function> cleanup: ${message}`);
  }
}
```

---

## No Analog Found

All Phase 25 files have either exact or role-match analogs in the codebase. The following capability patterns are NEW but have documented analogs from RESEARCH:

| Pattern | Source | Notes |
|---------|--------|-------|
| `parseWshSortedMulti` descriptor parser | RESEARCH Code Examples section | No existing analog in codebase; use RESEARCH pattern directly |
| BIP-67 key sort (`Buffer.compare` on derived child pubkeys) | RESEARCH Pattern 2 | No existing P2WSH multisig address derivation in codebase; use RESEARCH pattern |
| `AppClient.registerWallet` call | `@ledgerhq/ledger-bitcoin` AppClient | No existing `registerWallet` call; use RESEARCH Pattern 4 |
| `AppClient.signPsbt` (wallet-policy) | `@ledgerhq/ledger-bitcoin` AppClient | Distinct from existing `signPsbtBuffer`; use RESEARCH Pattern 4 |

---

## Metadata

**Analog search scope:** `src/config/`, `src/wallet/`, `src/protocols/`, `src/signing/`, `src/tools/`, `test/`
**Files scanned:** 15 source files read in full, 8 via targeted grep
**Pattern extraction date:** 2026-05-22
