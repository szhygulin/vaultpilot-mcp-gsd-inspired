---
title: WC v2 multi-account session — plumb all approved addresses + active-account selector
status: complete
created: 2026-05-12
completed: 2026-05-12
branch: fix/wc-multi-account-session
commits: 6
---

# Outcome

Fixed `sessionToStatus` dropping all but the first CAIP-10 account; the three read tools (`get_ledger_status`, `get_ledger_device_info`, `pair_ledger_live_wait`) now surface the full `accounts` array; new `set_active_account` tool switches which address `prepare_*` uses without re-pairing.

Trust boundary unchanged — `activeAccount` is a server-side convenience; the Ledger still signs whichever address the user confirms on-device.

# Commits (atomic, in order)

| # | Hash | Type | Summary |
|---|------|------|---------|
| 1 | `776c0f1` | `fix(wc)` | Parse all `eip155` accounts in `sessionToStatus` + extend `LedgerStatus` with `accounts: Address[]` and `activeAccount: Address`. |
| 2 | `c3b1e39` | `feat(wc)` | Add `setActiveAccount` + `NotPairedError` + `AccountNotInSessionError` (latter carries the in-session list). |
| 3 | `e9d2a66` | `feat(wc)` | Add `INVALID_ACCOUNT` to the structured error code set. |
| 4 | `5036212` | `feat(wc)` | New `set_active_account` tool — demo-mode `WRONG_MODE` guard, regex defense-in-depth, errors map to `WALLET_NOT_PAIRED` / `INVALID_ACCOUNT` envelopes. |
| 5 | `a68ea0a` | `fix(wc)` | Read tools surface `accounts`; signing pipeline reads `activeAccount`. Grep gate empty. |
| 6 | `7e0e189` | `test(wc)` | New `test/set-active-account.test.ts` + multi-account cases across 4 existing test files. |

# Files touched

**Production:** `src/wallet/session-manager.ts`, `src/signing/error-codes.ts`, `src/tools/register-all.ts`, `src/tools/pair_ledger_live_wait.ts`, `src/tools/get_ledger_status.ts`, `src/tools/get_ledger_device_info.ts`, `src/tools/prepare_native_send.ts`, `src/tools/preview_send.ts`, `src/tools/send_transaction.ts`, `src/tools/set_active_account.ts` (new).

**Tests:** `test/wallet-session-manager.test.ts`, `test/helpers/mock-sign-client.ts`, `test/get-ledger-status.test.ts`, `test/get-ledger-device-info.test.ts`, `test/pair-ledger-live-wait.test.ts`, `test/prepare-native-send.test.ts`, `test/preview-send.test.ts`, `test/send-transaction.test.ts`, `test/trust-pipeline.integration.test.ts`, `test/set-active-account.test.ts` (new).

# Acceptance gates (final state on branch tip `7e0e189`)

- `npm test` → 38 files / 304 tests pass.
- `tsc --noEmit` → exit 0.
- `grep -rn 'status\.address' src/tools/ src/signing/` → empty (every live read site migrated to `status.activeAccount`).

# Deviations from PLAN.md

1. **Task 1 included three test-shape updates.** Three existing `.toEqual({...})` strict-shape assertions in `wallet-session-manager.test.ts` broke the moment `LedgerStatus` gained the two new fields. Folded minimal shape additions into Task-1's commit — strict-shape deferral wasn't viable.
2. **`disconnect(topic)` got a third cleanup hook** for `activeAccountByTopic` (PLAN named only `session_delete` listener + `_resetSessionManagerForTesting`). Consistency with the existing `cachedSessionTopic` cleanup at the same call site.
3. **`get_ledger_device_info.ts` was implicitly in scope for Task 5** — file was named in PLAN's files-to-touch list but the line-77 read site wasn't called out individually. Caught by the grep gate.
4. **Serena not activated** — refactor was small enough (6 prod + 8 test files) that grep + Read + Edit was lower overhead per the global "skip Serena if you're not going to use symbolic tools" rule.

No scope expansion beyond the out-of-scope list (no address-book, no persistence, no event-emit, no compat shims, no re-pair-on-change, no new device-side verification).
