# Phase 32: Uniswap V3 swap (auto-fee-tier, same-chain) — Context

**Gathered:** 2026-05-23
**Status:** Ready for planning — auto-resolved via `--auto` per autonomous-phase-execution preference; recommended options grounded in prior-phase analogs (Phase 14 Jupiter swap sandwich-MEV gate, Phase 20 SunSwap V2 same-chain DEX swap, Phase 28 Compound V3 intent-vs-reality gates, Phase 31 EigenLayer + Rocket Pool protocol-decoder convention).

Decisions in `<decisions>` are LOCKED per recommended-option selection; execute-time changes require replan.

<domain>
## Phase Boundary

User can:
1. **Quote a Uniswap V3 swap** — `get_uniswap_quote({ chain, tokenIn, tokenOut, amount, slippageBps? })` returns the best-output fee tier, route plan (single-hop vs multi-hop), `outAmount`, `priceImpactBps`, `slippageBps`.
2. **Prepare a Uniswap V3 swap** — `prepare_uniswap_swap({ chain, tokenIn, tokenOut, amount, slippageBps })` returns an unsigned SwapRouter02 transaction with auto-fee-tier selection (best output across 0.01% / 0.05% / 0.30% / 1.00% pools).
3. **Multi-hop routing** when single-hop quote has worse output — server iterates standard intermediate hops (WETH, USDC, USDT) via `Quoter V2.quoteExactInput(path)` and selects the best route.
4. **Sandwich-MEV defense** — default 50 bps slippage hint; refuses with `INVALID_INPUT + hintTool → get_uniswap_quote` when `priceImpactBps > 200` (2%) AND `slippageBps` not explicitly supplied.
5. **Native ETH support** — `tokenIn = "ETH"` accepted (server passes `msg.value` and uses WETH as routing token internally); `tokenOut = "ETH"` accepted (server wraps into a multicall: `exactInput(...)` + `unwrapWETH9(amountOutMin, recipient)`).

**Writes Ethereum-only by construction at Phase 32.** Other EVM chains (Arbitrum / Optimism / Polygon / Base) covered by Phase 8 `chain` parameter surface; per-chain SwapRouter02 + Quoter V2 addresses sourced from `src/config/contracts.ts` per-chain SOT extension at planning time. Per-L2 sandwich-MEV thresholds remain at 50bps/2% for v2.4 (per-chain calibration deferred to v2.6 Phase 40 MEV-01).

**LP verbs (UNI-04..09) are Phase 33.** Curve is Phase 34. Escape hatch is Phase 35.

</domain>

<decisions>
## Implementation Decisions

### Contract surface & SOT

- **D-01:** Uniswap V3 contracts sourced from `src/config/contracts.ts` via a per-chain `UniswapV3Contracts` interface + flat getters (`getUniswapV3SwapRouter02Address(chainId)`, `getUniswapV3QuoterV2Address(chainId)`, `getUniswapV3NonfungiblePositionManagerAddress(chainId)` — pre-populated with the canonical Ethereum mainnet address (`0xC36442b4a4522E871399CD717aBDD847Ab11FE88`) at Phase 32 per researcher recommendation, even though Phase 32 itself does not consume it; Phase 33 LP verbs read the existing slot without re-extending the SOT). Mirrors `getLidoStethAddress` (Phase 30) and `getEigenLayerStrategyManagerAddress` (Phase 31) SOT shape. Cross-view byte-identity test: `T-UNISWAP-V3-SPENDER-DRIFT-1` for SwapRouter02 + Quoter V2 against `KNOWN_SPENDERS_ETHEREUM` (which already carries `Uniswap V3 SwapRouter02` at `0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45` per Phase 6 ERC-20 lifecycle — Phase 32 promotes this entry to delegate-to-SOT-getter rather than inline literal).
- **D-02:** Separate `src/protocols/uniswap-v3.ts` decoder file. Owns SwapRouter02 ABI (`exactInputSingle`, `exactInput`, `unwrapWETH9`, `multicall(bytes[])`), Quoter V2 ABI (`quoteExactInputSingle`, `quoteExactInput`), and the path-bytes encoder (V3 packed path format: `address(20) ‖ uint24(3) ‖ address(20) ‖ uint24(3) ‖ address(20)`). Matches Lido/EigenLayer one-file-per-protocol convention; Quoter V2 + SwapRouter02 are one protocol despite contract split.
- **D-03:** `SwapRouter02` is the target (NOT UniversalRouter). UniversalRouter requires Permit2-signed typed data — defer until typed-data clear-sign lands (per ROADMAP.md UNI deferred note + REQUIREMENTS.md Permit2 carve-out). SwapRouter02 is the proven v3 router with full Ledger clear-sign coverage for `exactInputSingle` / `exactInput` per ERC-7730 registry (researcher MUST verify at planning gate; LEDGER NOTICE block emitted only if any selector falls back to blind-sign — Phase 6 WETH9.withdraw precedent).

### Quote + auto-fee-tier selection

- **D-04:** Quoter V2 (`0x61fFE014bA17989E743c5F6cB21bF9697530B21e` on Ethereum) is the quote source. Auto-fee-tier algorithm:
  1. For each of the 4 standard fee tiers (100 / 500 / 3000 / 10000), server calls `quoteExactInputSingle({ tokenIn, tokenOut, amountIn, fee, sqrtPriceLimitX96: 0 })` via `eth_call`. Tiers with no pool revert; server catches per-tier reverts as `null` outputs.
  2. If at least one tier returns a quote, select max `amountOut`. This is the single-hop best.
  3. Independently, server runs multi-hop quote: build path `tokenIn → 0.30% → WETH → 0.30% → tokenOut` (canonical WETH-anchored route) AND `tokenIn → 0.05% → USDC → 0.05% → tokenOut` (canonical stable-anchored route, when tokenIn/tokenOut both have USDC pools). Multi-hop fee-tier selection within the path uses a fixed canonical pair-to-fee-tier mapping (researcher determines at planning gate; e.g., WETH/USDC = 0.05%, WETH/USDT = 0.30%) — Phase 32 does NOT iterate multi-hop fee tiers (combinatorial blowup; deferred to v3.x algorithmic-routing surface).
  4. Multi-hop is selected over single-hop ONLY if `multiHopOut > singleHopOut * 1.005` (0.5% improvement threshold — accounts for the extra hop gas cost). Below threshold, single-hop wins (lower gas, lower slippage compounding).
  5. Return the winning route in the quote envelope (`route: { hops: [{ tokenIn, fee, tokenOut }, ...], strategy: "single-hop" | "multi-hop" }`).
- **D-04a:** Quote-revert handling: if ALL tiers + multi-hop routes revert (no liquidity for the pair), `get_uniswap_quote` returns `INVALID_INPUT + hintTool → request_capability` with the verbatim "no Uniswap V3 liquidity for {tokenIn}↔{tokenOut} at any standard fee tier; try a different DEX or check token symbols". Keeps the 21-code errorCode union FROZEN.
- **D-04b:** Price-impact computation: `priceImpactBps = ((amountIn * fairPrice - amountOut) / (amountIn * fairPrice)) * 10000` where `fairPrice = oracle midpoint`. Phase 32 SIMPLIFIED MIDPOINT: use the Quoter V2 output of a tiny-amount quote (`amountIn / 10000`, scaled back) as the impact-free fair price reference. Production-grade midpoint sourcing (Chainlink / TWAP / external oracle) deferred to v2.6 Phase 40 MEV-01 per-L2 calibration. Documented residual risk in SECURITY.md §6 v2.4 addendum: the Quoter-midpoint method understates impact on pools with concentrated liquidity at the spot tick; mitigation = sandwich-MEV refusal at >2% errs on the side of refusal.

### Swap preparation & calldata composition

- **D-05:** `prepare_uniswap_swap` calldata composition:
  - **Single-hop, no ETH-wrap:** `SwapRouter02.exactInputSingle(ExactInputSingleParams{ tokenIn, tokenOut, fee, recipient: user, amountIn, amountOutMinimum, sqrtPriceLimitX96: 0 })`.
  - **Multi-hop, no ETH-wrap:** `SwapRouter02.exactInput(ExactInputParams{ path: encodedPath, recipient: user, amountIn, amountOutMinimum })`.
  - **ETH-in (`tokenIn = "ETH"`):** server resolves to WETH for routing; calldata uses WETH as `tokenIn`; transaction `value = amountIn`; `recipient = user`. SwapRouter02 detects `msg.value > 0` and wraps via `WETH9.deposit()` internally.
  - **ETH-out (`tokenOut = "ETH"`):** server resolves to WETH for routing; calldata wraps in `multicall(bytes[]){ exactInputSingle(... recipient = address(router) ...), unwrapWETH9(amountOutMinimum, user) }`. The router holds WETH between the two sub-calls; `unwrapWETH9` sends ETH to user. Multicall surface anchored from Uniswap V3 docs; ABI in `src/protocols/uniswap-v3.ts`.
  - **ETH-in AND ETH-out simultaneously** — refused at quote time (semantically a no-op identity swap; surfaces as `INVALID_INPUT` with `same-token-swap-refused` hint).
- **D-06:** `amountOutMinimum = quotedAmountOut * (10000 - slippageBps) / 10000` (pure-bigint, computed server-side at prepare time). Default `slippageBps = 50` (0.5%); when `priceImpactBps > 200` AND `slippageBps` not explicitly passed, refuses per D-08.
- **D-07:** Token approval pre-flight — for non-ETH `tokenIn`, server reads `ERC20(tokenIn).allowance(user, SwapRouter02)` at prepare time. If insufficient, refuses with `INVALID_INPUT + hintTool → prepare_token_approve` (Phase 28 / Phase 30 / Phase 31 intent-vs-reality precedent). Keeps the 21-code errorCode union FROZEN. KNOWN_SPENDERS_ETHEREUM already carries SwapRouter02 (Phase 6) — label promoted to SOT-getter per D-01.

### Sandwich-MEV defense

- **D-08:** Sandwich-MEV gate at PREPARE time + at QUOTE time (mirror Phase 20 SunSwap):
  - At quote time (`get_uniswap_quote`): surface `priceImpactBps` verbatim + when `priceImpactBps > 200`, append warning string `⚠ Price impact ({impact}%) exceeds 2% sandwich-MEV threshold. Pass slippageBps explicitly to prepare_uniswap_swap to acknowledge.`
  - At prepare time (`prepare_uniswap_swap`): server re-fetches the quote (load-bearing — quote may have drifted between quote → prepare). If `priceImpactBps > 200` AND `slippageWasExplicit === false`, refuses with `INVALID_INPUT + sandwich-MEV` and a structured refusal block (clone `SANDWICH_MEV_REFUSAL_TRON_TEMPLATE` shape from `src/signing/blocks-tron.ts` into a new `SANDWICH_MEV_REFUSAL_ETHEREUM_TEMPLATE` in `src/signing/blocks.ts`; Ethereum-flavored copy — references "Uniswap V3" / "MEV bots" / `get_uniswap_quote`).
  - `slippageBps` upper bound: 10000 (100% — accept any output). Lower bound: 1 (0.01%). Below 1 → `INVALID_INPUT` ("slippage too low to clear pool fee"). Above 10000 → `INVALID_INPUT` ("slippage exceeds 100%").
- **D-08a:** Per-L2 thresholds — Phase 32 ships Ethereum-mainnet only at 50bps/2% (matches REQUIREMENTS.md MEV-01 default). When Phase 8 multi-chain surface activates the Arbitrum/Optimism/Polygon/Base arms, the same 50bps/2% default applies until v2.6 Phase 40 calibrates per-L2 thresholds via `src/config/sandwich-mev-thresholds.ts`. Phase 32 does NOT introduce that file — leave the SOT shape for Phase 40 to design.

### Route + deadline surfacing

- **D-09:** `CHECKS PERFORMED` block additions for `prepare_uniswap_swap`:
  - `Path: USDC → 0.05% → ETH` (single-hop)
  - `Path: USDC → 0.30% → ETH → 0.05% → WBTC` (multi-hop; arrow separates hops, fee-tier as middle node)
  - `amountIn: 100 USDC (decimal-resolved from user input "100")`
  - `amountOutMinimum: 0.0481 ETH (= quoted 0.04832 ETH − 0.5% slippage)`
  - `priceImpactBps: 23 (0.23%)`
  - `deadline: 2026-05-23T14:32:17Z (block.timestamp + 600s)`
- **D-10:** Deadline = `block.timestamp + 600` (10 minutes). Server reads `eth_getBlockByNumber("latest")`'s `timestamp` at prepare time. SwapRouter02 doesn't enforce deadline natively (deadline-enforcement is in the V1/V3 router; SwapRouter02 drops it for gas), but `multicall(deadline, bytes[])` overload provides it. Phase 32 wraps every swap calldata in `multicall(uint256 deadline, bytes[] data)` to preserve deadline enforcement — defense-in-depth against pending-tx replay if the user signs but doesn't broadcast immediately.

### Trust-pipeline shape

- **D-11:** Standard PREPARE RECEIPT + CHECKS PERFORMED + LEDGER NOTICE layout. (Researcher correction 2026-05-23: LEDGER NOTICE is UNCONDITIONAL for Phase 32 — ERC-7730 registry covers `exactInputSingle` + `exactInput` but does NOT cover `multicall(uint256,bytes[])` or `unwrapWETH9`. Because D-10 wraps EVERY swap in `multicall(deadline, [...])`, the outer selector `0x5ae401dc` is presented to the device — Ledger falls through to blind-sign. Phase 32 ships a new `LEDGER_NOTICE_UNISWAP_V3_TEMPLATE` block constant in `src/signing/blocks.ts`, emitted unconditionally on every `prepare_uniswap_swap` response. Matches Phase 6 WETH9.withdraw precedent — informational, not enforcement; user re-confirms calldata via `CHECKS PERFORMED` decoded args BEFORE signing.) New block-emit templates required: `LEDGER_NOTICE_UNISWAP_V3_TEMPLATE` + `SANDWICH_MEV_REFUSAL_ETHEREUM_TEMPLATE` (D-08).
- **D-12:** `payloadFingerprint` composition unchanged from Phase 4: `keccak256("VaultPilot-txverify-v1:" ‖ chainId ‖ to ‖ value ‖ data)`. `to = SwapRouter02 address` (sourced from D-01 SOT getter); `value = amountIn` when ETH-in, else `0`; `data = encoded multicall(deadline, [exactInputSingle(...)])` or equivalent per D-05. Re-checked at send time per FROZEN trust-pipeline rule (Phase 4 PREP-08).

### Canonical-dispatch wiring

- **D-13:** Per-chain `CANONICAL_DISPATCH_TARGETS` (Phase 9) Ethereum arm extended:
  - SwapRouter02 (`0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45`) — the dispatch target for every `prepare_uniswap_swap` call.
  - Quoter V2 (`0x61fFE014bA17989E743c5F6cB21bF9697530B21e`) — read-only; NOT added to dispatch targets (canonical dispatch gates send-path only).
  - Address resolution delegates to D-01 SOT getters. Mirrors the Lido-arm filter pattern (Phase 30) — `address(0)` sentinel filtered out by construction.
- **D-13a:** `KNOWN_SPENDERS_ETHEREUM` — SwapRouter02 entry promoted from inline literal (Phase 6) to delegate to `getUniswapV3SwapRouter02Address(1)` getter. Existing label "Uniswap V3 SwapRouter02" preserved byte-identically. Test `T-UNISWAP-V3-SPENDER-DRIFT-1` enforces. Quoter V2 NOT added (read-only; spender lookup is for approval-target labeling).

### Reads — none at Phase 32

- **D-14:** Phase 32 ships ONLY `get_uniswap_quote` (read-only price query) + `prepare_uniswap_swap` (write). No `get_uniswap_positions` (LP positions = Phase 33 UNI-04). No portfolio integration beyond the existing Phase 28-31 lending-position-style aggregation surface (Uniswap V3 LP positions land in Phase 33).

### Fixture letter assignment

- **D-15:** Phase 31 consumed Z, AA-RP, AB-RP (Rocket Pool protocol-prefix scheme; per Phase 31 D-14). Phase 32 adopts the protocol-prefix scheme:
  - **Fixture UNI-A** = `SwapRouter02.multicall(deadline, [exactInputSingle({ tokenIn: USDC, tokenOut: WETH, fee: 500, recipient: <persona>, amountIn: 100_000000, amountOutMinimum: 48_100_000_000_000_000, sqrtPriceLimitX96: 0 })])` — single-hop, no ETH-wrap, the canonical ERC-20-to-ERC-20 swap shape.
  - **Fixture UNI-B** = `SwapRouter02.multicall(deadline, [exactInputSingle({ tokenIn: USDC, tokenOut: WETH, fee: 500, recipient: <router-address>, amountIn: 100_000000, amountOutMinimum: 48_100_000_000_000_000, sqrtPriceLimitX96: 0 }), unwrapWETH9(amountOutMin, <persona>)])` — ETH-OUT shape: `tokenOut = WETH` so the router holds WETH after the swap; `recipient = router-address` on the inner exactInputSingle; then `unwrapWETH9` unwraps the router's WETH balance to native ETH and sends it to `<persona>`. (Researcher correction 2026-05-23: prior `tokenOut: USDC` was a typo — for ETH-out, the swap must terminate at WETH inside the router so `unwrapWETH9` has WETH to unwrap.)
  - **Fixture UNI-C** = `SwapRouter02.multicall(deadline, [exactInput({ path: <USDC↔3000↔WETH↔3000↔WBTC>, recipient: <persona>, amountIn: 100_000000, amountOutMinimum: ... })])` — multi-hop ERC-20-to-ERC-20. Fee tiers per canonical mapping D-04 step 3 (WETH/WBTC = 3000 = 0.30%; WETH/USDC normally 500 = 0.05% but multi-hop intermediates use 3000 for parity with Phase 32 research findings).
- Hardcoded `0x...` literals in `test/signing-fingerprint.test.ts` per CLAUDE.md cryptographic-binding fixture discipline. Cross-link from each consumer test (`test/get-uniswap-quote.test.ts`, `test/prepare-uniswap-swap.test.ts`). Integration test re-anchors byte-identity across persona swaps (matches Phase 30/31 precedent — `from`-independence proof).

### Decimal handling

- **D-16:** Token amount input via decimal string at agent boundary (CLAUDE.md rule). Server resolves decimals via `get_token_metadata` (Phase 2 surface). Path-bytes encoding uses 20-byte addresses + 3-byte uint24 fee — no decimals involved at the calldata layer. Off-by-decimal caught at prepare time with `INVALID_INPUT` + clear message ("amount '100.5e-6' exceeds USDC decimal precision (6)").

### Claude's Discretion

- Internal helper names (`UniswapV3Quoter`, `selectBestFeeTier`, `encodeV3Path`, `composeMulticall`, etc.).
- Whether the path-bytes encoder lives in `src/protocols/uniswap-v3.ts` or in a dedicated `src/signing/uniswap-path.ts` pure-bigint/-bytes file (researcher/planner judgment; pure-byte separation pattern is the default expectation — matches `src/signing/aave-health.ts` / `src/signing/lido-rebase.ts` pure-math separation).
- Whether plan structure is 3 plans (32-01: contracts.ts + dispatch + KNOWN_SPENDERS + Uniswap V3 SOT + protocol decoder + Quoter V2 client; 32-02: `get_uniswap_quote` tool + auto-fee-tier selection; 32-03: `prepare_uniswap_swap` tool + sandwich-MEV gate + multicall composition + ETH-in/out paths) — matches the ROADMAP plan stub — vs. researcher proposes a different waveform after the research gate.
- Exact canonical pair-to-fee-tier mapping for multi-hop routing (D-04 step 3 — researcher determines at planning time; baseline: WETH/USDC = 0.05%, WETH/USDT = 0.30%, WETH/WBTC = 0.30%).
- Whether to ship a `--no-multi-hop` agent flag for advanced users who want to skip multi-hop iteration (researcher/planner judgment; default expectation = no flag, keep tool surface minimal at v2.4).
- Whether `multicall(uint256 deadline, bytes[] data)` is the canonical deadline-enforcement wrapper or whether SwapRouter02 ships a `selfPermit` / `selfPermitAllowed` variant Phase 32 should use instead (researcher verifies at planning gate; D-10 hardcodes the multicall-deadline path as the resilience anchor).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project conventions

- `CLAUDE.md` — `src/config/contracts.ts` SOT discipline; fixture pinning rule; ESM spy-affordance indirection; decimal-aware arithmetic at agent boundary; sandwich-MEV refusal pattern
- `.planning/PROJECT.md` — Project context; v2.4 milestone goals
- `.planning/REQUIREMENTS.md` §UNI-01/02/03/10 + §MEV-01 — exact Phase 32 surface (READ this first; it's the authoritative requirement set)
- `.planning/ROADMAP.md` Phase 32 — phase goal, success criteria, plan stub
- `.planning/STATE.md` — current execution state

### Code analogs (mechanical clones expected)

- `src/tools/prepare_sunswap_swap.ts` (Phase 20 Plan 20-01) — same-chain DEX swap with sandwich-MEV gate; Phase 32 `prepare_uniswap_swap.ts` clones the sandwich-MEV gate flow + quote-at-prepare-time pattern
- `src/tools/get_sunswap_quote.ts` (Phase 20 Plan 20-01) — quote envelope shape with `priceImpactBps` + `slippageBps`; Phase 32 `get_uniswap_quote.ts` clones the envelope structure (replacing TRON-specific fields with EVM ones)
- `src/signing/blocks-tron.ts:629` `SANDWICH_MEV_REFUSAL_TRON_TEMPLATE` — refusal block template; Phase 32 clones into `src/signing/blocks.ts` as `SANDWICH_MEV_REFUSAL_ETHEREUM_TEMPLATE` (Ethereum/Uniswap-flavored copy)
- `src/protocols/lido.ts` (Phase 30) + `src/protocols/eigenlayer.ts` + `src/protocols/rocketpool.ts` (Phase 31) — multi-method protocol decoder with mixed value-bearing + ERC-20-shape calls; Phase 32 `src/protocols/uniswap-v3.ts` mirrors for SwapRouter02 + Quoter V2 ABIs + path-bytes encoder
- `src/protocols/compound-v3.ts` (Phase 28) — per-protocol decoder with intent-vs-reality gates; Phase 32 inherits `INVALID_INPUT + hintTool` pattern for token-approval pre-flight (D-07), no-liquidity refusal (D-04a), sandwich-MEV refusal (D-08)
- `src/tools/prepare_lido_wrap.ts` (Phase 30) — ERC-20 amount-call with approval pre-flight; Phase 32 `prepare_uniswap_swap.ts` clones approval-pre-flight pattern
- `src/tools/prepare_aave_supply.ts` (Phase 7) — multi-tool protocol-decoder pattern with per-method selector + canonical-address getters; precedent for SwapRouter02 dispatch routing
- `src/tools/prepare_weth_unwrap.ts` (Phase 6 Plan 06-04) — single-arg burn/withdraw tool with LEDGER NOTICE handling; precedent for D-03 fallback if any SwapRouter02 selector blind-signs
- `src/clients/etherscan.ts` (Phase 7) — Ethereum-only by construction; Phase 32 quote-revert handling stays Ethereum-only at this phase (per-chain plumbing kept FROZEN until Phase 8 multi-chain surface routes it)
- `src/clients/defillama.ts` (Phase 2) — pricing client; NOT consumed by Phase 32 (Uniswap V3 pricing comes from Quoter V2 directly, not DefiLlama)

### SOT extension points

- `src/config/contracts.ts` — extend with `UniswapV3Contracts` interface + per-chain Ethereum slot (SwapRouter02 + Quoter V2 + NonfungiblePositionManager-reserved-for-Phase-33); promote existing `KNOWN_SPENDERS_ETHEREUM` SwapRouter02 entry to delegate-to-SOT-getter (Phase 6 inline literal → Phase 32 getter); reserve slot ordering for downstream v2.4 phases (Phase 33 LP verbs add to the same Uniswap V3 slot; Phase 34 Curve + Phase 35 escape hatch add adjacent slots).
- `src/security/canonical-dispatch.ts` — extend `CANONICAL_DISPATCH_TARGETS` Ethereum entry with SwapRouter02 address. Mirrors the Lido-arm filter pattern (Phase 30) — `address(0)` sentinels filtered out by construction.
- `src/signing/blocks.ts` — extend `DECODED ARGS` switch with `exactInputSingle` + `exactInput` + `unwrapWETH9` + `multicall` selectors; add `SANDWICH_MEV_REFUSAL_ETHEREUM_TEMPLATE` block constant (clone of TRON template with EVM-flavored copy).
- `SECURITY.md` — §6 v2.4 addendum: documents Quoter-midpoint price-impact methodology (D-04b residual risk); sandwich-MEV refusal-at-prepare-time defense-in-depth; SwapRouter02 + Quoter V2 trust boundary (read-only Quoter not in dispatch allowlist by design).

### External references

- Uniswap V3 docs — https://docs.uniswap.org/contracts/v3/overview
- Uniswap V3 SwapRouter02 deployment — https://docs.uniswap.org/contracts/v3/reference/deployments/ethereum-deployments
- Uniswap V3 Quoter V2 docs — https://docs.uniswap.org/contracts/v3/reference/periphery/lens/QuoterV2 (researcher MUST verify `quoteExactInputSingle` / `quoteExactInput` ABI shape + revert semantics for empty pools)
- Uniswap V3 path encoding — https://docs.uniswap.org/contracts/v3/guides/swaps/multihop-swaps (canonical packed-path format: `tokenA(20) ‖ fee(3) ‖ tokenB(20) ‖ fee(3) ‖ tokenC(20)`)
- ERC-7730 registry — https://github.com/LedgerHQ/clear-signing-erc7730-registry — researcher verifies clear-sign coverage for `SwapRouter02.exactInputSingle` + `SwapRouter02.exactInput` + `SwapRouter02.multicall` + `SwapRouter02.unwrapWETH9` (D-03; LEDGER NOTICE block emitted only if any selector blind-signs)
- Uniswap UniversalRouter (DEFERRED) — https://docs.uniswap.org/contracts/universal-router/overview (Phase 32 explicitly does NOT target UniversalRouter; deferred until typed-data clear-sign lands per ROADMAP v2.4 UNI deferred note)

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets

- **`src/tools/prepare_sunswap_swap.ts`** (Phase 20) — sandwich-MEV gate flow with explicit-vs-default slippage detection; `slippageWasExplicit` boolean derived from raw agent input. Phase 32 clones the gate-flow pattern verbatim.
- **`src/tools/get_sunswap_quote.ts`** (Phase 20) — quote envelope shape with `outAmount` + `priceImpactBps` + `slippageBps` + `route` + warning string at >2% impact. Phase 32 clones the envelope structure.
- **`src/signing/blocks-tron.ts`** `SANDWICH_MEV_REFUSAL_TRON_TEMPLATE` — refusal block template with `{PRICE_IMPACT_BPS}` placeholder. Phase 32 clones into `src/signing/blocks.ts` with Ethereum/Uniswap-flavored copy.
- **`src/config/contracts.ts`** `KNOWN_SPENDERS_ETHEREUM` — SwapRouter02 entry at `0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45` (Phase 6); also `Uniswap V3 SwapRouter` (V1, `0xE592427A0AEce92De3Edee1F18E0157C05861564`) + `Uniswap V2 Router 02` + `Uniswap Permit2`. Phase 32 promotes SwapRouter02 entry to delegate-to-SOT-getter; V1 router + V2 router + Permit2 entries unchanged.
- **`src/protocols/erc20.ts`** — `allowance()` reader for approval pre-flight; Phase 32 D-07 calls this for non-ETH `tokenIn`.
- **`src/protocols/lido.ts` / `src/protocols/eigenlayer.ts` / `src/protocols/rocketpool.ts`** — per-protocol decoder pattern; Phase 32 `src/protocols/uniswap-v3.ts` follows.
- **`CANONICAL_DISPATCH_TARGETS`** per-chain table — additive append for SwapRouter02. Mirror Lido-arm `address(0)` filter pattern.
- **`src/signing/blocks.ts`** `DECODED ARGS` switch — additive entries for SwapRouter02 selectors. Mirror Phase 30 Lido + Phase 31 EigenLayer/Rocket Pool extensions.

### Established Patterns

- **Mechanical-clone-of-prior-prepare** — `prepare_uniswap_swap` clones `prepare_sunswap_swap` (sandwich-MEV gate flow) + `prepare_lido_wrap` (token-approval pre-flight) + `prepare_aave_supply` (multi-arg ERC-20 call composition).
- **PREPARE RECEIPT verbatim relay** — every `prepare_*` includes the PREPARE RECEIPT block with verbatim agent args (CLAUDE.md rule).
- **`payloadFingerprint` re-check at send time** — Phase 4 trust pipeline; FROZEN-area; Phase 32 calldata is the multicall-deadline wrapper (D-10) — fingerprint covers the full wrapped calldata, not the inner exactInput-single call.
- **Fixture hardcoded literals + cross-link from consumer tests** — CLAUDE.md cryptographic-binding rule; UNI-A/UNI-B/UNI-C added in `test/signing-fingerprint.test.ts`.
- **Persona-cycle byte-identity integration test** — Phase 6/7/28/30/31 precedent; one combined test runs the full Uniswap-swap cycle across personas with re-anchored fingerprints (proves `from`-independence per Phase 31 D-14 + Fixture E pattern).
- **`INVALID_INPUT + hintTool` intent-vs-reality** — Phase 28/30/31 precedent; reused for token-approval pre-flight (D-07), no-liquidity refusal (D-04a), sandwich-MEV refusal (D-08).
- **`address(0)` sentinel filter in canonical-dispatch** — Phase 30 Lido-arm precedent; Phase 32 inherits.

### Integration Points

- **`src/server.ts` register-all** — additive imports for 2 new tools: `get_uniswap_quote`, `prepare_uniswap_swap`. Registered in `src/tools/register-all.ts` alongside existing Phase 28-31 prepare tools.
- **`preview_send` selector dispatch** — extend with SwapRouter02 selectors (`exactInputSingle`, `exactInput`, `multicall`, `unwrapWETH9`) so the DECODED ARGS block renders per-call. Multicall decoder is a NEW shape (`bytes[]` inner-call array) — Phase 32 `src/protocols/uniswap-v3.ts` owns the multicall-bytes-decoder.
- **`src/signing/blocks.ts`** — DECODED ARGS extensions + `SANDWICH_MEV_REFUSAL_ETHEREUM_TEMPLATE` block constant.
- **`src/config/contracts.ts`** — per-chain Uniswap V3 SOT extension; SwapRouter02 KNOWN_SPENDERS_ETHEREUM entry promotion to SOT-getter; preserve byte-identity of all other KNOWN_SPENDERS entries.
- **`src/security/canonical-dispatch.ts`** — Ethereum Uniswap V3 arm allowlist extension.
- **`SECURITY.md`** — §6 v2.4 addendum (D-04b residual-risk + D-08 sandwich-MEV defense-in-depth + D-03 UniversalRouter deferral rationale).

### What's NOT in scope (Phase 33-35)

- `src/signing/uniswap-tick.ts` — Phase 33 LP-verb pure-math (tick ↔ price conversions). Phase 32 swap doesn't need ticks at calldata level (Quoter V2 abstracts them). Phase 32 D-01 reserves the `NonfungiblePositionManager` SOT-getter slot for Phase 33 to consume; the `src/signing/uniswap-tick.ts` file itself is created in Phase 33.
- LP positions read (`get_lp_positions`) — Phase 33 UNI-04.
- LP verbs (`prepare_uniswap_v3_mint` / `_increase_liquidity` / `_decrease_liquidity` / `_collect` / `_burn` / `_rebalance`) — Phase 33 UNI-05..09.
- Curve swap + add-liquidity — Phase 34 CRV-01..03.
- `prepare_custom_call` escape hatch + companion `get_contract_abi` + `read_contract` — Phase 35 CUSTOM-01..03.
- Per-L2 sandwich-MEV calibration — Phase 40 MEV-01.
- Bridge facet decoders — Phase 39 BRIDGE-T1.

</code_context>

<specifics>
## Specific Ideas

- **Uniswap V3 fee tiers are pool-level, not pair-level.** A given token pair can have pools at 0.01% / 0.05% / 0.30% / 1.00% simultaneously, each with independent liquidity. Auto-fee-tier selection iterates all 4 and picks the best output — there is no single "canonical" fee tier per pair. The standard pattern (e.g., stablecoin pairs at 0.01%, blue-chip pairs at 0.05% or 0.30%) is a heuristic, not a contract-enforced rule.
- **Quoter V2 reverts when no pool exists.** Server iterates each tier with try/catch (or `eth_call` revert detection); reverted tiers contribute `null`. If all 4 tiers revert AND multi-hop also reverts, the pair has no Uniswap V3 liquidity — D-04a `INVALID_INPUT + request_capability` refusal.
- **Multi-hop adds compounding slippage.** A 2-hop swap incurs slippage at each pool — final output is `amountIn * (1 - hop1_impact) * (1 - hop2_impact)`. The D-04 0.5% improvement threshold is a conservative gas-vs-output trade-off; below threshold, single-hop wins on net.
- **SwapRouter02 doesn't enforce deadline natively.** Unlike SwapRouter (V1), SwapRouter02 drops the `deadline` parameter from `exactInputSingle` / `exactInput` for gas efficiency. The `multicall(uint256 deadline, bytes[] data)` overload restores deadline enforcement (D-10) — anti-replay defense for signed-but-delayed-broadcast scenarios.
- **`unwrapWETH9` is the canonical ETH-out path.** Set the swap recipient to `address(SwapRouter02)`, then `unwrapWETH9(amountOutMin, user)` in the same multicall — the router holds WETH between sub-calls, unwraps it, and sends ETH to user atomically. Failure modes: insufficient WETH balance (router didn't receive expected amount); `amountOutMin` check inside `unwrapWETH9` triggers revert.
- **`sqrtPriceLimitX96 = 0`** disables the price-limit check inside the pool (recommended for swap aggregators; users rely on `amountOutMinimum` for slippage protection). Phase 32 hardcodes `0` per Uniswap-canonical pattern.
- **Native ETH input via `msg.value` requires `tokenIn = WETH` in calldata.** SwapRouter02 detects `msg.value > 0` and internally wraps via `WETH9.deposit()`. Server-side: when `tokenIn = "ETH"` agent input, set `calldata.tokenIn = WETH address` AND `transaction.value = amountIn`. CHECKS PERFORMED surfaces this resolution explicitly: `tokenIn: "ETH" (resolved to WETH 0xC02a...756Cc2 for routing; msg.value carries amount)`.
- **Path encoding is order-sensitive.** `tokenIn(20) ‖ fee1(3) ‖ tokenMid(20) ‖ fee2(3) ‖ tokenOut(20)` for a 2-hop. Reverse order is a DIFFERENT path (different pool sequence). Server validates path direction matches agent's `tokenIn → tokenOut` intent.
- **Approval slot already populated.** KNOWN_SPENDERS_ETHEREUM at `src/config/contracts.ts:866` carries SwapRouter02. Phase 32 D-01 promotes this entry to a SOT-getter delegate; no NEW entry, just a refactor + drift-test enforcement.
- **Phase 32 NEVER iterates UniversalRouter calldata.** UniversalRouter's calldata uses Permit2-signed typed-data envelopes — full multi-command surface (e.g., `V3_SWAP_EXACT_IN`, `PERMIT2_TRANSFER_FROM`, `SWEEP`). Phase 32 deferral (D-03) keeps the surface narrow and fully clear-signable on Ledger.

</specifics>

<deferred>
## Deferred Ideas

- **UniversalRouter integration** — once typed-data clear-sign lands on Ledger, switch the dispatch target from SwapRouter02 to UniversalRouter for gas efficiency + Permit2 support. Anchored at v3.x; tracked by ROADMAP v2.4 UNI deferred note.
- **Per-L2 sandwich-MEV thresholds** — Phase 40 MEV-01 calibrates per-chain `priceImpactBps` thresholds (likely lower than 200 for L2s — sandwich-MEV on L2s is rarer + smaller). Phase 32 D-08a hardcodes 200/50 for all chains until Phase 40.
- **Production-grade midpoint sourcing** — Phase 32 D-04b uses Quoter V2 tiny-amount as the fair-price reference. Future surface could use Chainlink price feeds or a TWAP oracle for tighter impact estimation. Anchored at v2.6 Phase 40.
- **Uniswap V3 multi-hop fee-tier iteration** — Phase 32 hardcodes canonical pair-to-fee-tier mapping (D-04 step 3). Combinatorial multi-tier iteration (e.g., trying all 4 tiers at each hop) deferred to v3.x algorithmic-routing surface.
- **Uniswap V2 + Uniswap V4 swap surfaces** — out of scope; v2.4 is V3-only per REQUIREMENTS.md UNI surface. V2 legacy users go through SwapRouter02's V2 fallback (NOT exposed); V4 hooks (when production) anchor at v3.x.
- **Uniswap V3 swap on non-Ethereum chains via Phase 8 multi-chain surface** — Phase 32 ships Ethereum-only (per ROADMAP v2.4 milestone scope). Multi-chain SwapRouter02 + Quoter V2 addresses can be added to D-01 SOT in a follow-up phase or in Phase 32 itself if the researcher confirms the SOT extension is non-disruptive (all 5 EVM chains have SwapRouter02 + Quoter V2 deployments per Uniswap docs).
- **Uniswap X (intent-based RFQ)** — out of scope; needs intent-based signing (off-chain order signing, on-chain settlement). Anchored at v3.x.
- **Cross-chain Uniswap V4 with hooks** — V4 has not deployed at planning time; defer until production deployment + clear-sign coverage.
- **Slippage hint pre-calculation surface** — `get_uniswap_quote` returns `recommendedSlippageBps` based on current pool state + recent volatility. Future ergonomics surface; defer.
- **Token allowance auto-revoke after swap** — convenience surface that wraps the swap in a multicall with a post-swap `approve(SwapRouter02, 0)`. Defer — users can call `prepare_revoke_approval` (Phase 6) manually for now.

</deferred>

---

*Phase: 32-evm-uniswap-v3-swap*
*Context gathered: 2026-05-23 (auto-mode; recommended-option selection grounded in Phases 14/20/28/30/31 analogs + REQUIREMENTS.md UNI-01/02/03/10 + MEV-01)*
