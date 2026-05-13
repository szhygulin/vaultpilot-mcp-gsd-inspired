// Pure encode + selector + decode + ESM-spy-affordance tests for
// src/protocols/aave-v3.ts.
//
// Phase 7 — Plan 07-03. Anchors:
//   - AAVE_V3_SELECTORS.supply === 0x617ba037 byte-identical to
//     viem.toFunctionSelector (T-AAVE-SELECTOR-DRIFT-1 mitigation).
//   - AAVE_V3_SELECTORS.withdraw === 0x69328dec byte-identical.
//   - encodeAaveSupply(USDC, 100e6, anvil#1, 0) byte-identical to the
//     canonical Fixture G calldata bytes (cross-link to
//     test/signing-fingerprint.test.ts).
//   - encodeAaveWithdraw(USDC, 100e6, anvil#1) byte-identical to Fixture H.
//   - decodeAaveV3Call round-trips both encode shapes via discriminated
//     union; ERC-20 transfer selector falls through to { kind: "unknown" }.
//   - _aaveProtocols indirection: spy-affordance smoke (direct call ==
//     indirected call).

import { describe, expect, it } from "vitest";
import { type Address, type Hex, toFunctionSelector } from "viem";

import { MAX_UINT256 } from "../src/protocols/erc20.js";
import {
  AAVE_V3_POOL_ABI,
  AAVE_V3_SELECTORS,
  _aaveProtocols,
  decodeAaveV3Call,
  encodeAaveSupply,
  encodeAaveWithdraw,
} from "../src/protocols/aave-v3.js";

// Canonical Fixture G + H inputs (mirror of plan § Interfaces fixture
// literals). Anvil account #1 — Hardhat / Foundry default test address.
const USDC = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48" as Address;
const ANVIL_1 = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" as Address;
const USDC_100 = 100_000_000n; // 100 USDC, decimals=6

// Canonical Fixture G calldata bytes — 132-byte supply(asset, 100e6, anvil#1,
// 0). 0x + 8-hex selector + 4 × 64-hex args = 266 chars total.
const FIXTURE_G_DATA =
  "0x617ba037" +
  "000000000000000000000000a0b86991c6218b36c1d19d4a2e9eb0ce3606eb48" + // USDC
  "0000000000000000000000000000000000000000000000000000000005f5e100" + // 100e6
  "00000000000000000000000070997970c51812dc3a010c7d01b50e0d17dc79c8" + // onBehalfOf
  "0000000000000000000000000000000000000000000000000000000000000000"; // referralCode=0

// Canonical Fixture H calldata bytes — 100-byte withdraw(asset, 100e6, anvil#1).
// 0x + 8-hex selector + 3 × 64-hex args = 202 chars total.
const FIXTURE_H_DATA =
  "0x69328dec" +
  "000000000000000000000000a0b86991c6218b36c1d19d4a2e9eb0ce3606eb48" + // USDC
  "0000000000000000000000000000000000000000000000000000000005f5e100" + // 100e6
  "00000000000000000000000070997970c51812dc3a010c7d01b50e0d17dc79c8"; // to

describe("AAVE_V3_SELECTORS — universal selector regression anchor (T-AAVE-SELECTOR-DRIFT-1)", () => {
  it("supply === 0x617ba037 byte-identical to viem.toFunctionSelector", () => {
    expect(AAVE_V3_SELECTORS.supply).toBe("0x617ba037");
    expect(AAVE_V3_SELECTORS.supply).toBe(
      toFunctionSelector("function supply(address,uint256,address,uint16)"),
    );
  });

  it("withdraw === 0x69328dec byte-identical to viem.toFunctionSelector", () => {
    expect(AAVE_V3_SELECTORS.withdraw).toBe("0x69328dec");
    expect(AAVE_V3_SELECTORS.withdraw).toBe(
      toFunctionSelector("function withdraw(address,uint256,address)"),
    );
  });
});

describe("encodeAaveSupply — Fixture G calldata cross-link", () => {
  it("encodes supply(USDC, 100e6, anvil#1, 0) byte-identical to Fixture G data", () => {
    const data = encodeAaveSupply(USDC, USDC_100, ANVIL_1, 0);
    expect(data.toLowerCase()).toBe(FIXTURE_G_DATA);
    // 132 bytes = 4-byte selector + 4 × 32-byte args = 0x + 264 hex = 266 chars.
    expect(data.length).toBe(266);
    expect(data.slice(0, 10)).toBe(AAVE_V3_SELECTORS.supply);
  });

  it("default referralCode = 0 (Aave V3 deprecates referrals; documented no-op)", () => {
    const explicit = encodeAaveSupply(USDC, USDC_100, ANVIL_1, 0);
    const defaulted = encodeAaveSupply(USDC, USDC_100, ANVIL_1);
    expect(explicit).toBe(defaulted);
  });
});

describe("encodeAaveWithdraw — Fixture H calldata cross-link", () => {
  it("encodes withdraw(USDC, 100e6, anvil#1) byte-identical to Fixture H data", () => {
    const data = encodeAaveWithdraw(USDC, USDC_100, ANVIL_1);
    expect(data.toLowerCase()).toBe(FIXTURE_H_DATA);
    // 100 bytes = 4-byte selector + 3 × 32-byte args = 0x + 200 hex = 202 chars.
    expect(data.length).toBe(202);
    expect(data.slice(0, 10)).toBe(AAVE_V3_SELECTORS.withdraw);
  });
});

describe("decodeAaveV3Call — discriminated union exhaustiveness", () => {
  it("decodes supply data → { kind: 'aave-supply', asset, amount, onBehalfOf, referralCode }", () => {
    const data = encodeAaveSupply(USDC, USDC_100, ANVIL_1, 0);
    const result = decodeAaveV3Call(data);
    expect(result.kind).toBe("aave-supply");
    if (result.kind === "aave-supply") {
      expect(result.asset.toLowerCase()).toBe(USDC.toLowerCase());
      expect(result.amount).toBe(USDC_100);
      expect(result.onBehalfOf.toLowerCase()).toBe(ANVIL_1.toLowerCase());
      expect(result.referralCode).toBe(0);
    }
  });

  it("decodes withdraw data (concrete amount) → { kind: 'aave-withdraw', isMax: false }", () => {
    const data = encodeAaveWithdraw(USDC, USDC_100, ANVIL_1);
    const result = decodeAaveV3Call(data);
    expect(result.kind).toBe("aave-withdraw");
    if (result.kind === "aave-withdraw") {
      expect(result.asset.toLowerCase()).toBe(USDC.toLowerCase());
      expect(result.amount).toBe(USDC_100);
      expect(result.to.toLowerCase()).toBe(ANVIL_1.toLowerCase());
      expect(result.isMax).toBe(false);
    }
  });

  it("decodes withdraw(MAX_UINT256) → { kind: 'aave-withdraw', isMax: true }", () => {
    const data = encodeAaveWithdraw(USDC, MAX_UINT256, ANVIL_1);
    const result = decodeAaveV3Call(data);
    expect(result.kind).toBe("aave-withdraw");
    if (result.kind === "aave-withdraw") {
      expect(result.amount).toBe(MAX_UINT256);
      expect(result.isMax).toBe(true);
    }
  });

  it("ERC-20 transfer selector → { kind: 'unknown' } (no false positive)", () => {
    // 0xa9059cbb is ERC-20 transfer(address,uint256). Pad with zero data so
    // length >= 10 (the short-data fallback path).
    const transferData =
      "0xa9059cbb00000000000000000000000070997970c51812dc3a010c7d01b50e0d17dc79c80000000000000000000000000000000000000000000000000000000005f5e100" as Hex;
    const result = decodeAaveV3Call(transferData);
    expect(result.kind).toBe("unknown");
    if (result.kind === "unknown") {
      expect(result.selector).toBe("0xa9059cbb");
    }
  });

  it("empty data ('0x') → { kind: 'unknown' }", () => {
    const result = decodeAaveV3Call("0x" as Hex);
    expect(result.kind).toBe("unknown");
  });

  it("truncated calldata for supply selector → { kind: 'unknown' } (try/catch fall-through)", () => {
    // Selector bytes only — decodeFunctionData throws AbiDecodingDataSizeTooSmallError;
    // the try/catch catches and falls through to unknown.
    const truncated = (AAVE_V3_SELECTORS.supply + "00") as Hex;
    const result = decodeAaveV3Call(truncated);
    expect(result.kind).toBe("unknown");
  });
});

describe("_aaveProtocols indirection (ESM spy-affordance smoke test)", () => {
  it("_aaveProtocols.decodeAaveV3Call(data) === decodeAaveV3Call(data)", () => {
    const data = encodeAaveSupply(USDC, USDC_100, ANVIL_1, 0);
    const direct = decodeAaveV3Call(data);
    const indirected = _aaveProtocols.decodeAaveV3Call(data);
    expect(indirected).toEqual(direct);
  });
});

describe("AAVE_V3_POOL_ABI shape — parseAbi round-trip", () => {
  it("ABI fragment has supply + withdraw function entries", () => {
    const fnNames = AAVE_V3_POOL_ABI
      .filter((item) => item.type === "function")
      .map((item) => (item as { name: string }).name);
    expect(fnNames).toContain("supply");
    expect(fnNames).toContain("withdraw");
  });
});
