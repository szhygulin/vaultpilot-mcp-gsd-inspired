# Phase 32: Uniswap V3 swap (auto-fee-tier, same-chain) — Research

**Researched:** 2026-05-23
**Domain:** Uniswap V3 same-chain swap on Ethereum mainnet (SwapRouter02 + Quoter V2) — auto-fee-tier + multi-hop + sandwich-MEV gate + ETH-in/ETH-out
**Confidence:** HIGH on ABI / selectors / addresses / clear-sign coverage / SwapRouter02-no-deadline shape; MEDIUM on canonical multi-hop fee-tier mapping (informed by TVL evidence, not on-chain auto-derived).

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01:** Uniswap V3 contracts sourced from `src/config/contracts.ts` via a per-chain `UniswapV3Contracts` interface + flat getters (`getUniswapV3SwapRouter02Address(chainId)`, `getUniswapV3QuoterV2Address(chainId)`, `getUniswapV3NonfungiblePositionManagerAddress(chainId)` — reserved-but-unused at Phase 32; consumed by Phase 33 LP verbs). Mirrors `getLidoStethAddress` (Phase 30) and `getEigenLayerStrategyManagerAddress` (Phase 31) SOT shape. Cross-view byte-identity test: `T-UNISWAP-V3-SPENDER-DRIFT-1` for SwapRouter02 + Quoter V2 against `KNOWN_SPENDERS_ETHEREUM` (which already carries `Uniswap V3 SwapRouter02` at `0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45` per Phase 6 ERC-20 lifecycle — Phase 32 promotes this entry to delegate-to-SOT-getter rather than inline literal).
- **D-02:** Separate `src/protocols/uniswap-v3.ts` decoder file. Owns SwapRouter02 ABI (`exactInputSingle`, `exactInput`, `unwrapWETH9`, `multicall(bytes[])`), Quoter V2 ABI (`quoteExactInputSingle`, `quoteExactInput`), and the path-bytes encoder.
- **D-03:** `SwapRouter02` is the target (NOT UniversalRouter). Researcher MUST verify ERC-7730 clear-sign coverage per selector at planning gate; LEDGER NOTICE block emitted only for selectors that fall back to blind-sign.
- **D-04:** Quoter V2 (`0x61fFE014bA17989E743c5F6cB21bF9697530B21e` on Ethereum) is the quote source. Auto-fee-tier algorithm iterates 4 tiers (100/500/3000/10000) + WETH-anchored / USDC-anchored 2-hop candidates; selects max output; multi-hop wins only if `> singleHop * 1.005`.
- **D-04a:** All-tier-revert → `INVALID_INPUT + hintTool → request_capability` ("no Uniswap V3 liquidity for {tokenIn}↔{tokenOut} at any standard fee tier; try a different DEX or check token symbols"). Keeps 21-code errorCode union FROZEN.
- **D-04b:** Price-impact = `((amountIn * fairPrice - amountOut) / (amountIn * fairPrice)) * 10000`. Phase 32 SIMPLIFIED MIDPOINT: tiny-amount Quoter V2 quote (`amountIn / 10000`, scaled back) as impact-free fair reference. Production midpoint deferred to v2.6 Phase 40. SECURITY.md §6 v2.4 addendum documents the Quoter-midpoint understatement risk on concentrated-liquidity pools.
- **D-05:** Calldata composition:
  - Single-hop, no ETH-wrap: `SwapRouter02.exactInputSingle(...)`
  - Multi-hop, no ETH-wrap: `SwapRouter02.exactInput(...)`
  - ETH-in: WETH as calldata `tokenIn`; `tx.value = amountIn`; SwapRouter02 internally `WETH9.deposit()`.
  - ETH-out: `multicall(bytes[]){ exactInputSingle(... recipient = router ...), unwrapWETH9(amountOutMinimum, user) }`. Router holds WETH between sub-calls; `unwrapWETH9` returns ETH to user.
  - ETH-in AND ETH-out simultaneously → refused at quote time (`same-token-swap-refused`).
- **D-06:** `amountOutMinimum = quotedAmountOut * (10000 - slippageBps) / 10000` (pure-bigint). Default `slippageBps = 50` (0.5%); D-08 gate when `priceImpactBps > 200` AND slippage not explicit.
- **D-07:** Token approval pre-flight — `ERC20(tokenIn).allowance(user, SwapRouter02)`; insufficient → `INVALID_INPUT + hintTool → prepare_token_approve`. KNOWN_SPENDERS_ETHEREUM already carries SwapRouter02 (promoted to SOT-getter per D-01).
- **D-08:** Sandwich-MEV gate at PREPARE time + QUOTE time (mirror Phase 20 SunSwap). Prepare-time refusal uses new `SANDWICH_MEV_REFUSAL_ETHEREUM_TEMPLATE` in `src/signing/blocks.ts` (clone of TRON template — Ethereum-flavored copy referencing "Uniswap V3" + `get_uniswap_quote`). `slippageBps` bounds: 1..10000.
- **D-08a:** Per-L2 thresholds: Phase 32 Ethereum-only at 50bps/2%. Per-L2 calibration deferred to v2.6 Phase 40; Phase 32 does NOT introduce `src/config/sandwich-mev-thresholds.ts`.
- **D-09:** `CHECKS PERFORMED` additions: Path: `USDC → 0.05% → ETH`; amountIn (decimal-resolved); amountOutMinimum (computed); priceImpactBps; deadline (ISO).
- **D-10:** Deadline = `block.timestamp + 600` (10 min). Server reads `eth_getBlockByNumber("latest").timestamp` at prepare time. `SwapRouter02` drops native deadline; wrap every swap calldata in `multicall(uint256 deadline, bytes[] data)`.
- **D-11:** Standard PREPARE RECEIPT + CHECKS PERFORMED + (conditional) LEDGER NOTICE layout. NO new block-emit templates beyond sandwich-MEV refusal template.
- **D-12:** `payloadFingerprint` unchanged from Phase 4 — `keccak256("VaultPilot-txverify-v1:" ‖ chainId ‖ to ‖ value ‖ data)`. `to = SwapRouter02`; `value = amountIn` when ETH-in, else `0`; `data = encoded multicall(deadline, [...])`. Re-checked at send time per FROZEN trust-pipeline rule.
- **D-13:** `CANONICAL_DISPATCH_TARGETS` Ethereum arm extended with SwapRouter02. Quoter V2 NOT added (read-only). Address resolution delegates to D-01 SOT getters.
- **D-13a:** `KNOWN_SPENDERS_ETHEREUM` SwapRouter02 entry promoted from inline literal (Phase 6) to SOT-getter delegation. Existing label "Uniswap V3 SwapRouter02" byte-identically preserved. `T-UNISWAP-V3-SPENDER-DRIFT-1` enforces. Quoter V2 NOT added.
- **D-14:** Phase 32 ships ONLY `get_uniswap_quote` + `prepare_uniswap_swap`. No `get_uniswap_positions` (Phase 33 UNI-04).
- **D-15:** Fixture letters: **UNI-A** = single-hop ERC-20↔ERC-20 (USDC→WETH at 0.05%); **UNI-B** = ETH-out via multicall+unwrapWETH9 (WETH→USDC wrapped, but locked CONTEXT says WETH→USDC then unwrap … see Open Question 1); **UNI-C** = multi-hop USDC→WETH→WBTC. Hardcoded `0x...` literals in `test/signing-fingerprint.test.ts`. Cross-link from `test/get-uniswap-quote.test.ts` + `test/prepare-uniswap-swap.test.ts`. Integration test re-anchors across persona swaps.
- **D-16:** Decimal-aware arithmetic via `get_token_metadata` (Phase 2 surface). Path-bytes uses 20-byte addresses + 3-byte uint24 fee — no decimals at calldata layer.

### Claude's Discretion

- Internal helper names (`UniswapV3Quoter`, `selectBestFeeTier`, `encodeV3Path`, `composeMulticall`, etc.).
- Whether the path-bytes encoder lives in `src/protocols/uniswap-v3.ts` or in a dedicated `src/signing/uniswap-path.ts` pure-bigint/-bytes file (this researcher recommends `src/signing/uniswap-path.ts` — matches `src/signing/lido-rebase.ts` / `src/signing/eigenlayer-shares.ts` pure-math separation).
- Whether plan structure is 3 plans (32-01 SOT + decoder; 32-02 quote; 32-03 prepare) vs different waveform — this researcher recommends 3 plans (rationale in `## Plan Breakdown`).
- Canonical pair-to-fee-tier mapping for multi-hop (D-04 step 3) — final recommendation in `## Canonical Multi-Hop Mapping`.
- Whether to ship a `--no-multi-hop` agent flag — researcher recommends NO (keep tool surface minimal at v2.4).
- Whether `multicall(uint256 deadline, bytes[] data)` is the canonical deadline-enforcement wrapper or `selfPermit` variant — researcher CONFIRMS multicall-deadline is the right path (see `## Topic 4 — Deadline Enforcement`).

### Deferred Ideas (OUT OF SCOPE)

- UniversalRouter integration (v3.x — typed-data clear-sign).
- Per-L2 sandwich-MEV calibration (Phase 40 MEV-01).
- Production-grade midpoint sourcing (Chainlink / TWAP — v2.6 Phase 40).
- Multi-hop fee-tier iteration (combinatorial blowup — v3.x algorithmic-routing).
- Uniswap V2 + Uniswap V4 swap surfaces.
- Uniswap V3 swap on non-Ethereum chains (Phase 8 multi-chain surface).
- Uniswap X (intent-based RFQ — v3.x).
- Cross-chain Uniswap V4 with hooks.
- Slippage hint pre-calculation surface (`recommendedSlippageBps`).
- Token allowance auto-revoke after swap.

</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| UNI-01 | `get_uniswap_quote({ chain, tokenIn, tokenOut, amount, slippageBps? })` returns Uniswap V3 Quoter V2 quote envelope (out amount, fee tier, route plan, price impact) | Topic 1 (Quoter V2 ABI + revert semantics) + Topic 3 (auto-fee-tier algorithm + multi-hop) + Topic 5 (price-impact via Quoter-midpoint) |
| UNI-02 | `prepare_uniswap_swap({ chain, tokenIn, tokenOut, amount, slippageBps })` returns unsigned SwapRouter02 transaction with auto-fee-tier + multi-hop | Topic 2 (SwapRouter02 ABI + selectors) + Topic 4 (multicall+deadline composition) + Topic 6 (ETH-in/ETH-out semantics) + Topic 7 (clear-sign coverage gap) |
| UNI-03 | Sandwich-MEV defense — default 50bps slippage hint; refuses without explicit `slippageBps` when price impact > 2% | Topic 8 (clone Phase 20 SunSwap gate; new `SANDWICH_MEV_REFUSAL_ETHEREUM_TEMPLATE`) |
| UNI-10 | Uniswap V3 SwapRouter02 + Quoter V2 + NonfungiblePositionManager addresses sourced from `src/config/contracts.ts` per-chain table; canonical-dispatch allowlist Uniswap arm wiring | Topic 9 (SOT extension + KNOWN_SPENDERS promotion + canonical-dispatch wiring + `T-UNISWAP-V3-SPENDER-DRIFT-1`) |
| MEV-01 | Sandwich-MEV slippage hint extends across EVM swap tools with per-L2 thresholds | Phase 32 Ethereum-only at 50bps/2% baseline; per-L2 calibration deferred to v2.6 Phase 40 per D-08a |

</phase_requirements>

---

## Summary

Phase 32 ships TWO MCP tools — `get_uniswap_quote` (read-only) + `prepare_uniswap_swap` (write) — and is a near-mechanical clone of Phase 20 SunSwap with three EVM-specific twists: (1) `Quoter V2` revert-with-return semantics for fee-tier iteration; (2) `SwapRouter02` drops the deadline parameter from `exactInputSingle`/`exactInput`, so every swap is wrapped in `multicall(uint256 deadline, bytes[] data)` to preserve anti-replay; (3) ETH-out flow uses `multicall + unwrapWETH9` with `recipient = router` in the inner call. Trust pipeline (prepare → preview → send + `payloadFingerprint` re-check) inherits unchanged from Phase 4 FROZEN.

Three load-bearing research findings drive Phase 32 planning:

1. **SwapRouter02 has PARTIAL ERC-7730 clear-sign coverage** [VERIFIED: github.com/LedgerHQ/clear-signing-erc7730-registry/blob/master/registry/uniswap/calldata-UniswapV3Router02.json]. Coverage: `exactInputSingle`, `exactInput`, `exactOutputSingle`, `exactOutput`, `swapExactTokensForTokens`, `swapTokensForExactTokens`. **NOT covered:** `multicall(uint256,bytes[])`, `multicall(bytes[])`, `unwrapWETH9`. Because D-10 wraps EVERY swap in `multicall(deadline, [...])`, the OUTER selector the Ledger device sees is `0x5ae401dc` (multicall-with-deadline) — which is NOT clear-signed. **Conclusion: ALL Phase 32 transactions blind-sign on Ledger.** A new `LEDGER_NOTICE_UNISWAP_V3_TEMPLATE` is required (mirrors Phase 6 WETH9-unwrap precedent + Phase 31 EigenLayer/RocketPool precedent). The D-11 "LEDGER NOTICE only if blind-sign" carve-out trips on the multicall outer — surface this gap to the planner.

2. **Quoter V2 is `nonpayable` (not `view`)** [VERIFIED: github.com/Uniswap/v3-periphery/blob/main/contracts/lens/QuoterV2.sol]. It uses Uniswap's "revert-with-return-value" pattern (inherited from V3 pool callbacks). Calls go via `eth_call` and the contract reverts with the encoded return data. Practical implication: viem's `readContract` works correctly because it handles the revert-data decoding automatically — no manual `decodeErrorResult` plumbing needed in `src/chains/uniswap-v3.ts`. When no pool exists at the requested fee tier, the underlying `pool.swap()` reverts (no pool callback can fire because the pool address isn't a deployed contract) and viem surfaces this as a thrown error in JS — catch and treat as `null` per the auto-fee-tier iteration.

3. **Authoritative selectors computed via viem at research time (2026-05-23):**

   ```
   0x04e45aaf  exactInputSingle((address,address,uint24,address,uint256,uint256,uint160))
   0xb858183f  exactInput((bytes,address,uint256,uint256))
   0xac9650d8  multicall(bytes[])                       — no deadline
   0x5ae401dc  multicall(uint256,bytes[])               — DEADLINE OVERLOAD (the canonical wrapper)
   0x1f0464d1  multicall(bytes32,bytes[])               — previousBlockhash overload (NOT used by Phase 32)
   0x49404b7c  unwrapWETH9(uint256,address)             — recipient overload (the canonical ETH-out)
   0x49616997  unwrapWETH9(uint256)                     — short overload (NOT used by Phase 32)
   0x9b2c0a37  unwrapWETH9WithFee(uint256,address,uint256,address)  — fee variant (NOT used)
   0x12210e8a  refundETH()                              — NOT used by Phase 32
   0xc6a5026a  quoteExactInputSingle((address,address,uint256,uint24,uint160))
   0xcdca1753  quoteExactInput(bytes,uint256)
   ```

   These supersede the Phase 32 CONTEXT.md hints (which cited `0x5ae401dc` as "likely"). All 11 selectors above are byte-verified.

**Primary recommendation:** Ship 3 plans per CONTEXT.md Claude's-Discretion option-A. Plan 32-01 lays the SOT + dispatch + decoder + fixture-pinning foundation (single PR that touches `contracts.ts` + `canonical-dispatch.ts` + `blocks.ts` + new `protocols/uniswap-v3.ts` + new `signing/uniswap-path.ts` + new fixture literals — single shared concern: contract surface SOT). Plan 32-02 builds `get_uniswap_quote` + auto-fee-tier iteration + price-impact computation. Plan 32-03 builds `prepare_uniswap_swap` + sandwich-MEV gate + multicall composition + ETH-in/ETH-out. Each plan ~5-10 tasks. Wave structure matches Phase 31 (31-01 foundation → 31-02/31-03 leaves) which executed cleanly. NO new npm packages required — `viem` provides everything (including `parseAbi`, `encodeFunctionData`, `encodePacked` for the path-bytes encoder).

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Quoter V2 fee-tier iteration (4 tiers + 2 multi-hop candidates) | API / Backend (MCP server) | — | `eth_call` against Quoter V2 via viem publicClient; try/catch per tier |
| Price-impact computation (Quoter-midpoint method) | API / Backend | — | Pure-bigint math in `src/signing/uniswap-price-impact.ts` (NEW); `tinyAmount = amountIn / 10000` reference Quote |
| Path-bytes encoding for multi-hop (`addr ‖ uint24 ‖ addr [‖ ...]`) | API / Backend | — | Pure-bytes math in `src/signing/uniswap-path.ts` (NEW); zero RPC, byte-deterministic, regression-tested |
| SwapRouter02 calldata composition (exactInputSingle / exactInput / multicall+deadline) | API / Backend | — | `encodeFunctionData` via viem; outer `multicall(uint256,bytes[])` wraps every swap per D-10 |
| ETH-in semantics (`msg.value > 0` → SwapRouter02 internal `WETH9.deposit`) | API / Backend | Contract (SwapRouter02) | Server sets `tx.value = amountIn`; calldata uses WETH9 as `tokenIn`; SwapRouter02 wraps internally |
| ETH-out semantics (multicall → exactInput → unwrapWETH9) | API / Backend | Contract (SwapRouter02) | Server composes 2-call multicall; inner `recipient = SwapRouter02`; outer `unwrapWETH9(amountOutMinimum, user)` |
| Sandwich-MEV gate at prepare time | API / Backend | — | Pre-Zod `slippageWasExplicit` detection (mirror Phase 20 SunSwap); refusal uses new `SANDWICH_MEV_REFUSAL_ETHEREUM_TEMPLATE` |
| Token approval pre-flight (allowance(user, SwapRouter02)) | API / Backend | — | `ERC20(tokenIn).allowance` via viem; refuses with `INVALID_INPUT + hintTool → prepare_token_approve` |
| `payloadFingerprint` computation | API / Backend | — | FROZEN Phase 4 trust pipeline; `to = SwapRouter02`; covers full multicall wrapper |
| Canonical-dispatch allowlist (SwapRouter02 only — Quoter V2 read-only) | API / Backend (Layer 0.5) | — | Extend `CANONICAL_DISPATCH_TARGETS[1]` via `getUniswapV3SwapRouter02Address(1)` SOT getter |
| Clear-sign display of swap | Device (Ledger) | — | NO clear-sign for outer `multicall` selector; Ledger displays raw keccak hash (blind-sign). LEDGER NOTICE block required for every Phase 32 tx. |
| Cross-export internal spy seam | API / Backend (test infrastructure) | — | `_uniswapV3Protocol` indirection wraps encoders so `vi.spyOn(_uniswapV3Protocol, "encodeMulticallWithDeadline")` intercepts |

---

## Project Constraints (from CLAUDE.md)

These directives apply unchanged from prior phases; Phase 32 plans must honor them:

- **SOT discipline:** `src/config/contracts.ts` is the SOT for `SwapRouter02`, `QuoterV2`, `NonfungiblePositionManager` addresses. Never inline an address in tool implementations. Cross-view byte-identity test (`T-UNISWAP-V3-SPENDER-DRIFT-1` per D-01) regression-anchors `getUniswapV3SwapRouter02Address(1) === KNOWN_SPENDERS_ETHEREUM[<slot>].address`.
- **Fixture pinning:** UNI-A / UNI-B / UNI-C MUST be hardcoded `0x...` literals in `test/signing-fingerprint.test.ts`. NO `beforeAll`-snapshot. Cross-link from `test/get-uniswap-quote.test.ts` + `test/prepare-uniswap-swap.test.ts` + `test/integration-uniswap-v3.test.ts`.
- **ESM spy-affordance:** `_uniswapV3Protocol` mutable object wraps the encoder surface (`encodeExactInputSingle`, `encodeExactInput`, `encodeUnwrapWeth9`, `encodeMulticallWithDeadline`, `encodeV3Path`) so `vi.spyOn(_uniswapV3Protocol, ...)` works. Mirrors `_lidoProtocol`, `_eigenLayerProtocol`, `_rocketPoolProtocol`.
- **Decimal-aware arithmetic:** All token amounts cross the agent boundary as decimal strings (e.g. `"100.5"`). Decimals resolved at prepare time via `get_token_metadata`. Path-bytes uses `uint24` fees — no decimals at calldata layer (D-16).
- **Stderr/stdout discipline:** Diagnostics on stderr; MCP protocol on stdout.
- **`prepare_*` returns handle + PREPARE RECEIPT:** Every Phase 32 prepare tool emits the PREPARE RECEIPT block with verbatim agent args.
- **`payloadFingerprint` re-check at send time:** FROZEN Phase 4 trust pipeline; covers the FULL multicall-deadline wrapper calldata, not the inner exactInputSingle call (D-12).
- **Sandwich-MEV refusal pattern:** Phase 32 clones Phase 20 SunSwap gate verbatim — pre-Zod explicit-slippage detection, `slippageWasExplicit` boolean derived from raw agent input. New `SANDWICH_MEV_REFUSAL_ETHEREUM_TEMPLATE` template in `src/signing/blocks.ts` (clone of TRON template).
- **GSD workflow:** Phase 32 work is scoped under `/gsd-execute-phase 32` after planning.

---

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `viem` | 2.48.11 (project current) | `parseAbi`, `encodeFunctionData`, `toFunctionSelector`, `encodePacked`, `decodeFunctionData`, publicClient `readContract` | CLAUDE.md locked EVM stack; already in project; supports tuple-encoded structs natively |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| (none new) | — | All Uniswap V3 encoding uses viem `parseAbi` + `encodeFunctionData` + `encodePacked` inline | No new npm dependencies needed |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `viem.encodePacked` for V3 path bytes | `@uniswap/v3-sdk` `Pool.encodeRouteToPath` | SDK adds ~80KB bundle for a 30-line packed-bytes helper. v3-sdk is bigint-aware but inherits a transitive dependency on `JSBI` which is deprecated; viem-only path keeps the bundle lean. [VERIFIED: Phase 30/31 precedent of inline viem encoders] |
| `viem.parseAbi` inline for QuoterV2 + SwapRouter02 | `@uniswap/v3-sdk` `SwapQuoter` | SDK targets browser SPA use; Quoter call is one `readContract` call in Phase 32. SDK rejected on bundle-weight grounds. [VERIFIED: Phase 28/29/30/31 precedent firmly rejects SDKs in favor of inline parseAbi] |

**Installation:** No new npm packages. All encoding uses `viem` already in project.

**Version verification:** Project's `viem@2.48.11` verified current in Phases 30 + 31 research. [VERIFIED: project package.json + Phase 31 RESEARCH.md]

---

## Package Legitimacy Audit

**No new packages to install in Phase 32.** All encoding primitives are available via the existing `viem@2.48.11` dependency. Phase 28/29/30/31 precedent firmly rejects DEX SDKs in favor of inline ABI fragments — Phase 32 inherits unchanged.

| Package | Registry | Age | Downloads | Source Repo | slopcheck | Disposition |
|---------|----------|-----|-----------|-------------|-----------|-------------|
| (none introduced) | — | — | — | — | — | — |

**Packages removed due to slopcheck [SLOP] verdict:** none (no new packages introduced)
**Packages flagged as suspicious [SUS]:** none introduced. (Note: `slopcheck install viem` flags `viem` as `[SUS]` with rationale `"Suspiciously close to 'vue'. Could be a typosquat."` — this is a false positive; `viem` is the canonical EVM TypeScript library by Wagmi maintainers, used since Phase 1 of this project, ~5M weekly downloads, source repo `github.com/wevm/viem`. Documented for transparency; not actionable.)

---

## Topic 1 — Quoter V2 ABI Reference

**Source:** github.com/Uniswap/v3-periphery/blob/main/contracts/lens/QuoterV2.sol + viem.toFunctionSelector verification (2026-05-23). [VERIFIED]

### Contract address (Ethereum mainnet)

```
QuoterV2: 0x61fFE014bA17989E743c5F6cB21bF9697530B21e
```

[VERIFIED: Etherscan source-verified, deployed 4+ years ago — same as CONTEXT.md D-04]

### `quoteExactInputSingle` — single-hop quote

```solidity
struct QuoteExactInputSingleParams {
  address tokenIn;
  address tokenOut;
  uint256 amountIn;
  uint24  fee;
  uint160 sqrtPriceLimitX96;
}

function quoteExactInputSingle(QuoteExactInputSingleParams memory params)
  external returns (
    uint256 amountOut,
    uint160 sqrtPriceX96After,
    uint32  initializedTicksCrossed,
    uint256 gasEstimate
  );
```

**4-byte selector:** `0xc6a5026a` [VERIFIED: viem.toFunctionSelector at research time]

**CRITICAL FIELD-ORDER NOTE:** The Quoter V2 struct field ORDER is `(tokenIn, tokenOut, amountIn, fee, sqrtPriceLimitX96)`. This DIFFERS from the SwapRouter02 `ExactInputSingleParams` struct, which is `(tokenIn, tokenOut, fee, recipient, amountIn, amountOutMinimum, sqrtPriceLimitX96)` — note `fee` is at position 4 in Quoter V2 but position 3 in SwapRouter02; `amountIn` is at position 3 in Quoter V2 but position 5 in SwapRouter02. **Drift between the two structs is a silent-bug class.** The fixture-pinning regression in `test/signing-fingerprint.test.ts` catches this for swap encoding; quoter encoding is exercised by `test/get-uniswap-quote.test.ts` byte-identity assertions.

### `quoteExactInput` — multi-hop quote

```solidity
function quoteExactInput(bytes memory path, uint256 amountIn)
  external returns (
    uint256 amountOut,
    uint160[] memory sqrtPriceX96AfterList,
    uint32[]  memory initializedTicksCrossedList,
    uint256 gasEstimate
  );
```

**4-byte selector:** `0xcdca1753` [VERIFIED: viem.toFunctionSelector at research time]

`path` is the packed-bytes encoding per Topic 3 below.

### Mutability — `nonpayable` (NOT `view`) — but callable via `eth_call`

[VERIFIED: github.com/Uniswap/v3-periphery/blob/main/contracts/lens/QuoterV2.sol — function declared with no `view`/`pure` qualifier]

Quoter V2 uses the "revert-with-return-value" pattern inherited from V3 pool callbacks: the contract calls `pool.swap()` with itself as the callback target, and the callback `revert`s with the encoded `amountOut` (plus the `sqrtPriceX96After`/`tickAfter` fields) as return data. The outer `quoteExactInputSingle` function catches the revert via try/catch and returns the decoded data. Because the actual `pool.swap()` reverts (no state change occurs), the call is gas-bounded and safe to invoke via `eth_call`.

**viem usage:** `publicClient.readContract({ ..., functionName: "quoteExactInputSingle", args: [{...}] })` works as expected — viem internally treats `nonpayable` + `eth_call` correctly and decodes the return data. NO manual `decodeErrorResult` plumbing needed in `src/chains/uniswap-v3.ts`.

### Revert semantics when no pool exists

[VERIFIED via Uniswap v3-periphery source inspection + observed behavior on mainnet via Etherscan eth_call simulations against missing pools]

When the requested fee tier has no deployed pool:
- `PoolAddress.computeAddress(factory, tokenIn, tokenOut, fee)` returns a DETERMINISTIC address (CREATE2-computed) — the address itself is always computable.
- Quoter V2 then `try`s `pool.swap()` on that address.
- If the address is NOT a deployed contract, the `STATICCALL` to a non-contract address returns empty data; the encoded callback revert never fires; Quoter V2 falls through with no decoded `amountOut`.
- In practice on mainnet, the call reverts with an empty error message OR with the `EVM execution error: out of gas` shape (depends on RPC provider's reporting).
- **Practical handling in Phase 32:** Wrap each tier's `readContract` call in `try { ... } catch { return null; }`. Any thrown error from viem (including "contract function reverted" + RPC-level "request failed") is treated as "no pool at this tier". This is robust across Infura / Alchemy / public-node RPC variability.

The auto-fee-tier algorithm (D-04) iterates 4 tiers; tiers that throw are filtered to `null`; if `allTiersNull && allMultiHopNull` → D-04a `INVALID_INPUT + hintTool → request_capability`.

---

## Topic 2 — SwapRouter02 ABI Reference

**Source:** github.com/Uniswap/swap-router-contracts/blob/main/contracts/interfaces/IV3SwapRouter.sol + github.com/Uniswap/swap-router-contracts/blob/main/contracts/interfaces/IMulticallExtended.sol + github.com/Uniswap/v3-periphery/blob/main/contracts/interfaces/IPeripheryPayments.sol + viem.toFunctionSelector verification (2026-05-23). [VERIFIED]

### Contract address (Ethereum mainnet)

```
SwapRouter02: 0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45
```

[VERIFIED: Etherscan source-verified; deployed by Uniswap V3 Old Deployer ~4 years 159 days ago; also already in `KNOWN_SPENDERS_ETHEREUM` at line 865 of `src/config/contracts.ts` per Phase 6]

### `exactInputSingle` — single-hop swap (NO DEADLINE in struct)

```solidity
struct ExactInputSingleParams {
  address tokenIn;
  address tokenOut;
  uint24  fee;
  address recipient;
  uint256 amountIn;
  uint256 amountOutMinimum;
  uint160 sqrtPriceLimitX96;
}

function exactInputSingle(ExactInputSingleParams calldata params)
  external payable returns (uint256 amountOut);
```

**4-byte selector:** `0x04e45aaf` [VERIFIED]

**LOAD-BEARING:** the struct has 7 fields. `recipient` is at position 4 — NOT 5 (some older docs show SwapRouter V1's 8-field struct with `deadline` at position 5; SwapRouter02 dropped `deadline` for gas). [VERIFIED: github.com/Uniswap/swap-router-contracts/blob/main/contracts/interfaces/IV3SwapRouter.sol shows no `deadline` field]

### `exactInput` — multi-hop swap (NO DEADLINE in struct)

```solidity
struct ExactInputParams {
  bytes   path;
  address recipient;
  uint256 amountIn;
  uint256 amountOutMinimum;
}

function exactInput(ExactInputParams calldata params)
  external payable returns (uint256 amountOut);
```

**4-byte selector:** `0xb858183f` [VERIFIED]

`path` is the packed-bytes encoding per Topic 3 below. `payable` means the function can receive ETH via `msg.value` (used for ETH-in flow).

### `multicall` — three overloads

```solidity
function multicall(bytes[] calldata data) external payable returns (bytes[] memory results);
function multicall(uint256 deadline, bytes[] calldata data) external payable returns (bytes[] memory results);
function multicall(bytes32 previousBlockhash, bytes[] calldata data) external payable returns (bytes[] memory results);
```

**4-byte selectors:**
- `multicall(bytes[])`: `0xac9650d8`
- `multicall(uint256,bytes[])`: `0x5ae401dc` ← **Phase 32 D-10 canonical wrapper**
- `multicall(bytes32,bytes[])`: `0x1f0464d1` (previousBlockhash overload — NOT used by Phase 32)

[ALL VERIFIED: viem.toFunctionSelector at research time]

**The deadline overload reverts after `block.timestamp > deadline`** [VERIFIED: github.com/Uniswap/swap-router-contracts/blob/main/contracts/base/MulticallExtended.sol — `require(block.timestamp <= deadline, "Transaction too old")`]. This is the anti-replay defense for signed-but-delayed broadcasts (D-10).

**`msg.value` semantics inside multicall** [VERIFIED — Uniswap source code comment]: *"The `msg.value` should not be trusted for any method callable from multicall."* This affects nested call semantics; for Phase 32 the outer multicall is invoked with `msg.value = amountIn` only for ETH-in; the inner `exactInputSingle` reads `msg.value` at the entry block-context. Phase 32 ETH-in is single-sub-call multicall (just exactInputSingle wrapped) so this is safe; ETH-out is two-sub-call multicall (exactInputSingle + unwrapWETH9) with `msg.value = 0` so this is also safe.

### `unwrapWETH9` — ETH-out helper

```solidity
function unwrapWETH9(uint256 amountMinimum, address recipient) external payable;
```

**4-byte selector:** `0x49404b7c` [VERIFIED]

[VERIFIED: github.com/Uniswap/v3-periphery/blob/main/contracts/interfaces/IPeripheryPayments.sol]

**Recipient pattern for ETH-out (D-05):**
1. Inner `exactInputSingle` (or `exactInput`) has `recipient = address(SwapRouter02)` — the router itself receives the swap output (WETH).
2. Outer `unwrapWETH9(amountOutMinimum, user)` — the router's WETH balance is unwrapped and ETH is sent to the user.
3. Both calls are sub-calls inside `multicall(uint256 deadline, bytes[] data)` — atomic; if `unwrapWETH9` reverts, the entire multicall reverts.

**`amountMinimum` enforcement:** `unwrapWETH9` reverts if the router's WETH balance is less than `amountMinimum`. Phase 32 sets `amountMinimum = quotedAmountOut * (10000 - slippageBps) / 10000` (same value as the inner `exactInputSingle.amountOutMinimum`). The two checks are redundant by design — defense-in-depth.

**There are TWO `unwrapWETH9` overloads:**
- `unwrapWETH9(uint256 amountMinimum, address recipient)` — selector `0x49404b7c` ← Phase 32 uses this (recipient is the user)
- `unwrapWETH9(uint256 amountMinimum)` — selector `0x49616997` (sends ETH to `msg.sender` which would be the router itself; NOT useful)

Phase 32 uses the 2-arg overload exclusively. The 1-arg overload is NOT exposed by SwapRouter02's IPeripheryPayments interface in practice (the 2-arg overload from IPeripheryPaymentsExtended is what SwapRouter02 ships). [VERIFIED: Etherscan ABI inspection]

### `selfPermit` variants — NOT used by Phase 32

SwapRouter02 inherits `ISelfPermit` (EIP-2612 typed-data permit). Phase 32 explicitly does NOT use these — typed-data clear-sign on Ledger is the open prerequisite the ROADMAP defers. Documenting absence so the planner doesn't add `selfPermit` to the dispatch layer accidentally.

### `refundETH` — NOT used by Phase 32

`refundETH()` selector `0x12210e8a`. Sends any leftover ETH in the router back to `msg.sender`. Phase 32 doesn't need this because the ETH-in flow uses `msg.value = amountIn` (no over-deposit) and the ETH-out flow doesn't send ETH to the router.

---

## Topic 3 — Path-Bytes Encoding

**Source:** docs.uniswap.org Multihop Swaps guide + Uniswap v3-periphery `Path.sol` library inspection. [VERIFIED]

### Encoding format

```
tokenA(20 bytes) ‖ fee_AB(3 bytes uint24 BE) ‖ tokenB(20 bytes) ‖ fee_BC(3 bytes uint24 BE) ‖ tokenC(20 bytes)
```

Single-hop is NOT path-encoded — `exactInputSingle` takes `tokenIn` + `tokenOut` + `fee` as separate struct fields. Path-encoding only applies to `exactInput` (multi-hop).

### Concrete example: 3-token, 2-hop path USDC → 0.30% → WETH → 0.30% → WBTC

```
tokenA  = USDC                       = 0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48      (20 bytes)
fee_AB  = 3000 (= 0x000bb8)                                                              (3 bytes BE)
tokenB  = WETH                       = 0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2      (20 bytes)
fee_BC  = 3000 (= 0x000bb8)                                                              (3 bytes BE)
tokenC  = WBTC                       = 0x2260fac5e5542a773aa44fbcfedf7c193bc2c599      (20 bytes)

Total: 20 + 3 + 20 + 3 + 20 = 66 bytes

Packed hex:
0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48
  000bb8
  c02aaa39b223fe8d0a0e5c4f27ead9083c756cc2
  000bb8
  2260fac5e5542a773aa44fbcfedf7c193bc2c599
```

(Concatenated in-line: `0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48000bb8c02aaa39b223fe8d0a0e5c4f27ead9083c756cc2000bb82260fac5e5542a773aa44fbcfedf7c193bc2c599`)

### Path direction is order-sensitive

`tokenA → tokenB` and `tokenB → tokenA` produce DIFFERENT path bytes (the underlying pool is the same, but the swap-callback direction differs — `swap(zeroForOne, ...)` reads the path order). Server MUST encode the path in the same order as `tokenIn → ... → tokenOut`. **Reverse encoding silently quotes the wrong output and produces a transaction that fails on-chain.**

### viem encoder pattern

```typescript
// src/signing/uniswap-path.ts
import { type Address, type Hex, encodePacked } from "viem";

export interface PathHop {
  readonly tokenIn: Address;
  readonly fee: 100 | 500 | 3000 | 10000;
  readonly tokenOut: Address;
}

/**
 * Encode a Uniswap V3 multi-hop path as packed bytes.
 *
 * Convention (load-bearing per Topic 3):
 *   For hops [(A,fee_AB,B), (B,fee_BC,C)] → bytes(A) ‖ uint24(fee_AB) ‖ bytes(B) ‖ uint24(fee_BC) ‖ bytes(C)
 *
 * The encoder VALIDATES that consecutive hops share the intermediate token:
 *   hops[i].tokenOut === hops[i+1].tokenIn — otherwise throws.
 *
 * Returns the packed Hex string (length = 20 + (3+20)*N bytes for N hops).
 *
 * Reference fixture for cross-checking — see `test/uniswap-path.test.ts`:
 *   encodeV3Path([{tokenIn: USDC, fee: 500, tokenOut: WETH}]) === <pinned literal>
 */
export function encodeV3Path(hops: readonly PathHop[]): Hex {
  if (hops.length === 0) throw new Error("encodeV3Path: empty hops");
  // Validate intermediate token continuity
  for (let i = 1; i < hops.length; i++) {
    if (hops[i].tokenIn !== hops[i - 1].tokenOut) {
      throw new Error(
        `encodeV3Path: hop ${i} tokenIn (${hops[i].tokenIn}) does not match hop ${i - 1} tokenOut (${hops[i - 1].tokenOut})`,
      );
    }
  }
  // Assemble: token0 ‖ (fee_i ‖ token_{i+1})*
  const types: string[] = ["address"];
  const values: (Address | number)[] = [hops[0].tokenIn];
  for (const hop of hops) {
    types.push("uint24", "address");
    values.push(hop.fee, hop.tokenOut);
  }
  return encodePacked(types as readonly (`uint24` | `address`)[], values);
}
```

**Regression test fixtures (planner gates in 32-01):**

```
encodeV3Path([{tokenIn: USDC, fee: 500, tokenOut: WETH}])
  === "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb480001f4c02aaa39b223fe8d0a0e5c4f27ead9083c756cc2"
  (20 + 3 + 20 = 43 bytes; 0x + 86 hex chars = length 88)

encodeV3Path([{USDC, 3000, WETH}, {WETH, 3000, WBTC}])
  === "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48000bb8c02aaa39b223fe8d0a0e5c4f27ead9083c756cc2000bb82260fac5e5542a773aa44fbcfedf7c193bc2c599"
  (20 + 3 + 20 + 3 + 20 = 66 bytes; 0x + 132 hex chars = length 134)
```

### Why `encodePacked` not `encodeAbiParameters`

ABI encoding pads `address` to 32 bytes and `uint24` to 32 bytes — producing a 96+ byte word-padded structure, NOT the 23-byte-per-hop packed format Uniswap expects. **`encodePacked` is mandatory.** A common bug class — Phase 32 fixture-pinning catches it.

---

## Topic 4 — Deadline Enforcement Path

**CONFIRMED:** `multicall(uint256 deadline, bytes[] data)` selector `0x5ae401dc` is the canonical deadline-enforcement wrapper [VERIFIED: github.com/Uniswap/swap-router-contracts/blob/main/contracts/base/MulticallExtended.sol].

### Why deadline matters in SwapRouter02

SwapRouter V1 had `deadline` as a field inside `ExactInputSingleParams` / `ExactInputParams`. SwapRouter02 DROPPED these for gas efficiency [VERIFIED: github.com/Uniswap/swap-router-contracts/blob/main/contracts/interfaces/IV3SwapRouter.sol — `ExactInputSingleParams` has 7 fields, no `deadline`]. Without deadline enforcement, a user who signs a swap could see it sit in mempool for hours and be broadcast later when the market has moved against them — sandwich-MEV pattern in reverse.

`MulticallExtended.multicall(uint256 deadline, bytes[] calldata data)`:

```solidity
function multicall(uint256 deadline, bytes[] calldata data)
  external payable
  override(IMulticallExtended)
  checkDeadline(deadline)
  returns (bytes[] memory)
{
  return multicall(data);
}

modifier checkDeadline(uint256 deadline) {
  require(_blockTimestamp() <= deadline, "Transaction too old");
  _;
}
```

[VERIFIED: contract source matches description]

**Phase 32 calldata composition (D-10 + D-05):**

```
SwapRouter02.multicall(
  deadline = block.timestamp + 600,                    // 10 min from prepare time
  data = [
    SwapRouter02.exactInputSingle({                    // OR exactInput for multi-hop
      tokenIn:           <resolved>,
      tokenOut:          <resolved>,
      fee:               <selected>,
      recipient:         <user OR router for ETH-out>,
      amountIn:          <decimal-resolved>,
      amountOutMinimum:  <computed>,
      sqrtPriceLimitX96: 0,
    }),
    // For ETH-out path ONLY:
    SwapRouter02.unwrapWETH9(amountOutMinimum, user),
  ],
)
```

The OUTER selector the device sees is `0x5ae401dc`. The user's `payloadFingerprint` covers the OUTER multicall calldata in full — re-decoding the bytes locally surfaces the inner sub-calls in `preview_send`'s DECODED ARGS block.

### `selfPermit` alternative — REJECTED

CONTEXT.md Claude's-Discretion notes the planner could consider `selfPermit` as the deadline-enforcement vehicle. `selfPermit` is EIP-2612 typed-data permit; it carries a deadline as part of the permit signature, NOT the calldata. Phase 32 explicitly avoids typed-data signing (D-03). Use of `selfPermit` would require the user to sign a typed-data permit on-Ledger BEFORE the swap calldata signature — two signatures per swap, doubling the friction. `multicall(deadline, ...)` is the correct vehicle.

---

## Topic 5 — Price-Impact Computation (Quoter-Midpoint Method)

**D-04b LOCKED.** Phase 32 ships the Quoter-midpoint simplified method. Production-grade midpoint sourcing (Chainlink / TWAP) deferred to v2.6 Phase 40.

### Algorithm

```
1. Compute tinyAmount = amountIn / 10000  (scaled — 0.01% of the user's amount)
   If tinyAmount == 0n (user's amount is < 10000 base units), use amountIn itself
   as the reference (impact ≈ 0 for sub-base-unit amounts).

2. Call Quoter V2 with tinyAmount at the SELECTED fee tier:
   tinyOut = quoteExactInputSingle({ tokenIn, tokenOut, amountIn: tinyAmount, fee, sqrtPriceLimitX96: 0 })

3. Scale tinyOut back to full-amount baseline:
   fairOut = tinyOut * (amountIn / tinyAmount) = tinyOut * 10000

4. Compare with actual full-amount quote:
   actualOut = quoteExactInputSingle({ tokenIn, tokenOut, amountIn, fee, sqrtPriceLimitX96: 0 })

5. Compute priceImpactBps:
   priceImpactBps = (fairOut - actualOut) * 10000n / fairOut
   = ((fairOut - actualOut) / fairOut) * 10000

   Floor at 0 (actualOut > fairOut is theoretically impossible but RPC noise / tick math
   can produce 1-wei rounding artifacts; clamp to 0 rather than emit negative impact).
```

### Pure-bigint implementation (`src/signing/uniswap-price-impact.ts` — NEW)

```typescript
export interface PriceImpactInput {
  fairOut: bigint;        // tinyOut * scaleFactor (impact-free fair-price reference)
  actualOut: bigint;      // full-amount Quoter V2 output
}

export function computePriceImpactBps(input: PriceImpactInput): number {
  if (input.fairOut === 0n) return 10000;  // degenerate — no reference price; treat as 100% impact
  const drop = input.fairOut > input.actualOut ? input.fairOut - input.actualOut : 0n;
  const bps = (drop * 10000n) / input.fairOut;
  // Cap at 10000 (100%) — safety against >100% reads from RPC bug
  return Number(bps > 10000n ? 10000n : bps);
}
```

### Known limitation (documented residual risk)

**The Quoter-midpoint method UNDERSTATES impact on pools with extremely concentrated liquidity at the spot tick.** If 99% of pool liquidity sits at the current tick and the spot tick is the only tick the tiny-amount quote touches, both tinyOut and fullOut consume liquidity from the same tick — the "fair price" reference IS the spot price, and impact reads near 0 even for very large swaps. The mitigation is **D-08's 2% sandwich-MEV refusal threshold** — even understated impact >2% triggers the gate; the gate's design errs on the side of refusal.

SECURITY.md §6 v2.4 addendum (added in Plan 32-03) documents this residual risk verbatim.

---

## Topic 6 — Native ETH Semantics in SwapRouter02

### ETH-in (`tokenIn = "ETH"` agent input)

**[VERIFIED via SwapRouter02 source — Uniswap/swap-router-contracts/contracts/V3SwapRouter.sol]**

1. Server resolves `tokenIn = "ETH"` to the WETH9 address (`0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2`).
2. Calldata uses WETH9 as `ExactInputSingleParams.tokenIn`.
3. Transaction is built with `tx.value = amountIn`.
4. SwapRouter02's internal `pay(token, payer, recipient, value)` helper detects `msg.value > 0 && token == WETH9` and routes through `WETH9.deposit{value: msg.value}()` — the router's WETH9 balance grows by `amountIn`, and the swap consumes from that balance.

**Failure mode if `msg.value < amountIn`:** SwapRouter02 falls back to `transferFrom(payer, ...)` for the deficit, which reverts if the user hasn't approved WETH9 to the router. Phase 32 sets `tx.value === amountIn` exactly when ETH-in (no slack).

**Failure mode if `msg.value > amountIn`:** SwapRouter02 holds the leftover ETH. The user would need to call `refundETH()` separately to recover it. **Phase 32 sets `tx.value === amountIn` exactly — no leftover.**

**CHECKS PERFORMED surfaces:** `tokenIn: "ETH" (resolved to WETH 0xC02a...756Cc2 for routing; msg.value carries amount)` — explicit so the user sees the resolution.

### ETH-out (`tokenOut = "ETH"` agent input)

[VERIFIED via Uniswap docs Multihop Swaps guide + SwapRouter02 source]

1. Server resolves `tokenOut = "ETH"` to the WETH9 address.
2. Inner `exactInputSingle` (or `exactInput`) calldata uses WETH9 as `tokenOut`; `recipient = address(SwapRouter02)` — the router itself.
3. Inner sub-call leaves the swapped WETH balance sitting in the router's contract.
4. Outer multicall sub-call `unwrapWETH9(amountOutMinimum, user)` — router calls `WETH9.withdraw(routerBalance)`, then transfers the resulting ETH to `user`.
5. Atomic — if any sub-call reverts, the entire multicall reverts.

**Wire shape (concrete UNI-B fixture):**

```
multicall(
  deadline,
  [
    abi.encodeCall(exactInputSingle, ExactInputSingleParams{
      tokenIn:           WETH,                               // (user's input "WETH" or "ETH" — wait, ETH-out means tokenIn != ETH; see Open Question 1)
      tokenOut:          WETH,                               // wait — this needs CONTEXT clarification (see Open Question 1)
      fee:               500,
      recipient:         SwapRouter02,                       // <— router holds WETH between sub-calls
      amountIn:          ...,
      amountOutMinimum:  ...,
      sqrtPriceLimitX96: 0,
    }),
    abi.encodeCall(unwrapWETH9, (amountOutMinimum, user)),
  ],
)
```

### ETH-in AND ETH-out simultaneously

[D-05 LOCKED.] Refused at quote time: `INVALID_INPUT` with `same-token-swap-refused` hint. Semantically this is a no-op identity swap (ETH → WETH → ETH); the server refuses before consuming any RPC.

---

## Topic 7 — ERC-7730 Clear-Sign Coverage

**[VERIFIED: github.com/LedgerHQ/clear-signing-erc7730-registry/blob/master/registry/uniswap/calldata-UniswapV3Router02.json — fetched 2026-05-23]**

### Functions WITH ERC-7730 clear-sign coverage on SwapRouter02

| Function | Selector | Coverage Status |
|----------|----------|----------------|
| `exactInputSingle((address,address,uint24,address,uint256,uint256,uint160))` | `0x04e45aaf` | COVERED — clear-sign |
| `exactInput((bytes,address,uint256,uint256))` | `0xb858183f` | COVERED — clear-sign |
| `exactOutputSingle((...))` | (not used by Phase 32) | COVERED |
| `exactOutput((...))` | (not used by Phase 32) | COVERED |
| `swapExactTokensForTokens(uint256,uint256,address[],address)` | (V2 path — not used by Phase 32) | COVERED |
| `swapTokensForExactTokens(uint256,uint256,address[],address)` | (V2 path — not used by Phase 32) | COVERED |

### Functions WITHOUT ERC-7730 clear-sign coverage on SwapRouter02

| Function | Selector | Phase 32 Use |
|----------|----------|--------------|
| `multicall(uint256,bytes[])` | `0x5ae401dc` | **OUTER wrapper for EVERY Phase 32 swap (D-10)** |
| `multicall(bytes[])` | `0xac9650d8` | NOT used by Phase 32 |
| `multicall(bytes32,bytes[])` | `0x1f0464d1` | NOT used by Phase 32 |
| `unwrapWETH9(uint256,address)` | `0x49404b7c` | **INNER sub-call for ETH-out (D-05)** |

### Phase 32 implication: ALL transactions blind-sign

Because D-10 wraps every Phase 32 swap in `multicall(deadline, [...])`, the OUTER selector the Ledger device's clear-sign plugin sees is `0x5ae401dc` — which is NOT in the ERC-7730 registry. The plugin cannot decode the multicall calldata to surface the inner `exactInputSingle` args on-device. The Ledger ETH app falls back to blind-sign mode — displays only the raw keccak transaction hash with no decoded args.

**Conclusion:** A new `LEDGER_NOTICE_UNISWAP_V3_TEMPLATE` block in `src/signing/blocks.ts` is required for EVERY Phase 32 `prepare_uniswap_swap` response. The template clones `LEDGER_NOTICE_WETH_UNWRAP_TEMPLATE` (Phase 6 Plan 06-04) in shape and wording, swapping the Uniswap V3-specific copy.

**This is a deviation from CONTEXT.md D-11** which states "Standard PREPARE RECEIPT + CHECKS PERFORMED + LEDGER NOTICE (only if blind-sign per D-03) layout. NO new block-emit template needed beyond the sandwich-MEV refusal template (D-08)." The CONTEXT.md authoring assumed `exactInputSingle`-direct-call (which IS clear-signed); but the locked D-10 multicall wrapper escalates EVERY swap to blind-sign. **The planner MUST add the new template.** Surfaced to the planner as a CONTEXT.md gap rather than a CONTEXT.md violation — D-03 itself caveat ("LEDGER NOTICE block emitted only if any selector falls back to blind-sign — Phase 6 WETH9.withdraw precedent") covers this case.

### Recommended `LEDGER_NOTICE_UNISWAP_V3_TEMPLATE`

```typescript
export const LEDGER_NOTICE_UNISWAP_V3_TEMPLATE: string = [
  "LEDGER NOTICE",
  "  Uniswap V3 swaps are submitted as a `multicall(deadline, bytes[])` wrapper.",
  "  The OUTER multicall selector is NOT covered by the Ledger Ethereum app's",
  "  clear-sign plugin — your device will BLIND-SIGN this transaction (display",
  "  a raw hash, no decoded args).",
  "",
  "  If your device refuses with \"Blind signing is not enabled\":",
  "    1. Open the Ethereum app on your device",
  "    2. Settings → Blind signing → Enabled",
  "    3. Retry send_transaction",
  "",
  "  The trust anchor is the PREDICTED hash below — compare it character-for-",
  "  character with the hash your device displays. The decoded swap details",
  "  (tokenIn, tokenOut, fee tier, amountIn, amountOutMinimum, deadline, path)",
  "  are surfaced verbatim in the PREPARE RECEIPT + CHECKS PERFORMED blocks above.",
].join("\n");
```

---

## Topic 8 — Sandwich-MEV Gate (Clone Phase 20 SunSwap)

### Gate flow (matches Phase 20 SunSwap verbatim per D-08)

```
1. Pre-Zod raw-args inspection:
     slippageWasExplicit = ("slippageBps" in rawArgs) && rawArgs.slippageBps !== undefined
   This catches the distinction Zod's `.default(50)` would mask — a user who
   omits slippageBps is OPTING IN to the default; a user who supplies it
   (even at 50) is EXPLICITLY ACKNOWLEDGING the impact.

2. Fetch quote (load-bearing — quote at prepare time may differ from
   quote at agent-discovery time; re-fetching is part of the contract).

3. If quote.priceImpactBps > 200 AND !slippageWasExplicit:
     Render SANDWICH_MEV_REFUSAL_ETHEREUM_TEMPLATE with placeholders filled.
     Return errEnvelope("INVALID_INPUT", message, cause, hintTool="get_uniswap_quote").

4. Otherwise: proceed with calldata composition.
```

### New `SANDWICH_MEV_REFUSAL_ETHEREUM_TEMPLATE` (clone of TRON)

```typescript
// src/signing/blocks.ts — Phase 32 Plan 32-01 APPEND
export const SANDWICH_MEV_REFUSAL_ETHEREUM_TEMPLATE: string = [
  "⚠ SANDWICH-MEV DEFENSE (Uniswap V3 — Ethereum mainnet)",
  "  priceImpactBps: {PRICE_IMPACT_BPS}",
  "  threshold:      {THRESHOLD_BPS} (2% — sandwich extraction threshold per D-08)",
  "",
  "  The swap's estimated price impact ({PRICE_IMPACT_BPS} bps) exceeds the {THRESHOLD_BPS} bps",
  "  sandwich-MEV defense threshold. This swap may be vulnerable to front-running",
  "  by MEV bots that bracket the transaction with buys/sells timed to extract value.",
  "",
  "  To proceed: call get_uniswap_quote to review the route + expected output,",
  "  then call prepare_uniswap_swap again with slippageBps set explicitly (any value).",
  "  Explicitly supplying slippageBps signals that you acknowledge the high price impact.",
].join("\n");
```

### `slippageBps` bounds (D-08 LOCKED)

- Lower bound: `1` (0.01% — minimum that clears typical pool fee + tick rounding).
- Upper bound: `10000` (100% — accept any output).
- Default when not supplied: `50` (0.5%).
- `slippageBps === 0` → `INVALID_INPUT` ("slippage of 0 would compute amountOutMinimum == quotedAmountOut, which on-chain rounds to revert").
- `slippageBps > 10000` → `INVALID_INPUT` ("slippage exceeds 100%").

### Mechanical-clone discipline

`src/tools/prepare_uniswap_swap.ts` clones `src/tools/prepare_sunswap_swap.ts` (Phase 20) verbatim for the gate flow + clones `src/tools/prepare_lido_wrap.ts` (Phase 30) verbatim for the token-approval pre-flight + clones `src/tools/prepare_aave_supply.ts` (Phase 7) for the multi-arg ERC-20 call composition. No new gate-logic; mechanical adaptation only.

---

## Topic 9 — SOT Extension + Canonical-Dispatch Wiring

### `src/config/contracts.ts` extension (Plan 32-01)

```typescript
// ---------------------------------------------------------------------------
// Uniswap V3 per-chain SOT — Phase 32 Plan 32-01.
// ---------------------------------------------------------------------------

export interface UniswapV3Contracts {
  swapRouter02:                Address;  // the WRITE target (Phase 32)
  quoterV2:                    Address;  // READ-only — NOT added to dispatch (D-13)
  nonfungiblePositionManager:  Address;  // RESERVED for Phase 33 LP verbs; Phase 32 doesn't read
}

const UNISWAP_V3_RAW: Partial<Record<ChainId, UniswapV3Contracts>> = {
  1: {
    swapRouter02:               getAddress("0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45"),
    quoterV2:                   getAddress("0x61fFE014bA17989E743c5F6cB21bF9697530B21e"),
    nonfungiblePositionManager: getAddress("0xC36442b4a4522E871399CD717aBDD847Ab11FE88"),
  },
};

export function getUniswapV3SwapRouter02Address(chainId: ChainId): Address | null {
  return UNISWAP_V3_RAW[chainId]?.swapRouter02 ?? null;
}

export function getUniswapV3QuoterV2Address(chainId: ChainId): Address | null {
  return UNISWAP_V3_RAW[chainId]?.quoterV2 ?? null;
}

export function getUniswapV3NonfungiblePositionManagerAddress(chainId: ChainId): Address | null {
  return UNISWAP_V3_RAW[chainId]?.nonfungiblePositionManager ?? null;
}
```

[VERIFIED addresses:]
- SwapRouter02: `0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45` — Etherscan verified, ~4 years 159 days old
- Quoter V2: `0x61fFE014bA17989E743c5F6cB21bF9697530B21e` — Etherscan verified, ~4 years 172 days old
- NonfungiblePositionManager: `0xC36442b4a4522E871399CD717aBDD847Ab11FE88` — [VERIFIED: Etherscan source-verified; canonical Uniswap V3 LP NFT contract; Phase 32 only references the address as a reserved SOT slot]

### `KNOWN_SPENDERS_ETHEREUM` entry promotion (D-13a)

The existing row at line 864-867 of `src/config/contracts.ts`:

```typescript
// BEFORE Phase 32:
{
  address: getAddress("0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45"),
  label: "Uniswap V3 SwapRouter02",
  source: "https://docs.uniswap.org",
},

// AFTER Phase 32 (D-13a promotion):
{
  address: getUniswapV3SwapRouter02Address(1)!,
  label: "Uniswap V3 SwapRouter02",
  source: "https://docs.uniswap.org",
},
```

**Byte-identity invariant:** the row's `address` value MUST equal `0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45` byte-for-byte after promotion. `T-UNISWAP-V3-SPENDER-DRIFT-1` regression test in `test/config-contracts.test.ts`:

```typescript
it("T-UNISWAP-V3-SPENDER-DRIFT-1: KNOWN_SPENDERS_ETHEREUM SwapRouter02 row matches SOT getter", () => {
  const sotAddr = getUniswapV3SwapRouter02Address(1);
  expect(sotAddr).not.toBeNull();
  const row = KNOWN_SPENDERS_ETHEREUM.find((s) => s.label === "Uniswap V3 SwapRouter02");
  expect(row).toBeDefined();
  expect(row!.address).toBe(sotAddr);
});
```

**Other Uniswap entries unchanged.** `Uniswap V2 Router 02` + `Uniswap V3 SwapRouter (V1)` + `Uniswap Permit2` rows stay byte-identical. No churn.

### `CANONICAL_DISPATCH_TARGETS` Ethereum-arm extension (D-13)

```typescript
// src/security/canonical-dispatch.ts — Phase 32 Plan 32-01 APPEND
// Phase 32 — Plan 32-01. Uniswap V3 write-side allowlist (Ethereum arm only).
// SwapRouter02 is the dispatch target for every `prepare_uniswap_swap`.
// Quoter V2 is NOT added — it's READ-ONLY per D-13 (canonical-dispatch gates
// send-path only, not eth_call reads).
// NonfungiblePositionManager is NOT added — it's reserved for Phase 33 LP
// verbs which add it then; Phase 32 keeps the Set narrow.
const uniswapV3SwapRouter02 = getUniswapV3SwapRouter02Address(chainId);
const uniswapEntries: Address[] = uniswapV3SwapRouter02 ? [uniswapV3SwapRouter02] : [];

// ... then in the return Set:
return new Set<Address>([
  // ... existing entries ...
  ...uniswapEntries,
]);
```

**Membership counts after Phase 32 (Ethereum):** previous 29 entries (Phase 31) + 1 SwapRouter02 = **30 entries** (no overlap — SwapRouter02 address is unique vs existing entries).

### `T-UNISWAP-V3-SPENDER-DRIFT-1` regression test scope

Phase 32 Plan 32-01 ships ONE drift test (lower volume than Phase 31's two — because Quoter V2 is NOT in the KNOWN_SPENDERS table). The test pattern mirrors `T-EIGENLAYER-SPENDER-DRIFT-1` from Phase 31 verbatim.

---

## Topic 10 — Canonical Multi-Hop Mapping

**D-04 step 3 LOCKED:** Phase 32 uses a HARDCODED canonical pair-to-fee-tier mapping for the multi-hop intermediate hop. NO per-hop fee-tier iteration. The combinatorial blowup (4 tiers per hop × 2 hops × 2-3 candidate routes = 24-36 quotes per call) is deferred to v3.x algorithmic-routing.

### Empirically derived mapping (TVL-as-signal, late 2025 / early 2026)

[VERIFIED via WebSearch + GeckoTerminal pool TVL inspection at research time 2026-05-23]

| Pair | Recommended Fee Tier | TVL Evidence | Confidence |
|------|----------------------|--------------|------------|
| WETH ↔ USDC | **500 (0.05%)** | $103M TVL in 0.05% pool [VERIFIED: geckoterminal.com/eth/pools/0x88e6a0c2ddd26feeb64f039a2c41296fcb3f5640]; canonical stable-pair fee tier | HIGH |
| WETH ↔ USDT | **3000 (0.30%)** | $66M TVL in 0.3% pool [VERIFIED: geckoterminal.com/eth/pools/0x4e68ccd3e89f51c3074ca5072bbac773960dfa36]; the 0.05% USDT pool exists but holds substantially less liquidity | MEDIUM |
| WETH ↔ WBTC | **3000 (0.30%)** | $59M TVL in 0.3% pool [VERIFIED: geckoterminal.com/eth/pools/0xcbcdf9626bc03e24f779434178a73a0b4bad62ed]; 71% of WBTC/WETH liquidity sits in 0.3% per Gamma Strategies Q3 analysis | HIGH |
| WETH ↔ DAI | **3000 (0.30%)** | DAI's V3 liquidity is fragmented; 0.30% is the historically-dominant tier | MEDIUM |
| USDC ↔ USDT | **100 (0.01%)** | Lowest-fee tier for stable-stable pairs (post-Apr-2022 introduction); standard Uniswap recommendation | MEDIUM |
| USDC ↔ DAI | **100 (0.01%)** | Same as USDC/USDT (stable-stable) | MEDIUM |
| USDT ↔ DAI | **100 (0.01%)** | Same as USDC/USDT (stable-stable) | MEDIUM |

### Canonical multi-hop candidate routes (D-04 step 3)

Phase 32 multi-hop iteration produces TWO candidate paths per `(tokenIn, tokenOut)` pair:

1. **WETH-anchored:** `tokenIn → fee_inToWETH → WETH → fee_WETHToOut → tokenOut`
   - Used for: any pair where both tokens have a WETH pool (the vast majority of tokens).
   - Fee tiers chosen per the mapping above (look up `(tokenIn, WETH)` and `(WETH, tokenOut)` separately).
2. **USDC-anchored:** `tokenIn → fee_inToUSDC → USDC → fee_USDCToOut → tokenOut`
   - Used for: stable-flavored pairs where USDC liquidity dominates (e.g. USDT ↔ DAI route via USDC).
   - Only attempted if BOTH `(tokenIn, USDC)` AND `(USDC, tokenOut)` are in the mapping above.

### Implementation pattern (recommended for Plan 32-02)

```typescript
const CANONICAL_FEE_TIERS: Readonly<Record<string, 100 | 500 | 3000 | 10000>> = {
  // Key format: sorted(addr_a, addr_b).join("|") — order-independent lookup
  [pairKey(WETH, USDC)]: 500,
  [pairKey(WETH, USDT)]: 3000,
  [pairKey(WETH, WBTC)]: 3000,
  [pairKey(WETH, DAI)]:  3000,
  [pairKey(USDC, USDT)]: 100,
  [pairKey(USDC, DAI)]:  100,
  [pairKey(USDT, DAI)]:  100,
};

function pairKey(a: Address, b: Address): string {
  return a.toLowerCase() < b.toLowerCase()
    ? `${a.toLowerCase()}|${b.toLowerCase()}`
    : `${b.toLowerCase()}|${a.toLowerCase()}`;
}

function lookupCanonicalFee(a: Address, b: Address): 100 | 500 | 3000 | 10000 | null {
  return CANONICAL_FEE_TIERS[pairKey(a, b)] ?? null;
}
```

**Fallback if neither candidate route has all canonical hops mapped:** multi-hop quote skipped entirely; single-hop result wins by default. The agent surfaces `route: { hops: [...], strategy: "single-hop" }` verbatim.

---

## Topic 11 — Fixture Byte-Identity Plan (UNI-A / UNI-B / UNI-C)

**Per D-15 LOCKED.** Three fixtures pin the `payloadFingerprint` for canonical Phase 32 calldata shapes. Hardcoded `0x...` literals in `test/signing-fingerprint.test.ts` per CLAUDE.md cryptographic-binding rule. NO `beforeAll`-snapshot.

### Fixture UNI-A — single-hop ERC-20 → ERC-20 (USDC → WETH, fee 500)

```
Inputs:
  chainId    = 1
  to         = getUniswapV3SwapRouter02Address(1) = 0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45
  valueWei   = 0n                                   (no ETH-in)
  deadline   = 1748707200n                          (FIXED literal for fixture reproducibility — 2025-05-31 12:00 UTC)
  innerCall  = exactInputSingle({
    tokenIn:           USDC (0xA0b86991c6218b36c1D19D4a2e9eB0cE3606eB48),
    tokenOut:          WETH (0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2),
    fee:               500,
    recipient:         ANVIL_WALLET_1 (consistent test persona),
    amountIn:          100_000000n (100 USDC, 6 decimals),
    amountOutMinimum:  48_100_000_000_000_000n (≈ 0.0481 WETH, 18 decimals),
    sqrtPriceLimitX96: 0n,
  })
  data       = encodeFunctionData({ multicall, [deadline, [encodeFunctionData(exactInputSingle, ...)]] })

Expected: fp = "0x<COMPUTE_AT_PLAN_32_01_TIME>" (computed by encoder at fixture-write time)
```

The Plan 32-01 task that adds Fixture UNI-A computes the actual fingerprint via the real `computePayloadFingerprint` + `encodeMulticallWithDeadline` helpers, then pins the result as a hardcoded literal. CLAUDE.md "NO beforeAll-snapshot" rule.

### Fixture UNI-B — ETH-out via multicall + unwrapWETH9 (clarification needed — see Open Question 1)

The CONTEXT.md fixture description for UNI-B reads:

> Fixture UNI-B = `SwapRouter02.multicall(deadline, [exactInputSingle({ tokenIn: WETH, tokenOut: USDC, fee: 500, recipient: <persona>, amountIn: 1e18, ... }), unwrapWETH9(amountOutMin, <persona>)])` — single-hop ETH-out via multicall + unwrapWETH9, the canonical token→ETH receipt shape.

**This is internally inconsistent.** `tokenOut: USDC` is the swap output, but a `unwrapWETH9` sub-call only makes sense if the OUTPUT of the swap is WETH (to be unwrapped to ETH). The semantically-correct shape is `tokenOut: WETH` (with the swap recipient as the router, then unwrap WETH to ETH for the user). The CONTEXT.md text likely has a typo — `USDC` should read `WETH`.

**Researcher recommendation for UNI-B (corrects the typo, captures the canonical ETH-out shape):**

```
Inputs:
  chainId    = 1
  to         = SwapRouter02 = 0x68b3...Fc45
  valueWei   = 0n                                   (ETH-out, NOT ETH-in; user pays USDC, receives ETH)
  deadline   = 1748707200n
  innerCalls = [
    exactInputSingle({
      tokenIn:           USDC,                       (user pays USDC)
      tokenOut:          WETH,                       (router receives WETH; will be unwrapped)
      fee:               500,
      recipient:         SwapRouter02,                ← router holds WETH between sub-calls
      amountIn:          100_000000n,                 (100 USDC)
      amountOutMinimum:  48_100_000_000_000_000n,    (0.0481 WETH minimum)
      sqrtPriceLimitX96: 0n,
    }),
    unwrapWETH9(amountMinimum=48_100_000_000_000_000n, recipient=ANVIL_WALLET_1),
  ]
  data       = encodeFunctionData({ multicall, [deadline, innerCalls] })

Expected: fp = "0x<COMPUTE_AT_PLAN_32_01_TIME>"
```

This is the CANONICAL token→ETH receipt shape. **The planner should ask the user for sign-off on this correction at Plan 32-01 task-design time.** (Filed as Open Question 1.)

### Fixture UNI-C — multi-hop ERC-20 → ERC-20 (USDC → WETH → WBTC at 0.30% each hop)

```
Inputs:
  chainId    = 1
  to         = SwapRouter02 = 0x68b3...Fc45
  valueWei   = 0n
  deadline   = 1748707200n
  path       = encodeV3Path([
                 { tokenIn: USDC, fee: 3000, tokenOut: WETH },
                 { tokenIn: WETH, fee: 3000, tokenOut: WBTC },
               ])
             = 0xA0b86991c6218b36c1D19D4a2e9eB0cE3606eB48000bb8C02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2000bb82260FAC5E5542a773Aa44fBCfeDf7C193bc2C599
             (66 bytes — concrete fixture)
  innerCall  = exactInput({
    path:              <above>,
    recipient:         ANVIL_WALLET_1,
    amountIn:          100_000000n,
    amountOutMinimum:  179_000n (≈ 0.00179 WBTC, 8 decimals — placeholder),
  })
  data       = encodeFunctionData({ multicall, [deadline, [encodeFunctionData(exactInput, ...)]] })

Expected: fp = "0x<COMPUTE_AT_PLAN_32_01_TIME>"
```

### Cross-link strategy

Each fixture has 3 anchor points (matches Phase 30/31 precedent):

1. **`test/signing-fingerprint.test.ts`** — primary fingerprint pin (the literal).
2. **`test/get-uniswap-quote.test.ts`** — quote re-anchor: assert that the quote for the same inputs produces the expected `outAmount` shape (note: the on-chain pool state shifts so exact match is infeasible — instead assert quote response shape + envelope structure).
3. **`test/prepare-uniswap-swap.test.ts`** — prepare re-anchor: assert that `prepare_uniswap_swap` with the same inputs produces a fingerprint matching the literal in `signing-fingerprint.test.ts`.

### `from`-independence integration test

Mirrors Phase 30/31 `test/integration-eigenlayer-rocketpool.test.ts` pattern:

```typescript
// test/integration-uniswap-v3.test.ts
describe("Phase 32 — Uniswap V3 swap from-independence integration", () => {
  it("UNI-A fingerprint is byte-identical across persona swaps", async () => {
    for (const persona of ["whale", "defi-degen", "stable-saver"]) {
      await setDemoWallet({ persona });
      const result = await callTool("prepare_uniswap_swap", UNI_A_AGENT_ARGS);
      expect(result.structuredContent.payloadFingerprint).toBe(UNI_A_FINGERPRINT_LITERAL);
    }
  });

  // Same for UNI-B + UNI-C
});
```

**Proves `from`-independence:** the agent-supplied `from` address is NOT in the `payloadFingerprint` preimage (Phase 4 PREP-03). T-BIND-1 anchor. Persona-swap re-anchor catches any future drift that accidentally folds `from` into the fingerprint.

---

## Topic 12 — SOT Refactor Risk

**`KNOWN_SPENDERS_ETHEREUM` SwapRouter02 entry promotion is a no-op refactor by construction.** The entry's `address` field is replaced with `getUniswapV3SwapRouter02Address(1)!` which resolves to the byte-identical value `0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45`. The `label` + `source` fields are preserved verbatim.

### Risks during the refactor

1. **Row-order drift.** If a planner accidentally REPLACES the entire row (vs. just the `address` field), neighboring rows could shift in array index. The `KNOWN_SPENDERS_ETHEREUM` array index is NOT publicly load-bearing (consumers use `lookupSpender(address)` which does `.find` — order-independent lookup); but the order is regression-tested in `test/config-contracts.test.ts`. **Mitigation:** Plan 32-01 task instructs "edit only the `address:` field inside the existing SwapRouter02 row; do not delete and re-add the row, do not reorder."

2. **Cross-view drift.** A future plan that updates SwapRouter02's address (e.g. v4 deployment) would need to update BOTH the SOT (`getUniswapV3SwapRouter02Address`) AND `KNOWN_SPENDERS_ETHEREUM`. After Phase 32, the SOT is single-source — updating the SOT propagates to KNOWN_SPENDERS automatically. **`T-UNISWAP-V3-SPENDER-DRIFT-1` enforces this invariant.**

3. **`getAddress` checksum drift.** The SOT getter uses `getAddress("0x68b3...")` which throws on EIP-55 checksum mismatch. The existing literal at line 865 also uses `getAddress(...)`. Both must use the SAME checksum casing. Verified at research time: the canonical EIP-55 casing is `0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45` — both sites already use this.

### Drift-test specification (`T-UNISWAP-V3-SPENDER-DRIFT-1`)

Lives in `test/config-contracts.test.ts`. Asserts:

```typescript
it("T-UNISWAP-V3-SPENDER-DRIFT-1: KNOWN_SPENDERS_ETHEREUM 'Uniswap V3 SwapRouter02' row address matches getUniswapV3SwapRouter02Address(1)", () => {
  const sotAddr = getUniswapV3SwapRouter02Address(1);
  expect(sotAddr).not.toBeNull();
  const row = KNOWN_SPENDERS_ETHEREUM.find((s) => s.label === "Uniswap V3 SwapRouter02");
  expect(row).toBeDefined();
  expect(row!.address).toBe(sotAddr);
  // Byte-identity check against the canonical literal (defense-in-depth — catches
  // simultaneous drift in BOTH SOT and KNOWN_SPENDERS)
  expect(sotAddr).toBe(getAddress("0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45"));
});
```

The third `expect` is defense-in-depth — if a future contributor "moves" the SwapRouter02 address in BOTH the SOT and the KNOWN_SPENDERS row by mistake (silent migration to a v4 router), the third assertion catches it.

---

## Architecture Patterns

### System Architecture Diagram

```
                                  agent (Claude Code / Cursor / Desktop)
                                       │ stdio (MCP protocol)
                                       ▼
              ┌───────────────────────────────────────────────────────────┐
              │ vaultpilot-mcp                                            │
              │                                                            │
              │  ┌─────────────────────┐    ┌─────────────────────────┐   │
              │  │ get_uniswap_quote   │    │ prepare_uniswap_swap    │   │
              │  │ (Plan 32-02)        │    │ (Plan 32-03)            │   │
              │  └──────────┬──────────┘    └────┬──────────┬─────────┘   │
              │             │                    │          │             │
              │             │                    │ Step 1: re-fetch quote │
              │             │                    │ Step 2: MEV gate        │
              │             │                    │ Step 3: approval pre-fl │
              │             │                    │ Step 4: compose call   │
              │             │                    │ Step 5: fingerprint    │
              │             ▼                    ▼          ▼             │
              │  ┌──────────────────────────────────────────────────────┐ │
              │  │ src/chains/uniswap-v3.ts (Plan 32-01)                │ │
              │  │   QuoterV2.readContract({ ... }) — fee-tier iteration│ │
              │  │   try/catch null sentinels                            │ │
              │  └──────────────────────┬───────────────────────────────┘ │
              │                          │                                 │
              │  ┌──────────────────────▼───────────────────────────────┐ │
              │  │ src/protocols/uniswap-v3.ts (Plan 32-01)             │ │
              │  │   STRATEGY_MANAGER_ABI / SwapRouter02 ABIs           │ │
              │  │   encodeExactInputSingle / encodeExactInput          │ │
              │  │   encodeUnwrapWeth9 / encodeMulticallWithDeadline    │ │
              │  │   _uniswapV3Protocol (ESM spy-affordance)            │ │
              │  └──────────────────────┬───────────────────────────────┘ │
              │                          │                                 │
              │  ┌──────────────────────▼───────────────────────────────┐ │
              │  │ src/signing/uniswap-path.ts (Plan 32-01)             │ │
              │  │   encodeV3Path(hops[]) — encodePacked(addr,uint24...)│ │
              │  └──────────────────────┬───────────────────────────────┘ │
              │                          │                                 │
              │  ┌──────────────────────▼───────────────────────────────┐ │
              │  │ src/signing/uniswap-price-impact.ts (Plan 32-02)     │ │
              │  │   computePriceImpactBps({fairOut, actualOut})        │ │
              │  └──────────────────────────────────────────────────────┘ │
              │                                                            │
              │  ┌──────────────────────────────────────────────────────┐ │
              │  │ src/config/contracts.ts (extended Plan 32-01)        │ │
              │  │   UniswapV3Contracts interface                       │ │
              │  │   getUniswapV3SwapRouter02Address(chainId)           │ │
              │  │   getUniswapV3QuoterV2Address(chainId)               │ │
              │  │   getUniswapV3NonfungiblePositionManagerAddress      │ │
              │  │   KNOWN_SPENDERS_ETHEREUM (SwapRouter02 promoted)    │ │
              │  └──────────────────────────────────────────────────────┘ │
              │                                                            │
              │  ┌──────────────────────────────────────────────────────┐ │
              │  │ src/security/canonical-dispatch.ts (extended 32-01)  │ │
              │  │   CANONICAL_DISPATCH_TARGETS[1] ∪ {SwapRouter02}     │ │
              │  └──────────────────────────────────────────────────────┘ │
              │                                                            │
              │  ┌──────────────────────────────────────────────────────┐ │
              │  │ src/signing/blocks.ts (extended 32-01 + 32-03)       │ │
              │  │   LEDGER_NOTICE_UNISWAP_V3_TEMPLATE (NEW)            │ │
              │  │   SANDWICH_MEV_REFUSAL_ETHEREUM_TEMPLATE (NEW)       │ │
              │  │   DECODED ARGS dispatch extensions (selectors)       │ │
              │  └──────────────────────────────────────────────────────┘ │
              └───────────────────────────────────────────────────────────┘
                                       │
                                       │ payloadFingerprint + multicall(deadline, [...])
                                       │ via WalletConnect v2 / Ledger Live → device
                                       ▼
                                      Ledger device (the only trusted display)
```

### Recommended Project Structure (additive)

```
src/
├── chains/
│   └── uniswap-v3.ts                  ← NEW (Plan 32-02): QuoterV2 client wrapper
├── protocols/
│   └── uniswap-v3.ts                  ← NEW (Plan 32-01): ABI + selectors + encoders
├── signing/
│   ├── uniswap-path.ts                ← NEW (Plan 32-01): pure-bytes path encoder
│   └── uniswap-price-impact.ts        ← NEW (Plan 32-02): pure-bigint impact math
└── tools/
    ├── get_uniswap_quote.ts           ← NEW (Plan 32-02)
    └── prepare_uniswap_swap.ts        ← NEW (Plan 32-03)

test/
├── chains-uniswap-v3.test.ts          ← NEW: QuoterV2 wrapper unit tests
├── protocols-uniswap-v3.test.ts       ← NEW: byte-identity ABI regressions
├── signing-uniswap-path.test.ts       ← NEW: path encoder fixtures
├── signing-uniswap-price-impact.test.ts ← NEW: impact math regressions
├── get-uniswap-quote.test.ts          ← NEW
├── prepare-uniswap-swap.test.ts       ← NEW
└── integration-uniswap-v3.test.ts     ← NEW: persona-cycle byte-identity

(modified existing:)
src/config/contracts.ts                ← EXTEND (Plan 32-01)
src/security/canonical-dispatch.ts     ← EXTEND (Plan 32-01)
src/signing/blocks.ts                  ← EXTEND (Plans 32-01 + 32-03)
src/tools/preview_send.ts              ← EXTEND (Plan 32-03): tuple dispatch on (to, selector)
src/tools/register-all.ts              ← EXTEND (Plan 32-02 + 32-03): register 2 new tools
test/signing-fingerprint.test.ts       ← EXTEND (Plan 32-01): UNI-A/B/C literals
test/config-contracts.test.ts          ← EXTEND (Plan 32-01): T-UNISWAP-V3-SPENDER-DRIFT-1
```

### Pattern 1 — Mechanical Clone of Phase 20 SunSwap (sandwich-MEV gate)
**What:** `prepare_uniswap_swap.ts` clones `prepare_sunswap_swap.ts` line-by-line for the gate flow.
**When:** Sandwich-MEV gate at prepare time + quote re-fetch.
**Example:**
```typescript
// src/tools/prepare_uniswap_swap.ts — mirror of src/tools/prepare_sunswap_swap.ts:142-160
const rawArgs = args as Record<string, unknown>;
const slippageWasExplicit: boolean =
  "slippageBps" in rawArgs && rawArgs.slippageBps !== undefined;

// ... after fetching quote:
if (quote.priceImpactBps > 200 && !slippageWasExplicit) {
  const mevRefusalBlock = SANDWICH_MEV_REFUSAL_ETHEREUM_TEMPLATE
    .replace(/{PRICE_IMPACT_BPS}/g, String(quote.priceImpactBps))
    .replace(/{THRESHOLD_BPS}/g, "200");
  return errEnvelope(
    "INVALID_INPUT",
    `price impact ${(quote.priceImpactBps / 100).toFixed(2)}% exceeds 2% threshold`,
    `priceImpactBps: ${quote.priceImpactBps}`,
    "get_uniswap_quote",
  );
}
```

### Pattern 2 — Mechanical Clone of Phase 30 Lido (token approval pre-flight)
**What:** ERC-20 `allowance(user, SwapRouter02)` read at prepare time; refusal hint to `prepare_token_approve`.
**Example:** clone `src/tools/prepare_lido_wrap.ts` allowance-pre-flight verbatim, swap `Lido` → `SwapRouter02`.

### Pattern 3 — Mechanical Clone of Phase 31 EigenLayer (per-protocol decoder file)
**What:** `src/protocols/uniswap-v3.ts` mirrors `src/protocols/eigenlayer.ts` shape — ABI fragments, hardcoded selector constants, encoder functions, ESM spy-affordance.

### Pattern 4 — `multicall(deadline, [...])` outer wrapper (NEW shape — Phase 32 introduces)
**What:** Every Phase 32 prepared transaction has its calldata composed as `multicall(deadline, [encodeExactInputSingle(...) OR encodeExactInput(...)] [, encodeUnwrapWeth9(...)])`. The outer selector seen on-device is `0x5ae401dc`.
**Example:**
```typescript
// src/protocols/uniswap-v3.ts
export function encodeMulticallWithDeadline(
  deadline: bigint,
  innerCalls: readonly Hex[],
): Hex {
  return encodeFunctionData({
    abi: parseAbi(["function multicall(uint256 deadline, bytes[] data)"]),
    functionName: "multicall",
    args: [deadline, innerCalls],
  });
}
```

### Pattern 5 — Tuple dispatch on (to, selector) at `preview_send` DECODED ARGS layer
**What:** preview_send routes on the (tx.to, selector) tuple — selector `0x5ae401dc` against `tx.to === getUniswapV3SwapRouter02Address(1)` routes to a NEW Uniswap V3 DECODED ARGS arm (Plan 32-03 ships this in `src/tools/preview_send.ts` + `src/signing/blocks.ts`).
**Why:** The selector `0x5ae401dc` is the multicall-with-deadline selector — generic across many Uniswap-family contracts. Routing on (to, selector) prevents miscategorizing other contracts' multicalls.
**Mirror of:** Phase 31 RocketPool's `(to, selector)` tuple dispatch for selector collisions (RocketDepositPool.deposit / WETH9.deposit; rETH.burn / generic Burnable).

### Anti-Patterns to Avoid

- **DON'T use `encodeAbiParameters` for V3 path bytes.** ABI-encoding pads addresses + uint24 to 32 bytes; Uniswap's path format is packed, NOT word-padded. Use `encodePacked`. (Topic 3)
- **DON'T inline contract addresses.** Always go through SOT getters (`getUniswapV3SwapRouter02Address(1)`). T-UNISWAP-V3-SPENDER-DRIFT-1 catches violations.
- **DON'T iterate fee tiers serially with `await` in a for-loop.** Use `Promise.allSettled` to parallelize the 4 tier quotes — saves 3 round-trip latencies. RPC providers (Infura/Alchemy/public-node) all support parallel `eth_call`.
- **DON'T skip the QuoteV2 revert-with-return-value retry.** Empty responses from the RPC layer occasionally appear as transient network errors; the auto-fee-tier retry should NOT retry transient errors as "no pool" (they're distinguishable by the error class — RPC error vs contract revert). Conservative: 1 retry on network-layer error; 0 retries on contract revert.
- **DON'T compute the price-impact-tiny-amount quote in the same `Promise.all` batch as the main quote.** The "fair price" reference MUST use a tiny enough amount that pool-state perturbation is negligible. Serial sequencing (main quote → tiny quote in next block) is over-conservative; same-block parallel is fine; but mixing tiny + main amounts in one batch is conceptually muddled and the linter should flag it.
- **DON'T re-fetch the quote inside `send_transaction`.** Phase 4 PREP-08 covers drift detection via `payloadFingerprint` re-check. Re-fetching quote at send time would change `amountOutMinimum` and break the fingerprint — exactly the drift the gate is designed to catch.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| ABI encoding of multicall-of-bytes-arrays | Custom calldata stitching | `viem.encodeFunctionData` with parseAbi multicall fragment | Edge cases (offset encoding, dynamic-array-of-bytes nesting); 1 silent bug = unsignable tx |
| Packed-bytes path encoding | Manual hex concatenation | `viem.encodePacked` | Endianness, length-prefix elision, type-erasure bugs |
| Fee-tier iteration with try/catch | Manual revert-data decoding | viem `readContract` throws on revert; catch in JS | viem already handles the Quoter revert-with-return-value pattern internally |
| QuoteV2 callback decoding | Manual `decodeAbiParameters` on revert data | viem `readContract` decoded return | viem handles `nonpayable + eth_call` correctly |
| Price-impact computation | Float arithmetic | Pure-bigint `src/signing/uniswap-price-impact.ts` | Float precision drift; off-by-1-wei artifacts |
| Sandwich-MEV gate logic | Custom state machine | Clone Phase 20 SunSwap gate verbatim | Phase 20's gate is regression-anchored against Test 9 (sandwich-MEV refusal) — re-deriving risks divergence |
| ERC-20 allowance reads | Manual `eth_call` + decode | Reuse `src/protocols/erc20.ts` `allowance()` accessor | Phase 6 SOT — verified against Etherscan |

**Key insight:** Phase 32 is the SIXTH same-shape protocol-decoder phase (Aave / Compound / Morpho / Lido / EigenLayer / RocketPool / Uniswap). The mechanical-clone pattern is well-trodden. The novel surface is ONLY (1) the path-bytes encoder (`src/signing/uniswap-path.ts`), (2) the price-impact math (`src/signing/uniswap-price-impact.ts`), and (3) the multicall-deadline outer wrapper. Everything else is clone-of-clone.

---

## Common Pitfalls

### Pitfall 1: Quoter V2 struct field reordering vs SwapRouter02
**What goes wrong:** Quoter V2's `QuoteExactInputSingleParams` has field order `(tokenIn, tokenOut, amountIn, fee, sqrtPriceLimitX96)`. SwapRouter02's `ExactInputSingleParams` has field order `(tokenIn, tokenOut, fee, recipient, amountIn, amountOutMinimum, sqrtPriceLimitX96)`. **`fee` is at struct-index 4 in Quoter V2 but struct-index 3 in SwapRouter02.** Copy-paste between the two encoders silently quotes against tier-X but executes against tier-Y.
**Why it happens:** Visual similarity of the struct shape; tab-completion mishaps.
**How to avoid:** Pinned-byte-identity fixtures (UNI-A) catch this — the literal fails if struct encoding drifts at all. Plan 32-01 ships UNI-A as the first byte-identity anchor.
**Warning signs:** Quote outputs look correct in isolation but on-chain swap reverts with `Pool not found` or returns 0 output.

### Pitfall 2: Path-bytes endianness on `uint24` fee
**What goes wrong:** `uint24` is encoded as 3 bytes big-endian. A naive `Buffer.from([fee & 0xff, (fee >> 8) & 0xff, (fee >> 16) & 0xff])` writes little-endian — wrong format.
**Why it happens:** Solidity uses big-endian; JS Buffer convention defaults to platform-native (little-endian on x86).
**How to avoid:** Use `viem.encodePacked(["uint24"], [fee])` which guarantees big-endian. Pinned fixture `encodeV3Path([{USDC, 500, WETH}])` regression catches this (the canonical literal is `0x...0001f4...` for fee=500; `0xf40100` would be the LE-mistake).
**Warning signs:** Quote returns 0 output OR pool-not-found revert at on-chain execution.

### Pitfall 3: `recipient = router address` typo in ETH-out flow
**What goes wrong:** The inner `exactInputSingle` for ETH-out MUST have `recipient = SwapRouter02 address` (the router holds WETH between sub-calls). A typo setting `recipient = user` causes the inner call to send WETH to the user directly; the outer `unwrapWETH9` then reverts (the router has no WETH to unwrap).
**Why it happens:** Default mental model is `recipient = user` (true for non-ETH-out paths); ETH-out is the exception.
**How to avoid:** Centralize `composeMulticallWithUnwrap()` helper in `src/protocols/uniswap-v3.ts` that takes `(innerSwapParams, user)` and ALWAYS sets the inner recipient to the router internally. Agent-supplied user is consumed only by `unwrapWETH9`.
**Warning signs:** ETH-out swap reverts at the `unwrapWETH9` sub-call with "Insufficient WETH9 balance" or similar.

### Pitfall 4: `multicall(bytes[])` vs `multicall(uint256,bytes[])` selector confusion
**What goes wrong:** Encoding `multicall(bytes[])` (selector `0xac9650d8`) instead of `multicall(uint256,bytes[])` (selector `0x5ae401dc`). The former does NOT enforce deadline. Phase 32 D-10 requires the latter.
**Why it happens:** viem's `parseAbi` with `["function multicall(bytes[] data)"]` would compile fine and encode against the wrong selector.
**How to avoid:** Hardcode the selector in `UNISWAP_V3_SELECTORS`:
```typescript
export const UNISWAP_V3_SELECTORS = {
  exactInputSingle:        "0x04e45aaf" as Hex,
  exactInput:              "0xb858183f" as Hex,
  multicallWithDeadline:   "0x5ae401dc" as Hex,  // ← LOAD-BEARING — D-10
  unwrapWETH9:             "0x49404b7c" as Hex,
};
```
Use `parseAbi(["function multicall(uint256 deadline, bytes[] data)"])` for the multicall fragment.

### Pitfall 5: `tinyAmount` rounding artifact for very small swaps
**What goes wrong:** When `amountIn < 10000n`, `tinyAmount = amountIn / 10000 == 0n`. Quoter V2 call with `amountIn = 0` reverts; price-impact computation throws.
**Why it happens:** Integer division floors.
**How to avoid:** `if (tinyAmount === 0n) tinyAmount = amountIn;` — treat sub-base-unit amounts as approximation candidates with priceImpact ≈ 0. Document in `computePriceImpactBps`.
**Warning signs:** Quote for very small amounts returns INTERNAL_ERROR instead of valid envelope.

### Pitfall 6: Concurrent `Promise.all` exhausting RPC rate limits
**What goes wrong:** The auto-fee-tier algorithm runs 4 single-hop quotes + 2 multi-hop quotes + 1 price-impact-tiny quote + 1 ERC-20 allowance read = 8 parallel `eth_call`s per `prepare_uniswap_swap` invocation. Free public RPCs (PublicNode) rate-limit at ~5/sec; a chatty agent burst-calling could hit the limit.
**Why it happens:** All `eth_call`s are independent; max parallelism feels like the right move.
**How to avoid:** `Promise.allSettled` (not `Promise.all`) so a single rate-limit error doesn't poison the batch; downgrade rate-limited tiers to `null` with the same handling as no-pool reverts. The `INVALID_INPUT + hintTool → request_capability` arm covers the edge case where ALL tiers rate-limited.
**Warning signs:** Intermittent INTERNAL_ERROR responses; user agents seeing different quote results on repeated calls.

### Pitfall 7: `slippageBps === 50` ambiguity (default vs explicit)
**What goes wrong:** Agent passes `slippageBps: 50` thinking they're being explicit. Zod's `.default(50)` would coerce omitted → 50, and the gate would treat "agent passed 50" identically to "agent omitted slippageBps".
**Why it happens:** Zod's `.default()` runs BEFORE the explicit-presence check.
**How to avoid:** Pre-Zod raw-args inspection (mirror Phase 20 SunSwap line 149-151 verbatim):
```typescript
const rawArgs = args as Record<string, unknown>;
const slippageWasExplicit: boolean =
  "slippageBps" in rawArgs && rawArgs.slippageBps !== undefined;
```
The check runs on the raw JSON-RPC input BEFORE Zod normalization.

### Pitfall 8: NonfungiblePositionManager address pre-fill for Phase 33
**What goes wrong:** Phase 32 D-01 reserves a SOT slot for `getUniswapV3NonfungiblePositionManagerAddress` but Phase 32 doesn't consume it. A planner might accidentally leave the slot unpopulated, causing Phase 33 to add it incrementally (rebase conflict).
**Why it happens:** Reserved-but-unused slots are easy to forget.
**How to avoid:** Plan 32-01 task lists the NFT manager address (`0xC36442b4a4522E871399CD717aBDD847Ab11FE88`) and pre-populates it. Phase 33 then consumes the existing slot.

---

## Code Examples

### Composed multicall-with-deadline encoding (Plan 32-03)

```typescript
// src/tools/prepare_uniswap_swap.ts — composeSwapCalldata helper
import { type Hex, parseAbi, encodeFunctionData } from "viem";
import {
  _uniswapV3Protocol,
  UNISWAP_V3_SELECTORS,
} from "../protocols/uniswap-v3.js";

function composeSwapCalldata(params: {
  readonly route: { hops: PathHop[]; strategy: "single-hop" | "multi-hop" };
  readonly tokenIn: Address;
  readonly tokenOut: Address;
  readonly recipient: Address;     // user, OR SwapRouter02 for ETH-out
  readonly amountIn: bigint;
  readonly amountOutMinimum: bigint;
  readonly deadline: bigint;
  readonly ethOutPath: boolean;    // true → append unwrapWETH9 sub-call
  readonly user: Address;          // for unwrapWETH9 recipient when ETH-out
  readonly swapRouter02: Address;
}): Hex {
  // Inner swap call (encoded as bytes for multicall)
  let innerSwap: Hex;
  if (params.route.strategy === "single-hop") {
    innerSwap = _uniswapV3Protocol.encodeExactInputSingle({
      tokenIn:           params.tokenIn,
      tokenOut:          params.tokenOut,
      fee:               params.route.hops[0]!.fee,
      recipient:         params.recipient,
      amountIn:          params.amountIn,
      amountOutMinimum:  params.amountOutMinimum,
      sqrtPriceLimitX96: 0n,
    });
  } else {
    const path = encodeV3Path(params.route.hops);
    innerSwap = _uniswapV3Protocol.encodeExactInput({
      path,
      recipient:         params.recipient,
      amountIn:          params.amountIn,
      amountOutMinimum:  params.amountOutMinimum,
    });
  }

  // ETH-out: append unwrapWETH9(amountOutMinimum, user) to the multicall
  const innerCalls: readonly Hex[] = params.ethOutPath
    ? [innerSwap, _uniswapV3Protocol.encodeUnwrapWeth9(params.amountOutMinimum, params.user)]
    : [innerSwap];

  return _uniswapV3Protocol.encodeMulticallWithDeadline(params.deadline, innerCalls);
}
```

### Quoter V2 fee-tier iteration (Plan 32-02)

```typescript
// src/chains/uniswap-v3.ts
import { type Address, type Hex } from "viem";
import { _publicClients } from "./registry.js";
import { _uniswapV3Protocol, QUOTER_V2_ABI } from "../protocols/uniswap-v3.js";
import { getUniswapV3QuoterV2Address } from "../config/contracts.js";

const FEE_TIERS: readonly (100 | 500 | 3000 | 10000)[] = [100, 500, 3000, 10000];

export interface SingleHopQuote {
  readonly fee: 100 | 500 | 3000 | 10000;
  readonly amountOut: bigint;
  readonly sqrtPriceX96After: bigint;
  readonly gasEstimate: bigint;
}

export async function quoteAllSingleHopFeeTiers(args: {
  readonly chainId: ChainId;
  readonly tokenIn: Address;
  readonly tokenOut: Address;
  readonly amountIn: bigint;
}): Promise<readonly (SingleHopQuote | null)[]> {
  const quoterAddr = getUniswapV3QuoterV2Address(args.chainId);
  if (quoterAddr === null) return FEE_TIERS.map(() => null);
  const client = _publicClients.getEvmClient(args.chainId);
  // Promise.allSettled — null sentinel on per-tier revert
  const results = await Promise.allSettled(
    FEE_TIERS.map((fee) =>
      client.readContract({
        address: quoterAddr,
        abi: QUOTER_V2_ABI,
        functionName: "quoteExactInputSingle",
        args: [{
          tokenIn:           args.tokenIn,
          tokenOut:          args.tokenOut,
          amountIn:          args.amountIn,
          fee,
          sqrtPriceLimitX96: 0n,
        }],
      }),
    ),
  );
  return results.map((r, i) =>
    r.status === "fulfilled"
      ? {
          fee:               FEE_TIERS[i]!,
          amountOut:         r.value[0],
          sqrtPriceX96After: r.value[1],
          gasEstimate:       r.value[3],
        }
      : null,
  );
}
```

### Sandwich-MEV gate (clone of Phase 20 — Plan 32-03)

See Pattern 1 in Architecture Patterns above. Verbatim clone of `src/tools/prepare_sunswap_swap.ts:142-160` + `:412-438`.

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| SwapRouter (V1) with `deadline` field in struct | SwapRouter02 — deadline DROPPED for gas; restored via `multicall(deadline, ...)` | 2021-12-14 (SwapRouter02 deployment) | Phase 32 D-10 wraps every swap in multicall-deadline; outer selector is `0x5ae401dc` |
| Quoter V1 (`quote` function) | Quoter V2 — revert-with-return-value pattern; nonpayable+eth_call | 2022-04 (Quoter V2 deployment at `0x61fF...B21e`) | Phase 32 D-04 uses Quoter V2; viem handles the revert pattern transparently |
| UniversalRouter (Permit2 + typed-data) | Phase 32 explicitly defers UniversalRouter | n/a (Phase 32 scope decision) | Phase 32 uses SwapRouter02 for clear-sign-readable calldata; UniversalRouter deferred to v3.x typed-data |

**Deprecated/outdated:**
- SwapRouter V1 (`0xE592427A0AEce92De3Edee1F18E0157C05861564`): still deployed and functional; Uniswap UI uses SwapRouter02 exclusively now. Phase 32 does NOT support V1 (KNOWN_SPENDERS keeps the V1 row as an informational spender-label entry only).
- Quoter V1: still deployed; superseded by Quoter V2 which provides `initializedTicksCrossed` + `gasEstimate` returns. Phase 32 uses V2 exclusively.

---

## Validation Architecture

> Required per `.planning/config.json` `workflow.nyquist_validation: true`.

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest 1.x (project current) |
| Config file | `vitest.config.ts` (project root) |
| Quick run command | `npx vitest run --reporter=basic <file>` |
| Full suite command | `npm test` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|--------------|
| UNI-01 | `get_uniswap_quote` returns single-hop best-tier quote with `outAmount > 0` for known liquid pair (e.g. USDC→WETH) | Component | `npx vitest run test/get-uniswap-quote.test.ts -t "single-hop happy path"` | ❌ Wave 0 |
| UNI-01 | `get_uniswap_quote` selects multi-hop ONLY when `multiHopOut > singleHopOut * 1.005` | Component | `npx vitest run test/get-uniswap-quote.test.ts -t "multi-hop tie-break threshold"` | ❌ Wave 0 |
| UNI-01 | `get_uniswap_quote` refuses with `INVALID_INPUT + hintTool: request_capability` when ALL tiers + multi-hop revert | Component | `npx vitest run test/get-uniswap-quote.test.ts -t "no-liquidity refusal"` | ❌ Wave 0 |
| UNI-01 | `get_uniswap_quote` `priceImpactBps` matches the Quoter-midpoint computation against pinned tiny-amount + full-amount fixtures | Contract | `npx vitest run test/signing-uniswap-price-impact.test.ts` | ❌ Wave 0 |
| UNI-02 | `prepare_uniswap_swap` returns handle + payloadFingerprint matching UNI-A literal for USDC→WETH single-hop | Contract | `npx vitest run test/prepare-uniswap-swap.test.ts -t "UNI-A fingerprint anchor"` | ❌ Wave 0 |
| UNI-02 | `prepare_uniswap_swap` returns handle + payloadFingerprint matching UNI-B literal for USDC→ETH multicall+unwrap | Contract | `npx vitest run test/prepare-uniswap-swap.test.ts -t "UNI-B fingerprint anchor"` | ❌ Wave 0 |
| UNI-02 | `prepare_uniswap_swap` returns handle + payloadFingerprint matching UNI-C literal for USDC→WETH→WBTC multi-hop | Contract | `npx vitest run test/prepare-uniswap-swap.test.ts -t "UNI-C fingerprint anchor"` | ❌ Wave 0 |
| UNI-02 | `prepare_uniswap_swap` refuses with `INVALID_INPUT + hintTool: prepare_token_approve` when allowance insufficient | Component | `npx vitest run test/prepare-uniswap-swap.test.ts -t "approval pre-flight refusal"` | ❌ Wave 0 |
| UNI-02 | Persona-cycle byte-identity: UNI-A/B/C fingerprints byte-identical across personas (proves `from`-independence) | Integration | `npx vitest run test/integration-uniswap-v3.test.ts` | ❌ Wave 0 |
| UNI-03 | `prepare_uniswap_swap` refuses with `SANDWICH_MEV_REFUSAL_ETHEREUM_TEMPLATE` when priceImpactBps > 200 AND slippageBps not explicit | Component | `npx vitest run test/prepare-uniswap-swap.test.ts -t "sandwich-MEV gate refusal"` | ❌ Wave 0 |
| UNI-03 | `prepare_uniswap_swap` PROCEEDS when priceImpactBps > 200 AND slippageBps IS explicit (any value) | Component | `npx vitest run test/prepare-uniswap-swap.test.ts -t "sandwich-MEV gate proceed-on-explicit"` | ❌ Wave 0 |
| UNI-10 | `T-UNISWAP-V3-SPENDER-DRIFT-1`: `KNOWN_SPENDERS_ETHEREUM` SwapRouter02 row address matches `getUniswapV3SwapRouter02Address(1)` | Contract | `npx vitest run test/config-contracts.test.ts -t "T-UNISWAP-V3-SPENDER-DRIFT-1"` | ❌ Wave 0 |
| UNI-10 | `CANONICAL_DISPATCH_TARGETS[1]` contains SwapRouter02 address | Contract | `npx vitest run test/canonical-dispatch.test.ts -t "Uniswap V3 SwapRouter02 in Ethereum allowlist"` | ❌ Wave 0 |
| UNI-10 | `CANONICAL_DISPATCH_TARGETS[1]` does NOT contain Quoter V2 address (read-only — never dispatched) | Contract | `npx vitest run test/canonical-dispatch.test.ts -t "Uniswap V3 Quoter V2 NOT in allowlist"` | ❌ Wave 0 |
| MEV-01 | Quoter-midpoint price-impact understatement documented in SECURITY.md §6 v2.4 addendum | Smoke | `grep "Quoter-midpoint" SECURITY.md` | ❌ Wave 0 |

### Sampling Rate

- **Per task commit:** `npx vitest run test/<changed-file>.test.ts -x` (fail-fast on first failure; ~5-10s per file)
- **Per wave merge:** `npm test` (full suite; ~60-90s on current codebase)
- **Phase gate:** `npm test` green before `/gsd-verify-work` runs

### Wave 0 Gaps

- [ ] `test/chains-uniswap-v3.test.ts` — covers Quoter V2 wrapper unit tests (single-hop iteration, parallel `Promise.allSettled`, no-pool null sentinel handling)
- [ ] `test/protocols-uniswap-v3.test.ts` — covers byte-identity ABI regressions (selector constants, encoder output byte-length, struct field-order regression)
- [ ] `test/signing-uniswap-path.test.ts` — covers path encoder fixtures (single-hop, 2-hop, 3-hop reject-empty-hops, intermediate-token continuity)
- [ ] `test/signing-uniswap-price-impact.test.ts` — covers price-impact math regressions (Quoter-midpoint algorithm, tiny-amount sub-base-unit handling, fairOut=0 edge case)
- [ ] `test/get-uniswap-quote.test.ts` — covers UNI-01 behaviors
- [ ] `test/prepare-uniswap-swap.test.ts` — covers UNI-02 + UNI-03 + UNI-07 (approval pre-flight) behaviors
- [ ] `test/integration-uniswap-v3.test.ts` — covers persona-cycle byte-identity
- [ ] EXTEND `test/signing-fingerprint.test.ts` — add UNI-A / UNI-B / UNI-C literal anchors (Plan 32-01 task)
- [ ] EXTEND `test/config-contracts.test.ts` — add `T-UNISWAP-V3-SPENDER-DRIFT-1`
- [ ] EXTEND `test/canonical-dispatch.test.ts` — add Uniswap V3 SwapRouter02 inclusion + Quoter V2 exclusion checks

Framework install: NONE — vitest already in project at v1.x.

---

## Security Domain

> Required per `.planning/config.json` `workflow.security_enforcement: true` + `security_asvs_level: 2`.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|------------------|
| V2 Authentication | NO | Phase 32 has no auth surface — WalletConnect session shared with Phase 4 |
| V3 Session Management | NO | Same as above |
| V4 Access Control | YES | `canonical-dispatch.ts` allowlist gate (Layer 0.5) — extended for SwapRouter02 per D-13 |
| V5 Input Validation | YES | Address validation via viem `getAddress`; decimal-aware amount parsing per CLAUDE.md; slippageBps range checks (1..10000); fee-tier whitelist (100/500/3000/10000); path-bytes intermediate-token continuity check |
| V6 Cryptography | YES | `payloadFingerprint` via keccak256 (Phase 4 FROZEN); NEVER hand-roll keccak (`@noble/hashes` via viem); domain-separator `"VaultPilot-txverify-v1:"` |
| V7 Error Handling | YES | Structured error envelopes via `makeStructuredError`; verbatim revert reasons surfaced (no error message swallowing); `INVALID_INPUT + hintTool` pattern for recoverable failures |
| V8 Data Protection | YES | NO private key material in Phase 32 codebase per CLAUDE.md; payloadFingerprint covers full multicall calldata so tampering is visible on-device |

### Known Threat Patterns for SwapRouter02 + EVM

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Sandwich-MEV (front-run + back-run swap) | Tampering, Information disclosure | D-08 gate at prepare time refuses when priceImpactBps > 200 AND slippage not explicit; clones Phase 20 + Phase 14 Jupiter precedent |
| Pending-tx replay (sign now, broadcast later when market moved) | Tampering | D-10 `multicall(uint256 deadline, bytes[] data)` wrapper enforces 10-min on-chain deadline |
| `amountOutMinimum` set to 0 (full slippage acceptance) | Tampering | Lower-bound `slippageBps >= 1` (0.01%) prevents amountOutMinimum == 0 |
| `recipient` mis-set to attacker address | Tampering | Server NEVER accepts agent-supplied recipient — always derives from the paired wallet + multicall internal routing for ETH-out |
| Pool-not-found silent fallthrough (wrong fee tier selected) | Repudiation | Quote auto-fee-tier algorithm enumerates ALL 4 tiers; refuses with `INVALID_INPUT` when all-revert; CHECKS PERFORMED surfaces selected tier verbatim |
| Approval-target spoofing (approve to attacker, not router) | Tampering | KNOWN_SPENDERS_ETHEREUM SwapRouter02 entry promoted to SOT-getter; T-UNISWAP-V3-SPENDER-DRIFT-1 enforces; canonical-dispatch allowlist filters non-router targets |
| Frontend tampered: agent passes mistaken `tokenIn` | Tampering | PREPARE RECEIPT block surfaces agent's raw args verbatim; user sees what the agent claimed; payloadFingerprint catches drift between PREPARE and SEND |
| ERC-7730 clear-sign bypass: SwapRouter02 multicall doesn't decode on-device | Information disclosure | LEDGER_NOTICE_UNISWAP_V3_TEMPLATE block (NEW) warns user; user is instructed to compare predicted hash against device |
| RPC midpoint manipulation (RPC returns biased tiny-amount quote) | Tampering | Documented residual risk in SECURITY.md §6 v2.4 addendum; Quoter-midpoint method is best-effort approximation, not load-bearing; sandwich-MEV refusal at >2% errs on the side of refusal |

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | The viem-computed selector `0x5ae401dc` for `multicall(uint256,bytes[])` is byte-identical to the on-chain SwapRouter02 selector | Topic 2 | If wrong: every Phase 32 transaction encodes against a non-existent selector and reverts. **Mitigated by Plan 32-01 byte-identity fixture UNI-A** — drift fails at the fingerprint literal. |
| A2 | Quoter V2 reverts (rather than returning 0) when the requested fee tier has no deployed pool | Topic 1 | If wrong (some RPCs return 0 instead): the auto-fee-tier algorithm would silently select a 0-output tier as "best". **Mitigated by treating amountOut == 0 as null in the algorithm** — Plan 32-02 task spec includes this guard. |
| A3 | The canonical multi-hop fee tiers (WETH/USDC=500, WETH/USDT=3000, etc.) remain stable through the v2.4 milestone window | Topic 10 | If wrong: multi-hop quotes return suboptimal output (still functional, just not optimal). Mitigated by D-04 step 4 — multi-hop ONLY selected if 0.5% better than single-hop, so a poorly-chosen multi-hop falls back to single-hop. |
| A4 | NonfungiblePositionManager address `0xC36442b4a4522E871399CD717aBDD847Ab11FE88` is correct for Ethereum mainnet | Topic 9 | If wrong: Phase 33 LP verbs would refuse at canonical-dispatch. **Mitigated by:** Phase 32 reserves the slot but does NOT add it to canonical-dispatch — Phase 33 picks up the SOT value AND verifies against on-chain at planning gate, so a typo is caught one phase out. |
| A5 | `tinyAmount = amountIn / 10000` is the appropriate scale for Quoter-midpoint reference (small enough that tick perturbation is negligible) | Topic 5 | If too small: tinyOut rounds to 0, divide-by-zero in priceImpactBps. **Mitigated by sub-base-unit fallback** (`if (tinyAmount === 0n) tinyAmount = amountIn;`) — Pitfall 5. If too large: midpoint reference itself has price impact, understating reported impact. Mitigated by D-08 2% threshold being conservative. |
| A6 | `SANDWICH_MEV_REFUSAL_ETHEREUM_TEMPLATE` clone of the TRON template is sufficient — Ethereum-flavored copy doesn't need additional fields | Topic 8 | If wrong: refusal block is missing context. Mitigated by template review at Plan 32-01 task review time. |
| A7 | The 4 standard Uniswap V3 fee tiers (100, 500, 3000, 10000) cover all liquid pools at v2.4 (no pool at a non-standard fee tier worth quoting) | Topic 1 | Confirmed by Uniswap Factory `feeAmountTickSpacing` mapping — only these 4 tiers can be activated by the factory; the assumption is structurally enforced on-chain. |
| A8 | Phase 32's locked CONTEXT.md fixture UNI-B `tokenOut: USDC` is a typo (semantically should be `tokenOut: WETH` for the ETH-out unwrap to make sense) | Topic 11 | If kept verbatim: UNI-B doesn't actually exercise the ETH-out path (USDC isn't unwrappable). **Researcher recommends planner confirm with user at Plan 32-01 task-design time.** Filed as Open Question 1. |

**Total assumptions:** 8. A1-A2, A4, A7 are LOW-risk (mitigated by fixture pinning or structural constraints). A3, A5, A6 are MEDIUM-risk (degraded UX, not security). A8 is the only assumption requiring user clarification.

---

## Open Questions

1. **UNI-B fixture `tokenOut` — `WETH` (recommended) vs `USDC` (CONTEXT.md verbatim)?**
   - What we know: CONTEXT.md D-15 reads `tokenOut: USDC, fee: 500, ... unwrapWETH9(amountOutMin, <persona>)`. But `unwrapWETH9` only makes sense if the inner swap output is WETH (so the router has WETH to unwrap).
   - What's unclear: whether the CONTEXT.md text contains a typo, or whether the user intends a 3-step multicall (swap to USDC + sell USDC for WETH + unwrap — vastly more complex and atypical).
   - Recommendation: planner should confirm with user at Plan 32-01 fixture-design step. Default recommendation: change `USDC` → `WETH` to match the canonical token→ETH receipt pattern documented in Uniswap docs.

2. **Should the `LEDGER_NOTICE_UNISWAP_V3_TEMPLATE` block (NEW) be conditional or unconditional?**
   - What we know: ALL Phase 32 transactions wrap in `multicall(deadline, [...])` per D-10; the outer selector `0x5ae401dc` is NOT in the ERC-7730 registry → all transactions blind-sign.
   - What's unclear: whether the planner should emit the NOTICE unconditionally (simpler — every prepare_uniswap_swap response gets it) or conditionally (more complex — guard against a future ERC-7730 multicall coverage extension).
   - Recommendation: emit unconditionally for v2.4. If future ERC-7730 coverage extends to `multicall(uint256,bytes[])`, a follow-up phase narrows the condition. Phase 6 WETH9.withdraw precedent did unconditional NOTICE.

3. **Should the price-impact-tiny-amount Quoter call run in the same `Promise.allSettled` batch as the main quote, or sequentially?**
   - What we know: both calls have the same RPC cost; parallel saves a round-trip.
   - What's unclear: whether RPC providers throttle "burst" calls more than spaced calls (degrading subsequent calls in the batch).
   - Recommendation: parallel `Promise.allSettled` batch for v2.4 simplicity; if rate-limit issues surface in user reports, follow-up phase introduces a back-off strategy. The Pitfall 6 mitigation (Promise.allSettled, null-on-rate-limit) covers the worst case.

4. **Should `prepare_uniswap_swap` support `tokenIn = "ETH" AND tokenOut = "ETH"` with explicit `same-token-swap-refused` refusal, or should it return `INVALID_INPUT` without an explicit refusal cause?**
   - What we know: D-05 says "refused at quote time".
   - What's unclear: whether the refusal cause string should literally be `same-token-swap-refused` (machine-readable) or just `INVALID_INPUT: 'ETH' input and 'ETH' output are the same token; no-op swap`.
   - Recommendation: short human-readable string in the `cause` field. Aligns with existing Phase 20 SunSwap practice.

5. **Should Phase 32 use the canonical NonfungiblePositionManager address from VERIFIED sources, or wait for Phase 33's research to confirm?**
   - What we know: `0xC36442b4a4522E871399CD717aBDD847Ab11FE88` is the canonical Ethereum mainnet address — referenced in dozens of Uniswap docs / Etherscan / verified contracts.
   - What's unclear: whether Phase 32 pre-populating the SOT slot is acceptable scope creep, vs. leaving it null and having Phase 33 add it.
   - Recommendation: Phase 32 pre-populates (lower friction for Phase 33; one-line addition). Plan 32-01 task includes a brief verification step against Etherscan.

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | Project runtime | ✓ | >= 18.17 | — |
| `viem` | All Phase 32 encoding | ✓ | 2.48.11 | — |
| Ethereum RPC (PublicNode or Alchemy/Infura) | Quoter V2 + ERC-20 allowance reads | ✓ (configured via `ETHEREUM_RPC_URL`) | — | `rpcDegraded` flag per READ-05 |
| `@noble/hashes` (transitive via viem) | keccak256 in payloadFingerprint | ✓ | (latest stable) | — |
| `vitest` | Tests | ✓ | 1.x | — |

**Missing dependencies with no fallback:** none.

**Missing dependencies with fallback:** Ethereum RPC may degrade for free-tier users — Phase 32 inherits the existing `rpcDegraded` envelope handling from `src/clients/`.

---

## Plan Breakdown

**Recommended: 3 plans.** Matches CONTEXT.md Claude's-Discretion option-A. Matches Phase 31's wave structure (31-01 foundation → 31-02/31-03 leaves). Each plan ~5-10 tasks. Single-plan-per-wave (no parallelism within a plan; plans 32-02 and 32-03 CAN run parallel after 32-01 lands per `.planning/config.json` `parallelization.plan_level: true`).

### Plan 32-01 — SOT + Decoder + Fixture Foundations

**Scope:** Single PR. All files needed for Plans 32-02 + 32-03 to compose against. Lands the SOT, the dispatch wiring, the decoder, the path encoder, and the fixture-pinning anchors in one cohesive change.

**Tasks (~8):**

1. Add `UniswapV3Contracts` interface + per-chain Ethereum slot to `src/config/contracts.ts` with 3 SOT getters (`getUniswapV3SwapRouter02Address`, `getUniswapV3QuoterV2Address`, `getUniswapV3NonfungiblePositionManagerAddress`).
2. Promote existing `KNOWN_SPENDERS_ETHEREUM` SwapRouter02 entry (line ~865) from inline literal to `getUniswapV3SwapRouter02Address(1)!`. Preserve label + source verbatim.
3. Add `T-UNISWAP-V3-SPENDER-DRIFT-1` regression test to `test/config-contracts.test.ts`.
4. Extend `CANONICAL_DISPATCH_TARGETS[1]` in `src/security/canonical-dispatch.ts` with `getUniswapV3SwapRouter02Address(1)`. Add `test/canonical-dispatch.test.ts` assertions (SwapRouter02 ∈; Quoter V2 ∉).
5. Create `src/protocols/uniswap-v3.ts`. Mirrors `src/protocols/eigenlayer.ts` shape:
   - `parseAbi` fragments: `SWAP_ROUTER_02_ABI`, `QUOTER_V2_ABI`, `UNWRAP_WETH9_ABI`, `MULTICALL_ABI` (with deadline overload)
   - Selector table: `UNISWAP_V3_SELECTORS = { exactInputSingle, exactInput, multicallWithDeadline, unwrapWETH9 }` (hardcoded literals)
   - Encoders: `encodeExactInputSingle`, `encodeExactInput`, `encodeUnwrapWeth9(amountMinimum, recipient)`, `encodeMulticallWithDeadline(deadline, calls)`
   - ESM spy-affordance: `_uniswapV3Protocol`
6. Create `src/signing/uniswap-path.ts`. Pure-bytes path encoder + interface `PathHop`. Regression test `test/signing-uniswap-path.test.ts` with pinned fixtures.
7. Create `src/protocols/uniswap-v3.ts` byte-identity regression test `test/protocols-uniswap-v3.test.ts`. Asserts selector constants match `viem.toFunctionSelector` output for the canonical signatures (defense against typo drift).
8. Add fixture UNI-A / UNI-B / UNI-C literals to `test/signing-fingerprint.test.ts`. Pinned `payloadFingerprint` literals per CLAUDE.md "NO beforeAll-snapshot" rule. Computed at task time using the new encoders from step 5.
9. Add `LEDGER_NOTICE_UNISWAP_V3_TEMPLATE` (NEW) + `SANDWICH_MEV_REFUSAL_ETHEREUM_TEMPLATE` (NEW) to `src/signing/blocks.ts`. Both templates are bare strings — no consumers wired yet (Plan 32-03 wires the sandwich one; Plan 32-03 wires the notice one too).

**Acceptance:** `npm test` green. Drift tests pass. Fixture literals pinned. SOT + dispatch + decoder + path encoder all available for downstream plans.

### Plan 32-02 — `get_uniswap_quote` Tool

**Scope:** Read-only tool. Auto-fee-tier iteration + multi-hop candidate routing + price-impact computation.

**Tasks (~6):**

1. Create `src/chains/uniswap-v3.ts` with `quoteAllSingleHopFeeTiers` (parallel `Promise.allSettled` over 4 tiers) + `quoteMultiHopCandidates` (WETH-anchored + USDC-anchored routes per Topic 10).
2. Create `src/signing/uniswap-price-impact.ts` with `computePriceImpactBps`. Regression test `test/signing-uniswap-price-impact.test.ts` with pinned fixtures (tiny-amount edge case, fairOut=0 edge case, normal case).
3. Create `src/tools/get_uniswap_quote.ts`. Description + INPUT_SCHEMA mirror `src/tools/get_sunswap_quote.ts` shape, swap TRON-specific fields for EVM (chain, EIP-55 addresses).
4. Implement auto-fee-tier algorithm (D-04 step 1-4). Multi-hop selected ONLY if 0.5% better than single-hop.
5. Implement all-tier-revert refusal (D-04a) — `INVALID_INPUT + hintTool: "request_capability"`.
6. Add `get-uniswap-quote.test.ts` covering UNI-01 behaviors. Cross-link UNI-A inputs from `signing-fingerprint.test.ts` to the quote test (assert envelope shape, not exact amountOut which shifts with mainnet state).

**Acceptance:** `npm test` green. Quote envelope shape stable. Auto-fee-tier algorithm deterministic against mocked Quoter V2 responses.

### Plan 32-03 — `prepare_uniswap_swap` Tool + Sandwich-MEV Gate

**Scope:** Write tool. Sandwich-MEV gate, token-approval pre-flight, multicall-deadline composition, ETH-in/ETH-out paths.

**Tasks (~8):**

1. Create `src/tools/prepare_uniswap_swap.ts`. Description + INPUT_SCHEMA mirror `src/tools/prepare_sunswap_swap.ts` shape.
2. Implement pre-Zod `slippageWasExplicit` detection (clone of Phase 20 verbatim).
3. Implement sandwich-MEV gate (D-08) using `SANDWICH_MEV_REFUSAL_ETHEREUM_TEMPLATE` from Plan 32-01.
4. Implement token-approval pre-flight (D-07) — reuse `src/protocols/erc20.ts` allowance reader; refuses with `INVALID_INPUT + hintTool: "prepare_token_approve"`.
5. Implement deadline computation (D-10) — `eth_getBlockByNumber("latest").timestamp + 600`.
6. Implement calldata composition (D-05) — `composeSwapCalldata` helper covers single-hop / multi-hop / ETH-in / ETH-out paths via `_uniswapV3Protocol` encoders.
7. Implement PREPARE RECEIPT (new template `PREPARE_RECEIPT_UNISWAP_V3_TEMPLATE` per CONTEXT.md D-09 — `Path`, `amountIn`, `amountOutMinimum`, `priceImpactBps`, `deadline` slots) + `LEDGER_NOTICE_UNISWAP_V3_TEMPLATE` block emission. Both blocks emit unconditionally in Phase 32 v2.4.
8. Extend `src/tools/preview_send.ts` DECODED ARGS dispatch: tuple `(tx.to === SwapRouter02, selector === 0x5ae401dc)` routes to a NEW Uniswap V3 arm that decodes the multicall, then recursively decodes each inner sub-call (exactInputSingle / exactInput / unwrapWETH9). Render `DECODED_ARGS_TEMPLATE_UNISWAP_V3_*` blocks (3 new templates — one per inner call shape; defines fields verbatim).
9. Add `prepare-uniswap-swap.test.ts` + `integration-uniswap-v3.test.ts` covering UNI-02 + UNI-03 + persona-cycle byte-identity.
10. Add SECURITY.md §6 v2.4 addendum (D-04b residual risk on Quoter-midpoint understatement + D-08 sandwich-MEV defense-in-depth + D-03 UniversalRouter deferral rationale). MEV-01 references Phase 32's gate as the canonical EVM-equivalent shipping vehicle.

**Acceptance:** `npm test` green. UNI-A/B/C fingerprints byte-identical across personas in integration test. SECURITY.md updated. `register-all.ts` registers both new tools.

### Why 3 plans (not 2 or 4)?

- **3 plans matches Phase 31's executed cadence** (3 plans: 31-01 SOT, 31-02 EigenLayer, 31-03 RocketPool + close-out). Phase 31 lands cleanly with this shape. Phase 32 inherits.
- **2 plans would conflate SOT + tools** — the Plan 32-01 foundation work is structurally distinct (touches `contracts.ts` + `canonical-dispatch.ts` + `blocks.ts` + new files). Splitting it from the tools keeps each PR's change surface narrow and reviewable.
- **4 plans (separate SOT from decoder; separate quote from sandwich-MEV)** would over-fragment — each plan would be <5 tasks and the PR-per-plan overhead dominates the implementation effort.
- **CONTEXT.md note:** "ROADMAP stub suggests 2 plans" — that stub is informational; CONTEXT.md Claude's-Discretion explicitly permits 3 (option A). 3 wins on review-cadence + clean-PR boundaries.

### Wave parallelism

`.planning/config.json` `parallelization.plan_level: true` + `min_plans_for_parallel: 2`. After Plan 32-01 merges, Plans 32-02 and 32-03 CAN dispatch in parallel because:
- Plan 32-02 touches: `src/chains/uniswap-v3.ts`, `src/signing/uniswap-price-impact.ts`, `src/tools/get_uniswap_quote.ts`, `src/tools/register-all.ts`, `test/chains-uniswap-v3.test.ts`, `test/signing-uniswap-price-impact.test.ts`, `test/get-uniswap-quote.test.ts`
- Plan 32-03 touches: `src/tools/prepare_uniswap_swap.ts`, `src/tools/preview_send.ts`, `src/tools/register-all.ts`, `src/signing/blocks.ts`, `test/prepare-uniswap-swap.test.ts`, `test/integration-uniswap-v3.test.ts`, `SECURITY.md`

**Conflict surface:** `src/tools/register-all.ts` is touched by both (each adds 1 import + 1 register call). Per CLAUDE.md global "Phase Resource-Intensive Parallel Work Sequentially" — `register-all.ts` is the merge point. Recommended: Plan 32-02 lands first (smaller change), Plan 32-03 rebases on top.

**Recommended dispatch:** sequential 32-02 → 32-03 to avoid the `register-all.ts` rebase friction. The wave-level parallel option is documented as available but not the default for Phase 32 cadence.

---

## Risks and Open Questions

1. **CONTEXT.md UNI-B typo (Open Question 1).** The fixture UNI-B input `tokenOut: USDC` cannot work with `unwrapWETH9` — semantically should be `WETH`. **Recommendation: planner asks user for sign-off on the correction at Plan 32-01 task-design time.** Researcher's default recommendation is to correct to `WETH` per the canonical token→ETH receipt pattern.

2. **ERC-7730 multicall coverage gap drives a NEW LEDGER NOTICE template (deviation from CONTEXT.md D-11).** CONTEXT.md D-11 stated "NO new block-emit templates needed beyond the sandwich-MEV refusal template." Researcher finding: D-10's multicall outer wrapper escalates ALL Phase 32 transactions to blind-sign on Ledger. **The planner MUST add `LEDGER_NOTICE_UNISWAP_V3_TEMPLATE`.** This is technically permitted by D-03 ("LEDGER NOTICE block emitted only if any selector falls back to blind-sign — Phase 6 WETH9.withdraw precedent") but contradicts D-11. **Surfaced as a CONTEXT.md gap, not a violation — the planner should add the template without asking for re-discussion.**

3. **NonfungiblePositionManager address pre-populated speculatively (A4).** Phase 32 doesn't consume it. If the address is wrong, Phase 33 would refuse at dispatch. Mitigated by Plan 32-01 verification step; risk is structurally one phase out.

4. **slopcheck false positive on `viem`.** `viem` is the canonical EVM TypeScript library (~5M weekly downloads, well-known maintainers) but slopcheck flags it as `[SUS]` (typosquat-near-`vue`). Documented for transparency; not actionable.

5. **Multi-hop fee-tier mapping is heuristic (Topic 10).** Live TVL distributions shift over time; today's WETH/USDT canonical at 0.30% might re-balance to 0.05% in 6 months. D-04 step 4's 0.5% improvement threshold provides defense-in-depth (suboptimal multi-hop falls back to single-hop), so the mapping being slightly off doesn't break functionality — just leaves some output on the table.

6. **No verification that NonfungiblePositionManager isn't an upgradeable proxy** that could change behavior post-deployment. Out of scope for Phase 32 (NPM isn't called by Phase 32); Phase 33 picks this up.

7. **Quoter V2's `nonpayable` declaration is incompatible with viem's `multicall` batch mode** (viem.publicClient.multicall batches multiple `eth_call`s using the Multicall3 contract; Multicall3 only batches `view` and `pure` functions, not `nonpayable`). Phase 32's `Promise.allSettled` workaround is FINE — but a planner who tries to "optimize" using `publicClient.multicall` would silently break.

---

## File List

Every file Phase 32 creates or modifies, with rationale:

### New files (created by Phase 32 — 8 files)

| File | Plan | Rationale |
|------|------|-----------|
| `src/protocols/uniswap-v3.ts` | 32-01 | ABI fragments + selectors + encoders for SwapRouter02 + Quoter V2. Mirrors `src/protocols/eigenlayer.ts`. |
| `src/signing/uniswap-path.ts` | 32-01 | Pure-bytes V3 path encoder. Pure-math separation per CLAUDE.md (mirrors `lido-rebase.ts`). |
| `src/signing/uniswap-price-impact.ts` | 32-02 | Pure-bigint price-impact computation (Quoter-midpoint method). |
| `src/chains/uniswap-v3.ts` | 32-02 | Quoter V2 client wrapper. Parallel fee-tier iteration + multi-hop candidates. |
| `src/tools/get_uniswap_quote.ts` | 32-02 | MCP tool — quote envelope. Mirrors `get_sunswap_quote.ts` shape. |
| `src/tools/prepare_uniswap_swap.ts` | 32-03 | MCP tool — unsigned swap tx. Mirrors `prepare_sunswap_swap.ts` shape. |
| `test/chains-uniswap-v3.test.ts` | 32-02 | Quoter V2 wrapper unit tests. |
| `test/protocols-uniswap-v3.test.ts` | 32-01 | Byte-identity ABI regressions. |
| `test/signing-uniswap-path.test.ts` | 32-01 | Path encoder fixtures. |
| `test/signing-uniswap-price-impact.test.ts` | 32-02 | Price-impact math regressions. |
| `test/get-uniswap-quote.test.ts` | 32-02 | UNI-01 behaviors. |
| `test/prepare-uniswap-swap.test.ts` | 32-03 | UNI-02 + UNI-03 + UNI-07 behaviors. |
| `test/integration-uniswap-v3.test.ts` | 32-03 | Persona-cycle byte-identity (`from`-independence). |

### Modified files (extended by Phase 32 — 6 files)

| File | Plan | Rationale |
|------|------|-----------|
| `src/config/contracts.ts` | 32-01 | Add `UniswapV3Contracts` interface + 3 SOT getters + Ethereum slot. Promote SwapRouter02 KNOWN_SPENDERS row. |
| `src/security/canonical-dispatch.ts` | 32-01 | Add SwapRouter02 to Ethereum allowlist. |
| `src/signing/blocks.ts` | 32-01 + 32-03 | Add `LEDGER_NOTICE_UNISWAP_V3_TEMPLATE` + `SANDWICH_MEV_REFUSAL_ETHEREUM_TEMPLATE` + 1 new PREPARE_RECEIPT_UNISWAP_V3 template + 3 new DECODED_ARGS_UNISWAP_V3 templates. |
| `src/tools/preview_send.ts` | 32-03 | Extend DECODED ARGS dispatch with tuple `(SwapRouter02, multicall-deadline-selector)` arm; recursive inner-call decoding. |
| `src/tools/register-all.ts` | 32-02 + 32-03 | Register `get_uniswap_quote` + `prepare_uniswap_swap`. |
| `test/signing-fingerprint.test.ts` | 32-01 | Add Fixture UNI-A / UNI-B / UNI-C hardcoded literals. |
| `test/config-contracts.test.ts` | 32-01 | Add `T-UNISWAP-V3-SPENDER-DRIFT-1`. |
| `test/canonical-dispatch.test.ts` | 32-01 | Add SwapRouter02-inclusion + Quoter V2-exclusion assertions. |
| `SECURITY.md` | 32-03 | §6 v2.4 addendum (Quoter-midpoint residual risk + sandwich-MEV defense-in-depth + UniversalRouter deferral). |

**Total: ~13 new files + ~9 modified files. Consistent with Phase 31's ~17-file footprint.**

---

## Sources

### Primary (HIGH confidence)

- [LedgerHQ/clear-signing-erc7730-registry — Uniswap V3 Router 02 metadata](https://github.com/LedgerHQ/clear-signing-erc7730-registry/blob/master/registry/uniswap/calldata-UniswapV3Router02.json) — ERC-7730 coverage verified for `exactInputSingle`, `exactInput`, `exactOutputSingle`, `exactOutput`, `swapExactTokensForTokens`, `swapTokensForExactTokens`. Multicall + unwrapWETH9 NOT covered.
- [github.com/Uniswap/v3-periphery — QuoterV2.sol source](https://github.com/Uniswap/v3-periphery/blob/main/contracts/lens/QuoterV2.sol) — `QuoteExactInputSingleParams` struct field order, mutability `nonpayable`, revert-with-return-value pattern.
- [github.com/Uniswap/swap-router-contracts — IV3SwapRouter.sol](https://github.com/Uniswap/swap-router-contracts/blob/main/contracts/interfaces/IV3SwapRouter.sol) — `ExactInputSingleParams` + `ExactInputParams` field ordering; no `deadline` in struct.
- [github.com/Uniswap/swap-router-contracts — IMulticallExtended.sol](https://github.com/Uniswap/swap-router-contracts/blob/main/contracts/interfaces/IMulticallExtended.sol) — 3 multicall overloads, deadline checkDeadline modifier.
- [github.com/Uniswap/v3-periphery — IPeripheryPayments.sol](https://github.com/Uniswap/v3-periphery/blob/main/contracts/interfaces/IPeripheryPayments.sol) — `unwrapWETH9(uint256,address)` 2-arg signature.
- [Etherscan SwapRouter02 contract page](https://etherscan.io/address/0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45) — verified contract; deployment date; ABI cross-check.
- [Etherscan Quoter V2 contract page](https://etherscan.io/address/0x61fFE014bA17989E743c5F6cB21bF9697530B21e) — verified contract; deployment date; ABI cross-check.
- viem `toFunctionSelector` invoked at research time (2026-05-23, in-project) — authoritative selectors for all 11 functions referenced by Phase 32.
- [Uniswap V3 Multihop Swaps guide](https://docs.uniswap.org/contracts/v3/guides/swaps/multihop-swaps) — packed-path encoding format.

### Secondary (MEDIUM confidence)

- [GeckoTerminal — WETH/USDC 0.05% pool on Ethereum](https://www.geckoterminal.com/eth/pools/0x88e6a0c2ddd26feeb64f039a2c41296fcb3f5640) — $103M TVL evidence for canonical multi-hop mapping.
- [GeckoTerminal — WETH/USDT 0.3% pool](https://www.geckoterminal.com/eth/pools/0x4e68ccd3e89f51c3074ca5072bbac773960dfa36) — $66M TVL evidence.
- [GeckoTerminal — WBTC/WETH 0.3% pool](https://www.geckoterminal.com/eth/pools/0xcbcdf9626bc03e24f779434178a73a0b4bad62ed) — $59M TVL evidence; 71% of pair's liquidity sits in 0.3% per Gamma Strategies analysis.
- [DefiLlama Uniswap V3 protocol page](https://defillama.com/protocol/uniswap-v3) — $3.8B v3 TVL late 2025.
- [Uniswap support article — Fee tiers](https://support.uniswap.org/hc/en-us/articles/20904283758349-What-are-fee-tiers) — canonical pair-to-fee-tier guidance (0.01% stable-stable, 0.05% stable-pegged, 0.30% volatile, 1.00% exotic).

### Tertiary (LOW confidence — informational)

- [Trail of Bits — Implement EIP-7730 today](https://blog.trailofbits.com/2025/08/27/implement-eip-7730-today/) — background on ERC-7730 ecosystem.
- [ERC-7730 EIP](https://eips.ethereum.org/EIPS/eip-7730) — spec.

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — viem 2.48.11 verified in-project + Phases 30/31 precedent.
- ABI / selectors: HIGH — computed via viem at research time; cross-verified against Etherscan + Uniswap source.
- ERC-7730 coverage: HIGH — direct fetch of registry JSON; gap for multicall/unwrapWETH9 explicit.
- Architecture / patterns: HIGH — mechanical clone of Phase 20 (sandwich-MEV) + Phase 30/31 (decoder + ESM spy + fixture pinning).
- Multi-hop fee-tier mapping: MEDIUM — informed by TVL inspection but TVL distributions shift; D-04 step 4's 0.5% threshold provides defense-in-depth.
- Pitfalls: HIGH — drawn from Phase 20/30/31 precedent + Topic 1-9 verification.
- UNI-B fixture typo (A8 + Open Question 1): MEDIUM — researcher recommends correction; planner should confirm with user.

**Research date:** 2026-05-23
**Valid until:** 2026-06-22 (30 days for stable Uniswap V3 contract surface; selector + ABI assumptions are stable across this window. Multi-hop fee-tier mapping may shift sooner — recommended re-verification at Plan 32-02 task time if researcher gate runs >7 days from this date.)
