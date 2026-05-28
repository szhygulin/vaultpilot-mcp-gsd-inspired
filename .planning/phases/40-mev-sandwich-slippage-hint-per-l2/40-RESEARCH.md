# Phase 40: Sandwich-MEV slippage hint per-L2 thresholds (MEV-01) — Research

**Researched:** 2026-05-28
**Confidence:** HIGH (existing-gate mapping + test surface read from source); MEDIUM (per-L2 threshold values — engineering calibration from well-established mempool properties, not a live measurement)
**Note:** Compiled inline by the orchestrator after the researcher subagent stalled on a transient stream watchdog; all source-file claims verified by direct read/grep.

## Summary

Extend the EXISTING Phase-32 sandwich-MEV gate (fixed 200bps price-impact refusal) to per-chain thresholds via a new SOT, add a dedicated `SANDWICH_MEV_REFUSED` errorcode, and migrate both the EVM (Uniswap) and TRON (SunSwap) refusals to it. Curve stays gate-free by design. Pure swap-tool + config + errorcode + docs work — no trust-pipeline (FROZEN) files touched.

## Per-Chain Threshold Table (Q1 — load-bearing)

`src/config/sandwich-mev-thresholds.ts` → `Record<ChainId, { defaultSlippageBps: number; priceImpactRefusalPct: number }>`:

| Chain | defaultSlippageBps | priceImpactRefusalPct | Rationale |
|-------|--------------------|-----------------------|-----------|
| ethereum | 50 | 2.0 | UNCHANGED from Phase 32 baseline — public mempool, highest sandwich exposure |
| polygon | 100 | 2.0 | Public Bor mempool + active MEV searchers; higher default slippage tolerated by liquidity, refuse at same >2% as Ethereum |
| arbitrum | 30 | 3.0 | Centralized sequencer, private mempool — txs not public pre-ordering; sandwich structurally near-impossible on the L2; tighter default, more lenient refusal |
| optimism | 30 | 3.0 | Same private-sequencer property as Arbitrum |
| base | 30 | 3.0 | OP-stack private sequencer, same as Optimism |

**These are a CALIBRATION, not a security boundary.** Too-tight → false-refusal annoyance; too-loose → real sandwiches slip through. The private-sequencer claim for Arbitrum/OP/Base is well-established (centralized sequencers do not expose a public pending-tx mempool; L2-level sandwich requires sequencer collusion, out of the threat model here). Polygon PoS exposes a public mempool. [ASSUMED exact bps values — defensible engineering defaults; tune post-UAT if false-refusal rate is observed.]

## Existing-Gate Mapping (Q2 — exact)

**`src/tools/prepare_uniswap_swap.ts`:**
- `const SANDWICH_MEV_THRESHOLD_BPS = 200;` (line 110) — the fixed threshold to replace with per-chain SOT lookup.
- Gate (D-08): when `priceImpactBps > 200` AND `slippageBps` NOT explicitly supplied (raw-args presence check, line ~188) → refuse `INVALID_INPUT` + `SANDWICH_MEV_REFUSAL_ETHEREUM_TEMPLATE` (imported line 73) + `hintTool: "get_uniswap_quote"`.
- `DEFAULT_SLIPPAGE_BPS` default 50 (line ~280) — becomes the per-chain `defaultSlippageBps`.
- Price impact via `_uniswapV3PriceImpact` (line 85).
- **Minimal diff:** (a) resolve `{ defaultSlippageBps, priceImpactRefusalPct }` from the SOT keyed on `args.chain` (with `MEV_THRESHOLD_<CHAIN>` env override on the default); replace the literal `200` comparison with `priceImpactBps > priceImpactRefusalPct*100` and the literal `50` default with `defaultSlippageBps`; (b) change the refusal errorcode `INVALID_INPUT` → `SANDWICH_MEV_REFUSED`; enrich the structured refusal with chain name + threshold values + actual priceImpactBps.

**`src/tools/prepare_sunswap_swap.ts`:**
- D-03b gate, same shape: `priceImpactBps > 200` AND no explicit slippageBps → `INVALID_INPUT` + `SANDWICH_MEV_REFUSAL_TRON_TEMPLATE` (line 48) + `hintTool: "get_sunswap_quote"`.
- **Minimal diff:** errorcode `INVALID_INPUT` → `SANDWICH_MEV_REFUSED` ONLY. TRON is NOT in the EVM SOT — its 200bps threshold + template stay TRON-specific. Only the errorcode field migrates (consistency contract).

**`src/tools/prepare_curve_swap.ts`:** NO gate by design (Phase 34). Leave logic untouched; update the CHECKS-PERFORMED note (line ~17) to reference that the per-L2 sandwich SOT is Uniswap-scoped and Curve intentionally uses an explicit-slippage-only model.

## Test Migration Surface (Q3)

Tests asserting `INVALID_INPUT` on the SANDWICH path that must flip to `SANDWICH_MEV_REFUSED`:
- `test/prepare-uniswap-swap.test.ts` — the sandwich-MEV refusal cases (subset of its 17 INVALID_INPUT assertions; identify the ones near `priceImpact`/`SANDWICH_MEV`/`slippageBps`-omitted). Other INVALID_INPUT cases (bad slippage bounds, same-token, malformed amount, allowance) stay INVALID_INPUT.
- `test/prepare-sunswap-swap.test.ts` — the sandwich-MEV refusal cases (subset of 11). Same discrimination.
- ALSO add new cases: per-chain threshold behavior (Polygon refuses at lower bar than Arbitrum for the same impact), env-override valid + invalid, the new SOT, and a Curve-stays-gate-free regression (Curve never returns SANDWICH_MEV_REFUSED).
- `test/prepare-curve-swap.test.ts` (18 INVALID_INPUT) — NOT migrated; Curve has no sandwich gate. Add one assertion that Curve never emits SANDWICH_MEV_REFUSED.
- `test/get-uniswap-quote.test.ts` (16 INVALID_INPUT) — those are other validations; `get_uniswap_quote` emits a WARNING not a refusal. See Q6.

## ErrorCode + Refusal Shape (Q4)

- Append `"SANDWICH_MEV_REFUSED"` to the `ErrorCode` union in `src/signing/error-codes.ts` (append-only; current tail `DECODED_RECIPIENT_DRIFT` line 358) with a per-code comment block matching the existing convention.
- Structured refusal (via the existing `errEnvelope` shape): errorCode `SANDWICH_MEV_REFUSED`, message naming chain + the per-chain threshold (defaultSlippageBps / priceImpactRefusalPct) + the actual priceImpactBps + the `slippageBps`-override hint. Keep the existing `hintTool` (`get_uniswap_quote` / `get_sunswap_quote`). Refusal TEMPLATES (`SANDWICH_MEV_REFUSAL_ETHEREUM_TEMPLATE`, `SANDWICH_MEV_REFUSAL_TRON_TEMPLATE`) stay — only the errorcode field + a chain/threshold detail line change.

## SOT + Lazy-Load + Env Override (Q5)

- `src/config/sandwich-mev-thresholds.ts`: module-const `Record<ChainId, {...}>` over the EVM `ChainId` union from `src/chains/registry.ts`. A resolver `getSandwichThresholds(chainId)` that layers the `MEV_THRESHOLD_<CHAIN>` env override (e.g. `MEV_THRESHOLD_POLYGON=200`) over the default `defaultSlippageBps`. Override validates as a positive integer (`1..10000` to match the existing slippage bounds); invalid → refuse (or fall back to default with a stderr warning — planner picks; prefer refuse-on-invalid per CONTEXT). Follow the lazy env-read pattern used by other env helpers (e.g. RPC/API-key resolvers) — read at call time, not module load, so tests can stub `process.env`.

## get_uniswap_quote Warning Threshold (Q6)

`get_uniswap_quote.ts` has `SANDWICH_MEV_WARNING_THRESHOLD_BPS = 200` (line 69) used at line ~459 to attach a WARNING (not a refusal) when impact exceeds it. **Recommendation: have it read the per-chain SOT's `priceImpactRefusalPct` so the warning and the refusal track the same per-chain bar** — cheap and consistent (the quote-warning should fire at the same impact level the prepare-refusal would). If the planner finds the quote tool lacks a clean `chain` in scope, leave it fixed and note the asymmetry.

## FROZEN Check (Q7)

None of the touched files are FROZEN trust-pipeline files. `payload-fingerprint.ts`, `presign-hash.ts`, `send_transaction.ts` three gates, handle-store state machine, and the bridge decoders are all untouched. The errorcode union + blocks templates are append/edit-the-errorcode-field-only. Assert zero-diff on the FROZEN set as a success criterion regardless.

## Validation Architecture

### Test Framework
| Property | Value |
|---|---|
| Framework | vitest (existing) |
| Quick run | `npx vitest run test/prepare-uniswap-swap.test.ts test/prepare-sunswap-swap.test.ts test/sandwich-mev-thresholds.test.ts` |
| Full suite | `npx vitest run` |

### Requirement → Test Map (MEV-01)
| Behavior | Test type | Command | File |
|---|---|---|---|
| SOT exposes per-chain `{defaultSlippageBps, priceImpactRefusalPct}` for all 5 EVM chains | unit | `npx vitest run test/sandwich-mev-thresholds.test.ts` | ❌ W0 |
| `MEV_THRESHOLD_<CHAIN>` override applies (valid positive int) | unit | same | ❌ W0 |
| `MEV_THRESHOLD_<CHAIN>` invalid (non-int / ≤0 / >10000) refuses | unit | same | ❌ W0 |
| Uniswap refuses with `SANDWICH_MEV_REFUSED` (not INVALID_INPUT) at the per-chain bar | unit | `npx vitest run test/prepare-uniswap-swap.test.ts` | exists (migrate) |
| Per-chain bar differs: same impact refuses on Polygon-bar but passes on Arbitrum-bar | unit | same | ❌ W0 |
| SunSwap (TRON) refuses with `SANDWICH_MEV_REFUSED` (errorcode migrated) | unit | `npx vitest run test/prepare-sunswap-swap.test.ts` | exists (migrate) |
| Curve never emits `SANDWICH_MEV_REFUSED` (stays gate-free) | unit | `npx vitest run test/prepare-curve-swap.test.ts` | exists (add 1) |
| Refusal text names chain + thresholds + actual impact + slippage-override hint | unit | uniswap test | ❌ W0 |
| FROZEN set zero-diff vs origin/main | source | `git diff origin/main -- <frozen set>` empty | n/a |

### Wave 0 Gaps
- [ ] `src/config/sandwich-mev-thresholds.ts` SOT + resolver + env override
- [ ] `test/sandwich-mev-thresholds.test.ts`
- [ ] append `SANDWICH_MEV_REFUSED` to ErrorCode union
- [ ] migrate Uniswap + SunSwap sandwich refusals (errorcode + per-chain threshold for Uniswap)
- [ ] migrate the sandwich-path test assertions in prepare-uniswap-swap.test.ts + prepare-sunswap-swap.test.ts
- [ ] SECURITY.md per-L2 MEV section + v2.6 milestone close-out

## Security Domain
| ASVS | Applies | Control |
|---|---|---|
| V5 Input Validation | yes | env-override integer validation; per-chain threshold bounds |
| V11 Business Logic | yes | per-chain sandwich-MEV refusal calibrated to actual mempool exposure |

| Threat | STRIDE | Mitigation |
|---|---|---|
| Sandwich attack on a high-MEV chain at a too-loose global threshold | Tampering (econ) | per-chain refusal bar — Polygon/Ethereum stay strict |
| False-refusal annoyance on private-sequencer L2s drives users to disable the gate | (usability→security) | more lenient L2 refusal bar (>3%) reduces false positives without exposing real risk |
| Env override used to silently disable the gate | Tampering | override validates bounds; cannot set an impossible threshold; refusal still fires above the (relaxed) bar |

## RESEARCH COMPLETE
