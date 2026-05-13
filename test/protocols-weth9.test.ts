// Pure encode + selector + decimals + cross-link tests for src/protocols/weth9.ts.
//
// Phase 6 — Plan 06-04. Anchors:
//   - WETH9_SELECTORS.withdraw === 0x2e1a7d4d (universal — drift here breaks
//     every WETH unwrap flow).
//   - WETH9_DECIMALS === 18 (the canonical contract is immutable on mainnet;
//     T-WETH-DECIMALS-DRIFT-1 mitigation).
//   - encodeWethWithdraw(1e18) round-trips Fixture F's data byte-identically
//     (cross-link to test/signing-fingerprint.test.ts).
//   - decodeErc20Call (Plan 06-02 — combined ABI) recognizes the withdraw
//     calldata; cross-tool consistency anchor.
//   - getWethContractAddress(1) returns the canonical WETH9 address from
//     src/config/contracts.ts SOT byte-identically.

import { describe, expect, it } from "vitest";
import type { Hex } from "viem";

import { decodeErc20Call } from "../src/protocols/erc20.js";
import {
  WETH9_DECIMALS,
  WETH9_SELECTORS,
  encodeWethWithdraw,
  getWethContractAddress,
} from "../src/protocols/weth9.js";

describe("WETH9_SELECTORS — universal selector regression anchor", () => {
  it("withdraw === 0x2e1a7d4d byte-identical", () => {
    expect(WETH9_SELECTORS.withdraw).toBe("0x2e1a7d4d");
  });
});

describe("WETH9_DECIMALS — T-WETH-DECIMALS-DRIFT-1 mitigation", () => {
  it("equals 18 byte-identically (canonical contract is immutable on mainnet)", () => {
    expect(WETH9_DECIMALS).toBe(18);
  });
});

describe("encodeWethWithdraw — viem-canonical 36-byte calldata (Fixture F cross-link)", () => {
  it("encodes withdraw(1e18) matching Fixture F's data field byte-identically", () => {
    const data = encodeWethWithdraw(1_000_000_000_000_000_000n);
    // Fixture F calldata: 0x + 8-hex selector + 64-hex amount (1e18).
    // viem encodes lowercase; compare lowercased.
    const fixtureFData =
      "0x2e1a7d4d0000000000000000000000000000000000000000000000000de0b6b3a7640000";
    expect(data.toLowerCase()).toBe(fixtureFData);
    // 36 bytes = 4-byte selector + 32-byte amount = 74 chars including 0x.
    expect(data.length).toBe(74);
    // Selector prefix matches.
    expect(data.slice(0, 10)).toBe(WETH9_SELECTORS.withdraw);
  });

  it("encodes withdraw(0n) starts with the withdraw selector + 64 zero hex", () => {
    const data = encodeWethWithdraw(0n);
    expect(data).toBe(
      "0x2e1a7d4d0000000000000000000000000000000000000000000000000000000000000000",
    );
  });
});

describe("decodeErc20Call (combined ABI) — withdraw cross-tool consistency", () => {
  it("decodes Fixture F's data to { kind: 'withdraw', amount: 1e18 }", () => {
    const fixtureFData =
      "0x2e1a7d4d0000000000000000000000000000000000000000000000000de0b6b3a7640000" as Hex;
    const result = decodeErc20Call(fixtureFData);
    expect(result.kind).toBe("withdraw");
    if (result.kind === "withdraw") {
      expect(result.amount).toBe(1_000_000_000_000_000_000n);
    }
  });
});

describe("getWethContractAddress — SOT delegation", () => {
  it("returns the canonical WETH9 address byte-identically (cross-import to src/config/contracts.ts)", () => {
    const addr = getWethContractAddress(1);
    // EIP-55 checksum form per src/config/contracts.ts:40.
    expect(addr).toBe("0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2");
  });
});
