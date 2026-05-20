import { describe, expect, it } from "vitest";

import { PublicKey } from "@solana/web3.js";

import { findByMint, listSolanaTokens } from "../src/tokens/solana-top-50.js";

describe("solana-top-50 curated SPL registry (Phase 11 Plan 11-05 D-8)", () => {
  it("ships at least 40 entries (matches Phase 8 'curation over padding' precedent)", () => {
    const entries = listSolanaTokens();
    expect(entries.length).toBeGreaterThanOrEqual(40);
  });

  it("every mint is a valid base58 32-byte Solana pubkey (DOA at module load)", () => {
    // listSolanaTokens already imported above — if module load failed on a
    // malformed base58, the import would throw and this test wouldn't run.
    // This assertion is defense-in-depth: re-validate every mint here.
    for (const entry of listSolanaTokens()) {
      expect(() => new PublicKey(entry.mint)).not.toThrow();
    }
  });

  it("contains the required mints: wSOL, USDC, USDT, mSOL, JitoSOL", () => {
    const required = [
      "So11111111111111111111111111111111111111112", // wSOL
      "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", // USDC
      "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB", // USDT
      "mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So",  // mSOL
      "J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn", // JitoSOL
    ];
    for (const mint of required) {
      const entry = findByMint(mint);
      expect(entry).toBeDefined();
      expect(entry?.mint).toBe(mint);
    }
  });

  it("contains no duplicate mints", () => {
    const entries = listSolanaTokens();
    const seen = new Set<string>();
    for (const entry of entries) {
      expect(seen.has(entry.mint)).toBe(false);
      seen.add(entry.mint);
    }
    expect(seen.size).toBe(entries.length);
  });

  it("findByMint hits curated entry; misses on unknown mint", () => {
    const usdc = findByMint("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
    expect(usdc).toBeDefined();
    expect(usdc?.symbol).toBe("USDC");
    expect(usdc?.decimals).toBe(6);

    // Random base58 pubkey not in the registry.
    const unknown = findByMint("11111111111111111111111111111111");
    expect(unknown).toBeUndefined();
  });

  it("every entry has the required { mint, symbol, decimals, displayName } shape", () => {
    for (const entry of listSolanaTokens()) {
      expect(typeof entry.mint).toBe("string");
      expect(entry.mint.length).toBeGreaterThan(0);
      expect(typeof entry.symbol).toBe("string");
      expect(entry.symbol.length).toBeGreaterThan(0);
      expect(typeof entry.decimals).toBe("number");
      expect(Number.isInteger(entry.decimals)).toBe(true);
      expect(entry.decimals).toBeGreaterThanOrEqual(0);
      expect(typeof entry.displayName).toBe("string");
      expect(entry.displayName.length).toBeGreaterThan(0);
    }
  });
});
