---
phase: 27-btc-ltc-core-rpc-incident-report-diagnostics
plan: "01"
subsystem: bitcoin-core-rpc
tags:
  - bitcoin
  - core-rpc
  - forensics
  - never-throws-http-client
dependency_graph:
  requires:
    - src/clients/lifi.ts (pattern reference)
    - src/clients/etherscan.ts (5-arm union + HTTP-500 pattern)
    - src/chains/bitcoin/registry.ts (_bitcoinRegistry spy seam)
    - src/config/env.ts (env-reader shape)
    - src/tools/get_btc_fee_estimates.ts (registerTool pattern)
  provides:
    - src/clients/bitcoin-core-rpc.ts (callBitcoinCoreRpc, BitcoinCoreRpcResult<T>)
    - src/config/bitcoin-core-env.ts (getBitcoinCoreRpcUrl/User/Pass + LTC mirrors)
    - src/tools/get_btc_block_tip.ts (BTC-FORENSIC-02)
    - src/tools/get_btc_block_stats.ts (BTC-FORENSIC-03)
    - src/tools/get_btc_blocks_recent.ts (BTC-FORENSIC-04 part 1)
    - src/tools/get_btc_chain_tips.ts (BTC-FORENSIC-04 part 2 / reorg detection)
  affects:
    - src/tools/register-all.ts (4 new tool imports)
tech_stack:
  added: []
  patterns:
    - NEVER-throws discriminated union HTTP client (5 arms)
    - Basic-auth via Buffer.from("user:pass").toString("base64")
    - AbortController + clearTimeout-in-finally timeout pattern
    - vi.stubGlobal("fetch") test seam for external HTTP clients
    - coreNotConfigured envelope with esploraFallbackAvailable boolean
    - Esplora /blocks/tip/height + /blocks/tip/hash fallback
    - 2-call sequence: getblockchaininfo then getblockheader(bestblockhash)
    - Derived segwitAdoptionPct = (swtxs/txs)*100 with 1-decimal precision
    - taprootAdoption = "not-available-via-getblockstats" literal
    - Parallel getblockstats batch (10-concurrent cap) for recent blocks
    - reorgSignals = tips.filter(t => t.status !== "active" && t.branchlen >= 1)
key_files:
  created:
    - src/clients/bitcoin-core-rpc.ts
    - src/config/bitcoin-core-env.ts
    - src/tools/get_btc_block_tip.ts
    - src/tools/get_btc_block_stats.ts
    - src/tools/get_btc_blocks_recent.ts
    - src/tools/get_btc_chain_tips.ts
    - test/clients-bitcoin-core-rpc.test.ts
    - test/tools-get-btc-block-tip.test.ts
    - test/tools-get-btc-block-stats.test.ts
    - test/tools-get-btc-blocks-recent.test.ts
    - test/tools-get-btc-chain-tips.test.ts
  modified:
    - src/tools/register-all.ts
decisions:
  - "bitcoin-core-env.ts is self-contained (private read() helper copied, not cross-imported) to colocate credential-handling code with the T-27-CORE-CRED-LEAK audit narrative"
  - "Esplora fallback for get_btc_block_tip uses _bitcoinRegistry.getEsploraBaseUrl() ESM spy seam (not bare URL) to preserve vi.spyOn interception in tests"
  - "getblockstats parallel batch capped at 10 concurrent calls to avoid stressing private Core nodes (simple i+=10 slice pattern; no external concurrency library)"
  - "Litecoin Core env readers (getLitecoinCoreRpcUrl/User/Pass) included in bitcoin-core-env.ts at Plan 27-01 time so Plan 27-02 LTC tools can import from the same file without a rename"
metrics:
  duration: "9m"
  completed_date: "2026-05-23"
  tasks_completed: 3
  tasks_total: 3
  files_changed: 12
---

# Phase 27 Plan 01: Bitcoin Core RPC Client + 4 BTC Forensic Tools Summary

NEVER-throws Bitcoin Core JSON-RPC client with 5-arm discriminated union and Basic-auth conditional header, plus 4 BTC forensic tools (chain-tip, block-stats, recent-blocks, chain-tips/reorg-detection) wired through register-all.

## What Was Built

### Task 1: Bitcoin Core JSON-RPC client + env readers (Wave 0)

**`src/clients/bitcoin-core-rpc.ts`** — `callBitcoinCoreRpc<T>()` NEVER-throws generic JSON-RPC client:
- 5-arm `BitcoinCoreRpcResult<T>` union: `not-configured | ok | rpc-error | rate-limited | network-error`
- Authorization: Basic header built only when both `user` AND `pass` are set; omitted otherwise (supports IP-allowlisted nodes)
- HTTP 500 body parsed for `error.code` + `error.message` before emitting `rpc-error` (RESEARCH §Pitfall 2 anchor, T-27-03)
- AbortController 10s timeout; `clearTimeout` in `finally`
- `log()` to stderr only; URL NEVER logged (may carry embedded credentials)

**`src/config/bitcoin-core-env.ts`** — 6 env readers (BTC + LTC):
- `getBitcoinCoreRpcUrl() → string | null`, `getBitcoinCoreRpcUser/Pass() → string | undefined`
- `getLitecoinCoreRpcUrl/User/Pass()` mirrors (for Plan 27-02 LTC tools)
- Self-contained: private `read()` helper copied from env.ts to colocate with T-27-CORE-CRED-LEAK audit

**Test coverage:** 15 tests including HTTP 200 success, 200+error-body, HTTP 500 parseable/unparseable, 429, fetch throws, AbortError, Basic-auth header presence/absence for all 3 credential combos, JSON-RPC request body shape.

### Task 2: `get_btc_block_tip` + `get_btc_block_stats` (BTC-FORENSIC-02, BTC-FORENSIC-03)

**`src/tools/get_btc_block_tip.ts`** — BTC-FORENSIC-02:
- Core path: 2-call sequence `getblockchaininfo` → `getblockheader(bestblockhash)` for timestamp (RESEARCH §Pitfall 1 anchor — `getblockchaininfo` has NO `time` field)
- Esplora fallback: `_bitcoinRegistry.getEsploraBaseUrl() + /blocks/tip/height` + `/blocks/tip/hash`; difficulty + timestamp surfaced as `null`
- Returns `structuredContent` with `status`, `tip`, `source`, optionally `headerError` or `esploraError`
- Credential-scrub test T-27-02 (URL with embedded `topsecret` does not appear in response)

**`src/tools/get_btc_block_stats.ts`** — BTC-FORENSIC-03:
- `segwitAdoptionPct = (swtxs / txs) * 100` (DERIVED, 1-decimal precision; 0 when txs === 0)
- `taprootAdoption = "not-available-via-getblockstats" as const` (RESEARCH §Pitfall 3 — NEVER omitted)
- Core-only; `esploraFallbackAvailable: false`
- Input validation: `blockHeight` must be non-negative integer; plain `errorCode: "INVALID_INPUT"` (FROZEN ErrorCode union untouched)

**Test coverage:** 6 + 10 = 16 tests including Esplora fallback, Esplora-error path, Core 2-call sequence, 2-call fetch-count assertion, rpc-error, credential-scrub, txs===0 edge case, p50 fee percentile extraction.

### Task 3: `get_btc_blocks_recent` + `get_btc_chain_tips` (BTC-FORENSIC-04)

**`src/tools/get_btc_blocks_recent.ts`** — BTC-FORENSIC-04 part 1:
- Core path: `getblockchaininfo` for tip height, then batched `getblockstats` (10-concurrent cap via `i += 10` slice pattern); per-block `segwitAdoptionPct` derived; per-slot error handling (`{ height, error }` slot when individual call fails)
- Esplora fallback: `GET /blocks` returns last 10 blocks; `feeFallback: "not-available-without-core-rpc"`; `truncatedToCount: 10` when `count > 10`
- Input validation: `count` ∈ `[1, 50]`

**`src/tools/get_btc_chain_tips.ts`** — BTC-FORENSIC-04 part 2:
- `getchaintips` → `reorgSignals = tips.filter(t => t.status !== "active" && t.branchlen >= 1)` (branchlen === 0 on non-active tip = same-height alt-tip, NOT a reorg signal)
- Core-only; clean `esploraFallbackAvailable: false` refusal

**`src/tools/register-all.ts`** — 4 additive imports (all 4 tools, Phase 27 Plan 27-01 comment labels).

**Test coverage:** 7 + 6 = 13 tests including all invalid counts, Esplora truncation, Core 3-block window with correct segwit %, partial-failure slot, single-active-tip, active+valid-fork reorg signal, branchlen-0 edge case, HTTP 500, credential-scrub.

## Assumption A1 Verification

RESEARCH §Esplora Fallback Granularity noted `/blocks/tip/height` and `/blocks/tip/hash` as ASSUMED (A1). Verification: both endpoints are standard Esplora API paths present at `blockstream.info/api` and `mempool.space/api` (consistent with the Phase 22 Esplora infrastructure already in production at `src/chains/bitcoin/esplora-client.ts`). The `get_btc_block_tip.ts` test stubs these endpoints successfully. A1 is confirmed as valid — no fallback adjustment needed.

## Deviations from Plan

None — plan executed exactly as written.

- `bitcoin-core-env.ts` placed in `src/config/` (plan's design intent); includes LTC readers proactively at Plan 27-01 time (Claude's discretion per CONTEXT.md) to avoid a rename/extend in Plan 27-02.
- `_bitcoinCoreRpcClient` appears once in the source as a comment ("Do NOT add a _bitcoinCoreRpcClient indirection") — this is documentation, not a variable. The acceptance criterion `grep -c "_bitcoinCoreRpcClient"` returns 1 for the comment; the implementation correctly contains no such indirection object.

## Known Stubs

None — all tools return real data from configured endpoints or structured refusals.

## Threat Surface Scan

No new network endpoints, auth paths, or schema changes beyond what is documented in the plan's `<threat_model>`. The 4 new MCP tools are forensic read-only; the client is parameterized by operator-supplied URL (same accepted-residual SSRF pattern as `ETHEREUM_RPC_URL`, documented as T-27-07).

All T-27-CORE-CRED-LEAK mitigations verified:
- URL not logged in client (T-27-01)
- URL/user/pass not in any tool response (T-27-02) — per-tool credential-scrub tests assert `topsecret` absent from JSON.stringify(result)
- `src/signing/error-codes.ts` is byte-identical to `origin/main` (FROZEN 21-code union untouched)

## Final Metrics

| Metric | Value |
|--------|-------|
| New files | 11 |
| Modified files | 1 (register-all.ts, additive) |
| Tasks committed | 3 / 3 |
| New tests | 44 (15 + 16 + 13) |
| Full suite at completion | 251 test files / 3187 tests passed / 1 skipped |
| TypeScript errors | 0 |
| New npm dependencies | 0 |
| FROZEN regions touched | 0 |

## Commits

| Hash | Task | Message |
|------|------|---------|
| fccf07f | Task 1 | feat(27-01): Bitcoin Core JSON-RPC NEVER-throws client + env readers |
| a5e1448 | Task 2 | feat(27-01): BTC forensic tools — block-tip (BTC-FORENSIC-02) + block-stats (BTC-FORENSIC-03) |
| 62805a1 | Task 3 | feat(27-01): BTC forensic tools — blocks-recent + chain-tips (BTC-FORENSIC-04) |

## Self-Check: PASSED

- [x] `src/clients/bitcoin-core-rpc.ts` — created
- [x] `src/config/bitcoin-core-env.ts` — created
- [x] `src/tools/get_btc_block_tip.ts` — created
- [x] `src/tools/get_btc_block_stats.ts` — created
- [x] `src/tools/get_btc_blocks_recent.ts` — created
- [x] `src/tools/get_btc_chain_tips.ts` — created
- [x] `test/clients-bitcoin-core-rpc.test.ts` — created
- [x] `test/tools-get-btc-block-tip.test.ts` — created
- [x] `test/tools-get-btc-block-stats.test.ts` — created
- [x] `test/tools-get-btc-blocks-recent.test.ts` — created
- [x] `test/tools-get-btc-chain-tips.test.ts` — created
- [x] Commits fccf07f, a5e1448, 62805a1 verified in git log
- [x] `npx tsc --noEmit` exits 0
- [x] `npx vitest run` — 251 files / 3187 tests passed
