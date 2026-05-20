# Phase 34: Curve swap + add liquidity — Context

**Gathered:** 2026-05-20
**Status:** Placeholder — context-gathering pending (run `/gsd-discuss-phase 34`)

<domain>
## Phase Boundary

User can swap on Curve stETH/ETH legacy pool + stable_ng plain pools, and add liquidity to Ethereum stable_ng plain pools. v0.2 follow-ups (3-coin meta-pools, Curve metaregistry-driven discovery) deferred per upstream issue. v2.4 ships the high-volume + lowest-complexity Curve surface.

</domain>

<decisions>
## Implementation Decisions

Pending — to be gathered during `/gsd-discuss-phase 34`. Anchor candidates:

- **Pool registry curation**: stETH/ETH legacy pool + top-10 stable_ng plain pools (by TVL at planning time) — researcher to enumerate at execute time. Stored in `src/config/contracts.ts` Curve sub-table per-chain (Ethereum first).
- **stable_ng vs legacy ABI distinction**: Curve has multiple pool ABI generations — stable_ng plain pools have a consistent `exchange(i, j, dx, min_dy)` signature; legacy pools (stETH/ETH is the canonical example) have a different `exchange` ABI. Phase 34's `prepare_curve_swap` dispatches per-pool-ABI generation; the pool registry tags each entry with its ABI version.
- **Slippage handling**: `slippageBps` parameter mandatory; `min_dy` derived from `(quotedDy * (10000 - slippageBps)) / 10000`. No sandwich-MEV refusal gate at v2.4 (Curve's stable pools have lower MEV exposure than Uniswap V3); v2.6 MEV-01 extends if data justifies.
- **`prepare_curve_add_liquidity`**: amounts array length must match pool's coin count (2 for stETH/ETH; 3-4 for typical stable_ng); server validates the array length against the pool registry entry.

### Claude's Discretion

- Internal helper names (`CurvePoolReader`, `selectCurvePoolAbi`, etc.)
- Pool registry size (10 or 15 entries; curation over padding)
- Fixture literal anchor values

</decisions>

<canonical_refs>
## Canonical References

- `CLAUDE.md` — `src/config/contracts.ts` curated registry pattern
- `.planning/REQUIREMENTS.md` §CRV-01..03 — exact Phase 34 surface
- `.planning/ROADMAP.md` Phase 34
- Curve docs — https://docs.curve.fi/

</canonical_refs>

<specifics>
## Specific Ideas

- Curve's per-pool ABI variance is a real complexity source — Phase 34's pool registry tags each entry with `abiVersion: "legacy" | "stable_ng"` so `prepare_curve_swap` dispatches correctly. Future v0.2 work would add `crypto` and `tricrypto` ABIs.
- LP token balances per pool surface in `get_curve_positions`; each pool's LP token is a separate ERC-20 — the existing v1.2 token registry doesn't cover them, so Phase 34 ships a sibling Curve-LP-token registry.
- Add-liquidity slippage: `min_mint_amount` parameter derived from `(quotedLpAmount * (10000 - slippageBps)) / 10000`.

</specifics>

<deferred>
## Deferred Ideas

- 3-coin meta-pools + Curve metaregistry-driven discovery — v0.2 follow-up per upstream issue
- `prepare_curve_remove_liquidity` (single-side and balanced) — defer to v2.4.x
- Curve gauge staking / CRV claim flow — defer to v2.4.x or v2.3 LIDO-equivalent treatment
- Curve crypto pools (tricrypto, etc.) — defer; v2.4 is stable_ng + legacy stETH/ETH only

</deferred>

---

*Phase: 34-evm-curve-swap-add-liquidity*
*Context placeholder: 2026-05-20*
