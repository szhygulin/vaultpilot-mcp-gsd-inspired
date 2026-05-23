# Phase 31: EigenLayer + Rocket Pool — Research

**Researched:** 2026-05-23
**Domain:** EigenLayer restaking (LST deposits) + Rocket Pool liquid staking (rETH stake/unstake) — Ethereum mainnet only
**Confidence:** HIGH (addresses + selectors + ABIs verified on-chain) / MEDIUM-LOW on D-13 clear-sign coverage (verified ABSENT — load-bearing finding)

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01:** EigenLayer contracts sourced from `src/config/contracts.ts` via a per-chain `EigenLayerContracts` interface + flat getters (`getEigenLayerStrategyManagerAddress`, `getEigenLayerStrategyAddress(chainId, lst)`, `getEigenLayerDelegationManagerAddress`). Rocket Pool contracts sourced via a per-chain `RocketPoolContracts` interface + flat getters (`getRocketPoolDepositPoolAddress`, `getRocketPoolRethAddress`, `getRocketPoolDepositSettingsAddress`). Both mirror `getLidoStethAddress` (Phase 30) and `getMorphoBlueAddress` (Phase 29) SOT shape. Cross-view byte-identity tests: `T-EIGENLAYER-SPENDER-DRIFT-1` for StrategyManager and per-strategy entries against `KNOWN_SPENDERS_ETHEREUM`; `T-ROCKETPOOL-SPENDER-DRIFT-1` for RocketDepositPool + rETH against `KNOWN_SPENDERS_ETHEREUM`.
- **D-02:** Separate `src/protocols/eigenlayer.ts` and `src/protocols/rocketpool.ts` files. Each protocol owns its own decoder file — different contract surfaces, different write semantics (deposit vs stake/unstake), independent ABI sets.
- **D-03:** Ethereum-write-only enforcement — `prepare_eigenlayer_deposit` + `prepare_rocketpool_stake` + `prepare_rocketpool_unstake` refuse on non-Ethereum chains via existing `CHAIN_ID_MISMATCH` errorCode 15 (Phase 8 surface). Reads also Ethereum-only by construction.
- **D-04:** Curated EigenLayer strategy registry in `src/config/contracts.ts` — top-LST strategies by TVL at planning time. Candidate set: stETH-Strategy, rETH-Strategy, cbETH-Strategy, sfrxETH-Strategy, wBETH-Strategy, ETHx-Strategy, ankrETH-Strategy, swETH-Strategy, lsETH-Strategy, OETH-Strategy (researcher prunes to top 5-7). Long-tail strategies + native restaking (EigenPod) → `INVALID_INPUT + hintTool → request_capability`.
- **D-05:** LST-approval pre-flight for `prepare_eigenlayer_deposit` — server reads `LST.allowance(owner, StrategyManager)` at prepare time; if insufficient, refuses with `INVALID_INPUT + hintTool → prepare_token_approve`.
- **D-06:** EigenLayer per-strategy deposit-cap pre-flight via `Strategy.userUnderlyingView` + `Strategy.totalShares` + `Strategy.maxTotalDeposits()` (if exposed). Refuses with `INVALID_INPUT + hintTool → request_capability` if amount would push the strategy past its cap.
- **D-07:** `prepare_rocketpool_stake` is value-bearing. Server pre-flight reads `RocketDAOProtocolSettingsDeposit.getMinimumDeposit()` and refuses if `amount < minimum`. Current minimum is 0.01 ETH; hardcoded fallback constant in `src/config/contracts.ts` for resilience.
- **D-08:** `prepare_rocketpool_unstake` deposit-pool-liquidity pre-flight via `RocketDepositPool.getBalance()` (ETH liquidity) + `rETH.getEthValue(rethAmount)` (ETH equivalent). Refuses with `INVALID_INPUT + hintTool → request_capability` if burn-ETH exceeds pool liquidity; surfaces "swap rETH on a DEX instead" guidance.
- **D-09:** No NFT-receipt block needed for any Phase 31 tool. Standard PREPARE RECEIPT + CHECKS PERFORMED + LEDGER NOTICE (if applicable per D-13) layout applies.
- **D-10:** EigenLayer slashing-risk informational line in CHECKS PERFORMED for `prepare_eigenlayer_deposit`. Verbatim template:
  ```
  - EigenLayer restaking: deposited LST shares are subject to slashing by AVS operators the user later delegates to. Phase 31 ships deposit only — operator delegation is a separate tool (deferred to v2.x). Informational; no enforcement gate.
  ```
- **D-11:** `get_eigenlayer_positions({ wallet })` returns:
  - `deposits: [{ strategy, lst, shares, underlyingAmount, ethEquivalent }]` per-strategy via `StrategyManager.stakerStrategyShares(wallet, strategy)` + `Strategy.sharesToUnderlyingView(shares)`
  - `pendingWithdrawals: [{ withdrawalRoot, strategy, shares, withdrawer, claimableAfterBlock }]` via `DelegationManager.getQueuedWithdrawals(wallet)` (read-only — claim flow deferred)
  - `totalEthEquivalent` (non-load-bearing aggregate; `approx: true` flag)
  `get_rocketpool_positions({ wallet })` returns: `rethBalance`, `exchangeRate`, `ethEquivalent`, `chain: "ethereum"`.
  Pure-bigint math in `src/signing/eigenlayer-shares.ts` + `src/signing/rocketpool-rate.ts`.
- **D-12:** Per-chain `CANONICAL_DISPATCH_TARGETS` (Phase 9) Ethereum arm extended for both protocols: EigenLayer StrategyManager + every per-strategy address; Rocket Pool RocketDepositPool + rETH.
- **D-12a:** `KNOWN_SPENDERS_ETHEREUM` extended with: EigenLayer StrategyManager (the LST approval target); Rocket Pool RocketDepositPool (informational — stake is value-bearing); rETH (the burn target — informational).
- **D-13:** Researcher MUST verify ERC-7730 registry coverage for `StrategyManager.depositIntoStrategy`, `RocketDepositPool.deposit()`, `rETH.burn(uint256)`. Drive LEDGER NOTICE block decisions per tool.
- **D-14:** Fixture letters Z/AA/AB (D-14 leaves to researcher discretion):
  - **Z** = `StrategyManager.depositIntoStrategy(strategy, token, amount)`
  - **AA** = `RocketDepositPool.deposit()` (no-arg, value-bearing — fixture captures `value` + empty calldata)
  - **AB** = `rETH.burn(rethAmount)`
- **D-15:** Phase 31 includes the v2.3 SECURITY.md milestone close-out summary section. Format mirrors v2.1 close-out: §6 milestone summary line per phase (28/29/30/31) + invariant cross-references + residual-risk reaffirmation. Lands in the final Plan 31-03 commit.

### Claude's Discretion

- Internal helper names (`EigenLayerReader`, `RocketPoolReader`, `parseEigenLayerStrategy`, `formatRocketPoolExchangeRate`, etc.)
- Whether `src/signing/eigenlayer-shares.ts` and `src/signing/rocketpool-rate.ts` ship as separate files or fold into their respective `src/protocols/*.ts` files (separate files is the default; matches Aave/Compound/Lido)
- Whether plan structure is 3 plans (31-01: contracts.ts + dispatch + KNOWN_SPENDERS; 31-02: EigenLayer; 31-03: Rocket Pool + v2.3 close-out) or different waveform
- Exact list of EigenLayer strategies in the curated registry — researcher prunes from candidate set to top-by-TVL + clear-sign availability
- Whether `RocketDAOProtocolSettingsDeposit.getMinimumDeposit()` is the canonical accessor or whether Rocket Pool exposes a more direct settings ABI

### Deferred Ideas (OUT OF SCOPE)

- `prepare_eigenlayer_delegate` + `_undelegate` — operator-delegation flow. Deferred to v2.x.
- `prepare_eigenlayer_claim_withdrawal` — queued-withdrawal claim flow. Surface read-only via `get_eigenlayer_positions.pendingWithdrawals`; claim deferred.
- EigenLayer EigenPod (native ETH restaking) — out of scope.
- Long-tail EigenLayer strategies beyond the curated registry — `INVALID_INPUT + hintTool → request_capability`.
- Rocket Pool node-operator deposits (16 / 8 ETH minipool) — out of scope.
- Rocket Pool rETH↔ETH DEX-fallback automation — surfaced as hint; deferred until v2.4 Uniswap.
- Cross-chain rETH bridging — Ethereum-only writes; v2.6 BRIDGE-T1.
- Other LSTs as EigenLayer strategies beyond curated set — demand-driven.
- EigenLayer rewards claim (post-AVS-launch) — deferred until AVS rewards production-launch confirmed.

</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| EIG-01 | `get_eigenlayer_positions({ wallet })` returns EigenLayer strategy-level deposits (per LST or native restaking) | Topic 2 (per-strategy shares accessor) + Topic 3 (per-strategy address registry) + Topic 5 (queued-withdrawal read) |
| EIG-02 | `prepare_eigenlayer_deposit({ strategy, lst, amount })` produces unsigned `StrategyManager.depositIntoStrategy` call | Topic 1 (verified addresses + selector + ABI) + Topic 6 (approval pre-flight + cap pre-flight) + Topic 8 (clear-sign coverage gap → LEDGER NOTICE needed) |
| RP-01 | `get_rocketpool_positions({ wallet })` returns rETH balance + accrued value | Topic 4 (rETH + exchange rate accessors) |
| RP-02 | `prepare_rocketpool_stake({ amount })` + `prepare_rocketpool_unstake({ rethAmount })` produce `RocketDepositPool.deposit` + `rETH.burn` calls | Topic 1 (verified addresses + selectors + ABIs) + Topic 7 (min-deposit + liquidity pre-flights) + Topic 8 (clear-sign coverage gap → LEDGER NOTICE needed) |

</phase_requirements>

---

## Summary

Phase 31 closes the v2.3 milestone by shipping the EigenLayer restaking deposit flow and the Rocket Pool liquid staking write surface (stake + unstake). Both protocols are Ethereum-mainnet-only at v2.3 — no L2 deployments are in scope. The implementation is a mechanical mirror of Phase 30 Lido: `prepare_eigenlayer_deposit` clones `prepare_lido_wrap` (single-arg LST input + approval pre-flight); `prepare_rocketpool_stake` clones `prepare_lido_stake` (value-bearing call); `prepare_rocketpool_unstake` clones `prepare_weth_unwrap` (single-arg ERC-20 burn). The per-protocol read tools clone `get_lido_positions` with protocol-specific aggregations.

Three load-bearing research findings drive Phase 31 planning:

1. **No ERC-7730 clear-sign coverage exists for EigenLayer or Rocket Pool [VERIFIED: github.com/LedgerHQ/clear-signing-erc7730-registry/tree/master/registry — no `eigenlayer`, `rocketpool`, or `rocket-pool` directories].** Phase 31 must therefore emit `LEDGER NOTICE` blocks for ALL THREE write tools (Phase 6 WETH9.withdraw precedent), NOT skip them like Phase 7 Aave / Phase 30 Lido. This is the single most significant divergence from the Lido analog and changes `src/signing/blocks.ts` template count from "no new LEDGER NOTICE templates needed" to "two new LEDGER NOTICE templates: `LEDGER_NOTICE_EIGENLAYER_DEPOSIT_TEMPLATE` + `LEDGER_NOTICE_ROCKETPOOL_TEMPLATE`" (one shared template covers stake + unstake; the user experience is symmetric).

2. **EigenLayer deposit caps were permanently lifted on April 16, 2024** [VERIFIED: blog.eigencloud.xyz/unpausing-restaking-caps-on-april-16th/]. D-06's cap pre-flight is still defense-in-depth (if a strategy is re-gated for regulatory/risk reasons), but in the steady state every call to `Strategy.maxTotalDeposits()` returns the unlimited sentinel. The recommended Phase 31 implementation is: read `maxTotalDeposits()` defensively, treat `2^256-1` (unlimited) and revert (function not exposed on this strategy) as "no cap" rather than refusal arms.

3. **Rocket Pool's RocketStorage indirection pattern is irrelevant at the tool layer** — the canonical proxy addresses (RocketDepositPool v1.2, rETH, RocketDAOProtocolSettingsDeposit) are stable enough that Phase 31 can hardcode them into `src/config/contracts.ts` with the same SOT discipline as the Lido contracts. The RocketStorage `getAddress(keccak256("contract.address", name))` pattern is what the Rocket Pool contracts themselves use internally; tool-layer callers don't need it because the resolved addresses are stable across the protocol's v1.2 upgrade and the next major upgrade would be a code change anyway.

**Primary recommendation:** Ship 3 plans matching the ROADMAP stub (31-01 SOT + dispatch + KNOWN_SPENDERS; 31-02 EigenLayer reads + deposit; 31-03 Rocket Pool reads + stake + unstake + v2.3 SECURITY.md close-out). Model `src/protocols/eigenlayer.ts` on `src/protocols/lido.ts` for multi-method ABI bundling; model `src/protocols/rocketpool.ts` on a hybrid of `src/protocols/weth9.ts` (deposit() is value-bearing like WETH9.deposit) and `src/protocols/lido.ts` (multi-method shape). NO new npm packages required — `viem` provides everything.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| EigenLayer LST deposit (`depositIntoStrategy`) | API / Backend (MCP server) | — | Encode 3-arg calldata; resolve strategy from curated registry; inject payloadFingerprint |
| EigenLayer per-strategy shares read | API / Backend | — | On-chain reads via viem publicClient against StrategyManager + per-strategy contracts |
| EigenLayer queued-withdrawal read | API / Backend | — | `DelegationManager.getQueuedWithdrawals(staker)` view; read-only |
| EigenLayer shares ↔ underlying conversion | API / Backend | — | Pure-bigint math in `eigenlayer-shares.ts`; `Strategy.sharesToUnderlyingView(shares)` |
| Rocket Pool stake (`RocketDepositPool.deposit()`) | API / Backend | — | Encode no-arg payable calldata; `msg.value` carries amount; pre-flight `getMinimumDeposit()` |
| Rocket Pool unstake (`rETH.burn(uint256)`) | API / Backend | — | Encode single-arg calldata; pre-flight `RocketDepositPool.getBalance()` + `rETH.getEthValue` |
| Rocket Pool rETH balance + exchange-rate read | API / Backend | — | `rETH.balanceOf(wallet)` + `rETH.getExchangeRate()` via viem publicClient |
| rETH→ETH conversion math | API / Backend | — | Pure-bigint math in `rocketpool-rate.ts`; `rethBalance * exchangeRate / 1e18` |
| LST allowance pre-flight (StrategyManager) | API / Backend | — | `stETH.allowance(owner, StrategyManager)` read at prepare time |
| Clear-sign display of EigenLayer tx | Device (Ledger) | — | NO clear-sign coverage; device shows raw keccak hash (blind-sign). LEDGER NOTICE block required. |
| Clear-sign display of Rocket Pool tx | Device (Ledger) | — | NO clear-sign coverage; blind-sign for both `deposit()` and `burn(uint256)`. LEDGER NOTICE block required. |
| Operator delegation (slashing reward claim) | DEFERRED | — | v2.x backlog; Phase 31 ships deposit only |
| Withdrawal claim (post-finalization) | DEFERRED | — | v2.x backlog; Phase 31 surfaces queued state read-only |

---

## Project Constraints (from CLAUDE.md)

These directives apply unchanged from prior phases; Phase 31 plans must honor them:

- **SOT discipline:** `src/config/contracts.ts` is the single source of truth for EigenLayer + Rocket Pool addresses. Never inline an address in a tool implementation. Cross-view byte-identity (`getEigenLayerStrategyManagerAddress(1)` vs the `KNOWN_SPENDERS_ETHEREUM` row) regression-tested in `test/config-contracts.test.ts`.
- **Fixture pinning:** Fixtures Z / AA / AB MUST be hardcoded `0x...` literals in `test/signing-fingerprint.test.ts`. NO `beforeAll`-snapshot. Cross-link from each consumer test (`prepare-eigenlayer-deposit.test.ts`, `prepare-rocketpool-stake.test.ts`, `prepare-rocketpool-unstake.test.ts`). Integration test re-anchors byte-identity across persona swaps.
- **ESM spy-affordance:** `_eigenLayerProtocol` + `_rocketPoolProtocol` mutable objects wrap the encoder/internal-call surface so `vi.spyOn(_eigenLayerProtocol, "encodeDepositIntoStrategy")` works (Phase 30 `_lidoProtocol` is the precedent).
- **Decimal-aware arithmetic:** All token amounts cross the agent boundary as decimal strings (e.g. `"100.5"`). LST decimals resolved at prepare time (most LSTs are 18 decimals; researcher confirms each strategy's underlying token decimals).
- **Stderr/stdout discipline:** Diagnostics on stderr; MCP protocol on stdout.
- **`prepare_*` returns handle + PREPARE RECEIPT:** Every Phase 31 prepare tool emits the PREPARE RECEIPT block with verbatim agent args.
- **`payloadFingerprint` re-check at send time:** FROZEN-area; Phase 31 inherits unchanged from Phase 4 trust pipeline.
- **GSD workflow:** Phase 31 work is scoped under `/gsd-execute-phase 31` after planning.

---

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `viem` | 2.48.11 (project) | ABI encode/decode, `parseAbi`, `encodeFunctionData`, `toFunctionSelector`, publicClient reads, `parseEther` | CLAUDE.md locked EVM stack; already in project |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| (none new) | — | All EigenLayer + Rocket Pool encoding uses viem `parseAbi` + `encodeFunctionData` inline | No new npm dependencies needed |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `viem.parseAbi` inline for EigenLayer | `@eigenlabs/eigensdk-js` | SDK exists for some EigenLayer integrations but is operator-side-focused (AVS registration, queue management); restaker-side flows (`depositIntoStrategy`) are 3 inline `parseAbi` fragments. Same Phase 30 SDK rejection logic applies. [ASSUMED] |
| `viem.parseAbi` inline for Rocket Pool | `rocketpool.js` / RocketPoolNode SDK | Rocket Pool SDKs target node-operator workflows; deposit + burn are trivial 2-fragment ABIs. SDK rejected on bundle-weight grounds. [ASSUMED] |

**Installation:** No new npm packages. All encoding uses `viem` already in project.

**Version verification:** Project's `viem@2.48.11` is current and was verified in Phase 30 research. [VERIFIED: Phase 30 RESEARCH.md package version cross-check]

---

## Package Legitimacy Audit

**No new packages to install in Phase 31.** All encoding primitives are available via the existing `viem@2.48.11` dependency. Both protocol surfaces are trivial (5 function signatures total: 1 for EigenLayer write + 1 for Rocket Pool stake + 1 for Rocket Pool unstake + read accessors). Phase 28/29/30 precedent firmly rejects SDKs in favor of inline ABI fragments — Phase 31 inherits unchanged.

| Package | Registry | Age | Downloads | Source Repo | slopcheck | Disposition |
|---------|----------|-----|-----------|-------------|-----------|-------------|
| (none) | — | — | — | — | — | — |

**Packages removed due to slopcheck [SLOP] verdict:** none (no new packages introduced)
**Packages flagged as suspicious [SUS]:** none

---

## Topic 1: EigenLayer + Rocket Pool Contract Surface (Ethereum Mainnet)

### EigenLayer M2 Core Contracts

**[VERIFIED: github.com/Layr-Labs/eigenlayer-contracts/script/configs/mainnet/mainnet-addresses.config.json + etherscan.io verification of StrategyManager + DelegationManager]**

| Contract | Role | Proxy Address |
|---------|------|--------------|
| StrategyManager | Restaker entry point — `depositIntoStrategy(strategy, token, amount)` | `0x858646372CC42E1A627fcE94aa7A7033e7CF075A` |
| DelegationManager | Operator-delegation + queued-withdrawals queue | `0x39053D51B77DC0d36036Fc1fCc8Cb819df8Ef37A` |
| EigenPodManager (out of scope) | Native ETH restaking — not in Phase 31 | `0x91E677b07F7AF907ec9a428aafA9fc14a0d3A338` |
| AVSDirectory (informational only) | AVS registry — not consumed by Phase 31 | `0x135dDa560e946695d6f155DACaFC6f1F25C1f5AF` |
| RewardsCoordinator (informational only) | AVS rewards claim — not in Phase 31 scope | `0x7750d328b314EfFa365A0402CcfD489B80B0adda` |

**Current deployment state:** EigenLayer mainnet is past the original "M2" branding; the live codebase tag is `v1.12.0` as of late 2025 [VERIFIED: official deployed-contracts docs reference]. The M2 ↔ v1.12 distinction does NOT affect the Phase 31 surface — `StrategyManager.depositIntoStrategy(address,address,uint256)` and `DelegationManager.getQueuedWithdrawals(address)` are stable proxy interfaces across the upgrade. CONTEXT.md D-04's reference to "M2 deployment" should be read as "current mainnet proxy addresses".

### EigenLayer Per-Strategy Addresses (Curated Registry)

**[VERIFIED: github.com/Layr-Labs/eigenlayer-contracts mainnet-addresses.config.json — 12 preLongtailStrats; per-LST mapping cross-verified via etherscan.io for stETH and rETH strategies]**

The 12 strategies in `preLongtailStrats` map to LSTs as follows. **Researcher recommendation: prune to a top-6 curated registry for Phase 31 (criteria: TVL ≥ $100M as of late 2025 + LST is not deprecated).** Long-tail strategies and the EigenPod native-restaking flow refuse at the tool surface with `INVALID_INPUT + hintTool → request_capability` per D-04.

| LST Symbol | Strategy Proxy Address | Underlying Token Address | Phase 31 Inclusion |
|-----------|------------------------|--------------------------|-----|
| stETH | `0x93c4b944D05dfe6df7645A86cd2206016c51564D` | `0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84` (Lido stETH — Phase 30 SOT) | **INCLUDE** (top TVL) |
| rETH | `0x1BeE69b7dFFfA4E2d53C2a2Df135C388AD25dCD2` | `0xae78736Cd615f374D3085123A210448E74Fc6393` (Rocket Pool rETH — this phase SOT) | **INCLUDE** (top TVL; cross-protocol synergy with Phase 31's rETH surface) |
| cbETH | `0x54945180dB7943c0ed0FEE7EdaB2Bd24620256bc` | `0xBe9895146f7AF43049ca1c1AE358B0541Ea49704` (Coinbase Wrapped Staked ETH) | **INCLUDE** (top TVL) |
| ETHx | `0x9d7eD45EE2E8FC5482fa2428f15C971e6369011d` | `0xA35b1B31Ce002FBF2058D22F30f95D405200A15b` (Stader ETHx) | **INCLUDE** (top TVL) |
| ankrETH | `0x13760F50a9d7377e4F20CB8CF9e4c26586c658ff` | `0xE95A203B1a91a908F9B9CE46459d101078c2c3cb` (Ankr Staked Ether) | DEFER (lower TVL) |
| oETH | `0xa4C637e0F704745D182e4D38cAb7E7485321d059` | `0x856c4Efb76C1D1AE02e20CEB03A2A6a08b0b8dC3` (Origin Staked ETH) | DEFER (lower TVL) |
| osETH | `0x57ba429517c3473B6d34CA9aCd56c0e735b94c02` | `0xf1C9acDc66974dFB6dEcB12aA385b9cD01190E38` (Stakewise osETH) | DEFER (lower TVL) |
| swETH | `0x0Fe4F44beE93503346A3Ac9EE5A26b130a5796d6` | `0xf951E335afb289353dc249e82926178EaC7DEd78` (Swell swETH) | DEFER (Swell focus shifted to L2; LST still active per defillama but de-emphasized) |
| wBETH | `0x7CA911E83dabf90C90dD3De5411a10F1A6112184` | `0xa2E3356610840701BDf5611a53974510Ae27E2e1` (Binance wBETH) | **INCLUDE** (top TVL) |
| sfrxETH | `0x8CA7A5d6f3acd3A7A8bC468a8CD0FB14B6BD28b6` | `0xac3E018457B222d93114458476f3E3416Abbe38F` (Frax sfrxETH) | **INCLUDE** (top TVL) |
| lsETH | `0xAe60d8180437b5C34bB956822ac2710972584473` | `0x8c1BEd5b9a0928467c9B1341Da1D7BD5e10b6549` (Liquid Collective lsETH) | DEFER (lower TVL) |
| mETH | `0x298aFB19A105D59E74658C4C334Ff360BadE6dd2` | `0xd5F7838F5C461fefF7FE49ea5ebaF7728bB0ADfa` (Mantle mETH) | **INCLUDE** (significant TVL growth in 2024-2025) |

**Recommended curated set for Phase 31 (6 strategies):** `stETH`, `rETH`, `cbETH`, `ETHx`, `wBETH`, `sfrxETH`, `mETH` (one over the 5-7 band — drop `mETH` if 6 is the cap; recommendation includes it because mETH grew significantly). Plan-checker should confirm at planning gate whether 6 or 7 is the right cardinality; the registry shape stays the same.

**[ASSUMED] underlying-token addresses for cbETH / ETHx / wBETH / sfrxETH / mETH** above are from training knowledge and the strategy contracts' token holdings inferred from `eigenlayer-contracts` config. Each MUST be re-verified at planning gate via `Strategy.underlyingToken()` view call against the strategy proxy — selector `0x2495a599` (`underlyingToken()`).

### EigenLayer Function Signatures + Selectors

**[VERIFIED: viem.toFunctionSelector executed against project's viem@2.48.11 at research time]**

```
depositIntoStrategy(address,address,uint256)       0xe7a050aa  ← StrategyManager write
stakerStrategyShares(address,address)              0x7a7e0d92  ← StrategyManager view
sharesToUnderlyingView(uint256)                    0x7a8b2637  ← StrategyBase view
userUnderlyingView(address)                        0x553ca5f8  ← StrategyBase view
totalShares()                                      0x3a98ef39  ← StrategyBase view
underlyingToken()                                  0x2495a599  ← StrategyBase view (returns ERC-20)
maxTotalDeposits()                                 0x61b01b5d  ← StrategyBase view (cap pre-flight)
maxPerDeposit()                                    0x43fe08b0  ← StrategyBase view (per-call cap)
getQueuedWithdrawals(address)                      0x5dd68579  ← DelegationManager view
```

**Phase 31 hardcoded selector constants in `src/protocols/eigenlayer.ts`:**
```typescript
export const EIGENLAYER_SELECTORS = {
  depositIntoStrategy: "0xe7a050aa" as Hex,
  stakerStrategyShares: "0x7a7e0d92" as Hex,
  sharesToUnderlyingView: "0x7a8b2637" as Hex,
  userUnderlyingView: "0x553ca5f8" as Hex,
  getQueuedWithdrawals: "0x5dd68579" as Hex,
} as const;
```

**Minimal ABI fragments:**

```typescript
// StrategyManager — src/protocols/eigenlayer.ts
const STRATEGY_MANAGER_ABI = parseAbi([
  "function depositIntoStrategy(address strategy, address token, uint256 amount) returns (uint256 shares)",
  "function stakerStrategyShares(address staker, address strategy) view returns (uint256)",
]);

// StrategyBase (per-LST strategy) — src/protocols/eigenlayer.ts
const STRATEGY_BASE_ABI = parseAbi([
  "function sharesToUnderlyingView(uint256 amountShares) view returns (uint256)",
  "function userUnderlyingView(address user) view returns (uint256)",
  "function totalShares() view returns (uint256)",
  "function underlyingToken() view returns (address)",
  "function maxTotalDeposits() view returns (uint256)",   // unlimited (2^256-1) after April 16, 2024
]);

// DelegationManager — src/protocols/eigenlayer.ts
// Returns Withdrawal[] + shares[][] for queued-withdrawal read (D-11)
const DELEGATION_MANAGER_ABI = parseAbi([
  "struct Withdrawal { address staker; address delegatedTo; address withdrawer; uint256 nonce; uint32 startBlock; address[] strategies; uint256[] shares; }",
  "function getQueuedWithdrawals(address staker) view returns (Withdrawal[] withdrawals, uint256[][] shares)",
]);
```

### Rocket Pool Core Contracts

**[VERIFIED: etherscan.io for RocketDepositPool v1.2 + rETH token; docs.rocketpool.net; rocket-pool/rocketpool GitHub source]**

| Contract | Role | Proxy Address |
|---------|------|--------------|
| RocketDepositPool v1.2 | Stake entry — `deposit()` payable; `getBalance()` view (pool ETH liquidity) | `0xDD3f50F8A6CafbE9b31a427582963f465E745AF8` |
| rETH (RocketTokenRETH) | Liquid staking token; `burn(uint256)` unstake; `getExchangeRate()` + `getEthValue(uint256)` views | `0xae78736Cd615f374D3085123A210448E74Fc6393` |
| RocketDAOProtocolSettingsDeposit | Settings — `getMinimumDeposit()` view (current 0.01 ETH) | resolved via RocketStorage; **researcher to re-verify exact proxy address at planning gate** |
| RocketStorage (indirection layer) | Address registry used internally by Rocket Pool contracts | `0x1d8f8f00cfa6758d7bE78336684788Fb0ee0Fa46` (canonical RocketStorage; verified by Rocket Pool docs reference) [ASSUMED — verify] |

**Important note on RocketDAOProtocolSettingsDeposit address:** Rocket Pool resolves this contract via `RocketStorage.getAddress(keccak256("contract.address", "rocketDAOProtocolSettingsDeposit"))` internally. The Phase 31 implementation has two options:

- **Option A (recommended for SOT discipline):** Hardcode the resolved proxy address in `src/config/contracts.ts` after one-time resolution against `RocketStorage`. Re-verify at planning gate via direct on-chain call. Matches Phase 30 Lido SOT pattern; agent calls are simple.
- **Option B:** Implement a small `RocketStorage` reader in `src/chains/rocketpool.ts` that resolves the settings address dynamically on every prepare call. Higher resilience to protocol upgrades; one extra RPC per prepare.

**Recommendation: Option A.** The settings contract proxy is stable since v1.2 (2023); a future Rocket Pool major version would be a code change anyway. Phase 31 hardcoded fallback constant (D-07) is the resilience anchor.

**[ASSUMED] RocketDAOProtocolSettingsDeposit proxy address:** Must be resolved at planning gate via `RocketStorage.getAddress` lookup. Commonly cited (training-data only): `0xac2245BE4C2C1E9752499Bcd34861B761d62fC27`. **DO NOT include this address as a verified value in `contracts.ts` until on-chain resolution confirms.** Planner gates this in Plan 31-01 acceptance criteria.

### Rocket Pool Function Signatures + Selectors

**[VERIFIED: viem.toFunctionSelector at research time + etherscan source]**

```
deposit()                                          0xd0e30db0  ← RocketDepositPool write (no-arg, payable)
burn(uint256)                                      0x42966c68  ← rETH write
getMinimumDeposit()                                0x035cf142  ← RocketDAOProtocolSettingsDeposit view
getBalance()                                       0x12065fe0  ← RocketDepositPool view (pool liquidity)
getExchangeRate()                                  0xe6aa216c  ← rETH view (rETH→ETH rate, 1e18-scaled)
getEthValue(uint256)                               0x8b32fa23  ← rETH view (ETH value of rETH amount)
```

**Important — selector collision note:** `deposit()` selector `0xd0e30db0` is **the same as `WETH9.deposit()` from Plan 06-04** (canonical wrap-ETH selector). This is fine because the dispatch is `(chain, to, selector)` — `preview_send` already routes by `tx.to`. But the selector reuse means `src/signing/blocks.ts` cannot use the bare selector for dispatch — the existing `WETH9_SELECTORS.deposit` would be ambiguous. The Rocket Pool selector should be defined alongside the WETH9 one, and the DECODED ARGS dispatch must branch on `tx.to` matching the canonical RocketDepositPool address before classifying as a stake call.

**Similarly:** `burn(uint256)` selector `0x42966c68` is **the canonical ERC-20 OpenZeppelin Burnable selector** — also not Rocket-Pool-unique. The dispatch must again branch on `tx.to === getRocketPoolRethAddress(1)`.

**Phase 31 hardcoded selector constants in `src/protocols/rocketpool.ts`:**
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

**Minimal ABI fragments:**

```typescript
// RocketDepositPool — src/protocols/rocketpool.ts
const ROCKET_DEPOSIT_POOL_ABI = parseAbi([
  "function deposit() payable",
  "function getBalance() view returns (uint256)",
]);

// RocketTokenRETH — src/protocols/rocketpool.ts
const RETH_ABI = parseAbi([
  "function burn(uint256 _rethAmount)",
  "function balanceOf(address account) view returns (uint256)",
  "function getExchangeRate() view returns (uint256)",
  "function getEthValue(uint256 _rethAmount) view returns (uint256)",
]);

// RocketDAOProtocolSettingsDeposit — src/protocols/rocketpool.ts
const ROCKET_SETTINGS_DEPOSIT_ABI = parseAbi([
  "function getMinimumDeposit() view returns (uint256)",
]);
```

**Constants:**
- `RETH_DECIMALS = 18`
- `ROCKET_POOL_MINIMUM_DEPOSIT_FALLBACK_WEI = 10_000_000_000_000_000n` (0.01 ETH — D-07 resilience anchor) [VERIFIED: docs.rocketpool.net + RocketDAOProtocolSettingsDeposit.sol source]

---

## Topic 2: EigenLayer Shares ↔ Underlying Math

**[VERIFIED: EigenLayer StrategyBase contract source via Layr-Labs/eigenlayer-contracts]**

EigenLayer's `StrategyBase` implements a share-based accounting model that is structurally identical to ERC-4626 (vault tokens), but the protocol predates ERC-4626 and uses its own ABI surface. Key relationships:

```
strategyShares[user][strategy] * underlyingPerShare = userUnderlyingAmount
```

Three on-chain view functions expose this:

```solidity
// How many shares does staker hold in strategy?
function stakerStrategyShares(address staker, address strategy) external view returns (uint256);
// On StrategyManager — entry point for per-user share lookup.

// What is the underlying-token value of the staker's full position in this strategy?
function userUnderlyingView(address user) external view returns (uint256);
// On the strategy contract itself — internally calls sharesToUnderlyingView(shares(user)).

// Convert a share amount to underlying-token amount at the current rate.
function sharesToUnderlyingView(uint256 amountShares) external view returns (uint256);
// On the strategy contract itself.
```

**`get_eigenlayer_positions` recommended read shape (per strategy in the curated registry):**

```typescript
// At get_eigenlayer_positions time:
const shares = await client.readContract({
  address: STRATEGY_MANAGER_ADDR,
  abi: STRATEGY_MANAGER_ABI,
  functionName: "stakerStrategyShares",
  args: [wallet, strategyAddr],
});
if (shares === 0n) continue;  // skip zero-balance strategies

const underlyingAmount = await client.readContract({
  address: strategyAddr,
  abi: STRATEGY_BASE_ABI,
  functionName: "sharesToUnderlyingView",
  args: [shares],
});

// Convert LST underlying to ETH equivalent (best-effort):
// For stETH: 1:1 with ETH (rebase model — already ETH-denominated)
// For rETH:  multiply by rETH.getExchangeRate() / 1e18
// For cbETH: multiply by cbETH.exchangeRate() / 1e18
// For wBETH: multiply by wBETH.exchangeRate() / 1e18
// For sfrxETH: query Frax sfrxETH conversion (more complex; defer with approx: true)
// For ETHx: query Stader exchange rate
// For mETH: query Mantle mETH exchange rate
// Phase 31 D-11 ships ethEquivalent with approx: true flag — exact PnL not in scope.
```

**Pure-bigint math in `src/signing/eigenlayer-shares.ts`:** Mirrors `src/signing/lido-rebase.ts` shape. No floating point, all `bigint`. Exports:

```typescript
export const SHARES_SCALE: bigint = 10n ** 18n;

export interface EigenLayerSharesInput {
  shares: bigint;
  underlyingPerShareNumerator?: bigint;  // optional; if provided, computes sharesToUnderlying off-chain
}

export interface EigenLayerSharesOutput {
  underlyingAmount: bigint;
  approx: true;  // load-bearing literal type; rate may be slightly stale between read time and on-chain state
}

export function convertSharesToUnderlying(input: EigenLayerSharesInput): EigenLayerSharesOutput {
  // Returns approximate underlying amount. Caller may use the on-chain
  // sharesToUnderlyingView for exact value; this function is for off-chain
  // ETH-equivalent estimation when the LST conversion rate is known.
  return {
    underlyingAmount: input.underlyingPerShareNumerator
      ? (input.shares * input.underlyingPerShareNumerator) / SHARES_SCALE
      : input.shares,
    approx: true,
  };
}
```

**Recommendation:** For Phase 31, default to using on-chain `sharesToUnderlyingView` calls (one per strategy per user position) rather than maintaining off-chain conversion-rate math. The off-chain helper exists as a non-load-bearing convenience for future ergonomics surfacing.

---

## Topic 3: Per-Strategy Address Registry Design (`src/config/contracts.ts` extension)

**Recommended schema:**

```typescript
// ---------------------------------------------------------------------------
// EigenLayer per-chain SOT — Phase 31 Plan 31-01.
// ---------------------------------------------------------------------------

/**
 * The 6-7 LST symbols whose EigenLayer strategies ship in the Phase 31 curated
 * registry. Curated per D-04 by current TVL + active-protocol status. Long-tail
 * strategies refuse at the tool surface with INVALID_INPUT + hintTool →
 * request_capability per D-04. Adding a new LST is a 2-step ritual:
 * extend this literal-union, populate the row.
 */
export type EigenLayerLst =
  | "stETH"
  | "rETH"
  | "cbETH"
  | "ETHx"
  | "wBETH"
  | "sfrxETH"
  | "mETH";

export interface EigenLayerContracts {
  strategyManager: Address;
  delegationManager: Address;
  // Per-LST strategy addresses. Partial because not all LSTs are deployed on
  // all chains (Phase 31 is Ethereum-only).
  strategies: Partial<Record<EigenLayerLst, Address>>;
  // Per-LST underlying token addresses. The LST's ERC-20 contract — this is
  // what the user APPROVES for the StrategyManager.
  lstTokens: Partial<Record<EigenLayerLst, Address>>;
}

const EIGENLAYER_RAW: Partial<Record<ChainId, EigenLayerContracts>> = {
  1: {
    strategyManager: getAddress("0x858646372CC42E1A627fcE94aa7A7033e7CF075A"),
    delegationManager: getAddress("0x39053D51B77DC0d36036Fc1fCc8Cb819df8Ef37A"),
    strategies: {
      stETH:   getAddress("0x93c4b944D05dfe6df7645A86cd2206016c51564D"),
      rETH:    getAddress("0x1BeE69b7dFFfA4E2d53C2a2Df135C388AD25dCD2"),
      cbETH:   getAddress("0x54945180dB7943c0ed0FEE7EdaB2Bd24620256bc"),
      ETHx:    getAddress("0x9d7eD45EE2E8FC5482fa2428f15C971e6369011d"),
      wBETH:   getAddress("0x7CA911E83dabf90C90dD3De5411a10F1A6112184"),
      sfrxETH: getAddress("0x8CA7A5d6f3acd3A7A8bC468a8CD0FB14B6BD28b6"),
      mETH:    getAddress("0x298aFB19A105D59E74658C4C334Ff360BadE6dd2"),
    },
    lstTokens: {
      stETH:   getAddress("0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84"),  // Phase 30 SOT — reuse
      rETH:    getAddress("0xae78736Cd615f374D3085123A210448E74Fc6393"),  // Phase 31 SOT — reuse
      cbETH:   getAddress("0xBe9895146f7AF43049ca1c1AE358B0541Ea49704"),
      ETHx:    getAddress("0xA35b1B31Ce002FBF2058D22F30f95D405200A15b"),
      wBETH:   getAddress("0xa2E3356610840701BDf5611a53974510Ae27E2e1"),
      sfrxETH: getAddress("0xac3E018457B222d93114458476f3E3416Abbe38F"),
      mETH:    getAddress("0xd5F7838F5C461fefF7FE49ea5ebaF7728bB0ADfa"),
    },
  },
};

export function getEigenLayerStrategyManagerAddress(chainId: ChainId): Address | null {
  return EIGENLAYER_RAW[chainId]?.strategyManager ?? null;
}

export function getEigenLayerDelegationManagerAddress(chainId: ChainId): Address | null {
  return EIGENLAYER_RAW[chainId]?.delegationManager ?? null;
}

export function getEigenLayerStrategyAddress(
  chainId: ChainId,
  lst: EigenLayerLst,
): Address | null {
  return EIGENLAYER_RAW[chainId]?.strategies[lst] ?? null;
}

export function getEigenLayerLstTokenAddress(
  chainId: ChainId,
  lst: EigenLayerLst,
): Address | null {
  return EIGENLAYER_RAW[chainId]?.lstTokens[lst] ?? null;
}

export function getAllEigenLayerStrategiesForChain(
  chainId: ChainId,
): Array<{ lst: EigenLayerLst; strategy: Address; lstToken: Address }> {
  const row = EIGENLAYER_RAW[chainId];
  if (!row) return [];
  const result: Array<{ lst: EigenLayerLst; strategy: Address; lstToken: Address }> = [];
  for (const lst of Object.keys(row.strategies) as EigenLayerLst[]) {
    const strategy = row.strategies[lst];
    const lstToken = row.lstTokens[lst];
    if (strategy && lstToken) result.push({ lst, strategy, lstToken });
  }
  return result;
}
```

```typescript
// ---------------------------------------------------------------------------
// Rocket Pool per-chain SOT — Phase 31 Plan 31-01.
// ---------------------------------------------------------------------------

export interface RocketPoolContracts {
  depositPool: Address;          // RocketDepositPool v1.2 (the stake entry)
  reth: Address;                 // RocketTokenRETH (the burn target)
  settingsDeposit: Address;      // RocketDAOProtocolSettingsDeposit (minimum-deposit accessor)
}

const ROCKETPOOL_RAW: Partial<Record<ChainId, RocketPoolContracts>> = {
  1: {
    depositPool:     getAddress("0xDD3f50F8A6CafbE9b31a427582963f465E745AF8"),  // VERIFIED
    reth:            getAddress("0xae78736Cd615f374D3085123A210448E74Fc6393"),  // VERIFIED
    settingsDeposit: getAddress("0x...PLANNING_GATE_RESOLVE..."),                // [ASSUMED] resolve via RocketStorage at planning time
  },
};

export function getRocketPoolDepositPoolAddress(chainId: ChainId): Address | null {
  return ROCKETPOOL_RAW[chainId]?.depositPool ?? null;
}

export function getRocketPoolRethAddress(chainId: ChainId): Address | null {
  return ROCKETPOOL_RAW[chainId]?.reth ?? null;
}

export function getRocketPoolDepositSettingsAddress(chainId: ChainId): Address | null {
  return ROCKETPOOL_RAW[chainId]?.settingsDeposit ?? null;
}

/**
 * Fallback minimum deposit per D-07. 0.01 ETH = 1e16 wei. Used when the on-chain
 * read against RocketDAOProtocolSettingsDeposit.getMinimumDeposit() fails or times out.
 * Verified against docs.rocketpool.net + RocketDAOProtocolSettingsDeposit.sol source
 * at research time 2026-05-23.
 */
export const ROCKET_POOL_MINIMUM_DEPOSIT_FALLBACK_WEI: bigint = 10_000_000_000_000_000n;
```

**KNOWN_SPENDERS_ETHEREUM additive entries** (alphabetical-by-label between existing Phase 30 Lido rows):

```typescript
// EigenLayer — Phase 31 Plan 31-01. StrategyManager is the LST approval target
// (per-LST users approve StrategyManager to transferFrom their LST balance).
{
  address: getEigenLayerStrategyManagerAddress(1)!,
  label: "EigenLayer StrategyManager",
  source: "https://github.com/Layr-Labs/eigenlayer-contracts",
},
// Rocket Pool — Phase 31 Plan 31-01. Two informational entries — neither is a
// true approval spender (stake is value-bearing; burn consumes msg.sender's own
// rETH directly). Included for preview_send DECODED ARGS coverage parity.
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

**Slot ordering invariant:** Phase 30 Lido added 2 rows; Phase 31 adds 3 more. All existing entries (Aave row 0, Compound rows 1-6, CowSwap row 7, LiFi row 8, Morpho row 9, Lido rows 10-11) stay byte-identical. T-EIGENLAYER-SPENDER-DRIFT-1 + T-ROCKETPOOL-SPENDER-DRIFT-1 anchor `getEigenLayerStrategyManagerAddress(1) === KNOWN_SPENDERS_ETHEREUM[<slot>].address` etc.

---

## Topic 4: Rocket Pool Read Strategy

**[VERIFIED: rETH contract source + etherscan]**

The rETH (RocketTokenRETH) contract implements:

```solidity
function balanceOf(address) view returns (uint256);    // ERC-20 standard
function getExchangeRate() view returns (uint256);     // rETH→ETH rate (1e18-scaled)
function getEthValue(uint256 _rethAmount) view returns (uint256);  // exact ETH-equivalent for amount
```

`getExchangeRate()` returns the result of calling `getEthValue(1 ether)` — i.e., the rate is "how much ETH does 1 rETH represent". The rate grows monotonically over time as Rocket Pool node operators accrue staking rewards.

**`get_rocketpool_positions` recommended read shape:**

```typescript
const [rethBalance, exchangeRate] = await Promise.all([
  client.readContract({ address: rethAddr, abi: RETH_ABI, functionName: "balanceOf", args: [wallet] }),
  client.readContract({ address: rethAddr, abi: RETH_ABI, functionName: "getExchangeRate" }),
]);
const ethEquivalent = (rethBalance * exchangeRate) / 10n ** 18n;
```

**Pure-bigint math in `src/signing/rocketpool-rate.ts`:** Mirrors `src/signing/lido-rebase.ts` shape.

```typescript
export const RETH_SCALE: bigint = 10n ** 18n;
export const RETH_DECIMALS: bigint = 18n;

export interface RocketPoolRateInput {
  rethBalance: bigint;
  exchangeRate: bigint;  // 1e18-scaled rETH→ETH rate from getExchangeRate()
}

export interface RocketPoolRateOutput {
  ethEquivalent: bigint;
  // No approx flag — getExchangeRate() returns the canonical contract-level rate;
  // the computation rethBalance * rate / 1e18 is exact at the read block height.
}

export function computeEthEquivalent(input: RocketPoolRateInput): RocketPoolRateOutput {
  return {
    ethEquivalent: (input.rethBalance * input.exchangeRate) / RETH_SCALE,
  };
}
```

**Note on rETH vs stETH:** rETH is a non-rebasing token (balance stays constant; redemption value grows). This is structurally identical to wstETH but with a different on-chain rate accessor. The `approx: true` flag from Lido `accruedRebaseRewards` does NOT apply to Rocket Pool — `getEthValue` is the canonical exact value at the read block.

---

## Topic 5: EigenLayer Queued-Withdrawal Read (D-11 `pendingWithdrawals`)

**[VERIFIED: DelegationManager.md docs + DelegationManager.sol source via Layr-Labs/eigenlayer-contracts]**

The DelegationManager contract surfaces two related view functions:

```solidity
struct Withdrawal {
  address staker;
  address delegatedTo;
  address withdrawer;
  uint256 nonce;
  uint32 startBlock;
  address[] strategies;
  uint256[] shares;
}

// Returns queued withdrawal struct + per-strategy shares array for a single withdrawal hash.
function getQueuedWithdrawal(bytes32 withdrawalRoot) view returns (Withdrawal memory, uint256[] memory);

// Returns ALL queued withdrawals + their share arrays for a staker.
function getQueuedWithdrawals(address staker) view returns (Withdrawal[] memory, uint256[][] memory);
```

**Phase 31 `get_eigenlayer_positions.pendingWithdrawals` recommended shape:**

```typescript
const [withdrawals, sharesByWithdrawal] = await client.readContract({
  address: DELEGATION_MANAGER_ADDR,
  abi: DELEGATION_MANAGER_ABI,
  functionName: "getQueuedWithdrawals",
  args: [wallet],
});

// Surface each withdrawal as a separate row in pendingWithdrawals:
const pendingWithdrawals = withdrawals.flatMap((w, i) =>
  w.strategies.map((strategy, j) => ({
    withdrawalRoot: computeWithdrawalRoot(w),  // off-chain helper; or skip and use index
    strategy: strategy,
    lst: lstSymbolFromStrategyAddress(strategy) ?? "unknown",
    shares: sharesByWithdrawal[i][j].toString(),
    withdrawer: w.withdrawer,
    startBlock: w.startBlock,
    claimableAfterBlock: w.startBlock + EIGENLAYER_WITHDRAWAL_DELAY_BLOCKS,
  })),
);
```

**EigenLayer withdrawal delay:** The withdrawal delay is governed by `DelegationManager.minWithdrawalDelayBlocks()` — a protocol-wide constant (currently 50400 blocks ≈ 7 days for LSTs; can differ per-strategy via `strategyWithdrawalDelayBlocks(strategy)`). Phase 31 SHOULD read these dynamically at `get_eigenlayer_positions` time rather than hardcoding the 7-day value (the protocol has the right to govern this and it's already been changed once during the testnet/mainnet rollout).

**Note:** `getQueuedWithdrawals` is a relatively new accessor (added with the M2 upgrade). On the older M1 surface, withdrawals were tracked via the `queuedWithdrawals` storage mapping which required computing the withdrawal hash off-chain. The M2 accessor simplifies Phase 31's read.

**[ASSUMED]** that `getQueuedWithdrawals` is the canonical accessor on the current mainnet deployment. Researcher confirms at planning gate via a direct on-chain call against the mainnet DelegationManager proxy. If the function signature has diverged, the planner adjusts the ABI fragment.

---

## Topic 6: EigenLayer Pre-Flight Checks (D-05 LST-approval + D-06 deposit-cap)

### D-05: LST approval pre-flight for `prepare_eigenlayer_deposit`

The approval requirements:

| Tool | Needs LST Approval? | Spender | Allowance Check |
|------|---------------------|---------|----------------|
| `prepare_eigenlayer_deposit` | YES | StrategyManager | `LST.allowance(wallet, StrategyManager) >= amount` |

**Approval pre-flight pattern (D-05) — mirrors Phase 28 + 30:**

```typescript
// At prepare_eigenlayer_deposit time, BEFORE handle creation:
const lstTokenAddr = getEigenLayerLstTokenAddress(chainId, lst)!;
const strategyManagerAddr = getEigenLayerStrategyManagerAddress(chainId)!;
const allowance = await client.readContract({
  address: lstTokenAddr,
  abi: erc20Abi,
  functionName: "allowance",
  args: [wallet, strategyManagerAddr],
});
if (allowance < amountWei) {
  return errEnvelope("INVALID_INPUT", `Insufficient ${lst} allowance...`, {
    hintTool: "prepare_token_approve",
    hintArgs: {
      tokenAddress: lstTokenAddr,
      spender: strategyManagerAddr,
      amount: formatUnits(amountWei, lstDecimals),
    },
  });
}
```

**Note on stETH-specific behavior:** stETH (Lido) is a rebase-bearing token. Allowance values in shares vs balance can differ; the `allowance` function returns the shares-allowed-to-transfer, not a balance-equivalent. For Phase 31 this is fine because: (a) the user is approving stETH from their balance to the StrategyManager; (b) the `transferFrom` will move stETH-as-balance and decrement the allowance proportionally. The pre-flight check `allowance >= amountWei` compares balance-equivalent terms because both sides are interpreted in the same shares-vs-balance frame by the contract. **No special-case handling needed for stETH.**

### D-06: Deposit-cap pre-flight

**[VERIFIED: April 16, 2024 EigenLayer cap removal — blog.eigencloud.xyz/unpausing-restaking-caps-on-april-16th/]**

EigenLayer's deposit caps were permanently lifted on April 16, 2024 across all 11 (now 12) supported LSTs. The `Strategy.maxTotalDeposits()` view function still exists on each strategy contract and returns `2^256 - 1` (effectively unlimited).

**D-06 implementation — defensive pre-flight:**

```typescript
// At prepare_eigenlayer_deposit time, AFTER approval pre-flight but BEFORE handle creation:
const [currentTotalShares, maxTotalDeposits] = await Promise.all([
  client.readContract({ address: strategyAddr, abi: STRATEGY_BASE_ABI, functionName: "totalShares" }),
  client.readContract({ address: strategyAddr, abi: STRATEGY_BASE_ABI, functionName: "maxTotalDeposits" })
    .catch(() => 2n ** 256n - 1n),  // some strategies may not expose this — treat as unlimited
]);

const MAX_UINT256 = 2n ** 256n - 1n;
if (maxTotalDeposits !== MAX_UINT256) {
  // Cap is finite — check if this deposit would push past it.
  // Note: this is a SHARES cap, not an underlying-token cap. Convert amountWei → shares first
  // via Strategy.underlyingToShares OR approximate as 1:1 if rates haven't drifted significantly.
  // For Phase 31 simplicity: refuse if currentTotalShares is already at cap (defensive only;
  // expected to never fire in steady state).
  if (currentTotalShares >= maxTotalDeposits) {
    return errEnvelope("INVALID_INPUT", `EigenLayer ${lst} strategy is at deposit cap...`, {
      hintTool: "request_capability",
      hintArgs: { feature: `EigenLayer ${lst} strategy unpause` },
    });
  }
}
// If maxTotalDeposits === MAX_UINT256: no cap; proceed.
```

**Performance note:** The defensive pre-flight adds 2 RPC reads per prepare call. Researcher recommends fusing these with the LST-allowance read via `Promise.all` (3-way parallel: allowance + totalShares + maxTotalDeposits).

---

## Topic 7: Rocket Pool Pre-Flight Checks (D-07 min-deposit + D-08 pool-liquidity)

### D-07: Minimum deposit pre-flight for `prepare_rocketpool_stake`

**[VERIFIED: rocketpool/contracts/contract/deposit/RocketDepositPool.sol + RocketDAOProtocolSettingsDeposit.sol source; docs.rocketpool.net]**

The on-chain validation in `RocketDepositPool.deposit()` checks:
```solidity
require(msg.value >= rocketDAOProtocolSettingsDeposit.getMinimumDeposit(), "Insufficient deposit");
```

Current minimum is **0.01 ETH = 1e16 wei** (verified via Rocket Pool docs + recent governance state, May 2026).

**D-07 implementation:**

```typescript
// At prepare_rocketpool_stake time, AFTER amount parse but BEFORE handle creation:
let minimumDeposit: bigint;
try {
  minimumDeposit = await client.readContract({
    address: settingsDepositAddr,
    abi: ROCKET_SETTINGS_DEPOSIT_ABI,
    functionName: "getMinimumDeposit",
  });
} catch (err) {
  // RPC failed; fall back to hardcoded constant per D-07.
  minimumDeposit = ROCKET_POOL_MINIMUM_DEPOSIT_FALLBACK_WEI;  // 1e16 wei = 0.01 ETH
}

if (amountWei < minimumDeposit) {
  return errEnvelope("INVALID_INPUT", `Rocket Pool minimum deposit is ${formatEther(minimumDeposit)} ETH, got ${rawAmount}`, {
    hintTool: "request_capability",
    hintArgs: { feature: "Rocket Pool minimum deposit context" },
  });
}
```

### D-08: Deposit-pool liquidity pre-flight for `prepare_rocketpool_unstake`

**[VERIFIED: rETH burn function source — checks ethBalance against ethAmount before burning]**

The on-chain validation in `rETH.burn()`:
```solidity
uint256 ethAmount = getEthValue(_rethAmount);
require(ethBalance >= ethAmount, "Insufficient ETH balance for exchange");
```

Where `ethBalance` is read from `RocketDepositPool.getBalance()`. If the deposit pool is empty (all ETH has been consumed by node-operator minipool creation), the burn reverts. Users in this situation must instead swap rETH on a DEX (Uniswap V3, Curve).

**D-08 implementation:**

```typescript
// At prepare_rocketpool_unstake time, AFTER amount parse but BEFORE handle creation:
const [poolBalance, ethEquivalent] = await Promise.all([
  client.readContract({
    address: depositPoolAddr,
    abi: ROCKET_DEPOSIT_POOL_ABI,
    functionName: "getBalance",
  }),
  client.readContract({
    address: rethAddr,
    abi: RETH_ABI,
    functionName: "getEthValue",
    args: [amountWei],  // rETH amount in wei
  }),
]);

if (poolBalance < ethEquivalent) {
  return errEnvelope("INVALID_INPUT",
    `Rocket Pool deposit pool empty (${formatEther(poolBalance)} ETH liquidity, need ${formatEther(ethEquivalent)} ETH for burn). Swap rETH on a DEX (Uniswap V3, Curve) instead, or wait for more deposits to refill the pool.`,
    {
      hintTool: "request_capability",
      hintArgs: { feature: "Rocket Pool rETH/ETH DEX swap" },
    });
}
```

---

## Topic 8: ERC-7730 Clear-Sign Coverage — D-13 RESOLVED

**[VERIFIED: github.com/LedgerHQ/clear-signing-erc7730-registry/tree/master/registry — directory listing inspected at research time 2026-05-23]**

The LedgerHQ ERC-7730 clear-signing registry contains directories for:

> 1inch, aave, benqi, celo, circle, consensus-specs, corestake, degate, dispatch, ethena, fellow-fund, figment, flare, hyperliquid, igra, kiln, layerswap, ledgerquest, lens, **lido**, lifi, lombard, midas, **morpho**, okx, ondo-finance, opencover, opensea, p2p, paraswap, permit, poap, quickswap, rarible, safe, sei, serenita, smartcredit, starkgate, swell, swissborg, tally, tether, uniswap, walletconnect, weth, yieldxyz

**There is NO `eigenlayer` directory. There is NO `rocketpool` or `rocket-pool` directory.**

This means:

- `StrategyManager.depositIntoStrategy(strategy, token, amount)` will **BLIND-SIGN** on the Ledger device. The user sees a raw 32-byte keccak hash, no decoded parameters.
- `RocketDepositPool.deposit()` will **BLIND-SIGN**. The user sees a raw hash for a value-bearing payable call with empty calldata (only the `value` and `to` are device-visible via blind-sign hash inputs).
- `rETH.burn(uint256)` will **BLIND-SIGN**. The user sees a raw hash; the burn amount is not decoded.

**D-13 DECISION:** All 3 Phase 31 write tools require `LEDGER NOTICE` blocks (Phase 6 WETH9.withdraw precedent, NOT Phase 7 Aave / Phase 30 Lido precedent).

**Recommended template structure for `src/signing/blocks.ts`:**

```typescript
/**
 * LEDGER NOTICE for EigenLayer depositIntoStrategy. ERC-7730 registry has NO
 * eigenlayer/ directory as of research date 2026-05-23 — every depositIntoStrategy
 * call falls back to blind-sign on the device. Mirrors LEDGER_NOTICE_WETH_UNWRAP_TEMPLATE.
 */
export const LEDGER_NOTICE_EIGENLAYER_DEPOSIT_TEMPLATE: string = [
  "LEDGER NOTICE",
  "  EigenLayer depositIntoStrategy is NOT covered by the Ledger Ethereum app's clear-sign plugins.",
  "  Your device will BLIND-SIGN this transaction (display a raw hash, no decoded args).",
  "  If your device refuses with \"Blind signing is not enabled\":",
  "    1. Open the Ethereum app on your device",
  "    2. Settings → Blind signing → Enabled",
  "    3. Retry send_transaction",
  "  After send_transaction fires, compare the PREDICTED hash below to the",
  "  value your hardware device displays — character-for-character. This",
  "  on-device match is the cryptographic anchor.",
].join("\n");

/**
 * Single LEDGER NOTICE template for both Rocket Pool stake AND unstake. ERC-7730
 * registry has NO rocketpool/ directory — both RocketDepositPool.deposit() and
 * rETH.burn(uint256) fall back to blind-sign. The user experience is symmetric so
 * one template covers both.
 */
export const LEDGER_NOTICE_ROCKETPOOL_TEMPLATE: string = [
  "LEDGER NOTICE",
  "  Rocket Pool deposit/burn is NOT covered by the Ledger Ethereum app's clear-sign plugins.",
  "  Your device will BLIND-SIGN this transaction (display a raw hash, no decoded args).",
  "  If your device refuses with \"Blind signing is not enabled\":",
  "    1. Open the Ethereum app on your device",
  "    2. Settings → Blind signing → Enabled",
  "    3. Retry send_transaction",
  "  After send_transaction fires, compare the PREDICTED hash below to the",
  "  value your hardware device displays — character-for-character. This",
  "  on-device match is the cryptographic anchor.",
].join("\n");
```

**Preview-send dispatch (conditional emission):**

```typescript
// In preview_send selector dispatch:
// EigenLayer:
if (record.tx.to === getEigenLayerStrategyManagerAddress(1) &&
    record.tx.data.slice(0, 10).toLowerCase() === EIGENLAYER_SELECTORS.depositIntoStrategy) {
  blocks.push(LEDGER_NOTICE_EIGENLAYER_DEPOSIT_TEMPLATE);
}

// Rocket Pool stake:
if (record.tx.to === getRocketPoolDepositPoolAddress(1) &&
    record.tx.data === "0xd0e30db0") {  // deposit() selector
  blocks.push(LEDGER_NOTICE_ROCKETPOOL_TEMPLATE);
}

// Rocket Pool burn (unstake):
if (record.tx.to === getRocketPoolRethAddress(1) &&
    record.tx.data.slice(0, 10).toLowerCase() === ROCKETPOOL_SELECTORS.burn) {
  blocks.push(LEDGER_NOTICE_ROCKETPOOL_TEMPLATE);
}
```

**Important risk note:** This is a significant departure from Phase 30 Lido. Lido shipped with full clear-sign coverage (4 functions, 3 ERC-7730 JSON files). Phase 31 ships with ZERO coverage and must surface that to the user via the LEDGER NOTICE template. The cryptographic-binding chain (`payloadFingerprint` + `presignHash` + on-device hash comparison) STILL holds — the user just lacks the parameter-decoded UX on-device and must rely on the `LEDGER BLIND-SIGN HASH` block character-match.

**Backlog item:** The vaultpilot-mcp project could submit ERC-7730 metadata files for EigenLayer's StrategyManager and Rocket Pool's RocketDepositPool + rETH to the LedgerHQ registry. This is out of scope for Phase 31 but should be noted as a v2.x ergonomics improvement opportunity.

---

## Topic 9: Existing Codebase Analogs

**[VERIFIED: read src/protocols/lido.ts, src/protocols/weth9.ts, src/security/canonical-dispatch.ts, src/signing/lido-rebase.ts, src/tools/prepare_lido_*.ts]**

### `src/protocols/lido.ts` → `src/protocols/eigenlayer.ts` + `src/protocols/rocketpool.ts`

The Phase 30 Lido decoder ships:
- ABI fragments via `parseAbi`
- Hardcoded selector constants
- Encoder functions
- ChainId re-export
- `_lidoProtocol` ESM spy-affordance object

Phase 31 mirrors this for BOTH protocols (two files, D-02). EigenLayer file ships:
- `STRATEGY_MANAGER_ABI`, `STRATEGY_BASE_ABI`, `DELEGATION_MANAGER_ABI`
- `EIGENLAYER_SELECTORS = { depositIntoStrategy, stakerStrategyShares, sharesToUnderlyingView, userUnderlyingView, getQueuedWithdrawals }`
- `encodeDepositIntoStrategy(strategy, token, amount): Hex`
- Re-exports: `getEigenLayerStrategyManagerAddress`, `getEigenLayerStrategyAddress`, `getEigenLayerLstTokenAddress`, `getEigenLayerDelegationManagerAddress`, `getAllEigenLayerStrategiesForChain`
- `_eigenLayerProtocol = { encodeDepositIntoStrategy }`

Rocket Pool file ships:
- `ROCKET_DEPOSIT_POOL_ABI`, `RETH_ABI`, `ROCKET_SETTINGS_DEPOSIT_ABI`
- `ROCKETPOOL_SELECTORS = { deposit, burn }`
- `encodeRocketPoolDeposit(): Hex` (returns 4 bytes; selector only)
- `encodeRocketPoolBurn(rethAmount: bigint): Hex`
- `RETH_DECIMALS = 18`
- `ROCKET_POOL_MINIMUM_DEPOSIT_FALLBACK_WEI = 10_000_000_000_000_000n`
- Re-exports: `getRocketPoolDepositPoolAddress`, `getRocketPoolRethAddress`, `getRocketPoolDepositSettingsAddress`
- `_rocketPoolProtocol = { encodeRocketPoolDeposit, encodeRocketPoolBurn }`

### `src/security/canonical-dispatch.ts` → extension

The current `buildPerChainAllowlist(chainId)` composes Aave + WETH + 1inch + LiFi + BRIDGED_VARIANTS + Compound + Morpho + Lido. Phase 31 extends with:

```typescript
// Phase 31 — Plan 31-01. EigenLayer write-side allowlist (Ethereum arm only).
// StrategyManager + every per-LST strategy address in the curated registry.
// Each strategy is a distinct dispatch target because depositIntoStrategy is
// called against the StrategyManager but the strategy address is the
// user-supplied param — if a future bug routes a deposit to a non-allowlisted
// strategy, DISPATCH_TARGET_REFUSED triggers.
const eigenStrategyManager = getEigenLayerStrategyManagerAddress(chainId);
const eigenStrategies = getAllEigenLayerStrategiesForChain(chainId).map((s) => s.strategy);
const eigenEntries: Address[] = [
  eigenStrategyManager,
  ...eigenStrategies,
].filter((a): a is Address => !!a && a !== "0x0000000000000000000000000000000000000000");

// Phase 31 — Plan 31-01. Rocket Pool write-side allowlist (Ethereum arm only).
// RocketDepositPool (stake target) + rETH (burn target).
// RocketDAOProtocolSettingsDeposit is read-only, not in dispatch allowlist.
const rocketDepositPool = getRocketPoolDepositPoolAddress(chainId);
const rocketReth = getRocketPoolRethAddress(chainId);
const rocketEntries: Address[] = [rocketDepositPool, rocketReth].filter(
  (a): a is Address => !!a && a !== "0x0000000000000000000000000000000000000000",
);

// In the Set spread:
return new Set<Address>([
  // ... existing entries ...
  ...eigenEntries,
  ...rocketEntries,
]);
```

**Membership counts after Phase 31:**
- Ethereum (1): 29 (post-Phase-30) + 1 StrategyManager + 7 strategies (curated set) + 2 Rocket Pool = **39 entries** (give or take, depending on cardinality of curated registry)
- Arbitrum/Polygon/Base/Optimism: unchanged (Phase 31 is Ethereum-only)

### `src/signing/blocks.ts` → extension (APPEND-ONLY)

Phase 31 appends:
- `EIGENLAYER_DEPOSIT_PREPARE_RECEIPT_TEMPLATE` (slots: `{CHAIN}`, `{STRATEGY_MANAGER}`, `{STRATEGY}`, `{LST_SYMBOL}`, `{LST_TOKEN}`, `{AMOUNT}`)
- `ROCKETPOOL_STAKE_PREPARE_RECEIPT_TEMPLATE` (slots: `{CHAIN}`, `{DEPOSIT_POOL}`, `{AMOUNT}`)
- `ROCKETPOOL_UNSTAKE_PREPARE_RECEIPT_TEMPLATE` (slots: `{CHAIN}`, `{RETH_CONTRACT}`, `{AMOUNT}`)
- `LEDGER_NOTICE_EIGENLAYER_DEPOSIT_TEMPLATE` (full template per Topic 8)
- `LEDGER_NOTICE_ROCKETPOOL_TEMPLATE` (full template per Topic 8 — shared between stake + unstake)
- `DECODED_ARGS_TEMPLATE_EIGENLAYER_DEPOSIT` (slots: `{STRATEGY_MANAGER}`, `{STRATEGY}`, `{LST_SYMBOL}`, `{LST_TOKEN}`, `{AMOUNT_HUMAN}`, `{AMOUNT_WEI}`)
- `DECODED_ARGS_TEMPLATE_ROCKETPOOL_STAKE` (slots: `{DEPOSIT_POOL}`, `{VALUE_ETH}`)
- `DECODED_ARGS_TEMPLATE_ROCKETPOOL_BURN` (slots: `{RETH_CONTRACT}`, `{AMOUNT_HUMAN}`, `{AMOUNT_WEI}`)
- `buildEigenLayerDecodedArgsBlock(decoded: EigenLayerDecoded): string`
- `buildRocketPoolDecodedArgsBlock(decoded: RocketPoolDecoded): string`

NO new function-shape blocks like `NFT_RECEIPT_EXPECTED_TEMPLATE` (D-09: no NFT receipt for Phase 31).

### `src/tools/prepare_lido_*.ts` → Phase 31 prepare-tool clones

- **`prepare_eigenlayer_deposit.ts`** clones **`prepare_lido_wrap.ts`** structurally (single-arg ERC-20-shape with approval pre-flight). Differences: 3-arg encode (strategy + token + amount), curated-LST enum, additional `lst` schema field, additional `strategy` field (optional — defaults to canonical strategy for given LST), deposit-cap pre-flight.

- **`prepare_rocketpool_stake.ts`** clones **`prepare_lido_stake.ts`** structurally (value-bearing payable call). Differences: 0-arg encode (just selector), min-deposit pre-flight, no referral arg.

- **`prepare_rocketpool_unstake.ts`** clones **`prepare_weth_unwrap.ts`** structurally (single-arg burn/withdraw). Differences: target is rETH not WETH9, pool-liquidity pre-flight, distinct LEDGER NOTICE template.

---

## Topic 10: Test Infrastructure

**New test files for Phase 31:**

| File | Mirrors | Purpose |
|------|---------|---------|
| `test/protocols-eigenlayer.test.ts` | `test/protocols-lido.test.ts` | ABI selector byte-identity (`0xe7a050aa`, `0x7a7e0d92`, `0x7a8b2637`, `0x553ca5f8`, `0x5dd68579`) + encoder round-trips |
| `test/protocols-rocketpool.test.ts` | `test/protocols-lido.test.ts` | ABI selector byte-identity (`0xd0e30db0`, `0x42966c68`) + selector-collision guard (assert deposit() selector matches WETH9's; document the collision) + encoder round-trips |
| `test/signing-eigenlayer-shares.test.ts` | `test/signing-lido-rebase.test.ts` | Pure-bigint math constants + `convertSharesToUnderlying` deterministic inputs → expected outputs |
| `test/signing-rocketpool-rate.test.ts` | `test/signing-lido-rebase.test.ts` | Pure-bigint math + `computeEthEquivalent` |
| `test/signing-fingerprint.test.ts` (EXTEND) | (extend existing) | Fixtures Z / AA / AB hardcoded `0x...` literals (compute at write-time; never `beforeAll` snapshot) |
| `test/get-eigenlayer-positions.test.ts` | `test/get-lido-positions.test.ts` | Mock publicClient reads for per-strategy shares + sharesToUnderlyingView + getQueuedWithdrawals; happy path + zero-balance skip + queued withdrawal present |
| `test/get-rocketpool-positions.test.ts` | `test/get-lido-positions.test.ts` | Mock publicClient reads for rETH balance + getExchangeRate; ethEquivalent computation byte-identical to off-chain math |
| `test/prepare-eigenlayer-deposit.test.ts` | `test/prepare-lido-wrap.test.ts` | Schema validation + approval pre-flight refusal arm + deposit-cap pre-flight + `[LEDGER NOTICE]` block present + RECEIPT byte-identity + Fixture Z cross-link |
| `test/prepare-rocketpool-stake.test.ts` | `test/prepare-lido-stake.test.ts` | Schema validation + value-bearing calldata + min-deposit refusal arm + LEDGER NOTICE present + Fixture AA cross-link |
| `test/prepare-rocketpool-unstake.test.ts` | `test/prepare-weth-unwrap.test.ts` | Schema validation + pool-liquidity refusal arm + LEDGER NOTICE present + Fixture AB cross-link |
| `test/eigenlayer-rocketpool-lifecycle.integration.test.ts` | `test/lido-lifecycle.integration.test.ts` | Persona-cycle byte-identity for EigenLayer deposit + Rocket Pool stake → unstake; Fixtures Z/AA/AB re-anchored across personas |
| `test/config-contracts.test.ts` (EXTEND) | (extend existing) | T-EIGENLAYER-SPENDER-DRIFT-1 + T-ROCKETPOOL-SPENDER-DRIFT-1 cross-view byte-identity |

**Test naming discipline:** Hyphen, not underscore (`prepare-eigenlayer-deposit.test.ts`).

---

## Topic 11: Implementation Pitfalls

### Pitfall 1: `RocketDepositPool.deposit()` selector collides with `WETH9.deposit()`
**What goes wrong:** Both contracts have a no-arg payable `deposit()` function — same selector `0xd0e30db0`. A naive dispatch in `preview_send` based on selector alone would misroute Rocket Pool stakes as WETH wraps (or vice versa).
**Prevention:** Phase 31 `preview_send` extension must dispatch on `(tx.to, selector)` tuple, not selector alone. Asserted in `test/preview-send.rocketpool.test.ts` — a WETH9.deposit and a RocketDepositPool.deposit produce different DECODED ARGS blocks and different LEDGER NOTICE arms.

### Pitfall 2: `rETH.burn(uint256)` selector is the generic ERC-20 Burnable selector
**What goes wrong:** Selector `0x42966c68` is the canonical OpenZeppelin `ERC20Burnable.burn(uint256)` selector — many other tokens implement it. A future tool that decodes generic burn calls would conflict.
**Prevention:** Same as Pitfall 1 — dispatch on `(tx.to === getRocketPoolRethAddress(1), selector === burn)` tuple. Asserted in tests.

### Pitfall 3: EigenLayer strategy address vs LST token address confusion
**What goes wrong:** `StrategyManager.depositIntoStrategy(strategy, token, amount)` takes BOTH the strategy address (e.g. `0x93c4b944...` for stETH-Strategy) AND the underlying token address (e.g. `0xae7ab965...` for stETH). Passing the strategy address as `token` (or vice versa) produces an on-chain revert; passing a mismatched (strategy, token) pair where the token isn't the strategy's underlying produces a different revert.
**Prevention:** `prepare_eigenlayer_deposit` resolves BOTH from the curated registry — agent passes `{ lst: "stETH" }` and server looks up `(getEigenLayerStrategyAddress(1, "stETH"), getEigenLayerLstTokenAddress(1, "stETH"))`. Agent never passes raw addresses for these two slots. Optional `strategy: Address` override surfaces in the schema for the rare advanced user who wants a non-canonical strategy — but the LST token is always resolved from the curated registry.

### Pitfall 4: stETH allowance rebase semantics
**What goes wrong:** stETH's `allowance` returns the underlying shares allowed for transfer, not a balance-equivalent. A first-time depositor who calls `prepare_token_approve({ token: stETH, spender: StrategyManager, amount: "1.0" })` sets an allowance of 1 stETH WORTH OF SHARES. On a subsequent rebase, the share-to-balance ratio changes; the allowance covers proportionally less balance.
**Prevention:** Phase 31 D-05 pre-flight reads stETH.allowance and compares to amountWei in shares-vs-balance same-frame — this is correct because the on-chain `transferFrom` will also decrement allowance in the same frame. The user pain point is: between approve and deposit, if the user receives a positive rebase, the allowance now covers less than they intended. This is a documented Lido quirk; Phase 31 surfaces "approve max" as the canonical recommendation in the LEDGER NOTICE / agent-task block.

### Pitfall 5: Rocket Pool deposit pool can empty mid-prepare
**What goes wrong:** Between `prepare_rocketpool_unstake` (pre-flight reads `RocketDepositPool.getBalance() >= ethEquivalent`) and `send_transaction` (the actual burn), another user's burn can drain the pool past the user's amount. The user's tx then reverts on-chain with "Insufficient ETH balance for exchange".
**Prevention:** D-08 pre-flight is best-effort — the user might still see an on-chain revert. The pre-flight catches the common case (pool already empty) but cannot eliminate the race window. Surfaced in CHECKS PERFORMED as "deposit pool liquidity at prepare time; may decrease before send".

### Pitfall 6: EigenLayer cap pre-flight returns 2^256-1
**What goes wrong:** `Strategy.maxTotalDeposits()` returns `2^256 - 1` (effectively unlimited) on all current strategies after the April 2024 cap removal. A naive `if (amount > maxTotalDeposits) refuse` works trivially — but a developer might check `if (currentTotalShares + amountAsShares > maxTotalDeposits)` and trigger an integer overflow on the addition.
**Prevention:** Sentinel check first: `if (maxTotalDeposits === 2n ** 256n - 1n) skipCapCheck()`. Asserted in `test/prepare-eigenlayer-deposit.test.ts` cap-unlimited arm.

### Pitfall 7: `RocketDAOProtocolSettingsDeposit` address resolution
**What goes wrong:** The RocketDAOProtocolSettingsDeposit address isn't documented directly; it's resolved via `RocketStorage.getAddress(keccak256("contract.address", "rocketDAOProtocolSettingsDeposit"))`. A developer might guess an address that's wrong or stale.
**Prevention:** At planning gate (Plan 31-01 acceptance criteria), the planner MUST resolve the address via direct on-chain call against the canonical RocketStorage (`0x1d8f8f00cfa6758d7bE78336684788Fb0ee0Fa46`) and commit the result as a `getAddress(...)`-wrapped literal in `contracts.ts`. Hardcoded fallback constant covers RPC failure (D-07).

### Pitfall 8: `getQueuedWithdrawals` response shape may have changed across M2 upgrades
**What goes wrong:** EigenLayer's M2 → v1.12 upgrades have iterated the `Withdrawal` struct shape (early M2 had 6 fields; current has 7 including `delegatedTo`). A stale ABI fragment would silently decode garbage.
**Prevention:** Researcher confirms the current Withdrawal struct shape at planning gate by either (a) calling `getQueuedWithdrawals` against a known-empty wallet and reading the empty-array return type, or (b) reading the live DelegationManager source via Etherscan. ABI commit only after confirmation.

---

## Topic 12: Fixture Letter Assignment (D-14 RESOLVED)

**[VERIFIED: Phase 30 RESEARCH.md consumed V/W/X/Y; Phase 28 R/S/T/U; Phase 29 used Morpho-29-{A,B,C,D} sibling-file naming]**

Phase 30 consumed letters V (Lido.submit), W (WithdrawalQueue.requestWithdrawals), X (WstETH.wrap), Y (WstETH.unwrap) in `test/signing-fingerprint.test.ts`.

**Phase 31 assignment (D-14 recommended scheme — confirmed):**

| Fixture | Function | Contract | Key Parameters |
|---------|----------|----------|---------------|
| **Z** | `StrategyManager.depositIntoStrategy(strategy, token, amount)` | StrategyManager (`0x858646...`) | strategy=stETH-Strategy (`0x93c4b944...`), token=stETH (`0xae7ab965...`), amount=1e18 wei |
| **AA** | `RocketDepositPool.deposit()` | RocketDepositPool (`0xDD3f50F8...`) | value=1e18 wei (1 ETH); calldata=`0xd0e30db0` (just selector, no args) |
| **AB** | `rETH.burn(rethAmount)` | rETH (`0xae78736C...`) | rethAmount=1e18 wei (1 rETH) |

These go into `test/signing-fingerprint.test.ts` (main file — same precedent as Phase 30 V/W/X/Y). Hardcoded `0x...` literals computed at fixture-write time via a one-shot script; never `beforeAll`-snapshot. Cross-link each consumer test (`prepare-eigenlayer-deposit.test.ts`, `prepare-rocketpool-stake.test.ts`, `prepare-rocketpool-unstake.test.ts`).

**Rationale for two-letter wrap-around (Z → AA, AB):** Sequential continuation of the single-letter alphabet. Future phases (Phase 32 Uniswap V3 swap was reserved as Y per earlier note — REQUIRES CONFIRMATION) continue with AC, AD, AE, etc. The two-letter scheme avoids the awkward Y/Z reservation question that surfaced between Phases 29 and 30.

**Per-LST integration test fixture (Z extended):** The integration test runs Fixture Z across 3-4 personas (default `from`-dependent because `from` flows into approval pre-flight reads; not the calldata). Phase 31 integration test extends the Phase 30 lido-lifecycle.integration.test.ts pattern with an EigenLayer + Rocket Pool full cycle: stake stETH → deposit stETH into EigenLayer strategy → burn rETH for ETH (assuming user already had rETH from a prior Rocket Pool stake). Persona-cycle byte-identity asserted across all 3 fixtures.

---

## Topic 13: v2.3 SECURITY.md Milestone Close-Out Scope (D-15)

**[VERIFIED: SECURITY.md current v2.1 milestone close-out section format (lines 329-378) — pattern Phase 31 follows]**

The v2.1 milestone close-out section is the canonical template Phase 31 mirrors for v2.3. The structure is:

```
## <Milestone> v<version> milestone close-out summary

<one-paragraph milestone scope statement>

### Milestone PRs
- Phase <N> (<title>) — PRs #X / #Y / #Z — <one-line summary of cryptographic-binding changes>
- ...

### Trust-shape recap
<inherited trust-pipeline shape; usually a navigation pointer to per-phase sections>

### <Frozen-area invariant>
<e.g. "21-code error union FROZEN — INVALID_INPUT + hintTool pattern">

### Accepted residual risks
- **<residual>**: <description>
- ...

### Phase <N> threat register summary
<per-phase threat table>
```

**Recommended v2.3 milestone close-out content (Plan 31-03 commit):**

```markdown
## EVM lending + staking v2.3 milestone close-out summary

Closes out the v2.3 EVM lending + staking expansion milestone. Phases 28 (Compound V3) + 29 (Morpho Blue) + 30 (Lido) + 31 (EigenLayer + Rocket Pool) shipped under per-plan admin-merge cadence. All four protocols ship Ethereum-mainnet-only writes; reads are multi-chain where the protocol is deployed (Compound: Ethereum-only per Phase 28 deferral; Morpho: Ethereum-only per Phase 29 deferral; Lido: Ethereum + Arbitrum bridged; EigenLayer + Rocket Pool: Ethereum-only by protocol scope).

### Milestone PRs

- Phase 28 (Compound V3) — PRs #<TBD> — Multi-Comet supply/withdraw/borrow/repay; per-Comet SOT; intent-vs-reality LEDGER NOTICE; Fixtures R/S/T/U.
- Phase 29 (Morpho Blue) — PRs #<TBD> — Universal-contract single-file decoder; market-id-keyed reads; Fixtures Morpho-29-{A,B,C,D} (sibling file to preserve V/W/X for Phase 30).
- Phase 30 (Lido) — PRs #<TBD> — stETH ↔ wstETH wrap/unwrap + stake + WithdrawalQueue unstake (NFT receipt block); ALL 4 functions ERC-7730 clear-sign covered; Fixtures V/W/X/Y.
- Phase 31 (EigenLayer + Rocket Pool) — PRs #<TBD> — EigenLayer LST depositIntoStrategy (curated 6-7 strategy registry); Rocket Pool stake (value-bearing deposit) + unstake (burn); NO ERC-7730 coverage → LEDGER NOTICE templates for all 3 write tools; Fixtures Z/AA/AB.

### Trust-shape recap

The v2.3 milestone reuses the v1.x EVM trust pipeline unchanged. `payloadFingerprint`, `presignHash`, `LEDGER BLIND-SIGN HASH` block, three-gate `send_transaction` enforcement all FROZEN. No new error codes; the 21-code union remains closed. All four protocols adopt the `INVALID_INPUT + hintTool` intent-vs-reality refusal pattern for approval pre-flights, deposit-cap pre-flights, minimum-deposit pre-flights, and pool-liquidity pre-flights.

### Clear-sign coverage gap (NEW for v2.3)

The v2.3 milestone surfaces a structural divergence between protocols in ERC-7730 clear-sign coverage:

- **Covered:** Lido (3 contracts, all 4 functions covered — Phase 30).
- **NOT covered:** Compound V3 Comets (Phase 28), Morpho Blue (Phase 29), EigenLayer StrategyManager (Phase 31), Rocket Pool RocketDepositPool + rETH (Phase 31). All five surfaces fall back to blind-sign on the device.

Phase 31 ships the canonical `LEDGER_NOTICE_*` templates for the EigenLayer + Rocket Pool surfaces; Phase 28 + 29 had already shipped equivalent `LEDGER_NOTICE_COMPOUND_TEMPLATE`. The user experience remains: the `LEDGER BLIND-SIGN HASH` block is the cryptographic anchor; on-device parameter decoding is best-effort and per-protocol.

**Backlog item:** Submitting ERC-7730 metadata to LedgerHQ's registry for EigenLayer, Rocket Pool, Compound V3, and Morpho Blue would close the clear-sign gap. Out of scope for v2.3; v2.x ergonomics improvement.

### Accepted residual risks

- **v2.3 verify-phase pending real-Ledger smoke** — None of the four v2.3 protocols have been exercised against a physical Ledger device with mainnet writes. The verify-phase smoke is bundled across all four:
  1. Compound V3: small supply + withdraw on cUSDCv3.
  2. Morpho Blue: small supply + withdraw on a curated market.
  3. Lido: small stake (1 minute → 0.01 ETH) → wrap → unwrap → unstake (NFT receipt verification).
  4. EigenLayer: small stETH deposit into stETH-Strategy.
  5. Rocket Pool: small stake (0.01 ETH minimum) → small burn.

  Each broadcast verifies the on-device blind-sign hash matches the `LEDGER BLIND-SIGN HASH` block from `preview_send`. Open milestone-completion gate; NOT auto-resolved by Phase 31.

- **EigenLayer + Rocket Pool ERC-7730 coverage absent** — Both protocols ship without on-device clear-sign coverage as of 2026-05-23. Users must rely on the blind-sign hash character-match. Acknowledged in LEDGER NOTICE blocks; remediation deferred to v2.x backlog (submit metadata to LedgerHQ).

- **Rocket Pool deposit pool liquidity race window** — D-08 pre-flight reads pool liquidity at prepare time; the actual burn at send time may revert if other users drain the pool first. Documented in CHECKS PERFORMED. Accepted residual; mitigation via Uniswap V3 fallback path (Phase 32+).

- **EigenLayer queued-withdrawal claim flow deferred** — `prepare_eigenlayer_claim_withdrawal` is out of scope for Phase 31. Users see queued withdrawals in `get_eigenlayer_positions.pendingWithdrawals` but cannot claim via this MCP server until v2.x. Document as user-facing limitation in tool DESCRIPTION strings.

### Phase 31 threat register summary

| Threat ID | STRIDE | Severity | Mitigation |
|-----------|--------|----------|------------|
| T-EIGENLAYER-STRATEGY-MISMATCH | Tampering | HIGH | Server resolves (strategy, lstToken) from curated registry by LST symbol; agent passes `{ lst: "stETH" }` not raw addresses; mismatch impossible by construction. |
| T-EIGENLAYER-CAP-BYPASS | Tampering | MEDIUM | Defensive cap pre-flight reads `Strategy.maxTotalDeposits` + `totalShares`; refuses on cap-near-exceeded. Steady-state caps are 2^256-1 (uncapped post-April-2024). |
| T-ROCKETPOOL-MIN-DEPOSIT-DRIFT | Tampering | LOW | On-chain `getMinimumDeposit()` read at prepare time; hardcoded fallback constant `ROCKET_POOL_MINIMUM_DEPOSIT_FALLBACK_WEI = 1e16` for RPC-failure resilience. |
| T-ROCKETPOOL-LIQUIDITY-RACE | Spoofing | MEDIUM | D-08 pre-flight reads pool liquidity at prepare time; accepted residual that pool can drain before send. Documented in CHECKS PERFORMED. |
| T-31-BLIND-SIGN-LEDGER-NOTICE | Spoofing | HIGH | LEDGER NOTICE blocks emitted on all 3 prepare tools; user cannot proceed without seeing the blind-sign warning. Cryptographic anchor is the on-device blind-sign hash match against `LEDGER BLIND-SIGN HASH` block. |
| T-31-SELECTOR-COLLISION-DEPOSIT | Tampering | MEDIUM | `RocketDepositPool.deposit()` selector `0xd0e30db0` collides with `WETH9.deposit()`. Preview-send dispatch routes on `(tx.to, selector)` tuple; asserted in `test/preview-send.rocketpool.test.ts`. |
| T-31-SELECTOR-COLLISION-BURN | Tampering | LOW | `rETH.burn(uint256)` selector `0x42966c68` is generic ERC-20 Burnable selector. Same tuple-dispatch defense. |
| T-FROZEN-31 | Tampering | CRITICAL | FROZEN three-gate region of `send_transaction.ts` byte-identical to `origin/main`. Phase 31 is additive only. |
| T-31-SC | Tampering | LOW | NO new npm packages in Phase 31 (research §Package Legitimacy Audit — empty table). |

The v2.3 milestone (EVM lending + staking expansion, Phases 28-31) is functionally complete. The v2.3 verify-phase remains pending a real-Ledger Ethereum-app smoke against mainnet — small Compound supply + Morpho supply + Lido stake/wrap/unwrap/unstake + EigenLayer deposit + Rocket Pool stake/burn. The FROZEN three-gate region of `send_transaction.ts` is byte-identical to `origin/main` across the full v2.3 milestone.
```

---

## Architecture Patterns

### System Architecture Diagram

```
Agent (intent: "deposit 1 stETH into EigenLayer" | "stake 1 ETH on Rocket Pool" | "unstake 1 rETH from Rocket Pool")
   │
   ▼
prepare_eigenlayer_deposit / prepare_rocketpool_stake / prepare_rocketpool_unstake
   │
   ├─► [eigenlayer_deposit] CHAIN_ID_MISMATCH gate (D-03)
   │   │  → parseAmountStrict(amount, lstDecimals)
   │   │  → resolve (strategy, lstToken) from curated registry by `lst` symbol
   │   │
   │   ├─► D-05 approval pre-flight:
   │   │       lstToken.allowance(wallet, StrategyManager) >= amount?
   │   │       → INVALID_INPUT + hintTool: prepare_token_approve if insufficient
   │   │
   │   ├─► D-06 deposit-cap pre-flight:
   │   │       Strategy.maxTotalDeposits() → MAX_UINT256? (post-April-2024 default)
   │   │       → if finite: check Strategy.totalShares() vs cap
   │   │       → INVALID_INPUT + hintTool: request_capability if at cap
   │   │
   │   └─► data = encodeDepositIntoStrategy(strategyAddr, lstTokenAddr, amountWei)
   │           tx.to: StrategyManager (0x858646...)
   │
   ├─► [rocketpool_stake] CHAIN_ID_MISMATCH gate (D-03)
   │   │  → parseAmountStrict(amount, 18) → ETH wei
   │   │
   │   ├─► D-07 min-deposit pre-flight:
   │   │       RocketDAOProtocolSettingsDeposit.getMinimumDeposit() (with fallback to 1e16)
   │   │       → INVALID_INPUT + hintTool: request_capability if amount < min
   │   │
   │   └─► data = encodeRocketPoolDeposit()   (just 4-byte selector, empty calldata after)
   │           tx.to: RocketDepositPool (0xDD3f50F8...)
   │           tx.value = amountWei
   │
   └─► [rocketpool_unstake] CHAIN_ID_MISMATCH gate (D-03)
       │  → parseAmountStrict(rethAmount, 18) → rETH wei
       │
       ├─► D-08 liquidity pre-flight:
       │       Promise.all([
       │         RocketDepositPool.getBalance(),       // pool ETH liquidity
       │         rETH.getEthValue(rethAmountWei),       // ETH-equivalent of burn
       │       ])
       │       → INVALID_INPUT + hintTool: request_capability if pool < ethEquivalent
       │
       └─► data = encodeRocketPoolBurn(rethAmountWei)
               tx.to: rETH (0xae78736C...)
   │
   ├─► computePayloadFingerprint({ chainId: 1, to, valueWei, data })
   │
   └─► createHandle → PREPARE RECEIPT → tool response
          │
          ▼
      preview_send
        ├─► Layer 0.5 dispatch check (StrategyManager + per-strategy addresses + RocketDepositPool + rETH all in CANONICAL_DISPATCH_TARGETS Ethereum arm)
        ├─► Layer 1 chain check
        │
        ├─► EMIT LEDGER NOTICE BLOCK (all 3 Phase 31 tools — NO ERC-7730 coverage)
        │   - LEDGER_NOTICE_EIGENLAYER_DEPOSIT_TEMPLATE
        │   - LEDGER_NOTICE_ROCKETPOOL_TEMPLATE (shared for stake + unstake)
        │
        └─► DECODED ARGS block: per-protocol decoded calldata view
                   │
                   ▼
              send_transaction (previewToken + userDecision + payloadFingerprint drift gate)
                   │
                   ▼
              Ledger device (BLIND-SIGNS: raw keccak hash; user character-matches against LEDGER BLIND-SIGN HASH block)

get_eigenlayer_positions({ wallet })
   │
   ├─► For each strategy in curated registry:
   │     Promise.all([
   │       StrategyManager.stakerStrategyShares(wallet, strategy),
   │       (if shares > 0) Strategy.sharesToUnderlyingView(shares),
   │     ])
   │
   └─► DelegationManager.getQueuedWithdrawals(wallet) → pendingWithdrawals[]

get_rocketpool_positions({ wallet })
   │
   └─► Promise.all([
         rETH.balanceOf(wallet),
         rETH.getExchangeRate(),
       ])
       → ethEquivalent = (rethBalance * exchangeRate) / 1e18
```

### Recommended Project Structure

```
src/
├── protocols/
│   ├── eigenlayer.ts        # StrategyManager + StrategyBase + DelegationManager ABIs + selectors + encoder
│   └── rocketpool.ts        # RocketDepositPool + rETH + RocketDAOProtocolSettingsDeposit ABIs + selectors + encoders
├── chains/
│   ├── eigenlayer.ts        # Per-chain read helpers (sharesToUnderlyingView fan-out across registry)
│   └── rocketpool.ts        # Per-chain read helpers (rETH balance + exchange rate)
├── signing/
│   ├── eigenlayer-shares.ts # Pure-bigint shares↔underlying math (mirrors signing/lido-rebase.ts)
│   └── rocketpool-rate.ts   # Pure-bigint rETH↔ETH math
├── config/
│   └── contracts.ts         # EigenLayerContracts interface + EIGENLAYER_RAW + 5 getters
│                            # + RocketPoolContracts interface + ROCKETPOOL_RAW + 3 getters
│                            # + ROCKET_POOL_MINIMUM_DEPOSIT_FALLBACK_WEI constant
│                            # + 3 KNOWN_SPENDERS_ETHEREUM entries
├── security/
│   └── canonical-dispatch.ts  # StrategyManager + 7 strategies + RocketDepositPool + rETH wired for Ethereum
└── tools/
    ├── get_eigenlayer_positions.ts
    ├── get_rocketpool_positions.ts
    ├── prepare_eigenlayer_deposit.ts
    ├── prepare_rocketpool_stake.ts
    └── prepare_rocketpool_unstake.ts
```

### Pattern 1: Curated-Registry Tool Schema (EigenLayer)

**What:** Agent passes a curated LST symbol; server resolves to canonical addresses from the SOT registry.
**When to use:** EigenLayer-specific — many strategies exist but only a subset are curated. Prevents the agent from passing a raw strategy address (which could be a malicious lookalike).
**Example:**
```typescript
// Source: research § Topic 9; mirrors Compound V3 cometBase enum pattern
const INPUT_SCHEMA = {
  type: "object" as const,
  properties: {
    chain: { type: "string", enum: ["ethereum"] },
    lst: {
      type: "string",
      enum: ["stETH", "rETH", "cbETH", "ETHx", "wBETH", "sfrxETH", "mETH"],  // curated registry
      description: "LST symbol from the curated EigenLayer registry. Long-tail LSTs refuse with INVALID_INPUT + hintTool: request_capability.",
    },
    amount: { type: "string" },
    from: { type: "string", pattern: "^0x[0-9a-fA-F]{40}$" },
  },
  required: ["chain", "lst", "amount"],
  additionalProperties: false,
};
// Optional `strategy` override is intentionally NOT exposed in Phase 31 — adds attack surface
// for "pass a malicious strategy address". v2.x can add it once the use case is clear.
```

### Pattern 2: Value-Bearing No-Arg Call (Rocket Pool Stake)

**What:** Encode a 4-byte selector with NO calldata args; `msg.value` carries the amount.
**When to use:** Rocket Pool stake — `RocketDepositPool.deposit()` is no-arg payable.
**Example:**
```typescript
// Source: research § Topic 1; mirrors src/protocols/weth9.ts encodeWethDeposit
export function encodeRocketPoolDeposit(): Hex {
  // No-arg call: calldata is just the 4-byte selector.
  return encodeFunctionData({
    abi: ROCKET_DEPOSIT_POOL_ABI,
    functionName: "deposit",
    args: [],
  });
  // Returns "0xd0e30db0" — collides with WETH9.deposit() selector.
  // Preview-send dispatch differentiates via tx.to.
}
```

### Pattern 3: Defensive Cap Pre-Flight (EigenLayer)

**What:** Read `maxTotalDeposits()` defensively; treat the unlimited sentinel as "no cap" rather than entering the cap-check branch.
**When to use:** EigenLayer deposit — most strategies are uncapped post-April-2024.
**Example:**
```typescript
// Source: research § Topic 6; defensive pattern documented in Pitfall 6
const MAX_UINT256 = 2n ** 256n - 1n;

const [currentTotalShares, maxTotalDeposits] = await Promise.all([
  client.readContract({ address: strategyAddr, abi: STRATEGY_BASE_ABI, functionName: "totalShares" }),
  client.readContract({
    address: strategyAddr,
    abi: STRATEGY_BASE_ABI,
    functionName: "maxTotalDeposits",
  }).catch(() => MAX_UINT256),  // some strategies may not expose this — treat as unlimited
]);

if (maxTotalDeposits !== MAX_UINT256 && currentTotalShares >= maxTotalDeposits) {
  return errEnvelope("INVALID_INPUT", `EigenLayer ${lst} strategy at cap`, {
    hintTool: "request_capability",
    hintArgs: { feature: `EigenLayer ${lst} strategy unpause` },
  });
}
// Else: proceed; cap is either uncapped (sentinel) or has headroom.
```

### Anti-Patterns to Avoid

- **Anti-pattern: Agent passes raw strategy address** — opens prompt-injection attack surface (malicious-LLM passes a lookalike strategy contract that drains funds). Phase 31 ships with curated-LST enum only.
- **Anti-pattern: Hardcode `withdrawalDelayBlocks: 50400`** — EigenLayer governance can change this. Read dynamically at `get_eigenlayer_positions` time.
- **Anti-pattern: Inline contract addresses in `prepare_*` tools** — CLAUDE.md SOT rule. Always route through `getEigenLayer*Address` / `getRocketPool*Address` getters.
- **Anti-pattern: Skip the LEDGER NOTICE block for Phase 31** — Phase 30 Lido shipped without one because clear-sign was confirmed; Phase 31 explicitly does NOT have clear-sign coverage. The notice is load-bearing UX.
- **Anti-pattern: Reuse `WETH9_SELECTORS.deposit` for Rocket Pool dispatch** — same selector, different protocol. Maintain distinct constants and route on `(tx.to, selector)` tuple.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| ABI encoding for `depositIntoStrategy(address,address,uint256)` | Custom keccak + RLP serializer | `viem.encodeFunctionData` + `parseAbi` | Viem already handles 3-arg encoding correctly; custom serializers miss edge cases (e.g. address checksumming, dynamic-type offsets). |
| Per-strategy share-to-underlying conversion | Off-chain math from cached exchange rates | On-chain `Strategy.sharesToUnderlyingView(shares)` per call | Strategies update underlying-per-share continuously as AVSs accrue rewards; cached rates drift. On-chain read is the canonical value. |
| Rocket Pool address resolution at runtime | RocketStorage indirection on every prepare call | Hardcode resolved proxy addresses in `contracts.ts` SOT | Phase 31 stake/burn surface targets stable v1.2 proxies; resolution-on-every-call adds RPC dependency for no benefit. |
| EigenLayer queued-withdrawal hash computation | Off-chain `keccak256(abi.encode(Withdrawal))` | `DelegationManager.getQueuedWithdrawals(staker)` view | The on-chain accessor returns both the struct and the shares array in one call; the hash is the storage key, not the user-facing identifier. |
| LST-decimals lookup at prepare time | `get_token_metadata` MCP call per LST | Curated `lstTokens` map with implicit `decimals: 18` (all 7 curated LSTs are 18 decimals) | 7-LST registry shape; decimals are an invariant per token. The general-purpose lookup is needed for off-curated tokens. |

**Key insight:** Phase 31's surface is mechanically clonable from Phase 30 Lido. The temptation to "make it generic" (e.g. a `prepare_eigenlayer_deposit({ strategy: Address, token: Address })` that accepts raw addresses) directly trades off security (prompt-injection attack surface) against ergonomic flexibility. CONTEXT.md D-04's curated-LST scheme is the right call; do not generalize.

---

## Runtime State Inventory

**Not applicable** — Phase 31 is a greenfield additive phase. No renames, no refactors, no migrations of existing string identifiers. No stored data, live service config, OS-registered state, secrets/env vars, or build artifacts carry old identifiers that need updating.

Phase 31 does add new entries to `KNOWN_SPENDERS_ETHEREUM` and new dispatch targets to `CANONICAL_DISPATCH_TARGETS[1]`, but these are net-new — existing entries are byte-identical (T-LIDO-SPENDER-DRIFT-1 / Phase 30 cross-view tests still pass unchanged).

---

## Common Pitfalls

(See Topic 11 for the full pitfall catalog. Summary:)

1. **`RocketDepositPool.deposit()` selector collision with `WETH9.deposit()`** — dispatch must route on `(tx.to, selector)` tuple.
2. **`rETH.burn(uint256)` selector is generic ERC-20 Burnable** — same tuple-dispatch rule.
3. **EigenLayer strategy vs LST token confusion** — server resolves both from curated registry; agent passes only the LST symbol.
4. **stETH allowance rebase semantics** — allowance is in shares; rebase between approve and deposit can leave allowance short. Surface "approve max" recommendation in LEDGER NOTICE.
5. **Rocket Pool pool empties mid-prepare** — D-08 pre-flight is best-effort; surface "may revert on-chain" caveat.
6. **EigenLayer cap is `2^256 - 1` in steady state** — sentinel check first; never `currentTotalShares + amount` without overflow guard.
7. **RocketDAOProtocolSettingsDeposit address resolution** — resolve at planning gate via RocketStorage; hardcode fallback constant for resilience.
8. **`getQueuedWithdrawals` struct shape may drift across M2 upgrades** — confirm ABI at planning gate.

---

## Code Examples

### EigenLayer deposit calldata encoding

```typescript
// Source: research § Topic 1 + Pattern 1 (curated registry)
import { encodeFunctionData, parseAbi, type Hex, type Address } from "viem";

const STRATEGY_MANAGER_ABI = parseAbi([
  "function depositIntoStrategy(address strategy, address token, uint256 amount) returns (uint256 shares)",
]);

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
  // Produces 4 + 32 + 32 + 32 = 100-byte calldata.
  // Selector: 0xe7a050aa (verified via viem.toFunctionSelector at research time)
}
```

### Rocket Pool stake (no-arg payable)

```typescript
// Source: research § Topic 1 + Pattern 2 (value-bearing no-arg)
const ROCKET_DEPOSIT_POOL_ABI = parseAbi(["function deposit() payable"]);

export function encodeRocketPoolDeposit(): Hex {
  return encodeFunctionData({
    abi: ROCKET_DEPOSIT_POOL_ABI,
    functionName: "deposit",
    args: [],
  });
  // Produces "0xd0e30db0" (4 bytes — selector only).
  // Calldata length: 4 bytes. msg.value carries the ETH amount.
}
```

### Rocket Pool unstake (single-arg burn)

```typescript
// Source: research § Topic 1
const RETH_ABI = parseAbi(["function burn(uint256 _rethAmount)"]);

export function encodeRocketPoolBurn(rethAmount: bigint): Hex {
  return encodeFunctionData({
    abi: RETH_ABI,
    functionName: "burn",
    args: [rethAmount],
  });
  // Produces 4 + 32 = 36-byte calldata.
  // Selector: 0x42966c68 (generic ERC-20 Burnable; dispatch on tx.to)
}
```

### EigenLayer position read (per-strategy fan-out)

```typescript
// Source: research § Topic 2 + Topic 5
import { getAllEigenLayerStrategiesForChain, getEigenLayerStrategyManagerAddress, getEigenLayerDelegationManagerAddress } from "../config/contracts.js";

export async function readEigenLayerPositions(client: PublicClient, wallet: Address) {
  const strategies = getAllEigenLayerStrategiesForChain(1);
  const strategyManagerAddr = getEigenLayerStrategyManagerAddress(1)!;
  const delegationManagerAddr = getEigenLayerDelegationManagerAddress(1)!;

  // Step 1: For each curated strategy, read user's shares.
  const sharesResults = await Promise.all(strategies.map(({ lst, strategy, lstToken }) =>
    client.readContract({
      address: strategyManagerAddr,
      abi: STRATEGY_MANAGER_ABI,
      functionName: "stakerStrategyShares",
      args: [wallet, strategy],
    }).then((shares) => ({ lst, strategy, lstToken, shares })),
  ));

  // Step 2: For strategies with non-zero shares, read sharesToUnderlyingView.
  const deposits = await Promise.all(
    sharesResults.filter((r) => r.shares > 0n).map(async (r) => {
      const underlyingAmount = await client.readContract({
        address: r.strategy,
        abi: STRATEGY_BASE_ABI,
        functionName: "sharesToUnderlyingView",
        args: [r.shares],
      });
      return {
        strategy: r.strategy,
        lst: r.lst,
        shares: r.shares.toString(),
        underlyingAmount: underlyingAmount.toString(),
        ethEquivalent: underlyingAmount.toString(),  // approx: 1:1 for ETH-LSTs; refined per LST conversion rate
      };
    }),
  );

  // Step 3: Read queued withdrawals.
  const [pendingWithdrawals, pendingShares] = await client.readContract({
    address: delegationManagerAddr,
    abi: DELEGATION_MANAGER_ABI,
    functionName: "getQueuedWithdrawals",
    args: [wallet],
  });

  return { deposits, pendingWithdrawals, pendingShares };
}
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| EigenLayer M1 (single-strategy entry; pre-restaking pause) | M2 / v1.12 (multi-strategy, full deposit/withdrawal flow, AVS slashing) | April 2024 mainnet unpause + Q4 2024 v1.12 upgrade | Phase 31 ships against M2/v1.12 exclusively. M1 surface explicitly out of scope. |
| EigenLayer LST caps (200k ETH per protocol) | Caps permanently removed | April 16, 2024 | D-06 pre-flight stays as defense-in-depth; in steady state always returns "no cap". |
| Rocket Pool deposit pool v1.1 | RocketDepositPool v1.2 | 2023 | Phase 31 targets v1.2 proxy (`0xDD3f50F8...`) — v1.1 proxy `0x2cac916b...` is legacy and not in scope. |
| EigenLayer withdrawal: direct via StrategyManager | Queue-based via DelegationManager (M2) | M2 upgrade | `get_eigenlayer_positions.pendingWithdrawals` reads from queue; claim flow deferred to v2.x. |
| Ledger ERC-7730 registry (for Lido, Aave, Morpho) | Phase 30 Lido coverage CONFIRMED; Phase 31 EigenLayer + Rocket Pool NOT covered | Late 2024 - 2025 registry expansion | Phase 31 requires LEDGER NOTICE templates; v2.x backlog: submit metadata to LedgerHQ. |

**Deprecated/outdated:**
- EigenLayer M1 StrategyManager direct shares math (M2 uses sharesToUnderlyingView accessor instead).
- Hardcoded `withdrawalDelayBlocks: 50400` (governance-mutable; read dynamically).

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | RocketDAOProtocolSettingsDeposit proxy address must be resolved via RocketStorage at planning gate; commonly cited `0xac2245BE4C2C1E9752499Bcd34861B761d62fC27` is training-data only. | Topic 1 + Topic 3 | Wrong address → `getMinimumDeposit()` read fails → falls back to hardcoded 0.01 ETH (low-impact since fallback is correct value; main risk is if the contract changes the min in the future and the read fails silently). Planner MUST verify at Plan 31-01 acceptance. |
| A2 | Per-LST underlying token addresses for cbETH (`0xBe9895146f7AF43049ca1c1AE358B0541Ea49704`), ETHx (`0xA35b1B31Ce002FBF2058D22F30f95D405200A15b`), wBETH (`0xa2E3356610840701BDf5611a53974510Ae27E2e1`), sfrxETH (`0xac3E018457B222d93114458476f3E3416Abbe38F`), mETH (`0xd5F7838F5C461fefF7FE49ea5ebaF7728bB0ADfa`) are from training knowledge. | Topic 1 + Topic 3 | Wrong LST token → user approves wrong contract → approval pre-flight passes but on-chain deposit reverts. Planner MUST verify each via direct `Strategy.underlyingToken()` view call at Plan 31-01 acceptance. |
| A3 | `DelegationManager.getQueuedWithdrawals(staker)` is the canonical accessor on the current mainnet deployment and returns the documented `(Withdrawal[], uint256[][])` shape. | Topic 5 | Wrong ABI → silent garbage decode in `get_eigenlayer_positions.pendingWithdrawals`. Researcher confirms at planning gate via live on-chain call or DelegationManager Etherscan source. |
| A4 | RocketStorage canonical address is `0x1d8f8f00cfa6758d7bE78336684788Fb0ee0Fa46`. | Topic 1 | Wrong RocketStorage → can't resolve settings address. Only matters if Option B (dynamic resolution) is chosen; Option A (hardcode resolved address) makes this moot. |
| A5 | EigenLayer + Rocket Pool will NOT have ERC-7730 clear-sign coverage added by the time Phase 31 ships. | Topic 8 | If coverage IS added before Phase 31 deploys, the LEDGER NOTICE blocks become misleading. Mitigation: planner re-checks registry at Plan 31-02 acceptance; if coverage exists, remove the affected NOTICE template per Phase 30 Lido precedent. |
| A6 | The curated EigenLayer registry set (stETH/rETH/cbETH/ETHx/wBETH/sfrxETH/mETH = 7 strategies) is the right cardinality. Could prune to 5 (drop mETH + sfrxETH) or expand to 8 (add ankrETH). | Topic 1 | Wrong curation → some users can't access their desired strategy. Mitigation: `INVALID_INPUT + hintTool → request_capability` for off-list; user can request expansion. |
| A7 | EigenLayer minimum withdrawal delay is `DelegationManager.minWithdrawalDelayBlocks() = 50400 blocks` (≈7 days for LSTs). | Topic 5 | Wrong delay → `claimableAfterBlock` field is off. Surface as best-effort estimate; read dynamically per Topic 5 recommendation. |
| A8 | `rocketpool.js` and `@eigenlabs/eigensdk-js` SDK packages exist on npm (cited as "alternatives considered" but rejected). Phase 31 doesn't use them; the existence claim is from general knowledge. | Standard Stack | Low-impact assumption — Phase 31 ships without them either way. |

**If this table is empty:** N/A — all assumptions above are flagged for planner verification.

---

## Open Questions

1. **EigenLayer curated registry cardinality (5, 6, 7, or 8 LSTs?)**
   - What we know: 12 strategies deployed; top by TVL are stETH + rETH + cbETH + wBETH + sfrxETH; mETH and ETHx are growing; ankrETH/oETH/osETH/swETH/lsETH are lower-TVL.
   - What's unclear: which exact 5-8 belong in the curated set as of planning time.
   - Recommendation: Default to 7 (stETH/rETH/cbETH/ETHx/wBETH/sfrxETH/mETH). Plan-checker can pin this at planning gate by ranking via Defillama TVL snapshot.

2. **RocketDAOProtocolSettingsDeposit proxy address**
   - What we know: resolved internally via RocketStorage.getAddress lookup.
   - What's unclear: the exact current proxy address (training data cites `0xac2245BE...` but unverified).
   - Recommendation: Plan 31-01 acceptance criterion: planner runs a one-shot RocketStorage lookup and commits the address as a `getAddress(...)`-wrapped literal.

3. **`DelegationManager.getQueuedWithdrawals` exact ABI shape across M2 upgrades**
   - What we know: function exists; returns `(Withdrawal[], uint256[][])`.
   - What's unclear: whether the `Withdrawal` struct has exactly the 7 fields documented at research time, or has been extended.
   - Recommendation: Confirm at planning gate via Etherscan source read of the live mainnet DelegationManager proxy.

4. **Per-LST conversion rate sources for `ethEquivalent` in get_eigenlayer_positions**
   - What we know: stETH = 1:1; rETH = `getExchangeRate()`; cbETH = `exchangeRate()`; wBETH = `exchangeRate()`.
   - What's unclear: exact accessor names + ABI for ETHx, sfrxETH, mETH conversion rates.
   - Recommendation: Phase 31 D-11 ships `ethEquivalent` with `approx: true` flag. If exact rates are too complex to ship per-LST, return raw underlying amount + `approx: true` and let agent + user interpret.

5. **Should the `slashing-risk informational line` in CHECKS PERFORMED be expanded to mention specific operator-delegation flow deferred status?**
   - What we know: D-10 sets the verbatim template; Phase 31 ships deposit-only.
   - What's unclear: whether agent UX is improved by a longer caveat.
   - Recommendation: Ship D-10 template verbatim; defer expansion to v2.x.

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Ethereum mainnet RPC | EigenLayer + Rocket Pool reads + pre-flights | ✓ | — | Existing PublicNode fallback per `src/chains/registry.ts` (Phase 8) |
| `viem` package | All encoding + decoding | ✓ | 2.48.11 | — |
| Ledger Ethereum app | Send-time signing | (verify-phase only) | ≥ 1.10.x recommended | Demo mode for testing pre-Ledger |

**Missing dependencies with no fallback:** None — Phase 31 ships against existing project infrastructure.
**Missing dependencies with fallback:** RocketDAOProtocolSettingsDeposit on-chain read falls back to hardcoded `ROCKET_POOL_MINIMUM_DEPOSIT_FALLBACK_WEI = 1e16` per D-07.

---

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest (per CLAUDE.md tech stack) |
| Config file | `vitest.config.ts` |
| Quick run command | `npm test -- --run <pattern>` |
| Full suite command | `npm test` (or `npx vitest run`) |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| EIG-01 | `get_eigenlayer_positions` returns deposits + pendingWithdrawals | unit | `npx vitest run test/get-eigenlayer-positions.test.ts` | ❌ Wave 0 (new file Plan 31-02) |
| EIG-02 | `prepare_eigenlayer_deposit` produces `depositIntoStrategy` calldata + approval pre-flight + cap pre-flight | unit | `npx vitest run test/prepare-eigenlayer-deposit.test.ts` | ❌ Wave 0 (new file Plan 31-02) |
| RP-01 | `get_rocketpool_positions` returns rETH balance + exchange rate + ETH equivalent | unit | `npx vitest run test/get-rocketpool-positions.test.ts` | ❌ Wave 0 (new file Plan 31-03) |
| RP-02 (stake) | `prepare_rocketpool_stake` produces `deposit()` calldata + min-deposit pre-flight | unit | `npx vitest run test/prepare-rocketpool-stake.test.ts` | ❌ Wave 0 (new file Plan 31-03) |
| RP-02 (unstake) | `prepare_rocketpool_unstake` produces `burn(uint256)` calldata + pool-liquidity pre-flight | unit | `npx vitest run test/prepare-rocketpool-unstake.test.ts` | ❌ Wave 0 (new file Plan 31-03) |
| (cross-cutting) | Fixtures Z/AA/AB byte-identity | unit | `npx vitest run test/signing-fingerprint.test.ts` | ✅ EXTEND existing |
| (cross-cutting) | SOT cross-view byte-identity (T-EIGENLAYER-SPENDER-DRIFT-1 + T-ROCKETPOOL-SPENDER-DRIFT-1) | unit | `npx vitest run test/config-contracts.test.ts` | ✅ EXTEND existing |
| (cross-cutting) | preview_send DECODED ARGS dispatch for Phase 31 selectors + LEDGER NOTICE emission | unit | `npx vitest run test/preview-send.eigenlayer-rocketpool.test.ts` | ❌ Wave 0 (new file) |
| (cross-cutting) | Full lifecycle persona-cycle byte-identity | integration | `npx vitest run test/eigenlayer-rocketpool-lifecycle.integration.test.ts` | ❌ Wave 0 (new file) |
| (cross-cutting) | Canonical-dispatch allowlist refusal for off-allowlist target | unit | `npx vitest run test/canonical-dispatch.test.ts` | ✅ EXTEND existing |

### Sampling Rate
- **Per task commit:** `npm test -- --run <file_for_that_task>` — quick single-file check.
- **Per wave merge:** `npm test -- --run test/prepare-eigenlayer test/prepare-rocketpool test/protocols-eigenlayer test/protocols-rocketpool` — protocol slice.
- **Phase gate:** `npm test` (full suite) green before `/gsd-verify-work`.

### Wave 0 Gaps
- [ ] `test/protocols-eigenlayer.test.ts` — covers EIG-02 (ABI selectors + encoder round-trips)
- [ ] `test/protocols-rocketpool.test.ts` — covers RP-02 (ABI selectors + encoder round-trips + selector-collision guards)
- [ ] `test/signing-eigenlayer-shares.test.ts` — covers EIG-01 (shares↔underlying math)
- [ ] `test/signing-rocketpool-rate.test.ts` — covers RP-01 (rETH↔ETH math)
- [ ] `test/get-eigenlayer-positions.test.ts` — covers EIG-01 (read + queue aggregation)
- [ ] `test/get-rocketpool-positions.test.ts` — covers RP-01 (balance + rate read)
- [ ] `test/prepare-eigenlayer-deposit.test.ts` — covers EIG-02 (prepare + pre-flights + LEDGER NOTICE)
- [ ] `test/prepare-rocketpool-stake.test.ts` — covers RP-02 (prepare + min-deposit + LEDGER NOTICE)
- [ ] `test/prepare-rocketpool-unstake.test.ts` — covers RP-02 (prepare + liquidity + LEDGER NOTICE)
- [ ] `test/preview-send.eigenlayer-rocketpool.test.ts` — DECODED ARGS dispatch + LEDGER NOTICE emission
- [ ] `test/eigenlayer-rocketpool-lifecycle.integration.test.ts` — full cycle persona-byte-identity

Framework install: not needed; vitest already in project.

---

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes | Inherited from Phase 3 WalletConnect pairing + Phase 5 demo persona auth |
| V3 Session Management | yes | Inherited from `src/wallet/session-manager.ts` (PR #61 persistence + Phase 8 multi-chain widening) |
| V4 Access Control | partial | Phase 31 uses `resolveFrom` from `src/signing/resolve-from.js` for sender resolution; canonical-dispatch allowlist (`CANONICAL_DISPATCH_TARGETS`) governs `to` validation |
| V5 Input Validation | yes | `parseAmountStrict` for decimal-string amounts; Zod-schema-equivalent JSON-schema input validation; LST symbol enum (curated registry) |
| V6 Cryptography | yes | `payloadFingerprint` keccak256 domain-tagged commit; `presignHash` EIP-1559 standard recompute; viem `encodeFunctionData` for ABI encoding (never hand-roll) |
| V7 Error Handling | yes | 21-code `errorCode` union FROZEN; `INVALID_INPUT + hintTool` for intent-vs-reality refusals (D-05 / D-06 / D-07 / D-08) |
| V11 Business Logic | yes | Approval pre-flight, cap pre-flight, min-deposit pre-flight, liquidity pre-flight — all enforced server-side at prepare time |
| V12 File Upload | no | Phase 31 has no file upload surface |
| V13 API | yes | MCP tool descriptions are "agent routing prompts" — CLAUDE.md convention; tool failure modes documented per `errorCode` union |
| V14 Configuration | yes | `src/config/contracts.ts` SOT discipline; format-fanout-sentinel `getAddress()` wrapping; T-EIGENLAYER-SPENDER-DRIFT-1 + T-ROCKETPOOL-SPENDER-DRIFT-1 cross-view regression |

### Known Threat Patterns for EigenLayer + Rocket Pool

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Malicious-LLM passes lookalike strategy address (e.g. `0x93c4b944... → 0x93c4b94g...`) | Tampering | Curated-LST enum schema (agent passes symbol, never raw address); server resolves from SOT registry |
| Malicious-LLM passes wrong LST token for chosen strategy | Tampering | Both (strategy, lstToken) resolved server-side from the same registry row; mismatch impossible by construction |
| Approval-front-run between approve and deposit (rebase + concurrent allowance consumption) | Tampering | Documented residual; surfaced in approval-pre-flight error message recommending "approve max"; cryptographic-binding chain unaffected |
| Rocket Pool pool drain race between prepare and send | Spoofing | D-08 best-effort pre-flight; on-chain revert is the backstop; user warned in CHECKS PERFORMED |
| EigenLayer cap re-introduction (governance event) | Tampering | Defensive cap pre-flight survives the governance event; refuses with INVALID_INPUT + hintTool: request_capability |
| Selector collision misroute (WETH9.deposit vs RocketDepositPool.deposit) | Tampering | Dispatch on `(tx.to, selector)` tuple; asserted in preview-send tests |
| Blind-sign attack (user character-mismatch the LEDGER BLIND-SIGN HASH) | Spoofing | LEDGER NOTICE block surfaces blind-sign expectation; user must visually compare hashes character-for-character; cryptographic anchor at the device |
| FROZEN-area drift (someone touches `send_transaction.ts` three-gate region) | Tampering | Zero-diff assertion against `origin/main` in Phase 31 success criteria; Phase 31 is additive only |
| Coordinated-agent compromise (args manipulation + output filter) | Tampering | Documented residual; v1.3 `get_verification_artifact` provides second-LLM cross-check; PREPARE RECEIPT block bypasses agent natural-language retelling |

---

## Sources

### Primary (HIGH confidence)
- viem 2.48.11 `toFunctionSelector` executed locally — all selectors VERIFIED (`0xe7a050aa`, `0xd0e30db0`, `0x42966c68`, `0x035cf142`, `0x12065fe0`, `0xe6aa216c`, `0x8b32fa23`, `0x7a7e0d92`, `0x553ca5f8`, `0x7a8b2637`, `0x3a98ef39`, `0x5dd68579`, `0x2495a599`, `0x61b01b5d`, `0x43fe08b0`)
- Etherscan: [EigenLayer StrategyManager](https://etherscan.io/address/0x858646372cc42e1a627fce94aa7a7033e7cf075a) — proxy address VERIFIED
- Etherscan: [EigenLayer stETH-Strategy](https://etherscan.io/address/0x93c4b944D05dfe6df7645A86cd2206016c51564D) — underlying token = stETH VERIFIED
- Etherscan: [EigenLayer rETH-Strategy](https://etherscan.io/address/0x1BeE69b7dFFfA4E2d53C2a2Df135C388AD25dCD2) — underlying token = rETH VERIFIED
- Etherscan: [Rocket Pool rETH Token](https://etherscan.io/address/0xae78736cd615f374d3085123a210448e74fc6393) — `burn(uint256)` + `getExchangeRate()` + `getEthValue(uint256)` ABI VERIFIED
- Etherscan: [RocketDepositPool v1.2](https://etherscan.io/address/0xDD3f50F8A6CafbE9b31a427582963f465E745AF8) — `deposit()` payable + `getBalance()` view + RocketDAOProtocolSettingsDeposit internal call VERIFIED
- GitHub: [Layr-Labs/eigenlayer-contracts](https://github.com/Layr-Labs/eigenlayer-contracts) mainnet-addresses.config.json — 12 strategies + 5 core proxy addresses VERIFIED
- GitHub: [LedgerHQ/clear-signing-erc7730-registry](https://github.com/LedgerHQ/clear-signing-erc7730-registry/tree/master/registry) — NO eigenlayer/rocketpool directories VERIFIED (D-13 anchor)
- GitHub: [rocket-pool/rocketpool RocketTokenRETH.sol](https://github.com/rocket-pool/rocketpool/blob/master/contracts/contract/token/RocketTokenRETH.sol) — burn() function semantics VERIFIED
- Phase 30 RESEARCH.md — Lido SOT shape mirror; v/W/X/Y fixtures consumed; analog patterns
- `src/config/contracts.ts` lines 351-438 — Lido SOT structure (Phase 30) — direct read

### Secondary (MEDIUM confidence)
- [EigenLayer cap removal announcement (blog.eigencloud.xyz)](https://blog.eigencloud.xyz/unpausing-restaking-caps-on-april-16th/) — April 16, 2024 permanent cap removal
- [Rocket Pool documentation](https://docs.rocketpool.net/) — minimum deposit 0.01 ETH + protocol architecture
- [EigenLayer documentation - DelegationManager.md](https://github.com/Layr-Labs/eigenlayer-contracts/blob/main/docs/core/DelegationManager.md) — getQueuedWithdrawals accessor
- WebSearch verification: EigenLayer per-LST strategy addresses cross-verified against multiple sources

### Tertiary (LOW confidence)
- Training-knowledge per-LST underlying-token addresses for cbETH/ETHx/wBETH/sfrxETH/mETH — Assumption A2 flagged for planner verification
- Training-knowledge RocketDAOProtocolSettingsDeposit proxy address — Assumption A1 flagged for planner verification
- Training-knowledge RocketStorage canonical address `0x1d8f8f00cfa6758d7bE78336684788Fb0ee0Fa46` — Assumption A4 flagged

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — viem only; no new packages; selectors verified locally
- Architecture: HIGH — direct clone of Phase 30 Lido + 28 Compound patterns; project conventions clear
- Address SOT: HIGH for StrategyManager + DelegationManager + EigenLayer per-strategy proxies + RocketDepositPool + rETH; MEDIUM for per-LST underlying tokens (A2 flagged); MEDIUM for RocketDAOProtocolSettingsDeposit (A1 flagged)
- Selectors: HIGH (computed via viem locally)
- ABI fragments: HIGH for write surface; MEDIUM for `getQueuedWithdrawals` struct shape (A3 flagged)
- Pre-flight design: HIGH — patterns directly inherited from Phase 28 / 30
- ERC-7730 coverage gap: HIGH — directly verified via GitHub directory listing
- Fixture letter assignment: HIGH — Phase 30 V/W/X/Y consumed; Z/AA/AB sequential
- Pitfalls: HIGH — selector-collision + cap-overflow + rebase-allowance are direct from contract source reads
- v2.3 close-out scope: HIGH — Phase 27 SECURITY.md v2.1 template provides exact structure to mirror

**Research date:** 2026-05-23
**Valid until:** 2026-06-22 (30 days for stable protocols; re-verify A1 + A2 + A3 at planning gate within 7 days)

---

*Phase: 31-evm-eigenlayer-rocket-pool*
*Research output ready for `/gsd-plan-phase 31` consumption.*
