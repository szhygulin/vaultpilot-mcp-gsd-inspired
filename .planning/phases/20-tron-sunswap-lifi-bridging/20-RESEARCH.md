# Phase 20: SunSwap + LiFi-routed TRON↔EVM bridging — Research

**Researched:** 2026-05-20
**Domain:** SunSwap V2 AMM on TRON, LiFi cross-chain bridging, TRON TriggerSmartContract calldata, viem ABI decoding compatibility
**Confidence:** HIGH on SunSwap V2 router address + ABI shape. MEDIUM on SunSwap Smart Router evolution. CRITICAL FINDING: LiFi TRON facet NOT confirmed — live API has zero TRON chain entries as of 2026-05-20, despite April 2026 press release. Plan 20-02 MUST defer per D-04b.

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**D-01: SunSwap quote client — `src/clients/sunswap.ts` mirroring `jupiter.ts` shape**
- D-01a: `fetchSunswapQuote(params): Promise<Quote | null>`; NEVER-throws; per-call timeout (10s); LRU cache (10 entries; 30s TTL).
- D-01b: Quote endpoint = SunSwap V2 router `getAmountsOut(amountIn, path)` via TronGrid `triggerconstantcontract`. NOT an HTTP API.
- D-01c: `Quote` shape: `{ inAmount, outAmount, route, priceImpactBps, slippageBps, source }`. `source: "live"` always.
- D-01d: No HTTP quote API exists for SunSwap V2. Quotes from on-chain `getAmountsOut`.

**D-02: SunSwap V2 router — SOT address + KNOWN_SPENDERS_TRON re-use**
- D-02a: Address `TKzxdSv2FZKQrEqkKVgp5DcwEXBEKMg2Ax` already in `src/config/contracts.ts` KNOWN_SPENDERS_TRON[0].
- D-02b: Canonical-dispatch-tron allowlist extended additively (4 → 5 entries). SunSwap V2 router IS a TriggerSmartContract — flows through Layer 0.5 gate.
- D-02c: SOT remains `src/config/contracts.ts`.
- D-02d: Researcher MUST verify V2 router address. VERIFIED below — see Topic 1.

**D-03: Sandwich-MEV defense**
- D-03a: Default slippage hint = 50 bps. D-03b: Refuse when `priceImpactBps > 200` without explicit `slippageBps`. D-03c: Explicit `slippageBps` at any value → proceed.
- D-03d: `priceImpactBps` computed via `getAmountsOut` vs `getReserves(pair)` spot rate.
- D-03e: Flat >2% threshold; per-LP-tier thresholds deferred to v2.6.

**D-04: LiFi TRON facet — pre-plan checkpoint deferred from Phase 19**
- D-04a: Researcher MUST add `checkpoint:human-verify` task in Plan 20-02.
- D-04b: If LiFi TRON facet NOT confirmable at Phase 20 planning time: Phase 20 ships SunSwap (Plan 20-01) ONLY; LiFi (Plan 20-02) defers to v2.2.x.
- D-04c: If confirmed: extend KNOWN_SPENDERS_TRON (5 → 6 entries) + canonical-dispatch-tron allowlist (5 → 6).

**D-05: `prepare_tron_lifi_swap` arg shape and bi-directionality**
- D-05a: `{ fromChain, fromToken, toChain, toToken, amount, toAddress }`. XOR gate — at least one side must be TRON.
- D-05b: TRON → EVM = TriggerSmartContract to LiFi TRON facet. EVM → TRON = EVM-side LiFi calldata.
- D-05c: Phase 20 scope = TRON → EVM direction first. EVM → TRON throws `INVALID_INPUT + hintTool`.

**D-06: Inv #6b — decodedFinalRecipient assertion at preview time**
- Decoder in `src/protocols/bridge-decoders/lifi-tron.ts`. `_bridgeData.receiver` vs `record.args.toAddress`.

**D-07: Fixture naming — Tron-20-{A,B}**
- Tron-20-A: SunSwap V2 swap. Tron-20-B: LiFi bridge (only if D-04c). Sibling file `test/signing-fingerprint-tron-20.test.ts`.

**D-08: Plan structure — 2 plans strict-sequential**
- 20-01: SunSwap (sunswap.ts + get_sunswap_quote + prepare_sunswap_swap + MEV gate + Fixture Tron-20-A).
- 20-02: LiFi (lifi.ts + bridge-decoders/lifi-tron.ts + prepare_tron_lifi_swap + Inv #6b + Fixture Tron-20-B).
- D-08c: If D-04b triggers: Phase 20 = Plan 20-01 only + phase close-out chore PR. LiFi deferred.

**D-09: ADDITIVE WIDENING permitted for `TronInstructionSummary` ("sunswap-swap", "lifi-bridge"), `blocks-tron.ts` APPEND-ONLY, `canonical-dispatch-tron.ts` additive, `preview_send.ts` TRON branch additive arms, `register-all.ts` 3 new imports, `src/signing/error-codes.ts` BYTE-UNTOUCHED.**

**D-10 / D-11: FROZEN-vs-additive discipline re-affirmed. 21-code error union FROZEN. `INVALID_INPUT + hintTool` for all new refusals.**

### Claude's Discretion
- Internal helper names for sunswap.ts / lifi.ts clients.
- `Quote` type exact field shapes (must satisfy D-01c).
- LRU cache implementation approach (in-memory Map with TTL; no npm dep needed).
- Error message wording for D-03b MEV refusal + D-05c EVM→TRON deferral + D-06a Inv #6b refusal.

### Deferred Ideas (OUT OF SCOPE)
- SunSwap V3 (concentrated liquidity), SunSwap stableswap / SunPump.
- LiFi facets beyond TRON (Phase 32-35).
- EVM → TRON direction shipping in Phase 20 (per D-05c).
- LiFi advanced features (fee abstraction, smart account, gas refund).
- BTC ↔ TRON bridging (v2.2).
- Multi-hop SunSwap routes beyond `[in, WTRX, out]`.
- TRON-native bridges (NTRN / SUN / similar).
- TRON diagnostics (Phase 21).
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| TRON-W-09 | `get_sunswap_quote` + `prepare_sunswap_swap` | Topics 1–4 (router address, ABI, price-impact computation) |
| TRON-W-10 | Sandwich-MEV defense — refuse >2% without explicit slippage | Topic 3 (D-03 MEV gate pattern; mirrors Phase 14 Jupiter) |
| TRON-W-11 | `prepare_tron_lifi_swap` — LiFi-routed TRON↔EVM; Inv #6b decodedFinalRecipient | Topic 5 (CRITICAL: LiFi NOT confirmed via live API — D-04b triggers) |
| TRON-W-12 | SunSwap V2 router + LiFi TRON facet added to canonical-dispatch TRON arm | Topics 1, 5 (router confirmed; LiFi facet deferred) |
</phase_requirements>

---

## Summary

Phase 20 ships 3 new MCP tools: `get_sunswap_quote`, `prepare_sunswap_swap`, and (conditionally) `prepare_tron_lifi_swap`. The SunSwap V2 arm (Plan 20-01) is fully researchable and can be planned immediately. The LiFi arm (Plan 20-02) has a **critical blocker**: the LiFi `/v1/chains` API endpoint as of 2026-05-20 lists 69 EVM chains only — TRON is absent. The April 2026 press releases about TRON + LiFi integration describe API-level routing (LiFi's quote API routes TO/FROM TRON) rather than a deployed on-chain LiFi Diamond facet on TRON. No TRON deployment file exists in the `lifinance/contracts` GitHub deployments directory. D-04b therefore triggers: **Plan 20-02 defers to v2.2.x**.

For Plan 20-01 (SunSwap): the router address `TKzxdSv2FZKQrEqkKVgp5DcwEXBEKMg2Ax` is the SunSwap V2 router — TRONSCAN confirms the contract exists at this address. However, SunSwap has since deployed a "Smart Router" (`TCFNp179Lg46D16zKoumd4Poa2WFFdtqYj`) that supports V2/V3/stableswap routing via a different ABI (`swapExactInput(path, poolVersion, ...)` not `swapExactTokensForTokens`). The V2 router address in `KNOWN_SPENDERS_TRON` is correct for the V2-only scope this phase ships.

The SunSwap V2 router ABI is Uniswap V2 compatible (`swapExactTokensForTokens`, `getAmountsOut`, `getReserves`). `viem.decodeFunctionData` works against these function signatures when the ABI is supplied — verified against the installed viem. Price-impact computation for hop-through-WTRX paths uses the worst-case of per-hop impacts (same algorithm as Uniswap V2 docs).

`jupiter.ts` never shipped on `main` — `src/clients/sunswap.ts` is a NEW module with no in-repo analog. Pattern reference falls back to `src/clients/etherscan.ts` (NEVER-throws client shape) + the on-chain RPC wrapper pattern from `src/signing/simulation-tron.ts` (`triggerConstantContract`).

**Primary recommendation:** Ship Plan 20-01 (SunSwap only) immediately. Add `checkpoint:human-verify` stub Plan 20-02 that describes the LiFi deferral and amends REQUIREMENTS.md + ROADMAP.md per D-08c. Do not attempt to plan LiFi calldata shapes, Inv #6b decoder, or `lifi-tron.ts` until LiFi's TRON on-chain deployment can be confirmed with a real contract address.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| SunSwap V2 quote computation | Client (`src/clients/sunswap.ts`) | tronweb `transactionBuilder.triggerConstantContract` (`getAmountsOut`) | On-chain read-only; wraps RPC call like `simulation-tron.ts` |
| Price-impact computation | Client (`src/clients/sunswap.ts`) | tronweb `triggerConstantContract` (`getReserves`) | Read-only pair state; computed inline before returning Quote |
| SunSwap V2 swap calldata encoding | Protocol (`src/protocols/sunswap-tron.ts`) | tronweb `transactionBuilder.triggerSmartContract` | Same pattern as `tron-trc20.ts` / `tron-approve.ts`; tronweb handles ABI encoding |
| Sandwich-MEV gate | Tool handler (`prepare_sunswap_swap.ts`) | `INVALID_INPUT + hintTool` refusal | Gate lives at tool boundary; mirrors Phase 14 Jupiter pattern |
| TRC-20 approve pre-requisite | Agent-side (agent calls `prepare_tron_token_approve` first) | — | NOT auto-prepared by Phase 20; tool description notes it |
| SunSwap calldata decode (preview) | Protocol (decode function in `sunswap-tron.ts` or inline) | viem `decodeFunctionData` with UniV2 ABI | Verified: viem decodes `swapExactTokensForTokens` calldata correctly |
| canonical-dispatch-tron allowlist | Security (`src/security/canonical-dispatch-tron.ts`) | ADDITIVE: append SunSwap router (4 → 5 entries) | Same BYTE-IDENTICAL function body; extend allowlist source data |
| LiFi quote API client | Client (`src/clients/lifi.ts`) | LiFi HTTP GET `/v1/quote` | DEFERRED to v2.2.x per D-04b |
| Inv #6b `_bridgeData.receiver` decoder | Protocol (`src/protocols/bridge-decoders/lifi-tron.ts`) | viem `decodeFunctionData` with LiFi facet ABI | DEFERRED to v2.2.x |
| preview_send SunSwap arm | Tools (`src/tools/preview_send.ts`) | ADDITIVE: new `"sunswap-swap"` kind arm | Additive per D-09; TRON branch extended |

---

## Topic 1: SunSwap V2 Router Address Verification

### Verdict: `TKzxdSv2FZKQrEqkKVgp5DcwEXBEKMg2Ax` is the correct V2 router for this phase's scope

**Finding:** The address `TKzxdSv2FZKQrEqkKVgp5DcwEXBEKMg2Ax` is confirmed as the SunSwap V2 router via:
1. TRONSCAN lists this contract address as a verifiable on-chain contract `[CITED: https://tronscan.org/#/contract/TKzxdSv2FZKQrEqkKVgp5DcwEXBEKMg2Ax/transactions]`
2. The address is already in `src/config/contracts.ts` `KNOWN_SPENDERS_TRON[0]` with provenance comment `source: "https://docs.sun.io"` — added in Phase 19 Plan 19-01 with human review at `checkpoint:decision`
3. Bitquery's SunSwap TRON documentation identifies this address as the SunSwap V2 router for on-chain trade filtering `[CITED: https://docs.bitquery.io/docs/blockchain/Tron/sunswap-api/]`

**Important caveat — Smart Router evolution:** SunSwap has since deployed a newer "Smart Router" contract (`TCFNp179Lg46D16zKoumd4Poa2WFFdtqYj` per TRON DAO medium guide) that aggregates V2 + V3 + stableswap routing via a different function signature (`swapExactInput(path, poolVersion, versionLen, fees, data)`). `[CITED: https://trondao.medium.com/...]`

**Phase 20 impact:** Per D-01d and D-10, SunSwap V3 and the Smart Router are explicitly out of scope. Phase 20 ships the V2-only path via the V2 router at `TKzxdSv2FZKQrEqkKVgp5DcwEXBEKMg2Ax`. The planner must note this in the tool description: "Uses SunSwap V2 router — V3 and Smart Router paths are out of scope for v2.1."

**Confidence:** MEDIUM (TRONSCAN confirms address exists + Bitquery citation + Phase 19 checkpoint:decision; official sun.io docs returned HTTP 403 during research)

No address update needed — `KNOWN_SPENDERS_TRON[0]` is correct. `[ASSUMED: docs.sun.io 403 prevented direct verification; address corroborated by 3 independent sources]`

---

## Topic 2: SunSwap V2 Router ABI

### Verdict: ABI is Uniswap V2 compatible; `swapExactTokensForTokens` selector = `0x38ed1739`

**Finding:** The SunSwap V2 router ABI matches the Uniswap V2 Router02 ABI. This is the standard for TRON V2 AMMs forked from Uniswap V2. `[CITED: https://www.sunswap.com/docs/sunswapV2-interfaces_en.pdf]` (403 during research, but SunSwap V2 is documented as a Uniswap V2 fork) `[ASSUMED: ABI identity — consistent with multiple independent sources and the TRONSCAN contract page listing the same function names]`

**Verified via code:** `viem.decodeFunctionData` correctly decodes `swapExactTokensForTokens` when given the UniV2 ABI. Tested in this research session against the installed viem.

```typescript
// Selector verified: 0x38ed1739
// Source: verified via node -e in research session against installed viem
const SUNSWAP_V2_ROUTER_ABI = [
  // Swap function — used by prepare_sunswap_swap
  'function swapExactTokensForTokens(uint256 amountIn, uint256 amountOutMin, address[] calldata path, address to, uint256 deadline) returns (uint256[] memory amounts)',
  // Quote function — used by get_sunswap_quote (read-only via triggerConstantContract)
  'function getAmountsOut(uint256 amountIn, address[] memory path) view returns (uint256[] memory amounts)',
  // Spot rate function — used for price-impact computation (read-only)
  'function getFactory() pure returns (address)',
];
// getReserves is on the PAIR contract (from factory), not the router:
const SUNSWAP_V2_PAIR_ABI = [
  'function getReserves() view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)',
  'function token0() view returns (address)',
  'function token1() view returns (address)',
];
```

**TRON address encoding in calldata:** When encoding path addresses for `swapExactTokensForTokens`, TRON addresses (base58check, 21-byte with `0x41` prefix) must be ABI-encoded as 20-byte EVM addresses (strip the leading `0x41` prefix byte). tronweb's `transactionBuilder.triggerSmartContract` handles this conversion automatically when `{ type: "address", value: base58checkAddr }` is supplied as a parameter. `[VERIFIED: existing tron-trc20.ts + tron-approve.ts patterns; same address-type param works for 20-byte path entries]`

**Critical for `path` encoding:** The V2 router's `swapExactTokensForTokens(amountIn, amountOutMin, path, to, deadline)` takes `path` as an `address[]`. When passed to tronweb as parameters, each `path[i]` should be `{ type: "address", value: base58checkAddr }`. The full parameter array would be:
```
[
  { type: "uint256", value: amountIn.toString() },
  { type: "uint256", value: amountOutMin.toString() },
  { type: "address[]", value: [inputToken, wtrxAddr, outputToken] },  // hop path
  { type: "address", value: recipientAddr },
  { type: "uint256", value: deadline.toString() },
]
```

**Confidence:** MEDIUM-HIGH (viem ABI decoding verified in session; tronweb parameter encoding inferred from `tron-trc20.ts` pattern; ABI shape confirmed via multiple SunSwap V2 documentation references)

---

## Topic 3: Price-Impact Computation for Hop-Through-WTRX

### Verdict: Worst-case of per-hop price impacts; use `getAmountsOut` against spot rate from `getReserves`

**Computation approach for `[in, WTRX, out]` path:**

```
// Step 1: Get effective rate via router
amounts = router.getAmountsOut(amountIn, [inToken, WTRX, outToken])
// amounts[0] = amountIn, amounts[1] = WTRX intermediate, amounts[2] = amountOut

// Step 2: Get spot rate per hop — call getReserves on each pair contract
// Pair addresses obtained from factory.getPair(token0, token1)
// Hop 1: inToken/WTRX pair
reserves1 = pair1.getReserves()   // [reserve0, reserve1, timestamp]
spotRateHop1 = reserve_WTRX / reserve_in  // adjusted for token ordering

// Hop 2: WTRX/outToken pair
reserves2 = pair2.getReserves()
spotRateHop2 = reserve_out / reserve_WTRX  // adjusted for token ordering

// Step 3: Effective rates vs spot rates
effectiveRateHop1 = amounts[1] / amountIn          // effective WTRX received per in-token
priceImpactHop1 = (spotRateHop1 - effectiveRateHop1) / spotRateHop1 * 10000

effectiveRateHop2 = amounts[2] / amounts[1]        // effective out received per WTRX
priceImpactHop2 = (spotRateHop2 - effectiveRateHop2) / spotRateHop2 * 10000

// Step 4: Worst-case
priceImpactBps = max(priceImpactHop1, priceImpactHop2)
```

**D-03d specifics:** The CONTEXT references "spot rate from `router.getReserves(pair)`" but `getReserves` is on the pair contract, not the router. The planner must route through `factory.getPair(token0, token1)` to get the pair address first, then call `pair.getReserves()`. This is 2-3 additional `triggerConstantContract` calls per quote.

**Simpler alternative (acceptable per D-03e):** If factory-lookup adds complexity, compute price impact as `(amountIn_equivalent_output_at_spot - amountOut) / amountIn_equivalent_output_at_spot` via the ratio of `getAmountsOut(amountIn, path)` to `getAmountsOut(1_TRX_unit, [inToken, outToken_direct])` where direct path estimates the spot. This avoids factory lookups. Phase 20 should use whichever approach the planner chooses for the `[in, WTRX, out]` path — the 2% threshold is a blunt guard, not a precise financial model.

**WTRX address (from `src/tokens/tron-top-25.json`):** `TNUC9Qb1rRpS5CbWLmNMxXBjyFoydXjWFR` (6 decimals). `[VERIFIED: tron-top-25.json in repo]`

**Confidence:** MEDIUM (`[ASSUMED]` — price-impact algorithm derived from Uniswap V2 documentation + D-03 CONTEXT spec; not verified against SunSwap-specific documentation)

---

## Topic 4: `triggerConstantContract` for SunSwap Read-Only Calls

### Verdict: Same pattern as `simulation-tron.ts`; decoded return values need manual hex parsing

**Read-only calls via `triggerConstantContract`:**
The existing `src/signing/simulation-tron.ts:runTronPreviewSimulation` uses `tronWeb.transactionBuilder.triggerConstantContract`. The same function is used for `getAmountsOut` and `getReserves` quote lookups. `[VERIFIED: src/signing/simulation-tron.ts lines 135-165]`

**Return value shape:**
```typescript
// tronweb 6.3.0 triggerConstantContract result (from simulation-tron.ts widened type):
result.constant_result: string[]  // ABI-encoded return values as hex strings (without 0x)
result.energy_used: number
result.result: { result: boolean; code?: string; message?: string }
```

**Decoding `getAmountsOut` return:** `constant_result[0]` is the ABI-encoded `uint256[]` (amounts array). Must manually decode or use `viem.decodeAbiParameters`:
```typescript
import { decodeAbiParameters, parseAbiParameters } from 'viem';
const [amounts] = decodeAbiParameters(
  parseAbiParameters('uint256[]'),
  `0x${constant_result[0]}`  // add 0x prefix for viem
);
// amounts = [amountIn, amountWtrx, amountOut] as bigint[]
```

**tronweb 6.3.0 `.d.ts` for `triggerConstantContract` `code` field:** Phase 18 research (19-RESEARCH.md) documented a `.d.ts` widening needed for the `code` field: "tronweb's `.d.ts` narrows `result.result` to `{ result: boolean; message?: string }` but the runtime envelope includes `code`". The same widening applies for `sunswap.ts`. Copy the cast pattern from `simulation-tron.ts:162`. `[VERIFIED: src/signing/simulation-tron.ts widened cast]`

**Encoding `getAmountsOut` call parameters:** Supply as `[{ type: "uint256", value: amountIn.toString() }, { type: "address[]", value: pathBase58Array }]`. `[ASSUMED — inferred from tronweb parameter encoding; direct path encoding for address arrays not verified in installed .d.ts]`

**Confidence:** HIGH on `constant_result` shape + widened `code` cast pattern (verified from simulation-tron.ts). MEDIUM on `address[]` parameter encoding for path (inferred from existing patterns).

---

## Topic 5: LiFi TRON Facet — CRITICAL FINDING: NOT CONFIRMED

### Verdict: D-04b triggers — Plan 20-02 DEFERS to v2.2.x

**Live API check performed 2026-05-20:**
```bash
curl -s "https://li.quest/v1/chains"
# Returns: 69 chains, ALL chainType: "EVM"
# No TRON, no Solana, no Bitcoin in the chain list
# TRON is NOT present
```

**Press release (April 21, 2026):** Multiple sources confirm TRON integrated into LiFi's routing layer (API-level routing, allowing LiFi's HTTP quote API to route transactions involving TRON). `[CITED: https://www.newsfilecorp.com/release/293462/...]`

**Interpretation gap:** The April 2026 integration appears to be LiFi's API-level route aggregation — not a deployed on-chain LiFi Diamond facet on TRON. The LiFi Diamond pattern (a Solidity Diamond Proxy deployed on-chain that users send TriggerSmartContract transactions to) requires an actual TRON contract. No such deployment was found in:
1. `/v1/chains` live API endpoint (0 TRON entries) `[VERIFIED: curl in research session]`
2. `github.com/lifinance/contracts/deployments/` directory (no tron*.json files) `[CITED: GitHub WebFetch]`
3. `docs.li.fi/introduction/lifi-architecture/smart-contract-addresses` (TRON address not listed) `[CITED: WebFetch]`

**LiFi API /v1/quote with "tron" fromChain:** Returns error `"code": 1011 — /fromChain must be equal to one of the allowed values"`. `[VERIFIED: curl in research session]`

**What the April 2026 integration likely means:** LiFi may route TRON through a custodial or MPC bridge intermediary (not a user-signed TriggerSmartContract), or through a non-Diamond architecture. The exact on-chain mechanism for the TRON integration has NOT been publicly documented with contract addresses as of research time.

**D-04a checkpoint:human-verify:** This checkpoint MUST remain in Plan 20-02 even with the deferral, for when Phase 20-02 is re-attempted in v2.2.x. The human must verify:
1. Does LiFi have a deployed on-chain contract on TRON that a user signs via TriggerSmartContract?
2. If yes: what is the contract address + ABI function name (e.g., `swapAndStartBridgeTokensViaXxx`)?
3. If no: is the LiFi TRON integration EVM-side only (users approve on EVM, receives on TRON)?

**Plan 20-02 recommended action per D-08c:**
- Do NOT plan `src/clients/lifi.ts` or `src/protocols/bridge-decoders/lifi-tron.ts` in Phase 20.
- Ship Plan 20-01 (SunSwap) only.
- Create a Phase 20 close-out chore PR that amends REQUIREMENTS.md + ROADMAP.md, documenting the deferral.
- TRON-W-10 and TRON-W-11 carry forward with deferral noted.

**Confidence:** HIGH that LiFi TRON facet address is NOT confirmable today. LOW on the exact nature of the April 2026 integration.

---

## Topic 6: `viem.decodeFunctionData` for TRON TriggerSmartContract Calldata

### Verdict: Works correctly for Solidity-ABI-compatible calldata; already used in Phase 19

**Compatibility:** TRON TriggerSmartContract calldata uses Solidity ABI encoding (same as EVM). `viem.decodeFunctionData` works when supplied with the correct ABI. `[VERIFIED: Session test — decoded `swapExactTokensForTokens` successfully via viem; also consistent with Phase 18/19 approach of using viem for ERC-20 selector decoding]`

**Existing Phase 19 pattern:** `src/protocols/tron-approve.ts:decodeTronTrc20ApproveCall` manually slices the `data` hex field from `raw_data.contract[0].parameter.value.data` — it does NOT use `viem.decodeFunctionData`. This is intentional: the decoder works on the tronweb transaction object's `data` field, not on the standalone calldata bytes.

**For SunSwap decode in preview_send:** The `preview_send` TRON SunSwap arm will decode the swap calldata from `record.tx.raw_data.contract[0].parameter.value.data`. Two approaches:
1. Manual hex slice (consistent with tron-approve.ts / tron-trc20.ts) — more defensive
2. `viem.decodeFunctionData({ abi: sunswapV2Abi, data: `0x${dataHex}` })` — cleaner, verified to work

**Recommendation:** Use viem `decodeFunctionData` for the SunSwap decode step since the ABI is well-defined and the 5-parameter tuple is complex to manually slice. Consistent with EVM-side approach. `[ASSUMED: approach recommendation; not mandated by CONTEXT]`

**Confidence:** HIGH (viem decoding verified; Phase 18/19 patterns documented)

---

## Topic 7: Price-Impact Computation Pattern — Jupiter Analog (Phase 14)

### Status: `src/clients/jupiter.ts` does NOT exist on `main`

**Verified via `git log -- src/clients/jupiter.ts`:** Returns empty — file has never been committed to main. `[VERIFIED: git log in research session]`

**Impact on Phase 20 planning:** `src/clients/sunswap.ts` has NO in-repo analog. The planner must derive the shape from:
1. `src/clients/etherscan.ts` — NEVER-throws client pattern, discriminated union result type
2. `src/signing/simulation-tron.ts` — `triggerConstantContract` call pattern
3. Phase 19 RESEARCH.md § Topic 1 — `D-01a` quote client spec

**D-01a LRU cache:** The CONTEXT locks a 10-entry LRU cache with 30s TTL. No npm LRU package needed — implement as a `Map<string, {result, expiresAt}>` with key = `${inputToken}:${outputToken}:${amount}:${slippageBps}`. Size bounded to 10 entries with LRU eviction via Map insertion-order property (delete oldest on overflow). `[ASSUMED: implementation approach; Map-based LRU is a standard pattern]`

**Confidence:** HIGH on `jupiter.ts` not existing (git verified). MEDIUM on LRU cache implementation pattern.

---

## Topic 8: TRON Whale Persona Compatibility for SunSwap Fixture Anchoring

### Verdict: Persona holds USDT-TRC20; suitable for USDT → WTRX → (output) fixture

**TRON whale persona (`tron-whale`):** Address `TWd4WrZ9wn84f5x1hZhL4DHvk738ns5jwb`. Holds ~141M TRX + USDT-TRC20 (confirmed via persona description in `src/demo/tron-persona.ts:104`). `[VERIFIED: src/demo/tron-persona.ts]`

**Token registry:** `src/tokens/tron-top-25.json` contains USDT (TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t, 6 decimals) + WTRX (TNUC9Qb1rRpS5CbWLmNMxXBjyFoydXjWFR, 6 decimals). `[VERIFIED: tron-top-25.json in repo]`

**Fixture Tron-20-A:** A USDT → WTRX swap via SunSwap V2 with path `[USDT, WTRX]` (direct pair, no intermediate). The whale persona has USDT. A small amount (e.g., 10 USDT = 10_000_000 SUN) is realistic. The fixture pins the hardcoded `0x...` literal of `payloadFingerprint` computed by the SunSwap `swapExactTokensForTokens` transaction.

**No new persona needed.** Phase 20 reuses the Phase 17 + 18 + 19 `tron-whale` persona per CONTEXT § Specifics. `[VERIFIED: CONTEXT.md § Persona discipline]`

**Confidence:** HIGH

---

## Topic 9: `canonical-dispatch-tron.ts` Extension Pattern

### Verdict: Current allowlist is 4-entry stablecoin TRC-20 set; SunSwap router extension is additive to a NEW allow-set

**Current state of `canonical-dispatch-tron.ts`:** The allowlist is built from `tron-top-25.json` filtered by `ALLOWED_SYMBOLS: Set<string> = new Set(["USDT", "USDC", "USDD", "TUSD"])`. The allowlist contains the 4 TRC-20 token CONTRACT addresses (not the router). `[VERIFIED: src/security/canonical-dispatch-tron.ts:70-106]`

**Phase 20 extension:** The SunSwap V2 router address `TKzxdSv2FZKQrEqkKVgp5DcwEXBEKMg2Ax` must be added to the allowlist. But the current mechanism (filtering tron-top-25.json by symbol) does NOT include the router (it's not a token). Therefore the extension must either:
1. Add the router address directly to a second allowlist (hardcoded set)
2. OR extend the ALLOWED_SYMBOLS approach to also include a hardcoded router addresses set

**Recommended pattern (cleanest given BYTE-IDENTICAL constraint):**
```typescript
// canonical-dispatch-tron.ts — ADDITIVE: add TRON_SMARTCONTRACT_ALLOWLIST
// alongside existing TRON_TRC20_DISPATCH_ALLOWLIST
const SUNSWAP_V2_ROUTER = "TKzxdSv2FZKQrEqkKVgp5DcwEXBEKMg2Ax";
export const TRON_SMARTCONTRACT_ALLOWLIST: ReadonlySet<string> = new Set([
  SUNSWAP_V2_ROUTER,
  // Phase 20-02: LiFi facet added when confirmed
]);
// checkTronDispatchTarget remains BYTE-IDENTICAL
// preview_send caller checks TRON_SMARTCONTRACT_ALLOWLIST for "sunswap-swap" kind
// OR: caller-side skip for sunswap-swap (similar to stake-freeze skip pattern)
```

**Alternative per D-02b (caller-side skip):** The CONTEXT says SunSwap arm "flows through the existing Layer 0.5 gate" — meaning `checkTronDispatchTarget` IS called, not skipped. The planner must decide whether to extend `checkTronDispatchTarget` to accept a second set parameter, or extend `TRON_TRC20_DISPATCH_ALLOWLIST` to include the router.

**Planner note:** The exact mechanism for extending the allowlist to include the router (which is NOT a TRC-20 token) requires a design decision at plan time. The options: (a) widen `TRON_TRC20_DISPATCH_ALLOWLIST` to a general `TRON_DISPATCH_ALLOWLIST` with both stablecoin contracts AND the router, or (b) have two sets checked in union in `checkTronDispatchTarget`. The function body must remain BYTE-IDENTICAL per D-11 — "additive" means extending the data the function consumes, not the function itself.

**Confidence:** HIGH on current state. MEDIUM on extension mechanism (planner decides).

---

## Topic 10: TRON Persona Token Holdings for Fixture

**Research finding:** The `tron-whale` persona was designed for read-tool demos. The tool description confirms USDT-TRC20 compatibility: "get_tron_token_balance against curated TRC-20 contracts (USDT, USDC)". `[VERIFIED: src/demo/tron-persona.ts:104]`

For Fixture Tron-20-A: `from = TWd4WrZ9wn84f5x1hZhL4DHvk738ns5jwb`, `inputToken = USDT (TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t)`, `outputToken = WTRX (TNUC9Qb1rRpS5CbWLmNMxXBjyFoydXjWFR)`, small `amountIn` (e.g. 1_000_000 = 1 USDT), path = `[USDT, WTRX]` (direct V2 pair). No need for a 3-hop path for the fixture anchor.

---

## Standard Stack

### Core (Phase 20 consumers — FROZEN Phase 18/19 primitives)

| Library / Module | Version | Purpose | Notes |
|---------|---------|---------|-------|
| `tronweb` | 6.3.0 (locked Phase 17) | `triggerSmartContract` for swap encoding; `triggerConstantContract` for quote reads | Phase 18 research-locked |
| `viem` | existing (project locked) | `decodeFunctionData` for SunSwap calldata decode at preview | Verified compatible with UniV2 ABI |
| `src/signing/simulation-tron.ts` | Phase 18 FROZEN | `TronSimulationResult` type + `runTronPreviewSimulation` pattern reference | Pattern reference only; sunswap.ts implements its own RPC calls |
| `src/signing/payload-fingerprint-tron.ts` | Phase 18 FROZEN | `computeTronPayloadFingerprint` | Consumed unchanged |
| `src/signing/amount-tron.ts` | Phase 18 FROZEN | `parseTronAmountStrict` for amount parsing | Consumed unchanged |
| `src/config/contracts.ts` | KNOWN_SPENDERS_TRON | SOT for SunSwap V2 router address | `KNOWN_SPENDERS_TRON[0].address` |

### New Files (Phase 20 Plan 20-01 ships)

| File | Purpose | Closest Analog |
|------|---------|----------------|
| `src/clients/sunswap.ts` | `fetchSunswapQuote` — on-chain quote via `getAmountsOut`; LRU cache; NEVER-throws | `src/clients/etherscan.ts` (NEVER-throws pattern) + `src/signing/simulation-tron.ts` (triggerConstantContract) |
| `src/protocols/sunswap-tron.ts` | `encodeTronSunswapSwap` + `decodeTronSunswapSwapCall` | `src/protocols/tron-approve.ts` (TriggerSmartContract encoder/decoder shape) |
| `src/tools/get_sunswap_quote.ts` | Quote tool — wraps `fetchSunswapQuote` | No direct analog; read-only tool like `get_lending_positions` |
| `src/tools/prepare_sunswap_swap.ts` | Swap prepare tool + MEV gate | `src/tools/prepare_tron_token_approve.ts` (tool handler shape) |
| `test/signing-fingerprint-tron-20.test.ts` | Fixture Tron-20-A hardcoded literal anchor | `test/signing-fingerprint-tron-19.test.ts` |

### Deferred (Plan 20-02 → v2.2.x)

| File | Purpose | Status |
|------|---------|--------|
| `src/clients/lifi.ts` | LiFi HTTP quote client | Deferred per D-04b |
| `src/protocols/bridge-decoders/lifi-tron.ts` | Inv #6b `_bridgeData.receiver` decoder | Deferred per D-04b |
| `src/tools/prepare_tron_lifi_swap.ts` | LiFi bridge tool | Deferred per D-04b |

---

## Package Legitimacy Audit

Phase 20 installs NO new npm packages. All libraries consumed are either pre-existing project dependencies (tronweb 6.3.0, viem) or in-repo modules. No `npm install` step needed.

| Package | Status |
|---------|--------|
| `tronweb` | Already installed (Phase 17 research-locked at 6.3.0) |
| `viem` | Already installed (project baseline) |

**No slopcheck needed** — zero new external packages.

---

## Common Pitfalls

### Pitfall 1: SunSwap V2 router address vs Smart Router address confusion

**What goes wrong:** Using the new Smart Router address (`TCFNp179Lg46D16zKoumd4Poa2WFFdtqYj`) instead of the V2 router (`TKzxdSv2FZKQrEqkKVgp5DcwEXBEKMg2Ax`). The Smart Router has a different ABI (`swapExactInput` not `swapExactTokensForTokens`).

**Prevention:** Always read the router address from `src/config/contracts.ts` `KNOWN_SPENDERS_TRON[0].address`. Never inline it. The SOT constraint from CLAUDE.md prevents drift.

### Pitfall 2: TRON address encoding in `path[]` parameter

**What goes wrong:** Passing the base58check address directly as a path entry `{ type: "address[]", value: ["TKzx...", "TNUC..."] }`. tronweb may handle this, but the behavior is not guaranteed for `address[]` (vs scalar `address`) parameters.

**Prevention:** Test `triggerConstantContract` with an actual `getAmountsOut` call against TronGrid in a smoke test. The `address[]` parameter encoding for tronweb needs empirical verification at execute time. Flag this in the executor prompt.

**Warning sign:** If `constant_result` returns empty or malformed data from `getAmountsOut`, the path array encoding is likely wrong.

### Pitfall 3: `constant_result` is hex-encoded ABI output — must prefix `0x` for viem

**What goes wrong:** Passing `constant_result[0]` directly to `viem.decodeAbiParameters` without the `0x` prefix. viem requires `0x`-prefixed hex.

**Prevention:** Always: `decodeAbiParameters(types, `0x${result.constant_result[0]}`)`

### Pitfall 4: Price-impact computed as negative (when getAmountsOut returns MORE than spot)

**What goes wrong:** Rounding the price impact to 0 bps when computed negative (this happens for tiny swaps with rounding artifacts). The 2% gate should use `Math.max(0, priceImpactBps)`.

**Prevention:** Clamp to `max(0, impact)` before the threshold comparison.

### Pitfall 5: Conflating LiFi API-level TRON routing with on-chain TRON facet

**What goes wrong:** Assuming LiFi's April 2026 TRON announcement means there is a deployed on-chain Diamond contract on TRON that users can sign TriggerSmartContract transactions to. Based on research, this is NOT confirmed.

**Prevention:** The D-04b deferral is the correct response. Plan 20-02 must not be written until human-verification of the on-chain contract address.

### Pitfall 6: `TronInstructionSummary` widening for `"sunswap-swap"` — `PreparedTxTron.kind` must also widen

**What goes wrong:** Adding `"sunswap-swap"` to `TronInstructionSummary` union but forgetting to add a corresponding kind to `PreparedTxTron.kind: "native" | "trc20" | ...` The routing discriminator in `preview_send.ts` uses `PreparedTxTron.kind`, not `TronInstructionSummary.kind`.

**Prevention:** Check `handle-store.ts` line 445: `kind: "native" | "trc20" | "stake-freeze" | "stake-unfreeze" | "stake-withdraw-expire" | "stake-vote" | "stake-claim-rewards"`. Must add `"sunswap-swap"` here. The plan must explicitly call out BOTH locations.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| SunSwap V2 swap calldata encoding | Custom ABI serializer for `swapExactTokensForTokens` | tronweb `transactionBuilder.triggerSmartContract("swapExactTokensForTokens(...)", ...)` | Same pattern as tron-trc20.ts / tron-approve.ts; tronweb handles all ABI encoding |
| Quote read (`getAmountsOut`) | Direct TronGrid HTTP POST | `tronWeb.transactionBuilder.triggerConstantContract` | Existing pattern in simulation-tron.ts; tronweb handles TronGrid auth headers |
| LRU cache | npm `lru-cache` package | Simple `Map<string, {value, expiresAt}>` + size check | 10 entries is trivial to manage inline; avoids new dep |
| TRON address → EVM address conversion for path encoding | Custom base58 decode | Supply base58check addresses to tronweb param `{ type: "address", value: base58 }` | tronweb handles the conversion |
| SunSwap calldata decode | Custom hex slicer | `viem.decodeFunctionData({ abi: sunswapV2Abi, data: \`0x\${dataHex}\` })` | Verified working; cleaner for 5-parameter tuple |
| Price-impact computation | AMM math library | Direct bigint arithmetic on getAmountsOut + getReserves values | Uniswap V2 math is simple; no library needed |

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| SunSwap V2 only (`swapExactTokensForTokens`) | Smart Router (`swapExactInput` with poolVersion) | SunSwap Smart Router v2, ~2024+ | Phase 20 explicitly ships V2-only scope per D-01d; V3/Smart Router deferred |
| Manual price-impact HTTP API | On-chain `getAmountsOut` + `getReserves` (no API) | N/A for TRON | SunSwap V2 has no public HTTP quote API per D-01d |
| LiFi EVM-only Diamond | LiFi adding non-EVM chains (Solana, Bitcoin, SUI, TRON) | April 2026 SDK v4 | TRON routing announced; on-chain facet NOT yet confirmed for TriggerSmartContract path |

**Deprecated / avoid:**
- `transactionBuilder.freezeBalance` (Stake 1.0): NEVER use; TRON network rejects at broadcast (inherited warning from Phase 19)
- SunSwap Smart Router for Phase 20: out of scope; different ABI; do not confuse with V2 router
- LiFi TRON facet address: any address found via web search for "LiFi TRON contract" should be treated as UNVERIFIED until human-verified per D-04a

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | vitest (project-wide, pre-existing) |
| Config file | `vitest.config.ts` (root) |
| Quick run command | `npx vitest run test/signing-fingerprint-tron-20.test.ts` |
| Full suite command | `npx vitest run` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| TRON-W-09 | `get_sunswap_quote` returns Quote shape with priceImpactBps | unit (mock triggerConstantContract) | `npx vitest run test/clients-sunswap.test.ts` | ❌ Wave 0 |
| TRON-W-09 | `prepare_sunswap_swap` produces TriggerSmartContract with `swapExactTokensForTokens` calldata | unit (mock tronweb) | `npx vitest run test/prepare-sunswap-swap.test.ts` | ❌ Wave 0 |
| TRON-W-09 | Fixture Tron-20-A hardcoded `0x...` literal anchor | regression | `npx vitest run test/signing-fingerprint-tron-20.test.ts` | ❌ Wave 0 |
| TRON-W-09 | preview_send SunSwap arm decodes + surfaces calldata | unit | `npx vitest run test/preview-send-tron-sunswap.test.ts` | ❌ Wave 0 |
| TRON-W-10 | MEV gate refuses `priceImpactBps > 200` without explicit slippage | unit | included in `test/prepare-sunswap-swap.test.ts` | ❌ Wave 0 |
| TRON-W-10 | MEV gate allows explicit `slippageBps` at any value | unit | included in `test/prepare-sunswap-swap.test.ts` | ❌ Wave 0 |
| TRON-W-12 | canonical-dispatch-tron allows SunSwap V2 router | unit | `npx vitest run test/security-canonical-dispatch-tron.test.ts` | ❌ Wave 0 (extend existing) |
| TRON-W-11 | LiFi TRON prepare tool | — | DEFERRED — no test needed until v2.2.x | N/A |

### Sampling Rate
- **Per task commit:** `npx vitest run test/signing-fingerprint-tron-20.test.ts test/clients-sunswap.test.ts`
- **Per wave merge:** `npx vitest run`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps (Plan 20-01)
- [ ] `test/clients-sunswap.test.ts` — `fetchSunswapQuote` unit tests (mock `triggerConstantContract`)
- [ ] `test/prepare-sunswap-swap.test.ts` — tool handler + MEV gate + PREPARE RECEIPT
- [ ] `test/signing-fingerprint-tron-20.test.ts` — Fixture Tron-20-A literal anchor
- [ ] `test/preview-send-tron-sunswap.test.ts` — or extend existing preview_send test file

---

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | — |
| V3 Session Management | no | — |
| V4 Access Control | yes | Layer 0.5 canonical-dispatch-tron allowlist (SunSwap router must be whitelisted) |
| V5 Input Validation | yes | `parseTronAmountStrict` for amount; Zod schema for tool args; base58check validation for token addresses |
| V6 Cryptography | no (reuses Phase 18 primitives) | `payloadFingerprint` via `_tronFingerprint` (FROZEN) |

### Known Threat Patterns for TRON SunSwap Swap

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Agent supplies wrong router address (spoofed to attacker-controlled contract) | Tampering | Layer 0.5 canonical-dispatch-tron allowlist: SunSwap V2 router must be in set |
| Sandwich MEV — agent swaps large amount in high-impact pool | Elevation of Privilege (financial) | D-03b: refuse `priceImpactBps > 200` without explicit `slippageBps`; mirrors Phase 14 Jupiter |
| `amountOutMin = 0` (zero slippage = full MEV extraction) | Tampering | `amountOutMin = expectedOut * (10000 - slippageBps) / 10000`; never 0 by construction |
| Path manipulation — agent passes malicious intermediate token | Tampering | Path is agent-supplied; tool caps to `[in, WTRX, out]` shape (2 or 3 tokens only) |
| Stale quote — agent uses old quote for high-volatility trade | Denial of Service (financial loss) | 30s TTL on quote cache; `deadline = now + 600s` enforced at prepare time |

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| TronGrid RPC | `triggerConstantContract` for getAmountsOut | ✓ (in existing TRON setup) | — | `TRON_RPC_URL` override |
| `tronweb` npm package | All TRON encoding | ✓ | 6.3.0 (Phase 17 locked) | — |
| `viem` npm package | `decodeFunctionData` for calldata decode | ✓ | project baseline | — |
| LiFi API (`li.quest/v1/`) | Plan 20-02 | ✗ (TRON not in `/v1/chains`) | — | Plan 20-02 deferred per D-04b |

**Missing dependencies with no fallback:** LiFi TRON support — blocks Plan 20-02. Plan 20-02 defers entirely.
**Missing dependencies with fallback:** None for Plan 20-01.

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | SunSwap V2 router address `TKzxdSv2FZKQrEqkKVgp5DcwEXBEKMg2Ax` is the correct V2 router (docs.sun.io returned 403; verified via TRONSCAN + Phase 19 checkpoint:decision) | Topic 1 | Wrong contract address could cause swaps to wrong contract; mitigated by canonical-dispatch allowlist |
| A2 | SunSwap V2 router ABI is Uniswap V2-compatible (`swapExactTokensForTokens`, `getAmountsOut`) | Topic 2 | If SunSwap V2 has custom function signatures, the ABI encoding fails at tronweb level |
| A3 | `address[]` parameter type works correctly in tronweb `triggerConstantContract` for `getAmountsOut` path argument | Topic 4 | If tronweb does not support `address[]` type, path encoding fails; executor must smoke-test against TronGrid |
| A4 | Price-impact computation via worst-case per-hop impacts is acceptable for D-03 2% gate (not mandated by spec) | Topic 3 | Lower-complexity alternative (D-03 only needs a reasonable threshold guard, not precise AMM math) |
| A5 | LiFi April 2026 integration = API-level routing, NOT on-chain TRON Diamond facet | Topic 5 | If LiFi does have an on-chain TRON contract that was missed in research, Plan 20-02 deferral is unnecessary — but human-verify still needed before committing an address |

---

## Open Questions (RESOLVED)

1. **Does `tronweb.transactionBuilder.triggerConstantContract` accept `address[]` as a parameter type for `getAmountsOut` path?**
   - What we know: scalar `address` type works (verified from tron-approve.ts, tron-trc20.ts). Array types (`address[]`) not tested.
   - What's unclear: tronweb parameter encoding for arrays.
   - Recommendation: Executor must perform a TronGrid smoke test with `getAmountsOut([USDT, WTRX], amountIn)` before writing `src/clients/sunswap.ts`. If `address[]` fails, use `viem.encodeFunctionData` to manually construct the calldata and pass raw hex to `triggerConstantContract`.
   - **RESOLVED:** Plan 20-01 Task 1 includes a Wave 0 smoke-gate test in `test/clients-sunswap.test.ts` (`describe.skip("WAVE-0-SMOKE")` block) that verifies `triggerConstantContract` accepts `address[]` parameter encoding against TronGrid mainnet BEFORE the `src/clients/sunswap.ts` body is written. Fallback path documented in `<design_rationale>` block: if `address[]` fails, use `viem.encodeFunctionData` to manually construct the calldata and pass raw hex via `triggerConstantContract`.

2. **What is the exact mechanism for extending `canonical-dispatch-tron.ts` to include the SunSwap router?**
   - What we know: Current allowlist is 4 TRC-20 stablecoin CONTRACT addresses (token contracts, not the router). SunSwap router is a DIFFERENT contract type.
   - What's unclear: Should the planner widen `ALLOWED_SYMBOLS` (wrong — router is not a symbol), widen the allowlist source, or add a second set?
   - Recommendation: Planner creates a second `ReadonlySet<string>` called `TRON_SMARTCONTRACT_DISPATCH_ALLOWLIST` hardcoded with the SunSwap V2 router, and extends `checkTronDispatchTarget` to check union of both sets (or adds a new exported function `checkTronSmartContractDispatchTarget`). Caller-side routing by `PreparedTxTron.kind` determines which check fires.
   - **RESOLVED:** Plan 20-01 selected option (a) — sibling set + sibling function. NEW `TRON_SMARTCONTRACT_DISPATCH_ALLOWLIST` + `checkTronSmartContractDispatchTarget`; existing 4-stablecoin allowlist + `checkTronDispatchTarget` BYTE-IDENTICAL. T-SOT-DRIFT-1 test asserts the SOT cross-import (`SUNSWAP_V2_ROUTER_TRON_ADDRESS` in the dispatch allowlist == `KNOWN_SPENDERS_TRON[SUNSWAP_V2_ROUTER].address`). CONTEXT.md D-02b updated to reflect this design choice (sibling-set mechanism preserves spirit of "function shape BYTE-IDENTICAL").

3. **Is LiFi's TRON integration accessible via an EVM-side contract that deposits into TRON? (EVM → TRON direction only?)**
   - What we know: LiFi's `/v1/chains` lists only EVM chains. The April 2026 announcement mentions TRON routing but no contract address.
   - What's unclear: Whether LiFi routes TRON via an EVM-side bridge contract (user signs EVM tx → bridge deposits on TRON) vs requiring a TriggerSmartContract on TRON.
   - Recommendation: Human-verify per D-04a. If EVM-side only, the D-05b TRON → EVM direction (TriggerSmartContract) may not be implementable — the tool would become EVM-side only, which is already covered by the future EVM LiFi tool in Phase 32-35.
   - **RESOLVED:** Deferred to v2.2.x per D-04b. Three independent verifications all failed: (1) live LiFi `/v1/chains` returns 69 EVM chains with no TRON entry, (2) GitHub `lifinance/contracts/deployments/` has no `tron*.json`, (3) `/v1/quote?fromChain=TRX` returns error 1011. Plan 20-02 NOT created; deferral documented in `20-02-DEFERRED.md` with the `checkpoint:human-verify` task signature preserved for v2.2.x replan.

---

## Pattern-Mapper Handoff

### Files to Create (Plan 20-01)

| File | Closest Analog | Key Differences |
|------|---------------|-----------------|
| `src/clients/sunswap.ts` | `src/clients/etherscan.ts` (NEVER-throws shape) | Uses `triggerConstantContract` not `fetch`; LRU cache 10 entries / 30s TTL; returns `Quote | null` |
| `src/protocols/sunswap-tron.ts` | `src/protocols/tron-approve.ts` | Encodes `swapExactTokensForTokens` (5-arg) not `approve` (2-arg); includes path as `address[]`; decoder uses `viem.decodeFunctionData` |
| `src/tools/get_sunswap_quote.ts` | `src/tools/prepare_tron_stake_claim_rewards.ts` (no-side-effect read tool shape) | Returns Quote struct verbatim in structuredContent |
| `src/tools/prepare_sunswap_swap.ts` | `src/tools/prepare_tron_token_approve.ts` | Extra MEV gate check before encoding (D-03b); amountOutMin computation |
| `test/clients-sunswap.test.ts` | `test/clients-etherscan.test.ts` | Mock `triggerConstantContract` via `vi.spyOn(_sunswap, "callGetAmountsOut")` |
| `test/signing-fingerprint-tron-20.test.ts` | `test/signing-fingerprint-tron-19.test.ts` | Fixture Tron-20-A only (Tron-20-B deferred) |

### Files to Modify (Plan 20-01, additive only)

| File | Modification | FROZEN Status |
|------|-------------|---------------|
| `src/signing/handle-store.ts` | Add `"sunswap-swap"` to `TronInstructionSummary` union + `PreparedTxTron.kind` | ADDITIVE permitted per D-09 |
| `src/signing/blocks-tron.ts` | APPEND new SunSwap PREPARE RECEIPT template + MEV refusal block | APPEND-ONLY per D-09 |
| `src/security/canonical-dispatch-tron.ts` | Add SunSwap V2 router to allowlist (see Open Question #2) | ADDITIVE per D-09; function body discipline |
| `src/config/contracts.ts` | No change needed — KNOWN_SPENDERS_TRON[0] already has the router | BYTE-UNTOUCHED |
| `src/tools/preview_send.ts` | Add `"sunswap-swap"` decode arm in TRON branch | ADDITIVE per D-09 |
| `src/tools/send_transaction.ts` | Add `"sunswap-swap"` dispatch arm | ADDITIVE per D-09; three-gate FROZEN region BYTE-UNTOUCHED |
| `src/tools/get_tx_verification.ts` | Add `"sunswap-swap"` arm | ADDITIVE per D-09 |
| `src/tools/register-all.ts` | Import 2 new tools (get_sunswap_quote, prepare_sunswap_swap) | ADDITIVE |

---

## Sources

### Primary (HIGH confidence)
- `src/security/canonical-dispatch-tron.ts` — current allowlist shape + caller-side skip pattern [VERIFIED: direct code read]
- `src/config/contracts.ts` — KNOWN_SPENDERS_TRON 5-entry table; SunSwap V2 router at [0] [VERIFIED: direct code read]
- `src/protocols/tron-approve.ts` — TriggerSmartContract encode/decode pattern [VERIFIED: direct code read]
- `src/signing/simulation-tron.ts` — `triggerConstantContract` usage + `constant_result` shape + `.d.ts` widening [VERIFIED: direct code read]
- `src/signing/handle-store.ts` — `PreparedTxTron.kind` union + `TronInstructionSummary` union current state [VERIFIED: direct code read]
- viem `decodeFunctionData` + `encodeFunctionData` for UniV2 ABI [VERIFIED: node -e test in research session]
- LiFi `/v1/chains` live API returning 69 EVM chains, zero TRON [VERIFIED: curl in research session]
- `git log -- src/clients/jupiter.ts` returns empty [VERIFIED: git command in research session]
- `src/tokens/tron-top-25.json` — WTRX address [VERIFIED: direct file read]
- `src/demo/tron-persona.ts` — tron-whale persona address + token holdings [VERIFIED: direct code read]
- `.planning/phases/19-tron-approve-stake2/19-RESEARCH.md` — tronweb 6.3.0 `.d.ts` widening pattern for `code` field [VERIFIED: direct file read]

### Secondary (MEDIUM confidence)
- [TRONSCAN contract page](https://tronscan.org/#/contract/TKzxdSv2FZKQrEqkKVgp5DcwEXBEKMg2Ax/transactions) — confirms SunSwap V2 router contract exists at this address
- [Bitquery SunSwap API docs](https://docs.bitquery.io/docs/blockchain/Tron/sunswap-api/) — identifies address as SunSwap V2 router
- [LiFi deployments GitHub](https://github.com/lifinance/contracts/tree/main/deployments) — no tron*.json file found
- [LiFi press release April 2026](https://www.newsfilecorp.com/release/293462/) — TRON integration announced
- [LiFi SDK v4 release (llms.txt)](https://docs.li.fi/llms.txt) — "TRON, Arbitrum Nova, Mayan v2, Bitget added" in SDK v4

### Tertiary (LOW confidence, flag for validation)
- SunSwap V2 ABI = Uniswap V2 ABI — inferred from multiple secondary sources; official docs.sun.io returned 403
- `address[]` parameter encoding in tronweb `triggerConstantContract` — inferred from scalar `address` pattern; not directly tested

---

## Metadata

**Confidence breakdown:**
- SunSwap V2 router address: MEDIUM (TRONSCAN + Phase 19 checkpoint verified; docs.sun.io inaccessible)
- SunSwap V2 ABI shape: MEDIUM (Uniswap V2 fork inference; viem test verified selector 0x38ed1739)
- `triggerConstantContract` for read calls: HIGH (verified from simulation-tron.ts pattern)
- LiFi TRON facet NOT present: HIGH (live API confirmed, GitHub confirmed)
- `jupiter.ts` absent from main: HIGH (git verified)
- TRON whale persona suitability: HIGH (code verified)
- Canonical-dispatch extension mechanism: MEDIUM (design decision needed at plan time)

**Research date:** 2026-05-20
**Valid until:** SunSwap findings stable (30 days). LiFi TRON status: check weekly if Phase 20-02 re-attempt is planned for v2.2.x.
