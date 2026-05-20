// Plan 11-06 — set_demo_wallet Solana persona branch.
//
// Coverage:
//   1. Demo-mode FIRST refusal preserved for Solana slug (byte-frozen with
//      existing EVM behavior).
//   2. Demo mode + 'solana-whale' → setActiveSolanaPersonaBySlug called;
//      response confirms { chain: "solana", slug, address: solanaAddress }.
//   3. Demo mode + 'whale' (EVM) → existing setActivePersona path;
//      Solana persona untouched.
//   4. Demo mode + unknown slug → INVALID_INPUT (existing behavior).
//   5. Schema enum widening — assert 'solana-whale' is in INPUT_SCHEMA.enum.

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { _resetDemoModeForTesting } from "../src/config/env.js";
import {
  _resetActivePersonaForTesting,
  getActivePersona,
  getActiveSolanaPersona,
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

describe("set_demo_wallet — Solana persona happy path (Plan 11-06)", () => {
  it("demo mode + persona='solana-whale' → success, Solana state mutated", async () => {
    process.env[DEMO_KEY] = "true";
    _resetDemoModeForTesting();

    const result = await callTool({ persona: "solana-whale" });

    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as {
      active: { chain: string; slug: string; address: string; description: string };
    };
    expect(sc.active.chain).toBe("solana");
    expect(sc.active.slug).toBe("solana-whale");
    // Base58 address (not 0x-hex).
    expect(sc.active.address.startsWith("0x")).toBe(false);
    expect(sc.active.address).toBe(
      "5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9",
    );

    expect(getActiveSolanaPersona()?.slug).toBe("solana-whale");

    const text = result.content[0]?.text ?? "";
    expect(text).toMatch(/active persona set/);
    expect(text).toMatch(/solana-whale/);
  });

  it("demo mode + Solana slug → EVM persona untouched (independence)", async () => {
    process.env[DEMO_KEY] = "true";
    _resetDemoModeForTesting();

    await callTool({ persona: "solana-whale" });
    expect(getActivePersona()).toBeNull(); // EVM untouched
    expect(getActiveSolanaPersona()?.slug).toBe("solana-whale");
  });

  it("demo mode + EVM slug → Solana persona untouched (independence)", async () => {
    process.env[DEMO_KEY] = "true";
    _resetDemoModeForTesting();

    await callTool({ persona: "whale" });
    expect(getActivePersona()?.slug).toBe("whale");
    expect(getActiveSolanaPersona()).toBeNull(); // Solana untouched
  });
});

describe("set_demo_wallet — Solana slug refused in real mode (T-PERSONA-CONFUSION-1 preserved)", () => {
  it("real mode + persona='solana-whale' → WRONG_MODE envelope; state NOT mutated", async () => {
    // beforeEach already set env=false and reset cache.
    expect(getActiveSolanaPersona()).toBeNull();

    const result = await callTool({ persona: "solana-whale" });

    expect(result.isError).toBe(true);
    const sc = result.structuredContent as { errorCode: string };
    expect(sc.errorCode).toBe("WRONG_MODE");

    const text = result.content[0]?.text ?? "";
    expect(text).toMatch(/demo mode/i);

    // Critical assertion: Solana state NOT mutated when mode check fires.
    // Same mitigation as Test 3 in set-demo-wallet.test.ts — the demo-mode
    // FIRST refusal block (byte-frozen) protects BOTH EVM and Solana paths.
    expect(getActiveSolanaPersona()).toBeNull();
  });
});

describe("set_demo_wallet — INPUT_SCHEMA enum includes 'solana-whale' (Plan 11-06)", () => {
  it("registered tool's inputSchema.enum contains the Solana slug (membership-only — TRON widening in Plan 17-05 makes a length assertion fragile)", () => {
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
    expect(enumValues.length).toBeGreaterThanOrEqual(5);
  });
});
