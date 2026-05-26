# Phase 34: Curve swap + add liquidity — Research

**Researched:** 2026-05-26
**Domain:** Curve Finance StableSwap — legacy pools + stable_ng plain pools, Ethereum mainnet
**Confidence:** HIGH (ABI signatures verified against Vyper source; pool addresses verified from Curve API live snapshot; function selectors computed from viem.toFunctionSelector)

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Pool registry shape + curation**
- Location: `src/config/contracts.ts` — new `CurvePools` sub-table per chain, keyed by chain id. Matches existing curated-registry pattern (precedent: `KNOWN_SPENDERS_ETHEREUM`, `UniswapV3Contracts` from Phase 32, `AaveV3Contracts` from Phase 7).
- Coverage at v2.4: stETH/ETH legacy pool (`0xDC24316b9AE028F1497c275EB9192a3Ea0f67022`) + top-10 stable_ng plain pools by TVL on Ethereum at planning time.
- Per-pool fields: `address`, `abiVersion: "legacy" | "stable_ng"`, `coins: Address[]`, `coinDecimals: number[]`, `lpToken: Address`, `displayName: string`
- Spender allowlist: every Curve pool address MUST also be promoted to `KNOWN_SPENDERS_ETHEREUM`
- Canonical-dispatch wiring: new Curve arm in `src/security/canonical-dispatch.ts` keyed on pool addresses

**ABI generation dispatch**
- `legacy` ABI: `exchange(int128 i, int128 j, uint256 dx, uint256 min_dy) returns (uint256)` — payable for ETH-in (coin 0 = ETH sentinel on stETH pool)
- `stable_ng` ABI: `exchange(int128 i, int128 j, uint256 _dx, uint256 _min_dy, address _receiver) returns (uint256)` — NOT payable; server passes `_receiver = signer`
- Add-liquidity ABI (stable_ng only): `add_liquidity(uint256[] _amounts, uint256 _min_mint_amount) returns (uint256)` — NOT payable; dynamic-length amounts
- Selector-dispatch decoder in `src/protocols/curve.ts` for `preview_send`

**Slippage + amount handling**
- `slippageBps` mandatory on both tools (schema-level required; matches Phase 32 discipline)
- Swap `min_dy = (quotedDy * (10000 - slippageBps)) / 10000` — bigint, no float
- Add-liquidity `min_mint_amount = (quotedLpAmount * (10000 - slippageBps)) / 10000` — bigint, no float
- Decimal-string boundary: amounts via per-pool `coinDecimals` (NOT `get_token_metadata` round-trip)
- No sandwich-MEV refusal gate at v2.4

**`get_curve_positions` read-only tool**
- Per-wallet per-chain multicall LP-token `balanceOf(wallet)` across all registered pools
- Filter zero-balance pools
- READ-ONLY-by-construction invariant: no `createHandle` import in `src/tools/get_curve_positions.ts`

**Fixture anchors**
- Fixture CRV-A: legacy `exchange(int128 i, int128 j, uint256 dx, uint256 min_dy)` on stETH/ETH
- Fixture CRV-B: stable_ng `exchange(int128 i, int128 j, uint256 _dx, uint256 _min_dy, address _receiver)` with `_receiver = signer`
- Fixture CRV-C: stable_ng `add_liquidity(uint256[] _amounts, uint256 _min_mint_amount)` for a 3-coin pool

**Plan structure**
- Plan 34-01: `src/config/contracts.ts` Curve pool registry + KNOWN_SPENDERS promotion + canonical-dispatch Curve arm + `src/chains/curve.ts`
- Plan 34-02: `get_curve_positions` (LP-balance multicall + zero-filter + per-pool composition) + READ-ONLY grep guard
- Plan 34-03: `prepare_curve_swap` + `prepare_curve_add_liquidity` + `src/protocols/curve.ts` decoder + `preview_send` extension + Fixtures CRV-A/B/C

### Claude's Discretion
- Exact internal helper names (`CurvePoolReader`, `selectCurvePoolAbi`, `parseCurveAmounts`, etc.)
- Registry size at execute time (10 or 12 entries; researcher curates by TVL; planner may right-size)
- Fixture literal anchor values (deterministically computed at test-write time)
- Whether to extract a shared `bps-slippage.ts` helper if `parseAmountStrict`-shape duplication emerges

### Deferred Ideas (OUT OF SCOPE)
- 3-coin meta-pools + Curve metaregistry-driven discovery (issue #321)
- `prepare_curve_remove_liquidity` (single-side and balanced)
- Curve gauge staking + CRV claim flow
- Curve crypto / tricrypto pools
- LP USD pricing in `get_curve_positions`
- Multi-chain Curve (Polygon / Arbitrum / Base / Optimism)
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| CRV-01 | `get_curve_positions({ wallet, chain? })` returns Curve LP token balances + pool composition (stETH/ETH legacy + stable_ng plain pools only) | LP-token balanceOf multicall pattern; `lpToken` field in registry; per-pool `coins[]` composition |
| CRV-02 | `prepare_curve_swap({ chain, poolAddress, inputToken, outputToken, amount, slippageBps })` produces unsigned `exchange` call on named pool | ABI dispatch by `abiVersion`; `get_dy` quote; `min_dy` bigint derivation; selector table |
| CRV-03 | `prepare_curve_add_liquidity({ chain, poolAddress, amounts: [...], slippageBps })` produces unsigned `add_liquidity` call for stable_ng plain pools; pool addresses from curated registry; canonical-dispatch Curve arm | stable_ng `add_liquidity` ABI; `calc_token_amount` quote; registry-validated lengths |
</phase_requirements>

---

## Summary

Phase 34 ships three Curve tools on Ethereum mainnet. The central correctness challenge is Curve's per-pool ABI variance: the legacy stETH/ETH pool (`0xDC24316b9AE028F1497c275EB9192a3Ea0f67022`) and the stable_ng generation pools have different `exchange` signatures. The registry's `abiVersion` tag is the dispatch discriminator; the calldata byte-shape must be anchored with Fixtures CRV-A/B/C to catch regression.

The stable_ng `get_dy` and `calc_token_amount` exist directly on each pool contract as wrapper methods (they internally delegate to the shared `StableSwapViews` contract via `factory.views_implementation()`). The external call signatures `get_dy(int128 i, int128 j, uint256 dx) -> uint256` and `calc_token_amount(uint256[] _amounts, bool _is_deposit) -> uint256` are the same from the caller's perspective — no need to interact with the views contract directly. The legacy stETH pool also exposes `get_dy(int128 i, int128 j, uint256 dx) -> uint256` directly.

The `add_liquidity` verb is scoped to stable_ng only (legacy pools would require a fixed-size array ABI variant and ETH-payable handling; deferring is correct). The `prepare_curve_swap` tool must handle the legacy pool's ETH-in path: coin 0 = ETH sentinel (`0xEeeee...`), `exchange` is `@payable`, `tx.value = dx` when swapping coin 0 in.

LP token addresses: for stable_ng pools the pool IS its own LP token ERC-20 (the pool contract address === lpTokenAddress). For the legacy stETH/ETH pool the LP token is a separate ERC-20 at `0x06325440D014e39736583c165C2963BA99fAf14E`. Both confirmed from Curve API live snapshot.

**Primary recommendation:** Build the registry with 11 entries (1 legacy + 10 stable_ng), dispatch on `abiVersion`, quote on-chain via `get_dy` / `calc_token_amount`, encode calldata with viem `encodeFunctionData`, anchor byte-shapes with Fixtures CRV-A/B/C. No new npm packages needed — viem handles all encoding.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Pool registry + ABI dispatch | API / Backend (MCP server) | — | Registry lives in `src/config/contracts.ts`; dispatch logic in `src/protocols/curve.ts` |
| LP-token balance reads (multicall) | API / Backend | Database / Storage (on-chain RPC) | `get_curve_positions` reads on-chain balanceOf; no client-side state |
| Swap calldata composition | API / Backend | — | `prepare_curve_swap` encodes EVM calldata; no browser involvement |
| Add-liquidity calldata | API / Backend | — | `prepare_curve_add_liquidity` encodes; no browser involvement |
| Slippage quote (`get_dy`, `calc_token_amount`) | Database / Storage (on-chain RPC) | API / Backend | Read-only `eth_call` at prepare time; not cached from prior quote |
| Preview decode (`[CURVE SWAP]` block) | API / Backend | — | `src/protocols/curve.ts` selector-dispatch decoder in `preview_send.ts` |
| Canonical-dispatch allowlist gate | API / Backend | — | `src/security/canonical-dispatch.ts` Layer 0.5 — pool addresses in allowlist |
| Signing (payloadFingerprint + Ledger signing) | Ledger device | API / Backend (fingerprint compute) | Trust boundary is the device; server only computes + relays |

---

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| viem | ^2.48.0 (project-pinned) | `encodeFunctionData`, `parseAbi`, `readContract`, bigint arithmetic | Project CLAUDE.md mandated; already installed |

### Supporting (No New Packages — All Existing)
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| viem `encodeFunctionData` | same | Encode `exchange` / `add_liquidity` calldata | All Curve tx encoding |
| viem `parseAbi` | same | ABI fragment parse for selector computation | Per-abiVersion ABI structs in `src/chains/curve.ts` |
| viem `readContract` | same | `get_dy` / `calc_token_amount` / `coins(i)` / `balanceOf` calls | On-chain quote reads |

**No new npm packages.** Phase 34 is fully covered by viem already in the project. The `slopcheck` audit is therefore N/A for this phase — no external packages to install.

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Manual `parseAbi` fragments | `@curvefi/js` SDK | SDK is heavy, introduces slopsquatting risk, and Curve ABI is simple enough to declare inline — consistent with Phase 33 decision to hand-roll |
| Inline address literals | `src/config/contracts.ts` SOT | Inline literals violate CLAUDE.md format-fanout-sentinel discipline |

---

## Package Legitimacy Audit

**No new packages to install in Phase 34.** All encoding is handled by the project's existing `viem ^2.48.0`. Slopcheck run is not applicable.

| Package | Registry | Age | Downloads | Source Repo | slopcheck | Disposition |
|---------|----------|-----|-----------|-------------|-----------|-------------|
| viem | npm | 2+ yrs | 700K+/wk | github.com/wevm/viem | (existing) | Already installed — no re-audit needed |

**Packages removed due to slopcheck [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none

---

## Architecture Patterns

### System Architecture Diagram

```
Agent calls prepare_curve_swap / prepare_curve_add_liquidity
          │
          ▼ (MCP tool handler)
   src/tools/prepare_curve_*.ts
          │
          ├─► src/config/contracts.ts (CURVE_POOLS_RAW)
          │     Look up pool by poolAddress arg
          │     Resolve abiVersion + coins[] + coinDecimals[]
          │
          ├─► src/chains/curve.ts (RPC quote layer)
          │     get_dy(i, j, dx)           → quotedDy    (legacy + stable_ng — same sig)
          │     calc_token_amount([], true) → quotedLp    (stable_ng only)
          │     readContract via viem client (chainId=1)
          │
          ├─► src/protocols/curve.ts (calldata encoder)
          │     encodeExchange_legacy(i, j, dx, min_dy)
          │     encodeExchange_stableNg(i, j, dx, min_dy, receiver)
          │     encodeAddLiquidity_stableNg(amounts[], min_mint_amount)
          │
          └─► createHandle + computePayloadFingerprint + return

Agent calls preview_send(handle)
          │
          ▼ (Layer 0.5 — canonical-dispatch gate)
   src/security/canonical-dispatch.ts
          │  CANONICAL_DISPATCH_TARGETS[1].has(poolAddress) ?
          │
          ▼ (selector-dispatch decode for CHECKS PERFORMED)
   src/tools/preview_send.ts
          │  curveDecoded = _curveProtocol.decodeCurveCall(tx.data, tx.to)
          │
          └─► [CURVE SWAP] or [CURVE ADD LIQUIDITY] block

Agent calls get_curve_positions(wallet)
          │
          ▼
   src/tools/get_curve_positions.ts
          │  For each pool in CURVE_POOLS_RAW[1]:
          │    balanceOf(wallet) on pool.lpToken via readContract
          │  Filter zero-balance
          │
          └─► per-pool {lpBalance, coins[], ...} entries
```

### Recommended Project Structure

```
src/
├── config/contracts.ts         # CURVE_POOLS_RAW sub-table + KNOWN_SPENDERS additions
├── chains/curve.ts             # parseAbi structs + RPC read helpers (get_dy, calc_token_amount, balanceOf)
├── protocols/curve.ts          # Calldata encoders + selector-dispatch decoder for preview_send
├── security/canonical-dispatch.ts  # New Curve arm in buildPerChainAllowlist(1)
├── tools/get_curve_positions.ts    # Read-only LP balances (Plan 34-02)
├── tools/prepare_curve_swap.ts     # prepare_* tool (Plan 34-03)
└── tools/prepare_curve_add_liquidity.ts  # prepare_* tool (Plan 34-03)
```

### Pattern 1: ABI dispatch on `abiVersion` tag

**What:** The registry tags each pool with `abiVersion: "legacy" | "stable_ng"`. The prepare tool reads the tag and dispatches to the correct encoder. No heuristic probing at call time.

**When to use:** Every `prepare_curve_swap` call — never assume ABI from pool address alone.

```typescript
// Source: CONTEXT.md decisions + this research
if (pool.abiVersion === "legacy") {
  data = _curveProtocol.encodeExchangeLegacy({ i, j, dx: amountIn, minDy });
  valueWei = isEthIn ? amountIn : 0n;    // ETH-in path: tx.value carries ETH
} else {
  data = _curveProtocol.encodeExchangeStableNg({ i, j, dx: amountIn, minDy, receiver: fromAddress });
  valueWei = 0n;                          // stable_ng never payable
}
```

### Pattern 2: Input/output token resolution to `i`/`j` indices

**What:** User passes `inputToken` / `outputToken` addresses. Server resolves to `i`/`j` using `pool.coins.findIndex()`. If either token is not in the pool's `coins[]`, refuse with `INVALID_INPUT`.

**When to use:** `prepare_curve_swap` — never accept raw `int128` indices from the agent (worse UX, no self-validation).

```typescript
// Source: CONTEXT.md decisions (address-based ergonomic)
const i = pool.coins.findIndex(c => getAddress(c) === getAddress(inputToken));
const j = pool.coins.findIndex(c => getAddress(c) === getAddress(outputToken));
if (i === -1) throw errEnvelope("INVALID_INPUT", `inputToken not in pool coins[]`);
if (j === -1) throw errEnvelope("INVALID_INPUT", `outputToken not in pool coins[]`);
```

### Pattern 3: On-chain `get_dy` quote at prepare time (not cached)

**What:** Re-fetch quote at prepare time (never cached from a prior agent call). Same anti-drift discipline as Phase 32 UniV3 (`_uniswapV3Chain.quoteAllSingleHopFeeTiers` re-fetched at prepare).

```typescript
// Source: CONTEXT.md slippage discipline
const quotedDy = await client.readContract({
  address: pool.address,
  abi: CURVE_GET_DY_ABI,    // get_dy(int128, int128, uint256) view returns (uint256)
  functionName: "get_dy",
  args: [BigInt(i), BigInt(j), amountIn],   // NOTE: int128 encoded as bigint in viem
});
const minDy = (quotedDy * (10000n - BigInt(slippageBps))) / 10000n;
```

**Critical note:** `get_dy` exists on BOTH legacy and stable_ng pools with the same 3-param signature `(int128 i, int128 j, uint256 dx) -> uint256`. The stable_ng version delegates to the views contract internally, but the external call is identical. [VERIFIED: Vyper source curvefi/stableswap-ng + curvefi/curve-contract]

### Pattern 4: stable_ng `_receiver` discipline for `from`-independence

**What:** stable_ng `exchange` takes `_receiver address`. Server passes `_receiver = signerAddress` (derived from the resolved `from` field). This parallels Phase 7's `onBehalfOf = from` for Aave.

**Why it matters for fixtures:** Fixture CRV-B bytes are `from`-DEPENDENT (receiver embedded in calldata). Integration tests use the standard `FIXTURE_PERSONA` address from Phase 7 precedent (T-INTEGRATION-FROM-DRIFT shape).

```typescript
// Source: CONTEXT.md + Phase 7 Aave precedent
data = encodeExchangeStableNg({
  i: BigInt(i), j: BigInt(j),
  dx: amountIn, minDy,
  receiver: fromAddress,   // signer-derived, NOT hardcoded
});
// payloadFingerprint IS from-dependent for stable_ng (receiver in calldata)
```

### Pattern 5: LP-token `balanceOf` for `get_curve_positions`

**What:** Each pool entry has `lpToken: Address`. For stable_ng pools `lpToken === pool.address` (the pool is its own ERC-20). For the legacy stETH/ETH pool `lpToken` is a separate address (`0x06325440D014e39736583c165C2963BA99fAf14E`).

```typescript
// Source: Curve API live snapshot + CONTEXT.md
const balance = await client.readContract({
  address: pool.lpToken,       // separate ERC-20 for legacy; pool itself for stable_ng
  abi: [{ name: "balanceOf", type: "function", inputs: [...], outputs: [...] }],
  functionName: "balanceOf",
  args: [wallet],
});
```

### Anti-Patterns to Avoid

- **Probing ABI at call time:** Never call `coins(i)` at prepare time to detect `abiVersion` — use the registry tag. Heuristic probing at call time is slower, can fail for edge pools, and creates a new attack surface.
- **Floating-point slippage math:** Never `Number(quotedDy) * (1 - slippageBps/10000)` — use `(quotedDy * (10000n - BigInt(slippageBps))) / 10000n` in bigint throughout.
- **Cached quote reuse:** Never use the quote from a prior `get_curve_positions` or agent-side calculation. Re-fetch at prepare time to catch pool state drift.
- **Ignoring the ETH sentinel in the legacy pool:** `pool.coins[0] = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE"` is NOT a zero address or WETH address. When the user passes `inputToken = stETH` (coin 1) and `outputToken = ETH` (coin 0), the tool produces `j = 0` and the response must set `valueWei = 0n` (ETH-out, not ETH-in). Only when `i = 0` (ETH-in) should `valueWei = amountIn`.
- **Wrong `add_liquidity` ABI on legacy pool:** Legacy stETH/ETH pool `add_liquidity` takes a FIXED-SIZE `uint256[2]` array (not dynamic), is `@payable`, and requires ETH as value if amounts[0] > 0. Phase 34 defers add-liquidity for legacy entirely — `prepare_curve_add_liquidity` refuses on `abiVersion === "legacy"` with a structured error.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| ABI encoding for `exchange` / `add_liquidity` | Custom ABI encoder | `viem.encodeFunctionData` with `parseAbi` fragment | Handles int128 ↔ bigint coercion, tuple encoding, dynamic arrays |
| Selector computation | Manual keccak256 of signature | Pre-computed hardcoded hex literals in `CURVE_SELECTORS` table (verified against `viem.toFunctionSelector`) | Same pattern as UNISWAP_V3_SELECTORS; prevents silent selector drift |
| ERC-20 balance reads | Custom call builder | `viem.readContract` with `erc20Abi` or bespoke balanceOf ABI fragment | Handles ABI decode, handles zero-return edge cases |
| On-chain quote (`get_dy`) | Off-chain price approximation | `readContract` against pool with `CURVE_GET_DY_ABI` | Off-chain math diverges from actual pool AMM price; on-chain is the only source of truth |

**Key insight:** Curve ABI is simple enough to declare inline with `parseAbi` — no SDK needed. The complexity is in the ABI variance (legacy vs stable_ng) and the ETH-in path, both handled via the registry tag dispatch.

---

## Runtime State Inventory

> Omitted — Phase 34 is a greenfield tool-addition phase, not a rename/refactor/migration.

---

## Common Pitfalls

### Pitfall 1: stable_ng `get_dy` vs views contract confusion

**What goes wrong:** Developer reads the `StableSwapViews` interface in the Vyper source and concludes `get_dy` must be called on the views contract (with 4 params including `pool: address`). But the pool's own `get_dy` method takes 3 params and wraps the views call internally.

**Why it happens:** The Vyper source shows BOTH the pool-level `def get_dy(i, j, dx)` AND the `StableSwapViews` interface `def get_dy(i, j, dx, pool)` — easy to confuse.

**How to avoid:** Always call `get_dy` on the pool address itself. The pool-level ABI is `get_dy(int128 i, int128 j, uint256 dx) -> uint256`. The 4-param views-contract form is internal plumbing.

**Warning signs:** RPC error "wrong number of arguments" or "function not found" when calling on pool address → you're using the wrong ABI.

[VERIFIED: Vyper source at github.com/curvefi/stableswap-ng — `def get_dy(i, j, dx)` on pool delegates to views internally]

### Pitfall 2: Legacy stETH pool ETH-in requires `tx.value`

**What goes wrong:** Tool builds `exchange(0, 1, amountIn, minDy)` calldata but sets `valueWei = 0n`. The transaction reverts on-chain because the pool's `@payable exchange` checks `msg.value == dx` when `i == 0`.

**Why it happens:** The legacy pool uses native ETH (coin 0 = `0xEeeee...`) but the `exchange` signature doesn't carry `value` information in calldata — only in `tx.value`.

**How to avoid:**
```typescript
// When i === 0 on legacy pool (ETH-in)
valueWei = pool.abiVersion === "legacy" && i === 0 ? amountIn : 0n;
// ALSO: no ERC-20 approval pre-flight needed for ETH-in (no transferFrom)
```

**Warning signs:** On-chain revert from legacy pool when swapping ETH → stETH.

[VERIFIED: StableSwapSTETH.vy source via GitHub — `@payable` decorator on `exchange`; `msg.value` checked against `dx` when `i == 0`]

### Pitfall 3: LP token address — stable_ng pool IS its own LP token

**What goes wrong:** Developer assumes Curve always uses a separate LP token ERC-20 (like the legacy stETH pool does). Calls `balanceOf(wallet)` on the wrong address for stable_ng pools and gets zero silently.

**Why it happens:** The legacy stETH/ETH pool LP token (`0x06325440...`) is a SEPARATE ERC-20. But all stable_ng plain pools are self-LP — the pool contract address equals `lpTokenAddress` in the Curve API. The Vyper code confirms: `totalSupply` + `balanceOf` + ERC-20 methods are built into the pool.

**How to avoid:** Registry field `lpToken` is authoritative. For stable_ng pools this equals `pool.address`. For the legacy stETH pool this is `0x06325440D014e39736583c165C2963BA99fAf14E`. Always read from registry, never derive from pool address.

**Warning signs:** `get_curve_positions` always returns empty results for stable_ng pools — you're calling `balanceOf` on the wrong address.

[VERIFIED: Curve API live snapshot — `lpTokenAddress === address` for all stable_ng entries]

### Pitfall 4: `coinDecimals` drift vs on-chain `decimals()`

**What goes wrong:** Registry's `coinDecimals` is correct at time of writing, but a token's on-chain `decimals()` diverges (e.g. because the executor checked a different token). The `min_dy` derivation uses wrong precision → user gets unexpected slippage or the call reverts.

**Why it happens:** Mixed-decimal pools (e.g. PYUSD decimal=6, USDS decimal=18) are common in stable_ng. The Curve API `decimals` field comes from the token's `decimals()` view — it is reliable at snapshot time but must be locked in the registry.

**How to avoid:** At execute time, the executor MUST verify each pool's `coinDecimals[]` against on-chain `token.decimals()` for all pools in the registry. Add a test `T-CURVE-REGISTRY-DECIMALS-1` that calls `decimals()` on each coin and asserts equality to the registry literal.

**Warning signs:** `parseAmountStrict` returning unexpected wei amounts; on-chain `get_dy` quote inexplicably returning very high or very low values.

### Pitfall 5: `amounts.length` mismatch on `add_liquidity`

**What goes wrong:** User passes a 2-element `amounts` array for a 2-coin pool. Tool does not validate length against registry `coins.length`. If called on a 3-coin pool (or vice versa), the stable_ng `DynArray[uint256, MAX_COINS]` encoding passes viem validation but on-chain the pool's internal loop reads beyond the array or stops early, giving wrong LP amount.

**How to avoid:**
```typescript
if (rawAmounts.length !== pool.coins.length) {
  return errEnvelope("INVALID_INPUT",
    `amounts.length (${rawAmounts.length}) !== pool.coins.length (${pool.coins.length})`);
}
```

**Warning signs:** `calc_token_amount` returns 0 or the tx reverts with "wrong number of amounts".

### Pitfall 6: `min_mint_amount = 0` is a footgun

**What goes wrong:** If the server receives `slippageBps = 10000` (100% slippage), `min_mint_amount = 0`. On-chain this succeeds but the user could receive zero LP tokens in a sandwiched block.

**How to avoid:** Even though no MEV gate is applied for Curve stable pools, the server should still refuse `slippageBps > 5000` (50%) with a warning, consistent with existing slippage discipline. The CONTEXT.md says slippage is mandatory with no default — enforce the 1..10000 range.

**Warning signs:** LP balance unchanged after `prepare_curve_add_liquidity` executes.

### Pitfall 7: `from`-independence for CRV-B fixture

**What goes wrong:** Fixture CRV-B tests stable_ng `exchange` with `_receiver = FIXTURE_PERSONA`. If the executor uses a different persona address during test development, the hardcoded literal is wrong.

**How to avoid:** Fixture CRV-B must use `FIXTURE_PERSONA` address (Anvil account 1 — same address used by Phase 7 T-INTEGRATION-FROM-DRIFT). The test cross-link in `test/prepare-curve-swap.test.ts` re-anchors the fingerprint deterministically from the encoder, exactly matching the hardcoded literal.

---

## Code Examples

### exchange (legacy stETH/ETH pool)

```typescript
// Source: curvefi/curve-contract StableSwapSTETH.vy + viem toFunctionSelector
// Selector: 0x3df02124

const CURVE_LEGACY_EXCHANGE_ABI = parseAbi([
  "function exchange(int128 i, int128 j, uint256 dx, uint256 min_dy) payable returns (uint256)",
]);

const CURVE_LEGACY_GET_DY_ABI = parseAbi([
  "function get_dy(int128 i, int128 j, uint256 dx) view returns (uint256)",
]);

// Encode calldata
const data = encodeFunctionData({
  abi: CURVE_LEGACY_EXCHANGE_ABI,
  functionName: "exchange",
  args: [BigInt(i), BigInt(j), amountIn, minDy],   // int128 encoded as bigint
});

// tx.value for ETH-in (i === 0 on legacy pool):
const valueWei = i === 0 ? amountIn : 0n;
```

### exchange (stable_ng pool)

```typescript
// Source: curvefi/stableswap-ng CurveStableSwapNG.vy
// Selector: 0xddc1f59d

const CURVE_NG_EXCHANGE_ABI = parseAbi([
  "function exchange(int128 i, int128 j, uint256 _dx, uint256 _min_dy, address _receiver) returns (uint256)",
]);

const CURVE_NG_GET_DY_ABI = parseAbi([
  "function get_dy(int128 i, int128 j, uint256 dx) view returns (uint256)",
  // Same 3-param signature as legacy — pool delegates to views internally
]);

const data = encodeFunctionData({
  abi: CURVE_NG_EXCHANGE_ABI,
  functionName: "exchange",
  args: [BigInt(i), BigInt(j), amountIn, minDy, fromAddress],
});
// valueWei = 0n always (stable_ng exchange is not payable)
```

### add_liquidity (stable_ng only)

```typescript
// Source: curvefi/stableswap-ng CurveStableSwapNG.vy
// Selector (no receiver overload, 2-param form): 0xb72df5de
// Selector (with receiver overload, 3-param form): 0xa7256d09
// Use the 2-param form — server does not pass _receiver for add_liquidity
// (CONTEXT.md specifies no receiver for add_liquidity — locked)

const CURVE_NG_ADD_LIQUIDITY_ABI = parseAbi([
  "function add_liquidity(uint256[] _amounts, uint256 _min_mint_amount) returns (uint256)",
]);

const CURVE_NG_CALC_TOKEN_AMOUNT_ABI = parseAbi([
  "function calc_token_amount(uint256[] _amounts, bool _is_deposit) view returns (uint256)",
]);

// Quote
const quotedLp = await client.readContract({
  address: pool.address,
  abi: CURVE_NG_CALC_TOKEN_AMOUNT_ABI,
  functionName: "calc_token_amount",
  args: [parsedAmounts, true],  // true = deposit
});
const minMintAmount = (quotedLp * (10000n - BigInt(slippageBps))) / 10000n;

// Encode
const data = encodeFunctionData({
  abi: CURVE_NG_ADD_LIQUIDITY_ABI,
  functionName: "add_liquidity",
  args: [parsedAmounts, minMintAmount],
});
// valueWei = 0n (stable_ng add_liquidity not payable)
```

### Selector table (verified via viem.toFunctionSelector)

```typescript
// Source: computed at research time 2026-05-26 using Node.js viem
export const CURVE_SELECTORS = {
  /** Legacy exchange — stETH/ETH pool. selector = 0x3df02124 */
  exchangeLegacy: "0x3df02124" as Hex,
  /** stable_ng exchange with _receiver. selector = 0xddc1f59d */
  exchangeNg: "0xddc1f59d" as Hex,
  /** stable_ng add_liquidity (uint256[], uint256) — 2-param. selector = 0xb72df5de */
  addLiquidityNg: "0xb72df5de" as Hex,
  /** get_dy — same across legacy and stable_ng. selector = 0x5e0d443f */
  getDy: "0x5e0d443f" as Hex,
  /** calc_token_amount — stable_ng. selector = 0x3db06dd8 */
  calcTokenAmount: "0x3db06dd8" as Hex,
} as const;
```

---

## Curated Pool Registry (TOP-10 stable_ng + 1 legacy)

Data sourced from Curve API `api.curve.finance/v1/getPools/ethereum/factory-stable-ng` snapshot, 2026-05-26. [VERIFIED: Curve API live snapshot — executor MUST re-snapshot decimals at execute time and cross-check against on-chain `token.decimals()`]

**For stable_ng pools: `lpToken === pool.address` (pool IS its own LP ERC-20).**

### Legacy (1 entry)

| Pool | Address | coins[0] | coins[1] | LP Token |
|------|---------|---------|---------|---------|
| stETH/ETH (legacy) | `0xDC24316b9AE028F1497c275EB9192a3Ea0f67022` | ETH (`0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE`, 18) | stETH (`0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84`, 18) | `0x06325440D014e39736583c165C2963BA99fAf14E` (separate ERC-20) |

### stable_ng plain pools — Top-10 by TVL (2026-05-26 snapshot)

| Rank | Pool Name | Pool Address | coins[0] addr (sym, dec) | coins[1] addr (sym, dec) | LP Token | TVL |
|------|-----------|-------------|--------------------------|--------------------------|---------|-----|
| 1 | Spark.fi PYUSD Reserve | `0xA632D59b9B804a956BfaA9b48Af3A1b74808FC1f` | `0x6c3ea9036406852006290770BEdFcAbA0e23A0e8` (PYUSD, 6) | `0xdC035D45d973E3EC169d2276DDab16f1e407384F` (USDS, 18) | same as pool | ~$100M |
| 2 | RLUSD/USDC | `0xD001aE433f254283FeCE51d4ACcE8c53263aa186` | `0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48` (USDC, 6) | `0x8292Bb45bf1Ee4d140127049757C2E0fF06317eD` (RLUSD, 18) | same as pool | ~$74M |
| 3 | OETH/WETH | `0xcc7d5785AD5755B6164e21495E07aDb0Ff11C2A8` | `0x856c4Efb76C1D1AE02e20CEB03A2A6a08b0b8dC3` (OETH, 18) | `0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2` (WETH, 18) | same as pool | ~$59M |
| 4 | DOLA/sUSDe | `0x744793B5110f6ca9cC7CDfe1CE16677c3Eb192ef` | `0x865377367054516e17014CcdED1e7d814EDC9ce4` (DOLA, 18) | `0x9D39A5DE30e57443BfF2A8307A4256c8797A3497` (sUSDe, 18) | same as pool | ~$59M |
| 5 | FRAXUSDe | `0x5dc1BF6f1e983C0b21EfB003c105133736fA0743` | `0x853d955aCEf822Db058eb8505911ED77F175b99e` (FRAX, 18) | `0x4c9EDD5852cd905f086C759E8383e09bff1E68B3` (USDe, 18) | same as pool | ~$55M |
| 6 | PayPool | `0x383E6b4437b59fff47B619CBA855CA29342A8559` | `0x6c3ea9036406852006290770BEdFcAbA0e23A0e8` (PYUSD, 6) | `0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48` (USDC, 6) | same as pool | ~$51M |
| 7 | Spark.fi USDT Reserve | `0x00836Fe54625BE242BcFA286207795405ca4fD10` | `0xa3931d71877C0E7a3148CB7Eb4463524FEc27fbD` (sUSDS, 18) | `0xdAC17F958D2ee523a2206206994597C13D831ec7` (USDT, 6) | same as pool | ~$50M |
| 8 | apxUSD-USDC | `0xE1B96555BbecA40E583BbB41a11C68Ca4706A414` | `0x98A878b1Cd98131B271883B390f68D2c90674665` (apxUSD, 18) | `0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48` (USDC, 6) | same as pool | ~$40M |
| 9 | AUSD/USDC | `0xE79C1C7E24755574438A26D5e062Ad2626C04662` | `0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48` (USDC, 6) | `0x00000000eFE302BEAA2b3e6e1b18d08D69a9012a` (AUSD, 6) | same as pool | ~$25M |
| 10 | crvUSD/frxUSD | `0x13e12BB0E6A2f1A3d6901a59a9d585e89A6243e1` | `0xCAcd6fd266aF91b8AeD52aCCc382b4e165586E29` (frxUSD, 18) | `0xf939E0A03FB07F59A73314E73794Be0E57ac1b4E` (crvUSD, 18) | same as pool | ~$18M |

**Notes on the registry:**
- All 10 stable_ng pools confirmed as `isMetaPool: false` from the API — they are plain pools, not meta-pools.
- ETH sentinel in the legacy pool (`0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE`) is NOT the same as WETH. The prepare tool must special-case this for the payable ETH-in path.
- Executor MUST re-run the decimal cross-check at test time: `T-CURVE-REGISTRY-DECIMALS-1` calls `token.decimals()` on-chain for each coin and compares to registry.
- The AUSD token (`0x00000000eFE302BEAA2b3e6e1b18d08D69a9012a`) has an unusual zero-prefixed address — this is valid; use `getAddress()` checksum wrap at the literal site.

---

## canonical-dispatch wiring design

The new Curve arm in `buildPerChainAllowlist(chainId)` in `src/security/canonical-dispatch.ts` follows the established pattern (see Phase 31 EigenLayer multi-strategy arm):

```typescript
// Phase 34 — Curve pool dispatch arm (Ethereum only; stable_ng + legacy)
// Each pool address consumes ERC-20 tokens via transferFrom (approval target)
// AND is a dispatch target for exchange/add_liquidity (tx.to target).
// Non-ETH chains: getCurvePoolsForChain returns [] → spread adds nothing.
const curvePools = getAllCurvePoolsForChain(chainId);
const curveEntries: Address[] = curvePools.map(p => p.address);
// In the Set builder:
...curveEntries,
```

**KNOWN_SPENDERS_ETHEREUM** gets one entry per Curve pool — each pool address is a spender for ERC-20 approval pre-flight. Label format: `"Curve {pool.displayName}"`.

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Single StableSwap ABI (legacy only) | Two ABIs dispatched by `abiVersion` tag | stable_ng launched ~2023 | Exchange signature divergence: `_receiver` param added |
| `get_dy` on views contract (4 params) | `get_dy` on pool directly (3 params) | stable_ng launch | Pool wraps views internally; caller only needs 3-param ABI |
| LP token always a separate contract | stable_ng: LP token IS the pool contract | stable_ng launch | `lpTokenAddress === pool.address` for all factory-stable-ng pools |
| Fixed-size `uint256[N_COINS]` amounts | Dynamic `DynArray[uint256, MAX_COINS]` | stable_ng launch | Supports 2-8 coin pools without separate ABI per coin count |

**Deprecated/outdated:**
- The `exchange_underlying` function (Curve meta-pools) — deferred to v0.2 follow-up per CONTEXT.md.
- Calling the `StableSwapViews` contract address directly for `get_dy` — not needed; pool wraps it.

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | The legacy stETH/ETH pool `add_liquidity(uint256[2], uint256)` is payable — so Phase 34 correctly defers legacy `add_liquidity` (it would need different handling). | Architecture Patterns / Anti-Patterns | Low — add_liquidity for legacy is deferred entirely; no code path touches it |
| A2 | The top-10 stable_ng pool addresses listed from the 2026-05-26 API snapshot remain accurate at executor time | Pool Registry section | Medium — TVL shifts; executor should re-snapshot and adjust if any pool has lost significant TVL |
| A3 | The `add_liquidity` verb on stable_ng uses the 2-param form (no `_receiver`) rather than the 3-param `_receiver` overload | Code Examples | Low — CONTEXT.md locked decision says no `_receiver` for add_liquidity; the selector difference (0xb72df5de vs 0xa7256d09) means wrong overload = wrong calldata |

**If this table is empty:** Not applicable — see A1-A3 above. Most claims are VERIFIED but the top-10 pool list will drift with market conditions.

---

## Open Questions

1. **Legacy pool `add_liquidity` verification**
   - What we know: Legacy stETH/ETH `add_liquidity(uint256[2], uint256)` is payable with `msg.value` for amounts[0] (ETH). Phase 34 defers add-liquidity for legacy.
   - What's unclear: No code path is needed — this is confirmed deferred.
   - Recommendation: Plan 34-03 refuses `prepare_curve_add_liquidity` when `poolAddress` matches the legacy stETH pool with `INVALID_INPUT + "add_liquidity on legacy pools deferred to v2.4.x"`.

2. **Issue #321 (3-coin meta-pools)**
   - What we know: CONTEXT.md deferred section says `[#321](https://github.com/szhygulin/vaultpilot-mcp-gsd-inspired/issues/321)`. The issue number is plausible but not verified.
   - What's unclear: Whether the issue actually exists in the repo at that number.
   - Recommendation: Planner to file or verify issue #321 at plan-gate time. No impact on Phase 34 scope.

3. **stable_ng `_receiver` on `add_liquidity` — is it needed?**
   - What we know: The stable_ng source shows `add_liquidity` has an optional `_receiver: address = msg.sender` parameter. CONTEXT.md decision locks to using the 2-param form (no receiver). The selector for 2-param is `0xb72df5de`, for 3-param `0xa7256d09`.
   - What's unclear: Whether using the 2-param form on-chain always results in receiver = signer when the MCP sends the transaction via WalletConnect (Ledger is the signer so msg.sender = signer's address). Answer: yes — the MCP does not override `from`; the Ledger-signed tx comes with the user's `from` address, so `msg.sender = user` → receiver defaults to user. This is correct behavior.
   - Recommendation: Use 2-param form (no receiver in calldata). Simplifies calldata; `msg.sender` is the signer by construction.

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | Runtime | ✓ | OS-configured (project >= 18.17) | — |
| viem | ABI encoding, readContract | ✓ | ^2.48.0 (project dep) | — |
| Curve API (api.curve.finance) | Pool registry snapshot | ✓ (at research time) | Live JSON API | Hardcode from snapshot — executor re-verifies at execute time |
| Ethereum RPC | `get_dy` / `calc_token_amount` / `balanceOf` | ✓ | PublicNode public RPC (project configured) | — |

**Missing dependencies with no fallback:** None.

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | vitest ^2.1.0 |
| Config file | `vitest.config.ts` |
| Quick run command | `npx vitest run test/protocols-curve.test.ts test/signing-fingerprint.test.ts` |
| Full suite command | `npx vitest run` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| CRV-01 | LP-token balance reads, zero-filter, per-pool composition | unit | `npx vitest run test/get-curve-positions.test.ts -x` | ❌ Wave 0 |
| CRV-01 | Registry integrity: every pool's coinDecimals matches on-chain decimals() | unit | `npx vitest run test/config-contracts.test.ts -x` | ✅ (extend) |
| CRV-02 | Legacy exchange calldata + ETH-in valueWei | unit | `npx vitest run test/protocols-curve.test.ts -x` | ❌ Wave 0 |
| CRV-02 | stable_ng exchange calldata with receiver | unit | `npx vitest run test/protocols-curve.test.ts -x` | ❌ Wave 0 |
| CRV-02 | Fixture CRV-A hardcoded literal (legacy exchange) | unit | `npx vitest run test/signing-fingerprint.test.ts -x` | ✅ (extend) |
| CRV-02 | Fixture CRV-B hardcoded literal (stable_ng exchange) | unit | `npx vitest run test/signing-fingerprint.test.ts -x` | ✅ (extend) |
| CRV-03 | stable_ng add_liquidity calldata + amounts length validation | unit | `npx vitest run test/protocols-curve.test.ts -x` | ❌ Wave 0 |
| CRV-03 | Fixture CRV-C hardcoded literal (add_liquidity DynArray) | unit | `npx vitest run test/signing-fingerprint.test.ts -x` | ✅ (extend) |
| CRV-02,03 | Slippage math: min_dy / min_mint_amount bigint edge cases (slippageBps=1, slippageBps=9999) | unit | `npx vitest run test/protocols-curve.test.ts -x` | ❌ Wave 0 |
| CRV-02,03 | Token not-in-pool refusal (INVALID_INPUT) | unit | `npx vitest run test/prepare-curve-swap.test.ts -x` | ❌ Wave 0 |
| SEC | Canonical-dispatch: Curve pool addresses in allowlist; non-curve address still refused | unit | `npx vitest run test/security-canonical-dispatch.test.ts -x` | ✅ (extend) |

### Sampling Rate
- Per task commit: `npx vitest run test/protocols-curve.test.ts test/signing-fingerprint.test.ts`
- Per wave merge: `npx vitest run`
- Phase gate: Full suite green before `/gsd-verify-work`

### Wave 0 Gaps

- [ ] `test/protocols-curve.test.ts` — covers CRV-02/03 ABI encoding, selector literals, slippage math
- [ ] `test/get-curve-positions.test.ts` — covers CRV-01 LP balance reads + zero-filter
- [ ] `test/prepare-curve-swap.test.ts` — covers CRV-02 tool integration (mocked RPC)
- [ ] `test/prepare-curve-add-liquidity.test.ts` — covers CRV-03 tool integration (mocked RPC)

Existing files extended:
- `test/signing-fingerprint.test.ts` — Fixtures CRV-A, CRV-B, CRV-C hardcoded literals appended
- `test/config-contracts.test.ts` — T-CURVE-REGISTRY-DECIMALS-1 + T-CURVE-SPENDER-DRIFT-1 rows

---

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | — |
| V3 Session Management | no | — |
| V4 Access Control | yes | Canonical-dispatch allowlist (Layer 0.5) gates pool addresses; unknown pools refused |
| V5 Input Validation | yes | `poolAddress` must be in registry; `inputToken`/`outputToken` must be in pool's `coins[]`; `amounts.length` validated against `coins.length`; `slippageBps` in [1,10000] |
| V6 Cryptography | yes | `payloadFingerprint` computed over full calldata (including `min_dy`/`min_mint_amount`); fixtures CRV-A/B/C anchor byte-stable calldata |

### Known Threat Patterns for Curve

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Wrong pool ABI (legacy vs stable_ng mismatch) | Tampering | Registry `abiVersion` tag is load-bearing; Fixtures CRV-A + CRV-B anchor byte-shape per version |
| Fake pool address (non-registry pool injected by agent) | Tampering | Canonical-dispatch gate refuses any `tx.to` not in allowlist; unknown pool = DISPATCH_TARGET_REFUSED |
| Stale slippage / price manipulation | Spoofing | `get_dy` re-fetched at prepare time (not cached); no price from agent input |
| `min_dy = 0` via slippageBps=10000 | Tampering | `min_dy = 0` is detectable: server emits `CHECKS PERFORMED` block with exact min_dy value; preview block surfaces it verbatim; user + Ledger see the value |
| ETH-in path with wrong `valueWei` | Tampering | `payloadFingerprint` covers `valueWei`; drift between prepare and send triggers PREP-08 refusal |
| `_receiver` set to malicious address (stable_ng) | Spoofing | `_receiver` is ALWAYS server-derived from `fromAddress` (WC-paired signer); agent cannot inject an alternate receiver — the field is not agent-supplied |

---

## Sources

### Primary (HIGH confidence)
- [curvefi/stableswap-ng CurveStableSwapNG.vy](https://github.com/curvefi/stableswap-ng/blob/main/contracts/main/CurveStableSwapNG.vy) — stable_ng `exchange`, `add_liquidity`, `get_dy`, `calc_token_amount` signatures; confirms `_receiver` optional default `msg.sender`; confirms `get_dy` wraps views internally
- [curvefi/curve-contract StableSwapSTETH.vy](https://github.com/curvefi/curve-contract/blob/master/contracts/pools/steth/StableSwapSTETH.vy) — legacy stETH/ETH `exchange(int128,int128,uint256,uint256)` with `@payable`; `get_dy(int128,int128,uint256)`; coin 0 = ETH sentinel
- [Curve API live snapshot](https://api.curve.finance/v1/getPools/ethereum/factory-stable-ng) — top-10 stable_ng pools by TVL (2026-05-26); LP token addresses; coin addresses and decimals
- [Curve API main pools](https://api.curve.finance/v1/getPools/ethereum/main) — stETH/ETH legacy pool confirmation: address `0xDC24316b9AE028F1497c275EB9192a3Ea0f67022`, LP token `0x06325440D014e39736583c165C2963BA99fAf14E`
- viem.toFunctionSelector (computed locally at research time) — all 5 CURVE_SELECTORS verified

### Secondary (MEDIUM confidence)
- [curve.readthedocs.io exchange-pools](https://curve.readthedocs.io/exchange-pools.html) — legacy pool `get_dy(int128, int128, uint256)` and `add_liquidity(uint256[N_COINS], uint256)` signatures confirmed
- WebSearch result excerpt — stable_ng `exchange(int128 i, int128 j, uint256 _dx, uint256 _min_dy, address _receiver = msg.sender)` confirmed as plain-pool behavior

### Tertiary (LOW confidence)
- None — all major claims verified via source code or live API.

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — viem already installed; no new packages
- ABI signatures: HIGH — verified against Vyper source files
- Pool addresses + decimals: HIGH at snapshot time (2026-05-26); MEDIUM at execute time (TVL shifts)
- Architecture patterns: HIGH — follows Phase 32/33 UniV3 precedent exactly
- Pitfalls: HIGH — Pitfalls 1-3 verified from source; Pitfall 4-6 from code analysis

**Research date:** 2026-05-26
**Valid until:** 2026-06-09 (pool registry TVL will shift; re-snapshot before execute if > 2 weeks)
