// Plan 22-04 — set_demo_wallet BTC persona branch.
//
// Coverage:
//   1. Demo-mode FIRST refusal preserved for BTC slug (byte-frozen with
//      existing EVM + Solana + TRON behavior).
//   2. Demo mode + 'btc-whale' → setActiveBtcPersonaBySlug called;
//      response confirms { chain: "bitcoin", slug, address: btcSegwitAddress }.
//   3. Demo mode + BTC slug → EVM + Solana + TRON persona untouched
//      (independence).
//   4. Demo mode + EVM/Solana/TRON slug → BTC persona untouched
//      (independence).
//   5. Schema enum widening — assert 'btc-whale' is in INPUT_SCHEMA.enum;
//      total slug count widens to 7.

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { _resetDemoModeForTesting } from "../src/config/env.js";
import {
  _resetActivePersonaForTesting,
  getActiveBtcPersona,
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

describe("set_demo_wallet — BTC persona happy path (Plan 22-04)", () => {
  it("demo mode + persona='btc-whale' → success, BTC state mutated", async () => {
    process.env[DEMO_KEY] = "true";
    _resetDemoModeForTesting();

    const result = await callTool({ persona: "btc-whale" });

    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as {
      active: { chain: string; slug: string; address: string; description: string };
    };
    expect(sc.active.chain).toBe("bitcoin");
    expect(sc.active.slug).toBe("btc-whale");
    // Surface the segwit address as the canonical `address` field
    // (bech32 P2WPKH; bc1q prefix). The taproot address is surfaced
    // separately via the registry — set_demo_wallet's compact
    // confirmation surface pins on segwit as the canonical witness.
    expect(sc.active.address.startsWith("bc1q")).toBe(true);
    expect(sc.active.address).toBe(
      "bc1qm34lsc65zpw79lxes69zkqmk6ee3ewf0j77s3h",
    );

    expect(getActiveBtcPersona()?.slug).toBe("btc-whale");

    const text = result.content[0]?.text ?? "";
    expect(text).toMatch(/active persona set/);
    expect(text).toMatch(/btc-whale/);
  });

  it("demo mode + BTC slug → EVM + Solana + TRON persona untouched (independence)", async () => {
    process.env[DEMO_KEY] = "true";
    _resetDemoModeForTesting();

    await callTool({ persona: "btc-whale" });
    expect(getActivePersona()).toBeNull(); // EVM untouched
    expect(getActiveSolanaPersona()).toBeNull(); // Solana untouched
    expect(getActiveTronPersona()).toBeNull(); // TRON untouched
    expect(getActiveBtcPersona()?.slug).toBe("btc-whale");
  });

  it("demo mode + EVM slug → BTC persona untouched (independence)", async () => {
    process.env[DEMO_KEY] = "true";
    _resetDemoModeForTesting();

    await callTool({ persona: "whale" });
    expect(getActivePersona()?.slug).toBe("whale");
    expect(getActiveBtcPersona()).toBeNull(); // BTC untouched
  });

  it("demo mode + Solana slug → BTC persona untouched (independence)", async () => {
    process.env[DEMO_KEY] = "true";
    _resetDemoModeForTesting();

    await callTool({ persona: "solana-whale" });
    expect(getActiveSolanaPersona()?.slug).toBe("solana-whale");
    expect(getActiveBtcPersona()).toBeNull(); // BTC untouched
  });

  it("demo mode + TRON slug → BTC persona untouched (independence)", async () => {
    process.env[DEMO_KEY] = "true";
    _resetDemoModeForTesting();

    await callTool({ persona: "tron-whale" });
    expect(getActiveTronPersona()?.slug).toBe("tron-whale");
    expect(getActiveBtcPersona()).toBeNull(); // BTC untouched
  });
});

describe("set_demo_wallet — BTC slug refused in real mode (T-PERSONA-CONFUSION-1 preserved)", () => {
  it("real mode + persona='btc-whale' → WRONG_MODE envelope; state NOT mutated", async () => {
    // beforeEach already set env=false and reset cache.
    expect(getActiveBtcPersona()).toBeNull();

    const result = await callTool({ persona: "btc-whale" });

    expect(result.isError).toBe(true);
    const sc = result.structuredContent as { errorCode: string };
    expect(sc.errorCode).toBe("WRONG_MODE");

    const text = result.content[0]?.text ?? "";
    expect(text).toMatch(/demo mode/i);

    // Critical assertion: BTC state NOT mutated when mode check fires.
    expect(getActiveBtcPersona()).toBeNull();
  });
});

describe("set_demo_wallet — INPUT_SCHEMA enum includes 'btc-whale' (Plan 22-04)", () => {
  it("registered tool's inputSchema.enum widens to 7 slugs", () => {
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
    expect(enumValues).toContain("btc-whale");
    expect(enumValues.length).toBe(7);
  });

  it("tool DESCRIPTION mentions btc-whale (agent routing prompt)", () => {
    const tool = getRegisteredTool("set_demo_wallet");
    if (!tool) throw new Error("set_demo_wallet not registered");
    expect(tool.description).toMatch(/btc-whale/);
  });
});
