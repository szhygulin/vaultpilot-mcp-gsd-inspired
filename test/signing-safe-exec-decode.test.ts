// SHARED decoder unit tests for src/signing/safe-exec-decode.ts.
//
// Phase 37 Plan 37-03 (SAFE-08). Consumed by `prepare_safe_tx_execute.ts`
// (CHECKS PERFORMED composite preview) AND `preview_send.ts` (composite-tx
// decode arm). Single source of truth — Plan 33-03 `src/signing/uniswap-*`
// SHARED-decoder discipline (Pitfall 7 / CLAUDE.md ESM bindings).
//
// Anchors:
//   - EXEC_TRANSACTION_SELECTOR === "0x6a761202" (canonical Safe selector)
//   - Round-trip: encodeFunctionData → decodeSingleSafeExecTransaction
//   - operation narrowing — 0|1 accepted, 2+ rejected.

import { encodeFunctionData, type Address, type Hex } from "viem";
import { describe, expect, it } from "vitest";

import {
  EXEC_TRANSACTION_SELECTOR,
  decodeSingleSafeExecTransaction,
  execTransactionAbi,
} from "../src/signing/safe-exec-decode.js";

// Canonical fixture inputs for the SAFE execTransaction shape — mirror of
// Fixture SAFE-A's encapsulated quartet (Plan 37-01 fixture).
const FIXTURE_TO: Address = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
const FIXTURE_VALUE = 1_000_000_000_000_000_000n; // 1 ETH
const FIXTURE_DATA: Hex = "0x";
const FIXTURE_OPERATION = 0 as const;
const FIXTURE_SIGS: Hex =
  "0x" + "ab".repeat(65); // 65-byte signature blob (synthetic — decoder is shape-only)
const ZERO_ADDR: Address = "0x0000000000000000000000000000000000000000";

describe("safe-exec-decode — EXEC_TRANSACTION_SELECTOR constant", () => {
  it("equals 0x6a761202 (canonical Safe execTransaction selector)", () => {
    expect(EXEC_TRANSACTION_SELECTOR).toBe("0x6a761202");
  });

  it("matches the selector of a freshly-encoded execTransaction call", () => {
    const encoded = encodeFunctionData({
      abi: execTransactionAbi,
      functionName: "execTransaction",
      args: [
        FIXTURE_TO,
        FIXTURE_VALUE,
        FIXTURE_DATA,
        FIXTURE_OPERATION,
        0n,
        0n,
        0n,
        ZERO_ADDR,
        ZERO_ADDR,
        FIXTURE_SIGS,
      ],
    });
    expect(encoded.slice(0, 10)).toBe(EXEC_TRANSACTION_SELECTOR);
  });
});

describe("decodeSingleSafeExecTransaction — round-trip", () => {
  it("decodes a freshly-encoded execTransaction call back to its inputs (call)", () => {
    const encoded = encodeFunctionData({
      abi: execTransactionAbi,
      functionName: "execTransaction",
      args: [
        FIXTURE_TO,
        FIXTURE_VALUE,
        FIXTURE_DATA,
        FIXTURE_OPERATION,
        0n,
        0n,
        0n,
        ZERO_ADDR,
        ZERO_ADDR,
        FIXTURE_SIGS,
      ],
    });
    const decoded = decodeSingleSafeExecTransaction(encoded);
    expect(decoded.to.toLowerCase()).toBe(FIXTURE_TO.toLowerCase());
    expect(decoded.value).toBe(FIXTURE_VALUE);
    expect(decoded.data).toBe(FIXTURE_DATA);
    expect(decoded.operation).toBe(0);
    expect(decoded.safeTxGas).toBe(0n);
    expect(decoded.baseGas).toBe(0n);
    expect(decoded.gasPrice).toBe(0n);
    expect(decoded.gasToken.toLowerCase()).toBe(ZERO_ADDR);
    expect(decoded.refundReceiver.toLowerCase()).toBe(ZERO_ADDR);
    expect(decoded.signatures).toBe(FIXTURE_SIGS);
  });

  it("decodes delegatecall operation as 1", () => {
    const encoded = encodeFunctionData({
      abi: execTransactionAbi,
      functionName: "execTransaction",
      args: [
        FIXTURE_TO,
        0n,
        "0xdeadbeef" as Hex,
        1,
        0n,
        0n,
        0n,
        ZERO_ADDR,
        ZERO_ADDR,
        FIXTURE_SIGS,
      ],
    });
    const decoded = decodeSingleSafeExecTransaction(encoded);
    expect(decoded.operation).toBe(1);
    expect(decoded.data).toBe("0xdeadbeef");
  });

  it("preserves non-empty inner calldata bytes byte-identical", () => {
    // Canonical ERC-20 transfer(to, amount) calldata.
    const innerData: Hex =
      "0xa9059cbb00000000000000000000000070997970c51812dc3a010c7d01b50e0d17dc79c80000000000000000000000000000000000000000000000000000000005f5e100";
    const encoded = encodeFunctionData({
      abi: execTransactionAbi,
      functionName: "execTransaction",
      args: [
        FIXTURE_TO,
        0n,
        innerData,
        0,
        0n,
        0n,
        0n,
        ZERO_ADDR,
        ZERO_ADDR,
        FIXTURE_SIGS,
      ],
    });
    const decoded = decodeSingleSafeExecTransaction(encoded);
    expect(decoded.data).toBe(innerData);
  });

  it("rejects invalid operation values (>=2)", () => {
    // Use raw encoded calldata with operation = 2 (not narrowable).
    // viem encoding accepts uint8 = 2 but the decoder narrows to 0 | 1; values
    // outside that set throw INVALID_OPERATION.
    const encoded = encodeFunctionData({
      abi: execTransactionAbi,
      functionName: "execTransaction",
      args: [
        FIXTURE_TO,
        0n,
        FIXTURE_DATA,
        2,
        0n,
        0n,
        0n,
        ZERO_ADDR,
        ZERO_ADDR,
        FIXTURE_SIGS,
      ],
    });
    expect(() => decodeSingleSafeExecTransaction(encoded)).toThrow(
      /operation/i,
    );
  });
});
