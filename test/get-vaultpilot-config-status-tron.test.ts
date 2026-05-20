// Phase 17 Plan 17-03 — get_vaultpilot_config_status TRON surface tests
// (TRON-READ-01 extension; mirror of `get-vaultpilot-config-status-solana.test.ts`).
//
// New field verified by this file:
//   - `tronRpcConfigured`           : boolean (true iff env URL explicitly set)
//
// Reuses Phase 11's chain-agnostic `pairedNonEvmChains` aggregation —
// `'tron'` automatically surfaces in the sorted unique list when a TRON
// record is in the store (no per-chain wiring change needed in 17-03).
//
// DIAG-01 secret-safety regression: pair a TRON account with a sentinel
// address AND set TRON_RPC_URL to a sentinel URL; assert NEITHER appears
// in the response (chain names + counts + booleans only).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { _resetChainRegistryForTesting } from "../src/chains/registry.js";
import { _resetDemoModeForTesting } from "../src/config/env.js";
import {
  _resetActivePersonaForTesting,
} from "../src/demo/state.js";
import { _resetSkillIntegrityForTesting } from "../src/security/skill-integrity.js";
import {
  getRegisteredTool,
  type ToolHandlerResult,
} from "../src/tools/index.js";

// Mock the non-evm-account-store's listAccounts so we can drive
// pairedNonEvmChains / count without touching disk.
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
const TRON_RPC_KEY = "TRON_RPC_URL";
const NON_EVM_STORAGE_KEY = "VAULTPILOT_NON_EVM_STORAGE";

let savedDemo: string | undefined;
let savedTronRpc: string | undefined;
let savedNonEvmStorage: string | undefined;

async function callTool(): Promise<ToolHandlerResult> {
  const tool = getRegisteredTool("get_vaultpilot_config_status");
  if (!tool) throw new Error("get_vaultpilot_config_status not registered");
  return tool.handler({});
}

beforeEach(() => {
  savedDemo = process.env[DEMO_KEY];
  savedTronRpc = process.env[TRON_RPC_KEY];
  savedNonEvmStorage = process.env[NON_EVM_STORAGE_KEY];

  process.env[DEMO_KEY] = "false";
  delete process.env[TRON_RPC_KEY];

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
  if (savedTronRpc === undefined) delete process.env[TRON_RPC_KEY];
  else process.env[TRON_RPC_KEY] = savedTronRpc;
  if (savedNonEvmStorage === undefined) delete process.env[NON_EVM_STORAGE_KEY];
  else process.env[NON_EVM_STORAGE_KEY] = savedNonEvmStorage;

  _resetDemoModeForTesting();
  _resetActivePersonaForTesting();
  _resetChainRegistryForTesting();
  _resetSkillIntegrityForTesting();
  vi.restoreAllMocks();
});

describe("get_vaultpilot_config_status — tronRpcConfigured (Plan 17-03)", () => {
  it("Test 1 — tronRpcConfigured: true when TRON_RPC_URL is explicitly set", async () => {
    process.env[TRON_RPC_KEY] = "https://tron-rpc.example.com/v1";

    const result = await callTool();
    const sc = result.structuredContent as { tronRpcConfigured: boolean };
    expect(sc.tronRpcConfigured).toBe(true);
  });

  it("Test 2 — tronRpcConfigured: false when TRON_RPC_URL is unset (TronGrid fallback does NOT count)", async () => {
    delete process.env[TRON_RPC_KEY];

    const result = await callTool();
    const sc = result.structuredContent as { tronRpcConfigured: boolean };
    expect(sc.tronRpcConfigured).toBe(false);
  });

  it("Test 3 — tronRpcConfigured: false when TRON_RPC_URL is whitespace-only (read() trim path)", async () => {
    process.env[TRON_RPC_KEY] = "   ";

    const result = await callTool();
    const sc = result.structuredContent as { tronRpcConfigured: boolean };
    expect(sc.tronRpcConfigured).toBe(false);
  });

  it("Test 4 — text-block surfaces tronRpcConfigured line", async () => {
    process.env[TRON_RPC_KEY] = "https://tron-rpc.example.com/v1";

    const result = await callTool();
    const text = result.content[0]?.text ?? "";
    expect(text).toMatch(/tronRpcConfigured:\s+true/);
  });

  it("Test 5 — DESCRIPTION contains `tronRpcConfigured` token (agent routing prompt surfaces the field)", async () => {
    const tool = getRegisteredTool("get_vaultpilot_config_status");
    expect(tool).toBeDefined();
    expect(tool!.description).toContain("tronRpcConfigured");
  });
});

describe("get_vaultpilot_config_status — pairedNonEvmChains includes 'tron' (Phase 11 wiring reused)", () => {
  it("Test 6 — pairedNonEvmChains: ['tron'] after a single TRON pair", async () => {
    listAccountsSpy.mockReturnValue([
      {
        chain: "tron",
        address: "TWd4WrZ9wn84f5x1hZhL4DHvk738ns5jwb",
        derivationPath: "44'/195'/0'/0/0",
        pairedAt: "2026-05-15T10:00:00.000Z",
      },
    ]);

    const result = await callTool();
    const sc = result.structuredContent as {
      pairedNonEvmChains: string[];
      pairedNonEvmAccountCount: number;
    };
    expect(sc.pairedNonEvmChains).toEqual(["tron"]);
    expect(sc.pairedNonEvmAccountCount).toBe(1);
  });

  it("Test 7 — pairedNonEvmChains: ['solana', 'tron'] sorted across mixed records", async () => {
    listAccountsSpy.mockReturnValue([
      {
        chain: "tron",
        address: "TWd4WrZ9wn84f5x1hZhL4DHvk738ns5jwb",
        derivationPath: "44'/195'/0'/0/0",
        pairedAt: "2026-05-15T10:00:00.000Z",
      },
      {
        chain: "solana",
        address: "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM",
        derivationPath: "44'/501'/0'",
        pairedAt: "2026-05-16T10:00:00.000Z",
      },
    ]);

    const result = await callTool();
    const sc = result.structuredContent as { pairedNonEvmChains: string[] };
    expect(sc.pairedNonEvmChains).toEqual(["solana", "tron"]);
  });
});

describe("get_vaultpilot_config_status — DIAG-01 secret-safety scan (TRON extension)", () => {
  it("Test 8 — neither paired TRON address nor TRON_RPC_URL appear in the response", async () => {
    const ADDRESS_SENTINEL = "TRON-ADDR-SENTINEL-DO-NOT-LEAK-XYZ";
    const URL_SENTINEL_HOST = "TRON-URL-SENTINEL-DO-NOT-LEAK.example.com";
    const URL_SENTINEL = `https://${URL_SENTINEL_HOST}/v1`;

    process.env[TRON_RPC_KEY] = URL_SENTINEL;
    listAccountsSpy.mockReturnValue([
      {
        chain: "tron",
        address: ADDRESS_SENTINEL,
        derivationPath: "44'/195'/0'/0/0",
        pairedAt: "2026-05-15T10:00:00.000Z",
      },
    ]);

    const result = await callTool();
    const serialized = JSON.stringify(result);

    // Load-bearing assertions — no address bytes, no URL bytes anywhere.
    expect(serialized).not.toContain(ADDRESS_SENTINEL);
    expect(serialized).not.toContain("TRON-ADDR-SENTINEL");
    expect(serialized).not.toContain(URL_SENTINEL);
    expect(serialized).not.toContain(URL_SENTINEL_HOST);
    expect(serialized).not.toContain("TRON-URL-SENTINEL");

    // Sanity: the boolean DOES surface (we're testing that the secret
    // bytes don't leak, not that the boolean is wrong).
    const sc = result.structuredContent as {
      tronRpcConfigured: boolean;
      pairedNonEvmChains: string[];
      pairedNonEvmAccountCount: number;
    };
    expect(sc.tronRpcConfigured).toBe(true);
    expect(sc.pairedNonEvmChains).toEqual(["tron"]);
    expect(sc.pairedNonEvmAccountCount).toBe(1);
  });
});
