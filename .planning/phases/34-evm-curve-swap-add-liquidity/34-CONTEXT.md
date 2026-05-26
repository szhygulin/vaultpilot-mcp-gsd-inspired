# Phase 34: Curve swap + add liquidity — Context

**Gathered:** 2026-05-26
**Status:** Locked — decisions captured from placeholder anchors and prior-phase precedents; ready for `/gsd-plan-phase 34`

<domain>
## Phase Boundary

User can:
1. **Read** Curve positions across pools — `get_curve_positions({ wallet, chain? })` returns per-pool LP-token balances + the pool's underlying-coin composition. Coverage at v2.4: stETH/ETH legacy pool + curated top-10 stable_ng plain pools on Ethereum.
2. **Swap** on Curve same-pool — `prepare_curve_swap({ chain, poolAddress, inputToken, outputToken, amount, slippageBps })` produces an unsigned `exchange(i, j, dx, min_dy)` call. Pool's ABI generation (`legacy` vs `stable_ng`) is registry-tagged; server dispatches the right ABI shape per pool.
3. **Add liquidity** to stable_ng plain pools — `prepare_curve_add_liquidity({ chain, poolAddress, amounts: [...], slippageBps })` produces an unsigned `add_liquidity(amounts, min_mint_amount)` call. Amounts array length is registry-validated against the pool's coin count.

**Out of scope at v2.4 (deferred):** 3-coin meta-pools, Curve metaregistry-driven discovery, `prepare_curve_remove_liquidity` (single-side + balanced), Curve gauge staking + CRV claim flow, Curve crypto/tricrypto pools.

</domain>

<decisions>
## Implementation Decisions

### Pool registry shape + curation
- **Location:** `src/config/contracts.ts` — new `CurvePools` sub-table per chain, keyed by chain id. Matches the existing curated-registry pattern (precedent: `KNOWN_SPENDERS_ETHEREUM`, `UniswapV3Contracts` from Phase 32, `AaveV3Contracts` from Phase 7).
- **Coverage at v2.4:** stETH/ETH legacy pool (`0xDC24316b9AE028F1497c275EB9192a3Ea0f67022`) + top-10 stable_ng plain pools by TVL on Ethereum at planning time. Researcher enumerates the top-10 list during plan-phase via Curve docs / Curve API / DefiLlama snapshot.
- **Per-pool fields (load-bearing):**
  - `address` — pool contract address
  - `abiVersion: "legacy" | "stable_ng"` — dispatch discriminator for `prepare_curve_swap`
  - `coins: Address[]` — ordered list of underlying-coin addresses (index `i`/`j` for `exchange` calls maps directly to this array)
  - `coinDecimals: number[]` — parallel to `coins`; decimal-aware arithmetic invariant (CLAUDE.md "decimal-aware arithmetic")
  - `lpToken: Address` — pool's LP-token ERC-20 address (for `get_curve_positions` balance reads)
  - `displayName: string` — human-readable label surfaced in preview blocks (e.g. `"stETH/ETH (legacy)"`, `"USDC/USDT/DAI (stable_ng)"`)
- **Spender allowlist:** every Curve pool address added to `src/config/contracts.ts` MUST also be promoted to `KNOWN_SPENDERS_ETHEREUM` (each pool consumes ERC-20 input via `transferFrom`; user approve to pool address is the standard flow).
- **Canonical-dispatch wiring:** new Curve arm in `src/security/canonical-dispatch.ts` keyed on pool addresses (load-bearing for Layer 0.5 dispatch-allowlist gate — per Phase 9 plan 09-04 pattern).

### ABI generation dispatch
- **`legacy` ABI** (stETH/ETH archetype): `exchange(int128 i, int128 j, uint256 dx, uint256 min_dy)` returning `uint256`. Indices are `int128`.
- **`stable_ng` ABI**: `exchange(int128 i, int128 j, uint256 dx, uint256 min_dy, address _receiver)` returning `uint256` — newer plain pools take an explicit receiver param. Server passes `_receiver = msg.sender` (the signer's address) to preserve `from`-independent calldata invariant.
- **Add-liquidity ABI** (stable_ng plain pools, v2.4 scope): `add_liquidity(uint256[] _amounts, uint256 _min_mint_amount)` — dynamic-length amounts array. Pool's coin count drives array length; server validates input array length against `coins.length` from registry.
- **Selector-dispatch decoder** in `src/protocols/curve.ts` for `preview_send`: per `abiVersion` per call type (exchange / add_liquidity), surface decoded `[CURVE SWAP]` / `[CURVE ADD LIQUIDITY]` block listing pool display name, input/output coin symbols + amounts (input human-readable; min-output human-readable), slippage bps, receiver (for stable_ng).

### Slippage + amount handling
- **`slippageBps` mandatory** on both `prepare_curve_swap` and `prepare_curve_add_liquidity` (no default — schema-level required). Match `prepare_uniswap_swap` (Phase 32) discipline.
- **Swap `min_dy` derivation:** server quotes `get_dy(i, j, dx)` on-chain, then `min_dy = (quotedDy * (10000 - slippageBps)) / 10000`. Bigint arithmetic; no floating point.
- **Add-liquidity `min_mint_amount` derivation:** server quotes `calc_token_amount(_amounts, true)` on-chain, then `min_mint_amount = (quotedLpAmount * (10000 - slippageBps)) / 10000`. Bigint arithmetic.
- **Decimal-string boundary:** user passes amounts as decimal strings (CLAUDE.md "decimal-aware arithmetic"); server resolves via per-pool `coinDecimals` (NOT via `get_token_metadata` — registry is source of truth to avoid round-trip RPC).
- **No sandwich-MEV refusal gate at v2.4.** Curve's stable pools have materially lower MEV exposure than Uniswap V3 (low-slippage stable invariant, sub-bps price impact for normal sizes). v2.6 MEV-01 may extend if production data justifies. Document the asymmetric treatment in the decoded preview block (CHECKS PERFORMED line: `Sandwich-MEV gate: not applied to Curve (low MEV exposure on stable pools)`).

### `get_curve_positions` read-only tool
- **Per-wallet, per-chain.** Multicall LP-token `balanceOf(wallet)` across all registered pools (one chain call per pool, batched).
- **Filter zero-balance pools.** Only emit per-pool entries where LP balance > 0 (consistent with `get_aave_v3_positions` zero-filter precedent).
- **Per-pool entry shape:** `{ poolAddress, displayName, abiVersion, lpBalance: string, lpDecimals: number, coins: [{ address, symbol?, decimals }], priceUnknown?: true }`. USD pricing for LP tokens is out of scope at v2.4 (Curve LP USD price requires `get_virtual_price` × pool TVL math; defer to v3.x portfolio enhancement).
- **READ-ONLY-by-construction invariant:** no `createHandle` import in `src/tools/get_curve_positions.ts`; asserted by module-load grep guard per Phase 7 `simulate_position_change` precedent.

### Fixture anchors (cryptographic-binding regression)
Per CLAUDE.md "Cryptographic-binding fixtures pinned as hardcoded literals" — add to `test/signing-fingerprint.test.ts`:
- **Fixture CRV-A:** legacy `exchange(int128 i, int128 j, uint256 dx, uint256 min_dy)` on stETH/ETH (hardcoded `0x...` payloadFingerprint literal).
- **Fixture CRV-B:** stable_ng `exchange(int128 i, int128 j, uint256 dx, uint256 min_dy, address _receiver)` with `_receiver = signer` (proves `from`-independent calldata when receiver is server-derived from sender).
- **Fixture CRV-C:** stable_ng `add_liquidity(uint256[] _amounts, uint256 _min_mint_amount)` for a 3-coin pool (proves dynamic-array calldata is byte-stable).

### Plan structure
- **Plan 34-01:** `src/config/contracts.ts` Curve curated pool registry (stETH/ETH + top-10 stable_ng plain pools enumerated by researcher) + `KNOWN_SPENDERS_ETHEREUM` promotion + canonical-dispatch Curve arm + `src/chains/curve.ts` (parseAbi struct refs for `exchange` / `add_liquidity` / `get_dy` / `calc_token_amount` / `balanceOf` LP-token reads).
- **Plan 34-02:** `get_curve_positions` (LP-balance multicall + zero-filter + per-pool composition); READ-ONLY-by-construction grep guard.
- **Plan 34-03:** `prepare_curve_swap` (per-`abiVersion` dispatch + on-chain `get_dy` quote + `min_dy` derivation) + `prepare_curve_add_liquidity` (registry-validated `amounts.length` + on-chain `calc_token_amount` quote + `min_mint_amount` derivation) + `src/protocols/curve.ts` selector-dispatch decoder + `preview_send` extension + Fixtures CRV-A/B/C hardcoded literals.

### Claude's Discretion
- Exact internal helper names (`CurvePoolReader`, `selectCurvePoolAbi`, `parseCurveAmounts`, etc.) — at executor's call.
- Registry size at execute time (10 or 12 entries; researcher curates by TVL; planner may right-size).
- Fixture literal anchor values (deterministically computed at test-write time).
- Whether to extract a shared `bps-slippage.ts` helper if `parseAmountStrict`-shape duplication emerges across UniV3 / Curve / future Phase 35 callers — only if duplication is non-trivial; default is per-protocol arithmetic inline.

</decisions>

<canonical_refs>
## Canonical References

- `CLAUDE.md` — conventions: `src/config/contracts.ts` SOT discipline, decimal-aware arithmetic, cryptographic-binding fixtures, ESM spy-affordance indirection
- `.planning/PROJECT.md` — project context + trust-pipeline invariants
- `.planning/REQUIREMENTS.md` — §CRV-01..03 exact Phase 34 surface
- `.planning/ROADMAP.md` — Phase 34 entry (lines for Phase 34 + Phase 35 boundary)
- `.planning/phases/32-evm-uniswap-v3-swap/32-CONTEXT.md` — UniV3 swap precedent (selector dispatch + slippage bps discipline)
- `.planning/phases/33-evm-uniswap-v3-lp-verb-set/33-CONTEXT.md` — UniV3 LP verb set precedent (composite-tx preview shape, registry-curated approach)
- `.planning/phases/07-aave-v3-ethereum/07-CONTEXT.md` — Aave V3 precedent (READ-ONLY-by-construction `simulate_position_change`, `from`-independent calldata)
- `.planning/phases/09-hardening-skill-verification-tools-dispatch-allowlist/09-04-PLAN.md` — canonical-dispatch allowlist wiring pattern
- `src/config/contracts.ts` — canonical contract-address SOT (extend here, don't inline)
- `src/security/canonical-dispatch.ts` — Layer 0.5 dispatch-allowlist gate (add Curve arm)
- `src/protocols/uniswap-v3.ts` — closest selector-dispatch decoder analog for `src/protocols/curve.ts`
- `src/tools/prepare_uniswap_swap.ts` — closest `prepare_*` analog for `prepare_curve_swap` (quote → slippage → calldata)
- `src/tools/get_aave_v3_positions.ts` — closest read-only-positions analog for `get_curve_positions`
- `test/signing-fingerprint.test.ts` — Fixtures CRV-A/B/C land here as hardcoded literals
- Curve docs — https://docs.curve.fi/ (pool ABI generations, `exchange` / `add_liquidity` signatures, `get_dy` / `calc_token_amount` quote functions)

</canonical_refs>

<specifics>
## Specific Ideas

- Curve's per-pool ABI variance is the single biggest correctness risk. Mitigation: registry tags every entry with `abiVersion`; `prepare_curve_swap` dispatches on the tag, not on heuristic ABI-probing at call time. Per-`abiVersion` Fixtures CRV-A (legacy) + CRV-B (stable_ng) anchor the byte-shape distinction.
- stETH/ETH legacy pool's `exchange` does NOT take a receiver param — funds always go to `msg.sender` (the signer). stable_ng `exchange` with explicit `_receiver` is the divergence; server always sets `_receiver = signer` to preserve byte-stable calldata under persona swap (T-INTEGRATION-FROM-DRIFT-shape from Phase 7 generalizes here).
- Add-liquidity slippage is loose by Curve convention — `min_mint_amount = 0` is a common pattern in scripts, but unsafe. Server enforces non-zero `slippageBps` (no zero-slippage default) and quotes `calc_token_amount` on-chain to anchor the floor.
- LP-token balances per pool are separate ERC-20s; the v1.2 top-50 token registry doesn't cover them. The pool registry's `lpToken` field is the SOT for `get_curve_positions` balance reads — no need for a sibling Curve-LP-token registry as initially sketched, since `lpToken` lives inline on each pool entry (corrects the placeholder).
- The Curve `coins(i)` view function returns the underlying-coin address at index `i`. Researcher can cross-check the registry's `coins[]` array against this on-chain view at test time as a registry-integrity assertion (analogous to `KNOWN_SPENDERS_ETHEREUM` byte-identity invariants).

</specifics>

<deferred>
## Deferred Ideas

- **3-coin meta-pools + Curve metaregistry-driven discovery** — v0.2 follow-up per upstream issue [#321](https://github.com/szhygulin/vaultpilot-mcp-gsd-inspired/issues/321). Phase 34 is curated-registry only.
- **`prepare_curve_remove_liquidity`** (single-side and balanced) — defer to v2.4.x. Add-liquidity ships first because it's the more common user intent and lower-complexity (no choice of `remove_liquidity_one_coin` vs `remove_liquidity` UX disambiguation).
- **Curve gauge staking + CRV claim flow** — defer to v2.4.x or v2.3-equivalent LIDO-style treatment (gauge staking is its own protocol surface).
- **Curve crypto / tricrypto pools** — defer; v2.4 is stable_ng + legacy stETH/ETH only. Tricrypto uses yet another ABI generation (`exchange_underlying`, different price impact math) — would double Phase 34 surface area.
- **LP USD pricing in `get_curve_positions`** — defer to v3.x portfolio enhancement. Requires `get_virtual_price` × pool TVL math; not load-bearing for v2.4 read surface.
- **Multi-chain Curve** (Polygon / Arbitrum / Base / Optimism) — defer to v2.4.x. Curve is multi-chain but Ethereum has materially higher pool diversity + TVL; multi-chain fan-out is a Phase 8-style follow-up.

</deferred>

---

*Phase: 34-evm-curve-swap-add-liquidity*
*Context locked: 2026-05-26*
