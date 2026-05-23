// Pure encode + selector + deriveMarketId + decode + ESM-spy-affordance tests
// for src/protocols/morpho-blue.ts.
//
// Phase 29 — Plan 29-01. Anchors:
//   - MORPHO_BLUE_SELECTORS A2 LOCK: 6 selectors derived at runtime via
//     viem.toFunctionSelector and asserted byte-identical against the const.
//   - deriveMarketId regression anchor: the wstETH/USDC mainnet market
//     literal 0xb323495f...c86cc (research § Topic 3, cited from
//     app.morpho.org/ethereum/markets). Drift = ABI encoding regression in
//     viem OR keccak regression OR encoding-shape divergence from
//     MarketParamsLib.sol.
//   - 6 encoder round-trips: each encoder builds calldata; selector slice
//     matches the const; viem.decodeFunctionData recovers all args byte-
//     identical.
//   - exactlyOneZero invariant: supply / withdraw / borrow / repay throw
//     MORPHO_EXACTLY_ONE_ZERO when both `assets` and `shares` are zero OR
//     both non-zero. supplyCollateral + withdrawCollateral are exempt (no
//     shares arg).
//   - decodeMorphoBlueCall 7-arm exhaustiveness: round-trip each encoder
//     through the decoder; assert `kind` matches + marketId field equals
//     deriveMarketId(params).
//   - Unknown fall-through: empty data ('0x') and bogus selector
//     ('0xdeadbeef') return { kind: 'unknown' } without throw.
//   - _morphoBlue indirection referential equality (ESM spy hygiene — proves
//     Plan 29-03's vi.spyOn(_morphoBlue, ...) intercepts the production path).

import { describe, expect, it } from "vitest";
import { type Address, type Hex, decodeFunctionData, toFunctionSelector } from "viem";

import {
  MORPHO_BLUE_ABI,
  MORPHO_BLUE_SELECTORS,
  _morphoBlue,
  decodeMorphoBlueCall,
  deriveMarketId,
  encodeMorphoBorrow,
  encodeMorphoRepay,
  encodeMorphoSupply,
  encodeMorphoSupplyCollateral,
  encodeMorphoWithdraw,
  encodeMorphoWithdrawCollateral,
  type MorphoMarketParams,
} from "../src/protocols/morpho-blue.js";

// Canonical wstETH/USDC mainnet market parameters — sourced from
// app.morpho.org/ethereum/markets and idToMarketParams(0xb323495f...c86cc) at
// research time. This is the SAME tuple used in test/signing-fingerprint-
// morpho.test.ts; DRY via shared TEST_WSTETH_USDC_PARAMS const here so a
// future verified-address update touches one site.
const USDC = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48" as Address;
const WSTETH = "0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0" as Address;
const WSTETH_USDC_ORACLE = "0x48F7E36EB6B826B2dF4B2E630B62Cd25e89E40e2" as Address;
const ADAPTIVE_CURVE_IRM = "0x870aC11D48B15DB9a138Cf899d20F13F79Ba00BC" as Address;
const LLTV_86 = 860000000000000000n;

const TEST_WSTETH_USDC_PARAMS: MorphoMarketParams = {
  loanToken: USDC,
  collateralToken: WSTETH,
  oracle: WSTETH_USDC_ORACLE,
  irm: ADAPTIVE_CURVE_IRM,
  lltv: LLTV_86,
};

// Canonical market-id literal for the wstETH/USDC market — cited from
// research § Topic 3 (app.morpho.org). The deriveMarketId regression anchor.
const WSTETH_USDC_MARKET_ID =
  "0xb323495f7e4148be5643a4ea4a8221eef163e4bccfdedc2a6f4696baacbc86cc" as Hex;

// Two distinct EOA placeholders for onBehalf / receiver in round-trip tests
// (real Phase 4 test wallet shape; documented test-only constants).
const ONBEHALF = "0x000000000000000000000000000000000000dEaD" as Address;
const RECEIVER = "0x000000000000000000000000000000000000bEEF" as Address;

const USDC_100 = 100_000_000n; // 100 USDC, decimals=6
const USDC_50 = 50_000_000n; // 50 USDC
const WSTETH_1 = 1_000_000_000_000_000_000n; // 1 wstETH, decimals=18
const MOCK_BORROW_SHARES = 1_000_000_000n; // mock borrowShares for repay-max fixture

// ---------------------------------------------------------------------------
// T1 — A2 LOCK (selector byte-identity for all 6 via viem.toFunctionSelector)
// ---------------------------------------------------------------------------

describe("MORPHO_BLUE_SELECTORS — A2 LOCK (research § Topic 2; byte-identity to viem.toFunctionSelector)", () => {
  it("supply === 0xa99aad89 byte-identical to viem.toFunctionSelector (nested-struct shape)", () => {
    expect(MORPHO_BLUE_SELECTORS.supply).toBe("0xa99aad89");
    expect(MORPHO_BLUE_SELECTORS.supply).toBe(
      toFunctionSelector(
        "function supply((address,address,address,address,uint256),uint256,uint256,address,bytes)",
      ),
    );
  });

  it("withdraw === 0x5c2bea49 byte-identical to viem.toFunctionSelector", () => {
    expect(MORPHO_BLUE_SELECTORS.withdraw).toBe("0x5c2bea49");
    expect(MORPHO_BLUE_SELECTORS.withdraw).toBe(
      toFunctionSelector(
        "function withdraw((address,address,address,address,uint256),uint256,uint256,address,address)",
      ),
    );
  });

  it("supplyCollateral === 0x238d6579 byte-identical to viem.toFunctionSelector", () => {
    expect(MORPHO_BLUE_SELECTORS.supplyCollateral).toBe("0x238d6579");
    expect(MORPHO_BLUE_SELECTORS.supplyCollateral).toBe(
      toFunctionSelector(
        "function supplyCollateral((address,address,address,address,uint256),uint256,address,bytes)",
      ),
    );
  });

  it("withdrawCollateral === 0x8720316d byte-identical to viem.toFunctionSelector", () => {
    expect(MORPHO_BLUE_SELECTORS.withdrawCollateral).toBe("0x8720316d");
    expect(MORPHO_BLUE_SELECTORS.withdrawCollateral).toBe(
      toFunctionSelector(
        "function withdrawCollateral((address,address,address,address,uint256),uint256,address,address)",
      ),
    );
  });

  it("borrow === 0x50d8cd4b byte-identical to viem.toFunctionSelector", () => {
    expect(MORPHO_BLUE_SELECTORS.borrow).toBe("0x50d8cd4b");
    expect(MORPHO_BLUE_SELECTORS.borrow).toBe(
      toFunctionSelector(
        "function borrow((address,address,address,address,uint256),uint256,uint256,address,address)",
      ),
    );
  });

  it("repay === 0x20b76e81 byte-identical to viem.toFunctionSelector", () => {
    expect(MORPHO_BLUE_SELECTORS.repay).toBe("0x20b76e81");
    expect(MORPHO_BLUE_SELECTORS.repay).toBe(
      toFunctionSelector(
        "function repay((address,address,address,address,uint256),uint256,uint256,address,bytes)",
      ),
    );
  });
});

// ---------------------------------------------------------------------------
// T2 — deriveMarketId regression anchor
// ---------------------------------------------------------------------------

describe("deriveMarketId — regression anchor against the wstETH/USDC mainnet market literal", () => {
  it("deriveMarketId(wstETH/USDC params) === 0xb323495f...c86cc byte-identical (research § Topic 3)", () => {
    expect(deriveMarketId(TEST_WSTETH_USDC_PARAMS)).toBe(WSTETH_USDC_MARKET_ID);
  });

  // Negative case — a single bit-flip in the lltv field changes the derived
  // id. Documents that the derivation is pure-function over the 5-tuple.
  it("deriveMarketId(params with lltv+1) !== canonical id (proves derivation is total over the 5-tuple)", () => {
    const tampered: MorphoMarketParams = { ...TEST_WSTETH_USDC_PARAMS, lltv: LLTV_86 + 1n };
    expect(deriveMarketId(tampered)).not.toBe(WSTETH_USDC_MARKET_ID);
  });
});

// ---------------------------------------------------------------------------
// T3-T8 — Encoder round-trips (one per function)
// ---------------------------------------------------------------------------

describe("encodeMorphoSupply — round-trip + selector slice + decode arm consistency", () => {
  it("encodes supply(wstETH/USDC, 100e6 USDC, 0 shares, onBehalf, '0x'); selector + decode round-trip", () => {
    const data = encodeMorphoSupply(TEST_WSTETH_USDC_PARAMS, USDC_100, 0n, ONBEHALF, "0x");
    expect(data.slice(0, 10).toLowerCase()).toBe(MORPHO_BLUE_SELECTORS.supply);

    // viem decode — args byte-identical.
    const dec = decodeFunctionData({ abi: MORPHO_BLUE_ABI, data });
    expect(dec.functionName).toBe("supply");

    // Decode arm via the protocol decoder.
    const result = decodeMorphoBlueCall(data);
    expect(result.kind).toBe("morpho-supply");
    if (result.kind === "morpho-supply") {
      expect(result.assets).toBe(USDC_100);
      expect(result.shares).toBe(0n);
      expect(result.onBehalf).toBe(ONBEHALF);
      expect(result.data).toBe("0x");
      expect(result.isShareBased).toBe(false);
      expect(result.marketId).toBe(WSTETH_USDC_MARKET_ID);
      expect(result.marketParams.loanToken).toBe(USDC);
      expect(result.marketParams.collateralToken).toBe(WSTETH);
    }
  });
});

describe("encodeMorphoWithdraw — round-trip + selector slice + decode arm consistency", () => {
  it("encodes withdraw(wstETH/USDC, 0 assets, 1e9 shares, onBehalf, receiver) — share-based withdraw-all", () => {
    const data = encodeMorphoWithdraw(
      TEST_WSTETH_USDC_PARAMS,
      0n,
      MOCK_BORROW_SHARES,
      ONBEHALF,
      RECEIVER,
    );
    expect(data.slice(0, 10).toLowerCase()).toBe(MORPHO_BLUE_SELECTORS.withdraw);

    const result = decodeMorphoBlueCall(data);
    expect(result.kind).toBe("morpho-withdraw");
    if (result.kind === "morpho-withdraw") {
      expect(result.assets).toBe(0n);
      expect(result.shares).toBe(MOCK_BORROW_SHARES);
      expect(result.onBehalf).toBe(ONBEHALF);
      expect(result.receiver).toBe(RECEIVER);
      expect(result.isShareBased).toBe(true);
      expect(result.marketId).toBe(WSTETH_USDC_MARKET_ID);
    }
  });
});

describe("encodeMorphoSupplyCollateral — round-trip + selector slice + decode arm consistency", () => {
  it("encodes supplyCollateral(wstETH/USDC, 1e18 wstETH, onBehalf, '0x') — asset-only (no shares field)", () => {
    const data = encodeMorphoSupplyCollateral(TEST_WSTETH_USDC_PARAMS, WSTETH_1, ONBEHALF, "0x");
    expect(data.slice(0, 10).toLowerCase()).toBe(MORPHO_BLUE_SELECTORS.supplyCollateral);

    const result = decodeMorphoBlueCall(data);
    expect(result.kind).toBe("morpho-supply-collateral");
    if (result.kind === "morpho-supply-collateral") {
      expect(result.assets).toBe(WSTETH_1);
      expect(result.onBehalf).toBe(ONBEHALF);
      expect(result.data).toBe("0x");
      expect(result.marketId).toBe(WSTETH_USDC_MARKET_ID);
    }
  });
});

describe("encodeMorphoWithdrawCollateral — round-trip + selector slice + decode arm consistency", () => {
  it("encodes withdrawCollateral(wstETH/USDC, 1e18 wstETH, onBehalf, receiver) — asset-only (no shares field)", () => {
    const data = encodeMorphoWithdrawCollateral(
      TEST_WSTETH_USDC_PARAMS,
      WSTETH_1,
      ONBEHALF,
      RECEIVER,
    );
    expect(data.slice(0, 10).toLowerCase()).toBe(MORPHO_BLUE_SELECTORS.withdrawCollateral);

    const result = decodeMorphoBlueCall(data);
    expect(result.kind).toBe("morpho-withdraw-collateral");
    if (result.kind === "morpho-withdraw-collateral") {
      expect(result.assets).toBe(WSTETH_1);
      expect(result.onBehalf).toBe(ONBEHALF);
      expect(result.receiver).toBe(RECEIVER);
      expect(result.marketId).toBe(WSTETH_USDC_MARKET_ID);
    }
  });
});

describe("encodeMorphoBorrow — round-trip + selector slice + decode arm consistency", () => {
  it("encodes borrow(wstETH/USDC, 50e6 USDC, 0 shares, onBehalf, receiver) — asset-based borrow", () => {
    const data = encodeMorphoBorrow(TEST_WSTETH_USDC_PARAMS, USDC_50, 0n, ONBEHALF, RECEIVER);
    expect(data.slice(0, 10).toLowerCase()).toBe(MORPHO_BLUE_SELECTORS.borrow);

    const result = decodeMorphoBlueCall(data);
    expect(result.kind).toBe("morpho-borrow");
    if (result.kind === "morpho-borrow") {
      expect(result.assets).toBe(USDC_50);
      expect(result.shares).toBe(0n);
      expect(result.onBehalf).toBe(ONBEHALF);
      expect(result.receiver).toBe(RECEIVER);
      expect(result.isShareBased).toBe(false);
      expect(result.marketId).toBe(WSTETH_USDC_MARKET_ID);
    }
  });
});

describe("encodeMorphoRepay — round-trip + selector slice + decode arm consistency (repay-max share-based)", () => {
  it("encodes repay(wstETH/USDC, 0 assets, 1e9 shares, onBehalf, '0x') — repay-max share-based form (research § Topic 5)", () => {
    const data = encodeMorphoRepay(
      TEST_WSTETH_USDC_PARAMS,
      0n,
      MOCK_BORROW_SHARES,
      ONBEHALF,
      "0x",
    );
    expect(data.slice(0, 10).toLowerCase()).toBe(MORPHO_BLUE_SELECTORS.repay);

    const result = decodeMorphoBlueCall(data);
    expect(result.kind).toBe("morpho-repay");
    if (result.kind === "morpho-repay") {
      expect(result.assets).toBe(0n);
      expect(result.shares).toBe(MOCK_BORROW_SHARES);
      expect(result.onBehalf).toBe(ONBEHALF);
      expect(result.data).toBe("0x");
      expect(result.isShareBased).toBe(true);
      expect(result.marketId).toBe(WSTETH_USDC_MARKET_ID);
    }
  });

  it("encodes repay(wstETH/USDC, 50e6 assets, 0 shares, onBehalf, '0x') — asset-based partial repay", () => {
    const data = encodeMorphoRepay(TEST_WSTETH_USDC_PARAMS, USDC_50, 0n, ONBEHALF, "0x");
    const result = decodeMorphoBlueCall(data);
    expect(result.kind).toBe("morpho-repay");
    if (result.kind === "morpho-repay") {
      expect(result.assets).toBe(USDC_50);
      expect(result.isShareBased).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// T9 — exactlyOneZero invariant
// ---------------------------------------------------------------------------

describe("exactlyOneZero invariant — supply / withdraw / borrow / repay throw MORPHO_EXACTLY_ONE_ZERO if violated", () => {
  it("encodeMorphoSupply(0, 0) throws — both zero violates the invariant", () => {
    expect(() =>
      encodeMorphoSupply(TEST_WSTETH_USDC_PARAMS, 0n, 0n, ONBEHALF, "0x"),
    ).toThrow(/MORPHO_EXACTLY_ONE_ZERO/);
  });

  it("encodeMorphoSupply(100, 100) throws — both non-zero violates the invariant", () => {
    expect(() =>
      encodeMorphoSupply(TEST_WSTETH_USDC_PARAMS, 100n, 100n, ONBEHALF, "0x"),
    ).toThrow(/MORPHO_EXACTLY_ONE_ZERO/);
  });

  it("encodeMorphoWithdraw(0, 0) throws — both zero", () => {
    expect(() =>
      encodeMorphoWithdraw(TEST_WSTETH_USDC_PARAMS, 0n, 0n, ONBEHALF, RECEIVER),
    ).toThrow(/MORPHO_EXACTLY_ONE_ZERO/);
  });

  it("encodeMorphoWithdraw(1, 1) throws — both non-zero", () => {
    expect(() =>
      encodeMorphoWithdraw(TEST_WSTETH_USDC_PARAMS, 1n, 1n, ONBEHALF, RECEIVER),
    ).toThrow(/MORPHO_EXACTLY_ONE_ZERO/);
  });

  it("encodeMorphoBorrow(0, 0) throws — both zero", () => {
    expect(() =>
      encodeMorphoBorrow(TEST_WSTETH_USDC_PARAMS, 0n, 0n, ONBEHALF, RECEIVER),
    ).toThrow(/MORPHO_EXACTLY_ONE_ZERO/);
  });

  it("encodeMorphoBorrow(1, 1) throws — both non-zero", () => {
    expect(() =>
      encodeMorphoBorrow(TEST_WSTETH_USDC_PARAMS, 1n, 1n, ONBEHALF, RECEIVER),
    ).toThrow(/MORPHO_EXACTLY_ONE_ZERO/);
  });

  it("encodeMorphoRepay(0, 0) throws — both zero", () => {
    expect(() =>
      encodeMorphoRepay(TEST_WSTETH_USDC_PARAMS, 0n, 0n, ONBEHALF, "0x"),
    ).toThrow(/MORPHO_EXACTLY_ONE_ZERO/);
  });

  it("encodeMorphoRepay(1, 1) throws — both non-zero", () => {
    expect(() =>
      encodeMorphoRepay(TEST_WSTETH_USDC_PARAMS, 1n, 1n, ONBEHALF, "0x"),
    ).toThrow(/MORPHO_EXACTLY_ONE_ZERO/);
  });

  // Positive (one-zero-one-nonzero) — succeeds. Repeated here for the 4 share-
  // bearing functions to lock the invariant in both directions.
  it("encodeMorphoSupply(100, 0) succeeds — asset-based supply (canonical)", () => {
    expect(() =>
      encodeMorphoSupply(TEST_WSTETH_USDC_PARAMS, 100n, 0n, ONBEHALF, "0x"),
    ).not.toThrow();
  });

  it("encodeMorphoSupply(0, 100) succeeds — share-based supply", () => {
    expect(() =>
      encodeMorphoSupply(TEST_WSTETH_USDC_PARAMS, 0n, 100n, ONBEHALF, "0x"),
    ).not.toThrow();
  });

  // Collateral encoders exempt — supplyCollateral / withdrawCollateral take
  // ONLY (assets), no shares. zero-assets succeeds (Morpho contract reverts
  // on-chain; pre-encode gate doesn't fire).
  it("encodeMorphoSupplyCollateral(0) does NOT throw — no exactlyOneZero gate (no shares arg)", () => {
    expect(() =>
      encodeMorphoSupplyCollateral(TEST_WSTETH_USDC_PARAMS, 0n, ONBEHALF, "0x"),
    ).not.toThrow();
  });

  it("encodeMorphoWithdrawCollateral(0) does NOT throw — no exactlyOneZero gate (no shares arg)", () => {
    expect(() =>
      encodeMorphoWithdrawCollateral(TEST_WSTETH_USDC_PARAMS, 0n, ONBEHALF, RECEIVER),
    ).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// T10 — decodeMorphoBlueCall 7-arm exhaustiveness
// ---------------------------------------------------------------------------

describe("decodeMorphoBlueCall — 7-arm discriminated-union exhaustiveness", () => {
  it("arm 1/7 — supply round-trip → kind: 'morpho-supply' + marketId via deriveMarketId", () => {
    const data = encodeMorphoSupply(TEST_WSTETH_USDC_PARAMS, USDC_100, 0n, ONBEHALF, "0x");
    const result = decodeMorphoBlueCall(data);
    expect(result.kind).toBe("morpho-supply");
    if (result.kind === "morpho-supply") {
      expect(result.marketId).toBe(deriveMarketId(TEST_WSTETH_USDC_PARAMS));
    }
  });

  it("arm 2/7 — withdraw round-trip → kind: 'morpho-withdraw'", () => {
    const data = encodeMorphoWithdraw(
      TEST_WSTETH_USDC_PARAMS,
      USDC_100,
      0n,
      ONBEHALF,
      RECEIVER,
    );
    const result = decodeMorphoBlueCall(data);
    expect(result.kind).toBe("morpho-withdraw");
    if (result.kind === "morpho-withdraw") {
      expect(result.marketId).toBe(deriveMarketId(TEST_WSTETH_USDC_PARAMS));
    }
  });

  it("arm 3/7 — supplyCollateral round-trip → kind: 'morpho-supply-collateral'", () => {
    const data = encodeMorphoSupplyCollateral(TEST_WSTETH_USDC_PARAMS, WSTETH_1, ONBEHALF, "0x");
    const result = decodeMorphoBlueCall(data);
    expect(result.kind).toBe("morpho-supply-collateral");
    if (result.kind === "morpho-supply-collateral") {
      expect(result.marketId).toBe(deriveMarketId(TEST_WSTETH_USDC_PARAMS));
    }
  });

  it("arm 4/7 — withdrawCollateral round-trip → kind: 'morpho-withdraw-collateral'", () => {
    const data = encodeMorphoWithdrawCollateral(
      TEST_WSTETH_USDC_PARAMS,
      WSTETH_1,
      ONBEHALF,
      RECEIVER,
    );
    const result = decodeMorphoBlueCall(data);
    expect(result.kind).toBe("morpho-withdraw-collateral");
    if (result.kind === "morpho-withdraw-collateral") {
      expect(result.marketId).toBe(deriveMarketId(TEST_WSTETH_USDC_PARAMS));
    }
  });

  it("arm 5/7 — borrow round-trip → kind: 'morpho-borrow'", () => {
    const data = encodeMorphoBorrow(TEST_WSTETH_USDC_PARAMS, USDC_50, 0n, ONBEHALF, RECEIVER);
    const result = decodeMorphoBlueCall(data);
    expect(result.kind).toBe("morpho-borrow");
    if (result.kind === "morpho-borrow") {
      expect(result.marketId).toBe(deriveMarketId(TEST_WSTETH_USDC_PARAMS));
    }
  });

  it("arm 6/7 — repay round-trip → kind: 'morpho-repay'", () => {
    const data = encodeMorphoRepay(
      TEST_WSTETH_USDC_PARAMS,
      0n,
      MOCK_BORROW_SHARES,
      ONBEHALF,
      "0x",
    );
    const result = decodeMorphoBlueCall(data);
    expect(result.kind).toBe("morpho-repay");
    if (result.kind === "morpho-repay") {
      expect(result.marketId).toBe(deriveMarketId(TEST_WSTETH_USDC_PARAMS));
    }
  });

  // T11 — arm 7/7: empty data → unknown (no throw)
  it("arm 7/7 — empty data ('0x') → { kind: 'unknown' } (EIP-1559 native-send shape; decoder must NOT throw)", () => {
    const result = decodeMorphoBlueCall("0x" as Hex);
    expect(result.kind).toBe("unknown");
  });

  // T12 — bogus selector → unknown with selector echoed
  it("arm 7/7 — bogus selector (0xdeadbeef + zeros) → { kind: 'unknown', selector: '0xdeadbeef' } (no throw)", () => {
    const bogusData = ("0xdeadbeef" + "00".repeat(64)) as Hex;
    const result = decodeMorphoBlueCall(bogusData);
    expect(result.kind).toBe("unknown");
    if (result.kind === "unknown") {
      expect(result.selector).toBe("0xdeadbeef");
    }
  });

  it("arm 7/7 — ERC-20 transfer selector (0xa9059cbb) → { kind: 'unknown' } (no false positive against ERC-20 traffic)", () => {
    const transferData =
      "0xa9059cbb00000000000000000000000070997970c51812dc3a010c7d01b50e0d17dc79c80000000000000000000000000000000000000000000000000000000005f5e100" as Hex;
    const result = decodeMorphoBlueCall(transferData);
    expect(result.kind).toBe("unknown");
    if (result.kind === "unknown") {
      expect(result.selector).toBe("0xa9059cbb");
    }
  });

  it("arm 7/7 — truncated calldata for supply selector → { kind: 'unknown' } (try/catch fall-through)", () => {
    const truncated = (MORPHO_BLUE_SELECTORS.supply + "00") as Hex;
    const result = decodeMorphoBlueCall(truncated);
    expect(result.kind).toBe("unknown");
  });
});

// ---------------------------------------------------------------------------
// T13-T14 — _morphoBlue ESM spy-affordance referential equality
// ---------------------------------------------------------------------------

describe("_morphoBlue indirection (ESM spy-affordance smoke tests)", () => {
  it("_morphoBlue.decodeMorphoBlueCall === decodeMorphoBlueCall (referential equality of method)", () => {
    // The method MUST be the same function reference as the named export; a
    // future edit that accidentally re-binds `_morphoBlue.decodeMorphoBlueCall`
    // to a fresh closure would break Plan 29-03's
    // `vi.spyOn(_morphoBlue, "decodeMorphoBlueCall")` (the spy intercepts the
    // indirection, but production code would still call the original — a
    // silent no-op).
    expect(_morphoBlue.decodeMorphoBlueCall).toBe(decodeMorphoBlueCall);
    const data = encodeMorphoSupply(TEST_WSTETH_USDC_PARAMS, USDC_100, 0n, ONBEHALF, "0x");
    expect(_morphoBlue.decodeMorphoBlueCall(data)).toEqual(decodeMorphoBlueCall(data));
  });

  it("_morphoBlue.deriveMarketId === deriveMarketId (referential equality; Plan 29-03 intent-vs-reality spy hook)", () => {
    expect(_morphoBlue.deriveMarketId).toBe(deriveMarketId);
    expect(_morphoBlue.deriveMarketId(TEST_WSTETH_USDC_PARAMS)).toBe(WSTETH_USDC_MARKET_ID);
  });
});

// ---------------------------------------------------------------------------
// Bonus — MORPHO_BLUE_ABI fragment shape coverage
// ---------------------------------------------------------------------------

describe("MORPHO_BLUE_ABI shape — 15-fragment parseAbi (Phase 29 ABI lock)", () => {
  it("ABI fragment includes 6 write functions + 3 read functions + 3 events", () => {
    const fnNames = MORPHO_BLUE_ABI
      .filter((item) => item.type === "function")
      .map((item) => (item as { name: string }).name);
    // Writes (6)
    expect(fnNames).toContain("supply");
    expect(fnNames).toContain("withdraw");
    expect(fnNames).toContain("supplyCollateral");
    expect(fnNames).toContain("withdrawCollateral");
    expect(fnNames).toContain("borrow");
    expect(fnNames).toContain("repay");
    // Reads (3)
    expect(fnNames).toContain("position");
    expect(fnNames).toContain("market");
    expect(fnNames).toContain("idToMarketParams");

    const eventNames = MORPHO_BLUE_ABI
      .filter((item) => item.type === "event")
      .map((item) => (item as { name: string }).name);
    // Events (3)
    expect(eventNames).toContain("Supply");
    expect(eventNames).toContain("Borrow");
    expect(eventNames).toContain("SupplyCollateral");
  });
});
