# Phase 44: Solana Durable-Nonce Setup Tools — RESEARCH

All instruction-layout, account-metas, signer-requirement, and rent facts below
were verified **empirically against the pinned SDK** `@solana/web3.js@1.98.4`
(probe-installed to `/tmp/sol-probe`, inspected via `lib/index.d.ts` and a Node
runtime probe). Per rnd discipline, SDK source > docs; web docs were used only
to corroborate the *authority semantics* narrative.

## Sources + confidence

| Claim | Source | Confidence |
|-------|--------|------------|
| `NONCE_ACCOUNT_LENGTH === 80` (bytes) | `@solana/web3.js@1.98.4` runtime probe | High |
| Rent-exempt min for 80-byte acct ≈ 1,447,680 lamports (~0.00144768 SOL) at default rent | Computed `(80+128)*3480*2`; resolve at runtime via `getMinimumBalanceForRentExemption(80)` | High (formula); resolve live for exactness |
| `InitializeNonceParams = { noncePubkey, authorizedPubkey }` | `index.d.ts` line ~1923 | High |
| `WithdrawNonceParams = { noncePubkey, authorizedPubkey, toPubkey, lamports }` | `index.d.ts` | High |
| `AuthorizeNonceParams = { noncePubkey, authorizedPubkey, newAuthorizedPubkey }` | `index.d.ts` | High |
| `CreateNonceAccountParams = { fromPubkey, noncePubkey, authorizedPubkey, lamports }` | `index.d.ts` | High |
| `nonceInitialize` accounts: nonce(writable), RecentBlockhashes sysvar, Rent sysvar; authority encoded in **data** (init does NOT require authority signature) | runtime ix-metas probe | High |
| `nonceWithdraw` accounts: nonce(writable), to(writable), RecentBlockhashes sysvar, Rent sysvar, **authority(signer)** | runtime ix-metas probe | High |
| `NonceAccount.fromAccountData(buffer)` → `{ authorizedPubkey, nonce, feeCalculator }` | `index.d.ts` class decl | High |
| `Connection.getMinimumBalanceForRentExemption(size)` exists | runtime probe | High |
| System Program ID `11111111111111111111111111111111` | runtime probe (matches `SYSTEM_PROGRAM_ID` already pinned in `solana-system.ts`) | High |
| Closing a durable nonce = withdrawing its **full** lamport balance | Solana durable-nonce model (web docs corroborate; SDK has no separate "close") | High |

## Instruction layout

### nonce_init (two instructions in one transaction)

1. `SystemProgram.createAccount({ fromPubkey, newAccountPubkey: noncePubkey,
   lamports: rentExemptMin, space: NONCE_ACCOUNT_LENGTH (80), programId: SystemProgram.programId })`
   — funds the nonce account to rent-exempt and assigns it to the System Program.
2. `SystemProgram.nonceInitialize({ noncePubkey, authorizedPubkey })`
   — writes the durable nonce + sets the authority (encoded in instruction data).
   Accounts: `nonce(writable)`, `SysvarRecentBlockhashes`, `SysvarRent`.

`web3.js` ships a convenience `SystemProgram.createNonceAccount(params): Transaction`
that bundles exactly these two instructions. **Decision (plan):** build the two
instructions explicitly via our own `solana-system.ts` encoder boundary rather
than call `createNonceAccount` — same convention as `buildSystemTransferInstruction`
(tool code never imports web3.js builders directly; the encoder boundary is the
single validation + program-id-pin point).

**Signers required for nonce_init:** `fromPubkey` (fee payer + funder) and
`noncePubkey` (the new account must sign its own creation in `createAccount`).
`authorizedPubkey` is NOT a signer at init. Under the locked authority model
`fromPubkey === authorizedPubkey === persona.address`; `noncePubkey` is the new
nonce account's own key.

### nonce_close (single instruction = full withdraw)

`SystemProgram.nonceWithdraw({ noncePubkey, authorizedPubkey, toPubkey,
lamports: <full balance> })`.
Accounts: `nonce(writable)`, `to(writable)`, `SysvarRecentBlockhashes`,
`SysvarRent`, `authority(signer)`. Withdrawing the entire balance drops the
account below rent-exempt → the runtime garbage-collects it → account closed.
`lamports` = the account's current lamport balance (read via `getAccountInfo`).

## Account creation: where does the nonce pubkey come from?

A durable-nonce account is a fresh keypair, distinct from the wallet. `createAccount`
requires the new account to **sign**. Two viable models:

- **Model 1 (locked for this phase): deterministic per-persona nonce key supplied
  to the tool.** The tool accepts a `noncePubkey` (base58) the caller derived/holds,
  OR derives it deterministically. Because the nonce account must sign its own
  creation, in the demo/simulation envelope the persona registry carries a paired
  nonce keypair fixture; in production the device/user flow provides the signature.
  This codebase only assembles the **unsigned** message — consistent with "no
  keypair in this codebase." The PLAN treats `noncePubkey` as a tool input
  (base58), resolved/validated like `to`.
- **Model 2 (deferred): seed-derived via `createNonceAccountWithSeed`.** Avoids a
  second signer (the nonce account is a PDA-like seed account off the wallet base).
  Cleaner UX but a different instruction surface; out of scope (see CONTEXT).

> Open item for the human reviewer: Model 1 surfaces `noncePubkey` as a tool arg.
> If the preferred UX is "server derives it," that is a one-arg simplification at
> execute time, not an architectural change — the message bytes and fingerprint
> are identical either way. Flagged in the PLAN must-haves.

## Authority model (corroborates CONTEXT design fork)

- The nonce **authority** is the sole key allowed to `nonceAdvance` and
  `nonceWithdraw`. Set once at `nonceInitialize` (in instruction data); changeable
  only via `nonceAuthorize` (out of scope here).
- Locked: authority = paired wallet (`persona.address`). See 44-CONTEXT §Design Fork.
- Close proves authority two ways: (1) off-chain fail-fast — fetch account,
  `NonceAccount.fromAccountData(...).authorizedPubkey` must equal `persona.address`,
  else `VP_S005`; (2) on-chain — the withdraw instruction lists the authority as a
  required signer, so the Ledger must sign as that authority. (1) is UX; (2) is the
  security guarantee.

## Rent / sizing

- `NONCE_ACCOUNT_LENGTH = 80` bytes (verified).
- Rent-exempt minimum at Solana default rent params:
  `(account_size + ACCOUNT_STORAGE_OVERHEAD) * lamports_per_byte_year * exemption_years`
  `= (80 + 128) * 3480 * 2 = 1,447,680 lamports ≈ 0.00144768 SOL`.
- **Do NOT hardcode the lamports literal in tool code.** Resolve at prepare time
  via `solanaRpc.getMinimumBalanceForRentExemption(NONCE_ACCOUNT_LENGTH)` — rent
  params are a cluster setting and could drift. The computed value above is the
  expected-value anchor for tests only.

## Pitfalls

- **Hardcoding rent** — resolve live; the literal is a test anchor, not prod code.
- **Authority confusion** — never accept a caller authority param; always
  `persona.address`. A caller-set authority creates an unreclaimable account.
- **Partial withdraw leaving a dust account** — close MUST withdraw the *full*
  current balance (read via `getAccountInfo`), else the account survives below
  rent and is GC-ambiguous. Use the live balance, not a passed-in amount.
- **Closing a non-nonce or non-owned account** — `getAccountInfo` may return null
  (account absent) or an account whose `owner !== SystemProgram` / whose
  `authorizedPubkey !== persona`. All three → `VP_S005` refusal, no handle.
- **Off-by-decimal** — n/a for rent (lamports are integers), but the displayed SOL
  value in the receipt must use the 9-decimal SOL conversion already in the native
  tool. Reuse, don't reinvent.
- **Program-id swap** — keep routing through `solana-system.ts`, which pins
  `SYSTEM_PROGRAM_ID`; assert the built instruction's `programId` matches.

## Validation Architecture

- **Measure of success:** a tampered byte anywhere in a nonce-init or nonce-close
  message flips its pinned fingerprint at a specific assertion line. Falsifier: if
  fixtures M/N pass against a self-snapshotted value, the regression is hollow —
  so M/N are hardcoded `0x...` literals, NO `beforeAll` snapshot (same rule as K/L).
- **Fixtures (new):**
  - **M** — nonce_init message baseline (createAccount + nonceInitialize, authority
    = fee payer) → pinned `0x...` literal in `test/signing-fingerprint-solana.test.ts`.
  - **N** — nonce_close message baseline (nonceWithdraw, full balance) → pinned `0x...`.
  - Cross-link M/N from `prepare-solana-nonce-init.test.ts` /
    `prepare-solana-nonce-close.test.ts` by letter.
- **Persona-swap byte-identity:** init/close built for persona alice vs bob with
  identical nonce params produce fingerprints that differ ONLY because the embedded
  addresses differ — re-anchor that the *function* doesn't branch on persona
  (same `from`-independence invariant proven for K/L).
- **Authority-mismatch test:** stub `getAccountInfo` to return a nonce account whose
  `authorizedPubkey` ≠ persona → `prepare_solana_nonce_close` raises `VP_S005`,
  mints NO handle. Stub a matching authority → builds the handle.
- **FROZEN zero-diff gate:** a test (or CI check) asserts `git diff` of
  `payload-fingerprint-solana.ts` + `presign-hash-solana.ts` vs `main` is empty.
- **Layer 0.7:** nonce-init/close transactions run through the existing
  `simulateTransaction` gate in `preview_solana_send`; a failing sim → `VP_S004`
  (unchanged path; no new preview tool needed — nonce handles preview through the
  same gate).
