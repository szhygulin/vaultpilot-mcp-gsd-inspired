// test/chains-curve.test.ts — Phase 34 Plan 34-01 Task 2
//
// Coverage:
//   - ABI selector byte-identity for all 6 parseAbi exports (drift gate).
//   - readContract mock-client assertions for all 3 reader helpers.
//   - _curveChain indirection drift gate (all 3 helpers exported as own keys).
//
// Analog: test/chains-aave-v3.test.ts (role-match per PATTERNS.md).

import { describe, expect, it, vi } from "vitest";
import { getAddress, toFunctionSelector, type Address, type PublicClient } from "viem";

import {
  CURVE_LEGACY_EXCHANGE_ABI,
  CURVE_NG_EXCHANGE_ABI,
  CURVE_GET_DY_ABI,
  CURVE_NG_ADD_LIQUIDITY_ABI,
  CURVE_NG_CALC_TOKEN_AMOUNT_ABI,
  CURVE_LP_BALANCE_OF_ABI,
  CURVE_LEGACY_ADD_LIQUIDITY_ABI,
  CURVE_LEGACY_CALC_TOKEN_AMOUNT_ABI,
  getCurveGetDy,
  getCurveCalcTokenAmount,
  getCurveLegacyCalcTokenAmount,
  getCurveLpBalance,
  _curveChain,
} from "../src/chains/curve.js";

// ---------------------------------------------------------------------------
// ABI selector byte-identity (drift gate — any text change to the ABI string
// fires this test before downstream calldata changes surface).
// ---------------------------------------------------------------------------

describe("src/chains/curve.ts — ABI selector byte-identity (Phase 34 Plan 34-01)", () => {
  it("CURVE_LEGACY_EXCHANGE_ABI — selector is 0x3df02124 (function exchange(int128,int128,uint256,uint256))", () => {
    expect(
      toFunctionSelector("function exchange(int128 i, int128 j, uint256 dx, uint256 min_dy) payable returns (uint256)"),
    ).toBe("0x3df02124");
    // Verify the parseAbi fragment actually produces the same selector.
    const fn = CURVE_LEGACY_EXCHANGE_ABI[0];
    expect(toFunctionSelector(fn)).toBe("0x3df02124");
  });

  it("CURVE_NG_EXCHANGE_ABI — selector is 0xddc1f59d (function exchange(int128,int128,uint256,uint256,address))", () => {
    expect(
      toFunctionSelector("function exchange(int128 i, int128 j, uint256 _dx, uint256 _min_dy, address _receiver) returns (uint256)"),
    ).toBe("0xddc1f59d");
    const fn = CURVE_NG_EXCHANGE_ABI[0];
    expect(toFunctionSelector(fn)).toBe("0xddc1f59d");
  });

  it("CURVE_GET_DY_ABI — selector is 0x5e0d443f (function get_dy(int128,int128,uint256))", () => {
    expect(
      toFunctionSelector("function get_dy(int128 i, int128 j, uint256 dx) view returns (uint256)"),
    ).toBe("0x5e0d443f");
    const fn = CURVE_GET_DY_ABI[0];
    expect(toFunctionSelector(fn)).toBe("0x5e0d443f");
  });

  it("CURVE_NG_ADD_LIQUIDITY_ABI — selector is 0xb72df5de (2-param form, NOT 0xa7256d09 3-param)", () => {
    expect(
      toFunctionSelector("function add_liquidity(uint256[] _amounts, uint256 _min_mint_amount) returns (uint256)"),
    ).toBe("0xb72df5de");
    const fn = CURVE_NG_ADD_LIQUIDITY_ABI[0];
    expect(toFunctionSelector(fn)).toBe("0xb72df5de");
  });

  it("CURVE_NG_CALC_TOKEN_AMOUNT_ABI — selector is 0x3db06dd8", () => {
    expect(
      toFunctionSelector("function calc_token_amount(uint256[] _amounts, bool _is_deposit) view returns (uint256)"),
    ).toBe("0x3db06dd8");
    const fn = CURVE_NG_CALC_TOKEN_AMOUNT_ABI[0];
    expect(toFunctionSelector(fn)).toBe("0x3db06dd8");
  });

  it("CURVE_LP_BALANCE_OF_ABI — selector is 0x70a08231 (balanceOf(address))", () => {
    expect(
      toFunctionSelector("function balanceOf(address owner) view returns (uint256)"),
    ).toBe("0x70a08231");
    const fn = CURVE_LP_BALANCE_OF_ABI[0];
    expect(toFunctionSelector(fn)).toBe("0x70a08231");
  });

  // Phase 43 — legacy fixed-array ABIs (RESEARCH-VERIFIED selectors).
  it("CURVE_LEGACY_ADD_LIQUIDITY_ABI — selector is 0x0b4c7e4d (add_liquidity(uint256[2],uint256))", () => {
    expect(
      toFunctionSelector("function add_liquidity(uint256[2],uint256)"),
    ).toBe("0x0b4c7e4d");
    const fn = CURVE_LEGACY_ADD_LIQUIDITY_ABI[0];
    expect(toFunctionSelector(fn)).toBe("0x0b4c7e4d");
  });

  it("CURVE_LEGACY_CALC_TOKEN_AMOUNT_ABI — selector is 0xed8e84f3 (calc_token_amount(uint256[2],bool))", () => {
    expect(
      toFunctionSelector("function calc_token_amount(uint256[2],bool)"),
    ).toBe("0xed8e84f3");
    const fn = CURVE_LEGACY_CALC_TOKEN_AMOUNT_ABI[0];
    expect(toFunctionSelector(fn)).toBe("0xed8e84f3");
  });
});

// ---------------------------------------------------------------------------
// Reader helpers — mock-client assertions.
// ---------------------------------------------------------------------------

function makeMockClient(returnValue: bigint): PublicClient {
  return {
    readContract: vi.fn().mockResolvedValue(returnValue),
  } as unknown as PublicClient;
}

const DUMMY_POOL = getAddress("0xDC24316b9AE028F1497c275EB9192a3Ea0f67022");
const DUMMY_LP = getAddress("0x06325440D014e39736583c165C2963BA99fAf14E");
const DUMMY_WALLET = getAddress("0x70997970C51812dc3A010C7d01b50e0d17dc79C8");

describe("getCurveGetDy — readContract mock assertions", () => {
  it("calls readContract with correct address, abi, functionName, and args; returns bigint", async () => {
    const client = makeMockClient(950_000000000000000n);
    const result = await getCurveGetDy(client, DUMMY_POOL, 1, 0, 1_000000000000000000n);
    expect(result).toBe(950_000000000000000n);
    expect(client.readContract).toHaveBeenCalledOnce();
    const callArgs = (client.readContract as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(callArgs.address).toBe(DUMMY_POOL);
    expect(callArgs.abi).toBe(CURVE_GET_DY_ABI);
    expect(callArgs.functionName).toBe("get_dy");
    // i=1, j=0 — both encoded as bigint per viem convention
    expect(callArgs.args).toEqual([1n, 0n, 1_000000000000000000n]);
  });
});

describe("getCurveCalcTokenAmount — readContract mock assertions", () => {
  it("calls readContract with correct args and passes _is_deposit=true", async () => {
    const client = makeMockClient(99_000000000000000000n);
    const amounts = [50_000000n, 50_000000n];
    const result = await getCurveCalcTokenAmount(client, DUMMY_POOL, amounts);
    expect(result).toBe(99_000000000000000000n);
    expect(client.readContract).toHaveBeenCalledOnce();
    const callArgs = (client.readContract as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(callArgs.address).toBe(DUMMY_POOL);
    expect(callArgs.abi).toBe(CURVE_NG_CALC_TOKEN_AMOUNT_ABI);
    expect(callArgs.functionName).toBe("calc_token_amount");
    // _is_deposit MUST be true (deposit direction); false would compute withdrawal.
    expect(callArgs.args).toEqual([amounts, true]);
  });
});

describe("getCurveLegacyCalcTokenAmount — readContract mock assertions (Phase 43)", () => {
  it("passes a FIXED uint256[2] amounts array + is_deposit=true to readContract; returns bigint", async () => {
    const client = makeMockClient(987_654_321n);
    const amounts: [bigint, bigint] = [1_000000000000000000n, 2_000000000000000000n];
    const result = await getCurveLegacyCalcTokenAmount(client, DUMMY_POOL, amounts);
    expect(result).toBe(987_654_321n);
    expect(client.readContract).toHaveBeenCalledOnce();
    const callArgs = (client.readContract as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(callArgs.address).toBe(DUMMY_POOL);
    // MUST use the fixed-array ABI, NOT the dynamic-array NG reader (Pitfall 1).
    expect(callArgs.abi).toBe(CURVE_LEGACY_CALC_TOKEN_AMOUNT_ABI);
    expect(callArgs.functionName).toBe("calc_token_amount");
    // amounts is the 2-tuple; is_deposit MUST be true (deposit direction).
    expect(callArgs.args).toEqual([amounts, true]);
  });
});

describe("getCurveLpBalance — readContract mock assertions", () => {
  it("calls readContract on LP token address (not pool address) with correct wallet", async () => {
    const client = makeMockClient(100_000000000000000000n);
    const result = await getCurveLpBalance(client, DUMMY_LP, DUMMY_WALLET);
    expect(result).toBe(100_000000000000000000n);
    expect(client.readContract).toHaveBeenCalledOnce();
    const callArgs = (client.readContract as ReturnType<typeof vi.fn>).mock.calls[0][0];
    // CRITICAL: reads from DUMMY_LP (the lpToken field), NOT from the pool address.
    // For stable_ng pools lpToken === pool.address; for legacy they differ.
    // This helper is agnostic — caller supplies the lpTokenAddress.
    expect(callArgs.address).toBe(DUMMY_LP);
    expect(callArgs.abi).toBe(CURVE_LP_BALANCE_OF_ABI);
    expect(callArgs.functionName).toBe("balanceOf");
    expect(callArgs.args).toEqual([DUMMY_WALLET]);
  });
});

// ---------------------------------------------------------------------------
// _curveChain indirection drift gate.
// ---------------------------------------------------------------------------

describe("_curveChain ESM spy-affordance indirection (CLAUDE.md convention)", () => {
  it("_curveChain exports getCurveGetDy as an own property", () => {
    expect(Object.prototype.hasOwnProperty.call(_curveChain, "getCurveGetDy")).toBe(true);
    expect(typeof _curveChain.getCurveGetDy).toBe("function");
  });

  it("_curveChain exports getCurveCalcTokenAmount as an own property", () => {
    expect(Object.prototype.hasOwnProperty.call(_curveChain, "getCurveCalcTokenAmount")).toBe(true);
    expect(typeof _curveChain.getCurveCalcTokenAmount).toBe("function");
  });

  it("_curveChain exports getCurveLpBalance as an own property", () => {
    expect(Object.prototype.hasOwnProperty.call(_curveChain, "getCurveLpBalance")).toBe(true);
    expect(typeof _curveChain.getCurveLpBalance).toBe("function");
  });

  it("_curveChain exports getCurveLegacyCalcTokenAmount as an own property (Phase 43)", () => {
    expect(Object.prototype.hasOwnProperty.call(_curveChain, "getCurveLegacyCalcTokenAmount")).toBe(true);
    expect(typeof _curveChain.getCurveLegacyCalcTokenAmount).toBe("function");
  });

  it("_curveChain has exactly 4 keys (drift gate — accidental removal fires here)", () => {
    expect(Object.keys(_curveChain)).toHaveLength(4);
  });
});
