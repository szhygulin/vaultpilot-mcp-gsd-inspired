# Phase 43 Context: Curve legacy add_liquidity (fixed-array)

**Status:** Ready for planning
**Captured:** 2026-05-30
**Milestone:** v2.4.x follow-up (Deferred Backlog DB-4; originating Phase 34 / 34-03)
**Mode:** autonomous (no interactive discuss — decisions pre-locked below)

---

## Phase Goal

Lift the Phase 34 deferral: `prepare_curve_add_liquidity` is `stable_ng`-only and hard-refuses `abiVersion: "legacy"` pools. Add the legacy dispatch arm so the one legacy pool in the curated registry (stETH/ETH, 2-coin) can add liquidity through the same prepare → preview → send trust pipeline. This is the direct mirror, for `add_liquidity`, of the per-`abiVersion` dispatch that `prepare_curve_swap` already ships for `exchange`.

---

## Confirmed gap (evidence-backed, code-explorer 2026-05-30)

Legacy fixed-array `add_liquidity` is **completely unsupported** — explicitly refused, not silently broken:

- `src/tools/prepare_curve_add_liquidity.ts:177-185` — LOAD-BEARING `INVALID_INPUT` refusal on `pool.abiVersion === "legacy"`, fires before any amounts processing.
- `src/protocols/curve.ts` — no `encodeAddLiquidityLegacy`, no legacy `add_liquidity` selector in `CURVE_SELECTORS`, no `"add_liquidity-legacy"` discriminant in the `CurveDecoded` union, no matching branch in `decodeCurveCall`.
- `src/chains/curve.ts` — no `CURVE_LEGACY_ADD_LIQUIDITY_ABI` (only `CURVE_LEGACY_EXCHANGE_ABI` exists for `exchange`).
- `test/signing-fingerprint.test.ts` — fixtures CRV-A (legacy exchange), CRV-B (stable_ng exchange), CRV-C (stable_ng add_liquidity) exist; **no** legacy add_liquidity fixture.
- Phase 34 `34-RESEARCH.md` (lines 82, 288, 572, 582-585) explicitly defers it: legacy `add_liquidity(uint256[2], uint256)` is a fixed-size array, `@payable`, requires `msg.value` for the ETH leg.

Registry already carries the only legacy pool with full metadata — stETH/ETH (`0xDC24316b9AE028F1497c275EB9192a3Ea0f67022`), `coins=[ETH_SENTINEL, stETH]`, `coinDecimals=[18,18]`, separate `lpToken 0x0632...` (`src/config/contracts.ts` ~933-1079).

---

## Decision Log (pre-ratified — do NOT re-litigate in planning)

### D-01: Scope = stETH/ETH 2-coin legacy pool ONLY
The curated registry has exactly one legacy pool. Ship a fixed-arity `uint256[2]` ABI for it. Do NOT speculatively add 3POOL or other legacy pools / N-coin generality — that's scope creep against the "right-sized solution" rule. If a future legacy pool with different N_COINS is registered, a follow-up adds its ABI. **Rationale:** matches existing registry granularity; no unused abstraction.

### D-02: Mirror `prepare_curve_swap`'s `abiVersion` dispatch exactly
Replace the refusal block (`prepare_curve_add_liquidity.ts:177-185`) with a two-arm dispatch identical in shape to `prepare_curve_swap.ts:100-125`:
```
if (pool.abiVersion === "legacy") { data = _curveProtocol.encodeAddLiquidityLegacy(...); valueWei = isEthIn ? parsedAmounts[0] : 0n; }
else { ... existing stable_ng arm unchanged ... }
```
The stable_ng arm stays byte-identical. **Rationale:** house pattern; lowest-surprise; keeps the swap/add-liquidity tools structurally parallel.

### D-03: ETH-in handling via the existing CURVE_ETH_SENTINEL check
Legacy `add_liquidity` is `@payable`. coin[0] of stETH/ETH is the ETH sentinel (`0xEeee…`). When `amounts[0] > 0`: `valueWei = parsedAmounts[0]`; ERC-20 allowance pre-flight SKIPS index 0 (sentinel is not an ERC-20), checks only stETH (index 1). When `amounts[0] = "0"` (stETH-only deposit): `valueWei = 0n`. Reuse the same `CURVE_ETH_SENTINEL` comparison `prepare_curve_swap` uses for `isEthIn`. **Rationale:** identical ETH-sentinel semantics already proven in the swap tool.

### D-04: New protocol surface is additive + spy-affordance-wired at write time
Add to `src/chains/curve.ts`: `CURVE_LEGACY_ADD_LIQUIDITY_ABI = parseAbi(["function add_liquidity(uint256[2] amounts, uint256 min_mint_amount) payable returns (uint256)"])`. Add to `src/protocols/curve.ts`: a `legacy add_liquidity` selector entry in `CURVE_SELECTORS`, an `AddLiquidityLegacyParams` interface (`{ amounts: [bigint, bigint]; minMintAmount: bigint }`), `encodeAddLiquidityLegacy`, a `"add_liquidity-legacy"` discriminant + `("legacy", <selector>)` branch in `decodeCurveCall`, and expose `encodeAddLiquidityLegacy` through the existing `_curveProtocol` indirection object (at write time, per CLAUDE.md ESM spy-affordance rule). **Rationale:** mirrors the existing stable_ng surface; keeps the decoder a single SOT.

### D-05: Fixture CRV-D — hardcoded 0x literal, placeholder-literal workflow
Add Fixture **CRV-D** to `test/signing-fingerprint.test.ts`: legacy `add_liquidity(uint256[2], uint256)` on the stETH/ETH pool, **ETH-in path** (`amounts=[<eth>, 0]`, `valueWei>0`). Computed via the placeholder-literal workflow (write `0xPLACEHOLDER` → run vitest → pin actual → re-run green); NO `beforeAll`-snapshot. Export the constant; cross-link from `prepare-curve-add-liquidity` + `protocols-curve` tests. **Open sub-question for research (D-05a):** whether a SECOND fixture for the stETH-only path (`valueWei=0`) is warranted — since `valueWei` is a fingerprint dimension, the two paths produce different fingerprints. Default: anchor the ETH-in case (CRV-D); add CRV-E for the stETH-only case only if the planner judges it a materially distinct shape worth a regression anchor. (Lean: yes, add both — the `valueWei` branch is exactly the kind of preimage divergence the fixture discipline exists to catch.)

### D-06: FROZEN-area zero-diff, preview_send additive-only
`src/signing/payload-fingerprint.ts`, `presign-hash.ts`, `handle-store.ts`, `send_transaction.ts` byte-frozen (assert `git diff origin/main` empty in success criteria). `preview_send.ts` touched additively: new selector in the Curve arm's selector set + new `"add_liquidity-legacy"` case in `buildCurveDecodedArgsBlock`. If the existing `else if` selector union at the Curve arm can't be extended additively without restructuring, prefer a clean separate-arm restructure over an in-place rewrite that risks the stable_ng path. **Rationale:** project trust-pipeline invariant.

---

## Open Questions for Planning (research must resolve)

- **OQ-1 (load-bearing): `calc_token_amount` on the legacy stETH/ETH pool.** The stable_ng quote uses `calc_token_amount(uint256[], bool)`. The legacy StableSwapSTETH pool has `calc_token_amount(uint256[2], bool)` (fixed-array, distinct selector) — confirm the exact signature against the deployed contract / Vyper source, and whether the `is_deposit` bool is present in that pool's version. If usable → use it for `min_mint_amount`. If absent/mismatched → document a fallback (e.g. `get_virtual_price`-based proportional estimate) and keep the `slippageBps` floor as the real guard. Tag the verdict with source-of-truth per the `rnd` discipline.
- **OQ-2: exact legacy add_liquidity selector.** Compute `viem.toFunctionSelector("function add_liquidity(uint256[2],uint256)")` and pin it as a literal in `protocols-curve` test (selector byte-identity), distinct from stable_ng `0xb72df5de`.
- **OQ-3: tuple dispatch invariant.** Confirm `decodeCurveCall("legacy", <legacy add_liquidity selector>)` against a stable_ng pool address returns `null` (the `(abiVersion, selector)` tuple-dispatch invariant Phase 34 established), and add the negative test.

---

## What this phase delivers

A single focused plan (43-01): legacy ABI shelf entry + protocol encoder/decoder/selector + tool dispatch arm (refusal → legacy arm) + preview decode block + Fixture CRV-D (and likely CRV-E) + tests (selector byte-identity, encoder calldata, decoder branch + negative, prepare happy-paths ETH-in/stETH-in, preview block, FROZEN zero-diff). No new MCP tool, no new error code, no register-all change (tool already wired).

See `.planning/phases/34-evm-curve-swap-add-liquidity/` (34-03-PLAN.md, 34-RESEARCH.md, 34-PATTERNS.md) for the patterns to mirror.
