// Plan 05-01 — get_demo_wallet tool tests (DEMO-03).
//
// Tool is read-only and works in any mode. Assertions:
//   1. structuredContent.personas has exactly 4 entries with the locked slugs
//   2. each address is EIP-55 byte-identical to the const (no recomputation)
//   3. tool works in BOTH demo and real mode — no isDemoMode() gate

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  _resetDemoModeForTesting,
} from "../src/config/env.js";
import {
  _resetActivePersonaForTesting,
} from "../src/demo/state.js";
import { PERSONAS } from "../src/demo/personas.js";
import {
  getRegisteredTool,
  type ToolHandlerResult,
} from "../src/tools/index.js";

// Side-effect register the tool. The registry is process-global; the import
// fires once for the test process.
await import("../src/tools/get_demo_wallet.js");

const DEMO_KEY = "VAULTPILOT_DEMO";
let savedDemo: string | undefined;

async function callTool(args: Record<string, unknown> = {}): Promise<ToolHandlerResult> {
  const tool = getRegisteredTool("get_demo_wallet");
  if (!tool) throw new Error("get_demo_wallet not registered");
  return tool.handler(args);
}

beforeEach(() => {
  savedDemo = process.env[DEMO_KEY];
  process.env[DEMO_KEY] = "false";
  _resetDemoModeForTesting();
  _resetActivePersonaForTesting();
});

afterEach(() => {
  if (savedDemo === undefined) delete process.env[DEMO_KEY];
  else process.env[DEMO_KEY] = savedDemo;
  _resetDemoModeForTesting();
  _resetActivePersonaForTesting();
});

describe("get_demo_wallet — lists curated personas (DEMO-03)", () => {
  it("Test 1 — returns 4 personas with the documented shape", async () => {
    const result = await callTool();
    expect(result.isError).toBeFalsy();

    const sc = result.structuredContent as {
      personas: Array<{ slug: string; address: string; description: string; rehearsableFlows: readonly string[] }>;
    };
    expect(sc.personas).toBeDefined();
    expect(sc.personas.length).toBe(4);

    const slugs = sc.personas.map((p) => p.slug).sort();
    expect(slugs).toEqual(
      ["defi-degen", "stable-saver", "staking-maxi", "whale"].sort(),
    );

    // Surface block names a recognizable header so an agent's regex
    // routing logic can detect "this is the demo wallets menu."
    const text = result.content[0]?.text ?? "";
    expect(text).toMatch(/DEMO WALLETS/);
    expect(text).toMatch(/set_demo_wallet/);
  });

  it("Test 2 — addresses byte-identical to the PERSONAS const (no recomputation)", async () => {
    const result = await callTool();
    const sc = result.structuredContent as {
      personas: Array<{ slug: string; address: string }>;
    };
    const byTool = new Map(sc.personas.map((p) => [p.slug, p.address]));
    const byConst = new Map(PERSONAS.map((p) => [p.slug, p.address]));
    for (const slug of byConst.keys()) {
      expect(byTool.get(slug)).toBe(byConst.get(slug));
    }
  });
});

describe("get_demo_wallet — works in any mode (no isDemoMode gate)", () => {
  it("Test 3 — succeeds in real mode AND demo mode", async () => {
    // Real mode (env=false from beforeEach).
    const realResult = await callTool();
    expect(realResult.isError).toBeFalsy();
    expect((realResult.structuredContent as { personas: unknown[] }).personas).toHaveLength(4);

    // Reset and switch to demo mode.
    process.env[DEMO_KEY] = "true";
    _resetDemoModeForTesting();

    const demoResult = await callTool();
    expect(demoResult.isError).toBeFalsy();
    expect((demoResult.structuredContent as { personas: unknown[] }).personas).toHaveLength(4);
  });
});
