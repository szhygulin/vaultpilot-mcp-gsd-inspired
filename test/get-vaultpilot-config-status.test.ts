// Plan 05-03 — get_vaultpilot_config_status tool tests (DIAG-01 + T-CONFIG-LEAK-1).
//
// Five tests:
//   1. Shape match — every documented field present with the right type
//   2. T-CONFIG-LEAK-1 (LOAD-BEARING) — sentinel-substring audit: no
//      `ETHEREUM_RPC_URL` / `WALLETCONNECT_PROJECT_ID` value, no full WC
//      session topic in the response envelope
//   3. Demo-mode integration — env=true → demoMode true, isAutoDemo false
//   4. Auto-demo integration — config missing → isAutoDemo true, persona auto-seeded
//   5. Update-check-suppressed flag — env var sets the boolean

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { _resetChainRegistryForTesting } from "../src/chains/registry.js";
import { _resetDemoModeForTesting } from "../src/config/env.js";
import {
  _resetActivePersonaForTesting,
  setActivePersona,
} from "../src/demo/state.js";
import {
  getRegisteredTool,
  type ToolHandlerResult,
} from "../src/tools/index.js";
import * as sessionManager from "../src/wallet/session-manager.js";

import {
  mockConfigFile,
  type MockConfigFile,
} from "./helpers/mock-config-file.js";

// Side-effect register the tool.
await import("../src/tools/get_vaultpilot_config_status.js");

const DEMO_KEY = "VAULTPILOT_DEMO";
const RPC_KEY = "ETHEREUM_RPC_URL";
const WC_KEY = "WALLETCONNECT_PROJECT_ID";
const SUPPRESS_KEY = "VAULTPILOT_DISABLE_UPDATE_CHECK";
const WC_STORAGE_KEY = "VAULTPILOT_WC_STORAGE";
// Plan 07-04 — new env var surfaced as etherscanApiKeyPresent boolean.
const ETHERSCAN_KEY = "ETHERSCAN_API_KEY";
// Plan 08-01 — multi-chain RPC env vars surfaced as configuredChains booleans.
const RPC_PROVIDER_KEY = "RPC_PROVIDER";
const RPC_API_KEY_KEY = "RPC_API_KEY";
const ARBITRUM_KEY = "ARBITRUM_RPC_URL";
const POLYGON_KEY = "POLYGON_RPC_URL";
const BASE_KEY = "BASE_RPC_URL";
const OPTIMISM_KEY = "OPTIMISM_RPC_URL";

let savedDemo: string | undefined;
let savedRpc: string | undefined;
let savedWc: string | undefined;
let savedSuppress: string | undefined;
let savedWcStorage: string | undefined;
let savedEtherscan: string | undefined;
let savedRpcProvider: string | undefined;
let savedRpcApiKey: string | undefined;
let savedArbitrum: string | undefined;
let savedPolygon: string | undefined;
let savedBase: string | undefined;
let savedOptimism: string | undefined;
let mock: MockConfigFile | undefined;

async function callTool(): Promise<ToolHandlerResult> {
  const tool = getRegisteredTool("get_vaultpilot_config_status");
  if (!tool) throw new Error("get_vaultpilot_config_status not registered");
  return tool.handler({});
}

beforeEach(() => {
  savedDemo = process.env[DEMO_KEY];
  savedRpc = process.env[RPC_KEY];
  savedWc = process.env[WC_KEY];
  savedSuppress = process.env[SUPPRESS_KEY];
  savedWcStorage = process.env[WC_STORAGE_KEY];
  savedEtherscan = process.env[ETHERSCAN_KEY];
  savedRpcProvider = process.env[RPC_PROVIDER_KEY];
  savedRpcApiKey = process.env[RPC_API_KEY_KEY];
  savedArbitrum = process.env[ARBITRUM_KEY];
  savedPolygon = process.env[POLYGON_KEY];
  savedBase = process.env[BASE_KEY];
  savedOptimism = process.env[OPTIMISM_KEY];

  process.env[DEMO_KEY] = "false";
  delete process.env[RPC_KEY];
  delete process.env[WC_KEY];
  delete process.env[SUPPRESS_KEY];
  delete process.env[ETHERSCAN_KEY];
  delete process.env[RPC_PROVIDER_KEY];
  delete process.env[RPC_API_KEY_KEY];
  delete process.env[ARBITRUM_KEY];
  delete process.env[POLYGON_KEY];
  delete process.env[BASE_KEY];
  delete process.env[OPTIMISM_KEY];
  // VAULTPILOT_WC_STORAGE inherits the global pin ("memory" from
  // test/setup.ts). Individual tests override below.

  _resetDemoModeForTesting();
  _resetActivePersonaForTesting();
  _resetChainRegistryForTesting();
});

afterEach(() => {
  if (savedDemo === undefined) delete process.env[DEMO_KEY];
  else process.env[DEMO_KEY] = savedDemo;
  if (savedRpc === undefined) delete process.env[RPC_KEY];
  else process.env[RPC_KEY] = savedRpc;
  if (savedWc === undefined) delete process.env[WC_KEY];
  else process.env[WC_KEY] = savedWc;
  if (savedSuppress === undefined) delete process.env[SUPPRESS_KEY];
  else process.env[SUPPRESS_KEY] = savedSuppress;
  if (savedWcStorage === undefined) delete process.env[WC_STORAGE_KEY];
  else process.env[WC_STORAGE_KEY] = savedWcStorage;
  if (savedEtherscan === undefined) delete process.env[ETHERSCAN_KEY];
  else process.env[ETHERSCAN_KEY] = savedEtherscan;
  if (savedRpcProvider === undefined) delete process.env[RPC_PROVIDER_KEY];
  else process.env[RPC_PROVIDER_KEY] = savedRpcProvider;
  if (savedRpcApiKey === undefined) delete process.env[RPC_API_KEY_KEY];
  else process.env[RPC_API_KEY_KEY] = savedRpcApiKey;
  if (savedArbitrum === undefined) delete process.env[ARBITRUM_KEY];
  else process.env[ARBITRUM_KEY] = savedArbitrum;
  if (savedPolygon === undefined) delete process.env[POLYGON_KEY];
  else process.env[POLYGON_KEY] = savedPolygon;
  if (savedBase === undefined) delete process.env[BASE_KEY];
  else process.env[BASE_KEY] = savedBase;
  if (savedOptimism === undefined) delete process.env[OPTIMISM_KEY];
  else process.env[OPTIMISM_KEY] = savedOptimism;

  _resetDemoModeForTesting();
  _resetActivePersonaForTesting();
  _resetChainRegistryForTesting();
  mock?.restore();
  mock = undefined;
  vi.restoreAllMocks();
});

describe("get_vaultpilot_config_status — shape (DIAG-01)", () => {
  it("Test 1 — returns the documented envelope shape with the right types", async () => {
    const result = await callTool();
    expect(result.isError).toBeFalsy();

    const sc = result.structuredContent;
    expect(sc).toMatchObject({
      demoMode: expect.any(Boolean),
      isAutoDemo: expect.any(Boolean),
      activePersonaSlug: null,
      walletConnectProjectIdPresent: expect.any(Boolean),
      ethereumRpcUrlPresent: expect.any(Boolean),
      etherscanApiKeyPresent: expect.any(Boolean),
      pairedAccountCount: expect.any(Number),
      wcSessionTopicSuffix: null,
      walletConnectStoragePersistent: expect.any(Boolean),
      configFilePath: expect.any(String),
      configFileExists: expect.any(Boolean),
      configFileMalformed: expect.any(Boolean),
      nodeVersion: expect.any(String),
      packageVersion: expect.any(String),
      updateCheckSuppressed: expect.any(Boolean),
    });

    // Sanity: text block carries the human-readable summary.
    const text = result.content[0]?.text ?? "";
    expect(text).toMatch(/config status/);
    expect(text).toMatch(/demoMode/);
  });
});

describe("get_vaultpilot_config_status — secret-safety audit (T-CONFIG-LEAK-1)", () => {
  it("Test 2 (LOAD-BEARING) — env values + full WC topic NEVER appear in the response", async () => {
    // Unique sentinel values — guaranteed not to appear in the response
    // unless the implementation leaks them.
    const SECRET_RPC = "https://eth-mainnet.alchemyapi.io/v2/SECRET_KEY_12345";
    const SECRET_WC = "secret-wc-id-67890";
    const FULL_TOPIC =
      "00c0ffeec0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0";
    const TOPIC_LAST8 = FULL_TOPIC.slice(-8); // "c0c0c0c0"

    process.env[RPC_KEY] = SECRET_RPC;
    process.env[WC_KEY] = SECRET_WC;

    vi.spyOn(sessionManager, "getStatus").mockResolvedValue({
      paired: true,
      address: "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045",
      chainId: 1,
      sessionTopicLast8: TOPIC_LAST8,
    });

    const result = await callTool();
    const serialized = JSON.stringify(result);

    // Load-bearing assertions — substring scan against the entire result.
    // Catches accidental inclusion via `String(value)`, error-message
    // interpolation, or unconscious field-name reuse.
    expect(serialized).not.toContain("SECRET_KEY_12345");
    expect(serialized).not.toContain(SECRET_RPC);
    expect(serialized).not.toContain(SECRET_WC);
    expect(serialized).not.toContain(FULL_TOPIC);

    // Only the safe surface should be present.
    const sc = result.structuredContent as {
      ethereumRpcUrlPresent: boolean;
      walletConnectProjectIdPresent: boolean;
      wcSessionTopicSuffix: string | null;
      pairedAccountCount: number;
    };
    expect(sc.ethereumRpcUrlPresent).toBe(true);
    expect(sc.walletConnectProjectIdPresent).toBe(true);
    expect(sc.wcSessionTopicSuffix).toBe(TOPIC_LAST8);
    expect(sc.pairedAccountCount).toBe(1);
  });
});

describe("get_vaultpilot_config_status — demo-mode integration", () => {
  it("Test 3 — VAULTPILOT_DEMO=true → demoMode true, isAutoDemo false, activePersonaSlug surfaced", async () => {
    process.env[DEMO_KEY] = "true";
    _resetDemoModeForTesting();
    setActivePersona("whale");

    const result = await callTool();
    const sc = result.structuredContent as {
      demoMode: boolean;
      isAutoDemo: boolean;
      activePersonaSlug: string | null;
    };

    expect(sc.demoMode).toBe(true);
    expect(sc.isAutoDemo).toBe(false); // explicit env, not auto-detect
    expect(sc.activePersonaSlug).toBe("whale");
  });
});

describe("get_vaultpilot_config_status — auto-demo integration", () => {
  it("Test 4 — config missing + no env → isAutoDemo true, persona auto-seeded to whale", async () => {
    delete process.env[DEMO_KEY];
    mock = mockConfigFile({ kind: "missing" });
    _resetDemoModeForTesting();
    _resetActivePersonaForTesting();

    const result = await callTool();
    const sc = result.structuredContent as {
      demoMode: boolean;
      isAutoDemo: boolean;
      activePersonaSlug: string | null;
      configFileExists: boolean;
      configFileMalformed: boolean;
    };

    expect(sc.demoMode).toBe(true);
    expect(sc.isAutoDemo).toBe(true);
    expect(sc.activePersonaSlug).toBe("whale"); // Q-AUTO-DEMO-PERSONA-DEFAULT
    expect(sc.configFileExists).toBe(false);
    expect(sc.configFileMalformed).toBe(false);
  });
});

describe("get_vaultpilot_config_status — updateCheckSuppressed flag", () => {
  it("Test 5 — VAULTPILOT_DISABLE_UPDATE_CHECK=1 → updateCheckSuppressed true", async () => {
    process.env[SUPPRESS_KEY] = "1";

    const result = await callTool();
    const sc = result.structuredContent as { updateCheckSuppressed: boolean };

    expect(sc.updateCheckSuppressed).toBe(true);
  });

  it("Test 5b — env unset → updateCheckSuppressed false", async () => {
    delete process.env[SUPPRESS_KEY];

    const result = await callTool();
    const sc = result.structuredContent as { updateCheckSuppressed: boolean };

    expect(sc.updateCheckSuppressed).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Quick-260513-c8e — walletConnectStoragePersistent surface (issue #25 #8).
// Boolean field reflects getWalletConnectStorageMode() === "persist". Under
// the global test pin (VAULTPILOT_WC_STORAGE=memory) the default value is
// false; override to "persist" to assert the true branch.
// ---------------------------------------------------------------------------
describe("get_vaultpilot_config_status — walletConnectStoragePersistent (#25 #8)", () => {
  it("Test 19a — under the default (test/setup.ts pin) VAULTPILOT_WC_STORAGE=memory, walletConnectStoragePersistent is false", async () => {
    // Global pin is "memory" via test/setup.ts; do NOT override here.
    const result = await callTool();
    const sc = result.structuredContent as {
      walletConnectStoragePersistent: boolean;
    };
    expect(sc.walletConnectStoragePersistent).toBe(false);
  });

  it("Test 19b — under VAULTPILOT_WC_STORAGE=persist, walletConnectStoragePersistent is true (override pattern)", async () => {
    process.env[WC_STORAGE_KEY] = "persist";
    const result = await callTool();
    const sc = result.structuredContent as {
      walletConnectStoragePersistent: boolean;
    };
    expect(sc.walletConnectStoragePersistent).toBe(true);
  });

  it("Test 20 — human-readable text block contains 'walletConnectStoragePersistent: <bool>'", async () => {
    const result = await callTool();
    const text = result.content[0]?.text ?? "";
    expect(text).toMatch(/walletConnectStoragePersistent:\s+(true|false)/);
  });

  it("Test 21 — tool DESCRIPTION mentions persistence so a routing agent finds the tool for 'is my Ledger session persisted?'", async () => {
    // The DESCRIPTION is what an agent sees during routing. Confirm
    // the keyword `persist` (case-insensitive) appears in the tool's
    // registered description.
    const { getRegisteredTool } = await import("../src/tools/index.js");
    const tool = getRegisteredTool("get_vaultpilot_config_status");
    expect(tool).toBeDefined();
    expect(tool?.description).toMatch(/persist/i);
  });
});

// ---------------------------------------------------------------------------
// Plan 07-04 — etherscanApiKeyPresent boolean surface (DIAG-01 extension).
// Q-CONFIG-LEAK lock applies to the new env var: the boolean ONLY, never
// the value. Test 14 asserts the value never leaks even when the env var
// is set to a unique sentinel string.
// ---------------------------------------------------------------------------
describe("get_vaultpilot_config_status — etherscanApiKeyPresent (Plan 07-04)", () => {
  it("Test 22 — env unset → etherscanApiKeyPresent false; text-block line matches", async () => {
    delete process.env[ETHERSCAN_KEY];

    const result = await callTool();
    const sc = result.structuredContent as { etherscanApiKeyPresent: boolean };

    expect(sc.etherscanApiKeyPresent).toBe(false);
    const text = result.content[0]?.text ?? "";
    expect(text).toMatch(/etherscanApiKeyPresent:\s+false/);
  });

  it("Test 23 — env set → etherscanApiKeyPresent true; text-block line matches", async () => {
    process.env[ETHERSCAN_KEY] = "any-value";

    const result = await callTool();
    const sc = result.structuredContent as { etherscanApiKeyPresent: boolean };

    expect(sc.etherscanApiKeyPresent).toBe(true);
    const text = result.content[0]?.text ?? "";
    expect(text).toMatch(/etherscanApiKeyPresent:\s+true/);
  });

  it("Test 24 (LOAD-BEARING) — ETHERSCAN_API_KEY value never appears in response (T-CONFIG-LEAK-EXTENDS-1)", async () => {
    const ETHERSCAN_SECRET = "secret-etherscan-key-do-not-leak-987654321";
    process.env[ETHERSCAN_KEY] = ETHERSCAN_SECRET;

    const result = await callTool();
    const serialized = JSON.stringify(result);
    const text = result.content[0]?.text ?? "";

    // Load-bearing assertions — substring scan across the entire response.
    expect(serialized).not.toContain(ETHERSCAN_SECRET);
    expect(text).not.toContain(ETHERSCAN_SECRET);

    // The boolean is set correctly without leaking the value.
    const sc = result.structuredContent as { etherscanApiKeyPresent: boolean };
    expect(sc.etherscanApiKeyPresent).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Plan 08-01 — rpcProvider + configuredChains additive diagnostic surface.
// `rpcProvider`: verbatim shorthand name (`infura` / `alchemy`) or null.
// `configuredChains`: per-chain boolean map reflecting RPC resolution.
// Q-CONFIG-LEAK extends: the API KEY VALUE is NEVER surfaced (T-RPC-API-KEY-LEAK-1).
// ---------------------------------------------------------------------------
describe("get_vaultpilot_config_status — rpcProvider + configuredChains (Plan 08-01)", () => {
  it("Test 35 — RPC_PROVIDER=infura → rpcProvider surfaces verbatim", async () => {
    process.env[RPC_PROVIDER_KEY] = "infura";
    process.env[RPC_API_KEY_KEY] = "irrelevant-for-this-test";
    const result = await callTool();
    const sc = result.structuredContent as { rpcProvider: string | null };
    expect(sc.rpcProvider).toBe("infura");
    const text = result.content[0]?.text ?? "";
    expect(text).toMatch(/rpcProvider:\s+infura/);
  });

  it("Test 36 — RPC_PROVIDER unset → rpcProvider is null; text-block shows (none)", async () => {
    delete process.env[RPC_PROVIDER_KEY];
    const result = await callTool();
    const sc = result.structuredContent as { rpcProvider: string | null };
    expect(sc.rpcProvider).toBeNull();
    const text = result.content[0]?.text ?? "";
    expect(text).toMatch(/rpcProvider:\s+\(none\)/);
  });

  it("Test 37 — configuredChains has 5 booleans; RPC_PROVIDER=infura + RPC_API_KEY=k → all 5 true; bare env → all 5 false", async () => {
    // Subtest A — shorthand fans to all 5 chains.
    process.env[RPC_PROVIDER_KEY] = "infura";
    process.env[RPC_API_KEY_KEY] = "k";
    let result = await callTool();
    let sc = result.structuredContent as {
      configuredChains: Record<string, boolean>;
    };
    expect(Object.keys(sc.configuredChains).sort()).toEqual(
      ["arbitrum", "base", "ethereum", "optimism", "polygon"].sort(),
    );
    expect(sc.configuredChains.ethereum).toBe(true);
    expect(sc.configuredChains.arbitrum).toBe(true);
    expect(sc.configuredChains.polygon).toBe(true);
    expect(sc.configuredChains.base).toBe(true);
    expect(sc.configuredChains.optimism).toBe(true);
    const textA = result.content[0]?.text ?? "";
    expect(textA).toMatch(/configuredChains:\s+ethereum=true arbitrum=true polygon=true base=true optimism=true/);

    // Subtest B — bare env (no override, no shorthand) → all 5 false.
    delete process.env[RPC_PROVIDER_KEY];
    delete process.env[RPC_API_KEY_KEY];
    result = await callTool();
    sc = result.structuredContent as {
      configuredChains: Record<string, boolean>;
    };
    expect(sc.configuredChains.ethereum).toBe(false);
    expect(sc.configuredChains.arbitrum).toBe(false);
    expect(sc.configuredChains.polygon).toBe(false);
    expect(sc.configuredChains.base).toBe(false);
    expect(sc.configuredChains.optimism).toBe(false);

    // Subtest C — chain-specific overrides flip the right booleans only.
    process.env[ARBITRUM_KEY] = "https://my-arb.example";
    process.env[BASE_KEY] = "https://my-base.example";
    result = await callTool();
    sc = result.structuredContent as {
      configuredChains: Record<string, boolean>;
    };
    expect(sc.configuredChains.ethereum).toBe(false);
    expect(sc.configuredChains.arbitrum).toBe(true);
    expect(sc.configuredChains.polygon).toBe(false);
    expect(sc.configuredChains.base).toBe(true);
    expect(sc.configuredChains.optimism).toBe(false);
  });

  it("Test 38 (LOAD-BEARING) — RPC_API_KEY value NEVER appears in response (T-RPC-API-KEY-LEAK-1 3-sentinel scan)", async () => {
    // Three unique sentinels — guaranteed not to appear unless leaked.
    const RPC_SECRET = "test-sentinel-12345-do-not-leak";
    const ARB_SECRET = "https://my-arb.example/path?key=arb-sentinel-67890";
    const POL_SECRET = "https://my-polygon.example/path?key=pol-sentinel-abcde";

    process.env[RPC_PROVIDER_KEY] = "infura";
    process.env[RPC_API_KEY_KEY] = RPC_SECRET;
    // Chain-specific overrides too — those URLs can also contain key material.
    process.env[ARBITRUM_KEY] = ARB_SECRET;
    process.env[POLYGON_KEY] = POL_SECRET;

    const result = await callTool();
    const serialized = JSON.stringify(result);
    const text = result.content[0]?.text ?? "";

    // The KEY value never appears in structuredContent or text — neither
    // the shorthand key nor the chain-specific URL contents.
    expect(serialized).not.toContain(RPC_SECRET);
    expect(serialized).not.toContain(ARB_SECRET);
    expect(serialized).not.toContain(POL_SECRET);
    expect(serialized).not.toContain("arb-sentinel-67890");
    expect(serialized).not.toContain("pol-sentinel-abcde");
    expect(text).not.toContain(RPC_SECRET);
    expect(text).not.toContain(ARB_SECRET);
    expect(text).not.toContain(POL_SECRET);

    // The non-sensitive surface IS present.
    const sc = result.structuredContent as {
      rpcProvider: string | null;
      configuredChains: Record<string, boolean>;
    };
    expect(sc.rpcProvider).toBe("infura"); // provider NAME is fine; key VALUE is not
    expect(sc.configuredChains.arbitrum).toBe(true);
    expect(sc.configuredChains.polygon).toBe(true);
  });
});
