// test/protocols-lido.test.ts — ABI selector byte-identity regression +
// encoder round-trip tests for src/protocols/lido.ts (Phase 30 Plan 30-01).
//
// Structural mirror of test/protocols-weth9.test.ts (Phase 6 analog).
//
// Two test batteries:
//   1. LIDO_SELECTORS byte-identity — 4 hardcoded selectors pinned to
//      research § Topic 1 `viem.toFunctionSelector` verified values. Any
//      drift in the selector constants breaks the payloadFingerprint chain
//      (Fixtures V/W/X/Y in test/signing-fingerprint.test.ts fail too).
//   2. Encoder round-trips — each encoder produces calldata with the correct
//      selector prefix + expected byte length.
//
// NOTE on requestWithdrawals calldata length:
//   Plan 30-01 states "100-byte (202-char)" calldata for requestWithdrawals.
//   The empirically verified ABI encoding for `(uint256[] calldata, address)`
//   with one element is 132 bytes (266 chars). ABI head+tail layout:
//     4  selector
//    32  head: offset to _amounts (= 0x40)
//    32  head: _owner (static, inline)
//    32  tail: _amounts.length = 1
//    32  tail: _amounts[0] = stethAmountWei
//   Total = 132 bytes = 266 chars (plan's 100-byte arithmetic omitted one head slot).
//   Tests assert the empirical 132-byte value.
//
// T-LIDO-SPENDER-DRIFT-1 cross-view byte-identity: the SOT-address cross-check
// between KNOWN_SPENDERS_ETHEREUM rows and the getLido*Address(1) getters lives
// in test/config-contracts.test.ts (Phase 30 Plan 30-01 block added there).

import { describe, expect, it } from "vitest";
import { getAddress, toFunctionSelector, decodeFunctionData, type Address } from "viem";

import {
  LIDO_SELECTORS,
  STETH_DECIMALS,
  WSTETH_DECIMALS,
  LIDO_STETH_SUBMIT_ABI,
  WQ_REQUEST_ABI,
  WSTETH_WRAP_ABI,
  WSTETH_UNWRAP_ABI,
  encodeLidoSubmit,
  encodeRequestWithdrawals,
  encodeWstethWrap,
  encodeWstethUnwrap,
  getLidoStethAddress,
  getLidoWstethAddress,
  getLidoWithdrawalQueueAddress,
} from "../src/protocols/lido.js";

// ---------------------------------------------------------------------------
// LIDO_SELECTORS — 4-selector byte-identity regression anchor (D-07)
// ---------------------------------------------------------------------------

describe("LIDO_SELECTORS — 4-selector byte-identity regression anchor (Phase 30 Plan 30-01)", () => {
  it("submit === 0xa1903eab byte-identical to viem.toFunctionSelector(\"submit(address)\")", () => {
    expect(LIDO_SELECTORS.submit).toBe("0xa1903eab");
    // Cross-check against viem — drift here OR in the constant both fail.
    expect(toFunctionSelector("submit(address)")).toBe("0xa1903eab");
  });

  it("requestWithdrawals === 0xd6681042 byte-identical to viem.toFunctionSelector(...)", () => {
    expect(LIDO_SELECTORS.requestWithdrawals).toBe("0xd6681042");
    expect(toFunctionSelector("requestWithdrawals(uint256[],address)")).toBe("0xd6681042");
  });

  it("wrap === 0xea598cb0 byte-identical to viem.toFunctionSelector(\"wrap(uint256)\")", () => {
    expect(LIDO_SELECTORS.wrap).toBe("0xea598cb0");
    expect(toFunctionSelector("wrap(uint256)")).toBe("0xea598cb0");
  });

  it("unwrap === 0xde0e9a3e byte-identical to viem.toFunctionSelector(\"unwrap(uint256)\")", () => {
    expect(LIDO_SELECTORS.unwrap).toBe("0xde0e9a3e");
    expect(toFunctionSelector("unwrap(uint256)")).toBe("0xde0e9a3e");
  });
});

// ---------------------------------------------------------------------------
// Decimal constants
// ---------------------------------------------------------------------------

describe("STETH_DECIMALS + WSTETH_DECIMALS — constant anchors", () => {
  it("STETH_DECIMALS === 18", () => {
    expect(STETH_DECIMALS).toBe(18);
  });

  it("WSTETH_DECIMALS === 18", () => {
    expect(WSTETH_DECIMALS).toBe(18);
  });
});

// ---------------------------------------------------------------------------
// encodeLidoSubmit — 36-byte calldata (Fixture V cross-link)
// ---------------------------------------------------------------------------

describe("encodeLidoSubmit — 36-byte calldata shape (Fixture V cross-link)", () => {
  const REFERRAL_ZERO = "0x0000000000000000000000000000000000000000" as Address;

  it("selector prefix === LIDO_SELECTORS.submit (0xa1903eab)", () => {
    const data = encodeLidoSubmit(REFERRAL_ZERO);
    expect(data.slice(0, 10).toLowerCase()).toBe(LIDO_SELECTORS.submit);
  });

  it("calldata length === 74 chars (36 bytes: 4 selector + 32 referral)", () => {
    const data = encodeLidoSubmit(REFERRAL_ZERO);
    // 0x + 8 selector hex + 64 address hex = 74 chars
    expect(data.length).toBe(74);
  });

  it("round-trips via viem decodeFunctionData — referral address preserved", () => {
    const referral = getAddress("0x70997970C51812dc3A010C7d01b50e0d17dc79C8");
    const data = encodeLidoSubmit(referral);
    const decoded = decodeFunctionData({ abi: LIDO_STETH_SUBMIT_ABI, data });
    expect(decoded.functionName).toBe("submit");
    expect((decoded.args as [Address])[0]).toBe(referral);
  });

  it("address(0) referral — 64 trailing zero hex chars", () => {
    const data = encodeLidoSubmit(REFERRAL_ZERO);
    // The referral is zero-padded to 32 bytes — last 64 hex chars are all zeros.
    expect(data.slice(10)).toBe("0".repeat(64));
  });
});

// ---------------------------------------------------------------------------
// encodeRequestWithdrawals — 132-byte calldata + array encoding (Fixture W)
// ---------------------------------------------------------------------------
//
// T-LIDO-SPENDER-DRIFT-1 cross-view: approval spender address is
// getLidoWithdrawalQueueAddress(1) — cross-checked in test/config-contracts.test.ts.

describe("encodeRequestWithdrawals — 132-byte calldata (Pitfall 1 array encoding; Fixture W cross-link)", () => {
  const OWNER = getAddress("0x70997970C51812dc3A010C7d01b50e0d17dc79C8");
  const AMOUNT = 1_000_000_000_000_000_000n; // 1 stETH (1e18)

  it("selector prefix === LIDO_SELECTORS.requestWithdrawals (0xd6681042)", () => {
    const data = encodeRequestWithdrawals(AMOUNT, OWNER);
    expect(data.slice(0, 10).toLowerCase()).toBe(LIDO_SELECTORS.requestWithdrawals);
  });

  it("calldata length === 266 chars (132 bytes: 4 selector + 32 offset + 32 owner + 32 len=1 + 32 element)", () => {
    // ABI(uint256[] calldata _amounts, address _owner) with 1 element:
    //   head: offset_for_amounts(32) + owner_inline(32) = 64 bytes
    //   tail: _amounts.length(32) + _amounts[0](32) = 64 bytes
    //   selector: 4 bytes
    //   total: 4 + 64 + 64 = 132 bytes = 0x + 264 hex chars = 266 chars
    const data = encodeRequestWithdrawals(AMOUNT, OWNER);
    expect(data.length).toBe(266);
    expect((data.length - 2) / 2).toBe(132);
  });

  it("round-trips via viem decodeFunctionData — amounts array + owner preserved", () => {
    const data = encodeRequestWithdrawals(AMOUNT, OWNER);
    const decoded = decodeFunctionData({ abi: WQ_REQUEST_ABI, data });
    expect(decoded.functionName).toBe("requestWithdrawals");
    const [amounts, owner] = decoded.args as [readonly bigint[], Address];
    // Pitfall 1 check: single-element array is preserved (not collapsed to scalar).
    // This is the D-06 correctness invariant — encodeRequestWithdrawals MUST
    // wrap stethAmountWei in [stethAmountWei] not pass it as a raw bigint.
    expect(amounts).toHaveLength(1);
    expect(amounts[0]).toBe(AMOUNT);
    expect(owner).toBe(OWNER);
  });

  it("two distinct amounts produce distinct calldata (no aliasing)", () => {
    const data1 = encodeRequestWithdrawals(1_000_000_000_000_000_000n, OWNER);
    const data2 = encodeRequestWithdrawals(2_000_000_000_000_000_000n, OWNER);
    expect(data1).not.toBe(data2);
  });
});

// ---------------------------------------------------------------------------
// encodeWstethWrap — 36-byte calldata (Fixture X cross-link)
// ---------------------------------------------------------------------------

describe("encodeWstethWrap — 36-byte calldata shape (Fixture X cross-link)", () => {
  it("selector prefix === LIDO_SELECTORS.wrap (0xea598cb0)", () => {
    const data = encodeWstethWrap(1_000_000_000_000_000_000n);
    expect(data.slice(0, 10).toLowerCase()).toBe(LIDO_SELECTORS.wrap);
  });

  it("calldata length === 74 chars (36 bytes: 4 selector + 32 amount)", () => {
    const data = encodeWstethWrap(1_000_000_000_000_000_000n);
    expect(data.length).toBe(74);
  });

  it("round-trips via viem decodeFunctionData — stETH amount preserved", () => {
    const amount = 500_000_000_000_000_000n; // 0.5 stETH
    const data = encodeWstethWrap(amount);
    const decoded = decodeFunctionData({ abi: WSTETH_WRAP_ABI, data });
    expect(decoded.functionName).toBe("wrap");
    expect((decoded.args as [bigint])[0]).toBe(amount);
  });

  it("distinct amounts produce distinct calldata", () => {
    const d1 = encodeWstethWrap(1n);
    const d2 = encodeWstethWrap(2n);
    expect(d1).not.toBe(d2);
  });
});

// ---------------------------------------------------------------------------
// encodeWstethUnwrap — 36-byte calldata (Fixture Y cross-link)
// ---------------------------------------------------------------------------

describe("encodeWstethUnwrap — 36-byte calldata shape (Fixture Y cross-link)", () => {
  it("selector prefix === LIDO_SELECTORS.unwrap (0xde0e9a3e)", () => {
    const data = encodeWstethUnwrap(1_000_000_000_000_000_000n);
    expect(data.slice(0, 10).toLowerCase()).toBe(LIDO_SELECTORS.unwrap);
  });

  it("calldata length === 74 chars (36 bytes: 4 selector + 32 amount)", () => {
    const data = encodeWstethUnwrap(1_000_000_000_000_000_000n);
    expect(data.length).toBe(74);
  });

  it("round-trips via viem decodeFunctionData — wstETH amount preserved", () => {
    const amount = 750_000_000_000_000_000n; // 0.75 wstETH
    const data = encodeWstethUnwrap(amount);
    const decoded = decodeFunctionData({ abi: WSTETH_UNWRAP_ABI, data });
    expect(decoded.functionName).toBe("unwrap");
    expect((decoded.args as [bigint])[0]).toBe(amount);
  });

  it("wrap !== unwrap selector (no selector collision)", () => {
    const wrapData = encodeWstethWrap(1n);
    const unwrapData = encodeWstethUnwrap(1n);
    expect(wrapData.slice(0, 10)).not.toBe(unwrapData.slice(0, 10));
  });
});

// ---------------------------------------------------------------------------
// SOT address getters (convenience re-exports from contracts.ts)
// ---------------------------------------------------------------------------

describe("getLidoStethAddress / getLidoWstethAddress / getLidoWithdrawalQueueAddress — SOT delegation", () => {
  it("getLidoStethAddress(1) returns a non-null EIP-55 address", () => {
    const addr = getLidoStethAddress(1);
    expect(addr).not.toBeNull();
    expect(addr).toBe(getAddress(addr!));
  });

  it("getLidoWstethAddress(1) returns a non-null EIP-55 address", () => {
    const addr = getLidoWstethAddress(1);
    expect(addr).not.toBeNull();
    expect(addr).toBe(getAddress(addr!));
  });

  it("getLidoWithdrawalQueueAddress(1) returns a non-null EIP-55 address", () => {
    const addr = getLidoWithdrawalQueueAddress(1);
    expect(addr).not.toBeNull();
    expect(addr).toBe(getAddress(addr!));
  });

  it("getLidoStethAddress(137) returns null (Polygon not in LIDO_RAW)", () => {
    expect(getLidoStethAddress(137)).toBeNull();
  });

  it("getLidoWstethAddress(42161) returns the Arbitrum bridged wstETH (non-null)", () => {
    // Arbitrum has a wstETH bridged ERC20 — not null for this chain.
    const addr = getLidoWstethAddress(42161);
    expect(addr).not.toBeNull();
    expect(addr).toBe(getAddress("0x5979D7b546E38E414F7E9822514be443A4800529"));
  });
});
