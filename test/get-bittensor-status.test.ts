// test/get-bittensor-status.test.ts — Phase 46 Plan 46-02 Task 3
// (TAO-PAIR-02).
//
// Four behaviors covered:
//   1. `paired: false` when the store has no Bittensor record.
//   2. `paired: true` envelope with address + derivationPath + rpcEndpoint
//      + pairedAt when the store has a Bittensor record.
//   3. `staleAccountWarning: true` per-record when pairedAt > 30 days old.
//   4. NEVER-ERRORS + Pitfall 5: rpcEndpoint resolved from the URL string
//      via `_bittensorRegistry.getResolvedRpcUrl()` WITHOUT calling
//      `getApi()` (no live WS connect — status must never hang offline).
//
// `getApi` is spied across ALL tests and asserted NEVER called — proving no
// real WsProvider / ApiPromise socket is constructed at status time.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  _bittensorRegistry,
  _resetBittensorRegistryForTesting,
} from "../src/chains/bittensor/registry.js";

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

await import("../src/tools/get_bittensor_status.js");

async function callTool(
  args: Record<string, unknown> = {},
): Promise<ToolHandlerResult> {
  const tool = getRegisteredTool("get_bittensor_status");
  if (!tool) throw new Error("get_bittensor_status not registered");
  return tool.handler(args);
}

// Fixture SS58 — the RESEARCH-verified "01".repeat(32) → 5C62Ck4U… anchor.
const FIXTURE_SS58 = "5C62Ck4UrFPiBtoCmeSrgF7x9yv9mn38446dhCpsi2mLHiFT";
const BITTENSOR_RPC_KEY = "BITTENSOR_RPC_URL";
let savedRpc: string | undefined;

// getApi spy — installed in every test, asserted NEVER called (Pitfall 5:
// status must resolve the URL string without opening a WS socket).
let getApiSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  listAccountsSpy.mockReset();
  savedRpc = process.env[BITTENSOR_RPC_KEY];
  // Pin to a recognizable test URL so the rpcEndpoint assertion is
  // deterministic across hosts.
  process.env[BITTENSOR_RPC_KEY] = "wss://subtensor-test.example.com:443";
  _resetBittensorRegistryForTesting();
  // Guard rail: if anything calls getApi(), fail loudly rather than open a
  // real socket (the RPC-hang trap). A live ApiPromise.create would block.
  getApiSpy = vi
    .spyOn(_bittensorRegistry, "getApi")
    .mockRejectedValue(new Error("getApi must NOT be called from status"));
});

afterEach(() => {
  if (savedRpc === undefined) delete process.env[BITTENSOR_RPC_KEY];
  else process.env[BITTENSOR_RPC_KEY] = savedRpc;
  _resetBittensorRegistryForTesting();
  vi.restoreAllMocks();
});

describe("get_bittensor_status — unpaired branch (never-errors)", () => {
  it("Test 1 — paired: false when no Bittensor records in the store", async () => {
    listAccountsSpy.mockReturnValue([]);

    const result = await callTool({});

    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toEqual({ paired: false });
    expect(result.content[0]?.text ?? "").toMatch(/paired:\s+false/);
    expect(listAccountsSpy).toHaveBeenCalledWith({ chainFilter: "bittensor" });
    // Pitfall 5: no live connect on the unpaired path either.
    expect(getApiSpy).not.toHaveBeenCalled();
  });
});

describe("get_bittensor_status — paired branch (TAO-PAIR-02)", () => {
  it("Test 2 — paired envelope surfaces address, derivationPath, rpcEndpoint, pairedAt; getApi NEVER called (Pitfall 5)", async () => {
    const pairedAt = "2026-05-25T10:00:00.000Z"; // recent
    listAccountsSpy.mockReturnValue([
      {
        chain: "bittensor",
        address: FIXTURE_SS58,
        derivationPath: "44'/354'/0'/0'/0'",
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
    expect(sc.address).toBe(FIXTURE_SS58);
    expect(sc.derivationPath).toBe("44'/354'/0'/0'/0'");
    expect(sc.rpcEndpoint).toBe("wss://subtensor-test.example.com:443");
    expect(sc.pairedAt).toBe(pairedAt);

    const text = result.content[0]?.text ?? "";
    expect(text).toMatch(/paired:\s+true/);
    expect(text).toContain(FIXTURE_SS58);
    expect(text).toContain("44'/354'/0'/0'/0'");
    expect(text).toContain("wss://subtensor-test.example.com:443");

    // Pitfall 5 — load-bearing: rpcEndpoint came from the URL string, NOT a
    // live WS connect. getApi was never invoked.
    expect(getApiSpy).not.toHaveBeenCalled();
  });

  it("Test 3 — rpcEndpoint reflects the public Finney fallback when env unset (still no live connect)", async () => {
    delete process.env[BITTENSOR_RPC_KEY];
    _resetBittensorRegistryForTesting();
    // Re-install the getApi guard after the registry reset.
    getApiSpy = vi
      .spyOn(_bittensorRegistry, "getApi")
      .mockRejectedValue(new Error("getApi must NOT be called from status"));
    listAccountsSpy.mockReturnValue([
      {
        chain: "bittensor",
        address: FIXTURE_SS58,
        derivationPath: "44'/354'/0'/0'/0'",
        pairedAt: "2026-05-25T10:00:00.000Z",
      },
    ]);

    const result = await callTool({});

    const sc = result.structuredContent as { rpcEndpoint: string };
    // Fallback URL hardcoded in chains/bittensor/registry.ts.
    expect(sc.rpcEndpoint).toBe("wss://entrypoint-finney.opentensor.ai:443");
    expect(getApiSpy).not.toHaveBeenCalled();
  });
});

describe("get_bittensor_status — staleAccountWarning (30-day branch)", () => {
  it("Test 4 — staleAccountWarning: true when the store record carries the flag", async () => {
    // The non-evm-account-store sets staleAccountWarning=true on read for
    // records > 30 days old; here we mock that branch directly so the test
    // is independent of `Date.now()` shimming.
    listAccountsSpy.mockReturnValue([
      {
        chain: "bittensor",
        address: FIXTURE_SS58,
        derivationPath: "44'/354'/0'/0'/0'",
        pairedAt: "2025-01-01T00:00:00.000Z",
        staleAccountWarning: true,
      },
    ]);

    const result = await callTool({});
    const sc = result.structuredContent as { staleAccountWarning?: true };
    expect(sc.staleAccountWarning).toBe(true);
    const text = result.content[0]?.text ?? "";
    expect(text).toMatch(/staleAccountWarning:\s+true/);
    expect(text).toMatch(/re-pair/i);
    expect(getApiSpy).not.toHaveBeenCalled();
  });
});
