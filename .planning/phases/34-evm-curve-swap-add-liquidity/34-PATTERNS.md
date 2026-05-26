# Phase 34: evm-curve-swap-add-liquidity — Pattern Map

**Mapped:** 2026-05-26
**Files analyzed:** 13 new/modified files (across 3 plans)
**Analogs found:** 13 / 13

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/config/contracts.ts` | config-sot | CRUD | `src/config/contracts.ts` (Phase 32 UniV3 arm) | exact-extension |
| `src/chains/curve.ts` | chain-client | request-response | `src/chains/aave-v3.ts` | exact |
| `src/tools/get_curve_positions.ts` | tool (read-only) | CRUD | `src/tools/get_eigenlayer_positions.ts` + `get_lido_positions.ts` | exact |
| `src/tools/prepare_curve_swap.ts` | tool (prepare) | request-response | `src/tools/prepare_uniswap_swap.ts` | exact |
| `src/tools/prepare_curve_add_liquidity.ts` | tool (prepare) | request-response | `src/tools/prepare_uniswap_v3_mint.ts` | role-match |
| `src/protocols/curve.ts` | protocol-decoder | request-response | `src/protocols/uniswap-v3.ts` | exact |
| `src/security/canonical-dispatch.ts` | middleware | request-response | existing file — Phase 32/33 arm pattern | exact-extension |
| `src/tools/preview_send.ts` | tool (preview) | request-response | existing file — Phase 32/33 selector-dispatch extension | exact-extension |
| `src/tools/register-all.ts` | config | N/A | existing file — Phase 32/33 import slots | exact-extension |
| `test/signing-fingerprint.test.ts` | test | N/A | Phase 32 UNI-A/B/C fixture block | exact-extension |
| `test/protocols/curve.test.ts` | test | N/A | `test/protocols-uniswap-v3.test.ts` | exact |
| `test/chains/curve.test.ts` | test | N/A | `test/chains-aave-v3.test.ts` | role-match |
| `test/tools/get_curve_positions.test.ts` + `prepare_curve_swap.test.ts` + `prepare_curve_add_liquidity.test.ts` | test | N/A | Phase 32/33 tool test files | role-match |

---

## Pattern Assignments

---

### `src/config/contracts.ts` (config-sot — extend with Curve sub-table)

**Analog:** `src/config/contracts.ts` — Phase 32 `UniswapV3Contracts` + `UNISWAP_V3_RAW` pattern (lines 735–791) combined with Phase 31 `EigenLayerContracts` pattern (lines 469–603) for the per-pool inner-record shape.

**Sibling sub-table pattern** (Phase 32, lines 735–757):
```typescript
// Sibling sub-table (NOT a widening of `ContractsForChain`) per Phase 28/29/30/31/32 precedent.
export interface UniswapV3Contracts {
  swapRouter02: Address;
  quoterV2: Address;
  nonfungiblePositionManager: Address;
}

const UNISWAP_V3_RAW: Partial<Record<ChainId, UniswapV3Contracts>> = {
  1: {
    swapRouter02:               getAddress("0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45"),
    quoterV2:                   getAddress("0x61fFE014bA17989E743c5F6cB21bF9697530B21e"),
    nonfungiblePositionManager: getAddress("0xC36442b4a4522E871399CD717aBDD847Ab11FE88"),
  },
};
```

**Per-pool array registry pattern** (adapt from EigenLayer inner-record shape, lines 503–531):
```typescript
// For Phase 34, the Curve sub-table is:
//   Partial<Record<ChainId, CurvePoolEntry[]>>
// where CurvePoolEntry is the per-pool typed struct (one entry per pool).
// This differs from EigenLayer's per-LST inner Record: Curve pools are a flat
// array (no symbolic key), ordered by TVL at snapshot time.

export type CurvePoolAbiVersion = "legacy" | "stable_ng";

export interface CurvePoolEntry {
  address: Address;
  abiVersion: CurvePoolAbiVersion;
  coins: Address[];
  coinDecimals: number[];
  lpToken: Address;          // pool address === lpToken for stable_ng; separate for legacy
  displayName: string;
}
```

**Fan-out getter** (copy from `getAllCompoundCometsForChain`, lines 292–296):
```typescript
export function getAllCurvePoolsForChain(chainId: ChainId): CurvePoolEntry[] {
  const row = CURVE_POOLS_RAW[chainId];
  if (!row) return [];
  return [...row];  // defensive copy
}

export function getCurvePoolByAddress(
  chainId: ChainId,
  poolAddress: Address,
): CurvePoolEntry | undefined {
  return CURVE_POOLS_RAW[chainId]?.find(
    (p) => p.address === getAddress(poolAddress),
  );
}
```

**KNOWN_SPENDERS_ETHEREUM promotion pattern** (Phase 32, lines 958–963):
```typescript
// Address delegated to SOT getter per Phase 32 D-13a pattern; promoted from inline
// literal to break the drift seam between this view and canonical-dispatch.ts.
// Cross-checked by T-CURVE-SPENDER-DRIFT-1.
{
  address: getAllCurvePoolsForChain(1)[INDEX]!.address,
  label: "Curve {pool.displayName}",
  source: "https://curve.finance",
},
```
One entry per pool — 11 total (1 legacy + 10 stable_ng). Use a loop or spread to avoid 11 redundant object literals; see EigenLayer strategy pattern.

**Format-fanout-sentinel:** every `address` literal is wrapped in `getAddress(...)` at the literal site.

---

### `src/chains/curve.ts` (chain-client, request-response)

**Analog:** `src/chains/aave-v3.ts` (full file, 149 lines)

**Imports pattern** (aave-v3.ts lines 1–18):
```typescript
// src/chains/curve.ts
import { type Address, type PublicClient, parseAbi } from "viem";

import { getAllCurvePoolsForChain, getCurvePoolByAddress, type ChainId } from "../config/contracts.js";
```

**parseAbi struct-refs pattern for multi-shape ABIs** (aave-v3.ts lines 37–43):
```typescript
// Each ABI is a SEPARATE export so callers can import by name (prevent confusion).
// Mirrors SWAP_ROUTER_02_ABI / QUOTER_V2_ABI separation in uniswap-v3.ts.

export const CURVE_LEGACY_EXCHANGE_ABI = parseAbi([
  "function exchange(int128 i, int128 j, uint256 dx, uint256 min_dy) payable returns (uint256)",
]);

export const CURVE_NG_EXCHANGE_ABI = parseAbi([
  "function exchange(int128 i, int128 j, uint256 _dx, uint256 _min_dy, address _receiver) returns (uint256)",
]);

export const CURVE_GET_DY_ABI = parseAbi([
  // Same 3-param signature across legacy AND stable_ng — pool wraps views internally.
  "function get_dy(int128 i, int128 j, uint256 dx) view returns (uint256)",
]);

export const CURVE_NG_ADD_LIQUIDITY_ABI = parseAbi([
  // 2-param form (no _receiver) per CONTEXT.md locked decision.
  "function add_liquidity(uint256[] _amounts, uint256 _min_mint_amount) returns (uint256)",
]);

export const CURVE_NG_CALC_TOKEN_AMOUNT_ABI = parseAbi([
  "function calc_token_amount(uint256[] _amounts, bool _is_deposit) view returns (uint256)",
]);

// balanceOf for LP-token reads (stable_ng: lpToken === pool; legacy: separate ERC-20).
export const CURVE_LP_BALANCE_OF_ABI = parseAbi([
  "function balanceOf(address owner) view returns (uint256)",
]);
```

**readContract helper pattern** (aave-v3.ts lines 100–138):
```typescript
export async function getCurveGetDy(
  client: PublicClient,
  poolAddress: Address,
  i: number,
  j: number,
  dx: bigint,
): Promise<bigint> {
  return (await client.readContract({
    address: poolAddress,
    abi: CURVE_GET_DY_ABI,
    functionName: "get_dy",
    args: [BigInt(i), BigInt(j), dx],   // int128 encoded as bigint in viem
  })) as bigint;
}

export async function getCurveCalcTokenAmount(
  client: PublicClient,
  poolAddress: Address,
  amounts: bigint[],
): Promise<bigint> {
  return (await client.readContract({
    address: poolAddress,
    abi: CURVE_NG_CALC_TOKEN_AMOUNT_ABI,
    functionName: "calc_token_amount",
    args: [amounts, true],   // true = deposit
  })) as bigint;
}

export async function getCurveLpBalance(
  client: PublicClient,
  lpTokenAddress: Address,
  wallet: Address,
): Promise<bigint> {
  return (await client.readContract({
    address: lpTokenAddress,
    abi: CURVE_LP_BALANCE_OF_ABI,
    functionName: "balanceOf",
    args: [wallet],
  })) as bigint;
}
```

**ESM spy-affordance** (aave-v3.ts line 148):
```typescript
// Per CLAUDE.md "ESM spy-affordance indirection" convention.
export const _curveChain = { getCurveGetDy, getCurveCalcTokenAmount, getCurveLpBalance };
```

---

### `src/tools/get_curve_positions.ts` (tool, read-only)

**Analog:** `src/tools/get_eigenlayer_positions.ts` (multi-position fan-out + zero-filter + rpcDegraded) + `src/tools/get_lido_positions.ts` (structuredContent shape)

**Imports pattern** (get_eigenlayer_positions.ts lines 26–31):
```typescript
import { formatUnits, getAddress, isAddress, type Address } from "viem";

import { _curveChain } from "../chains/curve.js";
import { getChainClient, isPublicNodeFallback } from "../chains/registry.js";
import { getAllCurvePoolsForChain } from "../config/contracts.js";
import { makeStructuredError } from "../signing/error-codes.js";
import { registerTool } from "./index.js";
```

**READ-ONLY-by-construction invariant:** `createHandle` MUST NOT appear anywhere in `src/tools/get_curve_positions.ts`. The test file asserts this via an import-graph grep (see test section below). Do NOT add `createHandle` to this file.

**Chain gate + wallet validation pattern** (get_eigenlayer_positions.ts lines 70–113):
```typescript
registerTool("get_curve_positions", DESCRIPTION, INPUT_SCHEMA, async (args) => {
  // (a) Chain gate — default to "ethereum" when omitted; refuse anything else.
  const chainRaw = args.chain;
  const chainName = typeof chainRaw === "string" ? chainRaw : "ethereum";
  if (chainName !== "ethereum") {
    return {
      isError: true,
      content: [{ type: "text", text: `error: \`chain\` must be "ethereum" — Curve pools are Ethereum-mainnet-only (got "${chainName}")` }],
      structuredContent: { ...makeStructuredError("CHAIN_ID_MISMATCH", `\`chain\` must be "ethereum"; got "${chainName}"`) },
    };
  }

  // (b) Validate wallet address.
  const walletRaw = args.wallet;
  if (typeof walletRaw !== "string" || !isAddress(walletRaw, { strict: false })) {
    return {
      isError: true,
      content: [{ type: "text", text: "error: `wallet` must be a valid 0x-prefixed EVM address" }],
      structuredContent: { ...makeStructuredError("INVALID_INPUT", "`wallet` must be a valid 0x-prefixed EVM address") },
    };
  }
  const wallet: Address = getAddress(walletRaw);
```

**Fan-out + zero-filter pattern** (adapt from get_eigenlayer_positions.ts lines 119–155):
```typescript
  const chainId = 1;
  const client = getChainClient(chainId);
  const pools = getAllCurvePoolsForChain(chainId);

  // Parallel balanceOf reads across all registered pools (one per lpToken address).
  const balances = await Promise.allSettled(
    pools.map((pool) => _curveChain.getCurveLpBalance(client, pool.lpToken, wallet)),
  );

  // Filter zero-balance pools (consistent with get_aave_v3_positions pattern).
  const positions: PositionEntry[] = [];
  let rpcDegraded = false;
  for (let i = 0; i < pools.length; i++) {
    const result = balances[i];
    if (result.status === "rejected") {
      rpcDegraded = true;
      continue;
    }
    if (result.value === 0n) continue;  // zero-filter
    positions.push({ pool: pools[i], lpBalance: result.value });
  }
```

**structuredContent shape** (get_eigenlayer_positions.ts lines 143–157):
```typescript
  const structuredContent: Record<string, unknown> = {
    chain: "ethereum",
    chainId,
    wallet,
    positions: positions.map((p) => ({
      poolAddress: p.pool.address,
      displayName: p.pool.displayName,
      abiVersion: p.pool.abiVersion,
      lpBalance: p.lpBalance.toString(),
      lpDecimals: 18,
      coins: p.pool.coins.map((addr, idx) => ({
        address: addr,
        decimals: p.pool.coinDecimals[idx],
      })),
    })),
  };
  if (rpcDegraded || isPublicNodeFallback(chainId)) {
    structuredContent.rpcDegraded = true;
  }
```

---

### `src/tools/prepare_curve_swap.ts` (tool, prepare)

**Analog:** `src/tools/prepare_uniswap_swap.ts` (full file, 829 lines) — closest structural match. The abiVersion dispatch + slippage + on-chain quote + approval pre-flight flow mirrors the UniV3 pattern.

**Imports pattern** (prepare_uniswap_swap.ts lines 51–87):
```typescript
import {
  type Address,
  type Hex,
  erc20Abi,
  formatUnits,
  getAddress,
  isAddress,
} from "viem";

import { getChainClient } from "../chains/registry.js";
import { _curveChain } from "../chains/curve.js";
import { getCurvePoolByAddress } from "../config/contracts.js";
import { _curveProtocol } from "../protocols/curve.js";
import { InvalidAmountError, parseAmountStrict } from "../signing/amount.js";
import { type ErrorCode, type StructuredError, makeStructuredError } from "../signing/error-codes.js";
import { createHandle } from "../signing/handle-store.js";
import { computePayloadFingerprint } from "../signing/payload-fingerprint.js";
import { resolveFrom } from "../signing/resolve-from.js";
import { registerTool } from "./index.js";
```

**errEnvelope helper** (prepare_uniswap_swap.ts lines 88–98):
```typescript
function errEnvelope(code: ErrorCode, message: string, cause?: string): Record<string, unknown> {
  return makeStructuredError(code, message, cause) as unknown as Record<string, unknown> & StructuredError;
}
```

**Chain gate + poolAddress lookup + token index resolution** (prepare_uniswap_swap.ts lines 190–276 adapted):
```typescript
  // Chain gate (Curve is Ethereum-only at Phase 34 scope).
  const chainName = typeof args.chain === "string" ? args.chain : "";
  if (chainName !== "ethereum") { /* INVALID_INPUT */ }
  const chainId = 1;

  // Pool registry lookup — must be in curated list.
  const poolAddrRaw = typeof args.poolAddress === "string" ? args.poolAddress : "";
  if (!isAddress(poolAddrRaw)) { /* INVALID_INPUT */ }
  const poolAddress = getAddress(poolAddrRaw);
  const pool = getCurvePoolByAddress(chainId, poolAddress);
  if (!pool) {
    return errEnvelope("INVALID_INPUT", `poolAddress ${poolAddress} not in curated Curve registry`, "pool-not-in-registry");
  }

  // Token index resolution — user passes addresses, server resolves i/j.
  const i = pool.coins.findIndex((c) => getAddress(c) === getAddress(inputToken));
  const j = pool.coins.findIndex((c) => getAddress(c) === getAddress(outputToken));
  if (i === -1) return errEnvelope("INVALID_INPUT", `inputToken not in pool coins[]`);
  if (j === -1) return errEnvelope("INVALID_INPUT", `outputToken not in pool coins[]`);
```

**Decimal-string → wei conversion via registry** (prepare_uniswap_swap.ts step 8, adapted):
```typescript
  // Decimal-string boundary: use per-pool coinDecimals (NOT get_token_metadata).
  // Pool coinDecimals is the SOT per CLAUDE.md decimal-aware arithmetic invariant.
  const tokenInDecimals = pool.coinDecimals[i];
  const rawAmount = typeof args.amount === "string" ? args.amount : "";
  let amountIn: bigint;
  try {
    amountIn = parseAmountStrict(rawAmount, tokenInDecimals);
  } catch (err) { /* InvalidAmountError handling */ }
```

**slippageBps mandatory (no default) pattern** — Phase 34 differs from UniV3: `slippageBps` is REQUIRED per CONTEXT.md decisions, no default. Schema has it in `required[]`.

**On-chain quote + slippage math pattern** (prepare_uniswap_swap.ts step 9/16 + CONTEXT.md Pattern 3):
```typescript
  // RE-FETCH quote at PREPARE time (NOT cached per anti-pattern discipline).
  const client = getChainClient(chainId);
  const quotedDy = await _curveChain.getCurveGetDy(client, pool.address, i, j, amountIn);
  const minDy = (quotedDy * (10000n - BigInt(slippageBps))) / 10000n;
  // NEVER: Number(quotedDy) * (1 - slippageBps/10000) — float is forbidden.
```

**abiVersion dispatch pattern** (CONTEXT.md Pattern 1 + RESEARCH.md Code Examples):
```typescript
  const isEthIn = pool.abiVersion === "legacy" && i === 0; // ETH sentinel = coin 0 on legacy
  let data: Hex;
  let valueWei: bigint;
  if (pool.abiVersion === "legacy") {
    data = _curveProtocol.encodeExchangeLegacy({ i, j, dx: amountIn, minDy });
    valueWei = isEthIn ? amountIn : 0n;
  } else {
    // stable_ng: _receiver = signer (from-dependent calldata for Fixture CRV-B).
    data = _curveProtocol.encodeExchangeStableNg({ i, j, dx: amountIn, minDy, receiver: fromAddress });
    valueWei = 0n;
  }
```

**Handle + payloadFingerprint + 3-block return** (prepare_uniswap_swap.ts steps 19–22):
```typescript
  const tx = { chainId, to: pool.address, valueWei, data };
  const payloadFingerprint = computePayloadFingerprint(tx);
  const handle = createHandle({ args: { ... }, tx, payloadFingerprint });

  // Return 3 text blocks: PREPARE RECEIPT + CHECKS PERFORMED + (no LEDGER NOTICE
  // for Curve — no ERC-7730 blind-sign risk analogous to UniV3 multicall since
  // pool contracts are not wrapped in a multicall).
  return {
    content: [
      { type: "text", text: receipt },
      { type: "text", text: checksPerformed },
    ],
    structuredContent: { handle, chainId, from: fromAddress, to: pool.address, valueWei: valueWei.toString(), data, payloadFingerprint, ... },
  };
```

**ERC-20 approval pre-flight** (prepare_uniswap_swap.ts step 15): skip when `isEthIn` (ETH needs no approval). For non-ETH tokenIn, read `ERC20.allowance(from, poolAddress)` — the pool address is the spender for Curve (not a separate router).

**Outer catch** (prepare_uniswap_swap.ts lines 811–827):
```typescript
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      isError: true,
      content: [{ type: "text", text: `error: prepare_curve_swap failed: ${message}` }],
      structuredContent: errEnvelope("INTERNAL_ERROR", "prepare_curve_swap failed", message),
    };
  }
```

---

### `src/tools/prepare_curve_add_liquidity.ts` (tool, prepare)

**Analog:** `src/tools/prepare_uniswap_v3_mint.ts` (multi-amount + slippage + approval pre-flight shape) with `src/tools/prepare_uniswap_swap.ts` error-handling discipline.

**Key differences from `prepare_curve_swap.ts`:**
- Takes `amounts: string[]` (one per pool coin) instead of single `amount`.
- Validates `amounts.length === pool.coins.length` before any other work.
- Refuses when `pool.abiVersion === "legacy"` with structured error `"add_liquidity on legacy pools deferred to v2.4.x"`.
- Uses `CURVE_NG_ADD_LIQUIDITY_ABI` + `CURVE_NG_CALC_TOKEN_AMOUNT_ABI`.
- Needs ERC-20 approval pre-flight on EVERY non-zero-amount coin (fan-out like mint's dual-token check in prepare_uniswap_v3_mint.ts).

**amounts.length validation** (RESEARCH.md Pitfall 5):
```typescript
  const rawAmounts: string[] = Array.isArray(args.amounts) ? args.amounts as string[] : [];
  if (rawAmounts.length !== pool.coins.length) {
    return {
      isError: true,
      content: [{ type: "text", text: `error: amounts.length (${rawAmounts.length}) !== pool.coins.length (${pool.coins.length})` }],
      structuredContent: errEnvelope("INVALID_INPUT", `amounts.length (${rawAmounts.length}) !== pool.coins.length (${pool.coins.length})`),
    };
  }
```

**Legacy refusal:**
```typescript
  if (pool.abiVersion === "legacy") {
    return {
      isError: true,
      content: [{ type: "text", text: `error: add_liquidity on legacy Curve pools is deferred to v2.4.x; use a stable_ng pool` }],
      structuredContent: errEnvelope("INVALID_INPUT", "add_liquidity on legacy pools deferred to v2.4.x", "legacy-add-liquidity-refused"),
    };
  }
```

**Multi-amount parse + on-chain quote + slippage:**
```typescript
  // Parse each amount using per-pool coinDecimals[idx] (SOT per CLAUDE.md).
  const parsedAmounts: bigint[] = rawAmounts.map((raw, idx) =>
    parseAmountStrict(raw, pool.coinDecimals[idx]),
  );
  const quotedLp = await _curveChain.getCurveCalcTokenAmount(client, pool.address, parsedAmounts);
  const minMintAmount = (quotedLp * (10000n - BigInt(slippageBps))) / 10000n;
```

---

### `src/protocols/curve.ts` (protocol-decoder, calldata-encoder)

**Analog:** `src/protocols/uniswap-v3.ts` (full file — selector table + ABI fragments + encoder functions + ESM spy-affordance)

**Imports pattern** (uniswap-v3.ts lines 74–95):
```typescript
import {
  type Address,
  type Hex,
  encodeFunctionData,
  parseAbi,
} from "viem";

// Re-export SOT getters so callers inside src/protocols/, src/chains/, src/tools/
// import from one locality. Mirror of uniswap-v3.ts lines 91-95.
export { getAllCurvePoolsForChain, getCurvePoolByAddress } from "../config/contracts.js";
export type { ChainId, CurvePoolEntry, CurvePoolAbiVersion } from "../config/contracts.js";
```

**ABI fragments** — declare the 3 + helper ABIs inline (same as CURVE_LEGACY_EXCHANGE_ABI etc. in the chains file, but the protocols file owns the ENCODER side; chains file owns the READER side). Follow `SWAP_ROUTER_02_ABI` / `QUOTER_V2_ABI` separation idiom — each ABI is a named export.

**Selector table pattern** (uniswap-v3.ts lines 179–192):
```typescript
// Verified via viem.toFunctionSelector at research time 2026-05-26.
export const CURVE_SELECTORS = {
  /** Legacy exchange — stETH/ETH pool. selector = 0x3df02124 */
  exchangeLegacy: "0x3df02124" as Hex,
  /** stable_ng exchange with _receiver. selector = 0xddc1f59d */
  exchangeNg: "0xddc1f59d" as Hex,
  /** stable_ng add_liquidity (uint256[], uint256) — 2-param form. selector = 0xb72df5de */
  addLiquidityNg: "0xb72df5de" as Hex,
  /** get_dy — same across legacy and stable_ng. selector = 0x5e0d443f */
  getDy: "0x5e0d443f" as Hex,
  /** calc_token_amount — stable_ng. selector = 0x3db06dd8 */
  calcTokenAmount: "0x3db06dd8" as Hex,
} as const;
```

**Encoder parameter interfaces** (uniswap-v3.ts lines 198–214):
```typescript
export interface ExchangeLegacyParams {
  i: number;  j: number;  dx: bigint;  minDy: bigint;
}
export interface ExchangeStableNgParams {
  i: number;  j: number;  dx: bigint;  minDy: bigint;  receiver: Address;
}
export interface AddLiquidityStableNgParams {
  amounts: bigint[];  minMintAmount: bigint;
}
```

**Encoder functions** (uniswap-v3.ts lines 236–278 pattern):
```typescript
export function encodeExchangeLegacy(params: ExchangeLegacyParams): Hex {
  return encodeFunctionData({
    abi: CURVE_LEGACY_EXCHANGE_ABI,
    functionName: "exchange",
    args: [BigInt(params.i), BigInt(params.j), params.dx, params.minDy],
  });
}
export function encodeExchangeStableNg(params: ExchangeStableNgParams): Hex {
  return encodeFunctionData({
    abi: CURVE_NG_EXCHANGE_ABI,
    functionName: "exchange",
    args: [BigInt(params.i), BigInt(params.j), params.dx, params.minDy, params.receiver],
  });
}
export function encodeAddLiquidityStableNg(params: AddLiquidityStableNgParams): Hex {
  return encodeFunctionData({
    abi: CURVE_NG_ADD_LIQUIDITY_ABI,
    functionName: "add_liquidity",
    args: [params.amounts, params.minMintAmount],
  });
}
```

**Preview decoder for preview_send** (adapt from `decodeUniswapV3Call` in preview_send.ts lines 348–430):
```typescript
// Exported for preview_send.ts dispatch. Mirrors decodeUniswapV3Call shape.
export function decodeCurveCall(
  data: Hex,
  poolAddress: Address,
  chainId: ChainId,
): CurveDecoded | null {
  const pool = getCurvePoolByAddress(chainId, poolAddress);
  if (!pool) return null;
  const sel = data.slice(0, 10).toLowerCase() as Hex;
  try {
    if (pool.abiVersion === "legacy" && sel === CURVE_SELECTORS.exchangeLegacy) { ... }
    if (pool.abiVersion === "stable_ng" && sel === CURVE_SELECTORS.exchangeNg) { ... }
    if (sel === CURVE_SELECTORS.addLiquidityNg) { ... }
    return null;
  } catch { return null; }
}
```

**ESM spy-affordance** (uniswap-v3.ts line pattern — but protocol file exports individual functions directly, indirection only for internal cross-calls):
```typescript
export const _curveProtocol = {
  encodeExchangeLegacy,
  encodeExchangeStableNg,
  encodeAddLiquidityStableNg,
  decodeCurveCall,
};
```

---

### `src/security/canonical-dispatch.ts` (extend)

**Analog:** Phase 33 NPM arm (lines 193–198), Phase 32 SwapRouter02 arm (lines 180–185), Phase 31 Rocket Pool arm (lines 171–175) — all in the same `buildPerChainAllowlist` function.

**New Curve arm to insert** (after Phase 33 `uniswapV3LpEntries` block, before the `return new Set<Address>` call):
```typescript
// Phase 34 — Curve pool dispatch allowlist arm (Ethereum arm only).
// Each pool address is BOTH a dispatch target (tx.to for exchange/add_liquidity)
// AND a spender (ERC-20 approval via transferFrom at the pool contract).
// Non-Ethereum chains: getAllCurvePoolsForChain returns [] → spread adds nothing.
const curvePools = getAllCurvePoolsForChain(chainId);
const curveEntries: Address[] = curvePools.map((p) => p.address);
```

**Import addition** — add `getAllCurvePoolsForChain` to the existing import from `"../config/contracts.js"` (lines 62–75).

**Set builder** — add `...curveEntries,` to the `new Set<Address>([...])` call (lines 199–212).

---

### `src/tools/preview_send.ts` (extend — selector-dispatch arm)

**Analog:** Phase 32 Uniswap V3 SwapRouter02 arm (preview_send.ts lines 1227–1245) and Phase 33 NPM arm (lines 1250–1274) — both follow the identical `(tx.to, selector)` tuple dispatch pattern.

**New import** (after the Phase 33 LP import block, lines 107–111):
```typescript
import {
  CURVE_SELECTORS,
  _curveProtocol,
  type CurveDecoded,
} from "../protocols/curve.js";
import {
  getCurvePoolByAddress as _getCurvePoolByAddress,
} from "../config/contracts.js";
```

**Selector-dispatch arm** (insert after the Phase 33 `multicallBytes` arm, before the closing of the selector if-chain):
```typescript
} else if (
  sel === CURVE_SELECTORS.exchangeLegacy ||
  sel === CURVE_SELECTORS.exchangeNg ||
  sel === CURVE_SELECTORS.addLiquidityNg
) {
  // Phase 34 — Curve (to, selector) tuple dispatch DECODED ARGS arm.
  // tx.to MUST be a curated Curve pool address — prevents mis-routing
  // (any Vyper pool could share a 4-byte selector).
  const curvePool = _getCurvePoolByAddress(record.tx.chainId as ChainId, record.tx.to as Address);
  if (curvePool) {
    curveDecoded = _curveProtocol.decodeCurveCall(
      record.tx.data as Hex,
      record.tx.to as Address,
      record.tx.chainId as ChainId,
    );
  }
```

**CHECKS PERFORMED output** — emit `[CURVE SWAP]` or `[CURVE ADD LIQUIDITY]` block. Include the line:
```
Sandwich-MEV gate: not applied to Curve (low MEV exposure on stable pools)
```

---

### `src/tools/register-all.ts` (extend — two disjoint slots)

**Analog:** Phase 32 import (line 103) near `prepare_uniswap_swap`, Phase 33 LP imports (lines 104–110) after that.

**Carving rule for parallel execution (Plan 34-02 vs Plan 34-03):**

The `register-all.ts` import file has clear phase-based sections. Plans 34-02 and 34-03 can run in parallel because they insert at DISJOINT lines:

- **Plan 34-02 slot** — insert after Phase 33 LP tools (line 110, after `prepare_uniswap_v3_rebalance`), BEFORE `simulate_position_change`:
  ```typescript
  import "./get_curve_positions.js"; // Phase 34 Plan 34-02 (CRV-01) — LP balances multicall + zero-filter
  ```

- **Plan 34-03 slot** — insert IMMEDIATELY AFTER the 34-02 slot:
  ```typescript
  import "./prepare_curve_swap.js";          // Phase 34 Plan 34-03 (CRV-02) — per-abiVersion exchange + on-chain get_dy quote
  import "./prepare_curve_add_liquidity.js"; // Phase 34 Plan 34-03 (CRV-03) — stable_ng add_liquidity + calc_token_amount quote
  ```

**Parallel execution verdict:** PARALLEL-SAFE. Plan 34-02 lands one import at line ~111; Plan 34-03 lands two imports at lines ~112–113. No overlap. Both are git-additive (no line deletion), so they can rebase cleanly. If both branch from the same base, Plan 34-03 rebases over 34-02's single-line addition with zero conflict.

**Pattern for the comment annotation** (matching lines 103–104):
```typescript
import "./get_curve_positions.js";    // Phase 34 Plan 34-02 (CRV-01) — Curve LP balances multicall + zero-filter + per-pool composition
import "./prepare_curve_swap.js";     // Phase 34 Plan 34-03 (CRV-02) — Curve swap per-abiVersion (legacy/stable_ng) + on-chain get_dy quote + min_dy derivation
import "./prepare_curve_add_liquidity.js"; // Phase 34 Plan 34-03 (CRV-03) — stable_ng add_liquidity + calc_token_amount + registry-validated amounts.length
```

---

### `test/signing-fingerprint.test.ts` (extend — Fixtures CRV-A/B/C)

**Analog:** Phase 32 Fixtures UNI-A/B/C block (test/signing-fingerprint.test.ts lines 544–716)

**Describe-block header pattern** (lines 544–558):
```typescript
// ===========================================================================
// Phase 34 Plan 34-01 — Fixtures CRV-A / CRV-B / CRV-C
// ===========================================================================
//
// Three canonical Curve calldata shapes anchored as hardcoded 0x...
// payloadFingerprint literals per CLAUDE.md cryptographic-binding fixture
// discipline ("NO `beforeAll`-snapshot" rule).
//
// FIXTURE_PERSONA = Anvil account 1 (0x70997970...) — same as Phase 32 UNI-A/B/C
// + Phase 30 Fixture W.
//
// CRV-A: legacy exchange on stETH/ETH — from-INDEPENDENT (no _receiver in calldata).
// CRV-B: stable_ng exchange with _receiver = FIXTURE_PERSONA — from-DEPENDENT.
//   Integration tests in test/prepare-curve-swap.test.ts prove from-independence
//   for CRV-A and re-anchor CRV-B against the literal when persona matches.
// CRV-C: stable_ng add_liquidity(uint256[] 3-coin) — proves dynamic-array calldata is byte-stable.
```

**Fixture literal declaration pattern** (lines 560–565):
```typescript
const FIXTURE_CRV_A_FP = "0x..."; // computed at write-time (2026-05-XX) — NO `beforeAll`-snapshot
const FIXTURE_CRV_B_FP = "0x...";
const FIXTURE_CRV_C_FP = "0x...";
```

**Single fixture test structure** (lines 567–613 pattern):
```typescript
it("Fixture CRV-A — legacy exchange(i=1, j=0, dx=1e18 stETH, min_dy=...) on stETH/ETH pool fingerprint (hardcoded literal anchor, Phase 34 Plan 34-01)", () => {
  const stEthPool = getAddress("0xDC24316b9AE028F1497c275EB9192a3Ea0f67022");
  const data = encodeExchangeLegacy({ i: 1, j: 0, dx: 1_000000000000000000n, minDy: COMPUTED_MIN_DY });

  // Selector assertion BEFORE fingerprint assertion — encoder drift fires first.
  expect(data.slice(0, 10).toLowerCase()).toBe("0x3df02124");

  const fp = computePayloadFingerprint({
    chainId: 1,
    to: stEthPool,
    valueWei: 0n,   // j=0 (ETH-out) — no ETH-in
    data,
  });

  // Hardcoded literal — computed at write-time. NO `beforeAll`-snapshot.
  // Fixture CRV-A cross-link: test/prepare-curve-swap.test.ts re-anchors via this literal.
  expect(fp).toBe(FIXTURE_CRV_A_FP);
});
```

**from-dependence assertion for CRV-B** (Fixture W / Phase 30 pattern):
```typescript
it("Fixture CRV-B — stable_ng exchange(i, j, dx, min_dy, _receiver=FIXTURE_PERSONA) fingerprint (hardcoded literal anchor, Phase 34 Plan 34-01)", () => {
  const persona = getAddress("0x70997970C51812dc3A010C7d01b50e0d17dc79C8");
  const stableNgPool = getAddress("..."); // e.g. PayPool (PYUSD/USDC)
  const data = encodeExchangeStableNg({ i: 0, j: 1, dx: 100_000000n, minDy: ..., receiver: persona });

  // Selector assertion.
  expect(data.slice(0, 10).toLowerCase()).toBe("0xddc1f59d");

  const fp = computePayloadFingerprint({ chainId: 1, to: stableNgPool, valueWei: 0n, data });
  expect(fp).toBe(FIXTURE_CRV_B_FP);
});
```

**3-pool distinctness assertion** (lines 709–716 pattern):
```typescript
it("Fixtures CRV-A / CRV-B / CRV-C produce 3 distinct fingerprints", () => {
  const distinct = new Set([FIXTURE_CRV_A_FP, FIXTURE_CRV_B_FP, FIXTURE_CRV_C_FP]);
  expect(distinct.size).toBe(3);
});
```

---

### `test/protocols/curve.test.ts` (new)

**Analog:** `test/protocols-uniswap-v3.test.ts` (80+ lines) — selector byte-identity cross-assertions + encoder calldata assertions

**Structure pattern** (protocols-uniswap-v3.test.ts lines 1–80):
```typescript
// test/protocols-curve.test.ts
import { describe, expect, it } from "vitest";
import { getAddress, toFunctionSelector, type Address } from "viem";

import {
  CURVE_SELECTORS,
  _curveProtocol,
  encodeExchangeLegacy,
  encodeExchangeStableNg,
  encodeAddLiquidityStableNg,
} from "../src/protocols/curve.js";

describe("CURVE_SELECTORS byte-identity (Phase 34 Plan 34-01)", () => {
  it("exchangeLegacy === toFunctionSelector('function exchange(int128,int128,uint256,uint256)')", () => {
    expect(CURVE_SELECTORS.exchangeLegacy).toBe(
      toFunctionSelector("function exchange(int128,int128,uint256,uint256)"),
    );
  });
  // ... one test per selector
});

describe("Curve calldata encoders — selector prefix + length", () => {
  it("encodeExchangeLegacy — 4-byte prefix is 0x3df02124", () => {
    const data = encodeExchangeLegacy({ i: 0, j: 1, dx: 1n, minDy: 0n });
    expect(data.slice(0, 10).toLowerCase()).toBe("0x3df02124");
  });
  // slippage math bigint edge cases
  it("min_dy bigint math: slippageBps=1 (0.01%) and slippageBps=9999 (99.99%)", () => {
    const quotedDy = 1_000_000_000_000_000_000n;  // 1e18
    const at1bps   = (quotedDy * (10000n - 1n)) / 10000n;
    const at9999bps = (quotedDy * (10000n - 9999n)) / 10000n;
    expect(at1bps).toBe(999_900_000_000_000_000n);
    expect(at9999bps).toBe(100_000_000_000_000n);
  });
});
```

---

### `test/tools/get_curve_positions.test.ts` (new)

**Analog:** Phase 31 `test/get-eigenlayer-positions.test.ts` structure + simulate_position_change READ-ONLY guard

**READ-ONLY guard pattern** (simulate-position-change.test.ts lines 418–425):
```typescript
describe("get_curve_positions — READ-ONLY invariant", () => {
  it("module source does NOT import createHandle (import-graph grep)", async () => {
    const { readFileSync } = await import("node:fs");
    const source = readFileSync("src/tools/get_curve_positions.ts", "utf8");
    expect(source).not.toMatch(/import .*createHandle/);
    expect(source).not.toMatch(/from .*handle-store/);
  });
});
```

**Zero-filter test pattern:**
```typescript
it("pools with lpBalance = 0n are filtered from results", async () => {
  // Mock _curveChain.getCurveLpBalance to return 0n for all pools
  // except one. Assert only the non-zero pool appears in positions[].
});
```

---

## Shared Patterns

### Pool Registry SOT Discipline
**Source:** `src/config/contracts.ts` pattern throughout
**Apply to:** All Phase 34 files that reference pool addresses
```typescript
// NEVER inline a Curve pool address. Always: getCurvePoolByAddress(chainId, poolAddress)
// or getAllCurvePoolsForChain(chainId). The SOT is src/config/contracts.ts.
// getAddress() wraps every literal at the literal site — corrupted snapshot throws EIP-55.
```

### Bigint Slippage Math (no float)
**Source:** `prepare_uniswap_swap.ts` step 16 + CONTEXT.md decisions
**Apply to:** `prepare_curve_swap.ts`, `prepare_curve_add_liquidity.ts`
```typescript
const minDy = (quotedDy * (10000n - BigInt(slippageBps))) / 10000n;
const minMintAmount = (quotedLp * (10000n - BigInt(slippageBps))) / 10000n;
// NEVER: Number(quoted) * (1 - slippageBps/10000)
```

### Error Envelope
**Source:** `prepare_uniswap_swap.ts` lines 88–98
**Apply to:** `prepare_curve_swap.ts`, `prepare_curve_add_liquidity.ts`
```typescript
function errEnvelope(code: ErrorCode, message: string, cause?: string): Record<string, unknown> {
  return makeStructuredError(code, message, cause) as unknown as Record<string, unknown> & StructuredError;
}
```

### ESM Spy-Affordance Indirection
**Source:** `src/chains/aave-v3.ts` line 148, `src/protocols/uniswap-v3.ts` (via `_uniswapV3Protocol`)
**Apply to:** `src/chains/curve.ts` → `_curveChain`, `src/protocols/curve.ts` → `_curveProtocol`
```typescript
export const _curveChain = { getCurveGetDy, getCurveCalcTokenAmount, getCurveLpBalance };
export const _curveProtocol = { encodeExchangeLegacy, encodeExchangeStableNg, encodeAddLiquidityStableNg, decodeCurveCall };
```

### Cross-SOT Byte-Identity Assertion Pattern
**Source:** `test/config-contracts.test.ts` (T-UNISWAP-V3-SPENDER-DRIFT-1, T-LIDO-SPENDER-DRIFT-1)
**Apply to:** New `T-CURVE-SPENDER-DRIFT-1` + `T-CURVE-REGISTRY-DECIMALS-1` tests
```typescript
// T-CURVE-SPENDER-DRIFT-1: assert getAllCurvePoolsForChain(1).map(p=>p.address)
// are ALL present in KNOWN_SPENDERS_ETHEREUM.
// T-CURVE-REGISTRY-DECIMALS-1: for each pool, each coin.decimals() on-chain
// === pool.coinDecimals[idx] in the registry.
```

### Hardcoded Fixture Literal Discipline
**Source:** CLAUDE.md + `test/signing-fingerprint.test.ts`
**Apply to:** Fixtures CRV-A/B/C in `test/signing-fingerprint.test.ts`
- NO `beforeAll`-snapshot — drift must fail at a SPECIFIC line.
- Selector assertion BEFORE fingerprint assertion — encoder drift fires first.
- Cross-link from `test/prepare-curve-swap.test.ts` and `test/prepare-curve-add-liquidity.test.ts`.

### (tx.to, selector) Tuple Dispatch
**Source:** `src/tools/preview_send.ts` lines 1227–1244 (Phase 32 UniV3 arm)
**Apply to:** Phase 34 Curve arm in `preview_send.ts`
```typescript
// NEVER route on selector alone — any Vyper StableSwap pool could share a
// 4-byte selector. Route on (tx.to ∈ curated registry) AND selector.
const curvePool = _getCurvePoolByAddress(record.tx.chainId as ChainId, record.tx.to as Address);
if (curvePool) { curveDecoded = _curveProtocol.decodeCurveCall(...); }
```

---

## No Analog Found

All Phase 34 files have close analogs. No "no analog" entries.

---

## register-all.ts Parallel Execution Summary

| Plan | Import Slot | Base Line (after Phase 33) | Conflict Risk |
|------|-------------|---------------------------|---------------|
| 34-02 | `get_curve_positions.js` | ~line 111 | None — additive only |
| 34-03 | `prepare_curve_swap.js` + `prepare_curve_add_liquidity.js` | ~lines 112–113 | None — additive only |

**Verdict: Plans 34-02 and 34-03 can run in PARALLEL.** Their register-all.ts slots are disjoint lines. If they branch from the same base, the rebase of 34-03 onto a merged 34-02 is a single-line offset with zero semantic conflict.

---

## Metadata

**Analog search scope:** `src/config/`, `src/chains/`, `src/protocols/`, `src/security/`, `src/tools/`, `test/`
**Files scanned:** ~15 source files read in full or targeted sections
**Pattern extraction date:** 2026-05-26
