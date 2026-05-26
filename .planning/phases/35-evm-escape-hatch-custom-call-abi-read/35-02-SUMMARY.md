---
phase: 35-evm-escape-hatch-custom-call-abi-read
plan: 02
subsystem: tools/escape-hatch
tags: [read-contract, abi-eth-call, view-only-gate, custom-03, multi-chain]
requires:
  - 35-01 (fetchEtherscanAbi + ABI_NOT_AVAILABLE)
provides:
  - read_contract MCP tool (multi-chain)
  - NON_VIEW_FUNCTION ErrorCode (refusal for state-mutating eth_call attempts)
  - First codebase consumer of low-level publicClient.call({ to, data })
affects:
  - src/tools/read_contract.ts (NEW)
  - src/signing/error-codes.ts (APPEND-ONLY)
  - src/tools/register-all.ts (APPEND-ONLY)
  - test/read-contract.test.ts (NEW)
tech-stack:
  added: []
  patterns:
    - "low-level viem.publicClient.call({ to, data }) — NOT readContract"
    - "ABI-entry stateMutability gate as runtime dispatch boundary"
    - "compose-of-two-analogs: get_token_metadata.ts (RPC half) + check_contract_security.ts (ABI-fetch half)"
    - "bigint-safe content.text serialization via JSON.stringify custom replacer"
    - "vi.mock chains/registry seam + vi.stubGlobal('fetch', ...) for Etherscan boundary"
key-files:
  created:
    - path: src/tools/read_contract.ts
      lines: 333
    - path: test/read-contract.test.ts
      lines: 519
  modified:
    - path: src/signing/error-codes.ts
      delta: "+13/-1"
      change: "APPEND `NON_VIEW_FUNCTION` arm to ErrorCode union"
    - path: src/tools/register-all.ts
      delta: "+1"
      change: "APPEND import './read_contract.js'"
decisions:
  - "Low-level publicClient.call({ to, data }) over viem.readContract: gives fine-grained error-arm control. The three error sources (ABI fetch, RPC, decode) each surface a distinct INTERNAL_ERROR cause string — readContract bundles them and would mask the layer."
  - "stateMutability gate fires BEFORE encode + call — Test 4 asserts client.call is invoked 0 times when the gate refuses. Refusal text contains the verbatim stateMutability value AND a routing hint to prepare_custom_call."
  - "ABI fetch's `not-verified` arm surfaces as INTERNAL_ERROR with cause `abi-not-verified` (NOT a verified:false envelope) — the plan calls this out explicitly to prevent a future contributor from silently degrading to a blind-call. Mirror of T-ETHERSCAN-MASK-1 mitigation in check_contract_security."
  - "Function-not-in-ABI uses ABI_NOT_AVAILABLE (reused from Plan 35-01) — distinct from NON_VIEW_FUNCTION (which fires when the function IS in the ABI but mutates state). Both refusals are typed as ErrorCode arms."
  - "Bigint serialization: structuredContent.decoded retains the raw bigint (MCP supports rich types); content.text uses JSON.stringify with a custom replacer to render bigints as strings. Test 13 asserts the text NEVER contains `[object`."
  - "Encode-time errors (wrong arg arity / type mismatch) map to INVALID_INPUT (not INTERNAL_ERROR) — the agent supplied invalid args, not an environment failure. Decode errors map to INTERNAL_ERROR (the ABI / on-chain data disagreed — a server-class issue from the agent's perspective)."
  - "Description string deliberately avoids the substring `readContract` (worded as 'NOT the high-level viem contract-read action') to satisfy the plan's grep acceptance criterion `grep -v '^\\s*//' src/tools/read_contract.ts | grep -c \"readContract\"` returns 0 — even string-literal mentions of a forbidden API counted against the threshold."
  - "Test seam: vi.mock(`../src/chains/registry.js`) replaces getChainClient with a vi.fn() that returns a stub `client.call`. This mirrors get-token-metadata.test.ts's pattern. The Etherscan fetch is stubbed via vi.stubGlobal('fetch', ...) — the network boundary lives inside src/clients/etherscan.ts (per CLAUDE.md: external network clients use stubGlobal, not internal indirection)."
metrics:
  duration: 12 minutes wall-clock (excluding mid-run worktree-rebase recovery)
  completed: 2026-05-26
---

# Phase 35 Plan 35-02: read_contract — ABI-driven eth_call with view-only gate — Summary

## One-liner

`read_contract` MCP tool composes wave-1's `fetchEtherscanAbi` + viem.encodeFunctionData + low-level `publicClient.call({ to, data })` + viem.decodeFunctionResult; refuses state-mutating functions at runtime via stateMutability inspection (NON_VIEW_FUNCTION); ABI-fetch failures surface verbatim with no blind-call fallback; first codebase consumer of low-level `publicClient.call`.

## Artifacts shipped

### NEW files

| File | Lines | Role |
| ---- | ----- | ---- |
| `src/tools/read_contract.ts` | 333 | MCP tool — ABI fetch + view-gate + viem encode + low-level publicClient.call + viem decode |
| `test/read-contract.test.ts` | 519 | 16 tests / 13 plan-spec cases + 3 extras: per-chain happy paths, non-view refusal (× 2 — nonpayable + payable), function-not-in-ABI, all 3 ABI-error arms, RPC error, cache persistence, parse-once invariant, missing API key, bigint serialization, register-all wiring, encode-sanity |

### MODIFIED files

| File | Delta | Change |
| ---- | ----- | ------ |
| `src/signing/error-codes.ts` | +13/-1 | APPEND `NON_VIEW_FUNCTION` arm to ErrorCode union (Plan 35-02 — read_contract refuses state-mutating function) |
| `src/tools/register-all.ts` | +1 | APPEND `import "./read_contract.js"; // Phase 35 Plan 35-02 (CUSTOM-03)` after the wave-1 `get_contract_abi` line |

## Tests passing

- **Baseline (wave 1 final):** 4353 passing / 1 skipped / 319 files
- **Final:** 4369 passing / 1 skipped / 320 files
- **Delta: +16 tests, +1 file**
  - +16 from `test/read-contract.test.ts` (NEW)
- Full suite green at every commit boundary (Task 1, Task 2).
- TypeScript strict-mode typecheck: clean.

## FROZEN-area zero-diff confirmation

`git diff origin/main -- src/signing/payload-fingerprint.ts src/signing/presign-hash.ts src/signing/handle-store.ts src/tools/send_transaction.ts src/clients/fourbyte.ts` → **EMPTY** (0 lines)

`git diff origin/main -- src/tools/preview_send.ts` → **EMPTY** (Plan 35-03's scope; untouched by 35-02)

All 6 cryptographic-binding / dispatch-routing files byte-identical to origin/main as required.

## Plan acceptance criteria

| Criterion | Result |
| --------- | ------ |
| `grep -c "registerTool" src/tools/read_contract.ts ≥ 1` | 2 (registerTool import + registerTool call) |
| `grep -v '^\s*//' src/tools/read_contract.ts \| grep -c "readContract" == 0` | 0 |
| `grep -c "\.call(" src/tools/read_contract.ts ≥ 1` | 3 |
| `grep -c "encodeFunctionData" src/tools/read_contract.ts ≥ 1` | 4 |
| `grep -c "decodeFunctionResult" src/tools/read_contract.ts ≥ 1` | 3 |
| `grep -c "fetchEtherscanAbi" src/tools/read_contract.ts ≥ 1` | 3 |
| `grep -c "stateMutability" src/tools/read_contract.ts ≥ 1` | 5 |
| `grep -v '^\s*//' src/tools/read_contract.ts \| grep -ci "4byte\|fourbyte\|fetchSelector" == 0` | 0 |
| `grep -c "NON_VIEW_FUNCTION" src/signing/error-codes.ts ≥ 1` | 3 |
| `grep -c "import \"./read_contract" src/tools/register-all.ts ≥ 1` | 1 |
| `grep -c "get_contract_abi" src/tools/register-all.ts ≥ 1` (Plan 35-01 import persists) | 1 |
| All tests in `test/read-contract.test.ts` pass | 16 / 16 |
| FROZEN-area zero-diff against origin/main | empty |
| preview_send.ts zero-diff against origin/main (35-03's scope) | empty |
| npm run typecheck | clean |

## Error arms exercised in tests

| Arm | Test | Outcome |
| --- | ---- | ------- |
| view happy path (ethereum) | Test 1 | balanceOf returns 1_000_000n; selector 0x70a08231 in calldata |
| view happy path (arbitrum) | Test 2 | chainId=42161; sourceCodeUrl arbiscan.io; URL contains `chainid=42161` |
| pure happy path | Test 3 | stateMutability="pure" accepted alongside "view" |
| NON_VIEW_FUNCTION (nonpayable) | Test 4a | refusal text routes to prepare_custom_call; client.call never invoked |
| NON_VIEW_FUNCTION (payable) | Test 4b | payable functions also refused |
| ABI_NOT_AVAILABLE (function missing) | Test 5 | "function not found in ABI: noSuchFunction" |
| INTERNAL_ERROR (abi-not-verified) | Test 6 | NO blind-call attempted; client.call invocation count = 0 |
| INTERNAL_ERROR (rate-limit) | Test 7 | 6th uncached call exhausts per-session budget |
| INTERNAL_ERROR (etherscan-unreachable) | Test 8 | HTTP 503 → surfaced verbatim |
| INTERNAL_ERROR (RPC error) | Test 9 | client.call rejection → verbatim message in cause |
| Cache-hit invariant | Test 10 | second call hits cache (fetch count = 1, RPC count = 2) |
| Parse-once invariant | Test 11 | JSON.parse spied; cache hit avoids re-fetch (parse-once at etherscan client layer) |
| INTERNAL_ERROR (missing API key) | Test 12 | signup URL surfaced in cause |
| Bigint serialization | Test 13 | content.text contains 12345678901234567890; not [object |
| register-all wiring | Test 14 | getRegisteredTool('read_contract') defined; description regex matches |
| Encode-sanity bonus | Encode | selector 0x70a08231 + encoded address in calldata |

## Deviations from plan

**Two adjustments, both trivial:**

1. **Description string rewording (Rule 3 — fix to satisfy acceptance criterion):** The plan's acceptance grep `grep -v '^\s*//' src/tools/read_contract.ts | grep -c "readContract"` MUST return 0. My first draft had a string-literal mention `"NOT viem.readContract"` inside the DESCRIPTION constant — substring-matched. Reworded to `"NOT the high-level viem contract-read action"` — same routing intent, no `readContract` substring. The literal `readContract` still appears in one comment block, which the grep filter correctly excludes.

2. **Added 3 extra tests beyond the planned 13:** Test 4b (payable refusal — parallel to the nonpayable case but covers the second arm of the gate); Test 11 (parse-once invariant — spies JSON.parse to verify the cache hit path doesn't re-parse); Encode-sanity (asserts the calldata selector `0x70a08231` and encoded address survive the encode step). Plan-allowed: the plan's `<behavior>` block enumerated 13 scenarios; adding sanity coverage beyond that is fine for a TDD-tagged task.

## Threat surface scan

No new security-relevant surface beyond the threat register in `35-02-PLAN.md`. All five entries (T-35-02-A through T-35-02-SC) are mitigated as planned:

- **T-35-02-A (state-mutating call disguised as a read):** stateMutability gate refuses any function with stateMutability ∉ `{view, pure}`. Test 4 asserts the gate fires BEFORE client.call is invoked (the refusal is structural — no transaction is encoded or RPC'd).
- **T-35-02-B (Etherscan returns manipulated ABI):** accepted residual per plan. The sourceCodeUrl is surfaced in the ok arm; user verifies out-of-band. Same residual as T-35-01-D.
- **T-35-02-C (RPC endpoint logs):** accepted residual; not new.
- **T-35-02-D (slow Etherscan / slow RPC):** Etherscan side: ETHERSCAN_TIMEOUT_MS bounds the ABI fetch (inherited from wave 1). RPC side: viem's default timeout applies to publicClient.call.
- **T-35-02-SC (npm/pip/cargo installs):** NO new packages installed (viem is already vendored).

## Open issues / followups (none load-bearing for 35-02)

- The plan's task description mentioned wrapping fetchEtherscanAbi + client.call in a combined 5s AbortController. The wave-1 fetchEtherscanAbi has its own ETHERSCAN_TIMEOUT_MS; viem's client.call uses the chain registry's default RPC timeout. Combining them under a single AbortController would require threading AbortSignal through viem's call action (which supports it) — feasible, deferred as additive. Documented in plan §`<action>` "(e)" as acceptable: "if AbortSignal threading through viem.call is awkward, accept the per-call 5s gap and document it." Per-call worst case is ~10s (5s ABI + 5s RPC) instead of 5s combined.

## Self-Check: PASSED

- `src/tools/read_contract.ts` exists; `registerTool` invoked — VERIFIED
- read_contract uses LOW-LEVEL `.call({` not `readContract` (grep filter returns 0 non-comment matches) — VERIFIED
- `encodeFunctionData` + `decodeFunctionResult` + `fetchEtherscanAbi` imported and used — VERIFIED
- `stateMutability` gate present — VERIFIED
- No 4byte/fourbyte/fetchSelector fallback — VERIFIED
- `src/signing/error-codes.ts` ErrorCode contains `"NON_VIEW_FUNCTION"` — VERIFIED
- `src/tools/register-all.ts` imports `./read_contract.js` — VERIFIED
- Plan 35-01's `./get_contract_abi.js` import still present — VERIFIED
- `test/read-contract.test.ts` exists; all 16 tests pass — VERIFIED
- FROZEN-area zero-diff against `origin/main` — VERIFIED
- `preview_send.ts` zero-diff against `origin/main` (35-03's scope) — VERIFIED
- TypeScript strict-mode typecheck clean — VERIFIED
- Full suite (4369 / 1 skipped / 320 files) green at every commit — VERIFIED

## Wave-coordination handoff to Plan 35-03

- `NON_VIEW_FUNCTION` is now in `ErrorCode` — Plan 35-03 will append `NON_PROTOCOL_TARGET_NOT_ACKNOWLEDGED` after it.
- `src/tools/register-all.ts` line 7 (immediately after the wave-1 `get_contract_abi` line, the new `read_contract` line) is the anchor for Plan 35-03's `prepare_custom_call` import. Three distinct lines — trivial rebase if cherry-picking.
- `src/tools/preview_send.ts` byte-identical to origin/main — Plan 35-03 owns ALL modifications to it (bypass branch at 792-814 + decoded args branch).
- `src/clients/etherscan.ts` byte-identical to wave 1 (35-01) — Plan 35-03's `getCachedEtherscanAbi` consumer needs no further changes to this file.
- Per-session ABI cache is now populated by BOTH `get_contract_abi` (wave 1) AND `read_contract` (this plan) — Plan 35-03's preview-time decode benefits from either entry path.

## Commits

```
ab73e4a feat(35-02): add read_contract tool — ABI-driven eth_call + view-only gate (CUSTOM-03)
b8fdfe6 feat(35-02): register read_contract MCP tool (CUSTOM-03)
```

## Worktree-substrate note (process-level, not a deviation)

The orchestrator's prompt stated that wave 1 (Plan 35-01) was already on the worktree's base branch. In fact, the harness created this worktree off `origin/main` + the planning-docs commit, NOT off `feat/35-escape-hatch` (which holds wave 1). Recovery: a single `git rebase feat/35-escape-hatch` against the local feat branch landed the 3 wave-1 commits onto this worktree's HEAD. The substrate is in place; cherry-picking the 35-02 commits onto the parent branch will require only these 2 commits to apply.
