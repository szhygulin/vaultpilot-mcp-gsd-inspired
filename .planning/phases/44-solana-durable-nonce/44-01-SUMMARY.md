---
phase: 44
plan: 01
subsystem: protocols/solana
tags: [solana, durable-nonce, nonce-init, nonce-close, system-program, authority-gate, esm-spy-affordance, cryptographic-binding-fixtures]
requires: [solana-trust-pipeline, payload-fingerprint-solana, register-solana-handle, preview_solana_send]
provides: [solana-nonce-init, solana-nonce-close, solana-nonce-encoders, solana-nonce-fingerprints]
affects:
  - src/protocols/solana-system.ts
  - src/chains/solana/sol-rpc-client.ts
  - src/signing/blocks-solana.ts
  - src/tools/prepare_solana_nonce_init.ts
  - src/tools/prepare_solana_nonce_close.ts
  - src/tools/register-all.ts
tech-stack:
  added: []
  patterns: [ESM-spy-affordance, cryptographic-binding-fixtures, authority-gate-refusal, programId-swap-assert, live-rent-resolution]
key-files:
  created:
    - src/tools/prepare_solana_nonce_init.ts
    - src/tools/prepare_solana_nonce_close.ts
    - test/prepare-solana-nonce-init.test.ts
    - test/prepare-solana-nonce-close.test.ts
    - .planning/phases/44-solana-durable-nonce/44-01-SUMMARY.md
  modified:
    - src/protocols/solana-system.ts
    - src/chains/solana/sol-rpc-client.ts
    - src/signing/blocks-solana.ts
    - src/tools/register-all.ts
    - test/signing-fingerprint-solana.test.ts
decisions:
  - D-01: Authority = paired wallet ALWAYS (CONTEXT fork (a)); no caller authority param exists, on either tool
  - D-02: Close = full on-chain-balance withdraw, authority-gated; mismatch/null/wrong-owner/parse-throw → VP_S005, no handle minted
  - D-03: noncePubkey is a tool input (Model 1, base58); init refuses noncePubkey == wallet address (self-collision) with INVALID_INPUT
  - D-04: VP_S005 is a LOCAL constant surfaced in `solanaErrorCode` — no SOLANA_ERROR_CODES registry exists in this codebase (reconciled to ground truth, see Deviations)
  - D-05: Rent resolved live via getMinimumBalanceForRentExemption(80); literal 1,447,680 is a test anchor only, never inlined in prod
  - D-06: Fixtures M (nonce_init) + N (nonce_close) pinned as hardcoded literals; no beforeAll-snapshot
  - D-07: FROZEN computeSolanaPayloadFingerprint / presign-hash-solana zero-diff; HandleKind additive; programId pinned to SYSTEM_PROGRAM_ID
requirements-completed: [R-SOL-09, R-SOL-10]
metrics:
  duration: "phase build (prior executor) + import/account-read fix + consumer-test remediation"
  completed: "2026-06-01"
---

# Phase 44 Plan 01: Solana durable-nonce setup tools (init + close) Summary

Adds two `prepare_*` tools for per-wallet Solana durable-nonce accounts: `prepare_solana_nonce_init` (SystemProgram.createAccount + nonceInitialize, authority = paired wallet, funded to the rent-exempt minimum) and `prepare_solana_nonce_close` (SystemProgram.nonceWithdraw of the full on-chain balance, authority-gated). Both mirror the existing `prepare_solana_*_send` shape — opaque handle, PREPARE RECEIPT, `payloadFingerprint` via the FROZEN `computeSolanaPayloadFingerprint`. The FROZEN Solana cryptographic-binding chain is byte-identical to `origin/main`; the only handle-store change is the additive `HandleKind` extension the FROZEN header permits.

## Tasks Completed

Shipped as PR #173, squash commit `8f9219f`. The PR carried the seven plan tasks across multiple sub-commits plus two corrective commits (an import/account-read fix and the consumer-test pass — see Deviations).

| Task | Name | Where |
| ---- | ---- | ----- |
| 44-01-1 | System Program nonce encoders + `buildNonceInitTx` / `buildNonceCloseTx` + `_solanaSystem` indirection | `src/protocols/solana-system.ts` |
| 44-01-2 | read-only `getMinimumBalanceForRentExemption` RPC method | `src/chains/solana/sol-rpc-client.ts` |
| 44-01-3 | additive `HandleKind` members + VP_S005 (reconciled — see D-04) | `src/signing/handle-store.ts` / local constant |
| 44-01-4 | `prepare_solana_nonce_init` tool | `src/tools/prepare_solana_nonce_init.ts` |
| 44-01-5 | `prepare_solana_nonce_close` tool (authority-gated) | `src/tools/prepare_solana_nonce_close.ts` |
| 44-01-6 | register both tools (additive side-effect imports) | `src/tools/register-all.ts` |
| 44-01-7 | PREPARE RECEIPT templates + pinned fixtures M/N + FROZEN zero-diff gate + consumer tests | `src/signing/blocks-solana.ts`, `test/*` |

## What Was Built

- **`src/protocols/solana-system.ts`** (+196): `buildCreateNonceAccountInstruction`, `buildNonceInitializeInstruction`, `buildNonceWithdrawInstruction` — thin wrappers over the web3.js `SystemProgram` builders, each asserting `programId === SYSTEM_PROGRAM_ID` (program-id-swap defence), no keypair material. `buildNonceInitTx` / `buildNonceCloseTx` assemble the legacy-tx message bytes. `NONCE_ACCOUNT_LENGTH` (= 80) re-exported from web3.js. All wired into the `_solanaSystem` ESM spy-affordance indirection (CLAUDE.md mandate). The stale "nonce* instructions deferred (DB-3)" comment removed.
- **`src/chains/solana/sol-rpc-client.ts`** (+19): `getMinimumBalanceForRentExemption(size)` wrapping `Connection.getMinimumBalanceForRentExemption`; read-only, no signing surface, rethrows as `SolanaRpcError`.
- **`src/signing/blocks-solana.ts`** (+50): `PREPARE_RECEIPT_SOLANA_NONCE_INIT_TEMPLATE` (echoes `fromPersona` / `noncePubkey` verbatim + server-derived authority + rent lamports) and `PREPARE_RECEIPT_SOLANA_NONCE_CLOSE_TEMPLATE` (echoes args + destination + full-balance withdraw). Templates live once here (format-fanout sentinel).
- **`src/tools/prepare_solana_nonce_init.ts`** (+374): authority = `persona.address` always (no caller authority param); `noncePubkey` is a base58 tool input (Model 1) echoed verbatim; rent resolved live; refuses `noncePubkey === wallet address` (self-collision → INVALID_INPUT, no handle); fingerprint via FROZEN `computeSolanaPayloadFingerprint`; registers handle kind `solana_nonce_init`.
- **`src/tools/prepare_solana_nonce_close.ts`** (+412): authority gate (`getAccountInfo` → `NonceAccount.fromAccountData`) refuses with **VP_S005, NO handle minted** on account-absent / wrong-owner / parse-throw / authority-mismatch; withdraw = full on-chain balance (not a caller param); destination = `persona.address` (rent returns to the wallet); registers handle kind `solana_nonce_close`.
- **`src/tools/register-all.ts`** (+2): additive side-effect imports of both tools under the Solana section; no existing registration altered.
- **Fixtures (`test/signing-fingerprint-solana.test.ts`, +164):** **M** (nonce_init message baseline, `0xf23e8e0041a47c94894797b2430b3814a3416670404e16da779564f435ecd809`, message length 296) and **N** (nonce_close message baseline, `0x4cb389760626e559c85fca6d9f3d14c4408871fd034c73f1a82fe4d797f8dea2`, message length 217) — hardcoded `0x...` literals, NO `beforeAll` snapshot. Fixture M carries an authority-swap regression (authority IS in the preimage); Fixture N an amount-swap regression (the lamport amount IS in the preimage). Cross-linked from the two consumer tests by letter.

## Authority Gate (close tool) — the load-bearing security property

`prepare_solana_nonce_close` reads the on-chain nonce account via `connection.getAccountInfo`, parses it with `NonceAccount.fromAccountData`, and refuses with **VP_S005 (no handle minted)** if ANY of:

1. the account is `null` (absent),
2. its `owner !== SystemProgram`,
3. `NonceAccount.fromAccountData` throws (System-owned but not a valid nonce account),
4. the parsed `authorizedPubkey !== persona.address` (cross-persona close blocked).

This is the off-chain fail-fast guard. The on-device guarantee is independent: `nonceWithdraw` lists the authority as a required transaction signer, so the Ledger can only sign for its own paired key. `prepare_solana_nonce_init` carries the symmetric self-collision refusal — `noncePubkey === wallet address` → INVALID_INPUT, no handle (a nonce account cannot be the wallet itself).

## FROZEN Invariants — all held

All eight security/FROZEN invariants from the CONTEXT design fork held:

1. **Authority = paired wallet** for both tools; no caller authority param exists anywhere.
2. **Close = full on-chain-balance withdraw**, authority-gated (VP_S005) + device-enforced authority signer.
3. **Per-persona scoping** — cross-persona close blocked by the on-chain authority assertion.
4. **Rent resolved live** (`getMinimumBalanceForRentExemption(80)`); the 1,447,680-lamport literal is a test anchor only.
5. **`computeSolanaPayloadFingerprint` / `presign-hash-solana.ts` zero-diff** vs `origin/main` — asserted by a git-diff-empty gate (`test/signing-fingerprint-solana.test.ts`, "FROZEN Solana cryptographic-binding chain — zero-diff vs origin/main").
6. **`HandleKind` additive only** — two new kinds (`solana_nonce_init`, `solana_nonce_close`); no existing kind payload shape or re-check logic altered.
7. **`programId === SYSTEM_PROGRAM_ID`** asserted in every encoder (program-id-swap defence).
8. **No private-key material** in this codebase — the nonce account's keypair is device/user-side; this code assembles the unsigned message only.

Fixtures M/N are the cryptographic-binding anchors: a tampered message byte flips the pinned fingerprint at a specific assertion line (no self-snapshot).

## Deviations from Plan

### 1. [Rule 3 - Blocking] VP_S005 wired as a local constant, not a `SOLANA_ERROR_CODES` registry — reconciled to ground truth

- **Found during:** test load — the committed `prepare_solana_nonce_close.ts` imported a nonexistent `../signing/error-codes-solana.js` module and a nonexistent `getAccountInfo` export from `sol-rpc-client.ts`, which broke module load for every test transitively importing `register-all.ts`.
- **Root cause:** Plan task 44-01-3 assumed a `SOLANA_ERROR_CODES` registry in `error-codes.ts` to extend with `VP_S005`. No such registry exists in this codebase (the plan was written against an assumed structure, not the code).
- **Fix:** dropped the `error-codes-solana.js` import; `VP_S005` (`SOLANA_NONCE_AUTHORITY_MISMATCH`) is a local `as const` constant surfaced in the refusal envelope's `solanaErrorCode` field, with `INVALID_INPUT` carried in `errorCode` (same dual-field shape used elsewhere in the Solana tools). Read on-chain account info via `connection.getAccountInfo` directly (same pattern as `solana-spl.ts`), letting the SDK return type flow through. Typecheck clean; the 178 Solana tests passed.

### 2. Consumer tests added in a remediation commit

The per-tool consumer tests (`test/prepare-solana-nonce-init.test.ts`, 14 tests; `test/prepare-solana-nonce-close.test.ts`, 18 tests) were authored/landed in the final commit of the PR — the authority gate, the init self-collision refusal, the RPC-failure no-handle property, and the Fixture M/N cross-links. They prove: handle + receipt + authority = persona; persona-swap fingerprint byte-identity (the function does not branch on persona); full-balance close on authority match; VP_S005 + no handle on every refusal branch; INVALID_INPUT + no handle on self-collision and non-base58 input.

## Validation Result

- `prepare-solana-nonce-init.test.ts`: **14 tests** (handle/receipt shape, demo-persona success, Fixture-M byte-identity, `_solanaSystem` indirection, self-collision refusal, rent/blockhash RPC-failure refusals, pairing/mode/base58 guards, record shape, blockhash pinning, registration).
- `prepare-solana-nonce-close.test.ts`: **18 tests** (handle/receipt shape, balance-tracking withdraw, demo-persona success, Fixture-N byte-identity, `_solanaSystem` indirection, four VP_S005 refusal branches, two BROADCAST_FAILED refusals, pairing/mode/base58 guards, record shape, blockhash pinning, full-balance/authority binding, registration).
- `signing-fingerprint-solana.test.ts`: Fixtures M/N + the two embedding regressions + the FROZEN zero-diff gate.

## FROZEN Zero-Diff Gate

`git diff origin/main -- src/signing/payload-fingerprint-solana.ts src/signing/presign-hash-solana.ts` → **EMPTY**. Asserted in-suite by the "FROZEN Solana cryptographic-binding chain — zero-diff vs origin/main" describe block (skips gracefully when `origin/main` is not fetched in CI; the worktree-level FROZEN gate covers that case).

## Self-Check: PASSED

- Squash commit `8f9219f` present on `main` (`feat(44): Solana durable-nonce setup tools (init + close) (#173)`).
- Both tools registered; `prepare_solana_nonce_init` / `prepare_solana_nonce_close` exposed.
- VP_S005 authority gate on the close tool; init self-collision refusal — both mint no handle.
- Fixtures M/N pinned as hardcoded literals; FROZEN fingerprint/presign chain zero-diff.
- DB-3 (durable-nonce backlog) promoted and shipped.

---
*Phase: 44-solana-durable-nonce*
*Completed: 2026-06-01*
