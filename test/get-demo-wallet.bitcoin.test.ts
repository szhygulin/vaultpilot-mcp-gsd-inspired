// Plan 22-04 — get_demo_wallet response widens to include BTC personas.

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { _resetDemoModeForTesting } from "../src/config/env.js";
import {
  _resetActivePersonaForTesting,
  setActiveBtcPersonaBySlug,
  setActivePersona,
  setActiveSolanaPersonaBySlug,
  setActiveTronPersonaBySlug,
} from "../src/demo/state.js";
import { BTC_PERSONAS } from "../src/demo/bitcoin-persona.js";
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

describe("get_demo_wallet — BTC persona surfacing (Plan 22-04)", () => {
  it("response includes btcPersonas array with at least 1 entry", async () => {
    const result = await callTool();
    const sc = result.structuredContent as {
      btcPersonas: Array<{
        chain: string;
        slug: string;
        btcSegwitAddress: string;
        btcTaprootAddress: string;
        description: string;
        rehearsableFlows: readonly string[];
      }>;
    };
    expect(sc.btcPersonas).toBeDefined();
    expect(sc.btcPersonas.length).toBeGreaterThanOrEqual(1);
  });

  it("btcPersonas entries surface bech32 segwit (bc1q) and bech32m taproot (bc1p) addresses", async () => {
    const result = await callTool();
    const sc = result.structuredContent as {
      btcPersonas: Array<{
        chain: string;
        slug: string;
        btcSegwitAddress: string;
        btcTaprootAddress: string;
      }>;
    };
    for (const p of sc.btcPersonas) {
      expect(p.chain).toBe("bitcoin");
      expect(p.btcSegwitAddress.startsWith("bc1q")).toBe(true);
      expect(p.btcTaprootAddress.startsWith("bc1p")).toBe(true);
    }
  });

  it("btcPersonas addresses are byte-identical to BTC_PERSONAS const (regression anchor)", async () => {
    const result = await callTool();
    const sc = result.structuredContent as {
      btcPersonas: Array<{
        slug: string;
        btcSegwitAddress: string;
        btcTaprootAddress: string;
      }>;
    };
    const byTool = new Map(
      sc.btcPersonas.map((p) => [
        p.slug,
        { segwit: p.btcSegwitAddress, taproot: p.btcTaprootAddress },
      ]),
    );
    const byConst = new Map(
      BTC_PERSONAS.map((p) => [
        p.slug,
        { segwit: p.btcSegwitAddress, taproot: p.btcTaprootAddress },
      ]),
    );
    for (const slug of byConst.keys()) {
      expect(byTool.get(slug)).toEqual(byConst.get(slug));
    }
  });

  it("response surfaces activeBtcPersona slug when set", async () => {
    process.env[DEMO_KEY] = "true";
    _resetDemoModeForTesting();
    setActiveBtcPersonaBySlug("btc-whale");

    const result = await callTool();
    const sc = result.structuredContent as {
      activeBtcPersona: string | null;
      activeEvmPersona: string | null;
      activeSolanaPersona: string | null;
      activeTronPersona: string | null;
    };
    expect(sc.activeBtcPersona).toBe("btc-whale");
    expect(sc.activeEvmPersona).toBeNull();
    expect(sc.activeSolanaPersona).toBeNull();
    expect(sc.activeTronPersona).toBeNull();
  });

  it("response surfaces ALL FOUR active personas when all are set (independence)", async () => {
    process.env[DEMO_KEY] = "true";
    _resetDemoModeForTesting();
    setActivePersona("whale");
    setActiveSolanaPersonaBySlug("solana-whale");
    setActiveTronPersonaBySlug("tron-whale");
    setActiveBtcPersonaBySlug("btc-whale");

    const result = await callTool();
    const sc = result.structuredContent as {
      activeEvmPersona: string | null;
      activeSolanaPersona: string | null;
      activeTronPersona: string | null;
      activeBtcPersona: string | null;
    };
    expect(sc.activeEvmPersona).toBe("whale");
    expect(sc.activeSolanaPersona).toBe("solana-whale");
    expect(sc.activeTronPersona).toBe("tron-whale");
    expect(sc.activeBtcPersona).toBe("btc-whale");
  });

  it("text block surfaces EVM, Solana, TRON, and BTC sections", async () => {
    const result = await callTool();
    const text = result.content[0]?.text ?? "";
    expect(text).toMatch(/DEMO WALLETS/);
    expect(text).toMatch(/EVM/);
    expect(text).toMatch(/Solana/);
    expect(text).toMatch(/TRON/);
    expect(text).toMatch(/BTC|Bitcoin/);
    expect(text).toMatch(/btc-whale/);
  });

  it("evmPersonas + solanaPersonas + tronPersonas arrays unchanged by BTC widening (no regression)", async () => {
    const result = await callTool();
    const sc = result.structuredContent as {
      evmPersonas: Array<{ slug: string; chain: string }>;
      solanaPersonas: Array<{ slug: string; chain: string }>;
      tronPersonas: Array<{ slug: string; chain: string }>;
    };
    expect(sc.evmPersonas.length).toBe(4);
    for (const p of sc.evmPersonas) expect(p.chain).toBe("ethereum");
    expect(sc.solanaPersonas.length).toBeGreaterThanOrEqual(1);
    for (const p of sc.solanaPersonas) expect(p.chain).toBe("solana");
    expect(sc.tronPersonas.length).toBeGreaterThanOrEqual(1);
    for (const p of sc.tronPersonas) expect(p.chain).toBe("tron");
  });

  it("legacy personas array (back-compat) stays at 4 EVM entries", async () => {
    const result = await callTool();
    const sc = result.structuredContent as {
      personas: Array<{ slug: string }>;
    };
    expect(sc.personas.length).toBe(4);
  });
});
