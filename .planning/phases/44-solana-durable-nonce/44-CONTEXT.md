# Phase 44: Solana Durable-Nonce Setup Tools — CONTEXT

**Milestone:** v2.x — Solana UX extension
**Status:** planned
**Wave:** sequential after Phase 12 (Solana trust pipeline); independent of in-flight Phase 43
**Promoted from:** Deferred Backlog DB-3 (recorded in Phase 12 / 12-04, plan-check FLAG-2)

## Phase Boundary

What this phase delivers, and explicitly what it does not.

### In scope

- `prepare_solana_nonce_init` — build an unsigned transaction that creates a
  per-wallet durable-nonce account (SystemProgram.createAccount, funded to the
  rent-exempt minimum for an 80-byte account) and initializes it
  (SystemProgram.nonceInitialize) with the **paired wallet as authority**.
- `prepare_solana_nonce_close` — build an unsigned transaction that withdraws
  the full lamport balance from the nonce account (SystemProgram.nonceWithdraw),
  which closes it. Proves withdrawal authority by reading on-chain account data
  and asserting the stored authority matches the paired wallet.
- One additive RPC method: `getMinimumBalanceForRentExemption` (read-only).
- Two additive `HandleKind` union members: `solana_nonce_init`,
  `solana_nonce_close` (the documented additive change FROZEN handle-store permits).
- One new structured-refusal code: `VP_S005` (nonce-authority mismatch).
- Pinned fingerprint fixtures M (nonce_init) and N (nonce_close), following the
  K/L convention; persona-swap byte-identity re-anchor.

### Out of scope (deferred / not planned)

- Advancing a nonce / using a durable nonce as the recent-blockhash slot in a
  *send* transaction. This phase only sets up and tears down nonce accounts; the
  existing `prepare_solana_*_send` tools keep using a recent blockhash. Wiring a
  nonce into a send is a follow-on once users have created accounts.
- `nonceAuthorize` (transferring authority to a different key). Not needed under
  the locked authority model (authority is always the paired wallet); would
  reintroduce the foreign-authority hazard this phase rejects.
- Createaccount-with-seed (`createNonceAccountWithSeed`). Plain keypair-derived
  nonce account only; seed-derived is a later optimization.
- Multisig / Squads authority. Not planned.

## The Design Fork (resolved) — NonceAuthorized account-ownership semantics

A durable-nonce account has a **nonce authority**: the only key that can advance
or withdraw it. The fork was how to scope that authority across VaultPilot's
multi-wallet, self-custodial, no-key-material model. Resolution:

### (a) Is the authority always the paired wallet, or can it differ?

**Locked: authority is ALWAYS the paired wallet** (the `fromPersona`'s address).
- Rationale: VaultPilot's trust anchor is the Ledger screen; only the paired
  device can produce a signature. A nonce whose authority is any *other* key
  would be unusable by the user (the device cannot advance/withdraw it) and would
  let the agent install an authority the user does not control — a self-custody
  break. The authority MUST be a key the paired device holds.
- Alternatives (surfaced for reviewer ratification):
  - **(B) caller-specified authority param.** Rejected: lets a compromised agent
    set a foreign authority, defeating self-custody. The device would still
    refuse to sign a withdraw it isn't authority for, but init would silently
    create an account the user can never reclaim rent from.
  - **(C) a separate VaultPilot-managed authority key.** Rejected outright:
    introduces private-key material into this codebase — forbidden by CLAUDE.md.

### (b) How does `prepare_solana_nonce_close` prove withdrawal authority?

**Locked: read-on-chain-then-assert, plus device-enforced signer.**
- Close fetches the nonce account via `solanaRpc.getAccountInfo`, parses it with
  `NonceAccount.fromAccountData`, and asserts `account.authorizedPubkey` equals
  the resolved persona address. Mismatch → refuse with `VP_S005` (no handle minted).
- Defense in depth: `SystemProgram.nonceWithdraw` requires `authorizedPubkey` as a
  **transaction signer**, so even if the off-chain check were bypassed, the Ledger
  device would have to sign as the authority — which it can only do for its own
  paired key. The off-chain check is a fail-fast UX guard; the on-device signer
  requirement is the security guarantee.

### (c) Multi-wallet: how is authority scoped per account?

**Locked: per-persona.** Both tools take `fromPersona`; the authority is exactly
that persona's address. Each paired Solana wallet owns its own nonce account(s).
Close requires the persona whose address matches the on-chain stored authority —
no cross-persona close.

### (d) Does this touch the FROZEN Solana cryptographic-binding chain?

**Locked: ZERO-DIFF. It MUST NOT, and it does not need to.**
- `payload-fingerprint-solana.ts` and `presign-hash-solana.ts` are NOT modified.
  Nonce-init and nonce-close transactions serialize to message bytes and flow
  through the **unchanged** `computePayloadFingerprintSolana` — the FROZEN
  function explicitly states "DO NOT add nonce/authority-specific branches here.
  New transaction shapes flow through the same serialize→sha256 path."
- `handle-store.ts` is FROZEN but its header documents "Adding a new kind is
  additive." Adding `solana_nonce_init` / `solana_nonce_close` to the
  `HandleKind` union is that permitted additive change; no existing kind payload
  shape or re-check logic is altered. `registerSolanaHandle` already accepts
  `Extract<HandleKind, \`solana_${string}\`>`, so the new kinds work unchanged.
- Acceptance gate: a `git diff` of `payload-fingerprint-solana.ts` and
  `presign-hash-solana.ts` against `main` MUST be empty.

## Locked Decisions (summary)

1. **Authority = paired wallet, always.** No caller param, no managed key.
2. **Close = full withdraw**, gated by on-chain-authority assertion (`VP_S005`)
   AND the device-enforced authority signer.
3. **Per-persona scoping.** Each persona owns its nonce accounts.
4. **Rent-exempt minimum funded at init** for an 80-byte account
   (`NONCE_ACCOUNT_LENGTH = 80`; resolved at runtime via
   `getMinimumBalanceForRentExemption`, ~1,447,680 lamports at default rent).
5. **FROZEN chain zero-diff.** Fingerprint/presign unchanged; `HandleKind`
   additive; new code `VP_S005` only.
6. **No keypair in this codebase.** The nonce account's keypair is generated by
   the device-side / user flow; this codebase only builds the unsigned message.
   (See RESEARCH §Account creation for how the nonce pubkey reaches the tool.)

## Trust Pipeline Shape (inherited, unchanged)

Layer 0 — schema validation (zod)
Layer 0.5 — persona/address resolution
Layer 0.7 — simulateTransaction (catch failing txns pre-preview)
Layer 1 — payloadFingerprint bound at prepare, re-checked at send
Layer 2 — presignHash (on-device display anchor)
Layer 3 — user approves on Ledger screen (the only trusted display)

Nonce-init / nonce-close ride the exact same six layers. The only nonce-specific
addition is a pre-build authority assertion in `prepare_solana_nonce_close`
(before Layer 1), surfaced as `VP_S005`.

## Key Files

Modified (additive only):
- `src/protocols/solana-system.ts` — add `buildNonceInitializeInstruction`,
  `buildNonceWithdrawInstruction`, `buildCreateNonceAccountInstruction` encoders.
- `src/chains/solana-rpc.ts` — add `getMinimumBalanceForRentExemption` (read-only).
- `src/signing/handle-store.ts` — add two `HandleKind` members (additive).
- `src/signing/error-codes.ts` — add `SOLANA_NONCE_AUTHORITY_MISMATCH: "VP_S005"`.
- `src/tools/register-all.ts` — register the two new tools.

New:
- `src/tools/prepare_solana_nonce_init.ts`
- `src/tools/prepare_solana_nonce_close.ts`
- `test/signing-fingerprint-solana.test.ts` — add fixtures M / N (or sibling file).
- `test/prepare-solana-nonce-init.test.ts`
- `test/prepare-solana-nonce-close.test.ts`

FROZEN — assert zero-diff (NOT modified):
- `src/signing/payload-fingerprint-solana.ts`
- `src/signing/presign-hash-solana.ts`

## Residual Risk

- A user who loses access to the paired wallet cannot reclaim the rent locked in
  the nonce account (authority is the lost key). This is inherent to durable
  nonces and the self-custody model, not a VaultPilot defect — documented UX note.
- This phase creates/closes nonce accounts but does not yet *use* them in sends.
  The ~150-slot blockhash window still bounds normal sends until the follow-on
  lands. Durable nonce remains a UX extension orthogonal to the v2.0 ship gate.
