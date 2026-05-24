# Phase 33: Uniswap V3 full LP verb set + `get_lp_positions` with IL estimate — Research

**Researched:** 2026-05-24
**Domain:** Uniswap V3 concentrated-liquidity LP position management on Ethereum mainnet — `NonfungiblePositionManager` write surface (mint / increaseLiquidity / decreaseLiquidity / collect / burn / rebalance via multicall) + read surface (`get_lp_positions` with current-price + range + accrued-fee + IL-estimate envelope) + first **composite-tx preview shape** in the codebase (establishes the v2.5 Safe three-step convention)
**Confidence:** HIGH on ABI / selectors / addresses / NonfungiblePositionManager surface / tick spacings / pool-address derivation / accrued-fee formula / hand-roll-vs-SDK verdict; MEDIUM on Ledger ERC-7730 clear-sign coverage for NPM selectors (researcher reviewed Ledger registry — no NPM coverage as of 2026-05-24 → unconditional LEDGER NOTICE inherited from Phase 32 pattern); MEDIUM on IL-estimate-with-out-of-range fallback heuristic (no canonical industry answer — anchored as `[ASSUMED]` for user confirmation).

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01:** Tick math placement → `src/signing/uniswap-tick.ts`. Researcher scope-probes `@uniswap/v3-sdk` at planning gate per SDK Scope-Probing Discipline; verdict (adopt vs cherry-pick vs hand-roll) anchored in this RESEARCH.md and ratified in PLAN.md. Default leaning: hand-roll 3–4 conversion primitives (tick ↔ sqrtPriceX96 ↔ price). **Researcher VERDICT (this RESEARCH.md § SDK Probe Verdict): HAND-ROLL. Confirmed via empirical probe — SDK pulls JSBI + ethers v5 + sdk-core deprecated graph; surface area is small; viem provides BigInt + Q64.96 math natively.**
- **D-02:** IL estimate as a labeled approximation — `get_lp_positions` surfaces both raw IL (vs hodl baseline at position-mint price) AND net-of-fees IL (raw IL + accrued fees). Both fields prefixed `[ESTIMATE]` in any human-readable surface. Mint-event price reconstructed from `positions(tokenId)` NFT state at mint time (re-deriving the entry price from `liquidity` + `tickLower` + `tickUpper` is the canonical method). When current price is OUT of range — fall back to AVERAGE of `sqrtPrice_lower` and `sqrtPrice_upper` as the assumed entry, with `ilEstimateConfidence: "low" | "high"`.
- **D-03:** Tick-as-price agent interface — agent passes decimal prices and decimals (`priceLower: "1900.5"`, `priceUpper: "2100.0"`), server snaps to nearest valid tick via current pool `sqrtPriceX96`. PREPARE RECEIPT records the user-input prices; CHECKS PERFORMED records the snapped ticks + the snap delta in bps. Refuses if snap delta > 100 bps (1%).
- **D-04:** NonfungiblePositionManager from `src/config/contracts.ts` SOT — extend `UniswapV3Contracts` is **already done at Phase 32** (slot `nonfungiblePositionManager` pre-populated with `0xC36442b4a4522E871399CD717aBDD847Ab11FE88` per Phase 32 D-01; getter `getUniswapV3NonfungiblePositionManagerAddress(chainId)` already exists). **Phase 33 CONSUMES the existing slot — does NOT re-extend the SOT for NPM placement.** KNOWN_SPENDERS_ETHEREUM row decision deferred to RESEARCH § Topic 8.
- **D-05:** Canonical-dispatch allowlist — extend `CANONICAL_DISPATCH_TARGETS.ethereum` with the NonfungiblePositionManager address. Single-row diff in `src/security/canonical-dispatch.ts`.
- **D-06:** Composite-tx preview shape (NEW PATTERN — establishes convention for v2.5 Safe three-step) — `prepare_uniswap_v3_rebalance` is ONE tool returning ONE handle with ONE multicall calldata payload. The `preview_send` rendering for this handle surfaces decoded `step 1 / step 2 / step 3` sub-blocks (decrease + collect + mint). PREPARE RECEIPT records composite intent (tokenId + newTickLower + newTickUpper). CHECKS PERFORMED enumerates each step's selector + target + decoded args. Cryptographic-binding chain (`payloadFingerprint` over the full multicall calldata) is UNCHANGED — single hash. The new shape is a pure rendering extension at `preview_send`.
- **D-07:** Plan structure (3 plans, sequential):
  - **33-01**: `src/chains/uniswap-v3-lp.ts` (position reader via NonfungiblePositionManager) + `get_lp_positions` + `src/signing/uniswap-tick.ts` tick↔price helpers + canonical-dispatch arm (NPM SOT slot already populated at Phase 32). Establishes the read surface + tick-math primitives.
  - **33-02**: 5 single-step prepares — `prepare_uniswap_v3_mint` + `_increase_liquidity` + `_decrease_liquidity` + `_collect` + `_burn` + `src/protocols/uniswap-v3-lp.ts` (selector dispatch + decoder; SEPARATE file from Phase 32's `src/protocols/uniswap-v3.ts`) + `preview_send` selector-dispatch extension + Fixtures UNI-LP-{A,B,C,D,E} hardcoded literals (one per verb).
  - **33-03**: `prepare_uniswap_v3_rebalance` composite tool + composite-tx preview shape at `preview_send` + multicall builder (encodes the 3-step calldata sequence via NPM's `multicall(bytes[])` entrypoint — NOT the deadline overload Phase 32 uses) + Fixture UNI-LP-F (rebalance multicall fingerprint).

### Claude's Discretion (no user decision needed)

- Internal helper names (`UniswapV3LpReader`, `tickToHumanPrice`, `snapPriceToTick`, etc.).
- Fixture letter values UNI-LP-{A..F} computed at execute time from real calldata.
- Whether `getLiquidityForAmounts` / `getAmountsForLiquidity` math goes through the SDK or hand-rolled alongside tick primitives — **researcher recommends hand-roll** (falls out of D-01 verdict; same JSBI dependency, same algorithmic surface, all in `src/signing/uniswap-tick.ts` or sibling `src/signing/uniswap-liquidity.ts`).
- Test trajectory delta — measured per-plan against local baseline; no pre-committed target.

### Deferred Ideas (OUT OF SCOPE)

- Multi-chain LP (Polygon / Arbitrum / Base / Optimism) — v2.4.x follow-up, same pattern as Phase 32 swap multi-chain deferral.
- Curve swap + add-liquidity — Phase 34.
- `prepare_custom_call` escape hatch — Phase 35.
- Uniswap V4 hooks — defer to v3.x.
- LP-strategy automation (auto-rebalance on out-of-range trigger, range-order watchers, fee-compounding loops) — out of scope; v2.4 is verb-set only. v3.5+ ergonomics surface candidate.
- WETH-pair convenience entry points (`mint` with native ETH instead of pre-wrapped WETH) — out of scope for v2.4; user calls `prepare_weth_wrap` (Phase 6) first.
- `prepare_uniswap_v3_swap_via_lp_router` (router-aware swap routing through user's own LP) — speculative; not on the roadmap.

</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| UNI-04 | `get_lp_positions({ wallet, chain? })` returns Uniswap V3 LP positions per NFT-id with current price + tick range + in-range/out-of-range flag + accrued fees + IL estimate (relative to a hodl baseline) | Topic 2 (NPM `positions(tokenId)` + ERC-721 Enumerable enumeration) + Topic 4 (accrued-fee formula) + Topic 5 (IL estimate + entry-price reconstruction + out-of-range fallback) + Topic 6 (pool address derivation + `slot0()` current price) |
| UNI-05 | `prepare_uniswap_v3_mint({ chain, token0, token1, fee, tickLower, tickUpper, amount0, amount1 })` produces an unsigned NonfungiblePositionManager `mint` call | Topic 2 (`mint(MintParams)` ABI) + Topic 3 (tick math + price↔tick snap) + Topic 7 (slippage params `amount0Min`/`amount1Min`) + Topic 8 (approval pre-flight — NPM is a spender, MUST be promoted) |
| UNI-06 | `prepare_uniswap_increase_liquidity` + `prepare_uniswap_decrease_liquidity` cover liquidity adjustments on existing positions (NFT-keyed) | Topic 2 (`increaseLiquidity` + `decreaseLiquidity` ABIs) + Topic 3 (decrease percentage → liquidity delta math) + Topic 7 (slippage params) |
| UNI-07 | `prepare_uniswap_collect` produces an unsigned `collect(tokenId, ...)` call to harvest accrued fees | Topic 2 (`collect(CollectParams)` ABI — uses MAX_UINT128 sentinels for amount0Max/amount1Max to collect everything) + Topic 4 (fee mechanics) |
| UNI-08 | `prepare_uniswap_burn` produces an unsigned `burn(tokenId)` call to close a fully-decreased position | Topic 2 (`burn(uint256)` ABI — refuses on-chain unless liquidity == 0 AND tokensOwed0 == 0 AND tokensOwed1 == 0; server pre-flight check via `positions(tokenId)`) |
| UNI-09 | `prepare_uniswap_v3_rebalance({ tokenId, newTickLower, newTickUpper })` is a composite tool that builds a multicall (decrease all + collect + mint at new range); preview surfaces the multi-step decoded view | Topic 2 (NPM `multicall(bytes[])` — the `0xac9650d8` overload, NOT Phase 32's `0x5ae401dc` deadline overload) + Topic 9 (composite-tx preview shape — NEW PATTERN) |
| UNI-10 | Uniswap V3 SwapRouter02 + Quoter V2 + NonfungiblePositionManager addresses sourced from `src/config/contracts.ts` per-chain table; tick math + price↔tick conversions handled server-side in `src/signing/uniswap-tick.ts`; canonical-dispatch allowlist Uniswap arm wiring | Phase 32 ALREADY shipped NPM slot in `UniswapV3Contracts` SOT + `getUniswapV3NonfungiblePositionManagerAddress(1)` getter; Phase 33 CONSUMES + extends canonical-dispatch Ethereum arm with NPM address |

</phase_requirements>

## Project Constraints (from CLAUDE.md)

These directives apply unchanged from prior phases; Phase 33 plans must honor them:

- **SOT discipline:** NPM address sourced via `getUniswapV3NonfungiblePositionManagerAddress(1)!` — already in `src/config/contracts.ts` at Phase 32 line ~787. Cross-view byte-identity test (`T-UNISWAP-V3-NPM-SPENDER-DRIFT-1`) regression-anchors getter vs `KNOWN_SPENDERS_ETHEREUM` row (only required if NPM is promoted to KNOWN_SPENDERS per Topic 8 verdict). NEVER inline NPM address in any tool implementation.
- **Cryptographic-binding fixtures pinned as hardcoded literals:** Fixtures UNI-LP-{A,B,C,D,E,F} go in `test/signing-fingerprint.test.ts` as hardcoded `0x...` literals (one per verb shape — mint / increase / decrease / collect / burn / rebalance). Cross-link from each `test/prepare-uniswap-v3-*.test.ts`. NO `beforeAll`-snapshot. Persona-cycle byte-identity integration test re-anchors all 6 fixtures under at least 2 personas. New phases adding new tx shapes follow Fixture UNI-A/B/C pattern from Phase 32 (`test/signing-fingerprint.test.ts:554-700`).
- **ESM spy-affordance:** `_uniswapV3LpProtocol` mutable object wraps the encoder surface (`encodeMint`, `encodeIncreaseLiquidity`, `encodeDecreaseLiquidity`, `encodeCollect`, `encodeBurn`, `encodeMulticallBytes`) so `vi.spyOn(_uniswapV3LpProtocol, ...)` works. Mirrors `_uniswapV3Protocol` from Phase 32 + `_lidoProtocol` / `_eigenLayerProtocol` / `_rocketPoolProtocol`. ALSO `_uniswapV3LpReader` indirection in `src/chains/uniswap-v3-lp.ts` for the position-enumeration reader's RPC seam.
- **Decimal-aware arithmetic:** All token amounts (`amount0`/`amount1`) cross the agent boundary as decimal strings (e.g. `"100.5"`). Decimals resolved at prepare time via `get_token_metadata` (Phase 2). Prices (`priceLower`/`priceUpper`) ALSO cross as decimal strings (D-03) and are converted to ticks server-side via the `priceToTick` primitive in `src/signing/uniswap-tick.ts`.
- **No private key material:** Phase 33 produces unsigned txs only. NPM `mint` / `increase` / etc. are payable but the v2.4 LP surface refuses ETH-in (D-03 "WETH-pair convenience entry points out of scope" — user pre-wraps via `prepare_weth_wrap`).
- **`prepare_*` returns handle + PREPARE RECEIPT:** Every Phase 33 prepare tool emits PREPARE RECEIPT with verbatim agent args. Composite rebalance receipt records ONLY composite intent (tokenId + newTickLower + newTickUpper); decoded inner-step args surface at preview time via CHECKS PERFORMED.
- **`payloadFingerprint` re-check at send time:** FROZEN Phase 4 trust pipeline. For composite rebalance, the fingerprint covers the FULL `multicall(bytes[])` outer calldata (single hash — unchanged from individual-step semantics).
- **`src/config/contracts.ts` SOT:** ALL Uniswap V3 addresses come from getter calls. Plan-time grep guards anti-pattern (`grep "0xC36442b4a4522E871399CD717aBDD847Ab11FE88" src/ --include='*.ts' | grep -v config/contracts.ts` MUST return zero).
- **Stderr for diagnostics, stdout for MCP protocol.** Position-enumeration RPC failures log to stderr (e.g. "NPM balanceOf timed out") without contaminating MCP stdout.
- **GSD workflow:** Phase 33 work scoped under `/gsd-execute-phase 33` after planning.

---

## Summary

Phase 33 is a structurally NEW shape in the codebase along three axes:

1. **NFT-enumeration read surface** (`get_lp_positions`) — a new read pattern: enumerate ERC-721 `balanceOf` + `tokenOfOwnerByIndex`, then `positions(tokenId)` decode per NFT, then derive pool address (via factory `getPool` or CREATE2 compute), then `IUniswapV3Pool.slot0()` for current price/tick + ticks(lower) / ticks(upper) for accrued-fee delta. NO single-call multicall analog in prior phases (Aave/Compound aggregate at protocol layer; LP positions are per-NFT individuated).

2. **Pure-math tick primitives** (`src/signing/uniswap-tick.ts`) — pure bigint Q64.96 conversions: `priceToSqrtPriceX96`, `sqrtPriceX96ToPrice`, `tickToSqrtPriceX96` (= `getSqrtRatioAtTick`), `sqrtPriceX96ToTick` (= `getTickAtSqrtRatio`), `priceToTick`, `tickToPrice`, `snapPriceToTick`. Plus `getAmountsForLiquidity` / `getLiquidityForAmounts` for mint/IL math. **HAND-ROLLED via viem BigInt** (verdict §SDK Probe). All sibling-shelf of `src/signing/uniswap-path.ts` (Phase 32).

3. **First composite-tx preview shape** — `prepare_uniswap_v3_rebalance` is one tool, one handle, one calldata payload. The handle's `tx.data` is `multicall(bytes[])` wrapping 3 sub-calls (decreaseLiquidity all + collect + mint at new range). `preview_send` extends the DECODED ARGS dispatch with a new `composite-multicall` arm: detect outer selector `0xac9650d8`, decode `bytes[]`, recursively decode each inner call via the existing per-selector decoder, surface as `step 1 / step 2 / step 3` sub-blocks. `payloadFingerprint` and the cryptographic-binding chain remain unchanged (single hash over full multicall calldata). This pattern is the **canonical reference for the deferred v2.5 Safe three-step (propose / approve / execute) preview surface** — anchor its design carefully.

**Three load-bearing research findings drive Phase 33 planning:**

1. **SDK PROBE VERDICT: HAND-ROLL all tick + liquidity math.** `@uniswap/v3-sdk@3.30.1` pulls JSBI (deprecated, "use native BigInt"), 7 `@ethersproject/*` v5 packages, and `@uniswap/sdk-core@7.15.0` (which itself pulls JSBI + 5 more ethersproject packages + decimal.js-light + big.js). `TickMath.getSqrtRatioAtTick` returns `JSBI` (not native bigint). `NonfungiblePositionManager.addCallParameters` requires ethers `Interface` + ethers types and is incompatible with the project's viem-only stack. Install footprint: ~297MB into a 1.4MB SDK package. The 3-4 conversion primitives are ~80 lines of bigint math (each algorithm canonically documented in Uniswap V3 whitepaper §6 + on-chain `TickMath.sol` source). [VERIFIED: `npm view @uniswap/v3-sdk` 2026-05-24 + `npm install` probe + dist/*.d.ts read]. Matches Phase 32 precedent (Phase 32 rejected v3-sdk on same grounds, hand-rolled `encodeV3Path` in `src/signing/uniswap-path.ts`).

2. **NPM uses `multicall(bytes[])` (selector `0xac9650d8`) — NOT Phase 32's `multicall(uint256,bytes[])` deadline overload (`0x5ae401dc`).** NPM has its own per-call `deadline` field inside each `MintParams` / `IncreaseLiquidityParams` / `DecreaseLiquidityParams` struct, so the outer multicall does NOT need a deadline. Phase 33 ships a NEW `MULTICALL_BYTES_ABI` parseAbi fragment (separate from Phase 32's `MULTICALL_DEADLINE_ABI`) — selector pinned at `0xac9650d8`. This is the canonical NPM rebalance pattern per [docs.uniswap.org/contracts/v3/guides/providing-liquidity](https://docs.uniswap.org/contracts/v3/guides/liquidity-mining/overview). [VERIFIED: v3-periphery `INonfungiblePositionManager.sol` inherits from `IMulticall.sol` which declares `multicall(bytes[])` — same source the Phase 32 SwapRouter02 `MULTICALL_DEADLINE_ABI` came from, just the non-deadline overload].

3. **NPM IS a spender — REQUIRES KNOWN_SPENDERS_ETHEREUM promotion.** `mint` and `increaseLiquidity` perform internal `transferFrom(user, npm, amount)` on BOTH `token0` AND `token1` — the user must first `approve(NPM, amount)` on each ERC-20. `collect` / `decrease` / `burn` use NFT-ownership authorization (`tokenId` ownership), NOT ERC-20 spender approval. **Net: NPM IS a spender (for the 2 ERC-20 sides of mint/increase).** CONTEXT.md D-04 phrased this as a researcher question — **CONFIRMED via [github.com/Uniswap/v3-periphery/contracts/NonfungiblePositionManager.sol](https://github.com/Uniswap/v3-periphery/blob/main/contracts/NonfungiblePositionManager.sol) `addLiquidity` internal call → `pay()` → `TransferHelper.safeTransferFrom`**. Phase 33 MUST add one KNOWN_SPENDERS_ETHEREUM row: `{ address: getUniswapV3NonfungiblePositionManagerAddress(1)!, label: "Uniswap V3 NonfungiblePositionManager", source: "https://docs.uniswap.org/contracts/v3/reference/periphery/NonfungiblePositionManager" }`. T-UNISWAP-V3-NPM-SPENDER-DRIFT-1 cross-view test enforces. [VERIFIED: v3-periphery NonfungiblePositionManager source].

**Primary recommendation:** Ship 3 plans per CONTEXT.md D-07 — sequential (33-01 foundation → 33-02 5 single-step prepares → 33-03 composite rebalance). Plan 33-01 lays the position-reader + tick math + canonical-dispatch + KNOWN_SPENDERS promotion (single PR touching `chains/uniswap-v3-lp.ts` NEW + `signing/uniswap-tick.ts` NEW + `signing/uniswap-liquidity.ts` NEW + `security/canonical-dispatch.ts` MODIFY + `config/contracts.ts` MODIFY-KNOWN_SPENDERS-only + `tools/get_lp_positions.ts` NEW + `blocks.ts` MODIFY-APPEND-only). Plan 33-02 builds the 5 single-step prepares (mechanical clones of `prepare_aave_supply` shape; new `src/protocols/uniswap-v3-lp.ts` decoder; `preview_send` per-selector dispatch arms; Fixtures UNI-LP-{A..E}). Plan 33-03 builds the composite rebalance tool + the new `composite-multicall` preview arm + Fixture UNI-LP-F. Each plan ~6-10 tasks. Wave structure matches Phase 32 (32-01 foundation → 32-02/32-03 leaves) which executed cleanly. NO new npm packages required — `viem` provides everything (BigInt for Q64.96 math, `parseAbi` for NPM/Pool/Factory ABIs, `encodeFunctionData` for calldata).

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| ERC-721 enumeration (balanceOf + tokenOfOwnerByIndex per NFT) | API / Backend (chains/uniswap-v3-lp.ts) | — | viem `publicClient.readContract` against NPM; `Promise.all` fan-out over `[0..balanceOf)` |
| `positions(tokenId)` decode | API / Backend | — | `readContract` returns 12-field tuple; mapped to typed `PositionData` interface |
| Pool address derivation (CREATE2 `PoolAddress.computeAddress` OR factory `getPool` view) | API / Backend (signing/uniswap-pool-address.ts NEW pure-math) | — | Pure-bigint CREATE2 keccak via viem; NO RPC roundtrip per pool. Researcher recommends `computePoolAddress` over factory RPC — see Topic 6 |
| Current pool state (`slot0()` → sqrtPriceX96 + tick) | API / Backend (chains/uniswap-v3-lp.ts) | — | `readContract` against derived pool address; required for IL + in-range/out-of-range flag |
| Accrued-fee math (`tokensOwed0/1` + unsettled delta from `feeGrowthInside`) | API / Backend (signing/uniswap-fees.ts NEW pure-math) | — | Pure-bigint Q128.128 fixed-point; mirror v3-periphery PositionValue.sol algorithm |
| Tick ↔ price ↔ sqrtPriceX96 conversions | API / Backend (signing/uniswap-tick.ts NEW pure-math) | — | Pure-bigint Q64.96; hand-rolled per SDK probe verdict; ~80 lines |
| Liquidity ↔ amounts math (`getAmountsForLiquidity` + `getLiquidityForAmounts`) | API / Backend (signing/uniswap-liquidity.ts NEW pure-math) | — | Pure-bigint Q64.96; sibling of uniswap-tick.ts; mirrors v3-periphery LiquidityAmounts.sol |
| IL estimate (raw + net-of-fees) | API / Backend (signing/uniswap-il.ts NEW pure-math) | — | Pure-bigint; reconstructs `(amount0_at_mint, amount1_at_mint)` from current `(liquidity, tickLower, tickUpper)`; entry-price reconstruction via tick-range midpoint when current price out-of-range (D-02 fallback) |
| NPM calldata encoding (`mint` / `increaseLiquidity` / `decreaseLiquidity` / `collect` / `burn` / `multicall(bytes[])`) | API / Backend (protocols/uniswap-v3-lp.ts NEW) | — | viem `encodeFunctionData` against parseAbi NPM fragments; mirror Phase 32 protocols/uniswap-v3.ts structure |
| Tick-snap (price → nearest valid tick per fee tier) | API / Backend (tools/prepare_uniswap_v3_mint.ts) | — | Server-side `snapPriceToTick` call; refuses if snap-delta > 100 bps (D-03) |
| Approval pre-flight (NPM as spender for ERC-20 token0/token1) | API / Backend (tools/prepare_uniswap_v3_mint.ts) | — | `ERC20(token).allowance(user, NPM)` for BOTH token0 AND token1; insufficient → `INVALID_INPUT + hintTool: "prepare_token_approve"` (Phase 28/30/31 precedent) |
| Burn pre-flight (refuses unless liquidity == 0 AND tokensOwed == 0) | API / Backend (tools/prepare_uniswap_v3_burn.ts) | — | `positions(tokenId)` read; non-zero state → `INVALID_INPUT + hintTool: "prepare_uniswap_v3_decrease_liquidity"` |
| Composite-tx preview shape (rebalance multicall decoded as 3 steps) | API / Backend (tools/preview_send.ts NEW composite-multicall arm) | — | Detect outer selector `0xac9650d8` (NPM `multicall(bytes[])`); decode `bytes[]`; recursively decode each inner call via existing per-selector dispatch; render `step N/N` sub-blocks. **NEW PATTERN** — establishes v2.5 Safe convention |
| Cryptographic-binding (`payloadFingerprint` over full multicall calldata) | API / Backend (signing/payload-fingerprint.ts FROZEN) | — | Single hash over full outer `multicall(bytes[])` calldata. UNCHANGED from Phase 4 — no shape extension needed |
| Canonical-dispatch allowlist (NPM in CANONICAL_DISPATCH_TARGETS[1]) | API / Backend (security/canonical-dispatch.ts Layer 0.5) | — | Extend Ethereum arm — single new address. Mirror Phase 32 SwapRouter02 addition pattern |
| Clear-sign display of NPM verbs | Device (Ledger) | — | NO clear-sign coverage for NPM selectors in Ledger ERC-7730 registry (verified — Topic 10). Ledger displays raw keccak hash (blind-sign). LEDGER NOTICE block required for every Phase 33 prepare tool (mirrors Phase 32 multicall blind-sign precedent) |
| Cross-export internal spy seam | API / Backend (test infrastructure) | — | `_uniswapV3LpProtocol` indirection wraps encoders + `_uniswapV3LpReader` wraps RPC reader |

---

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `viem` | 2.48.11 (project current) | `parseAbi`, `encodeFunctionData`, `encodePacked`, `keccak256`, `getAddress`, `readContract` (via publicClient), BigInt arithmetic for Q64.96 / Q128.128 fixed-point math | CLAUDE.md locked EVM stack; already in project; native BigInt supersedes JSBI; supports `int24` / `uint128` / `uint160` / `uint256` ABI types natively |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| (none new) | — | All NPM encoding + tick math + liquidity math via viem inline | No new npm dependencies needed |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Hand-rolled `priceToTick` / `tickToPrice` / `getSqrtRatioAtTick` / `getTickAtSqrtRatio` / `getAmountsForLiquidity` / `getLiquidityForAmounts` | `@uniswap/v3-sdk@3.30.1` `TickMath` + `LiquidityAmounts` + `Position.fromAmounts` | SDK pulls JSBI + 7 ethersproject v5 packages + sdk-core (which pulls JSBI + 5 more ethersproject + decimal.js-light + big.js) = ~297MB install for ~80 lines of bigint math. Returns `JSBI` types (not native bigint) — would require conversion shim at every boundary. `NonfungiblePositionManager.addCallParameters` requires ethers `Interface` — incompatible with viem stack. [VERIFIED: `npm view @uniswap/v3-sdk` 2026-05-24 + dist/*.d.ts read] **REJECTED — same grounds Phase 32 rejected the SDK** |
| Hand-rolled CREATE2 `computePoolAddress` via viem `keccak256` + `encodePacked` + `encodeAbiParameters` | RPC call to `IUniswapV3Factory.getPool(token0, token1, fee)` | Factory call is one extra `eth_call` per position (N positions × 1 call). CREATE2 deterministic compute is byte-stable per Uniswap V3 whitepaper + on-chain `PoolAddress.sol`. **Factory has never been upgraded** (deployed 2021, immutable). **Researcher recommends compute** — see Topic 6. Tradeoff: if Uniswap deploys a NEW factory variant at a different address, the compute breaks silently; mitigation = factory address is SOT-pinned + the same `POOL_INIT_CODE_HASH` value has been canonical since deployment + a runtime cross-check (one-time at module load against a known fixture pool) anchors correctness |
| inline NPM ABI via viem `parseAbi` | `@uniswap/v3-periphery` ABI JSON | Phase 28/29/30/31/32 precedent firmly rejects bundled ABI JSON in favor of inline `parseAbi` fragments — same logic applies here. Inline parseAbi is type-safe + grep-discoverable + zero new dependency |

**Installation:** No new npm packages. All encoding + math + reader uses `viem` already in project.

**Version verification:** Project's `viem@2.48.11` verified current in Phases 30 + 31 + 32 research. [VERIFIED: project package.json + Phase 32 RESEARCH.md].

---

## Package Legitimacy Audit

**No new packages introduced in Phase 33.** All Uniswap V3 LP primitives (NPM encoding + tick math + liquidity math + pool-address derivation + accrued-fee math + IL estimate) are produced via the existing `viem@2.48.11` dependency and pure-bigint TypeScript helpers in `src/signing/`. Phase 32 precedent firmly rejected `@uniswap/v3-sdk` for the swap surface; Phase 33 inherits the rejection for the LP surface on identical grounds (JSBI + ethersproject deprecated graph; v3-sdk returns JSBI not native bigint; NPM helper requires ethers Interface).

Slopcheck was nonetheless invoked on the candidate packages (researcher-rejected, but documented for transparency):

| Package | Registry | Age | Downloads | Source Repo | slopcheck | Disposition |
|---------|----------|-----|-----------|-------------|-----------|-------------|
| `@uniswap/v3-sdk` | npm | 5 yrs (`3.30.1` 2026-05-20) | ~80k/wk | [github.com/Uniswap/v3-sdk](https://github.com/Uniswap/v3-sdk) | [OK] | REJECTED at research time — deprecated JSBI + ethersproject v5 transit graph; incompatible with viem-only stack; hand-roll the ~80 lines of math primitives |
| `@uniswap/v3-core` | npm | 5 yrs (`1.0.1` 2024-07-08) | (Solidity contracts package) | [github.com/Uniswap/v3-core](https://github.com/Uniswap/v3-core) | [OK] | REJECTED — contract source only, not consumed at JS runtime |
| `@uniswap/v3-periphery` | npm | (`1.4.4` 2024-07-08) | (Solidity contracts package) | [github.com/Uniswap/v3-periphery](https://github.com/Uniswap/v3-periphery) | [OK] | REJECTED — contract source only, not consumed at JS runtime |

[VERIFIED: `slopcheck install @uniswap/v3-sdk @uniswap/v3-core @uniswap/v3-periphery` 2026-05-24 — all 3 OK]

**Packages removed due to slopcheck [SLOP] verdict:** none (no new packages introduced)
**Packages flagged as suspicious [SUS]:** none introduced.

---

## Topic 1 — SDK Probe Verdict (D-01 + D-04)

**Researcher VERDICT: HAND-ROLL all tick + liquidity + IL math.** Anchor in `src/signing/uniswap-tick.ts` (NEW) + `src/signing/uniswap-liquidity.ts` (NEW) + `src/signing/uniswap-il.ts` (NEW) + `src/signing/uniswap-fees.ts` (NEW) + `src/signing/uniswap-pool-address.ts` (NEW). Each ~30-120 lines of pure-bigint TypeScript with viem-only dependencies.

### Empirical probe (CLAUDE.md SDK Scope-Probing Discipline)

[VERIFIED 2026-05-24] `npm view @uniswap/v3-sdk version time.modified dependencies`:
```
version = '3.30.1'                                    // current
time.modified = '2026-05-20T21:33:55.890Z'            // 4 days old; stable
dependencies = {
  '@ethersproject/abi': '^5.5.0',                    // ethers v5 (deprecated; v6 stable since 2023)
  '@ethersproject/abstract-signer': '^5.7.0',
  '@ethersproject/address': '^5.0.2',
  '@ethersproject/solidity': '^5.0.9',
  '@uniswap/sdk-core': '^7.15.0',                    // pulls JSBI + 5 more ethersproject + big.js + decimal.js-light
  '@uniswap/swap-router-contracts': '^1.3.0',
  '@uniswap/v3-periphery': '^1.1.1',                 // Solidity contracts
  '@uniswap/v3-staker': '1.0.0',
  jsbi: '^3.1.4',                                    // deprecated — README says "Use native BigInt"
  'tiny-invariant': '^1.1.0',
  'tiny-warning': '^1.0.3',
  tslib: '^2.3.0'
}
```

[VERIFIED 2026-05-24] Install size: 1.4MB for `@uniswap/v3-sdk` itself; 297MB total `node_modules` after install. Transit graph includes all of ethersproject v5 + JSBI + sdk-core + 700+ transitive packages.

[VERIFIED 2026-05-24] `dist/types/src/utils/tickMath.d.ts`:
```typescript
import JSBI from 'jsbi';
export declare abstract class TickMath {
  static MIN_TICK: number;
  static MAX_TICK: number;
  static MIN_SQRT_RATIO: JSBI;
  static MAX_SQRT_RATIO: JSBI;
  static getSqrtRatioAtTick(tick: number): JSBI;          // RETURNS JSBI (not bigint)
  static getTickAtSqrtRatio(sqrtRatioX96: JSBI): number;  // ACCEPTS JSBI (not bigint)
}
```

[VERIFIED 2026-05-24] `dist/types/src/utils/sqrtPriceMath.d.ts` — `SqrtPriceMath.getAmount0Delta`/`getAmount1Delta` ALSO returns JSBI. Same for `LiquidityAmounts` (`maxLiquidityForAmounts`).

[VERIFIED 2026-05-24] `dist/types/src/nonfungiblePositionManager.d.ts`:
```typescript
import { Interface } from '@ethersproject/abi';
import { TypedDataDomain, TypedDataField } from '@ethersproject/abstract-signer';
export declare abstract class NonfungiblePositionManager {
  static INTERFACE: Interface;                            // ethers v5 Interface — INCOMPATIBLE with viem
  static addCallParameters(position: Position, options: AddLiquidityOptions): MethodParameters;
  // ...
}
```

The `addCallParameters` helper bundles the full calldata composition (including the slippage `Percent` type → `amount0Min`/`amount1Min` derivation, deadline handling, multicall composition for sweepToken / refundETH variants). **It would shortcut ~50 lines of Phase 33 work** — but it returns `MethodParameters` keyed on ethers `Interface`, which is the wrong type system for the viem-only project.

### Algorithmic surface (what we hand-roll instead)

| Function | Source | Phase 33 file | Lines (est) | Math kind |
|----------|--------|---------------|-------------|-----------|
| `getSqrtRatioAtTick(tick)` | v3-core `TickMath.sol` lines 23-205 (Solidity reference impl) | `src/signing/uniswap-tick.ts` | ~70 (the canonical iterative-shift algorithm) | Bigint shift + multiply; Q64.96 fixed-point |
| `getTickAtSqrtRatio(sqrtPriceX96)` | v3-core `TickMath.sol` lines 207-313 (binary-search MSB algorithm) | `src/signing/uniswap-tick.ts` | ~80 | Bigint MSB lookup + linear interpolation; Q64.96 |
| `priceToSqrtPriceX96(price, decimals0, decimals1)` | derivation: `sqrt(price * 2^192 * 10^(decimals0-decimals1))` | `src/signing/uniswap-tick.ts` | ~15 | Bigint sqrt approximation (Newton-Raphson) |
| `sqrtPriceX96ToPrice(sqrtPriceX96, decimals0, decimals1)` | derivation: `(sqrtPriceX96 / 2^96)^2 * 10^(decimals1-decimals0)` | `src/signing/uniswap-tick.ts` | ~15 | Bigint multiply-divide |
| `snapPriceToTick(price, fee, decimals0, decimals1)` | `nearestUsableTick(priceToTick(price), TICK_SPACINGS[fee])` | `src/signing/uniswap-tick.ts` | ~20 | Bigint divmod |
| `TICK_SPACINGS` table (per-fee tick spacing) | v3-sdk constants.ts | `src/signing/uniswap-tick.ts` | ~10 (const) | Literal map |
| `getAmount0ForLiquidity(sqrtA, sqrtB, L)` | v3-periphery `LiquidityAmounts.sol` lines 47-62 | `src/signing/uniswap-liquidity.ts` | ~10 | Bigint multiply-divide |
| `getAmount1ForLiquidity(sqrtA, sqrtB, L)` | v3-periphery `LiquidityAmounts.sol` lines 64-78 | `src/signing/uniswap-liquidity.ts` | ~10 | Bigint multiply |
| `getAmountsForLiquidity(sqrtC, sqrtA, sqrtB, L)` | v3-periphery `LiquidityAmounts.sol` lines 80-105 | `src/signing/uniswap-liquidity.ts` | ~15 | Branch on `sqrtC <=> [sqrtA, sqrtB]` |
| `getLiquidityForAmounts(sqrtC, sqrtA, sqrtB, amt0, amt1)` | v3-periphery `LiquidityAmounts.sol` lines 107-145 | `src/signing/uniswap-liquidity.ts` | ~20 | Branch + min |
| `computePoolAddress(factory, token0, token1, fee)` | v3-periphery `PoolAddress.sol` lines 22-55 | `src/signing/uniswap-pool-address.ts` | ~25 | viem `keccak256` + `encodePacked` |
| Accrued-fee delta `(feeGrowthInside - feeGrowthInsideLast) × L / 2^128` | v3-periphery `PositionValue.sol` lines 60-130 | `src/signing/uniswap-fees.ts` | ~40 (with feeGrowthInside subroutine) | Bigint multiply-divide; Q128.128 |
| IL estimate (raw + net-of-fees) | hand-derived per CONTEXT.md D-02 | `src/signing/uniswap-il.ts` | ~50 | Bigint multiply-divide; reuses uniswap-liquidity helpers |

**Total: ~380 lines of pure-bigint TypeScript.** All testable as pure functions with pinned-byte fixture inputs/outputs cross-checked against on-chain `eth_call` against v3-periphery PositionValue + LiquidityAmounts. NO JSBI; NO ethers; NO transitive deprecated packages.

### Verdict ratification matrix

| Criterion | Hand-roll | v3-sdk |
|-----------|-----------|--------|
| Match viem-only stack | ✓ | ✗ (returns JSBI; needs conversion shim) |
| Match project bundle weight discipline | ✓ (~380 LOC; 0 new deps) | ✗ (297MB install) |
| Match CLAUDE.md SDK scope-probing default-skip rule | ✓ (probe verdict negative) | ✗ |
| Tick math correctness | Anchored via on-chain eth_call cross-check at test time | Anchored via SDK maintainership |
| Future Uniswap V4 migration | Phase 33 math is V3-specific; V4 would re-roll regardless | SDK v4 is separate package |

**VERDICT: HAND-ROLL.** This matches the CONTEXT.md default leaning, the Phase 32 precedent, and the CLAUDE.md SDK Scope-Probing Discipline default-skip rule.

---

## Topic 2 — NonfungiblePositionManager ABI Reference

**Source:** [github.com/Uniswap/v3-periphery/blob/main/contracts/interfaces/INonfungiblePositionManager.sol](https://github.com/Uniswap/v3-periphery/blob/main/contracts/interfaces/INonfungiblePositionManager.sol) (read at probe install in `/tmp/uniswap-v3-sdk-probe/node_modules/@uniswap/v3-periphery/contracts/interfaces/INonfungiblePositionManager.sol`, 2026-05-24). NPM also inherits ERC-721 Metadata + ERC-721 Enumerable + IERC721Permit + IPoolInitializer + IPeripheryPayments + IPeripheryImmutableState. [VERIFIED]

### Contract address (Ethereum mainnet)

```
NonfungiblePositionManager: 0xC36442b4a4522E871399CD717aBDD847Ab11FE88
```

[VERIFIED: Etherscan + Uniswap docs + already in `UniswapV3Contracts.nonfungiblePositionManager` slot per Phase 32 D-01 — `src/config/contracts.ts:754`; getter `getUniswapV3NonfungiblePositionManagerAddress(1)` already exists per Phase 32 line 787-791]

### `positions(uint256 tokenId)` — position decode (read)

```solidity
function positions(uint256 tokenId) external view returns (
  uint96  nonce,
  address operator,
  address token0,
  address token1,
  uint24  fee,
  int24   tickLower,
  int24   tickUpper,
  uint128 liquidity,
  uint256 feeGrowthInside0LastX128,
  uint256 feeGrowthInside1LastX128,
  uint128 tokensOwed0,
  uint128 tokensOwed1
);
```

**12-field tuple return.** viem `readContract` decodes per the parseAbi fragment as `readonly [...]` tuple — Phase 33 maps to a typed `PositionData` interface. **Throws on invalid tokenId** (e.g. burned NFT) — must wrap in try/catch.

### `mint(MintParams)` — create new position

```solidity
struct MintParams {
  address token0;
  address token1;
  uint24  fee;
  int24   tickLower;
  int24   tickUpper;
  uint256 amount0Desired;
  uint256 amount1Desired;
  uint256 amount0Min;        // SLIPPAGE FLOOR (Topic 7)
  uint256 amount1Min;        // SLIPPAGE FLOOR (Topic 7)
  address recipient;
  uint256 deadline;          // PER-CALL DEADLINE (no outer multicall wrapper needed)
}

function mint(MintParams calldata params) external payable returns (
  uint256 tokenId,
  uint128 liquidity,
  uint256 amount0,
  uint256 amount1
);
```

**LOAD-BEARING field order — 11 fields.** parseAbi fragment MUST preserve canonical order. **`recipient` is at position 10** (NOT 4 as in SwapRouter02's ExactInputSingleParams — distinct shape; do NOT cross-reference).

### `increaseLiquidity(IncreaseLiquidityParams)` — add liquidity to existing position

```solidity
struct IncreaseLiquidityParams {
  uint256 tokenId;
  uint256 amount0Desired;
  uint256 amount1Desired;
  uint256 amount0Min;
  uint256 amount1Min;
  uint256 deadline;
}

function increaseLiquidity(IncreaseLiquidityParams calldata params) external payable returns (
  uint128 liquidity,
  uint256 amount0,
  uint256 amount1
);
```

### `decreaseLiquidity(DecreaseLiquidityParams)` — remove liquidity (settles to position state, NOT to user)

```solidity
struct DecreaseLiquidityParams {
  uint256 tokenId;
  uint128 liquidity;       // amount of liquidity to remove (NOT a percentage — bigint at L scale)
  uint256 amount0Min;
  uint256 amount1Min;
  uint256 deadline;
}

function decreaseLiquidity(DecreaseLiquidityParams calldata params) external payable returns (
  uint256 amount0,
  uint256 amount1
);
```

**CRITICAL: `decreaseLiquidity` does NOT transfer tokens to the user.** It accounts the withdrawn liquidity to `tokensOwed0` / `tokensOwed1` on the position. The user must then call `collect(...)` to actually receive the tokens. **Rebalance composite MUST chain `decrease + collect + mint` in that order** for tokens to flow correctly.

### `collect(CollectParams)` — harvest accrued fees + settled-but-uncollected liquidity

```solidity
struct CollectParams {
  uint256 tokenId;
  address recipient;
  uint128 amount0Max;      // collect AT MOST this much token0; pass MAX_UINT128 for "collect everything"
  uint128 amount1Max;
}

function collect(CollectParams calldata params) external payable returns (
  uint256 amount0,
  uint256 amount1
);
```

**Convention:** to collect ALL accrued fees + settled-but-uncollected liquidity, pass `amount0Max = type(uint128).max` (= `2^128 - 1` = `340282366920938463463374607431768211455`). Phase 33 `prepare_uniswap_collect` defaults to this sentinel; agent may override with explicit amounts.

### `burn(uint256 tokenId)` — close fully-decreased + fully-collected position

```solidity
function burn(uint256 tokenId) external payable;
```

**Refuses on-chain with revert** unless: `liquidity == 0 AND tokensOwed0 == 0 AND tokensOwed1 == 0`. Phase 33 `prepare_uniswap_burn` pre-flights via `positions(tokenId)` read: non-zero state → `INVALID_INPUT + hintTool: "prepare_uniswap_decrease_liquidity"` or `"prepare_uniswap_collect"` (depending on which field is non-zero).

### `multicall(bytes[])` — composite calldata wrapper (NPM inherits from `IMulticall`)

```solidity
function multicall(bytes[] calldata data) external payable returns (bytes[] memory results);
```

**4-byte selector: `0xac9650d8`** [VERIFIED via viem.toFunctionSelector at research time]

**This is DIFFERENT from Phase 32's `multicall(uint256,bytes[])` deadline overload (`0x5ae401dc`).** NPM's parent `IMulticall` interface (`@uniswap/v3-periphery/contracts/interfaces/IMulticall.sol`) declares the bytes-only overload; the SwapRouter02 deadline overload is in `@uniswap/swap-router-contracts/contracts/interfaces/IMulticallExtended.sol` (a different contract family).

**Phase 33 ships a NEW parseAbi fragment** `MULTICALL_BYTES_ABI` SEPARATE from Phase 32's `MULTICALL_DEADLINE_ABI` (which lives in `src/protocols/uniswap-v3.ts`). NPM has per-call `deadline` fields inside each MintParams/IncreaseLiquidityParams/DecreaseLiquidityParams struct, so the outer multicall doesn't need a deadline.

### ERC-721 Enumerable surface (NPM inherits)

```solidity
function balanceOf(address owner) external view returns (uint256);
function tokenOfOwnerByIndex(address owner, uint256 index) external view returns (uint256);
function ownerOf(uint256 tokenId) external view returns (address);
```

`get_lp_positions` enumeration flow:
1. `npm.balanceOf(wallet)` → `n` positions
2. `Promise.all([0..n).map(i => npm.tokenOfOwnerByIndex(wallet, i)))` → array of `tokenId`s
3. `Promise.all(tokenIds.map(id => npm.positions(id)))` → array of `PositionData` tuples
4. For each: derive pool address via `computePoolAddress(factory, token0, token1, fee)` (Topic 6)
5. For each: `IUniswapV3Pool(poolAddr).slot0()` → `sqrtPriceX96` + `tick` (current pool state)
6. For each: `IUniswapV3Pool(poolAddr).ticks(tickLower)` + `.ticks(tickUpper)` → `feeGrowthOutside0/1X128` (needed for accrued-fee unsettled-delta math per Topic 4)

Total RPC reads per position: 3-5 (`positions` + `slot0` + 2× `ticks` + optional `feeGrowthGlobal0/1X128`). For a wallet with N positions: `1 + N + N + 2N + N = 5N + 1` reads. Reasonable to batch via `multicall3` (`0xcA11bde05977b3631167028862bE2a173976CA11`) — researcher recommends NOT adding multicall3 plumbing at Phase 33 (matches Phase 28-31 precedent of straightforward Promise.all fan-out); ergonomics improvement deferred.

### Selectors (VERIFIED via viem.toFunctionSelector at research-write time + Etherscan inspection)

```
0x88316456  mint((address,address,uint24,int24,int24,uint256,uint256,uint256,uint256,address,uint256))
0x219f5d17  increaseLiquidity((uint256,uint256,uint256,uint256,uint256,uint256))
0x0c49ccbe  decreaseLiquidity((uint256,uint128,uint256,uint256,uint256))
0xfc6f7865  collect((uint256,address,uint128,uint128))
0x42966c68  burn(uint256)                          — SELECTOR COLLISION WARNING: shares with rETH.burn from Phase 31 + ERC-20 Burnable extension
0xac9650d8  multicall(bytes[])                     — selector distinct from Phase 32's 0x5ae401dc
0x99fbab88  positions(uint256)                     — view
0x70a08231  balanceOf(address)                     — view (ERC-721 standard)
0x2f745c59  tokenOfOwnerByIndex(address,uint256)   — view (ERC-721 Enumerable standard)
0x6352211e  ownerOf(uint256)                       — view (ERC-721 standard)
```

[VERIFIED — selectors stable for 5+ years; cross-checked by computing keccak256 prefix of canonical signatures via viem.toFunctionSelector]

**Selector collision on `0x42966c68` (`burn(uint256)`):** ALSO matches Phase 31's `rETH.burn(uint256)` (Rocket Pool unstake) AND the generic ERC-20 Burnable extension. `(to, selector)` tuple dispatch at `preview_send` resolves: when `to == getUniswapV3NonfungiblePositionManagerAddress(1)`, render as NPM burn (with NFT-id decode); when `to == getRocketPoolRethAddress(1)`, render as Rocket Pool burn (with WEI decode). Mirrors the Phase 31 selector-collision discipline pattern.

---

## Topic 3 — Tick Math Primitives (D-01 deliverable)

Hand-rolled in `src/signing/uniswap-tick.ts` (NEW), pure-bigint, viem-only. The algorithms are canonical (Uniswap V3 whitepaper §6 + on-chain `TickMath.sol`).

### Q64.96 fixed-point representation

`sqrtPriceX96 = sqrt(price) * 2^96`, where `price = token1/token0` (in raw units, before decimal adjustment).

### Canonical tick spacings per fee tier

[VERIFIED via `@uniswap/v3-sdk/dist/cjs/src/constants.js` 2026-05-24 — also matches v3-core Factory deployment configuration]

| Fee tier (uint24) | Tick spacing | Use case |
|--------------------|---------------|----------|
| 100 (0.01%) | 1 | Stablecoin pairs (USDC/USDT) |
| 500 (0.05%) | 10 | Blue-chip pairs (ETH/USDC) |
| 3000 (0.30%) | 60 | Standard pairs (most pools) |
| 10000 (1.00%) | 200 | Exotic / volatile pairs |

**Phase 33 ships only these 4 standard tiers.** The SDK constants also list `LOW_200` / `LOW_300` / `LOW_400` (spacings 4 / 6 / 8) — these are **L2-only fee tiers** added later (per [github.com/Uniswap/v3-sdk/pull/322](https://github.com/Uniswap/v3-sdk/pull/322)). Phase 33 is Ethereum-only — exclude. Literal-union type in `PathHop` (Phase 32) is `100 | 500 | 3000 | 10000` — Phase 33 reuses.

### tick ↔ sqrtPriceX96

```
sqrtPriceX96 = sqrt(1.0001^tick) * 2^96
            = 1.0001^(tick/2) * 2^96
```

The canonical algorithm (`TickMath.getSqrtRatioAtTick`) iterates over bit positions of |tick| and multiplies by precomputed shift constants. ~70 lines. Reverse (`getTickAtSqrtRatio`) is binary-search MSB lookup. ~80 lines. Pinned-byte fixtures in `test/signing-uniswap-tick.test.ts` cross-check against on-chain Pool `slot0().sqrtPriceX96 ↔ slot0().tick` pairs (e.g. USDC/WETH 0.05% pool at a known block).

### tick ↔ human price

```
price_token1_per_token0 = 1.0001^tick / 10^(decimals1 - decimals0)
```

For USDC/WETH (decimals0=6, decimals1=18): `price = 1.0001^tick / 10^12`. `tickToPrice(202000) ≈ 1900 USDC/WETH ≈ 1900 USDC per 1 WETH`. Phase 33 `tickToHumanPrice(tick, fee, decimals0, decimals1)` returns a JS `number` for human display + a decimal-string for CHECKS PERFORMED block.

### priceToTick + snap

```typescript
function priceToTick(price: string, decimals0: number, decimals1: number): bigint {
  // 1. parse decimal-string price into Q64.96 sqrtPriceX96
  // 2. call getTickAtSqrtRatio
  // 3. return as int24
}

function snapPriceToTick(price: string, fee: 100|500|3000|10000, decimals0: number, decimals1: number): {
  tick: number,
  snappedPrice: string,     // tickToHumanPrice(tick, ...)
  snapDeltaBps: number,     // |snappedPrice - price| / price * 10000
} {
  const rawTick = priceToTick(price, decimals0, decimals1);
  const spacing = TICK_SPACINGS[fee];
  const snapped = Math.round(rawTick / spacing) * spacing;
  // ...
}
```

D-03 refuses if `snapDeltaBps > 100`. Surfaces snapped tick + delta in CHECKS PERFORMED block.

### Implementation references

- [github.com/Uniswap/v3-core/blob/main/contracts/libraries/TickMath.sol](https://github.com/Uniswap/v3-core/blob/main/contracts/libraries/TickMath.sol) — canonical Solidity impl; line-by-line translation to TypeScript
- [Uniswap V3 whitepaper §6](https://uniswap.org/whitepaper-v3.pdf) — math derivation
- [docs.uniswap.org/sdk/v3/guides/usage](https://docs.uniswap.org/sdk/v3/guides/usage) — SDK examples (algorithmic reference only — Phase 33 hand-rolls)

---

## Topic 4 — Accrued Fees Computation

Source: [github.com/Uniswap/v3-periphery/blob/main/contracts/libraries/PositionValue.sol](https://github.com/Uniswap/v3-periphery/blob/main/contracts/libraries/PositionValue.sol) lines 60-130 (PositionValue.fees). [VERIFIED]

**Accrued fee total =** `tokensOwed0/1` (settled portion from last interaction) + **unsettled delta** from `(feeGrowthInside0/1X128 - feeGrowthInside0/1LastX128) × liquidity / 2^128`.

### Computing `feeGrowthInside` from current pool state

```
feeGrowthInside0X128 = computeFeeGrowthInside(
  feeGrowthGlobal0X128,                                  // Pool view: feeGrowthGlobal0X128()
  ticks(tickLower).feeGrowthOutside0X128,
  ticks(tickUpper).feeGrowthOutside0X128,
  tickLower,
  tickUpper,
  currentTick                                            // Pool view: slot0().tick
)
```

The `computeFeeGrowthInside` subroutine branches on `currentTick` position relative to the range:
- `currentTick < tickLower`: `feeGrowthInside = feeGrowthBelow_upper - feeGrowthBelow_lower`
- `currentTick >= tickUpper`: `feeGrowthInside = feeGrowthAbove_lower - feeGrowthAbove_upper`
- in-range: `feeGrowthInside = feeGrowthGlobal - feeGrowthBelow_lower - feeGrowthAbove_upper`

Where:
- `feeGrowthBelow_x = (currentTick >= tickX) ? feeGrowthOutside_x : feeGrowthGlobal - feeGrowthOutside_x`
- `feeGrowthAbove_x = (currentTick >= tickX) ? feeGrowthGlobal - feeGrowthOutside_x : feeGrowthOutside_x`

**Q128.128 fixed-point — overflow-by-design.** The subtraction `feeGrowthInside - feeGrowthInsideLast` is wrapping bigint subtraction modulo 2^256; the multiplication-by-liquidity-then-shift-128 produces the actual accrued token amount. viem BigInt supports modular arithmetic via `BigInt.asUintN(256, x - y)`.

### Phase 33 surface

`get_lp_positions` surfaces ONE combined `accruedFees: { amount0: "12.345", amount1: "0.0023" }` field per position (settled + unsettled combined; decimal strings normalized to token decimals). CHECKS PERFORMED notes the breakdown if settled-vs-unsettled differs by >1% (informational only).

Pure-bigint implementation in `src/signing/uniswap-fees.ts` (NEW). ~40 lines including `computeFeeGrowthInside` subroutine. Pinned-byte regression test in `test/signing-uniswap-fees.test.ts` against a known position with known accrued fees at a fixed block height.

---

## Topic 5 — IL Estimate (D-02)

**IL (Impermanent Loss)** = comparison between holding the position vs holding the same `(amount0_at_mint, amount1_at_mint)` as a 50/50 portfolio at current prices.

### Entry price reconstruction from position state

From `positions(tokenId)` we have `(liquidity, tickLower, tickUpper)` but NOT the price at mint time. The canonical reconstruction:

```
sqrtPriceAtMint = function(currentLiquidity, tickLower, tickUpper):
  // CASE 1: position is in-range OR was in-range at last interaction
  //   The price at mint was somewhere in [tickLower, tickUpper]; if no fee growth has changed since
  //   mint, the position state is consistent with mint price = current price (within rounding).
  //   For an active in-range position, reconstruct via:
  //     amount0_at_mint, amount1_at_mint = getAmountsForLiquidity(sqrtPriceAtMint, sqrtRatioAtTickLower, sqrtRatioAtTickUpper, L)
  //   But we don't know sqrtPriceAtMint independently — it's the unknown.
  //
  // CANONICAL APPROACH (per CONTEXT.md D-02): re-derive from CURRENT (liquidity, tickLower, tickUpper)
  //   This works UNAMBIGUOUSLY when current price is IN-RANGE at observation time:
  //     amount0_at_mint = liquidity * (sqrt(P_upper) - sqrt(P)) / (sqrt(P_upper) * sqrt(P))
  //     amount1_at_mint = liquidity * (sqrt(P) - sqrt(P_lower))
  //   where P = current sqrtPriceX96 (which we read from slot0()).
  //   This is the canonical Uniswap V3 inverse — given a position with known liquidity and current
  //   in-range price, the amounts that "would mint this liquidity at this price" are deterministic.
  //   We treat this as the entry baseline.
```

**OUT-OF-RANGE AMBIGUITY (D-02 anchor):**

When current price is OUT of range, the position has been fully converted to one side (all token0 if price below range; all token1 if price above range). We know WHICH side exited but NOT the exact entry price. Three candidate heuristics:

1. **Geometric midpoint of tick range** = `sqrt(sqrt(P_lower) * sqrt(P_upper))` = entry-price assumption is the geometric mean of range bounds. **CONTEXT.md D-02 anchored choice.** Surfaces `ilEstimateConfidence: "low"`.
2. **Arithmetic midpoint of sqrtPrice** = `(sqrtPrice_lower + sqrtPrice_upper) / 2`. Closer to user intuition but less mathematically canonical for sqrt-based ranges.
3. **Refuse to estimate** when out of range. Returns `ilEstimate: null, ilEstimateReason: "out-of-range — cannot reconstruct entry price"`. Maximally honest but loses signal.

**Researcher recommends OPTION 1 (geometric midpoint) per CONTEXT.md D-02 — but adds option 3 as a fallback when range is asymmetric to >10× ratio (`sqrt(P_upper) / sqrt(P_lower) > 10`).** Reason: extreme asymmetric ranges (e.g. a moonshot range bet `[$1, $1000000]` on a $5 token) make midpoint heuristic meaningless. `[ASSUMED]` — the asymmetry threshold of 10× is a researcher guess; could be anywhere from 5× to 100×. Flag for user confirmation at discuss-phase or first executor PR.

### IL formula

Given:
- `(amt0_mint, amt1_mint)` = reconstructed entry amounts at `sqrtPriceAtMint`
- `(amt0_now, amt1_now)` = current position amounts at `sqrtPriceX96_current` (via `getAmountsForLiquidity`)
- `price_now = token1/token0` ratio at current

```
hodl_value_in_token1 = amt0_mint * price_now + amt1_mint
position_value_in_token1 = amt0_now * price_now + amt1_now
raw_il_token1 = position_value - hodl_value             // negative when impermanent loss
raw_il_bps = (raw_il_token1 / hodl_value_in_token1) * 10000

net_of_fees_il_token1 = raw_il_token1 + (accruedFees.amount0 * price_now + accruedFees.amount1)
net_of_fees_il_bps = (net_of_fees_il_token1 / hodl_value_in_token1) * 10000
```

Surfaces in `get_lp_positions` response:
```json
{
  "ilEstimate": {
    "rawIlBps": -120,                      // negative = loss
    "netOfFeesIlBps": -45,                 // less negative thanks to fees
    "ilEstimateConfidence": "high" | "low",
    "rawIlLabel": "[ESTIMATE] -1.20% raw IL vs hodl",
    "netOfFeesIlLabel": "[ESTIMATE] -0.45% net-of-fees IL vs hodl",
    "method": "in-range entry-price reconstruction" | "out-of-range geometric-midpoint heuristic"
  }
}
```

Pure-bigint implementation in `src/signing/uniswap-il.ts` (NEW). ~50 lines. Pinned-byte regression test with synthetic position state.

---

## Topic 6 — Pool Address Derivation

Two paths, both viable:

### Path A: Factory `getPool(token0, token1, fee)` RPC call

```solidity
IUniswapV3Factory.getPool(address tokenA, address tokenB, uint24 fee) external view returns (address pool);
```

Pros: returns the actual deployed pool address; if a future Uniswap deploys a new factory variant, this stays correct.
Cons: extra RPC call per position (N positions × 1 call); requires factory address as a new SOT entry.

### Path B: CREATE2 `PoolAddress.computeAddress(factory, PoolKey{token0, token1, fee})`

```
pool = address(keccak256(abi.encodePacked(
  0xff,
  factoryAddress,
  keccak256(abi.encode(token0, token1, fee)),       // PoolKey hash
  POOL_INIT_CODE_HASH                                // 0xe34f199b19b2b4f47f68442619d555527d244f78a3297ea89325f843f87b8b54
)))
```

Where:
- Factory address (Ethereum mainnet, CHAIN AGNOSTIC): `0x1F98431c8aD98523631AE4a59f267346ea31F984` [VERIFIED: v3-sdk constants.ts + Etherscan]
- `POOL_INIT_CODE_HASH = 0xe34f199b19b2b4f47f68442619d555527d244f78a3297ea89325f843f87b8b54` [VERIFIED: same — pinned in v3-periphery `PoolAddress.sol` line 7]
- token0 < token1 (sorted lexicographically per `PoolAddress.getPoolKey` — Phase 33 helper must sort)

Pros: pure-bigint compute via viem `keccak256` + `encodePacked` + `encodeAbiParameters`; ZERO additional RPC; deterministic across the entire Uniswap V3 deployment.
Cons: would break silently if Uniswap deploys a NEW factory variant at a different address (which has never happened on Ethereum mainnet in 5+ years; factory contract is immutable).

### Researcher recommendation: Path B (CREATE2 compute)

**Implement in `src/signing/uniswap-pool-address.ts` (NEW).** Add factory address + init-code-hash as `UNISWAP_V3_FACTORY_ADDRESS` + `UNISWAP_V3_POOL_INIT_CODE_HASH` module-level consts (verified at module load via test cross-check against the canonical USDC/WETH 0.05% pool: `0x88e6A0c2dDD26FEEb64F039a2c41296FcB3f5640` [VERIFIED: Etherscan]).

Add a one-time module-load assertion: `computePoolAddress(USDC, WETH, 500) === "0x88e6A0c2dDD26FEEb64F039a2c41296FcB3f5640"`. Fires at first import — if either the factory address or the init-code hash drifts, the assertion throws at module load.

**Anti-fragility:** if Uniswap eventually deploys a new factory variant (e.g. for V3.1 with different curve), the existing pool addresses for token pairs deployed under the OLD factory remain correct. New pools under a NEW factory would simply not be discoverable — would surface as "pool not found" via `slot0()` revert, which `get_lp_positions` already handles gracefully (skip with diagnostic).

[CITED: docs.uniswap.org/contracts/v3/reference/periphery/libraries/PoolAddress]

---

## Topic 7 — Slippage Parameters (Sandwich-MEV Defense Applicability to LP Verbs)

CONTEXT.md `<specifics>` notes that LP mint/increase/decrease don't have a swap leg by themselves — and Phase 33 D-03 defers WETH-pair convenience entry points. So the sandwich-MEV gate from Phase 32 UNI-03 (`>2% price impact → INVALID_INPUT + hintTool`) does NOT apply by construction to LP verbs.

**BUT**: NPM `mint` / `increaseLiquidity` / `decreaseLiquidity` natively accept `amount0Min` / `amount1Min` slippage parameters. These protect against pool reserves shifting between the `eth_call` for ratio discovery and the actual swap — a different attack class than swap sandwich-MEV.

### Researcher recommendation

**Surface explicit `amount0Min` + `amount1Min` parameters in `prepare_uniswap_v3_mint` + `prepare_uniswap_v3_increase_liquidity` + `prepare_uniswap_v3_decrease_liquidity`.**

Server defaults: `amount0Min = amount0Desired * (10000 - 50) / 10000` (0.5% slippage tolerance). Agent can override via explicit `slippageBps` parameter. **NO gate at >2% impact for LP** — different attack model (the user is depositing into a pool, not extracting value from one). Document in CHECKS PERFORMED block: `slippageBps: 50 (0.5% slippage tolerance — amount0Min: 99.5 USDC, amount1Min: 0.0498 ETH)`.

**`collect` and `burn` do NOT need slippage params** — they settle existing accounting, no new pool interaction. **`decreaseLiquidity` DOES need slippage** — the proportional split of removed liquidity into token0/token1 depends on the spot price at removal time.

---

## Topic 8 — NonfungiblePositionManager Spender Status (CONTEXT.md D-04 Open Question)

**CONFIRMED: NPM IS a spender — KNOWN_SPENDERS_ETHEREUM promotion REQUIRED.**

### Evidence

Source: [github.com/Uniswap/v3-periphery/blob/main/contracts/NonfungiblePositionManager.sol](https://github.com/Uniswap/v3-periphery/blob/main/contracts/NonfungiblePositionManager.sol) `addLiquidity()` internal function (lines ~95-130).

When `mint` or `increaseLiquidity` is called:
1. NPM computes `amount0` + `amount1` from `(liquidity, sqrtPrice, tickLower, tickUpper)`
2. NPM internally calls `IUniswapV3Pool.mint(...)` which triggers `IUniswapV3MintCallback.uniswapV3MintCallback(amount0Owed, amount1Owed, data)` on NPM
3. The callback decodes `data` (which carries the original user's payer address) and calls `pay(token, payer, recipient, value)` which routes to `TransferHelper.safeTransferFrom(token, payer, recipient, value)`
4. **`safeTransferFrom` requires the user to have already called `approve(NPM, amount)` on the token.**

For `decreaseLiquidity` / `collect` / `burn`: the user is interacting with their OWN NFT (NPM owner authorization via ERC-721 `ownerOf(tokenId)` checks); no ERC-20 spender approval needed.

### Net for KNOWN_SPENDERS_ETHEREUM

**Promote at Plan 33-01.** Add one new row:
```typescript
{
  address: getUniswapV3NonfungiblePositionManagerAddress(1)!,
  label: "Uniswap V3 NonfungiblePositionManager",
  source: "https://docs.uniswap.org/contracts/v3/reference/periphery/NonfungiblePositionManager",
},
```

Cross-view test `T-UNISWAP-V3-NPM-SPENDER-DRIFT-1` in `test/config-contracts.test.ts` mirrors Phase 32 `T-UNISWAP-V3-SPENDER-DRIFT-1` pattern.

### `prepare_uniswap_v3_mint` approval pre-flight

Server reads `ERC20(token0).allowance(user, NPM)` AND `ERC20(token1).allowance(user, NPM)` at prepare time. If either is insufficient → `INVALID_INPUT + hintTool: "prepare_token_approve"` with the specific token + required amount. Mirrors Phase 28/30/31 precedent. Reuses the existing `KNOWN_SPENDERS_ETHEREUM` label discovery so `prepare_token_approve` surfaces `Approving: 1000 USDC for "Uniswap V3 NonfungiblePositionManager"` in CHECKS PERFORMED.

---

## Topic 9 — Composite-Tx Preview Shape (D-06 — NEW PATTERN)

This is the first composite-tx in the codebase. The design carefully establishes the convention for v2.5 Safe (Gnosis) multisig three-step (propose / approve / execute).

### Shape

**ONE tool** (`prepare_uniswap_v3_rebalance`) returns **ONE handle** with **ONE calldata payload**:
```typescript
{
  handle: "<uuid>",
  chainId: 1,
  to: getUniswapV3NonfungiblePositionManagerAddress(1),
  valueWei: "0",
  data: <multicall(bytes[]) wrapping [decreaseLiquidity, collect, mint]>,
  payloadFingerprint: keccak256("VaultPilot-txverify-v1:" || chainId || to || value || data),
  prepareReceipt: <PREPARE RECEIPT block with COMPOSITE intent only>,
}
```

**PREPARE RECEIPT** records ONLY the composite intent (verbatim agent args):
```
PREPARE RECEIPT — prepare_uniswap_v3_rebalance:
  chain:           ethereum (chainId 1)
  tokenId:         12345
  newTickLower:    -207000   (snapped from priceLower: 1850.00)
  newTickUpper:    -202000   (snapped from priceUpper: 2050.00)
  from:            0x...
```

NOT the individual step args (those decode at preview time).

**CHECKS PERFORMED** at `preview_send` time surfaces decoded sub-blocks:
```
CHECKS PERFORMED — composite rebalance (3 sub-calls):
  step 1/3 — decreaseLiquidity:
    tokenId:    12345
    liquidity:  3289473921 (full position liquidity)
    amount0Min: 99.5 USDC
    amount1Min: 0.0498 ETH
    deadline:   2026-05-24T15:00:00Z
  step 2/3 — collect:
    tokenId:    12345
    recipient:  0x... (user)
    amount0Max: MAX_UINT128 (collect everything)
    amount1Max: MAX_UINT128 (collect everything)
  step 3/3 — mint:
    token0:     0xA0b8…6eB48 (USDC)
    token1:     0xC02a…56Cc2 (WETH)
    fee:        500 (0.05%)
    tickLower:  -207000 (price 1850.00)
    tickUpper:  -202000 (price 2050.00)
    amount0Desired: 100.0 USDC
    amount1Desired: 0.05 ETH
    amount0Min: 99.5 USDC
    amount1Min: 0.0498 ETH
    recipient:  0x... (user)
    deadline:   2026-05-24T15:00:00Z
```

### Cryptographic-binding chain (unchanged)

- `payloadFingerprint` covers the FULL outer `multicall(bytes[])` calldata (single hash). Drift in ANY inner sub-call → outer calldata bytes change → fingerprint changes → `send_transaction` refuses with `prepare↔send drift detected`.
- `previewToken` + `userDecision: "send"` gate at `send_transaction` UNCHANGED.
- LEDGER BLIND-SIGN HASH UNCHANGED — Ledger sees the outer `multicall(bytes[])` selector + raw bytes + blind-signs. LEDGER NOTICE block warns user.

### `preview_send` extension — NEW composite-multicall arm

Add a NEW DECODED ARGS dispatch arm in `src/tools/preview_send.ts`:
```typescript
// Selector: 0xac9650d8 — NPM multicall(bytes[])
// When detected AND to == NPM address: decode bytes[] and recursively decode each inner call
if (selector === UNISWAP_V3_LP_SELECTORS.multicallBytes && to === npmAddress) {
  const innerCalls = decodeAbiParameters([{ type: "bytes[]" }], data.slice(10));
  const decodedSteps = innerCalls.map((innerCalldata, i) => {
    const innerSelector = innerCalldata.slice(0, 10);
    // Reuse existing per-selector decoders:
    //   0x0c49ccbe → decodeDecreaseLiquidity
    //   0xfc6f7865 → decodeCollect
    //   0x88316456 → decodeMint
    //   0x219f5d17 → decodeIncreaseLiquidity
    //   0x42966c68 → decodeBurn (NPM-keyed)
    return buildStepBlock(i + 1, innerCalls.length, innerSelector, innerCalldata);
  });
  return renderCompositeMulticallBlock(decodedSteps);
}
```

**Recursion depth: 1.** A multicall containing a nested multicall is not a Phase 33 case (rebalance is always 3 leaf calls). If a future phase needs nested multicall, the dispatch arm needs widening — Phase 33 doesn't pre-design that.

### v2.5 Safe three-step convention transfer

The composite-multicall preview pattern from Phase 33 IS the canonical reference for v2.5 Safe (Phase 36-38). Safe's three-step (propose → approve → execute) wraps multiple Safe operations in a single `execTransaction(...)` call; the preview shape will mirror: one tool, one handle, decode the inner operations as step N/N sub-blocks. **Phase 33's `renderCompositeMulticallBlock` is intentionally generic** — Phase 36+ Safe surface will reuse the rendering helper with an `operationsDecoder` plug-point.

---

## Topic 10 — Ledger ERC-7730 Clear-Sign Coverage

[VERIFIED 2026-05-24 via inspection of github.com/LedgerHQ/clear-signing-erc7730-registry/tree/master/registry/uniswap]

**Coverage status:** The Uniswap V3 calldata coverage in the Ledger ERC-7730 registry contains ONLY `calldata-UniswapV3Router02.json` (Phase 32 SwapRouter02). **There is NO `calldata-UniswapV3NonfungiblePositionManager.json`.**

**Conclusion: ALL Phase 33 NPM transactions BLIND-SIGN on Ledger.** Device displays raw keccak hash; user has no on-device decoded view.

### Mitigation

Phase 33 ships a NEW `LEDGER_NOTICE_UNISWAP_V3_LP_TEMPLATE` block constant in `src/signing/blocks.ts`, emitted UNCONDITIONALLY on every Phase 33 prepare tool response (mirrors Phase 32's `LEDGER_NOTICE_UNISWAP_V3_TEMPLATE` precedent + Phase 6 WETH9.withdraw + Phase 31 EigenLayer/Rocket Pool patterns).

Copy template:
```
LEDGER NOTICE — Uniswap V3 LP operations blind-sign on device

The Ledger Ethereum app does NOT have ERC-7730 clear-sign coverage for the
Uniswap V3 NonfungiblePositionManager contract. When you sign this transaction,
the device will display the keccak256 hash of the calldata, NOT the decoded
operation (mint / increaseLiquidity / collect / etc.).

Before approving on-device, verify the LEDGER BLIND-SIGN HASH below matches what
the device displays. The CHECKS PERFORMED block above shows the decoded args the
server computed server-side — if those args don't match what you intended, refuse
on-device and call the appropriate tool again.

Coverage may be added in a future Ledger app update; consult Ledger's ERC-7730
registry at https://github.com/LedgerHQ/clear-signing-erc7730-registry.
```

---

## Topic 11 — `src/chains/uniswap-v3-lp.ts` Reader Shape

Mirror of `src/chains/aave-v3.ts` (Phase 7) — sibling-shelf helper that the `get_lp_positions` tool imports.

### Exported helpers

```typescript
// ABI fragments
export const NPM_READ_ABI = parseAbi([
  "function positions(uint256 tokenId) view returns (uint96 nonce, address operator, address token0, address token1, uint24 fee, int24 tickLower, int24 tickUpper, uint128 liquidity, uint256 feeGrowthInside0LastX128, uint256 feeGrowthInside1LastX128, uint128 tokensOwed0, uint128 tokensOwed1)",
  "function balanceOf(address owner) view returns (uint256)",
  "function tokenOfOwnerByIndex(address owner, uint256 index) view returns (uint256)",
]);

export const POOL_READ_ABI = parseAbi([
  "function slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)",
  "function feeGrowthGlobal0X128() view returns (uint256)",
  "function feeGrowthGlobal1X128() view returns (uint256)",
  "function ticks(int24 tick) view returns (uint128 liquidityGross, int128 liquidityNet, uint256 feeGrowthOutside0X128, uint256 feeGrowthOutside1X128, int56 tickCumulativeOutside, uint160 secondsPerLiquidityOutsideX128, uint32 secondsOutside, bool initialized)",
]);

// Typed decoded shape
export interface PositionData {
  tokenId: bigint;
  token0: Address;
  token1: Address;
  fee: 100 | 500 | 3000 | 10000;
  tickLower: number;
  tickUpper: number;
  liquidity: bigint;
  feeGrowthInside0LastX128: bigint;
  feeGrowthInside1LastX128: bigint;
  tokensOwed0: bigint;
  tokensOwed1: bigint;
  // not from NPM but joined at reader time:
  poolAddress: Address;
  currentSqrtPriceX96: bigint;
  currentTick: number;
  inRange: boolean;
  // pool tick state (for unsettled-fee delta math):
  feeGrowthGlobal0X128: bigint;
  feeGrowthGlobal1X128: bigint;
  tickLowerState: { feeGrowthOutside0X128: bigint; feeGrowthOutside1X128: bigint };
  tickUpperState: { feeGrowthOutside0X128: bigint; feeGrowthOutside1X128: bigint };
}

// Main reader
export async function readUserPositions(
  client: PublicClient,
  npmAddress: Address,
  wallet: Address,
): Promise<readonly PositionData[]>

// ESM spy-affordance
export const _uniswapV3LpReader = { readUserPositions };
```

### Implementation notes

- `Promise.allSettled` (NOT `Promise.all`) at every fan-out site so one broken position (e.g. burned NFT race condition) doesn't poison the whole batch. Filter rejected to `null` + log to stderr. Mirror Phase 32 `src/chains/uniswap-v3.ts` Quoter V2 fan-out pattern (Promise.allSettled for per-fee-tier iteration).
- Per-wallet wallet-address-derived from `get_ledger_status` per existing convention (Phase 7+).
- `inRange = currentTick >= tickLower && currentTick < tickUpper` (Uniswap V3 convention; tickUpper is exclusive).
- 10-second per-fan-out `AbortController` timeout (mirror Phase 8 `get_portfolio_summary` cross-chain plumbing).

---

## Topic 12 — Existing Code Insights (PATTERNS to Clone)

### Reusable assets

- **`src/protocols/uniswap-v3.ts`** (Phase 32) — multi-method protocol decoder with selector-collision-warning idiom + parseAbi + struct-field-order pinning + `_uniswapV3Protocol` ESM spy-affordance. Phase 33 ships SEPARATE `src/protocols/uniswap-v3-lp.ts` (NPM decoder; distinct concern from SwapRouter02 / QuoterV2). Comment block discipline + selector table + encoders pattern cloned verbatim.
- **`src/signing/uniswap-path.ts`** (Phase 32) — pure-bytes encoder (encodePacked) with ESM spy-affordance + intermediate-token continuity validation. Phase 33 sibling-shelf at `src/signing/uniswap-tick.ts` / `uniswap-liquidity.ts` / `uniswap-il.ts` / `uniswap-fees.ts` / `uniswap-pool-address.ts` — five NEW pure-math files following the same shelf pattern.
- **`src/chains/aave-v3.ts`** (Phase 7) — sibling-shelf chain reader for the prepare tool's protocol-decoder concern. Phase 33 mirrors structure for `src/chains/uniswap-v3-lp.ts`.
- **`src/tools/prepare_aave_supply.ts`** (Phase 7) — mechanical-clone template for the 5 single-step LP prepares. Each Phase 33 prepare tool clones this shape: input schema → resolve chain → resolve `from` → checksum addresses → resolve decimals → parse amounts → check approval pre-flight (mint+increase only) → encode calldata → createHandle → compute payloadFingerprint → return structured response with PREPARE RECEIPT block.
- **`src/tools/prepare_uniswap_swap.ts`** (Phase 32 Plan 32-03) — closest sandwich-MEV gate + approval pre-flight precedent (NOT needed at Phase 33 mint per Topic 7 — different attack class; but the approval pre-flight pattern reuses).
- **`src/config/contracts.ts`** `KNOWN_SPENDERS_ETHEREUM` — NPM promotion is one new row (Topic 8), SOT-getter-delegated. Mirror Phase 31 EigenLayer/Rocket Pool 3-row insertion pattern.
- **`CANONICAL_DISPATCH_TARGETS`** per-chain table — additive append for NPM. Mirror Phase 32 SwapRouter02 single-row addition pattern.
- **`src/signing/blocks.ts`** DECODED ARGS switch — additive entries for NPM selectors (mint / increase / decrease / collect / burn) + new `composite-multicall` arm + new `LEDGER_NOTICE_UNISWAP_V3_LP_TEMPLATE`. Mirror Phase 32 extensions.
- **`test/signing-fingerprint.test.ts`** Fixtures UNI-A/B/C (Phase 32) — direct shape match for UNI-LP-{A..F}. Hardcoded `0x...` literals + cross-link comments + persona-cycle byte-identity. Phase 33 adds 6 new fixtures (one per verb shape).

### Established patterns

- **Mechanical-clone-of-prior-prepare** — each Phase 33 prepare tool is a clone of `prepare_aave_supply` shape with bounded deviations (input schema fields differ per verb; PREPARE RECEIPT template differs; calldata encoder differs).
- **PREPARE RECEIPT verbatim relay** — every `prepare_*` includes verbatim agent args.
- **`payloadFingerprint` re-check at send time** — Phase 4 trust pipeline FROZEN. For composite rebalance, fingerprint covers full multicall calldata (single hash).
- **Fixture hardcoded literals + cross-link from consumer tests** — CLAUDE.md cryptographic-binding rule.
- **Persona-cycle byte-identity integration test** — Phase 6/7/28/30/31/32 precedent.
- **`INVALID_INPUT + hintTool` intent-vs-reality** — Phase 28/30/31/32 precedent. Phase 33 reuses for: approval-insufficient (mint), out-of-range-snap-too-far (mint), burn-non-empty (burn), tokenId-not-found (all), tokenId-not-owned-by-user (all).
- **`address(0)` sentinel filter in canonical-dispatch** — Phase 30 Lido-arm precedent; Phase 33 inherits the filter (NPM has no zero-address sentinel by construction; filter is defense-in-depth).
- **ESM spy-affordance** — `_uniswapV3LpProtocol` + `_uniswapV3LpReader` indirections.

### Integration points

- **`src/server.ts` register-all** — additive imports for 7 new tools: `get_lp_positions` + 5 single-step prepares + `prepare_uniswap_v3_rebalance`. Registered in `src/tools/register-all.ts` alongside existing Phase 32 prepare tool.
- **`preview_send` selector dispatch** — extend with NPM selectors (mint / increase / decrease / collect / burn) AND new composite-multicall arm. Selector table grows by 5 + new composite branch.
- **`src/signing/blocks.ts`** — DECODED ARGS extensions + new `LEDGER_NOTICE_UNISWAP_V3_LP_TEMPLATE` + 5 new PREPARE RECEIPT templates (one per single-step prepare; rebalance receipt template is the 6th) + 1 new composite-multicall preview rendering helper.
- **`src/config/contracts.ts`** — `KNOWN_SPENDERS_ETHEREUM` NPM row promotion (one new row). NPM SOT slot already populated at Phase 32; no SOT-shape extension.
- **`src/security/canonical-dispatch.ts`** — Ethereum-arm extension (one new address from `getUniswapV3NonfungiblePositionManagerAddress(1)`).
- **`SECURITY.md`** — §6 v2.4 addendum (D-02 IL-estimate residual risk + D-06 composite-tx preview shape rationale + Topic 10 NPM blind-sign defense-in-depth + Topic 5 out-of-range entry-price heuristic acceptance).

### What's NOT in scope (Phase 34-35 + deferred)

- Curve swap + add-liquidity — Phase 34 CRV-01..03.
- `prepare_custom_call` escape hatch — Phase 35 CUSTOM-01..03.
- Multi-chain Uniswap V3 LP (Polygon / Arbitrum / Base / Optimism) — v2.4.x follow-up, mirrors Phase 32 swap multi-chain deferral.
- Uniswap V4 hooks — defer to v3.x.
- LP-strategy automation (auto-rebalance triggers, range-order watchers, fee-compounding loops) — v3.5+ ergonomics surface.
- WETH-pair convenience entry points (`mint` with native ETH instead of pre-wrapped WETH) — out of scope for v2.4; user calls `prepare_weth_wrap` first.

---

## Common Pitfalls

### Pitfall 1: Decimals adjustment in price ↔ tick conversions

**What goes wrong:** `tickToPrice` returns raw `token1/token0` ratio at on-chain scale. For USDC/WETH (USDC = token0, decimals=6; WETH = token1, decimals=18), the raw on-chain ratio at tick 202000 is ~`1.0001^202000 ≈ 6.5e-10` — meaningless to a user. The human price is `1900 USDC/WETH`, computed as `1 / (raw_ratio * 10^(decimals0 - decimals1)) = 1 / (6.5e-10 * 10^(-12)) ≈ 1538` — wait, that's still wrong.

**Why it happens:** Token ordering is sorted lexicographically by address (token0 < token1). For USDC/WETH on Ethereum mainnet, `USDC (0xA0b8...) < WETH (0xC02a...)`, so USDC = token0 + WETH = token1. The on-chain price = `token1/token0` = `WETH / USDC` ≈ `0.0005` (one USDC buys ~0.0005 ETH). The human price "1900 USDC per ETH" is the INVERSE. Confusion between which token is the numerator silently produces inverted-price calldata that snaps to the wrong tick range.

**How to avoid:** Helper functions `tickToHumanPrice(tick, decimals0, decimals1, invertPriceDisplay)` accept an `invertPriceDisplay: boolean` flag. CHECKS PERFORMED block surfaces BOTH `priceInRaw: "0.000527 WETH/USDC"` AND `priceInverted: "1900.50 USDC/WETH"`. Test fixtures include both directions.

**Warning signs:** Snap delta is consistently >5000 bps. User-supplied price strings are >1000× off the on-chain spot. CHECKS PERFORMED price display contradicts the user's mental model.

### Pitfall 2: Sorting token0/token1 in `mint`

**What goes wrong:** User passes `{ token0: WETH, token1: USDC }` (intuitive — "I want a WETH/USDC pool"). NPM `mint` reverts with `InvalidTokenOrder` because pool addresses are derived from sorted tokens; the pool at `(WETH, USDC, 500)` does not exist — only `(USDC, WETH, 500)`.

**Why it happens:** Uniswap V3 enforces `token0 < token1` (address-lexicographic). The pool is `(token0, token1, fee)` keyed; passing the wrong order targets a non-existent address.

**How to avoid:** Server-side `sortTokenPair(tokenA, tokenB)` helper called BEFORE calldata encoding. If user-supplied order doesn't match sorted order, swap internally + surface in CHECKS PERFORMED: `Note: token order normalized — pool key is (token0=USDC, token1=WETH); your amounts have been re-labeled accordingly`. Refuse if `amount0Desired` and `amount1Desired` would be confused as a result.

**Warning signs:** Mint reverts at simulation. `pool address` derived comes out as a non-deployed address (NO bytecode at that address).

### Pitfall 3: `decreaseLiquidity` does NOT transfer tokens

**What goes wrong:** User calls `prepare_uniswap_v3_decrease_liquidity(tokenId, 100%)`, signs, broadcasts — and then their wallet balance hasn't changed. The decreased liquidity sits in `tokensOwed0/1` on the position, waiting for a separate `collect()` call.

**Why it happens:** Per Topic 2 NPM ABI — `decreaseLiquidity` accounts withdrawn liquidity to position state, not the user's balance. This is a Uniswap V3 design choice (lets you batch multiple decrease calls before settling).

**How to avoid:** `prepare_uniswap_v3_decrease_liquidity` PREPARE RECEIPT + CHECKS PERFORMED includes a verbatim NOTICE: `IMPORTANT: This decreases liquidity but does NOT transfer tokens to your wallet. Call prepare_uniswap_collect({tokenId}) AFTER this transaction confirms to receive the tokens.` Tool description includes this in the agent-routing prompt.

**Warning signs:** User reports "I decreased my position but my balance didn't change" — agent should route to `prepare_uniswap_collect` as the recovery action.

### Pitfall 4: `MAX_UINT128` sentinel for `collect`

**What goes wrong:** Passing `amount0Max = u128 max - 1` (= 2^128 - 2) instead of `u128 max` (= 2^128 - 1) is a silent off-by-one. Same shape as Phase 7 Aave `amount: "max"` sentinel — but Aave uses `MAX_UINT256`, Phase 33 collect uses `MAX_UINT128` (different type — `uint128` not `uint256`).

**Why it happens:** Reading the CollectParams.amount0Max type as "max uint" without checking that it's specifically `uint128`. Off-by-one fails to collect the final wei.

**How to avoid:** Module-level constant `MAX_UINT128 = (1n << 128n) - 1n = 340282366920938463463374607431768211455n` in `src/protocols/uniswap-v3-lp.ts`. Hardcoded literal anchor in test (pinned-byte fixture).

### Pitfall 5: `feeGrowthInside` Q128.128 wrapping math

**What goes wrong:** `feeGrowthInside - feeGrowthInsideLast` underflows to a huge positive number when written as native unsigned bigint subtraction. Position appears to have collected billions of tokens in fees.

**Why it happens:** Q128.128 fee accounting is intentionally modular — the on-chain Solidity uses overflow-by-design. JavaScript bigint is arbitrary-precision and doesn't wrap. The delta must be computed via `BigInt.asUintN(256, feeGrowthInside - feeGrowthInsideLast)` (modular reduction).

**How to avoid:** All `feeGrowthInside` deltas in `src/signing/uniswap-fees.ts` use `BigInt.asUintN(256, ...)` wrapper. Pinned-byte regression test includes a case where the wrap fires (synthetic state where `feeGrowthInside < feeGrowthInsideLast` numerically).

**Warning signs:** `accruedFees` field shows astronomical values (10^20+ tokens). Tests pass without wrap because synthetic state is too small to trigger.

### Pitfall 6: Pool address derivation pre-condition (token0 < token1 sort)

**What goes wrong:** `computePoolAddress(factory, tokenA, tokenB, fee)` returns a different address depending on the input order of tokenA/tokenB unless they're pre-sorted.

**Why it happens:** `PoolAddress.getPoolKey` sorts inputs internally; if your helper doesn't sort, you might compute the address for `(tokenB, tokenA, fee)` which is NOT a valid pool key.

**How to avoid:** `computePoolAddress` helper in `src/signing/uniswap-pool-address.ts` ALWAYS sorts inputs internally before keccak. Cross-check the canonical USDC/WETH 0.05% pool at module load.

### Pitfall 7: `multicall(bytes[])` decode in `preview_send`

**What goes wrong:** Decoding `multicall(bytes[])` via `decodeFunctionData` returns the inner bytes array; recursive per-selector decode of each inner call must reuse the SAME dispatcher logic as the outer dispatch. If the recursion is hand-coded inline, drift creeps in (e.g. outer dispatch handles NPM selectors but the rebalance recursion doesn't).

**How to avoid:** Extract per-selector decode into a `decodeSingleNpmCall(innerCalldata, npmAddress, chainId)` helper used by BOTH the outer dispatch arm AND the composite-multicall recursion. Single source of truth for "how to decode an NPM call".

---

## Code Examples

### NPM ABI fragments (parseAbi-typed) — for `src/protocols/uniswap-v3-lp.ts`

```typescript
// Source: github.com/Uniswap/v3-periphery/blob/main/contracts/interfaces/INonfungiblePositionManager.sol
import { parseAbi } from "viem";

export const NPM_WRITE_ABI = parseAbi([
  "function mint((address token0, address token1, uint24 fee, int24 tickLower, int24 tickUpper, uint256 amount0Desired, uint256 amount1Desired, uint256 amount0Min, uint256 amount1Min, address recipient, uint256 deadline)) external payable returns (uint256 tokenId, uint128 liquidity, uint256 amount0, uint256 amount1)",
  "function increaseLiquidity((uint256 tokenId, uint256 amount0Desired, uint256 amount1Desired, uint256 amount0Min, uint256 amount1Min, uint256 deadline)) external payable returns (uint128 liquidity, uint256 amount0, uint256 amount1)",
  "function decreaseLiquidity((uint256 tokenId, uint128 liquidity, uint256 amount0Min, uint256 amount1Min, uint256 deadline)) external payable returns (uint256 amount0, uint256 amount1)",
  "function collect((uint256 tokenId, address recipient, uint128 amount0Max, uint128 amount1Max)) external payable returns (uint256 amount0, uint256 amount1)",
  "function burn(uint256 tokenId) external payable",
]);

export const MULTICALL_BYTES_ABI = parseAbi([
  // NOTE: distinct from Phase 32's MULTICALL_DEADLINE_ABI in src/protocols/uniswap-v3.ts
  "function multicall(bytes[] data) external payable returns (bytes[])",
]);

export const UNISWAP_V3_LP_SELECTORS = {
  mint:               "0x88316456" as const,
  increaseLiquidity:  "0x219f5d17" as const,
  decreaseLiquidity:  "0x0c49ccbe" as const,
  collect:            "0xfc6f7865" as const,
  burn:               "0x42966c68" as const,  // COLLISION: rETH.burn (Phase 31), ERC-20 Burnable
  multicallBytes:     "0xac9650d8" as const,  // distinct from 0x5ae401dc (Phase 32 deadline overload)
} as const;

export const MAX_UINT128: bigint = (1n << 128n) - 1n;  // 340282366920938463463374607431768211455n
```

### `computePoolAddress` — for `src/signing/uniswap-pool-address.ts`

```typescript
// Source: github.com/Uniswap/v3-periphery/blob/main/contracts/libraries/PoolAddress.sol
import { type Address, encodeAbiParameters, encodePacked, getAddress, keccak256 } from "viem";

export const UNISWAP_V3_FACTORY_ADDRESS: Address = getAddress("0x1F98431c8aD98523631AE4a59f267346ea31F984");
export const UNISWAP_V3_POOL_INIT_CODE_HASH: `0x${string}` = "0xe34f199b19b2b4f47f68442619d555527d244f78a3297ea89325f843f87b8b54";

export function computePoolAddress(
  tokenA: Address,
  tokenB: Address,
  fee: 100 | 500 | 3000 | 10000,
): Address {
  const [token0, token1] = tokenA.toLowerCase() < tokenB.toLowerCase() ? [tokenA, tokenB] : [tokenB, tokenA];
  const poolKeyHash = keccak256(
    encodeAbiParameters(
      [{ type: "address" }, { type: "address" }, { type: "uint24" }],
      [token0, token1, fee],
    ),
  );
  const create2 = keccak256(
    encodePacked(
      ["bytes1", "address", "bytes32", "bytes32"],
      ["0xff", UNISWAP_V3_FACTORY_ADDRESS, poolKeyHash, UNISWAP_V3_POOL_INIT_CODE_HASH],
    ),
  );
  return getAddress(`0x${create2.slice(26)}`);  // take last 20 bytes
}

// Module-load self-check — anchors factory + init-code-hash correctness.
// USDC + WETH 0.05% pool: 0x88e6A0c2dDD26FEEb64F039a2c41296FcB3f5640 (Etherscan VERIFIED).
const _USDC = getAddress("0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48");
const _WETH = getAddress("0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2");
const _USDC_WETH_500 = getAddress("0x88e6A0c2dDD26FEEb64F039a2c41296FcB3f5640");
if (computePoolAddress(_USDC, _WETH, 500) !== _USDC_WETH_500) {
  throw new Error(
    "uniswap-pool-address.ts module load self-check FAILED — factory address OR POOL_INIT_CODE_HASH OR computeAddress impl drifted",
  );
}
```

### Mint calldata composition skeleton

```typescript
// src/tools/prepare_uniswap_v3_mint.ts (skeleton)
import { encodeFunctionData } from "viem";
import { NPM_WRITE_ABI, _uniswapV3LpProtocol } from "../protocols/uniswap-v3-lp.js";
import { getUniswapV3NonfungiblePositionManagerAddress } from "../config/contracts.js";

const data = encodeFunctionData({
  abi: NPM_WRITE_ABI,
  functionName: "mint",
  args: [{
    token0,
    token1,
    fee,
    tickLower,
    tickUpper,
    amount0Desired,
    amount1Desired,
    amount0Min,
    amount1Min,
    recipient: fromAddress,
    deadline,
  }],
});

const tx = {
  chainId,
  to: getUniswapV3NonfungiblePositionManagerAddress(chainId)!,
  valueWei: 0n,
  data,
};
const payloadFingerprint = computePayloadFingerprint(tx);
const handle = createHandle({ args: rawArgs, tx, payloadFingerprint });
```

### Composite rebalance calldata composition

```typescript
// src/tools/prepare_uniswap_v3_rebalance.ts (skeleton)
import { encodeFunctionData } from "viem";
import { MAX_UINT128, MULTICALL_BYTES_ABI, NPM_WRITE_ABI } from "../protocols/uniswap-v3-lp.js";

// Step 1: decrease all liquidity (position.liquidity from prior positions(tokenId) read)
const decreaseCalldata = encodeFunctionData({
  abi: NPM_WRITE_ABI,
  functionName: "decreaseLiquidity",
  args: [{ tokenId, liquidity: currentLiquidity, amount0Min, amount1Min, deadline }],
});

// Step 2: collect everything
const collectCalldata = encodeFunctionData({
  abi: NPM_WRITE_ABI,
  functionName: "collect",
  args: [{ tokenId, recipient: fromAddress, amount0Max: MAX_UINT128, amount1Max: MAX_UINT128 }],
});

// Step 3: mint at new range (uses tokens just collected; agent passes new tickLower/tickUpper)
const mintCalldata = encodeFunctionData({
  abi: NPM_WRITE_ABI,
  functionName: "mint",
  args: [{ token0, token1, fee, tickLower: newTickLower, tickUpper: newTickUpper,
    amount0Desired, amount1Desired, amount0Min: newAmount0Min, amount1Min: newAmount1Min,
    recipient: fromAddress, deadline }],
});

// Wrap in multicall(bytes[]) — NOT the deadline overload
const data = encodeFunctionData({
  abi: MULTICALL_BYTES_ABI,
  functionName: "multicall",
  args: [[decreaseCalldata, collectCalldata, mintCalldata]],
});

// Single tx — single fingerprint covers the whole composite payload
const tx = { chainId, to: getUniswapV3NonfungiblePositionManagerAddress(chainId)!, valueWei: 0n, data };
const payloadFingerprint = computePayloadFingerprint(tx);
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `@uniswap/v3-sdk` for tick + liquidity math | Hand-rolled pure-bigint primitives (Phase 32 + 33 precedent in this repo) | Project convention since Phase 32 | Avoid JSBI + ethers v5 transit graph; ~380 LOC instead of 297MB install |
| ethers v5 `Interface` for calldata encoding | viem `parseAbi` + `encodeFunctionData` | Project convention since Phase 1 | Type-safe, smaller bundle, native bigint |
| Factory `getPool` RPC for pool address | CREATE2 `computePoolAddress` (recommended) | Phase 33 introduces; one RPC saved per position | Deterministic, anchored at module load |
| `getParsedTokenAccountsByOwner` Solana | Manual SPL decode (Phase 11/12) | Phase 11 | Public RPC limits force manual decode |

**Deprecated / outdated:**
- JSBI library — README says "Use native BigInt"; v3-sdk still depends on it (5+ years stale dependency); hand-rolling avoids the transit graph.
- ethers v5 — replaced by ethers v6 (which still doesn't match viem-only project convention); avoid.

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | The CREATE2 pool-address-compute factory address `0x1F98431c8aD98523631AE4a59f267346ea31F984` and `POOL_INIT_CODE_HASH = 0xe34f199b19b2b4f47f68442619d555527d244f78a3297ea89325f843f87b8b54` are immutable for the Uniswap V3 factory on Ethereum mainnet, AND no future V3.1 will deploy a NEW factory at a different address that the codebase needs to handle | Topic 6 (Pool Address Derivation) | Mitigated by module-load self-check against the known USDC/WETH 0.05% pool — drift fires at import time, not at silent wrong-pool reads. If a NEW factory variant ships, get_lp_positions silently skips positions under it (acceptable — surfaces as "no positions found" rather than wrong addresses) |
| A2 | The geometric-midpoint heuristic for out-of-range IL estimate entry-price reconstruction (CONTEXT.md D-02) is the canonical industry approach — versus an alternative the user might prefer (e.g. arithmetic midpoint or refuse-to-estimate) | Topic 5 (IL Estimate) | If user prefers a different fallback: re-implement the heuristic switch + update the `ilEstimateConfidence` "low" condition + adjust fixture values for out-of-range IL tests |
| A3 | The asymmetric-range threshold of 10× (`sqrt(P_upper) / sqrt(P_lower) > 10` triggering option-3 refuse-to-estimate fallback) is reasonable — could be anywhere from 5× to 100× | Topic 5 (IL Estimate) | Threshold tuning at discuss-phase or first executor PR; doesn't change architecture |
| A4 | The Ledger ERC-7730 registry has no NPM calldata coverage as of 2026-05-24 — and no coverage is forthcoming in the immediate term (3-6 months) such that the unconditional LEDGER NOTICE block is the right design choice | Topic 10 (Clear-Sign Coverage) | If Ledger adds coverage later, the LEDGER NOTICE block becomes informational-only (no functional bug); could opportunistically remove in a future cleanup |
| A5 | Slippage default of 50 bps (0.5%) is appropriate for LP mint/increase/decrease — versus the 200 bps swap default or a tighter LP-specific value | Topic 7 (Slippage) | Default tuning at first executor PR; user can override explicitly via `slippageBps` |
| A6 | Composite-rebalance preview shape (one tool, one handle, multicall sub-call decoding as step N/N sub-blocks) is the right design for v2.5 Safe three-step transfer — versus an alternative shape (e.g. multiple handles, or explicit `executeStep(N)` tool surface) | Topic 9 (Composite-Tx Preview Shape) | If Safe convention diverges, Phase 36 re-designs that surface; Phase 33 composite-multicall preview helper stays generic and reusable |
| A7 | The 5N+1 RPC reads per get_lp_positions call (N positions × {positions + slot0 + 2× ticks + 1× feeGrowthGlobal}) is acceptable performance without multicall3 batching | Topic 2 (NPM ABI — Reader Flow) | If perf is unacceptable (e.g. wallet with 50+ positions): add multicall3 plumbing in follow-up; non-blocking for Phase 33 ship |

**Assumptions that should be confirmed at discuss-phase OR first executor PR:** A2, A3, A5. (A1 is high-confidence given immutable factory contract; A4 is verified empirically; A6 is forward-design where Phase 36 has authority; A7 is performance-only.)

---

## Open Questions (RESOLVED)

1. **Should `prepare_uniswap_v3_rebalance` accept new amounts (`amount0Desired`, `amount1Desired`) or use ALL collected from decrease+collect?**
   - What we know: rebalance decreases all current liquidity → collects all tokens → mints at new range. The amounts available for mint are exactly what `decrease + collect` settles. Phase 33 prepare doesn't know the EXACT amounts until simulation (they depend on current pool price affecting the proportional split).
   - What's unclear: Whether agent specifies new amounts (overriding the collected amounts — implies extra approval for any deficit) or whether server uses ALL of what collect returns (simpler but constrains user choice).
   - RESOLVED: Phase 33 ships with `amounts ← all-of-collect-output` semantics. CHECKS PERFORMED notes: `mint amounts derived from decrease+collect output — to add additional liquidity, call prepare_uniswap_v3_increase_liquidity after the rebalance confirms.` Future enhancement: `extraAmount0`/`extraAmount1` agent parameters for top-up. Anchored in Plan 33-03 Task 2 §B step 7.

2. **Should `get_lp_positions` skip positions with `liquidity == 0 AND tokensOwed == 0` (effectively burned but NFT not collected)?**
   - What we know: NPM NFTs persist after `decreaseLiquidity` clears liquidity until `burn` is called. A user might have several "drained" NFTs cluttering their wallet.
   - What's unclear: Whether to show them (with `status: "drained, ready-to-burn"`) or filter them out.
   - RESOLVED: SHOW them with a `status` field — user might want to know to burn them (gas refund). Filter is opt-in via `{ includeDrainedPositions: false }` agent parameter (default true). Plan 33-01 Task 3 implements; not load-bearing for any of UNI-04..10 success criteria.

3. **Should the SDK probe verdict be re-evaluated for IL math specifically?**
   - What we know: SDK rejected on JSBI + ethers grounds across the board.
   - What's unclear: The IL math is ~50 lines of pure formula derivation — the SDK doesn't have a public "computeIL" helper either, so this is hand-rolled regardless.
   - RESOLVED: SDK is not relevant for IL — Phase 33 implements from first principles using the hand-rolled liquidity helpers. No revisit needed.

---

## Environment Availability

Phase 33 has no NEW external dependencies. All existing infrastructure (Ledger USB-HID + WalletConnect + Ethereum mainnet RPC + viem) is verified working in Phases 1-32.

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Ethereum mainnet RPC (PublicNode or user-configured) | `get_lp_positions`, all 6 prepares | ✓ (existing) | — | publicnode fallback configured |
| `viem@2.48.11` | All Phase 33 code | ✓ (existing) | 2.48.11 | — |
| Node ≥ 18.17 | All Phase 33 code | ✓ (project standard) | — | — |
| Etherscan RPC (verification only, not runtime) | researcher cross-checking | ✓ | — | — |
| Uniswap V3 NPM contract on mainnet | All Phase 33 code | ✓ (5+ years live) | — | — |

**Missing dependencies with no fallback:** none.
**Missing dependencies with fallback:** none.

---

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest (project standard since Phase 1) |
| Config file | `vitest.config.ts` |
| Quick run command | `npm test -- <pattern>` |
| Full suite command | `npm test` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| UNI-04 | `get_lp_positions` returns positions per NFT-id with required envelope | unit + integration | `npm test -- test/get-lp-positions.test.ts test/integration-uniswap-v3-lp.test.ts` | ❌ Wave 0 (created Plan 33-01) |
| UNI-04 | Tick math primitives (`priceToTick`, `tickToPrice`, `getSqrtRatioAtTick`, `getTickAtSqrtRatio`, `snapPriceToTick`) | unit | `npm test -- test/signing-uniswap-tick.test.ts` | ❌ Wave 0 |
| UNI-04 | Liquidity math (`getAmountsForLiquidity`, `getLiquidityForAmounts`) | unit | `npm test -- test/signing-uniswap-liquidity.test.ts` | ❌ Wave 0 |
| UNI-04 | Accrued fee computation | unit | `npm test -- test/signing-uniswap-fees.test.ts` | ❌ Wave 0 |
| UNI-04 | IL estimate (in-range + out-of-range fallback) | unit | `npm test -- test/signing-uniswap-il.test.ts` | ❌ Wave 0 |
| UNI-04 | Pool address derivation + module-load self-check | unit | `npm test -- test/signing-uniswap-pool-address.test.ts` | ❌ Wave 0 |
| UNI-05 | `prepare_uniswap_v3_mint` (calldata + approval pre-flight + tick snap) | unit | `npm test -- test/prepare-uniswap-v3-mint.test.ts` | ❌ Wave 0 |
| UNI-05 | Fixture UNI-LP-A (mint payloadFingerprint hardcoded literal) | unit | `npm test -- test/signing-fingerprint.test.ts -t UNI-LP-A` | ❌ Wave 0 |
| UNI-06 | `prepare_uniswap_v3_increase_liquidity` | unit | `npm test -- test/prepare-uniswap-v3-increase-liquidity.test.ts` | ❌ Wave 0 |
| UNI-06 | Fixture UNI-LP-B (increase fingerprint) | unit | `npm test -- test/signing-fingerprint.test.ts -t UNI-LP-B` | ❌ Wave 0 |
| UNI-06 | `prepare_uniswap_v3_decrease_liquidity` (with NOTICE about tokens-not-transferred) | unit | `npm test -- test/prepare-uniswap-v3-decrease-liquidity.test.ts` | ❌ Wave 0 |
| UNI-06 | Fixture UNI-LP-C (decrease fingerprint) | unit | `npm test -- test/signing-fingerprint.test.ts -t UNI-LP-C` | ❌ Wave 0 |
| UNI-07 | `prepare_uniswap_v3_collect` (with MAX_UINT128 sentinel default) | unit | `npm test -- test/prepare-uniswap-v3-collect.test.ts` | ❌ Wave 0 |
| UNI-07 | Fixture UNI-LP-D (collect fingerprint) | unit | `npm test -- test/signing-fingerprint.test.ts -t UNI-LP-D` | ❌ Wave 0 |
| UNI-08 | `prepare_uniswap_v3_burn` (with pre-flight refusal on non-empty position) | unit | `npm test -- test/prepare-uniswap-v3-burn.test.ts` | ❌ Wave 0 |
| UNI-08 | Fixture UNI-LP-E (burn fingerprint) | unit | `npm test -- test/signing-fingerprint.test.ts -t UNI-LP-E` | ❌ Wave 0 |
| UNI-09 | `prepare_uniswap_v3_rebalance` (3-step multicall composition) | unit | `npm test -- test/prepare-uniswap-v3-rebalance.test.ts` | ❌ Wave 0 |
| UNI-09 | Fixture UNI-LP-F (rebalance multicall fingerprint) | unit | `npm test -- test/signing-fingerprint.test.ts -t UNI-LP-F` | ❌ Wave 0 |
| UNI-09 | Composite-multicall preview shape (preview_send composite arm) | unit + integration | `npm test -- test/preview-send.uniswap-v3-lp-composite.test.ts` | ❌ Wave 0 |
| UNI-10 | NPM SOT slot already populated (Phase 32 invariant) | unit | `npm test -- test/config-contracts.test.ts -t UNISWAP_V3_NPM_PRESENT` | ✅ (Phase 32) |
| UNI-10 | NPM promoted to KNOWN_SPENDERS_ETHEREUM (`T-UNISWAP-V3-NPM-SPENDER-DRIFT-1`) | unit | `npm test -- test/config-contracts.test.ts -t UNISWAP-V3-NPM-SPENDER-DRIFT` | ❌ Wave 0 |
| UNI-10 | NPM in canonical-dispatch Ethereum arm | unit | `npm test -- test/security-canonical-dispatch.test.ts -t Uniswap_V3_NPM` | ❌ Wave 0 |
| UNI-10 | Persona-cycle byte-identity integration (all 6 fixtures) | integration | `npm test -- test/integration-uniswap-v3-lp.test.ts` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `npm test -- <touched-test-file>` (vitest watch mode acceptable for local dev)
- **Per wave merge:** `npm test` (full suite)
- **Phase gate:** Full suite green before `/gsd-verify-work`

### Wave 0 Gaps
- [ ] `test/get-lp-positions.test.ts` — covers UNI-04
- [ ] `test/integration-uniswap-v3-lp.test.ts` — covers UNI-04 + UNI-09 persona-cycle byte-identity
- [ ] `test/signing-uniswap-tick.test.ts` — covers UNI-04 tick math
- [ ] `test/signing-uniswap-liquidity.test.ts` — covers UNI-04 liquidity math
- [ ] `test/signing-uniswap-fees.test.ts` — covers UNI-04 fee math
- [ ] `test/signing-uniswap-il.test.ts` — covers UNI-04 IL estimate
- [ ] `test/signing-uniswap-pool-address.test.ts` — covers UNI-04 pool address derivation
- [ ] `test/protocols-uniswap-v3-lp.test.ts` — covers NPM ABI + selector + encoder regressions
- [ ] `test/prepare-uniswap-v3-mint.test.ts` — covers UNI-05
- [ ] `test/prepare-uniswap-v3-increase-liquidity.test.ts` — covers UNI-06
- [ ] `test/prepare-uniswap-v3-decrease-liquidity.test.ts` — covers UNI-06
- [ ] `test/prepare-uniswap-v3-collect.test.ts` — covers UNI-07
- [ ] `test/prepare-uniswap-v3-burn.test.ts` — covers UNI-08
- [ ] `test/prepare-uniswap-v3-rebalance.test.ts` — covers UNI-09
- [ ] `test/preview-send.uniswap-v3-lp-composite.test.ts` — covers UNI-09 composite preview shape
- [ ] `test/signing-fingerprint.test.ts` extension — covers Fixtures UNI-LP-{A,B,C,D,E,F}
- [ ] `test/config-contracts.test.ts` extension — covers `T-UNISWAP-V3-NPM-SPENDER-DRIFT-1`
- [ ] `test/security-canonical-dispatch.test.ts` extension — covers NPM in dispatch allowlist
- [ ] Framework install: NONE — vitest already in project

---

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes (Ledger ownership) | Existing Phase 4 trust pipeline (WalletConnect + on-device approval) — UNCHANGED for Phase 33 |
| V3 Session Management | yes (WC session) | Existing — UNCHANGED |
| V4 Access Control | yes (NFT ownership) | NPM `ownerOf(tokenId)` enforces on-chain that only the NFT owner can decrease/collect/burn the position. Phase 33 server-side pre-flight reads `ownerOf` and refuses if `from !== ownerOf(tokenId)` with `INVALID_INPUT + intent-vs-reality` (mirrors Phase 28+ pattern) |
| V5 Input Validation | yes | Zod schemas at MCP tool surface; `parseAmountStrict` for decimal handling; `priceToTick` snap-delta refusal at >100 bps (D-03); tickLower < tickUpper invariant; fee enum validation (100|500|3000|10000) |
| V6 Cryptography | yes — Layer 3 fingerprint-drift | `payloadFingerprint = keccak256("VaultPilot-txverify-v1:" || chainId || to || value || data)` UNCHANGED from Phase 4. Drift in any byte of multicall calldata → fingerprint changes → send refuses |
| V7 Error Handling | yes | Structured error envelopes via `makeStructuredError(code, message, cause)`; `INVALID_INPUT + hintTool` for all preflight refusals (approval-insufficient, burn-non-empty, snap-too-far, ownership-mismatch); errorCode union FROZEN (no new errorCodes needed — all reuse existing codes) |

### Known Threat Patterns for Uniswap V3 LP

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Front-running on mint with manipulated pool price | T (Tampering) — pool reserves shift between quote and execution | `amount0Min` / `amount1Min` slippage parameters in MintParams; server defaults to 50 bps tolerance; agent can override |
| Compromised agent silently swaps tick range to attacker's range | T | `payloadFingerprint` covers full mint calldata including tickLower/tickUpper; CHECKS PERFORMED surfaces decoded tick range; LEDGER NOTICE warns user to verify on-device hash |
| Wrong-pool-key attack (wrong token0/token1 order) | I (Information Disclosure / wrong fund destination) | Server-side `sortTokenPair` normalization; module-load `computePoolAddress` self-check; CHECKS PERFORMED surfaces "token order normalized" note |
| User decreases liquidity, forgets to collect, position sits in `tokensOwed0/1` | I (user confusion, not adversarial) | PREPARE RECEIPT + CHECKS PERFORMED for `decreaseLiquidity` includes explicit NOTICE pointing at `prepare_uniswap_collect` recovery action |
| Burn on non-empty position reverts on-chain (wasted gas) | T (DoS via wasted gas) | Server-side pre-flight via `positions(tokenId)`; refuses with `INVALID_INPUT + hintTool` BEFORE the user signs |
| Composite rebalance with wrong inner-step composition | T (multi-step semantic confusion) | `payloadFingerprint` covers FULL multicall outer calldata (single hash); ALL 3 inner sub-calls protected by the single hash; preview surfaces decoded step N/N sub-blocks for user verification |
| Pool address derivation drift (factory upgrade silently invalidates compute) | T (silent wrong-address routing) | Module-load self-check against canonical USDC/WETH 0.05% pool address fires at import time |
| Slopcheck-flagged dependency drift (any future package addition to Phase 33) | T (supply-chain) | NO new packages in Phase 33; if Phase 33.x adds any package, slopcheck gate enforced |
| `feeGrowthInside` wrap math producing astronomical accrued-fees display | I (user misinformation) | `BigInt.asUintN(256, ...)` modular reduction at every delta subtraction; pinned-byte regression test with wrap-triggering synthetic state |

---

## Sources

### Primary (HIGH confidence)
- [github.com/Uniswap/v3-periphery/blob/main/contracts/interfaces/INonfungiblePositionManager.sol](https://github.com/Uniswap/v3-periphery/blob/main/contracts/interfaces/INonfungiblePositionManager.sol) — NPM ABI source [VERIFIED via local install probe 2026-05-24]
- [github.com/Uniswap/v3-core/blob/main/contracts/libraries/TickMath.sol](https://github.com/Uniswap/v3-core/blob/main/contracts/libraries/TickMath.sol) — canonical tick math reference [CITED]
- [github.com/Uniswap/v3-periphery/blob/main/contracts/libraries/LiquidityAmounts.sol](https://github.com/Uniswap/v3-periphery/blob/main/contracts/libraries/LiquidityAmounts.sol) — `getAmountsForLiquidity` + `getLiquidityForAmounts` canonical reference [CITED]
- [github.com/Uniswap/v3-periphery/blob/main/contracts/libraries/PositionValue.sol](https://github.com/Uniswap/v3-periphery/blob/main/contracts/libraries/PositionValue.sol) — accrued-fee + position-value reference [VERIFIED via local install probe 2026-05-24]
- [github.com/Uniswap/v3-periphery/blob/main/contracts/libraries/PoolAddress.sol](https://github.com/Uniswap/v3-periphery/blob/main/contracts/libraries/PoolAddress.sol) — `computeAddress` CREATE2 algorithm + `POOL_INIT_CODE_HASH` [VERIFIED via local install probe 2026-05-24]
- [github.com/Uniswap/v3-core/blob/main/contracts/interfaces/IUniswapV3Factory.sol](https://github.com/Uniswap/v3-core/blob/main/contracts/interfaces/IUniswapV3Factory.sol) — factory `getPool` (alternative to CREATE2 compute) [VERIFIED]
- [Uniswap V3 whitepaper §6](https://uniswap.org/whitepaper-v3.pdf) — tick math derivation [CITED]
- [docs.uniswap.org/contracts/v3/reference/periphery/NonfungiblePositionManager](https://docs.uniswap.org/contracts/v3/reference/periphery/NonfungiblePositionManager) — NPM docs [CITED]
- Phase 32 RESEARCH.md — protocol decoder + multicall + fixture-pinning + sandwich-MEV gate precedents [VERIFIED via in-repo read 2026-05-24]
- Phase 7 `src/tools/prepare_aave_supply.ts` — mechanical-clone template for single-step prepares [VERIFIED via in-repo read 2026-05-24]
- `src/protocols/uniswap-v3.ts` (Phase 32) — protocol decoder analog [VERIFIED via in-repo read 2026-05-24]
- `src/signing/uniswap-path.ts` (Phase 32) — pure-math sibling-shelf analog [VERIFIED via in-repo read 2026-05-24]
- `src/config/contracts.ts` (Phase 32) — UniswapV3Contracts SOT with NPM slot pre-populated [VERIFIED via in-repo read 2026-05-24]
- `src/security/canonical-dispatch.ts` (Phase 32) — Ethereum-arm extension pattern [VERIFIED via in-repo read 2026-05-24]

### Secondary (MEDIUM confidence)
- [docs.uniswap.org/contracts/v3/reference/periphery/libraries/PoolAddress](https://docs.uniswap.org/contracts/v3/reference/periphery/libraries/PoolAddress) — pool address compute docs [CITED]
- [docs.uniswap.org/contracts/v3/guides/liquidity-mining/overview](https://docs.uniswap.org/contracts/v3/guides/liquidity-mining/overview) — rebalance multicall canonical pattern [CITED]
- [github.com/LedgerHQ/clear-signing-erc7730-registry/tree/master/registry/uniswap](https://github.com/LedgerHQ/clear-signing-erc7730-registry/tree/master/registry/uniswap) — verified NO NPM coverage as of 2026-05-24 [VERIFIED]
- `@uniswap/v3-sdk@3.30.1` `dist/types/src/utils/tickMath.d.ts` — SDK type signatures (researcher REJECTED SDK; types still useful as algorithmic reference) [VERIFIED via local install probe]
- `@uniswap/v3-sdk@3.30.1` `dist/cjs/src/constants.js` — canonical `TICK_SPACINGS` map per fee tier [VERIFIED]

### Tertiary (LOW confidence)
- A2 (geometric-midpoint IL fallback) + A3 (10× asymmetry threshold) + A5 (50 bps default slippage for LP) + A6 (composite-multicall as v2.5 Safe convention basis) — researcher judgment; no canonical industry standard exists. Documented as [ASSUMED] for discuss-phase or first executor PR confirmation.

---

## Metadata

**Confidence breakdown:**
- SDK probe verdict (hand-roll): HIGH — empirically verified, deprecated transit graph, viem-only project convention
- NPM ABI + selectors + addresses: HIGH — verified via local install probe + Etherscan
- Tick math primitives: HIGH — canonical Solidity reference + 5+ years stable
- Liquidity math: HIGH — canonical reference
- Accrued-fee math: HIGH — canonical reference; pinned-byte regression test will anchor correctness
- Pool address derivation: HIGH (CREATE2) — module-load self-check anchors correctness
- IL estimate (in-range case): HIGH — canonical derivation
- IL estimate (out-of-range fallback): MEDIUM — no canonical industry answer; researcher chose option 1 (geometric midpoint) per CONTEXT.md D-02
- Ledger clear-sign coverage: HIGH (verified registry contents at 2026-05-24)
- Composite-tx preview shape: MEDIUM — forward-design (Phase 36 Safe surface re-uses with possible adjustment)
- Sandwich-MEV applicability to LP: HIGH — not applicable to LP-only verbs; slippage params suffice for the different attack class
- KNOWN_SPENDERS_ETHEREUM promotion necessity: HIGH — verified NPM does `safeTransferFrom` for mint+increase
- Plan structure (3 plans sequential): HIGH — matches CONTEXT.md D-07 + Phase 32 precedent

**Research date:** 2026-05-24
**Valid until:** 2026-06-23 (30 days — Uniswap V3 NPM contract immutable; only Ledger ERC-7730 coverage could change; re-verify Topic 10 at execute time)

## RESEARCH COMPLETE

**Phase:** 33 - evm-uniswap-v3-lp-verb-set
**Confidence:** HIGH

### Key Findings

- **SDK probe verdict: HAND-ROLL all tick + liquidity + IL math.** `@uniswap/v3-sdk@3.30.1` pulls JSBI (deprecated) + ethers v5 + sdk-core deprecated graph; returns JSBI not bigint; `NonfungiblePositionManager.addCallParameters` requires ethers `Interface` incompatible with viem-only stack. Empirically verified via `npm view` + install probe (297MB total install for 1.4MB SDK package). Hand-roll cost: ~380 LOC across 5 new files in `src/signing/`. Matches Phase 32 precedent.

- **NPM uses `multicall(bytes[])` selector `0xac9650d8` — DIFFERENT from Phase 32's `multicall(uint256,bytes[])` deadline overload `0x5ae401dc`.** Phase 33 ships NEW `MULTICALL_BYTES_ABI` parseAbi fragment separate from Phase 32's `MULTICALL_DEADLINE_ABI`. NPM has per-call `deadline` inside each MintParams/IncreaseLiquidityParams struct, so outer multicall doesn't need a deadline.

- **NPM IS a spender — KNOWN_SPENDERS_ETHEREUM promotion REQUIRED.** Verified via v3-periphery `NonfungiblePositionManager.sol` — mint/increase do `safeTransferFrom` on token0+token1; collect/decrease/burn use ERC-721 ownership. One new KNOWN_SPENDERS row in Plan 33-01 + `T-UNISWAP-V3-NPM-SPENDER-DRIFT-1` cross-view test.

- **Composite-tx preview shape (NEW PATTERN) — Phase 33's `prepare_uniswap_v3_rebalance` is one tool, one handle, one calldata payload.** `payloadFingerprint` covers full `multicall(bytes[])` outer calldata (single hash, unchanged from Phase 4 cryptographic-binding chain). `preview_send` extends with new composite-multicall arm that decodes `bytes[]` and recursively decodes each inner call as `step N/N` sub-blocks. **This pattern is the canonical reference for v2.5 Safe (Gnosis) multisig three-step preview surface.** Phase 33 renders generic so Phase 36+ Safe re-uses.

- **NPM blind-signs on Ledger.** No ERC-7730 coverage for NPM in the Ledger registry (verified 2026-05-24). UNCONDITIONAL `LEDGER_NOTICE_UNISWAP_V3_LP_TEMPLATE` block on every Phase 33 prepare tool. Mirrors Phase 32 + Phase 6 WETH9.withdraw + Phase 31 precedent.

### File Created

`/home/szhygulin/dev/vaultpilot/vaultpilot-mcp-gsd-inspired/.planning/phases/33-evm-uniswap-v3-lp-verb-set/33-RESEARCH.md`

### Confidence Assessment

| Area | Level | Reason |
|------|-------|--------|
| Standard Stack | HIGH | viem-only stack; no new packages; SDK probe verdict empirically grounded |
| Architecture | HIGH | 3-plan sequential structure matches CONTEXT.md D-07 + Phase 32 precedent; mechanical-clone-of-`prepare_aave_supply` pattern for 5 single-step prepares; composite-multicall arm is forward-design with Phase 36 reuse |
| Pitfalls | HIGH | 7 documented pitfalls with mitigations; cryptographic-binding fixture discipline anchors regression catch |
| NPM ABI / addresses | HIGH | Verified via local install probe + Etherscan + cross-reference with Phase 32 already-pre-populated SOT slot |
| IL estimate out-of-range fallback | MEDIUM | No canonical industry answer; CONTEXT.md D-02 chose geometric-midpoint; flagged as A2 [ASSUMED] for discuss-phase confirmation |
| Composite-tx preview shape | MEDIUM | Forward-design (Phase 36 Safe surface may want adjustments); generic rendering helper minimizes risk |

### Open Questions

1. Should `prepare_uniswap_v3_rebalance` accept new amounts or use ALL collected from decrease+collect? — Researcher recommends `amounts ← all-of-collect-output`; future enhancement for top-up.
2. Should `get_lp_positions` show drained-but-not-burned positions? — Researcher recommends YES with `status: "drained, ready-to-burn"`; opt-in filter via `{ includeDrainedPositions: false }`.
3. (Resolved) SDK probe verdict re-evaluation for IL math — N/A; SDK has no IL helper; hand-rolled regardless.

### Ready for Planning

Research complete. Planner can now create 3 PLAN.md files per CONTEXT.md D-07 (sequential 33-01 → 33-02 → 33-03). All major placement decisions anchored; 7 [ASSUMED] flags (A1-A7) documented for discuss-phase or first-executor-PR confirmation; zero open questions blocking planning.
