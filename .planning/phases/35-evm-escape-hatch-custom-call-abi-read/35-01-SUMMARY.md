---
phase: 35-evm-escape-hatch-custom-call-abi-read
plan: 01
subsystem: clients/etherscan + tools/escape-hatch
tags: [etherscan-v2, multi-chain, abi-fetch, custom-02, free-downstream-effect]
requires: []
provides:
  - fetchEtherscanAbi(chainId, address, apiKey) → EtherscanAbiResult (4-arm DU)
  - getCachedEtherscanAbi(chainId, address) → cache-only preview helper
  - get_contract_abi MCP tool (multi-chain)
  - check_contract_security multi-chain end-to-end (free downstream effect)
  - ABI_NOT_AVAILABLE ErrorCode (reserved for Plan 35-02)
affects:
  - src/clients/etherscan.ts (FROZEN-additive — chainid widening + new export)
  - src/tools/check_contract_security.ts (v1.2 ethereum-only refusal LIFTED)
  - src/tools/register-all.ts (APPEND-ONLY)
tech-stack:
  added: []
  patterns:
    - "never-throws 4-arm DU client (mirror of fourbyte.ts shape)"
    - "per-chain LRU cache keyed by `${chainId}:${address}`"
    - "shared rate counter across endpoints (Etherscan V2 per-API-key limit)"
    - "parse-once memoization at the client layer"
    - "Pitfall-6 disambiguation: not-verified vs error verbatim"
key-files:
  created:
    - path: src/tools/get_contract_abi.ts
      lines: 208
    - path: test/clients-etherscan-multichain.test.ts
      lines: 536
    - path: test/get-contract-abi.test.ts
      lines: 318
  modified:
    - path: src/clients/etherscan.ts
      delta: "+258/-9"
      change: "chainid widening + new fetchEtherscanAbi + abiCache + buildSourceCodeUrl + getCachedEtherscanAbi + _resetEtherscanAbiCacheForTesting"
    - path: src/tools/check_contract_security.ts
      delta: "+10/-22"
      change: "v1.2 Ethereum-only refusal LIFTED (lines 105-122 deleted); chainId threaded to etherscanCheckContractSecurity; description + chain-enum-description updated"
    - path: src/signing/error-codes.ts
      delta: "+13/-1"
      change: "APPEND ABI_NOT_AVAILABLE arm to ErrorCode union (reserved for Plan 35-02)"
    - path: src/tools/register-all.ts
      delta: "+1"
      change: "APPEND import './get_contract_abi.js'"
    - path: test/clients-etherscan.test.ts
      delta: "+17/-17"
      change: "widen 17 call sites to pass chainId=1 as new first positional (backwards-compatibility)"
    - path: test/check-contract-security.test.ts
      delta: "+38/-0"
      change: "APPEND 4-case 'multi-chain widening' describe block (arbitrum/polygon/base/optimism)"
decisions:
  - "Cache key widened from `Address` to `${chainId}:${address}` for both the existing checkContractSecurity cache and the new abiCache — single migration touch closes the cross-chain-leak gap T-35-01-C end-to-end."
  - "abiCache max 64 entries vs the existing CACHE_MAX_ENTRIES=256 — ABIs are larger payloads (proxy contracts can carry 200+ entries; 256-entry ABI cache risks >5MB session footprint)."
  - "agentSessionCallCount stays GLOBAL (single counter shared with checkContractSecurity) — Etherscan V2 enforces the rate limit per API key across all chains, NOT per chain."
  - "Parse-once: JSON.parse(body.result) lives ONCE in the etherscan.ts client (returns a parsed viem.Abi array on the ok arm). Downstream consumers (read_contract / preview_send decode) never re-parse."
  - "getCachedEtherscanAbi cache-only helper exposed in this plan — Plan 35-03's preview_send DECODED ARGS arm calls it synchronously (preview is a non-async-budget path; cannot trigger network I/O)."
  - "ABI_NOT_AVAILABLE ErrorCode landed in THIS plan (not Plan 35-02) to avoid a write conflict on src/signing/error-codes.ts if 35-02 ∥ 35-03 run in parallel — Plan 35-02 will reuse the code without touching the file."
  - "check_contract_security v1.2-Ethereum-only refusal LIFTED in the same plan that widens the client — free downstream effect locked in 35-CONTEXT.md is delivered."
  - "Pitfall 6 disambiguation: status='0' + result === 'Contract source code not verified' → not-verified arm; any other status='0' → error arm with verbatim message. A future contributor cannot accidentally mask a 5xx / network failure as 'not-verified'."
metrics:
  duration: 11 minutes wall-clock
  completed: 2026-05-26
---

# Phase 35 Plan 35-01: get_contract_abi + Etherscan V2 multi-chain widening — Summary

## One-liner

Etherscan V2 client widened to multi-chain end-to-end (chainid query param + per-chain cache key + shared rate counter); new `fetchEtherscanAbi` 4-arm DU export + `get_contract_abi` MCP tool route over all 5 supported chains; `check_contract_security` v1.2-Ethereum-only runtime refusal LIFTED as the locked free downstream effect.

## Artifacts shipped

### NEW files

| File | Lines | Role |
| ---- | ----- | ---- |
| `src/tools/get_contract_abi.ts` | 208 | MCP tool — verified ABI fetcher; 4-arm DU; populates per-session ABI cache for downstream escape-hatch tools |
| `test/clients-etherscan-multichain.test.ts` | 536 | 13 cases / 20 assertions: per-chain cache (T-35-01-C); per-chain URL; per-chain sourceCodeUrl across all 5 chains; shared rate counter (T-35-01-B); HTTP 5xx + AbortError; parse-once memoization; cache-hit; getCachedEtherscanAbi preview-time lookup |
| `test/get-contract-abi.test.ts` | 318 | 13 cases: 5-chain happy path; not-verified; rate-limited; HTTP 5xx; missing API key; schema gate; register-all wiring; ABI cache persistence |

### MODIFIED files

| File | Delta | Change |
| ---- | ----- | ------ |
| `src/clients/etherscan.ts` | +258/-9 | chainid widening + new `fetchEtherscanAbi` + `abiCache` + `buildSourceCodeUrl` + `getCachedEtherscanAbi` + `_resetEtherscanAbiCacheForTesting` |
| `src/tools/check_contract_security.ts` | +10/-22 | v1.2 Ethereum-only refusal LIFTED; chainId threaded to client; description + chain-enum-description updated |
| `src/signing/error-codes.ts` | +13/-1 | APPEND `ABI_NOT_AVAILABLE` arm (reserved for Plan 35-02) |
| `src/tools/register-all.ts` | +1 | APPEND import `./get_contract_abi.js` |
| `test/clients-etherscan.test.ts` | +17/-17 | Widen 17 call sites to pass `chainId=1` as new first positional |
| `test/check-contract-security.test.ts` | +38/-0 | APPEND 4-case `multi-chain widening` describe block |

## Tests passing

- **Baseline:** 4316 passing / 1 skipped / 317 files
- **Final:** 4353 passing / 1 skipped / 319 files
- **Delta: +37 tests, +2 files**
  - +20 from `test/clients-etherscan-multichain.test.ts` (NEW)
  - +13 from `test/get-contract-abi.test.ts` (NEW)
  - +4 from `test/check-contract-security.test.ts` (`multi-chain widening` extension)
- Full suite green at every commit boundary (Task 1, Task 2).
- TypeScript strict-mode typecheck: clean.

## FROZEN-area zero-diff confirmation

`git diff origin/main -- src/signing/payload-fingerprint.ts src/signing/presign-hash.ts src/clients/fourbyte.ts src/tools/send_transaction.ts src/signing/handle-store.ts` → **EMPTY**

All 5 cryptographic-binding files byte-identical to origin/main as required.

## Key decisions

1. **Cache key migration touched both existing + new caches in one pass.** The check_contract_security cache was already keyed by `Address` alone (the v1.1 single-chain assumption); widening it to `${chainId}:${address}` lets the same address on Ethereum vs Polygon cache independently. T-35-01-C closed end-to-end, not just for the new abi path.

2. **abiCache max 64 entries vs CACHE_MAX_ENTRIES=256 for the security cache.** ABIs are larger payloads — proxy contracts (e.g. Aave Pool's implementation ABI) can carry 200+ entries with bytes32 indexed inputs and tuple component arrays. A 256-entry ABI cache risks 5MB+ session footprint.

3. **Rate counter stays GLOBAL.** Etherscan V2 enforces per API key across all chains (verified docs 2026-05-13), so `agentSessionCallCount` is incremented once per fetch by both `checkContractSecurity` and `fetchEtherscanAbi`. Cross-chain mixed sequences correctly drain the shared budget — verified by the explicit interleaving test (Test 7 in `clients-etherscan-multichain.test.ts`).

4. **Parse-once at the client layer.** `JSON.parse(body.result)` lives ONCE in the etherscan client; the ok arm returns a parsed `viem.Abi` array. Downstream consumers (read_contract — Plan 35-02; preview_send DECODED ARGS — Plan 35-03) never re-parse. `rawAbiJson` is also surfaced for the rare case a consumer needs the wire-format string.

5. **`getCachedEtherscanAbi` cache-only helper exposed here.** Plan 35-03's preview_send DECODED ARGS arm calls a synchronous cache lookup (preview is a non-async-budget path; cannot trigger network I/O). Surfacing this helper in 35-01 means 35-03 imports a stable API without needing any further changes to the etherscan client.

6. **ABI_NOT_AVAILABLE ErrorCode landed in THIS plan (not Plan 35-02).** Coordination note: the plan's wave layout (35-02 ∥ 35-03 SAFE per 35-PATTERNS.md) would otherwise create a write conflict on `src/signing/error-codes.ts`. By landing the code now, Plan 35-02 imports it without touching the file.

7. **Pitfall 6 disambiguation locked at the client layer.** `status === "0"` + `result === "Contract source code not verified"` → `not-verified` arm; any other `status === "0"` → `error` arm with verbatim message. A future contributor cannot accidentally mask a 5xx or network failure as `not-verified` — the type system enforces the discriminant.

8. **check_contract_security widening is a one-line refusal-lift + one-line chainId-threading.** No semantic change beyond chain dispatch — the privileged-role enumeration, proxy detection, age computation, and ABI parsing all stay identical. Description + chain-enum-description text updated to reflect the multi-chain surface (no longer says "v1.2 ships Ethereum-only").

## Deviations from plan

**None.** Plan executed as written. The Task-2 `<read_first>` block warned that the original lines 105-122 contained a `chainId !== 1` refusal — that block was deleted verbatim as specified. The Task-2 acceptance criterion `grep -c "ethereum-only" src/tools/check_contract_security.ts` returns 1 (a documentation comment explaining the lift) — the runtime refusal itself is gone (grep for `if (chainId !== 1)` returns 0).

The plan called out a 1-line description-string update implicitly via the acceptance criteria; the description + chain-arg-description were tightened to remove "v1.2 ships Ethereum-only" text, replacing it with "Multi-chain end-to-end (Phase 35 / Plan 35-01)" language. This is a doc-only change — no behavior change beyond the runtime refusal lift.

## Threat surface scan

No new security-relevant surface introduced beyond the threat register in `35-01-PLAN.md`. All five entries (T-35-01-A through T-35-01-SC) are mitigated as planned:

- **T-35-01-A (API key in URLs):** mirror of existing `checkContractSecurity` behavior — the URL is constructed inline but never logged. Logger calls reference address + status only. Verified by reading the `log("warn", ...)` calls in both `checkContractSecurity` and the new `fetchEtherscanAbi`.
- **T-35-01-B (DoS via per-API-key rate limit):** SHARED counter mitigation verified by Test 7 in the multichain test file (interleaved ABI + security calls drain the same counter).
- **T-35-01-C (cross-chain cache leak):** cache key widened from `Address` to `${chainId}:${address}` for BOTH the existing checkContractSecurity cache AND the new abiCache; per-chain test fires 2 fetches for the same address on chainId 1 vs 42161.
- **T-35-01-D (Etherscan returns wrong ABI):** accepted residual per plan. The user has `sourceCodeUrl` in the response and can verify out-of-band. Documented in the plan threat model.
- **T-35-01-SC (npm/pip/cargo installs):** NO new packages installed (viem.Abi type is already vendored).

## Self-Check: PASSED

- `src/clients/etherscan.ts` exports `fetchEtherscanAbi` (line 483) — VERIFIED
- `src/clients/etherscan.ts` exports `_resetEtherscanAbiCacheForTesting` (line 621) — VERIFIED
- `src/clients/etherscan.ts` exports `getCachedEtherscanAbi` (cache-only helper for Plan 35-03) — VERIFIED
- No remaining hardcoded `chainid=1` outside comments: `grep -v '^\s*//' src/clients/etherscan.ts | grep -c "chainid=1[^0-9]"` → 0 — VERIFIED
- `agentSessionCallCount` not duplicated: `grep -c "let agentSessionCallCount" src/clients/etherscan.ts` → 1 — VERIFIED
- `src/tools/get_contract_abi.ts` exists and calls `registerTool` — VERIFIED
- `src/tools/register-all.ts` imports `./get_contract_abi.js` — VERIFIED
- `src/signing/error-codes.ts` ErrorCode contains `"ABI_NOT_AVAILABLE"` — VERIFIED
- Runtime refusal `if (chainId !== 1)` block in `src/tools/check_contract_security.ts` is gone — VERIFIED
- `etherscanCheckContractSecurity(chainId, ...)` call site in `src/tools/check_contract_security.ts` — VERIFIED
- FROZEN-area zero-diff against `origin/main`: payload-fingerprint, presign-hash, fourbyte, send_transaction, handle-store — VERIFIED
- All tests pass — VERIFIED
- TypeScript strict-mode typecheck clean — VERIFIED

## Wave-coordination handoff to Plans 35-02 / 35-03

- `fetchEtherscanAbi(chainId, address, apiKey)` is the stable API Plans 35-02 (`read_contract`) and 35-03 (preview_send DECODED ARGS) consume. Plan 35-02 imports it for ABI-driven `eth_call` encode/decode.
- `getCachedEtherscanAbi(chainId, address)` is the synchronous cache-only API Plan 35-03's preview_send DECODED ARGS branch consumes (preview is non-async — no network I/O allowed).
- `ABI_NOT_AVAILABLE` ErrorCode is reserved here so Plan 35-02 can refuse function-not-in-ABI / non-view stateMutability without touching error-codes.ts (parallel-safe).
- `src/tools/register-all.ts` line 6 is the anchor for Plan 35-02 (`./read_contract.js`) and Plan 35-03 (`./prepare_custom_call.js`) appends. Three distinct lines = trivial rebase.

## Commits

```
431da0a feat(35-01): widen Etherscan V2 client to multi-chain + add fetchEtherscanAbi (CUSTOM-02)
1ba2689 feat(35-01): add get_contract_abi MCP tool + widen check_contract_security to multi-chain (CUSTOM-02)
```
