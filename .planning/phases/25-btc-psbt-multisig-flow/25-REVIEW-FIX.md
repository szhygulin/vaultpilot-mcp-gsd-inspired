---
phase: 25-btc-psbt-multisig-flow
fixed_at: 2026-05-22T22:20:00Z
review_path: .planning/phases/25-btc-psbt-multisig-flow/25-REVIEW.md
iteration: 1
findings_in_scope: 7
fixed: 6
skipped: 1
status: partial
---

# Phase 25: Code Review Fix Report

**Fixed at:** 2026-05-22T22:20:00Z
**Source review:** .planning/phases/25-btc-psbt-multisig-flow/25-REVIEW.md
**Iteration:** 1

**Summary:**
- Findings in scope: 7
- Fixed: 6
- Skipped: 1

## Fixed Issues

### CR-01: Duplicate `VERIFY_ON_DEVICE_MULTISIG_TEMPLATE` — format-fanout violation

**Files modified:** `src/tools/register_btc_multisig_wallet.ts`
**Commit:** 200399d
**Applied fix:** Deleted the 11-line string literal from `register_btc_multisig_wallet.ts` and replaced it with `import { VERIFY_ON_DEVICE_MULTISIG_TEMPLATE } from "../signing/blocks-btc.js"`. Added a re-export (`export { VERIFY_ON_DEVICE_MULTISIG_TEMPLATE }`) so the existing test that imports the constant from the tool module continues to work without a test-file change. Also applied IN-02 (initialize `registrationNote`) in the same file.

### WR-01: `validateRecord` does not check `threshold <= totalSigners`

**Files modified:** `src/wallet/btc-multisig-store.ts`, `test/btc-multisig-store.test.ts`
**Commit:** 0ca5bad
**Applied fix:** Added `if (r.threshold > r.totalSigners)` guard after the existing `totalSigners >= 1` check with a `log("warn", ...)` and `return null`. Added two regression tests: one asserting a tampered record `{threshold:10, totalSigners:2}` is dropped, another asserting a `{threshold:1, totalSigners:1}` edge-case is accepted.

### WR-02: Dead `descriptorTemplate` variable in `sign_btc_multisig_psbt`

**Files modified:** `src/tools/sign_btc_multisig_psbt.ts`
**Commit:** 3ee59b2
**Applied fix:** Removed the `const parsed = parseWshSortedMulti(wallet.descriptor)` / `const descriptorKeys` / `const descriptorTemplate` / `void descriptorTemplate` block (Step 13 preamble). Removed the now-orphaned `parseWshSortedMulti` named import from `btc-multisig-store.js`.

### WR-03: `WalletPolicy` shim falls back to the module namespace object

**Files modified:** `src/wallet/ledger-btc-transport.ts`
**Commit:** 200baed
**Applied fix:** Added a named import `WalletPolicy as WalletPolicyNamed` from `@ledgerhq/ledger-bitcoin`. Replaced the `?? AppClientModule` namespace fallback with a three-path resolution using the named import, `(AppClientModule as any).WalletPolicy`, and `(AppClientModule as any).default?.WalletPolicy`. The startup `throw` was moved into `registerBtcMultisigWallet` and `signBtcMultisigPsbt` (deferred to first call rather than module load time) so tests that mock the transport can still import the module without hitting the assertion.
**Note:** requires human verification — the three-path fallback order is behavioral; confirmed correct by runtime probe of `@ledgerhq/ledger-bitcoin` export shape.

### IN-01: `combineBtcPsbts` has no minimum-input guard

**Files modified:** `src/protocols/btc-psbt.ts`, `test/btc-multisig-combine.test.ts`
**Commit:** 4791944
**Applied fix:** Added `if (psbtBase64s.length < 2) return { kind: "error", message: "combineBtcPsbts requires at least 2 PSBTs" }` at the top of `combineBtcPsbts`. Added two regression tests (0-element array and 1-element array) asserting `kind: "error"` with message matching `/at least 2/i`.

### IN-02: `registrationNote` uninitialized `let`

**Files modified:** `src/tools/register_btc_multisig_wallet.ts`
**Commit:** 200399d (bundled with CR-01 — same file)
**Applied fix:** Changed `let registrationNote: string;` to `let registrationNote = "Device registration status unknown.";`. No behavioral change today; guards against a future early-return branch in the `try` block.

## Skipped Issues

### IN-03: `get_btc_multisig_balance` gap-limit scan over-requests on final batch

**File:** `src/tools/get_btc_multisig_balance.ts:154-201`
**Reason:** skipped — the fix requires restructuring the batch loop's break logic and is not a correctness bug. The analogue in `xpub-scan.ts` is handled differently; aligning these is a refactor that exceeds surgical-change scope. At most 4 extra Esplora HTTP requests are fired per scan stop; no balance accuracy issue.
**Original issue:** `consecutiveEmpty` can increment past `BIP44_GAP_LIMIT` mid-batch, causing up to `SCAN_CONCURRENCY - 1` extra HTTP requests whose results are discarded.

---

_Fixed: 2026-05-22T22:20:00Z_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
