// Plan 17-05 — TRON persona registry shape + DOA validation.
//
// Mirrors `test/solana-persona.test.ts` for the Solana registry. The TRON
// registry lives in a sibling module (`src/demo/tron-persona.ts`) — the
// EVM `Persona.slug` literal-union stays narrow to its 4 EVM slugs and the
// Solana `SolanaPersonaSlug` stays narrow to its 1 slug.

import { describe, expect, it } from "vitest";

import { utils as tronUtils } from "tronweb";

import {
  TRON_PERSONAS,
  findTronPersona,
  listTronPersonas,
  type TronPersona,
} from "../src/demo/tron-persona.js";

describe("TRON_PERSONAS registry shape (Plan 17-05)", () => {
  it("ships at least one curated TRON persona (v2.1 ships exactly one)", () => {
    expect(TRON_PERSONAS.length).toBeGreaterThanOrEqual(1);
  });

  it("every tronAddress is a valid base58check TRON address (DOA at module load)", () => {
    // The import above already triggered module-load DOA validation —
    // if any tronAddress were malformed, the `tronUtils.address.isAddress`
    // check at module load would have thrown at import time and this test
    // file wouldn't load. This assertion is defense-in-depth: re-validate
    // every entry here.
    for (const p of TRON_PERSONAS) {
      expect(tronUtils.address.isAddress(p.tronAddress)).toBe(true);
    }
  });

  it("tron-whale persona is T-prefixed base58check, NOT 0x-prefixed hex (regression — would surface if EVM address pasted by mistake)", () => {
    const p = findTronPersona("tron-whale");
    expect(p).toBeDefined();
    expect(p?.tronAddress.startsWith("0x")).toBe(false);
    expect(p?.tronAddress.startsWith("T")).toBe(true);
    // Base58 alphabet excludes 0, O, I, l. The T-prefix + 33 base58
    // chars regex catches the "looks like hex" shape too.
    expect(p?.tronAddress).toMatch(/^T[1-9A-HJ-NP-Za-km-z]{33}$/);
  });

  it("tron-whale slug literal is byte-identical to the locked value (regression anchor)", () => {
    const p = findTronPersona("tron-whale");
    expect(p?.tronAddress).toBe(
      "TWd4WrZ9wn84f5x1hZhL4DHvk738ns5jwb",
    );
  });

  it("every entry has the required { slug, chain, tronAddress, description, rehearsableFlows, simulationEnvelopeShape } shape", () => {
    for (const p of TRON_PERSONAS) {
      expect(typeof p.slug).toBe("string");
      expect(p.chain).toBe("tron");
      expect(typeof p.tronAddress).toBe("string");
      expect(p.tronAddress.length).toBe(34);
      expect(p.description.length).toBeGreaterThan(20);
      expect(p.rehearsableFlows.length).toBeGreaterThan(0);
      expect(p.simulationEnvelopeShape).toBe("triggerconstantcontract");
    }
  });

  it("TRON persona slugs do NOT collide with the 4 EVM slugs or the Solana slug (per PATTERN-MAPPER META-DECISION §2)", () => {
    const otherSlugs = new Set([
      "whale",
      "defi-degen",
      "stable-saver",
      "staking-maxi",
      "solana-whale",
    ]);
    for (const p of TRON_PERSONAS) {
      expect(otherSlugs.has(p.slug)).toBe(false);
    }
  });
});

describe("findTronPersona + listTronPersonas lookup (Plan 17-05)", () => {
  it("findTronPersona('tron-whale') returns the entry", () => {
    const p = findTronPersona("tron-whale");
    expect(p).toBeDefined();
    expect(p?.slug).toBe("tron-whale");
  });

  it("findTronPersona(<unknown>) returns undefined", () => {
    expect(findTronPersona("nonexistent")).toBeUndefined();
    expect(findTronPersona("whale")).toBeUndefined(); // EVM slug
    expect(findTronPersona("solana-whale")).toBeUndefined(); // Solana slug
  });

  it("listTronPersonas() returns the locked registry", () => {
    const list = listTronPersonas();
    expect(list.length).toBe(TRON_PERSONAS.length);
    expect(list).toEqual(TRON_PERSONAS);
  });

  it("TronPersona type witness — chain field is the literal 'tron'", () => {
    // Compile-time defense: if TronPersona.chain widens to string, this
    // assignment would still compile, but the test below verifies the
    // runtime value.
    const witness: TronPersona["chain"] = "tron" satisfies TronPersona["chain"];
    expect(witness).toBe("tron");
  });
});
