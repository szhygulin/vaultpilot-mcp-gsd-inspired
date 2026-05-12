import { describe, expect, it } from "vitest";

import { createMockPublicClient } from "./mock-public-client.js";

describe("createMockPublicClient — smoke", () => {
  it("scripts nonce via _setNonce; getTransactionCount spy returns the value", async () => {
    const mock = createMockPublicClient();
    mock._setNonce(42);
    const value = await mock.__spies.getTransactionCount({}, { address: "0x00", blockTag: "pending" });
    expect(value).toBe(42);
    expect(mock.__spies.getTransactionCount).toHaveBeenCalledTimes(1);
  });

  it("scripts fees via _setFees; estimateFeesPerGas spy returns the bigints", async () => {
    const mock = createMockPublicClient();
    mock._setFees({ maxFeePerGas: 30_000_000_000n, maxPriorityFeePerGas: 1_500_000_000n });
    const fees = await mock.__spies.estimateFeesPerGas({}, { type: "eip1559" });
    expect(fees).toEqual({
      maxFeePerGas: 30_000_000_000n,
      maxPriorityFeePerGas: 1_500_000_000n,
    });
  });

  it("scripts gas via _setGasEstimate and call response via _setCallResponse", async () => {
    const mock = createMockPublicClient();
    mock._setGasEstimate(21_000n);
    mock._setCallResponse("0xdeadbeef");

    const gas = await mock.__spies.estimateGas({}, { account: "0x00", to: "0x00", value: 0n });
    expect(gas).toBe(21_000n);

    const callResult = await mock.__spies.call({}, { to: "0x00", data: "0x" });
    expect(callResult).toEqual({ data: "0xdeadbeef" });
  });
});
