---
title: WC v2 multi-account session — plumb all approved addresses + active-account selector
description: Fix session-manager dropping all but the first CAIP-10 account; expose the full set to read tools; add set_active_account to switch which one prepare_* uses.
status: planned
created: 2026-05-12
---

# Bug

`sessionToStatus` in `src/wallet/session-manager.ts` reads only
`session.namespaces.eip155.accounts[0]`, so when the user approves multiple
Ethereum accounts in Ledger Live the extra addresses are silently discarded.
`get_ledger_status`, `get_ledger_device_info`, and `pair_ledger_live_wait`
therefore only ever surface the first address, and there is no way to switch
which one `prepare_*` uses without `pair_ledger_live({ force: true })`.

The active-account selector is a server-side convenience. The Ledger still
signs whichever address the user confirms on-device — UI mismatches are caught
on the device screen (project trust model).

# Tasks

Each task is sized for one atomic commit. Land them in order; commit at the
end of each.

1. **Widen `LedgerStatus` + `sessionToStatus` to parse all eip155 accounts.**
   - `src/wallet/session-manager.ts:65-70`: extend `LedgerStatus` with
     `accounts: Address[]` and `activeAccount: Address`. Keep `address` (now
     derived from `activeAccount` — same value, retained so existing reads
     continue to compile in this task and are migrated in task 5).
   - `src/wallet/session-manager.ts:486-500` (`sessionToStatus`): map every
     entry in `session.namespaces.eip155.accounts` through `parseEvmAccountId`,
     enforce a consistent `chainId` across them (throw the existing-shape
     error if not), build `accounts: Address[]`, default
     `activeAccount = accounts[0]`, derive `address = activeAccount`.
   - Module-scoped state: add `activeAccountByTopic: Map<string, Address>`
     beside `cachedSessionTopic`. `sessionToStatus` reads
     `activeAccountByTopic.get(session.topic) ?? accounts[0]` for
     `activeAccount`. Cleared by `_resetSessionManagerForTesting` and by the
     existing `session_delete` listener.

2. **Add `setActiveAccount(address)` to `session-manager.ts`.**
   - Resolve the current live session via `findLiveSession`; if none, throw a
     new `NotPairedError` (named to mirror the existing custom error classes
     in this file).
   - Parse the session's accounts; if `address` (checksum-insensitive
     compare via `getAddress`) is not in the set, throw a new
     `AccountNotInSessionError(address, accounts)`.
   - Otherwise write `activeAccountByTopic.set(session.topic,
     getAddress(address))` and return the resulting `LedgerStatus`.
   - Export both new error classes from `session-manager.ts`.

3. **Add `INVALID_ACCOUNT` to the structured error code set.**
   - `src/signing/error-codes.ts`: append `"INVALID_ACCOUNT"` to the
     `ErrorCode` union and add a producer-map entry pointing at
     `set_active_account` (matches the existing comment style — see
     `WRONG_MODE` precedent at lines 28-31). No other code emits it.

4. **New tool `set_active_account({ address })` in
   `src/tools/set_active_account.ts`.**
   - Pattern-match `set_demo_wallet.ts` for shape: schema with
     `address: string` (pattern `^0x[0-9a-fA-F]{40}$`, required,
     `additionalProperties: false`); demo-mode check FIRST returning
     `WRONG_MODE` (matches `set_demo_wallet`'s inverse refusal — `WRONG_MODE`
     is the locked code for "called in the wrong mode").
   - On `INVALID_INPUT` (regex fails) → structured refusal with the offending
     value named verbatim.
   - Call `setActiveAccount(args.address)`; catch `NotPairedError` →
     `WALLET_NOT_PAIRED` envelope; catch `AccountNotInSessionError` →
     `INVALID_ACCOUNT` envelope listing the addresses that ARE in the session
     (so the agent can self-correct without a second tool call).
   - Success response: `structuredContent: { address, accounts }`; text body
     `active account set to: <address>` plus a one-line note that the Ledger
     screen remains the source of truth at signing time.
   - Tool description (agent routing prompt — see CLAUDE.md "Tool descriptions
     are agent routing prompts"): single short paragraph naming what it does
     and when not to call it (read-only flows, demo mode).
   - Register in `src/tools/register-all.ts` next to `set_demo_wallet.js`.

5. **Surface `accounts` from the three read tools; switch `prepare_*` to
   `activeAccount`.**
   - `src/tools/pair_ledger_live_wait.ts:93-101`: pull `accounts` off `status`
     and add to both the `structuredContent` and the text response (one line:
     `accounts: [addr1, addr2, ...]`). The VERIFY-ON-DEVICE block continues to
     surface `status.address` (= active account) only — per spec, listing the
     array on-device would be noisy. Update the tool description's
     return-shape sentence to mention `accounts`.
   - `src/tools/get_ledger_status.ts:43-52`: add `accounts` to the paired
     branch's `structuredContent` and append one line to the text body.
     Description: add a sentence on multi-account.
   - `src/tools/get_ledger_device_info.ts:75-99`: add `accounts` to the
     paired-branch envelope and a one-line entry to the text block. Mention
     multi-account in the description and in the `hint` for paired state
     ("switch active account with `set_active_account`").
   - `src/tools/prepare_native_send.ts:230` (real-mode `fromAddress =
     status.address`): change to `status.activeAccount`. The existing
     `status.address` field still works (it equals `activeAccount`), but the
     intent is "the currently selected sender" — use the named field.
   - `src/tools/preview_send.ts:204` (`senderAddress = status.address`): same
     change.
   - `src/tools/send_transaction.ts:437` (`from: status.address`): same change.
   - Grep gate after the edits: `grep -n 'status\.address' src/tools/
     src/wallet/ src/signing/` should be empty inside this codebase (the only
     legitimate consumer of the `.address` alias is now retained for back-
     compat at the type level — no live read sites).

6. **Tests in `test/wallet-session-manager.test.ts`,
   `test/set-active-account.test.ts` (new), and one prepare-side assertion.**
   - `wallet-session-manager.test.ts`: extend an existing helper or add a
     `buildMultiAccountSession` fixture (three `eip155:1:0x…` accounts).
     Assert (a) parsed `accounts` has all three, in order; (b)
     `activeAccount === accounts[0]` by default; (c) `setActiveAccount`
     happy path swaps the active address and persists across a subsequent
     `getStatus()` for the same topic; (d) `setActiveAccount` with an
     unknown address throws `AccountNotInSessionError`; (e)
     `_resetSessionManagerForTesting` clears `activeAccountByTopic`.
   - `test/set-active-account.test.ts` (new — pattern-match
     `test/set-demo-wallet.test.ts` for harness setup): happy path returns
     `{ address, accounts }`; demo-mode call returns `WRONG_MODE`;
     unknown-address call returns `INVALID_ACCOUNT` with the in-session list
     surfaced in the error message; malformed `address` returns
     `INVALID_INPUT`.
   - `test/prepare-native-send.test.ts`: one new case — after
     `setActiveAccount` switches to a non-first address in a 3-account
     session, `prepare_native_send` returns that address as `from` in
     `structuredContent`. Pattern-match the existing Fixture A test for
     mock-session shape (use the same multi-account fixture from task 1).
   - `test/pair-ledger-live-wait.test.ts`: one new case asserting the
     response surfaces all approved accounts on `structuredContent.accounts`
     while the VERIFY-ON-DEVICE block contains the active address ONLY (no
     other addresses leak into the device-verification block).

# Acceptance criteria

Each fix-scope item from the prompt → at least one test assertion or grep
gate above:

- Multi-account session parse stores all addresses + correct active default
  → task 6 / session-manager test (a) + (b).
- `pair_ledger_live_wait` exposes `accounts` → task 6 /
  pair-ledger-live-wait test.
- `get_ledger_status` + `get_ledger_device_info` expose `accounts` → manual
  read-through of structuredContent in task 5; covered by existing
  `get-ledger-status.test.ts` + `get-ledger-device-info.test.ts` shape
  assertions (which will need one field added each — fold into task 6 if
  vitest flags missing-key assertions).
- `set_active_account` happy path / invalid-account / wrong-mode / invalid-
  input → task 6 / set-active-account test.
- `prepare_*` consults `activeAccount` → task 6 / prepare-native-send test +
  task 5 grep gate (`status.address` removed from `src/tools/` and
  `src/signing/`).
- VERIFY-ON-DEVICE block lists active address only, not whole array →
  task 6 / pair-ledger-live-wait test.

`npm test` green; `tsc --noEmit` clean. No new modules outside the files
named above.

# Files to touch

- `src/wallet/session-manager.ts`
- `src/signing/error-codes.ts`
- `src/tools/set_active_account.ts` (new)
- `src/tools/register-all.ts`
- `src/tools/pair_ledger_live_wait.ts`
- `src/tools/get_ledger_status.ts`
- `src/tools/get_ledger_device_info.ts`
- `src/tools/prepare_native_send.ts`
- `src/tools/preview_send.ts`
- `src/tools/send_transaction.ts`
- `test/wallet-session-manager.test.ts`
- `test/set-active-account.test.ts` (new)
- `test/prepare-native-send.test.ts`
- `test/pair-ledger-live-wait.test.ts`
- `test/get-ledger-status.test.ts` (only if existing shape assertions need
  the new field — add minimally, do not rewrite)
- `test/get-ledger-device-info.test.ts` (same — only if needed)

# Out of scope

- No address-book / labels / per-account nicknames.
- No persistence of `activeAccount` across restarts — in-memory only,
  cleared on `session_delete` + `_resetSessionManagerForTesting`.
- No event emission on account-change.
- No backwards-compat shims for old callers — every internal
  `status.address` read in `src/tools/` and `src/signing/` migrates to
  `status.activeAccount` in this PR.
- No re-pair-on-account-change.
- No new device-side verification step for `set_active_account` — the
  Ledger screen at signing time remains the trust anchor.
