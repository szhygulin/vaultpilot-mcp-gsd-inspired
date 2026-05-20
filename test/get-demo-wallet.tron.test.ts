// Plan 17-05 — get_demo_wallet response widens to include TRON personas.

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  _resetDemoModeForTesting,
} from "../src/config/env.js";
import {
  _resetActivePersonaForTesting,
  setActivePersona,
  setActiveSolanaPersonaBySlug,
  setActiveTronPersonaBySlug,
} from "../src/demo/state.js";
import { TRON_PERSONAS } from "../src/demo/tron-persona.js";
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

describe("get_demo_wallet — TRON persona surfacing (Plan 17-05)", () => {
  it("response includes tronPersonas array with at least 1 entry", async () => {
    const result = await callTool();
    const sc = result.structuredContent as {
      tronPersonas: Array<{
        chain: string;
        slug: string;
        tronAddress: string;
        description: string;
        rehearsableFlows: readonly string[];
      }>;
    };
    expect(sc.tronPersonas).toBeDefined();
    expect(sc.tronPersonas.length).toBeGreaterThanOrEqual(1);
  });

  it("tronPersonas entries surface T-prefixed base58check tronAddress (not 0x-hex, not Solana base58)", async () => {
    const result = await callTool();
    const sc = result.structuredContent as {
      tronPersonas: Array<{ chain: string; slug: string; tronAddress: string }>;
    };
    for (const p of sc.tronPersonas) {
      expect(p.chain).toBe("tron");
      expect(p.tronAddress.startsWith("0x")).toBe(false);
      expect(p.tronAddress.startsWith("T")).toBe(true);
      expect(p.tronAddress).toMatch(/^T[1-9A-HJ-NP-Za-km-z]{33}$/);
    }
  });

  it("tronPersonas addresses are byte-identical to TRON_PERSONAS const (regression anchor)", async () => {
    const result = await callTool();
    const sc = result.structuredContent as {
      tronPersonas: Array<{ slug: string; tronAddress: string }>;
    };
    const byTool = new Map(sc.tronPersonas.map((p) => [p.slug, p.tronAddress]));
    const byConst = new Map(TRON_PERSONAS.map((p) => [p.slug, p.tronAddress]));
    for (const slug of byConst.keys()) {
      expect(byTool.get(slug)).toBe(byConst.get(slug));
    }
  });

  it("response surfaces activeTronPersona slug when set", async () => {
    process.env[DEMO_KEY] = "true";
    _resetDemoModeForTesting();
    setActiveTronPersonaBySlug("tron-whale");

    const result = await callTool();
    const sc = result.structuredContent as {
      activeTronPersona: string | null;
      activeEvmPersona: string | null;
      activeSolanaPersona: string | null;
    };
    expect(sc.activeTronPersona).toBe("tron-whale");
    expect(sc.activeEvmPersona).toBeNull();
    expect(sc.activeSolanaPersona).toBeNull();
  });

  it("response surfaces activeEvmPersona independently of TRON", async () => {
    process.env[DEMO_KEY] = "true";
    _resetDemoModeForTesting();
    setActivePersona("whale");

    const result = await callTool();
    const sc = result.structuredContent as {
      activeTronPersona: string | null;
      activeEvmPersona: string | null;
    };
    expect(sc.activeEvmPersona).toBe("whale");
    expect(sc.activeTronPersona).toBeNull();
  });

  it("response surfaces ALL THREE active personas when all are set (independence)", async () => {
    process.env[DEMO_KEY] = "true";
    _resetDemoModeForTesting();
    setActivePersona("whale");
    setActiveSolanaPersonaBySlug("solana-whale");
    setActiveTronPersonaBySlug("tron-whale");

    const result = await callTool();
    const sc = result.structuredContent as {
      activeEvmPersona: string | null;
      activeSolanaPersona: string | null;
      activeTronPersona: string | null;
    };
    expect(sc.activeEvmPersona).toBe("whale");
    expect(sc.activeSolanaPersona).toBe("solana-whale");
    expect(sc.activeTronPersona).toBe("tron-whale");
  });

  it("text block surfaces EVM, Solana, and TRON sections", async () => {
    const result = await callTool();
    const text = result.content[0]?.text ?? "";
    expect(text).toMatch(/DEMO WALLETS/);
    expect(text).toMatch(/EVM/);
    expect(text).toMatch(/Solana/);
    expect(text).toMatch(/TRON/);
    expect(text).toMatch(/tron-whale/);
  });

  it("evmPersonas + solanaPersonas arrays unchanged by TRON widening (no regression)", async () => {
    const result = await callTool();
    const sc = result.structuredContent as {
      evmPersonas: Array<{ slug: string; chain: string }>;
      solanaPersonas: Array<{ slug: string; chain: string }>;
    };
    expect(sc.evmPersonas.length).toBe(4);
    for (const p of sc.evmPersonas) expect(p.chain).toBe("ethereum");
    expect(sc.solanaPersonas.length).toBeGreaterThanOrEqual(1);
    for (const p of sc.solanaPersonas) expect(p.chain).toBe("solana");
  });

  it("legacy personas array (back-compat) stays at 4 EVM entries", async () => {
    const result = await callTool();
    const sc = result.structuredContent as {
      personas: Array<{ slug: string }>;
    };
    expect(sc.personas.length).toBe(4);
  });
});
