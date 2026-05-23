# Phase 31: EigenLayer + Rocket Pool — Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-23
**Phase:** 31-evm-eigenlayer-rocket-pool
**Mode:** `--auto` (recommended-option selection per autonomous-phase-execution memory)
**Areas discussed:** Contract surface & SOT, EigenLayer strategy targeting, Rocket Pool stake/unstake semantics, Trust-pipeline shape, Reads & accounting, Canonical-dispatch wiring, Ledger clear-sign coverage, Fixture letter assignment, v2.3 milestone close-out

---

## Contract surface & SOT

| Option | Description | Selected |
|--------|-------------|----------|
| Per-chain `EigenLayerContracts` + `RocketPoolContracts` interfaces with flat getters | Mirrors Phase 30 Lido SOT shape; cross-view byte-identity tests against `KNOWN_SPENDERS_ETHEREUM` | ✓ |
| Single combined `EigenStakeContracts` umbrella | Bundles two protocols into one type for milestone bundling — but they're different protocols with different ABIs | |
| Inline addresses at protocol-decoder sites | Violates CLAUDE.md SOT discipline | |

**Selection rationale:** Phase 30 Lido SOT shape is the proven pattern for multi-contract per-protocol SOT. EigenLayer + Rocket Pool are separate protocols sharing a milestone — each gets its own interface.

---

## Protocol file organization

| Option | Description | Selected |
|--------|-------------|----------|
| Separate `src/protocols/eigenlayer.ts` + `src/protocols/rocketpool.ts` | Different protocols, different contract surfaces, different write semantics | ✓ |
| Combined `src/protocols/restaking.ts` | Single file for two protocols sharing a milestone — but Lido/Compound/Morpho convention is one-file-per-protocol | |

**Selection rationale:** Mirrors `src/protocols/lido.ts` / `compound-v3.ts` / `morpho-blue.ts` convention. Milestone bundling ≠ protocol consolidation.

---

## Chain scope (writes)

| Option | Description | Selected |
|--------|-------------|----------|
| Ethereum-only via existing `CHAIN_ID_MISMATCH` errorCode 15 | EigenLayer + Rocket Pool are Ethereum-mainnet-only protocols at v2.3 scope; matches Phase 30 D-03 | ✓ |
| Multi-chain via bridged variants (Arbitrum + Optimism + Base) | rETH exists on L2s via OFT bridges — but bridged variants are read-only and out of v2.3 scope | |

**Selection rationale:** v2.3 requirements explicitly Ethereum-only per REQUIREMENTS.md §EIG/RP and ROADMAP Phase 31 success criteria.

---

## EigenLayer strategy targeting

| Option | Description | Selected |
|--------|-------------|----------|
| Curated strategy registry (top 5-7 LSTs) + long-tail `INVALID_INPUT + hintTool → request_capability` refusal | Mirrors Phase 28/30 intent-vs-reality pattern; keeps 21-code errorCode union FROZEN; researcher prunes set at planning time | ✓ |
| Accept any strategy address with `[UNKNOWN STRATEGY]` warn block | Looser surface — but lets the user deposit into untested strategies without protocol-aware coverage | |
| Hardcoded single-strategy support (stETH-Strategy only) | Too restrictive; rETH-Strategy + cbETH-Strategy are mainstream | |

**Selection rationale:** Curated registry is the proven Phase 28 (CompoundCometsByChain) + Phase 30 (Lido) pattern. Long-tail expansion via `request_capability` keeps the surface controllable.

---

## EigenLayer LST-approval pre-flight

| Option | Description | Selected |
|--------|-------------|----------|
| Server pre-flight reads `LST.allowance(owner, StrategyManager)`; refuses with `INVALID_INPUT + hintTool → prepare_token_approve` if insufficient | Phase 28/30 intent-vs-reality pattern; keeps 21-code errorCode union FROZEN | ✓ |
| No pre-flight — let on-chain revert surface to the user via the Ledger device | Worse UX; user signs a transaction that will revert | |

**Selection rationale:** Server-side pre-flight is the established v2.3 pattern (Phase 28 Compound supply, Phase 30 Lido wrap + unstake).

---

## EigenLayer strategy-cap pre-flight

| Option | Description | Selected |
|--------|-------------|----------|
| Server reads `Strategy.maxTotalDeposits()` / `totalShares()` at prepare time; refuses if amount would exceed cap | Defense-in-depth — most caps lifted as of 2024 but if re-gated (regulatory/risk events have re-gated historically), pre-flight surfaces clear refusal | ✓ |
| No cap check — assume caps are permanently lifted | Brittle; EigenLayer governance retains cap-setting authority | |

**Selection rationale:** Defense-in-depth aligns with the "fail-safe defaults" project security posture.

---

## Rocket Pool stake — value-bearing semantics

| Option | Description | Selected |
|--------|-------------|----------|
| Value-bearing `RocketDepositPool.deposit()` with no calldata args + minimum-deposit pre-flight via `getMinimumDeposit()` + hardcoded fallback constant | Mirrors `WETH9.deposit` shape (Plan 06-04); on-chain settings read with resilience fallback (Phase 30 D-09 pattern) | ✓ |
| Value-bearing call with no minimum-deposit pre-flight | Worse UX — user signs a sub-minimum transaction that reverts | |

**Selection rationale:** Pre-flight + fallback constant is the resilient pattern.

---

## Rocket Pool unstake — deposit-pool-liquidity pre-flight

| Option | Description | Selected |
|--------|-------------|----------|
| Server reads `RocketDepositPool.getBalance()` + `rETH.getEthValue(rethAmount)`; refuses with `INVALID_INPUT + hintTool → request_capability` if burn-ETH exceeds pool liquidity | Surfaces clear "swap rETH on a DEX instead" guidance; matches Phase 28 intent-vs-reality pattern | ✓ |
| No liquidity check — let on-chain revert surface | Worse UX; user signs a revert | |

**Selection rationale:** Pre-flight + DEX-fallback hint is the user-respectful pattern.

---

## Trust-pipeline block emit shape

| Option | Description | Selected |
|--------|-------------|----------|
| No new block templates — standard PREPARE RECEIPT + CHECKS PERFORMED + LEDGER NOTICE (if applicable) | EigenLayer shares + rETH are ERC-20-style claims, no NFT receipt; no new block surface needed | ✓ |
| Custom `[STRATEGY DEPOSIT]` block surfacing AVS-slashing-risk panel | Over-templating — slashing-risk fits as a CHECKS PERFORMED line (D-10), not a new block | |

**Selection rationale:** Minimum block surface; informational slashing-risk as a CHECKS PERFORMED line.

---

## Slashing-risk surfacing

| Option | Description | Selected |
|--------|-------------|----------|
| Informational CHECKS PERFORMED line on `prepare_eigenlayer_deposit`; no enforcement gate | Per CONTEXT placeholder § specifics; surfaces the risk to the user without blocking the deposit flow | ✓ |
| Enforcement gate requiring `acknowledgeSlashingRisk: true` param | Over-engineering; deposit-only is informational scope at v2.3 | |
| No surfacing | Loses an opportunity to inform the user about restaking risk | |

**Selection rationale:** Informational surface respects the user without paternalizing.

---

## Reads & rebase accounting

| Option | Description | Selected |
|--------|-------------|----------|
| EigenLayer reads via `StrategyManager.stakerStrategyShares` + per-strategy `Strategy.sharesToUnderlying` + `DelegationManager.queuedWithdrawals` (pending surface, no claim flow); Rocket Pool reads via `rETH.balanceOf` + `rETH.getExchangeRate` | Standard on-chain accessor pattern; pending-withdrawal surface lets the agent inform the user without requiring v2.x claim flow | ✓ |
| EigenLayer reads via subgraph indexer | Adds an external dependency; on-chain reads are sufficient for v2.3 scope | |
| Skip pending-withdrawal surface | Loses informational value | |

**Selection rationale:** On-chain reads + pending-withdrawal surface = sufficient at v2.3; claim flow deferred to v2.x cleanly.

---

## Canonical-dispatch wiring

| Option | Description | Selected |
|--------|-------------|----------|
| StrategyManager + per-strategy addresses (each is a distinct dispatch target) + RocketDepositPool + rETH all added to Ethereum allowlist | Defense-in-depth — if a future bug routes to a non-allowlisted address, `DISPATCH_TARGET_REFUSED` triggers | ✓ |
| StrategyManager + RocketDepositPool + rETH only (strategies dispatch through StrategyManager) | Less defensive — a bug that bypasses StrategyManager would dispatch directly to a strategy contract | |

**Selection rationale:** Every distinct write-target gets a dispatch entry. Defense-in-depth.

---

## Ledger clear-sign coverage

| Option | Description | Selected |
|--------|-------------|----------|
| Research-gate ERC-7730 registry coverage at planning time; LEDGER NOTICE block emitted only for blind-sign tools | Mirrors Phase 7 Aave + Phase 30 Lido precedent; informational pattern | ✓ |
| Assume blind-sign for all 3 tools (LEDGER NOTICE block on every prepare_*) | Pessimistic; if ERC-7730 coverage exists, the LEDGER NOTICE is noise | |
| Skip notice entirely; assume clear-sign | Optimistic; if any tool falls back, the user is uninformed | |

**Selection rationale:** Research-gate decision is the right pattern — actual coverage drives the block decision.

---

## Fixture letter assignment

| Option | Description | Selected |
|--------|-------------|----------|
| Z (singular EigenLayer fixture) + AA + AB (two-letter wrap-around for Rocket Pool stake + unstake) | Natural alphabetical continuation from Phase 30's V/W/X/Y; alphabetical-by-protocol-order | ✓ |
| Numeric Z1 / Z2 / Z3 | Breaks the single-letter convention | |
| Per-protocol naming (EIG-A / RP-A / RP-B) | Breaks the alphabetical-by-phase fixture cadence; harder to cross-reference | |

**Selection rationale:** Letter-pair wrap-around is the cleanest convention; researcher may suggest a different scheme at planning gate if there's a stronger reason.

---

## v2.3 milestone close-out

| Option | Description | Selected |
|--------|-------------|----------|
| Phase 31 includes the v2.3 SECURITY.md milestone close-out summary section (§6 extension); lands in the final Plan 31-03 commit | Mirrors Phase 21 v2.1 close-out pattern; carries over Phase 30 deferred D-13 | ✓ |
| Separate close-out phase (31.5 or v2.3-CLOSE-01) | Adds a phase for what's a single SECURITY.md edit; over-engineering | |
| Skip the close-out — let v2.3 verify-phase produce it | Verify-phase produces VERIFICATION.md, not SECURITY.md milestone summary | |

**Selection rationale:** Single-commit close-out section in Plan 31-03 is the established milestone-close pattern.

---

## Claude's Discretion

- Internal helper names (`EigenLayerReader`, `RocketPoolReader`, etc.)
- Whether `src/signing/eigenlayer-shares.ts` and `src/signing/rocketpool-rate.ts` ship as separate files or fold into their respective `src/protocols/*.ts` files
- Whether plan structure is 3 plans (matches ROADMAP plan stub) vs. researcher proposes a different waveform after the research gate
- Exact list of EigenLayer strategies in the curated registry — researcher prunes from candidate set to top-by-TVL + clear-sign availability at planning time
- Whether `RocketDAOProtocolSettingsDeposit.getMinimumDeposit()` is the canonical minimum-deposit accessor or whether Rocket Pool exposes a more direct settings ABI

## Deferred Ideas

- `prepare_eigenlayer_delegate` + `_undelegate` (operator delegation) — v2.x backlog
- `prepare_eigenlayer_claim_withdrawal` (queued-withdrawal claim flow) — v2.x; reads surface pending in Phase 31
- EigenLayer EigenPod (native ETH restaking) — v2.x demand-driven
- Long-tail EigenLayer strategies beyond curated registry — v2.x via `request_capability`
- Rocket Pool node-operator deposits (minipool 16/8 ETH) — out of scope; niche operational flow
- Rocket Pool rETH↔ETH DEX-fallback automation — deferred until v2.4 Uniswap V3 surface lands
- Cross-chain rETH bridging — v2.6 BRIDGE-T1
- Other LSTs as EigenLayer strategies beyond curated set — v2.x demand-driven
- EigenLayer rewards claim (post-AVS-launch) — deferred until AVS rewards production-launch confirmed
