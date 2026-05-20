# Phase 11 Plan-Check Report

**Checked:** 2026-05-20
**Worktree:** `.claude/worktrees/phase-11-plan` (branch `plan/phase-11`)
**Plans verified:** 11-01 .. 11-06

## Overall verdict

**FLAG-WITH-INLINE-FIXES** — 0 blockers, 3 flags, 2 nits. Plans are structurally sound and faithful to the 11-RESEARCH locks. Goal-backward coverage is intact. Three cheap fixes recommended before execute; none requires replanning.

## Dimension verdicts (10)

1. **Requirements coverage — PASS.** All twelve required IDs covered:
   - PAIR-NEV-01..04, 06 → Plan 11-01
   - PAIR-NEV-05 → Plan 11-01 (store ops) + Plan 11-04 (`list_paired_non_evm_accounts` + `remove_paired_non_evm_account`)
   - PAIR-NEV-07 → Plan 11-04 (`get_vaultpilot_config_status` extension)
   - SOL-01, SOL-02 → Plan 11-04
   - SOL-03 → Plan 11-02 (RPC client) + Plan 11-05 (`get_solana_balance`)
   - SOL-04 → Plan 11-05 (`get_solana_token_balance` + `get_solana_token_metadata`)
   - SOL-05 → Plan 11-05 (`get_portfolio_summary` Solana leg + curated registry) + Plan 11-06 (demo persona)

2. **Wave order soundness — PASS** with one caveat (see FLAG #1). Declared `depends_on` graph: 11-01 → (11-02 ∥ 11-03) → 11-04 → (11-05 ∥ 11-06). 11-04 depends_on `[11-01, 11-03]`; 11-05 depends_on `[11-01, 11-02]`; 11-06 depends_on `[11-01, 11-02]`. No later plan reads a file from an even-later plan.

3. **FROZEN-area discipline — PASS.** Every plan (11-01..11-06) `<success_criteria>` asserts `git diff origin/main -- src/signing/payload-fingerprint.ts src/signing/presign-hash.ts src/signing/handle-store.ts src/tools/send_transaction.ts` returns EMPTY. Verbatim across all six.

4. **Test methodology — PASS.** 11-01 names `test/non-evm-store.eager-init.test.ts` as the mirror of `test/wallet-session-manager.eager-init.test.ts` (PAIR-NEV-04 restore-on-startup regression anchor — Test 8: "Order-of-operations regression (PAIR-NEV-02)"). 11-03 pins the bs58-encoded address as a hardcoded literal (Test 7). All twelve new test files mirror named v1.x analogs.

5. **Research-finding propagation — PASS.**
   - UNPARSED `getTokenAccountsByOwner` + `AccountLayout.decode`: 11-02 plan §5 + success-criterion #5; 11-05 D-7 RE-AFFIRMED + Test 2 (UNPARSED PATH regression) + Solana-leg fan-out doc-comment.
   - `bs58.encode` on Buffer: 11-03 §2 imports + handler body + Tests 4, 5, 7 + success-criterion (CRITICAL regression).
   - 3-level path `44'/501'/<account>'`: 11-03 `DEFAULT_SOLANA_DERIVATION_PATH = "44'/501'/0'"` + Test 5 asserts `app.getAddress` called with `"44'/501'/0'"`; 11-04 saves it on `saveAccount` (`derivationPath: DEFAULT_SOLANA_DERIVATION_PATH`).

6. **`register-all.ts` carve coordination — PASS.** Each plan names its exact insertion anchor. 11-04 inserts 4 lines AFTER line 14 (`get_ledger_status.js`). 11-05 inserts 3 lines AFTER line 9 (`get_portfolio_summary.js`). 11-06 adds zero lines. Non-overlapping line regions; conflict-free during Wave 3 → Wave 4 progression.

7. **Multi-chain `get_portfolio_summary` shape — PASS.** 11-05 extends in-place via `FungibleBalanceRow` discriminated union (`chain: "ethereum" | ... | "solana"`); deprecated `erc20Balances` alias preserved for one phase. 11-06 ships sibling `SolanaPersona` interface — does NOT widen the EVM `Persona.slug` literal-union. Both faithful to PATTERNS surprises #2 + #3.

8. **Eager-init pattern — PASS.** 11-01 cites PR [#61](https://github.com/szhygulin/vaultpilot-mcp-gsd-inspired/pull/61) at multiple points (execution_context + plan §3 + success-criterion). Insertion point named verbatim: `src/server.ts:212` (between `:211` `eagerInitWalletConnectIfPersist();` and `:213` `server.connect(transport)`).

9. **Spy-affordance discipline — PASS.** 11-01 exports `_storage = { readFileSync, writeFileSync, renameSync, existsSync, ensureStorageDirWithPerms }`. 11-03 exports `_transport = { isSupported, list, open, buildSolanaApp }`. Both have explicit regression tests proving the indirection intercepts (would silently no-op without).

10. **Phase 12 boundary — PASS.** No plan extends `prepare_*` / `preview_send` / `send_transaction`. Plan 11-06 carries a `simulationEnvelopeShape: "simulateTransaction"` typed field as a Phase 12 anchor but does NOT consume it (typed not wired).

## Per-plan verdicts

- **11-01: PASS** — foundational store + eager-init mirror PR #61 verbatim; PAIR-NEV-01..06 covered; spy-affordance indirection committed; corrupt-file forensic-preserve discipline named.
- **11-02: PASS** — D-7 UNPARSED path load-bearing in doc-comment + success-criterion; lamports surface as bigint to preserve decimal-string boundary; `_solanaRegistry` indirection committed. (See FLAG #1.)
- **11-03: PASS-with-flag** — bs58-encode regression locked at byte-identical fixture; transport per-call (not singleton) per research USB-HID handle-cleanup invariant; `try/finally` close enforced. (See FLAG #1.)
- **11-04: FLAG** — `get_vaultpilot_config_status` extension surfaces `pairedNonEvmChains` + `pairedNonEvmAccountCount` + `nonEvmStoragePersistent`, but MISSES `solanaRpcConfigured` (ROADMAP Success Criterion #13 + RESEARCH § Topic 10 line 484). Shoulder-surfing defense locked with 3-sentinel substring scan.
- **11-05: PASS** — discriminated-union widening + deprecated `erc20Balances` alias kept for one phase; UNPARSED path regression locked; curated registry DOA validation at module load.
- **11-06: PASS** — sibling `SolanaPersona` interface (no EVM widening); EXECUTOR-VERIFIED address ritual documented (Q-2); DOA `new PublicKey(addr)` at module load; cross-linked `DEMO_MODE_REFUSED` integration regression with Plan 11-04.

## BLOCKERs (must replan before execute)

None.

## FLAGs (cheap inline fixes before execute)

1. **11-03 `bs58@5.0.0` install coordination with 11-02 in same Wave 2.** Plan 11-03 imports `bs58` (line 61) and pins success on `bs58.encode(rawPubkey)` (line 121, 178). Its execution_context (line 39) explicitly says "`bs58@5.0.0` already in Plan 11-02" but `depends_on: []`. If Wave 2 commits 11-03 first against fresh main, `import bs58 from "bs58"` will not typecheck. **Fix:** either (a) add `bs58@5.0.0` to 11-03's `package.json (modify)` step (idempotent — npm dedupes if 11-02 also adds it), OR (b) declare `depends_on: [11-02]` on 11-03 (collapses Wave 2 parallelism — costlier). Recommend (a).

2. **11-04 missing `solanaRpcConfigured` field in `get_vaultpilot_config_status`.** ROADMAP Success Criterion #13 names `solanaRpcConfigured` alongside `pairedNonEvmChains` + `nonEvmStoragePersistent`. RESEARCH § Topic 10 line 484 names it. Plan 11-04 §6 lists only three fields and omits this one. **Fix:** add to Plan 11-04 §6 "extend the response with three new fields" → "four new fields": append `solanaRpcConfigured: boolean` — derived from `getSolanaRpcUrl() !== null` (env URL explicitly configured; the public-RPC fallback does NOT count as configured, mirroring v1.x EVM `RPC_PROVIDER` boolean semantics). Add a test to `test/get-vaultpilot-config-status.solana.test.ts`: env set → `true`, env unset → `false`. Cross-update the plan's `<success_criteria>` block and PAIR-NEV-07 assertion.

3. **11-05 `get_portfolio_summary` `wallet` arg semantics for Solana.** Plan 11-05 line 159 says "The Solana leg uses the paired Solana address from `listAccounts({ chainFilter: "solana" })[0]`, NOT the agent's `wallet` arg." This is correct for the paired-Ledger flow but breaks demo-mode (where there's no paired account — Plan 11-06 says `pair_solana_ledger` refuses in demo). In demo mode the Solana leg has no address to fan out against. **Fix:** name the demo-mode fallback explicitly — in demo mode, use the active Solana persona's `solanaAddress` (from Plan 11-06's `getActiveSolanaPersona()`); in real mode, use the paired record. Add this to Plan 11-05 §6 fan-out gate AND add a test case to `test/get-portfolio-summary.solana.test.ts`: demo mode + active Solana persona → Solana leg fans out against persona address. This closes a real coverage gap with REQUIREMENTS SOL-05 + Plan 11-06's "demo-mode Solana reads against real RPC" claim.

## NITs (record-only)

1. **11-05 Plan §5 `get_solana_token_metadata.ts` is a NEW tool not strictly in REQUIREMENTS.** SOL-04 says "mirrors v1.x `get_token_metadata` shape" — naming the tool is fine; just confirming it's intentional scope expansion (mirror-completeness over minimum-shippable). No action needed.

2. **11-06 Plan §4 `get_demo_wallet.ts` widening to `evmPersonas` + `solanaPersonas` is a back-compat break for any caller reading the existing flat `personas` array.** Plan does not mention a deprecated-alias preservation pass (cf. 11-05's deprecated `erc20Balances` alias). Low impact (demo-mode tool surface; agent-facing only). Recommend a one-line note in 11-06 success-criteria that the response shape changes; verify-phase can decide whether to ship a flat-alias.

## Cross-plan concerns

- **`register-all.ts` parallel-execution safety:** verified non-overlapping line regions (11-04 after line 14, 11-05 after line 9, 11-06 zero edits). Wave 4 parallelism (11-05 ∥ 11-06) is conflict-free at this file. Wave 2 parallelism (11-02 ∥ 11-03) does not touch register-all.ts at all.
- **Package.json install ordering (see FLAG #1):** `bs58@5.0.0` cross-plan coupling. Resolved via FLAG #1.
- **Demo-mode `wallet` arg coverage (see FLAG #3):** the demo-mode-against-real-RPC pattern requires the Solana persona's address to flow into the portfolio fan-out. The handshake between Plans 11-05 and 11-06 is implicit; making it explicit closes the gap.
- **Phase 12 prep boundary:** confirmed no plan brushes `prepare_*` / `preview_send` / `send_transaction`. Phase 11 is reads + pairing only. The `simulationEnvelopeShape` field in `SolanaPersona` is typed but not consumed in Phase 11 — recorded as Phase 12 anchor.
- **PAIR-NEV-07 surfacing already addressed at `get_vaultpilot_config_status`:** the existing tool's DIAG-01 secret-safety scan applies; 11-04 §6 leaves the existing scrub in place and only adds chain-name + count + boolean fields. Confirmed clean.
