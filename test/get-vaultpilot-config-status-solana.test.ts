// Plan 11-04 — get_vaultpilot_config_status Solana / non-EVM surface tests
// (PAIR-NEV-07 + ROADMAP Success Criterion #13).
//
// New fields verified by this file:
//   - `solanaRpcConfigured`        : boolean (true iff env URL explicitly set)
//   - `pairedNonEvmChains`         : sorted unique chain list (no addresses)
//   - `pairedNonEvmAccountCount`   : total record count
//   - `nonEvmStoragePersistent`    : boolean (mode === "persist")
//
// DIAG-01 secret-safety regression (Test 6): pair a Solana account with
// a sentinel address AND set SOLANA_RPC_URL to a sentinel URL; assert
// NEITHER appears in the response (chain names + counts + booleans only).

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
const SOLANA_RPC_KEY = "SOLANA_RPC_URL";
const NON_EVM_STORAGE_KEY = "VAULTPILOT_NON_EVM_STORAGE";

let savedDemo: string | undefined;
let savedSolanaRpc: string | undefined;
let savedNonEvmStorage: string | undefined;

async function callTool(): Promise<ToolHandlerResult> {
  const tool = getRegisteredTool("get_vaultpilot_config_status");
  if (!tool) throw new Error("get_vaultpilot_config_status not registered");
  return tool.handler({});
}

beforeEach(() => {
  savedDemo = process.env[DEMO_KEY];
  savedSolanaRpc = process.env[SOLANA_RPC_KEY];
  savedNonEvmStorage = process.env[NON_EVM_STORAGE_KEY];

  process.env[DEMO_KEY] = "false";
  delete process.env[SOLANA_RPC_KEY];
  // Test/setup.ts pins to "memory"; individual tests override.

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
  if (savedSolanaRpc === undefined) delete process.env[SOLANA_RPC_KEY];
  else process.env[SOLANA_RPC_KEY] = savedSolanaRpc;
  if (savedNonEvmStorage === undefined) delete process.env[NON_EVM_STORAGE_KEY];
  else process.env[NON_EVM_STORAGE_KEY] = savedNonEvmStorage;

  _resetDemoModeForTesting();
  _resetActivePersonaForTesting();
  _resetChainRegistryForTesting();
  _resetSkillIntegrityForTesting();
  vi.restoreAllMocks();
});

describe("get_vaultpilot_config_status — pairedNonEvm* + nonEvmStoragePersistent (PAIR-NEV-07)", () => {
  it("Test 1 — pairedNonEvmChains: [] when no records", async () => {
    listAccountsSpy.mockReturnValue([]);

    const result = await callTool();
    const sc = result.structuredContent as {
      pairedNonEvmChains: string[];
      pairedNonEvmAccountCount: number;
    };
    expect(sc.pairedNonEvmChains).toEqual([]);
    expect(sc.pairedNonEvmAccountCount).toBe(0);
  });

  it("Test 2 — pairedNonEvmChains: ['solana'] after a single Solana pair", async () => {
    listAccountsSpy.mockReturnValue([
      {
        chain: "solana",
        address: "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM",
        derivationPath: "44'/501'/0'",
        pairedAt: "2026-05-15T10:00:00.000Z",
      },
    ]);

    const result = await callTool();
    const sc = result.structuredContent as {
      pairedNonEvmChains: string[];
      pairedNonEvmAccountCount: number;
    };
    expect(sc.pairedNonEvmChains).toEqual(["solana"]);
    expect(sc.pairedNonEvmAccountCount).toBe(1);
  });

  it("Test 3 — pairedNonEvmChains sorted unique across multi-chain records", async () => {
    listAccountsSpy.mockReturnValue([
      {
        chain: "tron",
        address: "TLa2f6VPqDgRE67v1736s7bJ8Ray5wYjU7",
        derivationPath: "44'/195'/0'/0/0",
        pairedAt: "2026-05-15T10:00:00.000Z",
      },
      {
        chain: "solana",
        address: "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM",
        derivationPath: "44'/501'/0'",
        pairedAt: "2026-05-16T10:00:00.000Z",
      },
      {
        chain: "solana",
        address: "AnotherSolanaAddress1234567890abcdefghij",
        derivationPath: "44'/501'/1'",
        pairedAt: "2026-05-17T10:00:00.000Z",
      },
    ]);

    const result = await callTool();
    const sc = result.structuredContent as {
      pairedNonEvmChains: string[];
      pairedNonEvmAccountCount: number;
    };
    // Sorted alphabetically; unique (solana appears once even though 2
    // records).
    expect(sc.pairedNonEvmChains).toEqual(["solana", "tron"]);
    expect(sc.pairedNonEvmAccountCount).toBe(3);
  });

  it("Test 4a — nonEvmStoragePersistent: false under VAULTPILOT_NON_EVM_STORAGE=memory (test/setup.ts pin)", async () => {
    // Inherit the global "memory" pin from test/setup.ts.
    const result = await callTool();
    const sc = result.structuredContent as { nonEvmStoragePersistent: boolean };
    expect(sc.nonEvmStoragePersistent).toBe(false);
  });

  it("Test 4b — nonEvmStoragePersistent: true under VAULTPILOT_NON_EVM_STORAGE=persist (override)", async () => {
    process.env[NON_EVM_STORAGE_KEY] = "persist";

    const result = await callTool();
    const sc = result.structuredContent as { nonEvmStoragePersistent: boolean };
    expect(sc.nonEvmStoragePersistent).toBe(true);
  });
});

describe("get_vaultpilot_config_status — solanaRpcConfigured (ROADMAP Success Criterion #13)", () => {
  it("Test 5a — solanaRpcConfigured: true when SOLANA_RPC_URL is explicitly set", async () => {
    process.env[SOLANA_RPC_KEY] = "https://solana-rpc.example.com/v1";

    const result = await callTool();
    const sc = result.structuredContent as { solanaRpcConfigured: boolean };
    expect(sc.solanaRpcConfigured).toBe(true);
  });

  it("Test 5b — solanaRpcConfigured: false when SOLANA_RPC_URL is unset (public-RPC fallback does NOT count)", async () => {
    delete process.env[SOLANA_RPC_KEY];

    const result = await callTool();
    const sc = result.structuredContent as { solanaRpcConfigured: boolean };
    expect(sc.solanaRpcConfigured).toBe(false);
  });

  it("Test 5c — solanaRpcConfigured: false when SOLANA_RPC_URL is whitespace-only (read() trim path)", async () => {
    process.env[SOLANA_RPC_KEY] = "   ";

    const result = await callTool();
    const sc = result.structuredContent as { solanaRpcConfigured: boolean };
    expect(sc.solanaRpcConfigured).toBe(false);
  });
});

describe("get_vaultpilot_config_status — DIAG-01 secret-safety scan (Plan 11-04 extension)", () => {
  it("Test 6 — neither paired addresses nor SOLANA_RPC_URL appear in the response (load-bearing)", async () => {
    const ADDRESS_SENTINEL = "ADDR-SENTINEL-12345-DO-NOT-LEAK";
    const URL_SENTINEL_HOST = "URL-SENTINEL-67890-DO-NOT-LEAK.example.com";
    const URL_SENTINEL = `https://${URL_SENTINEL_HOST}/v1`;

    process.env[SOLANA_RPC_KEY] = URL_SENTINEL;
    listAccountsSpy.mockReturnValue([
      {
        chain: "solana",
        address: ADDRESS_SENTINEL,
        derivationPath: "44'/501'/0'",
        pairedAt: "2026-05-15T10:00:00.000Z",
      },
    ]);

    const result = await callTool();
    const serialized = JSON.stringify(result);

    // Load-bearing assertions — no address bytes, no URL bytes anywhere.
    expect(serialized).not.toContain(ADDRESS_SENTINEL);
    expect(serialized).not.toContain("ADDR-SENTINEL");
    expect(serialized).not.toContain(URL_SENTINEL);
    expect(serialized).not.toContain(URL_SENTINEL_HOST);
    expect(serialized).not.toContain("URL-SENTINEL");

    // Sanity: the boolean DOES surface (we're testing that the secret
    // bytes don't leak, not that the boolean is wrong).
    const sc = result.structuredContent as {
      solanaRpcConfigured: boolean;
      pairedNonEvmChains: string[];
      pairedNonEvmAccountCount: number;
    };
    expect(sc.solanaRpcConfigured).toBe(true);
    expect(sc.pairedNonEvmChains).toEqual(["solana"]);
    expect(sc.pairedNonEvmAccountCount).toBe(1);
  });
});
