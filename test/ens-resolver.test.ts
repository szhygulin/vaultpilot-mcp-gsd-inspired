import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/chains/ethereum.js", () => {
  const client = {
    getEnsAddress: vi.fn(),
    getEnsName: vi.fn(),
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
// Importing register-all triggers the side-effect registrations under the mock.
import "../src/tools/register-all.js";

const ethereumMockModule = (await import("../src/chains/ethereum.js")) as unknown as {
  __client: {
    getEnsAddress: ReturnType<typeof vi.fn>;
    getEnsName: ReturnType<typeof vi.fn>;
  };
};
const stubClient = ethereumMockModule.__client;

beforeEach(() => {
  stubClient.getEnsAddress.mockReset();
  stubClient.getEnsName.mockReset();
});

afterEach(() => {
  // Tools register at import time; reset isn't strictly needed between tests
  // because each test invokes the same tool, but kept for hygiene.
  void _resetRegistryForTesting;
});

async function callTool(name: string, args: Record<string, unknown>): Promise<ToolHandlerResult> {
  const tool = getRegisteredTool(name);
  if (!tool) throw new Error(`tool not registered: ${name}`);
  return tool.handler(args);
}

describe("resolve_ens_name tool", () => {
  it("returns the resolved address when viem returns one", async () => {
    stubClient.getEnsAddress.mockResolvedValueOnce("0xd8da6bf26964af9d7eed9e03e53415d37aa96045");
    const result = await callTool("resolve_ens_name", { name: "vitalik.eth" });

    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toEqual({
      address: "0xd8da6bf26964af9d7eed9e03e53415d37aa96045",
    });
    expect(stubClient.getEnsAddress).toHaveBeenCalledWith({ name: "vitalik.eth" });
    expect(result.content[0]?.text).toMatch(/vitalik\.eth/);
  });

  it("returns null when the name does not resolve", async () => {
    stubClient.getEnsAddress.mockResolvedValueOnce(null);
    const result = await callTool("resolve_ens_name", { name: "definitely-not-registered.eth" });

    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toEqual({ address: null });
    expect(result.content[0]?.text).toMatch(/does not resolve/);
  });

  it("returns isError when viem throws", async () => {
    stubClient.getEnsAddress.mockRejectedValueOnce(new Error("RPC down"));
    const result = await callTool("resolve_ens_name", { name: "vitalik.eth" });

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toMatch(/RPC down/);
  });

  it("rejects empty/non-string input", async () => {
    const result = await callTool("resolve_ens_name", { name: "" });
    expect(result.isError).toBe(true);
    expect(stubClient.getEnsAddress).not.toHaveBeenCalled();
  });
});

describe("reverse_resolve_ens tool", () => {
  const ADDR = "0xd8da6bf26964af9d7eed9e03e53415d37aa96045";
  const ADDR_CHECKSUMMED = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";

  it("returns the primary ENS name when viem returns one", async () => {
    stubClient.getEnsName.mockResolvedValueOnce("vitalik.eth");
    const result = await callTool("reverse_resolve_ens", { address: ADDR });

    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toEqual({ name: "vitalik.eth" });
    expect(stubClient.getEnsName).toHaveBeenCalledWith({ address: ADDR_CHECKSUMMED });
  });

  it("returns null when no primary name is set", async () => {
    stubClient.getEnsName.mockResolvedValueOnce(null);
    const result = await callTool("reverse_resolve_ens", { address: ADDR });

    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toEqual({ name: null });
    expect(result.content[0]?.text).toMatch(/no primary ENS name/);
  });

  it("rejects malformed addresses", async () => {
    const result = await callTool("reverse_resolve_ens", { address: "not-an-address" });
    expect(result.isError).toBe(true);
    expect(stubClient.getEnsName).not.toHaveBeenCalled();
  });
});
