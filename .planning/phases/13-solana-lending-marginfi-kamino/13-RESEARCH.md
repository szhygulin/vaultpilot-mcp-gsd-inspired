# Phase 13: Solana lending — MarginFi + Kamino - Research

**Researched:** 2026-06-03
**Domain:** Solana lending protocols (MarginFi v2 + Kamino klend) — unsigned-instruction tx building, Anchor IDL hand-encoding, per-protocol health math, PDA-init lifecycle, base58 canonical-dispatch
**Confidence:** HIGH (both SDKs probed via throwaway install + `.d.ts` + IDL inspection; program IDs from installed SDK configs; Ledger CAL state cross-verified)

---

## SUMMARY (lead with the rnd verdict + scope decision)

Both lending SDKs are **legitimate, actively maintained, and expose unsigned instruction builders** — but they diverge sharply on the dimension that matters to this codebase (web3.js v1 vs `@solana/kit`), and that divergence drives the one genuine scope decision below.

- **MarginFi (`@mrgnlabs/marginfi-client-v2@6.4.2`):** web3.js-v1-native (`@solana/web3.js@^1.93.2`, matches our installed v1.98.4). Exposes `make{Init,Deposit,Withdraw,Borrow,Repay}Ix` returning unsigned `TransactionInstruction`. **The rnd-history red flag IS real** — `marginfi_account_initialize` lists `marginfi_account[SIGNER]` (random-Keypair model, Ledger-INCOMPATIBLE) — BUT a sibling `marginfi_account_initialize_pda` exists that is PDA-derived (`authority[SIGNER]` only) and IS Ledger-safe. The SDK wraps both (`makeInitMarginfiAccountIx` / `makeInitMarginfiAccountPdaIx`). D-01's hand-encode-from-IDL path is fully available; the IDL pins discriminators as byte arrays. **Decision: cherry-pick-IDL (hand-encode writes per D-01; SDK decoders for reads per D-02).**

- **Kamino (`@kamino-finance/klend-sdk@8.0.2`):** `@solana/kit`-native (`@solana/kit@^2.3.0`). Its codegen instruction builders return kit `Instruction<string, …>` with `Address`/`TransactionSigner` types — NOT web3.js-v1 `TransactionInstruction`. Feeding those into our FROZEN web3.js-v1 `Transaction.serializeMessage()` binding would require a `@solana/compat` conversion layer per call. The klend IDL is legacy-Anchor (discriminators computed via `sha256("global:<ix>")[..8]`, not pinned in JSON; the `@codegen/*/instructions/*` files export the `DISCRIMINATOR` Buffer). Borrow/withdraw require an in-tx **`refreshReserve` (per reserve) + `refreshObligation`** ceremony with strict instruction ordering; obligation setup needs `initUserMetadata` THEN `initObligation` (seed-tagged PDA + Scope oracle). **This confirms the rnd 3-5× MarginFi-effort prediction.** Decision: cherry-pick-IDL (hand-encode from IDL discriminators, bypassing kit entirely; SDK `KaminoObligation`/`reserve` decoders for reads, behind a kit→our-shape adapter).

**Primary recommendation:** Keep BOTH protocols in v2.0 scope (D-01's hand-encode-from-IDL path neutralizes the SDK-signing and kit-vs-v1 risks for the write surface), **but split per-protocol across plans** — MarginFi and Kamino do NOT share a tx-building seam, so a single "10 prepare tools" plan (roadmap 13-04) is both heavy and falsely-coupled. Recommended 6-plan structure (below) lets MarginFi (the simpler, web3.js-v1-native protocol) ship + verify first, de-risking the Kamino kit-impedance work.

---

## SCOPE DECISION — both-in-one-phase vs split Kamino (FLAG FOR ORCHESTRATOR)

**The CONTEXT already resolves the binary "keep both vs defer one" question** via D-01 (hand-encode-from-IDL keeps both protocols in-phase regardless of SDK signing model). The probe **confirms D-01 is the right call** — both protocols' write instructions are hand-encodable from their IDLs, so neither needs deferral.

**The residual decision D-01/D-03/D-07 do NOT resolve: plan COUNT and SEQUENCING.** This is explicitly delegated to the planner (CONTEXT § Claude's Discretion "Phase split sizing"). The probe gives the planner the evidence:

| Dimension | MarginFi | Kamino | Implication |
|-----------|----------|--------|-------------|
| Primary SDK types | web3.js v1 (`TransactionInstruction`) | `@solana/kit` (`Instruction`/`Address`) | NO shared tx-build seam — falsely coupled if bundled |
| IDL discriminator source | pinned byte arrays in IDL JSON | computed `sha256("global:<ix>")[..8]` (or codegen `DISCRIMINATOR` const) | different hand-encode helpers per protocol |
| Per-write ceremony | single ix (deposit/repay) or +1 PDA-authority (withdraw/borrow) | **multi-ix: `refreshReserve`×N + `refreshObligation` + op, ordered** | Kamino tx-builder is materially heavier |
| Account-init | 1 ix (`initialize_pda`, args `account_index`+`third_party_id`) | **2 ix: `initUserMetadata` THEN `initObligation`** (seed-tagged) | Kamino init is a 2-step setup, not 1 |
| Oracle refresh in-tx | none (health is read-side via decoder) | **Scope oracle (`scopePrices`) refresh required pre-op** | Kamino writes touch the oracle program |
| Health-math source | `computeHealthComponents` → `{assets, liabilities}` weighted | per-reserve `loanToValue`/`liquidationThreshold` × position | two distinct pure-bigint modules (D-07) |

**Verdict: NOT a single-phase blocker, but a strong per-protocol PLAN split.** Recommendation: MarginFi gets its own reads + writes + init plan(s) that ship and verify FIRST (web3.js-v1-native = lowest risk, reuses the SPL pipeline cleanly); Kamino follows in its own plan(s) where the kit-impedance + refresh-ceremony work is isolated. Concretely: 6 plans (see § Proposed Plan Structure), NOT the roadmap's 4. The roadmap's 13-04 (10 prepare tools in one plan) should be rejected as a single execute unit on both weight and false-coupling grounds.

**No new locked-decision conflict surfaced.** D-01 (hand-encode), D-03 (hard-refuse PDA-absent), D-07 (on-chain-accurate health) all hold against the probe evidence. The only OPEN item the planner must confirm is the Kamino **main-market lending-market address** for the contracts SOT (§ Open Questions Q1) — it is a per-deployment runtime arg, NOT an SDK constant.

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01 (LOCKED):** If a protocol SDK does NOT expose UNSIGNED instruction output, fall back to **hand-encode instructions from the program's Anchor IDL** via `@coral-xyz/anchor`'s `BorshInstructionCoder` (no signer) — same approach as SPL/system encoding in Phases 12/44. Full control, guaranteed unsigned, Ledger-safe. Keeps BOTH protocols in-phase. IDL is the canonical encoding source (mirrors `contracts.ts` as address SOT).
- **D-02:** SDK account DECODERS may be used for reads even where the SDK can't build unsigned writes — decoding is read-only, no signing surface. The hand-encode rule (D-01) applies to the write/tx-building path.
- **D-03 (LOCKED):** When a user calls a supply/withdraw/borrow/repay tool but the per-wallet PDA (`MarginfiAccount` / `Obligation`) does NOT exist, the tool returns a **structured refusal with NO handle minted**, instructing the agent to call the init tool first. **Two explicit, separately-approved transactions.** Do NOT auto-bundle account-init into the supply tx.
- **D-04:** PDA-presence check is a read (RPC `getAccountInfo` on the derived PDA). Absent → refuse-and-redirect. Present → proceed. Refusal is a structured error code in the `solanaErrorCode` local-constant pattern (Phase 44) — NOT a fabricated central registry.
- **D-05:** `src/config/contracts.ts` gains a Solana sub-table (`Record<"solana", SolanaContracts>` mirroring the EVM shape). New slots: `marginfiProgram`, `kaminoLendProgram`, + per-protocol PDA-derivation helpers. Program IDs NEVER inlined. Regression-tested (SOL-W-10).
- **D-06:** `src/security/canonical-dispatch.ts` gains a Solana arm as a SIBLING function (base58 membership, NO EIP-55 normalization) — NOT a parameterization of the EVM path. Layer 0.5 refusal at preview time (SOL-W-09). *(NOTE: this sibling already exists as `canonical-dispatch-solana.ts` from Phase 12 — Phase 13 EXTENDS its allowlist, see § Architecture.)*
- **D-07:** Replicate each protocol's health math **on-chain-accurate** (re-derive the exact formula), NOT an approximation. Per-protocol pure-bigint modules `src/signing/marginfi-health.ts` + `src/signing/kamino-health.ts` mirror `aave-health.ts`. MarginFi = risk-weighted asset/liability weights; Kamino = per-reserve LTV / liquidation-threshold.

### Claude's Discretion
- Internal helper names; per-protocol module internal structure.
- **Phase split sizing:** deferred to the planner. RECORDED CONCERN: roadmap 13-04 bundles 10 prepare tools — heavy. Per-protocol split (e.g. 13-04 MarginFi prepares + init, 13-05 Kamino prepares + init) PREFERRED for smaller execute units + earlier MarginFi-only verification. Planner decides 4 vs 5-6 plans on conflict-graph + execute-weight basis.

### Deferred Ideas (OUT OF SCOPE)
- Other Solana lending protocols (Solend, etc.) — v2.x backlog.
- Cross-protocol position aggregation — v3.x ergonomics (ERG-04 / ERG-06).
- E-mode / per-asset borrowing-cap surfacing — verify-phase feedback (Aave Phase 7 precedent).
- Multi-persona Solana demo expansion beyond Phase 13's needs.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| SOL-W-03 | `get_marginfi_positions({ wallet })` returns bank-keyed supplied + borrowed + health-factor-equivalent | `MarginfiAccount.fetch`/`decodeAccountRaw` decoder (D-02) + `computeHealthComponents` (D-07 § Health Math) |
| SOL-W-04 | `prepare_marginfi_supply`/`_withdraw`/`_borrow`/`_repay` produce unsigned MarginFi instructions | IDL discriminators + account lists pinned (§ MarginFi Instruction Map); hand-encode via BorshInstructionCoder (D-01) |
| SOL-W-05 | `prepare_marginfi_account_init` sets up `MarginfiAccount` PDA when absent | `marginfi_account_initialize_pda` IDL ix (Ledger-safe PDA path, NOT the signer variant) |
| SOL-W-06 | `get_kamino_positions({ wallet })` returns vault-keyed supplied + borrowed + per-vault health | `KaminoObligation` decoder + per-reserve `loanToValue`/`liquidationThreshold` (D-02 + D-07) |
| SOL-W-07 | `prepare_kamino_supply`/`_withdraw`/`_borrow`/`_repay` produce unsigned Kamino instructions | IDL discriminators (§ Kamino Instruction Map) + in-tx refresh ceremony; hand-encode (D-01) |
| SOL-W-08 | `prepare_kamino_obligation_init` sets up `Obligation` PDA when absent | `initUserMetadata` + `initObligation` IDL ix pair (seed-tagged PDA) |
| SOL-W-09 | MarginFi + Kamino program IDs in canonical-dispatch Solana arm; mismatch refuses at preview | EXTEND existing `SOLANA_DISPATCH_ALLOWLIST` (`canonical-dispatch-solana.ts`) — already wired into preview Layer 0.5 |
| SOL-W-10 | Program addresses sourced from `src/config/contracts.ts` Solana sub-table; regression-tested | New `SOLANA_CONTRACTS` sibling sub-table (§ Contracts SOT) — mirrors Compound/Lido/EigenLayer sibling pattern |
</phase_requirements>

---

## rnd VERDICT TABLE

| # | Claim | Source (URL / artifact) | Confidence | Failure mode if wrong |
|---|-------|-------------------------|------------|-----------------------|
| V1 | `@mrgnlabs/marginfi-client-v2@6.4.2` is web3.js-v1-native (dep `@solana/web3.js@^1.93.2`); NO `@solana/kit` | `npm view ... dependencies` 2026-06-03 [VERIFIED] | Would force a kit-compat layer for MarginFi too — but verified absent |
| V2 | MarginFi exposes UNSIGNED `make{Init,Deposit,Withdraw,Borrow,Repay}Ix` returning `Promise<TransactionInstruction>` | `node_modules/.../dist/instructions.d.ts` [VERIFIED] | Would force IDL-only encoding (still D-01-covered) |
| V3 | `marginfi_account_initialize` requires `marginfi_account[SIGNER]` (random-Keypair, Ledger-INCOMPATIBLE) | `dist/idl/marginfi_0.1.8.json` ix accounts [VERIFIED] | Using the signer variant would brick init on Ledger (no ephemeral key device-side) |
| V4 | `marginfi_account_initialize_pda` is PDA-derived (`authority[SIGNER]` only) + args `account_index:u16`, `third_party_id:option<u16>` — Ledger-SAFE | `dist/idl/marginfi_0.1.8.json` [VERIFIED] | If absent, MarginFi init would be infeasible on Ledger; it is PRESENT |
| V5 | MarginFi program ID = `MFv2hWf31Z9kbCa1snEPYctwafyhdvnV7FZnsebVacA`; production group = `4qp6Fx6tnZkY5Wropq9wUYgtFxXKwE6viZxFHg3rdAG8` | `dist/configs.json` + IDL `address` field (agree) [VERIFIED] | Wrong program ID → every MarginFi tx refused at dispatch / fails on-chain |
| V6 | `@kamino-finance/klend-sdk@8.0.2` is `@solana/kit`-native (`@solana/kit@^2.3.0`); codegen ix return kit `Instruction`/`Address`/`TransactionSigner` | `npm view` deps + `dist/@codegen/klend/instructions/*.d.ts` [VERIFIED] | Treating Kamino as web3.js-v1 → type errors at integration; the v1 binding can't consume kit `Instruction` directly |
| V7 | Kamino klend production program ID = `KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD` | `dist/@codegen/klend/programId.js` [VERIFIED]; staging `SLendK7ySfcEzyaFqy93gDnD3RtrpXJcnRwb6zFHJSh` is the non-prod variant — do NOT use | Wrong/staging program ID → dispatch refusal / on-chain failure |
| V8 | Kamino borrow/withdraw require in-tx `refreshReserve` (per reserve) + `refreshObligation` before the op; ordered | `dist/idl/klend.json` ix list + `@codegen` deposit/borrow accounts (`scopePrices`, `lendingMarketAuthority`) [VERIFIED-by-IDL]; standard Solend/Kamino price-staleness pattern [DOCUMENTED] | Missing refresh → on-chain "stale price" / "obligation stale" failure at execution |
| V9 | Kamino obligation setup = `initUserMetadata` THEN `initObligation` (seed-tagged PDA, `ObligationType.toPda(market,user)`) | `dist/@codegen/.../initObligation.d.ts` + `dist/utils/seeds.d.ts` (`userMetadataPda`, `ObligationType.toPda`) [VERIFIED] | Single-ix init would fail (obligation requires userMetadata to exist) |
| V10 | `@coral-xyz/anchor@0.30.1` `BorshInstructionCoder` available for D-01 hand-encode (no signer) | installed; `dist/cjs/coder/borsh/instruction.js` exports `BorshInstructionCoder` [VERIFIED] | D-01 fallback would be unimplementable; it is implementable |
| V11 | Ledger Solana app clear-signs only simple transfers/createAccount combos; Anchor lending ix → `6808`, needs blind-sign. No Solana program-ix CAL/ERC-7730 registry (Generic Parser is EVM-only) | Ledger support docs + app-solana README + WebSearch 2025 [DOCUMENTED] | Claiming clear-sign coverage would mis-set the LEDGER NOTICE (SC-7); default-to-blind-sign is the safe stance |
| V12 | Neither SDK nor `@coral-xyz/anchor` has install/preinstall/postinstall scripts; both SDKs >1yr old, healthy weekly downloads | `npm view scripts.*` empty; `time.created`; downloads API [VERIFIED] | Postinstall network/FS access would be a supply-chain risk; verified none |

---

## SCOPE-PROBE REPORT TABLE

| SDK | Version + key deps | Unsigned builders exist? | User-state artifacts | Per-op ceremony | Red flags tripped | Decision |
|-----|-------------------|--------------------------|----------------------|-----------------|-------------------|----------|
| `@mrgnlabs/marginfi-client-v2` | 6.4.2; `@solana/web3.js@^1.93.2`, `@coral-xyz/anchor@^0.30.1`, Switchboard + Pyth oracle deps | **YES** — `make{Init,InitPda,Deposit,Withdraw,Borrow,Repay}Ix → Promise<TransactionInstruction>` | `MarginfiAccount` PDA (per wallet, per group). Bank accounts (per asset). | deposit/repay = 1 ix; withdraw/borrow = op + `bank_liquidity_vault_authority` PDA. Health is read-side (no in-tx refresh). | (c) account-init signer variant IS Ledger-incompatible — BUT `_pda` sibling exists (Ledger-safe). (a) NO kit. (b) `make*Ix` are singular, not `buildXxxTxns` plural. | **cherry-pick-IDL** (hand-encode writes D-01; SDK decoders for reads D-02) |
| `@kamino-finance/klend-sdk` | 8.0.2; `@solana/kit@^2.3.0`, `@kamino-finance/scope-sdk`, `@kamino-finance/farms-sdk`, `@coral-xyz/anchor@^0.28.0`, `@solana-program/*` | **YES (but kit-typed)** — `@codegen/klend/instructions/*` return kit `Instruction`, NOT web3.js-v1 `TransactionInstruction` | `Obligation` PDA + `UserMetadata` PDA (per wallet). `Reserve` accounts (per asset). Scope oracle prices. Optional elevation groups / farms. | **deposit/borrow/withdraw/repay = multi-ix: `refreshReserve`×N + `refreshObligation` + op, ordered.** init = `initUserMetadata` + `initObligation`. | (a) **`@solana/kit` PRIMARY types — the 3-5× cost driver, CONFIRMED.** Obligation+UserMetadata 2-step init. Scope-oracle refresh. (b) codegen builders are kit `Instruction` (need `@solana/compat` OR raw IDL encode). | **cherry-pick-IDL** (hand-encode writes from IDL discriminators, bypass kit; SDK decoders for reads behind a kit→our-shape adapter) |

**Why D-01 hand-encode (not SDK builders) for BOTH writes:** even MarginFi's web3.js-v1 `make*Ix` route through a `MarginfiProgram` (Anchor `Program` instance) that wants a wallet/provider — and our codebase has NO provider and NO keypair by invariant. Hand-encoding from the IDL via `BorshInstructionCoder` (the SPL/system precedent in `solana-spl.ts` / `solana-system.ts`) gives a pure `(programId, keys, data)` → `TransactionInstruction` with zero provider/signer surface, identical to the existing Solana tools. For Kamino it ALSO sidesteps the entire `@solana/kit` impedance. This is exactly why D-01 was pre-locked.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| MarginFi/Kamino position reads | MCP server (`src/chains/solana/{marginfi,kamino}.ts`) | Solana RPC (`getAccountInfo` + `getMultipleAccounts`) | Decode-only; SDK decoders (D-02), no signing surface |
| Health-factor math | MCP server (`src/signing/{marginfi,kamino}-health.ts`) | — | Pure-bigint, deterministic, no RPC (mirrors `aave-health.ts`); re-derived on-chain-accurate (D-07) |
| Unsigned tx instruction build | MCP server (`src/protocols/{marginfi,kamino}.ts`) | Anchor IDL via `BorshInstructionCoder` | Hand-encode (D-01); program IDs from contracts SOT (D-05) |
| PDA-presence gate (D-03) | MCP server (tool handler) | Solana RPC `getAccountInfo` on derived PDA | Refuse-no-handle when absent; redirect to init tool |
| payloadFingerprint binding | MCP server (FROZEN `computeSolanaPayloadFingerprint`) | — | Reuse Phase 12 binding; `Transaction.serializeMessage()` bytes through unchanged |
| Dispatch allowlist (Layer 0.5) | MCP server (`canonical-dispatch-solana.ts`) | — | EXTEND existing base58 allowlist with new program IDs (D-06) |
| On-device trusted display | Ledger Solana app (the trust boundary) | — | Blind-sign for lending ix (no clear-sign CAL coverage — V11); conditional LEDGER NOTICE (SC-7) |

---

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@solana/web3.js` | `^1.98.4` (installed) | `Transaction`, `PublicKey`, `TransactionInstruction`, message-bytes serialization | Already the FROZEN binding layer; all new instructions assemble into the existing legacy-`Transaction` path |
| `@coral-xyz/anchor` | `0.30.1` | `BorshInstructionCoder` for D-01 hand-encode (instruction data from IDL, no signer) | The canonical Anchor IDL coder; **NEW dep — must be added** (not currently in package.json) |
| `@mrgnlabs/marginfi-client-v2` | `6.4.2` | MarginFi **account DECODERS only** (D-02): `MarginfiAccount.decodeAccountRaw` + `computeHealthComponents` math reference; IDL JSON source | Canonical MarginFi SDK; web3.js-v1-native (clean fit) |
| `@kamino-finance/klend-sdk` | `8.0.2` | Kamino **account DECODERS only** (D-02): `KaminoObligation`/`Reserve` decode + `loanToValue`/`liquidationThreshold` reference; IDL JSON + `utils/seeds` PDA helpers | Canonical Kamino klend SDK; kit-native (reads behind an adapter) |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `bn.js` | (transitive via both SDKs) | `BN` u64 amounts at the SDK decoder boundary | Only at the decoder seam — convert to `bigint` immediately (CLAUDE.md no-`number`-leak) |
| existing `src/signing/amount-solana.ts` | n/a | `parseSolanaAmountStrict(amount, decimals)` decimal-string → bigint | Every prepare tool's amount parse (reuse, do NOT re-implement) |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Hand-encode from IDL (D-01) | MarginFi `make*Ix` SDK builders directly | SDK builders need a `MarginfiProgram` (Anchor Program + provider) — we have no provider/keypair by invariant. Rejected per D-01. |
| Hand-encode Kamino from IDL | `@solana/compat` to convert kit `Instruction` → web3.js-v1 | Adds a kit runtime + per-call conversion + a second serialization model alongside the FROZEN v1 path. Hand-encode keeps ONE tx model. Rejected. |
| `marginfi_account_initialize_pda` (PDA) | `marginfi_account_initialize` (random Keypair) | Keypair variant is Ledger-INCOMPATIBLE (ephemeral signer). PDA variant is the only Ledger-safe path (D-03/V3/V4). |

**Installation:**
```bash
npm install @coral-xyz/anchor@0.30.1
npm install --save-dev @mrgnlabs/marginfi-client-v2@6.4.2 @kamino-finance/klend-sdk@8.0.2
```
*(SDKs are decode/reference-only per D-02 — the planner decides `dependencies` vs `devDependencies`; if the position-read tools import decoders at runtime, they belong in `dependencies`. `@coral-xyz/anchor` is a runtime `dependency` — the hand-encode path runs in production.)*

**Version verification (2026-06-03):**
- `@mrgnlabs/marginfi-client-v2` → `6.4.2` (latest), published 2026-06-03; created 2023-03-14; 6,103 dl/wk [VERIFIED: npm registry]
- `@kamino-finance/klend-sdk` → `8.0.2` (latest), published 2026-06-02; created 2024-04-30; 16,464 dl/wk [VERIFIED: npm registry]
- `@coral-xyz/anchor` → `0.30.1` (installed; matches MarginFi's pin) [VERIFIED: installed]

---

## Package Legitimacy Audit

> slopcheck was **unavailable** at research time (sandbox classifier blocked the undeclared pip install — expected, documented graceful-degradation path). Per protocol, all externally-installed packages are tagged `[ASSUMED]` and the planner MUST gate each install behind a `checkpoint:human-verify` task. The registry/repo/postinstall checks below are the safe substitute evidence and all PASS.

| Package | Registry | Age | Downloads | Source Repo | postinstall | slopcheck | Disposition |
|---------|----------|-----|-----------|-------------|-------------|-----------|-------------|
| `@mrgnlabs/marginfi-client-v2` | npm | ~3.2 yrs (2023-03-14) | 6,103/wk | mrgnlabs/marginfi-v2 (org-scoped) | none | unavailable → `[ASSUMED]` | Approved — gate behind checkpoint |
| `@kamino-finance/klend-sdk` | npm | ~1.1 yrs (2024-04-30) | 16,464/wk | github.com/Kamino-Finance/klend-sdk | none | unavailable → `[ASSUMED]` | Approved — gate behind checkpoint |
| `@coral-xyz/anchor` | npm | mature (Anchor framework) | (high) | coral-xyz/anchor | none | unavailable → `[ASSUMED]` | Approved — gate behind checkpoint; pin to `0.30.1` (MarginFi's pin) |

**Packages removed due to slopcheck [SLOP] verdict:** none (slopcheck unavailable).
**Packages flagged [SUS]:** none from the safe checks. **Cross-ecosystem note:** the deprecated Kamino name `@hubbleprotocol/kamino-lending-sdk` (last pub 2024-12) is NOT the current package — do NOT install it; the current name is `@kamino-finance/klend-sdk`.
**Postinstall safety:** all three packages have empty `scripts.{pre,post,}install` — no install-time code execution [VERIFIED].

---

## Architecture Patterns

### System Architecture Diagram

```
agent (Claude Code / Cursor / Desktop)
   │  prepare_marginfi_supply / prepare_kamino_borrow / ..._account_init / ..._obligation_init
   ▼
┌──────────────────────────── vaultpilot-mcp (Phase 13 additions) ────────────────────────────┐
│                                                                                              │
│  tool handler (clone of prepare_solana_spl_send.ts)                                          │
│    ├─ demo-persona FIRST refusal  →  input validation (base58 / amount)  →  pairing check    │
│    ├─ resolve program IDs + PDAs from  src/config/contracts.ts (SOLANA_CONTRACTS)  ◄─ D-05   │
│    ├─ DERIVE per-wallet PDA (MarginfiAccount / Obligation) via SDK seeds helper              │
│    ├─ RPC getAccountInfo(PDA)  ──absent──►  REFUSE (solanaErrorCode VP_S0xx, NO handle) ◄ D-03│
│    │                            └─present─►  proceed                                          │
│    ├─ build instructions  ──────────────────────────────────────────────────────────────┐   │
│    │     src/protocols/marginfi.ts  (BorshInstructionCoder, IDL discriminators)  ◄─ D-01  │   │
│    │     src/protocols/kamino.ts    (refreshReserve×N + refreshObligation + op, ordered)  │   │
│    │     → assemble into legacy  Transaction  (feePayer, recentBlockhash)                  │   │
│    ├─ messageBytes = Transaction.serializeMessage()  ─────────────────────────────────────┘   │
│    ├─ payloadFingerprint = computeSolanaPayloadFingerprint({messageBytes})  ◄─ FROZEN (Ph12)  │
│    ├─ createHandle({ args RAW, tx { txType:"solana", messageBytes, programIds, … } })          │
│    └─ return { handle, …, payloadFingerprint, txType:"solana" } + PREPARE RECEIPT + LEDGER NOTICE│
│                                                                                              │
│  reads:  get_marginfi_positions / get_kamino_positions                                       │
│    └─ src/chains/solana/{marginfi,kamino}.ts  →  SDK decoders (D-02)                          │
│         →  src/signing/{marginfi,kamino}-health.ts  (pure-bigint health)  ◄─ D-07            │
│                                                                                              │
│  preview_send (Solana branch, Phase 12)  →  Layer 0.5 checkSolanaDispatchTarget(programIds)   │
│       against EXTENDED SOLANA_DISPATCH_ALLOWLIST  ◄─ D-06 (SOL-W-09)                          │
└──────────────────────────────────────────────────────────────────────────────────────────────┘
   │  USB-HID (Phase 12 transport)
   ▼
Ledger Solana app  →  BLIND-SIGN (no clear-sign CAL for lending ix — V11)  →  device screen (trust boundary)
```

### Recommended Project Structure (additions only)
```
src/
├── config/contracts.ts            # ADD SolanaContracts sub-table + getters (D-05) — 13-01
├── security/canonical-dispatch-solana.ts  # EXTEND SOLANA_DISPATCH_ALLOWLIST (D-06) — 13-01
├── protocols/
│   ├── marginfi.ts                # NEW — IDL hand-encode + _marginfi indirection — MarginFi write plan
│   └── kamino.ts                  # NEW — IDL hand-encode + refresh ceremony + _kamino indirection — Kamino write plan
├── chains/solana/
│   ├── marginfi.ts                # NEW — MarginfiAccount decode + PDA presence read (D-02)
│   └── kamino.ts                  # NEW — Obligation/Reserve decode (kit→shape adapter) + PDA presence read (D-02)
├── signing/
│   ├── marginfi-health.ts         # NEW — pure-bigint risk-weighted health (D-07)
│   └── kamino-health.ts           # NEW — pure-bigint per-reserve-LTV health (D-07)
└── tools/
    ├── get_marginfi_positions.ts          get_kamino_positions.ts
    ├── prepare_marginfi_account_init.ts   prepare_kamino_obligation_init.ts
    ├── prepare_marginfi_{supply,withdraw,borrow,repay}.ts
    └── prepare_kamino_{supply,withdraw,borrow,repay}.ts
```

### Pattern 1: Hand-encode an Anchor instruction from IDL (D-01)
**What:** Build a `TransactionInstruction` with no provider/signer, from the IDL discriminator + Borsh-encoded args + ordered account metas.
**When to use:** Every `prepare_marginfi_*` / `prepare_kamino_*` write.
**Example:**
```typescript
// Source: @coral-xyz/anchor BorshInstructionCoder + dist/idl/marginfi_0.1.8.json (installed probe)
import { BorshInstructionCoder } from "@coral-xyz/anchor";
import { PublicKey, TransactionInstruction } from "@solana/web3.js";
import marginfiIdl from "...marginfi_0.1.8.json"; // vendored copy — IDL is the encoding SOT (D-01)

const coder = new BorshInstructionCoder(marginfiIdl as any);
// data = 8-byte discriminator + borsh(args). MarginFi 0.1.8 pins discriminators as byte arrays;
// BorshInstructionCoder.encode("lending_account_deposit", { amount, deposit_up_to_limit: null })
// reproduces them. Kamino IDL is legacy-Anchor → discriminator = sha256("global:depositReserve…")[..8]
// (or read the @codegen DISCRIMINATOR const) — verify byte-identity in a pinned fixture.
const data = coder.encode("lending_account_deposit", { amount, depositUpToLimit: null });

const ix = new TransactionInstruction({
  programId: getMarginfiProgramId(),          // from contracts SOT (D-05) — NEVER inlined
  keys: [ /* group, marginfiAccount[W], authority[S], bank[W], signerTokenAccount[W], liquidityVault[W], tokenProgram */ ],
  data,
});
// → assemble into legacy Transaction (feePayer + recentBlockhash) exactly like solana-spl.ts buildSplTransferTx
```

### Pattern 2: Kamino in-tx refresh ceremony (V8)
**What:** Borrow/withdraw txs MUST carry `refreshReserve` (one per reserve touched) + `refreshObligation` immediately BEFORE the op instruction, in that order.
**When to use:** Every Kamino write that reads collateral value (borrow, withdraw; deposit/repay touch the obligation too).
**Example:**
```
instructions = [
  refreshReserve(collateralReserve),   // Scope/Pyth/Switchboard oracle price refresh
  refreshReserve(borrowReserve),       // one per distinct reserve in the obligation
  refreshObligation(obligation),       // recompute deposited/borrowed value
  borrowObligationLiquidity(...),      // the actual op
]
```
**Why load-bearing:** the on-chain program rejects an op against a stale obligation/reserve ("price too old" / "obligation stale"). This is the single biggest correctness gap vs the simple SPL-transfer pattern — a Phase 13 Kamino fixture MUST anchor the full ordered instruction vector, not just the op ix.

### Pattern 3: PDA-presence gate → refuse-no-handle (D-03/D-04)
**What:** Before minting a handle, derive the per-wallet PDA, RPC `getAccountInfo`; absent → structured refusal with NO handle, redirect to init tool.
**Example:** Mirror Phase 44 `prepare_solana_nonce_close.ts` authority gate exactly — same `solanaErrorCode` local-constant + dual `errorCode`/`solanaErrorCode` field shape, no handle on refusal.
```typescript
const SOLANA_MARGINFI_ACCOUNT_ABSENT = "VP_S006" as const; // local const (NOT a registry — D-04)
// derive MarginfiAccount PDA (account_index seed) → getAccountInfo → null:
return errEnvelopeWith({ errorCode: "INVALID_INPUT", solanaErrorCode: SOLANA_MARGINFI_ACCOUNT_ABSENT,
  message: "no MarginfiAccount for this wallet — call prepare_marginfi_account_init first" });
// NO createHandle() reached.
```
*(Next free VP_S0xx codes: Phase 44 used VP_S005. Phase 13 takes VP_S006+. Confirm against `grep -rn "VP_S0" src/` at plan time.)*

### Anti-Patterns to Avoid
- **Using the MarginFi/Kamino SDK builders directly** — they want an Anchor `Program`/provider; we have none. Hand-encode (D-01).
- **Using `marginfi_account_initialize` (the Keypair-signer variant)** — Ledger-incompatible. Use `marginfi_account_initialize_pda` (V3/V4).
- **Converting Kamino kit `Instruction` via `@solana/compat` into the tx path** — introduces a parallel serialization model beside the FROZEN v1 binding. Hand-encode from IDL instead.
- **Auto-bundling account-init into the first supply tx** — violates D-03 (one device screen = one intent).
- **Omitting Kamino's refresh ceremony** — silent on-chain failure at execution; the simulate gate (Layer 0.7) may catch it but the tx should be correct by construction.
- **Inlining program/market addresses** — CLAUDE.md SOT; route through `contracts.ts` (D-05).
- **Claiming clear-sign coverage in the LEDGER NOTICE** — there is no Solana lending CAL (V11); default to the blind-sign NOTICE.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Anchor instruction data encoding | Manual borsh + sha256 discriminator | `@coral-xyz/anchor` `BorshInstructionCoder.encode` | Discriminator + arg layout from IDL; hand-borsh is the classic off-by-one |
| MarginfiAccount / Obligation decode | Manual buffer slicing | SDK `decodeAccountRaw` / `KaminoObligation` (D-02) | Account layouts are large + versioned; SDK tracks IDL bumps |
| PDA derivation (MarginfiAccount, Obligation, UserMetadata) | Manual `findProgramAddressSync` with guessed seeds | SDK `utils/seeds` (`userMetadataPda`, `ObligationType.toPda`) + MarginFi account-index seed | Seed order/tag is easy to get wrong (same lesson as the SPL ATA rule in `solana-spl.ts`) |
| Health-factor math | — (this IS the build, D-07) | re-derive on-chain-accurate, pure-bigint, mirror `aave-health.ts` | D-07 requires re-derivation, not approximation; SDK math (`computeHealthComponents`, `loanToValue`) is the REFERENCE to verify against, not imported |
| payloadFingerprint / presign-hash | new binding math | FROZEN `computeSolanaPayloadFingerprint` (Phase 12) | DF-1/DF-2 LOCKED; new tx shapes pass `serializeMessage()` bytes through unchanged |

**Key insight:** This phase is "assemble known pieces" — the IDL coder, the SDK decoders, the FROZEN binding, the existing prepare-tool shell — NOT "invent new crypto." The only genuinely new logic is the two health modules (D-07) and Kamino's refresh-ceremony ordering.

---

## Health Math (D-07)

### MarginFi — risk-weighted asset/liability (re-derive pure-bigint into `src/signing/marginfi-health.ts`)
**Reference (verify against, do NOT import):** SDK `MarginfiAccount.computeHealthComponents(marginReqType) → { assets, liabilities }`.
- **Formula:** `assets = Σ (bankAssetQuantity_i × oraclePrice_i × assetWeight_i)`; `liabilities = Σ (bankLiabQuantity_j × oraclePrice_j × liabilityWeight_j)`. **Solvent at maintenance when `assets ≥ liabilities`.** A "health-factor-equivalent" for display = `assets / liabilities` (SOL-W-03 says "health-factor-equivalent" — surface this ratio; ≥1 safe at the chosen margin type).
- **Weights:** per-bank `assetWeightInit` / `assetWeightMaint` and `liabilityWeightInit` / `liabilityWeightMaint` (Bank config), plus a `riskTier` (`Collateral` vs `Isolated`) modifier — Isolated-tier assets get 0 asset-weight as collateral. Use **Maintenance** weights for the liquidation-risk surface (Init weights gate new borrows).
- **Fixed-point:** MarginFi stores weights/prices as `WrappedI80F48` (signed 80.48 fixed-point). The SDK lifts to `decimal.js` `BigNumber`. Our pure-bigint module must replicate the I80F48 scale (`2^48` fractional) deterministically — pin the scale constant as a fixture literal (CLAUDE.md cryptographic-fixture discipline applies to health-math anchors too).
- **Oracle staleness:** banks carry `oracleMaxAge` + `oracleMaxConfidence`; a stale/over-confidence oracle invalidates the price. For READS, surface the staleness rather than throwing (mirror Aave's `userEModeCategoryId` verbatim-surface caveat).

### Kamino — per-reserve LTV / liquidation-threshold (re-derive into `src/signing/kamino-health.ts`)
**Reference:** SDK `KaminoObligation.loanToValue(): Decimal` + per-`Reserve` `loanToValue` (borrow LTV) and `liquidationThreshold`.
- **Formula:** `borrowPower = Σ (depositValue_i × reserve.loanToValue_i)`; `liquidationLine = Σ (depositValue_i × reserve.liquidationThreshold_i)`; `borrowedValue = Σ borrowedValue_j`. **LTV = borrowedValue / depositValue**; healthy while `borrowedValue ≤ liquidationLine`. Display ratio = `borrowedValue / liquidationLine` (>1 = liquidatable) OR a health factor `liquidationLine / borrowedValue` (mirror Aave's `weightedLT / debt` shape for cross-protocol display consistency).
- **Per-reserve params** come off each `Reserve` config (bps-scaled, like Aave). Distinct from MarginFi's per-bank asset/liability *weights* — Kamino uses the Solend-lineage LTV/liq-threshold model.
- **Scope oracle:** values are priced via the Scope oracle (`scopePrices`); the SDK resolves these. For health DISPLAY the decoder gives priced positions; for the TX build the refresh ceremony (Pattern 2) re-prices on-chain.
- **Elevation groups:** an obligation in an elevation group uses group-specific LTVs. v2.0 surfaces the base reserve LTV and the `elevationGroup` id verbatim (deferred deep-handling per CONTEXT deferred-ideas E-mode parallel).

**Both health modules:** pure functions, NO RPC, NO module-load state, bigint-only (no `Number`/float), with a pinned deterministic input→expected-output fixture anchor (verify-phase cross-checks against the SDK's `computeHealthComponents` / `loanToValue` on a real obligation). Mirror `aave-health.ts` shape: `compute*Health(input) → { ..., noDebt, healthRatioScaled }` + a `classify*Risk` band.

---

## Contracts SOT (D-05) — `src/config/contracts.ts` Solana sub-table

Follow the established **sibling-sub-table** pattern (Compound/Morpho/Lido/EigenLayer/Uniswap/Curve all do this — NOT a widening of EVM `ContractsForChain`). Base58 strings, NO `getAddress`/EIP-55 wrap (that's EVM-only). Suggested shape:

```typescript
// Solana lending program IDs + market/group anchors. base58 — NO EIP-55 normalization.
export interface SolanaContracts {
  marginfiProgram: string;       // MFv2hWf31Z9kbCa1snEPYctwafyhdvnV7FZnsebVacA   [VERIFIED: SDK configs + IDL]
  marginfiGroup: string;         // 4qp6Fx6tnZkY5Wropq9wUYgtFxXKwE6viZxFHg3rdAG8 (production group) [VERIFIED: SDK configs]
  kaminoLendProgram: string;     // KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD  [VERIFIED: SDK @codegen/programId]
  kaminoMainMarket: string;      // ⚠ NOT an SDK constant — see Open Question Q1 (verify before locking)
}
const SOLANA_CONTRACTS_RAW: Record<"solana", SolanaContracts> = { solana: { /* … */ } };
export function getMarginfiProgramId(): string { return SOLANA_CONTRACTS_RAW.solana.marginfiProgram; }
// … getMarginfiGroup, getKaminoLendProgram, getKaminoMainMarket
// PDA-derivation helpers live here too (D-05): deriveMarginfiAccountPda(authority, accountIndex),
// deriveKaminoObligationPda(market, owner) — thin wrappers over the SDK seeds helpers.
```

Regression test (SOL-W-10): assert program-ID byte-identity + a `grep -rn "MFv2hWf31\|KLend2g3" src/` outside this file is empty (format-fanout-sentinel, matching the Compound/Morpho address-inline regression).

**Canonical-dispatch extension (D-06 / SOL-W-09):** EXTEND the EXISTING `SOLANA_DISPATCH_ALLOWLIST` in `canonical-dispatch-solana.ts` (already wired into preview Layer 0.5). Add `marginfiProgram`, `kaminoLendProgram`, and — critically — the **auxiliary programs the lending txs touch**: Scope oracle program, Pyth receiver, Switchboard (Kamino refresh), Kamino farms program (if farm-state ix present). The allowlist is over ALL `programIds` in the message; missing an oracle-refresh program ID → false dispatch refusal. Enumerate the touched-program set from the actual built instruction vector, not just the lending program. Build the allowlist by mapping the SOT getters (mirror Compound's `getAllCompoundCometsForChain` → dispatch auto-extension pattern).

---

## Conditional LEDGER NOTICE (SC-7 / V11)

**Finding (DOCUMENTED, HIGH confidence):** The Ledger Solana app clear-signs only simple transfers / `createAccount`+transfer combos. MarginFi and Kamino instructions are Anchor program instructions and will trigger a `6808` device error unless the user has **blind-signing enabled** in the Solana app settings. Ledger's 2025 ERC-7730 Generic Parser is **EVM-only** — there is no Solana program-instruction clear-signing registry (no CAL coverage for MarginFi/Kamino).

**Action:** Every `prepare_marginfi_*` / `prepare_kamino_*` response emits the conditional **LEDGER NOTICE blind-sign block** (mirror the Phase 6 `WETH9.withdraw` blind-sign-notice pattern, reusing the FROZEN `blocks-solana.ts` LEDGER NOTICE template). The NOTICE must: (1) state the device shows an undecoded instruction, (2) tell the user to verify the decoded args in the PREPARE RECEIPT / CHECKS PERFORMED against what the agent claims, (3) note blind-signing must be enabled. Do NOT claim clear-sign coverage. This is the rnd Rule 4 default-to-blind-sign-when-uncertain stance — and here it's not uncertain, it's confirmed.

---

## Common Pitfalls

### Pitfall 1: Kamino kit-instruction type leakage into the v1 tx path
**What goes wrong:** Importing a Kamino `@codegen` builder and `tx.add()`-ing its return into a web3.js-v1 `Transaction` — type error or runtime shape mismatch.
**Why:** klend-sdk builders emit `@solana/kit` `Instruction`, not v1 `TransactionInstruction`.
**Avoid:** Hand-encode from the IDL (D-01) so the output is a native v1 `TransactionInstruction`. Keep `@solana/kit` out of the write path entirely.

### Pitfall 2: Missing Kamino refresh ceremony
**What goes wrong:** A borrow/withdraw tx with only the op instruction passes prepare + dispatch but fails on-chain ("stale obligation/reserve").
**Avoid:** Pattern 2 — prepend `refreshReserve`×N + `refreshObligation`. Anchor the full ordered instruction vector in the Kamino fixture.

### Pitfall 3: Wrong MarginFi account-init variant
**What goes wrong:** Using `marginfi_account_initialize` (Keypair-signer) → unsignable on Ledger.
**Avoid:** `marginfi_account_initialize_pda` (PDA, authority-only signer). Args: `account_index: u16`, `third_party_id: option<u16>`. Derive the PDA from the account-index seed.

### Pitfall 4: Health-math fixed-point drift
**What goes wrong:** MarginFi I80F48 (2^48) and Kamino bps/Decimal scales differ; a wrong scale constant silently mis-displays liquidation risk (a trust surface, D-07).
**Avoid:** Pin scale constants as fixture literals; deterministic input→output anchor; verify-phase cross-check against the SDK math on a real position.

### Pitfall 5: Auxiliary program IDs absent from the dispatch allowlist
**What goes wrong:** Kamino refresh touches Scope/Pyth/Switchboard programs; if only `kaminoLendProgram` is allowlisted, the tx is falsely refused at Layer 0.5.
**Avoid:** Enumerate ALL touched program IDs into the allowlist (D-06 § Contracts SOT note).

### Pitfall 6: `bigint` vs `BN`/`Number` leak at the decoder boundary
**What goes wrong:** SDK decoders return `BN` / `decimal.js` `BigNumber`; leaking those (or `Number`) downstream violates CLAUDE.md decimal-string-at-the-boundary.
**Avoid:** Convert to `bigint` (amounts) / decimal-string (display) immediately at the `chains/solana/{marginfi,kamino}.ts` seam.

---

## Runtime State Inventory

> Phase 13 is **additive greenfield** (new tools + new files + additive SOT/dispatch/register-all appends). No rename/refactor/migration. Inventory included for completeness.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | None — no existing datastore keys reference MarginFi/Kamino. Per-wallet PDAs are derived on-chain, not stored locally. | None — verified by absence of any local lending state. |
| Live service config | None — no external dashboards/services keyed on this work. | None. |
| OS-registered state | None. | None. |
| Secrets/env vars | None new — Solana RPC URL config is reused from Phase 11/12 (`_solanaRegistry`). | None. |
| Build artifacts | New `@coral-xyz/anchor` + 2 SDK deps in `package.json`/lockfile. Vendored IDL JSON copies (if not importing from node_modules). | `npm install` after the SOT/dep plan; commit lockfile. |

---

## Code Examples

### MarginFi instruction account ordering (from IDL marginfi_0.1.8.json — VERIFIED)
```
lending_account_deposit  disc [171,94,235,103,82,64,212,140]
  accounts: group, marginfi_account[W], authority[S], bank[W], signer_token_account[W], liquidity_vault[W], token_program
  args: { amount: u64, deposit_up_to_limit: option<bool> }
lending_account_withdraw disc [36,72,74,19,210,210,192,192]
  accounts: group, marginfi_account[W], authority[S], bank[W], destination_token_account[W], bank_liquidity_vault_authority[PDA], liquidity_vault[W], token_program
  args: { amount: u64, withdraw_all: option<bool> }
lending_account_borrow   disc [4,126,116,53,48,5,212,31]
  accounts: group, marginfi_account[W], authority[S], bank[W], destination_token_account[W], bank_liquidity_vault_authority[PDA], liquidity_vault[W], token_program
  args: { amount: u64 }
lending_account_repay    disc [79,209,172,177,222,51,173,151]
  accounts: group, marginfi_account[W], authority[S], bank[W], signer_token_account[W], liquidity_vault[W], token_program
  args: { amount: u64, repay_all: option<bool> }
marginfi_account_initialize_pda disc [87,177,91,80,218,119,245,31]   ◄ Ledger-safe init
  accounts: marginfi_group, marginfi_account[PDA][W], authority[S], fee_payer[S][W], instructions_sysvar, system_program
  args: { account_index: u16, third_party_id: option<u16> }
```
*(Source: `dist/idl/marginfi_0.1.8.json` from the throwaway install. The SDK 6.4.2 `instructions.d.ts` `makeDepositIx` etc. mark `group?`/`authority?`/`liquidityVault?` optional — IDL-vs-SDK skew; the IDL is the encoding SOT per D-01. Pin the discriminators + account order as fixtures; re-verify the IDL version at plan time — MarginFi ships 0.1.4/0.1.5/0.1.7/0.1.8 IDLs side-by-side.)*

### Kamino instruction account ordering (from IDL klend.json — VERIFIED)
```
initObligation   args {InitObligationArgs}  accts: obligationOwner[S], feePayer[S], obligation, lendingMarket, seed1Account, seed2Account, ownerUserMetadata, rent, systemProgram
initUserMetadata args {userLookupTable: pubkey}  accts: owner[S], feePayer[S], userMetadata, referrerUserMetadata, rent, systemProgram
refreshReserve   accts: reserve, lendingMarket, pythOracle, switchboardPriceOracle, switchboardTwapOracle, scopePrices
refreshObligation accts: lendingMarket, obligation
depositReserveLiquidityAndObligationCollateral  args {liquidityAmount: u64}  (14 accts incl. lendingMarketAuthority, reserve*, instructionSysvarAccount)
borrowObligationLiquidity  args {liquidityAmount: u64}  (12 accts incl. borrowReserveLiquidityFeeReceiver, referrerTokenState, instructionSysvarAccount)
repayObligationLiquidity   args {liquidityAmount: u64}  (9 accts)
withdrawObligationCollateralAndRedeemReserveCollateral  args {collateralAmount: u64}  (14 accts)
```
*(Source: `dist/idl/klend.json` (program version 1.22.0) + `dist/@codegen/klend/instructions/*.d.ts`. Discriminators are NOT in the legacy-Anchor IDL JSON — compute via `sha256("global:<ixName>")[..8]` or read the codegen `DISCRIMINATOR` const; pin as fixture. NOTE the `V2` variants exist — v2.0 uses the base variants unless a farm-state account forces V2; confirm at plan time which the live main-market reserves require.)*

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `@hubbleprotocol/kamino-lending-sdk` | `@kamino-finance/klend-sdk` | rebrand 2024 | Use the `@kamino-finance` package; the hubbleprotocol one is stale (last pub 2024-12) |
| web3.js v1 Kamino SDK | `@solana/kit`-native klend-sdk 8.x | klend-sdk major bumps through 2025-2026 | Kamino SDK no longer drops into a v1 tx path without compat — hand-encode (D-01) sidesteps |
| Per-dApp Ledger plugins | ERC-7730 Generic Parser | 2025 | **EVM-only** — does NOT bring Solana lending clear-signing; blind-sign remains for Solana Anchor ix |

**Deprecated/outdated:**
- MarginFi `MarginfiAccount.decode(encoded, idl)` → `@deprecated`, use `decodeAccountRaw`.
- MarginFi `computeHealthComponentsLegacy` (takes `Map<Bank>`/`Map<OraclePrice>`) → use `computeHealthComponents(marginReqType)` as the math reference.

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | All 3 external packages safe to install (slopcheck unavailable → tagged `[ASSUMED]`) | Package Legitimacy Audit | Supply-chain risk — mitigated: registry-age + repo + empty-postinstall checks all pass; planner gates each behind `checkpoint:human-verify` |
| A2 | Kamino `refreshReserve`+`refreshObligation` ordering is required before every value-reading op | Pattern 2 / Pitfall 2 | If under/over-specified, tx fails on-chain (Layer 0.7 simulate would catch) — VERIFIED structurally from IDL accounts (Scope/oracle in refresh) + DOCUMENTED Solend/Kamino convention; confirm exact set per-op at plan/build time |
| A3 | MarginFi health uses Maintenance weights for the liquidation-risk display surface | Health Math | Wrong margin-type → mis-banded risk; verify against `computeHealthComponents(MarginRequirementType.Maintenance)` at verify-phase |
| A4 | Kamino `V2` instruction variants are only needed when a farm-state account is present; base variants suffice for v2.0 | Code Examples (Kamino) | If the live main-market reserves require V2, the base-variant tx fails — confirm which the target reserves use at build time |
| A5 | The live main-market reserves the user transacts against are reachable without elevation-group handling for v2.0 | Health Math (Kamino) | Elevation-group obligations use different LTVs; v2.0 surfaces base LTV + group id verbatim (deferred deep-handling) |

---

## Open Questions (RESOLVED)

1. **Kamino main-market lending-market address for the SOT.**
   - What we know: program ID is `KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD` [VERIFIED]. The klend-sdk does NOT export a `MAIN_MARKET` constant — the lending-market is a runtime arg / per-deployment account.
   - What's unclear: the canonical mainnet main-market `lendingMarket` pubkey (commonly cited as `7u3HeHxYDLhnCoErrtycNokbQYbWGzLs6JSDqGAv5BWE` in Kamino docs/UI) — NOT confirmable in this sandbox without a doc fetch / live read (live RPC is forbidden).
   - **RESOLVED (13-01-PLAN, Task 2):** main-market `lendingMarket` = `7u3HeHxYDLhnCoErrtycNokbQYbWGzLs6JSDqGAv5PfF` (ends `…PfF`), verified at the plan gate from TWO authoritative sources — the live Kamino market API (`isPrimary:true`) and the klend-sdk README example. The `…BWE` cited above was a transcription typo. Pinned in the `SOLANA_CONTRACTS_RAW` SOT (never inlined); re-verify if stale at verify-phase.

2. **MarginFi IDL version to vendor (0.1.4 / 0.1.5 / 0.1.7 / 0.1.8).**
   - What we know: the SDK 6.4.2 ships four IDL JSONs side-by-side; 0.1.8 has the `marginfi_account_initialize_pda` ix + the deposit/withdraw/borrow/repay discriminators used above.
   - **RESOLVED (13-01-PLAN, Task 2):** vendor `marginfi_0.1.8.json` (latest; carries `marginfi_account_initialize_pda` + the deposit/withdraw/borrow/repay discriminators; matches the deployed `MFv2hW…` program). Re-verify the deployed IDL version at verify-phase (a program upgrade could bump it).

3. **`dependencies` vs `devDependencies` for the two SDKs.**
   - **RESOLVED (13-01-PLAN, Task 2):** `dependencies` — `get_*_positions` import the SDK decoders at runtime (D-02). The three packages (`@coral-xyz/anchor@0.30.1`, `@mrgnlabs/marginfi-client-v2@6.4.2`, `@kamino-finance/klend-sdk@8.0.2`) install behind the T-13-SC `checkpoint:human-verify` gate.

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| `@solana/web3.js` | binding + tx assembly | ✓ | 1.98.4 | — |
| `@coral-xyz/anchor` | D-01 hand-encode (BorshInstructionCoder) | ✗ (not installed) | needs `0.30.1` | none — install required (probed working in throwaway) |
| `@mrgnlabs/marginfi-client-v2` | MarginFi decoders (D-02) | ✗ (not installed) | needs `6.4.2` | hand-decode from IDL (heavier) |
| `@kamino-finance/klend-sdk` | Kamino decoders (D-02) | ✗ (not installed) | needs `8.0.2` | hand-decode from IDL (heavier) |
| Solana RPC (`_solanaRegistry`) | PDA-presence reads + position reads + blockhash | ✓ (reused from Ph11/12) | — | — |
| Ledger Solana app (USB-HID) | sign (verify-phase only) | n/a (verify-phase, physical) | — | blind-sign enabled |

**Missing dependencies with no fallback:** `@coral-xyz/anchor` (the D-01 path requires it). **Missing with fallback:** the two SDKs (hand-decode from IDL is a heavier fallback). **Live-RPC constraint honored:** no `Connection` opened during research (npm install + `.d.ts`/IDL read + WebFetch only).

---

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest `^2.1.0` |
| Config file | (repo root vitest config; `test/` dir) |
| Quick run command | `npx vitest run test/prepare-marginfi-supply.test.ts -t "<name>"` |
| Full suite command | `npx vitest run` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| SOL-W-03 | MarginFi positions decode + health-equivalent | unit | `npx vitest run test/get-marginfi-positions.test.ts` | ❌ Wave 0 |
| SOL-W-04 | MarginFi supply/withdraw/borrow/repay unsigned ix + fingerprint | unit | `npx vitest run test/prepare-marginfi-*.test.ts` | ❌ Wave 0 |
| SOL-W-05 | MarginFi account-init PDA tool (+ refuse-no-handle on supply when absent) | unit | `npx vitest run test/prepare-marginfi-account-init.test.ts` | ❌ Wave 0 |
| SOL-W-06 | Kamino positions decode + per-vault health | unit | `npx vitest run test/get-kamino-positions.test.ts` | ❌ Wave 0 |
| SOL-W-07 | Kamino supply/withdraw/borrow/repay unsigned ix (+ refresh ceremony) | unit | `npx vitest run test/prepare-kamino-*.test.ts` | ❌ Wave 0 |
| SOL-W-08 | Kamino obligation-init (initUserMetadata + initObligation) | unit | `npx vitest run test/prepare-kamino-obligation-init.test.ts` | ❌ Wave 0 |
| SOL-W-09 | Extended Solana dispatch allowlist refuses unknown program ID | unit | `npx vitest run test/canonical-dispatch-solana.test.ts` | ⚠ extend existing |
| SOL-W-10 | Solana contracts SOT regression (program-ID byte-identity + no-inline grep) | unit | `npx vitest run test/config-contracts.test.ts` | ⚠ extend existing |

### Sampling Rate
- **Per task commit:** targeted `npx vitest run test/<file>.test.ts`
- **Per wave merge:** `npx vitest run test/prepare-marginfi-*.test.ts` (or `-kamino-`)
- **Phase gate:** full `npx vitest run` green + FROZEN zero-diff gate (`git diff origin/main -- src/signing/payload-fingerprint-solana.ts src/signing/presign-hash-solana.ts` empty) before `/gsd-verify-work`

### Wave 0 Gaps
- [ ] `test/signing-fingerprint-solana.test.ts` — ADD fixtures for new tx shapes (MarginFi deposit/withdraw/borrow/repay/init; Kamino deposit/borrow/repay/withdraw/obligation-init) as hardcoded `0x…` literals (next free letters after M/N — confirm at plan time; NO beforeAll-snapshot, per CLAUDE.md)
- [ ] `test/signing-marginfi-health.test.ts` + `test/signing-kamino-health.test.ts` — deterministic input→expected-output anchors + scale-constant literals (D-07)
- [ ] `test/prepare-marginfi-*.test.ts` / `test/prepare-kamino-*.test.ts` — per-tool consumer tests (handle/receipt/no-handle-on-refusal/dispatch)
- [ ] Framework install: `npm install @coral-xyz/anchor@0.30.1` (+ SDK decoders) — gated behind `checkpoint:human-verify` per Package Legitimacy Audit

---

## Security Domain

### Applicable ASVS Categories
| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | No user auth; Ledger device is the signer |
| V3 Session Management | no | — |
| V4 Access Control | yes | PDA-presence + authority binding (D-03/D-04); per-wallet obligation scoping (mirror Phase 44 authority gate) |
| V5 Input Validation | yes | base58 pubkey regex + `parseSolanaAmountStrict` decimal parse (reuse existing) |
| V6 Cryptography | yes | FROZEN `computeSolanaPayloadFingerprint` binding (DF-1 LOCKED) — NEVER re-implement; new tx shapes pass `serializeMessage()` bytes through |

### Known Threat Patterns for Solana-lending tx-build
| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Agent supplies a non-MarginFi/Kamino program ID | Tampering / Elevation | Layer 0.5 base58 dispatch allowlist refusal (D-06, SOL-W-09) |
| Tampered message bytes between prepare + send | Tampering | payloadFingerprint re-check at send (FROZEN); drift → structured refusal |
| Blind-sign opacity (no clear-sign CAL) | Spoofing (device shows undecoded ix) | Conditional LEDGER NOTICE (V11/SC-7) + decoded args in PREPARE RECEIPT for user cross-check |
| Auto-bundled account-init hides a second intent | Repudiation / opacity | D-03 hard-refuse-no-handle → two separately-approved txs, one intent per device screen |
| Stale-oracle health mis-display | Information disclosure (false safety) | On-chain-accurate health (D-07) + surface oracle staleness; in-tx refresh ceremony (Kamino) |
| Inlined/wrong program or market address | Tampering | contracts SOT (D-05) + format-fanout-sentinel regression (SOL-W-10) |

---

## Proposed Plan Structure (recommendation — planner decides)

**6 plans** (rejecting the roadmap's 4-plan "10-tools-in-one" 13-04). Sequenced MarginFi-first (lowest risk), Kamino-second (kit-impedance isolated). The three shared-append hot spots (`contracts.ts`, `canonical-dispatch-solana.ts`, `register-all.ts`) are all touched in 13-01 then appended additively per later plan — same serialize-on-shared-files discipline as the v2.0 chain (13→14→15→16).

| Plan | Scope | Files | Why grouped |
|------|-------|-------|-------------|
| **13-01** | Solana contracts SOT sub-table (D-05) + extend dispatch allowlist (D-06) + add `@coral-xyz/anchor` dep + vendor IDLs + PDA-derivation helpers | `config/contracts.ts`, `canonical-dispatch-solana.ts`, `test/config-contracts.test.ts`, package.json | Scaffolds the shared structures ALL later plans consume; smallest foundational unit |
| **13-02** | MarginFi reads — `get_marginfi_positions` + `chains/solana/marginfi.ts` decoder + `signing/marginfi-health.ts` (D-07) | reads + health module + tests | Read-only, no signing surface; health math anchored here (SOL-W-03) |
| **13-03** | MarginFi writes — `prepare_marginfi_{supply,withdraw,borrow,repay}` + `prepare_marginfi_account_init` + `protocols/marginfi.ts` IDL hand-encode + fixtures + LEDGER NOTICE + D-03 gate | tools + protocol + fixtures | Single protocol, web3.js-v1-native, 5 tools — one coherent execute unit (SOL-W-04/05/09) |
| **13-04** | Kamino reads — `get_kamino_positions` + `chains/solana/kamino.ts` (kit→shape adapter) + `signing/kamino-health.ts` (D-07) | reads + health module + tests | Kamino kit-impedance isolated to reads first (SOL-W-06) |
| **13-05** | Kamino writes — `prepare_kamino_{supply,withdraw,borrow,repay}` + `protocols/kamino.ts` IDL hand-encode + **refresh ceremony** + fixtures + LEDGER NOTICE + D-03 gate | tools + protocol + fixtures | Heaviest unit (refresh ceremony + multi-ix ordering) — deliberately its own plan (SOL-W-07/09) |
| **13-06** | Kamino obligation-init — `prepare_kamino_obligation_init` (initUserMetadata + initObligation 2-step) + fixtures + register-all final wiring | init tool + fixtures + register-all | Kamino's 2-step init is distinct enough to isolate (SOL-W-08) |

*(Alternative 5-plan: merge 13-04+13-05+13-06 into two Kamino plans if execute-weight allows. The hard floor is: MarginFi and Kamino do NOT share a write plan; Kamino's refresh-ceremony + obligation-2-step-init should not co-habit with the simpler op tools. Planner decides 5 vs 6 on the conflict-graph + execute-weight basis per CONTEXT § Claude's Discretion.)*

---

## Sources

### Primary (HIGH confidence)
- Throwaway installs (2026-06-03): `@mrgnlabs/marginfi-client-v2@6.4.2`, `@kamino-finance/klend-sdk@8.0.2`, `@coral-xyz/anchor@0.30.1` — `.d.ts` surfaces, `dist/idl/*.json`, `dist/@codegen/**`, `dist/configs.json`, `dist/utils/{constants,seeds}.d.ts`
- npm registry (`npm view`): versions, dependency trees, publish/create dates, empty postinstall scripts; downloads API
- Codebase pattern files: `prepare_solana_spl_send.ts`, `solana-spl.ts`, `payload-fingerprint-solana.ts`, `canonical-dispatch-solana.ts`, `contracts.ts`, `aave-health.ts`, `sol-rpc-client.ts`, Phase 44 `44-01-SUMMARY.md`

### Secondary (MEDIUM confidence)
- [Ledger Solana app signing capabilities](https://support.ledger.com/article/4499092909085-zd) + [What Is Clear Signing | Ledger](https://www.ledger.com/academy/topics/ledgersolutions/what-is-clear-signing) — clear-sign vs blind-sign, `6808` error, Generic Parser is EVM-only
- [Solana Signer Kit — Ledger Developer Portal](https://developers.ledger.com/docs/device-interaction/references/signers/solana)

### Tertiary (LOW confidence — flagged for plan-gate verification)
- Kamino main-market address `7u3He…` (commonly cited; NOT confirmed from installed SDK — Open Question Q1)
- Kamino refresh-ceremony exact per-op instruction set (structurally inferred from IDL + DOCUMENTED Solend/Kamino convention — A2)

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — both SDKs probed in throwaway installs; versions/deps/IDLs verified
- SDK scope-probe verdicts: HIGH — `.d.ts` + IDL inspected directly; signer models read from IDL account flags
- Architecture/patterns: HIGH — mirror established Phase 12/44 Solana patterns + verified IDL account orderings
- Health math: MEDIUM-HIGH — formula shapes verified from SDK signatures; exact fixed-point scales need fixture-anchoring at build (D-07)
- Kamino refresh ceremony: MEDIUM — structurally certain from IDL, exact per-op set confirm-at-build (A2/A4)
- Ledger CAL/clear-sign: HIGH (DOCUMENTED) — Ledger docs + app README + 2025 Generic-Parser-is-EVM-only confirmation
- Kamino main-market address: LOW — not SDK-derivable; plan-gate doc fetch required (Q1)

**Research date:** 2026-06-03
**Valid until:** 2026-07-03 (30 days — SDKs are active; klend-sdk bumped 2026-06-02, marginfi 2026-06-03; re-verify program IDs + IDL version at plan gate if >2 weeks elapse)
