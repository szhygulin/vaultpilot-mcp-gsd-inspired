# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-05-12)

**Core value:** The user trusts what the Ledger screen shows — nothing else. Tampering at any layer between the agent and the device produces a visible mismatch on-screen before signing.
**Current focus:** Phase 4 — Native ETH send (the trust pipeline) — **code-complete; combined Phase 3+4 verify-phase pending real-Ledger smoke**

## Current Position

Phase: 4 of 10 (Native ETH send — the trust pipeline) — **code-complete**. All 5 plans shipped via PRs #12, #13, #14, #15, #16; 196/196 tests pass; typecheck + build clean. The cryptographic-binding chain is anchored end-to-end via Fixture A (`payloadFingerprint = 0x7e1867b2...`) at prepare + send-time re-check and Fixture C (`presignHash = 0xb28e4824...`) at preview; integration test asserts byte-identity at every transition. PREP-07 schema gate ships as a genuine protocol-boundary defense via the MCP SDK's `AjvJsonSchemaValidator` (architectural fix at `src/server.ts`), not a soft handler check. Combined Phase 3+4 verify-phase is the only thing between v1.0 trust pipeline and "done".
Plan: 5 of 5 done in current phase
Status: Phase 4 code-complete. Combined Phase 3+4 verify-phase pending (manual, requires real Ledger device).
Last activity: 2026-05-12 — Phase 4 planned + executed. Planning bundle (RESEARCH + VALIDATION + PATTERNS + 5 PLAN files) shipped as PR #11 (BLOCK → PASS after 6 inline plan-checker fixes, including the schema-gate test methodology). Then 04-01 (signing infrastructure) shipped as PR #12 (7 atomic commits, 33 new tests, 3 minor deviations). Then 04-02 (prepare_native_send) + 04-05 (4byte + get_tx_verification) shipped in parallel as PR #13 + PR #14 (3 + 6 atomic commits, +10 + +26 new tests; PR #14 had a trivial register-all.ts conflict resolved via rebase). Then 04-03 (preview_send) shipped as PR #15 (1 atomic commit, +15 new tests, 2 minor deviations). Finally 04-04 (send_transaction + integration test) shipped as PR #16 (1 atomic commit, +22 new tests, 2 deviations — one a load-bearing architectural fix to `src/server.ts` adding the MCP SDK's `AjvJsonSchemaValidator` at the CallToolRequest dispatcher, since the low-level `Server` class doesn't validate per-tool inputSchema by default).

Progress: [█████░░░░░] 14/30 plans (47%) — phases 1 + 2 of 10 done; phases 3 + 4 code-complete (verify-phase pending)

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
- **Combined Phase 3+4 verify-phase pending**: requires a real Ledger device with the Ethereum app + Ledger Live paired + `WALLETCONNECT_PROJECT_ID` from cloud.walletconnect.com + a small mainnet ETH balance to broadcast a return-able test transaction. Manual flow batched (per user direction): `WALLETCONNECT_PROJECT_ID=<real> ETHEREUM_RPC_URL=<key-or-publicnode> npm start` → from Claude Code: `pair_ledger_live` → paste wcUri into Ledger Live → approve on device → `get_ledger_status` confirms address matches Ledger Live UI → `prepare_native_send({ to: <return-able addr>, valueWei: "<small> })` → `preview_send({ handle })` → compare `LEDGER BLIND-SIGN HASH` block (full + 4-char-chunked) against device screen → confirm on device → `send_transaction({ handle, previewToken, userDecision: "send" })` → assert returned `txHash` matches Etherscan. Also resolves Assumption A1 (does Ledger device display full hex or chunked form on blind-sign?) and Assumption A2 (does Ledger Live UI surface the session topic?). If A1 differs, edit `LEDGER_BLIND_SIGN_HASH_TEMPLATE` in `src/signing/blocks.ts` accordingly. If A2 differs, edit `VERIFY_ON_DEVICE_TEMPLATE` in `src/tools/pair_ledger_live.ts` to address-only.

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

## Deferred Items

| Category | Item | Status | Deferred At |
|----------|------|--------|-------------|
| *(none yet)* | | | |

## Session Continuity

Last session: 2026-05-12 (Phase 4 code-complete — full v1.0 trust pipeline shipped)
Stopped at: Phase 4 all 5 plans shipped via PRs #12-16; combined Phase 3+4 verify-phase pending real-Ledger smoke
Resume file: None — next action is the manual combined Phase 3+4 verify-phase (requires Ledger device + `WALLETCONNECT_PROJECT_ID` + small mainnet ETH balance), OR `/gsd-plan-phase 5` if the user wants to plan ahead (Phase 5 = demo mode + diagnostics; depends on Phase 4 patterns being stable, which they now are)
