# Phase 32: Uniswap V3 swap (auto-fee-tier, same-chain) — Pattern Map

**Mapped:** 2026-05-23
**Files analyzed:** 15 new + 7 modified = 22 total
**Analogs found:** 22 / 22 (every Phase 32 file has a direct prior-phase analog)

This phase is structurally a SIXTH-same-shape protocol-decoder phase (Aave → Compound → Morpho → Lido → EigenLayer → Rocket Pool → Uniswap V3). The mechanical-clone pattern is well-trodden. The NOVEL surfaces are: (1) path-bytes encoder (`src/signing/uniswap-path.ts`), (2) price-impact math (`src/signing/uniswap-price-impact.ts`), (3) multicall-deadline outer-wrapper composition (`src/protocols/uniswap-v3.ts`), (4) Quoter V2 fee-tier iteration via `Promise.allSettled` (`src/chains/uniswap-v3.ts`). Everything else clones prior-phase analogs verbatim.

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/protocols/uniswap-v3.ts` | protocol decoder | transform | `src/protocols/rocketpool.ts` + `src/protocols/lido.ts` | exact (multi-method protocol-decoder pattern + selector collisions) |
| `src/signing/uniswap-path.ts` | pure-bytes helper | transform | `src/signing/eigenlayer-shares.ts` + `src/signing/rocketpool-rate.ts` | role-match (pure-math separation; new shape — packed-bytes) |
| `src/signing/uniswap-price-impact.ts` | pure-bigint helper | transform | `src/signing/eigenlayer-shares.ts` | role-match (pure-bigint math; basis-points return) |
| `src/chains/uniswap-v3.ts` | chain client (Quoter wrapper) | request-response | `src/chains/rocketpool.ts` + `src/chains/lido.ts` | role-match (publicClient.readContract + Promise.all fan-out; new shape — `Promise.allSettled` for fee-tier iteration) |
| `src/tools/get_uniswap_quote.ts` | MCP tool (read-only quote) | request-response | `src/tools/get_sunswap_quote.ts` | exact (quote envelope + sandwich-MEV warning + Quote/null pattern) |
| `src/tools/prepare_uniswap_swap.ts` | MCP tool (write/prepare) | request-response | `src/tools/prepare_sunswap_swap.ts` + `src/tools/prepare_lido_wrap.ts` + `src/tools/prepare_eigenlayer_deposit.ts` | exact (sandwich-MEV gate + allowance pre-flight + ETH-out multicall) |
| `src/config/contracts.ts` (MODIFY) | SOT extension | config | Phase 30 Lido + Phase 31 EigenLayer/Rocket Pool extensions in same file | exact (interface + per-chain map + flat getters + KNOWN_SPENDERS promotion) |
| `src/security/canonical-dispatch.ts` (MODIFY) | security gate extension | request-response | Phase 30 Lido + Phase 31 EigenLayer/Rocket Pool arms in same file | exact (SOT-getter + `address(0)` filter + spread into Set) |
| `src/signing/blocks.ts` (MODIFY) | block templates | transform | `LEDGER_NOTICE_WETH_UNWRAP_TEMPLATE` (Phase 6) + `LEDGER_NOTICE_EIGENLAYER_DEPOSIT_TEMPLATE` (Phase 31) + `SANDWICH_MEV_REFUSAL_TRON_TEMPLATE` (Phase 20 cross-chain) | exact (string-template constants + buildDecodedArgs switch case) |
| `src/tools/preview_send.ts` (MODIFY) | MCP tool (dispatch) | request-response | Phase 31 Rocket Pool `(to, selector)` tuple dispatch additions | role-match (4 NEW selectors + multicall sub-call decoder is a new shape) |
| `src/tools/register-all.ts` (MODIFY) | registration | config | Phase 31 register-all additions | exact (2 import lines) |
| `test/signing-fingerprint.test.ts` (MODIFY) | fixture pin | test | Fixtures Z / AA-RP / AB-RP (Phase 31) | exact (hardcoded `0x…` literal per fixture; cross-link comment) |
| `test/protocols-uniswap-v3.test.ts` | unit test | test | `test/protocols-rocketpool.test.ts` + `test/protocols-eigenlayer.test.ts` | exact (byte-identity selector + encoder regressions) |
| `test/signing-uniswap-path.test.ts` | unit test | test | `test/signing-eigenlayer-shares.test.ts` | role-match (pure-math regression with pinned-byte fixtures) |
| `test/signing-uniswap-price-impact.test.ts` | unit test | test | `test/signing-eigenlayer-shares.test.ts` | role-match (pure-bigint math; edge-case coverage) |
| `test/chains-uniswap-v3.test.ts` | unit test | test | (no direct chain-client test for rocketpool in repo — closest is `test/get-rocketpool-positions.test.ts`) | role-match |
| `test/get-uniswap-quote.test.ts` | tool test | test | `test/preview-send.rocketpool.test.ts` shape | exact (tool-handler invocation + structured-content assertions + cross-link comment to fixture) |
| `test/prepare-uniswap-swap.test.ts` | tool test | test | `test/prepare-eigenlayer-deposit.test.ts` + `test/prepare-rocketpool-stake.test.ts` | exact (refusal arms + fixture cross-link) |
| `test/integration-uniswap-v3.test.ts` | integration test | test | `test/integration-eigenlayer-rocketpool.test.ts` | exact (persona-cycle byte-identity; FROZEN fixture FP constants; vi.hoisted + vi.mock chain registry) |
| `test/config-contracts.test.ts` (MODIFY) | test | test | Phase 31 `T-EIGENLAYER-SPENDER-DRIFT-1` + `T-ROCKETPOOL-SPENDER-DRIFT-1` | exact (one new test: `T-UNISWAP-V3-SPENDER-DRIFT-1`) |
| `SECURITY.md` (MODIFY) | docs | docs | Phase 28-31 §6 v2.4 addenda | role-match (new subsection on Quoter-midpoint residual risk + sandwich-MEV defense-in-depth) |

---

## Pattern Assignments

### `src/config/contracts.ts` (MODIFY — SOT extension + KNOWN_SPENDERS promotion)

**Closest analog:** Phase 31 EigenLayer + Rocket Pool extensions in this same file (`src/config/contracts.ts:441-700`).

**SOT-getter pattern** (mirror lines 414-416, 540-581, 666-687):

```typescript
// Phase 31 precedent (EigenLayer, RocketPool):
export function getEigenLayerStrategyManagerAddress(chainId: ChainId): Address | null {
  return EIGENLAYER_RAW[chainId]?.strategyManager ?? null;
}

export function getRocketPoolDepositPoolAddress(chainId: ChainId): Address | null {
  return ROCKETPOOL_RAW[chainId]?.depositPool ?? null;
}
```

**Per-chain interface + raw map pattern** (mirror lines 494-531):

```typescript
export interface EigenLayerContracts {
  strategyManager: Address;
  delegationManager: Address;
  strategies: Partial<Record<EigenLayerLst, Address>>;
  lstTokens: Partial<Record<EigenLayerLst, Address>>;
}

const EIGENLAYER_RAW: Partial<Record<ChainId, EigenLayerContracts>> = {
  1: {
    strategyManager: getAddress("0x858646372CC42E1A627fcE94aa7A7033e7CF075A"),
    delegationManager: getAddress("0x39053D51B77DC0d36036Fc1fCc8Cb819df8Ef37A"),
    ...
  },
};
```

**KNOWN_SPENDERS_ETHEREUM entry SOT-getter delegation** (lines 819-833 Phase 31 precedent):

```typescript
{
  address: getEigenLayerStrategyManagerAddress(1)!,
  label: "EigenLayer StrategyManager",
  source: "https://github.com/Layr-Labs/eigenlayer-contracts",
},
{
  address: getRocketPoolDepositPoolAddress(1)!,
  label: "Rocket Pool RocketDepositPool (stake — value-bearing)",
  source: "https://docs.rocketpool.net/",
},
```

**Current SwapRouter02 row to promote** (lines 864-868 — BEFORE Phase 32):

```typescript
{
  address: getAddress("0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45"),
  label: "Uniswap V3 SwapRouter02",
  source: "https://docs.uniswap.org",
},
```

**Adaptation notes:**
- Add `UniswapV3Contracts` interface with 3 fields: `swapRouter02`, `quoterV2`, `nonfungiblePositionManager` (the third is RESERVED for Phase 33 — pre-populate now per D-01).
- Add `UNISWAP_V3_RAW: Partial<Record<ChainId, UniswapV3Contracts>>` with only chainId=1 populated (Phase 32 Ethereum-only).
- Add 3 SOT getters: `getUniswapV3SwapRouter02Address`, `getUniswapV3QuoterV2Address`, `getUniswapV3NonfungiblePositionManagerAddress`.
- **Promote existing SwapRouter02 KNOWN_SPENDERS row** (lines 864-868): swap inline literal for `getUniswapV3SwapRouter02Address(1)!`. **DO NOT delete/re-add the row** (preserves array index + neighboring-row ordering). DO NOT add Quoter V2 to KNOWN_SPENDERS (read-only contract per D-13a).
- Cross-view test `T-UNISWAP-V3-SPENDER-DRIFT-1` enforces byte-identity (see `test/config-contracts.test.ts` section below).

**Critical to clone:**
- `getAddress("0x…")`-wrapping at the literal site (EIP-55 throws at module load on corruption).
- Comment block discipline (provenance + cross-SOT byte-identity invariants — research date 2026-05-23 + Etherscan verification).
- `Partial<Record<ChainId, …>>` shape (chains not in the map return `null`, NOT throw).
- Comment block on the promoted row explaining "promoted from inline literal to SOT-getter delegation per Phase 32 D-13a".

---

### `src/security/canonical-dispatch.ts` (MODIFY — Ethereum-arm extension)

**Closest analog:** Phase 30 Lido arm + Phase 31 EigenLayer/Rocket Pool arms in this same file (lines 134-185).

**Per-protocol entry pattern with `address(0)` filter** (lines 142-185):

```typescript
// Phase 30 Lido (lines 142-147):
const lidoSteth = getLidoStethAddress(chainId);
const lidoWsteth = getLidoWstethAddress(chainId);
const lidoWq = getLidoWithdrawalQueueAddress(chainId);
const lidoEntries: Address[] = [lidoSteth, lidoWsteth, lidoWq].filter(
  (a): a is Address => !!a && a !== "0x0000000000000000000000000000000000000000",
);

// Phase 31 Rocket Pool (lines 169-173):
const rocketDepositPool = getRocketPoolDepositPoolAddress(chainId);
const rocketReth = getRocketPoolRethAddress(chainId);
const rocketEntries: Address[] = [rocketDepositPool, rocketReth].filter(
  (a): a is Address => !!a && a !== "0x0000000000000000000000000000000000000000",
);

// Return set spread (lines 174-186):
return new Set<Address>([
  getAaveV3PoolAddress(chainId),
  getWethAddress(chainId),
  ONEINCH_V6_ROUTER_ALL_CHAINS,
  LIFI_DIAMOND_ALL_CHAINS,
  ...tokenContracts,
  ...compoundComets,
  ...morphoEntries,
  ...lidoEntries,
  ...eigenEntries,
  ...rocketEntries,
]);
```

**Adaptation notes:**
- Add import of `getUniswapV3SwapRouter02Address` (NOT Quoter V2 — D-13 read-only).
- Add the Phase 32 arm AFTER `rocketEntries` (preserve append-only ordering):

```typescript
const uniswapV3SwapRouter02 = getUniswapV3SwapRouter02Address(chainId);
const uniswapEntries: Address[] = uniswapV3SwapRouter02
  ? [uniswapV3SwapRouter02].filter(
      (a): a is Address => !!a && a !== "0x0000000000000000000000000000000000000000",
    )
  : [];
```

- Spread `...uniswapEntries` last in the returned Set.
- The `address(0)` filter is defense-in-depth even though SwapRouter02 has no zero-address sentinel by construction — preserves cross-protocol consistency.

**Critical to clone:**
- Comment block explaining "Quoter V2 NOT added — read-only per D-13; canonical-dispatch gates send-path only".
- Cross-protocol membership-count comment (~30 entries on Ethereum after Phase 32; add to existing line-203 comment block).
- DO NOT widen the `_canonicalDispatch` spy-affordance object — Phase 32 reuses the existing `checkDispatchTarget` indirection.

---

### `src/protocols/uniswap-v3.ts` (NEW — protocol decoder)

**Closest analog:** `src/protocols/rocketpool.ts` (multi-method + selector-collision warnings) + `src/protocols/lido.ts` (multi-contract, multi-method).

**Header + comment block pattern** (rocketpool.ts lines 1-65):

```typescript
// Rocket Pool protocol primitives — Phase 31 Plan 31-03 (RP-01 + RP-02).
//
// Single-file decoder covering the Rocket Pool write surface VaultPilot ships
// in v2.3:
//   - RocketDepositPool.deposit() payable        — ETH → rETH stake entry
//   - rETH.burn(uint256)                          — rETH → ETH unstake entry
//
// Function selectors VERIFIED via viem.toFunctionSelector at research time
// (31-RESEARCH § Topic 1, 2026-05-23):
//   RocketDepositPool.deposit():                          0xd0e30db0
//   rETH.burn(uint256):                                   0x42966c68
//
// SELECTOR COLLISION WARNINGS:
//   - Pitfall 1 — `0xd0e30db0` ALSO matches WETH9.deposit().
//   - Pitfall 2 — `0x42966c68` is the GENERIC ERC-20 Burnable extension selector.
//
// ESM spy-affordance: `_rocketPoolProtocol` wraps the encoders so tests can
// `vi.spyOn(_rocketPoolProtocol, "encodeRocketPoolDeposit")` without
// monkey-patching named exports.
```

**ABI fragment + selector constants + encoder pattern** (rocketpool.ts lines 104-218):

```typescript
export const ROCKET_DEPOSIT_POOL_ABI = parseAbi([
  "function deposit() payable",
  "function getBalance() view returns (uint256)",
]);

export const ROCKETPOOL_SELECTORS = {
  deposit: "0xd0e30db0" as Hex,
  burn: "0x42966c68" as Hex,
} as const;

export function encodeRocketPoolDeposit(): Hex {
  return encodeFunctionData({
    abi: ROCKET_DEPOSIT_POOL_ABI,
    functionName: "deposit",
    args: [],
  });
}
```

**ESM spy-affordance pattern** (rocketpool.ts lines 238-241):

```typescript
export const _rocketPoolProtocol = {
  encodeRocketPoolDeposit,
  encodeRocketPoolBurn,
};
```

**Adaptation notes:**
- Owns **5 encoder functions** (vs Rocket Pool's 2): `encodeExactInputSingle`, `encodeExactInput`, `encodeUnwrapWeth9`, `encodeMulticallWithDeadline`, and a `composeMulticallWithUnwrap` helper (centralizes ETH-out `recipient = router` discipline per Pitfall 3 mitigation).
- **6 hardcoded selectors** in `UNISWAP_V3_SELECTORS` (vs Rocket Pool's 2): `exactInputSingle: 0x04e45aaf`, `exactInput: 0xb858183f`, `multicallWithDeadline: 0x5ae401dc` (LOAD-BEARING — D-10), `unwrapWETH9: 0x49404b7c`, plus Quoter V2's `quoteExactInputSingle: 0xc6a5026a` + `quoteExactInput: 0xcdca1753`.
- **3 ABI fragments**: `SWAP_ROUTER02_ABI` (4 methods), `QUOTER_V2_ABI` (2 methods), `MULTICALL_DEADLINE_ABI` (separate fragment — `multicall(uint256 deadline, bytes[] data)` selector pinning per Pitfall 4).
- **Selector-collision section: `multicall(bytes[])` vs `multicall(uint256,bytes[])`** — Pitfall 4 warning prominent; the prepare-tool MUST use the deadline overload.
- `_uniswapV3Protocol` indirection covers all 5 encoders (mirror `_rocketPoolProtocol` shape).
- Path-bytes encoder lives in `src/signing/uniswap-path.ts` per researcher's pure-bytes separation rec (see CONTEXT.md Claude's Discretion); this file imports `encodeV3Path` and uses it inside `encodeExactInput`.

**Critical to clone:**
- HARDCODED VERIFIED LITERAL discipline for all 6 selectors — NEVER compute at runtime.
- "Consumed by" footer block listing every consumer file (5 entries: `src/chains/uniswap-v3.ts`, `src/tools/get_uniswap_quote.ts`, `src/tools/prepare_uniswap_swap.ts`, `src/tools/preview_send.ts`, `test/protocols-uniswap-v3.test.ts`).
- Re-export of SOT getters from `src/config/contracts.ts` for caller-locality (rocketpool.ts lines 79-86 precedent).
- Fixture cross-link comment in `encodeMulticallWithDeadline` JSDoc (Fixture UNI-A / UNI-B / UNI-C anchors).

---

### `src/signing/uniswap-path.ts` (NEW — pure-bytes helper)

**Closest analog:** `src/signing/eigenlayer-shares.ts` (pure-bigint helper with regression-test pinning) + `src/signing/rocketpool-rate.ts`.

**Header + ESM spy-affordance pattern** (eigenlayer.ts pattern):

```typescript
// ESM spy-affordance: `_uniswapV3Path` wraps the encoder so tests can
// `vi.spyOn(_uniswapV3Path, "encodeV3Path")` without monkey-patching the
// named export.
```

**RESEARCH § Topic 3 supplies the concrete encoder pattern** (using viem `encodePacked`):

```typescript
import { type Address, type Hex, encodePacked } from "viem";

export interface PathHop {
  readonly tokenIn: Address;
  readonly fee: 100 | 500 | 3000 | 10000;
  readonly tokenOut: Address;
}

export function encodeV3Path(hops: readonly PathHop[]): Hex {
  if (hops.length === 0) throw new Error("encodeV3Path: empty hops");
  for (let i = 1; i < hops.length; i++) {
    if (hops[i].tokenIn !== hops[i - 1].tokenOut) {
      throw new Error(
        `encodeV3Path: hop ${i} tokenIn does not match hop ${i - 1} tokenOut`,
      );
    }
  }
  const types: string[] = ["address"];
  const values: (Address | number)[] = [hops[0].tokenIn];
  for (const hop of hops) {
    types.push("uint24", "address");
    values.push(hop.fee, hop.tokenOut);
  }
  return encodePacked(types as readonly (`uint24` | `address`)[], values);
}

export const _uniswapV3Path = { encodeV3Path };
```

**Adaptation notes:**
- This is a NEW SHAPE (packed-bytes via `encodePacked`, NOT `encodeAbiParameters`). Pitfall 2 + anti-pattern 1: `encodeAbiParameters` produces word-padded output; `encodePacked` produces tight packed-bytes Uniswap requires.
- Intermediate-token continuity validation throws on mismatched hop boundaries (e.g. `[A→B, C→D]` throws; `[A→B, B→C]` passes).
- All addresses must be `Address` type (viem `getAddress`-checksummed input expected).
- Test `test/signing-uniswap-path.test.ts` pins canonical fixtures from RESEARCH § Topic 3:
  - `encodeV3Path([{USDC, 500, WETH}])` === `0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb480001f4c02aaa39b223fe8d0a0e5c4f27ead9083c756cc2`
  - `encodeV3Path([{USDC, 3000, WETH}, {WETH, 3000, WBTC}])` === `0x...000bb8...000bb8...` (66 bytes)

**Critical to clone:**
- ESM spy-affordance: `_uniswapV3Path` indirection at module footer (mirror `_rocketPoolProtocol` shape from rocketpool.ts:238-241) — `src/protocols/uniswap-v3.ts` calls through `_uniswapV3Path.encodeV3Path(...)`.
- Pinned fixture comment in JSDoc: "Reference fixture for cross-checking — see `test/signing-uniswap-path.test.ts`".

---

### `src/signing/uniswap-price-impact.ts` (NEW — pure-bigint math)

**Closest analog:** `src/signing/eigenlayer-shares.ts` (pure-bigint computation with edge-case handling) + `src/signing/rocketpool-rate.ts` (`computeEthEquivalent` shape).

**RESEARCH § Topic 5 supplies the algorithm:**

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

**Adaptation notes:**
- Pure-bigint math (no float arithmetic — anti-pattern 5 of RESEARCH).
- Edge case: `fairOut === 0n` → treat as 100% impact (`bps = 10000`).
- Edge case: `actualOut > fairOut` (RPC rounding noise) → floor at 0n.
- Edge case: `bps > 10000n` (RPC bug) → cap at 10000.
- Pitfall 5 (RESEARCH): `tinyAmount = amountIn / 10000` can produce 0 for sub-base-unit amounts; the CALLER (chains/uniswap-v3.ts) handles this fallback — this helper assumes `fairOut` is well-formed.
- Companion `_uniswapV3PriceImpact` indirection at module footer.

**Critical to clone:**
- Documented residual-risk JSDoc comment per RESEARCH Topic 5 ("UNDERSTATES impact on pools with extremely concentrated liquidity at the spot tick" + "mitigation = D-08's 2% sandwich-MEV refusal threshold").
- Test `test/signing-uniswap-price-impact.test.ts` pins edge cases: zero fair, equal-out (0 bps), drop (positive bps), > 100% (cap), negative drop (floor).

---

### `src/chains/uniswap-v3.ts` (NEW — Quoter V2 chain client)

**Closest analog:** `src/chains/rocketpool.ts` (Promise.all fan-out + SOT-resolved address + ESM spy-affordance) + `src/chains/lido.ts`.

**Pattern from rocketpool.ts lines 76-80:**

```typescript
import { type Address, type PublicClient } from "viem";

import { getRocketPoolRethAddress } from "../config/contracts.js";
import { RETH_ABI } from "../protocols/rocketpool.js";
import { _rocketPoolRate } from "../signing/rocketpool-rate.js";

export async function readEthereumPositions(
  client: PublicClient,
  wallet: Address,
): Promise<RocketPoolEthereumReadResult> {
  const rethAddr = getRocketPoolRethAddress(1)!;
  // ... Promise.all reads ...
}
```

**Adaptation notes — NEW SHAPE for fee-tier iteration:**
- **`Promise.allSettled` (not `Promise.all`)** for the 4 fee-tier quotes — anti-pattern 6: rate-limit error in one tier must not poison the batch; reverted tiers (no pool) treated as `null`.
- Each tier's `readContract` wrapped in `try { ... } catch { return null; }` per RESEARCH § Topic 1 ("any thrown error from viem (including 'contract function reverted' + RPC-level 'request failed') is treated as 'no pool at this tier'").
- Quoter V2 is `nonpayable` (NOT `view`) but viem's `readContract` handles the revert-with-return-value pattern correctly — NO manual `decodeErrorResult` plumbing.
- Multi-hop quote (`quoteExactInput(path, amountIn)`) runs in parallel with single-hop iteration; same `Promise.allSettled` discipline.
- Companion `_uniswapV3Chain` indirection (mirror `_rocketPoolChains` from rocketpool.ts line 16-18 comment).

**Critical to clone:**
- `client.readContract({ address, abi: QUOTER_V2_ABI, functionName: 'quoteExactInputSingle', args: [{ ... }] })` — viem's tuple-struct encoding handles the QuoterV2 `QuoteExactInputSingleParams` struct natively.
- **Pitfall 1 (RESEARCH § Topic 1): Quoter V2 struct field order is `(tokenIn, tokenOut, amountIn, fee, sqrtPriceLimitX96)` — DIFFERS from SwapRouter02's order**. The chain client uses Quoter V2's order; the prepare tool uses SwapRouter02's order. Drift between the two is a silent bug class — pinned fixture catches.

---

### `src/tools/get_uniswap_quote.ts` (NEW — read-only quote tool)

**Closest analog:** `src/tools/get_sunswap_quote.ts` (Phase 20) — same envelope structure, same `Quote | null` pattern, same MEV warning string at >2% impact.

**Tool description pattern** (get_sunswap_quote.ts lines 46-57):

```typescript
const DESCRIPTION = [
  "Get a SunSwap V2 quote on TRON for a token swap.",
  "Returns the expected output amount, price impact (basis points), route, and slippage tolerance.",
  "Quote source is always 'live' (on-chain getAmountsOut via TronGrid — no fallback snapshot).",
  "Use before prepare_sunswap_swap to get priceImpactBps and decide whether to explicitly supply slippageBps.",
  "When priceImpactBps > 200 (2%), you MUST pass slippageBps explicitly to prepare_sunswap_swap (sandwich-MEV defense per D-03b).",
  ...
].join(" ");
```

**Quote envelope + MEV warning string** (get_sunswap_quote.ts lines 246-261):

```typescript
const responseText = [
  "SUNSWAP V2 QUOTE (TRON)",
  `  inputToken:     ${rawInputToken}`,
  `  outputToken:    ${rawOutputToken}`,
  `  inAmount:       ${quote.inAmount.toString()} (raw, scaled per input token decimals)`,
  `  outAmount:      ${quote.outAmount.toString()} (raw, scaled per output token decimals)`,
  `  priceImpactBps: ${quote.priceImpactBps} (${(quote.priceImpactBps / 100).toFixed(2)}%)`,
  `  slippageBps:    ${quote.slippageBps}`,
  `  route:          ${quote.route.join(" → ")}`,
  `  source:         ${quote.source}`,
  "",
  quote.priceImpactBps > 200
    ? `⚠ Price impact (${(quote.priceImpactBps / 100).toFixed(2)}%) exceeds 2% sandwich-MEV threshold. ` +
      "Pass slippageBps explicitly to prepare_sunswap_swap to confirm acceptance."
    : "Price impact is within normal range (<= 2%).",
].join("\n");
```

**Adaptation notes:**
- Replace TRON-specific fields with EVM: `inputToken/outputToken` are agent-supplied EIP-55 addresses OR the `"ETH"` sentinel; `chain` is the required EVM chain arg (`"ethereum"` only at Phase 32).
- `route` is the V3 path representation: `[{ tokenIn, fee, tokenOut }, ...]` array (NOT TRON's flat address array). Display as `"USDC → 0.05% → WETH → 0.30% → WBTC"` (arrow-separated; fee-tier as middle node per D-09).
- Add `feeTier` field (single-hop) OR `strategy: "single-hop" | "multi-hop"` (per D-04 step 5).
- D-04a all-tiers-revert refusal: `INVALID_INPUT + hintTool: "request_capability"` with verbatim text ("no Uniswap V3 liquidity for {tokenIn}↔{tokenOut} at any standard fee tier; try a different DEX or check token symbols").
- Strip TRON-isms: no `findByAddress` from tron-top-25; resolve EVM token decimals via `get_token_metadata` (Phase 2 surface) per D-16 — but Phase 32 reads use `viem.erc20Abi.decimals` directly via `readContract` for the input token (matches Phase 7/30/31 pattern).
- Update MEV warning to point at `prepare_uniswap_swap` (not `prepare_sunswap_swap`).

**Critical to clone:**
- The `Quote | null` NEVER-throws contract from `chains/uniswap-v3.ts` — null surfaces as `INTERNAL_ERROR + cause "Uniswap quote unavailable"`.
- `bigint → string` at agent boundary (CLAUDE.md decimal-aware rule); structured `priceImpactBps` is `number` (basis-points integer, 0-10000).
- Schema includes `additionalProperties: false`.

---

### `src/tools/prepare_uniswap_swap.ts` (NEW — write/prepare tool)

**Closest analog:** `src/tools/prepare_sunswap_swap.ts` (sandwich-MEV gate flow + `slippageWasExplicit` boolean) + `src/tools/prepare_lido_wrap.ts` (token allowance pre-flight) + `src/tools/prepare_eigenlayer_deposit.ts` (multi-step refusal arms with `hintTool`).

**1. Pre-Zod `slippageWasExplicit` detection (LOAD-BEARING)** (prepare_sunswap_swap.ts lines 143-152):

```typescript
// -----------------------------------------------------------------------
// CRITICAL — Pre-Zod explicit-slippage detection (D-03b / D-03c / Test 9).
// Must happen BEFORE any default resolution. Zod's `.default(50)` would
// mask the distinction between agent-supplied and default. We check the
// RAW input object for `slippageBps` key presence.
// -----------------------------------------------------------------------
const rawArgs = args as Record<string, unknown>;
const slippageWasExplicit: boolean =
  "slippageBps" in rawArgs && rawArgs.slippageBps !== undefined;
```

**2. Sandwich-MEV gate (LOAD-BEARING)** (prepare_sunswap_swap.ts lines 412-438):

```typescript
if (quote.priceImpactBps > 200 && !slippageWasExplicit) {
  const mevRefusalBlock = SANDWICH_MEV_REFUSAL_TRON_TEMPLATE
    .replace("{PRICE_IMPACT_BPS}", String(quote.priceImpactBps))
    .replace(/{THRESHOLD_BPS}/g, "200");

  return {
    isError: true,
    content: [
      {
        type: "text",
        text:
          `error: sandwich-MEV defense triggered — price impact ${(quote.priceImpactBps / 100).toFixed(2)}% ` +
          `exceeds the 2% threshold.\n\n${mevRefusalBlock}`,
      },
    ],
    structuredContent: errEnvelope(
      "INVALID_INPUT",
      `price impact ${(quote.priceImpactBps / 100).toFixed(2)}% exceeds the 2% threshold; pass slippageBps explicitly to confirm acceptance of high price impact ...`,
      `priceImpactBps: ${quote.priceImpactBps}`,
      "get_sunswap_quote",
    ),
  };
}
```

**3. Token allowance pre-flight** (prepare_lido_wrap.ts lines 156-184):

```typescript
const client = getChainClient(chainId);
const allowance: bigint = await client.readContract({
  address: stethAddr,
  abi: erc20Abi,
  functionName: "allowance",
  args: [fromAddress, wstethAddr],
});

if (allowance < amountWei) {
  const insufficientMessage =
    `insufficient stETH allowance for WstETH wrap: ` +
    `approved ${formatUnits(allowance, 18)} stETH, need ${rawAmount} stETH. ` +
    `Call prepare_token_approve with the wstETH contract address as spender.`;
  return {
    isError: true,
    content: [
      { type: "text", text: `error: ${insufficientMessage}` },
    ],
    structuredContent: {
      ...errEnvelope("INVALID_INPUT", insufficientMessage),
      hintTool: "prepare_token_approve",
      hintArgs: {
        tokenAddress: stethAddr,
        spender: wstethAddr,
        amount: formatUnits(amountWei, 18),
      },
    },
  };
}
```

**4. Value-bearing tx composition** (prepare_rocketpool_stake.ts lines 234-254):

```typescript
const data: Hex = encodeRocketPoolDeposit();

const tx = {
  chainId,
  to: depositPoolAddr,
  valueWei: amountWei,  // <-- ETH-in case: tx.value = amountIn
  data,
};

const payloadFingerprint = computePayloadFingerprint(tx);

const handle = createHandle({
  args: {
    to: "",
    valueWei: amountWei.toString(),
    tokenAddress: depositPoolAddr,
    amount: rawAmount,
  },
  tx,
  payloadFingerprint,
});
```

**5. PREPARE RECEIPT + CHECKS PERFORMED + LEDGER NOTICE 3-block response** (prepare_eigenlayer_deposit.ts lines 351-388):

```typescript
const baseReceipt = EIGENLAYER_DEPOSIT_PREPARE_RECEIPT_TEMPLATE
  .replace("{CHAIN}", `ethereum (chainId 1)`)
  .replace("{STRATEGY_MANAGER}", strategyManagerAddr)
  .replace("{STRATEGY}", strategyAddr)
  .replace(/\{LST_SYMBOL\}/g, lst)
  .replace("{LST_TOKEN}", lstTokenAddr)
  .replace("{AMOUNT}", rawAmount);

const checksPerformed = [
  "CHECKS PERFORMED",
  `  decimal-strict amount parse:  OK (...)`,
  `  D-05 LST allowance pre-flight: OK (...)`,
  `  D-06 strategy cap pre-flight:  OK (...)`,
  `  ${SLASHING_RISK_LINE}`,
].join("\n");

return {
  content: [
    { type: "text", text: receipt },
    { type: "text", text: checksPerformed },
    { type: "text", text: LEDGER_NOTICE_EIGENLAYER_DEPOSIT_TEMPLATE },
  ],
  structuredContent: { ... },
};
```

**Adaptation notes:**
- **Sandwich-MEV refusal block name change:** `SANDWICH_MEV_REFUSAL_TRON_TEMPLATE` → new `SANDWICH_MEV_REFUSAL_ETHEREUM_TEMPLATE` in `src/signing/blocks.ts` (see blocks.ts section below).
- **`hintTool` value change:** `"get_sunswap_quote"` → `"get_uniswap_quote"`.
- **No TRON tronWeb / tronUtils** — use viem; resolve `from` via `resolveFrom` helper (Phase 30/31 precedent).
- **Approval pre-flight target:** for non-ETH `tokenIn`, spender = `SwapRouter02 address` (NOT Lido's wstETH spender).
- **ETH-in vs ETH-out branching** (NEW logic per D-05):
  - `tokenIn === "ETH"`: server resolves to WETH address for calldata; `tx.value = amountIn`; calldata = `multicall(deadline, [exactInputSingle(...)])`.
  - `tokenOut === "ETH"`: server resolves to WETH address for calldata; `tx.value = 0n`; calldata = `multicall(deadline, [exactInputSingle(..., recipient: router), unwrapWETH9(amountOutMin, user)])`.
  - Both: refuse at quote time (`same-token-swap-refused` hint per D-05).
- **Multicall-deadline wrapper EVERY swap** (D-10): calldata is always `encodeMulticallWithDeadline(deadline, [...])` — never a bare `exactInputSingle`. The `payloadFingerprint` covers the OUTER multicall calldata (D-12).
- **Deadline source:** `block.timestamp + 600` via `eth_getBlockByNumber("latest").timestamp` (NOT `Date.now()`); fall back to `Math.floor(Date.now() / 1000) + 600` on RPC failure.
- **LEDGER NOTICE is UNCONDITIONAL** (Phase 32 RESEARCH § Topic 7 finding): every Phase 32 tx blind-signs because the outer multicall selector `0x5ae401dc` is NOT in the ERC-7730 registry. Always emit `LEDGER_NOTICE_UNISWAP_V3_TEMPLATE`.
- **CHECKS PERFORMED additions per D-09:** `Path: USDC → 0.05% → WETH`, `amountIn`, `amountOutMinimum`, `priceImpactBps`, `deadline` (ISO timestamp).
- **`from`-INDEPENDENT fingerprint:** All three Phase 32 fixtures (UNI-A / UNI-B / UNI-C) are `from`-independent — calldata args carry the recipient (which is `user` for non-ETH-out, `router` for ETH-out's inner sub-call); the agent-supplied `from` is NOT in the preimage.

**Critical to clone:**
- Pre-Zod `slippageWasExplicit` detection — NEVER let Zod `.default(50)` mask the distinction.
- `errEnvelope` helper shape (from prepare_sunswap_swap.ts lines 65-80) — supports optional `hintTool` field.
- Quote re-fetch at PREPARE time (drift detection — anti-pattern 7 of RESEARCH: NEVER re-fetch quote inside `send_transaction`; only at prepare).
- `bigint → string` at agent boundary in `structuredContent`.

---

### `src/signing/blocks.ts` (MODIFY — 2 new templates + 4 new DECODED ARGS branches)

**Closest analog:** Phase 6 `LEDGER_NOTICE_WETH_UNWRAP_TEMPLATE` + Phase 31 `LEDGER_NOTICE_EIGENLAYER_DEPOSIT_TEMPLATE` + Phase 20 `SANDWICH_MEV_REFUSAL_TRON_TEMPLATE` (in `src/signing/blocks-tron.ts`).

**LEDGER NOTICE template pattern** (Phase 31 EigenLayer; blocks.ts:1801-1812):

```typescript
export const LEDGER_NOTICE_EIGENLAYER_DEPOSIT_TEMPLATE: string = [
  "LEDGER NOTICE",
  "  EigenLayer depositIntoStrategy is NOT covered by the Ledger Ethereum app's clear-sign plugins.",
  "  Your device will BLIND-SIGN this transaction (display a raw hash, no decoded args).",
  "  If your device refuses with \"Blind signing is not enabled\":",
  "    1. Open the Ethereum app on your device",
  "    2. Settings → Blind signing → Enabled",
  "    3. Retry send_transaction",
  "  After send_transaction fires, compare the PREDICTED hash below to the",
  "  value your hardware device displays — character-for-character. This",
  "  on-device match is the cryptographic anchor.",
].join("\n");
```

**SANDWICH_MEV refusal template pattern** (Phase 20 TRON; blocks-tron.ts:629-640):

```typescript
export const SANDWICH_MEV_REFUSAL_TRON_TEMPLATE: string = [
  "⚠ SANDWICH-MEV DEFENSE (TRON)",
  "  priceImpactBps: {PRICE_IMPACT_BPS}",
  "  threshold:      {THRESHOLD_BPS} (2% — sandwich extraction threshold per D-03b)",
  "",
  "  The swap's estimated price impact ({PRICE_IMPACT_BPS} bps) exceeds the {THRESHOLD_BPS} bps",
  "  sandwich-MEV defense threshold. This swap may be vulnerable to front-running.",
  "",
  "  To proceed: call get_sunswap_quote to review the route and expected output,",
  "  then call prepare_sunswap_swap again with slippageBps set explicitly (any value).",
  "  Explicitly supplying slippageBps signals that you acknowledge the high price impact.",
].join("\n");
```

**DECODED ARGS builder dispatch pattern** (blocks.ts:1743-1771 — Lido):

```typescript
export function buildLidoDecodedArgsBlock(decoded: LidoDecoded): string {
  switch (decoded.kind) {
    case "lido-stake":
      return DECODED_ARGS_TEMPLATE_LIDO_STAKE
        .replace("{STETH_CONTRACT}", decoded.contractAddress)
        .replace("{VALUE_ETH}", formatUnits(decoded.valueWei, STETH_DEC))
        .replace("{REFERRAL}", decoded.referral);
    case "lido-unstake": { ... }
    case "lido-wrap": { ... }
    case "lido-unwrap": { ... }
  }
}
```

**Adaptation notes — APPEND-ONLY additions (existing templates FROZEN):**

1. **Add `LEDGER_NOTICE_UNISWAP_V3_TEMPLATE`** (RESEARCH § Topic 7 / 32-RESEARCH lines 660-678) — clone of `LEDGER_NOTICE_EIGENLAYER_DEPOSIT_TEMPLATE` shape; copy mentions "Uniswap V3 swaps are submitted as a multicall(deadline, bytes[]) wrapper. The OUTER multicall selector is NOT covered by ...".

2. **Add `SANDWICH_MEV_REFUSAL_ETHEREUM_TEMPLATE`** (CONTEXT.md D-08; RESEARCH § Topic 8 lines 707-720) — clone of TRON template; replace `"TRON"` → `"Uniswap V3 — Ethereum mainnet"`, `"sandwich extraction threshold per D-03b"` → `"sandwich extraction threshold per D-08"`, `"front-running"` → `"front-running by MEV bots that bracket the transaction with buys/sells timed to extract value"`, `"get_sunswap_quote"` → `"get_uniswap_quote"`, `"prepare_sunswap_swap"` → `"prepare_uniswap_swap"`.

3. **Add `UNISWAP_SWAP_PREPARE_RECEIPT_TEMPLATE`** (CONTEXT.md D-09; mirror `EIGENLAYER_DEPOSIT_PREPARE_RECEIPT_TEMPLATE` shape) — slots: `{CHAIN}`, `{SWAP_ROUTER}`, `{TOKEN_IN}`, `{TOKEN_OUT}`, `{AMOUNT_IN}`, `{AMOUNT_OUT_MIN}`, `{FEE_TIER_OR_PATH}`, `{PRICE_IMPACT_BPS}`, `{SLIPPAGE_BPS}`, `{DEADLINE}`.

4. **Add 4 DECODED ARGS templates** for `preview_send` selector dispatch:
   - `DECODED_ARGS_TEMPLATE_UNISWAP_EXACT_INPUT_SINGLE` — inner sub-call display.
   - `DECODED_ARGS_TEMPLATE_UNISWAP_EXACT_INPUT` — inner sub-call display with decoded path.
   - `DECODED_ARGS_TEMPLATE_UNISWAP_MULTICALL` — outer wrapper display (lists sub-calls).
   - `DECODED_ARGS_TEMPLATE_UNISWAP_UNWRAP_WETH9` — ETH-out sub-call display.

5. **Add `buildUniswapV3DecodedArgsBlock(decoded: UniswapV3Decoded): string`** helper — switch on `decoded.kind` (`"exactInputSingle"` / `"exactInput"` / `"multicall"` / `"unwrapWETH9"`).

**Critical to clone:**
- APPEND-ONLY discipline — all prior templates stay BYTE-IDENTICAL (FROZEN).
- Multi-line `.join("\n")` const pattern (no template-literal with backticks — easier to grep for placeholder slots).
- `{PLACEHOLDER}` slot convention with explicit JSDoc listing every slot above the const.
- Comment marker `// =============================================================================\n// Phase 32 — Plan 32-X additive extensions (APPEND-ONLY).`

---

### `src/tools/preview_send.ts` (MODIFY — `(to, selector)` tuple dispatch extension)

**Closest analog:** Phase 31 Rocket Pool's `(to, selector)` tuple dispatch additions to `preview_send.ts` (selector collision: `0xd0e30db0` matches both `RocketDepositPool.deposit` and `WETH9.deposit`).

**Pattern from Phase 31 (preview_send extension):**
- Route on `(record.tx.to === <SOT-resolved address>, selector === <hardcoded literal>)` TUPLE.
- The canonical-dispatch allowlist Set is selector-blind by design.
- Disambiguates protocol-specific DECODED ARGS arm + LEDGER NOTICE emission.

**Adaptation notes:**
- Add 4 new selector arms for `to === getUniswapV3SwapRouter02Address(1)`:
  - `selector === "0x04e45aaf"` → `exactInputSingle` decoded args.
  - `selector === "0xb858183f"` → `exactInput` decoded args (decode + display path).
  - `selector === "0x5ae401dc"` → `multicall(deadline, bytes[])` outer wrapper; recurse to decode each inner sub-call.
  - `selector === "0x49404b7c"` → `unwrapWETH9` (only appears as multicall sub-call; standalone direct call is also valid).
- The **multicall sub-call decoder is a NEW shape** — `bytes[]` inner-call array. Use `decodeFunctionData({ abi: MULTICALL_DEADLINE_ABI, data })` to extract the `bytes[]` arg, then recursively decode each sub-call via the same `(to, selector)` dispatch.
- Emit `LEDGER_NOTICE_UNISWAP_V3_TEMPLATE` UNCONDITIONALLY for any Uniswap V3 SwapRouter02-targeted call (RESEARCH § Topic 7 — outer multicall selector blind-signs).

**Critical to clone:**
- `(to, selector)` TUPLE routing — NEVER selector-only (would cross-mis-route on collisions like 0x5ae401dc which is the canonical multicall-with-deadline selector across many Uniswap-family contracts).
- Existing preview_send.ts layer-0.5 dispatch-target check (Phase 9) — FROZEN; just add new selector arms below the existing handler chain.

---

### `src/tools/register-all.ts` (MODIFY — 2 new tool imports)

**Closest analog:** Phase 31 register-all additions (lines for prepare_rocketpool_stake / prepare_rocketpool_unstake / prepare_eigenlayer_deposit).

**Pattern** (existing register-all.ts line shape):

```typescript
import "./prepare_lido_wrap.js"; // Phase 30 Plan 30-03 (LIDO-W-03)
import "./prepare_eigenlayer_deposit.js"; // Phase 31 Plan 31-02 (EIG-02)
import "./prepare_rocketpool_stake.js"; // Phase 31 Plan 31-03 (RP-02 stake)
```

**Adaptation notes:**
- Append 2 lines:
  ```typescript
  import "./get_uniswap_quote.js"; // Phase 32 Plan 32-02 (UNI-01)
  import "./prepare_uniswap_swap.js"; // Phase 32 Plan 32-03 (UNI-02)
  ```
- Place them in the "Phase 31+ writes" block (alphabetical / phase-ordered per existing convention).

**Critical to clone:**
- Comment suffix tagging the plan + req IDs.
- Use `.js` extension in import (ESM TS convention).

---

### `test/signing-fingerprint.test.ts` (MODIFY — 3 new fixture pins)

**Closest analog:** Fixture Z (lines 424-453) + Fixture AA-RP (lines 455-492) + Fixture AB-RP (lines 494-527) from Phase 31.

**Fixture pin pattern** (Fixture Z, lines 424-453):

```typescript
it("Fixture Z — StrategyManager.depositIntoStrategy(stETH-Strategy, stETH, 1e18) fingerprint (hardcoded literal anchor, Phase 31 Plan 31-02)", () => {
  // EigenLayer Phase 31 canonical anchor: stETH-Strategy deposit of 1 stETH.
  // Inputs resolved via SOT getters (NEVER inlined per CLAUDE.md).
  const strategyManager = getEigenLayerStrategyManagerAddress(1)!;
  const strategy = getEigenLayerStrategyAddress(1, "stETH")!;
  const lstToken = getEigenLayerLstTokenAddress(1, "stETH")!;
  const amountWei = 1_000_000_000_000_000_000n; // 1 stETH

  const data = encodeDepositIntoStrategy(strategy, lstToken, amountWei);
  // 100 bytes = 4-byte selector (0xe7a050aa) + 3 × 32-byte words (strategy, token, amount).
  expect(data.length).toBe(202);
  expect(data.slice(0, 10).toLowerCase()).toBe("0xe7a050aa");

  const fp = computePayloadFingerprint({
    chainId: 1,
    to: strategyManager,
    valueWei: 0n, // deposit is NOT payable; LST consumed as ERC-20
    data,
  });

  // Hardcoded literal — computed at write-time (2026-05-23) per CLAUDE.md
  // "NO `beforeAll`-snapshot" rule. Drift in preimage assembly for any of
  // {STRATEGY_MANAGER, stETH-Strategy, stETH token, 1e18, encodeDepositIntoStrategy
  // shape, computePayloadFingerprint shape} fails THIS exact assertion.
  //
  // Fixture Z cross-link: test/prepare-eigenlayer-deposit.test.ts re-anchors
  // via this literal; future integration tests will re-anchor across persona
  // swaps (proves `from`-independence end-to-end, T-BIND-1 anchor).
  expect(fp).toBe("0x2c36a77f8e39c8d0f8d276f88169608e1a247bb288117da00f90b1f7dd158684");
});
```

**Adaptation notes for Phase 32:**

- **Fixture UNI-A:** `SwapRouter02.multicall(deadline=1748707200, [exactInputSingle({USDC, WETH, 500, ANVIL_WALLET_1, 100_000000, 48_100_000_000_000_000, 0})])` — `tx.to = SwapRouter02`, `valueWei = 0n`, `data = encoded multicall calldata`. Fixed deadline literal `1748707200n` for fixture reproducibility (RESEARCH lines 906-908).
- **Fixture UNI-B:** ETH-out via multicall + unwrapWETH9 — `multicall(deadline, [exactInputSingle({USDC, WETH, 500, SwapRouter02, ...}), unwrapWETH9(48_100_000_000_000_000, ANVIL_WALLET_1)])`. **Inner exactInputSingle.recipient = SwapRouter02 (the router itself)** — per RESEARCH § Topic 6 + CONTEXT.md typo correction (D-15).
- **Fixture UNI-C:** Multi-hop via `exactInput(path, recipient, amountIn, amountOutMin)` — `path = encodeV3Path([{USDC, 3000, WETH}, {WETH, 3000, WBTC}])` (66 bytes, per RESEARCH lines 388-392). Wrapped in `multicall(deadline, [exactInput(...)])`.
- All 3 fingerprints computed at PLAN 32-01 task-design time via real `encodeMulticallWithDeadline` + `computePayloadFingerprint` helpers — then pinned as hardcoded `0x...` literals. **NO `beforeAll`-snapshot.**
- Cross-link comments naming `test/get-uniswap-quote.test.ts` + `test/prepare-uniswap-swap.test.ts` + `test/integration-uniswap-v3.test.ts` as re-anchor sites.

**Critical to clone:**
- HARDCODED 0x literal per fixture (no computed assertion).
- `data.length` + `data.slice(0, 10).toLowerCase()` selector check BEFORE the fingerprint assertion (catches encoder drift on a specific line, separate from preimage drift).
- "Drift in preimage assembly for any of {…} fails THIS exact assertion" comment cataloging the inputs.
- "Fixture X cross-link" closing comment naming consumer tests.

---

### `test/integration-uniswap-v3.test.ts` (NEW — persona-cycle byte-identity integration)

**Closest analog:** `test/integration-eigenlayer-rocketpool.test.ts` (Phase 31; mirrors the lido-lifecycle precedent).

**Pattern** (integration-eigenlayer-rocketpool.test.ts lines 17-119 — setup + mocks; lines 204-289 — persona-cycle byte-identity):

```typescript
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createMockPublicClient,
  type MockPublicClient,
} from "./helpers/mock-public-client.js";
import {
  createMockSignClient,
  type MockSignClient,
} from "./helpers/mock-sign-client.js";

const {
  getStatusSpy, getActiveSessionTopicSpy, mockPublicHolder, mockSignClientHolder,
} = vi.hoisted(() => ({ ... }));

vi.mock("../src/wallet/session-manager.js", async () => { ... });
vi.mock("../src/chains/registry.js", async () => { ... });

const MAX_UINT256 = 2n ** 256n - 1n;
const mockReadContract = vi.fn().mockImplementation(
  async ({ functionName }: { functionName: string }) => {
    if (functionName === "allowance") return MAX_UINT256;
    if (functionName === "quoteExactInputSingle") return 48_320_000_000_000_000n;
    ...
  },
);

// Fixture literals — hardcoded at write-time in test/signing-fingerprint.test.ts.
const FIXTURE_UNI_A_FP = "0x<UNI-A literal here>";
const FIXTURE_UNI_B_FP = "0x<UNI-B literal here>";
const FIXTURE_UNI_C_FP = "0x<UNI-C literal here>";

const PERSONAS_UNDER_TEST = ["whale", "stable-saver", "defi-degen"] as const;

describe("integration-uniswap-v3 — Fixture UNI-A persona-independence (single-hop ERC-20)", () => {
  it("prepare_uniswap_swap: all 3 personas produce Fixture UNI-A fingerprint", async () => {
    for (const persona of PERSONAS_UNDER_TEST) {
      _resetHandleStoreForTesting();
      _resetActivePersonaForTesting();
      setActivePersona(persona);

      const result = await callTool("prepare_uniswap_swap", UNI_A_AGENT_ARGS);
      expect(result.isError).toBeFalsy();
      const sc = result.structuredContent as { payloadFingerprint: string; from: string };
      expect(
        sc.payloadFingerprint,
        `STOP-THE-LINE: persona ${persona} produced wrong Fixture UNI-A fingerprint`,
      ).toBe(FIXTURE_UNI_A_FP);
      expect(sc.from).toBe(personaAddress(persona));
    }
  });
});
```

**Adaptation notes:**
- 3 fixtures × 3 personas = 9 persona-independence assertions minimum.
- `mockReadContract` covers: `allowance` (D-07), `quoteExactInputSingle` (4 fee-tier quotes), `quoteExactInput` (2 multi-hop candidates), `decimals` (token metadata).
- **Mock the block timestamp** for fixture reproducibility — pin `eth_getBlockByNumber` to return a fixed `timestamp = 1748706600` so the prepared deadline = `1748706600 + 600 = 1748707200n` matches the fixture-pinned deadline.
- Reuse the `vi.hoisted` + `vi.mock("../src/wallet/session-manager.js")` + `vi.mock("../src/chains/registry.js")` pattern verbatim.
- 3 describe blocks (one per fixture) + 1 cross-fixture-distinctness sanity check (`new Set(...).size === 3`).
- Optionally extend with a "full pipeline" describe block (prepare → preview → send simulation) like Phase 31's lines 296+ — surfaces the DECODED ARGS + LEDGER NOTICE rendering for each fixture.

**Critical to clone:**
- `vi.hoisted` for spy + mock-client holders (before `vi.mock` factories).
- `await import("../src/tools/register-all.js")` at module top to register all tools.
- `_resetHandleStoreForTesting()` + `_resetActivePersonaForTesting()` between persona iterations.
- `"STOP-THE-LINE: ..."` failure message — drift in `from`-independence is a release blocker.
- `setActivePersona(persona)` for each iteration.

---

### `test/config-contracts.test.ts` (MODIFY — `T-UNISWAP-V3-SPENDER-DRIFT-1`)

**Closest analog:** Phase 31 `T-EIGENLAYER-SPENDER-DRIFT-1` + `T-ROCKETPOOL-SPENDER-DRIFT-1`.

**Pattern** (RESEARCH § Topic 12 lines 1033-1043):

```typescript
it("T-UNISWAP-V3-SPENDER-DRIFT-1: KNOWN_SPENDERS_ETHEREUM 'Uniswap V3 SwapRouter02' row address matches getUniswapV3SwapRouter02Address(1)", () => {
  const sotAddr = getUniswapV3SwapRouter02Address(1);
  expect(sotAddr).not.toBeNull();
  const row = KNOWN_SPENDERS_ETHEREUM.find((s) => s.label === "Uniswap V3 SwapRouter02");
  expect(row).toBeDefined();
  expect(row!.address).toBe(sotAddr);
  // Defense-in-depth: byte-identity against the canonical literal — catches
  // simultaneous drift in BOTH SOT and KNOWN_SPENDERS (silent migration).
  expect(sotAddr).toBe(getAddress("0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45"));
});
```

**Adaptation notes:**
- ONE drift test (NOT two — Quoter V2 is NOT in KNOWN_SPENDERS; read-only contract per D-13a).
- Three `expect`: SOT getter returns non-null, KNOWN_SPENDERS row exists, both match. Third assertion is defense-in-depth — catches simultaneous-drift attacks.

**Critical to clone:**
- Test ID convention `T-UNISWAP-V3-SPENDER-DRIFT-1` (consistent with Phase 30/31 `T-LIDO-SPENDER-DRIFT-1` / `T-EIGENLAYER-SPENDER-DRIFT-1`).
- Defense-in-depth third assertion against the canonical EIP-55 literal.

---

### `SECURITY.md` (MODIFY — §6 v2.4 addendum)

**Closest analog:** Phase 28-31 §6 v2.4 addenda (Compound V3 intent-vs-reality / Lido rebase / EigenLayer slashing / Rocket Pool blind-sign).

**Adaptation notes:**
- New subsection documenting:
  - **Quoter-midpoint price-impact methodology (D-04b residual risk):** the method understates impact on pools with extremely concentrated liquidity at the spot tick; mitigation is the 2% sandwich-MEV refusal threshold (errs on side of refusal).
  - **Sandwich-MEV defense-in-depth (D-08):** gate fires at PREPARE time even after the user already saw the quote — load-bearing because quote may drift between quote → prepare.
  - **UniversalRouter deferral rationale (D-03):** Phase 32 targets SwapRouter02, not UniversalRouter, because UniversalRouter requires Permit2-signed typed-data. Typed-data clear-sign on Ledger is the open prerequisite. Anchored at v3.x ROADMAP.
  - **Unconditional LEDGER NOTICE (RESEARCH Topic 7):** every Phase 32 transaction blind-signs because the outer multicall(deadline, bytes[]) selector is not in the ERC-7730 registry. User trust anchor reduces to the on-device hash match.
- Use the security-engineering vocabulary per `~/.claude/CLAUDE.md` (residual risk, explicit scope/assumptions, defense in depth, fail-safe defaults, cooperating agent, threat actor).

**Critical to clone:**
- Phase 28-31 SECURITY.md addendum tone — high-level, factually accurate, no hedging adjectives.
- One sharp paragraph per topic above; cross-reference D-numbers from CONTEXT.md inline.

---

## Shared Patterns

### Authentication / Wallet Pairing

**Source:** `src/signing/resolve-from.ts` (Phase 5 + Phase 8 — `resolveFrom` helper).
**Apply to:** `src/tools/prepare_uniswap_swap.ts`.

```typescript
const rawFrom = typeof args.from === "string" ? args.from : undefined;
const fromResolution = await resolveFrom({ rawFrom, chainId });
if (fromResolution.kind === "error") {
  return fromResolution.result;
}
const fromAddress: Address = fromResolution.fromAddress;
const fromCallerSupplied = fromResolution.callerSupplied;
```

Returns either an error envelope or the resolved sender (live session OR demo persona OR caller-supplied — checked against approved accounts).

---

### Error Handling

**Source:** `src/signing/error-codes.ts` (FROZEN 21-code union) + per-tool `errEnvelope` helper.
**Apply to:** Both Phase 32 tools.

```typescript
function errEnvelope(
  code: ErrorCode,
  message: string,
  cause?: string,
  hintTool?: string,
): Record<string, unknown> {
  const base = makeStructuredError(code, message, cause) as unknown as Record<string, unknown> & StructuredError;
  if (hintTool !== undefined) {
    return { ...base, hintTool };
  }
  return base;
}
```

`hintTool` is the **intent-vs-reality steering primitive** (Phase 28/30/31 precedent):
- D-04a `INVALID_INPUT + hintTool: "request_capability"` (no liquidity).
- D-07 `INVALID_INPUT + hintTool: "prepare_token_approve"` (insufficient allowance) + `hintArgs: { tokenAddress, spender: SwapRouter02, amount }`.
- D-08 `INVALID_INPUT + hintTool: "get_uniswap_quote"` (sandwich-MEV refusal).

The 21-code `ErrorCode` union remains FROZEN — never widen.

---

### Validation

**Source:** `src/signing/amount.ts` (`parseAmountStrict`) + per-tool schema validation.
**Apply to:** Both Phase 32 tools.

```typescript
// Decimal-aware amount parse — CLAUDE.md rule.
let amountWei: bigint;
try {
  amountWei = parseAmountStrict(rawAmount, tokenInDecimals);
} catch (err) {
  const message = err instanceof InvalidAmountError ? err.message : ...;
  return {
    isError: true,
    content: [{ type: "text", text: `error: invalid 'amount': ${message}` }],
    structuredContent: errEnvelope("INVALID_INPUT", `invalid 'amount': ${message}`),
  };
}
```

Phase 32 specifics:
- `tokenIn`/`tokenOut` validation: agent supplies EIP-55 addresses OR the `"ETH"` sentinel; both validated before any RPC call.
- `slippageBps` bounds: `1` ≤ slippageBps ≤ `10000` (D-08).
- `chain` enum: `["ethereum"]` at Phase 32; non-Ethereum refuses with `CHAIN_ID_MISMATCH`.

---

### ESM Spy-Affordance Indirection (CLAUDE.md § Conventions)

**Source:** `_paths` (`src/config/config-file.ts:78`), `_storage` (`src/wallet/session-manager.ts:54`), `_contracts` (`src/config/contracts.ts:901`), `_canonicalDispatch` (`src/security/canonical-dispatch.ts:263`), `_rocketPoolProtocol` (`src/protocols/rocketpool.ts:238`), `_eigenLayerProtocol` (`src/protocols/eigenlayer.ts:187`), `_lidoProtocol`.

**Apply to:** Every Phase 32 module with internal cross-export calls.

```typescript
// Pattern (src/config/config-file.ts:78):
export const _paths = { getConfigPath };

// Production code calls through the object:
const path = _paths.getConfigPath();

// Test:
vi.spyOn(_paths, "getConfigPath").mockReturnValue("/test/path");
```

**Required Phase 32 indirections:**
- `_uniswapV3Protocol` in `src/protocols/uniswap-v3.ts` — wraps all 5 encoders.
- `_uniswapV3Path` in `src/signing/uniswap-path.ts` — wraps `encodeV3Path`.
- `_uniswapV3PriceImpact` in `src/signing/uniswap-price-impact.ts` — wraps `computePriceImpactBps`.
- `_uniswapV3Chain` in `src/chains/uniswap-v3.ts` — wraps the Quoter V2 reader (mirror `_rocketPoolChains` shape).

**Boundary exception (CLAUDE.md):** For external network clients (`src/clients/...`), prefer `vi.stubGlobal("fetch", …)` over an internal indirection. **NOT applicable to Phase 32** — Uniswap V3 reads go through viem's publicClient (Phase 7+ chain-client convention), not through fetch.

---

### Fingerprint / Cryptographic-Binding (CLAUDE.md)

**Source:** `src/signing/payload-fingerprint.ts` `computePayloadFingerprint` (Phase 4 FROZEN).
**Apply to:** `src/tools/prepare_uniswap_swap.ts`.

```typescript
const payloadFingerprint = computePayloadFingerprint({
  chainId: 1,
  to: swapRouter02Addr,          // SOT-resolved
  valueWei: amountWei,           // amountIn for ETH-in; else 0n
  data,                          // FULL multicall(deadline, [...]) calldata (D-12)
});
```

**Pinning discipline (CLAUDE.md cryptographic-binding):**
- 3 new fixtures (UNI-A / UNI-B / UNI-C) → 3 hardcoded `0x...` literals in `test/signing-fingerprint.test.ts`.
- NO `beforeAll`-snapshot — drift in preimage assembly must fail at a specific line.
- Cross-link from each consumer test (`test/get-uniswap-quote.test.ts`, `test/prepare-uniswap-swap.test.ts`, `test/integration-uniswap-v3.test.ts`).
- Integration test re-anchors byte-identity across persona swaps to prove `from`-independence (T-BIND-1 anchor).

---

### PREPARE RECEIPT — verbatim agent args (CLAUDE.md)

**Source:** `src/signing/blocks.ts` `EIGENLAYER_DEPOSIT_PREPARE_RECEIPT_TEMPLATE` (Phase 31).
**Apply to:** `src/tools/prepare_uniswap_swap.ts`.

Every `prepare_*` includes the PREPARE RECEIPT block with verbatim agent args. NEVER elide; NEVER normalize. The agent-relayed args become the device's pre-sign cross-check anchor.

---

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| (none) | — | — | — |

Every Phase 32 file maps to a direct prior-phase analog. The 4 NOVEL surfaces (path-bytes encoder, price-impact math, multicall-deadline composition, `Promise.allSettled` fee-tier iteration) are local twists inside files whose overall shape is well-established.

---

## Metadata

**Analog search scope:**
- `src/tools/*.ts` (Phase 6-31 prepare/get analogs — focus on Phase 20 SunSwap, Phase 30 Lido, Phase 31 EigenLayer/Rocket Pool).
- `src/protocols/*.ts` (Lido + EigenLayer + Rocket Pool as multi-method decoder precedents).
- `src/signing/blocks.ts` + `src/signing/blocks-tron.ts` (template + DECODED ARGS dispatch patterns).
- `src/config/contracts.ts` (SOT-getter + KNOWN_SPENDERS_ETHEREUM extension precedents).
- `src/security/canonical-dispatch.ts` (per-chain allowlist arm precedent).
- `src/chains/*.ts` (Promise.all reader precedent).
- `test/signing-fingerprint.test.ts` (fixture pinning precedent).
- `test/integration-eigenlayer-rocketpool.test.ts` (persona-cycle integration precedent).

**Files scanned:** ~30 source files + ~8 test files read in full or relevant section.

**Pattern extraction date:** 2026-05-23.
