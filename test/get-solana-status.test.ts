// Plan 11-04 — get_solana_status tool tests (SOL-02).
//
// Three behaviors covered:
//   1. `paired: false` when the store has no Solana record.
//   2. `paired: true` envelope with address + derivationPath + rpcEndpoint
//      + pairedAt when the store has a Solana record.
//   3. `staleAccountWarning: true` per-record when pairedAt > 30 days old.
//
// `rpcEndpoint` is sourced from `_solanaRegistry.getResolvedRpcUrl()` —
// this includes the public-RPC fallback URL when SOLANA_RPC_URL is
// unset, so the test pins SOLANA_RPC_URL explicitly to assert against
// a deterministic URL.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { _solanaRegistry, _resetSolanaRegistryForTesting } from "../src/chains/solana/registry.js";

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

await import("../src/tools/get_solana_status.js");

async function callTool(args: Record<string, unknown> = {}): Promise<ToolHandlerResult> {
  const tool = getRegisteredTool("get_solana_status");
  if (!tool) throw new Error("get_solana_status not registered");
  return tool.handler(args);
}

const FIXTURE_BASE58 = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
const SOLANA_RPC_KEY = "SOLANA_RPC_URL";
let savedRpc: string | undefined;

beforeEach(() => {
  listAccountsSpy.mockReset();
  savedRpc = process.env[SOLANA_RPC_KEY];
  // Pin to a recognizable test URL so the rpcEndpoint assertion is
  // deterministic across hosts.
  process.env[SOLANA_RPC_KEY] = "https://solana-test.example.com/v1";
  _resetSolanaRegistryForTesting();
});

afterEach(() => {
  if (savedRpc === undefined) delete process.env[SOLANA_RPC_KEY];
  else process.env[SOLANA_RPC_KEY] = savedRpc;
  _resetSolanaRegistryForTesting();
});

describe("get_solana_status — unpaired branch", () => {
  it("Test 1 — paired: false when no Solana records in the store", async () => {
    listAccountsSpy.mockReturnValue([]);

    const result = await callTool({});

    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toEqual({ paired: false });
    expect(result.content[0]?.text ?? "").toMatch(/paired:\s+false/);
    expect(listAccountsSpy).toHaveBeenCalledWith({ chainFilter: "solana" });
  });
});

describe("get_solana_status — paired branch (SOL-02)", () => {
  it("Test 2 — paired envelope surfaces address, derivationPath, rpcEndpoint, pairedAt", async () => {
    const pairedAt = "2026-05-15T10:00:00.000Z"; // recent
    listAccountsSpy.mockReturnValue([
      {
        chain: "solana",
        address: FIXTURE_BASE58,
        derivationPath: "44'/501'/0'",
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
    expect(sc.derivationPath).toBe("44'/501'/0'");
    expect(sc.rpcEndpoint).toBe("https://solana-test.example.com/v1");
    expect(sc.pairedAt).toBe(pairedAt);

    const text = result.content[0]?.text ?? "";
    expect(text).toMatch(/paired:\s+true/);
    expect(text).toContain(FIXTURE_BASE58);
    expect(text).toContain("44'/501'/0'");
    expect(text).toContain("https://solana-test.example.com/v1");
  });

  it("Test 3 — rpcEndpoint reflects _solanaRegistry.getResolvedRpcUrl() (public fallback when env unset)", async () => {
    delete process.env[SOLANA_RPC_KEY];
    _resetSolanaRegistryForTesting();
    listAccountsSpy.mockReturnValue([
      {
        chain: "solana",
        address: FIXTURE_BASE58,
        derivationPath: "44'/501'/0'",
        pairedAt: "2026-05-15T10:00:00.000Z",
      },
    ]);

    const result = await callTool({});

    const sc = result.structuredContent as { rpcEndpoint: string };
    // Fallback URL hardcoded in chains/solana/registry.ts.
    expect(sc.rpcEndpoint).toBe(_solanaRegistry.getResolvedRpcUrl());
    expect(sc.rpcEndpoint).toBe("https://api.mainnet-beta.solana.com");
  });
});

describe("get_solana_status — staleAccountWarning (30-day branch)", () => {
  it("Test 4 — staleAccountWarning: true when the store record carries the flag", async () => {
    // The non-evm-account-store sets staleAccountWarning=true on read for
    // records > 30 days old; here we mock that branch directly so the
    // test is independent of `Date.now()` shimming.
    listAccountsSpy.mockReturnValue([
      {
        chain: "solana",
        address: FIXTURE_BASE58,
        derivationPath: "44'/501'/0'",
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
