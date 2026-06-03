// test/get-vaultpilot-config-status-bittensor.test.ts — Phase 46 Plan
// 46-01 Task 3 (TAO-R-04). Sibling of
// get-vaultpilot-config-status-solana.test.ts.
//
// New fields verified by this file:
//   - `bittensorRpcConfigured` : boolean (true iff BITTENSOR_RPC_URL set;
//      public Finney fallback does NOT count — same Phase-8 semantics)
//   - `"bittensor"` flows into `pairedNonEvmChains` when a
//      chain:"bittensor" record exists, absent otherwise (the existing
//      `new Set` dedup — zero aggregation change)
//   - secret-safety: neither the paired address nor BITTENSOR_RPC_URL
//      appears in the response

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { _resetChainRegistryForTesting } from "../src/chains/registry.js";
import { _resetDemoModeForTesting } from "../src/config/env.js";
import { _resetActivePersonaForTesting } from "../src/demo/state.js";
import { _resetSkillIntegrityForTesting } from "../src/security/skill-integrity.js";
import {
  getRegisteredTool,
  type ToolHandlerResult,
} from "../src/tools/index.js";

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

await import("../src/tools/get_vaultpilot_config_status.js");

const DEMO_KEY = "VAULTPILOT_DEMO";
const BITTENSOR_RPC_KEY = "BITTENSOR_RPC_URL";

let savedDemo: string | undefined;
let savedBittensorRpc: string | undefined;

async function callTool(): Promise<ToolHandlerResult> {
  const tool = getRegisteredTool("get_vaultpilot_config_status");
  if (!tool) throw new Error("get_vaultpilot_config_status not registered");
  return tool.handler({});
}

beforeEach(() => {
  savedDemo = process.env[DEMO_KEY];
  savedBittensorRpc = process.env[BITTENSOR_RPC_KEY];

  process.env[DEMO_KEY] = "false";
  delete process.env[BITTENSOR_RPC_KEY];

  listAccountsSpy.mockReset();
  listAccountsSpy.mockReturnValue([]);

  _resetDemoModeForTesting();
  _resetActivePersonaForTesting();
  _resetChainRegistryForTesting();
  _resetSkillIntegrityForTesting();
});

afterEach(() => {
  if (savedDemo === undefined) delete process.env[DEMO_KEY];
  else process.env[DEMO_KEY] = savedDemo;
  if (savedBittensorRpc === undefined) delete process.env[BITTENSOR_RPC_KEY];
  else process.env[BITTENSOR_RPC_KEY] = savedBittensorRpc;

  _resetDemoModeForTesting();
  _resetActivePersonaForTesting();
  _resetChainRegistryForTesting();
  _resetSkillIntegrityForTesting();
  vi.restoreAllMocks();
});

describe("get_vaultpilot_config_status — bittensorRpcConfigured (TAO-R-04)", () => {
  it("true when BITTENSOR_RPC_URL is explicitly set", async () => {
    process.env[BITTENSOR_RPC_KEY] = "wss://my-subtensor.example:443";
    const result = await callTool();
    const sc = result.structuredContent as { bittensorRpcConfigured: boolean };
    expect(sc.bittensorRpcConfigured).toBe(true);
  });

  it("false when BITTENSOR_RPC_URL is unset (public Finney fallback does NOT count)", async () => {
    delete process.env[BITTENSOR_RPC_KEY];
    const result = await callTool();
    const sc = result.structuredContent as { bittensorRpcConfigured: boolean };
    expect(sc.bittensorRpcConfigured).toBe(false);
  });

  it("false when BITTENSOR_RPC_URL is whitespace-only (read() trim path)", async () => {
    process.env[BITTENSOR_RPC_KEY] = "   ";
    const result = await callTool();
    const sc = result.structuredContent as { bittensorRpcConfigured: boolean };
    expect(sc.bittensorRpcConfigured).toBe(false);
  });
});

describe("get_vaultpilot_config_status — \"bittensor\" in pairedNonEvmChains (TAO-R-04)", () => {
  it("absent when no bittensor record exists", async () => {
    listAccountsSpy.mockReturnValue([]);
    const result = await callTool();
    const sc = result.structuredContent as { pairedNonEvmChains: string[] };
    expect(sc.pairedNonEvmChains).not.toContain("bittensor");
  });

  it("includes 'bittensor' when a chain:'bittensor' record is present", async () => {
    listAccountsSpy.mockReturnValue([
      {
        chain: "bittensor",
        address: "5GsbTgfvgCH4xdqSkiPb7EaBBFLHjWH5vfEALhJaewSFpZX9",
        derivationPath: "44'/354'/0'/0'/0'",
        pairedAt: "2026-06-01T10:00:00.000Z",
      },
    ]);
    const result = await callTool();
    const sc = result.structuredContent as {
      pairedNonEvmChains: string[];
      pairedNonEvmAccountCount: number;
    };
    expect(sc.pairedNonEvmChains).toContain("bittensor");
    expect(sc.pairedNonEvmAccountCount).toBe(1);
  });

  it("dedups + sorts bittensor alongside other non-EVM chains", async () => {
    listAccountsSpy.mockReturnValue([
      {
        chain: "solana",
        address: "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM",
        derivationPath: "44'/501'/0'",
        pairedAt: "2026-06-01T10:00:00.000Z",
      },
      {
        chain: "bittensor",
        address: "5GsbTgfvgCH4xdqSkiPb7EaBBFLHjWH5vfEALhJaewSFpZX9",
        derivationPath: "44'/354'/0'/0'/0'",
        pairedAt: "2026-06-02T10:00:00.000Z",
      },
    ]);
    const result = await callTool();
    const sc = result.structuredContent as { pairedNonEvmChains: string[] };
    // Sorted alphabetically — "bittensor" sorts before "solana".
    expect(sc.pairedNonEvmChains).toEqual(["bittensor", "solana"]);
  });
});

describe("get_vaultpilot_config_status — bittensor secret-safety", () => {
  it("neither the paired address nor BITTENSOR_RPC_URL appears in the response", async () => {
    const ADDRESS_SENTINEL = "5GsbTgfvgCH4xdqSkiPb7EaBBFLHjWH5vfEALhJaewSFpZX9";
    const URL_SENTINEL = "wss://BITTENSOR-URL-SENTINEL-DO-NOT-LEAK.example:443";

    process.env[BITTENSOR_RPC_KEY] = URL_SENTINEL;
    listAccountsSpy.mockReturnValue([
      {
        chain: "bittensor",
        address: ADDRESS_SENTINEL,
        derivationPath: "44'/354'/0'/0'/0'",
        pairedAt: "2026-06-01T10:00:00.000Z",
      },
    ]);

    const result = await callTool();
    const serialized = JSON.stringify(result);

    expect(serialized).not.toContain(ADDRESS_SENTINEL);
    expect(serialized).not.toContain(URL_SENTINEL);
    expect(serialized).not.toContain("BITTENSOR-URL-SENTINEL");

    const sc = result.structuredContent as {
      bittensorRpcConfigured: boolean;
      pairedNonEvmChains: string[];
    };
    expect(sc.bittensorRpcConfigured).toBe(true);
    expect(sc.pairedNonEvmChains).toContain("bittensor");
  });
});
