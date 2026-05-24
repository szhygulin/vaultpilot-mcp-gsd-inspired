# Phase 33: Uniswap V3 full LP verb set + `get_lp_positions` with IL estimate — Context

**Gathered:** 2026-05-24
**Status:** Finalized — anchored decisions promoted from 2026-05-20 placeholder; no open gray areas requiring user input (all candidates are either pinned by REQUIREMENTS.md UNI-04..09 / ROADMAP.md Phase 33 spec, or are researcher scope-probe candidates).

<domain>
## Phase Boundary

User can manage Uniswap V3 LP positions end-to-end on Ethereum mainnet:

- **Reads** — `get_lp_positions({ wallet, chain? })` returns positions per NFT-id with current price + tick range + in-range/out-of-range flag + accrued fees + impermanent-loss estimate (relative to a hodl baseline).
- **Single-step prepares** — `prepare_uniswap_v3_mint`, `_increase_liquidity`, `_decrease_liquidity`, `_collect`, `_burn` (5 mechanical clones of `prepare_aave_supply` shape against the NonfungiblePositionManager).
- **Composite prepare** — `prepare_uniswap_v3_rebalance({ tokenId, newTickLower, newTickUpper })` is a multicall (decrease all + collect + mint at new range); preview surfaces the multi-step decoded view as the first **composite-tx** shape in the codebase.

Multi-chain (Polygon/Arbitrum/Base/Optimism) deferred to v2.4.x — Phase 33 ships Ethereum mainnet only, mirroring Phase 32 swap scope. Tick spacing per fee tier (60 for 0.30%, 200 for 1.00%, etc.) constrains valid ticks; server snaps user-supplied prices to the nearest valid tick + surfaces the snap in CHECKS PERFORMED.

</domain>

<decisions>
## Implementation Decisions (Locked)

1. **Tick math placement → `src/signing/uniswap-tick.ts`** (per UNI-10 REQUIREMENTS). Researcher scope-probes `@uniswap/v3-sdk` at planning gate per the SDK Scope-Probing Discipline; verdict (adopt vs cherry-pick `tickMath` + `priceMath` vs hand-roll with `@noble/hashes`-style bigint) anchored in RESEARCH.md and ratified in PLAN.md. Default leaning: hand-roll the 3–4 conversion primitives (tick ↔ sqrtPriceX96 ↔ price) — the math is well-documented, the SDK pulls heavy ethers/JSBI deps the repo deliberately avoided in Phase 32 swap, and the surface area is small. Final call deferred to researcher's empirical SDK probe.

2. **IL estimate as a labeled approximation** — `get_lp_positions` surfaces both raw IL (vs hodl baseline at position-mint price) AND net-of-fees IL (raw IL + accrued fees). Both fields prefixed `[ESTIMATE]` in any human-readable surface; agent docs explicit that this is a rough hint, not precise PnL. Mint-event price reconstructed from `positions(tokenId)` NFT state at mint time (re-deriving the entry price from `liquidity` + `tickLower` + `tickUpper` is the canonical method — no historical event log scan needed).

3. **Tick-as-price agent interface** — agent passes decimal prices and decimals (`priceLower: "1900.5"`, `priceUpper: "2100.0"`), server snaps to nearest valid tick via current pool `sqrtPriceX96`. PREPARE RECEIPT records the user-input prices; CHECKS PERFORMED records the snapped ticks + the snap delta in bps. Avoids forcing the agent into tick-math territory and aligns with the project's "decimal strings cross the agent boundary" convention.

4. **NonfungiblePositionManager from `src/config/contracts.ts` SOT** — extend `ContractsForChain` with `uniswapV3NfPositionManager` slot + `getUniswapV3NfPositionManager(chainId)` getter mirroring the Phase 32 `getUniswapV3SwapRouter02(chainId)` shape. Promote to `KNOWN_SPENDERS_ETHEREUM` if NFT-approval flows require it (researcher to confirm — mint/increase use direct `transferFrom` semantics; collect/burn/decrease use `tokenId`-based authorization, NOT ERC-20 spender approval, so the spender-row promotion may NOT apply for this contract — anchor in RESEARCH.md).

5. **Canonical-dispatch allowlist** — extend `CANONICAL_DISPATCH_TARGETS.ethereum` (Phase 32 added the SwapRouter02 arm) with the NonfungiblePositionManager address. Single-row diff in `src/security/canonical-dispatch.ts`; no new sibling set (already on `ethereum` namespace).

6. **Composite-tx preview shape (NEW PATTERN — establishes convention for v2.5 Safe three-step)** — `prepare_uniswap_v3_rebalance` is ONE tool that returns ONE handle with ONE multicall calldata payload. The `preview_send` rendering for this handle surfaces decoded `step 1 / step 2 / step 3` sub-blocks (decrease + collect + mint), each with its own decoded view. PREPARE RECEIPT records the composite intent (tokenId + newTickLower + newTickUpper); CHECKS PERFORMED enumerates each step's selector + target + decoded args. Cryptographic-binding chain (`payloadFingerprint` over the full multicall calldata) is unchanged — the new shape is a pure rendering extension at `preview_send`.

7. **Plan structure (3 plans, sequential)**:
   - **33-01**: `src/chains/uniswap-v3-lp.ts` (position reader via NonfungiblePositionManager) + `get_lp_positions` + `src/signing/uniswap-tick.ts` tick↔price helpers + contracts.ts SOT extension + canonical-dispatch arm. Establishes the read surface + the tick-math primitives the prepare tools consume.
   - **33-02**: 5 single-step prepares — `prepare_uniswap_v3_mint` + `_increase_liquidity` + `_decrease_liquidity` + `_collect` + `_burn` (mechanical clones of `prepare_aave_supply` shape) + `src/protocols/uniswap-v3-lp.ts` (selector dispatch + decoder) + `preview_send` selector-dispatch extension + Fixtures UNI-LP-{A,B,C,D,E} hardcoded `payloadFingerprint` literals (one per verb).
   - **33-03**: `prepare_uniswap_v3_rebalance` composite tool + composite-tx preview shape + multicall builder (encodes the 3-step calldata sequence via the NonfungiblePositionManager's `multicall(bytes[])` entrypoint) + Fixture UNI-LP-F (rebalance multicall fingerprint).

### Claude's Discretion (no user decision needed)

- Internal helper names (`UniswapV3LpReader`, `tickToHumanPrice`, `snapPriceToTick`, etc.) — planner picks names matching surrounding code idiom.
- Fixture literal anchor values for each of mint / increase / decrease / collect / burn / rebalance shapes — computed at execute time from real calldata.
- Whether `getLiquidityForAmounts` / `getAmountsForLiquidity` math goes through the SDK or is hand-rolled alongside the tick primitives — falls out of decision #1's researcher scope-probe.
- Test trajectory delta — measured per-plan against local baseline; no pre-committed target.

</decisions>

<canonical_refs>
## Canonical References

- `CLAUDE.md` — `src/config/contracts.ts` SOT; ESM spy-affordance indirection; cryptographic-binding fixtures pattern; SDK Scope-Probing Discipline
- `.planning/REQUIREMENTS.md` UNI-04..10 — exact Phase 33 surface (Phase 32 covered UNI-01..03 + the SwapRouter02/Quoter V2 portion of UNI-10; Phase 33 adds the NonfungiblePositionManager + `src/signing/uniswap-tick.ts` portion)
- `.planning/ROADMAP.md` — Phase 33 goal + 3-plan structure + composite-tx preview convention note
- `.planning/phases/32-evm-uniswap-v3-swap/32-CONTEXT.md` + downstream PLAN files — Phase 32 anchored `UniswapV3Contracts` SOT shape, `KNOWN_SPENDERS_ETHEREUM` SwapRouter02 row, `canonical-dispatch` SwapRouter02 arm, `src/protocols/uniswap-v3.ts` selector-dispatch shape, `src/signing/uniswap-path.ts` (companion to the new `uniswap-tick.ts`), and Fixtures UNI-A/B/C. Phase 33 extends these, not replaces.
- `src/tools/prepare_aave_supply.ts` (Phase 7) — mechanical-clone pattern for the 5 single-step LP prepare tools
- `src/security/canonical-dispatch.ts` — `CANONICAL_DISPATCH_TARGETS.ethereum` table extended by Phase 33 (one row: NonfungiblePositionManager)
- Uniswap V3 NonfungiblePositionManager — https://docs.uniswap.org/contracts/v3/reference/periphery/NonfungiblePositionManager
- Uniswap V3 whitepaper §6 (Tick math) — https://uniswap.org/whitepaper-v3.pdf
- ABI source — `@uniswap/v3-periphery` package's `INonfungiblePositionManager.sol` (researcher probes via `npm view` + `dist/` typings inspection per SDK Scope-Probing Discipline)

</canonical_refs>

<specifics>
## Specific Ideas

- LP positions are NFT-keyed (each position is an ERC-721 token at the NonfungiblePositionManager — `0xC36442b4a4522E871399CD717aBDD847Ab11FE88` on Ethereum mainnet). `get_lp_positions` enumerates the user's NFT balances via the standard ERC-721 `balanceOf` + `tokenOfOwnerByIndex` (NonfungiblePositionManager implements ERC-721 Enumerable), then for each tokenId calls `positions(tokenId)` to decode `{ token0, token1, fee, tickLower, tickUpper, liquidity, feeGrowthInside0LastX128, feeGrowthInside1LastX128, tokensOwed0, tokensOwed1 }`. Current price/tick comes from `IUniswapV3Pool.slot0()` (pool address derived deterministically from `token0 + token1 + fee` via the Uniswap V3 factory `getPool` view — no factory call required if researcher confirms `PoolAddress.computeAddress` is deterministic-enough to skip the RPC roundtrip; otherwise one extra `factory.getPool` call per position).
- Accrued fees on-chain = `tokensOwed0/1` (settled portion) + the unsettled delta from `feeGrowthInside0/1X128 - feeGrowthInside0/1LastX128` × `liquidity / 2^128`. Decision: surface the COMBINED accrued (settled + unsettled) under one `accruedFees` field with units in token-decimal strings; CHECKS PERFORMED notes whether the read crossed a settlement boundary (typically irrelevant for users — they care about "what would I collect if I called collect() right now").
- IL estimate baseline reconstruction: at mint, `liquidity = L`, range `[tickLower, tickUpper]`, then `amount0_at_mint` and `amount1_at_mint` derive from `getAmountsForLiquidity(sqrtPrice_at_mint, sqrtPrice_lower, sqrtPrice_upper, L)`. The `sqrtPrice_at_mint` is reconstructable from the position's CURRENT state ONLY if the price hasn't moved out of range (otherwise we know which side it exited on but not the exact entry price). When ambiguous: fall back to the AVERAGE of `sqrtPrice_lower` and `sqrtPrice_upper` as the assumed entry, with `ilEstimateConfidence: "low" | "high"` surfacing the heuristic. Anchor in RESEARCH.md whether to do this or refuse to estimate when ambiguous.
- Tick math complexity: tick spacing per fee tier — 1 (0.01% — only on Polygon zkEVM), 10 (0.05%), 60 (0.30%), 200 (1.00%). Server snaps user-supplied prices to the nearest valid tick + surfaces `tickSnapBps` in CHECKS PERFORMED. Refuse if snap delta > 100 bps (1%) — that level of imprecision means the user is misreading the pool's resolution.
- `prepare_uniswap_v3_rebalance` is the first **composite-tx** in the codebase. The preview shape that Phase 33 establishes is the canonical reference for v2.5 Safe multisig three-step (propose / approve / execute) per the deferred-ideas note in ROADMAP.md v2.5. Decision shape — one tool, one handle, one calldata payload, preview surfaces `step N / N` sub-blocks; cryptographic-binding chain unchanged (single `payloadFingerprint` over full multicall calldata).
- Sandwich-MEV defense from Phase 32 UNI-03 does NOT apply to LP verbs by default — LP mint/increase/decrease don't have a swap leg unless the user is using the WETH-pair convenience entry points (which are out-of-scope for v2.4 — LP verbs require both `token0` and `token1` pre-balanced). Researcher confirms whether `prepare_uniswap_v3_mint` should require an explicit `amount0Min`/`amount1Min` slippage parameter (Uniswap mint accepts these natively); leaning yes, with the same `>2% deviation → INVALID_INPUT + hintTool` gate that Phase 32 established for swaps.
- Cryptographic-binding fixture discipline: Fixtures UNI-LP-{A,B,C,D,E,F} go in `test/signing-fingerprint.test.ts` as hardcoded `0x...` literals (one per verb shape — mint / increase / decrease / collect / burn / rebalance). Cross-link from each `prepare_uniswap_v3_*.test.ts`. NO `beforeAll`-snapshot. Persona-cycle byte-identity integration test re-anchors all 6 fixtures under at least 2 personas.

</specifics>

<deferred>
## Deferred Ideas

- Multi-chain LP (Polygon / Arbitrum / Base / Optimism) — v2.4.x follow-up, same pattern as Phase 32 swap multi-chain deferral.
- Curve swap + add-liquidity — Phase 34.
- `prepare_custom_call` escape hatch — Phase 35.
- Uniswap V4 hooks — defer to v3.x.
- LP-strategy automation (auto-rebalance on out-of-range trigger, range-order watchers, fee-compounding loops) — out of scope; v2.4 is verb-set only. v3.5+ ergonomics surface candidate.
- WETH-pair convenience entry points (`mint` with native ETH instead of pre-wrapped WETH) — out of scope for v2.4; user calls `prepare_weth_wrap` (Phase 6) first.
- `prepare_uniswap_v3_swap_via_lp_router` (router-aware swap routing through user's own LP) — speculative; not on the roadmap.

</deferred>

---

*Phase: 33-evm-uniswap-v3-lp-verb-set*
*Context finalized: 2026-05-24 (autonomous mode — no user-input gray areas remained after analysis; all locked-decision candidates anchored in ROADMAP/REQUIREMENTS/Phase-32-CONTEXT, all SDK + IL-estimate-ambiguity fork candidates deferred to researcher scope-probe at planning gate per CLAUDE.md SDK Scope-Probing Discipline)*
