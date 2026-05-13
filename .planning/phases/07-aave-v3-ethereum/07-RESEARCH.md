# Phase 7: Aave V3 (Ethereum) — Research

**Researched:** 2026-05-13
**Domain:** Aave V3 Pool ABI encode + UiPoolDataProviderV3 reads + health-factor math + Etherscan contract-security probe
**Confidence:** HIGH (Pool/UiPool/Oracle/IncentivesController addresses cross-verified against bgd-labs/aave-address-book + Etherscan; supply/withdraw selectors empirically computed via viem; Ledger clear-sign coverage confirmed by reading the actual ERC-7730 metadata JSON from `LedgerHQ/clear-signing-erc7730-registry`)

## Summary

Phase 7 extends the trust pipeline from ERC-20-shape calldata (Phase 6) to Aave V3 Pool interactions on Ethereum mainnet. The cryptographic-binding chain is unchanged — `payloadFingerprint` already accepts variable-length `data` (Fixtures B/D/E/F prove this across 4 shapes). New surface: (a) `src/protocols/aave-v3.ts` mirroring `src/protocols/erc20.ts`+`weth9.ts` — ABI encode for `supply`/`withdraw`, decode-fragment join into the `ERC20_COMBINED_DECODE_ABI` for preview-time arg surfacing; (b) `get_lending_positions` reader hitting `UiPoolDataProviderV3.getReservesData` + `getUserReservesData` via two `client.readContract` calls (the canonical viem pattern for struct-returning functions); (c) two new prepare tools — mechanical clones of `prepare_token_send.ts` with bounded diffs (encoder, tx.to, decimal context); (d) off-chain health-factor math, pure-bigint, shared between `get_lending_positions` and `simulate_position_change`; (e) `check_contract_security` as the first Etherscan API consumer.

**Primary recommendation:**
- Use viem's `parseAbi` for the Aave V3 Pool encode side (one-line fragment per function, same shape as `WETH9_WITHDRAW_ABI`) and a separate `parseAbi` for the UiPoolDataProviderV3 struct returns (viem resolves struct refs into named-tuple components — verified empirically). Land Fixtures G (supply) + H (withdraw) as hardcoded `0x…` literals in `test/signing-fingerprint.test.ts`; cross-link from `test/prepare-aave-supply.test.ts`, `test/prepare-aave-withdraw.test.ts`, and the new `test/aave-v3-lifecycle.integration.test.ts` persona-cycle.
- **Aave V3 Pool clear-sign is COVERED on Ledger** for both `supply` and `withdraw` — verified by reading `registry/aave/calldata-lpv3.json` in `LedgerHQ/clear-signing-erc7730-registry` (deployment list includes `chainId: 1, address: 0x87870Bca…` and `formats` covers `supply(address,uint256,address,uint16)` + `withdraw(address,uint256,address)` with intents `Supply`/`Withdraw`). **No LEDGER NOTICE block needed** — unlike WETH9.withdraw which has zero coverage and required the A2-defense block. This resolves a key assumption at planning time, not at verify-phase.
- For the approval pre-flow: do NOT chain `prepare_token_approve` inside `prepare_aave_supply`. The "one tool = one tx" pattern is project-locked. The preview-time `eth_call` simulation helper from Phase 6 DF-1 (`src/signing/simulation.ts`) auto-runs for Aave supply and will catch insufficient-allowance reverts; the tool description routes the agent to call `prepare_token_approve` first if simulation reveals an allowance shortfall.
- `simulate_position_change`: pure off-chain bigint math reading on-chain state via `UiPoolDataProviderV3.getUserReservesData`. Documented residual: index drift between read and broadcast is sub-bp over a single tx; no measurable divergence vs Aave UI in normal conditions (verify-phase task to empirically confirm).
- `check_contract_security` via Etherscan V2 unified API (`api.etherscan.io/v2/api?chainid=1&...`). Free tier: 5 req/sec, 100k req/day. Requires `ETHERSCAN_API_KEY` env. One key works across all chains (Phase 8 inherits unchanged). Lightweight `fetch`-based client mirroring `src/clients/fourbyte.ts`'s shape — no third-party SDK needed.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|--------------|----------------|-----------|
| ABI encode `supply`/`withdraw` | MCP server (`src/tools/prepare_aave_*.ts` + `src/protocols/aave-v3.ts`) | — | Server-side encoding so `payloadFingerprint` binds the exact bytes the device will see (Phase 4 / 6 invariant). |
| Decode `supply`/`withdraw` at preview time | MCP server (`src/tools/preview_send.ts` extension) | Agent (re-decode locally per PREP-05) | Server does the selector-routed decode; agent re-decodes via viem in its own runtime as defense-in-depth. The Phase 6 `ERC20_COMBINED_DECODE_ABI` widens to include the Aave V3 fragments. |
| `getReservesData` + `getUserReservesData` reads | MCP server (`src/tools/get_lending_positions.ts`) | viem `readContract` action | The UiPoolDataProviderV3 is the canonical aggregator — single contract returns the full reserve config + user position set in two calls. No multicall needed. |
| Health-factor math | MCP server (`src/signing/aave-health.ts` — NEW pure-fn module) | — | Pure bigint, deterministic; shared by `get_lending_positions` (current HF) + `simulate_position_change` (post-tx HF). Locked off `src/signing/` to keep the trust-pipeline shelf coherent. |
| Decimal-aware amount parsing | MCP server (`parseAmountStrict` from Phase 6) | — | Consumed verbatim — `prepare_aave_supply`/`withdraw` accept agent-supplied decimal strings, resolve decimals via `get_token_metadata`, parse strictly. |
| Canonical Aave V3 addresses | MCP server (`src/config/contracts.ts`) | — | Project CLAUDE.md mandates SOT. Phase 6 reserved the 12th `KnownSpender` slot for "Aave V3 Pool" — already populated at row 0 of `KNOWN_SPENDERS_ETHEREUM`. The non-spender addresses (UiPoolDataProvider, AaveOracle, IncentivesController, PoolAddressesProvider) extend `ContractsForChain`. |
| Etherscan contract-security probe | MCP server (`src/tools/check_contract_security.ts` + new `src/clients/etherscan.ts`) | Etherscan V2 unified API | Etherscan's `getsourcecode` returns the verified-source flag + ABI + proxy status in one call; `getcontractcreation` returns the creator + block + timestamp + creation tx hash. Off-the-shelf lightweight `fetch` client; no third-party SDK. |
| Ledger clear-sign of supply/withdraw | Ledger Ethereum app (ERC-7730 metadata `registry/aave/calldata-lpv3.json` — already shipped) | — | Outside vaultpilot-mcp's surface; the device clear-signs on its own. No LEDGER NOTICE block for Aave (unlike WETH9.withdraw). |

## Topics

### Topic 1: Aave V3 deployment addresses on Ethereum mainnet

**Recommendation:** Extend `ContractsForChain` in `src/config/contracts.ts` with five Aave V3 addresses. The Pool address (`0x87870Bca…`) already lives in `KNOWN_SPENDERS_ETHEREUM` at row 0 (Phase 6 Plan 06-03 seeded it as the "Aave V3 Pool" known-spender) — keep that row; the new `aavePool` typed slot in `ContractsForChain` is the canonical reader for non-spender consumers.

**Verified addresses** (cross-checked against `bgd-labs/aave-address-book/src/AaveV3Ethereum.sol` AND Etherscan):

| Constant | Address | Use Case |
|----------|---------|----------|
| `POOL` | `0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2` | `prepare_aave_supply` / `prepare_aave_withdraw` tx.to; also reused as the canonical-dispatch allowlist entry (v1.3 SEC-35 forward dep). [VERIFIED: Etherscan — "Aave: Pool V3", InitializableImmutableAdminUpgradeabilityProxy, verified source.] |
| `POOL_ADDRESSES_PROVIDER` | `0x2f39d218133AFaB8F2B819B1066c7E434Ad94E9e` | The `provider` arg to `UiPoolDataProviderV3.getReservesData(provider)` + `getUserReservesData(provider, user)`. [VERIFIED: bgd-labs/aave-address-book.] |
| `UI_POOL_DATA_PROVIDER` | `0x56b7A1012765C285afAC8b8F25C69Bf10ccfE978` | `get_lending_positions` reader target. [VERIFIED: Etherscan — "UiPoolDataProviderV3", verified source, "Exact Match", Solidity 0.8.27.] |
| `ORACLE` | `0x54586bE62E3c3580375aE3723C145253060Ca0C2` | Price oracle for USD conversion in health-factor math; technically `UiPoolDataProviderV3.getReservesData` already returns `priceInMarketReferenceCurrency` per reserve, so the oracle slot is for v1.x-future flexibility (e.g. price-impact checks). Plan 07-01 should still seed it. |
| `DEFAULT_INCENTIVES_CONTROLLER` | `0x8164Cc65827dcFe994AB23944CBC90e0aa80bFcb` | NOT consumed in Phase 7 (rewards-claim is v2.3+ scope) but seed for forward use. |
| `AAVE_PROTOCOL_DATA_PROVIDER` | `0x0a16f2FCC0D44FaE41cc54e079281D84A363bECD` | Alternative aggregator; NOT consumed in Phase 7 (UiPoolDataProviderV3 is the higher-level one we need). Optional seed for v2.3+ Compound-parity reads. |

**Sources:**
- [bgd-labs/aave-address-book — AaveV3Ethereum.sol](https://raw.githubusercontent.com/bgd-labs/aave-address-book/main/src/AaveV3Ethereum.sol) — canonical address registry maintained by BGD Labs (the team behind the Aave protocol guardian setup)
- [Etherscan: Aave V3 Pool](https://etherscan.io/address/0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2) — verified source, "Aave: Pool V3"
- [Etherscan: UiPoolDataProviderV3](https://etherscan.io/address/0x56b7A1012765C285afAC8b8F25C69Bf10ccfE978) — verified source, "UiPoolDataProviderV3"

**Pitfall:** the Pool address `0x87870Bca…` is an `InitializableImmutableAdminUpgradeabilityProxy`. The proxy itself is verified on Etherscan but the implementation is at a separate address (currently `0x8147b99D…`). The ABI we need (`supply` / `withdraw` / `getUserAccountData` / etc.) lives on the proxy's interface, so Phase 7 calls the proxy directly. `check_contract_security` for the Pool address will surface `Proxy: 1` and an `Implementation: 0x8147b99D…` field — that's a known-good state for Aave V3 and should be allow-listed in the tool's interpretation (or surfaced verbatim — the consumer agent already routes uncertain proxy states to the user).

**Verification protocol at execute-time:** plan 07-01 MUST add a `test/config-contracts.test.ts` assertion that the Aave addresses round-trip through `getAddress()` without throw (the EIP-55 corruption-on-load guard the existing entries use). Phase 6 already wraps every `KNOWN_SPENDERS_ETHEREUM` entry in `getAddress()` at the literal site — extend the same pattern.

### Topic 2: UiPoolDataProviderV3 ABI surface

**Recommendation:** Use viem's `parseAbi` with the full struct definitions inline. Empirically verified that viem resolves nested struct refs into named-tuple components — the planner can write the ABI fragments as Solidity-style strings and consume them via `client.readContract({ abi, address, functionName, args })` with full type inference.

**Empirical verification** (Bash probe via installed viem@2.48.11):

```typescript
const aaveV3UiPoolAbi = parseAbi([
  // structs first — referenced by the function returns
  "struct AggregatedReserveData { address underlyingAsset; string name; string symbol; uint256 decimals; uint256 baseLTVasCollateral; uint256 reserveLiquidationThreshold; uint256 reserveLiquidationBonus; uint256 reserveFactor; bool usageAsCollateralEnabled; bool borrowingEnabled; bool isActive; bool isFrozen; uint128 liquidityIndex; uint128 variableBorrowIndex; uint128 liquidityRate; uint128 variableBorrowRate; uint40 lastUpdateTimestamp; address aTokenAddress; address variableDebtTokenAddress; uint256 priceInMarketReferenceCurrency; }",
  "struct UserReserveData { address underlyingAsset; uint256 scaledATokenBalance; bool usageAsCollateralEnabledOnUser; uint256 scaledVariableDebt; }",
  "struct BaseCurrencyInfo { uint256 marketReferenceCurrencyUnit; int256 marketReferenceCurrencyPriceInUsd; int256 networkBaseTokenPriceInUsd; uint8 networkBaseTokenPriceDecimals; }",
  // functions
  "function getReservesData(address provider) view returns (AggregatedReserveData[], BaseCurrencyInfo)",
  "function getUserReservesData(address provider, address user) view returns (UserReserveData[], uint8 userEModeCategoryId)",
]);
// Verified: parseAbi resolves the struct refs; getUserReservesData.outputs is
// [{ type: "tuple[]", components: [...4 fields...] }, { type: "uint8", name: "userEModeCategoryId" }]
```

**Selectors** (verified via `viem.toFunctionSelector`):
- `getReservesData(address)` → `0xec489c21`
- `getUserReservesData(address,address)` → `0x51974cc0`

**Call pattern** (parallel via `Promise.all` — two RPC reads, no multicall needed since `UiPoolDataProviderV3` is the aggregator):

```typescript
// Source: src/tools/get_lending_positions.ts (Plan 07-02 — sketch)
const provider = "0x2f39d218133AFaB8F2B819B1066c7E434Ad94E9e";  // POOL_ADDRESSES_PROVIDER
const uiPool   = "0x56b7A1012765C285afAC8b8F25C69Bf10ccfE978";  // UI_POOL_DATA_PROVIDER

const [[reserves, baseCurrency], [userReserves, userEModeCategoryId]] = await Promise.all([
  client.readContract({
    address: uiPool, abi: aaveV3UiPoolAbi,
    functionName: "getReservesData", args: [provider],
  }),
  client.readContract({
    address: uiPool, abi: aaveV3UiPoolAbi,
    functionName: "getUserReservesData", args: [provider, walletAddress],
  }),
]);
```

**Pitfall:** the AggregatedReserveData struct has ~30 fields in the FULL Aave contract source (we've trimmed to the ~20 Phase 7 actually consumes — config + indices + price + token addresses). If a future planner widens the struct, viem's ABI decoder is strict: extra fields in the response that aren't in the ABI cause silent truncation rather than throw. Plan 07-02 SHOULD `it()`-test that the destructured `reserves[0].decimals` is a `bigint` and `reserves[0].usageAsCollateralEnabled` is a `boolean` at runtime, against a recorded mainnet fixture.

**Sources:**
- [viem.parseAbi docs](https://viem.sh/docs/abi/parseAbi) — official documentation for human-readable ABI fragments
- [Aave V3 IUiPoolDataProvider.sol on GitHub](https://github.com/aave/aave-v3-periphery) — the interface declarations the BGD Labs implementation matches

### Topic 3: Health-factor math (PREP-25 supporting READ-20)

**Recommendation:** Compute health factor in pure bigint, deterministic. Place in `src/signing/aave-health.ts` (NEW pure-fn module). Shared by `get_lending_positions` (current HF) + `simulate_position_change` (post-tx projected HF). DO NOT use floating point — the `> 1` vs `< 1` boundary near liquidation is a load-bearing decision; bigint with explicit scaling is the only safe shape.

**Formula** (per Aave V3 protocol docs):

```
healthFactor = (Σ_i (collateralUSD_i × liquidationThreshold_i)) / (Σ_j borrowUSD_j)

Where:
  collateralUSD_i = (userScaledATokenBalance_i × liquidityIndex_i / RAY) × priceInMarketReferenceCurrency_i / 10^decimals_i
  borrowUSD_j     = (userScaledVariableDebt_j × variableBorrowIndex_j / RAY) × priceInMarketReferenceCurrency_j / 10^decimals_j

  liquidationThreshold_i is in basis points (10000 = 100%). Stored in
  reserveConfiguration of AggregatedReserveData. Aave V3 exposes it as
  `reserveLiquidationThreshold` directly on the struct (no bit-mask
  decoding needed — the ABI already exposes the value as uint256).

  RAY = 10^27 (Aave's fixed-point scale for indices)
```

**eMode special case:** if `userEModeCategoryId !== 0`, the liquidation threshold used is the category's threshold, NOT the per-asset threshold. The UiPoolDataProviderV3 struct exposes both (the per-asset value lives on `AggregatedReserveData`; the per-category override needs a separate `getEModeCategoryData(categoryId)` read OR can be inferred from `UserReserveData`'s `userEModeCategoryId` cross-referenced against the aggregated reserves). Phase 7 v1.1 surface: surface `userEModeCategoryId` verbatim in `get_lending_positions` response; document that the HF computation uses the per-asset threshold when `userEModeCategoryId === 0` and document the eMode-category branch as a Phase 7 verify-phase resolution task (A3 — see Assumptions Log).

**Verification:** check the computed health factor against `Pool.getUserAccountData(user)` (selector `0xbf92857c`), which returns `(totalCollateralBase, totalDebtBase, availableBorrowsBase, currentLiquidationThreshold, ltv, healthFactor)` — the protocol's own canonical computation. Plan 07-02 SHOULD add a verify-phase task that compares the off-chain bigint math against `getUserAccountData(user).healthFactor` for a known mainnet borrower (the simplest cross-check; `getUserAccountData` returns `healthFactor` scaled by 1e18). Confidence-level boost: if off-chain math matches on-chain math byte-identically across 3 test borrowers, all subsequent simulation math inherits that confidence.

**Pitfall:** the `infinity` case — when total debt = 0, healthFactor is mathematically infinite. Aave's contract returns `type(uint256).max` (= MAX_UINT256). Phase 7's surfacing in `get_lending_positions` SHOULD encode this as `"∞"` or a `noDebt: true` flag rather than the literal `2^256-1` string — agents that pattern-match on numeric thresholds (`hf < 1.5`) would mis-route on a numerically-huge HF. **Reasonable-call lock:** surface `healthFactor: null` + `noDebt: true` for the no-debt case. Agents read `noDebt` as a first check, `healthFactor` second.

**Code sketch:**

```typescript
// Source: src/signing/aave-health.ts (Plan 07-02 — sketch)
const RAY = 10n ** 27n;
const BPS_SCALE = 10000n;
const HF_SCALE = 10n ** 18n;  // Aave returns HF scaled by 1e18

export function computeHealthFactor(input: {
  collateralPositions: Array<{ scaledBalance: bigint; index: bigint; price: bigint; decimals: number; liquidationThresholdBps: bigint }>;
  debtPositions: Array<{ scaledDebt: bigint; index: bigint; price: bigint; decimals: number }>;
}): { healthFactorScaled: bigint | null; noDebt: boolean } {
  let collateralWeighted = 0n;
  for (const c of input.collateralPositions) {
    const balanceWei = (c.scaledBalance * c.index) / RAY;
    const valueScaled = (balanceWei * c.price) / (10n ** BigInt(c.decimals));
    collateralWeighted += (valueScaled * c.liquidationThresholdBps) / BPS_SCALE;
  }
  let totalDebt = 0n;
  for (const d of input.debtPositions) {
    const debtWei = (d.scaledDebt * d.index) / RAY;
    totalDebt += (debtWei * d.price) / (10n ** BigInt(d.decimals));
  }
  if (totalDebt === 0n) return { healthFactorScaled: null, noDebt: true };
  return { healthFactorScaled: (collateralWeighted * HF_SCALE) / totalDebt, noDebt: false };
}
```

### Topic 4: `simulate_position_change` design (PREP-25)

**Recommendation:** Option A — pure off-chain bigint math. Read current state via `getUserReservesData`, apply the proposed delta to the local position vector, re-run `computeHealthFactor`. Cheap, deterministic, no eth_call cost.

**Rejected: Option B** (eth_call simulation against the Pool with state_overrides). The accuracy gain is sub-bp for a single tx — liquidity-index drift in the window between simulation and broadcast is ~10^-9 of the index value, well below the precision the agent needs. The cost is doubling the RPC cost AND requiring the underlying RPC to support `eth_call` with `state_overrides` (PublicNode does; not all do).

**Mechanics:**

```typescript
// Source: src/tools/simulate_position_change.ts (Plan 07-03 — sketch)
// Read current state
const userReserves = await client.readContract({ ...getUserReservesData });
const reserves = await client.readContract({ ...getReservesData });

// Apply proposed delta to local position vector
const updated = applyDelta(userReserves, reserves, { asset, deltaAmount });

// Re-run off-chain math
const before = computeHealthFactor(buildInput(userReserves, reserves));
const after  = computeHealthFactor(buildInput(updated, reserves));

return { before, after, delta: { hf: after - before, ... } };
```

**Assumption A2** (see Assumptions Log): off-chain math matches Aave UI's health-factor preview within 1 bps. Empirical confirmation is a Phase 7 verify-phase task: pick a known mainnet borrower, fetch `getUserAccountData(borrower).healthFactor`, compare against `computeHealthFactor` output, assert delta ≤ 1 bps.

**Trust-boundary note:** `simulate_position_change` is INFORMATIONAL — like the SIMULATION block in `preview_send`, it's a usability signal. The trust anchor remains the device hash match. A user can choose to supply tokens into a position with a marginal HF; the tool surfaces the projected HF as a "you'll be at HF=1.05 after this — close to liquidation" warning but doesn't refuse.

### Topic 5: Aave V3 Pool ABI for supply/withdraw

**Recommendation:** One-line `parseAbi` per function; co-locate in `src/protocols/aave-v3.ts`. Same shape as `WETH9_WITHDRAW_ABI` in `src/protocols/weth9.ts`. The decode-side fragments join `ERC20_COMBINED_DECODE_ABI` so `preview_send`'s single selector-routed `decodeFunctionData` call covers all phases (Phase 4 native + Phase 6 ERC-20 + Phase 7 Aave).

**Function signatures + selectors** (empirically verified via `viem.toFunctionSelector`):

- `supply(address asset, uint256 amount, address onBehalfOf, uint16 referralCode)` → `0x617ba037`
- `withdraw(address asset, uint256 amount, address to)` → `0x69328dec`
- `borrow(address asset, uint256 amount, uint256 interestRateMode, uint16 referralCode, address onBehalfOf)` → `0xa415bcad` (NOT consumed in Phase 7; v2.3+)
- `repay(address asset, uint256 amount, uint256 interestRateMode, address onBehalfOf)` → `0x573ade81` (NOT consumed in Phase 7; v2.3+)
- `getUserAccountData(address user)` → `0xbf92857c` (cross-check oracle for `simulate_position_change` verify-phase)

**Calldata sizes** (empirically verified):
- supply: 4-byte selector + 4 × 32-byte args = **132 bytes** (264 hex chars + `0x` prefix = 266 chars)
- withdraw: 4-byte selector + 3 × 32-byte args = **100 bytes** (200 hex chars + `0x` prefix = 202 chars)

**Code sketch:**

```typescript
// Source: src/protocols/aave-v3.ts (Plan 07-03 — sketch)
import { parseAbi, encodeFunctionData, type Address, type Hex } from "viem";

export const AAVE_V3_POOL_ABI = parseAbi([
  "function supply(address asset, uint256 amount, address onBehalfOf, uint16 referralCode)",
  "function withdraw(address asset, uint256 amount, address to) returns (uint256)",
]);

export const AAVE_V3_SELECTORS = {
  supply:   "0x617ba037" as Hex,
  withdraw: "0x69328dec" as Hex,
} as const;

export function encodeAaveSupply(
  asset: Address, amount: bigint, onBehalfOf: Address,
): Hex {
  return encodeFunctionData({
    abi: AAVE_V3_POOL_ABI, functionName: "supply",
    args: [asset, amount, onBehalfOf, 0],  // referralCode = 0 (Aave V3 deprecates referrals)
  });
}

export function encodeAaveWithdraw(
  asset: Address, amount: bigint, to: Address,
): Hex {
  return encodeFunctionData({
    abi: AAVE_V3_POOL_ABI, functionName: "withdraw",
    args: [asset, amount, to],
  });
}
```

**On the `onBehalfOf` parameter for supply:** the Aave Pool allows supplying on behalf of a different account (e.g., a relayer/operator pattern). Phase 7's `prepare_aave_supply` ALWAYS passes `onBehalfOf = user's own address` (sender) — there is no relayer use case in v1.x. The tool input does NOT expose an `onBehalfOf` arg. **Reasonable-call lock:** hardcoded to `from`. Future scope (Phase 9 SEC-35) may add `prepare_aave_supply_onBehalfOf` as a dedicated tool with explicit user acknowledgment; v1.1 surface keeps it simple.

**On the `to` parameter for withdraw:** Aave allows withdrawing to a different address. Same reasoning — Phase 7's `prepare_aave_withdraw` ALWAYS passes `to = user's own address`. Tool input does NOT expose a `to` arg.

**On `referralCode = 0`:** Aave V3 deprecated referrals (the original v2 referral system distributed protocol revenue; v3 removed the feature but kept the param for ABI compatibility). `0` is the documented value. [CITED: Aave V3 docs.]

**On the `withdraw` return value (uint256):** the Aave Pool returns the actual amount withdrawn. Useful for `amount = MAX_UINT256` (withdraw-all sentinel) — but Phase 7's input is a strict decimal string, not a sentinel. Phase 7 does NOT consume `MAX_UINT256` for withdraw. **Reasonable-call lock:** no "max" sentinel for withdraw in v1.1; user supplies a concrete decimal amount. Future scope may add a `withdrawAll: true` boolean alongside `amount`.

### Topic 6: Ledger CAL clear-sign coverage for Aave V3 Pool

**Recommendation:** No LEDGER NOTICE block needed. **Aave V3 Pool clear-sign IS COVERED for both `supply` and `withdraw`** on Ethereum mainnet — verified by reading the actual ERC-7730 metadata JSON in the canonical registry.

**Evidence** (verified via GitHub API against `LedgerHQ/clear-signing-erc7730-registry` on 2026-05-13):

```
registry/aave/calldata-lpv3.json
  context.contract.deployments:
    chainId=1, address=0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2  ← matches Phase 7's Pool
  display.formats covers (relevant subset):
    supply(address,uint256,address,uint16)       → intent: "Supply"
    withdraw(address,uint256,address)            → intent: "Withdraw"
    borrow(address,uint256,uint256,uint16,address) → intent: "Borrow"
    repay(...)                                   → intent: "Repay loan"
    deposit(...)                                 → intent: "Supply"   (V3 deprecates `deposit`; alias kept)
    setUserUseReserveAsCollateral(...)           → intent: "Manage collateral"
```

[VERIFIED: `curl -sL https://api.github.com/repos/LedgerHQ/clear-signing-erc7730-registry/contents/registry/aave/calldata-lpv3.json` 2026-05-13]

**What the user sees on-device** (per Ledger Earn docs + the ERC-7730 intent field):

- `prepare_aave_supply` → device shows: `Intent: Supply`, `Asset: <token symbol from CAL>`, `Amount: <decoded human-readable>`, `On Behalf Of: <decoded address>`, `Network: Ethereum`, fees.
- `prepare_aave_withdraw` → device shows: `Intent: Withdraw`, `Asset: <token symbol>`, `Amount: <human-readable>`, `To: <decoded address>`, `Network: Ethereum`, fees.

**Cross-cutting implication:** the `LEDGER NOTICE` block that Plan 06-04 added for WETH9.withdraw (because that selector has zero plugin/ERC-7730 coverage) is NOT replicated for Aave. The Phase 6 conditional emission in `preview_send` reads `selector === WETH9_SELECTORS.withdraw && record.tx.to === getWethAddress(1)`; Phase 7 does NOT extend that condition.

**Pitfall:** the device's actual display depends on:
- Firmware version (must be recent enough to support ERC-7730 — released throughout 2025 Q3/Q4).
- Ethereum app version (CAL + ERC-7730 metadata installed via Ledger Live).
- Whether the user has Ledger Live's "Auto-update CAL" enabled.

A user on a stale device may see a fallback raw-hash display even though the registry covers Aave. **Defensive emission rule preserved:** `LEDGER BLIND-SIGN HASH` block stays emitted unconditionally (Phase 4 precedent). Aave supply/withdraw shows BOTH the clear-sign UI on a fresh device AND the agent-side hash block — the user can fall back to the hash match if the clear-sign UI doesn't render.

**Sources:**
- [LedgerHQ/clear-signing-erc7730-registry/registry/aave/calldata-lpv3.json](https://github.com/LedgerHQ/clear-signing-erc7730-registry/tree/main/registry/aave) — canonical ERC-7730 metadata for the Aave V3 LP V3 Pool, ships with Ledger Live's CAL bundle
- [Ledger Developer Portal — Clear-signing overview](https://developers.ledger.com/docs/clear-signing/overview) — ERC-7730 architecture

### Topic 7: `check_contract_security` design (READ-21)

**Recommendation:** Lightweight `fetch`-based client in `src/clients/etherscan.ts` mirroring `src/clients/fourbyte.ts`'s discriminated-union result shape. Single tool: `check_contract_security({ address })`. Two parallel Etherscan API calls:

1. `getsourcecode` — returns verification status + ABI + proxy info + compiler version
2. `getcontractcreation` — returns creator address + creation block + timestamp + creation tx hash

**Etherscan V2 unified API:**
- Base URL: `https://api.etherscan.io/v2/api`
- Required params: `apikey`, `chainid`, `module`, `action`
- Free tier: **5 calls/sec, 100k calls/day** (limit shared across ALL chains when using one API key)
- One API key works across every supported Etherscan chain. Phase 8 (multi-EVM) inherits this client unchanged — just changes `chainid` per request.

**`getsourcecode` response fields** (per Etherscan API reference):
- `SourceCode` — Solidity source code (empty string OR `"Contract source code not verified"` if unverified)
- `ABI` — JSON-encoded ABI array (or `"Contract source code not verified"` literal)
- `ContractName` — e.g. `"Pool"`, `"InitializableImmutableAdminUpgradeabilityProxy"`
- `CompilerVersion` — e.g. `"v0.8.27+commit.1234abcd"`
- `CompilerType` — `"Solidity (Single file)"` / `"Solidity (Standard-Json-Input)"` / `"Vyper"`
- `OptimizationUsed` — `"0"` / `"1"`
- `Runs` — optimizer runs
- `ConstructorArguments` — hex constructor args
- `EVMVersion` — e.g. `"shanghai"`, `"london"`
- `Library` — linked libraries
- `ContractFileName` — main contract filename
- `LicenseType` — e.g. `"MIT"`, `"BUSL-1.1"`
- `Proxy` — `"0"` / `"1"` flag
- `Implementation` — implementation address if proxy
- `SwarmSource` — Swarm hash of source
- `SimilarMatch` — "Exact Match" / "Similar Match"

[CITED: docs.etherscan.io/api-reference/endpoint/getsourcecode.md]

**`getcontractcreation` response fields:**
- `contractAddress`
- `contractCreator`
- `txHash`
- `blockNumber`
- `timestamp` (Unix)
- `contractFactory` (factory contract if deployed via factory)
- `creationBytecode` (init bytecode)

Supports up to 5 addresses per call via `contractaddresses` (comma-separated).

[CITED: docs.etherscan.io/api-reference/endpoint/getcontractcreation.md]

**Verified-source check:** `SourceCode !== "" && SourceCode !== "Contract source code not verified"`. Both states surface explicitly in the tool response — never silently mask "unverified" as "couldn't fetch."

**Privileged-role enumeration:** parse the JSON ABI (returned as `ABI` field) and scan for functions with role-gated modifiers. There's no direct ABI-level "this function is `onlyOwner`" signal — that's a Solidity modifier, not part of the ABI. **Heuristic:** look for functions with naming patterns suggesting privilege (`upgradeTo`, `setAdmin`, `transferOwnership`, `grantRole`, `revokeRole`, `setImplementation`, `pause`, `unpause`, etc.) AND inspect for AccessControl interface markers (`hasRole`, `getRoleAdmin`, `DEFAULT_ADMIN_ROLE`). Surface as a list, not a single boolean. The tool's response includes:
```
{
  verified: boolean,
  proxy: boolean,
  implementation?: Address,
  contractName: string,
  compilerVersion: string,
  ageDays: number,                    // (now - creationTimestamp) / 86400
  creatorAddress: Address,
  creationTxHash: Hex,
  privilegedFunctions: string[],      // e.g. ["upgradeTo(address)", "transferOwnership(address)", "pause()"]
  accessControlMarkers: string[],     // e.g. ["hasRole(bytes32,address)", "DEFAULT_ADMIN_ROLE()"]
}
```

**Age computation:** `(Date.now() / 1000 - creationTimestamp) / 86400` (days, integer). No separate RPC call needed — the creation timestamp is already in `getcontractcreation`'s response. **Note:** a known-issue with very-old contracts (pre-2020): `getcontractcreation` may return `timestamp: 0` for contracts before Etherscan's indexer fully covered. Defensive surfacing: render `ageDays: "unknown"` rather than a nonsensical 1970-epoch value.

**Rate-limit guard:** at the tool boundary, limit to **5 calls per agent session** to stay well under Etherscan's 100k/day quota (an aggressive agent could otherwise burn the quota). Implementation: in-memory call counter in `src/clients/etherscan.ts`. Soft refusal with `RATE_LIMITED` structured error if exceeded, naming the limit + the path to lift it (e.g. "raise your Etherscan plan").

**ETHERSCAN_API_KEY env:** required. Missing → structured `MISSING_CONFIG` refusal naming the env var + a link to https://etherscan.io/apis. Pattern matches Phase 3's `WALLETCONNECT_PROJECT_ID` handling.

**Multi-chain note (Phase 8 forward dep):** Etherscan V2's single endpoint (`api.etherscan.io/v2/api?chainid=N`) means one API key works for ETH/Polygon/Arbitrum/Base/Optimism/etc. Phase 8 just threads `chainid` through. The free-tier 5/sec limit is GLOBAL across all chains when using one key — that's a Phase 8 concern, not Phase 7.

**Sources:**
- [Etherscan V2 API docs — getsourcecode](https://docs.etherscan.io/api-reference/endpoint/getsourcecode.md)
- [Etherscan V2 API docs — getcontractcreation](https://docs.etherscan.io/api-reference/endpoint/getcontractcreation.md)
- [Etherscan API rate limits](https://docs.etherscan.io/resources/rate-limits) — 5 calls/sec free tier confirmed

### Topic 8: Aave V3 specific risks

Surface for the threat-register block in each plan:

**Reserve frozen / paused state.** `AggregatedReserveData.isFrozen` / `isActive` flags. A `supply` call against a frozen reserve reverts on-chain. The preview-time `eth_call` simulation helper (Phase 6 DF-1) catches this BEFORE the user is asked to sign. Plan 07-02 SHOULD surface `frozen: true` / `inactive: true` flags on the per-position rows of `get_lending_positions`, so an agent reading the position view knows the asset is in a non-actionable state before suggesting supply/withdraw.

**Isolation mode (uint with debt caps).** Some Aave V3 reserves run in isolation mode — a supply succeeds but the user can't borrow against it alongside other collateral. Surface but don't block at supply time; the protocol enforces the constraint at borrow time. Phase 7 doesn't ship a `prepare_aave_borrow` (that's v2.3); isolation mode is informational only.

**eMode category.** When `userEModeCategoryId !== 0`, the liquidation threshold used in health-factor math is the category's threshold (typically much higher, e.g. 9300 bps = 93% LT for the ETH-correlated category) rather than the per-asset threshold. Phase 7 surface: include `userEModeCategoryId` in the response verbatim. The HF computation uses per-asset thresholds in v1.1 (documented assumption A3); v2.3 phase widens to per-category lookup via `getEModeCategoryData`.

**Liquidation imminent (HF < 1.05).** Phase 7's `get_lending_positions` SHOULD include a `liquidationRisk` flag — `"high" | "medium" | "none"` based on configurable thresholds (e.g. `< 1.10` = high). Surfaces clearly to the agent without forcing it to do floating-point comparison. Trust-boundary preserved: agent decides what to do with the flag.

### Topic 9: Approval pre-flow design

**Recommendation:** Do NOT chain `prepare_token_approve` inside `prepare_aave_supply`. The "one tool = one tx" pattern is project-locked. Instead:

1. **`prepare_aave_supply` does NOT inspect allowance.** The tool just authors the supply tx.
2. **Preview-time `eth_call` simulation will catch insufficient-allowance reverts.** The Phase 6 DF-1 helper auto-applies — the `runPreviewSimulation` call in `preview_send` runs the supply against current on-chain state; if allowance is insufficient, the Aave Pool reverts with a recognizable error (`ERC20: transfer amount exceeds allowance` or similar). The SIMULATION block surfaces the revert reason.
3. **Tool description routes the agent.** `prepare_aave_supply`'s description includes: *"If simulation reveals an allowance shortfall, call `prepare_token_approve({ tokenAddress, spender: <aave pool address>, amount: 'max' })` first, then retry this prepare."* Direct routing via the description; no chaining magic. The agent sees the SIMULATION revert, reads the tool description, calls approve, signs the approve on device, then retries the supply.

**Alternatives considered + rejected:**

- **Option B: chain approve inside supply.** Violates "one tool = one tx." Hides a signature surface from the user (they'd have to sign approve THEN supply with no explicit second-tool intermediate); the agent description + on-device confirmation flow loses clarity.
- **Option C: refuse `prepare_aave_supply` if allowance is insufficient.** Forces an `eth_call` to `allowance(user, pool)` at prepare time (an extra RPC). Net cost ~same as preview-time simulation; loses the unified-treatment of all revert-class failures (insufficient balance + frozen reserve + paused + etc. all surface through the same SIMULATION block). Worse: refusing at PREPARE time would block prepare even on demo-mode personas with insufficient real-allowance — but demo simulation is a separate concern (Plan 05-02). Net: more code, more edge cases, no real safety benefit.

**Recommendation locked: Option A (preview-time simulation + agent routing via tool description).** Matches the trust pipeline's "agent proposes, user inspects" shape.

### Topic 10: Cryptographic-binding chain for Aave shapes

**Recommendation:** Add two new fixtures — **Fixture G (Aave V3 supply)** and **Fixture H (Aave V3 withdraw)** — to `test/signing-fingerprint.test.ts`, both as hardcoded `0x…` literals computed at execute time against the in-tree `computePayloadFingerprint`. Cross-link from `test/prepare-aave-supply.test.ts`, `test/prepare-aave-withdraw.test.ts`, and the new `test/aave-v3-lifecycle.integration.test.ts` persona-cycle test.

**Fixture G — Aave V3 supply (USDC into Pool).** Test vector:

```typescript
// 132-byte supply(USDC, 100e6, sender, 0) calldata
// 4-byte selector (0x617ba037) + 32-byte asset + 32-byte amount + 32-byte onBehalfOf + 32-byte referralCode
const aavePool = "0x87870bca3f3fd6335c3f4ce8392d69350b4fa4e2" as Address;
const usdcAddress = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48" as Address;
const onBehalfOf = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" as Address;

const supplyData =
  "0x617ba037" +
  "000000000000000000000000a0b86991c6218b36c1d19d4a2e9eb0ce3606eb48" + // asset
  "0000000000000000000000000000000000000000000000000000000005f5e100" + // amount = 100e6 (100 USDC)
  "00000000000000000000000070997970c51812dc3a010c7d01b50e0d17dc79c8" + // onBehalfOf
  "0000000000000000000000000000000000000000000000000000000000000000";   // referralCode = 0
// Length: 0x + 264 hex = 266 chars; 132 bytes payload

const fp = computePayloadFingerprint({
  chainId: 1, to: aavePool, valueWei: 0n, data: supplyData,
});
// → Compute once at execute-time, pin as hardcoded literal.
```

**Fixture H — Aave V3 withdraw (100 USDC out of Pool).** Test vector:

```typescript
// 100-byte withdraw(USDC, 100e6, to) calldata
// 4-byte selector (0x69328dec) + 32-byte asset + 32-byte amount + 32-byte to
const aavePool = "0x87870bca3f3fd6335c3f4ce8392d69350b4fa4e2" as Address;
const usdcAddress = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48" as Address;
const to = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" as Address;

const withdrawData =
  "0x69328dec" +
  "000000000000000000000000a0b86991c6218b36c1d19d4a2e9eb0ce3606eb48" + // asset
  "0000000000000000000000000000000000000000000000000000000005f5e100" + // amount = 100e6
  "00000000000000000000000070997970c51812dc3a010c7d01b50e0d17dc79c8";   // to
// Length: 0x + 200 hex = 202 chars; 100 bytes payload

const fp = computePayloadFingerprint({
  chainId: 1, to: aavePool, valueWei: 0n, data: withdrawData,
});
// → Compute once at execute-time, pin as hardcoded literal.
```

**Naming verification with the pattern-mapper:** the existing fixtures use single-letter labels A (native), B (ERC-20-shape baseline), C (presign hash), D (USDC transfer), E (approve(MAX)), F (WETH9.withdraw). G and H are the next two letters; planner should confirm with pattern-mapper that this naming holds OR adopt whatever the pattern-mapper recommends (e.g. an Aave-specific prefix). The fingerprint COMPUTATION + the hardcoded-literal discipline are the load-bearing parts; the label is cosmetic.

**Persona-cycle integration test** (`test/aave-v3-lifecycle.integration.test.ts`):
- Mirrors `test/erc20-lifecycle.integration.test.ts` shape.
- Asserts Fixtures G + H byte-identical across whale ↔ stable-saver ↔ defi-degen persona swaps (`from`-independence).
- STOP-THE-LINE: any fingerprint mismatch across personas means the cryptographic-binding chain became `from`-dependent. Release blocker (T-INTEGRATION-FROM-DRIFT-2).

**Compatibility with `ERC20_COMBINED_DECODE_ABI`:** `preview_send`'s selector-routed decode currently dispatches on transfer/approve/withdraw. Plan 07-03 extends the combined ABI by including the Aave V3 supply + withdraw fragments. The decode dispatch in `src/protocols/erc20.ts` `decodeErc20Call` returns a new `kind: "aave-supply"` / `kind: "aave-withdraw"` discriminant — OR Plan 07-03 introduces a parallel `decodeAaveCall` in `src/protocols/aave-v3.ts` and `preview_send` routes by selector prefix. **Reasonable-call lock:** keep `decodeErc20Call` ERC-20-only and add `decodeAaveCall` separately; `preview_send` does a two-step dispatch (try ERC-20 decoder first, fall through to Aave). Cleaner separation; the protocol modules stay single-purpose. Pattern-mapper may suggest an alternative — defer the final shape to that step.

**`buildDecodedArgsBlock`** in `src/signing/blocks.ts` widens with two new branches (`"aave-supply"` and `"aave-withdraw"`) — same shape as the existing transfer/approve/withdraw branches. Asset symbol resolution via the existing top-50 token registry + live RPC fallback; the `amount` field formatted via `formatUnits(amount, decimals)` where decimals comes from the registry / `get_token_metadata`.

## SDK Probe Verdicts

| Package | Installed Version | Call Surface Used | Verdict |
|---------|-------------------|-------------------|---------|
| `viem` | 2.48.11 (empirically verified in repo) | `parseAbi` (struct support + function fragments), `encodeFunctionData`, `decodeFunctionData`, `toFunctionSelector`, `client.readContract` (single-call for `getReservesData` / `getUserReservesData`), `client.call` (preview simulation), `formatUnits`, `getAddress` | **Adopt** — all required surface present; struct-ABI support empirically verified for the UiPoolDataProviderV3 nested-tuple returns; the existing project-wide `parseAbi`-fragment pattern (WETH9 in Phase 6) extends transparently to Aave V3 |
| `viem.multicall` | N/A | NOT USED | **Skip** — UiPoolDataProviderV3 is the aggregator; two `readContract` calls in parallel via `Promise.all` cover the entire read surface. No need for Multicall3 routing. (If Phase 8 multi-chain reveals a need, revisit.) |
| `@aave/contract-helpers` (third-party SDK) | N/A | NOT INSTALLED | **Skip** — heavy SDK (carries ethers v5 + RxJS dep tree per the upstream package); we need 2 functions worth of surface (encode supply/withdraw + decode the UiPool reads). `parseAbi` covers both with zero added dependencies. Confirmed in the upstream vaultpilot-mcp pattern: it uses raw viem against the Pool address rather than the SDK. |
| `@aave/math-utils` (third-party) | N/A | NOT INSTALLED | **Skip** — provides JavaScript health-factor + APY math, but it pulls in ethers v5 + bn.js. We have ~30 LOC of pure bigint math (Topic 3 sketch) that does the same thing with the precision we need. Re-running the on-chain `getUserAccountData` for a cross-check at verify-phase confirms correctness without an SDK dep. |
| `viem`'s built-in Aave ABI | N/A | NOT EXPORTED | **Confirmed not present** — `grep -rE "aaveAbi|aaveV3|AaveV3" node_modules/viem/_types/` returns zero hits, mirroring the WETH9-not-shipped finding from Phase 6 Topic 2. `parseAbi` fragment is the canonical pattern. |
| Etherscan API client (third-party) | N/A | NOT INSTALLED | **Skip** — lightweight `fetch`-based client mirroring `src/clients/fourbyte.ts` is < 100 LOC. Third-party packages like `etherscan-api` carry old `request` library deps and don't support the V2 unified API yet (verified — the npm package's last update is 2023, V2 launched 2024). Custom client is the right call. |
| `@noble/hashes` for keccak | Already used via viem re-exports | NOT DIRECTLY IMPORTED | **Skip** — viem re-exports the right functions; we never call `@noble/hashes` directly (Phase 4 set this pattern in `payload-fingerprint.ts`). |
| `node:fetch` (native) | Node ≥ 18.17 (project engines requirement) | `fetch` for Etherscan client | **Adopt** — same path Phase 4's `src/clients/fourbyte.ts` uses; no new dep. |

## Assumptions Log

| ID | Claim | Section | Risk if Wrong |
|----|-------|---------|---------------|
| **A1** | The Aave V3 Pool clear-sign coverage in `LedgerHQ/clear-signing-erc7730-registry/registry/aave/calldata-lpv3.json` (verified on 2026-05-13) ships in current Ledger Live CAL bundles AND covers `supply` + `withdraw` per the JSON. | Topic 6 | Wrong → user sees raw-hash blind-sign instead of decoded args, similar to WETH9.withdraw. Recovery: add a Phase 7 LEDGER NOTICE block (same shape as Plan 06-04's WETH NOTICE). Real-Ledger verify-phase task: small mainnet `prepare_aave_supply` of $1 of USDC against the Pool, confirm device displays `Intent: Supply` / `Asset: USDC` / `Amount: 1.0`. [VERIFIED to the registry; ASSUMED to the device firmware ship state in 2026-05.] |
| **A2** | Off-chain bigint health-factor math (`computeHealthFactor` per Topic 3 formula) matches `Pool.getUserAccountData(user).healthFactor` byte-identically (or within < 1 bps for very-recent index reads). | Topic 3, 4 | Wrong → `simulate_position_change` mispredicts post-tx HF, agent suggests dangerous positions. Recovery: switch to Option B (eth_call simulation against the Pool with state_overrides) OR call `getUserAccountData(user)` directly and accept the second RPC cost. Verify-phase task: cross-check against 3 mainnet borrowers at varying HF levels. [ASSUMED.] |
| **A3** | Per-asset liquidation thresholds (from `AggregatedReserveData.reserveLiquidationThreshold`) are correct for users with `userEModeCategoryId === 0` AND the eMode case is handled by surfacing the category ID verbatim without applying its per-category LT to the HF computation in v1.1. | Topic 3, 8 | Wrong → users in eMode see a SMALLER projected HF than the protocol actually applies (we'd under-estimate their collateral capacity). Real consequence: agent over-warns about liquidation risk for eMode users. Recovery: in v2.3 (when Aave borrow/repay land), add `getEModeCategoryData` reader + per-category LT override. v1.1 surface ships with documented caveat. [ASSUMED for v1.1 simplification.] |
| **A4** | Aave V3 Pool's calldata for `supply` + `withdraw` does NOT exceed 132 bytes / 100 bytes respectively (empirically verified above) AND no Aave V3 Pool function call uses dynamic-length arrays in arg positions that would change calldata size at runtime. | Topic 5, 10 | Wrong → Fixture G/H byte-length assertions break. Recovery: relax byte-length assertion to selector + arg-count check. [VERIFIED empirically; ASSUMED stable across Pool implementation upgrades. The Pool is an immutable-admin upgradeable proxy — function signatures stable across implementation upgrades by Aave convention.] |
| **A5** | Etherscan V2 free tier remains at 5 calls/sec, 100k calls/day as of 2026-05; the API key works across all supported chains. | Topic 7 | Wrong → either we hit rate limits faster than expected (degrade-with-`RATE_LIMITED` envelope already handles this) or we need to upgrade to a paid plan for Phase 8 multi-chain fan-out. Recovery: trivial — increase the per-session call counter ceiling or switch to a different verifier (Sourcify, blockscout). [VERIFIED via web search 2026-05-13.] |
| **A6** | The Aave V3 Pool's "Aave: Pool V3" identity at `0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2` is stable across protocol governance actions over the Phase 7 timeline (the proxy address is intentionally immutable; only the implementation upgrades). | Topic 1 | Negligible — the Pool proxy address is by design fixed. The risk window is a governance-coordinated address swap, which has never happened in Aave's history. [VERIFIED via Etherscan + bgd-labs/aave-address-book.] |
| **A7** | The persona registry (Phase 5) currently has `defi-degen` mapped to a Binance hot wallet which has minimal Aave V3 positions. The `whale` persona (vitalik.eth) and `staking-maxi` likely have richer Aave V3 positions for integration-test fixture quality. Plan 07-02's integration test SHOULD select the persona with the richest Aave V3 footprint. | Topic 10 | Wrong → integration test fixtures are thin / boring; doesn't exercise the multi-position aggregation code path. Recovery: extend persona registry with an Aave-active address (the Phase 5 retro's "persona archetype mismatch" deferred item finally lands here). [ASSUMED — will surface at execute-time when the test author picks a fixture wallet.] |

## Design Forks Needing User Input

**None.** Applying the Phase 5/6 pattern: surface to user ONLY genuine contradiction-of-prior-design forks. All Phase 7 placement choices have defensible defaults and lock as reasonable-call:

- **Off-chain vs eth_call health-factor sim (Topic 4)** → Option A locked. Sub-bp drift; rejecting Option B costs nothing the user values.
- **Approval pre-flow (Topic 9)** → Option A locked (preview-time simulation + tool-description routing). Matches "one tool = one tx" project lock + the trust-pipeline shape.
- **`onBehalfOf` + `to` parameters** → hardcoded to `from` (sender). No relayer use case in v1.x; future expansion is a dedicated tool with explicit ack.
- **Combined-ABI decode placement (Topic 10)** → separate `decodeAaveCall` in `src/protocols/aave-v3.ts`, two-step dispatch in `preview_send`. Cleaner protocol separation; defer to pattern-mapper for final form.
- **No-debt health-factor surface (Topic 3)** → `healthFactor: null` + `noDebt: true` flag. Agent-friendly; avoids agents pattern-matching numeric-huge values as "near max" instead of "infinite."
- **`amount: "max"` for withdraw (Topic 5)** → NOT accepted in v1.1. User supplies concrete decimal amount. Future scope adds `withdrawAll: true` boolean if demand surfaces.
- **eMode handling (Topic 3, 8)** → surface `userEModeCategoryId` verbatim; use per-asset LT in v1.1 HF math; document the caveat (A3); widen in v2.3.
- **Privileged-function enumeration heuristic (Topic 7)** → name-pattern + AccessControl-marker scan; surface as a LIST not a boolean.
- **Per-session rate limit on `check_contract_security` (Topic 7)** → 5 calls per agent session ceiling; refuses with `RATE_LIMITED` envelope.

If the pattern-mapper or planner identifies a genuine fork during their pass (especially around `decodeAaveCall` placement or how the agent routes the approve→supply two-step), surface via AskUserQuestion at the planning gate. None visible from the research pass.

## Project Constraints (from CLAUDE.md)

These directives carry through to every Phase 7 plan:

- **`src/config/contracts.ts`** is the SOT for canonical addresses — extend `ContractsForChain` interface; never inline Aave V3 addresses in tool implementations.
- **Tool descriptions are agent routing prompts** — be precise about when to use vs not. The approve→supply two-step routing surfaces here (Topic 9).
- **`prepare_*` always returns a handle**; `PREPARE RECEIPT` carries verbatim args.
- **`payloadFingerprint`** computed at prepare time, re-checked at send time. Fixtures G/H pin the new shapes.
- **`previewToken` + `userDecision: "send"`** required on every `send_transaction` — Phase 4 trust pipeline carries through unchanged.
- **No private key material crosses any boundary** — Aave supply/withdraw is unsigned-tx authoring + WC relay only.
- **Decimal-aware arithmetic** — `parseAmountStrict` from Phase 6 consumes verbatim; off-by-decimal guard already lives in `src/signing/amount.ts`.
- **Stderr for diagnostics, stdout for MCP protocol** — Etherscan client diagnostic logs go through `src/diagnostics/logger.ts`.
- **ESM spy-affordance indirection** — `src/clients/etherscan.ts` should export an `_etherscan` indirection if any other module calls it internally (mirrors `_simulation` / `_contracts` / `_protocols` patterns).
- **Cryptographic-binding fixtures pinned as hardcoded literals** — Fixtures G + H in `test/signing-fingerprint.test.ts`; persona-cycle integration test re-anchors byte-identity across persona swaps. NO `beforeAll`-snapshot; pin once at execute-time, drift breaks at a specific line.

## Files Phase 7 Will Touch (preliminary scope inventory)

For the planner's mental model — confirm with pattern-mapper.

**New files:**
- `src/protocols/aave-v3.ts` — ABI + encoders + decoders + selectors (mirror of `src/protocols/erc20.ts` + `weth9.ts`)
- `src/signing/aave-health.ts` — pure-bigint health-factor math (NEW pure-fn module on the signing shelf)
- `src/clients/etherscan.ts` — fetch-based Etherscan V2 API client (mirror of `src/clients/fourbyte.ts`)
- `src/tools/get_lending_positions.ts` — UiPoolDataProviderV3 reader + per-position HF math
- `src/tools/prepare_aave_supply.ts` — mechanical clone of `prepare_token_send.ts`
- `src/tools/prepare_aave_withdraw.ts` — mechanical clone of `prepare_token_send.ts`
- `src/tools/simulate_position_change.ts` — pure off-chain delta-projection
- `src/tools/check_contract_security.ts` — Etherscan-backed security probe
- `test/protocols-aave-v3.test.ts` — selector + encoder unit tests
- `test/signing-aave-health.test.ts` — pure-fn unit tests + on-chain cross-check (verify-phase resolves)
- `test/get-lending-positions.test.ts` — reader unit tests with mocked struct returns
- `test/prepare-aave-supply.test.ts` — Phase 6-shape 10-case ladder
- `test/prepare-aave-withdraw.test.ts` — Phase 6-shape 10-case ladder
- `test/simulate-position-change.test.ts` — delta math unit tests
- `test/check-contract-security.test.ts` — Etherscan client mocked + rate-limit + missing-key
- `test/aave-v3-lifecycle.integration.test.ts` — persona-cycle Fixtures G+H

**Extended files:**
- `src/config/contracts.ts` — extend `ContractsForChain` interface with `aavePool`, `aavePoolAddressesProvider`, `aaveUiPoolDataProvider`, `aaveOracle`, `aaveIncentivesController` slots; populate row for `chainId: 1`. The existing `KNOWN_SPENDERS_ETHEREUM[0]` row already covers Aave V3 Pool as a spender (Phase 6 reserved slot 12 — actually populated as row 0 alphabetical-by-label).
- `src/protocols/erc20.ts` — extend `ERC20_COMBINED_DECODE_ABI` with Aave V3 fragments OR keep ERC-20-only and route Aave separately (Topic 10 reasonable-call: separate `decodeAaveCall`).
- `src/signing/blocks.ts` — add `AAVE_SUPPLY_PREPARE_RECEIPT_TEMPLATE`, `AAVE_WITHDRAW_PREPARE_RECEIPT_TEMPLATE`, `DECODED_ARGS_TEMPLATE_AAVE_SUPPLY`, `DECODED_ARGS_TEMPLATE_AAVE_WITHDRAW`; widen `buildDecodedArgsBlock` with `"aave-supply"` + `"aave-withdraw"` branches.
- `src/tools/preview_send.ts` — selector-routed two-step decode (ERC-20 first, fall through to Aave); DECODED ARGS block extension.
- `src/tools/register-all.ts` — add 5 imports (one per new tool).
- `src/config/env.ts` — add `getEtherscanApiKey(): string | undefined` helper.
- `test/signing-fingerprint.test.ts` — Fixtures G + H added.
- `test/config-contracts.test.ts` — 5 new Aave V3 address assertions.
- `test/preview-send.test.ts` or `test/preview-send.erc20.test.ts` (or new `test/preview-send.aave.test.ts`) — DECODED ARGS surfacing for supply/withdraw.

**Not touched (FROZEN):**
- `src/signing/payload-fingerprint.ts` — variable-length `data` already supported; Fixture B-F proves this.
- `src/signing/presign-hash.ts` — EIP-1559 hash shape is invariant; Aave calls are plain `eth_sendTransaction` shapes.
- `src/signing/handle-store.ts` — handle store TTL + state machine unchanged.
- `src/signing/error-codes.ts` — existing codes cover all Phase 7 failure modes (no new codes needed unless `RATE_LIMITED` is genuinely new — verify against current `ErrorCode` enum at execute-time).
- `src/tools/send_transaction.ts` — three gates (`previewToken`, `userDecision`, `payloadFingerprint`) unchanged.

## Open Questions (RESOLVED — see Recommendation per question; all 4 reflected in the plan bundle)

1. **Persona footprint for integration-test fixtures (A7).**
   - What we know: the current persona registry has `whale` = vitalik, `defi-degen` = Binance hot wallet, `stable-saver` / `staking-maxi`.
   - What's unclear: which persona has the richest Aave V3 positions for integration-test coverage.
   - Recommendation: pattern-mapper checks persona addresses against `getUserReservesData` at execute-time; if no persona has meaningful Aave positions, add a curated `aave-borrower` persona (or surface as the Phase 5 retro's "persona-archetype mismatch" landing point).

2. **`get_lending_positions` cross-chain output shape (forward dep on Phase 8).**
   - What we know: Phase 7 is Ethereum-only.
   - What's unclear: does the return shape pre-encode `chain: "ethereum"` so Phase 8's multi-chain extension is additive?
   - Recommendation: yes, encode `chain: "ethereum"` in the response root from day one. Phase 8 widens to a `chain: "ethereum" | "arbitrum" | ...` enum.

3. **`check_contract_security` chainId param exposure.**
   - What we know: Etherscan V2 uses `chainid` per request; one key works for all chains.
   - What's unclear: does Phase 7's `check_contract_security` take a `chain` arg (forward-compatible with Phase 8) or is it Ethereum-only?
   - Recommendation: hard-code `chainid: 1` in v1.1; Phase 8 (multi-chain) adds the `chain` arg. Consistent with the rest of v1.0/v1.1 surface — chain-locked tools widen at Phase 8.

4. **DECODED ARGS surface for Aave: token symbol lookup path.**
   - What we know: Aave V3 supply/withdraw's `asset` arg is a token address. The decoder needs to resolve it to a symbol + decimals for the human-readable DECODED ARGS block.
   - What's unclear: which lookup path — top-50 registry only (cheap, may miss long-tail Aave reserves) OR registry-then-live-RPC fallback (matches `prepare_token_send` shape)?
   - Recommendation: registry-then-live-RPC fallback, same as `prepare_token_send`. The handful of long-tail Aave reserves (e.g. less-common stablecoins) are exactly where decoded-arg surfacing helps the user most — an off-list address with no symbol is the riskier sign target.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| viem | All Phase 7 tools | ✓ | 2.48.11 (locked at package.json `^2.48.0`) | — |
| `ETHERSCAN_API_KEY` | `check_contract_security` | ✗ (not yet configured) | — | Tool refuses with structured `MISSING_CONFIG` envelope naming the env var + signup URL. User can register at https://etherscan.io/apis (free). |
| `ETHEREUM_RPC_URL` (or PublicNode fallback) | All on-chain reads (UiPoolDataProvider, Pool simulation) | ✓ (Phase 2 ships PublicNode fallback) | — | Already handled — `rpcDegraded` flag surfaces on fallback per Phase 2 pattern. |
| Aave V3 Pool implementation upgrade status | Stability of the function signatures | ✓ (Aave V3 has been stable since Jan 2023; no breaking changes to `supply`/`withdraw` since deployment) | — | Re-verify selectors at Phase 7 verify-phase if Aave governance ships a new implementation. |
| Ledger ERC-7730 registry coverage of Aave V3 Pool | Clear-sign UX | ✓ (verified 2026-05-13 — see Topic 6) | calldata-lpv3.json shipped | If clear-sign fails on user's device, the LEDGER BLIND-SIGN HASH block stays the cryptographic anchor; user verifies hash match. |

**Missing dependencies with no fallback:**
- ETHERSCAN_API_KEY for `check_contract_security` only — but the tool itself surfaces missing-key as a refusal, doesn't block other Phase 7 tools.

**Missing dependencies with fallback:**
- None blocking.

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | vitest 2.1.x (locked at package.json) |
| Config file | `vitest.config.ts` (existing) |
| Quick run command | `npm test -- <test-file>` (e.g. `npm test -- test/prepare-aave-supply.test.ts`) |
| Full suite command | `npm test` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| READ-20 | `get_lending_positions` returns Aave V3 positions with HF | unit + integration | `npm test -- test/get-lending-positions.test.ts` | ❌ Wave 0 (new file) |
| PREP-23 (supply) | `prepare_aave_supply` produces correct calldata | unit | `npm test -- test/prepare-aave-supply.test.ts` | ❌ Wave 0 |
| PREP-23 (withdraw) | `prepare_aave_withdraw` produces correct calldata | unit | `npm test -- test/prepare-aave-withdraw.test.ts` | ❌ Wave 0 |
| PREP-23 (Fixtures G/H) | Cryptographic-binding bytes pinned across personas | integration | `npm test -- test/aave-v3-lifecycle.integration.test.ts` | ❌ Wave 0 |
| PREP-24 | Pool address from SOT | unit | `npm test -- test/config-contracts.test.ts` (extend) | ✓ (extend existing) |
| PREP-25 | `simulate_position_change` projects HF | unit + integration | `npm test -- test/simulate-position-change.test.ts` | ❌ Wave 0 |
| READ-21 | `check_contract_security` returns verification + age + roles | unit | `npm test -- test/check-contract-security.test.ts` | ❌ Wave 0 |
| Health-factor math | Pure-fn math matches `getUserAccountData` | unit + verify-phase | `npm test -- test/signing-aave-health.test.ts`; mainnet cross-check at verify-phase | ❌ Wave 0 |
| Aave V3 selectors + ABI encode | Encoder produces canonical bytes | unit | `npm test -- test/protocols-aave-v3.test.ts` | ❌ Wave 0 |
| Fixtures G + H | Hardcoded literal anchors for supply / withdraw fingerprints | unit | `npm test -- test/signing-fingerprint.test.ts` | ✓ (extend existing) |

### Sampling Rate

- **Per task commit:** `npm test -- <touched-test-file>` (quick, < 30 sec for the specific file)
- **Per wave merge:** `npm test` (full suite, currently 474 tests; Phase 7 likely adds 60-90 → ~540-560 total)
- **Phase gate:** Full suite green AND `npm run typecheck` clean AND `npm run build` clean before `/gsd-verify-work`.

### Wave 0 Gaps

- [ ] `test/protocols-aave-v3.test.ts` — selectors + encoder unit
- [ ] `test/signing-aave-health.test.ts` — health-factor pure-fn
- [ ] `test/get-lending-positions.test.ts` — UiPoolDataProvider reader
- [ ] `test/prepare-aave-supply.test.ts` — 10-case ladder
- [ ] `test/prepare-aave-withdraw.test.ts` — 10-case ladder
- [ ] `test/simulate-position-change.test.ts` — delta projection
- [ ] `test/check-contract-security.test.ts` — Etherscan client unit
- [ ] `test/aave-v3-lifecycle.integration.test.ts` — persona-cycle Fixtures G+H
- [ ] Extend `test/signing-fingerprint.test.ts` with Fixtures G + H
- [ ] Extend `test/config-contracts.test.ts` with 5 Aave V3 address assertions
- [ ] Extend `test/preview-send.test.ts` (or new `.aave.test.ts`) with DECODED ARGS surfacing

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | Ledger WC pairing handles auth; Phase 7 doesn't introduce new auth surface |
| V3 Session Management | no | WC session lives in Phase 3 surface; Phase 7 reads from `getStatus()` only |
| V4 Access Control | yes (read-only) | `check_contract_security` privileged-role enumeration surfaces ACL data but doesn't grant access; pure read |
| V5 Input Validation | yes | `address` regex pattern enforcement at schema boundary; `parseAmountStrict` for decimals; rate-limit guard on Etherscan client |
| V6 Cryptography | yes | Reuses Phase 4's `computePayloadFingerprint` (keccak256 + domain-tag); Fixtures G/H pin the bytes; no new crypto |

### Known Threat Patterns for Phase 7 Stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| T-AAVE-ADDR-INLINE-1 — agent suggests a fake Aave Pool address that the user signs against | Spoofing | `tx.to = getAavePoolAddress(1)` from SOT; agent has no input slot to override; same shape as WETH9 `T-WETH-ADDR-INLINE-1` mitigation in Phase 6 |
| T-AAVE-FROZEN-1 — agent suggests supply to a frozen/paused reserve; tx reverts; user wastes gas | Tampering (agent) | Preview-time eth_call simulation catches frozen-reserve reverts; SIMULATION block surfaces revert reason |
| T-AAVE-LIQ-1 — agent suggests withdraw that pushes HF below 1.0, instant liquidation | Denial of Service (against the user) | `simulate_position_change` runs at prepare time (per Topic 4); UI surface includes `liquidationRisk` flag; the agent task block instructs the agent to check HF before suggesting confirm |
| T-AAVE-EMODE-1 — eMode user sees wrong HF computation (A3); agent under-recommends collateralization | Information Disclosure (incorrect info) | v1.1: surface `userEModeCategoryId` verbatim; document caveat. v2.3: per-category LT lookup. |
| T-AAVE-FIXTURE-DRIFT-1 — payloadFingerprint preimage shape changes for Aave-shape calldata | Tampering (compromised MCP) | Fixtures G + H hardcoded-literal assertions; persona-cycle integration test re-anchors byte-identity across `from`-swaps |
| T-ETHERSCAN-MASK-1 — `check_contract_security` masks a 5xx / network failure as "unverified" | Tampering (cross-component) | Discriminated-union result shape (`verified` / `unverified` / `error` / `rate-limited`) — never silently masks an upstream failure; same shape as `fourbyte.ts` |
| T-ETHERSCAN-RATE-1 — aggressive agent burns 100k/day quota on `check_contract_security` | DoS (resource exhaustion) | Per-session call counter (5 calls); refuses with `RATE_LIMITED` envelope; documents path to lift |
| T-AAVE-DECODE-BYPASS-1 — agent claims a supply call is something else; preview decodes via selector dispatch | Tampering (narrow agent) | `decodeAaveCall` is selector-routed against the canonical ABI; agent's claim is never trusted; the on-chain function signature hash is the SOT (same shape as Phase 6's `decodeErc20Call`) |
| T-AAVE-PROXY-1 — `check_contract_security` reports the Pool proxy's verification status but doesn't surface the implementation address | Information Disclosure | Tool response includes BOTH `proxy: true` and `implementation: <addr>` fields; user/agent can chain-check the implementation separately |
| T-AAVE-EMERGENCY-1 — Aave governance pauses the Pool mid-tx; preview is stale | Tampering (cross-component) | Preview-time eth_call catches a paused Pool; if simulation succeeds but send fails, the on-device hash mismatch is impossible (the bytes match what was prepared); the user just sees a revert at broadcast time |

## Sources

### Primary (HIGH confidence)
- [bgd-labs/aave-address-book — AaveV3Ethereum.sol](https://raw.githubusercontent.com/bgd-labs/aave-address-book/main/src/AaveV3Ethereum.sol) — canonical Aave V3 deployment address registry
- [Etherscan: Aave V3 Pool](https://etherscan.io/address/0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2) — verified source, "Aave: Pool V3"
- [Etherscan: UiPoolDataProviderV3](https://etherscan.io/address/0x56b7A1012765C285afAC8b8F25C69Bf10ccfE978) — verified source
- [LedgerHQ/clear-signing-erc7730-registry — registry/aave/calldata-lpv3.json](https://github.com/LedgerHQ/clear-signing-erc7730-registry/tree/main/registry/aave) — Aave V3 Pool clear-sign metadata (verified to cover `supply` + `withdraw` for chainId=1 on 2026-05-13)
- viem@2.48.11 type definitions and empirical Bash probes (`viem.toFunctionSelector`, `viem.encodeFunctionData`, `viem.parseAbi`) — locally verified
- [Etherscan V2 API — getsourcecode](https://docs.etherscan.io/api-reference/endpoint/getsourcecode.md)
- [Etherscan V2 API — getcontractcreation](https://docs.etherscan.io/api-reference/endpoint/getcontractcreation.md)
- [Etherscan rate limits](https://docs.etherscan.io/resources/rate-limits) — 5 calls/sec free tier

### Secondary (MEDIUM confidence)
- [Aave V3 Overview](https://aave.com/docs/aave-v3/overview) — protocol semantics + referralCode deprecation + eMode mechanics
- [Ledger Developer Portal — Clear-signing overview](https://developers.ledger.com/docs/clear-signing/overview) — ERC-7730 architecture
- [Ledger Developer Portal — Earn clear-signing](https://developers.ledger.com/docs/ledger-live/exchange/earn/clear-signing) — ERC-7730 requirements for Earn-class apps

### Tertiary (LOW confidence — flagged for verify-phase)
- "Off-chain HF math matches Aave UI within 1 bps" (A2) — assumed; verify-phase resolves via mainnet cross-check against `getUserAccountData`
- "Aave V3 Pool implementation is stable across the Phase 7 timeline" (A6) — verified historically; ongoing risk window is governance-coordinated upgrade

## Metadata

**Confidence breakdown:**
- Aave V3 deployment addresses: HIGH — cross-verified against bgd-labs/aave-address-book + Etherscan
- ABI surface (supply/withdraw/UiPool reads): HIGH — empirically verified via viem in-repo
- Ledger clear-sign coverage: HIGH — verified by reading the actual ERC-7730 metadata JSON in the canonical registry
- Health-factor math correctness: MEDIUM — formula derived from protocol docs; cross-check against `getUserAccountData` deferred to verify-phase (A2)
- Etherscan V2 API shape + rate limits: HIGH — verified against docs.etherscan.io + web-search confirmation
- eMode handling correctness in v1.1 HF math: MEDIUM-LOW (documented A3) — simplification accepted

**Research date:** 2026-05-13
**Valid until:** 2026-06-13 (30 days — Aave V3 + viem + Etherscan are all stable surfaces; revisit if Aave ships a major governance upgrade or Etherscan changes the V2 API surface)
