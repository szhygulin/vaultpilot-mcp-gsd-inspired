import { describe, expect, it } from "vitest";
import type { Hex } from "viem";

import { buildMockSession, createMockSignClient } from "./mock-sign-client.js";

describe("MockSignClient — regression: Phase 3 _simulateApproval still works", () => {
  it("resolves the connect-approval Promise with the supplied session", async () => {
    const mock = createMockSignClient();
    const session = buildMockSession({ chainId: 1 });

    // Phase 3 production code path: call connect() to allocate the deferred,
    // then await its approval() Promise. Drive resolution via _simulateApproval.
    const connectResult = await mock.client.connect({});
    const approvalPromise = connectResult.approval();

    mock._simulateApproval(session);

    const resolved = await approvalPromise;
    expect(resolved.topic).toBe(session.topic);
  });
});

describe("MockSignClient — Plan 04-01 extension: _setRequestResponse / _setRequestRejection", () => {
  it("_setRequestResponse('eth_sendTransaction', hash) → signClient.request resolves to hash", async () => {
    const mock = createMockSignClient();
    const expectedHash: Hex = "0xdeadbeef00000000000000000000000000000000000000000000000000000000";
    mock._setRequestResponse("eth_sendTransaction", expectedHash);

    const result = await mock.client.request({
      topic: "test-topic",
      chainId: "eip155:1",
      request: {
        method: "eth_sendTransaction",
        params: [{ from: "0xabc", to: "0xdef", value: "0x0" }],
      },
    });

    expect(result).toBe(expectedHash);
    expect(mock.__requestSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        topic: "test-topic",
        chainId: "eip155:1",
        request: expect.objectContaining({ method: "eth_sendTransaction" }),
      }),
    );
  });

  it("_setRequestRejection wins over _setRequestResponse for the same method", async () => {
    const mock = createMockSignClient();
    mock._setRequestResponse("eth_sendTransaction", "0xdead");
    mock._setRequestRejection("eth_sendTransaction", { code: 5000, message: "User rejected" });

    await expect(
      mock.client.request({
        topic: "t",
        chainId: "eip155:1",
        request: { method: "eth_sendTransaction", params: [{}] },
      }),
    ).rejects.toMatchObject({ code: 5000, message: "User rejected" });
  });

  it("request with no scripted method rejects loudly", async () => {
    const mock = createMockSignClient();
    await expect(
      mock.client.request({
        topic: "t",
        chainId: "eip155:1",
        request: { method: "personal_sign", params: ["0x", "0xabc"] },
      }),
    ).rejects.toThrow(/no scripted response for method personal_sign/);
  });
});
