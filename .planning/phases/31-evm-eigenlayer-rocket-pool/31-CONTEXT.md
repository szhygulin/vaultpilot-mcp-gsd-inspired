# Phase 31: EigenLayer + Rocket Pool — Context

**Gathered:** 2026-05-23
**Status:** Ready for planning — auto-resolved via `--auto` per autonomous-phase-execution preference; recommended options grounded in prior-phase analogs (06/07/28/29/30).

Decisions in `<decisions>` are LOCKED per recommended-option selection; execute-time changes require replan.

<domain>
## Phase Boundary

User can:
1. **Deposit LST into EigenLayer** restaking — `StrategyManager.depositIntoStrategy(strategy, token, amount)` per supported LST strategy (curated registry).
2. **Read EigenLayer strategy-level deposits** — `get_eigenlayer_positions({ wallet })` returns per-strategy shares + ETH-equivalent value + pending queued withdrawals.
3. **Stake ETH on Rocket Pool** → mints rETH (`RocketDepositPool.deposit()` with `msg.value` = amount).
4. **Unstake rETH on Rocket Pool** → burns rETH for ETH (`rETH.burn(rethAmount)`).
5. **Read Rocket Pool positions** — `get_rocketpool_positions({ wallet })` returns rETH balance + current ETH-equivalent value via `rETH.getExchangeRate()`.

**Writes Ethereum-only.** No multi-chain reads (EigenLayer + Rocket Pool are Ethereum-mainnet-only protocols at v2.3 scope). Phase 31 closes the v2.3 milestone — also includes the v2.3 SECURITY.md milestone close-out summary section (per Phase 30 deferred D-13 carry-over).

</domain>

<decisions>
## Implementation Decisions

### Contract surface & SOT

- **D-01:** EigenLayer contracts sourced from `src/config/contracts.ts` via a per-chain `EigenLayerContracts` interface + flat getters (`getEigenLayerStrategyManagerAddress`, `getEigenLayerStrategyAddress(chainId, lst)`, `getEigenLayerDelegationManagerAddress`). Rocket Pool contracts sourced via a per-chain `RocketPoolContracts` interface + flat getters (`getRocketPoolDepositPoolAddress`, `getRocketPoolRethAddress`, `getRocketPoolDepositSettingsAddress`). Both mirror `getLidoStethAddress` (Phase 30) and `getMorphoBlueAddress` (Phase 29) SOT shape. Cross-view byte-identity tests: `T-EIGENLAYER-SPENDER-DRIFT-1` for StrategyManager and per-strategy entries against `KNOWN_SPENDERS_ETHEREUM`; `T-ROCKETPOOL-SPENDER-DRIFT-1` for RocketDepositPool + rETH against `KNOWN_SPENDERS_ETHEREUM`.
- **D-02:** Separate `src/protocols/eigenlayer.ts` and `src/protocols/rocketpool.ts` files. Each protocol owns its own decoder file — different contract surfaces, different write semantics (deposit vs stake/unstake), independent ABI sets. Matches Lido/Compound/Morpho one-file-per-protocol convention; EigenLayer + Rocket Pool are NOT one protocol despite shared milestone bundling.
- **D-03:** Ethereum-write-only enforcement — `prepare_eigenlayer_deposit` + `prepare_rocketpool_stake` + `prepare_rocketpool_unstake` refuse on non-Ethereum chains via existing `CHAIN_ID_MISMATCH` errorCode 15 (Phase 8 surface). Reads are also Ethereum-only by construction (no bridged variants in scope at v2.3).

### EigenLayer strategy targeting

- **D-04:** Curated EigenLayer strategy registry in `src/config/contracts.ts` — top-LST strategies by TVL at planning time (research-gate verification required). Candidate set: stETH-Strategy, rETH-Strategy, cbETH-Strategy, sfrxETH-Strategy, wBETH-Strategy, ETHx-Strategy, ankrETH-Strategy, swETH-Strategy, lsETH-Strategy, OETH-Strategy (researcher prunes to top 5-7 by current TVL + clear-sign availability). Long-tail strategies + native restaking (EigenPod) → `INVALID_INPUT + hintTool → request_capability` refusal (keeps the 21-code errorCode union FROZEN; mirrors Phase 28 intent-vs-reality pattern). The agent passes `{ strategy: "stETH" | "rETH" | … | <lst-symbol-or-strategy-address> }` — server resolves to canonical strategy address via the curated registry.
- **D-05:** LST-approval pre-flight for `prepare_eigenlayer_deposit` — server reads `LST.allowance(owner, StrategyManager)` at prepare time; if insufficient, refuses with `INVALID_INPUT + hintTool → prepare_token_approve` (Phase 28/30 intent-vs-reality pattern). Keeps the 21-code errorCode union FROZEN. The LST token contract is resolved per-strategy from the curated registry (e.g., stETH-Strategy → stETH proxy; rETH-Strategy → rETH; etc.).
- **D-06:** EigenLayer per-strategy deposit-cap pre-flight — server reads `Strategy.userUnderlyingView(strategy, owner)` + `Strategy.totalShares()` + `Strategy.maxTotalDeposits()` (if exposed) at prepare time. If amount would push the strategy past its cap, refuses with `INVALID_INPUT + hintTool → request_capability` (most caps lifted as of 2024 per EigenLayer governance; pre-flight surfaces a clear refusal if any strategy still gated). Researcher verifies which caps remain at planning time and whether the `maxTotalDeposits` ABI is the canonical accessor.

### Rocket Pool stake / unstake semantics

- **D-07:** `prepare_rocketpool_stake` is value-bearing (`msg.value` = ETH amount; no token approval needed). Server pre-flight reads `RocketDAOProtocolSettingsDeposit.getMinimumDeposit()` and refuses if `amount < minimum` with `INVALID_INPUT + hintTool → request_capability`. Current minimum is 0.01 ETH (per Rocket Pool governance, 2024) — researcher verifies + commits a hardcoded fallback constant in `src/config/contracts.ts` for resilience if the on-chain read fails (matches `WstETH.stEthPerToken` resilience pattern from Phase 30 D-09).
- **D-08:** `prepare_rocketpool_unstake` (rETH → ETH burn) deposit-pool-liquidity pre-flight — server reads `RocketDepositPool.getBalance()` (ETH liquidity available for burns) + `rETH.getEthValue(rethAmount)` (ETH equivalent of the burn amount) at prepare time. If burn-ETH exceeds pool liquidity, refuses with `INVALID_INPUT + hintTool → request_capability` (Phase 28 intent-vs-reality pattern). Surfaces a clear "deposit pool empty, swap rETH on a DEX instead" guidance line in CHECKS PERFORMED.

### Trust-pipeline shape

- **D-09:** No NFT-receipt block needed for any Phase 31 tool — EigenLayer deposits mint shares (ERC-20-style claim, no separate NFT); Rocket Pool stake mints rETH (ERC-20); Rocket Pool unstake burns rETH (ERC-20). Standard PREPARE RECEIPT + CHECKS PERFORMED + LEDGER NOTICE (if applicable per D-12) layout applies.
- **D-10:** EigenLayer slashing-risk informational line in CHECKS PERFORMED for `prepare_eigenlayer_deposit` (per CONTEXT placeholder § specifics). Verbatim template:
  ```
  - EigenLayer restaking: deposited LST shares are subject to slashing by AVS operators the user later delegates to. Phase 31 ships deposit only — operator delegation is a separate tool (deferred to v2.x). Informational; no enforcement gate.
  ```
  Non-load-bearing surface; no refusal arm.

### Reads & rebase accounting

- **D-11:** `get_eigenlayer_positions({ wallet })` returns:
  - `deposits: [{ strategy, lst, shares, underlyingAmount, ethEquivalent }]` (per-strategy entries via `StrategyManager.stakerStrategyShares(wallet, strategy)` + `Strategy.sharesToUnderlying(shares)`)
  - `pendingWithdrawals: [{ withdrawalRoot, strategy, shares, withdrawer, claimableAfterBlock }]` (queue surface via `DelegationManager.queuedWithdrawals(wallet)`; read-only — claim flow deferred to v2.x)
  - `totalEthEquivalent` (sum across strategies + pending; non-load-bearing aggregate; `approx: true` flag if any per-strategy ETH-equivalent uses a price feed instead of on-chain conversion)

  `get_rocketpool_positions({ wallet })` returns:
  - `rethBalance` (raw + human-units; rETH = 18 decimals)
  - `exchangeRate` (current rETH→ETH rate from `rETH.getExchangeRate()`; 1e18-scaled)
  - `ethEquivalent` (computed `rethBalance * exchangeRate / 1e18`)
  - `chain` (`"ethereum"` always)

  Pure-bigint math in `src/signing/eigenlayer-shares.ts` + `src/signing/rocketpool-rate.ts` (mirrors `src/signing/aave-health.ts` + `src/signing/lido-rebase.ts` pattern).

### Canonical-dispatch wiring

- **D-12:** Per-chain `CANONICAL_DISPATCH_TARGETS` (Phase 9) Ethereum arm extended for both protocols:
  - EigenLayer: `StrategyManager` + every per-strategy address in the curated registry (each strategy is a distinct dispatch target because `depositIntoStrategy` is called against the StrategyManager but the strategy address is the user-supplied param; if a future bug routes a deposit to a non-allowlisted strategy, `DISPATCH_TARGET_REFUSED` triggers).
  - Rocket Pool: `RocketDepositPool` + `rETH` (burn target). `RocketDAOProtocolSettingsDeposit` is a read-only contract (no dispatch target needed).
- **D-12a:** `KNOWN_SPENDERS_ETHEREUM` extended with: EigenLayer StrategyManager (the LST approval target for `prepare_eigenlayer_deposit`); Rocket Pool RocketDepositPool entry (label informational — stake is value-bearing, not approval-bearing; included for `preview_send` DECODED ARGS coverage in case of future approval-on-deposit-pool patterns); rETH (the burn target — informational label). All `address` fields delegate to the SOT getters (T-EIGENLAYER-SPENDER-DRIFT-1 + T-ROCKETPOOL-SPENDER-DRIFT-1 enforced by construction).

### Ledger clear-sign coverage (planning-time research item)

- **D-13:** Researcher MUST verify ERC-7730 registry coverage for:
  - `StrategyManager.depositIntoStrategy(strategy, token, amount)`
  - `RocketDepositPool.deposit()` (no-arg, value-bearing)
  - `rETH.burn(rethAmount)`

  If clear-sign coverage is confirmed for any subset, NO LEDGER NOTICE block for those tools (matches Phase 7 Aave + Phase 30 Lido precedent). If any tool falls back to blind-sign, emit LEDGER NOTICE block (matches Phase 6 WETH9.withdraw precedent). Research output anchors the planning-gate decision.

### Fixture letter assignment

- **D-14:** Phase 30 consumed V/W/X/Y. Phase 31 uses Z (singular EigenLayer fixture) then continues into two-letter wrap-around per researcher discretion at planning time (candidates: `AA`, `AB`; or `Z+1`, `Z+2`; or per-protocol naming `EIG-A`, `RP-A`, `RP-B`). Recommended scheme:
  - **Fixture Z** = `StrategyManager.depositIntoStrategy(strategy, token, amount)` — EigenLayer LST deposit
  - **Fixture AA** = `RocketDepositPool.deposit()` (no-arg, value-bearing — fixture captures `value` + empty calldata)
  - **Fixture AB** = `rETH.burn(rethAmount)` — Rocket Pool unstake
- Hardcoded `0x...` literals in `test/signing-fingerprint.test.ts` per CLAUDE.md cryptographic-binding fixture discipline. Cross-link from each consumer test (`test/prepare-eigenlayer-deposit.test.ts`, `test/prepare-rocketpool-stake.test.ts`, `test/prepare-rocketpool-unstake.test.ts`). Integration test re-anchors byte-identity across persona swaps (matches Phase 30 precedent).

### v2.3 milestone close-out

- **D-15:** Phase 31 includes the v2.3 SECURITY.md milestone close-out summary section (per Phase 30 deferred D-13 carry-over). Format mirrors v2.0 + v2.1 close-outs: §6 milestone summary line per phase (28/29/30/31) + invariant cross-references + residual-risk reaffirmation. Lands in the final Plan 31-03 commit (matches Phase 21 `SECURITY.md §6 v2.1 milestone close-out summary` pattern).

### Claude's Discretion

- Internal helper names (`EigenLayerReader`, `RocketPoolReader`, `parseEigenLayerStrategy`, `formatRocketPoolExchangeRate`, etc.)
- Whether `src/signing/eigenlayer-shares.ts` and `src/signing/rocketpool-rate.ts` ship as separate files or fold into their respective `src/protocols/*.ts` files (researcher/planner judgment; pure-math separation pattern from Aave/Compound/Lido is the default expectation)
- Whether plan structure is 3 plans (31-01: contracts.ts + dispatch + KNOWN_SPENDERS + EigenLayer + Rocket Pool slots in one wave; 31-02: EigenLayer reads + deposit; 31-03: Rocket Pool reads + stake + unstake) — matches the ROADMAP plan stub — vs. researcher proposes a different waveform after the research gate
- Exact list of EigenLayer strategies in the curated registry (D-04) — researcher prunes from the candidate set to top-by-TVL + clear-sign availability at planning time
- Whether `RocketDAOProtocolSettingsDeposit.getMinimumDeposit()` is the canonical minimum-deposit accessor or whether Rocket Pool exposes a more direct settings ABI (researcher verifies; D-07 hardcoded fallback constant is the resilience anchor regardless)

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project conventions

- `CLAUDE.md` — `src/config/contracts.ts` SOT discipline; fixture pinning rule; ESM spy-affordance indirection; decimal-aware arithmetic at agent boundary
- `.planning/PROJECT.md` — Project context; v2.3 milestone goals
- `.planning/REQUIREMENTS.md` §EIG-01/02 + §RP-01/02 — exact Phase 31 surface (READ this first; it's the authoritative requirement set)
- `.planning/ROADMAP.md` Phase 31 — phase goal, success criteria, plan stub
- `.planning/STATE.md` — current execution state

### Code analogs (mechanical clones expected)

- `src/protocols/lido.ts` (Phase 30) — multi-method single-protocol decoder with mixed value-bearing + ERC-20-shape calls; Phase 31 `src/protocols/eigenlayer.ts` mirrors for StrategyManager + per-strategy ABIs; `src/protocols/rocketpool.ts` mirrors for RocketDepositPool + rETH
- `src/protocols/aave-v3.ts` (Phase 7) — multi-tool protocol-decoder pattern with per-method selector + canonical-address getters
- `src/protocols/compound-v3.ts` (Phase 28) — per-protocol decoder with intent-vs-reality gates; Phase 31 inherits `INVALID_INPUT + hintTool` pattern for LST-approval pre-flight (D-05), strategy-cap pre-flight (D-06), minimum-deposit pre-flight (D-07), deposit-pool-liquidity pre-flight (D-08)
- `src/protocols/morpho-blue.ts` (Phase 29) — universal-contract single-file decoder; precedent for separate-file-per-protocol when contract surfaces differ
- `src/protocols/weth9.ts` (Plan 06-04) — value-bearing single-method decoder; Phase 31 `RocketDepositPool.deposit()` value-bearing pattern matches `WETH9.deposit()` shape
- `src/signing/aave-health.ts` (Phase 7) + `src/signing/compound-health.ts` (Phase 28) + `src/signing/lido-rebase.ts` (Phase 30) — pure-bigint math shape; Phase 31 `src/signing/eigenlayer-shares.ts` + `src/signing/rocketpool-rate.ts` clone
- `src/tools/prepare_lido_stake.ts` (Phase 30) — value-bearing prepare-tool shape; Phase 31 `prepare_rocketpool_stake.ts` mirrors structurally
- `src/tools/prepare_lido_wrap.ts` (Phase 30) — single-arg ERC-20-shape prepare-tool with approval pre-flight; Phase 31 `prepare_eigenlayer_deposit.ts` mirrors for the LST-approval pre-flight pattern
- `src/tools/prepare_weth_unwrap.ts` (Plan 06-04) — single-arg burn/withdraw tool with LEDGER NOTICE handling; precedent for D-13 fallback if Rocket Pool unstake falls back to blind-sign
- `src/tools/get_lido_positions.ts` (Phase 30) — multi-source on-chain read aggregation; Phase 31 `get_eigenlayer_positions` + `get_rocketpool_positions` mirror

### SOT extension points

- `src/config/contracts.ts` — extend with `EigenLayerContracts` interface + per-chain Ethereum slot; `RocketPoolContracts` interface + per-chain Ethereum slot; add EigenLayer StrategyManager + Rocket Pool RocketDepositPool + rETH entries to `KNOWN_SPENDERS_ETHEREUM`; reserve slot ordering for downstream v2.4 phases (Uniswap V3, Curve, prepare_custom_call) so v2.3 close-out doesn't churn the table.
- `src/security/canonical-dispatch.ts` — extend `CANONICAL_DISPATCH_TARGETS` Ethereum entry with EigenLayer StrategyManager + per-strategy addresses + Rocket Pool RocketDepositPool + rETH. Mirrors the Lido-arm filter pattern (Phase 30) — `address(0)` sentinels filtered out by construction.
- `src/signing/blocks.ts` — extend `DECODED ARGS` switch with EigenLayer + Rocket Pool selectors. NO new block-emit template needed (D-09: no NFT receipt; no operator-delegate complexity in Phase 31 scope).
- `SECURITY.md` — v2.3 milestone close-out summary section (§6 extension) per D-15.

### External references

- EigenLayer docs — https://docs.eigenlayer.xyz/
- EigenLayer M2 deployment manifest — https://github.com/Layr-Labs/eigenlayer-contracts (researcher MUST verify StrategyManager + DelegationManager + per-strategy addresses against the official manifest + Etherscan source verification)
- Rocket Pool docs — https://docs.rocketpool.net/
- Rocket Pool deployment manifest — https://docs.rocketpool.net/overview/contracts-integrations (researcher MUST verify RocketDepositPool + rETH + RocketDAOProtocolSettingsDeposit addresses against the official manifest)
- ERC-7730 registry — https://github.com/LedgerHQ/clear-signing-erc7730-registry — researcher verifies clear-sign coverage for `StrategyManager.depositIntoStrategy` + `RocketDepositPool.deposit` + `rETH.burn` (D-13)

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets

- **`src/protocols/lido.ts`** (Phase 30) — multi-method protocol decoder with mixed value-bearing + ERC-20-shape calls; Phase 31 EigenLayer + Rocket Pool decoders structurally clone.
- **`src/protocols/weth9.ts`** (Plan 06-04) — value-bearing single-method decoder; `RocketDepositPool.deposit()` clones structurally (no-arg, `msg.value` carries amount).
- **`src/signing/lido-rebase.ts`** (Phase 30) — pure-bigint shares ↔ assets conversion; `eigenlayer-shares.ts` clones for `Strategy.sharesToUnderlying`; `rocketpool-rate.ts` clones for `rETH.getExchangeRate` multiplication.
- **`src/clients/etherscan.ts`** (Phase 7) — single-chain by construction (per-chain plumbing FROZEN until v2.4 Phase 35 escape hatch); Phase 31 `check_contract_security` extension stays Ethereum-only.
- **`src/tools/get_lending_positions.ts`** (Phase 7) — multi-source aggregation with per-source `AbortController` 10s timeout; Phase 31 `get_eigenlayer_positions` follows for fanning across strategy address + DelegationManager queue read.
- **`CANONICAL_DISPATCH_TARGETS`** per-chain table — additive append for EigenLayer + Rocket Pool contracts. Mirror Lido-arm `address(0)` filter pattern.
- **`KNOWN_SPENDERS_ETHEREUM`** — additive entries for EigenLayer StrategyManager + Rocket Pool RocketDepositPool + rETH; researcher verifies slot ordering keeps existing Phase 6/7/28/29/30 entries byte-identical.

### Established Patterns

- **Mechanical-clone-of-prior-prepare** — `prepare_eigenlayer_deposit` clones `prepare_lido_wrap` (single ERC-20-amount call with approval pre-flight); `prepare_rocketpool_stake` clones `prepare_lido_stake` (value-bearing call); `prepare_rocketpool_unstake` clones `prepare_weth_unwrap` (single-arg burn-style call).
- **PREPARE RECEIPT verbatim relay** — every `prepare_*` includes the PREPARE RECEIPT block with verbatim agent args (CLAUDE.md rule).
- **`payloadFingerprint` re-check at send time** — Phase 4 trust pipeline; FROZEN-area.
- **Fixture hardcoded literals + cross-link from consumer tests** — CLAUDE.md cryptographic-binding rule; Z/AA/AB added in `test/signing-fingerprint.test.ts`.
- **Persona-cycle byte-identity integration test** — Phase 6/7/28/30 precedent; one combined test runs the full EigenLayer-deposit + RocketPool-stake + RocketPool-unstake cycle across personas with re-anchored fingerprints.
- **`INVALID_INPUT + hintTool` intent-vs-reality** — Phase 28/30 precedent; reused for LST-approval (D-05), strategy-cap (D-06), minimum-deposit (D-07), deposit-pool-liquidity (D-08).
- **`address(0)` sentinel filter in canonical-dispatch** — Phase 30 Lido-arm precedent; Phase 31 inherits for any future cross-chain extension (though v2.3 ships Ethereum-only).

### Integration Points

- **`src/server.ts` register-all** — additive imports for 5 new tools: `get_eigenlayer_positions`, `prepare_eigenlayer_deposit`, `get_rocketpool_positions`, `prepare_rocketpool_stake`, `prepare_rocketpool_unstake`.
- **`preview_send` selector dispatch** — extend with EigenLayer `depositIntoStrategy` + Rocket Pool `deposit` (value-bearing, empty calldata; preview handles via selector-absent branch) + rETH `burn` selectors so the DECODED ARGS block renders per-call.
- **`src/signing/blocks.ts`** — decoded-args extensions for EigenLayer + Rocket Pool selectors only (no new template — D-09).
- **`src/config/contracts.ts`** — per-chain EigenLayer + Rocket Pool SOT extensions; KNOWN_SPENDERS_ETHEREUM additive entries.
- **`src/security/canonical-dispatch.ts`** — Ethereum EigenLayer + Rocket Pool arm allowlist extension.
- **`SECURITY.md`** — v2.3 milestone close-out summary section (§6 extension) per D-15.

</code_context>

<specifics>
## Specific Ideas

- **EigenLayer restaking model** — user deposits an LST (stETH, rETH, etc.) into a strategy contract; the strategy is what AVS operators target for slashing rewards. Phase 31 ships deposit ONLY; the slashing-risk surfacing is informational in CHECKS PERFORMED (no enforcement — D-10). Operator delegation flow + queued-withdrawal claim flow deferred to v2.x backlog.
- **EigenLayer M1 → M2 migration** — EigenLayer's StrategyManager + DelegationManager were upgraded in 2024 (M2). Phase 31 ships against M2 deployment; M1 surface explicitly out of scope (research-gate verifies current canonical addresses).
- **Rocket Pool rETH is a non-rebasing receipt token** — value-per-share grows over time via `rETH.getExchangeRate()`. Both `get_rocketpool_positions` surfaces work off the live exchange rate; balance and ETH-equivalent are both surfaced (D-11).
- **`RocketDepositPool.deposit()`** is value-bearing with no calldata args — the function reads `msg.value` and credits the sender. Fingerprint composition follows the same `value`-carrying pattern as `WETH9.deposit` (Plan 06-04) — preview decoded-args path renders "Stake ETH on Rocket Pool — receive rETH" without per-arg breakdown since there are no calldata args.
- **`rETH.burn(rethAmount)`** is a single-arg ERC-20-shape call; selector matches the standard ERC-20 burn pattern but lives on the rETH contract specifically (NOT a generic ERC-20 burn-from-any-token surface).
- **Rocket Pool deposit pool can empty** — if `RocketDepositPool.getBalance()` is below the rETH→ETH conversion of the burn amount, the on-chain burn reverts. Server pre-flight (D-08) catches this with `INVALID_INPUT + hintTool → request_capability` BEFORE the user signs, surfacing "swap rETH on a DEX instead" guidance.
- **EigenLayer caps were lifted in 2024** but the pre-flight (D-06) is defense-in-depth — if a strategy is re-gated (regulatory + risk events have re-gated strategies historically), the pre-flight surfaces a clear refusal before the user signs.
- **No multi-chain reads** — EigenLayer + Rocket Pool are Ethereum-mainnet-only at v2.3. Unlike Phase 30 Lido (which had Arbitrum bridged-read variants), Phase 31 stays single-chain. Future v2.x demand could surface bridged variants via the `BRIDGED_VARIANTS` Phase 8 surface.

</specifics>

<deferred>
## Deferred Ideas

- **`prepare_eigenlayer_delegate` + `_undelegate`** — operator-delegation flow for slashing-reward claim. Deferred to v2.x backlog. Anchor: `DelegationManager.delegateTo(operator, ...)` + `DelegationManager.undelegate(...)`.
- **`prepare_eigenlayer_claim_withdrawal`** — queued-withdrawal NFT-claim flow once unstake settles (EigenLayer queue-based withdrawal post-Holesky upgrade). Surface in `get_eigenlayer_positions.pendingWithdrawals` (D-11); defer claim flow to v2.x.
- **EigenLayer EigenPod (native ETH restaking)** — non-LST restaking via user-deployed EigenPod contracts. Out of scope; v2.x demand-driven.
- **Long-tail EigenLayer strategies** — strategies beyond the curated registry (D-04). Surface via `INVALID_INPUT + hintTool → request_capability`; expansion of the registry is v2.x demand-driven.
- **Rocket Pool node-operator deposits** (16 ETH minipool, 8 ETH atlas-minipool) — niche operational flow. Out of scope per CONTEXT placeholder.
- **Rocket Pool rETH↔ETH DEX-fallback automation** — if D-08 deposit-pool liquidity check fails, today we surface a hint. Future ergonomics surface could route through Uniswap V3 (Phase 32) for an atomic alternative. Deferred until v2.4 Uniswap surface lands.
- **Cross-chain rETH bridging** — rETH exists on multiple L2s (Arbitrum + Optimism + Base + Polygon zkEVM via Layer Zero OFT-style bridges). Phase 31 reads + writes Ethereum-only; bridge tools live in v2.6 BRIDGE-T1.
- **Other LSTs as EigenLayer strategies beyond the curated set** — strategies are open-set; the registry is curated. Long-tail entry adds via demand-driven v2.x phases.
- **EigenLayer rewards claim (post-AVS-launch)** — once AVS slashing rewards become claimable (post-mainnet AVS launch in 2024-2025), a `prepare_eigenlayer_claim_rewards` tool would extend the surface. Deferred until AVS rewards production-launch is confirmed.

</deferred>

---

*Phase: 31-evm-eigenlayer-rocket-pool*
*Context gathered: 2026-05-23 (auto-mode; recommended-option selection grounded in Phases 06/07/28/29/30 analogs)*
