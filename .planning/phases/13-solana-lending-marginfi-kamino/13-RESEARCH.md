# Phase 13: Solana lending — MarginFi + Kamino — Research

**Researched:** 2026-05-20
**Domain:** Solana lending protocol integration (MarginFi v2 + Kamino Lend v5) — reads, prepare-tools, canonical-dispatch extension, Ledger blind-sign UX
**Confidence:** HIGH (SDK probes empirical; Ledger CAL verdict cross-referenced with two official sources)

## Summary

Phase 13 is the first DeFi-on-Solana phase following the Phase 12 trust-pipeline ship. The shape is well-precedented: Aave v3 (Phase 7) and Compound v3 (Phase 28) on the EVM side already encode the per-protocol read-tool + per-action prepare-tool pattern; Phase 12 ships the Solana cryptographic-binding primitives (`computeSolanaPayloadFingerprint`, `_canonicalDispatchSolana`, decoder + summary surface). Phase 13 mostly **composes** Phase 12's primitives with two third-party SDKs.

**Two load-bearing decisions land at research time:**

1. **MarginFi SDK adoption (DF-1) — STRONG ADOPT.** [`@mrgnlabs/marginfi-client-v2@6.4.1`](https://www.npmjs.com/package/@mrgnlabs/marginfi-client-v2) — installed empirically; `.d.ts` probed; `MarginfiAccountWrapper.makeDepositIx / makeRepayIx / makeWithdrawIx / makeBorrowIx` all return `Promise<InstructionsWrapper>` carrying `TransactionInstruction[]` from `@solana/web3.js@1.93.2` (Ledger-compatible — unsigned-tx authoring, matches Phase 12 stack). `make*Ix` is the path; the sibling `.deposit() / .withdraw() / .borrow() / .repay()` methods broadcast and are **not** to be used.

2. **Kamino SDK adoption (DF-2) — ADOPT v5.15.4, NOT v7.x.** [`@kamino-finance/klend-sdk@5.15.4`](https://www.npmjs.com/package/@kamino-finance/klend-sdk) is the last `@solana/web3.js@1.x`-compatible release (published 2026-05-19; actively maintained — `5.x` and `7.x` branches ship in parallel). `v6+` migrated to [`@solana/kit`](https://www.npmjs.com/package/@solana/kit) v2 (Solana's new JS stack); adopting `v7.x` would require either a full Phase 12 rebase to Kit or a `@solana/compat` bridge, both of which exceed Phase 13 scope. `KaminoAction.buildDepositTxns / buildBorrowTxns / buildWithdrawTxns / buildRepayTxns` static builders return `KaminoAction` carrying `lendingIxs: Array<TransactionInstruction>` + `setupIxs` (init-obligation prepends) + `cleanupIxs` (post-action refresh). Phase 13 extracts the instructions; never calls the broadcast-side helpers.

**Ledger Solana CAL verdict:** Both MarginFi and Kamino are Anchor programs. The Ledger Solana app only clear-signs simple System/SPL transfer + createAccount + fundAccount instruction shapes ([Ledger app-solana README](https://github.com/LedgerHQ/app-solana), [Ledger support — blind signing](https://support.ledger.com/article/4499092909085-zd)). **All Phase 13 instructions blind-sign on-device.** Emit a `LEDGER_NOTICE_SOLANA_BLIND_SIGN` block at preview time (mirrors Phase 6 `WETH9.withdraw` + Phase 28 Compound NOTICE pattern).

**Primary recommendation:** Mechanical clone of Phase 12's `prepare_solana_spl_send` shape per prepare-tool (one tool per intent — supply/withdraw/borrow/repay × marginfi/kamino + the two init tools — 10 prepare-tools total). Mirror Phase 7 Aave's intent shape (one selector per tool, no Compound-style intent-gate disambiguation needed because MarginFi/Kamino encode each action as a distinct Anchor instruction). Extend `get_lending_positions` in-place via discriminated-union widening (mirror Phase 28's `protocol: "aave-v3" | "compound-v3"` extension to `"aave-v3" | "compound-v3" | "marginfi" | "kamino"`).

## User Constraints (from CONTEXT.md)

### Locked Decisions (anchor candidates from CONTEXT.md — `/gsd-discuss-phase 13` will confirm)

- **MarginFi SDK adoption (DF-1)**: scope-probe whether SDK exposes UNSIGNED instruction output. **Resolved this research:** ADOPT `@mrgnlabs/marginfi-client-v2@6.4.1` — `make*Ix` returns `Promise<InstructionsWrapper>` with `TransactionInstruction[]`. Ledger-compatible. `[VERIFIED: empirical probe at /tmp/marginfi-probe + @mrgnlabs/marginfi-client-v2@6.4.1 dist/models/account/wrapper.d.ts]`
- **Kamino SDK adoption (DF-2)**: same scope-probe. **Resolved this research:** ADOPT `@kamino-finance/klend-sdk@5.15.4` — last `@solana/web3.js@1.x`-compatible release. `KaminoAction.build*Txns` returns `KaminoAction` carrying `lendingIxs: Array<TransactionInstruction>`. v6+ moved to `@solana/kit` v2 (rejected for v1 stack continuity). `[VERIFIED: empirical probe at /tmp/kamino-v5-probe + @kamino-finance/klend-sdk@5.15.4 dist/classes/action.d.ts]`
- **Contracts SOT extension**: `src/config/contracts.ts` adds Solana sub-table — `Record<"solana", SolanaContracts>` mirroring v1.2 EVM shape. New typed slots: `marginfiProgram`, `kaminoLendProgram`, plus per-protocol PDA-derivation helpers. **Confirmed appropriate.**
- **Canonical dispatch allowlist**: `src/security/canonical-dispatch-solana.ts` extends `SOLANA_DISPATCH_ALLOWLIST` with the 2 program IDs (MarginFi: `MFv2hWf31Z9kbCa1snEPYctwafyhdvnV7FZnsebVacA`, Kamino lend: `KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD`). Layer 0.5 refusal at preview time. **Note:** the existing `Phase 13 — MarginFi + Kamino lending program IDs` comment in `canonical-dispatch-solana.ts:19` already anticipates this extension.
- **PDA setup as distinct tools**: `prepare_marginfi_account_init` + `prepare_kamino_obligation_init` as distinct intent-routed tools (mirrors v1.1 `prepare_revoke_approval` precedent). **Confirmed.**
- **Mechanical clone pattern**: each `prepare_*` mechanical-clone of `prepare_solana_spl_send` with bounded diffs (schema, encoder, program ID, PDA accounts). **Confirmed — see § Architecture Patterns below.**
- **Conditional LEDGER NOTICE**: emitted when CAL coverage absent. **Resolved:** ALL Phase 13 instructions blind-sign — NOTICE is UNCONDITIONAL for Phase 13.

### Claude's Discretion (per CONTEXT.md)

- Health-factor math equivalent per-protocol (Kamino and MarginFi have different risk-engine surfaces). **Resolved:** both SDKs expose ready-made health functions (`KaminoObligation.refreshedStats.{loanToValue,liquidationLtv}` + `getBorrowPower()`; `MarginfiAccount.computeHealthComponents(MarginRequirementType.Initial | Maintenance)`). Phase 13 resurfaces these into a normalized envelope at the read-tool boundary — does NOT reimplement (the math is protocol-specific and the SDKs are authoritative). Per-protocol math modules under `src/signing/marginfi-health.ts` + `src/signing/kamino-health.ts` are thin adapters, NOT reimplementations of Aave-style RAY/BPS arithmetic.
- Internal helper names — researcher's call per CONTEXT.md.

### Deferred Ideas (OUT OF SCOPE — from CONTEXT.md)

- Other Solana lending protocols (Solend, MarginFi Klend wrapper variant) — v2.x backlog
- Cross-protocol position aggregation — v3.x ergonomics
- E-mode / per-asset borrowing caps surfacing — verify-phase feedback (Phase 7 precedent)
- v0 (VersionedTransaction) + Address Lookup Tables — Phase 12 OQ-1 lock, v2.0.x

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| **SOL-W-03** | `get_marginfi_positions({ wallet })` returns MarginFi-bank-keyed supplied + borrowed + health-factor-equivalent per position | § Topic 1 (SDK adoption) + § Topic 5 (read-tool shape) |
| **SOL-W-04** | `prepare_marginfi_supply / _withdraw / _borrow / _repay` produce unsigned MarginFi program instructions | § Topic 1 (`make*Ix` surface) + § Topic 6 (prepare-tool shape) |
| **SOL-W-05** | `prepare_marginfi_account_init` sets up per-wallet `MarginfiAccount` PDA when not already present | § Topic 3 (per-wallet account setup) |
| **SOL-W-06** | `get_kamino_positions({ wallet })` returns Kamino-vault-keyed supplied + borrowed + per-vault health | § Topic 2 (SDK adoption) + § Topic 5 (read-tool shape) |
| **SOL-W-07** | `prepare_kamino_supply / _withdraw / _borrow / _repay` produce unsigned Kamino program instructions | § Topic 2 (`KaminoAction.build*Txns` surface) + § Topic 6 (prepare-tool shape) |
| **SOL-W-08** | `prepare_kamino_obligation_init` sets up per-wallet `Obligation` PDA when not already present | § Topic 4 (per-wallet obligation setup) |
| **SOL-W-09** | MarginFi + Kamino program IDs added to Solana arm of canonical-dispatch; mismatch refuses at preview time | § Topic 8 (canonical-dispatch extension) |
| **SOL-W-10** | MarginFi + Kamino program addresses sourced from `src/config/contracts.ts` Solana sub-table | § Topic 8 (contracts SOT extension) — already anticipated by Phase 12 comment |

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Reading lending positions (MarginFi + Kamino) | MCP server (read tools) | Solana RPC (`getAccountInfo` for `MarginfiAccount` + `Obligation` PDAs + bank/reserve state) | All decode + math runs server-side; agent receives a normalized envelope. No client-side Solana code in v1.x scope. |
| Authoring unsigned prepare-tx | MCP server (prepare tools) | Solana RPC (`getLatestBlockhash`) + Solana SDK builders | Mirror Phase 12 pattern — server builds the `Transaction`, computes `messageBytes`, computes `payloadFingerprint`. |
| Preview-time decode + simulation | MCP server (`preview_send` Solana branch — Phase 12 FROZEN, additive only) | Solana RPC (`simulateTransaction`) | Phase 12 Layer 0.7 simulation gate is reused; Phase 13 adds MarginFi + Kamino program-ID decoder arms to the discriminated-union dispatch but does NOT touch the simulation path. |
| Canonical-dispatch enforcement | MCP server (Layer 0.5 — `canonical-dispatch-solana.ts`) | — | Server-side allowlist; agent has no role. Mismatch refusal precedes RPC reads. |
| Final signing | Ledger device | Ledger Live (WC-equivalent SDK over USB-HID per Phase 11) | Phase 13 adds NO new signing surface. All instructions blind-sign on-device. |

## Standard Stack

### Core (NEW dependencies for Phase 13)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@mrgnlabs/marginfi-client-v2` | 6.4.1 | MarginFi v2 SDK — `MarginfiClient.fetch` + `MarginfiAccountWrapper.make*Ix` builders + `Bank` + `OraclePrice` + `computeHealthComponents` | Official MarginFi-org SDK; the only typed builder for MarginFi's Anchor IDL. Phase 7 `parseAbi` / Phase 28 `parseAbi` equivalent for Solana — encoding + decoding lives behind a typed surface. |
| `@kamino-finance/klend-sdk` | 5.15.4 | Kamino Lend SDK — `KaminoMarket` + `KaminoObligation` + `KaminoAction.build*Txns` static builders + `getObligationByWallet` | Official Kamino-Finance org SDK; `v5.x` is the last `@solana/web3.js@1.x`-compatible branch (actively maintained as of 2026-05-19); `v7.x` migrated to `@solana/kit` and is rejected for v1-stack continuity. |

### Already in dependency graph (Phase 12 — reused without bump)

| Library | Version | Purpose |
|---------|---------|---------|
| `@solana/web3.js` | 1.98.4 | Phase 12 Solana primitives — `Transaction`, `PublicKey`, `SystemProgram`, `Connection`, `TransactionInstruction`. Both Phase 13 SDKs depend on `@solana/web3.js@1.x` (`MarginFi ^1.93.2` + `Kamino v5.15.4 ^1.95.8`); semver-compatible with installed 1.98.4. |
| `@solana/spl-token` | 0.4.x | Phase 12 ATA derivation + `createTransferCheckedInstruction`. **Caveat:** MarginFi depends on `@solana/spl-token@^0.1.8` (deprecated namespace). Resolves via peer dependency hoisting — verify at install time. |
| `viem` | 2.48.11 | EVM side — keccak256 for `payloadFingerprint` (chain-distinct domain tag handled in `payload-fingerprint-solana.ts`); reused unchanged. |
| `@noble/hashes` | — | SHA-256 for Phase 12 device-display hash (`presign-hash-solana.ts`); reused unchanged. |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `@mrgnlabs/marginfi-client-v2@6.4.1` | Raw Anchor IDL decoding via `@coral-xyz/anchor` + IDL JSON at `dist/idl/marginfi.json` | Would skip ~4 transitive deps (mrgn-common, switchboard, pyth-receiver) BUT requires hand-rolling every Anchor 8-byte discriminator (`[231, 205, 66, 242, 220, 87, 145, 38]` etc.) + every account-ordering rule. NEVER do this — drift in MarginFi's IDL surfaces as silent fingerprint drift. The SDK is the test seam. `[CITED: /tmp/marginfi-probe/node_modules/@mrgnlabs/marginfi-client-v2/dist/idl/marginfi.json]` |
| `@kamino-finance/klend-sdk@5.15.4` (v1.x stack) | `@kamino-finance/klend-sdk@7.3.22` (Kit stack) + `@solana/compat` bridge | v7.x is the future direction (Kit is Solana's official next-gen stack). Adopting it now would either (a) require a full Phase 12 rebase to Kit (high risk — touches FROZEN signing primitives) or (b) a `@solana/compat` bridge at every prepare-tool call site (added complexity for no immediate benefit). v5.x ships in parallel — published as recently as 2026-05-19 — and is the lower-risk path for Phase 13. Reassess at v2.5+. `[VERIFIED: npm view @kamino-finance/klend-sdk@5.15.4 time.modified = 2026-05-19]` |
| Custom intent-gate (Phase 28 Compound shape) | One prepare-tool per intent (Phase 7 Aave shape) | Phase 28 Compound has a 2-selector × 4-intent collision (supply/repay collapse into `supply()`; withdraw/borrow into `withdraw()`); intent-gate at prepare time is mandatory. MarginFi + Kamino each encode supply/withdraw/borrow/repay as **distinct Anchor instructions** with distinct 8-byte discriminators — no collision exists. Phase 7 Aave shape is the right precedent. `[VERIFIED: /tmp/marginfi-probe/node_modules/@mrgnlabs/marginfi-client-v2/dist/instructions.d.ts]` |

**Installation:**
```bash
npm install @mrgnlabs/marginfi-client-v2@6.4.1 @kamino-finance/klend-sdk@5.15.4
```

**Version verification (this session):**
- `npm view @mrgnlabs/marginfi-client-v2 version` → `6.4.1`, last published 2026-01-28 `[VERIFIED: npm registry probe]`
- `npm view @kamino-finance/klend-sdk@5.15.4 time.modified` → `2026-05-19T19:38:55.171Z` (yesterday) `[VERIFIED: npm registry probe]`
- Weekly downloads: MarginFi ≈ 15,528; Kamino ≈ 31,446 `[VERIFIED: api.npmjs.org/downloads/point/last-week]`

## Package Legitimacy Audit

> Slopcheck was unavailable in this session (pip install blocked by sandbox policy). Per protocol, every new package below is tagged `[ASSUMED]` and the planner must gate each install behind a `checkpoint:human-verify` task. Authoritative-source confirmation is documented inline.

| Package | Registry | Age (latest) | Weekly Downloads | Source Repo | slopcheck | Disposition |
|---------|----------|--------------|------------------|-------------|-----------|-------------|
| `@mrgnlabs/marginfi-client-v2` | npm (scoped to `@mrgnlabs` — MarginFi org) | published 2026-01-28 (~4 months) | 15,528 | [github.com/mrgnlabs/marginfi-client-v2](https://github.com/mrgnlabs/marginfi-client-v2) — installed package omits `repository` field (minor `[SUS]` signal) but @mrgnlabs npm scope is org-controlled per MarginFi docs; downloads + scope ownership confirm legitimacy | not available | `[ASSUMED]` — planner gates install behind `checkpoint:human-verify`. Authoritative source: [docs.marginfi.com](https://docs.marginfi.com/). |
| `@kamino-finance/klend-sdk` (v5.15.4) | npm (scoped to `@kamino-finance` — Kamino org) | published 2026-05-19 (yesterday) | 31,446 | [github.com/Kamino-Finance/klend-sdk](https://github.com/Kamino-Finance/klend-sdk) — repository field present, scope org-controlled | not available | `[ASSUMED]` — planner gates install behind `checkpoint:human-verify`. Authoritative source: [docs.kamino.finance](https://docs.kamino.finance/). |

**Postinstall script audit:** Both packages have `scripts.postinstall === undefined` per `npm view`. No postinstall attack surface.

**Packages removed due to slopcheck [SLOP] verdict:** none.
**Packages flagged as suspicious [SUS]:** MarginFi has a missing `repository` field in its published `package.json`. Mitigated by: org-scoped name (`@mrgnlabs`), high download count, active development cadence, repo discoverable at `github.com/mrgnlabs/marginfi-client-v2`. Planner: install behind `checkpoint:human-verify` per `[ASSUMED]` gate above; no additional checkpoint needed for this signal alone.

## Architecture Patterns

### System Architecture Diagram

```
                ┌────────────────────────────────────────────────────────┐
                │                Agent (Claude Code/Cursor/Desktop)      │
                └─────────────────────────────┬──────────────────────────┘
                                              │ stdio (MCP)
                                              ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│ vaultpilot-mcp (Phase 13 additive surface — outside Phase 12 FROZEN region)     │
│                                                                                 │
│  READ PATH                                              PREPARE PATH            │
│  ─────────                                              ────────────            │
│  get_lending_positions                                  prepare_marginfi_*      │
│    ├─ aave-v3 arm (Phase 7 — unchanged)                 prepare_kamino_*        │
│    ├─ compound-v3 arm (Phase 28 — unchanged)              ├─ resolve mint       │
│    └─ NEW: marginfi arm ──────┐                           │   decimals          │
│           kamino arm    ─┐    │                           ├─ resolve fee-payer  │
│                          │    │                           │   (Solana persona   │
│  get_marginfi_positions ─┤    │                           │   or paired ledger) │
│  get_kamino_positions   ─┤    │                           ├─ load market        │
│                          │    │                           │   + obligation/     │
│                          ▼    ▼                           │   bank state        │
│                       Solana RPC                          ├─ build instruction  │
│                       (mainnet-beta)                      │   via SDK builder   │
│                       getAccountInfo                      │   (make*Ix /        │
│                       getLatestBlockhash                  │    KaminoAction.    │
│                       getMultipleAccounts                 │    build*Txns)      │
│                                                           ├─ if PDA absent:    │
│                                                           │   prepend init     │
│                                                           │   instruction      │
│                                                           ├─ compute message- │
│                                                           │   Bytes + payload- │
│                                                           │   Fingerprint     │
│                                                           ▼                    │
│                                                  createHandle({tx, args})     │
│                                                           │                    │
│  ── FROZEN below (Phase 12) ─────────────────────────────┴───────────────────  │
│                                                                                 │
│  preview_send (Solana branch — Phase 13 EXTENDS decoder dispatch)              │
│    ├─ Layer 0.5: canonical-dispatch-solana (Phase 13 adds MarginFi + Kamino)   │
│    ├─ Layer 0.7: simulateTransaction (unchanged)                              │
│    ├─ decoder dispatch (Phase 13 adds Anchor 8-byte discriminator arms)       │
│    └─ emit LEDGER_NOTICE_SOLANA_BLIND_SIGN block (unconditional)              │
│                                                                                 │
│  send_transaction (Solana branch — UNCHANGED)                                  │
│    └─ Phase 12 PREP-07/08/09 gates fire identically                            │
└─────────────────────────────────────────────────┬──────────────────────────────┘
                                                  │ USB-HID (Phase 11 transport)
                                                  ▼
                                          Ledger Solana app
                                          (BLIND-SIGN required —
                                           Anchor programs out of CAL)
```

### Recommended Project Structure

```
src/
├── chains/
│   └── solana/
│       ├── marginfi.ts              # NEW — MarginfiClient.fetch wrapper + position reader (Plan 13-02)
│       └── kamino.ts                # NEW — KaminoMarket loader + getObligationByWallet wrapper (Plan 13-03)
├── protocols/
│   ├── solana-marginfi.ts           # NEW — Anchor 8-byte discriminator table + decoder discriminated-union (Plan 13-04 dependency)
│   └── solana-kamino.ts             # NEW — Anchor 8-byte discriminator table + decoder discriminated-union (Plan 13-04 dependency)
├── signing/
│   ├── marginfi-health.ts           # NEW — thin adapter over MarginfiAccount.computeHealthComponents (Plan 13-02)
│   └── kamino-health.ts             # NEW — thin adapter over KaminoObligation.refreshedStats (Plan 13-03)
├── tools/
│   ├── get_marginfi_positions.ts    # NEW — Plan 13-02
│   ├── get_kamino_positions.ts      # NEW — Plan 13-03
│   ├── get_lending_positions.ts     # EXTEND — discriminated-union widening (Plan 13-05; see § Topic 5 below)
│   ├── prepare_marginfi_account_init.ts   # NEW — Plan 13-04
│   ├── prepare_marginfi_supply.ts         # NEW — Plan 13-04
│   ├── prepare_marginfi_withdraw.ts       # NEW — Plan 13-04
│   ├── prepare_marginfi_borrow.ts         # NEW — Plan 13-04
│   ├── prepare_marginfi_repay.ts          # NEW — Plan 13-04
│   ├── prepare_kamino_obligation_init.ts  # NEW — Plan 13-04
│   ├── prepare_kamino_supply.ts           # NEW — Plan 13-04
│   ├── prepare_kamino_withdraw.ts         # NEW — Plan 13-04
│   ├── prepare_kamino_borrow.ts           # NEW — Plan 13-04
│   ├── prepare_kamino_repay.ts            # NEW — Plan 13-04
│   └── preview_send.ts              # EXTEND — Solana decoder dispatch adds MarginFi + Kamino arms; emit unconditional LEDGER_NOTICE_SOLANA_BLIND_SIGN (Plan 13-04)
├── security/
│   └── canonical-dispatch-solana.ts # EXTEND — add 2 program IDs to SOLANA_DISPATCH_ALLOWLIST (Plan 13-01)
└── config/
    └── contracts.ts                 # EXTEND — Record<"solana", SolanaContracts> sub-table (Plan 13-01)
```

### Pattern 1: SDK builder → Phase 12 trust pipeline composition

**What:** Each `prepare_*_*` tool is a **mechanical clone of `prepare_solana_spl_send`** with the SPL-specific section swapped for an SDK builder call.

**When to use:** Every Phase 13 prepare tool.

**Example (MarginFi supply — abstracted from Phase 12 + MarginFi SDK):**
```typescript
// Source: empirical type-check against @mrgnlabs/marginfi-client-v2@6.4.1
//         + Phase 12 src/tools/prepare_solana_spl_send.ts shape

// 1. Demo-mode + pairing + input validation — VERBATIM Phase 12 pattern
// 2. Load MarginfiClient (read-only — never broadcasts)
const mfiClient = await MarginfiClient.fetch(
  configProduction,  // from src/config/contracts.ts Solana sub-table
  readOnlyWallet,    // shim wallet — Phase 12 fee-payer base58 → PublicKey
  connection,
  { readOnly: true },
);

// 3. Resolve user's MarginfiAccount PDA. If absent → REFUSE with hint
const accountAddress = await mfiClient.getMarginfiAccountAddressByAuthority(feePayer);
const accountInfo = await connection.getAccountInfo(accountAddress);
if (accountInfo === null) {
  return errEnvelope("INVALID_INPUT",
    "no MarginfiAccount for this wallet; call prepare_marginfi_account_init first",
    "marginfi-account-not-initialized");
}

// 4. Load the wrapper (fetches account + bank state)
const wrapper = await MarginfiAccountWrapper.fetch(accountAddress, mfiClient);

// 5. Build the instruction(s) — UNSIGNED, Ledger-compatible
const { instructions: makeIxs } = await wrapper.makeDepositIx(
  amount,         // BN — parsed via parseSolanaAmountStrict per Phase 12 decimal discipline
  bankAddress,    // base58 PublicKey of the MarginFi bank for this asset
);

// 6. Compose into a Transaction — Phase 12 messageBytes + fingerprint path
const tx = new Transaction({ recentBlockhash, feePayer });
tx.add(...makeIxs);
const messageBytes = new Uint8Array(tx.serializeMessage());
const payloadFingerprint = computeSolanaPayloadFingerprint({ messageBytes });

// 7. createHandle — VERBATIM Phase 12 pattern, populate programIds + instructionSummary
const handle = createHandle({
  args: { /* RAW agent strings — to/mint/amount */ },
  tx: {
    txType: "solana",
    chainId: 0, to: "0x0...0", valueWei: 0n, data: "0x",
    messageBytes,
    feePayer: feePayer.toBase58(),
    recentBlockhash,
    programIds: [/* MarginFi program ID + any ATA program touched */],
    instructionSummary: [/* "kind": "marginfi-supply", bank, amount, decimals */],
  },
  payloadFingerprint,
});
```

### Pattern 2: PDA-init-then-action vs init-prepended

**What:** MarginFi `MarginfiAccount` and Kamino `Obligation` are per-wallet PDAs that must exist before any supply/withdraw/borrow/repay instruction can succeed.

**Two valid shapes:**

| Shape | Description | Recommendation |
|-------|-------------|----------------|
| **(a) Distinct init tool** | `prepare_marginfi_account_init` is a separate prepare-tool. User runs it ONCE (lifetime); subsequent supply/borrow tools refuse with `marginfi-account-not-initialized` hint when absent. | **PRIMARY** — matches CONTEXT.md decision lock. User explicitly approves the init transaction. Mirrors v1.1 `prepare_revoke_approval` precedent (distinct intent → distinct tool). |
| **(b) Auto-prepended** | First supply tool detects missing PDA + auto-prepends init instruction (similar to Phase 12 SPL `createAssociatedTokenAccountInstruction` prepend). | Skip — too many instructions in one tx surfaces as a more complex blind-sign display. Better UX is two separate transactions; user sees one purpose per signature. |

**LOCKED → (a) distinct init tool.** `prepare_marginfi_account_init` and `prepare_kamino_obligation_init` are first-class tools.

### Pattern 3: Read-tool extension — discriminated-union widening (mirror Phase 28)

**What:** `get_lending_positions` is the single multi-protocol EVM read tool. Phase 28 extended it from Aave-only to Aave+Compound via discriminated-union widening of the `protocol` field.

**Phase 13 question:** extend it further to cover Solana (MarginFi + Kamino), OR ship dedicated `get_marginfi_positions` + `get_kamino_positions` tools?

**Recommendation: BOTH — per-protocol read tools AS PRIMARY, multi-protocol aggregator extension AS SECONDARY.**

**Rationale:** `get_lending_positions` schema currently requires `chain: "ethereum" | "arbitrum" | ...` — an EVM enum. Adding Solana would either (a) widen the enum to include `"solana"` (breaks the EVM-shape invariant — Solana chains have no chainId, no EVM client) OR (b) make `chain` optional and route by wallet-address shape (heuristic; brittle). Neither is byte-clean.

**Cleaner shape:** Ship `get_marginfi_positions({ wallet })` + `get_kamino_positions({ wallet })` as first-class tools (SOL-W-03 + SOL-W-06 require these by name). THEN: extend `get_lending_positions` to accept `chain: "solana"` as a sentinel that fans out to both Solana tools internally — agents asking "show me my lending positions" call `get_lending_positions` and receive a unified envelope; agents asking specifically about MarginFi call the dedicated tool.

**Resulting `get_lending_positions` discriminator surface:**
```typescript
type LendingPositionRow =
  | { protocol: "aave-v3";       /* Phase 7 fields unchanged */     }
  | { protocol: "compound-v3";   /* Phase 28 fields unchanged */    }
  | { protocol: "marginfi";      /* Phase 13 — bank-keyed surface */}
  | { protocol: "kamino";        /* Phase 13 — reserve-keyed surface */};
```

### Anti-Patterns to Avoid

- **Calling `.deposit() / .withdraw() / .borrow() / .repay()` on `MarginfiAccountWrapper`** — these are broadcast helpers that internally sign + submit. Use ONLY `.makeDepositIx() / .makeWithdrawIx() / .makeBorrowIx() / .makeRepayIx()` which return `InstructionsWrapper` (unsigned).
- **Calling `KaminoAction.sendTransaction(...)`** (or any send-side helper) — Phase 13 extracts `lendingIxs` from the returned `KaminoAction` instance and composes them into a Phase 12 `Transaction`. Never broadcast from SDK code.
- **Hand-rolling Anchor 8-byte discriminators** for decode at preview time — drift in MarginFi/Kamino's IDL surfaces silently. The SDK exposes `DISCRIMINATOR` constants per instruction; consume those.
- **Inlining program IDs in tool code** — `src/config/contracts.ts` Solana sub-table is the SOT (CLAUDE.md convention enforced for EVM since Phase 7).
- **Using Kamino v6.x / v7.x in v1.x scope** — these depend on `@solana/kit` v2 which is structurally incompatible with Phase 12's `@solana/web3.js@1.x` pipeline. Mixing requires `@solana/compat` bridges that introduce decode-shape ambiguity.
- **Using legacy `MarginfiAccount.fetch(...)` (the pure class)** when authoring instructions — use `MarginfiAccountWrapper.fetch(...)` which carries the client reference needed by `make*Ix` builders.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Anchor instruction encoding | Hand-rolled 8-byte discriminator + Borsh argument layout | `MarginfiAccountWrapper.make*Ix(...)` + `KaminoAction.build*Txns(...)` | Both SDKs are codegen'd from the protocol IDL. Drift in MarginFi/Kamino's program (new instructions, account-ordering changes) surfaces as a typed compile error against the next SDK release — NOT as silent fingerprint drift. |
| MarginFi/Kamino PDA derivation | Hand-rolled `findProgramAddressSync(seeds, programId)` | `MarginfiClient.getMarginfiAccountAddressByAuthority(authority)` + `KaminoMarket.getObligationPda(owner, ...)` | Seed orderings are protocol-specific and easy to get wrong (Phase 12 RESEARCH § Topic 6 same lesson for SPL ATA). |
| Health-factor math (MarginFi) | Reimplemented liability-vs-asset arithmetic with hand-rolled weights | `MarginfiAccount.computeHealthComponents(MarginRequirementType.Initial \| Maintenance)` | MarginFi's risk engine uses bank-specific asset/liability weights + oracle-price decimal handling — non-trivial to reimplement. The SDK math is the protocol-authoritative answer. |
| Health-factor math (Kamino) | Reimplemented LTV computation | `KaminoObligation.refreshedStats.{loanToValue, liquidationLtv}` + `KaminoObligation.getBorrowPower(market, mint, slot)` | Kamino's elevation-group + per-reserve LTV system is protocol-specific. Resurface the SDK's `Decimal` values directly. |
| Bank/reserve enumeration | RPC `getProgramAccounts` with hand-rolled deserialization | `MarginfiClient.banks` (populated at `fetch` time) + `KaminoMarket.reserves` | Both SDKs preload the market state once and expose typed maps. RPC `getProgramAccounts` is expensive and the deserialization is non-trivial. |

**Key insight:** Phase 13 is fundamentally a **composition** phase — Phase 12 ships the trust-pipeline primitives, the two SDKs ship the protocol primitives, and Phase 13 connects them at well-defined seams. There is almost NO low-level protocol code to write. The hand-rolling temptations are all at the boundaries between SDK and trust-pipeline (e.g., "I'll just decode the discriminator myself to add to the decoder dispatch"); the discipline is to consume the SDK's exported `DISCRIMINATOR` constants and route through the SDK's typed surface.

## Runtime State Inventory

> This phase is greenfield additive — no rename/refactor. State inventory section is informational only.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | Phase 11 `non-evm-accounts.json` already stores Solana paired accounts under `chain: "solana"`. No Phase 13 change. | none |
| Live service config | None — Phase 13 adds no external services. | none |
| OS-registered state | None. | none |
| Secrets/env vars | `SOLANA_RPC_URL` from Phase 11 is reused; no new env vars. | none |
| Build artifacts | NEW: `@mrgnlabs/marginfi-client-v2` + `@kamino-finance/klend-sdk@5.15.4` transitive deps add `@coral-xyz/anchor@^0.30.1`, `@coral-xyz/borsh`, `bn.js`, `bignumber.js`, `decimal.js`, `superstruct`, `crypto-hash`, `borsh@^2`, `@switchboard-xyz/on-demand` to the dependency graph. | `npm install` after PR open + audit transitive count delta (expect ~30-40 new packages). |

## Common Pitfalls

### Pitfall 1: SDK initialization requires a `Wallet` interface — but the MCP server has no private keys

**What goes wrong:** `MarginfiClient.fetch(config, wallet, connection)` requires a `Wallet` parameter that nominally carries signing methods (`signTransaction`, `signAllTransactions`, `publicKey`). The MCP server never holds keys.

**Why it happens:** SDK API authors assume their callers are signing wallets (typical dApp pattern). VaultPilot is the unusual case — author-only, sign-elsewhere.

**How to avoid:** Construct a **read-only shim wallet** with the user's public key + stub signing methods that throw on call. Pass `{ readOnly: true }` in `MarginfiClientOptions`. The SDK's `make*Ix` paths never invoke the signing methods.

```typescript
// Shim wallet for read-only SDK use
const readOnlyWallet: Wallet = {
  publicKey: feePayer,
  signTransaction: async () => { throw new Error("read-only shim; signing happens on Ledger"); },
  signAllTransactions: async () => { throw new Error("read-only shim; signing happens on Ledger"); },
  payer: undefined as any,  // .deposit() etc. read this; we never call them
};
```

**Warning signs:** If a Phase 13 test invokes the SDK's `.deposit()` / `.withdraw()` / `.borrow()` / `.repay()` methods (NOT the `make*Ix` variants), the shim throws — production-side leakage detected at test time.

### Pitfall 2: `@solana/spl-token` version drift between Phase 12 and MarginFi SDK

**What goes wrong:** Phase 12 depends on `@solana/spl-token@0.4.x`. MarginFi `6.4.1` depends on `@solana/spl-token@^0.1.8` (deprecated namespace). Both versions can coexist via npm peer-dep hoisting, but if a Phase 13 file imports `getAssociatedTokenAddress` from the wrong version path, the on-chain ATA derivation may differ.

**Why it happens:** MarginFi pinned an old SPL-token version because the modern namespace changed `TOKEN_PROGRAM_ID` export ordering; their codegen wasn't updated.

**How to avoid:** Phase 13 imports of `@solana/spl-token` MUST come from the top-level dependency (which Phase 12 added at `0.4.x`), NOT through MarginFi's transitive path. Vitest config + tsconfig pathing already enforces this for Phase 12; verify the pattern extends.

**Warning signs:** Type errors in Phase 13 tests about `TOKEN_PROGRAM_ID` being incompatible between modules — flags the dual-version pollution.

### Pitfall 3: Stale `recentBlockhash` window vs SDK setup cost

**What goes wrong:** Both SDK initializations are heavy. `MarginfiClient.fetch` does ~3-5 RPC round trips (fetch group, banks, oracle prices, metadata). `KaminoMarket.load` is similar. Compound with Phase 12's `getLatestBlockhash` call, the total prepare-time latency can approach the 150-slot blockhash window (≈60 seconds).

**Why it happens:** Solana's blockhash window is short relative to multi-RPC SDK setup.

**How to avoid:** Fetch `recentBlockhash` LAST — after SDK setup is complete. Phase 12 already does this for SPL transfers; mirror the ordering.

**Warning signs:** Preview-time `simulateTransaction` returns `BlockhashNotFound` — the blockhash expired during SDK setup. The fix is ordering, not retry.

### Pitfall 4: `KaminoAction.lendingIxs` is NOT a flat array

**What goes wrong:** Kamino `KaminoAction` carries 5 instruction arrays: `computeBudgetIxs`, `setupIxs`, `inBetweenIxs`, `lendingIxs`, `cleanupIxs`. A naive `tx.add(...action.lendingIxs)` ships an incomplete tx — the `setupIxs` (often the init-obligation prepend) and `cleanupIxs` (refresh-obligation post-action) are missing.

**Why it happens:** Kamino's transaction model assumes the SDK composes a full tx (`KaminoAction.getTransactions()`); Phase 13 composes manually.

**How to avoid:** Build the Phase 12 `Transaction` from the **concatenation in order**: `computeBudgetIxs`, then `setupIxs`, then `inBetweenIxs`, then `lendingIxs`, then `cleanupIxs`. Verify per the SDK's own `KaminoAction.getTransactions()` source for the canonical ordering.

**Warning signs:** `simulateTransaction` fails with `InsufficientFunds` or `ObligationStale` — indicates missing setup/cleanup.

### Pitfall 5: Anchor 8-byte discriminator extraction at decode time

**What goes wrong:** Phase 12's `decodeSolanaSystemCall` reads a 4-byte u32 LE discriminant; Phase 12's `decodeSplCall` reads a 1-byte u8 discriminant. Anchor programs use an **8-byte SHA-256 prefix** (`[231, 205, 66, 242, 220, 87, 145, 38]` for MarginFi `config_group_fee`, etc.). Reading the first 4 bytes as a u32 and matching against an integer will never match.

**Why it happens:** Anchor's discriminator scheme is structurally different from System/SPL.

**How to avoid:** The decoder dispatch in Phase 13's `solana-marginfi.ts` + `solana-kamino.ts` reads bytes `[0..8]` and compares against an exported `DISCRIMINATOR` constant from the SDK (consumed via re-export, NOT hand-copied). Both SDKs export per-instruction `DISCRIMINATOR: Buffer` constants from their codegen.

**Warning signs:** Decoder dispatch always returns `unknown` for a known program ID — likely a 4-byte vs 8-byte read mismatch.

### Pitfall 6: Kamino `useV2Ixs` flag — load-bearing choice

**What goes wrong:** Most `KaminoAction.build*Txns` methods accept a `useV2Ixs: boolean` parameter. V2 instructions are the protocol's current canonical surface; V1 is legacy. Choosing wrong → either deprecated path with no migration plan, or a path the on-chain program may reject.

**How to avoid:** ALWAYS pass `useV2Ixs: true`. Document in a constant in `src/chains/solana/kamino.ts` so the decision is single-source-of-truth.

**Warning signs:** `simulateTransaction` returns an error pointing at a legacy instruction discriminator — surfaces the wrong-arm choice.

## Code Examples

### Example 1: MarginFi position read (Plan 13-02 sketch)

```typescript
// Source: type-checked against @mrgnlabs/marginfi-client-v2@6.4.1
//         dist/clients/client.d.ts + dist/models/account/wrapper.d.ts

import { Connection, PublicKey } from "@solana/web3.js";
import { MarginfiClient, MarginfiAccountWrapper, getConfig, MarginRequirementType } from "@mrgnlabs/marginfi-client-v2";

async function readMarginfiPositions(wallet: PublicKey, connection: Connection) {
  // Phase 12 config — production cluster from src/config/contracts.ts SOT
  const config = getConfig("production");  // returns MarginfiConfig with program=MFv2hWf31Z9...

  // Read-only shim wallet — see Pitfall 1
  const readOnlyWallet = makeReadOnlyShim(wallet);

  const client = await MarginfiClient.fetch(config, readOnlyWallet, connection, { readOnly: true });

  // User's MarginfiAccount PDA address
  const accountAddress = await client.getMarginfiAccountAddressByAuthority(wallet);
  const accountInfo = await connection.getAccountInfo(accountAddress);
  if (accountInfo === null) {
    return { positions: [], accountInitialized: false };
  }

  const wrapper = await MarginfiAccountWrapper.fetch(accountAddress, client);

  // Health components — protocol-authoritative
  const { assets, liabilities } = wrapper.computeHealthComponents(MarginRequirementType.Maintenance);

  // Per-bank positions
  const positions = wrapper.account.balances
    .filter(b => b.active)
    .map(b => {
      const bank = client.banks.get(b.bankPk.toBase58())!;
      return {
        protocol: "marginfi" as const,
        bankPk: b.bankPk.toBase58(),
        mint: bank.mint.toBase58(),
        suppliedHuman: b.assetShares.times(bank.assetShareValue).toString(),
        borrowedHuman: b.liabilityShares.times(bank.liabilityShareValue).toString(),
        // ... liquidityRate / borrowRate / etc. from bank
      };
    });

  return {
    positions,
    accountInitialized: true,
    healthFactor: liabilities.gt(0) ? assets.div(liabilities).toString() : null,
    noDebt: liabilities.eq(0),
  };
}
```

### Example 2: Kamino position read (Plan 13-03 sketch)

```typescript
// Source: type-checked against @kamino-finance/klend-sdk@5.15.4
//         dist/classes/market.d.ts + dist/classes/obligation.d.ts

import { Connection, PublicKey } from "@solana/web3.js";
import { KaminoMarket, VanillaObligation, PROGRAM_ID } from "@kamino-finance/klend-sdk";

const KAMINO_MAIN_MARKET = new PublicKey("7u3HeHxYDLhnCoErrtycNokbQYbWGzLs6JSDqGAv5PfF");  // SOT in contracts.ts

async function readKaminoPositions(wallet: PublicKey, connection: Connection) {
  const market = await KaminoMarket.load(connection, KAMINO_MAIN_MARKET);
  if (market === null) {
    throw new Error("Kamino main market unavailable");
  }

  const obligation = await market.getObligationByWallet(wallet, new VanillaObligation(PROGRAM_ID));
  if (obligation === null) {
    return { positions: [], obligationInitialized: false };
  }

  // Per-reserve positions — Kamino's surface exposes deposit/borrow keyed by reserve address
  const positions = [...obligation.deposits.entries(), ...obligation.borrows.entries()].map(
    ([reservePk, position]) => {
      const reserve = market.getReserveByAddress(reservePk)!;
      return {
        protocol: "kamino" as const,
        reservePk: reservePk.toBase58(),
        mint: reserve.getLiquidityMint().toBase58(),
        // .. supplied/borrowed/rates extracted from KaminoReserve + position
      };
    },
  );

  return {
    positions,
    obligationInitialized: true,
    loanToValue: obligation.loanToValue().toString(),
    liquidationLtv: obligation.liquidationLtv().toString(),
    // Kamino's collateralization metric — protocol-authoritative
  };
}
```

### Example 3: MarginFi supply prepare-tool (Plan 13-04 sketch)

```typescript
// Source: type-checked against
//   - @mrgnlabs/marginfi-client-v2@6.4.1 dist/models/account/wrapper.d.ts
//   - Phase 12 src/tools/prepare_solana_spl_send.ts shape

// ... (Phase 12 verbatim — demo-mode + pairing + input validation)
// ... (resolve fee-payer from Solana persona / paired account)

const client = await MarginfiClient.fetch(config, readOnlyShim, connection, { readOnly: true });
const accountAddress = await client.getMarginfiAccountAddressByAuthority(feePayer);

const accountInfo = await connection.getAccountInfo(accountAddress);
if (accountInfo === null) {
  return errEnvelope("INVALID_INPUT",
    "no MarginfiAccount for this wallet — call prepare_marginfi_account_init first",
    "marginfi-account-not-initialized");
}

const wrapper = await MarginfiAccountWrapper.fetch(accountAddress, client);

const amount = parseSolanaAmountStrict(rawAmount, decimals);
const bankAddress = new PublicKey(bankPubkey);  // agent-supplied; validated against client.banks.has()

const { instructions } = await wrapper.makeDepositIx(amount, bankAddress);

// Phase 12 verbatim — getLatestBlockhash AFTER SDK setup (Pitfall 3)
const { blockhash } = await connection.getLatestBlockhash();

const tx = new Transaction({ recentBlockhash: blockhash, feePayer });
tx.add(...instructions);
const messageBytes = new Uint8Array(tx.serializeMessage());

const payloadFingerprint = computeSolanaPayloadFingerprint({ messageBytes });

// Phase 12 verbatim — handle creation
const handle = createHandle({
  args: { /* RAW agent strings */ },
  tx: {
    txType: "solana",
    chainId: 0,
    to: "0x0000000000000000000000000000000000000000",
    valueWei: 0n,
    data: "0x",
    messageBytes,
    feePayer: feePayer.toBase58(),
    recentBlockhash: blockhash,
    programIds: [MARGINFI_PROGRAM_ID],  // from contracts.ts SOT
    instructionSummary: [{ kind: "marginfi-supply", bankPk: bankAddress.toBase58(), amount, decimals }],
  },
  payloadFingerprint,
});
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| MarginFi v1 SDK (`@mrgnlabs/marginfi-client`) | MarginFi v2 (`@mrgnlabs/marginfi-client-v2`) — current major | ~2023 | v1 is fully deprecated; the v2 monorepo is the only maintained surface. |
| Kamino `@solana/web3.js@1.x` (v5.x branch) | Kamino `@solana/kit` v2 (v6.x + v7.x branch) | v6.0.0 published ~2025 (post-Solana Kit GA) | Solana's Kit migration is the future direction; Phase 13 stays on v5.x for v1-stack continuity. Reassess at v2.5+. |
| Hand-rolled Anchor discriminator decoding | SDK-exported `DISCRIMINATOR: Buffer` constants per instruction | both SDKs ship this | Decoder dispatch consumes the constant directly — drift in upstream IDL becomes a typed-import compile error. |

**Deprecated/outdated:**
- MarginFi v1 SDK — replaced by v2; never adopt
- Kamino `KaminoAction.buildXxxTxns` legacy V1 instructions — pass `useV2Ixs: true` per Pitfall 6
- `@solana/spl-token@0.1.x` (MarginFi's transitive pin) — use the top-level Phase 12 `0.4.x` pin; verify hoisting

## Assumptions Log

> All decisions below are `[ASSUMED]` because the slopcheck install was blocked by sandbox policy. Each is corroborated by an authoritative source (linked) but cannot be marked `[VERIFIED]` without third-party legitimacy verification.

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `@mrgnlabs/marginfi-client-v2@6.4.1` is the official MarginFi v2 SDK | Standard Stack | HIGH — wrong-package adoption = silent fingerprint divergence + on-chain refusal. Mitigation: planner gates install behind `checkpoint:human-verify`; user cross-checks against [docs.marginfi.com](https://docs.marginfi.com/) before approving. |
| A2 | `@kamino-finance/klend-sdk@5.15.4` is the official Kamino Lend SDK + last v1-stack release | Standard Stack | HIGH — same risk shape as A1. Mitigation: planner gates install behind `checkpoint:human-verify`; user cross-checks against [docs.kamino.finance](https://docs.kamino.finance/) before approving. |
| A3 | MarginFi v2 production program ID = `MFv2hWf31Z9kbCa1snEPYctwafyhdvnV7FZnsebVacA` | § Topic 8 | MEDIUM — wrong program ID = canonical-dispatch always refuses (server-side detection). Source: `/tmp/marginfi-probe/node_modules/@mrgnlabs/marginfi-client-v2/dist/configs.json` (config-shipped). |
| A4 | Kamino Lend program ID = `KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD` | § Topic 8 | MEDIUM — same risk shape as A3. Source: `/tmp/kamino-v5-probe/node_modules/@kamino-finance/klend-sdk/dist/idl_codegen/programId.js`. |
| A5 | Kamino main market = `7u3HeHxYDLhnCoErrtycNokbQYbWGzLs6JSDqGAv5PfF` | § Code Examples | LOW — main-market constant; misuse surfaces as "market unavailable" at runtime. **CONFIRM AT PLAN TIME** by cross-checking against `kamino.finance` UI or Solscan. |
| A6 | Ledger Solana app blind-signs MarginFi + Kamino (no clear-sign coverage) | § Summary + § Ledger CAL | LOW — verified via 2 official sources ([Ledger blind-signing support](https://support.ledger.com/article/4499092909085-zd), [LedgerHQ/app-solana README](https://github.com/LedgerHQ/app-solana)). Risk is only that Ledger adds Anchor clear-sign coverage mid-phase; in that case the NOTICE block becomes conditional (Phase 28 precedent). |
| A7 | `useV2Ixs: true` is the correct Kamino instruction-version flag | § Pitfall 6 | MEDIUM — wrong choice = legacy code path with no migration plan. **CONFIRM AT PLAN TIME** by checking Kamino SDK tests/examples for the production setting. |
| A8 | MarginFi's `readOnly: true` client option suppresses signing-method invocation in `make*Ix` builders | § Pitfall 1 | MEDIUM — wrong assumption = shim wallet throws during `make*Ix`. Mitigation: planner inserts a smoke test that constructs the read-only client + invokes `make*Ix` against a known-init account; failure surfaces at Wave 0. |
| A9 | Each Phase 13 prepare-tool needs its own canonical clone-of-12-with-bounded-diffs implementation (NOT a generic factory) | § Architecture Patterns | LOW — pattern lock matches Phase 7 + Phase 28 precedent. Factory abstractions defer to v2.5+ ergonomics phase (per CONTEXT.md). |

## Open Questions

1. **Should `get_lending_positions` extend to fan out across MarginFi + Kamino when `chain: "solana"` is passed?**
   - What we know: SOL-W-03 + SOL-W-06 require dedicated per-protocol read tools (`get_marginfi_positions`, `get_kamino_positions`).
   - What's unclear: whether `get_lending_positions` (currently EVM-only) should accept `chain: "solana"` as a sentinel that internally fans out to both.
   - Recommendation: **YES — ship both shapes.** Dedicated tools as primary (required by name); aggregator extension as nice-to-have multi-protocol surface (mirrors Phase 28 Compound extension). Plan 13-05 (additional plan beyond ROADMAP's 4) covers this. If planner descopes, the dedicated tools remain the SOL-W-03/SOL-W-06 source-of-truth.

2. **Should the bank/reserve addresses be agent-supplied per-call (Phase 28 Compound shape) or auto-discovered server-side (Phase 7 Aave shape)?**
   - What we know: MarginFi has dozens of banks (one per asset variant); Kamino main market has ~20+ reserves. Phase 7 Aave auto-discovers per-asset by reading `getReservesData`; Phase 28 Compound requires the agent to name the Comet explicitly.
   - What's unclear: which precedent applies.
   - Recommendation: **AUTO-DISCOVER by asset mint** (Phase 7 shape). For each prepare-tool, the agent passes `mint: <base58>` (or symbol via registry lookup) and the server queries `client.banks` / `market.reserves` for the matching bank/reserve. Multiple banks per mint (rare — staked variants) surface as `INVALID_INPUT` requiring agent disambiguation via explicit `bankPk`/`reservePk`. Document in tool description.

3. **Does Kamino require pre-action `refreshObligation` instruction prepending?**
   - What we know: Kamino oracles can stale; `KaminoAction` includes `setupIxs` that may carry refresh instructions.
   - What's unclear: whether `useV2Ixs: true` makes refresh implicit or requires explicit handling.
   - Recommendation: trust the SDK's `KaminoAction` composition — concatenate ALL 5 instruction arrays in order (Pitfall 4) and let the SDK decide what's needed. Verify at Wave 1 simulation gate.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | Project runtime | ✓ | 18.17+ | — |
| `@solana/web3.js` | Phase 12 + new SDKs | ✓ (already installed) | 1.98.4 | — |
| `@solana/spl-token` | Phase 12 ATA derivation | ✓ (already installed) | 0.4.x | — |
| `viem` | Phase 12 keccak256 binding | ✓ (already installed) | 2.48.11 | — |
| Solana mainnet-beta RPC | Read + simulation paths | ✓ (Phase 11 already configures) | — | — |
| Ledger Solana app | Final signing | external — user-side | — | Blind-sign-disabled state: NOTICE block instructs user to enable in Settings → Blind signing |
| Ledger device + USB-HID transport | Final signing | external — user-side, Phase 11 transport already in place | — | — |

**Missing dependencies with no fallback:** none — Phase 13 adds 2 npm packages and reuses every Phase 11/12 dependency.

**Missing dependencies with fallback:** none.

## Validation Architecture

> Including per nyquist_validation default-on policy (not explicitly disabled in config).

### Test Framework

| Property | Value |
|----------|-------|
| Framework | vitest (Phase 12 baseline) |
| Config file | `vitest.config.ts` (Phase 12 baseline, unchanged) |
| Quick run command | `npx vitest run test/<filename>.test.ts --reporter=dot` |
| Full suite command | `npx vitest run --reporter=dot` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| SOL-W-03 | `get_marginfi_positions` returns bank-keyed surface + health | unit + integration | `npx vitest run test/get-marginfi-positions.test.ts -x` | ❌ Wave 0 |
| SOL-W-04 | `prepare_marginfi_*` produces unsigned MarginFi instructions | unit | `npx vitest run test/prepare-marginfi-supply.test.ts test/prepare-marginfi-{withdraw,borrow,repay}.test.ts -x` | ❌ Wave 0 |
| SOL-W-05 | `prepare_marginfi_account_init` produces unsigned init instruction | unit | `npx vitest run test/prepare-marginfi-account-init.test.ts -x` | ❌ Wave 0 |
| SOL-W-06 | `get_kamino_positions` returns reserve-keyed surface + LTV health | unit + integration | `npx vitest run test/get-kamino-positions.test.ts -x` | ❌ Wave 0 |
| SOL-W-07 | `prepare_kamino_*` produces unsigned Kamino instructions | unit | `npx vitest run test/prepare-kamino-{supply,withdraw,borrow,repay}.test.ts -x` | ❌ Wave 0 |
| SOL-W-08 | `prepare_kamino_obligation_init` produces unsigned init instruction | unit | `npx vitest run test/prepare-kamino-obligation-init.test.ts -x` | ❌ Wave 0 |
| SOL-W-09 | Canonical-dispatch Solana arm refuses unknown program IDs | unit | `npx vitest run test/canonical-dispatch-solana.test.ts -x` | ✓ extends Phase 12 |
| SOL-W-10 | Contracts SOT Solana sub-table accessible via typed getters | unit | `npx vitest run test/config-contracts-solana.test.ts -x` | ❌ Wave 0 |
| Cross-Phase | Fingerprint preimage byte-identity per protocol — canonical fixtures G (marginfi supply) + H (kamino supply) | unit | `npx vitest run test/signing-fingerprint.test.ts -x` | ✓ extends Phase 12 fixture file |
| Cross-Phase | Sender-dependence — same instruction args, different fee-payer → different fingerprint | integration | `npx vitest run test/integration-solana-lending-personas.test.ts -x` | ❌ Wave 0 |

### Sampling Rate

- **Per task commit:** quick-run on the specific test file edited
- **Per wave merge:** full suite via `npx vitest run --reporter=dot`
- **Phase gate:** full suite green before `/gsd:verify-work`

### Wave 0 Gaps

- [ ] `test/get-marginfi-positions.test.ts`
- [ ] `test/get-kamino-positions.test.ts`
- [ ] `test/prepare-marginfi-{account-init,supply,withdraw,borrow,repay}.test.ts` × 5
- [ ] `test/prepare-kamino-{obligation-init,supply,withdraw,borrow,repay}.test.ts` × 5
- [ ] `test/config-contracts-solana.test.ts` — SOT shape regression
- [ ] `test/integration-solana-lending-personas.test.ts` — sender-dependence + persona swap byte-identity
- [ ] `test/signing-fingerprint.test.ts` — append fixtures G (marginfi supply) + H (kamino supply) as hardcoded `0x...` literals
- [ ] Shared fixtures helper for MarginFi mock client (avoid live RPC in unit tests)

## Security Domain

> Phase 13 is security-relevant — adds prepare-tools that author transactions the user signs on Ledger. `security_enforcement` is implicitly enabled.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | No new auth surface; Phase 11 USB-HID + Phase 12 trust-pipeline reused unchanged |
| V3 Session Management | no | No new session shape |
| V4 Access Control | yes | Canonical-dispatch allowlist (Layer 0.5) — program-ID-level access control. Phase 13 adds 2 program IDs; everything else refused. |
| V5 Input Validation | yes | Decimal-string amount via `parseSolanaAmountStrict` (Phase 12 verbatim); base58 pubkey regex for `bankPk`/`reservePk`/`mint`; Anchor 8-byte discriminator decoder enforces well-formed calldata |
| V6 Cryptography | yes | keccak256 + SHA-256 binding — Phase 12 primitives unchanged. No new crypto in Phase 13. |

### Known Threat Patterns for Solana lending integration

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Agent passes malicious bank/reserve address (not in market) | Tampering | Server validates `bankPk`/`reservePk` against `client.banks.has(...)` / `market.getReserveByAddress(...)` at prepare time — refusal precedes instruction build |
| Agent claims one mint but server resolves a different bank (decimal mismatch) | Tampering | MarginFi `TransferChecked`-equivalent: the SDK builders embed mint + amount + decimals into the instruction data; on-chain program verifies. Drift surfaces as simulation-time failure. Mirrors Phase 12 SPL `TransferChecked` defense-in-depth pattern. |
| Phase 12 FROZEN-area drift | Tampering | Phase 13 changes are ADDITIVE only — new files in `src/chains/solana/marginfi/`, `src/chains/solana/kamino/`, new protocol decoders, new tools. `src/signing/payload-fingerprint-solana.ts` + Phase 12 `preview_send.ts` Solana-branch entrypoint stay byte-frozen. The decoder-dispatch extension is the ONLY touched Phase 12 surface and follows the additive-arm convention (new `unknown` → known arm). |
| Stale obligation/account state at preview time | DoS-shaped (preview refuses) | Kamino `cleanupIxs` includes refresh instructions; MarginFi `make*Ix` reads bank state at build time — both surface stale state at the Phase 12 Layer 0.7 `simulateTransaction` gate. |
| Blind-sign UX — user approves without reading | Spoofing (user-side) | `LEDGER_NOTICE_SOLANA_BLIND_SIGN` block at preview UNCONDITIONALLY for Phase 13. Block names: protocol (MarginFi/Kamino), action (supply/withdraw/borrow/repay), bank/reserve, amount + decimals, USD-value-best-effort. User reads the MCP response before approving on-device. Mirrors Phase 6 WETH9.withdraw + Phase 28 Compound precedent. |
| Wrong SDK adoption (slopsquat) | Tampering | `[ASSUMED]` tag on both packages → planner inserts `checkpoint:human-verify` before each install (per slopcheck-unavailable degradation protocol). |

## Sources

### Primary (HIGH confidence — empirical SDK probes)

- `/tmp/marginfi-probe/node_modules/@mrgnlabs/marginfi-client-v2/dist/` — empirically installed and type-probed during this research session (version 6.4.1)
- `/tmp/kamino-v5-probe/node_modules/@kamino-finance/klend-sdk/dist/` — empirically installed and type-probed during this research session (version 5.15.4)
- `/tmp/kamino-probe/node_modules/@kamino-finance/klend-sdk/dist/` — v7.3.22 probed for comparison (REJECTED for v1-stack continuity)
- Phase 12 RESEARCH.md + Phase 12 source code (`src/signing/payload-fingerprint-solana.ts`, `src/protocols/solana-system.ts`, `src/protocols/solana-spl.ts`, `src/security/canonical-dispatch-solana.ts`, `src/tools/prepare_solana_spl_send.ts`, `src/tools/preview_send.ts`) — local read at research time
- Phase 7 (`src/chains/aave-v3.ts`, `src/protocols/aave-v3.ts`, `src/signing/aave-health.ts`) + Phase 28 (`src/protocols/compound-v3.ts`, `src/tools/prepare_compound_supply.ts`) precedent shape

### Secondary (MEDIUM confidence — official docs + GitHub)

- [docs.marginfi.com](https://docs.marginfi.com/) — MarginFi v2 protocol documentation (referenced; not deeply fetched this session)
- [docs.kamino.finance](https://docs.kamino.finance/) — Kamino protocol documentation (referenced; not deeply fetched this session)
- [github.com/LedgerHQ/app-solana](https://github.com/LedgerHQ/app-solana) — Ledger Solana app README, blind-sign requirement for non-System/SPL instructions
- [Ledger support — blind signing in Solana app](https://support.ledger.com/article/4499092909085-zd)
- [Ledger Developer Portal — Solana Signer Kit](https://developers.ledger.com/docs/device-interaction/references/signers/solana)

### Tertiary (LOW confidence — WebSearch corroboration)

- Anchor instruction discriminator format — 8-byte SHA-256 prefix (cross-referenced with MarginFi IDL `dist/idl/marginfi.json` discriminator literal arrays)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — both SDKs installed and `.d.ts` empirically probed
- Architecture patterns: HIGH — directly mirrors Phase 7 + Phase 12 + Phase 28 precedents
- Pitfalls: HIGH — derived from empirical probes; Pitfall 1 (read-only shim) and Pitfall 4 (Kamino multi-array tx composition) are non-obvious failure modes that surfaced from `.d.ts` inspection
- Ledger CAL verdict: HIGH — 2 official sources cross-verified
- Package legitimacy: ASSUMED (slopcheck unavailable); planner gates each install behind `checkpoint:human-verify`

**Research date:** 2026-05-20
**Valid until:** 2026-06-19 (30 days — both SDKs are stable; Kamino v5.x branch published yesterday so monitor for breaking changes; MarginFi v6.4.1 is 4 months stable)
