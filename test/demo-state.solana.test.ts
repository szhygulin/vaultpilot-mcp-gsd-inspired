// Plan 11-06 — active Solana persona state mutation + independence from
// EVM active persona.

import { beforeEach, describe, expect, it } from "vitest";

import {
  _resetActivePersonaForTesting,
  getActivePersona,
  getActiveSolanaPersona,
  setActivePersona,
  setActiveSolanaPersona,
  setActiveSolanaPersonaBySlug,
} from "../src/demo/state.js";
import { SOLANA_PERSONAS } from "../src/demo/solana-persona.js";

beforeEach(() => {
  _resetActivePersonaForTesting();
});

describe("activeSolanaPersona mutation (Plan 11-06)", () => {
  it("getActiveSolanaPersona() returns null before any setter call", () => {
    expect(getActiveSolanaPersona()).toBeNull();
  });

  it("setActiveSolanaPersonaBySlug('solana-whale') activates the persona", () => {
    const returned = setActiveSolanaPersonaBySlug("solana-whale");
    const active = getActiveSolanaPersona();
    expect(active).not.toBeNull();
    expect(active?.slug).toBe("solana-whale");
    expect(active?.solanaAddress).toBe(returned.solanaAddress);
  });

  it("setActiveSolanaPersonaBySlug is idempotent for the single v2.0 persona", () => {
    setActiveSolanaPersonaBySlug("solana-whale");
    const first = getActiveSolanaPersona();
    setActiveSolanaPersonaBySlug("solana-whale");
    const second = getActiveSolanaPersona();
    expect(first?.solanaAddress).toBe(second?.solanaAddress);
    expect(first?.slug).toBe(second?.slug);
  });

  it("setActiveSolanaPersonaBySlug with unknown slug throws (defense-in-depth behind schema enum)", () => {
    expect(() => setActiveSolanaPersonaBySlug("unknown-slug")).toThrow(
      /unknown Solana persona/,
    );
    expect(getActiveSolanaPersona()).toBeNull();
  });

  it("setActiveSolanaPersona(persona) accepts a registry entry directly", () => {
    const persona = SOLANA_PERSONAS[0]!;
    setActiveSolanaPersona(persona);
    expect(getActiveSolanaPersona()?.solanaAddress).toBe(persona.solanaAddress);
  });
});

describe("EVM + Solana persona independence (Plan 11-06)", () => {
  it("setting Solana persona does NOT affect getActivePersona() (EVM)", () => {
    expect(getActivePersona()).toBeNull();
    setActiveSolanaPersonaBySlug("solana-whale");
    expect(getActivePersona()).toBeNull(); // EVM still null
    expect(getActiveSolanaPersona()).not.toBeNull(); // Solana set
  });

  it("setting EVM persona does NOT affect getActiveSolanaPersona()", () => {
    expect(getActiveSolanaPersona()).toBeNull();
    setActivePersona("whale");
    expect(getActiveSolanaPersona()).toBeNull(); // Solana still null
    expect(getActivePersona()).not.toBeNull(); // EVM set
  });

  it("both can be active simultaneously", () => {
    setActivePersona("whale");
    setActiveSolanaPersonaBySlug("solana-whale");
    expect(getActivePersona()?.slug).toBe("whale");
    expect(getActiveSolanaPersona()?.slug).toBe("solana-whale");
  });

  it("_resetActivePersonaForTesting clears BOTH active personas", () => {
    setActivePersona("whale");
    setActiveSolanaPersonaBySlug("solana-whale");
    _resetActivePersonaForTesting();
    expect(getActivePersona()).toBeNull();
    expect(getActiveSolanaPersona()).toBeNull();
  });
});
