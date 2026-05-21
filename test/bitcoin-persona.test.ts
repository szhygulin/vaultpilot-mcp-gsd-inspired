// Plan 22-04 — BTC persona registry shape + DOA validation.
//
// Mirrors `test/tron-persona.test.ts` for the TRON registry. The BTC
// registry lives in a sibling module (`src/demo/bitcoin-persona.ts`) — the
// EVM `Persona.slug` literal-union stays narrow to its 4 EVM slugs, the
// Solana `SolanaPersonaSlug` stays narrow to its 1 slug, and the TRON
// `TronPersonaSlug` stays narrow to its 1 slug. BTC carves its own
// `BtcPersonaSlug` literal-union here.

import { describe, expect, it } from "vitest";

import { address as btcAddress, networks } from "bitcoinjs-lib";

import {
  BTC_PERSONAS,
  findBtcPersona,
  listBtcPersonas,
  type BtcPersona,
} from "../src/demo/bitcoin-persona.js";

describe("BTC_PERSONAS registry shape (Plan 22-04)", () => {
  it("ships at least one curated BTC persona (v2.2 ships exactly one)", () => {
    expect(BTC_PERSONAS.length).toBeGreaterThanOrEqual(1);
  });

  it("every btcSegwitAddress passes bitcoinjs-lib.address.toOutputScript on networks.bitcoin (DOA at module load)", () => {
    // The import above already triggered module-load DOA validation —
    // if any address were malformed, the toOutputScript check at module
    // load would have thrown at import time and this file wouldn't load.
    // Defense-in-depth: re-validate every entry here.
    for (const p of BTC_PERSONAS) {
      expect(() =>
        btcAddress.toOutputScript(p.btcSegwitAddress, networks.bitcoin),
      ).not.toThrow();
    }
  });

  it("every btcTaprootAddress passes bitcoinjs-lib.address.toOutputScript on networks.bitcoin (DOA at module load)", () => {
    for (const p of BTC_PERSONAS) {
      expect(() =>
        btcAddress.toOutputScript(p.btcTaprootAddress, networks.bitcoin),
      ).not.toThrow();
    }
  });

  it("btc-whale persona's btcSegwitAddress is bech32 P2WPKH (bc1q prefix, 42 chars)", () => {
    const p = findBtcPersona("btc-whale");
    expect(p).toBeDefined();
    expect(p?.btcSegwitAddress.startsWith("bc1q")).toBe(true);
    expect(p?.btcSegwitAddress.length).toBe(42);
  });

  it("btc-whale persona's btcTaprootAddress is bech32m P2TR (bc1p prefix, 62 chars)", () => {
    const p = findBtcPersona("btc-whale");
    expect(p).toBeDefined();
    expect(p?.btcTaprootAddress.startsWith("bc1p")).toBe(true);
    expect(p?.btcTaprootAddress.length).toBe(62);
  });

  it("btc-whale slug literals are byte-identical to the locked values (regression anchor)", () => {
    const p = findBtcPersona("btc-whale");
    // Locked at write-time after OFAC-clean verification ritual
    // (see src/demo/bitcoin-persona.ts header comment for ritual record).
    expect(p?.btcSegwitAddress).toBe(
      "bc1qm34lsc65zpw79lxes69zkqmk6ee3ewf0j77s3h",
    );
    expect(p?.btcTaprootAddress).toBe(
      "bc1p0xlxvlhemja6c4dqv22uapctqupfhlxm9h8z3k2e72q4k9hcz7vqzk5jj0",
    );
  });

  it("every entry has the required { slug, chain, btcSegwitAddress, btcTaprootAddress, description, rehearsableFlows, simulationEnvelopeShape } shape", () => {
    for (const p of BTC_PERSONAS) {
      expect(typeof p.slug).toBe("string");
      expect(p.chain).toBe("bitcoin");
      expect(typeof p.btcSegwitAddress).toBe("string");
      expect(typeof p.btcTaprootAddress).toBe("string");
      expect(p.description.length).toBeGreaterThan(20);
      expect(p.rehearsableFlows.length).toBeGreaterThan(0);
      // Phase 23 anchor — typed but not consumed in Phase 22.
      expect(p.simulationEnvelopeShape).toBe("psbt-mempool-replay");
    }
  });

  it("BTC persona slugs do NOT collide with the 4 EVM, the Solana, or the TRON slugs (per PATTERN-MAPPER META-DECISION §2)", () => {
    const otherSlugs = new Set([
      "whale",
      "defi-degen",
      "stable-saver",
      "staking-maxi",
      "solana-whale",
      "tron-whale",
    ]);
    for (const p of BTC_PERSONAS) {
      expect(otherSlugs.has(p.slug)).toBe(false);
    }
  });

  it("source file embeds the OFAC-clean verification ritual comment block (verified date + source identity)", async () => {
    // Read the source so a comment-block deletion would fail this test.
    const fs = await import("node:fs");
    const url = new URL("../src/demo/bitcoin-persona.ts", import.meta.url);
    const src = fs.readFileSync(url, "utf8");
    expect(src).toMatch(/OFAC/i);
    expect(src).toMatch(/verified|verification/i);
    // The header ritual block names mempool.space + 0xB10C registry.
    expect(src).toMatch(/mempool\.space/);
    expect(src).toMatch(/0xB10C/);
  });
});

describe("findBtcPersona + listBtcPersonas lookup (Plan 22-04)", () => {
  it("findBtcPersona('btc-whale') returns the entry", () => {
    const p = findBtcPersona("btc-whale");
    expect(p).toBeDefined();
    expect(p?.slug).toBe("btc-whale");
  });

  it("findBtcPersona(<unknown>) returns undefined", () => {
    expect(findBtcPersona("nonexistent")).toBeUndefined();
    expect(findBtcPersona("whale")).toBeUndefined(); // EVM slug
    expect(findBtcPersona("solana-whale")).toBeUndefined(); // Solana slug
    expect(findBtcPersona("tron-whale")).toBeUndefined(); // TRON slug
  });

  it("listBtcPersonas() returns the locked registry", () => {
    const list = listBtcPersonas();
    expect(list.length).toBe(BTC_PERSONAS.length);
    expect(list).toEqual(BTC_PERSONAS);
  });

  it("BtcPersona type witness — chain field is the literal 'bitcoin'", () => {
    const witness: BtcPersona["chain"] = "bitcoin" satisfies BtcPersona["chain"];
    expect(witness).toBe("bitcoin");
  });
});

describe("Module-load DOA fail-fast on tampered fixtures (Plan 22-04)", () => {
  it("a tampered segwit address fails address.toOutputScript on networks.bitcoin", () => {
    // Direct check that the validation gate would catch tampered input —
    // we re-run the gate on a deliberately-corrupted address.
    expect(() =>
      btcAddress.toOutputScript(
        // Flip the last char to corrupt the bech32 checksum.
        "bc1qm34lsc65zpw79lxes69zkqmk6ee3ewf0j77s3z",
        networks.bitcoin,
      ),
    ).toThrow();
  });

  it("a tampered taproot address fails address.toOutputScript on networks.bitcoin", () => {
    expect(() =>
      btcAddress.toOutputScript(
        // Flip the last char to corrupt the bech32m checksum.
        "bc1p0xlxvlhemja6c4dqv22uapctqupfhlxm9h8z3k2e72q4k9hcz7vqzk5jj1",
        networks.bitcoin,
      ),
    ).toThrow();
  });
});
