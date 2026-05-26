# Phase 34: Curve swap + add liquidity — Discussion Log

**Date:** 2026-05-26
**Mode:** auto (CONTEXT.md placeholder already sketched anchor decisions; promoted to locked decisions without per-question AskUserQuestion turns)
**Branch:** `docs/34-planning`

## Phase Boundary (from ROADMAP.md + REQUIREMENTS.md)

Phase 34 ships three Curve tools on Ethereum:
1. `get_curve_positions({ wallet, chain? })` — LP-token balances + per-pool coin composition
2. `prepare_curve_swap({ chain, poolAddress, inputToken, outputToken, amount, slippageBps })` — unsigned `exchange` calldata, per-pool-ABI dispatch
3. `prepare_curve_add_liquidity({ chain, poolAddress, amounts, slippageBps })` — unsigned `add_liquidity` calldata, stable_ng plain pools only

Out of scope at v2.4: 3-coin meta-pools, metaregistry-driven discovery, remove_liquidity, gauge staking, crypto/tricrypto pools, LP USD pricing.

## Gray Areas — Resolution

### Area 1: Pool registry shape + curation
**Resolved:** New `CurvePools` sub-table per chain in `src/config/contracts.ts`. Per-pool fields: `address`, `abiVersion: "legacy" | "stable_ng"`, `coins: Address[]`, `coinDecimals: number[]`, `lpToken: Address`, `displayName: string`. Coverage at v2.4: stETH/ETH legacy pool + top-10 stable_ng plain pools by Ethereum TVL at planning time. Researcher enumerates the top-10 list during plan-phase.
**Rationale:** Matches precedent set by `KNOWN_SPENDERS_ETHEREUM` / `UniswapV3Contracts` (Phase 32) / `AaveV3Contracts` (Phase 7) — curated registry + per-row discriminator field for dispatch. `lpToken` inline on the pool entry (not a sibling registry) — corrects the placeholder's "sibling Curve-LP-token registry" sketch, since per-pool LP-token addresses are already pool-keyed.

### Area 2: ABI generation dispatch (`legacy` vs `stable_ng`)
**Resolved:** Pool registry tags each entry with `abiVersion`; `prepare_curve_swap` dispatches on the tag, NOT on heuristic ABI-probing at call time. `legacy` (stETH/ETH archetype): `exchange(int128 i, int128 j, uint256 dx, uint256 min_dy)`. `stable_ng`: `exchange(int128 i, int128 j, uint256 dx, uint256 min_dy, address _receiver)` — server sets `_receiver = signer` to preserve byte-stable calldata under persona swap. Add-liquidity (stable_ng only at v2.4): `add_liquidity(uint256[] _amounts, uint256 _min_mint_amount)`.
**Rationale:** ABI variance is the single biggest correctness risk; registry-driven dispatch makes the right shape choosable at compile time of the registry, not at runtime. Per-`abiVersion` Fixtures CRV-A (legacy) + CRV-B (stable_ng) anchor the byte-shape distinction.

### Area 3: Slippage + amount derivation
**Resolved:** `slippageBps` mandatory (schema-required, no default) — matches `prepare_uniswap_swap` (Phase 32) discipline. Swap: server quotes `get_dy(i, j, dx)` on-chain, `min_dy = (quotedDy * (10000 - slippageBps)) / 10000` (bigint). Add-liquidity: server quotes `calc_token_amount(_amounts, true)` on-chain, `min_mint_amount = (quotedLpAmount * (10000 - slippageBps)) / 10000` (bigint). Amounts cross agent boundary as decimal strings (CLAUDE.md "decimal-aware arithmetic"); server resolves via per-pool `coinDecimals` from registry (not via `get_token_metadata` round-trip).
**Rationale:** Loose-slippage scripts (`min_mint_amount = 0`) are unsafe; mandatory bps + on-chain quote anchors a real floor. Bigint everywhere — off-by-decimal is the project's top user-facing bug class.

### Area 4: Sandwich-MEV gate
**Resolved:** No sandwich-MEV refusal gate at v2.4. Document the asymmetric treatment in CHECKS PERFORMED: `Sandwich-MEV gate: not applied to Curve (low MEV exposure on stable pools)`. v2.6 MEV-01 may extend if production data justifies.
**Rationale:** Curve's stable pools have materially lower MEV exposure than Uniswap V3 (low-slippage invariant, sub-bps price impact for normal sizes). Symmetric treatment with UniV3's gate would produce false-positive refusals on Curve flows.

### Area 5: `get_curve_positions` read-only shape
**Resolved:** Per-wallet, per-chain. Multicall LP-token `balanceOf(wallet)` across registered pools. Zero-balance pools filtered (precedent: `get_aave_v3_positions`). Per-pool entry: `{ poolAddress, displayName, abiVersion, lpBalance: string, lpDecimals: number, coins: [{ address, symbol?, decimals }], priceUnknown?: true }`. LP USD pricing deferred. READ-ONLY-by-construction grep guard (precedent: Phase 7 `simulate_position_change`).
**Rationale:** Mirrors Aave V3 positions read shape; zero-filter keeps response noise low; LP pricing requires `get_virtual_price` math that's a v3.x portfolio enhancement.

### Area 6: Fixture anchors (cryptographic-binding regression)
**Resolved:** Three new hardcoded `0x...` literal fixtures in `test/signing-fingerprint.test.ts`:
- **CRV-A:** legacy `exchange` on stETH/ETH
- **CRV-B:** stable_ng `exchange` with `_receiver = signer` (proves `from`-independent calldata when receiver is server-derived)
- **CRV-C:** stable_ng `add_liquidity` on a 3-coin pool (proves dynamic-array calldata is byte-stable)
**Rationale:** CLAUDE.md "Cryptographic-binding fixtures pinned as hardcoded literals" — every new tx shape gets a literal anchor; no `beforeAll`-snapshot drift.

### Area 7: Plan structure (wave breakdown)
**Resolved:** 3 plans:
- **34-01:** registry + `KNOWN_SPENDERS_ETHEREUM` promotion + canonical-dispatch arm + `src/chains/curve.ts` parseAbi struct refs
- **34-02:** `get_curve_positions` (LP-balance multicall + zero-filter)
- **34-03:** `prepare_curve_swap` + `prepare_curve_add_liquidity` + `src/protocols/curve.ts` selector-dispatch decoder + `preview_send` extension + Fixtures CRV-A/B/C
**Wave structure:** Strict sequential 34-01 → 34-02 → 34-03 (34-02 and 34-03 both depend on registry from 34-01; 34-03 selector-dispatch decoder consumes nothing 34-02 produces but both modify `register-all.ts`, so sequential avoids rebase risk). Researcher may revise to wave 34-01 → (34-02 ∥ 34-03) if pattern-mapper can carve register-all imports disjointly (precedent: Phase 7 07-03 ∥ 07-04).
**Rationale:** Three plans match the natural cleaving — registry SOT / read tool / write tools. Sequential by default; parallel deferred to planner's call.

## Deferred Ideas (captured for future phases)

- 3-coin meta-pools + Curve metaregistry-driven discovery — v0.2 follow-up
- `prepare_curve_remove_liquidity` (single-side + balanced) — v2.4.x
- Curve gauge staking + CRV claim flow — v2.4.x or v2.3-equivalent treatment
- Curve crypto / tricrypto pools — v2.5+
- LP USD pricing in `get_curve_positions` — v3.x portfolio enhancement
- Multi-chain Curve (Polygon / Arbitrum / Base / Optimism) — v2.4.x

## Claude's Discretion (downstream callers may right-size)

- Internal helper names (`CurvePoolReader`, `selectCurvePoolAbi`, etc.)
- Registry size at execute time (10 or 12 entries)
- Fixture literal anchor values
- Whether to extract a shared `bps-slippage.ts` helper if UniV3/Curve duplication is non-trivial

## Notes

- Auto-mode discussion: no per-area AskUserQuestion turns. Placeholder anchor decisions promoted with `<specifics>`-corrected detail (LP token inline on pool entry vs sibling registry; receiver-param byte-identity invariant for stable_ng).
- All ROADMAP.md success criteria 1-4 are mapped to plan structure.
- Canonical refs section in CONTEXT.md is mandatory and complete.
- Cryptographic-binding chain FROZEN-area discipline asserted (no edits to `src/signing/payload-fingerprint.ts`, `src/signing/presign-hash.ts`, `src/signing/handle-store.ts` state machine, `src/tools/send_transaction.ts` three gates).

---

*Phase: 34-evm-curve-swap-add-liquidity*
*Discussion log: 2026-05-26*
