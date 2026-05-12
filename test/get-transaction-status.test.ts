import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TransactionNotFoundError, TransactionReceiptNotFoundError } from "viem";

vi.mock("../src/chains/ethereum.js", () => {
  const client = {
    getTransactionReceipt: vi.fn(),
    getTransaction: vi.fn(),
  };
  return {
    getEthereumClient: () => client,
    isPublicNodeFallback: () => false,
    __client: client,
  };
});

import {
  _resetRegistryForTesting,
  getRegisteredTool,
  type ToolHandlerResult,
} from "../src/tools/index.js";
import "../src/tools/register-all.js";

const mod = (await import("../src/chains/ethereum.js")) as unknown as {
  __client: {
    getTransactionReceipt: ReturnType<typeof vi.fn>;
    getTransaction: ReturnType<typeof vi.fn>;
  };
};
const stubClient = mod.__client;

const HASH = "0x" + "ab".repeat(32);

beforeEach(() => {
  stubClient.getTransactionReceipt.mockReset();
  stubClient.getTransaction.mockReset();
});

afterEach(() => {
  void _resetRegistryForTesting;
});

async function callTool(args: Record<string, unknown>): Promise<ToolHandlerResult> {
  const tool = getRegisteredTool("get_transaction_status");
  if (!tool) throw new Error("get_transaction_status not registered");
  return tool.handler(args);
}

describe("get_transaction_status tool", () => {
  it("returns success + blockNumber + gasUsed when receipt is success", async () => {
    stubClient.getTransactionReceipt.mockResolvedValueOnce({
      status: "success",
      blockNumber: 19_000_000n,
      gasUsed: 21_000n,
    });

    const result = await callTool({ txHash: HASH });

    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toEqual({
      status: "success",
      blockNumber: "19000000",
      gasUsed: "21000",
    });
    expect(stubClient.getTransaction).not.toHaveBeenCalled();
  });

  it("returns reverted when receipt status is reverted", async () => {
    stubClient.getTransactionReceipt.mockResolvedValueOnce({
      status: "reverted",
      blockNumber: 19_000_001n,
      gasUsed: 100_000n,
    });

    const result = await callTool({ txHash: HASH });

    expect(result.isError).toBeUndefined();
    expect((result.structuredContent as { status: string }).status).toBe("reverted");
  });

  it("returns pending when receipt is missing but tx is in mempool", async () => {
    stubClient.getTransactionReceipt.mockRejectedValueOnce(
      new TransactionReceiptNotFoundError({ hash: HASH }),
    );
    stubClient.getTransaction.mockResolvedValueOnce({ hash: HASH });

    const result = await callTool({ txHash: HASH });

    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toEqual({ status: "pending" });
    expect(result.content[0]?.text).toMatch(/pending/);
  });

  it("returns isError when neither receipt nor tx exist (unknown hash)", async () => {
    stubClient.getTransactionReceipt.mockRejectedValueOnce(
      new TransactionReceiptNotFoundError({ hash: HASH }),
    );
    stubClient.getTransaction.mockRejectedValueOnce(
      new TransactionNotFoundError({ hash: HASH }),
    );

    const result = await callTool({ txHash: HASH });

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toMatch(/not found/);
  });

  it("returns isError on unexpected receipt errors", async () => {
    stubClient.getTransactionReceipt.mockRejectedValueOnce(new Error("RPC unreachable"));

    const result = await callTool({ txHash: HASH });

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toMatch(/RPC unreachable/);
    expect(stubClient.getTransaction).not.toHaveBeenCalled();
  });

  it("rejects malformed txHash", async () => {
    const result = await callTool({ txHash: "0xnope" });
    expect(result.isError).toBe(true);
    expect(stubClient.getTransactionReceipt).not.toHaveBeenCalled();
  });
});
