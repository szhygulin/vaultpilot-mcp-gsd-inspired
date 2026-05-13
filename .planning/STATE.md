---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: MVP
status: verifying
stopped_at: "Phase 5 all 3 plans shipped via PRs #19-21; v1.0 MVP code-complete; combined Phase 3+4+5 verify-phase pending real-Ledger smoke"
last_updated: "2026-05-13T09:15:00.000Z"
last_activity: "2026-05-13 — Quick task 260513-c8e (issue #25 WC session persistence) shipped on fix/wc-session-persist. 3 atomic commits: feat(wc) persist + clear-on-force-re-pair, test(wc) global hermeticity pin via VAULTPILOT_WC_STORAGE=memory in test/setup.ts, feat(diag)+docs(security) walletConnectStoragePersistent boolean in get_vaultpilot_config_status + new SECURITY.md at repo root (resolves dangling src/server.ts:39 INSTRUCTIONS reference). 304→329 tests pass; zero diff in src/signing/ + src/security/; hermeticity verified (~/.vaultpilot-mcp/wc-storage absent post-npm-test). Closes #25."
progress:
  total_phases: 5
  completed_phases: 0
  total_plans: 17
  completed_plans: 2
  percent: 12
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-05-12)

**Core value:** The user trusts what the Ledger screen shows — nothing else. Tampering at any layer between the agent and the device produces a visible mismatch on-screen before signing.
**Current focus:** Phase 5 — Demo mode + diagnostics — **code-complete; v1.0 MVP feature set DONE; combined Phase 3+4+5 verify-phase pending real-Ledger smoke**

## Current Position

Phase: 5 of 10 (Demo mode + diagnostics) — **code-complete**. All 3 plans shipped via PRs #19, #20, #21; 260/260 tests pass; typecheck + build clean. **v1.0 MVP feature surface is DONE** — Phases 1-5 cover the entire v1.0 requirements set (INST-01..05 + READ-01..06 + PAIR-01..05 + PREP-01..10 + DEMO-01..07 + DIAG-01..04). The cryptographic-binding chain holds under both real-mode and demo-mode rehearsal (Fixture A `0x7e1867b2...` + Fixture C `0xb28e4824...` byte-identical across both, proving PREP-03's preimage is `from`-independent). Combined Phase 3+4+5 verify-phase (real Ledger pair + small mainnet broadcast + demo-mode persona rehearsal) is the only thing between v1.0 trust pipeline and "shipped".
Plan: 3 of 3 done in current phase
Status: Phase 5 code-complete. v1.0 MVP done in code. Verify-phase pending (manual, requires real Ledger + WALLETCONNECT_PROJECT_ID + small mainnet ETH balance).
Last activity: 2026-05-13 — Quick task 260513-c8e (issue #25 WC session persistence) shipped on `fix/wc-session-persist`. 3 atomic commits: `feat(wc)` persist + clear-on-force-re-pair, `test(wc)` global hermeticity pin via `VAULTPILOT_WC_STORAGE=memory` in `test/setup.ts`, `feat(diag)`+`docs(security)` `walletConnectStoragePersistent` boolean in `get_vaultpilot_config_status` + new `SECURITY.md` at repo root (resolves dangling `src/server.ts:39` INSTRUCTIONS reference). 304→329 tests pass; zero diff in `src/signing/` + `src/security/`; hermeticity verified (`~/.vaultpilot-mcp/wc-storage` absent post-`npm test`). Closes #25.

Prior activity: 2026-05-12 — Phase 5 planned + executed. Planning bundle (RESEARCH + VALIDATION + PATTERNS + 3 PLAN files) shipped as PR #18 (PASS after 2 inline plan-checker fixes + 1 accepted residual; Q-CONTRADICTION-PREP Option B + Q-NPM resolved via AskUserQuestion before planning). Then 05-01 (demo state + persona registry + ErrorCode 13→14 with WRONG_MODE + get/set_demo_wallet) shipped as PR #19 (+29 tests, 3 ESM-mechanics deviations). Then 05-02 (Q-CONTRADICTION-PREP Option B — REMOVES demo refusal from prepare_native_send + preview_send; persona address as `from`; integration test re-anchors Fixture A + C under demo `from`) shipped as PR #20 (+9 net tests, zero substantive deviations). Finally 05-03 (DIAG tools + update check + auto-demo NOTICE dispatcher-wrap + INSTRUCTIONS rewrite) shipped as PR #21 (+26 tests, 2 minor deviations; secret-safety audit via 3-sentinel substring scan; dispatcher-wrap at src/server.ts one-change architectural-scope-correct per Phase 4 precedent).

Progress: [██████████] 17/30 plans (57%) — phases 1-5 of 10 code-complete; **v1.0 MVP feature set complete; v1.1-v3.5 remain**

## Performance Metrics

**Velocity:**

- Total plans completed: 0
- Average duration: —
- Total execution time: —

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| - | - | - | - |

**Recent Trend:**

- Last 5 plans: —
- Trend: —

*Updated after each plan completion*

## Accumulated Context

### Roadmap Evolution

- Phase 8 edited: Added plan 08-05 (WalletConnect proposal namespace expansion) and success criterion #8 — surfaced during physical-device testing: WC pairing only offered Ethereum accounts even though src/wallet/session-manager.ts:57-59 has a Phase 8 fan-out comment. Plan count 4→5; Progress row 0/4→0/5.

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.

Recent decisions affecting current work:

- Initial scaffolding: Vertical-slice MVP over breadth-first; verify-phase per milestone exercises a real end-to-end flow
- Initial scaffolding: `@modelcontextprotocol/sdk` over FastMCP for v1.x
- Initial scaffolding: `viem` over ethers.js
- Initial scaffolding: BUSL-1.1 license from day one
- Initial scaffolding: Companion `vaultpilot-preflight` skill deferred to v1.3 (residual risk documented in SECURITY.md from day one)
- Docs sync (PR #672): NFT reads moved from out-of-scope to v3.1 milestone; marketplace fills stay deferred (need typed-data signing surface)
- Docs sync (PR #672): BTC + LTC ship as one v2.2 milestone (shared Esplora + Ledger BTC infra); not split into separate milestones
- Docs sync (PR #672): v1.3 hardening expanded from one verification tool (`get_verification_artifact`) to three (`get_verification_artifact` + `verify_tx_decode` + `get_tx_verification`) — each covers a distinct attacker model
- Docs sync (PR #672): v1.1 scope expanded to include the full ERC-20 lifecycle (transfer + approve + revoke + WETH unwrap), not just transfer; approval-class surfacing becomes load-bearing here

### Pending Todos

None yet.

### Blockers/Concerns

- **Phase 1 verify-phase open**: requires user with a Claude Code instance to run `claude mcp add vaultpilot-mcp -- node /Users/s/dev/vaultpilot/vaultpilot-mcp-gsd-inspired/dist/index.js` and confirm `claude mcp list` shows it as connected. The in-process initialize-handshake test covers server construction; the real-stdio path is the only thing not yet exercised.
- **Phase 3 verify-phase pending**: requires `WALLETCONNECT_PROJECT_ID` from https://cloud.walletconnect.com + a Ledger device with Ledger Live paired. Manual flow: `WALLETCONNECT_PROJECT_ID=<real> npm start` → from Claude Code call `pair_ledger_live` → paste `wcUri` into Ledger Live → Connect a Dapp → approve on device → call `get_ledger_status` → confirm address matches Ledger Live → Settings → Connected Apps. Also resolves research § Assumption A2 (whether Ledger Live's UI surfaces the session topic) — if not, edit `VERIFY_ON_DEVICE_TEMPLATE` in `src/tools/pair_ledger_live.ts` to address-only + update Test 1's regex.
- **Combined Phase 3+4+5 verify-phase pending** (v1.0 ship gate): requires a real Ledger device with Ethereum app + Ledger Live paired + `WALLETCONNECT_PROJECT_ID` from cloud.walletconnect.com + a small mainnet ETH balance for a return-able test broadcast. Manual flow batched (per user direction):
  1. **Real-mode trust pipeline**: `WALLETCONNECT_PROJECT_ID=<real> ETHEREUM_RPC_URL=<key-or-publicnode> npm start` → `pair_ledger_live` → paste wcUri into Ledger Live → approve on device → `get_ledger_status` confirms address → `prepare_native_send({ to: <return-able addr>, valueWei: "<small>" })` → `preview_send({ handle })` → compare `LEDGER BLIND-SIGN HASH` block (full + 4-char-chunked) against device screen → confirm on device → `send_transaction({ handle, previewToken, userDecision: "send" })` → assert returned `txHash` matches Etherscan.
  2. **Fresh-install auto-demo path**: `mv ~/.vaultpilot-mcp ~/.vaultpilot-mcp.bak; unset VAULTPILOT_DEMO; npm start` → any tool call → confirm first response carries `VAULTPILOT NOTICE — Auto demo mode active` block → second tool call does NOT repeat the NOTICE → `mv ~/.vaultpilot-mcp.bak ~/.vaultpilot-mcp` to restore.
  3. **Demo-mode rehearsal path**: `VAULTPILOT_DEMO=true npm start` → `get_demo_wallet` (lists 4 personas) → `set_demo_wallet({ persona: "whale" })` → `get_portfolio_summary` (vitalik's real on-chain portfolio) → `prepare_native_send` → `preview_send` → `send_transaction({ ..., userDecision: "send" })` → assert `simulated: true` envelope, never broadcast.
  4. **Diagnostics path**: `get_vaultpilot_config_status` (booleans/counts only) + `get_ledger_device_info` (inferred-state envelope).
  
  Resolves Assumption A1 (Ledger blind-sign hash display form) + A2 (Ledger Live Connected Apps UI) + A3 (real signClient.request roundtrip returns txHash not signed bytes). If A1 differs, edit `LEDGER_BLIND_SIGN_HASH_TEMPLATE` in `src/signing/blocks.ts`. If A2 differs, edit `VERIFY_ON_DEVICE_TEMPLATE` in `src/tools/pair_ledger_live.ts`.

### Phase 1 retro

- **Parallel-agent race on shared main**: dispatched 01-02 + 01-03 as parallel subagents both writing to `main`. Mid-execution the 01-03 agent's `git checkout HEAD --` (cleaning its working set before its commit) un-staged some of 01-02's in-flight files. The 01-02 agent caught it on post-commit `git status` and shipped a recovery commit (7b24bb5). No data lost; tests + build green after recovery. **Lesson**: for Phase 2+ parallel dispatch, give each subagent its own `.claude/worktrees/<branch-name>/` worktree per the global CLAUDE.md "one worktree per feature" rule. The orchestrator merges branches after both complete. **Applied in Phase 2 — zero races.**
- **Plan-boundary slip**: 01-02-PLAN.md said "don't touch src/index.ts" but 01-03 agent legitimately needed to fix a pre-existing typecheck failure there (the JSON default-import shape on the `--version` branch). Surfaced as deviation in agent report. **Lesson**: when one plan owns "the bin entrypoint wires both handlers" by virtue of writing both stubs (01-01), file-ownership boundaries between later plans need to acknowledge the shared file. Either: route shared-file changes through the orchestrator, or explicitly carve `src/index.ts` as "contested — first agent to touch announces, other agent reads after."

### Phase 2 retro

- **Worktree isolation worked**: each of 4 plans (02-01, 02-02, 02-03, 02-04) ran in its own `.claude/worktrees/<branch>/` checkout. Parallel agents (02-02 + 02-04) committed independently without any race. PR-per-plan + admin-merge gave a clean linear history on `main`.
- **Side-effect-import registration pattern held up**: each tool module's top-level `registerTool(...)` call is the side effect; `register-all.ts` is just imports. 02-04 added 4 imports, 02-03 added 1 — both edited the same file but git auto-merged trivially because they touched different lines.
- **Agent design deviation worth noting**: 02-03 plan said "fan out native + ERC-20 + pricing in three concurrent calls"; agent shipped sequential pricing-after-balances on the rationale that only addresses with non-zero balances need pricing (better cache hit rate). Reasonable; preserved in source comment.
- **Driving gsd from source vs installed**: I'm running gsd from the source repo, not from a registered install. This compresses the formal subagent contracts (planner / plan-checker / verifier) into my own dispatch. For Phase 3+, recommended path is to install gsd properly per the upstream instructions and use `/gsd-plan-phase 3` + `/gsd-execute-phase 3`. Audited as clean; cost is a Claude Code restart + a fresh conversation.

### Phase 3 retro

- **Full GSD pipeline ran end-to-end**: `/gsd-plan-phase 3` orchestrated researcher → pattern-mapper (parallel) → planner → plan-checker → execute (per-plan worktree dispatch). Each phase produced its canonical artifact; planning bundle landed as one PR (#7), then one PR per execution plan (#8, #9). No mid-flight context resets or recovery commits.
- **Research-time SDK probing paid off**: researcher verified `@walletconnect/sign-client@2.23.9` against installed type defs (Pattern 1 + Pattern 2 in 03-RESEARCH.md had working call sketches). The planner consumed these and produced concrete plans with verified code snippets.
- **Planner-research drift caught by SDK type defs at execute time**: 03-01 execution surfaced two SDK-API mistakes the planner inherited from research: `storageOptions: { dbName }` should be `{ database }` (verified at `keyvaluestorage/dist/types/shared/types.d.ts`), and `parseAccountId` returns `{ namespace, reference, address }` not `{ chainId, address }`. TS strict mode caught both immediately. Executor's `Deviation:` discipline made the corrections visible in PR #8's body. **Lesson**: a future research-step improvement is to type-check the call sketches against the dist type defs as part of researcher output, not just at execute time. Cost was small (single iteration of in-worktree fixes), but it's a pattern.
- **Plan-checker's 3 MEDIUM flags were correctly graded**: R1 (multi-digit chainId test) was a 1-line plan edit before commit; R2 (session_delete listener test independence) + R3 (A2 code-level fallback) were both correctly classified as residuals — neither blocks Phase 3 verify-phase or Phase 4 dependency. Plan-checker didn't catch the 2 SDK-API issues that execute-phase later caught — they only surface against installed type defs, not against plan-text reading.
- **Zero parallel agents in Phase 3**: 03-02 strictly depends on 03-01 (imports session-manager + walletconnect-client + env helpers). Sequential execution was the right call; no worktree races because no parallelism to race.

### Phase 4 retro

- **Plan-checker BLOCKER caught the load-bearing test methodology gap.** The originally-planned PREP-07 schema-gate test was an in-test ajv compile (proves the schema-as-written rejects, NOT that the SDK validates before invoking the handler). Plan-checker correctly graded this as BLOCK and prescribed the fix: dispatch through the actual SDK pipeline with a `vi.fn()` handler spy. The fix surfaced at planning gate, before any code shipped — saved a round of execute-then-realize.
- **Architectural fix correctly scoped at execute time.** At execute-phase, the 04-04 agent discovered the MCP SDK's low-level `Server` class doesn't validate per-tool `inputSchema` by default — only the high-level `McpServer` does, which this project doesn't use. Implementing PREP-07 as a per-handler check would have been the soft-check pattern PREP-07 explicitly forbids. The agent applied the global CLAUDE.md "System-Rejection-Reframing" rule correctly: fixed the SDK integration in `src/server.ts` using the SDK's own `AjvJsonSchemaValidator` at the `CallToolRequest` dispatcher. This makes PREP-07 a genuine protocol-boundary defense for ALL tools (defense-in-depth retroactively for Phase 1+2+3 tools too), not just `send_transaction`. **Lesson**: when an SDK constraint blocks a load-bearing security property, fixing the SDK integration is the right architectural scope — much better than per-tool defensive checks that each ship a hole.
- **Parallel execution worked at the right granularity.** 04-02 + 04-05 ran in parallel worktrees (both depend only on 04-01); both PRs trivially conflicted on `register-all.ts` (both added import lines at the same final position); resolved via rebase — 30 seconds of work. The merge order is what matters: 04-01 → (04-02 ∥ 04-05) → 04-03 → 04-04. Phase 3's "no parallelism because of strict deps" lesson became Phase 4's "parallelism wherever deps allow + accept the trivial rebase cost".
- **Fixture anchoring paid off end-to-end.** Fixture A (`payloadFingerprint = 0x7e1867b2...`) and Fixture C (`presignHash = 0xb28e4824...`) are hardcoded literals in `test/signing-fingerprint.test.ts` + `test/signing-presign-hash.test.ts` (04-01), re-asserted in `test/prepare-native-send.test.ts` (04-02), re-asserted in `test/preview-send.test.ts` (04-03), and asserted byte-identical-end-to-end in `test/trust-pipeline.integration.test.ts` (04-04). Drift in any layer breaks the test at exactly that layer. The cryptographic-binding chain is testable.
- **PR-volume: 6 PRs in one phase.** Phase 4 alone shipped: PR #11 (planning bundle) + PR #12 + PR #13 + PR #14 + PR #15 + PR #16. Each PR was small enough to review in 5-10 min, atomic enough to revert cleanly, and named via conventional commits so the git log reads as a build narrative. Plan-as-PR-batching pattern held up.
- **Single-atomic-commit per plan after 04-01.** 04-01 needed 7 atomic commits (Wave 0 helpers + 5 W1 primitives, each a cohesive unit). 04-02 + 04-03 + 04-04 each shipped as 1 atomic commit covering handler + side-effect-import + tests. 04-05 shipped 6 atomic commits (TDD-ordered). The granularity matched the plan's `<execution_context>` `Commit shape:` declaration, which was right.

### Phase 5 retro

- **Design-fork questions caught via AskUserQuestion BEFORE planning.** Two questions surfaced from research that couldn't be reasonable-call'd: Q-CONTRADICTION-PREP (prepare/preview refuse in demo vs succeed via persona) and Q-NPM (update check upstream-collision). Asking before the planner ran saved a re-plan round. Pattern: when research surfaces a real design fork (not a question of mechanics), surface to user via AskUserQuestion at planning gate — cheaper than realizing after PLAN.md files exist.
- **Behavioral change to shipped Phase 4 code (Plan 05-02) executed cleanly because the test-surface change was named explicitly.** PATTERNS.md § Phase 4 Test Surface Changes called out the EXACT line ranges in `prepare-native-send.test.ts` + `preview-send.test.ts` + `send-transaction.test.ts` Test 9 that needed REPLACING (not deleting) — specifically the `createHandleSpy.toHaveBeenCalledTimes(0)` assertions that flip to `1` under Option B. Plan-checker dimension 2 flagged this as load-bearing. Executor shipped zero substantive deviations. Pattern: when a plan modifies shipped code's test assertions, enumerate the exact replacements in PATTERNS.md so the executor can't drift.
- **Fixture A `from`-independence proved end-to-end.** The Phase 5 integration test (`test/demo-flow.integration.test.ts`) takes Phase 4's fixture inputs verbatim, swaps `from` from a Ledger-paired address to vitalik (whale persona), and `payloadFingerprint` MATCHES `0x7e1867b2...` byte-identically. This proves PREP-03's preimage is `from`-independent (the preimage is `chainId + to + valueWei + data`, NOT `from`). The cryptographic-binding chain gained a second-axis regression anchor: drift in any layer breaks Fixture A or C; accidental `from` introduction into the preimage breaks Fixture A in demo mode specifically.
- **ESM module-mocking quirks surfaced at execute time.** Plan 05-01 needed an `_paths` indirection in `config-file.ts` because ESM named-export bindings don't intercept internal calls within the same module (vi.spyOn on `getConfigPath` was a no-op for `readConfigFile()`'s internal call). The agent's fix mirrored Phase 3's `__client` re-export trick. Pattern: any ESM module whose exports are called internally by other exports in the same module needs a deliberate spy-affordance (object indirection OR per-call import).
- **Dispatcher-wrap pattern reused correctly.** Plan 05-03's auto-demo NOTICE wrap and update-check fire-and-forget both landed at `src/server.ts`'s CallToolRequest dispatcher (one change), NOT per-tool (N changes). Phase 4's schema-gate set the precedent; Phase 5 inherited it. The two response-middleware responsibilities (input validation + response augmentation) layer cleanly: gate → handler → wrap.
- **Persona archetype mismatch deferred to Phase 6.** Plan-checker flagged `defi-degen` and `staking-maxi` being mapped to Binance hot wallets (stable + non-OFAC but not thematically faithful). Accepted as residual: Phase 5 ships no DeFi-aware read tools that would surface the mismatch; Phase 6 ERC-20 enumeration tests will. Documented inline in 05-01-PLAN.md § Accepted Residuals; tracked as a known-followup.
- **v1.0 MVP feature set complete.** Phases 1-5 cover INST-01..05 + READ-01..06 + PAIR-01..05 + PREP-01..10 + DEMO-01..07 + DIAG-01..04. The combined Phase 3+4+5 verify-phase (real Ledger pair + small mainnet broadcast + auto-demo + demo-rehearsal + diagnostics) is the only thing between v1.0 trust pipeline and "shipped".

## Quick Tasks Completed

| Date | Slug | Branch | Summary |
|------|------|--------|---------|
| 2026-05-12 | [wc-multi-account-session](./quick/20260512-wc-multi-account-session/SUMMARY.md) | `fix/wc-multi-account-session` | Plumb all CAIP-10 accounts in WC v2 session; add `set_active_account` tool; signing pipeline reads `activeAccount`. 6 atomic commits, 304/304 tests pass. |
| 2026-05-13 | [persist-walletconnect-session-across-mcp](./quick/260513-c8e-persist-walletconnect-session-across-mcp/260513-c8e-SUMMARY.md) | `fix/wc-session-persist` | Persist WC v2 session under `~/.vaultpilot-mcp/wc-storage/` (0o700, dir-not-file); opt out via `VAULTPILOT_WC_STORAGE=memory`; force-re-pair clears on-disk store before `client.disconnect`. New `SECURITY.md` + `walletConnectStoragePersistent` boolean in `get_vaultpilot_config_status`. 3 atomic commits + 25 new tests (304→329); zero diff in `src/signing/` + `src/security/`. Closes #25. |

## Deferred Items

| Category | Item | Status | Deferred At |
|----------|------|--------|-------------|
| *(none yet)* | | | |

## Session Continuity

Last session: 2026-05-12 (Phase 5 code-complete — v1.0 MVP feature set DONE in code)
Stopped at: Phase 5 all 3 plans shipped via PRs #19-21; v1.0 MVP code-complete; combined Phase 3+4+5 verify-phase pending real-Ledger smoke
Resume file: None — next action is the manual combined Phase 3+4+5 verify-phase (the v1.0 ship gate; requires Ledger device + `WALLETCONNECT_PROJECT_ID` + small mainnet ETH balance), OR `/gsd-plan-phase 6` if the user wants to start v1.1 work (Phase 6 = ERC-20 lifecycle + Aave V3; depends on Phase 5 personas/demo + Phase 4 trust pipeline being stable, which they now are; the Phase 6 ERC-20 enumeration tests will also surface the persona-archetype mismatch documented as accepted residual in 05-01)
