---
phase: 25-btc-psbt-multisig-flow
reviewed: 2026-05-22T22:10:00Z
depth: deep
files_reviewed: 17
files_reviewed_list:
  - src/config/btc-multisig-storage.ts
  - src/wallet/btc-multisig-store.ts
  - src/protocols/btc-psbt.ts
  - src/signing/handle-store.ts
  - src/signing/blocks-btc.ts
  - src/signing/error-codes.ts
  - src/tools/register_btc_multisig_wallet.ts
  - src/tools/combine_btc_psbts.ts
  - src/tools/finalize_btc_psbt.ts
  - src/tools/sign_btc_multisig_psbt.ts
  - src/tools/get_btc_multisig_balance.ts
  - src/tools/get_btc_multisig_utxos.ts
  - src/tools/preview_send.ts
  - src/tools/send_transaction.ts
  - src/wallet/ledger-btc-transport.ts
  - test/signing-fingerprint.test.ts
  - test/tools-sign-btc-multisig-psbt.test.ts
findings:
  critical: 1
  warning: 3
  info: 3
  total: 7
status: fixed
---

# Phase 25: Code Review Report

**Reviewed:** 2026-05-22T22:10:00Z
**Depth:** deep
**Files Reviewed:** 17
**Status:** issues_found

## Summary

Phase 25 adds a complete BTC M-of-N multisig signing lifecycle: registry (Plan 25-01),
combine with pre-scan conflict detection (Plan 25-02), and the full
prepare→preview→send signing pipeline plus finalization (Plan 25-03).

The core security properties are correctly implemented:
- Pre-combine conflict scan fires before `Psbt.combine()` on all (i,j) pairs — the
  load-bearing T-25-06 / T-25-08 guard is sound.
- `finalize_btc_psbt` counts `partialSig.length` per input and refuses before
  `finalizeAllInputs()` when under-threshold — T-25-11 is mitigated.
- `walletHmac` absent gate fires at both prepare time (`sign_btc_multisig_psbt`) and
  send time (`send_transaction`) — T-25-12 has belt-and-suspenders coverage.
- Fixture X is a hardcoded `0xced8fc41…` literal with a cross-link from the consumer
  test — no `beforeAll`-snapshot anti-pattern.
- Registry persists at `0o600` via atomic tempfile+rename.
- The Ledger version gate (`< 2.1`) in `registerBtcMultisigWallet` / `signBtcMultisigPsbt`
  mirrors the T-25-13 plan mitigation.

One critical finding: a duplicate `VERIFY_ON_DEVICE_MULTISIG_TEMPLATE` definition
that violates the project's format-fanout rule and will silently diverge. Three
warnings: a missing `threshold <= N` guard on records loaded from disk, a dead-code
variable in the prepare handler, and a fragile fallback in the WalletPolicy shim.
Three info items.

---

## Critical Issues

### CR-01: Duplicate `VERIFY_ON_DEVICE_MULTISIG_TEMPLATE` — format-fanout violation

**File:** `src/tools/register_btc_multisig_wallet.ts:71` and `src/signing/blocks-btc.ts:256`

**Issue:** `VERIFY_ON_DEVICE_MULTISIG_TEMPLATE` is defined independently in two source files with byte-identical content today. `register_btc_multisig_wallet.ts` does NOT import from `blocks-btc.ts` — it declares its own copy. The test imports from `register_btc_multisig_wallet.ts` (line 51 of `tools-register-btc-multisig-wallet.test.ts`), bypassing the canonical location in `blocks-btc.ts` entirely.

CLAUDE.md states: *"Re-declaring any of these blocks in another file violates the format-fanout-regex-sync invariant — a string-shape edit here would silently leave the duplicate behind."* This is exactly the stated anti-pattern: a future edit to either copy leaves the other silently stale, producing a display mismatch that neither TypeScript nor tests would catch (both would pass, each checking their own copy).

**Fix:** Delete the definition from `register_btc_multisig_wallet.ts` and import from `blocks-btc.ts`:

```typescript
// In src/tools/register_btc_multisig_wallet.ts — replace lines 71-82 with:
import {
  VERIFY_ON_DEVICE_MULTISIG_TEMPLATE,
  // ... other block imports
} from "../signing/blocks-btc.js";
```

Update `test/tools-register-btc-multisig-wallet.test.ts` to import from `blocks-btc.ts` (or indirectly via the tool that now re-exports it if needed). The `export const VERIFY_ON_DEVICE_MULTISIG_TEMPLATE` declaration in `register_btc_multisig_wallet.ts` can remain as a re-export if the test depends on it, but the string literal must live in exactly one place.

---

## Warnings

### WR-01: `validateRecord` does not check `threshold <= totalSigners`

**File:** `src/wallet/btc-multisig-store.ts:129-136`

**Issue:** The `validateRecord` function checks `threshold >= 1` (line 129) and `totalSigners >= 1` (line 133) independently, but never asserts `threshold <= totalSigners`. A tampered `btc-multisig.json` with `{"threshold": 10, "totalSigners": 2, ...}` passes validation and is loaded into the in-memory store. Both `get_btc_multisig_balance` and `sign_btc_multisig_psbt` then operate against this impossible record.

While the registered descriptor is the authoritative source of M and N, `finalize_btc_psbt` accepts a user-supplied `threshold` argument (not from the registry), so this is not a direct exploit path for finalization. However the corrupted record could be used to call `sign_btc_multisig_psbt` with a threshold that exceeds N, producing misleading co-signer status rows (showing `10 still needed` for a 2-of-N wallet), or confusing downstream `preview_send` output.

**Fix:**
```typescript
// After line 136 in validateRecord:
if (r.threshold > r.totalSigners) {
  log("warn", `btc-multisig-store: dropping record where threshold (${r.threshold}) > totalSigners (${r.totalSigners})`);
  return null;
}
```

### WR-02: Dead `descriptorTemplate` variable in `sign_btc_multisig_psbt`

**File:** `src/tools/sign_btc_multisig_psbt.ts:518-521`

**Issue:** `descriptorTemplate` is computed from `descriptorKeys` at lines 518-519 and then immediately suppressed with `void descriptorTemplate` (line 521) with a comment "Used at send time via wallet.descriptor re-lookup." The variable is not stored anywhere — `send_transaction.ts` independently reconstructs the descriptor template from the registry at send time (line 1574). The computation and suppression is dead code that misleads readers into thinking the value is propagated somewhere.

**Fix:** Remove lines 438-521 (`parsed`, `descriptorKeys`, `descriptorTemplate`, `void descriptorTemplate`). The handle already stores `multisigWalletName`; `send_transaction.ts` loads the wallet and parses the descriptor at send time — no intermediate computed value is needed at prepare time.

```typescript
// Delete these lines from sign_btc_multisig_psbt.ts:
const parsed = parseWshSortedMulti(wallet.descriptor);
const descriptorKeys: string[] = parsed?.keys ?? [];
// ...
const descriptorTemplate = `wsh(sortedmulti(${threshold},${descriptorKeys.map((_, i) => `@${i}/**`).join(",")}))`;
void descriptorTemplate; // Used at send time via wallet.descriptor re-lookup
```

Also remove the now-unused import of `parseWshSortedMulti` from `btc-multisig-store` in `sign_btc_multisig_psbt.ts`.

### WR-03: `WalletPolicy` shim falls back to the module namespace object

**File:** `src/wallet/ledger-btc-transport.ts:87`

**Issue:**
```typescript
const WalletPolicy: any = (AppClientModule as any).WalletPolicy 
  ?? ((AppClientModule as any).default?.WalletPolicy) 
  ?? AppClientModule;  // <-- fallback: the entire module namespace object
```

The tertiary fallback is `AppClientModule` itself (the namespace object), not `undefined`. If both lookup paths fail, `new WalletPolicy(...)` silently passes the namespace object as the constructor, producing a runtime error whose message ("AppClientModule is not a constructor") is far less diagnostic than a clear assertion. Verified at runtime: `AppClientModule.WalletPolicy` is defined, so the fallback is never reached today. But if the package ships a breaking export refactor, this will produce a confusing runtime error instead of a clear startup-time guard.

**Fix:**
```typescript
const WalletPolicy: any = (AppClientModule as any).WalletPolicy 
  ?? (AppClientModule as any).default?.WalletPolicy;
if (!WalletPolicy) {
  throw new Error("@ledgerhq/ledger-bitcoin: WalletPolicy export not found — check package version");
}
```

---

## Info

### IN-01: `combineBtcPsbts` in `btc-psbt.ts` has no minimum-input guard

**File:** `src/protocols/btc-psbt.ts:502`

**Issue:** `combineBtcPsbts` accepts a `readonly string[]` of any length, including 0 or 1 element. With 0 elements, `psbts[0]!` is `undefined` and `combined.combine([])` throws `"Combine: Nothing to combine"`, returned as `{ kind: "error" }`. With 1 element, same path. The tool handler (`combine_btc_psbts.ts:92`) adds a `< 2` guard before calling the helper, so no production caller reaches this path. However, the helper is exposed in the `_btcPsbt` spy-affordance and could be called directly from tests or future callers without the guard.

**Fix:** Add a guard inside `combineBtcPsbts`:
```typescript
if (psbtBase64s.length < 2) {
  return { kind: "error", message: "combineBtcPsbts requires at least 2 PSBTs" };
}
```

### IN-02: `registrationNote` variable declared without initializer is technically always-assigned but fragile

**File:** `src/tools/register_btc_multisig_wallet.ts:311`

**Issue:** `let registrationNote: string;` is declared without initialization. TypeScript's definite-assignment analysis confirms it is always assigned before use (all branches assign it), so `tsc --noEmit` passes. However, if a future branch is added inside the `try` block that returns early without setting `registrationNote` — before the `// Other device error` catch arm — it would become uninitialized without TypeScript necessarily catching it (if the new branch throws or returns).

**Fix:** Initialize to a safe default at declaration:
```typescript
let registrationNote = "Device registration status unknown.";
```
This is trivial hardening with no behavioral change today.

### IN-03: `get_btc_multisig_balance` gap-limit scan batches can over-count `consecutiveEmpty`

**File:** `src/tools/get_btc_multisig_balance.ts:154-201`

**Issue:** The `batchSize` is computed as `Math.min(SCAN_CONCURRENCY, BIP44_GAP_LIMIT - consecutiveEmpty)` (line 155-158). When `consecutiveEmpty` is close to `BIP44_GAP_LIMIT`, the batch shrinks, but the loop increments `consecutiveEmpty` by 1 per address within the batch (line 196). If a batch of size 5 starts when `consecutiveEmpty === 16`, all 5 addresses are empty: `consecutiveEmpty` becomes 17, 18, 19, 20, which triggers `break outer` at `k=3` — the 4th and 5th addresses of the batch are still awaited (via `Promise.all`) but their results are discarded after the break.

This is not a security issue — `Promise.all` fulfills before the inner loop runs — but the batching math does not correctly trim the final batch to exactly `BIP44_GAP_LIMIT - consecutiveEmpty` remaining slots when the gap limit is reached mid-batch. In the worst case, up to 4 extra Esplora HTTP requests are fired and discarded. The analogue in `xpub-scan.ts` handles this differently. Not a correctness bug for balance accuracy, but wasteful and inconsistent with the scan-stop intent.

---

_Reviewed: 2026-05-22T22:10:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep_
