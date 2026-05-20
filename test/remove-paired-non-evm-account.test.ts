// Plan 11-04 — remove_paired_non_evm_account tool tests (PAIR-NEV-05).
//
// Three behaviors:
//   1. Removes an existing record; structuredContent.removed === true.
//   2. Idempotent — removing a non-existent record returns
//      `{ removed: false }`, no throw.
//   3. Invalid chain (not in solana / tron / bitcoin / litecoin) → schema-
//      level rejection.

import { beforeEach, describe, expect, it, vi } from "vitest";

const removeSpy = vi.fn();

vi.mock("../src/wallet/non-evm-account-store.js", async () => {
  const actual = await vi.importActual<
    typeof import("../src/wallet/non-evm-account-store.js")
  >("../src/wallet/non-evm-account-store.js");
  return {
    ...actual,
    removeAccount: (
      ...args: Parameters<typeof actual.removeAccount>
    ) => removeSpy(...args),
  };
});

import {
  getRegisteredTool,
  type ToolHandlerResult,
} from "../src/tools/index.js";

await import("../src/tools/remove_paired_non_evm_account.js");

async function callTool(args: Record<string, unknown>): Promise<ToolHandlerResult> {
  const tool = getRegisteredTool("remove_paired_non_evm_account");
  if (!tool) throw new Error("remove_paired_non_evm_account not registered");
  return tool.handler(args);
}

const SOLANA_ADDR = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";

beforeEach(() => {
  removeSpy.mockReset();
});

describe("remove_paired_non_evm_account — happy path (PAIR-NEV-05)", () => {
  it("Test 1 — removes an existing record; returns { removed: true }", async () => {
    removeSpy.mockReturnValue({ removed: true });

    const result = await callTool({ chain: "solana", address: SOLANA_ADDR });

    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toEqual({
      removed: true,
      chain: "solana",
      address: SOLANA_ADDR,
    });
    expect(removeSpy).toHaveBeenCalledWith("solana", SOLANA_ADDR);
    expect(result.content[0]?.text ?? "").toMatch(/removed/);
  });
});

describe("remove_paired_non_evm_account — idempotent (PAIR-NEV-05)", () => {
  it("Test 2 — removing a non-existent record returns { removed: false }, no throw", async () => {
    removeSpy.mockReturnValue({ removed: false });

    const result = await callTool({ chain: "solana", address: SOLANA_ADDR });

    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toEqual({
      removed: false,
      chain: "solana",
      address: SOLANA_ADDR,
    });
    expect(result.content[0]?.text ?? "").toMatch(/no-op/);
  });
});

describe("remove_paired_non_evm_account — input validation", () => {
  it("Test 3 — chain enum: solana / tron / bitcoin / litecoin all accepted", async () => {
    removeSpy.mockReturnValue({ removed: true });

    for (const chain of ["solana", "tron", "bitcoin", "litecoin"]) {
      const result = await callTool({ chain, address: "irrelevant" });
      expect(result.isError).toBeFalsy();
    }
    expect(removeSpy).toHaveBeenCalledTimes(4);
  });

  it("Test 4 — invalid chain rejected with INVALID_INPUT (defense-in-depth narrowing)", async () => {
    const result = await callTool({ chain: "ethereum", address: SOLANA_ADDR });

    expect(result.isError).toBe(true);
    expect((result.structuredContent as { errorCode: string }).errorCode).toBe(
      "INVALID_INPUT",
    );
    expect(removeSpy).toHaveBeenCalledTimes(0);
  });

  it("Test 5 — empty address rejected with INVALID_INPUT", async () => {
    const result = await callTool({ chain: "solana", address: "" });

    expect(result.isError).toBe(true);
    expect((result.structuredContent as { errorCode: string }).errorCode).toBe(
      "INVALID_INPUT",
    );
    expect(removeSpy).toHaveBeenCalledTimes(0);
  });
});

describe("remove_paired_non_evm_account — schema shape", () => {
  it("Test 6 — input schema requires { chain, address }", () => {
    const tool = getRegisteredTool("remove_paired_non_evm_account");
    expect(tool).toBeDefined();
    expect(tool!.inputSchema.required).toEqual(["chain", "address"]);
    const props = tool!.inputSchema.properties as {
      chain: { enum: string[] };
      address: { minLength: number };
    };
    expect(props.chain.enum).toEqual(["solana", "tron", "bitcoin", "litecoin"]);
    expect(props.address.minLength).toBe(1);
  });
});
