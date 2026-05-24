# Phase 33: Uniswap V3 LP verb set + `get_lp_positions` — Pattern Map

**Mapped:** 2026-05-24
**Files analyzed:** 21 (18 new + 3 modified per RESEARCH § Topic 12)
**Analogs found:** 21 / 21 (100% coverage — Phase 32 anchored every adjacent pattern; composite-multicall is the one extension shape that draws from Phase 32 multicall arm but extends it to NEW selector)

## File Classification

### Wave 1 (Plan 33-01) — Foundation: reader + tick math + SOT + canonical-dispatch + LEDGER NOTICE

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/chains/uniswap-v3-lp.ts` (NEW) | chain-reader | request-response (RPC fan-out) | `src/chains/aave-v3.ts` + `src/chains/uniswap-v3.ts` (Promise.allSettled) | exact (Aave for parseAbi+_indirection; Uniswap V3 for Promise.allSettled) |
| `src/signing/uniswap-tick.ts` (NEW) | utility (pure-math) | transform | `src/signing/uniswap-path.ts` | exact (sibling-shelf, pure-bytes/pure-bigint, ESM indirection) |
| `src/signing/uniswap-liquidity.ts` (NEW) | utility (pure-math) | transform | `src/signing/uniswap-path.ts` | exact (sibling sibling-shelf module) |
| `src/signing/uniswap-fees.ts` (NEW) | utility (pure-math) | transform | `src/signing/uniswap-path.ts` | exact (sibling sibling-shelf module) |
| `src/signing/uniswap-il.ts` (NEW) | utility (pure-math) | transform | `src/signing/uniswap-path.ts` | exact (sibling sibling-shelf module) |
| `src/signing/uniswap-pool-address.ts` (NEW) | utility (pure-math) | transform | `src/signing/uniswap-path.ts` | exact + ADDITION: module-load self-check pattern (anchored in RESEARCH Code-Examples §) |
| `src/tools/get_lp_positions.ts` (NEW) | tool (read) | request-response | `src/tools/get_lido_positions.ts` + `src/tools/get_eigenlayer_positions.ts` | role-match (chain-narrow guard + dual-chain shape; Phase 33 is Ethereum-only so narrower) |
| `src/security/canonical-dispatch.ts` (MODIFY: +1 row) | middleware (allowlist) | request-response (Layer 0.5 gate) | `src/security/canonical-dispatch.ts` Phase 32 SwapRouter02 arm (lines 175-184) | exact (single-row append; mirror Phase 32 idiom) |
| `src/config/contracts.ts` (MODIFY: +1 KNOWN_SPENDERS_ETHEREUM row + 1 cross-view test anchor) | config (SOT) | request-response | `src/config/contracts.ts` lines 956-963 (Phase 32 SwapRouter02 KNOWN_SPENDERS row) | exact |
| `src/signing/blocks.ts` (MODIFY: +1 LEDGER NOTICE template) | utility (text-template) | transform | `LEDGER_NOTICE_UNISWAP_V3_TEMPLATE` (Phase 32, blocks.ts:2084-2100) | exact (mechanical clone with Uniswap V3 LP-specific copy) |

### Wave 2 (Plan 33-02) — 5 single-step prepares + protocol decoder + preview_send + 5 fixtures

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/tools/prepare_uniswap_v3_mint.ts` (NEW) | tool (prepare) | request-response | `src/tools/prepare_aave_supply.ts` + `src/tools/prepare_uniswap_swap.ts` (approval pre-flight) | exact (mechanical clone — supply template; uniswap_swap for approval gate) |
| `src/tools/prepare_uniswap_v3_increase_liquidity.ts` (NEW) | tool (prepare) | request-response | `src/tools/prepare_aave_supply.ts` | exact (mechanical clone — different selector + params) |
| `src/tools/prepare_uniswap_v3_decrease_liquidity.ts` (NEW) | tool (prepare) | request-response | `src/tools/prepare_aave_supply.ts` | exact (clone — adds NOTICE per Pitfall 3) |
| `src/tools/prepare_uniswap_v3_collect.ts` (NEW) | tool (prepare) | request-response | `src/tools/prepare_aave_supply.ts` | exact (clone — uses MAX_UINT128 sentinel) |
| `src/tools/prepare_uniswap_v3_burn.ts` (NEW) | tool (prepare) | request-response | `src/tools/prepare_aave_supply.ts` | exact (clone — adds burn-eligibility pre-flight) |
| `src/protocols/uniswap-v3-lp.ts` (NEW) | protocol (encoder + decoder + selector table) | transform | `src/protocols/uniswap-v3.ts` | exact (SEPARATE file per CONTEXT.md D-02; clone the parseAbi + selector table + encoder + `_uniswapV3Protocol` shape) |
| `src/tools/preview_send.ts` (MODIFY: +5 selector dispatch arms) | tool (selector dispatch) | request-response | `src/tools/preview_send.ts:985-1008` (Phase 32 Uniswap V3 SwapRouter02 arm) | exact (mirror the (to, selector) tuple-dispatch idiom) |
| `src/signing/blocks.ts` (MODIFY: +5 PREPARE RECEIPT templates + 5 DECODED ARGS templates + `buildUniswapV3LpDecodedArgsBlock`) | utility (text-template) | transform | `UNISWAP_SWAP_PREPARE_RECEIPT_TEMPLATE` + `buildUniswapV3DecodedArgsBlock` (Phase 32, blocks.ts:2169 + 2314) | exact |
| `test/signing-fingerprint.test.ts` (MODIFY: +5 fixtures UNI-LP-{A,B,C,D,E}) | test (regression) | transform | `signing-fingerprint.test.ts:537-710` (Fixtures UNI-A/B/C, Phase 32) | exact (clone hardcoded-literal discipline — NO `beforeAll`) |
| `src/tools/register-all.ts` (MODIFY: +5 imports) | config (registration) | event-driven | `src/tools/register-all.ts:102-103` (Phase 32 swap registration) | exact (single import line per tool) |

### Wave 3 (Plan 33-03) — Composite rebalance + composite-multicall preview + Fixture F + persona integration test

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/tools/prepare_uniswap_v3_rebalance.ts` (NEW) | tool (prepare — composite) | request-response | `src/tools/prepare_aave_supply.ts` (template) + `src/protocols/uniswap-v3.ts::composeMulticallWithUnwrap` (composition shape for multicall wrapping) | role-match + partial pattern (single-handle composite is NEW shape; the closest analog is `composeMulticallWithUnwrap` for the wrap-3-inner-calls-into-one-multicall idiom) |
| `src/tools/preview_send.ts` (MODIFY: +composite-multicall arm + shared `decodeSingleNpmCall` helper per Pitfall 7) | tool (recursive selector dispatch) | request-response | `src/tools/preview_send.ts:340-355` (Phase 32 multicallWithDeadline recursive arm) | exact (mirror recursive shape — different OUTER selector `0xac9650d8` vs `0x5ae401dc`) |
| `src/signing/blocks.ts` (MODIFY: +`UNISWAP_V3_REBALANCE_PREPARE_RECEIPT_TEMPLATE` + composite-multicall DECODED ARGS rendering helper) | utility (text-template) | transform | `DECODED_ARGS_TEMPLATE_UNISWAP_MULTICALL` (Phase 32, blocks.ts:2228-2234) + `buildUniswapV3DecodedArgsBlock` multicall arm (blocks.ts:2331-2345) | exact |
| `test/signing-fingerprint.test.ts` (MODIFY: +Fixture UNI-LP-F + 6-fixture distinctness set) | test (regression) | transform | `signing-fingerprint.test.ts:703-710` (Phase 32 distinct-fingerprints assertion) | exact |
| `src/tools/register-all.ts` (MODIFY: +1 import) | config (registration) | event-driven | (same as Wave 2 import line) | exact — append AFTER Wave 2's block (sequential wave landing per Phase 9 / Phase 32 precedent) |
| `test/integration-uniswap-v3-lp.test.ts` (NEW — persona-cycle byte-identity) | test (integration) | transform | `test/integration-uniswap-v3.test.ts` (Phase 32 Plan 32-03 — re-anchor UNI-A/B/C under personas) | exact |

---

## Pattern Assignments

### `src/chains/uniswap-v3-lp.ts` (chain-reader, request-response RPC fan-out)

**Primary analog:** `src/chains/aave-v3.ts` (parseAbi + typed-decoded interface + `_aaveChains` indirection)
**Secondary analog:** `src/chains/uniswap-v3.ts` (Promise.allSettled fan-out — RESEARCH Topic 11 calls for it explicitly)

**Imports pattern** (mirror `aave-v3.ts:12-18`):
```typescript
import { type Address, type PublicClient, parseAbi } from "viem";

import {
  getUniswapV3NonfungiblePositionManagerAddress,
  type ChainId,
} from "../config/contracts.js";
import { computePoolAddress } from "../signing/uniswap-pool-address.js";
```

**parseAbi declaration** (mirror `aave-v3.ts:37-43` + RESEARCH Topic 11 fragments):
```typescript
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
```

**Promise.allSettled fan-out pattern** (mirror `chains/uniswap-v3.ts:229-251`):
```typescript
// Per RESEARCH Topic 11: NEVER Promise.all — one broken position must not poison
// the batch (e.g. burned NFT race condition).
const settled = await Promise.allSettled(
  tokenIds.map(async (tokenId) => {
    const positionTuple = await client.readContract({
      address: npmAddress,
      abi: NPM_READ_ABI,
      functionName: "positions",
      args: [tokenId],
    });
    // ... decode + derive pool + slot0 + ticks
    return positionData;
  }),
);
return settled
  .filter((s): s is PromiseFulfilledResult<PositionData> => s.status === "fulfilled")
  .map((s) => s.value);
```

**ESM spy-affordance** (mirror `aave-v3.ts:148`):
```typescript
export const _uniswapV3LpReader = { readUserPositions };
```

---

### `src/signing/uniswap-tick.ts` (utility, transform — pure-bigint)

**Analog:** `src/signing/uniswap-path.ts` (Phase 32)

**Module-header doc pattern** (mirror `uniswap-path.ts:1-31`): include "Pure-bigint." + "NO side effects. NO RPC reads. NO module-load state." + threat-anchor comment + cross-link to consumer.

**Imports** (mirror `uniswap-path.ts:32`):
```typescript
import { type Address, type Hex } from "viem";
```

**ESM spy-affordance** (mirror `uniswap-path.ts:120-123`):
```typescript
/**
 * Mutable indirection object for ESM spy-affordance. Tests can
 * `vi.spyOn(_uniswapV3Tick, "priceToTick")` to intercept without
 * monkey-patching named exports (ESM bindings are immutable; direct spies are
 * no-ops for module-internal calls). Mirror of `_uniswapV3Path` in
 * src/signing/uniswap-path.ts.
 */
export const _uniswapV3Tick = {
  priceToSqrtPriceX96,
  sqrtPriceX96ToPrice,
  tickToSqrtPriceX96,      // = getSqrtRatioAtTick
  sqrtPriceX96ToTick,      // = getTickAtSqrtRatio
  priceToTick,
  tickToPrice,
  snapPriceToTick,
};
```

**Fee tier literal-union** (clone `uniswap-path.ts:54-58` `PathHop.fee`):
```typescript
export type Uniswapv3FeeTier = 100 | 500 | 3000 | 10000;
export const TICK_SPACINGS: Readonly<Record<Uniswapv3FeeTier, number>> = {
  100: 1, 500: 10, 3000: 60, 10000: 200,
};
```

---

### `src/signing/uniswap-liquidity.ts` + `src/signing/uniswap-fees.ts` + `src/signing/uniswap-il.ts` (utility, transform)

**Analog:** `src/signing/uniswap-path.ts` (Phase 32) — same sibling-shelf shape

Same shape as `uniswap-tick.ts`: pure-bigint, NO side effects, NO RPC reads, `_uniswapV3Liquidity` / `_uniswapV3Fees` / `_uniswapV3Il` indirection. Specific algorithms per RESEARCH Topic 4 / Topic 5.

---

### `src/signing/uniswap-pool-address.ts` (utility, transform + module-load self-check)

**Analog:** `src/signing/uniswap-path.ts` (Phase 32) for shelf shape
**Addition:** module-load self-check assertion (verbatim from RESEARCH Code Examples §):

**Self-check pattern** (NEW shape — NOT in any existing Phase 32 module):
```typescript
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

The closest spiritual analog in the codebase is the `getAddress`-wrapped literal pattern from `src/security/canonical-dispatch.ts:83-95` (corrupt-snapshot detection at module load) — but this is the FIRST true module-load assertion in the codebase. Pitfall 6 anchors the discipline.

---

### `src/tools/get_lp_positions.ts` (tool, read — request-response)

**Primary analog:** `src/tools/get_lido_positions.ts` (single-chain narrow guard shape, chain enum, formatter pattern)

**Imports pattern** (mirror `get_lido_positions.ts:32-38`):
```typescript
import { formatUnits, getAddress, isAddress, type Address } from "viem";

import { _uniswapV3LpReader } from "../chains/uniswap-v3-lp.js";
import { getChainClient, isPublicNodeFallback } from "../chains/registry.js";
import { chainIdFromName, type ChainName } from "../config/contracts.js";
import { makeStructuredError } from "../signing/error-codes.js";
import { registerTool } from "./index.js";
```

**Narrow-chain guard** (mirror `get_lido_positions.ts:77`):
```typescript
// Phase 33 is Ethereum-only per CONTEXT.md D-03; narrower than Lido's
// ethereum+arbitrum surface. Multi-chain LP deferred to v2.4.x.
const LP_SUPPORTED_CHAINS: ReadonlySet<string> = new Set(["ethereum"]);
```

**Description block** (mirror `get_lido_positions.ts:44-52` 7-bullet structure): describe + chain narrowing + `[ESTIMATE]` warning (mirror Lido's "approx: true" load-bearing note for IL) + use/don't-use + returns + failure modes.

**Approx-flag discipline** (mirror `get_lido_positions.ts:162-166`):
```typescript
// D-02 load-bearing: IL estimates ALWAYS prefixed [ESTIMATE]; ilEstimateConfidence
// is "high" (in-range entry-price reconstruction) or "low" (out-of-range geometric-
// midpoint heuristic per CONTEXT.md D-02 + RESEARCH Topic 5). Mirror Lido's
// approx: true literal discipline — drift in the type checks fails compile.
ilEstimateConfidence: "high" as const | "low" as const,
```

**rpcDegraded surface** (mirror `get_lido_positions.ts:167`): `if (isPublicNodeFallback(chainId)) structuredContent.rpcDegraded = true;`

---

### `src/tools/prepare_uniswap_v3_mint.ts` + 4 sibling prepares (tool, prepare — request-response)

**Primary analog:** `src/tools/prepare_aave_supply.ts` (mechanical-clone template)
**Secondary analog:** `src/tools/prepare_uniswap_swap.ts` (approval pre-flight idiom for mint + increase)

**Imports pattern** (mirror `prepare_aave_supply.ts:39-60`):
```typescript
import { type Address, type Hex, erc20Abi, getAddress } from "viem";

import { getChainClient } from "../chains/registry.js";
import {
  chainIdFromName,
  getUniswapV3NonfungiblePositionManagerAddress,
  type ChainId,
  type ChainName,
} from "../config/contracts.js";
import { _uniswapV3LpProtocol } from "../protocols/uniswap-v3-lp.js";
import { InvalidAmountError, parseAmountStrict } from "../signing/amount.js";
import { UNISWAP_V3_LP_MINT_PREPARE_RECEIPT_TEMPLATE, LEDGER_NOTICE_UNISWAP_V3_LP_TEMPLATE } from "../signing/blocks.js";
import { type ErrorCode, type StructuredError, makeStructuredError } from "../signing/error-codes.js";
import { createHandle } from "../signing/handle-store.js";
import { computePayloadFingerprint } from "../signing/payload-fingerprint.js";
import { resolveFrom } from "../signing/resolve-from.js";
import { registerTool } from "./index.js";
```

**SOT-getter for `tx.to`** (mirror `prepare_aave_supply.ts:224-225`):
```typescript
// tx.to comes from the SOT — getUniswapV3NonfungiblePositionManagerAddress(chainId)
// — NEVER inlined. T-UNISWAP-V3-NPM-ADDR-INLINE-1 mitigation; grep-zero asserted.
const npmAddress: Address = getUniswapV3NonfungiblePositionManagerAddress(chainId)!;
```

**Sender resolution** (mirror `prepare_aave_supply.ts:163-171`):
```typescript
const rawFrom = typeof args.from === "string" ? args.from : undefined;
const fromResolution = await resolveFrom({ rawFrom, chainId });
if (fromResolution.kind === "error") return fromResolution.result;
const fromAddress: Address = fromResolution.fromAddress;
const fromCallerSupplied = fromResolution.callerSupplied;
```

**Approval pre-flight** (mint + increase only; clone `prepare_uniswap_swap.ts` D-07 idiom — read both token0 + token1 allowance):
```typescript
// RESEARCH Topic 8 — NPM IS a spender for mint/increase. Pre-flight BOTH
// token0 AND token1 allowance reads (mirror Phase 32 prepare_uniswap_swap's
// D-07 approval pre-flight; widened to two tokens). Insufficient → INVALID_INPUT
// + hintTool: "prepare_token_approve" + hintArgs naming NPM as spender.
const [allow0, allow1] = await Promise.all([
  client.readContract({ address: token0, abi: erc20Abi, functionName: "allowance", args: [fromAddress, npmAddress] }),
  client.readContract({ address: token1, abi: erc20Abi, functionName: "allowance", args: [fromAddress, npmAddress] }),
]);
if (allow0 < amount0Desired || allow1 < amount1Desired) { /* INVALID_INPUT + hintTool */ }
```

**Calldata composition** (mirror RESEARCH Code Examples §):
```typescript
const data: Hex = _uniswapV3LpProtocol.encodeMint({
  token0, token1, fee, tickLower, tickUpper,
  amount0Desired, amount1Desired, amount0Min, amount1Min,
  recipient: fromAddress, deadline,
});
const tx = { chainId, to: npmAddress, valueWei: 0n, data };
const payloadFingerprint = computePayloadFingerprint(tx);
const handle = createHandle({ args: rawArgs, tx, payloadFingerprint });
```

**PREPARE RECEIPT template render** (mirror `prepare_aave_supply.ts:254-260` `.replace` chain).

**LEDGER NOTICE emission** (mirror `prepare_uniswap_swap.ts` D-11 unconditional emission): include `LEDGER_NOTICE_UNISWAP_V3_LP_TEMPLATE` in every response's `content` array verbatim per CONTEXT.md/RESEARCH Topic 10.

**Burn pre-flight** (`prepare_uniswap_v3_burn.ts` only; NEW shape — closest analog is Phase 32 sandwich-MEV gate's INVALID_INPUT + hintTool pattern):
```typescript
// Refuses unless liquidity == 0 AND tokensOwed0 == 0 AND tokensOwed1 == 0
// (would revert on-chain). Pre-flight via positions(tokenId) read.
const position = await client.readContract({ address: npmAddress, abi: NPM_READ_ABI, functionName: "positions", args: [tokenId] });
if (position.liquidity > 0n) return { /* INVALID_INPUT + hintTool: "prepare_uniswap_v3_decrease_liquidity" */ };
if (position.tokensOwed0 > 0n || position.tokensOwed1 > 0n) return { /* INVALID_INPUT + hintTool: "prepare_uniswap_v3_collect" */ };
```

---

### `src/protocols/uniswap-v3-lp.ts` (protocol — selector dispatch + decoder + encoder)

**Analog:** `src/protocols/uniswap-v3.ts` (Phase 32) — SEPARATE file per CONTEXT.md D-02

**Module-header doc** (mirror `protocols/uniswap-v3.ts:1-73`): purpose + structural analog citation + selector table + collision warnings + ESM spy-affordance note + consumed-by list.

**Critical Phase-33 callouts** (NEW vs Phase 32):
- Selector `0xac9650d8` (`multicall(bytes[])`) is DISTINCT from Phase 32's `0x5ae401dc` (`multicall(uint256,bytes[])` deadline overload). Add anti-pattern guard: the deadline-overload selector MUST NOT appear in this module.
- Selector `0x42966c68` (`burn(uint256)`) COLLIDES with Phase 31 `rETH.burn` + ERC-20 Burnable. `(to, selector)` tuple dispatch resolves at `preview_send` — when `to == NPM`, render as NPM burn.

**parseAbi pattern** (verbatim from RESEARCH Code Examples § lines 1015-1029):
```typescript
export const NPM_WRITE_ABI = parseAbi([
  "function mint((address token0, address token1, uint24 fee, int24 tickLower, int24 tickUpper, uint256 amount0Desired, uint256 amount1Desired, uint256 amount0Min, uint256 amount1Min, address recipient, uint256 deadline)) external payable returns (uint256 tokenId, uint128 liquidity, uint256 amount0, uint256 amount1)",
  "function increaseLiquidity((uint256 tokenId, uint256 amount0Desired, uint256 amount1Desired, uint256 amount0Min, uint256 amount1Min, uint256 deadline)) external payable returns (uint128 liquidity, uint256 amount0, uint256 amount1)",
  "function decreaseLiquidity((uint256 tokenId, uint128 liquidity, uint256 amount0Min, uint256 amount1Min, uint256 deadline)) external payable returns (uint256 amount0, uint256 amount1)",
  "function collect((uint256 tokenId, address recipient, uint128 amount0Max, uint128 amount1Max)) external payable returns (uint256 amount0, uint256 amount1)",
  "function burn(uint256 tokenId) external payable",
]);

export const MULTICALL_BYTES_ABI = parseAbi([
  "function multicall(bytes[] data) external payable returns (bytes[])",
]);
```

**Selector table** (mirror `protocols/uniswap-v3.ts:179-192`):
```typescript
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

**ESM spy-affordance** (mirror `protocols/uniswap-v3.ts:370-376`):
```typescript
export const _uniswapV3LpProtocol = {
  encodeMint,
  encodeIncreaseLiquidity,
  encodeDecreaseLiquidity,
  encodeCollect,
  encodeBurn,
  encodeMulticallBytes,
};
```

---

### `src/security/canonical-dispatch.ts` (modify — middleware, Layer 0.5 allowlist)

**Analog:** `src/security/canonical-dispatch.ts:175-184` (Phase 32 SwapRouter02 single-row arm)

**Single-row addition pattern** (mirror Phase 32 idiom EXACTLY — replace `getUniswapV3SwapRouter02Address` with `getUniswapV3NonfungiblePositionManagerAddress`):
```typescript
// Phase 33 — NonfungiblePositionManager dispatch allowlist arm. NPM is the
// write target for mint / increaseLiquidity / decreaseLiquidity / collect /
// burn / multicall(bytes[]) (rebalance composite). Non-Ethereum chains:
// getUniswapV3NonfungiblePositionManagerAddress returns null per D-03 → outer
// ternary yields [] → spread adds nothing.
const uniswapV3Npm = getUniswapV3NonfungiblePositionManagerAddress(chainId);
const uniswapV3LpEntries: Address[] = uniswapV3Npm
  ? [uniswapV3Npm].filter(
      (a): a is Address => !!a && a !== "0x0000000000000000000000000000000000000000",
    )
  : [];
// ... then in the Set spread:
return new Set<Address>([
  // ... existing entries ...
  ...uniswapEntries,
  ...uniswapV3LpEntries,
]);
```

Also: import `getUniswapV3NonfungiblePositionManagerAddress` from `../config/contracts.js` at the top (mirror existing imports at lines 60-74).

---

### `src/config/contracts.ts` (modify — +1 KNOWN_SPENDERS_ETHEREUM row)

**Analog:** `src/config/contracts.ts:956-963` (Phase 32 SwapRouter02 KNOWN_SPENDERS row — SOT-delegated address)

**Note on SOT slot**: NPM SOT slot already populated at Phase 32 per `contracts.ts:746-754`. Phase 33 does NOT re-extend `UniswapV3Contracts`; only adds the `KNOWN_SPENDERS_ETHEREUM` row (Topic 8 CONFIRMED).

**Single-row addition pattern** (mirror lines 956-963 verbatim shape):
```typescript
// Phase 33 — NPM promotion to KNOWN_SPENDERS_ETHEREUM per RESEARCH Topic 8
// (CONFIRMED: NPM IS a spender for mint/increase via internal TransferHelper.
// safeTransferFrom on BOTH token0 AND token1). Address delegated to SOT getter
// for cross-view byte-identity (T-UNISWAP-V3-NPM-SPENDER-DRIFT-1).
{
  address: getUniswapV3NonfungiblePositionManagerAddress(1)!,
  label: "Uniswap V3 NonfungiblePositionManager",
  source: "https://docs.uniswap.org/contracts/v3/reference/periphery/NonfungiblePositionManager",
},
```

Insert in alphabetical-by-label order (after "Uniswap V3 SwapRouter02" line 960-963; before "WETH9" line 964-968).

---

### `src/signing/blocks.ts` (modify — LEDGER NOTICE + PREPARE RECEIPT + DECODED ARGS templates)

**LEDGER NOTICE template analog:** `LEDGER_NOTICE_UNISWAP_V3_TEMPLATE` (Phase 32, blocks.ts:2084-2100)

**Mechanical clone** with Uniswap V3 LP-specific copy (verbatim from RESEARCH Topic 10):
```typescript
export const LEDGER_NOTICE_UNISWAP_V3_LP_TEMPLATE: string = [
  "LEDGER NOTICE — Uniswap V3 LP operations blind-sign on device",
  "",
  "  The Ledger Ethereum app does NOT have ERC-7730 clear-sign coverage for the",
  "  Uniswap V3 NonfungiblePositionManager contract. When you sign this transaction,",
  "  the device will display the keccak256 hash of the calldata, NOT the decoded",
  "  operation (mint / increaseLiquidity / collect / etc.).",
  "",
  "  Before approving on-device, verify the LEDGER BLIND-SIGN HASH below matches what",
  "  the device displays. The CHECKS PERFORMED block above shows the decoded args the",
  "  server computed server-side — if those args don't match what you intended, refuse",
  "  on-device and call the appropriate tool again.",
  "",
  "  Coverage may be added in a future Ledger app update; consult Ledger's ERC-7730",
  "  registry at https://github.com/LedgerHQ/clear-signing-erc7730-registry.",
].join("\n");
```

**PREPARE RECEIPT template analog:** `UNISWAP_SWAP_PREPARE_RECEIPT_TEMPLATE` (Phase 32, blocks.ts:2169-2181)

**Pattern** (one template per verb — mint / increase / decrease / collect / burn + rebalance for Plan 33-03):
```typescript
export const UNISWAP_V3_LP_MINT_PREPARE_RECEIPT_TEMPLATE: string = [
  "PREPARE RECEIPT — Uniswap V3 mint (NonfungiblePositionManager)",
  "  chain:              {CHAIN}",
  "  npm:                {NPM}",
  "  token0:             {TOKEN0}",
  "  token1:             {TOKEN1}",
  "  fee:                {FEE}",
  "  priceLower:         {PRICE_LOWER}",       // verbatim agent input
  "  priceUpper:         {PRICE_UPPER}",       // verbatim agent input
  "  tickLower:          {TICK_LOWER}",        // server-snapped
  "  tickUpper:          {TICK_UPPER}",        // server-snapped
  "  amount0Desired:     {AMOUNT0_DESIRED}",
  "  amount1Desired:     {AMOUNT1_DESIRED}",
  "  slippageBps:        {SLIPPAGE_BPS}",
  "  deadline:           {DEADLINE}",
].join("\n");
```

**DECODED ARGS template analog:** `DECODED_ARGS_TEMPLATE_UNISWAP_EXACT_INPUT_SINGLE` (Phase 32, blocks.ts:2190-2199) — one per NPM verb.

**Composite-multicall DECODED ARGS analog** (Plan 33-03): `DECODED_ARGS_TEMPLATE_UNISWAP_MULTICALL` (Phase 32, blocks.ts:2228-2234) — change selector reference + add `step N/M` sub-block rendering per CONTEXT.md D-06 / RESEARCH Topic 9.

**`buildUniswapV3LpDecodedArgsBlock` shape** (mirror `buildUniswapV3DecodedArgsBlock` recursive idiom at blocks.ts:2314-2349) — discriminated union per kind: `mint` / `increase` / `decrease` / `collect` / `burn` / `composite-multicall` (whose `subCalls` is recursively rendered with 2-space indent + blank-line separator).

---

### `src/tools/preview_send.ts` (modify — selector dispatch arms)

**Analog:** `src/tools/preview_send.ts:985-1008` (Phase 32 Uniswap V3 SwapRouter02 arm — `(to, selector)` tuple dispatch with `_getUniswapV3SwapRouter02Address` SOT lookup)

**Wave 2 — 5 new NPM verb arms** (mirror Phase 32 idiom, but route to NPM, not SwapRouter02):
```typescript
} else if (
  sel === UNISWAP_V3_LP_SELECTORS.mint ||
  sel === UNISWAP_V3_LP_SELECTORS.increaseLiquidity ||
  sel === UNISWAP_V3_LP_SELECTORS.decreaseLiquidity ||
  sel === UNISWAP_V3_LP_SELECTORS.collect ||
  sel === UNISWAP_V3_LP_SELECTORS.burn
) {
  // Phase 33 Plan 33-02 — NPM DECODED ARGS arm. (to, selector) tuple
  // dispatch — Pitfall 2: burn selector 0x42966c68 collides with Phase 31
  // rETH.burn and ERC-20 Burnable. Route to NPM ONLY when tx.to === NPM SOT.
  const npmAddr = _getUniswapV3NonfungiblePositionManagerAddress(
    record.tx.chainId as ChainId,
  );
  if (npmAddr && record.tx.to === npmAddr) {
    uniswapV3LpDecoded = decodeSingleNpmCall(
      record.tx.data as Hex,
      sel,
    );
  }
}
```

**Wave 3 — composite-multicall arm** (mirror Phase 32 multicallWithDeadline recursion at lines 340-355; SHARED `decodeSingleNpmCall` helper per Pitfall 7):
```typescript
case UNISWAP_V3_LP_SELECTORS.multicallBytes: {
  // Outer NPM multicall(bytes[]) — selector 0xac9650d8 (NOT 0x5ae401dc).
  // (to, selector) tuple dispatch: only render when tx.to === NPM SOT.
  const decodedOuter = decodeFunctionData({
    abi: MULTICALL_BYTES_ABI,
    data,
  });
  const [calls] = decodedOuter.args as [readonly Hex[]];
  const subCalls: UniswapV3LpDecoded[] = [];
  for (const innerCall of calls) {
    const innerSel = innerCall.slice(0, 10).toLowerCase() as Hex;
    // Pitfall 7: SHARED decoder — same helper for outer-dispatch AND
    // composite-recursion. Drift between the two paths is the bug class.
    const sub = decodeSingleNpmCall(innerCall, innerSel);
    if (sub !== null) subCalls.push(sub);
  }
  return { kind: "composite-multicall", subCalls };
}
```

---

### `test/signing-fingerprint.test.ts` (modify — +6 fixtures UNI-LP-{A..F})

**Analog:** `test/signing-fingerprint.test.ts:537-710` (Phase 32 Fixtures UNI-A/B/C)

**Hardcoded literal anchor pattern** (mirror lines 554-559 + 561-606):
```typescript
// Phase 33 Plan 33-02 / 33-03 — Fixtures UNI-LP-A..F
// CLAUDE.md cryptographic-binding fixture discipline: "NO `beforeAll`-snapshot".
// Each fixture's preimage flows through SOT getters + Task encoders — NEVER inlined.

const FIXTURE_UNI_LP_A_FP = "0x..."; // mint  (compute at execute time)
const FIXTURE_UNI_LP_B_FP = "0x..."; // increaseLiquidity
const FIXTURE_UNI_LP_C_FP = "0x..."; // decreaseLiquidity
const FIXTURE_UNI_LP_D_FP = "0x..."; // collect
const FIXTURE_UNI_LP_E_FP = "0x..."; // burn
const FIXTURE_UNI_LP_F_FP = "0x..."; // rebalance multicall(bytes[])

it("Fixture UNI-LP-A — NPM.mint(USDC/WETH 0.05%, ...) fingerprint (hardcoded literal anchor, Phase 33 Plan 33-02)", () => {
  const npm = getUniswapV3NonfungiblePositionManagerAddress(1)!;
  // ... derive params via SOT getters
  const data = _uniswapV3LpProtocol.encodeMint({ ... });
  expect(data.slice(0, 10).toLowerCase()).toBe("0x88316456");  // selector pin BEFORE fp pin
  const fp = computePayloadFingerprint({ chainId: 1, to: npm, valueWei: 0n, data });
  expect(fp).toBe(FIXTURE_UNI_LP_A_FP);
});
// ... 5 more (UNI-LP-B..F)

it("Fixtures UNI-LP-A..F produce 6 distinct fingerprints", () => {
  const distinct = new Set([
    FIXTURE_UNI_LP_A_FP, FIXTURE_UNI_LP_B_FP, FIXTURE_UNI_LP_C_FP,
    FIXTURE_UNI_LP_D_FP, FIXTURE_UNI_LP_E_FP, FIXTURE_UNI_LP_F_FP,
  ]);
  expect(distinct.size).toBe(6);
});
```

For Fixture UNI-LP-F (rebalance), assert outer selector is `0xac9650d8` BEFORE fp assertion (mirror UNI-A's `expect(data.slice(0, 10).toLowerCase()).toBe("0x5ae401dc")` at line 584).

**Persona-cycle integration test** (`test/integration-uniswap-v3-lp.test.ts`): mirror Phase 32's `integration-uniswap-v3.test.ts` shape — re-anchor all 6 fixtures under ≥2 personas (Anvil account 1 + Anvil account 2) to prove `from`-independence end-to-end.

---

### `src/tools/register-all.ts` (modify — 6 new imports)

**Analog:** `src/tools/register-all.ts:102-103` (Phase 32 swap registration)

**Single-line per import** (mirror lines 102-103 exactly):
```typescript
// Wave 1 import (Plan 33-01):
import "./get_lp_positions.js"; // Phase 33 Plan 33-01 (UNI-04) — Uniswap V3 LP positions + IL estimate
// Wave 2 imports (Plan 33-02):
import "./prepare_uniswap_v3_mint.js";               // Phase 33 Plan 33-02 (UNI-05)
import "./prepare_uniswap_v3_increase_liquidity.js"; // Phase 33 Plan 33-02 (UNI-06)
import "./prepare_uniswap_v3_decrease_liquidity.js"; // Phase 33 Plan 33-02 (UNI-06)
import "./prepare_uniswap_v3_collect.js";            // Phase 33 Plan 33-02 (UNI-07)
import "./prepare_uniswap_v3_burn.js";               // Phase 33 Plan 33-02 (UNI-08)
// Wave 3 import (Plan 33-03 — append AFTER Wave 2 block to avoid merge conflicts):
import "./prepare_uniswap_v3_rebalance.js";          // Phase 33 Plan 33-03 (UNI-09) — composite multicall(bytes[])
```

**Wave-merge discipline (per Phase 9 + Phase 32 sequential precedent):** Plan 33-03's import line lands AFTER Plan 33-02's 5-line block — no interleaving. Phase 33 dispatches waves STRICTLY 1→2→3 (no parallel waves).

---

## Shared Patterns

### Cryptographic-binding fingerprint discipline (applies to all 6 prepare tools)

**Source:** `src/signing/payload-fingerprint.ts` (FROZEN — Phase 4)
**Apply to:** every `prepare_uniswap_v3_*` tool
**Pattern:**
```typescript
const payloadFingerprint = computePayloadFingerprint(tx);
const handle = createHandle({ args: rawArgs, tx, payloadFingerprint });
```

For composite rebalance: fingerprint covers FULL outer `multicall(bytes[])` calldata (single hash — unchanged Phase 4 trust pipeline). RESEARCH Topic 9 explicitly: "Cryptographic-binding chain (`payloadFingerprint` over the full multicall calldata) is UNCHANGED."

### PREPARE RECEIPT verbatim relay (applies to all 6 prepare tools)

**Source:** `src/tools/prepare_aave_supply.ts:254-260` template render pattern
**Apply to:** every Phase 33 prepare
**Pattern:** record VERBATIM agent args via `.replace("{SLOT}", rawSlot)` chain on the per-tool template. For composite rebalance, receipt records ONLY composite intent (tokenId + newTickLower + newTickUpper) — inner step args decode at preview time.

### LEDGER NOTICE unconditional emission (applies to all 6 prepare tools)

**Source:** `src/tools/prepare_uniswap_swap.ts` D-11 idiom (unconditional `LEDGER_NOTICE_UNISWAP_V3_TEMPLATE` in every response)
**Apply to:** every Phase 33 prepare tool — emit `LEDGER_NOTICE_UNISWAP_V3_LP_TEMPLATE` UNCONDITIONALLY per RESEARCH Topic 10 (NPM blind-signs on Ledger — no ERC-7730 coverage as of 2026-05-24).

### `INVALID_INPUT + hintTool` intent-vs-reality refusal (applies to mint/burn pre-flights)

**Source:** Phase 28/30/31/32 precedent; closest analog `src/tools/prepare_uniswap_swap.ts` D-07 approval pre-flight + D-08 sandwich-MEV gate
**Apply to:**
- `prepare_uniswap_v3_mint` + `_increase_liquidity` → approval-insufficient → `hintTool: "prepare_token_approve"` (per-token0/token1 hint)
- `prepare_uniswap_v3_mint` → snap-delta > 100 bps → `INVALID_INPUT` per D-03
- `prepare_uniswap_v3_burn` → liquidity > 0 → `hintTool: "prepare_uniswap_v3_decrease_liquidity"`; tokensOwed > 0 → `hintTool: "prepare_uniswap_v3_collect"`
- all tools → tokenId not found / not owned → `INVALID_INPUT`

### ESM spy-affordance indirection (applies to all new modules with cross-export internal calls)

**Source:** `CLAUDE.md` § Conventions
**Apply to (NEW indirections):**
- `_uniswapV3LpReader` in `src/chains/uniswap-v3-lp.ts`
- `_uniswapV3LpProtocol` in `src/protocols/uniswap-v3-lp.ts`
- `_uniswapV3Tick` in `src/signing/uniswap-tick.ts`
- `_uniswapV3Liquidity` in `src/signing/uniswap-liquidity.ts`
- `_uniswapV3Fees` in `src/signing/uniswap-fees.ts`
- `_uniswapV3Il` in `src/signing/uniswap-il.ts`
- `_uniswapV3PoolAddress` in `src/signing/uniswap-pool-address.ts`

### Promise.allSettled (NOT Promise.all) fan-out (applies to all RPC batch fan-outs)

**Source:** `src/chains/uniswap-v3.ts:229-251` Phase 32 Quoter V2 fan-out (T-32-QUOTER-REVERT-POISON mitigation)
**Apply to:** `src/chains/uniswap-v3-lp.ts` — every per-position RPC fan-out (positions, slot0, ticks). RESEARCH Topic 11 explicit: "one broken position (e.g. burned NFT race condition) doesn't poison the whole batch."

### SOT-getter delegation for `tx.to` (applies to all 6 prepare tools)

**Source:** `src/tools/prepare_aave_supply.ts:224-226` (NEVER inline; grep-zero assertion)
**Apply to:** every Phase 33 prepare → `getUniswapV3NonfungiblePositionManagerAddress(chainId)!` for `tx.to`. Plan-time grep guard: `grep "0xC36442b4a4522E871399CD717aBDD847Ab11FE88" src/ --include='*.ts' | grep -v config/contracts.ts` MUST return zero (per RESEARCH § Project Constraints + Phase 32 precedent for SwapRouter02 address).

### Cross-view byte-identity regression anchor

**Source:** `test/config-contracts.test.ts` T-UNISWAP-V3-SPENDER-DRIFT-1 pattern (Phase 32)
**Apply to:** `test/config-contracts.test.ts` — add T-UNISWAP-V3-NPM-SPENDER-DRIFT-1 mirroring the Phase 32 pattern: assert `KNOWN_SPENDERS_ETHEREUM` NPM row address === `getUniswapV3NonfungiblePositionManagerAddress(1)`.

---

## No Analog Found

| File / Pattern | Why no analog | What planner should reference instead |
|----------------|---------------|----------------------------------------|
| Module-load self-check in `src/signing/uniswap-pool-address.ts` | This is the FIRST runtime module-load assertion against a derived on-chain value in the codebase. `getAddress()`-wraps (canonical-dispatch.ts) catch corrupt literals but don't validate derivations. | RESEARCH § Code Examples lines 1072-1081 carries the verbatim pattern; Pitfall 6 anchors the discipline. |
| Composite-tx preview shape (`composite-multicall` arm at `preview_send`) | Phase 32's multicallWithDeadline arm is the closest, but it recurses against `SwapRouter02 selectors`; Phase 33 establishes the SAME-CONTRACT (NPM) recursion that v2.5 Safe three-step will reuse with an `operationsDecoder` plug-point. | RESEARCH § Topic 9 carries the verbatim shape; Pitfall 7 anchors the SHARED-decoder discipline (one `decodeSingleNpmCall` helper for both outer arm AND composite recursion). |
| Single-handle multi-step prepare (`prepare_uniswap_v3_rebalance`) | Closest analog `composeMulticallWithUnwrap` (Phase 32 `protocols/uniswap-v3.ts:343-349`) wraps 2 calls into 1 multicall, but Phase 33 wraps 3 calls AND uses the DIFFERENT multicall overload. The composite-handle shape itself is new. | `composeMulticallWithUnwrap` for the wrap-N-calls-into-one-multicall idiom + RESEARCH § Topic 9 (composite-tx preview shape) + RESEARCH § Code Examples lines 1120-1154 (composite calldata composition skeleton). |
| IL-estimate response shape (`get_lp_positions` IL fields) | No prior estimate-with-confidence-tier surface in the codebase. Lido's `approx: true` is the closest, but binary not tiered. | CONTEXT.md D-02 anchors `[ESTIMATE]` prefix + `ilEstimateConfidence: "low" \| "high"` discipline; RESEARCH § Topic 5 carries the exact response shape (lines 593-604). |

---

## Wave Dispatch Coordination

**Sequential wave landing (per Phase 9 + Phase 32 precedent):**
- Wave 1 (Plan 33-01) lands first → registers `get_lp_positions` + adds LEDGER NOTICE template + KNOWN_SPENDERS row + canonical-dispatch row + all 5 `src/signing/uniswap-*` pure-math modules + `src/chains/uniswap-v3-lp.ts`.
- Wave 2 (Plan 33-02) lands second → registers 5 prepare tools + protocols/uniswap-v3-lp.ts + 5 selector dispatch arms at preview_send + 5 PREPARE RECEIPT templates + Fixtures UNI-LP-{A..E}.
- Wave 3 (Plan 33-03) lands third → registers `prepare_uniswap_v3_rebalance` + composite-multicall arm at preview_send + Fixture UNI-LP-F + 6-fixture distinct set + persona-cycle integration test re-anchoring all 6.

**Register-all merge coordination:** Both Plan 33-02 (5 lines) AND Plan 33-03 (1 line) modify `src/tools/register-all.ts`. Plan 33-03's import goes AFTER Plan 33-02's block. Strict 1→2→3 sequential dispatch — NO parallel waves.

**Within Plan 33-01:** All 5 sibling `src/signing/uniswap-{tick,liquidity,fees,il,pool-address}.ts` files have NO inter-dependency (each is a pure-math module) — can be written in parallel sub-tasks.

**Within Plan 33-02:** All 5 prepare tools depend on `src/protocols/uniswap-v3-lp.ts` (Wave 2's first task) — write protocol module FIRST, then the 5 prepares can land in parallel sub-tasks.

---

## Metadata

**Analog search scope:** `src/tools/`, `src/protocols/`, `src/chains/`, `src/signing/`, `src/security/`, `src/config/`, `test/` (top-level)
**Files scanned (read in full or in targeted ranges):** 12 source files (prepare_aave_supply.ts, prepare_uniswap_swap.ts L1-200, protocols/uniswap-v3.ts, signing/uniswap-path.ts, chains/aave-v3.ts, chains/uniswap-v3.ts, security/canonical-dispatch.ts, config/contracts.ts L700-1000, tools/preview_send.ts L320-465 + L960-1010, signing/blocks.ts L2030-2350, tools/get_lido_positions.ts, tools/register-all.ts) + 2 test files (signing-fingerprint.test.ts L534-710, grep across test/)
**Pattern extraction date:** 2026-05-24
