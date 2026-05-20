// Plan 17-05 — set_demo_wallet TRON persona branch.
//
// Coverage:
//   1. Demo-mode FIRST refusal preserved for TRON slug (byte-frozen with
//      existing EVM + Solana behavior).
//   2. Demo mode + 'tron-whale' → setActiveTronPersonaBySlug called;
//      response confirms { chain: "tron", slug, address: tronAddress }.
//   3. Demo mode + TRON slug → EVM + Solana persona untouched
//      (independence).
//   4. Demo mode + EVM/Solana slug → TRON persona untouched
//      (independence).
//   5. Schema enum widening — assert 'tron-whale' is in INPUT_SCHEMA.enum.

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { _resetDemoModeForTesting } from "../src/config/env.js";
import {
  _resetActivePersonaForTesting,
  getActivePersona,
  getActiveSolanaPersona,
  getActiveTronPersona,
} from "../src/demo/state.js";
import {
  getRegisteredTool,
  type ToolHandlerResult,
} from "../src/tools/index.js";

// Trigger side-effect registration.
await import("../src/tools/register-all.js");

const DEMO_KEY = "VAULTPILOT_DEMO";
let savedDemo: string | undefined;

async function callTool(args: Record<string, unknown>): Promise<ToolHandlerResult> {
  const tool = getRegisteredTool("set_demo_wallet");
  if (!tool) throw new Error("set_demo_wallet not registered");
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

describe("set_demo_wallet — TRON persona happy path (Plan 17-05)", () => {
  it("demo mode + persona='tron-whale' → success, TRON state mutated", async () => {
    process.env[DEMO_KEY] = "true";
    _resetDemoModeForTesting();

    const result = await callTool({ persona: "tron-whale" });

    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as {
      active: { chain: string; slug: string; address: string; description: string };
    };
    expect(sc.active.chain).toBe("tron");
    expect(sc.active.slug).toBe("tron-whale");
    // Base58check T-prefixed address (not 0x-hex, not Solana base58).
    expect(sc.active.address.startsWith("0x")).toBe(false);
    expect(sc.active.address.startsWith("T")).toBe(true);
    expect(sc.active.address).toBe(
      "TWd4WrZ9wn84f5x1hZhL4DHvk738ns5jwb",
    );

    expect(getActiveTronPersona()?.slug).toBe("tron-whale");

    const text = result.content[0]?.text ?? "";
    expect(text).toMatch(/active persona set/);
    expect(text).toMatch(/tron-whale/);
  });

  it("demo mode + TRON slug → EVM + Solana persona untouched (independence)", async () => {
    process.env[DEMO_KEY] = "true";
    _resetDemoModeForTesting();

    await callTool({ persona: "tron-whale" });
    expect(getActivePersona()).toBeNull(); // EVM untouched
    expect(getActiveSolanaPersona()).toBeNull(); // Solana untouched
    expect(getActiveTronPersona()?.slug).toBe("tron-whale");
  });

  it("demo mode + EVM slug → TRON persona untouched (independence)", async () => {
    process.env[DEMO_KEY] = "true";
    _resetDemoModeForTesting();

    await callTool({ persona: "whale" });
    expect(getActivePersona()?.slug).toBe("whale");
    expect(getActiveTronPersona()).toBeNull(); // TRON untouched
  });

  it("demo mode + Solana slug → TRON persona untouched (independence)", async () => {
    process.env[DEMO_KEY] = "true";
    _resetDemoModeForTesting();

    await callTool({ persona: "solana-whale" });
    expect(getActiveSolanaPersona()?.slug).toBe("solana-whale");
    expect(getActiveTronPersona()).toBeNull(); // TRON untouched
  });
});

describe("set_demo_wallet — TRON slug refused in real mode (T-PERSONA-CONFUSION-1 preserved)", () => {
  it("real mode + persona='tron-whale' → WRONG_MODE envelope; state NOT mutated", async () => {
    // beforeEach already set env=false and reset cache.
    expect(getActiveTronPersona()).toBeNull();

    const result = await callTool({ persona: "tron-whale" });

    expect(result.isError).toBe(true);
    const sc = result.structuredContent as { errorCode: string };
    expect(sc.errorCode).toBe("WRONG_MODE");

    const text = result.content[0]?.text ?? "";
    expect(text).toMatch(/demo mode/i);

    // Critical assertion: TRON state NOT mutated when mode check fires.
    // Same mitigation as Test 3 in set-demo-wallet.test.ts — the demo-mode
    // FIRST refusal block (byte-frozen) protects EVM + Solana + TRON paths.
    expect(getActiveTronPersona()).toBeNull();
  });
});

describe("set_demo_wallet — INPUT_SCHEMA enum includes 'tron-whale' (Plan 17-05)", () => {
  it("registered tool's inputSchema.enum widens to 6 slugs", () => {
    const tool = getRegisteredTool("set_demo_wallet");
    if (!tool) throw new Error("set_demo_wallet not registered");
    const schema = tool.inputSchema as {
      properties: { persona: { enum: string[] } };
    };
    const enumValues = schema.properties.persona.enum;
    expect(enumValues).toContain("whale");
    expect(enumValues).toContain("defi-degen");
    expect(enumValues).toContain("stable-saver");
    expect(enumValues).toContain("staking-maxi");
    expect(enumValues).toContain("solana-whale");
    expect(enumValues).toContain("tron-whale");
    expect(enumValues.length).toBe(6);
  });

  it("tool DESCRIPTION mentions tron-whale (agent routing prompt)", () => {
    const tool = getRegisteredTool("set_demo_wallet");
    if (!tool) throw new Error("set_demo_wallet not registered");
    expect(tool.description).toMatch(/tron-whale/);
  });
});
