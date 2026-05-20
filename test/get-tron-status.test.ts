// Phase 17 Plan 17-03 — get_tron_status tool tests (TRON-PAIR-02).
//
// Three behaviors covered:
//   1. `paired: false` when the store has no TRON record.
//   2. `paired: true` envelope with address + derivationPath + rpcEndpoint
//      + pairedAt when the store has a TRON record.
//   3. `staleAccountWarning: true` per-record when pairedAt > 30 days old.
//
// `rpcEndpoint` is sourced from `_tronRegistry.getResolvedRpcUrl()` — this
// includes the public-RPC fallback URL when TRON_RPC_URL is unset, so the
// test pins TRON_RPC_URL explicitly to assert against a deterministic URL.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  _tronRegistry,
  _resetTronRegistryForTesting,
} from "../src/chains/tron/registry.js";

const listAccountsSpy = vi.fn();

vi.mock("../src/wallet/non-evm-account-store.js", async () => {
  const actual = await vi.importActual<
    typeof import("../src/wallet/non-evm-account-store.js")
  >("../src/wallet/non-evm-account-store.js");
  return {
    ...actual,
    listAccounts: (
      ...args: Parameters<typeof actual.listAccounts>
    ) => listAccountsSpy(...args),
  };
});

import {
  getRegisteredTool,
  type ToolHandlerResult,
} from "../src/tools/index.js";

await import("../src/tools/get_tron_status.js");

async function callTool(
  args: Record<string, unknown> = {},
): Promise<ToolHandlerResult> {
  const tool = getRegisteredTool("get_tron_status");
  if (!tool) throw new Error("get_tron_status not registered");
  return tool.handler(args);
}

const FIXTURE_BASE58 = "TWd4WrZ9wn84f5x1hZhL4DHvk738ns5jwb";
const TRON_RPC_KEY = "TRON_RPC_URL";
let savedRpc: string | undefined;

beforeEach(() => {
  listAccountsSpy.mockReset();
  savedRpc = process.env[TRON_RPC_KEY];
  // Pin to a recognizable test URL so the rpcEndpoint assertion is
  // deterministic across hosts.
  process.env[TRON_RPC_KEY] = "https://tron-test.example.com/v1";
  _resetTronRegistryForTesting();
});

afterEach(() => {
  if (savedRpc === undefined) delete process.env[TRON_RPC_KEY];
  else process.env[TRON_RPC_KEY] = savedRpc;
  _resetTronRegistryForTesting();
});

describe("get_tron_status — unpaired branch", () => {
  it("Test 1 — paired: false when no TRON records in the store", async () => {
    listAccountsSpy.mockReturnValue([]);

    const result = await callTool({});

    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toEqual({ paired: false });
    expect(result.content[0]?.text ?? "").toMatch(/paired:\s+false/);
    expect(listAccountsSpy).toHaveBeenCalledWith({ chainFilter: "tron" });
  });
});

describe("get_tron_status — paired branch (TRON-PAIR-02)", () => {
  it("Test 2 — paired envelope surfaces address, derivationPath, rpcEndpoint, pairedAt", async () => {
    const pairedAt = "2026-05-15T10:00:00.000Z"; // recent
    listAccountsSpy.mockReturnValue([
      {
        chain: "tron",
        address: FIXTURE_BASE58,
        derivationPath: "44'/195'/0'/0/0",
        pairedAt,
      },
    ]);

    const result = await callTool({});

    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as {
      paired: boolean;
      address: string;
      derivationPath: string;
      rpcEndpoint: string;
      pairedAt: string;
    };
    expect(sc.paired).toBe(true);
    expect(sc.address).toBe(FIXTURE_BASE58);
    expect(sc.derivationPath).toBe("44'/195'/0'/0/0");
    expect(sc.rpcEndpoint).toBe("https://tron-test.example.com/v1");
    expect(sc.pairedAt).toBe(pairedAt);

    const text = result.content[0]?.text ?? "";
    expect(text).toMatch(/paired:\s+true/);
    expect(text).toContain(FIXTURE_BASE58);
    expect(text).toContain("44'/195'/0'/0/0");
    expect(text).toContain("https://tron-test.example.com/v1");
  });

  it("Test 3 — rpcEndpoint reflects _tronRegistry.getResolvedRpcUrl() (public fallback when env unset)", async () => {
    delete process.env[TRON_RPC_KEY];
    _resetTronRegistryForTesting();
    listAccountsSpy.mockReturnValue([
      {
        chain: "tron",
        address: FIXTURE_BASE58,
        derivationPath: "44'/195'/0'/0/0",
        pairedAt: "2026-05-15T10:00:00.000Z",
      },
    ]);

    const result = await callTool({});

    const sc = result.structuredContent as { rpcEndpoint: string };
    // Fallback URL hardcoded in chains/tron/registry.ts.
    expect(sc.rpcEndpoint).toBe(_tronRegistry.getResolvedRpcUrl());
    expect(sc.rpcEndpoint).toBe("https://api.trongrid.io");
  });
});

describe("get_tron_status — staleAccountWarning (30-day branch)", () => {
  it("Test 4 — staleAccountWarning: true when the store record carries the flag", async () => {
    listAccountsSpy.mockReturnValue([
      {
        chain: "tron",
        address: FIXTURE_BASE58,
        derivationPath: "44'/195'/0'/0/0",
        pairedAt: "2025-01-01T00:00:00.000Z",
        staleAccountWarning: true,
      },
    ]);

    const result = await callTool({});
    const sc = result.structuredContent as {
      staleAccountWarning?: true;
    };
    expect(sc.staleAccountWarning).toBe(true);
    const text = result.content[0]?.text ?? "";
    expect(text).toMatch(/staleAccountWarning:\s+true/);
    expect(text).toMatch(/re-pair/i);
  });
});

describe("get_tron_status — defensive fall-through (never errors)", () => {
  it("Test 5 — when listAccounts throws, surfaces paired:false rather than propagating the error", async () => {
    listAccountsSpy.mockImplementationOnce(() => {
      throw new Error("store unavailable");
    });

    const result = await callTool({});

    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toEqual({ paired: false });
  });
});
