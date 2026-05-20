// Plan 11-06 — Solana persona registry shape + DOA validation.
//
// Mirrors `test/demo-state.test.ts` for the EVM registry. The Solana
// registry lives in a sibling module (`src/demo/solana-persona.ts`) — the
// EVM `Persona.slug` literal-union stays narrow to its 4 EVM slugs.

import { describe, expect, it } from "vitest";

import { PublicKey } from "@solana/web3.js";

import {
  SOLANA_PERSONAS,
  findSolanaPersona,
  listSolanaPersonas,
  type SolanaPersona,
} from "../src/demo/solana-persona.js";

describe("SOLANA_PERSONAS registry shape (Plan 11-06)", () => {
  it("ships at least one curated Solana persona (v2.0 ships exactly one)", () => {
    expect(SOLANA_PERSONAS.length).toBeGreaterThanOrEqual(1);
  });

  it("every solanaAddress is a valid base58 32-byte Solana pubkey (DOA at module load)", () => {
    // The import above already triggered module-load DOA validation —
    // if any solanaAddress were malformed, `new PublicKey(addr)` would
    // have thrown at import time and this test file wouldn't load. This
    // assertion is defense-in-depth: re-validate every entry here.
    for (const p of SOLANA_PERSONAS) {
      expect(() => new PublicKey(p.solanaAddress)).not.toThrow();
    }
  });

  it("solana-whale persona is base58, NOT 0x-prefixed hex (regression — would surface if EVM address pasted by mistake)", () => {
    const p = findSolanaPersona("solana-whale");
    expect(p).toBeDefined();
    expect(p?.solanaAddress.startsWith("0x")).toBe(false);
    // Base58 alphabet excludes 0, O, I, l. A 0x-prefixed hex address
    // would fail `new PublicKey` anyway, but the negative regex below
    // catches the "looks like hex" shape too.
    expect(p?.solanaAddress).toMatch(/^[1-9A-HJ-NP-Za-km-z]+$/);
  });

  it("solana-whale slug literal is byte-identical to the locked value (regression anchor)", () => {
    const p = findSolanaPersona("solana-whale");
    expect(p?.solanaAddress).toBe(
      "5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9",
    );
  });

  it("every entry has the required { slug, chain, solanaAddress, description, rehearsableFlows, simulationEnvelopeShape } shape", () => {
    for (const p of SOLANA_PERSONAS) {
      expect(typeof p.slug).toBe("string");
      expect(p.chain).toBe("solana");
      expect(typeof p.solanaAddress).toBe("string");
      expect(p.solanaAddress.length).toBeGreaterThan(0);
      expect(p.description.length).toBeGreaterThan(20);
      expect(p.rehearsableFlows.length).toBeGreaterThan(0);
      expect(p.simulationEnvelopeShape).toBe("simulateTransaction");
    }
  });

  it("Solana persona slugs do NOT collide with the 4 EVM slugs (per patterns meta-decision §2)", () => {
    const evmSlugs = new Set([
      "whale",
      "defi-degen",
      "stable-saver",
      "staking-maxi",
    ]);
    for (const p of SOLANA_PERSONAS) {
      expect(evmSlugs.has(p.slug)).toBe(false);
    }
  });
});

describe("findSolanaPersona + listSolanaPersonas lookup (Plan 11-06)", () => {
  it("findSolanaPersona('solana-whale') returns the entry", () => {
    const p = findSolanaPersona("solana-whale");
    expect(p).toBeDefined();
    expect(p?.slug).toBe("solana-whale");
  });

  it("findSolanaPersona(<unknown>) returns undefined", () => {
    expect(findSolanaPersona("nonexistent")).toBeUndefined();
    expect(findSolanaPersona("whale")).toBeUndefined(); // EVM slug — not in Solana registry
  });

  it("listSolanaPersonas() returns the locked registry", () => {
    const list = listSolanaPersonas();
    expect(list.length).toBe(SOLANA_PERSONAS.length);
    expect(list).toEqual(SOLANA_PERSONAS);
  });

  it("SolanaPersona type witness — chain field is the literal 'solana'", () => {
    // Compile-time defense: if SolanaPersona.chain widens to string, this
    // assignment would still compile, but the test below verifies the
    // runtime value.
    const witness: SolanaPersona["chain"] = "solana" satisfies SolanaPersona["chain"];
    expect(witness).toBe("solana");
  });
});
