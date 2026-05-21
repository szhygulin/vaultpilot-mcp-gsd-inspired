// Plan 22-04 — active BTC persona state mutation + independence from
// EVM, Solana, and TRON active personas.

import { beforeEach, describe, expect, it } from "vitest";

import {
  _resetActivePersonaForTesting,
  getActiveBtcPersona,
  getActivePersona,
  getActiveSolanaPersona,
  getActiveTronPersona,
  setActiveBtcPersona,
  setActiveBtcPersonaBySlug,
  setActivePersona,
  setActiveSolanaPersonaBySlug,
  setActiveTronPersonaBySlug,
} from "../src/demo/state.js";
import { BTC_PERSONAS } from "../src/demo/bitcoin-persona.js";

beforeEach(() => {
  _resetActivePersonaForTesting();
});

describe("activeBtcPersona mutation (Plan 22-04)", () => {
  it("getActiveBtcPersona() returns null before any setter call", () => {
    expect(getActiveBtcPersona()).toBeNull();
  });

  it("setActiveBtcPersonaBySlug('btc-whale') activates the persona", () => {
    const returned = setActiveBtcPersonaBySlug("btc-whale");
    const active = getActiveBtcPersona();
    expect(active).not.toBeNull();
    expect(active?.slug).toBe("btc-whale");
    expect(active?.btcSegwitAddress).toBe(returned.btcSegwitAddress);
    expect(active?.btcTaprootAddress).toBe(returned.btcTaprootAddress);
  });

  it("setActiveBtcPersonaBySlug is idempotent for the single v2.2 persona", () => {
    setActiveBtcPersonaBySlug("btc-whale");
    const first = getActiveBtcPersona();
    setActiveBtcPersonaBySlug("btc-whale");
    const second = getActiveBtcPersona();
    expect(first?.btcSegwitAddress).toBe(second?.btcSegwitAddress);
    expect(first?.btcTaprootAddress).toBe(second?.btcTaprootAddress);
    expect(first?.slug).toBe(second?.slug);
  });

  it("setActiveBtcPersonaBySlug with unknown slug throws (defense-in-depth behind schema enum)", () => {
    expect(() => setActiveBtcPersonaBySlug("unknown-slug")).toThrow(
      /unknown BTC persona/,
    );
    expect(getActiveBtcPersona()).toBeNull();
  });

  it("setActiveBtcPersona(persona) accepts a registry entry directly", () => {
    const persona = BTC_PERSONAS[0]!;
    setActiveBtcPersona(persona);
    expect(getActiveBtcPersona()?.btcSegwitAddress).toBe(
      persona.btcSegwitAddress,
    );
    expect(getActiveBtcPersona()?.btcTaprootAddress).toBe(
      persona.btcTaprootAddress,
    );
  });

  it("setActiveBtcPersona rejects a value missing btcSegwitAddress (defense-in-depth)", () => {
    expect(() =>
      setActiveBtcPersona({
        slug: "x",
        btcTaprootAddress: "bc1p0xlxvlhemja6c4dqv22uapctqupfhlxm9h8z3k2e72q4k9hcz7vqzk5jj0",
      } as unknown as typeof BTC_PERSONAS[number]),
    ).toThrow(/btcSegwitAddress/);
    expect(getActiveBtcPersona()).toBeNull();
  });

  it("setActiveBtcPersona rejects a value missing btcTaprootAddress (defense-in-depth)", () => {
    expect(() =>
      setActiveBtcPersona({
        slug: "x",
        btcSegwitAddress: "bc1qm34lsc65zpw79lxes69zkqmk6ee3ewf0j77s3h",
      } as unknown as typeof BTC_PERSONAS[number]),
    ).toThrow(/btcTaprootAddress/);
    expect(getActiveBtcPersona()).toBeNull();
  });
});

describe("EVM + Solana + TRON + BTC persona independence (Plan 22-04)", () => {
  it("setting BTC persona does NOT affect EVM / Solana / TRON active personas", () => {
    expect(getActivePersona()).toBeNull();
    expect(getActiveSolanaPersona()).toBeNull();
    expect(getActiveTronPersona()).toBeNull();
    setActiveBtcPersonaBySlug("btc-whale");
    expect(getActivePersona()).toBeNull();
    expect(getActiveSolanaPersona()).toBeNull();
    expect(getActiveTronPersona()).toBeNull();
    expect(getActiveBtcPersona()).not.toBeNull();
  });

  it("setting EVM persona does NOT affect getActiveBtcPersona()", () => {
    expect(getActiveBtcPersona()).toBeNull();
    setActivePersona("whale");
    expect(getActiveBtcPersona()).toBeNull();
    expect(getActivePersona()).not.toBeNull();
  });

  it("setting Solana persona does NOT affect getActiveBtcPersona()", () => {
    expect(getActiveBtcPersona()).toBeNull();
    setActiveSolanaPersonaBySlug("solana-whale");
    expect(getActiveBtcPersona()).toBeNull();
    expect(getActiveSolanaPersona()).not.toBeNull();
  });

  it("setting TRON persona does NOT affect getActiveBtcPersona()", () => {
    expect(getActiveBtcPersona()).toBeNull();
    setActiveTronPersonaBySlug("tron-whale");
    expect(getActiveBtcPersona()).toBeNull();
    expect(getActiveTronPersona()).not.toBeNull();
  });

  it("all four can be active simultaneously", () => {
    setActivePersona("whale");
    setActiveSolanaPersonaBySlug("solana-whale");
    setActiveTronPersonaBySlug("tron-whale");
    setActiveBtcPersonaBySlug("btc-whale");
    expect(getActivePersona()?.slug).toBe("whale");
    expect(getActiveSolanaPersona()?.slug).toBe("solana-whale");
    expect(getActiveTronPersona()?.slug).toBe("tron-whale");
    expect(getActiveBtcPersona()?.slug).toBe("btc-whale");
  });

  it("_resetActivePersonaForTesting clears ALL FOUR active personas", () => {
    setActivePersona("whale");
    setActiveSolanaPersonaBySlug("solana-whale");
    setActiveTronPersonaBySlug("tron-whale");
    setActiveBtcPersonaBySlug("btc-whale");
    _resetActivePersonaForTesting();
    expect(getActivePersona()).toBeNull();
    expect(getActiveSolanaPersona()).toBeNull();
    expect(getActiveTronPersona()).toBeNull();
    expect(getActiveBtcPersona()).toBeNull();
  });
});
