// Pure encode + selector + decode + ESM-spy-affordance tests for
// src/protocols/compound-v3.ts.
//
// Phase 28 — Plan 28-01. Anchors:
//   - COMPOUND_V3_SELECTORS.supply === 0xf2b9fdb8 byte-identical to
//     viem.toFunctionSelector (A2 LOCK from research § Topic 1 / Assumptions).
//   - COMPOUND_V3_SELECTORS.withdraw === 0xf3fef3a3 byte-identical.
//   - encodeCompoundSupply + encodeCompoundWithdraw round-trip via
//     viem.decodeFunctionData (asset + amount preserved byte-identical).
//   - encodeCompoundWithdraw(USDC, MAX_UINT256) round-trips (no bigint
//     truncation in the encode path).
//   - decodeCompoundV3Call 3-arm discriminated-union exhaustiveness with
//     `isMax` flag on supply AND withdraw (Compound MAX_UINT256 sentinel for
//     full-position close on both supply-as-repay and withdraw-as-borrow).
//   - empty data ('0x') → kind: unknown (no throw).
//   - _compoundProtocols indirection: spy-affordance smoke (direct call ===
//     indirected call).

import { describe, expect, it } from "vitest";
import { type Address, type Hex, toFunctionSelector } from "viem";

import { MAX_UINT256 } from "../src/protocols/erc20.js";
import {
  COMPOUND_V3_COMET_ABI,
  COMPOUND_V3_SELECTORS,
  _compoundProtocols,
  decodeCompoundV3Call,
  encodeCompoundSupply,
  encodeCompoundWithdraw,
} from "../src/protocols/compound-v3.js";

// Canonical USDC mainnet contract (decimals=6). Same address used in Aave V3
// Fixtures G/H; mirroring the cross-fixture USDC anchor is intentional —
// agents experimenting with both protocols see one stable token literal.
const USDC = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48" as Address;
const USDC_100 = 100_000_000n; // 100 USDC, decimals=6

describe("COMPOUND_V3_SELECTORS — A2 LOCK (research § Assumptions; byte-identity to viem.toFunctionSelector)", () => {
  it("supply === 0xf2b9fdb8 byte-identical to viem.toFunctionSelector", () => {
    expect(COMPOUND_V3_SELECTORS.supply).toBe("0xf2b9fdb8");
    expect(COMPOUND_V3_SELECTORS.supply).toBe(
      toFunctionSelector("function supply(address,uint256)"),
    );
  });

  it("withdraw === 0xf3fef3a3 byte-identical to viem.toFunctionSelector", () => {
    expect(COMPOUND_V3_SELECTORS.withdraw).toBe("0xf3fef3a3");
    expect(COMPOUND_V3_SELECTORS.withdraw).toBe(
      toFunctionSelector("function withdraw(address,uint256)"),
    );
  });
});

describe("encodeCompoundSupply — 2-arg calldata shape (Compound delta vs Aave 4-arg)", () => {
  it("encodes supply(USDC, 100e6); selector + length + round-trip via decodeCompoundV3Call", () => {
    const data = encodeCompoundSupply(USDC, USDC_100);
    // 68 bytes = 4-byte selector + 2 × 32-byte args → 0x + 136 hex = 138 chars.
    expect(data.length).toBe(138);
    expect(data.slice(0, 10).toLowerCase()).toBe(COMPOUND_V3_SELECTORS.supply);

    const decoded = decodeCompoundV3Call(data);
    expect(decoded.kind).toBe("compound-supply");
    if (decoded.kind === "compound-supply") {
      expect(decoded.asset.toLowerCase()).toBe(USDC.toLowerCase());
      expect(decoded.amount).toBe(USDC_100);
      expect(decoded.isMax).toBe(false);
    }
  });
});

describe("encodeCompoundWithdraw — 2-arg calldata shape (Compound delta vs Aave 3-arg)", () => {
  it("encodes withdraw(USDC, 100e6); selector + length + round-trip via decodeCompoundV3Call", () => {
    const data = encodeCompoundWithdraw(USDC, USDC_100);
    expect(data.length).toBe(138);
    expect(data.slice(0, 10).toLowerCase()).toBe(COMPOUND_V3_SELECTORS.withdraw);

    const decoded = decodeCompoundV3Call(data);
    expect(decoded.kind).toBe("compound-withdraw");
    if (decoded.kind === "compound-withdraw") {
      expect(decoded.asset.toLowerCase()).toBe(USDC.toLowerCase());
      expect(decoded.amount).toBe(USDC_100);
      expect(decoded.isMax).toBe(false);
    }
  });

  it("encodes withdraw(USDC, MAX_UINT256) — bigint MAX preserved encode→decode byte-identical (no truncation)", () => {
    const data = encodeCompoundWithdraw(USDC, MAX_UINT256);
    expect(data.length).toBe(138);
    // The last 64 hex chars are the amount slot; MAX_UINT256 = 64 × 'f'.
    expect(data.slice(-64)).toBe("f".repeat(64));

    const decoded = decodeCompoundV3Call(data);
    expect(decoded.kind).toBe("compound-withdraw");
    if (decoded.kind === "compound-withdraw") {
      expect(decoded.amount).toBe(MAX_UINT256);
      expect(decoded.isMax).toBe(true);
    }
  });
});

describe("decodeCompoundV3Call — discriminated-union exhaustiveness (3 arms; isMax sentinel on supply AND withdraw)", () => {
  it("supply(MAX_UINT256) → { kind: 'compound-supply', isMax: true } (repay-full-position sentinel)", () => {
    const data = encodeCompoundSupply(USDC, MAX_UINT256);
    const result = decodeCompoundV3Call(data);
    expect(result.kind).toBe("compound-supply");
    if (result.kind === "compound-supply") {
      expect(result.amount).toBe(MAX_UINT256);
      expect(result.isMax).toBe(true);
    }
  });

  it("unknown selector (0xdeadbeef + zeros) → { kind: 'unknown', selector: '0xdeadbeef' } (no throw)", () => {
    const bogusData = ("0xdeadbeef" + "00".repeat(64)) as Hex;
    const result = decodeCompoundV3Call(bogusData);
    expect(result.kind).toBe("unknown");
    if (result.kind === "unknown") {
      expect(result.selector).toBe("0xdeadbeef");
    }
  });

  it("empty data ('0x') → { kind: 'unknown' } (EIP-1559 native-send shape; decoder must NOT throw)", () => {
    const result = decodeCompoundV3Call("0x" as Hex);
    expect(result.kind).toBe("unknown");
  });

  it("truncated calldata for supply selector → { kind: 'unknown' } (try/catch fall-through)", () => {
    // Selector bytes only — decodeFunctionData throws AbiDecodingDataSizeTooSmallError;
    // the try/catch catches and falls through to unknown.
    const truncated = (COMPOUND_V3_SELECTORS.supply + "00") as Hex;
    const result = decodeCompoundV3Call(truncated);
    expect(result.kind).toBe("unknown");
  });

  it("ERC-20 transfer selector → { kind: 'unknown' } (no false positive against ERC-20 traffic)", () => {
    const transferData =
      "0xa9059cbb00000000000000000000000070997970c51812dc3a010c7d01b50e0d17dc79c80000000000000000000000000000000000000000000000000000000005f5e100" as Hex;
    const result = decodeCompoundV3Call(transferData);
    expect(result.kind).toBe("unknown");
    if (result.kind === "unknown") {
      expect(result.selector).toBe("0xa9059cbb");
    }
  });
});

describe("_compoundProtocols indirection (ESM spy-affordance smoke test)", () => {
  it("_compoundProtocols.decodeCompoundV3Call(data) === decodeCompoundV3Call(data) (referential equality of method)", () => {
    // The method MUST be the same function reference as the named export; a
    // future edit that accidentally re-binds `_compoundProtocols.
    // decodeCompoundV3Call` to a fresh closure would break Plan 28-04's
    // `vi.spyOn(_compoundProtocols, "decodeCompoundV3Call")` (the spy
    // intercepts the indirection, but production code would still call the
    // original — a silent no-op).
    expect(_compoundProtocols.decodeCompoundV3Call).toBe(decodeCompoundV3Call);
    const data = encodeCompoundSupply(USDC, USDC_100);
    expect(_compoundProtocols.decodeCompoundV3Call(data)).toEqual(decodeCompoundV3Call(data));
  });
});

describe("COMPOUND_V3_COMET_ABI shape — 8-function parseAbi round-trip (Phase 28 ABI lock)", () => {
  it("ABI fragment includes 8 expected function entries for Phase 28 coverage", () => {
    const fnNames = COMPOUND_V3_COMET_ABI
      .filter((item) => item.type === "function")
      .map((item) => (item as { name: string }).name);
    // Calldata-emitting (Plans 28-02 / 28-03)
    expect(fnNames).toContain("supply");
    expect(fnNames).toContain("withdraw");
    // Read-only intent-gate + reader (Plans 28-02 / 28-03 / 28-04)
    expect(fnNames).toContain("baseToken");
    expect(fnNames).toContain("balanceOf");
    expect(fnNames).toContain("borrowBalanceOf");
    expect(fnNames).toContain("collateralBalanceOf");
    expect(fnNames).toContain("isBorrowCollateralized");
    expect(fnNames).toContain("isLiquidatable");
  });
});
