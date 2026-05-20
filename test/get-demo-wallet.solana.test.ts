// Plan 11-06 — get_demo_wallet response widens to include Solana personas.

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  _resetDemoModeForTesting,
} from "../src/config/env.js";
import {
  _resetActivePersonaForTesting,
  setActivePersona,
  setActiveSolanaPersonaBySlug,
} from "../src/demo/state.js";
import { SOLANA_PERSONAS } from "../src/demo/solana-persona.js";
import {
  getRegisteredTool,
  type ToolHandlerResult,
} from "../src/tools/index.js";

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

describe("get_demo_wallet — Solana persona surfacing (Plan 11-06)", () => {
  it("response includes solanaPersonas array with at least 1 entry", async () => {
    const result = await callTool();
    const sc = result.structuredContent as {
      solanaPersonas: Array<{
        chain: string;
        slug: string;
        solanaAddress: string;
        description: string;
        rehearsableFlows: readonly string[];
      }>;
    };
    expect(sc.solanaPersonas).toBeDefined();
    expect(sc.solanaPersonas.length).toBeGreaterThanOrEqual(1);
  });

  it("solanaPersonas entries surface base58 solanaAddress (not 0x-hex)", async () => {
    const result = await callTool();
    const sc = result.structuredContent as {
      solanaPersonas: Array<{ chain: string; slug: string; solanaAddress: string }>;
    };
    for (const p of sc.solanaPersonas) {
      expect(p.chain).toBe("solana");
      expect(p.solanaAddress.startsWith("0x")).toBe(false);
    }
  });

  it("solanaPersonas addresses are byte-identical to SOLANA_PERSONAS const (regression anchor)", async () => {
    const result = await callTool();
    const sc = result.structuredContent as {
      solanaPersonas: Array<{ slug: string; solanaAddress: string }>;
    };
    const byTool = new Map(sc.solanaPersonas.map((p) => [p.slug, p.solanaAddress]));
    const byConst = new Map(SOLANA_PERSONAS.map((p) => [p.slug, p.solanaAddress]));
    for (const slug of byConst.keys()) {
      expect(byTool.get(slug)).toBe(byConst.get(slug));
    }
  });

  it("response surfaces activeSolanaPersona slug when set", async () => {
    process.env[DEMO_KEY] = "true";
    _resetDemoModeForTesting();
    setActiveSolanaPersonaBySlug("solana-whale");

    const result = await callTool();
    const sc = result.structuredContent as {
      activeSolanaPersona: string | null;
      activeEvmPersona: string | null;
    };
    expect(sc.activeSolanaPersona).toBe("solana-whale");
    expect(sc.activeEvmPersona).toBeNull();
  });

  it("response surfaces activeEvmPersona slug independently", async () => {
    process.env[DEMO_KEY] = "true";
    _resetDemoModeForTesting();
    setActivePersona("whale");

    const result = await callTool();
    const sc = result.structuredContent as {
      activeSolanaPersona: string | null;
      activeEvmPersona: string | null;
    };
    expect(sc.activeEvmPersona).toBe("whale");
    expect(sc.activeSolanaPersona).toBeNull();
  });

  it("response surfaces BOTH active personas when both are set (independence)", async () => {
    process.env[DEMO_KEY] = "true";
    _resetDemoModeForTesting();
    setActivePersona("whale");
    setActiveSolanaPersonaBySlug("solana-whale");

    const result = await callTool();
    const sc = result.structuredContent as {
      activeSolanaPersona: string | null;
      activeEvmPersona: string | null;
    };
    expect(sc.activeEvmPersona).toBe("whale");
    expect(sc.activeSolanaPersona).toBe("solana-whale");
  });

  it("text block surfaces both EVM and Solana sections", async () => {
    const result = await callTool();
    const text = result.content[0]?.text ?? "";
    expect(text).toMatch(/DEMO WALLETS/);
    expect(text).toMatch(/EVM/);
    expect(text).toMatch(/Solana/);
    expect(text).toMatch(/solana-whale/);
  });

  it("evmPersonas array stays at 4 entries (no regression)", async () => {
    const result = await callTool();
    const sc = result.structuredContent as {
      evmPersonas: Array<{ slug: string; chain: string }>;
    };
    expect(sc.evmPersonas.length).toBe(4);
    for (const p of sc.evmPersonas) {
      expect(p.chain).toBe("ethereum");
    }
  });

  it("legacy personas array (back-compat) stays at 4 EVM entries", async () => {
    const result = await callTool();
    const sc = result.structuredContent as {
      personas: Array<{ slug: string }>;
    };
    expect(sc.personas.length).toBe(4);
  });
});
