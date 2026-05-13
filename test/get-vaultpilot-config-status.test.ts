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

let savedDemo: string | undefined;
let savedRpc: string | undefined;
let savedWc: string | undefined;
let savedSuppress: string | undefined;
let savedWcStorage: string | undefined;
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

  process.env[DEMO_KEY] = "false";
  delete process.env[RPC_KEY];
  delete process.env[WC_KEY];
  delete process.env[SUPPRESS_KEY];
  // VAULTPILOT_WC_STORAGE inherits the global pin ("memory" from
  // test/setup.ts). Individual tests override below.

  _resetDemoModeForTesting();
  _resetActivePersonaForTesting();
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

  _resetDemoModeForTesting();
  _resetActivePersonaForTesting();
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
