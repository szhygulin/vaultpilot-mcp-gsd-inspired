# Phase 31: EigenLayer + Rocket Pool — Pattern Map

**Mapped:** 2026-05-23
**Files analyzed:** 22 (16 new + 6 modified)
**Analogs found:** 22 / 22 (100% coverage — all clones from prior phases)

---

## File Classification

### New files (16)

| New File | Role | Data Flow | Closest Analog | Match Quality |
|----------|------|-----------|----------------|---------------|
| `src/protocols/eigenlayer.ts` | protocol-decoder (multi-method) | encode/ABI | `src/protocols/lido.ts` | exact (multi-method protocol) |
| `src/protocols/rocketpool.ts` | protocol-decoder (multi-method, value-bearing + burn) | encode/ABI | `src/protocols/lido.ts` + `src/protocols/weth9.ts` | exact (hybrid value-bearing + ERC-20-shape) |
| `src/chains/eigenlayer.ts` | per-chain read client | RPC read fan-out | `src/chains/lido.ts` | exact |
| `src/chains/rocketpool.ts` | per-chain read client | RPC read fan-out | `src/chains/lido.ts` | exact |
| `src/signing/eigenlayer-shares.ts` | signing pure-math | pure bigint | `src/signing/lido-rebase.ts` | exact |
| `src/signing/rocketpool-rate.ts` | signing pure-math | pure bigint | `src/signing/lido-rebase.ts` | exact |
| `src/tools/get_eigenlayer_positions.ts` | read tool | request-response (read) | `src/tools/get_lido_positions.ts` | exact (chain-narrowed read tool) |
| `src/tools/get_rocketpool_positions.ts` | read tool | request-response (read) | `src/tools/get_lido_positions.ts` | exact |
| `src/tools/prepare_eigenlayer_deposit.ts` | prepare tool (ERC-20-shape + approval pre-flight) | request-response (prepare) | `src/tools/prepare_lido_wrap.ts` | exact |
| `src/tools/prepare_rocketpool_stake.ts` | prepare tool (value-bearing) | request-response (prepare) | `src/tools/prepare_lido_stake.ts` | exact |
| `src/tools/prepare_rocketpool_unstake.ts` | prepare tool (single-arg burn + LEDGER NOTICE) | request-response (prepare) | `src/tools/prepare_weth_unwrap.ts` | exact (LEDGER NOTICE precedent) |
| `test/protocols-eigenlayer.test.ts` | unit test (encoder + selector) | n/a | `test/protocols-lido.test.ts` | exact |
| `test/protocols-rocketpool.test.ts` | unit test (encoder + selector + collision guard) | n/a | `test/protocols-lido.test.ts` + `test/protocols-weth9.test.ts` | exact (collision guard novel) |
| `test/prepare-eigenlayer-deposit.test.ts` | unit test (prepare tool) | n/a | `test/prepare-lido-wrap.test.ts` | exact |
| `test/prepare-rocketpool-stake.test.ts` | unit test (prepare tool) | n/a | `test/prepare-lido-stake.test.ts` | exact |
| `test/prepare-rocketpool-unstake.test.ts` | unit test (prepare tool) | n/a | `test/prepare-weth-unwrap.test.ts` | exact (LEDGER NOTICE assertion) |
| `test/get-eigenlayer-positions.test.ts` | unit test (read tool) | n/a | `test/get-lido-positions.test.ts` | exact |
| `test/get-rocketpool-positions.test.ts` | unit test (read tool) | n/a | `test/get-lido-positions.test.ts` | exact |
| `test/integration-eigenlayer-rocketpool.test.ts` | integration test (persona-cycle) | n/a | `test/lido-lifecycle.integration.test.ts` | exact |

### Modified files (6)

| Modified File | Role | Data Flow | Closest Analog (prior extension) | Match Quality |
|---------------|------|-----------|---------------------------------|---------------|
| `src/config/contracts.ts` | SOT extension (Eigen + RP slots + KNOWN_SPENDERS rows) | static config | Phase 30 Lido SOT block (lines 379-438 + KNOWN_SPENDERS rows 531-546) | exact |
| `src/security/canonical-dispatch.ts` | dispatch allowlist extension + `(to, selector)` tuple routing | request-time gate | Phase 30 Lido-arm (lines 130-143) + NOVEL tuple-dispatch | role-match (tuple is new) |
| `src/signing/blocks.ts` | blocks/templates extension (DECODED ARGS + LEDGER NOTICE) | template builder | Phase 30 Lido templates (lines 1568-1770) + WETH9 LEDGER NOTICE (lines 389-400) | exact |
| `src/server.ts` (`register-all.ts`) | side-effect import register-all | startup | `register-all.ts` lines 92-96 Lido imports | exact |
| `test/signing-fingerprint.test.ts` | fixture pinning (Z/AA/AB) | n/a | Fixtures V/W/X/Y (lines 336-410) | exact |
| `test/config-contracts.test.ts` | SOT cross-view byte-identity (T-EIGENLAYER + T-ROCKETPOOL drift) | n/a | T-LIDO-SPENDER-DRIFT-1 (lines 559-619) | exact |
| `test/security-canonical-dispatch.test.ts` | dispatch additive + `(to, selector)` collision test | n/a | Phase 30 entries + NOVEL tuple-collision test | role-match |
| `SECURITY.md` | §6 v2.3 milestone close-out | docs | §v2.1 close-out (lines 329-378) | exact |

---

## Pattern Assignments

### `src/protocols/eigenlayer.ts` (protocol-decoder, multi-method)

**Analog:** `src/protocols/lido.ts` (full file, 221 lines)

**Header documentation pattern** (lines 1-38):
```typescript
// EigenLayer protocol primitives for Phase 31 (Plan 31-XX).
// Single-file decoder covering:
//   - StrategyManager       — `depositIntoStrategy(strategy, token, amount)`
//   - StrategyBase (per-LST) — view-only ABI fragments
//   - DelegationManager     — `getQueuedWithdrawals(staker)` view
//
// Mirror of src/protocols/lido.ts shape (Phase 30 multi-method decoder).
// Per D-02 (CONTEXT.md): single file for the EigenLayer surface.
// Per D-07 (CONTEXT.md): selectors are HARDCODED VERIFIED LITERALS (not
// computed at runtime) — any drift breaks the cryptographic-binding chain
// and is caught by test/protocols-eigenlayer.test.ts.
//
// Function selectors VERIFIED via viem.toFunctionSelector at research time
// (research § Topic 1, date 2026-05-23):
//   StrategyManager.depositIntoStrategy(address,address,uint256): 0xe7a050aa
//   StrategyManager.stakerStrategyShares(address,address):        0x7a7e0d92
//   StrategyBase.sharesToUnderlyingView(uint256):                  0x7a8b2637
//   StrategyBase.userUnderlyingView(address):                      0x553ca5f8
//   DelegationManager.getQueuedWithdrawals(address):               0x5dd68579
//
// ESM spy-affordance: `_eigenLayerProtocol` mirror of `_lidoProtocol`.
```

**Imports + SOT re-export** (analog lines 40-52):
```typescript
import { type Address, type Hex, encodeFunctionData, parseAbi } from "viem";

import {
  getEigenLayerStrategyManagerAddress,
  getEigenLayerDelegationManagerAddress,
  getEigenLayerStrategyAddress,
  getEigenLayerLstTokenAddress,
  getAllEigenLayerStrategiesForChain,
  type ChainId,
  type EigenLayerLst,
} from "../config/contracts.js";

export {
  getEigenLayerStrategyManagerAddress,
  getEigenLayerDelegationManagerAddress,
  getEigenLayerStrategyAddress,
  getEigenLayerLstTokenAddress,
  getAllEigenLayerStrategiesForChain,
};
```

**ABI fragments pattern** (analog lines 67-100):
```typescript
export const STRATEGY_MANAGER_ABI = parseAbi([
  "function depositIntoStrategy(address strategy, address token, uint256 amount) returns (uint256 shares)",
  "function stakerStrategyShares(address staker, address strategy) view returns (uint256)",
]);

export const STRATEGY_BASE_ABI = parseAbi([
  "function sharesToUnderlyingView(uint256 amountShares) view returns (uint256)",
  "function userUnderlyingView(address user) view returns (uint256)",
  "function totalShares() view returns (uint256)",
  "function underlyingToken() view returns (address)",
  "function maxTotalDeposits() view returns (uint256)",
]);

export const DELEGATION_MANAGER_ABI = parseAbi([
  "struct Withdrawal { address staker; address delegatedTo; address withdrawer; uint256 nonce; uint32 startBlock; address[] strategies; uint256[] shares; }",
  "function getQueuedWithdrawals(address staker) view returns (Withdrawal[] withdrawals, uint256[][] shares)",
]);
```

**Selector table** (analog lines 113-123):
```typescript
export const EIGENLAYER_SELECTORS = {
  depositIntoStrategy: "0xe7a050aa" as Hex,
  stakerStrategyShares: "0x7a7e0d92" as Hex,
  sharesToUnderlyingView: "0x7a8b2637" as Hex,
  userUnderlyingView: "0x553ca5f8" as Hex,
  getQueuedWithdrawals: "0x5dd68579" as Hex,
} as const;
```

**Encoder pattern** (analog lines 138-144):
```typescript
export function encodeDepositIntoStrategy(
  strategy: Address,
  lstToken: Address,
  amountWei: bigint,
): Hex {
  return encodeFunctionData({
    abi: STRATEGY_MANAGER_ABI,
    functionName: "depositIntoStrategy",
    args: [strategy, lstToken, amountWei],
  });
}
```

**ESM spy-affordance** (analog lines 215-220):
```typescript
export const _eigenLayerProtocol = {
  encodeDepositIntoStrategy,
};
```

---

### `src/protocols/rocketpool.ts` (protocol-decoder, value-bearing + ERC-20-burn)

**Analog:** `src/protocols/lido.ts` (multi-method shape) + `src/protocols/weth9.ts` (value-bearing no-arg pattern)

**Imports + SOT re-export:** mirrors lido.ts lines 40-52 substituting Rocket Pool getters.

**ABI fragments — multi-contract per RESEARCH § Topic 1:**
```typescript
export const ROCKET_DEPOSIT_POOL_ABI = parseAbi([
  "function deposit() payable",
  "function getBalance() view returns (uint256)",
]);
export const RETH_ABI = parseAbi([
  "function burn(uint256 _rethAmount)",
  "function balanceOf(address account) view returns (uint256)",
  "function getExchangeRate() view returns (uint256)",
  "function getEthValue(uint256 _rethAmount) view returns (uint256)",
]);
export const ROCKET_SETTINGS_DEPOSIT_ABI = parseAbi([
  "function getMinimumDeposit() view returns (uint256)",
]);
```

**Selector table with collision warning comments** (RESEARCH § Topic 1):
```typescript
export const ROCKETPOOL_SELECTORS = {
  // Note: deposit() selector collides with WETH9.deposit() (0xd0e30db0).
  // Dispatch branches on tx.to === getRocketPoolDepositPoolAddress(1).
  deposit: "0xd0e30db0" as Hex,
  // Note: burn(uint256) selector is the canonical ERC-20 Burnable selector.
  // Dispatch branches on tx.to === getRocketPoolRethAddress(1).
  burn: "0x42966c68" as Hex,
} as const;
```

**Constants + encoders — clone from weth9.ts lines 64-82 + lido.ts:**
```typescript
export const RETH_DECIMALS = 18;
// D-07 resilience fallback per RESEARCH § Topic 1 + Topic 7
export const ROCKET_POOL_MINIMUM_DEPOSIT_FALLBACK_WEI: bigint = 10_000_000_000_000_000n;

export function encodeRocketPoolDeposit(): Hex {
  return encodeFunctionData({
    abi: ROCKET_DEPOSIT_POOL_ABI,
    functionName: "deposit",
    args: [],
  });
}
export function encodeRocketPoolBurn(rethAmount: bigint): Hex {
  return encodeFunctionData({
    abi: RETH_ABI,
    functionName: "burn",
    args: [rethAmount],
  });
}
```

**ESM spy-affordance:**
```typescript
export const _rocketPoolProtocol = {
  encodeRocketPoolDeposit,
  encodeRocketPoolBurn,
};
```

---

### `src/chains/eigenlayer.ts` (per-chain read client)

**Analog:** `src/chains/lido.ts` (lines 1-60+)

**Header docstring pattern** (analog lines 1-32):
```typescript
// src/chains/eigenlayer.ts
//
// Per-chain read service for EigenLayer strategy positions — Phase 31 (Plan 31-XX).
//
// Exports read helpers consumed by `get_eigenlayer_positions`:
//   - `readEthereumPositions(client, wallet)` — Ethereum mainnet: per-strategy
//     fan-out across the curated registry. For each strategy with shares > 0:
//     stakerStrategyShares + sharesToUnderlyingView. Plus
//     DelegationManager.getQueuedWithdrawals(staker) for pendingWithdrawals[].
//
// Address resolution: ALWAYS via Plan 31-01 SOT —
//   `getEigenLayerStrategyManagerAddress`, `getAllEigenLayerStrategiesForChain`,
//   `getEigenLayerDelegationManagerAddress` from src/config/contracts.ts.
// NEVER inline an address here.
//
// ESM spy-affordance: `_eigenLayerChains` wraps both helpers.
```

**Read fan-out pattern — RESEARCH § Topic 9 Code Example (lines 1515-1559):**
- per-strategy `stakerStrategyShares` Promise.all then non-zero filter
- per-strategy `sharesToUnderlyingView` Promise.all over filtered set
- `DelegationManager.getQueuedWithdrawals(wallet)` single call → flat row expansion

**ESM spy-affordance** (matches `_lidoChains`):
```typescript
export const _eigenLayerChains = { readEthereumPositions };
```

---

### `src/chains/rocketpool.ts` (per-chain read client)

**Analog:** `src/chains/lido.ts`

**Read shape — RESEARCH § Topic 4:**
```typescript
const [rethBalance, exchangeRate] = await Promise.all([
  client.readContract({ address: rethAddr, abi: RETH_ABI, functionName: "balanceOf", args: [wallet] }),
  client.readContract({ address: rethAddr, abi: RETH_ABI, functionName: "getExchangeRate" }),
]);
const ethEquivalent = computeEthEquivalent({ rethBalance, exchangeRate });
```

**ESM spy-affordance** (matches `_lidoChains`):
```typescript
export const _rocketPoolChains = { readEthereumPositions };
```

---

### `src/signing/eigenlayer-shares.ts` (pure-math)

**Analog:** `src/signing/lido-rebase.ts` (full file, 113 lines)

**Header docstring** (analog lines 1-30):
```typescript
// src/signing/eigenlayer-shares.ts
//
// Pure-bigint shares → underlying math for EigenLayer strategies — Phase 31.
//
// NO side effects. NO RPC reads. NO module-load state.
// All bigint arithmetic; no Number() casts; no floating point.
//
// Locked on src/signing/ to keep the trust-pipeline shelf coherent (mirrors
// src/signing/lido-rebase.ts shape).
//
// Threat anchors:
//   - T-EIGENLAYER-SHARES-STALENESS (MEDIUM): off-chain conversion uses a
//     supplied rate snapshot — caller should prefer on-chain
//     `sharesToUnderlyingView` for the canonical value. The `approx: true`
//     literal type is LOAD-BEARING.
```

**Constants + interface + pure function** (analog lines 35-98):
```typescript
export const SHARES_SCALE: bigint = 10n ** 18n;

export interface EigenLayerSharesInput {
  shares: bigint;
  underlyingPerShareNumerator?: bigint;
}
export interface EigenLayerSharesOutput {
  underlyingAmount: bigint;
  approx: true;  // load-bearing literal type
}
export function convertSharesToUnderlying(input: EigenLayerSharesInput): EigenLayerSharesOutput { /* … */ }

export const _eigenLayerShares = { convertSharesToUnderlying };
```

---

### `src/signing/rocketpool-rate.ts` (pure-math)

**Analog:** `src/signing/lido-rebase.ts`

**Pure-math shape — RESEARCH § Topic 4 (lines 619-639):**
```typescript
export const RETH_SCALE: bigint = 10n ** 18n;
export const RETH_DECIMALS: bigint = 18n;

export interface RocketPoolRateInput {
  rethBalance: bigint;
  exchangeRate: bigint;
}
export interface RocketPoolRateOutput {
  ethEquivalent: bigint;
  // No approx flag — getExchangeRate() is canonical at the read block.
}
export function computeEthEquivalent(input: RocketPoolRateInput): RocketPoolRateOutput {
  return { ethEquivalent: (input.rethBalance * input.exchangeRate) / RETH_SCALE };
}

export const _rocketPoolRate = { computeEthEquivalent };
```

---

### `src/tools/prepare_eigenlayer_deposit.ts` (prepare tool — ERC-20-shape + approval pre-flight + LEDGER NOTICE)

**Analog:** `src/tools/prepare_lido_wrap.ts` (full file, 246 lines)

**Header docstring (clone of analog lines 1-27 with EigenLayer-specific bindings):**
```typescript
// MCP tool: prepare_eigenlayer_deposit({ chain, lst, amount, from? })
//
// Phase 31 — Plan 31-XX. EigenLayer LST deposit via
// StrategyManager.depositIntoStrategy(strategy, token, amount). Mechanical
// clone of prepare_lido_wrap.ts with bounded deviations:
//
//   (a) input schema is `{ chain: ["ethereum"], lst, amount, from? }`.
//   (b) `lst` is a curated LST enum (D-04 — 7 strategies); off-list refuses
//       with INVALID_INPUT + hintTool: request_capability.
//   (c) server resolves BOTH strategy + lstToken from the curated registry
//       row (T-EIGENLAYER-STRATEGY-MISMATCH — Pitfall 3); agent passes only
//       the LST symbol, never raw addresses.
//   (d) tx.to = getEigenLayerStrategyManagerAddress(1).
//   (e) tx.valueWei = 0n. Deposit is NOT payable; LST consumed as ERC-20.
//   (f) tx.data = encodeDepositIntoStrategy(strategy, lstToken, amountWei).
//   (g) D-05: LST allowance pre-flight (analog wrap's D-05 pattern at lines
//       155-184). Refuses with INVALID_INPUT + hintTool: prepare_token_approve.
//   (h) D-06: deposit-cap pre-flight (RESEARCH § Topic 6 — defensive sentinel
//       check against 2^256-1 first per Pitfall 6).
//
// D-13 NEW: ERC-7730 registry has NO eigenlayer/ directory (RESEARCH §
// Topic 8). LEDGER NOTICE block REQUIRED — unlike prepare_lido_wrap.
// Emission via LEDGER_NOTICE_EIGENLAYER_DEPOSIT_TEMPLATE.
//
// Fixture Z cross-link: test/prepare-eigenlayer-deposit.test.ts re-anchors
// the payloadFingerprint byte-identity via the hardcoded literal from
// test/signing-fingerprint.test.ts Fixture Z.
```

**Imports pattern** (analog lines 29-50) — substitute EigenLayer imports:
```typescript
import { type Address, type Hex, erc20Abi, formatUnits } from "viem";

import {
  EIGENLAYER_DEPOSIT_PREPARE_RECEIPT_TEMPLATE,
} from "../signing/blocks.js";
import {
  encodeDepositIntoStrategy,
  STRATEGY_BASE_ABI,
  getEigenLayerStrategyManagerAddress,
  getEigenLayerStrategyAddress,
  getEigenLayerLstTokenAddress,
} from "../protocols/eigenlayer.js";
import { InvalidAmountError, parseAmountStrict } from "../signing/amount.js";
import {
  type ErrorCode,
  type StructuredError,
  makeStructuredError,
} from "../signing/error-codes.js";
import { createHandle } from "../signing/handle-store.js";
import { computePayloadFingerprint } from "../signing/payload-fingerprint.js";
import { resolveFrom } from "../signing/resolve-from.js";
import { getChainClient } from "../chains/registry.js";
import { registerTool } from "./index.js";
```

**Curated-LST schema enum** (RESEARCH § Architecture Patterns Pattern 1, line 1342-1349):
```typescript
const INPUT_SCHEMA = {
  type: "object" as const,
  properties: {
    chain: { type: "string", enum: ["ethereum"] },
    lst: {
      type: "string",
      enum: ["stETH", "rETH", "cbETH", "ETHx", "wBETH", "sfrxETH", "mETH"],
      description: "LST symbol from the curated EigenLayer registry. Long-tail LSTs refuse with INVALID_INPUT + hintTool: request_capability.",
    },
    amount: { type: "string" },
    from: { type: "string", pattern: "^0x[0-9a-fA-F]{40}$" },
  },
  required: ["chain", "lst", "amount"],
  additionalProperties: false,
};
```

**Allowance pre-flight pattern** (analog lines 155-184) — substitute spender = StrategyManager:
```typescript
const allowance: bigint = await client.readContract({
  address: lstTokenAddr,
  abi: erc20Abi,
  functionName: "allowance",
  args: [fromAddress, strategyManagerAddr],
});
if (allowance < amountWei) {
  // INVALID_INPUT + hintTool: prepare_token_approve with spender = strategyManagerAddr
}
```

**Cap pre-flight pattern** (RESEARCH § Topic 6 lines 745-768 + Pattern 3 lines 1380-1397):
```typescript
const MAX_UINT256 = 2n ** 256n - 1n;
const [currentTotalShares, maxTotalDeposits] = await Promise.all([
  client.readContract({ address: strategyAddr, abi: STRATEGY_BASE_ABI, functionName: "totalShares" }),
  client.readContract({ address: strategyAddr, abi: STRATEGY_BASE_ABI, functionName: "maxTotalDeposits" })
    .catch(() => MAX_UINT256),
]);
if (maxTotalDeposits !== MAX_UINT256 && currentTotalShares >= maxTotalDeposits) {
  return errEnvelope("INVALID_INPUT", `EigenLayer ${lst} strategy at cap`, { hintTool: "request_capability", … });
}
```

---

### `src/tools/prepare_rocketpool_stake.ts` (prepare tool — value-bearing + LEDGER NOTICE)

**Analog:** `src/tools/prepare_lido_stake.ts` (full file, 234 lines)

**Header docstring + D-13 NOTE — D-13 mandates new LEDGER NOTICE template** (clone analog lines 1-33 but flip D-12 to D-13 + LEDGER NOTICE required):
```typescript
// MCP tool: prepare_rocketpool_stake({ chain, amount, from? })
//
// Phase 31 — Plan 31-XX. Value-bearing stake call: RocketDepositPool.deposit()
// (no-arg payable; msg.value carries ETH amount). Mechanical clone of
// prepare_lido_stake.ts with bounded deviations:
//
//   (a)-(d) same shape as Lido stake — payable, chainId locked to ethereum.
//   (e) tx.data = encodeRocketPoolDeposit() — 4-byte selector only (0xd0e30db0).
//   (f) D-07: minimum-deposit pre-flight via
//       RocketDAOProtocolSettingsDeposit.getMinimumDeposit(); fallback to
//       hardcoded ROCKET_POOL_MINIMUM_DEPOSIT_FALLBACK_WEI on RPC failure.
//
// D-13: ERC-7730 registry has NO rocketpool/ directory. LEDGER NOTICE
// REQUIRED — unlike prepare_lido_stake. Shared template
// LEDGER_NOTICE_ROCKETPOOL_TEMPLATE covers both stake + unstake (the
// blind-sign UX is symmetric).
//
// Pitfall 1 (selector collision with WETH9.deposit) — dispatch routes on
// (tx.to, selector) tuple, NOT selector alone.
//
// Fixture AA cross-link.
```

**Min-deposit pre-flight — RESEARCH § Topic 7 (lines 789-808):**
```typescript
let minimumDeposit: bigint;
try {
  minimumDeposit = await client.readContract({
    address: settingsDepositAddr,
    abi: ROCKET_SETTINGS_DEPOSIT_ABI,
    functionName: "getMinimumDeposit",
  });
} catch (err) {
  minimumDeposit = ROCKET_POOL_MINIMUM_DEPOSIT_FALLBACK_WEI;
}
if (amountWei < minimumDeposit) {
  return errEnvelope("INVALID_INPUT", `Rocket Pool minimum deposit is ${formatEther(minimumDeposit)} ETH, got ${rawAmount}`, {
    hintTool: "request_capability",
    hintArgs: { feature: "Rocket Pool minimum deposit context" },
  });
}
```

---

### `src/tools/prepare_rocketpool_unstake.ts` (prepare tool — single-arg burn + LEDGER NOTICE)

**Analog:** `src/tools/prepare_weth_unwrap.ts` (full file, 217 lines)

**Why prepare_weth_unwrap is the right analog (D-13 NOTICE precedent):**
- `rETH.burn(uint256)` is single-arg, returns nothing — matches `WETH9.withdraw(uint256)` shape exactly.
- `prepare_weth_unwrap` is the ONLY existing prepare tool that emits a LEDGER NOTICE block — Phase 31 unstake inherits the same pattern.
- Selector collision with generic ERC-20 Burnable (Pitfall 2 — RESEARCH § Topic 1) — dispatch routes on (tx.to, selector).

**Header docstring clone-pattern** (analog lines 1-37):
```typescript
// MCP tool: prepare_rocketpool_unstake({ chain, rethAmount, from? })
//
// Phase 31 — Plan 31-XX. rETH → ETH burn via rETH.burn(rethAmount).
// Mechanical clone of prepare_weth_unwrap.ts with bounded deviations:
//
//   (a) input schema is `{ chain: ["ethereum"], rethAmount, from? }` —
//       no `to` (burn has no recipient; ETH returns to msg.sender),
//       no `tokenAddress` (one rETH per chain; resolved via SOT getter).
//   (b) decimal resolution: hard-coded to 18 (RETH_DECIMALS).
//   (c) encoder = encodeRocketPoolBurn(rethAmountWei).
//   (d) tx.to = getRocketPoolRethAddress(1).
//   (e) tx.valueWei = 0n.
//   (f) D-08: deposit-pool-liquidity pre-flight — read RocketDepositPool
//       .getBalance() + rETH.getEthValue(amount); refuse with INVALID_INPUT
//       + hintTool: request_capability if pool < ethEquivalent.
//
// D-13: same as prepare_weth_unwrap precedent (Phase 6 Plan 06-04) —
// LEDGER NOTICE block ABOVE the LEDGER BLIND-SIGN HASH for the burn
// selector. The shared LEDGER_NOTICE_ROCKETPOOL_TEMPLATE covers both
// stake and unstake (symmetric UX).
//
// Fixture AB cross-link.
```

**Pool-liquidity pre-flight — RESEARCH § Topic 7 (lines 826-848):**
```typescript
const [poolBalance, ethEquivalent] = await Promise.all([
  client.readContract({ address: depositPoolAddr, abi: ROCKET_DEPOSIT_POOL_ABI, functionName: "getBalance" }),
  client.readContract({ address: rethAddr, abi: RETH_ABI, functionName: "getEthValue", args: [amountWei] }),
]);
if (poolBalance < ethEquivalent) {
  return errEnvelope("INVALID_INPUT",
    `Rocket Pool deposit pool empty (${formatEther(poolBalance)} ETH liquidity, need ${formatEther(ethEquivalent)} ETH for burn). Swap rETH on a DEX (Uniswap V3, Curve) instead, or wait for more deposits to refill the pool.`,
    { hintTool: "request_capability", hintArgs: { feature: "Rocket Pool rETH/ETH DEX swap" } });
}
```

---

### `src/tools/get_eigenlayer_positions.ts` (read tool)

**Analog:** `src/tools/get_lido_positions.ts` (full file, 244 lines)

**Description + schema pattern** (analog lines 44-72) — narrow `chain` enum to `["ethereum"]` ONLY (no Arbitrum branch — Phase 31 is Ethereum-only).

**Handler pattern** (analog lines 83-242):
```typescript
registerTool("get_eigenlayer_positions", DESCRIPTION, INPUT_SCHEMA, async (args) => {
  // 1. validate chain (Ethereum-only — narrower than get_lido_positions)
  // 2. validate wallet address (isAddress + getAddress)
  // 3. const client = getChainClient(1)
  // 4. const result = await _eigenLayerChains.readEthereumPositions(client, wallet)
  // 5. structuredContent: { chain, chainId, wallet, deposits, pendingWithdrawals, totalEthEquivalent, approx: true, rpcDegraded?}
  // 6. summaryLines = per-strategy line + per-pending-withdrawal line
});
```

---

### `src/tools/get_rocketpool_positions.ts` (read tool)

**Analog:** `src/tools/get_lido_positions.ts`

**Same handler shape as get_eigenlayer_positions** with simpler result (rethBalance + exchangeRate + ethEquivalent + chain: "ethereum").

---

## Modified Files — Pattern Assignments

### `src/config/contracts.ts` — SOT extension

**Analog block (Phase 30 Lido):** lines 379-438 (LidoContracts interface + LIDO_RAW + 3 getters) + lines 531-546 (KNOWN_SPENDERS Lido rows).

**Pattern to clone — `LidoContracts` interface (lines 379-438):**
```typescript
export interface LidoContracts {
  steth: Address;
  wsteth: Address;
  withdrawalQueue: Address;
}
const LIDO_RAW: Partial<Record<ChainId, LidoContracts>> = {
  1: {
    steth: getAddress("0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84"),
    wsteth: getAddress("0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0"),
    withdrawalQueue: getAddress("0x889edC2eDab5f40e902b864aD4d7AdE8E412F9B1"),
  },
  // ... 42161 entry omitted for Phase 31 (Ethereum-only)
};
export function getLidoStethAddress(chainId: ChainId): Address | null { return LIDO_RAW[chainId]?.steth ?? null; }
// ... 2 more getters
```

**Phase 31 EigenLayer block — RESEARCH § Topic 3 (lines 430-522):** clone the LIDO_RAW shape with the curated EigenLayer registry (`EigenLayerLst` literal-union type + `EigenLayerContracts` interface + `EIGENLAYER_RAW[1]` populated entry + 5 flat getters + `getAllEigenLayerStrategiesForChain`).

**Phase 31 Rocket Pool block — RESEARCH § Topic 3 (lines 524-562):** clone shape with `RocketPoolContracts` interface + `ROCKETPOOL_RAW[1]` populated entry + 3 flat getters + `ROCKET_POOL_MINIMUM_DEPOSIT_FALLBACK_WEI` constant.

**KNOWN_SPENDERS_ETHEREUM extension** — analog rows lines 531-546 — append 3 new rows (RESEARCH § Topic 3 lines 564-587):
```typescript
// EigenLayer — Phase 31 Plan 31-XX. StrategyManager is the LST approval target.
{
  address: getEigenLayerStrategyManagerAddress(1)!,
  label: "EigenLayer StrategyManager",
  source: "https://github.com/Layr-Labs/eigenlayer-contracts",
},
{
  address: getRocketPoolDepositPoolAddress(1)!,
  label: "Rocket Pool RocketDepositPool (stake — value-bearing)",
  source: "https://docs.rocketpool.net/",
},
{
  address: getRocketPoolRethAddress(1)!,
  label: "Rocket Pool rETH token (burn target)",
  source: "https://docs.rocketpool.net/",
},
```

---

### `src/security/canonical-dispatch.ts` — allowlist extension + `(to, selector)` tuple routing

**Analog block (Phase 30 Lido):** `src/security/canonical-dispatch.ts` lines 130-143.

**Pattern to clone — Lido entries with address(0) sentinel filter:**
```typescript
const lidoSteth = getLidoStethAddress(chainId);
const lidoWsteth = getLidoWstethAddress(chainId);
const lidoWq = getLidoWithdrawalQueueAddress(chainId);
const lidoEntries: Address[] = [lidoSteth, lidoWsteth, lidoWq].filter(
  (a): a is Address => !!a && a !== "0x0000000000000000000000000000000000000000",
);
// then ...lidoEntries in the Set spread (line 152)
```

**Phase 31 EigenLayer + Rocket Pool extension — RESEARCH § Topic 9 (lines 975-1003):**
```typescript
const eigenStrategyManager = getEigenLayerStrategyManagerAddress(chainId);
const eigenStrategies = getAllEigenLayerStrategiesForChain(chainId).map((s) => s.strategy);
const eigenEntries: Address[] = [eigenStrategyManager, ...eigenStrategies].filter(
  (a): a is Address => !!a && a !== "0x0000000000000000000000000000000000000000",
);
const rocketDepositPool = getRocketPoolDepositPoolAddress(chainId);
const rocketReth = getRocketPoolRethAddress(chainId);
const rocketEntries: Address[] = [rocketDepositPool, rocketReth].filter(
  (a): a is Address => !!a && a !== "0x0000000000000000000000000000000000000000",
);
return new Set<Address>([
  /* … existing entries … */
  ...eigenEntries,
  ...rocketEntries,
]);
```

**NOVEL — `(to, selector)` tuple routing (Pitfall 1 — RESEARCH § Topic 1 + § Anti-Patterns):**

This is NEW for Phase 31 — no prior phase needed it because no selector collisions existed. The pattern is documented but NOT in any existing source file yet. The current `checkDispatchTarget(chainId, to)` is selector-blind. Phase 31 introduces a sibling helper or extends the existing one to take `(chainId, to, selector?)` and exposes the collision-safe path used by `preview_send` for the DECODED ARGS dispatch:

```typescript
// Phase 31 NOVEL — preview_send DECODED ARGS dispatch must branch on
// (record.tx.to, selector) tuple before classifying because:
//   - 0xd0e30db0 collides between WETH9.deposit() and RocketDepositPool.deposit()
//   - 0x42966c68 collides between generic ERC-20 Burnable.burn() and rETH.burn()
// Pattern (NEW helper or inline branch — planner's choice):
if (record.tx.to === getRocketPoolDepositPoolAddress(1) && selector === "0xd0e30db0") {
  // Route as Rocket Pool stake; emit ROCKETPOOL DECODED ARGS + LEDGER NOTICE
} else if (record.tx.to === getWethAddress(1) && selector === "0xd0e30db0") {
  // Route as WETH9.deposit() — wraps native (v2+ scope; today unused)
}
```

**Allowlist gate itself (`checkDispatchTarget`) does NOT need tuple routing** — the new Rocket Pool addresses join the per-chain Set just like Lido did. The tuple is purely for the DECODED ARGS classification dispatch in `preview_send` / `buildDecodedArgsBlock`.

---

### `src/signing/blocks.ts` — DECODED ARGS + PREPARE RECEIPT + LEDGER NOTICE extensions

**Analog blocks:**

- LEDGER NOTICE template (clone of `LEDGER_NOTICE_WETH_UNWRAP_TEMPLATE` lines 389-400 from `src/signing/blocks.ts`):
  ```typescript
  export const LEDGER_NOTICE_WETH_UNWRAP_TEMPLATE: string = [
    "LEDGER NOTICE",
    "  WETH unwrap is NOT covered by the Ledger Ethereum app's ERC-20 clear-sign plugin.",
    "  Your device will likely BLIND-SIGN this transaction (display a raw hash, no decoded args).",
    "  If your device refuses with \"Blind signing is not enabled\":",
    "    1. Open the Ethereum app on your device",
    "    2. Settings → Blind signing → Enabled",
    "    3. Retry send_transaction",
    "  After send_transaction fires, compare the PREDICTED hash below to the",
    "  value your hardware device displays — character-for-character. This",
    "  on-device match is the cryptographic anchor.",
  ].join("\n");
  ```
  Phase 31 clones with substitution per RESEARCH § Topic 8 (lines 879-910):
  - `LEDGER_NOTICE_EIGENLAYER_DEPOSIT_TEMPLATE` — "EigenLayer depositIntoStrategy is NOT covered…"
  - `LEDGER_NOTICE_ROCKETPOOL_TEMPLATE` — shared between stake + unstake — "Rocket Pool deposit/burn is NOT covered…"

- PREPARE RECEIPT templates (clone of Lido PREPARE RECEIPT templates lines 1575-1622):
  ```typescript
  export const LIDO_WRAP_PREPARE_RECEIPT_TEMPLATE: string = [
    "PREPARE RECEIPT",
    "  operation:    Lido wrap (stETH → wstETH)",
    "  chain:        {CHAIN}",
    "  wstethContract: {WSTETH_CONTRACT}",
    "  stethAmount:  {AMOUNT} stETH",
  ].join("\n");
  ```
  Phase 31 clones for `EIGENLAYER_DEPOSIT_PREPARE_RECEIPT_TEMPLATE`, `ROCKETPOOL_STAKE_PREPARE_RECEIPT_TEMPLATE`, `ROCKETPOOL_UNSTAKE_PREPARE_RECEIPT_TEMPLATE`.

- DECODED ARGS templates + buildXDecodedArgsBlock helper (clone of Lido DECODED ARGS templates lines 1676-1770):
  ```typescript
  export function buildLidoDecodedArgsBlock(decoded: LidoDecoded): string {
    switch (decoded.kind) {
      case "lido-stake":
        return DECODED_ARGS_TEMPLATE_LIDO_STAKE
          .replace("{STETH_CONTRACT}", decoded.contractAddress)
          .replace("{VALUE_ETH}", formatUnits(decoded.valueWei, STETH_DEC))
          .replace("{REFERRAL}", decoded.referral);
      // … 3 more cases
    }
  }
  ```
  Phase 31 clones `buildEigenLayerDecodedArgsBlock` (1 case: `eigenlayer-deposit`) + `buildRocketPoolDecodedArgsBlock` (2 cases: `rocketpool-stake`, `rocketpool-burn`).

**KEY DIVERGENCE FROM PHASE 30 — D-13:** Lido has NO LEDGER NOTICE template; Phase 31 ADDS two. Cross-reference the explicit-comment style at analog line 540: `LEDGER_NOTICE_WETH_UNWRAP_TEMPLATE is the only NOTICE template`. Phase 31 updates this comment to reflect the new templates.

---

### `src/server.ts` / `src/tools/register-all.ts` — additive imports

**Analog block:** `src/tools/register-all.ts` lines 92-96.

**Pattern to clone:**
```typescript
import "./get_lido_positions.js";         // Phase 30 Plan 30-02 (LIDO-01)
import "./prepare_lido_stake.js";         // Phase 30 Plan 30-03 (LIDO-02)
import "./prepare_lido_unstake.js";       // Phase 30 Plan 30-03 (LIDO-03)
import "./prepare_lido_wrap.js";          // Phase 30 Plan 30-03 (LIDO-04)
import "./prepare_lido_unwrap.js";        // Phase 30 Plan 30-03 (LIDO-04)
```

**Phase 31 additive imports (5 new tools):**
```typescript
import "./get_eigenlayer_positions.js";     // Phase 31 Plan 31-02
import "./prepare_eigenlayer_deposit.js";   // Phase 31 Plan 31-02
import "./get_rocketpool_positions.js";     // Phase 31 Plan 31-03
import "./prepare_rocketpool_stake.js";     // Phase 31 Plan 31-03
import "./prepare_rocketpool_unstake.js";   // Phase 31 Plan 31-03
```

---

### `test/signing-fingerprint.test.ts` — Fixtures Z/AA/AB hardcoded literals

**Analog block:** lines 336-410 (Fixtures V/W/X/Y — Phase 30 Lido).

**Pattern to clone — Fixture V (analog lines 336-354):**
```typescript
it("Fixture V — Lido.submit(referral=address(0)) with value=1e18 ETH fingerprint (hardcoded literal anchor, Phase 30 Plan 30-01)", () => {
  const steth = getLidoStethAddress(1)!;
  const submitData = encodeLidoSubmit("0x0000000000000000000000000000000000000000" as Address);
  expect(submitData.length).toBe(74);
  expect(submitData.slice(0, 10).toLowerCase()).toBe("0xa1903eab");
  const fp = computePayloadFingerprint({
    chainId: 1,
    to: steth,
    valueWei: 1_000_000_000_000_000_000n,
    data: submitData,
  });
  expect(fp).toBe("0xab550a2883eb494493169aeff633b77af8f5d458ed0f406b49ce9513b2fe7ed1");
});
```

**Phase 31 Fixtures Z / AA / AB** (CONTEXT D-14 + RESEARCH § Topic 12 lines 1104-1109):

- **Fixture Z** = `StrategyManager.depositIntoStrategy(stETH-Strategy, stETH, 1e18)`
  - `to = getEigenLayerStrategyManagerAddress(1)`
  - `data = encodeDepositIntoStrategy(stETH-Strategy, stETH-token, 1e18)`
  - selector slice = `"0xe7a050aa"`
  - data length = 4 + 32 + 32 + 32 = 100 bytes = 0x + 200 hex = 202 chars
  - hardcoded literal to be computed at write-time via inline script

- **Fixture AA** = `RocketDepositPool.deposit()` value-bearing
  - `to = getRocketPoolDepositPoolAddress(1)`
  - `data = encodeRocketPoolDeposit()` (4-byte selector only)
  - selector slice = `"0xd0e30db0"`
  - data length = 4 bytes = 10 chars (`"0xd0e30db0"`)
  - `valueWei = 1_000_000_000_000_000_000n` (1 ETH)

- **Fixture AB** = `rETH.burn(1e18)`
  - `to = getRocketPoolRethAddress(1)`
  - `data = encodeRocketPoolBurn(1_000_000_000_000_000_000n)`
  - selector slice = `"0x42966c68"`
  - data length = 4 + 32 = 36 bytes = 74 chars

**Cross-link comment template** (analog lines 330-333): cross-link to `test/prepare-eigenlayer-deposit.test.ts`, `test/prepare-rocketpool-stake.test.ts`, `test/prepare-rocketpool-unstake.test.ts`, and `test/integration-eigenlayer-rocketpool.test.ts`.

---

### `test/config-contracts.test.ts` — cross-view byte-identity (T-EIGENLAYER-SPENDER-DRIFT-1 + T-ROCKETPOOL-SPENDER-DRIFT-1)

**Analog block:** lines 559-619 (T-LIDO-SPENDER-DRIFT-1).

**Pattern to clone — Lido drift test (analog lines 572-577):**
```typescript
it("T-LIDO-SPENDER-DRIFT-1a — KNOWN_SPENDERS_ETHEREUM 'Lido wstETH (for stETH wrap)' row ↔ getLidoWstethAddress(1) byte-identical", () => {
  const row = KNOWN_SPENDERS_ETHEREUM.find((r) => r.label === "Lido wstETH (for stETH wrap)");
  expect(row).toBeDefined();
  expect(row?.address).toBe(getLidoWstethAddress(1));
});
```

**Phase 31 T-EIGENLAYER-SPENDER-DRIFT-1** — cross-view byte-identity between `getEigenLayerStrategyManagerAddress(1)` and the `KNOWN_SPENDERS_ETHEREUM` row labeled `"EigenLayer StrategyManager"`.

**Phase 31 T-ROCKETPOOL-SPENDER-DRIFT-1** — cross-view byte-identity for RocketDepositPool + rETH rows.

**Per-strategy entries:** Phase 31 D-01 mandates per-strategy byte-identity tests too — for each of the 7 curated strategies, assert `getEigenLayerStrategyAddress(1, lst)` is non-null and `getAddress`-canonical. (No KNOWN_SPENDERS row per strategy — strategies are NOT approval targets; the StrategyManager is. The per-strategy registration is purely for the canonical-dispatch allowlist.)

**Verified-literal anchor pattern** (analog lines 587-619):
```typescript
it("getLidoStethAddress(1) === verified stETH proxy literal (0xae7ab965...)", () => {
  expect(getLidoStethAddress(1)).toBe(getAddress("0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84"));
});
```
Clone for each EigenLayer + Rocket Pool address verified in RESEARCH § Topic 1.

---

### `test/security-canonical-dispatch.test.ts` — additive entries + `(to, selector)` collision test

**Analog block:** existing file lines 1-100 (membership lower-bound assertions + per-chain × per-canonical-entry checks).

**Pattern to extend — existing Lower-bound assertion (lines 52-54):**
```typescript
it("Ethereum (1) Set has >= 21 entries (4 canonical + BRIDGED_VARIANTS Ethereum rows + 6 Compound Comets)", () => {
  expect(CANONICAL_DISPATCH_TARGETS[1].size).toBeGreaterThanOrEqual(21);
});
```

**Phase 31 additive — `>= 39` (Phase 30 = 29 + 1 StrategyManager + 7 strategies + RocketDepositPool + rETH = 39, less any dedupe).**

**Per-chain × per-canonical-entry membership clone (analog lines 79-100):** add membership assertions for StrategyManager, each of the 7 strategies, RocketDepositPool, rETH.

**NOVEL test — `(tx.to, selector)` tuple collision guard (Pitfall 1 + Pitfall 2 — RESEARCH § Topic 11):**

This is a NEW test class. Pattern (planner's call where it lands — likely a new `test/preview-send.eigenlayer-rocketpool.test.ts` file given the convention from `test/preview-send.aave.test.ts` etc.):
```typescript
it("(to, selector) tuple — WETH9.deposit() routes WETH branch, NOT Rocket Pool branch", () => {
  // selector === 0xd0e30db0 + to === getWethAddress(1) → WETH9.deposit() dispatch arm
  // selector === 0xd0e30db0 + to === getRocketPoolDepositPoolAddress(1) → Rocket Pool stake arm
  // assert different DECODED ARGS blocks emitted
});
it("(to, selector) tuple — generic ERC-20 burn(uint256) does NOT match rETH.burn arm", () => {
  // selector === 0x42966c68 + to !== getRocketPoolRethAddress(1) → no Rocket Pool LEDGER NOTICE
  // selector === 0x42966c68 + to === getRocketPoolRethAddress(1) → Rocket Pool burn DECODED ARGS + LEDGER NOTICE
});
```

---

### `SECURITY.md` §6 — v2.3 milestone close-out

**Analog block:** lines 329-378 (v2.1 TRON milestone close-out — `## TRON v2.1 milestone close-out summary`).

**Pattern to clone — section structure:**
1. Section header: `## EVM lending + staking v2.3 milestone close-out summary`
2. One-paragraph scope statement (closes out Compound V3 + Morpho Blue + Lido + EigenLayer + Rocket Pool — v2.3)
3. `### Milestone PRs` — one bullet per phase (28/29/30/31)
4. `### Trust-shape recap` — navigation pointer to per-phase sections; no new prose
5. `### Clear-sign coverage gap (NEW for v2.3)` — explicit subsection because v2.3 surfaces this divergence (RESEARCH § Topic 13)
6. `### 21-code error union FROZEN` — list of `INVALID_INPUT + hintTool` adopters from v2.3
7. `### Accepted residual risks` — verify-phase pending + Rocket Pool deposit pool liquidity race + EigenLayer queued-withdrawal claim deferred + EigenLayer/Rocket Pool clear-sign coverage absent
8. `### Phase 31 threat register summary` — table per RESEARCH § Topic 13 lines 1194-1204

**Exact content drafted in RESEARCH § Topic 13 lines 1148-1206 — copy verbatim into the SECURITY.md edit.**

---

## Shared Patterns

### Authentication / Sender Resolution
**Source:** `src/signing/resolve-from.js` (used by every prepare tool)
**Apply to:** All 3 Phase 31 prepare tools
**Excerpt (analog `prepare_lido_wrap.ts` lines 122-129):**
```typescript
const rawFrom = typeof args.from === "string" ? args.from : undefined;
const fromResolution = await resolveFrom({ rawFrom, chainId });
if (fromResolution.kind === "error") {
  return fromResolution.result;
}
const fromAddress: Address = fromResolution.fromAddress;
const fromCallerSupplied = fromResolution.callerSupplied;
```

### Chain-mismatch gate
**Source:** Phase 30 Lido D-03 surface (errorCode 15 `CHAIN_ID_MISMATCH`)
**Apply to:** All 3 Phase 31 prepare tools (Ethereum-only writes per D-03)
**Excerpt (analog `prepare_lido_stake.ts` lines 107-122):**
```typescript
const chainName = typeof args.chain === "string" ? args.chain : "";
if (chainName !== "ethereum") {
  return {
    isError: true,
    content: [{ type: "text", text: `error: invalid 'chain': … support only 'ethereum', got "${chainName}"` }],
    structuredContent: errEnvelope("CHAIN_ID_MISMATCH", `invalid 'chain': … support only 'ethereum', got "${chainName}"`),
  };
}
const chainId = 1;
```

### Decimal-string amount parsing
**Source:** `src/signing/amount.ts` (`parseAmountStrict`)
**Apply to:** All 3 Phase 31 prepare tools (CLAUDE.md decimal-aware boundary rule)
**Excerpt (analog `prepare_lido_wrap.ts` lines 131-149):**
```typescript
let amountWei: bigint;
try {
  amountWei = parseAmountStrict(rawAmount, STETH_DECIMALS);
} catch (err) {
  const message = err instanceof InvalidAmountError ? err.message : (err instanceof Error ? err.message : String(err));
  return {
    isError: true,
    content: [{ type: "text", text: `error: invalid 'stethAmount': ${message}` }],
    structuredContent: errEnvelope("INVALID_INPUT", `invalid 'stethAmount': ${message}`),
  };
}
```

### Error envelope helper
**Source:** `src/signing/error-codes.ts` (`makeStructuredError`)
**Apply to:** All 3 Phase 31 prepare tools + 2 read tools
**Excerpt (analog `prepare_lido_wrap.ts` lines 52-59):**
```typescript
function errEnvelope(code: ErrorCode, message: string, cause?: string): Record<string, unknown> {
  return makeStructuredError(code, message, cause) as unknown as Record<string, unknown> & StructuredError;
}
```

### Handle creation
**Source:** `src/signing/handle-store.ts` (`createHandle`)
**Apply to:** All 3 Phase 31 prepare tools
**Excerpt (analog `prepare_lido_stake.ts` lines 189-198):**
```typescript
const handle = createHandle({
  args: { to: "", valueWei: amountWei.toString(), tokenAddress: stethAddr, amount: rawAmount },
  tx,
  payloadFingerprint,
});
```

### PREPARE RECEIPT verbatim relay
**Source:** CLAUDE.md "PREPARE RECEIPT block" rule
**Apply to:** All 3 Phase 31 prepare tools
**Excerpt (analog `prepare_lido_wrap.ts` lines 214-220):**
```typescript
const baseReceipt = LIDO_WRAP_PREPARE_RECEIPT_TEMPLATE
  .replace("{CHAIN}", `ethereum (chainId 1)`)
  .replace("{WSTETH_CONTRACT}", wstethAddr)
  .replace("{AMOUNT}", rawAmount);
const receipt = fromCallerSupplied ? `${baseReceipt}\n  from:         ${rawFrom}` : baseReceipt;
```

### `INVALID_INPUT + hintTool` intent-vs-reality
**Source:** Phase 28 Compound + Phase 30 Lido D-05 pattern
**Apply to:** All 4 Phase 31 pre-flights — D-05 (LST approval), D-06 (deposit cap), D-07 (min deposit), D-08 (pool liquidity)
**Excerpt (analog `prepare_lido_wrap.ts` lines 164-184):**
```typescript
if (allowance < amountWei) {
  const insufficientMessage = `insufficient stETH allowance …`;
  return {
    isError: true,
    content: [{ type: "text", text: `error: ${insufficientMessage}` }],
    structuredContent: {
      ...errEnvelope("INVALID_INPUT", insufficientMessage),
      hintTool: "prepare_token_approve",
      hintArgs: { tokenAddress: stethAddr, spender: wstethAddr, amount: formatUnits(amountWei, 18) },
    },
  };
}
```

### `payloadFingerprint` compute at prepare time
**Source:** Phase 4 trust pipeline (FROZEN)
**Apply to:** All 3 Phase 31 prepare tools
**Excerpt (analog `prepare_lido_wrap.ts` lines 198-199):**
```typescript
const payloadFingerprint = computePayloadFingerprint(tx);
```

### ESM spy-affordance object
**Source:** CLAUDE.md "ESM spy-affordance indirection" rule + Phase 30 `_lidoProtocol` / `_lidoChains` / `_lidoRebase`
**Apply to:** Every new Phase 31 src/ file with internally-called exports — `src/protocols/eigenlayer.ts` (`_eigenLayerProtocol`), `src/protocols/rocketpool.ts` (`_rocketPoolProtocol`), `src/chains/eigenlayer.ts` (`_eigenLayerChains`), `src/chains/rocketpool.ts` (`_rocketPoolChains`), `src/signing/eigenlayer-shares.ts` (`_eigenLayerShares`), `src/signing/rocketpool-rate.ts` (`_rocketPoolRate`)
**Excerpt (analog `src/protocols/lido.ts` lines 215-220):**
```typescript
export const _lidoProtocol = {
  encodeLidoSubmit,
  encodeRequestWithdrawals,
  encodeWstethWrap,
  encodeWstethUnwrap,
};
```

### Format-fanout-sentinel: NEVER inline addresses
**Source:** CLAUDE.md SOT rule + Phase 6 / 7 / 28 / 30 precedent
**Apply to:** Every new Phase 31 file — addresses resolve via `getEigenLayer*Address` / `getRocketPool*Address` getters; never `getAddress("0x…")` literals outside of `src/config/contracts.ts`.

### SOT cross-view byte-identity tests
**Source:** Phase 30 T-LIDO-SPENDER-DRIFT-1 (test/config-contracts.test.ts lines 571-595)
**Apply to:** Phase 31 T-EIGENLAYER-SPENDER-DRIFT-1 + T-ROCKETPOOL-SPENDER-DRIFT-1

---

## No Analog Found

**Zero files without an analog.** Phase 31 is a pure mechanical mirror of Phase 30 Lido with three deviations, all of which DO have analogs:

| Novel surface | Analog source |
|---------------|---------------|
| `LEDGER_NOTICE_*` templates (D-13) | `LEDGER_NOTICE_WETH_UNWRAP_TEMPLATE` (Phase 6 Plan 06-04) |
| `(tx.to, selector)` tuple dispatch (Pitfall 1/2) | Documented in RESEARCH § Topic 1; no prior source-file precedent. Planner extends `preview_send`/`buildXDecodedArgsBlock` dispatch with the tuple branch. |
| Curated-LST registry (D-04) | `CompoundCometBase` literal-union + `getCompoundCometAddress` (Phase 28 Plan 28-01); same shape — finite-enum input → SOT lookup |

---

## Metadata

**Analog search scope:**
- `src/protocols/` (lido.ts, weth9.ts, compound-v3.ts, aave-v3.ts, morpho-blue.ts)
- `src/chains/lido.ts`
- `src/signing/lido-rebase.ts`, `src/signing/blocks.ts` (Lido section)
- `src/security/canonical-dispatch.ts`
- `src/config/contracts.ts` (Lido SOT block + KNOWN_SPENDERS_ETHEREUM rows)
- `src/tools/prepare_lido_*.ts`, `src/tools/get_lido_positions.ts`, `src/tools/prepare_weth_unwrap.ts`
- `src/tools/register-all.ts`
- `test/signing-fingerprint.test.ts` (Fixtures V/W/X/Y), `test/config-contracts.test.ts` (T-LIDO-SPENDER-DRIFT-1)
- `test/security-canonical-dispatch.test.ts`
- `SECURITY.md` (v2.1 milestone close-out template at lines 329-378)

**Files scanned:** 18

**Pattern extraction date:** 2026-05-23
