// src/tools/resolve_token.ts — Phase 8 — Plan 08-04 (READ-42).
//
// Curated-table lookup with NO RPC call. Tests mirror the
// `test/get-token-metadata.test.ts` tool-wrapper shape (no client mock
// needed; the tool is pure-data over `src/tokens/bridged-variants.ts`).
//
// Coverage:
//   - T-USDC-USDC.E anchor (Test 1 + Test 6 verbatim variantNote)
//   - chain-omitted DF-1 Option A (Test 2)
//   - unambiguous symbol returns single row (Test 3)
//   - unrecognized symbol → INVALID_INPUT (Test 4)
//   - JSON-schema enum gate on chain (Test 5)
//   - register-all wiring smoke (Test 7)
//   - chain field is canonical ChainName (Test 8)

import { describe, expect, it } from "vitest";

import { getRegisteredTool, type ToolHandlerResult } from "../src/tools/index.js";
import "../src/tools/register-all.js";

async function callTool(args: Record<string, unknown>): Promise<ToolHandlerResult> {
  const tool = getRegisteredTool("resolve_token");
  if (!tool) throw new Error("resolve_token not registered");
  return tool.handler(args);
}

interface ResolveTokenStructured {
  symbol: string;
  rows: Array<{
    canonicalSymbol: string;
    variantSymbol: string;
    address: string;
    chain: string;
    variant: "canonical" | "bridged";
    variantNote: string;
    originChain?: string;
  }>;
}

describe("resolve_token tool — Test 1 T-USDC-USDC.E anchor (HIGH)", () => {
  it("{ symbol: 'USDC', chain: 'polygon' } returns 2 rows (canonical + USDC.e bridged)", async () => {
    const result = await callTool({ symbol: "USDC", chain: "polygon" });
    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as unknown as ResolveTokenStructured;
    expect(sc.symbol).toBe("USDC");
    expect(sc.rows).toHaveLength(2);
    const variants = sc.rows.map((r) => r.variant).sort();
    expect(variants).toEqual(["bridged", "canonical"]);
    const bridged = sc.rows.find((r) => r.variant === "bridged");
    expect(bridged?.variantSymbol).toBe("USDC.e");
    expect(bridged?.originChain).toBe("ethereum");
    expect(bridged?.chain).toBe("polygon");
  });
});

describe("resolve_token tool — Test 2 chain-omitted (DF-1 Option A all-chains)", () => {
  it("{ symbol: 'USDC' } (chain omitted) returns rows for ALL chains", async () => {
    const result = await callTool({ symbol: "USDC" });
    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as unknown as ResolveTokenStructured;
    expect(sc.rows.length).toBeGreaterThanOrEqual(5);
    const chains = new Set(sc.rows.map((r) => r.chain));
    expect(chains.has("ethereum")).toBe(true);
    expect(chains.has("arbitrum")).toBe(true);
    expect(chains.has("polygon")).toBe(true);
    expect(chains.has("base")).toBe(true);
    expect(chains.has("optimism")).toBe(true);
  });
});

describe("resolve_token tool — Test 3 unambiguous symbol returns single row", () => {
  it("{ symbol: 'ARB', chain: 'arbitrum' } returns 1 row (no bridged variant)", async () => {
    const result = await callTool({ symbol: "ARB", chain: "arbitrum" });
    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as unknown as ResolveTokenStructured;
    expect(sc.rows).toHaveLength(1);
    expect(sc.rows[0]?.variant).toBe("canonical");
    expect(sc.rows[0]?.canonicalSymbol).toBe("ARB");
    expect(sc.rows[0]?.chain).toBe("arbitrum");
  });
});

describe("resolve_token tool — Test 4 unrecognized symbol → INVALID_INPUT", () => {
  it("{ symbol: 'FOO' } returns INVALID_INPUT with supported-symbol list in cause", async () => {
    const result = await callTool({ symbol: "FOO" });
    expect(result.isError).toBe(true);
    const sc = result.structuredContent as { errorCode: string; cause?: string };
    expect(sc.errorCode).toBe("INVALID_INPUT");
    expect(sc.cause).toMatch(/USDC/);
    expect(sc.cause).toMatch(/get_token_metadata/);
  });

  it("empty symbol returns INVALID_INPUT", async () => {
    const result = await callTool({ symbol: "" });
    expect(result.isError).toBe(true);
    const sc = result.structuredContent as { errorCode: string };
    expect(sc.errorCode).toBe("INVALID_INPUT");
  });

  it("missing symbol returns INVALID_INPUT (handler-level guard)", async () => {
    // The schema gate normally rejects at the dispatcher; this asserts the
    // in-handler defense fires if the dispatcher were bypassed.
    const result = await callTool({});
    expect(result.isError).toBe(true);
  });
});

describe("resolve_token tool — Test 5 JSON-schema enum gate inheritance (Plan 08-02)", () => {
  it("INPUT_SCHEMA chain enum lists exactly the 5 supported chains", () => {
    const tool = getRegisteredTool("resolve_token");
    expect(tool).toBeDefined();
    const schema = tool!.inputSchema as {
      properties: { chain: { enum: string[] } };
      required: string[];
    };
    expect(schema.properties.chain.enum).toEqual([
      "ethereum",
      "arbitrum",
      "polygon",
      "base",
      "optimism",
    ]);
  });

  it("INPUT_SCHEMA does NOT require chain (chain is OPTIONAL per DF-1 Option A)", () => {
    const tool = getRegisteredTool("resolve_token");
    const schema = tool!.inputSchema as { required: string[] };
    expect(schema.required).toEqual(["symbol"]);
    expect(schema.required).not.toContain("chain");
  });
});

describe("resolve_token tool — Test 6 T-USDC-USDC.E verbatim variantNote text", () => {
  it("Polygon USDC canonical variantNote names Circle-native", async () => {
    const result = await callTool({ symbol: "USDC", chain: "polygon" });
    const sc = result.structuredContent as unknown as ResolveTokenStructured;
    const canonical = sc.rows.find((r) => r.variant === "canonical");
    expect(canonical?.variantNote).toContain("Circle-native USDC on Polygon");
    expect(canonical?.variantNote).toContain("Attested by Circle directly");
  });

  it("Polygon USDC.e bridged variantNote names the bridge mechanism + originChain", async () => {
    const result = await callTool({ symbol: "USDC", chain: "polygon" });
    const sc = result.structuredContent as unknown as ResolveTokenStructured;
    const bridged = sc.rows.find((r) => r.variant === "bridged");
    expect(bridged?.variantNote).toContain("Bridged USDC via Polygon PoS bridge from Ethereum");
    expect(bridged?.variantNote).toContain("NOT Circle-attested directly");
  });
});

describe("register-all.ts wiring — resolve_token registered", () => {
  it("Test 7 — getRegisteredTool('resolve_token') is defined after register-all import", () => {
    const tool = getRegisteredTool("resolve_token");
    expect(tool).toBeDefined();
    expect(tool?.name).toBe("resolve_token");
    expect((tool?.description.length ?? 0) >= 100).toBe(true);
  });
});

describe("resolve_token tool — Test 8 chain field is canonical ChainName slug", () => {
  it("response chain field uses chainNameFromId resolution (not numeric chainId)", async () => {
    const result = await callTool({ symbol: "USDC" });
    const sc = result.structuredContent as unknown as ResolveTokenStructured;
    for (const row of sc.rows) {
      expect(["ethereum", "arbitrum", "polygon", "base", "optimism"]).toContain(row.chain);
    }
  });
});
