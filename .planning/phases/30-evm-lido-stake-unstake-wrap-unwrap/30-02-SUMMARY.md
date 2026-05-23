---
phase: 30-evm-lido-stake-unstake-wrap-unwrap
plan: "02"
subsystem: lido-read-service
tags:
  - lido
  - reads
  - multi-chain
  - rebase-math
dependency_graph:
  requires:
    - Plan 30-01 (getLidoStethAddress / getLidoWstethAddress SOT getters + src/protocols/lido.ts)
  provides:
    - computeRebaseRewards pure-bigint function (src/signing/lido-rebase.ts)
    - STETH_BASE / STETH_DECIMALS bigint constants
    - readEthereumPositions + readArbitrumPositions read service (src/chains/lido.ts)
    - _lidoChains + _lidoRebase ESM spy-affordance indirection objects
    - get_lido_positions MCP tool (LIDO-01)
    - Side-effect import in register-all.ts
  affects:
    - src/tools/register-all.ts (+1 import line for get_lido_positions.js)
tech_stack:
  added: []
  patterns:
    - Pure-bigint rebase math with literal-typed approx (mirrors aave-health.ts / compound-health.ts)
    - Two-client cross-chain read (arbClient.balanceOf + ethClient.stEthPerToken) per Pitfall 5
    - Promise.all 4-read fan-out on Ethereum (stETH.balanceOf + sharesOf + wstETH.balanceOf + stEthPerToken)
    - MCP tool with narrowed 2-chain enum (ethereum / arbitrum only)
    - INVALID_INPUT + makeStructuredError envelope for chain narrowing + wallet validation
    - rpcDegraded surface via isPublicNodeFallback per READ-05 invariant
key_files:
  created:
    - src/signing/lido-rebase.ts (112 lines — STETH_BASE + STETH_DECIMALS + computeRebaseRewards + _lidoRebase)
    - src/chains/lido.ts (245 lines — LidoEthereumReadResult + LidoArbitrumReadResult + readEthereumPositions + readArbitrumPositions + _lidoChains)
    - src/tools/get_lido_positions.ts (243 lines — DESCRIPTION + INPUT_SCHEMA + handler + registerTool)
    - test/signing-lido-rebase.test.ts (63 lines — 5 deterministic literal-anchor tests)
    - test/get-lido-positions.test.ts (308 lines — 6 unit tests covering all 5 acceptance criteria + registration)
  modified:
    - src/tools/register-all.ts (+1 line — import "./get_lido_positions.js")
decisions:
  - D-08 implemented: get_lido_positions response shape — stethBalance, wstethBalance, stethShares, conversionRate, accruedRebaseRewards, chain as decimal strings + human units
  - D-09 implemented: shares-based approximate accrual (currentStethBalance - shares); approx: true literal-type narrowing in LidoRebaseOutput interface (NOT boolean — strict TS compile gate)
  - Pitfall 5 implemented: readArbitrumPositions routes stEthPerToken to ethClient (Ethereum L1), not arbClient; load-bearing comment + test assertion (3) verifying per-client routing
  - approx: true surfaced ALWAYS in structuredContent — even when accruedRebaseRewards is null on Arbitrum — so the agent knows the field contract regardless of chain
metrics:
  duration: "12 minutes"
  completed: "2026-05-23"
  tasks_completed: 2
  files_changed: 6
---

# Phase 30 Plan 02: Lido Read Service + `get_lido_positions` MCP Tool Summary

Pure-bigint rebase math, per-chain Lido read service (Ethereum + Arbitrum), and the `get_lido_positions` MCP tool — delivering LIDO-01 end-to-end. Users can ask "show my Lido positions" and receive stETH balance, wstETH balance, shares, wstETH→stETH conversion rate, and approximate accrued rebase rewards.

## What Was Built

### `src/signing/lido-rebase.ts` — New file (112 lines)

Pure-bigint rebase math mirroring `src/signing/aave-health.ts` shape:

- `STETH_BASE: bigint = 10n ** 18n` — byte-identical to `1000000000000000000n`
- `STETH_DECIMALS: bigint = 18n` — bigint (not number) to mirror aave-health.ts constant typing
- `LidoRebaseInput` interface: `{ shares: bigint; currentStethBalance: bigint }`
- `LidoRebaseOutput` interface: `{ accruedRebaseRewards: bigint; approx: true }` — `approx` is a LITERAL type, not `boolean` (D-09 load-bearing; any widening fails strict TS compile)
- `computeRebaseRewards(input)`: pure bigint subtract `currentStethBalance - shares`; no `Number()` casts; no floating point; never throws (degenerate-zero case returns `{ accruedRebaseRewards: 0n, approx: true }`)
- `_lidoRebase` ESM spy-affordance indirection wrapping `computeRebaseRewards`

**No viem import. No RPC reads. No module-load state.** (verified via grep)

### `src/chains/lido.ts` — New file (245 lines)

Per-chain read service with two exported functions and ESM spy-affordance:

**`readEthereumPositions(client, wallet)`:**
- 4-read `Promise.all` fan-out on Ethereum mainnet: `stETH.balanceOf` + `stETH.sharesOf` + `wstETH.balanceOf` + `wstETH.stEthPerToken`
- Calls `_lidoRebase.computeRebaseRewards({ shares, currentStethBalance: stethBalance })` to produce `accruedRebaseRewards`
- Returns `LidoEthereumReadResult`: all 5 fields populated (stethBalance, stethShares, wstethBalance, conversionRate, accruedRebaseRewards)
- Address resolution: `getLidoStethAddress(1)` + `getLidoWstethAddress(1)` — no inline addresses

**`readArbitrumPositions(arbClient, ethClient, wallet)`:**
- 2-client concurrent `Promise.all`:
  - `arbClient.readContract({ address: getLidoWstethAddress(42161), functionName: "balanceOf" })` → wstethBalance
  - `ethClient.readContract({ address: getLidoWstethAddress(1), functionName: "stEthPerToken" })` → conversionRate
- **Pitfall 5 load-bearing comment** at line 207-209: "ethClient reads stEthPerToken from L1 wstETH — the Arbitrum bridged wstETH does NOT implement stEthPerToken() and would REVERT if called on the Arbitrum RPC. The rate is L1-authoritative and globally applicable."
- Returns `LidoArbitrumReadResult`: `{ stethBalance: null, stethShares: null, wstethBalance, conversionRate, accruedRebaseRewards: null }`

**`_lidoChains`** ESM spy-affordance wrapping both functions.

### `src/tools/get_lido_positions.ts` — New file (243 lines)

MCP tool registered via `registerTool("get_lido_positions", DESCRIPTION, INPUT_SCHEMA, handler)`:

**D-08 structuredContent field shape:**

| Field | Ethereum | Arbitrum |
|-------|----------|---------|
| `stethBalance` | decimal string | `null` |
| `stethBalanceHuman` | string | `null` |
| `wstethBalance` | decimal string | decimal string |
| `wstethBalanceHuman` | string | string |
| `stethShares` | decimal string | `null` |
| `conversionRate` | decimal string (from L1) | decimal string (from L1) |
| `conversionRateHuman` | string | string |
| `accruedRebaseRewards` | decimal string | `null` |
| `accruedRebaseRewardsHuman` | string | `null` |
| `approx` | `true` (always) | `true` (always) |
| `chain` | `"ethereum"` | `"arbitrum"` |
| `chainId` | `1` | `42161` |
| `wallet` | address | address |
| `rpcDegraded` | optional | optional |

**Chain narrowing:** `chain ∈ { "ethereum", "arbitrum" }` — narrower than the 5-chain lending tool. Non-Lido chains (polygon, base, optimism) return `INVALID_INPUT`.

**approx: true is ALWAYS present in structuredContent** — even when `accruedRebaseRewards` is null on Arbitrum — so the agent knows the field contract regardless of chain (D-09 / T-LIDO-REBASE-SNAPSHOT-STALENESS).

### `src/tools/register-all.ts` — +1 line (additive)

```typescript
import "./get_lido_positions.js"; // Phase 30 Plan 30-02 (LIDO-01) — stETH + wstETH positions (Ethereum + Arbitrum)
```

Appended after the last Morpho import line at line 92. No other changes.

### `test/signing-lido-rebase.test.ts` — New file (63 lines, 5 tests)

| Test | Assertion |
|------|-----------|
| `STETH_BASE === 10n ** 18n` | Byte-identity with literal + with `1000000000000000000n` |
| `STETH_DECIMALS === 18n` | Bigint type confirmed |
| 1e18 shares + 1.05e18 balance | `accruedRebaseRewards === 50_000_000_000_000_000n` |
| Degenerate-zero case | `{ accruedRebaseRewards: 0n, approx: true }` — never throws |
| `approx: true` literal | `expect(result.approx).toBe(true)` + `typeof result.approx === "boolean"` |

No `beforeAll` snapshot — all expected values are inlined bigint literals.

### `test/get-lido-positions.test.ts` — New file (308 lines, 6 tests)

| Test | Assertion |
|------|-----------|
| (1) Ethereum happy path | All 5 numeric fields populated; `approx: true`; chain/chainId/wallet correct |
| (2) Arbitrum happy path | `stethBalance === null`, `stethShares === null`, `accruedRebaseRewards === null`; `wstethBalance` + `conversionRate` populated |
| (3) Arbitrum Pitfall 5 | `stEthPerToken` call on `mockEthReadContract` with ETH wstETH address; ZERO `stEthPerToken` calls on `mockArbReadContract` |
| (4) Invalid wallet | `isError: true`, `errorCode === "INVALID_INPUT"` |
| (5) Unsupported chain (polygon) | `isError: true`, `errorCode === "INVALID_INPUT"` |
| (6) Registration check | Tool registered; `chain.enum === ["ethereum", "arbitrum"]` |

## Cross-Chain L1 Read Pattern (Pitfall 5)

The Arbitrum branch of `readArbitrumPositions` makes reads across TWO distinct viem `PublicClient` instances:

```
arbClient.readContract({ address: "0x5979D7...Bridged", functionName: "balanceOf" })   → wstethBalance
ethClient.readContract({ address: "0x7f39C5...Native",  functionName: "stEthPerToken" }) → conversionRate
```

The load-bearing comment documenting Pitfall 5 is at `src/chains/lido.ts` lines 207-209. Test (3) asserts this routing by inspecting the `mockEthReadContract.mock.calls` and `mockArbReadContract.mock.calls` for address + functionName pairing.

## register-all.ts Import Line

```typescript
// Line 92:
import "./get_lido_positions.js"; // Phase 30 Plan 30-02 (LIDO-01) — stETH + wstETH positions (Ethereum + Arbitrum)
```

## Vitest Pass Count Delta

- Pre-plan full suite: 3461 tests (269 test files) — post Plan 30-01
- Post-plan full suite: 3472 tests passed + 1 skipped (271 test files)
- Net new tests: +5 (signing-lido-rebase) + +6 (get-lido-positions) = +11

## FROZEN Region Zero-Diff Confirmation

`git diff --stat 3cbc494f2b91cf9130361af4dbf5057f565b71c4 -- src/signing/payload-fingerprint.ts src/signing/presign-hash.ts src/signing/handle-store.ts src/tools/send_transaction.ts src/clients/etherscan.ts` returned empty (zero-diff confirmed).

Wave 1 artifacts (src/protocols/lido.ts, src/config/contracts.ts, src/security/canonical-dispatch.ts, src/signing/blocks.ts) zero-diff confirmed.

## Deviations from Plan

None — plan executed exactly as written. The test structure uses per-client mock instances (`mockEthReadContract` / `mockArbReadContract`) instead of a single `vi.mock("viem/actions")` approach because `src/chains/lido.ts` routes through `client.readContract()` (PublicClient method), not the standalone `viem/actions` `readContract` action function. The per-client mock approach is equivalent and actually stronger — it enables direct per-client call assertion for the Pitfall 5 test (3).

## Known Stubs

None — all exported functions are fully implemented. Plan 30-03 tools (`prepare_lido_stake`, `prepare_lido_unstake`, `prepare_lido_wrap`, `prepare_lido_unwrap`) are NOT created here; they consume the exports from Plan 30-01.

## Threat Flags

No new network endpoints beyond the read-only `publicClient.readContract` calls (Ethereum + Arbitrum RPCs). No new signing surfaces — this plan is read-only. No new auth paths. `T-LIDO-REBASE-SNAPSHOT-STALENESS` and `T-LIDO-ARBITRUM-RATE-DRIFT` are mitigated as specified in the plan's threat model.

## Self-Check: PASSED

- `src/signing/lido-rebase.ts` — FOUND (112 lines)
- `src/chains/lido.ts` — FOUND (245 lines)
- `src/tools/get_lido_positions.ts` — FOUND (243 lines)
- `test/signing-lido-rebase.test.ts` — FOUND (63 lines, 5 tests)
- `test/get-lido-positions.test.ts` — FOUND (308 lines, 6 tests)
- Commit `3ed4057` (Task 1) — FOUND via `git log`
- Commit `cb0ed97` (Task 2) — FOUND via `git log`
- FROZEN zero-diff — CONFIRMED (empty git diff vs 3cbc494)
- Wave 1 artifacts zero-diff — CONFIRMED (empty git diff vs 3cbc494)
- `npx vitest run test/signing-lido-rebase.test.ts test/get-lido-positions.test.ts` — 11 tests PASSED
- `npx vitest run` (full suite) — 3472 tests PASSED
- `npx tsc --noEmit` — CLEAN
