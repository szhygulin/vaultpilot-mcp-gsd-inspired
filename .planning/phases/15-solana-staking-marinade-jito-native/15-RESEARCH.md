# Phase 15: Staking — Marinade + Jito + native SOL — Research

**Researched:** 2026-06-04
**Domain:** Solana staking — native Stake Program lifecycle + Marinade liquid staking (mSOL) + Jito SPL stake pool (jitoSOL)
**Confidence:** HIGH (all three surfaces probed via installed `.d.ts` / IDL; addresses + program IDs verified from SDK default config + Jito docs; Ledger coverage cited from Ledger developer docs)

## Summary

Three staking surfaces, three distinct dependency verdicts, and a **single, conservative Ledger clear-sign answer that applies to all of them**.

1. **Native SOL (SOL-W-17/18/19/20) — ZERO new dependency.** `@solana/web3.js` v1.98.4 (already installed) ships a built-in `StakeProgram` class with `createAccount` / `initialize` / `delegate` / `deactivate` / `withdraw`. Verified in `node_modules/@solana/web3.js/lib/index.d.ts` lines 835–898. Caveat: `createAccount`, `delegate`, `deactivate`, `withdraw` return a multi-instruction `web3.Transaction` (not a bare `TransactionInstruction`), and the param types take `lamports: number` (JS-number, not bigint) — both handled at assembly time (extract `.instructions`, re-bundle through the standard legacy-tx assembler; convert decimal-string lamports through a `Number()` guard against the 2^53 ceiling, which SOL amounts never approach in practice).

2. **Marinade (SOL-W-14/15) — NO new runtime dependency; HAND-ENCODE from the vendored IDL (D-01 path, mirrors Phase 13 MarginFi).** `@marinade.finance/marinade-ts-sdk` v5.0.18 IS a legitimate package, but its `deposit()` / `liquidUnstake()` are async, Anchor-`Program`-coupled, RPC-bound builders that return a fully-assembled `web3.Transaction`. The SDK pulls `@coral-xyz/anchor ^0.28.0` + `@solana/spl-stake-pool` + a native-staking sub-SDK — a heavy runtime graph we do NOT want. Marinade uses **standard Anchor discriminators** (`sha256("global:<ix>")[..8]`), so we hand-encode exactly as MarginFi does: vendor the `marinade_finance` IDL JSON, build a `BorshInstructionCoder`, emit `deposit(lamports: u64)` (11 accounts) and `liquid_unstake(msolAmount: u64)` (10 accounts). Verified discriminators: `deposit` = `[242,35,198,137,82,225,242,182]`, `liquid_unstake` = `[30,30,119,240,191,227,12,16]`.

3. **Jito SPL stake pool (SOL-W-16) — NO new runtime dependency; HAND-ENCODE the `DepositSol` instruction (mirrors Phase 13 Kamino primitive-borsh path).** Jito is the **SPL Stake Pool program** (`SPoo1Ku8WFXoNDMHPsrGSTSG1Y47rzgn41SLUNakuHy`). `@solana/spl-stake-pool` v1.1.8 exposes a **pure, synchronous, connection-free, no-signer** low-level builder `StakePoolInstruction.depositSol(params): TransactionInstruction` (verified `dist/instructions.d.ts:246`) — this is the encoding SOT we reproduce. The high-level `depositSol(connection, …)` is RPC-bound and returns `signers: Signer[]`; we do NOT use it. The SPL Stake Pool program uses a `buffer-layout`-style enum tag (NOT Anchor discriminators) — `DepositSol` is instruction-variant index 14 — so this follows Kamino's pinned-discriminator + primitive-borsh template, not MarginFi's Anchor coder.

**Supply-chain summary:** With the hand-encode recommendation, **zero new runtime dependencies** are required. The two SDK packages are installed **as build-time IDL/layout reference only** (or vendored — copy the IDL JSON + pin the layout literals into the repo) and are NOT added to `dependencies`. If the planner instead chooses adopt-SDK for either, that package becomes a runtime install requiring a `checkpoint:human-verify` supply-chain gate (both packages are legitimate — see Package Legitimacy Audit — but the project's D-01 convention and the no-RPC/no-ephemeral-signer constraints make hand-encode strictly better here).

**Ledger clear-sign finding (success criterion #6):** The Ledger Solana app clear-signs **only** "simple instructions like a single `transfer` or combos like `createAccount + fundAccount` or `createAccount + transfer`" [CITED: developers.ledger.com/docs/device-interaction/references/signers/solana]. Stake Program delegate/deactivate/withdraw are NOT in the documented clear-sign set, and Marinade/Jito CPI deposits certainly are not — unsupported instructions return device error `6808` and require blind signing. **Conservative DEFAULT for the entire phase: blind-sign + conditional `LEDGER NOTICE` block on every staking prepare tool.** This is also the safe direction per the trust model: a `LEDGER NOTICE` over-warns at worst; omitting it when coverage is actually absent under-warns, which is the dangerous failure.

**Primary recommendation:** Hand-encode all three surfaces (native via built-in `StakeProgram`, Marinade via vendored-IDL `BorshInstructionCoder`, Jito via pinned-tag primitive-borsh). Zero new runtime deps. Emit a `LEDGER NOTICE (blind-sign)` block on every Phase-15 prepare tool. Surface the variable Marinade immediate-unstake fee — read from on-chain `LiqPool` state via `unstakeNowFeeBp(lamports)` interpolation — verbatim in `CHECKS PERFORMED`.

<user_constraints>
## User Constraints (from CONTEXT.md)

> 15-CONTEXT.md is a **placeholder** (status: "context-gathering pending"). Its "Implementation Decisions" are explicitly marked *"Pending — to be gathered during `/gsd-discuss-phase 15`"* and are framed as **anchor candidates for the researcher to scope-probe**, not locked decisions. This research resolves those candidates. Where a genuine design choice remains, it is flagged in **Open Questions** and the return.

### Locked Decisions (from the phase boundary, treated as binding)
- Three staking surfaces: Marinade (mSOL), Jito (jitoSOL stake pool), native SOL delegate/deactivate/withdraw.
- Marinade ships **immediate-unstake** (incurs a fee surfaced verbatim in `CHECKS PERFORMED`).
- Jito ships **deposit-only**; explicit `[NOTICE — Jito stake-pool unstake not yet supported]` block at preview (unstake deferred per upstream gap).
- Native Stake Program delegate/deactivate/withdraw lifecycle ships in full.
- Stake-account creation sub-helper invoked by `prepare_solana_delegate` when no stake account exists.
- Marinade + Jito program IDs + native Stake Program added to the canonical-dispatch Solana allowlist.
- Marinade immediate-unstake fee is **variable** (liquidity-pool dependent); fetch at quote time, surface verbatim.

### Claude's Discretion (from CONTEXT.md)
- Internal helper names.
- Whether to surface validator commission % in `CHECKS PERFORMED` (CONTEXT says "likely yes — it directly affects yield"). **Recommendation: yes**, when a vote-account is named (see Open Questions for the read source / no-live-RPC tension).

### Anchor candidates resolved by this research (were "Pending")
- Marinade SDK vs hand-encode → **hand-encode from vendored IDL** (Marinade uses standard Anchor discriminators).
- Jito SDK vs hand-encode → **hand-encode** the `DepositSol` SPL-stake-pool instruction (pinned-tag + primitive borsh).
- Native via web3.js vs `@solana/kit` → **web3.js built-in `StakeProgram`** (already installed; `@solana/kit` NOT needed and NOT introduced).
- Stake-account-creation bundling → `createAccount`(System) + `initialize`(Stake) + `delegate`(Stake) as one atomic message (Open Questions Q1 details the exact instruction vector).

### Deferred Ideas (OUT OF SCOPE — ignore completely)
- Jito stake-pool **unstake** — deferred until Jito's withdrawal-authority story clarifies.
- Multi-validator delegation (split stake) — v3.x.
- LST swap (mSOL → SOL via Marinade-bonded swap) — Jupiter swap (Phase 14) covers the same-effect path.
- Solana restaking — no mature primitive yet.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| SOL-W-14 | `prepare_marinade_stake({ lamports })` → unsigned Marinade deposit (mints mSOL) | Hand-encode `deposit(lamports: u64)` ix from vendored `marinade_finance` IDL via `BorshInstructionCoder` (disc `[242,35,198,137,82,225,242,182]`, 11 accounts). Program `MarBmsSgKXdrN1egZf5sqe1TMai9K1rChYNDJgjq7aD`. |
| SOL-W-15 | `prepare_marinade_immediate_unstake({ msolAmount })` → unsigned immediate-unstake; fee surfaced verbatim in `CHECKS PERFORMED` | Hand-encode `liquid_unstake(msolAmount: u64)` ix (disc `[30,30,119,240,191,227,12,16]`, 10 accounts). Fee = variable, read from on-chain `LiqPool` state (`lpMinFee`/`lpMaxFee`/`lpLiquidityTarget`) — SDK reference method `unstakeNowFeeBp(lamports)`. See Topic "Marinade immediate-unstake fee". |
| SOL-W-16 | `prepare_jito_stake_pool_deposit({ lamports })` → unsigned Jito stake-pool deposit; `[NOTICE — Jito stake-pool unstake not yet supported]` at preview | Hand-encode SPL stake pool `DepositSol` (variant 14) from `StakePoolInstruction.depositSol` layout. Jito pool `Jito4APyf642JPZPx3hGc6WWJ8zPKtRbRs4P815Awbb`, jitoSOL mint `J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn`, SPL stake pool program `SPoo1Ku8WFXoNDMHPsrGSTSG1Y47rzgn41SLUNakuHy`. |
| SOL-W-17 | `prepare_solana_delegate({ stakeAccount, voteAccount, lamports })` → unsigned native delegate; stake-account-creation sub-helper when no stake account exists | `StakeProgram.delegate` (built-in, web3.js d.ts:866) returns `Transaction`; bundle `SystemProgram.createAccount`+`StakeProgram.initialize`+`StakeProgram.delegate` when absent (Q1). |
| SOL-W-18 | `prepare_solana_deactivate({ stakeAccount })` → unsigned native deactivate | `StakeProgram.deactivate(params): Transaction` (d.ts:897). Params: `{ stakePubkey, authorizedPubkey }`. |
| SOL-W-19 | `prepare_solana_withdraw({ stakeAccount, to, lamports })` → unsigned native withdraw | `StakeProgram.withdraw(params): Transaction` (d.ts:893). Params: `{ stakePubkey, authorizedPubkey, toPubkey, lamports, custodianPubkey? }`. |
| SOL-W-20 | Marinade + Jito + native Stake Program IDs added to canonical-dispatch allowlist Solana arm | Extend `SOLANA_DISPATCH_ALLOWLIST` in `src/security/canonical-dispatch-solana.ts` via NEW contracts-SOT getters (`StakeProgram.programId.toBase58()` + Marinade + SPL-stake-pool program IDs). NO inlined base58 in the dispatch file. |
</phase_requirements>

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Native stake lifecycle ix encoding | API/Backend (MCP server, `src/protocols/`) | — | `StakeProgram` builders run server-side; output is unsigned message bytes |
| Marinade deposit/liquid-unstake ix encoding | API/Backend (`src/protocols/marinade.ts`) | — | Hand-encode via vendored IDL; server is the only trusted assembler |
| Jito SPL-stake-pool deposit ix encoding | API/Backend (`src/protocols/jito-stake-pool.ts`) | — | Pinned-tag primitive borsh, server-side |
| Marinade fee read (variable) | API/Backend (`src/chains/solana/` RPC read) | — | On-chain `LiqPool` state read at quote time; surfaced in CHECKS PERFORMED |
| payloadFingerprint binding | API/Backend (FROZEN `payload-fingerprint-solana.ts`) | — | All new tx shapes flow through unchanged — NO binding edit |
| Dispatch allowlist gate | Security (`canonical-dispatch-solana.ts`) | — | New program IDs added via SOT getters |
| On-device verification (clear/blind sign) | Ledger device (the only trusted display) | — | Blind-sign default for all staking ix; `LEDGER NOTICE` surfaced server-side |

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@solana/web3.js` | 1.98.4 (installed) | `StakeProgram` builders, `Transaction`, `PublicKey`, `SystemProgram` | Already the project's Solana core; ships native Stake Program support — NO new dep |
| `@coral-xyz/anchor` | (installed, MarginFi path) | `BorshInstructionCoder` for Marinade IDL hand-encode | Already vendored-IDL-encoding for MarginFi (13-03); reuse for Marinade |
| `@solana/spl-token` | (installed) | `TOKEN_PROGRAM_ID`, ATA derivation for mSOL/jitoSOL destination accounts | Already in use across Phase 12/13 |
| `bn.js` | (installed) | `BN` for u64 args to the Anchor coder | Already used by `src/protocols/marginfi.ts` |

### Supporting (build-time / vendoring reference ONLY — NOT runtime deps)
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `@marinade.finance/marinade-ts-sdk` | 5.0.18 | Source of the `marinade_finance` IDL JSON to vendor + the `unstakeNowFeeBp` fee-interpolation reference | Vendor the IDL at plan time; do NOT add to `dependencies` |
| `@solana/spl-stake-pool` | 1.1.8 | Source of the `DepositSol` layout + `StakePoolInstruction.depositSol` account ordering | Reference the layout at plan time; do NOT add to `dependencies` |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Hand-encode Marinade | `@marinade.finance/marinade-ts-sdk` runtime dep | SDK builders are async + RPC-bound + Anchor-`Program`-coupled; returns assembled `Transaction` not unsigned ix; pulls heavy graph; violates D-01 + no-RPC test constraint. Requires supply-chain checkpoint. |
| Hand-encode Jito `DepositSol` | `@solana/spl-stake-pool` runtime dep (low-level `StakePoolInstruction.depositSol`) | The low-level builder IS pure/synchronous/no-signer — adopt-SDK is *less* objectionable here than Marinade. Still a new runtime dep + supply-chain checkpoint; hand-encode keeps zero-dep parity with Phase 14 and the Kamino primitive-borsh precedent. |
| web3.js `StakeProgram` | `@solana/kit` (next-gen Solana SDK) | `@solana/kit` would be a NEW core lib parallel to the project's web3.js v1; introduces dual-core-lib risk; FROZEN binding expects v1 `Transaction.serializeMessage()`. Reject. |

**Installation:** No new runtime packages. (Build-time vendoring only — copy the Marinade IDL JSON into `src/config/idl/` and pin the SPL-stake-pool `DepositSol` layout literals into `src/protocols/jito-stake-pool.ts`, mirroring `src/config/idl/marginfi_0.1.8.json` + Kamino's pinned discriminators.)

**Version verification:**
- `@solana/web3.js` 1.98.4 — confirmed installed (`node_modules/@solana/web3.js/package.json`). [VERIFIED: local node_modules]
- `@marinade.finance/marinade-ts-sdk` 5.0.18 — last published 2026-01-05. [VERIFIED: npm registry — but see provenance rule; package itself is reference-only]
- `@solana/spl-stake-pool` 1.1.8 — last published 2025-06-02. [VERIFIED: npm registry — reference-only]

## Package Legitimacy Audit

> slopcheck could not be run this session (its install was denied by the sandbox classifier — undeclared external PyPI package). Per the graceful-degradation rule, both SDK packages are tagged `[ASSUMED]` for runtime-install purposes. **However, the recommendation is to NOT install either as a runtime dependency** — they are build-time IDL/layout reference only. Registry/repo evidence below establishes legitimacy for that reference use; if the planner chooses adopt-SDK for either, gate the install behind `checkpoint:human-verify`.

| Package | Registry | Age | Downloads | Source Repo | postinstall | slopcheck | Disposition |
|---------|----------|-----|-----------|-------------|-------------|-----------|-------------|
| `@marinade.finance/marinade-ts-sdk` | npm | ~4.5 yrs (created 2021-11-26) | ~2,090/wk | github.com/marinade-finance/marinade-ts-sdk | none | not run | Reference-only (vendor IDL). If adopted runtime → checkpoint. |
| `@solana/spl-stake-pool` | npm | ~4.4 yrs (created 2021-12-30) | ~66,017/wk | github.com/solana-labs/solana-program-library | none | not run | Reference-only (layout). If adopted runtime → checkpoint. |

**Packages removed due to slopcheck [SLOP] verdict:** none.
**Packages flagged as suspicious [SUS]:** none. Both have authoritative org repos (Marinade Finance; the canonical Solana Labs SPL monorepo), multi-year age, healthy downloads, and no postinstall scripts.

**Cross-ecosystem check:** both verified on the npm registry (correct ecosystem for a Node/TS project).

## Architecture Patterns

### System Architecture Diagram

```
agent ──prepare_marinade_stake / _immediate_unstake──┐
agent ──prepare_jito_stake_pool_deposit──────────────┤
agent ──prepare_solana_delegate / _deactivate / _withdraw──┐
                                                     │      │
                                                     ▼      ▼
                              ┌──────────────────────────────────────────┐
                              │ prepare-tool spine (per prepare_solana_spl_send) │
                              │  demo-FIRST refusal → input validation →   │
                              │  feePayer resolution (persona | paired)    │
                              └───────────────┬──────────────────────────┘
                                              │
            ┌─────────────────────────────────┼─────────────────────────────────┐
            ▼                                 ▼                                 ▼
  src/protocols/marinade.ts         src/protocols/jito-stake-pool.ts   built-in StakeProgram
  BorshInstructionCoder(IDL)        pinned-tag DepositSol +            .delegate/.deactivate/
  deposit / liquid_unstake          primitive borsh u64               .withdraw/.createAccount
            │                                 │                          + initialize
            │   (Marinade fee read:           │                                 │
            │    on-chain LiqPool state)      │                                 │
            └───────────────┬─────────────────┴──────────────┬──────────────────┘
                            ▼                                 ▼
              assemble legacy Transaction (feePayer + recentBlockhash)
                            │  messageBytes = tx.serializeMessage()
                            ▼
              computeSolanaPayloadFingerprint(messageBytes)  ◄── FROZEN, unchanged
                            │
                            ▼
              createHandle({ args: RAW, tx: typed, payloadFingerprint })
                            │
              return { handle, …, CHECKS PERFORMED + LEDGER NOTICE (blind-sign)
                       + [Marinade: fee line] / [Jito: unstake-not-supported NOTICE] }
                            │
                            ▼  (agent → preview_send)
              Layer 0.5: checkSolanaDispatchTarget(programIds)  ◄── + Marinade/Jito/Stake program IDs
                            ▼  Layer 0.7: simulation gate
                            ▼  send_transaction (previewToken + userDecision:"send")
                            ▼  WalletConnect → Ledger device (blind-sign)
```

### Recommended Project Structure
```
src/
├── protocols/
│   ├── marinade.ts          # NEW — BorshInstructionCoder(vendored IDL), _marinade indirection
│   ├── jito-stake-pool.ts   # NEW — pinned-tag DepositSol + primitive borsh, _jitoStakePool indirection
│   └── solana-stake.ts      # NEW — StakeProgram bundling helpers (delegate-with-create), _solanaStake indirection
├── config/
│   ├── idl/
│   │   └── marinade_finance_<ver>.json   # NEW — vendored Marinade IDL (encoding SOT)
│   └── contracts.ts         # EXTEND SolanaContracts: marinadeProgram, marinadeState, msolMint,
│                            #   jitoStakePool, jitoSolMint, splStakePoolProgram, nativeStakeProgram
├── security/
│   └── canonical-dispatch-solana.ts  # EXTEND allowlist via new SOT getters (NO inline base58)
└── tools/
    ├── prepare_marinade_stake.ts              # NEW (SOL-W-14)
    ├── prepare_marinade_immediate_unstake.ts  # NEW (SOL-W-15)
    ├── prepare_jito_stake_pool_deposit.ts     # NEW (SOL-W-16)
    ├── prepare_solana_delegate.ts             # NEW (SOL-W-17)
    ├── prepare_solana_deactivate.ts           # NEW (SOL-W-18)
    └── prepare_solana_withdraw.ts             # NEW (SOL-W-19)
```

### Pattern 1: Native StakeProgram — extract instructions from the returned `Transaction`
**What:** `StakeProgram.delegate/.deactivate/.withdraw/.createAccount` return a `web3.Transaction` (multi-ix), NOT a bare `TransactionInstruction`. The assembler must read `.instructions` and re-bundle into the project's legacy-tx shape so `serializeMessage()` produces the FROZEN-binding preimage.
**When to use:** All three native tools + the create-account sub-helper.
**Example:**
```typescript
// Source: node_modules/@solana/web3.js/lib/index.d.ts:866 (StakeProgram.delegate)
import { StakeProgram, Transaction, PublicKey } from "@solana/web3.js";

// delegate returns a Transaction; pull its instructions into our assembler.
const delegateTx = StakeProgram.delegate({
  stakePubkey: stakeAccount,
  authorizedPubkey: feePayer,   // the staker authority == feePayer in our flow
  votePubkey: voteAccount,
});
const out = new Transaction({ feePayer, recentBlockhash });
for (const ix of delegateTx.instructions) out.add(ix);
const messageBytes = new Uint8Array(out.serializeMessage());  // FROZEN preimage
```

### Pattern 2: delegate-with-create bundle (SOL-W-17 / Q1)
**What:** When no stake account exists, `prepare_solana_delegate` emits an atomic bundle: `SystemProgram.createAccount` (fund + assign to Stake program, rent-exempt + `lamports` stake) → `StakeProgram.initialize` (set `Authorized{staker, withdrawer}` to feePayer) → `StakeProgram.delegate`. `StakeProgram.createAccount` already returns the createAccount+initialize pair as a `Transaction`; append the delegate ix.
**When to use:** delegate when stake account absent.
**Example:**
```typescript
// Source: web3.js d.ts:860 (createAccount: CreateStakeAccountParams → Transaction), 851 (initialize → ix)
const createTx = StakeProgram.createAccount({
  fromPubkey: feePayer,
  stakePubkey: newStakeAccount,        // see Open Q1 re: how this address is supplied (Ledger-safe, no ephemeral keypair)
  authorized: new Authorized(feePayer, feePayer),  // staker + withdrawer = the user
  lamports: rentExempt + stakeLamports,
});
const delegateTx = StakeProgram.delegate({ stakePubkey: newStakeAccount, authorizedPubkey: feePayer, votePubkey });
const bundle = new Transaction({ feePayer, recentBlockhash });
for (const ix of [...createTx.instructions, ...delegateTx.instructions]) bundle.add(ix);
```

### Pattern 3: Marinade hand-encode (mirror of `src/protocols/marginfi.ts`)
**What:** `BorshInstructionCoder` over the vendored Marinade IDL. Standard Anchor discriminators (verified). IDL arg names are camelCase in the v0.28-era IDL (`msolAmount`) — confirm against the vendored JSON at build time (MarginFi's IDL was snake_case; Marinade's is camelCase — do NOT assume).
**Example:**
```typescript
// Source: vendored marinade_finance IDL (deposit disc [242,35,198,137,82,225,242,182])
import { BorshInstructionCoder } from "@coral-xyz/anchor";
import BN from "bn.js";
import marinadeIdl from "../config/idl/marinade_finance_<ver>.json" with { type: "json" };
const coder = new BorshInstructionCoder(marinadeIdl as never);
const data = coder.encode("deposit", { lamports: new BN(lamports.toString()) });        // SOL-W-14
const data2 = coder.encode("liquidUnstake", { msolAmount: new BN(msolAmount.toString()) }); // SOL-W-15
```

### Pattern 4: Jito SPL-stake-pool DepositSol hand-encode (mirror of `src/protocols/kamino.ts`)
**What:** SPL stake pool uses a single-byte instruction-variant tag (NOT Anchor). `DepositSol` is variant **14** (`buffer-layout` enum in `@solana/spl-stake-pool`); data = `[14]` ‖ `u64 LE lamports`. Pin the tag + reproduce the account-meta order from `StakePoolInstruction.depositSol` (`DepositSolParams`: stakePool, depositAuthority?, withdrawAuthority, reserveStake, fundingAccount, destinationPoolAccount, managerFeeAccount, referralPoolAccount, poolMint, lamports + TOKEN_PROGRAM + SystemProgram).
**Example:**
```typescript
// Source: @solana/spl-stake-pool dist/instructions.d.ts (DepositSolParams, depositSol variant 14)
function depositSolData(lamports: bigint): Buffer {
  const b = Buffer.alloc(9);
  b.writeUInt8(14, 0);          // DepositSol instruction variant tag — PIN this (verify against layouts.d.ts at build)
  b.writeBigUInt64LE(lamports, 1);
  return b;
}
```

### Anti-Patterns to Avoid
- **Calling the SDK high-level builders (`marinade.deposit()`, spl-stake-pool `depositSol(connection,…)`):** they are async, RPC-bound, and return assembled/partly-signed objects with `signers: Signer[]`. Breaks the no-RPC test constraint and the unsigned-ix invariant.
- **`VersionedTransaction` / v0 messages:** the FROZEN binding accepts ONLY legacy `serializeMessage()` bytes (same guard as Phase 14 Jupiter). Build legacy `Transaction` only.
- **Mutating a returned `StakeProgram` Transaction's blockhash/feePayer in place then re-serializing without re-bundling:** extract `.instructions` and build a fresh legacy `Transaction` with the project's feePayer + recentBlockhash.
- **Inlining any base58 program ID / mint / pool address in a tool or the dispatch file:** all go through new `src/config/contracts.ts` getters (SOT, no-inline grep sentinel).
- **Editing `src/signing/payload-fingerprint-solana.ts`:** FROZEN. New tx shapes flow through unchanged.
- **Assuming an ephemeral `Keypair` is needed for the stake account:** the stake account must be a deterministic/user-controlled address (NOT an ephemeral keypair the server can't sign for) — Ledger-safe. See Open Q1.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Native stake instruction byte layout | Custom Stake Program encoder | Built-in `StakeProgram.*` (web3.js) | Solana-maintained; exact byte layout + sysvar account ordering handled |
| Marinade discriminator + borsh | Custom byte assembler | `BorshInstructionCoder(vendored IDL)` (MarginFi precedent) | IDL is the encoding SOT; coder derives discriminator + arg layout |
| Marinade immediate-unstake fee math | Re-derive the interpolation formula from scratch | Reproduce `unstakeNowFeeBp` interpolation against on-chain `LiqPool` state | Variable fee = linear interp(lpMinFee, lpMaxFee) by pool drain vs lpLiquidityTarget — getting it wrong mis-states the fee to the user |
| ATA derivation for mSOL/jitoSOL destination | Manual PDA seeds | `@solana/spl-token` `getAssociatedTokenAddress` + createATA prepend (Phase 12 precedent) | Already the project pattern for SPL destinations |
| SPL stake pool DepositSol account ordering | Guess the account metas | Reproduce from `StakePoolInstruction.depositSol` (`DepositSolParams`) | Wrong account order → tx fails at simulation; the d.ts IS the authoritative ordering |

**Key insight:** Every "hand-encode" here is **hand-encode against an authoritative layout source** (web3.js builtin / vendored IDL / SDK low-level builder d.ts) — NOT inventing bytes. This is the D-01 discipline from Phase 13, not raw byte-fabrication.

## Runtime State Inventory

> Phase 15 is **greenfield additive** (adds new prepare tools + protocol modules + dispatch entries + SOT entries). No rename/refactor/migration. This section is included only to record the explicit "nothing to migrate" finding.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | None — verified: no existing stake-account records, no renamed keys/collections. New handles are created at prepare time only. | None |
| Live service config | None — no external service config embeds a Phase-15 string. | None |
| OS-registered state | None — no OS-level registration. | None |
| Secrets/env vars | None new required. Reuses `VAULTPILOT_DEMO` + existing Solana RPC config. | None |
| Build artifacts | None new (vendored IDL is a source file, not a build artifact). | None |

## Common Pitfalls

### Pitfall 1: `StakeProgram.*` returns a `Transaction`, not a `TransactionInstruction`
**What goes wrong:** Treating `StakeProgram.delegate(...)` like `createTransferCheckedInstruction(...)` (a bare ix) and passing it straight to `tx.add()` — type error / wrong assembly.
**Why it happens:** Marinade/Jito/Kamino/MarginFi builders return ix; the native StakeProgram builders return `Transaction`.
**How to avoid:** Always extract `.instructions` and re-bundle into the project's legacy `Transaction`.
**Warning signs:** TS error "Argument of type 'Transaction' is not assignable to parameter of type 'TransactionInstruction'".

### Pitfall 2: `lamports: number` precision (web3.js Stake params)
**What goes wrong:** `CreateStakeAccountParams.lamports` / `WithdrawStakeParams.lamports` are JS `number`, not bigint. Decimal-string SOL amounts parsed to bigint must be down-converted to `number`.
**Why it happens:** web3.js v1 Stake API predates bigint adoption.
**How to avoid:** Parse the decimal-string amount to lamports (bigint, 9 decimals via the existing `parseSolanaAmountStrict`-equivalent), then `Number()` with an explicit `> Number.MAX_SAFE_INTEGER` guard before passing to the StakeProgram builder. (9.007 billion SOL is the 2^53 ceiling — never reached in practice, but assert it.)
**Warning signs:** Silent precision loss on absurdly large amounts; lint/test should pin the guard.

### Pitfall 3: ephemeral-keypair stake account (Ledger-incompatible)
**What goes wrong:** Naively, a new stake account is a fresh `Keypair` that must co-sign `createAccount` — the server has no private key (and must never), and the Ledger only signs as feePayer/authority. An ephemeral-keypair-signer instruction can't be signed in this architecture.
**Why it happens:** Most SDK examples generate `Keypair.generate()` for the stake account.
**How to avoid:** Use a **derived/seeded stake account address** (`createAccountWithSeed` / a PDA-style deterministic address controlled by the user's wallet) so no second signer is required — mirrors MarginFi's `initialize_pda` (NOT `initialize`) choice in Phase 13. See Open Q1: the exact derivation (`createAccountWithSeed` base=feePayer + seed) needs a plan-time decision.
**Warning signs:** A `signers: [stakeKeypair]` requirement; an instruction with a non-feePayer signer account.

### Pitfall 4: Marinade IDL arg-name casing (camelCase vs snake_case)
**What goes wrong:** `coder.encode("deposit", { lamports })` silently drops a mis-cased field → wrong bytes (same failure class as MarginFi's snake_case requirement).
**Why it happens:** The MarginFi 0.1.8 IDL used snake_case; the Marinade v0.28-era IDL uses camelCase (`msolAmount`, `liquidUnstake`). The coder reads the IDL's exact names.
**How to avoid:** Read the vendored IDL's `instructions[].name` + `args[].name` at build time and assert the exact casing in a fixture. Verified from the probe: instruction names `deposit` / `liquidUnstake` (camelCase), args `lamports` / `msolAmount`.
**Warning signs:** A fingerprint fixture that doesn't match the pinned literal.

### Pitfall 5: dispatch allowlist must enumerate ALL touched programs
**What goes wrong:** Marinade deposit/liquid_unstake CPI into the System program + Token program; the SPL stake pool deposit touches the native Stake program + Token + System. If the allowlist only has the top-level program ID, `checkSolanaDispatchTarget` refuses on a CPI-touched program ID that appears in `programIds`.
**Why it happens:** Same class as Phase 13 Kamino oracle programs (Pitfall 5 there).
**How to avoid:** Enumerate `programIds` from the **actual built instruction vector** (the top-level program of each ix in the bundle), NOT guessed. For native delegate-with-create: System + Stake. For Marinade: Marinade + (whatever top-level ix the bundle contains). Add each via a SOT getter.
**Warning signs:** `DISPATCH_TARGET_REFUSED` naming a program ID you forgot to allowlist.

## Code Examples

### Marinade deposit ix (SOL-W-14)
```typescript
// Source: vendored marinade_finance IDL via @coral-xyz/anchor BorshInstructionCoder
// disc(deposit) = [242,35,198,137,82,225,242,182]  (sha256("global:deposit")[..8], VERIFIED)
const data = coder.encode("deposit", { lamports: new BN(lamports.toString()) });
// 11 accounts per IDL — reproduce the account-meta order from the IDL accounts list.
```

### Marinade immediate-unstake ix + fee read (SOL-W-15)
```typescript
// disc(liquidUnstake) = [30,30,119,240,191,227,12,16]  (sha256("global:liquid_unstake")[..8], VERIFIED)
const data = coder.encode("liquidUnstake", { msolAmount: new BN(msolAmount.toString()) });
// Fee: read on-chain LiqPool state (lpMinFee, lpMaxFee bps; lpLiquidityTarget) at quote time.
// fee_bp = interp between lpMinFee..lpMaxFee by how far the unstake drains the pool below target.
// SDK reference: MarinadeState.unstakeNowFeeBp(lamportsToObtain): Promise<number>.
// Surface VERBATIM in CHECKS PERFORMED (SOL-W-15).
```

### Native deactivate / withdraw (SOL-W-18 / SOL-W-19)
```typescript
// Source: web3.js d.ts:897 / :893
const deact = StakeProgram.deactivate({ stakePubkey: stakeAccount, authorizedPubkey: feePayer });
const wd = StakeProgram.withdraw({
  stakePubkey: stakeAccount, authorizedPubkey: feePayer, toPubkey: to,
  lamports: Number(lamportsBigint),   // see Pitfall 2 guard
});
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Adopt LST SDKs as runtime deps | Hand-encode from vendored IDL/layout (D-01) | Phase 13 established this | Zero new runtime deps; no supply-chain checkpoint; no RPC in tests |
| web3.js v1 `StakeProgram` | (still current for v1; `@solana/kit` is the v2 path) | kit is the forward path but NOT adopted here | Stay on web3.js v1 — FROZEN binding expects v1 `serializeMessage()` |

**Deprecated/outdated:**
- `StakeProgram` "redelegate" — `delegate` doubles as redelegate (per the d.ts comment "can also be used to redelegate"). No separate redelegate tool needed.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | SPL stake pool `DepositSol` instruction variant tag = 14 | Pattern 4 | Wrong tag → wrong bytes; tx fails at simulation. **Plan must VERIFY the tag against `@solana/spl-stake-pool` `dist/layouts.d.ts` / instruction enum at build time** and pin it as a fixture (mirror Kamino discriminator pinning). HIGH priority verify. |
| A2 | Marinade IDL arg names: `deposit`→`lamports`, `liquidUnstake`→`msolAmount` (camelCase) | Pitfall 4 | Mis-cased → silently-dropped field → wrong bytes. Verified from probe IDL JS; re-assert against the vendored JSON at build. |
| A3 | Stake account uses `createAccountWithSeed` (deterministic, no ephemeral keypair) | Pitfall 3 / Open Q1 | If a fresh keypair is unavoidable, the create-on-delegate flow is NOT Ledger-signable in this architecture — would force a redesign. Needs plan-time decision. |
| A4 | Marinade/Jito/Stake deposit instructions are blind-signed on Ledger (NOT clear-signed) | Ledger clear-sign | If Ledger DOES clear-sign native Stake ops (CAL coverage present), the `LEDGER NOTICE` over-warns (safe). Conservative default; verify per-instruction against Ledger CAL at v2.0 device-verify gate. |
| A5 | Both SDK packages are reference-only (not runtime deps) | Standard Stack | If planner adopts either as runtime → supply-chain `checkpoint:human-verify` required. |

**If this table is empty:** it is not — A1 and A3 are the load-bearing items needing plan-time verification.

## Open Questions

1. **Stake account address derivation (SOL-W-17 / SOL-W-20 create sub-helper).**
   - What we know: an ephemeral `Keypair` stake account is NOT signable (Pitfall 3); MarginFi solved the analogous problem with `initialize_pda`.
   - What's unclear: native Stake accounts are not PDAs of the Stake program in the same way; the standard Ledger-safe path is `createAccountWithSeed(base = user wallet, seed = "<stake-seed>", programId = StakeProgram.programId)`, which yields a deterministic address the user's wallet authority controls (no second signer). Need to confirm the seed scheme + whether `prepare_solana_delegate` accepts a caller-supplied `stakeAccount` (already in the signature) when present, and derives-via-seed only when absent.
   - Recommendation: Plan-time decision — default to `createAccountWithSeed` with a documented seed; accept `stakeAccount` arg as override. Pin the derived address in a fixture.

2. **Vote-account validation UX (CONTEXT discretion).**
   - What we know: CONTEXT asks whether to hard-refuse vs NOTICE on an inactive/invalid vote account, and whether to surface validator commission %.
   - What's unclear: the NO-LIVE-RPC research constraint means validating "vote account currently active" + reading commission requires a live RPC `getVoteAccounts` call at prepare time. That is fine in production (prepare tools already do RPC for blockhash) but the **test seam must mock it**.
   - Recommendation: NOTICE block (not hard-refuse) with validator commission % when resolvable; mock the vote-account read at the Connection boundary in tests. Surfacing commission = yes (CONTEXT's "likely yes").

3. **Native withdraw mid-deactivation UX (CONTEXT specifics).**
   - What we know: native withdraw before deactivation completes (~2-day window) will fail on-chain.
   - What's unclear: whether `prepare_solana_withdraw` should hard-refuse mid-deactivation or emit a NOTICE with the deactivation-completion epoch.
   - Recommendation: NOTICE block (don't hard-refuse — the simulation gate at Layer 0.7 is the real backstop; refusing in prepare requires a stake-account-state RPC read that couples prepare to live state). Document as plan-time discretion.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| `@solana/web3.js` (StakeProgram) | native surface (SOL-W-17/18/19/20) | ✓ | 1.98.4 | — |
| `@coral-xyz/anchor` (BorshInstructionCoder) | Marinade hand-encode | ✓ | installed (MarginFi path) | — |
| `bn.js` | u64 args | ✓ | installed | — |
| Marinade IDL JSON | Marinade encode | ✓ (vendor from SDK 5.0.18) | — | — |
| SPL stake pool layout | Jito encode | ✓ (reference SDK 1.1.8 d.ts) | — | — |
| Live Solana RPC | blockhash + (Q2/Q3) state reads | n/a at research (NO-LIVE-RPC) | — | mock at Connection boundary in tests |

**Missing dependencies with no fallback:** none.
**Missing dependencies with fallback:** none new — all encoding sources are already installed or vendorable at build time.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest (project standard) |
| Config file | vitest config in repo root (existing) |
| Quick run command | `npx vitest run test/prepare-marinade-stake.test.ts` (per-file) |
| Full suite command | `npm test` (full suite + FROZEN-zero-diff gate) |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| SOL-W-14 | Marinade deposit ix bytes + fingerprint | unit | `npx vitest run test/prepare-marinade-stake.test.ts` | ❌ Wave 0 |
| SOL-W-15 | liquid_unstake ix + fee in CHECKS PERFORMED | unit | `npx vitest run test/prepare-marinade-immediate-unstake.test.ts` | ❌ Wave 0 |
| SOL-W-16 | Jito DepositSol ix + unstake-NOTICE block | unit | `npx vitest run test/prepare-jito-stake-pool-deposit.test.ts` | ❌ Wave 0 |
| SOL-W-17 | delegate + create-on-absent bundle | unit | `npx vitest run test/prepare-solana-delegate.test.ts` | ❌ Wave 0 |
| SOL-W-18 | deactivate ix | unit | `npx vitest run test/prepare-solana-deactivate.test.ts` | ❌ Wave 0 |
| SOL-W-19 | withdraw ix | unit | `npx vitest run test/prepare-solana-withdraw.test.ts` | ❌ Wave 0 |
| SOL-W-20 | dispatch allowlist accepts new program IDs, refuses unknown | unit | `npx vitest run test/canonical-dispatch-solana.test.ts` (extend) | partial — extend |
| (binding) | new tx-shape fingerprint fixtures | unit | `npx vitest run test/signing-fingerprint.test.ts` (NEW fixtures G+) | extend |
| (SOT) | contracts SOT new getters | unit | `npx vitest run test/config-contracts.test.ts` (extend) | extend |

### Sampling Rate
- **Per task commit:** the per-file `npx vitest run` for the touched tool.
- **Per wave merge:** `npm test` (full suite + FROZEN zero-diff gate on `payload-fingerprint-solana.ts` / `presign-hash-solana.ts`).
- **Phase gate:** full suite green before `/gsd-verify-work`. v2.0 device-verify gate (physical Ledger + Solana app) per ROADMAP Phase 16 close-out.

### Wave 0 Gaps
- [ ] 6 new prepare-tool test files (one per tool) — each with `process.env.VAULTPILOT_DEMO = "false"` in `beforeEach` + restore in `afterEach` (the **Phase-13 CI-failure-prevention pattern**, verified in `test/prepare-marginfi-supply.test.ts:117`), and mock at the `Connection`/registry boundary (NO live RPC).
- [ ] New cryptographic-binding fixtures in `test/signing-fingerprint.test.ts` — pinned `0x…` literals for each NEW tx shape (Marinade deposit, Marinade liquid_unstake, Jito DepositSol, native delegate, native delegate-with-create bundle, native deactivate, native withdraw). Continue the A–F fixture lettering (G, H, …). NO `beforeAll`-snapshot — drift fails at a specific line (CLAUDE.md convention).
- [ ] Vendored Marinade IDL JSON committed to `src/config/idl/`.
- [ ] Pinned SPL-stake-pool `DepositSol` variant-tag fixture (A1 — verify tag at build).
- [ ] Extend `test/canonical-dispatch-solana.test.ts` for the new allowlist entries + an unknown-program-refusal case.

## Security Domain

### Applicable ASVS Categories
| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | No user auth in this MCP server; self-custodial signing on device |
| V3 Session Management | no | No server sessions; WalletConnect session is Phase-11 scope |
| V4 Access Control | yes | `previewToken` + `userDecision:"send"` schema gate; dispatch allowlist (Layer 0.5) gates which programs reach signing |
| V5 Input Validation | yes | base58 pubkey regex on stakeAccount/voteAccount/to/mint; decimal-string lamports parsed strictly; Zod/JSON-schema on tool args |
| V6 Cryptography | yes | NEVER hand-roll: `payloadFingerprint` (FROZEN keccak binding) + device-display SHA-256 unchanged; new tx shapes flow through unchanged |

### Known Threat Patterns for Solana staking
| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Agent swaps voteAccount/stakeAccount for an attacker's | Tampering | `payloadFingerprint` binds message bytes prepare→send; CHECKS PERFORMED surfaces voteAccount; on-device display is the trust anchor |
| Blind-sign hides the real instruction | Spoofing/Repudiation | `LEDGER NOTICE (blind-sign)` block warns the user the device CANNOT decode this ix — they must trust the MCP-surfaced CHECKS PERFORMED; documented residual risk (no preflight skill until v1.3) |
| Off-by-decimal lamports (over-stake) | Tampering | Decimal-string → strict parse → lamports; `number` precision guard (Pitfall 2) |
| Unknown CPI program in the bundle | Elevation/Tampering | Layer 0.5 dispatch allowlist refuses any program ID not enumerated (Pitfall 5) |
| Marinade fee misrepresentation | Information disclosure | Fee read from on-chain LiqPool state at quote time, surfaced VERBATIM (SOL-W-15) — agent cannot understate it |
| Ephemeral-keypair stake account (unsignable / server-key risk) | Elevation | `createAccountWithSeed` (no second signer); NEVER touch private key material (CLAUDE.md invariant) |

## Proposed Plan Structure (3 plans, per ROADMAP estimate)

The ROADMAP estimates 3 plans grouped by surface; this research confirms grouping by **dependency boundary + protocol module** keeps each plan's blast radius tight and the FROZEN-binding gate cohesive:

- **15-01 — Native SOL lifecycle (SOL-W-17/18/19/20 native arm).** `src/protocols/solana-stake.ts` (StakeProgram bundling + delegate-with-create sub-helper, `_solanaStake` indirection) + `prepare_solana_delegate` / `_deactivate` / `_withdraw` + native Stake Program ID in contracts SOT + dispatch allowlist (System+Stake) + fixtures G–I (delegate, delegate-with-create bundle, deactivate, withdraw). **No new dep.** Establishes the StakeProgram-`Transaction`-extraction pattern the other plans don't need but anchors the native arm first (it's the zero-ambiguity surface).
- **15-02 — Marinade (SOL-W-14/15).** Vendor `marinade_finance` IDL → `src/protocols/marinade.ts` (`BorshInstructionCoder`, `_marinade` indirection) + `prepare_marinade_stake` + `prepare_marinade_immediate_unstake` (variable fee read from on-chain LiqPool, verbatim in CHECKS PERFORMED) + Marinade program/state/mSOL-mint in contracts SOT + dispatch allowlist arm + fixtures J–K (deposit, liquid_unstake). **No new runtime dep** (IDL vendored).
- **15-03 — Jito SPL stake pool (SOL-W-16).** `src/protocols/jito-stake-pool.ts` (pinned `DepositSol` variant tag — VERIFY A1 — + primitive borsh, `_jitoStakePool` indirection) + `prepare_jito_stake_pool_deposit` (with the unmissable `[NOTICE — Jito stake-pool unstake not yet supported]` block) + Jito pool/jitoSOL-mint/SPL-stake-pool-program in contracts SOT + dispatch allowlist arm + fixture L (DepositSol). Phase-final: register-all + full-suite + FROZEN-zero-diff gate. **No new runtime dep.**

Each plan: `LEDGER NOTICE (blind-sign)` block on every tool; demo-FIRST refusal + `VAULTPILOT_DEMO="false"` test seam; Connection-boundary mocking (NO live RPC).

## Sources

### Primary (HIGH confidence)
- `node_modules/@solana/web3.js/lib/index.d.ts` (installed v1.98.4) — `StakeProgram` class (lines 835–898), param types (628–760). [VERIFIED: local node_modules]
- `/tmp/marinade-probe/node_modules/@marinade.finance/marinade-ts-sdk/dist/**` (v5.0.18) — `marinade.d.ts` (deposit/liquidUnstake signatures), `marinade.types.d.ts` (result shapes carry only `transaction`), `marinade-state.types.d.ts` (LiqPool fee fields), `marinade-state.d.ts` (`unstakeNowFeeBp`), default config (program ID `MarBmsSgKXdrN1egZf5sqe1TMai9K1rChYNDJgjq7aD`, state `8szGkuLTAux9XMgZ2vtY39jVSowEcpBfFfD8hXSEqdGC`), IDL JS (instruction names + args). [VERIFIED: installed probe]
- `/tmp/splpool-probe/node_modules/@solana/spl-stake-pool/dist/**` (v1.1.8) — `instructions.d.ts` (`StakePoolInstruction.depositSol` + `DepositSolParams`), `constants.d.ts` (`STAKE_POOL_PROGRAM_ID` = `SPoo1Ku8WFXoNDMHPsrGSTSG1Y47rzgn41SLUNakuHy`). [VERIFIED: installed probe]
- developers.ledger.com/docs/device-interaction/references/signers/solana — Ledger Solana clear-sign scope ("simple transfer / createAccount combos only"; error 6808 → blind sign). [CITED]
- Project pattern files: `src/protocols/marginfi.ts`, `src/protocols/kamino.ts`, `src/protocols/jupiter.ts`, `src/security/canonical-dispatch-solana.ts`, `src/config/contracts.ts`, `src/signing/payload-fingerprint-solana.ts` (FROZEN), `src/tools/prepare_solana_spl_send.ts`, `test/prepare-marginfi-supply.test.ts` (demo-mode CI seam). [VERIFIED: repo]

### Secondary (MEDIUM confidence)
- jito.network docs (staking-integration / deployed-programs) — Jito stake pool `Jito4APyf642JPZPx3hGc6WWJ8zPKtRbRs4P815Awbb`, jitoSOL mint `J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn` (cross-confirmed with WebSearch result naming the same SPL stake pool program). [CITED]

### Tertiary (LOW confidence)
- SPL stake pool `DepositSol` variant tag = 14 — inferred from the SPL stake pool instruction enum ordering; **MUST be verified against `@solana/spl-stake-pool` `dist/layouts.d.ts` instruction enum at plan/build time** (A1). [ASSUMED]

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all three encoding sources probed via installed `.d.ts`/IDL; zero-new-runtime-dep verdict confirmed.
- Architecture: HIGH — mirrors three established Phase-12/13/14 patterns (MarginFi Anchor coder, Kamino pinned-tag, Jupiter legacy assembly) + FROZEN binding unchanged.
- Pitfalls: HIGH — StakeProgram-returns-Transaction, lamports-number-precision, ephemeral-keypair, IDL casing, dispatch-enumeration all verified against the installed types.
- Ledger clear-sign: MEDIUM-HIGH — Ledger developer doc is explicit on scope but doesn't enumerate Stake ops; conservative blind-sign default is the safe direction either way; per-instruction CAL coverage to be confirmed at the v2.0 physical-device verify gate.
- Addresses/program IDs: HIGH — Marinade from SDK default config; Jito from docs + WebSearch cross-confirm; SPL stake pool program from the SDK constant.

**Research date:** 2026-06-04
**Valid until:** 2026-07-04 (stable — program IDs + native StakeProgram API are long-stable; SPL stake pool variant tag is the only item needing build-time re-verify).
