// Plan 05-01 — persona registry shape + active-persona mutation semantics.
//
// T-PERSONA-ADDR-1 regression anchor: tests 1-2 assert each persona's
// `.address` is byte-identical to the locked EIP-55 literal here. A future
// contributor that swaps an address breaks the assertion; viem's getAddress
// would also throw at module load if any literal's checksum is invalid.

import { beforeEach, describe, expect, it } from "vitest";

import { PERSONAS } from "../src/demo/personas.js";
import {
  _resetActivePersonaForTesting,
  getActivePersona,
  setActivePersona,
} from "../src/demo/state.js";

beforeEach(() => {
  _resetActivePersonaForTesting();
});

describe("PERSONAS registry shape (DEMO-03)", () => {
  it("Test 1 — exactly 4 personas with the locked slug set", () => {
    expect(PERSONAS.length).toBe(4);
    const slugs = PERSONAS.map((p) => p.slug).sort();
    expect(slugs).toEqual(
      ["defi-degen", "stable-saver", "staking-maxi", "whale"].sort(),
    );
  });

  it("Test 2 — each persona's address is EIP-55 byte-identical to the locked literal (T-PERSONA-ADDR-1)", () => {
    // Regression anchor. A future contributor that swaps an address
    // breaks this assertion. Locked literals from
    // .planning/phases/05-demo-mode-diagnostics/05-RESEARCH.md § Persona Picks.
    const byAddress = new Map(PERSONAS.map((p) => [p.slug, p.address]));
    expect(byAddress.get("whale")).toBe("0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045");
    expect(byAddress.get("stable-saver")).toBe(
      "0x55FE002aefF02F77364de339a1292923A15844B8",
    );
    expect(byAddress.get("defi-degen")).toBe(
      "0x47ac0Fb4F2D84898e4D9E7b4DaB3C24507a6D503",
    );
    expect(byAddress.get("staking-maxi")).toBe(
      "0xBE0eB53F46cd790Cd13851d5EFf43D12404d33E8",
    );
  });

  it("each persona has description + rehearsableFlows", () => {
    for (const p of PERSONAS) {
      expect(p.description.length).toBeGreaterThan(20);
      expect(p.rehearsableFlows.length).toBeGreaterThan(0);
    }
  });
});

describe("activePersona mutation (DEMO-04)", () => {
  it("Test 3 — getActivePersona() returns null before any setter call", () => {
    expect(getActivePersona()).toBeNull();
  });

  it("Test 4 — setActivePersona('whale') → getActivePersona returns whale", () => {
    const returned = setActivePersona("whale");
    const active = getActivePersona();
    expect(active).not.toBeNull();
    expect(active?.slug).toBe("whale");
    expect(active?.address).toBe(returned.address);
  });

  it("Test 5 — setActivePersona with unknown slug throws (defense-in-depth behind schema enum)", () => {
    // Cast bypasses TS narrowing — the runtime check is what's under test.
    expect(() => setActivePersona("unknown-slug" as unknown as "whale")).toThrow(
      /unknown persona/,
    );
    // State must be unchanged after the throw.
    expect(getActivePersona()).toBeNull();
  });

  it("Test 6 — _resetActivePersonaForTesting() restores null state (T-NO-PERSIST-1)", () => {
    setActivePersona("defi-degen");
    expect(getActivePersona()?.slug).toBe("defi-degen");
    _resetActivePersonaForTesting();
    expect(getActivePersona()).toBeNull();
  });
});
