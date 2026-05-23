// Fifth occupant of `src/protocols/` — Morpho Blue singleton primitives for
// Phase 29 (Plans 29-01 / 29-02 / 29-03). Structural mirror of
// `src/protocols/compound-v3.ts`: single-file ABI fragment + selector table +
// encoder-per-supported-function + decode discriminated union +
// `_morphoBlue` ESM spy indirection.
//
// SDK reality (verified against viem@2.48.11 + research § Topic 9):
//   - `@morpho-org/blue-sdk` REJECTED — adds ~600KB gzip; SharesMathLib
//     formulas (`toAssetsDown` / `toAssetsUp`) are 3 lines each and trivially
//     inlined in Plan 29-02. The SDK's "wrap WalletConnect for you" affordance
//     is the wrong direction for the Ledger-via-WC architecture (research
//     § Topic 9).
//   - `@morpho-org/morpho-blue-bundlers` REJECTED — 17-month stale + bundler-
//     only (multi-call routing); Phase 29 ships single-step direct calls
//     against the singleton.
//   - `parseAbi(...)` inline is the encoder/decoder SOT (Phase 28 Compound
//     V3 precedent re-applied).
//
// Morpho Blue vs Compound V3 calldata-shape deltas (research § Topic 2 +
// § Pattern 1):
//   - Compound has 2 selectors (supply / withdraw) covering 4 agent intents
//     (supply-collateral / repay / withdraw-collateral / borrow) — intent
//     resolution lives in the prepare-tool gate.
//   - Morpho has 6 distinct selectors covering 6 distinct agent intents:
//       supply               — lender position into loan pool
//       withdraw             — exit lender position
//       supplyCollateral     — post collateral (raw amount, NOT shares)
//       withdrawCollateral   — pull collateral
//       borrow               — open / increase debt
//       repay                — close / reduce debt
//     The selector itself disambiguates intent; no intent-vs-reality gate is
//     needed at the calldata-shape level (unlike Compound's 2-vs-4).
//   - Morpho's MarketParams struct travels in the calldata for every write
//     (5-tuple: loanToken / collateralToken / oracle / irm / lltv); the
//     32-byte market-id is DERIVED from it via keccak256(abi.encode(5-tuple)).
//     `deriveMarketId(params)` exposes this derivation for both the encoder
//     (DRY against the 6 encoder bodies) and the decoder (each arm re-derives
//     marketId from decoded MarketParams).
//
// The supply-vs-supplyCollateral distinction IS a UX hazard (research
// § Pitfall 2) — solved at the prepare-tool level in Plan 29-03 via asset-
// match gate (`asset === marketParams.loanToken` for supply/repay/withdraw/
// borrow; `asset === marketParams.collateralToken` for supplyCollateral/
// withdrawCollateral), refused with `INVALID_INPUT + hintTool` pattern. Plan
// 29-01 ships ONLY the 6 calldata shapes + decoder + 32-byte-id derivation;
// the asset-match gate ships in Plan 29-03.
//
// exactlyOneZero invariant (research § Topic 2 + § Pitfall 1): four of the
// six write functions (supply / withdraw / borrow / repay) take BOTH `assets`
// and `shares` parameters; the Morpho protocol REQUIRES exactly one to be
// non-zero (the call reverts on-chain otherwise). The encoders ASSERT
// `(assets === 0n) XOR (shares === 0n)` BEFORE `encodeFunctionData` —
// refusal pre-encode prevents an on-chain revert + wasted gas. The
// prepare-tool layer (Plan 29-03) catches `MORPHO_EXACTLY_ONE_ZERO` and
// surfaces it as `INVALID_INPUT`.
//
// Repay-max pattern (research § Topic 5): Morpho's canonical repay-max is
// `repay(marketParams, 0, borrowShares, onBehalf, "0x")` — pass the EXACT
// `borrowShares` value read from `position(id, user).borrowShares`. NOT
// MAX_UINT256 (Compound's pattern). The encoder accepts
// `(marketParams, assets, shares, onBehalf, data)` verbatim — the encoder
// doesn't know about "max" semantics, that's the prepare-tool layer's concern
// (Plan 29-03 `prepare_morpho_repay` reads borrowShares and threads it here).
//
// Consumed by:
//   - src/chains/morpho-blue.ts          (Plan 29-02 — position view + market
//                                         view via parseAbi)
//   - src/tools/prepare_morpho_supply.ts             (Plan 29-03 — encodeMorphoSupply)
//   - src/tools/prepare_morpho_withdraw.ts           (Plan 29-03 — encodeMorphoWithdraw)
//   - src/tools/prepare_morpho_supply_collateral.ts  (Plan 29-03 — encodeMorphoSupplyCollateral)
//   - src/tools/prepare_morpho_withdraw_collateral.ts(Plan 29-03 — encodeMorphoWithdrawCollateral)
//   - src/tools/prepare_morpho_borrow.ts             (Plan 29-03 — encodeMorphoBorrow)
//   - src/tools/prepare_morpho_repay.ts              (Plan 29-03 — encodeMorphoRepay)
//   - src/tools/preview_send.ts                      (Plan 29-03 — decodeMorphoBlueCall via _morphoBlue indirection)
//   - src/security/canonical-dispatch.ts             (Plan 29-03 — Ethereum allowlist arm)
//
// Format-fanout-sentinel: the ONLY place in `src/` that imports a Morpho Blue
// ABI fragment for encoding / decoding / market-id derivation. Both
// `prepare_morpho_*` and `preview_send` consume through the exported
// functions; NEVER inline parseAbi or selectors. Canonical Solidity interface:
// [IMorpho.sol](https://github.com/morpho-org/morpho-blue/blob/main/src/interfaces/IMorpho.sol)
// + [MarketParamsLib.sol](https://github.com/morpho-org/morpho-blue/blob/main/src/libraries/MarketParamsLib.sol).
//
// ABI fragment scope: Plan 29-01 locks the 15-fragment surface Phase 29 uses
// across all 3 plans (6 writes + 3 reads + 3 events). Rate / utilization
// views (`get_morpho_market_info`) are DEFERRED per planning context Open
// Question #4 — Phase 29 does not extend this parseAbi const.

import {
  decodeFunctionData,
  encodeAbiParameters,
  encodeFunctionData,
  keccak256,
  parseAbi,
  parseAbiParameters,
  type Address,
  type Hex,
} from "viem";

/**
 * Morpho Blue ABI fragment. Fifteen functions / events used across Phase 29:
 *
 * Write (6 — Plan 29-01 encoders consume; Plan 29-03 prepare tools consume;
 * Plan 29-03 preview_send decoder consumes):
 *   - `supply(MarketParams marketParams, uint256 assets, uint256 shares, address onBehalf, bytes data)`
 *     → selector 0xa99aad89
 *   - `withdraw(MarketParams marketParams, uint256 assets, uint256 shares, address onBehalf, address receiver)`
 *     → selector 0x5c2bea49
 *   - `supplyCollateral(MarketParams marketParams, uint256 assets, address onBehalf, bytes data)`
 *     → selector 0x238d6579
 *   - `withdrawCollateral(MarketParams marketParams, uint256 assets, address onBehalf, address receiver)`
 *     → selector 0x8720316d
 *   - `borrow(MarketParams marketParams, uint256 assets, uint256 shares, address onBehalf, address receiver)`
 *     → selector 0x50d8cd4b
 *   - `repay(MarketParams marketParams, uint256 assets, uint256 shares, address onBehalf, bytes data)`
 *     → selector 0x20b76e81
 *
 * Read (3 — Plan 29-02 consumes position + market views; Plan 29-03 consumes
 * idToMarketParams for the intent-vs-reality gate):
 *   - `position(bytes32 id, address user)` → (supplyShares, borrowShares, collateral)
 *   - `market(bytes32 id)` → (totalSupplyAssets, totalSupplyShares, totalBorrowAssets,
 *                             totalBorrowShares, lastUpdate, fee)
 *   - `idToMarketParams(bytes32 id)` → (loanToken, collateralToken, oracle, irm, lltv)
 *
 * Events (3 — Plan 29-02 consumes for market discovery via getLogs):
 *   - `Supply(bytes32 indexed id, address indexed caller, address indexed onBehalf, uint256 assets, uint256 shares)`
 *   - `Borrow(bytes32 indexed id, address caller, address indexed onBehalf, address indexed receiver, uint256 assets, uint256 shares)`
 *   - `SupplyCollateral(bytes32 indexed id, address indexed caller, address indexed onBehalf, uint256 assets)`
 */
export const MORPHO_BLUE_ABI = parseAbi([
  // Write functions (6).
  "function supply((address loanToken, address collateralToken, address oracle, address irm, uint256 lltv) marketParams, uint256 assets, uint256 shares, address onBehalf, bytes data) returns (uint256 assetsSupplied, uint256 sharesSupplied)",
  "function withdraw((address loanToken, address collateralToken, address oracle, address irm, uint256 lltv) marketParams, uint256 assets, uint256 shares, address onBehalf, address receiver) returns (uint256 assetsWithdrawn, uint256 sharesWithdrawn)",
  "function supplyCollateral((address loanToken, address collateralToken, address oracle, address irm, uint256 lltv) marketParams, uint256 assets, address onBehalf, bytes data)",
  "function withdrawCollateral((address loanToken, address collateralToken, address oracle, address irm, uint256 lltv) marketParams, uint256 assets, address onBehalf, address receiver)",
  "function borrow((address loanToken, address collateralToken, address oracle, address irm, uint256 lltv) marketParams, uint256 assets, uint256 shares, address onBehalf, address receiver) returns (uint256 assetsBorrowed, uint256 sharesBorrowed)",
  "function repay((address loanToken, address collateralToken, address oracle, address irm, uint256 lltv) marketParams, uint256 assets, uint256 shares, address onBehalf, bytes data) returns (uint256 assetsRepaid, uint256 sharesRepaid)",
  // Read functions (3).
  "function position(bytes32 id, address user) view returns (uint256 supplyShares, uint128 borrowShares, uint128 collateral)",
  "function market(bytes32 id) view returns (uint128 totalSupplyAssets, uint128 totalSupplyShares, uint128 totalBorrowAssets, uint128 totalBorrowShares, uint128 lastUpdate, uint128 fee)",
  "function idToMarketParams(bytes32 id) view returns (address loanToken, address collateralToken, address oracle, address irm, uint256 lltv)",
  // Events (3).
  "event Supply(bytes32 indexed id, address indexed caller, address indexed onBehalf, uint256 assets, uint256 shares)",
  "event Borrow(bytes32 indexed id, address caller, address indexed onBehalf, address indexed receiver, uint256 assets, uint256 shares)",
  "event SupplyCollateral(bytes32 indexed id, address indexed caller, address indexed onBehalf, uint256 assets)",
]);

/**
 * 4-byte function selectors for the 6 calldata shapes Phase 29 emits.
 * Empirically pinned at write-time via `viem.toFunctionSelector` AND re-
 * derived at runtime in `test/protocols-morpho-blue.test.ts` (A2 LOCK).
 * Drift in either fails at PR-review time — these are the bytes the Ledger
 * device will display under "Operation type" / clear-sign rendering.
 *
 * Canonical signatures are NESTED-STRUCT shapes — the MarketParams tuple is
 * `(address,address,address,address,uint256)`:
 *   supply             → `function supply((address,address,address,address,uint256),uint256,uint256,address,bytes)`
 *   withdraw           → `function withdraw((address,address,address,address,uint256),uint256,uint256,address,address)`
 *   supplyCollateral   → `function supplyCollateral((address,address,address,address,uint256),uint256,address,bytes)`
 *   withdrawCollateral → `function withdrawCollateral((address,address,address,address,uint256),uint256,address,address)`
 *   borrow             → `function borrow((address,address,address,address,uint256),uint256,uint256,address,address)`
 *   repay              → `function repay((address,address,address,address,uint256),uint256,uint256,address,bytes)`
 */
export const MORPHO_BLUE_SELECTORS = {
  supply: "0xa99aad89" as Hex,
  withdraw: "0x5c2bea49" as Hex,
  supplyCollateral: "0x238d6579" as Hex,
  withdrawCollateral: "0x8720316d" as Hex,
  borrow: "0x50d8cd4b" as Hex,
  repay: "0x20b76e81" as Hex,
} as const;

/**
 * MarketParams struct shape — the 5-tuple Morpho Blue uses to identify a
 * market. The 32-byte market-id is `keccak256(abi.encode(...this))` per
 * `MarketParamsLib.sol`. Decimals NOT included (Morpho operates in raw token
 * units; the decoder + prepare-tool layer resolves decimals separately via
 * `get_token_metadata`).
 */
export interface MorphoMarketParams {
  /** ERC-20 the lender supplies / the borrower borrows. */
  loanToken: Address;
  /** ERC-20 the borrower posts as collateral. */
  collateralToken: Address;
  /** Oracle contract — surfaces (collateralPrice / loanPrice) at 1e36 scale. */
  oracle: Address;
  /** Interest-rate model contract — Morpho's adaptive-curve IRM is the canonical default. */
  irm: Address;
  /** Liquidation loan-to-value, 18-decimal fixed-point (e.g. `860000000000000000n` = 86%). */
  lltv: bigint;
}

/**
 * Derive the 32-byte Morpho Blue market-id from MarketParams.
 *
 * Formula (per `MarketParamsLib.sol::id`):
 *   `id = keccak256(abi.encode(MarketParams))`
 *
 * The 5-tuple is ABI-encoded as 5 × 32-byte padded fields = 160 bytes; viem's
 * `encodeAbiParameters` handles the padding correctly (left-padded for
 * addresses → 32 bytes each; uint256 → 32 bytes). The hash is the canonical
 * market identifier used in `position(id, user)`, `market(id)`, and event
 * topics.
 *
 * Regression-anchored against the wstETH/USDC mainnet market literal
 * `0xb323495f7e4148be5643a4ea4a8221eef163e4bccfdedc2a6f4696baacbc86cc`
 * (research § Topic 3, cited from app.morpho.org/ethereum/markets).
 *
 * The intent-vs-reality gate (Plan 29-03) cross-checks `idToMarketParams(id)`
 * against `deriveMarketId(claimedParams)` so a tampered `marketId` arg from
 * the agent triggers a refusal before the Ledger device sees the tx.
 */
export function deriveMarketId(params: MorphoMarketParams): Hex {
  return keccak256(
    encodeAbiParameters(
      parseAbiParameters("address, address, address, address, uint256"),
      [params.loanToken, params.collateralToken, params.oracle, params.irm, params.lltv],
    ),
  );
}

/**
 * Encode `Morpho.supply(marketParams, assets, shares, onBehalf, data)` calldata.
 * The caller MUST set `tx.to` to `getMorphoBlueAddress(chainId)` — NEVER inline
 * the Morpho literal.
 *
 * exactlyOneZero invariant: Morpho's `supply` REQUIRES exactly one of
 * `assets` / `shares` to be non-zero. The encoder asserts pre-encode; a
 * violation throws `MORPHO_EXACTLY_ONE_ZERO`. Asset-based supply is the
 * common case (`shares = 0n`); share-based supply is for advanced users
 * (e.g. matching an exact share count).
 *
 * `data` is the optional callback-data hook (Morpho supports `onMorphoSupply`
 * pre-transfer callbacks for routers / vaults); Phase 29 single-step tools
 * always pass `"0x"` (no callback).
 */
export function encodeMorphoSupply(
  params: MorphoMarketParams,
  assets: bigint,
  shares: bigint,
  onBehalf: Address,
  data: Hex = "0x",
): Hex {
  if ((assets === 0n) === (shares === 0n)) {
    throw new Error("MORPHO_EXACTLY_ONE_ZERO: exactly one of assets / shares must be non-zero");
  }
  return encodeFunctionData({
    abi: MORPHO_BLUE_ABI,
    functionName: "supply",
    args: [
      {
        loanToken: params.loanToken,
        collateralToken: params.collateralToken,
        oracle: params.oracle,
        irm: params.irm,
        lltv: params.lltv,
      },
      assets,
      shares,
      onBehalf,
      data,
    ],
  });
}

/**
 * Encode `Morpho.withdraw(marketParams, assets, shares, onBehalf, receiver)` calldata.
 *
 * exactlyOneZero invariant: same as supply — exactly one of `assets` /
 * `shares` must be non-zero. Share-based withdraw is the canonical
 * "withdraw-all my lender position" pattern (pass `shares = supplyShares`
 * from `position(id, user)`).
 *
 * `receiver` is the recipient of the loanToken transfer; the on-behalf
 * account is the lender position holder. For self-custody flows, both are
 * the user's wallet.
 */
export function encodeMorphoWithdraw(
  params: MorphoMarketParams,
  assets: bigint,
  shares: bigint,
  onBehalf: Address,
  receiver: Address,
): Hex {
  if ((assets === 0n) === (shares === 0n)) {
    throw new Error("MORPHO_EXACTLY_ONE_ZERO: exactly one of assets / shares must be non-zero");
  }
  return encodeFunctionData({
    abi: MORPHO_BLUE_ABI,
    functionName: "withdraw",
    args: [
      {
        loanToken: params.loanToken,
        collateralToken: params.collateralToken,
        oracle: params.oracle,
        irm: params.irm,
        lltv: params.lltv,
      },
      assets,
      shares,
      onBehalf,
      receiver,
    ],
  });
}

/**
 * Encode `Morpho.supplyCollateral(marketParams, assets, onBehalf, data)` calldata.
 *
 * No `shares` field — collateral posts are always asset-denominated (Morpho
 * does NOT mint collateral-share receipts; the `position.collateral` slot is
 * a raw token-amount uint128). The exactlyOneZero invariant therefore does
 * NOT apply.
 *
 * The collateralToken's raw amount is transferred via `safeTransferFrom` —
 * the user must `approve(MorphoBlue, amount)` on the collateralToken FIRST
 * (Plan 29-03's `prepare_morpho_supply_collateral` surfaces this as the
 * 2-step ritual: approve → supplyCollateral).
 */
export function encodeMorphoSupplyCollateral(
  params: MorphoMarketParams,
  assets: bigint,
  onBehalf: Address,
  data: Hex = "0x",
): Hex {
  return encodeFunctionData({
    abi: MORPHO_BLUE_ABI,
    functionName: "supplyCollateral",
    args: [
      {
        loanToken: params.loanToken,
        collateralToken: params.collateralToken,
        oracle: params.oracle,
        irm: params.irm,
        lltv: params.lltv,
      },
      assets,
      onBehalf,
      data,
    ],
  });
}

/**
 * Encode `Morpho.withdrawCollateral(marketParams, assets, onBehalf, receiver)` calldata.
 *
 * No `shares` field — same as supplyCollateral. Withdrawing collateral
 * REDUCES health-factor; the Morpho contract reverts if the resulting
 * position is undercollateralized. Plan 29-03's `prepare_morpho_withdraw_collateral`
 * pre-checks the post-state via `position(id, user)` + market price view and
 * refuses with `HEALTH_FACTOR_BELOW_ONE` before signing.
 */
export function encodeMorphoWithdrawCollateral(
  params: MorphoMarketParams,
  assets: bigint,
  onBehalf: Address,
  receiver: Address,
): Hex {
  return encodeFunctionData({
    abi: MORPHO_BLUE_ABI,
    functionName: "withdrawCollateral",
    args: [
      {
        loanToken: params.loanToken,
        collateralToken: params.collateralToken,
        oracle: params.oracle,
        irm: params.irm,
        lltv: params.lltv,
      },
      assets,
      onBehalf,
      receiver,
    ],
  });
}

/**
 * Encode `Morpho.borrow(marketParams, assets, shares, onBehalf, receiver)` calldata.
 *
 * exactlyOneZero invariant: same as supply. Asset-based borrow is the
 * common case (`shares = 0n`); share-based borrow is rare.
 *
 * `receiver` is the recipient of the borrowed loanToken; the on-behalf
 * account is the borrower (the debt sits on `position(id, onBehalf).borrowShares`).
 * The borrower MUST have posted enough collateral first
 * (`position(id, onBehalf).collateral > 0`) or the call reverts.
 */
export function encodeMorphoBorrow(
  params: MorphoMarketParams,
  assets: bigint,
  shares: bigint,
  onBehalf: Address,
  receiver: Address,
): Hex {
  if ((assets === 0n) === (shares === 0n)) {
    throw new Error("MORPHO_EXACTLY_ONE_ZERO: exactly one of assets / shares must be non-zero");
  }
  return encodeFunctionData({
    abi: MORPHO_BLUE_ABI,
    functionName: "borrow",
    args: [
      {
        loanToken: params.loanToken,
        collateralToken: params.collateralToken,
        oracle: params.oracle,
        irm: params.irm,
        lltv: params.lltv,
      },
      assets,
      shares,
      onBehalf,
      receiver,
    ],
  });
}

/**
 * Encode `Morpho.repay(marketParams, assets, shares, onBehalf, data)` calldata.
 *
 * exactlyOneZero invariant: same as supply.
 *
 * Repay-max pattern (research § Topic 5): the canonical "repay my entire
 * borrow position" idiom is `repay(params, 0, position.borrowShares, onBehalf, "0x")`
 * — pass the EXACT `borrowShares` value read from `position(id, user)`. NOT
 * MAX_UINT256 (Compound's pattern). The encoder is intent-agnostic — the
 * "max" semantics live in the prepare-tool layer (Plan 29-03's
 * `prepare_morpho_repay` reads borrowShares via `_morphoChains.readPosition`
 * and threads the value here).
 */
export function encodeMorphoRepay(
  params: MorphoMarketParams,
  assets: bigint,
  shares: bigint,
  onBehalf: Address,
  data: Hex = "0x",
): Hex {
  if ((assets === 0n) === (shares === 0n)) {
    throw new Error("MORPHO_EXACTLY_ONE_ZERO: exactly one of assets / shares must be non-zero");
  }
  return encodeFunctionData({
    abi: MORPHO_BLUE_ABI,
    functionName: "repay",
    args: [
      {
        loanToken: params.loanToken,
        collateralToken: params.collateralToken,
        oracle: params.oracle,
        irm: params.irm,
        lltv: params.lltv,
      },
      assets,
      shares,
      onBehalf,
      data,
    ],
  });
}

/**
 * Discriminated-union decode result for selector-routed dispatch in
 * preview_send.ts. 7-arm — 6 known selectors + the `unknown` fall-through
 * sentinel for non-Morpho calldata.
 *
 * Each known arm INCLUDES the `marketId: Hex` field re-derived via
 * `deriveMarketId(decoded.marketParams)` — the on-wire calldata embeds
 * MarketParams (not the 32-byte id), so the decoder reconstructs the id
 * locally. Plan 29-03's preview_send template surfaces this id in
 * DECODED ARGS so the user can cross-reference against
 * `morpho-markets-ethereum.json`.
 *
 * `isShareBased: boolean` on supply / withdraw / borrow / repay arms is
 * `true` iff `shares !== 0n` — research § Topic 5 + § Pitfall 1. The
 * preview_send template surfaces this as the SHARE-BASED / ASSET-BASED
 * annotation (share-based repay = repay-max idiom; share-based withdraw =
 * withdraw-all idiom).
 *
 * supplyCollateral + withdrawCollateral arms have NO `isShareBased` field
 * (collateral writes are always asset-based per Morpho's data model).
 */
export type MorphoBlueDecoded =
  | {
      kind: "morpho-supply";
      marketId: Hex;
      marketParams: MorphoMarketParams;
      assets: bigint;
      shares: bigint;
      onBehalf: Address;
      data: Hex;
      isShareBased: boolean;
    }
  | {
      kind: "morpho-withdraw";
      marketId: Hex;
      marketParams: MorphoMarketParams;
      assets: bigint;
      shares: bigint;
      onBehalf: Address;
      receiver: Address;
      isShareBased: boolean;
    }
  | {
      kind: "morpho-supply-collateral";
      marketId: Hex;
      marketParams: MorphoMarketParams;
      assets: bigint;
      onBehalf: Address;
      data: Hex;
    }
  | {
      kind: "morpho-withdraw-collateral";
      marketId: Hex;
      marketParams: MorphoMarketParams;
      assets: bigint;
      onBehalf: Address;
      receiver: Address;
    }
  | {
      kind: "morpho-borrow";
      marketId: Hex;
      marketParams: MorphoMarketParams;
      assets: bigint;
      shares: bigint;
      onBehalf: Address;
      receiver: Address;
      isShareBased: boolean;
    }
  | {
      kind: "morpho-repay";
      marketId: Hex;
      marketParams: MorphoMarketParams;
      assets: bigint;
      shares: bigint;
      onBehalf: Address;
      data: Hex;
      isShareBased: boolean;
    }
  | { kind: "unknown"; selector: Hex };

/**
 * Helper — unpack viem's decoded MarketParams tuple (positional array OR
 * named-fields object depending on viem version) into our canonical
 * `MorphoMarketParams` shape. viem 2.x parseAbi with named struct fields
 * returns an object; older versions returned a positional tuple. Handle both
 * defensively.
 */
function unpackMarketParams(raw: unknown): MorphoMarketParams {
  // viem 2.x with named tuple fields returns object-shaped args; if raw is
  // already an object with the 5 named fields, return it directly. Otherwise
  // unpack the positional tuple form.
  if (raw && typeof raw === "object" && "loanToken" in raw) {
    const o = raw as MorphoMarketParams;
    return {
      loanToken: o.loanToken,
      collateralToken: o.collateralToken,
      oracle: o.oracle,
      irm: o.irm,
      lltv: o.lltv,
    };
  }
  const tuple = raw as readonly [Address, Address, Address, Address, bigint];
  return {
    loanToken: tuple[0],
    collateralToken: tuple[1],
    oracle: tuple[2],
    irm: tuple[3],
    lltv: tuple[4],
  };
}

/**
 * Selector-routed decoder for Morpho Blue calldata. Returns a discriminated
 * union; the `unknown` arm is the fall-through caller's signal to try the
 * next decoder (preview_send tries ERC-20 first, then per-protocol modules).
 *
 * NEVER throws. Malformed calldata for a known selector falls through to
 * `unknown` (try/catch around `decodeFunctionData`). Empty (`"0x"`) or too-
 * short data short-circuits to `unknown` without touching viem.
 *
 * Each known arm re-derives `marketId` from the decoded MarketParams — the
 * on-wire calldata carries the 5-tuple, NOT the 32-byte id (Morpho's CALLDATA-
 * carries-params, not id, design choice — research § Pattern 1). The
 * re-derivation makes the marketId field byte-identical to the canonical
 * `MarketParamsLib.sol::id(marketParams)` output.
 */
export function decodeMorphoBlueCall(data: Hex): MorphoBlueDecoded {
  if (data === "0x" || data.length < 10) {
    return { kind: "unknown", selector: data as Hex };
  }
  const selector = data.slice(0, 10).toLowerCase() as Hex;
  try {
    if (selector === MORPHO_BLUE_SELECTORS.supply) {
      const decoded = decodeFunctionData({ abi: MORPHO_BLUE_ABI, data });
      if (decoded.functionName === "supply") {
        const [rawParams, assets, shares, onBehalf, callbackData] = decoded.args as readonly [
          unknown,
          bigint,
          bigint,
          Address,
          Hex,
        ];
        const marketParams = unpackMarketParams(rawParams);
        return {
          kind: "morpho-supply",
          marketId: deriveMarketId(marketParams),
          marketParams,
          assets,
          shares,
          onBehalf,
          data: callbackData,
          isShareBased: shares !== 0n,
        };
      }
    }
    if (selector === MORPHO_BLUE_SELECTORS.withdraw) {
      const decoded = decodeFunctionData({ abi: MORPHO_BLUE_ABI, data });
      if (decoded.functionName === "withdraw") {
        const [rawParams, assets, shares, onBehalf, receiver] = decoded.args as readonly [
          unknown,
          bigint,
          bigint,
          Address,
          Address,
        ];
        const marketParams = unpackMarketParams(rawParams);
        return {
          kind: "morpho-withdraw",
          marketId: deriveMarketId(marketParams),
          marketParams,
          assets,
          shares,
          onBehalf,
          receiver,
          isShareBased: shares !== 0n,
        };
      }
    }
    if (selector === MORPHO_BLUE_SELECTORS.supplyCollateral) {
      const decoded = decodeFunctionData({ abi: MORPHO_BLUE_ABI, data });
      if (decoded.functionName === "supplyCollateral") {
        const [rawParams, assets, onBehalf, callbackData] = decoded.args as readonly [
          unknown,
          bigint,
          Address,
          Hex,
        ];
        const marketParams = unpackMarketParams(rawParams);
        return {
          kind: "morpho-supply-collateral",
          marketId: deriveMarketId(marketParams),
          marketParams,
          assets,
          onBehalf,
          data: callbackData,
        };
      }
    }
    if (selector === MORPHO_BLUE_SELECTORS.withdrawCollateral) {
      const decoded = decodeFunctionData({ abi: MORPHO_BLUE_ABI, data });
      if (decoded.functionName === "withdrawCollateral") {
        const [rawParams, assets, onBehalf, receiver] = decoded.args as readonly [
          unknown,
          bigint,
          Address,
          Address,
        ];
        const marketParams = unpackMarketParams(rawParams);
        return {
          kind: "morpho-withdraw-collateral",
          marketId: deriveMarketId(marketParams),
          marketParams,
          assets,
          onBehalf,
          receiver,
        };
      }
    }
    if (selector === MORPHO_BLUE_SELECTORS.borrow) {
      const decoded = decodeFunctionData({ abi: MORPHO_BLUE_ABI, data });
      if (decoded.functionName === "borrow") {
        const [rawParams, assets, shares, onBehalf, receiver] = decoded.args as readonly [
          unknown,
          bigint,
          bigint,
          Address,
          Address,
        ];
        const marketParams = unpackMarketParams(rawParams);
        return {
          kind: "morpho-borrow",
          marketId: deriveMarketId(marketParams),
          marketParams,
          assets,
          shares,
          onBehalf,
          receiver,
          isShareBased: shares !== 0n,
        };
      }
    }
    if (selector === MORPHO_BLUE_SELECTORS.repay) {
      const decoded = decodeFunctionData({ abi: MORPHO_BLUE_ABI, data });
      if (decoded.functionName === "repay") {
        const [rawParams, assets, shares, onBehalf, callbackData] = decoded.args as readonly [
          unknown,
          bigint,
          bigint,
          Address,
          Hex,
        ];
        const marketParams = unpackMarketParams(rawParams);
        return {
          kind: "morpho-repay",
          marketId: deriveMarketId(marketParams),
          marketParams,
          assets,
          shares,
          onBehalf,
          data: callbackData,
          isShareBased: shares !== 0n,
        };
      }
    }
  } catch {
    // Malformed calldata for a known selector — fall through to unknown.
  }
  return { kind: "unknown", selector };
}

/**
 * ESM spy-affordance per CLAUDE.md "ESM spy-affordance indirection" convention.
 * `preview_send.ts` (Plan 29-03) imports `_morphoBlue` and calls
 * `_morphoBlue.decodeMorphoBlueCall(data)` so tests can
 * `vi.spyOn(_morphoBlue, "decodeMorphoBlueCall")` without monkey-patching the
 * production import path. `_morphoBlue.deriveMarketId` is also exposed for
 * Plan 29-03's intent-vs-reality gate (the gate may spy this to inject a
 * tampered derivation in adversarial-input tests). Same shape as
 * `_compoundProtocols` in `compound-v3.ts` and `_aaveProtocols` in
 * `aave-v3.ts`.
 */
export const _morphoBlue = { decodeMorphoBlueCall, deriveMarketId };
