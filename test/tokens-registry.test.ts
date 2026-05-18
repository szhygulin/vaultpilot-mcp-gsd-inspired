import { describe, expect, it, beforeEach } from "vitest";

import {
  loadTokenRegistry,
  _resetRegistryCacheForTesting,
  type Token,
} from "../src/tokens/registry.js";

// Phase 8 — Plan 08-03. The per-chain `loadTokenRegistry(chainId)` dispatcher
// is finalised in this plan: each of the 5 supported chains returns a real
// curated top-50 registry parsed + checksummed from the per-chain JSON file.
// The plan's verify gate requires `>= 40` entries per chain (curation gap
// guard) AND a canonical-symbol presence check per chain to detect a future
// regression where the wrong JSON file is wired (e.g. an arbitrum JSON
// pasted into the polygon slot).

beforeEach(() => {
  _resetRegistryCacheForTesting();
});

function bySymbol(reg: Token[]): Record<string, Token> {
  return Object.fromEntries(reg.map((t) => [t.symbol, t]));
}

describe("loadTokenRegistry — per-chain dispatcher (Plan 08-03 finalisation)", () => {
  it("Test 1: chainId=1 returns the Ethereum top-50 with WETH at the canonical mainnet address", () => {
    const reg = loadTokenRegistry(1);
    expect(reg.length).toBeGreaterThanOrEqual(40);
    const m = bySymbol(reg);
    expect(m.WETH?.address).toBe("0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2");
    expect(m.USDC?.address).toBe("0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48");
    expect(m.USDT?.decimals).toBe(6);
  });

  it("Test 2: per-chain memoization — second call returns the same reference", () => {
    const a = loadTokenRegistry(1);
    const b = loadTokenRegistry(1);
    expect(a).toBe(b);
  });

  it("Test 3: memoization is per-chain — different chains return different arrays", () => {
    const eth = loadTokenRegistry(1);
    const arb = loadTokenRegistry(42161);
    expect(eth).not.toBe(arb);
  });

  it("Test 4: every entry's address is EIP-55-checksummed at load (corrupted-snapshot guard)", () => {
    // viem.getAddress throws on bad checksum; if the JSON file ships with a
    // corrupted address, loadTokenRegistry throws at module load. This test
    // asserts the happy path — every returned address is an Address (string).
    for (const id of [1, 42161, 137, 8453, 10] as const) {
      const reg = loadTokenRegistry(id);
      for (const tok of reg) {
        expect(typeof tok.address).toBe("string");
        expect(tok.address).toMatch(/^0x[0-9a-fA-F]{40}$/);
      }
    }
  });

  it("Test 5: chainId=42161 returns the Arbitrum top-50 with WETH at the Arbitrum address", () => {
    const reg = loadTokenRegistry(42161);
    expect(reg.length).toBeGreaterThanOrEqual(40);
    const m = bySymbol(reg);
    expect(m.WETH?.address).toBe("0x82aF49447D8a07e3bd95BD0d56f35241523fBab1");
    expect(m.ARB?.address).toBe("0x912CE59144191C1204E64559FE8253a0e49E6548");
    expect(m.USDC?.decimals).toBe(6);
    // Arbitrum has both native USDC and bridged USDC.e
    expect(m["USDC.e"]).toBeDefined();
  });

  it("Test 6: chainId=137 returns the Polygon top-50 with WMATIC + WETH at canonical Polygon addresses", () => {
    const reg = loadTokenRegistry(137);
    expect(reg.length).toBeGreaterThanOrEqual(40);
    const m = bySymbol(reg);
    expect(m.WMATIC?.address).toBe("0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270");
    expect(m.WETH?.address).toBe("0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619");
    expect(m.USDC?.decimals).toBe(6);
    expect(m["USDC.e"]).toBeDefined();
  });

  it("Test 7: chainId=8453 returns the Base top-50 with WETH at the OP-Stack predeploy address", () => {
    const reg = loadTokenRegistry(8453);
    expect(reg.length).toBeGreaterThanOrEqual(40);
    const m = bySymbol(reg);
    expect(m.WETH?.address).toBe("0x4200000000000000000000000000000000000006");
    expect(m.USDC?.address).toBe("0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913");
    expect(m.USDbC).toBeDefined(); // bridged USDC variant on Base
  });

  it("Test 8: chainId=10 returns the Optimism top-50 with OP + WETH at the OP-Stack predeploy address", () => {
    const reg = loadTokenRegistry(10);
    expect(reg.length).toBeGreaterThanOrEqual(40);
    const m = bySymbol(reg);
    expect(m.OP?.address).toBe("0x4200000000000000000000000000000000000042");
    expect(m.WETH?.address).toBe("0x4200000000000000000000000000000000000006");
    expect(m.VELO).toBeDefined(); // Velodrome — chain-distinguishing DEX
    expect(m["USDC.e"]).toBeDefined();
  });

  it("Test 9: registries are chain-distinct — same symbol resolves to different addresses across chains", () => {
    const eth = bySymbol(loadTokenRegistry(1));
    const arb = bySymbol(loadTokenRegistry(42161));
    // USDC native exists on both, but at different addresses (canonical
    // per-chain SOT — a regression that wires the wrong file into the wrong
    // chainId slot would break this).
    expect(eth.USDC?.address).not.toBe(arb.USDC?.address);
  });
});
