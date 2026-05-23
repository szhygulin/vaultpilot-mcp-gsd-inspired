// test/protocols-eigenlayer.test.ts — ABI selector byte-identity regression +
// encoder round-trip tests for src/protocols/eigenlayer.ts (Phase 31 Plan 31-02).
//
// Structural mirror of test/protocols-lido.test.ts (Phase 30 analog).
//
// Two test batteries:
//   1. EIGENLAYER_SELECTORS byte-identity — 5 hardcoded selectors pinned to
//      31-RESEARCH § Topic 1 `viem.toFunctionSelector` verified values
//      (2026-05-23). Any drift breaks the payloadFingerprint chain (Fixture Z
//      in test/signing-fingerprint.test.ts fails too).
//   2. encodeDepositIntoStrategy round-trip — 100-byte calldata + 0xe7a050aa
//      selector prefix + viem.decodeFunctionData inverse.
//
// T-EIGENLAYER-SPENDER-DRIFT-1 cross-view byte-identity: the SOT-address
// cross-check between KNOWN_SPENDERS_ETHEREUM rows and the
// getEigenLayer*Address(1) getters lives in test/config-contracts.test.ts
// (Plan 31-01 block added there).

import { describe, expect, it } from "vitest";
import {
  toFunctionSelector,
  decodeFunctionData,
  type Address,
} from "viem";

import {
  EIGENLAYER_SELECTORS,
  STRATEGY_MANAGER_ABI,
  STRATEGY_BASE_ABI,
  DELEGATION_MANAGER_ABI,
  encodeDepositIntoStrategy,
  getEigenLayerStrategyAddress,
  getEigenLayerLstTokenAddress,
} from "../src/protocols/eigenlayer.js";

// ---------------------------------------------------------------------------
// EIGENLAYER_SELECTORS — 5-selector byte-identity regression anchor (D-07)
// ---------------------------------------------------------------------------

describe("EIGENLAYER_SELECTORS — 5-selector byte-identity regression anchor (Phase 31 Plan 31-02)", () => {
  it("depositIntoStrategy === 0xe7a050aa byte-identical to viem.toFunctionSelector(\"depositIntoStrategy(address,address,uint256)\")", () => {
    expect(EIGENLAYER_SELECTORS.depositIntoStrategy).toBe("0xe7a050aa");
    // Cross-check against viem — drift here OR in the constant both fail.
    expect(toFunctionSelector("depositIntoStrategy(address,address,uint256)")).toBe("0xe7a050aa");
  });

  it("stakerStrategyShares === 0x7a7e0d92 byte-identical to viem.toFunctionSelector(...)", () => {
    expect(EIGENLAYER_SELECTORS.stakerStrategyShares).toBe("0x7a7e0d92");
    expect(toFunctionSelector("stakerStrategyShares(address,address)")).toBe("0x7a7e0d92");
  });

  it("sharesToUnderlyingView === 0x7a8b2637 byte-identical to viem.toFunctionSelector(\"sharesToUnderlyingView(uint256)\")", () => {
    expect(EIGENLAYER_SELECTORS.sharesToUnderlyingView).toBe("0x7a8b2637");
    expect(toFunctionSelector("sharesToUnderlyingView(uint256)")).toBe("0x7a8b2637");
  });

  it("userUnderlyingView === 0x553ca5f8 byte-identical to viem.toFunctionSelector(\"userUnderlyingView(address)\")", () => {
    expect(EIGENLAYER_SELECTORS.userUnderlyingView).toBe("0x553ca5f8");
    expect(toFunctionSelector("userUnderlyingView(address)")).toBe("0x553ca5f8");
  });

  it("getQueuedWithdrawals === 0x5dd68579 byte-identical to viem.toFunctionSelector(\"getQueuedWithdrawals(address)\")", () => {
    expect(EIGENLAYER_SELECTORS.getQueuedWithdrawals).toBe("0x5dd68579");
    expect(toFunctionSelector("getQueuedWithdrawals(address)")).toBe("0x5dd68579");
  });
});

// ---------------------------------------------------------------------------
// ABI fragments — surface assertions (parseAbi typecheck guards the shape)
// ---------------------------------------------------------------------------

describe("EigenLayer ABI fragments — surface assertions", () => {
  it("STRATEGY_MANAGER_ABI contains exactly 2 function fragments (depositIntoStrategy + stakerStrategyShares)", () => {
    expect(STRATEGY_MANAGER_ABI.length).toBe(2);
    const names = STRATEGY_MANAGER_ABI.map((f) => f.name).sort();
    expect(names).toEqual(["depositIntoStrategy", "stakerStrategyShares"]);
  });

  it("STRATEGY_BASE_ABI contains 5 function fragments (sharesToUnderlyingView / userUnderlyingView / totalShares / underlyingToken / maxTotalDeposits)", () => {
    expect(STRATEGY_BASE_ABI.length).toBe(5);
    const names = STRATEGY_BASE_ABI.map((f) => f.name).sort();
    expect(names).toEqual([
      "maxTotalDeposits",
      "sharesToUnderlyingView",
      "totalShares",
      "underlyingToken",
      "userUnderlyingView",
    ]);
  });

  it("DELEGATION_MANAGER_ABI contains the Withdrawal struct + getQueuedWithdrawals function", () => {
    // parseAbi expands the struct into a type entry + the function entry.
    const fnNames = DELEGATION_MANAGER_ABI.filter((f) => f.type === "function").map(
      (f) => f.name,
    );
    expect(fnNames).toContain("getQueuedWithdrawals");
  });
});

// ---------------------------------------------------------------------------
// encodeDepositIntoStrategy — calldata shape regression
// ---------------------------------------------------------------------------

describe("encodeDepositIntoStrategy — calldata shape regression (Phase 31 Plan 31-02)", () => {
  const strategy: Address = getEigenLayerStrategyAddress(1, "stETH")!;
  const lstToken: Address = getEigenLayerLstTokenAddress(1, "stETH")!;
  const amountWei = 1_000_000_000_000_000_000n; // 1 stETH

  it("100-byte (202-char) calldata for stETH-strategy + 1e18 amount", () => {
    const data = encodeDepositIntoStrategy(strategy, lstToken, amountWei);
    // 4-byte selector + 3 × 32-byte words = 100 bytes total.
    // "0x" prefix + 200 hex chars = 202 chars.
    expect(data.length).toBe(202);
  });

  it("calldata starts with selector 0xe7a050aa byte-identical", () => {
    const data = encodeDepositIntoStrategy(strategy, lstToken, amountWei);
    expect(data.slice(0, 10).toLowerCase()).toBe("0xe7a050aa");
  });

  it("decodeFunctionData round-trips back to (strategy, lstToken, amountWei) tuple", () => {
    const data = encodeDepositIntoStrategy(strategy, lstToken, amountWei);
    const decoded = decodeFunctionData({
      abi: STRATEGY_MANAGER_ABI,
      data,
    });
    expect(decoded.functionName).toBe("depositIntoStrategy");
    const args = decoded.args as readonly [Address, Address, bigint];
    expect(args[0]).toBe(strategy);
    expect(args[1]).toBe(lstToken);
    expect(args[2]).toBe(amountWei);
  });

  it("different LST (cbETH) produces different calldata payload (strategy + token slots flow into calldata)", () => {
    const cbethStrategy: Address = getEigenLayerStrategyAddress(1, "cbETH")!;
    const cbethToken: Address = getEigenLayerLstTokenAddress(1, "cbETH")!;
    const stethData = encodeDepositIntoStrategy(strategy, lstToken, amountWei);
    const cbethData = encodeDepositIntoStrategy(cbethStrategy, cbethToken, amountWei);
    // Both 100 bytes; selector identical; tail bytes (strategy + token) differ.
    expect(stethData.length).toBe(cbethData.length);
    expect(stethData.slice(0, 10)).toBe(cbethData.slice(0, 10));
    expect(stethData).not.toBe(cbethData);
  });
});
