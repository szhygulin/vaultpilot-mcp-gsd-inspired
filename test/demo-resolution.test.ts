// Plan 05-01 — exhaustive decision-tree coverage for the demo-mode
// resolution chain (env > config > auto-detect).
//
// Coverage matrix:
//   1. env="true"  → demo on
//   2. env="false" → demo off
//   3. env="1"     → process.exit(1) + stderr
//   4. env="True"  → process.exit(1) + stderr (DEMO-01 strict-literal anchor)
//   5. env="yes"   → process.exit(1) + stderr
//   6. env unset + config { demo: true }  → demo on (config-on)
//   7. env unset + config { demo: false } → demo off (config-off)
//   8. env unset + config { rpcUrl: "..." } (no demo key) → real-mode (config-no-demo-key)
//   9. env unset + config missing → auto-demo + whale seed
//  10. env unset + config malformed → process.exit(1) + stderr
//  11. caching: changes to env between calls do NOT flip resolution
//      until _resetDemoModeForTesting() runs
//  12. auto-demo seed pre-empt: pre-seeded persona wins over the
//      auto-demo's `whale` seed (T-AUTO-SEED-RACE-1)

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  _resetDemoModeForTesting,
  isAutoDemo,
  isDemoMode,
} from "../src/config/env.js";
import {
  _resetActivePersonaForTesting,
  getActivePersona,
  setActivePersona,
} from "../src/demo/state.js";
import { mockConfigFile, type MockConfigFile } from "./helpers/mock-config-file.js";

const DEMO_KEY = "VAULTPILOT_DEMO";
let savedDemo: string | undefined;
let mock: MockConfigFile | undefined;

beforeEach(() => {
  _resetDemoModeForTesting();
  _resetActivePersonaForTesting();
  savedDemo = process.env[DEMO_KEY];
  delete process.env[DEMO_KEY];
});

afterEach(() => {
  if (savedDemo === undefined) delete process.env[DEMO_KEY];
  else process.env[DEMO_KEY] = savedDemo;
  if (mock) {
    mock.restore();
    mock = undefined;
  }
  _resetDemoModeForTesting();
  _resetActivePersonaForTesting();
});

// Convenience: install a `process.exit` mock that throws so test code
// past the exit() call doesn't run. Returns the spy so the test can
// assert it was called with code 1.
function installExitSpy(): ReturnType<typeof vi.spyOn> {
  return vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
    throw new Error(`mock-exit-${code ?? "undefined"}`);
  }) as never);
}

describe("resolveDemoMode — env arm (DEMO-01 / DEMO-02 / Q-STRICT)", () => {
  it("Test 1 — env='true' literal → demo on, not auto-demo", () => {
    process.env[DEMO_KEY] = "true";
    // No need to mock the config file — env arm short-circuits before
    // the resolver reads the filesystem.
    expect(isDemoMode()).toBe(true);
    expect(isAutoDemo()).toBe(false);
  });

  it("Test 2 — env='false' literal → demo off, not auto-demo", () => {
    process.env[DEMO_KEY] = "false";
    expect(isDemoMode()).toBe(false);
    expect(isAutoDemo()).toBe(false);
  });

  it("Test 3 — env='1' triggers process.exit(1) + stderr name VAULTPILOT_DEMO", () => {
    process.env[DEMO_KEY] = "1";
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const exitSpy = installExitSpy();

    expect(() => isDemoMode()).toThrow(/mock-exit-1/);
    expect(exitSpy).toHaveBeenCalledWith(1);
    const stderrCalls = stderrSpy.mock.calls.map((c) => String(c[0])).join("");
    expect(stderrCalls).toMatch(/VAULTPILOT_DEMO must be literal/);

    exitSpy.mockRestore();
    stderrSpy.mockRestore();
  });

  it("Test 4 — env='True' (capital) triggers process.exit(1) per Q-STRICT (strict-literal anchor)", () => {
    process.env[DEMO_KEY] = "True";
    const exitSpy = installExitSpy();
    expect(() => isDemoMode()).toThrow(/mock-exit-1/);
    expect(exitSpy).toHaveBeenCalledWith(1);
    exitSpy.mockRestore();
  });

  it("Test 5 — env='yes' triggers process.exit(1) per Q-STRICT", () => {
    process.env[DEMO_KEY] = "yes";
    const exitSpy = installExitSpy();
    expect(() => isDemoMode()).toThrow(/mock-exit-1/);
    expect(exitSpy).toHaveBeenCalledWith(1);
    exitSpy.mockRestore();
  });
});

describe("resolveDemoMode — config arm (DEMO-02 / Q-CONFIG-NO-KEY)", () => {
  it("Test 6 — env unset + config { demo: true } → demo on (config-on)", () => {
    mock = mockConfigFile({ kind: "valid", content: { demo: true } });
    expect(isDemoMode()).toBe(true);
    expect(isAutoDemo()).toBe(false);
  });

  it("Test 7 — env unset + config { demo: false } → demo off (config-off)", () => {
    mock = mockConfigFile({ kind: "valid", content: { demo: false } });
    expect(isDemoMode()).toBe(false);
    expect(isAutoDemo()).toBe(false);
  });

  it("Test 8 — env unset + config { rpcUrl } (no demo key) → real-mode (Q-CONFIG-NO-KEY)", () => {
    mock = mockConfigFile({
      kind: "valid",
      content: { rpcUrl: "https://eth.example.com" },
    });
    // User wrote a config but didn't opt in to demo — respect that.
    expect(isDemoMode()).toBe(false);
    expect(isAutoDemo()).toBe(false);
  });
});

describe("resolveDemoMode — auto-demo arm (INST-05 / Q-AUTO-DEMO-PERSONA-DEFAULT)", () => {
  it("Test 9 — env unset + config missing → auto-demo + whale seed", () => {
    mock = mockConfigFile({ kind: "missing" });
    expect(isDemoMode()).toBe(true);
    expect(isAutoDemo()).toBe(true);
    // Q-AUTO-DEMO-PERSONA-DEFAULT lock — first read tool works
    // out of the box without requiring set_demo_wallet first.
    expect(getActivePersona()?.slug).toBe("whale");
  });

  it("Test 10 — env unset + config malformed → process.exit(1) + stderr", () => {
    mock = mockConfigFile({ kind: "malformed" });
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const exitSpy = installExitSpy();

    expect(() => isDemoMode()).toThrow(/mock-exit-1/);
    expect(exitSpy).toHaveBeenCalledWith(1);
    const stderrCalls = stderrSpy.mock.calls.map((c) => String(c[0])).join("");
    expect(stderrCalls).toMatch(/malformed/);

    exitSpy.mockRestore();
    stderrSpy.mockRestore();
  });
});

describe("resolveDemoMode — caching (lazy-singleton pattern)", () => {
  it("Test 11 — second call returns cached resolution; _resetDemoModeForTesting clears", () => {
    process.env[DEMO_KEY] = "true";
    expect(isDemoMode()).toBe(true);

    // Flip env between calls — without a reset, the resolver returns
    // the cached value (env arm fired on the first call only).
    process.env[DEMO_KEY] = "false";
    expect(isDemoMode()).toBe(true); // still cached as env-on

    _resetDemoModeForTesting();
    expect(isDemoMode()).toBe(false); // recomputes — env-off arm now wins
  });

  it("Test 12 — auto-demo seed pre-empt: pre-seeded persona wins (T-AUTO-SEED-RACE-1)", () => {
    mock = mockConfigFile({ kind: "missing" });

    // Pre-seed stable-saver BEFORE triggering auto-demo resolution.
    // The auto-demo's `whale` seed is guarded by `if null` so the
    // pre-seeded value should win.
    setActivePersona("stable-saver");

    expect(isDemoMode()).toBe(true);
    expect(isAutoDemo()).toBe(true);
    expect(getActivePersona()?.slug).toBe("stable-saver"); // NOT whale
  });
});
