# Phase 13: Patterns — MarginFi + Kamino Solana lending (supply / withdraw / borrow / repay)

**Mapped:** 2026-05-20
**Files classified:** 19 new + 5 modified
**Analogs found:** 24 / 24 (every new file has a clean Phase 7 / Phase 12 / Phase 28 analog)

---

## Pattern-mapper meta-decisions

Six decisions resolved up-front so individual plans don't re-litigate:

1. **MarginFi + Kamino are separate protocol modules — NEVER one shared module.** Anchor IDLs differ (MarginFi: lending-account-shape; Kamino: obligation+reserve-shape); SDK surfaces differ (`MarginfiAccountWrapper.make*Ix` returns a flat `TransactionInstruction[]`; `KaminoAction.build*Txns` carries 5 separate IX arrays per [Pitfall 4](../13-RESEARCH.md#pitfall-4-kaminoactionlendingixs-is-not-a-flat-array)). A shared module would force discriminated unions inside every helper; sibling modules keep each protocol's surface narrow + independent regression. Same precedent shape as Phase 12's `solana-system.ts` vs `solana-spl.ts` split.

2. **Phase 7 (Aave) prepare-tool shape — NOT Phase 28 (Compound) intent-gate.** Compound's 4 intents collapse onto 2 calldata selectors (`supply` / `withdraw` cover both supply/repay + withdraw/borrow). MarginFi + Kamino each expose **4 distinct Anchor instructions** with 4 distinct 8-byte SHA-256 discriminators per [RESEARCH § Standard Stack Alternatives](../13-RESEARCH.md#alternatives-considered). Zero selector collision → no intent-gate prologue needed. The 8 prepare tools (4 per protocol) are direct mechanical clones of `prepare_solana_spl_send.ts` (Phase 12) with the SPL-encoder swap-out for the SDK's `make*Ix` / `KaminoAction.build*Txns` call.

3. **Per-wallet account/obligation bootstrap — AUTO-PREPEND, NOT distinct init tools.** CONTEXT.md anchored "distinct init tools" (`prepare_marginfi_account_init` + `prepare_kamino_obligation_init` per the v1.1 `prepare_revoke_approval` precedent). **Pattern-mapper recommends the OPPOSITE** for Phase 13: auto-prepend the account/obligation init instruction inside the FIRST supply tool when the PDA is absent, parallel to how `prepare_solana_spl_send.ts` auto-prepends `createAssociatedTokenAccountInstruction` when the destination ATA is missing ([RESEARCH Pattern 2](../13-RESEARCH.md#pattern-2-pda-init-then-action-vs-init-prepended) noted both shapes; the SPL-prepend precedent is stronger than the v1.1 `prepare_revoke_approval` precedent because Phase 12 LAND lands the Solana primitives and the prepend pattern is already PROVEN at byte level). User sees one purpose per signature; the prepend is part of the same payload-fingerprint preimage so any tamper at the prepend boundary fails the Layer 3 binding. The orchestrator prompt also said "Recommend auto-include in first supply (mirror Aave's auto-`createAccount` if it exists; or fall back to explicit tool)." — pattern-mapper LOCKS auto-prepend. If user pushes back at discuss-gate, swap to distinct init tools (2 additional prepare tools — `prepare_marginfi_account_init` + `prepare_kamino_obligation_init` — and the supply-tool no longer prepends). **Locked in this PATTERNS pass: auto-prepend.**

4. **Fixture letters — M / N / O / P (MarginFi) + Q / R / S / T (Kamino).** Phase 12 used K (native SOL) + L (SPL TransferChecked) in [`test/signing-fingerprint-solana.test.ts`](../../../test/signing-fingerprint-solana.test.ts) (verified: lines 8-12 reference Fixture K + L; no overlap with EVM Fixtures R/S/T/U because they live in the separate `test/signing-fingerprint.test.ts` file). Phase 13 takes M onwards in the Solana fingerprint test file — 4 letters for MarginFi (deposit / withdraw / borrow / repay) and 4 for Kamino (deposit / withdraw / borrow / repay), 8 total. **No conflict with EVM Compound Fixtures R/S/T/U** — different file, different namespace.

5. **`get_lending_positions` extension AS SECONDARY, dedicated `get_marginfi_positions` + `get_kamino_positions` AS PRIMARY.** SOL-W-03 + SOL-W-06 require the dedicated tools by name. The `chain: "solana"` extension on `get_lending_positions` is a multi-protocol convenience aggregator; mirror Phase 28's discriminated-union widening but with the discriminator going to `protocol: "marginfi" | "kamino"` and the existing `chain: ChainName` enum extending to include `"solana"` as a sentinel that bypasses EVM-side resolution.

6. **Canonical-dispatch-solana EXTENDED, NEVER replaced.** Phase 12 ships `SOLANA_DISPATCH_ALLOWLIST` with 3 entries (System / Token / ATA programs). Phase 13 adds 2 more — MarginFi v2 program (`MFv2hWf31Z9kbCa1snEPYctwafyhdvnV7FZnsebVacA`) + Kamino Lend program (`KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD`). The `Set<string>` is `ReadonlySet` per Phase 12 lock — the extension is a literal-site edit, not a runtime mutation. Pattern-mapper LOCKS Phase 13's 5-entry allowlist: System + Token + ATA + MarginFi + KaminoLend.

---

## File Classification

| New / Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `src/chains/solana/marginfi.ts` | chain client | RPC reads | [`src/chains/aave-v3.ts`](../../../src/chains/aave-v3.ts) + [`src/chains/solana/sol-rpc-client.ts`](../../../src/chains/solana/sol-rpc-client.ts) | role-match (read-only SDK shim + bank/account discovery) |
| `src/chains/solana/kamino.ts` | chain client | RPC reads | [`src/chains/compound-v3.ts`](../../../src/chains/compound-v3.ts) (per-Comet shape) | role-match (per-reserve shape + obligation discovery) |
| `src/protocols/marginfi.ts` | protocol decoder | pure compute | [`src/protocols/solana-spl.ts`](../../../src/protocols/solana-spl.ts) | sibling-module (Anchor 8-byte discriminator vs SPL 1-byte) |
| `src/protocols/kamino.ts` | protocol decoder | pure compute | [`src/protocols/solana-spl.ts`](../../../src/protocols/solana-spl.ts) | sibling-module (same Anchor 8-byte shape) |
| `src/signing/marginfi-health.ts` | trust-shelf math | pure compute (SDK adapter) | [`src/signing/compound-collateralization.ts`](../../../src/signing/compound-collateralization.ts) | role-match (thin adapter, NOT reimplementation) |
| `src/signing/kamino-health.ts` | trust-shelf math | pure compute (SDK adapter) | [`src/signing/compound-collateralization.ts`](../../../src/signing/compound-collateralization.ts) | role-match (LTV-based, not boolean) |
| `src/tools/prepare_marginfi_supply.ts` | MCP prepare tool | request-response | [`src/tools/prepare_solana_spl_send.ts`](../../../src/tools/prepare_solana_spl_send.ts) | exact (SDK swap-out: `wrapper.makeDepositIx`) |
| `src/tools/prepare_marginfi_withdraw.ts` | MCP prepare tool | request-response | Same | exact (`wrapper.makeWithdrawIx`) |
| `src/tools/prepare_marginfi_borrow.ts` | MCP prepare tool | request-response | Same | exact (`wrapper.makeBorrowIx`) |
| `src/tools/prepare_marginfi_repay.ts` | MCP prepare tool | request-response | Same | exact (`wrapper.makeRepayIx`) |
| `src/tools/prepare_kamino_supply.ts` | MCP prepare tool | request-response | Same | exact (`KaminoAction.buildDepositTxns`) |
| `src/tools/prepare_kamino_withdraw.ts` | MCP prepare tool | request-response | Same | exact (`KaminoAction.buildWithdrawTxns`) |
| `src/tools/prepare_kamino_borrow.ts` | MCP prepare tool | request-response | Same | exact (`KaminoAction.buildBorrowTxns`) |
| `src/tools/prepare_kamino_repay.ts` | MCP prepare tool | request-response | Same | exact (`KaminoAction.buildRepayTxns`) |
| `src/tools/get_marginfi_positions.ts` | MCP read tool | request-response | [`src/tools/get_compound_market_info.ts`](../../../src/tools/get_compound_market_info.ts) + [`src/tools/get_solana_token_balance.ts`](../../../src/tools/get_solana_token_balance.ts) | role-match (bank-keyed per-wallet) |
| `src/tools/get_kamino_positions.ts` | MCP read tool | request-response | Same | role-match (reserve-keyed per-wallet) |
| `src/tools/get_marginfi_market_info.ts` | MCP read tool | request-response | [`src/tools/get_compound_market_info.ts`](../../../src/tools/get_compound_market_info.ts) | exact (no wallet arg; per-bank metadata) |
| `src/tools/get_kamino_market_info.ts` | MCP read tool | request-response | Same | exact (per-reserve metadata) |
| **MOD** `src/security/canonical-dispatch-solana.ts` | allowlist gate | pure check | (itself) | additive — 2 program IDs |
| **MOD** `src/signing/blocks-solana.ts` | text templates | pure render | (itself) | append-only — 8 PREPARE_RECEIPT templates |
| **MOD** `src/config/contracts.ts` | config SOT | static data | (itself) | additive Solana sub-table — `marginfiProgram` + `kaminoLendProgram` + `kaminoMainMarket` |
| **MOD** `src/tools/get_lending_positions.ts` | MCP read tool | request-response | (itself) | additive Solana sentinel branch — `chain: "solana"` fans out to both protocols |
| **MOD** `src/tools/simulate_position_change.ts` | MCP compute tool | request-response | (itself) | additive `protocol: "marginfi" \| "kamino"` arms |
| **MOD** `src/tools/register-all.ts` | side-effect register | additive imports | (itself) | additive — 12 new tool imports |
| **MOD** `package.json` | dependency manifest | static | (itself) | additive — 2 new packages (`[ASSUMED]` per [RESEARCH § Package Legitimacy Audit](../13-RESEARCH.md#package-legitimacy-audit)) |

Test files mirror each analog's test shape — full list in §Test Patterns below.

---

## Pattern Assignments (by new plan)

### Plan 13-01 — SOT + protocol decoders + Anchor discriminators + Fixtures M..T + canonical-dispatch extension

**New files:**
- `src/protocols/marginfi.ts`
- `src/protocols/kamino.ts`
- `test/protocols-marginfi.test.ts`
- `test/protocols-kamino.test.ts`
- `test/config-contracts-solana.test.ts` — SOT shape regression (mirror `test/config-contracts.test.ts`).
- `test/signing-fingerprint-solana.test.ts` — **EXTEND** with Fixtures M / N / O / P (MarginFi deposit/withdraw/borrow/repay) + Q / R / S / T (Kamino deposit/withdraw/borrow/repay) as hardcoded `0x…` literals.
- `test/canonical-dispatch-solana.test.ts` — EXTEND with MarginFi + Kamino allowed-arm assertions + still-refused unknown-program arm.

**Modified files:**
- `src/security/canonical-dispatch-solana.ts` — additive: 2 program IDs to `SOLANA_DISPATCH_ALLOWLIST`. (Comment block at lines 19-22 already anticipates this — Phase 12 left the extension point named.)
- `src/config/contracts.ts` — additive Solana sub-table: `marginfiProgram`, `kaminoLendProgram`, `kaminoMainMarket` (the canonical Kamino main-market PublicKey `7u3HeHxYDLhnCoErrtycNokbQYbWGzLs6JSDqGAv5PfF` per [RESEARCH Code Example 2](../13-RESEARCH.md#example-2-kamino-position-read-plan-13-03-sketch); cross-confirm at plan time per [RESEARCH § Assumption A5](../13-RESEARCH.md#assumptions-log)). Sibling const `SOLANA_LENDING_PROGRAMS_RAW: Record<"marginfi" | "kamino", PublicKey>` keyed by protocol name + getter `getSolanaLendingProgramId(protocol)`. Mirror Phase 28's `COMPOUND_COMETS_RAW` shape — wider record at the literal site, narrow typed getter at the consumer site.
- `package.json` — additive: `@mrgnlabs/marginfi-client-v2@6.4.1` + `@kamino-finance/klend-sdk@5.15.4` (both `[ASSUMED]` per [RESEARCH § Package Legitimacy Audit](../13-RESEARCH.md#package-legitimacy-audit) — planner inserts a `checkpoint:human-verify` task before each install).

**Primary analogs:** [`src/protocols/solana-spl.ts`](../../../src/protocols/solana-spl.ts) (Anchor-shape extension) + [`src/security/canonical-dispatch-solana.ts`](../../../src/security/canonical-dispatch-solana.ts) (allowlist extension) + [`src/config/contracts.ts`](../../../src/config/contracts.ts) (SOT extension) + [`test/signing-fingerprint-solana.test.ts`](../../../test/signing-fingerprint-solana.test.ts) (Fixture K / L pattern, extended with M..T).

**Bounded diffs:**

1. **`src/protocols/marginfi.ts`** — mirror `solana-spl.ts:281-390` (decode discriminated union) shape:
   - Anchor 8-byte discriminator constants per instruction — consumed via re-export from `@mrgnlabs/marginfi-client-v2`'s codegen NEVER hand-rolled (see [Pitfall 5](../13-RESEARCH.md#pitfall-5-anchor-8-byte-discriminator-extraction-at-decode-time)). Pinned at module load:
     ```typescript
     // Sourced from @mrgnlabs/marginfi-client-v2/dist/idl/marginfi.json — drift surfaces
     // as a typed-import compile error against the next SDK release.
     export const MARGINFI_DISCRIMINATORS = {
       deposit: Buffer.from([242, 35, 198, 137, 82, 225, 242, 182]),
       withdraw: Buffer.from([183, 18, 70, 156, 148, 109, 161, 34]),
       borrow: Buffer.from([4, 126, 116, 53, 48, 5, 212, 31]),
       repay: Buffer.from([234, 103, 67, 82, 208, 234, 219, 166]),
     } as const;  // CONFIRM at execute time by reading from the SDK's exported per-IX DISCRIMINATOR
     ```
   - `decodeMarginfiCall(instruction: TransactionInstruction): MarginfiDecoded`. Returns 5-arm union: `marginfi-deposit` | `marginfi-withdraw` | `marginfi-borrow` | `marginfi-repay` | `unknown`. Reads bytes `[0..8]` (NOT `[0..4]` — Pitfall 5) and compares against `MARGINFI_DISCRIMINATORS`. Truncated data → `unknown`. NEVER throws.
   - `export const _marginfiProtocols = { decodeMarginfiCall };` ESM spy-affordance per CLAUDE.md.

2. **`src/protocols/kamino.ts`** — same shape:
   - `KAMINO_DISCRIMINATORS` table for `depositReserveLiquidity` / `withdrawObligationCollateralAndRedeemReserveLiquidity` / `borrowObligationLiquidity` / `repayObligationLiquidity` (exact Kamino IX names — confirm at execute time against `@kamino-finance/klend-sdk/dist/idl_codegen/`).
   - `decodeKaminoCall(instruction): KaminoDecoded` returns 5-arm union.
   - `export const _kaminoProtocols = { decodeKaminoCall };`.

3. **`src/security/canonical-dispatch-solana.ts` extension** — bounded diff at lines 65-69:
   ```typescript
   import { getSolanaLendingProgramId } from "../config/contracts.js";  // NEW import

   export const SOLANA_DISPATCH_ALLOWLIST: ReadonlySet<string> = new Set<string>([
     SystemProgram.programId.toBase58(),
     TOKEN_PROGRAM_ID.toBase58(),
     ASSOCIATED_TOKEN_PROGRAM_ID.toBase58(),
     getSolanaLendingProgramId("marginfi").toBase58(),  // NEW — Plan 13-01
     getSolanaLendingProgramId("kamino").toBase58(),    // NEW — Plan 13-01
   ]);
   ```
   The `// v1.x SCOPE — 3 program IDs ONLY` comment at line 13 updates to `// v2.x SCOPE — 5 program IDs (Phase 12 + Phase 13)`. Comment block at lines 19-22 names Phase 14-16 forward extensions; Phase 13 row goes from "Phase 13 — MarginFi + Kamino lending program IDs" (forward-reference) to landed.

4. **`src/config/contracts.ts` Solana sub-table** — pattern from Phase 28's `COMPOUND_COMETS_RAW` (sibling-table-with-typed-getter, NOT widening `ContractsForChain`):
   ```typescript
   import { PublicKey } from "@solana/web3.js";

   export type SolanaLendingProtocol = "marginfi" | "kamino";

   /**
    * Solana lending program IDs per protocol. Phase 13 — Plan 13-01.
    * Cross-confirmed against the published SDK config tables; re-verify at
    * the `checkpoint:human-verify` install gate.
    */
   const SOLANA_LENDING_PROGRAMS_RAW: Record<SolanaLendingProtocol, PublicKey> = {
     marginfi: new PublicKey("MFv2hWf31Z9kbCa1snEPYctwafyhdvnV7FZnsebVacA"),
     kamino: new PublicKey("KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD"),
   };

   export function getSolanaLendingProgramId(p: SolanaLendingProtocol): PublicKey {
     return SOLANA_LENDING_PROGRAMS_RAW[p];
   }

   export const KAMINO_MAIN_MARKET = new PublicKey(
     "7u3HeHxYDLhnCoErrtycNokbQYbWGzLs6JSDqGAv5PfF",
   );  // confirm at plan time via Kamino UI / Solscan
   ```
   Format-fanout-sentinel: every literal lives HERE; consumers route through the getters.

5. **`test/signing-fingerprint-solana.test.ts` Fixtures M..T** — append 8 `it(...)` blocks to the existing Phase 12 file. Pinned inputs (per protocol):
   - Fixture M — MarginFi deposit USDC 100 to a canonical bank — hardcoded `0x…` payloadFingerprint.
   - Fixture N — MarginFi withdraw USDC 100 — hardcoded literal.
   - Fixture O — MarginFi borrow SOL 1 — hardcoded literal.
   - Fixture P — MarginFi repay SOL 1 — hardcoded literal.
   - Fixture Q — Kamino deposit USDC 100 (main market) — hardcoded literal.
   - Fixture R — Kamino withdraw USDC 100 — hardcoded literal.
   - Fixture S — Kamino borrow SOL 1 — hardcoded literal.
   - Fixture T — Kamino repay SOL 1 — hardcoded literal.
   NO `beforeAll`-snapshot per [CLAUDE.md "Cryptographic-binding fixtures pinned as hardcoded literals"](../../../CLAUDE.md). The fingerprint is computed at PR-write time by `computeSolanaPayloadFingerprint` and pinned. Cross-link from each `prepare_*` consumer test.

### Plan 13-02 — MarginFi: client + per-wallet account auto-prepend + 4 prepare tools + read + market_info

**New files:**
- `src/chains/solana/marginfi.ts`
- `src/signing/marginfi-health.ts`
- `src/tools/prepare_marginfi_supply.ts`
- `src/tools/prepare_marginfi_withdraw.ts`
- `src/tools/prepare_marginfi_borrow.ts`
- `src/tools/prepare_marginfi_repay.ts`
- `src/tools/get_marginfi_positions.ts`
- `src/tools/get_marginfi_market_info.ts`
- `test/chains-solana-marginfi.test.ts`
- `test/signing-marginfi-health.test.ts`
- `test/prepare-marginfi-supply.test.ts` (cross-link Fixture M)
- `test/prepare-marginfi-withdraw.test.ts` (Fixture N)
- `test/prepare-marginfi-borrow.test.ts` (Fixture O)
- `test/prepare-marginfi-repay.test.ts` (Fixture P)
- `test/get-marginfi-positions.test.ts`
- `test/get-marginfi-market-info.test.ts`

**Modified files:**
- `src/signing/blocks-solana.ts` — APPEND-ONLY: 4 new templates (`PREPARE_RECEIPT_MARGINFI_SUPPLY_TEMPLATE` / `_WITHDRAW_ / _BORROW_ / _REPAY_TEMPLATE`). Each carries `{BANK}`, `{MINT}`, `{AMOUNT}`, `{RECENT_BLOCKHASH}` slots. Conditional `{INIT_NOTICE}` slot for supply/borrow (when account auto-init prepended).
- `src/tools/register-all.ts` — 6 additive imports (4 prepare + 1 positions + 1 market_info).

**Primary analogs:** [`src/tools/prepare_solana_spl_send.ts`](../../../src/tools/prepare_solana_spl_send.ts) (prepare-tool body shape — verbatim) + [`src/protocols/solana-spl.ts:179-266`](../../../src/protocols/solana-spl.ts) (`buildSplTransferTx` shape — ATA-prepend = init-prepend) + [`src/signing/compound-collateralization.ts`](../../../src/signing/compound-collateralization.ts) (health-math adapter shape) + [`src/tools/get_compound_market_info.ts`](../../../src/tools/get_compound_market_info.ts) (market-info tool shape).

**Bounded diffs:**

1. **`src/chains/solana/marginfi.ts`** — mirror Phase 12's `src/chains/solana/sol-rpc-client.ts` shape + Phase 28's `_compoundChains` indirection shape. Exports:
   ```typescript
   // Read-only shim wallet — see [Pitfall 1](../13-RESEARCH.md#pitfall-1-sdk-initialization-requires-a-wallet-interface).
   // Throws on any signing call. The SDK's `make*Ix` paths never invoke these.
   export function makeReadOnlyWalletShim(publicKey: PublicKey): Wallet;

   export async function loadMarginfiClient(
     connection: Connection,
     feePayer: PublicKey,
   ): Promise<MarginfiClient>;  // wraps MarginfiClient.fetch(getConfig("production"), shim, conn, { readOnly: true })

   export async function readMarginfiAccount(
     client: MarginfiClient,
     authority: PublicKey,
   ): Promise<{ accountAddress: PublicKey; exists: boolean; wrapper?: MarginfiAccountWrapper }>;

   export function findBankByMint(
     client: MarginfiClient,
     mint: PublicKey,
   ): { bankPk: PublicKey } | { kind: "no-bank-for-mint" } | { kind: "multiple-banks"; banks: PublicKey[] };
     // multiple-banks surfaces as INVALID_INPUT with disambiguation hint per [RESEARCH OQ-2](../13-RESEARCH.md#open-questions)

   export const _marginfiChains = {
     loadMarginfiClient,
     readMarginfiAccount,
     findBankByMint,
   };  // ESM spy-affordance per CLAUDE.md
   ```

2. **`src/tools/prepare_marginfi_supply.ts`** — mechanical clone of `prepare_solana_spl_send.ts` with bounded diffs. Pseudocode shape:
   ```typescript
   // 1. Demo-mode + pairing + INPUT_SCHEMA validation — VERBATIM Phase 12.
   // 2. Resolve feePayer (Solana persona / paired account) — VERBATIM Phase 12.
   // 3. Resolve mint decimals via get_solana_token_metadata — VERBATIM Phase 12.
   // 4. Parse amount via parseSolanaAmountStrict — VERBATIM Phase 12.
   // 5. Load MarginfiClient (read-only):
   const client = await _marginfiChains.loadMarginfiClient(connection, feePayer);
   // 6. Auto-discover bank by mint:
   const bankResult = _marginfiChains.findBankByMint(client, mintPubkey);
   if (bankResult.kind === "no-bank-for-mint") return errEnvelope("INVALID_INPUT", "no bank for mint ...");
   if (bankResult.kind === "multiple-banks") return errEnvelope("INVALID_INPUT", "multiple banks ... pass bankPk explicitly", "multiple-banks");
   // 7. Read MarginfiAccount PDA (auto-prepend init if absent — pattern-mapper meta-decision #3):
   const acctResult = await _marginfiChains.readMarginfiAccount(client, feePayer);
   const initIxs: TransactionInstruction[] = acctResult.exists
     ? []
     : await client.makeCreateMarginfiAccountIx();  // SDK helper — confirm exact name at plan time
   // 8. Build the deposit IX via SDK (UNSIGNED — Pitfall: NEVER call .deposit() — that broadcasts):
   const wrapper = acctResult.exists
     ? acctResult.wrapper!
     : MarginfiAccountWrapper.fromAccountAddress(...);  // post-init wrapper shim
   const { instructions: depositIxs } = await wrapper.makeDepositIx(amount, bankResult.bankPk);
   // 9. Fetch recentBlockhash LAST (Pitfall 3):
   const { blockhash } = await connection.getLatestBlockhash();
   // 10. Compose tx (init-prepend FIRST when present, then deposit):
   const tx = new Transaction({ recentBlockhash: blockhash, feePayer });
   tx.add(...initIxs, ...depositIxs);
   const messageBytes = new Uint8Array(tx.serializeMessage());
   // 11. Compute payloadFingerprint — VERBATIM Phase 12:
   const payloadFingerprint = computeSolanaPayloadFingerprint({ messageBytes });
   // 12. createHandle — VERBATIM Phase 12, populate programIds + instructionSummary:
   const handle = createHandle({
     args: { /* RAW agent strings — to/mint/amount */ },
     tx: {
       txType: "solana", chainId: 0, to: "0x0...0", valueWei: 0n, data: "0x",
       messageBytes, feePayer: feePayer.toBase58(), recentBlockhash: blockhash,
       programIds: [MARGINFI_PROGRAM_ID, ...(initIxs.length > 0 ? [...] : [])],
       instructionSummary: [
         ...(initIxs.length > 0 ? [{ kind: "marginfi-account-init", authority: feePayer.toBase58() }] : []),
         { kind: "marginfi-supply", bankPk: bankResult.bankPk.toBase58(), mint: mintPubkey.toBase58(), amount, decimals },
       ],
     },
     payloadFingerprint,
   });
   // 13. PREPARE RECEIPT block — substitute from PREPARE_RECEIPT_MARGINFI_SUPPLY_TEMPLATE:
   //     {INIT_NOTICE} populated when initIxs.length > 0; empty otherwise.
   ```
   - `INPUT_SCHEMA` — `mint` (base58 PublicKey, required), `amount` (decimal string), optional `bankPk` (base58 PublicKey — override auto-discovery for multi-bank-per-mint disambiguation).
   - Locked error codes: `WALLET_NOT_PAIRED`, `WRONG_MODE`, `INVALID_INPUT`, `RPC_FAILURE`, `INTERNAL_ERROR` — all in the 21-code union; NO new codes.
   - DESCRIPTION: ≥100 chars, routing hints first ("Use when X. Do NOT use for Y — call _kamino_supply. Do NOT use for Z — call _aave_supply."). Names blind-sign expectation explicitly.
   - **LEDGER_NOTICE_SOLANA_BLIND_SIGN** — surfaced at preview time (Plan 13-04 wires `preview_send.ts`), not at prepare time. NOTICE emission is unconditional for Phase 13 per [RESEARCH § Summary line 17](../13-RESEARCH.md#summary).

3. **`prepare_marginfi_withdraw.ts` / `_borrow.ts` / `_repay.ts`** — same shape with SDK call swapped:
   - withdraw → `wrapper.makeWithdrawIx(amount, bankPk, { withdrawAll?: boolean })`. Auto-init not needed (you can't withdraw from a non-existent account).
   - borrow → `wrapper.makeBorrowIx(amount, bankPk)`. Auto-init MAY be needed if user borrows before first supply (rare; auto-prepend covers this).
   - repay → `wrapper.makeRepayIx(amount, bankPk, { repayAll?: boolean })`. Auto-init not needed.

4. **`src/signing/marginfi-health.ts`** — thin SDK adapter per [RESEARCH § Don't Hand-Roll](../13-RESEARCH.md#dont-hand-roll). Mirror Phase 28's `compound-collateralization.ts` shape but call through `MarginfiAccount.computeHealthComponents(MarginRequirementType.Maintenance)`:
   ```typescript
   export interface MarginfiHealthOutput {
     assetsUsd: bigint;            // Σ asset value × asset weight (SDK-returned, re-scaled)
     liabilitiesUsd: bigint;
     ratioScaled: bigint | null;   // assetsUsd / liabilitiesUsd, scaled 1e18; null when noDebt
     healthFactor: string | null;  // human-readable decimal — SDK's authoritative answer
     noDebt: boolean;
   }
   export function computeMarginfiHealth(wrapper: MarginfiAccountWrapper): MarginfiHealthOutput;
   export const _marginfiHealth = { computeMarginfiHealth };
   ```
   NOT a reimplementation — the SDK math is protocol-authoritative; this module is a re-shape into the project's `bigint`-only envelope conventions.

5. **`src/tools/get_marginfi_positions.ts`** — per-wallet bank-keyed surface per SOL-W-03. Mirror Phase 28's `get_lending_positions.ts` shape (read leg only). Pseudocode:
   ```typescript
   const client = await _marginfiChains.loadMarginfiClient(connection, wallet);
   const { exists, wrapper } = await _marginfiChains.readMarginfiAccount(client, wallet);
   if (!exists) return { positions: [], accountInitialized: false };
   const positions = wrapper!.account.balances.filter(b => b.active).map(b => { /* bank-keyed row */ });
   const health = computeMarginfiHealth(wrapper!);
   return { positions, accountInitialized: true, ...health };
   ```

6. **`src/tools/get_marginfi_market_info.ts`** — no wallet arg; per-bank metadata (APY, asset weight, liability weight, oracle price, mint, decimals). Mirror `get_compound_market_info.ts` `Promise.all` fan-out across `client.banks` map.

### Plan 13-03 — Kamino: client + per-wallet obligation auto-prepend + 4 prepare tools + read + market_info

**New files:** structurally identical to 13-02 with `marginfi` → `kamino` renamings. 16 new files (8 source + 8 test).

**Modified files:**
- `src/signing/blocks-solana.ts` — APPEND-ONLY: 4 Kamino-specific templates with `{RESERVE}` slot in place of `{BANK}`.
- `src/tools/register-all.ts` — 6 additive imports.

**Primary analogs:** identical to 13-02.

**Bounded diffs specific to Kamino:**

1. **`src/chains/solana/kamino.ts`** — `KaminoMarket.load(connection, KAMINO_MAIN_MARKET)` + `market.getObligationByWallet(wallet, new VanillaObligation(PROGRAM_ID))` + `findReserveByMint(market, mint)`. Same ESM spy-affordance pattern (`_kaminoChains`).

2. **Kamino `KaminoAction.lendingIxs` is NOT a flat array** per [Pitfall 4](../13-RESEARCH.md#pitfall-4-kaminoactionlendingixs-is-not-a-flat-array). Each prepare tool must concatenate in order:
   ```typescript
   const action = await KaminoAction.buildDepositTxns(
     market, amount, reservePk, wallet, new VanillaObligation(PROGRAM_ID),
     undefined,  // currentSlot
     undefined,  // referrer
     true,       // useV2Ixs — LOAD-BEARING per Pitfall 6; lock as a const
   );
   tx.add(
     ...action.computeBudgetIxs,
     ...action.setupIxs,       // includes auto-create-obligation when absent — Kamino's equivalent of MarginFi's createAccount IX
     ...action.inBetweenIxs,
     ...action.lendingIxs,
     ...action.cleanupIxs,
   );
   ```
   The `useV2Ixs: true` flag is a module-level constant in `src/chains/solana/kamino.ts` per [Pitfall 6](../13-RESEARCH.md#pitfall-6-kamino-usev2ixs-flag--load-bearing-choice) — single source of truth.

3. **Kamino health surface** — `KaminoObligation.refreshedStats.{loanToValue,liquidationLtv}` + `getBorrowPower(market, mint, slot)`. Re-shape into:
   ```typescript
   export interface KaminoHealthOutput {
     loanToValue: string;          // Decimal as string per SDK
     liquidationLtv: string;
     borrowPower: string;          // per-asset; surfaces from getBorrowPower
     isBorrowAllowed: boolean;     // LTV < liquidationLtv
     noDebt: boolean;
   }
   ```

### Plan 13-04 — `get_lending_positions` extension + `simulate_position_change` extension + register-all wiring + cross-cutting

**New files:**
- `test/get-lending-positions-solana-sentinel.test.ts` — multi-protocol sentinel `chain: "solana"` arm.
- `test/simulate-position-change-marginfi.test.ts` + `simulate-position-change-kamino.test.ts` — extension tests.

**Modified files:**
- `src/tools/get_lending_positions.ts` — extend `chain` JSON-schema enum to include `"solana"` as a sentinel that bypasses EVM resolution and fans out via `Promise.all([get_marginfi_positions, get_kamino_positions])`. Top-level result widens — `sources.marginfi: {...}`, `sources.kamino: {...}`. Row-level `protocol: "aave-v3" | "compound-v3" | "marginfi" | "kamino"` discriminator (EVM rows byte-identical).
- `src/tools/simulate_position_change.ts` — additive `protocol: "aave-v3" | "compound-v3" | "marginfi" | "kamino"` input slot (default `"aave-v3"` for back-compat). MarginFi + Kamino arms each call into their respective `_marginfiChains` / `_kaminoChains` + `computeMarginfiHealth` / `computeKaminoHealth`.
- `src/tools/register-all.ts` — finalize the carve (last 12 additive imports — 4 MarginFi prepare + 4 Kamino prepare + 2 positions + 2 market_info — landed across 13-02 / 13-03; 13-04 confirms the deterministic line ranges + ensures no overlap).

**Primary analogs:** [`src/tools/get_lending_positions.ts`](../../../src/tools/get_lending_positions.ts) (own pattern — discriminated-union widening) + Phase 28 28-PATTERNS § 2 `get_lending_positions extension` shape.

**Bounded diffs:**

1. **`src/tools/get_lending_positions.ts` Solana sentinel branch** — additive at the top of the handler, BEFORE EVM resolution:
   ```typescript
   if (args.chain === "solana") {
     const [marginfi, kamino] = await Promise.all([
       _toolInternals.callMarginfiPositions(wallet),
       _toolInternals.callKaminoPositions(wallet),
     ]);
     return {
       chain: "solana",
       positions: [...marginfi.positions, ...kamino.positions],  // each row carries `protocol` discriminator
       sources: { marginfi, kamino },
     };
   }
   // ===== EVM branch (UNCHANGED — Phase 7 + Phase 28 byte-identical) =====
   ```
   The EVM branch's `chain: ChainName` extension just becomes `chain: ChainName | "solana"` at the JSON-schema enum + TS type level; the EVM resolution body NEVER reads `"solana"` because the sentinel branch above returns first.

2. **`src/tools/simulate_position_change.ts` arms** — additive `protocol: "marginfi" | "kamino"` arms after the existing `"compound-v3"` arm. Each arm uses the same delta-application + health-recompute shape as Compound's arm; the warning surface widens:
   ```typescript
   // MarginFi arm
   { protocol: "marginfi"; currentRatio, projectedRatio,
     isHealthyCurrent: boolean, isHealthyProjected: boolean,
     warning?: "would-liquidate" | "near-liquidation" }
   // Kamino arm
   { protocol: "kamino"; currentLtv, projectedLtv, liquidationLtv,
     isBorrowAllowedCurrent: boolean, isBorrowAllowedProjected: boolean,
     warning?: "would-liquidate" | "near-liquidation" }
   ```
   Same TRUST-BOUNDARY INVARIANT prose: simulation is a usability signal, never a signing precondition.

3. **`src/tools/preview_send.ts`** — **NO MODIFICATION** in Phase 13. The Phase 12 Solana branch already dispatches on `record.tx.programIds` via `_canonicalDispatchSolana.checkSolanaDispatchTarget`; Plan 13-01 extends the allowlist Set. Decoder dispatch in `previewSendSolanaBranch` is via Phase 12's existing decoded-args shape — Phase 13 inherits it. The MarginFi/Kamino decoders from Plan 13-01 (`_marginfiProtocols.decodeMarginfiCall` + `_kaminoProtocols.decodeKaminoCall`) are CONSUMED by preview_send's Solana branch via a discriminated-union dispatch on the instruction's programId. **Verify at plan time** that Phase 12's `previewSendSolanaBranch` (at `src/tools/preview_send.ts:967`) carries an extensible decoded-args dispatch; if not, this becomes a Phase 13-04 modification (additive arm; preview_send.ts is otherwise FROZEN). Pattern-mapper flags this as a **planner-resolved item** at Wave 4.

4. **LEDGER_NOTICE_SOLANA_BLIND_SIGN unconditional emission** — Phase 12 ships `LEDGER_NOTICE_SOLANA_BLIND_SIGN_TEMPLATE` at [`src/signing/blocks-solana.ts:128`](../../../src/signing/blocks-solana.ts) as a CONDITIONAL block. Phase 13 makes it UNCONDITIONAL for `programIds` that include MarginFi or Kamino. `previewSendSolanaBranch` emits the NOTICE when `record.tx.programIds.some(p => p === MARGINFI_PROGRAM_ID || p === KAMINO_LEND_PROGRAM_ID)`. The template's `{INSTRUCTION_NAME}` slot is populated with the decoded IX kind (e.g. "MarginFi deposit"). Per [RESEARCH § Architecture Patterns](../13-RESEARCH.md#architecture-patterns) — both Anchor programs are out of Ledger CAL clear-sign coverage.

### Plan 13-05 — Lifecycle integration tests (MarginFi + Kamino — separate files)

**New files:**
- `test/marginfi-lifecycle.integration.test.ts` — LOAD-BEARING, mirror `test/compound-v3-lifecycle.integration.test.ts` shape.
- `test/kamino-lifecycle.integration.test.ts` — same.

**Modified files:** none.

**Primary analog:** [`test/compound-v3-lifecycle.integration.test.ts`](../../../test/compound-v3-lifecycle.integration.test.ts) + [`test/solana-trust-pipeline.integration.test.ts`](../../../test/solana-trust-pipeline.integration.test.ts) (Phase 12 LOAD-BEARING).

**Bounded diffs:**

- Full lifecycle: account auto-init (auto-prepend) → supply → borrow → repay → withdraw, repeated for both protocols.
- **Fixture M..T re-anchor across persona swap** — Solana SPL transfers are sender-dependent (Phase 12 Pitfall: source ATA derives from sender). MarginFi + Kamino prepare-tx fingerprints are LIKEWISE sender-dependent because the `MarginfiAccount` / `Obligation` PDAs derive from the `authority`. Integration tests assert: same persona → fingerprint stable; different persona → fingerprint differs AND each persona's fingerprint matches its own pinned literal (mirror Phase 7's `T-INTEGRATION-FROM-DRIFT-2` + Phase 28's `T-INTEGRATION-FROM-DRIFT-1` extension).
- **STOP-THE-LINE label** in each test header. Any fingerprint mismatch across runs (with same persona) → cryptographic-binding broke. Release blocker.

---

## Test Patterns (per new plan)

Every new test mirrors the EXACT shape of the named v1.x / Phase 12 / Phase 28 analog. Conventions:
- Same `vi.mock` factories
- Same `beforeEach` / `afterEach` env-pin + reset-for-testing pair
- Same `vi.spyOn(_<scope>, "method")` ESM-spy-affordance pattern
- **Fixture pins as hardcoded `0x…` literals; NEVER `beforeAll`-snapshot** ([CLAUDE.md Conventions](../../../CLAUDE.md))
- **External client tests use `vi.stubGlobal("fetch", …)` at the network boundary** — per CLAUDE.md "For external network clients … prefer vi.stubGlobal('fetch', …) … the test seam is at the OUTER edge, not between exports." MarginFi + Kamino SDKs make RPC calls through their own clients; tests stub `Connection.getAccountInfo` / `getMultipleAccountsInfo` at the boundary.

| New Test | Mirror | Notes |
|---|---|---|
| `test/protocols-marginfi.test.ts` | [`test/protocols-solana-spl.test.ts`](../../../test/protocols-solana-spl.test.ts) | Anchor 8-byte discriminator decode round-trip; 4-arm discriminated union; truncated data → `unknown`; `_marginfiProtocols` spy intercept |
| `test/protocols-kamino.test.ts` | same | same shape |
| `test/config-contracts-solana.test.ts` | [`test/config-contracts.test.ts`](../../../test/config-contracts.test.ts) | SOT byte-identity assertions on MarginFi + Kamino + Kamino main market PublicKeys |
| `test/signing-fingerprint-solana.test.ts` (EXTEND) | own pattern (Fixtures K + L) | Fixtures M..T hardcoded `0x…` literals; cross-link from every consumer test |
| `test/canonical-dispatch-solana.test.ts` (EXTEND) | own pattern | MarginFi + Kamino allowed; unknown program IDs still refused; `_canonicalDispatchSolana` spy unchanged |
| `test/chains-solana-marginfi.test.ts` | [`test/chains-aave-v3.test.ts`](../../../test/chains-aave-v3.test.ts) + [`test/chains-solana-sol-rpc-client.test.ts`](../../../test/chains-solana-sol-rpc-client.test.ts) | Read-only client factory; bank discovery; account discovery; `_marginfiChains` spy |
| `test/chains-solana-kamino.test.ts` | same + Phase 28 chains-compound-v3 multicall mock | KaminoMarket.load mock; obligation discovery; reserve-by-mint; `_kaminoChains` spy |
| `test/signing-marginfi-health.test.ts` | [`test/signing-aave-health.test.ts`](../../../test/signing-aave-health.test.ts) | SDK-adapter shape; deterministic input → expected-output anchor; noDebt branch |
| `test/signing-kamino-health.test.ts` | same | LTV-based; noDebt branch |
| `test/prepare-marginfi-{supply,withdraw,borrow,repay}.test.ts` (4 files) | [`test/prepare-solana-spl-send.test.ts`](../../../test/prepare-solana-spl-send.test.ts) | Demo-FIRST + pairing + decimal resolution + amount parse + auto-prepend init (supply only) + payloadFingerprint binding + PREPARE RECEIPT verbatim; cross-link Fixtures M/N/O/P |
| `test/prepare-kamino-{supply,withdraw,borrow,repay}.test.ts` (4 files) | same | Fixtures Q/R/S/T; KaminoAction 5-array concatenation order asserted |
| `test/get-marginfi-positions.test.ts` | [`test/get-compound-market-info.test.ts`](../../../test/get-compound-market-info.test.ts) | Bank-keyed surface; accountInitialized: false branch; health surface |
| `test/get-kamino-positions.test.ts` | same | Reserve-keyed surface; obligationInitialized: false branch; LTV surface |
| `test/get-marginfi-market-info.test.ts` | [`test/get-compound-market-info.test.ts`](../../../test/get-compound-market-info.test.ts) | No wallet arg; per-bank metadata; rpcDegraded surface |
| `test/get-kamino-market-info.test.ts` | same | Per-reserve metadata |
| `test/get-lending-positions-solana-sentinel.test.ts` | own pattern | `chain: "solana"` arm; multi-protocol fan-out; EVM arms byte-identical |
| `test/simulate-position-change-marginfi.test.ts` | [`test/simulate-position-change.test.ts`](../../../test/simulate-position-change.test.ts) Compound arm | Delta + recompute; warning surfacing |
| `test/simulate-position-change-kamino.test.ts` | same | Same |
| `test/marginfi-lifecycle.integration.test.ts` | [`test/compound-v3-lifecycle.integration.test.ts`](../../../test/compound-v3-lifecycle.integration.test.ts) | **STOP-THE-LINE** — Full lifecycle + persona-swap byte-identity per fingerprint |
| `test/kamino-lifecycle.integration.test.ts` | same | Same |

---

## Shared Patterns (cross-cutting; apply to every relevant plan)

### Pattern A — ESM spy-affordance indirection (CLAUDE.md convention)

**Source:** [`src/protocols/solana-spl.ts:401-407`](../../../src/protocols/solana-spl.ts) (`_solanaSpl`); [`src/security/canonical-dispatch-solana.ts:123`](../../../src/security/canonical-dispatch-solana.ts) (`_canonicalDispatchSolana`).

**Apply to:**
- `protocols/marginfi.ts` — `_marginfiProtocols = { decodeMarginfiCall }`
- `protocols/kamino.ts` — `_kaminoProtocols = { decodeKaminoCall }`
- `chains/solana/marginfi.ts` — `_marginfiChains = { loadMarginfiClient, readMarginfiAccount, findBankByMint }`
- `chains/solana/kamino.ts` — `_kaminoChains = { loadKaminoMarket, readObligation, findReserveByMint }`
- `signing/marginfi-health.ts` — `_marginfiHealth = { computeMarginfiHealth }`
- `signing/kamino-health.ts` — `_kaminoHealth = { computeKaminoHealth }`

Pattern is non-optional per CLAUDE.md "Add the indirection at write time, not retroactively."

### Pattern B — Fixture literal anchors (CLAUDE.md "Cryptographic-binding fixtures")

**Source:** [`test/signing-fingerprint-solana.test.ts`](../../../test/signing-fingerprint-solana.test.ts) Fixtures K + L.

**Apply to:** Fixtures M..T in the same file. Each fingerprint pinned as hardcoded `0x…` literal. Cross-link from every consumer test. NO `beforeAll`-snapshot.

### Pattern C — Demo-mode FIRST refusal + Solana persona resolution

**Source:** [`src/tools/prepare_solana_spl_send.ts`](../../../src/tools/prepare_solana_spl_send.ts) (`getActiveSolanaPersona()`).

**Apply to:** Every new `prepare_marginfi_*` and `prepare_kamino_*` tool. Read-only Solana persona registry; refuses `WRONG_MODE` when demo on but no Solana persona set.

### Pattern D — PREPARE RECEIPT verbatim (PREP-02)

**Source:** [`src/tools/prepare_solana_spl_send.ts`](../../../src/tools/prepare_solana_spl_send.ts) substitutes from `PREPARE_RECEIPT_SOLANA_SPL_TEMPLATE` using RAW agent strings.

**Apply to:** All 8 new prepare tools. Receipt body reads EXCLUSIVELY from `args.mint`, `args.amount`, `args.bankPk` / `args.reservePk` (when caller-supplied). NEVER substitute the base58-normalized form. `{INIT_NOTICE}` slot populated when account/obligation auto-init prepended.

### Pattern E — `payloadFingerprint` drift gate (PREP-08)

**Source:** [`src/tools/send_transaction.ts`](../../../src/tools/send_transaction.ts) three-gate region — FROZEN. Phase 13 adds NO new fingerprint shape; same `computeSolanaPayloadFingerprint({ messageBytes: record.tx.messageBytes })` recompute as Phase 12.

### Pattern F — Tool description as agent routing prompt

**Source:** [`src/tools/prepare_solana_spl_send.ts`](../../../src/tools/prepare_solana_spl_send.ts) DESCRIPTION array → `.join(" ")`.

**Apply to:** All 12 new Phase 13 tools. Routing hints first: "Use when X (MarginFi supply). Do NOT use for Y (Kamino supply — that's prepare_kamino_supply). Do NOT use for Z (EVM lending — that's prepare_aave_supply / prepare_compound_supply)." ≥100 chars.

### Pattern G — Decimal-string at the boundary

**Source:** [`src/tools/prepare_solana_spl_send.ts`](../../../src/tools/prepare_solana_spl_send.ts) (`parseSolanaAmountStrict` + `get_solana_token_metadata` decimals resolution).

**Apply to:** All 8 prepare tools. Off-by-decimal is the most common user-facing bug class per CLAUDE.md.

### Pattern H — Auto-prepend init instruction (Phase 12 ATA-prepend precedent extended)

**Source:** [`src/protocols/solana-spl.ts:179-266`](../../../src/protocols/solana-spl.ts) (`buildSplTransferTx` auto-prepends `createAssociatedTokenAccountInstruction` when destination ATA absent).

**Apply to:** `prepare_marginfi_supply.ts` (auto-prepend `createMarginfiAccount` IX when `MarginfiAccount` PDA absent) + `prepare_kamino_supply.ts` (auto-prepend obligation creation via `KaminoAction.setupIxs` when obligation absent). `{INIT_NOTICE}` slot in PREPARE RECEIPT surfaces the prepend.

### Pattern I — Mandatory simulation refusal (Solana invariant; Phase 12 lock)

**Source:** [`src/signing/simulation-solana.ts`](../../../src/signing/simulation-solana.ts) (mandatory at preview time per SOL-PREP-02).

**Apply to:** Phase 13 inherits via Phase 12's `previewSendSolanaBranch`. Stale-obligation/account state at preview time → simulation refuses with `SIMULATION_REFUSED`. NO new code; behavior follows from the existing gate.

### Pattern J — LEDGER_NOTICE_SOLANA_BLIND_SIGN unconditional for Phase 13

**Source:** [`src/signing/blocks-solana.ts:128`](../../../src/signing/blocks-solana.ts) — Phase 12 ships the template; Phase 13 promotes it from CONDITIONAL to UNCONDITIONAL for any tx that touches MarginFi or Kamino program IDs. Both Anchor programs are out of Ledger CAL clear-sign coverage per [RESEARCH § Summary line 17](../13-RESEARCH.md#summary).

### Pattern K — Read-only wallet shim for SDK init (Phase 13 greenfield — Pitfall 1)

**Source:** [RESEARCH § Pitfall 1](../13-RESEARCH.md#pitfall-1-sdk-initialization-requires-a-wallet-interface-but-the-mcp-server-has-no-private-keys).

**Apply to:** Both `chains/solana/marginfi.ts` + `chains/solana/kamino.ts`. Construct `readOnlyWallet` with publicKey + throw-on-call signing methods. Pass `{ readOnly: true }` in client options. The SDK's `make*Ix` / `KaminoAction.build*Txns` never invoke signing methods.

### Pattern L — Locked errorCode set (21-code union FROZEN)

**Source:** [`src/signing/error-codes.ts`](../../../src/signing/error-codes.ts) — 21-code union frozen post-Phase 12.

**Apply to:** All Phase 13 tools reuse the existing set: `WALLET_NOT_PAIRED`, `WRONG_MODE`, `INVALID_INPUT`, `RPC_FAILURE`, `LEDGER_NOT_CONNECTED`, `SOLANA_APP_NOT_OPEN`, `LEDGER_REJECTED`, `BROADCAST_FAILED`, `SIMULATION_REFUSED`, `DISPATCH_TARGET_REFUSED`, `INTERNAL_ERROR`. **NO new error codes for Phase 13** — multi-bank-per-mint disambiguation surfaces as `INVALID_INPUT` + `cause: "multiple-banks"`; intent-routing hints surface via `structuredContent.hintTool` field per Phase 28 precedent.

---

## FROZEN areas (do NOT touch — verified absent from every plan's "Modified files")

Per project CLAUDE.md `## Architecture` + Phase 4-12 retros:

- [`src/signing/payload-fingerprint.ts`](../../../src/signing/payload-fingerprint.ts) — FROZEN (EVM preimage; not touched)
- [`src/signing/payload-fingerprint-solana.ts`](../../../src/signing/payload-fingerprint-solana.ts) — FROZEN (Phase 12 lock; Phase 13 CONSUMES via `computeSolanaPayloadFingerprint({ messageBytes })`, never modifies)
- [`src/signing/presign-hash.ts`](../../../src/signing/presign-hash.ts) — FROZEN
- [`src/signing/presign-hash-solana.ts`](../../../src/signing/presign-hash-solana.ts) — FROZEN (Phase 12 lock)
- [`src/signing/simulation.ts`](../../../src/signing/simulation.ts) — FROZEN
- [`src/signing/simulation-solana.ts`](../../../src/signing/simulation-solana.ts) — FROZEN (Phase 12 lock)
- [`src/signing/handle-store.ts`](../../../src/signing/handle-store.ts) — state machine FROZEN. `PrepareArgs` widened in Phase 12 already covers `mint?`, `amount?`, `recentBlockhash?`. `PreparedTxSolana` discriminator already widened to carry `messageBytes`, `programIds`, `instructionSummary` (verified at lines 71-196). Phase 13 reuses unchanged.
- [`src/signing/blocks.ts`](../../../src/signing/blocks.ts) — FROZEN (EVM templates)
- [`src/signing/blocks-solana.ts`](../../../src/signing/blocks-solana.ts) — APPEND-ONLY. Phase 12's 6 templates stay byte-identical; Phase 13 appends 8 new MarginFi + Kamino templates at end-of-file.
- [`src/protocols/solana-system.ts`](../../../src/protocols/solana-system.ts) — FROZEN (Phase 12 lock)
- [`src/protocols/solana-spl.ts`](../../../src/protocols/solana-spl.ts) — FROZEN
- [`src/tools/prepare_solana_native_send.ts`](../../../src/tools/prepare_solana_native_send.ts) — FROZEN
- [`src/tools/prepare_solana_spl_send.ts`](../../../src/tools/prepare_solana_spl_send.ts) — FROZEN (Phase 12 lock — the CLONE source for Phase 13 prepare tools, never modified itself)
- [`src/tools/preview_send.ts`](../../../src/tools/preview_send.ts) **lines 161-419 (EVM FROZEN body) + 967+ (Solana branch)** — verify at planner time whether Phase 12's `previewSendSolanaBranch` carries an extensible decoded-args dispatch. If yes, Phase 13 adds NO new code; the dispatch routes through `_canonicalDispatchSolana` (allowlist) + protocol decoders (`_marginfiProtocols.decodeMarginfiCall` / `_kaminoProtocols.decodeKaminoCall`) added by Phase 13. If no, Phase 13-04 adds a single discriminated arm; preview_send.ts is otherwise FROZEN.
- [`src/tools/send_transaction.ts`](../../../src/tools/send_transaction.ts) **three-gate region (lines 195-316)** — FROZEN. Phase 13 inherits via Phase 12's `sendTransactionSolanaBranch`; NO new fingerprint shape so no recompute extension.
- [`src/tools/get_tx_verification.ts`](../../../src/tools/get_tx_verification.ts) — FROZEN
- [`src/wallet/ledger-solana-transport.ts`](../../../src/wallet/ledger-solana-transport.ts) — FROZEN (Phase 11 + Phase 12 lock; per-call USB-HID transport)
- [`src/signing/error-codes.ts`](../../../src/signing/error-codes.ts) **21-code union** — FROZEN. Phase 13 reuses existing codes; intent-routing hints surface via `structuredContent.hintTool` (Phase 28 precedent).

**Verification:** Every plan in this PATTERNS.md leaves the FROZEN list untouched. Each Phase 13 plan's `<success_criteria>` MUST include a zero-diff assertion on these files (`git diff --quiet -- <file>` or equivalent).

---

## Coordination Points (multi-plan carve)

### `src/tools/register-all.ts` — touched by Plans 13-02 + 13-03 + 13-04

| Plan | Imports added | Position rule |
|---|---|---|
| 13-02 | `get_marginfi_positions`, `get_marginfi_market_info`, `prepare_marginfi_{supply,withdraw,borrow,repay}` (6 lines) | After existing Phase 12 + Phase 28 prepare-tool imports; group reads vs prepares per Phase 28 precedent |
| 13-03 | `get_kamino_positions`, `get_kamino_market_info`, `prepare_kamino_{supply,withdraw,borrow,repay}` (6 lines) | After 13-02's insertion |
| 13-04 | none (just confirms wiring) | n/a |

When 13-02 + 13-03 land in the same wave, the merge is conflict-free at deterministic line ranges.

### `src/signing/blocks-solana.ts` — touched by 13-02 + 13-03 (APPEND-ONLY)

| Plan | Templates added | Position |
|---|---|---|
| 13-02 | 4 MarginFi PREPARE_RECEIPT templates | After Phase 12's `VERIFY_BEFORE_SIGNING_SOLANA_TEMPLATE` (last block in current file) |
| 13-03 | 4 Kamino PREPARE_RECEIPT templates | After 13-02's MarginFi block |

Each plan touches a distinct line range; trivial rebase if order swaps.

### `src/security/canonical-dispatch-solana.ts` — touched by 13-01 ONLY

Single-plan modification. 2 additive lines in the `SOLANA_DISPATCH_ALLOWLIST` Set initializer + 1 comment update.

### `src/config/contracts.ts` — touched by 13-01 ONLY

Single-plan modification. Solana lending sub-table + typed getters + `KAMINO_MAIN_MARKET` const.

### `src/tools/get_lending_positions.ts` + `simulate_position_change.ts` — touched by 13-04 ONLY

Single-plan modifications. Sentinel `chain: "solana"` arm at the top of each handler; existing EVM body byte-identical.

### `package.json` — touched by 13-01 ONLY

Single-plan modification. 2 additive dependencies. **`checkpoint:human-verify` gate REQUIRED before install** per [RESEARCH § Package Legitimacy Audit](../13-RESEARCH.md#package-legitimacy-audit).

---

## Wave Structure

```
Wave 1: 13-01 (SOT + Anchor decoders + Fixtures M..T literal anchors +
              canonical-dispatch extension + package.json + checkpoint:human-verify)
        └─ foundational — every downstream plan depends on the program IDs +
           decoders + Fixture pins. Includes the SDK installs.

Wave 2: 13-02 (MarginFi: client + per-wallet account auto-prepend + 4 prepare
              tools + read + market_info)
        └─ depends on 13-01 (uses program ID + decoders + Fixtures M/N/O/P).

Wave 3: 13-03 (Kamino: client + per-wallet obligation auto-prepend + 4 prepare
              tools + read + market_info)
        ├─ depends on 13-01 (uses program ID + decoders + Fixtures Q/R/S/T).
        └─ does NOT depend on 13-02 (sibling protocol; no shared file).

Wave 4: 13-04 (get_lending_positions + simulate_position_change extensions +
              LEDGER_NOTICE_SOLANA_BLIND_SIGN unconditional + register-all
              wiring + preview_send Solana decoder dispatch (if needed))
        └─ depends on 13-02 + 13-03 (both protocol surfaces must exist to fan
           out).

Wave 5: 13-05 (MarginFi lifecycle integration test ∥ Kamino lifecycle
              integration test — separate files, can land same commit)
        └─ depends on 13-04 (full pipeline must be wired).
```

**Parallel-eligible pairs:**

Pattern-mapper recommends **STRICT SEQUENTIAL** per [CLAUDE.md "Phase Resource-Intensive Parallel Work Sequentially"](../../../CLAUDE.md) — each prepare-tool plan ships 4 npm-test runs + 1 lint + 1 build cycle; parallel 13-02 ∥ 13-03 saturates CPU + API quota. Phase 12 + Phase 28 set the precedent (Phase 12 explicit "None inside Phase 12" parallel-eligible; Phase 28 "Recommendation: serial"). Phase 13 follows.

**IF the user wants parallel** at execute time: 13-02 ∥ 13-03 is structurally safe (no shared files between MarginFi and Kamino source; register-all + blocks-solana coordination handled at deterministic line ranges). 13-04 ∥ 13-05 less safe — 13-04 needs both prepare-tool surfaces wired before integration tests run.

**Strict-sequential pairs:**
- 13-01 → 13-02 (program IDs + decoders + Fixtures needed)
- 13-01 → 13-03 (same)
- 13-02 + 13-03 → 13-04 (both protocol surfaces needed)
- 13-04 → 13-05 (full pipeline must be wired)

**Plan count proposed: 5 (13-01 through 13-05).**

**Alternative 4-plan collapse:** Drop 13-05 by folding integration tests INTO 13-04 (single plan covers cross-cutting + integration). Pattern-mapper recommends KEEPING 13-05 SEPARATE — integration tests are STOP-THE-LINE; making them a distinct plan with its own success gate matches Phase 12-05 precedent and surfaces failure isolated from cross-cutting work. **Lock: 5 plans.**

---

## Metadata

**Analog search scope:** `src/chains/`, `src/protocols/`, `src/signing/`, `src/tools/`, `src/security/`, `src/config/`, `test/`. Phase 7 + Phase 12 + Phase 28 PATTERNS docs referenced inline.

**Files read full / targeted:** Phase 12 12-PATTERNS.md (563 LOC — full); Phase 28 28-PATTERNS.md (839 LOC — full); `src/security/canonical-dispatch-solana.ts` (123 LOC); `src/signing/blocks-solana.ts` (214 LOC); `src/protocols/solana-spl.ts` (407 LOC); `src/config/contracts.ts` (head, 100 LOC); `src/signing/error-codes.ts` (head, 80 LOC); `src/tools/prepare_compound_supply.ts` (head, 120 LOC); `src/signing/handle-store.ts` (Solana discriminator grep); `src/tools/preview_send.ts` (txType dispatch grep). Test directory listing for fixture-letter assignment.

**Pattern extraction date:** 2026-05-20.

**No-analog items:** 1 pattern is partially new — **read-only Wallet shim for SDK init** (Pattern K). The shape is greenfield because Phase 12's `prepare_solana_*` tools don't use a Wallet-typed SDK surface; MarginFi + Kamino both require it. Mitigated by the shim throwing on every signing call (defensive — invariant fails LOUD at test time).

**Reference PATTERNS docs:**
- [`.planning/phases/07-aave-v3-ethereum/07-PATTERNS.md`](../07-aave-v3-ethereum/07-PATTERNS.md) — prepare-tool mechanical-clone discipline
- [`.planning/phases/12-solana-native-spl-trust-pipeline/12-PATTERNS.md`](../12-solana-native-spl-trust-pipeline/12-PATTERNS.md) — Solana trust-pipeline primitives (FROZEN consumers)
- [`.planning/phases/28-evm-compound-v3-supply-withdraw-borrow-repay/28-PATTERNS.md`](../28-evm-compound-v3-supply-withdraw-borrow-repay/28-PATTERNS.md) — multi-protocol read-tool extension shape

**Open coordination points for planner:**
- **OQ-P1:** Phase 12's `previewSendSolanaBranch` at `src/tools/preview_send.ts:967+` — verify whether the decoded-args dispatch is extensible. If yes, Phase 13 adds NO preview_send modification; if no, Plan 13-04 adds a single additive arm.
- **OQ-P2:** MarginFi SDK exact method name for account creation IX (`makeCreateMarginfiAccountIx` vs `createMarginfiAccount` vs something else). Pattern-mapper sketched the call site; planner verifies against installed `.d.ts` at install time per [CLAUDE.md "Type-check researcher call sketches against the installed .d.ts"](../../../CLAUDE.md).
- **OQ-P3:** Kamino `KaminoAction.buildDepositTxns` exact parameter list (`useV2Ixs` position, currentSlot/referrer optionality). Pattern-mapper sketched per [RESEARCH Code Example 3](../13-RESEARCH.md#example-3-marginfi-supply-prepare-tool-plan-13-04-sketch); planner verifies.
- **OQ-P4:** Auto-prepend init pattern (meta-decision #3) — pattern-mapper LOCKED auto-prepend. If user reverses at discuss-gate, swap to 2 distinct init tools (10 prepare tools total instead of 8); plan structure stays the same.
