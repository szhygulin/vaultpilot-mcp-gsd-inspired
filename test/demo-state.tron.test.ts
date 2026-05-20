// Plan 17-05 — active TRON persona state mutation + independence from
// EVM and Solana active personas.

import { beforeEach, describe, expect, it } from "vitest";

import {
  _resetActivePersonaForTesting,
  getActivePersona,
  getActiveSolanaPersona,
  getActiveTronPersona,
  setActivePersona,
  setActiveSolanaPersonaBySlug,
  setActiveTronPersona,
  setActiveTronPersonaBySlug,
} from "../src/demo/state.js";
import { TRON_PERSONAS } from "../src/demo/tron-persona.js";

beforeEach(() => {
  _resetActivePersonaForTesting();
});

describe("activeTronPersona mutation (Plan 17-05)", () => {
  it("getActiveTronPersona() returns null before any setter call", () => {
    expect(getActiveTronPersona()).toBeNull();
  });

  it("setActiveTronPersonaBySlug('tron-whale') activates the persona", () => {
    const returned = setActiveTronPersonaBySlug("tron-whale");
    const active = getActiveTronPersona();
    expect(active).not.toBeNull();
    expect(active?.slug).toBe("tron-whale");
    expect(active?.tronAddress).toBe(returned.tronAddress);
  });

  it("setActiveTronPersonaBySlug is idempotent for the single v2.1 persona", () => {
    setActiveTronPersonaBySlug("tron-whale");
    const first = getActiveTronPersona();
    setActiveTronPersonaBySlug("tron-whale");
    const second = getActiveTronPersona();
    expect(first?.tronAddress).toBe(second?.tronAddress);
    expect(first?.slug).toBe(second?.slug);
  });

  it("setActiveTronPersonaBySlug with unknown slug throws (defense-in-depth behind schema enum)", () => {
    expect(() => setActiveTronPersonaBySlug("unknown-slug")).toThrow(
      /unknown TRON persona/,
    );
    expect(getActiveTronPersona()).toBeNull();
  });

  it("setActiveTronPersona(persona) accepts a registry entry directly", () => {
    const persona = TRON_PERSONAS[0]!;
    setActiveTronPersona(persona);
    expect(getActiveTronPersona()?.tronAddress).toBe(persona.tronAddress);
  });

  it("setActiveTronPersona rejects a value missing tronAddress (defense-in-depth)", () => {
    expect(() =>
      setActiveTronPersona({ slug: "x" } as unknown as typeof TRON_PERSONAS[number]),
    ).toThrow(/tronAddress/);
    expect(getActiveTronPersona()).toBeNull();
  });
});

describe("EVM + Solana + TRON persona independence (Plan 17-05)", () => {
  it("setting TRON persona does NOT affect getActivePersona() (EVM) or getActiveSolanaPersona()", () => {
    expect(getActivePersona()).toBeNull();
    expect(getActiveSolanaPersona()).toBeNull();
    setActiveTronPersonaBySlug("tron-whale");
    expect(getActivePersona()).toBeNull(); // EVM still null
    expect(getActiveSolanaPersona()).toBeNull(); // Solana still null
    expect(getActiveTronPersona()).not.toBeNull(); // TRON set
  });

  it("setting EVM persona does NOT affect getActiveTronPersona()", () => {
    expect(getActiveTronPersona()).toBeNull();
    setActivePersona("whale");
    expect(getActiveTronPersona()).toBeNull(); // TRON still null
    expect(getActivePersona()).not.toBeNull(); // EVM set
  });

  it("setting Solana persona does NOT affect getActiveTronPersona()", () => {
    expect(getActiveTronPersona()).toBeNull();
    setActiveSolanaPersonaBySlug("solana-whale");
    expect(getActiveTronPersona()).toBeNull(); // TRON still null
    expect(getActiveSolanaPersona()).not.toBeNull(); // Solana set
  });

  it("all three can be active simultaneously", () => {
    setActivePersona("whale");
    setActiveSolanaPersonaBySlug("solana-whale");
    setActiveTronPersonaBySlug("tron-whale");
    expect(getActivePersona()?.slug).toBe("whale");
    expect(getActiveSolanaPersona()?.slug).toBe("solana-whale");
    expect(getActiveTronPersona()?.slug).toBe("tron-whale");
  });

  it("_resetActivePersonaForTesting clears ALL THREE active personas", () => {
    setActivePersona("whale");
    setActiveSolanaPersonaBySlug("solana-whale");
    setActiveTronPersonaBySlug("tron-whale");
    _resetActivePersonaForTesting();
    expect(getActivePersona()).toBeNull();
    expect(getActiveSolanaPersona()).toBeNull();
    expect(getActiveTronPersona()).toBeNull();
  });
});
