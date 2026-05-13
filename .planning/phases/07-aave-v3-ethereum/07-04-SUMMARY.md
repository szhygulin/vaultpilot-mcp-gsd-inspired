---
phase: 07
plan: 04
subsystem: defensive-read
tags: [check-contract-security, etherscan-v2, privileged-roles, defense-in-depth, READ-21]
requires: [07-02]
provides:
  - "MCP tool: check_contract_security (READ-21) — defensive read tool surfacing Etherscan-backed verification + age + privileged-role enumeration + proxy state"
  - "src/clients/etherscan.ts — Etherscan V2 unified-API client (5-arm discriminated union; LRU cache 256-entry; AbortController 3000ms; per-session 5-call rate-limit counter; never-throws contract)"
  - "src/config/env.ts::getEtherscanApiKey — lazy env-var helper (returns undefined when unset; no boot failure)"
  - "src/tools/get_vaultpilot_config_status.ts — etherscanApiKeyPresent: boolean field (boolean ONLY; Q-CONFIG-LEAK extension)"
affects:
  - "src/tools/register-all.ts — +1 import line (check_contract_security)"
tech-stack:
  added:
    - "Etherscan V2 unified-API (chainid=1 hardcoded in v1.1; Phase 8 widens via chainid query param)"
  patterns:
    - "mirror-fourbyte: client-shape preservation (LRU + AbortController + never-throws + test-hook reset; 5-arm discriminated union vs fourbyte's 4-arm)"
    - "lazy-env-var: getEtherscanApiKey mirrors getWalletConnectProjectId — surfaces failure at tool-call time, not boot"
    - "fetch-stub mocking: tool tests inject at fetch boundary (not vi.spyOn on named export) — ESM bindings immutable"
    - "privileged-role TWO-array surfacing: never collapsed to a single boolean (Ownable vs AccessControl distinction matters)"
key-files:
  created:
    - src/clients/etherscan.ts
    - src/tools/check_contract_security.ts
    - test/clients-etherscan.test.ts
    - test/check-contract-security.test.ts
  modified:
    - src/config/env.ts
    - src/tools/get_vaultpilot_config_status.ts
    - src/tools/register-all.ts
    - test/get-vaultpilot-config-status.test.ts
decisions:
  - "5-arm vs 4-arm: Etherscan client has FIVE result kinds (not-applicable / ok / not-verified / error / rate-limited) vs fourbyte's four. The extra arm is `rate-limited` — per-session 5-call counter exists only here. T-ETHERSCAN-RATE-1 mitigation."
  - "Privileged-role enumeration surfaces TWO arrays (privilegedFunctions + accessControlMarkers) NOT one boolean — Ownable vs AccessControl distinction matters to the user. Research § Topic 7 lock."
  - "Lazy ETHERSCAN_API_KEY resolution: boot stays green when env unset. Tool-call returns INTERNAL_ERROR envelope naming the env var + https://etherscan.io/apis signup URL. Mirrors Phase 3 WALLETCONNECT_PROJECT_ID lazy-pattern."
  - "URL with API key NEVER logged: T-ETHERSCAN-KEY-LEAK-1. Log messages reference the address only. Asserted by test/clients-etherscan.test.ts URL-not-logged case."
  - "Mock strategy is fetch-stub (plan-checker FLAG-1 fix): stub global.fetch in tests, NOT vi.spyOn on the etherscanClient named export. ESM named-export bindings are immutable — spy silently no-ops. CLAUDE.md ESM spy-affordance indirection convention applies; tests inject at the fetch boundary instead."
  - "Per-session rate-limit counter increments BEFORE the network call; cached hits do NOT consume the budget. Asserted explicitly by clients-etherscan.test.ts cached-hit-no-budget-consumption case."
  - "Defensive ageDays: 'unknown' when creationTimestamp === 0 (very-old contracts pre-Etherscan indexer coverage). Avoids surfacing a nonsensical 1970-epoch age."
metrics:
  duration: "~1h"
  completed: "2026-05-13"
  tasks_completed: 2
  files_created: 4
  files_modified: 4
  tests_added: 25
  tests_before: 514
  tests_after: 539
---

# Phase 7 Plan 04: check_contract_security Summary

`check_contract_security` (READ-21) ships as the defense-in-depth read tool surfacing Etherscan-backed verification status, deployment age, privileged-role enumeration, and proxy state BEFORE the user signs `prepare_*` against an unfamiliar contract. Supporting Etherscan V2 client mirrors `src/clients/fourbyte.ts` verbatim with one extra discriminated-union arm (`rate-limited`) backed by a per-session 5-call counter.

## What shipped

### `src/clients/etherscan.ts` (NEW)

Etherscan V2 unified-API client. Mirror of `src/clients/fourbyte.ts` shape verbatim — same never-throws contract, module-scope LRU cache, AbortController timeout discipline, finally-block timer cleanup, test-hook reset convention.

5-arm `EtherscanResult` discriminated union:
- `not-applicable` — null address (defensive)
- `ok` — verified source with parsed metadata (verified flag, proxy state, implementation, contractName, compilerVersion, creator, creationTxHash, ageDays, privilegedFunctions, accessControlMarkers)
- `not-verified` — Etherscan returned source-code unverified
- `error` — HTTP 5xx / 4xx / AbortController timeout / network unreachable / JSON parse failure / Etherscan status="0"
- `rate-limited` — per-session 5-call budget exhausted

Two parallel API calls via `Promise.all` to `getsourcecode` + `getcontractcreation`. ABI parse for privileged-role enumeration: scans for `PRIVILEGED_NAMES` (upgradeTo / setAdmin / transferOwnership / pause / mint / etc.) + `ACCESS_CONTROL_NAMES` (hasRole / DEFAULT_ADMIN_ROLE / grantRole / etc.). Surfaced as TWO arrays — research § Topic 7 lock forbids collapsing to a single boolean.

Module-scope `agentSessionCallCount` rate-limit counter. Increments BEFORE the network call; cached hits do NOT consume the budget (asserted by explicit test). Counter resets at MCP server restart (process-local).

URL construction includes the API key in the query string but the URL is NEVER logged — log messages reference the address only (`Etherscan V2 lookup failed for {address}: {message}`). T-ETHERSCAN-KEY-LEAK-1 mitigation.

`_resetEtherscanCacheForTesting` + `_resetEtherscanRateCounterForTesting` test hooks (CLAUDE.md underscore-prefix convention).

### `src/config/env.ts::getEtherscanApiKey` (MODIFY — 4 lines added)

Lazy env-var helper mirroring `getWalletConnectProjectId` shape verbatim. Returns `undefined` when unset; no boot failure. Surfaced as INTERNAL_ERROR at tool-call time only.

### `src/tools/check_contract_security.ts` (NEW)

MCP tool. Routes the 5 `EtherscanResult` arms:
- `ok` → structuredContent with all parsed fields + multi-line text block
- `not-verified` → `{ verified: false }` (no further detail)
- `error` → INTERNAL_ERROR envelope with cause `"etherscan-unreachable"`
- `rate-limited` → INTERNAL_ERROR envelope with cause `"rate-limit"`
- `not-applicable` → defensive `{ verified: false }` (should not happen post-schema-gate)

Missing ETHERSCAN_API_KEY → INTERNAL_ERROR envelope naming the env var + https://etherscan.io/apis signup URL. INVALID_INPUT for malformed addresses (regex schema gate + `viem::isAddress` check).

Tool description (~1500 chars) routes the agent: "Call BEFORE prepare_aave_supply / prepare_token_approve / prepare_token_send for an unfamiliar contract." Names the per-session rate-limit boundary, the API-key requirement + signup URL, and the proxy-implementation surfacing pattern (Aave V3 Pool itself is a proxy — chain-check the implementation separately).

### `src/tools/get_vaultpilot_config_status.ts` (MODIFY — +1 field)

Adds `etherscanApiKeyPresent: boolean` to structuredContent + text-block line. Boolean ONLY — T-CONFIG-LEAK-EXTENDS-1 / Q-CONFIG-LEAK lock from Plan 05-03 extends. The 14 existing fields stay byte-identical except for the additive new field; field ordering preserves the env-var-presence grouping.

### `src/tools/register-all.ts` (MODIFY — +1 line)

`import "./check_contract_security.js";` placed AFTER `import "./get_token_metadata.js";` per pattern-mapper carve. Non-conflicting with Plan 07-03's 3 inserts adjacent to `preview_send.js`.

### Tests (+25)

- `test/clients-etherscan.test.ts` (NEW, 12 cases): not-applicable / happy path verified / proxy fixture / unverified / HTTP 5xx → error (T-ETHERSCAN-MASK-1) / AbortController timeout / per-session rate-limit boundary 5 succeed + 6th rate-limited (T-ETHERSCAN-RATE-1) / cached hits don't consume budget / URL with API key NOT logged on error path (T-ETHERSCAN-KEY-LEAK-1) / LRU cache hit / ageDays defensive "unknown" for timestamp=0 / no console.* writes.
- `test/check-contract-security.test.ts` (NEW, 10 cases): schema gate missing address / schema gate malformed / missing API key with signup URL cause / happy path verified with ageDays + privileged-role surfacing / proxy fixture (Aave V3 Pool) / HTTP 5xx → INTERNAL_ERROR NOT verified:false (T-ETHERSCAN-MASK-1 tool-side anchor) / unverified contract / rate-limited → INTERNAL_ERROR with cause "rate-limit" / privileged-role text-block / register-all wiring.
- `test/get-vaultpilot-config-status.test.ts` (EXTEND, +3 cases): `etherscanApiKeyPresent: false` env unset / `etherscanApiKeyPresent: true` env set / **LOAD-BEARING** API-key-value-never-leaks (T-CONFIG-LEAK-EXTENDS-1 — sentinel substring scan).

### Mock strategy

Per plan-checker FLAG-1 fix: both new test files use `vi.stubGlobal("fetch", ...)` (fetch-stub at the network boundary), mirroring `test/fourbyte.test.ts`. **Did NOT** use `vi.spyOn(etherscanClient, "checkContractSecurity")` — ESM named-export bindings are immutable so the spy silently no-ops, producing a false-passing test. CLAUDE.md "ESM spy-affordance indirection" convention exists to prevent this; the fetch-boundary inject sidesteps the constraint without requiring an `_etherscan` indirection object.

## Threat model deltas

- **T-ETHERSCAN-MASK-1 (HIGH, mitigate)** — HTTP 5xx / timeout / parse failure surfaces as `error` arm (NEVER `not-verified`). Asserted by `test/clients-etherscan.test.ts` HTTP 5xx case + `test/check-contract-security.test.ts` Test 6 (tool surfaces INTERNAL_ERROR with cause `etherscan-unreachable`, NOT `verified: false`).
- **T-ETHERSCAN-KEY-LEAK-1 (HIGH, mitigate)** — URL with API key in query string is NEVER logged. Asserted by `test/clients-etherscan.test.ts` URL-not-logged case (sentinel substring scan across all logged messages).
- **T-CONFIG-LEAK-EXTENDS-1 (HIGH, mitigate)** — `etherscanApiKeyPresent` surfaces as boolean ONLY. Asserted by `test/get-vaultpilot-config-status.test.ts` Test 24 LOAD-BEARING (substring scan asserts the sentinel API key string `secret-etherscan-key-do-not-leak-987654321` NEVER appears in serialized response).
- **T-ETHERSCAN-RATE-1 (MEDIUM, mitigate)** — Per-session 5-call counter; cached hits don't consume budget. Asserted by `test/clients-etherscan.test.ts` rate-limit boundary case + `test/check-contract-security.test.ts` Test 8.
- **T-ETHERSCAN-PROXY-IMPLEMENTATION-MASK-1 (MEDIUM, mitigate)** — Proxy contracts surface `proxy: true` + `implementation` as separate fields. Tool description explicitly names this. Asserted by `test/check-contract-security.test.ts` Test 5 (Aave V3 Pool fixture).
- **T-ETHERSCAN-PRIV-ROLE-FALSE-NEG-1 (LOW, accept)** — Heuristic miss; custom-named privileged modifiers (`onlyKeeper`) slip through. Documented residual; v1.3 vaultpilot-preflight skill widens via out-of-band cross-check.

## Regression evidence

- `git diff origin/main -- src/signing/payload-fingerprint.ts src/signing/presign-hash.ts src/signing/handle-store.ts src/tools/send_transaction.ts` → **empty** (cryptographic-binding chain FROZEN).
- `git diff origin/main -- src/tools/register-all.ts` → exactly +1 line (`./check_contract_security.js` after `./get_token_metadata.js`).
- `git diff origin/main -- src/clients/fourbyte.ts` → **empty** (analog client byte-unchanged).
- `npm run typecheck` clean.
- `npm run build` clean.
- `npm test` → **539 passed** (was 514 before Plan 07-04 = +25 tests). 56 test files, all green.

## Deviations from plan

**None.** Plan executed exactly as written. The plan's 5-arm union (interfaces) + 5-call rate limit + lazy env-var pattern + fetch-stub mock strategy + register-all single-line carve all landed verbatim.

Plan-checker FLAG-1 (fetch-stub clarification) was applied as written — both new test files use `vi.stubGlobal("fetch", ...)` exclusively; no `vi.spyOn` on the etherscan named export anywhere.

## Concurrent-execution note

Plan 07-03 (Aave prepare + simulate tools) is in flight in a parallel worktree (`feat-07-03-aave-prepare-and-simulate`). The two plans share exactly one file: `src/tools/register-all.ts`. 07-04 adds 1 import line (`check_contract_security`) AFTER `get_token_metadata.js`; 07-03 adds 3 import lines adjacent to `preview_send.js`. The two regions do NOT overlap. If both PRs need to merge, the second one rebases trivially (no line-overlap conflict).

## Self-Check

Files created exist:
- `src/clients/etherscan.ts` — FOUND
- `src/tools/check_contract_security.ts` — FOUND
- `test/clients-etherscan.test.ts` — FOUND
- `test/check-contract-security.test.ts` — FOUND

Commit `c71fd39` exists in git log.

Files modified contain the new symbols:
- `src/config/env.ts` contains `getEtherscanApiKey`
- `src/tools/get_vaultpilot_config_status.ts` contains `etherscanApiKeyPresent`
- `src/tools/register-all.ts` contains `./check_contract_security.js`
- `test/get-vaultpilot-config-status.test.ts` contains `etherscanApiKeyPresent`

## Self-Check: PASSED
