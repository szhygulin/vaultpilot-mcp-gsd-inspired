// Phase 22 Plan 22-04 — get_vaultpilot_config_status BTC surface tests
// (mirror of `get-vaultpilot-config-status-tron.test.ts`).
//
// New field verified by this file:
//   - `btcEsploraConfigured`: boolean (true iff BTC_ESPLORA_URL explicitly set)
//
// Reuses Phase 11's chain-agnostic `pairedNonEvmChains` aggregation —
// `'bitcoin'` automatically surfaces in the sorted unique list when a
// BTC record is in the store (ZERO code change to the aggregation; the
// existing `[...new Set(records.map(r => r.chain))].sort()` deduplicates
// across the dual-record-per-pair shape Phase 22 ships).
//
// Critical anti-pattern defense: with TWO bitcoin records (segwit +
// taproot) present, `pairedNonEvmChains` MUST contain `"bitcoin"`
// exactly ONCE, NOT twice (T-22-21 mitigation per <threat_model>).
//
// DIAG-01 secret-safety: pair BTC with sentinel addresses AND set
// BTC_ESPLORA_URL to a sentinel URL; assert NEITHER appears in the
// response (booleans + counts + suffixes + paths only).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { _resetChainRegistryForTesting } from "../src/chains/registry.js";
import { _resetDemoModeForTesting } from "../src/config/env.js";
import { _resetActivePersonaForTesting } from "../src/demo/state.js";
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
const BTC_ESPLORA_KEY = "BTC_ESPLORA_URL";
const NON_EVM_STORAGE_KEY = "VAULTPILOT_NON_EVM_STORAGE";

let savedDemo: string | undefined;
let savedEsplora: string | undefined;
let savedNonEvmStorage: string | undefined;

async function callTool(): Promise<ToolHandlerResult> {
  const tool = getRegisteredTool("get_vaultpilot_config_status");
  if (!tool) throw new Error("get_vaultpilot_config_status not registered");
  return tool.handler({});
}

beforeEach(() => {
  savedDemo = process.env[DEMO_KEY];
  savedEsplora = process.env[BTC_ESPLORA_KEY];
  savedNonEvmStorage = process.env[NON_EVM_STORAGE_KEY];

  process.env[DEMO_KEY] = "false";
  delete process.env[BTC_ESPLORA_KEY];

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
  if (savedEsplora === undefined) delete process.env[BTC_ESPLORA_KEY];
  else process.env[BTC_ESPLORA_KEY] = savedEsplora;
  if (savedNonEvmStorage === undefined) delete process.env[NON_EVM_STORAGE_KEY];
  else process.env[NON_EVM_STORAGE_KEY] = savedNonEvmStorage;

  _resetDemoModeForTesting();
  _resetActivePersonaForTesting();
  _resetChainRegistryForTesting();
  _resetSkillIntegrityForTesting();
  vi.restoreAllMocks();
});

describe("get_vaultpilot_config_status — btcEsploraConfigured (Plan 22-04)", () => {
  it("Test 1 — btcEsploraConfigured: true when BTC_ESPLORA_URL is explicitly set", async () => {
    process.env[BTC_ESPLORA_KEY] = "https://esplora.example.com/api";

    const result = await callTool();
    const sc = result.structuredContent as { btcEsploraConfigured: boolean };
    expect(sc.btcEsploraConfigured).toBe(true);
  });

  it("Test 2 — btcEsploraConfigured: false when BTC_ESPLORA_URL is unset (blockstream.info fallback does NOT count)", async () => {
    delete process.env[BTC_ESPLORA_KEY];

    const result = await callTool();
    const sc = result.structuredContent as { btcEsploraConfigured: boolean };
    expect(sc.btcEsploraConfigured).toBe(false);
  });

  it("Test 3 — btcEsploraConfigured: false when BTC_ESPLORA_URL is whitespace-only (read() trim path)", async () => {
    process.env[BTC_ESPLORA_KEY] = "   ";

    const result = await callTool();
    const sc = result.structuredContent as { btcEsploraConfigured: boolean };
    expect(sc.btcEsploraConfigured).toBe(false);
  });

  it("Test 4 — text-block surfaces btcEsploraConfigured line", async () => {
    process.env[BTC_ESPLORA_KEY] = "https://esplora.example.com/api";

    const result = await callTool();
    const text = result.content[0]?.text ?? "";
    expect(text).toMatch(/btcEsploraConfigured:\s+true/);
  });

  it("Test 5 — DESCRIPTION contains `btcEsploraConfigured` token (agent routing prompt mirrors structured response)", async () => {
    const tool = getRegisteredTool("get_vaultpilot_config_status");
    expect(tool).toBeDefined();
    expect(tool!.description).toContain("btcEsploraConfigured");
  });
});

describe("get_vaultpilot_config_status — pairedNonEvmChains includes 'bitcoin' (Phase 11 wiring reused)", () => {
  it("Test 6 — pairedNonEvmChains: ['bitcoin'] after a single BTC pair", async () => {
    listAccountsSpy.mockReturnValue([
      {
        chain: "bitcoin",
        address: "bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq",
        derivationPath: "84'/0'/0'/0/0",
        pairedAt: "2026-05-15T10:00:00.000Z",
      },
    ]);

    const result = await callTool();
    const sc = result.structuredContent as {
      pairedNonEvmChains: string[];
      pairedNonEvmAccountCount: number;
    };
    expect(sc.pairedNonEvmChains).toEqual(["bitcoin"]);
    expect(sc.pairedNonEvmAccountCount).toBe(1);
  });

  it("Test 7 — pairedNonEvmChains: ['bitcoin'] appears ONCE when TWO bitcoin records exist (segwit + taproot dedupe; T-22-21)", async () => {
    listAccountsSpy.mockReturnValue([
      {
        chain: "bitcoin",
        address: "bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq",
        derivationPath: "84'/0'/0'/0/0",
        pairedAt: "2026-05-15T10:00:00.000Z",
      },
      {
        chain: "bitcoin",
        address: "bc1p5cyxnuxmeuwuvkwfem96lqzszd02n6xdcjrs20cac6yqjjwudpxqkedrcr",
        derivationPath: "86'/0'/0'/0/0",
        pairedAt: "2026-05-15T10:00:00.000Z",
      },
    ]);

    const result = await callTool();
    const sc = result.structuredContent as {
      pairedNonEvmChains: string[];
      pairedNonEvmAccountCount: number;
    };
    // LOAD-BEARING: new Set dedupes; "bitcoin" appears exactly once.
    expect(sc.pairedNonEvmChains).toEqual(["bitcoin"]);
    // Account count is the per-record count — TWO records, NOT one.
    expect(sc.pairedNonEvmAccountCount).toBe(2);
  });

  it("Test 8 — pairedNonEvmChains: ['bitcoin', 'solana', 'tron'] sorted across mixed records", async () => {
    listAccountsSpy.mockReturnValue([
      {
        chain: "tron",
        address: "TWd4WrZ9wn84f5x1hZhL4DHvk738ns5jwb",
        derivationPath: "44'/195'/0'/0/0",
        pairedAt: "2026-05-15T10:00:00.000Z",
      },
      {
        chain: "bitcoin",
        address: "bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq",
        derivationPath: "84'/0'/0'/0/0",
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
    // Sorted: bitcoin < solana < tron (lexicographic).
    expect(sc.pairedNonEvmChains).toEqual(["bitcoin", "solana", "tron"]);
  });
});

describe("get_vaultpilot_config_status — DIAG-01 secret-safety scan (BTC extension)", () => {
  it("Test 9 — neither paired BTC addresses nor BTC_ESPLORA_URL appear in the response", async () => {
    const SEGWIT_SENTINEL = "bc1qsentinelxxxxxxxxxxxxxxxxxxxxxxxxxxxx0d";
    const TAPROOT_SENTINEL =
      "bc1psentinelxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxqxs9d";
    const URL_SENTINEL_HOST = "BTC-URL-SENTINEL-DO-NOT-LEAK.example.com";
    const URL_SENTINEL = `https://${URL_SENTINEL_HOST}/api`;

    process.env[BTC_ESPLORA_KEY] = URL_SENTINEL;
    listAccountsSpy.mockReturnValue([
      {
        chain: "bitcoin",
        address: SEGWIT_SENTINEL,
        derivationPath: "84'/0'/0'/0/0",
        pairedAt: "2026-05-15T10:00:00.000Z",
      },
      {
        chain: "bitcoin",
        address: TAPROOT_SENTINEL,
        derivationPath: "86'/0'/0'/0/0",
        pairedAt: "2026-05-15T10:00:00.000Z",
      },
    ]);

    const result = await callTool();
    const serialized = JSON.stringify(result);

    // Load-bearing assertions — no address bytes, no URL bytes anywhere.
    expect(serialized).not.toContain(SEGWIT_SENTINEL);
    expect(serialized).not.toContain(TAPROOT_SENTINEL);
    expect(serialized).not.toContain("sentinelxxxx");
    expect(serialized).not.toContain(URL_SENTINEL);
    expect(serialized).not.toContain(URL_SENTINEL_HOST);
    expect(serialized).not.toContain("BTC-URL-SENTINEL");

    // Sanity: the boolean DOES surface (we're testing that the secret
    // bytes don't leak, not that the boolean is wrong).
    const sc = result.structuredContent as {
      btcEsploraConfigured: boolean;
      pairedNonEvmChains: string[];
      pairedNonEvmAccountCount: number;
    };
    expect(sc.btcEsploraConfigured).toBe(true);
    expect(sc.pairedNonEvmChains).toEqual(["bitcoin"]);
    expect(sc.pairedNonEvmAccountCount).toBe(2);
  });
});
