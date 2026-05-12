// Plan 05-03 — server dispatcher wrap tests (DEMO-07 + DIAG-04 + T-NOTICE-OVERREACH-1).
//
// Five end-to-end tests that exercise the wrap at `src/server.ts:98-159`
// via spawn-server-in-process. The wrap composes two behaviors at the SDK
// boundary:
//   (a) fire-and-forget update check on FIRST tool dispatch
//   (b) NOTICE prepend on first response IFF `isAutoDemo()` is true
//
// Tests:
//   1. NOTICE prepends on first response in auto-demo
//   2. NOTICE does NOT prepend on second response (once-per-session)
//   3. T-NOTICE-OVERREACH-1 — env=true demo NEVER triggers NOTICE
//   4. T-NOTICE-OVERREACH-1 — config-mode demo NEVER triggers NOTICE
//   5. Update check fires on first dispatch (DIAG-04 + dispatcher wiring);
//      second dispatch does NOT re-fire (once-per-session)

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { _resetDemoModeForTesting } from "../src/config/env.js";
import { _resetActivePersonaForTesting } from "../src/demo/state.js";
import { _resetAutoDemoNoticeForTesting } from "../src/diagnostics/notice.js";
import { _resetUpdateCheckForTesting } from "../src/diagnostics/update-check.js";

import {
  mockConfigFile,
  type MockConfigFile,
} from "./helpers/mock-config-file.js";
import { spawnServerInProcess, type SpawnedServer } from "./helpers/spawn-server.js";

// Ensure all tools registered so callTool routes succeed.
await import("../src/tools/register-all.js");

const DEMO_KEY = "VAULTPILOT_DEMO";
const SUPPRESS_KEY = "VAULTPILOT_DISABLE_UPDATE_CHECK";

let savedDemo: string | undefined;
let savedSuppress: string | undefined;
let mock: MockConfigFile | undefined;
let spawned: SpawnedServer | undefined;

beforeEach(() => {
  savedDemo = process.env[DEMO_KEY];
  savedSuppress = process.env[SUPPRESS_KEY];
  delete process.env[DEMO_KEY];
  // Suppress the actual npm fetch — Test 5 substitutes a fetch spy that
  // would be subverted by a real network call.
  process.env[SUPPRESS_KEY] = "1";

  _resetDemoModeForTesting();
  _resetActivePersonaForTesting();
  _resetAutoDemoNoticeForTesting();
  _resetUpdateCheckForTesting();
});

afterEach(async () => {
  if (savedDemo === undefined) delete process.env[DEMO_KEY];
  else process.env[DEMO_KEY] = savedDemo;
  if (savedSuppress === undefined) delete process.env[SUPPRESS_KEY];
  else process.env[SUPPRESS_KEY] = savedSuppress;

  _resetDemoModeForTesting();
  _resetActivePersonaForTesting();
  _resetAutoDemoNoticeForTesting();
  _resetUpdateCheckForTesting();

  mock?.restore();
  mock = undefined;

  if (spawned) {
    await spawned.close();
    spawned = undefined;
  }

  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// CallTool result content type — `content[i]` is `{ type: "text", text: string }`.
type ContentEntry = { type: string; text?: string };

describe("dispatcher wrap — NOTICE prepends on first auto-demo response (DEMO-07)", () => {
  it("Test 1 — config missing + env unset → first response has NOTICE prepended", async () => {
    mock = mockConfigFile({ kind: "missing" });

    spawned = await spawnServerInProcess();
    const result = await spawned.client.callTool({
      name: "get_ledger_device_info",
      arguments: {},
    });

    const content = result.content as ContentEntry[];
    expect(content).toBeDefined();
    expect(content.length).toBeGreaterThanOrEqual(2);

    // First content entry is the NOTICE.
    const noticeText = content[0]?.text ?? "";
    expect(noticeText).toContain("VAULTPILOT NOTICE");
    expect(noticeText).toContain("Auto demo mode active");

    // Second entry is the actual tool response.
    const toolText = content[1]?.text ?? "";
    expect(toolText).toMatch(/paired:/);
  });
});

describe("dispatcher wrap — NOTICE does NOT prepend on second response", () => {
  it("Test 2 — second tool call in same session → no NOTICE block", async () => {
    mock = mockConfigFile({ kind: "missing" });

    spawned = await spawnServerInProcess();
    // First call consumes the NOTICE.
    await spawned.client.callTool({
      name: "get_ledger_device_info",
      arguments: {},
    });
    // Second call must NOT carry the NOTICE.
    const second = await spawned.client.callTool({
      name: "get_ledger_device_info",
      arguments: {},
    });

    const content = second.content as ContentEntry[];
    // Should be exactly one entry — the tool's own text. NOTICE not prepended.
    expect(content[0]?.text ?? "").not.toContain("VAULTPILOT NOTICE");
    expect(content[0]?.text ?? "").toMatch(/paired:/);
  });
});

describe("dispatcher wrap — explicit env=true demo does NOT trigger NOTICE (T-NOTICE-OVERREACH-1)", () => {
  it("Test 3 — VAULTPILOT_DEMO=true → response has no NOTICE block even on first call", async () => {
    process.env[DEMO_KEY] = "true";
    _resetDemoModeForTesting();

    spawned = await spawnServerInProcess();
    const result = await spawned.client.callTool({
      name: "get_ledger_device_info",
      arguments: {},
    });

    const content = result.content as ContentEntry[];
    expect(content[0]?.text ?? "").not.toContain("VAULTPILOT NOTICE");
  });
});

describe("dispatcher wrap — config-mode demo does NOT trigger NOTICE (T-NOTICE-OVERREACH-1)", () => {
  it("Test 4 — config { demo: true } → response has no NOTICE block even on first call", async () => {
    mock = mockConfigFile({ kind: "valid", content: { demo: true } });
    _resetDemoModeForTesting();

    spawned = await spawnServerInProcess();
    const result = await spawned.client.callTool({
      name: "get_ledger_device_info",
      arguments: {},
    });

    const content = result.content as ContentEntry[];
    expect(content[0]?.text ?? "").not.toContain("VAULTPILOT NOTICE");
  });
});

describe("dispatcher wrap — update check fires on FIRST tool dispatch (DIAG-04)", () => {
  it("Test 5 — fetch spy invoked on first dispatch; not re-invoked on second", async () => {
    // Allow the real update-check path (don't suppress here).
    delete process.env[SUPPRESS_KEY];
    // Force a non-auto-demo arm so the NOTICE prepend logic is not at play
    // for THIS test — Test 5 is about update-check wiring, not NOTICE.
    process.env[DEMO_KEY] = "false";
    _resetDemoModeForTesting();
    _resetUpdateCheckForTesting();

    const fetchMock = vi.fn(async () => {
      // Return a 5xx so the fire-and-forget path stays silent.
      return {
        ok: false,
        status: 503,
        json: async () => ({}),
      } as unknown as Response;
    });
    vi.stubGlobal("fetch", fetchMock);

    spawned = await spawnServerInProcess();

    // First dispatch → fetch invoked.
    await spawned.client.callTool({
      name: "get_ledger_device_info",
      arguments: {},
    });
    // Let the fire-and-forget run.
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("registry.npmjs.org/vaultpilot-mcp/latest"),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );

    // Second dispatch → fetch NOT re-invoked (once-per-session guard).
    await spawned.client.callTool({
      name: "get_ledger_device_info",
      arguments: {},
    });
    await new Promise((r) => setImmediate(r));

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
